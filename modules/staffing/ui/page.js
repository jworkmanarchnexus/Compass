/* Staffing projections: the revenue forecast turned into people, month by month, against the people on staff.
   Everything on the page comes from the server's projection (modules/staffing/logic/staffing.js); this file only draws it. */
import { Staffing } from '/shared/platform/index.js';
import { plural } from '/shared/ui/format.js';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const mShort = (m, withYear) => MON[(m % 100) - 1] + (withYear ? ` '${String(Math.floor(m / 100)).slice(2)}` : '');
const mLong = m => `${MON[(m % 100) - 1]} ${Math.floor(m / 100)}`;
const one = n => (Math.round(n * 10) / 10).toFixed(1);
const signed = n => { const r = Math.round(n * 10) / 10; return r === 0 ? '0.0' : (r > 0 ? '+' : '−') + Math.abs(r).toFixed(1); };
const perHour = c => '$' + Math.round(c / 100).toLocaleString('en-US') + '/h';
const SHORT = 0.5; // a gap smaller than half a person either way reads as even (display only)

export async function renderStaffing(ctx, body) {
  const { h } = ctx;
  const d = await Staffing.get();
  if (!d.available) {
    body.append(h('div', { class: 'empty-note', text: 'There is no staffing data yet. It comes from the Vantagepoint pull, which does not include it on this computer.' }));
    return;
  }
  body.append(
    ctx.banner('info', 'A planning estimate, not a hiring decision. It turns the revenue forecast into people using the standard staffing mix, billing rates and utilization targets in Admin. Sample data: every number here is made up.'),
    kpis(ctx, d), chartCard(ctx, d), gridCard(ctx, d), howCard(ctx, d));
  ctx.T.hydrateIcons(body);
}

/* ---------- headline numbers ---------- */
function kpis(ctx, d) {
  const { h } = ctx;
  const first = d.rows[0];
  // the biggest shortfall in the firmer months, any level, with the pipeline
  let worst = null;
  const firm = Math.min(d.firmMonths || d.months.length, d.months.length);
  for (const l of d.levels) d.gaps[l.id].total.slice(0, firm).forEach((g, i) => { if (!worst || g > worst.g) worst = { g, l, m: d.months[i] }; });
  const peakNeed = Math.max(...d.rows.slice(0, firm).map(r => r.sum.total));
  const kpi = (label, big, sub) => h('div', { class: 'kpi' }, h('div', { class: 'k-label', text: label }), h('div', { class: 'k-big', text: big }), h('div', { class: 'k-sub', text: sub }));
  return h('div', { class: 'kpis' },
    kpi('On staff', String(d.capacity.total), `in the roles counted here; ${d.capacity.untracked} in roles not counted (Administration, IT ...)`),
    kpi(`Needed in ${mLong(d.months[0])}`, one(first.sum.total), `${one(first.sum.contracted)} for contracted work, ${one(first.sum.pipeline)} for pursuits`),
    worst && worst.g >= SHORT
      ? kpi('Biggest shortfall', signed(worst.g), `${worst.l.label}, ${mLong(worst.m)}, counting pursuits`)
      : kpi('Biggest shortfall', 'None', `no role is short in the next ${plural(firm, 'month')}`),
    kpi(`Peak need, next ${firm} months`, one(peakNeed), `against ${d.capacity.total} on staff`));
}

/* ---------- people needed each month (stacked: contracted, then pipeline) against people on staff ---------- */
function chartCard(ctx, d) {
  const { h } = ctx;
  return h('section', { class: 'chart-card' },
    h('div', { class: 'chart-head' },
      h('div', {}, h('h2', { text: 'People needed each month' }), h('p', { class: 'muted', text: `Full-time people it takes to deliver the forecast, from ${plural(d.counts.projects, 'contracted project')} and ${plural(d.counts.pursuits, 'pursuit')}.` })),
      h('div', { class: 'chart-num' }, h('strong', { text: String(d.capacity.total) }), h('span', { class: 'muted', text: 'on staff now' }))),
    h('div', { class: 'st-legend' },
      h('span', {}, h('i', { class: 'st-sw c' }), 'Contracted work (the PMs\' forecast)'),
      h('span', {}, h('i', { class: 'st-sw p' }), 'Pursuits, weighted by win probability'),
      h('span', {}, h('i', { class: 'st-sw cap' }), 'People on staff'),
      d.firmMonths < d.months.length ? h('span', {}, h('i', { class: 'st-sw band' }), 'Less certain: PMs plan these months thinly') : null),
    chart(d));
}

const NS = 'http://www.w3.org/2000/svg';
function el(tag, attrs, ...kids) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined) n.setAttribute(k, v);
  for (const k of kids) if (k) n.append(typeof k === 'string' ? document.createTextNode(k) : k);
  return n;
}
function chart(d) {
  const W = 960, H = 300, L = 40, R = 76, T = 22, B = 30;
  const pw = W - L - R, ph = H - T - B;
  const top = Math.max(d.capacity.total, ...d.rows.map(r => r.sum.total)) * 1.08;
  const step = top > 120 ? 25 : top > 60 ? 10 : top > 24 ? 5 : 2;
  const hi = Math.ceil(top / step) * step;
  const y = v => T + ph - v / hi * ph;
  const slot = pw / d.rows.length, bw = Math.min(40, slot * 0.6);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'st-chart', role: 'img',
    'aria-label': `People needed each month from ${mLong(d.months[0])} to ${mLong(d.months.at(-1))}, against ${d.capacity.total} on staff.` });
  if (d.firmMonths < d.rows.length) {
    const x0 = L + d.firmMonths * slot;
    svg.append(el('rect', { x: x0, y: T - 16, width: L + pw - x0, height: ph + 16, class: 'st-band' }),
      el('text', { x: x0 + 8, y: T - 4, class: 'st-band-label' }, 'Less certain'));
  }
  for (let v = 0; v <= hi + 1e-9; v += step) {
    svg.append(el('line', { x1: L, x2: L + pw, y1: y(v), y2: y(v), class: v === 0 ? 'ch-zero' : 'ch-grid' }),
      el('text', { x: L - 6, y: y(v) + 3.5, 'text-anchor': 'end', class: 'ch-tick' }, String(v)));
  }
  d.rows.forEach((r, i) => {
    const x = L + i * slot + (slot - bw) / 2;
    const c = r.sum.contracted, p = r.sum.pipeline;
    const tip = `${mLong(r.month)}: ${one(r.sum.total)} people needed (${one(c)} contracted, ${one(p)} pursuits); ${d.capacity.total} on staff`;
    const g = el('g', {}, el('title', {}, tip));
    if (c > 0) g.append(el('rect', { x, y: y(c), width: bw, height: y(0) - y(c), class: 'st-c' }));
    if (p > 0) g.append(el('rect', { x, y: y(c + p), width: bw, height: y(c) - y(c + p), class: 'st-p' }));
    svg.append(g, el('text', { x: x + bw / 2, y: y(c + p) - 5, 'text-anchor': 'middle', class: 'st-total' }, String(Math.round(r.sum.total))),
      el('text', { x: x + bw / 2, y: H - 10, 'text-anchor': 'middle', class: 'ch-tick' }, mShort(r.month, i === 0 || r.month % 100 === 1)));
  });
  const cy = y(d.capacity.total);
  svg.append(el('line', { x1: L, x2: L + pw, y1: cy, y2: cy, class: 'st-cap' }),
    el('text', { x: L + pw + 6, y: cy + 4, class: 'st-cap-label' }, `${d.capacity.total} on staff`));
  return svg;
}

/* ---------- the gap by role: people needed less people on staff ---------- */
function gridCard(ctx, d) {
  const { h } = ctx;
  let mode = 'total';
  const holder = h('div', { class: 'tblwrap' });
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'What to count' },
    ...[['total', 'With pursuits'], ['contracted', 'Contracted work only']].map(([k, label]) =>
      h('button', { type: 'button', 'aria-pressed': String(k === mode), text: label, onclick: e => { mode = k; for (const b of seg.children) b.setAttribute('aria-pressed', String(b === e.currentTarget)); paint(); } })));
  const paint = () => {
    const later = i => i >= d.firmMonths;
    const cell = (g, need, on, label, m) => {
      const cls = g >= SHORT ? 'st-short' : g <= -SHORT ? 'st-spare' : 'st-even';
      return h('td', { class: 'st-cell ' + cls, title: `${label}, ${mLong(m)}: ${one(need)} needed, ${on} on staff`, text: signed(g) });
    };
    const rows = d.levels.map(l => {
      const on = d.capacity.byLevel[l.id];
      return h('tr', {}, h('td', { class: 'strong', text: l.label }), h('td', { class: 'st-onstaff', text: String(on) }),
        ...d.gaps[l.id][mode].map((g, i) => cell(g, d.rows[i][mode][l.id], on, l.label, d.months[i])));
    });
    const totals = d.rows.map(r => mode === 'total' ? r.sum.total : r.sum.contracted);
    rows.push(h('tr', { class: 'st-total' }, h('td', { text: 'All counted roles' }), h('td', { class: 'st-onstaff', text: String(d.capacity.total) }),
      ...totals.map((need, i) => cell(Math.round((need - d.capacity.total) * 100) / 100, need, d.capacity.total, 'All counted roles', d.months[i]))));
    holder.replaceChildren(h('table', { class: 'dt st-grid' },
      h('thead', {}, h('tr', {}, h('th', { text: 'Role' }), h('th', { text: 'On staff' }),
        ...d.months.map((m, i) => h('th', { class: later(i) ? 'st-later' : null, title: later(i) ? 'Less certain: PMs plan these months thinly' : null, text: mShort(m, i === 0 || m % 100 === 1) })))),
      h('tbody', {}, ...rows)));
  };
  paint();
  return h('section', { class: 'sec' },
    h('div', { class: 'sec-head' }, h('h2', { text: 'Short or spare, by role' }), h('p', { text: 'People needed less people on staff in each role. A plus means the work needs more people than the role has; a minus means room for more work. Hover a number for the detail.' })),
    h('div', { class: 'st-grid-tools' }, seg, h('span', { class: 'muted small', text: 'Greyed months are less certain.' })),
    holder,
    h('div', { class: 'st-key' },
      h('span', {}, h('i', { class: 'st-sw short' }), `Short by ${SHORT} or more`),
      h('span', {}, h('i', { class: 'st-sw spare' }), `Spare by ${SHORT} or more`),
      h('span', { text: 'Uncoloured: within half a person' })));
}

/* ---------- how it is worked out, with the numbers in force ---------- */
function howCard(ctx, d) {
  const { h } = ctx;
  const warn = d.warnings.map(w => {
    if (w.kind === 'unassigned') return `${plural(w.count, 'person', 'people')} in ${w.title || 'category ' + w.category} (category ${w.category}), which is in no role and not marked "not counted". They are left out until the Admin places the category.`;
    if (w.kind === 'noRate') return `${d.levels.find(l => l.id === w.level).label}: no billing rate for ${w.titles.join(', ')}.`;
    if (w.kind === 'noTarget') return `${d.levels.find(l => l.id === w.level).label} has a share of the mix but no utilization target.`;
    if (w.kind === 'noBlend') return `${plural(w.ids.length, 'project or pursuit', 'projects or pursuits')} could not be turned into people because a role has no billing rate.`;
    if (w.kind === 'brokenMix') return `${w.name} has its own staffing mix that no longer fits the roles. It is on the standard mix until that is fixed.`;
    return '';
  }).filter(Boolean);
  return h('section', { class: 'sec' },
    h('div', { class: 'sec-head' }, h('h2', { text: 'How this is worked out' })),
    h('div', { class: 'st-how' },
      h('p', { text: 'Each month\'s revenue (architectural only, consultants taken out) is turned into hours at the blended billing rate, the hours are split across the roles by the staffing mix, and each role\'s hours are divided by what one person in that role bills in a month.' }),
      h('div', { class: 'st-formula', text: `People in a role = revenue ÷ ${perHour(d.blended || 0)} blended rate × the role's share of the mix ÷ (${d.hoursPerMonth} hours × the role's utilization target)` }),
      h('p', { class: 'muted', text: `Billing rates are from Vantagepoint's "${d.rateTable}" table, as in effect today; a role's rate is the average of its categories, weighted by people on staff. Pursuits are weighted by win probability. Nothing here uses anyone's pay.` }),
      d.customUsed.length ? h('p', { text: `${plural(d.customUsed.length, 'project uses', 'projects use')} its own staffing mix instead of the standard one: ${d.customUsed.map(c => c.name).join(', ')}.` }) : null),
    h('div', { class: 'tblwrap' }, h('table', { class: 'dt', style: 'min-width:720px' },
      h('thead', {}, h('tr', {}, h('th', { text: 'Role' }), h('th', { text: 'Vantagepoint categories' }), h('th', { class: 'r', text: 'On staff' }), h('th', { class: 'r', text: 'Share of hours' }), h('th', { class: 'r', text: 'Utilization target' }), h('th', { class: 'r', text: 'Billing rate' }))),
      h('tbody', {}, ...d.levels.map(l => h('tr', {},
        h('td', { class: 'strong', text: l.label }), h('td', { class: 'muted', text: l.titles.join(', ') }),
        h('td', { class: 'r', text: String(d.capacity.byLevel[l.id]) }), h('td', { class: 'r', text: l.mix + '%' }), h('td', { class: 'r', text: l.target + '%' }),
        h('td', { class: 'r', text: l.rate === null ? 'none' : perHour(l.rate) }))),
      h('tr', { class: 'st-total' }, h('td', { class: 'strong', text: 'Standard mix' }), h('td', {}), h('td', { class: 'r', text: String(d.capacity.total) }), h('td', { class: 'r', text: '100%' }), h('td', {}), h('td', { class: 'r strong', text: d.blended === null ? 'none' : perHour(d.blended) + ' blended' }))))),
    warn.length ? h('div', { class: 'st-how' }, h('p', { class: 'strong', text: 'Needs a look' }), h('ul', { class: 'st-warn' }, ...warn.map(t => h('li', { text: t })))) : null);
}
