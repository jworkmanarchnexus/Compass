'use strict';
/* Resets the local database to the made-up seed data (server/db/seed/*.csv).
   employees.csv and projects.csv stand in for the nightly Vantagepoint copy. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dbmod = require('./db/db');
const { parseCsv } = require('./csv');

const SEED = path.join(__dirname, 'db', 'seed');
const read = f => parseCsv(fs.readFileSync(path.join(SEED, f), 'utf8'));
const TABLES = ['run_warnings', 'runs', 'settings', 'users', 'projects', 'employees'];

/* the VP copy: replaces both tables, like a nightly copy would */
function loadVantagepointCopy(db) {
  db.tx(() => {
    db.run('DELETE FROM projects');
    db.run('DELETE FROM employees');
    for (const e of read('employees.csv')) {
      db.run('INSERT INTO employees (code, first_name, last_name, email) VALUES (?, ?, ?, ?)', e.Employee, e.FirstName, e.LastName, e.Email);
    }
    for (const p of read('projects.csv')) {
      db.run('INSERT INTO projects (wbs1, name, principal, proj_mgr, status) VALUES (?, ?, ?, ?, ?)', p.WBS1, p.Name, p.Principal, p.ProjMgr, p.Status);
    }
  });
}

function seed(db) {
  db.tx(() => {
    // the audit log is append-only by design (trigger), so a reset leaves it alone
    for (const t of TABLES) db.run(`DELETE FROM ${t}`);
  });
  loadVantagepointCopy(db);
  db.tx(() => {
    for (const u of read('users.csv')) {
      db.run('INSERT INTO users (id, username, display_name, email, role, draft_name, employee_code, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        crypto.randomUUID(), u.Username, u.DisplayName, u.Email, u.Role, u.DraftName, u.Employee || null, Number(u.Active));
    }
  });
}

module.exports = { seed, loadVantagepointCopy };

if (require.main === module) {
  const db = dbmod.open();
  seed(db);
  const n = t => db.get(`SELECT COUNT(*) AS n FROM ${t}`).n;
  console.log(`Seeded: ${n('users')} people, ${n('employees')} employees, ${n('projects')} projects.`);
  db.close();
}
