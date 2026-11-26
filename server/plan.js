'use strict';
/* The plan log, on the database. The rules live in modules/turnaround/logic/plan.js (pure, tested); this file
   reads and appends. There is no function here that changes or removes an entry, and the database refuses it too.

   What a PIC writes (Josh, 2026-11-26): a goal check-in when a month is published, a mid-month update two weeks later, and a comment
   any time. Each is checked by the pure rules first (plan.goalCheckinProblem, plan.midProblem) and written in one transaction. */
const crypto = require('node:crypto');
const { HttpError } = require('./errors');
const plan = require('../modules/turnaround/logic/plan');
const { year } = require('../modules/turnaround/logic/dates');

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

/* wbs1 -> the date the project first showed on a run people could see */
function firstAppeared(db) {
  const out = new Map();
  for (const r of db.all("SELECT rp.wbs1 AS wbs1, MIN(r.published_at) AS at FROM run_projects rp JOIN runs r ON r.id = rp.run_id WHERE r.kind = 'turnaround' AND r.published_at IS NOT NULL GROUP BY rp.wbs1")) out.set(r.wbs1, localDate(r.at));
  return out;
}

/* The rounds: the day each month was first published. A rerun of a month (archive and publish again) does not start a new round. */
function roundStarts(db) {
  return db.all("SELECT MIN(published_at) AS at FROM runs WHERE kind = 'turnaround' AND published_at IS NOT NULL GROUP BY period ORDER BY period").map(r => localDate(r.at)).sort();
}

/* wbs1 -> the rounds of the months the project was on the list (for its on-time record) */
function projectRounds(db) {
  const start = new Map(db.all("SELECT period, MIN(published_at) AS at FROM runs WHERE kind = 'turnaround' AND published_at IS NOT NULL GROUP BY period").map(r => [r.period, localDate(r.at)]));
  const out = new Map();
  for (const r of db.all("SELECT DISTINCT rp.wbs1 AS wbs1, r.period AS period FROM run_projects rp JOIN runs r ON r.id = rp.run_id WHERE r.kind = 'turnaround' AND r.published_at IS NOT NULL")) {
    if (!out.has(r.wbs1)) out.set(r.wbs1, []);
    out.get(r.wbs1).push(start.get(r.period));
  }
  for (const list of out.values()) list.sort();
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

function insert(db, { wbs1, authorId, kind, body, date, correctsEntryId, commitmentId, data, id, at: when }) {
  const at = when || db.now(); // `when` is only for the demo seed, which dates its history by hand
  const eid = id || crypto.randomUUID();
  db.run('INSERT INTO plan_entries (id, wbs1, author_id, kind, body, created_at, entry_date, corrects_entry_id, commitment_id, data_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    eid, wbs1, authorId, kind, body || '', at, date, correctsEntryId || null, commitmentId || null, JSON.stringify(data || {}));
  return eid;
}

/* where a project stands today: its plan status (with the round and what is owed) and its goals this year */
function projectState(db, wbs1, today, settings) {
  const all = entriesFor(db, wbs1);
  const rounds = roundStarts(db);
  const inCycle = all.filter(e => year(e.date) === year(today));
  const status = plan.planStatus({ today, firstAppeared: firstAppeared(db).get(wbs1) || today, entries: all, rounds, settings });
  const goals = plan.commitmentStates(inCycle, rounds, settings);
  const lastGoal = goals.slice().sort((a, b) => b.entryDate.localeCompare(a.entryDate))[0] || null;
  return { all, inCycle, rounds, status, goals, open: goals.filter(g => g.status === 'open'), lastGoal };
}

function writerOr403(user, project) {
  if (!plan.canWrite(user.role, 'commitment', isProjectPic(user, project))) throw new HttpError(403, 'Only the PIC on this project writes in its plan.');
  if (project.status !== 'A') throw new HttpError(409, 'This project is not active.');
}

/* A comment (any time, after the explanation) or an admin note. Goals and mid-month updates have their own steps below. */
function addEntry(db, user, wbs1, input, today) {
  const project = projectOr404(db, wbs1);
  const kind = input.kind;
  if (!['update', 'admin_note'].includes(kind)) throw new HttpError(400, 'That kind of entry does not exist. Goals are set in the goal check-in.');
  if (!plan.canWrite(user.role, kind, isProjectPic(user, project))) throw new HttpError(403, kind === 'admin_note' ? 'Only the Admin adds admin notes.' : 'Only the PIC on this project writes in its plan.');
  if (project.status !== 'A') throw new HttpError(409, 'This project is not active.');
  if (kind === 'update' && !hasExplanation(db, project.wbs1, today)) throw new HttpError(409, 'Start with the goal check-in: say what is driving the loss and set a first goal. Comments come after it.');
  const body = text(input.body, kind === 'admin_note' ? 'The note' : 'The comment');
  return db.tx(() => insert(db, { wbs1: project.wbs1, authorId: user.id, kind, body, date: today }));
}

/* The goal check-in, in one step. input: { cause?, helped?, comment?, keep?, approach?, how? }
   Writes, all or nothing: the explanation (once a year, from `cause`), the report on the open goal (closing it as done, with
   Did it help and the comment), and the next goal (a new one, or the same one carried forward). */
function goalCheckin(db, user, wbs1, input, today, settings) {
  const project = projectOr404(db, wbs1);
  writerOr403(user, project);
  const st = projectState(db, project.wbs1, today, settings);
  const explained = st.inCycle.some(e => e.kind === 'explanation');
  const openGoal = st.open.length ? st.open.slice().sort((a, b) => b.entryDate.localeCompare(a.entryDate))[0] : null;
  const doneThisRound = st.status.hasPlan && !st.status.owes.includes('goal');
  const problem = plan.goalCheckinProblem(input, { explained, openGoal: openGoal && openGoal.id, lastGoal: st.lastGoal && st.lastGoal.id, doneThisRound });
  if (problem) throw new HttpError(doneThisRound ? 409 : 400, problem);
  const cause = explained ? null : text(input.cause, 'What is driving the loss');
  const comment = openGoal ? text(input.comment, 'The comment') : null;
  const keep = input.keep === true;
  const from = keep ? st.inCycle.find(e => e.id === st.lastGoal.id) : null;
  const goalBody = keep ? from.body : text(input.how, 'How, specifically', 1000);
  const data = keep ? { lever: from.data.lever, keptFrom: from.id } : { lever: input.approach };
  if (keep && from.data.otherText) data.otherText = from.data.otherText;
  return db.tx(() => {
    if (cause) insert(db, { wbs1: project.wbs1, authorId: user.id, kind: 'explanation', body: cause, date: today });
    // every open goal is reported on (normally just one; an older plan may have had more than one open)
    for (const g of st.open) insert(db, { wbs1: project.wbs1, authorId: user.id, kind: 'done', body: comment, date: today, commitmentId: g.id, data: { helped: input.helped, improved: input.helped === 'yes' ? true : input.helped === 'no' ? false : null } });
    const id = crypto.randomUUID();
    insert(db, { wbs1: project.wbs1, authorId: user.id, kind: 'commitment', body: goalBody, date: today, id, commitmentId: id, data });
    return id;
  });
}

/* The mid-month update: where the goal stands (In progress, Done, Stuck) and a comment. It does not close the goal. */
function midUpdate(db, user, wbs1, input, today, settings) {
  const project = projectOr404(db, wbs1);
  writerOr403(user, project);
  const st = projectState(db, project.wbs1, today, settings);
  const owes = st.status.owes.includes('mid') && !!st.status.goal;
  const problem = plan.midProblem(input, { owesMid: owes });
  if (problem) throw new HttpError(owes ? 400 : 409, problem);
  const body = text(input.comment, 'The comment');
  return db.tx(() => insert(db, { wbs1: project.wbs1, authorId: user.id, kind: 'update', body, date: today, commitmentId: st.status.goal.id, data: { midStatus: input.status } }));
}

/* the system's own entry: an open goal whose check-in passed by the Admin's "missed after" days */
function recordMissed(db, wbs1, state, today) {
  return insert(db, { wbs1, authorId: null, kind: 'missed', body: '', date: today, commitmentId: state.id, data: { dueDate: state.dueDate } });
}

module.exports = { hasExplanation, localDate, rowToEntry, entriesFor, entriesByProject, firstAppeared, roundStarts, projectRounds, projectState, isProjectPic, projectOr404, addEntry, goalCheckin, midUpdate, recordMissed, insert };
