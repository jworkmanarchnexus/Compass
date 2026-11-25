'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { computeMwip, allocate, DEFAULT_OPTIONS } = require('../logic/mwip');
const fx = require('./fixtures/mwip.json');

test('every fixture case: which pursuits count, how much, and in which months', () => {
  for (const c of fx.cases) {
    const got = computeMwip({ pursuits: c.pursuits.map(k => fx.pursuits[k]), period: c.period, buildDate: c.buildDate, options: c.options });
    assert.strictEqual(got.asOf, c.expect.asOf, c.name + ': as of');
    assert.deepStrictEqual(got.months, c.expect.months, c.name + ': months');
    assert.deepStrictEqual(got.mwip.map(m => ({ id: m.id, amount: m.amount })), c.expect.mwip, c.name + ': amounts');
    assert.deepStrictEqual(got.leftOut, c.expect.leftOut, c.name + ': left out');
    if (c.expect.mwipMonths) assert.deepStrictEqual(got.mwipMonths, c.expect.mwipMonths, c.name + ': months of each pursuit');
    // the months of a pursuit always add up to its amount
    for (const m of got.mwip) assert.strictEqual(got.mwipMonths.filter(x => x.id === m.id).reduce((a, x) => a + x.amount, 0), m.amount, c.name);
  }
});

test('a pursuit keeps its name, PIC and sector', () => {
  const got = computeMwip({ pursuits: [fx.pursuits.nov], period: 202610, buildDate: '2026-11-05' });
  assert.deepStrictEqual(got.mwip[0], { id: 'Z1', name: 'All in November', pic: 'E1', sector: 'Civic', amount: 6000000 });
});

test('a spread always adds back to the whole fee', () => {
  for (const [amt, s, e] of [[100, '2026-01-01', '2026-12-31'], [999999, '2026-02-27', '2026-03-02'], [7, '2026-11-30', '2027-02-01']]) {
    assert.strictEqual(allocate(amt, s, e, 'spread').reduce((a, p) => a + p.amount, 0), amt);
  }
  assert.strictEqual(allocate(100, '2026-12-01', '2026-11-01', 'spread'), null, 'end before start is not guessed');
});

test('the defaults are what the owner decided, and unknown options are refused', () => {
  assert.deepStrictEqual(DEFAULT_OPTIONS, { basis: 'weighted', allocation: 'spread', period: 'monthly', start: 'afterReportMonth', through: 'yearEnd' });
  const base = { pursuits: [], period: 202610, buildDate: '2026-11-05' };
  assert.throws(() => computeMwip({ ...base, options: { allocation: 'closeDate' } }), /unknown allocation/);
  assert.throws(() => computeMwip({ ...base, options: { period: 'weekly' } }), /unknown period/);
  assert.throws(() => computeMwip({ ...base, options: { through: '0' } }), /unknown through/);
});
