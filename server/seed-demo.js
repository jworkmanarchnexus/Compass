'use strict';
/* The local demo: two published runs (August and September 2026) and the made-up plan logs, dated to match the mockup.
   Written straight to the database with explicit dates, so the demo has a history. It uses the same run builder the
   app uses; only the timestamps are set by hand. Not part of the app: production starts empty. */
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const runsDb = require('./runs');
const planDb = require('./plan');
const settingsRules = require('../shared/rules/settings');
const { createLocalSource } = require('./vp-local');

const at = s => new Date(s).getTime();
const stories = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'db', 'seed', 'plan_stories.json'), 'utf8'));

function seedDemo(db) {
  const source = createLocalSource();
  const settings = settingsRules.DEFAULTS;
  const admin = db.get("SELECT id FROM users WHERE role = 'admin' AND active = 1 ORDER BY username");
  for (const [period, builtAt, publishedAt] of [[202608, '2026-09-01T06:00', '2026-09-02T15:30'], [202609, '2026-10-01T06:00', '2026-10-02T16:15']]) {
    const id = runsDb.buildDraft(db, { source, period, settings });
    db.run('UPDATE runs SET created_at = ? WHERE id = ?', at(builtAt), id); // a draft may still be edited
    db.run("UPDATE runs SET status = 'published', published_at = ?, published_by = ? WHERE id = ?", at(publishedAt), admin.id, id);
  }

  // BD reports for August and September. The one project with no market sector was assigned to Civic by the Admin (as in the mockup).
  const bd = require('./bd');
  const { parseCsv } = require('./csv');
  const noSector = parseCsv(fs.readFileSync(path.join(__dirname, 'db', 'seed', 'bd_projects.csv'), 'utf8')).find(p => !p.Sector);
  if (noSector) db.run('INSERT INTO bd_sector_overrides (wbs1, sector, set_by, set_at) VALUES (?, ?, ?, ?)', noSector.WBS1, 'Civic', admin.id, at('2026-10-02T10:00'));
  for (const [period, builtAt, publishedAt] of [[202608, '2026-09-01T06:05', '2026-09-03T10:05'], [202609, '2026-10-01T06:05', '2026-10-02T11:30']]) {
    const id = bd.buildDraft(db, { source, period, settings });
    db.run('UPDATE runs SET created_at = ? WHERE id = ?', at(builtAt), id);
    db.run("UPDATE runs SET status = 'published', published_at = ?, published_by = ? WHERE id = ?", at(publishedAt), admin.id, id);
  }

  const picByCode = Object.fromEntries(db.all("SELECT * FROM users WHERE role = 'pic'").map(u => [u.employee_code, u.id]));
  for (const story of stories()) {
    const project = db.get('SELECT * FROM projects WHERE wbs1 = ?', story.wbs1);
    const picId = picByCode[project.principal];
    const ids = {}; // label -> entry id
    for (const e of story.entries) {
      const when = at(e.at);
      const date = planDb.localDate(when);
      const base = { wbs1: story.wbs1, authorId: picId, kind: e.kind, body: e.body, date, at: when };
      if (e.kind === 'commitment') { base.id = crypto.randomUUID(); base.commitmentId = base.id; base.data = { promisedBy: e.promisedBy, lever: e.lever }; }
      if (e.kind === 'admin_note') base.authorId = admin.id;
      if (e.kind === 'missed') { base.authorId = null; base.commitmentId = ids[e.c]; base.data = { dueDate: dueOf(db, ids[e.c]) }; }
      if (e.kind === 'done') { base.commitmentId = ids[e.c]; base.data = { improved: e.improved }; }
      if (e.kind === 'date_revised') { base.commitmentId = ids[e.c]; base.data = { from: dueOf(db, ids[e.c]), to: e.to }; }
      if (e.kind === 'correction') base.correctsEntryId = ids[e.corrects];
      const id = planDb.insert(db, base);
      if (e.l) ids[e.l] = id;
    }
  }
  // the daily job's first look, on the demo day, so the check-in queue starts with what it would hold
  require('./turnaround').dailyChecks(db, { today: '2026-10-07', settings, mailer: null, baseUrl: '', adminEmails: [] });
}

/* the commitment's current due date as the log stands, for the entries that refer to it */
function dueOf(db, commitmentId) {
  const plan = require('../modules/turnaround/logic/plan');
  const row = db.get('SELECT wbs1 FROM plan_entries WHERE id = ?', commitmentId);
  return plan.commitmentStates(planDb.entriesFor(db, row.wbs1)).find(c => c.id === commitmentId).dueDate;
}

module.exports = { seedDemo };
