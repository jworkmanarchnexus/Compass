'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { start } = require('./helpers');

/* each test gets its own fresh in-memory database and server */
async function withApp(fn) { const t = await start(); try { await fn(t); } finally { await t.close(); } }

test('static files: the shell and design system are served, nothing else is', () => withApp(async ({ base }) => {
  for (const ok of ['/', '/shared/design-system/toolbox.css', '/shell/main.js']) assert.strictEqual((await fetch(base + ok)).status, 200, ok);
  for (const no of ['/package.json', '/reference/handoff/CLAUDE.md', '/server/db/schema.sql', '/server/app.js', '/shell/../package.json']) assert.strictEqual((await fetch(base + no)).status, 404, no);
}));

test('seed: made-up people and a Vantagepoint-shaped project copy', () => withApp(async ({ db }) => {
  assert.strictEqual(db.get('SELECT COUNT(*) n FROM users').n, 11);
  assert.strictEqual(db.get("SELECT COUNT(*) n FROM projects WHERE status = 'A'").n, 18);
  assert.strictEqual(db.get("SELECT COUNT(*) n FROM projects WHERE status = 'A' AND principal = ''").n, 2, 'two active projects with no PIC, as in the mockup');
}));

test('sign-in: the picker lists active people only; every other call needs a sign-in', () => withApp(async ({ api }) => {
  const list = await api().get('/api/dev/users');
  assert.strictEqual(list.status, 200);
  assert.ok(list.body.some(u => u.name === 'Josh Workman' && u.role === 'admin'));
  assert.ok(!list.body.some(u => u.name === 'Jordan Ames'), 'inactive people cannot sign in');
  assert.strictEqual((await api().get('/api/me')).status, 401);
  assert.strictEqual((await api().get('/api/admin/people')).status, 401);
}));

test('me: carries the role and what that role may see', () => withApp(async ({ api }) => {
  const josh = (await api('j.workman').get('/api/me')).body;
  assert.strictEqual(josh.role, 'admin');
  assert.deepStrictEqual(josh.areas, { turnaround: true, checkins: true, bd: true, pipeline: true, admin: true });
  const casey = (await api('c.brandt').get('/api/me')).body;
  assert.deepStrictEqual(casey.areas, { turnaround: false, checkins: false, bd: true, pipeline: true, admin: false }, 'marketing sees BD and Pipeline only by default');
  const dana = (await api('d.whitfield').get('/api/me')).body;
  assert.strictEqual(dana.areas.checkins, false);
  assert.strictEqual(dana.adminTabs.people, null);
}));

test('the server refuses Admin calls from roles that may not make them', () => withApp(async ({ api }) => {
  for (const who of ['d.whitfield', 'm.hale', 'c.brandt']) {
    for (const path of ['/api/admin/settings', '/api/admin/people', '/api/admin/audit', '/api/admin/runs']) {
      assert.strictEqual((await api(who).get(path)).status, 403, `${who} ${path}`);
    }
    assert.strictEqual((await api(who).put('/api/admin/settings', { changes: { 'due.newProjectDays': 7 } })).status, 403, who);
  }
}));

test('system admin can read Admin but never change it', () => withApp(async ({ api, user }) => {
  const kent = api('kent');
  for (const path of ['/api/admin/settings', '/api/admin/people', '/api/admin/audit', '/api/admin/runs']) assert.strictEqual((await kent.get(path)).status, 200, path);
  assert.strictEqual((await kent.put('/api/admin/settings', { changes: { 'due.newProjectDays': 7 } })).status, 403);
  assert.strictEqual((await kent.put(`/api/admin/people/${user('d.whitfield').id}`, { role: 'admin' })).status, 403);
}));

test('settings: saving adds a dated row, is audited, and an unchanged value does nothing', () => withApp(async ({ api, db }) => {
  const josh = api('j.workman');
  const before = (await josh.get('/api/admin/settings')).body;
  assert.strictEqual(before['due.newProjectDays'].value, 14);
  assert.strictEqual(before['due.newProjectDays'].effectiveFrom, null, 'still the default');

  assert.deepStrictEqual((await josh.put('/api/admin/settings', { changes: { 'due.newProjectDays': 10, 'due.afterEntryDays': 30 } })).body, { saved: 1 });
  const after = (await josh.get('/api/admin/settings')).body;
  assert.strictEqual(after['due.newProjectDays'].value, 10);
  assert.ok(after['due.newProjectDays'].effectiveFrom > 0);
  assert.strictEqual(db.get("SELECT COUNT(*) n FROM settings WHERE key = 'due.newProjectDays'").n, 1);

  // changing it again keeps the old row, so a run built earlier can still be reproduced
  await josh.put('/api/admin/settings', { changes: { 'due.newProjectDays': 21 } });
  assert.strictEqual(db.get("SELECT COUNT(*) n FROM settings WHERE key = 'due.newProjectDays'").n, 2);

  const log = (await josh.get('/api/admin/audit')).body;
  assert.strictEqual(log.filter(e => e.action === 'setting.change').length, 2);
  assert.deepStrictEqual(log[0].detail, { from: 10, to: 21 });
  assert.strictEqual(log[0].by, 'Josh Workman');
}));

test('settings: bad or unknown values are refused and nothing is written', () => withApp(async ({ api, db }) => {
  const josh = api('j.workman');
  assert.strictEqual((await josh.put('/api/admin/settings', { changes: { 'due.newProjectDays': -3 } })).status, 400);
  assert.strictEqual((await josh.put('/api/admin/settings', { changes: { 'nope': 1 } })).status, 400);
  assert.strictEqual((await josh.put('/api/admin/settings', { changes: { 'due.afterEntryDays': 20, 'due.newProjectDays': 'x' } })).status, 400);
  assert.strictEqual((await josh.put('/api/admin/settings', {})).status, 400);
  assert.strictEqual(db.get('SELECT COUNT(*) n FROM settings').n, 0);
}));

test('settings: widening the access setting changes what that role sees', () => withApp(async ({ api }) => {
  await api('j.workman').put('/api/admin/settings', { changes: { access: { marketingTurnaround: true, picBd: false, picPipeline: false } } });
  assert.strictEqual((await api('c.brandt').get('/api/me')).body.areas.turnaround, true);
}));

test('people: Admin changes a role and the name used in drafts; both are audited', () => withApp(async ({ api, user }) => {
  const josh = api('j.workman');
  const morgan = user('m.hale');
  const r = await josh.put(`/api/admin/people/${morgan.id}`, { role: 'marketing', draftName: ' Mo ' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.role, 'marketing');
  assert.strictEqual(r.body.draftName, 'Mo');
  assert.strictEqual((await api('m.hale').get('/api/me')).body.role, 'marketing', 'the change takes effect on the next call');
  const entry = (await josh.get('/api/admin/audit')).body[0];
  assert.strictEqual(entry.action, 'user.change');
  assert.strictEqual(entry.detail.from.role, 'finance');
  assert.strictEqual(entry.detail.to.role, 'marketing');
}));

test('people: the list shows how many active projects each PIC has', () => withApp(async ({ api }) => {
  const list = (await api('j.workman').get('/api/admin/people')).body;
  const by = n => list.find(p => p.name === n);
  assert.strictEqual(by('Dana Whitfield').activeProjects, 4);
  assert.strictEqual(by('Tom Lindqvist').activeProjects, 2);
  assert.strictEqual(by('Jordan Ames').activeProjects, 0, 'the inactive project does not count');
  assert.strictEqual(by('Josh Workman').activeProjects, null, 'not a PIC');
}));

test('people: the last active Admin cannot be demoted or deactivated; bad input is refused', () => withApp(async ({ api, user }) => {
  const josh = api('j.workman');
  const id = user('j.workman').id;
  assert.strictEqual((await josh.put(`/api/admin/people/${id}`, { role: 'pic' })).status, 409);
  assert.strictEqual((await josh.put(`/api/admin/people/${id}`, { active: false })).status, 409);
  assert.strictEqual((await josh.put(`/api/admin/people/${id}`, { role: 'boss' })).status, 400);
  assert.strictEqual((await josh.put('/api/admin/people/nobody', { active: false })).status, 404);
  assert.strictEqual((await josh.put(`/api/admin/people/${user('d.whitfield').id}`, { draftName: 'x'.repeat(41) })).status, 400);
  assert.strictEqual((await api('j.workman').get('/api/me')).status, 200);
}));

test('people: a deactivated person can no longer use the app but keeps their history', () => withApp(async ({ api, user, db }) => {
  await api('j.workman').put(`/api/admin/people/${user('b.okafor').id}`, { active: false });
  assert.strictEqual((await api('b.okafor').get('/api/me')).status, 401);
  assert.strictEqual(db.get('SELECT COUNT(*) n FROM users WHERE username = ?', 'b.okafor').n, 1);
}));

test('the audit log is append-only: the database itself refuses changes and deletes', () => withApp(async ({ api, db }) => {
  await api('j.workman').put('/api/admin/settings', { changes: { 'due.newProjectDays': 9 } });
  assert.strictEqual(db.get('SELECT COUNT(*) n FROM audit_log').n, 1);
  assert.throws(() => db.run("UPDATE audit_log SET action = 'x'"), /append-only/);
  assert.throws(() => db.run('DELETE FROM audit_log'), /append-only/);
  assert.strictEqual(db.get('SELECT COUNT(*) n FROM audit_log').n, 1);
}));
