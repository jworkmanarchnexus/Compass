# MWIP backlog method, reproduced against a same-day export (2026-10-16)

Status: **reconciled against one same-day export; not approved.** Metric `mwip-backlog-method` in the Discovery registry. No firm amounts or names are in this file.

## Why this one is different from actual revenue

MWIP (pursuits) keeps **no history** and is not tied to a reporting period: anyone can edit a pursuit's fee, dates or probability at any time, and the next report shows the new numbers whatever period is selected. An old month's MWIP cannot be rebuilt from Vantagepoint. It can only be reproduced from a snapshot taken at report time, and a method can only be validated against an export made the same day, with nobody editing plans in between.

## Rules (validated for 121 of 121 pursuits and 1,452 of 1,452 monthly cells)

1. **Which projects count:** parent project record (`WBS2` and `WBS3` empty) whose number starts with a letter, `Status = 'A'` (active), `Probability` from 1 to 99, `Revenue` not zero, and `Stage` in the not-yet-awarded set: Go No Go (001), Marketing Proposal (002), Shortlisted (009), Negotiation (010), Research (011), Fee Proposal Only (015). Pursuits at 100% probability (3 in Negotiation) are left out; awarded stages are left out.
2. **Est. Fee** = `PR.Revenue`. **Weighted Fee** = `PR.WeightedRevenue` = Est. Fee x Probability / 100. (Task fees, plan fees, `PR.EstFees`, the empty `PRRevenue` table and the custom fields are not the source.)
3. **Monthly spread:** spread the Weighted Fee **by days** from `PR.EstStartDate` to `PR.EstCompletionDate`, one column per calendar month for twelve months starting with the report month (that is how Vantagepoint's MWIP report shows it). **The BD report counts only the months through Dec 31 of the report year** (owner, open question M1, 2026-10-16; restated 2026-11-25). The old workbook's sum of six months is not used.
4. **Current month decay (owner rule):** on day 1 of the report month the full month shows; each later day removes 1 / (days in the month); on day d the month shows (days in month - d + 1) / days in month of its normal amount. Past months drop out. (Counting only days after today matches 103 of 121; equal months matches 25 of 121.)
5. The spread rule is `discovery/logic/mwip-spread.js`, with tests.

## What is not verified

- The architectural factor applied afterwards (0.65, see below) is an assumption set by the owner, not a Vantagepoint number. Pursuits carry no consultant fee in Vantagepoint (`ConsultFee` and plan consultant fees are zero for them), so there is nothing to derive the factor from. It stays a setting.
- Only one day was validated. Repeat on another day before approving.
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
