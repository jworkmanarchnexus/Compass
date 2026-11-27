# Spec: Principal Accountability

The first tab of the firm's "2026 Project Improvement (Accountability)" workbook, as a page: one row per PIC, year to date, against each PIC's billed goal, with the firm's figures under it. It only shows the figures and exports them (PDF, and a CSV for Excel), as the Marketing Report does. Rules are in `modules/accountability/logic/accountability.js` (pure) and pinned by `modules/accountability/tests/fixtures/accountability.json`, whose cases use rows of the October 2026 workbook. The database, lifecycle and roles are tested in `server/tests/accountability.test.js`.

## 1. Who sees what

| | Admin | Finance | Marketing director | PIC | System admin |
|---|---|---|---|---|---|
| Read a published report | yes | yes | no | no | no |
| See a draft or an archived version | yes | no | no | no | no |
| Edit goals and project sizes (Admin > Accountability) | yes | no | no | no | read only |

Every PIC's profit sits side by side, so it starts with the Admin and Finance only (open question A3).

## 2. Built with the Marketing Report

It is built from the same monthly pull, **at the same moment as the Marketing Report draft, and frozen with it** (`acct_rows`, `acct_meta`, keyed by the Marketing Report's run). So there is one lifecycle and one Publish for the month: rebuilding the Marketing Report draft rebuilds it, publishing publishes it, archive and rerun archives it. The report picker lists the Marketing Report's versions. A version built before this existed shows a note to archive and rerun it.

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
| Backlog | contracted forecast still to bill through December 31, **gross as entered** (so it reads against gross billings), from the Marketing Report's pull. |
| Shortfall / (excess) | goal − billed − backlog. In brackets: the backlog more than covers the goal. (The workbook labels this "Excess/(Shortfall)" but its numbers have this sign; open question A5.) |
| ETC MWIP | the Marketing Report's MWIP for the PIC, weighted (the same figure as on that report). |
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
| Architectural revenue | the Marketing Report's firm YTD revenue (net of consultants) |
| ESOP / bonus contribution | source, YTD |
| Profit on architectural revenue | (income statement profit + ESOP / bonus) ÷ architectural revenue (the workbook's 20% reproduces) |

A figure the source does not have is shown as "Not in the source yet", and what depends on it is blank.

## 5. Export

- **Export PDF:** a window like the Marketing Report's, with the real page on the right. One page: the table, totals, the goal line and the firm figures, shrunk to fit. Choices: paper (Letter, Tabloid, A4, A3), orientation (default landscape), logo, print date; remembered on the device. Draft is marked in the footer.
- **Download for Excel (CSV):** the same grid: title, as-of date, the two heading rows, the PICs, Totals, the goal line and the firm block (`toCsv`, tested line by line).

Both come from the same `sheet()` the page uses, so they say exactly what the page says. Not tested: the PDF on paper, and the CSV in Excel versions other than current Microsoft 365.

## 6. What the source must provide

Nothing new for billed, profit, backlog and MWIP (the Project Turnaround `load` and the Marketing Report `loadBd`). One more method, `loadAccountability(period)`: `{ utilization: [{ pic, bp }], arOver90: [{ wbs1, amount }], firm: { incomeProfit, esopBonus, actualOhBp, assignedOhBp } }` (cents; basis points, 4400 = 44%). A source without it still builds; those columns are blank. Where these live is open question A1. Locally: `server/db/seed/acct_*.csv` (made up).

## 7. Not built

- The workbook's "*Part of larger Projects+" footnote on some PICs.
- A history across months, charts, drill-downs.
- An .xlsx file (CSV opens in Excel).
