'use strict';
/* Resets the local database to the made-up seed data (server/db/seed/*.csv).
   employees.csv and projects.csv stand in for the nightly Vantagepoint copy. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dbmod = require('./db/db');
const { parseCsv } = require('./csv');

const SEED = path.join(__dirname, 'db', 'seed');
const read = f => parseCsv(fs.readFileSync(path.join(SEED, f), 'utf8'));
// children first. Everything is cleared, including the append-only and locked tables: a reset is a developer action,
// not something the app can do, so it drops the guard triggers, empties the tables, and recreates the triggers.
const TABLES = ['pursuit_notes', 'pipeline_alerts', 'forecast_snapshots', 'pursuit_snapshots', 'pipeline_projects', 'pipeline_snapshots', 'bd_rows', 'bd_run_meta', 'bd_goals', 'bd_sectors', 'bd_mwip_factor', 'bd_sector_overrides', 'run_pic_history', 'run_project_history', 'run_history', 'run_projects', 'run_warnings', 'runs', 'plan_entries', 'checkin_drafts', 'system_state', 'audit_log', 'settings', 'users', 'projects', 'employees'];

/* the VP copy: replaces both tables, like a nightly copy would */
function loadVantagepointCopy(db) {
  db.tx(() => {
    db.run('DELETE FROM projects');
    db.run('DELETE FROM employees');
    for (const e of read('employees.csv')) {
      db.run('INSERT INTO employees (code, first_name, last_name, email) VALUES (?, ?, ?, ?)', e.Employee, e.FirstName, e.LastName, e.Email);
    }
    for (const p of read('projects.csv')) {
      db.run('INSERT INTO projects (wbs1, name, principal, proj_mgr, status) VALUES (?, ?, ?, ?, ?)', p.WBS1, p.Name, p.Principal, p.ProjMgr, p.Status);
    }
  });
}

/* Compass's own BD data: goals, market sectors (with the Labs roll-up) and the MWIP factor history. Made up. */
function loadBdData(db) {
  db.tx(() => {
    for (const g of read('bd_goals.csv')) db.run('INSERT INTO bd_goals (year, scope, key, amount, sort) VALUES (?, ?, ?, ?, ?)', Number(g.Year), g.Scope, g.Key, Math.round(parseFloat(g.Amount) * 100), Number(g.Sort));
    for (const s of read('bd_sectors.csv')) db.run('INSERT INTO bd_sectors (name, sort, rolls_into, rolls_until) VALUES (?, ?, ?, ?)', s.Name, Number(s.Sort), s.RollsInto || null, s.RollsUntil || null);
    for (const f of read('bd_factor.csv')) db.run('INSERT INTO bd_mwip_factor (effective_from, factor_bp, set_by, set_at) VALUES (?, ?, ?, ?)', f.EffectiveFrom, Number(f.FactorBp), 'seed', db.now());
  });
}

function seed(db, opts) {
  const triggers = db.all("SELECT name FROM sqlite_master WHERE type = 'trigger'").map(t => t.name);
  db.tx(() => {
    for (const t of triggers) db.run(`DROP TRIGGER ${t}`);
    for (const t of TABLES) db.run(`DELETE FROM ${t}`);
  });
  db.applySchema();
  loadVantagepointCopy(db);
  db.tx(() => {
    for (const u of read('users.csv')) {
      db.run('INSERT INTO users (id, username, display_name, email, role, draft_name, employee_code, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        crypto.randomUUID(), u.Username, u.DisplayName, u.Email, u.Role, u.DraftName, u.Employee || null, Number(u.Active));
    }
  });
  loadBdData(db);
  if (!opts || opts.demo !== false) require('./seed-demo').seedDemo(db);
}

module.exports = { seed, loadVantagepointCopy };

if (require.main === module) {
  const db = dbmod.open();
  seed(db);
  const n = t => db.get(`SELECT COUNT(*) AS n FROM ${t}`).n;
  console.log(`Seeded: ${n('users')} people, ${n('employees')} employees, ${n('projects')} projects, ${n('runs')} published runs, ${n('plan_entries')} plan entries.`);
  db.close();
}
