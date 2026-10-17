'use strict';
/* Local financial reconciliation. Compares an authoritative reference dataset with a candidate dataset, exactly (BigInt decimals).
   Datasets are arrays of records; `amount` is a Dec. `dims` names the key fields (e.g. ['project'], ['pic','sector']).
   Levels are checked independently: matching at the firm level proves nothing about the allocations underneath.
   Real keys and amounts are written to the protected store; what is returned is counts, a status, a magnitude class, and
   surrogate ids for exceptions. Nothing here claims "verified" unless every required level passes with no unexplained variance. */
const Dec = require('./lib/decimal');

const DEFAULT_TOLERANCE = { absolute: Dec.parse('0.01'), cumulative: Dec.parse('0.05') }; // per row; across all rows at a level

function groupBy(rows, dims) {
  const groups = new Map(), dup = new Map();
  for (const r of rows) {
    const key = dims.map(d => r[d] ?? '').join('\u0001');
    const g = groups.get(key) || { key, fields: Object.fromEntries(dims.map(d => [d, r[d] ?? ''])), sum: 0n, n: 0 };
    g.sum += r.amount; g.n++; groups.set(key, g);
  }
  return groups;
}

/* magnitude class of a variance relative to the reference, never the amount itself */
function varianceClass(diff, ref) {
  if (diff === 0n) return 'exact';
  if (ref === 0n) return 'reference-zero';
  const rel = Number(Dec.abs(diff) * 1000000n / Dec.abs(ref)) / 1000000; // ratio only used for the class bucket
  return rel < 0.0001 ? 'under-0.01%' : rel < 0.001 ? 'under-0.1%' : rel < 0.01 ? 'under-1%' : 'over-1%';
}

function diagnose(ref, cand, refRows, candRows, rollup) {
  const hints = [];
  if (ref !== 0n && cand === -ref) hints.push('sign-flipped');
  if (ref !== 0n && cand === ref * 2n) hints.push('double-counted');
  if (!rollup && candRows > refRows) hints.push('more-source-rows-than-reference'); // meaningless when a group rolls up many rows
  if (cand === 0n && ref !== 0n) hints.push('candidate-empty');
  return hints;
}

/* duplicates in the *source keys* of a dataset at its natural grain (e.g. a project listed twice) */
function duplicateKeys(rows, dims) {
  const seen = new Map();
  for (const r of rows) { const k = dims.map(d => r[d] ?? '').join('\u0001'); seen.set(k, (seen.get(k) || 0) + 1); }
  return [...seen].filter(([, n]) => n > 1).map(([k, n]) => ({ key: k, n }));
}

/* reconcileLevel(reference, candidate, dims, opts) -> { status, counts, exceptions[] } ; exceptions carry real keys (local only) */
function reconcileLevel(reference, candidate, dims, { tolerance = DEFAULT_TOLERANCE, allowDuplicates = false } = {}) {
  const R = groupBy(reference, dims), C = groupBy(candidate, dims);
  // repeated keys are normal when rolling up (PIC, sector) and a defect at the natural grain (one row per project)
  const dupRef = allowDuplicates ? [] : duplicateKeys(reference, dims);
  const dupCand = allowDuplicates ? [] : duplicateKeys(candidate, dims);
  const exceptions = [];
  let exact = 0, within = 0, mismatched = 0, missing = 0, unexpected = 0, zeroBoth = 0, cumulative = 0n;
  for (const [k, r] of R) {
    const c = C.get(k);
    if (!c) {
      // the reference reports a group with zero and the candidate has no records for it: that agrees, it is not a missing record
      if (r.sum === 0n) { zeroBoth++; continue; }
      missing++; exceptions.push({ type: 'missing-in-candidate', fields: r.fields, ref: r.sum, cand: 0n, hints: [] }); continue;
    }
    const diff = c.sum - r.sum;
    if (diff === 0n) { exact++; continue; }
    if (Dec.abs(diff) <= tolerance.absolute) { within++; cumulative += Dec.abs(diff); continue; }
    mismatched++;
    exceptions.push({ type: 'variance', fields: r.fields, ref: r.sum, cand: c.sum, diff, cls: varianceClass(diff, r.sum), direction: diff > 0n ? 'candidate-higher' : 'candidate-lower', hints: diagnose(r.sum, c.sum, r.n, c.n, allowDuplicates) });
  }
  for (const [k, c] of C) if (!R.has(k)) { if (c.sum === 0n) { zeroBoth++; continue; } unexpected++; exceptions.push({ type: 'unexpected-in-candidate', fields: c.fields, ref: 0n, cand: c.sum, hints: [] }); }
  const accumulated = cumulative > tolerance.cumulative;
  const failed = mismatched + missing + unexpected + dupRef.length + dupCand.length > 0 || accumulated;
  return {
    status: failed ? 'FAIL' : 'pass',
    counts: { referenceGroups: R.size, candidateGroups: C.size, zeroOnBothSides: zeroBoth, exact, withinTolerance: within, mismatched, missingInCandidate: missing, unexpectedInCandidate: unexpected, duplicateReferenceKeys: dupRef.length, duplicateCandidateKeys: dupCand.length },
    toleranceAccumulated: accumulated,
    exceptions,
  };
}

/* the full ladder. levels: [{ name, dims, naturalGrain? }]. required: names that must pass for "reconciled".
   naturalGrain marks the level where one row is expected per key (e.g. per project): repeats there are errors. */
function reconcile({ reference, candidate, levels, tolerance = DEFAULT_TOLERANCE, required = null, naturalKey = null }) {
  const results = {};
  for (const lv of levels) results[lv.name] = reconcileLevel(reference, candidate, lv.dims, { tolerance, allowDuplicates: !lv.naturalGrain });
  // double-count guard: the candidate must not list the same natural key (e.g. project) twice
  const dupes = naturalKey ? duplicateKeys(candidate, naturalKey) : [];
  const need = required || levels.map(l => l.name);
  const unmet = need.filter(n => results[n]?.status !== 'pass');
  const reconciled = unmet.length === 0 && dupes.length === 0;
  return { reconciled, requiredLevels: need, unmetLevels: unmet, candidateDuplicateNaturalKeys: dupes.length, results };
}

/* what may leave: counts, statuses, classes, surrogate ids. ids(kind, value) comes from the gateway. */
function sanitize(rec, gateway) {
  const levels = {};
  for (const [name, r] of Object.entries(rec.results)) {
    levels[name] = {
      status: r.status, ...r.counts, toleranceAccumulated: r.toleranceAccumulated,
      exceptions: r.exceptions.slice(0, 25).map((e, i) => ({
        seq: i + 1, type: e.type, varianceClass: e.cls || 'n/a', direction: e.direction || 'n/a',
        ids: Object.entries(e.fields).map(([k, v]) => gateway.surrogate(k, v)), hints: e.hints,
      })),
      exceptionTotalCount: r.exceptions.length,
    };
  }
  return { reconciled: rec.reconciled, requiredLevels: rec.requiredLevels, unmetLevels: rec.unmetLevels, candidateDuplicateNaturalKeys: rec.candidateDuplicateNaturalKeys, levels };
}

module.exports = { reconcile, reconcileLevel, sanitize, varianceClass, DEFAULT_TOLERANCE };
