# Spec: Billing (PM billing instructions and accounting queue)

**Status: draft for Josh. Nothing is built.** Source: the recovered prototype `nexus-billing-workbench-v15.html` and the handoff note of 2026-10-30. The prototype is the reference for look and workflow, not for code: it keeps everything in browser storage, uses floating-point dollars and has several known defects (section 9). This module follows the rules in `CLAUDE.md` (VP read-only, pure tested logic, money in cents, effective-dated Admin settings, append-only audit).

## 1. What it is

A Compass module, `modules/billing/`, in the same repository, shell, database and design system as Project Turnaround, BD report and Pipeline watch.

About 100 projects are billed a month by a dozen or more PMs. Today each PM opens each project in Vantagepoint (VP) and types free-form notes for accounting, and invoice processors interpret them. Billing replaces that with one structured request per project per month:

- a PM sees all their projects in one list, enters what to bill, and submits;
- accounting sees every request in one queue, with unambiguous per-phase instructions, and can return a request to the PM;
- the invoice processor still creates the invoice **by hand in VP**. Compass never writes to VP.

Recognized revenue is the amount actually billed. A proposed, submitted or reviewed amount is never called revenue. Projected and actual figures are kept apart so the BD report and Home can use either without mixing them.

## 2. Roles

Compass roles today: `admin`, `pic`, `finance`, `marketing`, `sysadmin` (`shared/rules/roles.js`). Billing adds:

| Who | How they are known | Can do |
|---|---|---|
| **PM of a project** | a user whose VP employee code is the project's project-manager code (the same match PICs use) | See their projects, edit and submit billing for them, read history |
| **Invoice processor** | new role `processor` | Whole queue, review, return, copy instructions, mark processed |
| **Billing admin** | the `admin` role, or `processor` with the Assignments right (open question B2) | Processor rights plus the Assignments page and the period lock |
| **Finance** | existing view-only role | Read the queue and history, no edits (assumed; a setting) |
| PIC, Marketing, System admin | | No access to Billing unless the Admin turns it on in the `access` setting (assumed off) |

The server enforces every rule below. The browser only hides controls. The sign-in-as picker gets seeded PMs and processors.

## 3. The monthly cycle

- A **billing period** is a calendar month with a state: `open` → `cutoff` (PMs can no longer submit; processors work) → `locked` → `reconciled`. A real period selector replaces the prototype's hard-coded month. Compass's run lock is the model: a locked period rejects every write.
- When a period opens, a request is **created for every expected project**, including those that will bill $0. Nothing is silently omitted. A project with no submission shows as "Awaiting PM".
- Requests are keyed by **project (WBS1) + period** and, for fixed fee, one line per billing phase. A unique constraint prevents two live requests for the same key.
- The expected-project list and the phase data come from a scheduled VP pull (section 10), the same way the monthly run gets its data.

## 4. Fixed-fee billing

Each billing phase shows: phase name, phase fee, billed to date, this month's revenue projection, **Bill through %** (cumulative) and **Amount this billing ($)**. The two entry modes stay in sync. They mean "billed through X%" and "bill this much more"; neither is percent complete.

- Phase names and fees come from VP. Projects may have 2, 3, 4 or more phases; amendments and multi-level WBS must be handled, not assumed to be SD/DD/CD/CA.
- Top actions: **Reset to billed**, **Use phase projections** (capped at the phase fee), **No new billings** (zero everywhere and check "No billing this month"). Typing a positive amount clears the check.
- A fully billed phase is locked. Changes there need a privileged, audited adjustment.
- Hover text states whether "remaining" includes this month's proposed amount.

### Validation (re-run on the server)

| Rule | Result |
|---|---|
| Cumulative target below already billed | Blocks submit; error on that field |
| Amount above remaining phase fee, negative amount, blank or non-numeric | Blocks submit |
| Total proposed differs from the project's monthly projection by **strictly more than the variance threshold** (starts at $30,000) | Requires text in Notes to Accounting. Exactly the threshold passes. |
| "No billing this month" with a non-zero total | Blocks submit |
| Source fee or billed-to-date changed since the snapshot the PM worked from | Submit fails safely; the PM is asked to review |

The variance threshold is an **effective-dated Admin setting** (`billing.varianceThreshold`, cents), per the Compass rule that no threshold is a constant. **Save Draft** is always available, even with invalid entries. "No billing" means an explicit submitted $0, not a missing submission. Money is **integer cents** with one documented rule for converting percentages to cents.

## 5. Hourly (T&M) projects

A separate screen: authorized or not-to-exceed amount, billed to date, unbilled labor, expenses and consultants, proposed amount per line, projection, and remaining authorization. A proposed amount may not exceed the line's available unbilled amount or push the project over its authorization. PMs can record a hold or special instruction; a hold is an instruction only, not a VP change. **Proposed for the first release: fixed-fee only**; hourly follows (question B4).

## 6. Notes and history

- **Project notes:** persistent rich-text billing instructions per project.
- **Notes to Accounting:** this period's instructions and variance explanation, kept with the submission.
- Past periods are viewable and never overwritten. A resubmission after a return creates a new **revision**. Earlier revisions stay, with who, when and what changed. Like Turnaround's plan log, revisions and notes are append-only: fixes are new entries.
- Rich text is sanitized on the server before it is stored.
- Copy stays plain and non-punitive. A return says what is unclear, not what the PM did wrong.

## 7. Status flow

`Awaiting PM` → `Draft` → `Submitted` → `Accounting review` → `Processed`; a processor may **Return** a request (with a reason) to `Returned`, and the PM resubmits. Editing a submitted request does not silently change its status: the PM must explicitly withdraw it or answer a return. A request cannot be handled by two people at once. `Processed` records the VP invoice reference and amount once known. The PM's request and accounting's actual amount are stored separately. Error states (such as "stale source data") are named in the build phase's state diagram.

## 8. Accounting queue and assignments

- **Queue:** My projects / All / **Unassigned** (red count). Group by PM or by processor. Each row shows PM, processor, amount, status and the per-phase instructions. **Copy instructions** is kept as the manual handoff to VP.
- **Assignments page (separate, billing admin only):** one processor per project, carried from month to month, with a log of every change (who, when, from, to). Unassigned projects are listed first with an alert. The dropdown lists every active user with the processor role. The queue has **no** "take ownership" button; the prototype's one on the Assignments page is removed.
- The system sends no email to PMs (Compass rule). A returned or missing request shows on Home and in the PM's list; any reminder is a draft the billing admin sends themselves (question B5).

## 9. Differences from the prototype (defects to fix, not copy)

Floating-point dollars and a .001 tolerance; hard-coded "October 2026"; resubmitting deletes that month's earlier history entry; editing notes on a submitted request flips it to Draft; "Amount cannot be negative" shown for an amount that is too low; only three statuses; demo-only identity and `localStorage`; "Take ownership" on the Assignments page; a hard-coded $30,000.

## 10. Data

Tables in Compass's own database (`server/db/schema.sql`), following `docs/DATA-MODEL.md` conventions: text UUID ids, money in whole cents, times in epoch milliseconds, dates as `YYYY-MM-DD`.

| Table | Holds |
|---|---|
| `billing_periods` | month, state, cutoff date, opened and locked by/at |
| `billing_requests` | WBS1, period, type, status, PM code, processor, current revision, no-billing flag |
| `billing_revisions` | immutable: line items (phase id, fee, prior billed, target, amount, all cents), notes, source hash and read time, submitter, time |
| `billing_project_notes` | rich-text instructions per project (append-only versions) |
| `billing_assignments` | WBS1 → processor, with history |

Events go to the existing append-only `audit_log`. The VP copy gains the phase-level data Billing needs (phases and fees, billed to date, monthly projection, billing type, authorization limits) through the same scheduled pull, locally from made-up CSV. **Table and column names for these are not invented here:** they are mapped when Kent supplies a VP report to check against, and the made-up CSV is shaped to match that decision. A snapshot hash of the VP inputs is stored with each revision. Writes use compare-and-set on a revision number.

## 11. Tests (pure logic, JSON fixtures under `modules/billing/tests/fixtures/`)

Target below prior billed; exactly the threshold versus one cent above; 100%-billed phases; no-billing toggle and edit; save draft with invalid fields; Reset, Use projections and No new billings; cents and rounding; stale source data; two writers on one request; duplicate submission; locked period rejects every write; unassigned filter and permissions; return and resubmit revision history; status transitions with audit events; no UPDATE or DELETE path on revisions or the audit log.

## 12. Open questions

Copied into `docs/OPEN-QUESTIONS.md` as B1 to B5 and K-B1 to K-B5.

**For Josh**
- B1. Sensible default now: Billing lives in Compass; BD and Home read projected versus billed from it.
- B2. Who is a processor and who is a billing admin; may a PA edit drafts; do PICs see their projects' billing?
- B3. Is the period always one calendar month; who sets the cutoff and who locks it?
- B4. Fixed-fee only in release one, hourly later?
- B5. How are PMs reminded of a return or a missing submission, given Compass sends no PIC or PM email?

**For Kent**
- K-B1. Which VP report verifies phase fee and billed-to-date.
- K-B2. Does the reporting database lag VP, and by how much.
- K-B3. How amendments and multi-level WBS appear.
- K-B4. Where accounting enters amounts in VP, and whether draft or posted invoices are readable (needed to reconcile).
- K-B5. A read-only database account for the pull.

**Not built:** everything. Live VP reads, invoice reconciliation and any VP write API are out of the first release.
