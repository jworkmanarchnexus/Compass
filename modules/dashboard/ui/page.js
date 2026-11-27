/* My dashboards (PIC and PM): the page. Each person arranges the curated dashparts for themselves, per dashboard.
   View mode: the dashparts that are on, in their grid. "Customize" turns on edit mode:
   - the dashparts jiggle; drag one to move it and the others reshuffle as you go
   - the arrows on the right and bottom edges make it narrower, wider, shorter or taller, one grid cell at a time, within the
     limits Josh set; the dashpart redraws at the new size and a line says what it shows at that size
   - the x puts it away in "Available" at the bottom (dragging it onto "Available" does the same); + brings one back
   - Done saves for this person only; Cancel (or Escape) puts everything back; "Reset to default" starts over (saved on Done)
   The layout rules (packing, limits, order) are in ../logic/layout.js and tested there; this file only draws and listens. */
import { Dashboard } from '/shared/platform/index.js';
import { drawPart, partSays, partLink, setBurnContext } from './parts.js';
import { mountTabRow } from './tabs.js';
import { sampleProjects } from './burn-sample.js';

const D = window.CompassDashboard;
const clone = o => JSON.parse(JSON.stringify(o));
const sizeText = (w, h) => `${w} wide, ${h} tall`;
const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export async function renderDashboard(ctx, body, board) {
  const { h, T, icon, actions, banner, Session } = ctx;
  const me = Session.me();
  const data = await Dashboard.get(board);
  setBurnContext({ board, projectedSpendPct: data.burn && data.burn.projectedSpendPct });
  mountTabRow(ctx, body, { board, active: 'overview', projects: sampleProjects(board) });
  const catalog = data.catalog;
  const info = new Map(catalog.map(c => [c.id, c]));

  let layout = data.layout, before = null, editing = false, cols = 4;
  const tiles = new Map(); // id -> { el, body, says, size, btn: { wider, narrower, taller, shorter }, cell }

  const msg = h('div');
  const hint = h('div', { class: 'dash-hint', hidden: true },
    icon('info'), h('span', { text: 'Drag a dashpart to move it. The arrows on its edges change its size. The x puts it away in Available below; + brings it back. Nothing is saved until you click Done.' }));
  const grid = h('div', { class: 'dash-grid', role: 'list', 'aria-label': 'Your dashparts' });
  const empty = h('div', { class: 'dash-empty', hidden: true },
    h('strong', { text: 'Your dashboard is empty.' }), h('span', { text: ' Click Customize, then + on the dashparts you want.' }));
  const trayList = h('div', { class: 'dash-tray-list' });
  const tray = h('section', { class: 'dash-tray', hidden: true, 'aria-label': 'Available dashparts' },
    h('div', { class: 'dash-tray-head' }, h('h2', { text: 'Available' }), h('span', { class: 'muted', text: 'Turned off. Click + to add one to the bottom of your dashboard, or drag a dashpart here to put it away.' })),
    trayList);
  const dash = h('div', { class: 'dash' }, msg, hint, grid, empty, tray);
  body.append(dash);

  /* ---------- header buttons ---------- */
  const btnCustomize = h('button', { class: 'btn', type: 'button', onclick: () => startEdit() }, icon('sliders-horizontal'), h('span', { text: 'Customize' }));
  const btnReset = h('button', { class: 'btn quiet', type: 'button', title: 'Put back the starting set and sizes. Saved when you click Done.', onclick: () => { layout = D.defaultLayout(catalog); apply(); } }, icon('rotate-ccw'), h('span', { text: 'Reset to default' }));
  const btnCancel = h('button', { class: 'btn', type: 'button', onclick: () => stopEdit(false) }, h('span', { text: 'Cancel' }));
  const btnDone = h('button', { class: 'btn primary', type: 'button', onclick: () => stopEdit(true) }, icon('check'), h('span', { text: 'Done' }));
  const setActions = () => actions(body, ...(editing ? [btnReset, btnCancel, btnDone] : [btnCustomize]));

  /* ---------- one tile per dashpart that is on ---------- */
  function makeTile(id) {
    const c = info.get(id);
    const link = partLink(id, board);
    const resizeBtn = (dir, ico, label) => h('button', { class: 'dp-arrow ' + dir, type: 'button', 'aria-label': `${label}: ${c.title}`,
      onclick: () => { layout = D.resize(layout, id, dir, catalog); apply(); },
      onmouseenter: e => previewSays(id, dir, e.currentTarget), onmouseleave: () => previewSays(id, null), onfocus: e => previewSays(id, dir, e.currentTarget), onblur: () => previewSays(id, null) }, icon(ico, 14));
    const btn = { narrower: resizeBtn('narrower', 'chevron-left', 'Narrower'), wider: resizeBtn('wider', 'chevron-right', 'Wider'),
      shorter: resizeBtn('shorter', 'chevron-down', 'Shorter'), taller: resizeBtn('taller', 'chevron-down', 'Taller') };
    const bodyEl = h('div', { class: 'dp-body' });
    const says = h('p', { class: 'dp-says' });
    const size = h('span', { class: 'dp-size' });
    const el = h('div', { class: 'dp', role: 'listitem', 'data-id': id },
      h('section', { class: 'dp-in', 'aria-label': c.title },
        h('header', { class: 'dp-head' },
          h('h2', { text: c.title }),
          link && (!link.area || me.areas[link.area]) ? h('a', { class: 'dp-open', href: link.href, title: link && !link.area ? 'Open the tab with the detail' : 'Open the full page', 'aria-label': `Open ${c.title}` }, icon('arrow-right', 15)) : null),
        bodyEl,
        h('button', { class: 'dp-x', type: 'button', title: 'Put away', 'aria-label': `Put away: ${c.title}`, onclick: () => { layout = D.hide(layout, id); apply(); } }, icon('x', 13)),
        h('div', { class: 'dp-foot' }, size, says),
        h('div', { class: 'dp-rz e' }, btn.narrower, btn.wider),
        h('div', { class: 'dp-rz s' }, btn.shorter, btn.taller)));
    el.style.setProperty('--jd', (-Math.random() * .4).toFixed(2) + 's');
    el.addEventListener('keydown', e => onTileKey(e, id));
    const t = { el, body: bodyEl, says, size, btn, cell: null, drawn: '' };
    // redraw whenever its pixel size changes (a resize, a column change, the side bar opening)
    t.ro = new ResizeObserver(() => draw(t, id));
    t.ro.observe(bodyEl);
    tiles.set(id, t);
    return t;
  }
  function draw(t, id) {
    if (!t.cell) return;
    const px = Math.floor(t.body.clientWidth), py = Math.floor(t.body.clientHeight);
    if (px < 20 || py < 20) return;
    const key = [t.cell.w, t.cell.h, px, py].join();
    if (key === t.drawn) return;
    t.drawn = key;
    drawPart(t.body, id, { w: t.cell.w, h: t.cell.h, px, py });
  }
  function previewSays(id, dir, btnEl) {
    const t = tiles.get(id);
    if (!t || !t.cell) return;
    if (!dir || (btnEl && btnEl.disabled)) { t.says.textContent = partSays(id, t.cell.w, t.cell.h); t.says.classList.remove('next'); return; }
    const w = t.cell.w + (dir === 'wider' ? 1 : dir === 'narrower' ? -1 : 0), hh = t.cell.h + (dir === 'taller' ? 1 : dir === 'shorter' ? -1 : 0);
    t.says.textContent = `${dir[0].toUpperCase() + dir.slice(1)}: ${partSays(id, w, hh)}`;
    t.says.classList.add('next');
  }

  /* ---------- draw the grid and the tray from the layout ---------- */
  function apply(opts) {
    const animate = !(opts && opts.animate === false) && !reduceMotion();
    const first = animate ? new Map([...tiles].map(([id, t]) => [id, t.el.getBoundingClientRect()])) : null;
    const packed = D.pack(layout, cols);
    const keep = new Set();
    for (const cell of packed.cells) {
      const t = tiles.get(cell.id) || makeTile(cell.id);
      const item = layout.items.find(i => i.id === cell.id);
      keep.add(cell.id);
      t.cell = cell;
      t.el.style.gridColumn = `${cell.x + 1} / span ${cell.w}`;
      t.el.style.gridRow = `${cell.y + 1} / span ${cell.h}`;
      t.el.dataset.w = cell.w; t.el.dataset.h = cell.h;
      t.size.textContent = `${cell.w} × ${cell.h}`;
      t.size.title = item.w > cell.w ? `${sizeText(item.w, item.h)}; shown ${cell.w} wide on a screen this narrow` : sizeText(cell.w, cell.h);
      t.says.textContent = t.says.title = partSays(cell.id, cell.w, cell.h); t.says.classList.remove("next");
      t.btn.wider.disabled = !D.canResize(layout, cell.id, 'wider', catalog) || item.w >= cols;
      t.btn.narrower.disabled = !D.canResize(layout, cell.id, 'narrower', catalog);
      t.btn.taller.disabled = !D.canResize(layout, cell.id, 'taller', catalog);
      t.btn.shorter.disabled = !D.canResize(layout, cell.id, 'shorter', catalog);
      t.el.tabIndex = editing ? 0 : -1;
      grid.append(t.el); // DOM order = layout order, so Tab follows the grid
      draw(t, cell.id);
    }
    for (const [id, t] of tiles) if (!keep.has(id)) { t.ro.disconnect(); t.el.remove(); tiles.delete(id); }
    empty.hidden = packed.cells.length > 0;
    drawTray();
    T.hydrateIcons(dash);
    if (first) for (const [id, t] of tiles) {
      const a = first.get(id); if (!a || t.el.classList.contains('placeholder')) continue;
      const b = t.el.getBoundingClientRect(), dx = a.left - b.left, dy = a.top - b.top;
      if (Math.abs(dx) + Math.abs(dy) < 1) continue;
      t.el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 240, easing: 'cubic-bezier(.2,.7,.3,1)' });
    }
  }

  function drawTray() {
    const off = layout.items.filter(i => !i.on);
    trayList.replaceChildren(...off.map(i => {
      const c = info.get(i.id);
      const thumb = h('div', { class: 'dp-thumb', 'aria-hidden': 'true' });
      const card = h('div', { class: 'dp-off', 'data-id': i.id },
        h('button', { class: 'dp-plus', type: 'button', title: 'Add to my dashboard', 'aria-label': `Add: ${c.title}`, onclick: () => add(i.id) }, icon('plus', 14)),
        h('div', { class: 'dp-off-head' }, h('strong', { text: c.title }), h('span', { class: 'dp-size', text: `${i.w} × ${i.h}` })),
        thumb,
        h('p', { class: 'muted', text: c.blurb }));
      // a small, faded preview of what it draws, at the size it will come back at
      requestAnimationFrame(() => drawPart(thumb, i.id, { w: i.w, h: i.h, px: thumb.clientWidth || 220, py: thumb.clientHeight || 84 }));
      return card;
    }));
    trayList.append(h('div', { class: 'dp-off-none', hidden: off.length > 0, text: 'Everything is on your dashboard.' }));
  }
  function add(id) {
    layout = D.show(layout, id); apply();
    const t = tiles.get(id);
    if (t) { t.el.scrollIntoView({ block: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' }); t.el.focus({ preventScroll: true }); }
  }

  /* ---------- edit mode ---------- */
  function startEdit() {
    before = clone(layout); editing = true;
    dash.classList.add('editing'); hint.hidden = false; tray.hidden = false; msg.replaceChildren();
    setActions(); apply({ animate: false });
  }
  async function stopEdit(save) {
    if (save) {
      btnDone.disabled = true;
      try {
        const r = await Dashboard.save(board, layout);
        layout = r.layout;
        T.toast(`Your ${data.label} is saved. Only you see this arrangement.`);
      } catch (e) {
        btnDone.disabled = false;
        msg.replaceChildren(banner('circle-alert', 'Could not save your dashboard. Your changes are still here; try Done again. ' + (e.message || ''), 'err'));
        return;
      }
      btnDone.disabled = false;
    } else layout = before;
    editing = false; before = null;
    dash.classList.remove('editing'); hint.hidden = true; tray.hidden = true;
    setActions(); apply({ animate: false });
  }
  const onEsc = e => { if (e.key === 'Escape' && editing && !drag) stopEdit(false); };
  document.addEventListener('keydown', onEsc);
  window.addEventListener('hashchange', () => document.removeEventListener('keydown', onEsc), { once: true });

  /* keyboard: with a dashpart focused in edit mode, the arrow keys move it earlier or later; Delete puts it away */
  function onTileKey(e, id) {
    if (!editing || e.target !== e.currentTarget) return;
    const order = D.onIds(layout), at = order.indexOf(id);
    let next = null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = at - 1;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = at + 1;
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); layout = D.hide(layout, id); apply(); return; }
    if (next === null || next < 0 || next >= order.length) return;
    e.preventDefault();
    layout = D.move(layout, id, next); apply();
    tiles.get(id).el.focus();
  }

  /* ---------- drag to move ---------- */
  let drag = null;
  grid.addEventListener('pointerdown', e => {
    if (!editing || e.button !== 0 || e.target.closest('button, a, select')) return;
    const el = e.target.closest('.dp');
    if (!el) return;
    e.preventDefault();
    drag = { id: el.dataset.id, el, x0: e.clientX, y0: e.clientY, live: false, lastKey: '' };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
  function onMove(e) {
    if (!drag) return;
    if (!drag.live) {
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
      const r = drag.el.getBoundingClientRect();
      drag.live = true; drag.dx = drag.x0 - r.left; drag.dy = drag.y0 - r.top;
      drag.ghost = drag.el.cloneNode(true);
      drag.ghost.classList.add('dp-ghost');
      Object.assign(drag.ghost.style, { width: r.width + 'px', height: r.height + 'px', gridColumn: '', gridRow: '' });
      document.body.append(drag.ghost);
      drag.el.classList.add('placeholder');
      document.body.classList.add('dash-dragging');
    }
    drag.ghost.style.transform = `translate(${e.clientX - drag.dx}px, ${e.clientY - drag.dy}px)`;
    // near the top or bottom of the window: scroll the page
    const page = grid.closest('.page');
    if (page) { if (e.clientY > window.innerHeight - 50) page.scrollBy(0, 14); else if (e.clientY < 60) page.scrollBy(0, -14); }
    // over the tray: let go to put it away
    const tr = tray.getBoundingClientRect();
    drag.overTray = e.clientX >= tr.left && e.clientX <= tr.right && e.clientY >= tr.top && e.clientY <= tr.bottom;
    tray.classList.toggle('over', drag.overTray);
    if (drag.overTray) return;
    // which cell is under the pointer, and where that asks the dashpart to go
    const g = grid.getBoundingClientRect(), cs = getComputedStyle(grid);
    const gap = parseFloat(cs.columnGap) || 0, rowGap = parseFloat(cs.rowGap) || 0, rowH = parseFloat(cs.gridAutoRows) || 170;
    const colW = (g.width - gap * (cols - 1)) / cols;
    const cx = Math.max(0, Math.min(cols - 1, Math.floor((e.clientX - g.left) / (colW + gap))));
    const cy = Math.max(0, Math.floor((e.clientY - g.top) / (rowH + rowGap)));
    const key = cx + ',' + cy;
    if (key === drag.lastKey) return;
    drag.lastKey = key;
    const to = D.indexAt(D.pack(layout, cols), cx, cy);
    if (to !== D.onIds(layout).indexOf(drag.id)) { layout = D.move(layout, drag.id, to); apply(); }
  }
  function onUp() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    const d = drag; drag = null;
    if (!d || !d.live) return;
    document.body.classList.remove('dash-dragging');
    tray.classList.remove('over');
    if (d.overTray) { d.ghost.remove(); layout = D.hide(layout, d.id); apply(); return; }
    // settle the ghost into the slot, then show the real tile
    const to = d.el.getBoundingClientRect(), from = d.ghost.getBoundingClientRect();
    const done = () => { d.ghost.remove(); d.el.classList.remove('placeholder'); };
    if (reduceMotion()) return done();
    d.ghost.classList.add('settling');
    d.ghost.animate([{ transform: `translate(${from.left}px, ${from.top}px)` }, { transform: `translate(${to.left}px, ${to.top}px)` }], { duration: 180, easing: 'ease-out' }).onfinish = done;
  }

  /* ---------- columns follow the page width ---------- */
  new ResizeObserver(() => {
    const c = D.columnsFor(grid.clientWidth);
    if (c !== cols) { cols = c; grid.style.setProperty('--cols', cols); apply({ animate: false }); }
  }).observe(grid);
  cols = D.columnsFor(grid.clientWidth || 1200);
  grid.style.setProperty('--cols', cols);
  setActions();
  apply({ animate: false });
}
