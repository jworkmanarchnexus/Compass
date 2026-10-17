'use strict';
/* The one place that talks to Vantagepoint. Uses the Windows ODBC data source named in VP_DSN (same one DBeaver uses).
   Every query passes the policy, has a timeout and a row cap, and every error is scrubbed before it leaves this file. */
const { assertReadOnlySql } = require('./policy');
const { describeError } = require('./redact');

const braced = v => '{' + String(v).replace(/}/g, '}}') + '}';

function connectionString(cfg) {
  const parts = [`DSN=${cfg.dsn}`, `UID=${braced(cfg.user)}`, `PWD=${braced(cfg.password)}`];
  if (cfg.database) parts.push(`DATABASE=${cfg.database}`);
  return parts.join(';') + ';';
}

class VpError extends Error {
  constructor(info) { super(`${info.state}: ${info.message}`); this.state = info.state; this.info = info; }
}

/* open(cfg, driver?) -> { query(sql, opts) -> { rows, truncated }, close() }   driver is injectable for tests */
async function open(cfg, driver = require('odbc')) {
  let conn;
  try {
    conn = await driver.connect({ connectionString: connectionString(cfg), connectionTimeout: cfg.connectTimeoutSeconds, loginTimeout: cfg.connectTimeoutSeconds });
  } catch (e) { throw new VpError(describeError(e, cfg)); }
  return {
    async query(sql, { timeoutSeconds = cfg.queryTimeoutSeconds, rowLimit = cfg.rowLimit } = {}) {
      const text = assertReadOnlySql(sql);
      try {
        const res = await conn.query(text, [], { timeout: timeoutSeconds });
        const all = Array.from(res);
        return { rows: all.slice(0, rowLimit).map(r => ({ ...r })), truncated: all.length > rowLimit };
      } catch (e) { throw new VpError(describeError(e, cfg)); }
    },
    async close() { try { await conn.close(); } catch { /* ignore */ } },
  };
}

module.exports = { open, connectionString, VpError };
