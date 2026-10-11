'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { HttpError } = require('./errors');
const roles = require('../shared/rules/roles');
const settingsRules = require('../shared/rules/settings');

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

function createServer(db) {
  /* ---- settings (effective-dated rows, only ever added) ---- */
  const settingRows = () => db.all('SELECT key, value_json, effective_from, set_by FROM settings').map(r => ({ key: r.key, value: JSON.parse(r.value_json), effectiveFrom: r.effective_from, setBy: r.set_by }));
  const currentSettings = () => settingsRules.allAt(settingRows(), db.now());

  function audit(user, action, object, detail) {
    db.run('INSERT INTO audit_log (at, user_id, action, object, detail_json) VALUES (?, ?, ?, ?, ?)', db.now(), user.id, action, object || '', JSON.stringify(detail || {}));
  }

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

    if (p === '/api/me' && method === 'GET') {
      const access = currentSettings().access;
      return sendJson(res, 200, Object.assign(userOut(user), roles.describe(user.role, access)));
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
        id: r.id, at: r.at, by: names[r.user_id] || 'Unknown', action: r.action, object: r.object, detail: JSON.parse(r.detail_json),
      })));
    }

    if (p === '/api/admin/runs' && method === 'GET') {
      requireTab(user, 'runs', 'view');
      return sendJson(res, 200, db.all('SELECT id, kind, period, version, status, created_at, published_at, published_by, archive_reason FROM runs ORDER BY period DESC, version DESC'));
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
