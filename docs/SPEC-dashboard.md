# PIC and PM dashboards (scaffolding)

Two dashboards, each a page a person arranges for themselves from dashparts Josh curates: the **PIC dashboard** and the **PM dashboard**. Built 2026-11-26 as scaffolding: the grid, edit mode and per-person saving are real and tested; **every dashpart draws made-up sample data**. Their real numbers will come from Vantagepoint (Josh, 2026-11-26), for the projects the person leads or manages.

Routes `#/dashboard/pic` and `#/dashboard/pm` (`#/dashboard` opens the first one the person has). Code: `modules/dashboard/` (logic, tests, ui), `server/dashboard.js`, `shared/platform/dashboard.js`.

## Who sees which (`modules/dashboard/logic/boards.js`, tested from `tests/fixtures/boards.json`)

Decided by Josh, 2026-11-26: it follows the projects, not the Compass role.
- **PIC dashboard** in the side bar if the person is principal in charge on at least one active project in the Vantagepoint copy (`projects.principal` = their employee code, status `A`).
- **PM dashboard** if they are project manager on at least one (`projects.proj_mgr`).
- Both if both; neither if neither (that item is not in the side bar, and the API refuses it with 403). It changes as soon as the next Vantagepoint copy changes their projects.
- The Admin always has both (my default, so Josh can see what people see; open question D4).
- Each dashboard has its own dashparts and its own saved arrangement.

## What a person can do

- **View mode.** The dashparts that are on, in a grid: 4 columns on a wide screen, 2 on a tablet, 1 on a phone. A dashpart with a full page elsewhere has an arrow at its top right that opens it (Turnaround, Marketing Report, Pipeline watch), shown only to people who may open that page.
- **Customize** (button in the header tile) starts edit mode. The dashparts jiggle (a dashed outline instead, for people who ask their computer for reduced motion).
  - **Move:** drag a dashpart. The others reshuffle as you go. Keyboard: focus a dashpart and use the arrow keys to move it earlier or later.
  - **Resize:** arrows on the right edge (narrower, wider) and the bottom edge (shorter, taller), one grid cell at a time, inside the limits for that dashpart. The dashpart redraws at the new size at once.
  - **What changes:** a line at the bottom of each dashpart says what it shows at its size. Hovering an arrow shows what it will show after that change ("Wider: ...") before you click.
  - **Put away:** the x at the top left (or drag it onto Available, or Delete on the keyboard). It goes to **Available** at the bottom, faded, with a small grey preview, its title and a sentence about it.
  - **Bring back:** the + on a dashpart in Available. It comes back at the bottom of the grid, at the size it had.
  - **Done** saves. **Cancel** (or Escape) puts everything back as it was. **Reset to default** puts back the starting set and sizes; it is saved only on Done.
- Saved per person on the server. Nobody sees or changes anyone else's arrangement, and the Admin has no screen for it.

## Rules (`modules/dashboard/logic/layout.js`, tested from `tests/fixtures/layout.json`)

- A layout is `{ version: 1, items: [{ id, w, h, on }] }`. Array order is the person's order; on ones first, then the tray.
- **Packing keeps the order.** Each dashpart takes the first free spot, reading row by row, at or after the spot of the one before it. So the grid always reads in the person's order and a drag lands where it was dropped. A gap can remain (for example after a wide dashpart); the person drags something into it. I chose this over "fill every gap" because with gap-filling a small dashpart dragged later jumps straight back into the earlier gap, so dragging seemed to do nothing.
- A dashpart wider than the grid (a 4-wide one on a tablet) is drawn at the grid's width; its saved size is kept for wide screens.
- Every saved layout is normalized on the server before it is stored and again when read: unknown or repeated dashparts dropped, sizes forced inside the limits, and any dashpart the person has never seen added to the end of Available, **off**. So adding a dashpart to the catalog later never changes anyone's page under them.

## The catalogs (`modules/dashboard/logic/catalog.js`)

One list per dashboard. Each dashpart has an id, title, one-sentence blurb, min and max width (1 to 4 columns) and height (1 to 3 rows), a default size, and whether a new person sees it on. Josh curates it; adding one is a catalog row plus a drawing in `ui/parts.js`.

**PIC dashboard**

| Dashpart | Sizes (w x h) | Default | On for a new person |
|---|---|---|---|
| My projects below break-even | 1-2 x 1-2 | 2 x 1 | yes |
| Revenue against goal | 1-4 x 1-2 | 1 x 1 | yes |
| Pipeline (MWIP) | 1-2 x 1-2 | 1 x 1 | yes |
| Portfolio: margin against fee (bubble chart) | 2-4 x 2-3 | 2 x 2 | yes |
| Fee by phase, planned against actual | 2-4 x 1-2 | 2 x 1 | yes |
| Unbilled work | 1-2 x 1-2 | 2 x 1 | yes |
| Staff mix by role (PIC, PM, PA, Production, Visualization) | 2-4 x 1-3 | 2 x 1 | no |
| Client scorecard | 2-4 x 2-3 | 2 x 2 | no |
| Where the fee goes (contract fee to collected) | 2-4 x 1-2 | 2 x 1 | no |

**PM dashboard** (confirmed by Josh, 2026-11-26)

| Dashpart | Sizes (w x h) | Default | On for a new person |
|---|---|---|---|
| Fee by phase, planned against actual | 2-4 x 1-2 | 2 x 2 | yes |
| Unbilled work | 1-2 x 1-2 | 2 x 1 | yes |
| Where the fee goes | 2-4 x 1-2 | 2 x 1 | yes |
| Staff mix by role | 2-4 x 1-3 | 4 x 1 | yes |

The same dashpart draws the same way on either dashboard; only the projects behind it will differ once it has real data.

## How a dashpart draws (`modules/dashboard/ui/parts.js`)

`render({ w, h, px, py })` draws for its size in cells and its exact pixel size, and draws **more** as it grows (more rows, axis labels, names on bubbles, more table columns, a second chart), never a stretched copy. `says(w, h)` is the plain sentence for edit mode. In edit mode the drawing is faded so the controls lead. Colors are classes in `ui/dashboard.css` built on brand tokens; nothing over or under is red.

## API

`GET /api/me` carries `dashboards`: `["pic"]`, `["pm"]`, both or none. `GET /api/dashboards/:board` (`pic` or `pm`) → `{ board, label, catalog, layout, saved, updatedAt }` (the default layout when nothing is saved). `PUT /api/dashboards/:board` with `{ layout }` saves (normalized against that dashboard's catalog first) or `{ reset: true }` removes the saved row. 403 for a dashboard the person does not have, 404 for one that does not exist. Table `dashboard_layouts` (one row per person per dashboard).

## Not built

- Real data. Every dashpart will read Vantagepoint (through the scheduled copy, never from the browser); exactly which tables and fields each needs is open question D2.
- Per-dashpart settings (for example which projects the bubble chart includes).
- The Admin curating the catalog on a screen (today it is a code file).
