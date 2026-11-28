'use strict';
/* Principal Accountability on the database: its own monthly run (runs.kind = 'acct'), with the same lifecycle as Project Turnaround
   and the Marketing Report (modules/turnaround/logic/lifecycle.js): a draft, published and locked, archived with a reason and the
   word RERUN. It reads its own inputs from the source and never a Marketing Report figure: the accountability sheet is GROSS
   (Josh, 2026-11-27), the Marketing Report is net of consultants.
   The arithmetic is modules/accountability/logic/accountability.js (pure, tested). */
const crypto = require('node:crypto');
const { HttpError } = require('./errors');
const A = require('../modules/accountability/logic/accountability');
const profitRule = require('../modules/turnaround/logic/profit');
const plan = require('../modules/turnaround/logic/plan');
const lifecycle = require('../modules/turnaround/logic/lifecycle');
const schedule = require('../modules/turnaround/logic/schedule');
const forecastRule = require('../modules/bd/logic/forecast');
const mwipRule = require('../modules/bd/logic/mwip');
const planDb = require('./plan');

const KIND = 'acct';
const label = r => `${schedule.periodLabel(r.period)}, version ${r.version}`;
const allAcct = db => db.all("SELECT * FROM runs WHERE kind = 'acct' ORDER BY period DESC, version DESC");
const life = r => ({ id: r.id, kind: r.kind, period: r.period, version: r.version, status: r.status });
const buildDay = () => { if (process.env.COMPASS_TODAY) return process.env.COMPASS_TODAY; const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

/* MWIP for Accountability: each pursuit's probability-weighted fee, spread by days as Vantagepoint's MWIP report does by default,
   from the month after the report month through December 31, with NO architectural factor (Josh, 2026-11-27). Fixed here on
   purpose, not the Marketing Report's settings, so changing that report never moves this one. */
const MWIP_OPTIONS = Object.assign({}, mwipRule.DEFAULT_OPTIONS, { basis: 'weighted', start: 'afterReportMonth', through: 'yearEnd' });

function getRun(db, id) {
  const r = db.get("SELECT * FROM runs WHERE id = ? AND kind = 'acct'", String(id));
  if (!r) throw new HttpError(404, 'Report not found.');
  return r;
}

/* everything the rows need, as of the report month. `today` is the day plan statuses are read on. */
function compute(db, source, period, settings, today) {
  const year = Math.floor(period / 100);
  // billed and profit: the Project Turnaround math over every project the pull returns, not only the ones below break-even
  const pull = typeof source.load === 'function' ? source.load(period) : { projects: [], ledger: [], overhead: [] };
  const evaluated = profitRule.computeProjects({ projects: pull.projects, ledger: pull.ledger, overhead: pull.overhead, runPeriod: period });
  const projects = evaluated.map(p => ({ wbs1: p.wbs1, principal: p.principal, billedYtd: p.billed.ytd, profitYtd: p.evaluable ? p.profit.ytd : null }));

  const x = typeof source.loadAccountability === 'function' ? source.loadAccountability(period) || {} : {};
  const picOfX = Object.fromEntries((x.projects || []).map(p => [p.wbs1, p.principal || '']));
  const picOf = Object.assign({}, Object.fromEntries(db.all('SELECT wbs1, principal FROM projects').map(p => [p.wbs1, p.principal])), picOfX);
  const add = (map, k, v) => { map[k || ''] = (map[k || ''] || 0) + v; };

  // backlog: the PMs' plan revenue still to bill through December 31, GROSS as entered (spread by working days when the source
  // gives the entries themselves; otherwise the source's own gross amounts per project)
  const backlog = {};
  if (x.forecastEntries) {
    const f = forecastRule.computeForecast({ entries: x.forecastEntries, holidays: x.holidays || [], period });
    for (const [wbs1, gross] of Object.entries(f.gross)) add(backlog, picOf[wbs1], gross);
  } else for (const f of x.forecast || []) add(backlog, picOf[f.wbs1], f.amount);

  // ETC MWIP: probability-weighted fee, no factor
  const mwip = {};
  if (x.pursuits) for (const m of mwipRule.computeMwip({ pursuits: x.pursuits, period, buildDate: today, options: MWIP_OPTIONS }).mwip) add(mwip, m.pic, m.amount);
  else for (const m of x.mwip || []) add(mwip, m.pic, m.amount);

  // the firm block's architectural revenue: revenue net of consultants, January through the report month (the sheet's "Arch Revenue")
  const archRevenue = (x.revenue || []).filter(r => r.period === undefined || (r.period <= period && r.period >= year * 100 + 1)).reduce((a, r) => a + r.amount, 0);

  // the response column: plan status, as of `today`, of each PIC's projects on the latest published Project Turnaround run for this month or before
  const tr = db.get("SELECT id, period FROM runs WHERE kind = 'turnaround' AND status = 'published' AND period <= ? ORDER BY period DESC, version DESC LIMIT 1", period);
  const planStatus = {};
  if (tr) {
    const listed = db.all('SELECT wbs1, pic_code FROM run_projects WHERE run_id = ?', tr.id);
    const entries = planDb.entriesByProject(db, listed.map(p => p.wbs1));
    const appeared = planDb.firstAppeared(db);
    for (const p of listed) {
      const all = (entries.get(p.wbs1) || []).filter(e => e.date <= today); // nothing written after the day it is read on
      const st = plan.planStatus({ today, firstAppeared: appeared.get(p.wbs1) || today, entries: all, settings });
      (planStatus[p.pic_code] = planStatus[p.pic_code] || []).push(st.status);
    }
  }

  const goals = {}, goalOrder = [];
  for (const g of db.all('SELECT pic, amount FROM acct_goals WHERE year = ? ORDER BY sort, pic', year)) { goals[g.pic] = g.amount; goalOrder.push(g.pic); }
  const names = Object.fromEntries(db.all('SELECT code, first_name, last_name FROM employees').map(e => [e.code, `${e.first_name} ${e.last_name}`]));
  const utilization = Object.fromEntries((x.utilization || []).map(u => [u.pic, u.bp]));
  const rows = A.computeRows({ goals, goalOrder, projects, backlog, mwip, arOver90: x.arOver90 || [], picOf, utilization, planStatus, names });
  const firm = x.firm || {};
  const meta = {
    year, months: period % 100, cutoff: schedule.lastDayOfPeriod(period),
    statusDay: today, turnaroundRunId: tr ? tr.id : null, archRevenue,
    incomeProfit: firm.incomeProfit ?? null, esopBonus: firm.esopBonus ?? null, actualOhBp: firm.actualOhBp ?? null, assignedOhBp: firm.assignedOhBp ?? null,
    sizes: settings['acct.projectSizes'],
  };
  return { rows, meta };
}

function fill(db, runId, c) {
  const m = c.meta;
  db.run('INSERT INTO acct_meta (run_id, year, months, cutoff, status_day, turnaround_run_id, income_profit, esop_bonus, actual_oh_bp, assigned_oh_bp, arch_revenue, sizes_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    runId, m.year, m.months, m.cutoff, m.statusDay, m.turnaroundRunId, m.incomeProfit, m.esopBonus, m.actualOhBp, m.assignedOhBp, m.archRevenue, JSON.stringify(m.sizes));
  c.rows.forEach((r, i) => db.run('INSERT INTO acct_rows (run_id, key, label, sort, goal, billed_ytd, profit_ytd, negative_ytd, unevaluated, listed, response, utilization_bp, backlog, mwip, ar_over90) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    runId, r.key, r.label, i + 1, r.goal, r.billedYtd, r.profitYtd, r.negativeYtd, r.unevaluated, r.listed, r.response, r.utilizationBp, r.backlog, r.mwip, r.arOver90));
}
const clear = (db, runId) => { for (const t of ['acct_rows', 'acct_meta']) db.run(`DELETE FROM ${t} WHERE run_id = ?`, runId); };

/* ---- the lifecycle ---- */
function newDraft(db, period, settings, c) {
  const id = crypto.randomUUID();
  const version = lifecycle.nextVersion(allAcct(db).map(life), KIND, period);
  db.run("INSERT INTO runs (id, kind, period, version, status, created_at, settings_json) VALUES (?, 'acct', ?, ?, 'draft', ?, ?)", id, period, version, db.now(), JSON.stringify(settings));
  fill(db, id, c);
  return id;
}

function buildDraft(db, { source, period, settings, today }) {
  const verdict = lifecycle.canBuild(allAcct(db).map(life), KIND, period);
  if (!verdict.ok) throw new HttpError(409, verdict.error);
  const c = compute(db, source, period, settings, today || buildDay());
  return db.tx(() => newDraft(db, period, settings, c));
}

function rebuildDraft(db, runId, { source, settings, today }) {
  const run = getRun(db, runId);
  const verdict = lifecycle.canRebuild(run);
  if (!verdict.ok) throw new HttpError(409, verdict.error);
  const c = compute(db, source, run.period, settings, today || buildDay());
  db.tx(() => { clear(db, runId); db.run('UPDATE runs SET settings_json = ? WHERE id = ?', JSON.stringify(settings), runId); fill(db, runId, c); });
}

function publish(db, runId, user) {
  const run = getRun(db, runId);
  const verdict = lifecycle.canPublish(run);
  if (!verdict.ok) throw new HttpError(409, verdict.error);
  db.run("UPDATE runs SET status = 'published', published_at = ?, published_by = ? WHERE id = ?", db.now(), user.id, runId);
}

function archiveAndRerun(db, runId, { reason, confirm }, { source, settings, today }) {
  const run = getRun(db, runId);
  const verdict = lifecycle.canArchive(run, { reason, confirm });
  if (!verdict.ok) throw new HttpError(run.status === 'published' ? 400 : 409, verdict.error);
  const c = compute(db, source, run.period, settings, today || buildDay());
  return db.tx(() => {
    db.run("UPDATE runs SET status = 'archived', archived_at = ?, archive_reason = ? WHERE id = ?", db.now(), reason.trim(), runId);
    return newDraft(db, run.period, settings, c);
  });
}

/* the scheduled job and the "Build" button both come here. Safe to repeat. */
function runMonthly(db, { source, settings, period, mailer, baseUrl, adminEmails, today }) {
  const live = allAcct(db).find(r => r.period === period && r.status !== 'archived');
  if (live) return { created: false, id: live.id };
  const id = buildDraft(db, { source, period, settings, today });
  if (settings['run.emailAdmin'] && mailer && adminEmails && adminEmails.length) {
    mailer.sendToAdmin({ to: adminEmails, subject: `Accountability draft ready: ${schedule.periodLabel(period)}`, body: `The ${schedule.periodLabel(period)} Principal Accountability draft is ready to review.\nOpen it: ${baseUrl}/#/accountability/${id}` });
  }
  return { created: true, id };
}

/* the versions a person may pick from: everyone who may read it sees published ones; the Admin also sees drafts and archived */
function listReports(db, viewer) {
  return allAcct(db).filter(r => viewer.role === 'admin' || r.status === 'published').map(r => ({ id: r.id, period: r.period, version: r.version, status: r.status, label: label(r), publishedAt: r.published_at, archiveReason: r.archive_reason }));
}

/* one report, read back. Who may read it was checked by the caller; a draft or archived version is the Admin's. */
function report(db, runId, viewer) {
  const run = db.get("SELECT * FROM runs WHERE id = ? AND kind = 'acct'", String(runId));
  if (!run || (viewer.role !== 'admin' && run.status !== 'published')) throw new HttpError(404, 'Report not found.');
  const m = db.get('SELECT * FROM acct_meta WHERE run_id = ?', run.id);
  const runOut = { id: run.id, period: run.period, version: run.version, status: run.status, label: label(run), publishedAt: run.published_at, archivedAt: run.archived_at, archiveReason: run.archive_reason };
  if (!m) return { run: runOut, available: false };
  const rows = db.all('SELECT * FROM acct_rows WHERE run_id = ? ORDER BY sort', run.id).map(r => ({
    key: r.key, label: r.label, goal: r.goal, billedYtd: r.billed_ytd, profitYtd: r.profit_ytd, negativeYtd: r.negative_ytd, unevaluated: r.unevaluated, listed: r.listed,
    response: r.response, utilizationBp: r.utilization_bp, backlog: r.backlog, mwip: r.mwip, arOver90: r.ar_over90,
  }));
  const withGoal = rows.filter(r => r.goal !== null);
  const meta = {
    year: m.year, months: m.months, cutoff: m.cutoff, statusDay: m.status_day, hasTurnaround: !!m.turnaround_run_id,
    incomeProfit: m.income_profit, esopBonus: m.esop_bonus, actualOhBp: m.actual_oh_bp, assignedOhBp: m.assigned_oh_bp, archRevenue: m.arch_revenue,
    sizes: JSON.parse(m.sizes_json), goalTotal: withGoal.length ? withGoal.reduce((a, r) => a + r.goal, 0) : null,
  };
  return { run: runOut, available: true, meta, rows };
}

/* ---- the Admin's goals ---- */
function goals(db) {
  const emp = Object.fromEntries(db.all('SELECT code, first_name, last_name FROM employees').map(e => [e.code, `${e.first_name} ${e.last_name}`]));
  const list = db.all('SELECT * FROM acct_goals ORDER BY year DESC, sort, pic').map(g => ({ year: g.year, pic: g.pic, name: emp[g.pic] || g.pic, amount: g.amount }));
  // anyone who could be given a goal: the PICs in People, and anyone who already has one
  const pics = db.all("SELECT u.employee_code AS code FROM users u WHERE u.role = 'pic' AND u.active = 1 AND u.employee_code IS NOT NULL").map(u => u.code);
  const choices = [...new Set(pics.concat(list.map(g => g.pic)))].map(code => ({ code, name: emp[code] || code })).sort((a, b) => a.name.localeCompare(b.name));
  return { years: [...new Set(list.map(g => g.year))], goals: list, pics: choices };
}

/* amount null removes the PIC's goal for that year (they then show only if they have something, with no goal) */
function setGoal(db, { year, pic, amount }) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new HttpError(400, 'That is not a valid year.');
  if (typeof pic !== 'string' || !db.get('SELECT 1 AS x FROM employees WHERE code = ?', pic)) throw new HttpError(400, 'That PIC is not in Vantagepoint.');
  const old = db.get('SELECT amount, sort FROM acct_goals WHERE year = ? AND pic = ?', year, pic);
  if (amount === null) { db.run('DELETE FROM acct_goals WHERE year = ? AND pic = ?', year, pic); return { from: old ? old.amount : null, to: null }; }
  if (!Number.isInteger(amount) || amount < 0 || amount > 1e12) throw new HttpError(400, 'The goal must be an amount of dollars, zero or more.');
  const sort = old ? old.sort : db.get('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM acct_goals WHERE year = ?', year).n;
  db.run('INSERT INTO acct_goals (year, pic, amount, sort) VALUES (?, ?, ?, ?) ON CONFLICT(year, pic) DO UPDATE SET amount = excluded.amount', year, pic, amount, sort);
  return { from: old ? old.amount : null, to: amount };
}

module.exports = { KIND, label, getRun, compute, buildDraft, rebuildDraft, publish, archiveAndRerun, runMonthly, listReports, report, goals, setGoal, MWIP_OPTIONS };
