'use strict';
const test = require('node:test');
const assert = require('node:assert');
const M = require('../logic/money');
const F = require('../logic/fixed');
const H = require('../logic/hourly');
const money = require('./fixtures/money.json');
const fixed = require('./fixtures/fixed.json');
const hourly = require('./fixtures/hourly.json');

test('money: a percent of a fee rounds to the nearest cent, halves up', () => {
  for (const c of money.bpToCents) assert.strictEqual(M.bpToCents(c.feeCents, c.bp), c.cents, `${c.feeCents} at ${c.bp}`);
});
test('money: cents back to a percent in hundredths', () => {
  for (const c of money.centsToBp) assert.strictEqual(M.centsToBp(c.cents, c.feeCents), c.bp, `${c.cents} of ${c.feeCents}`);
});
test('money: typed amounts and percents are parsed without floating point', () => {
  for (const c of money.parseCents) assert.strictEqual(M.parseCents(c.text), c.cents, JSON.stringify(c.text));
  for (const c of money.parseBp) assert.strictEqual(M.parseBp(c.text), c.bp, JSON.stringify(c.text));
});
test('money: display text', () => {
  for (const c of money.text) { assert.strictEqual(M.bpText(c.bp), c.bpText); assert.strictEqual(M.centsText(c.cents), c.centsText); }
});

const phase = (id, override) => Object.assign({}, fixed.phases.find(p => p.id === id), override || {});
const pick = (got, want) => { for (const [k, v] of Object.entries(want)) assert.deepStrictEqual(got[k], v, k); };

test('fixed fee: every phase rule', () => {
  for (const c of fixed.lines) {
    try { pick(F.phaseLine(phase(c.phase, c.phaseOverride), c.entry), c.expect); }
    catch (e) { e.message = c.name + ': ' + e.message; throw e; }
  }
});

test('fixed fee: a whole project, and a blank phase makes the total unknown', () => {
  for (const c of fixed.evaluate) {
    const entries = Object.fromEntries(Object.entries(c.entries).map(([k, v]) => [k, { amountCents: v.amountCents }]));
    pick(F.evaluate(fixed.phases, entries), c.expect);
  }
});

test('fixed fee: the three top buttons', () => {
  for (const c of fixed.quick) {
    const phases = fixed.phases.map(p => Object.assign({}, p, (c.phaseOverrides || {})[p.id]));
    const got = F.quickAction(phases, c.action);
    assert.deepStrictEqual(Object.fromEntries(Object.entries(got.entries).map(([k, v]) => [k, v.amountCents])), c.expect.entries, c.name);
    assert.strictEqual(got.noBilling, c.expect.noBilling, c.name);
  }
});

test('fixed fee: a positive amount clears No billing; zero does not', () => {
  for (const c of fixed.edits) {
    const got = F.applyEdit({ phases: fixed.phases, entries: {}, noBilling: c.noBilling }, c.phaseId, c.entry);
    assert.strictEqual(got.noBilling, c.expectNoBilling, c.name);
    assert.deepStrictEqual(got.entries[c.phaseId], c.entry);
  }
});

test('the amount and percent modes agree: typing a percent then reading the amount gives the same target as typing that amount', () => {
  const dd = phase('dd');
  const byPct = F.phaseLine(dd, { pctBp: 7944 });
  const byAmount = F.phaseLine(dd, { amountCents: byPct.amountCents });
  assert.strictEqual(byAmount.targetCents, byPct.targetCents);
});

const hEntries = e => Object.fromEntries(Object.entries(e).map(([k, v]) => [k, { amountCents: v }]));
test('hourly: lines, availability and the authorization', () => {
  for (const c of hourly.evaluate) {
    try { pick(H.evaluate(c.project || hourly.project, hourly.lines, hEntries(c.entries)), c.expect); }
    catch (e) { e.message = c.name + ': ' + e.message; throw e; }
  }
});
test('hourly: quick actions', () => {
  for (const c of hourly.quick) {
    const got = H.quickAction(hourly.lines, c.action);
    assert.deepStrictEqual(Object.fromEntries(Object.entries(got.entries).map(([k, v]) => [k, v.amountCents])), c.expect.entries, c.action);
    assert.strictEqual(got.noBilling, c.expect.noBilling, c.action);
  }
});
