'use strict';
const test = require('node:test');
const assert = require('node:assert');
const B = require('../logic/boards');
const { CATALOGS } = require('../logic/catalog');
const fx = require('./fixtures/boards.json');

test('which dashboards a person has follows the projects they are PIC or PM on', () => {
  for (const c of fx.cases) assert.deepStrictEqual(B.boardsFor(c.person), c.expect, c.why);
  assert.deepStrictEqual(B.boardsFor(null), []);
});

test('every dashboard has a catalog and a name', () => {
  for (const b of B.BOARDS) { assert.ok(Array.isArray(CATALOGS[b]) && CATALOGS[b].length, b); assert.ok(B.BOARD_LABEL[b], b); }
});
