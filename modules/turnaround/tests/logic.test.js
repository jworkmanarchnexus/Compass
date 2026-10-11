'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { computeProjects, pct } = require('../logic/profit');
const { selectForRun } = require('../logic/selection');
const lc = require('../logic/lifecycle');
const sched = require('../logic/schedule');
const profitFx = require('./fixtures/profit.json');
const selFx = require('./fixtures/selection.json');
const lcFx = require('./fixtures/lifecycle.json');
const schedFx = require('./fixtures/schedule.json');

test('profit: every fixture case', () => {
  for (const c of profitFx.cases) {
    const out = computeProjects({ projects: c.projects, ledger: c.ledger, overhead: c.overhead, runPeriod: c.runPeriod });
    assert.strictEqual(out.length, c.expect.length, c.name);
    c.expect.forEach((e, i) => {
      const got = out[i];
      assert.strictEqual(got.wbs1, e.wbs1, c.name);
      assert.strictEqual(got.evaluable, e.evaluable, c.name);
      if (e.reason) assert.strictEqual(got.reason, e.reason, c.name);
      assert.deepStrictEqual(got.billed, e.billed, c.name + ' (billed)');
      assert.deepStrictEqual(got.profit, e.profit, c.name + ' (profit)');
      const p = pct(got.profit.ytd, got.billed.ytd);
      assert.strictEqual(p === null ? null : Math.round(p * 10) / 10, e.pctYtd1dp, c.name + ' (pct)');
    });
  }
});

test('selection: every fixture case', () => {
  for (const c of selFx.cases) {
    const out = selectForRun(selFx.base, c.settings);
    assert.deepStrictEqual(out.included.map(p => p.wbs1), c.included, c.name + ' (included)');
    assert.deepStrictEqual(out.warnings.map(w => ({ kind: w.kind, wbs1: w.wbs1 })), c.warnings, c.name + ' (warnings)');
  }
});

test('lifecycle: build, publish, rebuild, archive, and what everyone else sees', () => {
  for (const c of lcFx.canBuild) assert.strictEqual(lc.canBuild(c.runs, c.kind, c.period).ok, c.ok, c.name);
  for (const c of lcFx.nextVersion) assert.strictEqual(lc.nextVersion(c.runs, c.kind, c.period), c.expect);
  for (const c of lcFx.canPublish) assert.strictEqual(lc.canPublish({ status: c.status }).ok, c.ok, c.status);
  for (const c of lcFx.canRebuild) assert.strictEqual(lc.canRebuild({ status: c.status }).ok, c.ok, c.status);
  for (const c of lcFx.canArchive) {
    const r = lc.canArchive({ status: c.status }, { reason: c.reason, confirm: c.confirm });
    assert.strictEqual(r.ok, c.ok, c.name);
    if (!r.ok) assert.ok(r.error, c.name + ' explains why');
  }
  for (const c of lcFx.currentPublished) {
    const r = lc.currentPublished(c.runs, 'turnaround');
    assert.strictEqual(r ? r.id : null, c.expect, c.name);
  }
});

test('schedule: last closed month, first business day, labels', () => {
  for (const c of schedFx.lastClosedPeriod) assert.strictEqual(sched.lastClosedPeriod(c.date), c.expect, c.date);
  for (const c of schedFx.isFirstBusinessDay) assert.strictEqual(sched.isFirstBusinessDay(c.date), c.expect, c.date + ' ' + (c.why || ''));
  for (const c of schedFx.periodLabel) assert.strictEqual(sched.periodLabel(c.period), c.expect);
});
