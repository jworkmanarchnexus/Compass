'use strict';
/* Projects in Pursuit: the PiP intake (docs/SPEC-pip.md). Principals and PMs submit; the PiP admins review, return with a note,
   or mark it created in Vantagepoint with its project number. Every rule is in modules/pip/logic and is re-checked here.
   Revisions, events and the email queue are append-only (database triggers). Nothing is ever written to Vantagepoint. */
const crypto = require('node:crypto');
const { HttpError } = require('./errors');
const F = require('../modules/pip/logic/form');
const W = require('../modules/pip/logic/workflow');
const names = require('./names');

/* ---------- settings and people ---------- */
function cfgOf(settings) {
  return {
    stageProbs: settings['pip.stageProbabilities'], cfoThreshold: settings['pip.cfoThreshold'], recentDays: settings['pip.recentDays'],
    admins: settings['pip.admins'], viewers: settings['pip.viewers'], primaryAdmin: settings['pip.primaryAdmin'], cfo: settings['pip.cfo'],
  };
}
const count = (db, col, code) => code ? db.get(`SELECT COUNT(*) AS n FROM projects WHERE status = 'A' AND ${col} = ?`, code).n : 0;
function personOf(db, user) {
  return { id: user.id, role: user.role, employeeCode: user.employee_code || '', picProjects: count(db, 'principal', user.employee_code), pmProjects: count(db, 'proj_mgr', user.employee_code) };
}
function permsOf(db, user, settings) { return W.perms(personOf(db, user), cfgOf(settings)); }

function requireSee(db, user, settings) {
  if (!permsOf(db, user, settings).see) throw new HttpError(403, 'You do not have access to this.');
}

/* ---------- the pickers, from the Vantagepoint copy ---------- */
function pickers(db) {
  const shown = names.employeeNames(db);
  const emps = db.all('SELECT code, licensed FROM employees').map(e => ({ code: e.code, name: shown[e.code] || e.code, licensed: e.licensed }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const codes = new Set(emps.map(e => e.code));
  const principals = new Set(db.all("SELECT DISTINCT principal FROM projects WHERE principal <> ''").map(r => r.principal));
  for (const u of db.all("SELECT employee_code FROM users WHERE active = 1 AND role IN ('pic','admin') AND employee_code IS NOT NULL AND employee_code <> ''")) principals.add(u.employee_code);
  // licensed architects: only once Vantagepoint says something about anyone (open question PIP3); until then anyone may be picked
  const tracked = emps.some(e => e.licensed !== null && e.licensed !== undefined);
  const contacts = db.all('SELECT * FROM vp_contacts ORDER BY name');
  const clients = db.all('SELECT * FROM vp_clients ORDER BY name').map(c => ({ id: c.id, name: c.name, address: c.address,
    contacts: contacts.filter(k => k.client_id === c.id).map(k => ({ id: k.id, name: k.name, email: k.email, phone: k.phone })) }));
  return {
    employees: emps.map(e => ({ code: e.code, name: e.name })),
    principals: [...principals].filter(c => codes.has(c)),
    architects: tracked ? emps.filter(e => e.licensed === 1).map(e => e.code) : null,
    clients,
  };
}
/* the shape the rule wants: ids only */
const checkLists = p => ({ clients: p.clients.map(c => ({ id: c.id, contacts: c.contacts.map(k => k.id) })), employees: p.employees.map(e => e.code), principals: p.principals, architects: p.architects });

/* what the form needs: the lists, the pickers and the settings that shape it */
function formData(db, user, ctx) {
  requireSee(db, user, ctx.settings);
  const cfg = cfgOf(ctx.settings);
  const me = personOf(db, user);
  return { lists: F.LISTS, pickers: pickers(db), stageProbs: cfg.stageProbs, cfoThreshold: cfg.cfoThreshold, today: ctx.today(), me: { employeeCode: me.employeeCode, picProjects: me.picProjects, pmProjects: me.pmProjects } };
}

/* ---------- reading ---------- */
const userNames = db => Object.fromEntries(db.all('SELECT id, display_name FROM users').map(u => [u.id, u.display_name]));
function rowsOf(db) {
  return db.all('SELECT r.*, v.fields_json FROM pip_requests r JOIN pip_revisions v ON v.request_id = r.id AND v.rev = r.rev')
    .map(r => ({ id: r.id, seq: r.seq, status: r.status, submittedBy: r.submitted_by, submittedAt: r.submitted_at, decidedAt: r.decided_at, vpNumber: r.vp_number, rev: r.rev, fields: JSON.parse(r.fields_json) }));
}
function clientLabel(db, f) {
  if (f.client === F.NEW) return f.newClientName ? `${f.newClientName} (new client)` : '';
  const c = db.get('SELECT name FROM vp_clients WHERE id = ?', f.client || '');
  return c ? c.name : f.client || '';
}

function home(db, user, ctx) {
  const settings = ctx.settings;
  requireSee(db, user, settings);
  const cfg = cfgOf(settings), p = personOf(db, user);
  const all = rowsOf(db);
  const byId = Object.fromEntries(all.map(r => [r.id, r]));
  const who = userNames(db);
  const list = W.homeList(all, p, cfg, Date.now());
  const out = x => {
    const r = byId[x.id], f = r.fields, st = F.aia2030(f);
    return { id: r.id, seq: r.seq, name: f.name, client: clientLabel(db, f), fee: f.fee, start: f.start, status: r.status, statusLabel: W.STATUS_LABEL[r.status],
      submittedBy: who[r.submittedBy] || 'Unknown', submittedAt: r.submittedAt, decidedAt: r.decidedAt, vpNumber: r.vpNumber, aia2030: { key: st.key, label: st.label }, review: x.review, mineToFix: x.mineToFix };
  };
  return { perms: W.perms(p, cfg), recentDays: cfg.recentDays, waiting: list.waiting.map(out), recent: list.recent.map(out) };
}

function getRow(db, id) {
  const r = rowsOf(db).find(x => x.id === id);
  if (!r) throw new HttpError(404, 'That PiP does not exist.');
  return r;
}

function detail(db, user, id, ctx) {
  const settings = ctx.settings;
  requireSee(db, user, settings);
  const cfg = cfgOf(settings), p = personOf(db, user);
  const r = getRow(db, id), f = r.fields;
  const shown = names.employeeNames(db), who = userNames(db);
  const contact = f.contact && f.contact !== F.NEW ? db.get('SELECT * FROM vp_contacts WHERE id = ?', f.contact) : null;
  const client = f.client && f.client !== F.NEW ? db.get('SELECT * FROM vp_clients WHERE id = ?', f.client) : null;
  const events = db.all('SELECT * FROM pip_events WHERE request_id = ? ORDER BY id', id).map(e => ({ at: e.at, by: who[e.user_id] || 'Unknown', action: e.action, label: W.ACTION_LABEL[e.action] || e.action, from: e.from_status, to: e.to_status, note: e.note }));
  const emails = db.all('SELECT * FROM pip_notifications WHERE request_id = ? ORDER BY id', id).map(n => ({ at: n.at, event: n.event, to: JSON.parse(n.to_json).map(t => ({ name: t.name, why: t.why })), subject: n.subject }));
  // is the number the admin typed in the Vantagepoint copy yet? (copied nightly, so a brand-new number may not be there until tomorrow)
  const vp = r.vpNumber ? db.get('SELECT wbs1, name FROM projects WHERE wbs1 = ?', r.vpNumber) : null;
  return {
    id: r.id, seq: r.seq, status: r.status, statusLabel: W.STATUS_LABEL[r.status], rev: r.rev,
    submittedBy: who[r.submittedBy] || 'Unknown', submittedById: r.submittedBy, submittedAt: r.submittedAt, decidedAt: r.decidedAt,
    vpNumber: r.vpNumber, vpFound: vp ? { wbs1: vp.wbs1, name: vp.name } : null,
    fields: f,
    resolved: {
      client: clientLabel(db, f), clientAddress: f.client === F.NEW ? f.newClientAddr : client ? client.address : '',
      contact: f.contact === F.NEW ? (f.ncName ? `${f.ncName} (new contact)` : '') : contact ? contact.name : '',
      contactEmail: f.contact === F.NEW ? f.ncEmail : contact ? contact.email : '', contactPhone: f.contact === F.NEW ? f.ncPhone : contact ? contact.phone : '',
      contactAddress: f.contact === F.NEW ? f.ncAddr : '',
      principal: shown[f.principal] || f.principal, pm: shown[f.pm] || f.pm, pa: f.pa ? shown[f.pa] || f.pa : '',
    },
    aia2030: F.aia2030(f),
    actions: W.actionsFor(p, cfg, r),
    mine: r.submittedBy === user.id,
    events, emails,
  };
}

/* ---------- emails (queued; Kent's mail automation sends them) ---------- */
function queueEmails(db, ctx, event, request) {
  const cfg = cfgOf(ctx.settings);
  const rec = W.recipients(event, request, cfg);
  if (!rec.employees.length && !rec.users.length) return;
  const shown = names.employeeNames(db), f = request.fields;
  const to = [];
  const seen = new Set();
  const add = (name, email, why) => { const k = (email || name).toLowerCase(); if (seen.has(k)) return; seen.add(k); to.push({ name, email: email || '', why }); };
  for (const code of rec.employees) {
    const e = db.get('SELECT email FROM employees WHERE code = ?', code);
    add(shown[code] || code, e ? e.email : '', code === f.principal ? 'Principal' : 'Project manager');
  }
  for (const id of rec.users) {
    const u = db.get('SELECT display_name, email FROM users WHERE id = ? AND active = 1', id);
    if (u) add(u.display_name, u.email, id === cfg.primaryAdmin ? 'PiP admin' : id === cfg.cfo ? 'CFO' : 'submitted it');
  }
  if (!to.length) return;
  const who = userNames(db);
  const link = `${ctx.baseUrl}/#/pip/${request.id}`;
  const money = n => '$' + Number(n || 0).toLocaleString('en-US');
  let subject, body;
  if (event === 'return') {
    subject = `PiP ${request.seq} returned: ${f.name}`;
    body = `Your PiP "${f.name}" was returned with this note:\n\n${request.note}\n\nOpen it, make the change and submit it again:\n${link}`;
  } else {
    subject = `PiP ${request.seq} ${event === 'resubmit' ? 'resubmitted' : 'submitted'}: ${f.name}`;
    body = `${who[request.submittedBy] || 'Someone'} ${event === 'resubmit' ? 'changed and resubmitted' : 'submitted'} a Project in Pursuit.\n\n`
      + `Project: ${f.name}\nClient: ${clientLabel(db, f)}\nStage: ${f.stage}, ${f.prob}%\nEstimated fee: ${money(f.fee)}\nEstimated start: ${f.start}\n`
      + (Number(f.fee) >= cfg.cfoThreshold ? `\nThe fee is ${money(cfg.cfoThreshold)} or more: coordinate with the CFO before it is created in Vantagepoint.\n` : '')
      + `\nOpen it in Compass:\n${link}`;
  }
  db.run('INSERT INTO pip_notifications (request_id, at, event, to_json, subject, body) VALUES (?, ?, ?, ?, ?, ?)', request.id, db.now(), event, JSON.stringify(to), subject, body);
}

/* ---------- writing ---------- */
function checked(db, body, ctx) {
  const f = F.clean(body && body.fields);
  const bad = F.problems(f, { stageProbs: cfgOf(ctx.settings).stageProbs, lists: checkLists(pickers(db)) });
  if (bad.length) throw new HttpError(400, 'Some answers need a fix before this can be sent.', { problems: bad });
  f.urgency = F.urgency(f.start, ctx.today()).value; // routed to Vantagepoint's option on the day it is sent
  return f;
}

function submit(db, user, body, ctx) {
  const settings = ctx.settings;
  if (!permsOf(db, user, settings).submit) throw new HttpError(403, 'Only principals and project managers submit a PiP.');
  const f = checked(db, body, ctx);
  const id = crypto.randomUUID();
  return db.tx(() => {
    const at = db.now();
    const seq = (db.get('SELECT MAX(seq) AS n FROM pip_requests').n || 0) + 1;
    db.run('INSERT INTO pip_requests (id, seq, submitted_by, submitted_at, status, rev, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?)', id, seq, user.id, at, 'new', at);
    db.run('INSERT INTO pip_revisions (request_id, rev, fields_json, at, by) VALUES (?, 1, ?, ?, ?)', id, JSON.stringify(f), at, user.id);
    db.run('INSERT INTO pip_events (request_id, at, user_id, action, from_status, to_status, note) VALUES (?, ?, ?, ?, ?, ?, ?)', id, at, user.id, 'submit', '', 'new', '');
    queueEmails(db, ctx, 'submit', { id, seq, submittedBy: user.id, fields: f });
    return { id, seq };
  });
}

/* body.status is the status the person saw; if it moved meanwhile, nothing changes (409) */
function guard(r, body) {
  if (body && body.status && body.status !== r.status) throw new HttpError(409, 'This PiP changed since you opened it. Reload to see where it stands.');
}
const REASON = { 'not-allowed': [403, 'You cannot do that on this PiP.'], 'wrong-status': [409, 'This PiP is not at a step where that can be done.'], 'needs-note': [400, 'Write a short note to say why.'], 'needs-number': [400, 'Type the Vantagepoint project number.'] };

function act(db, user, id, action, body, ctx) {
  const settings = ctx.settings, cfg = cfgOf(settings);
  requireSee(db, user, settings);
  const r = getRow(db, id);
  guard(r, body);
  const input = { note: body && typeof body.note === 'string' ? body.note.trim().slice(0, 2000) : '', number: body && typeof body.number === 'string' ? body.number.trim().slice(0, 30) : '' };
  const verdict = W.check(personOf(db, user), cfg, r, action, input);
  if (!verdict.ok) { const [s, m] = REASON[verdict.reason]; throw new HttpError(s, m); }
  const f = action === 'resubmit' ? checked(db, body, ctx) : null;
  db.tx(() => {
    const at = db.now();
    const rev = f ? r.rev + 1 : r.rev;
    if (f) db.run('INSERT INTO pip_revisions (request_id, rev, fields_json, at, by) VALUES (?, ?, ?, ?, ?)', id, rev, JSON.stringify(f), at, user.id);
    const final = W.FINAL.includes(verdict.to);
    db.run('UPDATE pip_requests SET status = ?, rev = ?, updated_at = ?, decided_at = ?, vp_number = ? WHERE id = ?',
      verdict.to, rev, at, final ? at : null, action === 'created' ? input.number : r.vpNumber, id);
    db.run('INSERT INTO pip_events (request_id, at, user_id, action, from_status, to_status, note) VALUES (?, ?, ?, ?, ?, ?, ?)', id, at, user.id, action, r.status, verdict.to,
      action === 'created' ? input.number : input.note);
    queueEmails(db, ctx, action, { id, seq: r.seq, submittedBy: r.submittedBy, fields: f || r.fields, note: input.note });
  });
  return detail(db, user, id, ctx);
}

/* the Admin's PiP settings refer to people: they must be real */
function checkSettingPeople(db, changes) {
  const known = new Set(db.all('SELECT id FROM users').map(u => u.id));
  for (const k of ['pip.admins', 'pip.viewers']) if (changes[k] && changes[k].some(id => !known.has(id))) throw new HttpError(400, 'One of the people picked is not in People.');
  for (const k of ['pip.primaryAdmin', 'pip.cfo']) if (changes[k] && !known.has(changes[k])) throw new HttpError(400, 'The person picked is not in People.');
}

/* ---------- seed: who the PiP admins are, and a few made-up PiPs for the demo ---------- */
function seedPipSettings(db) {
  const id = u => (db.get('SELECT id FROM users WHERE username = ?', u) || {}).id;
  const rows = { 'pip.admins': [id('karen.acct'), id('camille.acct'), id('c.brandt')].filter(Boolean), 'pip.primaryAdmin': id('karen.acct') || '', 'pip.cfo': id('j.workman') || '' };
  for (const [k, v] of Object.entries(rows)) db.run('INSERT INTO settings (key, value_json, effective_from, set_by, set_at) VALUES (?, ?, ?, ?, ?)', k, JSON.stringify(v), 0, 'seed', 0);
}

function seedPipDemo(db) {
  const id = u => (db.get('SELECT id FROM users WHERE username = ?', u) || {}).id;
  const DAY = 86400000, now = Date.now();
  const base = { source: 'Existing Client', resp: 'Prime', direct: 'No', office: 'Salt Lake', delivery: 'CM at Risk', comp: 'Fixed Fee', contact: '', pa: '' };
  const demo = [
    { by: 'd.whitfield', ago: 1, status: 'new', f: { name: 'Granite Ridge Library Wing', stage: 'Shortlisted', prob: 40, client: 'C100', contact: 'K100', ptype: 'K-12 Education', deliv: 'Expansion/Infill', desc: 'A two-story library and media wing on the north side of the existing school.', principal: 'E101', pm: 'E202', pa: 'E205', fee: 485000, mcv: 0, start: '2027-03-01', end: '2028-08-31', city: 'Sandy', st: 'UT', gsf: 18000, proposalDate: '2026-12-11' } },
    { by: 'a.ruiz', ago: 4, status: 'review', f: { name: 'Wasatch Valley Clinic Remodel', stage: 'Negotiation', prob: 60, client: 'C120', contact: 'K121', ptype: 'Healthcare', deliv: 'Modernization/Renovation/Remodel', hvac: 'Not sure', env: 'Minor', desc: 'Remodel of the second-floor outpatient clinic, about 12,000 SF.', principal: 'E104', pm: 'E201', fee: 1250000, start: '2027-01-15', end: '2027-12-15', source: 'Referral', comp: 'HNTE' } },
    { by: 'm.oyelaran', ago: 9, status: 'returned', note: 'The fee looks like the architectural share only. Please enter the gross fee, including consultants.', f: { name: 'Murray Senior Center Tenant Improvement', stage: 'Marketing Proposal', prob: 20, client: 'C110', contact: 'K110', ptype: 'Civic', deliv: 'Tenant Improvement', light: 'Yes', desc: 'Interior fit-out of a leased building for the senior center.', principal: 'E102', pm: 'E202', fee: 96000, start: '2027-06-01', end: '2027-12-31', delivery: 'Design-Bid-Build' } },
    { by: 'p.raman', ago: 12, status: 'created', number: 'P26-0418', f: { name: 'Bonneville State Science Building Study', stage: 'Fee Proposal Only (No Marketing)', prob: 20, client: 'C130', contact: 'K130', ptype: 'Higher Education', deliv: 'Feasibility Study', desc: 'Feasibility study for replacing the 1968 science building.', principal: 'E103', pm: 'E203', fee: 64000, start: '2027-01-04', end: '2027-04-30', comp: 'Hourly', delivery: 'Undetermined' } },
    { by: 'e.castellanos', ago: 20, status: 'created', number: 'P26-0409', f: { name: 'Mather Fleet Maintenance Facility', stage: 'Awarded', prob: 90, client: 'new', newClientName: 'Sacramento Regional Transit', newClientAddr: '1400 29th St, Sacramento, CA 95816', contact: 'new', ncName: 'Ray Delgado', ncEmail: 'ray.delgado@example.test', ncPhone: '916-555-0177', ptype: 'Civic', deliv: 'New Construction', desc: 'A new 40,000 SF maintenance facility for the bus fleet.', principal: 'E105', pm: 'E204', fee: 2100000, mcv: 2600000, start: '2027-02-01', end: '2029-03-31', office: 'Sacramento', delivery: 'Design-Build', direct: 'Yes', budget: 38000000, city: 'Mather', st: 'CA', gsf: 40000 } },
    { by: 'b.okafor', ago: 26, status: 'withdrawn', note: 'The client decided not to go ahead this year.', f: { name: 'Juniper Office Campus Master Plan', stage: 'Research', prob: 10, client: 'C150', contact: 'K150', ptype: 'Commercial', deliv: 'Master Plan', desc: 'Campus master plan for three office buildings.', principal: 'E106', pm: 'E203', fee: 140000, start: '2027-04-01', end: '2027-10-31', source: 'New Business Development' } },
  ];
  const reviewer = id('karen.acct');
  db.tx(() => {
    demo.forEach((d, i) => {
      const by = id(d.by); if (!by) return;
      const f = F.clean(Object.assign({}, base, d.f));
      f.urgency = F.urgency(f.start, new Date(now - d.ago * DAY).toISOString().slice(0, 10)).value;
      const rid = crypto.randomUUID(), at = now - d.ago * DAY, later = at + 2 * DAY;
      const final = W.FINAL.includes(d.status);
      db.run('INSERT INTO pip_requests (id, seq, submitted_by, submitted_at, status, rev, decided_at, vp_number, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)', rid, i + 1, by, at, d.status, final ? later : null, d.number || '', final ? later : at);
      db.run('INSERT INTO pip_revisions (request_id, rev, fields_json, at, by) VALUES (?, 1, ?, ?, ?)', rid, JSON.stringify(f), at, by);
      db.run('INSERT INTO pip_events (request_id, at, user_id, action, from_status, to_status, note) VALUES (?, ?, ?, ?, ?, ?, ?)', rid, at, by, 'submit', '', 'new', '');
      if (d.status !== 'new') {
        const steps = { review: [['review', 'new', 'review', '']], returned: [['return', 'new', 'returned', d.note]], created: [['review', 'new', 'review', ''], ['created', 'review', 'created', d.number]], withdrawn: [['withdraw', 'new', 'withdrawn', d.note]] }[d.status];
        steps.forEach(([a, from, to, note], j) => db.run('INSERT INTO pip_events (request_id, at, user_id, action, from_status, to_status, note) VALUES (?, ?, ?, ?, ?, ?, ?)', rid, at + (j + 1) * DAY, a === 'withdraw' ? by : reviewer, a, from, to, note || ''));
      }
    });
  });
}

module.exports = { cfgOf, personOf, permsOf, pickers, formData, home, detail, submit, act, checkSettingPeople, seedPipSettings, seedPipDemo };
