# Contracted revenue forecast method, reproduced against a same-day export (2026-10-17)

Status: **monthly amounts reproduced to the dollar against a same-day export (2026-11-25: 144 of 144 projects, 12 months); the Consultants % column reproduced from the report's own definition (2026-11-28: 143 of 144 exact, 144 within half a point); not approved.** No firm amounts or names are in this file.

## Why this is live data

Like MWIP, the forecast has no history and is not tied to a reporting period: PMs type the numbers into the project plan at any time, and the next report shows them whatever period is selected. Validate only against an export made the same day, with nobody editing plans. Compass takes the latest entries on the day the report is published (decided 2026-10-16).

## Rules

1. **Population:** active (`Status = 'A'`) parent projects (`WBS2` and `WBS3` empty) whose number does not start with a letter (those are pursuits, see `docs/MWIP-METHOD.md`).
2. **Gross monthly forecast** = the sum of the plan's period revenue entries: `PNPlannedRevenueLabor.PeriodCost`, joined to `PNTask` on `PlanID` and `TaskID` to find the project, **each entry spread across its own dates (`StartDate` to `EndDate`) by working days**: Monday to Friday, less the firm holiday calendar (`CFGHoliday`), then added up by month (2026-11-25). Bucketing by the month of `StartDate` is right only for entries inside one month; the 9 projects that missed on 2026-10-17 had entries spanning months. Vantagepoint shows whole dollars. The amounts are **gross, exactly as the PM entered them**. (The `PeriodBill` column in that table is zero on every row; the revenue lives in `PeriodCost`.) The window is the months from the report month through December of the same year (Compass: through Dec 31).
3. **No current-month reduction** (unlike MWIP).
4. **Architectural forecast, for the BD report only:** each month's gross x (1 - the consultant share). Which share is the Admin setting `bd.contractAmount`:
   - **`vpActual`, the default (owner, 2026-11-28): Vantagepoint's "Consultants %"**, exactly as the "CFO-Nexus Revenue Forecast Detail for Architectural Revenue" report defines it (its query, downloaded by Josh): `[dirjtd] / [JTDEarnedRevenue]`.
     - `dirjtd` = job-to-date amount of every line on a `CA.Type` 7 or 8 account (61xx consultants-direct, 62xx direct expenses: travel, meals, reproductions...) **flagged `ProjectCost = 'Y'`**, across `LedgerAP`, `LedgerAR`, `LedgerEX` and `LedgerMisc`.
     - `JTDEarnedRevenue` = job-to-date revenue (`CA.Type` 4, sign reversed) over the same ledgers. (The report uses the plan's JTD revenue for projects whose `AllocMethod` is `r`; the ledger gave the same result on every project tested.)
     - Through the report month. The statement is `toDate` in `server/vp/bd-statements.js`.
     - It is an **actual-to-date** ratio, not a contract ratio: it moves every month as costs and revenue post; moving dollars between our fee and the consultant fee changes it only when costs post; consultants booked to the reimbursable accounts (51xx, `CA.Type` 6) are not in it. A project with no revenue yet is 0% (the full forecast counts), as Vantagepoint shows it.
     - Note: YTD revenue (the Office Earnings method) takes out only consultants (`CA.Type` 8); this share also takes out direct expenses (type 7).
   - `feeConsult`: consultant fee / (fee + consultant fee) from the project record (the contract split; the rule from 2026-10-17 to 2026-11-28). `feeConsultReimb`: the same with the reimbursable allowance in the denominator.

## Evidence (live, 2026-10-17)

- 132 of the 133 projects in the export were matched by name (the export has no project numbers). **123 of 132 reproduce all three months (Oct, Nov, Dec 2026) to within a dollar**: 70 of the 79 projects with a forecast, and 53 projects that are zero in both.
- Ruled out: plan task fees spread by dates (192 variants), planned hours x billing rate, `PR` fee fields, the empty `PRRevenue` table, custom fields, and a scan of 41 project and planning tables for any single column equal to the report.
- Adding consultant, expense and unit plan entries changes nothing.

## In Compass

The rule is `modules/bd/logic/forecast.js` (fixtures `modules/bd/tests/fixtures/forecast.json`), used by the report build when the source supplies the plan entries (`docs/SPEC-bd.md` sections 3b and 7) and by `tools/bd-live-pull.js`. Checked 2026-11-26 against the Nov 25 export with plan entries read a day later: 144 of 144 projects within about a dollar in every month (whole-dollar rounding in the export).

## Evidence (live, 2026-11-25): "CFO-Nexus Contracted Revenue Forecast for MC Reports", Nov 2026 to Oct 2027

- **Population:** 144 projects in the export; no active project with plan entries in the window is missing from it.
- **Monthly amounts:** 144 of 144 projects within $1 in every month (1,725 of 1,728 cells exact to the dollar; the other 3 differ by $1, rounding) with the working-day spread and the full holiday calendar. Bucketing by start month: 130 of 144. Calendar days, or weekdays without holidays: 130 to 131.
- **Backlog column** = Fee + Consultant fee + Reimbursable allowance from the project record, less billed to date (`LedgerAR` invoices, retainage excluded): 118 of 144. Not used by the BD report.
- **Consultants % column** (Nov 25 work, superseded on Nov 28): not consultant fee / (fee + consultant fee) from the project record or the plan (39 of 144 at best).

## Evidence (live, 2026-11-28): the Consultants % and the architectural forecast, by PIC

- Against Josh's same-day export (forecast by PIC, October): `[dirjtd] / [JTDEarnedRevenue]` through 202610 with `ProjectCost = 'Y'`: **143 of 144 projects exact**, 144 within half a point (the one left is a tiny project, off by 0.007 points). Without the `ProjectCost` filter: 140. Through 202611: 113. Contract split: 38. Remaining consultant fee / backlog: 35.
- The Compass draft rebuilt with `vpActual` matches the export's architectural forecast for every PIC to within a few cents ($2.74 on the firm total), the export rounding each month to whole dollars.

## Unresolved

- ~~9 projects do not match.~~ Resolved 2026-11-25: entries spanning months, spread by working days (rule 2).
- "Full contract amount" is settled as a default, not proven. The report's Consultants % was checked as a back-test: on the 11 projects where the two definitions differ it fits neither (median distance about 2 points), and a search of every pair among 138 stored project, plan and ledger columns found none that reproduces that percentage for half of the projects, so the report's number is not a simple ratio of stored totals. Earlier note on the ledger fit: Against the ledger's actual consultant cost to date, `ConsultFee / (Fee + ConsultFee + ReimbAllow)` and `ConsultFee / (Fee + ConsultFee)` fit equally well (about 25 of 84 projects with consultants within 0.1%), because the ledger accrual does not always follow the whole-project ratio; this is a business rule, not a Vantagepoint calculation.
- One reference name was not matched, and the reference has no project numbers; repeat with an export that includes them.

## Implementation SQL (gross by month; the window months are fixed in this statement and would be parameterised)

```sql
SELECT p.WBS1 AS project,
       LTRIM(RTRIM(ISNULL(e.LastName, ''))) + ', ' + LTRIM(RTRIM(ISNULL(e.FirstName, ''))) AS pic,
       ISNULL(t.Description, p.ProjectType) AS sector,
       p.Name AS name,
       ISNULL(r.oct_v, 0) AS rev_oct, ISNULL(r.nov_v, 0) AS rev_nov, ISNULL(r.dec_v, 0) AS rev_dec,
       ISNULL(r.n_rows, 0) AS rev_rows
FROM dbo.PR p
LEFT JOIN (SELECT k.WBS1,
                  SUM(CASE WHEN r.StartDate >= '20261001' AND r.StartDate < '20261101' THEN r.PeriodCost ELSE 0 END) AS oct_v,
                  SUM(CASE WHEN r.StartDate >= '20261101' AND r.StartDate < '20261201' THEN r.PeriodCost ELSE 0 END) AS nov_v,
                  SUM(CASE WHEN r.StartDate >= '20261201' AND r.StartDate < '20270101' THEN r.PeriodCost ELSE 0 END) AS dec_v,
                  COUNT(*) AS n_rows
           FROM dbo.PNPlannedRevenueLabor r JOIN dbo.PNTask k ON k.PlanID = r.PlanID AND k.TaskID = r.TaskID GROUP BY k.WBS1) r ON r.WBS1 = p.WBS1
LEFT JOIN dbo.EMMain e ON e.Employee = p.Principal
LEFT JOIN (SELECT Code, MIN(Description) AS Description FROM dbo.CFGProjectTypeDescriptions GROUP BY Code) t ON t.Code = p.ProjectType
WHERE p.WBS2 = '' AND p.WBS3 = '' AND p.Status = 'A' AND p.WBS1 NOT LIKE '[A-Za-z]%'
```
