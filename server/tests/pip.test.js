'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { start } = require('./helpers');
const settingsRules = require('../../shared/rules/settings');
const F = require('../../modules/pip/logic/form');

const GOOD = {
  name: 'Granite Ridge Library', stage: 'Shortlisted', prob: '40', source: 'Referral', resp: 'Prime', direct: 'No',
  client: 'C100', contact: 'K100', ptype: 'K-12 Education', deliv: 'New Construction', desc: 'A new library wing.',
  office: 'Salt Lake', principal: 'E101', pm: 'E201', delivery: 'CM at Risk', comp: 'Fixed Fee', fee: '$450,000', start: '2027-03-01', end: '2028-06-30',
};

test('settings: the PiP stage table default matches the rule\'s default', () => {
  assert.deepStrictEqual(settingsRules.DEFAULTS['pip.stageProbabilities'], F.DEFAULT_STAGE_PROBS);
  assert.ok(settingsRules.isValid('pip.stageProbabilities', F.DEFAULT_STAGE_PROBS));
  assert.ok(!settingsRules.isValid('pip.stageProbabilities', Object.assign({}, F.DEFAULT_STAGE_PROBS, { Awarded: [100] })));
});

test('who sees Projects in Pursuit, who submits and who reviews', async () => {
  const { api, close } = await start();
  try {
    const me = async who => (await api(who).get('/api/me')).body;
    for (const [who, want] of [['j.workman', { see: true, submit: true, review: true }], ['d.whitfield', { see: true, submit: true, review: false }], ['a.ruiz', { see: true, submit: true, review: false }],
      ['karen.acct', { see: true, submit: false, review: true }], ['c.brandt', { see: true, submit: false, review: true }], ['m.hale', { see: false, submit: false, review: false }], ['kent', { see: false, submit: false, review: false }]]) {
      const m = await me(who);
      assert.deepStrictEqual(m.pip, want, who);
      assert.strictEqual(m.areas.pip, want.see, who);
    }
    assert.strictEqual((await api('m.hale').get('/api/pip')).status, 403, 'Finance does not see PiPs');
    assert.strictEqual((await api('m.hale').get('/api/pip/form')).status, 403);
    assert.strictEqual((await api('karen.acct').post('/api/pip', { fields: GOOD })).status, 403, 'a PiP admin does not submit');
    assert.strictEqual((await api().get('/api/pip')).status, 401);
  } finally { await close(); }
});

test('submit: the server checks every rule, stores a clean copy and queues the emails', async () => {
  const { api, db, user, close } = await start();
  try {
    const dana = api('d.whitfield');
    const bad = await dana.post('/api/pip', { fields: Object.assign({}, GOOD, { prob: '60', principal: 'E205' }) });
    assert.strictEqual(bad.status, 400);
    assert.deepStrictEqual(bad.body.problems.map(p => p.field).sort(), ['principal', 'prob']);
    assert.strictEqual(db.get('SELECT COUNT(*) AS n FROM pip_requests').n, 0, 'nothing is saved');

    const made = await dana.post('/api/pip', { fields: Object.assign({}, GOOD, { hack: 'x', hvac: 'Yes' }) });
    assert.strictEqual(made.status, 201);
    assert.strictEqual(made.body.seq, 1);
    const d = (await dana.get('/api/pip/' + made.body.id)).body;
    assert.strictEqual(d.status, 'new');
    assert.strictEqual(d.fields.fee, 450000);
    assert.strictEqual(d.fields.prob, 40);
    assert.strictEqual(d.fields.hvac, '', 'a question not asked is not stored');
    assert.ok(!('hack' in d.fields));
    assert.strictEqual(d.fields.urgency, '0-6 Months', 'urgency on the day it was sent (2026-10-11 + 6 months)');
    assert.strictEqual(d.resolved.client, 'Granite Ridge School District');
    assert.strictEqual(d.aia2030.key, 'rep');
    assert.deepStrictEqual(d.actions, ['withdraw'], 'the submitter can only withdraw while it waits');
    assert.deepStrictEqual(d.emails[0].to.map(t => t.why), ['Principal', 'Project manager', 'PiP admin']);

    const big = await api('a.ruiz').post('/api/pip', { fields: Object.assign({}, GOOD, { fee: 1000000 }) });
    const bd = (await api('a.ruiz').get('/api/pip/' + big.body.id)).body;
    assert.ok(bd.emails[0].to.some(t => t.why === 'CFO'), 'the CFO is told at $1M');
    assert.strictEqual(bd.submittedById, user('a.ruiz').id);
  } finally { await close(); }
});

test('review: return with a note, resubmit by the submitter only, mark created with the number', async () => {
  const { api, db, close } = await start();
  try {
    const dana = api('d.whitfield'), karen = api('karen.acct');
    const { id } = (await dana.post('/api/pip', { fields: GOOD })).body;
    assert.strictEqual((await dana.post(`/api/pip/${id}/review`, { status: 'new' })).status, 403, 'only a PiP admin reviews');
    assert.strictEqual((await karen.post(`/api/pip/${id}/review`, { status: 'review' })).status, 409, 'it moved since you looked');
    assert.strictEqual((await karen.post(`/api/pip/${id}/review`, { status: 'new' })).body.status, 'review');
    assert.strictEqual((await karen.post(`/api/pip/${id}/return`, { status: 'review', note: '' })).status, 400, 'a return needs a note');
    const ret = await karen.post(`/api/pip/${id}/return`, { status: 'review', note: 'Please use the gross fee.' });
    assert.strictEqual(ret.body.status, 'returned');
    assert.deepStrictEqual(ret.body.emails.pop().to.map(t => t.name), ['Dana Whitfield'], 'the submitter is told');

    assert.strictEqual((await api('a.ruiz').post(`/api/pip/${id}/resubmit`, { status: 'returned', fields: GOOD })).status, 403, 'only the submitter resubmits');
    assert.strictEqual((await dana.post(`/api/pip/${id}/resubmit`, { status: 'returned', fields: Object.assign({}, GOOD, { name: '' }) })).status, 400, 'a resubmission is checked too');
    const again = await dana.post(`/api/pip/${id}/resubmit`, { status: 'returned', fields: Object.assign({}, GOOD, { fee: '520000' }) });
    assert.strictEqual(again.body.status, 'new');
    assert.strictEqual(again.body.rev, 2);
    assert.strictEqual(again.body.fields.fee, 520000);

    assert.strictEqual((await karen.post(`/api/pip/${id}/created`, { status: 'new' })).status, 400, 'needs the project number');
    const done = await karen.post(`/api/pip/${id}/created`, { status: 'new', number: '2024-0207' });
    assert.strictEqual(done.body.status, 'created');
    assert.deepStrictEqual(done.body.vpFound, { wbs1: '2024-0207', name: 'Airfield Maintenance Facility' }, 'found in the Vantagepoint copy');
    assert.deepStrictEqual(done.body.actions, []);
    assert.strictEqual((await dana.post(`/api/pip/${id}/withdraw`, { status: 'created', note: 'x' })).status, 409, 'created is final');

    const home = (await api('a.ruiz').get('/api/pip')).body;
    assert.deepStrictEqual(home.waiting, []);
    assert.deepStrictEqual(home.recent.map(r => [r.name, r.status, r.vpNumber]), [['Granite Ridge Library', 'created', '2024-0207']]);
    assert.deepStrictEqual(db.all('SELECT action FROM pip_events WHERE request_id = ? ORDER BY id', id).map(e => e.action), ['submit', 'review', 'return', 'resubmit', 'created']);
  } finally { await close(); }
});

test('nothing is deleted or rewritten: revisions, events and emails are append-only; a created PiP is locked', async () => {
  const { api, db, close } = await start();
  try {
    const { id } = (await api('d.whitfield').post('/api/pip', { fields: GOOD })).body;
    assert.throws(() => db.run('UPDATE pip_revisions SET fields_json = ? WHERE request_id = ?', '{}', id), /never changed/);
    assert.throws(() => db.run('DELETE FROM pip_revisions WHERE request_id = ?', id), /never deleted/);
    assert.throws(() => db.run("UPDATE pip_events SET note = 'x'"), /never changed/);
    assert.throws(() => db.run('DELETE FROM pip_events'), /never deleted/);
    assert.throws(() => db.run("UPDATE pip_notifications SET subject = 'x'"), /never changed/);
    assert.throws(() => db.run('DELETE FROM pip_requests WHERE id = ?', id), /withdraw one instead/);
    await api('karen.acct').post(`/api/pip/${id}/created`, { status: 'new', number: 'P26-0001' });
    assert.throws(() => db.run("UPDATE pip_requests SET status = 'new' WHERE id = ?", id), /no more changes/);
  } finally { await close(); }
});

test('settings: PiP people must be real; a viewer can read but not act', async () => {
  const { api, user, close } = await start();
  try {
    const josh = api('j.workman');
    assert.strictEqual((await josh.put('/api/admin/settings', { changes: { 'pip.admins': ['nobody'] } })).status, 400);
    assert.strictEqual((await josh.put('/api/admin/settings', { changes: { 'pip.cfo': 'nobody' } })).status, 400);
    assert.strictEqual((await josh.put('/api/admin/settings', { changes: { 'pip.viewers': [user('m.hale').id] } })).status, 200);
    const { id } = (await api('d.whitfield').post('/api/pip', { fields: GOOD })).body;
    const seen = await api('m.hale').get('/api/pip/' + id);
    assert.strictEqual(seen.status, 200, 'a viewer reads the full PiP');
    assert.deepStrictEqual(seen.body.actions, []);
    assert.strictEqual((await api('m.hale').post(`/api/pip/${id}/withdraw`, { status: 'new', note: 'x' })).status, 403);
    // a narrower stage table applies at once
    assert.strictEqual((await josh.put('/api/admin/settings', { changes: { 'pip.stageProbabilities': Object.assign({}, F.DEFAULT_STAGE_PROBS, { Shortlisted: [30] }) } })).status, 200);
    assert.strictEqual((await api('d.whitfield').post('/api/pip', { fields: GOOD })).status, 400, '40% is no longer allowed for Shortlisted');
  } finally { await close(); }
});
