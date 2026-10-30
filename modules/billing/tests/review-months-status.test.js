'use strict';
const test = require('node:test');
const assert = require('node:assert');
const F = require('../logic/fixed');
const H = require('../logic/hourly');
const R = require('../logic/review');
const Mo = require('../logic/months');
const S = require('../logic/status');
const fixed = require('./fixtures/fixed.json');
const hourly = require('./fixtures/hourly.json');
const review = require('./fixtures/review.json');
const months = require('./fixtures/months.json');
const status = require('./fixtures/status.json');

const entry = v => (typeof v === 'string' && v.startsWith('pct:') ? { pctBp: Number(v.slice(4)) } : { amountCents: v });
const issueText = i => (i.lineId ? `${i.code}@${i.lineId}` : i.code);

test('review: the variance rule, blocking errors and Save Draft', () => {
  for (const c of review.cases) {
    const entries = Object.fromEntries(Object.entries(c.entries).map(([k, v]) => [k, entry(v)]));
    const evaluated = c.form === 'hourly' ? H.evaluate(c.project || hourly.project, hourly.lines, entries) : F.evaluate(fixed.phases, entries);
    const got = R.review(evaluated, { noBilling: !!c.noBilling, notes: c.notes, projectionCents: c.projectionCents, thresholdCents: c.thresholdCents || review.thresholdCents, sourceHash: c.sourceHash, currentSourceHash: c.currentSourceHash });
    const want = c.expect;
    try {
      assert.deepStrictEqual(got.issues.map(issueText), want.issues);
      for (const k of ['canSubmit', 'canSaveDraft', 'needsNote', 'varianceCents', 'totalCents']) if (k in want) assert.strictEqual(got[k], want[k], k);
    } catch (e) { e.message = c.name + ': ' + e.message; throw e; }
  }
});

test('review: a zero total is submitted as an explicit No billing', () => {
  for (const c of review.normalize) assert.strictEqual(R.normalizeForSubmit({ totalCents: c.totalCents }, c.noBilling), c.expect);
});

test('months: start dates, the clock reset and the current billing month', () => {
  for (const c of months.startsOn) assert.strictEqual(Mo.startsOn(c.month, c.opts), c.expect, c.note || c.month);
  for (const c of months.current) assert.strictEqual(Mo.currentBillingMonth(c.date, c.opts), c.expect, `${c.date} ${c.note || ''}`);
  for (const c of months.addMonths) assert.strictEqual(Mo.addMonths(c.month, c.n), c.expect);
});

test('months: the deadline the Admin entered, or none', () => {
  for (const c of months.deadline.cases) assert.deepStrictEqual(Mo.deadlineStatus(c.month, c.today, months.deadline.calendar), c.expect, c.note || c.today);
});

test('months: the unbilled list shows every expected project exactly once, including zero-bill ones', () => {
  const u = months.unbilled, got = Mo.unbilledList(u.projects, u.requests, u.month);
  assert.deepStrictEqual(got, u.expect);
  const all = [...got.unbilled, ...got.done, ...got.excluded].map(x => x.wbs1).sort();
  assert.deepStrictEqual(all, u.projects.map(p => p.wbs1).sort());
});

test('months: one open request per project; a later one in the same month is additional', () => {
  for (const c of months.canStart.cases) assert.deepStrictEqual(Mo.canStartRequest(months.canStart.requests, c.wbs1, c.month), c.expect, c.note || c.wbs1);
});

test('status: every change, who may make it, and what it tells accounting', () => {
  for (const c of status.transitions) {
    const got = S.transition(c.status, c.event, { kinds: c.kinds }, c.payload, c.ctx);
    try { for (const [k, v] of Object.entries(c.expect)) assert.deepStrictEqual(got[k], v, k); }
    catch (e) { e.message = c.name + ': ' + e.message; throw e; }
  }
});

test('status: the buttons a person sees', () => {
  for (const c of status.actions) assert.deepStrictEqual(S.actionsFor(c.status, { kinds: c.kinds }), c.expect, c.status + ' ' + c.kinds);
});

test('status: nothing is ever deleted or reopened once processed', () => {
  for (const ev of ['submit', 'withdraw', 'start-review', 'return', 'process', 'release', 'revise', 'edit', 'resubmit', 'answer'])
    assert.strictEqual(S.transition('processed', ev, { kinds: ['author', 'processor', 'admin'] }, { reason: 'x' }, {}).ok, false, ev);
});
