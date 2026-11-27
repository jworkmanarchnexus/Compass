'use strict';
/* Principal Accountability on the database. It is built with the Marketing Report (server/bd.js calls compute and fill), from
   the same monthly pull, so it is drafted, published, locked, archived and rerun with that report: there is one lifecycle and one
   Publish button for the month. The arithmetic is modules/accountability/logic/accountability.js (pure, tested). */
const { HttpError } = require('./errors');
const A = require('../modules/accountability/logic/accountability');
const profitRule = require('../modules/turnaround/logic/profit');
const plan = require('../modules/turnaround/logic/plan');
const planDb = require('./plan');
const schedule = require('../modules/turnaround/logic/schedule');

/* everything the rows need, as of the report month. `bd` is what the Marketing Report just worked out from the same pull:
   { out (report.computeBd), data (the source's loadBd result) }. `today` is the day plan statuses are read on. */
function compute(db, source, period, settings, bd, today) {
  const year = Math.floor(period / 100);
  // billed and profit: the Project Turnaround math over every project the pull returns, not only the ones below break-even
  // (a source with no profit pull still builds the Marketing Report; billed and profit are then empty)
  const pull = typeof source.load === 'function' ? source.load(period) : { projects: [], ledger: [], overhead: [] };
  const evaluated = profitRule.computeProjects({ projects: pull.projects, ledger: pull.ledger, overhead: pull.overhead, runPeriod: period });
  const projects = evaluated.map(p => ({ wbs1: p.wbs1, principal: p.principal, billedYtd: p.billed.ytd, profitYtd: p.evaluable ? p.profit.ytd : null }));

  // backlog: the contracted forecast through December 31, gross (as entered) when the source gives it, so it reads against gross billings
  const picOfBd = Object.fromEntries(bd.data.projects.map(p => [p.wbs1, p.principal || '']));
  const backlog = {};
  for (const f of bd.data.forecast || []) { const k = picOfBd[f.wbs1] || ''; backlog[k] = (backlog[k] || 0) + (f.gross !== undefined ? f.gross : f.amount); }
  // MWIP: the Marketing Report's own weighted figure for each PIC
  const mwip = {};
  for (const r of bd.out.pic) mwip[r.key || ''] = r.mwip;

  const extra = typeof source.loadAccountability === 'function' ? source.loadAccountability(period) || {} : {};
  const utilization = Object.fromEntries((extra.utilization || []).map(u => [u.pic, u.bp]));
  const picOf = Object.assign({}, picOfBd, Object.fromEntries(db.all('SELECT wbs1, principal FROM projects').map(p => [p.wbs1, p.principal])));

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
  const rows = A.computeRows({ goals, goalOrder, projects, backlog, mwip, arOver90: extra.arOver90 || [], picOf, utilization, planStatus, names });
  const firm = extra.firm || {};
  const meta = {
    year, months: bd.out.months, cutoff: schedule.lastDayOfPeriod(period),
    statusDay: today, turnaroundRunId: tr ? tr.id : null, archRevenue: bd.out.firm.ytd,
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

/* one report, read back. Who may read it was checked by the caller (roles: Admin and Finance); a draft or archived version is the Admin's. */
function report(db, runId, viewer, bdLabel) {
  const run = db.get("SELECT * FROM runs WHERE id = ? AND kind = 'bd'", String(runId));
  if (!run || (viewer.role !== 'admin' && run.status !== 'published')) throw new HttpError(404, 'Report not found.');
  const m = db.get('SELECT * FROM acct_meta WHERE run_id = ?', run.id);
  const runOut = { id: run.id, period: run.period, version: run.version, status: run.status, label: bdLabel(run), publishedAt: run.published_at, archivedAt: run.archived_at, archiveReason: run.archive_reason };
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

module.exports = { compute, fill, clear, report, goals, setGoal };
