'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createServer } = require('./app');

test('serves the shell, the design system, and refuses everything else', async () => {
  const srv = createServer().listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    assert.strictEqual((await fetch(base + '/')).status, 200);
    assert.strictEqual((await fetch(base + '/shared/design-system/toolbox.css')).status, 200);
    assert.deepStrictEqual(await (await fetch(base + '/api/health')).json(), { ok: true, app: 'compass' });
    assert.strictEqual((await fetch(base + '/package.json')).status, 404);
    assert.strictEqual((await fetch(base + '/reference/handoff/CLAUDE.md')).status, 404);
  } finally { srv.close(); }
});
