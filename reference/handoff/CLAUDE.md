# CLAUDE.md: Compass

You are building **Compass**, an internal web portal for Archnexus (~80-person architecture firm, Salt Lake City). The owner, Josh Workman, is becoming CFO in January and will maintain this with Git and Claude Code. Kent (IT) hosts it. The goal is **one tight, well-built tool**: Project Turnaround plus the shell (sign-in, roles, Home, Admin). BD report and Pipeline watch come after Turnaround is solid.

## Read first
1. `docs/01-product-spec.md`: behavior and decided rules
2. `docs/02-data-model.md`: tables
3. `docs/03-design-system.md` and `design/portal-mockup.html`: the look
4. `docs/04-open-questions.md`: **do not decide these yourself.** Ask Josh, or build behind a setting.

## Hard rules (these were deliberate decisions)
- **Vantagepoint is read-only, production only.** One SELECT-only service account. Never write to it. The portal never queries it from a browser or on page load; a scheduled job does, and stores results in Compass's own database.
- **A published run is locked.** Re-running = archive the old run (needs a reason AND typing `RERUN`) and create a new draft. PICs see the last published run until a new one is published.
- **Plan logs are append-only.** No edit, no delete. Fixing a mistake = a Correction entry pointing at the original. Dates that move create a "Date revised" entry; the first date stays on record. Plan entries belong to the **project (WBS1)**, not the run.
- **Only the PIC writes plan content.** Admin may add clearly labeled, public **Admin notes**. Admin can never post in a PIC's voice.
- **The system never emails a PIC pretending to be Josh.** Reminders are *check-in drafts* in an admin-only queue. Josh sends them from his own mailbox ("Open in Outlook" = a mailto/Outlook compose link, then "Mark as sent"). The only automatic email goes to Josh, and contains no PIC data, only a count and a link.
- **Commitments:** single-select lever, one number per commitment (zero allowed, not advertised). "Mark done" asks for the actual result. **Lever and number are stored but NOT shown to PICs.** Per-lever rollups are admin-only.
- **YTD only.** Fresh start every January, not advertised. Plans opened last year stay readable. January grace period (Admin setting, default Feb 1): no plans due until then.
- **MWIP and forecast are separate everywhere.** MWIP gets more scrutiny. The MWIP weighting factor (0.67) is an effective-dated Admin setting and is **not shown on PIC pages**; old reports keep the factor they were built with.
- **PICs see all PICs' data.** "On time / kept" percentages per PIC have their own visibility switch in Admin.
- **Thresholds are settings, not constants.** Every number in Admin (alert thresholds, due-date days, reminder ladder, standing cutoffs) is stored and editable, effective from the next run.
- **Sensible, plain wording.** Copy in the mockup is intentionally plain and non-punitive ("alerts are about the numbers, not the person"). Keep it.

## Stack
Not decided. Kent chooses hosting. Prefer boring and maintainable by one person with Claude Code: server-rendered or a small SPA, one SQL database (Postgres or SQL Server), SSO via company sign-in, a scheduler for jobs. Ask Josh/Kent before locking this in. Do not add heavy infrastructure.

## Build order
1. Project skeleton, auth + roles (Admin, PIC, Finance view-only, Marketing director view-only, System admin), Admin shell.
2. Monthly job: run `sql/compass_negative_projects.sql` with `@RunPeriod`, write a **draft run** (+ warnings), email Josh.
3. Project Turnaround: Josh's review/publish; PIC view ("Just mine / Everyone"); Plan page and log; Check-in drafts queue.
4. Home ("Needs your attention", data checks, next runs).
5. Then BD report, then Pipeline watch (weekly snapshots).

## Testing
- Unit-test every status rule (plan status, BD status, standing). Fixed numbers are in the spec.
- Test the lock: a published run must reject every write. Test the append-only log: no UPDATE/DELETE path exists.
- Do not use real names/data in fixtures. The mockup's data is invented.

## The mockup is a design reference, not code to ship
`design/source-pages/*.dc.html` use a proprietary canvas runtime (`<x-dc>`, `{{ }}` bindings). Reuse the HTML structure and CSS; rewrite the logic in your stack. `design/portal-mockup.html` is a plain standalone file that runs in any browser.

## reference/chatgpt-engine-v0.1
An earlier draft calculation package from another tool. It has not been integrated or fully reviewed and it assumes a stack that may not match. Use only as a source of ideas. The SQL in `sql/` is the validated source of truth for profit math.
