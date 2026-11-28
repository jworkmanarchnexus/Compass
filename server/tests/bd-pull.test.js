'use strict';
/* The Marketing Report's Vantagepoint pull by hand (Admin > Report runs, live mode only). The pull itself is a stand-in here; the real
   one is server/jobs/vp-pull-bd.js. Made-up data. */
const test = require('node:test');
const assert = require('node:assert');
const { start } = require('./helpers');

function fakePull({ fail, slow } = {}) {
  const calls = [];
  const snaps = {};
  return {
    calls,
    vpPull: {
      async pull(period) {
        calls.push(period);
        if (slow) await new Promise(r => setTimeout(r, 150));
        if (fail) throw new Error('Login failed for user (state 28000)');
        snaps[period] = { period, pulledAt: '2026-12-04T15:00:00.000Z', file: `bd-${period}-x.json`, projects: 3, revenueProjects: 2, forecastEntries: 5, pursuits: 4 };
        return snaps[period];
      },
      latest: period => snaps[period] || null,
    },
  };
}

test('the Admin pulls a month by hand; it is audited, and the page can ask when the last pull was', async () => {
  const f = fakePull();
  const t = await start({ vpPull: f.vpPull, today: () => '2026-12-04' });
  try {
    const josh = t.api('j.workman');
    assert.deepStrictEqual((await josh.get('/api/admin/bd/pull?period=202611')).body, { available: true, busy: false, latest: null });
    const r = await josh.post('/api/admin/bd/pull', { period: 202611 });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(f.calls, [202611]);
    assert.strictEqual((await josh.get('/api/admin/bd/pull?period=202611')).body.latest.pulledAt, '2026-12-04T15:00:00.000Z');
    const a = t.db.get("SELECT object, detail_json FROM audit_log WHERE action = 'bd.pull'");
    assert.strictEqual(a.object, 'Marketing Report November 2026');
    assert.strictEqual(JSON.parse(a.detail_json).pursuits, 4);
    assert.strictEqual((await josh.post('/api/admin/bd/pull', { period: 202612 })).status, 400, 'a month that has not ended cannot be pulled');
    assert.strictEqual((await josh.post('/api/admin/bd/pull', { period: 'November' })).status, 400);
  } finally { await t.close(); }
});

test('only the Admin pulls; one pull at a time; a failed pull says so plainly', async () => {
  const f = fakePull({ slow: true });
  const t = await start({ vpPull: f.vpPull, today: () => '2026-12-04' });
  try {
    assert.strictEqual((await t.api('kent').post('/api/admin/bd/pull', { period: 202611 })).status, 403, 'the System admin cannot pull');
    assert.strictEqual((await t.api('d.whitfield').get('/api/admin/bd/pull?period=202611')).status, 403);
    const josh = t.api('j.workman');
    const [a, b] = await Promise.all([josh.post('/api/admin/bd/pull', { period: 202611 }), new Promise(r => setTimeout(r, 30)).then(() => josh.post('/api/admin/bd/pull', { period: 202611 }))]);
    assert.deepStrictEqual([a.status, b.status], [200, 409], 'the second click waits for the first');
  } finally { await t.close(); }
  const g = fakePull({ fail: true });
  const t2 = await start({ vpPull: g.vpPull, today: () => '2026-12-04' });
  try {
    const r = await t2.api('j.workman').post('/api/admin/bd/pull', { period: 202611 });
    assert.strictEqual(r.status, 502);
    assert.match(r.body.error, /did not finish/);
    assert.strictEqual((await t2.api('j.workman').get('/api/admin/bd/pull?period=202611')).body.busy, false, 'a failed pull does not leave the button stuck');
  } finally { await t2.close(); }
});

test('the demo has no Vantagepoint pull', async () => {
  const t = await start({ today: () => '2026-12-04' });
  try {
    assert.deepStrictEqual((await t.api('j.workman').get('/api/admin/bd/pull?period=202611')).body, { available: false });
    assert.strictEqual((await t.api('j.workman').post('/api/admin/bd/pull', { period: 202611 })).status, 404);
  } finally { await t.close(); }
});
