/* Pipeline watch: weekly snapshots of MWIP (pursuits not yet contracted) and contracted forecast, by PIC, with this week's alerts.
   Everyone who may open it sees every PIC. Only the Admin can clear an alert or add a note (the server checks; the buttons are hidden for others). */
import { lineChart } from '/shared/ui/charts.js';
import { Pipeline } from '/shared/platform/index.js';

const K = c => `$${Math.round(Math.abs(c) / 100000).toLocaleString('en-US')}K`;
const signed = c => (c === null || c === undefined ? '' : c === 0 ? '$0' : (c > 0 ? '+' : '-') + K(c));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const day = d => { const [, m, dd] = d.split('-').map(Number); return `${MON[m - 1]} ${dd}`; };
const dayLong = d => { const [y, m, dd] = d.split('-').map(Number); return `${DOW[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()]} ${MON[m - 1]} ${dd}, ${y}`; };
const tone = c => (c === null || c === undefined || c === 0 ? '' : c < 0 ? ' pw-down' : ' pw-up');

export async function renderPipeline(ctx, body) {
  const { h } = ctx;
  const me = ctx.Session.me();
  const isAdmin = me.role === 'admin';
  const state = { date: null, kind: 'mwip', pic: null };
  const holder = h('div', { class: 'stack' });
  body.append(holder);

  async function load() {
    const d = await Pipeline.view(state.date, state.kind);
    if (d.empty) { holder.textContent = ''; holder.append(h('div', { class: 'empty-note', text: isAdmin ? 'No snapshot has been taken yet. Take one in Admin > Pipeline alerts, or run npm run pipeline-snapshot.' : 'No snapshot has been taken yet. The first one is saved on a Monday morning.' })); return; }
    state.date = d.date;
    paint(d);
  }

  function paint(d) {
    holder.textContent = '';
    const pick = h('select', { class: 'txt', style: 'max-width:340px', 'aria-label': 'Snapshot', onchange: e => { state.date = e.target.value; state.pic = null; load(); } },
      ...d.dates.map((x, i) => h('option', { value: x, text: `${dayLong(x)}${i === 0 ? ' (latest)' : ''}`, selected: x === d.date })));
    const exportBtn = h('button', { class: 'btn', type: 'button', text: 'Export CSV', title: 'A spreadsheet file that opens in Excel', onclick: async () => {
      try {
        const text = await Pipeline.exportCsv(d.date, d.kind);
        const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
        const a = h('a', { href: url, download: `pipeline-${d.kind}-${d.date}.csv` });
        document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
      } catch (e) { ctx.T.toast(e.message); }
    } });
    holder.append(
      h('p', { class: 'muted', style: 'margin:0', text: `Snapshot ${dayLong(d.date)} · Last ${d.weeks.length} weekly snapshots shown, older ones kept` }),
      h('div', { class: 'bd-tools' }, h('div', {}, h('label', { class: 'fl', text: 'Snapshot' }), pick), exportBtn),
      h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Pipeline tabs' },
        ...[['mwip', 'MWIP, not yet contracted'], ['forecast', 'Forecast, contracted']].map(([k, t]) => h('button', { type: 'button', role: 'tab', 'aria-pressed': String(state.kind === k), text: t, onclick: () => { state.kind = k; state.pic = null; load(); } }))));
    const main = h('div', { class: 'stack' }, tableCard(ctx, d, state, () => paint(d), sel => { state.pic = sel; paint(d); }));
    const aside = h('div', { class: 'stack' }, weekCard(ctx, d, isAdmin, pic => { state.pic = pic; paint(d); main.scrollIntoView?.({ block: 'nearest' }); }, load), chartCard(ctx, d));
    holder.append(h('div', { class: 'pw-grid' }, main, aside));
    if (state.pic) detailInto(ctx, main, d, state.pic, isAdmin);
    ctx.T.hydrateIcons(holder);
  }
  await load();
}

function tableCard(ctx, d, state, repaint, select) {
  const { h } = ctx;
  const MWIP = d.kind === 'mwip';
  const quiet = new Set(d.thisWeek.alerts.filter(a => a.rule === 'noNew').map(a => a.pic));
  const th = (t, cls) => h('th', { class: cls || 'r', html: t });
  const row = (r, firm) => {
    const pic = r.pic;
    return h('tr', { class: (firm ? 'firm-row' : 'pw-pick') + (pic && pic === state.pic ? ' pw-on' : ''), tabindex: firm ? null : '0', role: firm ? null : 'button', 'aria-label': firm ? null : `Show ${r.label}`,
      onclick: firm ? null : () => select(pic === state.pic ? null : pic),
      onkeydown: firm ? null : e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(pic === state.pic ? null : pic); } } },
    h('td', { class: 'strong', text: r.label }),
    ...r.values.map((v, i) => h('td', { class: 'r' + (i === r.values.length - 1 ? ' strong' : ' pw-old'), text: K(v) })),
    h('td', { class: 'r strong' + tone(r.thisWeek), text: signed(r.thisWeek) || '-' }),
    h('td', { class: 'r strong' + tone(r.vs4), text: signed(r.vs4) || '-' }),
    h('td', { class: 'r' }, MWIP ? (r.newPursuits === 0 && quiet.has(pic) ? h('span', { class: 'chip warn', text: '0' }) : h('span', { text: String(r.newPursuits) })) : h('span', { text: K(r.moved) })),
    h('td', { class: 'r', text: String(r.newContracts) }));
  };
  const heads = d.weeks.map(x => th(day(x).replace(' ', '<br>')));
  return h('section', { class: 'sec bd-box pw-table' },
    h('div', { class: 'sec-head' }, h('h2', { text: MWIP ? 'MWIP through year end, by PIC' : 'Contracted forecast through year end, by PIC' }),
      h('p', { text: MWIP
        ? 'Architectural revenue expected from pursuits that are not contracted yet, through December 31. It is not real until it is contracted, so it gets the most scrutiny here. It should drift down slowly as the year runs out, so a sudden drop usually means a pursuit was pushed or removed. That is fine if it converted to a project, and a problem if it just disappeared.'
        : 'Architectural revenue under contract and still to be billed through December 31. It falls as work is billed; a sudden drop usually means a project was pushed into next year.' })),
    h('div', { class: 'tblwrap' }, h('table', { class: 'dt bd-t pw-t' },
      h('thead', {}, h('tr', {}, h('th', { text: 'PIC' }), ...heads, th('This<br>week'), th('Vs 4 weeks<br>ago'), th(MWIP ? 'New pursuits,<br>30d' : 'Moved to<br>next year'), th('New contracts,<br>30d'))),
      h('tbody', {}, ...d.rows.map(r => row(r, false)), row(d.firm, true)))));
}

function weekCard(ctx, d, isAdmin, openPic, reload) {
  const { h } = ctx;
  const items = [];
  const tag = { alert: ['crit', 'Alert'], watch: ['warn', 'Watch'] };
  for (const a of d.thisWeek.alerts) {
    items.push(h('div', { class: 'pw-item' + (a.cleared ? ' pw-cleared' : '') },
      h('span', { class: 'chip ' + tag[a.severity][0], text: a.cleared ? 'Cleared' : tag[a.severity][1] }),
      h('div', { class: 'pw-t', text: a.title }), h('p', { class: 'pw-m', text: a.message }),
      h('div', { class: 'pw-b' },
        a.pic ? h('button', { class: 'btn sm', type: 'button', text: 'Open detail', onclick: () => openPic(a.pic) }) : null,
        isAdmin && !a.cleared ? h('button', { class: 'btn quiet sm', type: 'button', text: 'Clear', title: 'You have seen it. The next snapshot checks the rules again.', onclick: async () => { await Pipeline.clearAlert(a.id); reload(); } }) : null)));
  }
  for (const c of d.thisWeek.conversions) {
    items.push(h('div', { class: 'pw-item' }, h('span', { class: 'chip ok', text: 'Matched' }), h('div', { class: 'pw-t', text: c.title }), h('p', { class: 'pw-m', text: c.message }),
      h('div', { class: 'pw-b' }, h('button', { class: 'btn sm', type: 'button', text: 'Open detail', onclick: () => openPic(c.pic) }))));
  }
  return h('section', { class: 'sec bd-box pw-week' },
    h('div', { class: 'sec-head pw-wh' }, h('h2', { text: 'This week' }), h('span', { class: 'muted', text: `Snapshot ${day(d.date)}` })),
    items.length ? h('div', { class: 'pw-list' }, ...items) : h('div', { class: 'empty-row', text: 'Nothing needs a look this week.' }),
    h('div', { class: 'pw-foot' }, isAdmin
      ? h('span', {}, 'You get one email on Monday when alerts need a look. ', h('a', { href: '#/admin/pipeline', text: 'Change thresholds' }))
      : h('span', { text: 'Alerts are about the numbers, not the person. Watch items do not count toward the menu badge.' })));
}

function chartCard(ctx, d) {
  const { h } = ctx;
  const pts = d.chart.map((p, i) => ({ label: day(p.date).replace(/ /, ' '), value: p.amount, kind: i === d.chart.length - 1 ? 'now' : 'bar', tip: `${dayLong(p.date)}: ${K(p.amount)}` }));
  const svg = pts.length > 1 ? lineChart(pts, { fmt: v => K(v), aria: `Firm total ${d.kind === 'mwip' ? 'MWIP' : 'forecast'} at each Monday snapshot`, height: 230, ticks: 4 }) : h('p', { class: 'muted', text: 'The chart appears after the second snapshot.' });
  return h('section', { class: 'sec bd-box' }, h('div', { class: 'sec-head' }, h('h2', { text: 'Firm total by week' }), h('p', { text: `Through-year-end dollars at each Monday snapshot, last ${d.chart.length} weeks.` })), h('div', { class: 'bd-svgwrap' }, svg));
}

async function detailInto(ctx, main, d, pic, isAdmin) {
  const { h } = ctx;
  const slot = h('section', { class: 'sec bd-box pw-detail' }, h('div', { class: 'sec-head' }, h('p', { class: 'muted', text: 'Loading…' })));
  main.append(slot);
  let det;
  try { det = await Pipeline.detail(d.date, d.kind, pic); } catch (e) { slot.textContent = ''; slot.append(h('div', { class: 'empty-row', text: e.message })); return; }
  slot.textContent = '';
  const MWIP = det.kind === 'mwip';
  const unmatchedBanner = det.unmatched ? h('div', { class: 'banner err pw-warn' }, h('span', { class: 'bmsg' }, h('span', {}, h('b', { text: det.unmatched === 1 ? 'One pursuit left with no matching project. ' : `${det.unmatched} pursuits left with no matching project. ` }), 'Either it was lost, or it converted and nobody opened the job.'))) : null;
  const chipFor = it => it.status === 'removed' ? h('span', { class: 'chip crit', text: 'Removed' }) : it.status === 'converted' ? h('span', { class: 'chip ok', text: 'Converted' }) : it.stage ? h('span', { class: 'chip out', text: it.stage }) : h('span', { class: 'muted', text: '-' });
  const rows = det.items.map(it => {
    const noteBox = isAdmin && MWIP ? noteControl(ctx, it) : null;
    return h('tr', {},
      h('td', { class: 'strong', text: it.name }),
      MWIP ? h('td', {}, chipFor(it)) : null,
      h('td', { class: 'r', text: it.last === null ? '-' : K(it.last) }),
      h('td', { class: 'r', text: K(it.current) }),
      h('td', { class: 'r strong' + tone(it.change), text: it.change === null ? '' : signed(it.change) || '0' }),
      !MWIP ? h('td', { class: 'r', text: it.moved ? K(it.moved) : '-' }) : null,
      h('td', { class: 'pw-what' }, h('span', { text: it.what || '' }), ...(it.notes || []).map(n => h('div', { class: 'pw-note', text: `${n.by || 'Admin'}, ${new Date(n.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}: ${n.body}` })), noteBox));
  });
  slot.append(
    h('div', { class: 'sec-head' }, h('h2', { text: `${det.label}: ${MWIP ? 'MWIP pursuits' : 'contracted forecast'}` }), h('p', { text: MWIP ? 'Architectural revenue through year end. Each pursuit is tracked from the day it first appears.' : 'Each contract\'s remaining billing through year end, and the part pushed into next year.' })),
    unmatchedBanner,
    h('div', { class: 'tblwrap' }, h('table', { class: 'dt bd-t' },
      h('thead', {}, h('tr', {}, h('th', { text: MWIP ? 'Pursuit' : 'Project' }), MWIP ? h('th', { text: 'Stage' }) : null, h('th', { class: 'r', html: 'Last<br>snapshot' }), h('th', { class: 'r', html: 'This<br>snapshot' }), h('th', { class: 'r', text: 'Change' }), !MWIP ? h('th', { class: 'r', html: 'Moved to<br>next year' }) : null, h('th', { text: 'What happened' }))),
      h('tbody', {}, ...rows),
      h('tfoot', {}, h('tr', { class: 'firm-row' }, h('td', { class: 'strong', text: `${det.label.split(' ')[0]} total` }), MWIP ? h('td') : null, h('td', { class: 'r strong', text: det.total.last === null ? '-' : K(det.total.last) }), h('td', { class: 'r strong', text: K(det.total.current) }), h('td', { class: 'r strong' + tone(det.total.change), text: det.total.change === null ? '' : signed(det.total.change) || '0' }), !MWIP ? h('td') : null, h('td'))))));
  ctx.T.hydrateIcons(slot);
}

/* the Admin's note on a pursuit: a small link that opens a one-line box */
function noteControl(ctx, it) {
  const { h } = ctx;
  const wrap = h('div', { class: 'pw-notebox' });
  const open = h('button', { class: 'btn quiet sm', type: 'button', text: 'Add note' });
  open.addEventListener('click', () => {
    const input = h('input', { class: 'txt', type: 'text', maxlength: '500', 'aria-label': `Note on ${it.name}`, placeholder: 'For example: talked to the PIC; lost to a competitor' });
    const save = h('button', { class: 'btn primary sm', type: 'button', text: 'Save note' });
    const msg = h('span', { class: 'note err' });
    save.addEventListener('click', async () => {
      if (!input.value.trim()) { msg.textContent = 'Write the note first.'; return; }
      try { await Pipeline.addNote(it.id, input.value); wrap.textContent = ''; wrap.append(h('span', { class: 'saved', text: 'Saved. It shows the next time this opens.' })); } catch (e) { msg.textContent = e.message; }
    });
    wrap.textContent = ''; wrap.append(input, save, msg); input.focus();
  });
  wrap.append(open);
  return wrap;
}
