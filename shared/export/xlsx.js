/* ===== A minimal Excel (.xlsx) writer =====
   Pure: no DOM, no network, no dependencies. Turns sheets of rows into the bytes of a real .xlsx file (a zip of XML parts,
   stored without compression), so "Export > Excel" opens in Excel with numbers as numbers and dollars as dollars.

     buildXlsx([{ name, columns: [{ title, type, width }], rows: [[...]] }])  ->  Uint8Array
       type: 'text' (default), 'money' (whole dollars, shown $#,##0), 'pct' (a ratio, shown 0.0%), 'int', 'date' (YYYY-MM-DD text kept as text)
       a null / undefined / '' cell is left empty.

   Works in the browser (window.Xlsx) and in Node (require), so it is tested in shared/export/tests/xlsx.test.js. */
(function () {
'use strict';

const enc = s => new TextEncoder().encode(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

/* column letters: 0 -> A, 25 -> Z, 26 -> AA */
function colName(i) { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }

/* a sheet name Excel accepts: no []:*?/\ , at most 31 characters, unique */
function sheetName(name, used) {
  let n = String(name || 'Sheet').replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sheet';
  let k = 2, base = n;
  while (used.has(n.toLowerCase())) n = (base.slice(0, 28) + ' ' + k++).slice(0, 31);
  used.add(n.toLowerCase());
  return n;
}

const STYLE = { head: 1, money: 2, pct: 3, int: 4, text: 0, date: 0 };

function sheetXml(sheet) {
  const cols = sheet.columns || [];
  const out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'];
  if (cols.length) out.push('<cols>' + cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || Math.max(10, Math.min(60, String(c.title).length + 4))}" customWidth="1"/>`).join('') + '</cols>');
  out.push('<sheetData>');
  out.push('<row r="1">' + cols.map((c, i) => `<c r="${colName(i)}1" t="inlineStr" s="${STYLE.head}"><is><t>${esc(c.title)}</t></is></c>`).join('') + '</row>');
  (sheet.rows || []).forEach((row, ri) => {
    const r = ri + 2;
    const cells = row.map((v, ci) => {
      if (v === null || v === undefined || v === '') return '';
      const type = (cols[ci] && cols[ci].type) || 'text';
      const ref = colName(ci) + r;
      if ((type === 'money' || type === 'pct' || type === 'int') && typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}" s="${STYLE[type]}"><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    }).join('');
    out.push(`<row r="${r}">${cells}</row>`);
  });
  out.push('</sheetData>');
  if (cols.length && (sheet.rows || []).length) out.push(`<autoFilter ref="A1:${colName(cols.length - 1)}${(sheet.rows || []).length + 1}"/>`);
  out.push('</worksheet>');
  return out.join('');
}

const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="2"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0;\\-&quot;$&quot;#,##0"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

function parts(sheets) {
  const used = new Set();
  const named = sheets.map(s => Object.assign({}, s, { name: sheetName(s.name, used) }));
  const files = [];
  files.push(['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    named.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>']);
  files.push(['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>']);
  files.push(['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    named.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>']);
  files.push(['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    named.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
    `<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`]);
  files.push(['xl/styles.xml', STYLES]);
  named.forEach((s, i) => files.push([`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]));
  return files;
}

/* ---- zip, stored (no compression): enough for spreadsheets of a few thousand rows ---- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

function zip(files) {
  const chunks = [], central = [];
  let offset = 0;
  const u16 = v => [v & 0xFF, (v >>> 8) & 0xFF];
  const u32 = v => [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF];
  const DOS_TIME = 0, DOS_DATE = (2026 - 1980) << 9 | 1 << 5 | 1; // a fixed stamp, so the same data gives the same bytes
  for (const [name, text] of files) {
    const nb = enc(name), data = enc(text), crc = crc32(data);
    const local = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(DOS_TIME), ...u16(DOS_DATE), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nb.length), ...u16(0)]);
    chunks.push(local, nb, data);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(DOS_TIME), ...u16(DOS_DATE), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nb.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), nb);
    offset += local.length + nb.length + data.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
  const all = [...chunks, ...central, end];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let p = 0; for (const c of all) { out.set(c, p); p += c.length; }
  return out;
}

function buildXlsx(sheets) {
  if (!Array.isArray(sheets) || !sheets.length) throw new Error('An Excel file needs at least one sheet.');
  return zip(parts(sheets));
}

const api = { buildXlsx, colName, sheetName, crc32, parts, MIME: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else if (typeof window !== 'undefined') window.Xlsx = api;
})();
