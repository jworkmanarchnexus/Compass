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

function latestSnapshot(dir, period) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { /* no folder yet */ }
  const mine = names.filter(n => n.startsWith(`bd-${period}-`) && n.endsWith('.json')).sort();
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
    latestSnapshot: period => latestSnapshot(dir, period),
    load: () => local.load(),
    loadPipeline: d => local.loadPipeline(d),
    loadBilling: () => local.loadBilling(),
  };
}

module.exports = { createSnapshotSource, latestSnapshot };
