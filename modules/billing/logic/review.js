/* ===== Billing: can this request be submitted? =====
   Pure. Takes an evaluated form (fixed.evaluate or hourly.evaluate) and the request's own facts, and says what blocks a submit.
   The SERVER runs this again on every submit; the browser runs it only to show messages. Tested from tests/fixtures/review.json.

   facts: { noBilling, notes, projectionCents, thresholdCents, sourceHash, currentSourceHash }
   thresholdCents is the Admin setting billing.varianceThreshold. The rule is STRICTLY greater: a difference of exactly the
   threshold passes without a note. */
'use strict';

const varianceOf = (totalCents, projectionCents) => Math.abs(totalCents - projectionCents);

function review(evaluated, facts) {
  const issues = [];
  for (const e of evaluated.errors) for (const code of e.errors) issues.push({ code: 'line-' + code, lineId: e.lineId });
  for (const code of evaluated.projectErrors || []) issues.push({ code });
  const total = evaluated.totalCents;
  const complete = total != null;
  const variance = complete ? varianceOf(total, facts.projectionCents || 0) : null;
  const needsNote = complete && variance > facts.thresholdCents;
  const hasNote = String(facts.notes == null ? '' : facts.notes).trim() !== '';
  if (complete && facts.noBilling && total !== 0) issues.push({ code: 'no-billing-nonzero' });
  if (needsNote && !hasNote) issues.push({ code: 'variance-note-required' });
  if (facts.currentSourceHash != null && facts.sourceHash !== facts.currentSourceHash) issues.push({ code: 'stale-source' });
  return { issues, canSubmit: issues.length === 0, canSaveDraft: true, totalCents: total, varianceCents: variance, needsNote };
}

/* a zero total is an explicit "No billing this month" once it is submitted; a positive total never is */
function normalizeForSubmit(evaluated, noBilling) {
  return evaluated.totalCents === 0 ? true : evaluated.totalCents > 0 ? false : !!noBilling;
}

const api = { review, varianceOf, normalizeForSubmit };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else if (typeof window !== 'undefined') window.CompassBilling = Object.assign(window.CompassBilling || {}, api);
