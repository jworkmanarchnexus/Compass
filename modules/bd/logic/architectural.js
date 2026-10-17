'use strict';
/* The architectural share of a contracted forecast amount (owner rule, 2026-10-17).
   The forecast is entered gross. For the BD report only, each project's month is scaled by
       (full contract amount - consultant fees) / full contract amount
   so a $100k contract with $30k of consultants shows 0.7 of the month.
   "Full contract amount" is a setting (bd.contractAmount):
       feeConsult       fee + consultant fees                         (default)
       feeConsultReimb  fee + consultant fees + reimbursable allowance
   All money is whole cents. Nothing is dropped silently: a project that cannot be scaled keeps its full amount and is reported. */

const DEFINITIONS = ['feeConsult', 'feeConsultReimb'];

function contractAmount(row, definition) {
  if (!DEFINITIONS.includes(definition)) throw new Error('unknown contract amount definition');
  return (row.fee || 0) + (row.consultFee || 0) + (definition === 'feeConsultReimb' ? (row.reimbAllow || 0) : 0);
}

/* gross x (den - consult) / den, half to even, in integers that cannot overflow (BigInt inside) */
function scale(gross, num, den) {
  const g = BigInt(gross), n = BigInt(den - num), d = BigInt(den);
  const x = g * n; let q = x / d; const r = x % d;
  const twice = (r < 0n ? -r : r) * 2n;
  if (twice > d || (twice === d && q % 2n !== 0n)) q += x < 0n ? -1n : 1n;
  return Number(q);
}

/* row: { gross, fee, consultFee, reimbAllow }  ->  { amount, issue }   issue is null or 'no-contract-fee' or 'consultants-exceed-contract' */
function architecturalAmount(row, definition = 'feeConsult') {
  const den = contractAmount(row, definition), num = row.consultFee || 0;
  if (!(den > 0)) return { amount: row.gross, issue: 'no-contract-fee' };
  if (num < 0 || num > den) return { amount: row.gross, issue: 'consultants-exceed-contract' };
  return { amount: scale(row.gross, num, den), issue: null };
}

module.exports = { DEFINITIONS, contractAmount, architecturalAmount };
