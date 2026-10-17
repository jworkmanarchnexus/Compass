'use strict';
/* Local tool server for Claude (MCP over stdio, JSON-RPC 2.0, one message per line). It speaks only through the gateway.
   What it does NOT offer, on purpose: free SQL, any tool returning row values, approving anything, reversing a surrogate id,
   or reading the protected store. Everything else Claude needs is here. */
const readline = require('node:readline');
const registry = require('./registry');
const inv = require('./investigations');
const refs = require('./reference-library');
const metrics = require('./metrics');
const approvals = require('./approvals');
const { scrub } = require('../server/vp/redact');

const str = (d, extra = {}) => ({ type: 'string', description: d, ...extra });
const tools = {
  dictionary_search: { d: 'Search the Vantagepoint data dictionary by meaning (e.g. "recognized revenue by principal"). Returns ranked tables and columns with their evidence levels. Metadata only.', p: { query: str('what to look for') }, r: ['query'],
    run: (c, a) => ({ ...registry.search(c.store, a.query), note: 'A field existing is not evidence it is populated, current, authoritative or reconciled.' }) },
  dictionary_table: { d: 'Columns, types, keys and evidence levels of one table.', p: { table: str('table name') }, r: ['table'],
    run: (c, a) => registry.describeTable(c.store, a.table) || { error: 'unknown table' } },
  knowledge_search: { d: 'Search earlier findings, rejected approaches and evidence before running anything new.', p: { query: str('topic') }, r: ['query'],
    run: (c, a) => ({ hits: inv.knowledgeSearch(c.store, a.query) }) },
  investigation_start: { d: 'Open an investigation for a reporting requirement.', p: { title: str('short title'), requirement: str('what must be reproduced') }, r: ['title', 'requirement'],
    run: (c, a) => ({ investigationId: inv.create(c.store, a) }) },
  investigation_status: { d: 'Tests executed/passed, failures to reproduce vs diagnostics that could not run, reconciliation coverage, open items.', p: { investigationId: str('id') }, r: ['investigationId'],
    run: (c, a) => inv.status(c.store, a.investigationId) || { error: 'unknown investigation' } },
  investigation_resume: { d: 'Pick an interrupted investigation back up: state, recent activity, next step.', p: { investigationId: str('id') }, r: ['investigationId'],
    run: (c, a) => inv.resume(c.store, a.investigationId) || { error: 'unknown investigation' } },
  investigation_note: { d: 'Record a hypothesis, decision or rejected approach (no financial values).', p: { investigationId: str('id'), kind: str('hypothesis|rejected|decision|note'), subject: str('what'), text: str('why') }, r: ['investigationId', 'kind', 'subject', 'text'],
    run: (c, a) => { if (!['hypothesis', 'rejected', 'decision', 'note'].includes(a.kind)) throw new Error('kind not allowed'); inv.note(c.store, a.investigationId, { kind: a.kind, subject: a.subject, body: { text: scrub(a.text, c.cfg) } }); return { recorded: true }; } },
  op_table_population: { d: 'Row count of an approved table.', p: { table: str('table'), investigationId: str('id') }, r: ['table'], run: (c, a) => c.operations(a.investigationId).tablePopulation(a) },
  op_column_population: { d: 'Non-null, nonzero and distinct counts of one column (counts only).', p: { table: str('t'), column: str('c'), investigationId: str('id') }, r: ['table', 'column'], run: (c, a) => c.operations(a.investigationId).columnPopulation(a) },
  op_period_coverage: { d: 'First and last accounting period and number of periods in a period column.', p: { table: str('t'), column: str('period column'), investigationId: str('id') }, r: ['table', 'column'], run: (c, a) => c.operations(a.investigationId).periodCoverage(a) },
  op_join_cardinality: { d: 'Test a join: unmatched rows, duplicate keys on the right, fan-out that would double count.', p: { leftTable: str('t'), leftColumns: { type: 'array', items: { type: 'string' } }, rightTable: str('t'), rightColumns: { type: 'array', items: { type: 'string' } }, investigationId: str('id') }, r: ['leftTable', 'leftColumns', 'rightTable', 'rightColumns'], run: (c, a) => c.operations(a.investigationId).joinCardinality(a) },
  op_duplicate_check: { d: 'Whether a column set is unique in a table.', p: { table: str('t'), columns: { type: 'array', items: { type: 'string' } }, investigationId: str('id') }, r: ['table', 'columns'], run: (c, a) => c.operations(a.investigationId).duplicateCheck(a) },
  op_gross_gap_checks: { d: 'Why ledger revenue might differ from a report: projects the join drops, missing principal or type names, posting-period vs transaction-date differences (counts only).', p: { period: str('YYYYMM'), investigationId: str('id') }, r: ['period'], run: (c, a) => c.operations(a.investigationId).grossGapChecks(a) },
  op_late_postings_check: { d: 'Invoice rows in the period posted on or after a date (counts only): explains small differences from a report run earlier.', p: { period: str('YYYYMM'), cutoffDate: str('YYYYMMDD'), investigationId: str('id') }, r: ['period', 'cutoffDate'], run: (c, a) => c.operations(a.investigationId).latePostingsCheck(a) },
  op_code_counts: { d: 'Counts per code for a short code column (transaction type, status, section), optionally within a period range. Refuses name-like columns.', p: { table: str('t'), column: str('code column'), fromPeriod: str('YYYYMM'), toPeriod: str('YYYYMM'), investigationId: str('id') }, r: ['table', 'column'], run: (c, a) => c.operations(a.investigationId).codeCounts(a) },
  op_project_profile: { d: 'Counts describing how the invoice rows of one flagged project are built (automatic entries, retainage, credits, phases, links, date vs period). Takes the project surrogate id from a reconciliation.', p: { projectId: str('PRO-... id'), period: str('YYYYMM'), investigationId: str('id') }, r: ['projectId', 'period'], run: (c, a) => c.operations(a.investigationId).projectProfile(a) },
  propose_sql: { d: 'Extended mode: propose a read-only SELECT. It does NOT run. The owner must approve that exact text; output is then shape only unless the owner scoped a value release.', p: { sql: str('the statement'), why: str('what question it answers'), investigationId: str('id') }, r: ['sql', 'why'], run: (c, a) => c.operations(a.investigationId).proposeSql(a) },
  run_approved_sql: { d: 'Run an owner-approved statement by approval id.', p: { approvalId: str('id'), investigationId: str('id') }, r: ['approvalId'], run: (c, a) => c.operations(a.investigationId).runApprovedSql(a) },
  approval_status: { d: 'Check whether the owner has decided on a request.', p: { approvalId: str('id') }, r: ['approvalId'], run: (c, a) => { const r = approvals.get(c.store, a.approvalId); return r ? { approvalId: r.id, kind: r.kind, status: r.status } : { error: 'unknown' }; } },
  references_list: { d: 'Registered reference reports: kind, period, status, open questions (no values).', p: {}, r: [], run: c => ({ references: refs.list(c.store) }) },
  reconcile_run: { d: 'Run a reviewed candidate against a confirmed reference per a spec. Everything is computed locally; returns counts, statuses and surrogate ids only.', p: { specId: str('spec'), candidateId: str('candidate'), period: str('YYYYMM'), referenceId: str('ref id'), approvalId: str('approved SQL id'), investigationId: str('id') }, r: ['specId', 'candidateId', 'period', 'referenceId', 'approvalId', 'investigationId'],
    run: async (c, a) => require('./agent').runSpec(c, { ...a, refId: a.referenceId }) },
  metric_get: { d: 'A metric definition, its status and validation evidence.', p: { name: str('metric name') }, r: ['name'], run: (c, a) => metrics.get(c.store, a.name) || { error: 'unknown metric' } },
};

function serve(ctx, input = process.stdin, output = process.stdout) {
  const send = m => output.write(JSON.stringify(m) + '\n');
  const rl = readline.createInterface({ input });
  rl.on('line', async line => {
    let msg;
    try { msg = JSON.parse(line); } catch { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); }
    const { id, method, params } = msg;
    if (id === undefined) return; // notification
    try {
      if (method === 'initialize') return send({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'compass-vp-discovery', version: '0.1.0' } } });
      if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
      if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: Object.entries(tools).map(([name, t]) => ({ name, description: t.d, inputSchema: { type: 'object', properties: t.p, required: t.r } })) } });
      if (method === 'tools/call') {
        const t = tools[params?.name];
        if (!t) return send({ jsonrpc: '2.0', id, error: { code: -32602, message: 'unknown tool' } });
        try {
          const raw = await t.run(ctx, params.arguments || {});
          const out = raw && raw.__approved ? raw : ctx.gateway.release(raw, ctx.cfg);
          return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(out) }] } });
        } catch (e) {
          // errors are scrubbed; diagnosticFailed marks "could not run" as different from "did not reproduce"
          const text = JSON.stringify({ error: scrub(e.message, ctx.cfg), diagnosticFailed: !!e.diagnosticFailed });
          return send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text }] } });
        }
      }
      return send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found' } });
    } catch (e) { send({ jsonrpc: '2.0', id, error: { code: -32603, message: scrub(e.message, ctx.cfg) } }); }
  });
  return rl;
}

module.exports = { serve, tools };
