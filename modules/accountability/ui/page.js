/* Principal Accountability: the firm's accountability sheet, one row per PIC, with the firm figures under it.
   It is built and published with the Marketing Report for the same month, so the report picker lists those versions.
   Every figure on the page comes from AcctRules.sheet (logic/accountability.js), the same words the PDF and the CSV use. */
import { fmtDay, fmtDayYear, fmtWhen } from '/shared/ui/format.js';
import { Accountability } from '/shared/platform/index.js';
import { openExport } from './export.js';
import { exportMenu, fileSafe } from '/shared/ui/export-menu.js';

const A = window.AcctRules;
const isNeg = t => /^\(|^-\d/.test(t);

export async function renderAccountability(ctx, body, wantedId) {
  const { h } = ctx;
  const me = ctx.Session.me();
  const isAdmin = me.role === 'admin';
  const list = await Accountability.reports();
  if (!list.length) {
    body.append(h('div', { class: 'empty-note', text: isAdmin ? 'Nothing has been built yet. Principal Accountability is built with the Marketing Report: build one in Admin > Report runs.' : 'Nothing has been published yet.' }));
    return;
  }
  let id = wantedId && list.some(r => r.id === wantedId) ? wantedId : (list.find(r => r.status === 'published') || list[0]).id;
  const holder = h('div', { class: 'stack' });
  body.append(holder);
  const load = async () => { holder.textContent = ''; paint(await Accountability.report(id)); };
  const go = async newId => { id = newId; history.replaceState(null, '', '#/accountability/' + newId); await load(); };

  function paint(d) {
    holder.textContent = '';
    const r = d.run;
    const pick = h('select', { class: 'txt', style: 'max-width:340px', 'aria-label': 'Report', onchange: e => go(e.target.value) },
      ...list.map(x => h('option', { value: x.id, text: x.label + (x.status === 'draft' ? ' (draft)' : x.status === 'archived' ? ' (archived)' : ''), selected: x.id === id })));
    // the picker names the month and version and the banner says when it was published, so beside the picker only the billing cutoff
    holder.append(
      h('div', { class: 'bd-tools' }, h('div', {}, h('label', { class: 'fl', text: 'Report' }), pick),
        d.available ? h('span', { class: 'muted', text: 'Billing cutoff ' + fmtDayYear(d.meta.cutoff) }) : null),
      banner(ctx, d, isAdmin));
    if (ctx.actions) ctx.actions(body, d.available ? exportMenu(ctx, {
      excel: () => ({ file: `Principal-Accountability-${fileSafe(r.label)}.xlsx`, sheets: A.toSheets(d) }),
      pdf: () => openExport(ctx, d),
    }) : null);
    if (!d.available) {
      holder.append(h('div', { class: 'empty-note', text: 'This version was built before Principal Accountability existed, so it has no figures. Archive and rerun the Marketing Report for this month to add them.' }));
      return;
    }
    holder.append(tableCard(ctx, d), firmCard(ctx, d));
    ctx.T.hydrateIcons(holder);
  }
  await load();
}

function banner(ctx, d, isAdmin) {
  const { h, icon } = ctx;
  const r = d.run;
  const text = r.status === 'published' ? `Published ${fmtWhen(r.publishedAt)} with its Marketing Report. Locked: it never changes.`
    : r.status === 'draft' ? 'Draft. Only you can see it. It is published with the Marketing Report for the same month; rebuilding that draft rebuilds this one.'
      : `Archived ${fmtWhen(r.archivedAt)} with its Marketing Report. Reason: ${r.archiveReason}`;
  return h('div', { class: 'stack' },
    h('div', { class: 'banner' + (r.status === 'draft' ? ' warn' : r.status === 'published' ? ' ok-banner' : '') }, h('span', { class: 'bmsg' }, icon(r.status === 'published' ? 'lock' : r.status === 'draft' ? 'info' : 'archive'), h('span', { text }))),
    isAdmin && r.status === 'draft' ? h('div', { class: 'run-acts' }, h('a', { class: 'btn primary', href: '#/bd/' + r.id, text: 'Review and publish the Marketing Report draft' })) : null);
}

function tableCard(ctx, d) {
  const { h } = ctx;
  const s = A.sheet(d);
  // the heading row over the columns: one cell per group, spanning its columns
  const spans = [];
  for (const c of s.columns) { const last = spans[spans.length - 1]; if (last && last.group === c.group) last.n++; else spans.push({ group: c.group, n: 1 }); }
  const cell = (t, i, cls) => {
    const col = s.columns[i];
    if (col.id === 'response' && (t === 'Yes' || t === 'No')) return h('td', { class: 'acct-c' }, h('span', { class: 'chip ' + (t === 'Yes' ? 'ok' : 'warn'), text: t }));
    return h('td', { class: [i === 0 ? '' : col.id === 'response' ? 'acct-c' : 'r', col.group === 'projects' ? 'acct-proj' : '', col.id === 'goal' ? 'bd-goal' : '', isNeg(t) ? 'acct-neg' : '', cls || ''].filter(Boolean).join(' '), text: t });
  };
  const unevaluated = d.rows.reduce((a, r) => a + r.unevaluated, 0);
  const notes = [
    s.pace ? `${s.pace.label} (pace, the goals times ${d.meta.months} months over twelve): ${s.pace.value}.` : null,
    d.meta.hasTurnaround ? `Negative profit response: Yes when every one of the PIC's projects on the Project Turnaround run has a Current plan, as of ${fmtDay(d.meta.statusDay)}; a dash when none of their projects is on it.` : 'Negative profit response: no Project Turnaround run had been published yet.',
    'Shortfall / (excess): the goal less billed and backlog; in brackets, the backlog more than covers the goal. Projects to reach goal: how many projects of each fee would close the shortfall.',
    unevaluated ? `${unevaluated} ${unevaluated === 1 ? 'project has' : 'projects have'} billings but no overhead rate in Vantagepoint, so ${unevaluated === 1 ? 'its' : 'their'} billings count and ${unevaluated === 1 ? 'its' : 'their'} profit does not.` : null,
  ].filter(Boolean);
  return h('section', { class: 'sec bd-box bd-table acct-table' },
    h('div', { class: 'sec-head bd-sum', text: `Totals: billed ${s.total[1]} of ${s.total[7] || 'no goal'} · YTD profit ${s.total[2]} · negative profit ${s.total[4]}` }),
    h('div', { class: 'tblwrap' }, h('table', { class: 'dt bd-t' },
      h('thead', {},
        h('tr', { class: 'acct-groups' }, ...spans.map(g => h('th', { colspan: String(g.n), class: g.group ? 'acct-g' : '', text: s.groups[g.group] || '' }))),
        h('tr', {}, ...s.columns.map((c, i) => h('th', { class: i === 0 ? '' : 'r', text: c.head })))),
      h('tbody', {}, ...s.body.map(row => h('tr', {}, ...row.map((t, i) => cell(t, i)))),
        h('tr', { class: 'firm-row acct-total' }, ...s.total.map((t, i) => cell(t, i)))))),
    h('div', { class: 'bd-legend acct-notes' }, ...notes.map(t => h('p', { text: t }))));
}

function firmCard(ctx, d) {
  const { h } = ctx;
  const s = A.sheet(d);
  return h('section', { class: 'sec bd-box acct-firm' },
    h('div', { class: 'sec-head bd-sum', text: 'The firm, year to date' }),
    h('dl', { class: 'acct-dl' }, ...s.firm.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { class: isNeg(v) ? 'acct-neg' : '', text: v || 'Not in the source yet' })])),
    h('div', { class: 'bd-legend', text: 'Difference: the income statement profit less the PICs\' project profit added up. Profit on architectural revenue: income statement profit plus the ESOP / bonus contribution, over architectural revenue (net of consultants, from the Marketing Report).' }));
}
