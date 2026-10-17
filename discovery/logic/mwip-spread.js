'use strict';
/* Spreads a pursuit's fee across calendar months between its estimated start and end dates.
   Pure and exact (BigInt decimals). Two rules are offered so a reference can decide which one a report uses:
     'months-even': the same amount in every calendar month touched, start month to end month inclusive
     'days-even':   pro rata by the number of days of the range that fall in each month
   Only months inside the report window are returned; the rest is outside the window by design. */
const Dec = require('../lib/decimal');

const parse = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso)); if (!m) throw new Error('spread: date must be YYYY-MM-DD'); return { y: +m[1], mo: +m[2], d: +m[3] }; };
const key = (y, mo) => `${y}-${String(mo).padStart(2, '0')}`;
const dim = (y, mo) => new Date(Date.UTC(y, mo, 0)).getUTCDate();
const dayNo = ({ y, mo, d }) => Math.floor(Date.UTC(y, mo - 1, d) / 86400000);

function monthsTouched(start, end) {
  const out = []; let y = start.y, mo = start.mo;
  while (y < end.y || (y === end.y && mo <= end.mo)) { out.push([y, mo]); mo++; if (mo > 12) { mo = 1; y++; } }
  return out;
}

function spread(amount, startIso, endIso, window, method = 'months-even') {
  const s = parse(startIso), e = parse(endIso);
  if (dayNo(e) < dayNo(s)) throw new Error('spread: end before start');
  const months = monthsTouched(s, e), out = new Map(window.map(k => [k, 0n]));
  let shares;
  if (method === 'months-even') shares = months.map(() => 1n);
  else if (method === 'days-even') shares = months.map(([y, mo]) => BigInt(Math.min(dayNo(e), dayNo({ y, mo, d: dim(y, mo) })) - Math.max(dayNo(s), dayNo({ y, mo, d: 1 })) + 1));
  else throw new Error('spread: unknown method');
  const total = shares.reduce((t, x) => t + x, 0n);
  let given = 0n;
  months.forEach(([y, mo], i) => {
    // the last month takes the remainder so the pieces always add back to the whole amount
    const piece = i === months.length - 1 ? amount - given : Dec.mulDiv(amount, shares[i], total);
    given += piece;
    const k = key(y, mo);
    if (out.has(k)) out.set(k, out.get(k) + piece);
  });
  return out;
}

const windowFrom = (startYear, startMonth, count) => { const w = []; let y = startYear, mo = startMonth; for (let i = 0; i < count; i++) { w.push(key(y, mo)); mo++; if (mo > 12) { mo = 1; y++; } } return w; };

module.exports = { spread, windowFrom, monthsTouched };
