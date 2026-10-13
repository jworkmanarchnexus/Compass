'use strict';
/* The plan log, on the database. The rules live in modules/turnaround/logic/plan.js (pure, tested); this file
   reads and appends. There is no function here that changes or removes an entry, and the database refuses it too. */
const crypto = require('node:crypto');
const { HttpError } = require('./errors');
const plan = require('../modules/turnaround/logic/plan');
const { isValid } = require('../modules/turnaround/logic/dates');

/* the local calendar date of a time in ms (the server's own time zone; Kent decides what that should be) */
function localDate(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const rowToEntry = r => ({
  id: r.id, kind: r.kind, date: r.entry_date, seq: r.created_at, commitmentId: r.commitment_id || undefined,
  correctsEntryId: r.corrects_entry_id || undefined, data: JSON.parse(r.data_json), body: r.body, authorId: r.author_id, createdAt: r.created_at,
});

function entriesFor(db, wbs1) {
  return db.all('SELECT * FROM plan_entries WHERE wbs1 = ? ORDER BY created_at', wbs1).map(rowToEntry);
}

/* wbs1 -> all entries, for many projects at once */
function entriesByProject(db, wbs1s) {
  const out = new Map(wbs1s.map(w => [w, []]));
  if (!wbs1s.length) return out;
  const marks = wbs1s.map(() => '?').join(',');
  for (const r of db.all(`SELECT * FROM plan_entries WHERE wbs1 IN (${marks}) ORDER BY created_at`, ...wbs1s)) out.get(r.wbs1).push(rowToEntry(r));
  return out;
}

/* wbs1 -> the date the project first showed on a run people could see (the start of its "plan within 14 days" clock) */
function firstAppeared(db) {
  const out = new Map();
  for (const r of db.all('SELECT rp.wbs1 AS wbs1, MIN(r.published_at) AS at FROM run_projects rp JOIN runs r ON r.id = rp.run_id WHERE r.published_at IS NOT NULL GROUP BY rp.wbs1')) out.set(r.wbs1, localDate(r.at));
  return out;
}

/* has the PIC explained this project in the plan cycle (the calendar year of `today`)? Admin notes do not count. */
function hasExplanation(db, wbs1, today) {
  const y = today.slice(0, 4);
  return !!db.get("SELECT 1 AS x FROM plan_entries WHERE wbs1 = ? AND kind = 'explanation' AND entry_date >= ? AND entry_date <= ?", wbs1, `${y}-01-01`, `${y}-12-31`);
}

const isProjectPic = (user, project) => !!user.employee_code && project.principal === user.employee_code;

function projectOr404(db, wbs1) {
  const p = db.get('SELECT * FROM projects WHERE wbs1 = ?', String(wbs1));
  if (!p) throw new HttpError(404, 'Project not found.');
  return p;
}

const text = (v, label, max) => {
  if (typeof v !== 'string' || !v.trim()) throw new HttpError(400, `${label} is required.`);
  if (v.length > (max || 4000)) throw new HttpError(400, `${label} is too long.`);
  return v.trim();
};
const number = (v, label) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1e9) throw new HttpError(400, `${label} must be a number, zero or more.`);
  return v;
};

function insert(db, { wbs1, authorId, kind, body, date, correctsEntryId, commitmentId, data, id, at: when }) {
  const at = when || db.now(); // `when` is only for the demo seed, which dates its history by hand
  const eid = id || crypto.randomUUID();
  db.run('INSERT INTO plan_entries (id, wbs1, author_id, kind, body, created_at, entry_date, corrects_entry_id, commitment_id, data_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    eid, wbs1, authorId, kind, body || '', at, date, correctsEntryId || null, commitmentId || null, JSON.stringify(data || {}));
  return eid;
}

/* A new entry in the log. Who may write what is plan.canWrite; this checks the content. */
function addEntry(db, user, wbs1, input, today, settings) {
  const project = projectOr404(db, wbs1);
  const kind = input.kind;
  if (!['explanation', 'commitment', 'update', 'admin_note'].includes(kind)) throw new HttpError(400, 'That kind of entry does not exist.');
  if (!plan.canWrite(user.role, kind, isProjectPic(user, project))) throw new HttpError(403, kind === 'admin_note' ? 'Only the Admin adds admin notes.' : 'Only the PIC on this project writes in its plan.');
  if (project.status !== 'A') throw new HttpError(409, 'This project is not active.');
  // the order of a plan: one explanation first (it stays the only option until it is written, however late); after that, updates and commitments
  if (kind !== 'admin_note') {
    const explained = hasExplanation(db, project.wbs1, today);
    if (kind === 'explanation' && explained) throw new HttpError(409, 'This project already has its explanation for the year. Add an update or a commitment.');
    if (kind !== 'explanation' && !explained) throw new HttpError(409, 'Start with an explanation of what is driving the loss. Updates and commitments come after it.');
  }
  const body = text(input.body, 'The entry');
  const entry = { wbs1: project.wbs1, authorId: user.id, kind, body, date: today };

  if (kind === 'commitment') {
    if (!plan.LEVERS[input.lever] || plan.LEVERS[input.lever].legacy) throw new HttpError(400, 'Pick one of the actions.');
    // the PIC does not pick a date: the next check-in is every cadence days from the project's first report
    entry.data = { promisedBy: nextDueFor(db, project.wbs1, today, settings), lever: input.lever };
    if (plan.LEVERS[input.lever].other) entry.data.otherText = text(input.otherText, 'What the action is', 120); // "Other" needs its few words
    entry.id = crypto.randomUUID();
    entry.commitmentId = entry.id; // a commitment's id is its own entry's id
  }
  return db.tx(() => insert(db, entry));
}

function commitmentOr404(db, wbs1, id) {
  const state = plan.commitmentStates(entriesFor(db, wbs1)).find(c => c.id === id);
  if (!state) throw new HttpError(404, 'Commitment not found.');
  return state;
}

/* the next check-in date for a project: the first of the report-anchored check-in dates after today */
function nextDueFor(db, wbs1, today, settings) {
  const cadence = (settings && settings['due.cadenceDays']) || 14;
  return plan.nextDue(firstAppeared(db).get(wbs1) || null, today, cadence);
}

/* "Mark done": asks what happened, and yes or no: did this action improve the financial state of the project in the period? On or before its date counts as kept. */
function markDone(db, user, wbs1, commitmentId, input, today) {
  const project = projectOr404(db, wbs1);
  if (!plan.canWrite(user.role, 'done', isProjectPic(user, project))) throw new HttpError(403, 'Only the PIC on this project writes in its plan.');
  const c = commitmentOr404(db, project.wbs1, commitmentId);
  if (c.status !== 'open') throw new HttpError(409, c.status === 'done' ? 'This commitment is already done.' : 'This commitment was recorded as missed and is closed.');
  const body = text(input.body, 'What happened');
  if (typeof input.improved !== 'boolean') throw new HttpError(400, 'Answer yes or no: did this action improve the financial state of the project during this period?');
  return db.tx(() => insert(db, { wbs1: project.wbs1, authorId: user.id, kind: 'done', body, date: today, commitmentId, data: { improved: input.improved } }));
}

/* The check-in: on (or before) a due date the PIC reports back on every open commitment and makes the next one, in one step.
   input: { reports: [{ commitmentId, body, improved }], lever, otherText?, body }
   Each open commitment needs its own report (what happened, and yes or no: did the action improve the project's finances in the period).
   It closes them as done (on or before the date counts as kept) and writes the new commitment, due at the next check-in. All or nothing. */
function checkIn(db, user, wbs1, input, today, settings) {
  const project = projectOr404(db, wbs1);
  if (!plan.canWrite(user.role, 'commitment', isProjectPic(user, project))) throw new HttpError(403, 'Only the PIC on this project writes in its plan.');
  if (project.status !== 'A') throw new HttpError(409, 'This project is not active.');
  if (!hasExplanation(db, project.wbs1, today)) throw new HttpError(409, 'Start with an explanation of what is driving the loss. Updates and commitments come after it.');
  const thisYear = e => e.date >= `${today.slice(0, 4)}-01-01`;
  const open = plan.commitmentStates(entriesFor(db, project.wbs1).filter(thisYear)).filter(c => c.status === 'open');
  const reports = Array.isArray(input.reports) ? input.reports : [];
  for (const r of reports) if (!open.some(c => c.id === r.commitmentId)) throw new HttpError(409, 'One of those commitments is no longer open. Reload the page.');
  const done = open.map(c => {
    const r = reports.find(x => x.commitmentId === c.id);
    if (!r) throw new HttpError(400, 'Report back on every open commitment first.');
    const body = text(r.body, 'What happened');
    if (typeof r.improved !== 'boolean') throw new HttpError(400, 'Answer yes or no: did this action improve the financial state of the project during this period?');
    return { commitmentId: c.id, body, improved: r.improved };
  });
  if (!plan.LEVERS[input.lever] || plan.LEVERS[input.lever].legacy) throw new HttpError(400, 'Pick the kind of action your next commitment will be.');
  const body = text(input.body, 'Your next commitment');
  const data = { promisedBy: nextDueFor(db, project.wbs1, today, settings), lever: input.lever };
  if (plan.LEVERS[input.lever].other) data.otherText = text(input.otherText, 'What the action is', 120);
  return db.tx(() => {
    for (const d of done) insert(db, { wbs1: project.wbs1, authorId: user.id, kind: 'done', body: d.body, date: today, commitmentId: d.commitmentId, data: { improved: d.improved } });
    const id = crypto.randomUUID();
    insert(db, { wbs1: project.wbs1, authorId: user.id, kind: 'commitment', body, date: today, id, commitmentId: id, data });
    return id;
  });
}

/* the system's own entry: an open commitment whose date has passed by the Admin's "missed after" days */
function recordMissed(db, wbs1, state, today) {
  return insert(db, { wbs1, authorId: null, kind: 'missed', body: '', date: today, commitmentId: state.id, data: { dueDate: state.dueDate } });
}

module.exports = { hasExplanation, localDate, rowToEntry, entriesFor, entriesByProject, firstAppeared, isProjectPic, projectOr404, addEntry, markDone, checkIn, recordMissed, insert, nextDueFor };
