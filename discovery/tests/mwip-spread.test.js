'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Dec = require('../lib/decimal');
const { spread, windowFrom } = require('../logic/mwip-spread');

const W = windowFrom(2026, 10, 12);
const total = m => [...m.values()].reduce((t, x) => t + x, 0n);

test('window: twelve months from October 2026', () => { assert.strictEqual(W[0], '2026-10'); assert.strictEqual(W[3], '2027-01'); assert.strictEqual(W[11], '2027-09'); });

test('months-even: equal pieces, pieces add back to the amount, nothing lost to rounding', () => {
  const m = spread(Dec.parse('1000'), '2026-11-01', '2027-01-31', W);
  assert.strictEqual(m.get('2026-11'), Dec.parse('333.33333333')); assert.strictEqual(m.get('2026-12'), Dec.parse('333.33333333'));
  assert.strictEqual(total(m), Dec.parse('1000'), 'last month takes the remainder');
  assert.strictEqual(m.get('2026-10'), 0n);
});

test('part of the range outside the window drops out; the rest is not rescaled', () => {
  const m = spread(Dec.parse('1200'), '2027-08-01', '2027-11-30', W); // 4 months, 2 inside
  assert.strictEqual(m.get('2027-08'), Dec.parse('300')); assert.strictEqual(m.get('2027-09'), Dec.parse('300'));
  assert.strictEqual(total(m), Dec.parse('600'));
  assert.strictEqual(total(spread(Dec.parse('500'), '2025-01-01', '2025-06-30', W)), 0n, 'entirely before the window');
});

test('days-even: pro rata by days, February handled, one-day range', () => {
  const m = spread(Dec.parse('590'), '2027-01-22', '2027-02-28', W, 'days-even'); // 10 days in Jan, 28 in Feb
  assert.strictEqual(m.get('2027-01'), Dec.mulDiv(Dec.parse('590'), 10n, 38n)); assert.strictEqual(total(m), Dec.parse('590'));
  assert.strictEqual(spread(Dec.parse('70'), '2026-12-15', '2026-12-15', W, 'days-even').get('2026-12'), Dec.parse('70'));
});

test('credits and bad input', () => {
  assert.strictEqual(total(spread(Dec.parse('-90'), '2026-10-01', '2026-12-31', W)), Dec.parse('-90'));
  assert.throws(() => spread(1n, '2026-12-01', '2026-10-01', W), /end before start/);
  assert.throws(() => spread(1n, '12/01/2026', '2026-12-31', W), /YYYY-MM-DD/);
  assert.throws(() => spread(1n, '2026-10-01', '2026-12-31', W, 'guess'), /unknown method/);
});

test('as-of decay: day 1 shows the whole month, each day removes 1/days, past months drop out', () => {
  const month = d => spread(Dec.parse('3000'), '2026-09-01', '2026-11-30', W, 'months-even', d).get('2026-10'); // 1000 a month
  assert.strictEqual(month('2026-10-01'), Dec.parse('1000'));
  assert.strictEqual(month('2026-10-02'), Dec.mulDiv(Dec.parse('1000'), 30n, 31n)); // day 2 of 31 days: 30/31 left
  assert.strictEqual(month('2026-10-16'), Dec.mulDiv(Dec.parse('1000'), 16n, 31n));
  assert.strictEqual(month('2026-10-31'), Dec.mulDiv(Dec.parse('1000'), 1n, 31n));
  const later = spread(Dec.parse('3000'), '2026-09-01', '2026-11-30', W, 'months-even', '2026-10-16');
  assert.strictEqual(later.get('2026-11'), Dec.parse('1000'), 'future months are whole');
  assert.strictEqual(spread(Dec.parse('3000'), '2026-09-01', '2026-11-30', W, 'months-even', '2026-11-05').get('2026-10'), 0n, 'a past month shows nothing');
  assert.strictEqual(spread(Dec.parse('3000'), '2026-09-01', '2026-11-30', W, 'months-even', '2026-10-16', 0).get('2026-10'), Dec.mulDiv(Dec.parse('1000'), 15n, 31n), 'alternative: remaining after today');
});
