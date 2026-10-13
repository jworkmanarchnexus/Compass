/* ===== Check-in drafts: who gets one, when, and what it says =====
   Pure. The system NEVER emails a PIC. It prepares drafts in an admin-only queue; the admin opens one in their own mailbox,
   writes the words, sends it themselves, and marks it sent.

   ONE draft per PIC, however many projects need an update. The subject is always "Project Turnaround Updates" and the text is only
   the list of project names ("A, B and C"): the admin adds the rest in Outlook.

   A project needs an update when a due date has passed: the first plan (no commitment yet), or the check-in (the open commitment's due
   date; see plan.js planStatus). The ladder counts from that due date:
     due date            the project shows Overdue everywhere (automatic, not a draft)
     reminder 1  (+3)    a draft naming the project
     reminder 2  (+10)   another draft naming it, only if reminder 1 was sent and the project is still open
     escalate    (+21)   no draft: it is listed as a conversation for the admin to have in person
   A project is covered by a draft until its due date changes (it was dealt with, or the next check-in came round). */
const { daysBetween } = require('./dates');

const SUBJECT = 'Project Turnaround Updates';
const keyOf = (wbs1, situation, dueDate) => `${wbs1}|${situation}|${dueDate}`;

/* item: { wbs1, name, picUserId, status, daysOverdue, dueDate, ytdProfit, nextCommitmentText }
   existing: [{ id, picUserId, status, resolvedDate, items: [{ wbs1, situation, step?, dueDate }] }]   (an item's step falls back to its draft's)
   status of an existing draft: waiting | sent | dismissed | withdrawn
   lastEntryByPic: { [picUserId]: 'YYYY-MM-DD' }   the PIC's most recent entry on any project
   settings: ladder.reminder1Days, ladder.reminder2Days, ladder.escalateDays, drafts.skipIfEntryDays, drafts.skipIfSentDays */
function planDrafts({ today, items, existing, lastEntryByPic, settings }) {
  const r1 = settings['ladder.reminder1Days'], r2 = settings['ladder.reminder2Days'], r3 = settings['ladder.escalateDays'];
  const live = existing.filter(d => d.status !== 'withdrawn');
  const stepOf = (d, i) => i.step || d.step || 1;
  const keysAt = (ds, step) => new Set(ds.flatMap(d => d.items.filter(i => stepOf(d, i) === step).map(i => keyOf(i.wbs1, i.situation || d.situation, i.dueDate))));
  const covered1 = keysAt(live, 1);
  const covered2 = keysAt(live, 2);
  const sent1 = keysAt(live.filter(d => d.status === 'sent'), 1);
  const dismissed = new Set(live.filter(d => d.status === 'dismissed').flatMap(d => d.items.map(i => keyOf(i.wbs1, i.situation || d.situation, i.dueDate))));

  const candidates = [];
  for (const it of items) {
    const situation = it.status === 'overdue' ? 'overdue' : it.status === 'no_plan' && it.daysOverdue > 0 ? 'no_plan' : null;
    if (situation) candidates.push(Object.assign({}, it, { situation, key: keyOf(it.wbs1, situation, it.dueDate) }));
  }
  const candidateKeys = new Set(candidates.map(c => c.key));

  // a PIC who just wrote something, or was just sent a reminder, is left alone for now (tomorrow's run looks again)
  const quiet = pic => {
    const last = lastEntryByPic[pic];
    if (settings['drafts.skipIfEntryDays'] > 0 && last && daysBetween(last, today) <= settings['drafts.skipIfEntryDays']) return true;
    return settings['drafts.skipIfSentDays'] > 0 && existing.some(d => d.picUserId === pic && d.status === 'sent' && d.resolvedDate && daysBetween(d.resolvedDate, today) <= settings['drafts.skipIfSentDays']);
  };

  const groups = new Map(); // one per PIC
  const add = (step, c) => {
    if (!groups.has(c.picUserId)) groups.set(c.picUserId, { picUserId: c.picUserId, situation: 'overdue', step: 1, tone: 'casual', items: [] }); // situation and tone are only kept in the table; the text no longer uses them
    const g = groups.get(c.picUserId);
    g.step = Math.max(g.step, step);
    if (c.situation === 'no_plan' && g.items.length === 0) g.situation = 'no_plan'; else if (c.situation === 'overdue') g.situation = 'overdue';
    g.items.push({ wbs1: c.wbs1, name: c.name, situation: c.situation, step, dueDate: c.dueDate, daysOverdue: c.daysOverdue, ytdProfit: c.ytdProfit, nextCommitmentText: c.nextCommitmentText || '', commitmentDue: c.commitmentDue || null, commitmentPastDue: !!c.commitmentPastDue });
  };
  for (const c of candidates) {
    if (dismissed.has(c.key) || quiet(c.picUserId)) continue; // a dismissed draft never comes back for that item
    if (c.daysOverdue >= r1 && !covered1.has(c.key)) add(1, c);
    else if (c.daysOverdue >= r2 && sent1.has(c.key) && !covered2.has(c.key)) add(2, c);
  }

  const escalate = candidates.filter(c => c.daysOverdue >= r3 && !dismissed.has(c.key))
    .map(c => ({ picUserId: c.picUserId, wbs1: c.wbs1, name: c.name, situation: c.situation, daysOverdue: c.daysOverdue }));

  // a waiting draft whose projects have all been dealt with is withdrawn, so a stale nag is never sent
  const withdraw = existing.filter(d => d.status === 'waiting' && d.items.every(i => !candidateKeys.has(keyOf(i.wbs1, i.situation || d.situation, i.dueDate)))).map(d => d.id);

  return { create: [...groups.values()], withdraw, escalate };
}

/* "A", "A and B", "A, B and C" */
function nameList(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/* the words of a draft: a fixed subject and just the project names. The admin writes the greeting and the ask in Outlook. */
function draftText({ items }) {
  return { subject: SUBJECT, body: nameList(items.map(i => i.name)) };
}

module.exports = { SUBJECT, keyOf, planDrafts, draftText, nameList };
