'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { pace, statusOf, computeBd } = require('../logic/report');
const fx = require('./fixtures/report.json');

test('pace is the goal times months over twelve, to the cent', () => {
  for (const c of fx.pace) assert.strictEqual(pace(c.goal, c.months), c.expect, c.why || String(c.goal));
});

test('status: on track, on pace, behind, or none', () => {
  for (const c of fx.status) assert.strictEqual(statusOf(c, { onPace: 99, onTrack: 100 }), c.expect, c.name);
});

test('the report: every column of every row, the roll-up and the unassigned revenue', () => {
  const out = computeBd(fx.report.input);
  const e = fx.report.expect;
  assert.strictEqual(out.months, e.months);
  const check = (got, want, label) => { for (const [k, v] of Object.entries(want)) assert.strictEqual(got[k], v, label + ': ' + k); };
  for (const [k, want] of Object.entries(e.pic)) check(out.pic.find(r => r.key === k), want, 'PIC ' + k);
  for (const [k, want] of Object.entries(e.sector)) check(out.sector.find(r => r.label === k), want, 'sector ' + k);
  check(out.firm, e.firm, 'firm');
  assert.deepStrictEqual(out.pic.map(r => r.key), e.picOrder);
  assert.deepStrictEqual(out.sector.map(r => r.label), e.sectorOrder);
  assert.deepStrictEqual(out.unassignedSector, e.unassignedSector);
  assert.deepStrictEqual(out.rolled, e.rolled);
});

test('the PICs add up to the firm, and so do the sectors (nothing is lost or counted twice)', () => {
  const out = computeBd(fx.report.input);
  for (const col of ['ytd', 'forecast', 'mwipRaw', 'mwip', 'total']) {
    assert.strictEqual(out.pic.reduce((s, r) => s + r[col], 0), out.firm[col], 'PICs ' + col);
    assert.strictEqual(out.sector.reduce((s, r) => s + r[col], 0), out.firm[col], 'sectors ' + col);
  }
});

test('revenue after the cutoff, or from last year, is not counted', () => {
  const out = computeBd(fx.report.input);
  assert.strictEqual(out.pic.find(r => r.key === 'E1').ytd, 180000000, 'P5 (Oct 2026 and Dec 2025) is left out');
});

test('the Admin assigning a sector moves the revenue, not the totals', () => {
  const input = Object.assign({}, fx.report.input, { overrides: fx.withOverride.override });
  const out = computeBd(input);
  assert.strictEqual(out.sector.find(r => r.label === 'Civic').ytd, fx.withOverride.expect.civicYtd);
  assert.strictEqual(out.sector.some(r => r.label === 'Unassigned'), fx.withOverride.expect.hasUnassigned);
  assert.strictEqual(out.firm.total, fx.withOverride.expect.firmTotal);
  assert.deepStrictEqual(out.unassignedSector, fx.withOverride.expect.unassignedSector);
});

test('a roll-up ends on its date: from 2027 Labs is not folded into Healthcare', () => {
  const input = Object.assign({}, fx.report.input, { period: 202703, revenue: [{ wbs1: 'P2', period: 202701, amount: 1000 }] , forecast: [], mwip: [] });
  const out = computeBd(input);
  assert.strictEqual(out.sector.find(r => r.label === 'Healthcare').ytd, 0, 'not rolled in');
  assert.strictEqual(out.sector.find(r => r.label === 'Labs').ytd, 1000, 'Labs is its own sector row now (still a known sector, with no goal yet)');
  assert.ok(!out.sector.some(r => r.label === 'Unassigned'));
  assert.deepStrictEqual(out.rolled, []);
});

test('the Admin\'s assignment is reported, and "put it in Other" sends unknown sectors there', () => {
  const a = computeBd(Object.assign({}, fx.report.input, { overrides: { P4: 'Civic' } }));
  assert.deepStrictEqual(a.assigned, [{ wbs1: 'P4', sector: 'Civic', amount: 342000 }]);
  const o = computeBd(Object.assign({}, fx.report.input, { sectors: fx.report.input.sectors.concat([{ name: 'Other' }]), goals: Object.assign({}, fx.report.input.goals, { sector: Object.assign({ Other: 0 }, fx.report.input.goals.sector), sectorOrder: ['Healthcare', 'Civic', 'Other'] }), unknownTo: 'Other' }));
  assert.strictEqual(o.sector.find(r => r.label === 'Other').ytd, 342000);
  assert.deepStrictEqual(o.unassignedSector, []);
  assert.deepStrictEqual(o.defaulted, [{ wbs1: 'P4', amount: 342000 }]);
});

test('a project with no PIC is reported as unassigned, not dropped', () => {
  const input = Object.assign({}, fx.report.input, { projects: Object.assign({}, fx.report.input.projects, { P3: { pic: '', sector: 'Civic' } }) });
  const out = computeBd(input);
  assert.strictEqual(out.pic.find(r => r.label === 'Unassigned').ytd, 90000000);
  assert.deepStrictEqual(out.unassignedPic.map(u => u.wbs1).sort(), ['P3']);
  assert.strictEqual(out.pic.reduce((s, r) => s + r.ytd, 0), out.firm.ytd);
});
