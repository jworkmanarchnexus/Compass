'use strict';
const test = require('node:test');
const assert = require('node:assert');
const W = require('../logic/watch');
const fx = require('./fixtures/watch.json');

const picName = c => fx.names[c];
const byKey = (a, b) => (a.rule + a.pic).localeCompare(b.rule + b.pic);

test('alerts: every rule, with the words that explain it', () => {
  const got = W.evaluate({ history: fx.history, projects: fx.projects, rules: fx.rules, picName }).sort(byKey);
  const want = fx.expectAlerts.slice().sort(byKey);
  assert.deepStrictEqual(got.map(a => [a.rule, a.severity, a.pic, a.title]), want.map(a => [a.rule, a.severity, a.pic, a.title]));
  want.forEach((w, i) => { for (const t of w.includes) assert.ok(got[i].message.includes(t), `${w.rule}: "${t}" is missing from "${got[i].message}"`); });
});

test('a rule set to off makes no alert, and a watch stays a watch', () => {
  const rules = JSON.parse(JSON.stringify(fx.rules));
  rules.mwipDrop.sev = 'off'; rules.noNew.sev = 'alert';
  const got = W.evaluate({ history: fx.history, projects: fx.projects, rules, picName });
  assert.ok(!got.some(a => a.rule === 'mwipDrop'));
  assert.strictEqual(got.find(a => a.rule === 'noNew').severity, 'alert');
});

test('a pursuit that became a project is a conversion, not an alert', () => {
  const conv = W.conversions(fx.history, fx.projects, picName);
  assert.deepStrictEqual(conv.map(c => [c.id, c.pic, c.message]), fx.expectConversions.map(c => [c.id, c.pic, c.message]));
  assert.ok(!W.evaluate({ history: fx.history, projects: fx.projects, rules: fx.rules, picName }).some(a => /Delta/.test(a.title)));
});

test('the weekly table: values, this week, against four weeks ago, new pursuits and moved amounts', () => {
  for (const kind of ['mwip', 'forecast']) {
    const t = W.picRows({ history: fx.history, kind, projects: fx.projects, weeks: 8 });
    for (const [pic, want] of Object.entries(fx.expectRows[kind])) {
      const row = pic === 'firm' ? t.firm : t.rows.find(r => r.pic === pic);
      for (const [k, v] of Object.entries(want)) assert.deepStrictEqual(row[k], v, `${kind} ${pic} ${k}`);
    }
  }
});

test('only the last eight snapshots are shown, and a short history has no change to report', () => {
  const t = W.picRows({ history: fx.history, kind: 'mwip', projects: [], weeks: 3 });
  assert.strictEqual(t.rows[0].values.length, 3);
  const one = W.picRows({ history: fx.history.slice(0, 1), kind: 'mwip', projects: [], weeks: 8 });
  assert.strictEqual(one.rows[0].thisWeek, null);
  assert.strictEqual(one.rows[0].vs4, null);
  assert.deepStrictEqual(W.evaluate({ history: [], projects: [], rules: fx.rules }), []);
});

test('what changed between two snapshots', () => {
  const log = W.pursuitLog(fx.history, fx.projects);
  const ch = W.changes(fx.history[3], fx.history[4], log);
  const kinds = Object.fromEntries(ch.map(c => [c.id, c.kind + (c.outcome ? ':' + c.outcome : '')]));
  assert.deepStrictEqual(kinds, { '2026-0201': 'changed', '2026-0102': 'left:no_match', '2026-0104': 'left:converted' });
});

test('Monday of a week', () => {
  assert.strictEqual(W.mondayOf('2026-10-07'), '2026-10-05');
  assert.strictEqual(W.mondayOf('2026-10-05'), '2026-10-05');
  assert.strictEqual(W.mondayOf('2026-10-11'), '2026-10-05');
});

test('pipeline.css carries no hex colors (tokens only)', () => {
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '../ui/pipeline.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), 'hex color in pipeline.css');
});
