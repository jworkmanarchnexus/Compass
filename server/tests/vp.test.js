'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { assertReadOnlySql, assertApprovedTable } = require('../vp/policy');
const { scrub } = require('../vp/redact');
const { open, connectionString } = require('../vp/connection');
const { runChecks } = require('../vp/check');
const { loadConfig, parseEnvFile } = require('../vp/config');

const cfg = { ...loadConfig({}, '/nonexistent'), dsn: 'VantagePoint', user: 'acct.user', password: 'S3cret;pw}', rowLimit: 3 };

/* fake ODBC driver: answers by pattern, never touches a network */
function fakeDriver({ write = false, failConnect = null } = {}) {
  return {
    async connect() {
      if (failConnect) throw failConnect;
      return {
        async query(sql, _p, opt) {
          if (/WAITFOR/.test(sql)) { const e = new Error('timeout'); e.odbcErrors = [{ state: 'HYT00', message: 'Query timeout expired' }]; throw e; }
          if (/__no_such_table__/.test(sql)) { const e = new Error('x'); e.odbcErrors = [{ state: '42S02', message: `Invalid object name for user acct.user pwd S3cret;pw} balance $1,234.50` }]; throw e; }
          if (/VALUES \(1\)/.test(sql)) return [1, 2, 3, 4, 5].map(n => ({ n }));
          if (/DB_NAME\(\) AS db/.test(sql) && !/HAS_PERMS/.test(sql)) return [{ db: 'VP' }];
          if (/AS can_read/.test(sql)) return [{ can_read: 1 }];
          if (/COUNT_BIG/.test(sql)) return [{ n: 42n }];
          if (/IS_SRVROLEMEMBER/.test(sql)) return [{ i: write ? 1 : 0, u: 0, d: 0, a: 0, c: 0, x: 0, owner: 0, writer: 0, sa: 0 }];
          if (/ProductMajorVersion/.test(sql)) return [{ major: 15 }];
          if (/dm_exec_connections/.test(sql)) return [{ e: 'TRUE' }];
          throw new Error('unexpected sql in fake: ' + sql);
        },
        async close() {},
      };
    },
  };
}

test('policy: plain SELECTs pass, everything else is refused', () => {
  assertReadOnlySql('SELECT COUNT_BIG(*) FROM dbo.PR');
  assertReadOnlySql("WITH a AS (SELECT 1 AS x) SELECT x FROM a WHERE 'DROP' = 'DROP';");
  for (const bad of ['DELETE FROM dbo.PR', 'SELECT 1; SELECT 2', 'SELECT * INTO t FROM dbo.PR', 'EXEC sp_who', 'SELECT 1 -- hi', 'UPDATE dbo.PR SET Name=1', "SELECT 1 WHERE 1=1; DROP TABLE x", 'SELECT * FROM OPENROWSET(1)', 'WAITFOR DELAY \'00:10:00\''])
    assert.throws(() => assertReadOnlySql(bad), /policy/, bad);
});

test('policy: only approved tables', () => {
  assert.strictEqual(assertApprovedTable('dbo.pr', cfg), 'PR');
  assert.throws(() => assertApprovedTable('UserTable; DROP', cfg), /approved/);
  assert.throws(() => assertApprovedTable('BIED', cfg), /approved/);
});

test('scrub removes credentials, amounts and long numbers', () => {
  const s = scrub('login acct.user pwd S3cret;pw} PWD=abc; $1,234.50 and 99,000 and 12.34', cfg);
  for (const leak of ['acct.user', 'S3cret', 'abc', '1,234', '99,000', '12.34']) assert.ok(!s.includes(leak), leak);
});

test('connection string braces the password and escapes closing braces', () => {
  assert.strictEqual(connectionString(cfg), 'DSN=VantagePoint;UID={acct.user};PWD={S3cret;pw}}};');
});

test('config: env file parsing, defaults, no secrets required to load', () => {
  assert.deepStrictEqual(parseEnvFile('# c\nVP_DSN=A\nVP_USER = "u"\n'), { VP_DSN: 'A', VP_USER: 'u' });
  const d = loadConfig({}, '/nonexistent');
  assert.strictEqual(d.rowLimit, 200); assert.strictEqual(d.queryTimeoutSeconds, 30);
});

test('query caps rows and flags truncation; errors are scrubbed', async () => {
  const vp = await open(cfg, fakeDriver());
  const r = await vp.query('SELECT n FROM (VALUES (1),(2),(3),(4),(5)) AS v(n)');
  assert.strictEqual(r.rows.length, 3); assert.strictEqual(r.truncated, true);
  await assert.rejects(() => vp.query('SELECT * FROM dbo.__no_such_table__'), e => {
    for (const leak of ['acct.user', 'S3cret', '1,234']) assert.ok(!e.message.includes(leak), leak);
    return e.state === '42S02';
  });
  await assert.rejects(() => vp.query('DELETE FROM dbo.PR'), /policy/);
  await vp.close();
});

test('check: read-only account passes every test', async () => {
  const res = await runChecks(cfg, fakeDriver());
  assert.deepStrictEqual(res.filter(r => r.status !== 'pass'), []);
  assert.ok(res.length >= 9);
  assert.ok(!JSON.stringify(res).includes('S3cret'));
});

test('check: an account with write rights fails the write test', async () => {
  const res = await runChecks(cfg, fakeDriver({ write: true }));
  const w = res.find(r => r.name === 'Account cannot write');
  assert.strictEqual(w.status, 'FAIL'); assert.match(w.detail, /insert/);
});

test('check: refused sign-in vs unreachable server are told apart; missing settings explained', async () => {
  const auth = Object.assign(new Error('x'), { odbcErrors: [{ state: '28000', message: 'Login failed for user acct.user' }] });
  let res = await runChecks(cfg, fakeDriver({ failConnect: auth }));
  assert.deepStrictEqual(res.map(r => r.status), ['pass', 'pass', 'FAIL']);
  assert.ok(!JSON.stringify(res).includes('acct.user'));
  const net = Object.assign(new Error('x'), { odbcErrors: [{ state: '08001', message: 'cannot reach' }] });
  res = await runChecks(cfg, fakeDriver({ failConnect: net }));
  assert.deepStrictEqual(res.map(r => r.status), ['pass', 'FAIL', 'skipped']);
  res = await runChecks({ ...cfg, password: '' }, fakeDriver());
  assert.match(res[0].detail, /VP_PASSWORD/);
});
