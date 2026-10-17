# BD revenue method (Office Earnings), verified for July 2026

Status: **reconciled for two periods (202607 and 202606), not yet approved.** Sector classification: current, as decided by the owner. Metric `office-earnings-ledger-method` in the Discovery registry. Implemented by `discovery/candidates/bd-office-earnings-ledger.sql`. Nothing in this file is a firm amount.

## Rules

- **Gross billed** = -SUM(`LedgerAR.Amount`) where `TransType = 'IN'` and `SubType` is not `R` (retainage), by posting `Period` from January of the report year through the report period, per parent project (`PR` row with `WBS2` and `WBS3` empty).
- **Direct Consultant** = SUM(`Amount`) over `LedgerAP`, `LedgerEX` and `LedgerMisc` rows on accounts whose `CA.Type` is 8, same periods, per project.
- **Architectural revenue** = gross - Direct Consultant, per project, then rolled up to PIC or market sector.
- Posting period, not transaction date. Projects that appear in the ledger with no `PR` row are left out (the report omits them; keeping them made the firm total worse).

## Evidence (period 202607, year to date through 2026-07-31)

| Level | Reference | Result |
|---|---|---|
| Gross, by project | native VP project export (Revenue Checker) | 147 of 147 exact, 46 zero-on-both-sides |
| Gross, firm / PIC / sector | BD workbook exports R_P and R_M | firm exact, 12 of 12 PICs, 7 of 7 sectors |
| Direct Consultant, firm / PIC / sector | same | exact at every level |
| Architectural, firm / PIC / sector | same | exact at every level, using the owner-recorded VP value for one hand-edited cell |

| **June 2026 (202606):** gross, consultant, architectural, by project | June workbook R_M (detail layout) | 187 of 187 projects exact for all three measures, 23 zero-on-both-sides |
| June 2026: firm and PIC | June workbook R_P | exact at firm, 12 of 12 PICs, all three measures |
| June 2026: market sector | June workbook R_M | 4 of 7 sector groups exact; 10 of 187 projects were reclassified into the new Laboratory sector after the report (explained, see below) |

Ruled out: including retainage lines (breaks exactly one project); including account type 6 in consultant (breaks 9 of 13 PICs); the owner's whole-project fee ratio from `PR` (does not reproduce Direct Consultant under any denominator tried); keeping projects with no `PR` row. Automatic entries make no difference.

**Decision (owner, 2026-10-16): use the current classification from Vantagepoint.** Reports always reflect today's PIC and sector. Consequence to keep in mind: re-running an old month later can differ from the workbook saved then if projects were reclassified in between (as with Laboratory); the amounts per project do not change.

## Caveats
- Classification uses current `PR.Principal` and `PR.ProjectType`; historical as-of classification was not tested.
- Exact amounts were compared locally; only counts and statuses left the computer.

## Implementation SQL (parameters `{{period}}` YYYYMM and `{{yearStart}}` = January of the same year)

```sql
SELECT COALESCE(g.WBS1, k.WBS1) AS project,
       LTRIM(RTRIM(ISNULL(e.LastName, ''))) + ', ' + LTRIM(RTRIM(ISNULL(e.FirstName, ''))) AS pic,
       ISNULL(t.Description, p.ProjectType) AS sector,
       ISNULL(g.gross, 0) AS gross,
       ISNULL(k.consultant, 0) AS consultant_ledger
FROM (SELECT WBS1, -SUM(Amount) AS gross
      FROM dbo.LedgerAR
      WHERE TransType = 'IN' AND ISNULL(SubType, '') <> 'R' AND Period BETWEEN {{yearStart}} AND {{period}}
      GROUP BY WBS1) g
FULL JOIN (SELECT x.WBS1, SUM(x.Amount) AS consultant
           FROM (SELECT WBS1, Account, Amount FROM dbo.LedgerAP WHERE Period BETWEEN {{yearStart}} AND {{period}}
                 UNION ALL
                 SELECT WBS1, Account, Amount FROM dbo.LedgerEX WHERE Period BETWEEN {{yearStart}} AND {{period}}
                 UNION ALL
                 SELECT WBS1, Account, Amount FROM dbo.LedgerMisc WHERE Period BETWEEN {{yearStart}} AND {{period}}) x
           JOIN (SELECT Account, MIN(Type) AS Type FROM dbo.CA GROUP BY Account) a ON a.Account = x.Account
           WHERE a.Type IN (8)
           GROUP BY x.WBS1) k ON k.WBS1 = g.WBS1
JOIN dbo.PR p ON p.WBS1 = COALESCE(g.WBS1, k.WBS1) AND p.WBS2 = '' AND p.WBS3 = ''
LEFT JOIN dbo.EMMain e ON e.Employee = p.Principal
LEFT JOIN (SELECT Code, MIN(Description) AS Description FROM dbo.CFGProjectTypeDescriptions GROUP BY Code) t ON t.Code = p.ProjectType
```

Compass should consume this as a fixed statement, add the reconciliation as a fixture with synthetic data, and read the metric definition (`node discovery/cli.js metrics office-earnings-ledger-method`) before changing it.
