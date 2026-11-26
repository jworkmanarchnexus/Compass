'use strict';
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic/layout');
const { CATALOG } = require('../logic/catalog');
const fx = require('./fixtures/layout.json');

const cat = fx.catalog;

test('default layout: the catalog order, on ones first, at their default sizes', () => {
  assert.deepStrictEqual(L.defaultLayout(cat), fx.defaultLayout);
});

test('normalize: any saved layout comes back safe to use', () => {
  for (const c of fx.normalize) assert.deepStrictEqual(L.normalize(c.saved, cat), c.expect, c.why);
});

test('pack: first-fit on 4, 2 and 1 columns; too-wide ones drawn at the grid width', () => {
  for (const c of fx.pack.cases) {
    const got = L.pack(fx.pack.layout, c.cols);
    assert.deepStrictEqual(got.cells, c.cells, `${c.cols} columns`);
    assert.strictEqual(got.rows, c.rows, `${c.cols} columns: rows`);
  }
  // the saved size is not changed by drawing it narrower
  assert.strictEqual(fx.pack.layout.items[0].w, 2);
});

test('pack: no two dashparts ever overlap, whatever the sizes', () => {
  const real = L.defaultLayout(CATALOG);
  real.items.forEach(i => { i.on = true; });
  for (const cols of [1, 2, 3, 4]) {
    const { cells } = L.pack(real, cols);
    const seen = new Set();
    for (const c of cells) for (let y = c.y; y < c.y + c.h; y++) for (let x = c.x; x < c.x + c.w; x++) {
      assert.ok(x < cols, `${c.id} past the right edge`);
      const k = x + ',' + y; assert.ok(!seen.has(k), `${c.id} overlaps at ${k} on ${cols} columns`); seen.add(k);
    }
  }
});

test('indexAt: where a drag over a cell asks to go', () => {
  for (const c of fx.pack.indexAt) assert.strictEqual(L.indexAt(L.pack(fx.pack.layout, c.cols), c.cx, c.cy), c.expect, c.why);
});

test('move: reorders the ones that are on; the tray is untouched', () => {
  const base = L.defaultLayout(cat);
  assert.deepStrictEqual(L.move(base, 'c', 0).items.map(i => i.id), ['c', 'a', 'b', 'd']);
  assert.deepStrictEqual(L.move(base, 'a', 99).items.map(i => i.id), ['b', 'c', 'a', 'd']);
  assert.strictEqual(L.move(base, 'd', 0), base, 'an off one cannot be moved in the grid');
});

test('resize: one cell at a time, never past the limits', () => {
  let l = L.defaultLayout(cat);
  assert.strictEqual(L.canResize(l, 'a', 'wider', cat), false, 'a is already at its widest');
  assert.strictEqual(L.resize(l, 'a', 'wider', cat), l);
  l = L.resize(l, 'a', 'narrower', cat);
  assert.deepStrictEqual(l.items[0], { id: 'a', w: 1, h: 1, on: true });
  assert.strictEqual(L.canResize(l, 'a', 'narrower', cat), false);
  l = L.resize(l, 'c', 'taller', cat);
  assert.strictEqual(l.items[2].h, 3);
  assert.strictEqual(L.canResize(l, 'c', 'taller', cat), false);
  assert.strictEqual(L.canResize(l, 'c', 'sideways', cat), false);
  assert.strictEqual(L.canResize(l, 'nope', 'wider', cat), false);
});

test('hide and show: off goes to the front of the tray, on comes back at the bottom at the size it had', () => {
  let l = L.resize(L.defaultLayout(cat), 'b', 'wider', cat);
  l = L.hide(l, 'b');
  assert.deepStrictEqual(l.items.map(i => [i.id, i.on]), [['a', true], ['c', true], ['b', false], ['d', false]]);
  l = L.show(l, 'd');
  assert.deepStrictEqual(l.items.map(i => [i.id, i.on]), [['a', true], ['c', true], ['d', true], ['b', false]]);
  l = L.show(l, 'b');
  assert.deepStrictEqual(l.items.find(i => i.id === 'b'), { id: 'b', w: 2, h: 1, on: true });
  assert.strictEqual(L.hide(l, 'zz'), l);
  assert.strictEqual(L.show(l, 'a'), l, 'already on');
});

test('columnsFor: 4 on a wide screen, 2 on a tablet, 1 on a phone', () => {
  for (const [px, cols] of fx.columnsFor) assert.strictEqual(L.columnsFor(px), cols, `${px}px`);
});

test('the real catalog: unique ids, defaults inside the limits, a clear title and blurb for each', () => {
  const ids = new Set();
  for (const c of CATALOG) {
    assert.ok(!ids.has(c.id), c.id + ' twice'); ids.add(c.id);
    assert.ok(c.minW >= 1 && c.minW <= c.maxW && c.maxW <= 4, c.id + ' width limits');
    assert.ok(c.minH >= 1 && c.minH <= c.maxH && c.maxH <= 3, c.id + ' height limits');
    assert.ok(c.w >= c.minW && c.w <= c.maxW && c.h >= c.minH && c.h <= c.maxH, c.id + ' default size');
    assert.ok(c.title && c.blurb, c.id + ' words');
  }
});

test('a drag into the gap really lands there: d moved before c fills the top right', () => {
  const l = L.move(fx.pack.layout, 'd', L.indexAt(L.pack(fx.pack.layout, 4), 3, 0));
  assert.deepStrictEqual(L.pack(l, 4).cells.find(c => c.id === 'd'), { id: 'd', x: 3, y: 0, w: 1, h: 1 });
});

test('the order always reads left to right, top to bottom', () => {
  const real = L.defaultLayout(CATALOG); real.items.forEach(i => { i.on = true; });
  for (const cols of [1, 2, 4]) {
    const cells = L.pack(real, cols).cells;
    for (let i = 1; i < cells.length; i++) assert.ok(cells[i].y > cells[i - 1].y || (cells[i].y === cells[i - 1].y && cells[i].x > cells[i - 1].x), `${cells[i].id} reads before ${cells[i - 1].id} on ${cols} columns`);
  }
});
