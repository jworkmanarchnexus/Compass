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
| MWIP backlog | pursuits not yet contracted, through December 31, **weighted** by the MWIP factor in force at the cutoff (each pursuit is weighted and rounded to the cent, then added). |
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

The contracted forecast is entered gross by the PMs. For this report only, each project's month is scaled by **(full contract amount − consultant fees) ÷ full contract amount** (a $100k contract with $30k of consultants shows 0.7 of the month). **"Full contract amount" is the Admin setting `bd.contractAmount`**, decided 2026-10-17: `feeConsult` (the default: fee + consultant fees) or `feeConsultReimb` (also the reimbursable allowance). Each report records the rule it was built with (`bd_run_meta.contract_amount_rule`). A project with no contract fee, or with consultant fees above the contract amount, keeps its full forecast and gets a note on the draft. The source supplies, per project, the gross amount and the fee, consultant fee and reimbursable allowance from the project record (`docs/FORECAST-METHOD.md`); a source that still supplies only an already-architectural amount keeps working unchanged. The calculation is `modules/bd/logic/architectural.js`, with fixtures in `modules/bd/tests/fixtures/architectural.json`.

## 4. The MWIP factor

Effective-dated and **append-only** (the database refuses to change or delete a past factor); the factor used is the latest one in force on the cutoff, and each report records it. The mockup's 0.67 (from Jan 1, 2026) and 0.65 (2025) are the seed. **Open question H4 is resolved this way:** the source supplies pursuits at face value (raw), and Compass applies the factor when it builds a report, so a changed factor never needs the source to change. If Vantagepoint already weights the column, the factor should be set to 1.

## 5. Goals

Annual, per PIC (keyed by Vantagepoint employee code) and per sector, in whole dollars, edited in Admin > BD reports. Changing a goal affects the **next** report built; published reports keep what they used. The Admin page warns when PIC goals and sector goals do not add up to the same total.

## 6. Lifecycle

Same as Project Turnaround: a scheduled job builds a **draft** on the first business day (with the Turnaround run, from the same pull) and emails the Admin a count and link; the Admin reviews it, resolves sectors, and **publishes** (locked, enforced by the database). To change a published report: **archive and rerun** (a reason **and** the word `RERUN`); the old version stays on file, marked archived; everyone else keeps seeing the last published report until the new version is published. A draft may be rebuilt freely. Versions are numbered per month ("September 2026, version 2").

## 7. What the source must provide (`loadBd(period)`)

Projects (project number, name, principal code, market sector), monthly revenue net of consultants through the cutoff, contracted forecast through Dec 31, and pursuits, probability-weighted and spread by days as Vantagepoint's MWIP report does it (id, PIC, sector, amount, before the factor) as of the report month; Compass applies the single architectural factor (decided 2026-10-16, see `docs/MWIP-METHOD.md`). See `server/vp-local.js` and `docs/DATA-MODEL.md`. **Where these live in Vantagepoint, or in another system, is still handoff open question 3.** The local files (`server/db/seed/bd_*.csv`) are generated by `tools/make-seed-bd.js` and reproduce the mockup's September 2026 report exactly.

## 8. Not built

- A report history chart, and the BD report on Home beyond "recently published" and "needs review".
- Per-sector PIC drill-down.
- Excel export (PDF only).
- Pipeline watch (a separate module: weekly MWIP and forecast snapshots, alerts).

## Export PDF window

Opens from the report page. **Look:** Report (the Excel colors), Arch Nexus (brand palette), Quiet, Black and white. **Include:** table by PIC, table by market sector, and three charts (total firm, by PIC, by market sector). **Pages:** layout (automatic / tables then charts / everything on one page), paper (Letter, Tabloid, A4, A3), orientation. **Heading and footer:** the Arch Nexus logo top right (first page, every page or off), print date, a description under the title. The footer always says Draft for an unpublished report and carries page numbers. Choices are remembered on the device (the description is not). The rule for which sections go on which page is `modules/bd/logic/export-plan.js`, tested from `modules/bd/tests/fixtures/export-plan.json`. Not tested: printing the file on paper, and other PDF viewers than the browser's.

## Drill-downs (click a bar)

Every dark green (YTD), light green (forecast) and gray (MWIP) segment of the two charts, for the firm, each PIC and each market sector, can be pointed at and clicked. Pointing lights that segment and mutes the rest (the dim also reaches the keyboard: Tab to a segment, Enter to open it). Clicking opens a panel under that chart; clicking the same segment again, or Close, shuts it. Switching between By PIC and By market sector closes it.

| Segment | The panel shows |
|---|---|
| YTD revenue | each project with a bar for the revenue billed to date, biggest first |
| Revenue forecast | the Vantagepoint-style forecast: a row per project, a column for each remaining month of the year, the amount in each, and totals |
| MWIP backlog | the same, a row per pursuit, with the factored amounts |

For a PIC or sector bar the panel is limited to that PIC's projects (or pursuits), or that sector's (a project coded Labs is shown under Healthcare while Labs rolls into it). The pieces always add up to the bar: they were frozen with the report (`bd_detail`), so a published report's detail never changes. The MWIP factor itself is not shown to PICs; the amounts are the weighted ones already in their totals. A report built before this existed has no detail and says so (archive and rerun it to get it).

How the months are made: each forecast project and each pursuit comes from the source with a monthly shape (`forecastMonths`, `mwipMonths`). That shape is only a set of weights: the amount the report counted (after the architectural share and the factor) is spread over the remaining months in those proportions, with the odd cents placed so every row adds to exactly what the report used (`logic/drill.js`, fixture `drill.json`).

## How the charts show the goal (Dave's layout)

Rules in `modules/bd/logic/goal-chart.js` (fixture `goal-chart.json`), used by the page and the PDF so both draw the same thing.

- **By PIC, when every PIC has the same goal** (the real case): one **Goal** bar at the top (dark blue = where each PIC should be by this month, light blue = the rest of the year's goal), then a bar per PIC, biggest total first. A **dashed line runs down the whole chart** at the pace and at the full goal, so any PIC's bar reads against them.
- **By PIC when the goals differ**, and **always By market sector**: each row is a pair, the actual bar with its own goal bar flush underneath (no gap inside a pair; space only between pairs).
- Every PIC or sector with a row is shown even with nothing yet; "Unassigned" only if it has something. The local demo's PIC goals differ (they are the mockup's), so the demo shows pairs; set them equal in Admin and build a draft to see the single goal bar.
- The total-firm chart (Total firm over Annual goal) is unchanged.
