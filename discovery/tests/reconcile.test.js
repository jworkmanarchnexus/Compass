'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const Dec = require('../lib/decimal');
const rec = require('../reconcile');
const metrics = require('../metrics');
const inv = require('../investigations');
const agent = require('../agent');
const refs = require('../reference-library');
const approvals = require('../approvals');
const pipeline = require('../pipeline');
const { freshContext, xlsx } = require('./helpers');

const D = Dec.parse;
const row = (project, pic, sector, amount) => ({ project, pic, sector, amount: D(amount) });
const LEVELS = [{ name: 'firm', dims: [] }, { name: 'pic', dims: ['pic'] }, { name: 'sector', dims: ['sector'] }, { name: 'project', dims: ['project'], naturalGrain: true }];

const base = [row('P1', 'Ann', 'EDU', '1000.00'), row('P2', 'Ann', 'HEALTH', '500.50'), row('P3', 'Bob', 'EDU', '250.25')];

test('reconcile: identical datasets pass every level', () => {
  const r = rec.reconcile({ reference: base, candidate: base.map(x => ({ ...x })), levels: LEVELS });
  assert.strictEqual(r.reconciled, true);
  assert.deepStrictEqual(r.unmetLevels, []);
});

test('reconcile: a deliberately introduced mismatch is caught and located', () => {
  const cand = base.map(x => ({ ...x })); cand[1].amount = D('500.60');
  const r = rec.reconcile({ reference: base, candidate: cand, levels: LEVELS });
  assert.strictEqual(r.reconciled, false);
  assert.deepStrictEqual(r.unmetLevels.sort(), ['firm', 'pic', 'project', 'sector']);
  const e = r.results.project.exceptions[0];
  assert.strictEqual(e.fields.project, 'P2'); assert.strictEqual(e.cls, 'under-0.1%');
});

test('reconcile: matching firm total hides wrong allocations, and is not enough', () => {
  const cand = [row('P1', 'Ann', 'EDU', '1250.25'), row('P2', 'Ann', 'HEALTH', '500.50'), row('P3', 'Bob', 'EDU', '0.00')]; // 250.25 moved from Bob to Ann
  const r = rec.reconcile({ reference: base, candidate: cand, levels: LEVELS });
  assert.strictEqual(r.results.firm.status, 'pass');
  assert.strictEqual(r.results.pic.status, 'FAIL');
  assert.strictEqual(r.reconciled, false);
});

test('reconcile: offsetting errors inside a sector are caught at PIC x sector', () => {
  const ref = [row('P1', 'Ann', 'EDU', '100'), row('P2', 'Bob', 'EDU', '100')];
  const cand = [row('P1', 'Ann', 'EDU', '110'), row('P2', 'Bob', 'EDU', '90')];
  const r = rec.reconcile({ reference: ref, candidate: cand, levels: [{ name: 'sector', dims: ['sector'] }, { name: 'pic x sector', dims: ['pic', 'sector'] }] });
  assert.strictEqual(r.results.sector.status, 'pass'); assert.strictEqual(r['results']['pic x sector'].status, 'FAIL');
});

test('reconcile: missing, unexpected and duplicate records, double counting and sign errors are named', () => {
  const cand = [row('P1', 'Ann', 'EDU', '2000.00'), row('P1', 'Ann', 'EDU', '0.00'), row('P2', 'Ann', 'HEALTH', '-500.50'), row('P9', 'Zed', 'EDU', '5')];
  const r = rec.reconcile({ reference: base, candidate: cand, levels: LEVELS, naturalKey: ['project'] });
  const p = r.results.project;
  assert.strictEqual(p.counts.missingInCandidate, 1); assert.strictEqual(p.counts.unexpectedInCandidate, 1);
  assert.strictEqual(p.counts.duplicateCandidateKeys, 1);
  const hints = Object.fromEntries(p.exceptions.filter(e => e.type === 'variance').map(e => [e.fields.project, e.hints]));
  assert.ok(hints.P1.includes('double-counted')); assert.ok(hints.P2.includes('sign-flipped'));
  assert.strictEqual(r.candidateDuplicateNaturalKeys, 1);
  assert.strictEqual(r.reconciled, false);
});

test('reconcile: a zero in the reference with no candidate records agrees; direction of a variance is reported', () => {
  const ref = [row('P1', 'Ann', 'EDU', '100'), row('P2', 'Zed', 'EDU', '0.00')];
  const r = rec.reconcileLevel(ref, [row('P1', 'Ann', 'EDU', '100')], ['pic']);
  assert.strictEqual(r.status, 'pass'); assert.strictEqual(r.counts.zeroOnBothSides, 1); assert.strictEqual(r.counts.missingInCandidate, 0);
  const v = rec.reconcileLevel([row('P1', 'Ann', 'EDU', '100')], [row('P1', 'Ann', 'EDU', '90')], ['pic']);
  assert.strictEqual(v.exceptions[0].direction, 'candidate-lower');
  assert.ok(!v.exceptions[0].hints.includes('more-source-rows-than-reference'));
  assert.strictEqual(rec.reconcileLevel([row('P1', 'Ann', 'EDU', '100')], [row('P1', 'Ann', 'EDU', '100'), row('P9', 'Yan', 'EDU', '0')], ['pic']).status, 'pass', 'an unexpected group of zero is harmless');
});

test('reconcile: tolerance is explicit; small differences cannot accumulate unnoticed', () => {
  const tol = { absolute: D('0.01'), cumulative: D('0.05') };
  const ref = Array.from({ length: 10 }, (_, i) => row('P' + i, 'A', 'S', '100.00'));
  const off = ref.map(x => ({ ...x, amount: x.amount + D('0.01') })); // each within tolerance, together 0.10
  const r = rec.reconcileLevel(ref, off, ['project'], { tolerance: tol });
  assert.strictEqual(r.counts.withinTolerance, 10); assert.strictEqual(r.toleranceAccumulated, true); assert.strictEqual(r.status, 'FAIL');
  const ok = rec.reconcileLevel(ref, ref.slice(0, 10).map((x, i) => ({ ...x, amount: i < 3 ? x.amount + D('0.01') : x.amount })), ['project'], { tolerance: tol });
  assert.strictEqual(ok.status, 'pass');
  assert.strictEqual(rec.reconcileLevel(ref, ref, ['project'], { tolerance: { absolute: 0n, cumulative: 0n } }).status, 'pass');
});

test('reconcile: credits, zero reference and the sanitized view hide real keys and amounts', () => {
  const ref = [row('P1', 'Ann', 'EDU', '-300.00'), row('P2', 'Ann', 'EDU', '0.00')];
  const cand = [row('P1', 'Ann', 'EDU', '-300.00'), row('P2', 'Ann', 'EDU', '12.00')];
  const r = rec.reconcile({ reference: ref, candidate: cand, levels: [{ name: 'project', dims: ['project'], naturalGrain: true }] });
  assert.strictEqual(r.results.project.exceptions[0].cls, 'reference-zero');
  const c = freshContext();
  try {
    const s = rec.sanitize(r, c.gateway);
    const text = JSON.stringify(c.gateway.release(s));
    assert.ok(!/P1|P2|Ann|12\.00|300/.test(text));
    assert.match(text, /PRO-[0-9a-f]{8}/);
  } finally { c.close(); }
});

test('metric: whole-project consultant ratio, computed per project then rolled up', () => {
  const proj = (project, gross, fee, consultFee, reimbAllow = null) => ({ project, pic: 'Ann', sector: 'EDU', gross: D(gross), fee: D(fee), consultFee: consultFee === null ? null : D(consultFee), reimbAllow: reimbAllow === null ? null : D(reimbAllow) });
  const r = metrics.architecturalRevenue([proj('A', '1000', '600', '200')], { contractFee: 'fee+consult' }); // ratio 200/800
  assert.strictEqual(Dec.toString(r.rows[0].amount), '750.00'); assert.strictEqual(Dec.toString(r.rows[0].consultant), '250.00');
  // the same ratio applies to revenue from every phase: two revenue slices of one project give the same total as one slice
  const split = metrics.architecturalRevenue([proj('A', '400', '600', '200'), proj('B', '600', '600', '200')], { contractFee: 'fee+consult' });
  assert.strictEqual(Dec.toString(split.rows[0].amount + split.rows[1].amount), '750.00');
  const withReimb = metrics.architecturalRevenue([proj('A', '1000', '600', '200', '200')]); // default definition includes ReimbAllow
  assert.strictEqual(Dec.toString(withReimb.rows[0].amount), '800.00');
  const credit = metrics.architecturalRevenue([proj('A', '-1000', '600', '200')], { contractFee: 'fee+consult' });
  assert.strictEqual(Dec.toString(credit.rows[0].amount), '-750.00');
});

test('metric: zero or missing fees, bad ratios and repeated projects are explicit exceptions, never silent', () => {
  const p = (project, o = {}) => ({ project, pic: 'Ann', sector: 'EDU', gross: D('100'), fee: D('0'), consultFee: D('0'), reimbAllow: null, totalContractValue: null, ...o });
  const r = metrics.architecturalRevenue([p('Z'), p('N', { fee: null }), p('G', { gross: null }), p('D'), p('D')], { contractFee: 'fee+consult' });
  const types = r.exceptions.map(e => `${e.project}:${e.type}`).sort();
  assert.deepStrictEqual(types, ['D:duplicate-project-row', 'D:zero-contract-fee', 'G:missing-gross', 'N:missing-fee-field', 'Z:zero-contract-fee']);
  const bad = metrics.architecturalRevenue([p('R', { fee: D('50'), consultFee: D('80') })], { contractFee: 'fee' });
  assert.strictEqual(bad.exceptions[0].type, 'ratio-out-of-range', 'consultant fee above the contract fee is flagged');
  assert.strictEqual(r.rows.find(x => x.project === 'Z').amount, D('100'), 'zero-fee revenue kept whole and flagged');
  assert.strictEqual(metrics.architecturalRevenue([p('Z')], { contractFee: 'fee+consult', onZeroFee: 'exclude' }).rows.length, 0);
  assert.throws(() => metrics.architecturalRevenue([], { contractFee: 'guess' }), /unknown/);
});

test('metric registry: reconciled only with evidence, approval only after that, versions kept', () => {
  const c = freshContext();
  try {
    const v1 = metrics.save(c.store, metrics.WHOLE_PROJECT_CONSULTANT_RATIO);
    assert.strictEqual(metrics.get(c.store, metrics.WHOLE_PROJECT_CONSULTANT_RATIO.name).status, 'draft');
    assert.throws(() => metrics.markReconciled(c.store, metrics.WHOLE_PROJECT_CONSULTANT_RATIO.name, v1, { reconciled: false }), /without a passing/);
    assert.throws(() => metrics.approve(c.store, metrics.WHOLE_PROJECT_CONSULTANT_RATIO.name, v1), /only a reconciled/);
    metrics.markReconciled(c.store, metrics.WHOLE_PROJECT_CONSULTANT_RATIO.name, v1, { reconciled: true, requiredLevels: ['firm'], referenceId: 'REF-1', referenceChecksum: 'abc' });
    metrics.approve(c.store, metrics.WHOLE_PROJECT_CONSULTANT_RATIO.name, v1);
    const m = metrics.get(c.store, metrics.WHOLE_PROJECT_CONSULTANT_RATIO.name);
    assert.strictEqual(m.status, 'approved'); assert.strictEqual(m.definition.validationEvidence.referenceChecksum, 'abc');
    assert.strictEqual(metrics.save(c.store, metrics.WHOLE_PROJECT_CONSULTANT_RATIO), 2);
  } finally { c.close(); }
});

test('investigations: persist across a restart; failure to reproduce differs from a diagnostic that could not run', () => {
  const c = freshContext();
  const id = inv.create(c.store, { title: 'BD revenue', requirement: 'reproduce office earnings' });
  inv.note(c.store, id, { kind: 'hypothesis', subject: 'LedgerAR IN', body: {} });
  inv.note(c.store, id, { kind: 'hypothesis', subject: 'billInvSums I', body: {} });
  inv.note(c.store, id, { kind: 'test', status: 'error', subject: 'LedgerAR IN', body: { stage: 'fetch' } });
  inv.note(c.store, id, { kind: 'test', status: 'fail', subject: 'LedgerAR IN', body: {} });
  inv.note(c.store, id, { kind: 'test', status: 'pass', subject: 'billInvSums I', body: {} });
  inv.note(c.store, id, { kind: 'rejected', subject: 'LedgerAR IN', body: {} });
  assert.throws(() => inv.note(c.store, id, { kind: 'test', status: 'maybe', body: {} }), /status/);
  const dir = c.dir; c.store.close();
  const { openStore } = require('../store');
  const again = openStore(dir);
  try {
    const s = inv.resume(again, id);
    assert.strictEqual(s.testsExecuted, 3); assert.strictEqual(s.testsFailedToReproduce, 1); assert.strictEqual(s.testsCouldNotRun, 1); assert.strictEqual(s.testsPassed, 1);
    assert.deepStrictEqual(s.openHypotheses, ['billInvSums I']); assert.deepStrictEqual(s.rejected, ['LedgerAR IN']);
    assert.strictEqual(s.reconciliation, 'not run'); assert.strictEqual(s.readyForImplementation, false);
    assert.match(s.nextStep, /reconcile/);
    inv.note(again, id, { kind: 'reconciliation', body: { reconciled: true, requiredLevels: ['a'], unmetLevels: [] } });
    assert.strictEqual(inv.status(again, id).readyForImplementation, true);
  } finally { again.close(); require('../tests/helpers').rm(dir); }
});

test('prior findings: imported once, searchable, failed sources stay failed', () => {
  const c = freshContext();
  try {
    const f = path.join(__dirname, '..', 'knowledge', 'prior-findings.json');
    assert.ok(inv.seedPriorFindings(c.store, f).imported > 10);
    assert.strictEqual(inv.seedPriorFindings(c.store, f).skipped, true);
    const hits = inv.knowledgeSearch(c.store, 'summary table current');
    assert.ok(hits.some(h => /PRSummary/.test(h.ref) && h.status === 'failed'));
    const reg = require('../registry');
    assert.strictEqual(reg.evidenceFor(c.store, 'LedgerAR').reconciled, 'failed');
    assert.strictEqual(reg.evidenceFor(c.store, 'PR', 'Revenue').authoritative, 'provisional', 'PR.Revenue is not assumed authoritative');
    assert.ok(!JSON.stringify(c.store.knowledge.prepare('SELECT * FROM findings').all()).match(/1234567|7654321|8765432/), 'no preliminary dollar totals stored');
  } finally { c.close(); }
});

test('pipeline end to end on synthetic data: reconciles, refuses unconfirmed references, records the outcome', async () => {
  const c = freshContext();
  try {
    const ctx = { store: c.store, gateway: c.gateway, cfg: c.cfg, vp: null };
    metrics.save(c.store, metrics.WHOLE_PROJECT_CONSULTANT_RATIO);
    // reference laid out as a VP export: headers, rows, a total row
    const f = path.join(c.dir, 'earnings.xlsx');
    const head = ['Estimate Overhead', null, 'Total\nBilled', null, 'Direct\nConsultant', 'Architectural\nRevenue', 'Consultants\n%'];
    const filler = [[], [], [], [], [], [], []];
    xlsx(f, {
      R_P: [...filler, head, ['Principal Name:'], ['YTD', null, 1750, null, 375, 1375, 0.2142857142857143], ['Principal Name: Ann', null, 1500, null, 375, 1125, 0.25], ['Principal Name: Bob', null, 250, null, 0, 250, 0], ['Final Totals', null, 1750, null, 375, 1375, 0.2142857142857143]],
      R_M: [...filler, head, ['Project Type:'], ['Project Type: EDU', null, 1250, null, 250, 1000, 0.2], ['Project Type: HEALTH', null, 500, null, 125, 375, 0.25], ['Final Totals', null, 1750, null, 375, 1375, 0.2142857142857143]],
    });
    const ref = refs.register(c.store, f, { name: 'Office Earnings', kind: 'primary-vp-export' });
    // what a reviewed statement returns (decimals as strings, like the ODBC driver)
    const rows = [
      { project: 'P1', pic: 'Ann', sector: 'EDU', gross: '1000.00', fee: '600', consult_fee: '200', reimb_allow: null, total_contract_value: null },
      { project: 'P2', pic: 'Ann', sector: 'HEALTH', gross: '500.00', fee: '300', consult_fee: '100', reimb_allow: null, total_contract_value: null },
      { project: 'P3', pic: 'Bob', sector: 'EDU', gross: '250.00', fee: '300', consult_fee: '0', reimb_allow: null, total_contract_value: null },
    ];
    ctx.vp = { async query(s) { assert.match(s, /BETWEEN 202601 AND 202608/); return { rows, truncated: false }; } };
    const invId = inv.create(c.store, { title: 'BD', requirement: 'r' });
    const apId = pipeline.requestCandidateApproval(c.store, 'ledgerar-in-ytd', { period: '202608' }, invId);
    const run = parameters => agent.runSpec(ctx, { specId: 'bd-office-earnings', candidateId: 'ledgerar-in-ytd', period: '202608', refId: ref.id, approvalId: apId, investigationId: invId, parameters });

    await assert.rejects(run({}), /confirmed first/);
    refs.confirm(c.store, ref.id, { period: '202608', cutoff: '2026-08-12' });
    await assert.rejects(run({}), /not approved/);
    approvals.decide(c.store, apId, true);

    // wrong denominator: the reconciliation fails at the architectural levels, and says so without any amounts
    const wrong = await run({ contractFee: 'fee' });
    assert.strictEqual(wrong.reconciled, false);
    assert.strictEqual(wrong.comparisons['gross-by-pic'].levels['gross by PIC'].status, 'pass', 'gross is fine; the ratio is what is wrong');
    assert.strictEqual(wrong.comparisons['arch-by-pic'].levels['architectural by PIC'].status, 'FAIL');
    assert.strictEqual(metrics.get(c.store, metrics.WHOLE_PROJECT_CONSULTANT_RATIO.name).status, 'draft', 'a failed run never promotes a metric');
    assert.strictEqual(inv.status(c.store, invId).testsFailedToReproduce, 1);

    // the owner's definition reproduces the reference at every level
    const good = await run({ contractFee: 'fee+consult' });
    assert.strictEqual(good.reconciled, true, JSON.stringify(good.unmetLevels));
    assert.deepStrictEqual(good.candidateExceptions, []);
    const m = metrics.get(c.store, metrics.WHOLE_PROJECT_CONSULTANT_RATIO.name);
    assert.strictEqual(m.status, 'reconciled'); assert.ok(m.definition.validationEvidence.referenceChecksum);
    assert.strictEqual(inv.status(c.store, invId).readyForImplementation, true);

    // nothing sensitive in what would be returned to Claude, or in the AI-facing knowledge store
    const text = JSON.stringify(c.gateway.release(good)) + JSON.stringify(c.store.knowledge.prepare('SELECT body FROM findings').all());
    assert.ok(!/Ann|Bob|P1|P2|P3|1125|1375/.test(text), 'no names, projects or amounts');
    assert.ok(c.store.raw.prepare('SELECT COUNT(*) AS n FROM recon_detail').get().n > 0, 'detail is kept in the protected store');
    // a different period than the reference's is refused
    await assert.rejects(agent.runSpec(ctx, { specId: 'bd-office-earnings', candidateId: 'ledgerar-in-ytd', period: '202607', refId: ref.id, approvalId: apId, investigationId: invId }), /period does not match/);
  } finally { c.close(); }
});
