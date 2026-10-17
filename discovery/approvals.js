'use strict';
/* Human approvals. The AI side can only REQUEST (request()); deciding is done by the owner in the CLI (decide()), and the
   tool server exposes no way to approve anything. An approval for SQL is bound to the SHA-256 of the exact text, so
   changing a single character invalidates it. Value-disclosure approvals are one-use. */
const crypto = require('node:crypto');

const sha = s => crypto.createHash('sha256').update(String(s).trim().replace(/;\s*$/, '')).digest('hex');

function request(store, { kind, description, sql = null, scope = {}, investigationId = null }) {
  if (!['sql', 'disclosure'].includes(kind)) throw new Error('approvals: unknown kind');
  const id = 'AP-' + crypto.randomBytes(4).toString('hex');
  store.knowledge.prepare('INSERT INTO approvals (id, kind, description, scope, sql_hash, sql_text, status, requested, investigation_id) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, kind, description, JSON.stringify(scope), sql ? sha(sql) : null, sql, 'pending', store.now(), investigationId);
  store.audit('agent', 'approval.requested', { id, kind });
  return id;
}

function get(store, id) {
  const r = store.knowledge.prepare('SELECT * FROM approvals WHERE id = ?').get(id);
  return r && { ...r, scope: JSON.parse(r.scope || '{}') };
}

function pending(store) {
  return store.knowledge.prepare("SELECT id, kind, description, scope, sql_text, requested FROM approvals WHERE status = 'pending' ORDER BY requested").all().map(r => ({ ...r, scope: JSON.parse(r.scope || '{}') }));
}

/* owner only */
function decide(store, id, approve) {
  const r = get(store, id);
  if (!r || r.status !== 'pending') throw new Error('approvals: not a pending request');
  store.knowledge.prepare('UPDATE approvals SET status = ?, decided = ? WHERE id = ?').run(approve ? 'approved' : 'denied', store.now(), id);
  store.audit('owner', approve ? 'approval.granted' : 'approval.denied', { id });
}

/* throws unless this exact SQL was approved; for disclosure approvals, consumes the approval */
function require_(store, id, { sql = null, consume = false } = {}) {
  const r = get(store, id);
  if (!r || r.status !== 'approved') throw new Error('approvals: not approved');
  if (sql !== null && r.sql_hash !== sha(sql)) throw new Error('approvals: the SQL differs from what was approved');
  if (consume) store.knowledge.prepare("UPDATE approvals SET status = 'used' WHERE id = ?").run(id);
  return r;
}

module.exports = { sha, request, get, pending, decide, require: require_ };
