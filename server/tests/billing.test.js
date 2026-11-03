'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { start } = require('./helpers');
const billing = require('../billing');
const { createLocalSource } = require('../vp-local');

/* 2026-10-11 is a Sunday; the reset day is the 12th, so the billing month in progress is September */
async function withApp(fn, opts) { const t = await start(Object.assign({ nowLocal: () => '2026-10-11T10:00' }, opts)); try { await fn(t); } finally { await t.close(); } }

const P = '2024-0207';            // fixed fee. PM Ana (E201), PIC Tom (E104). Phases sd (fully billed), dd, cd, ca. Projection $28,500.
const H = '2025-0510';            // hourly. PM Ravi (E203). Authorized $180,000.
const OK = { dd: { amountCents: 850000 }, cd: { amountCents: 2000000 }, ca: { amountCents: 0 } }; // exactly the projection
const open = async (as, wbs1 = P, month) => (await as.post(`/api/billing/projects/${wbs1}/requests`, month ? { month } : {})).body;
const submit = (as, r, extra) => as.post(`/api/billing/requests/${r.id}/submit`, Object.assign({ rev: r.rev, entries: OK, notes: '' }, extra));

test('access: only PMs and PICs of a project, processors and the Admin; nobody else, not even to read', () => withApp(async ({ api }) => {
  for (const who of ['m.hale', 'c.brandt', 'kent']) assert.strictEqual((await api(who).get('/api/billing/portfolio')).status, 403, who);
  assert.strictEqual((await api().get('/api/billing/portfolio')).status, 401);
  const rows = async who => (await api(who).get('/api/billing/portfolio')).body.rows.map(r => r.wbs1).sort();
  assert.deepStrictEqual(await rows('a.ruiz'), ['2024-0207', '2025-0187'], 'a PM sees the projects they manage');
  assert.deepStrictEqual(await rows('t.lindqvist'), ['2024-0207', '2025-0187'], 'a PIC sees the projects they lead');
  assert.strictEqual((await rows('karen.acct')).length, 13);
  assert.strictEqual((await rows('j.workman')).length, 13);
  const me = (await api('karen.acct').get('/api/me')).body;
  assert.deepStrictEqual([me.areas.billing, me.areas.admin, me.areas.turnaround], [true, false, false], 'a processor sees Billing only');
  assert.strictEqual((await api('a.ruiz').get('/api/billing/projects/2025-0230')).status, 403, 'another PM\'s project');
  assert.strictEqual((await api('r.chen').get('/api/billing/portfolio')).body.rows.length, 0, 'a PIC with no billed projects sees an empty list');
}));

test('portfolio: every expected project appears once, awaiting, in the September cycle; the unassigned are counted for accounting', () => withApp(async ({ api }) => {
  const b = (await api('karen.acct').get('/api/billing/portfolio')).body;
  assert.strictEqual(b.rows.length, 13);
  assert.ok(b.rows.every(r => r.state === 'awaiting' && r.month === '2026-09'));
  assert.strictEqual(b.counts.awaiting, 13);
  assert.strictEqual(b.counts.unassigned, 2);
  assert.deepStrictEqual((await api('karen.acct').get('/api/billing/portfolio?scope=unassigned')).body.rows.map(r => r.wbs1).sort(), ['2025-0173', '2025-0334']);
  assert.strictEqual((await api('karen.acct').get('/api/billing/portfolio?scope=mine')).body.rows.length, 5);
  assert.strictEqual((await api('a.ruiz').get('/api/billing/portfolio')).body.counts.unassigned, undefined, 'a PM is not shown the queue count');
  assert.strictEqual((await api('karen.acct').get('/api/billing/portfolio?month=2026-13')).status, 400);
  const row = b.rows.find(r => r.wbs1 === P);
  assert.deepStrictEqual([row.feeCents, row.billedCents, row.projectionCents, row.pm, row.pic, row.assignedTo.name], [30500000, 15700000, 2850000, 'Ana Ruiz', 'Tom Lindqvist', 'Karen (accounting)']);
}));

test('a draft: only the project\'s PM or PIC starts it; one open request per project; Save Draft takes anything', () => withApp(async ({ api, db }) => {
  assert.strictEqual((await api('j.nakamura').post(`/api/billing/projects/${P}/requests`, {})).status, 403, 'another PM');
  assert.strictEqual((await api('karen.acct').post(`/api/billing/projects/${P}/requests`, {})).status, 403, 'a processor does not write the PM\'s instructions');
  const ana = api('a.ruiz');
  const r = await open(ana);
  assert.deepStrictEqual([r.status, r.kind, r.month, r.rev, r.form], ['draft', 'regular', '2026-09', 1, 'fixed']);
  assert.deepStrictEqual(Object.keys(r.draft.entries).sort(), ['ca', 'cd', 'dd', 'sd'], 'starts with a zero for every phase');
  assert.strictEqual((await api('t.lindqvist').post(`/api/billing/projects/${P}/requests`, {})).status, 409, 'the PIC meets the PM\'s open request');
  assert.throws(() => db.run("INSERT INTO billing_requests (id, wbs1, month, kind, form, status, created_at, created_by, updated_at, updated_by) VALUES ('x', ?, '2026-10', 'regular', 'fixed', 'draft', 1, 'u', 1, 'u')", P), /UNIQUE/, 'the database refuses a second open request too');
  const saved = await ana.put(`/api/billing/requests/${r.id}/draft`, { rev: r.rev, entries: { dd: { amountCents: null } }, notes: '<b>hi</b><script>x()</script>' });
  assert.strictEqual(saved.status, 200, 'an incomplete draft saves');
  assert.strictEqual(saved.body.draft.notes, '<b>hi</b>', 'notes are cleaned on the server');
  assert.strictEqual(saved.body.rev, 2);
  assert.strictEqual((await ana.put(`/api/billing/requests/${r.id}/draft`, { rev: 1, entries: {} })).status, 409, 'a stale rev is refused');
  assert.strictEqual((await ana.put(`/api/billing/requests/${r.id}/draft`, { rev: 2, entries: { nope: { amountCents: 1 } } })).status, 400, 'an unknown line');
  assert.strictEqual((await ana.put(`/api/billing/requests/${r.id}/draft`, { rev: 2, entries: { dd: { amountCents: 1.5 } } })).status, 400, 'not whole cents');
  assert.strictEqual((await ana.put(`/api/billing/requests/${r.id}/draft`, { rev: 2, entries: { dd: { pctBp: 5000, amountCents: 1 } } })).status, 400, 'both at once');
  assert.strictEqual((await api('j.nakamura').get(`/api/billing/requests/${r.id}`)).status, 403);
  const state = (await api('karen.acct').get('/api/billing/portfolio')).body.rows.find(x => x.wbs1 === P);
  assert.deepStrictEqual([state.state, state.open.status], ['draft', 'draft']);
}));

test('submit is checked again on the server: blank lines, the variance rule (strictly greater), and No billing', () => withApp(async ({ api }) => {
  const ana = api('a.ruiz'), r = await open(ana);
  let res = await submit(ana, r, { entries: { dd: { amountCents: 850000 }, cd: { amountCents: 2000000 } } });
  assert.strictEqual(res.status, 422);
  assert.deepStrictEqual(res.body.issues, [{ code: 'line-blank', lineId: 'ca' }], 'a phase left blank');
  res = await submit(ana, r, { entries: { dd: { amountCents: 850000 }, cd: { amountCents: 5000000 }, ca: { amountCents: 0 } } }); // total 5,850,000: exactly $30,000 over the projection
  assert.strictEqual(res.status, 200, 'exactly the threshold needs no note');
  const r2 = (await ana.post(`/api/billing/requests/${res.body.id}/withdraw`, { rev: res.body.rev })).body;
  assert.strictEqual(r2.status, 'draft');
  res = await submit(ana, r2, { entries: { dd: { amountCents: 850000 }, cd: { amountCents: 5000001 }, ca: { amountCents: 0 } } });
  assert.deepStrictEqual([res.status, res.body.issues], [422, [{ code: 'variance-note-required' }]], 'one cent over needs a note');
  res = await submit(ana, r2, { entries: { dd: { amountCents: 850000 }, cd: { amountCents: 5000001 }, ca: { amountCents: 0 } }, notes: '<p> </p>' });
  assert.strictEqual(res.status, 422, 'empty markup is not a note');
  res = await submit(ana, r2, { entries: { dd: { amountCents: 850000 }, cd: { amountCents: 5000001 }, ca: { amountCents: 0 } }, notes: '<p>Client approved the early milestone.</p>' });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.revision, 2);
  const over = await api('a.ruiz').post(`/api/billing/requests/${res.body.id}/withdraw`, { rev: res.body.rev });
  res = await submit(ana, over.body, { entries: { dd: { amountCents: 100 }, cd: { amountCents: 0 }, ca: { amountCents: 0 } }, noBilling: true });
  assert.deepStrictEqual(res.body.issues, [{ code: 'no-billing-nonzero' }]);
  res = await submit(ana, over.body, { entries: { dd: { amountCents: 0 }, cd: { amountCents: 0 }, ca: { amountCents: 0 } }, notes: 'x' }); // $28,500 under the projection: inside the threshold
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.draft.noBilling, true, 'a zero total is submitted as an explicit No billing');
}));

test('the threshold is an Admin setting', () => withApp(async ({ api }) => {
  const ana = api('a.ruiz'), r = await open(ana);
  const big = { entries: { dd: { amountCents: 850000 }, cd: { amountCents: 5000000 }, ca: { amountCents: 0 } } };
  assert.strictEqual((await api('j.workman').put('/api/admin/settings', { changes: { 'billing.varianceThreshold': 2999999 } })).status, 200);
  const res = await submit(ana, r, big);
  assert.deepStrictEqual([res.status, res.body.issues], [422, [{ code: 'variance-note-required' }]], 'lowered by one cent, exactly $30,000 now needs a note');
  assert.strictEqual((await api('kent').put('/api/admin/settings', { changes: { 'billing.varianceThreshold': 1 } })).status, 403);
  assert.strictEqual((await api('j.workman').put('/api/admin/settings', { changes: { 'billing.varianceThreshold': -5 } })).status, 400);
}));

test('the life of a request: submit, review, return, resubmit, process; who may do what; nothing changes after processing', () => withApp(async ({ api, db }) => {
  const ana = api('a.ruiz'), karen = api('karen.acct'), camille = api('camille.acct');
  const r = await open(ana);
  assert.strictEqual((await karen.post(`/api/billing/requests/${r.id}/submit`, { rev: r.rev, entries: OK })).status, 403, 'a processor cannot submit for the PM');
  let q = (await submit(ana, r)).body;
  assert.deepStrictEqual([q.status, q.revision, q.revisions.length], ['submitted', 1, 1]);
  assert.strictEqual(q.revisions[0].totalCents, 2850000);
  assert.strictEqual((await ana.put(`/api/billing/requests/${q.id}/draft`, { rev: q.rev, entries: OK })).status, 409, 'a submitted request is changed with Revise, not Save Draft');
  assert.strictEqual((await ana.post(`/api/billing/requests/${q.id}/start-review`, { rev: q.rev })).status, 403, 'a PM cannot review');
  q = (await karen.post(`/api/billing/requests/${q.id}/start-review`, { rev: q.rev })).body;
  assert.deepStrictEqual([q.status, q.handledBy.name], ['review', 'Karen (accounting)']);
  assert.strictEqual((await camille.post(`/api/billing/requests/${q.id}/return`, { rev: q.rev, reason: 'x' })).status, 409, 'another processor cannot take it over');
  assert.strictEqual((await api('j.workman').post(`/api/billing/requests/${q.id}/release`, { rev: q.rev })).status, 200, 'the Admin can');
  q = (await karen.get(`/api/billing/requests/${q.id}`)).body;
  assert.strictEqual(q.status, 'submitted');
  q = (await camille.post(`/api/billing/requests/${q.id}/start-review`, { rev: q.rev })).body;
  assert.strictEqual((await camille.post(`/api/billing/requests/${q.id}/return`, { rev: q.rev, reason: '  ' })).status, 400, 'a return needs a reason');
  q = (await camille.post(`/api/billing/requests/${q.id}/return`, { rev: q.rev, reason: 'Which consultant is this?' })).body;
  assert.strictEqual(q.status, 'returned');
  assert.strictEqual(q.events.at(-1).text, 'Which consultant is this?');
  assert.strictEqual((await ana.post(`/api/billing/requests/${q.id}/answer`, { rev: q.rev, text: ' ' })).status, 400);
  q = (await ana.post(`/api/billing/requests/${q.id}/answer`, { rev: q.rev, text: 'It is the structural engineer.' })).body;
  assert.strictEqual(q.status, 'returned', 'an answer keeps the status');
  q = (await ana.post(`/api/billing/requests/${q.id}/resubmit`, { rev: q.rev, entries: OK, notes: 'Structural engineer.' })).body;
  assert.deepStrictEqual([q.status, q.revision], ['submitted', 2]);
  assert.deepStrictEqual(q.revisions.map(v => [v.number, v.event]), [[1, 'submit'], [2, 'resubmit']], 'earlier revisions stay');
  q = (await karen.post(`/api/billing/requests/${q.id}/start-review`, { rev: q.rev })).body;
  q = (await karen.post(`/api/billing/requests/${q.id}/process`, { rev: q.rev, invoiceRef: 'INV-1001' })).body;
  assert.deepStrictEqual([q.status, q.invoiceRef], ['processed', 'INV-1001']);
  for (const ev of ['revise', 'withdraw', 'edit', 'submit', 'resubmit']) assert.strictEqual((await ana.post(`/api/billing/requests/${q.id}/${ev}`, { rev: q.rev, entries: OK })).status, 409, 'the PM: ' + ev);
  for (const ev of ['start-review', 'return', 'process', 'release']) assert.strictEqual((await karen.post(`/api/billing/requests/${q.id}/${ev}`, { rev: q.rev, reason: 'x' })).status, 409, 'the processor: ' + ev);
  assert.throws(() => db.run("UPDATE billing_requests SET invoice_ref = 'changed' WHERE id = ?", q.id), /processed/);
  assert.throws(() => db.run('DELETE FROM billing_requests WHERE id = ?', q.id), /never deleted/);
  assert.throws(() => db.run('UPDATE billing_revisions SET total_cents = 1 WHERE request_id = ?', q.id), /never changed/);
  assert.throws(() => db.run('DELETE FROM billing_revisions WHERE request_id = ?', q.id), /never deleted/);
  assert.throws(() => db.run("UPDATE billing_events SET text = 'x' WHERE request_id = ?", q.id), /never changed/);
  assert.throws(() => db.run('DELETE FROM billing_events WHERE request_id = ?', q.id), /never deleted/);
  const trail = db.all("SELECT action FROM audit_log WHERE action LIKE 'billing.%' ORDER BY id").map(a => a.action);
  assert.deepStrictEqual(trail, ['billing.create', 'billing.submit', 'billing.start-review', 'billing.release', 'billing.start-review', 'billing.return', 'billing.answer', 'billing.resubmit', 'billing.start-review', 'billing.process']);
  assert.deepStrictEqual((await ana.get(`/api/billing/projects/${P}`)).body.history.map(h => h.status), ['processed']);
}));

test('an authorized revision after submitting keeps the status and makes a new revision; a PIC may make it too', () => withApp(async ({ api }) => {
  const ana = api('a.ruiz'), tom = api('t.lindqvist');
  let q = (await submit(ana, await open(ana))).body;
  q = (await tom.post(`/api/billing/requests/${q.id}/revise`, { rev: q.rev, entries: { dd: { amountCents: 900000 }, cd: { amountCents: 2000000 }, ca: { amountCents: 0 } }, notes: 'Added.' })).body;
  assert.deepStrictEqual([q.status, q.revision], ['submitted', 2]);
  assert.strictEqual(q.revisions[1].by, 'Tom Lindqvist', 'a PIC\'s edit is in the PIC\'s own name');
  assert.strictEqual(q.revisions[0].totalCents, 2850000, 'the first revision is untouched');
}));

test('pending amounts: what is submitted or just processed counts as billed until the next Vantagepoint copy', () => withApp(async ({ api, db }) => {
  const ana = api('a.ruiz'), karen = api('karen.acct');
  let q = (await submit(ana, await open(ana))).body;
  q = (await karen.post(`/api/billing/requests/${q.id}/start-review`, { rev: q.rev })).body;
  await karen.post(`/api/billing/requests/${q.id}/process`, { rev: q.rev });
  const next = await open(ana, P, '2026-09');
  assert.strictEqual(next.kind, 'additional', 'a second billing in the same month');
  const dd = next.facts.phases.find(p => p.id === 'dd');
  assert.deepStrictEqual([dd.billedCents, dd.pendingCents], [6300000, 850000]);
  const tooMuch = await ana.post(`/api/billing/requests/${next.id}/submit`, { rev: next.rev, entries: { dd: { amountCents: 1850001 }, cd: { amountCents: 0 }, ca: { amountCents: 0 } }, notes: 'x' });
  assert.deepStrictEqual(tooMuch.body.issues, [{ code: 'line-over-fee', lineId: 'dd' }], 'one cent past what pending leaves');
  billing.loadVpBilling(db, createLocalSource()); // the nightly copy arrives and now includes it
  const fresh = (await ana.get(`/api/billing/requests/${next.id}`)).body;
  assert.strictEqual(fresh.facts.phases.find(p => p.id === 'dd').pendingCents, 0);
  assert.notStrictEqual(fresh.currentSourceHash, next.currentSourceHash, 'the inputs changed, so the hash did');
}));

test('stale data: submitting from numbers that have since changed in Vantagepoint fails safely', () => withApp(async ({ api, db }) => {
  const ana = api('a.ruiz'), r = await open(ana);
  const src = createLocalSource(), data = src.loadBilling();
  data.lines.find(l => l.wbs1 === P && l.lineId === 'dd').billedCents += 100000;
  billing.loadVpBilling(db, { loadBilling: () => data });
  const res = await submit(ana, r, { sourceHash: r.sourceHash });
  assert.deepStrictEqual([res.status, res.body.issues], [422, [{ code: 'stale-source' }]]);
  const now = (await ana.get(`/api/billing/requests/${r.id}`)).body;
  assert.strictEqual((await submit(ana, now, { sourceHash: now.currentSourceHash })).status, 200, 'after reloading, it goes through');
}));

test('hourly projects: lines against what is available, and the authorization', () => withApp(async ({ api }) => {
  const ravi = api('r.shah'), r = await open(ravi, H);
  assert.deepStrictEqual([r.form, r.facts.lines.length, r.facts.hourlyProject.authorizedCents], ['hourly', 4, 18000000]);
  const all = { prog: { amountCents: 1225000 }, design: { amountCents: 890000 }, exp: { amountCents: 184000 }, cons: { amountCents: 620000 } };
  let res = await ravi.post(`/api/billing/requests/${r.id}/submit`, { rev: r.rev, entries: Object.assign({}, all, { exp: { amountCents: 184001 } }), notes: '' });
  assert.deepStrictEqual(res.body.issues, [{ code: 'line-over-available', lineId: 'exp' }]);
  assert.strictEqual((await ravi.put(`/api/billing/requests/${r.id}/draft`, { rev: r.rev, entries: { prog: { pctBp: 5000 } } })).status, 400, 'percent entry is for fixed fee');
  res = await ravi.post(`/api/billing/requests/${r.id}/submit`, { rev: r.rev, entries: all, notes: '' });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.revisions[0].totalCents, 2919000);
}));

test('notifications are queued for accounting with each person\'s own delivery: digest, instant, held for business hours', () => withApp(async ({ api, db }) => {
  const ana = api('a.ruiz'), karen = api('karen.acct'), camille = api('camille.acct');
  const karenId = db.get("SELECT id FROM users WHERE username = 'karen.acct'").id;
  const rows = () => db.all('SELECT event, wbs1, involved_json, delivery_json FROM billing_notifications ORDER BY id').map(n => ({ event: n.event, wbs1: n.wbs1, involved: JSON.parse(n.involved_json), delivery: JSON.parse(n.delivery_json) }));
  let q = (await submit(ana, await open(ana))).body;
  let n = rows();
  assert.deepStrictEqual(n.map(x => x.event), ['submission']);
  assert.deepStrictEqual([n[0].involved, n[0].delivery.map(d => d.mode)], [[karenId], ['digest']], 'the project\'s processor, on the default digest');
  q = (await karen.post(`/api/billing/requests/${q.id}/start-review`, { rev: q.rev })).body;
  q = (await karen.post(`/api/billing/requests/${q.id}/return`, { rev: q.rev, reason: 'Check phase.' })).body;
  q = (await ana.post(`/api/billing/requests/${q.id}/resubmit`, { rev: q.rev, entries: OK, notes: 'Fixed.' })).body;
  n = rows();
  assert.strictEqual(n.at(-1).event, 'resubmit');
  assert.deepStrictEqual(n.at(-1).delivery[0], { userId: karenId, mode: 'instant', sendAt: '2026-10-12T08:00' }, 'Sunday: an instant alert waits for Monday morning');
  const prefs = JSON.parse(JSON.stringify((await karen.get('/api/billing/email-prefs')).body));
  prefs.reminders.quietHours = false; prefs.events.revision = 'off';
  assert.strictEqual((await karen.put('/api/billing/email-prefs', prefs)).status, 200);
  await ana.post(`/api/billing/requests/${q.id}/revise`, { rev: q.rev, entries: OK, notes: 'Again.' });
  assert.deepStrictEqual(rows().at(-1).delivery[0], { userId: karenId, mode: 'off' }, 'her own setting wins');
  assert.strictEqual((await ana.get('/api/billing/email-prefs')).status, 403, 'a PM has no email settings');
  assert.strictEqual((await camille.get('/api/billing/email-prefs')).body.events.complete, 'off', 'defaults are the mockup\'s');
  prefs.digest.frequency = 'hourly';
  const bad = await karen.put('/api/billing/email-prefs', prefs);
  assert.deepStrictEqual([bad.status, bad.body.problems], [400, ['digest.frequency']]);
}));

test('assignments: any processor can reassign, both are told, unassigned come first, and PMs cannot', () => withApp(async ({ api, db }) => {
  const karen = api('karen.acct'), camille = api('camille.acct');
  const id = u => db.get('SELECT id FROM users WHERE username = ?', u).id;
  let a = (await karen.get('/api/billing/assignments')).body;
  assert.deepStrictEqual([a.unassigned, a.rows.slice(0, 2).map(r => r.wbs1).sort(), a.processors.map(p => p.name)], [2, ['2025-0173', '2025-0334'], ['Camille (accounting)', 'Josh Workman', 'Karen (accounting)']], 'unassigned first; Josh is a processor through the Admin role');
  assert.strictEqual((await api('a.ruiz').get('/api/billing/assignments')).status, 403);
  assert.strictEqual((await api('a.ruiz').put(`/api/billing/assignments/${P}`, { processorId: id('camille.acct') })).status, 403);
  assert.strictEqual((await karen.put(`/api/billing/assignments/${P}`, { processorId: id('m.hale') })).status, 400, 'not a processor');
  assert.strictEqual((await karen.put(`/api/billing/assignments/${P}`, {})).status, 400);
  assert.deepStrictEqual((await camille.put(`/api/billing/assignments/${P}`, { processorId: id('camille.acct') })).body, { changed: true }, 'any processor may reassign');
  assert.deepStrictEqual((await camille.put(`/api/billing/assignments/${P}`, { processorId: id('camille.acct') })).body, { changed: false });
  const n = db.get("SELECT * FROM billing_notifications WHERE event = 'assignment'");
  assert.deepStrictEqual(JSON.parse(n.involved_json).sort(), [id('camille.acct'), id('karen.acct')].sort(), 'the old and the new processor');
  assert.strictEqual((await camille.put(`/api/billing/assignments/${P}`, { processorId: null })).status, 200);
  assert.strictEqual((await karen.get('/api/billing/assignments')).body.unassigned, 3);
  assert.throws(() => db.run('DELETE FROM billing_assignments'), /never deleted/);
  assert.ok(db.get("SELECT id FROM audit_log WHERE action = 'billing.assign'"));
}));

test('deadlines are the Admin\'s; the reset day is an Admin setting; a project can have its own', () => withApp(async ({ api }) => {
  const josh = api('j.workman'), karen = api('karen.acct'), ana = api('a.ruiz');
  assert.strictEqual((await karen.put('/api/admin/billing/calendar', { month: '2026-09', deadline: '2026-10-07' })).status, 403);
  assert.strictEqual((await josh.put('/api/admin/billing/calendar', { month: '2026-09', deadline: '10/07/2026' })).status, 400);
  assert.strictEqual((await josh.put('/api/admin/billing/calendar', { month: '2026-09', deadline: '2026-02-30' })).status, 400);
  const cal = (await josh.put('/api/admin/billing/calendar', { month: '2026-09', deadline: '2026-10-07' })).body;
  assert.deepStrictEqual(cal.find(c => c.month === '2026-09').deadline, '2026-10-07');
  const row = (await karen.get('/api/billing/portfolio')).body.rows.find(r => r.wbs1 === P);
  assert.deepStrictEqual(row.deadline, { deadline: '2026-10-07', daysLeft: -4, state: 'passed' });
  assert.deepStrictEqual((await josh.put('/api/admin/billing/calendar', { month: '2026-10', deadline: null, startsOn: null })).body.find(c => c.month === '2026-10').deadline, null, 'cleared: "no deadline set"');
  // the clock reset
  assert.strictEqual((await karen.get('/api/billing/portfolio')).body.rows[0].month, '2026-09');
  assert.strictEqual((await josh.put('/api/admin/settings', { changes: { 'billing.rolloverDay': 10 } })).status, 200);
  const after = (await karen.get('/api/billing/portfolio')).body.rows;
  assert.ok(after.every(r => r.month === '2026-10' && r.state === 'awaiting'), 'on the 10th the new month starts and every project is unbilled again');
  assert.strictEqual((await karen.put('/api/admin/settings', { changes: { 'billing.rolloverDay': 3 } })).status, 403);
  // this project keeps its own reset day
  assert.strictEqual((await karen.post(`/api/billing/projects/${P}/adjust`, { rolloverDay: 20 })).status, 403, 'a processor does not adjust a PM\'s project');
  assert.strictEqual((await ana.post(`/api/billing/projects/${P}/adjust`, { rolloverDay: 40 })).status, 400);
  assert.strictEqual((await ana.post(`/api/billing/projects/${P}/adjust`, { rolloverDay: 20 })).body.rolloverDay, 20);
  const mixed = (await karen.get('/api/billing/portfolio')).body.rows;
  assert.deepStrictEqual([mixed.find(r => r.wbs1 === P).month, mixed.find(r => r.wbs1 === '2025-0187').month], ['2026-09', '2026-10']);
  assert.strictEqual(mixed.find(r => r.wbs1 === P).adjustments.rolloverDay, 20, 'the portfolio shows the project\'s own reset day (the Admin list reads it)');
  assert.strictEqual((await ana.post(`/api/billing/projects/${P}/adjust`, { rolloverDay: null })).body.rolloverDay, null);
  // leaving a project out of a month needs a reason, is shown (not hidden), and can be undone
  assert.strictEqual((await ana.post(`/api/billing/projects/${P}/adjust`, { exclude: { month: '2026-10', reason: ' ' } })).status, 400);
  await ana.post(`/api/billing/projects/${P}/adjust`, { exclude: { month: '2026-10', reason: 'Closed out early' } });
  const ex = (await karen.get('/api/billing/portfolio')).body;
  assert.deepStrictEqual([ex.rows.length, ex.rows.find(r => r.wbs1 === P).state, ex.rows.find(r => r.wbs1 === P).excludedReason], [13, 'excluded', 'Closed out early']);
  assert.deepStrictEqual(ex.rows.find(r => r.wbs1 === P).adjustments.excluded, [{ month: '2026-10', reason: 'Closed out early' }]);
  await ana.post(`/api/billing/projects/${P}/adjust`, { include: '2026-10' });
  assert.strictEqual((await karen.get('/api/billing/portfolio')).body.rows.find(r => r.wbs1 === P).state, 'awaiting');
}));

test('a submitted project is done for the month, and a mid-month second billing shows as an open request', () => withApp(async ({ api }) => {
  const ana = api('a.ruiz'), karen = api('karen.acct');
  let q = (await submit(ana, await open(ana))).body;
  let row = (await karen.get('/api/billing/portfolio')).body.rows.find(r => r.wbs1 === P);
  assert.deepStrictEqual([row.state, row.done, row.amountCents], ['submitted', true, 2850000]);
  assert.strictEqual((await karen.get('/api/billing/portfolio')).body.counts.awaiting, 12);
  assert.strictEqual((await ana.post(`/api/billing/projects/${P}/requests`, {})).status, 409, 'finish this one first');
  q = (await karen.post(`/api/billing/requests/${q.id}/start-review`, { rev: q.rev })).body;
  await karen.post(`/api/billing/requests/${q.id}/process`, { rev: q.rev });
  const second = await open(ana);
  assert.strictEqual(second.kind, 'additional');
  row = (await karen.get('/api/billing/portfolio')).body.rows.find(r => r.wbs1 === P);
  assert.deepStrictEqual([row.state, row.done, row.open.status, row.open.kind], ['processed', true, 'draft', 'additional']);
}));

test('project notes are rich text, cleaned on the server, and only the PM or PIC writes them', () => withApp(async ({ api, db }) => {
  assert.strictEqual((await api('karen.acct').post(`/api/billing/projects/${P}/notes`, { body: 'x' })).status, 403);
  assert.strictEqual((await api('a.ruiz').post(`/api/billing/projects/${P}/notes`, { body: 5 })).status, 400);
  await api('a.ruiz').post(`/api/billing/projects/${P}/notes`, { body: 'Bill <b>SD</b> first.<img src=x onerror=alert(1)>' });
  await api('t.lindqvist').post(`/api/billing/projects/${P}/notes`, { body: '<p>Latest.</p>' });
  const d = (await api('karen.acct').get(`/api/billing/projects/${P}`)).body;
  assert.deepStrictEqual([d.notes.body, d.notes.by], ['<p>Latest.</p>', 'Tom Lindqvist']);
  assert.strictEqual(db.get('SELECT COUNT(*) n FROM billing_project_notes').n, 2, 'earlier versions are kept');
  assert.strictEqual(db.get('SELECT body FROM billing_project_notes ORDER BY id LIMIT 1').body, 'Bill <b>SD</b> first.');
  assert.throws(() => db.run("UPDATE billing_project_notes SET body = 'x'"), /never changed/);
}));

test('Billing is in the Admin tabs for the Admin to edit and for the System admin to read', () => withApp(async ({ api }) => {
  assert.strictEqual((await api('j.workman').get('/api/me')).body.adminTabs.billing, 'edit');
  assert.strictEqual((await api('kent').get('/api/me')).body.adminTabs.billing, 'view');
  assert.strictEqual((await api('karen.acct').get('/api/me')).body.adminTabs.billing, null);
  assert.strictEqual((await api('kent').put('/api/admin/billing/calendar', { month: '2026-09', deadline: '2026-10-07' })).status, 403);
}));
