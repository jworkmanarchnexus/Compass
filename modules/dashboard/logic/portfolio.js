/* ===== Dashboards: one project's figures, its status, the group chips, and totals (the fixed tabs) =====
   Pure, whole cents. Tested from tests/fixtures/portfolio.json and tests/portfolio.test.js.

   project = the fee burn input (see burn.js: wbs1, fee, start, end, overheadPct, actuals, forecast, plannedHours) plus
             { name, pic, pm, hours: { planYtd, actualYtd }, ar: { current, d31, d61, d91 } }   (names are display names)
   when    = { current: 'YYYY-MM', lastClosed: 'YYYY-MM' }
   rules   = { watchProfitPct, endingSoonDays }   the Admin settings dashboard.watchProfitPct and dashboard.endingSoonDays

   Year to date = January of the current month's year through the last closed month. Spent = cost with overhead, the
   same as Project Turnaround and the fee burn. Status (plain words, never punitive):
   - 'look'  Needs a look: year-to-date profit is below zero
   - 'watch' Watch: profit is at or above zero but its percent of billed is under watchProfitPct
   - 'ok'    On track: everything else, including a project with nothing billed or spent yet this year */
'use strict';

const B = (typeof module !== 'undefined' && module.exports) ? require('./burn') : window.CompassDashboard.burn;
const { toIndex, toMonth, spentOf } = B;

const STATUS_LABEL = { look: 'Needs a look', watch: 'Watch', ok: 'On track' };
const CHIPS = ['all', 'look', 'below', 'ending'];
const CHIP_LABEL = { all: 'All', look: 'Needs a look', below: 'Below zero', ending: 'Ending soon' };

const pct1 = (num, den) => (den ? Math.round(num / den * 1000) / 10 : null); // one decimal, null when there is nothing to divide by

function summarize(p, when) {
  const cur = toIndex(when.current), last = toIndex(when.lastClosed), y0 = Math.floor(cur / 12) * 12;
  let ytdB = 0, ytdS = 0, jtdB = 0, jtdS = 0;
  for (const a of p.actuals || []) {
    const i = toIndex(a.month);
    if (i > last) continue;
    const s = spentOf(a, p.overheadPct);
    jtdB += a.billed; jtdS += s;
    if (i >= y0) { ytdB += a.billed; ytdS += s; }
  }
  const byMonth = new Map();
  for (const f of p.forecast || []) { const i = toIndex(f.month); if (i > last) byMonth.set(i, (byMonth.get(i) || 0) + f.billed); }
  const forecast = Array.from({ length: 6 }, (_, k) => ({ month: toMonth(cur + k), billed: byMonth.get(cur + k) || 0 }));
  const ar = Object.assign({ current: 0, d31: 0, d61: 0, d91: 0 }, p.ar);
  return {
    wbs1: p.wbs1, name: p.name, pic: p.pic, pm: p.pm, fee: p.fee, start: p.start, end: p.end,
    ytd: { billed: ytdB, spent: ytdS, profit: ytdB - ytdS, profitPct: pct1(ytdB - ytdS, ytdB) },
    jtd: { billed: jtdB, spent: jtdS },
    billedPctOfFee: p.fee ? Math.round(jtdB / p.fee * 100) : null,
    spentPctOfFee: p.fee ? Math.round(jtdS / p.fee * 100) : null,
    forecast, forecastNext3: forecast.slice(0, 3).reduce((t, f) => t + f.billed, 0),
    hours: { plan: (p.hours || {}).planYtd || 0, actual: (p.hours || {}).actualYtd || 0 },
    ar: Object.assign(ar, { total: ar.current + ar.d31 + ar.d61 + ar.d91, over60: ar.d61 + ar.d91 }),
  };
}

function status(s, rules) {
  if (s.ytd.profit < 0) return 'look';
  if (s.ytd.profitPct !== null && s.ytd.profitPct < rules.watchProfitPct) return 'watch';
  return 'ok';
}

/* is this project in the chip? 'ending' = its end month is no later than the current month plus endingSoonDays
   (counted as 30-day months, rounded, at least the current month); a project already past its end date is in it too */
function inChip(s, chip, when, rules) {
  if (!CHIPS.includes(chip)) throw new Error('unknown chip: ' + chip);
  if (chip === 'all') return true;
  if (chip === 'look') return status(s, rules) !== 'ok';
  if (chip === 'below') return s.ytd.profit < 0;
  const months = Math.max(1, Math.round(rules.endingSoonDays / 30));
  return toIndex(s.end) <= toIndex(when.current) + months - 1;
}

function totals(list, rules) {
  const t = { count: list.length, fee: 0, billed: 0, spent: 0, forecastNext3: 0, hoursPlan: 0, hoursActual: 0, ar: 0, over60: 0, needLook: 0 };
  for (const s of list) {
    t.fee += s.fee; t.billed += s.ytd.billed; t.spent += s.ytd.spent; t.forecastNext3 += s.forecastNext3;
    t.hoursPlan += s.hours.plan; t.hoursActual += s.hours.actual; t.ar += s.ar.total; t.over60 += s.ar.over60;
    if (status(s, rules) !== 'ok') t.needLook++;
  }
  t.profit = t.billed - t.spent; t.profitPct = pct1(t.profit, t.billed);
  return t;
}

const portfolioApi = { summarize, status, inChip, totals, STATUS_LABEL, CHIPS, CHIP_LABEL };
if (typeof module !== 'undefined' && module.exports) module.exports = portfolioApi;
else if (typeof window !== 'undefined') window.CompassDashboard = Object.assign(window.CompassDashboard || {}, { portfolio: portfolioApi });
