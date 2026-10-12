'use strict';
/* Generates the MADE-UP business-development data used locally (server/db/seed/bd_*.csv). Deterministic; nothing real.

   It is shaped like what the Vantagepoint pull would return (projects with a principal and a market sector, monthly
   revenue net of consultants, contracted forecast, and pursuits not yet contracted) and sized so the September 2026 report
   reproduces the mockup's BD screen exactly: PIC and sector totals are the mockup's, and every project belongs to one of each.
   Special cases, on purpose: a project with NO sector ($3,420 of YTD revenue, the "unassigned" warning), and a project coded
   "Labs" (rolled into Healthcare through 2026).
   Run:  node tools/make-seed-bd.js */
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'server', 'db', 'seed');

const PICS = ['E101', 'E102', 'E103', 'E104', 'E105', 'E106'];
const SECTORS = ['Healthcare', 'Civic', 'Federal and industrial', 'Commercial', 'Education', 'Other'];
// $K, from the mockup (PIC rows, sector rows)
const T = {
  ytd: [[1742, 1520, 2310, 1365, 1085, 910], [2380, 2010, 1640, 1456, 905, 541]],
  forecast: [[410, 330, 520, 205, 160, 150], [480, 395, 360, 270, 190, 80]],
  mwip: [[380, 190, 260, 115, 95, 150], [330, 215, 270, 205, 110, 60]], // weighted, at the 0.67 factor
};
const GOALS = { pic: [2400, 2100, 3000, 1800, 1500, 1200], sector: [3200, 2600, 2400, 1900, 1200, 700] };
const FACTOR_BP = 6700;

let seed = 7771;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

/* a non-negative integer matrix with the given row and column sums (iterative proportional fitting, then integer repair) */
function fit(rows, cols) {
  const n = rows.length, m = cols.length;
  let M = Array.from({ length: n }, () => Array.from({ length: m }, () => 0.4 + rnd()));
  for (let it = 0; it < 200; it++) {
    for (let i = 0; i < n; i++) { const s = M[i].reduce((a, b) => a + b, 0); M[i] = M[i].map(v => v * rows[i] / s); }
    for (let j = 0; j < m; j++) { const s = M.reduce((a, r) => a + r[j], 0); for (let i = 0; i < n; i++) M[i][j] *= cols[j] / s; }
  }
  const I = M.map(r => r.map(Math.round));
  for (let guard = 0; guard < 100000; guard++) {
    const r = rows.map((t, i) => t - I[i].reduce((a, b) => a + b, 0));
    const c = cols.map((t, j) => t - I.reduce((a, row) => a + row[j], 0));
    if (r.every(x => x === 0) && c.every(x => x === 0)) return I;
    const ri = r.findIndex(x => x > 0), rn = r.findIndex(x => x < 0), cj = c.findIndex(x => x > 0), cn = c.findIndex(x => x < 0);
    if (ri >= 0 && cj >= 0) I[ri][cj]++;
    else if (rn >= 0 && cn >= 0 && I[rn][cn] > 0) I[rn][cn]--;
    else if (ri >= 0 && rn >= 0) { const j = c.findIndex((_, jj) => I[rn][jj] > 0); I[ri][j]++; I[rn][j]--; }
    else if (cj >= 0 && cn >= 0) { const i = r.findIndex((_, ii) => I[ii][cn] > 0); I[i][cj]++; I[i][cn]--; }
    else throw new Error('could not balance');
  }
  throw new Error('no convergence');
}
const M = { ytd: fit(...T.ytd), forecast: fit(...T.forecast), mwip: fit(...T.mwip) };

/* split a cent total into n parts (random weights); the last takes the remainder */
function split(total, n) {
  const w = Array.from({ length: n }, () => 0.5 + rnd()); const s = w.reduce((a, b) => a + b, 0);
  const parts = w.map(x => Math.floor(total * x / s));
  parts[n - 1] += total - parts.reduce((a, b) => a + b, 0);
  return parts;
}
const NAMES = {
  Healthcare: ['Clinic', 'Medical Office', 'Surgical Center', 'Imaging Suite', 'Behavioral Health Center'],
  Civic: ['Library', 'Fire Station', 'Community Center', 'City Hall', 'Recreation Center'],
  'Federal and industrial': ['Maintenance Hangar', 'Distribution Warehouse', 'Training Facility', 'Manufacturing Annex', 'Logistics Depot'],
  Commercial: ['Office Fit-Out', 'Retail Center', 'Corporate Campus', 'Hotel Lobby', 'Mixed-Use Building'],
  Education: ['Elementary Addition', 'Science Wing', 'Student Center', 'Dormitory', 'Gymnasium'],
  Other: ['Chapel', 'Museum Annex', 'Pavilion', 'Visitor Center', 'Parking Structure'],
};
const PLACES = ['Ogden', 'Provo', 'Lehi', 'Draper', 'Sandy', 'Orem', 'Logan', 'Murray', 'Layton', 'Heber', 'Moab', 'Vernal', 'Cedar City', 'Tooele', 'Park City', 'Bountiful'];

const projects = [], revenue = [], forecastSep = [], mwipSep = [];
let n = 0;
const months = [202601, 202602, 202603, 202604, 202605, 202606, 202607, 202608, 202609];
const cents = k => k * 100000; // $K -> cents
const LABS_YTD = cents(210);      // Dana's Labs project, counted in Healthcare
const UNASSIGNED_YTD = 342000;    // $3,420, Tom's project with no sector

PICS.forEach((pic, i) => {
  SECTORS.forEach((sector, j) => {
    let ytd = cents(M.ytd[i][j]), fc = cents(M.forecast[i][j]), mw = cents(M.mwip[i][j]);
    if (!ytd && !fc && !mw) return;
    if (i === 3 && sector === 'Civic') ytd -= UNASSIGNED_YTD;            // it comes back when the Admin assigns that project to Civic
    const count = ytd > cents(900) ? 3 : 2;
    const ytdParts = split(ytd - (i === 0 && sector === 'Healthcare' ? LABS_YTD : 0), count), fcParts = split(fc, count);
    const made = [];
    for (let k = 0; k < count; k++) {
      n++;
      const wbs1 = `2025-${String(1000 + n)}`;
      made.push(wbs1);
      projects.push({ wbs1, name: `${PLACES[(n * 7) % PLACES.length]} ${NAMES[sector][k % NAMES[sector].length]}`, pic, sector });
      const w = months.map(() => 0.4 + rnd()); const ws = w.reduce((a, b) => a + b, 0);
      const monthly = w.map(x => Math.floor(ytdParts[k] * x / ws)); monthly[8] += ytdParts[k] - monthly.reduce((a, b) => a + b, 0);
      months.forEach((p, idx) => revenue.push({ wbs1, period: p, amount: monthly[idx] }));
      forecastSep.push({ wbs1, amount: fcParts[k] });
    }
    // pursuits: raw amounts that weight (at 0.67) to the target
    const pcount = mw > cents(200) ? 2 : 1; const mwParts = split(mw, pcount);
    mwParts.forEach((wt, k) => { n++; mwipSep.push({ id: `P-${String(n).padStart(4, '0')}`, pic, sector, amount: Math.round(wt * 10000 / FACTOR_BP) }); });
  });
});
// the two special projects
if (true) {
  n++;
  const labs = `2025-${1000 + n}`;
  projects.push({ wbs1: labs, name: 'Provo Research Laboratory', pic: 'E101', sector: 'Labs' });
  const w = months.map(() => 0.4 + rnd()); const ws = w.reduce((a, b) => a + b, 0);
  const monthly = w.map(x => Math.floor(LABS_YTD * x / ws)); monthly[8] += LABS_YTD - monthly.reduce((a, b) => a + b, 0);
  months.forEach((p, idx) => revenue.push({ wbs1: labs, period: p, amount: monthly[idx] }));
  n++;
  const un = `2025-${1000 + n}`;
  projects.push({ wbs1: un, name: 'Midvale Storage Pavilion', pic: 'E104', sector: '' });
  revenue.push({ wbs1: un, period: 202609, amount: UNASSIGNED_YTD });
}

const money = c => (c / 100).toFixed(2);
const write = (file, head, rows) => fs.writeFileSync(path.join(OUT, file), head + '\n' + rows.join('\n') + '\n');
write('bd_projects.csv', 'WBS1,Name,Principal,Sector', projects.map(p => `${p.wbs1},${p.name},${p.pic},${p.sector}`));
write('bd_revenue.csv', 'WBS1,Period,Amount', revenue.map(r => `${r.wbs1},${r.period},${money(r.amount)}`));
// the forecast and pursuits are snapshots "as of" each report month; August is the September numbers a little bigger
const fcRows = [], mwRows = [];
for (const [period, fF, fM] of [[202609, 1, 1], [202608, 1.06, 1.1]]) {
  forecastSep.forEach(f => fcRows.push(`${period},${f.wbs1},${money(Math.round(f.amount * fF))}`));
  mwipSep.forEach(m => mwRows.push(`${period},${m.id},${m.pic},${m.sector},${money(Math.round(m.amount * fM))}`));
}
write('bd_forecast.csv', 'Period,WBS1,Amount', fcRows);
write('bd_mwip.csv', 'Period,Pursuit,Principal,Sector,Amount', mwRows);
write('bd_goals.csv', 'Year,Scope,Key,Amount,Sort', [
  ...PICS.map((p, i) => `2026,pic,${p},${GOALS.pic[i] * 1000},${i + 1}`), ...SECTORS.map((s, i) => `2026,sector,${s},${GOALS.sector[i] * 1000},${i + 1}`)]);
write('bd_sectors.csv', 'Name,Sort,RollsInto,RollsUntil', [...SECTORS.map((s, i) => `${s},${i + 1},,`), 'Labs,7,Healthcare,2026-12-31']);
write('bd_factor.csv', 'EffectiveFrom,FactorBp', ['2025-01-01,6500', '2026-01-01,6700']);
console.log(`bd: ${projects.length} projects, ${revenue.length} revenue rows, ${forecastSep.length} forecast, ${mwipSep.length} pursuits`);
