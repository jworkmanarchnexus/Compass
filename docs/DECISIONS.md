# Decisions log

- 2026-10-11 (Josh): Compass is a **separate sister repo** (`Documents/GitHub/Compass`), not a Toolbox module. Reason: different roles and sensitive profit/performance data, own database.
- 2026-10-11 (Josh): Prototype uses the **same stack as the Toolbox** (Node + SQLite, plain JS, seeded fake data, sign-in-as picker). Kent still chooses the production stack (handoff open question 1).
- 2026-10-11: Handoff unpacked untouched into `reference/handoff/`. Its Python engine (`chatgpt-engine-v0.1`) is not adopted (open question 12).
- 2026-10-11: Design system **copied** from `../ToolBox/design-system` and `shared/design-system` (no shared package yet). Changes there must be re-copied by hand; revisit if it drifts.
- 2026-10-11: Port 5281 so Compass and the Toolbox can run together.
- Product placeholder: "Compass" is a working name (open question 10).

## Phase 1 decisions (2026-10-11)

- **Tables.** `employees` and `projects` are the Vantagepoint copy (loaded from CSV locally). `users` is Compass's People table (role, name used in drafts, link to a VP employee code). `settings` is effective-dated: saving adds a row and never overwrites, so a run can be reproduced with the settings it was built with. `audit_log` is append-only, enforced by two database triggers (a test proves UPDATE and DELETE are refused). `runs` and `run_warnings` exist but are unused until phase 2.
- **Roles are one pure, tested file** (`shared/rules/roles.js`, fixtures in `shared/rules/tests/fixtures/`). The server calls it on every Admin request; the browser only uses it to hide things. Same pattern as the Toolbox's permission rules.
- **System admin (Kent)**: can read every Admin tab except Commitment patterns, and change nothing. Reason: the handoff says he has no access to PIC content decisions, and the lever behind a commitment is exactly that. My reading, not stated outright.
- **Last-admin guard.** The last active Admin cannot be demoted or deactivated (otherwise nobody could change settings again). Not in the spec; cheap insurance.
- **Assumptions Josh should confirm** (they are settings on Admin → People, so nothing needs rebuilding): Finance sees Turnaround, BD and Pipeline; Marketing director sees BD and Pipeline only (handoff open question 2); PICs see Project Turnaround only, and the BD report and Pipeline watch are off for them (the spec does not say; the handoff open questions do not cover it).
- **Project numbers** in the seed use the mockup's format (`2024-0207`). The real Vantagepoint format is unconfirmed.
- **Admin tabs built:** Project Turnaround settings (the three cards from the mockup), People, Report runs (empty), Audit log. Reminders and standing, BD reports, Pipeline alerts and Commitment patterns show a "arrives in phase N" note.
- **"Active projects as PIC"** in People counts active Vantagepoint projects with that PIC. The mockup column counts Turnaround projects, which need a run; that arrives in phase 2.
- **Header name** `X-Compass-User` for the local sign-in-as, so Compass and the Toolbox never mistake each other's sign-in.
