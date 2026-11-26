'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { start } = require('./helpers');

async function withApp(fn) { const t = await start(); try { await fn(t); } finally { await t.close(); } }
const boards = async (api, who) => (await api(who).get('/api/me')).body.dashboards;

test('which dashboards a person has follows the projects they are PIC or PM on', () => withApp(async ({ api, db }) => {
  db.run("UPDATE projects SET proj_mgr = 'E104' WHERE wbs1 = '2024-0388'"); // made-up: Tom (a PIC) also manages the Ogden Library Annex
  assert.deepStrictEqual(await boards(api, 'd.whitfield'), ['pic'], 'PIC on projects, PM on none');
  assert.deepStrictEqual(await boards(api, 'a.ruiz'), ['pm'], 'PM on projects, PIC on none');
  assert.deepStrictEqual(await boards(api, 't.lindqvist'), ['pic', 'pm'], 'Tom is PIC on two and PM on the Ogden Library Annex');
  assert.deepStrictEqual(await boards(api, 'j.workman'), ['pic', 'pm'], 'the Admin always has both');
  for (const who of ['m.hale', 'c.brandt', 'kent', 'karen.acct']) assert.deepStrictEqual(await boards(api, who), [], who + ': no Vantagepoint employee code on any project');

  // it follows the projects: take Tom off the one project he manages and the PM dashboard goes away
  db.run("UPDATE projects SET proj_mgr = 'E205' WHERE wbs1 = '2024-0388'");
  assert.deepStrictEqual(await boards(api, 't.lindqvist'), ['pic']);
  assert.strictEqual((await api('t.lindqvist').get('/api/dashboards/pm')).status, 403);
}));

test('each dashboard is saved per person and per dashboard, and comes back normalized', () => withApp(async ({ api, db }) => {
  db.run("UPDATE projects SET proj_mgr = 'E104' WHERE wbs1 = '2024-0388'");
  const pic = await api('t.lindqvist').get('/api/dashboards/pic');
  const pm = await api('t.lindqvist').get('/api/dashboards/pm');
  assert.strictEqual(pic.status, 200); assert.strictEqual(pm.status, 200);
  assert.strictEqual(pic.body.label, 'PIC dashboard'); assert.strictEqual(pm.body.label, 'PM dashboard');
  assert.notDeepStrictEqual(pic.body.catalog.map(c => c.id), pm.body.catalog.map(c => c.id), 'each has its own dashparts');

  const saved = await api('t.lindqvist').put('/api/dashboards/pic', { layout: { version: 1, items: [{ id: 'bubble', w: 99, h: 3, on: true }, { id: 'not-a-dashpart', w: 1, h: 1, on: true }] } });
  assert.strictEqual(saved.status, 200);
  assert.deepStrictEqual(saved.body.layout.items[0], { id: 'bubble', w: 4, h: 3, on: true });
  assert.ok(saved.body.layout.items.slice(1).every(i => !i.on), 'everything not named is in Available');
  assert.strictEqual((await api('t.lindqvist').get('/api/dashboards/pm')).body.saved, false, 'saving the PIC dashboard leaves the PM one alone');
  assert.strictEqual((await api('d.whitfield').get('/api/dashboards/pic')).body.saved, false, 'another PIC still has the default');

  const pmSave = await api('t.lindqvist').put('/api/dashboards/pm', { layout: { items: [{ id: 'turnaround', w: 2, h: 1, on: true }, { id: 'unbilled', w: 1, h: 1, on: true }] } });
  assert.ok(!pmSave.body.layout.items.some(i => i.id === 'turnaround'), 'a dashpart from the other dashboard cannot be saved here');

  const reset = await api('t.lindqvist').put('/api/dashboards/pic', { reset: true });
  assert.strictEqual(reset.body.saved, false);
  assert.deepStrictEqual(reset.body.layout, pic.body.layout);
}));

test('a dashboard you do not have is refused; bad requests are refused', () => withApp(async ({ api }) => {
  assert.strictEqual((await api('d.whitfield').get('/api/dashboards/pm')).status, 403);
  assert.strictEqual((await api('d.whitfield').put('/api/dashboards/pm', { reset: true })).status, 403);
  assert.strictEqual((await api('a.ruiz').get('/api/dashboards/pic')).status, 403);
  assert.strictEqual((await api('m.hale').get('/api/dashboards/pic')).status, 403);
  assert.strictEqual((await api('d.whitfield').get('/api/dashboards/nope')).status, 404);
  assert.strictEqual((await api().get('/api/dashboards/pic')).status, 401);
  assert.strictEqual((await api('d.whitfield').put('/api/dashboards/pic', {})).status, 400);
  assert.strictEqual((await api('d.whitfield').put('/api/dashboards/pic', { layout: { items: 'x' } })).status, 400);
}));
