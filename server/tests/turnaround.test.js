'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { start } = require('./helpers');
const { seed } = require('../seed');

/* every test runs on the demo data (August and September published, plan logs written) on the mockup's day */
async function withDemo(fn, opts) {
  const mailer = { sent: [], sendToAdmin(m) { this.sent.push(m); } };
  const t = await start(Object.assign({ demo: true, today: () => '2026-10-07', mailer }, opts));
  t.mailer = mailer;
  try { await fn(t); } finally { await t.close(); }
}
const statusOf = (overview, wbs1) => overview.pics.flatMap(p => p.projects).find(p => p.wbs1 === wbs1).plan;

test('the page reproduces the mockup: 16 projects, -$450,040, 8 plans current, 4 waiting', () => withDemo(async ({ api }) => {
  const r = await api('j.workman').get('/api/turnaround/current');
  assert.strictEqual(r.status, 200);
  const o = r.body;
  assert.strictEqual(o.run.period, 202609);
  assert.strictEqual(o.kpis.projectCount, 16);
  assert.strictEqual(o.kpis.negativeYtd, -45004000);
  assert.strictEqual(o.kpis.plansCurrent, 8);
  assert.strictEqual(o.kpis.updateDue, 4);
  assert.strictEqual(o.kpis.pastDue, 2);
  assert.strictEqual(o.kpis.noPlan, 2);
  assert.strictEqual(o.pics.length, 7, 'every active PIC, including one with nothing below break-even');
  assert.deepStrictEqual(o.pics.map(p => [p.name, p.projects.length]).sort(), [['Ben Okafor', 2], ['Dana Whitfield', 4], ['Elena Castellanos', 2], ['Marcus Oyelaran', 3], ['Priya Raman', 3], ['Riley Chen', 0], ['Tom Lindqvist', 2]]);
  const expected = { '2024-0207': ['overdue', 11], '2025-0173': ['overdue', 7], '2025-0412': ['update_due', 0], '2024-0356': ['update_due', 0], '2025-0144': ['update_due', 0], '2025-0121': ['update_due', 0], '2025-0230': ['no_plan', 0], '2024-0399': ['no_plan', 0], '2025-0187': ['current', 0], '2025-0098': ['current', 0] };
  for (const [wbs1, [status, days]] of Object.entries(expected)) assert.deepStrictEqual([statusOf(o, wbs1).status, statusOf(o, wbs1).daysOverdue], [status, days], wbs1);
}));

test('since last month, and the charts\' history', () => withDemo(async ({ api }) => {
  const o = (await api('j.workman').get('/api/turnaround/current')).body;
  assert.strictEqual(o.since.label, 'August 2026');
  assert.strictEqual(o.since.added, 2, 'Tooele and Draper are new this month');
  assert.strictEqual(o.since.off, 0);
  assert.strictEqual(o.since.improved + o.since.worse, 14);
  assert.strictEqual(o.history.length, 12);
  assert.deepStrictEqual(o.history.filter(h => h.lastYear).map(h => h.period), [202510, 202511, 202512]);
  const sep = o.history[11];
  assert.deepStrictEqual([sep.period, sep.negativeYtd, sep.belowCount], [202609, -45004000, 16], 'the last point is the run itself');
}));

test('a project\'s page shows its log, newest first, with the date changes', () => withDemo(async ({ api }) => {
  const r = (await api('j.workman').get('/api/projects/2025-0412/plan')).body;
  assert.strictEqual(r.project.name, 'Wasatch Valley Clinic TI');
  assert.strictEqual(r.project.pic.name, 'Dana Whitfield');
  assert.strictEqual(r.cycle, 2026);
  assert.strictEqual(r.opened, '2026-07-14');
  assert.deepStrictEqual(r.entries.map(e => e.kind), ['date_revised', 'update', 'admin_note', 'commitment', 'missed', 'commitment', 'done', 'commitment', 'update', 'explanation']);
  assert.deepStrictEqual(r.can.kinds, [], 'the admin does not write PIC entries');
  assert.strictEqual(r.entries[r.entries.length - 1].planOpened, true);
  const c3 = r.commitments.find(c => c.promisedBy === '2026-10-03');
  assert.deepStrictEqual([c3.status, c3.dueDate, c3.revisions.length, c3.revisions[0].reason], ['open', '2026-10-17', 1, 'Owner\'s rep out until Oct 10.']);
  assert.deepStrictEqual(r.commitments.map(c => c.status).sort(), ['done', 'missed', 'open']);
  assert.strictEqual(r.facts.profitYtd, -4125000);
  assert.ok(r.series.length === 9 && r.series[8].profitYtd === -4125000);
  assert.strictEqual(r.status.status, 'update_due');
}));

test('the lever, the number and the actual result are for the Admin only', () => withDemo(async ({ api }) => {
  const asAdmin = (await api('j.workman').get('/api/projects/2025-0412/plan')).body;
  const c = asAdmin.commitments.find(x => x.promisedBy === '2026-10-03');
  assert.deepStrictEqual([c.lever, c.qty, c.leverLabel], ['fee', 58000, 'Request additional services fee']);
  assert.ok(asAdmin.commitments.some(x => x.actual === 412), 'the actual result of a done commitment');

  for (const who of ['d.whitfield', 't.lindqvist', 'm.hale']) {
    const res = await api(who).get('/api/projects/2025-0412/plan');
    assert.strictEqual(res.status, 200, who);
    const text = JSON.stringify(Object.assign({}, res.body, { levers: undefined })); // the form's list of actions is not a commitment's lever
    for (const secret of ['"lever"', '"leverLabel"', '"qty"', '"actual"', '"unit"', 'Request additional services fee']) assert.ok(!text.includes(secret), `${who} must not receive ${secret}`);
  }
  // nor on the page of everyone's projects
  const overview = JSON.stringify((await api('d.whitfield').get('/api/turnaround/current')).body);
  for (const secret of ['"lever"', '"qty"', '"actual"']) assert.ok(!overview.includes(secret), secret);
  // the form's list of actions goes to the PIC who writes and the admin, not to readers
  assert.ok((await api('d.whitfield').get('/api/projects/2025-0412/plan')).body.levers.length === 10, 'eight actions and an Other in each group');
  assert.strictEqual((await api('t.lindqvist').get('/api/projects/2025-0412/plan')).body.levers.length, 0);
}));

test('only the PIC on a project writes in its plan; Admin only adds labeled notes', () => withDemo(async ({ api }) => {
  const dana = api('d.whitfield');
  const post = (who, wbs1, body) => api(who).post(`/api/projects/${wbs1}/plan/entries`, body);

  assert.strictEqual((await post('d.whitfield', '2025-0412', { kind: 'update', body: 'Owner signed the amendment.' })).status, 201);
  assert.strictEqual((await post('t.lindqvist', '2025-0412', { kind: 'update', body: 'I will write on Dana\'s project.' })).status, 403, 'another PIC');
  assert.strictEqual((await post('j.workman', '2025-0412', { kind: 'update', body: 'Admin cannot write in a PIC\'s voice.' })).status, 403);
  assert.strictEqual((await post('j.workman', '2025-0412', { kind: 'commitment', body: 'x', promisedBy: '2026-11-01', lever: 'fee', qty: 1 })).status, 403);
  assert.strictEqual((await post('j.workman', '2025-0412', { kind: 'admin_note', body: 'Please send me the signed copy.' })).status, 201);
  assert.strictEqual((await post('d.whitfield', '2025-0412', { kind: 'admin_note', body: 'PICs cannot add admin notes.' })).status, 403);
  for (const who of ['m.hale', 'kent']) assert.strictEqual((await post(who, '2025-0412', { kind: 'update', body: 'x' })).status, who === 'kent' ? 403 : 403, who);
  assert.strictEqual((await api('c.brandt').get('/api/projects/2025-0412/plan')).status, 403, 'Marketing has no Turnaround access by default');
  assert.strictEqual((await api().get('/api/projects/2025-0412/plan')).status, 401);
  assert.strictEqual((await api('kent').get('/api/projects/2025-0412/plan')).status, 403, 'the system admin does not read plan content');
  assert.strictEqual((await dana.get('/api/projects/9999-0000/plan')).status, 404);

  const log = (await dana.get('/api/projects/2025-0412/plan')).body.entries;
  assert.deepStrictEqual(log.slice(0, 2).map(e => [e.kind, e.author.name]), [['admin_note', 'Josh Workman'], ['update', 'Dana Whitfield']]);
}));

test('a new entry is checked: blank text, a past date, an unknown action, a negative number', () => withDemo(async ({ api }) => {
  const post = body => api('d.whitfield').post('/api/projects/2025-0412/plan/entries', body);
  const ok = { kind: 'commitment', body: 'Send the amendment', promisedBy: '2026-10-20', lever: 'fee', qty: 12000 };
  assert.strictEqual((await post({ kind: 'update', body: '   ' })).status, 400);
  assert.strictEqual((await post({ kind: 'nonsense', body: 'x' })).status, 400);
  assert.strictEqual((await post(Object.assign({}, ok, { promisedBy: '2026-10-06' }))).status, 400, 'yesterday');
  assert.strictEqual((await post(Object.assign({}, ok, { promisedBy: 'soon' }))).status, 400);
  assert.strictEqual((await post(Object.assign({}, ok, { lever: 'magic' }))).status, 400);
  assert.strictEqual((await post(Object.assign({}, ok, { qty: -5 }))).status, 400);
  assert.strictEqual((await post(Object.assign({}, ok, { qty: '5' }))).status, 400);
  assert.strictEqual((await post(Object.assign({}, ok, { qty: 0 }))).status, 201, 'zero is allowed');
  assert.strictEqual((await post(Object.assign({}, ok, { promisedBy: '2026-10-07' }))).status, 201, 'today is allowed');
}));

test('Mark done asks for what happened and the result; Change date needs a reason; closed commitments are final', () => withDemo(async ({ api }) => {
  const dana = api('d.whitfield');
  const page = (await dana.get('/api/projects/2025-0412/plan')).body;
  const open = page.commitments.find(c => c.status === 'open');
  const base = `/api/projects/2025-0412/plan/commitments/${open.id}`;

  assert.strictEqual((await dana.post(base + '/revise', { newDate: '2026-10-24', reason: '' })).status, 400, 'a reason is required');
  assert.strictEqual((await dana.post(base + '/revise', { newDate: open.dueDate, reason: 'same' })).status, 400, 'the same date');
  assert.strictEqual((await dana.post(base + '/revise', { newDate: '2026-10-01', reason: 'back in time' })).status, 400, 'a past date');
  assert.strictEqual((await api('t.lindqvist').post(base + '/revise', { newDate: '2026-10-24', reason: 'x' })).status, 403);

  const moved = (await dana.post(base + '/revise', { newDate: '2026-10-24', reason: 'Owner asked for another week.' })).body;
  const c = moved.commitments.find(x => x.id === open.id);
  assert.deepStrictEqual([c.dueDate, c.promisedBy, c.revisions.length], ['2026-10-24', '2026-10-03', 2], 'every earlier date stays on record');
  assert.deepStrictEqual(c.revisions.map(r => r.to), ['2026-10-17', '2026-10-24']);

  assert.strictEqual((await dana.post(base + '/done', { body: 'Amendment sent.' })).status, 400, 'the actual result is required');
  assert.strictEqual((await dana.post(base + '/done', { body: '', actual: 1 })).status, 400);
  assert.strictEqual((await dana.post(base + '/done', { body: 'Amendment sent.', actual: 0 })).status, 201, 'zero is allowed');
  const after = (await dana.get('/api/projects/2025-0412/plan')).body;
  const closed = after.commitments.find(x => x.id === open.id);
  assert.deepStrictEqual([closed.status, closed.kept], ['done', true]);
  assert.strictEqual(after.entries[0].daysEarly, 17);
  assert.strictEqual((await dana.post(base + '/done', { body: 'again', actual: 1 })).status, 409);
  assert.strictEqual((await dana.post(base + '/revise', { newDate: '2026-11-01', reason: 'again' })).status, 409);
}));

test('a plan starts with one explanation: nothing else is possible until it is written, and it can only be written once', () => withDemo(async ({ api }) => {
  const marcus = api('m.oyelaran'); const josh = api('j.workman');
  const post = (who, body) => api(who).post('/api/projects/2025-0230/plan/entries', body); // Tooele: on the list, no explanation yet
  const kinds = async () => (await marcus.get('/api/projects/2025-0230/plan')).body.can.kinds;

  assert.deepStrictEqual(await kinds(), ['explanation'], 'the only option');
  const early = await post('m.oyelaran', { kind: 'update', body: 'Quick update.' });
  assert.strictEqual(early.status, 409);
  assert.match(early.body.error, /Start with an explanation/);
  assert.strictEqual((await post('m.oyelaran', { kind: 'commitment', body: 'x', promisedBy: '2026-11-01', lever: 'fee', qty: 1 })).status, 409);

  // an admin note does not use up or hide the explanation
  assert.strictEqual((await post('j.workman', { kind: 'admin_note', body: 'What is going on here?' })).status, 201);
  assert.deepStrictEqual(await kinds(), ['explanation'], 'still the only option after an admin note');
  // the due date passing does not remove it either (the demo day is long after this project is due its plan once the window is shortened)
  await josh.put('/api/admin/settings', { changes: { 'due.newProjectDays': 1 } });
  await josh.post('/api/admin/daily');
  assert.deepStrictEqual(await kinds(), ['explanation'], 'still the only option when overdue');

  assert.strictEqual((await post('m.oyelaran', { kind: 'explanation', body: 'A late change in the structural scope.' })).status, 201);
  assert.deepStrictEqual(await kinds(), ['update', 'commitment'], 'from now on: updates and commitments');
  const again = await post('m.oyelaran', { kind: 'explanation', body: 'A second explanation.' });
  assert.strictEqual(again.status, 409);
  assert.match(again.body.error, /already has its explanation/);
  assert.strictEqual((await post('m.oyelaran', { kind: 'update', body: 'Met the owner.' })).status, 201);
  assert.strictEqual((await post('m.oyelaran', { kind: 'commitment', body: 'Request a fee amendment', promisedBy: '2026-11-01', lever: 'fee', qty: 5000 })).status, 201);
  // someone else's project, and the explanation is not available to a reader
  assert.deepStrictEqual((await api('t.lindqvist').get('/api/projects/2025-0230/plan')).body.can.kinds, []);
}));

test('corrections are gone: they cannot be written, and the old ones still read', () => withDemo(async ({ api }) => {
  const dana = api('d.whitfield');
  const entry = (await dana.get('/api/projects/2025-0412/plan')).body.entries.find(e => e.kind === 'update');
  const r = await dana.post('/api/projects/2025-0412/plan/entries', { kind: 'correction', body: 'It was $4,300.', correctsEntryId: entry.id });
  assert.strictEqual(r.status, 400);
  // the form offers a PIC with an explanation exactly two things
  assert.deepStrictEqual((await dana.get('/api/projects/2025-0412/plan')).body.can.kinds, ['update', 'commitment']);
  // one explanation per plan cycle (the calendar year): a second in the same year is refused
  assert.strictEqual((await dana.post('/api/projects/2025-0412/plan/entries', { kind: 'explanation', body: 'Again.' })).status, 409);
}));

test('the plan log is append-only: no API path and no database path changes or removes an entry', () => withDemo(async ({ api, db }) => {
  const entry = db.get('SELECT * FROM plan_entries ORDER BY created_at LIMIT 1');
  assert.throws(() => db.run("UPDATE plan_entries SET body = 'edited' WHERE id = ?", entry.id), /append-only/);
  assert.throws(() => db.run('DELETE FROM plan_entries WHERE id = ?', entry.id), /append-only/);
  assert.throws(() => db.run("UPDATE plan_entries SET kind = 'update'"), /append-only/);
  assert.throws(() => db.run('DELETE FROM plan_entries'), /append-only/);
  const before = db.get('SELECT COUNT(*) n FROM plan_entries').n;
  for (const who of ['d.whitfield', 'j.workman']) {
    for (const m of ['put', 'del']) {
      assert.strictEqual((await api(who)[m](`/api/projects/2025-0412/plan/entries`, { body: 'x' })).status, 404, `${who} ${m}`);
      assert.strictEqual((await api(who)[m](`/api/projects/2025-0412/plan/entries/${entry.id}`, { body: 'x' })).status, 404, `${who} ${m} one`);
    }
  }
  assert.strictEqual(db.get('SELECT COUNT(*) n FROM plan_entries').n, before);
}));

test('the daily job records a commitment as missed once its date is long past, and only then', () => withDemo(async ({ api, db }) => {
  const josh = api('j.workman');
  assert.strictEqual((await josh.post('/api/admin/daily')).body.missed, 0, 'Oct 7: the Sep 26 commitment is 11 days past, under the 14');
  await new Promise(r => setTimeout(r, 5));
  const t2 = await start({ demo: true, today: () => '2026-10-12' });
  try {
    const out = (await t2.api('j.workman').post('/api/admin/daily')).body;
    assert.strictEqual(out.missed, 1, 'Oct 12: Airfield\'s Sep 26 commitment is 16 days past');
    const page = (await t2.api('j.workman').get('/api/projects/2024-0207/plan')).body;
    assert.strictEqual(page.entries[0].kind, 'missed');
    assert.strictEqual(page.entries[0].author, null, 'recorded by the system, not by a person');
    assert.strictEqual((await t2.api('j.workman').post('/api/admin/daily')).body.missed, 0, 'once');
    // the last missed one leaves Airfield with no open commitment and no plan update coming
    assert.strictEqual(page.commitments.filter(c => c.status === 'missed').length, 2);
  } finally { await t2.close(); }
}));

test('the daily job prepares check-in drafts, never emails a PIC, and emails the admin one count', () => withDemo(async ({ api, mailer }) => {
  const josh = api('j.workman');
  // the demo seed already ran the daily job once on the demo day, so the queue starts with these two
  assert.strictEqual((await josh.get('/api/admin/checkins')).body.waiting.length, 2);
  const out = (await josh.post('/api/admin/daily')).body;
  assert.deepStrictEqual([out.created, out.emailed], [0, true], 'nothing new, but the admin has not yet been told today');

  const q = (await josh.get('/api/admin/checkins')).body;
  assert.deepStrictEqual(q.waiting.map(d => [d.pic.name, d.situation, d.step, d.tone, d.items.map(i => i.wbs1)]).sort(), [['Dana Whitfield', 'overdue', 1, 'casual', ['2025-0173']], ['Tom Lindqvist', 'overdue', 1, 'casual', ['2024-0207']]]);
  const tom = q.waiting.find(d => d.pic.name === 'Tom Lindqvist');
  assert.match(tom.body, /^Hey Tom, quick check on Airfield Maintenance Facility\./);
  assert.match(tom.body, /"Revised budget to owner" was due Sep 26/);
  assert.strictEqual(tom.pic.email, 'tom.lindqvist@example.test');
  assert.deepStrictEqual(q.escalate, [], 'nothing is 21 days overdue yet');

  assert.strictEqual(mailer.sent.length, 1, 'one email, to the admin');
  assert.deepStrictEqual(mailer.sent[0].to, ['josh.workman@example.test']);
  assert.match(mailer.sent[0].body, /^2 check-in drafts are waiting/);
  assert.match(mailer.sent[0].body, /#\/turnaround\/checkins/);
  const text = mailer.sent[0].subject + mailer.sent[0].body;
  for (const n of ['Tom', 'Dana', 'Airfield', 'Hangar', 'Lindqvist', 'Whitfield']) assert.ok(!text.includes(n), `the email must not mention ${n}`);
  assert.ok(mailer.sent.every(m => !m.to.some(a => /tom\.|dana\./.test(a))), 'nothing is addressed to a PIC');

  // repeating the job the same day changes nothing
  const again = (await josh.post('/api/admin/daily')).body;
  assert.deepStrictEqual([again.created, again.emailed], [0, false]);
  assert.strictEqual(mailer.sent.length, 1);
  assert.strictEqual((await api('d.whitfield').get('/api/admin/checkins')).status, 403, 'PICs never see the queue');
  assert.strictEqual((await api('d.whitfield').post('/api/admin/daily')).status, 403);
  assert.strictEqual((await josh.get('/api/me')).body.badges.checkins, 2);
  assert.strictEqual((await api('d.whitfield').get('/api/me')).body.badges, undefined);
}));

test('no email on a weekend', () => withDemo(async ({ api, mailer }) => {
  const out = (await api('j.workman').post('/api/admin/daily')).body;
  // by Oct 10 Airfield's Sep 26 commitment is 14 days past and is recorded as missed; the old draft is withdrawn and a new one,
  // about the next thing owed, takes its place. It is Saturday, so no email.
  assert.deepStrictEqual([out.missed, out.withdrawn, out.created, out.emailed], [1, 1, 1, false]);
  assert.strictEqual(mailer.sent.length, 0);
}, { today: () => '2026-10-10' })); // a Saturday

test('send, undo, dismiss and edit work on a draft; a dismissed one stays gone', () => withDemo(async ({ api }) => {
  const josh = api('j.workman');
  await josh.post('/api/admin/daily');
  let q = (await josh.get('/api/admin/checkins')).body;
  const d = q.waiting.find(x => x.pic.name === 'Dana Whitfield');
  assert.strictEqual((await josh.put(`/api/admin/checkins/${d.id}`, { subject: 'Hangar 7', body: 'Edited in Josh\'s words.' })).status, 200);
  assert.strictEqual((await josh.put(`/api/admin/checkins/${d.id}`, { subject: '', body: 'x' })).status, 400);

  q = (await josh.post(`/api/admin/checkins/${d.id}/send`)).body;
  assert.strictEqual(q.waiting.length, 1);
  assert.strictEqual(q.sent[0].body, 'Edited in Josh\'s words.');
  assert.strictEqual((await josh.post(`/api/admin/checkins/${d.id}/send`)).status, 409, 'already sent');
  assert.strictEqual((await josh.put(`/api/admin/checkins/${d.id}`, { subject: 'x', body: 'x' })).status, 409, 'only a waiting draft can be edited');

  q = (await josh.post(`/api/admin/checkins/${d.id}/undo`)).body;
  assert.strictEqual(q.waiting.length, 2, 'undo puts it back');
  q = (await josh.post(`/api/admin/checkins/${d.id}/dismiss`)).body;
  assert.strictEqual(q.dismissed.length, 1);
  await josh.post('/api/admin/daily');
  assert.strictEqual((await josh.get('/api/admin/checkins')).body.waiting.length, 1, 'dismissed does not come back');
  assert.strictEqual((await josh.post('/api/admin/checkins/nope/send')).status, 404);
  const audit = (await josh.get('/api/admin/audit')).body.map(e => e.action);
  assert.ok(audit.includes('checkin.send') && audit.includes('checkin.dismiss') && audit.includes('checkin.undo'));
}));

test('when the PIC deals with it, the waiting draft is withdrawn rather than sent', () => withDemo(async ({ api }) => {
  const josh = api('j.workman'); const dana = api('d.whitfield');
  await josh.post('/api/admin/daily');
  assert.strictEqual((await josh.get('/api/admin/checkins')).body.waiting.length, 2);
  const open = (await dana.get('/api/projects/2025-0173/plan')).body.commitments.find(c => c.status === 'open');
  await dana.post(`/api/projects/2025-0173/plan/commitments/${open.id}/done`, { body: 'Change order package sent to the owner.', actual: 9860 });
  const out = (await josh.post('/api/admin/daily')).body;
  assert.strictEqual(out.withdrawn, 1);
  const q = (await josh.get('/api/admin/checkins')).body;
  assert.deepStrictEqual(q.waiting.map(d => d.pic.name), ['Tom Lindqvist']);
}));

test('a PIC who just wrote something is left alone, and a project with no plan is reminded once its first-plan date passes', () => withDemo(async ({ api }) => {
  const josh = api('j.workman');
  // Tooele (Marcus) and Draper (Ben) have no plan. The first-plan window is a setting: shorten it and both are overdue for one.
  await josh.put('/api/admin/settings', { changes: { 'due.newProjectDays': 1 } });
  // Marcus writes on another project today, so he is left alone for now; Ben is not
  await api('m.oyelaran').post('/api/projects/2024-0356/plan/entries', { kind: 'update', body: 'Met the owner this morning.' });
  const out = (await josh.post('/api/admin/daily')).body;
  assert.strictEqual(out.created, 1);
  const waiting = (await josh.get('/api/admin/checkins')).body.waiting.filter(d => d.situation === 'no_plan');
  assert.deepStrictEqual(waiting.map(d => d.pic.name), ['Ben Okafor']);
  assert.match(waiting[0].body, /Draper Community Center is still without a plan|Draper Community Center landed on the Project Turnaround list at -\$12,780 YTD/);
}));

test('who sees each PIC\'s on-time and kept figures is an Admin switch; everyone always sees their own', () => withDemo(async ({ api }) => {
  const josh = api('j.workman');
  const rec = async who => (await api(who).get('/api/turnaround/current')).body.pics.filter(p => p.projects.length).map(p => [p.name, p.record !== null]);
  assert.ok((await rec('d.whitfield')).every(([, shown]) => shown), 'everyone, by default');
  await josh.put('/api/admin/settings', { changes: { 'visibility.picRecords': 'admin' } });
  assert.deepStrictEqual((await rec('d.whitfield')).filter(([, s]) => s).map(([n]) => n), ['Dana Whitfield'], 'a PIC sees only their own');
  assert.ok((await rec('m.hale')).every(([, shown]) => !shown), 'Finance sees none');
  assert.ok((await rec('j.workman')).every(([, shown]) => shown), 'the admin sees all');
  await josh.put('/api/admin/settings', { changes: { 'visibility.picRecords': 'principals' } });
  assert.ok((await rec('d.whitfield')).every(([, shown]) => shown), 'PICs are principals');
  assert.ok((await rec('m.hale')).every(([, shown]) => !shown));
}));

test('the record numbers come from the log: on time, kept, and a standing label', () => withDemo(async ({ api }) => {
  const o = (await api('j.workman').get('/api/turnaround/current')).body;
  const dana = o.pics.find(p => p.name === 'Dana Whitfield');
  assert.ok(dana.record.onTime.total >= 8 && dana.record.onTime.onTime <= dana.record.onTime.total);
  assert.deepStrictEqual([dana.record.kept.kept, dana.record.kept.resolved], [1, 2], 'the hours report was kept, the owner meeting was missed');
  assert.ok(['good', 'needs_attention', 'escalated'].includes(dana.record.standing));
  const tom = o.pics.find(p => p.name === 'Tom Lindqvist');
  assert.deepStrictEqual([tom.record.kept.kept, tom.record.kept.resolved], [0, 1]);
  assert.strictEqual(tom.projects.find(p => p.wbs1 === '2024-0207').earlierMissed, 1);
  const airfield = tom.projects.find(p => p.wbs1 === '2024-0207');
  assert.deepStrictEqual([airfield.next.pastDue, airfield.next.daysPastDue, airfield.next.text], [true, 11, 'Revised budget to owner']);
  assert.strictEqual(airfield.latest.text, 'Owner rejected the first revised budget. Waiting on our second version.');
}));

test('commitment patterns: the analysis on the demo year, and the Admin alone sees it', () => withDemo(async ({ api }) => {
  const r = await api('j.workman').get('/api/admin/patterns');
  assert.strictEqual(r.status, 200);
  const p = r.body;
  assert.strictEqual(p.year, 2026);
  assert.deepStrictEqual(p.years, [2026]);
  assert.strictEqual(p.total, 19);
  const rd = v => Math.round(v * 1000) / 1000;
  assert.deepStrictEqual([p.groups.money.made, p.groups.spend.made], [12, 7], 'bring in money 12, spend less 7');
  assert.deepStrictEqual([p.groups.money.resolved, p.groups.money.kept, p.groups.money.keptRate], [2, 0, 0], 'two money commitments resolved, both missed');
  assert.deepStrictEqual([p.groups.spend.resolved, p.groups.spend.kept, rd(p.groups.spend.keptRate)], [3, 2, 0.667]);
  const act = k => p.actions.find(a => a.lever === k);
  assert.deepStrictEqual([act('fee').made, act('hours').made, act('hours').kept, act('hours').unit], [6, 5, 2, 'hours']);
  assert.strictEqual(p.actions.length, 10);
  assert.deepStrictEqual([p.responsiveness.listed, p.responsiveness.withExplanation, p.responsiveness.withCommitment], [16, 14, 14]);
  assert.strictEqual(p.offList.cameOff, 0);
  assert.strictEqual(p.months.length, 12);
  assert.strictEqual(p.picNames.E101, 'Dana Whitfield');
  assert.strictEqual((await api('j.workman').get('/api/admin/patterns?year=2025')).body.total, 0, 'another year, nothing yet');
  for (const who of ['d.whitfield', 'm.hale', 'c.brandt', 'kent']) assert.strictEqual((await api(who).get('/api/admin/patterns')).status, 403, who);
}));

test('"Other": a fill-in-the-blank action in each group, kept for the Admin and never shown to a PIC', () => withDemo(async ({ api }) => {
  const dana = api('d.whitfield'); const josh = api('j.workman');
  const post = body => dana.post('/api/projects/2025-0412/plan/entries', Object.assign({ kind: 'commitment', body: 'Send the amendment', promisedBy: '2026-10-30', qty: 5000 }, body));
  assert.strictEqual((await post({ lever: 'other_money' })).status, 400, 'Other needs its few words');
  assert.strictEqual((await post({ lever: 'other_money', otherText: '   ' })).status, 400);
  assert.strictEqual((await post({ lever: 'other_money', otherText: 'x'.repeat(121) })).status, 400);
  assert.strictEqual((await post({ lever: 'other_money', otherText: 'Sell the model' })).status, 201);
  assert.strictEqual((await post({ lever: 'other_spend', otherText: 'Share a consultant with another job', qty: 1200 })).status, 201);
  assert.strictEqual((await post({ lever: 'fee', otherText: 'ignored for a named action' })).status, 201);

  const page = (await josh.get('/api/projects/2025-0412/plan')).body;
  const labels = page.commitments.map(c => c.leverLabel);
  assert.ok(labels.includes('Other: Sell the model') && labels.includes('Other: Share a consultant with another job'));
  assert.ok(labels.includes('Request additional services fee'), 'a named action keeps its own name');
  const asPic = JSON.stringify((await dana.get('/api/projects/2025-0412/plan')).body.commitments) + JSON.stringify((await dana.get('/api/projects/2025-0412/plan')).body.entries);
  assert.ok(!asPic.includes('Sell the model') && !asPic.includes('otherText'), 'the words stay with the Admin');

  const pat = (await josh.get('/api/admin/patterns')).body;
  assert.deepStrictEqual(pat.others.map(o => [o.text, o.group]), [['Sell the model', 'money'], ['Share a consultant with another job', 'spend']]);
  assert.strictEqual(pat.actions.find(a => a.lever === 'other_money').made, 1);
  assert.strictEqual(pat.actions.find(a => a.lever === 'other_spend').unit, 'dollars');
}));

test('settings that must agree with each other are checked together', () => withDemo(async ({ api }) => {
  const josh = api('j.workman');
  assert.strictEqual((await josh.put('/api/admin/settings', { changes: { 'ladder.reminder2Days': 2 } })).status, 400, 'reminder 2 cannot come before reminder 1');
  assert.strictEqual((await josh.put('/api/admin/settings', { changes: { 'standing.escalatedKept': 95 } })).status, 400);
  assert.strictEqual((await josh.put('/api/admin/settings', { changes: { 'ladder.reminder1Days': 2, 'ladder.reminder2Days': 8, 'ladder.escalateDays': 30 } })).status, 200);
}));

test('the run\'s charts are locked with the run', () => withDemo(async ({ db }) => {
  const id = db.get("SELECT id FROM runs WHERE status = 'published' ORDER BY period DESC").id;
  assert.throws(() => db.run('UPDATE run_history SET negative_ytd = 0 WHERE run_id = ?', id), /locked/);
  assert.throws(() => db.run('DELETE FROM run_history WHERE run_id = ?', id), /locked/);
  assert.throws(() => db.run('INSERT INTO run_project_history (run_id, wbs1, period, profit_ytd) VALUES (?, \'x\', 202609, 0)', id), /locked/);
  assert.throws(() => db.run('DELETE FROM run_project_history WHERE run_id = ?', id), /locked/);
}));

test('npm run seed works again after runs are published and plans written (the guard triggers do not block a reset)', () => withDemo(async ({ db }) => {
  assert.doesNotThrow(() => seed(db, { demo: true }));
  assert.strictEqual(db.get('SELECT COUNT(*) n FROM runs').n, 2);
  assert.strictEqual(db.get('SELECT COUNT(*) n FROM plan_entries').n, 55);
  assert.throws(() => db.run('DELETE FROM plan_entries'), /append-only/, 'the guards are back after the reset');
}));

test('"Just mine" has its own chart history: each PIC\'s months add up to the firm\'s, and end at their own card', () => withDemo(async ({ api, db }) => {
  const o = (await api('d.whitfield').get('/api/turnaround/current')).body;
  const dana = o.pics.find(p => p.name === 'Dana Whitfield');
  assert.strictEqual(dana.history.length, 12);
  const last = dana.history[11];
  assert.deepStrictEqual([last.period, last.negativeYtd, last.belowCount], [202609, dana.totals.profit, 4], 'the last month is exactly her card');
  assert.deepStrictEqual(dana.history.filter(h => h.lastYear).map(h => h.period), [202510, 202511, 202512]);
  assert.notDeepStrictEqual(dana.history.map(h => h.negativeYtd), o.history.map(h => h.negativeYtd), 'not the firm\'s line');
  o.history.forEach((firm, i) => {
    const h = p => p.history[i] || { negativeYtd: 0, belowCount: 0 }; // a PIC with nothing below break-even has no history
    assert.strictEqual(o.pics.reduce((s, p) => s + h(p).negativeYtd, 0), firm.negativeYtd, `month ${firm.period}: the PICs add up to the firm`);
    assert.strictEqual(o.pics.reduce((s, p) => s + h(p).belowCount, 0), firm.belowCount);
  });
  const id = db.get("SELECT id FROM runs WHERE status = 'published' ORDER BY period DESC").id;
  assert.throws(() => db.run('UPDATE run_pic_history SET negative_ytd = 0 WHERE run_id = ?', id), /locked/);
  assert.throws(() => db.run('DELETE FROM run_pic_history WHERE run_id = ?', id), /locked/);
}));

test('PICs are listed from the biggest total loss to the smallest', () => withDemo(async ({ api }) => {
  const o = (await api('j.workman').get('/api/turnaround/current')).body;
  const totals = o.pics.map(p => p.totals.profit);
  assert.deepStrictEqual(totals, totals.slice().sort((a, b) => a - b), 'most negative first');
  assert.deepStrictEqual(o.pics.map(p => p.name), ['Tom Lindqvist', 'Marcus Oyelaran', 'Dana Whitfield', 'Priya Raman', 'Elena Castellanos', 'Ben Okafor', 'Riley Chen']);
  // everyone gets the same order, and projects inside a PIC still go worst first
  assert.deepStrictEqual((await api('d.whitfield').get('/api/turnaround/current')).body.pics.map(p => p.name), o.pics.map(p => p.name));
  for (const p of o.pics) assert.deepStrictEqual(p.projects.map(x => x.profit.ytd), p.projects.map(x => x.profit.ytd).slice().sort((a, b) => a - b));
}));

test('a PIC with nothing below break-even is on the page, with no projects and no record', () => withDemo(async ({ api }) => {
  for (const who of ['j.workman', 'r.chen', 'd.whitfield']) {
    const o = (await api(who).get('/api/turnaround/current')).body;
    const riley = o.pics.find(p => p.name === 'Riley Chen');
    assert.ok(riley, who + ' can see her');
    assert.deepStrictEqual([riley.projects.length, riley.totals.profit, riley.record], [0, 0, null]);
    assert.strictEqual(riley.history[11].negativeYtd, 0, 'nothing below the line this month');
    assert.strictEqual(o.pics[o.pics.length - 1].name, 'Riley Chen', 'last, after everyone with a loss');
  }
  assert.strictEqual((await api('r.chen').get('/api/turnaround/current')).body.viewer.picCode, 'E108', 'so her page can say she is the one with nothing to fix');
  assert.strictEqual((await api('r.chen').get('/api/home')).body.yours.projects.length, 0);
}));
