The list table is the dense, sortable list for records (`.plist`): fixed layout, sticky 11.5px condensed headers, 46px rows, row rules in `line-2`, hover tint `accent-softer`. Sorted headers carry `aria-sort`; row actions appear on hover or focus.

Define column widths per app with `<col>` rules (`.plist col.c-name { width: ... }`); the system does not ship column widths. For small sets of cards use `.recent` and `.rcard`; for nothing-yet states use `.empty-note`.
