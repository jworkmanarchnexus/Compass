'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { burn } = require('../logic/burn');
const fx = require('./fixtures/burn.json');

const clone = o => JSON.parse(JSON.stringify(o));

test('fee burn: every fixture case', () => {
  for (const c of fx.cases) {
    const r = burn(c.projects, c.opts);
    for (const [k, v] of Object.entries(c.expect)) assert.deepStrictEqual(r[k], v, `${c.why} (${k})`);
  }
});

test('running totals never go down when the amounts are not negative', () => {
  for (const c of fx.cases) for (const w of ['year', 'full']) {
    const r = burn(c.projects, Object.assign({}, c.opts, { window: w }));
    for (const k of ['billed', 'spent']) r[k].forEach((v, i) => assert.ok(i === 0 || v >= r[k][i - 1], `${c.why} ${w} ${k}`));
  }
});

test("projected spend never depends on actual cost (a plan must not reveal anyone's pay)", () => {
  const c = fx.cases[0];
  const base = burn(c.projects, c.opts);
  const changed = clone(c.projects);
  changed[0].actuals.forEach(a => { a.labor *= 7; });
  changed[0].overheadPct = 300;
  const r = burn(changed, c.opts);
  const step = s => s.map((v, i) => v - (i ? s[i - 1] : 0));
  const k = base.lastActualIndex + 1;
  assert.deepStrictEqual(step(r.spent).slice(k), step(base.spent).slice(k), 'the projected months are the same');
  assert.notDeepStrictEqual(r.spent.slice(0, k), base.spent.slice(0, k), 'the actual months did change');
});

test('projected spend follows the Admin setting', () => {
  const c = fx.cases[0];
  const at = pct => { const r = burn(c.projects, Object.assign({}, c.opts, { projectedSpendPct: pct })); return r.atEnd.spent - r.toDate.spent; };
  assert.strictEqual(at(100), 450000, '30 planned hours at $150');
  assert.strictEqual(at(50), 225000);
});

test('the year window is always January to December of the current year', () => {
  const r = burn([], { window: 'year', current: '2026-11', lastClosed: '2026-10', projectedSpendPct: 85 });
  assert.strictEqual(r.months.length, 12);
  assert.deepStrictEqual([r.months[0], r.months[11], r.currentIndex, r.lastActualIndex], ['2026-01', '2026-12', 10, 9]);
  assert.deepStrictEqual([r.feeLine, r.atEnd.billed, r.spentPassesFee], [0, 0, null]);
});

test('bad input is refused, not guessed at', () => {
  const ok = { window: 'full', current: '2026-11', lastClosed: '2026-10', projectedSpendPct: 85 };
  const p = clone(fx.cases[0].projects);
  assert.throws(() => burn(p, Object.assign({}, ok, { window: 'ytd' })), /window/);
  assert.throws(() => burn(p, Object.assign({}, ok, { lastClosed: '2026-11' })), /before the current month/);
  assert.throws(() => burn(p, Object.assign({}, ok, { projectedSpendPct: 0 })), /projectedSpendPct/);
  assert.throws(() => burn(p, Object.assign({}, ok, { current: '2026-13' })), /current/);
  const badMoney = clone(p); badMoney[0].actuals[0].billed = 10.5;
  assert.throws(() => burn(badMoney, ok), /bad actual row/);
  const backwards = clone(p); backwards[0].end = '2026-01';
  assert.throws(() => burn(backwards, ok), /end is before start/);
});
