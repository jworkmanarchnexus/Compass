'use strict';
/* Two local SQLite files, deliberately separate:
     data/knowledge.sqlite       what the AI side may see: dictionary, investigations, findings, metric definitions, approvals, audit.
                                  Nothing in here is an unredacted result. It is safe to describe in a prompt.
     data/protected/raw.sqlite   reference-report rows, candidate rows, reconciliation detail with real identifiers and amounts,
                                  and the surrogate-id key. Never read by the tool server's output path except through the gateway.
   Both live under discovery/data/ (git-ignored). Tests pass a temp directory. */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const KNOWLEDGE = `
CREATE TABLE IF NOT EXISTS dict_tables (name TEXT PRIMARY KEY, definition TEXT, column_count INTEGER, keys TEXT);
CREATE TABLE IF NOT EXISTS dict_columns (tbl TEXT, col TEXT, primary_key TEXT, domain TEXT, data_type TEXT, nullable TEXT, description TEXT, PRIMARY KEY (tbl, col));
CREATE TABLE IF NOT EXISTS evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tbl TEXT NOT NULL, col TEXT, level TEXT NOT NULL,   -- exists|populated|current|authoritative|reconciled
  status TEXT NOT NULL,                                                                       -- verified|provisional|failed
  note TEXT, source TEXT, investigation_id TEXT, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS relationships (
  id INTEGER PRIMARY KEY AUTOINCREMENT, left_tbl TEXT, left_cols TEXT, right_tbl TEXT, right_cols TEXT,
  status TEXT NOT NULL,                                                                       -- documented|inferred|verified|failed
  cardinality TEXT, note TEXT, investigation_id TEXT, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS investigations (
  id TEXT PRIMARY KEY, title TEXT, requirement TEXT, status TEXT NOT NULL, created INTEGER, updated INTEGER);
CREATE TABLE IF NOT EXISTS findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT, investigation_id TEXT, kind TEXT NOT NULL,           -- hypothesis|test|reconciliation|rejected|decision|note
  status TEXT, subject TEXT, body TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS metrics (
  name TEXT, version INTEGER, definition TEXT NOT NULL, status TEXT NOT NULL,                 -- draft|reconciled|approved|retired
  last_validated INTEGER, PRIMARY KEY (name, version));
CREATE TABLE IF NOT EXISTS ref_reports (
  id TEXT PRIMARY KEY, name TEXT, version INTEGER, checksum TEXT, meta TEXT NOT NULL, status TEXT NOT NULL, imported INTEGER);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, description TEXT, scope TEXT, sql_hash TEXT, sql_text TEXT,
  status TEXT NOT NULL,                                                                       -- pending|approved|denied|used
  requested INTEGER, decided INTEGER, investigation_id TEXT);
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, actor TEXT, action TEXT, detail TEXT);
`;

const RAW = `
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS ref_rows (ref_id TEXT, sheet TEXT, row_no INTEGER, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ref_rows_ix ON ref_rows (ref_id, sheet);
CREATE TABLE IF NOT EXISTS candidate_rows (run_id TEXT, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS candidate_rows_ix ON candidate_rows (run_id);
CREATE TABLE IF NOT EXISTS recon_detail (run_id TEXT, level TEXT, key TEXT, detail TEXT NOT NULL);
`;

function openStore(dir) {
  fs.mkdirSync(path.join(dir, 'protected'), { recursive: true });
  const knowledge = new DatabaseSync(path.join(dir, 'knowledge.sqlite'));
  const raw = new DatabaseSync(path.join(dir, 'protected', 'raw.sqlite'));
  knowledge.exec(KNOWLEDGE); raw.exec(RAW);
  const now = () => Date.now();
  const json = o => JSON.stringify(o ?? null);
  const store = {
    dir, knowledge, raw, now,
    audit(actor, action, detail) { knowledge.prepare('INSERT INTO audit (at, actor, action, detail) VALUES (?,?,?,?)').run(now(), actor, action, json(detail)); },
    tx(db, fn) { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } },
    close() { knowledge.close(); raw.close(); },
  };
  return store;
}

module.exports = { openStore };
