/* ===== Project profit, the same math as reference/handoff/sql/compass_negative_projects.sql =====
   Pure: no database, no network, no clock. The SQL stays the source of truth; this file is the same
   arithmetic over rows the Vantagepoint job has already pulled, so it can be tested with fixtures.

   Profit = Billed - Labor * (1 + overhead%) - Expenses, per project (WBS1), three windows:
     cur = the run month, ytd = January of that year through the run month, jtd = everything up to the run month.
   Overhead is the project's own RPPlan rate. A project with no rate, or with more than one rate, is NOT evaluated
   (it is reported as a warning instead); there is no silent fallback.

   Money is whole cents (integers). Overhead is applied as labor * (10000 + hundredths-of-a-percent) / 10000 and
   rounded to the cent once per window. */

const WINDOWS = ['cur', 'ytd', 'jtd'];

function yearStart(runPeriod) { return Math.floor(runPeriod / 100) * 100 + 1; }

function inWindow(w, period, runPeriod) {
  if (period > runPeriod) return false;
  if (w === 'cur') return period === runPeriod;
  if (w === 'ytd') return period >= yearStart(runPeriod);
  return true;
}

/* input:
     projects: [{ wbs1, name, principal, projMgr, status }]                 (the SQL's Projects CTE, already filtered)
     ledger:   [{ wbs1, period (YYYYMM), billed, labor, expenses }]         cents; billed is positive revenue
     overhead: [{ wbs1, min, max }]                                         percent, e.g. 150 or 187.5
   returns one object per project, in input order. */
function computeProjects({ projects, ledger, overhead, runPeriod }) {
  const sums = new Map();
  for (const r of ledger) {
    if (r.period > runPeriod) continue;
    let s = sums.get(r.wbs1);
    if (!s) { s = {}; for (const w of WINDOWS) s[w] = { billed: 0, labor: 0, expenses: 0 }; sums.set(r.wbs1, s); }
    for (const w of WINDOWS) {
      if (!inWindow(w, r.period, runPeriod)) continue;
      s[w].billed += r.billed; s[w].labor += r.labor; s[w].expenses += r.expenses;
    }
  }
  const oh = new Map(overhead.map(o => [o.wbs1, o]));

  return projects.map(p => {
    const o = oh.get(p.wbs1);
    let reason = null;
    if (!o) reason = 'no-overhead-plan';
    else if (o.min !== o.max) reason = 'mixed-overhead-rates';
    const s = sums.get(p.wbs1);
    const billed = {}; let profit = {};
    for (const w of WINDOWS) {
      const t = s ? s[w] : { billed: 0, labor: 0, expenses: 0 };
      billed[w] = t.billed;
      if (reason) profit[w] = null;
      else {
        const ohHundredths = Math.round(o.min * 100);
        const laborWithOverhead = Math.round(t.labor * (10000 + ohHundredths) / 10000);
        profit[w] = t.billed - laborWithOverhead - t.expenses;
      }
    }
    return {
      wbs1: p.wbs1, name: p.name, principal: p.principal || '', projMgr: p.projMgr || '', status: p.status,
      overhead: o ? { min: o.min, max: o.max } : null,
      evaluable: !reason, reason, billed, profit,
    };
  });
}

/* percent of billed, or null when nothing was billed (the SQL shows NULL there too) */
function pct(profit, billed) {
  if (profit === null || profit === undefined || !billed) return null;
  return 100 * profit / billed;
}

module.exports = { computeProjects, pct, yearStart };
