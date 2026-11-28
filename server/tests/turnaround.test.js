'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { start } = require('./helpers');
const { seed } = require('../seed');

/* every test runs on the demo data (August and September published, plan logs written) on the mockup's day */
async function withDemo(fn, opts) {
  const mailer = { sent: [], sendToAdmin(m) { this.sent.push(m); } };
  const t = await start(Object.assign({ demo: true, today: () => '2026-10-07', mailer }, opts));
  t.mailer = mailer;
  try { await fn(t); } finally { await t.close(); }
}
const statusOf = (overview, wbs1) => overview.pics.flatMap(p => p.projects).find(p => p.wbs1 === wbs1).plan;

test('since last month, and the charts\' history', () => withDemo(async ({ api }) => {
  const o = (await api('j.workman').get('/api/turnaround/current')).body;
  assert.strictEqual(o.since.label, 'August 2026');
  assert.strictEqual(o.since.added, 2, 'Tooele and Draper are new this month');
  assert.strictEqual(o.since.off, 0);
  assert.strictEqual(o.since.improved + o.since.worse, 14);
  assert.strictEqual(o.history.length, 12);
  assert.deepStrictEqual(o.history.filter(h => h.lastYear).map(h => h.period), [202510, 202511, 202512]);
  const sep = o.history[11];
  assert.deepStrictEqual([sep.period, sep.negativeYtd, sep.belowCount], [202609, -45004000, 16], 'the last point is the run itself');
}));

test('the page on the demo day: 16 projects, 7 done for this round, 7 due Oct 9, 2 with no goal yet', () => withDemo(async ({ api }) => {
  const r = await api('j.workman').get('/api/turnaround/current');
  assert.strictEqual(r.status, 200);
  const o = r.body;
  assert.strictEqual(o.run.period, 202609);
  assert.strictEqual(o.kpis.projectCount, 16);
  assert.strictEqual(o.kpis.negativeYtd, -45004000);
  assert.deepStrictEqual([o.kpis.plansCurrent, o.kpis.updateDue, o.kpis.pastDue, o.kpis.noPlan], [7, 7, 0, 2]);
  assert.strictEqual(o.pics.length, 7, 'every active PIC, including one with nothing below break-even');
  assert.deepStrictEqual(o.pics.map(p => [p.name, p.projects.length]).sort(), [['Ben Okafor', 2], ['Dana Whitfield', 4], ['Elena Castellanos', 2], ['Marcus Oyelaran', 3], ['Priya Raman', 3], ['Riley Chen', 0], ['Tom Lindqvist', 2]]);
  // the September numbers were published Oct 2: the goal check-in is due five weekdays later, Oct 9
  const expected = { '2025-0412': ['current', null, 0, ''], '2024-0388': ['update_due', '2026-10-09', 0, 'goal'], '2024-0356': ['no_plan', '2026-09-09', 28, 'goal'], '2025-0230': ['no_plan', '2026-10-09', 0, 'goal'], '2024-0399': ['current', null, 0, ''] };
  for (const [wbs1, want] of Object.entries(expected)) { const s = statusOf(o, wbs1); assert.deepStrictEqual([s.status, s.dueDate, s.daysOverdue, s.owes.join()], want, wbs1); }
  const row = wbs1 => o.pics.flatMap(p => p.projects).find(p => p.wbs1 === wbs1);
  assert.deepStrictEqual([row('2025-0412').goal.approach, row('2025-0412').goal.text], ['Bring in additional revenue', 'Meet the owner\'s rep on site, walk the added rooms, and get the request signed.']);
  assert.strictEqual(row('2025-0098').goal.kept, true, 'Beehive kept the same goal');
  assert.strictEqual(row('2024-0356').goal, null, 'Granite Ridge has no goal yet');
}));

test('a project\'s page: every goal and comment, newest first, for everyone who may read it', () => withDemo(async ({ api }) => {
  for (const who of ['j.workman', 'd.whitfield', 't.lindqvist', 'm.hale']) {
    const r = await api(who).get('/api/projects/2025-0412/plan');
    assert.strictEqual(r.status, 200, who);
    const p = r.body;
    assert.deepStrictEqual([p.project.name, p.project.pic.name, p.cycle, p.onList], ['Wasatch Valley Clinic TI', 'Dana Whitfield', 2026, true]);
    assert.deepStrictEqual(p.entries.map(e => e.kind), ['commitment', 'done', 'update', 'admin_note', 'commitment', 'explanation']);
    assert.deepStrictEqual(p.entries.map(e => [e.helped || null, e.midStatus || null]).filter(x => x[0] || x[1]), [['early', null], [null, 'progress']]);
    assert.deepStrictEqual(p.goals.map(g => [g.status, g.approach]), [['open', 'Bring in additional revenue'], ['done', 'Bring in additional revenue']]);
    const first = p.goals[1];
    assert.deepStrictEqual([first.helped, first.onTime, first.report.text.slice(0, 12), first.mids.map(m => m.status)], ['early', true, 'Request went', ['progress']]);
    assert.strictEqual(p.facts.profitYtd, -4125000);
    assert.strictEqual(typeof p.facts.change, 'number');
    assert.strictEqual(p.status.status, 'current');
    assert.deepStrictEqual(p.approaches.map(a => [a.key, a.ideas.length]), [['cost', 4], ['revenue', 4]]);
  }
  assert.deepStrictEqual((await api('j.workman').get('/api/projects/2025-0412/plan')).body.can, { goalCheckin: false, mid: false, comment: false, adminNote: true });
  assert.deepStrictEqual((await api('t.lindqvist').get('/api/projects/2025-0412/plan')).body.can, { goalCheckin: false, mid: false, comment: false, adminNote: false }, 'another PIC reads');
  assert.deepStrictEqual((await api('d.whitfield').get('/api/projects/2025-0412/plan')).body.can, { goalCheckin: false, mid: false, comment: true, adminNote: false }, 'done for this round: a comment is still possible');
  assert.strictEqual((await api('c.brandt').get('/api/projects/2025-0412/plan')).status, 403, 'Marketing has no Turnaround access by default');
  assert.strictEqual((await api('kent').get('/api/projects/2025-0412/plan')).status, 403);
  // the PIC steps through their own projects on the list, worst first
  const steps = (await api('d.whitfield').get('/api/projects/2025-0412/plan')).body.steps;
  assert.deepStrictEqual(steps.map(s => [s.wbs1, s.plan.status]), [['2025-0412', 'current'], ['2024-0388', 'update_due'], ['2025-0173', 'update_due'], ['2025-0291', 'current']]);
  assert.deepStrictEqual((await api('t.lindqvist').get('/api/projects/2025-0412/plan')).body.steps, [], 'only on their own projects');
}));

test('only the PIC on a project writes in its plan; Admin only adds labeled notes', () => withDemo(async ({ api }) => {
  const dana = api('d.whitfield');
  const post = (who, wbs1, body) => api(who).post(`/api/projects/${wbs1}/plan/entries`, body);
  assert.strictEqual((await post('d.whitfield', '2025-0412', { kind: 'update', body: 'Owner signed the amendment.' })).status, 201);
  assert.strictEqual((await post('t.lindqvist', '2025-0412', { kind: 'update', body: 'I will write on Dana\'s project.' })).status, 403, 'another PIC');
  assert.strictEqual((await post('j.workman', '2025-0412', { kind: 'update', body: 'Admin cannot write in a PIC\'s voice.' })).status, 403);
  assert.strictEqual((await post('j.workman', '2025-0412', { kind: 'admin_note', body: 'Please send me the signed copy.' })).status, 201);
  assert.strictEqual((await post('d.whitfield', '2025-0412', { kind: 'admin_note', body: 'PICs cannot add admin notes.' })).status, 403);
  for (const who of ['m.hale', 'kent']) assert.strictEqual((await post(who, '2025-0412', { kind: 'update', body: 'x' })).status, 403, who);
  assert.strictEqual((await api().get('/api/projects/2025-0412/plan')).status, 401);
  assert.strictEqual((await dana.get('/api/projects/9999-0000/plan')).status, 404);
  const log = (await dana.get('/api/projects/2025-0412/plan')).body.entries;
  assert.deepStrictEqual(log.slice(0, 2).map(e => [e.kind, e.author.name]), [['admin_note', 'Josh Workman'], ['update', 'Dana Whitfield']]);
}));

test('goals and comments only: the older kinds of entry cannot be written, and a comment needs words', () => withDemo(async ({ api }) => {
  const post = body => api('d.whitfield').post('/api/projects/2025-0412/plan/entries', body);
  for (const kind of ['commitment', 'explanation', 'correction', 'done', 'date_revised', 'missed', 'nonsense']) assert.strictEqual((await post({ kind, body: 'x', lever: 'cost' })).status, 400, kind);
  assert.strictEqual((await post({ kind: 'update', body: '   ' })).status, 400);
  assert.strictEqual((await api('d.whitfield').post('/api/projects/2025-0412/plan/commitments/x/done', { body: 'x', improved: true })).status, 404, 'there is no Mark done any more');
}));

test('the goal check-in: checked first, then written in one step', () => withDemo(async ({ api, db }) => {
  const dana = api('d.whitfield');
  const url = '/api/projects/2024-0388/plan/checkin'; // Ogden: a goal from September, this month's check-in not done yet
  const page = (await dana.get('/api/projects/2024-0388/plan')).body;
  assert.deepStrictEqual([page.can.goalCheckin, page.form.explained, page.form.openGoal.approach], [true, true, 'Lower costs']);
  const before = db.get('SELECT COUNT(*) AS n FROM plan_entries').n;
  const good = { helped: 'yes', comment: 'Punch list is down to three items.', approach: 'revenue', how: 'Bill the extra closeout months as additional services.' };
  const refused = async (body, status, text) => { const r = await dana.post(url, body); assert.strictEqual(r.status, status, text); if (text) assert.match(r.body.error, new RegExp(text)); };
  await refused({}, 400, 'Say whether your last goal helped');
  await refused({ helped: 'maybe', comment: 'x', approach: 'cost', how: 'x' }, 400, 'Say whether your last goal helped');
  await refused(Object.assign({}, good, { comment: '  ' }), 400, 'Add a comment on how your last goal went');
  await refused(Object.assign({}, good, { approach: undefined }), 400, 'Keep the same goal, or set a new one');
  await refused(Object.assign({}, good, { approach: undefined, keep: false }), 400, 'Pick an approach');
  await refused(Object.assign({}, good, { approach: 'labor' }), 400, 'Pick an approach');
  await refused(Object.assign({}, good, { how: '' }), 400, 'Say how, specifically');
  assert.strictEqual((await api('t.lindqvist').post(url, good)).status, 403, 'only the PIC on the project');
  assert.strictEqual((await api('j.workman').post(url, good)).status, 403);
  assert.strictEqual(db.get('SELECT COUNT(*) AS n FROM plan_entries').n, before, 'a refused check-in writes nothing');

  const r = await dana.post(url, good);
  assert.strictEqual(r.status, 201);
  assert.strictEqual(db.get('SELECT COUNT(*) AS n FROM plan_entries').n, before + 2, 'the report on the last goal, and the next goal');
  assert.strictEqual(r.body.status.status, 'current', 'done for this round');
  assert.deepStrictEqual(r.body.goals.map(g => [g.status, g.approach, g.helped, g.onTime]), [['open', 'Bring in additional revenue', null, null], ['done', 'Lower costs', 'yes', true]]);
  assert.strictEqual(r.body.goals[1].report.text, 'Punch list is down to three items.');
  assert.strictEqual(r.body.can.goalCheckin, false);
  await refused(good, 409, 'already done');

  // keeping the same goal carries its approach and words forward
  const k = await dana.post('/api/projects/2025-0173/plan/checkin', { helped: 'early', comment: 'Change order went out Oct 1.', keep: true });
  assert.strictEqual(k.status, 201);
  assert.deepStrictEqual([k.body.goals[0].kept, k.body.goals[0].text, k.body.goals[0].approach], [true, 'Send the owner a change order for the door supplier\'s price increase.', 'Bring in additional revenue']);
}));

test('a project new to the list: its first goal check-in says what is driving the loss', () => withDemo(async ({ api }) => {
  const marcus = api('m.oyelaran');
  const base = '/api/projects/2025-0230/plan'; // Tooele: new on the September run, nothing written yet
  const early = await marcus.post(base + '/entries', { kind: 'update', body: 'Quick update.' });
  assert.strictEqual(early.status, 409);
  assert.match(early.body.error, /Start with the goal check-in/);
  assert.strictEqual((await api('j.workman').post(base + '/entries', { kind: 'admin_note', body: 'What is going on here?' })).status, 201, 'an admin note does not stand in for it');
  const page = (await marcus.get(base)).body;
  assert.deepStrictEqual([page.can.goalCheckin, page.can.comment, page.form.explained, page.form.openGoal], [true, false, false, null]);
  assert.strictEqual((await marcus.post(base + '/checkin', { approach: 'revenue', how: 'Ask for a fee adjustment.' })).status, 400, 'the cause comes first');
  const r = await marcus.post(base + '/checkin', { cause: 'A late change in the structural scope.', approach: 'revenue', how: 'Ask for a fee adjustment.' });
  assert.strictEqual(r.status, 201);
  assert.deepStrictEqual(r.body.entries.map(e => e.kind), ['commitment', 'explanation', 'admin_note']);
  assert.strictEqual(r.body.status.status, 'current');
  assert.strictEqual((await marcus.post(base + '/entries', { kind: 'update', body: 'Met the owner.' })).status, 201, 'comments from now on');
}));

test('the mid-month update: owed two weeks after publishing, with where it stands and a comment', () => withDemo(async ({ api }) => {
  const dana = api('d.whitfield');
  const url = '/api/projects/2025-0412/plan/midmonth';
  const page = (await dana.get('/api/projects/2025-0412/plan')).body;
  assert.deepStrictEqual([page.status.status, page.status.dueDate, page.status.owes, page.can.mid], ['update_due', '2026-10-23', ['mid'], true], 'opened Oct 16, due five weekdays later');
  assert.match((await dana.post(url, {})).body.error, /Pick where it stands/);
  assert.match((await dana.post(url, { status: 'progress', comment: ' ' })).body.error, /Add a comment on where it stands/);
  assert.strictEqual((await api('t.lindqvist').post(url, { status: 'progress', comment: 'x' })).status, 403);
  const r = await dana.post(url, { status: 'stuck', comment: 'The owner\'s rep is out until Oct 26.' });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.status.status, 'current');
  assert.deepStrictEqual(r.body.goals[0].mids.map(m => [m.status, m.text]), [['stuck', 'The owner\'s rep is out until Oct 26.']]);
  assert.strictEqual(r.body.goals[0].status, 'open', 'it does not close the goal');
  assert.strictEqual((await dana.post(url, { status: 'progress', comment: 'Again.' })).status, 409, 'once a round');
  // Ogden still owes this month's goal check-in, so there is no mid-month update to give
  assert.strictEqual((await dana.post('/api/projects/2024-0388/plan/midmonth', { status: 'progress', comment: 'x' })).status, 409);
}, { today: () => '2026-10-19' }));

test('no mid-month update before it opens', () => withDemo(async ({ api }) => {
  const r = await api('d.whitfield').post('/api/projects/2025-0412/plan/midmonth', { status: 'progress', comment: 'Early.' });
  assert.strictEqual(r.status, 409);
  assert.match(r.body.error, /no mid-month update due/);
}));

test('the round settings: change them and the due dates move', () => withDemo(async ({ api }) => {
  const josh = api('j.workman'); const dana = api('d.whitfield');
  const ogden = async () => { const s = (await dana.get('/api/projects/2024-0388/plan')).body.status; return [s.status, s.dueDate, s.daysOverdue]; };
  assert.deepStrictEqual(await ogden(), ['update_due', '2026-10-09', 0]);
  assert.strictEqual((await josh.put('/api/admin/settings', { changes: { 'round.dueBusinessDays': 0 } })).status, 400);
  assert.strictEqual((await josh.put('/api/admin/settings', { changes: { 'round.midOpensDays': 5 } })).status, 400);
  assert.strictEqual((await josh.put('/api/admin/settings', { changes: { 'round.dueBusinessDays': 2 } })).status, 200);
  assert.deepStrictEqual(await ogden(), ['overdue', '2026-10-06', 1], 'published Friday Oct 2: two weekdays later is Tuesday Oct 6');
}));

test('the plan log is append-only: no API path and no database path changes or removes an entry', () => withDemo(async ({ api, db }) => {
  const entry = db.get('SELECT * FROM plan_entries ORDER BY created_at LIMIT 1');
  assert.throws(() => db.run("UPDATE plan_entries SET body = 'edited' WHERE id = ?", entry.id), /append-only/);
  assert.throws(() => db.run('DELETE FROM plan_entries WHERE id = ?', entry.id), /append-only/);
  assert.throws(() => db.run("UPDATE plan_entries SET kind = 'update'"), /append-only/);
  assert.throws(() => db.run('DELETE FROM plan_entries'), /append-only/);
  const before = db.get('SELECT COUNT(*) n FROM plan_entries').n;
  for (const who of ['d.whitfield', 'j.workman']) {
    for (const m of ['put', 'del']) {
      assert.strictEqual((await api(who)[m](`/api/projects/2025-0412/plan/entries`, { body: 'x' })).status, 404, `${who} ${m}`);
      assert.strictEqual((await api(who)[m](`/api/projects/2025-0412/plan/entries/${entry.id}`, { body: 'x' })).status, 404, `${who} ${m} one`);
      assert.strictEqual((await api(who)[m](`/api/projects/2025-0412/plan/checkin`, { body: 'x' })).status, 404, `${who} ${m} check-in`);
    }
  }
  assert.strictEqual(db.get('SELECT COUNT(*) n FROM plan_entries').n, before);
}));

test('the daily job records a goal as missed 14 days after its goal check-in was due, and only then', async () => {
  const t1 = await start({ demo: true, today: () => '2026-10-22' });
  try { assert.strictEqual((await t1.api('j.workman').post('/api/admin/daily')).body.missed, 0, 'Oct 22: 13 days after Oct 9'); } finally { await t1.close(); }
  const t2 = await start({ demo: true, today: () => '2026-10-23' });
  try {
    const out = (await t2.api('j.workman').post('/api/admin/daily')).body;
    assert.strictEqual(out.missed, 7, 'the seven September goals nobody reported on');
    const page = (await t2.api('j.workman').get('/api/projects/2024-0388/plan')).body;
    assert.deepStrictEqual([page.entries[0].kind, page.entries[0].author], ['missed', null], 'recorded by the system, not by a person');
    assert.deepStrictEqual(page.goals.map(g => g.status), ['missed']);
    assert.strictEqual((await t2.api('j.workman').post('/api/admin/daily')).body.missed, 0, 'once');
    // with the goal missed, the PIC sets a new one without reporting on it
    const r = await t2.api('d.whitfield').post('/api/projects/2024-0388/plan/checkin', { approach: 'cost', how: 'Close the punch list.' });
    assert.strictEqual(r.status, 201);
  } finally { await t2.close(); }
});

test('the daily job prepares check-in drafts, never emails a PIC, and emails the admin one count', () => withDemo(async ({ api, mailer }) => {
  const josh = api('j.workman');
  // the demo seed ran the job on Oct 7, when nothing was past due; by Monday Oct 12 the goal check-ins due Oct 9 are 3 days late
  assert.strictEqual((await josh.get('/api/admin/checkins')).body.waiting.length, 0);
  const out = (await josh.post('/api/admin/daily')).body;
  assert.deepStrictEqual([out.created, out.emailed], [5, true]);
  const q = (await josh.get('/api/admin/checkins')).body;
  assert.deepStrictEqual(q.waiting.map(d => [d.pic.name, d.step, d.items.map(i => i.wbs1).sort()]).sort(), [
    ['Ben Okafor', 1, ['2025-0334']], ['Dana Whitfield', 1, ['2024-0388', '2025-0173']], ['Marcus Oyelaran', 1, ['2024-0356', '2025-0230']],
    ['Priya Raman', 1, ['2024-0420', '2025-0144']], ['Tom Lindqvist', 1, ['2024-0207', '2025-0187']]], 'one draft per PIC');
  const tom = q.waiting.find(d => d.pic.name === 'Tom Lindqvist');
  assert.strictEqual(tom.subject, 'Project Turnaround Updates');
  assert.ok(/^(Airfield Maintenance Facility and Sandy Rec Center Reroof|Sandy Rec Center Reroof and Airfield Maintenance Facility)$/.test(tom.body), 'only the project names; Josh writes the rest in Outlook');
  assert.deepStrictEqual(q.escalate.map(x => x.wbs1), ['2024-0356'], 'Granite Ridge has had no goal for over 21 days: a conversation, not another note');

  assert.strictEqual(mailer.sent.length, 1, 'one email, to the admin');
  assert.deepStrictEqual(mailer.sent[0].to, ['josh.workman@example.test']);
  assert.match(mailer.sent[0].body, /^5 check-in drafts are waiting/);
  const text = mailer.sent[0].subject + mailer.sent[0].body;
  for (const n of ['Tom', 'Dana', 'Airfield', 'Ogden', 'Lindqvist', 'Whitfield']) assert.ok(!text.includes(n), `the email must not mention ${n}`);
  const again = (await josh.post('/api/admin/daily')).body;
  assert.deepStrictEqual([again.created, again.emailed], [0, false], 'repeating the job the same day changes nothing');
  assert.strictEqual(mailer.sent.length, 1);
  assert.strictEqual((await api('d.whitfield').get('/api/admin/checkins')).status, 403, 'PICs never see the queue');
  assert.strictEqual((await api('d.whitfield').post('/api/admin/daily')).status, 403);
  assert.strictEqual((await josh.get('/api/me')).body.badges.checkins, 5);
  assert.strictEqual((await api('d.whitfield').get('/api/me')).body.badges, undefined);
}, { today: () => '2026-10-12' }));

test('no email on a weekend', () => withDemo(async ({ api, mailer }) => {
  const out = (await api('j.workman').post('/api/admin/daily')).body;
  assert.deepStrictEqual([out.missed, out.created, out.emailed], [0, 5, false], 'drafts are prepared on a Saturday, but no email goes out');
  assert.strictEqual(mailer.sent.length, 0);
}, { today: () => '2026-10-17' }));

test('send, undo, dismiss and edit work on a draft; a dismissed one stays gone', () => withDemo(async ({ api }) => {
  const josh = api('j.workman');
  await josh.post('/api/admin/daily');
  let q = (await josh.get('/api/admin/checkins')).body;
  const d = q.waiting.find(x => x.pic.name === 'Dana Whitfield');
  assert.strictEqual((await josh.put(`/api/admin/checkins/${d.id}`, { subject: 'Ogden and Hangar 7', body: 'Edited in Josh\'s words.' })).status, 200);
  assert.strictEqual((await josh.put(`/api/admin/checkins/${d.id}`, { subject: '', body: 'x' })).status, 400);
  q = (await josh.post(`/api/admin/checkins/${d.id}/send`)).body;
  assert.strictEqual(q.waiting.length, 4);
  assert.strictEqual(q.sent[0].body, 'Edited in Josh\'s words.');
  assert.strictEqual((await josh.post(`/api/admin/checkins/${d.id}/send`)).status, 409, 'already sent');
  assert.strictEqual((await josh.put(`/api/admin/checkins/${d.id}`, { subject: 'x', body: 'x' })).status, 409, 'only a waiting draft can be edited');
  q = (await josh.post(`/api/admin/checkins/${d.id}/undo`)).body;
  assert.strictEqual(q.waiting.length, 5, 'undo puts it back');
  q = (await josh.post(`/api/admin/checkins/${d.id}/dismiss`)).body;
  assert.strictEqual(q.dismissed.length, 1);
  await josh.post('/api/admin/daily');
  assert.strictEqual((await josh.get('/api/admin/checkins')).body.waiting.length, 4, 'dismissed does not come back');
  assert.strictEqual((await josh.post('/api/admin/checkins/nope/send')).status, 404);
  const audit = (await josh.get('/api/admin/audit')).body.map(e => e.action);
  assert.ok(audit.includes('checkin.send') && audit.includes('checkin.dismiss') && audit.includes('checkin.undo'));
}, { today: () => '2026-10-12' }));

test('when the PIC deals with it, the waiting draft is withdrawn rather than sent', () => withDemo(async ({ api }) => {
  const josh = api('j.workman');
  await josh.post('/api/admin/daily');
  assert.ok((await josh.get('/api/admin/checkins')).body.waiting.some(d => d.pic.name === 'Ben Okafor'));
  assert.strictEqual((await api('b.okafor').post('/api/projects/2025-0334/plan/checkin', { helped: 'early', comment: 'Paperwork still with their contracts office.', keep: true })).status, 201);
  const out = (await josh.post('/api/admin/daily')).body;
  assert.strictEqual(out.withdrawn, 1);
  assert.ok(!(await josh.get('/api/admin/checkins')).body.waiting.some(d => d.pic.name === 'Ben Okafor'));
}, { today: () => '2026-10-12' }));

test('a PIC who just wrote something is left alone for now; a project with no goal is in the same note as the rest', () => withDemo(async ({ api }) => {
  const josh = api('j.workman');
  await api('d.whitfield').post('/api/projects/2025-0412/plan/entries', { kind: 'update', body: 'Met the owner\'s rep this morning.' });
  const out = (await josh.post('/api/admin/daily')).body;
  assert.strictEqual(out.created, 4);
  const waiting = (await josh.get('/api/admin/checkins')).body.waiting;
  assert.ok(!waiting.some(d => d.pic.name === 'Dana Whitfield'), 'Dana wrote today');
  const marcus = waiting.find(d => d.pic.name === 'Marcus Oyelaran');
  assert.ok(marcus.body.includes('Granite Ridge Elementary Addition') && marcus.body.includes('Tooele Transit Hub'));
  assert.strictEqual(marcus.subject, 'Project Turnaround Updates');
}, { today: () => '2026-10-12' }));

test('who sees each PIC\'s on-time and kept figures is an Admin switch; everyone always sees their own', () => withDemo(async ({ api }) => {
  const josh = api('j.workman');
  const rec = async who => (await api(who).get('/api/turnaround/current')).body.pics.filter(p => p.projects.length).map(p => [p.name, p.record !== null]);
  assert.ok((await rec('d.whitfield')).every(([, shown]) => shown), 'everyone, by default');
  await josh.put('/api/admin/settings', { changes: { 'visibility.picRecords': 'admin' } });
  assert.deepStrictEqual((await rec('d.whitfield')).filter(([, s]) => s).map(([n]) => n), ['Dana Whitfield'], 'a PIC sees only their own');
  assert.ok((await rec('m.hale')).every(([, shown]) => !shown), 'Finance sees none');
  assert.ok((await rec('j.workman')).every(([, shown]) => shown), 'the admin sees all');
  await josh.put('/api/admin/settings', { changes: { 'visibility.picRecords': 'principals' } });
  assert.ok((await rec('d.whitfield')).every(([, shown]) => shown), 'PICs are principals');
  assert.ok((await rec('m.hale')).every(([, shown]) => !shown));
}));

test('the record numbers come from the log: on time, kept, and a standing label', () => withDemo(async ({ api }) => {
  const o = (await api('j.workman').get('/api/turnaround/current')).body;
  const pic = n => o.pics.find(p => p.name === n);
  // Dana: Wasatch 3 of 3 on time, Ogden 2 of 2, Hangar 7's goal was late and its mid-month update never came (0 of 2), Riverton 3 of 3
  assert.deepStrictEqual([pic('Dana Whitfield').record.onTime, pic('Dana Whitfield').record.kept], [{ onTime: 8, total: 10 }, { kept: 2, resolved: 2 }]);
  assert.strictEqual(pic('Dana Whitfield').record.standing, 'needs_attention');
  assert.deepStrictEqual([pic('Elena Castellanos').record.onTime, pic('Elena Castellanos').record.standing], [{ onTime: 6, total: 6 }, 'good']);
  assert.deepStrictEqual(pic('Tom Lindqvist').record.onTime, { onTime: 2, total: 4 }, 'Sandy\'s goal came two days late and its mid-month update never came');
  const airfield = pic('Tom Lindqvist').projects.find(p => p.wbs1 === '2024-0207');
  assert.strictEqual(airfield.latest.text, 'Paused design on the second bay until the agreement is signed. Told the owner in writing.');
  assert.deepStrictEqual([airfield.goal.approach, airfield.goal.mid.status, airfield.earlierMissed], ['Bring in additional revenue', 'stuck', 0]);
}));

test('commitment patterns: the analysis on the demo year, and the Admin alone sees it', () => withDemo(async ({ api }) => {
  const r = await api('j.workman').get('/api/admin/patterns');
  assert.strictEqual(r.status, 200);
  const p = r.body;
  assert.deepStrictEqual([p.year, p.years, p.total], [2026, [2026], 20]);
  assert.deepStrictEqual([p.groups.money.made, p.groups.spend.made], [13, 7], 'bring in additional revenue 13, lower costs 7');
  assert.deepStrictEqual([p.groups.money.resolved, p.groups.money.kept, p.groups.money.improved, p.groups.money.notImproved, p.groups.money.improvedRate], [3, 3, 1, 1, 0.5], 'one yes, one no, one too early to tell');
  assert.deepStrictEqual([p.groups.spend.resolved, p.groups.spend.kept, p.groups.spend.improved], [3, 3, 3]);
  assert.deepStrictEqual(p.actions.map(a => a.lever), ['cost', 'revenue'], 'the two approaches; the older actions only when an older goal used one');
  assert.deepStrictEqual([p.responsiveness.listed, p.responsiveness.withExplanation, p.responsiveness.withCommitment], [16, 14, 14]);
  assert.strictEqual(p.picNames.E101, 'Dana Whitfield');
  assert.strictEqual((await api('j.workman').get('/api/admin/patterns?year=2025')).body.total, 0, 'another year, nothing yet');
  for (const who of ['d.whitfield', 'm.hale', 'c.brandt', 'kent']) assert.strictEqual((await api(who).get('/api/admin/patterns')).status, 403, who);
}));

test('settings that must agree with each other are checked together', () => withDemo(async ({ api }) => {
  const josh = api('j.workman');
  assert.strictEqual((await josh.put('/api/admin/settings', { changes: { 'ladder.reminder2Days': 2 } })).status, 400, 'reminder 2 cannot come before reminder 1');
  assert.strictEqual((await josh.put('/api/admin/settings', { changes: { 'standing.escalatedKept': 95 } })).status, 400);
  assert.strictEqual((await josh.put('/api/admin/settings', { changes: { 'ladder.reminder1Days': 2, 'ladder.reminder2Days': 8, 'ladder.escalateDays': 30 } })).status, 200);
}));

test('the run\'s charts are locked with the run', () => withDemo(async ({ db }) => {
  const id = db.get("SELECT id FROM runs WHERE status = 'published' ORDER BY period DESC").id;
  assert.throws(() => db.run('UPDATE run_history SET negative_ytd = 0 WHERE run_id = ?', id), /locked/);
  assert.throws(() => db.run('DELETE FROM run_history WHERE run_id = ?', id), /locked/);
  assert.throws(() => db.run('INSERT INTO run_project_history (run_id, wbs1, period, profit_ytd) VALUES (?, \'x\', 202609, 0)', id), /locked/);
  assert.throws(() => db.run('DELETE FROM run_project_history WHERE run_id = ?', id), /locked/);
}));

test('npm run seed works again after runs are published and plans written (the guard triggers do not block a reset)', () => withDemo(async ({ db }) => {
  assert.doesNotThrow(() => seed(db, { demo: true }));
  assert.strictEqual(db.get('SELECT COUNT(*) n FROM runs').n, 6, 'two Turnaround runs, two Marketing Reports and two Accountability reports');
  assert.strictEqual(db.get('SELECT COUNT(*) n FROM plan_entries').n, 54);
  assert.throws(() => db.run('DELETE FROM plan_entries'), /append-only/, 'the guards are back after the reset');
}));

test('"Just mine" has its own chart history: each PIC\'s months add up to the firm\'s, and end at their own card', () => withDemo(async ({ api, db }) => {
  const o = (await api('d.whitfield').get('/api/turnaround/current')).body;
  const dana = o.pics.find(p => p.name === 'Dana Whitfield');
  assert.strictEqual(dana.history.length, 12);
  const last = dana.history[11];
  assert.deepStrictEqual([last.period, last.negativeYtd, last.belowCount], [202609, dana.totals.profit, 4], 'the last month is exactly her card');
  assert.deepStrictEqual(dana.history.filter(h => h.lastYear).map(h => h.period), [202510, 202511, 202512]);
  assert.notDeepStrictEqual(dana.history.map(h => h.negativeYtd), o.history.map(h => h.negativeYtd), 'not the firm\'s line');
  o.history.forEach((firm, i) => {
    const h = p => p.history[i] || { negativeYtd: 0, belowCount: 0 }; // a PIC with nothing below break-even has no history
    assert.strictEqual(o.pics.reduce((s, p) => s + h(p).negativeYtd, 0), firm.negativeYtd, `month ${firm.period}: the PICs add up to the firm`);
    assert.strictEqual(o.pics.reduce((s, p) => s + h(p).belowCount, 0), firm.belowCount);
  });
  const id = db.get("SELECT id FROM runs WHERE status = 'published' ORDER BY period DESC").id;
  assert.throws(() => db.run('UPDATE run_pic_history SET negative_ytd = 0 WHERE run_id = ?', id), /locked/);
  assert.throws(() => db.run('DELETE FROM run_pic_history WHERE run_id = ?', id), /locked/);
}));

test('PICs are listed from the biggest total loss to the smallest', () => withDemo(async ({ api }) => {
  const o = (await api('j.workman').get('/api/turnaround/current')).body;
  const totals = o.pics.map(p => p.totals.profit);
  assert.deepStrictEqual(totals, totals.slice().sort((a, b) => a - b), 'most negative first');
  assert.deepStrictEqual(o.pics.map(p => p.name), ['Tom Lindqvist', 'Marcus Oyelaran', 'Dana Whitfield', 'Priya Raman', 'Elena Castellanos', 'Ben Okafor', 'Riley Chen']);
  // everyone gets the same order, and projects inside a PIC still go worst first
  assert.deepStrictEqual((await api('d.whitfield').get('/api/turnaround/current')).body.pics.map(p => p.name), o.pics.map(p => p.name));
  for (const p of o.pics) assert.deepStrictEqual(p.projects.map(x => x.profit.ytd), p.projects.map(x => x.profit.ytd).slice().sort((a, b) => a - b));
}));

test('a PIC with nothing below break-even is on the page, with no projects and no record', () => withDemo(async ({ api }) => {
  for (const who of ['j.workman', 'r.chen', 'd.whitfield']) {
    const o = (await api(who).get('/api/turnaround/current')).body;
    const riley = o.pics.find(p => p.name === 'Riley Chen');
    assert.ok(riley, who + ' can see her');
    assert.deepStrictEqual([riley.projects.length, riley.totals.profit, riley.record], [0, 0, null]);
    assert.strictEqual(riley.history[11].negativeYtd, 0, 'nothing below the line this month');
    assert.strictEqual(o.pics[o.pics.length - 1].name, 'Riley Chen', 'last, after everyone with a loss');
  }
  assert.strictEqual((await api('r.chen').get('/api/turnaround/current')).body.viewer.picCode, 'E108', 'so her page can say she is the one with nothing to fix');
  assert.strictEqual((await api('r.chen').get('/api/home')).body.yours.projects.length, 0);
}));
