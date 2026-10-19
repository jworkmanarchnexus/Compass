'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { spread, remainingMonths, buildDetail } = require('../logic/drill');
const fx = require('./fixtures/drill.json');

test('spread: the parts add up to the total, to the cent', () => {
  for (const c of fx.spread) {
    const got = spread(c.total, c.weights);
    assert.deepStrictEqual(got, c.expect, c.name);
    if (c.weights.length) assert.strictEqual(got.reduce((a, b) => a + b, 0), c.total, c.name + ': adds up');
  }
});

test('the months after the billing cutoff', () => {
  for (const c of fx.remainingMonths) assert.deepStrictEqual(remainingMonths(c.period), c.expect, c.why || String(c.period));
});

test('drill-down lines: one per project, per remaining month, adding back to what the report counted', () => {
  const b = fx.buildDetail;
  const got = buildDetail(b);
  assert.deepStrictEqual(got, b.expect);
  // a project with no monthly shape from the source is spread evenly rather than lost
  const bare = buildDetail({ period: 202609, lines: [{ kind: 'forecast', id: 'Q', pic: '', sector: '', amount: 100 }], forecastMonths: [], mwipMonths: [], names: {} });
  assert.deepStrictEqual(bare.map(r => r.amount), [34, 33, 33]);
  assert.strictEqual(bare[0].name, 'Q', 'the id stands in for a missing name');
});
