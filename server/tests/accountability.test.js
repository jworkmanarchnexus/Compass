'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { start } = require('./helpers');
const A = require('../../modules/accountability/logic/accountability');
const profitRule = require('../../modules/turnaround/logic/profit');
const { createLocalSource } = require('../vp-local');

async function withApp(fn, opts) { const t = await start(Object.assign({ today: () => '2026-10-07' }, opts)); try { await fn(t); } finally { await t.close(); } }
const demo = { demo: true };
const septId = async api => (await api('j.workman').get('/api/accountability/reports')).body.find(r => r.period === 202609).id;

test('who may read it: the Admin and Finance; not the Marketing director, PICs (even with the Marketing Report turned on) or the System admin', () => withApp(async ({ api }) => {
  const id = await septId(api);
  for (const who of ['j.workman', 'm.hale']) {
    assert.strictEqual((await api(who).get('/api/accountability/reports')).status, 200, who);
    assert.strictEqual((await api(who).get(`/api/accountability/reports/${id}`)).status, 200, who);
  }
  await api('j.workman').put('/api/admin/settings', { changes: { access: { marketingTurnaround: true, picBd: true, picPipeline: true, picAccountability: false } } });
  for (const who of ['c.brandt', 'd.whitfield', 'kent', 'a.ruiz', 'karen.acct']) {
    assert.strictEqual((await api(who).get('/api/accountability/reports')).status, 403, who);
    assert.strictEqual((await api(who).get(`/api/accountability/reports/${id}`)).status, 403, who);
  }
}, demo));

test('the September demo report: each PIC\'s columns, the order, the response to negative profit, and the firm figures', () => withApp(async ({ api }) => {
  const d = (await api('m.hale').get(`/api/accountability/reports/${await septId(api)}`)).body;
  assert.strictEqual(d.available, true);
  assert.deepStrictEqual(d.rows.map(r => r.label), ['Jordan Ames', 'Elena Castellanos', 'Riley Chen', 'Tom Lindqvist', 'Ben Okafor', 'Marcus Oyelaran', 'Priya Raman', 'Dana Whitfield', 'Unassigned'], 'the Admin\'s goal order, then Unassigned');
  const elena = d.rows.find(r => r.key === 'E105');
  assert.deepStrictEqual({ ...elena }, { key: 'E105', label: 'Elena Castellanos', goal: 100000000, billedYtd: 33853900, profitYtd: -4352000, negativeYtd: -4352000, unevaluated: 0, listed: 2,
    response: 'no', utilizationBp: 6900, backlog: 16000000, mwip: 9500000, arOver90: 2695000 });
  const jordan = d.rows.find(r => r.key === 'E107');
  assert.deepStrictEqual([jordan.goal, jordan.billedYtd, jordan.response, jordan.utilizationBp], [100000000, 0, null, 3400], 'a goal and nothing billed still gets a row; nothing on the Turnaround run is a dash, not No');
  const riley = d.rows.find(r => r.key === 'E108');
  assert.deepStrictEqual([riley.negativeYtd, riley.listed, riley.response], [0, 0, null], 'a profitable PIC has no negative profit and nothing listed');
  assert.deepStrictEqual({ year: d.meta.year, months: d.meta.months, cutoff: d.meta.cutoff, statusDay: d.meta.statusDay, goalTotal: d.meta.goalTotal, incomeProfit: d.meta.incomeProfit, actualOhBp: d.meta.actualOhBp },
    { year: 2026, months: 9, cutoff: '2026-09-30', statusDay: '2026-10-01', goalTotal: 800000000, incomeProfit: 23678000, actualOhBp: 25500 });
  // the architectural revenue is the Marketing Report's own firm YTD
  const bd = (await api('m.hale').get(`/api/bd/reports/${d.run.id}`)).body;
  assert.strictEqual(d.meta.archRevenue, bd.firm.ytd);
  // the MWIP for each PIC is the Marketing Report's weighted figure
  for (const p of bd.pic) assert.strictEqual(d.rows.find(r => r.key === p.key).mwip, p.mwip, 'MWIP ' + p.label);
}, demo));

test('billed and profit add up to the profit pull: every project counted once, under its PIC', () => withApp(async ({ api }) => {
  const d = (await api('j.workman').get(`/api/accountability/reports/${await septId(api)}`)).body;
  const pull = createLocalSource().load();
  const all = profitRule.computeProjects({ ...pull, runPeriod: 202609 });
  const t = A.totals(d.rows);
  assert.strictEqual(t.billedYtd, all.reduce((a, p) => a + p.billed.ytd, 0));
  assert.strictEqual(t.profitYtd, all.filter(p => p.evaluable).reduce((a, p) => a + p.profit.ytd, 0));
  assert.strictEqual(t.negativeYtd, all.filter(p => p.evaluable && p.profit.ytd < 0).reduce((a, p) => a + p.profit.ytd, 0));
}, demo));

test('it is locked with the published Marketing Report: the database refuses changes, and later goal changes do not move it', () => withApp(async ({ api, db }) => {
  const id = await septId(api);
  assert.throws(() => db.run("UPDATE acct_rows SET billed_ytd = 1 WHERE run_id = ?", id), /run is locked/);
  assert.throws(() => db.run("DELETE FROM acct_rows WHERE run_id = ?", id), /run is locked/);
  assert.throws(() => db.run("INSERT INTO acct_rows (run_id, key, label, billed_ytd, profit_ytd, negative_ytd, backlog, mwip, ar_over90) VALUES (?, 'X', 'X', 0, 0, 0, 0, 0, 0)", id), /run is locked/);
  assert.throws(() => db.run("UPDATE acct_meta SET income_profit = 1 WHERE run_id = ?", id), /run is locked/);
  const before = (await api('j.workman').get(`/api/accountability/reports/${id}`)).body;
  assert.strictEqual((await api('j.workman').put('/api/admin/accountability/goals', { year: 2026, pic: 'E101', amount: 5 })).status, 200);
  await api('j.workman').put('/api/admin/settings', { changes: { 'acct.projectSizes': [{ label: 'Small', fee: 50000 }] } });
  assert.deepStrictEqual((await api('j.workman').get(`/api/accountability/reports/${id}`)).body, before, 'a published report keeps the goals and sizes it was built with');
}, demo));

test('a draft is built with the Marketing Report draft, is the Admin\'s alone, and a rebuild picks up new goals and sizes', () => withApp(async ({ api }) => {
  const josh = api('j.workman');
  const made = (await josh.post('/api/admin/runs', { kind: 'bd', period: 202609 })).body;
  const d = (await josh.get(`/api/accountability/reports/${made.run.id}`)).body;
  assert.strictEqual(d.available, true);
  assert.strictEqual(d.run.status, 'draft');
  assert.ok(d.rows.every(r => r.response === null), 'no Project Turnaround run published yet: no response either way');
  assert.strictEqual(d.meta.hasTurnaround, false);
  assert.strictEqual((await api('m.hale').get(`/api/accountability/reports/${made.run.id}`)).status, 404, 'Finance cannot see a draft');
  assert.ok(!(await api('m.hale').get('/api/accountability/reports')).body.some(r => r.id === made.run.id));
  await josh.put('/api/admin/accountability/goals', { year: 2026, pic: 'E101', amount: 123400 });
  await josh.put('/api/admin/accountability/goals', { year: 2026, pic: 'E107', amount: null });
  await josh.put('/api/admin/settings', { changes: { 'acct.projectSizes': [{ label: 'Small', fee: 50000 }, { label: 'Big', fee: 900000 }] } });
  assert.strictEqual((await josh.post(`/api/admin/bd/runs/${made.run.id}/rebuild`)).status, 200);
  const r = (await josh.get(`/api/accountability/reports/${made.run.id}`)).body;
  assert.strictEqual(r.rows.find(x => x.key === 'E101').goal, 123400);
  assert.ok(!r.rows.some(x => x.key === 'E107'), 'no goal and nothing to show: no row');
  assert.deepStrictEqual(r.meta.sizes.map(s => s.label), ['Small', 'Big']);
  assert.strictEqual((await josh.post(`/api/admin/bd/runs/${made.run.id}/publish`)).status, 200);
  assert.strictEqual((await api('m.hale').get(`/api/accountability/reports/${made.run.id}`)).status, 200, 'published with the Marketing Report');
}));

test('a version built before Principal Accountability existed says so instead of showing nothing', () => withApp(async ({ api, db }) => {
  const josh = api('j.workman');
  const made = (await josh.post('/api/admin/runs', { kind: 'bd', period: 202609 })).body;
  db.run('DELETE FROM acct_rows WHERE run_id = ?', made.run.id); db.run('DELETE FROM acct_meta WHERE run_id = ?', made.run.id); // a draft may be changed
  const r = (await josh.get(`/api/accountability/reports/${made.run.id}`)).body;
  assert.strictEqual(r.available, false);
  assert.strictEqual(r.run.id, made.run.id);
}));

test('goals: only the Admin changes them, the System admin may read them, bad input is refused, and every change is audited', () => withApp(async ({ api, db }) => {
  for (const who of ['m.hale', 'd.whitfield', 'c.brandt', 'kent']) assert.strictEqual((await api(who).put('/api/admin/accountability/goals', { year: 2026, pic: 'E101', amount: 1 })).status, 403, who);
  for (const who of ['m.hale', 'd.whitfield', 'c.brandt']) assert.strictEqual((await api(who).get('/api/admin/accountability/goals')).status, 403, who);
  const g = (await api('kent').get('/api/admin/accountability/goals')).body;
  assert.strictEqual(g.goals.filter(x => x.year === 2026).length, 8);
  assert.ok(g.pics.some(p => p.code === 'E108'), 'every active PIC can be given a goal');
  const josh = api('j.workman');
  for (const bad of [{ year: 2026, pic: 'NOPE', amount: 1 }, { year: 2026, pic: 'E101', amount: -1 }, { year: 2026, pic: 'E101', amount: 1.5 }, { year: 1999, pic: 'E101', amount: 1 }]) {
    assert.strictEqual((await josh.put('/api/admin/accountability/goals', bad)).status, 400, JSON.stringify(bad));
  }
  assert.strictEqual((await josh.put('/api/admin/accountability/goals', { year: 2027, pic: 'E102', amount: 250000000 })).status, 200);
  const e = db.get("SELECT * FROM audit_log WHERE action = 'acct.goal' ORDER BY id DESC LIMIT 1");
  assert.deepStrictEqual(JSON.parse(e.detail_json), { from: null, to: 250000000 });
}));

test('project sizes are an Admin setting, checked before saving', () => withApp(async ({ api }) => {
  const josh = api('j.workman');
  for (const bad of [[], [{ label: '', fee: 150000 }], [{ label: 'X', fee: 10 }], [{ label: 'X', fee: 150000, extra: 1 }], 'big']) {
    assert.strictEqual((await josh.put('/api/admin/settings', { changes: { 'acct.projectSizes': bad } })).status, 400, JSON.stringify(bad));
  }
  assert.strictEqual((await josh.put('/api/admin/settings', { changes: { 'acct.projectSizes': [{ label: 'Projects $1M', fee: 75000 }] } })).status, 200);
}));

test('with "PICs can see Accountability" on, every PIC reads the published reports (every PIC\'s row), never a draft', () => withApp(async ({ api }) => {
  const id = await septId(api);
  assert.strictEqual((await api('d.whitfield').get(`/api/accountability/reports/${id}`)).status, 403, 'off by default');
  await api('j.workman').put('/api/admin/settings', { changes: { access: { marketingTurnaround: false, picBd: false, picPipeline: false, picAccountability: true } } });
  assert.strictEqual((await api('d.whitfield').get('/api/me')).body.areas.accountability, true);
  const d = (await api('d.whitfield').get(`/api/accountability/reports/${id}`)).body;
  assert.ok(d.rows.some(r => r.key === 'E104'), 'sees the other PICs too');
  assert.strictEqual((await api('c.brandt').get(`/api/accountability/reports/${id}`)).status, 403, 'the Marketing director still does not');
  const draft = (await api('j.workman').post('/api/admin/runs', { kind: 'bd', period: 202607 })).body;
  assert.ok(!(await api('d.whitfield').get('/api/accountability/reports')).body.some(r => r.id === draft.run.id));
  assert.strictEqual((await api('d.whitfield').get(`/api/accountability/reports/${draft.run.id}`)).status, 404);
}, demo));

test('an access value saved before the Accountability switch existed reads it as off', () => {
  const settings = require('../../shared/rules/settings');
  const v = settings.settingAt([{ key: 'access', value: { marketingTurnaround: true, picBd: true, picPipeline: false }, effectiveFrom: 1 }], 'access', 2);
  assert.deepStrictEqual(v, { marketingTurnaround: true, picBd: true, picPipeline: false, picAccountability: false });
});
