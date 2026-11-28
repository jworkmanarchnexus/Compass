'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { start } = require('./helpers');

async function withApp(fn, opts) { const t = await start(opts); try { await fn(t); } finally { await t.close(); } }

test('who may open Staffing projections: the Admin, Principals, and the neighborhood leaders picked in Admin', () => withApp(async ({ api, user }) => {
  assert.strictEqual((await api('j.workman').get('/api/staffing')).status, 200, 'Admin');
  assert.strictEqual((await api('d.whitfield').get('/api/staffing')).status, 200, 'a Principal');
  for (const who of ['a.ruiz', 'm.hale', 'c.brandt', 'karen.acct', 'kent']) assert.strictEqual((await api(who).get('/api/staffing')).status, 403, who);
  assert.strictEqual((await api('a.ruiz').get('/api/me')).body.areas.staffing, false);

  // a PM who leads a neighborhood
  const saved = await api('j.workman').put('/api/admin/settings', { changes: { 'staffing.leaders': [user('a.ruiz').id] } });
  assert.strictEqual(saved.status, 200);
  assert.strictEqual((await api('a.ruiz').get('/api/staffing')).status, 200);
  assert.strictEqual((await api('a.ruiz').get('/api/me')).body.areas.staffing, true);
  assert.strictEqual((await api('j.nakamura').get('/api/staffing')).status, 403, 'another PM who was not picked');

  // only real, active people; only the Admin may pick them
  assert.strictEqual((await api('j.workman').put('/api/admin/settings', { changes: { 'staffing.leaders': ['nobody'] } })).status, 400);
  assert.strictEqual((await api('j.workman').put('/api/admin/settings', { changes: { 'staffing.leaders': [user('j.ames').id] } })).status, 400, 'Jordan Ames is inactive');
  assert.strictEqual((await api('d.whitfield').put('/api/admin/settings', { changes: { 'staffing.leaders': [] } })).status, 403);
  assert.strictEqual((await api('kent').get('/api/admin/staffing')).status, 200, 'the System admin may read the Admin tab');
  assert.strictEqual((await api('d.whitfield').get('/api/admin/staffing')).status, 403);
}));

test('the page: the months after today, people needed against people on staff, from the made-up files', () => withApp(async ({ api }) => {
  const { body } = await api('d.whitfield').get('/api/staffing');
  assert.strictEqual(body.available, true);
  assert.deepStrictEqual([body.months[0], body.months.at(-1), body.months.length], [202612, 202711, 12], 'today is pinned to Nov 27, 2026');
  assert.deepStrictEqual(body.levels.map(l => l.id), ['principal', 'pm', 'pa', 'jc', 'design', 'interiors', 'graphics']);
  assert.strictEqual(body.capacity.total, 62, 'made-up people on staff in tracked categories');
  assert.strictEqual(body.capacity.untracked, 13);
  assert.deepStrictEqual(body.warnings, [{ kind: 'unassigned', category: '38', count: 1, title: 'BIM Manager' }], 'a category in no level is flagged, not dropped silently');
  assert.ok(body.blended > 0);
  const first = body.rows[0], last = body.rows.at(-1);
  assert.ok(first.sum.contracted > last.sum.contracted, 'the contracted forecast thins out further ahead');
  assert.ok(last.sum.pipeline > first.sum.pipeline, 'pursuits fill in later');
  for (const r of body.rows) assert.ok(Math.abs(r.sum.total - (r.sum.contracted + r.sum.pipeline)) < 0.02);
  assert.deepStrictEqual(body.customUsed, [], 'nobody has a custom mix in the demo');
  assert.strictEqual(body.firmMonths, 6);
}, { today: () => '2026-11-27' }));

test('a project with its own mix: no screen, append-only, and it changes only that project', () => withApp(async ({ api, db }) => {
  const before = (await api('j.workman').get('/api/staffing')).body;
  const at = '2026-11-01';
  db.run("INSERT INTO staffing_custom_mix (wbs1, effective_from, mix_json, note, set_by, set_at) VALUES ('2025-1001', ?, ?, 'made-up test', 'test', 0)", at, JSON.stringify({ principal: 5, pm: 15, pa: 20, jc: 30, design: 30 }));
  const after = (await api('j.workman').get('/api/staffing')).body;
  assert.deepStrictEqual(after.customUsed, [{ id: '2025-1001', name: 'Murray Clinic' }]);
  assert.notDeepStrictEqual(after.rows[0].contracted, before.rows[0].contracted);
  assert.deepStrictEqual(after.rows[0].pipeline, before.rows[0].pipeline, 'pursuits are untouched');
  assert.throws(() => db.run("UPDATE staffing_custom_mix SET mix_json = 'null'"), /append-only/);
  assert.throws(() => db.run('DELETE FROM staffing_custom_mix'), /append-only/);

  // back to the standard mix is a new row, not a change
  db.run("INSERT INTO staffing_custom_mix (wbs1, effective_from, mix_json, set_by, set_at) VALUES ('2025-1001', '2026-11-20', 'null', 'test', 0)");
  assert.deepStrictEqual((await api('j.workman').get('/api/staffing')).body.customUsed, []);

  // a mix that no longer fits the levels is ignored and reported
  db.run("INSERT INTO staffing_custom_mix (wbs1, effective_from, mix_json, set_by, set_at) VALUES ('2025-1002', ?, ?, 'test', 0)", at, JSON.stringify({ retired: 100 }));
  const w = (await api('j.workman').get('/api/staffing')).body.warnings.find(x => x.kind === 'brokenMix');
  assert.deepStrictEqual(w, { kind: 'brokenMix', id: '2025-1002', name: 'Park City Medical Office' });
}, { today: () => '2026-11-27' }));

test('Admin settings: the mix must add to 100 and a category sits in one place', () => withApp(async ({ api }) => {
  const levels = (await api('j.workman').get('/api/admin/settings')).body['staffing.levels'].value;
  const bad = levels.map((l, i) => i === 0 ? Object.assign({}, l, { mix: l.mix + 5 }) : l);
  const r = await api('j.workman').put('/api/admin/settings', { changes: { 'staffing.levels': bad } });
  assert.strictEqual(r.status, 400);
  assert.match(r.body.error, /add up to 100%/);
  const twice = await api('j.workman').put('/api/admin/settings', { changes: { 'staffing.untracked': ['11', '37', '45', '47', '36', '16'] } });
  assert.strictEqual(twice.status, 400);
  assert.match(twice.body.error, /Category 16/);
  const ok = await api('j.workman').put('/api/admin/settings', { changes: { 'staffing.rateOverrides': { 16: 15000 } } });
  assert.strictEqual(ok.status, 200);
  const inputs = (await api('j.workman').get('/api/admin/staffing')).body;
  assert.strictEqual(inputs.categories.find(c => c.code === '16').place, 'jc');
  assert.strictEqual(inputs.categories.find(c => c.code === '38').place, null);
  assert.ok(inputs.categories.find(c => c.code === '16').vpRate > 0, 'the Vantagepoint rate is shown as it is, before the override');
}));
