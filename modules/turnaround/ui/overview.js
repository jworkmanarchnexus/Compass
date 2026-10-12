/* The Project Turnaround page: KPI strip, two charts, and a card per PIC.
   Same page for the admin (any run, draft included) and for everyone else (the last published run).
   What each person sees was already decided by the server; this file only draws it. */
import { negativeBars, lineChart } from '/shared/ui/charts.js';
import { fmtCents, fmtK, fmtLoss, fmtWholePct, fmtM, fmtDay, fmtPeriod, monthLetter, initials, plural } from '/shared/ui/format.js';

export function planChip({ h }, plan) {
  if (plan.status === 'current') return h('span', { class: 'chip ok', text: 'Current' });
  if (plan.status === 'update_due') return h('span', { class: 'chip warn', text: `Update due ${fmtDay(plan.dueDate)}` });
  if (plan.status === 'overdue') return h('span', { class: 'chip crit', text: `Overdue ${plural(plan.daysOverdue, 'day')}` });
  return plan.daysOverdue > 0
    ? h('span', { class: 'chip crit', text: `No plan, ${plural(plan.daysOverdue, 'day')}`, title: `A plan was due ${fmtDay(plan.dueDate)}` })
    : h('span', { class: 'chip out', text: 'No plan yet', title: `A plan is due ${fmtDay(plan.dueDate)}` });
}

const STANDING = { good: ['ok', 'Good standing'], needs_attention: ['warn', 'Needs attention'], escalated: ['crit', 'Escalated'] };

export function renderOverview(ctx, container, data, opts) {
  const { h, icon } = ctx;
  const o = opts || {};
  const me = data.viewer;
  const isPic = me.role === 'pic';
  const mineExists = isPic && data.pics.some(p => p.code === me.picCode);
  let scope = mineExists ? 'mine' : 'all';
  const holder = h('div', { class: 'stack' });
  const toggle = h('div', { class: 'seg', role: 'group', 'aria-label': 'Whose projects' });
  const paint = () => {
    holder.textContent = '';
    toggle.textContent = '';
    if (mineExists) {
      for (const [k, label] of [['mine', 'Just mine'], ['all', 'Everyone']]) toggle.append(h('button', { type: 'button', 'aria-pressed': String(scope === k), text: label, onclick: () => { scope = k; paint(); } }));
    }
    const pics = scope === 'mine' ? data.pics.filter(p => p.code === me.picCode) : data.pics;
    holder.append(kpiStrip(ctx, data, scope === 'mine' ? pics[0] : null), chartRow(ctx, data, scope === 'mine' ? pics[0] : null));
    for (const p of pics) holder.append(picCard(ctx, p, data, scope === 'mine'));
    if (!pics.length) holder.append(h('div', { class: 'empty-note', text: 'No projects are below break-even.' }));
    ctx.T.hydrateIcons(holder);
  };
  container.append(h('div', { class: 'ov-head' }, mineExists ? toggle : null), holder);
  paint();
  void icon; void o;
}

function kpi({ h }, label, big, sub, extra) {
  return h('div', { class: 'kpi' }, h('div', { class: 'k-label', text: label }), h('div', { class: 'k-big', text: big }), h('div', { class: 'k-sub' }, sub, extra || null));
}

function kpiStrip(ctx, data, mine) {
  const { h } = ctx;
  const k = data.kpis;
  if (mine) {
    const needs = mine.projects.filter(p => p.plan.status === 'overdue' || p.plan.status === 'no_plan').length;
    const r = mine.record;
    return h('div', { class: 'kpis' },
      kpi(ctx, 'Your negative YTD profit', fmtCents(mine.totals.profit), `${fmtLoss(100 * mine.totals.profit / mine.totals.billed)} of ${fmtCents(mine.totals.billed)} billed, ${plural(mine.projects.length, 'project')}`),
      kpi(ctx, 'Plans current', `${mine.plansCurrent.current} of ${mine.plansCurrent.total}`, 'Open commitment, entry in the last 30 days, nothing past due'),
      kpi(ctx, 'Need action', String(needs), needs ? 'Past due or no plan yet' : 'Nothing is past due'),
      r ? kpi(ctx, 'Your record', r.pctOnTime === null ? 'No record yet' : `${fmtWholePct(r.pctOnTime)} on time`,
        `${r.onTime.onTime} of ${r.onTime.total} updates on time, ${r.kept.kept} of ${r.kept.resolved} commitments kept`) : kpi(ctx, 'Your record', '-', 'Not shown'));
  }
  const s = data.since;
  const waiting = k.pastDue + k.noPlan;
  const drafts = k.draftsReady !== null && k.draftsReady !== undefined
    ? h('span', {}, ' ', h('a', { href: '#/turnaround/checkins', text: plural(k.draftsReady, 'check-in draft') + ' ready' }), '.') : null;
  return h('div', { class: 'kpis' },
    kpi(ctx, 'Total negative YTD profit', fmtCents(k.negativeYtd), `${fmtLoss(100 * k.negativeYtd / k.billedYtd)} of ${fmtM(k.billedYtd)} billed, ${plural(k.projectCount, 'project')}`),
    kpi(ctx, 'Plans current', `${k.plansCurrent} of ${k.projectCount}`, 'Open commitment, entry in the last 30 days, nothing past due'),
    kpi(ctx, 'Waiting on an update', String(waiting), `${k.pastDue} past due, ${k.noPlan} with no plan yet.`, drafts),
    s ? kpi(ctx, `Since ${s.label.split(' ')[0]}`, `${s.off} off, ${s.added} new`, `${s.improved} improved, ${s.worse} got worse`)
      : kpi(ctx, 'Since last month', '-', 'This is the first run'));
}

function chartRow(ctx, data, mine) {
  const { h } = ctx;
  const hist = mine ? mine.history : data.history;
  if (!hist.length) return mine ? h('div', { class: 'empty-note', text: 'The charts for your own projects are not available for this run. Switch to Everyone to see the firm-wide charts.' }) : h('div', {});
  const years = new Set();
  const pts = hist.map((p, i) => {
    const first = i === 0 || p.period % 100 === 1;
    return { label: monthLetter(p.period), yearLabel: first ? String(Math.floor(p.period / 100)) : null, kind: i === hist.length - 1 ? 'now' : p.lastYear ? 'prev' : 'bar', value: p.negativeYtd, count: p.belowCount, period: p.period };
  });
  void years;
  const last = hist[hist.length - 1], prev = hist[hist.length - 2];
  const deeper = prev ? last.negativeYtd - prev.negativeYtd : 0;
  const fewer = prev ? last.belowCount - prev.belowCount : 0;
  const prevName = prev ? fmtPeriod(prev.period).split(' ')[0] : '';
  const bars = negativeBars(pts.map(p => ({ label: p.label, yearLabel: p.yearLabel, value: p.value, kind: p.kind, tip: `${fmtPeriod(p.period)}: ${fmtCents(p.value)} (${plural(p.count, 'project')} below break-even)` })),
    { fmt: v => fmtK(v), aria: 'Total negative year-to-date profit at each month end, last 12 months' });
  const line = lineChart(pts.map(p => ({ label: p.label, yearLabel: p.yearLabel, value: p.count, kind: p.kind, tip: `${fmtPeriod(p.period)}: ${plural(p.count, 'project')} below break-even` })),
    { fmt: v => String(v), aria: 'Projects below break-even at each month end, last 12 months', ticks: 4 });
  return h('div', { class: 'charts' },
    h('div', { class: 'chart-card' },
      h('div', { class: 'chart-head' }, h('div', {}, h('h2', { text: mine ? 'Your negative YTD profit' : 'Total negative YTD profit' }), h('p', { class: 'muted', text: 'In thousands. Gray is last year.' })),
        h('div', { class: 'chart-num' }, h('strong', { text: fmtK(last.negativeYtd).replace('+', '') }), prev ? h('span', { class: 'muted', text: `${fmtK(Math.abs(deeper)).replace('+', '')} ${deeper <= 0 ? 'deeper' : 'shallower'} than ${prevName}` }) : null)),
      bars),
    h('div', { class: 'chart-card' },
      h('div', { class: 'chart-head' }, h('div', {}, h('h2', { text: mine ? 'Your projects below break-even' : 'Projects below break-even' }), h('p', { class: 'muted', text: mine ? 'Your active projects below $0 YTD at each month end.' : 'Active projects below $0 YTD at each month end.' })),
        h('div', { class: 'chart-num' }, h('strong', { text: String(last.belowCount) }), prev ? h('span', { class: 'muted', text: fewer === 0 ? `Same as ${prevName}` : `${plural(Math.abs(fewer), 'project')} ${fewer < 0 ? 'fewer' : 'more'} than ${prevName}` }) : null)),
      line));
}

function picCard(ctx, pic, data, solo) {
  const { h, icon } = ctx;
  const body = h('div', { class: 'tblwrap' }, projectTable(ctx, pic));
  const r = pic.record;
  const chevron = h('button', { class: 'ib', type: 'button', 'aria-label': `Show or hide ${pic.name}'s projects`, 'aria-expanded': 'true' }, icon('chevron-down'));
  const sec = h('section', { class: 'pic' },
    h('header', { class: 'pic-head' },
      h('span', { class: 'avatar', text: initials(pic.name) }),
      h('h2', { text: pic.name }),
      h('span', { class: 'muted', text: plural(pic.projects.length, 'project') }),
      h('span', { class: 'pic-total', text: fmtCents(pic.totals.profit) }),
      h('span', { class: 'muted', text: `${fmtLoss(100 * pic.totals.profit / pic.totals.billed)} of ${fmtCents(pic.totals.billed)} billed` }),
      h('span', { class: 'pic-rec' },
        h('span', { class: 'muted', text: 'Plans current' }),
        h('span', { class: 'pbar', role: 'img', 'aria-label': `${pic.plansCurrent.current} of ${pic.plansCurrent.total} plans current` }, h('span', { style: `width:${pic.plansCurrent.total ? 100 * pic.plansCurrent.current / pic.plansCurrent.total : 0}%` })),
        h('strong', { text: `${pic.plansCurrent.current} of ${pic.plansCurrent.total}` }),
        r ? h('span', { class: 'muted' }, 'On time ', h('strong', { text: r.pctOnTime === null ? '-' : fmtWholePct(r.pctOnTime) })) : null,
        r ? h('span', { class: 'muted' }, 'Kept ', h('strong', { text: `${r.kept.kept} of ${r.kept.resolved}` })) : null,
        r && STANDING[r.standing] && ctx.showStanding !== false ? h('span', { class: 'chip ' + STANDING[r.standing][0], text: STANDING[r.standing][1] }) : null),
      chevron),
    body);
  chevron.addEventListener('click', () => { const open = body.hidden; body.hidden = !open; chevron.setAttribute('aria-expanded', String(open)); chevron.style.transform = open ? '' : 'rotate(-90deg)'; });
  void solo; void data;
  return sec;
}

function projectTable(ctx, pic) {
  const { h } = ctx;
  const go = wbs1 => { location.hash = '#/turnaround/p/' + encodeURIComponent(wbs1); };
  return h('table', { class: 'dt ptab' },
    h('thead', {}, h('tr', {}, h('th', { text: 'Project' }), h('th', { class: 'r', text: 'Profit YTD' }), h('th', { text: 'Plan' }), h('th', { text: 'Latest update' }), h('th', { text: 'Next commitment' }))),
    h('tbody', {}, ...pic.projects.map(p => h('tr', { tabindex: '0', class: 'clickable', onclick: () => go(p.wbs1), onkeydown: e => { if (e.key === 'Enter') go(p.wbs1); } },
      h('td', {}, h('a', { class: 'strong plink', href: '#/turnaround/p/' + encodeURIComponent(p.wbs1), text: p.name, onclick: e => e.stopPropagation() }), h('div', { class: 'muted', text: `${p.wbs1} · PM ${p.pm.name}` })),
      h('td', { class: 'r' }, h('div', { class: 'strong', text: fmtCents(p.profit.ytd) }), h('div', { class: 'muted', text: fmtLoss(p.pctYtd) })),
      h('td', {}, planChip(ctx, p.plan)),
      h('td', { class: 'latest' }, p.latest ? h('div', {}, h('strong', { text: fmtDay(p.latest.date) }), h('div', { class: 'clamp', text: p.latest.text })) : h('em', { class: 'muted', text: 'Nothing logged yet.' })),
      h('td', {}, nextCell(ctx, p))))));
}

function nextCell({ h }, p) {
  if (!p.next) return h('em', { class: 'muted', text: 'None' });
  const n = p.next;
  const chip = n.pastDue ? h('span', { class: 'chip crit', text: `Past due ${plural(n.daysPastDue, 'day')}` })
    : n.revisions ? h('span', { class: 'chip out', text: n.revisions === 1 ? 'Date moved once' : `Date moved ${n.revisions} times` })
      : h('span', { class: 'chip warn', text: 'Open' });
  return h('div', {}, h('div', { class: 'next-line' }, h('strong', { text: fmtDay(n.dueDate) }), ' ', chip), h('div', { class: 'clamp', text: n.text }),
    p.earlierMissed ? h('div', { class: 'warn-text', text: `${plural(p.earlierMissed, 'earlier commitment')} missed` }) : null);
}
