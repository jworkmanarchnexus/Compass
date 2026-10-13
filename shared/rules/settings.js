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
  'include.status': 'active',
  'include.ytdProfitBelow': 0,
  'include.ignoreBilledUnder': 0,
  'include.noPic': 'leave-out-warn',
  'due.newProjectDays': 14,
  'due.afterEntryDays': 30,
  'due.cadenceDays': 14,         // check-ins: every this many days from the project's first report, the PIC reports back and makes a new commitment
  'due.graceUntil': '02-01',
  'due.soonDays': 14,            // a plan shows "Update due" when its next update falls within this many days
  'due.missedAfterDays': 14,     // an open commitment is recorded as Missed this many days after its date
  'ladder.reminder1Days': 3,     // reminder ladder, counted from each project's due date
  'ladder.reminder2Days': 10,
  'ladder.escalateDays': 21,
  'drafts.emailAdmin': true,     // the admin's one email when drafts are waiting
  'drafts.skipIfEntryDays': 2,   // no draft for a PIC who added an entry in the last N days (0 = never skip)
  'drafts.skipIfSentDays': 5,    // no draft for a PIC who was sent a reminder in the last N days (0 = never skip)
  'standing.goodOnTime': 85,     // Good standing needs at least this % of updates on time ...
  'standing.goodKept': 80,       // ... and this % of commitments kept
  'standing.escalatedOnTime': 60, // Escalated is below this % on time ...
  'standing.escalatedKept': 50,   // ... or below this % kept
  'standing.minSample': 3,       // a measure needs at least this many items before it counts toward a label
  'visibility.picRecords': 'everyone',
  'bd.onPacePct': 99,            // BD report: On Pace needs YTD revenue at least this % of pace
  'bd.onTrackPct': 100,          // BD report: On Track needs (YTD + forecast + MWIP) at least this % of the goal
  'bd.noSector': 'ask',          // revenue with no market sector: 'ask' (the Admin must pick before publishing) or 'other' (it goes to Other) // who sees each PIC's on-time and kept figures: everyone | principals | admin
  /* Pipeline watch alert rules. sev: 'alert' (counts toward the menu badge), 'watch' (shown only) or 'off'. Amounts are dollars. */
  'pipeline.rules': {
    mwipDrop: { sev: 'alert', amount: 75000, days: 7 },          // a PIC's MWIP falls by this much within this many days
    forecastDrop: { sev: 'alert', amount: 150000, days: 7 },     // a PIC's contracted forecast falls by this much within this many days
    mwipSlide: { sev: 'alert', weeks: 8 },                       // a PIC's MWIP falls this many snapshots in a row
    noMatch: { sev: 'watch', days: 3 },                          // a pursuit left MWIP and no project has its number, this many days on
    unmatchedWin: { sev: 'alert', days: 14 },                    // a pursuit has been Won this many days and still has no project
    winProb: { sev: 'watch', points: 20 },                       // a pursuit's win probability falls this many points in a week
    noNew: { sev: 'watch', days: 30 },                           // a PIC has added no pursuit in this many days
  },
  'pipeline.emailAdmin': true,                                   // the Monday email to the Admin when alerts need a look (never to PICs)
  /* what the narrower roles may see. The spec leaves these open, so the safe answer is the default and Josh can widen it. */
  'access': { marketingTurnaround: false, picBd: false, picPipeline: false },
};

const days = v => Number.isInteger(v) && v >= 0 && v <= 365;
const money = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e9;
const oneOf = list => v => list.includes(v);
const pct = v => Number.isInteger(v) && v >= 0 && v <= 100;
const VALIDATORS = {
  'run.day': oneOf(['first-business-day']),
  'run.time': v => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v),
  'run.emailAdmin': v => typeof v === 'boolean',
  'run.showOnHome': v => typeof v === 'boolean',
  'run.createCheckinDrafts': v => typeof v === 'boolean',
  'include.status': oneOf(['active']),
  'include.ytdProfitBelow': v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e9,
  'include.ignoreBilledUnder': money,
  'include.noPic': oneOf(['leave-out-warn', 'unassigned']),
  'due.newProjectDays': days,
  'due.afterEntryDays': days,
  'due.cadenceDays': v => Number.isInteger(v) && v >= 1 && v <= 90,
  'due.graceUntil': v => typeof v === 'string' && /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v),
  'due.soonDays': days,
  'due.missedAfterDays': days,
  'ladder.reminder1Days': days,
  'ladder.reminder2Days': days,
  'ladder.escalateDays': days,
  'drafts.emailAdmin': v => typeof v === 'boolean',
  'drafts.skipIfEntryDays': days,
  'drafts.skipIfSentDays': days,
  'standing.goodOnTime': pct,
  'standing.goodKept': pct,
  'standing.escalatedOnTime': pct,
  'standing.escalatedKept': pct,
  'standing.minSample': v => Number.isInteger(v) && v >= 1 && v <= 20,
  'bd.onPacePct': pct,
  'bd.onTrackPct': v => Number.isInteger(v) && v >= 50 && v <= 200,
  'bd.noSector': oneOf(['ask', 'other']),
  'visibility.picRecords': oneOf(['everyone', 'principals', 'admin']),
  'access': v => !!v && typeof v === 'object' && Object.keys(DEFAULTS.access).every(k => typeof v[k] === 'boolean') && Object.keys(v).length === Object.keys(DEFAULTS.access).length,
};

const SEVS = ['alert', 'watch', 'off'];
const intIn = (lo, hi) => v => Number.isInteger(v) && v >= lo && v <= hi;
const RULE_SHAPE = { mwipDrop: { amount: intIn(1, 1e9), days: intIn(1, 365) }, forecastDrop: { amount: intIn(1, 1e9), days: intIn(1, 365) }, mwipSlide: { weeks: intIn(2, 26) }, noMatch: { days: intIn(0, 365) }, unmatchedWin: { days: intIn(0, 365) }, winProb: { points: intIn(1, 100) }, noNew: { days: intIn(1, 365) } };
VALIDATORS['pipeline.rules'] = v => !!v && typeof v === 'object' && Object.keys(RULE_SHAPE).every(r => {
  const x = v[r], shape = RULE_SHAPE[r];
  return !!x && typeof x === 'object' && SEVS.includes(x.sev) && Object.keys(shape).every(k => shape[k](x[k])) && Object.keys(x).length === Object.keys(shape).length + 1;
}) && Object.keys(v).length === Object.keys(RULE_SHAPE).length;
VALIDATORS['pipeline.emailAdmin'] = v => typeof v === 'boolean';

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

/* rules that span several settings; `values` is the full set after a change. Returns a plain message, or null when fine. */
function crossCheck(values) {
  if (!(values['ladder.reminder1Days'] < values['ladder.reminder2Days'] && values['ladder.reminder2Days'] < values['ladder.escalateDays'])) return 'The reminder ladder must go in order: reminder 1, then reminder 2, then escalate, each a later day.';
  if (values['standing.escalatedOnTime'] > values['standing.goodOnTime'] || values['standing.escalatedKept'] > values['standing.goodKept']) return 'The Escalated cutoffs cannot be higher than the Good standing cutoffs.';
  return null;
}

const settingsApi = { DEFAULTS, isKnown, isValid, settingAt, allAt, crossCheck };
if (typeof module !== 'undefined' && module.exports) module.exports = settingsApi;
else if (typeof window !== 'undefined') window.CompassRules = Object.assign(window.CompassRules || {}, settingsApi);
