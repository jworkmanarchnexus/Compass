'use strict';
const test = require('node:test');
const assert = require('node:assert');
const roles = require('../roles');
const settings = require('../settings');
const roleFx = require('./fixtures/roles.json');
const setFx = require('./fixtures/settings.json');

test('roles: who can view which area', () => {
  for (const c of roleFx.canView) {
    const seen = roles.AREAS.filter(a => roles.canView(c.role, a, c.access));
    assert.deepStrictEqual(seen, roles.AREAS.filter(a => c.see.includes(a)), `${c.role} ${JSON.stringify(c.access)}`);
  }
});
test('roles: admin tabs', () => {
  for (const c of roleFx.adminTab) assert.strictEqual(roles.adminTab(c.role, c.tab), c.expect, `${c.role}/${c.tab}`);
});
test('roles: the last active admin is protected', () => {
  for (const c of roleFx.canChangeUser) assert.deepStrictEqual(roles.canChangeUser(c.users, c.target, c.change), c.expect, c.name);
});
test('settings: effective dating', () => {
  for (const c of setFx.settingAt) assert.deepStrictEqual(settings.settingAt(c.rows, c.key, c.at), c.expect, c.name);
});
test('settings: validation', () => {
  for (const c of setFx.valid) assert.strictEqual(settings.isValid(c.key, c.value), c.expect, `${c.key}=${JSON.stringify(c.value)}`);
});
test('settings: rules that span several settings', () => {
  for (const c of setFx.crossCheck) assert.strictEqual(settings.crossCheck(Object.assign({}, settings.DEFAULTS, c.changes)) === null, c.ok, c.name);
});
test('settings: every default is itself valid', () => {
  for (const [k, v] of Object.entries(settings.DEFAULTS)) assert.ok(settings.isValid(k, v), k);
});
