'use strict';
/* Exact decimal arithmetic for money and ratios. No binary floating point anywhere in reconciliation.
   A Dec is a BigInt count of 1e-SCALE units. SCALE = 8 holds cents with room for ratio math; results are rounded half-to-even
   only when asked (toCents). Ratios stay as exact fractions until the last step: mulDiv(a, num, den). */

const SCALE = 8;
const UNIT = 10n ** BigInt(SCALE);

function parse(value, { round = false } = {}) {
  if (value === null || value === undefined || value === '') throw new Error('decimal: empty value');
  if (typeof value === 'bigint') return value * UNIT;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('decimal: not finite');
    value = String(value); // JS shortest round-trip text; never do arithmetic on the number itself
  }
  let s = String(value).trim().replace(/[$,\s]/g, '');
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); } else if (s.startsWith('+')) s = s.slice(1);
  const m = /^(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
  if (!m || (m[1] === '' && (m[2] === undefined || m[2] === ''))) throw new Error('decimal: not a number');
  let int = m[1] || '0', frac = m[2] || '';
  const exp = m[3] ? parseInt(m[3], 10) : 0;
  if (exp > 0) { frac = frac.padEnd(exp, '0'); int += frac.slice(0, exp); frac = frac.slice(exp); }
  else if (exp < 0) { int = int.padStart(-exp + 1, '0'); frac = int.slice(int.length + exp) + frac; int = int.slice(0, int.length + exp) || '0'; }
  const fracPadded = (frac + '0'.repeat(SCALE)).slice(0, SCALE);
  const extra = frac.slice(SCALE);
  let v = BigInt(int) * UNIT + BigInt(fracPadded);
  if (/[1-9]/.test(extra)) {
    // Excel stores binary doubles (e.g. 1234.5600000000002). Reference files may be rounded to SCALE places, never database values.
    if (!round) throw new Error('decimal: more than ' + SCALE + ' decimal places');
    v = mulDiv(BigInt(int + frac), 1n, 10n ** BigInt(frac.length - SCALE));
  }
  return neg ? -v : v;
}

/* a * num / den, rounded half to even at the Dec scale (den must be non-zero) */
function mulDiv(a, num, den) {
  if (den === 0n) throw new Error('decimal: division by zero');
  const n = a * num;
  let q = n / den, r = n % den;
  if (r < 0n) { r = -r; }
  const twice = r * 2n, d = den < 0n ? -den : den;
  const neg = (n < 0n) !== (den < 0n);
  if (twice > d || (twice === d && (q % 2n !== 0n))) q += neg ? -1n : 1n;
  return q;
}

function roundTo(v, places) {
  const f = 10n ** BigInt(SCALE - places);
  return mulDiv(v, 1n, f) * f;
}

function toString(v, places = 2) {
  const r = roundTo(v, places);
  const neg = r < 0n, a = neg ? -r : r;
  const int = a / UNIT, frac = (a % UNIT).toString().padStart(SCALE, '0').slice(0, places);
  return (neg ? '-' : '') + int.toString() + (places ? '.' + frac : '');
}

const abs = v => (v < 0n ? -v : v);
const add = (a, b) => a + b;
const sub = (a, b) => a - b;

module.exports = { SCALE, UNIT, parse, mulDiv, roundTo, toString, abs, add, sub };
