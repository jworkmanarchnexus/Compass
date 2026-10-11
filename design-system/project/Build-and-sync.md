# Build and sync

## What is where
- `tokens.json`: every value. Editable on this page.
- `components/bundle.css`: shared component rules, written only in terms of tokens.
- `components/bundle.js`: `window.Toolbox` with icons, theme, density, side-bar, `h()` and `toast()` helpers.
- `fonts/`: Lato and Roboto Condensed, 400 and 700, woff2.
- `tools/`: scripts (see the downloadable package; they are not stored in this page).

## Producing app CSS
`python3 tools/build_css.py --inline-fonts --out toolbox.css` reads `tokens.json`, the fonts and `bundle.css` and writes one stylesheet: font faces, light tokens, dark tokens under both `[data-theme="dark"]` and the auto `prefers-color-scheme` block, then the component rules. The apps are single HTML files, so paste the output into the app's `<style>`.

The page itself compiles only the explicit `[data-theme]` blocks, so the auto-dark block exists only in the script's output. Do not hand-edit the generated CSS.

## Theme switching
Apps set `data-theme="light"` or `"dark"` on `<html>`, or remove the attribute for auto. `Toolbox.applyTheme(button)` and `Toolbox.cycleTheme(button)` do this and store the choice under `toolbox:theme`.

## Checks
- `python3 tools/contrast.py` lists text and ground pairs per theme against their floors. It currently reports 4 known misses (see the README, Known gaps).
- `python3 tools/audit.py app.html [...]` compares an app's declared tokens and classes with the system and flags drift.
