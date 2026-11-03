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
