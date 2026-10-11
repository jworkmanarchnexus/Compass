/* ===== Check-in drafts: who gets one, when, and what it says =====
   Pure. The system NEVER emails a PIC. It prepares drafts in an admin-only queue; the admin edits one if they like,
   opens it in their own mailbox, sends it themselves, and marks it sent. Tone is plain and about the work, not the person.

   The reminder ladder counts from a project's due date (see plan.js planStatus):
     due date            the project shows Overdue everywhere (automatic, not a draft)
     reminder 1  (+3)    a casual draft, one per PIC per situation
     reminder 2  (+10)   a more direct draft, only if reminder 1 was sent and the project is still open
     escalate    (+21)   no draft: it is listed as a conversation for the admin to have in person
   Situations: 'overdue' (has a plan, something is past due) and 'no_plan' (no commitment yet and past the first-plan date).
   "One per PIC per situation": a PIC with two overdue projects gets one draft that lists both. */
const { daysBetween } = require('./dates');

const keyOf = (wbs1, situation, dueDate) => `${wbs1}|${situation}|${dueDate}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const niceDate = d => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;
const money = c => (c < 0 ? '-$' : '$') + Math.abs(Math.round(c / 100)).toLocaleString('en-US');

/* item: { wbs1, name, picUserId, status, daysOverdue, dueDate, ytdProfit, nextCommitmentText }
   existing: [{ id, picUserId, situation, step, status, resolvedDate, items: [{ wbs1, dueDate }] }]
   status of an existing draft: waiting | sent | dismissed | withdrawn
   lastEntryByPic: { [picUserId]: 'YYYY-MM-DD' }   the PIC's most recent entry on any project
   settings: ladder.reminder1Days, ladder.reminder2Days, ladder.escalateDays, drafts.skipIfEntryDays, drafts.skipIfSentDays */
function planDrafts({ today, items, existing, lastEntryByPic, settings }) {
  const r1 = settings['ladder.reminder1Days'], r2 = settings['ladder.reminder2Days'], r3 = settings['ladder.escalateDays'];
  const live = existing.filter(d => d.status !== 'withdrawn');
  const keysOf = ds => new Set(ds.flatMap(d => d.items.map(i => keyOf(i.wbs1, d.situation, i.dueDate))));
  const covered1 = keysOf(live.filter(d => d.step === 1));
  const covered2 = keysOf(live.filter(d => d.step === 2));
  const sent1 = keysOf(live.filter(d => d.step === 1 && d.status === 'sent'));
  const dismissed = keysOf(live.filter(d => d.status === 'dismissed'));

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

  const groups = new Map();
  const add = (step, c) => {
    const k = `${c.picUserId}|${c.situation}|${step}`;
    if (!groups.has(k)) groups.set(k, { picUserId: c.picUserId, situation: c.situation, step, tone: step === 1 ? 'casual' : 'direct', items: [] });
    groups.get(k).items.push({ wbs1: c.wbs1, name: c.name, dueDate: c.dueDate, daysOverdue: c.daysOverdue, ytdProfit: c.ytdProfit, nextCommitmentText: c.nextCommitmentText || '' });
  };
  for (const c of candidates) {
    if (dismissed.has(c.key) || quiet(c.picUserId)) continue; // a dismissed draft never comes back for that item
    if (c.daysOverdue >= r1 && !covered1.has(c.key)) add(1, c);
    else if (c.daysOverdue >= r2 && sent1.has(c.key) && !covered2.has(c.key)) add(2, c);
  }

  const escalate = candidates.filter(c => c.daysOverdue >= r3 && !dismissed.has(c.key))
    .map(c => ({ picUserId: c.picUserId, wbs1: c.wbs1, name: c.name, situation: c.situation, daysOverdue: c.daysOverdue }));

  // a waiting draft whose projects have all been dealt with is withdrawn, so a stale nag is never sent
  const withdraw = existing.filter(d => d.status === 'waiting' && d.items.every(i => !candidateKeys.has(keyOf(i.wbs1, d.situation, i.dueDate)))).map(d => d.id);

  return { create: [...groups.values()], withdraw, escalate };
}

/* the words of a draft. Uses the PIC's preferred name. Tone: 'casual' (reminder 1) or 'direct' (reminder 2). */
function draftText({ tone, situation, picName, items }) {
  const many = items.length > 1;
  const line = i => situation === 'overdue'
    ? `- ${i.name}: ${i.nextCommitmentText ? `"${i.nextCommitmentText}" ` : ''}was due ${niceDate(i.dueDate)}`
    : `- ${i.name}: ${money(i.ytdProfit)} YTD, nothing in the portal yet`;
  const list = items.map(line).join('\n');
  const one = items[0];
  let subject, body;
  if (situation === 'overdue') {
    subject = many ? 'A few updates when you get a minute' : `${one.name} update`;
    body = tone === 'casual'
      ? (many
        ? `Hey ${picName}, quick check on a few projects. Nothing new has gone into the portal since these came due:\n\n${list}\n\nAdd a line on each when you get a minute and I'll leave it alone after that.`
        : `Hey ${picName}, quick check on ${one.name}. ${one.nextCommitmentText ? `"${one.nextCommitmentText}"` : 'The next step'} was due ${niceDate(one.dueDate)} and I don't see an update in the portal. Is it done, or did something get in the way? Add a line when you get a minute and I'll leave it alone after that.`)
      : (many
        ? `${picName}, these are still without an update:\n\n${list}\n\nPlease update the portal today. If something is blocking you, tell me and I'll help you move it.`
        : `${picName}, ${one.name} is still without an update. ${one.nextCommitmentText ? `"${one.nextCommitmentText}"` : 'The next step'} was due ${niceDate(one.dueDate)}. Please update the portal today. If something is blocking you, tell me and I'll help you move it.`);
  } else {
    subject = many ? 'What is behind these projects?' : `${one.name}, what's driving it`;
    body = tone === 'casual'
      ? (many
        ? `Hey ${picName}, these landed on the Project Turnaround list and there's nothing in the portal on them yet:\n\n${list}\n\nCould you add what's driving each one and one thing you'll do about it? Two sentences each is plenty.`
        : `${picName}, ${one.name} landed on the Project Turnaround list at ${money(one.ytdProfit)} YTD and there's nothing in the portal on it yet. Could you add what's driving it and one thing you'll do about it? Two sentences is plenty. Thanks.`)
      : (many
        ? `${picName}, these projects are still without a plan:\n\n${list}\n\nPlease add what's driving each one and one commitment today. If you'd like to talk it through first, tell me.`
        : `${picName}, ${one.name} is still without a plan at ${money(one.ytdProfit)} YTD. Please add what's driving it and one commitment today. If you'd like to talk it through first, tell me.`);
  }
  return { subject, body };
}

module.exports = { keyOf, planDrafts, draftText };
