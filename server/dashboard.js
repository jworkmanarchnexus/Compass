'use strict';
/* My dashboards: who has which (from the projects they are PIC or PM on in the Vantagepoint copy) and each person's saved
   arrangement per dashboard. The rules live in modules/dashboard/logic/; this file reads and writes. Nobody can read or
   change another person's arrangement. */
const L = require('../modules/dashboard/logic/layout');
const B = require('../modules/dashboard/logic/boards');
const { CATALOGS } = require('../modules/dashboard/logic/catalog');
const { HttpError } = require('./errors');

const count = (db, col, code) => code ? db.get(`SELECT COUNT(*) AS n FROM projects WHERE status = 'A' AND ${col} = ?`, code).n : 0;

function boardsOf(db, user) {
  return B.boardsFor({ role: user.role, picProjects: count(db, 'principal', user.employee_code), pmProjects: count(db, 'proj_mgr', user.employee_code) });
}
function requireBoard(db, user, board) {
  if (!B.BOARDS.includes(board)) throw new HttpError(404, 'There is no such dashboard.');
  if (!boardsOf(db, user).includes(board)) throw new HttpError(403, 'You do not have access to this.');
}

/* settings = the Admin settings in force; the page needs the fee burn's projected-spend percent */
function get(db, user, board, settings) {
  requireBoard(db, user, board);
  const s = settings || {};
  const burn = { projectedSpendPct: s['dashboard.projectedSpendPct'] };
  const rules = { watchProfitPct: s['dashboard.watchProfitPct'], endingSoonDays: s['dashboard.endingSoonDays'] }; // status and chips on the tabs
  const row = db.get('SELECT layout_json, updated_at FROM dashboard_layouts WHERE user_id = ? AND board = ?', user.id, board);
  return { board, label: B.BOARD_LABEL[board], catalog: CATALOGS[board], layout: L.normalize(row ? JSON.parse(row.layout_json) : null, CATALOGS[board]), saved: !!row, updatedAt: row ? row.updated_at : null, burn, rules };
}

/* body: { layout } saves it (normalized first, so a bad id or size can never be stored); { reset: true } goes back to the default */
function save(db, user, board, body, settings) {
  requireBoard(db, user, board);
  if (body && body.reset === true) {
    db.run('DELETE FROM dashboard_layouts WHERE user_id = ? AND board = ?', user.id, board);
    return get(db, user, board, settings);
  }
  if (!body || !body.layout || !Array.isArray(body.layout.items)) throw new HttpError(400, 'Nothing to save.');
  const layout = L.normalize(body.layout, CATALOGS[board]);
  db.tx(() => {
    db.run('DELETE FROM dashboard_layouts WHERE user_id = ? AND board = ?', user.id, board);
    db.run('INSERT INTO dashboard_layouts (user_id, board, layout_json, updated_at) VALUES (?, ?, ?, ?)', user.id, board, JSON.stringify(layout), db.now());
  });
  return get(db, user, board, settings);
}

module.exports = { boardsOf, get, save };
