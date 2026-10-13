# Archnexus Compass

Business intelligence and management accountability for Archnexus (~80-person architecture firm). Sister tool to the **Toolbox** (`../ToolBox`, tools that help architects work faster). Compass guides leadership: **Project Turnaround** first, then **BD report** and **Pipeline watch**, plus Home and Admin. Owner: Josh (architect becoming CFO, not a developer). Kent (IT) will host it and may rebuild the front end.

This repo is a working prototype on Josh's computer only (localhost) until Kent's server exists. Its lasting value is the behavior, data model, business rules with tests, and the look.

## Read first

| File | What it is |
|---|---|
| `reference/handoff/CLAUDE.md` | The handoff's hard rules. **Binding** (they were deliberate decisions). Summarized below. |
| `reference/handoff/docs/01-product-spec.md` | Every page and every decided rule. |
| `reference/handoff/docs/02-data-model.md` | Tables, invariants. |
| `reference/handoff/docs/04-open-questions.md` | **Do not decide these.** Ask Josh, or build behind a setting. |
| `reference/handoff/sql/compass_negative_projects.sql` | Validated Vantagepoint query. Source of truth for profit math. |
| `reference/handoff/design/` | Clickable mockup (`portal-mockup.html`), 1440px screens, page source. A design reference, not code to ship. |
| `docs/PLAN.md` | Phases, in order. One at a time. |
| `docs/SPEC-turnaround.md`, `docs/SPEC-bd.md`, `docs/SPEC-pipeline.md`, `docs/SPEC-shell-and-admin.md` | What is built: behavior, rules, permissions. Written from the tested code. |
| `docs/DATA-MODEL.md` | The tables as built and the invariants the database enforces. |
| `docs/FOR-KENT.md` | How to run it, what to keep, the five seams to replace, the API. |
| `docs/OPEN-QUESTIONS.md` | Everything still undecided, with the default today. |
| `docs/DECISIONS.md` | Decisions made, with reasons. |

`reference/` is read-only. Never edit it. `reference/handoff/reference/chatgpt-engine-v0.1` is unreviewed ideas only; ask Josh before adopting anything from it.

## Hard rules (from the handoff, short form)

- Vantagepoint (VP) is read-only. Only a scheduled job reads it; browsers never do. Locally the job reads fake CSV/JSON.
- A published run is locked. Rerun = archive (reason + typing `RERUN`) and a new draft.
- Plan logs are append-only: no edit, no delete; fixes are Correction entries. Entries belong to the project (WBS1), not the run.
- Only the PIC writes plan content. Admin notes are labeled and public. Never post in a PIC's voice.
- The system never emails a PIC as Josh. Reminders are admin-only check-in drafts he sends himself. The only automatic email goes to Josh and has no PIC data.
- A commitment's action (including "Other" words), amount and actual result are visible to everyone who can read the plan (Josh reversed the handoff rule on 2026-10-11); the per-action analysis stays Admin-only. MWIP factor never on PIC pages. YTD only. MWIP and forecast always separate.
- Every threshold is an effective-dated Admin setting, not a constant.
- Copy stays plain and non-punitive.

## Stack and architecture (decided 2026-10-11, mirrors the Toolbox)

Node (>=22.5) + built-in `node:sqlite`, no dependencies if possible, plain JS ES modules for the front end, no framework. Server binds to 127.0.0.1 (port 5281; the Toolbox uses 5280). Local sign-in is a "sign in as" picker of seeded test users; no real auth code. Write SQL that would port to SQL Server or Postgres.

```
server/        API + static files; db/ holds schema, seed data, the SQLite file (git-ignored)
shell/         sidebar, routing, sign-in-as, theme and density
shared/design-system/   copied from ../ToolBox (see DECISIONS)
modules/<id>/  logic/ (pure rules, no DOM, no network, tested, fixtures as JSON) and ui/
```

## Rules

1. Business logic is pure and tested, with JSON fixtures so a rebuild in another language can reuse them. Required tests: every status rule, the run lock (a published run rejects every write), the append-only log (no UPDATE/DELETE path).
2. Design: match the Toolbox. Tokens and shared classes only; no hex colors in module CSS. See `reference/handoff/docs/03-design-system.md`.
3. Data safety: bind to 127.0.0.1; never commit the database or real firm data; fixtures and seeds are made up. Real data only if Josh says so, and it stays out of git.
4. Don't build what production replaces: no real login, no user management, no deployment scripts.
5. Phases (`docs/PLAN.md`): finish one, run all tests, open the app in a browser and click through, commit, stop and give Josh a short plain-language summary (what works, how to try it, what is open, what you did not test).
6. Commits are small, on a branch per phase, merged to `main` when Josh has looked. Never force-push.
7. Product decisions are Josh's: ask with a recommendation. Technical decisions are yours: make them and log non-obvious ones in `docs/DECISIONS.md`.
8. Talk to Josh plainly and briefly. Honest assessments, not reassurance.

## Commands

On Windows PowerShell type `npm.cmd` instead of `npm`.
- `npm start`: http://localhost:5281
- `npm test`: all tests
- `npm run seed`: reset the local database to the made-up data (two published runs, plan logs)
- `npm run run-month`: build the last closed month's draft (the monthly job)
- `npm run daily`: record Missed, prepare check-in drafts, email the admin (the daily job)
- `COMPASS_TODAY=2026-10-07`: pin "today" for the demo (PowerShell: `$env:COMPASS_TODAY='2026-10-07'` before `npm.cmd start`)
