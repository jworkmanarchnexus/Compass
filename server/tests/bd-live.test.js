'use strict';
/* Live mode for the Marketing Report: the fixed statements, rows -> snapshot, the snapshot source, the live setup, and a report built
   end to end from a snapshot. All data here is made up. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dbmod = require('../db/db');
const { statements } = require('../vp/bd-statements');
const { toSnapshot } = require('../vp/bd-snapshot');
const { assertReadOnlySql } = require('../vp/policy');
const { createSnapshotSource } = require('../vp-snapshot');
const { setupLive, checkConfig } = require('../live-setup');
const { createServer } = require('../app');

const rows = {
  revenue: [
    { project: '0000101.00 ', name: 'Made-up Clinic', pic_code: 'P01', pic: 'Doe, Pat', sector: 'Healthcare', gross: 100000.25, consultant: 30000.1 },
    { project: '0000102.00', name: 'Made-up Lab', pic_code: 'P02', pic: 'Roe, Sam', sector: 'Laboratory', gross: 50000, consultant: 0 },
    { project: '0000103.00', name: 'No PIC Project', pic_code: null, pic: ', ', sector: null, gross: 2000, consultant: 0 },
  ],
  forecast: [
    { project: '0000101.00', name: 'Made-up Clinic', pic_code: 'P01', pic: 'Doe, Pat', sector: 'Healthcare', fee: 70000, consult_fee: 30000, reimb_allow: 0, start_date: '2026-11-01', end_date: '2026-12-31', amount: 40000 },
    { project: '0000104.00', name: 'Made-up School', pic_code: 'P02', pic: 'Roe, Sam', sector: 'K-12 Education', fee: 50000, consult_fee: 0, reimb_allow: 0, start_date: '2026-12-01', end_date: '2026-12-31', amount: 10000 },
  ],
  holidays: [{ d: '2026-11-26' }, { d: '2026-11-27' }, { d: '2026-12-24' }, { d: '2026-12-25' }, { d: '2026-12-25' }],
  pursuits: [
    { project: 'Z000901.00', name: 'Made-up Pursuit', pic_code: 'P01', pic: 'Doe, Pat', sector: 'Civic', revenue: 100000, weighted: 50000, stage: '015', probability: 50, est_start: '2026-11-01', est_completion: '2026-12-31' },
    { project: 'Z000902.00', name: 'Awarded Pursuit', pic_code: 'P02', pic: 'Roe, Sam', sector: 'Civic', revenue: 100000, weighted: 90000, stage: '004', probability: 90, est_start: '2026-11-01', est_completion: '2026-12-31' },
  ],
  principals: [{ code: 'P01', first_name: 'Pat', last_name: 'Doe' }, { code: 'P02', first_name: 'Sam', last_name: 'Roe' }],
  // Vantagepoint's Consultants % inputs: the Clinic has spent 25% of its earned revenue on direct costs; the School has earned nothing yet;
  // the Lab has no forecast, so its row is not used
  toDate: [{ project: '0000101.00', direct_cost: 25000, earned: 100000 }, { project: '0000104.00', direct_cost: 0, earned: 0 }, { project: '0000102.00', direct_cost: 5, earned: 10 }],
};
const config = {
  goals: { 2026: { pic: [{ code: 'P01', amount: 1500000 }, { code: 'P02', amount: 1500000 }], sector: [{ name: 'Civic', amount: 1000000 }, { name: 'Healthcare', amount: 1500000 }, { name: 'K-12 Education', amount: 500000 }] } },
  sectors: [{ name: 'Civic' }, { name: 'Healthcare' }, { name: 'K-12 Education' }, { name: 'Laboratory', rollsInto: 'Healthcare', rollsUntil: '2026-12-31' }],
  mwipFactor: [{ effectiveFrom: '2026-01-01', factor: 0.65 }],
};

test('the statements: one plain SELECT each, the report month in the right places, a bad period refused', () => {
  const s = statements(202610);
  for (const [name, sql] of Object.entries(s)) assert.doesNotThrow(() => assertReadOnlySql(sql), name);
  assert.match(s.revenue, /Period BETWEEN 202601 AND 202610/);
  assert.match(s.forecast, /r\.EndDate >= '20261101' AND r\.StartDate < '20270101'/, 'forecast: after the report month through Dec 31');
  assert.match(statements(202612).forecast, /r\.EndDate >= '20270101' AND r\.StartDate < '20270101'/, 'December: nothing left');
  for (const bad of [202613, 202600, '202610; DROP', 2026]) assert.throws(() => statements(bad), /YYYYMM/);
});

test('rows become a snapshot: cents, revenue net of consultants, fees on forecast projects, ids trimmed, holidays once', () => {
  const s = toSnapshot(rows, { period: 202610, pulledAt: '2026-11-26T16:00:00.000Z' });
  assert.deepStrictEqual(s.revenue, [{ wbs1: '0000101.00', period: 202610, amount: 7000015 }, { wbs1: '0000102.00', period: 202610, amount: 5000000 }, { wbs1: '0000103.00', period: 202610, amount: 200000 }]);
  assert.deepStrictEqual(s.projects.find(p => p.wbs1 === '0000101.00'), { wbs1: '0000101.00', name: 'Made-up Clinic', principal: 'P01', sector: 'Healthcare', fee: 7000000, consultFee: 3000000, reimbAllow: 0, directCostToDate: 2500000, earnedToDate: 10000000 });
  assert.strictEqual('directCostToDate' in s.projects.find(p => p.wbs1 === '0000102.00'), false, 'only projects with a forecast carry the Consultants % inputs');
  assert.deepStrictEqual(s.projects.find(p => p.wbs1 === '0000103.00'), { wbs1: '0000103.00', name: 'No PIC Project', principal: '', sector: '' }, 'no PIC and no sector stay empty, never guessed');
  assert.deepStrictEqual(s.forecastEntries[1], { wbs1: '0000104.00', start: '2026-12-01', end: '2026-12-31', amount: 1000000 });
  assert.deepStrictEqual(s.pursuits[0], { id: 'Z000901.00', name: 'Made-up Pursuit', pic: 'P01', sector: 'Civic', stage: '015', estFee: 10000000, weightedFee: 5000000, estStart: '2026-11-01', estCompletion: '2026-12-31' });
  assert.deepStrictEqual(s.holidays, ['2026-11-26', '2026-11-27', '2026-12-24', '2026-12-25']);
  assert.deepStrictEqual(s.employees, [{ code: 'P01', firstName: 'Pat', lastName: 'Doe' }, { code: 'P02', firstName: 'Sam', lastName: 'Roe' }]);
});

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'compass-live-')); }

test('the snapshot source reads the latest pull for the month, and says plainly when there is none', () => {
  const dir = tmpDir();
  const src = createSnapshotSource({ dir });
  assert.throws(() => src.loadBd(202610), e => e.status === 409 && /npm run vp:pull-bd -- 202610/.test(e.message));
  const older = toSnapshot(rows, { period: 202610, pulledAt: '2026-11-25T10:00:00.000Z' });
  older.revenue = [];
  fs.writeFileSync(path.join(dir, 'bd-202610-20261125T100000.json'), JSON.stringify(older));
  fs.writeFileSync(path.join(dir, 'bd-202610-20261126T160000.json'), JSON.stringify(toSnapshot(rows, { period: 202610, pulledAt: '2026-11-26T16:00:00.000Z' })));
  const d = src.loadBd(202610);
  assert.strictEqual(d.revenue.length, 3, 'the later pull wins');
  assert.strictEqual(d.pulledAt, '2026-11-26T16:00:00.000Z');
  assert.ok(Array.isArray(src.load().projects), 'Project Turnaround still reads the made-up files');
});

test('live setup: real goals, sectors and the 0.65 factor replace the made-up ones; a bad config is refused', () => {
  assert.ok(checkConfig({ goals: {}, sectors: [], mwipFactor: [{ effectiveFrom: '2026-01-01', factor: 1.5 }] }).length >= 2);
  const db = dbmod.open(':memory:');
  setupLive(db, config);
  assert.deepStrictEqual(db.all('SELECT effective_from, factor_bp FROM bd_mwip_factor').map(r => [r.effective_from, r.factor_bp]), [['2026-01-01', 6500]]);
  assert.deepStrictEqual(db.all("SELECT key, amount FROM bd_goals WHERE scope = 'pic' ORDER BY sort").map(r => [r.key, r.amount]), [['P01', 150000000], ['P02', 150000000]]);
  assert.strictEqual(db.get("SELECT rolls_into FROM bd_sectors WHERE name = 'Laboratory'").rolls_into, 'Healthcare');
  assert.throws(() => db.run('DELETE FROM bd_mwip_factor'), /append-only/, 'the guard is back after the reset');
  assert.strictEqual(db.get('SELECT COUNT(*) AS n FROM runs').n, 0, 'no made-up reports');
});

test('end to end: a report built from a snapshot has the right YTD, forecast and MWIP, real PIC names, and says when the pull was', async () => {
  const dir = tmpDir();
  const snap = toSnapshot(rows, { period: 202610, pulledAt: '2026-11-26T16:00:00.000Z' });
  fs.writeFileSync(path.join(dir, 'bd-202610-20261126T160000.json'), JSON.stringify(snap));
  const db = dbmod.open(':memory:');
  setupLive(db, config, { snapshots: dir });
  const server = createServer(db, { source: createSnapshotSource({ dir }), today: () => '2026-11-26', mailer: { sendToAdmin() {} } });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  server.unref();
  try {
    const josh = db.get("SELECT id FROM users WHERE username = 'j.workman'").id;
    const call = async (method, p, body) => { const r = await fetch(`http://127.0.0.1:${server.address().port}${p}`, { method, headers: { 'x-compass-user': josh, 'content-type': 'application/json' }, body: body && JSON.stringify(body) }); return r.json(); };
    const built = await call('POST', '/api/admin/runs', { kind: 'bd', period: 202610 });
    const r = await call('GET', `/api/bd/reports/${built.run.id}`);
    assert.strictEqual(r.firm.ytd, 7000015 + 5000000 + 200000, 'YTD: every project, net of consultants');
    // forecast, with Vantagepoint's Consultants % (the default): Clinic Nov-Dec 40,000.00 x (1 - 25%) = 30,000.00 (the contract
    // split would say 30%); School Dec 10,000.00 x 100% (nothing earned yet: 0%) = 10,000.00
    assert.strictEqual(r.firm.forecast, 4000000);
    // MWIP: one pursuit counts (the awarded stage does not), 50,000 weighted, Nov and Dec are its whole span, x 0.65
    assert.strictEqual(r.firm.mwip, 3250000);
    const doe = r.pic.find(p => p.key === 'P01');
    assert.strictEqual(doe.label, 'Pat Doe', 'PIC names come from the pull');
    assert.ok(r.sector.find(s => s.key === 'Healthcare').ytd >= 7000015 + 5000000, 'Laboratory counted in Healthcare');
    assert.ok(r.notes.some(n => /^Vantagepoint data pulled Nov 26, 2026/.test(n)), r.notes.join(' | '));
  } finally { await new Promise(res => server.close(res)); }
});
