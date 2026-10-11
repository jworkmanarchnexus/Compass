/* ===== The plan log: commitments, plan status, on time, kept, standing =====
   Pure. No database, no clock (today is always passed in), no network. Dates are 'YYYY-MM-DD'.

   The plan log is APPEND-ONLY. An entry is never edited or removed, so everything about a commitment
   (is it open, done, missed, how often its date moved) is worked out by replaying the log. Nothing here
   changes anything; it only reads entries. Settings are in dollars/days as the Admin page shows them.

   An entry: { id, kind, date, commitmentId?, correctsEntryId?, data? }
     kinds written by the PIC:   explanation, commitment, update, correction, done, date_revised
     kind written by the admin:  admin_note   (never counts toward the PIC's record)
     kind written by the system: missed
     commitment: data = { promisedBy }                       its id is the commitment's id
     date_revised: commitmentId, data = { from, to }
     done: commitmentId
     missed: commitmentId, data = { dueDate } */
const { addDays, daysBetween, year, max, min } = require('./dates');

/* entries the PIC writes. Each one resets the update clock ("every update, explanation or commitment resets the clock"). */
const PIC_KINDS = ['explanation', 'commitment', 'update', 'correction', 'done', 'date_revised'];

/* ---- commitments, replayed from the log ---- */
function commitmentStates(entries) {
  const sorted = entries.slice().sort((a, b) => a.date.localeCompare(b.date) || (a.seq || 0) - (b.seq || 0));
  const states = new Map();
  for (const e of sorted) {
    if (e.kind === 'commitment') {
      states.set(e.id, { id: e.id, entryDate: e.date, promisedBy: e.data.promisedBy, dueDate: e.data.promisedBy, revisions: [], status: 'open', closedDate: null, kept: null });
      continue;
    }
    const c = e.commitmentId && states.get(e.commitmentId);
    if (!c || c.status !== 'open') continue; // a closed commitment is final; later entries about it are ignored
    if (e.kind === 'date_revised') { c.revisions.push({ from: c.dueDate, to: e.data.to, date: e.date }); c.dueDate = e.data.to; }
    else if (e.kind === 'done') { c.status = 'done'; c.closedDate = e.date; c.kept = e.date <= c.dueDate; } // on or before its date counts as kept
    else if (e.kind === 'missed') { c.status = 'missed'; c.closedDate = e.date; c.kept = false; }
  }
  return [...states.values()];
}

/* open commitments whose date has passed by at least `afterDays`: the system records these as Missed */
function commitmentsToMiss(entries, today, afterDays) {
  return commitmentStates(entries).filter(c => c.status === 'open' && daysBetween(c.dueDate, today) >= afterDays);
}

/* ---- plan status for one project, as of today ----
   input: { today, firstAppeared (date the project first showed on a published run), entries, settings }
   settings: due.newProjectDays, due.afterEntryDays, due.soonDays, due.graceUntil ('MM-DD')
   Statuses:
     no_plan     no commitment yet this year (an explanation alone does not count)
     overdue     the due date passed with nothing new
     update_due  the next update comes due within `soonDays`
     current     an open commitment, an entry within the update window, nothing past due
   dueDate is the earliest thing the PIC owes: the first plan, the next update, or the next commitment date. */
function planStatus({ today, firstAppeared, entries, settings }) {
  const cycle = year(today);
  const inCycle = entries.filter(e => year(e.date) === cycle);
  const mine = inCycle.filter(e => PIC_KINDS.includes(e.kind));
  const commitments = commitmentStates(inCycle).filter(c => year(c.entryDate) === cycle);
  const open = commitments.filter(c => c.status === 'open');
  const lastEntryDate = mine.length ? mine.map(e => e.date).sort().pop() : null;
  const nextCommitment = open.length ? open.slice().sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] : null;
  const base = { cycle, lastEntryDate, hasPlan: commitments.length > 0, hasOpenCommitment: open.length > 0, openCommitments: open.length, nextCommitment };

  if (!commitments.length) {
    // the first plan is due 14 days after the project first appeared, and never before the January grace period ends
    const grace = `${cycle}-${settings['due.graceUntil']}`;
    const due = max(addDays(firstAppeared, settings['due.newProjectDays']), grace);
    return Object.assign(base, { status: 'no_plan', dueDate: due, daysOverdue: Math.max(0, daysBetween(due, today)) });
  }
  let due = addDays(lastEntryDate, settings['due.afterEntryDays']);
  if (nextCommitment) due = min(due, nextCommitment.dueDate);
  const daysOverdue = daysBetween(due, today);
  let status;
  if (daysOverdue > 0) status = 'overdue';
  else if (-daysOverdue <= settings['due.soonDays'] || !open.length) status = 'update_due'; // with nothing open, the PIC owes a next commitment
  else status = 'current';
  return Object.assign(base, { status, dueDate: due, daysOverdue: Math.max(0, daysOverdue) });
}

/* ---- on time and kept, over the current cycle ----
   An entry is on time when it was made on or before the date it was due: the first one by the first-plan date,
   each later one by 30 days after the one before it. Done and date-revised entries count as entries. */
function onTimeStats({ today, firstAppeared, entries, settings }) {
  const cycle = year(today);
  const mine = entries.filter(e => year(e.date) === cycle && PIC_KINDS.includes(e.kind)).sort((a, b) => a.date.localeCompare(b.date) || (a.seq || 0) - (b.seq || 0));
  let due = max(addDays(firstAppeared, settings['due.newProjectDays']), `${cycle}-${settings['due.graceUntil']}`);
  let onTime = 0;
  for (const e of mine) {
    if (e.date <= due) onTime++;
    due = addDays(e.date, settings['due.afterEntryDays']);
  }
  return { onTime, total: mine.length };
}

function keptStats(commitments) {
  const resolved = commitments.filter(c => c.status !== 'open');
  return { kept: resolved.filter(c => c.kept).length, resolved: resolved.length };
}

/* ---- a PIC's standing ----
   Good standing needs BOTH % on time and % kept at or above the good cutoffs. Escalated is below EITHER bad cutoff.
   Anything between is needs_attention. A measure with nothing to measure yet is left out; with neither, there is no standing. */
function standing({ onTime, kept }, s) {
  const pctOn = onTime.total ? 100 * onTime.onTime / onTime.total : null;
  const pctKept = kept.resolved ? 100 * kept.kept / kept.resolved : null;
  if (pctOn === null && pctKept === null) return { label: 'no_record', pctOnTime: null, pctKept: null };
  const below = (v, cut) => v !== null && v < cut;
  const atLeast = (v, cut) => v === null || v >= cut;
  let label;
  if (below(pctOn, s['standing.escalatedOnTime']) || below(pctKept, s['standing.escalatedKept'])) label = 'escalated';
  else if (atLeast(pctOn, s['standing.goodOnTime']) && atLeast(pctKept, s['standing.goodKept'])) label = 'good';
  else label = 'needs_attention';
  return { label, pctOnTime: pctOn, pctKept };
}

/* ---- who may write what ---- */
function canWrite(role, kind, isProjectPic) {
  if (kind === 'admin_note') return role === 'admin';
  if (['explanation', 'commitment', 'update', 'correction', 'done', 'date_revised'].includes(kind)) return role === 'pic' && !!isProjectPic;
  return false; // 'missed' is written only by the system
}

/* the eight levers. The unit says what the commitment's one number means. Shown to the admin only. */
const LEVERS = {
  fee: { label: 'Request additional services fee', group: 'money', unit: 'dollars', ask: 'Dollars you expect to bring in' },
  co: { label: 'Submit a change order', group: 'money', unit: 'dollars', ask: 'Dollars you expect to bring in' },
  reneg: { label: 'Renegotiate the fee', group: 'money', unit: 'dollars', ask: 'Dollars you expect to bring in' },
  speed: { label: 'Speed up billing or collection', group: 'money', unit: 'dollars', ask: 'Dollars you expect to bill or collect sooner' },
  hours: { label: 'Reduce staffing hours', group: 'spend', unit: 'hours', ask: 'Hours you will cut' },
  staff: { label: 'Move work to lower-cost staff', group: 'spend', unit: 'dollars', ask: 'Dollars you expect to save' },
  cons: { label: 'Reduce consultant cost', group: 'spend', unit: 'dollars', ask: 'Dollars you expect to save' },
  sched: { label: 'Shorten the schedule', group: 'spend', unit: 'weeks', ask: 'Weeks you will cut' },
};

module.exports = { PIC_KINDS, LEVERS, commitmentStates, commitmentsToMiss, planStatus, onTimeStats, keptStats, standing, canWrite };
