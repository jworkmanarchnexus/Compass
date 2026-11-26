'use strict';
const test = require('node:test');
const assert = require('node:assert');
const X = require('../xlsx');

/* read a stored (uncompressed) zip back into { name: text }, checking each CRC */
function unzip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = {};
  let p = 0;
  while (dv.getUint32(p, true) === 0x04034b50) {
    assert.strictEqual(dv.getUint16(p + 8, true), 0, 'stored, not compressed');
    const crc = dv.getUint32(p + 14, true), size = dv.getUint32(p + 18, true), nlen = dv.getUint16(p + 26, true), xlen = dv.getUint16(p + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 30, p + 30 + nlen));
    const data = bytes.subarray(p + 30 + nlen + xlen, p + 30 + nlen + xlen + size);
    assert.strictEqual(X.crc32(data), crc, `CRC of ${name}`);
    out[name] = new TextDecoder().decode(data);
    p += 30 + nlen + xlen + size;
  }
  assert.strictEqual(dv.getUint32(bytes.length - 22, true), 0x06054b50, 'ends with the zip directory');
  assert.strictEqual(dv.getUint16(bytes.length - 22 + 10, true), Object.keys(out).length, 'directory lists every part');
  return out;
}

const sample = [{
  name: 'Projects',
  columns: [{ title: 'Project' }, { title: 'Profit YTD', type: 'money' }, { title: '% of billed', type: 'pct' }, { title: 'Count', type: 'int' }],
  rows: [['Airfield <Maintenance> & Co', -96800, -0.185, 2], ['Sandy Rec', null, '', 0]],
}];

test('the file holds a workbook, styles and one worksheet per sheet', () => {
  const files = unzip(X.buildXlsx(sample.concat([{ name: 'Second', columns: [{ title: 'A' }], rows: [] }])));
  assert.deepStrictEqual(Object.keys(files).sort(), ['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']);
  assert.match(files['xl/workbook.xml'], /<sheet name="Projects" sheetId="1" r:id="rId1"\/><sheet name="Second" sheetId="2" r:id="rId2"\/>/);
});

test('numbers stay numbers with dollar and percent formats; text is escaped; empty cells are left out', () => {
  const s = unzip(X.buildXlsx(sample))['xl/worksheets/sheet1.xml'];
  assert.match(s, /<c r="A1" t="inlineStr" s="1"><is><t>Project<\/t><\/is><\/c>/, 'bold header');
  assert.match(s, /<t xml:space="preserve">Airfield &lt;Maintenance&gt; &amp; Co<\/t>/);
  assert.match(s, /<c r="B2" s="2"><v>-96800<\/v><\/c>/, 'money');
  assert.match(s, /<c r="C2" s="3"><v>-0.185<\/v><\/c>/, 'percent as a ratio');
  assert.match(s, /<c r="D3" s="4"><v>0<\/v><\/c>/, 'a zero is kept');
  assert.doesNotMatch(s, /r="B3"|r="C3"/, 'null and empty cells are left out');
  assert.match(s, /<autoFilter ref="A1:D3"\/>/);
  assert.match(s, /state="frozen"/, 'the header row stays put when scrolling');
});

test('column letters and sheet names follow Excel\'s rules', () => {
  assert.deepStrictEqual([0, 25, 26, 51, 52, 701, 702].map(X.colName), ['A', 'Z', 'AA', 'AZ', 'BA', 'ZZ', 'AAA']);
  const used = new Set();
  assert.strictEqual(X.sheetName('By PIC: Sept/Oct [draft]', used), 'By PIC  Sept Oct  draft');
  assert.strictEqual(X.sheetName('A very long sheet name that runs past the limit', used).length, 31);
  assert.strictEqual(X.sheetName('by pic  sept oct  draft', used), 'by pic  sept oct  draft 2', 'names are unique, ignoring case');
});

test('the same data gives the same bytes, and no sheets is an error', () => {
  assert.deepStrictEqual(X.buildXlsx(sample), X.buildXlsx(sample));
  assert.throws(() => X.buildXlsx([]), /at least one sheet/);
});
