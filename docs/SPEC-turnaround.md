# Spec: Project Turnaround

What the module does, the rules it follows, the data it keeps, who may do what, and what is still open. Written from the built and tested behavior, not from the mockup; where the mockup disagreed with itself, this says which rule was chosen (marked **chosen**). The rules are pinned by fixtures in `modules/turnaround/tests/fixtures/` (see its README).

Related: `reference/handoff/docs/01-product-spec.md` (the original intent), `docs/DECISIONS.md` (why), `docs/OPEN-QUESTIONS.md`, `docs/SPEC-shell-and-admin.md`.

## 1. Purpose

Each month, list the active projects that are below break-even for the year, grouped by the principal in charge (PIC), and keep an honest record of what each PIC says is driving the loss and what they have promised to do about it. The numbers come from Vantagepoint; the record belongs to Compass. The tone is about the numbers, not the person.

## 2. Who may do what

| | Admin | PIC | Finance | Marketing director | System admin |
|---|---|---|---|---|---|
| See the Project Turnaround page (last published run) | yes | yes | yes | only if the Admin turns it on (default no) | no |
| See a draft run | yes | no | no | no | no |
| Build, rebuild, publish, archive a run | yes | no | no | no | no (can see the run list) |
| Read any project's plan | yes | yes, all of them | yes | with page access | no |
| Write plan entries | no (labeled admin notes only) | only on projects they lead | no | no | no |
| See a commitment's action (including Other words) and whether it improved the project | yes | **yes, on every project** | yes | yes (with page access) | no |
| See each PIC's on-time, kept and standing | yes | own always; others per setting | per setting | per setting | no |
| Check-in drafts and queue | yes | **never** | no | no | no |
| Commitment patterns, Reminders and standing settings | edit | no | no | no | patterns no; settings view |

"Per setting" is `visibility.picRecords`: `everyone` (default), `principals` (Admin and PICs), or `admin`. The server removes what a viewer may not see before sending; the browser only hides controls.

A PIC "leads" a project when the project's Vantagepoint principal code equals the PIC's employee code in Compass.

## 3. The run (monthly report)

States: **draft**, **published**, **archived**.

- A scheduled job builds a **draft** for the last closed month on the first business day (first weekday; holidays are not modelled) and emails the Admin a count and a link. The Admin can also build one by hand for any closed month. Only one draft-or-published run may exist per month; building again is refused.
- A draft may be **rebuilt** (re-pulled and re-selected) by the Admin with no ceremony: nobody else has seen it. (**Chosen**; the original spec only describes archiving.)
- **Publish** locks the run. A published run never changes.
- To change a published run: **archive** it (a reason is required **and** the exact word `RERUN` typed) which in one step builds a new draft with the next version number. The archived run stays on file, marked, with its reason. Plan logs are untouched.
- Everyone but the Admin sees the **last published run** (latest month, latest version), never a draft. If the newest published run is archived and its replacement is still a draft, they see the previous month's.
- Each run stores the settings it was built with and its own chart history (12 month-end figures; per project, year-to-date profit by month this year). All of it is locked with the run.
- The lock is enforced twice: by the rules and by the database (changes to a published or archived run's rows are refused).

## 4. Profit and which projects are listed

Per project (one row per project number, WBS1), for three windows (current month, year to date from January of the run's year, job to date):

> Profit = Billed − Labor × (1 + overhead%) − Expenses

- Overhead% is the project's own rate (lowest and highest of its plan rows). If it has no rate, or more than one rate, the project **cannot be evaluated**: no profit is invented, no company default is substituted; it appears as a warning.
- Money is whole cents; the overhead multiplication is rounded once to the cent per window. Percentages are profit ÷ billed (blank when nothing was billed) and are not stored.
- The source filters (active, chargeable, project number not starting Z or J) are the validated SQL's; `reference/handoff/sql/compass_negative_projects.sql` is the source of truth for the math.

A project is **listed** when it can be evaluated, its YTD profit is below `include.ytdProfitBelow` (default $0), and its YTD billed is at least `include.ignoreBilledUnder` (default $0). A project with **no PIC** is always reported as a warning, and is left out of the run unless `include.noPic` is `unassigned` (then it appears under "Unassigned"). A project that is both unevaluable and without a PIC gets two warnings. Listed projects are ordered by PIC, then worst YTD profit first.

## 5. The plan log

Entries belong to the **project**, not to a run. The log is **append-only**: no edit, no delete, enforced by rules and by the database. A mistake is fixed with a **Correction** entry pointing at the original (which shows "Corrected on …"). The plan cycle is the calendar year: each January starts clean; earlier years stay readable.

**The order of a plan.** When a project first makes the list, the PIC's only option is an **explanation** (what is driving the loss). It is written **once per plan cycle** and stays the only option until it exists, however late; an admin note does not satisfy or hide it. After it, the PIC adds **updates** and **commitments**, nothing else. The server enforces this (409 with a plain message).

Entry kinds: `explanation`, `commitment`, `update`, `done`, `date_revised` (all written by the PIC; `correction` exists only in older entries: a PIC who got something wrong adds an update that says so); `admin_note` (written by the Admin, labeled, public, never counts toward a PIC's record); `missed` (written only by the system).

- **Commitment**: text and **one** action (lever) from ten. The PIC does **not** pick a date or give a number. The system sets the due date: the **next check-in**, which falls every 14 days (a setting, `due.cadenceDays`) from the day the project first showed on a published report, and is always after today (a commitment made on a check-in day is due at the following one). The form shows it ("Next due date: Oct 14. On that date you will give an update on this commitment and make a new one."). The kind of action is chosen first, above the text box. The levers, each with a short explanation shown when the PIC points at it: *Bring in money*: recover additional services; negotiate a fee adjustment; capture unbilled earned revenue; secure additional project scope; **Other**. *Spend less*: reduce remaining labor hours; optimize staffing mix; eliminate scope creep; reduce consultant and external costs; **Other**. (The earlier list of eight actions is kept only so old log entries keep their names.) **Other** gives the PIC a fill-in line (a few words, up to 120 characters, required); the words are kept with the commitment and shown with it. The action and whether it improved the project are visible to everyone who can read the plan (Josh's decision, 2026-10-11, reversing the handoff's rule). Only the analysis in section 9a is the Admin's alone. The PIC can still use Change date (with a reason; earlier dates stay on record).
- **Check-in** is how a PIC moves a plan forward once a commitment is open, in one step: *report back* on each open commitment (what happened, and the required yes or no: "Did this action improve the financial state of the project during this period?"), then make the **next commitment** (kind of action and words), due at the following check-in. Reporting on or before the commitment's date counts as **kept**; after it, **done late** (not kept). With nothing open, the PIC just makes a commitment. An **Update** can be added any time between due dates. The yes or no is how the Admin tracks which kinds of action work (section 9a). The API keeps a plain Mark done as a building block; the page does not offer it.
- **There is no Change date.** The due date is the system's check-in schedule, not the PIC's to move. Older plans keep their date revisions on the log.
- **Missed** is recorded by the daily job when an open commitment's current date has passed by `due.missedAfterDays` (default 14) days. (**Chosen**: the mockup's own examples disagree.)
- A done or missed commitment is final: later entries about it are ignored.
- **No corrections.** The log is still append-only; a mistake is set right with a later update.
- Text is required for every entry (4,000 characters at most).

## 6. Plan status (per project, as of today)

The first plan is due `due.newProjectDays` (14) days after the project first appeared on a **published** run, and never before the end of the January grace period (`due.graceUntil`, default Feb 1). After any PIC entry, the next update is due `due.afterEntryDays` (30) days later. Only PIC-written entries reset that clock (not admin notes or missed).

| Status | Meaning |
|---|---|
| **No plan** | No commitment yet this year. An explanation alone does not count. Shows days overdue once past its first-plan date. |
| **Overdue** | The due date has passed. The due date is the **earlier** of (last PIC entry + 30 days) and the next open commitment's date. (**Chosen**.) |
| **Update due** | The due date is within `due.soonDays` (14) days; also shown when nothing is open (the PIC owes a next commitment). |
| **Current** | An open commitment exists, the due date is further off than the soon window, nothing is past due. |

## 7. On time, kept, standing

- An entry is **on time** if made by its due date: the first by the first-plan date, each later one within 30 days of the one before. Done and date-revised entries count as entries.
- **Kept** = commitments done on or before their date; counted over commitments that are finished (done or missed). Open ones are not counted yet.
- **Standing** for a PIC: *Good standing* needs on time ≥ `standing.goodOnTime` (85) **and** kept ≥ `standing.goodKept` (80). *Escalated* is below `standing.escalatedOnTime` (60) **or** below `standing.escalatedKept` (50). Anything between is *Needs attention*. A measure with fewer than `standing.minSample` (3) items behind it is left out (**chosen**: otherwise one missed commitment makes someone Escalated); with neither measure there is no standing. Cutoffs must be consistent (escalated not above good), checked on save.

## 8. Check-in drafts

The system **never emails a PIC.** It prepares drafts in an Admin-only queue. The Admin edits one if they like, opens it in their own mailbox (a `mailto:` link), sends it there, and presses Mark as sent. The only automatic email goes to the Admin: a count and a link, weekdays, only if something is waiting, once a day, with no PIC or project names.

Situations: **overdue** (has a plan, something is past due) and **no plan** (no commitment and past the first-plan date). Days are counted from the project's due date:

| Step | Day | What happens |
|---|---|---|
| Overdue flag | 0 | The project shows Overdue everywhere (automatic, not a draft). |
| Reminder 1 | `ladder.reminder1Days` (3) | A draft naming the project. |
| Reminder 2 | `ladder.reminder2Days` (10) | A second draft naming it, only if reminder 1 was **sent**. |
| Escalate | `ladder.escalateDays` (21) | No draft; listed as a conversation for the Admin to have in person. |

- **One draft per PIC**, however many projects (and whatever mix of overdue check-ins and missing plans) need an update: the subject is always "Project Turnaround Updates" and the text is only the project names, "A, B and C". The Admin adds the greeting and the ask in Outlook, so the draft carries no wording of its own. A follow-up draft (reminder 2) uses the same form; if it covers only some of a PIC's projects it is merged into that PIC's one new draft.
- A PIC who wrote an entry in the last `drafts.skipIfEntryDays` (2) days, or was sent a reminder in the last `drafts.skipIfSentDays` (5), is skipped that day (0 turns a rule off).
- A **dismissed** draft never returns for that project in that situation with that due date; a new due date is a new situation. A **waiting** draft whose projects the PIC has dealt with is **withdrawn** automatically. Sent and dismissed drafts can be undone.
- "Create check-in drafts" (`run.createCheckinDrafts`) off stops new drafts; stale ones are still withdrawn.
- A project needs an update when a due date has passed: its first plan, or its check-in (the open commitment's due date, set by the schedule above). The Admin adds nothing to the system for that; the daily job reads the dates.
- **Not built:** "Repeat next monthly run" (needs the monthly summary email).

## 9. The page

One page for everyone (the server removes what a viewer may not see). The Admin can open any run, draft included, on the same page before publishing.

- **KPI strip:** total negative YTD profit and % of billed (with project count); plans current X of N; waiting on an update (past due + no plan, with the count of check-in drafts ready for the Admin); and since last month (projects off, new, improved, worse against the previous published run).
- **Charts:** total negative YTD profit at each month end for 12 months (last year's months in grey) and the count of projects below break-even. Under "Just mine" both charts show that PIC's own projects (stored per run), not the firm's.
- **A card per PIC**, ordered by the PIC's total YTD profit, biggest loss first: projects, total YTD profit and %, plans current (bar), on time %, kept x of y, standing (per visibility); a table of projects with profit YTD, plan chip, latest narrative update, next commitment (open / past due N days / date moved) and "N earlier commitments missed".
- **PIC viewers** get a Just mine / Everyone toggle (default Just mine); "Just mine" shows their own four numbers and their own two charts.
- **The Admin** gets Everyone, or a drop-down of the PICs; picking one shows that PIC's numbers and charts the way "Just mine" shows a PIC's own.
- **Every active PIC is on the page.** A PIC with no project below break-even has a card that says they have none and are doing a great job; on "Just mine" they see a congratulation instead of numbers. Cards are ordered by total loss, so these come last.
- **Plan page** (one project): add to the log (PIC: the explanation first, then updates and commitments) or an admin note (Admin); the log newest first; commitments with Mark done and Change date; the year-to-date profit by month; project facts; a legend. Past cycles are read-only.
- **Check-in drafts** page (Admin) and a sidebar count badge.

## 9a. Commitment patterns (Admin only)

A background analysis of what PICs commit to and what comes of it, in Admin > Commitment patterns, with a year picker. **Nothing extra is recorded**: it is worked out from the append-only plan log and the runs, so it cannot drift and old years stay available (pure rule, `modules/turnaround/logic/patterns.js`, pinned by `fixtures/patterns.json`). It shows:

- **Cutting cost or adding revenue?** Bring in money against Spend less: made, open, kept, done late, missed, kept rate (kept / finished), delivered against promised (dollars only, since hours and weeks cannot be added to dollars), typical days promised ahead, and how often the date moved. A plain sentence says which is kept more often, and warns when fewer than 10 finished commitments stand behind either side.
- **By action** (all ten), **by PIC** (how often they commit, follow through, move dates, and their mix of money and spend-less), and **over the year** by month.
- **How quickly projects are answered:** projects with an explanation and with a commitment, days from first appearing to the explanation, days from the explanation to the first commitment, and updates per project.
- **Projects that came off the list:** what share of projects that left the list (against those still on it) had a kept commitment, by kind. It shows what went with a project leaving, not what caused it.
- **What PICs typed under Other:** the words, so a recurring one can be given its own place on the list.

Definitions: a commitment is *finished* when it is done or missed; *kept* is done on or before its (current) date. A rate is blank until something has finished.

## 10. Daily job

Once a day (`npm run daily`): record Missed commitments; prepare and withdraw check-in drafts; email the Admin the count (weekdays, if any are waiting, once). Safe to run twice in a day. The monthly job (`npm run run-month`) builds the draft and emails the count.

## 11. Settings (all effective-dated; saving adds a row, never overwrites)

| Key | Default |
|---|---|
| `run.day` | "first-business-day" (informational: the real schedule is Kent's scheduler) |
| `run.time` | "06:00" (informational) |
| `run.emailAdmin` | true |
| `run.showOnHome` | true |
| `run.createCheckinDrafts` | true |
| `include.status` | "active" (informational: only active projects are ever pulled) |
| `include.ytdProfitBelow` | 0 (dollars) |
| `include.ignoreBilledUnder` | 0 (dollars, YTD billed) |
| `include.noPic` | "leave-out-warn" (or "unassigned") |
| `due.newProjectDays` | 14 |
| `due.afterEntryDays` | 30 |
| `due.graceUntil` | "02-01" |
| `due.soonDays` | 14 |
| `due.missedAfterDays` | 14 |
| `ladder.reminder1Days` / `ladder.reminder2Days` / `ladder.escalateDays` | 3 / 10 / 21 |
| `drafts.emailAdmin` | true |
| `drafts.skipIfEntryDays` / `drafts.skipIfSentDays` | 2 / 5 |
| `standing.goodOnTime` / `standing.goodKept` | 85 / 80 |
| `standing.escalatedOnTime` / `standing.escalatedKept` | 60 / 50 |
| `standing.minSample` | 3 |
| `visibility.picRecords` | "everyone" |
| `access` | `{ marketingTurnaround: false, picBd: false, picPipeline: false }` |

A change applies to the next run. A run records the settings it was built with, so it can be reproduced. A test fails if any setting (other than the three marked informational) is not read by the code.

## 12. Data

See `docs/DATA-MODEL.md`. In short: `plan_entries` (append-only), `runs` with `run_projects`, `run_warnings`, `run_history`, `run_project_history` (all locked with the run), `checkin_drafts`, `settings`, `audit_log` (append-only). Commitments are not a table: their state is replayed from `plan_entries`.

## 13. Not built, and why

- Export Excel (the mockup has the button).
- Contract fee and "billed to date %" on the plan page: the validated SQL does not pull fees.
- Market sector on the plan page: no source.
- The ladder's "Repeat" step and the monthly summary.
- Per-PIC email notification of a new run: deliberately absent; the only automatic email goes to the Admin.
- History before go-live (open question 6): the first run's "since last month" is blank.

## 14. Open questions

See `docs/OPEN-QUESTIONS.md`, items marked Turnaround.
