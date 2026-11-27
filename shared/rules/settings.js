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
  'round.dueBusinessDays': 5,    // each round (the goal check-in, the mid-month update) is due this many weekdays after it opens
  'round.midOpensDays': 14,      // the mid-month update opens this many days after the month is published
  'due.graceUntil': '02-01',
  'due.missedAfterDays': 14,     // a goal not reported on is recorded as Missed this many days after its goal check-in was due
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
  'bd.contractAmount': 'feeConsult', // BD forecast: the full contract amount behind the architectural share: 'feeConsult' (fee + consultant fees) or 'feeConsultReimb' (also the reimbursable allowance)
  /* BD MWIP backlog, the options of Vantagepoint's MWIP report (modules/bd/logic/mwip.js, docs/MWIP-METHOD.md) */
  'bd.mwipBasis': 'weighted',          // 'weighted' (Weighted Fee = fee x probability) or 'estimated' (Est. Fee)
  'bd.mwipAllocation': 'spread',       // 'spread' (by days, estimated start to completion), 'start' or 'completion' (all in that month)
  'bd.mwipPeriod': 'daily',            // calculation period: 'daily', 'semimonthly' or 'monthly' (each reproduced exactly; weekly and bi-weekly are not)
  'bd.mwipStart': 'afterReportMonth',  // 'afterReportMonth' (the month after the report month in full) or 'buildDay' (cut by the days gone when the report is built)
  'bd.mwipThrough': 'yearEnd',         // 'yearEnd' (through Dec 31 of the report year) or a number of months, '1' to '24'
  'bd.noSector': 'keep',         // revenue with no market sector: 'keep' (its own Unassigned row, like Vantagepoint; publishing is not held up), 'ask' (the Admin must pick before publishing) or 'other' (it goes to Other) // who sees each PIC's on-time and kept figures: everyone | principals | admin
  /* Billing (docs/SPEC-billing.md). Money is whole cents. */
  'billing.varianceThreshold': 3000000, // a request whose total differs from the project's monthly projection by MORE than this needs a note to accounting ($30,000)
  'billing.rolloverDay': 12,            // the "clock reset": from this day of the month the next billing month starts and every project is unbilled again
  'billing.businessHours': { start: '08:00', end: '17:00', days: [1, 2, 3, 4, 5] }, // routine immediate emails to processors wait for these hours (days: Sunday is 0)
  /* Dashboards: the fee burn's projected spend = planned hours x billing rate x this percent (modules/dashboard/logic/burn.js).
     Never actual pay or cost rates (Josh, 2026-11-26). 85 is a made-up starting value; Josh sets the real one. */
  'dashboard.projectedSpendPct': 85,
  /* Dashboards: a project's status on the tabs (modules/dashboard/logic/portfolio.js). Below zero is always Needs a look. */
  'dashboard.watchProfitPct': 10,  // year-to-date profit under this % of billed (and not below zero) is Watch
  'dashboard.endingSoonDays': 90,  // the Ending soon chip: projects whose end date is within this many days
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
  /* Projects in Pursuit (docs/SPEC-pip.md). The probabilities each intake stage allows, from the PiP worksheet's Data Points tab
     (the same default as modules/pip/logic/form.js DEFAULT_STAGE_PROBS; a test keeps them equal). */
  'pip.stageProbabilities': {
    'Research': [10], 'Go NoGo Process': [20], 'Fee Proposal Only (No Marketing)': [20], 'Marketing Proposal': [20],
    'Shortlisted': [30, 40], 'Negotiation': [50, 60, 70], 'Awarded': [80, 90], 'Awarded with Interview': [80, 90],
  },
  'pip.cfoThreshold': 1000000, // whole dollars: a fee at or over this shows a warning and the CFO is told on submission
  'pip.recentDays': 30,        // the PiP home lists what was created or withdrawn in this many days (waiting ones always show)
  'pip.admins': [],            // user ids: the PiP admins, who review, return and mark PiPs created in Vantagepoint
  'pip.viewers': [],           // user ids: people who may see the module without being a PIC, PM or PiP admin (for example the sustainability team)
  'pip.primaryAdmin': '',      // user id: the PiP admin told about every submission ('' = nobody)
  'pip.cfo': '',               // user id: the CFO, told about submissions at or over the threshold ('' = nobody)
  /* what the narrower roles may see. The spec leaves these open, so the safe answer is the default and Josh can widen it. */
  'access': { marketingTurnaround: false, picBd: false, picPipeline: false },
  /* Preview (shared/rules/roles.js): each module is 'live' for everyone its role allows, or in 'preview' for the Admin and the testers picked here */
  'release': {
    turnaround: { stage: 'live', testers: [] },
    bd: { stage: 'live', testers: [] },
    pipeline: { stage: 'live', testers: [] },
    billing: { stage: 'live', testers: [] },
  },
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
  'round.dueBusinessDays': v => Number.isInteger(v) && v >= 1 && v <= 20,
  'round.midOpensDays': v => Number.isInteger(v) && v >= 7 && v <= 25,
  'due.graceUntil': v => typeof v === 'string' && /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v),
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
  'bd.contractAmount': oneOf(['feeConsult', 'feeConsultReimb']),
  'bd.noSector': oneOf(['keep', 'ask', 'other']),
  'bd.mwipBasis': oneOf(['weighted', 'estimated']),
  'bd.mwipAllocation': oneOf(['spread', 'start', 'completion']),
  'bd.mwipPeriod': oneOf(['daily', 'semimonthly', 'monthly']),
  'bd.mwipStart': oneOf(['afterReportMonth', 'buildDay']),
  'bd.mwipThrough': v => v === 'yearEnd' || (typeof v === 'string' && /^\d{1,2}$/.test(v) && Number(v) >= 1 && Number(v) <= 24),
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
VALIDATORS['billing.varianceThreshold'] = intIn(0, 1e11);
VALIDATORS['billing.rolloverDay'] = intIn(1, 28);
VALIDATORS['dashboard.projectedSpendPct'] = intIn(1, 200);
VALIDATORS['dashboard.watchProfitPct'] = intIn(0, 100);
VALIDATORS['dashboard.endingSoonDays'] = intIn(30, 365);
const PIP_STEPS = [10, 20, 30, 40, 50, 60, 70, 80, 90];
VALIDATORS['pip.stageProbabilities'] = v => !!v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === Object.keys(DEFAULTS['pip.stageProbabilities']).length
  && Object.keys(DEFAULTS['pip.stageProbabilities']).every(s => Array.isArray(v[s]) && v[s].length >= 1 && v[s].every((p, i) => PIP_STEPS.includes(p) && (i === 0 || p > v[s][i - 1])));
VALIDATORS['pip.cfoThreshold'] = intIn(1, 1e10);
VALIDATORS['pip.recentDays'] = intIn(7, 365);
const userIds = v => Array.isArray(v) && v.length <= 200 && v.every(id => typeof id === 'string' && id.length > 0 && id.length <= 64) && new Set(v).size === v.length;
VALIDATORS['pip.admins'] = userIds;
VALIDATORS['pip.viewers'] = userIds;
VALIDATORS['pip.primaryAdmin'] = v => typeof v === 'string' && v.length <= 64;
VALIDATORS['pip.cfo'] = v => typeof v === 'string' && v.length <= 64;
const hhmm = v => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
VALIDATORS['billing.businessHours'] = v => !!v && typeof v === 'object' && Object.keys(v).length === 3 && hhmm(v.start) && hhmm(v.end) && v.start < v.end
  && Array.isArray(v.days) && v.days.length >= 1 && v.days.every(d => Number.isInteger(d) && d >= 0 && d <= 6) && new Set(v.days).size === v.days.length;

/* release: the same modules as the default, each { stage, testers } with testers a list of distinct user ids. Whether each id is a real person is checked by the server. */
VALIDATORS['release'] = v => !!v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === Object.keys(DEFAULTS.release).length
  && Object.keys(DEFAULTS.release).every(a => {
    const x = v[a];
    return !!x && typeof x === 'object' && Object.keys(x).length === 2 && (x.stage === 'live' || x.stage === 'preview')
      && Array.isArray(x.testers) && x.testers.length <= 200 && x.testers.every(id => typeof id === 'string' && id.length > 0 && id.length <= 64)
      && new Set(x.testers).size === x.testers.length;
  });

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
