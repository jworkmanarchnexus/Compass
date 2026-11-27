'use strict';
const test = require('node:test');
const assert = require('node:assert');
const F = require('../logic/form');
const W = require('../logic/workflow');
const form = require('./fixtures/form.json');
const wf = require('./fixtures/workflow.json');

test('stage -> probability: each stage allows only the worksheet\'s values', () => {
  for (const c of form.allowedProbs) assert.deepStrictEqual(F.allowedProbs(c.stage), c.expect, c.stage);
  assert.deepStrictEqual(F.LISTS.stages, Object.keys(F.DEFAULT_STAGE_PROBS), 'every intake stage has probabilities');
  for (const s of ['No Go', 'Cancelled by Client', 'Lost - No Shortlist', 'Lost - Shortlisted', 'Lost - Interviewed']) assert.ok(!F.LISTS.stages.includes(s), s + ' is not offered at intake');
});
test('stage -> probability: the Admin setting must keep the shape', () => {
  for (const c of form.validStageProbs) assert.strictEqual(F.validStageProbs(c.value === 'DEFAULT' ? F.DEFAULT_STAGE_PROBS : c.value), c.expect, c.name);
  assert.deepStrictEqual(F.allowedProbs('Shortlisted', { Shortlisted: [40] }), [40], 'a changed setting is used');
});
test('urgency comes from the start date and lands on a Vantagepoint option', () => {
  for (const c of form.urgency) assert.deepStrictEqual(F.urgency(c.start, c.today), c.expect, `${c.start} on ${c.today}`);
  for (const c of form.urgency) if (c.expect.value) assert.ok(F.LISTS.urgency.includes(c.expect.value));
});
test('AIA 2030: every branch of the concept\'s rule', () => {
  for (const c of form.aia2030) assert.strictEqual(F.aia2030(c.f).key, c.expect, JSON.stringify(c.f));
  assert.strictEqual(F.isFlagged(F.aia2030({ deliv: 'Sustainability' })), true);
  assert.strictEqual(F.isFlagged(F.aia2030({ deliv: 'Master Plan' })), false);
  assert.strictEqual(F.asksSite({ deliv: 'Master Plan' }), false, 'no site questions when not reportable');
  assert.strictEqual(F.asksSite({}), true, 'asked until we know');
});
test('problems: what stops a submission', () => {
  for (const c of form.problems) {
    const f = c.replace ? Object.assign({}, c.replace) : Object.assign({}, form.complete, c.change);
    const got = F.problems(f, { lists: form.lists }).map(p => p.field);
    const want = c.expectFields || c.expect;
    assert.deepStrictEqual([...new Set(got)].sort(), [...new Set(want)].sort(), c.name);
  }
});
test('problems: the project architect must be a licensed architect when Vantagepoint tracks it', () => {
  for (const c of form.architects) {
    const f = Object.assign({}, form.complete, { pa: c.pa });
    const lists = Object.assign({}, form.lists, { architects: c.architects, employees: form.lists.employees.concat(c.architects || []) });
    assert.deepStrictEqual(F.problems(f, { lists }).map(p => p.field), c.expectFields, c.name);
  }
});
test('warnings: shown, never blocking', () => {
  for (const c of form.warnings) assert.deepStrictEqual(F.warnings(c.f, { cfoThreshold: c.cfoThreshold, today: c.today }).map(w => w.key), c.expect, c.name);
});
test('clean: only known fields are stored', () => {
  for (const c of form.clean) {
    const out = F.clean(c.in);
    for (const [k, v] of Object.entries(c.pick)) assert.deepStrictEqual(out[k], v, `${c.name}: ${k}`);
    for (const k of c.absent || []) assert.ok(!(k in out), `${c.name}: ${k}`);
  }
  assert.deepStrictEqual(F.problems(F.clean(form.complete), { lists: form.lists }), [], 'a cleaned complete form still passes');
});

test('who sees the module, submits, and reviews', () => {
  for (const [who, want] of Object.entries(wf.perms)) assert.deepStrictEqual(W.perms(wf.people[who], wf.cfg), want, who);
  assert.deepStrictEqual(W.perms(wf.people.wendy, Object.assign({}, wf.cfg, { admins: [] })), { see: false, submit: false, review: false }, 'not a PiP admin any more');
});
test('statuses: every action, its status and what it needs', () => {
  for (const c of wf.check) {
    const req = { id: 'r', status: c.status, submittedBy: c.submittedBy || 'u-dana' };
    assert.deepStrictEqual(W.check(wf.people[c.who], wf.cfg, req, c.action, c.input || {}), c.expect, `${c.who} ${c.action} from ${c.status}`);
  }
  for (const s of W.FINAL) for (const a of Object.keys(W.ACTIONS)) assert.ok(!W.ACTIONS[a].from.includes(s), `${s} is final`);
});
test('statuses: the buttons each person sees', () => {
  for (const c of wf.actionsFor) assert.deepStrictEqual(W.actionsFor(wf.people[c.who], wf.cfg, { status: c.status, submittedBy: c.submittedBy }), c.expect, `${c.who} on ${c.status}`);
});
test('emails: who is told', () => {
  for (const c of wf.recipients) assert.deepStrictEqual(W.recipients(c.event, { fields: c.fields, submittedBy: c.submittedBy }, wf.cfg), c.expect, c.name);
});
test('the home list: waiting first (oldest first, however old), then the last 30 days', () => {
  for (const c of wf.homeList.cases) assert.deepStrictEqual(W.homeList(wf.homeList.requests, wf.people[c.who], wf.cfg, wf.homeList.now), c.expect, c.who);
});
