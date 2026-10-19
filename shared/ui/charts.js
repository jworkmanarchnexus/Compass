/* Two small hand-built SVG charts, in the design system's colours (CSS variables, so dark mode follows).
   Every mark also carries a text label or a <title>, so the colour is never the only way to read it. */
const NS = 'http://www.w3.org/2000/svg';
function el(tag, attrs, ...kids) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined) n.setAttribute(k, v);
  for (const k of kids) if (k) n.append(typeof k === 'string' ? document.createTextNode(k) : k);
  return n;
}

/* pleasant tick values from 0 down to (or up from) the data: 0, 100, 200 ... in whatever unit the values use */
function niceStep(range, ticks) {
  const raw = range / ticks; const pow = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}
function scale(values, ticks, includeZero) {
  let lo = Math.min(...values, includeZero ? 0 : Infinity), hi = Math.max(...values, includeZero ? 0 : -Infinity);
  if (lo === hi) { lo -= 1; hi += 1; }
  const step = niceStep(hi - lo, ticks || 4);
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const out = []; for (let v = lo; v <= hi + step / 1000; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return { lo, hi, ticks: out };
}

/* Bars hanging down from a zero line. points: [{ label, yearLabel?, value, kind: 'prev'|'bar'|'now', tip }] (value <= 0)
   fmt(value) writes a tick label; unit is the divisor that makes values "nice" (100000 cents = $1K) */
export function negativeBars(points, { fmt, aria }) {
  const W = 520, H = 220, L = 52, R = 8, T = 8, B = 40;
  const pw = W - L - R, ph = H - T - B;
  const sc = scale(points.map(p => p.value), 4, true);
  const y = v => T + (sc.hi - v) / (sc.hi - sc.lo) * ph;
  const slot = pw / points.length, bw = slot * 0.62;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': aria, class: 'chart' });
  for (const t of sc.ticks) {
    svg.append(el('line', { x1: L, x2: W - R, y1: y(t), y2: y(t), class: t === 0 ? 'ch-zero' : 'ch-grid' }));
    svg.append(el('text', { x: L - 6, y: y(t) + 3.5, 'text-anchor': 'end', class: 'ch-tick' }, t === 0 ? '0' : fmt(t)));
  }
  points.forEach((p, i) => {
    const x = L + i * slot + (slot - bw) / 2;
    svg.append(el('rect', { x, y: y(0), width: bw, height: Math.max(1, y(p.value) - y(0)), class: 'ch-' + p.kind }, el('title', {}, p.tip)));
    svg.append(el('text', { x: x + bw / 2, y: H - 22, 'text-anchor': 'middle', class: 'ch-tick' }, p.label));
    if (p.yearLabel) svg.append(el('text', { x: x + bw / 2, y: H - 6, 'text-anchor': 'middle', class: 'ch-year' }, p.yearLabel));
  });
  return svg;
}

/* A line through month-end values. points: [{ label, yearLabel?, value, kind: 'prev'|'now'|'bar', tip }]
   The last point gets a dot in the accent colour; earlier last-year points are drawn in grey. */
export function lineChart(points, { fmt, aria, zero, ticks, height }) {
  const W = 520, H = height || 220, L = 52, R = 14, T = 10, B = 40;
  const pw = W - L - R, ph = H - T - B;
  const sc = scale(points.map(p => p.value), ticks || 4, !!zero);
  const y = v => T + (sc.hi - v) / (sc.hi - sc.lo) * ph;
  const x = i => L + (points.length === 1 ? pw / 2 : i * pw / (points.length - 1));
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': aria, class: 'chart' });
  for (const t of sc.ticks) {
    svg.append(el('line', { x1: L, x2: W - R, y1: y(t), y2: y(t), class: t === 0 && zero ? 'ch-zero' : 'ch-grid' }));
    svg.append(el('text', { x: L - 6, y: y(t) + 3.5, 'text-anchor': 'end', class: 'ch-tick' }, t === 0 ? '0' : fmt(t)));
  }
  // grey for last year, dark for this year; joined so the line is continuous
  for (let i = 1; i < points.length; i++) {
    const kind = points[i].kind === 'prev' ? 'prev' : 'bar';
    svg.append(el('line', { x1: x(i - 1), y1: y(points[i - 1].value), x2: x(i), y2: y(points[i].value), class: 'ch-line-' + kind }));
  }
  points.forEach((p, i) => {
    const last = i === points.length - 1;
    svg.append(el('circle', { cx: x(i), cy: y(p.value), r: last ? 4.5 : 2.5, class: last ? 'ch-now' : 'ch-dot-' + (p.kind === 'prev' ? 'prev' : 'bar') }, el('title', {}, p.tip)));
    svg.append(el('text', { x: x(i), y: H - 22, 'text-anchor': 'middle', class: 'ch-tick' }, p.label));
    if (p.yearLabel) svg.append(el('text', { x: x(i), y: H - 6, 'text-anchor': 'middle', class: 'ch-year' }, p.yearLabel));
  });
  return svg;
}

/* Horizontal stacked bars, one row each. rows: [{ label, segs: [{ v, kind, text? }], marks?: [{ v, kind }], endText? }]
   kinds map to CSS classes sb-<kind>. Used by the BD report (revenue, forecast and MWIP against pace and goal).
   Values are cents; fmt(v) writes an axis tick.
   Options: guides [{ v, kind, title }] draw a dashed line down the whole chart (class sb-guide-<kind>); a row's gapBefore starts a new group;
   rowHeight sets the row height; tight makes each bar fill its row (no space between the bars of a pair).
   A segment with `pick: true` can be hovered (everything else is muted) and clicked: onPick({ rowKey, kind }) is called with the row's `key`
   and the segment's kind. `picked` ({ rowKey, kind }) keeps one segment lit while a drill-down is open. Keyboard: Tab and Enter. */
export function stackedBars(rows, { fmt, aria, max, onPick, picked, guides, rowHeight, tight }) {
  const W = 1100, L = 170, R = 80, T = 8, B = 30, RH = rowHeight || (rows.length > 2 ? 38 : 44), GAP = tight ? 20 : 16;
  // a row with gapBefore starts a new group (a bar and its goal bar sit together); guides are dashed lines down the whole chart
  const ys = []; let yy = T;
  rows.forEach(r => { if (r.gapBefore) yy += GAP; ys.push(yy); yy += RH; });
  const H = yy + B;
  const top = max || Math.max(...rows.map(r => r.segs.reduce((a, s) => a + s.v, 0)), ...rows.flatMap(r => (r.marks || []).map(m => m.v)), ...(guides || []).map(g => g.v));
  const step = niceStep(top, 5);
  const axisMax = Math.ceil(top / step) * step;
  const x = v => L + v / axisMax * (W - L - R);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': aria, class: 'chart sb' + (picked ? ' sb-has-pick' : '') });
  for (let v = 0; v <= axisMax + 1; v += step) {
    svg.append(el('line', { x1: x(v), x2: x(v), y1: T, y2: H - B, class: 'ch-grid' }));
    svg.append(el('text', { x: x(v), y: H - 10, 'text-anchor': 'middle', class: 'ch-tick' }, fmt(v)));
  }
  rows.forEach((r, i) => {
    // tight: the bar fills its row, so a bar and its goal bar sit flush together; the space is only between pairs
    const y = ys[i], bh = tight ? RH : RH * 0.62, by = tight ? y : y + (RH - bh) / 2;
    svg.append(el('text', { x: L - 8, y: by + bh / 2 + 4, 'text-anchor': 'end', class: 'sb-label' }, r.label));
    let acc = 0;
    for (const s of r.segs) {
      if (s.v <= 0) continue;
      const live = onPick && s.pick;
      const isPicked = !!(picked && live && picked.rowKey === r.key && picked.kind === s.kind);
      const rect = el('rect', { x: x(acc), y: by, width: Math.max(1, x(acc + s.v) - x(acc)), height: bh, class: 'sb-' + s.kind + (live ? ' sb-click' : '') + (isPicked ? ' sb-picked' : ''),
        tabindex: live ? '0' : null, role: live ? 'button' : null, 'aria-pressed': live ? String(isPicked) : null,
        'aria-label': live ? `Show what is behind ${s.title || s.kind} for ${r.label}: ${fmt(s.v)}` : null }, el('title', {}, `${s.title || s.kind}: ${fmt(s.v)}${live ? '. Click for the detail.' : ''}`));
      if (live) {
        const on = () => { svg.classList.add('sb-hover'); rect.classList.add('sb-hot'); };
        const off = () => { svg.classList.remove('sb-hover'); rect.classList.remove('sb-hot'); };
        rect.addEventListener('mouseenter', on); rect.addEventListener('mouseleave', off); rect.addEventListener('focus', on); rect.addEventListener('blur', off);
        rect.addEventListener('click', () => onPick({ rowKey: r.key, kind: s.kind }));
        rect.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick({ rowKey: r.key, kind: s.kind }); } });
      }
      svg.append(rect);
      if (s.text) {
        const cx = (x(acc) + x(acc + s.v)) / 2, fits = x(acc + s.v) - x(acc) >= s.text.length * 6.4 + 8;
        // too narrow for its words: inside if it fits, otherwise just above the bar (where there is room: not on a goal bar tucked under its pair)
        if (fits) svg.append(el('text', { x: cx, y: by + bh / 2 + 4, 'text-anchor': 'middle', class: 'sb-in sb-in-' + s.kind }, s.text));
        else if (!tight || r.gapBefore) svg.append(el('text', { x: cx, y: by - 4, 'text-anchor': 'middle', class: 'sb-out' }, s.text));
      }
      acc += s.v;
    }
    for (const m of r.marks || []) svg.append(el('line', { x1: x(m.v), x2: x(m.v), y1: by - 4, y2: by + bh + 4, class: 'sb-mark-' + m.kind }, el('title', {}, m.title || '')));
    if (r.endText) svg.append(el('text', { x: x(acc) + 6, y: by + bh / 2 + 4, class: 'sb-end' }, r.endText));
  });
  for (const g of guides || []) svg.append(el('line', { x1: x(g.v), x2: x(g.v), y1: T, y2: H - B, class: 'sb-guide sb-guide-' + g.kind }, el('title', {}, g.title || '')));
  svg.append(el('line', { x1: L, x2: L, y1: T, y2: H - B, class: 'ch-zero' }));
  return svg;
}
