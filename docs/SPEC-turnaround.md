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
| See a goal's approach and words, and whether it helped | yes | **yes, on every project** | yes | yes (with page access) | no |
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

## 5. The plan log: goals, check-ins, comments

Entries belong to the **project**, not to a run. The log is **append-only**: no edit, no delete, enforced by rules and by the database. A mistake is set right with a later comment. The plan cycle is the calendar year: each January starts clean; earlier years stay readable.

**Two rounds a month, tied to the run (Josh, 2026-11-26).** A round starts the day a month is first published (a rerun of the same month does not start a new round).

- **Goal check-in**, due `round.dueBusinessDays` (5) weekdays after publishing. In one step the PIC:
  1. (a project new to the list this year) says **what is driving the loss**: the explanation, once a year;
  2. (with a goal open) says **Did it help?** Yes, No, or Too early to tell, with a **required comment**. This closes the goal;
  3. sets the **next goal**: **Keep the same goal** (its approach and words are carried forward), or a new one: **one approach**, *Lower costs* or *Bring in additional revenue* (never both), and **a few words on how**, required. Picking an approach shows its ideas under **Potential Approaches** as guidance only; the idea is not picked or recorded. No numbers, no dates.
- **Mid-month update**, opens `round.midOpensDays` (14) days after publishing and is due `round.dueBusinessDays` weekdays after that: where the goal stands, **In progress, Done or Stuck**, with a **required comment**. No new goal; it does not close the goal. It is owed only when this round's goal was set before it opened (a goal set late is not asked about two days later).
- **A comment** can be added any time after the first goal check-in of the year.
- A goal's **due date** is the next month's goal check-in due date (unknown until that month is published). Reporting on it by then counts as **kept**; after it, **done late**. A goal nobody reports on is recorded **Missed** by the daily job `due.missedAfterDays` (14) days after that check-in was due; the PIC then sets a new goal without reporting on it. Done and missed are final.
- January waits for the grace period (`due.graceUntil`): no goal check-in is due before it.

Entry kinds: `explanation`, `commitment` (a goal: `lever` is `cost` or `revenue`, `keptFrom` when carried forward), `done` (the report on a goal: `helped`, and `improved` true/false/null), `update` (with `midStatus`, the mid-month update; without, a comment), all written by the PIC; `admin_note` (written by the Admin, labeled, public, never counts toward a PIC's record); `missed` (written only by the system). Older entries (`correction`, `date_revised`, goals naming one of the earlier ten actions with their own due date) stay readable. The server checks every step with the pure rules (`plan.goalCheckinProblem`, `plan.midProblem`) and answers in plain words; a refused step writes nothing.

## 6. Plan status (per project, as of today)

| Status | Words on the page | Meaning |
|---|---|---|
| `no_plan` | First goal due *date* / No goal yet, *N* days late | No goal yet this year. The first goal is due `round.dueBusinessDays` weekdays after the project first appeared on a published run (never before the grace period ends). |
| `update_due` | Goal check-in due *date* / Mid-month update due *date* | Something is owed this round and is not yet due. |
| `overdue` | Goal check-in *N* days late / Mid-month update *N* days late | Something owed this round is past its due date. |
| `current` | Done for this round | The goal check-in is done, and the mid-month update too once it has opened. |

`owes` says which round is owed (`goal` or `mid`). A round missed last month does not carry into this month's status; it shows in the record (section 7).

## 7. On time, kept, standing

- **On time**: for each round the project was on the list this year, the goal check-in counts once it is made or its due date has passed, and is on time when made by its due date; the same for the mid-month update when it was owed.
- **Kept** = goals reported on by their due date, counted over goals that are finished (done or missed). Open ones are not counted yet.
- **Standing** for a PIC: *Good standing* needs on time ≥ `standing.goodOnTime` (85) **and** kept ≥ `standing.goodKept` (80). *Escalated* is below `standing.escalatedOnTime` (60) **or** below `standing.escalatedKept` (50). Anything between is *Needs attention*. A measure with fewer than `standing.minSample` (3) items behind it is left out; with neither measure there is no standing. Cutoffs must be consistent (escalated not above good), checked on save.


## 8. Check-in drafts

The system **never emails a PIC.** It prepares drafts in an Admin-only queue. The Admin edits one if they like, opens it in their own mailbox (a `mailto:` link), sends it there, and presses Mark as sent. The only automatic email goes to the Admin: a count and a link, weekdays, only if something is waiting, once a day, with no PIC or project names.

Situations: **overdue** (a goal check-in or mid-month update is past due) and **no plan** (no goal yet and past its first-goal date). Days are counted from the project's due date:

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
- A project needs a reminder when something owed this round is past due: its first goal, the goal check-in, or the mid-month update (section 5). The Admin adds nothing to the system for that; the daily job reads the dates. A new round is a new due date, so a new situation.
- **Not built:** "Repeat next monthly run" (needs the monthly summary email).

## 9. The page

One page for everyone (the server removes what a viewer may not see). The Admin can open any run, draft included, on the same page before publishing.

- **Top row:** the four numbers as a 2x2 block beside the chart (stacked under 1100px wide).
- **The four numbers:** total negative YTD profit and % of billed (with project count); done for this round X of N; waiting on a check-in (late, due soon and no goal yet, with the count of check-in drafts ready for the Admin); and since last month (projects off, new, improved, worse against the previous published run).
- **Chart:** total negative YTD profit at each month end for 12 months (last year's months in grey). Under "Just mine" it shows that PIC's own projects (stored per run), not the firm's. The chart of the count of projects below break-even was removed (Josh, 2026-11-25); each bar's tooltip still gives that month's count, and the run history still stores it.
- **A card per PIC**, ordered by the PIC's total YTD profit, biggest loss first. The header starts with a show/hide button (the whole header row also toggles), then the PIC's name, total YTD profit and % of billed (the billed amount is in the tooltip), done for this round (bar), on time %, kept x of y, standing (per visibility). No initials circle, no project count. The table of projects: project (name, number and PM, and the status chip under them), profit YTD, latest comment, current goal (approach, the latest mid-month word, the words) and "N earlier goals not reported on". (Header and plan column changed by Josh, 2026-11-25.)
- **PIC viewers** get a Just mine / Everyone toggle (default Just mine); "Just mine" shows their own four numbers and their own chart.
- **The Admin** gets Everyone, or a drop-down of the PICs; picking one shows that PIC's numbers and charts the way "Just mine" shows a PIC's own.
- **Every active PIC is on the page.** A PIC with no project below break-even has a card that says they have none and are doing a great job; on "Just mine" they see a congratulation instead of numbers. Cards are ordered by total loss, so these come last.
- **Start my check-in** (PICs with projects on the list): a button in the header tile that opens the first of their projects still owed this round.
- **Project page** (one project at a time; the check-in and the plan merged, Josh 2026-11-26): the header tile has the project's name, number, PIC, PM and first appearance, its status chip, and for its PIC their projects on the list to step through (1 of 4 ..., Done / To do / Late). Left: the goal check-in or the mid-month update when one is owed ("Save and next" goes to the next project still owed; "Previous" goes back), otherwise "Done for this round"; the Admin's note form; the **History**: every goal check-in (shown as one item: the explanation, Did it help and the comment, the next or kept goal), mid-month update, comment, admin note and Missed, newest first, with "Add a comment" for the PIC. Right: the project's numbers (profit YTD, since last month, billed YTD, profit %), **Goals so far** (each goal once, kept rounds folded in, with every Did it help), the YTD profit chart, and a legend. Past cycles are read-only.
- **Check-in drafts** page (Admin) and a sidebar count badge.

## 9a. Commitment patterns (Admin only)

A background analysis of the goals PICs set and what comes of them, in Admin > Commitment patterns, with a year picker. **Nothing extra is recorded**: it is worked out from the append-only plan log and the runs, so it cannot drift and old years stay available (pure rule, `modules/turnaround/logic/patterns.js`, pinned by `fixtures/patterns.json`). It shows:

- **Lowering costs or adding revenue?** Bring in additional revenue against Lower costs: set, open, on time, late, missed, on-time rate (on time / finished), and Helped (the PIC's Yes against No; Too early to tell is not counted). A plain sentence compares the two and warns when fewer than 10 finished goals stand behind either side.
- **Older goals, by action** (only when a goal from before November 2026 named one of the earlier actions), **by PIC** (how many goals, how often reported on time, the share that bring in revenue), and **over the year** by month.
- **How quickly projects are answered:** projects with an explanation and with a goal, days from first appearing to the explanation, days from the explanation to the first goal, and comments and mid-month updates per project.
- **Projects that came off the list:** what share of projects that left the list (against those still on it) had a goal reported on time, by approach. It shows what went with a project leaving, not what caused it.
- **What PICs typed under Other** (older goals only).

Definitions: a goal is *finished* when it is reported on or missed; *on time* (kept) is reported on by its due date. A rate is blank until something has finished.

## 10. Daily job

Once a day (`npm run daily`): record goals not reported on as Missed; prepare and withdraw check-in drafts; email the Admin the count (weekdays, if any are waiting, once). Safe to run twice in a day. The monthly job (`npm run run-month`) builds the draft and emails the count.

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
| `round.dueBusinessDays` | 5 (weekdays each round has, from the day it opens) |
| `round.midOpensDays` | 14 (days after publishing that the mid-month update opens) |
| `due.graceUntil` | "02-01" |
| `due.missedAfterDays` | 14 (after the goal check-in a goal was due at) |
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

## 12a. Export (Josh, 2026-11-25 and 26)

An **Export** button at the right of the title row, with two choices. Both export what is on screen: everyone, or the one PIC picked (a PIC on "Just mine" exports their own). Nothing is fetched that the person cannot already see.

- **Excel:** one row per project (PIC, project number, project, PM, profit YTD, % of billed, plan, plan due, latest comment date and text, goal approach, goal, goal set, mid-month status, earlier goals not reported on). A real .xlsx: dollars and percentages are numbers.
- **PDF:** an Export PDF window like the Marketing Report's: settings on the left (whose projects, include the four figures / the chart / the projects, paper Letter, Legal or Tabloid, landscape by default, logo first page / every page / none, print date, an optional description), the real pages on the right, Download PDF at the bottom. Settings are remembered per person. Page 1: the heading, the four figures beside the chart. Then each PIC: their header (loss, %, plans current, on time, kept, standing where visible) and their projects; updates and commitments print in full. Page breaks (logic/export-plan.js, tested): a project never splits across pages; a PIC's header never sits alone at the bottom of a page; a page that continues a PIC opens with "Name (continued)" and the column headings. Vector PDF with Lato and Roboto Condensed embedded.

## 13. Not built, and why

- Contract fee and "billed to date %" on the plan page: the validated SQL does not pull fees.
- Market sector on the plan page: no source.
- The ladder's "Repeat" step and the monthly summary.
- Per-PIC email notification of a new run: deliberately absent; the only automatic email goes to the Admin.
- History before go-live (open question 6): the first run's "since last month" is blank.

## 14. Open questions

See `docs/OPEN-QUESTIONS.md`, items marked Turnaround.
