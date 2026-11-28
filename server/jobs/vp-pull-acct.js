'use strict';
/* Principal Accountability's Vantagepoint pull (the job, never a browser). Runs the fixed statements in server/vp/acct-statements.js
   and server/vp/bd-statements.js with the read-only connection (server/vp/connection.js, settings in .env.vp or VP_ENV_FILE) and
   saves a snapshot that the report build reads (server/vp-snapshot.js).

     node server/jobs/vp-pull-acct.js [YYYYMM]     default: the last closed month

   Prints counts only; amounts stay in the snapshot. Snapshots hold real firm data. They are saved in server/db/live/snapshots/
   (or COMPASS_SNAPSHOTS), which git ignores. */
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig, missing } = require('../vp/config');
const { open } = require('../vp/connection');
const acctSql = require('../vp/acct-statements');
const bdSql = require('../vp/bd-statements');
const { toSnapshot } = require('../vp/acct-snapshot');
const schedule = require('../../modules/turnaround/logic/schedule');

const SNAPSHOTS = () => process.env.COMPASS_SNAPSHOTS || path.join(__dirname, '..', 'db', 'live', 'snapshots');
const localToday = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

async function pullAcct(period, { log = console.log } = {}) {
  const cfg = loadConfig();
  const gap = missing(cfg);
  if (gap.length) throw new Error('Vantagepoint is not set up on this computer: fill in ' + gap.join(', ') + ' in .env.vp (see docs/VP-CONNECTION.md).');
  cfg.rowLimit = 500000; cfg.queryTimeoutSeconds = 300; // full lists, not the Discovery default
  const a = acctSql.statements(period), b = bdSql.statements(period);
  const plan = { ledger: a.ledger, projects: a.projects, overhead: a.overhead, revenue: b.revenue, forecast: b.forecast, holidays: b.holidays, pursuits: b.pursuits, principals: b.principals };
  const vp = await open(cfg);
  const rows = {};
  try {
    for (const [name, sql] of Object.entries(plan)) {
      const r = await vp.query(sql);
      if (r.truncated) throw new Error(`${name}: more rows than the limit; nothing was saved`);
      rows[name] = r.rows;
      log(`  ${name}: ${r.rows.length} rows`);
    }
  } finally { await vp.close(); }
  const pulledAt = new Date().toISOString();
  const snap = toSnapshot(rows, { period, pulledAt });
  const dir = SNAPSHOTS();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `acct-${period}-${pulledAt.replace(/[:.]/g, '').slice(0, 15)}.json`);
  fs.writeFileSync(file, JSON.stringify(snap));
  return { file, snap };
}

module.exports = { pullAcct, SNAPSHOTS };

if (require.main === module) {
  const arg = process.argv[2];
  const period = arg ? Number(arg) : schedule.lastClosedPeriod(localToday());
  console.log(`Pulling the ${schedule.periodLabel(period)} Accountability inputs from Vantagepoint (read only)...`);
  pullAcct(period).then(({ file, snap }) => {
    const left = Object.entries(snap.leftOut).map(([why, n]) => `${n} ${why}`).join(', ');
    console.log(`Saved ${path.basename(file)}: ${snap.projects.length} projects with billings, labor or expenses this year; ${snap.forecastEntries.length} plan entries; ${snap.pursuits.length} pursuits.`);
    if (left) console.log(`Left out of billed and profit, as the validated query does: ${left}.`);
    console.log('Build or rebuild the draft in Admin > Report runs (Accountability) in live mode to use it.');
  }).catch(e => { console.error(e.message); process.exit(1); });
}
