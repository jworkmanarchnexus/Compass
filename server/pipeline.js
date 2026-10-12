'use strict';
/* Pipeline watch on the server: takes the weekly snapshot, runs the alert rules, and shapes what each page shows.
   The arithmetic and the rules are modules/pipeline/logic/watch.js (pure, tested). Snapshots are never changed or deleted.
   The only automatic email goes to the Admin, with a count and a link; a PIC is never emailed. */
const { HttpError } = require('./errors');
const watch = require('../modules/pipeline/logic/watch');

const WEEKS = 8;

const picNames = db => Object.fromEntries(db.all('SELECT code, first_name, last_name FROM employees').map(e => [e.code, `${e.first_name} ${e.last_name}`]));

/* every snapshot up to `upto` (default: all), oldest first, in the shape the logic wants */
function history(db, upto) {
  const dates = db.all('SELECT date FROM pipeline_snapshots WHERE date <= ? ORDER BY date', upto || '9999-12-31').map(r => r.date);
  const pur = db.all('SELECT * FROM pursuit_snapshots WHERE snapshot_date <= ? ORDER BY snapshot_date, pursuit_id', upto || '9999-12-31');
  const fc = db.all('SELECT * FROM forecast_snapshots WHERE snapshot_date <= ? ORDER BY snapshot_date, wbs1', upto || '9999-12-31');
  return dates.map(date => ({
    date,
    pursuits: pur.filter(p => p.snapshot_date === date).map(p => ({ id: p.pursuit_id, name: p.name, pic: p.pic, stage: p.stage, winProb: p.win_prob, amount: p.amount })),
    forecast: fc.filter(p => p.snapshot_date === date).map(p => ({ wbs1: p.wbs1, name: p.name, pic: p.pic, amount: p.amount, moved: p.moved })),
  }));
}
const projectList = db => db.all('SELECT wbs1, name, pic, opened FROM pipeline_projects').map(p => ({ wbs1: p.wbs1, name: p.name, pic: p.pic, opened: p.opened }));
const snapshotDates = db => db.all('SELECT date FROM pipeline_snapshots ORDER BY date DESC').map(r => r.date);

/* Take the snapshot for a Monday (default: this week's) from the source. Safe to repeat: a date that already has a snapshot is left alone. */
function takeSnapshot(db, { source, date, settings, now }) {
  if (db.get('SELECT 1 AS x FROM pipeline_snapshots WHERE date = ?', date)) return { created: false, date };
  const data = source.loadPipeline(date);
  const rules = settings['pipeline.rules'];
  db.tx(() => {
    db.run('INSERT INTO pipeline_snapshots (date, taken_at, source) VALUES (?, ?, ?)', date, now || db.now(), source.name || null);
    for (const p of data.pursuits) db.run('INSERT INTO pursuit_snapshots (snapshot_date, pursuit_id, name, pic, stage, win_prob, amount) VALUES (?, ?, ?, ?, ?, ?, ?)', date, p.id, p.name, p.pic, p.stage || null, p.winProb == null ? null : p.winProb, p.amount);
    for (const f of data.forecast) db.run('INSERT INTO forecast_snapshots (snapshot_date, wbs1, name, pic, amount, moved) VALUES (?, ?, ?, ?, ?, ?)', date, f.wbs1, f.name, f.pic, f.amount, f.moved || 0);
    for (const p of data.projects) db.run('INSERT INTO pipeline_projects (wbs1, name, pic, opened, first_seen) VALUES (?, ?, ?, ?, ?) ON CONFLICT(wbs1) DO NOTHING', p.wbs1, p.name, p.pic, p.opened || null, date);
    const names = picNames(db);
    const found = watch.evaluate({ history: history(db, date), projects: projectList(db), rules, picName: c => names[c] || c });
    for (const a of found) db.run('INSERT INTO pipeline_alerts (snapshot_date, rule, severity, pic, title, message, detail_json) VALUES (?, ?, ?, ?, ?, ?, ?)', date, a.rule, a.severity, a.pic || null, a.title, a.message, JSON.stringify(a.detail));
  });
  return { created: true, date, alerts: alertCount(db, date) };
}

/* what is waiting: alerts (not watch items) at a snapshot that nobody has cleared */
function alertCount(db, date) {
  const d = date || (snapshotDates(db)[0]);
  if (!d) return 0;
  return db.get("SELECT COUNT(*) AS n FROM pipeline_alerts WHERE snapshot_date = ? AND severity = 'alert' AND cleared_at IS NULL", d).n;
}

/* the Monday job: the snapshot, then (only if something needs a look) one email to the Admin */
function runWeekly(db, { source, settings, date, mailer, baseUrl, adminEmails }) {
  const out = takeSnapshot(db, { source, date, settings });
  if (out.created && settings['pipeline.emailAdmin'] && mailer && adminEmails.length && out.alerts > 0) {
    mailer.sendToAdmin({ to: adminEmails, subject: `Pipeline watch: ${out.alerts} ${out.alerts === 1 ? 'alert needs' : 'alerts need'} a look`,
      body: `The ${watch.dayText(date)} pipeline snapshot has ${out.alerts} ${out.alerts === 1 ? 'alert' : 'alerts'}.\nOpen it: ${baseUrl}/#/pipeline` });
    out.emailed = true;
  }
  return out;
}

/* ---- what the page shows ---- */
function view(db, viewer, { date, kind }) {
  const dates = snapshotDates(db);
  if (!dates.length) return { dates: [], empty: true };
  const at = date && dates.includes(date) ? date : dates[0];
  const k = kind === 'forecast' ? 'forecast' : 'mwip';
  const hist = history(db, at), projects = projectList(db), names = picNames(db);
  const { rows, firm } = watch.picRows({ history: hist, kind: k, projects, weeks: WEEKS });
  const withName = r => Object.assign(r, { label: r.pic ? names[r.pic] || r.pic : 'Firm' });
  const ranked = rows.map(withName).sort((a, b) => a.label.localeCompare(b.label));
  const alerts = db.all('SELECT * FROM pipeline_alerts WHERE snapshot_date = ? ORDER BY severity, id', at).map(a => ({
    id: a.id, rule: a.rule, severity: a.severity, pic: a.pic, title: a.title, message: a.message, cleared: a.cleared_at != null,
  }));
  const conversions = watch.conversions(hist, projects, c => names[c] || c);
  const chart = watch.picRows({ history: hist, kind: k, projects, weeks: WEEKS }).firm;
  return {
    dates, date: at, latest: at === dates[0], kind: k, weeks: firm.dates,
    rows: ranked, firm: withName(firm),
    thisWeek: { alerts, conversions },
    chart: firm.dates.map((d, i) => ({ date: d, amount: firm.values[i] })),
    canAct: viewer.role === 'admin',
  };
}

/* the pursuit-level (MWIP) or project-level (forecast) detail for one PIC at a snapshot */
function detail(db, viewer, { date, kind, pic }) {
  const dates = snapshotDates(db);
  if (!dates.includes(date)) throw new HttpError(404, 'There is no snapshot for that date.');
  const names = picNames(db);
  if (!names[pic]) throw new HttpError(404, 'That PIC is not in Vantagepoint.');
  const hist = history(db, date), projects = projectList(db);
  const cur = hist[hist.length - 1], prev = hist.length > 1 ? hist[hist.length - 2] : null;
  const isAdmin = viewer.role === 'admin';
  if (kind === 'forecast') {
    const was = new Map((prev ? prev.forecast : []).filter(f => f.pic === pic).map(f => [f.wbs1, f]));
    const first = new Map();
    for (const s of hist) for (const f of s.forecast) if (!first.has(f.wbs1)) first.set(f.wbs1, s.date);
    const items = cur.forecast.filter(f => f.pic === pic).map(f => {
      const w = was.get(f.wbs1);
      const bits = [];
      if (!w && prev) bits.push(`New contract, first seen ${watch.dayText(first.get(f.wbs1))}.`);
      if (w && (f.moved || 0) > (w.moved || 0)) bits.push(`${watch.money(f.moved - (w.moved || 0))} moved into next year.`);
      else if (w && f.amount < w.amount) bits.push('Billed down.');
      return { id: f.wbs1, name: f.name, last: w ? w.amount : null, current: f.amount, change: w ? f.amount - w.amount : null, moved: f.moved || 0, what: bits.join(' ') };
    });
    const gone = prev ? prev.forecast.filter(f => f.pic === pic && !cur.forecast.some(c => c.wbs1 === f.wbs1)).map(f => ({ id: f.wbs1, name: f.name, last: f.amount, current: 0, change: -f.amount, moved: 0, what: 'No longer in the forecast.' })) : [];
    const all = items.concat(gone);
    return { pic, label: names[pic], kind: 'forecast', date, items: all, total: { last: prev ? sumOf(all, 'last') : null, current: sumOf(all, 'current'), change: prev ? sumOf(all, 'current') - sumOf(all, 'last') : null }, unmatched: 0 };
  }
  const log = watch.pursuitLog(hist, projects);
  const was = new Map((prev ? prev.pursuits : []).filter(p => p.pic === pic).map(p => [p.id, p]));
  const notes = isAdmin ? db.all('SELECT n.pursuit_id, n.at, n.body, u.display_name FROM pursuit_notes n LEFT JOIN users u ON u.id = n.user_id ORDER BY n.at').map(n => ({ id: n.pursuit_id, at: n.at, body: n.body, by: n.display_name })) : [];
  const noteFor = id => notes.filter(n => n.id === id);
  const items = [];
  for (const p of cur.pursuits.filter(x => x.pic === pic)) {
    const w = was.get(p.id), e = log.get(p.id);
    const bits = [];
    if (!w && prev) bits.push(`New. First seen ${watch.dayText(e.firstSeen)}.`);
    if (w && p.stage !== w.stage) bits.push(`Stage: ${w.stage} to ${p.stage}.`);
    if (w && p.winProb != null && w.winProb != null && p.winProb !== w.winProb) bits.push(`Win chance ${w.winProb}% to ${p.winProb}%.`);
    items.push({ id: p.id, name: p.name, stage: p.stage, winProb: p.winProb, last: w ? w.amount : null, current: p.amount, change: w ? p.amount - w.amount : null, status: 'active', what: bits.join(' '), notes: noteFor(p.id) });
  }
  let unmatched = 0;
  for (const w of was.values()) {
    if (cur.pursuits.some(p => p.id === w.id)) continue;
    const e = log.get(w.id);
    if (e.outcome === 'converted') items.push({ id: w.id, name: w.name, stage: 'Converted', last: w.amount, current: 0, change: -w.amount, status: 'converted', what: `Became project ${e.wbs1}${e.openedOn ? ', opened ' + watch.dayText(e.openedOn) : ''}. Not a loss.`, notes: noteFor(w.id) });
    else { unmatched++; items.push({ id: w.id, name: w.name, stage: 'Removed', last: w.amount, current: 0, change: -w.amount, status: 'removed', what: `Not in the ${watch.dayText(date)} snapshot. No matching project. Check this one.`, notes: noteFor(w.id) }); }
  }
  const order = { removed: 0, converted: 1, active: 2 };
  items.sort((a, b) => order[a.status] - order[b.status] || (b.current - a.current));
  return { pic, label: names[pic], kind: 'mwip', date, items, total: { last: prev ? sumOf(items, 'last') : null, current: sumOf(items, 'current'), change: prev ? sumOf(items, 'current') - sumOf(items, 'last') : null }, unmatched, canNote: isAdmin };
}
const sumOf = (list, k) => list.reduce((a, x) => a + (x[k] || 0), 0);

function clearAlert(db, user, id) {
  const a = db.get('SELECT * FROM pipeline_alerts WHERE id = ?', id);
  if (!a) throw new HttpError(404, 'That alert does not exist.');
  if (a.cleared_at) return a;
  db.run('UPDATE pipeline_alerts SET cleared_at = ?, cleared_by = ? WHERE id = ?', db.now(), user.id, id);
  return a;
}

function addNote(db, user, { pursuitId, body }) {
  if (typeof body !== 'string' || !body.trim()) throw new HttpError(400, 'Write the note first.');
  if (body.length > 2000) throw new HttpError(400, 'Keep the note under 2,000 characters.');
  if (!db.get('SELECT 1 AS x FROM pursuit_snapshots WHERE pursuit_id = ? LIMIT 1', String(pursuitId))) throw new HttpError(404, 'That pursuit is not in any snapshot.');
  db.run('INSERT INTO pursuit_notes (pursuit_id, at, user_id, body) VALUES (?, ?, ?, ?)', String(pursuitId), db.now(), user.id, body.trim());
}

/* a CSV of the table on screen (opens in Excel) */
function exportCsv(db, viewer, { date, kind }) {
  const v = view(db, viewer, { date, kind });
  if (v.empty) throw new HttpError(404, 'There are no snapshots yet.');
  const q = s => `"${String(s).replace(/"/g, '""')}"`;
  const cents = c => (c == null ? '' : (c / 100).toFixed(2));
  const head = ['PIC', ...v.weeks, 'This week', 'Vs 4 weeks ago', v.kind === 'forecast' ? 'Moved to next year' : 'New pursuits (30d)', 'New contracts (30d)'];
  const lines = [head.map(q).join(',')];
  for (const r of [...v.rows, v.firm]) lines.push([q(r.label), ...r.values.map(cents), cents(r.thisWeek), cents(r.vs4), v.kind === 'forecast' ? cents(r.moved) : r.newPursuits, r.newContracts].join(','));
  return lines.join('\r\n') + '\r\n';
}

module.exports = { WEEKS, history, takeSnapshot, alertCount, runWeekly, view, detail, clearAlert, addNote, exportCsv, snapshotDates, mondayOf: watch.mondayOf, addDays: watch.addDays };
