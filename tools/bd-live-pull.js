'use strict';
/* Local test only: pull the BD report inputs live from Vantagepoint with the three verified statements
   (docs/BD-REVENUE-METHOD.md, docs/FORECAST-METHOD.md, docs/MWIP-METHOD.md) and print totals by PIC and by sector,
   to compare with a report built by hand the same day. Read-only account, one SELECT per statement.
   Raw rows are saved to discovery/data/protected/ (git-ignored). Never commit the output.

     node tools/bd-live-pull.js 202610 [factor, default 0.65]
   MWIP: Nov 1 for the October report (the month after the report month counts in full; docs/MWIP-METHOD.md rule 6), through Dec 31.                                                       */
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig, missing } = require('../server/vp/config');
const { open } = require('../server/vp/connection');
const { computeMwip, DEFAULT_OPTIONS } = require('../modules/bd/logic/mwip');

const period = Number(process.argv[2] || 202610);
const factor = Number(process.argv[3] || 0.65);
const asOf = new Date().toISOString().slice(0, 10); // the day the data was pulled (no history exists)
const year = Math.floor(period / 100), yearStart = year * 100 + 1;
const OUT = path.join(__dirname, '..', 'discovery', 'data', 'protected');

const PIC = "LTRIM(RTRIM(ISNULL(e.LastName, ''))) + ', ' + LTRIM(RTRIM(ISNULL(e.FirstName, '')))";
const SECTOR_JOIN = 'LEFT JOIN (SELECT Code, MIN(Description) AS Description FROM dbo.CFGProjectTypeDescriptions GROUP BY Code) t ON t.Code = p.ProjectType';

const REVENUE = `SELECT COALESCE(g.WBS1, k.WBS1) AS project, p.Name AS name, p.Principal AS pic_code, ${PIC} AS pic,
       ISNULL(t.Description, p.ProjectType) AS sector, ISNULL(g.gross, 0) AS gross, ISNULL(k.consultant, 0) AS consultant
FROM (SELECT WBS1, -SUM(Amount) AS gross FROM dbo.LedgerAR
      WHERE TransType = 'IN' AND ISNULL(SubType, '') <> 'R' AND Period BETWEEN ${yearStart} AND ${period} GROUP BY WBS1) g
FULL JOIN (SELECT x.WBS1, SUM(x.Amount) AS consultant
           FROM (SELECT WBS1, Account, Amount FROM dbo.LedgerAP WHERE Period BETWEEN ${yearStart} AND ${period}
                 UNION ALL SELECT WBS1, Account, Amount FROM dbo.LedgerEX WHERE Period BETWEEN ${yearStart} AND ${period}
                 UNION ALL SELECT WBS1, Account, Amount FROM dbo.LedgerMisc WHERE Period BETWEEN ${yearStart} AND ${period}) x
           JOIN (SELECT Account, MIN(Type) AS Type FROM dbo.CA GROUP BY Account) a ON a.Account = x.Account
           WHERE a.Type IN (8) GROUP BY x.WBS1) k ON k.WBS1 = g.WBS1
JOIN dbo.PR p ON p.WBS1 = COALESCE(g.WBS1, k.WBS1) AND p.WBS2 = '' AND p.WBS3 = ''
LEFT JOIN dbo.EMMain e ON e.Employee = p.Principal
${SECTOR_JOIN}`;

// gross forecast by start-date month, every month from January of the report year through December of the next (filtered in JS)
const FORECAST = `SELECT p.WBS1 AS project, p.Name AS name, p.Principal AS pic_code, ${PIC} AS pic, ISNULL(t.Description, p.ProjectType) AS sector,
       ISNULL(p.Fee, 0) AS fee, ISNULL(p.ConsultFee, 0) AS consult_fee, ISNULL(p.ReimbAllow, 0) AS reimb_allow,
       YEAR(r.StartDate) * 100 + MONTH(r.StartDate) AS month, SUM(r.PeriodCost) AS gross
FROM dbo.PR p
JOIN dbo.PNTask k ON k.WBS1 = p.WBS1
JOIN dbo.PNPlannedRevenueLabor r ON r.PlanID = k.PlanID AND r.TaskID = k.TaskID
LEFT JOIN dbo.EMMain e ON e.Employee = p.Principal
${SECTOR_JOIN}
WHERE p.WBS2 = '' AND p.WBS3 = '' AND p.Status = 'A' AND p.WBS1 NOT LIKE '[A-Za-z]%' AND r.StartDate >= '${year}0101' AND r.StartDate < '${year + 2}0101'
GROUP BY p.WBS1, p.Name, p.Principal, e.LastName, e.FirstName, t.Description, p.ProjectType, p.Fee, p.ConsultFee, p.ReimbAllow, YEAR(r.StartDate), MONTH(r.StartDate)`;

const MWIP = `SELECT p.WBS1 AS project, p.Name AS name, p.Principal AS pic_code, ${PIC} AS pic, ISNULL(t.Description, p.ProjectType) AS sector,
       ISNULL(p.Revenue, 0) AS revenue, ISNULL(p.WeightedRevenue, 0) AS weighted, p.Stage AS stage, p.Probability AS probability,
       CONVERT(varchar(10), p.EstStartDate, 120) AS est_start, CONVERT(varchar(10), p.EstCompletionDate, 120) AS est_completion
FROM dbo.PR p
LEFT JOIN dbo.EMMain e ON e.Employee = p.Principal
${SECTOR_JOIN}
WHERE p.WBS2 = '' AND p.WBS3 = '' AND p.WBS1 LIKE '[A-Za-z]%' AND p.Status = 'A' AND p.Probability > 0 AND p.Probability < 100`;

const cents = v => Math.round(Number(v || 0) * 100);
const $ = c => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

async function main() {
  const cfg = loadConfig();
  const gap = missing(cfg);
  if (gap.length) throw new Error('Missing in .env.vp: ' + gap.join(', '));
  cfg.rowLimit = 100000; cfg.queryTimeoutSeconds = 120;
  const vp = await open(cfg);
  const q = async (name, sql) => { const r = await vp.query(sql); if (r.truncated) throw new Error(name + ': row limit hit'); console.error(`${name}: ${r.rows.length} rows`); return r.rows; };
  let rev, fc, mw;
  try { rev = await q('revenue', REVENUE); fc = await q('forecast', FORECAST); mw = await q('mwip', MWIP); } finally { await vp.close(); }
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `bd-live-${period}-asof-${asOf}.json`);
  fs.writeFileSync(file, JSON.stringify({ period, asOf, pulledAt: new Date().toISOString(), revenue: rev, forecast: fc, mwip: mw }, null, 1));
  console.error('saved ' + file);

  // ---- totals ----
  const groups = { pic: new Map(), sector: new Map() };
  const add = (pic, sector, field, c) => {
    for (const [scope, key] of [['pic', pic || 'Unassigned'], ['sector', sector || 'Unassigned']]) {
      const m = groups[scope]; if (!m.has(key)) m.set(key, {}); const g = m.get(key); g[field] = (g[field] || 0) + c;
    }
  };
  for (const r of rev) { const g = cents(r.gross), k = cents(r.consultant); add(r.pic, r.sector, 'gross', g); add(r.pic, r.sector, 'consult', k); add(r.pic, r.sector, 'ytd', g - k); }

  // forecast: months after the report month through December; architectural share = (fee) / (fee + consultFee)
  const fcFrom = period + 1;
  for (const r of fc) {
    const m = Number(r.month); if (m < fcFrom || m > year * 100 + 12) continue;
    const g = cents(r.gross), fee = cents(r.fee), con = cents(r.consult_fee), den = fee + con;
    const arch = den > 0 && con >= 0 && con <= den ? Math.round(g * (den - con) / den) : g;
    add(r.pic, r.sector, 'fcGross', g); add(r.pic, r.sector, 'fcArch', arch);
  }

  // MWIP: the report's own calculation (modules/bd/logic/mwip.js) with the default options (Weighted Fee, spread evenly, monthly,
  // the month after the report month in full, through Dec 31). The source supplies pursuits exactly as Compass's source would.
  const pursuits = mw.map(r => ({ id: r.project, name: r.name, pic: r.pic, sector: r.sector, stage: r.stage == null ? '' : String(r.stage),
    estFee: cents(r.revenue), weightedFee: cents(r.weighted), estStart: r.est_start, estCompletion: r.est_completion }));
  const m = computeMwip({ pursuits, period, buildDate: asOf, options: DEFAULT_OPTIONS });
  const byId = Object.fromEntries(pursuits.map(p => [p.id, p]));
  for (const x of m.mwip) { add(byId[x.id].pic, byId[x.id].sector, 'mwipDec', x.amount); add(byId[x.id].pic, byId[x.id].sector, 'mwipF', Math.round(x.amount * factor)); }
  const skipped = m.leftOut.length;
  const winDec = m.months;

  const cols = [['gross', 'YTD gross'], ['consult', 'YTD consult'], ['ytd', 'YTD arch'], ['fcGross', 'Fcst gross'], ['fcArch', 'Fcst arch'], ['mwipDec', 'MWIP weighted'], ['mwipF', `MWIP x ${factor}`]];
  const print = (scope, title) => {
    const rows = [...groups[scope].entries()].sort((x, y) => x[0].localeCompare(y[0]));
    const firm = {}; for (const [, g] of rows) for (const [k] of cols) firm[k] = (firm[k] || 0) + (g[k] || 0);
    console.log(`\n${title}\n| ${scope === 'pic' ? 'PIC' : 'Sector'} | ${cols.map(c => c[1]).join(' | ')} |\n|---|${cols.map(() => '--:').join('|')}|`);
    for (const [k, g] of rows.concat([['**Firm**', firm]])) console.log(`| ${k} | ${cols.map(([c]) => $(g[c] || 0)).join(' | ')} |`);
  };
  console.log(`BD live pull, period ${period}, as of ${asOf}. Forecast months ${fcFrom}-${year}12. MWIP months ${winDec.join(',')} (first month in full), factor ${factor}. Pursuits skipped (stage/zero fee/no dates): ${skipped}.`);
  print('pic', 'By PIC');
  print('sector', 'By market sector (Vantagepoint project type)');
}

main().catch(e => { console.error(e.message); process.exit(1); });
