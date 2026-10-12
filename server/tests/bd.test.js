'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { start } = require('./helpers');

async function withApp(fn, opts) { const t = await start(Object.assign({ today: () => '2026-10-07' }, opts)); try { await fn(t); } finally { await t.close(); } }
const demo = { demo: true };
const K = c => Math.round(c / 100000);
const rowK = r => [r.goal, r.ytdGoal, r.ytd, r.forecast, r.mwip, r.total].map(K);

test('the September report reproduces the mockup: every PIC and sector row, and its status', () => withApp(async ({ api }) => {
  const josh = api('j.workman');
  const list = (await josh.get('/api/bd/reports')).body;
  assert.deepStrictEqual(list.map(r => [r.label, r.status]), [['September 2026, version 1', 'published'], ['August 2026, version 1', 'published']]);
  const r = (await josh.get(`/api/bd/reports/${list[0].id}`)).body;
  assert.deepStrictEqual(rowK(r.firm), [12000, 9000, 8932, 1775, 1190, 11897]);
  assert.strictEqual(r.firm.status, 'on_pace');
  const pics = Object.fromEntries(r.pic.map(p => [p.label, [rowK(p), p.status]]));
  assert.deepStrictEqual(r.pic.map(p => p.label), ['Dana Whitfield', 'Marcus Oyelaran', 'Priya Raman', 'Tom Lindqvist', 'Elena Castellanos', 'Ben Okafor'], 'in the Admin goal order');
  assert.deepStrictEqual(pics['Dana Whitfield'], [[2400, 1800, 1742, 410, 380, 2532], 'on_track']);
  assert.deepStrictEqual(pics['Marcus Oyelaran'], [[2100, 1575, 1520, 330, 190, 2040], 'behind']);
  assert.deepStrictEqual(pics['Tom Lindqvist'], [[1800, 1350, 1365, 205, 115, 1685], 'on_pace']);
  assert.deepStrictEqual(pics['Elena Castellanos'], [[1500, 1125, 1085, 160, 95, 1340], 'behind']);
  const sec = Object.fromEntries(r.sector.map(p => [p.label, [rowK(p), p.status]]));
  assert.deepStrictEqual(r.sector.map(s => s.label), ['Healthcare', 'Civic', 'Federal and industrial', 'Commercial', 'Education', 'Other']);
  assert.deepStrictEqual(sec.Civic, [[2600, 1950, 2010, 395, 215, 2620], 'on_track']);
  assert.deepStrictEqual(sec['Federal and industrial'], [[2400, 1800, 1640, 360, 270, 2270], 'behind']);
  assert.deepStrictEqual(sec.Healthcare, [[3200, 2400, 2380, 480, 330, 3190], 'on_pace']);
  for (const col of ['ytd', 'forecast', 'mwip', 'total']) {
    assert.strictEqual(r.pic.reduce((s, p) => s + p[col], 0), r.firm[col], 'PICs add up to the firm: ' + col);
    assert.strictEqual(r.sector.reduce((s, p) => s + p[col], 0), r.firm[col], 'sectors add up to the firm: ' + col);
  }
  assert.deepStrictEqual(r.notes, ['Labs counted in Healthcare', 'Midvale Storage Pavilion: unassigned revenue went to Civic ($3,420)']);
  assert.deepStrictEqual([r.meta.months, r.meta.cutoff, r.meta.factor], [9, '2026-09-30', 0.67]);
  assert.deepStrictEqual([r.run.label, r.run.publishedBy, r.run.status], ['September 2026, version 1', 'Josh', 'published']);
}, demo));

test('weighted MWIP is the face value times the factor, so the raw amounts are bigger', () => withApp(async ({ api }) => {
  const josh = api('j.workman');
  const id = (await josh.get('/api/bd/reports')).body[0].id;
  const r = (await josh.get(`/api/bd/reports/${id}`)).body;
  assert.ok(Math.abs(r.firm.mwip - Math.round(r.firm.mwipRaw * 0.67)) < 100, 'weighted is 0.67 of raw, to the cent per pursuit');
  assert.ok(r.firm.mwipRaw > r.firm.mwip);
}, demo));

test('who may read the BD report, and what a PIC is not shown', () => withApp(async ({ api }) => {
  const id = (await api('j.workman').get('/api/bd/reports')).body[0].id;
  assert.strictEqual((await api('m.hale').get(`/api/bd/reports/${id}`)).status, 200, 'Finance');
  assert.strictEqual((await api('c.brandt').get(`/api/bd/reports/${id}`)).status, 200, 'Marketing director');
  assert.strictEqual((await api('d.whitfield').get('/api/bd/reports')).status, 403, 'PICs are off by default');
  assert.strictEqual((await api('kent').get('/api/bd/reports')).status, 403);
  assert.strictEqual((await api().get('/api/bd/reports')).status, 401);
  await api('j.workman').put('/api/admin/settings', { changes: { access: { marketingTurnaround: false, picBd: true, picPipeline: false } } });
  const pic = await api('d.whitfield').get(`/api/bd/reports/${id}`);
  assert.strictEqual(pic.status, 200);
  const text = JSON.stringify(pic.body);
  assert.ok(!text.includes('mwipRaw') && pic.body.meta.factor === undefined, 'the MWIP factor and raw amounts are not on PIC pages');
  assert.strictEqual(pic.body.warnings, undefined);
  const fin = (await api('m.hale').get(`/api/bd/reports/${id}`)).body;
  assert.strictEqual(fin.meta.factor, 0.67);
  assert.ok(fin.firm.mwipRaw > 0);
  assert.strictEqual(fin.warnings, undefined, 'warnings are the Admin only');
}, demo));

test('only the Admin builds, publishes or archives; drafts are invisible to everyone else', () => withApp(async ({ api }) => {
  const josh = api('j.workman');
  for (const who of ['m.hale', 'd.whitfield', 'kent', 'c.brandt']) {
    assert.strictEqual((await api(who).post('/api/admin/runs', { kind: 'bd', period: 202607 })).status, 403, who);
    assert.strictEqual((await api(who).put('/api/admin/bd/goals', { year: 2026, scope: 'pic', key: 'E101', amount: 1 })).status, 403, who);
    assert.strictEqual((await api(who).post('/api/admin/bd/factors', { effectiveFrom: '2027-01-01', factorBp: 7000 })).status, 403, who);
  }
  assert.strictEqual((await api('kent').get('/api/admin/bd/inputs')).status, 200, 'the system admin may read it');
  const made = await josh.post('/api/admin/runs', { kind: 'bd', period: 202607 });
  assert.strictEqual(made.status, 201);
  assert.strictEqual(made.body.run.status, 'draft');
  assert.ok(!(await api('m.hale').get('/api/bd/reports')).body.some(r => r.id === made.body.run.id), 'not in the Finance list');
  assert.strictEqual((await api('m.hale').get(`/api/bd/reports/${made.body.run.id}`)).status, 404);
  assert.ok((await josh.get('/api/bd/reports')).body.some(r => r.id === made.body.run.id && r.status === 'draft'));
  assert.strictEqual((await josh.post('/api/admin/runs', { kind: 'bd', period: 202607 })).status, 409, 'one live report a month');
  assert.strictEqual((await josh.post('/api/admin/runs', { kind: 'bd', period: 202610 })).status, 400, 'a month that has not closed');
}, demo));

test('revenue with no market sector stops publishing until the Admin picks one (the default rule)', () => withApp(async ({ api, db }) => {
  const josh = api('j.workman');
  const d = (await josh.post('/api/admin/runs', { kind: 'bd', period: 202609 })).body;
  assert.deepStrictEqual(d.warnings.map(w => [w.kind, w.amount]), [['no_sector', 342000]]);
  assert.match(d.warnings[0].detail, /Midvale Storage Pavilion: revenue with no market sector/);
  assert.ok(d.sector.some(s => s.label === 'Unassigned'), 'it shows as its own row so the totals still tie');
  assert.strictEqual(d.sector.reduce((s, r) => s + r.total, 0), d.firm.total);
  const refused = await josh.post(`/api/admin/bd/runs/${d.run.id}/publish`);
  assert.strictEqual(refused.status, 409);
  assert.match(refused.body.error, /no market sector/);

  const wbs1 = d.warnings[0].wbs1;
  assert.strictEqual((await josh.put('/api/admin/bd/overrides', { wbs1, sector: 'Nowhere' })).status, 400);
  assert.strictEqual((await josh.put('/api/admin/bd/overrides', { wbs1, sector: 'Civic' })).status, 200);
  const re = (await josh.post(`/api/admin/bd/runs/${d.run.id}/rebuild`)).body;
  assert.deepStrictEqual(re.warnings, []);
  assert.ok(!re.sector.some(s => s.label === 'Unassigned'));
  assert.ok(re.notes.some(n => /unassigned revenue went to Civic \(\$3,420\)/.test(n)));
  assert.strictEqual((await josh.post(`/api/admin/bd/runs/${d.run.id}/publish`)).status, 200);
  assert.strictEqual(db.get('SELECT status FROM runs WHERE id = ?', d.run.id).status, 'published');
}));

test('"put it in Other" lets it publish at once, and says so', () => withApp(async ({ api }) => {
  const josh = api('j.workman');
  await josh.put('/api/admin/settings', { changes: { 'bd.noSector': 'other' } });
  const d = (await josh.post('/api/admin/runs', { kind: 'bd', period: 202609 })).body;
  assert.deepStrictEqual(d.warnings, []);
  assert.ok(d.notes.some(n => /went to Other \(\$3,420\)/.test(n)));
  assert.strictEqual(d.sector.find(s => s.label === 'Other').ytd, 54100000 + 342000, 'the $541K of Other plus the $3,420');
  assert.strictEqual((await josh.post(`/api/admin/bd/runs/${d.run.id}/publish`)).status, 200);
}));

test('a published report is locked in the database; archive and rerun keeps the old one untouched', () => withApp(async ({ api, db }) => {
  const josh = api('j.workman');
  const id = (await josh.get('/api/bd/reports')).body[0].id;
  const before = JSON.stringify(db.all('SELECT * FROM bd_rows WHERE run_id = ? ORDER BY scope, key', id));
  assert.throws(() => db.run('UPDATE bd_rows SET ytd = 0 WHERE run_id = ?', id), /locked/);
  assert.throws(() => db.run('DELETE FROM bd_rows WHERE run_id = ?', id), /locked/);
  assert.throws(() => db.run("INSERT INTO bd_rows (run_id, scope, key, label, goal, ytd_goal, ytd, forecast, mwip_raw, mwip, total) VALUES (?, 'pic', 'x', 'x', 0, 0, 0, 0, 0, 0, 0)", id), /locked/);
  assert.throws(() => db.run('UPDATE bd_run_meta SET factor_bp = 1 WHERE run_id = ?', id), /locked/);
  assert.strictEqual((await josh.post(`/api/admin/bd/runs/${id}/rebuild`)).status, 409);
  assert.strictEqual((await josh.post(`/api/admin/bd/runs/${id}/publish`)).status, 409);
  assert.strictEqual((await josh.post(`/api/admin/bd/runs/${id}/archive`, { reason: 'Wrong cutoff', confirm: 'rerun' })).status, 400, 'the exact word RERUN');
  assert.strictEqual((await josh.post(`/api/admin/bd/runs/${id}/archive`, { reason: ' ', confirm: 'RERUN' })).status, 400, 'and a reason');
  const re = await josh.post(`/api/admin/bd/runs/${id}/archive`, { reason: 'Wrong cutoff', confirm: 'RERUN' });
  assert.strictEqual(re.status, 200);
  assert.deepStrictEqual([re.body.run.status, re.body.run.version], ['draft', 2]);
  assert.strictEqual(JSON.stringify(db.all('SELECT * FROM bd_rows WHERE run_id = ? ORDER BY scope, key', id)), before, 'the archived report holds exactly what it did');
  assert.strictEqual(db.get('SELECT archive_reason FROM runs WHERE id = ?', id).archive_reason, 'Wrong cutoff');
  // everyone else keeps seeing the last published report (August) until version 2 is published
  const fin = (await api('m.hale').get('/api/bd/reports')).body;
  assert.deepStrictEqual(fin.map(r => r.label), ['August 2026, version 1']);
}, demo));

test('the MWIP factor is effective-dated and append-only: a new one changes new reports, never old ones', () => withApp(async ({ api, db }) => {
  const josh = api('j.workman');
  const oldId = (await josh.get('/api/bd/reports')).body[0].id;
  const oldMwip = (await josh.get(`/api/bd/reports/${oldId}`)).body.firm.mwip;
  assert.strictEqual((await josh.post('/api/admin/bd/factors', { effectiveFrom: '2026-01-01', factorBp: 7000 })).status, 409, 'an existing date is never rewritten');
  assert.strictEqual((await josh.post('/api/admin/bd/factors', { effectiveFrom: 'soon', factorBp: 7000 })).status, 400);
  assert.strictEqual((await josh.post('/api/admin/bd/factors', { effectiveFrom: '2026-09-01', factorBp: 0 })).status, 400);
  assert.strictEqual((await josh.post('/api/admin/bd/factors', { effectiveFrom: '2026-09-15', factorBp: 8000 })).status, 201);
  assert.throws(() => db.run('UPDATE bd_mwip_factor SET factor_bp = 1'), /append-only/);
  assert.throws(() => db.run('DELETE FROM bd_mwip_factor'), /append-only/);
  assert.strictEqual((await josh.get(`/api/bd/reports/${oldId}`)).body.firm.mwip, oldMwip, 'the published September report keeps 0.67');
  const re = (await josh.post(`/api/admin/bd/runs/${oldId}/archive`, { reason: 'Factor test', confirm: 'RERUN' })).body;
  assert.strictEqual(re.meta.factor, 0.8);
  assert.ok(Math.abs(re.firm.mwip - Math.round(re.firm.mwipRaw * 0.8)) < 100, 'the rerun uses the factor in force at its cutoff');
  assert.ok(re.firm.mwip > oldMwip);
}, demo));

test('goals: an Admin edit changes the next report; bad input is refused; all of it is audited', () => withApp(async ({ api }) => {
  const josh = api('j.workman');
  const inputs = (await josh.get('/api/admin/bd/inputs')).body;
  assert.deepStrictEqual(inputs.years, [2026]);
  assert.strictEqual(inputs.goals.filter(g => g.scope === 'pic').length, 6);
  assert.strictEqual(inputs.goals.find(g => g.key === 'E101').amount, 240000000);
  assert.strictEqual(inputs.goals.find(g => g.key === 'E101').name, 'Dana Whitfield');
  assert.strictEqual((await josh.put('/api/admin/bd/goals', { year: 2026, scope: 'pic', key: 'E101', amount: -1 })).status, 400);
  assert.strictEqual((await josh.put('/api/admin/bd/goals', { year: 2026, scope: 'pic', key: 'E101', amount: 12.5 })).status, 400, 'whole cents');
  assert.strictEqual((await josh.put('/api/admin/bd/goals', { year: 2026, scope: 'pic', key: 'NOBODY', amount: 100 })).status, 400);
  assert.strictEqual((await josh.put('/api/admin/bd/goals', { year: 2026, scope: 'sector', key: 'Nowhere', amount: 100 })).status, 400);
  assert.strictEqual((await josh.put('/api/admin/bd/goals', { year: 2026, scope: 'pic', key: 'E101', amount: 250000000 })).status, 200);
  const d = (await josh.post('/api/admin/runs', { kind: 'bd', period: 202609 })).body;
  assert.strictEqual(d.pic.find(p => p.label === 'Dana Whitfield').goal, 250000000);
  assert.strictEqual(d.firm.goal, 1210000000, 'the firm goal is the PIC goals added up');
  await josh.put('/api/admin/bd/goals', { year: 2027, scope: 'pic', key: 'E101', amount: 100000000 });
  const log = (await josh.get('/api/admin/audit')).body.map(e => e.action);
  assert.ok(log.filter(a => a === 'bd.goal').length === 2 && log.includes('bd.build'));
}));

test('BD settings are validated, and a report records the thresholds it was built with', () => withApp(async ({ api }) => {
  const josh = api('j.workman');
  assert.strictEqual((await josh.put('/api/admin/settings', { changes: { 'bd.noSector': 'maybe' } })).status, 400);
  assert.strictEqual((await josh.put('/api/admin/settings', { changes: { 'bd.onPacePct': 101 } })).status, 400);
  await josh.put('/api/admin/settings', { changes: { 'bd.onPacePct': 90, 'bd.onTrackPct': 95 } });
  const id = (await josh.get('/api/bd/reports')).body[0].id;
  const old = (await josh.get(`/api/bd/reports/${id}`)).body;
  assert.deepStrictEqual([old.meta.onPacePct, old.meta.onTrackPct], [99, 100], 'the published report keeps its own');
  assert.strictEqual(old.firm.status, 'on_pace');
  const re = (await josh.post(`/api/admin/bd/runs/${id}/archive`, { reason: 'Looser thresholds', confirm: 'RERUN' })).body;
  assert.deepStrictEqual([re.meta.onPacePct, re.meta.onTrackPct], [90, 95]);
  assert.strictEqual(re.firm.status, 'on_track', '99.1% of goal clears a 95% bar');
}, demo));

test('Turnaround and BD runs stay out of each other\'s way', () => withApp(async ({ api }) => {
  const josh = api('j.workman');
  const bdId = (await josh.get('/api/bd/reports')).body[0].id;
  assert.strictEqual((await josh.get(`/api/admin/runs/${bdId}`)).status, 404, 'a BD report is not a Turnaround run');
  assert.strictEqual((await josh.post(`/api/admin/runs/${bdId}/publish`)).status, 404);
  const turn = (await josh.get('/api/turnaround/current')).body;
  assert.strictEqual(turn.run.period, 202609, 'the Turnaround page is unaffected by BD reports');
  const runs = (await josh.get('/api/admin/runs')).body;
  assert.deepStrictEqual(runs.filter(r => r.period === 202609).map(r => r.kind).sort(), ['bd', 'turnaround']);
  assert.strictEqual(runs.find(r => r.kind === 'bd' && r.period === 202609).projectCount, 6, 'six PICs');
  assert.strictEqual((await josh.post('/api/admin/runs', { period: 202607 })).status, 201);
  assert.strictEqual((await josh.post('/api/admin/runs', { kind: 'bd', period: 202607 })).status, 201);
}, demo));

test('the monthly email for a BD draft says how many projects need a sector, and names none', async () => {
  const mailer = { sent: [], sendToAdmin(m) { this.sent.push(m); } };
  const t = await start({ today: () => '2026-10-07', mailer });
  try {
    await t.api('j.workman').post('/api/admin/runs', { kind: 'bd', period: 202609 });
    assert.strictEqual(mailer.sent.length, 1);
    assert.match(mailer.sent[0].subject, /BD report draft ready: September 2026/);
    assert.match(mailer.sent[0].body, /1 project needs a market sector/);
    assert.match(mailer.sent[0].body, /#\/bd\//);
    assert.ok(!mailer.sent[0].body.includes('Midvale'), 'no project names in the email');
  } finally { await t.close(); }
});
