'use strict';
const test = require('node:test');
const assert = require('node:assert');
const S = require('../logic/sanitize');
const fx = require('./fixtures/sanitize.json');

test('rich text: only a few tags survive and nothing can run', () => {
  for (const c of fx.sanitize) assert.strictEqual(S.sanitize(c.in), c.out, JSON.stringify(c.in) + (c.note ? ' (' + c.note + ')' : ''));
});
test('rich text: cleaning twice changes nothing', () => {
  for (const c of fx.sanitize) assert.strictEqual(S.sanitize(S.sanitize(c.in)), S.sanitize(c.in), JSON.stringify(c.in));
});
test('rich text: the words of a note', () => {
  for (const c of fx.plainText) assert.strictEqual(S.plainText(c.in), c.out, JSON.stringify(c.in));
});
test('rich text: a very long note is cut, not refused', () => {
  assert.strictEqual(S.sanitize('a'.repeat(30000), 100).length, 100);
});
