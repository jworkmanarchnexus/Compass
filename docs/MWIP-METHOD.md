# MWIP backlog method, reproduced against same-day exports (2026-10-16 and 2026-11-25)

Status: **reconciled against same-day exports on two days; not approved.** Metric `mwip-backlog-method` in the Discovery registry. No firm amounts or names are in this file.

## Why this one is different from actual revenue

MWIP (pursuits) keeps **no history** and is not tied to a reporting period: anyone can edit a pursuit's fee, dates or probability at any time, and the next report shows the new numbers whatever period is selected. An old month's MWIP cannot be rebuilt from Vantagepoint. It can only be reproduced from a snapshot taken at report time, and a method can only be validated against an export made the same day, with nobody editing plans in between.

## Rules (validated for 121 of 121 pursuits and 1,452 of 1,452 monthly cells)

1. **Which projects count:** parent project record (`WBS2` and `WBS3` empty) whose number starts with a letter, `Status = 'A'` (active), `Probability` from 1 to 99, `Revenue` not zero, and `Stage` in the not-yet-awarded set: Go No Go (001), Marketing Proposal (002), Shortlisted (009), Negotiation (010), Research (011), Fee Proposal Only (015). Pursuits at 100% probability (3 in Negotiation) are left out; awarded stages are left out.
2. **Est. Fee** = `PR.Revenue`. **Weighted Fee** = `PR.WeightedRevenue` = Est. Fee x Probability / 100. (Task fees, plan fees, `PR.EstFees`, the empty `PRRevenue` table and the custom fields are not the source.)
3. **The spread depends on the report's Calculation Period** (proven 2026-11-25: five exports run the same day, one per setting, compared with the pursuit records read minutes apart):
   - Split the dates from `PR.EstStartDate` to `PR.EstCompletionDate` into calculation periods: **days** (Daily), **the 1st-15th and 16th-end of each month** (Semi-monthly), or **calendar months** (Monthly). A partial period at either end counts as a whole one.
   - Every period gets an **equal share** of the Weighted Fee.
   - Periods that ended **before the report's start date drop out**; the period the start date falls in **counts in full**.
   - Daily, Semi-monthly and Monthly each reproduce **109 of 109 pursuits and 1,308 of 1,308 monthly cells** to the cent. Weekly and Bi-weekly come within $0.70 and $1.03 of a cell (close to Daily) but were not reproduced exactly; they are not offered.
   - The October 16 export and the Nov 12 October workbook were made with **Daily** (by days, and the days before the start date dropped out). That is the "current month decay" first described here: it is not a separate rule, only Daily's periods before the start date dropping out. The earlier formula (cut the whole month's amount by the share of days gone) was wrong for a pursuit that starts partway through the month and is replaced by this rule.
4. **Window:** Vantagepoint shows twelve months from the start date. **The BD report counts only the months through Dec 31 of the report year** (owner, open question M1, 2026-10-16; restated 2026-11-25). The old workbook's sum of six months is not used.
5. **The BD report starts on the first day after the report month** (owner, 2026-11-25): the October report starts on Nov 1, so it shows all of November whichever day it is built. This matches the workbook's ReadMe step "Change prior period to be the end of the previous month" and the Nov 12, 2026 October workbook. Example (Daily): a pursuit with $60k in November shows $60k in the October report, not the $52k Vantagepoint shows when run on Nov 5. The data is still the latest on the day the report is built (no history exists); only the start date uses the report month.
6. Compass's rule, with the report's options (Weighted or Estimated Fee; spread, start date or completion date; Daily, Semi-monthly or Monthly; start date; duration), is `modules/bd/logic/mwip.js`, with fixtures; the options are Admin settings (`docs/SPEC-bd.md` section 4b). The default is Daily, as the workbook used. (`discovery/logic/mwip-spread.js` is the earlier investigation tool and keeps the old formula.)

## What is not verified

- The architectural factor applied afterwards (0.65, see below) is an assumption set by the owner, not a Vantagepoint number. Pursuits carry no consultant fee in Vantagepoint (`ConsultFee` and plan consultant fees are zero for them), so there is nothing to derive the factor from. It stays a setting.
- Compass must snapshot MWIP at report time (the Pipeline watch module already takes weekly snapshots); the BD report must read the snapshot.

## The architectural factor (owner decision 2026-10-16: must be editable in Compass)

Compass already has this as an Admin setting: `bd_mwip_factor`, effective-dated and append-only, in basis points (6500 = 0.65), entered on the BD Admin screen. Both questions are settled:

1. **One factor, 0.65, for both views** (owner, 2026-10-16 for one factor; 2026-11-25 for the value). The old BD workbook used 0.67 for the PIC view and 0.65 for the sector view. Compass uses 0.65 for both, so the firm total is the same on both tabs. Expect the PIC view's MWIP to come out lower than a workbook built the old way (0.65 / 0.67, about 3% lower). The local demo seed keeps the mockup's 0.67 for 2026 only so it reproduces the mockup.
2. **What it is applied to.** Vantagepoint already weights each pursuit by probability (Weighted Fee). The factor is the architectural share (consultants removed), applied to the probability-weighted, day-spread amount from this method.

## Implementation SQL

```sql
SELECT p.WBS1 AS project,
       LTRIM(RTRIM(ISNULL(e.LastName, ''))) + ', ' + LTRIM(RTRIM(ISNULL(e.FirstName, ''))) AS pic,
       ISNULL(t.Description, p.ProjectType) AS sector,
       ISNULL(p.Revenue, 0) AS revenue,
       ISNULL(p.WeightedRevenue, 0) AS weighted,
       p.Status AS status,
       p.Stage AS stage,
       p.Probability AS probability,
       CONVERT(varchar(10), p.EstStartDate, 120) AS est_start,
       CONVERT(varchar(10), p.EstCompletionDate, 120) AS est_completion,
       CONVERT(varchar(10), p.EstEndDate, 120) AS est_end,
       CONVERT(varchar(10), p.StartDate, 120) AS start_date,
       CONVERT(varchar(10), p.EndDate, 120) AS end_date
FROM dbo.PR p
LEFT JOIN dbo.EMMain e ON e.Employee = p.Principal
LEFT JOIN (SELECT Code, MIN(Description) AS Description FROM dbo.CFGProjectTypeDescriptions GROUP BY Code) t ON t.Code = p.ProjectType
WHERE p.WBS2 = '' AND p.WBS3 = '' AND p.WBS1 LIKE '[A-Za-z]%' AND p.Status = 'A' AND p.Probability > 0 AND p.Probability < 100
```
