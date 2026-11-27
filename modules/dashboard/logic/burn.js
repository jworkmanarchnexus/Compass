/* ===== Fee burn: billed and spent as running totals, month by month (Josh, 2026-11-26) =====
   Pure, whole cents. Tested from tests/fixtures/burn.json and tests/burn.test.js.

   For each project (or the sum of several):
   - Billed, actual:     what was billed in each closed month (through `lastClosed`).
   - Spent, actual:      labor x (1 + overhead %) + expenses, the same cost as Project Turnaround's profit
                         (modules/turnaround/logic/profit.js).
   - Billed, forecast:   the project's revenue forecast for each month after `lastClosed`.
   - Spent, projected:   planned hours x billing rate x the Admin setting `dashboard.projectedSpendPct`, after `lastClosed`.
                         It never uses anyone's pay or cost rate: with one hour in a plan, a PM could back out a person's
                         salary (Josh, 2026-11-26). The setting turns billing-rate dollars into an estimate of cost.
   Months after `lastClosed` never use actuals, and months up to it never use forecast or plan.

   Two windows:
   - 'year': January to December of the current month's year. Running totals start at zero on Jan 1. The fee line is the
             fee less what was billed before Jan 1 (what was left to bill this year).
   - 'full': the first month of the earliest project to the last month of the latest one. Running totals start at the
             project start. The fee line is the total fee.

   project = { wbs1, fee, start, end, overheadPct, actuals: [{ month, billed, labor, expenses }],
               forecast: [{ month, billed }], plannedHours: [{ month, hours, billRate }] }
             months are 'YYYY-MM'; money and billRate are cents; overheadPct is a percent (150 = 150%), or null if the
             project has no overhead plan (spent then leaves overhead out, and a warning says so).
   opts    = { window: 'year' | 'full', current: 'YYYY-MM', lastClosed: 'YYYY-MM', projectedSpendPct } */
'use strict';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const toIndex = m => { const [y, mm] = m.split('-').map(Number); return y * 12 + mm - 1; };
const toMonth = i => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
const isCents = v => Number.isInteger(v);

function check(projects, opts) {
  if (!Array.isArray(projects)) throw new Error('projects must be a list');
  if (!opts || !['year', 'full'].includes(opts.window)) throw new Error("window must be 'year' or 'full'");
  for (const k of ['current', 'lastClosed']) if (!MONTH.test(opts[k] || '')) throw new Error(`${k} must be a month like 2026-10`);
  if (toIndex(opts.lastClosed) >= toIndex(opts.current)) throw new Error('lastClosed must be before the current month');
  const pct = opts.projectedSpendPct;
  if (!Number.isInteger(pct) || pct < 1 || pct > 200) throw new Error('projectedSpendPct must be a whole percent from 1 to 200');
  for (const p of projects) {
    if (!isCents(p.fee) || p.fee < 0) throw new Error(`${p.wbs1}: fee must be whole cents`);
    for (const k of ['start', 'end']) if (!MONTH.test(p[k] || '')) throw new Error(`${p.wbs1}: ${k} must be a month`);
    if (toIndex(p.end) < toIndex(p.start)) throw new Error(`${p.wbs1}: end is before start`);
    if (p.overheadPct !== null && !(typeof p.overheadPct === 'number' && p.overheadPct >= 0)) throw new Error(`${p.wbs1}: overheadPct must be a percent or null`);
    for (const a of p.actuals || []) if (!MONTH.test(a.month) || ![a.billed, a.labor, a.expenses].every(isCents)) throw new Error(`${p.wbs1}: bad actual row`);
    for (const f of p.forecast || []) if (!MONTH.test(f.month) || !isCents(f.billed)) throw new Error(`${p.wbs1}: bad forecast row`);
    for (const h of p.plannedHours || []) if (!MONTH.test(h.month) || !(h.hours >= 0) || !isCents(h.billRate)) throw new Error(`${p.wbs1}: bad planned hours row`);
  }
}

/* one project's own amounts by month index: { billed, spent } (not running totals) */
function monthly(p, last, pct) {
  const out = new Map();
  const add = (i, billed, spent) => { const x = out.get(i) || { billed: 0, spent: 0 }; x.billed += billed; x.spent += spent; out.set(i, x); };
  const oh = p.overheadPct === null ? 0 : p.overheadPct;
  for (const a of p.actuals || []) {
    const i = toIndex(a.month);
    if (i <= last) add(i, a.billed, Math.round(a.labor * (100 + oh) / 100) + a.expenses);
  }
  for (const f of p.forecast || []) { const i = toIndex(f.month); if (i > last) add(i, f.billed, 0); }
  for (const h of p.plannedHours || []) { const i = toIndex(h.month); if (i > last) add(i, 0, Math.round(h.hours * h.billRate * pct / 100)); }
  return out;
}

function burn(projects, opts) {
  check(projects, opts);
  const last = toIndex(opts.lastClosed), cur = toIndex(opts.current), pct = opts.projectedSpendPct;
  const per = projects.map(p => ({ p, m: monthly(p, last, pct) }));
  const warnings = projects.filter(p => p.overheadPct === null && (p.actuals || []).some(a => a.labor)).map(p => ({ wbs1: p.wbs1, code: 'no-overhead-plan' }));

  let a, b;
  if (opts.window === 'year') { a = Math.floor(cur / 12) * 12; b = a + 11; }
  else if (!projects.length) { a = cur; b = cur; }
  else {
    a = Math.min(...projects.map(p => toIndex(p.start)));
    b = Math.max(...projects.map(p => toIndex(p.end)));
  }

  // anything a project has outside the window is left out; in the year window, billing before Jan 1 lowers the fee line
  const before = opts.window === 'year'
    ? per.reduce((t, { m }) => t + [...m].filter(([i]) => i < a).reduce((s, [, x]) => s + x.billed, 0), 0) : 0;
  const fee = projects.reduce((t, p) => t + p.fee, 0);
  const feeLine = Math.max(0, fee - before);

  const months = [], billed = [], spent = [], projected = [];
  let tb = 0, ts = 0;
  for (let i = a; i <= b; i++) {
    for (const { m } of per) { const x = m.get(i); if (x) { tb += x.billed; ts += x.spent; } }
    months.push(toMonth(i)); billed.push(tb); spent.push(ts); projected.push(i > last);
  }
  const lastActualIndex = Math.min(last, b) - a; // -1 when the window starts after the last closed month
  const at = (arr, k) => (k < 0 ? 0 : arr[k]);
  const passes = arr => { const k = arr.findIndex(v => v > feeLine); return k < 0 ? null : months[k]; };
  return {
    window: opts.window, months, billed, spent, projected,
    lastActualIndex, currentIndex: cur >= a && cur <= b ? cur - a : null,
    fee, feeLine, feeLineKind: opts.window === 'year' ? 'leftAtYearStart' : 'total',
    toDate: { billed: at(billed, lastActualIndex), spent: at(spent, lastActualIndex) },
    atEnd: { billed: billed[billed.length - 1] || 0, spent: spent[spent.length - 1] || 0 },
    spentPassesFee: passes(spent),
    warnings,
  };
}

const burnApi = { burn, toIndex, toMonth };
if (typeof module !== 'undefined' && module.exports) module.exports = burnApi;
else if (typeof window !== 'undefined') window.CompassDashboard = Object.assign(window.CompassDashboard || {}, { burn: burnApi });
