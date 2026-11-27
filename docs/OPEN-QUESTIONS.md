# Open questions

Everything still undecided, in one place. "Default" is what the prototype does today; most defaults are settings, so a different answer does not need a rebuild. **H** = from the handoff (`reference/handoff/docs/04-open-questions.md`, same numbers); **T** = raised while building.

Who decides: **Josh** (how it should behave), **Kent** (hosting and the firm's systems).

## For Kent

| # | Question | Default today | Notes |
|---|---|---|---|
| H1 | Language, database (PostgreSQL or SQL Server), hosting, where the jobs run, sign-in provider | Node + SQLite, one process, 127.0.0.1 only | `docs/FOR-KENT.md` lists exactly what to replace and what to keep |
| H7 | Which sign-in attribute is the user key, and does Vantagepoint carry it? Who maps a PIC's Vantagepoint employee code to a person? | the mapping is `users.employee_code`, set from a seed file | **Gap:** the People page cannot edit the code yet; Home flags a PIC with no login |
| H9 | How does the one daily email send (SMTP relay, Graph, company mail)? Does a `mailto:` open Outlook on the firm's setup, or does it need an Outlook web link? | writes a text file to `outbox/`; `mailto:` links | one method to implement: `sendToAdmin` |
| H3 | Where do BD revenue (net of consultants), contracted forecast, pursuits and each project's market sector live (Vantagepoint, a CRM, a spreadsheet)? | made-up local files in the shape of `loadBd` | the BD report is built on them; Pipeline watch still needs weekly snapshots of the same |
| T1 | Project number format (the mockup uses `2024-0207`) and the Vantagepoint project key | the mockup's | affects nothing in the logic; it is text |
| T2 | Time zone for "today" and entry dates | the server's local time | all rules work on plain dates |
| T3 | Public holidays for "first business day" | first weekday | one function (`schedule.js`) |
| T4 | Can the pull serve the past 12 month-ends (the SQL once per month)? | the local files hold history | each run stores its own chart history |
| H11 | Data retention for plan logs and archived runs | forever | |
| A1 | Principal Accountability: where do utilization (per PIC, YTD), receivables over 90 days (per project), the income statement profit, the ESOP / bonus contribution and the actual and assigned overhead rates live? | made-up local files in the shape of `loadAccountability` | `docs/SPEC-accountability.md` section 6. Also: the profit pull returns active projects only, so a job closed during the year drops out of YTD billed and profit; the workbook says "all jobs this year" |

## For Josh

| # | Question | Default today | Where it lives |
|---|---|---|---|
| H2 | Does the Marketing director see Project Turnaround? | no (BD and Pipeline only) | Admin > People > "What narrower roles can see" |
| T5 | May PICs see the BD report and Pipeline watch? Does Finance see Turnaround? | PICs: no. Finance: yes | same card (`access`) |
| A2 | Principal Accountability: is Backlog gross (as entered) or net of consultants? Is ETC MWIP the weighted figure (with the 0.65 factor) or Vantagepoint's probability-weighted fee before it? | gross backlog (reads against gross billings); weighted MWIP (the Marketing Report's own figure) | `server/accountability.js` |
| A3 | Who sees Principal Accountability? | **Resolved by Josh, 2026-11-26: all Principals.** Built as the switch `access.picAccountability` (with the Marketing Report's `picBd`), turned on in Admin > People; the Marketing director still does not see it | `shared/rules/roles.js` |
| A4 | Negative profit response: should "Update due" (not late yet) count as Yes? | no: only Current counts, as decided 2026-11-26. In the demo every PIC has at least one project that is not Current, so all read No | `modules/accountability/logic/accountability.js` |
| A5 | The workbook's "Excess/(Shortfall)" column shows an excess in brackets (Dave Abraham, past his goal, shows (553,885)). Rename it, or flip the sign? | renamed "Shortfall / (excess)", same numbers as the workbook | `columns()` in the logic |
| A6 | "Projects to reach goal": the workbook's row under the totals reads "$150K 2026, $250K 2026, $350K 2026, $500K 2026", which differs from the column headings ($150K, $250K, $500K, $1.5M). Which fees, and is it the 2026 share of a fee? | the column headings' fees, whole fee | Admin > Accountability > Projects to reach goal |
| H4 | Is the MWIP backlog column stored raw and weighted at calculation time, or already weighted? | **Resolved by Josh, 2026-10-16: the source supplies Vantagepoint's probability-weighted fee, spread by days (`docs/MWIP-METHOD.md`), and Compass applies ONE factor (the architectural share, consultants removed) from the existing Admin setting, to both the PIC and sector views. The value is 0.65 (Josh, 2026-11-25).** The calculation is unchanged (amount x factor); only the meaning of the source amount changes from face value to probability-weighted | `docs/SPEC-bd.md` section 4 |
| M3 | What is the "full contract amount" in the architectural ratio for the contracted forecast? | **Built as the Admin setting `bd.contractAmount`, default fee + consultant fees (no reimbursable allowance); Josh unsure, the back-test against the VP Consultants % was inconclusive (2026-10-17)** | `docs/FORECAST-METHOD.md` |
| M1 | The BD workbook sums six months of MWIP; Compass's spec sums through Dec 31. Which? | **Resolved by Josh, 2026-10-16: through Dec 31, as Compass is built** | `docs/MWIP-METHOD.md` |
| M2 | Month-end lock for MWIP and the forecast? | **Resolved by Josh, 2026-10-16: no. Take the latest data on the day the report is published; the published run keeps it** | `docs/DECISIONS.md` |
| H5 | Where do utilization and net profit come from? | tiles not shown | Home's Firm snapshot |
| H6 | Are earlier months' runs imported from the Excel workbook, or does history start at go-live? | the first run's "since last month" is blank | |
| H8 | Fallback for projects with several overhead rates? | reported as a warning, no profit invented | `profit.js` |
| H10 | Final product name and a vector logo | "Compass"; small raster logo | |
| H12 | Anything from the earlier ChatGPT engine? | nothing adopted | `reference/handoff/reference/chatgpt-engine-v0.1/` |
| T6 | Recorded as Missed after how many days past a commitment's date? | 14 | Admin > Project Turnaround > Plan due dates. The mockup's examples disagree (2 days, and 11 days still "past due") |
| T7 | What makes a plan's next update due? | the earlier of last entry + 30 days and the next commitment date | `plan.js`; the mockup's rows disagree |
| T8 | A PIC with one missed commitment: Escalated? | no: a measure needs 3 items first | Admin > Reminders and standing |
| T9 | Drafts: one per PIC per situation (listing their projects), or one per project? | **one per PIC, full stop** (Josh, 2026-10-12): subject "Project Turnaround Updates", text = project names | `drafts.js` |
| T10 | No-plan reminders: the mockup shows them 6 days after a project is listed; the ladder (counted from the 14-day due date) gives about 17 | the ladder | Admin: "days to a first plan", ladder days |
| T11 | May the Admin rebuild a draft run without typing RERUN? | yes (nobody else has seen a draft) | `runs.js` |
| T12 | "Ignore projects billed under $X": YTD billed? | yes | `selection.js` |
| T13 | A PIC's Home shows their own projects needing action (not in the spec) | yes | `home.js` |
| T14 | ~~May PICs see a commitment's action and amount?~~ | **Decided (Josh, 2026-10-11): yes, every PIC and everyone who reads the plan** | `server/turnaround.js` |
| T15 | The ladder's last step, "Repeat next monthly run", and the monthly summary email | not built | |
| T16 | Should the Admin be able to see plan content for a project that is not on any run? | yes (any project by link) | |
| T18 | A project that was explained last year and lands on the list again: a new explanation each calendar year? | yes (the plan cycle is the year) | `plan.js` / `server/plan.js` |
| T19 | (closed 2026-10-12: commitments no longer carry an amount, so there is no unit to convert.) | n/a | |
| T20 | Which measures matter most in Commitment patterns? Today: kept rate, delivered against promised, lead time, dates moved, responsiveness, projects that left the list | see SPEC section 9a | `patterns.js` |
| T21 | BD report: should "Other" be the home for revenue with no market sector, or should the Admin always be asked? | ask (publishing is refused until each project has a sector) | Admin > BD reports > rules |
| T22 | BD report: do PICs see it? Do Finance and Marketing see the MWIP factor? | PICs no (setting); Finance and Marketing yes, PICs never see the factor | `access.picBd`; `server/bd.js` |
| T23 | BD report: status thresholds 100% (On Track) and 99% of pace (On Pace) are the spec's; confirm | as spec | Admin > BD reports > rules |
| P1 | Where do pursuits (MWIP) and the contracted forecast live, and is a pursuit's id the project number it keeps when promoted? The "matched, not a loss" test depends on that. | made-up files in the shape of `loadPipeline`; id = project number | `docs/SPEC-pipeline.md` section 2 |
| P2 | Normal billing lowers the contracted forecast, so "Forecast drops fast" will fire on a busy week. Alert on the whole drop, or only on the part moved into next year? | the whole drop, threshold $150,000 in 7 days | Admin > Pipeline alerts |
| P3 | "MWIP slides week after week": the mockup's own table slides every week for every PIC, so a short run would alert on everyone. How many in a row? | 8 | Admin > Pipeline alerts |
| P4 | The spec offers a PIC copy of the Monday alert email. The handoff rule is that the system never emails a PIC. | no PIC email, no switch | |
| P5 | Export Excel on Pipeline watch: CSV (opens in Excel) or a real .xlsx? | CSV | |
| P6 | Should the Admin be able to re-run the rules on an old snapshot after changing a threshold? | no; past alerts stay as they were | |
| T24 | Export PDF is a generated vector PDF (Scheduler-style export window). Anything else wanted: Excel, emailing it, a fixed monthly PDF saved on the server? | PDF download only | Export PDF window |
| T17 | Export Excel on the Turnaround page; contract fee and billed-to-date on the plan page | not built (no fee data in the validated SQL) | |

## Billing (not built; see `docs/SPEC-billing.md`)

Decided 2026-10-30 (Josh): processors are Karen, Camille and Josh; PMs and PICs view and edit billing for their projects; PAs, Finance and Marketing have no access; release one covers fixed fee by phase and hourly; nothing is ever locked; the Admin enters each month's deadline and sets the reset-clock day in the Admin panel; PMs may bill at any time, including mid-month; the variance rule stays as the prototype with the threshold as an Admin setting; no PM reminders on day one; processors choose their own email notifications (separate from Turnaround and Marketing emails); any processor can reassign; one open request per project.

| # | Question | Default in the spec | Who |
|---|---|---|---|
| B3 | Reset-clock default day, and how an additional mid-month billing is labeled for accounting | the 12th; "Additional" | Josh |
| B9 | Business hours, second digest time, weekly digest day; which alerts count as "routine" for quiet hours; who hears about an unassigned project | weekdays 8 to 5; 1:00 PM; Monday; every alert except "Financial data changed"; every processor | Josh |
| K-B1 | Which VP report verifies phase fee and billed-to-date? | none yet; made-up CSV | Kent |
| K-B2 | Does the reporting database lag VP? | unknown | Kent |
| K-B3 | How do amendments and multi-level WBS appear? | one line per billing phase | Kent |
| K-B4 | Where does accounting enter amounts in VP; are draft or posted invoices readable? | manual handoff; no reconciliation | Kent |
| K-B5 | A read-only database account for the pull | n/a locally | Kent |
