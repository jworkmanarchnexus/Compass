'use strict';
/* ===== Staffing projections: the forecast turned into people, month by month =====
   docs/SPEC-staffing.md. Pure: no DOM, no network. Money is whole cents; rates are cents per hour.

   For one month of revenue R (architectural: net of consultants) and a staffing mix (each level's share of the HOURS):
     blended rate  B   = sum over levels of mix% x the level's billing rate
     hours         H   = R / B
     hours at a level  = H x that level's mix%
     people (FTE)      = hours at the level / (standard hours per month x the level's utilization target)
   A project with its own mix (customMixes) uses that mix, and so its own blended rate, instead of the standard one.
   Contracted work (the PMs' forecast) and pipeline work (pursuits, weighted by win probability) are kept apart all the way through.

   A level's billing rate is the average of its categories' rates, weighted by how many people are on staff in each category
   (a plain average when nobody is). The rate of a category is the latest one in effect on the day asked about, unless the Admin
   overrides it.

   levels:  [{ id, label, categories: ['2', '5'], mix: 10, target: 60 }]   mix and target in whole percent; the mixes add to 100
   untracked: ['11', '37']   categories that are neither demand nor capacity (Administration, IT ...)
   rates:   [{ category, rate, effective: 'YYYY-MM-DD' }]                 from the firm's standard rate table
   staff:   [{ category, count }]                                        people on staff now, by billing category */

const round2 = n => Math.round(n * 100) / 100;

/* the latest rate in effect on `at` for each category, then any Admin override: { category: cents per hour } */
function categoryRates(rates, overrides, at) {
  const best = {};
  for (const r of rates || []) {
    if (r.effective > at) continue;
    const cur = best[r.category];
    if (!cur || r.effective >= cur.effective) best[r.category] = r;
  }
  const out = Object.fromEntries(Object.entries(best).map(([k, r]) => [k, r.rate]));
  for (const [k, v] of Object.entries(overrides || {})) out[k] = v;
  return out;
}

const staffBy = staff => {
  const m = {};
  for (const s of staff || []) m[s.category] = (m[s.category] || 0) + s.count;
  return m;
};

/* each level's billing rate (cents per hour, rounded) and which of its categories have no rate */
function levelRates(levels, catRates, staff) {
  const on = staffBy(staff);
  const rates = {}, missing = {};
  for (const l of levels) {
    const priced = l.categories.filter(c => catRates[c] !== undefined);
    missing[l.id] = l.categories.filter(c => catRates[c] === undefined && (on[c] || 0) > 0);
    if (!priced.length) { rates[l.id] = null; continue; }
    const people = priced.reduce((a, c) => a + (on[c] || 0), 0);
    rates[l.id] = Math.round(people
      ? priced.reduce((a, c) => a + catRates[c] * (on[c] || 0), 0) / people
      : priced.reduce((a, c) => a + catRates[c], 0) / priced.length);
  }
  return { rates, missing };
}

/* sum of mix% x rate, cents per hour (unrounded). null when a level in the mix has no rate. mix: { levelId: percent } */
function blendedRate(mix, rates) {
  let b = 0;
  for (const [id, pct] of Object.entries(mix)) {
    if (!pct) continue;
    if (rates[id] === null || rates[id] === undefined) return null;
    b += pct / 100 * rates[id];
  }
  return b;
}

const standardMix = levels => Object.fromEntries(levels.map(l => [l.id, l.mix]));

/* people on staff by level now, and the categories that have people but belong to no level and are not marked untracked */
function capacity(levels, untracked, staff) {
  const on = staffBy(staff);
  const where = {};
  for (const l of levels) for (const c of l.categories) where[c] = l.id;
  const byLevel = Object.fromEntries(levels.map(l => [l.id, 0]));
  const unassigned = [];
  let untrackedCount = 0;
  for (const [c, n] of Object.entries(on)) {
    if (!n) continue;
    if (where[c]) byLevel[where[c]] += n;
    else if ((untracked || []).includes(c)) untrackedCount += n;
    else unassigned.push({ category: c, count: n });
  }
  unassigned.sort((a, b) => Number(a.category) - Number(b.category) || String(a.category).localeCompare(String(b.category)));
  const total = Object.values(byLevel).reduce((a, n) => a + n, 0);
  return { byLevel, total, untracked: untrackedCount, unassigned };
}

/* the whole projection.
   months:      [YYYYMM ...] the months shown, in order
   contracted:  [{ id, month, amount }]   architectural revenue by project and month, cents
   pipeline:    [{ id, month, amount }]   pursuits, weighted by win probability, cents
   customMixes: { id: { levelId: percent } }   a project or pursuit with its own mix (rare; huge projects only)
   -> { months, levels: [{ id, label, rate }], blended, rows: [{ month, contracted: { levelId: fte }, pipeline: {...}, total: {...},
        sum: { contracted, pipeline, total } }], capacity, gaps: { levelId: [needed - on staff, per month] }, warnings, customUsed } */
function project({ months, contracted, pipeline, levels, untracked, rates, overrides, staff, hoursPerMonth, at, customMixes }) {
  const catRates = categoryRates(rates, overrides, at);
  const lr = levelRates(levels, catRates, staff);
  const std = standardMix(levels);
  const stdBlend = blendedRate(std, lr.rates);
  const cap = capacity(levels, untracked, staff);
  const target = Object.fromEntries(levels.map(l => [l.id, l.target]));
  const warnings = [];
  for (const l of levels) {
    if (lr.missing[l.id].length) warnings.push({ kind: 'noRate', level: l.id, categories: lr.missing[l.id] });
    if (l.mix > 0 && !l.target) warnings.push({ kind: 'noTarget', level: l.id });
  }
  for (const u of cap.unassigned) warnings.push({ kind: 'unassigned', category: u.category, count: u.count });

  const inMonths = new Set(months);
  const empty = () => Object.fromEntries(levels.map(l => [l.id, 0]));
  const acc = Object.fromEntries(months.map(m => [m, { contracted: empty(), pipeline: empty() }]));
  const customUsed = new Set(), unpriced = new Set();
  const blendOf = {};
  const add = (kind, row) => {
    if (!inMonths.has(row.month) || !row.amount) return;
    const own = customMixes && customMixes[row.id];
    const mix = own || std;
    if (own) customUsed.add(row.id);
    if (!(row.id in blendOf)) blendOf[row.id] = own ? blendedRate(own, lr.rates) : stdBlend;
    const b = blendOf[row.id];
    if (!b) { unpriced.add(row.id); return; }
    const hours = row.amount / b;
    for (const [id, pct] of Object.entries(mix)) {
      if (!pct || !(id in target)) continue;
      const perPerson = hoursPerMonth * (target[id] / 100);
      if (!perPerson) continue;
      acc[row.month][kind][id] += hours * pct / 100 / perPerson;
    }
  };
  for (const r of contracted || []) add('contracted', r);
  for (const r of pipeline || []) add('pipeline', r);
  if (unpriced.size) warnings.push({ kind: 'noBlend', ids: [...unpriced].sort() });

  const rows = months.map(m => {
    const c = acc[m].contracted, p = acc[m].pipeline;
    const total = Object.fromEntries(levels.map(l => [l.id, round2(c[l.id] + p[l.id])]));
    const cR = Object.fromEntries(levels.map(l => [l.id, round2(c[l.id])]));
    const pR = Object.fromEntries(levels.map(l => [l.id, round2(p[l.id])]));
    const raw = o => levels.reduce((a, l) => a + o[l.id], 0);
    return { month: m, contracted: cR, pipeline: pR, total, sum: { contracted: round2(raw(c)), pipeline: round2(raw(p)), total: round2(raw(c) + raw(p)) } };
  });
  const gaps = Object.fromEntries(levels.map(l => [l.id, {
    contracted: rows.map(r => round2(r.contracted[l.id] - cap.byLevel[l.id])),
    total: rows.map(r => round2(r.total[l.id] - cap.byLevel[l.id])),
  }]));
  return {
    months,
    levels: levels.map(l => ({ id: l.id, label: l.label, categories: l.categories, mix: l.mix, target: l.target, rate: lr.rates[l.id] })),
    blended: stdBlend === null ? null : Math.round(stdBlend),
    rows, capacity: cap, gaps, warnings, customUsed: [...customUsed].sort(),
  };
}

/* The months to show: `count` months starting the month after `today` (YYYY-MM-DD). */
function monthsAfter(today, count) {
  let y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const out = [];
  for (let i = 0; i < count; i++) { m++; if (m > 12) { m = 1; y++; } out.push(y * 100 + m); }
  return out;
}

/* The checks on the Admin's levels as a whole (mix adds to 100 and so on) are settings rules: shared/rules/settings.js staffingProblem. */

const staffingApi = { categoryRates, levelRates, blendedRate, standardMix, capacity, project, monthsAfter };
if (typeof module !== 'undefined' && module.exports) module.exports = staffingApi;
else if (typeof window !== 'undefined') window.CompassStaffing = staffingApi;
