# Live Vantagepoint connection (Discovery Agent, phase 1)

Compass can read Vantagepoint directly, on Josh's computer only, through the Windows ODBC data source `VantagePoint` (the one DBeaver uses). This is separate from the nightly pull in `server/vp-local.js`; browsers never reach it.

## Layers (each is a separate lock)

1. **Operations, not SQL** (phase 2): Claude names an operation; the agent runs a fixed statement from this repo. Claude never sends SQL.
2. **Policy** (`server/vp/policy.js`): every statement must be one plain SELECT; table names must be on the approved list (the eight tables in `compass_negative_projects.sql`).
3. **Read-only account**: verified from permissions by `npm run vp:check`, never by attempting a write.
4. **Limits** (`connection.js`): query timeout (30 s) and row cap (200), both adjustable in `.env.vp`.
5. **Disclosure** (`redact.js`): errors and any text that leaves the machine lose credentials, money-like numbers and long numbers. Financial amounts stay local; only counts, pass/fail and categories are returned.

## Setup (Josh)

1. Copy `.env.vp.example` to `.env.vp`; fill `VP_USER` and `VP_PASSWORD` yourself (same login as DBeaver). `.env.vp` and `vp-findings/` are git-ignored.
2. `npm.cmd run vp:check`
3. Share only the pass/fail list with Claude. It carries no amounts or credentials.

## Open points

- The DSN must be a **64-bit** ODBC data source (Windows "ODBC Data Sources (64-bit)"), because Node is 64-bit. A 32-bit-only DSN fails with "data source name not found".
- The login looks like a personal Deltek login (`<id>.<name>.prd`). Ask Kent/Deltek for a dedicated read-only account for the agent once it is in regular use.
- Encryption status is read from the server when the account may see it; otherwise reported as "not visible". Confirm TLS in the DSN settings.

## Next phases

2. Operations and a local MCP server (data-dictionary search, table populations, period coverage, relationship tests).
3. Reconciliation against the August 2026 BD workbook, returning categories and counts only; any amount disclosure requires an explicit, narrowly scoped approval.
