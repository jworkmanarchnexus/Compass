/* ===== BD report PDF: the page plan =====
   Pure: no DOM, no canvas, no network. Decides how the report's sections (two tables, three charts) are laid on pages, so the
   preview and the PDF cut the pages in the same places, and so the rule can be tested (tests/fixtures/export-plan.json).

   Units. Sections are laid out in "design units": the table is 732 units wide on a landscape Letter page (1 unit = 1 pt there).
   A page then scales everything by z (paper width / 732) and, when a page is crowded, by s (shrink, never above 1).
   Heights below are in design units, so they do not depend on the paper. The heading, footer and margins are in points.

   Layout rule ("auto"): everything on one page if it fits without shrinking text below a readable size; otherwise the tables
   on the first page and the charts on the next (or, with grouping 'segment', the PIC table and charts, then the market sector's) (each group shrinks a little if that saves a page); a group that still does not
   fit flows onto more pages, section by section. "one" forces one page (shrinks to fit); "split" forces tables, then charts. */
(function () {
'use strict';

const BASE_W = 732;                       // design width of the content on landscape Letter
const MARGIN = 28;                        // page margin, points
const FOOT = 20;                          // footer band, points
const GAP = 12;                           // between sections, design units
const MIN_READ = 0.82;                    // smallest effective text scale (z * s) the plan will choose by itself
const LOGO_PT = 54;                       // 3/4 inch: Josh chose this for the BD report (the brand guide's usual minimum is 1 inch)
const LOGO_RATIO = 300 / 243;             // logo height / width
const LOGO_CLEAR = 0.29;                  // clear space as a share of the logo width

const PAPER = {
  letter: { w: 612, h: 792, label: 'Letter, 8.5 x 11 in' },
  tabloid: { w: 792, h: 1224, label: 'Tabloid, 11 x 17 in' },
  a4: { w: 595, h: 842, label: 'A4' },
  a3: { w: 842, h: 1191, label: 'A3' },
};
const paperSize = (paper, orientation) => {
  const p = PAPER[paper] || PAPER.letter;
  return orientation === 'portrait' ? { w: p.w, h: p.h } : { w: p.h, h: p.w };
};

/* section sizes, design units */
const T = { sum: 26, head: 38, row: 16, legendLine: 11, legendPad: 8 };
const C = { sum: 24, top: 8, row: 18, firmRow: 24, axis: 18, key: 18 };

/* "$1,234K" from cents */
const fmtK = cents => '$' + Math.round(cents / 100000).toLocaleString('en-US') + 'K';
const pct = (n, d) => (d ? (100 * n / d).toFixed(1) + '%' : '-');

/* the key under a table in the PDF: one line, the three statuses separated by a bar (the drawing shrinks the type if a narrow page needs it) */
function legendLines(meta) {
  return [[
    'On Track: YTD + forecast + MWIP reaches ' + (meta.onTrackPct === 100 ? 'the annual goal' : meta.onTrackPct + '% of the annual goal'),
    'On Pace: YTD billings at least ' + meta.onPacePct + '% of pace, but need more planned revenue',
    'Behind Pace: YTD billings behind pace',
  ].join('      |      ')];
}

const tableHeight = (nRows, legendN) => T.sum + T.head + (nRows + 1) * T.row + legendN * T.legendLine + T.legendPad;
const chartHeight = (nRows, firmChart) => C.sum + C.top + nRows * (firmChart ? C.firmRow : C.row) + C.axis + C.key;

/* which sections the report has, in order, for the options chosen. d is the report as the server sends it. */
function sectionsFor(d, inc, grouping) {
  const out = [];
  const lg = legendLines(d.meta).length;
  const charted = rows => rows.filter(r => r.total > 0).length;
  if (inc.picTable) out.push({ id: 'picTable', seg: 'pic', group: 'tables', h: tableHeight(d.pic.length, lg) });
  if (inc.sectorTable) out.push({ id: 'sectorTable', seg: 'sector', group: 'tables', h: tableHeight(d.sector.length, lg) });
  if (inc.firmChart) out.push({ id: 'firmChart', seg: 'pic', group: 'charts', h: chartHeight(2, true) });
  if (inc.picChart && charted(d.pic)) out.push({ id: 'picChart', seg: 'pic', group: 'charts', h: chartHeight(charted(d.pic), false) });
  if (inc.sectorChart && charted(d.sector)) out.push({ id: 'sectorChart', seg: 'sector', group: 'charts', h: chartHeight(charted(d.sector), false) });
  // by PIC then by market sector: the total-firm chart opens the PIC page; each page is its table, then its charts
  if (grouping === 'segment') { const rank = x => (x.seg === 'pic' ? 0 : 10) + (x.group === 'tables' ? 0 : x.id === 'firmChart' ? 1 : 2); out.sort((a, b) => rank(a) - rank(b)); }
  return out;
}

const sum = (list, f) => list.reduce((a, x) => a + f(x), 0);
const stackH = list => sum(list, x => x.h) + Math.max(0, list.length - 1) * GAP;

/* Place the sections on pages.
   plan({ sections, P: {w,h}, firstHead, laterHead, layout }) -> { z, pages: [{ s, head, avail, items: [{ id, y, h }], small }] }
   firstHead / laterHead are the heading heights in points (the first page carries the logo and the description). */
function plan({ sections, P, firstHead, laterHead, layout, grouping }) {
  const wc = P.w - 2 * MARGIN;
  const z = wc / BASE_W;
  const availOf = head => (P.h - 2 * MARGIN - head - FOOT) / z;       // design units
  const sMin = Math.min(1, MIN_READ / z);
  const sMinGroup = sMin - 0.12;                                      // one page of a group may shrink a little more than the whole report
  const aFirst = availOf(firstHead), aLater = availOf(laterHead);
  const place = (list, head, avail) => {
    const total = stackH(list);
    const s = Math.min(1, avail / total);
    let y = 0;
    const items = list.map(x => { const it = { id: x.id, y, h: x.h }; y += x.h + GAP; return it; });
    return { s, head, avail, items, small: s < sMinGroup - 1e-9 };
  };
  if (!sections.length) return { z, pages: [] };
  const mode = layout === 'one' || layout === 'split' ? layout : 'auto';
  if (mode === 'one') return { z, pages: [place(sections, firstHead, aFirst, true)] };
  const all = place(sections, firstHead, aFirst, false);
  if (mode === 'auto' && all.s >= sMin - 1e-9) return { z, pages: [all] };

  // each group on its own page (tables, then charts; or by PIC, then by market sector), shrinking a little before it spills over
  const key = grouping === 'segment' ? 'seg' : 'group';
  const groups = (grouping === 'segment' ? ['pic', 'sector'] : ['tables', 'charts']).map(g => sections.filter(x => x[key] === g)).filter(g => g.length);
  const pages = [];
  groups.forEach(list => {
    const head = pages.length ? laterHead : firstHead, avail = pages.length ? aLater : aFirst;
    const one = place(list, head, avail, false);
    if (one.s >= sMinGroup - 1e-9) { pages.push(one); return; }
    // flow: fill a page, start another when the next section does not fit
    let cur = [];
    const flush = () => { if (cur.length) { const hd = pages.length ? laterHead : firstHead; pages.push(place(cur, hd, pages.length ? aLater : aFirst, true)); cur = []; } };
    list.forEach(sec => {
      const hd = pages.length ? aLater : aFirst;
      if (cur.length && stackH(cur.concat(sec)) > hd) flush();
      cur.push(sec);
    });
    flush();
  });
  return { z, pages };
}

/* heading height in points: the logo (never under 1 inch) plus its clear space below, or just the text lines */
function headingHeights(O) {
  const logoW = LOGO_PT;
  const logoH = Math.ceil(logoW * LOGO_RATIO), clear = Math.ceil(logoW * LOGO_CLEAR);
  const text = 62;
  const full = Math.max(text + (O.descLines || 0) * 13, O.logo !== 'none' ? logoH + clear : 0) + 8;
  const compact = O.logo === 'all' ? full : 30;
  return { full, compact, logoW, logoH, clear };
}

const api = { BASE_W, MARGIN, FOOT, GAP, PAPER, paperSize, T, C, fmtK, pct, legendLines, tableHeight, chartHeight, sectionsFor, plan, headingHeights, LOGO_PT, LOGO_RATIO };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else if (typeof window !== 'undefined') window.BdExportPlan = api;
})();
