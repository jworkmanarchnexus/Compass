-- Compass schema (SQLite). Written so it ports to SQL Server or PostgreSQL: plain types, no SQLite-only tricks
-- except the two append-only triggers at the bottom, which Kent will express as permissions or triggers in his database.
-- Two data owners (docs: data model): the Vantagepoint copy (employees, projects) and Compass's own tables.

CREATE TABLE IF NOT EXISTS schema_info (version INTEGER NOT NULL);

-- ---- Vantagepoint copy (read-only to the app; loaded by the scheduled job, locally from CSV) ----
CREATE TABLE IF NOT EXISTS employees (
  code        TEXT PRIMARY KEY,           -- VP employee code (EMMain.Employee)
  first_name  TEXT NOT NULL,
  last_name   TEXT NOT NULL,
  email       TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS projects (
  wbs1        TEXT PRIMARY KEY,           -- VP project number (PR.WBS1)
  name        TEXT NOT NULL,
  principal   TEXT NOT NULL DEFAULT '',   -- employee code of the PIC; '' = none in VP
  proj_mgr    TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL               -- VP status code: 'A' active, anything else inactive
);

-- ---- Compass's own tables ----
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,     -- the company sign-in name (locally a made-up one)
  display_name  TEXT NOT NULL,
  email         TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL CHECK (role IN ('admin','pic','finance','marketing','sysadmin')),
  draft_name    TEXT NOT NULL DEFAULT '', -- the name used in check-in drafts ("Dana")
  employee_code TEXT,                     -- VP employee code, how a PIC is matched to their projects
  active        INTEGER NOT NULL DEFAULT 1
);

-- every Admin setting; effective-dated, rows are only ever added
CREATE TABLE IF NOT EXISTS settings (
  key            TEXT NOT NULL,
  value_json     TEXT NOT NULL,
  effective_from INTEGER NOT NULL,        -- ms since epoch
  set_by         TEXT NOT NULL,
  set_at         INTEGER NOT NULL,
  PRIMARY KEY (key, effective_from)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          INTEGER NOT NULL,
  user_id     TEXT NOT NULL,
  action      TEXT NOT NULL,              -- e.g. setting.change, user.change
  object      TEXT NOT NULL DEFAULT '',
  detail_json TEXT NOT NULL DEFAULT '{}'
);

-- Report runs (built in phase 2; created now so the schema is in one place)
CREATE TABLE IF NOT EXISTS runs (
  id             TEXT PRIMARY KEY,
  kind           TEXT NOT NULL CHECK (kind IN ('turnaround','bd')),
  period         INTEGER NOT NULL,        -- YYYYMM
  version        INTEGER NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('draft','published','archived')),
  created_at     INTEGER NOT NULL,
  published_at   INTEGER,
  published_by   TEXT,
  archived_at    INTEGER,
  archive_reason TEXT,
  settings_json  TEXT NOT NULL DEFAULT '{}' -- the settings this run was built with, so it can be reproduced
);
CREATE TABLE IF NOT EXISTS run_warnings (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id  TEXT NOT NULL REFERENCES runs(id),
  kind    TEXT NOT NULL,                  -- cant_evaluate | no_pic | no_sector
  wbs1    TEXT NOT NULL DEFAULT '',
  detail  TEXT NOT NULL DEFAULT ''
);

-- Invariant: the audit log is append-only. No path exists to change or remove an entry.
CREATE TRIGGER IF NOT EXISTS audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
