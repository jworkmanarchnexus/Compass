# Paste into Claude after attaching this ZIP and giving access to the actual Compass repository

You are integrating an executable prototype of Compass's centralized project financial calculation engine into the existing Architectural Nexus Compass application. Inspect the actual repository's backend, frontend, SQL, routing, authentication, and test conventions before changing anything. The attached ZIP is a reference implementation, not permission to replace the app architecture or invent Vantagepoint schema details.

Goals:
1. Make one canonical calculation service for recognized revenue, posted/unposted JTD labor, estimated overhead, expenses, spent, profit, margin, fee, classified billing, remaining recorded fee and utilization.
2. Preserve decimal accuracy end to end. No float arithmetic, no duplicated business formulas in the React UI.
3. Integrate the bundled regression tests, and keep existing tests working. Separate input acquisition (read-only Deltek adapter), financial calculations (pure), API serialization and UI presentation.
4. Follow actual Architectural Nexus brand assets/guide already in the repository for a refined, accessible and minimalist financial overview.
5. Make financial periods and data provenance visible, allow posted vs include-unposted toggling only where actual source semantics are validated, and expose unmatched or unsupported data rather than inventing values.
6. The summary fee uses PR.Fee + PR.ConsultFee + PR.ReimbAllow on the project-level PR record. Do not add allocation fields again. Use RPPlan project overhead percentage and do not silently substitute the current company default. Never sum entire tkDetail JTD onto LD. Never combine billInvSums ArrayType I with P.
7. Retain LedgerAR as the normalized posted invoice revenue source. Billing summaries are classification/reconciliation, not a second additive source of revenue. Billing sections C/E and Lim mappings observed on benchmarks are not yet universal rules; isolate mappings and show unknowns.
8. No EAC, ETC, change-order forecasting, historical rate assumption, invented health score, or unsupported billing classifications in this iteration.
9. Prefer the actual existing stack and deployment conventions. If there is no working production ODBC access yet, wire the sample fixtures behind a clearly labelled development-only adapter so the overview and calculations can be reviewed without pretending data is live.

Deliver: changed-file summary, API/input/output contract, exact test commands and results, reconciled benchmark figures, unresolved questions, and explicit note of which flows use fixtures versus live Vantagepoint. Avoid broad refactors unrelated to this module.
