# Live mode: the Marketing Report on Vantagepoint data (this computer only)

The Marketing Report can be built from real Vantagepoint data. Everything else in Compass (Project Turnaround, Pipeline watch, Billing) still shows made-up data, and the sidebar says so ("Live: Marketing Report").

## How to use it (Josh)

1. **Pull a month** from Vantagepoint (read only). Needs `.env.vp` (see `docs/VP-CONNECTION.md`).

   ```
   npm.cmd run vp:pull-bd -- 202610
   ```

   It saves a snapshot of that moment: YTD revenue per project, the PMs' plan entries, the holiday calendar, the pursuits, and the principals' names. Without a month it pulls the last closed month.
2. **Start live mode**: `npm.cmd run live`, then open http://localhost:5290. The first start sets up its own database from `server/db/live/config.json` (the 2026 goals, the sectors, the 0.65 factor).
3. **Build the report** in Admin > Report runs (Marketing Report, the month), review the draft, publish. **Rebuild draft** re-reads the latest pull for that month, so pull again first if the forecast or MWIP changed. The report notes when the pull was made.

The demo (`npm start`, port 5281) is untouched: its own database and the made-up files.

## Where things are (all git-ignored: real firm data)

| | |
|---|---|
| `server/db/live/snapshots/bd-<month>-<time>.json` | one file per pull; the latest for a month is used |
| `server/db/live/compass-live.sqlite` | the live database (built reports, settings, audit log) |
| `server/db/live/config.json` | goals per PIC (Vantagepoint employee code) and per sector, sectors and roll-ups, MWIP factor. Shape: `server/db/seed/live-config.example.json` (made up). After setup, edit them in Admin > Marketing Reports. `npm.cmd run live:setup` resets the live database from the config (built reports are lost). |

## How it fits the rules

- **Only a job reads Vantagepoint.** The pull is a command run on this computer (`server/jobs/vp-pull-bd.js`); the web server and browsers only read the saved snapshot.
- **Read only, fixed statements.** The five SELECTs are in `server/vp/bd-statements.js`, each reconciled against a Vantagepoint export (`docs/BD-REVENUE-METHOD.md`, `docs/FORECAST-METHOD.md`, `docs/MWIP-METHOD.md`); the connection refuses anything but a plain SELECT.
- **Forecast and MWIP keep no history in Vantagepoint**, so the snapshot is the record of what they said; a published report keeps its numbers.
- **The calculations are Compass's own** (`modules/bd/logic/`): the snapshot holds raw inputs, and the report applies the Admin's settings (MWIP options, contract amount rule, factor), so a setting change needs only a rebuild.

## Checked (2026-11-26, October 2026)

Built through the app from a pull: YTD revenue equals the October workbook to the cent on all 20 rows (firm, 13 PICs, 6 sectors); the forecast and MWIP equal `tools/bd-live-pull.js`; MWIP for Burbank, McBride, K-12 and Higher Education equals the workbook. Forecast and the other MWIP rows differ from the Nov 12 workbook because plans and pursuits were edited since.

## For Kent

Production replaces the pull command with the scheduled job on the server, using the same statements and a service account, and keeps the snapshot (or stores the same fields in tables). The report build needs nothing else: `loadBd(period)` returns the snapshot's fields (`docs/SPEC-bd.md` section 7).
