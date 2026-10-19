/* The drill-down panel under a Marketing Report chart: what is behind the bar you clicked.
     dark green (YTD)   the projects, each with a bar for the revenue billed to date
     light green        the contracted forecast, a row per project and a column per remaining month (like the Vantagepoint report)
     gray (MWIP)        the same, a row per pursuit, with the factored amounts
   The numbers were frozen with the report, so they always add up to the bar. */
import { stackedBars } from '/shared/ui/charts.js';
import { Bd } from '/shared/platform/index.js';

const money = c => (c < 0 ? '-$' : '$') + Math.abs(Math.round(c / 100)).toLocaleString('en-US');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = m => `${MON[(m % 100) - 1]} ${Math.floor(m / 100)}`;
const shortName = n => (n.length > 30 ? n.slice(0, 29) + '…' : n);
const KIND = {
  ytd: { what: 'Revenue to date', by: 'by project', unit: 'project' },
  forecast: { what: 'Revenue forecast', by: 'by project and month', unit: 'project' },
  mwip: { what: 'MWIP backlog', by: 'by pursuit and month', unit: 'pursuit' },
};

export function drillPanel(ctx, runId, drill, onClose) {
  const { h } = ctx;
  const k = KIND[drill.kind];
  const body = h('div', { class: 'sec-body' }, h('p', { class: 'muted', style: 'padding:12px 16px', text: 'Loading…' }));
  const head = h('div', { class: 'sec-head' },
    h('h2', { text: `${drill.label}: ${k.what.toLowerCase()}, ${k.by}` }),
    h('button', { class: 'btn quiet sm', type: 'button', text: 'Close', onclick: onClose }));
  const panel = h('section', { class: 'sec bd-box bd-drill', 'aria-label': `Detail: ${drill.label}, ${k.what}` }, head, body);
  Bd.detail(runId, { kind: drill.kind, scope: drill.scope, key: drill.scope === 'firm' ? undefined : drill.key }).then(d => {
    body.textContent = '';
    if (!d.available) { body.append(h('p', { class: 'muted', style: 'padding:12px 16px', text: 'The detail was not saved with this report, because it was built before drill-downs existed. Archive and rerun it to get them.' })); return; }
    head.append(h('p', { text: `${d.items.length} ${k.unit}${d.items.length === 1 ? '' : 's'}, ${money(d.totals.total)} in all.` }));
    if (!d.items.length) { body.append(h('p', { class: 'muted', style: 'padding:12px 16px', text: `Nothing here: no ${k.unit}s are counted in this bar.` })); return; }
    body.append(d.kind === 'ytd' ? bars(ctx, d) : table(ctx, d, drill));
    ctx.T.hydrateIcons(panel);
  }).catch(e => { body.textContent = ''; body.append(h('p', { class: 'muted', style: 'padding:12px 16px', text: e.message })); });
  return panel;
}

/* revenue to date: a bar for each project, biggest first, its name on the left */
function bars(ctx, d) {
  const { h } = ctx;
  const svg = stackedBars(d.items.map(i => ({ key: i.id, label: shortName(i.name), segs: [{ v: i.total, kind: 'ytd', title: `${i.name} (${i.id})` }], endText: money(i.total) })),
    { fmt: c => `$${Math.round(c / 100000).toLocaleString('en-US')}K`, aria: 'Revenue billed to date, by project' });
  return h('div', { class: 'bd-svgwrap bd-chart' }, svg);
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
