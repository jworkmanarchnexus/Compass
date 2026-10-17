# Discovery Agent: handoff (2026-10-15)

## Implemented
Local VP Discovery & Validation Agent in `discovery/` plus the connection layer in `server/vp/` (see `discovery/README.md`): dictionary registry with five evidence levels, read-only ODBC connection with policy/timeout/row cap/redaction, approved diagnostics, extended-SQL approval flow, disclosure gateway, reference report library (xlsx/csv), exact-decimal reconciliation at six levels, metric registry, persistent investigations, local MCP tool server, owner CLI.

## Tested
170 tests pass (141 existing, including 9 for the connection layer, plus 29 for the Discovery Agent), all on synthetic data. They cover: prohibited SQL, connection failures (refused sign-in vs unreachable), write-right detection, schema import and search, reference import (versions, macros, period never guessed, formula vs cached vs missing cache), join fan-out, duplicates, decimal precision and credits, NULL and zero fees, tolerance accumulation, firm-total-matches-but-allocations-differ, privacy refusals, surrogates, call budget, approval binding and single use, tool server surface, investigation resume after restart, and an end-to-end reconcile.


## Verified (live, July 2026)
See `docs/BD-REVENUE-METHOD.md`. Gross (retainage excluded), Direct Consultant (account type 8) and architectural revenue reproduce the VP Office Earnings exports at firm, PIC and sector level, and gross at project level against a native VP project export. Metric `office-earnings-ledger-method` is *reconciled*, not *approved*.

## Unresolved
1. The owner's whole-project consultant-ratio rule does not reproduce Direct Consultant; the ledger accrual is what Vantagepoint reports. Product question for Josh: does the ratio rule still matter for anything?
2. Encryption of the connection (ask Kent); a dedicated read-only account instead of a personal Deltek login.
3. Current vs as-of PIC and project type.

## Continue an investigation
`node discovery/cli.js inv list`, then `inv resume <id>` shows state, recent activity and the next step. Tool server: `investigation_resume`.

## Add another report
Register it, add `discovery/specs/<id>.json`, check headers with `refs headers`, run. See README "Extending".

## How Compass consumes a verified calculation
Read the metric with `metrics <name>` (or `metrics.get`): `status` must be `approved`. The definition lists source tables, parameters (including the contract-fee definition), calculation, evidence (reference checksum, levels passed) and open questions. The production job should implement the same statement and calculation and add the reconciliation fixture to `tests/fixtures`. Existing Compass financial logic is untouched.
