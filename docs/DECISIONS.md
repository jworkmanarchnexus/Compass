# Decisions log

- 2026-10-11 (Josh): Compass is a **separate sister repo** (`Documents/GitHub/Compass`), not a Toolbox module. Reason: different roles and sensitive profit/performance data, own database.
- 2026-10-11 (Josh): Prototype uses the **same stack as the Toolbox** (Node + SQLite, plain JS, seeded fake data, sign-in-as picker). Kent still chooses the production stack (handoff open question 1).
- 2026-10-11: Handoff unpacked untouched into `reference/handoff/`. Its Python engine (`chatgpt-engine-v0.1`) is not adopted (open question 12).
- 2026-10-11: Design system **copied** from `../ToolBox/design-system` and `shared/design-system` (no shared package yet). Changes there must be re-copied by hand; revisit if it drifts.
- 2026-10-11: Port 5281 so Compass and the Toolbox can run together.
- Product placeholder: "Compass" is a working name (open question 10).
