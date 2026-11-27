'use strict';
const test = require('node:test');
const assert = require('node:assert');
const A = require('../logic/accountability');
const fx = require('./fixtures/accountability.json');

test('to goal, shortfall and the projects it would take, on rows of the October 2026 sheet', () => {
  for (const c of fx.derive) {
    const d = A.derive(c.row, fx.sizes);
    assert.strictEqual(d.toGoal, c.expect.toGoal, c.name + ': to goal');
    assert.strictEqual(d.shortfall, c.expect.shortfall, c.name + ': shortfall');
    assert.deepStrictEqual(d.projects, c.expect.projects, c.name + ': projects');
    assert.strictEqual(d.profitPct === null ? null : Math.round(100 * d.profitPct), c.expect.profitPctRounded, c.name + ': profit %');
  }
});

test('the firm block: difference from project profit and profit on architectural revenue (the sheet says 20%)', () => {
  const f = A.firmFigures(fx.firm.meta, { profitYtd: fx.firm.totalProfitYtd });
  assert.strictEqual(f.difference, fx.firm.expect.difference);
  const lines = Object.fromEntries(A.sheet({ meta: { year: 2026, months: 10, cutoff: '2026-10-31', sizes: [], ...fx.firm.meta }, rows: [] }).firm);
  assert.strictEqual(lines['Profit on architectural revenue'], fx.firm.expect.profitOnArchText);
  assert.strictEqual(lines['YTD actual overhead rate'], fx.firm.expect.actualOh);
  assert.strictEqual(lines['Assigned overhead rate'], fx.firm.expect.assignedOh);
});

test('a firm figure the source does not have stays blank, and so does what depends on it', () => {
  const f = A.firmFigures({ archRevenue: 100 }, { profitYtd: 5 });
  assert.deepStrictEqual([f.incomeProfit, f.difference, f.profitOnArch, f.esopBonus], [null, null, null, null]);
});

test('rows: each PIC\'s columns, the order, the response rule, and Unassigned', () => {
  const rows = A.computeRows(fx.rows.input);
  const e = fx.rows.expect;
  assert.deepStrictEqual(rows.map(r => r.key), e.order);
  for (const key of e.order) for (const [k, v] of Object.entries(e[key])) assert.strictEqual(rows.find(r => r.key === key)[k], v, `${key || 'Unassigned'}: ${k}`);
  for (const [k, v] of Object.entries(e.total)) assert.strictEqual(A.totals(rows)[k], v, 'total: ' + k);
});

test('the PICs add up to the totals (nothing lost or counted twice)', () => {
  const rows = A.computeRows(fx.rows.input);
  const billed = fx.rows.input.projects.reduce((a, p) => a + p.billedYtd, 0);
  const ar = fx.rows.input.arOver90.reduce((a, x) => a + x.amount, 0);
  assert.strictEqual(A.totals(rows).billedYtd, billed);
  assert.strictEqual(A.totals(rows).arOver90, ar);
});

test('the CSV export: headings, a PIC, Totals, the pace line and the firm block, in the sheet\'s order', () => {
  const lines = A.toCsv(fx.csv.report).split('\r\n');
  assert.strictEqual(lines.pop(), '', 'ends with a line break');
  assert.deepStrictEqual(lines, fx.csv.expectLines);
});

test('money shows as the sheet shows it: whole dollars, losses in brackets, zero as $-', () => {
  assert.strictEqual(A.dollars(12345678), '$123,457');
  assert.strictEqual(A.dollars(-4659000), '($46,590)');
  assert.strictEqual(A.dollars(0), '$-');
  assert.strictEqual(A.dollars(null), '');
});
