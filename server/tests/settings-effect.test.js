'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { start } = require('./helpers');
const settings = require('../../shared/rules/settings');

/* Every Admin setting must actually do something. Three are informational on purpose: the schedule itself lives on the
   server (Kent's scheduler), and only active projects are ever pulled. Anything else that nothing reads fails this test. */
const INFORMATIONAL = ['run.day', 'run.time', 'include.status'];

function sources(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['tests', 'node_modules', 'ui', 'db'].includes(e.name)) out.push(...sources(p)); }
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

test('no Admin setting is a dead switch', () => {
  const root = path.join(__dirname, '..', '..');
  const text = [...sources(path.join(root, 'server')), ...sources(path.join(root, 'modules'))].map(f => fs.readFileSync(f, 'utf8')).join('\n');
  const dead = Object.keys(settings.DEFAULTS).filter(k => !INFORMATIONAL.includes(k) && !text.includes(`'${k}'`) && !text.includes(`.${k}`));
  assert.deepStrictEqual(dead, [], 'settings that nothing reads');
});

test('switching off "Create check-in drafts" stops new drafts, and drafts that are no longer needed are still withdrawn', async () => {
  const t = await start({ demo: true, today: () => '2026-10-07' });
  try {
    const josh = t.api('j.workman');
    assert.strictEqual((await josh.get('/api/admin/checkins')).body.waiting.length, 2, 'the demo starts with two');
    await josh.put('/api/admin/settings', { changes: { 'run.createCheckinDrafts': false, 'due.newProjectDays': 1 } });
    const out = (await josh.post('/api/admin/daily')).body;
    assert.strictEqual(out.created, 0, 'Tooele and Draper are overdue for a plan, but drafting is off');
    const open = (await t.api('d.whitfield').get('/api/projects/2025-0173/plan')).body.commitments.find(c => c.status === 'open');
    await t.api('d.whitfield').post(`/api/projects/2025-0173/plan/commitments/${open.id}/done`, { body: 'Sent.', actual: 1 });
    assert.strictEqual((await josh.post('/api/admin/daily')).body.withdrawn, 1);
  } finally { await t.close(); }
});

test('there is no setting that makes the system email a PIC', async () => {
  assert.ok(!Object.keys(settings.DEFAULTS).some(k => /notif|pic.*mail|mail.*pic/i.test(k)));
  const t = await start();
  try { assert.strictEqual((await t.api('j.workman').put('/api/admin/settings', { changes: { 'run.notifyPics': true } })).status, 400); } finally { await t.close(); }
});
