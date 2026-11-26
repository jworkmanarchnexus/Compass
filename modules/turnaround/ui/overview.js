/* The Project Turnaround page: four figures beside the profit chart, then a card per PIC.
   Same page for the admin (any run, draft included) and for everyone else (the last published run).
   What each person sees was already decided by the server; this file only draws it. */
import { negativeBars } from '/shared/ui/charts.js';
import { exportMenu, fileSafe } from '/shared/ui/export-menu.js';
import { openTurnaroundExport } from './export.js';
import { fmtCents, fmtK, fmtLoss, fmtWholePct, fmtM, fmtDay, fmtPeriod, monthLetter, plural } from '/shared/ui/format.js';

/* what is owed this round, in words: the goal check-in (when a month is published) or the mid-month update (two weeks later) */
const OWES = { goal: 'Goal check-in', mid: 'Mid-month update' };
const owedName = plan => OWES[(plan.owes || [])[0]] || 'Check-in';

export function planChip({ h }, plan) {
  if (plan.status === 'current') return h('span', { class: 'chip ok', text: 'Done for this round' });
  if (plan.status === 'update_due') return h('span', { class: 'chip warn', text: `${owedName(plan)} due ${fmtDay(plan.dueDate)}` });
  if (plan.status === 'overdue') return h('span', { class: 'chip crit', text: `${owedName(plan)} ${plural(plan.daysOverdue, 'day')} late`, title: `Due ${fmtDay(plan.dueDate)}` });
  return plan.daysOverdue > 0
    ? h('span', { class: 'chip crit', text: `No goal yet, ${plural(plan.daysOverdue, 'day')} late`, title: `A first goal was due ${fmtDay(plan.dueDate)}` })
    : h('span', { class: 'chip out', text: `First goal due ${fmtDay(plan.dueDate)}` });
}

export const MID_LABEL = { progress: 'In progress', done: 'Done', stuck: 'Stuck' };
export const MID_TONE = { progress: 'ok', done: 'ok', stuck: 'crit' };

export const STANDING = { good: ['ok', 'Good standing'], needs_attention: ['warn', 'Needs attention'], escalated: ['crit', 'Escalated'] };

const first = name => name.split(' ')[0];

export function renderOverview(ctx, container, data) {
  const { h } = ctx;
  const me = data.viewer;
  const isAdmin = me.role === 'admin';
  const mineExists = me.role === 'pic' && data.pics.some(p => p.code === me.picCode);
  let focus = mineExists ? me.picCode : null; // null = everyone; otherwise one PIC's code
  const holder = h('div', { class: 'stack' });
  const controls = h('div', { class: 'ov-head' });
  const paint = () => {
    holder.textContent = '';
    controls.textContent = '';
    if (mineExists) {
      controls.append(h('div', { class: 'seg', role: 'group', 'aria-label': 'Whose projects' },
        ...[[me.picCode, 'Just mine'], [null, 'Everyone']].map(([code, label]) => h('button', { type: 'button', 'aria-pressed': String(focus === code), text: label, onclick: () => { focus = code; paint(); } }))));
    } else if (isAdmin && data.pics.length) {
      const pick = h('select', { class: 'txt', style: 'width:220px', 'aria-label': 'Show one PIC', onchange: e => { focus = e.target.value || null; paint(); } },
        h('option', { value: '', text: 'Pick a PIC…', selected: focus === null }),
        ...data.pics.slice().sort((x, y) => x.name.localeCompare(y.name)).map(p => h('option', { value: p.code, text: p.name, selected: p.code === focus })));
      controls.append(h('div', { class: 'seg', role: 'group', 'aria-label': 'Whose projects' }, h('button', { type: 'button', 'aria-pressed': String(focus === null), text: 'Everyone', onclick: () => { focus = null; paint(); } })), pick);
    }
    const pic = focus !== null ? data.pics.find(p => p.code === focus) : null;
    const self = !!pic && me.role === 'pic' && pic.code === me.picCode;
    const who = self ? 'Your' : pic ? `${first(pic.name)}'s` : null;
    if (pic && !pic.projects.length) holder.append(greatJob(ctx, pic, self));
    else if (pic) holder.append(topRow(ctx, data, pic, who), picCard(ctx, pic));
    else {
      holder.append(topRow(ctx, data, null));
      for (const p of data.pics) holder.append(picCard(ctx, p));
    }
    if (!data.pics.length) holder.append(h('div', { class: 'empty-note', text: 'No projects are below break-even.' }));
    ctx.T.hydrateIcons(holder);
  };
  container.append(controls, holder);
  paint();
  // Export: what is on screen now (everyone, or the one PIC picked), never more than this person can already see
  // a PIC's check-in starts at their first project that still needs something this round, and steps through the rest from there
  const mine = mineExists ? data.pics.find(p => p.code === me.picCode).projects : [];
  const owed = mine.find(p => p.plan.status !== 'current');
  const checkin = mine.length ? ctx.h('a', { class: 'btn' + (owed ? ' primary' : ''), href: '#/turnaround/p/' + encodeURIComponent((owed || mine[0]).wbs1), text: owed ? 'Start my check-in' : 'My projects' }) : null;
  if (ctx.actions && data.pics.length) ctx.actions(container, checkin, exportMenu(ctx, { excel: () => turnaroundSheet(data, focus), pdf: () => openTurnaroundExport(ctx, data, focus, ctx.showStanding !== false) }));
}

export const planText = plan => plan.status === 'current' ? 'Done for this round'
  : plan.status === 'update_due' ? `${owedName(plan)} due`
    : plan.status === 'overdue' ? `${owedName(plan)} ${plural(plan.daysOverdue, 'day')} late`
      : plan.daysOverdue > 0 ? `No goal yet, ${plural(plan.daysOverdue, 'day')} late` : 'First goal due';

/* one row per project, for Export > Excel */
export function turnaroundSheet(data, focus) {
  const pics = focus !== null ? data.pics.filter(p => p.code === focus) : data.pics;
  const rows = [];
  for (const pic of pics) for (const p of pic.projects) {
    const g = p.goal;
    rows.push([pic.name, p.wbs1, p.name, p.pm && p.pm.name, Math.round(p.profit.ytd / 100), p.pctYtd === null || p.pctYtd === undefined ? null : p.pctYtd / 100,
      planText(p.plan), p.plan.dueDate || null, p.latest ? p.latest.date : null, p.latest ? p.latest.text : null,
      g ? g.approach : null, g ? g.text : null, g ? g.setDate : null, g && g.mid ? MID_LABEL[g.mid.status] : null,
      p.earlierMissed || 0]);
  }
  const who = focus !== null && pics[0] ? '-' + fileSafe(pics[0].name) : '';
  return {
    file: `Project-Turnaround-${fileSafe(data.run.label)}${who}.xlsx`,
    sheets: [{ name: `Turnaround ${data.run.label}`, columns: [
      { title: 'PIC', width: 20 }, { title: 'Project number', width: 14 }, { title: 'Project', width: 36 }, { title: 'PM', width: 18 },
      { title: 'Profit YTD', type: 'money', width: 13 }, { title: '% of billed', type: 'pct', width: 11 }, { title: 'Plan', width: 16 }, { title: 'Plan due', width: 11 },
      { title: 'Latest comment', width: 12 }, { title: 'Latest comment text', width: 60 }, { title: 'Goal approach', width: 24 }, { title: 'Goal', width: 50 },
      { title: 'Goal set', width: 11 }, { title: 'Mid-month', width: 12 }, { title: 'Earlier goals missed', type: 'int', width: 14 }], rows }],
  };
}

/* a PIC with nothing below break-even this year */
function greatJob(ctx, pic, self) {
  const { h, icon } = ctx;
  return h('section', { class: 'great' }, icon('circle-check', 28),
    h('div', {}, h('h2', { text: self ? 'All of your projects are profitable' : `${first(pic.name)} has no projects below break-even` }),
      h('p', { text: self ? 'Every one of your projects is profitable year to date. Great job!' : `${pic.name} has no projects below break-even this year. Doing a great job!` })));
}

function kpi({ h }, label, big, sub, extra) {
  return h('div', { class: 'kpi' }, h('div', { class: 'k-label', text: label }), h('div', { class: 'k-big', text: big }), h('div', { class: 'k-sub' }, sub, extra || null));
}

/* the four figures as words: the page and the PDF both draw these, so they always say the same thing.
   draftsReady (the admin's count of check-in drafts) is a link on the page and plain words in the PDF. */
export function kpiItems(data, mine, who) {
  const k = data.kpis;
  if (mine) {
    const needs = mine.projects.filter(p => p.plan.status === 'overdue' || p.plan.status === 'no_plan').length;
    const r = mine.record;
    return [
      { label: `${who} negative YTD profit`, big: fmtCents(mine.totals.profit), sub: `${fmtLoss(100 * mine.totals.profit / mine.totals.billed)} of ${fmtCents(mine.totals.billed)} billed, ${plural(mine.projects.length, 'project')}` },
      { label: 'Done for this round', big: `${mine.plansCurrent.current} of ${mine.plansCurrent.total}`, sub: 'Goal check-in done, and the mid-month update once it opens' },
      { label: 'Need action', big: String(needs), sub: needs ? 'Late, or no goal yet' : 'Nothing is late' },
      r ? { label: `${who} record`, big: r.pctOnTime === null ? 'No record yet' : `${fmtWholePct(r.pctOnTime)} on time`, sub: `${r.onTime.onTime} of ${r.onTime.total} check-ins on time, ${r.kept.kept} of ${r.kept.resolved} goals reported on time` }
        : { label: `${who} record`, big: '-', sub: 'Not shown' },
    ];
  }
  const s = data.since;
  return [
    { label: 'Total negative YTD profit', big: fmtCents(k.negativeYtd), sub: `${fmtLoss(100 * k.negativeYtd / k.billedYtd)} of ${fmtM(k.billedYtd)} billed, ${plural(k.projectCount, 'project')}` },
    { label: 'Done for this round', big: `${k.plansCurrent} of ${k.projectCount}`, sub: 'Goal check-in done, and the mid-month update once it opens' },
    { label: 'Waiting on a check-in', big: String(k.pastDue + k.updateDue + k.noPlan), sub: `${k.pastDue} late, ${k.updateDue} due soon, ${k.noPlan} with no goal yet.`, drafts: k.draftsReady !== null && k.draftsReady !== undefined ? k.draftsReady : null },
    s ? { label: `Since ${s.label.split(' ')[0]}`, big: `${s.off} off, ${s.added} new`, sub: `${s.improved} improved, ${s.worse} got worse` }
      : { label: 'Since last month', big: '-', sub: 'This is the first run' },
  ];
}

function kpiStrip(ctx, data, mine, who) {
  const { h } = ctx;
  return h('div', { class: 'kpis' }, ...kpiItems(data, mine, who).map(it => kpi(ctx, it.label, it.big, it.sub,
    it.drafts !== null && it.drafts !== undefined ? h('span', {}, ' ', h('a', { href: '#/turnaround/checkins', text: plural(it.drafts, 'check-in draft') + ' ready' }), '.') : null)));
}

function chartRow(ctx, data, mine, who) {
  const { h } = ctx;
  const hist = mine ? mine.history : data.history;
  if (!hist.length) return mine ? h('div', { class: 'empty-note', text: 'The charts for this PIC\'s projects are not available for this run. Switch to Everyone to see the firm-wide charts.' }) : h('div', {});
  const years = new Set();
  const pts = hist.map((p, i) => {
    const first = i === 0 || p.period % 100 === 1;
    return { label: monthLetter(p.period), yearLabel: first ? String(Math.floor(p.period / 100)) : null, kind: i === hist.length - 1 ? 'now' : p.lastYear ? 'prev' : 'bar', value: p.negativeYtd, count: p.belowCount, period: p.period };
  });
  void years;
  const last = hist[hist.length - 1], prev = hist[hist.length - 2];
  const deeper = prev ? last.negativeYtd - prev.negativeYtd : 0;
  const prevName = prev ? fmtPeriod(prev.period).split(' ')[0] : '';
  const bars = negativeBars(pts.map(p => ({ label: p.label, yearLabel: p.yearLabel, value: p.value, kind: p.kind, tip: `${fmtPeriod(p.period)}: ${fmtCents(p.value)} (${plural(p.count, 'project')} below break-even)` })),
    { fmt: v => fmtK(v), aria: 'Total negative year-to-date profit at each month end, last 12 months', width: 640, height: 200 }); // wider and shorter, so it sits beside the 2x2 figures
  // The count of projects below break-even is no longer charted (Josh, 2026-11-25): the bar tooltips and the
  // "Since" figure still give it, and the history still carries belowCount for anyone who wants it back.
  return h('div', { class: 'chart-card' },
    h('div', { class: 'chart-head' }, h('div', {}, h('h2', { text: mine ? `${who} negative YTD profit` : 'Total negative YTD profit' }), h('p', { class: 'muted', text: 'In thousands. Gray is last year.' })),
      h('div', { class: 'chart-num' }, h('strong', { text: fmtK(last.negativeYtd).replace('+', '') }), prev ? h('span', { class: 'muted', text: `${fmtK(Math.abs(deeper)).replace('+', '')} ${deeper <= 0 ? 'deeper' : 'shallower'} than ${prevName}` }) : null)),
    bars);
}

/* the top of the page: the four figures as a 2x2 block beside the profit chart */
function topRow(ctx, data, mine, who) {
  const chart = chartRow(ctx, data, mine, who);
  const hasChart = chart.classList.contains('chart-card');
  return ctx.h('div', { class: 'ov-top' + (hasChart ? '' : ' no-chart') }, kpiStrip(ctx, data, mine, who), chart);
}

function picCard(ctx, pic) {
  const { h, icon } = ctx;
  if (!pic.projects.length) {
    return h('section', { class: 'pic' }, h('header', { class: 'pic-head' }, h('h2', { text: pic.name }),
      h('span', { class: 'muted', text: '0 projects below break-even' }), h('span', { class: 'chip ok', style: 'margin-left:auto', text: 'All projects profitable' })),
      h('div', { class: 'great-row', text: `${first(pic.name)} has no projects below break-even this year. Doing a great job!` }));
  }
  const body = h('div', { class: 'tblwrap' }, projectTable(ctx, pic));
  const r = pic.record;
  // the show/hide toggle sits first, as a clear button; the whole header row also toggles (Josh, 2026-11-25)
  const label = open => `${open ? 'Hide' : 'Show'} ${first(pic.name)}'s projects`;
  const chevron = h('button', { class: 'pic-toggle', type: 'button', 'aria-label': label(true), title: label(true), 'aria-expanded': 'true' }, icon('chevron-down', 18));
  const head = h('header', { class: 'pic-head' },
      chevron,
      h('h2', { text: pic.name }),
      h('span', { class: 'pic-total', text: fmtCents(pic.totals.profit) }),
      h('span', { class: 'muted', title: `of ${fmtCents(pic.totals.billed)} billed`, text: fmtLoss(100 * pic.totals.profit / pic.totals.billed) }),
      h('span', { class: 'pic-rec' },
        h('span', { class: 'muted', text: 'Done for this round' }),
        h('span', { class: 'pbar', role: 'img', 'aria-label': `${pic.plansCurrent.current} of ${pic.plansCurrent.total} done for this round` }, h('span', { style: `width:${pic.plansCurrent.total ? 100 * pic.plansCurrent.current / pic.plansCurrent.total : 0}%` })),
        h('strong', { text: `${pic.plansCurrent.current} of ${pic.plansCurrent.total}` }),
        r ? h('span', { class: 'muted' }, 'On time ', h('strong', { text: r.pctOnTime === null ? '-' : fmtWholePct(r.pctOnTime) })) : null,
        r ? h('span', { class: 'muted' }, 'Kept ', h('strong', { text: `${r.kept.kept} of ${r.kept.resolved}` })) : null,
        r && STANDING[r.standing] && ctx.showStanding !== false ? h('span', { class: 'chip ' + STANDING[r.standing][0], text: STANDING[r.standing][1] }) : null));
  const sec = h('section', { class: 'pic' }, head, body);
  const toggle = () => {
    const open = body.hidden;
    body.hidden = !open;
    sec.classList.toggle('closed', !open);
    chevron.setAttribute('aria-expanded', String(open));
    chevron.setAttribute('aria-label', label(open)); chevron.title = label(open);
  };
  chevron.addEventListener('click', e => { e.stopPropagation(); toggle(); });
  head.addEventListener('click', e => { if (!e.target.closest('a, button')) toggle(); });
  return sec;
}

function projectTable(ctx, pic) {
  const { h } = ctx;
  const go = wbs1 => { location.hash = '#/turnaround/p/' + encodeURIComponent(wbs1); };
  return h('table', { class: 'dt ptab' },
    h('thead', {}, h('tr', {}, h('th', { text: 'Project' }), h('th', { class: 'r', text: 'Profit YTD' }), h('th', { text: 'Latest comment' }), h('th', { text: 'Current goal' }))),
    h('tbody', {}, ...pic.projects.map(p => h('tr', { tabindex: '0', class: 'clickable', onclick: () => go(p.wbs1), onkeydown: e => { if (e.key === 'Enter') go(p.wbs1); } },
      // the plan status sits under the project name rather than in a column of its own (Josh, 2026-11-25)
      h('td', {}, h('a', { class: 'strong plink', href: '#/turnaround/p/' + encodeURIComponent(p.wbs1), text: p.name, onclick: e => e.stopPropagation() }), h('div', { class: 'muted', text: `${p.wbs1} · PM ${p.pm.name}` }),
        h('div', { class: 'plan-under' }, planChip(ctx, p.plan))),
      h('td', { class: 'r' }, h('div', { class: 'strong', text: fmtCents(p.profit.ytd) }), h('div', { class: 'muted', text: fmtLoss(p.pctYtd) })),
      h('td', { class: 'latest' }, p.latest ? h('div', {}, h('strong', { text: fmtDay(p.latest.date) }), h('div', { class: 'clamp', text: p.latest.text })) : h('em', { class: 'muted', text: 'Nothing written yet.' })),
      h('td', {}, goalCell(ctx, p))))));
}

/* the goal: its approach, the latest mid-month word on it, and its words */
function goalCell({ h }, p) {
  if (!p.goal) return h('em', { class: 'muted', text: 'No goal yet' });
  const g = p.goal;
  return h('div', {}, h('div', { class: 'next-line' }, h('strong', { text: g.approach }), g.mid ? h('span', { class: 'chip ' + MID_TONE[g.mid.status], text: MID_LABEL[g.mid.status] }) : null),
    h('div', { class: 'clamp', text: g.text }),
    p.earlierMissed ? h('div', { class: 'warn-text', text: `${plural(p.earlierMissed, 'earlier goal')} not reported on` }) : null);
}
