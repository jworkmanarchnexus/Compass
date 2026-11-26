/* ===== My dashboard: layout rules =====
   Pure: no DOM, clock or network. Tested from tests/fixtures/layout.json.

   A layout is { version: 1, items: [{ id, w, h, on }] }.
   - Order is the array order. Dashparts that are on fill the grid in that order; the ones that are off sit in the
     "Available" tray in that order.
   - Sizes are grid cells (w columns, h rows), always inside the catalog's min/max for that dashpart.
   - The grid is a fixed number of columns (4 on a wide screen, fewer on a narrow one). Packing keeps the order: each
     dashpart takes the first free spot, reading row by row, at or after the spot of the one before it. So the grid reads
     in the person's order, and a dashpart dragged after another really shows after it. A small dashpart never jumps
     back into a gap earlier in the grid; the person can drag one there. A dashpart wider than the grid is drawn at the
     grid's width (its saved size is kept). */
'use strict';

const VERSION = 1;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const byId = catalog => new Map(catalog.map(c => [c.id, c]));

function defaultLayout(catalog) {
  const on = catalog.filter(c => c.on), off = catalog.filter(c => !c.on);
  return { version: VERSION, items: on.concat(off).map(c => ({ id: c.id, w: c.w, h: c.h, on: !!c.on })) };
}

/* Makes any saved layout safe to use: unknown or repeated ids dropped, sizes forced inside the limits,
   and dashparts the person has never seen added to the end of the tray (off). Returns a new layout. */
function normalize(saved, catalog) {
  if (!saved || !Array.isArray(saved.items)) return defaultLayout(catalog);
  const cat = byId(catalog), seen = new Set(), items = [];
  for (const it of saved.items) {
    const c = it && cat.get(it.id);
    if (!c || seen.has(it.id)) continue;
    seen.add(it.id);
    items.push({ id: c.id, w: clamp(Math.round(Number(it.w)) || c.w, c.minW, c.maxW), h: clamp(Math.round(Number(it.h)) || c.h, c.minH, c.maxH), on: it.on === true });
  }
  for (const c of catalog) if (!seen.has(c.id)) items.push({ id: c.id, w: c.w, h: c.h, on: false });
  // the tray always sits after the grid: on first, then off, each keeping its order
  return { version: VERSION, items: items.filter(i => i.on).concat(items.filter(i => !i.on)) };
}

/* Places the dashparts that are on. Returns [{ id, x, y, w, h }] (0-based cells) and the number of rows used. */
function pack(layout, cols) {
  const filled = []; // filled[y][x] = true
  const free = (x, y, w, h) => {
    for (let r = y; r < y + h; r++) for (let c = x; c < x + w; c++) if (filled[r] && filled[r][c]) return false;
    return true;
  };
  const out = [];
  let rows = 0, cursor = { x: 0, y: 0 };
  for (const it of layout.items) {
    if (!it.on) continue;
    const w = Math.min(it.w, cols), h = it.h;
    let placed = null;
    for (let y = cursor.y; !placed; y++) for (let x = y === cursor.y ? cursor.x : 0; x + w <= cols; x++) if (free(x, y, w, h)) { placed = { x, y }; break; }
    cursor = placed;
    for (let r = placed.y; r < placed.y + h; r++) { filled[r] = filled[r] || []; for (let c = placed.x; c < placed.x + w; c++) filled[r][c] = true; }
    out.push({ id: it.id, x: placed.x, y: placed.y, w, h });
    rows = Math.max(rows, placed.y + h);
  }
  return { cells: out, rows };
}

const onIds = layout => layout.items.filter(i => i.on).map(i => i.id);

/* Moves a dashpart that is on to position `to` among the ones that are on (0 = first). */
function move(layout, id, to) {
  const on = layout.items.filter(i => i.on), off = layout.items.filter(i => !i.on);
  const from = on.findIndex(i => i.id === id);
  if (from < 0) return layout;
  const [it] = on.splice(from, 1);
  on.splice(clamp(to, 0, on.length), 0, it);
  return { version: VERSION, items: on.concat(off) };
}

/* While dragging: which position the pointer's cell (cx, cy) asks for. Over a dashpart = that dashpart's position.
   Over an empty cell = the position of the first dashpart after that cell in reading order, or the end. */
function indexAt(packed, cx, cy) {
  const { cells } = packed;
  const hit = cells.findIndex(c => cx >= c.x && cx < c.x + c.w && cy >= c.y && cy < c.y + c.h);
  if (hit >= 0) return hit;
  const after = cells.findIndex(c => c.y > cy || (c.y === cy && c.x > cx));
  return after < 0 ? cells.length - 1 : after;
}

const STEP = { wider: ['w', 1], narrower: ['w', -1], taller: ['h', 1], shorter: ['h', -1] };

function canResize(layout, id, dir, catalog) {
  const it = layout.items.find(i => i.id === id), c = byId(catalog).get(id), s = STEP[dir];
  if (!it || !c || !s) return false;
  const [k, d] = s, next = it[k] + d;
  return k === 'w' ? next >= c.minW && next <= c.maxW : next >= c.minH && next <= c.maxH;
}

/* dir: 'wider' | 'narrower' | 'taller' | 'shorter'. One cell at a time; a step past the limit changes nothing. */
function resize(layout, id, dir, catalog) {
  if (!canResize(layout, id, dir, catalog)) return layout;
  const [k, d] = STEP[dir];
  return { version: VERSION, items: layout.items.map(i => i.id === id ? Object.assign({}, i, { [k]: i[k] + d }) : i) };
}

/* Turning one off sends it to the front of the tray; turning one on puts it at the bottom of the grid at the size it had. */
function hide(layout, id) {
  const it = layout.items.find(i => i.id === id);
  if (!it || !it.on) return layout;
  const rest = layout.items.filter(i => i.id !== id);
  return { version: VERSION, items: rest.filter(i => i.on).concat([Object.assign({}, it, { on: false })], rest.filter(i => !i.on)) };
}
function show(layout, id) {
  const it = layout.items.find(i => i.id === id);
  if (!it || it.on) return layout;
  const rest = layout.items.filter(i => i.id !== id);
  return { version: VERSION, items: rest.filter(i => i.on).concat([Object.assign({}, it, { on: true })], rest.filter(i => !i.on)) };
}

/* the number of columns for a grid this many pixels wide (the browser asks; the rule lives here so a rebuild keeps it) */
function columnsFor(px) { return px >= 900 ? 4 : px >= 560 ? 2 : 1; }

const layoutApi = { VERSION, defaultLayout, normalize, pack, onIds, move, indexAt, canResize, resize, hide, show, columnsFor };
if (typeof module !== 'undefined' && module.exports) module.exports = layoutApi;
else if (typeof window !== 'undefined') window.CompassDashboard = Object.assign(window.CompassDashboard || {}, layoutApi);
