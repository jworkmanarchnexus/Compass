'use strict';
/* ===== MWIP backlog: pursuits not yet contracted, month by month, the way Vantagepoint's MWIP report does it =====
   docs/MWIP-METHOD.md. Pure; money is whole cents. The options mirror the report's own Options tab and are Admin
   settings (Admin > Marketing Reports > MWIP calculation):

     basis       'weighted'   the Weighted Fee (fee x probability)              ("Calculate Pursuit Forecast Using")
                 'estimated'  the Est. Fee
     allocation  'spread'     spread by days from estimated start to estimated completion ("Fee Allocation")
                 'start'      all of it in the estimated start month
                 'completion' all of it in the estimated completion month
     period      'monthly'    ("Calculation Period"; the only one checked against Vantagepoint so far)
     start       'afterReportMonth'  counted as of the first day after the report month: that month in full (owner, 2026-11-25)
                 'buildDay'          counted as of the day the report is built: that month cut by the days already gone
     through     'yearEnd'    through Dec 31 of the report year (owner, open question M1)
                 '3' .. '24'  that many months, starting with the first month counted

   The current-month cut (Vantagepoint's rule, verified 2026-10-16): on day d of a month of D days the month shows
   (D - d + 1) / D of its amount; months before it are past and drop out.

   Only pursuits Vantagepoint's report lists count: stage not yet awarded (STAGES) and a non-zero Est. Fee.
   A pursuit missing a date the allocation needs is left out and reported, never guessed. */

const STAGES = ['001', '002', '009', '010', '011', '015']; // Go No Go, Marketing Proposal, Shortlisted, Negotiation, Research, Fee Proposal Only
const DEFAULT_OPTIONS = { basis: 'weighted', allocation: 'spread', period: 'monthly', start: 'afterReportMonth', through: 'yearEnd' };
const CHOICES = {
  basis: ['weighted', 'estimated'],
  allocation: ['spread', 'start', 'completion'],
  period: ['monthly'],
  start: ['afterReportMonth', 'buildDay'],
};
const validThrough = v => v === 'yearEnd' || (typeof v === 'string' && /^\d{1,2}$/.test(v) && Number(v) >= 1 && Number(v) <= 24);

const parse = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '')); return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null; };
const ym = (y, mo) => y * 100 + mo;
const dim = (y, mo) => new Date(Date.UTC(y, mo, 0)).getUTCDate();
const dayNo = ({ y, mo, d }) => Math.floor(Date.UTC(y, mo - 1, d) / 86400000);
const next = (y, mo) => (mo === 12 ? [y + 1, 1] : [y, mo + 1]);

/* a * num / den, rounded half to even, exact for any size (BigInt) */
function mulDiv(a, num, den) {
  const n = BigInt(a) * BigInt(num), d = BigInt(den);
  let q = n / d; const r = n % d;
  const twice = (r < 0n ? -r : r) * 2n;
  if (twice > d || (twice === d && q % 2n !== 0n)) q += n < 0n ? -1n : 1n;
  return Number(q);
}

/* the months a pursuit's amount falls in, before any cut: [{ month: YYYYMM, amount }] adding back to the whole amount */
function allocate(amount, startIso, endIso, allocation) {
  const s = parse(startIso), e = parse(endIso);
  if (allocation === 'start') return s ? [{ month: ym(s.y, s.mo), amount }] : null;
  if (allocation === 'completion') return e ? [{ month: ym(e.y, e.mo), amount }] : null;
  if (!s || !e || dayNo(e) < dayNo(s)) return null;
  const months = [];
  for (let y = s.y, mo = s.mo; ym(y, mo) <= ym(e.y, e.mo); [y, mo] = next(y, mo)) months.push([y, mo]);
  const total = dayNo(e) - dayNo(s) + 1;
  let given = 0;
  return months.map(([y, mo], i) => {
    const days = Math.min(dayNo(e), dayNo({ y, mo, d: dim(y, mo) })) - Math.max(dayNo(s), dayNo({ y, mo, d: 1 })) + 1;
    // the last month takes the remainder so the pieces always add back to the whole amount
    const piece = i === months.length - 1 ? amount - given : mulDiv(amount, days, total);
    given += piece;
    return { month: ym(y, mo), amount: piece };
  });
}

/* the date the months are counted from, and the months that count */
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
  const inWindow = new Set(months);
  const mwip = [], mwipMonths = [], leftOut = [];
  for (const p of pursuits) {
    if (!STAGES.includes(String(p.stage))) { leftOut.push({ id: p.id, reason: 'stage' }); continue; }
    if (!p.estFee) { leftOut.push({ id: p.id, reason: 'no-fee' }); continue; }
    const base = o.basis === 'weighted' ? (p.weightedFee || 0) : p.estFee;
    const pieces = allocate(base, p.estStart, p.estCompletion, o.allocation);
    if (!pieces) { leftOut.push({ id: p.id, reason: 'no-dates' }); continue; }
    let total = 0;
    for (const pc of pieces) {
      if (!inWindow.has(pc.month)) continue;
      const y = Math.floor(pc.month / 100), mo = pc.month % 100;
      const shown = y === asOf.y && mo === asOf.mo ? mulDiv(pc.amount, dim(y, mo) - asOf.d + 1, dim(y, mo)) : pc.amount;
      if (!shown) continue;
      mwipMonths.push({ id: p.id, month: pc.month, amount: shown });
      total += shown;
    }
    if (total) mwip.push({ id: p.id, name: p.name || p.id, pic: p.pic, sector: p.sector, amount: total });
  }
  const iso = `${asOf.y}-${String(asOf.mo).padStart(2, '0')}-${String(asOf.d).padStart(2, '0')}`;
  return { asOf: iso, months, mwip, mwipMonths, leftOut };
}

module.exports = { STAGES, DEFAULT_OPTIONS, CHOICES, validThrough, allocate, windowFor, computeMwip };
