'use strict';
/* The names Compass shows for Vantagepoint people (PICs, PMs). Vantagepoint's name is the default; the Admin can set the name to
   show instead (Admin > People), for example when someone goes by another name than the one in Vantagepoint. Everything that
   shows a person's name from the employees table goes through employeeNames(), so a change shows everywhere at once.
   The Vantagepoint record is never changed: the override lives in Compass's own table (employee_names). */
const { HttpError } = require('./errors');

const vpName = e => `${e.first_name} ${e.last_name}`.trim();
const MAX = 60;

/* code -> the name to show */
function employeeNames(db) {
  const over = Object.fromEntries(db.all('SELECT code, display_name FROM employee_names').map(o => [o.code, o.display_name]));
  return Object.fromEntries(db.all('SELECT code, first_name, last_name FROM employees').map(e => [e.code, over[e.code] || vpName(e)]));
}

/* for the Admin: every person, their Vantagepoint name and the name shown */
function nameRows(db) {
  const over = Object.fromEntries(db.all('SELECT code, display_name FROM employee_names').map(o => [o.code, o.display_name]));
  return db.all('SELECT code, first_name, last_name FROM employees ORDER BY last_name, first_name')
    .map(e => ({ code: e.code, vpName: vpName(e), displayName: over[e.code] || null }));
}

/* set (or, with an empty name, remove) the name shown for one person. Returns { from, to } for the audit log, or null if nothing changed */
function setName(db, code, name, userId) {
  const e = db.get('SELECT code, first_name, last_name FROM employees WHERE code = ?', String(code));
  if (!e) throw new HttpError(404, 'That person is not in the Vantagepoint copy.');
  if (name !== null && typeof name !== 'string') throw new HttpError(400, 'The name must be text.');
  const clean = (name || '').trim().replace(/\s+/g, ' ');
  if (clean.length > MAX) throw new HttpError(400, `The name must be ${MAX} characters or fewer.`);
  const before = (db.get('SELECT display_name FROM employee_names WHERE code = ?', e.code) || {}).display_name || null;
  // the same as Vantagepoint's name, or empty, means no override
  const to = clean && clean !== vpName(e) ? clean : null;
  if (to === before) return null;
  if (to) db.run('INSERT INTO employee_names (code, display_name, set_by, set_at) VALUES (?, ?, ?, ?) ON CONFLICT(code) DO UPDATE SET display_name = excluded.display_name, set_by = excluded.set_by, set_at = excluded.set_at', e.code, to, userId, db.now());
  else db.run('DELETE FROM employee_names WHERE code = ?', e.code);
  return { from: before || vpName(e), to: to || vpName(e), vpName: vpName(e) };
}

module.exports = { employeeNames, nameRows, setName };
