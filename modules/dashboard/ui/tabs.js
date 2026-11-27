/* PIC and PM dashboards: the tab row and the fixed tabs (Josh, 2026-11-26).
   Overview is each person's own grid of dashparts (page.js). The other tabs are the same for everyone with that dashboard:
   Profit, Revenue forecast, Hours, and on the PIC dashboard only, Billing & AR. On those tabs the group chips (All, Needs a
   look, Below zero, Ending soon) narrow the projects. Any project opens on its own page with the same tabs; its Overview
   is the fee burn page (project.js).
   Rules (figures, status, chips, totals) are in ../logic/portfolio.js and tested there; this file only draws.
   MADE-UP SAMPLE DATA (burn-sample.js) until the Vantagepoint copy carries the real numbers. */
import { Dashboard } from '/shared/platform/index.js';
import { sampleProjects, sampleProject, SAMPLE_MONTHS, SAMPLE_PEOPLE } from './burn-sample.js';
import * as BC from './burn-chart.js';

const P = () => window.CompassDashboard.portfolio;
const B = () => window.CompassDashboard.burn;

export const TAB_LIST = [
  { id: 'overview', label: 'Overview' },
  { id: 'profit', label: 'Profit' },
  { id: 'forecast', label: 'Revenue forecast' },
  { id: 'hours', label: 'Hours' },
  { id: 'billing', label: 'Billing & AR', pic: true },
];
export const tabsFor = board => TAB_LIST.filter(t => !t.pic || board === 'pic');
export const isTab = (board, tab) => tabsFor(board).some(t => t.id === tab);
const boardHref = (board, tab) => `#/dashboard/${board}${tab && tab !== 'overview' ? '/' + tab : ''}`;
const projectHref = (board, wbs1, tab) => `#/dashboard/${board}/project/${encodeURIComponent(wbs1)}${tab && tab !== 'overview' ? '/' + tab : ''}`;

const CHIP = { pic: 'all', pm: 'all' }; // the chip picked on each dashboard, kept while the person moves between tabs
const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortMonth = m => MN[Number(m.slice(5)) - 1];
const pctText = v => (v === null ? '–' : (v < 0 ? '-' : '') + Math.abs(v).toFixed(1) + '%');
const num = n => Math.round(n).toLocaleString();
const STATUS_CHIP = { look: 'warn', watch: 'blue', ok: 'ok' };

/* ---------- loading: the dashboard (for its settings, and to refuse a dashboard the person does not have) and the projects ---------- */
async function load(board) {
  const data = await Dashboard.get(board);
  const rules = data.rules || { watchProfitPct: 10, endingSoonDays: 90 };
  const raw = sampleProjects(board);
  const all = raw.map(p => P().summarize(p, SAMPLE_MONTHS));
  return { data, rules, raw, all, pct: (data.burn && data.burn.projectedSpendPct) || 85 };
}

/* ---------- the tab row, in the header tile, with the chips (fixed tabs) and "Open a project" on the right ---------- */
export function mountTabRow(ctx, body, { board, active, project, projects, chips, onChip }) {
  const { h } = ctx;
  const head = body.parentNode && body.parentNode.querySelector('.phead');
  if (!head) return;
  const tabs = h('nav', { class: 'dtabs-list', 'aria-label': 'Dashboard views' },
    ...tabsFor(board).map(t => h('a', { href: project ? projectHref(board, project, t.id) : boardHref(board, t.id), class: t.id === active ? 'on' : '', 'aria-current': t.id === active ? 'page' : null },
      h('span', { text: t.label }), t.pic ? h('span', { class: 'dtabs-tag', text: 'PIC' }) : null)));
  const right = h('div', { class: 'dtabs-right' });
  if (chips) right.append(h('div', { class: 'dtabs-chips', role: 'group', 'aria-label': 'Which projects' },
    ...chips.map(c => h('button', { type: 'button', class: 'dchip', 'aria-pressed': String(c.id === CHIP[board]), onclick: () => onChip(c.id) },
      h('span', { text: c.label }), h('span', { class: 'n', text: String(c.count) })))));
  if (projects && projects.length) {
    const sel = h('select', { class: 'txt dtabs-open', 'aria-label': 'Open a project', onchange: () => { if (sel.value) location.hash = projectHref(board, sel.value, active === 'overview' ? null : active); } },
      h('option', { value: '', text: 'Open a project…' }), ...projects.map(p => h('option', { value: p.wbs1, text: `${p.wbs1} ${p.name}`, selected: p.wbs1 === project })));
    right.append(sel);
  }
  head.querySelectorAll('.dtabs').forEach(n => n.remove());
  head.append(h('div', { class: 'dtabs' }, tabs, right));
}

/* ---------- small drawing helpers ---------- */
function card(h, title, sub, ...content) {
  return h('section', { class: 'dp-in dtab-card', 'aria-label': title },
    h('header', { class: 'dtab-head' }, h('h2', { text: title }), sub ? h('span', { class: 'muted', text: sub }) : null), ...content);
}
const figs = (h, items) => h('div', { class: 'dproj-figs' }, ...items.map(([l, b, s]) => h('div', { class: 'dproj-fig' }, h('div', { class: 'dpk-l', text: l }), h('div', { class: 'dpk-b', text: b }), h('div', { class: 'dpk-s', text: s || '' }))));
const statusChip = (h, st) => h('span', { class: 'chip ' + STATUS_CHIP[st], text: P().STATUS_LABEL[st] });

/* a table; cols = [{ h, f(row) -> text or node, r: right-aligned }]; href(row) makes the first column a link to the project */
function table(h, cols, rows, href) {
  return h('div', { class: 'dtab-scroll' }, h('table', { class: 'dp-table dtab-table' },
    h('thead', {}, h('tr', {}, ...cols.map(c => h('th', { class: c.r ? 'r' : '', text: c.h })))),
    h('tbody', {}, ...rows.map(r => h('tr', {}, ...cols.map((c, i) => {
      const v = c.f(r), node = v && v.nodeType ? v : document.createTextNode(v === null || v === undefined ? '' : String(v));
      return h('td', { class: (c.r ? 'r' : '') + (i === 0 ? ' nm' : '') }, i === 0 && href ? h('a', { href: href(r) }, node) : node);
    }))))));
}

/* horizontal bars; items = [{ label, value, text, href }] (negative bars in orange from a zero line) */
function bars(h, items) {
  const lo = Math.min(0, ...items.map(i => i.value)), hi = Math.max(0, ...items.map(i => i.value)), span = hi - lo || 1, z = -lo / span * 100;
  return h('div', { class: 'dbars' }, ...items.map(i => {
    const a = (Math.min(0, i.value) - lo) / span * 100, b = (Math.max(0, i.value) - lo) / span * 100;
    const track = h('span', { class: 'dbar-track' }, h('i', { class: i.value < 0 ? 'neg' : '', style: `left:${a}%;width:${Math.max(0.6, b - a)}%` }), lo < 0 ? h('b', { style: `left:${z}%` }) : null);
    return h('div', { class: 'dbar' }, i.href ? h('a', { href: i.href, class: 'dbar-nm', text: i.label, title: i.label }) : h('span', { class: 'dbar-nm', text: i.label, title: i.label }), track, h('span', { class: 'dbar-v', text: i.text }));
  }));
}

/* a column chart of monthly amounts, redrawn when its box changes width */
function columns(h, months, values) {
  const box = h('div', { class: 'dcols' });
  const draw = () => {
    const px = Math.max(240, box.clientWidth || 600), py = 190, top = 22, bot = 24, max = Math.max(1, ...values), slot = px / values.length, bw = Math.min(56, slot * 0.6);
    let g = `<line class="zero" x1="0" x2="${px}" y1="${py - bot}" y2="${py - bot}"/>`;
    values.forEach((v, i) => {
      const hgt = v / max * (py - top - bot), x = slot * i + (slot - bw) / 2;
      g += `<rect class="f1" x="${x.toFixed(1)}" y="${(py - bot - hgt).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, hgt).toFixed(1)}" rx="3"><title>${BC.monthLabel(months[i])}: ${BC.money(v)}</title></rect>`;
      g += `<text class="tk strong" x="${(slot * i + slot / 2).toFixed(1)}" y="${(py - bot - hgt - 6).toFixed(1)}" text-anchor="middle">${BC.money(v)}</text>`;
      g += `<text class="tk" x="${(slot * i + slot / 2).toFixed(1)}" y="${py - 6}" text-anchor="middle">${shortMonth(months[i])}</text>`;
    });
    box.innerHTML = `<svg class="dp-svg" viewBox="0 0 ${px} ${py}" width="${px}" height="${py}" role="img" aria-label="Forecast by month">${g}</svg>`;
  };
  let w = 0;
  new ResizeObserver(() => { const nw = Math.floor(box.clientWidth); if (nw && nw !== w) { w = nw; draw(); } }).observe(box);
  return box;
}

/* the fee burn for a list of projects, with its own This year / Full project switch */
function burnCard(h, raw, pct, title) {
  let win = 'year';
  const sw = h('div', { class: 'dtab-tools' }), chart = h('div', { class: 'dproj-chart' }), leg = h('div'), says = h('p', { class: 'burn-says' });
  const draw = () => {
    const r = B().burn(raw, Object.assign({ window: win, projectedSpendPct: pct }, SAMPLE_MONTHS));
    sw.innerHTML = BC.windowSwitch(win);
    const px = Math.max(280, Math.floor(chart.clientWidth || 900));
    chart.innerHTML = BC.chart(r, { px, py: px < 600 ? 240 : 300 });
    leg.innerHTML = BC.legend(r); says.textContent = BC.sentence(r);
  };
  sw.addEventListener('click', e => { const b = e.target.closest('[data-burn-window]'); if (b) { win = b.dataset.burnWindow; draw(); } });
  let w = 0;
  new ResizeObserver(() => { const nw = Math.floor(chart.clientWidth); if (nw && nw !== w) { w = nw; draw(); } }).observe(chart);
  const c = card(h, title, null, chart, leg, says);
  c.querySelector('.dtab-head').append(sw);
  return c;
}

/* =================== a dashboard's fixed tab =================== */
export async function renderBoardTab(ctx, body, board, tab) {
  const { h, T } = ctx;
  const { rules, raw, all, pct } = await load(board);
  const P_ = P();
  const draw = () => {
    const chip = CHIP[board];
    const list = all.filter(s => P_.inChip(s, chip, SAMPLE_MONTHS, rules));
    mountTabRow(ctx, body, {
      board, active: tab, projects: all,
      chips: P_.CHIPS.map(id => ({ id, label: id === 'ending' ? `Ending in ${rules.endingSoonDays} days` : P_.CHIP_LABEL[id], count: all.filter(s => P_.inChip(s, id, SAMPLE_MONTHS, rules)).length })),
      onChip: id => { CHIP[board] = id; draw(); },
    });
    body.replaceChildren();
    if (!list.length) { body.append(h('div', { class: 'dash-empty' }, h('strong', { text: 'No projects in this group right now.' }), h('span', { text: ' Pick All to see every project.' }))); return; }
    const t = P_.totals(list, rules);
    const href = s => projectHref(board, s.wbs1, tab);
    const nameCol = { h: 'Project', f: s => `${s.wbs1} ${s.name}` };
    const pmCol = board === 'pic' ? [{ h: 'PM', f: s => s.pm }] : [];
    const st = s => P_.status(s, rules);
    const of = `${t.count} project${t.count === 1 ? '' : 's'}${chip === 'all' ? '' : ' in this group'}`;

    if (tab === 'profit') {
      const sorted = [...list].sort((a, b) => (a.ytd.profitPct ?? 0) - (b.ytd.profitPct ?? 0));
      body.append(
        figs(h, [['Fee', BC.money(t.fee), of], ['Billed this year', BC.money(t.billed), 'Through October'], ['Profit this year', BC.money(t.profit), pctText(t.profitPct) + ' of billed'], ['Need a look', String(t.needLook), `Watch below ${rules.watchProfitPct}% profit`]]),
        card(h, 'Profit % by project', 'Year to date, lowest first', bars(h, sorted.map(s => ({ label: s.name, value: s.ytd.profitPct ?? 0, text: pctText(s.ytd.profitPct), href: href(s) })))),
        card(h, 'Profit by project', 'Year to date. Spent is cost with overhead.', table(h, [nameCol, ...pmCol,
          { h: 'Fee', r: 1, f: s => BC.money(s.fee) }, { h: 'Billed', r: 1, f: s => BC.money(s.ytd.billed) }, { h: 'Spent', r: 1, f: s => BC.money(s.ytd.spent) },
          { h: 'Profit', r: 1, f: s => BC.money(s.ytd.profit) }, { h: 'Profit %', r: 1, f: s => pctText(s.ytd.profitPct) },
          { h: 'Billed / spent of fee', r: 1, f: s => `${s.billedPctOfFee}% / ${s.spentPctOfFee}%` }, { h: 'Status', f: s => statusChip(h, st(s)) }], sorted, href)));
    } else if (tab === 'forecast') {
      const months = list[0].forecast.map(f => f.month), byMonth = months.map((_, i) => list.reduce((s, x) => s + x.forecast[i].billed, 0));
      const next6 = byMonth.reduce((a, b) => a + b, 0), feeLeft = list.reduce((s, x) => s + Math.max(0, x.fee - x.jtd.billed), 0);
      const inList = new Set(list.map(s => s.wbs1));
      body.append(
        figs(h, [['Next 3 months', BC.money(t.forecastNext3), 'From project plans'], ['Next 6 months', BC.money(next6), `${shortMonth(months[0])} to ${shortMonth(months[5])}`], ['Billed this year', BC.money(t.billed), 'Through October'], ['Fee left to bill', BC.money(feeLeft), of]]),
        burnCard(h, raw.filter(p => inList.has(p.wbs1)), pct, 'Fee burn'),
        card(h, 'Forecast by month', 'Revenue forecast from the project plans. Separate from MWIP.', columns(h, months, byMonth)),
        card(h, 'By project', null, table(h, [nameCol, ...months.map((m, i) => ({ h: shortMonth(m), r: 1, f: s => BC.money(s.forecast[i].billed) })), { h: 'Total', r: 1, f: s => BC.money(s.forecast.reduce((a, f) => a + f.billed, 0)) }], list, href)));
    } else if (tab === 'hours') {
      const sorted = [...list].sort((a, b) => b.hours.actual / (b.hours.plan || 1) - a.hours.actual / (a.hours.plan || 1));
      body.append(
        figs(h, [['Hours this year', num(t.hoursActual), `Planned ${num(t.hoursPlan)}`], ['Difference', (t.hoursActual - t.hoursPlan > 0 ? '+' : '') + num(t.hoursActual - t.hoursPlan), 'hours against the plan'], ['Over plan', String(list.filter(s => s.hours.actual > s.hours.plan).length), of]]),
        card(h, 'Hours against plan', 'Actual as a percent of planned hours, year to date, highest first', bars(h, sorted.map(s => ({ label: s.name, value: Math.round(s.hours.actual / (s.hours.plan || 1) * 100), text: Math.round(s.hours.actual / (s.hours.plan || 1) * 100) + '%', href: href(s) })))),
        card(h, 'By project', null, table(h, [nameCol, ...pmCol, { h: 'Planned', r: 1, f: s => num(s.hours.plan) }, { h: 'Actual', r: 1, f: s => num(s.hours.actual) }, { h: 'Difference', r: 1, f: s => (s.hours.actual - s.hours.plan > 0 ? '+' : '') + num(s.hours.actual - s.hours.plan) }], sorted, href)));
    } else if (tab === 'billing') {
      const sorted = [...list].sort((a, b) => b.ar.over60 - a.ar.over60 || b.ar.total - a.ar.total);
      body.append(
        figs(h, [['Owed to us', BC.money(t.ar), 'All open invoices'], ['Over 60 days', BC.money(t.over60), `${list.filter(s => s.ar.over60 > 0).length} projects`], ['Billed this year', BC.money(t.billed), of]]),
        card(h, 'Aging by project', 'Open invoices by how long they have waited', table(h, [nameCol, ...pmCol,
          { h: 'Current', r: 1, f: s => BC.money(s.ar.current) }, { h: '31–60', r: 1, f: s => BC.money(s.ar.d31) }, { h: '61–90', r: 1, f: s => BC.money(s.ar.d61) }, { h: '90+', r: 1, f: s => BC.money(s.ar.d91) }, { h: 'Total', r: 1, f: s => BC.money(s.ar.total) }], sorted, href)));
    }
    T.hydrateIcons(body);
  };
  draw();
}

/* =================== one project's fixed tab (its Overview is project.js) =================== */
export async function renderProjectTab(ctx, body, board, wbs1, tab) {
  const { h, banner } = ctx;
  const { rules, all, data } = await load(board);
  const p = sampleProject(board, wbs1), s = all.find(x => x.wbs1 === wbs1);
  mountTabRow(ctx, body, { board, active: tab, project: wbs1, projects: all });
  if (!p || !s) { body.append(banner('info', `${wbs1} is not one of the projects on your ${data.label}.`)); return; }
  const st = P().status(s, rules);
  body.append(h('p', { class: 'muted', style: 'margin:0', text: `${p.wbs1} ${p.name} · PM ${p.pm}. Sample data: the numbers are made up until they come from Vantagepoint.` }));

  if (tab === 'profit') {
    const y0 = '2026-01', rows = [];
    let run = 0;
    for (const a of p.actuals) if (a.month >= y0 && a.month <= SAMPLE_MONTHS.lastClosed) {
      const spent = B().spentOf(a, p.overheadPct); run += a.billed - spent;
      rows.push({ month: a.month, billed: a.billed, spent, profit: a.billed - spent, run });
    }
    body.append(
      figs(h, [['Billed this year', BC.money(s.ytd.billed), 'Through October'], ['Spent this year', BC.money(s.ytd.spent), 'Cost with overhead'], ['Profit this year', BC.money(s.ytd.profit), pctText(s.ytd.profitPct) + ' of billed'], ['Status', P().STATUS_LABEL[st], `Watch below ${rules.watchProfitPct}% profit`]]),
      card(h, 'Profit by month', 'This year, closed months', table(h, [{ h: 'Month', f: r => BC.monthLabel(r.month) }, { h: 'Billed', r: 1, f: r => BC.money(r.billed) }, { h: 'Spent', r: 1, f: r => BC.money(r.spent) }, { h: 'Profit', r: 1, f: r => BC.money(r.profit) }, { h: 'Profit so far', r: 1, f: r => BC.money(r.run) }], rows)));
  } else if (tab === 'forecast') {
    const months = s.forecast.map(f => f.month), vals = s.forecast.map(f => f.billed);
    const later = p.forecast.filter(f => f.month > SAMPLE_MONTHS.lastClosed);
    body.append(
      figs(h, [['Next 3 months', BC.money(s.forecastNext3), 'From the project plan'], ['Fee left to bill', BC.money(Math.max(0, s.fee - s.jtd.billed)), `of ${BC.money(s.fee)}`], ['Ends', BC.monthLabel(s.end), `${later.length} months of forecast`]]),
      card(h, 'Forecast by month', 'Next six months. Separate from MWIP.', columns(h, months, vals)),
      card(h, 'Every month to the end', null, table(h, [{ h: 'Month', f: f => BC.monthLabel(f.month) }, { h: 'Forecast', r: 1, f: f => BC.money(f.billed) }], later)));
  } else if (tab === 'hours') {
    const shares = [0.34, 0.28, 0.22, 0.16];
    body.append(
      figs(h, [['Hours this year', num(s.hours.actual), `Planned ${num(s.hours.plan)}`], ['Difference', (s.hours.actual - s.hours.plan > 0 ? '+' : '') + num(s.hours.actual - s.hours.plan), 'hours against the plan']]),
      card(h, 'By person', 'Hours charged this year (made-up names)', bars(h, SAMPLE_PEOPLE.map((n, i) => ({ label: n, value: Math.round(s.hours.actual * shares[i]), text: num(s.hours.actual * shares[i]) + ' h' })))));
  } else if (tab === 'billing') {
    const rows = [['Current', s.ar.current, 'Oct 31, 2026'], ['31–60 days', s.ar.d31, 'Sep 30, 2026'], ['61–90 days', s.ar.d61, 'Aug 31, 2026'], ['Over 90 days', s.ar.d91, 'Jul 31, 2026']].filter(r => r[1] > 0);
    body.append(
      figs(h, [['Owed to us', BC.money(s.ar.total), 'Open invoices'], ['Over 60 days', BC.money(s.ar.over60), s.ar.over60 ? 'Worth a call' : 'None']]),
      card(h, 'Open invoices', 'Made-up invoices', table(h, [{ h: 'Invoice date', f: r => r[2] }, { h: 'Age', f: r => r[0] }, { h: 'Amount', r: 1, f: r => BC.money(r[1]) }], rows)));
  }
}
