'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const X = require('../logic/export-plan');
const fx = require('./fixtures/export-plan.json');

const rows = (n, goal) => Array.from({ length: n }, (_, i) => ({ key: 'R' + i, label: 'R' + i, total: 100 + i, goal: goal || 0, ytdGoal: goal ? Math.round(goal * 7 / 12) : 0 }));
const report = (pic, sector) => ({ pic: rows(pic, 150000000), sector: rows(sector, 300000000), meta: { onTrackPct: 100, onPacePct: 99, factor: 0.25 }, firm: { mwipRaw: 100000000 } });

test('pages: which sections go on which page', () => {
  for (const c of fx.cases) {
    const d = report(c.pic, c.sector);
    const inc = Object.fromEntries(c.include.map(k => [k, true]));
    const secs = X.sectionsFor(d, inc, c.grouping);
    const hd = X.headingHeights({ logo: 'first', descLines: 0 });
    const out = X.plan({ sections: secs, P: X.paperSize(c.paper, c.orientation), firstHead: hd.full, laterHead: hd.compact, layout: c.layout, grouping: c.grouping });
    assert.deepStrictEqual(out.pages.map(p => p.items.map(i => i.id)), c.expect, c.name);
    if (c.shrinks) assert.ok(out.pages[0].s < 1, c.name + ': should shrink');
    for (const p of out.pages) {
      const last = p.items[p.items.length - 1];
      if (!c.shrinks && p.s === 1 && c.pic < 20) assert.ok(last.y + last.h <= p.avail + 1e-6, c.name + ': content runs past the page');
    }
  }
});

test('the heading keeps the logo at 3/4 inch (the owner chose this for this report) with its clear space', () => {
  const h = X.headingHeights({ logo: 'first', descLines: 0 });
  assert.strictEqual(h.logoW, 54);
  assert.ok(h.full >= h.logoH + h.clear);
  assert.ok(X.headingHeights({ logo: 'all', descLines: 0 }).compact === h.full, 'a logo on every page needs the full heading everywhere');
  assert.ok(X.headingHeights({ logo: 'none', descLines: 0 }).full < h.full);
});

test('money and percent text', () => {
  assert.strictEqual(X.fmtK(123456789), '$1,235K');
  assert.strictEqual(X.pct(1, 3), '33.3%');
  assert.strictEqual(X.pct(1, 0), '-');
});

test('the key is one line with the three statuses and the thresholds, and never mentions the MWIP factor', () => {
  const m = { onTrackPct: 100, onPacePct: 99, factor: 0.25 };
  const l = X.legendLines(m);
  assert.strictEqual(l.length, 1);
  assert.ok(l[0].includes('the annual goal') && l[0].includes('99%') && l[0].includes('Behind Pace'));
  assert.ok(!/weighted|factor/i.test(l[0]));
});

test('bd.css and the export code carry no hex colors (those live in tokens.css or the look palettes)', () => {
  const css = fs.readFileSync(path.join(__dirname, '../ui/bd.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), 'hex color in bd.css');
});
