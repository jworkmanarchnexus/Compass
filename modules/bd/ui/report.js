/* The BD report: revenue against goal, by PIC and by market sector, with the status of each row and two charts.
   What each person sees was decided by the server (a PIC gets no MWIP factor or raw amounts; only the Admin gets warnings and controls). */
import { stackedBars } from '/shared/ui/charts.js';
import { fmtDay, fmtDayYear, fmtWhen, plural } from '/shared/ui/format.js';
import { Bd } from '/shared/platform/index.js';
import { openExport } from './export.js';

const K = c => `$${Math.round(c / 100000).toLocaleString('en-US')}K`;
const pct = (n, d) => (d ? `${(100 * n / d).toFixed(1)}%` : '-');
const STATUS = { on_track: ['ok', 'On Track'], on_pace: ['warn', 'On Pace'], behind: ['crit', 'Behind Pace'] };
const money = c => `$${Math.round(c / 100).toLocaleString('en-US')}`;

export async function renderBd(ctx, body, wantedId) {
  const { h } = ctx;
  const me = ctx.Session.me();
  const isAdmin = me.role === 'admin';
  const list = await Bd.reports();
  if (!list.length) {
    body.append(h('div', { class: 'empty-note', text: isAdmin ? 'No BD report has been built yet. Build one in Admin > Report runs.' : 'No BD report has been published yet.' }));
    return;
  }
  let id = wantedId && list.some(r => r.id === wantedId) ? wantedId : (list.find(r => r.status === 'published') || list[0]).id;
  let tab = 'pic';
  const holder = h('div', { class: 'stack' });
  body.append(holder);

  const load = async () => { holder.textContent = ''; const data = await Bd.report(id); paint(data); };
  const go = async newId => { id = newId; history.replaceState(null, '', '#/bd/' + newId); await load(); };

  function paint(d) {
    holder.textContent = '';
    const r = d.run;
    const status = { draft: 'Draft', published: 'Published, locked', archived: 'Archived' }[r.status];
    const pick = h('select', { class: 'txt', style: 'max-width:340px', 'aria-label': 'Report', onchange: e => go(e.target.value) },
      ...list.map(x => h('option', { value: x.id, text: x.label + (x.status === 'draft' ? ' (draft)' : x.status === 'archived' ? ' (archived)' : ''), selected: x.id === id })));
    const sub = `Period ${String(r.period).replace(/(\d{4})(\d{2})/, '$1-$2')} · Billing cutoff ${fmtDayYear(d.meta.cutoff)} · Version ${r.version} · ${status}`;
    holder.append(
      h('p', { class: 'muted', style: 'margin:0', text: sub }),
      h('div', { class: 'bd-tools' }, h('div', {}, h('label', { class: 'fl', text: 'Report' }), pick), h('button', { class: 'btn', type: 'button', text: 'Export PDF', onclick: () => openExport(ctx, d) })),
      banner(ctx, d, isAdmin, load, go),
      ...(isAdmin && d.warnings && d.warnings.length ? [warningsCard(ctx, d, load)] : []));
    holder.append(h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Report tabs' },
      ...[['pic', 'By PIC'], ['sector', 'By market sector']].map(([k, label]) => h('button', { type: 'button', role: 'tab', 'aria-pressed': String(tab === k), text: label, onclick: () => { tab = k; paint(d); } }))));
    holder.append(tableCard(ctx, d, tab), firmChart(ctx, d), rowChart(ctx, d, tab));
    ctx.T.hydrateIcons(holder);
  }
  await load();
}

function banner(ctx, d, isAdmin, reload, go) {
  const { h, icon } = ctx;
  const r = d.run;
  const notes = d.notes.length ? ` ${d.notes.join('. ')}.` : '';
  const text = r.status === 'published' ? `Published ${fmtWhen(r.publishedAt)}${r.publishedBy ? ' by ' + r.publishedBy : ''}. Billing cutoff ${fmtDay(d.meta.cutoff)}.${notes}`
    : r.status === 'draft' ? `Draft. Only you can see it until you publish.${notes}`
      : `Archived ${fmtWhen(r.archivedAt)}. Reason: ${r.archiveReason}`;
  const unresolved = (d.warnings || []).filter(w => w.kind === 'no_sector').length;
  const acts = [];
  if (isAdmin && r.status === 'draft') {
    acts.push(h('button', { class: 'btn', type: 'button', text: 'Rebuild draft', onclick: () => act(() => Bd.rebuild(r.id)) }));
    acts.push(h('button', { class: 'btn primary', type: 'button', text: 'Publish for viewing', disabled: unresolved > 0, title: unresolved ? 'Pick a market sector for each project below first' : '', onclick: () => act(() => Bd.publish(r.id)) }));
  }
  if (isAdmin && r.status === 'published') acts.push(h('button', { class: 'btn danger', type: 'button', text: 'Archive and rerun…', onclick: () => { slot.append(archivePanel(ctx, r, act)); ctx.T.hydrateIcons(slot); } }));
  const slot = h('div', { class: 'stack' });
  const msg = h('div', { role: 'alert' });
  async function act(fn) { msg.textContent = ''; try { const out = await fn(); if (out && out.run && out.run.id !== r.id) await go(out.run.id); else await reload(); } catch (e) { msg.append(ctx.banner('circle-alert', e.message, 'err')); } }
  return h('div', { class: 'stack' },
    h('div', { class: 'banner' + (r.status === 'draft' ? ' warn' : r.status === 'published' ? ' ok-banner' : '') }, h('span', { class: 'bmsg' }, icon(r.status === 'published' ? 'lock' : r.status === 'draft' ? 'info' : 'archive'), h('span', { text }))),
    acts.length ? h('div', { class: 'run-acts' }, ...acts) : null, msg, slot);
}

function archivePanel(ctx, run, act) {
  const { h } = ctx;
  const reason = h('textarea', { class: 'txt', rows: '2', style: 'height:auto;padding:8px 10px', 'aria-label': 'Reason for archiving', placeholder: 'For example: the billing cutoff was set to the wrong date' });
  const word = h('input', { class: 'txt', type: 'text', style: 'width:120px', 'aria-label': 'Type RERUN to confirm', placeholder: 'RERUN', autocomplete: 'off' });
  const go = h('button', { class: 'btn danger', type: 'button', text: 'Archive and build a new draft', disabled: true });
  const ready = () => { go.disabled = !(reason.value.trim() && word.value.trim() === 'RERUN'); };
  reason.addEventListener('input', ready); word.addEventListener('input', ready);
  const panel = h('section', { class: 'sec', style: 'border-color:var(--crit)' },
    h('div', { class: 'sec-head' }, h('h2', { text: `Archive this report and build version ${run.version + 1}?` }), h('p', { text: 'PICs and Finance have already seen it. It stays on file, marked Archived, with your reason. Others keep seeing the last published report until you publish the new one.' })),
    h('div', { class: 'sec-body' }, ctx.row('Reason', 'Required.', reason), ctx.row('Type RERUN to confirm', null, word)),
    h('div', { class: 'sec-foot' }, h('span', { class: 'note', text: `${run.label} will be archived.` }), h('div', { class: 'acts' }, h('button', { class: 'btn quiet', type: 'button', text: 'Cancel', onclick: () => panel.remove() }), go)));
  go.addEventListener('click', () => act(() => Bd.archive(run.id, reason.value, word.value)));
  return panel;
}

/* revenue with no market sector: the Admin picks one, the draft is rebuilt */
function warningsCard(ctx, d, reload) {
  const { h } = ctx;
  const rows = d.warnings.map(w => {
    if (w.kind !== 'no_sector') return h('div', { class: 'set-row' }, h('div', { class: 'what' }, h('div', { class: 'lab', text: w.detail }), h('div', { class: 'help', text: 'Fix it in Vantagepoint; the next report picks it up.' })), h('div', { class: 'ctl' }, h('span', { class: 'chip warn', text: money(w.amount) })));
    const sel = h('select', { class: 'txt', style: 'width:220px', 'aria-label': `Market sector for ${w.detail}` }, h('option', { value: '', text: 'Pick a sector…' }), ...d.sectors.filter(s => s !== 'Labs').map(s => h('option', { value: s, text: s })));
    const msg = h('span', { class: 'muted small' });
    const apply = h('button', { class: 'btn primary sm', type: 'button', text: 'Assign and rebuild', onclick: async () => {
      if (!sel.value) { msg.textContent = 'Pick a sector first.'; return; }
      try { await Bd.setSector(w.wbs1, sel.value); await Bd.rebuild(d.run.id); await reload(); } catch (e) { msg.textContent = e.message; }
    } });
    return h('div', { class: 'set-row' }, h('div', { class: 'what' }, h('div', { class: 'lab', text: w.detail }), h('div', { class: 'help', text: `${money(w.amount)} at stake. The answer is remembered for later reports.` })), h('div', { class: 'ctl' }, sel, apply, msg));
  });
  return h('section', { class: 'sec' }, h('div', { class: 'sec-head' }, h('h2', { text: `Needs you before you publish (${d.warnings.length})` }), h('p', { text: 'Revenue with no market sector cannot be published until you say where it belongs.' })), h('div', { class: 'sec-body' }, ...rows));
}

function tableCard(ctx, d, tab) {
  const { h } = ctx;
  const rows = tab === 'pic' ? d.pic : d.sector;
  const f = d.firm;
  const th = (t, cls) => h('th', { class: cls || 'r', html: t });
  const row = (r, firm) => h('tr', { class: firm ? 'firm-row' : '' },
    h('td', { class: firm ? 'strong' : '', text: r.label }),
    ...[r.goal, r.ytdGoal, r.ytd, r.forecast, r.mwip, r.total].map((v, i) => h('td', { class: 'r' + (i === 0 ? ' bd-goal' : i === 1 ? ' bd-pace' : i === 5 ? ' strong' : ''), text: K(v) })),
    h('td', { class: 'r bd-pct-pace', text: pct(r.ytd, r.ytdGoal) }), h('td', { class: 'r bd-pct-goal', text: pct(r.ytd + r.forecast, r.goal) }), h('td', { class: 'r bd-pct-goal strong', text: pct(r.total, r.goal) }),
    h('td', { class: 'bd-status' }, r.status ? h('span', { class: 'chip ' + STATUS[r.status][0], text: STATUS[r.status][1] }) : h('span', { class: 'muted', text: '-' })));
  const summary = `Total firm: total projected ${K(f.total)}  |  Annual goal: ${K(f.goal)} (${pct(f.total, f.goal)} of goal)`;
  const legend = `On Track: YTD + forecast + MWIP reaches ${d.meta.onTrackPct === 100 ? 'the annual goal' : d.meta.onTrackPct + '% of the annual goal'}  |  On Pace: YTD billings are at least ${d.meta.onPacePct}% of pace, but need more planned revenue  |  Behind Pace: YTD billings are behind pace`;
  return h('section', { class: 'sec bd-box bd-table' },
    h('div', { class: 'sec-head bd-sum', text: summary }),
    h('div', { class: 'tblwrap' }, h('table', { class: 'dt bd-t' },
      h('thead', {}, h('tr', {}, h('th', { text: tab === 'pic' ? 'PIC' : 'Market sector' }), th('Revenue goal'), th('YTD goal<br>(pace)'), th('YTD revenue'), th('Revenue forecast'), th('MWIP backlog'), th('Total projected'), th('% of pace billed'), th('% of goal<br>YTD + forecast'), th('% of goal<br>YTD + forecast<br>+ MWIP'), th('Status', ''))),
      h('tbody', {}, row(f, true), ...rows.map(r => row(r, false))))),
    h('div', { class: 'bd-legend', text: legend }),
    d.meta.factor ? h('div', { class: 'bd-legend', text: `MWIP backlog is weighted: pursuits at face value (${K(f.mwipRaw)}) times ${d.meta.factor}.` }) : null);
}

function firmChart(ctx, d) {
  const { h } = ctx;
  const f = d.firm;
  const remaining = Math.max(0, f.goal - f.ytdGoal);
  const svg = stackedBars([
    { label: 'Total firm', segs: [{ v: f.ytd, kind: 'ytd', text: K(f.ytd), title: 'YTD revenue' }, { v: f.forecast, kind: 'forecast', text: K(f.forecast), title: 'Revenue forecast' }, { v: f.mwip, kind: 'mwip', title: 'MWIP backlog' }], endText: K(f.mwip) },
    { label: 'Annual goal', segs: [{ v: f.ytdGoal, kind: 'pace', text: K(f.ytdGoal), title: 'Goal achieved (pace)' }, { v: remaining, kind: 'rest', text: K(remaining), title: 'Goal remaining' }] },
  ], { fmt: K, aria: 'Firm total: revenue, forecast and MWIP against the annual goal' });
  return h('section', { class: 'sec bd-box bd-chart' }, h('div', { class: 'sec-head bd-sum', text: `Total firm: total projected ${K(f.total)}  |  Annual goal: ${K(f.goal)} (${pct(f.total, f.goal)} of goal)` }), h('div', { class: 'bd-svgwrap' }, svg),
    legend(ctx, [['ytd', 'YTD revenue'], ['forecast', 'Revenue forecast'], ['mwip', 'MWIP backlog'], ['pace', 'Goal achieved (pace)'], ['rest', 'Goal remaining']]));
}

function rowChart(ctx, d, tab) {
  const { h } = ctx;
  const rows = (tab === 'pic' ? d.pic : d.sector).filter(r => r.total > 0).slice().sort((a, b) => b.total - a.total);
  const svg = stackedBars(rows.map(r => ({
    label: r.label, segs: [{ v: r.ytd, kind: 'ytd', text: K(r.ytd), title: 'YTD revenue' }, { v: r.forecast, kind: 'forecast', text: K(r.forecast), title: 'Revenue forecast' }, { v: r.mwip, kind: 'mwip', title: 'MWIP backlog' }],
    marks: [{ v: r.ytdGoal, kind: 'pace', title: `Pace to date: ${K(r.ytdGoal)}` }, { v: r.goal, kind: 'goal', title: `Annual goal: ${K(r.goal)}` }], endText: K(r.mwip) })),
  { fmt: K, aria: `${tab === 'pic' ? 'PICs' : 'Market sectors'}: revenue, forecast and MWIP against pace and annual goal` });
  return h('section', { class: 'sec bd-box bd-chart' }, h('div', { class: 'sec-head bd-sum', text: tab === 'pic' ? 'By PIC' : 'By market sector' }), h('div', { class: 'bd-svgwrap' }, svg),
    legend(ctx, [['ytd', 'YTD revenue'], ['forecast', 'Revenue forecast'], ['mwip', 'MWIP backlog'], ['markpace', 'Pace to date (goal x months / 12)'], ['markgoal', 'Annual goal']]),
    h('div', { class: 'bd-legend', text: 'Labels in thousands.' }));
}

function legend({ h }, items) {
  return h('div', { class: 'bd-keys' }, ...items.map(([k, t]) => h('span', { class: 'bd-key' }, h('i', { class: 'sw sb-' + k }), t)));
}
void plural;
