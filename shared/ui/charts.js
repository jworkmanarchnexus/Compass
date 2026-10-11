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
