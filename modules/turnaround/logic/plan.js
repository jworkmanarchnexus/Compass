/* ===== The plan log: rounds, goals, plan status, on time, kept, standing =====
   Pure. No database, no clock (today is always passed in), no network. Dates are 'YYYY-MM-DD'.

   The plan log is APPEND-ONLY. An entry is never edited or removed, so everything about a goal (is it open, reported on, missed)
   is worked out by replaying the log. Nothing here changes anything; it only reads entries.

   TWO ROUNDS A MONTH, TIED TO THE RUN (Josh, 2026-11-26). Each published month starts a round on the day it is first published:
     Goal check-in      due `round.dueBusinessDays` weekdays after publishing. The PIC says whether the last goal helped (Yes, No,
                        Too early to tell) with a comment, then sets the next goal: one approach (Lower costs or Bring in additional
                        revenue) and a few words on how, or keeps the same goal. A project new to the list says first what is driving
                        the loss (the explanation, once a year).
     Mid-month update   opens `round.midOpensDays` days after publishing and is due `round.dueBusinessDays` weekdays after that:
                        In progress, Done or Stuck, with a comment. No new goal. Owed only when this round's goal was set before it opened.
   A goal is a "commitment" entry. It is reported on (closed as "done") at the next goal check-in; that check-in's due date is the
   goal's due date, so it is unknown until the next month is published. Reporting on or before it counts as kept.

   An entry: { id, kind, date, commitmentId?, correctsEntryId?, data? }
     kinds written by the PIC:   explanation, commitment (a goal), update (a comment, or a mid-month update), done
                                 (older entries only: correction, date_revised)
     kind written by the admin:  admin_note   (never counts toward the PIC's record)
     kind written by the system: missed
     commitment: data = { lever, keptFrom? }      lever is 'cost' or 'revenue' (older entries: one of the ten actions, with promisedBy)
     done: commitmentId, data = { helped: 'yes'|'no'|'early', improved: true|false|null }
     update: data = { midStatus? }   with midStatus ('progress'|'done'|'stuck') and commitmentId it is the mid-month update
     missed: commitmentId, data = { dueDate } */
const { addDays, addBusinessDays, daysBetween, year, max } = require('./dates');

/* entries the PIC writes */
const PIC_KINDS = ['explanation', 'commitment', 'update', 'correction', 'done', 'date_revised'];

const HELPED = { yes: 'Yes', no: 'No', early: 'Too early to tell' };
const MID_STATUS = { progress: 'In progress', done: 'Done', stuck: 'Stuck' };

/* The two approaches a goal can take, with the ideas shown under each as guidance (not picked, not recorded).
   `legacy` keys are earlier lists: never offered, kept so old log entries keep their names. */
const LEVERS = {
  cost: { label: 'Lower costs', group: 'spend', ideas: [
    ['Reduce remaining labor hours', 'Reassess the work remaining, cut unnecessary effort, and set a realistic labor budget to finish.'],
    ['Optimize staffing mix', 'Give tasks to staff whose cost, experience or speed better suits them.'],
    ['Eliminate scope creep', 'Stop work beyond the agreement that is not authorized, and clarify deliverables with the owner.'],
    ['Reduce consultant and external costs', 'Renegotiate, narrow their scope, or bring work in-house.'],
  ] },
  revenue: { label: 'Bring in additional revenue', group: 'money', ideas: [
    ['Recover additional services', 'Seek pay for owner-directed changes, scope growth, redesign, extra meetings, extended CA, or work outside the agreement.'],
    ['Negotiate a fee adjustment', 'Revisit the fee where the project\'s conditions, duration, complexity or assumptions changed materially from the agreement.'],
    ['Capture unbilled earned revenue', 'Find authorized work or billable expenses that were done but not invoiced.'],
    ['Secure additional project scope', 'Win a new, separately paid phase, service or expanded assignment from the client.'],
  ] },
  // the ten actions of October 2026, then the eight before them: not offered any more
  recover: { label: 'Recover additional services', group: 'money', legacy: true },
  negotiate: { label: 'Negotiate a fee adjustment', group: 'money', legacy: true },
  unbilled: { label: 'Capture unbilled earned revenue', group: 'money', legacy: true },
  scope: { label: 'Secure additional project scope', group: 'money', legacy: true },
  other_money: { label: 'Other', group: 'money', legacy: true, other: true },
  labor: { label: 'Reduce remaining labor hours', group: 'spend', legacy: true },
  mix: { label: 'Optimize staffing mix', group: 'spend', legacy: true },
  creep: { label: 'Eliminate scope creep', group: 'spend', legacy: true },
  consult: { label: 'Reduce consultant and external costs', group: 'spend', legacy: true },
  other_spend: { label: 'Other', group: 'spend', legacy: true, other: true },
  fee: { label: 'Request additional services fee', group: 'money', legacy: true },
  co: { label: 'Submit a change order', group: 'money', legacy: true },
  reneg: { label: 'Renegotiate the fee', group: 'money', legacy: true },
  speed: { label: 'Speed up billing or collection', group: 'money', legacy: true },
  hours: { label: 'Reduce staffing hours', group: 'spend', legacy: true },
  staff: { label: 'Move work to lower-cost staff', group: 'spend', legacy: true },
  cons: { label: 'Reduce consultant cost', group: 'spend', legacy: true },
  sched: { label: 'Shorten the schedule', group: 'spend', legacy: true },
};

/* ---- rounds ----
   `rounds` is the sorted list of round start dates: the day each month was first published (a rerun does not start a new round). */
function roundDates(start, settings) {
  const bd = settings['round.dueBusinessDays'];
  const midOpens = addDays(start, settings['round.midOpensDays']);
  // January's round also waits for the grace period, as the first plan of the year always has
  const goalDue = max(addBusinessDays(start, bd), `${year(start)}-${settings['due.graceUntil']}`);
  return { start, goalDue, midOpens, midDue: addBusinessDays(midOpens, bd) };
}

/* the round a date falls in (the latest start on or before it), and when the next one started, if it has */
function roundAt(rounds, date) {
  const sorted = (rounds || []).slice().sort();
  let i = -1;
  for (let k = 0; k < sorted.length; k++) if (sorted[k] <= date) i = k;
  return i < 0 ? null : { start: sorted[i], next: sorted[i + 1] || null };
}

/* ---- goals (commitments), replayed from the log ----
   A goal's due date is the goal check-in due date of the first round that starts after the goal was set (null until that month
   is published). Older entries carry their own promisedBy and keep it. */
function commitmentStates(entries, rounds, settings) {
  const sorted = entries.slice().sort((a, b) => a.date.localeCompare(b.date) || (a.seq || 0) - (b.seq || 0));
  const starts = (rounds || []).slice().sort();
  const dueOf = date => {
    const next = starts.find(r => r > date);
    return next && settings ? roundDates(next, settings).goalDue : null;
  };
  const states = new Map();
  for (const e of sorted) {
    if (e.kind === 'commitment') {
      const promisedBy = e.data.promisedBy || null;
      states.set(e.id, { id: e.id, entryDate: e.date, lever: e.data.lever, keptFrom: e.data.keptFrom || null, promisedBy, dueDate: promisedBy || dueOf(e.date), revisions: [], status: 'open', closedDate: null, kept: null, helped: null, mid: null });
      continue;
    }
    const c = e.commitmentId && states.get(e.commitmentId);
    if (!c || c.status !== 'open') continue; // a closed goal is final; later entries about it are ignored
    if (e.kind === 'date_revised') { c.revisions.push({ from: c.dueDate, to: e.data.to, date: e.date }); c.dueDate = e.data.to; }
    else if (isMid(e)) c.mid = { status: e.data.midStatus, date: e.date };
    else if (e.kind === 'done') { c.status = 'done'; c.closedDate = e.date; c.kept = !c.dueDate || e.date <= c.dueDate; c.helped = e.data.helped || null; }
    else if (e.kind === 'missed') { c.status = 'missed'; c.closedDate = e.date; c.kept = false; }
  }
  return [...states.values()];
}

/* open goals whose due date has passed by at least `afterDays`: the system records these as Missed */
function commitmentsToMiss(entries, today, afterDays, rounds, settings) {
  return commitmentStates(entries, rounds, settings).filter(c => c.status === 'open' && c.dueDate && daysBetween(c.dueDate, today) >= afterDays);
}

function isMid(e) { return e.kind === 'update' && !!(e.data && e.data.midStatus); }

/* ---- plan status for one project, as of today ----
   input: { today, firstAppeared (the day the project first showed on a published run), entries, rounds, settings }
   Statuses:
     no_plan     no goal yet this year. Due `round.dueBusinessDays` weekdays after first appearing (never before the grace period ends).
     overdue     something owed this round is past its due date
     update_due  something is owed this round and not yet due
     current     nothing owed: done for this round
   owes: 'goal' (the goal check-in) or 'mid' (the mid-month update). dueDate: when it is due (null when nothing is owed). */
function planStatus({ today, firstAppeared, entries, rounds, settings }) {
  const cycle = year(today);
  const inCycle = entries.filter(e => year(e.date) === cycle);
  const mine = inCycle.filter(e => PIC_KINDS.includes(e.kind));
  const goals = commitmentStates(inCycle, rounds, settings).filter(c => year(c.entryDate) === cycle);
  const open = goals.filter(c => c.status === 'open');
  const lastEntryDate = mine.length ? mine.map(e => e.date).sort().pop() : null;
  const goal = open.length ? open.slice().sort((a, b) => b.entryDate.localeCompare(a.entryDate))[0] : null;
  const r = roundAt(rounds, today) || { start: firstAppeared, next: null };
  const R = roundDates(r.start, settings);
  const base = { cycle, lastEntryDate, hasPlan: goals.length > 0, hasOpenCommitment: open.length > 0, openCommitments: open.length, goal, round: R, owes: [] };

  if (!goals.length) {
    const grace = `${cycle}-${settings['due.graceUntil']}`;
    const due = max(addBusinessDays(firstAppeared, settings['round.dueBusinessDays']), grace);
    return Object.assign(base, { status: 'no_plan', owes: ['goal'], dueDate: due, daysOverdue: Math.max(0, daysBetween(due, today)) });
  }
  const setThisRound = goals.filter(c => c.entryDate >= R.start).sort((a, b) => a.entryDate.localeCompare(b.entryDate))[0];
  let owed = null;
  if (!setThisRound) owed = ['goal', R.goalDue];
  else if (today >= R.midOpens && setThisRound.entryDate < R.midOpens && !inCycle.some(e => isMid(e) && e.date >= R.midOpens)) owed = ['mid', R.midDue];
  if (!owed) return Object.assign(base, { status: 'current', dueDate: null, daysOverdue: 0 });
  const late = daysBetween(owed[1], today);
  return Object.assign(base, { status: late > 0 ? 'overdue' : 'update_due', owes: [owed[0]], dueDate: owed[1], daysOverdue: Math.max(0, late) });
}

/* ---- on time, over the current cycle ----
   For each round the project was on the list this year (rounds: that project's own round starts, from its first appearance): the
   goal check-in counts once it is made or its due date has passed, and is on time when made by its due date; the same for the
   mid-month update, which is owed only when the round's goal was set before it opened. */
function onTimeStats({ today, firstAppeared, entries, rounds, settings }) {
  const cycle = year(today);
  const inCycle = entries.filter(e => year(e.date) === cycle);
  const goalsSet = inCycle.filter(e => e.kind === 'commitment').map(e => e.date).sort();
  const mids = inCycle.filter(isMid).map(e => e.date).sort();
  const all = (rounds || []).slice().sort();
  const starts = all.filter(d => year(d) === cycle && d >= firstAppeared && d <= today);
  let onTime = 0, total = 0;
  const count = (made, due) => { if (made) { total++; if (made <= due) onTime++; } else if (today > due) total++; };
  starts.forEach((start, i) => {
    const next = all.find(d => d > start) || null;
    const within = d => d >= start && (!next || d < next);
    const R = roundDates(start, settings);
    const due = i === 0 ? max(R.goalDue, addBusinessDays(firstAppeared, settings['round.dueBusinessDays'])) : R.goalDue;
    const goal = goalsSet.find(within) || null;
    count(goal, due);
    if (goal && goal < R.midOpens && (!next || R.midOpens < next) && today >= R.midOpens) count(mids.find(d => d >= R.midOpens && (!next || d < next)) || null, R.midDue);
  });
  return { onTime, total };
}

function keptStats(commitments) {
  const resolved = commitments.filter(c => c.status !== 'open');
  return { kept: resolved.filter(c => c.kept).length, resolved: resolved.length };
}

/* ---- a PIC's standing ----
   Good standing needs BOTH % on time and % kept at or above the good cutoffs. Escalated is below EITHER bad cutoff.
   Anything between is needs_attention. A measure without enough behind it yet (standing.minSample) is left out; with neither, there is no standing. */
function standing({ onTime, kept }, s) {
  const min = s['standing.minSample'] || 1;
  const pctOn = onTime.total >= min ? 100 * onTime.onTime / onTime.total : null;
  const pctKept = kept.resolved >= min ? 100 * kept.kept / kept.resolved : null;
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
  // 'correction' and 'date_revised' are no longer written (old entries stay readable)
  if (['explanation', 'commitment', 'update', 'done'].includes(kind)) return role === 'pic' && !!isProjectPic;
  return false; // 'missed' is written only by the system
}

const blank = v => typeof v !== 'string' || !v.trim();

/* ---- what is wrong with a goal check-in, in plain words (null when it can be saved) ----
   input: { cause?, helped?, comment?, keep?, approach?, how? }
   state: { explained (this year), openGoal (or null), lastGoal (the latest goal this year, open or not), doneThisRound } */
function goalCheckinProblem(input, state) {
  if (state.doneThisRound) return 'The goal check-in for this round is already done. Add a comment if something changed.';
  if (!state.explained && blank(input.cause)) return 'Say what is driving the loss.';
  if (state.openGoal) {
    if (!HELPED[input.helped]) return 'Say whether your last goal helped: Yes, No, or Too early to tell.';
    if (blank(input.comment)) return 'Add a comment on how your last goal went.';
  }
  if (input.keep === true) return state.lastGoal ? null : 'There is no goal to keep yet. Set one.';
  if (state.lastGoal && typeof input.keep !== 'boolean' && !input.approach) return 'Keep the same goal, or set a new one.';
  if (!LEVERS[input.approach] || LEVERS[input.approach].legacy) return 'Pick an approach: Lower costs or Bring in additional revenue.';
  if (blank(input.how)) return 'Say how, specifically, in a few words.';
  return null;
}

/* ---- what is wrong with a mid-month update ---- */
function midProblem(input, state) {
  if (!state.owesMid) return 'There is no mid-month update due on this project right now.';
  if (!MID_STATUS[input.status]) return 'Pick where it stands: In progress, Done or Stuck.';
  if (blank(input.comment)) return 'Add a comment on where it stands.';
  return null;
}

module.exports = { PIC_KINDS, LEVERS, HELPED, MID_STATUS, roundDates, roundAt, commitmentStates, commitmentsToMiss, planStatus, onTimeStats, keptStats, standing, canWrite, goalCheckinProblem, midProblem, isMid };
