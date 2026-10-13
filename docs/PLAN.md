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
