/* Admin tabs that belong to Project Turnaround: Reminders and standing, and Commitment patterns.
   Built from the Admin shell's own card and row helpers (passed in as ctx), so they look and save the same way. */
import { fmtDollars } from '/shared/ui/format.js';

export function remindersCards(ctx, s, canEdit, rerender) {
  const { h, settingsCard, row } = ctx;
  const days = h => h('span', { class: 'muted', text: 'days after due' });
  return [
    settingsCard('Reminder ladder', 'Days are counted from each project\'s update due date.', s, ['ladder.reminder1Days', 'ladder.reminder2Days', 'ladder.escalateDays'], canEdit, rerender, ed => [
      row('Overdue flag', 'On the due date the project shows Overdue everywhere. Automatic, no draft.', h('span', { class: 'muted', text: 'Due date' })),
      row('Reminder 1', 'A draft is created for you, casual tone, one per PIC.', ed.num('ladder.reminder1Days', { narrow: true }), days(h)),
      row('Reminder 2', 'A second draft, more direct, only if reminder 1 was sent and the project is still open. You get one email saying it is waiting.', ed.num('ladder.reminder2Days', { narrow: true }), days(h)),
      row('Escalate', 'Listed on the Check-in drafts page as a conversation to have in person. No draft.', ed.num('ladder.escalateDays', { narrow: true }), days(h)),
    ]),
    settingsCard('Drafts and notifications', 'Everything here ends with you pressing send yourself. The system never emails a PIC.', s, ['drafts.emailAdmin', 'drafts.skipIfEntryDays', 'drafts.skipIfSentDays'], canEdit, rerender, ed => [
      row('Email me when drafts are waiting', 'You get a single email. It contains no PIC data, only a link and a count.', ed.check('drafts.emailAdmin', 'Weekdays, only if something is waiting')),
      row('Do not create a draft if', 'Stops drafts piling up for someone who just responded. Use 0 to turn a rule off.',
        h('span', { class: 'check' }, 'The PIC added an entry in the last', ed.num('drafts.skipIfEntryDays', { narrow: true }), 'days'),
        h('span', { class: 'check' }, 'The PIC was sent a reminder in the last', ed.num('drafts.skipIfSentDays', { narrow: true }), 'days')),
    ]),
    settingsCard('Standing thresholds', 'These decide the standing label shown next to each PIC.', s, ['standing.goodOnTime', 'standing.goodKept', 'standing.escalatedOnTime', 'standing.escalatedKept', 'standing.minSample'], canEdit, rerender, ed => [
      row('Good standing needs', 'Both of these.', ed.num('standing.goodOnTime', { narrow: true }), h('span', { class: 'muted', text: '% of updates on time and' }), ed.num('standing.goodKept', { narrow: true }), h('span', { class: 'muted', text: '% of commitments kept' })),
      row('Needs at least', 'A measure counts only once this many updates or commitments are behind it, so one missed commitment does not label someone Escalated.', ctx.h('span', { class: 'check' }, ctx.h('span', { class: 'muted', text: 'Count a measure from' }), ed.num('standing.minSample', { narrow: true }), ctx.h('span', { class: 'muted', text: 'items' }))),
      row('Escalated is below', 'Either one. Anything between the two is Needs attention.', ed.num('standing.escalatedOnTime', { narrow: true }), h('span', { class: 'muted', text: '% on time or' }), ed.num('standing.escalatedKept', { narrow: true }), h('span', { class: 'muted', text: '% kept' })),
    ]),
    settingsCard('Who sees PIC records', 'PICs can see each other\'s plans. The on-time and kept figures beside each name are a separate choice, so they have their own switch.', s, ['visibility.picRecords'], canEdit, rerender, ed => [
      row('PIC records (on time, kept, standing)', 'Each PIC always sees their own.', ed.select('visibility.picRecords', [['everyone', 'Everyone who is signed in'], ['principals', 'Admin and principals only'], ['admin', 'Admin only']])),
    ]),
  ];
}

/* Commitment patterns: what PICs commit to, and what comes of it. Admin only. Worked out from the plan log (nothing extra is
   recorded). The numbers answer two questions: do they follow through, and is cutting cost or adding revenue working better. */
const rate = r => (r === null || r === undefined ? '-' : Math.round(100 * r) + '%');
const days = d => (d === null || d === undefined ? '-' : (Math.round(d * 10) / 10).toString());
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function patternsCards(ctx, d, onYear) {
  const { h } = ctx;
  const th = (t, right) => h('th', { class: right ? 'r' : '', text: t });
  const td = (t, cls) => h('td', { class: cls || '', text: String(t) });
  const table = (head, rows, min) => h('div', { class: 'tblwrap' }, h('table', { class: 'dt', style: min ? `min-width:${min}px` : '' }, h('thead', {}, h('tr', {}, ...head)), h('tbody', {}, ...rows)));
  const section = (title, sub, ...body) => h('section', { class: 'sec' }, h('div', { class: 'sec-head' }, h('h2', { text: title }), sub ? h('p', { text: sub }) : null), ...body);
  const improved = (g) => (g.improved + g.notImproved ? `${g.improved} of ${g.improved + g.notImproved} (${rate(g.improvedRate)})` : '-');

  const yearSel = h('select', { class: 'txt', style: 'width:110px', 'aria-label': 'Year', onchange: e => onYear(Number(e.target.value)) }, ...d.years.map(y => h('option', { value: String(y), text: String(y), selected: y === d.year })));
  const top = h('section', { class: 'sec' },
    h('div', { class: 'sec-head home-head' }, h('div', {}, h('h2', { text: 'Commitment patterns' }), h('p', { text: 'What PICs commit to, and what comes of it. Only you see this. It is worked out from the plan log, so nothing extra is recorded and nothing can be lost.' })), yearSel));

  if (!d.total) return [top, h('div', { class: 'empty-note', text: `No commitments were made in ${d.year}.` })];

  const m = d.groups.money, s = d.groups.spend;
  const rows = [['Bring in money', m], ['Spend less', s]].map(([label, g]) => h('tr', {},
    td(label, 'strong'), td(g.made, 'r'), td(g.open, 'r'), td(g.kept, 'r'), td(g.late, 'r'), td(g.missed, 'r'), td(rate(g.keptRate), 'r strong'), h('td', { class: 'r', text: improved(g) }), td(days(g.avgLead), 'r'), td(g.made ? rate(g.moved / g.made) : '-', 'r')));
  let verdict;
  if (m.resolved && s.resolved) {
    const hi = m.keptRate === s.keptRate ? null : (m.keptRate > s.keptRate ? 'Bring in money' : 'Spend less');
    verdict = (hi ? `${hi} commitments are kept more often (${rate(Math.max(m.keptRate, s.keptRate))} against ${rate(Math.min(m.keptRate, s.keptRate))}). ` : 'Both kinds are kept equally often. ')
      + `Based on ${m.resolved} finished money commitments and ${s.resolved} finished spend-less commitments.`
      + (Math.min(m.resolved, s.resolved) < 10 ? ' That is too few to conclude anything yet: treat it as a first look.' : '');
    if (m.improved + m.notImproved && s.improved + s.notImproved) verdict += ` Of the ones marked done, the PIC said the project improved for ${rate(m.improvedRate)} of the money actions and ${rate(s.improvedRate)} of the spend-less actions.`;
  } else verdict = 'Not enough finished commitments yet to compare the two. A commitment is finished when it is done or missed.';
  const compare = section('Cutting cost or adding revenue?', 'Kept = done on or before its date. Improved the project is the answer the PIC gives, yes or no, asked when a commitment is marked done: did this action improve the financial state of the project during the period?',
    table(['Kind', 'Made', 'Open', 'Kept', 'Done late', 'Missed', 'Kept rate', 'Improved the project', 'Days ahead', 'Date moved'].map((t, i) => th(t, i > 0)), rows, 900),
    h('div', { class: 'sec-body' }, h('p', { class: 'verdict', text: verdict })));

  const actions = section('By action', 'Every action PICs can choose, and how often each one both got done and improved the project.',
    table(['Action', 'Kind', 'Made', 'Open', 'Kept', 'Not kept', 'Kept rate', 'Improved the project'].map((t, i) => th(t, i > 1)),
      d.actions.filter(x => x.made).map(x => h('tr', {}, td(x.label, 'strong'), h('td', { class: 'muted', text: x.group === 'money' ? 'Bring in money' : 'Spend less' }), td(x.made, 'r'), td(x.open, 'r'), td(x.kept, 'r'), td(x.late + x.missed, 'r'), td(rate(x.keptRate), 'r strong'),
        td(improved(x), 'r'))), 860));

  const pics = section('By PIC', 'Who commits to what, and how often they follow through.',
    table(['PIC', 'Made', 'Finished', 'Kept', 'Kept rate', 'Days ahead', 'Date moved', 'Share that bring in money'].map((t, i) => th(t, i > 0)),
      d.pics.slice().sort((x, y) => y.made - x.made).map(p => h('tr', {}, td(d.picNames[p.pic] || 'Unassigned', 'strong'), td(p.made, 'r'), td(p.resolved, 'r'), td(p.kept, 'r'), td(rate(p.keptRate), 'r strong'), td(days(p.avgLead), 'r'), td(rate(p.movedShare), 'r'), td(rate(p.moneyShare), 'r'))), 820));

  const last = Math.max(1, ...d.months.map(x => (x.madeMoney + x.madeSpend + x.keptMoney + x.keptSpend ? x.month : 0)));
  const months = section('Over the year', 'Commitments made, and commitments kept, by the month they were made or closed.',
    table(['Month', 'Made: money', 'Made: spend less', 'Kept: money', 'Kept: spend less'].map((t, i) => th(t, i > 0)),
      d.months.slice(0, last).map(x => h('tr', {}, td(MONTH[x.month - 1], 'strong'), td(x.madeMoney, 'r'), td(x.madeSpend, 'r'), td(x.keptMoney, 'r'), td(x.keptSpend, 'r'))), 620));

  const r = d.responsiveness, o = d.offList;
  const item = (label, value, help) => h('div', { class: 'set-row' }, h('div', { class: 'what' }, h('div', { class: 'lab', text: label }), help ? h('div', { class: 'help', text: help }) : null), h('div', { class: 'ctl' }, h('strong', { text: value })));
  const engage = section('How quickly projects are answered', `Of the ${r.listed} projects that were on a published run in ${d.year}.`,
    h('div', { class: 'sec-body' },
      item('Have an explanation', `${r.withExplanation} of ${r.listed}`),
      item('Have a commitment', `${r.withCommitment} of ${r.listed}`),
      item('Days from first appearing to the explanation', days(r.avgDaysToExplain), 'Average, for projects that have one.'),
      item('Days from the explanation to the first commitment', days(r.avgDaysExplainToCommit), 'Average, for projects that have both.'),
      item('Updates per project', r.updatesPerProject === null ? '-' : (Math.round(r.updatesPerProject * 10) / 10).toString(), 'Written updates only; commitments and explanations are not counted.')));

  const outcome = section('Projects that came off the list', d.latestRun ? `Compared with the ${d.latestRun} run. This shows what went with a project leaving the list. It does not prove what caused it.` : 'No published run this year.',
    d.latestRun ? h('div', { class: 'sec-body' },
      item('Came off the list', `${o.cameOff}`, o.cameOff ? `${o.cameOffWithKept} had a kept commitment (${o.cameOffWithKeptMoney} bring in money, ${o.cameOffWithKeptSpend} spend less).` : 'Nothing has left the list yet.'),
      item('Still on the list', `${o.stillOn}`, o.stillOn ? `${o.stillOnWithKept} have a kept commitment (${o.stillOnWithKeptMoney} bring in money, ${o.stillOnWithKeptSpend} spend less).` : '')) : null);

  const others = d.others.length ? section('What PICs typed under "Other"', 'Words written in the blank line. If the same thing keeps appearing, it may deserve a place on the list of actions.',
    table(['Typed', 'Kind', 'Project', 'Made', 'Status'].map(t => th(t)),
      d.others.map(x => h('tr', {}, td(x.text, 'strong'), td(x.group === 'money' ? 'Bring in money' : 'Spend less', 'muted'), td(x.wbs1), td(x.date, 'muted'), td({ open: 'Open', done: x.kept ? 'Kept' : 'Done late', missed: 'Missed' }[x.status]))), 640)) : null;

  return [top, compare, actions, pics, months, engage, outcome, others].filter(Boolean);
}
