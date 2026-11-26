'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { start } = require('./helpers');

async function withApp(fn) { const t = await start(); try { await fn(t); } finally { await t.close(); } }

test('my dashboard: a new person gets the default; a save is theirs alone and comes back normalized', () => withApp(async ({ api }) => {
  const first = await api('d.whitfield').get('/api/dashboard');
  assert.strictEqual(first.status, 200);
  assert.strictEqual(first.body.saved, false);
  const items = first.body.layout.items;
  assert.ok(items.length === first.body.catalog.length, 'every dashpart is in the layout, on or in the tray');

  const mine = { version: 1, items: [{ id: 'bubble', w: 99, h: 3, on: true }, { id: 'not-a-dashpart', w: 1, h: 1, on: true }, { id: 'revenue', w: 1, h: 1, on: true }] };
  const saved = await api('d.whitfield').put('/api/dashboard', { layout: mine });
  assert.strictEqual(saved.status, 200);
  assert.deepStrictEqual(saved.body.layout.items.slice(0, 2), [{ id: 'bubble', w: 4, h: 3, on: true }, { id: 'revenue', w: 1, h: 1, on: true }]);
  assert.ok(saved.body.layout.items.slice(2).every(i => !i.on), 'everything not named is in the tray');
  assert.strictEqual((await api('d.whitfield').get('/api/dashboard')).body.saved, true);

  const other = await api('m.oyelaran').get('/api/dashboard');
  assert.strictEqual(other.body.saved, false, 'another PIC still has the default');

  const reset = await api('d.whitfield').put('/api/dashboard', { reset: true });
  assert.strictEqual(reset.body.saved, false);
  assert.deepStrictEqual(reset.body.layout, first.body.layout);
}));

test('my dashboard: PICs, project managers and the Admin have one; other roles do not; bad bodies are refused', () => withApp(async ({ api }) => {
  for (const who of ['j.workman', 'd.whitfield', 'a.ruiz']) assert.strictEqual((await api(who).get('/api/dashboard')).status, 200, who);
  for (const who of ['c.brandt', 'm.hale', 'kent', 'karen.acct']) {
    assert.strictEqual((await api(who).get('/api/dashboard')).status, 403, who);
    assert.strictEqual((await api(who).put('/api/dashboard', { reset: true })).status, 403, who);
  }
  assert.strictEqual((await api().get('/api/dashboard')).status, 401);
  assert.strictEqual((await api('d.whitfield').put('/api/dashboard', {})).status, 400);
  assert.strictEqual((await api('d.whitfield').put('/api/dashboard', { layout: { items: 'x' } })).status, 400);
}));
