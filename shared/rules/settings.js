/* ===== Admin settings: defaults, validation, effective dating =====
   "Thresholds are settings, not constants". Every setting is a row with an effective-from time;
   saving a change adds a row, it never overwrites, so a run can say which settings it was built with.
   Pure functions, tested from tests/fixtures/settings.json. */
const DEFAULTS = {
  'run.day': 'first-business-day',
  'run.time': '06:00',
  'run.emailAdmin': true,
  'run.showOnHome': true,
  'run.createCheckinDrafts': true,
  'run.notifyPics': false,
  'include.status': 'active',
  'include.ytdProfitBelow': 0,
  'include.ignoreBilledUnder': 0,
  'include.noPic': 'leave-out-warn',
  'due.newProjectDays': 14,
  'due.afterEntryDays': 30,
  'due.graceUntil': '02-01',
  /* what the narrower roles may see. The spec leaves these open, so the safe answer is the default and Josh can widen it. */
  'access': { marketingTurnaround: false, picBd: false, picPipeline: false },
};

const days = v => Number.isInteger(v) && v >= 0 && v <= 365;
const money = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e9;
const oneOf = list => v => list.includes(v);
const VALIDATORS = {
  'run.day': oneOf(['first-business-day']),
  'run.time': v => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v),
  'run.emailAdmin': v => typeof v === 'boolean',
  'run.showOnHome': v => typeof v === 'boolean',
  'run.createCheckinDrafts': v => typeof v === 'boolean',
  'run.notifyPics': v => typeof v === 'boolean',
  'include.status': oneOf(['active']),
  'include.ytdProfitBelow': v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e9,
  'include.ignoreBilledUnder': money,
  'include.noPic': oneOf(['leave-out-warn', 'unassigned']),
  'due.newProjectDays': days,
  'due.afterEntryDays': days,
  'due.graceUntil': v => typeof v === 'string' && /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v),
  'access': v => !!v && typeof v === 'object' && Object.keys(DEFAULTS.access).every(k => typeof v[k] === 'boolean') && Object.keys(v).length === Object.keys(DEFAULTS.access).length,
};

const isKnown = key => Object.prototype.hasOwnProperty.call(DEFAULTS, key);
const isValid = (key, value) => isKnown(key) && VALIDATORS[key](value);

/* rows = [{ key, value, effectiveFrom }] (any order). The value in force at time `at` (ms), else the default. */
function settingAt(rows, key, at) {
  let best = null;
  for (const r of rows) {
    if (r.key === key && r.effectiveFrom <= at && (!best || r.effectiveFrom >= best.effectiveFrom)) best = r;
  }
  return best ? best.value : DEFAULTS[key];
}
function allAt(rows, at) {
  return Object.fromEntries(Object.keys(DEFAULTS).map(k => [k, settingAt(rows, k, at)]));
}

const settingsApi = { DEFAULTS, isKnown, isValid, settingAt, allAt };
if (typeof module !== 'undefined' && module.exports) module.exports = settingsApi;
else if (typeof window !== 'undefined') window.CompassRules = Object.assign(window.CompassRules || {}, settingsApi);
