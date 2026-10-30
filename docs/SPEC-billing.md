# Spec: Billing (PM billing instructions and accounting queue)

**Status: draft v3 for Josh (revised 2026-10-30 after his answers, twice). Nothing is built.** Source: the recovered prototype `nexus-billing-workbench-v15.html`, the handoff note of 2026-10-30, and Josh's answers. The prototype is the reference for look and workflow, not for code: it keeps everything in browser storage, uses floating-point dollars and has several known defects (section 10). This module follows `CLAUDE.md` (VP read-only, pure tested logic, money in cents, effective-dated Admin settings, append-only audit).

## 1. What it is

A Compass module, `modules/billing/`, in the same repository, shell, database and design system as Project Turnaround, BD report and Pipeline watch.

About 100 projects are billed a month by a dozen or more PMs. Today each PM opens each project in Vantagepoint (VP) and types free-form notes for accounting, and invoice processors interpret them. Billing replaces that with a structured request per project:

- a PM or PIC sees all their projects in one list, enters what to bill, and submits;
- accounting sees every request in one queue, with unambiguous per-phase instructions, and can return a request;
- the invoice processor still creates the invoice **by hand in VP**. Compass never writes to VP.

**Release one covers every project type** and must be fully working, not a fixed-fee demo (section 5).

Recognized revenue is the amount actually billed. A proposed, submitted or reviewed amount is never called revenue. Projected and actual figures are kept apart so the BD report and Home can use either.

## 2. Roles

| Who | How they are known | Can do |
|---|---|---|
| **PM of a project** | a user whose VP employee code is the project's project-manager code | See and edit billing for their projects, submit, read history |
| **PIC of a project** | a user whose VP employee code is the project's principal code | The same as the PM, for their projects |
| **Invoice processor** | role `processor`: **Karen, Camille, Josh** | The whole queue, review, return, copy instructions, mark processed, assignments, their own email settings |
| **Admin** (Josh) | existing `admin` role | Everything, plus the deadline calendar and Billing settings |
| PA, Finance, Marketing, System admin | | **No access** to Billing (not visible in the side bar) |

Seeds use made-up PMs and the first names Karen, Camille and Josh as processors, as the prototype does. The server enforces every rule; the browser only hides controls. Because a PIC can edit billing, a PIC's edit is recorded under their own name and never in the PM's voice (a Compass rule).

## 3. Billing months, deadlines and the clock reset

**Nothing is ever locked.** There is no period lock and no "reconciled" state. History is still never overwritten (section 6).

- **Billing month.** Each request belongs to a billing month. The "current billing month" is the month people are billing for now.
- **Clock reset (rollover).** On a rollover day each month the current billing month moves forward and **every project shows again in the unbilled list**. Josh suggested "like the 12th"; this is a setting in the **Admin panel (Billing tab), default the 12th** (effective-dated), not a constant. Before the rollover day, last month's billing is still the current one.
- **Deadline calendar (Admin).** A page where Josh enters, for each billing month, the **billing deadline** (it moves with holidays and weekends) and, if needed, that month's rollover date. Months with no entry fall back to the default rollover day and show "no deadline set" to PMs and processors.
- **Anytime entry.** PMs and PICs can enter and submit billing at any time, including **mid-month billing** for clients that need it regularly or at fiscal year-end. Several requests may exist for one project in one billing month (a "bill again" after an earlier one). At most one request per project is open (Draft, Submitted, Returned or in review) at a time. The first request of a month for a project is the regular one. Later ones are marked "additional".
- **Individual adjustments.** An Admin, or a PM/PIC under **Advanced settings** on a project, can adjust that project: set a different rollover day, mark it as billing on a mid-month schedule (a reminder date only), or exclude it from this month's expected list with a reason. Each change goes to the audit log.
- **Unbilled list.** A project is "unbilled" for the current billing month until it has a submitted request for that month, including an explicit $0 "No billing this month". Nothing is silently omitted, and zero-bill projects stay in the list.

## 4. Fixed-fee billing

Each billing phase shows: phase name, phase fee, billed to date, this month's revenue projection, **Bill through %** (cumulative) and **Amount this billing ($)**. The two entry modes stay in sync. They mean "billed through X%" and "bill this much more"; neither is percent complete.

- Phase names and fees come from VP. Projects may have 2, 3, 4 or more phases; amendments and multi-level WBS must be handled, not assumed to be SD/DD/CD/CA.
- Top actions: **Reset to billed**, **Use phase projections** (capped at the phase fee), **No new billings** (zero everywhere and check "No billing this month"). Typing a positive amount clears the check.
- A fully billed phase is locked for normal editing. A change needs a privileged, audited adjustment.
- Hover text states whether "remaining" includes this month's proposed amount.
- **Pending amounts count.** VP's billed-to-date will not include a request that was submitted but not yet invoiced. For mid-month and repeat billing, the available amount in a phase is the fee minus VP's billed-to-date minus any submitted-not-processed requests for that phase.

### Validation (re-run on the server)

| Rule | Result |
|---|---|
| Cumulative target below already billed | Blocks submit; error on that field |
| Amount above remaining phase fee, negative amount, blank or non-numeric | Blocks submit |
| Total proposed differs from the project's monthly projection by **strictly more than the variance threshold** | Requires text in Notes to Accounting. Exactly the threshold passes. |
| "No billing this month" with a non-zero total | Blocks submit |
| Source fee or billed-to-date changed since the snapshot the person worked from | Submit fails safely; they are asked to review |

The **variance threshold** starts at $30,000 and is an **effective-dated Admin setting** (`billing.varianceThreshold`, cents) in Admin, as Compass requires. The comparison rule stays strictly greater than. **Save Draft** is always available, even with invalid entries. "No billing" means an explicit submitted $0. Money is **integer cents** with one documented rule for converting percentages to cents.

## 5. All project types

Release one handles the two billing types the firm uses (Josh, 2026-10-30): **fixed fee by phase** (section 4) and **hourly**. Each is a "billing form" with its own line items and validation, chosen from the project's VP billing type, so a third type later adds a form, not a rewrite.

**Hourly (T&M):** authorized or not-to-exceed amount, billed to date, unbilled labor, expenses and consultants, proposed amount per line, projection, and remaining authorization. A proposed amount may not exceed the line's available unbilled amount or push the project over its authorization (counting pending requests, as above). A PM can record a hold or special instruction; a hold is an instruction only, not a VP change. The same notes, variance rule, statuses and history apply.

## 6. Notes and history

- **Project notes:** persistent rich-text billing instructions per project.
- **Notes to Accounting:** this request's instructions and variance explanation, kept with the submission.
- History is never overwritten. A resubmission after a return, or any edit after submission, creates a new **revision**. Earlier revisions stay, with who, when and what changed. Like Turnaround's plan log, revisions and notes are append-only; fixes are new entries.
- Rich text is sanitized on the server before it is stored.
- Copy stays plain and non-punitive. A return says what is unclear.

## 7. Status flow

`Awaiting PM` (unbilled) → `Draft` → `Submitted` → `Accounting review` → `Processed`; a processor may **Return** a request (with a reason) to `Returned`, and the PM or PIC resubmits as a new revision. Editing a submitted request does not silently change its status: the person must explicitly withdraw it or answer a return. A request cannot be handled by two people at once. `Processed` records the VP invoice reference and amount once known. The request and accounting's actual amount are stored separately. Error states (such as "stale source data") are named in the build phase's state diagram.

## 8. Accounting queue, assignments and email

- **Queue:** My projects / All / **Unassigned** (red count). Group by PM or by processor. Each row shows PM, processor, amount, status and the per-phase instructions. **Copy instructions** is kept as the manual handoff to VP.
- **Assignments page (separate):** one processor per project, carried from month to month, with a log of every change (who, when, from, to). Unassigned projects are listed first with an alert. The dropdown lists every active user with the processor role. The queue has **no** "take ownership" button; the prototype's one on the Assignments page is removed. Any processor (and the Admin) may reassign; both the old and the new processor are told, per their email settings.
- **Reminders:** none for PMs and PICs on day one.
- **Email for accounting (opt in, per processor).** Billing's emails are their own: they are separate from the Turnaround and Marketing report emails, which keep their own rules. Each processor sets their own preferences (in production tied to the signed-in user; locally a "sign in as" picker). Josh's design (his mockup of 2026-10-30):

| Alert | Fires when | Starting default |
|---|---|---|
| New PM submissions | a PM or PIC submits billing for one of my projects | Digest |
| Resubmitted billing | a returned request is corrected and resubmitted | Immediate |
| Submitted instructions revised | an authorized revision changes the submitted amounts or notes | Immediate |
| Assignment changes | projects are assigned to or removed from me (**both** the old and the new processor are told, each by their own setting) | Digest |
| PM clarification received | a PM answers an accounting question | Immediate |
| Large billing variances | a request differs from its projection by more than the variance threshold | Immediate |
| Missing billing instructions | PMs have not submitted by a scheduled deadline (from the deadline calendar) | Digest |
| Unprocessed requests | a submitted request stays in my queue | Digest |
| Financial data changed | material VP inputs changed after submission | Immediate |
| Billing cycle summary | a summary of my finished and outstanding invoices | Off |

Each alert is **Off, Immediate or Digest**.

| Digest preference | Choices | Starting default |
|---|---|---|
| Frequency | Daily, Twice daily, Weekly | Daily |
| First delivery time | time of day | 7:00 AM |
| Second delivery time (Twice daily) | time of day | 1:00 PM |
| Day (Weekly) | day of week | Monday |
| Send on weekends | on/off | off |
| Only include my assigned projects | on/off | on |
| Send digest even if nothing has changed | on/off | off |

| Reminder rule | Choices | Starting default |
|---|---|---|
| Days before billing cutoff (for "Missing") | days | 3 |
| Unprocessed request age | days | 2 |
| Suppress routine immediate alerts outside business hours | on/off | on |

"Business hours" is an Admin setting (default weekdays 8:00 AM to 5:00 PM). Locally the emails are written to `outbox/` like the existing stub; real sending is Kent's question (H9). Resolved with Josh: this is a separate set of emails from Turnaround and Marketing, so the Turnaround rule "the only automatic email goes to Josh" is narrowed to Turnaround in `CLAUDE.md`.

## 9. Data

Tables in Compass's own database (`server/db/schema.sql`), following `docs/DATA-MODEL.md`: text UUID ids, money in whole cents, times in epoch milliseconds, dates as `YYYY-MM-DD`.

| Table | Holds |
|---|---|
| `billing_calendar` | billing month, deadline date, rollover date (Admin-entered) |
| `billing_requests` | WBS1, billing month, kind (regular or additional), billing form, status, PM and PIC codes, processor, current revision, no-billing flag |
| `billing_revisions` | immutable: line items (phase or line id, fee, prior billed, pending, target, amount, all cents), notes, source hash and read time, author, time |
| `billing_project_notes` | rich-text instructions per project (append-only versions) |
| `billing_project_settings` | per-project adjustments (rollover day, exclusion with reason), with history |
| `billing_assignments` | WBS1 → processor, with history |
| `billing_email_prefs` | one row per processor: the settings table above |

Settings (effective-dated, Admin): `billing.varianceThreshold`, `billing.rolloverDay`, and the `access` setting gains Billing. Events go to the existing append-only `audit_log`. The VP copy gains the phase-level data Billing needs (phases and fees, billed to date, monthly projection, billing type, authorization limits) through the same scheduled pull, locally from made-up CSV. **Table and column names for these are not invented here;** they are mapped when Kent supplies a VP report. A snapshot hash of the VP inputs is stored with each revision. Writes use compare-and-set on a revision number.

## 10. Differences from the prototype (defects to fix, not copy)

Floating-point dollars and a .001 tolerance; hard-coded "October 2026"; resubmitting deletes that month's earlier history entry; editing notes on a submitted request flips it to Draft; "Amount cannot be negative" shown for an amount that is too low; only three statuses; demo-only identity and `localStorage`; "Take ownership" on the Assignments page; a hard-coded $30,000; one request per project per month (mid-month billing needs more).

## 11. Tests (pure logic, JSON fixtures under `modules/billing/tests/fixtures/`)

Target below prior billed; exactly the threshold versus one cent above, and a changed threshold from the setting; 100%-billed phases; no-billing toggle and edit; save draft with invalid fields; Reset, Use projections and No new billings; cents and rounding; pending (submitted, not invoiced) amounts reducing what can be billed; mid-month second request, and only one open request per project; rollover day moving the current billing month and returning every project to unbilled; a month with no deadline entered; stale source data; two writers on one request; duplicate submission; each hourly rule; unassigned filter and permissions; PM and PIC may edit, PA, Finance and Marketing refused; return and resubmit revision history; no UPDATE or DELETE path on revisions or the audit log; email preferences deciding instant, digest or nothing (quiet hours, weekends, only mine, empty digest).

## 12. Open questions

Copied into `docs/OPEN-QUESTIONS.md`.

**Decided by Josh (2026-10-30):** billing emails are their own set, separate from Turnaround and Marketing; the email settings are the ones in section 8; only two billing types (fixed fee by phase, hourly); any processor can reassign and both processors are told per their settings; one open request per project, and the second person sees "being edited by"; the clock-reset day is a setting in the Admin panel.

**For Josh**
- B3. Confirm the default reset day (the 12th), and how an additional mid-month billing is labeled for accounting (default "Additional").
- B9. Business hours default (weekdays 8 to 5), the second digest time (1:00 PM) and the weekly day (Monday): fine as defaults?

**For Kent**
- K-B1. Which VP report verifies phase fee and billed-to-date.
- K-B2. Does the reporting database lag VP, and by how much.
- K-B3. How amendments and multi-level WBS appear.
- K-B4. Where accounting enters amounts in VP, and whether draft or posted invoices are readable (needed to reconcile).
- K-B5. A read-only database account for the pull.
- H9 (existing). How the email sends, now also for processor email.

**Not built:** everything. Live VP reads, invoice reconciliation and any VP write API are out of the first release.
