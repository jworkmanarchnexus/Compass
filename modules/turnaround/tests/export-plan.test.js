'use strict';
const test = require('node:test');
const assert = require('node:assert');
const X = require('../logic/export-plan');
const fx = require('./fixtures/export-plan.json');

for (const c of fx.cases) {
  test('PDF page breaks: ' + c.name, () => {
    const out = X.paginate({ blocks: c.blocks, first: c.first, later: c.later, gap: c.gap, repeatH: c.repeatH });
    assert.deepStrictEqual(out.pages.map(p => p.items.map(it => it.id)), c.pages);
    assert.deepStrictEqual(out.tooTall, c.tooTall);
    for (const p of out.pages) {
      let y = -Infinity;
      for (const it of p.items) { assert.ok(it.y > y, 'blocks go down the page in order'); y = it.y; }
    }
  });
}

test('PDF page breaks: blocks never overlap and respect the gap', () => {
  const blocks = Array.from({ length: 40 }, (_, i) => ({ id: 'r' + i, h: 20 + (i * 37) % 90, group: 'A' }));
  const out = X.paginate({ blocks, first: 300, later: 500, gap: 8, repeatH: { A: 18 } });
  for (const p of out.pages) for (let k = 1; k < p.items.length; k++) assert.strictEqual(p.items[k].y, p.items[k - 1].y + p.items[k - 1].h + 8);
  assert.deepStrictEqual(out.pages.flatMap(p => p.items.map(i => i.id)).filter(id => !id.startsWith('repeat:')), blocks.map(b => b.id), 'every row once, in order');
});

test('paper sizes and orientation', () => {
  assert.deepStrictEqual(X.paperSize('letter', 'landscape'), { w: 792, h: 612 });
  assert.deepStrictEqual(X.paperSize('legal', 'portrait'), { w: 612, h: 1008 });
  assert.deepStrictEqual(X.paperSize('nonsense', 'portrait'), { w: 612, h: 792 }, 'unknown paper falls back to Letter');
});

test('the heading makes room for the logo, or only for the text when there is no logo', () => {
  const withLogo = X.headingHeights({ logo: 'first', descLines: 0 });
  const noLogo = X.headingHeights({ logo: 'none', descLines: 0 });
  assert.ok(withLogo.full > noLogo.full);
  assert.strictEqual(withLogo.compact, 34, 'later pages are compact unless the logo is on every page');
  assert.strictEqual(X.headingHeights({ logo: 'all' }).compact, X.headingHeights({ logo: 'all' }).full);
  assert.ok(X.headingHeights({ logo: 'none', descLines: 4 }).full > noLogo.full, 'a description adds lines');
});
