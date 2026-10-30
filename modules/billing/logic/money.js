/* ===== Billing: money and percent arithmetic =====
   Pure. Money is whole cents (integers). A percent is whole hundredths of a percent ("basis points"): 62.5% is 6250.
   No floating point is ever used for an amount. The one rounding rule: a percent of a fee is rounded to the nearest cent,
   halves up. Tested from tests/fixtures/money.json. */
'use strict';

/* cents from a percent of a fee: round-half-up(fee * bp / 10000), integers only */
function bpToCents(feeCents, bp) {
  return Math.floor((feeCents * bp * 2 + 10000) / 20000);
}

/* the percent (in basis points, nearest, halves up) that `cents` is of `feeCents`; 0 when the fee is 0 */
function centsToBp(cents, feeCents) {
  if (!(feeCents > 0)) return 0;
  return Math.floor((cents * 20000 + feeCents) / (2 * feeCents));
}

/* "$12,345.67" -> 1234567. Null for anything that is not a plain amount with at most two decimals. */
function parseCents(text) {
  const s = String(text == null ? '' : text).replace(/[\s$,]/g, '');
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const cents = Number(m[2]) * 100 + Number((m[3] || '').padEnd(2, '0') || 0);
  if (!Number.isSafeInteger(cents)) return null;
  return m[1] ? -cents : cents;
}

/* "62.5" or "62.5%" -> 6250. Null when not a plain non-negative percent with at most two decimals. */
function parseBp(text) {
  const s = String(text == null ? '' : text).replace(/[\s%]/g, '');
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0') || 0);
}

/* display helpers: 6250 -> "62.5", 1234567 -> "$12,345.67" */
const bpText = bp => { const w = Math.trunc(bp / 100), f = bp % 100; return f === 0 ? String(w) : w + '.' + String(f).padStart(2, '0').replace(/0$/, ''); };
const centsText = c => (c < 0 ? '-$' : '$') + Math.trunc(Math.abs(c) / 100).toLocaleString('en-US') + '.' + String(Math.abs(c) % 100).padStart(2, '0');

const api = { bpToCents, centsToBp, parseCents, parseBp, bpText, centsText };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else if (typeof window !== 'undefined') window.CompassBilling = Object.assign(window.CompassBilling || {}, api);
