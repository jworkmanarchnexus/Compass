# Compass: handoff package

Compass is Archnexus's internal portal (by Arch Nexus). Modules: **Project Turnaround**, **BD report**, **Pipeline watch**, **Admin**, plus a **Home** page.
This package is everything needed to build the real, hosted version outside Claude.ai.

**Start here:** read `CLAUDE.md`, then `docs/01-product-spec.md`. Open `design/portal-mockup.html` in a browser and click through it. It is a clickable mockup with sample data.

| Path | What it is |
|---|---|
| `CLAUDE.md` | Instructions and hard rules for Claude Code |
| `docs/01-product-spec.md` | What each page does and every rule that was decided |
| `docs/02-data-model.md` | Proposed tables, and what comes from Vantagepoint vs what Compass owns |
| `docs/03-design-system.md` | Visual language (matches the Nexus Toolbox Scheduler app) and how to read the mockup source |
| `docs/04-open-questions.md` | Unresolved decisions. Do not guess these |
| `sql/compass_negative_projects.sql` | Validated Vantagepoint query (August 2026 totals matched the Excel report) |
| `design/portal-mockup.html` | Standalone clickable mockup of all pages |
| `design/screens/*.png` | Screenshots at 1440px |
| `design/source-pages/*.dc.html` | Markup and CSS of each page. Reference for HTML structure; see `docs/03` |
| `design/assets/` | Toolbox CSS, logo rasters, font stylesheet |
| `reference/chatgpt-engine-v0.1/` | An earlier, unintegrated draft of a calculation engine. Ideas only; see `CLAUDE.md` |

Everything in the mockup is **sample data**. The people, projects and dollar figures are invented.
