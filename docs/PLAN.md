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

Spec: `docs/SPEC-billing.md`. Release one covers both billing types (fixed fee by phase, hourly) and must be fully working. Build on made-up VP data (CSV), in this order, stopping for Josh after each step:

1. **Rules first (done on branch `billing-rules`):** `modules/billing/logic/` in integer cents: phase math, validation with the strict variance rule, pending amounts, billing months and the rollover, the two billing forms, state transitions, email preference rules (instant, digest, off; quiet hours; weekends; only mine; empty digests). JSON fixtures and tests, no screens.
2. **Server and data (done on branch `billing-server`):** the Billing settings (`billing.varianceThreshold`, `billing.rolloverDay`, `billing.businessHours`; they are added here, not earlier, because a setting nothing reads fails the "no dead switch" test), the `billing_*` tables, request creation for every expected project, revisions, audit events, server-side validation and role checks (new `processor` role; PM and PIC by VP code; PA, Finance, Marketing refused).
3. **Admin (done on branch `billing-admin`):** a Billing tab with the deadline calendar, the reset-clock day, the variance threshold, business hours, and per-project adjustments (all effective-dated where they are settings).
4. **PM and PIC screens:** unbilled list, fixed-fee and hourly billing, notes, history, mid-month "bill again", on the design system.
5. **Accounting screens:** queue, return, copy instructions, Assignments page, each processor's email notification settings (the Off / Immediate / Digest layout Josh drew); emails written to `outbox/` locally. Home gets "returned" and "unbilled" counts.

**Done when:** a seeded PM can enter, save and submit billing for fixed-fee and hourly projects, including a second mid-month request; a PIC can edit their project's billing; a processor sees the full queue, reassigns a project (both processors notified per their settings), returns one request and it is resubmitted as a new revision; the rollover returns every project to unbilled; every rule in the spec's test list passes; no write to VP exists. Live VP reads wait for Kent's verified report.
