'use strict';
/* The names shown for Vantagepoint people (Admin > People): set by the Admin, shown everywhere, audited, never written to the
   Vantagepoint copy. Made-up people from the demo seed. */
const test = require('node:test');
const assert = require('node:assert');
const { start } = require('./helpers');

test('the Admin sets the name shown for a PIC; the Marketing Report uses it; clearing it goes back to Vantagepoint', async () => {
  const t = await start({ demo: true, today: () => '2026-10-07' });
  try {
    const josh = t.api('j.workman');
    const list = (await josh.get('/api/admin/names')).body;
    assert.deepStrictEqual(list.find(r => r.code === 'E101'), { code: 'E101', vpName: 'Dana Whitfield', displayName: null });

    const set = await josh.put('/api/admin/names/E101', { name: '  Dana   Whitfield-Reyes ' });
    assert.strictEqual(set.status, 200);
    assert.strictEqual(set.body.changed, true);
    assert.strictEqual(set.body.rows.find(r => r.code === 'E101').displayName, 'Dana Whitfield-Reyes', 'spaces tidied');
    assert.deepStrictEqual(t.db.get("SELECT first_name, last_name FROM employees WHERE code = 'E101'"), Object.assign(Object.create(null), { first_name: 'Dana', last_name: 'Whitfield' }), 'the Vantagepoint copy is not changed');

    const reports = (await josh.get('/api/bd/reports')).body;
    const r = (await josh.get(`/api/bd/reports/${reports[0].id}`)).body;
    assert.ok(r.pic.some(p => p.key === 'E101' && p.label === 'Dana Whitfield-Reyes'), 'a published report shows the new name');

    const audit = t.db.get("SELECT object, detail_json FROM audit_log WHERE action = 'name.set' ORDER BY at DESC LIMIT 1");
    assert.deepStrictEqual([audit.object, JSON.parse(audit.detail_json)], ['Dana Whitfield', { from: 'Dana Whitfield', to: 'Dana Whitfield-Reyes' }]);

    assert.strictEqual((await josh.put('/api/admin/names/E101', { name: 'Dana Whitfield-Reyes' })).body.changed, false, 'the same name again changes nothing');
    const back = (await josh.put('/api/admin/names/E101', { name: '' })).body;
    assert.strictEqual(back.rows.find(x => x.code === 'E101').displayName, null);
    assert.strictEqual(t.db.get("SELECT COUNT(*) AS n FROM employee_names").n, 0);
    // typing the Vantagepoint name itself is the same as no override
    assert.strictEqual((await josh.put('/api/admin/names/E101', { name: 'Dana Whitfield' })).body.changed, false);
  } finally { await t.close(); }
});

test('only the Admin changes names; the System admin can look; bad input is refused', async () => {
  const t = await start({});
  try {
    assert.strictEqual((await t.api('kent').get('/api/admin/names')).status, 200, 'System admin reads');
    assert.strictEqual((await t.api('kent').put('/api/admin/names/E101', { name: 'X' })).status, 403);
    assert.strictEqual((await t.api('d.whitfield').put('/api/admin/names/E101', { name: 'X' })).status, 403, 'a PIC cannot rename');
    assert.strictEqual((await t.api('d.whitfield').get('/api/admin/names')).status, 403);
    const josh = t.api('j.workman');
    assert.strictEqual((await josh.put('/api/admin/names/NOPE', { name: 'X' })).status, 404);
    assert.strictEqual((await josh.put('/api/admin/names/E101', { name: 'x'.repeat(61) })).status, 400);
    assert.strictEqual((await josh.put('/api/admin/names/E101', { name: 42 })).status, 400);
  } finally { await t.close(); }
});
