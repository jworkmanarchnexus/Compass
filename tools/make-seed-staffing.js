'use strict';
/* Generates the MADE-UP Staffing projections data used locally (server/db/seed/staffing_*.csv). Deterministic; nothing real.

   staffing_categories.csv  each Vantagepoint billing category and how many people are on staff in it. The category codes and
                            titles are the firm's (Josh grouped them into levels on 2026-11-27); the head counts are made up.
                            BIM Manager has one made-up person so the page shows what happens to a category in no level.
   staffing_rates.csv       a billing rate per category, two effective dates (made up, not the firm's rates).
   staffing_demand.csv      architectural revenue by month: contracted projects (the PMs' forecast) and pursuits weighted by win
                            probability, Nov 2026 to Dec 2027. Shaped like a real forecast: full in the near months, thinning out later
                            as PMs plan less far ahead, with pursuits filling in.

     node tools/make-seed-staffing.js */
const fs = require('node:fs');
const path = require('node:path');
const { parseCsv } = require('../server/csv');

const OUT = path.join(__dirname, '..', 'server', 'db', 'seed');
const csv = rows => rows.map(r => r.map(v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(',')).join('\n') + '\n';

// code, title, made-up head count, made-up rate ($/h from Aug 2025; Aug 2026 is 4% more, rounded to $5)
const CATS = [
  ['2', 'Sr Principal Architect', 4, 250], ['5', 'Principal Architect', 6, 215],
  ['13', 'Sr Project Manager', 5, 190], ['32', 'Project Manager', 9, 170],
  ['42', 'Sr Project Architect', 2, 165], ['8', 'Project Architect', 5, 150],
  ['16', 'Job Captain', 8, 135], ['46', 'Architect', 5, 130],
  ['34', 'Design Professional', 7, 110], ['18', 'Intern Architect', 2, 90], ['40', 'Production', 2, 100],
  ['15', 'Sr Interior Designer', 2, 145], ['17', 'Interior Designer', 3, 115],
  ['14', 'Sr Graphic Designer', 1, 130], ['19', 'Graphic Designer', 1, 105],
  ['11', 'Info Tech', 2, null], ['37', 'Administration', 8, null], ['45', 'Building Performance Analyst', 1, 140],
  ['47', 'Sr Principal CFO', 1, null], ['36', 'Principal Communications', 1, null],
  ['38', 'BIM Manager', 1, 140],
];

let seed = 20261127;
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const MONTHS = [];
for (let y = 2026, m = 11; MONTHS.length < 14; m++) { if (m > 12) { m = 1; y++; } MONTHS.push(y * 100 + m); }

const projects = parseCsv(fs.readFileSync(path.join(OUT, 'bd_projects.csv'), 'utf8')).slice(0, 30);
const pursuitNames = [...new Map(parseCsv(fs.readFileSync(path.join(OUT, 'bd_mwip_months.csv'), 'utf8'))
  .filter(r => !/undefined/.test(r.Name)).map(r => [r.Pursuit, r.Name])).entries()].slice(0, 16);

// contracted: each project runs from now to an end month, tapering in its last months
const contracted = projects.map((p, i) => {
  const ends = 2 + Math.floor(rand() * (i < 6 ? 13 : 9));   // a few long projects, most ending within the year
  const size = 0.4 + rand() * 1.6;
  return { id: p.WBS1, name: p.Name, amounts: MONTHS.map((_, k) => k > ends ? 0 : size * (k >= ends - 1 ? 0.55 : 1) * (0.9 + rand() * 0.2)) };
});
// pursuits: start between 1 and 8 months out, run 5 to 12 months, already weighted by win probability
const pursuits = pursuitNames.map(([id, name]) => {
  const start = 1 + Math.floor(rand() * 8), len = 5 + Math.floor(rand() * 8), size = 0.3 + rand() * 1.2;
  return { id, name, amounts: MONTHS.map((_, k) => k < start || k >= start + len ? 0 : size * (k === start ? 0.5 : 1)) };
});
// scale: contracted about $1.22M in the first month, pursuits peaking near $0.42M
const scaleTo = (rows, k, want) => { const have = rows.reduce((a, r) => a + r.amounts[k], 0); for (const r of rows) r.amounts = r.amounts.map(v => v * want / have); };
scaleTo(contracted, 0, 1220000);
const peak = Math.max(...MONTHS.map((_, k) => pursuits.reduce((a, r) => a + r.amounts[k], 0)));
for (const r of pursuits) r.amounts = r.amounts.map(v => v * 420000 / peak);

const demand = [['Kind', 'Id', 'Name', 'Month', 'Amount']];
for (const [kind, rows] of [['contract', contracted], ['pursuit', pursuits]]) {
  for (const r of rows) r.amounts.forEach((v, k) => { if (v >= 1) demand.push([kind, r.id, r.name, MONTHS[k], v.toFixed(2)]); });
}
fs.writeFileSync(path.join(OUT, 'staffing_demand.csv'), csv(demand));
fs.writeFileSync(path.join(OUT, 'staffing_categories.csv'), csv([['Code', 'Title', 'Staff']].concat(CATS.map(c => [c[0], c[1], c[2]]))));
const rates = [['Category', 'Rate', 'Effective']];
for (const c of CATS) if (c[3]) rates.push([c[0], c[3].toFixed(2), '2025-08-01'], [c[0], (Math.round(c[3] * 1.04 / 5) * 5).toFixed(2), '2026-08-01']);
fs.writeFileSync(path.join(OUT, 'staffing_rates.csv'), csv(rates));
console.log(`staffing seed: ${demand.length - 1} demand rows, ${CATS.length} categories, ${rates.length - 1} rates`);
