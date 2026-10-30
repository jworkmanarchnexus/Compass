/* ===== Billing: the hourly (time and materials) form =====
   Pure. Money is whole cents. Tested from tests/fixtures/hourly.json.

   project: { authorizedCents (null when there is no limit), billedCents, pendingCents }
   line:    { id, name, kind: 'labor' | 'expense' | 'consultant', availableCents, projectionCents }
   availableCents is what is unbilled and eligible on that line, already net of amounts pending in other requests.
   entry:   { amountCents } or null for blank. A hold or special instruction is a note, never an amount. */
'use strict';

const isNum = v => typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v);

function evaluate(project, lines, entries) {
  const out = lines.map(l => {
    const e = (entries || {})[l.id];
    const errors = [];
    let amount = null;
    if (!e || !isNum(e.amountCents)) errors.push('blank');
    else { amount = e.amountCents; if (amount < 0) errors.push('negative'); else if (amount > l.availableCents) errors.push('over-available'); }
    return { id: l.id, name: l.name, kind: l.kind, availableCents: l.availableCents, projectionCents: l.projectionCents || 0, amountCents: amount, errors };
  });
  const ok = out.every(l => l.amountCents != null);
  const total = ok ? out.reduce((a, l) => a + l.amountCents, 0) : null;
  const prior = project.billedCents + (project.pendingCents || 0);
  const limit = project.authorizedCents == null ? null : project.authorizedCents;
  const projectErrors = [];
  if (limit != null && total != null && prior + total > limit) projectErrors.push('over-authorization');
  return {
    lines: out,
    totalCents: total,
    authorizedCents: limit,
    billedCents: project.billedCents,
    pendingCents: project.pendingCents || 0,
    remainingAuthorizationCents: limit == null || total == null ? null : limit - prior - total, // after this billing
    projectionCents: out.reduce((a, l) => a + l.projectionCents, 0),
    errors: out.filter(l => l.errors.length).map(l => ({ lineId: l.id, errors: l.errors })),
    projectErrors,
  };
}

/* 'all' bills everything available; 'projection' bills the projection, capped at what is available; 'clear' and 'none' bill nothing
   ('none' also checks "No billing this month"). */
function quickAction(lines, action) {
  const entries = {};
  for (const l of lines) {
    const a = action === 'all' ? l.availableCents : action === 'projection' ? Math.min(l.availableCents, Math.max(0, l.projectionCents || 0)) : 0;
    entries[l.id] = { amountCents: a };
  }
  return { entries, noBilling: action === 'none' };
}

const api = { evaluate, quickAction };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else if (typeof window !== 'undefined') window.CompassBilling = Object.assign(window.CompassBilling || {}, api);
