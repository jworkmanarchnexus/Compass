'use strict';
/* Local .xlsx reader with no dependencies. It reads cell data only: it never runs macros (.xlsm VBA is not touched),
   never follows external links, and never evaluates formulas. For every cell it keeps:
     kind:    'value' (hardcoded) | 'formula' (has a formula and a cached result) | 'formula-no-cache' (formula, no cached result) | 'empty'
     text:    the cached or typed value as written in the file (a string, so no precision is lost)
     formula: the formula text, if any
   A formula with no cached result is reported as such; it is never treated as zero. */
const fs = require('node:fs');
const zlib = require('node:zlib');

const MAX_ENTRY_BYTES = 200 * 1024 * 1024;

function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('xlsx: not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('xlsx: bad zip directory');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    entries.set(name, { method, csize, usize, off });
    p += 46 + nlen + elen + clen;
  }
  const read = name => {
    const e = entries.get(name);
    if (!e) return null;
    if (e.usize > MAX_ENTRY_BYTES) throw new Error('xlsx: entry too large');
    const o = e.off, data = buf.subarray(o + 30 + buf.readUInt16LE(o + 26) + buf.readUInt16LE(o + 28), o + 30 + buf.readUInt16LE(o + 26) + buf.readUInt16LE(o + 28) + e.csize);
    return (e.method === 0 ? data : zlib.inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES })).toString('utf8');
  };
  return { names: [...entries.keys()], read };
}

const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');
const attr = (tag, name) => { const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag); return m ? unesc(m[1]) : null; };

function colIndex(ref) { let n = 0; for (const ch of /^[A-Z]+/.exec(ref)[0]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; }

function sharedStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => unesc([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')));
}

function parseSheet(xml, strings) {
  const rows = [];
  for (const rm of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rn = parseInt(attr(rm[0], 'r') || String(rows.length + 1), 10);
    const cells = [];
    for (const cm of (rm[1] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(cm[1], 'r'), type = attr(cm[1], 't'), body = cm[2] || '';
      const f = /<f\b[^>]*?(?:\/>|>([\s\S]*?)<\/f>)/.exec(body);
      const v = /<v>([\s\S]*?)<\/v>/.exec(body);
      const is = /<is>([\s\S]*?)<\/is>/.exec(body);
      let text = null;
      if (type === 's' && v) text = strings[parseInt(v[1], 10)];
      else if (type === 'inlineStr' && is) text = unesc([...is[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join(''));
      else if (v) text = unesc(v[1]);
      const formula = f ? unesc(f[1] || '') : null;
      const kind = f ? (text === null ? 'formula-no-cache' : 'formula') : (text === null ? 'empty' : 'value');
      if (kind !== 'empty' || formula) cells[colIndex(ref || 'A')] = { kind, text, formula, numeric: type === null || type === 'n' };
    }
    rows[rn - 1] = cells;
  }
  return rows;
}

function readWorkbook(file) {
  const zip = readZip(fs.readFileSync(file));
  const wb = zip.read('xl/workbook.xml');
  if (!wb) throw new Error('xlsx: no workbook');
  const rels = zip.read('xl/_rels/workbook.xml.rels') || '';
  const target = Object.fromEntries([...rels.matchAll(/<Relationship\b[^>]*>/g)].map(m => [attr(m[0], 'Id'), attr(m[0], 'Target')]));
  const strings = sharedStrings(zip.read('xl/sharedStrings.xml'));
  const sheets = [...wb.matchAll(/<sheet\b[^>]*>/g)].map(m => {
    const rid = attr(m[0], 'r:id'), t = (target[rid] || '').replace(/^\//, '');
    const path = t.startsWith('xl/') ? t : 'xl/' + t;
    return { name: attr(m[0], 'name'), path, state: attr(m[0], 'state') || 'visible' };
  });
  return {
    hasMacros: zip.names.some(n => /vbaProject\.bin$/i.test(n)),
    hasExternalLinks: zip.names.some(n => /^xl\/externalLinks\//.test(n)),
    sheetNames: sheets.map(s => s.name),
    sheet(name) {
      const s = sheets.find(x => x.name === name);
      if (!s) throw new Error('xlsx: no such sheet');
      const xml = zip.read(s.path);
      if (!xml) throw new Error('xlsx: sheet data missing');
      return parseSheet(xml, strings);
    },
  };
}

module.exports = { readWorkbook, readZip, colIndex };
