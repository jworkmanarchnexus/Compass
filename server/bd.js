'use strict';
/* The BD report on the database: build a draft from the source, rebuild it, publish it (not while revenue has no market
   sector, unless the Admin chose "put it in Other"), archive and rerun it, and read it back by role.
   The arithmetic is modules/bd/logic/report.js (pure, tested). The run lifecycle rules are the same ones Project Turnaround
   uses (modules/turnaround/logic/lifecycle.js): draft, published and locked, archived with a reason and the word RERUN. */
const crypto = require('node:crypto');
const { HttpError } = require('./errors');
const report = require('../modules/bd/logic/report');
const lifecycle = require('../modules/turnaround/logic/lifecycle');
const schedule = require('../modules/turnaround/logic/schedule');
const { isValid } = require('../modules/turnaround/logic/dates');

const KIND = 'bd';
const label = r => `${schedule.periodLabel(r.period)}, version ${r.version}`;
const allBd = db => db.all("SELECT * FROM runs WHERE kind = 'bd' ORDER BY period DESC, version DESC");
const life = r => ({ id: r.id, kind: r.kind, period: r.period, version: r.version, status: r.status });

function getRun(db, id) {
  const r = db.get("SELECT * FROM runs WHERE id = ? AND kind = 'bd'", String(id));
  if (!r) throw new HttpError(404, 'Report not found.');
  return r;
}

/* everything Compass itself holds for a BD run: goals, sectors, the factor in force, the Admin's sector answers */
function ownInputs(db, period) {
  const year = Math.floor(period / 100);
  const goals = { pic: {}, sector: {}, picOrder: [], sectorOrder: [] };
  for (const g of db.all('SELECT * FROM bd_goals WHERE year = ? ORDER BY scope, sort, key', year)) { goals[g.scope][g.key] = g.amount; goals[g.scope === 'pic' ? 'picOrder' : 'sectorOrder'].push(g.key); }
  const sectors = db.all('SELECT * FROM bd_sectors ORDER BY sort, name').map(s => ({ name: s.name, rollsInto: s.rolls_into, rollsUntil: s.rolls_until }));
  const cutoff = schedule.lastDayOfPeriod(period);
  const f = db.get('SELECT factor_bp FROM bd_mwip_factor WHERE effective_from <= ? ORDER BY effective_from DESC LIMIT 1', cutoff);
  if (!f) throw new HttpError(409, `There is no MWIP factor in force on ${cutoff}. Add one in Admin > BD reports.`);
  if (!Object.keys(goals.pic).length) throw new HttpError(409, `There are no ${year} revenue goals yet. Add them in Admin > BD reports.`);
  const overrides = Object.fromEntries(db.all('SELECT wbs1, sector FROM bd_sector_overrides').map(o => [o.wbs1, o.sector]));
  return { year, goals, sectors, cutoff, factorBp: f.factor_bp, overrides };
}

function compute(db, source, period, settings) {
  const own = ownInputs(db, period);
  const data = source.loadBd(period);
  const projects = Object.fromEntries(data.projects.map(p => [p.wbs1, { pic: p.principal, sector: p.sector, name: p.name }]));
  const th = { onPace: settings['bd.onPacePct'], onTrack: settings['bd.onTrackPct'] };
  const out = report.computeBd({ period, goals: own.goals, projects, revenue: data.revenue, forecast: data.forecast, mwip: data.mwip, factorBp: own.factorBp, thresholds: th, sectors: own.sectors, overrides: own.overrides, unknownTo: settings['bd.noSector'] === 'other' ? 'Other' : undefined });
  return { out, own, projects, th };
}

function fill(db, runId, period, settings, c) {
  const { out, own, projects, th } = c;
  db.run('INSERT INTO bd_run_meta (run_id, year, months, cutoff, factor_bp, on_pace_pct, on_track_pct, no_sector_rule) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', runId, own.year, out.months, own.cutoff, own.factorBp, th.onPace, th.onTrack, settings['bd.noSector']);
  const put = (scope, r, sort) => db.run('INSERT INTO bd_rows (run_id, scope, key, label, sort, goal, ytd_goal, ytd, forecast, mwip_raw, mwip, total, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', runId, scope, r.key, r.label, sort, r.goal, r.ytdGoal, r.ytd, r.forecast, r.mwipRaw, r.mwip, r.total, r.status);
  put('firm', out.firm, 0);
  out.pic.forEach((r, i) => put('pic', r, i + 1));
  out.sector.forEach((r, i) => put('sector', r, i + 1));
  const warn = (kind, wbs1, detail, amount) => db.run('INSERT INTO run_warnings (run_id, kind, wbs1, detail, ytd_billed) VALUES (?, ?, ?, ?, ?)', runId, kind, wbs1, detail, amount);
  const name = w => (projects[w] ? projects[w].name : w);
  for (const u of out.unassignedSector) warn('no_sector', u.wbs1, `${name(u.wbs1)}: revenue with no market sector`, u.amount);
  for (const u of out.unassignedPic) warn('no_pic', u.wbs1, `${name(u.wbs1)}: no PIC in Vantagepoint`, u.amount);
  for (const r of out.rolled) warn('note', '', `${r.from} counted in ${r.into}`, r.ytd + r.forecast + r.mwip);
  for (const a of out.assigned) warn('note', a.wbs1, `${name(a.wbs1)}: unassigned revenue went to ${a.sector}`, a.amount);
  for (const d of out.defaulted) warn('note', d.wbs1, `${name(d.wbs1)}: revenue with no market sector went to Other`, d.amount);
}

function buildDraft(db, { source, period, settings }) {
  const verdict = lifecycle.canBuild(allBd(db).map(life), KIND, period);
  if (!verdict.ok) throw new HttpError(409, verdict.error);
  const c = compute(db, source, period, settings);
  return db.tx(() => {
    const id = crypto.randomUUID();
    const version = lifecycle.nextVersion(allBd(db).map(life), KIND, period);
    db.run("INSERT INTO runs (id, kind, period, version, status, created_at, settings_json) VALUES (?, 'bd', ?, ?, 'draft', ?, ?)", id, period, version, db.now(), JSON.stringify(settings));
    fill(db, id, period, settings, c);
    return id;
  });
}

function rebuildDraft(db, runId, { source, settings }) {
  const run = getRun(db, runId);
  const verdict = lifecycle.canRebuild(run);
  if (!verdict.ok) throw new HttpError(409, verdict.error);
  const c = compute(db, source, run.period, settings);
  db.tx(() => {
    for (const t of ['bd_rows', 'bd_run_meta', 'run_warnings']) db.run(`DELETE FROM ${t} WHERE run_id = ?`, runId);
    db.run('UPDATE runs SET settings_json = ? WHERE id = ?', JSON.stringify(settings), runId);
    fill(db, runId, run.period, settings, c);
  });
}

function unresolvedSector(db, runId) { return db.get("SELECT COUNT(*) AS n, COALESCE(SUM(ytd_billed), 0) AS amount FROM run_warnings WHERE run_id = ? AND kind = 'no_sector'", runId); }

function publish(db, runId, user) {
  const run = getRun(db, runId);
  const verdict = lifecycle.canPublish(run);
  if (!verdict.ok) throw new HttpError(409, verdict.error);
  const u = unresolvedSector(db, runId);
  if (u.n) throw new HttpError(409, `${u.n === 1 ? 'A project has' : u.n + ' projects have'} revenue with no market sector. Pick a sector for ${u.n === 1 ? 'it' : 'each'}, rebuild the draft, then publish.`, { unresolved: u.n });
  db.run("UPDATE runs SET status = 'published', published_at = ?, published_by = ? WHERE id = ?", db.now(), user.id, runId);
}

function archiveAndRerun(db, runId, { reason, confirm }, { source, settings }) {
  const run = getRun(db, runId);
  const verdict = lifecycle.canArchive(run, { reason, confirm });
  if (!verdict.ok) throw new HttpError(run.status === 'published' ? 400 : 409, verdict.error);
  const c = compute(db, source, run.period, settings);
  return db.tx(() => {
    db.run("UPDATE runs SET status = 'archived', archived_at = ?, archive_reason = ? WHERE id = ?", db.now(), reason.trim(), runId);
    const id = crypto.randomUUID();
    const version = lifecycle.nextVersion(allBd(db).map(life), KIND, run.period);
    db.run("INSERT INTO runs (id, kind, period, version, status, created_at, settings_json) VALUES (?, 'bd', ?, ?, 'draft', ?, ?)", id, run.period, version, db.now(), JSON.stringify(settings));
    fill(db, id, run.period, settings, c);
    return id;
  });
}

/* the reports a person may pick from: everyone sees published ones; the Admin also sees drafts and archived versions */
function listReports(db, viewer) {
  const names = Object.fromEntries(db.all('SELECT id, display_name FROM users').map(u => [u.id, u.display_name]));
  return allBd(db).filter(r => viewer.role === 'admin' || r.status === 'published').map(r => ({
    id: r.id, period: r.period, version: r.version, status: r.status, label: label(r), createdAt: r.created_at, publishedAt: r.published_at,
    publishedBy: r.published_by ? names[r.published_by] || null : null, archiveReason: r.archive_reason,
  }));
}

const money = c => (c < 0 ? '-$' : '$') + Math.abs(Math.round(c / 100)).toLocaleString('en-US');

/* one report. The MWIP factor and raw amounts are not for PICs ("not shown on PIC pages"); warnings are the Admin's. */
function reportDetail(db, id, viewer) {
  const run = getRun(db, id);
  if (viewer.role !== 'admin' && run.status !== 'published') throw new HttpError(404, 'Report not found.');
  const meta = db.get('SELECT * FROM bd_run_meta WHERE run_id = ?', id);
  const emp = Object.fromEntries(db.all('SELECT code, first_name, last_name FROM employees').map(e => [e.code, `${e.first_name} ${e.last_name}`]));
  const hideFactor = viewer.role === 'pic';
  const rows = scope => db.all('SELECT * FROM bd_rows WHERE run_id = ? AND scope = ? ORDER BY sort', id, scope).map(r => ({
    key: r.key, label: scope === 'pic' ? (emp[r.key] || r.label || 'Unassigned') : r.label, goal: r.goal, ytdGoal: r.ytd_goal, ytd: r.ytd, forecast: r.forecast,
    mwip: r.mwip, mwipRaw: hideFactor ? undefined : r.mwip_raw, total: r.total, status: r.status,
  }));
  const names = Object.fromEntries(db.all('SELECT id, display_name FROM users').map(u => [u.id, u.display_name]));
  const warnings = db.all('SELECT * FROM run_warnings WHERE run_id = ? ORDER BY id', id).map(w => ({ kind: w.kind, wbs1: w.wbs1, detail: w.detail, amount: w.ytd_billed }));
  // the line under the title: what was done to the numbers, for everyone
  const notes = warnings.filter(w => w.kind === 'note').map(w => w.detail + (w.kind === 'note' && /unassigned revenue went to|went to Other/.test(w.detail) ? ` (${money(w.amount)})` : ''));
  return {
    run: { id: run.id, period: run.period, version: run.version, status: run.status, label: label(run), createdAt: run.created_at, publishedAt: run.published_at, publishedBy: run.published_by ? (names[run.published_by] || '').split(' ')[0] : null, archivedAt: run.archived_at, archiveReason: run.archive_reason },
    meta: { year: meta.year, months: meta.months, cutoff: meta.cutoff, factor: hideFactor ? undefined : meta.factor_bp / 10000, onPacePct: meta.on_pace_pct, onTrackPct: meta.on_track_pct },
    firm: rows('firm')[0], pic: rows('pic'), sector: rows('sector'), notes,
    warnings: viewer.role === 'admin' ? warnings.filter(w => w.kind !== 'note') : undefined,
    sectors: viewer.role === 'admin' ? db.all('SELECT name FROM bd_sectors ORDER BY sort').map(s => s.name) : undefined,
  };
}

/* ---- the Admin's own BD data ---- */
function adminInputs(db) {
  const emp = Object.fromEntries(db.all('SELECT code, first_name, last_name FROM employees').map(e => [e.code, `${e.first_name} ${e.last_name}`]));
  const goals = db.all('SELECT * FROM bd_goals ORDER BY year DESC, scope, sort, key').map(g => ({ year: g.year, scope: g.scope, key: g.key, name: g.scope === 'pic' ? emp[g.key] || g.key : g.key, amount: g.amount }));
  return {
    years: [...new Set(goals.map(g => g.year))],
    goals,
    factors: db.all('SELECT effective_from, factor_bp FROM bd_mwip_factor ORDER BY effective_from DESC').map(f => ({ effectiveFrom: f.effective_from, factorBp: f.factor_bp })),
    sectors: db.all('SELECT * FROM bd_sectors ORDER BY sort, name').map(s => ({ name: s.name, rollsInto: s.rolls_into, rollsUntil: s.rolls_until })),
    overrides: db.all('SELECT wbs1, sector FROM bd_sector_overrides ORDER BY wbs1').map(o => ({ wbs1: o.wbs1, sector: o.sector })),
  };
}

function setGoal(db, user, { year, scope, key, amount }) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new HttpError(400, 'That is not a valid year.');
  if (!['pic', 'sector'].includes(scope)) throw new HttpError(400, 'A goal is for a PIC or a market sector.');
  if (!Number.isInteger(amount) || amount < 0 || amount > 1e12) throw new HttpError(400, 'The goal must be an amount of dollars, zero or more.');
  const known = scope === 'pic' ? db.get('SELECT 1 AS x FROM employees WHERE code = ?', String(key)) : db.get('SELECT 1 AS x FROM bd_sectors WHERE name = ?', String(key));
  if (!known) throw new HttpError(400, scope === 'pic' ? 'That PIC is not in Vantagepoint.' : 'That market sector does not exist.');
  const old = db.get('SELECT amount, sort FROM bd_goals WHERE year = ? AND scope = ? AND key = ?', year, scope, key);
  const sort = old ? old.sort : (db.get('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM bd_goals WHERE year = ? AND scope = ?', year, scope).n);
  db.run('INSERT INTO bd_goals (year, scope, key, amount, sort) VALUES (?, ?, ?, ?, ?) ON CONFLICT(year, scope, key) DO UPDATE SET amount = excluded.amount', year, scope, key, amount, sort);
  return { from: old ? old.amount : null, to: amount };
}

function addFactor(db, user, { effectiveFrom, factorBp }) {
  if (!isValid(effectiveFrom)) throw new HttpError(400, 'Enter the date it takes effect.');
  if (!Number.isInteger(factorBp) || factorBp < 1 || factorBp > 20000) throw new HttpError(400, 'The factor must be between 0.0001 and 2.');
  if (db.get('SELECT 1 AS x FROM bd_mwip_factor WHERE effective_from = ?', effectiveFrom)) throw new HttpError(409, 'There is already a factor from that date. Past factors are never changed; pick a new date.');
  db.run('INSERT INTO bd_mwip_factor (effective_from, factor_bp, set_by, set_at) VALUES (?, ?, ?, ?)', effectiveFrom, factorBp, user.id, db.now());
}

function setOverride(db, user, { wbs1, sector }) {
  if (typeof wbs1 !== 'string' || !wbs1) throw new HttpError(400, 'Which project?');
  if (sector === null || sector === '') { db.run('DELETE FROM bd_sector_overrides WHERE wbs1 = ?', wbs1); return; }
  if (!db.get('SELECT 1 AS x FROM bd_sectors WHERE name = ?', String(sector))) throw new HttpError(400, 'That market sector does not exist.');
  db.run('INSERT INTO bd_sector_overrides (wbs1, sector, set_by, set_at) VALUES (?, ?, ?, ?) ON CONFLICT(wbs1) DO UPDATE SET sector = excluded.sector, set_by = excluded.set_by, set_at = excluded.set_at', wbs1, sector, user.id, db.now());
}

/* The scheduled job and the "Build" button both come here. Safe to repeat. */
function runMonthly(db, { source, settings, period, mailer, baseUrl, adminEmails }) {
  const live = allBd(db).find(r => r.period === period && r.status !== 'archived');
  if (live) return { created: false, id: live.id };
  const id = buildDraft(db, { source, period, settings });
  const unresolved = unresolvedSector(db, id);
  if (settings['run.emailAdmin'] && mailer && adminEmails.length) {
    mailer.sendToAdmin({ to: adminEmails, subject: `BD report draft ready: ${schedule.periodLabel(period)}`,
      body: `The ${schedule.periodLabel(period)} BD report draft is ready to review.${unresolved.n ? `\n${unresolved.n} ${unresolved.n === 1 ? 'project needs' : 'projects need'} a market sector before it can be published.` : ''}\nOpen it: ${baseUrl}/#/bd/${id}` });
  }
  return { created: true, id };
}

module.exports = { KIND, label, allBd, getRun, buildDraft, rebuildDraft, publish, archiveAndRerun, listReports, reportDetail, adminInputs, setGoal, addFactor, setOverride, runMonthly, unresolvedSector };
