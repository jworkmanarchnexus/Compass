'use strict';
/* The Marketing Report's Vantagepoint pull (the job, never a browser). Runs the fixed statements in server/vp/bd-statements.js with
   the read-only connection (server/vp/connection.js, settings in .env.vp) and saves a snapshot file that the report build reads
   (server/vp-snapshot.js). The forecast and MWIP keep no history in Vantagepoint, so the snapshot is the record of what they said.

     node server/jobs/vp-pull-bd.js [YYYYMM]     default: the last closed month

   Snapshots hold real firm data. They are saved in server/db/live/snapshots/ (or COMPASS_SNAPSHOTS), which git ignores. */
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig, missing } = require('../vp/config');
const { open } = require('../vp/connection');
const { statements } = require('../vp/bd-statements');
const { toSnapshot } = require('../vp/bd-snapshot');
const schedule = require('../../modules/turnaround/logic/schedule');

const SNAPSHOTS = () => process.env.COMPASS_SNAPSHOTS || path.join(__dirname, '..', 'db', 'live', 'snapshots');
const localToday = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

async function pullBd(period, { log = console.log } = {}) {
  const cfg = loadConfig();
  const gap = missing(cfg);
  if (gap.length) throw new Error('Vantagepoint is not set up on this computer: fill in ' + gap.join(', ') + ' in .env.vp (see docs/VP-CONNECTION.md).');
  // the full lists are needed here (the Discovery default of 200 rows is for looking around)
  cfg.rowLimit = 200000; cfg.queryTimeoutSeconds = 180;
  const sql = statements(period);
  const vp = await open(cfg);
  const rows = {};
  try {
    for (const name of ['revenue', 'forecast', 'toDate', 'holidays', 'pursuits', 'principals']) {
      const r = await vp.query(sql[name]);
      if (r.truncated) throw new Error(`${name}: more rows than the limit; nothing was saved`);
      rows[name] = r.rows;
      log(`  ${name}: ${r.rows.length} rows`);
    }
  } finally { await vp.close(); }
  const pulledAt = new Date().toISOString();
  const snap = toSnapshot(rows, { period, pulledAt });
  const dir = SNAPSHOTS();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `bd-${period}-${pulledAt.replace(/[:.]/g, '').slice(0, 15)}.json`);
  fs.writeFileSync(file, JSON.stringify(snap));
  return { file, snap };
}

module.exports = { pullBd, SNAPSHOTS };

if (require.main === module) {
  const arg = process.argv[2];
  const period = arg ? Number(arg) : schedule.lastClosedPeriod(localToday());
  console.log(`Pulling the ${schedule.periodLabel(period)} Marketing Report inputs from Vantagepoint (read only)...`);
  pullBd(period).then(({ file, snap }) => {
    console.log(`Saved ${path.basename(file)}: ${snap.projects.length} projects, ${snap.forecastEntries.length} forecast entries, ${snap.pursuits.length} pursuits.`);
    console.log('Build or rebuild the draft in Admin > Report runs to use it.');
  }).catch(e => { console.error(e.message); process.exit(1); });
}
