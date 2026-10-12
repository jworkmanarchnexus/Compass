'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { start } = require('./helpers');
const pipe = require('../pipeline');
const settingsRules = require('../../shared/rules/settings');
const { createLocalSource } = require('../vp-local');

async function withApp(fn, opts) { const t = await start(Object.assign({ today: () => '2026-10-07', demo: true }, opts)); try { await fn(t); } finally { await t.close(); } }
const K = c => Math.round(c / 100000);

test('the Oct 5 snapshot reproduces the mockup: weekly totals, this week, vs 4 weeks, counts', () => withApp(async ({ api }) => {
  const v = (await api('j.workman').get('/api/pipeline')).body;
  assert.strictEqual(v.date, '2026-10-05');
  assert.strictEqual(v.dates.length, 8);
  assert.strictEqual(v.latest, true);
  assert.deepStrictEqual(v.weeks, ['2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05']);
  const by = Object.fromEntries(v.rows.map(r => [r.label, r]));
  assert.deepStrictEqual(by['Marcus Oyelaran'].values.map(K), [262, 258, 255, 250, 238, 215, 190, 94]);
  assert.strictEqual(K(by['Marcus Oyelaran'].thisWeek), -96);
  assert.strictEqual(K(by['Marcus Oyelaran'].vs4), -156);
  assert.deepStrictEqual(v.rows.map(r => [r.label, r.newPursuits, r.newContracts]).sort(), [['Ben Okafor', 2, 1], ['Dana Whitfield', 3, 1], ['Elena Castellanos', 1, 0], ['Marcus Oyelaran', 2, 0], ['Priya Raman', 4, 2], ['Tom Lindqvist', 0, 0]]);
  assert.deepStrictEqual([K(v.firm.current), K(v.firm.thisWeek), K(v.firm.vs4), v.firm.newPursuits, v.firm.newContracts], [1118, -72, -388, 12, 4]);
  assert.deepStrictEqual(by['Priya Raman'].values.map(K), [415, 410, 400, 380, 340, 300, 260, 301]);
  assert.strictEqual(K(by['Priya Raman'].thisWeek), 41);
}));

test('this week: two alerts, the watch items, and the pursuit that became a project', () => withApp(async ({ api }) => {
  const v = (await api('j.workman').get('/api/pipeline')).body;
  const a = v.thisWeek.alerts;
  assert.deepStrictEqual(a.filter(x => x.severity === 'alert').map(x => x.title).sort(), ['Marcus O.: MWIP down $96K this week', 'Priya R.: forecast down $263K']);
  assert.deepStrictEqual(a.filter(x => x.severity === 'watch').map(x => x.rule).sort(), ['noNew', 'winProb']);
  assert.match(a.find(x => x.rule === 'mwipDrop').message, /Davis County Courthouse Annex, no longer in MWIP and with no matching project\. Threshold is \$75K in 7 days\./);
  assert.match(a.find(x => x.rule === 'forecastDrop').message, /mostly Utah Valley Medical Pavilion moving into next year/);
  assert.deepStrictEqual(v.thisWeek.conversions.map(c => c.message), ['Murray Parkway Retail became project 2026-0147 on Oct 2. No action needed.']);
  const me = (await api('j.workman').get('/api/me')).body;
  assert.strictEqual(me.badges.pipeline, 2, 'the badge counts alerts, not watch items');
}));

test('the pursuit detail: what left, what converted, what stayed', () => withApp(async ({ api }) => {
  const d = (await api('j.workman').get('/api/pipeline/detail?date=2026-10-05&kind=mwip&pic=E102')).body;
  assert.strictEqual(d.unmatched, 1);
  assert.deepStrictEqual(d.items.map(i => [i.name, i.status]), [['Davis County Courthouse Annex', 'removed'], ['Clearfield Armory Addition', 'active'], ['Tooele Water District Office', 'active']]);
  assert.match(d.items[0].what, /No matching project\. Check this one\./);
  assert.deepStrictEqual([K(d.total.last), K(d.total.current), K(d.total.change)], [190, 94, -96]);
  const p = (await api('j.workman').get('/api/pipeline/detail?date=2026-10-05&kind=mwip&pic=E103')).body;
  const murray = p.items.find(i => i.name === 'Murray Parkway Retail');
  assert.strictEqual(murray.status, 'converted');
  assert.match(murray.what, /Became project 2026-0147, opened Oct 2\. Not a loss\./);
  const f = (await api('j.workman').get('/api/pipeline/detail?date=2026-10-05&kind=forecast&pic=E103')).body;
  assert.strictEqual(K(f.items.find(i => /Utah Valley/.test(i.name)).moved), 250);
  assert.strictEqual((await api('j.workman').get('/api/pipeline/detail?date=2026-10-05&kind=mwip&pic=E999')).status, 404);
  assert.strictEqual((await api('j.workman').get('/api/pipeline/detail?date=2025-01-06&kind=mwip&pic=E102')).status, 404);
}));

test('an older snapshot shows the numbers as they were then', () => withApp(async ({ api }) => {
  const v = (await api('j.workman').get('/api/pipeline?date=2026-09-28&kind=mwip')).body;
  assert.strictEqual(v.latest, false);
  assert.strictEqual(v.weeks.length, 7);
  const marcus = v.rows.find(r => r.label === 'Marcus Oyelaran');
  assert.strictEqual(K(marcus.current), 190);
  assert.strictEqual(K(marcus.thisWeek), -25);
}));

test('who may read it: Admin, Finance and Marketing; a PIC only if the Admin allows; nobody writes except the Admin', () => withApp(async ({ api }) => {
  for (const u of ['j.workman', 'm.hale', 'c.brandt']) assert.strictEqual((await api(u).get('/api/pipeline')).status, 200, u);
  assert.strictEqual((await api('d.whitfield').get('/api/pipeline')).status, 403, 'PICs are off by default');
  assert.strictEqual((await api('kent').get('/api/pipeline')).status, 403, 'the system admin has no pipeline page');
  assert.strictEqual((await api().get('/api/pipeline')).status, 401);
  const josh = api('j.workman');
  const s = (await josh.get('/api/admin/settings')).body;
  await josh.put('/api/admin/settings', { changes: { access: Object.assign({}, s.access.value, { picPipeline: true }) } });
  const asPic = await api('d.whitfield').get('/api/pipeline');
  assert.strictEqual(asPic.status, 200, 'allowed once the setting is on');
  assert.ok(asPic.body.rows.length === 6, 'a PIC sees every PIC');
  const alertId = asPic.body.thisWeek.alerts[0].id;
  assert.strictEqual((await api('d.whitfield').post(`/api/admin/pipeline/alerts/${alertId}/clear`, {})).status, 403);
  assert.strictEqual((await api('d.whitfield').post('/api/admin/pipeline/notes', { pursuitId: '2026-0212', body: 'x' })).status, 403);
  assert.strictEqual((await api('m.hale').post(`/api/admin/pipeline/alerts/${alertId}/clear`, {})).status, 403);
  assert.strictEqual((await api('d.whitfield').post('/api/admin/pipeline/snapshot', {})).status, 403);
  assert.strictEqual((await api('d.whitfield').get('/api/me')).body.badges, undefined);
}));

test('clearing an alert lowers the badge; a note is the Admin\'s alone', () => withApp(async ({ api, db }) => {
  const josh = api('j.workman');
  const first = (await josh.get('/api/pipeline')).body.thisWeek.alerts.find(a => a.severity === 'alert');
  const r = await josh.post(`/api/admin/pipeline/alerts/${first.id}/clear`, {});
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.badge, 1);
  assert.strictEqual((await josh.get('/api/pipeline')).body.thisWeek.alerts.find(a => a.id === first.id).cleared, true);
  assert.ok(db.get("SELECT 1 AS x FROM audit_log WHERE action = 'pipeline.clear'"));
  assert.strictEqual((await josh.post('/api/admin/pipeline/alerts/99999/clear', {})).status, 404);

  assert.strictEqual((await josh.post('/api/admin/pipeline/notes', { pursuitId: '2026-0212', body: '   ' })).status, 400);
  assert.strictEqual((await josh.post('/api/admin/pipeline/notes', { pursuitId: 'nope', body: 'x' })).status, 404);
  assert.strictEqual((await josh.post('/api/admin/pipeline/notes', { pursuitId: '2026-0212', body: 'Talked to Marcus. Lost to a competitor.' })).status, 201);
  const mine = (await josh.get('/api/pipeline/detail?date=2026-10-05&kind=mwip&pic=E102')).body;
  assert.deepStrictEqual(mine.items[0].notes.map(n => n.body), ['Talked to Marcus. Lost to a competitor.']);
  const finance = (await api('m.hale').get('/api/pipeline/detail?date=2026-10-05&kind=mwip&pic=E102')).body;
  assert.deepStrictEqual(finance.items[0].notes, [], 'notes are not shown to anyone but the Admin');
  assert.throws(() => db.run('UPDATE pursuit_notes SET body = ?', 'x'), /append-only/);
  assert.throws(() => db.run('DELETE FROM pursuit_notes'), /append-only/);
}));

test('snapshots are never changed or deleted', () => withApp(async ({ db }) => {
  assert.throws(() => db.run('UPDATE pursuit_snapshots SET amount = 1'), /never changed/);
  assert.throws(() => db.run('DELETE FROM pursuit_snapshots'), /never deleted/);
  assert.throws(() => db.run('UPDATE forecast_snapshots SET amount = 1'), /never changed/);
  assert.throws(() => db.run('DELETE FROM pipeline_snapshots'), /never deleted/);
  assert.throws(() => db.run('DELETE FROM pipeline_alerts'), /never deleted/);
}));

test('taking a snapshot twice for the same Monday changes nothing', () => withApp(async ({ api, db }) => {
  const before = db.get('SELECT COUNT(*) AS n FROM pursuit_snapshots').n;
  const r = await api('j.workman').post('/api/admin/pipeline/snapshot', {});
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.created, false);
  assert.strictEqual(r.body.date, '2026-10-05', 'the Monday of the demo day');
  assert.strictEqual(db.get('SELECT COUNT(*) AS n FROM pursuit_snapshots').n, before);
}));

test('the Monday job emails the Admin only when an alert needs a look, and never a PIC', () => withApp(async ({ db }) => {
  const mailer = { sent: [], sendToAdmin(m) { this.sent.push(m); } };
  const settings = settingsRules.DEFAULTS;
  const local = createLocalSource();
  const args = { settings, mailer, baseUrl: 'http://x', adminEmails: ['josh@example.test'] };
  // a quiet week: Oct 12 looks like Oct 5
  const quiet = Object.assign(Object.create(local), { loadPipeline: () => local.loadPipeline('2026-10-05') });
  let out = pipe.runWeekly(db, Object.assign({ source: quiet, date: '2026-10-12' }, args));
  assert.strictEqual(out.created, true);
  assert.strictEqual(out.alerts, 0, 'nothing new crossed a threshold');
  assert.strictEqual(mailer.sent.length, 0);
  // a bad week: Marcus loses his last two pursuits
  const bad = Object.assign(Object.create(local), { loadPipeline: () => { const d = local.loadPipeline('2026-10-05'); d.pursuits = d.pursuits.filter(p => p.pic !== 'E102'); return d; } });
  out = pipe.runWeekly(db, Object.assign({ source: bad, date: '2026-10-19' }, args));
  assert.strictEqual(out.alerts, 1);
  assert.strictEqual(out.emailed, true);
  assert.strictEqual(mailer.sent.length, 1);
  assert.match(mailer.sent[0].subject, /1 alert needs a look/);
  assert.deepStrictEqual(mailer.sent[0].to, ['josh@example.test']);
  assert.ok(!/Marcus|Davis|Clearfield/.test(mailer.sent[0].body), 'a count and a link, no names');
  assert.match(mailer.sent[0].body, /#\/pipeline/);
  // run again: nothing new, no second email
  out = pipe.runWeekly(db, Object.assign({ source: bad, date: '2026-10-19' }, args));
  assert.strictEqual(out.created, false);
  assert.strictEqual(mailer.sent.length, 1);
  // the switch turns the email off
  out = pipe.runWeekly(db, Object.assign({ source: bad, date: '2026-10-26' }, args, { settings: Object.assign({}, settings, { 'pipeline.emailAdmin': false }) }));
  assert.strictEqual(mailer.sent.length, 1);
}));

test('the pipeline settings are validated, and a rule can be switched off', () => withApp(async ({ api }) => {
  const josh = api('j.workman');
  const rules = JSON.parse(JSON.stringify(settingsRules.DEFAULTS['pipeline.rules']));
  rules.mwipDrop.sev = 'maybe';
  assert.strictEqual((await josh.put('/api/admin/settings', { changes: { 'pipeline.rules': rules } })).status, 400);
  rules.mwipDrop.sev = 'off'; rules.mwipDrop.amount = 0;
  assert.strictEqual((await josh.put('/api/admin/settings', { changes: { 'pipeline.rules': rules } })).status, 400, 'an amount of zero would alert on everything');
  rules.mwipDrop.amount = 50000;
  assert.strictEqual((await josh.put('/api/admin/settings', { changes: { 'pipeline.rules': rules } })).status, 200);
  assert.strictEqual((await api('kent').put('/api/admin/settings', { changes: { 'pipeline.emailAdmin': false } })).status, 403, 'the system admin only reads');
}));

test('export: a CSV of the table on screen, for anyone who can see the page', () => withApp(async ({ base, user }) => {
  const res = await fetch(`${base}/api/pipeline/export?kind=mwip&date=2026-10-05`, { headers: { 'x-compass-user': user('m.hale').id } });
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  const text = (await res.text()).replace(/^﻿/, '');
  const lines = text.trim().split('\r\n');
  assert.strictEqual(lines.length, 8, 'a header, six PICs and the firm');
  assert.ok(lines[0].startsWith('"PIC","2026-08-17"'));
  assert.ok(lines.some(l => l.startsWith('"Marcus Oyelaran",262000.00,')));
  assert.ok(lines[lines.length - 1].startsWith('"Firm"'));
}));

test('Home shows the pipeline alerts and when the next snapshot is due', () => withApp(async ({ api }) => {
  const h = (await api('j.workman').get('/api/home')).body;
  const item = h.attention.find(a => a.kind === 'pipeline');
  assert.strictEqual(item.badge, '2 alerts');
  assert.strictEqual(item.href, '#/pipeline');
  assert.strictEqual(h.checks.find(c => c.title === 'Pipeline watch').status, 'ok');
  const next = h.next.find(n => n.title === 'Pipeline snapshot');
  assert.strictEqual(next.date, '2026-10-12', 'the Monday after the demo day');
}));
