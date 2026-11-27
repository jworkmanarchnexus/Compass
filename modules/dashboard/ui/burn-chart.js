/* Fee burn: the drawing, shared by the dashpart (parts.js) and the one-project page (project.js).
   The numbers come from ../logic/burn.js; this file only draws them. Static strings we wrote, so HTML strings are safe
   (project names are escaped). Colors are classes in dashboard.css built on brand tokens. */

const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthLabel = m => { const [y, mm] = m.split('-').map(Number); return `${MN[mm - 1]} ${y}`; };
export const money = c => { const d = Math.abs(c) / 100, s = c < 0 ? '-$' : '$'; return d >= 1e6 ? s + (d / 1e6).toFixed(2) + 'M' : d >= 1e3 ? s + Math.round(d / 1e3) + 'K' : s + Math.round(d); };
export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* the "This year / Full project" switch; data-burn-window is picked up by the caller's click handler */
export function windowSwitch(current) {
  const b = (v, t) => `<button type="button" data-burn-window="${v}" aria-pressed="${current === v}">${t}</button>`;
  return `<div class="seg burn-seg" role="group" aria-label="Fee burn period">${b('year', 'This year')}${b('full', 'Full project')}</div>`;
}

export function legend(r) {
  const k = (cls, t) => `<span><i class="${cls}"></i>${t}</span>`;
  return `<div class="dp-legend burn-legend">${k('kb', 'Billed')}${k('kbf', 'Billed, forecast')}${k('ks', 'Spent (cost with overhead)')}${k('ksp', 'Spent, projected from plan hours')}${k('kfee', r.feeLineKind === 'total' ? 'Fee' : 'Fee left at Jan 1')}</div>`;
}

/* r = burn() result; px, py = pixel size; compact = no axes or labels (a short dashpart) */
export function chart(r, { px, py, compact }) {
  const n = r.months.length;
  if (!n) return '';
  const ml = compact ? 2 : 48, mr = compact ? 2 : (px > 460 ? 74 : 8), mt = compact ? 4 : 14, mb = compact ? 4 : 22;
  const iw = Math.max(10, px - ml - mr), ih = Math.max(10, py - mt - mb);
  const hi = Math.max(r.feeLine, ...r.billed, ...r.spent, 1) * 1.06;
  const step = [1e5, 2e5, 2.5e5, 5e5, 1e6, 2e6, 2.5e6, 5e6, 1e7, 2e7, 2.5e7, 5e7, 1e8, 2e8, 5e8].find(s => hi / s <= Math.max(2, Math.floor(ih / 34))) || 1e9;
  const top = Math.ceil(hi / step) * step;
  const x = i => ml + (n === 1 ? iw / 2 : i * iw / (n - 1)), y = v => mt + ih - v / top * ih;
  const la = r.lastActualIndex;
  const path = (arr, i0, i1) => { let d = ''; for (let i = Math.max(0, i0); i <= i1 && i < n; i++) d += (d ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(arr[i]).toFixed(1); return d; };
  let g = '';
  if (r.currentIndex !== null) g += `<rect class="burn-future" x="${x(r.currentIndex).toFixed(1)}" y="${mt}" width="${(x(n - 1) - x(r.currentIndex)).toFixed(1)}" height="${ih}"/>`;
  if (!compact) {
    for (let v = 0; v <= top; v += step) g += `<line class="grid" x1="${ml}" x2="${ml + iw}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="tk" x="${ml - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${money(v)}</text>`;
    const every = n <= 13 ? 1 : n <= 18 ? 2 : 0;
    r.months.forEach((m, i) => {
      const [yr, mm] = m.split('-').map(Number);
      if (every) { if (i % every === 0 || i === n - 1) g += `<text class="tk" x="${x(i).toFixed(1)}" y="${mt + ih + 15}" text-anchor="middle">${MN[mm - 1]}${mm === 1 && i > 0 ? ' ' + String(yr).slice(2) : ''}</text>`; }
      else if (mm === 1 || i === 0) g += `${i ? `<line class="grid" x1="${x(i).toFixed(1)}" x2="${x(i).toFixed(1)}" y1="${mt}" y2="${mt + ih}"/>` : ''}<text class="tk" x="${x(i).toFixed(1)}" y="${mt + ih + 15}" text-anchor="${i ? 'middle' : 'start'}">${mm === 1 ? yr : MN[mm - 1] + ' ' + yr}</text>`;
    });
  }
  g += `<line class="burn-fee" x1="${ml}" x2="${ml + iw}" y1="${y(r.feeLine).toFixed(1)}" y2="${y(r.feeLine).toFixed(1)}"/>`;
  if (!compact) g += `<text class="tk burn-feet" x="${ml + 4}" y="${(y(r.feeLine) - 5).toFixed(1)}">${r.feeLineKind === 'total' ? 'Fee' : 'Fee left at Jan 1'} ${money(r.feeLine)}</text>`;
  if (r.currentIndex !== null) {
    g += `<line class="burn-now" x1="${x(r.currentIndex).toFixed(1)}" x2="${x(r.currentIndex).toFixed(1)}" y1="${mt - 2}" y2="${mt + ih}"/>`;
    if (!compact) g += `<text class="tk strong" x="${(x(r.currentIndex) + 4).toFixed(1)}" y="${mt + ih - 5}">${MN[Number(r.months[r.currentIndex].slice(5)) - 1]} (now)</text>`;
  }
  g += `<path class="burn-sp" d="${path(r.spent, la, n - 1)}"/><path class="burn-bf" d="${path(r.billed, la, n - 1)}"/>`;
  g += `<path class="burn-s" d="${path(r.spent, 0, la)}"/><path class="burn-b" d="${path(r.billed, 0, la)}"/>`;
  if (!compact && n <= 18) r.months.forEach((m, i) => {
    const p = i > la;
    g += `<circle class="${p ? 'burn-dsp' : 'burn-ds'}" cx="${x(i).toFixed(1)}" cy="${y(r.spent[i]).toFixed(1)}" r="2.6"><title>${monthLabel(m)}: spent ${p ? '(projected) ' : ''}${money(r.spent[i])}</title></circle>`;
    g += `<circle class="${p ? 'burn-dbf' : 'burn-db'}" cx="${x(i).toFixed(1)}" cy="${y(r.billed[i]).toFixed(1)}" r="2.6"><title>${monthLabel(m)}: billed ${p ? '(forecast) ' : ''}${money(r.billed[i])}</title></circle>`;
  });
  if (!compact && mr > 40) {
    const yb = y(r.atEnd.billed), ys = y(r.atEnd.spent), close = Math.abs(yb - ys) < 14, up = yb <= ys;
    g += `<text class="tk strong" x="${ml + iw + 6}" y="${(yb + (close ? (up ? -3 : 11) : 4)).toFixed(1)}">Billed ${money(r.atEnd.billed)}</text>`;
    g += `<text class="tk" x="${ml + iw + 6}" y="${(ys + (close ? (up ? 11 : -3) : 4)).toFixed(1)}">Spent ${money(r.atEnd.spent)}</text>`;
  }
  return `<svg class="dp-svg burn-svg" viewBox="0 0 ${px} ${py}" width="${px}" height="${py}" role="img" aria-label="Fee burn: billed and spent by month against the fee">${g}</svg>`;
}

/* one plain sentence under the chart: where things stand, never punitive */
export function sentence(r) {
  const s = `Through ${monthLabel(r.months[Math.max(0, r.lastActualIndex)])}: billed ${money(r.toDate.billed)}, spent ${money(r.toDate.spent)}.`;
  const pass = r.spentPassesFee ? ` Spent ${r.spentPassesFee <= r.months[r.lastActualIndex] ? 'went past' : 'is projected to pass'} the ${r.feeLineKind === 'total' ? 'fee' : 'fee left at Jan 1'} in ${monthLabel(r.spentPassesFee)}.` : '';
  return s + pass;
}
