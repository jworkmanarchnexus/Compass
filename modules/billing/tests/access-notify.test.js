'use strict';
const test = require('node:test');
const assert = require('node:assert');
const A = require('../logic/access');
const N = require('../logic/notify');
const access = require('./fixtures/access.json');
const notify = require('./fixtures/notify.json');

test('access: who may see, edit, process and assign', () => {
  for (const c of access.access) assert.deepStrictEqual(A.access(c.user, access.project), c.expect, c.name);
});
test('access: the kinds the state machine uses', () => {
  for (const c of access.kinds) assert.deepStrictEqual(A.kinds(c.user, access.project), c.expect, c.user.role);
});
test('access: the side bar entry and the projects each person sees', () => {
  for (const [role, want] of Object.entries(access.sideBar)) assert.strictEqual(A.canSeeBilling(role), want, role);
  for (const c of access.visible.cases) assert.deepStrictEqual(A.visibleProjects(c.user, access.visible.projects).map(p => p.wbs1), c.expect, c.user.role + c.user.employeeCode);
});

/* settings are written 'a.b': value onto a copy of the defaults */
const prefsWith = change => {
  const p = JSON.parse(JSON.stringify(N.DEFAULT_PREFS));
  for (const [path, v] of Object.entries(change || {})) { const [a, b] = path.split('.'); p[a][b] = v; }
  return p;
};

test('email: default preferences are Josh\'s mockup and are valid', () => {
  assert.deepStrictEqual(N.validatePrefs(N.DEFAULT_PREFS), []);
  assert.deepStrictEqual(Object.keys(N.DEFAULT_PREFS.events), N.EVENTS);
  assert.strictEqual(N.DEFAULT_PREFS.events.complete, 'off');
  assert.strictEqual(N.DEFAULT_PREFS.digest.firstTime, '07:00');
});
test('email: bad preferences are named', () => {
  for (const c of notify.invalidPrefs) assert.deepStrictEqual(N.validatePrefs(prefsWith(c.change)), c.expect, c.name);
  assert.deepStrictEqual(N.validatePrefs(null), ['prefs']);
});
test('email: business hours and the next start', () => {
  for (const c of notify.businessHours) assert.strictEqual(N.isBusinessHours(c.now, N.DEFAULT_BUSINESS_HOURS), c.expect, c.now);
  for (const c of notify.nextBusinessStart) assert.strictEqual(N.nextBusinessStart(c.now, N.DEFAULT_BUSINESS_HOURS), c.expect, c.now);
});
test('email: off, digest, immediate, quiet hours and the urgent alert', () => {
  for (const c of notify.delivery) assert.deepStrictEqual(N.deliveryFor(prefsWith(c.change), c.event, c.now, N.DEFAULT_BUSINESS_HOURS), c.expect, c.name);
});
test('email: when the next digest goes out', () => {
  for (const c of notify.nextDigest) assert.strictEqual(N.nextDigest(prefsWith(c.change), c.now), c.expect, c.name);
});
test('email: who is told, and both processors hear about a reassignment', () => {
  for (const c of notify.recipients.cases) assert.deepStrictEqual(N.recipients(c.event, c.project, notify.recipients.processors), c.expect, c.note || c.event);
});
test('email: the digest contents', () => {
  for (const c of notify.digest.cases) {
    const got = N.digestFor(prefsWith(c.change), c.processor, c.items || notify.digest.items);
    const shape = got && { sections: got.sections.map(s => ({ event: s.event, wbs1: s.items.map(i => i.wbs1) })) };
    assert.deepStrictEqual(shape, c.expect, c.name);
  }
});
test('email: missing instructions and unprocessed requests', () => {
  for (const c of notify.missing) assert.strictEqual(N.missingDue({ deadline: c.deadline, daysLeft: c.daysLeft }, c.cutoffDays, c.unbilled), c.expect, c.note || String(c.daysLeft));
  for (const c of notify.stale) assert.strictEqual(N.isStale({ status: c.status, submittedOn: c.submittedOn }, c.today, c.staleDays), c.expect, c.status + c.today);
});
