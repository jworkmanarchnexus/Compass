# Contracted revenue forecast method, reproduced against a same-day export (2026-10-17)

Status: **source verified against one same-day export; not approved.** No firm amounts or names are in this file.

## Why this is live data

Like MWIP, the forecast has no history and is not tied to a reporting period: PMs type the numbers into the project plan at any time, and the next report shows them whatever period is selected. Validate only against an export made the same day, with nobody editing plans. Compass takes the latest entries on the day the report is published (decided 2026-10-16).

## Rules

1. **Population:** active (`Status = 'A'`) parent projects (`WBS2` and `WBS3` empty) whose number does not start with a letter (those are pursuits, see `docs/MWIP-METHOD.md`).
2. **Gross monthly forecast** = the sum of the plan's period revenue entries: `PNPlannedRevenueLabor.PeriodCost`, joined to `PNTask` on `PlanID` and `TaskID` to find the project, bucketed by the month of `StartDate`. The amounts are **gross, exactly as the PM entered them**. (The `PeriodBill` column in that table is zero on every row; the revenue lives in `PeriodCost`.) The window is the months from the report month through December of the same year (Compass: through Dec 31).
3. **No current-month reduction** (unlike MWIP), and **no Consultants % applied**: the Vantagepoint export's Consultants % column is not used for the forecast and does not need to be reproduced (owner, 2026-10-17).
4. **Architectural forecast, for the BD report only (owner rule):** each month's gross x (1 - consultant fees / full contract amount) for that project. A $100k contract with $30k of consultants shows 0.7 x the month. The consultant fees and full contract amount come from the project record (`PR.ConsultFee`, and `PR.Fee` + `PR.ConsultFee`, with or without `PR.ReimbAllow`). **Decision: default is fee + consultant fees, without the reimbursable allowance, and it will be a setting you can change** (Josh was unsure; the choice moves only 12 of 145 projects, by at most 2.4 points of the ratio).

## Evidence (live, 2026-10-17)

- 132 of the 133 projects in the export were matched by name (the export has no project numbers). **123 of 132 reproduce all three months (Oct, Nov, Dec 2026) to within a dollar**: 70 of the 79 projects with a forecast, and 53 projects that are zero in both.
- Ruled out: plan task fees spread by dates (192 variants), planned hours x billing rate, `PR` fee fields, the empty `PRRevenue` table, custom fields, and a scan of 41 project and planning tables for any single column equal to the report.
- Adding consultant, expense and unit plan entries changes nothing.

## Unresolved

- **9 projects do not match.** Not edits after the export (none of the 145 projects had entries changed after it), not multiple plans (all have one). Owner to look at them: the private list is in `discovery/data/protected/forecast-mismatches.txt` (git-ignored).
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
