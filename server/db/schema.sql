-- Compass schema (SQLite). Written so it ports to SQL Server or PostgreSQL: plain types, no SQLite-only tricks
-- except the two append-only triggers at the bottom, which Kent will express as permissions or triggers in his database.
-- Two data owners (docs: data model): the Vantagepoint copy (employees, projects) and Compass's own tables.

CREATE TABLE IF NOT EXISTS schema_info (version INTEGER NOT NULL);

-- ---- Vantagepoint copy (read-only to the app; loaded by the scheduled job, locally from CSV) ----
CREATE TABLE IF NOT EXISTS employees (
  code        TEXT PRIMARY KEY,           -- VP employee code (EMMain.Employee)
  first_name  TEXT NOT NULL,
  last_name   TEXT NOT NULL,
  email       TEXT NOT NULL DEFAULT '',
  licensed    INTEGER                     -- 1 = licensed architect, 0 = not, NULL = Vantagepoint does not say (PiP: only architects may be project architect)
);
-- Compass's own: the name to show for a Vantagepoint person instead of the Vantagepoint name (Admin > People). Never written back.
CREATE TABLE IF NOT EXISTS employee_names (
  code         TEXT PRIMARY KEY,          -- VP employee code
  display_name TEXT NOT NULL,
  set_by       TEXT,                      -- users.id
  set_at       INTEGER
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
  role          TEXT NOT NULL CHECK (role IN ('admin','pic','pm','processor','finance','marketing','sysadmin')),
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

-- ---- Phase 3: the plan log, check-in drafts, and the history a run carries for its charts ----

-- The plan log. Entries belong to the PROJECT (wbs1), never to a run, and are APPEND-ONLY: nothing here is ever edited or deleted.
-- A mistake is fixed by a 'correction' entry that points back at the original. Commitments are not a table of their own:
-- whether one is open, done, missed or moved is worked out by replaying the log (modules/turnaround/logic/plan.js).
CREATE TABLE IF NOT EXISTS plan_entries (
  id                TEXT PRIMARY KEY,
  wbs1              TEXT NOT NULL,
  author_id         TEXT,                          -- NULL = the system (it writes only 'missed')
  kind              TEXT NOT NULL CHECK (kind IN ('explanation','commitment','update','correction','done','date_revised','missed','admin_note')),
  body              TEXT NOT NULL DEFAULT '',
  created_at        INTEGER NOT NULL,              -- ms, strictly increasing, so order within a day is exact
  entry_date        TEXT NOT NULL,                 -- the calendar date it was written, 'YYYY-MM-DD'
  corrects_entry_id TEXT,
  commitment_id     TEXT,                          -- a commitment entry's own id; later entries about it carry the same id
  data_json         TEXT NOT NULL DEFAULT '{}'     -- promisedBy, lever, qty | from, to | actual | dueDate
);
CREATE INDEX IF NOT EXISTS plan_entries_wbs1 ON plan_entries (wbs1, created_at);
CREATE TRIGGER IF NOT EXISTS plan_entries_no_update BEFORE UPDATE ON plan_entries
BEGIN SELECT RAISE(ABORT, 'the plan log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS plan_entries_no_delete BEFORE DELETE ON plan_entries
BEGIN SELECT RAISE(ABORT, 'the plan log is append-only'); END;

-- Check-in drafts: prepared by the system, sent (if at all) by the admin from their own mailbox.
CREATE TABLE IF NOT EXISTS checkin_drafts (
  id            TEXT PRIMARY KEY,
  pic_user_id   TEXT NOT NULL,
  situation     TEXT NOT NULL CHECK (situation IN ('overdue','no_plan')),
  step          INTEGER NOT NULL,                  -- 1 = reminder 1 (casual), 2 = reminder 2 (direct)
  tone          TEXT NOT NULL,
  subject       TEXT NOT NULL,
  body          TEXT NOT NULL,
  items_json    TEXT NOT NULL,                     -- [{ wbs1, name, dueDate, ... }] the projects this draft is about
  status        TEXT NOT NULL CHECK (status IN ('waiting','sent','dismissed','withdrawn')),
  created_at    INTEGER NOT NULL,
  resolved_at   INTEGER,
  resolved_date TEXT
);

-- small bits of job state (for example: the day the admin was last emailed about waiting drafts)
CREATE TABLE IF NOT EXISTS system_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- What a run carries for its charts, frozen with it: firm-wide month-end figures for the last 12 months, and for
-- each listed project its year-to-date profit at each month end. Locked with the run like everything else.
CREATE TABLE IF NOT EXISTS run_history (
  run_id        TEXT NOT NULL REFERENCES runs(id),
  period        INTEGER NOT NULL,
  negative_ytd  INTEGER NOT NULL,                  -- cents; total YTD profit of the projects below the line that month
  below_count   INTEGER NOT NULL,
  PRIMARY KEY (run_id, period)
);
CREATE TABLE IF NOT EXISTS run_project_history (
  run_id     TEXT NOT NULL REFERENCES runs(id),
  wbs1       TEXT NOT NULL,
  period     INTEGER NOT NULL,
  profit_ytd INTEGER NOT NULL,
  PRIMARY KEY (run_id, wbs1, period)
);
CREATE TRIGGER IF NOT EXISTS run_history_locked_insert BEFORE INSERT ON run_history
WHEN (SELECT status FROM runs WHERE id = NEW.run_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'run is locked'); END;
CREATE TRIGGER IF NOT EXISTS run_history_locked_update BEFORE UPDATE ON run_history
WHEN (SELECT status FROM runs WHERE id = OLD.run_id) <> 'draft' OR (SELECT status FROM runs WHERE id = NEW.run_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'run is locked'); END;
CREATE TRIGGER IF NOT EXISTS run_history_locked_delete BEFORE DELETE ON run_history
WHEN (SELECT status FROM runs WHERE id = OLD.run_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'run is locked'); END;
CREATE TRIGGER IF NOT EXISTS run_project_history_locked_insert BEFORE INSERT ON run_project_history
WHEN (SELECT status FROM runs WHERE id = NEW.run_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'run is locked'); END;
CREATE TRIGGER IF NOT EXISTS run_project_history_locked_update BEFORE UPDATE ON run_project_history
WHEN (SELECT status FROM runs WHERE id = OLD.run_id) <> 'draft' OR (SELECT status FROM runs WHERE id = NEW.run_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'run is locked'); END;
CREATE TRIGGER IF NOT EXISTS run_project_history_locked_delete BEFORE DELETE ON run_project_history
WHEN (SELECT status FROM runs WHERE id = OLD.run_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'run is locked'); END;

-- The same month-end figures as run_history, but for each PIC's own projects, so "Just mine" can draw its own charts.
-- Locked with the run. Runs built before this table existed have no rows here; the page says so instead of guessing.
CREATE TABLE IF NOT EXISTS run_pic_history (
  run_id       TEXT NOT NULL REFERENCES runs(id),
  pic_code     TEXT NOT NULL,
  period       INTEGER NOT NULL,
  negative_ytd INTEGER NOT NULL,
  below_count  INTEGER NOT NULL,
  PRIMARY KEY (run_id, pic_code, period)
);
CREATE TRIGGER IF NOT EXISTS run_pic_history_locked_insert BEFORE INSERT ON run_pic_history
WHEN (SELECT status FROM runs WHERE id = NEW.run_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'run is locked'); END;
CREATE TRIGGER IF NOT EXISTS run_pic_history_locked_update BEFORE UPDATE ON run_pic_history
WHEN (SELECT status FROM runs WHERE id = OLD.run_id) <> 'draft' OR (SELECT status FROM runs WHERE id = NEW.run_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'run is locked'); END;
CREATE TRIGGER IF NOT EXISTS run_pic_history_locked_delete BEFORE DELETE ON run_pic_history
WHEN (SELECT status FROM runs WHERE id = OLD.run_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'run is locked'); END;

-- ---- BD report: Compass's own data (goals, sectors, the MWIP factor) and what a BD run holds ----

-- annual revenue goals (architectural revenue, net of consultants), by PIC (key = VP employee code) and by market sector
CREATE TABLE IF NOT EXISTS bd_goals (
  year   INTEGER NOT NULL,
  scope  TEXT NOT NULL CHECK (scope IN ('pic','sector')),
  key    TEXT NOT NULL,
  amount INTEGER NOT NULL,                -- cents
  sort   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (year, scope, key)
);
-- market sectors; one may roll into another until a date (Labs counts in Healthcare through 2026-12-31)
CREATE TABLE IF NOT EXISTS bd_sectors (
  name        TEXT PRIMARY KEY,
  sort        INTEGER NOT NULL DEFAULT 0,
  rolls_into  TEXT,
  rolls_until TEXT                         -- 'YYYY-MM-DD'
);
-- the MWIP weighting factor, effective-dated (basis points: 6700 = 0.67). Append-only: old reports keep the factor they used.
CREATE TABLE IF NOT EXISTS bd_mwip_factor (
  effective_from TEXT PRIMARY KEY,         -- 'YYYY-MM-DD'
  factor_bp      INTEGER NOT NULL,
  set_by         TEXT,
  set_at         INTEGER
);
CREATE TRIGGER IF NOT EXISTS bd_mwip_factor_no_update BEFORE UPDATE ON bd_mwip_factor
BEGIN SELECT RAISE(ABORT, 'the MWIP factor history is append-only'); END;
CREATE TRIGGER IF NOT EXISTS bd_mwip_factor_no_delete BEFORE DELETE ON bd_mwip_factor
BEGIN SELECT RAISE(ABORT, 'the MWIP factor history is append-only'); END;
-- the Admin's answer for a project whose Vantagepoint record has no market sector (applies to every later run too)
CREATE TABLE IF NOT EXISTS bd_sector_overrides (
  wbs1   TEXT PRIMARY KEY,
  sector TEXT NOT NULL,
  set_by TEXT,
  set_at INTEGER
);

-- one row per BD run: the facts it was built with
CREATE TABLE IF NOT EXISTS bd_run_meta (
  run_id         TEXT PRIMARY KEY REFERENCES runs(id),
  year           INTEGER NOT NULL,
  months         INTEGER NOT NULL,         -- months elapsed (pace = goal x months / 12)
  cutoff         TEXT NOT NULL,            -- billing cutoff: last day of the report month
  factor_bp      INTEGER NOT NULL,
  on_pace_pct    INTEGER NOT NULL,
  on_track_pct   INTEGER NOT NULL,
  no_sector_rule TEXT NOT NULL,
  contract_amount_rule TEXT NOT NULL DEFAULT 'feeConsult'  -- what "full contract amount" meant for the architectural share of the forecast
);
-- the report's rows, frozen with the run. Percentages are not stored; they are worked out from these.
CREATE TABLE IF NOT EXISTS bd_rows (
  run_id   TEXT NOT NULL REFERENCES runs(id),
  scope    TEXT NOT NULL CHECK (scope IN ('firm','pic','sector')),
  key      TEXT NOT NULL,
  label    TEXT NOT NULL,
  sort     INTEGER NOT NULL DEFAULT 0,
  goal     INTEGER NOT NULL,
  ytd_goal INTEGER NOT NULL,
  ytd      INTEGER NOT NULL,
  forecast INTEGER NOT NULL,
  mwip_raw INTEGER NOT NULL,
  mwip     INTEGER NOT NULL,               -- weighted
  total    INTEGER NOT NULL,
  status   TEXT,                           -- on_track | on_pace | behind | NULL (no goal)
  PRIMARY KEY (run_id, scope, key)
);
CREATE TRIGGER IF NOT EXISTS bd_rows_locked_insert BEFORE INSERT ON bd_rows
WHEN (SELECT status FROM runs WHERE id = NEW.run_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'run is locked'); END;
CREATE TRIGGER IF NOT EXISTS bd_rows_locked_update BEFORE UPDATE ON bd_rows
WHEN (SELECT status FROM runs WHERE id = OLD.run_id) <> 'draft' OR (SELECT status FROM runs WHERE id = NEW.run_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'run is locked'); END;
CREATE TRIGGER IF NOT EXISTS bd_rows_locked_delete BEFORE DELETE ON bd_rows
WHEN (SELECT status FROM runs WHERE id = OLD.run_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'run is locked'); END;
CREATE TRIGGER IF NOT EXISTS bd_run_meta_locked_insert BEFORE INSERT ON bd_run_meta
WHEN (SELECT status FROM runs WHERE id = NEW.run_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'run is locked'); END;
CREATE TRIGGER IF NOT EXISTS bd_run_meta_locked_update BEFORE UPDATE ON bd_run_meta
WHEN (SELECT status FROM runs WHERE id = OLD.run_id) <> 'draft' OR (SELECT status FROM runs WHERE id = NEW.run_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'run is locked'); END;
CREATE TRIGGER IF NOT EXISTS bd_run_meta_locked_delete BEFORE DELETE ON bd_run_meta
WHEN (SELECT status FROM runs WHERE id = OLD.run_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'run is locked'); END;

-- ---- Pipeline watch: weekly snapshots of MWIP (pursuits) and contracted forecast, kept forever ----

-- one row per Monday snapshot
CREATE TABLE IF NOT EXISTS pipeline_snapshots (
  date     TEXT PRIMARY KEY,               -- 'YYYY-MM-DD', a Monday
  taken_at INTEGER NOT NULL,
  source   TEXT
);
-- MWIP: each pursuit not yet contracted, as it stood that Monday (id is the project number it will keep)
CREATE TABLE IF NOT EXISTS pursuit_snapshots (
  snapshot_date TEXT NOT NULL REFERENCES pipeline_snapshots(date),
  pursuit_id    TEXT NOT NULL,
  name          TEXT NOT NULL,
  pic           TEXT NOT NULL,             -- VP employee code
  stage         TEXT,
  win_prob      INTEGER,                   -- percent
  amount        INTEGER NOT NULL,          -- cents, architectural revenue through Dec 31
  PRIMARY KEY (snapshot_date, pursuit_id)
);
-- contracted forecast: each project's remaining billing through Dec 31, and the part now scheduled for next year
CREATE TABLE IF NOT EXISTS forecast_snapshots (
  snapshot_date TEXT NOT NULL REFERENCES pipeline_snapshots(date),
  wbs1          TEXT NOT NULL,
  name          TEXT NOT NULL,
  pic           TEXT NOT NULL,
  amount        INTEGER NOT NULL,
  moved         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (snapshot_date, wbs1)
);
-- project numbers that exist (copied each snapshot), so a pursuit that left MWIP can be matched to the project it became
CREATE TABLE IF NOT EXISTS pipeline_projects (
  wbs1       TEXT PRIMARY KEY,
  name       TEXT,
  pic        TEXT,
  opened     TEXT,
  first_seen TEXT NOT NULL
);
-- what the rules found each Monday. Only the Admin clearing an alert changes a row.
CREATE TABLE IF NOT EXISTS pipeline_alerts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_date TEXT NOT NULL REFERENCES pipeline_snapshots(date),
  rule          TEXT NOT NULL,
  severity      TEXT NOT NULL CHECK (severity IN ('alert','watch')),
  pic           TEXT,
  title         TEXT NOT NULL,
  message       TEXT NOT NULL,
  detail_json   TEXT NOT NULL DEFAULT '{}',
  cleared_at    INTEGER,
  cleared_by    TEXT
);
-- the Admin's notes on a pursuit ("talked to Marcus: lost to a competitor")
CREATE TABLE IF NOT EXISTS pursuit_notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  pursuit_id TEXT NOT NULL,
  at         INTEGER NOT NULL,
  user_id    TEXT NOT NULL,
  body       TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS pipeline_snapshots_no_update BEFORE UPDATE ON pipeline_snapshots BEGIN SELECT RAISE(ABORT, 'snapshots are never changed'); END;
CREATE TRIGGER IF NOT EXISTS pipeline_snapshots_no_delete BEFORE DELETE ON pipeline_snapshots BEGIN SELECT RAISE(ABORT, 'snapshots are never deleted'); END;
CREATE TRIGGER IF NOT EXISTS pursuit_snapshots_no_update BEFORE UPDATE ON pursuit_snapshots BEGIN SELECT RAISE(ABORT, 'snapshots are never changed'); END;
CREATE TRIGGER IF NOT EXISTS pursuit_snapshots_no_delete BEFORE DELETE ON pursuit_snapshots BEGIN SELECT RAISE(ABORT, 'snapshots are never deleted'); END;
CREATE TRIGGER IF NOT EXISTS forecast_snapshots_no_update BEFORE UPDATE ON forecast_snapshots BEGIN SELECT RAISE(ABORT, 'snapshots are never changed'); END;
CREATE TRIGGER IF NOT EXISTS forecast_snapshots_no_delete BEFORE DELETE ON forecast_snapshots BEGIN SELECT RAISE(ABORT, 'snapshots are never deleted'); END;
CREATE TRIGGER IF NOT EXISTS pursuit_notes_no_update BEFORE UPDATE ON pursuit_notes BEGIN SELECT RAISE(ABORT, 'notes are append-only'); END;
CREATE TRIGGER IF NOT EXISTS pursuit_notes_no_delete BEFORE DELETE ON pursuit_notes BEGIN SELECT RAISE(ABORT, 'notes are append-only'); END;
CREATE TRIGGER IF NOT EXISTS pipeline_alerts_no_delete BEFORE DELETE ON pipeline_alerts BEGIN SELECT RAISE(ABORT, 'alerts are never deleted'); END;

-- what is behind each bar of a BD report (drill-downs), frozen with the run: one row per project (or pursuit) per month.
-- ytd rows have month 0; forecast and mwip rows have a YYYYMM month after the billing cutoff. mwip amounts are factored as in the totals.
CREATE TABLE IF NOT EXISTS bd_detail (
  run_id TEXT NOT NULL REFERENCES runs(id),
  kind   TEXT NOT NULL CHECK (kind IN ('ytd','forecast','mwip')),
  item_id TEXT NOT NULL,                   -- project number, or pursuit id
  name   TEXT NOT NULL,
  pic    TEXT NOT NULL DEFAULT '',         -- VP employee code, as counted in the report
  sector TEXT NOT NULL DEFAULT '',         -- market sector after the Admin's answers and any roll-up
  month  INTEGER NOT NULL,
  amount INTEGER NOT NULL,                 -- cents
  PRIMARY KEY (run_id, kind, item_id, month)
);
CREATE TRIGGER IF NOT EXISTS bd_detail_locked_insert BEFORE INSERT ON bd_detail
WHEN (SELECT status FROM runs WHERE id = NEW.run_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'run is locked'); END;
CREATE TRIGGER IF NOT EXISTS bd_detail_locked_update BEFORE UPDATE ON bd_detail
WHEN (SELECT status FROM runs WHERE id = OLD.run_id) <> 'draft' OR (SELECT status FROM runs WHERE id = NEW.run_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'run is locked'); END;
CREATE TRIGGER IF NOT EXISTS bd_detail_locked_delete BEFORE DELETE ON bd_detail
WHEN (SELECT status FROM runs WHERE id = OLD.run_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'run is locked'); END;

-- ---- Billing (docs/SPEC-billing.md). Money is whole cents. ----
-- The Vantagepoint copy for Billing: loaded by the scheduled pull, locally from made-up CSV. Table and column names here are OUR names
-- for what billing needs; they are mapped to real Vantagepoint reports when Kent supplies one (docs/OPEN-QUESTIONS.md K-B1).
CREATE TABLE IF NOT EXISTS vp_billing_projects (
  wbs1             TEXT PRIMARY KEY,
  billing_type     TEXT NOT NULL CHECK (billing_type IN ('fixed','hourly')),
  authorized_cents INTEGER,                          -- hourly: the authorization or not-to-exceed amount; NULL = no limit
  billed_cents     INTEGER NOT NULL DEFAULT 0,       -- billed to date
  projection_cents INTEGER NOT NULL DEFAULT 0        -- this month's revenue projection for the whole project
);
CREATE TABLE IF NOT EXISTS vp_billing_lines (
  wbs1             TEXT NOT NULL,
  line_id          TEXT NOT NULL,
  name             TEXT NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('phase','labor','expense','consultant')),
  sort             INTEGER NOT NULL DEFAULT 0,
  fee_cents        INTEGER NOT NULL DEFAULT 0,       -- phase fee (phases only)
  billed_cents     INTEGER NOT NULL DEFAULT 0,       -- billed to date (phases only)
  available_cents  INTEGER NOT NULL DEFAULT 0,       -- unbilled and eligible (hourly lines only)
  projection_cents INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (wbs1, line_id)
);

-- Admin-entered deadline (and, if needed, start date) for each billing month
CREATE TABLE IF NOT EXISTS billing_calendar (
  month     TEXT PRIMARY KEY,                        -- YYYY-MM, the month being billed
  deadline  TEXT,                                    -- YYYY-MM-DD
  starts_on TEXT,                                    -- YYYY-MM-DD, overrides the default reset day for that month
  set_by    TEXT NOT NULL,
  set_at    INTEGER NOT NULL
);

-- One request per project and billing month (later ones in a month are 'additional'). The content being edited is the draft;
-- every submit makes an immutable revision. Nothing is ever deleted and a processed request takes no more changes.
CREATE TABLE IF NOT EXISTS billing_requests (
  id           TEXT PRIMARY KEY,
  wbs1         TEXT NOT NULL,
  month        TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('regular','additional')),
  form         TEXT NOT NULL CHECK (form IN ('fixed','hourly')),
  status       TEXT NOT NULL CHECK (status IN ('draft','submitted','review','returned','processed')),
  pm_code      TEXT NOT NULL DEFAULT '',
  pic_code     TEXT NOT NULL DEFAULT '',
  draft_json   TEXT NOT NULL DEFAULT '{}',           -- { entries, noBilling, notes }
  source_hash  TEXT NOT NULL DEFAULT '',             -- hash of the Vantagepoint inputs the person was looking at
  revision     INTEGER NOT NULL DEFAULT 0,           -- number of the latest revision (0 = never submitted)
  handled_by   TEXT,                                 -- the processor who has it in review
  was_returned INTEGER NOT NULL DEFAULT 0,
  invoice_ref  TEXT NOT NULL DEFAULT '',
  submitted_on TEXT,                                 -- YYYY-MM-DD of the latest submit
  rev          INTEGER NOT NULL DEFAULT 1,           -- compare-and-set counter: every save must quote the rev it started from
  created_at   INTEGER NOT NULL,
  created_by   TEXT NOT NULL,
  updated_at   INTEGER NOT NULL,
  updated_by   TEXT NOT NULL,
  processed_at INTEGER
);
CREATE INDEX IF NOT EXISTS billing_requests_wbs1 ON billing_requests (wbs1, month);
-- at most one open request per project, in any month
CREATE UNIQUE INDEX IF NOT EXISTS billing_one_open ON billing_requests (wbs1) WHERE status IN ('draft','submitted','review','returned');

CREATE TABLE IF NOT EXISTS billing_revisions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id       TEXT NOT NULL REFERENCES billing_requests(id),
  number           INTEGER NOT NULL,
  event            TEXT NOT NULL,                    -- submit | resubmit | revise
  entries_json     TEXT NOT NULL,
  no_billing       INTEGER NOT NULL,
  notes            TEXT NOT NULL DEFAULT '',
  lines_json       TEXT NOT NULL,                    -- the evaluated lines (fees, prior billed, amounts) as they were
  total_cents      INTEGER NOT NULL,
  projection_cents INTEGER NOT NULL,
  source_hash      TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  created_by       TEXT NOT NULL,
  UNIQUE (request_id, number)
);
-- what happened to a request, in order: every status change, with a returned reason or a PM's answer
CREATE TABLE IF NOT EXISTS billing_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id  TEXT NOT NULL REFERENCES billing_requests(id),
  at          INTEGER NOT NULL,
  user_id     TEXT NOT NULL,
  event       TEXT NOT NULL,
  from_status TEXT NOT NULL,
  to_status   TEXT NOT NULL,
  text        TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS billing_project_notes (   -- persistent instructions per project; the latest row is current
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  wbs1       TEXT NOT NULL,
  body       TEXT NOT NULL,                          -- sanitized rich text
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS billing_project_adjust (  -- per-project adjustments; the latest row of each kind is in force
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  wbs1    TEXT NOT NULL,
  kind    TEXT NOT NULL CHECK (kind IN ('rollover','exclude','include')),
  value   TEXT NOT NULL DEFAULT '',                  -- rollover: the day ('' = back to the default); exclude/include: the month
  reason  TEXT NOT NULL DEFAULT '',
  set_by  TEXT NOT NULL,
  set_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS billing_assignments (     -- which invoice processor owns a project; the latest row is current
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  wbs1         TEXT NOT NULL,
  processor_id TEXT,                                 -- NULL = unassigned
  set_by       TEXT NOT NULL,
  set_at       INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS billing_email_prefs (     -- one row per invoice processor (modules/billing/logic/notify.js)
  user_id    TEXT PRIMARY KEY,
  prefs_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS billing_notifications (   -- what the email rules say processors should hear about; sending is a later step
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  at            INTEGER NOT NULL,
  event         TEXT NOT NULL,
  wbs1          TEXT NOT NULL,
  request_id    TEXT,
  involved_json TEXT NOT NULL DEFAULT '[]',          -- the processors it concerns
  delivery_json TEXT NOT NULL DEFAULT '[]'           -- for each: how their email settings say to deliver it [{ userId, mode, sendAt }]
);

-- My dashboards: each person's own arrangement of the curated dashparts, per dashboard (modules/dashboard/logic). Saving replaces the row.
CREATE TABLE IF NOT EXISTS dashboard_layouts (
  user_id     TEXT NOT NULL REFERENCES users(id),
  board       TEXT NOT NULL CHECK (board IN ('pic','pm')),
  layout_json TEXT NOT NULL,     -- { version, items: [{ id, w, h, on }] }, always normalized against that dashboard's catalog before it is stored
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, board)
);

CREATE TRIGGER IF NOT EXISTS billing_revisions_no_update BEFORE UPDATE ON billing_revisions BEGIN SELECT RAISE(ABORT, 'billing revisions are never changed'); END;
CREATE TRIGGER IF NOT EXISTS billing_revisions_no_delete BEFORE DELETE ON billing_revisions BEGIN SELECT RAISE(ABORT, 'billing revisions are never deleted'); END;
CREATE TRIGGER IF NOT EXISTS billing_events_no_update BEFORE UPDATE ON billing_events BEGIN SELECT RAISE(ABORT, 'billing events are never changed'); END;
CREATE TRIGGER IF NOT EXISTS billing_events_no_delete BEFORE DELETE ON billing_events BEGIN SELECT RAISE(ABORT, 'billing events are never deleted'); END;
CREATE TRIGGER IF NOT EXISTS billing_project_notes_no_update BEFORE UPDATE ON billing_project_notes BEGIN SELECT RAISE(ABORT, 'project notes are never changed'); END;
CREATE TRIGGER IF NOT EXISTS billing_project_notes_no_delete BEFORE DELETE ON billing_project_notes BEGIN SELECT RAISE(ABORT, 'project notes are never deleted'); END;
CREATE TRIGGER IF NOT EXISTS billing_project_adjust_no_update BEFORE UPDATE ON billing_project_adjust BEGIN SELECT RAISE(ABORT, 'adjustments are never changed'); END;
CREATE TRIGGER IF NOT EXISTS billing_project_adjust_no_delete BEFORE DELETE ON billing_project_adjust BEGIN SELECT RAISE(ABORT, 'adjustments are never deleted'); END;
CREATE TRIGGER IF NOT EXISTS billing_assignments_no_update BEFORE UPDATE ON billing_assignments BEGIN SELECT RAISE(ABORT, 'assignments are never changed'); END;
CREATE TRIGGER IF NOT EXISTS billing_assignments_no_delete BEFORE DELETE ON billing_assignments BEGIN SELECT RAISE(ABORT, 'assignments are never deleted'); END;
CREATE TRIGGER IF NOT EXISTS billing_requests_no_delete BEFORE DELETE ON billing_requests BEGIN SELECT RAISE(ABORT, 'billing requests are never deleted'); END;
CREATE TRIGGER IF NOT EXISTS billing_requests_processed BEFORE UPDATE ON billing_requests WHEN OLD.status = 'processed' BEGIN SELECT RAISE(ABORT, 'a processed request takes no more changes'); END;

-- ---- Principal Accountability (modules/accountability): built with the Marketing Report (kind 'bd'), from the same pull, and locked with it ----
-- each PIC's billed goal for a year (gross billings, the firm's accountability sheet; not the Marketing Report's net goals). Admin > Accountability.
CREATE TABLE IF NOT EXISTS acct_goals (
  year   INTEGER NOT NULL,
  pic    TEXT NOT NULL,                    -- VP employee code
  amount INTEGER NOT NULL,                 -- cents
  sort   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (year, pic)
);
-- what the report was built with: the firm figures from the source (NULL = the source had none) and the project sizes in force
CREATE TABLE IF NOT EXISTS acct_meta (
  run_id            TEXT PRIMARY KEY REFERENCES runs(id),
  year              INTEGER NOT NULL,
  months            INTEGER NOT NULL,
  cutoff            TEXT NOT NULL,
  status_day        TEXT NOT NULL,         -- plan statuses (the response column) are as of this day
  turnaround_run_id TEXT,                  -- the published Project Turnaround run they were read from; NULL = none yet
  income_profit     INTEGER,               -- cents, income statement profit (loss) YTD
  esop_bonus        INTEGER,               -- cents, ESOP / bonus contribution YTD
  actual_oh_bp      INTEGER,               -- basis points, YTD actual overhead rate (25500 = 255%)
  assigned_oh_bp    INTEGER,
  arch_revenue      INTEGER NOT NULL,      -- cents, the Marketing Report's firm YTD revenue (net of consultants)
  sizes_json        TEXT NOT NULL          -- [{ label, fee }] the project sizes for "projects to reach goal", fee in dollars
);
-- one row per PIC. To goal, shortfall, percentages and project counts are worked out when shown, never stored.
CREATE TABLE IF NOT EXISTS acct_rows (
  run_id         TEXT NOT NULL REFERENCES runs(id),
  key            TEXT NOT NULL,            -- PIC employee code; '' = Unassigned
  label          TEXT NOT NULL,
  sort           INTEGER NOT NULL DEFAULT 0,
  goal           INTEGER,                  -- cents; NULL = no goal
  billed_ytd     INTEGER NOT NULL,
  profit_ytd     INTEGER NOT NULL,
  negative_ytd   INTEGER NOT NULL,
  unevaluated    INTEGER NOT NULL DEFAULT 0, -- projects with billings whose profit could not be worked out (no overhead rate)
  listed         INTEGER NOT NULL DEFAULT 0, -- the PIC's projects on the Project Turnaround run
  response       TEXT CHECK (response IN ('yes','no')),
  utilization_bp INTEGER,
  backlog        INTEGER NOT NULL,
  mwip           INTEGER NOT NULL,
  ar_over90      INTEGER NOT NULL,
  PRIMARY KEY (run_id, key)
);
CREATE TRIGGER IF NOT EXISTS acct_rows_locked_insert BEFORE INSERT ON acct_rows
WHEN (SELECT status FROM runs WHERE id = NEW.run_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'run is locked'); END;
CREATE TRIGGER IF NOT EXISTS acct_rows_locked_update BEFORE UPDATE ON acct_rows
WHEN (SELECT status FROM runs WHERE id = OLD.run_id) <> 'draft' OR (SELECT status FROM runs WHERE id = NEW.run_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'run is locked'); END;
CREATE TRIGGER IF NOT EXISTS acct_rows_locked_delete BEFORE DELETE ON acct_rows
WHEN (SELECT status FROM runs WHERE id = OLD.run_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'run is locked'); END;
CREATE TRIGGER IF NOT EXISTS acct_meta_locked_insert BEFORE INSERT ON acct_meta
WHEN (SELECT status FROM runs WHERE id = NEW.run_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'run is locked'); END;
CREATE TRIGGER IF NOT EXISTS acct_meta_locked_update BEFORE UPDATE ON acct_meta
WHEN (SELECT status FROM runs WHERE id = OLD.run_id) <> 'draft' OR (SELECT status FROM runs WHERE id = NEW.run_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'run is locked'); END;
CREATE TRIGGER IF NOT EXISTS acct_meta_locked_delete BEFORE DELETE ON acct_meta
WHEN (SELECT status FROM runs WHERE id = OLD.run_id) <> 'draft'
BEGIN SELECT RAISE(ABORT, 'run is locked'); END;

-- ---- Projects in Pursuit (docs/SPEC-pip.md) ----
-- VP copy: clients (Firms) and their contacts, for the PiP form's pickers. Replaced by the nightly copy; never written back.
CREATE TABLE IF NOT EXISTS vp_clients (
  id       TEXT PRIMARY KEY,                       -- VP client id (CL.ClientID)
  name     TEXT NOT NULL,
  address  TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS vp_contacts (
  id        TEXT PRIMARY KEY,                      -- VP contact id
  client_id TEXT NOT NULL,
  name      TEXT NOT NULL,
  email     TEXT NOT NULL DEFAULT '',
  phone     TEXT NOT NULL DEFAULT ''
);
-- one PiP. The fields live in pip_revisions (the latest one is current); this row holds where it stands.
CREATE TABLE IF NOT EXISTS pip_requests (
  id            TEXT PRIMARY KEY,
  seq           INTEGER NOT NULL UNIQUE,           -- the number people use ("PiP 12")
  submitted_by  TEXT NOT NULL,                     -- users.id
  submitted_at  INTEGER NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('new','review','returned','created','withdrawn')),
  rev           INTEGER NOT NULL,                  -- the current revision
  decided_at    INTEGER,                           -- when it was created in VP or withdrawn
  vp_number     TEXT NOT NULL DEFAULT '',          -- the VP project number the admin typed when it was created
  updated_at    INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pip_revisions (         -- every version of the form as submitted; never changed
  request_id  TEXT NOT NULL REFERENCES pip_requests(id),
  rev         INTEGER NOT NULL,
  fields_json TEXT NOT NULL,                       -- modules/pip/logic/form.js clean(), plus urgency as worked out that day
  at          INTEGER NOT NULL,
  by          TEXT NOT NULL,
  PRIMARY KEY (request_id, rev)
);
CREATE TABLE IF NOT EXISTS pip_events (            -- what happened, in order; never changed
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id  TEXT NOT NULL REFERENCES pip_requests(id),
  at          INTEGER NOT NULL,
  user_id     TEXT NOT NULL,
  action      TEXT NOT NULL,                       -- submit | review | return | resubmit | created | withdraw
  from_status TEXT NOT NULL DEFAULT '',
  to_status   TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS pip_notifications (     -- the emails the rules say to send; sending is a later step (Kent's mail automation)
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id  TEXT NOT NULL REFERENCES pip_requests(id),
  at          INTEGER NOT NULL,
  event       TEXT NOT NULL,
  to_json     TEXT NOT NULL,                       -- [{ name, email, why }]
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS pip_revisions_no_update BEFORE UPDATE ON pip_revisions BEGIN SELECT RAISE(ABORT, 'PiP revisions are never changed'); END;
CREATE TRIGGER IF NOT EXISTS pip_revisions_no_delete BEFORE DELETE ON pip_revisions BEGIN SELECT RAISE(ABORT, 'PiP revisions are never deleted'); END;
CREATE TRIGGER IF NOT EXISTS pip_events_no_update BEFORE UPDATE ON pip_events BEGIN SELECT RAISE(ABORT, 'PiP events are never changed'); END;
CREATE TRIGGER IF NOT EXISTS pip_events_no_delete BEFORE DELETE ON pip_events BEGIN SELECT RAISE(ABORT, 'PiP events are never deleted'); END;
CREATE TRIGGER IF NOT EXISTS pip_notifications_no_update BEFORE UPDATE ON pip_notifications BEGIN SELECT RAISE(ABORT, 'PiP notifications are never changed'); END;
CREATE TRIGGER IF NOT EXISTS pip_notifications_no_delete BEFORE DELETE ON pip_notifications BEGIN SELECT RAISE(ABORT, 'PiP notifications are never deleted'); END;
CREATE TRIGGER IF NOT EXISTS pip_requests_no_delete BEFORE DELETE ON pip_requests BEGIN SELECT RAISE(ABORT, 'PiPs are never deleted; withdraw one instead'); END;
CREATE TRIGGER IF NOT EXISTS pip_requests_final BEFORE UPDATE ON pip_requests WHEN OLD.status IN ('created','withdrawn') BEGIN SELECT RAISE(ABORT, 'a created or withdrawn PiP takes no more changes'); END;
