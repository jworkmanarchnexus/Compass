# Spec: BD report

Revenue against goal, by PIC and by market sector, month by month, with the status of each row. Rules are in `modules/bd/logic/report.js` (pure) and pinned by `modules/bd/tests/fixtures/report.json`; the database and role behavior are tested in `server/tests/bd.test.js`. The original intent is in `reference/handoff/docs/01-product-spec.md` ("BD report").

## 1. Who sees what

| | Admin | Finance | Marketing director | PIC | System admin |
|---|---|---|---|---|---|
| Read a published report | yes | yes | yes | only if the Admin turns it on (`access.picBd`, default off) | no |
| See a draft or an archived version | yes | no | no | no | no |
| Build, rebuild, publish, archive and rerun | yes | no | no | no | no |
| Edit goals, the MWIP factor, sectors, thresholds | yes | no | no | no | read only |
| See the MWIP factor and the unfactored (probability-weighted) MWIP amounts | yes | yes | yes | **no** ("not shown on PIC pages") | no |

## 2. The report

Each row (the firm, every PIC, every market sector) has:

| Column | Meaning |
|---|---|
| Revenue goal | the annual goal for that PIC or sector. The firm goal is the PIC goals added up. |
| YTD goal (pace) | goal × months elapsed ÷ 12, to the cent (month 9 of 12 is 9/12). |
| YTD revenue | architectural revenue, **net of consultants**, billed from January through the **billing cutoff** (the last day of the report month). |
| Revenue forecast | contracted revenue still to be billed through December 31. |
| MWIP backlog | pursuits not yet contracted, worked out the way Vantagepoint's MWIP report does it with the options in section 4b (by default: Weighted Fee, spread evenly, Daily, starting on the first day after the report month, through December 31), **weighted** by the MWIP factor in force at the cutoff (each pursuit is weighted and rounded to the cent, then added). |
| Total projected | YTD + forecast + weighted MWIP. |
| % of pace billed | YTD ÷ pace. |
| % of goal (YTD + forecast) | (YTD + forecast) ÷ goal. |
| % of goal (YTD + forecast + MWIP) | total projected ÷ goal. |
| Status | below. |

Percentages are worked out when shown, never stored. Amounts show in thousands. A row with no goal has no status.

**Status** (thresholds are Admin settings, recorded with each report):

- **On Track:** total projected is at least `bd.onTrackPct` (100) % of the goal.
- **On Pace:** otherwise, YTD is at least `bd.onPacePct` (99) % of pace ("but needs more planned revenue").
- **Behind Pace:** otherwise.

The page has a **By PIC** tab and a **By market sector** tab (same columns, firm row first), the report picker (published versions; the Admin also sees drafts and archived), an **Export PDF** button (the browser's "Save as PDF"; only the report prints), and two charts: the firm's revenue, forecast and MWIP against the annual goal (split into pace and remaining), and the PIC or sector bars largest total first, with a mark for pace to date and one for the annual goal.

The line under the title says what was done to the numbers, for everyone: "Labs counted in Healthcare", and "… unassigned revenue went to Civic ($3,420)".

## 3. Market sectors, and revenue with none

- Each project carries its sector from Vantagepoint. A sector can **roll into** another until a date: **Labs counts in Healthcare through 2026-12-31**; from 2027-01-01 it is its own sector (it must then be given a goal in Admin).
- A project whose sector is **missing or unknown** is "unassigned". **By default (`bd.noSector` = `keep`, decided by Josh 2026-10-16) it stays in its own "Unassigned" row, as Vantagepoint shows it; the totals still tie, the report notes it, and publishing is not held up.** With `bd.noSector` = `ask` the draft is the same but **publishing is refused** until the Admin picks a sector for it. The Admin picks one on the draft (a drop-down per project, then "Assign and rebuild"); the answer is remembered and applies to every later report. With `bd.noSector` = `other`, unassigned revenue goes to **Other** automatically and the report says so.
- A project with no PIC shows in an "Unassigned" PIC row and as a warning on the draft.

## 3b. The architectural share of the contracted forecast

The contracted forecast is entered gross by the PMs. For this report only, each project's month is scaled by **(1 − the consultant share)**. **Which share is the Admin setting `bd.contractAmount`** ("Consultant share taken out of the forecast" in Admin > Marketing Reports):
- **`vpActual`, the default (Josh, 2026-11-28): Vantagepoint's Consultants %**, as the firm's forecast report defines it: the project's direct costs to date (consultant and direct-expense accounts flagged as project cost) ÷ its earned revenue to date, through the report month. It follows what has actually been spent, so it moves every month. No revenue yet = 0%, so the full forecast counts.
- `feeConsult`: consultant fee ÷ (fee + consultant fee) from the project record (the contract split; the default from 2026-10-17 to 2026-11-28; a $100k contract with $30k of consultants shows 0.7 of the month). `feeConsultReimb`: the same with the reimbursable allowance added to the denominator.

Each report records the rule it was built with (`bd_run_meta.contract_amount_rule`). A project whose share cannot be used (no contract fee, consultants above the contract, or direct costs above earned revenue) keeps its full forecast and gets a note on the draft. The source supplies the PMs' plan revenue entries with their own dates, the firm holiday calendar, and per project the fee, consultant fee and reimbursable allowance from the project record and the direct costs and earned revenue to date (`directCostToDate`, `earnedToDate`). Compass spreads each entry across its dates by **working days** (Monday to Friday, less the holidays), as Vantagepoint's forecast report does, keeps the months after the report month through December, then applies the share above (`modules/bd/logic/forecast.js`, fixtures in `modules/bd/tests/fixtures/forecast.json`; reproduced to the dollar for 144 of 144 projects against a same-day export, `docs/FORECAST-METHOD.md`). A source that supplies the gross amount per project, or an already-architectural amount, keeps working unchanged. The calculation is `modules/bd/logic/architectural.js`, with fixtures in `modules/bd/tests/fixtures/architectural.json`.

## 4. The MWIP factor

**One factor, the same for the PIC view and the market sector view: 0.65** (Josh, 2026-11-25). The manual workbook used 0.67 for PICs and 0.65 for sectors; Compass uses 0.65 for both, so the firm total is the same on both tabs.

It is the Admin setting on Admin > BD reports (`bd_mwip_factor`). It takes effect from a date and is **append-only**: the database refuses to change or delete a past factor. Each report uses the latest factor in force on its cutoff and records which one it used. To change the factor, the Admin adds a new one with the date it takes effect. The local demo seed still holds the mockup's 0.67 from Jan 1, 2026, so it reproduces the mockup; the real value is 0.65.

**What the factor is applied to (open question H4, resolved 2026-10-16):** the source supplies each pursuit already weighted by probability and spread by days, as Vantagepoint's MWIP report does (`docs/MWIP-METHOD.md`). The factor is the architectural share (consultants removed), applied by Compass when it builds a report, so a changed factor never needs the source to change.

## 4b. How MWIP is worked out (Admin > Marketing Reports > MWIP calculation)

The same choices as the Options tab of Vantagepoint's MWIP report (VP-MWIP Marketing Master). They are ordinary Admin settings: only the Admin edits them (the System admin sees them read only), a change applies to the next report built, and each report records the choices it was built with (`runs.settings_json`). Rules: `modules/bd/logic/mwip.js`, fixture `modules/bd/tests/fixtures/mwip.json`.

| Setting | Choices (default first) | Vantagepoint option |
|---|---|---|
| `bd.mwipBasis` | Weighted Fee (fee x win probability); Estimated Fee | Calculate Pursuit Forecast Using |
| `bd.mwipAllocation` | spread evenly by days from estimated start to estimated completion; all to the estimated start month; all to the estimated completion month | Fee Allocation |
| `bd.mwipPeriod` | Daily; Semi-monthly; Monthly. The fee is split into equal pieces per day, half-month or month; pieces that ended before the start date drop out, the one the start date falls in counts in full | Calculation Period |
| `bd.mwipStart` | the first day after the report month (owner, 2026-11-25); the day the report is built ("Today") | Start Date |
| `bd.mwipThrough` | December 31 of the report year; 3, 6 or 12 months | Duration |

Shown but **not yet available** (they have not been checked against a Vantagepoint run, so they cannot be picked): Fee Allocation "close date" and "allocation method of the project" (the fields behind them are not found yet), and Calculation Period weekly and bi-weekly (within about a dollar of Daily, but not reproduced exactly). To add one: run Vantagepoint's MWIP report with that option, compare it to Compass the same day, then allow it.

Only pursuits in a not-yet-awarded stage with a non-zero estimated fee count (`docs/MWIP-METHOD.md` rule 1). A pursuit missing a date its allocation needs is left out and listed on the draft as a note, never guessed. The default options reproduce the October 2026 workbook where pursuits had not changed since (Burbank, McBride, K-12, Higher Education exact). Daily, Semi-monthly and Monthly each reproduce a same-day Vantagepoint export exactly (2026-11-25, 109 of 109 pursuits).

## 5. Goals

Annual, per PIC (keyed by Vantagepoint employee code) and per sector, in whole dollars, edited in Admin > BD reports. Changing a goal affects the **next** report built; published reports keep what they used. The Admin page warns when PIC goals and sector goals do not add up to the same total.

## 6. Lifecycle

Same as Project Turnaround: a scheduled job builds a **draft** on the first business day (with the Turnaround run, from the same pull) and emails the Admin a count and link; the Admin reviews it, resolves sectors, and **publishes** (locked, enforced by the database). To change a published report: **archive and rerun** (a reason **and** the word `RERUN`); the old version stays on file, marked archived; everyone else keeps seeing the last published report until the new version is published. A draft may be rebuilt freely. Versions are numbered per month ("September 2026, version 2").

## 7. What the source must provide (`loadBd(period)`)

Projects (project number, name, principal code, market sector, and for the forecast `fee`, `consultFee`, `reimbAllow`), monthly revenue net of consultants through the cutoff, the contracted forecast as the plan revenue entries themselves, `forecastEntries`: `[{ wbs1, start, end, amount }]` (cents; dates YYYY-MM-DD; `PNPlannedRevenueLabor.PeriodCost` with its `StartDate` and `EndDate`) with the firm holiday calendar `holidays`: `['YYYY-MM-DD', ...]` (`CFGHoliday`), from which Compass works out the forecast by month (section 3b; a source may instead supply `forecast` and `forecastMonths` already worked out, as the local made-up files do), and the pursuits themselves, as `pursuits`: `[{ id, name, pic, sector, stage, estFee, weightedFee, estStart, estCompletion }]` (cents; dates YYYY-MM-DD; read from the pursuit project records, `docs/MWIP-METHOD.md`). Compass works out the MWIP from them with the section 4b options and then applies the single architectural factor. A source may instead supply MWIP already worked out (`mwip` and `mwipMonths`, as the local made-up files do); then the section 4b options have no effect. See `server/vp-local.js` and `docs/DATA-MODEL.md`. **Where these live in Vantagepoint is answered** (2026-11-26): the five fixed statements in `server/vp/bd-statements.js`, each reconciled against a Vantagepoint export. A source may also pass `pulledAt` (ISO time); the report then notes when the data was pulled. **Live mode** (`docs/LIVE-MODE.md`) feeds the report from a Vantagepoint pull saved on this computer (`npm run vp:pull-bd`, `npm run live`); the demo keeps the made-up files. The local files (`server/db/seed/bd_*.csv`) are generated by `tools/make-seed-bd.js` and reproduce the mockup's September 2026 report exactly.

## 8. Not built

- A report history chart, and the BD report on Home beyond "recently published" and "needs review".
- Per-sector PIC drill-down.
- Excel export (PDF only).
- Pipeline watch (a separate module: weekly MWIP and forecast snapshots, alerts).

## Export PDF window

Opens from the report page. The report is **always two pages**, in this order, with nothing optional and no color choices (one look, the firm's Excel report):

- **Page 1, "Marketing Report: By Principal-in-Charge":** the PIC table, the total-firm chart, the PIC chart.
- **Page 2, "Marketing Report: By Market Sector":** the market sector table, the total-market chart, the market sector chart.

Each page's second line is "As of <billing cutoff> · Version N · Published" (the month appears once; it is not in the title). The title's type shrinks to fit beside the logo. The Arch Nexus logo is top right of **both** pages by default (it can be limited to page 1 or hidden).

What can still be chosen: **paper** (Letter, Tabloid, A4, A3, default Letter), **orientation** (default Portrait: Letter portrait fits each page at full size), the **logo**, the **print date** in the footer, and a **description** under the title. The footer always says Draft for an unpublished report and carries page numbers. Choices are remembered on the device (the description is not). A page too tall for the paper shrinks to fit rather than spilling onto a third page, and the window says "small print" when that makes the type hard to read. Rules: `modules/bd/logic/export-plan.js`, tested from `modules/bd/tests/fixtures/export-plan.json`. Not tested: printing on paper, and PDF viewers other than the browser's.

## Drill-downs (click a PIC, a sector or the firm)

Each group on the two charts (a PIC or market sector bar with its goal bar, or Total firm with the annual goal) is one target. Pointing at it fades in a soft gray band behind the whole group; nothing else on the chart changes. Keyboard: Tab to a group, Enter to open it. Clicking turns that chart, in place, into the projects behind the group (a smooth resize and cross-fade, the browser's view transition; none when the computer asks for reduced motion). A Back button at the top left returns to the chart. Switching between By PIC and By market sector also returns.

The drilled-in view shows:

- a line: how many projects and pursuits, and the total split into billed, forecast and MWIP;
- a bar per project, biggest first: dark green the revenue billed to date, light green the contracted forecast;
- then a gray bar per pursuit: the MWIP backlog, factored;
- folded away under the chart: **Revenue forecast by month** and **MWIP backlog by month**, the Vantagepoint-style grid (a row per project or pursuit, a column for each remaining month, totals).

For a PIC or sector the view is limited to that PIC's projects (or pursuits), or that sector's (a project coded Labs is shown under Healthcare while Labs rolls into it). The pieces always add up to the bar: they were frozen with the report (`bd_detail`), so a published report's detail never changes. The MWIP factor itself is not shown to PICs; the amounts are the weighted ones already in their totals. A report built before this existed has no detail and says so (archive and rerun it to get it).

How the months are made: each forecast project and each pursuit comes from the source with a monthly shape (`forecastMonths`, `mwipMonths`). That shape is only a set of weights: the amount the report counted (after the architectural share and the factor) is spread over the remaining months in those proportions, with the odd cents placed so every row adds to exactly what the report used (`logic/drill.js`, fixture `drill.json`).

## How the charts show the goal (Dave's layout)

Rules in `modules/bd/logic/goal-chart.js` (fixture `goal-chart.json`), used by the page and the PDF so both draw the same thing.

- **By PIC, when every PIC has the same goal** (the real case): one **Goal** bar at the top (dark blue = where each PIC should be by this month, light blue = the rest of the year's goal), then a bar per PIC, biggest total first. A **dashed line runs down the whole chart** at the pace and at the full goal, so any PIC's bar reads against them.
- **By PIC when the goals differ**, and **always By market sector**: each row is a pair, the actual bar with its own goal bar flush underneath (no gap inside a pair; space only between pairs).
- Every PIC or sector with a row is shown even with nothing yet; "Unassigned" only if it has something. The local demo's PIC goals differ (they are the mockup's), so the demo shows pairs; set them equal in Admin and build a draft to see the single goal bar.
- The total-firm chart (Total firm over Annual goal) is unchanged.
