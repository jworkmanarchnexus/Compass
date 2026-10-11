'use strict';
/* The daily job: records commitments that have passed their date as Missed, prepares check-in drafts for PICs who are
   overdue or have no plan, withdraws drafts that are no longer needed, and (weekdays, only if something is waiting)
   emails the admin a count and a link. It never contacts a PIC. Safe to run twice in a day.

     node server/jobs/daily.js

   A daily Windows Task Scheduler entry is enough. Setting it up is Kent's; nothing here installs a schedule.
   Locally the "email" is a text file in outbox/. */
const dbmod = require('../db/db');
const settingsRules = require('../../shared/rules/settings');
const planDb = require('../plan');
const tdb = require('../turnaround');
const { createFileMailer } = require('../mail');

function main() {
  const db = dbmod.open();
  try {
    if (!db.get('SELECT 1 AS x FROM users LIMIT 1')) { console.log('The database is empty. Start Compass once (npm start) or run npm run seed first.'); return; }
    const rows = db.all('SELECT key, value_json, effective_from FROM settings').map(r => ({ key: r.key, value: JSON.parse(r.value_json), effectiveFrom: r.effective_from }));
    const settings = settingsRules.allAt(rows, db.now());
    const today = process.env.COMPASS_TODAY || planDb.localDate(Date.now());
    const out = tdb.dailyChecks(db, {
      today, settings, mailer: createFileMailer(), baseUrl: process.env.COMPASS_URL || 'http://localhost:5281',
      adminEmails: db.all("SELECT email FROM users WHERE role = 'admin' AND active = 1 AND email <> ''").map(u => u.email),
    });
    db.run('INSERT INTO audit_log (at, user_id, action, object, detail_json) VALUES (?, ?, ?, ?, ?)', db.now(), 'system', 'daily.run', 'Daily checks', JSON.stringify(out));
    console.log(`Daily checks for ${today}: ${out.missed} recorded as missed, ${out.created} new drafts, ${out.withdrawn} withdrawn${out.emailed ? ', admin emailed' : ''}.`);
  } finally { db.close(); }
}

if (require.main === module) main();
module.exports = { main };
