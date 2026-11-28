'use strict';
const test = require('node:test');
const assert = require('node:assert');
const S = require('../logic/staffing');
const settings = require('../../../shared/rules/settings');
const fx = require('./fixtures/staffing.json');

const run = (over = {}) => S.project(Object.assign({}, fx.base, { overrides: {} }, over));

test('revenue becomes people: hours at the blended rate, split by the mix, over hours per person at each target', () => {
  const out = run();
  assert.deepStrictEqual(Object.fromEntries(out.levels.map(l => [l.id, l.rate])), fx.expect.levelRates);
  assert.strictEqual(out.blended, fx.expect.blended);
  assert.deepStrictEqual(out.rows, fx.expect.rows);
});

test('contracted and pipeline stay separate; months outside the window are left out', () => {
  const out = run();
  assert.strictEqual(out.rows.length, fx.base.months.length);
  assert.deepStrictEqual(out.rows[1].contracted, { a: 0, b: 0 }, 'the 202701 contracted row is outside the window');
  assert.deepStrictEqual(out.rows[0].pipeline, { a: 0, b: 0 });
});

test('a project with its own mix uses that mix and its own blended rate', () => {
  const out = run();
  assert.deepStrictEqual(out.customUsed, fx.expect.customUsed);
  const plain = run({ customMixes: {} });
  assert.deepStrictEqual(plain.customUsed, []);
  // P2 ($16,000) at the standard $130/h = 123.08 hours: a 61.54 h (1.23 FTE), b 61.54 h (0.62 FTE); with P1 a = 2.23, b = 1.12
  assert.deepStrictEqual(plain.rows[0].contracted, { a: 2.23, b: 1.12 });
});

test('capacity: people on staff by level; untracked categories are counted apart; an unassigned category is flagged', () => {
  const out = run();
  assert.deepStrictEqual(out.capacity, fx.expect.capacity);
  assert.deepStrictEqual(out.warnings, fx.expect.warnings);
});

test('the gap is people needed less people on staff, with and without the pipeline', () => {
  assert.deepStrictEqual(run().gaps, fx.expect.gaps);
});

test('rates: the latest in effect on the day, weighted by staff in each category; Admin overrides win', () => {
  for (const c of fx.rateCases) {
    const out = run({ at: c.at, overrides: c.overrides });
    assert.deepStrictEqual(Object.fromEntries(out.levels.map(l => [l.id, l.rate])), c.expect, c.name);
  }
  // nobody on staff in a level: a plain average of its categories
  const lr = S.levelRates([{ id: 'x', categories: ['1', '2'] }], { 1: 100, 2: 300 }, []);
  assert.strictEqual(lr.rates.x, 200);
});

test('a level with no rate cannot be priced: its work is reported, never guessed', () => {
  const out = run({ rates: fx.base.rates.filter(r => r.category !== '3') });
  assert.strictEqual(out.blended, null);
  assert.deepStrictEqual(out.warnings.filter(w => w.kind === 'noRate'), [{ kind: 'noRate', level: 'b', categories: ['3'] }]);
  assert.deepStrictEqual(out.warnings.find(w => w.kind === 'noBlend').ids, ['P1', 'Q1']);
  assert.deepStrictEqual(out.rows[0].contracted, { a: 2, b: 0 }, 'P2 has its own mix of level A only, so it is still priced');
});

test('months: the ones after today', () => {
  for (const c of fx.monthsAfter) assert.deepStrictEqual(S.monthsAfter(c.today, c.count), c.expect);
});

test('the Admin levels are checked before saving (a settings rule)', () => {
  for (const c of fx.checkLevels) assert.strictEqual(settings.staffingProblem(c.levels, c.untracked), c.expect, c.name);
  for (const c of fx.checkLevels) assert.strictEqual(settings.isValid('staffing.levels', c.levels), true, c.name + ': the shape itself is valid');
  assert.strictEqual(settings.crossCheck(settings.allAt([], 0)), null, 'the defaults pass');
  assert.strictEqual(settings.isValid('staffing.levels', [{ id: 'a', label: 'A', categories: ['x'], mix: 100, target: 85 }]), false, 'a category is a number');
  assert.strictEqual(settings.isValid('staffing.rateOverrides', { 16: 17500 }), true);
  assert.strictEqual(settings.isValid('staffing.rateOverrides', { 16: 175.5 }), false, 'rates are whole cents');
});
