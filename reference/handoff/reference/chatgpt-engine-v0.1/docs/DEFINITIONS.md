# Source and Metric Definitions

Discovery references are based on the user's manually reconciled Vantagepoint Project Summary reports as of October 2026. This document summarizes testable definitions; see existing `docs/data-model/` and `sql/verified/` in the Compass repository for original discovery queries.

| Normalized input | Vantagepoint source | Rules and limits |
| --- | --- | --- |
| Identity and assignments | `dbo.PR` + `dbo.EMMain` | Project-level row WBS2/WBS3 empty; preserve exact project number |
| Posted labor | `dbo.LD` | Aggregate RegAmt+OvtAmt+SpecialOvtAmt, all matching project WBS, Period<=selected cutoff |
| Include-unposted labor | `dbo.tkDetail` | A complete historical + unposted JTD basis at validated current snapshot; replace LD, never add whole tkDetail to LD; arbitrary historical as-of needs new validation |
| Revenue | `dbo.LedgerAR` | `-SUM(Amount)` for relevant `TransType='IN'` invoice postings (retain reversing records), all WBS and period cutoff; no cash receipt CR as revenue |
| Expenses | `dbo.LedgerEX`, `dbo.LedgerAP`, `dbo.LedgerMisc` | Union sources as verified with EX/AP/JE and ProjectCost='Y'; ensure source filters and account sign conventions |
| Overhead rate | `dbo.RPPlan.OverheadPct` | Project-specific rate; no silent global current-default fallback; estimated, not actual overhead expenses |
| Project fee | `dbo.PR` | `Fee + ConsultFee + ReimbAllow`; only top-level project row; sub-allocation fields are not extra sums |
| Billing | `dbo.billInvSums` | Invoice-level ArrayType I, do not add P; signed values and Lim adjustments retained; category mapping verified only for tested projects |

## Reconciled benchmark totals

| Benchmark | Fact | Expected |
| --- | --- | ---: |
| WSU CAMP | Project fee | $570,286.00 |
| WSU CAMP | Unposted-inclusive labor | $71,287.91 |
| WSU CAMP | Estimated overhead at 200% | $142,575.82 |
| WSU CAMP | Expenses | $241,171.93 |
| WSU CAMP | Revenue | $511,193.85 |
| WSU CAMP | Total spent | $455,035.66 |
| WSU CAMP | Profit | $56,158.19 |
| EPIC Challenge Mutual | Project fee | $3,374,968.00 |
| EPIC Challenge Mutual | Fee billed incl. adjustment | $2,238,658.28 |
| EPIC Challenge Mutual | Reimb billed | $942,197.76 |
| EPIC Challenge Mutual | Total billed | $3,180,856.04 |
| EPIC Challenge Mutual | Profit based on supplied detailed report numbers | $207,854.02 |
| Stockton Library | Project fee | $2,611,647.50 |
| Stockton Library | Fee billed incl. adjustment | $2,125,182.10 |
| Stockton Library | Reimb billed | $155,526.91 |
| Stockton Library | Total billed | $2,280,709.01 |
| Stockton Library | Remaining recorded fee | $330,938.49 |
| Stockton Library | JTD spent (report reference) | $2,373,701.41 |
| Stockton Library | JTD profit (report reference) | ($92,992.40) |

`Stockton` fixture uses the report's directly observed $1,077,211.55 estimated overhead; its RPPlan rate was **not** verified. The report's revenue is used as a historical reference, not asserted to be independently LedgerAR reconciled. `EPIC` overhead is consistent with the reported 200% and labor figures but its RPPlan setting is not yet independently checked.
