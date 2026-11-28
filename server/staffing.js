'use strict';
/* Staffing projections on the server: reads the source (the Vantagepoint pull; made-up files locally), the Admin settings and the
   rare per-project mixes, and hands them to the pure rule (modules/staffing/logic/staffing.js). Nothing is stored: the page is
   worked out each time it is opened, from the pull as it is now (like Pipeline watch's live view, not a published report). */
const S = require('../modules/staffing/logic/staffing');
const { HttpError } = require('./errors');

/* the per-project mixes in force on `today`: { id: { levelId: percent } }. A row that no longer fits the levels (a level was
   renamed or removed, or it does not add to 100) is ignored and reported, so a settings change can never quietly break it. */
function customMixes(db, today, levels) {
  const ids = new Set(levels.map(l => l.id));
  const latest = new Map();
  for (const r of db.all('SELECT wbs1, effective_from, mix_json FROM staffing_custom_mix WHERE effective_from <= ? ORDER BY wbs1, effective_from', today)) latest.set(r.wbs1, r.mix_json);
  const mixes = {}, broken = [];
  for (const [id, json] of latest) {
    const mix = JSON.parse(json);
    if (mix === null) continue; // back on the standard mix
    const ok = mix && typeof mix === 'object' && Object.keys(mix).every(k => ids.has(k)) && Object.values(mix).every(v => Number.isInteger(v) && v >= 0)
      && Object.values(mix).reduce((a, v) => a + v, 0) === 100;
    if (ok) mixes[id] = mix; else broken.push(id);
  }
  return { mixes, broken };
}

const noSource = source => typeof source.loadStaffing !== 'function';

/* what the page shows. settings = all settings in force; today = 'YYYY-MM-DD' */
function page(db, source, settings, today) {
  if (noSource(source)) return { available: false, today };
  const data = source.loadStaffing();
  const levels = settings['staffing.levels'], untracked = settings['staffing.untracked'];
  const months = S.monthsAfter(today, settings['staffing.monthsShown']);
  const cm = customMixes(db, today, levels);
  const out = S.project({
    months, contracted: data.contracted, pipeline: data.pipeline, levels, untracked,
    rates: data.rates, overrides: settings['staffing.rateOverrides'], at: today,
    staff: data.categories.map(c => ({ category: c.code, count: c.staff })),
    hoursPerMonth: settings['staffing.hoursPerMonth'], customMixes: cm.mixes,
  });
  const title = Object.fromEntries(data.categories.map(c => [c.code, c.title]));
  const names = {};
  for (const r of data.contracted.concat(data.pipeline)) names[r.id] = r.name;
  const warnings = out.warnings.map(w => Object.assign({}, w, w.category ? { title: title[w.category] || '' } : {}, w.categories ? { titles: w.categories.map(c => title[c] || c) } : {}));
  for (const id of cm.broken) warnings.push({ kind: 'brokenMix', id, name: names[id] || id });
  const inWindow = rows => new Set(rows.filter(r => months.includes(r.month) && r.amount).map(r => r.id)).size;
  return {
    available: true, today, months,
    firmMonths: settings['staffing.firmMonths'], hoursPerMonth: settings['staffing.hoursPerMonth'], rateTable: data.rateTable || '',
    levels: out.levels.map(l => Object.assign({}, l, { titles: l.categories.map(c => title[c] || c) })),
    blended: out.blended, rows: out.rows, capacity: out.capacity, gaps: out.gaps, warnings,
    customUsed: out.customUsed.map(id => ({ id, name: names[id] || id })),
    counts: { projects: inWindow(data.contracted), pursuits: inWindow(data.pipeline) },
  };
}

/* Admin > Staffing: every billing category with its people, its Vantagepoint rate in effect today (before any override) and where it sits */
function adminInputs(source, settings, today) {
  if (noSource(source)) return { available: false, categories: [] };
  const data = source.loadStaffing();
  const vpRates = S.categoryRates(data.rates, {}, today);
  const where = {};
  for (const l of settings['staffing.levels']) for (const c of l.categories) where[c] = l.id;
  for (const c of settings['staffing.untracked']) where[c] = 'untracked';
  return {
    available: true, rateTable: data.rateTable || '',
    categories: data.categories.map(c => ({ code: c.code, title: c.title, staff: c.staff, vpRate: vpRates[c.code] === undefined ? null : vpRates[c.code], place: where[c.code] || null })),
  };
}

/* the neighborhood leaders must be real, active people (the settings rule checks only the shape) */
function checkLeaders(db, ids) {
  const known = new Set(db.all('SELECT id FROM users WHERE active = 1').map(u => u.id));
  if (ids.some(id => !known.has(id))) throw new HttpError(400, 'One of the neighborhood leaders is not an active person in People.');
}

module.exports = { page, adminInputs, customMixes, checkLeaders };
