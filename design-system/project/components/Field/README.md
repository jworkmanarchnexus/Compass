Form controls: text input, select, textarea, checkbox, radio, and the labeled `.field` wrapper.

Every input is 32px tall (`--ctl-h`), 1px `line-strong` border, `r2` radius. Focus swaps the border to `accent` and adds the `focus` halo. Labels are condensed, 12px, uppercase (`.field > label`). Hints sit below in `text-2` at 12.5px.

**Do**
- Wrap each control in `.field` with a visible `<label>`; placeholders never replace labels.
- Use `.form` for a vertical stack with 12px gaps; use `.searchbox` with a leading `search` icon for search.
- Use `.txt.sm` (28px) only inside dense tables.

**Don't**
- Style a bare `<input>`; always give it `.txt`.
- Rely on `text-3` placeholder color to carry required information.
