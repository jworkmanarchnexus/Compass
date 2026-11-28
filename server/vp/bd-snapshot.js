'use strict';
/* Turns the rows of the Marketing Report's Vantagepoint statements (server/vp/bd-statements.js) into a snapshot: the exact inputs
   loadBd(period) hands the report build (docs/SPEC-bd.md section 7). Pure; tested with made-up rows (server/tests/bd-snapshot.test.js).
   Money in cents. A snapshot is what Vantagepoint said at the moment of the pull: the forecast and MWIP keep no history there. */

const cents = v => Math.round(Number(v || 0) * 100);
const text = v => (v === null || v === undefined ? '' : String(v).trim());
const date = v => (v ? String(v).slice(0, 10) : null);

/* rows: { revenue, forecast, holidays, pursuits, principals }   meta: { period, pulledAt (ISO) } */
function toSnapshot(rows, { period, pulledAt }) {
  const projects = new Map();
  const project = (r, fees) => {
    const wbs1 = text(r.project);
    const p = projects.get(wbs1) || { wbs1, name: text(r.name), principal: text(r.pic_code), sector: text(r.sector) };
    if (fees) Object.assign(p, { fee: cents(r.fee), consultFee: cents(r.consult_fee), reimbAllow: cents(r.reimb_allow) });
    projects.set(wbs1, p);
    return wbs1;
  };
  // YTD revenue net of consultants, one row per project at the report period (the statement already sums January through it)
  const revenue = [];
  for (const r of rows.revenue) {
    const wbs1 = project(r, false);
    const amount = cents(r.gross) - cents(r.consultant);
    if (amount) revenue.push({ wbs1, period, amount });
  }
  const forecastEntries = rows.forecast.map(r => ({ wbs1: project(r, true), start: date(r.start_date), end: date(r.end_date), amount: cents(r.amount) }));
  // Vantagepoint's Consultants % inputs, on the projects that have a forecast (the only ones the share is used for)
  for (const r of rows.toDate || []) {
    const p = projects.get(text(r.project));
    if (p && 'fee' in p) Object.assign(p, { directCostToDate: cents(r.direct_cost), earnedToDate: cents(r.earned) });
  }
  const pursuits = rows.pursuits.map(r => ({ id: text(r.project), name: text(r.name), pic: text(r.pic_code), sector: text(r.sector),
    stage: text(r.stage), estFee: cents(r.revenue), weightedFee: cents(r.weighted), estStart: date(r.est_start), estCompletion: date(r.est_completion) }));
  const holidays = [...new Set(rows.holidays.map(h => date(h.d)).filter(Boolean))].sort();
  const employees = rows.principals.map(e => ({ code: text(e.code), firstName: text(e.first_name), lastName: text(e.last_name) })).filter(e => e.code);
  return {
    source: 'Vantagepoint', statements: 'bd-2026-11-28', period, pulledAt,
    projects: [...projects.values()].sort((a, b) => (a.wbs1 < b.wbs1 ? -1 : 1)),
    revenue, forecastEntries, holidays, pursuits, employees,
  };
}

module.exports = { toSnapshot };
