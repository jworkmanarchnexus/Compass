/* ===== My dashboards: the curated dashparts, one list per dashboard (PIC, PM; see boards.js) =====
   Josh curates these lists; a person can only turn these on or off, move them, and resize them within the limits here.
   Sizes are in grid cells: w = columns (the grid has 4 on a wide screen), h = rows. min/max are inclusive.
   `on` is whether a new person sees it on their first visit. A dashpart added later starts off (in the "Available" tray)
   for everyone who already has a saved layout, so nobody's page changes under them.
   Pure data: the server validates saved layouts against it, the browser draws the tray from it. */
'use strict';

const PIC = [
  { id: 'turnaround', title: 'My projects below break-even', blurb: 'Your listed projects, year-to-date profit, and where each plan stands.', minW: 1, maxW: 2, minH: 1, maxH: 2, w: 2, h: 1, on: true },
  { id: 'revenue', title: 'Revenue against goal', blurb: 'Your principal revenue this year against your goal and pace.', minW: 1, maxW: 4, minH: 1, maxH: 2, w: 1, h: 1, on: true },
  { id: 'pipeline', title: 'Pipeline (MWIP)', blurb: 'Weighted pursuits still to win this year, week by week.', minW: 1, maxW: 2, minH: 1, maxH: 2, w: 1, h: 1, on: true },
  { id: 'bubble', title: 'Portfolio: margin against fee', blurb: 'Each project by fee size and margin. Bubble size is hours spent; color is market sector.', minW: 2, maxW: 4, minH: 2, maxH: 3, w: 2, h: 2, on: true },
  { id: 'phase', title: 'Fee by phase, planned against actual', blurb: 'Where the fee went by phase (SD, DD, CD, Bidding, CA) against the plan.', minW: 2, maxW: 4, minH: 1, maxH: 2, w: 2, h: 1, on: true },
  { id: 'unbilled', title: 'Unbilled work', blurb: 'Work done but not yet invoiced, by how long it has waited.', minW: 1, maxW: 2, minH: 1, maxH: 2, w: 2, h: 1, on: true },
  { id: 'staffmix', title: 'Staff mix by role', blurb: 'Share of hours by role on your projects, against the firm.', minW: 2, maxW: 4, minH: 1, maxH: 3, w: 2, h: 1, on: false },
  { id: 'clients', title: 'Client scorecard', blurb: 'Revenue, margin, days to pay and repeat work for your clients.', minW: 2, maxW: 4, minH: 2, maxH: 3, w: 2, h: 2, on: false },
  { id: 'leakage', title: 'Where the fee goes', blurb: 'Contract fee to hours charged, billed, written off and collected.', minW: 2, maxW: 4, minH: 1, maxH: 2, w: 2, h: 1, on: false },
];

/* the PM dashboard: running the work on the projects they manage. The same dashpart (id) draws the same way on either. */
const PM = [
  { id: 'phase', title: 'Fee by phase, planned against actual', blurb: 'Where the fee went by phase (SD, DD, CD, Bidding, CA) against the plan, on the projects you manage.', minW: 2, maxW: 4, minH: 1, maxH: 2, w: 2, h: 2, on: true },
  { id: 'unbilled', title: 'Unbilled work', blurb: 'Work done on your projects but not yet invoiced, by how long it has waited.', minW: 1, maxW: 2, minH: 1, maxH: 2, w: 2, h: 1, on: true },
  { id: 'leakage', title: 'Where the fee goes', blurb: 'Contract fee to hours charged, billed, written off and collected, on the projects you manage.', minW: 2, maxW: 4, minH: 1, maxH: 2, w: 2, h: 1, on: true },
  { id: 'staffmix', title: 'Staff mix by role', blurb: 'Share of hours by role on the projects you manage, against the firm.', minW: 2, maxW: 4, minH: 1, maxH: 3, w: 4, h: 1, on: true },
];

const CATALOGS = { pic: PIC, pm: PM };
const catalogApi = { CATALOGS };
if (typeof module !== 'undefined' && module.exports) module.exports = catalogApi;
else if (typeof window !== 'undefined') window.CompassDashboard = Object.assign(window.CompassDashboard || {}, catalogApi);
