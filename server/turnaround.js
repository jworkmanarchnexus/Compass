'use strict';
/* Project Turnaround, on the database: the page's numbers, a project's plan page, the check-in queue, the daily job.
   All rules come from modules/turnaround/logic (pure, tested). Role filtering happens HERE, on the server:
   a commitment's lever and number, and the actual result, are sent to the Admin only. */
const crypto = require('node:crypto');
const { HttpError } = require('./errors');
const plan = require('../modules/turnaround/logic/plan');
const draftsLogic = require('../modules/turnaround/logic/drafts');
const lifecycle = require('../modules/turnaround/logic/lifecycle');
const schedule = require('../modules/turnaround/logic/schedule');
const { daysBetween, isWeekday, year } = require('../modules/turnaround/logic/dates');
const runsDb = require('./runs');
const planDb = require('./plan');

const REMARK_KINDS = ["explanation", "update", "correction"]; // what "latest update" can show: the PIC's narrative, not a commitment

function directory(db) {
  const emp = Object.fromEntries(db.all('SELECT code, first_name, last_name FROM employees').map(e => [e.code, `${e.first_name} ${e.last_name}`]));
  const userByCode = Object.fromEntries(db.all("SELECT * FROM users WHERE role = 'pic' AND employee_code IS NOT NULL").map(u => [u.employee_code, u]));
  const userById = Object.fromEntries(db.all('SELECT * FROM users').map(u => [u.id, u]));
  return { emp, userByCode, userById, name: code => (code ? emp[code] || code : 'Unassigned') };
}

const cycleEntries = (entries, today) => entries.filter(e => year(e.date) === year(today));

/* everything the Project Turnaround page shows for one run, as seen by `viewer` ({ role, userId, employeeCode }) */
function buildOverview(db, runId, viewer, { today, settings }) {
  const detail = runsDb.runDetail(db, runId, { withWarnings: false });
  const dir = directory(db);
  const wbs = detail.projects.map(p => p.wbs1);
  const entries = planDb.entriesByProject(db, wbs);
  const appeared = planDb.firstAppeared(db);
  const vis = settings['visibility.picRecords'];
  const canSeeRecord = code => viewer.role === 'admin' || (viewer.role === 'pic' && viewer.employeeCode === code) || vis === 'everyone' || (vis === 'principals' && viewer.role === 'pic');

  const picsByCode = new Map();
  for (const p of detail.projects) {
    const all = entries.get(p.wbs1);
    const cycle = cycleEntries(all, today);
    const fa = appeared.get(p.wbs1) || today;
    const st = plan.planStatus({ today, firstAppeared: fa, entries: all, settings });
    const states = plan.commitmentStates(cycle);
    const lastRemark = cycle.filter(e => REMARK_KINDS.includes(e.kind)).slice(-1)[0] || null;
    const commitText = id => (cycle.find(e => e.id === id) || {}).body || '';
    const next = st.nextCommitment;
    const row = {
      wbs1: p.wbs1, name: p.name, pm: p.pm, billed: p.billed, profit: p.profit, firstSeenPeriod: p.firstSeenPeriod,
      pctYtd: p.billed.ytd ? 100 * p.profit.ytd / p.billed.ytd : null,
      plan: { status: st.status, dueDate: st.dueDate, daysOverdue: st.daysOverdue },
      latest: lastRemark ? { date: lastRemark.date, text: lastRemark.body } : null,
      next: next ? { dueDate: next.dueDate, promisedBy: next.promisedBy, text: commitText(next.id), revisions: next.revisions.length, pastDue: next.dueDate < today, daysPastDue: Math.max(0, daysBetween(next.dueDate, today)) } : null,
      earlierMissed: states.filter(s => s.status === 'missed').length,
    };
    if (!picsByCode.has(p.pic.code)) picsByCode.set(p.pic.code, { code: p.pic.code, name: p.pic.name, projects: [], _on: { onTime: 0, total: 0 }, _kept: { kept: 0, resolved: 0 } });
    const g = picsByCode.get(p.pic.code);
    g.projects.push(row);
    const ot = plan.onTimeStats({ today, firstAppeared: fa, entries: all, settings });
    g._on.onTime += ot.onTime; g._on.total += ot.total;
    const ks = plan.keptStats(states);
    g._kept.kept += ks.kept; g._kept.resolved += ks.resolved;
  }

  const picHist = {};
  for (const r of db.all('SELECT pic_code, period, negative_ytd, below_count FROM run_pic_history WHERE run_id = ? ORDER BY period', runId)) (picHist[r.pic_code] = picHist[r.pic_code] || []).push({ period: r.period, negativeYtd: r.negative_ytd, belowCount: r.below_count });
  const yearStart0 = Math.floor(detail.run.period / 100) * 100 + 1;
  const pics = [...picsByCode.values()].map(g => {
    const totals = g.projects.reduce((a, p) => ({ profit: a.profit + p.profit.ytd, billed: a.billed + p.billed.ytd }), { profit: 0, billed: 0 });
    const user = dir.userByCode[g.code];
    const st = plan.standing({ onTime: g._on, kept: g._kept }, settings);
    return {
      code: g.code, name: g.name, userId: user ? user.id : null, projects: g.projects,
      history: (picHist[g.code] || []).map(h => Object.assign({}, h, { lastYear: h.period < yearStart0 })), // [] for a run built before per-PIC history existed
      totals, plansCurrent: { current: g.projects.filter(p => p.plan.status === 'current').length, total: g.projects.length },
      record: canSeeRecord(g.code) ? { onTime: g._on, kept: g._kept, pctOnTime: st.pctOnTime, pctKept: st.pctKept, standing: st.label } : null,
    };
  });

  const all = pics.flatMap(p => p.projects);
  const waiting = db.get("SELECT COUNT(*) AS n FROM checkin_drafts WHERE status = 'waiting'").n;
  const kpis = {
    projectCount: all.length, negativeYtd: detail.summary.negativeYtd, billedYtd: detail.summary.billedYtd,
    plansCurrent: all.filter(p => p.plan.status === 'current').length,
    pastDue: all.filter(p => p.plan.status === 'overdue').length,
    noPlan: all.filter(p => p.plan.status === 'no_plan').length,
    updateDue: all.filter(p => p.plan.status === 'update_due').length,
    draftsReady: viewer.role === 'admin' ? waiting : null,
  };

  // against the last published run before this one
  const prevRow = db.all("SELECT * FROM runs WHERE kind = ? AND status = 'published' AND period < ? ORDER BY period DESC, version DESC LIMIT 1", runsDb.KIND, detail.run.period)[0];
  let since = null;
  if (prevRow) {
    const prev = Object.fromEntries(db.all('SELECT wbs1, profit_ytd FROM run_projects WHERE run_id = ?', prevRow.id).map(r => [r.wbs1, r.profit_ytd]));
    const cur = Object.fromEntries(all.map(p => [p.wbs1, p.profit.ytd]));
    const both = Object.keys(cur).filter(w => w in prev);
    since = {
      period: prevRow.period, label: schedule.periodLabel(prevRow.period),
      off: Object.keys(prev).filter(w => !(w in cur)).length, added: Object.keys(cur).filter(w => !(w in prev)).length,
      improved: both.filter(w => cur[w] > prev[w]).length, worse: both.filter(w => cur[w] < prev[w]).length,
      negativeYtd: db.get('SELECT COALESCE(SUM(profit_ytd), 0) AS s FROM run_projects WHERE run_id = ?', prevRow.id).s,
      count: Object.keys(prev).length,
    };
  }
  const yearStart = Math.floor(detail.run.period / 100) * 100 + 1;
  const history = db.all('SELECT period, negative_ytd, below_count FROM run_history WHERE run_id = ? ORDER BY period', runId)
    .map(h => ({ period: h.period, negativeYtd: h.negative_ytd, belowCount: h.below_count, lastYear: h.period < yearStart }));

  return { run: detail.run, today, kpis, since, history, pics, viewer: { role: viewer.role, picCode: viewer.employeeCode || null } };
}

/* one project's plan page */
function buildPlanPage(db, wbs1, viewer, { today, settings, cycle }) {
  const project = planDb.projectOr404(db, wbs1);
  const dir = directory(db);
  const isAdmin = viewer.role === 'admin';
  const all = planDb.entriesFor(db, project.wbs1);
  const years = [...new Set(all.map(e => year(e.date)).concat(year(today)))].sort().reverse();
  const cyc = years.includes(cycle) ? cycle : year(today);
  const inCycle = all.filter(e => year(e.date) === cyc);
  const appeared = planDb.firstAppeared(db).get(project.wbs1) || today;
  const status = cyc === year(today) ? plan.planStatus({ today, firstAppeared: appeared, entries: all, settings }) : null;
  const states = plan.commitmentStates(inCycle);
  const byId = new Map(inCycle.map(e => [e.id, e]));
  const authorName = id => (id ? (dir.userById[id] ? dir.userById[id].display_name : 'Unknown') : null);

  const commitments = states.map(s => {
    const e = byId.get(s.id);
    const c = { id: s.id, text: e.body, promisedBy: s.promisedBy, dueDate: s.dueDate, status: s.status, closedDate: s.closedDate, kept: s.kept,
      revisions: s.revisions.map(r => ({ from: r.from, to: r.to, date: r.date, reason: (inCycle.find(x => x.kind === 'date_revised' && x.commitmentId === s.id && x.data.to === r.to && x.date === r.date) || {}).body || '' })) };
    if (isAdmin) {
      const lever = plan.LEVERS[e.data.lever] || {};
      const doneE = inCycle.find(x => x.kind === 'done' && x.commitmentId === s.id);
      Object.assign(c, { lever: e.data.lever, leverLabel: lever.label, unit: lever.unit, qty: e.data.qty, actual: doneE ? doneE.data.actual : null });
    }
    return c;
  }).sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || (a.status === 'open' ? a.dueDate.localeCompare(b.dueDate) : b.closedDate.localeCompare(a.closedDate)));

  const correctedOn = new Map();
  for (const e of inCycle) if (e.kind === 'correction' && e.correctsEntryId) correctedOn.set(e.correctsEntryId, e.date);
  const firstMine = inCycle.find(e => plan.PIC_KINDS.includes(e.kind));
  const stateById = new Map(states.map(s => [s.id, s]));
  const entries = inCycle.slice().reverse().map(e => {
    const out = { id: e.id, kind: e.kind, author: e.authorId ? { id: e.authorId, name: authorName(e.authorId) } : null, at: e.createdAt, date: e.date, body: e.body,
      commitmentId: e.commitmentId || null, correctsEntryId: e.correctsEntryId || null, correctedOn: correctedOn.get(e.id) || null, planOpened: !!firstMine && firstMine.id === e.id };
    if (e.kind === 'commitment') out.promisedBy = e.data.promisedBy;
    if (e.kind === 'date_revised') Object.assign(out, { from: e.data.from, to: e.data.to });
    if (e.kind === 'missed') out.dueDate = e.data.dueDate;
    if (e.kind === 'done') out.daysEarly = stateById.get(e.commitmentId) ? daysBetween(e.date, stateById.get(e.commitmentId).dueDate) : null;
    if (e.commitmentId && e.kind !== 'commitment') { const c = byId.get(e.commitmentId); out.commitmentText = c ? c.body : ''; }
    if (e.correctsEntryId) { const o = byId.get(e.correctsEntryId) || all.find(x => x.id === e.correctsEntryId); out.correctsKind = o ? o.kind : null; out.correctsDate = o ? o.date : null; }
    if (isAdmin) {
      if (e.kind === 'commitment') { const lv = plan.LEVERS[e.data.lever] || {}; Object.assign(out, { lever: e.data.lever, leverLabel: lv.label, unit: lv.unit, qty: e.data.qty }); }
      if (e.kind === 'done') out.actual = e.data.actual;
    }
    return out;
  });

  // the figures and the little chart come from the newest published run this project is in
  const runRow = db.all("SELECT r.* FROM runs r JOIN run_projects rp ON rp.run_id = r.id WHERE rp.wbs1 = ? AND r.status = 'published' ORDER BY r.period DESC, r.version DESC LIMIT 1", project.wbs1)[0];
  let facts = null; let series = [];
  if (runRow) {
    const rp = db.get('SELECT * FROM run_projects WHERE run_id = ? AND wbs1 = ?', runRow.id, project.wbs1);
    facts = { period: runRow.period, label: schedule.periodLabel(runRow.period), billedYtd: rp.billed_ytd, profitYtd: rp.profit_ytd,
      pctYtd: rp.billed_ytd ? 100 * rp.profit_ytd / rp.billed_ytd : null, pctJtd: rp.billed_jtd ? 100 * rp.profit_jtd / rp.billed_jtd : null };
    series = db.all('SELECT period, profit_ytd FROM run_project_history WHERE run_id = ? AND wbs1 = ? ORDER BY period', runRow.id, project.wbs1).map(r => ({ period: r.period, profitYtd: r.profit_ytd }));
  }
  const pic = dir.userByCode[project.principal];
  const mine = viewer.role === 'pic' && planDb.isProjectPic({ employee_code: viewer.employeeCode }, project);
  return {
    project: { wbs1: project.wbs1, name: project.name, status: project.status, pic: { code: project.principal, name: dir.name(project.principal), draftName: pic ? pic.draft_name : null }, pm: { code: project.proj_mgr, name: dir.name(project.proj_mgr) } },
    cycle: cyc, cycles: years, opened: firstMine ? firstMine.date : null,
    status: status ? { status: status.status, dueDate: status.dueDate, daysOverdue: status.daysOverdue, hasPlan: status.hasPlan } : null,
    commitments, entries, facts, series,
    can: { addEntry: mine && cyc === year(today) && project.status === 'A', adminNote: isAdmin },
    levers: isAdmin || mine ? Object.entries(plan.LEVERS).map(([key, l]) => ({ key, label: l.label, group: l.group, ask: l.ask })) : [],
  };
}

/* ---- the check-in queue ---- */
const draftOut = (r, dir) => {
  const u = dir.userById[r.pic_user_id];
  return { id: r.id, status: r.status, situation: r.situation, step: r.step, tone: r.tone, subject: r.subject, body: r.body, items: JSON.parse(r.items_json),
    createdAt: r.created_at, resolvedAt: r.resolved_at, pic: { id: r.pic_user_id, name: u ? u.display_name : 'Unknown', email: u ? u.email : '' } };
};
const draftRows = db => db.all('SELECT * FROM checkin_drafts ORDER BY created_at, rowid');
const waitingCount = db => db.get("SELECT COUNT(*) AS n FROM checkin_drafts WHERE status = 'waiting'").n;

/* the projects each PIC is accountable for now (the last published run), with their live plan status */
function accountableItems(db, { today, settings }) {
  const cur = lifecycle.currentPublished(runsDb.allRuns(db), runsDb.KIND);
  if (!cur) return { items: [], lastEntryByPic: {} };
  const dir = directory(db);
  const rows = db.all('SELECT * FROM run_projects WHERE run_id = ?', cur.id);
  const entries = planDb.entriesByProject(db, rows.map(r => r.wbs1));
  const appeared = planDb.firstAppeared(db);
  const items = [];
  for (const r of rows) {
    const user = dir.userByCode[r.pic_code];
    if (!user || !user.active) continue; // no one to remind: shows up as a data check, not a draft
    const all = entries.get(r.wbs1);
    const st = plan.planStatus({ today, firstAppeared: appeared.get(r.wbs1) || today, entries: all, settings });
    const nextText = st.nextCommitment ? (all.find(e => e.id === st.nextCommitment.id) || {}).body || '' : '';
    items.push({ wbs1: r.wbs1, name: r.name, picUserId: user.id, status: st.status, daysOverdue: st.daysOverdue, dueDate: st.dueDate, ytdProfit: r.profit_ytd, nextCommitmentText: nextText,
      commitmentDue: st.nextCommitment ? st.nextCommitment.dueDate : null, commitmentPastDue: !!st.nextCommitment && st.nextCommitment.dueDate < today });
  }
  const lastEntryByPic = {};
  for (const e of db.all("SELECT author_id, MAX(entry_date) AS d FROM plan_entries WHERE author_id IS NOT NULL AND kind IN ('explanation','commitment','update','correction','done','date_revised') GROUP BY author_id")) lastEntryByPic[e.author_id] = e.d;
  return { items, lastEntryByPic };
}

const existingDrafts = db => draftRows(db).map(r => ({ id: r.id, picUserId: r.pic_user_id, situation: r.situation, step: r.step, status: r.status, resolvedDate: r.resolved_date, items: JSON.parse(r.items_json) }));

function listCheckins(db, { today, settings }) {
  const dir = directory(db);
  const { items, lastEntryByPic } = accountableItems(db, { today, settings });
  const plans = draftsLogic.planDrafts({ today, items, existing: existingDrafts(db), lastEntryByPic, settings });
  const rows = draftRows(db).map(r => draftOut(r, dir));
  const live = Object.fromEntries(items.map(i => [i.wbs1, i]));
  for (const d of rows) for (const i of d.items) { const l = live[i.wbs1]; if (l) { i.liveDaysOverdue = l.daysOverdue; i.liveStatus = l.status; } }
  return {
    waiting: rows.filter(d => d.status === 'waiting'),
    sent: rows.filter(d => d.status === 'sent').reverse().slice(0, 20),
    dismissed: rows.filter(d => d.status === 'dismissed').reverse().slice(0, 10),
    escalate: plans.escalate.map(x => Object.assign({}, x, { picName: dir.userById[x.picUserId] ? dir.userById[x.picUserId].display_name : 'Unknown' })),
    ladder: { reminder1: settings['ladder.reminder1Days'], reminder2: settings['ladder.reminder2Days'], escalate: settings['ladder.escalateDays'] },
  };
}

function setDraftStatus(db, id, to, today) {
  const r = db.get('SELECT * FROM checkin_drafts WHERE id = ?', String(id));
  if (!r) throw new HttpError(404, 'Draft not found.');
  const ok = { send: r.status === 'waiting', dismiss: r.status === 'waiting', undo: r.status === 'sent' || r.status === 'dismissed' }[to];
  if (!ok) throw new HttpError(409, to === 'undo' ? 'Only a sent or dismissed draft can be undone.' : 'This draft is no longer waiting.');
  if (to === 'undo') db.run("UPDATE checkin_drafts SET status = 'waiting', resolved_at = NULL, resolved_date = NULL WHERE id = ?", id);
  else db.run('UPDATE checkin_drafts SET status = ?, resolved_at = ?, resolved_date = ? WHERE id = ?', to === 'send' ? 'sent' : 'dismissed', db.now(), today, id);
  return db.get('SELECT * FROM checkin_drafts WHERE id = ?', id);
}

function editDraft(db, id, { subject, body }) {
  const r = db.get('SELECT * FROM checkin_drafts WHERE id = ?', String(id));
  if (!r) throw new HttpError(404, 'Draft not found.');
  if (r.status !== 'waiting') throw new HttpError(409, 'Only a waiting draft can be edited.');
  if (typeof subject !== 'string' || !subject.trim() || typeof body !== 'string' || !body.trim()) throw new HttpError(400, 'A draft needs a subject and a message.');
  if (subject.length > 200 || body.length > 8000) throw new HttpError(400, 'That is too long.');
  db.run('UPDATE checkin_drafts SET subject = ?, body = ? WHERE id = ?', subject.trim(), body.trim(), id);
}

/* ---- the daily job: record missed commitments, prepare drafts, email the admin once ----
   Safe to run twice in a day. It never contacts a PIC. */
function dailyChecks(db, { today, settings, mailer, baseUrl, adminEmails }) {
  const out = { missed: 0, created: 0, withdrawn: 0, emailed: false };
  db.tx(() => {
    // 1. commitments past their date by the Admin's number of days are recorded as Missed
    const projects = db.all("SELECT DISTINCT wbs1 FROM plan_entries WHERE kind = 'commitment' AND entry_date >= ?", `${year(today)}-01-01`).map(r => r.wbs1);
    const map = planDb.entriesByProject(db, projects);
    for (const [wbs1, all] of map) {
      for (const c of plan.commitmentsToMiss(cycleEntries(all, today), today, settings['due.missedAfterDays'])) { planDb.recordMissed(db, wbs1, c, today); out.missed++; }
    }
    // 2. drafts, from the live state
    const { items, lastEntryByPic } = accountableItems(db, { today, settings });
    const dir = directory(db);
    const plans = draftsLogic.planDrafts({ today, items, existing: existingDrafts(db), lastEntryByPic, settings });
    for (const id of plans.withdraw) { db.run("UPDATE checkin_drafts SET status = 'withdrawn', resolved_at = ?, resolved_date = ? WHERE id = ?", db.now(), today, id); out.withdrawn++; }
    for (const d of settings['run.createCheckinDrafts'] ? plans.create : []) {
      const u = dir.userById[d.picUserId];
      const picName = (u.draft_name || u.display_name.split(' ')[0]);
      const t = draftsLogic.draftText({ tone: d.tone, situation: d.situation, picName, items: d.items });
      db.run('INSERT INTO checkin_drafts (id, pic_user_id, situation, step, tone, subject, body, items_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        crypto.randomUUID(), d.picUserId, d.situation, d.step, d.tone, t.subject, t.body, JSON.stringify(d.items), 'waiting', db.now());
      out.created++;
    }
  });
  // 3. the one email: weekdays, only if something is waiting, a count and a link, once a day
  const n = waitingCount(db);
  const sentToday = db.get("SELECT value FROM system_state WHERE key = 'drafts-email-date'");
  if (settings['drafts.emailAdmin'] && mailer && adminEmails.length && n > 0 && isWeekday(today) && !(sentToday && sentToday.value === today)) {
    mailer.sendToAdmin({ to: adminEmails, subject: `Check-in drafts waiting: ${n}`, body: `${n} check-in draft${n === 1 ? ' is' : 's are'} waiting for you to read and send.\nOpen the queue: ${baseUrl}/#/turnaround/checkins` });
    db.run("INSERT INTO system_state (key, value) VALUES ('drafts-email-date', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", today);
    out.emailed = true;
  }
  return out;
}

/* ---- Commitment patterns (Admin only: this is where the lever and the number are visible) ---- */
function commitmentPatterns(db, { today }) {
  const wbs = db.all("SELECT DISTINCT wbs1 FROM plan_entries WHERE kind = 'commitment' AND entry_date >= ?", `${year(today)}-01-01`).map(r => r.wbs1);
  const map = planDb.entriesByProject(db, wbs);
  const rows = Object.fromEntries(Object.entries(plan.LEVERS).map(([k, l]) => [k, { lever: k, label: l.label, group: l.group, unit: l.unit, count: 0, open: 0, kept: 0, notKept: 0, promised: 0, actual: 0 }]));
  for (const all of map.values()) {
    const cyc = cycleEntries(all, today);
    for (const s of plan.commitmentStates(cyc)) {
      const e = cyc.find(x => x.id === s.id);
      const r = rows[e.data.lever]; if (!r) continue;
      r.count++; r.promised += e.data.qty;
      if (s.status === 'open') r.open++; else if (s.kept) r.kept++; else r.notKept++;
      const d = cyc.find(x => x.kind === 'done' && x.commitmentId === s.id);
      if (d) r.actual += d.data.actual;
    }
  }
  return Object.values(rows);
}

module.exports = { buildOverview, buildPlanPage, listCheckins, setDraftStatus, editDraft, dailyChecks, waitingCount, commitmentPatterns, directory };
