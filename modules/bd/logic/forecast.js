'use strict';
/* ===== Contracted revenue forecast: plan entries by month, the way Vantagepoint's forecast report does it =====
   docs/FORECAST-METHOD.md. Pure; money is whole cents.

   A PM's plan revenue entry has an amount and its own dates (start to end), which can span several months. Vantagepoint
   spreads each entry across its dates by WORKING DAYS: Monday to Friday, less the firm holiday calendar. Reproduced to the
   dollar for 144 of 144 projects and 12 months against a same-day export (2026-11-25). An entry with no working day in its
   dates (a weekend or a holiday) stays in its start month.

   The BD report counts the months after the report month through December 31 of the report year (owner, open question M1);
   there is no current-month cut. The architectural share is applied afterwards (logic/architectural.js). */

const parse = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '')); return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) : null; };
const ymOf = n => { const t = new Date(n * 86400000); return t.getUTCFullYear() * 100 + t.getUTCMonth() + 1; };
const weekday = n => { const g = new Date(n * 86400000).getUTCDay(); return g !== 0 && g !== 6; };

/* a * num / den, rounded half to even (BigInt, exact) */
function mulDiv(a, num, den) {
  const n = BigInt(a) * BigInt(num), d = BigInt(den);
  let q = n / d; const r = n % d;
  const twice = (r < 0n ? -r : r) * 2n;
  if (twice > d || (twice === d && q % 2n !== 0n)) q += n < 0n ? -1n : 1n;
  return Number(q);
}

/* one entry's amount by month: Map(YYYYMM -> cents), adding back to the amount exactly. holidays: Set of day numbers */
function spreadEntry(amount, startIso, endIso, holidays) {
  const s = parse(startIso), e = parse(endIso === undefined || endIso === null ? startIso : endIso);
  if (s === null || e === null) return null;
  const perMonth = new Map(); let days = 0;
  for (let n = s; n <= e; n++) if (weekday(n) && !holidays.has(n)) { const k = ymOf(n); perMonth.set(k, (perMonth.get(k) || 0) + 1); days++; }
  const out = new Map();
  if (!days) { out.set(ymOf(s), amount); return out; }
  // running totals rounded, so the months add back to the whole amount
  let seen = 0, given = 0;
  for (const [k, d] of [...perMonth].sort((a, b) => a[0] - b[0])) { seen += d; const upTo = mulDiv(amount, seen, days); out.set(k, upTo - given); given = upTo; }
  return out;
}

/* entries:  [{ wbs1, start, end, amount }]  (cents, YYYY-MM-DD; end may be missing for a one-day entry)
   holidays: ['YYYY-MM-DD', ...]  the firm holiday calendar
   period:   the report month, YYYYMM
   -> { months: [YYYYMM...], gross: { wbs1: cents in the window }, forecastMonths: [{ id, month, amount }], skipped: [wbs1 with an undated entry] } */
function computeForecast({ entries, holidays, period }) {
  const hol = new Set((holidays || []).map(parse).filter(n => n !== null));
  const year = Math.floor(period / 100), months = [];
  for (let m = (period % 100) + 1; m <= 12; m++) months.push(year * 100 + m);
  const inWindow = new Set(months);
  const by = new Map(), skipped = new Set();
  for (const en of entries) {
    if (!en.amount) continue;
    const sp = spreadEntry(en.amount, en.start, en.end, hol);
    if (!sp) { skipped.add(en.wbs1); continue; }
    for (const [k, v] of sp) {
      if (!inWindow.has(k) || !v) continue;
      if (!by.has(en.wbs1)) by.set(en.wbs1, new Map());
      const m = by.get(en.wbs1); m.set(k, (m.get(k) || 0) + v);
    }
  }
  const gross = {}, forecastMonths = [];
  for (const [id, m] of [...by].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    let t = 0;
    for (const k of months) { const v = m.get(k) || 0; if (v) { forecastMonths.push({ id, month: k, amount: v }); t += v; } }
    if (t) gross[id] = t;
  }
  return { months, gross, forecastMonths, skipped: [...skipped].sort() };
}

module.exports = { spreadEntry, computeForecast };
