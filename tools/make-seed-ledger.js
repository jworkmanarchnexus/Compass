'use strict';
/* Generates the MADE-UP Vantagepoint pull used locally: server/db/seed/ledger.csv and overhead.csv.
   Deterministic (fixed seed), so running it again gives identical files. Nothing here is real firm data.

   For each project, the Jan-Sep 2026 totals are set so the September 2026 run reproduces the mockup's
   year-to-date profit exactly (billed = |profit| / loss%, overhead rate fixed, expenses make up the remainder).
   2025 and the earlier 2026 months are plausible filler so the charts have history later.
   Run:  node tools/make-seed-ledger.js */
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, '..', 'server', 'db', 'seed');

/* [wbs1, ytd profit in dollars, loss % of billed (negative), overhead %] taken from the mockup's Turnaround screen */
const TARGETS = [
  ['2024-0207', -96800, -18.5, 150], ['2025-0187', -15160, -17.1, 160], ['2024-0356', -72400, -21.2, 150],
  ['2025-0098', -19540, -12.4, 170], ['2025-0230', -4310, -8.2, 150], ['2025-0412', -41250, -22.1, 160],
  ['2024-0388', -28730, -13.5, 150], ['2025-0173', -9860, -15.4, 170], ['2025-0291', -6120, -6.2, 150],
  ['2025-0301', -58900, -14.5, 160], ['2025-0144', -11420, -15.9, 150], ['2024-0420', -2950, -7.4, 170],
  ['2025-0266', -34880, -12.6, 150], ['2025-0121', -8640, -14.0, 160], ['2025-0334', -26300, -13.5, 150],
  ['2024-0399', -12780, -8.7, 170],
  // extras: a no-PIC loser, a profitable project (filtered out), and a PIC with a profitable job
  ['2025-0510', -7300, -9.1, 150], ['2025-0390', 22000, 7.0, 150],
];
// projects with special overhead situations: 2025-0455 has two rates (cannot be evaluated), 2025-0522 has no plan at all
const MIXED = '2025-0455', NO_PLAN = '2025-0522';

let seed = 20260911;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

const months2026 = [202601, 202602, 202603, 202604, 202605, 202606, 202607, 202608, 202609];
const months2025 = [202501, 202502, 202503, 202504, 202505, 202506, 202507, 202508, 202509, 202510, 202511, 202512];
const cents = d => Math.round(d * 100);
const money = c => (c / 100).toFixed(2);

/* split an integer total across months by the given weights; the last part takes the remainder.
   Billed, labor and expenses share one set of weights, so a project keeps about the same margin every month
   (a project that is in the red at September is also in the red at August, as the mockup's story needs). */
function split(total, weights, step) {
  const sum = weights.reduce((a, b) => a + b, 0);
  const parts = weights.map(x => Math.floor((total * x / sum) / step) * step);
  parts[parts.length - 1] += total - parts.reduce((a, b) => a + b, 0);
  return parts;
}
// two projects first fall below break-even in September (the mockup's "2 new"): profitable through August, then a bad month
const LATE_TURN = new Set(['2025-0230', '2024-0399']);

const rows = []; const overhead = [];
for (const [wbs1, profit, lossPct, oh] of TARGETS) {
  const billed = Math.round(Math.abs(profit) / Math.abs(lossPct) * 100);        // whole dollars
  // want: billed - L*(1+oh/100) - E = profit, L whole dollars, E whole cents, E about 10% of billed
  const targetE = billed * 0.10;
  const L = Math.round((billed - targetE - profit) / (1 + oh / 100));          // dollars
  const laborC = cents(L);
  const laborWithOh = laborC * (100 + oh) / 100;                                 // exact: laborC is a multiple of 100
  const E = cents(billed) - laborWithOh - cents(profit);                         // cents, exact remainder
  const w = Array.from({ length: 9 }, () => 0.5 + rnd());
  let b, l, e;
  if (LATE_TURN.has(wbs1)) {
    const B8 = Math.round(cents(billed) * 0.82), E8 = Math.round(B8 * 0.10);
    const L8 = Math.round((B8 - E8 - B8 * 0.03) / (1 + oh / 100) / 100) * 100; // a 3% profit through August
    const w8 = w.slice(0, 8);
    b = split(B8, w8, 1).concat([cents(billed) - B8]);
    l = split(L8, w8, 100).concat([laborC - L8]);
    e = split(E8, w8, 1).concat([E - E8]);
  } else {
    b = split(cents(billed), w, 1); l = split(laborC, w, 100); e = split(E, w, 1);
  }
  months2026.forEach((p, i) => rows.push([wbs1, p, b[i], l[i], e[i]]));
  // 2025 filler: a year of similar activity. Each project keeps one margin all year, between a 25% loss and an 8% profit,
  // so last year's grey bars on the charts have something to show (most projects lost money in 2025 too)
  const margin = -0.25 + 0.33 * rnd();
  months2025.forEach(p => {
    const bb = Math.round(cents(billed) / 9 * (0.7 + 0.6 * rnd()));
    const ll = Math.round(bb * ((1 - 0.08 - margin) / (1 + oh / 100)) / 100) * 100;
    rows.push([wbs1, p, bb, ll, Math.round(bb * 0.08)]);
  });
  overhead.push([wbs1, oh, oh]);
}
// Spanish Fork Clinic (mixed rates) and Kearns Pavilion (no plan): ordinary activity, no mockup target
for (const wbs1 of [MIXED, NO_PLAN]) {
  for (const p of months2025.concat(months2026)) {
    const bb = cents(30000 + 20000 * rnd());
    rows.push([wbs1, p, bb, Math.round(bb * 0.3 / 100) * 100, Math.round(bb * 0.08)]);
  }
}
overhead.push([MIXED, 150, 200]); // no row at all for NO_PLAN

rows.sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]);
fs.writeFileSync(path.join(OUT, 'ledger.csv'), 'WBS1,Period,Billed,Labor,Expenses\n' + rows.map(r => `${r[0]},${r[1]},${money(r[2])},${money(r[3])},${money(r[4])}`).join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'overhead.csv'), 'WBS1,MinOH,MaxOH\n' + overhead.map(o => o.join(',')).join('\n') + '\n');
console.log(`ledger.csv: ${rows.length} rows; overhead.csv: ${overhead.length} rows`);
