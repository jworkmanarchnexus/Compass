# Spec: Principal Accountability

The first tab of the firm's "2026 Project Improvement (Accountability)" workbook, as a page: one row per PIC, year to date, against each PIC's billed goal, with the firm's figures under it. It only shows the figures and exports them (PDF and Excel, from the Export menu in the header), as the Marketing Report does. Rules are in `modules/accountability/logic/accountability.js` (pure) and pinned by `modules/accountability/tests/fixtures/accountability.json`, whose cases use rows of the October 2026 workbook. The database, lifecycle and roles are tested in `server/tests/accountability.test.js`.

## 1. Who sees what

| | Admin | Finance | Marketing director | PIC | System admin |
|---|---|---|---|---|---|
| Read a published report | yes | yes | no | only if the Admin turns it on (`access.picAccountability`, default off) | no |
| See a draft or an archived version | yes | no | no | no | no |
| Edit goals and project sizes (Admin > Accountability) | yes | no | no | no | read only |

Every PIC's profit sits side by side, so it starts with the Admin and Finance; Admin > People > "What narrower roles can see" opens it to every PIC (Josh, 2026-11-26: all Principals see it). A PIC sees every PIC's row, published reports only.

## 2. Its own monthly report

Its own run (`runs.kind = 'acct'`), with the same lifecycle as Project Turnaround and the Marketing Report: the monthly job builds a **draft** (and emails the Admin a count and link), the Admin reviews it on the page (Rebuild draft, Publish for viewing), a published report is **locked** by the database, and changing one means **archive and rerun** (a reason and the word `RERUN`). Admin > Report runs can build one for any closed month. Its figures are its own and **gross**; nothing is read from a Marketing Report, which is net of consultants (Josh, 2026-11-27). Rows are frozen in `acct_rows` and `acct_meta`.

## 3. The columns (per PIC)

| Column | Meaning |
|---|---|
| YTD billed | everything billed on the PIC's projects, January through the report month, **gross** (as the workbook: the firm total there is $26.8M against $17.1M architectural revenue). From the Project Turnaround pull. |
| YTD profit | Billed − Labor × (1 + overhead%) − Expenses, the Project Turnaround math, added over the PIC's projects. A project with billings but no overhead rate cannot be evaluated: its billings count, its profit does not, and the page says how many. |
| YTD profit % | profit ÷ billed; "NA" when nothing was billed. |
| YTD negative profit (all jobs this year) | the YTD profit of the PIC's projects below zero, added up. |
| Negative profit response | **Yes** when every one of the PIC's projects on the latest published Project Turnaround run (for the report month or before) has a **Current** plan; **No** otherwise; a dash when none of their projects is on it (Josh, 2026-11-26). Read on the day the report is built; the day is shown. "Update due" counts as No (open question A4). |
| Utilization | from the source, year to date. |
| Goal | the PIC's billed goal for the year (Admin > Accountability), per PIC (Josh, 2026-11-26). |
| $ amount to goal | goal − YTD billed. In brackets: past the goal. |
| Backlog | the PMs' plan revenue still to bill through December 31, **gross as entered** (spread by working days less firm holidays, as Vantagepoint's forecast report does, when the source gives the plan entries themselves), read by Accountability's own pull. No architectural share. |
| Shortfall / (excess) | goal − billed − backlog. In brackets: the backlog more than covers the goal. (The workbook labels this "Excess/(Shortfall)" but its numbers have this sign; open question A5.) |
| ETC MWIP | pursuits not yet contracted: each one's **probability-weighted fee**, spread by days from the month after the report month through December 31, **with no 0.65 architectural factor** (Josh, 2026-11-27). The options are fixed for this report (Weighted Fee, spread evenly, daily) so a change to the Marketing Report's MWIP settings never moves it. |
| AR > 90 | receivables over 90 days on the PIC's projects, from the source. |
| Projects to reach goal | one column per project size (Admin setting `acct.projectSizes`, default $150K, $250K, $500K and $1.5M fees, named for the construction size): **how many projects of that fee would close the shortfall, rounded up; 0 when there is none** (Josh, 2026-11-26). |

Rows: the PICs with a goal for the year, in the Admin's order (a PIC with a goal and nothing billed still has a row), then any other PIC with something to show, by name, then Unassigned. Then **Totals**, and **Goal <cutoff>**: the goals added up × months elapsed ÷ 12. Money shows as the workbook does: whole dollars, losses in brackets, zero as "$-".

Percentages, to-goal, shortfall and project counts are worked out when shown, never stored.

## 4. The firm figures (under the table)

| Line | Source |
|---|---|
| Income statement profit (loss) | source, YTD |
| Difference from project profit | income statement profit − the PICs' YTD profit added up |
| YTD actual overhead rate, Assigned overhead rate | source |
| Architectural revenue | revenue net of consultants, January through the report month, read by Accountability's own pull (the sheet's "Arch Revenue" line, the one net figure on it; Josh kept it, 2026-11-27) |
| ESOP / bonus contribution | source, YTD |
| Profit on architectural revenue | (income statement profit + ESOP / bonus) ÷ architectural revenue (the workbook's 20% reproduces) |

A figure the source does not have is shown as "Not in the source yet", and what depends on it is blank.

## 5. Export

The **Export** button at the right of the page header (as on every page) has two choices.

- **PDF:** a window like the Marketing Report's, with the real page on the right. One page: the table, totals, the goal line and the firm figures, shrunk to fit. Choices: paper (Letter, Tabloid, A4, A3), orientation (default landscape), logo, print date; remembered on the device. Draft is marked in the footer.
- **Excel:** a real .xlsx (`toSheets`, tested): sheet "By PIC" with the PICs and Totals, each column as on the page with dollars as whole numbers and percentages as ratios (the group heading is put in front of the first column of each group); sheet "The firm" with the firm figures, amounts and rates in their own columns. `toCsv` is still in the rules (tested), but the page no longer offers a CSV.

The line beside the report picker shows only the billing cutoff; the picker names the month and version, and the banner says when it was published.

The PDF comes from the same `sheet()` the page uses, and the Excel from the same columns, so they say what the page says. Not tested: the PDF on paper, and the .xlsx opened in Excel itself (checked with openpyxl).

## 6. What the source must provide

Billed and profit come from the profit pull (`load`, the Project Turnaround query). Everything else comes from `loadAccountability(period)`: `{ projects: [{ wbs1, principal }], forecastEntries + holidays (or forecast: [{ wbs1, amount }]), pursuits (or mwip: [{ id, pic, amount }]), revenue: [{ wbs1, period, amount }], utilization: [{ pic, bp }], arOver90: [{ wbs1, amount }], firm: { incomeProfit, esopBonus, actualOhBp, assignedOhBp } }` (cents; basis points, 4400 = 44%). Any part may be missing; those columns are then blank. Where utilization, AR and the firm figures live is open question A1. Locally the gross inputs are read from the same made-up project files the Marketing Report's source reads (they stand for the raw Vantagepoint rows), plus `server/db/seed/acct_*.csv`.

## 7. Not built

- The workbook's "*Part of larger Projects+" footnote on some PICs.
- A history across months, charts, drill-downs.
