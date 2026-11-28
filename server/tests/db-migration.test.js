'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const dbmod = require('../db/db');

test('an older local database keeps its people when the role list grows (project manager, invoice processor)', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'compass-db-')), 'old.sqlite');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE users (
    id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL CHECK (role IN ('admin','pic','finance','marketing','sysadmin')),
    draft_name TEXT NOT NULL DEFAULT '', employee_code TEXT, active INTEGER NOT NULL DEFAULT 1);
    INSERT INTO users (id, username, display_name, role, employee_code) VALUES ('u1', 'd.whitfield', 'Dana Whitfield', 'pic', 'E101');`);
  old.close();
  const db = dbmod.open(file);
  try {
    assert.deepStrictEqual({ ...db.get('SELECT id, role, employee_code FROM users') }, { id: 'u1', role: 'pic', employee_code: 'E101' }, 'the row survived');
    db.run("INSERT INTO users (id, username, display_name, role) VALUES ('u2', 'k', 'Karen', 'processor')");
    db.run("INSERT INTO users (id, username, display_name, role) VALUES ('u3', 'a', 'Ana', 'pm')");
    assert.throws(() => db.run("INSERT INTO users (id, username, display_name, role) VALUES ('u4', 'x', 'X', 'boss')"), /CHECK/);
    assert.ok(db.get("SELECT name FROM sqlite_master WHERE name = 'billing_requests'"), 'the Billing tables were added');
  } finally { db.close(); }
});

test('an older local database keeps its reports and their locks when Accountability gets its own kind of run', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'compass-db-')), 'old.sqlite');
  const first = dbmod.open(file); // today's schema, then turned back into the old runs table (kinds 'turnaround' and 'bd' only)
  first.run("INSERT INTO runs (id, kind, period, version, status, created_at, published_at, published_by) VALUES ('r1', 'turnaround', 202609, 1, 'draft', 1, NULL, NULL)");
  first.run("INSERT INTO run_projects (run_id, wbs1, name, billed_cur, billed_ytd, billed_jtd, profit_cur, profit_ytd, profit_jtd, first_seen_period) VALUES ('r1', 'P1', 'P', 0, 0, 0, 0, 0, 0, 202609)");
  first.run("UPDATE runs SET status = 'published', published_at = 2, published_by = 'u' WHERE id = 'r1'");
  first.raw.exec("PRAGMA foreign_keys = OFF; PRAGMA legacy_alter_table = ON; ALTER TABLE runs RENAME TO runs_x;");
  first.raw.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8').replace("CHECK (kind IN ('turnaround','bd','acct'))", "CHECK (kind IN ('turnaround','bd'))"));
  first.raw.exec("INSERT INTO runs SELECT * FROM runs_x; DROP TABLE runs_x;");
  first.raw.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8').replace("CHECK (kind IN ('turnaround','bd','acct'))", "CHECK (kind IN ('turnaround','bd'))"));
  assert.ok(!first.get("SELECT sql FROM sqlite_master WHERE name = 'runs'").sql.includes("'acct'"), 'the old shape');
  first.close();
  const db = dbmod.open(file);
  try {
    assert.strictEqual(db.get('SELECT COUNT(*) AS n FROM runs').n, 1, 'the report survived');
    assert.strictEqual(db.get("SELECT name FROM sqlite_master WHERE name = 'runs_old'"), undefined, 'no leftover table');
    assert.deepStrictEqual(db.all("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'runs' ORDER BY name").map(t => t.name), ['runs_locked', 'runs_no_delete'], 'its guards are back');
    assert.throws(() => db.run("UPDATE runs SET version = 9 WHERE id = 'r1'"), /run is locked/);
    assert.throws(() => db.run("DELETE FROM run_projects WHERE run_id = 'r1'"), /run is locked/, 'the rows\' lock still finds the run');
    db.run("INSERT INTO runs (id, kind, period, version, status, created_at) VALUES ('a1', 'acct', 202609, 1, 'draft', 3)");
    assert.strictEqual(db.get('PRAGMA foreign_keys').foreign_keys, 1, 'foreign keys back on');
    assert.deepStrictEqual(db.all('PRAGMA foreign_key_check'), []);
  } finally { db.close(); }
});
