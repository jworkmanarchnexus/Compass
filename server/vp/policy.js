'use strict';
/* Execution policy. Claude never sends SQL. It names an operation (see operations.js) and the agent runs a
   fixed statement from this repo. This guard is a second lock: whatever statement is about to run must be a single,
   plain SELECT (or the exact internal diagnostic statements below). Read-only credentials are a third lock, not the first. */

const FORBIDDEN = /\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE|GRANT|REVOKE|DENY|INTO|OPENROWSET|OPENQUERY|OPENDATASOURCE|BULK|WAITFOR|SHUTDOWN|RECONFIGURE|BACKUP|RESTORE|KILL|USE|DBCC)\b|\bxp_\w+|\bsp_\w+/i;

// fixed statements the connection check needs that the general guard would refuse; matched exactly
const INTERNAL = new Set(['WAITFOR DELAY \'00:00:03\'']);

function stripLiterals(sql) { return sql.replace(/'(?:[^']|'')*'/g, "''"); }

function assertReadOnlySql(sql) {
  const text = String(sql).trim().replace(/;\s*$/, '');
  if (INTERNAL.has(text)) return text;
  if (!/^(SELECT|WITH)\b/i.test(text)) throw new Error('policy: only SELECT statements may run');
  const bare = stripLiterals(text);
  if (/--|\/\*/.test(bare)) throw new Error('policy: comments are not allowed');
  if (bare.includes(';')) throw new Error('policy: one statement at a time');
  const hit = FORBIDDEN.exec(bare);
  if (hit) throw new Error(`policy: "${hit[0]}" is not allowed`);
  return text;
}

/* A table name from a caller must be on the approved list; it is never pasted into SQL otherwise. */
function assertApprovedTable(name, cfg) {
  const t = String(name).replace(/^dbo\./i, '');
  const ok = cfg.approvedTables.find(a => a.toLowerCase() === t.toLowerCase());
  if (!ok) throw new Error(`policy: table "${t.slice(0, 40)}" is not on the approved list`);
  return ok;
}

module.exports = { assertReadOnlySql, assertApprovedTable, INTERNAL };
