'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Dec = require('../lib/decimal');
const registry = require('../registry');
const refs = require('../reference-library');
const { freshContext, xlsx } = require('./helpers');

test('decimal: exact arithmetic, no binary float drift', () => {
  assert.strictEqual(Dec.toString(Dec.parse('0.1') + Dec.parse('0.2')), '0.30');
  assert.strictEqual(Dec.parse('(1,234.50)'), Dec.parse('-1234.5'));
  assert.strictEqual(Dec.toString(Dec.parse('$1,234,567.89')), '1234567.89');
  assert.throws(() => Dec.parse('1.123456789'), /decimal places/);
  assert.throws(() => Dec.parse('abc'), /not a number/);
  assert.throws(() => Dec.parse(''), /empty/);
  assert.strictEqual(Dec.parse('1e2'), Dec.parse('100'));
});

test('decimal: ratio math rounds half to even and survives credits', () => {
  assert.strictEqual(Dec.toString(Dec.mulDiv(Dec.parse('1000'), 600n, 800n)), '750.00');
  assert.strictEqual(Dec.toString(Dec.mulDiv(Dec.parse('-1000'), 600n, 800n)), '-750.00');
  assert.strictEqual(Dec.toString(Dec.parse('0.125'), 2), '0.12'); // half to even
  assert.strictEqual(Dec.toString(Dec.parse('0.135'), 2), '0.14');
  assert.throws(() => Dec.mulDiv(1n, 1n, 0n), /zero/);
});

test('registry: finds fields by meaning, and an existing field is not an evidenced one', () => {
  const c = freshContext();
  try {
    const r = registry.search(c.store, 'recognized revenue by principal');
    const names = r.columns.map(x => `${x.table}.${x.column}`);
    assert.ok(names.includes('LedgerAR.Amount'), 'billed amount found via description');
    assert.ok(names.includes('PR.Revenue') && names.includes('PR.Principal'));
    const rev = r.columns.find(x => x.column === 'Revenue');
    assert.deepStrictEqual(rev.evidence, { exists: 'documented', populated: 'none', current: 'none', authoritative: 'none', reconciled: 'none' });
    registry.recordEvidence(c.store, { tbl: 'PR', col: 'Revenue', level: 'populated', status: 'verified', note: 'x' });
    registry.recordEvidence(c.store, { tbl: 'PR', col: 'Revenue', level: 'authoritative', status: 'provisional' });
    const e = registry.evidenceFor(c.store, 'PR', 'Revenue');
    assert.strictEqual(e.populated, 'verified'); assert.strictEqual(e.authoritative, 'provisional'); assert.strictEqual(e.reconciled, 'none');
    registry.recordEvidence(c.store, { tbl: 'PR', col: 'Revenue', level: 'populated', status: 'failed' });
    assert.strictEqual(registry.evidenceFor(c.store, 'PR', 'Revenue').populated, 'failed', 'a later failure overrides');
    assert.throws(() => registry.recordEvidence(c.store, { tbl: 'PR', level: 'sort-of', status: 'verified' }), /level/);
  } finally { c.close(); }
});

test('registry: names must exist in the dictionary; inferred joins are never "verified"', () => {
  const c = freshContext();
  try {
    assert.throws(() => registry.resolveColumn(c.store, 'PR', 'Fee; DROP TABLE x'), /not in the data dictionary/);
    assert.deepStrictEqual(registry.resolveColumn(c.store, 'pr', 'fee'), { table: 'PR', column: 'Fee' });
    registry.recordRelationship(c.store, { leftTable: 'LedgerAR', leftColumns: ['WBS1'], rightTable: 'PR', rightColumns: ['WBS1'], status: 'inferred' });
    assert.strictEqual(c.store.knowledge.prepare("SELECT COUNT(*) AS n FROM relationships WHERE status = 'verified'").get().n, 0);
    assert.throws(() => registry.recordRelationship(c.store, { leftTable: 'a', leftColumns: ['x'], rightTable: 'b', rightColumns: ['y'], status: 'probably' }), /status/);
  } finally { c.close(); }
});

test('reference import: original untouched, checksum, period never guessed from the file name', () => {
  const c = freshContext();
  try {
    const f = path.join(c.dir, 'Earnings 2026-08 final.xlsx');
    xlsx(f, { R_P: [['Principal', 'Billed Amount'], ['Pat Lee', 100.25], ['Total', { f: 'SUM(B2:B2)', v: '100.25' }]] });
    const before = fs.readFileSync(f);
    const r = refs.register(c.store, f, { name: 'Office Earnings', kind: 'primary-vp-export' });
    assert.strictEqual(r.status, 'needs-confirmation');
    const meta = JSON.parse(c.store.knowledge.prepare('SELECT meta FROM ref_reports WHERE id = ?').get(r.id).meta);
    assert.strictEqual(meta.period, null);
    assert.strictEqual(meta.periodSuggestion, '202608', 'suggested, not applied');
    assert.ok(meta.limitations.some(l => /period/i.test(l)));
    assert.deepStrictEqual(fs.readFileSync(f), before, 'source file unchanged');
    const kept = fs.readdirSync(path.join(c.dir, 'protected', 'originals'));
    assert.deepStrictEqual(fs.readFileSync(path.join(c.dir, 'protected', 'originals', kept[0])), before, 'stored original is byte-identical');
    refs.confirm(c.store, r.id, { period: '202608', cutoff: '2026-08-12' });
    assert.strictEqual(refs.list(c.store)[0].status, 'registered');
    assert.throws(() => refs.confirm(c.store, r.id, { period: 'Aug 2026', cutoff: 'x' }), /YYYYMM/);
  } finally { c.close(); }
});

test('reference import: versions, kinds, macros and links reported not run', () => {
  const c = freshContext();
  try {
    const a = path.join(c.dir, 'a.xlsx'), b = path.join(c.dir, 'b.xlsx');
    xlsx(a, { S: [['H1', 'H2'], ['x', 1]] }, { macros: true });
    xlsx(b, { S: [['H1', 'H2'], ['x', 2]] });
    const m = { name: 'Report', kind: 'primary-vp-export', period: '202608', cutoff: '2026-08-12' };
    const r1 = refs.register(c.store, a, m);
    assert.ok(r1.warnings.some(w => /macros/.test(w)));
    assert.strictEqual(refs.register(c.store, a, m).unchanged, true, 'same bytes: no new version');
    const r2 = refs.register(c.store, b, m);
    assert.strictEqual(r2.version, 2);
    assert.throws(() => refs.register(c.store, a, { ...m, kind: 'workbook' }), /kind/);
    assert.throws(() => refs.register(c.store, a, { ...m, name: 'x', period: '2026' }), /YYYYMM/);
    const down = refs.register(c.store, b, { ...m, name: 'Final workbook', kind: 'downstream-workbook' });
    assert.ok(refs.list(c.store).some(x => x.kind === 'downstream-workbook'));
    assert.ok(down.id);
  } finally { c.close(); }
});

test('workbook: hardcoded values, cached formulas and uncached formulas are told apart; no silent zero', () => {
  const c = freshContext();
  try {
    const f = path.join(c.dir, 'w.xlsx');
    xlsx(f, { S: [['Name', 'Amt'], ['a', 10.5], ['b', { f: 'A1*2', v: '21' }], ['c', { f: 'A1*3' }]] });
    const r = refs.register(c.store, f, { name: 'W', kind: 'downstream-workbook', period: '202608', cutoff: '2026-08-12' });
    const meta = JSON.parse(c.store.knowledge.prepare('SELECT meta FROM ref_reports WHERE id = ?').get(r.id).meta);
    assert.deepStrictEqual(meta.formulaStats.S, { value: 6, formula: 1, formulaNoCache: 1 });
    assert.ok(meta.warnings.some(w => /no stored result/.test(w)));
    const spec = { sheet: 'S', columns: { name: 'Name', amount: 'Amt' }, numeric: ['amount'] };
    assert.throws(() => refs.readDataset(c.store, r.id, spec), /refusing to treat it as zero/);
    const rows = refs.readDataset(c.store, r.id, { ...spec, allowMissing: true });
    assert.strictEqual(rows.length, 3);
    assert.strictEqual(rows[2].amount, null);
    assert.strictEqual(rows[0].amount, Dec.parse('10.5'));
    assert.strictEqual(rows[1].amount, Dec.parse('21'));
    assert.throws(() => refs.readDataset(c.store, r.id, { ...spec, columns: { amount: 'Nope' } }), /not found/);
  } finally { c.close(); }
});

test('csv reference import and precision', () => {
  const c = freshContext();
  try {
    const f = path.join(c.dir, 'r.csv');
    fs.writeFileSync(f, 'Principal,Billed Amount\nPat,"1,234.56"\nSam,-0.07\n');
    const r = refs.register(c.store, f, { name: 'CSV', kind: 'primary-vp-export', period: '202608', cutoff: '2026-08-12' });
    const rows = refs.readDataset(c.store, r.id, { sheet: 'csv', columns: { pic: 'Principal', amount: 'Billed Amount' }, numeric: ['amount'] });
    assert.strictEqual(rows[0].amount, Dec.parse('1234.56')); assert.strictEqual(rows[1].amount, Dec.parse('-0.07'));
  } finally { c.close(); }
});

test('acknowledged hand edit: owner supplies what VP produced, file untouched, flagged', () => {
  const c = freshContext();
  try {
    const f = path.join(c.dir, 'edit.xlsx');
    xlsx(f, { S: [['Label', 'Amt'], ['Civic', 10], ['Healthcare', { f: '40+5', v: '45' }]] });
    const before = fs.readFileSync(f);
    const r = refs.register(c.store, f, { name: 'E', kind: 'primary-vp-export', period: '202607', cutoff: '2026-07-31' });
    const spec = { sheet: 'S', columns: { name: 'Label', amount: 'Amt' }, numeric: ['amount'] };
    assert.strictEqual(refs.readDataset(c.store, r.id, spec)[1].amount, Dec.parse('45'));
    refs.acknowledgeEdit(c.store, r.id, { sheet: 'S', rowContains: 'health', column: 'Amt', value: '40', reason: 'hand-added 5' });
    const rows = refs.readDataset(c.store, r.id, spec);
    assert.strictEqual(rows[1].amount, Dec.parse('40')); assert.strictEqual(rows[1]._acknowledgedEdit, true); assert.strictEqual(rows[0]._acknowledgedEdit, undefined);
    assert.deepStrictEqual(fs.readFileSync(f), before);
    assert.throws(() => refs.acknowledgeEdit(c.store, r.id, { sheet: 'S', rowContains: 'x', column: 'Amt', value: 'abc' }), /not a number/);
  } finally { c.close(); }
});

test('earnings reader: summary and detail layouts, group totals vs project rows, firm line ignored', () => {
  const c = freshContext();
  try {
    const head = ['Estimate Overhead', null, 'Total\nBilled', null, 'Direct\nConsultant', 'Architectural\nRevenue', 'Consultants\n%'];
    const nums = (b, k) => ['YTD', null, b, null, k, b - k, 0];
    const detail = path.join(c.dir, 'detail.xlsx');
    xlsx(detail, { R_M: [[], head, ['Project Type: Civic'], ['Project Number: 0012345.00'], nums(100, 20), ['Project Number: 0012346.00'], nums(50, 0), ['Total for [blank]'], nums(150, 20),
      ['Project Type: Edu'], ['Project Number: 0012347.00'], nums(10, 5), ['Total for [blank]'], nums(10, 5), ['Final Totals'], nums(160, 25)] });
    const r = refs.register(c.store, detail, { name: 'D', kind: 'downstream-workbook', period: '202606', cutoff: '2026-06-30' });
    const e = refs.readEarnings(c.store, r.id, { sheet: 'R_M', groupPrefix: 'Project Type:' });
    assert.deepStrictEqual(e.groups.map(g => [g.name, g.billed]), [['Civic', Dec.parse('150')], ['Edu', Dec.parse('10')]], 'group totals only; the firm line after Final Totals is not a group');
    assert.deepStrictEqual(e.projects.map(p => [p.group, p.project, p.billed, p.arch]), [['Civic', '0012345.00', Dec.parse('100'), Dec.parse('80')], ['Civic', '0012346.00', Dec.parse('50'), Dec.parse('50')], ['Edu', '0012347.00', Dec.parse('10'), Dec.parse('5')]]);
    const summary = path.join(c.dir, 'summary.xlsx');
    xlsx(summary, { R_P: [[], head, ['Principal Name: Ann', null, 90, null, 30, 60, 0.33], ['Principal Name: Bob', null, 10, null, 0, 10, 0], ['Final Totals', null, 100, null, 30, 70, 0.3]] });
    const s = refs.register(c.store, summary, { name: 'S', kind: 'downstream-workbook', period: '202606', cutoff: '2026-06-30' });
    const e2 = refs.readEarnings(c.store, s.id, { sheet: 'R_P', groupPrefix: 'Principal Name:' });
    assert.deepStrictEqual(e2.groups.map(g => g.name), ['Ann', 'Bob']); assert.strictEqual(e2.projects.length, 0);
    assert.throws(() => refs.readEarnings(c.store, s.id, { sheet: 'R_P', groupPrefix: 'Principal Name:' }) && refs.readEarnings(c.store, r.id, { sheet: 'R_Z', groupPrefix: 'x' }), /./);
  } finally { c.close(); }
});
