/* ===== Billing: the fixed-fee form (billing by phase) =====
   Pure. Money is whole cents, a percent is basis points (see money.js). Tested from tests/fixtures/fixed.json.

   A phase, from Vantagepoint plus this app:
     { id, name, feeCents, billedCents, pendingCents, projectionCents }
   billedCents    what Vantagepoint says is billed to date
   pendingCents   amounts in requests that are submitted but not yet processed (Vantagepoint cannot know them yet)
   An entry is how the person typed it: { amountCents } ("bill this much more") or { pctBp } ("bill through this %"), or null for blank.
   The two always mean the same thing: target (cumulative) = prior + amount, where prior = billed + pending. Neither is percent complete. */
(function () {
'use strict';
const { bpToCents, centsToBp } = typeof require === 'function' ? require('./money') : window.CompassBilling; // the browser loads money.js first

const isNum = v => typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v);

function phaseLine(phase, entry) {
  const fee = phase.feeCents, prior = phase.billedCents + (phase.pendingCents || 0);
  const out = { id: phase.id, name: phase.name, feeCents: fee, billedCents: phase.billedCents, pendingCents: phase.pendingCents || 0, priorCents: prior, projectionCents: phase.projectionCents || 0, locked: prior >= fee, errors: [] };
  if (out.locked) {
    // a fully billed phase takes no normal entry; anything but zero is refused
    const asked = entry && (entry.amountCents != null ? entry.amountCents : entry.pctBp != null ? bpToCents(fee, entry.pctBp) - prior : 0);
    if (asked) out.errors.push('locked');
    return Object.assign(out, { targetCents: prior, amountCents: 0, throughBp: centsToBp(prior, fee), remainingCents: Math.max(0, fee - prior) });
  }
  let target = null;
  if (entry && entry.amountCents != null) {
    if (!isNum(entry.amountCents)) out.errors.push('blank');
    else { target = prior + entry.amountCents; if (entry.amountCents < 0) out.errors.push('negative'); }
  } else if (entry && entry.pctBp != null) {
    if (!isNum(entry.pctBp) || entry.pctBp < 0) out.errors.push('blank');
    else { target = bpToCents(fee, entry.pctBp); if (target < prior) out.errors.push('below-prior'); }
  } else out.errors.push('blank');
  if (target != null && target > fee) out.errors.push('over-fee');
  out.targetCents = target;
  out.amountCents = target == null ? null : target - prior;
  out.throughBp = target == null ? null : centsToBp(target, fee);
  out.remainingCents = target == null ? null : fee - target; // what is left of the phase fee AFTER this billing
  return out;
}

/* entries: { [phaseId]: entry }. Returns every line and the project's totals. */
function evaluate(phases, entries) {
  const lines = phases.map(p => phaseLine(p, (entries || {})[p.id]));
  const ok = lines.every(l => l.amountCents != null);
  return {
    lines,
    totalCents: ok ? lines.reduce((a, l) => a + l.amountCents, 0) : null,
    feeCents: lines.reduce((a, l) => a + l.feeCents, 0),
    billedCents: lines.reduce((a, l) => a + l.billedCents, 0),
    pendingCents: lines.reduce((a, l) => a + l.pendingCents, 0),
    projectionCents: lines.reduce((a, l) => a + l.projectionCents, 0),
    errors: lines.filter(l => l.errors.length).map(l => ({ lineId: l.id, errors: l.errors })),
  };
}

/* The three top buttons. Each returns the new entries and whether "No billing this month" is checked. */
function quickAction(phases, action) {
  const entries = {};
  for (const p of phases) {
    const prior = p.billedCents + (p.pendingCents || 0), room = Math.max(0, p.feeCents - prior);
    entries[p.id] = { amountCents: action === 'projection' ? Math.min(room, Math.max(0, p.projectionCents || 0)) : 0 };
  }
  return { entries, noBilling: action === 'none' };
}

/* The person typed in one cell. A positive amount clears "No billing this month". */
function applyEdit(state, phaseId, entry) {
  const entries = Object.assign({}, state.entries, { [phaseId]: entry });
  const positive = (entry && entry.amountCents > 0) || (entry && entry.pctBp != null && state.phases && (() => {
    const p = state.phases.find(x => x.id === phaseId);
    return !!p && bpToCents(p.feeCents, entry.pctBp) > p.billedCents + (p.pendingCents || 0);
  })());
  return { entries, noBilling: positive ? false : !!state.noBilling };
}

const api = { phaseLine, evaluate, quickAction, applyEdit };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else if (typeof window !== 'undefined') window.CompassBillingFixed = api; // fixed and hourly both have evaluate and quickAction, so each keeps its own name
})();
