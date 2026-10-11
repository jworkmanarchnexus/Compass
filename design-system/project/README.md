This is the single source of truth for how every Arch Nexus Toolbox app looks. The Scheduler is the reference implementation; every value here was lifted from it unchanged. When a design decision changes, change it here first, then sync the apps (see the Working agreement and Build and sync sections).

## Principles
- Quiet and dense. Hairlines (`line`, `line-2`) over boxes, one accent, no heavy shadows. 4px grid, 32px controls (`ctl-h`).
- One meaning per color. `accent-text` is for links and primary actions, `ok` for done, `warn` for attention, `crit` for errors and destructive actions. Never reuse a state color for decoration.
- Brand values stay exact. Nexus Blue (`nx-blue`) is for graphics: bars, selection marks, the active-nav tab, focus. Text and buttons use the darker brand shade `accent-text` / `primary-bg` because Nexus Blue is only 3.2:1 on white.
- Every app supports light, dark and auto (follow the system). Use semantic tokens (`bg`, `surface`, `text`, `accent-text`), never `nx-*` values or hex, in component code.

## Color
- Page canvas is `bg`; cards, inputs, dialogs and menus are `surface`; quiet bands and the side bar are `surface-2`; table headers, chips and segmented tracks are `surface-3`.
- Body text is `text`; titles and row names `text-strong`; secondary text `text-2`. `text-3` is for placeholders, disabled text and quiet icons only (it is 3.0:1 on white).
- Borders on inputs and buttons are `line-strong`; dividers `line`; table row rules `line-2`.
- Selected rows and the current nav item use `accent-soft`; hover on rows uses `accent-softer`.
- Primary buttons are `primary-bg` with `primary-fg`. Destructive buttons are `crit` with white text.
- Status backgrounds pair with their text token: `info-bg`/`info`, `warn-bg`/`warn`, `ok-bg`/`ok`, `crit-bg`/`crit`. `warn-fill`, `ok-fill` and `nx-orange`/`nx-green` are fills for marks, never text.
- Chart and schedule fills may use the `nx-t*` tints and `nx-d*` shades; they never carry text.

## Typography
- Set body and controls in `body` (Lato 14px). Set page titles, headings, labels and every number in the Condensed group (`page-title`, `dialog-title`, `label`, `number`). Numbers use tabular figures (`.num`).
- Labels are uppercase condensed with tracking: `.lbl`, `.eyebrow`, and `.field > label`.
- Weights are 400 and 700 only. Do not add a third.
- Use CSS variables `--f-ui` and `--f-cond` for font families in app code (aliases of `--font-ui` and `--font-cond`).

## Spacing, radius, elevation
- Space in multiples of 4: `s1`–`s10`. Desktop page gutters are `s8` (32px), mobile `s4`.
- Radius: `r2` buttons, inputs and nav items; `r3` menus, cards, segmented controls; `r4` dialogs.
- Only menus, dialogs, drawers and toasts float (`shadow-2`). Nothing else gets a shadow except the raised segmented option (`shadow-1`).
- Focus: keyboard focus is a 2px `accent` outline; a focused text field also gets the `focus` halo.
- Motion is limited to 120–180ms fades and slides, and is removed under `prefers-reduced-motion`.

## Layout
- App frame is `.shell`: side bar (`--side-w` 232px, 60px collapsed) plus `.mainwrap`. Under 860px the side bar becomes a drawer behind a 48px top bar.
- Each page: `.phead` (breadcrumbs, `.ptitle`) then `.pbody`. Row height `--row-h` is 32px, 27px in dense mode (`body.dense`).

## Iconography
- Icons are Lucide, 24px grid, stroke 1.75, `currentColor`, inline SVG. Use `Toolbox.icon(name, size)` or `<i data-i="name" data-s="16"></i>` plus `Toolbox.hydrateIcons()`. Sizes: 16 in controls, 18 in nav. The icon set is `Toolbox.ICONS`; add new icons to the bundle, never an inline one-off.
- Icons are decorative unless given a label; icon-only buttons need `title` and `aria-label`.
- No emoji in the UI.

## Brand assets
- The Arch Nexus logo is `assets/Brand/arch-nexus-logo.png` (a transparent PNG with the dark X mark on a light ground). Keep it at least 96px wide with clear space of about 20% of its width. Never redraw, recolor or stretch it. There is no dark-theme variant yet; on dark surfaces it keeps its own ground, so request a reversed logo before shipping a dark-only screen with it.

## Voice
- Plain, specific, verb-first. Buttons say "Save schedule", not "OK". Errors say what happened and what is kept. Sentence case everywhere except uppercase labels.

## Known gaps (inherited from the Scheduler, not yet fixed)
- `line-strong` input borders are 1.7:1 on white, below the 3:1 non-text guideline.
- `text-2` on `surface-3` is 4.3:1 in light.
- `text-3` is 3.0:1 on white.
- Scheduler-only tokens (bars, weekends, holidays, audience colors, preset colors) live in the Scheduler until a second app needs them.
