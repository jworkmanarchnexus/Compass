'use strict';
/* Connection check: `npm run vp:check`. Only metadata, counts, and yes/no answers. No amounts are read or printed.
   Write protection is verified from the account's permissions, never by attempting a write.
   Result: a pass/fail list on screen and in vp-findings/connection-status.json (git-ignored). */
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig, missing, ROOT } = require('./config');
const { open } = require('./connection');
const { scrub } = require('./redact');

const ok = (name, detail = '') => ({ name, status: 'pass', detail });
const bad = (name, detail) => ({ name, status: 'FAIL', detail });
const skip = (name, detail) => ({ name, status: 'skipped', detail });

async function runChecks(cfg, driver) {
  const results = [];
  const gaps = missing(cfg);
  if (gaps.length) return [bad('Settings present', `missing ${gaps.join(', ')}; see .env.vp.example`)];
  results.push(ok('Settings present'));

  let vp;
  try { vp = await open(cfg, driver); }
  catch (e) {
    // SQLSTATE 28xxx = login refused; anything else (08xxx, IM002 no such DSN, HYT00 timeout) = could not reach/start
    const auth = /^28/.test(e.state);
    results.push(auth ? ok('SQL Server reachable', 'server answered') : bad('SQL Server reachable', e.message));
    results.push(auth ? bad('Sign-in accepted', e.message) : skip('Sign-in accepted', 'not reached'));
    return results;
  }
  results.push(ok('SQL Server reachable'), ok('Sign-in accepted'));
  const run = async (name, fn) => { try { results.push(await fn()); } catch (e) { results.push(bad(name, scrub(e.message, cfg))); } };

  try {
    await run('Database accessible', async () => {
      const { rows } = await vp.query('SELECT DB_NAME() AS db');
      return ok('Database accessible', `database "${scrub(rows[0].db, cfg)}"`);
    });

    await run('Approved tables readable', async () => {
      const lines = [];
      for (const t of cfg.approvedTables) {
        const { rows } = await vp.query(`SELECT HAS_PERMS_BY_NAME('dbo.${t}', 'OBJECT', 'SELECT') AS can_read`);
        if (rows[0].can_read !== 1 && rows[0].can_read !== 1n) throw new Error(`no SELECT on ${t}`);
        const { rows: c } = await vp.query(`SELECT COUNT_BIG(*) AS n FROM dbo.${t}`);
        lines.push(`${t}: ${Number(c[0].n)} rows`);
      }
      return ok('Approved tables readable', lines.join('; '));
    });

    await run('Account cannot write', async () => {
      const { rows } = await vp.query(`SELECT
        HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'INSERT') AS i, HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'UPDATE') AS u,
        HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'DELETE') AS d, HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'ALTER') AS a,
        HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'CREATE TABLE') AS c, HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'EXECUTE') AS x,
        IS_MEMBER('db_owner') AS owner, IS_MEMBER('db_datawriter') AS writer, IS_SRVROLEMEMBER('sysadmin') AS sa`);
      const flags = Object.entries(rows[0]).filter(([, v]) => Number(v) === 1).map(([k]) => k);
      const names = { i: 'insert', u: 'update', d: 'delete', a: 'alter', c: 'create table', x: 'execute', owner: 'db_owner', writer: 'db_datawriter', sa: 'sysadmin' };
      return flags.length ? bad('Account cannot write', 'account holds: ' + flags.map(f => names[f]).join(', ') + '. Ask for a read-only account.')
        : ok('Account cannot write', 'no write, alter, execute or admin rights found');
    });

    await run('Diagnostic queries run', async () => {
      const { rows } = await vp.query("SELECT CAST(SERVERPROPERTY('ProductMajorVersion') AS INT) AS major");
      let enc = 'encryption status not visible to this account';
      try {
        const e = await vp.query('SELECT encrypt_option AS e FROM sys.dm_exec_connections WHERE session_id = @@SPID');
        enc = e.rows[0] ? `connection encrypted: ${e.rows[0].e}` : enc;
      } catch { /* needs VIEW SERVER STATE; fine */ }
      return ok('Diagnostic queries run', `SQL Server major version ${rows[0].major}; ${enc}`);
    });

    await run('Row limit enforced', async () => {
      const { rows, truncated } = await vp.query('SELECT n FROM (VALUES (1),(2),(3),(4),(5)) AS v(n)', { rowLimit: 3 });
      return rows.length === 3 && truncated ? ok('Row limit enforced', '5 rows cut to 3') : bad('Row limit enforced', `got ${rows.length} rows, truncated=${truncated}`);
    });

    await run('Timeout enforced', async () => {
      const t0 = Date.now();
      try { await vp.query("WAITFOR DELAY '00:00:03'", { timeoutSeconds: 1 }); }
      catch { return Date.now() - t0 < 2800 ? ok('Timeout enforced', 'a 3-second wait was stopped at 1 second') : bad('Timeout enforced', 'stopped, but too late'); }
      return bad('Timeout enforced', 'a 3-second wait was not stopped');
    });

    await run('Errors and logs stay clean', async () => {
      let msg = '';
      try { await vp.query('SELECT * FROM dbo.__no_such_table__'); } catch (e) { msg = e.message; }
      const leaks = [cfg.password, cfg.user].filter(s => s && msg.includes(s));
      if (leaks.length) return bad('Errors and logs stay clean', 'an error message contained the sign-in details');
      if (/\$\s?\d|\d,\d{3}/.test(msg)) return bad('Errors and logs stay clean', 'an error message contained an amount');
      return ok('Errors and logs stay clean', 'sample database error carried no credentials or amounts');
    });
  } finally { await vp.close(); }
  return results;
}

function format(results) {
  return results.map(r => `${r.status === 'pass' ? '[ok]  ' : r.status === 'skipped' ? '[--]  ' : '[FAIL]'} ${r.name}${r.detail ? ': ' + r.detail : ''}`).join('\n');
}

async function main() {
  const cfg = loadConfig();
  const results = await runChecks(cfg);
  console.log(format(results));
  const dir = path.join(ROOT, 'vp-findings');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'connection-status.json'), JSON.stringify({ at: new Date().toISOString(), dsn: cfg.dsn, results }, null, 2));
  process.exitCode = results.some(r => r.status === 'FAIL') ? 1 : 0;
}

if (require.main === module) main().catch(e => { console.error(scrub(e.message, loadConfig())); process.exitCode = 1; });
module.exports = { runChecks, format };
