'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { layout, size } = require('../logic/goal-chart');
const fx = require('./fixtures/goal-chart.json');

test('goal chart: one goal bar when every PIC has the same goal, pairs otherwise', () => {
  for (const c of fx.cases) {
    const got = layout(c.rows, c.scope);
    assert.strictEqual(got.mode, c.expect.mode, c.name);
    assert.deepStrictEqual(got.rows.map(r => r.key), c.expect.order, c.name + ' (order)');
    assert.deepStrictEqual(got.goal, c.expect.goal, c.name + ' (goal)');
  }
});

test('how many bar rows a chart needs', () => {
  const single = layout(fx.cases[0].rows, 'pic'), paired = layout(fx.cases[4].rows, 'sector');
  assert.deepStrictEqual(size(single), { rows: 4, groups: 1 }, 'a goal bar and three PICs, one gap after the goal bar');
  assert.deepStrictEqual(size(paired), { rows: 4, groups: 2 }, 'two sectors, two bars each');
});
