'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_FILE = path.join(__dirname, 'compass.sqlite');
const SCHEMA_VERSION = 1;

/* open(':memory:') for tests; open() for the real file (git-ignored) */
function open(file) {
  const target = file || process.env.COMPASS_DB || DEFAULT_FILE;
  const raw = new DatabaseSync(target);
  const applySchema = () => {
    // phase 1 created run_warnings without ytd_billed and nothing wrote to it; recreate it so older local files keep working
    const old = raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'run_warnings'").get();
    if (old && !raw.prepare('PRAGMA table_info(run_warnings)').all().some(c => c.name === 'ytd_billed')) raw.exec('DROP TABLE run_warnings');
    // older local files: the users table's role list did not yet have 'pm' and 'processor' (Billing). A CHECK cannot be altered, so rebuild the table and keep every row.
    const usersSql = raw.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
    const rebuildUsers = !!usersSql && !usersSql.sql.includes("'processor'");
    if (rebuildUsers) raw.exec('ALTER TABLE users RENAME TO users_old');
    // local files from the first dashboard build had one layout per person (no board); they are only preferences, so start over
    const dash = raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'dashboard_layouts'").get();
    if (dash && !raw.prepare('PRAGMA table_info(dashboard_layouts)').all().some(c => c.name === 'board')) raw.exec('DROP TABLE dashboard_layouts');
    // older local files: the runs table's kinds did not yet include 'acct' (Principal Accountability, its own run). Rebuild it and keep
    // every row. Foreign keys are off meanwhile and legacy_alter_table is on, which keeps every other table's and trigger's reference to "runs" pointing at the new table; the runs
    // triggers go with the old table, so the schema is applied again afterwards to put them back.
    const runsSql = raw.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'runs'").get();
    const rebuildRuns = !!runsSql && !runsSql.sql.includes("'acct'");
    if (rebuildRuns) raw.exec('PRAGMA foreign_keys = OFF; PRAGMA legacy_alter_table = ON; ALTER TABLE runs RENAME TO runs_old;');
    raw.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    if (rebuildUsers) raw.exec('INSERT INTO users SELECT * FROM users_old; DROP TABLE users_old');
    if (rebuildRuns) {
      raw.exec('INSERT INTO runs SELECT * FROM runs_old; DROP TABLE runs_old; PRAGMA legacy_alter_table = OFF; PRAGMA foreign_keys = ON;');
      raw.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    }
    // older local files: the employees copy had no licensed-architect column (Projects in Pursuit)
    if (!raw.prepare('PRAGMA table_info(employees)').all().some(c => c.name === 'licensed')) raw.exec('ALTER TABLE employees ADD COLUMN licensed INTEGER');
    // older local files: a published report's record of the contract amount rule (reports built before it used the default)
    if (!raw.prepare('PRAGMA table_info(bd_run_meta)').all().some(c => c.name === 'contract_amount_rule')) raw.exec("ALTER TABLE bd_run_meta ADD COLUMN contract_amount_rule TEXT NOT NULL DEFAULT 'feeConsult'");
  };
  applySchema();
  if (!raw.prepare('SELECT version FROM schema_info').get()) {
    raw.prepare('INSERT INTO schema_info (version) VALUES (?)').run(SCHEMA_VERSION);
  }
  let lastStamp = 0;
  return {
    raw, applySchema,
    /* strictly increasing millisecond clock: two writes in one millisecond never share a time */
    now() { lastStamp = Math.max(Date.now(), lastStamp + 1); return lastStamp; },
    get(sql, ...p) { return raw.prepare(sql).get(...p); },
    all(sql, ...p) { return raw.prepare(sql).all(...p); },
    run(sql, ...p) { return raw.prepare(sql).run(...p); },
    tx(fn) {
      raw.exec('BEGIN');
      try { const out = fn(); raw.exec('COMMIT'); return out; }
      catch (e) { raw.exec('ROLLBACK'); throw e; }
    },
    close() { raw.close(); },
  };
}

module.exports = { open };
