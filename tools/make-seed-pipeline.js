'use strict';
/* Generates the MADE-UP Pipeline watch data used locally (server/db/seed/pipeline_*.csv). Deterministic; nothing real.

   Eight Monday snapshots (Aug 17 to Oct 5, 2026) of MWIP pursuits and contracted forecast, shaped like what the real pull would return
   and sized to the mockup: each PIC's MWIP total each week, Marcus's pursuit that dropped out with no project, Priya's that became a
   project, Priya's forecast moving into 2027. The local source filters these files by snapshot date, so the demo history is built by
   the same code that will take real snapshots every Monday.

     node tools/make-seed-pipeline.js */
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, '..', 'server', 'db', 'seed');
const DATES = ['2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05'];
const STAGES = ['Proposal sent', 'Interview', 'Shortlisted', 'Negotiating'];
const csv = rows => rows.map(r => r.map(v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(',')).join('\n') + '\n';
const N = null;

/* MWIP, $K. fixed: pursuits with their own weekly series (null = not in MWIP that week). fill: pursuits present all eight weeks that share what is left of the PIC's total. */
const MWIP = [
  { pic: 'E101', totals: [435, 430, 425, 418, 405, 392, 380, 372],
    fixed: [
      { id: '2026-0181', name: 'Draper Civic Plaza', series: [N, N, N, 30, 30, 30, 30, 30] },
      { id: '2026-0182', name: 'Orem Transit Hub', series: [N, N, N, N, N, 25, 25, 25] },
      { id: '2026-0183', name: 'Lindon Community Pool', series: [N, N, N, N, N, N, 20, 20] }],
    fill: ['Salt Lake Courts Annex', 'Murray Library Expansion', 'West Valley Rec Center', 'Sandy Senior Center'] },
  { pic: 'E102', totals: [262, 258, 255, 250, 238, 215, 190, 94],
    fixed: [
      { id: '2026-0212', name: 'Davis County Courthouse Annex', series: [262, 258, 255, 250, 178, 121, 96, N] },
      { id: '2026-0213', name: 'Clearfield Armory Addition', series: [N, N, N, N, 60, 60, 60, 60] },
      { id: '2026-0214', name: 'Tooele Water District Office', series: [N, N, N, N, N, 34, 34, 34] }],
    fill: [] },
  { pic: 'E103', totals: [415, 410, 400, 380, 340, 300, 260, 301],
    fixed: [
      { id: '2026-0147', name: 'Murray Parkway Retail', series: [60, 60, 60, 60, 60, 60, 60, N] },
      { id: '2026-0161', name: 'Sandy Rec Center', series: [N, N, N, N, 30, 30, 30, 30] },
      { id: '2026-0162', name: 'Lehi Elementary Gym', series: [N, N, N, N, N, 25, 25, 25] },
      { id: '2026-0163', name: 'Ogden Clinic Wing', series: [N, N, N, N, N, N, 20, 20] },
      { id: '2026-0164', name: 'Provo Innovation Lab', series: [N, N, N, N, N, N, N, 90] }],
    fill: ['St. George Hospital Tower', 'Heber Medical Office'] },
  { pic: 'E104', totals: [168, 165, 160, 150, 140, 128, 115, 112],
    fixed: [{ id: '2026-0191', name: 'Provo Fire Station', series: [N, N, 40, 40, 40, 40, 40, 40] }],
    fill: ['Logan Housing Block', 'Park City Fire House', 'Cedar City Courts'] },
  { pic: 'E105', totals: [133, 131, 130, 124, 115, 105, 95, 91],
    fixed: [{ id: '2026-0171', name: 'Bountiful Rec Center', series: [N, N, N, N, N, N, 15, 15] }],
    fill: ['Vernal Hospital Addition', 'Roosevelt Clinic', 'Moab Visitor Center'], winDrop: [60, 60, 60, 60, 60, 60, 60, 35] },
  { pic: 'E106', totals: [194, 192, 190, 184, 175, 162, 150, 148],
    fixed: [
      { id: '2026-0176', name: 'Kaysville Library', series: [N, N, N, N, N, 20, 20, 20] },
      { id: '2026-0177', name: 'Layton Fire Station 4', series: [N, N, N, N, N, N, 15, 15] }],
    fill: ['Tooele Community Center', 'Syracuse School Gym', 'Clinton Civic Center'] },
];

/* contracted forecast, $K per project. moved = the part scheduled for next year. */
const FORECAST = [
  { pic: 'E101', rows: [
    { wbs1: '2026-0301', name: 'Murray Clinic Phase 2', series: [180, 165, 150, 138, 126, 114, 102, 92] },
    { wbs1: '2026-0302', name: 'Salt Lake Courts Renovation', series: [140, 130, 120, 111, 102, 94, 86, 79] },
    { wbs1: '2026-0303', name: 'Draper Library Renovation', series: [N, N, N, N, N, 90, 84, 78] }] },
  { pic: 'E102', rows: [
    { wbs1: '2026-0311', name: 'Ogden City Hall', series: [210, 196, 183, 171, 160, 149, 139, 130] },
    { wbs1: '2026-0312', name: 'Weber State Lab', series: [90, 84, 78, 73, 68, 63, 58, 54] }] },
  { pic: 'E103', rows: [
    { wbs1: '2026-0321', name: 'Utah Valley Medical Pavilion', series: [330, 318, 306, 300, 300, 300, 300, 50], moved: [0, 0, 0, 0, 0, 0, 0, 250] },
    { wbs1: '2026-0322', name: 'American Fork Clinic', series: [120, 112, 105, 98, 92, 86, 80, 75] },
    { wbs1: '2026-0323', name: 'Lehi Tech Campus Lobby', series: [N, N, N, N, 70, 66, 62, 58] },
    { wbs1: '2026-0324', name: 'Pleasant Grove Office', series: [N, N, N, N, N, N, 60, 56] }] },
  { pic: 'E104', rows: [
    { wbs1: '2026-0331', name: 'Park City Housing', series: [100, 94, 88, 82, 77, 72, 67, 63] },
    { wbs1: '2026-0332', name: 'Cedar City Annex', series: [60, 56, 52, 49, 46, 43, 40, 37] }] },
  { pic: 'E105', rows: [
    { wbs1: '2026-0341', name: 'Vernal Courthouse', series: [95, 89, 83, 78, 73, 68, 64, 60] }] },
  { pic: 'E106', rows: [
    { wbs1: '2026-0351', name: 'Tooele Fire Station', series: [88, 82, 77, 72, 68, 64, 60, 56] },
    { wbs1: '2026-0352', name: 'Clearfield Library', series: [N, N, N, N, N, N, 70, 66] }] },
];

/* project numbers that exist, and when each was opened. A pursuit that leaves MWIP and has a project with its number "converted". */
const PROJECTS = [
  { wbs1: '2026-0147', name: 'Murray Parkway Retail', pic: 'E103', opened: '2026-10-02' },
  { wbs1: '2026-0301', name: 'Murray Clinic Phase 2', pic: 'E101', opened: '2026-03-12' },
  { wbs1: '2026-0302', name: 'Salt Lake Courts Renovation', pic: 'E101', opened: '2026-04-02' },
  { wbs1: '2026-0303', name: 'Draper Library Renovation', pic: 'E101', opened: '2026-09-18' },
  { wbs1: '2026-0311', name: 'Ogden City Hall', pic: 'E102', opened: '2026-02-20' },
  { wbs1: '2026-0312', name: 'Weber State Lab', pic: 'E102', opened: '2026-05-06' },
  { wbs1: '2026-0321', name: 'Utah Valley Medical Pavilion', pic: 'E103', opened: '2026-01-15' },
  { wbs1: '2026-0322', name: 'American Fork Clinic', pic: 'E103', opened: '2026-04-28' },
  { wbs1: '2026-0323', name: 'Lehi Tech Campus Lobby', pic: 'E103', opened: '2026-09-09' },
  { wbs1: '2026-0324', name: 'Pleasant Grove Office', pic: 'E103', opened: '2026-09-25' },
  { wbs1: '2026-0331', name: 'Park City Housing', pic: 'E104', opened: '2026-03-30' },
  { wbs1: '2026-0332', name: 'Cedar City Annex', pic: 'E104', opened: '2026-06-01' },
  { wbs1: '2026-0341', name: 'Vernal Courthouse', pic: 'E105', opened: '2026-05-19' },
  { wbs1: '2026-0351', name: 'Tooele Fire Station', pic: 'E106', opened: '2026-04-14' },
  { wbs1: '2026-0352', name: 'Clearfield Library', pic: 'E106', opened: '2026-09-22' },
];

const dollars = k => (k * 1000).toFixed(2);
const pursuitRows = [['Date', 'Pursuit', 'Name', 'Principal', 'Stage', 'WinProb', 'Amount']];
const forecastRows = [['Date', 'WBS1', 'Name', 'Principal', 'Amount', 'Moved']];
const projectRows = [['WBS1', 'Name', 'Principal', 'Opened']];

let nextId = 401;
for (const spec of MWIP) {
  const fillIds = spec.fill.map(() => `2026-0${nextId++}`);
  DATES.forEach((date, w) => {
    const fixedSum = spec.fixed.reduce((a, f) => a + (f.series[w] || 0), 0);
    const rem = spec.totals[w] - fixedSum;
    if (rem < 0 || (spec.fill.length === 0 && rem !== 0)) throw new Error(`${spec.pic} week ${w}: remainder ${rem}`);
    for (const f of spec.fixed) if (f.series[w] != null) pursuitRows.push([date, f.id, f.name, spec.pic, STAGES[0], 50, dollars(f.series[w])]);
    const weights = [0.4, 0.3, 0.2, 0.1].slice(0, spec.fill.length);
    const wsum = weights.reduce((a, b) => a + b, 0);
    let left = rem;
    spec.fill.forEach((name, i) => {
      const amt = i === spec.fill.length - 1 ? left : Math.round(rem * weights[i] / wsum);
      left -= amt;
      const win = i === 0 && spec.winDrop ? spec.winDrop[w] : 40 + 10 * (i % 4);
      pursuitRows.push([date, fillIds[i], name, spec.pic, STAGES[(i + 1) % STAGES.length], win, dollars(amt)]);
    });
  });
}
for (const spec of FORECAST) {
  DATES.forEach((date, w) => {
    for (const r of spec.rows) if (r.series[w] != null) forecastRows.push([date, r.wbs1, r.name, spec.pic, dollars(r.series[w]), dollars(r.moved ? r.moved[w] : 0)]);
  });
}
for (const p of PROJECTS) projectRows.push([p.wbs1, p.name, p.pic, p.opened]);

fs.writeFileSync(path.join(OUT, 'pipeline_pursuits.csv'), csv(pursuitRows));
fs.writeFileSync(path.join(OUT, 'pipeline_forecast.csv'), csv(forecastRows));
fs.writeFileSync(path.join(OUT, 'pipeline_projects.csv'), csv(projectRows));
console.log(`pipeline seed: ${pursuitRows.length - 1} pursuit rows, ${forecastRows.length - 1} forecast rows, ${projectRows.length - 1} projects`);
