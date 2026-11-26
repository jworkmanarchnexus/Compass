/* A Marketing Report chart, drilled into one PIC (or sector, or the whole firm): the chart turns in place into the projects behind that bar.
     each project   a bar: dark green revenue billed to date, light green the contracted forecast
     each pursuit   a gray bar: the MWIP backlog, factored
   Under it, the forecast and the MWIP month by month (like the Vantagepoint report), folded away until asked for.
   The numbers were frozen with the report, so they always add up to the bar. */
import { stackedBars } from '/shared/ui/charts.js';
import { Bd } from '/shared/platform/index.js';

const money = c => (c < 0 ? '-$' : '$') + Math.abs(Math.round(c / 100)).toLocaleString('en-US');
const K = c => `$${Math.round(c / 100000).toLocaleString('en-US')}K`;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = m => `${MON[(m % 100) - 1]} ${Math.floor(m / 100)}`;
const shortName = n => (n.length > 30 ? n.slice(0, 29) + '…' : n);

/* the three pieces of detail behind one bar, fetched together before the chart turns */
export async function loadDrill(runId, drill) {
  const q = kind => Bd.detail(runId, { kind, scope: drill.scope, key: drill.scope === 'firm' ? undefined : drill.key });
  const [ytd, forecast, mwip] = await Promise.all([q('ytd'), q('forecast'), q('mwip')]);
  return { ytd, forecast, mwip };
}

/* the card that stands where the chart was. onBack returns to the chart. */
export function drillCard(ctx, drill, data, onBack, legend) {
  const { h, icon } = ctx;
  const back = h('button', { class: 'btn quiet sm bd-back', type: 'button', 'aria-label': `Back to the ${drill.backTo} chart`, title: 'Back', onclick: onBack }, icon('arrow-left'), h('span', { text: 'Back' }));
  const head = h('div', { class: 'sec-head bd-sum bd-drill-head' }, back, h('span', { class: 'bd-drill-title', text: drill.label }), h('span', { class: 'bd-drill-spacer' }));
  const card = h('section', { class: 'sec bd-box bd-chart bd-drill ' + drill.vt, 'aria-label': `${drill.label}: the projects behind the bar` }, head);
  if (data.error) { card.append(h('p', { class: 'muted', style: 'padding:12px 16px', text: data.error })); return card; }
  const { ytd, forecast, mwip } = data;
  if (!ytd.available) {
    card.append(h('p', { class: 'muted', style: 'padding:12px 16px', text: 'The detail was not saved with this report, because it was built before drill-downs existed. Archive and rerun it to get them.' }));
    return card;
  }
  // a project's bar is its revenue to date plus its forecast; pursuits follow as their own group
  const projects = new Map();
  for (const i of ytd.items) projects.set(i.id, { id: i.id, name: i.name, ytd: i.total, forecast: 0 });
  for (const i of forecast.items) { const p = projects.get(i.id) || { id: i.id, name: i.name, ytd: 0, forecast: 0 }; p.forecast = i.total; projects.set(i.id, p); }
  const proj = [...projects.values()].sort((a, b) => (b.ytd + b.forecast) - (a.ytd + a.forecast) || a.name.localeCompare(b.name));
  const purs = [...mwip.items].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const total = ytd.totals.total + forecast.totals.total + mwip.totals.total;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  card.append(h('p', { class: 'bd-drill-sub', text: `${plural(proj.length, 'project')} and ${plural(purs.length, 'pursuit')}, ${K(total)} in all: ${K(ytd.totals.total)} billed, ${K(forecast.totals.total)} forecast, ${K(mwip.totals.total)} MWIP.` }));
  if (!proj.length && !purs.length) { card.append(h('p', { class: 'muted', style: 'padding:12px 16px', text: 'Nothing here: no projects or pursuits are counted in this bar.' })); return card; }
  const rows = [
    ...proj.map(p => ({ label: shortName(p.name), segs: [{ v: p.ytd, kind: 'ytd', title: `${p.name} (${p.id}), YTD revenue` }, { v: p.forecast, kind: 'forecast', title: `${p.name} (${p.id}), revenue forecast` }], endText: K(p.ytd + p.forecast) })),
    ...purs.map((p, i) => ({ label: shortName(p.name), gapBefore: i === 0 && proj.length > 0, segs: [{ v: p.total, kind: 'mwip', title: `${p.name} (${p.id}), MWIP backlog` }], endText: K(p.total) })),
  ];
  const svg = stackedBars(rows, { fmt: K, rowHeight: 26, aria: `${drill.label}: each project's revenue to date and forecast, then each pursuit's MWIP backlog` });
  card.append(h('div', { class: 'bd-svgwrap' }, svg), legend(ctx, [['ytd', 'YTD revenue'], ['forecast', 'Revenue forecast'], ['mwip', 'MWIP backlog']]));
  const fold = (title, d) => (d.items.length ? h('details', { class: 'bd-fold' }, h('summary', { text: title }), table(ctx, d, drill)) : null);
  card.append(...[fold('Revenue forecast by month', forecast), fold('MWIP backlog by month', mwip)].filter(Boolean));
  return card;
}

/* forecast and MWIP: the Vantagepoint-style grid, a column for each remaining month */
function table(ctx, d, drill) {
  const { h } = ctx;
  const showPic = drill.scope !== 'pic', showSector = drill.scope !== 'sector';
  const th = (t, cls) => h('th', { class: cls || '', text: t });
  const cell = v => h('td', { class: 'r' + (v ? '' : ' bd-zero'), text: v ? money(v) : '-' });
  const first = d.kind === 'mwip' ? 'Pursuit' : 'Project';
  return h('div', { class: 'tblwrap' }, h('table', { class: 'dt bd-t' },
    h('thead', {}, h('tr', {}, th(first), showPic ? th('PIC') : null, showSector ? th('Market sector') : null, ...d.months.map(m => th(monthLabel(m), 'r')), th('Total', 'r'))),
    h('tbody', {}, ...d.items.map(i => h('tr', {},
      h('td', { class: 'bd-name' }, h('div', { class: 'strong', text: i.name }), h('div', { class: 'muted small', text: i.id })),
      showPic ? h('td', { text: i.picName }) : null, showSector ? h('td', { text: i.sector }) : null,
      ...d.months.map(m => cell(i.byMonth[m])), h('td', { class: 'r strong', text: money(i.total) })))),
    h('tfoot', {}, h('tr', { class: 'firm-row' }, h('td', { class: 'strong', text: 'Total' }), showPic ? h('td') : null, showSector ? h('td') : null,
      ...d.months.map(m => h('td', { class: 'r strong', text: money(d.totals.byMonth[m]) })), h('td', { class: 'r strong', text: money(d.totals.total) })))));
}
