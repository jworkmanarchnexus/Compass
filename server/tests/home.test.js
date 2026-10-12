'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { start } = require('./helpers');

async function withDemo(fn, opts) {
  const t = await start(Object.assign({ demo: true, today: () => '2026-10-07' }, opts));
  try { await fn(t); } finally { await t.close(); }
}
const home = async (t, who) => (await t.api(who).get('/api/home'));

test('admin Home on the demo day: what needs attention, what was published, what to fix, what runs next', () => withDemo(async t => {
  const r = await home(t, 'j.workman');
  assert.strictEqual(r.status, 200);
  const h = r.body;
  assert.strictEqual(h.today, '2026-10-07');
  assert.deepStrictEqual(h.attention.map(a => a.kind), ['checkins'], 'both runs are published, so no draft to review; two check-in drafts wait');
  assert.strictEqual(h.attention[0].badge, '2 drafts');
  assert.match(h.attention[0].text, /^2 overdue plan updates\. Each note goes out from your own mailbox\.$/);
  assert.strictEqual(h.attention[0].href, '#/turnaround/checkins');

  assert.deepStrictEqual(h.published.map(p => p.label), ['Project Turnaround, September 2026', 'BD report, September 2026', 'BD report, August 2026', 'Project Turnaround, August 2026'], 'newest first, both kinds');
  assert.strictEqual(h.published[0].by, 'Josh');
  assert.match(h.published[0].text, /^16 turnaround projects\. Visible to PICs and Finance\.$/);
  assert.match(h.published[1].text, /^Billing cutoff 2026-09-30\. Visible to Finance and Marketing\.$/);
  assert.strictEqual(h.published[1].href, `#/bd/${h.published[1].id}`);

  const by = title => h.checks.find(c => c.title.includes(title));
  assert.strictEqual(by('Monthly Vantagepoint pull').status, 'ok');
  assert.strictEqual(by('2 active projects have no PIC').status, 'fix');
  assert.strictEqual(by('Every PIC has a Compass login').status, 'ok');
  assert.strictEqual(by('2 projects could not be evaluated').status, 'fix');
  assert.strictEqual(by('Daily checks have not run yet').status, 'fix', 'the seed did not log a run; the audit log is how Home knows');

  assert.strictEqual(h.next[0].title, 'Project Turnaround run');
  assert.strictEqual(h.next[0].date, '2026-11-02');
  assert.deepStrictEqual(h.pull, { period: 202609, label: 'September 2026', dataAsOf: '2026-09-30', builtAt: h.pull.builtAt });
  assert.strictEqual(h.yours, undefined);
}));

test('a draft waiting for review is the first thing on the admin\'s Home, unless switched off', () => withDemo(async t => {
  const josh = t.api('j.workman');
  const run = await josh.post('/api/admin/runs', { period: 202607 });
  assert.strictEqual(run.status, 201);
  let a = (await home(t, 'j.workman')).body.attention;
  assert.deepStrictEqual(a.map(x => x.kind), ['draft', 'checkins']);
  assert.strictEqual(a[0].title, 'Project Turnaround: July 2026 run is ready to review');
  assert.match(a[0].text, /^\d+ turnaround projects across \d+ PICs\. Generated \{createdAt\}\./);
  assert.strictEqual(a[0].href, `#/admin/runs/${run.body.run.id}`);
  await josh.put('/api/admin/settings', { changes: { 'run.showOnHome': false } });
  a = (await home(t, 'j.workman')).body.attention;
  assert.deepStrictEqual(a.map(x => x.kind), ['checkins'], 'the setting hides it');
}));

test('with nothing built, Home says so and gives the next run date', () => withDemo(async t => {
  const h = (await home(t, 'j.workman')).body;
  assert.deepStrictEqual(h.attention, []);
  assert.strictEqual(h.published.length, 0);
  assert.match(h.checks[0].title, /^No run has been built yet$/);
  assert.strictEqual(h.checks[0].status, 'fix');
  assert.strictEqual(h.next[0].date, '2026-11-02');
  assert.strictEqual(h.pull, null);
}, { demo: false }));

test('a PIC with no Compass login is a data check', () => withDemo(async t => {
  await t.api('j.workman').put(`/api/admin/people/${t.user('p.raman').id}`, { active: false });
  const c = (await home(t, 'j.workman')).body.checks.find(x => /no Compass login/.test(x.title));
  assert.strictEqual(c.status, 'fix');
  assert.match(c.title, /^4 active projects have a PIC with no Compass login$/);
}));

test('the daily checks go green once they have run', () => withDemo(async t => {
  await t.api('j.workman').post('/api/admin/daily');
  const c = (await home(t, 'j.workman')).body.checks.find(x => x.title === 'Daily checks');
  assert.strictEqual(c.status, 'ok');
}));

test('a PIC\'s Home is their own projects and what was published, with nothing of the admin\'s', () => withDemo(async t => {
  const h = (await home(t, 'd.whitfield')).body;
  assert.deepStrictEqual(h.yours.projects.map(p => [p.wbs1, p.plan.status]).sort(), [['2024-0388', 'current'], ['2025-0173', 'overdue'], ['2025-0291', 'current'], ['2025-0412', 'update_due']]);
  assert.strictEqual(h.yours.runLabel, 'September 2026');
  for (const key of ['attention', 'checks', 'next', 'pull']) assert.strictEqual(h[key], undefined, key);
  assert.deepStrictEqual(h.published.map(p => p.label), ['Project Turnaround, September 2026', 'Project Turnaround, August 2026'], 'PICs see no BD reports unless the Admin allows it');
  assert.doesNotMatch(h.published[0].text, /Visible to/, 'who can see what is the admin\'s business');
}));

test('Finance, Marketing and the system admin each get only their part', () => withDemo(async t => {
  const fin = (await home(t, 'm.hale')).body;
  assert.ok(fin.published.length && !fin.attention && !fin.checks && !fin.yours);
  const mkt = (await home(t, 'c.brandt')).body;
  assert.deepStrictEqual(mkt.published.map(p => p.label), ['BD report, September 2026', 'BD report, August 2026'], 'Marketing sees the BD reports, not Turnaround, by default');
  assert.ok(!mkt.attention && !mkt.checks);
  await t.api('j.workman').put('/api/admin/settings', { changes: { access: { marketingTurnaround: true, picBd: false, picPipeline: false } } });
  assert.strictEqual((await home(t, 'c.brandt')).body.published.length, 4, 'and Turnaround too once allowed');
  const kent = (await home(t, 'kent')).body;
  assert.ok(kent.checks && kent.next && kent.pull && !kent.attention && !kent.published && !kent.yours, 'the system admin sees checks, never run contents');
  assert.strictEqual((await home(t, undefined)).status, 401);
}));
