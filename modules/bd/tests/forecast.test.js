'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { computeForecast, spreadEntry } = require('../logic/forecast');
const fx = require('./fixtures/forecast.json');

test('every fixture case: plan entries by working days, months after the report month through December', () => {
  for (const c of fx.cases) {
    const got = computeForecast({ entries: c.entries, holidays: fx.holidays, period: c.period });
    assert.deepStrictEqual(got, c.expect, c.name);
  }
});

test('an entry always adds back to its whole amount, whatever its dates', () => {
  const hol = new Set();
  for (const [amt, s, e] of [[100, '2026-01-01', '2026-12-31'], [7, '2026-11-30', '2027-02-01'], [999999, '2026-02-27', '2026-03-02'], [-5000, '2026-03-02', '2026-04-30']]) {
    assert.strictEqual([...spreadEntry(amt, s, e, hol).values()].reduce((a, b) => a + b, 0), amt, `${amt} ${s} ${e}`);
  }
});
