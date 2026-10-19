'use strict';
/* Adds the MONTHLY shape to the made-up BD data (server/db/seed/bd_forecast_months.csv and bd_mwip_months.csv). Deterministic; nothing real.

   The Marketing Report's drill-downs show, for each project (forecast) and pursuit (MWIP), what is expected in each remaining month of the
   year. The totals already in bd_forecast.csv and bd_mwip.csv do not change: each is split across the remaining months with a gentle,
   repeatable wobble, and the pieces add back to the total to the cent. Pursuits also get names here.
   Run (after tools/make-seed-bd.js):  node tools/make-seed-bd-months.js */
const fs = require('node:fs');
const path = require('node:path');
const { parseCsv } = require('../server/csv');
const { spread, remainingMonths } = require('../modules/bd/logic/drill');

const SEED = path.join(__dirname, '..', 'server', 'db', 'seed');
const read = f => parseCsv(fs.readFileSync(path.join(SEED, f), 'utf8'));
const cents = s => Math.round(parseFloat(s) * 100);
const dollars = c => (c / 100).toFixed(2);
const csv = rows => rows.map(r => r.join(',')).join('\n') + '\n';
const hash = s => [...s].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);

const forecastRows = [['Period', 'WBS1', 'Month', 'Amount']];
for (const r of read('bd_forecast.csv')) {
  const months = remainingMonths(Number(r.Period));
  const h = hash(r.WBS1);
  const parts = spread(cents(r.Amount), months.map((m, i) => 1 + ((h + i * 7) % 5) / 10));
  months.forEach((m, i) => forecastRows.push([r.Period, r.WBS1, m, dollars(parts[i])]));
}

const PLACES = ['Murray', 'Sandy', 'Provo', 'Ogden', 'Layton', 'Orem', 'Lehi', 'Draper', 'Logan', 'Park City', 'Tooele', 'Heber', 'Vernal', 'Moab'];
const TYPES = {
  Healthcare: ['Clinic Expansion', 'Medical Pavilion', 'Surgery Center', 'Urgent Care'],
  Civic: ['City Hall Annex', 'Fire Station', 'Library', 'Recreation Center'],
  'Federal and industrial': ['Maintenance Hangar', 'Armory Addition', 'Warehouse', 'Test Facility'],
  Commercial: ['Office Renovation', 'Retail Center', 'Mixed-Use Building', 'Tenant Improvement'],
  Education: ['Elementary School', 'Science Wing', 'Student Center', 'Gymnasium'],
  Other: ['Community Hall', 'Visitor Center', 'Housing Block', 'Chapel'],
};
const mwipRows = [['Period', 'Pursuit', 'Name', 'Month', 'Amount']];
const names = new Map();
for (const r of read('bd_mwip.csv')) {
  const h = hash(r.Pursuit);
  if (!names.has(r.Pursuit)) { const t = TYPES[r.Sector] || TYPES.Other; names.set(r.Pursuit, `${PLACES[h % PLACES.length]} ${t[(h >> 3) % t.length]}`); }
  const months = remainingMonths(Number(r.Period));
  const parts = spread(cents(r.Amount), months.map((m, i) => 1 + ((h + i * 5) % 4) / 10));
  months.forEach((m, i) => mwipRows.push([r.Period, r.Pursuit, names.get(r.Pursuit), m, dollars(parts[i])]));
}
fs.writeFileSync(path.join(SEED, 'bd_forecast_months.csv'), csv(forecastRows));
fs.writeFileSync(path.join(SEED, 'bd_mwip_months.csv'), csv(mwipRows));
console.log(`bd months: ${forecastRows.length - 1} forecast rows, ${mwipRows.length - 1} mwip rows`);
