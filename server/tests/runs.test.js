'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { start } = require('./helpers');

async function withApp(fn, opts) { const t = await start(opts); try { await fn(t); } finally { await t.close(); } }

/* a stable fingerprint of everything a run holds, to prove it did not change */
const fingerprint = (db, id) => JSON.stringify([
  db.all('SELECT * FROM runs WHERE id = ?', id),
  db.all('SELECT * FROM run_projects WHERE run_id = ? ORDER BY wbs1', id),
  db.all('SELECT * FROM run_warnings WHERE run_id = ? ORDER BY id', id),
]);

test('building the September run reproduces the mockup: 16 projects, -$450,040 YTD', () => withApp(async ({ api }) => {
  const r = await api('j.workman').post('/api/admin/runs', {});
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.run.period, 202609);
  assert.strictEqual(r.body.run.label, 'September 2026');
  assert.strictEqual(r.body.run.status, 'draft');
  assert.strictEqual(r.body.run.version, 1);
  assert.strictEqual(r.body.summary.projectCount, 16);
  assert.strictEqual(r.body.summary.negativeYtd, -45004000, 'exactly -$450,040.00');
  const tom = r.body.projects.find(p => p.wbs1 === '2024-0207');
  assert.strictEqual(tom.profit.ytd, -9680000);
  assert.strictEqual(tom.pic.name, 'Tom Lindqvist');
  assert.strictEqual(tom.pm.name, 'Ana Ruiz');
  // the mockup's July-onward rows are in the same run: a profitable project and the no-PIC project are NOT
  assert.ok(!r.body.projects.some(p => ['2025-0390', '2025-0510'].includes(p.wbs1)));
}));

test('warnings: two projects cannot be evaluated, two have no PIC, and they are reported once each way', () => withApp(async ({ api }) => {
  const r = (await api('j.workman').post('/api/admin/runs', {})).body;
  const by = k => r.warnings.filter(w => w.kind === k).map(w => w.wbs1).sort();
  assert.deepStrictEqual(by('cant_evaluate'), ['2025-0455', '2025-0522']);
  assert.deepStrictEqual(by('no_pic'), ['2025-0510', '2025-0522']);
  assert.strictEqual(r.warnings.find(w => w.wbs1 === '2025-0455').detail, 'Mixed overhead rates');
  assert.strictEqual(r.warnings.find(w => w.wbs1 === '2025-0522' && w.kind === 'cant_evaluate').detail, 'No overhead plan');
}));

test('the run records the settings it was built with, and uses the ones in force now', () => withApp(async ({ api }) => {
  const josh = api('j.workman');
  await josh.put('/api/admin/settings', { changes: { 'include.ignoreBilledUnder': 200000 } }); // ignore projects billed under $200,000
  const r = (await josh.post('/api/admin/runs', {})).body;
  assert.ok(r.summary.projectCount < 16, 'small projects are now left out');
  assert.strictEqual(r.settings['include.ignoreBilledUnder'], 200000);
  assert.ok(!r.projects.some(p => p.billed.ytd < 20000000));
}));

test('first appearance is remembered, so the plan clock starts from the first run a project was in', () => withApp(async ({ api, db }) => {
  const josh = api('j.workman');
  await josh.post('/api/admin/runs', { period: 202608 });
  const sep = (await josh.post('/api/admin/runs', {})).body;
  const aug = db.all("SELECT wbs1, first_seen_period FROM run_projects rp JOIN runs r ON r.id = rp.run_id WHERE r.period = 202608");
  assert.ok(aug.length > 0 && aug.every(x => x.first_seen_period === 202608));
  const tom = sep.projects.find(p => p.wbs1 === '2024-0207');
  assert.strictEqual(tom.firstSeenPeriod, 202608, 'in August already');
}));

test('a month that has not closed, or is not a month, cannot be built; a repeat is refused', () => withApp(async ({ api }) => {
  const josh = api('j.workman');
  assert.strictEqual((await josh.post('/api/admin/runs', { period: 202610 })).status, 400, 'October is still open on Oct 11');
  assert.strictEqual((await josh.post('/api/admin/runs', { period: 202613 })).status, 400);
  assert.strictEqual((await josh.post('/api/admin/runs', { period: 'x' })).status, 400);
  assert.strictEqual((await josh.post('/api/admin/runs', {})).status, 201);
  assert.strictEqual((await josh.post('/api/admin/runs', {})).status, 409, 'one live run per month');
}));

test('the one automatic email goes to the admin and holds a count and a link, no PIC or project names', () => withApp(async ({ api, db }, ) => {
  const mailer = { sent: [], sendToAdmin(m) { this.sent.push(m); } };
  const t = await start({ mailer });
  try {
    await t.api('j.workman').post('/api/admin/runs', {});
    assert.strictEqual(mailer.sent.length, 1);
    const m = mailer.sent[0];
    assert.deepStrictEqual(m.to, ['josh.workman@example.test']);
    assert.match(m.body, /16 projects below break-even/);
    assert.match(m.body, /http:\/\/localhost:5281\/#\/admin\/runs\//);
    const names = t.db.all('SELECT name FROM projects').map(p => p.name).concat(t.db.all('SELECT first_name, last_name FROM employees').flatMap(e => [e.first_name, e.last_name]));
    for (const n of names) assert.ok(!(m.subject + m.body).includes(n), `must not mention ${n}`);
  } finally { await t.close(); }
}));

test('the email can be switched off in Admin', () => withApp(async () => {
  const mailer = { sent: [], sendToAdmin(m) { this.sent.push(m); } };
  const t = await start({ mailer });
  try {
    await t.api('j.workman').put('/api/admin/settings', { changes: { 'run.emailAdmin': false } });
    await t.api('j.workman').post('/api/admin/runs', {});
    assert.strictEqual(mailer.sent.length, 0);
  } finally { await t.close(); }
}));

test('publishing locks the run: the API refuses every change, and so does the database', () => withApp(async ({ api, db }) => {
  const josh = api('j.workman');
  const id = (await josh.post('/api/admin/runs', {})).body.run.id;
  assert.strictEqual((await josh.post(`/api/admin/runs/${id}/publish`)).status, 200);
  const before = fingerprint(db, id);

  assert.strictEqual((await josh.post(`/api/admin/runs/${id}/publish`)).status, 409, 'cannot publish twice');
  assert.strictEqual((await josh.post(`/api/admin/runs/${id}/rebuild`)).status, 409, 'cannot rebuild a published run');
  assert.strictEqual((await josh.post('/api/admin/runs', {})).status, 409, 'cannot build a second run for the same month');

  // the database refuses even if the code had a bug
  assert.throws(() => db.run('UPDATE run_projects SET profit_ytd = 0 WHERE run_id = ?', id), /locked/);
  assert.throws(() => db.run('DELETE FROM run_projects WHERE run_id = ?', id), /locked/);
  assert.throws(() => db.run("INSERT INTO run_projects (run_id, wbs1, name, billed_cur, billed_ytd, billed_jtd, profit_cur, profit_ytd, profit_jtd, first_seen_period) VALUES (?, 'x', 'x', 0, 0, 0, 0, 0, 0, 202609)", id), /locked/);
  assert.throws(() => db.run("INSERT INTO run_warnings (run_id, kind, wbs1) VALUES (?, 'no_pic', 'x')", id), /locked/);
  assert.throws(() => db.run('DELETE FROM run_warnings WHERE run_id = ?', id), /locked/);
  assert.throws(() => db.run("UPDATE runs SET version = 9 WHERE id = ?", id), /locked/);
  assert.throws(() => db.run("UPDATE runs SET settings_json = '{}' WHERE id = ?", id), /locked/);
  assert.throws(() => db.run("UPDATE runs SET status = 'draft' WHERE id = ?", id), /locked/);
  assert.throws(() => db.run("UPDATE runs SET status = 'archived' WHERE id = ?", id), /locked/, 'archiving needs a reason');
  assert.throws(() => db.run('DELETE FROM runs WHERE id = ?', id), /locked/);
  assert.strictEqual(fingerprint(db, id), before, 'nothing changed');
}));

test('a draft may be rebuilt; settings changed since then apply', () => withApp(async ({ api }) => {
  const josh = api('j.workman');
  const id = (await josh.post('/api/admin/runs', {})).body.run.id;
  await josh.put('/api/admin/settings', { changes: { 'include.ytdProfitBelow': -20000 } }); // only projects losing more than $20,000
  const r = await josh.post(`/api/admin/runs/${id}/rebuild`);
  assert.strictEqual(r.status, 200);
  assert.ok(r.body.summary.projectCount < 16);
  assert.strictEqual(r.body.run.version, 1, 'still the same draft');
}));

test('archive and rerun: needs a reason AND the word RERUN; the old run is kept, marked archived, and untouched', () => withApp(async ({ api, db }) => {
  const josh = api('j.workman');
  const id = (await josh.post('/api/admin/runs', {})).body.run.id;
  assert.strictEqual((await josh.post(`/api/admin/runs/${id}/archive`, { reason: 'x', confirm: 'RERUN' })).status, 409, 'a draft is rebuilt, not archived');
  await josh.post(`/api/admin/runs/${id}/publish`);
  const before = db.all('SELECT * FROM run_projects WHERE run_id = ? ORDER BY wbs1', id);

  assert.strictEqual((await josh.post(`/api/admin/runs/${id}/archive`, {})).status, 400);
  assert.strictEqual((await josh.post(`/api/admin/runs/${id}/archive`, { reason: '  ', confirm: 'RERUN' })).status, 400, 'blank reason');
  assert.strictEqual((await josh.post(`/api/admin/runs/${id}/archive`, { reason: 'Wrong cutoff' })).status, 400, 'no confirmation');
  assert.strictEqual((await josh.post(`/api/admin/runs/${id}/archive`, { reason: 'Wrong cutoff', confirm: 'rerun' })).status, 400, 'must be exactly RERUN');
  assert.strictEqual(db.get('SELECT status FROM runs WHERE id = ?', id).status, 'published', 'still published after the refusals');

  const r = await josh.post(`/api/admin/runs/${id}/archive`, { reason: 'Billing cutoff was wrong', confirm: 'RERUN' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.run.status, 'draft');
  assert.strictEqual(r.body.run.version, 2);
  assert.strictEqual(r.body.run.period, 202609);
  const old = db.get('SELECT * FROM runs WHERE id = ?', id);
  assert.strictEqual(old.status, 'archived');
  assert.strictEqual(old.archive_reason, 'Billing cutoff was wrong');
  assert.deepStrictEqual(db.all('SELECT * FROM run_projects WHERE run_id = ? ORDER BY wbs1', id), before, 'the archived run still holds exactly what it did');
  assert.throws(() => db.run("UPDATE runs SET archive_reason = 'changed' WHERE id = ?", id), /locked/, 'archived runs never change either');
  assert.strictEqual((await josh.post(`/api/admin/runs/${id}/publish`)).status, 409);
  assert.strictEqual((await josh.post(`/api/admin/runs/${id}/archive`, { reason: 'again', confirm: 'RERUN' })).status, 409);
}));

test('PICs and others see the last PUBLISHED run: never a draft, and an archived run is not shown', () => withApp(async ({ api }) => {
  const josh = api('j.workman'); const dana = api('d.whitfield');
  assert.deepStrictEqual((await dana.get('/api/turnaround/current')).body, { run: null, projects: [] }, 'nothing published yet');

  const aug = (await josh.post('/api/admin/runs', { period: 202608 })).body.run.id;
  await josh.post(`/api/admin/runs/${aug}/publish`);
  const sep = (await josh.post('/api/admin/runs', {})).body.run.id;
  let cur = (await dana.get('/api/turnaround/current')).body;
  assert.strictEqual(cur.run.period, 202608, 'the September draft is invisible');

  await josh.post(`/api/admin/runs/${sep}/publish`);
  cur = (await dana.get('/api/turnaround/current')).body;
  assert.strictEqual(cur.run.period, 202609);
  assert.strictEqual(cur.warnings, undefined, 'warnings are for the admin');
  assert.strictEqual(cur.settings, undefined);

  const v2 = (await josh.post(`/api/admin/runs/${sep}/archive`, { reason: 'Wrong cutoff', confirm: 'RERUN' })).body.run.id;
  cur = (await dana.get('/api/turnaround/current')).body;
  assert.strictEqual(cur.run.period, 202608, 'with September archived and its replacement still a draft, the last published run is August');
  await josh.post(`/api/admin/runs/${v2}/publish`);
  cur = (await dana.get('/api/turnaround/current')).body;
  assert.deepStrictEqual([cur.run.period, cur.run.version], [202609, 2]);
}));

test('who may do what with runs', () => withApp(async ({ api }) => {
  const josh = api('j.workman');
  const id = (await josh.post('/api/admin/runs', {})).body.run.id;
  await josh.post(`/api/admin/runs/${id}/publish`);

  for (const who of ['d.whitfield', 'm.hale', 'c.brandt']) {
    for (const [m, p, b] of [['post', '/api/admin/runs', {}], ['get', `/api/admin/runs/${id}`], ['post', `/api/admin/runs/${id}/publish`, {}], ['post', `/api/admin/runs/${id}/archive`, { reason: 'x', confirm: 'RERUN' }], ['get', '/api/admin/runs']]) {
      assert.strictEqual((await api(who)[m](p, b)).status, 403, `${who} ${m} ${p}`);
    }
  }
  // the system admin can see that runs exist, not what is in them, and cannot change them
  const kent = api('kent');
  const list = await kent.get('/api/admin/runs');
  assert.strictEqual(list.status, 200);
  assert.strictEqual(list.body[0].status, 'published');
  assert.strictEqual((await kent.get(`/api/admin/runs/${id}`)).status, 403);
  assert.strictEqual((await kent.post(`/api/admin/runs/${id}/archive`, { reason: 'x', confirm: 'RERUN' })).status, 403);

  // Marketing has no Turnaround access by default; Finance and PICs do
  assert.strictEqual((await api('c.brandt').get('/api/turnaround/current')).status, 403);
  assert.strictEqual((await api('m.hale').get('/api/turnaround/current')).status, 200);
  assert.strictEqual((await api('d.whitfield').get('/api/turnaround/current')).status, 200);
  assert.strictEqual((await api().get('/api/turnaround/current')).status, 401);
}));

test('every build, rebuild, publish and archive is in the audit log, with the reason', () => withApp(async ({ api }) => {
  const josh = api('j.workman');
  const id = (await josh.post('/api/admin/runs', {})).body.run.id;
  await josh.post(`/api/admin/runs/${id}/rebuild`);
  await josh.post(`/api/admin/runs/${id}/publish`);
  await josh.post(`/api/admin/runs/${id}/archive`, { reason: 'Wrong cutoff', confirm: 'RERUN' });
  const log = (await josh.get('/api/admin/audit')).body;
  assert.deepStrictEqual(log.filter(e => e.action.startsWith('run.')).map(e => e.action).reverse(), ['run.build', 'run.rebuild', 'run.publish', 'run.archive']);
  const arch = log.find(e => e.action === 'run.archive');
  assert.strictEqual(arch.detail.reason, 'Wrong cutoff');
  assert.strictEqual(arch.object, 'Project Turnaround September 2026 v1');
}));
