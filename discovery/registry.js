'use strict';
/* Schema registry: the Vantagepoint data dictionary, searchable by meaning, with five separate levels of evidence per table
   or column. A level is only ever raised by a recorded test; importing the dictionary proves only that a field EXISTS.
     exists -> populated -> current -> authoritative -> reconciled        (each recorded as verified | provisional | failed)
   Relationships are labelled documented | inferred | verified | failed. An inferred join is never shown as verified. */
const fs = require('node:fs');
const path = require('node:path');
const { parseCsv } = require('../server/csv');

const LEVELS = ['exists', 'populated', 'current', 'authoritative', 'reconciled'];

// Search by meaning: each concept pulls in the words accounting systems use for it.
const SYNONYMS = {
  revenue: ['revenue', 'billed', 'billing', 'bill', 'invoice', 'earnings', 'earned', 'recognized', 'amount', 'income', 'fee'],
  consultant: ['consultant', 'consult', 'subconsultant', 'outside', 'direct consultant', 'reimb'],
  fee: ['fee', 'contract', 'compensation', 'budget'],
  project: ['project', 'wbs1', 'wbs2', 'wbs3', 'phase', 'task', 'job'],
  principal: ['principal', 'pic', 'incharge', 'leader'],
  sector: ['sector', 'market', 'projecttype', 'type', 'category', 'clientmarket'],
  employee: ['employee', 'staff', 'person', 'em'],
  period: ['period', 'month', 'fiscal', 'year', 'date', 'posted'],
  labor: ['labor', 'hours', 'timesheet', 'time'],
  receivable: ['receivable', 'ar', 'aging', 'aged', 'invoice', 'payment'],
  overhead: ['overhead', 'rate', 'burden', 'indirect'],
  expense: ['expense', 'cost', 'reimbursable', 'direct'],
};
const STOP = new Set(['the', 'a', 'an', 'of', 'for', 'by', 'and', 'or', 'to', 'in', 'on', 'is', 'what', 'where', 'find', 'which', 'table', 'field', 'column']);

const words = s => String(s).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

function importDictionary(store, dir) {
  const read = f => parseCsv(fs.readFileSync(path.join(dir, f), 'utf8'));
  const tables = read('tables.csv'), columns = read('columns.csv');
  store.tx(store.knowledge, () => {
    store.knowledge.exec('DELETE FROM dict_tables; DELETE FROM dict_columns');
    const t = store.knowledge.prepare('INSERT OR REPLACE INTO dict_tables VALUES (?,?,?,?)');
    for (const r of tables) t.run(r.Table, r.Definition, Number(r.ColumnCount) || 0, r.Keys || '');
    const c = store.knowledge.prepare('INSERT OR REPLACE INTO dict_columns VALUES (?,?,?,?,?,?,?)');
    for (const r of columns) c.run(r.Table, r.Column, r.PrimaryKey || '', r.Domain || '', r.DataType || '', r.Nullable || '', r.Description || '');
  });
  store.audit('system', 'dictionary.import', { tables: tables.length, columns: columns.length });
  return { tables: tables.length, columns: columns.length };
}

/* Discovery notes ("Status: Verified on ...") become evidence rows. The wording of the note decides verified vs provisional;
   they are abstracts of earlier work, so they are recorded as provisional unless they say Verified or Reconciled. */
function importDiscoveries(store, dir) {
  const out = [];
  for (const f of fs.readdirSync(dir).filter(n => /^\d{3}-.*\.md$/.test(n))) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const status = /\*\*Status:\*\*\s*(.+)/.exec(text)?.[1]?.trim() || '';
    out.push({ file: f, title: /^#\s*(.+)/m.exec(text)?.[1], status, verified: /\b(verified|reconciled)\b/i.test(status) });
  }
  store.audit('system', 'discoveries.import', { count: out.length });
  return out;
}

function recordEvidence(store, { tbl, col = null, level, status, note = '', source = '', investigationId = null }) {
  if (!LEVELS.includes(level)) throw new Error('unknown evidence level');
  if (!['verified', 'provisional', 'failed'].includes(status)) throw new Error('unknown evidence status');
  store.knowledge.prepare('INSERT INTO evidence (tbl, col, level, status, note, source, investigation_id, at) VALUES (?,?,?,?,?,?,?,?)').run(tbl, col, level, status, note, source, investigationId, store.now());
}

function recordRelationship(store, r) {
  if (!['documented', 'inferred', 'verified', 'failed'].includes(r.status)) throw new Error('unknown relationship status');
  store.knowledge.prepare('INSERT INTO relationships (left_tbl, left_cols, right_tbl, right_cols, status, cardinality, note, investigation_id, at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(r.leftTable, r.leftColumns.join(','), r.rightTable, r.rightColumns.join(','), r.status, r.cardinality || null, r.note || '', r.investigationId || null, store.now());
}

/* latest status per level for a table/column; a later 'failed' overrides an earlier 'verified' */
function evidenceFor(store, tbl, col = null) {
  const rows = store.knowledge.prepare('SELECT level, status, note, at FROM evidence WHERE tbl = ? AND col IS ? ORDER BY at, id').all(tbl, col);
  const byLevel = Object.fromEntries(LEVELS.map(l => [l, 'none']));
  for (const r of rows) byLevel[r.level] = r.status;
  byLevel.exists = byLevel.exists === 'none' ? 'documented' : byLevel.exists;
  return byLevel;
}

function expand(query) {
  const toks = words(query).filter(t => !STOP.has(t));
  const expanded = new Map(); // term -> weight
  for (const t of toks) {
    expanded.set(t, Math.max(expanded.get(t) || 0, 3));
    for (const [concept, syns] of Object.entries(SYNONYMS)) {
      if (t === concept || t.startsWith(concept) || syns.includes(t)) for (const s of syns) for (const w of words(s)) expanded.set(w, Math.max(expanded.get(w) || 0, w === concept ? 2 : 1));
    }
  }
  return expanded;
}

/* search(store, "recognized revenue by principal") -> ranked columns and tables, with evidence status. Metadata only. */
function search(store, query, { limit = 15 } = {}) {
  const terms = expand(query);
  if (!terms.size) return { query, terms: [], columns: [], tables: [] };
  const cols = store.knowledge.prepare('SELECT tbl, col, data_type, description FROM dict_columns').all();
  const scored = [];
  for (const c of cols) {
    const nameW = new Set(words(c.col)), tblW = new Set(words(c.tbl)), descW = new Set(words(c.description));
    let s = 0;
    for (const [t, w] of terms) { if (nameW.has(t)) s += w * 3; if (tblW.has(t)) s += w; if (descW.has(t)) s += w * 0.5; }
    if (s > 0) scored.push({ table: c.tbl, column: c.col, dataType: c.data_type, description: c.description.slice(0, 160), score: Math.round(s) });
  }
  scored.sort((a, b) => b.score - a.score || a.table.localeCompare(b.table) || a.column.localeCompare(b.column));
  const columns = scored.slice(0, limit).map(c => ({ ...c, evidence: evidenceFor(store, c.table, c.column) }));
  // a table ranks by its three best columns, so wide tables do not win just for having many columns
  const perTable = new Map();
  for (const c of scored) { const a = perTable.get(c.table) || []; if (a.length < 3) a.push(c.score); perTable.set(c.table, a); }
  const tableScore = new Map([...perTable].map(([t, a]) => [t, a.reduce((x, y) => x + y, 0)]));
  const defs = store.knowledge.prepare('SELECT name, definition FROM dict_tables').all();
  for (const d of defs) for (const [t, w] of terms) if (words(d.definition).includes(t) || words(d.name).includes(t)) tableScore.set(d.name, (tableScore.get(d.name) || 0) + w * 2);
  const tables = [...tableScore].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, score]) => ({ table: name, score: Math.round(score), definition: defs.find(d => d.name === name)?.definition || '', evidence: evidenceFor(store, name) }));
  return { query, terms: [...terms.keys()], columns, tables };
}

function describeTable(store, name) {
  const t = store.knowledge.prepare('SELECT * FROM dict_tables WHERE lower(name) = lower(?)').get(name);
  if (!t) return null;
  const columns = store.knowledge.prepare('SELECT col AS name, data_type AS dataType, primary_key AS primaryKey, nullable, description FROM dict_columns WHERE tbl = ? ORDER BY rowid').all(t.name);
  return { table: t.name, definition: t.definition, keys: t.keys, columns, evidence: evidenceFor(store, t.name) };
}

/* identifiers used in generated SQL must come from the dictionary; this is the only way a name reaches a statement */
function resolveColumn(store, table, column) {
  const r = store.knowledge.prepare('SELECT tbl, col FROM dict_columns WHERE lower(tbl) = lower(?) AND lower(col) = lower(?)').get(table, column);
  if (!r) throw new Error(`registry: "${String(table).slice(0, 40)}.${String(column).slice(0, 40)}" is not in the data dictionary`);
  return { table: r.tbl, column: r.col };
}

module.exports = { LEVELS, importDictionary, importDiscoveries, recordEvidence, recordRelationship, evidenceFor, search, describeTable, resolveColumn, expand };
