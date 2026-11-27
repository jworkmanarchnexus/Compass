/* ===== Principal Accountability: the firm's "2026 Project Improvement (Accountability)" sheet, one row per PIC =====
   Pure: no database, no network, no clock. Money is whole cents; utilization and overhead rates are basis points
   (10000 = 100%). Percentages are worked out when shown, never stored.

   Built with the Marketing Report from the same monthly pull (server/bd.js), and frozen with it.

   Per PIC (computeRows):
     billedYtd     everything billed on the PIC's projects, January through the report month (gross, as the sheet does)
     profitYtd     Billed - Labor x (1 + overhead%) - Expenses, the Project Turnaround math (turnaround/logic/profit.js),
                   added over the PIC's projects that can be evaluated; `unevaluated` counts the ones that cannot (no overhead rate)
     negativeYtd   the YTD profit of the PIC's projects that are below zero this year, added up (zero or less)
     response      'yes' when every one of the PIC's projects on the Project Turnaround run has a Current plan,
                   'no' when any does not, null when none of the PIC's projects is on it (Josh, 2026-11-26)
     utilizationBp from the source (null when it has none for the PIC)
     goal          the PIC's billed goal for the year, Admin > Accountability (null = no goal)
     backlog       the contracted forecast still to bill through December 31
     mwip          the Marketing Report's MWIP backlog, weighted
     arOver90      receivables more than 90 days old on the PIC's projects

   Worked out when shown (derive):
     toGoal        goal - billedYtd                 (negative = past the goal)
     shortfall     goal - billedYtd - backlog       (negative = backlog more than covers the goal)
     projects      per project size: how many projects of that fee it would take to close the shortfall,
                   ceil(shortfall / fee), 0 when there is no shortfall (Josh, 2026-11-26) */

(function () {
'use strict';
/* wrapped in its own function: in the browser this loads as a plain script beside others, and top-level names would clash */
const sum = (list, f) => list.reduce((a, x) => a + (f(x) || 0), 0);

/* input:
     goals:       { [picCode]: cents }      the year's goals; goalOrder lists the PICs in the Admin's order
     goalOrder:   [picCode]
     projects:    [{ wbs1, principal, billedYtd, profitYtd }]   profitYtd null = cannot be evaluated
     backlog:     { [picCode]: cents }      '' = no PIC
     mwip:        { [picCode]: cents }
     arOver90:    [{ wbs1, amount }]        cents; matched to a PIC through `projects`, else through `picOf`
     picOf:       { [wbs1]: picCode }       optional: more project-to-PIC matches (projects outside the profit list)
     utilization: { [picCode]: basisPoints }
     planStatus:  { [picCode]: ['current' | 'update_due' | 'overdue' | 'no_plan', ...] }  one per project on the Turnaround run
     names:       { [picCode]: 'First Last' }
   returns rows in order: the PICs with a goal (Admin order), then any other PIC with something to show (by name), then Unassigned. */
function computeRows(input) {
  const { goals = {}, goalOrder = [], projects = [], backlog = {}, mwip = {}, arOver90 = [], picOf = {}, utilization = {}, planStatus = {}, names = {} } = input;
  const pic = new Map();
  const cell = code => {
    if (!pic.has(code)) pic.set(code, { key: code, billedYtd: 0, profitYtd: 0, negativeYtd: 0, unevaluated: 0, ar: 0 });
    return pic.get(code);
  };
  const owner = {};
  for (const p of projects) {
    const code = p.principal || '';
    owner[p.wbs1] = code;
    const c = cell(code);
    c.billedYtd += p.billedYtd || 0;
    if (p.profitYtd === null || p.profitYtd === undefined) { if (p.billedYtd) c.unevaluated += 1; continue; }
    c.profitYtd += p.profitYtd;
    if (p.profitYtd < 0) c.negativeYtd += p.profitYtd;
  }
  for (const a of arOver90) {
    const code = a.wbs1 in owner ? owner[a.wbs1] : (picOf[a.wbs1] || '');
    cell(code).ar += a.amount || 0;
  }
  for (const code of Object.keys(backlog).concat(Object.keys(mwip))) cell(code);

  const hasSomething = c => c.billedYtd || c.profitYtd || c.ar || backlog[c.key] || mwip[c.key];
  const ordered = goalOrder.filter(k => k in goals).map(cell);
  const others = [...pic.values()].filter(c => c.key && !(c.key in goals) && hasSomething(c)).sort((a, b) => (names[a.key] || a.key).localeCompare(names[b.key] || b.key));
  const none = pic.has('') && hasSomething(pic.get('')) ? [pic.get('')] : [];

  return ordered.concat(others, none).map(c => {
    const statuses = planStatus[c.key] || [];
    return {
      key: c.key,
      label: c.key ? names[c.key] || c.key : 'Unassigned',
      goal: c.key in goals ? goals[c.key] : null,
      billedYtd: c.billedYtd,
      profitYtd: c.profitYtd,
      negativeYtd: c.negativeYtd,
      unevaluated: c.unevaluated,
      listed: statuses.length,
      response: statuses.length ? (statuses.every(s => s === 'current') ? 'yes' : 'no') : null,
      utilizationBp: c.key in utilization ? utilization[c.key] : null,
      backlog: backlog[c.key] || 0,
      mwip: mwip[c.key] || 0,
      arOver90: c.ar,
    };
  });
}

/* the Totals row: every money column added up; a goal total only if any PIC has a goal */
function totals(rows) {
  const withGoal = rows.filter(r => r.goal !== null && r.goal !== undefined);
  return {
    key: '_total', label: 'Totals',
    goal: withGoal.length ? sum(withGoal, r => r.goal) : null,
    billedYtd: sum(rows, r => r.billedYtd), profitYtd: sum(rows, r => r.profitYtd), negativeYtd: sum(rows, r => r.negativeYtd),
    unevaluated: sum(rows, r => r.unevaluated), listed: sum(rows, r => r.listed), response: null, utilizationBp: null,
    backlog: sum(rows, r => r.backlog), mwip: sum(rows, r => r.mwip), arOver90: sum(rows, r => r.arOver90),
  };
}

/* sizes: [{ label, fee }] with fee in whole dollars. Shortfall and goal in cents. */
function projectsNeeded(shortfall, sizes) {
  return sizes.map(s => (shortfall === null ? null : shortfall > 0 ? Math.ceil(shortfall / (s.fee * 100)) : 0));
}

function derive(row, sizes) {
  const hasGoal = row.goal !== null && row.goal !== undefined;
  const toGoal = hasGoal ? row.goal - row.billedYtd : null;
  const shortfall = hasGoal ? toGoal - row.backlog : null;
  return {
    profitPct: row.billedYtd ? row.profitYtd / row.billedYtd : null,
    toGoal, shortfall,
    projects: projectsNeeded(shortfall, sizes || []),
  };
}

/* pace: the goal times months elapsed over twelve, to the cent (the Marketing Report's rule) */
const pace = (goal, months) => Math.round(goal * months / 12);

/* the firm figures under the table. Any source figure may be missing (null); what depends on it is then null too.
     incomeProfit  the income statement profit (loss), year to date
     esopBonus     the ESOP and bonus contribution, year to date
     archRevenue   architectural revenue, net of consultants (the Marketing Report's YTD revenue)
   difference      incomeProfit - the PICs' project profit added up
   profitOnArch    (incomeProfit + esopBonus) / archRevenue */
function firmFigures(meta, total) {
  const has = v => v !== null && v !== undefined;
  return {
    incomeProfit: has(meta.incomeProfit) ? meta.incomeProfit : null,
    difference: has(meta.incomeProfit) ? meta.incomeProfit - total.profitYtd : null,
    actualOhBp: has(meta.actualOhBp) ? meta.actualOhBp : null,
    assignedOhBp: has(meta.assignedOhBp) ? meta.assignedOhBp : null,
    archRevenue: has(meta.archRevenue) ? meta.archRevenue : null,
    esopBonus: has(meta.esopBonus) ? meta.esopBonus : null,
    profitOnArch: has(meta.incomeProfit) && has(meta.esopBonus) && meta.archRevenue ? (meta.incomeProfit + meta.esopBonus) / meta.archRevenue : null,
  };
}

/* ---- display and export: the same words and figures on the page, the PDF and the CSV ---- */
const dollars = c => {
  if (c === null || c === undefined) return '';
  const n = Math.round(c / 100);
  if (n === 0) return '$-';
  const s = '$' + Math.abs(n).toLocaleString('en-US');
  return n < 0 ? `(${s})` : s;
};
const percent = (x, digits = 0) => (x === null || x === undefined ? '' : `${(100 * x).toFixed(digits)}%`);
const bp = v => (v === null || v === undefined ? '' : `${Math.round(v / 100)}%`);
const RESPONSE = { yes: 'Yes', no: 'No' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const shortDay = ymd => { const [y, m, d] = String(ymd).split('-').map(Number); return `${m}/${d}/${y}`; };

/* the columns, in the sheet's order. `group` is the heading over them. */
function columns(meta) {
  const y = meta.year;
  const cols = [
    { id: 'label', group: '', head: 'PIC', text: r => r.label },
    { id: 'billedYtd', group: 'ytd', head: 'YTD billed', money: true, text: r => dollars(r.billedYtd) },
    { id: 'profitYtd', group: 'ytd', head: 'YTD profit', money: true, text: r => dollars(r.profitYtd) },
    { id: 'profitPct', group: 'ytd', head: 'YTD profit %', text: (r, d) => (r.billedYtd ? percent(d.profitPct) : 'NA') },
    { id: 'negativeYtd', group: 'ytd', head: 'YTD negative profit (all jobs this year)', money: true, text: r => dollars(r.negativeYtd) },
    { id: 'response', group: 'ytd', head: 'Negative profit response', text: r => (r.key === '_total' ? '' : RESPONSE[r.response] || '-') },
    { id: 'utilization', group: 'ytd', head: 'Utilization', text: r => bp(r.utilizationBp) },
    { id: 'goal', group: 'goals', head: `${y} goal`, money: true, text: r => dollars(r.goal) },
    { id: 'toGoal', group: 'goals', head: '$ amount to goal', money: true, text: (r, d) => dollars(d.toGoal) },
    { id: 'backlog', group: 'goals', head: `${y} backlog`, money: true, text: r => dollars(r.backlog) },
    { id: 'shortfall', group: 'goals', head: `${y} shortfall / (excess)`, money: true, text: (r, d) => dollars(d.shortfall) },
    { id: 'mwip', group: 'goals', head: 'ETC MWIP', money: true, text: r => dollars(r.mwip) },
    { id: 'arOver90', group: 'goals', head: 'AR > 90', money: true, text: r => dollars(r.arOver90) },
  ];
  (meta.sizes || []).forEach((s, i) => cols.push({ id: 'p' + i, group: 'projects', head: `${s.label}, ${dollars(s.fee * 100)} fee`, text: (r, d) => (r.key === '_total' || d.projects[i] === null ? '' : String(d.projects[i])) }));
  return cols;
}
function groups(meta) {
  return { ytd: `${meta.year} YTD ${shortDay(meta.cutoff)}`, goals: `${meta.year} goals`, projects: 'Projects to reach goal' };
}

/* the firm block under the table, as label/value pairs */
function firmLines(f) {
  return [
    ['Income statement profit (loss)', dollars(f.incomeProfit)],
    ['Difference from project profit', dollars(f.difference)],
    ['YTD actual overhead rate', bp(f.actualOhBp)],
    ['Assigned overhead rate', bp(f.assignedOhBp)],
    ['Architectural revenue', dollars(f.archRevenue)],
    ['ESOP / bonus contribution', dollars(f.esopBonus)],
    ['Profit on architectural revenue', percent(f.profitOnArch)],
  ];
}

/* the whole report as a grid of strings: the page, the PDF and the CSV all come from here */
function sheet(report) {
  const { meta, rows } = report;
  const cols = columns(meta);
  const total = totals(rows);
  const line = r => { const d = derive(r, meta.sizes); return cols.map(c => c.text(r, d)); };
  const firm = firmFigures(meta, total);
  return {
    title: 'Principal Accountability',
    asOf: shortDay(meta.cutoff),
    groups: groups(meta), columns: cols.map(c => ({ id: c.id, group: c.group, head: c.head, money: !!c.money })),
    body: rows.map(line), total: line(total),
    pace: meta.goalTotal ? { label: `Goal ${shortDay(meta.cutoff)}`, value: dollars(pace(meta.goalTotal, meta.months)) } : null,
    firm: firmLines(firm),
  };
}

/* CSV that Excel opens: the heading rows, the PICs, Totals, the pace line and the firm block */
function toCsv(report) {
  const s = sheet(report);
  const q = v => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const lines = [];
  lines.push([s.title], [`As of ${s.asOf}`], []);
  lines.push(s.columns.map((c, i) => (i === 0 || c.group !== s.columns[i - 1].group ? s.groups[c.group] || '' : '')));
  lines.push(s.columns.map(c => c.head));
  for (const r of s.body) lines.push(r);
  lines.push(s.total);
  if (s.pace) lines.push([s.pace.label, s.pace.value]);
  lines.push([]);
  for (const [k, v] of s.firm) lines.push([k, v]);
  return lines.map(l => l.map(q).join(',')).join('\r\n') + '\r\n';
}

const api = { computeRows, totals, derive, projectsNeeded, pace, firmFigures, dollars, percent, columns, groups, sheet, toCsv, MONTHS };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else if (typeof window !== 'undefined') window.AcctRules = api;
})();
