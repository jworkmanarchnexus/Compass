/* Admin > Pipeline alerts: the rules (each one Alert, Watch or Off, with its thresholds), and the snapshot and email. */
import { Pipeline } from '/shared/platform/index.js';

const RULES = [
  ['mwipDrop', 'MWIP drops fast', 'A PIC\'s MWIP falls by at least this much within this many days.', [['amount', 'dollars', '$'], ['days', 'days']]],
  ['forecastDrop', 'Forecast drops fast', 'A PIC\'s contracted forecast falls by at least this much within this many days. Normal billing lowers it too, so set this above a usual week of billing.', [['amount', 'dollars', '$'], ['days', 'days']]],
  ['mwipSlide', 'MWIP slides, week after week', 'A PIC\'s MWIP falls in this many snapshots in a row, even when no single drop is big.', [['weeks', 'snapshots in a row']]],
  ['noMatch', 'Pursuit left with no matching project', 'A pursuit is gone from MWIP and no project has its number, this many days later. Either it was lost, or it converted and nobody opened the job.', [['days', 'days after it left']]],
  ['unmatchedWin', 'Won, but no project yet', 'A pursuit has been marked Won for this long and no project has its number.', [['days', 'days since Won']]],
  ['winProb', 'Win probability falls', 'A pursuit\'s win chance falls by at least this many points between two snapshots.', [['points', 'points']]],
  ['noNew', 'No new pursuits', 'A PIC has added no pursuit in this many days.', [['days', 'days']]],
];
const SEV = [['alert', 'Alert (on the badge)'], ['watch', 'Watch (page only)'], ['off', 'Off']];

export function pipelineAdminCards(ctx, settings, canEdit, rerender) {
  const { h, settingsCard, row } = ctx;
  const field = (ed, rule, key, unit, prefix) => {
    const rules = ed.draft['pipeline.rules'];
    const el = h('input', { class: 'txt narrow', type: 'text', inputmode: 'numeric', disabled: !canEdit, 'aria-label': `${rule} ${unit}`, value: String(rules[rule][key]) });
    el.addEventListener('input', () => { const t = el.value.replace(/[$,\s]/g, ''); rules[rule][key] = t === '' ? NaN : Number(t); });
    return h('span', { class: 'ctl', style: 'flex:none;gap:6px' }, prefix ? h('span', { text: prefix }) : null, el, h('span', { class: 'muted', text: unit }));
  };
  const sev = (ed, rule, title) => {
    const rules = ed.draft['pipeline.rules'];
    const el = h('select', { class: 'txt', style: 'width:190px', disabled: !canEdit, 'aria-label': `${title}: what it does`, onchange: () => { rules[rule].sev = el.value; } },
      ...SEV.map(([v, t]) => h('option', { value: v, text: t, selected: rules[rule].sev === v })));
    return el;
  };
  const snapMsg = h('span', { class: 'saved', role: 'status' });
  const snapBtn = h('button', { class: 'btn', type: 'button', text: 'Take this week\'s snapshot now', disabled: !canEdit, onclick: async () => {
    snapMsg.textContent = ''; snapMsg.className = 'saved';
    try { const r = await Pipeline.snapshotNow(); snapMsg.textContent = r.created ? `Saved the ${r.date} snapshot. ${r.alerts} alert${r.alerts === 1 ? '' : 's'}.` : `There is already a snapshot for ${r.date}.`; } catch (e) { snapMsg.textContent = e.message; snapMsg.className = 'note err'; }
  } });
  return [
    settingsCard('Alert rules', 'Each rule is an Alert (counts toward the menu badge), a Watch (shown on the page only) or Off. Rules look at each PIC\'s numbers, never at a person.', settings, ['pipeline.rules'], canEdit, rerender,
      ed => RULES.map(([rule, title, help, fields]) => row(title, help, sev(ed, rule, title), ...fields.map(([k, unit, prefix]) => field(ed, rule, k, unit, prefix)))),
      'Changes apply from the next snapshot. Alerts already raised are not changed.'),
    settingsCard('Snapshot and delivery', 'When the numbers are saved and who hears about it.', settings, ['pipeline.emailAdmin'], canEdit, rerender,
      ed => [
        row('Snapshot', 'Every Monday morning the job saves MWIP and contracted forecast as they stand, keeps every snapshot forever, and checks the rules. The schedule itself is set up on the server by Kent (Monday 5:00 a.m. is the plan).', h('span', { class: 'muted', text: 'Monday, 5:00 a.m.' })),
        row('Email', 'Alerts are about the numbers, not the person. The system never emails a PIC; the only automatic email goes to you, with a count and a link, and only when an alert needs a look.', ed.check('pipeline.emailAdmin', 'Email Josh on Monday when alerts need a look')),
        row('Take one now', 'Saves a snapshot for this week if there is not one yet. Locally, the demo history is already in.', snapBtn, snapMsg),
      ], 'Changes apply from the next snapshot.'),
  ];
}
