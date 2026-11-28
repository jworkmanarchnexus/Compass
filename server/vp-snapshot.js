'use strict';
/* A source that answers loadBd(period) from the latest Vantagepoint snapshot for that month (server/jobs/vp-pull-bd.js).
   The Marketing Report is the only part fed this way so far; everything else (Project Turnaround, Pipeline watch, Billing) still
   comes from the local made-up files, so a page that is not the Marketing Report is not real data.

   The snapshot holds the raw inputs (plan entries, pursuits, ledger totals). The report build works out the forecast and MWIP from
   them with the Admin's settings (logic/forecast.js, logic/mwip.js), so changing a setting and rebuilding needs no new pull. */
const fs = require('node:fs');
const path = require('node:path');
const { HttpError } = require('./errors');
const { createLocalSource } = require('./vp-local');

function latestSnapshot(dir, period, kind = 'bd') {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { /* no folder yet */ }
  const mine = names.filter(n => n.startsWith(`${kind}-${period}-`) && n.endsWith('.json')).sort();
  return mine.length ? path.join(dir, mine[mine.length - 1]) : null;
}

function createSnapshotSource({ dir }) {
  const local = createLocalSource();
  return {
    name: `Vantagepoint snapshots (${dir})`,
    loadBd(period) {
      const file = latestSnapshot(dir, period);
      if (!file) throw new HttpError(409, `There is no Vantagepoint pull for ${period} yet. Run "npm run vp:pull-bd -- ${period}" on this computer, then build again.`);
      const s = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { projects: s.projects, revenue: s.revenue, forecastEntries: s.forecastEntries, holidays: s.holidays, pursuits: s.pursuits, pulledAt: s.pulledAt };
    },
    /* Principal Accountability: its own pull (npm run vp:pull-acct), gross. It carries its own profit pull (profit), so a live
       Accountability report never falls back to the made-up billings the rest of live mode still shows. */
    loadAccountability(period) {
      const file = latestSnapshot(dir, period, 'acct');
      if (!file) throw new HttpError(409, `There is no Vantagepoint pull for Accountability for ${period} yet. Run "npm run vp:pull-acct -- ${period}" on this computer, then build again.`);
      const s = JSON.parse(fs.readFileSync(file, 'utf8'));
      // "all jobs this year" (the sheet's words; checked against the October 2026 sheet, billed exact for every PIC it could match):
      // the query's projects plus those it leaves out only for being inactive. Overhead and other non-regular projects stay out.
      const closed = new Set((s.leftOutProjects || []).filter(p => p.why === 'inactive').map(p => p.wbs1));
      const profit = {
        projects: s.projects.concat((s.leftOutProjects || []).filter(p => closed.has(p.wbs1))),
        ledger: s.ledger.concat((s.leftOutLedger || []).filter(r => closed.has(r.wbs1))),
        overhead: s.overhead.concat((s.leftOutOverhead || []).filter(o => closed.has(o.wbs1))),
      };
      return { profit, projects: s.picProjects, forecastEntries: s.forecastEntries, holidays: s.holidays,
        pursuits: s.pursuits, revenue: s.revenue, employees: s.employees, pulledAt: s.pulledAt, leftOut: s.leftOut };
    },
    latestSnapshot: (period, kind) => latestSnapshot(dir, period, kind),
    load: () => local.load(),
    loadPipeline: d => local.loadPipeline(d),
    loadBilling: () => local.loadBilling(),
  };
}

module.exports = { createSnapshotSource, latestSnapshot };
