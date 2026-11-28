'use strict';
/* The architectural share of a contracted forecast amount. The forecast is entered gross; for the BD report each project's month
   is scaled by (1 - the consultant share). Which consultant share is a setting (bd.contractAmount):

       vpActual         Vantagepoint's "Consultants %" (default since 2026-11-28, owner): what the firm's forecast report uses.
                        direct costs to date / earned revenue to date, through the report month, as its report query defines it
                        ([dirjtd] / [JTDEarnedRevenue]): direct = CA.Type 8 (61xx consultants) and 7 (62xx travel, printing...)
                        lines flagged as project cost; earned = the revenue accounts (CA.Type 4); all four ledgers.
                        Reproduced exactly for 143 of 144 projects (2026-11-28). No revenue yet: 0%, so the full forecast counts.
       feeConsult       consultant fee / (fee + consultant fee) from the project record (the contract split; the rule until 2026-11-28)
       feeConsultReimb  consultant fee / (fee + consultant fee + reimbursable allowance)

   So a $100k contract with $30k of consultants shows 0.7 of the month under the contract rules.
   All money is whole cents. Nothing is dropped silently: a project that cannot be scaled keeps its full amount and is reported. */

const DEFINITIONS = ['vpActual', 'feeConsult', 'feeConsultReimb'];

function contractAmount(row, definition) {
  if (!DEFINITIONS.includes(definition) || definition === 'vpActual') throw new Error('unknown contract amount definition');
  return (row.fee || 0) + (row.consultFee || 0) + (definition === 'feeConsultReimb' ? (row.reimbAllow || 0) : 0);
}

/* gross x (den - num) / den, half to even, in integers that cannot overflow (BigInt inside) */
function scale(gross, num, den) {
  const g = BigInt(gross), n = BigInt(den - num), d = BigInt(den);
  const x = g * n; let q = x / d; const r = x % d;
  const twice = (r < 0n ? -r : r) * 2n;
  if (twice > d || (twice === d && q % 2n !== 0n)) q += x < 0n ? -1n : 1n;
  return Number(q);
}

/* row: { gross, fee, consultFee, reimbAllow, directCostToDate, earnedToDate }  ->  { amount, issue }
   issue is null, or 'no-contract-fee' / 'consultants-exceed-contract' (contract rules), or 'costs-exceed-earned' (vpActual) */
function architecturalAmount(row, definition = 'vpActual') {
  if (definition === 'vpActual') {
    const num = row.directCostToDate || 0, den = row.earnedToDate || 0;
    if (!(den > 0)) return { amount: row.gross, issue: null };            // no revenue earned yet: 0%, as Vantagepoint shows it
    if (num < 0 || num > den) return { amount: row.gross, issue: 'costs-exceed-earned' };
    return { amount: scale(row.gross, num, den), issue: null };
  }
  const den = contractAmount(row, definition), num = row.consultFee || 0;
  if (!(den > 0)) return { amount: row.gross, issue: 'no-contract-fee' };
  if (num < 0 || num > den) return { amount: row.gross, issue: 'consultants-exceed-contract' };
  return { amount: scale(row.gross, num, den), issue: null };
}

/* the consultant share as a fraction, for showing (null when the rule cannot give one) */
function consultantShare(row, definition = 'vpActual') {
  if (definition === 'vpActual') return row.earnedToDate > 0 ? (row.directCostToDate || 0) / row.earnedToDate : 0;
  const den = contractAmount(row, definition);
  return den > 0 ? (row.consultFee || 0) / den : null;
}

module.exports = { DEFINITIONS, contractAmount, architecturalAmount, consultantShare };
