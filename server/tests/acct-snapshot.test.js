'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { toSnapshot } = require('../vp/acct-snapshot');
const acctSql = require('../vp/acct-statements');
const policy = require('../vp/policy');
const profitRule = require('../../modules/turnaround/logic/profit');
const { createSnapshotSource } = require('../vp-snapshot');

/* made-up rows in the shape the statements return (dollars, Vantagepoint column names) */
const ROWS = {
  projects: [
    { project: '2025001.00', name: 'Clinic', pic_code: 'E1', pm_code: 'P1', status: 'A', charge_type: 'R' },
    { project: '2025002.00', name: 'School', pic_code: 'E2', pm_code: 'P2', status: 'A', charge_type: 'R' },
    { project: '2024009.00', name: 'Closed job', pic_code: 'E1', pm_code: 'P1', status: 'I', charge_type: 'R' },
    { project: 'Z-OVERHEAD', name: 'Overhead', pic_code: '', pm_code: '', status: 'A', charge_type: 'H' },
    { project: '2025003.00', name: 'Idle', pic_code: 'E2', pm_code: 'P2', status: 'A', charge_type: 'R' },
  ],
  ledger: [
    { project: '2025001.00', period: 202601, billed: 1000, labor: 300, expenses: 50 },
    { project: '2025001.00', period: 202602, billed: 500.255, labor: 100, expenses: 0 },
    { project: '2025002.00', period: 202602, billed: 200, labor: 400, expenses: 10 },
    { project: '2024009.00', period: 202601, billed: 75, labor: 0, expenses: 0 },
    { project: 'Z-OVERHEAD', period: 202601, billed: 0, labor: 900, expenses: 0 },
    { project: '2025002.00', period: 202603, billed: 0, labor: 0, expenses: 0 },
  ],
  overhead: [{ project: '2025001.00', min_oh: 150, max_oh: 150 }, { project: '2025002.00', min_oh: 150, max_oh: 160 }, { project: '2024009.00', min_oh: 100, max_oh: 100 }],
  revenue: [{ project: '2025001.00', gross: 1500.25, consultant: 200 }, { project: '2025002.00', gross: 200, consultant: 200 }],
  forecast: [{ project: '2025001.00', start_date: '2026-03-02', end_date: '2026-03-31', amount: 999 }],
  holidays: [{ d: '2026-12-25' }, { d: '2026-12-25' }],
  pursuits: [{ project: 'A0001', name: 'Pursuit', pic_code: 'E2', stage: '01', revenue: 1000, weighted: 400, est_start: '2026-04-01', est_completion: '2026-12-31' }],
  principals: [{ code: 'E1', first_name: 'Ana', last_name: 'One' }],
};

test('the snapshot: the validated query\'s project filters, months in cents, and a count of what the filters left out', () => {
  const s = toSnapshot(ROWS, { period: 202603, pulledAt: '2026-04-02T12:00:00.000Z' });
  assert.deepStrictEqual(s.projects.map(p => p.wbs1), ['2025001.00', '2025002.00'], 'active, regular, not Z or J, and with activity this year');
  assert.deepStrictEqual(s.ledger.map(r => [r.wbs1, r.period, r.billed]), [['2025001.00', 202601, 100000], ['2025001.00', 202602, 50026], ['2025002.00', 202602, 20000]], 'cents; empty months dropped; left-out projects not in it');
  assert.deepStrictEqual(s.leftOut, { inactive: 1, 'not regular': 1 });
  assert.deepStrictEqual(s.overhead.map(o => o.wbs1), ['2025001.00', '2025002.00']);
  assert.deepStrictEqual(s.revenue, [{ wbs1: '2025001.00', period: 202603, amount: 130025 }], 'net of consultants; a zero is left out');
  assert.deepStrictEqual(s.holidays, ['2026-12-25']);
  assert.deepStrictEqual(s.pursuits[0], { id: 'A0001', name: 'Pursuit', pic: 'E2', stage: '01', estFee: 100000, weightedFee: 40000, estStart: '2026-04-01', estCompletion: '2026-12-31' });
  assert.deepStrictEqual(s.picProjects.map(p => p.wbs1), ['2025001.00', '2025002.00', '2024009.00', 'Z-OVERHEAD'], 'every project the pull mentions, for matching to a PIC (left out of billed and profit, but not unknown)');
});

test('profit from the snapshot is the validated query\'s arithmetic: billed - labor x (1 + overhead) - expenses; mixed rates are not evaluated', () => {
  const s = toSnapshot(ROWS, { period: 202603, pulledAt: 'x' });
  const out = profitRule.computeProjects({ projects: s.projects, ledger: s.ledger, overhead: s.overhead, runPeriod: 202603 });
  const clinic = out.find(p => p.wbs1 === '2025001.00');
  assert.strictEqual(clinic.billed.ytd, 150026);
  assert.strictEqual(clinic.profit.ytd, 150026 - Math.round(40000 * 2.5) - 5000);
  assert.strictEqual(out.find(p => p.wbs1 === '2025002.00').evaluable, false, '150 and 160: two rates, no profit invented');
});

test('every statement is one plain SELECT the connection policy accepts, on approved tables only', () => {
  const APPROVED = ['PR', 'EMMain', 'LD', 'LedgerAP', 'LedgerAR', 'LedgerEX', 'LedgerMisc', 'RPPlan', 'CA'];
  for (const [name, sql] of Object.entries(acctSql.statements(202610))) {
    assert.doesNotThrow(() => policy.assertReadOnlySql(sql), name);
    for (const t of sql.match(/dbo\.(\w+)/g)) assert.ok(APPROVED.includes(t.slice(4)), `${name}: ${t}`);
  }
  assert.throws(() => acctSql.statements(202613), /YYYYMM/);
});

test('live mode: Accountability reads its own pull, with its own profit rows; a month with no pull says how to make one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compass-snap-'));
  const src = createSnapshotSource({ dir });
  assert.throws(() => src.loadAccountability(202603), /npm run vp:pull-acct -- 202603/);
  fs.writeFileSync(path.join(dir, 'acct-202603-20260402T120000.json'), JSON.stringify(toSnapshot(ROWS, { period: 202603, pulledAt: 'x' })));
  fs.writeFileSync(path.join(dir, 'bd-202603-20260402T130000.json'), '{}'); // a Marketing Report pull is not read for Accountability
  const x = src.loadAccountability(202603);
  assert.deepStrictEqual(x.profit.projects.map(p => p.wbs1), ['2025001.00', '2025002.00', '2024009.00'], 'all jobs this year: the closed job counts; the overhead project does not');
  assert.ok(x.profit.ledger.some(r => r.wbs1 === '2024009.00') && !x.profit.ledger.some(r => r.wbs1 === 'Z-OVERHEAD'));
  assert.strictEqual(x.forecastEntries.length, 1);
});
