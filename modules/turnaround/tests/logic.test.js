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
  for (const c of schedFx.nextFirstBusinessDay) assert.strictEqual(sched.nextFirstBusinessDay(c.date, c.includeToday), c.expect, c.date);
  for (const c of schedFx.lastDayOfPeriod) assert.strictEqual(sched.lastDayOfPeriod(c.period), c.expect, String(c.period));
});

/* ---- commitment patterns (the Admin's analysis) ---- */
const { analyze } = require('../logic/patterns');
const patFx = require('./fixtures/patterns.json');
const rd = (v, d) => (v === null || v === undefined ? v : Math.round(v * 10 ** d) / 10 ** d);
test('commitment patterns: every number in the hand-worked case', () => {
  const out = analyze(patFx.input);
  const e = patFx.expect;
  assert.strictEqual(out.total, e.total);
  const check = (got, want, label) => {
    for (const [k, v] of Object.entries(want)) {
      const g = typeof v === 'number' && !Number.isInteger(v) ? rd(got[k], k.startsWith('avg') ? 1 : 3) : got[k];
      assert.strictEqual(typeof v === 'number' && k.startsWith('avg') ? rd(got[k], 1) : g, v, `${label}: ${k}`);
    }
  };
  for (const [g, want] of Object.entries(e.groups)) check(out.groups[g], want, 'group ' + g);
  for (const [a, want] of Object.entries(e.actions)) check(out.actions.find(x => x.lever === a), want, 'action ' + a);
  for (const [p, want] of Object.entries(e.pics)) check(out.pics.find(x => x.pic === p), want, 'pic ' + p);
  for (const [m, want] of Object.entries(e.months)) check(out.months[Number(m) - 1], want, 'month ' + m);
  check(out.responsiveness, e.responsiveness, 'responsiveness');
  check(out.offList, e.offList, 'offList');
  assert.deepStrictEqual(out.others, e.others);
  const none = analyze(patFx.empty);
  assert.strictEqual(none.total, 0);
  assert.strictEqual(none.groups.money.keptRate, null, 'no rate invented from nothing');
  assert.strictEqual(none.responsiveness.updatesPerProject, null);
});

/* ---- phase 3: the plan log, plan status, standing, drafts ---- */
const plan = require('../logic/plan');
const drafts = require('../logic/drafts');
const planFx = require('./fixtures/plan.json');
const draftFx = require('./fixtures/drafts.json');

test('plan status: every fixture case', () => {
  for (const c of planFx.planStatus) {
    const got = plan.planStatus({ today: c.today, firstAppeared: c.firstAppeared, entries: c.entries, settings: planFx.settings });
    for (const [k, v] of Object.entries(c.expect)) assert.strictEqual(got[k], v, `${c.name}: ${k}`);
  }
});
test('commitments: replayed from the log', () => {
  for (const c of planFx.commitmentStates) {
    const got = plan.commitmentStates(c.entries).map(s => ({ id: s.id, status: s.status, dueDate: s.dueDate, promisedBy: s.promisedBy, revisions: s.revisions.length, kept: s.kept }));
    assert.strictEqual(got.length, c.expect.length, c.name);
    c.expect.forEach((e, i) => { for (const [k, v] of Object.entries(e)) assert.strictEqual(got[i][k], v, `${c.name}: ${k}`); });
  }
  for (const c of planFx.commitmentsToMiss) assert.deepStrictEqual(plan.commitmentsToMiss(c.entries, c.today, 14).map(s => s.id), c.expect, c.name);
});
test('on time and kept', () => {
  for (const c of planFx.onTimeStats) assert.deepStrictEqual(plan.onTimeStats({ today: c.today, firstAppeared: c.firstAppeared, entries: c.entries, settings: planFx.settings }), c.expect, c.name);
  for (const c of planFx.keptStats) assert.deepStrictEqual(plan.keptStats(c.states), c.expect, c.name);
});
test('standing labels', () => {
  for (const c of planFx.standing) assert.strictEqual(plan.standing({ onTime: c.onTime, kept: c.kept }, Object.assign({}, planFx.settings, c.settings)).label, c.expect, c.name);
});
test('who may write what in the plan log', () => {
  for (const c of planFx.canWrite) assert.strictEqual(plan.canWrite(c.role, c.kind, c.isPic), c.expect, `${c.role} ${c.kind} pic=${c.isPic}`);
});
test('check-in drafts: who gets one and when', () => {
  for (const c of draftFx.cases) {
    const out = drafts.planDrafts({ today: c.today || draftFx.today, items: c.items, existing: c.existing, lastEntryByPic: c.lastEntryByPic, settings: Object.assign({}, draftFx.settings, c.settings) });
    assert.deepStrictEqual(out.create.map(d => [d.picUserId, d.situation, d.step, d.tone, d.items.map(i => i.wbs1)]), c.expect.create, c.name + ' (create)');
    assert.deepStrictEqual(out.withdraw, c.expect.withdraw, c.name + ' (withdraw)');
    assert.deepStrictEqual(out.escalate.map(x => [x.picUserId, x.wbs1, x.situation, x.daysOverdue]), c.expect.escalate, c.name + ' (escalate)');
  }
});
test('check-in drafts: the words', () => {
  for (const c of draftFx.text) {
    const out = drafts.draftText({ tone: c.tone, situation: c.situation, picName: c.picName, items: c.items });
    assert.strictEqual(out.subject, c.subject, c.name);
    if (c.body) assert.strictEqual(out.body, c.body, c.name);
    for (const s of c.contains || []) assert.ok(out.body.includes(s), `${c.name}: ${s}`);
    assert.ok(!/undefined|NaN|null/.test(out.subject + out.body), c.name + ' has no stray values');
  }
});
