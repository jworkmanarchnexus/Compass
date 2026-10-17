'use strict';
/* Candidate -> reconcile. Runs a reviewed candidate statement locally, computes the metric per project, compares it with the
   reference report at every level in the spec, stores the detail in the protected store, and returns only the sanitized result.
   A candidate statement is a file in discovery/candidates/; it runs only after the owner approved that exact text. */
const fs = require('node:fs');
const path = require('node:path');
const approvals = require('./approvals');
const refs = require('./reference-library');
const rec = require('./reconcile');
const metrics = require('./metrics');
const inv = require('./investigations');
const Dec = require('./lib/decimal');
const { assertReadOnlySql } = require('../server/vp/policy');
const { scrub } = require('../server/vp/redact');

const HERE = __dirname;
const loadJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));

function loadCandidate(id) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error('candidate: bad id');
  const def = loadJson(path.join(HERE, 'candidates', id + '.json'));
  const sql = fs.readFileSync(path.join(HERE, 'candidates', def.sqlFile), 'utf8');
  return { def, sql };
}

function fill(sql, { period, from = null }) {
  if (!/^\d{6}$/.test(String(period))) throw new Error('candidate: period must be YYYYMM');
  // `from` moves the start of the window: the report period itself for a single month, 0 for job to date; default is January
  if (from !== null && !/^\d{1,6}$/.test(String(from))) throw new Error('candidate: from must be YYYYMM or 0');
  const yearStart = from !== null ? String(Number(from)) : String(period).slice(0, 4) + '01';
  return sql.replace(/\{\{period\}\}/g, String(period)).replace(/\{\{yearStart\}\}/g, yearStart);
}

/* the owner reviews the filled statement; this records the request and returns the id to approve */
function requestCandidateApproval(store, id, params, investigationId) {
  const { def, sql } = loadCandidate(id);
  const text = fill(sql, params);
  assertReadOnlySql(text);
  return approvals.request(store, { kind: 'sql', description: `Candidate "${def.id}" for period ${params.period}${params.from !== undefined && params.from !== null ? ` (window starts at ${params.from})` : ''}: ${def.title}`, sql: text, scope: { candidate: def.id, params, willDisclose: 'rows stay local; only reconciliation counts and surrogate ids are returned' }, investigationId });
}

async function fetchCandidateRows({ store, cfg, vp }, approvalId, def, grossVariant = null) {
  const a = approvals.require(store, approvalId, {});
  approvals.require(store, approvalId, { sql: a.sql_text });
  const text = assertReadOnlySql(a.sql_text);
  const res = await vp.query(text, { rowLimit: 200000, timeoutSeconds: Math.max(cfg.queryTimeoutSeconds, 120) });
  if (res.truncated) throw new Error('candidate: result exceeded the row cap; refusing a partial dataset');
  const m = { ...def.columns };
  if (grossVariant) { if (!def.grossVariants?.[grossVariant]) throw new Error('candidate: unknown gross variant'); m.gross = def.grossVariants[grossVariant]; }
  const dec = v => (v === null || v === undefined ? null : Dec.parse(typeof v === 'bigint' ? v.toString() : v));
  return res.rows.map(r => ({ project: String(r[m.project]).trim(), pic: String(r[m.pic] ?? '').trim(), sector: String(r[m.sector] ?? '').trim(),
    gross: dec(r[m.gross]), fee: dec(r[m.fee]), consultFee: dec(r[m.consultFee]), reimbAllow: dec(r[m.reimbAllow]), totalContractValue: dec(r[m.totalContractValue]), consultantLedger: m.consultantLedger ? dec(r[m.consultantLedger]) : undefined }));
}

/* datasets for a run: pure, so tests can feed synthetic rows. candidateRows = output of fetchCandidateRows */
/* detail or summary Earnings layout -> records with the same shape readDataset gives */
function earningsDataset(store, refId, ds) {
  const e = refs.readEarnings(store, refId, { sheet: ds.sheet, groupPrefix: ds.groupPrefix });
  const measure = { 'Total Billed': 'billed', 'Direct Consultant': 'consultant', 'Architectural Revenue': 'arch' }[ds.measure];
  if (!measure) throw new Error('reference: unknown measure');
  const src = ds.records === 'projects' ? e.projects : e.groups;
  if (!src.length) throw new Error('reference: this sheet has no ' + ds.records + ' records in that layout');
  return src.map(r => ({ [ds.groupField]: ds.records === 'projects' ? r.group : r.name, project: r.project, amount: r[measure] }));
}

function reconcileSpec({ store, gateway, spec: specIn, candidateRows, refId, parameters, runId, consultantSource = 'fee-ratio' }) {
  let spec = specIn;
  const gross = candidateRows.filter(r => r.gross !== null).map(r => ({ project: r.project, pic: r.pic, sector: r.sector, amount: r.gross }));
  // two ways to get the consultant share: the owner's whole-project fee ratio, or consultant ledger entries (a hypothesis)
  let arch, consultant;
  if (consultantSource === 'ledger') {
    arch = { exceptions: [], rows: candidateRows.map(r => ({ project: r.project, pic: r.pic, sector: r.sector, amount: (r.gross ?? 0n) - (r.consultantLedger ?? 0n) })) };
    consultant = candidateRows.map(r => ({ project: r.project, pic: r.pic, sector: r.sector, amount: r.consultantLedger ?? 0n }));
  } else {
    arch = metrics.architecturalRevenue(candidateRows, parameters);
    consultant = arch.rows.map(r => ({ project: r.project, pic: r.pic, sector: r.sector, amount: r.consultant }));
  }
  if (consultantSource === 'none') { // gross-only candidate: only the gross comparisons apply
    spec = { ...spec, comparisons: spec.comparisons.filter(c => c.candidateField === 'gross') };
    arch = { exceptions: [], rows: [] }; consultant = [];
  }
  const tolerance = { absolute: Dec.parse(spec.tolerance?.absolute ?? '0.01'), cumulative: Dec.parse(spec.tolerance?.cumulative ?? '0.05') };
  const out = { comparisons: {}, candidateExceptions: [] };
  const tally = {};
  for (const e of arch.exceptions) tally[e.type] = (tally[e.type] || 0) + 1;
  out.candidateExceptions = Object.entries(tally).map(([type, count]) => ({ type, count }));
  const all = [];
  for (const cmp of spec.comparisons) {
    const skip = cmp.dataset.skipRowPattern ? new RegExp(cmp.dataset.skipRowPattern, 'i') : null;
    let reference;
    try { reference = cmp.dataset.parser === 'vp-earnings' ? earningsDataset(store, refId, cmp.dataset) : null; }
    catch (e) { if (cmp.optional && /no (projects|groups) records/.test(e.message)) { out.skippedComparisons = [...(out.skippedComparisons || []), cmp.name]; continue; } throw e; }
    reference = reference || refs.readDataset(store, refId, { ...cmp.dataset, skipRow: skip ? r => Object.values(r).some(v => typeof v === 'string' && skip.test(v)) : null });
    // a reference that lists only some projects can only be compared on those projects
    const only = cmp.dataset.restrictCandidateToReference ? new Set(reference.map(r => r.project)) : null;
    const candidate = (only ? { f: x => x.filter(r => only.has(r.project)) } : { f: x => x }).f(cmp.candidateField === 'gross' ? gross : cmp.candidateField === 'consultant' ? consultant : arch.rows);
    const result = rec.reconcile({ reference, candidate, levels: cmp.levels, tolerance, naturalKey: ['project'] });
    store.raw.prepare('INSERT INTO recon_detail (run_id, level, key, detail) VALUES (?,?,?,?)').run(runId, cmp.name, 'summary', JSON.stringify(Object.fromEntries(Object.entries(result.results).map(([k, v]) => [k, { ...v, exceptions: v.exceptions.map(x => ({ ...x, ref: x.ref.toString(), cand: x.cand.toString(), diff: x.diff?.toString() })) }]))));
    out.comparisons[cmp.name] = rec.sanitize(result, gateway);
    all.push(result);
  }
  const reconciled = all.every(r => r.reconciled);
  return { reconciled, requiredLevels: spec.comparisons.flatMap(c => c.levels.map(l => l.name)), unmetLevels: all.flatMap(r => r.unmetLevels), ...out, candidateRowCount: candidateRows.length };
}

module.exports = { loadCandidate, fill, requestCandidateApproval, fetchCandidateRows, reconcileSpec, loadJson, scrub };
