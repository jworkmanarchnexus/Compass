'use strict';
/* Investigations persist in the knowledge store so work resumes after any interruption. Status is computed from recorded
   tests, never from an opinion. Two failure kinds are kept apart:
     'error'  = a diagnostic could not execute (permissions, timeout, bad name): says nothing about the hypothesis
     'fail'   = it executed and the result did not reproduce the reference                                            */
const crypto = require('node:crypto');
const fs = require('node:fs');
const registry = require('./registry');

function create(store, { title, requirement }) {
  const id = 'INV-' + crypto.randomBytes(3).toString('hex');
  const t = store.now();
  store.knowledge.prepare('INSERT INTO investigations (id, title, requirement, status, created, updated) VALUES (?,?,?,?,?,?)').run(id, title, requirement, 'open', t, t);
  store.audit('agent', 'investigation.create', { id });
  return id;
}

function note(store, investigationId, { kind, status = null, subject = '', body }) {
  if (!['hypothesis', 'test', 'reconciliation', 'rejected', 'decision', 'note'].includes(kind)) throw new Error('unknown finding kind');
  if (kind === 'test' && !['pass', 'fail', 'error'].includes(status)) throw new Error('a test needs status pass, fail or error');
  store.knowledge.prepare('INSERT INTO findings (investigation_id, kind, status, subject, body, at) VALUES (?,?,?,?,?,?)').run(investigationId, kind, status, subject, JSON.stringify(body), store.now());
  store.knowledge.prepare('UPDATE investigations SET updated = ? WHERE id = ?').run(store.now(), investigationId);
}

function status(store, id) {
  const inv = store.knowledge.prepare('SELECT * FROM investigations WHERE id = ?').get(id);
  if (!inv) return null;
  const f = store.knowledge.prepare('SELECT kind, status, subject, body, at FROM findings WHERE investigation_id = ? ORDER BY at, id').all(id);
  const tests = f.filter(x => x.kind === 'test');
  const recon = f.filter(x => x.kind === 'reconciliation');
  const lastRecon = recon[recon.length - 1];
  const reconBody = lastRecon ? JSON.parse(lastRecon.body) : null;
  const sources = new Set(f.filter(x => x.kind === 'hypothesis').map(x => x.subject));
  const open = [...new Set(f.filter(x => x.kind === 'hypothesis' && !f.some(y => y.kind === 'rejected' && y.subject === x.subject)).map(x => x.subject))];
  const pendingApprovals = store.knowledge.prepare("SELECT COUNT(*) AS n FROM approvals WHERE investigation_id = ? AND status = 'pending'").get(id).n;
  return {
    id, title: inv.title, requirement: inv.requirement,
    sourcesEvaluated: sources.size, testsExecuted: tests.length,
    testsPassed: tests.filter(t => t.status === 'pass').length,
    testsFailedToReproduce: tests.filter(t => t.status === 'fail').length,
    testsCouldNotRun: tests.filter(t => t.status === 'error').length,
    reconciliation: reconBody ? { reconciled: !!reconBody.reconciled, requiredLevels: reconBody.requiredLevels?.length ?? 0, unmetLevels: reconBody.unmetLevels?.length ?? 0 } : 'not run',
    openHypotheses: open, rejected: f.filter(x => x.kind === 'rejected').map(x => x.subject), pendingApprovals,
    readyForImplementation: !!reconBody?.reconciled && pendingApprovals === 0,
  };
}

function resume(store, id) {
  const s = status(store, id);
  if (!s) return null;
  const last = store.knowledge.prepare('SELECT kind, subject, status, at FROM findings WHERE investigation_id = ? ORDER BY at DESC, id DESC LIMIT 10').all(id).map(r => ({ ...r, at: new Date(r.at).toISOString() }));
  return { ...s, recentActivity: last, nextStep: s.readyForImplementation ? 'export the verified implementation' : s.reconciliation === 'not run' ? 'run diagnostics on the open hypotheses, then reconcile' : 'diagnose the unmet reconciliation levels' };
}

function list(store) { return store.knowledge.prepare('SELECT id, title, status, updated FROM investigations ORDER BY updated DESC').all(); }

/* search what is already known before running anything: findings, rejected approaches, evidence notes */
function knowledgeSearch(store, query) {
  const terms = [...registry.expand(query).keys()];
  const like = t => `%${t}%`;
  const hits = [];
  for (const t of terms.slice(0, 12)) {
    for (const r of store.knowledge.prepare('SELECT investigation_id, kind, status, subject, body FROM findings WHERE lower(subject) LIKE ? OR lower(body) LIKE ?').all(like(t), like(t))) hits.push({ source: 'finding', ref: r.investigation_id, kind: r.kind, status: r.status, subject: r.subject, body: r.body });
    for (const r of store.knowledge.prepare('SELECT tbl, col, level, status, note FROM evidence WHERE lower(tbl) LIKE ? OR lower(note) LIKE ? OR lower(col) LIKE ?').all(like(t), like(t), like(t))) hits.push({ source: 'evidence', ref: r.col ? `${r.tbl}.${r.col}` : r.tbl, kind: r.level, status: r.status, subject: r.note, body: '' });
  }
  const seen = new Set();
  return hits.filter(h => { const k = `${h.source}|${h.ref}|${h.kind}|${h.subject}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 30)
    .map(h => ({ source: h.source, ref: h.ref, kind: h.kind, status: h.status, description: String(h.subject || '').slice(0, 200) }));
}

/* import earlier work as evidence (structural facts only, no dollar amounts). Idempotent per file hash. */
function seedPriorFindings(store, file) {
  const spec = JSON.parse(fs.readFileSync(file, 'utf8'));
  const already = store.knowledge.prepare("SELECT 1 FROM audit WHERE action = 'seed.prior' AND detail = ?").get(JSON.stringify({ id: spec.id }));
  if (already) return { imported: 0, skipped: true };
  const inv = create(store, { title: spec.title, requirement: spec.requirement });
  store.tx(store.knowledge, () => {
    for (const e of spec.evidence) registry.recordEvidence(store, { ...e, source: 'prior investigation', investigationId: inv });
    for (const r of spec.relationships) registry.recordRelationship(store, { ...r, investigationId: inv });
    for (const x of spec.findings) note(store, inv, x);
  });
  store.audit('system', 'seed.prior', { id: spec.id });
  return { imported: spec.evidence.length + spec.relationships.length + spec.findings.length, investigationId: inv };
}

module.exports = { create, note, status, resume, list, knowledgeSearch, seedPriorFindings };
