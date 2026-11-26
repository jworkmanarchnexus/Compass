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
const { statements } = require('../server/vp/bd-statements');
const { computeMwip, DEFAULT_OPTIONS } = require('../modules/bd/logic/mwip');
const { computeForecast } = require('../modules/bd/logic/forecast');
const { architecturalAmount } = require('../modules/bd/logic/architectural');

const period = Number(process.argv[2] || 202610);
const factor = Number(process.argv[3] || 0.65);
const asOf = new Date().toISOString().slice(0, 10); // the day the data was pulled (no history exists)
const year = Math.floor(period / 100);
const OUT = path.join(__dirname, '..', 'discovery', 'data', 'protected');

// the same fixed statements the pull job uses (server/vp/bd-statements.js)
const SQL = statements(period);

const cents = v => Math.round(Number(v || 0) * 100);
const $ = c => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

async function main() {
  const cfg = loadConfig();
  const gap = missing(cfg);
  if (gap.length) throw new Error('Missing in .env.vp: ' + gap.join(', '));
  cfg.rowLimit = 100000; cfg.queryTimeoutSeconds = 120;
  const vp = await open(cfg);
  const q = async (name, sql) => { const r = await vp.query(sql); if (r.truncated) throw new Error(name + ': row limit hit'); console.error(`${name}: ${r.rows.length} rows`); return r.rows; };
  let rev, fc, mw, hol;
  try { rev = await q('revenue', SQL.revenue); fc = await q('forecast', SQL.forecast); hol = await q('holidays', SQL.holidays); mw = await q('mwip', SQL.pursuits); } finally { await vp.close(); }
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `bd-live-${period}-asof-${asOf}.json`);
  fs.writeFileSync(file, JSON.stringify({ period, asOf, pulledAt: new Date().toISOString(), revenue: rev, forecast: fc, holidays: hol, mwip: mw }, null, 1));
  console.error('saved ' + file);

  // ---- totals ----
  const groups = { pic: new Map(), sector: new Map() };
  const add = (pic, sector, field, c) => {
    for (const [scope, key] of [['pic', pic || 'Unassigned'], ['sector', sector || 'Unassigned']]) {
      const m = groups[scope]; if (!m.has(key)) m.set(key, {}); const g = m.get(key); g[field] = (g[field] || 0) + c;
    }
  };
  for (const r of rev) { const g = cents(r.gross), k = cents(r.consultant); add(r.pic, r.sector, 'gross', g); add(r.pic, r.sector, 'consult', k); add(r.pic, r.sector, 'ytd', g - k); }

  // forecast: the report's own rules. Spread each entry by working days (logic/forecast.js), months after the report month through
  // December, then the architectural share with fee + consultant fees as the full contract amount (logic/architectural.js, the default)
  const f = computeForecast({ entries: fc.map(r => ({ wbs1: String(r.project).trim(), start: r.start_date, end: r.end_date, amount: cents(r.amount) })), holidays: hol.map(h => h.d), period });
  const proj = Object.fromEntries(fc.map(r => [String(r.project).trim(), r]));
  for (const [wbs1, g] of Object.entries(f.gross)) {
    const r = proj[wbs1];
    const arch = architecturalAmount({ gross: g, fee: cents(r.fee), consultFee: cents(r.consult_fee), reimbAllow: cents(r.reimb_allow) }, 'feeConsult').amount;
    add(r.pic, r.sector, 'fcGross', g); add(r.pic, r.sector, 'fcArch', arch);
  }
  const fcFrom = f.months.length ? f.months[0] : '-';

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
