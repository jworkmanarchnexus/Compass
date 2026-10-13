# Data model (as built)

`server/db/schema.sql` is the source. This page explains it and says where it departs from the handoff's sketch (`reference/handoff/docs/02-data-model.md`).

Conventions: ids are text UUIDs (Kent may change this); **money is whole cents (integers)**; times are milliseconds since the epoch; calendar dates are text `YYYY-MM-DD` (the server's local date); percentages are never stored. The SQL is plain and meant to port to SQL Server or PostgreSQL. Only the triggers are engine-specific; in another database express them as permissions or triggers.

## Two data owners

**Vantagepoint copy** (read-only to the app; loaded by the scheduled pull, locally from CSV): `employees` (code, names, email), `projects` (WBS1, name, principal code, project-manager code, status code). Compass never writes to Vantagepoint and never queries it from a browser or on a page load.

**Compass's own tables:**

| Table | Holds | Notes |
|---|---|---|
| `users` | People: login, name, role (`admin`, `pic`, `finance`, `marketing`, `sysadmin`), name used in drafts, VP employee code, active | how a PIC is matched to their projects |
| `settings` | every Admin setting: key, JSON value, `effective_from`, who, when | rows only ever added; the value in force at a moment is the latest row at or before it |
| `audit_log` | at, user (or `system`), action, object, detail | **append-only** (database triggers) |
| `runs` | kind (`turnaround`; `bd` later), period (YYYYMM), version, status, created, published (when, by), archived (when, reason), the settings it was built with | one live (draft or published) run per kind and period |
| `run_projects` | per listed project: PIC and PM codes; billed and profit for current month, YTD, JTD; first period it appeared in | locked with the run |
| `run_warnings` | `cant_evaluate`, `no_pic` (and `no_sector` later), with the project and YTD billed | locked with the run |
| `run_history` | firm-wide month-end negative YTD profit and below-break-even count, 12 months | locked with the run; feeds the charts |
| `run_pic_history` | the same month-end figures for each PIC's own listed projects | locked with the run; feeds "Just mine" charts. Runs built before this table existed have none, and the page says so |
| `run_project_history` | each listed project's YTD profit at each month end this year | locked with the run |
| `plan_entries` | the plan log: project, author (null = system), kind, text, created, entry date, the entry it corrects, the commitment it concerns, data (a commitment: due date and lever, plus the words for Other; a done entry: `improved` yes or no; a date revision: from and to) | **append-only** (database triggers) |
| `checkin_drafts` | PIC, situation, step, tone, subject, text, the projects it is about, status (`waiting`, `sent`, `dismissed`, `withdrawn`), when resolved | the only plan-related table that is edited (a waiting draft's wording; its status) |
| `bd_goals` | annual revenue goals by PIC (VP employee code) and by market sector, in cents | edited in Admin > BD reports |
| `bd_sectors` | market sectors, with an optional roll-up (`rolls_into` until `rolls_until`: Labs into Healthcare through 2026-12-31) | |
| `bd_mwip_factor` | the MWIP weighting factor in basis points, effective-dated | **append-only** (database triggers) |
| `bd_sector_overrides` | the Admin's sector for a project that had none in Vantagepoint | applies to every later report |
| `bd_run_meta`, `bd_rows` | a BD run's facts (months elapsed, cutoff, factor, thresholds) and its rows (firm, PIC, sector: goal, pace, YTD, forecast, raw and weighted MWIP, total, status) | locked with the run; a BD run is a `runs` row with kind `bd`, its notes are `run_warnings` rows |
| `system_state` | small job state (the day the Admin was last emailed) | |

## Invariants the database enforces (so a bug in the code cannot break them)

1. `audit_log`, `plan_entries` and `bd_mwip_factor`: no update, no delete.
2. A run's rows (`run_projects`, `run_warnings`, `run_history`, `run_pic_history`, `run_project_history`, `bd_rows`, `bd_run_meta`) can be added, changed or removed only while the run is a **draft**.
3. A run itself moves only draft → published, or published → archived with a non-empty reason and nothing else changed; an archived run never changes; only a draft may be deleted.

A reset of the local database (`npm run seed`) is a developer action: it drops these guards, empties the tables and recreates the guards. The app has no such path.

## Departures from the handoff sketch

- **No `commitments` or `commitment_events` tables.** A commitment's state (open, done, missed, how often its date moved, kept or not) is replayed from `plan_entries`, so nothing mutable can drift from the history. Entry kinds added: `done`, `date_revised`, `missed`.
- **No `pct_*` columns.** Percentages are worked out when shown.
- **`run_projects` has no stored PIC/PM names**, only codes; names are resolved from `employees`.
- **`run_history` and `run_project_history` are new**: the charts' history is frozen with each run so no page ever asks Vantagepoint.
- **BD tables** are `bd_goals` (the sketch's `goals`), `bd_sectors` and `bd_sector_overrides` (instead of `sector_map`), `bd_mwip_factor`, `bd_run_meta` and `bd_rows`. The pipeline tables are not built (Pipeline watch is not built).
- **`users.employee_code`** is the handoff's `pic_employee_code`. Roles are set by the Admin in Compass (the handoff's People tab), not read from a directory.

## What a production pull must deliver

`load(period)` (see `server/vp-local.js`) returns, for the run month: the active chargeable projects (`wbs1`, name, principal code, project-manager code, status); monthly ledger rows for those projects (`wbs1`, `period`, `billed`, `labor`, `expenses` in cents; billed positive); and each project's lowest and highest overhead percent. It must be able to serve the past 12 month-ends (the SQL run once per month, as the Excel report is built), because each run stores its own chart history. The local files in `server/db/seed/` show the shape.
