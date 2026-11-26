'use strict';
/* ===== MWIP backlog: pursuits not yet contracted, month by month, the way Vantagepoint's MWIP report does it =====
   docs/MWIP-METHOD.md. Pure; money is whole cents. The options mirror the report's own Options tab and are Admin
   settings (Admin > Marketing Reports > MWIP calculation):

     basis       'weighted'   the Weighted Fee (fee x probability)              ("Calculate Pursuit Forecast Using")
                 'estimated'  the Est. Fee
     allocation  'spread'     spread evenly across the calculation periods from estimated start to estimated completion ("Fee Allocation")
                 'start'      all of it on the estimated start date
                 'completion' all of it on the estimated completion date
     period      'daily' | 'semimonthly' | 'monthly'                           ("Calculation Period")
     start       'afterReportMonth'  the report starts on the first day after the report month (owner, 2026-11-25)
                 'buildDay'          the report starts on the day it is built ("Start Date: Today")
     through     'yearEnd'    through Dec 31 of the report year (owner, open question M1)
                 '1' .. '24'  that many months, starting with the month of the start date ("Duration")

   How Vantagepoint spreads (reproduced exactly for Daily, Semi-monthly and Monthly: 109 of 109 pursuits and 1,308 of 1,308
   monthly cells each, exports run 2026-11-25):
     1. split the dates from estimated start to estimated completion into calculation periods: days; the 1st-15th and
        16th-end of each month; or calendar months. A partial period at either end counts as a whole one.
     2. every period gets an equal share of the fee.
     3. periods that ended before the start date drop out; the period the start date falls in counts in full.
   So with Daily the days before the start date drop out, and with Monthly the start date's month counts in full.
   Weekly and Bi-weekly come within about a dollar a month of Daily but not exactly, so they are not offered.

   Only pursuits Vantagepoint's report lists count: stage not yet awarded (STAGES) and a non-zero Est. Fee.
   A pursuit missing a date the allocation needs is left out and reported, never guessed. */

const STAGES = ['001', '002', '009', '010', '011', '015']; // Go No Go, Marketing Proposal, Shortlisted, Negotiation, Research, Fee Proposal Only
const DEFAULT_OPTIONS = { basis: 'weighted', allocation: 'spread', period: 'daily', start: 'afterReportMonth', through: 'yearEnd' };
const CHOICES = {
  basis: ['weighted', 'estimated'],
  allocation: ['spread', 'start', 'completion'],
  period: ['daily', 'semimonthly', 'monthly'],
  start: ['afterReportMonth', 'buildDay'],
};
const validThrough = v => v === 'yearEnd' || (typeof v === 'string' && /^\d{1,2}$/.test(v) && Number(v) >= 1 && Number(v) <= 24);

const parse = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '')); return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null; };
const ym = (y, mo) => y * 100 + mo;
const dim = (y, mo) => new Date(Date.UTC(y, mo, 0)).getUTCDate();
const dayNo = ({ y, mo, d }) => Math.floor(Date.UTC(y, mo - 1, d) / 86400000);
const fromDayNo = n => { const t = new Date(n * 86400000); return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() }; };
const next = (y, mo) => (mo === 12 ? [y + 1, 1] : [y, mo + 1]);

/* a * num / den, rounded half to even, exact for any size (BigInt) */
function mulDiv(a, num, den) {
  const n = BigInt(a) * BigInt(num), d = BigInt(den);
  let q = n / d; const r = n % d;
  const twice = (r < 0n ? -r : r) * 2n;
  if (twice > d || (twice === d && q % 2n !== 0n)) q += n < 0n ? -1n : 1n;
  return Number(q);
}

/* the calculation periods covering day numbers s..e: [{ from, to }] (day numbers), clipped to the range */
function periods(s, e, period) {
  const out = [];
  for (let a = s; a <= e;) {
    const { y, mo, d } = fromDayNo(a);
    let end;
    if (period === 'daily') end = a;
    else if (period === 'semimonthly') end = d <= 15 ? dayNo({ y, mo, d: 15 }) : dayNo({ y, mo, d: dim(y, mo) });
    else end = dayNo({ y, mo, d: dim(y, mo) });
    out.push({ from: a, to: Math.min(end, e) });
    a = Math.min(end, e) + 1;
  }
  return out;
}

/* the pieces of a pursuit's amount, one per calculation period: [{ from, to, amount }], equal shares that add back to the
   whole amount exactly (each piece is the rounded running total minus the one before), or null when a needed date is missing */
function allocate(amount, startIso, endIso, allocation, period) {
  const s = parse(startIso), e = parse(endIso);
  if (allocation === 'start' || allocation === 'completion') {
    const at = allocation === 'start' ? s : e;
    if (!at) return null;
    const p = periods(dayNo(at), dayNo(at), period)[0];
    return [{ from: p.from, to: p.to, amount }];
  }
  if (!s || !e || dayNo(e) < dayNo(s)) return null;
  const ps = periods(dayNo(s), dayNo(e), period), n = ps.length;
  return ps.map((p, i) => ({ from: p.from, to: p.to, amount: mulDiv(amount, i + 1, n) - mulDiv(amount, i, n) }));
}

/* the report's start date, and the months that count */
function windowFor(period, buildDate, options) {
  const py = Math.floor(period / 100), pm = period % 100;
  let asOf;
  if (options.start === 'buildDay') asOf = parse(buildDate);
  else { const [y, mo] = next(py, pm); asOf = { y, mo, d: 1 }; }
  if (!asOf) throw new Error('mwip: the build date must be YYYY-MM-DD');
  const months = [];
  if (options.through === 'yearEnd') { for (let y = asOf.y, mo = asOf.mo; y === py; [y, mo] = next(y, mo)) months.push(ym(y, mo)); }
  else { for (let i = 0, y = asOf.y, mo = asOf.mo; i < Number(options.through); i++, [y, mo] = next(y, mo)) months.push(ym(y, mo)); }
  return { asOf, months };
}

function checkOptions(o) {
  for (const k of Object.keys(CHOICES)) if (!CHOICES[k].includes(o[k])) throw new Error(`mwip: unknown ${k} "${o[k]}"`);
  if (!validThrough(o.through)) throw new Error(`mwip: unknown through "${o.through}"`);
}

/* pursuits: [{ id, name, pic, sector, stage, estFee, weightedFee, estStart, estCompletion }]  (cents, YYYY-MM-DD)
   period:    the report month, YYYYMM;  buildDate: YYYY-MM-DD, the day the report is built (used only for 'buildDay')
   -> { asOf: 'YYYY-MM-DD', months: [YYYYMM...], mwip: [{ id, name, pic, sector, amount }], mwipMonths: [{ id, month, amount }],
        leftOut: [{ id, reason: 'stage' | 'no-fee' | 'no-dates' }] }
   amount is before the architectural factor; the report applies the factor (logic/report.js). */
function computeMwip({ pursuits, period, buildDate, options }) {
  const o = Object.assign({}, DEFAULT_OPTIONS, options || {});
  checkOptions(o);
  const { asOf, months } = windowFor(period, buildDate, o);
  const start = dayNo(asOf), inWindow = new Set(months);
  const mwip = [], mwipMonths = [], leftOut = [];
  for (const p of pursuits) {
    if (!STAGES.includes(String(p.stage))) { leftOut.push({ id: p.id, reason: 'stage' }); continue; }
    if (!p.estFee) { leftOut.push({ id: p.id, reason: 'no-fee' }); continue; }
    const base = o.basis === 'weighted' ? (p.weightedFee || 0) : p.estFee;
    const pieces = allocate(base, p.estStart, p.estCompletion, o.allocation, o.period);
    if (!pieces) { leftOut.push({ id: p.id, reason: 'no-dates' }); continue; }
    const byMonth = new Map();
    for (const pc of pieces) {
      if (pc.to < start) continue; // ended before the start date
      const f = fromDayNo(pc.from), k = ym(f.y, f.mo); // a period never crosses a month, so it belongs to the month it starts in
      if (inWindow.has(k)) byMonth.set(k, (byMonth.get(k) || 0) + pc.amount);
    }
    let total = 0;
    for (const k of months) { const v = byMonth.get(k) || 0; if (v) { mwipMonths.push({ id: p.id, month: k, amount: v }); total += v; } }
    if (total) mwip.push({ id: p.id, name: p.name || p.id, pic: p.pic, sector: p.sector, amount: total });
  }
  const iso = `${asOf.y}-${String(asOf.mo).padStart(2, '0')}-${String(asOf.d).padStart(2, '0')}`;
  return { asOf: iso, months, mwip, mwipMonths, leftOut };
}

module.exports = { STAGES, DEFAULT_OPTIONS, CHOICES, validThrough, periods, allocate, windowFor, computeMwip };
