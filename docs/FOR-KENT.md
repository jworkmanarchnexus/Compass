# For Kent

Compass is the Arch Nexus leadership accountability tool: Project Turnaround, the Marketing Report (BD report) and Pipeline watch are built. This repo is a **working prototype that runs on one computer**. This page says how to run it, what is worth keeping, exactly what you would replace to host it, and what is still open. Josh owns how it should behave; you own where and how it runs.

Read next: `docs/SPEC-turnaround.md` and `docs/SPEC-shell-and-admin.md` (behavior), `docs/DATA-MODEL.md`, `docs/OPEN-QUESTIONS.md`, `docs/DECISIONS.md` (why things are the way they are).

## 1. Run it

Needs Node 22.5 or newer (it uses the built-in `node:sqlite`; there are no runtime dependencies). On Windows PowerShell type `npm.cmd` for `npm`.

```
npm start          http://localhost:5281, this computer only
npm test           76 tests, a few seconds
npm run seed       reset the local database to the made-up demo (two published runs, plan logs)
npm run run-month  the monthly job (build the last closed month's draft)
npm run daily      the daily job (goals not reported on, check-in drafts, the Admin's one email)
npm run vp:pull-bd the Marketing Report's Vantagepoint pull (read only) into a local snapshot
npm run live       http://localhost:5290: the Marketing Report on that snapshot, own database (docs/LIVE-MODE.md)
```

Environment variables: `PORT` (default 5281), `COMPASS_DB` (path of the SQLite file), `COMPASS_URL` (the address put in the Admin's email), and `COMPASS_TODAY=2026-10-07` (pins "today"; the demo data is written around that day, so statuses drift on any other day).

The first `npm start` loads the made-up seed data (`server/db/seed/`). Sign in with the "sign in as" picker. Nothing real is in the repo; the database file and the `outbox/` folder are git-ignored.

## 2. What is durable and what is a prototype

| Keep (the lasting value) | Rebuild or replace |
|---|---|
| **The rules**, as pure code with no database, clock or network: `modules/turnaround/logic/` (profit, selection, run lifecycle, schedule, plan log, drafts) and `shared/rules/` (roles, settings) | The screens (`shell/`, `modules/turnaround/ui/`): plain JavaScript that defines the behavior and look. Rebuild in whatever you prefer. |
| **The fixtures**: every rule as JSON cases (`modules/turnaround/tests/fixtures/README.md`). Usable from any language. | The "sign in as" picker (no security value) |
| **The server tests** (`server/tests/`): what each role is sent, the lock, the append-only log, the jobs | The local Vantagepoint stand-in (`server/vp-local.js`) and the file mailer (`server/mail.js`) |
| **The schema** (`server/db/schema.sql`) and the invariants it enforces | SQLite itself, the built-in static file server, the single process |
| **The behavior specs and decision log** | `server/seed*.js` and the seed data (demo only) |
| **The design system** (`design-system/`, `shared/design-system/`: tokens, CSS, icons), copied from the Toolbox | |

## 3. The five seams

Everything Compass needs from its surroundings goes through one of these. Replace them and the rest stands.

1. **Sign-in.** `currentUser()` in `server/app.js` reads the `X-Compass-User` header and loads the person from `users`. Production should identify the person from the network sign-in instead and look them up by the user key (open question H7). The front end's only identity code is `shared/platform/session.js` and the header in `shared/platform/http.js`. Roles come from the `users` table, set by the Admin.
2. **The Vantagepoint pull.** One method: `load(period)` returning `{ projects, ledger, overhead }` (shape in `docs/DATA-MODEL.md` and `server/vp-local.js`). Production runs `reference/handoff/sql/compass_negative_projects.sql` (or its monthly-bucket equivalent) with the **read-only service account**, from the scheduled job only. **Never from a browser and never on a page load.** It must also be able to serve the past 12 month-ends, because each run stores its own chart history. The BD report needs a second method, `loadBd(period)` (projects with principal and market sector; monthly revenue net of consultants; contracted forecast as the plan revenue entries with their dates, `forecastEntries = [{ wbs1, start, end, amount }]`, plus the firm holiday calendar `holidays` and each project's `fee`, `consultFee` and `reimbAllow`, from which Compass spreads the forecast by working days; pursuits as raw records `pursuits = [{ id, name, pic, sector, stage, estFee, weightedFee, estStart, estCompletion }]`, from which Compass works out MWIP with the Admin's MWIP options; see `docs/SPEC-bd.md` sections 4b and 7, and `tools/bd-live-pull.js` for the tested statements). Where that data lives is open question H3. For the drill-downs it also returns `forecastMonths` (`[{ id, month, amount }]`, a project's forecast by month, YYYYMM) and `mwipMonths` (the same per pursuit) as weights, and a `name` on each pursuit. Only the proportions matter; the report's own totals are what get spread.

   Pipeline watch needs a third, `loadPipeline(date)`, returning `{ pursuits, forecast, projects }`: `pursuits` = `[{ id, name, pic, stage, winProb, amount }]` (MWIP: not yet contracted, through Dec 31; **id is the project number the pursuit will keep when it is promoted**); `forecast` = `[{ wbs1, name, pic, amount, moved }]` (contracted, still to bill through Dec 31; moved = the part scheduled for next year); `projects` = `[{ wbs1, name, pic, opened }]` (project numbers that exist). In production it returns the pipeline as it is now, and the Monday job stamps it with that Monday; locally the seed files hold eight Mondays and the one asked for is picked out. Open question P1.

   The Monday job is `npm run pipeline-snapshot` (`server/jobs/weekly-snapshot.js`); like the others, scheduling it is yours (Monday 5:00 a.m. is the plan).
3. **The mailer.** One method: `sendToAdmin({ to, subject, body })`. The only automatic email is to the Admin and carries a count and a link, never PIC or project names (a test checks this). Compass never emails a PIC.
4. **The scheduler.** Two commands: `npm run run-month` on the first business day (or daily with `--scheduled`, which acts only on the first weekday), and `npm run daily` every day. Both are safe to run twice. The Admin settings "Run day" and "Run time" only record the intent; nothing reads them.
5. **The database.** `server/db/db.js` is a thin wrapper (`get`, `all`, `run`, `tx`, `now`) over `node:sqlite`. SQL is plain. Money is whole cents; ids are text UUIDs; times are epoch milliseconds; dates are `YYYY-MM-DD` text. The three guards (append-only audit log and plan log; locked runs) are SQLite triggers: in another engine, express them as permissions or triggers, and keep the tests that try to break them.

## 4. The API

JSON over HTTP. Every call except health and the dev picker needs a signed-in person. A project, run or draft you may not see answers 404 or 403; the server never relies on the browser to hide anything. The front end reaches the server **only** through `shared/platform/` (one file per area), so that folder is the whole client contract.

| Method and path | Who | What |
|---|---|---|
| `GET /api/health` | anyone | alive |
| `GET /api/dev/users` | anyone (local only) | the sign-in-as list |
| `GET /api/me` | signed in | the person, role, what they may open, Admin tab levels, the Admin's check-in count |
| `GET /api/home` | signed in | Home, shaped by role |
| `GET /api/dashboards/:board`, `PUT /api/dashboards/:board` | people who are PIC (`pic`) or PM (`pm`) on an active project, and the Admin; their own only | a dashboard's catalog and this person's layout; save `{ layout }` (normalized first) or `{ reset: true }`. `/api/me` lists which `dashboards` the person has. GET also carries `burn.projectedSpendPct` (Admin setting) for the fee burn |
| `GET /api/turnaround/current` | Turnaround viewers | the page for the last published run (`{ run: null }` until one exists) |
| `GET /api/projects/:wbs1/plan[?cycle=YYYY]` | Turnaround viewers | a project's page: status and round dates, the form's context, every goal, the history newest first, figures; for its PIC, their projects on the list (`steps`) |
| `POST /api/projects/:wbs1/plan/entries` | the project's PIC (`update`, a comment); Admin (`admin_note`) | add a comment or an admin note |
| `POST /api/projects/:wbs1/plan/checkin` | the project's PIC | the goal check-in: `{ cause?, helped?, comment?, keep?, approach?, how? }`. Writes the explanation (first of the year), the report on the open goal and the next goal; all or nothing |
| `POST /api/projects/:wbs1/plan/midmonth` | the project's PIC | the mid-month update: `{ status: progress | done | stuck, comment }`\| done \| stuck, comment }` |
| `GET /api/admin/settings`, `PUT /api/admin/settings` | Admin edit; System admin read | settings; save `{ changes: { key: value } }` |
| `GET /api/admin/people`, `PUT /api/admin/people/:id` | Admin edit; System admin read | people; change role, active, draft name |
| `GET /api/admin/names`, `PUT /api/admin/names/:code` | Admin edit; System admin read | the name shown for a Vantagepoint person (`{ name }`; empty = the Vantagepoint name). Table `employee_names`; every name shown goes through `server/names.js` |
| `GET /api/admin/audit` | Admin, System admin | the audit log |
| `GET /api/admin/runs` | Admin, System admin | the run list |
| `POST /api/admin/runs` | Admin | build a draft (`{ period }`, default last closed month) |
| `GET /api/admin/runs/:id`, `/overview` | Admin | a run's contents and warnings; the page for any run, draft included |
| `POST /api/admin/runs/:id/rebuild`, `/publish`, `/archive` | Admin | rebuild a draft; publish; archive (`{ reason, confirm: "RERUN" }`) and build the next draft |
| `GET /api/admin/checkins`, `PUT /api/admin/checkins/:id`, `POST /api/admin/checkins/:id/send`, `/dismiss`, `/undo` | Admin | the queue; edit a waiting draft; mark sent; dismiss; undo |
| `POST /api/admin/daily` | Admin | run the daily checks now |
| `GET /api/admin/patterns[?year=YYYY]` | Admin | the goal analysis for a year |
| `GET /api/pipeline[?date=&kind=mwip\|forecast]` | Pipeline viewers | the table for one snapshot (default: latest) with alerts, conversions and the chart |
| `GET /api/pipeline/detail?date=&kind=&pic=` | Pipeline viewers | one PIC's pursuits (or contracts); notes only for the Admin |
| `GET /api/pipeline/export?date=&kind=` | Pipeline viewers | the table as CSV |
| `POST /api/admin/pipeline/alerts/:id/clear`, `POST /api/admin/pipeline/notes`, `POST /api/admin/pipeline/snapshot` | Admin | clear an alert, add a pursuit note, take this week's snapshot now |
| `GET /api/bd/reports/:id/detail?kind=ytd\|forecast\|mwip&scope=firm\|pic\|sector&key=` | BD viewers | what is behind a bar: the projects or pursuits (by month for forecast and MWIP), read from what was frozen with the report |
| `GET /api/bd/reports`, `GET /api/bd/reports/:id` | BD viewers | the report list (published; the Admin also sees drafts) and one report, shaped by role |
| `POST /api/admin/runs` with `{ kind: "bd", period }` | Admin | build a BD draft |
| `POST /api/admin/bd/runs/:id/rebuild`, `/publish`, `/archive` | Admin | rebuild a draft; publish (refused while revenue has no market sector, unless the setting says otherwise); archive and rerun |
| `GET /api/admin/bd/inputs`, `PUT /api/admin/bd/goals`, `POST /api/admin/bd/factors`, `PUT /api/admin/bd/overrides` | Admin edit; System admin read | goals, the MWIP factor history, sectors and the Admin's sector answers |

Errors: `{ "error": "plain-language message" }` with 400 (bad input), 401 (not signed in), 403 (not allowed), 404, 409 (not allowed in the current state, e.g. already published). The messages are written for the person reading them.

## 5. What any rebuild must keep (the hard rules)

These were deliberate decisions; each is enforced somewhere and tested.

1. **Vantagepoint is read-only, production only.** One select-only account; only the scheduled job reads it; results are stored in Compass's own database.
2. **A published run is locked.** Re-running archives the old run (reason and the word `RERUN`) and creates a new draft. PICs see the last published run until a new one is published.
3. **The plan log is append-only.** Fixes are Correction entries. Entries belong to the project, not the run.
4. **Only the PIC writes plan content.** The Admin may add labeled, public notes, never in a PIC's voice.
5. **The system never emails a PIC.** Reminders are drafts the Admin sends from their own mailbox. The only automatic email goes to the Admin: a count and a link.
6. **A commitment's action and whether it improved the project are visible to everyone who may read the plan.** (The handoff hid them from PICs; Josh reversed that on 2026-10-11, and on 2026-10-12 removed the dollar amounts: a commitment is now a kind of action, some words, and a system-set due date.) The per-action analysis, drafts and run contents stay Admin-only.
7. **Every threshold is an effective-dated Admin setting.** A run records the settings it was built with.
8. **Money is exact** (whole cents). No floating point in money, no silent fallbacks (a project with no overhead plan is reported, not guessed).

## 6. Tests

`npm test` runs everything with Node's built-in runner. The pure rules read the JSON fixtures; the server tests start a real server on a random local port against an in-memory database. For a port to another language, load the fixtures first (they need no database), then port the server tests. `modules/turnaround/tests/fixtures/README.md` says what each file proves and what the fixtures cannot cover.

## 7. Security notes

- The server binds to `127.0.0.1` only. The sign-in-as picker is for local use and must not be reachable from the network.
- No real firm data is in the repo. Josh decides if and when real data is loaded; it must stay out of git.
- PIC performance data and profit by project are sensitive. In production, enforce the role rules in `shared/rules/roles.js` on the server (it already does) and keep the Vantagepoint credential out of the repo and out of the browser.
- Modules in preview: the server check is `roles.canUse(user, area, settings)`, which is the role rule plus the `release` setting (`docs/SPEC-shell-and-admin.md` section 2a). Keep it on the server; the browser only hides the menu item. A test server alongside the live one is still the right place for anything that writes data.
- Static files are served only from `shell/`, `shared/` and `modules/`; `reference/`, `server/` and `docs/` are not reachable.
- The Toolbox's shared stylesheet shows the mobile-menu overlay whenever the window is narrow; Compass overrides it (`shell/shell.css`). The Toolbox probably has the same problem.

## 8. Not built, and open

Not built: the Firm snapshot on Home, Export Excel, the plan page's contract fee, the ladder's "Repeat" step. A real sign-in, hosting, the mailer, scheduling, and editing a person's Vantagepoint employee code from the People page are yours (or open). Everything undecided is in `docs/OPEN-QUESTIONS.md`.

## BD report PDF export

Browser-side only (no server part). `shared/vendor/jspdf.umd.min.js` and `shared/export/assets.js` (embedded fonts and the Arch Nexus logo) are copies of the Toolbox Scheduler's. The page layout rule is pure (`modules/bd/logic/export-plan.js`, fixture `export-plan.json`); the drawing is `modules/bd/ui/export-draw.js`. If the front end is rebuilt, keep the plan and its fixture and redraw however suits.

## Billing API and the pull (not yet shown on screen; see `docs/SPEC-billing.md`)

Every call is checked on the server (`server/billing.js`); a PM or PIC reaches only their own projects, a processor or the Admin all of them, everyone else is refused. A save quotes the `rev` it started from; a stale one gets 409.

| Call | Who | What |
|---|---|---|
| `GET /api/billing/portfolio[?month=&scope=mine\|unassigned\|all]` | PM, PIC, processor, Admin | every expected project once, with its state, amounts, deadline, processor |
| `GET /api/billing/projects/:wbs1[?month=]` | the project's PM or PIC, processors, Admin | Vantagepoint facts (with pending amounts), the open request, history, notes, deadline |
| `POST /api/billing/projects/:wbs1/requests` | PM or PIC of the project, Admin | start a request (409 if one is open) |
| `POST /api/billing/projects/:wbs1/notes`, `.../adjust` | PM or PIC, Admin | persistent notes; a project's own reset day or leaving a month out |
| `GET /api/billing/requests/:id`, `PUT .../draft` | as above | read; Save Draft (any content) |
| `POST /api/billing/requests/:id/<event>` | by event | `submit`, `resubmit`, `revise`, `withdraw`, `edit`, `answer` (PM or PIC); `start-review`, `return`, `process`, `release` (processor) |
| `GET /api/billing/assignments`, `PUT .../assignments/:wbs1` | processors, Admin | who owns each project |
| `GET /api/billing/calendar`, `PUT /api/admin/billing/calendar` | read: Billing users; write: Admin | each month's deadline and start date |
| `GET`/`PUT /api/billing/email-prefs` | processors, Admin | the person's own email notification settings |

**The pull.** `source.loadBilling()` (locally `server/vp-local.js`, from made-up CSV) is the one method to implement: projects with their billing type, billed to date and projection, and their phases or hourly lines. The table and column names behind it are Kent's to map to a verified Vantagepoint report (K-B1). Amounts that are submitted but not yet in Vantagepoint count as billed (`pending`) until the next copy is loaded, so a second request cannot overbill.

**Emails.** `billing_notifications` records what accounting should hear about, with the delivery each person's settings call for. Nothing is sent yet; sending is Kent's question (H9).
