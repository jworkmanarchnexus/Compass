'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { DEFINITIONS, contractAmount, architecturalAmount } = require('../logic/architectural');
const fx = require('./fixtures/architectural.json');

test('every fixture case: the architectural share of a forecast month, and what is reported', () => {
  for (const c of fx.cases) {
    const got = architecturalAmount(c.row, c.definition);
    assert.deepStrictEqual(got, c.expect, c.name);
  }
});

test('the two definitions of the full contract amount', () => {
  const row = { fee: 70, consultFee: 30, reimbAllow: 10 };
  assert.deepStrictEqual(DEFINITIONS, ['feeConsult', 'feeConsultReimb']);
  assert.strictEqual(contractAmount(row, 'feeConsult'), 100);
  assert.strictEqual(contractAmount(row, 'feeConsultReimb'), 110);
  assert.strictEqual(contractAmount({}, 'feeConsult'), 0);
  assert.throws(() => contractAmount(row, 'guess'), /unknown/);
});

test('large amounts do not overflow (cents x cents)', () => {
  const r = architecturalAmount({ gross: 9e12, fee: 7e12, consultFee: 3e12, reimbAllow: 0 }, 'feeConsult');
  assert.strictEqual(r.amount, 6300000000000);
});
