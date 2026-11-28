/* Principal Accountability: the firm's accountability sheet, one row per PIC, with the firm figures under it.
   It is its own monthly report (draft, published and locked, archived and rerun), built from its own gross figures.
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
  let list = await Accountability.reports();
  if (!list.length) {
    body.append(h('div', { class: 'empty-note', text: isAdmin ? 'Nothing has been built yet. Build one in Admin > Report runs (Accountability).' : 'Nothing has been published yet.' }));
    return;
  }
  let id = wantedId && list.some(r => r.id === wantedId) ? wantedId : (list.find(r => r.status === 'published') || list[0]).id;
  const holder = h('div', { class: 'stack' });
  body.append(holder);
  const load = async () => { holder.textContent = ''; paint(await Accountability.report(id)); };
  // a rerun makes a new version, so the picker's list is read again whenever the report changes
  const go = async newId => { id = newId; history.replaceState(null, '', '#/accountability/' + newId); list = await Accountability.reports(); await load(); };

  function paint(d) {
    holder.textContent = '';
    const r = d.run;
    const pick = h('select', { class: 'txt', style: 'max-width:340px', 'aria-label': 'Report', onchange: e => go(e.target.value) },
      ...list.map(x => h('option', { value: x.id, text: x.label + (x.status === 'draft' ? ' (draft)' : x.status === 'archived' ? ' (archived)' : ''), selected: x.id === id })));
    // the picker names the month and version and the banner says when it was published, so beside the picker only the billing cutoff
    holder.append(
      h('div', { class: 'bd-tools' }, h('div', {}, h('label', { class: 'fl', text: 'Report' }), pick),
        d.available ? h('span', { class: 'muted', text: 'Billing cutoff ' + fmtDayYear(d.meta.cutoff) }) : null),
      banner(ctx, d, isAdmin, () => go(id), go));
    if (ctx.actions) ctx.actions(body, d.available ? exportMenu(ctx, {
      excel: () => ({ file: `Principal-Accountability-${fileSafe(r.label)}.xlsx`, sheets: A.toSheets(d) }),
      pdf: () => openExport(ctx, d),
    }) : null);
    if (!d.available) {
      holder.append(h('div', { class: 'empty-note', text: 'This version has no figures. Archive and rerun it to build them.' }));
      return;
    }
    holder.append(tableCard(ctx, d), firmCard(ctx, d));
    ctx.T.hydrateIcons(holder);
  }
  await load();
}

function banner(ctx, d, isAdmin, reload, go) {
  const { h, icon } = ctx;
  const r = d.run;
  const when = ms => { const t = fmtWhen(ms); return t.endsWith('.') ? t : t + '.'; }; // "11:56 p.m." already ends a sentence
  const text = r.status === 'published' ? `Published ${when(r.publishedAt)} Locked: it never changes.`
    : r.status === 'draft' ? 'Draft. Only you can see it until you publish.'
      : `Archived ${when(r.archivedAt)} Reason: ${r.archiveReason}`;
  const slot = h('div', { class: 'stack' });
  const msg = h('div', { role: 'alert' });
  async function act(fn) { msg.textContent = ''; try { const out = await fn(); if (out && out.run && out.run.id !== r.id) await go(out.run.id); else await reload(); } catch (e) { msg.append(ctx.banner('circle-alert', e.message, 'err')); } }
  const acts = [];
  if (isAdmin && r.status === 'draft') {
    acts.push(h('button', { class: 'btn', type: 'button', text: 'Rebuild draft', onclick: () => act(() => Accountability.rebuild(r.id)) }));
    acts.push(h('button', { class: 'btn primary', type: 'button', text: 'Publish for viewing', onclick: () => act(() => Accountability.publish(r.id)) }));
  }
  if (isAdmin && r.status === 'published') acts.push(h('button', { class: 'btn danger', type: 'button', text: 'Archive and rerun…', onclick: () => { slot.textContent = ''; slot.append(archivePanel(ctx, r, act)); ctx.T.hydrateIcons(slot); } }));
  return h('div', { class: 'stack' },
    h('div', { class: 'banner' + (r.status === 'draft' ? ' warn' : r.status === 'published' ? ' ok-banner' : '') }, h('span', { class: 'bmsg' }, icon(r.status === 'published' ? 'lock' : r.status === 'draft' ? 'info' : 'archive'), h('span', { text }))),
    acts.length ? h('div', { class: 'run-acts' }, ...acts) : null, msg, slot);
}

function archivePanel(ctx, run, act) {
  const { h } = ctx;
  const reason = h('textarea', { class: 'txt', rows: '2', style: 'height:auto;padding:8px 10px', 'aria-label': 'Reason for archiving', placeholder: 'For example: billings were corrected in Vantagepoint' });
  const word = h('input', { class: 'txt', type: 'text', style: 'width:120px', 'aria-label': 'Type RERUN to confirm', placeholder: 'RERUN', autocomplete: 'off' });
  const go = h('button', { class: 'btn danger', type: 'button', text: 'Archive and build a new draft', disabled: true });
  const ready = () => { go.disabled = !(reason.value.trim() && word.value.trim() === 'RERUN'); };
  reason.addEventListener('input', ready); word.addEventListener('input', ready);
  const panel = h('section', { class: 'sec', style: 'border-color:var(--crit)' },
    h('div', { class: 'sec-head' }, h('h2', { text: `Archive this report and build version ${run.version + 1}?` }), h('p', { text: 'Everyone who can see it has seen it. It stays on file, marked Archived, with your reason. Others keep seeing the last published report until you publish the new one.' })),
    h('div', { class: 'sec-body' }, ctx.row('Reason', 'Required.', reason), ctx.row('Type RERUN to confirm', null, word)),
    h('div', { class: 'sec-foot' }, h('span', { class: 'note', text: `${run.label} will be archived.` }), h('div', { class: 'acts' }, h('button', { class: 'btn quiet', type: 'button', text: 'Cancel', onclick: () => panel.remove() }), go)));
  go.addEventListener('click', () => act(() => Accountability.archive(run.id, reason.value, word.value)));
  return panel;
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
    h('div', { class: 'bd-legend', text: 'Difference: the income statement profit less the PICs\' project profit added up. Profit on architectural revenue: income statement profit plus the ESOP / bonus contribution, over architectural revenue (net of consultants, January through the report month).' }));
}
