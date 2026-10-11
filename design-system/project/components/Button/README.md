Buttons start an action. One primary per view, everything else default or quiet.

**Variants:** default, `primary` (Nexus Blue shade fill, `primary-fg` label), `quiet` (no border until hover, for toolbars), `danger` (`crit` fill, destructive and irreversible only), `icon` (square, `--ctl-h` wide, needs `title` and `aria-label`). Sizes: `sm` 28px, default 32px, `lg` 38px.

**Do**
- Label with a verb: "Save schedule", "Export PDF".
- Put the primary on the right in dialog footers (`.dlg-act`).
- Use `aria-pressed="true"` for a toggle button; it gets the `accent-soft` fill and `accent` border.
- Use `.ib` (26px, no border) for per-row actions inside tables.

**Don't**
- Put two primaries in one view.
- Use `danger` for "Cancel" or "Close". It means data is lost.
- Recolor a button with an inline style. Add a variant to the system first.
