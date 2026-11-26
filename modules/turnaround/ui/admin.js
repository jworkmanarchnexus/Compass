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
      row('Good standing needs', 'Both of these.', ed.num('standing.goodOnTime', { narrow: true }), h('span', { class: 'muted', text: '% of check-ins on time and' }), ed.num('standing.goodKept', { narrow: true }), h('span', { class: 'muted', text: '% of goals reported on time' })),
      row('Needs at least', 'A measure counts only once this many check-ins or goals are behind it, so one late check-in does not label someone Escalated.', ctx.h('span', { class: 'check' }, ctx.h('span', { class: 'muted', text: 'Count a measure from' }), ed.num('standing.minSample', { narrow: true }), ctx.h('span', { class: 'muted', text: 'items' }))),
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
    h('div', { class: 'sec-head home-head' }, h('div', {}, h('h2', { text: 'Commitment patterns' }), h('p', { text: 'The goals PICs set, and what comes of them. Only you see this. It is worked out from the plan log, so nothing extra is recorded and nothing can be lost.' })), yearSel));

  if (!d.total) return [top, h('div', { class: 'empty-note', text: `No goals were set in ${d.year}.` })];

  const m = d.groups.money, s = d.groups.spend;
  const rows = [['Bring in additional revenue', m], ['Lower costs', s]].map(([label, g]) => h('tr', {},
    td(label, 'strong'), td(g.made, 'r'), td(g.open, 'r'), td(g.kept, 'r'), td(g.late, 'r'), td(g.missed, 'r'), td(rate(g.keptRate), 'r strong'), h('td', { class: 'r', text: improved(g) })));
  let verdict;
  if (m.resolved && s.resolved) {
    const hi = m.keptRate === s.keptRate ? null : (m.keptRate > s.keptRate ? 'Bring in additional revenue' : 'Lower costs');
    verdict = (hi ? `"${hi}" goals are reported on time more often (${rate(Math.max(m.keptRate, s.keptRate))} against ${rate(Math.min(m.keptRate, s.keptRate))}). ` : 'Both kinds are reported on time equally often. ')
      + `Based on ${m.resolved} finished revenue goals and ${s.resolved} finished cost goals.`
      + (Math.min(m.resolved, s.resolved) < 10 ? ' That is too few to conclude anything yet: treat it as a first look.' : '');
    if (m.improved + m.notImproved && s.improved + s.notImproved) verdict += ` Where the PIC could tell, the goal helped for ${rate(m.improvedRate)} of the revenue goals and ${rate(s.improvedRate)} of the cost goals.`;
  } else verdict = 'Not enough finished goals yet to compare the two. A goal is finished when the PIC reports on it at the next goal check-in, or it is recorded as missed.';
  const compare = section('Lowering costs or adding revenue?', 'On time = reported on at the next goal check-in, by its due date. Helped = the PIC\'s answer to "Did it help?" (Too early to tell is not counted).',
    table(['Approach', 'Set', 'Open', 'On time', 'Late', 'Missed', 'On-time rate', 'Helped'].map((t, i) => th(t, i > 0)), rows, 760),
    h('div', { class: 'sec-body' }, h('p', { class: 'verdict', text: verdict })));

  // the earlier lists of actions, only when an older goal named one (a goal now names just its approach)
  const older = d.actions.filter(x => x.made && !['cost', 'revenue'].includes(x.lever));
  const actions = older.length ? section('Older goals, by action', 'Goals set before November 2026 named one of the earlier actions.',
    table(['Action', 'Approach', 'Set', 'Open', 'On time', 'Not on time', 'On-time rate', 'Helped'].map((t, i) => th(t, i > 1)),
      older.map(x => h('tr', {}, td(x.label, 'strong'), h('td', { class: 'muted', text: x.group === 'money' ? 'Bring in additional revenue' : 'Lower costs' }), td(x.made, 'r'), td(x.open, 'r'), td(x.kept, 'r'), td(x.late + x.missed, 'r'), td(rate(x.keptRate), 'r strong'),
        td(improved(x), 'r'))), 860)) : null;

  const pics = section('By PIC', 'The goals each PIC sets, and how often they report on them on time.',
    table(['PIC', 'Set', 'Finished', 'On time', 'On-time rate', 'Share that bring in revenue'].map((t, i) => th(t, i > 0)),
      d.pics.slice().sort((x, y) => y.made - x.made).map(p => h('tr', {}, td(d.picNames[p.pic] || 'Unassigned', 'strong'), td(p.made, 'r'), td(p.resolved, 'r'), td(p.kept, 'r'), td(rate(p.keptRate), 'r strong'), td(rate(p.moneyShare), 'r'))), 680));

  const last = Math.max(1, ...d.months.map(x => (x.madeMoney + x.madeSpend + x.keptMoney + x.keptSpend ? x.month : 0)));
  const months = section('Over the year', 'Goals set, and goals reported on time, by the month they were set or reported on.',
    table(['Month', 'Set: revenue', 'Set: costs', 'On time: revenue', 'On time: costs'].map((t, i) => th(t, i > 0)),
      d.months.slice(0, last).map(x => h('tr', {}, td(MONTH[x.month - 1], 'strong'), td(x.madeMoney, 'r'), td(x.madeSpend, 'r'), td(x.keptMoney, 'r'), td(x.keptSpend, 'r'))), 620));

  const r = d.responsiveness, o = d.offList;
  const item = (label, value, help) => h('div', { class: 'set-row' }, h('div', { class: 'what' }, h('div', { class: 'lab', text: label }), help ? h('div', { class: 'help', text: help }) : null), h('div', { class: 'ctl' }, h('strong', { text: value })));
  const engage = section('How quickly projects are answered', `Of the ${r.listed} projects that were on a published run in ${d.year}.`,
    h('div', { class: 'sec-body' },
      item('Have an explanation', `${r.withExplanation} of ${r.listed}`),
      item('Have a goal', `${r.withCommitment} of ${r.listed}`),
      item('Days from first appearing to the explanation', days(r.avgDaysToExplain), 'Average, for projects that have one.'),
      item('Days from the explanation to the first goal', days(r.avgDaysExplainToCommit), 'Average, for projects that have both. A first goal check-in writes both together.'),
      item('Comments and mid-month updates per project', r.updatesPerProject === null ? '-' : (Math.round(r.updatesPerProject * 10) / 10).toString(), 'Goals and explanations are not counted.')));

  const outcome = section('Projects that came off the list', d.latestRun ? `Compared with the ${d.latestRun} run. This shows what went with a project leaving the list. It does not prove what caused it.` : 'No published run this year.',
    d.latestRun ? h('div', { class: 'sec-body' },
      item('Came off the list', `${o.cameOff}`, o.cameOff ? `${o.cameOffWithKept} had a goal reported on time (${o.cameOffWithKeptMoney} revenue, ${o.cameOffWithKeptSpend} costs).` : 'Nothing has left the list yet.'),
      item('Still on the list', `${o.stillOn}`, o.stillOn ? `${o.stillOnWithKept} have a goal reported on time (${o.stillOnWithKeptMoney} revenue, ${o.stillOnWithKeptSpend} costs).` : '')) : null);

  const others = d.others.length ? section('What PICs typed under "Other" (older goals)', 'Words written in the blank line of the earlier list of actions.',
    table(['Typed', 'Kind', 'Project', 'Made', 'Status'].map(t => th(t)),
      d.others.map(x => h('tr', {}, td(x.text, 'strong'), td(x.group === 'money' ? 'Bring in additional revenue' : 'Lower costs', 'muted'), td(x.wbs1), td(x.date, 'muted'), td({ open: 'Open', done: x.kept ? 'Kept' : 'Done late', missed: 'Missed' }[x.status]))), 640)) : null;

  return [top, compare, actions, pics, months, engage, outcome, others].filter(Boolean);
}
