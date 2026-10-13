'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { HttpError } = require('./errors');
const roles = require('../shared/rules/roles');
const settingsRules = require('../shared/rules/settings');
const runsDb = require('./runs');
const schedule = require('../modules/turnaround/logic/schedule');
const { createLocalSource } = require('./vp-local');
const { createFileMailer } = require('./mail');
const planDb = require('./plan');
const bdDb = require('./bd');
const pipeDb = require('./pipeline');
const { buildHome } = require('./home');
const tdb = require('./turnaround');
const planLogic = require('../modules/turnaround/logic/plan');
const lifecycleLogic = require('../modules/turnaround/logic/lifecycle');

const ROOT = path.resolve(__dirname, '..');
const STATIC_DIRS = ['shell', 'shared', 'modules'];
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml',
};
/* LOCAL ONLY: the "sign in as" picker. Production replaces this with the firm's network sign-in. It has no security value. */
const USER_HEADER = 'x-compass-user';
const MAX_BODY = 1024 * 1024;

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function serveStatic(urlPath, res) {
  let rel;
  try { rel = decodeURIComponent(urlPath === '/' ? '/shell/index.html' : urlPath); } catch (e) { return sendJson(res, 400, { error: 'bad path' }); }
  const file = path.normalize(path.join(ROOT, rel));
  const top = path.relative(ROOT, file).split(path.sep)[0];
  if (!STATIC_DIRS.includes(top) || file.includes('..')) return sendJson(res, 404, { error: 'not found' });
  fs.readFile(file, (err, data) => {
    if (err) return sendJson(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(new HttpError(413, 'Request is too large.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try { resolve(JSON.parse(text)); } catch (e) { reject(new HttpError(400, 'The request body is not valid JSON.')); }
    });
    req.on('error', reject);
  });
}

const userOut = u => ({ id: u.id, username: u.username, name: u.display_name, email: u.email, role: u.role, draftName: u.draft_name, employeeCode: u.employee_code, active: !!u.active });

/* opts (all optional, for tests and for Kent): source = the Vantagepoint pull, mailer = the one automatic email,
   today = () => 'YYYY-MM-DD', baseUrl = the address put in that email */
function createServer(db, opts) {
  const o = opts || {};
  const source = o.source || createLocalSource();
  const mailer = o.mailer || createFileMailer();
  // COMPASS_TODAY=2026-10-07 pins the date for a local demo (the seed data is written around that day)
  const today = o.today || (() => process.env.COMPASS_TODAY || planDb.localDate(Date.now()));
  const baseUrl = o.baseUrl || 'http://localhost:5281';
  /* ---- settings (effective-dated rows, only ever added) ---- */
  const settingRows = () => db.all('SELECT key, value_json, effective_from, set_by FROM settings').map(r => ({ key: r.key, value: JSON.parse(r.value_json), effectiveFrom: r.effective_from, setBy: r.set_by }));
  const currentSettings = () => settingsRules.allAt(settingRows(), db.now());

  function audit(user, action, object, detail) {
    db.run('INSERT INTO audit_log (at, user_id, action, object, detail_json) VALUES (?, ?, ?, ?, ?)', db.now(), user.id, action, object || '', JSON.stringify(detail || {}));
  }

  const runLabel = id => { const r = runsDb.getRun(db, id); return `Project Turnaround ${schedule.periodLabel(r.period)} v${r.version}`; };

  function currentUser(req) {
    const id = req.headers[USER_HEADER];
    const u = id && db.get('SELECT * FROM users WHERE id = ? AND active = 1', String(id));
    if (!u) throw new HttpError(401, 'Sign in first.');
    return u;
  }
  /* the one place the Admin role rules are enforced on the server: a tab, and 'view' or 'edit' */
  function requireTab(user, tab, need) {
    const level = roles.adminTab(user.role, tab);
    if (!level || (need === 'edit' && level !== 'edit')) throw new HttpError(403, 'You do not have access to this.');
  }

  async function handle(req, res, url) {
    const p = url.pathname;
    const method = req.method;

    if (p === '/api/health') return sendJson(res, 200, { ok: true, app: 'compass' });

    if (p === '/api/dev/users' && method === 'GET') {
      return sendJson(res, 200, db.all("SELECT * FROM users WHERE active = 1 ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'pic' THEN 1 ELSE 2 END, display_name").map(u => ({ id: u.id, name: u.display_name, role: u.role })));
    }

    const user = currentUser(req);

    if (p === '/api/home' && method === 'GET') return sendJson(res, 200, buildHome(db, user, { today: today(), settings: currentSettings() }));

    if (p === '/api/me' && method === 'GET') {
      const access = currentSettings().access;
      const me = Object.assign(userOut(user), roles.describe(user.role, access));
      if (user.role === 'admin') me.badges = { checkins: tdb.waitingCount(db), pipeline: pipeDb.alertCount(db) };
      return sendJson(res, 200, me);
    }

    if (p === '/api/admin/settings' && method === 'GET') {
      requireTab(user, 'turnaround', 'view');
      const rows = settingRows(); const now = db.now();
      const out = {};
      for (const key of Object.keys(settingsRules.DEFAULTS)) {
        const mine = rows.filter(r => r.key === key && r.effectiveFrom <= now).sort((a, b) => b.effectiveFrom - a.effectiveFrom)[0];
        out[key] = { value: mine ? mine.value : settingsRules.DEFAULTS[key], effectiveFrom: mine ? mine.effectiveFrom : null, setBy: mine ? mine.setBy : null };
      }
      return sendJson(res, 200, out);
    }
    if (p === '/api/admin/settings' && method === 'PUT') {
      requireTab(user, 'turnaround', 'edit');
      const { changes } = await readJson(req);
      if (!changes || typeof changes !== 'object' || !Object.keys(changes).length) throw new HttpError(400, 'Nothing to save.');
      for (const [k, v] of Object.entries(changes)) {
        if (!settingsRules.isKnown(k)) throw new HttpError(400, `Unknown setting: ${k}`);
        if (!settingsRules.isValid(k, v)) throw new HttpError(400, `That value is not allowed for ${k}.`);
      }
      const before = currentSettings();
      const merged = Object.assign({}, before, changes);
      const problem = settingsRules.crossCheck(merged);
      if (problem) throw new HttpError(400, problem);
      let saved = 0;
      db.tx(() => {
        for (const [k, v] of Object.entries(changes)) {
          if (JSON.stringify(before[k]) === JSON.stringify(v)) continue; // unchanged: no new row, no noise in the audit log
          const t = db.now();
          db.run('INSERT INTO settings (key, value_json, effective_from, set_by, set_at) VALUES (?, ?, ?, ?, ?)', k, JSON.stringify(v), t, user.id, t);
          audit(user, 'setting.change', k, { from: before[k], to: v });
          saved++;
        }
      });
      return sendJson(res, 200, { saved });
    }

    if (p === '/api/admin/people' && method === 'GET') {
      requireTab(user, 'people', 'view');
      const counts = Object.fromEntries(db.all("SELECT principal, COUNT(*) AS n FROM projects WHERE status = 'A' AND principal <> '' GROUP BY principal").map(r => [r.principal, r.n]));
      return sendJson(res, 200, db.all('SELECT * FROM users ORDER BY active DESC, display_name').map(u => Object.assign(userOut(u), { activeProjects: u.employee_code ? (counts[u.employee_code] || 0) : null })));
    }
    const pm = /^\/api\/admin\/people\/([^/]+)$/.exec(p);
    if (pm && method === 'PUT') {
      requireTab(user, 'people', 'edit');
      const body = await readJson(req);
      const change = {};
      if (body.role !== undefined) change.role = body.role;
      if (body.active !== undefined) change.active = !!body.active;
      if (body.draftName !== undefined) {
        if (typeof body.draftName !== 'string' || body.draftName.length > 40) throw new HttpError(400, 'The name used in drafts must be 40 characters or fewer.');
        change.draftName = body.draftName.trim();
      }
      const all = db.all('SELECT id, role, active FROM users').map(u => ({ id: u.id, role: u.role, active: !!u.active }));
      const verdict = roles.canChangeUser(all, pm[1], change);
      if (!verdict.ok) {
        if (verdict.reason === 'not-found') throw new HttpError(404, 'Person not found.');
        if (verdict.reason === 'last-admin') throw new HttpError(409, 'There must always be at least one active Admin.');
        throw new HttpError(400, 'That role does not exist.');
      }
      const old = db.get('SELECT * FROM users WHERE id = ?', pm[1]);
      db.tx(() => {
        if (change.role !== undefined) db.run('UPDATE users SET role = ? WHERE id = ?', change.role, pm[1]);
        if (change.active !== undefined) db.run('UPDATE users SET active = ? WHERE id = ?', change.active ? 1 : 0, pm[1]);
        if (change.draftName !== undefined) db.run('UPDATE users SET draft_name = ? WHERE id = ?', change.draftName, pm[1]);
        audit(user, 'user.change', old.display_name, {
          userId: old.id,
          from: { role: old.role, active: !!old.active, draftName: old.draft_name },
          to: Object.assign({ role: old.role, active: !!old.active, draftName: old.draft_name }, change),
        });
      });
      return sendJson(res, 200, userOut(db.get('SELECT * FROM users WHERE id = ?', pm[1])));
    }

    if (p === '/api/admin/audit' && method === 'GET') {
      requireTab(user, 'audit', 'view');
      const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 500);
      const names = Object.fromEntries(db.all('SELECT id, display_name FROM users').map(u => [u.id, u.display_name]));
      return sendJson(res, 200, db.all('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?', limit).map(r => ({
        id: r.id, at: r.at, by: names[r.user_id] || (r.user_id === 'system' ? 'Scheduled job' : 'Unknown'), action: r.action, object: r.object, detail: JSON.parse(r.detail_json),
      })));
    }

    /* ---- report runs ---- */
    if (p === '/api/admin/runs' && method === 'GET') {
      requireTab(user, 'runs', 'view'); // the list (status, version, counts) only; run contents need 'edit'
      return sendJson(res, 200, runsDb.listRuns(db));
    }
    if (p === '/api/admin/runs' && method === 'POST') {
      requireTab(user, 'runs', 'edit');
      const body = await readJson(req);
      const latest = schedule.lastClosedPeriod(today());
      const period = body.period === undefined ? latest : body.period;
      if (!Number.isInteger(period) || period < 200001 || period % 100 < 1 || period % 100 > 12) throw new HttpError(400, 'That is not a valid month.');
      if (period > latest) throw new HttpError(400, 'That month has not closed yet.');
      if (body.kind === 'bd') {
        const adminEmails = db.all("SELECT email FROM users WHERE role = 'admin' AND active = 1 AND email <> ''").map(u => u.email);
        const made = bdDb.runMonthly(db, { source, settings: currentSettings(), period, mailer, baseUrl, adminEmails });
        if (!made.created) throw new HttpError(409, 'There is already a draft or published Marketing Report for that month.', { id: made.id });
        audit(user, 'bd.build', `Marketing Report ${bdDb.label(bdDb.getRun(db, made.id))}`, { runId: made.id });
        return sendJson(res, 201, bdDb.reportDetail(db, made.id, { role: user.role }));
      }
      const out = runsDb.runMonthly(db, {
        source, settings: currentSettings(), period, mailer, baseUrl,
        adminEmails: db.all("SELECT email FROM users WHERE role = 'admin' AND active = 1 AND email <> ''").map(u => u.email),
      });
      if (!out.created) throw new HttpError(409, 'There is already a draft or published run for that month.', { id: out.id });
      audit(user, 'run.build', runLabel(out.id), { runId: out.id });
      return sendJson(res, 201, runsDb.runDetail(db, out.id, { withWarnings: true }));
    }
    const rm = /^\/api\/admin\/runs\/([^/]+)(?:\/(rebuild|publish|archive|overview))?$/.exec(p);
    if (rm) {
      requireTab(user, 'runs', 'edit'); // run contents are the admin's alone; the system admin sees the list only
      const id = rm[1]; const action = rm[2];
      if (runsDb.getRun(db, id).kind !== runsDb.KIND) throw new HttpError(404, 'Run not found.'); // Marketing Reports have their own endpoints
      if (!action && method === 'GET') return sendJson(res, 200, runsDb.runDetail(db, id, { withWarnings: true }));
      if (action === 'overview' && method === 'GET') return sendJson(res, 200, Object.assign(tdb.buildOverview(db, id, { role: user.role, userId: user.id, employeeCode: user.employee_code }, { today: today(), settings: currentSettings() }), { warnings: runsDb.runDetail(db, id, { withWarnings: true }).warnings }));
      if (action && method === 'POST') {
        const body = await readJson(req);
        if (action === 'rebuild') {
          runsDb.rebuildDraft(db, id, { source, settings: currentSettings() });
          audit(user, 'run.rebuild', runLabel(id), { runId: id });
        } else if (action === 'publish') {
          runsDb.publish(db, id, user);
          audit(user, 'run.publish', runLabel(id), { runId: id });
        } else {
          const label = runLabel(id);
          const newId = runsDb.archiveAndRerun(db, id, { reason: body.reason, confirm: body.confirm }, { source, settings: currentSettings() });
          audit(user, 'run.archive', label, { runId: id, reason: body.reason.trim(), newRunId: newId });
          return sendJson(res, 200, runsDb.runDetail(db, newId, { withWarnings: true }));
        }
        return sendJson(res, 200, runsDb.runDetail(db, id, { withWarnings: true }));
      }
    }

    /* what PICs, Finance and others may see: the last published run, never a draft */
    const viewerOf = u => ({ role: u.role, userId: u.id, employeeCode: u.employee_code });
    const canSee = () => roles.canView(user.role, 'turnaround', currentSettings().access);
    if (p === '/api/turnaround/current' && method === 'GET') {
      if (!canSee()) throw new HttpError(403, 'You do not have access to this.');
      const cur = lifecycleLogic.currentPublished(runsDb.allRuns(db), runsDb.KIND);
      if (!cur) return sendJson(res, 200, { run: null });
      return sendJson(res, 200, tdb.buildOverview(db, cur.id, viewerOf(user), { today: today(), settings: currentSettings() }));
    }

    /* a project's plan page and its log. Reading: anyone who may see Turnaround. Writing: the PIC on that project, or an admin note. */
    const pp = /^\/api\/projects\/([^/]+)\/plan(?:\/(entries|checkin)|\/commitments\/([^/]+)\/(done))?$/.exec(p);
    if (pp) {
      if (!canSee()) throw new HttpError(403, 'You do not have access to this.');
      const wbs1 = decodeURIComponent(pp[1]);
      if (!pp[2] && !pp[3] && method === 'GET') {
        const cycle = Number(url.searchParams.get('cycle')) || undefined;
        return sendJson(res, 200, tdb.buildPlanPage(db, wbs1, viewerOf(user), { today: today(), settings: currentSettings(), cycle }));
      }
      if (method === 'POST') {
        const body = await readJson(req);
        const settings = currentSettings();
        if (pp[2] === 'entries') planDb.addEntry(db, user, wbs1, body, today(), settings);
        else if (pp[2] === 'checkin') planDb.checkIn(db, user, wbs1, body, today(), settings);
        else planDb.markDone(db, user, wbs1, decodeURIComponent(pp[3]), body, today());
        return sendJson(res, 201, tdb.buildPlanPage(db, wbs1, viewerOf(user), { today: today(), settings }));
      }
    }

    /* ---- Pipeline watch: weekly snapshots. Everyone who may see it sees every PIC; notes and clearing alerts are the Admin's. ---- */
    const canPipe = () => { if (!roles.canView(user.role, 'pipeline', currentSettings().access)) throw new HttpError(403, 'You do not have access to this.'); };
    if (p === '/api/pipeline' && method === 'GET') {
      canPipe();
      return sendJson(res, 200, pipeDb.view(db, { role: user.role }, { date: url.searchParams.get('date'), kind: url.searchParams.get('kind') }));
    }
    if (p === '/api/pipeline/detail' && method === 'GET') {
      canPipe();
      return sendJson(res, 200, pipeDb.detail(db, { role: user.role }, { date: url.searchParams.get('date'), kind: url.searchParams.get('kind'), pic: url.searchParams.get('pic') }));
    }
    if (p === '/api/pipeline/export' && method === 'GET') {
      canPipe();
      const kind = url.searchParams.get('kind') === 'forecast' ? 'forecast' : 'mwip';
      const csv = pipeDb.exportCsv(db, { role: user.role }, { date: url.searchParams.get('date'), kind });
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="pipeline-${kind}-${url.searchParams.get('date') || 'latest'}.csv"`, 'Cache-Control': 'no-store' });
      return res.end('﻿' + csv);
    }
    const pc = /^\/api\/admin\/pipeline\/alerts\/(\d+)\/clear$/.exec(p);
    if (pc && method === 'POST') {
      requireTab(user, 'pipeline', 'edit');
      const a = pipeDb.clearAlert(db, user, Number(pc[1]));
      audit(user, 'pipeline.clear', a.title, { rule: a.rule, date: a.snapshot_date });
      return sendJson(res, 200, { ok: true, badge: pipeDb.alertCount(db) });
    }
    if (p === '/api/admin/pipeline/notes' && method === 'POST') {
      requireTab(user, 'pipeline', 'edit');
      const b = await readJson(req);
      pipeDb.addNote(db, user, b);
      audit(user, 'pipeline.note', String(b.pursuitId), {});
      return sendJson(res, 201, { ok: true });
    }
    if (p === '/api/admin/pipeline/snapshot' && method === 'POST') {
      requireTab(user, 'pipeline', 'edit');
      const date = pipeDb.mondayOf(today());
      const out = pipeDb.runWeekly(db, { source, settings: currentSettings(), date, mailer, baseUrl, adminEmails: [] });
      audit(user, 'pipeline.snapshot', `Snapshot ${date}`, { created: out.created });
      return sendJson(res, out.created ? 201 : 200, { created: out.created, date, alerts: pipeDb.alertCount(db) });
    }

    /* ---- BD report: read (BD viewers), and the Admin's own data and runs ---- */
    if (p === '/api/bd/reports' && method === 'GET') {
      if (!roles.canView(user.role, 'bd', currentSettings().access)) throw new HttpError(403, 'You do not have access to this.');
      return sendJson(res, 200, bdDb.listReports(db, { role: user.role }));
    }
    const bm = /^\/api\/bd\/reports\/([^/]+)$/.exec(p);
    if (bm && method === 'GET') {
      if (!roles.canView(user.role, 'bd', currentSettings().access)) throw new HttpError(403, 'You do not have access to this.');
      return sendJson(res, 200, bdDb.reportDetail(db, bm[1], { role: user.role }));
    }
    if (p === '/api/admin/bd/inputs' && method === 'GET') { requireTab(user, 'bd', 'view'); return sendJson(res, 200, bdDb.adminInputs(db)); }
    if (p === '/api/admin/bd/goals' && method === 'PUT') {
      requireTab(user, 'bd', 'edit');
      const b = await readJson(req);
      const r = bdDb.setGoal(db, user, b);
      audit(user, 'bd.goal', `${b.year} ${b.scope === 'pic' ? 'PIC' : 'sector'} goal: ${b.key}`, r);
      return sendJson(res, 200, bdDb.adminInputs(db));
    }
    if (p === '/api/admin/bd/factors' && method === 'POST') {
      requireTab(user, 'bd', 'edit');
      const b = await readJson(req);
      bdDb.addFactor(db, user, b);
      audit(user, 'bd.factor', 'MWIP factor', { effectiveFrom: b.effectiveFrom, factorBp: b.factorBp });
      return sendJson(res, 201, bdDb.adminInputs(db));
    }
    if (p === '/api/admin/bd/overrides' && method === 'PUT') {
      requireTab(user, 'bd', 'edit');
      const b = await readJson(req);
      bdDb.setOverride(db, user, b);
      audit(user, 'bd.sector', `Market sector for ${b.wbs1}`, { sector: b.sector || null });
      return sendJson(res, 200, bdDb.adminInputs(db));
    }
    const bx = /^\/api\/admin\/bd\/runs\/([^/]+)\/(rebuild|publish|archive)$/.exec(p);
    if (bx && method === 'POST') {
      requireTab(user, 'bd', 'edit');
      const id = bx[1]; const b = await readJson(req);
      const lbl = () => `Marketing Report ${bdDb.label(bdDb.getRun(db, id))}`;
      if (bx[2] === 'rebuild') { bdDb.rebuildDraft(db, id, { source, settings: currentSettings() }); audit(user, 'bd.rebuild', lbl(), { runId: id }); }
      else if (bx[2] === 'publish') { bdDb.publish(db, id, user); audit(user, 'bd.publish', lbl(), { runId: id }); }
      else {
        const was = lbl();
        const newId = bdDb.archiveAndRerun(db, id, { reason: b.reason, confirm: b.confirm }, { source, settings: currentSettings() });
        audit(user, 'bd.archive', was, { runId: id, reason: b.reason.trim(), newRunId: newId });
        return sendJson(res, 200, bdDb.reportDetail(db, newId, { role: user.role }));
      }
      return sendJson(res, 200, bdDb.reportDetail(db, id, { role: user.role }));
    }

    /* ---- check-in drafts and the daily job: the admin's alone ---- */
    if (p === '/api/admin/checkins' && method === 'GET') {
      if (!roles.canView(user.role, 'checkins')) throw new HttpError(403, 'You do not have access to this.');
      return sendJson(res, 200, tdb.listCheckins(db, { today: today(), settings: currentSettings() }));
    }
    const cm = /^\/api\/admin\/checkins\/([^/]+)(?:\/(send|dismiss|undo))?$/.exec(p);
    if (cm) {
      if (!roles.canView(user.role, 'checkins')) throw new HttpError(403, 'You do not have access to this.');
      if (!cm[2] && method === 'PUT') {
        const body = await readJson(req);
        tdb.editDraft(db, cm[1], body);
        return sendJson(res, 200, { ok: true });
      }
      if (cm[2] && method === 'POST') {
        tdb.setDraftStatus(db, cm[1], cm[2], today());
        audit(user, 'checkin.' + cm[2], cm[1], {});
        return sendJson(res, 200, tdb.listCheckins(db, { today: today(), settings: currentSettings() }));
      }
    }
    if (p === '/api/admin/daily' && method === 'POST') {
      requireTab(user, 'reminders', 'edit');
      const out = tdb.dailyChecks(db, { today: today(), settings: currentSettings(), mailer, baseUrl, adminEmails: db.all("SELECT email FROM users WHERE role = 'admin' AND active = 1 AND email <> ''").map(u => u.email) });
      audit(user, 'daily.run', 'Daily checks', out);
      return sendJson(res, 200, out);
    }
    if (p === '/api/admin/patterns' && method === 'GET') {
      requireTab(user, 'patterns', 'edit');
      return sendJson(res, 200, tdb.commitmentPatterns(db, { today: today(), year: Number(url.searchParams.get('year')) || undefined }));
    }

    throw new HttpError(404, 'Not found.');
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) await handle(req, res, url);
      else serveStatic(url.pathname, res);
    } catch (e) {
      if (e instanceof HttpError) return sendJson(res, e.status, Object.assign({ error: e.message }, e.extra));
      console.error(e);
      sendJson(res, 500, { error: 'Something went wrong on the server. Nothing was changed.' });
    }
  });
}

module.exports = { createServer };
