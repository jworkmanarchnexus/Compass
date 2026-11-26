'use strict';
/* Sets up the LIVE local database: the sign-in-as test users (made up, as everywhere locally), and Compass's own Marketing Report
   inputs from a local config file: annual goals per PIC (Vantagepoint employee code) and per sector, the market sectors with their
   roll-up, and the MWIP factor. The Vantagepoint numbers themselves come from the pull (server/jobs/vp-pull-bd.js).

     node server/live-setup.js            set up (or reset) server/db/live/compass-live.sqlite from server/db/live/config.json

   The config is real firm data and stays out of git (server/db/live/ is ignored). A made-up example of its shape is
   server/db/seed/live-config.example.json. Everything here can be changed afterwards in Admin > Marketing Reports. */
const fs = require('node:fs');
const path = require('node:path');
const dbmod = require('./db/db');
const { seed } = require('./seed');

const LIVE = process.env.COMPASS_LIVE_DIR || path.join(__dirname, 'db', 'live');
const paths = () => ({ dir: LIVE, db: process.env.COMPASS_DB || path.join(LIVE, 'compass-live.sqlite'), config: path.join(LIVE, 'config.json'), snapshots: process.env.COMPASS_SNAPSHOTS || path.join(LIVE, 'snapshots') });

/* config: { goals: { "2026": { pic: [{ code, amount }], sector: [{ name, amount }] } }, sectors: [{ name, rollsInto?, rollsUntil? }],
             mwipFactor: [{ effectiveFrom, factor }] }   amounts in dollars, factor as a decimal (0.65) */
function checkConfig(c) {
  const problems = [];
  if (!c || typeof c !== 'object') return ['the config is not a JSON object'];
  for (const [year, g] of Object.entries(c.goals || {})) {
    if (!/^\d{4}$/.test(year)) problems.push(`goal year "${year}"`);
    for (const p of (g.pic || [])) if (!p.code || !(p.amount >= 0)) problems.push(`a ${year} PIC goal needs a code and an amount`);
    for (const s of (g.sector || [])) if (!s.name || !(s.amount >= 0)) problems.push(`a ${year} sector goal needs a name and an amount`);
  }
  if (!Array.isArray(c.sectors) || !c.sectors.length) problems.push('sectors: list the market sectors');
  if (!Array.isArray(c.mwipFactor) || !c.mwipFactor.length) problems.push('mwipFactor: at least one factor with its effective date');
  for (const f of (c.mwipFactor || [])) if (!/^\d{4}-\d{2}-\d{2}$/.test(f.effectiveFrom || '') || !(f.factor > 0 && f.factor <= 1)) problems.push('an MWIP factor needs effectiveFrom (YYYY-MM-DD) and a factor between 0 and 1');
  return problems;
}

/* the PICs' names, from the people Vantagepoint lists as principal (in each snapshot) */
function loadEmployees(db, employees) {
  db.tx(() => { for (const e of employees) db.run('INSERT INTO employees (code, first_name, last_name, email) VALUES (?, ?, ?, ?) ON CONFLICT(code) DO UPDATE SET first_name = excluded.first_name, last_name = excluded.last_name', e.code, e.firstName, e.lastName, ''); });
}

function latestEmployees(snapshotsDir) {
  let names = [];
  try { names = fs.readdirSync(snapshotsDir).filter(n => /^bd-\d{6}-.*\.json$/.test(n)).sort((a, b) => (a.slice(10) < b.slice(10) ? -1 : 1)); } catch { /* none yet */ }
  if (!names.length) return [];
  return JSON.parse(fs.readFileSync(path.join(snapshotsDir, names[names.length - 1]), 'utf8')).employees || [];
}

function setupLive(db, config, { snapshots } = {}) {
  const problems = checkConfig(config);
  if (problems.length) throw new Error('The live config has problems: ' + problems.join('; '));
  seed(db, { demo: false });
  // replace the made-up Marketing Report inputs the seed loaded. The factor history is append-only for the app; a reset is a
  // developer action, so (like the seed) it lifts the guard, empties the table and puts the guard back.
  const triggers = db.all("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'bd_mwip_factor'").map(t => t.name);
  db.tx(() => {
    for (const t of triggers) db.run(`DROP TRIGGER ${t}`);
    for (const t of ['bd_goals', 'bd_sectors', 'bd_mwip_factor']) db.run(`DELETE FROM ${t}`);
  });
  db.applySchema();
  db.tx(() => {
    for (const [year, g] of Object.entries(config.goals || {})) {
      (g.pic || []).forEach((p, i) => db.run('INSERT INTO bd_goals (year, scope, key, amount, sort) VALUES (?, ?, ?, ?, ?)', Number(year), 'pic', p.code, Math.round(p.amount * 100), i + 1));
      (g.sector || []).forEach((s, i) => db.run('INSERT INTO bd_goals (year, scope, key, amount, sort) VALUES (?, ?, ?, ?, ?)', Number(year), 'sector', s.name, Math.round(s.amount * 100), i + 1));
    }
    config.sectors.forEach((s, i) => db.run('INSERT INTO bd_sectors (name, sort, rolls_into, rolls_until) VALUES (?, ?, ?, ?)', s.name, i + 1, s.rollsInto || null, s.rollsUntil || null));
    for (const f of config.mwipFactor) db.run('INSERT INTO bd_mwip_factor (effective_from, factor_bp, set_by, set_at) VALUES (?, ?, ?, ?)', f.effectiveFrom, Math.round(f.factor * 10000), 'live setup', db.now());
  });
  if (snapshots) loadEmployees(db, latestEmployees(snapshots));
}

module.exports = { setupLive, checkConfig, loadEmployees, latestEmployees, paths };

if (require.main === module) {
  const p = paths();
  if (!fs.existsSync(p.config)) { console.error(`No live config yet. Copy server/db/seed/live-config.example.json to ${p.config} and fill in the real goals.`); process.exit(1); }
  fs.mkdirSync(p.dir, { recursive: true });
  const db = dbmod.open(p.db);
  setupLive(db, JSON.parse(fs.readFileSync(p.config, 'utf8')), { snapshots: p.snapshots });
  console.log(`Live database ready: ${p.db}. Pull with "npm run vp:pull-bd", then "npm run live".`);
}
