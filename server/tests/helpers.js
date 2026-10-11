'use strict';
const dbmod = require('../db/db');
const { seed } = require('../seed');
const { createServer } = require('../app');

/* a fresh in-memory database (seeded) with a real server on a random local port */
async function start(opts) {
  const db = dbmod.open(':memory:');
  seed(db);
  const server = createServer(db, Object.assign({ today: () => '2026-10-11', mailer: { sent: [], sendToAdmin(m) { this.sent.push(m); } } }, opts));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  server.unref(); // a test that fails before close() must not keep the process alive
  const base = `http://127.0.0.1:${server.address().port}`;
  const user = username => db.get('SELECT * FROM users WHERE username = ?', username);

  /* api('d.whitfield').put('/api/x', {...}) -> { status, body }. No username = signed out. */
  function api(username) {
    const id = username ? user(username).id : null;
    const call = async (method, path, body) => {
      const headers = {};
      if (id) headers['x-compass-user'] = id;
      if (body !== undefined) headers['content-type'] = 'application/json';
      const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await res.text();
      let json = {}; try { json = text ? JSON.parse(text) : {}; } catch (e) { json = { raw: text }; }
      return { status: res.status, body: json };
    };
    return { get: (p) => call('GET', p), put: (p, b) => call('PUT', p, b), post: (p, b) => call('POST', p, b), del: (p) => call('DELETE', p) };
  }
  return { db, api, user, base, close: () => new Promise(r => server.close(r)) };
}

module.exports = { start };
