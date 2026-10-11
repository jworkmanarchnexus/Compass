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
  detail  TEXT NOT NULL DEFAULT '',
  ytd_billed INTEGER                      -- cents, for the warning list
);

-- Invariant: the audit log is append-only. No path exists to change or remove an entry.
CREATE TRIGGER IF NOT EXISTS audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

-- ---- Phase 2: what a run holds, and the lock ----
-- Money is whole cents. Percentages are not stored; they are worked out from these (profit / billed).
CREATE TABLE IF NOT EXISTS run_projects (
  run_id            TEXT NOT NULL REFERENCES runs(id),
  wbs1              TEXT NOT NULL,
  name              TEXT NOT NULL,
  pic_code          TEXT NOT NULL DEFAULT '',   -- '' = no PIC (only present when the run is set to keep "Unassigned")
  pm_code           TEXT NOT NULL DEFAULT '',
  billed_cur        INTEGER NOT NULL,
  billed_ytd        INTEGER NOT NULL,
  billed_jtd        INTEGER NOT NULL,
  profit_cur        INTEGER NOT NULL,
  profit_ytd        INTEGER NOT NULL,
  profit_jtd        INTEGER NOT NULL,
  first_seen_period INTEGER NOT NULL,           -- the first run this project appeared in (starts its plan clock)
  PRIMARY KEY (run_id, wbs1)
);
-- Invariant: a published run is locked. Only a draft may have rows added, changed or removed, and a run's own row
-- changes only draft -> published, or published -> archived (with a reason). Archived runs never change.
CREATE TRIGGER IF NOT EXISTS run_projects_locked_insert BEFORE INSERT ON run_projects
WHEN (SELECT status FROM runs WHERE id = NEW.run_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'run is locked'); END;
CREATE TRIGGER IF NOT EXISTS run_projects_locked_update BEFORE UPDATE ON run_projects
WHEN (SELECT status FROM runs WHERE id = OLD.run_id) <> 'draft' OR (SELECT status FROM runs WHERE id = NEW.run_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'run is locked'); END;
CREATE TRIGGER IF NOT EXISTS run_projects_locked_delete BEFORE DELETE ON run_projects
WHEN (SELECT status FROM runs WHERE id = OLD.run_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'run is locked'); END;

CREATE TRIGGER IF NOT EXISTS run_warnings_locked_insert BEFORE INSERT ON run_warnings
WHEN (SELECT status FROM runs WHERE id = NEW.run_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'run is locked'); END;
CREATE TRIGGER IF NOT EXISTS run_warnings_locked_update BEFORE UPDATE ON run_warnings
WHEN (SELECT status FROM runs WHERE id = OLD.run_id) <> 'draft' OR (SELECT status FROM runs WHERE id = NEW.run_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'run is locked'); END;
CREATE TRIGGER IF NOT EXISTS run_warnings_locked_delete BEFORE DELETE ON run_warnings
WHEN (SELECT status FROM runs WHERE id = OLD.run_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'run is locked'); END;

CREATE TRIGGER IF NOT EXISTS runs_locked BEFORE UPDATE ON runs
WHEN OLD.status = 'archived'
  OR (OLD.status = 'draft' AND NEW.status = 'archived')
  OR (OLD.status = 'published' AND NOT (
        NEW.status = 'archived' AND NEW.archive_reason IS NOT NULL AND length(trim(NEW.archive_reason)) > 0
        AND NEW.id = OLD.id AND NEW.kind = OLD.kind AND NEW.period = OLD.period AND NEW.version = OLD.version
        AND NEW.created_at = OLD.created_at AND NEW.published_at IS OLD.published_at AND NEW.published_by IS OLD.published_by
        AND NEW.settings_json = OLD.settings_json))
BEGIN SELECT RAISE(ABORT, 'run is locked'); END;
CREATE TRIGGER IF NOT EXISTS runs_no_delete BEFORE DELETE ON runs
WHEN OLD.status <> 'draft'
BEGIN SELECT RAISE(ABORT, 'run is locked'); END;
