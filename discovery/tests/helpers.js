'use strict';
/* Synthetic data only. Nothing here comes from Archnexus or Vantagepoint. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { DatabaseSync } = require('node:sqlite');
const { openStore } = require('../store');
const { createGateway } = require('../gateway');
const registry = require('../registry');
const { loadConfig } = require('../../server/vp/config');
const { assertReadOnlySql } = require('../../server/vp/policy');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nx-disc-'));
const rm = d => fs.rmSync(d, { recursive: true, force: true });

/* a tiny dictionary with the same shape as the real one */
function writeDictionary(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'tables.csv'), 'Table,Definition,ColumnCount,Keys\nPR,Projects,9,PRPK (PKey)\nLedgerAR,Accounts receivable ledger,6,LedgerARPK (PKey)\nEMMain,Employees,3,EMPK (PKey)\nSecret,Not approved,1,\n');
  const cols = [
    ['PR', 'WBS1', 'Y', '', 'nvarchar(30)', 'NO', 'Project number'], ['PR', 'WBS2', 'Y', '', 'nvarchar(30)', 'NO', 'Phase'],
    ['PR', 'Fee', '', '', 'decimal(19, 4)', 'YES', 'Contract fee'], ['PR', 'ConsultFee', '', '', 'decimal(19, 4)', 'YES', 'Consultant fee'],
    ['PR', 'Revenue', '', '', 'decimal(19, 4)', 'YES', 'Revenue earned to date'], ['PR', 'Principal', '', '', 'nvarchar(20)', 'YES', 'Principal in charge employee'],
    ['PR', 'ProjectType', '', '', 'nvarchar(10)', 'YES', 'Project type used as market sector'],
    ['LedgerAR', 'WBS1', '', '', 'nvarchar(30)', 'NO', 'Project'], ['LedgerAR', 'Period', '', '', 'int', 'NO', 'Accounting period'],
    ['LedgerAR', 'Amount', '', '', 'decimal(19, 4)', 'NO', 'Billed invoice amount'], ['LedgerAR', 'TransType', '', '', 'nvarchar(2)', 'NO', 'IN invoice, CR cash receipt'],
    ['EMMain', 'Employee', 'Y', '', 'nvarchar(20)', 'NO', 'Employee id'], ['EMMain', 'LastName', '', '', 'nvarchar(30)', 'YES', 'Last name'],
    ['Secret', 'Notes', '', '', 'nvarchar(10)', 'YES', 'Hidden'],
  ];
  fs.writeFileSync(path.join(dir, 'columns.csv'), 'Table,Column,PrimaryKey,Domain,DataType,Nullable,Description\n' + cols.map(r => r.map(v => `"${v}"`).join(',')).join('\n') + '\n');
}

function freshContext({ rowLimit = 200 } = {}) {
  const dir = tmp();
  const store = openStore(dir);
  const gateway = createGateway(store);
  const cfg = { ...loadConfig({}, '/nonexistent'), dsn: 'Test', user: 'tester.acct', password: 'Pw!Secret9', rowLimit };
  const dict = path.join(dir, 'dict'); writeDictionary(dict);
  registry.importDictionary(store, dict);
  return { dir, store, gateway, cfg, close() { store.close(); rm(dir); } };
}

/* a fake Vantagepoint: synthetic tables in SQLite, queried through the real policy, same statements the operations build */
function fakeVp(setup) {
  const db = new DatabaseSync(':memory:');
  db.exec("ATTACH ':memory:' AS dbo");
  db.exec(`CREATE TABLE dbo.PR (WBS1 TEXT, WBS2 TEXT, Fee REAL, ConsultFee REAL, Revenue REAL, Principal TEXT, ProjectType TEXT);
    CREATE TABLE dbo.LedgerAR (WBS1 TEXT, Period INT, Amount REAL, TransType TEXT);
    CREATE TABLE dbo.EMMain (Employee TEXT, LastName TEXT);
    CREATE TABLE dbo.Secret (Notes TEXT);`);
  if (setup) setup(db);
  return {
    db, calls: [],
    async query(sql, { rowLimit = 200 } = {}) {
      assertReadOnlySql(sql);
      this.calls.push(sql);
      const all = db.prepare(sql).all();
      return { rows: all.slice(0, rowLimit).map(r => ({ ...r })), truncated: all.length > rowLimit };
    },
    async close() {},
  };
}

/* minimal .xlsx writer (stored entries) so tests can build workbooks with formulas, missing caches, macros */
function crc(buf) { return zlib.crc32(buf) >>> 0; }
function zip(files) {
  const parts = [], central = []; let off = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, 'utf8'), nm = Buffer.from(name), c = crc(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(c, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
    parts.push(lh, nm, data);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(c, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, nm); off += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}

/* sheets: { name: [[cell, ...], ...] } ; cell: string | number | {f:'SUM(A1)', v:'12'} | {f:'x'} (no cache) | null */
function xlsx(file, sheets, { macros = false } = {}) {
  const names = Object.keys(sheets), esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const col = i => String.fromCharCode(65 + i);
  const sheetXml = rows => '<?xml version="1.0"?><worksheet><sheetData>' + rows.map((r, ri) => `<row r="${ri + 1}">` + r.map((c, ci) => {
    if (c === null || c === undefined) return '';
    const ref = `${col(ci)}${ri + 1}`;
    if (typeof c === 'number') return `<c r="${ref}"><v>${c}</v></c>`;
    if (typeof c === 'object') return `<c r="${ref}"><f>${esc(c.f)}</f>${c.v !== undefined ? `<v>${c.v}</v>` : ''}</c>`;
    return `<c r="${ref}" t="inlineStr"><is><t>${esc(c)}</t></is></c>`;
  }).join('') + '</row>').join('') + '</sheetData></worksheet>';
  const files = {
    'xl/workbook.xml': '<?xml version="1.0"?><workbook xmlns:r="r"><sheets>' + names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships>' + names.map((n, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join('') + '</Relationships>',
  };
  names.forEach((n, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(sheets[n]); });
  if (macros) files['xl/vbaProject.bin'] = 'not real macros';
  fs.writeFileSync(file, zip(files));
  return file;
}

module.exports = { tmp, rm, freshContext, fakeVp, xlsx, writeDictionary };
