'use strict';
/* Wires the parts together. One context per process: store, settings, gateway, a lazy read-only connection. */
const path = require('node:path');
const { openStore } = require('./store');
const { createGateway } = require('./gateway');
const { createOperations } = require('./operations');
const { loadConfig } = require('../server/vp/config');
const vpConn = require('../server/vp/connection');
const registry = require('./registry');
const inv = require('./investigations');
const metrics = require('./metrics');
const refs = require('./reference-library');
const pipeline = require('./pipeline');

const DATA_DIR = path.join(__dirname, 'data');
const DEFAULT_DICTIONARY = path.join(require('node:os').homedir(), 'Downloads', 'compass-vantagepoint-data-reference', 'docs', 'data-dictionary');

function createContext({ dataDir = DATA_DIR, cfg = loadConfig(), driver } = {}) {
  const store = openStore(dataDir);
  const gateway = createGateway(store);
  let conn = null;
  const vp = {
    async query(sql, opts) { conn = conn || await vpConn.open(cfg, driver); return conn.query(sql, opts); },
    async close() { if (conn) await conn.close(); conn = null; },
  };
  return { store, gateway, cfg, vp, dataDir, operations: investigationId => createOperations({ store, gateway, cfg, vp, investigationId }) };
}

/* first-time setup: dictionary, prior findings, draft metric. Safe to repeat. */
function setup(ctx, { dictionaryDir = DEFAULT_DICTIONARY } = {}) {
  const dict = registry.importDictionary(ctx.store, dictionaryDir);
  const disc = registry.importDiscoveries(ctx.store, path.join(dictionaryDir, 'discoveries'));
  const prior = inv.seedPriorFindings(ctx.store, path.join(__dirname, 'knowledge', 'prior-findings.json'));
  for (const m of [metrics.WHOLE_PROJECT_CONSULTANT_RATIO, metrics.OFFICE_EARNINGS_LEDGER_METHOD, metrics.MWIP_BACKLOG_METHOD]) if (!metrics.get(ctx.store, m.name)) metrics.save(ctx.store, m);
  return { dictionary: dict, discoveryNotes: disc.length, priorFindings: prior };
}

/* run one reviewed candidate against a stored reference, per the spec, and record the outcome */
async function runSpec(ctx, { specId, candidateId, period, refId, approvalId, investigationId, parameters = {}, grossVariant = null }) {
  const spec = pipeline.loadJson(path.join(__dirname, 'specs', specId + '.json'));
  const { def } = pipeline.loadCandidate(candidateId);
  const ref = ctx.store.knowledge.prepare('SELECT meta, status, checksum FROM ref_reports WHERE id = ?').get(refId);
  if (!ref) throw new Error('reference: unknown');
  if (ref.status === 'needs-confirmation') throw new Error('reference: its period and cutoff must be confirmed first');
  if (JSON.parse(ref.meta).period !== String(period)) throw new Error('reference: the report period does not match the requested period');
  // a run can promote only the metric its own candidate implements; the fee-ratio candidate implements the owner's ratio rule
  const metricName = def.metric || ((def.consultantSource || 'fee-ratio') === 'fee-ratio' ? spec.metric : null);
  const metric = metricName ? metrics.get(ctx.store, metricName) : null;
  const p = { ...(metric?.definition.parameters || {}), ...parameters };
  const runId = 'RUN-' + Date.now().toString(36);
  inv.note(ctx.store, investigationId, { kind: 'hypothesis', subject: def.title + (grossVariant ? ` [${grossVariant}]` : ''), body: { candidate: def.id, period: String(period), grossVariant } });
  let rows;
  try { rows = await pipeline.fetchCandidateRows(ctx, approvalId, def, grossVariant); }
  catch (e) {
    inv.note(ctx.store, investigationId, { kind: 'test', status: 'error', subject: def.title, body: { stage: 'fetch', message: pipeline.scrub(e.message, ctx.cfg) } });
    throw Object.assign(e, { diagnosticFailed: true });
  }
  ctx.store.raw.prepare('INSERT INTO candidate_rows (run_id, data) VALUES (?,?)').run(runId, JSON.stringify(rows, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
  const result = pipeline.reconcileSpec({ store: ctx.store, gateway: ctx.gateway, spec, candidateRows: rows, refId, parameters: p, runId, consultantSource: def.consultantSource || 'fee-ratio' });
  inv.note(ctx.store, investigationId, { kind: 'test', status: result.reconciled ? 'pass' : 'fail', subject: def.title, body: { runId, unmetLevels: result.unmetLevels, candidateExceptionCounts: result.candidateExceptionCounts } });
  inv.note(ctx.store, investigationId, { kind: 'reconciliation', subject: def.title, body: { reconciled: result.reconciled, requiredLevels: result.requiredLevels, unmetLevels: result.unmetLevels, parameters: p } });
  if (result.reconciled && metric) metrics.markReconciled(ctx.store, metric.name, metric.version, { reconciled: true, requiredLevels: result.requiredLevels, referenceId: refId, referenceChecksum: ref.checksum });
  return { runId, spec: { id: spec.id, confirmed: spec.confirmed }, parameters: p, ...result };
}

module.exports = { createContext, setup, runSpec, DATA_DIR, DEFAULT_DICTIONARY };
