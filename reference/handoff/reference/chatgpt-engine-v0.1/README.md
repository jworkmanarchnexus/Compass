# Compass Financial Engine | v0.1

An executable, framework-independent calculation core for Compass project financials, grounded in Vantagepoint Discoveries 001-010. It accepts normalized snapshots from a future **read-only** Vantagepoint adapter and emits deterministic JSON for a dashboard/API. Standard-library Python only.

**This is an integration-ready prototype, not a connection to Vantagepoint or a replacement for Vantagepoint financial statements.** No production integration, live data retrieval, or repo update has occurred. Sample files are historical report benchmarks, not live values.

## Run now

From the root of this package, with Python 3.10+:

```bash
python -m compass_financial examples/wsu_camp.json
python -m compass_financial examples/epic_fee_billing.json
python -m compass_financial examples/stockton_library.json
python -m unittest discover -s tests -v
```

The output uses JSON **strings** for decimal money and percentages and `null` for undefined measures. Do not convert decimal input to JavaScript/Python floating point when passing between services.

## What it calculates

| Output | Definition | Status |
| --- | --- | --- |
| Recorded project fee | `PR.Fee + PR.ConsultFee + PR.ReimbAllow` on top-level PR | Reconciled in four named projects |
| Posted JTD labor | Normalized `LD` labor amount | WSU reconciled |
| Labor including unposted | **Complete** JTD `tkDetail` amount, substituted for LD, never added to it | WSU reconciled for current snapshot |
| Estimated overhead | Selected JTD labor × explicit project-specific `RPPlan.OverheadPct` / 100 | WSU, Kearns reconciled at report precision |
| Expenses | Normalized LedgerEX + LedgerAP + LedgerMisc project-cost postings | WSU reconciled |
| Recognized revenue | Normalized posted-invoice `LedgerAR` IN postings, sign inverted | WSU reconciled |
| Total spent | Labor + estimated overhead + project expenses | WSU, EPIC, Stockton report references |
| Profit | Recognized revenue − total spent | WSU and other benchmarks reconciled |
| Profit margin | Profit / revenue × 100; `null` for zero revenue | WSU validated |
| Invoice billing | Classified invoice-only (`billInvSums.ArrayType='I'`) amounts; retain signed adjustments | Five projects reconciled |
| Remaining recorded fee | Recorded project fee − JTD total billed; `null` for unavailable fee or billing | Validated arithmetic, not ETC or forecast |
| Fee utilization | JTD total billed / recorded project fee × 100 | Validated arithmetic |

**Do not confuse fee utilization with progress, earned value, forecast profit, EAC, cash collection, or contractual entitlement.**

## Integration contract

Call `calculate_project(normalized_project_dict)` in a backend service. The future read-only adapter must select one consistent `as_of_period` and produce:

- `project_number` (string), `project_name` (optional), `as_of_period` (YYYYMM).
- `recognized_revenue`: LedgerAR posted invoice revenue, normalized to positive revenue sign; retain all relevant reversal entries and exclude cash receipts.
- `posted_labor`: LD JTD labor across all project WBS, period-filtered, RegAmt + OvtAmt + SpecialOvtAmt.
- `labor_including_unposted` when requested: complete JTD tkDetail amount, **not** just unposted increment. Historical as-of tkDetail behavior remains unverified; do not offer unsupported historical unposted views.
- `include_unposted_labor`: controls which complete JTD labor input is used.
- `project_expenses`: the verified ledger union across LedgerEX (EX), LedgerAP (AP), LedgerMisc (JE), ProjectCost=Y, appropriate WBS and period; centralize the authoritative account mapping if breaking down direct vs reimb.
- `overhead_rate_pct`: project-specific RPPlan OverheadPct and `overhead_rate_source` for traceability; do not silently substitute the current global default. For report-reference tests only, `estimated_overhead_override` may supply a known report number and is flagged.
- `fee_components`: `fee`, `consult_fee`, `reimb_allow` on one top-level PR row (do not sum phase PR rows).
- `billing_entries`: optional, pre-classified **invoice-level** billing groups; each entry carries `array_type='I'`, amount as signed decimal string, and explicit `category` in `fee`, `reimb`, `consultant`, `other`, `unmapped`. Keep section/subsection provenance. Classification belongs in the adapter/lookup, not in the financial engine. The documented F/L/C/E/Lim mapping works in tested cases only. Preserve uncommon billing codes as unmapped until validated.
- `jtd_total_billed`: optional independently reconciled amount; strongly preferred until invoice validity/void/reversal coverage is proven. It is compared with entries when both are supplied. `PreInvoice='N'` by itself is not proof of fully reconciled billing validity.

All financial inputs should be exact decimal strings such as `"241171.93"`. Floats are rejected.

### JSON input example

```json
{
  "project_number": "0025054.00",
  "as_of_period": "202609",
  "recognized_revenue": "511193.85",
  "posted_labor": "70923.51",
  "labor_including_unposted": "71287.91",
  "include_unposted_labor": true,
  "overhead_rate_pct": "200",
  "overhead_rate_source": "RPPlan.OverheadPct",
  "project_expenses": "241171.93",
  "fee_components": {"fee": "364184.12", "consult_fee": "206101.88", "reimb_allow": "0"},
  "jtd_total_billed": "511193.85",
  "billing_entries": [
    {"array_type": "I", "section": "F", "subsection": "0", "category": "fee", "amount": "511193.85"}
  ]
}
```

The WSU billing entry is a classified aggregate for the benchmark, not a claim that there is a single underlying invoice row. An adapter may supply one entry per invoice line or pre-aggregated section and subsection, but only from invoice-level records.

## Handling unknowns and warnings

- When all fee component values are absent or zero, fee, remaining fee and utilization return `null` and `PROJECT_FEE_UNAVAILABLE` is flagged. This represents *unavailable*, not a proven zero-value contract.
- An unmapped billing category produces `BILLING_CLASSIFICATION_INCOMPLETE`; without an independently reconciled billed total, remaining fee/utilization stay `null`.
- Different independently supplied billed and classified totals flag `BILLING_RECONCILIATION_MISMATCH`.
- Different revenue and billing totals flag `RECOGNIZED_REVENUE_DIFFERS_FROM_BILLING`, rather than assuming all projects have identical values.
- An explicit report-reference overhead is flagged `OVERHEAD_REPORT_OVERRIDE_USED`, so it cannot masquerade as a verified RPPlan calculation.
- Negative remaining fee remains negative and is flagged as billing above recorded fee. Do not clamp values to zero.
- Zero revenue gives an undefined (`null`) margin.
- `calculate_portfolio` only aggregates common period and labor basis; it calculates weighted margin as aggregate profit / aggregate revenue rather than averaging individual percentages. It does not aggregate fees across potentially overlapping project structures.

## Explicitly out of scope

Live Vantagepoint connection; complete billing section-to-report classification; invoice validity mapping; YTD/current month; original budget versus revised budget; budget availability by phase and discipline; historical overhead changes; overhead rate ascertainment for Stockton (fixture uses a report reference amount); EAC/ETC, forecast, change orders, revenue recognition methods across untested project types; account-level financial drilldown; portfolio cross-project WBS deduplication; and UI/business-facing health-score thresholds.

## Files

- `compass_financial/engine.py`: calculations and data validation.
- `compass_financial/__main__.py`: CLI entry point.
- `examples/`: historical benchmark snapshots.
- `tests/`: 12 regression checks.
- `docs/INTEGRATION.md`: suggested placement and integration workflow.
- `docs/DEFINITIONS.md`: source-to-output traceability.
- `docs/CLAUDE_HANDOFF.md`: implementation instructions for existing Compass application.

Version: Discovery-010-v1. Before a production release, review input sourcing, accounting sign conventions, as-of cutoffs, permissions and auditability with Nexus finance stakeholders.
