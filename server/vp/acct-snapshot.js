'use strict';
/* Turns the rows of Accountability's Vantagepoint statements into a snapshot: the inputs load(period) and loadAccountability(period)
   hand the report build (docs/SPEC-accountability.md section 6). Pure; tested with made-up rows (server/tests/acct-snapshot.test.js).
   Money in cents. A snapshot is what Vantagepoint said at the moment of the pull: the forecast and pursuits keep no history there.

   rows: { ledger, projects, overhead } from server/vp/acct-statements.js, and { revenue, forecast, holidays, pursuits, principals }
   from server/vp/bd-statements.js (the same Vantagepoint reads; Accountability keeps them raw and works out its own figures). */

const cents = v => Math.round(Number(v || 0) * 100);
const text = v => (v === null || v === undefined ? '' : String(v).trim());
const date = v => (v ? String(v).slice(0, 10) : null);

/* the validated query's filters: active, regular (chargeable), project number not starting Z or J */
const inProfitPull = p => p.status === 'A' && p.chargeType === 'R' && !/^[ZJ]/i.test(p.wbs1);

function toSnapshot(rows, { period, pulledAt }) {
  const all = rows.projects.map(r => ({ wbs1: text(r.project), name: text(r.name), principal: text(r.pic_code), projMgr: text(r.pm_code), status: text(r.status), chargeType: text(r.charge_type) })).filter(p => p.wbs1);
  const byWbs = new Map(all.map(p => [p.wbs1, p]));
  const ledger = rows.ledger.map(r => ({ wbs1: text(r.project), period: Number(r.period), billed: cents(r.billed), labor: cents(r.labor), expenses: cents(r.expenses) }))
    .filter(r => r.wbs1 && (r.billed || r.labor || r.expenses));
  // the profit pull: the query's projects, and of the rest only a count of what activity they had (so nothing is dropped silently)
  const kept = all.filter(inProfitPull);
  const keptSet = new Set(kept.map(p => p.wbs1));
  const left = new Map();
  for (const r of ledger) if (!keptSet.has(r.wbs1)) { const p = byWbs.get(r.wbs1); const why = !p ? 'not in PR' : p.status !== 'A' ? 'inactive' : p.chargeType !== 'R' ? 'not regular' : 'Z or J'; left.set(r.wbs1, why); }
  const leftOut = {}; for (const why of left.values()) leftOut[why] = (leftOut[why] || 0) + 1;
  const active = new Set(ledger.map(r => r.wbs1));
  const overhead = rows.overhead.map(r => ({ wbs1: text(r.project), min: Number(r.min_oh), max: Number(r.max_oh) })).filter(o => keptSet.has(o.wbs1));
  // net revenue (gross less direct consultants) for the firm block's architectural revenue only
  const revenue = rows.revenue.map(r => ({ wbs1: text(r.project), period, amount: cents(r.gross) - cents(r.consultant) })).filter(r => r.amount);
  const forecastEntries = rows.forecast.map(r => ({ wbs1: text(r.project), start: date(r.start_date), end: date(r.end_date), amount: cents(r.amount) }));
  const pursuits = rows.pursuits.map(r => ({ id: text(r.project), name: text(r.name), pic: text(r.pic_code), stage: text(r.stage),
    estFee: cents(r.revenue), weightedFee: cents(r.weighted), estStart: date(r.est_start), estCompletion: date(r.est_completion) }));
  const holidays = [...new Set(rows.holidays.map(h => date(h.d)).filter(Boolean))].sort();
  const employees = rows.principals.map(e => ({ code: text(e.code), firstName: text(e.first_name), lastName: text(e.last_name) })).filter(e => e.code);
  // project to PIC: every project the pull mentions (activity this year, plan entries, revenue)
  const named = new Set(ledger.map(r => r.wbs1).concat(forecastEntries.map(f => f.wbs1), rows.revenue.map(r => text(r.project))));
  return {
    source: 'Vantagepoint', statements: 'acct-2026-11-28', period, pulledAt,
    // load(period): the profit pull, this year's months only (enough for YTD; not for job to date)
    projects: kept.filter(p => active.has(p.wbs1)).map(p => ({ wbs1: p.wbs1, name: p.name, principal: p.principal, projMgr: p.projMgr, status: p.status })),
    ledger: ledger.filter(r => keptSet.has(r.wbs1)), overhead, leftOut,
    // what the filters left out, kept apart (never counted): so "all jobs this year" can be compared against the query's rule
    leftOutProjects: all.filter(p => !keptSet.has(p.wbs1) && left.has(p.wbs1)).map(p => ({ wbs1: p.wbs1, name: p.name, principal: p.principal, projMgr: p.projMgr, status: p.status, chargeType: p.chargeType, why: left.get(p.wbs1) })),
    leftOutLedger: ledger.filter(r => left.has(r.wbs1)), leftOutOverhead: rows.overhead.map(r => ({ wbs1: text(r.project), min: Number(r.min_oh), max: Number(r.max_oh) })).filter(o => left.has(o.wbs1)),
    // loadAccountability(period)
    picProjects: all.filter(p => named.has(p.wbs1)).map(p => ({ wbs1: p.wbs1, principal: p.principal })),
    forecastEntries, holidays, pursuits, revenue, employees,
  };
}

module.exports = { toSnapshot, inProfitPull };
