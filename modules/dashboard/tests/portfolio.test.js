'use strict';
const test = require('node:test');
const assert = require('node:assert');
const P = require('../logic/portfolio');
const fx = require('./fixtures/portfolio.json');

const summaries = () => fx.cases.map(c => P.summarize(c.project, fx.when));

test('one project: figures, status and chips, every fixture case', () => {
  for (const c of fx.cases) {
    const s = P.summarize(c.project, fx.when);
    for (const [k, v] of Object.entries(c.expect)) {
      if (k === 'status') assert.strictEqual(P.status(s, fx.rules), v, `${c.why} (status)`);
      else if (k === 'chips') for (const [chip, inIt] of Object.entries(v)) assert.strictEqual(P.inChip(s, chip, fx.when, fx.rules), inIt, `${c.why} (chip ${chip})`);
      else assert.deepStrictEqual(s[k], v, `${c.why} (${k})`);
    }
  }
});

test('totals across the projects', () => {
  const t = P.totals(summaries(), fx.rules);
  for (const [k, v] of Object.entries(fx.totals.expect)) assert.deepStrictEqual(t[k], v, `${fx.totals.why} (${k})`);
});

test('the status cutoffs are the Admin settings, not constants', () => {
  const s = summaries()[0]; // 45% profit
  assert.strictEqual(P.status(s, Object.assign({}, fx.rules, { watchProfitPct: 50 })), 'watch');
  assert.strictEqual(P.status(s, Object.assign({}, fx.rules, { watchProfitPct: 45 })), 'ok', 'at the cutoff is On track');
  const station = summaries()[2]; // ends 2027-02, four months on
  assert.strictEqual(P.inChip(station, 'ending', fx.when, Object.assign({}, fx.rules, { endingSoonDays: 120 })), true);
});

test('every status and chip has plain words; an unknown chip is refused', () => {
  for (const k of ['look', 'watch', 'ok']) assert.ok(P.STATUS_LABEL[k]);
  for (const c of P.CHIPS) assert.ok(P.CHIP_LABEL[c]);
  assert.throws(() => P.inChip(summaries()[0], 'struggling', fx.when, fx.rules), /unknown chip/);
});
