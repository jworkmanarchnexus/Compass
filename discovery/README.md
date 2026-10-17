# Compass VP Discovery & Validation Agent

A development utility (not part of the Compass web app) that investigates Vantagepoint, reconciles calculations against real VP reports **locally**, and records what it learns. Claude works through a restricted tool server; real amounts and identifiers never leave this computer unless the owner approves a specific disclosure.

## Parts

| File | Job |
|---|---|
| `registry.js` | Imports the data dictionary (1,245 tables, 16,100 columns), searches it by meaning, tracks five evidence levels per field: exists, populated, current, authoritative, reconciled. Relationships are labelled documented / inferred / verified / failed. |
| `../server/vp/*` | The read-only ODBC connection (DSN `VantagePoint`), SQL policy, timeouts, row caps, redaction, `npm run vp:check`. |
| `operations.js` | Approved diagnostics: table population, column population, period coverage, join cardinality (fan-out), duplicate check. Fixed SQL built from dictionary-validated names; nothing from a caller is pasted into SQL. Also *extended mode*: proposed SQL that cannot run until the owner approves that exact text. |
| `gateway.js` | The disclosure boundary: typed output, keyed surrogate ids, small-cell suppression, per-question call budget, scrubbed text. |
| `approvals.js` | Owner decisions. Approvals are bound to the SHA-256 of the SQL; value releases are single-use. Only the CLI can decide. |
| `reference-library.js` | Registers VP reports (.xlsx, .csv): checksum, versions, period/cutoff confirmation, formula vs cached vs hardcoded cells, macros and links detected and never run. |
| `reconcile.js` | Exact (BigInt) comparison at firm, PIC, sector, PIC x sector and project levels; missing, unexpected, duplicate, double-counted and sign-flipped records; explicit tolerances that cannot hide accumulation. |
| `metrics.js` | Versioned metric registry and the whole-project consultant-ratio calculation. A metric becomes *reconciled* only through a passing reconciliation, *approved* only by the owner. |
| `investigations.js` | Persistent investigations, findings, rejected approaches; resumes after interruption. |
| `pipeline.js`, `agent.js` | Candidate statement -> metric -> reconcile against reference -> record outcome. |
| `mcp-server.js` | Local tool server for Claude (stdio MCP). |
| `cli.js` | The owner's commands. |

Data lives in `discovery/data/` (git-ignored): `knowledge.sqlite` (safe to describe to an AI: dictionary, findings, evidence, approvals, audit) and `protected/raw.sqlite` + `protected/originals/` (reference rows, candidate rows, reconciliation detail, the surrogate key). The tool server never reads the protected store except through the gateway.

## Setup

1. `npm.cmd install` (adds one dependency, `odbc`, for the connection).
2. Copy `.env.vp.example` to `.env.vp` and fill in `VP_USER` / `VP_PASSWORD` yourself. The DSN `VantagePoint` must be a **64-bit** ODBC data source.
3. `npm.cmd run vp:check` and read the pass/fail list.
4. `node discovery/cli.js setup` (dictionary location defaults to `Downloads\compass-vantagepoint-data-reference\docs\data-dictionary`; pass a folder to override).
5. To let Claude use it: add `discovery/mcp.example.json`'s server to your Claude Code MCP settings.

## Workflow

```
node discovery/cli.js refs register "<file.xlsx>" --name "Office Earnings Aug 2026" --kind primary-vp-export --report-type "Office Earnings" --period 202608 --cutoff 2026-08-12
node discovery/cli.js refs headers <refId> R_P         # headers only; fix names in specs/bd-office-earnings.json
node discovery/cli.js inv start "BD revenue" -- "Reproduce Office Earnings gross and architectural revenue"
node discovery/cli.js candidate request ledgerar-in-ytd 202608 <invId>
node discovery/cli.js approvals                        # read the exact SQL and what it discloses
node discovery/cli.js approve <approvalId>
node discovery/cli.js run bd-office-earnings ledgerar-in-ytd 202608 <refId> <approvalId> <invId>
node discovery/cli.js inv status <invId>
```

Claude's side uses the tool server: dictionary search, knowledge search, diagnostics, `propose_sql` (waits for approval), `reconcile_run`, `investigation_status`. Failures are reported two ways and never confused: `diagnosticFailed: true` means a query could not run; a failed reconciliation means it ran and did not reproduce the reference.

## Security model (enforced in code)

- Credentials come from `.env.vp` or the environment; never in code, git, logs or output (`redact.js` strips them from every message).
- The AI has no free-SQL tool, no approve tool, no way to reverse a surrogate id, and no tool that returns row values.
- Numbers can leave only under count-style keys and only as whole numbers; money-like text is refused; financial key names cannot carry numbers (`gateway.js`).
- Surrogate ids are HMAC-SHA256 with a local key, so they cannot be reversed or recomputed elsewhere.
- Group counts under 5 show as `<5`; each (question, target) has a call budget against differencing.
- Reference files are copied, never modified; macros and external links are reported, never run.
- The database account should be read-only; `vp:check` verifies that from permissions, never by trying a write.
- Not covered: a human who approves a values release has chosen to disclose it; the OS user account that runs this can read the protected store.

## Tests

`npm.cmd test` runs everything, using synthetic data only (a SQLite stand-in for Vantagepoint, generated workbooks). Nothing needs the real database. Statements that only SQL Server can run (the candidate statements) are covered by `vp:check` and live runs, not unit tests.

## Extending

- **Another reference report:** register it, add `specs/<id>.json` (sheet, header names, levels, tolerance, metric).
- **Another candidate source:** add `candidates/<id>.sql` + `.json`; the owner approves the filled statement before it runs.
- **Another metric:** save a definition with `metrics.save`; it stays *draft* until a reconciliation passes.
- **Another file format (PDF):** add a reader beside `lib/xlsx.js` and branch in `reference-library.register`; everything downstream reads stored rows.
