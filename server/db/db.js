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
    raw.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
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
