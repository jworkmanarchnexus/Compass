'use strict';
/* Compass with the Marketing Report on live Vantagepoint data, on this computer only. Nothing runs on its own: the Admin pulls,
   builds, reviews and publishes by hand.
     npm run live                    start at http://localhost:5290 with its own database (server/db/live/), set up on first start
     Admin > Report runs             "Pull from Vantagepoint" for a month, then "Build a run" (the Marketing Report)
     npm run vp:pull-bd -- 202610    the same pull from a terminal

   Only the Marketing Report is fed from Vantagepoint. Project Turnaround, Pipeline watch and Billing still show the made-up data.
   The demo (npm start, port 5281) is untouched: different database, different port. */
const fs = require('node:fs');
const path = require('node:path');
const dbmod = require('./db/db');
const { createServer } = require('./app');
const { createSnapshotSource } = require('./vp-snapshot');
const { setupLive, loadEmployees, paths } = require('./live-setup');

const PORT = Number(process.env.PORT) || 5290; // the demo is 5281; other local worktrees use 5282-5289
const HOST = '127.0.0.1'; // local only
const p = paths();
process.env.COMPASS_SNAPSHOTS = p.snapshots; // the pull writes where this server reads
const { pullBd } = require('./jobs/vp-pull-bd');
fs.mkdirSync(p.dir, { recursive: true });
const db = dbmod.open(p.db);
if (!db.get('SELECT 1 AS x FROM users LIMIT 1')) {
  if (!fs.existsSync(p.config)) { console.error(`No live config yet. Copy server/db/seed/live-config.example.json to ${p.config} and fill in the real goals.`); process.exit(1); }
  setupLive(db, JSON.parse(fs.readFileSync(p.config, 'utf8')), { snapshots: p.snapshots });
  console.log('Set up the live database from', p.config);
}

// the snapshot source, plus: each time a month is read, the PIC names it carries are kept up to date
const base = createSnapshotSource({ dir: p.snapshots });
const source = Object.assign({}, base, {
  loadBd(period) {
    const data = base.loadBd(period);
    const file = base.latestSnapshot(period);
    const snap = JSON.parse(fs.readFileSync(file, 'utf8'));
    loadEmployees(db, snap.employees || []);
    return data;
  },
});

// what a pull holds, for the Report runs page (counts and time only)
const summary = (snap, file) => ({ period: snap.period, pulledAt: snap.pulledAt, file: path.basename(file),
  projects: snap.projects.length, revenueProjects: snap.revenue.length, forecastEntries: snap.forecastEntries.length, pursuits: snap.pursuits.length });
const vpPull = {
  async pull(period) {
    const { file, snap } = await pullBd(period, { log: () => {} });
    loadEmployees(db, snap.employees || []);
    return summary(snap, file);
  },
  latest(period) {
    const file = base.latestSnapshot(period);
    return file ? summary(JSON.parse(fs.readFileSync(file, 'utf8')), file) : null;
  },
};

createServer(db, { source, vpPull, dataMode: 'live', baseUrl: `http://localhost:${PORT}` }).listen(PORT, HOST, () => {
  console.log(`Compass (Marketing Report on Vantagepoint data) at http://localhost:${PORT} (this computer only). Ctrl+C to stop.`);
});
