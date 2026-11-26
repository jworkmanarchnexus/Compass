'use strict';
/* My dashboard: each person's saved arrangement. The rules (what a valid layout is) live in modules/dashboard/logic/layout.js;
   this file only reads and writes the one row per person. Nobody can read or change another person's layout. */
const L = require('../modules/dashboard/logic/layout');
const { CATALOG } = require('../modules/dashboard/logic/catalog');
const { HttpError } = require('./errors');

function get(db, user) {
  const row = db.get('SELECT layout_json, updated_at FROM dashboard_layouts WHERE user_id = ?', user.id);
  return { catalog: CATALOG, layout: L.normalize(row ? JSON.parse(row.layout_json) : null, CATALOG), saved: !!row, updatedAt: row ? row.updated_at : null };
}

/* body: { layout } saves it (normalized first, so a bad id or size can never be stored); { reset: true } goes back to the default */
function save(db, user, body) {
  if (body && body.reset === true) {
    db.run('DELETE FROM dashboard_layouts WHERE user_id = ?', user.id);
    return get(db, user);
  }
  if (!body || !body.layout || !Array.isArray(body.layout.items)) throw new HttpError(400, 'Nothing to save.');
  const layout = L.normalize(body.layout, CATALOG);
  db.tx(() => {
    db.run('DELETE FROM dashboard_layouts WHERE user_id = ?', user.id);
    db.run('INSERT INTO dashboard_layouts (user_id, layout_json, updated_at) VALUES (?, ?, ?)', user.id, JSON.stringify(layout), db.now());
  });
  return get(db, user);
}

module.exports = { get, save };
