'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { PassThrough } = require('node:stream');
const { createOperations } = require('../operations');
const approvals = require('../approvals');
const { serve, tools } = require('../mcp-server');
const { createGateway } = require('../gateway');
const { assertReadOnlySql } = require('../../server/vp/policy');
const { freshContext, fakeVp } = require('./helpers');

const seed = db => {
  const pr = db.prepare('INSERT INTO dbo.PR VALUES (?,?,?,?,?,?,?)');
  for (let i = 1; i <= 8; i++) pr.run(`P${i}`, '', 1000 + i, i % 2 ? 100 : 0, null, 'E1', 'EDU');
  pr.run('P1', 'PH1', 500, 50, 9, 'E1', 'EDU'); // a phase row under P1
  const ar = db.prepare('INSERT INTO dbo.LedgerAR VALUES (?,?,?,?)');
  for (let i = 1; i <= 8; i++) ar.run(`P${i}`, 202601 + (i % 3), -(1234.56 * i), 'IN');
  ar.run('P1', 202607, 5.5, 'CR'); ar.run('Q9', 202608, 1, 'IN'); // Q9 has no project
};
const make = () => { const c = freshContext(); const vp = fakeVp(seed); return { c, vp, ops: createOperations({ store: c.store, gateway: c.gateway, cfg: c.cfg, vp, investigationId: 'I1' }) }; };

test('policy: prohibited statements never reach the database', () => {
  for (const sql of ['EXEC xp_cmdshell \'dir\'', 'SELECT * FROM OPENROWSET(\'x\')', 'DROP TABLE dbo.PR', 'SELECT 1; DELETE FROM dbo.PR', "SELECT * FROM dbo.PR WHERE 1=1; EXEC('x')", 'WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x', 'SELECT * INTO #t FROM dbo.PR', 'BULK INSERT x FROM \'f\'', 'SELECT 1 /* hidden */'])
    assert.throws(() => assertReadOnlySql(sql), /policy/, sql);
});

test('operations: counts, populations, periods, duplicates, join fan-out', async () => {
  const { c, vp, ops } = make();
  try {
    assert.deepStrictEqual(await ops.tablePopulation({ table: 'PR' }), { table: 'PR', rowCount: 9 });
    const col = await ops.columnPopulation({ table: 'PR', column: 'Revenue' });
    assert.strictEqual(col.nonNullCount, 1); assert.strictEqual(col.totalRows, 9);
    const fee = await ops.columnPopulation({ table: 'PR', column: 'ConsultFee' });
    assert.strictEqual(fee.nonzeroCount, 5, 'zero values are not counted as populated'); // 4 projects with 100, plus the phase row
    const per = await ops.periodCoverage({ table: 'LedgerAR', column: 'Period' });
    assert.strictEqual(per.minPeriod, 202601); assert.strictEqual(per.maxPeriod, 202608);
    await assert.rejects(ops.periodCoverage({ table: 'PR', column: 'Fee' }), /period column/);
    const dup = await ops.duplicateCheck({ table: 'PR', columns: ['WBS1'] });
    assert.strictEqual(dup.unique, false); assert.strictEqual(dup.duplicateKeys, '<5', 'small cells are suppressed');
    assert.strictEqual((await ops.duplicateCheck({ table: 'PR', columns: ['WBS1', 'WBS2'] })).unique, true);
    // joining ledger to PR on WBS1 alone multiplies P1 (parent + phase): the double count we must catch
    const j = await ops.joinCardinality({ leftTable: 'LedgerAR', leftColumns: ['WBS1'], rightTable: 'PR', rightColumns: ['WBS1'] });
    assert.strictEqual(j.fanOutRows, 2); assert.match(j.verdict, /multiplies/);
    assert.strictEqual(j.maxPerKey, 2);
    const j2 = await ops.joinCardinality({ leftTable: 'LedgerAR', leftColumns: ['WBS1', 'Period'], rightTable: 'LedgerAR', rightColumns: ['WBS1', 'Period'] });
    assert.ok(typeof j2.verdict === 'string');
  } finally { c.close(); }
});

test('operations: only dictionary names on the approved list; no value ever returned', async () => {
  const { c, vp, ops } = make();
  try {
    await assert.rejects(ops.tablePopulation({ table: 'Secret' }), /approved list/);
    await assert.rejects(ops.columnPopulation({ table: 'PR', column: 'Fee) FROM x; --' }), /not in the data dictionary/);
    await assert.rejects(ops.joinCardinality({ leftTable: 'PR', leftColumns: ['WBS1'], rightTable: 'PR', rightColumns: ['WBS1', 'WBS2'] }), /same length/);
    for (const out of [await ops.tablePopulation({ table: 'PR' }), await ops.columnPopulation({ table: 'LedgerAR', column: 'Amount' })]) {
      const text = JSON.stringify(out);
      assert.ok(!/1234|P1|E1/.test(text), 'no row values in output');
    }
    assert.ok(vp.calls.every(s => !/Secret/.test(s)));
  } finally { c.close(); }
});

test('operations: a failed query is a diagnostic failure with a scrubbed message', async () => {
  const c = freshContext();
  try {
    const vp = { async query() { throw Object.assign(new Error(`bad for ${c.cfg.user} with ${c.cfg.password} and $1,234.50`), { state: '42S02' }); } };
    const ops = createOperations({ store: c.store, gateway: c.gateway, cfg: c.cfg, vp, investigationId: 'I' });
    await assert.rejects(ops.tablePopulation({ table: 'PR' }), e => e.diagnosticFailed && !/tester|Secret9|1,234/.test(e.message));
  } finally { c.close(); }
});

test('gateway: raw financial numbers cannot cross, surrogates are keyed and stable', () => {
  const c = freshContext();
  try {
    const g = c.gateway;
    assert.throws(() => g.release({ rowCount: 12.5 }), /number refused/);
    assert.throws(() => g.release({ total: 1234567 }), /number refused/);
    assert.throws(() => g.release({ revenue: 5 }), /cannot carry a number/);
    assert.throws(() => g.release({ amount: 1 }), /cannot carry a number/);
    assert.throws(() => g.release({ status: '$1,234,567.89' }), /money-like/);
    assert.ok(!/19,249/.test(g.release({ note: 'saw $1,234,567.89' }).note), 'free text is scrubbed');
    assert.throws(() => g.release({ x: 10n }), /raw number/);
    assert.deepStrictEqual(g.release({ rowCount: 7, status: 'pass' }), { rowCount: 7, status: 'pass' });
    const a = g.surrogate('project', '2024-0150'), b = g.surrogate('project', '2024-0150');
    assert.strictEqual(a, b); assert.ok(!a.includes('2024') && !a.includes('0150'));
    assert.notStrictEqual(g.surrogate('pic', 'X'), g.surrogate('project', 'X'));
    // a second store has a different key: surrogates cannot be recomputed elsewhere
    const c2 = freshContext();
    try { assert.notStrictEqual(createGateway(c2.store).surrogate('project', '2024-0150'), a); } finally { c2.close(); }
    assert.strictEqual(g.cell(3), '<5'); assert.strictEqual(g.cell(0), 0); assert.strictEqual(g.cell(5), 5);
  } finally { c.close(); }
});

test('gateway: scrubs text on the way out and counts calls (differencing guard)', () => {
  const c = freshContext();
  try {
    const out = c.gateway.release({ description: `ran as ${c.cfg.user} pw ${c.cfg.password}` }, c.cfg);
    assert.ok(!/tester|Secret9/.test(out.description));
    const g = createGateway(c.store, { budget: 3 });
    for (let i = 0; i < 3; i++) g.spend('I', 'op', 'T.c');
    assert.throws(() => g.spend('I', 'op', 'T.c'), /budget/);
    g.spend('I', 'op', 'T.other'); // a different question is a different budget
  } finally { c.close(); }
});

test('extended mode: proposed SQL waits for the owner, is bound to its exact text, values release once', async () => {
  const { c, vp, ops } = make();
  try {
    const p = ops.proposeSql({ sql: 'SELECT WBS1, Fee FROM dbo.PR WHERE Fee > 1002', why: 'check fee spread' });
    assert.strictEqual(p.status, 'pending'); assert.deepStrictEqual(p.tables, ['PR']);
    await assert.rejects(ops.runApprovedSql({ approvalId: p.approvalId }), /not approved/);
    assert.throws(() => ops.proposeSql({ sql: 'DELETE FROM dbo.PR', why: 'x' }), /policy/);
    assert.strictEqual(ops.proposeSql({ sql: 'SELECT * FROM dbo.Nope', why: 'x' }).unknownTables[0], 'Nope');
    approvals.decide(c.store, p.approvalId, true);
    const shape = await ops.runApprovedSql({ approvalId: p.approvalId });
    assert.deepStrictEqual(Object.keys(shape).sort(), ['columns', 'rowCount', 'truncated']);
    assert.ok(!/100\d/.test(JSON.stringify(shape)), 'shape only: no values');
    // tampering with the stored SQL invalidates the approval
    c.store.knowledge.prepare('UPDATE approvals SET sql_text = ? WHERE id = ?').run('SELECT Fee FROM dbo.PR', p.approvalId);
    await assert.rejects(ops.runApprovedSql({ approvalId: p.approvalId }), /differs/);
    // an approval scoped to values: one use only
    const v = approvals.request(c.store, { kind: 'sql', description: 'show 2 rows', sql: 'SELECT WBS1 FROM dbo.PR', scope: { release: 'values', maxRows: 2 } });
    approvals.decide(c.store, v, true);
    const vals = await ops.runApprovedSql({ approvalId: v });
    assert.strictEqual(vals.rows.length, 2);
    await assert.rejects(ops.runApprovedSql({ approvalId: v }), /not approved/, 'already used');
    approvals.decide(c.store, approvals.request(c.store, { kind: 'sql', description: 'd', sql: 'SELECT 1', scope: {} }), false);
    assert.throws(() => approvals.decide(c.store, p.approvalId, true), /not a pending/);
  } finally { c.close(); }
});

/* drive the tool server over streams like a client would */
async function rpc(ctx, calls) {
  const input = new PassThrough(), output = new PassThrough();
  const rl = serve(ctx, input, output);
  const lines = []; output.on('data', d => String(d).split('\n').filter(Boolean).forEach(l => lines.push(JSON.parse(l))));
  calls.forEach((m, i) => input.write(JSON.stringify({ jsonrpc: '2.0', id: i + 1, ...m }) + '\n'));
  for (let i = 0; i < 100 && lines.length < calls.length; i++) await new Promise(r => setTimeout(r, 20));
  rl.close(); input.end();
  return lines.sort((a, b) => a.id - b.id);
}

test('tool server: no raw SQL, no approve, no values; errors scrubbed; works end to end', async () => {
  const { c, vp } = make();
  const ctx = { store: c.store, gateway: c.gateway, cfg: c.cfg, vp, operations: id => createOperations({ store: c.store, gateway: c.gateway, cfg: c.cfg, vp, investigationId: id }) };
  try {
    const names = Object.keys(tools);
    assert.ok(!names.some(n => /^(sql|query|execute|approve|decide|reverse|raw)/.test(n)), 'no dangerous tool names: ' + names);
    const res = await rpc(ctx, [
      { method: 'initialize', params: {} }, { method: 'tools/list' },
      { method: 'tools/call', params: { name: 'dictionary_search', arguments: { query: 'billed revenue' } } },
      { method: 'tools/call', params: { name: 'op_table_population', arguments: { table: 'PR' } } },
      { method: 'tools/call', params: { name: 'op_table_population', arguments: { table: 'Secret' } } },
      { method: 'tools/call', params: { name: 'propose_sql', arguments: { sql: 'SELECT Fee FROM dbo.PR', why: 'look' } } },
      { method: 'tools/call', params: { name: 'approve', arguments: {} } },
    ]);
    assert.strictEqual(res[0].result.serverInfo.name, 'compass-vp-discovery');
    assert.strictEqual(res[1].result.tools.length, names.length);
    assert.ok(JSON.parse(res[2].result.content[0].text).columns.length > 0);
    assert.deepStrictEqual(JSON.parse(res[3].result.content[0].text), { table: 'PR', rowCount: 9 });
    assert.strictEqual(res[4].result.isError, true); assert.match(res[4].result.content[0].text, /approved list/);
    assert.strictEqual(JSON.parse(res[5].result.content[0].text).status, 'pending');
    assert.ok(res[6].error, 'approve is not a tool');
  } finally { c.close(); }
});

test('stage names and category counts: configuration words and stage columns only, never name-like columns', async () => {
  const { DatabaseSync } = require('node:sqlite');
  const c = freshContext();
  try {
    const db = new DatabaseSync(':memory:'); db.exec("ATTACH ':memory:' AS dbo");
    db.exec("CREATE TABLE dbo.PR (WBS1 TEXT, Stage TEXT, Name TEXT); CREATE TABLE dbo.CFGProjectStageDescriptions (Code TEXT, Description TEXT);");
    db.exec("INSERT INTO dbo.PR VALUES ('A1','004','x'),('A2','004','y'),('A3','004','z'),('A4','004','w'),('A5','004','v'),('A6','010','u'),('A7',NULL,'t'); INSERT INTO dbo.CFGProjectStageDescriptions VALUES ('004','Awarded'),('010','Negotiation'),('004','Awarded');");
    const vp = { async query(sql, { rowLimit = 200 } = {}) { assertReadOnlySql(sql); const all = db.prepare(sql).all(); return { rows: all.slice(0, rowLimit).map(r => ({ ...r })), truncated: all.length > rowLimit }; }, async close() {} };
    c.store.knowledge.prepare("INSERT OR IGNORE INTO dict_columns (tbl, col, primary_key, domain, data_type, nullable, description) VALUES ('PR','Stage','','','nvarchar(10)','YES','Project stage code'), ('PR','Name','','','nvarchar(40)','YES','Project name')").run();
    const ops = createOperations({ store: c.store, gateway: c.gateway, cfg: c.cfg, vp, investigationId: 'I' });
    assert.deepStrictEqual((await ops.stageNames()).stages, [{ code: '004', description: 'Awarded' }, { code: '010', description: 'Negotiation' }]);
    const counts = await ops.codeCounts({ table: 'PR', column: 'Stage' });
    assert.deepStrictEqual(counts.codes, [{ code: '(null)', rowCount: '<5' }, { code: '004', rowCount: 5 }, { code: '010', rowCount: '<5' }], 'small groups are suppressed');
    await assert.rejects(ops.codeCounts({ table: 'PR', column: 'Name' }), /short code columns/);
  } finally { c.close(); }
});
