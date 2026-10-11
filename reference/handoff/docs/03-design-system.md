# Design system

The portal matches the **Nexus Toolbox Scheduler** app so tools feel like one family. The mockup already implements it; match it.

## Source of truth
- `design/assets/toolbox_scheduler.css`: the Scheduler app's full stylesheet (tokens + components).
- `design/portal-mockup.html`: all pages, standalone, click-through.
- `design/screens/`: 1440px screenshots.
- `design/source-pages/*.dc.html`: each page's markup and CSS block (inside `<helmet>`). The wrapper (`<x-dc>`, `{{ }}`, `<sc-if>`, `class Component extends DCLogic`) is a proprietary runtime. Ignore it; copy the HTML structure and CSS.

## Tokens (CSS custom properties; dark mode comes from token values)
`--nx-blue`, `--accent-text`, `--text-strong`, `--text-2`, `--surface`, `--surface-2`, `--line`, `--line-2`, `--line-strong`, `--crit/--ok/--warn` (+ `-bg`), `--accent-soft/-softer`, `--f-cond` (Roboto Condensed: headings, numbers, table headers), `--f-ui` (Lato: body).
Fonts: Lato 400/700 and Roboto Condensed 400/700 from Google Fonts. Self-host them in production (the mockup needs internet).

## Components
`.btn` (`.primary`, `.danger`), `.seg` segmented control/tabs, `.chip` (`.ok .warn .crit .blue .out`), `.banner`, `.avatar`, `.cnt` count badge, `.field/.txt`, `.nav-item`, `.phead`/`.ptitle h1.brand` (page title in blue, uppercase condensed), `.sec` section card, tables `table.dt/bd/pt`.
Charts are hand-built inline SVG using CSS variable colors (`--c-prev` last year, `--c-bar`, `--c-now`). Use any chart lib you like, but keep the colors and the "labels in thousands" convention. Always pair color with a label/pattern.

## Layout
App shell = fixed 230px left sidebar + content. Content pages: breadcrumb → page title → meta line → "Who sees this" chips → body. Cards over a light grey ground. Responsive: sidebar collapses on narrow widths; tables scroll inside their own container, never the page.

## Logo
`x_logo.png` / `x_logo_q.png` are small **raster** copies. Get the vector (SVG) from Arch Nexus brand files for production.

## Style rules
- Plain, calm copy. Numbers use tabular figures. Negative = red with a minus sign, never color alone.
- Never show the MWIP factor, lever, or lever amount to PICs.
- Status uses chips: Current (ok), Update due (warn), Overdue (crit), No plan (outline), On Track/On Pace/Behind Pace.
