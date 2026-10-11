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

/* per-lever rollups: the one place a commitment's action and number are visible */
export function patternsCard(ctx, rows) {
  const { h } = ctx;
  const val = (r, v) => (r.unit === 'dollars' ? fmtDollars(v) : `${v.toLocaleString('en-US')} ${r.unit}`);
  const used = rows.filter(r => r.count);
  return h('section', { class: 'sec' },
    h('div', { class: 'sec-head' }, h('h2', { text: 'Commitment patterns' }), h('p', { text: 'This year\'s commitments, by the action the PIC picked. Only you see the action and the amount.' })),
    used.length ? h('div', { class: 'tblwrap' }, h('table', { class: 'dt' },
      h('thead', {}, h('tr', {}, h('th', { text: 'Action' }), h('th', { text: 'Kind' }), h('th', { class: 'r', text: 'Commitments' }), h('th', { class: 'r', text: 'Open' }), h('th', { class: 'r', text: 'Kept' }), h('th', { class: 'r', text: 'Not kept' }), h('th', { class: 'r', text: 'Promised' }), h('th', { class: 'r', text: 'Actual, where done' }))),
      h('tbody', {}, ...used.map(r => h('tr', {}, h('td', { class: 'strong', text: r.label }), h('td', { class: 'muted', text: r.group === 'money' ? 'Bring in money' : 'Spend less' }),
        h('td', { class: 'r', text: String(r.count) }), h('td', { class: 'r', text: String(r.open) }), h('td', { class: 'r', text: String(r.kept) }), h('td', { class: 'r', text: String(r.notKept) }),
        h('td', { class: 'r', text: val(r, r.promised) }), h('td', { class: 'r', text: r.kept + r.notKept ? val(r, r.actual) : '-' }))))))
      : h('div', { class: 'empty-row', text: 'No commitments have been logged this year.' }));
}
