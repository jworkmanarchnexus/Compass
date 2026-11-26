/* ===== Project Turnaround PDF: the page plan =====
   Pure: no DOM, no canvas, no network. Tested from tests/fixtures/export-plan.json.

   The drawing code (ui/export-draw.js) measures each block (wrapping text to the column widths) and hands the heights here.
   This file decides where the pages break. Rules (Josh, 2026-11-26):
     - a block is never split across pages (a project row, a PIC's header, the figures and chart);
     - a block marked keepWithNext (a PIC's header) never sits alone at the bottom of a page: it moves to the next page with its first row;
     - when a PIC's rows continue onto a new page, that page starts with a short repeat of the PIC's name and the column headings;
     - a block taller than a whole page is placed alone at the top of a page and flagged (tooTall), never dropped.
   Units are points. */
(function () {
'use strict';

const MARGIN = 30;   // page margin
const FOOT = 18;     // footer band
const GAP = 8;       // between blocks
const LOGO_PT = 54;  // 3/4 inch, as on the Marketing Report PDF
const LOGO_RATIO = 300 / 243;
const LOGO_CLEAR = 0.29;

const PAPER = {
  letter: { w: 612, h: 792, label: 'Letter, 8.5 x 11 in' },
  legal: { w: 612, h: 1008, label: 'Legal, 8.5 x 14 in' },
  tabloid: { w: 792, h: 1224, label: 'Tabloid, 11 x 17 in' },
};
const paperSize = (paper, orientation) => {
  const p = PAPER[paper] || PAPER.letter;
  return orientation === 'portrait' ? { w: p.w, h: p.h } : { w: p.h, h: p.w };
};

/* heading height in points: the title lines, any description lines, or the logo and its clear space, whichever is taller */
function headingHeights({ logo, descLines }) {
  const logoH = Math.ceil(LOGO_PT * LOGO_RATIO), clear = Math.ceil(LOGO_PT * LOGO_CLEAR);
  const text = 46 + (descLines || 0) * 13;
  const full = Math.max(text, logo !== 'none' ? logoH + clear : 0) + 6;
  const compact = logo === 'all' ? full : 34;
  return { full, compact, logoW: LOGO_PT, logoH, clear };
}

/* paginate({ blocks, first, later, gap, repeatH })
     blocks   [{ id, h, keepWithNext?, group? }] in order; rows of one PIC share a group; a group's first block is its header
     first    space for blocks on page 1 (points), later on the other pages
     repeatH  { [group]: height of the "continued" header that opens a page in the middle of that group }
   -> { pages: [{ items: [{ id, y, h, repeat? }], used }], tooTall: [ids] } */
function paginate({ blocks, first, later, gap, repeatH }) {
  const g = gap === undefined ? GAP : gap;
  const rep = repeatH || {};
  const pages = [];
  const tooTall = [];
  const started = new Set(); // groups whose header is already placed
  let cur = null;
  const open = () => { cur = { items: [], used: 0, avail: pages.length === 0 ? first : later }; pages.push(cur); };
  const put = (it) => { const y = cur.items.length ? cur.used + g : 0; cur.items.push({ ...it, y }); cur.used = y + it.h; };
  const room = h => (cur.items.length ? cur.used + g : 0) + h <= cur.avail + 1e-9;
  open();
  blocks.forEach((b, i) => {
    const next = blocks[i + 1];
    const together = b.keepWithNext && next ? b.h + g + next.h : b.h;
    // move to a new page when this block (with the block it must stay with) does not fit. An empty page keeps whatever comes,
    // except page 1, which gives way when the later pages (no heading) would hold the pair: a lone header there would break the rule.
    const canMove = cur.items.length > 0 || (pages.length === 1 && together <= later + 1e-9);
    if (canMove && (!room(b.h) || !room(together))) {
      open();
      if (b.group !== undefined && started.has(b.group) && rep[b.group]) put({ id: 'repeat:' + b.group, h: rep[b.group], repeat: b.group });
    }
    if (b.h > cur.avail + 1e-9) tooTall.push(b.id);
    put({ id: b.id, h: b.h });
    if (b.group !== undefined) started.add(b.group);
  });
  return { pages: pages.map(p => ({ items: p.items, used: p.used })), tooTall };
}

const api = { MARGIN, FOOT, GAP, PAPER, paperSize, headingHeights, paginate, LOGO_PT, LOGO_RATIO };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else if (typeof window !== 'undefined') window.TurnExportPlan = api;
})();
