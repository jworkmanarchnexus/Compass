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

  // Pipeline watch: eight Monday snapshots (Aug 17 to Oct 5), taken by the same code the Monday job uses
  const pipe = require('./pipeline');
  for (const date of ['2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05']) {
    pipe.takeSnapshot(db, { source, date, settings, now: at(date + 'T05:00') });
  }

  const picByCode = Object.fromEntries(db.all("SELECT * FROM users WHERE role = 'pic'").map(u => [u.employee_code, u.id]));
  for (const story of stories()) {
    const project = db.get('SELECT * FROM projects WHERE wbs1 = ?', story.wbs1);
    const picId = picByCode[project.principal];
    const ids = {}; // label -> entry id
    story.entries.forEach((e, k) => {
      const when = at(e.at) + k; // entries written together (a report and the next goal) keep their order
      const date = planDb.localDate(when);
      // story kinds: explanation, goal (approach + words, or keep: an earlier goal), report (on a goal: helped + comment),
      // mid (the mid-month update on a goal), comment, admin_note
      const base = { wbs1: story.wbs1, authorId: picId, kind: e.kind, body: e.body || '', date, at: when };
      if (e.kind === 'goal') {
        const from = e.keep ? db.get('SELECT * FROM plan_entries WHERE id = ?', ids[e.keep]) : null;
        Object.assign(base, { kind: 'commitment', id: crypto.randomUUID(), body: from ? from.body : e.body, data: from ? { lever: JSON.parse(from.data_json).lever, keptFrom: from.id } : { lever: e.approach } });
        base.commitmentId = base.id;
      }
      if (e.kind === 'report') Object.assign(base, { kind: 'done', commitmentId: ids[e.c], data: { helped: e.helped, improved: e.helped === 'yes' ? true : e.helped === 'no' ? false : null } });
      if (e.kind === 'mid') Object.assign(base, { kind: 'update', commitmentId: ids[e.c], data: { midStatus: e.status } });
      if (e.kind === 'comment') base.kind = 'update';
      if (e.kind === 'admin_note') base.authorId = admin.id;
      const id = planDb.insert(db, base);
      if (e.l) ids[e.l] = id;
    });
  }
  // the daily job's first look, on the demo day, so the check-in queue starts with what it would hold
  require('./turnaround').dailyChecks(db, { today: '2026-10-07', settings, mailer: null, baseUrl: '', adminEmails: [] });
}

module.exports = { seedDemo };
