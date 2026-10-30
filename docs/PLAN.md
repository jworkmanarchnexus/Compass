# Plan

One phase at a time. At the end of each: run all tests, click through in a browser, commit, plain-language summary to Josh.

## Phase 0: Repo and skeleton (this phase)
Repo, handoff unpacked untouched in `reference/handoff/`, design system copied from the Toolbox, `npm start` serving an empty shell on 127.0.0.1:5281, one test.
**Done when:** Josh runs `npm start`, sees the page, and tests pass.

## Phase 1: Shell, database, sign-in-as, Admin shell
- Schema: users (roles Admin, PIC, Finance view-only, Marketing director view-only, System admin), settings (effective-dated), runs, run_projects, run_warnings, audit_log.
- Sign-in-as picker; sidebar from the mockup; hash routing; theme and density like the Toolbox.
- Server-side role checks. Admin shell with the People tab and the settings store.
- Seed: ~8 made-up PICs/PMs and ~16 made-up projects (shaped like the mockup's sample data).

## Phase 2: Monthly run
- The VP query's output as a fake CSV/JSON "VP pull"; a job that turns it into a **draft run** with warnings. Profit rules as pure tested code with fixtures (the SQL stays the source of truth for math).
- Draft/publish/archive lifecycle with the lock and the `RERUN` rule, tested. Audit log.
- Josh's email: a stub that writes to a file locally.

## Phase 3: Project Turnaround (built; see DECISIONS)
- Josh's review/publish view and PIC view ("Just mine / Everyone"), plan page with the append-only log and commitments, plan status and standing rules (tested), check-in drafts queue.

## Phase 4: Home
Needs your attention, data checks, next runs, firm snapshot tiles (hidden until a source exists).

## Phase 5+: BD report (built; see SPEC-bd), then Pipeline watch (built; see SPEC-pipeline)
Both were built on made-up local sources so they could be shown and judged; where the real data lives (open questions H3, P1) is still open.

## Phase N: Handoff quality (done: SPECs, fixtures guide, FOR-KENT, DATA-MODEL, OPEN-QUESTIONS)
SPECs, language-neutral fixtures, a `docs/FOR-KENT.md`.

## Phase 6: Billing module (proposed, not started)

Spec: `docs/SPEC-billing.md`. Build on made-up VP data (CSV), in this order, stopping for Josh after each step:

1. **Rules first:** `modules/billing/logic/` in integer cents (phase math, validation, the strict variance rule, state transitions) with JSON fixtures and tests. No screens. Add `billing.varianceThreshold` as an effective-dated Admin setting.
2. **Server and data:** the `billing_*` tables, period creation (a request for every expected project), revisions, audit events, server-side validation and role checks (new `processor` role).
3. **PM screens:** portfolio, fixed-fee phase billing, notes, history, on the design system.
4. **Accounting screens:** queue, return, copy instructions, Assignments page. Home gets "returned" and "awaiting PM" counts.
5. **Hourly** (only if Josh confirms it belongs in release one).

**Done when:** a seeded PM can enter, save and submit a period's billing; a processor sees the full queue, returns one request and the PM resubmits it as a new revision; every rule in the spec's test list passes; no write to VP exists. Live VP reads wait for Kent's verified report.
