/* ===== Marketing Report PDF: the page plan =====
   Pure: no DOM, no canvas, no network. The report is always two pages (so the preview and the PDF agree, and so the rule can be tested
   from tests/fixtures/export-plan.json):
     page 1   the PIC table, the total-firm chart, the PIC chart
     page 2   the market sector table, the total-market chart, the market sector chart
   Nothing is optional and nothing is reordered. If a page's content is taller than the paper, the page shrinks to fit (it never flows onto
   a third page); the plan says so (small) when that shrinks the type below a readable size.

   Units. Sections are laid out in "design units": the table is 732 units wide on a landscape Letter page (1 unit = 1 pt there).
   A page then scales everything by z (paper width / 732) and, when it is crowded, by s (shrink, never above 1).
   Heights below are in design units, so they do not depend on the paper. The heading, footer and margins are in points. */
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
const C = { sum: 24, top: 8, row: 18, firmRow: 24, axis: 18, key: 18, gap: 9, goalRow: 14 };
const goalChart = () => (typeof module !== 'undefined' && module.exports ? require('./goal-chart') : window.BdGoalChart);

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
const chartHeight = (nRows, firmChart, groups) => C.sum + C.top + nRows * (firmChart ? C.firmRow : groups ? C.goalRow : C.row) + (groups || 0) * C.gap + C.axis + C.key;

const sum = (list, f) => list.reduce((x, y) => x + f(y), 0);
const stackH = list => sum(list, x => x.h) + Math.max(0, list.length - 1) * GAP;

/* the report's six sections, in page order. d is the report as the server sends it. */
function sectionsFor(d) {
  const lg = legendLines(d.meta).length;
  const G = goalChart();
  const shape = (rows, scope) => G.size(G.layout(rows, scope)); // { rows, groups }: bar rows and groups, counting each goal bar
  const ps = shape(d.pic, 'pic'), ss = shape(d.sector, 'sector');
  return [
    { id: 'picTable', seg: 'pic', h: tableHeight(d.pic.length, lg) },
    { id: 'firmChart', seg: 'pic', h: chartHeight(2, true) },
    { id: 'picChart', seg: 'pic', h: chartHeight(ps.rows, false, ps.groups) },
    { id: 'sectorTable', seg: 'sector', h: tableHeight(d.sector.length, lg) },
    { id: 'firmChartMarket', seg: 'sector', h: chartHeight(2, true) },
    { id: 'sectorChart', seg: 'sector', h: chartHeight(ss.rows, false, ss.groups) },
  ];
}

/* Place the sections: one page per report (PIC, then market sector), each shrunk if it must be to fit.
   plan({ sections, P: {w,h}, firstHead, laterHead }) -> { z, pages: [{ s, head, avail, items: [{ id, y, h }], small }] }
   firstHead / laterHead are the heading heights in points (the first page carries the logo and the description). */
function plan({ sections, P, firstHead, laterHead }) {
  const z = (P.w - 2 * MARGIN) / BASE_W;
  const sMin = Math.min(1, MIN_READ / z);
  const pages = ['pic', 'sector'].map(seg => sections.filter(x => x.seg === seg)).filter(list => list.length).map((list, i) => {
    const head = i === 0 ? firstHead : laterHead;
    const avail = (P.h - 2 * MARGIN - head - FOOT) / z; // design units
    const s = Math.min(1, avail / stackH(list));
    let y = 0;
    const items = list.map(x => { const it = { id: x.id, y, h: x.h }; y += x.h + GAP; return it; });
    return { s, head, avail, items, small: s < sMin - 1e-9 };
  });
  return { z, pages };
}

/* heading height in points: the logo (never under 1 inch) plus its clear space below, or just the text lines */
function headingHeights(O) {
  const logoW = LOGO_PT;
  const logoH = Math.ceil(logoW * LOGO_RATIO), clear = Math.ceil(logoW * LOGO_CLEAR);
  const text = 62;
  const full = Math.max(text + (O.descLines || 0) * 13, O.logo !== 'none' ? logoH + clear : 0) + 8;
  const compact = O.logo === 'all' ? full : 44; // the second page: the title and the "as of" line
  return { full, compact, logoW, logoH, clear };
}

const api = { BASE_W, MARGIN, FOOT, GAP, PAPER, paperSize, T, C, fmtK, pct, legendLines, tableHeight, chartHeight, sectionsFor, plan, headingHeights, LOGO_PT, LOGO_RATIO };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else if (typeof window !== 'undefined') window.BdExportPlan = api;
})();
