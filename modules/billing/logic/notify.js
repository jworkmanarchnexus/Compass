/* ===== Billing: email notification rules for invoice processors =====
   Pure: no clock, no mail. Times are local 'YYYY-MM-DDTHH:MM'. Tested from tests/fixtures/notify.json.
   Billing's emails are their own set, separate from the Turnaround and Marketing emails (docs/DECISIONS.md).

   prefs (one per processor): {
     events:    { submission, resubmit, revision, assignment, clarification, variance, missing, stale, data, complete }: 'off' | 'instant' | 'digest'
     digest:    { frequency: 'daily' | 'twice' | 'weekly', firstTime: 'HH:MM', secondTime: 'HH:MM', weekday: 0-6 (Sunday 0), weekends, onlyMine, sendEmpty }
     reminders: { cutoffDays, staleDays, quietHours } }
   businessHours (Admin setting): { start: 'HH:MM', end: 'HH:MM', days: [1,2,3,4,5] }
   Quiet hours hold a routine instant email until business hours start; it is never dropped. Only "data" (financial data changed) is urgent. */
'use strict';

const EVENTS = ['submission', 'resubmit', 'revision', 'assignment', 'clarification', 'variance', 'missing', 'stale', 'data', 'complete'];
const MODES = ['off', 'instant', 'digest'];
const URGENT = ['data'];

const DEFAULT_PREFS = {
  events: { submission: 'digest', resubmit: 'instant', revision: 'instant', assignment: 'digest', clarification: 'instant', variance: 'instant', missing: 'digest', stale: 'digest', data: 'instant', complete: 'off' },
  digest: { frequency: 'daily', firstTime: '07:00', secondTime: '13:00', weekday: 1, weekends: false, onlyMine: true, sendEmpty: false },
  reminders: { cutoffDays: 3, staleDays: 2, quietHours: true },
};
const DEFAULT_BUSINESS_HOURS = { start: '08:00', end: '17:00', days: [1, 2, 3, 4, 5] };

const hhmm = v => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
function validatePrefs(p) {
  const bad = [];
  if (!p || typeof p !== 'object') return ['prefs'];
  for (const e of EVENTS) if (!MODES.includes((p.events || {})[e])) bad.push('events.' + e);
  const d = p.digest || {}, r = p.reminders || {};
  if (!['daily', 'twice', 'weekly'].includes(d.frequency)) bad.push('digest.frequency');
  if (!hhmm(d.firstTime)) bad.push('digest.firstTime');
  if (!hhmm(d.secondTime)) bad.push('digest.secondTime');
  if (!Number.isInteger(d.weekday) || d.weekday < 0 || d.weekday > 6) bad.push('digest.weekday');
  for (const k of ['weekends', 'onlyMine', 'sendEmpty']) if (typeof d[k] !== 'boolean') bad.push('digest.' + k);
  for (const k of ['cutoffDays', 'staleDays']) if (!Number.isInteger(r[k]) || r[k] < 0 || r[k] > 60) bad.push('reminders.' + k);
  if (typeof r.quietHours !== 'boolean') bad.push('reminders.quietHours');
  return bad;
}

const weekdayOf = d => new Date(d + 'T00:00:00Z').getUTCDay();
const addDay = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

function isBusinessHours(now, bh) {
  const [d, t] = now.split('T');
  return bh.days.includes(weekdayOf(d)) && t >= bh.start && t < bh.end;
}
function nextBusinessStart(now, bh) {
  const d0 = now.split('T')[0];
  for (let i = 0; i <= 8; i++) {
    const d = addDay(d0, i);
    if (bh.days.includes(weekdayOf(d)) && d + 'T' + bh.start > now) return d + 'T' + bh.start;
  }
  return null;
}

/* how this processor gets this event right now: { mode: 'off' } | { mode: 'digest' } | { mode: 'instant', sendAt } */
function deliveryFor(prefs, event, now, businessHours) {
  const mode = prefs.events[event];
  if (mode !== 'instant') return { mode: mode === 'digest' ? 'digest' : 'off' };
  const bh = businessHours || DEFAULT_BUSINESS_HOURS;
  if (prefs.reminders.quietHours && !URGENT.includes(event) && !isBusinessHours(now, bh)) return { mode: 'instant', sendAt: nextBusinessStart(now, bh) };
  return { mode: 'instant', sendAt: now };
}

/* the first digest time strictly after `now`. Weekly goes out on its chosen weekday; the others skip weekends unless `weekends`. */
function nextDigest(prefs, now) {
  const dg = prefs.digest, [d0] = now.split('T');
  const times = dg.frequency === 'twice' ? [dg.firstTime, dg.secondTime].sort() : [dg.firstTime];
  for (let i = 0; i <= 14; i++) {
    const d = addDay(d0, i), wd = weekdayOf(d);
    if (dg.frequency === 'weekly' ? wd !== dg.weekday : !dg.weekends && (wd === 0 || wd === 6)) continue;
    for (const t of times) if (d + 'T' + t > now) return d + 'T' + t;
  }
  return null;
}

/* who is told. Assignment: the old and the new processor. Otherwise the project's processor; an unassigned project goes to every
   processor so that nothing is missed. */
function recipients(event, project, processorIds) {
  if (event === 'assignment') return [...new Set([project.assignedTo, project.previousAssignedTo].filter(Boolean))];
  return project.assignedTo ? [project.assignedTo] : processorIds.slice();
}

/* The digest for one processor. items: [{ event, wbs1, involved: [processorIds], at }]. Null when nothing to send and empty digests are off.
   "Only my projects" keeps items that involve this processor, plus items nobody is assigned to. */
function digestFor(prefs, processorId, items) {
  const mine = items.filter(i => prefs.events[i.event] === 'digest' && (!prefs.digest.onlyMine || !i.involved.length || i.involved.includes(processorId)));
  if (!mine.length && !prefs.digest.sendEmpty) return null;
  return { sections: EVENTS.map(e => ({ event: e, items: mine.filter(i => i.event === e) })).filter(s => s.items.length) };
}

/* "Missing billing instructions": inside the cutoff window (or past the deadline) with projects still unbilled. */
function missingDue(deadlineStatus, cutoffDays, unbilledCount) {
  return deadlineStatus.deadline != null && unbilledCount > 0 && deadlineStatus.daysLeft <= cutoffDays;
}

/* "Unprocessed requests": submitted or in review for staleDays or more, counting calendar days. */
function isStale(request, today, staleDays) {
  if (!['submitted', 'review'].includes(request.status)) return false;
  return Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(request.submittedOn + 'T00:00:00Z')) / 86400000) >= staleDays;
}

const api = { EVENTS, MODES, DEFAULT_PREFS, DEFAULT_BUSINESS_HOURS, validatePrefs, isBusinessHours, nextBusinessStart, deliveryFor, nextDigest, recipients, digestFor, missingDue, isStale };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else if (typeof window !== 'undefined') window.CompassBilling = Object.assign(window.CompassBilling || {}, api);
