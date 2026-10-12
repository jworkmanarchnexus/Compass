'use strict';
/* Report runs: build a draft, rebuild it, publish it, archive and rerun it.
   The rules live in modules/turnaround/logic (pure, tested); this file applies them to the database.
   The database itself also enforces the lock with triggers (schema.sql), so a bug here still cannot change a published run. */
const crypto = require('node:crypto');
const { HttpError } = require('./errors');
const profit = require('../modules/turnaround/logic/profit');
const selection = require('../modules/turnaround/logic/selection');
const lifecycle = require('../modules/turnaround/logic/lifecycle');
const schedule = require('../modules/turnaround/logic/schedule');

const KIND = 'turnaround';

const runOut = r => ({
  id: r.id, kind: r.kind, period: r.period, version: r.version, status: r.status, label: schedule.periodLabel(r.period),
  createdAt: r.created_at, publishedAt: r.published_at, publishedBy: r.published_by, archivedAt: r.archived_at, archiveReason: r.archive_reason,
});
const lifeRow = r => ({ id: r.id, kind: r.kind, period: r.period, version: r.version, status: r.status });

function allRuns(db) { return db.all('SELECT * FROM runs ORDER BY period DESC, version DESC'); }

const prevPeriod = p => (p % 100 === 1 ? (Math.floor(p / 100) - 1) * 100 + 12 : p - 1);
const trailing = (period, n) => { const out = []; let p = period; for (let i = 0; i < n; i++) { out.unshift(p); p = prevPeriod(p); } return out; };

/* work out which projects belong on a run for this period, with the settings in force now, plus the history the
   run's charts need: firm-wide month-end figures for 12 months, and each listed project's YTD profit by month this year. */
function compute(source, period, settings) {
  const pull = source.load(period);
  const at = p => profit.computeProjects({ projects: pull.projects, ledger: pull.ledger, overhead: pull.overhead, runPeriod: p });
  const result = selection.selectForRun(at(period), settings);
  const listed = new Set(result.included.map(p => p.wbs1));
  const yearStart = Math.floor(period / 100) * 100 + 1;
  const aggregate = []; const series = []; const byPic = [];
  const picCodes = [...new Set(result.included.map(p => p.principal))];
  const months = new Set(trailing(period, 12).concat(trailing(period, period - yearStart + 1)));
  for (const p of [...months].sort()) {
    const computed = at(p);
    if (trailing(period, 12).includes(p)) {
      const inc = selection.selectForRun(computed, settings).included;
      aggregate.push({ period: p, negativeYtd: inc.reduce((sum, x) => sum + x.profit.ytd, 0), belowCount: inc.length });
      for (const code of picCodes) { const mine = inc.filter(x => x.principal === code); byPic.push({ pic: code, period: p, negativeYtd: mine.reduce((sum, x) => sum + x.profit.ytd, 0), belowCount: mine.length }); }
    }
    if (p >= yearStart) for (const c of computed) if (listed.has(c.wbs1) && c.profit.ytd !== null) series.push({ wbs1: c.wbs1, period: p, profitYtd: c.profit.ytd });
  }
  return Object.assign(result, { history: { aggregate, series, byPic } });
}

function fill(db, runId, period, { included, warnings, history }) {
  for (const p of included) {
    const seen = db.get('SELECT MIN(r.period) AS p FROM run_projects rp JOIN runs r ON r.id = rp.run_id WHERE rp.wbs1 = ? AND rp.run_id <> ?', p.wbs1, runId);
    db.run(`INSERT INTO run_projects (run_id, wbs1, name, pic_code, pm_code, billed_cur, billed_ytd, billed_jtd, profit_cur, profit_ytd, profit_jtd, first_seen_period)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    runId, p.wbs1, p.name, p.principal, p.projMgr, p.billed.cur, p.billed.ytd, p.billed.jtd, p.profit.cur, p.profit.ytd, p.profit.jtd, seen && seen.p ? Math.min(seen.p, period) : period);
  }
  for (const h of history.aggregate) db.run('INSERT INTO run_history (run_id, period, negative_ytd, below_count) VALUES (?, ?, ?, ?)', runId, h.period, h.negativeYtd, h.belowCount);
  for (const h of history.byPic) db.run('INSERT INTO run_pic_history (run_id, pic_code, period, negative_ytd, below_count) VALUES (?, ?, ?, ?, ?)', runId, h.pic, h.period, h.negativeYtd, h.belowCount);
  for (const h of history.series) db.run('INSERT INTO run_project_history (run_id, wbs1, period, profit_ytd) VALUES (?, ?, ?, ?)', runId, h.wbs1, h.period, h.profitYtd);
  for (const w of warnings) db.run('INSERT INTO run_warnings (run_id, kind, wbs1, detail, ytd_billed) VALUES (?, ?, ?, ?, ?)', runId, w.kind, w.wbs1, w.detail, w.ytdBilled);
}

/* Build a new draft for `period`. Throws 409 if a draft or published run already exists for it. */
function buildDraft(db, { source, period, settings }) {
  const verdict = lifecycle.canBuild(allRuns(db).map(lifeRow), KIND, period);
  if (!verdict.ok) throw new HttpError(409, verdict.error);
  const result = compute(source, period, settings);
  return db.tx(() => {
    const id = crypto.randomUUID();
    const version = lifecycle.nextVersion(allRuns(db).map(lifeRow), KIND, period);
    db.run("INSERT INTO runs (id, kind, period, version, status, created_at, settings_json) VALUES (?, ?, ?, ?, 'draft', ?, ?)", id, KIND, period, version, db.now(), JSON.stringify(settings));
    fill(db, id, period, result);
    return id;
  });
}

/* Rebuild a draft from the source again (a draft has been seen by nobody but the admin). */
function rebuildDraft(db, runId, { source, settings }) {
  const run = getRun(db, runId);
  const verdict = lifecycle.canRebuild(run);
  if (!verdict.ok) throw new HttpError(409, verdict.error);
  const result = compute(source, run.period, settings);
  db.tx(() => {
    db.run('DELETE FROM run_projects WHERE run_id = ?', runId);
    db.run('DELETE FROM run_history WHERE run_id = ?', runId);
    db.run('DELETE FROM run_pic_history WHERE run_id = ?', runId);
    db.run('DELETE FROM run_project_history WHERE run_id = ?', runId);
    db.run('DELETE FROM run_warnings WHERE run_id = ?', runId);
    db.run('UPDATE runs SET settings_json = ? WHERE id = ?', JSON.stringify(settings), runId);
    fill(db, runId, run.period, result);
  });
}

function publish(db, runId, user) {
  const run = getRun(db, runId);
  const verdict = lifecycle.canPublish(run);
  if (!verdict.ok) throw new HttpError(409, verdict.error);
  db.run("UPDATE runs SET status = 'published', published_at = ?, published_by = ? WHERE id = ?", db.now(), user.id, runId);
}

/* Archive a published run (reason + typing RERUN) and build a fresh draft for the same period, in one step. */
function archiveAndRerun(db, runId, { reason, confirm }, { source, settings }) {
  const run = getRun(db, runId);
  const verdict = lifecycle.canArchive(run, { reason, confirm });
  if (!verdict.ok) throw new HttpError(run.status === 'published' ? 400 : 409, verdict.error);
  const result = compute(source, run.period, settings);
  return db.tx(() => {
    db.run("UPDATE runs SET status = 'archived', archived_at = ?, archive_reason = ? WHERE id = ?", db.now(), reason.trim(), runId);
    const id = crypto.randomUUID();
    const version = lifecycle.nextVersion(allRuns(db).map(lifeRow), KIND, run.period);
    db.run("INSERT INTO runs (id, kind, period, version, status, created_at, settings_json) VALUES (?, ?, ?, ?, 'draft', ?, ?)", id, KIND, run.period, version, db.now(), JSON.stringify(settings));
    fill(db, id, run.period, result);
    return id;
  });
}

function getRun(db, id) {
  const r = db.get('SELECT * FROM runs WHERE id = ?', String(id));
  if (!r) throw new HttpError(404, 'Run not found.');
  return r;
}

/* the list on Admin > Report runs */
function listRuns(db) {
  const counts = Object.fromEntries(db.all('SELECT run_id, COUNT(*) AS n FROM run_projects GROUP BY run_id').map(r => [r.run_id, r.n]));
  const warns = Object.fromEntries(db.all('SELECT run_id, COUNT(*) AS n FROM run_warnings GROUP BY run_id').map(r => [r.run_id, r.n]));
  const names = Object.fromEntries(db.all('SELECT id, display_name FROM users').map(u => [u.id, u.display_name]));
  return allRuns(db).map(r => Object.assign(runOut(r), { publishedByName: r.published_by ? names[r.published_by] || 'Unknown' : null, projectCount: counts[r.id] || 0, warningCount: warns[r.id] || 0 }));
}

/* a run with its projects (names resolved from the Vantagepoint copy) and, for the admin, its warnings */
function runDetail(db, id, { withWarnings }) {
  const r = getRun(db, id);
  const emp = Object.fromEntries(db.all('SELECT code, first_name, last_name FROM employees').map(e => [e.code, `${e.first_name} ${e.last_name}`]));
  const who = code => ({ code, name: code ? (emp[code] || code) : 'Unassigned' });
  const projects = db.all('SELECT * FROM run_projects WHERE run_id = ? ORDER BY pic_code, profit_ytd, wbs1', r.id).map(p => ({
    wbs1: p.wbs1, name: p.name, pic: who(p.pic_code), pm: who(p.pm_code),
    billed: { cur: p.billed_cur, ytd: p.billed_ytd, jtd: p.billed_jtd }, profit: { cur: p.profit_cur, ytd: p.profit_ytd, jtd: p.profit_jtd },
    firstSeenPeriod: p.first_seen_period,
  }));
  const out = {
    run: runOut(r), projects,
    summary: { projectCount: projects.length, negativeYtd: projects.reduce((s, p) => s + p.profit.ytd, 0), billedYtd: projects.reduce((s, p) => s + p.billed.ytd, 0) },
  };
  if (withWarnings) {
    out.warnings = db.all('SELECT * FROM run_warnings WHERE run_id = ? ORDER BY id', r.id).map(w => ({ kind: w.kind, wbs1: w.wbs1, detail: w.detail, ytdBilled: w.ytd_billed }));
    const proj = Object.fromEntries(db.all('SELECT wbs1, name FROM projects').map(p => [p.wbs1, p.name]));
    for (const w of out.warnings) w.name = proj[w.wbs1] || '';
    out.settings = JSON.parse(r.settings_json);
  }
  return out;
}

/* what PICs, Finance and Marketing see: the last published run, or nothing yet */
function currentPublished(db) {
  const r = lifecycle.currentPublished(allRuns(db).map(lifeRow), KIND);
  return r ? runDetail(db, r.id, { withWarnings: false }) : null;
}

/* The scheduled job and the "Build a run" button both come here. Safe to repeat: an existing live run is left alone. */
function runMonthly(db, { source, settings, period, mailer, baseUrl, adminEmails }) {
  const live = allRuns(db).find(r => r.kind === KIND && r.period === period && r.status !== 'archived');
  if (live) return { created: false, id: live.id };
  const id = buildDraft(db, { source, period, settings });
  const detail = runDetail(db, id, { withWarnings: true });
  if (settings['run.emailAdmin'] && mailer && adminEmails.length) {
    // the only automatic email: a count and a link, no PIC or project names
    mailer.sendToAdmin({
      to: adminEmails,
      subject: `Project Turnaround draft ready: ${detail.run.label}`,
      body: `The ${detail.run.label} Project Turnaround draft is ready to review.\n${detail.summary.projectCount} projects below break-even, ${detail.warnings.length} warnings.\nOpen it: ${baseUrl}/#/admin/runs/${id}`,
    });
  }
  return { created: true, id };
}

module.exports = { allRuns, KIND, buildDraft, rebuildDraft, publish, archiveAndRerun, listRuns, runDetail, currentPublished, runMonthly, getRun };
