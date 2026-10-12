'use strict';
/* The monthly job: pulls last month's numbers and builds the DRAFT run, then emails the admin a count and a link.
   It never publishes. Safe to run twice: if a draft or published run exists for the month, it does nothing.

     node server/jobs/monthly-run.js              build the last closed month
     node server/jobs/monthly-run.js 202609       build a specific month
     node server/jobs/monthly-run.js --scheduled  build only if today is the first business day (for a daily schedule)

   Locally it reads made-up CSV files and writes the "email" to outbox/. Kent replaces the source (the Vantagepoint
   query) and the mailer; see server/vp-local.js and server/mail.js. */
const dbmod = require('../db/db');
const runsDb = require('../runs');
const bdDb = require('../bd');
const schedule = require('../../modules/turnaround/logic/schedule');
const settingsRules = require('../../shared/rules/settings');
const { createLocalSource } = require('../vp-local');
const { createFileMailer } = require('../mail');

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function main(argv) {
  const scheduled = argv.includes('--scheduled');
  const arg = argv.find(a => /^\d{6}$/.test(a));
  const today = localToday();
  if (scheduled && !schedule.isFirstBusinessDay(today)) { console.log(`${today} is not the first business day; nothing to do.`); return; }
  const period = arg ? Number(arg) : schedule.lastClosedPeriod(today);

  const db = dbmod.open();
  try {
    if (!db.get('SELECT 1 AS x FROM users LIMIT 1')) { console.log('The database is empty. Start Compass once (npm start) or run npm run seed first.'); return; }
    const rows = db.all('SELECT key, value_json, effective_from FROM settings').map(r => ({ key: r.key, value: JSON.parse(r.value_json), effectiveFrom: r.effective_from }));
    const settings = settingsRules.allAt(rows, db.now());
    const out = runsDb.runMonthly(db, {
      source: createLocalSource(), settings, period, mailer: createFileMailer(), baseUrl: process.env.COMPASS_URL || 'http://localhost:5281',
      adminEmails: db.all("SELECT email FROM users WHERE role = 'admin' AND active = 1 AND email <> ''").map(u => u.email),
    });
    if (!out.created) console.log(`There is already a Project Turnaround draft or published run for ${schedule.periodLabel(period)}; nothing changed there.`);
    if (out.created) db.run('INSERT INTO audit_log (at, user_id, action, object, detail_json) VALUES (?, ?, ?, ?, ?)', db.now(), 'system', 'run.build', `Project Turnaround ${schedule.periodLabel(period)} v1`, JSON.stringify({ runId: out.id, by: 'scheduled job' }));
    // the BD report is built the same day, from the same pull
    const adminEmails = db.all("SELECT email FROM users WHERE role = 'admin' AND active = 1 AND email <> ''").map(u => u.email);
    try {
      const bd = bdDb.runMonthly(db, { source: createLocalSource(), settings, period, mailer: createFileMailer(), baseUrl: process.env.COMPASS_URL || 'http://localhost:5281', adminEmails });
      if (bd.created) { db.run('INSERT INTO audit_log (at, user_id, action, object, detail_json) VALUES (?, ?, ?, ?, ?)', db.now(), 'system', 'bd.build', `BD report ${schedule.periodLabel(period)}, version 1`, JSON.stringify({ runId: bd.id, by: 'scheduled job' })); console.log(`Built the ${schedule.periodLabel(period)} BD report draft.`); }
      else console.log(`There is already a BD report draft or published report for ${schedule.periodLabel(period)}; nothing changed there.`);
    } catch (e) { console.log(`The BD report was not built: ${e.message}`); }
    if (out.created) console.log(`Built the ${schedule.periodLabel(period)} Project Turnaround draft. Review it in Admin > Report runs.`);
  } finally { db.close(); }
}

if (require.main === module) main(process.argv.slice(2));
module.exports = { main };
