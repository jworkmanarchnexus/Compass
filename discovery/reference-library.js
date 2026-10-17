'use strict';
/* Reference report library. A reference is a report Vantagepoint itself produced; reconciliation is only meaningful against one.
   - The original file is copied unchanged into the protected store and never modified; its SHA-256 is recorded.
   - The reporting period is never guessed from a file name. Unless the owner states it, the report is "needs-confirmation".
   - A primary VP export and a downstream workbook (extra calculations, manual edits) are different kinds and kept apart.
   - For Excel, hardcoded values, formulas with a cached result, and formulas WITHOUT a cached result are distinguished.
     A missing cache is never read as zero. Macros and external links are detected and reported, never run or followed.
   Metadata (no values) goes to the knowledge store; rows go to the protected store. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseCsv } = require('../server/csv');
const { readWorkbook } = require('./lib/xlsx');
const Dec = require('./lib/decimal');

const KINDS = ['primary-vp-export', 'downstream-workbook'];
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
const PERIOD = /^\d{6}$/;

/* suggestions only: shown to the owner, never applied */
function suggestPeriod(fileName) {
  const m = /(20\d{2})[-_ .]?(0[1-9]|1[0-2])\b/.exec(fileName) || null;
  return m ? m[1] + m[2] : null;
}

function register(store, file, meta) {
  if (!KINDS.includes(meta.kind)) throw new Error(`reference: kind must be one of ${KINDS.join(', ')}`);
  if (!meta.name) throw new Error('reference: a name is required');
  const buf = fs.readFileSync(file);
  const checksum = sha256(buf);
  const ext = path.extname(file).toLowerCase();
  if (!['.xlsx', '.csv'].includes(ext)) throw new Error('reference: only .xlsx and .csv are supported so far');

  const prior = store.knowledge.prepare('SELECT id, version, checksum FROM ref_reports WHERE name = ? ORDER BY version DESC').all(meta.name);
  if (prior[0]?.checksum === checksum) return { id: prior[0].id, version: prior[0].version, unchanged: true };
  const version = (prior[0]?.version || 0) + 1;
  const id = `REF-${checksum.slice(0, 10)}`;

  // original kept byte-for-byte
  const origDir = path.join(store.dir, 'protected', 'originals');
  fs.mkdirSync(origDir, { recursive: true });
  const kept = path.join(origDir, `${checksum.slice(0, 16)}${ext}`);
  if (!fs.existsSync(kept)) fs.writeFileSync(kept, buf, { flag: 'wx' });

  const warnings = [], questions = [...(meta.limitations || [])];
  const sheets = {};
  let formulaStats = null;
  if (ext === '.xlsx') {
    const wb = readWorkbook(file);
    if (wb.hasMacros) warnings.push('workbook contains macros (not read or run)');
    if (wb.hasExternalLinks) warnings.push('workbook has external links (not followed)');
    formulaStats = {};
    const chosen = meta.sheets?.length ? meta.sheets : wb.sheetNames;
    for (const name of chosen) {
      const rows = wb.sheet(name);
      const st = { value: 0, formula: 0, formulaNoCache: 0 };
      rows.forEach(r => r && r.forEach(c => { if (!c) return; if (c.kind === 'value') st.value++; else if (c.kind === 'formula') st.formula++; else if (c.kind === 'formula-no-cache') st.formulaNoCache++; }));
      formulaStats[name] = st;
      if (st.formulaNoCache) warnings.push(`sheet "${name}": ${st.formulaNoCache} formula cell(s) have no stored result and will not be treated as zero`);
      sheets[name] = rows.map(r => (r || []).map(c => c ? { k: c.kind, t: c.text, f: c.formula ? 1 : 0, num: c.numeric ? 1 : 0 } : null));
    }
  } else {
    sheets.csv = parseCsv(buf.toString('utf8').replace(/^﻿/, '')).map(r => [r]); // csv rows are objects; header handled at read time
  }

  const period = meta.period || null;
  if (period && !PERIOD.test(String(period))) throw new Error('reference: period must be YYYYMM');
  const status = period && meta.cutoff ? 'registered' : 'needs-confirmation';
  if (!period) questions.push('Reporting period not stated by the owner; confirm before using for reconciliation.');
  if (!meta.cutoff) questions.push('Actual report cutoff date not stated.');
  const record = {
    name: meta.name, kind: meta.kind, reportType: meta.reportType || null, sourceApplication: meta.sourceApplication || 'Deltek Vantagepoint',
    period, periodSuggestion: period ? null : suggestPeriod(path.basename(file)), cutoff: meta.cutoff || null, exportDate: meta.exportDate || null,
    options: meta.options || {}, financialBasis: meta.financialBasis || null, grain: meta.grain || null, dimensions: meta.dimensions || [],
    sheetsStored: Object.keys(sheets), formulaStats, warnings, limitations: questions, sourceFileName: path.basename(file), format: ext.slice(1),
  };
  store.tx(store.raw, () => {
    const ins = store.raw.prepare('INSERT INTO ref_rows (ref_id, sheet, row_no, data) VALUES (?,?,?,?)');
    for (const [sheet, rows] of Object.entries(sheets)) rows.forEach((r, i) => { if (r && r.length) ins.run(id + ':' + version, sheet, i, JSON.stringify(r)); });
  });
  store.knowledge.prepare('INSERT INTO ref_reports (id, name, version, checksum, meta, status, imported) VALUES (?,?,?,?,?,?,?)')
    .run(id + ':' + version, meta.name, version, checksum, JSON.stringify(record), status, store.now());
  store.audit('owner', 'reference.register', { name: meta.name, version, checksum, status });
  return { id: id + ':' + version, version, status, warnings, questions };
}

function confirm(store, refId, { period, cutoff }) {
  if (!PERIOD.test(String(period))) throw new Error('reference: period must be YYYYMM');
  const r = store.knowledge.prepare('SELECT meta FROM ref_reports WHERE id = ?').get(refId);
  if (!r) throw new Error('reference: unknown');
  const m = JSON.parse(r.meta);
  m.period = String(period); m.cutoff = cutoff; m.periodSuggestion = null;
  m.limitations = m.limitations.filter(l => !/period not stated|cutoff date not stated/i.test(l));
  store.knowledge.prepare('UPDATE ref_reports SET meta = ?, status = ? WHERE id = ?').run(JSON.stringify(m), 'registered', refId);
  store.audit('owner', 'reference.confirm', { refId, period });
}

/* The owner may record that one reference cell was edited by hand (found as a formula in a VP export) and give the value VP itself
   produced. The note and value live in the protected store, never in git; the reference file is not touched. Each use is flagged. */
/* VP Earnings reports come in two layouts and this reads both:
     summary: the group heading row (Principal Name: X / Project Type: X) carries the numbers itself
     detail:  a group heading, then 'Project Number: N' rows each followed by a numbered row, then 'Total for' and a numbered row
              holding the group total. The numbers sit under the headers Total Billed, Direct Consultant, Architectural Revenue.
   Returns { groups: [{ name, billed, consultant, arch }], projects: [{ group, project, billed, consultant, arch }] } as exact Dec values. */
function readEarnings(store, refId, { sheet, groupPrefix }) {
  const rows = store.raw.prepare('SELECT row_no, data FROM ref_rows WHERE ref_id = ? AND sheet = ? ORDER BY row_no').all(refId, sheet).map(r => JSON.parse(r.data));
  const want = { billed: 'total billed', consultant: 'direct consultant', arch: 'architectural revenue' };
  let idx = null, start = -1;
  for (let i = 0; i < Math.min(rows.length, 40) && !idx; i++) {
    const heads = rows[i].map(c => (c && c.t && c.num === 0 ? norm(c.t) : ''));
    if (Object.values(want).every(w => heads.includes(w))) { idx = Object.fromEntries(Object.entries(want).map(([k, w]) => [k, heads.indexOf(w)])); start = i; }
  }
  if (!idx) throw new Error('reference: no Total Billed / Direct Consultant / Architectural Revenue header found');
  const groups = [], projects = [];
  const num = (cells, i) => (cells[i] && cells[i].num === 1 && cells[i].t !== null ? Dec.parse(cells[i].t, { round: true }) : null);
  let group = null, pending = null, finished = false;
  const prefix = new RegExp('^' + groupPrefix.replace(/[^A-Za-z0-9 :]/g, '') + '\\s*', 'i'); // prefixes come from our own spec files
  for (const cells of rows.slice(start + 1)) {
    const label = (cells[0] && cells[0].t && cells[0].num === 0 ? String(cells[0].t).replace(/\s+/g, ' ').trim() : '');
    const vals = { billed: num(cells, idx.billed), consultant: num(cells, idx.consultant), arch: num(cells, idx.arch) };
    const hasNums = vals.billed !== null && vals.arch !== null;
    if (prefix.test(label)) {
      group = label.replace(prefix, '').trim(); pending = null;
      if (hasNums) groups.push({ name: group, ...vals });
      continue;
    }
    const pm = /^Project Number:\s*(\d{7}\.\d{2})/.exec(label);
    if (pm) { pending = pm[1]; continue; }
    if (/^final/i.test(label)) { finished = true; pending = null; continue; } // everything after 'Final Totals' is the firm line: the sum of the groups
    if (finished) continue;
    if (hasNums) {
      if (pending) projects.push({ group: group ?? '', project: pending, ...vals });
      else if (group !== null || /^ytd/i.test(label)) groups.push({ name: group ?? '', ...vals });
      pending = null;
    } else pending = null; // a 'Total for ...' row closes the group: the numbered row after it is the group total, not a project
  }
  return { groups, projects };
}

function acknowledgeEdit(store, refId, { sheet, rowContains, column, value, reason }) {
  Dec.parse(value, { round: true });
  const key = 'ack:' + refId, cur = store.raw.prepare('SELECT v FROM kv WHERE k = ?').get(key);
  const list = cur ? JSON.parse(cur.v) : [];
  list.push({ sheet, rowContains: String(rowContains), column, value: String(value), reason: String(reason || '').slice(0, 300) });
  store.raw.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').run(key, JSON.stringify(list));
  store.audit('owner', 'reference.acknowledge-edit', { refId, sheet, column });
}

function list(store) {
  return store.knowledge.prepare('SELECT id, name, version, status, imported, meta FROM ref_reports ORDER BY name, version').all()
    .map(r => { const m = JSON.parse(r.meta); return { id: r.id, name: r.name, version: r.version, status: r.status, importedAt: new Date(r.imported).toISOString(), kind: m.kind, period: m.period, warningCount: m.warnings.length, openQuestionCount: m.limitations.length }; });
}

/* Read a stored sheet as records. columns maps our field name -> header text (exact, case-insensitive) in the file.
   Numeric fields are returned as exact Dec values. headerRow is 0-based; if omitted the first row with >=2 text cells is used.
   Rows that look like totals can be dropped with skipRow(record). Formula cells without a cached value throw unless allowMissing. */
const norm = v => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase(); // VP headers wrap onto two lines

function readDataset(store, refId, { sheet, headerRow = null, columns, numeric = [], skipRow = null, allowMissing = false, clean = {}, extract = {}, requireNumeric = [] }) {
  const meta = store.knowledge.prepare('SELECT meta, status FROM ref_reports WHERE id = ?').get(refId);
  if (!meta) throw new Error('reference: unknown');
  const ackRow = store.raw.prepare('SELECT v FROM kv WHERE k = ?').get('ack:' + refId), acks = ackRow ? JSON.parse(ackRow.v) : [];
  const rows = store.raw.prepare('SELECT row_no, data FROM ref_rows WHERE ref_id = ? AND sheet = ? ORDER BY row_no').all(refId, sheet).map(r => ({ no: r.row_no, cells: JSON.parse(r.data) }));
  if (!rows.length) throw new Error('reference: no stored rows for that sheet');
  const isCsv = JSON.parse(meta.meta).format === 'csv';
  // a column can be named by its header text, or by position as '@1' when the header cell is blank
  const colIndexOf = name => (/^@\d+$/.test(name) ? Number(name.slice(1)) : header.findIndex(x => x === norm(name)));
  const cell = (cells, i) => (cells[i] && cells[i].t !== null && cells[i].t !== undefined ? cells[i] : null);
  let header, body;
  if (isCsv) { header = Object.keys(rows[0].cells[0]); body = rows.map(r => ({ no: r.no, get: h => ({ k: 'value', t: r.cells[0][h] }) })); }
  else {
    let h = headerRow;
    if (h === null) h = rows.findIndex(r => r.cells.filter(c => c && c.num === 0 && c.t).length >= 2);
    const hr = rows.find(r => r.no === h);
    if (!hr) throw new Error('reference: header row not found');
    header = hr.cells.map(c => (c && c.t ? norm(c.t) : ''));
    body = rows.filter(r => r.no > h).map(r => ({ no: r.no, get: name => { const i = colIndexOf(name); return i < 0 ? null : r.cells[i] || null; } }));
  }
  for (const want of Object.values(columns)) if (!isCsv && colIndexOf(want) < 0 || (isCsv && !header.some(x => norm(x) === norm(want)))) throw new Error(`reference: column "${String(want).slice(0, 40)}" not found in the sheet`);
  const out = [];
  for (const r of body) {
    const rec = { _row: r.no };
    let any = false;
    for (const [field, head] of Object.entries(columns)) {
      const c = r.get(head);
      if (!c || c.t === null || c.t === undefined || c.t === '') {
        if (c && c.k === 'formula-no-cache') { if (!allowMissing) throw new Error(`reference: row ${r.no + 1} "${head}" is a formula with no stored result; refusing to treat it as zero`); rec[field] = null; rec._missing = true; }
        else rec[field] = null;
        continue;
      }
      any = true;
      rec[field] = numeric.includes(field) ? Dec.parse(c.t, { round: true }) : String(c.t).trim(); // Excel doubles: rounded to 8 places, far below a cent
      if (extract[field] && typeof rec[field] === 'string') { const m = new RegExp(extract[field]).exec(rec[field]); rec[field] = m ? m[0] : rec[field]; } // e.g. a project number inside 'Name (0022050.00)'
      if (clean[field] && typeof rec[field] === 'string') rec[field] = rec[field].replace(new RegExp(clean[field], 'i'), '').trim();
    }
    if (requireNumeric.some(f => rec[f] === null)) continue; // label-only rows (group headings)
    for (const a of acks) {
      if (a.sheet !== sheet) continue;
      const field = Object.keys(columns).find(f => norm(columns[f]) === norm(a.column));
      if (field && Object.values(rec).some(v => typeof v === 'string' && v.toLowerCase().includes(a.rowContains.toLowerCase()))) { rec[field] = Dec.parse(a.value, { round: true }); rec._acknowledgedEdit = true; }
    }
    if (!any) continue;
    if (skipRow && skipRow(rec)) continue;
    out.push(rec);
  }
  return out;
}

module.exports = { KINDS, register, confirm, acknowledgeEdit, readEarnings, list, readDataset, suggestPeriod, sha256 };
