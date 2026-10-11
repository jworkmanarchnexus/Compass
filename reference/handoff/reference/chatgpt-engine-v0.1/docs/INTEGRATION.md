# Integration and Release Checklist

## Recommended repository placement

This package can be added without disturbing the existing frontend:

```
compass/
  backend/
    compass_financial/
      __init__.py
      engine.py
      __main__.py
    tests/
      test_engine.py
  docs/
    data-model/
      fees-budgets.md              # already has Discovery 010
      financial-performance.md     # link to central calculation contract
    financial-engine/
      DEFINITIONS.md
      INTEGRATION.md
  examples/
    financial-benchmarks/
      wsu_camp.json
      epic_fee_billing.json
      stockton_library.json
```

If the existing backend uses another framework or language, retain the pure function's input/output schema and tests; adapt its wiring, not the verified math. Do not create a competing parallel application.

## Implementation order

1. Copy the engine and tests to the actual Compass backend only after examining its framework and conventions.
2. Run the 12 bundled tests. Add them to CI.
3. Implement a read-only Vantagepoint adapter that constructs normalized snapshots from existing `sql/verified` queries, with explicit period, WBS scope, posted/unposted option, and row-count/source auditing. Do not guess source table columns.
4. Implement billing classification in a separate mapping component. The code intentionally does **not** assume every Section C/E or Lim record maps universally to the same report column. Keep unknowns visible.
5. Expose a thin backend route such as `GET /api/projects/{wbs1}/financials?period=YYYYMM&include_unposted=false`. Illustrative route only; conform to existing API/auth architecture.
6. Send both values and flags to the frontend. Show JTD metrics, data period, overhead estimate labeling, and a source/definition tooltip. Do not show fee utilization when fee is unavailable.
7. Run report-to-engine reconciliation fixtures for WSU CAMP, Mammoth, EPIC, Stockton and Kearns. Add genuine adapter-based benchmark cases for each as data access allows.
8. Require project-authorization checks. No write-back, no Vantagepoint credentials in repository, and no unguarded raw SQL endpoint.
9. Get finance review before treating a dashboard as a production financial reporting source.

## Acceptance criteria for first UI integration

- A single source of financial formulas: no duplicate `revenue - spent` and fee formulas in React components.
- The WSU sample returns exactly revenue $511,193.85; labor $71,287.91 (include-unposted); overhead $142,575.82; expenses $241,171.93; spent $455,035.66; profit $56,158.19; margin 10.99%; fee $570,286.00.
- EPIC and Stockton reproduce signed billing adjustment behavior and exact combined fees.
- UI clearly distinguishes billing from recognized revenue and estimated overhead from actual expense.
- Missing fee shows unavailable, not zero or a negative fabricated remaining fee.
- Unknown billing sections do not get silently labeled; API response includes data-quality flags.
- A portfolio view does not mix as-of periods or posted/unposted bases.
- No EAC, progress, risk score or projected final margin is presented without another discovery and tests.
