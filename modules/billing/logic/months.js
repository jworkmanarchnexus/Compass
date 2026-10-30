/* ===== Billing: billing months, the clock reset, deadlines and the unbilled list =====
   Pure: no clock. Dates are 'YYYY-MM-DD', months are 'YYYY-MM'. Tested from tests/fixtures/months.json.

   A billing month is the month being billed. Its cycle starts on a start date (the "clock reset"): from then until the next
   month's start date it is the current billing month, and every project is back in the unbilled list.
   Start date, strongest first: a project's own reset day, the Admin's date for that month (calendar), else the default
   reset day (Admin setting billing.rolloverDay, 12) in that month. Nothing is ever locked.
   calendar: { 'YYYY-MM': { startsOn?, deadline? } } entered by the Admin. */
'use strict';

const pad = n => String(n).padStart(2, '0');
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const splitMonth = ym => ym.split('-').map(Number);
const addMonths = (ym, n) => { const [y, m] = splitMonth(ym); const t = y * 12 + (m - 1) + n; return Math.floor(t / 12) + '-' + pad((t % 12) + 1); };
const dayNumber = d => Math.round(Date.parse(d + 'T00:00:00Z') / 86400000);

function startsOn(month, opts) {
  const o = opts || {};
  const [y, m] = splitMonth(month);
  const clamp = day => y + '-' + pad(m) + '-' + pad(Math.min(day, daysIn(y, m)));
  if (o.projectRolloverDay != null) return clamp(o.projectRolloverDay);
  const c = (o.calendar || {})[month];
  if (c && c.startsOn) return c.startsOn;
  return clamp(o.rolloverDay != null ? o.rolloverDay : 12);
}

/* the billing month in progress on `date` */
function currentBillingMonth(date, opts) {
  const here = date.slice(0, 7);
  for (const m of [addMonths(here, 1), here, addMonths(here, -1)]) if (startsOn(m, opts) <= date) return m;
  return addMonths(here, -2);
}

function deadlineFor(month, calendar) {
  const c = (calendar || {})[month];
  return c && c.deadline ? c.deadline : null;
}

/* where `today` stands against the month's deadline */
function deadlineStatus(month, today, calendar) {
  const deadline = deadlineFor(month, calendar);
  if (!deadline) return { deadline: null, state: 'none', daysLeft: null };
  const daysLeft = dayNumber(deadline) - dayNumber(today);
  return { deadline, daysLeft, state: daysLeft > 0 ? 'upcoming' : daysLeft === 0 ? 'today' : 'passed' };
}

const OPEN = ['draft', 'submitted', 'review', 'returned'];
const DONE = ['submitted', 'review', 'processed'];

/* projects: [{ wbs1, excluded: [{ month, reason }] }]; requests: [{ id, wbs1, month, status }].
   A project is unbilled until it has a request that was submitted for the month, including an explicit $0.
   A project excluded for the month (with a reason) is listed apart, never silently dropped. */
function unbilledList(projects, requests, month) {
  const out = { unbilled: [], done: [], excluded: [] };
  for (const p of projects) {
    const ex = (p.excluded || []).find(e => e.month === month);
    if (ex) { out.excluded.push({ wbs1: p.wbs1, reason: ex.reason }); continue; }
    const mine = requests.filter(r => r.wbs1 === p.wbs1 && r.month === month);
    if (mine.some(r => DONE.includes(r.status))) { out.done.push({ wbs1: p.wbs1 }); continue; }
    const open = mine.find(r => r.status === 'returned') || mine.find(r => r.status === 'draft');
    out.unbilled.push({ wbs1: p.wbs1, state: open ? open.status : 'awaiting', requestId: open ? open.id : null });
  }
  return out;
}

/* One open request per project at a time. The first request of a month for a project is "regular"; later ones are "additional". */
function canStartRequest(requests, wbs1, month) {
  const open = requests.find(r => r.wbs1 === wbs1 && OPEN.includes(r.status));
  if (open) return { ok: false, reason: 'open-request', requestId: open.id };
  const seen = requests.some(r => r.wbs1 === wbs1 && r.month === month);
  return { ok: true, kind: seen ? 'additional' : 'regular' };
}

const api = { addMonths, startsOn, currentBillingMonth, deadlineFor, deadlineStatus, unbilledList, canStartRequest };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else if (typeof window !== 'undefined') window.CompassBilling = Object.assign(window.CompassBilling || {}, api);
