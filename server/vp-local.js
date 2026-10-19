'use strict';
/* LOCAL stand-in for the scheduled Vantagepoint pull.

   The real job runs reference/handoff/sql/compass_negative_projects.sql against Vantagepoint with one SELECT-only
   service account, and hands the same three things to the run builder. Here they come from made-up CSV files in
   server/db/seed/ instead, so nothing local ever touches Vantagepoint.

   A "source" is any object with  load(period) -> { projects, ledger, overhead }:
     projects: [{ wbs1, name, principal, projMgr, status }]   active, chargeable projects (the SQL's Projects CTE)
     ledger:   [{ wbs1, period, billed, labor, expenses }]    cents; billed is positive revenue
     overhead: [{ wbs1, min, max }]                           percent, the lowest and highest RPPlan rate on the project
   Kent's production source implements the same one method. */
const fs = require('node:fs');
const path = require('node:path');
const { parseCsv } = require('./csv');

const SEED = path.join(__dirname, 'db', 'seed');
const read = f => parseCsv(fs.readFileSync(path.join(SEED, f), 'utf8'));
const toCents = s => Math.round(parseFloat(s) * 100);

function createLocalSource() {
  return {
    name: 'local made-up data (server/db/seed)',
    /* the BD report's inputs, as of a report month: projects (principal and market sector), revenue net of consultants through the
       billing cutoff, contracted forecast through Dec 31, and pursuits not yet contracted, probability-weighted and before the architectural factor. Money in cents.
       Also, for the drill-downs: forecastMonths [{ id, month, amount }] (a project's forecast by month, YYYYMM) and mwipMonths (a pursuit's amount by month), used only as weights, and a name on each pursuit. */
    loadBd(period) {
      const projects = read('bd_projects.csv').map(p => ({ wbs1: p.WBS1, name: p.Name, principal: p.Principal, sector: p.Sector }));
      const revenue = read('bd_revenue.csv').filter(r => Number(r.Period) <= period).map(r => ({ wbs1: r.WBS1, period: Number(r.Period), amount: toCents(r.Amount) }));
      const forecast = read('bd_forecast.csv').filter(r => Number(r.Period) === period).map(r => ({ wbs1: r.WBS1, amount: toCents(r.Amount) }));
      const mwip = read('bd_mwip.csv').filter(r => Number(r.Period) === period).map(r => ({ id: r.Pursuit, pic: r.Principal, sector: r.Sector, amount: toCents(r.Amount) }));
      // the monthly shape of each forecast project and pursuit (weights for the drill-downs; the totals above are what the report counts), and pursuit names
      const forecastMonths = read('bd_forecast_months.csv').filter(r => Number(r.Period) === period).map(r => ({ id: r.WBS1, month: Number(r.Month), amount: toCents(r.Amount) }));
      const mwipMonthRows = read('bd_mwip_months.csv').filter(r => Number(r.Period) === period);
      const mwipMonths = mwipMonthRows.map(r => ({ id: r.Pursuit, month: Number(r.Month), amount: toCents(r.Amount) }));
      const pursuitName = Object.fromEntries(mwipMonthRows.map(r => [r.Pursuit, r.Name]));
      for (const m of mwip) m.name = pursuitName[m.id] || m.id;
      return { projects, revenue, forecast, mwip, forecastMonths, mwipMonths };
    },
    /* Pipeline watch: what the pipeline looks like on a snapshot Monday. In production this is what the pull returns right now and the
       snapshot is stamped with today's Monday; locally the seed files hold eight Mondays and the one asked for is picked out.
         pursuits: [{ id, name, pic, stage, winProb, amount }]       MWIP: not yet contracted, through Dec 31 (id is the project number it will keep)
         forecast: [{ wbs1, name, pic, amount, moved }]              contracted, still to bill through Dec 31; moved = the part scheduled for next year
         projects: [{ wbs1, name, pic, opened }]                     project numbers that exist, for matching a pursuit that left MWIP */
    loadPipeline(date) {
      const pursuits = read('pipeline_pursuits.csv').filter(r => r.Date === date).map(r => ({ id: r.Pursuit, name: r.Name, pic: r.Principal, stage: r.Stage, winProb: Number(r.WinProb), amount: toCents(r.Amount) }));
      const forecast = read('pipeline_forecast.csv').filter(r => r.Date === date).map(r => ({ wbs1: r.WBS1, name: r.Name, pic: r.Principal, amount: toCents(r.Amount), moved: toCents(r.Moved) }));
      const projects = read('pipeline_projects.csv').filter(r => r.Opened <= date).map(r => ({ wbs1: r.WBS1, name: r.Name, pic: r.Principal, opened: r.Opened }));
      return { pursuits, forecast, projects };
    },
    load() {
      const projects = read('projects.csv')
        .filter(p => p.Status === 'A' && !/^[ZJ]/.test(p.WBS1)) // the SQL: Status A, WBS1 not starting Z or J
        .map(p => ({ wbs1: p.WBS1, name: p.Name, principal: p.Principal, projMgr: p.ProjMgr, status: p.Status }));
      const ledger = read('ledger.csv').map(r => ({ wbs1: r.WBS1, period: Number(r.Period), billed: toCents(r.Billed), labor: toCents(r.Labor), expenses: toCents(r.Expenses) }));
      const overhead = read('overhead.csv').map(o => ({ wbs1: o.WBS1, min: Number(o.MinOH), max: Number(o.MaxOH) }));
      return { projects, ledger, overhead };
    },
  };
}

module.exports = { createLocalSource };
