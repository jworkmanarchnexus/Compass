'use strict';
/* The Monday job: saves the pipeline snapshot (MWIP and contracted forecast, as they stand), checks the alert rules, and, only
   if something needs a look, emails the Admin a count and a link. It never contacts a PIC. Safe to run twice: a Monday that
   already has a snapshot is left alone.

     node server/jobs/weekly-snapshot.js            this week's Monday
     COMPASS_TODAY=2026-10-12 node server/jobs/weekly-snapshot.js

   Kent sets up the schedule (Monday 5:00 a.m. is the plan); nothing here installs one. Locally the "email" is a text file in outbox/. */
const dbmod = require('../db/db');
const settingsRules = require('../../shared/rules/settings');
const planDb = require('../plan');
const pipe = require('../pipeline');
const { createLocalSource } = require('../vp-local');
const { createFileMailer } = require('../mail');

function main() {
  const db = dbmod.open();
  try {
    if (!db.get('SELECT 1 AS x FROM users LIMIT 1')) { console.log('The database is empty. Start Compass once (npm start) or run npm run seed first.'); return; }
    const rows = db.all('SELECT key, value_json, effective_from FROM settings').map(r => ({ key: r.key, value: JSON.parse(r.value_json), effectiveFrom: r.effective_from }));
    const settings = settingsRules.allAt(rows, db.now());
    const today = process.env.COMPASS_TODAY || planDb.localDate(Date.now());
    const date = pipe.mondayOf(today);
    const out = pipe.runWeekly(db, {
      source: createLocalSource(), settings, date, mailer: createFileMailer(), baseUrl: process.env.COMPASS_URL || 'http://localhost:5281',
      adminEmails: db.all("SELECT email FROM users WHERE role = 'admin' AND active = 1 AND email <> ''").map(u => u.email),
    });
    if (out.created) db.run('INSERT INTO audit_log (at, user_id, action, object, detail_json) VALUES (?, ?, ?, ?, ?)', db.now(), 'system', 'pipeline.snapshot', `Snapshot ${date}`, JSON.stringify({ alerts: out.alerts, emailed: !!out.emailed }));
    console.log(out.created ? `Pipeline snapshot for ${date}: ${out.alerts} alerts${out.emailed ? ', admin emailed' : ''}.` : `There is already a snapshot for ${date}; nothing changed.`);
  } finally { db.close(); }
}

if (require.main === module) main();
module.exports = { main };
