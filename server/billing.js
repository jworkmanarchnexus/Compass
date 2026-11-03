'use strict';
/* Billing on the server (docs/SPEC-billing.md). The rules live in modules/billing/logic (pure, tested); this file reads and writes the
   database around them. EVERY rule is re-checked here: the browser only shows messages. Money is whole cents; dates are 'YYYY-MM-DD',
   billing months 'YYYY-MM'. Nothing is ever deleted, and a processed request takes no more changes (database triggers).

   ctx = { today: 'YYYY-MM-DD', settings, audit(action, object, detail) } where settings is the current Admin settings. */
const crypto = require('node:crypto');
const { HttpError } = require('./errors');
const Mo = require('../modules/billing/logic/months');
const F = require('../modules/billing/logic/fixed');
const H = require('../modules/billing/logic/hourly');
const R = require('../modules/billing/logic/review');
const S = require('../modules/billing/logic/status');
const A = require('../modules/billing/logic/access');
const N = require('../modules/billing/logic/notify');
const Z = require('../modules/billing/logic/sanitize');

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const NO_ACCESS = 'You do not have access to this.';
const forbidden = () => new HttpError(403, NO_ACCESS);
const bad = (m, extra) => new HttpError(400, m, extra);
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);

/* ---------- the Vantagepoint copy for Billing ---------- */

/* the scheduled pull: replaces the billing copy, like the nightly copy does. `source.loadBilling()` is Kent's one method to implement. */
function loadVpBilling(db, source) {
  const { projects, lines } = source.loadBilling();
  db.tx(() => {
    db.run('DELETE FROM vp_billing_lines');
    db.run('DELETE FROM vp_billing_projects');
    for (const p of projects) db.run('INSERT INTO vp_billing_projects (wbs1, billing_type, authorized_cents, billed_cents, projection_cents) VALUES (?, ?, ?, ?, ?)', p.wbs1, p.billingType, p.authorizedCents, p.billedCents, p.projectionCents);
    for (const l of lines) db.run('INSERT INTO vp_billing_lines (wbs1, line_id, name, kind, sort, fee_cents, billed_cents, available_cents, projection_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', l.wbs1, l.lineId, l.name, l.kind, l.sort, l.feeCents, l.billedCents, l.availableCents, l.projectionCents);
    db.run("DELETE FROM system_state WHERE key = 'billing.vpLoadedAt'");
    db.run("INSERT INTO system_state (key, value) VALUES ('billing.vpLoadedAt', ?)", String(db.now()));
  });
}

/* made-up starting point for the local demo: a few projects with a processor, a deadline for three months */
function seedBilling(db, source) {
  loadVpBilling(db, source);
  const id = u => (db.get('SELECT id FROM users WHERE username = ?', u) || {}).id;
  const owners = { 'karen.acct': ['2024-0207', '2025-0187', '2024-0356', '2025-0098', '2025-0510'], 'camille.acct': ['2025-0230', '2025-0412', '2024-0388', '2025-0301', '2025-0266', '2024-0399'] }; // 2025-0173 and 2025-0334 stay unassigned
  for (const [name, list] of Object.entries(owners)) for (const wbs1 of list) db.run('INSERT INTO billing_assignments (wbs1, processor_id, set_by, set_at) VALUES (?, ?, ?, ?)', wbs1, id(name), 'seed', db.now());
  for (const [month, deadline] of [['2026-09', '2026-10-06'], ['2026-10', '2026-11-05'], ['2026-11', '2026-12-04']]) db.run('INSERT INTO billing_calendar (month, deadline, starts_on, set_by, set_at) VALUES (?, ?, NULL, ?, ?)', month, deadline, 'seed', db.now());
}

/* ---------- what accounting should hear about ---------- */

const prefsFor = (db, userId) => { const r = db.get('SELECT prefs_json FROM billing_email_prefs WHERE user_id = ?', userId); return r ? JSON.parse(r.prefs_json) : N.DEFAULT_PREFS; };

/* Queue one alert for the processors it concerns, with how each one's own email settings say to deliver it (now, held for business hours,
   in the digest, or not at all). Nothing is sent from here; sending is a later step. */
function queueNotification(db, ctx, event, wbs1, requestId, involved) {
  const bh = ctx.settings['billing.businessHours'], at = db.now(), nowLocal = ctx.nowLocal();
  const delivery = involved.map(userId => Object.assign({ userId }, N.deliveryFor(prefsFor(db, userId), event, nowLocal, bh)));
  db.run('INSERT INTO billing_notifications (at, event, wbs1, request_id, involved_json, delivery_json) VALUES (?, ?, ?, ?, ?, ?)', at, event, wbs1, requestId, JSON.stringify(involved), JSON.stringify(delivery));
}

/* ---------- small readers ---------- */

const userRef = u => ({ role: u.role, employeeCode: u.employee_code });
const codesOf = p => ({ picCode: p.principal, pmCode: p.proj_mgr });
const projectRow = (db, wbs1) => db.get('SELECT p.*, v.billing_type FROM projects p JOIN vp_billing_projects v ON v.wbs1 = p.wbs1 WHERE p.wbs1 = ?', wbs1);
const employeeNames = db => Object.fromEntries(db.all('SELECT code, first_name, last_name FROM employees').map(e => [e.code, `${e.first_name} ${e.last_name}`]));
const userNames = db => Object.fromEntries(db.all('SELECT id, display_name FROM users').map(u => [u.id, u.display_name]));
const processors = db => db.all("SELECT id, display_name AS name FROM users WHERE active = 1 AND role IN ('processor','admin') ORDER BY display_name");
const currentAssigned = (db, wbs1) => { const r = db.get('SELECT processor_id FROM billing_assignments WHERE wbs1 = ? ORDER BY id DESC LIMIT 1', wbs1); return r ? r.processor_id : null; };
const vpLoadedAt = db => { const r = db.get("SELECT value FROM system_state WHERE key = 'billing.vpLoadedAt'"); return r ? Number(r.value) : 0; };

function calendarMap(db) {
  return Object.fromEntries(db.all('SELECT month, deadline, starts_on FROM billing_calendar').map(r => [r.month, { deadline: r.deadline || undefined, startsOn: r.starts_on || undefined }]));
}
/* the adjustments in force for a project: its own reset day, and the months it is left out of */
function adjustState(db, wbs1) {
  let rolloverDay = null; const excluded = new Map();
  for (const r of db.all('SELECT * FROM billing_project_adjust WHERE wbs1 = ? ORDER BY id', wbs1)) {
    if (r.kind === 'rollover') rolloverDay = r.value === '' ? null : Number(r.value);
    else if (r.kind === 'exclude') excluded.set(r.value, r.reason);
    else excluded.delete(r.value);
  }
  return { rolloverDay, excluded: [...excluded].map(([month, reason]) => ({ month, reason })) };
}
function projectMonth(db, ctx, wbs1, calendar) {
  return Mo.currentBillingMonth(ctx.today, { rolloverDay: ctx.settings['billing.rolloverDay'], calendar: calendar || calendarMap(db), projectRolloverDay: adjustState(db, wbs1).rolloverDay });
}

/* ---------- what Vantagepoint says, plus what is pending ---------- */

/* Amounts in requests that Vantagepoint cannot know yet: submitted or in review, and processed since the last copy was loaded.
   The request being edited is left out. Returns { lineId: cents }. */
function pendingByLine(db, wbs1, excludeId) {
  const out = {};
  const rows = db.all(`SELECT id FROM billing_requests WHERE wbs1 = ? AND id <> ? AND (status IN ('submitted','review') OR (status = 'processed' AND processed_at > ?))`, wbs1, excludeId || '', vpLoadedAt(db));
  for (const r of rows) {
    const rev = db.get('SELECT lines_json FROM billing_revisions WHERE request_id = ? ORDER BY number DESC LIMIT 1', r.id);
    if (rev) for (const l of JSON.parse(rev.lines_json)) out[l.id] = (out[l.id] || 0) + (l.amountCents || 0);
  }
  return out;
}

/* what the screens and the rules work from, for one project */
function facts(db, wbs1, excludeId) {
  const p = db.get('SELECT * FROM vp_billing_projects WHERE wbs1 = ?', wbs1);
  if (!p) return null;
  const rows = db.all('SELECT * FROM vp_billing_lines WHERE wbs1 = ? ORDER BY sort, line_id', wbs1);
  const pending = pendingByLine(db, wbs1, excludeId);
  const out = { form: p.billing_type, hash: '' };
  if (p.billing_type === 'fixed') {
    out.phases = rows.map(l => ({ id: l.line_id, name: l.name, feeCents: l.fee_cents, billedCents: l.billed_cents, pendingCents: pending[l.line_id] || 0, projectionCents: l.projection_cents }));
  } else {
    out.lines = rows.map(l => ({ id: l.line_id, name: l.name, kind: l.kind, availableCents: Math.max(0, l.available_cents - (pending[l.line_id] || 0)), projectionCents: l.projection_cents }));
    out.hourlyProject = { authorizedCents: p.authorized_cents, billedCents: p.billed_cents, pendingCents: Object.values(pending).reduce((a, v) => a + v, 0) };
  }
  out.hash = crypto.createHash('sha256').update(JSON.stringify({ p, rows, pending })).digest('hex').slice(0, 16);
  return out;
}
const lineIds = f => (f.form === 'fixed' ? f.phases : f.lines).map(l => l.id);
const evaluate = (f, draft) => (f.form === 'fixed' ? F.evaluate(f.phases, draft.entries) : H.evaluate(f.hourlyProject, f.lines, draft.entries));
const defaultDraft = f => { const q = f.form === 'fixed' ? F.quickAction(f.phases, 'reset') : H.quickAction(f.lines, 'clear'); return { entries: q.entries, noBilling: q.noBilling, notes: '' }; };

/* what the person sent, checked and merged onto what is stored. Entries are replaced as a whole. */
function cleanDraft(input, f, base) {
  const d = { entries: base.entries, noBilling: base.noBilling, notes: base.notes };
  if (input.entries !== undefined) {
    if (!isObj(input.entries)) throw bad('The entries are not in the right form.');
    const ids = lineIds(f), next = {};
    for (const [id, e] of Object.entries(input.entries)) {
      if (!ids.includes(id)) throw bad(`Unknown line: ${id}`);
      const okAmount = isObj(e) && Object.keys(e).length === 1 && 'amountCents' in e && (e.amountCents === null || Number.isSafeInteger(e.amountCents));
      const okPct = f.form === 'fixed' && isObj(e) && Object.keys(e).length === 1 && 'pctBp' in e && Number.isSafeInteger(e.pctBp) && e.pctBp >= 0;
      if (!okAmount && !okPct) throw bad(`The entry for ${id} is not an amount or a percent.`);
      next[id] = e;
    }
    d.entries = next;
  }
  if (input.noBilling !== undefined) d.noBilling = !!input.noBilling;
  if (input.notes !== undefined) {
    if (typeof input.notes !== 'string') throw bad('Notes must be text.');
    d.notes = Z.sanitize(input.notes, 20000);
  }
  return d;
}

/* ---------- reading requests ---------- */

function requestOut(r, names) {
  return {
    id: r.id, wbs1: r.wbs1, month: r.month, kind: r.kind, form: r.form, status: r.status, revision: r.revision, rev: r.rev,
    draft: JSON.parse(r.draft_json), sourceHash: r.source_hash, handledBy: r.handled_by ? { id: r.handled_by, name: names[r.handled_by] || '' } : null,
    wasReturned: !!r.was_returned, invoiceRef: r.invoice_ref, submittedOn: r.submitted_on, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function loadRequest(db, id) {
  const r = db.get('SELECT * FROM billing_requests WHERE id = ?', id);
  if (!r) throw new HttpError(404, 'Request not found.');
  return r;
}
/* the request and the person's rights on its project; a person with no view right is told only that they have no access */
function loadAs(db, user, id) {
  const r = loadRequest(db, id);
  const p = db.get('SELECT * FROM projects WHERE wbs1 = ?', r.wbs1);
  const codes = p ? codesOf(p) : { picCode: '', pmCode: '' };
  const acc = A.access(userRef(user), codes);
  if (!acc.view) throw forbidden();
  return { r, p, acc, kinds: A.kinds(userRef(user), codes) };
}

function requestDetail(db, user, id) {
  const { r, acc, kinds } = loadAs(db, user, id);
  const names = userNames(db);
  const f = facts(db, r.wbs1, r.id);
  const evaluated = f ? evaluate(f, JSON.parse(r.draft_json)) : null;
  return Object.assign(requestOut(r, names), {
    access: acc, actions: S.actionsFor(r.status, { kinds }),
    facts: f, evaluated,
    currentSourceHash: f ? f.hash : null,
    revisions: db.all('SELECT * FROM billing_revisions WHERE request_id = ? ORDER BY number', r.id).map(v => ({
      number: v.number, event: v.event, noBilling: !!v.no_billing, notes: v.notes, lines: JSON.parse(v.lines_json), totalCents: v.total_cents,
      projectionCents: v.projection_cents, sourceHash: v.source_hash, at: v.created_at, by: names[v.created_by] || '',
    })),
    events: db.all('SELECT * FROM billing_events WHERE request_id = ? ORDER BY id', r.id).map(e => ({ at: e.at, by: names[e.user_id] || '', event: e.event, from: e.from_status, to: e.to_status, text: e.text })),
  });
}

const latestRevision = (db, id) => db.get('SELECT number, total_cents, created_at FROM billing_revisions WHERE request_id = ? ORDER BY number DESC LIMIT 1', id);

/* the list for the portfolio and the queue: every expected project for the month, each exactly once, with where it stands.
   A PM or PIC sees only their own projects. A processor or the Admin sees all, and may narrow it with scope mine | unassigned | all. */
function portfolio(db, user, ctx, opts) {
  const o = opts || {};
  if (!A.canSeeBilling(user.role)) throw forbidden();
  if (o.month !== undefined && o.month !== null && o.month !== '' && !MONTH_RE.test(o.month)) throw bad('That is not a valid billing month.');
  const ref = userRef(user), calendar = calendarMap(db), emp = employeeNames(db), names = userNames(db);
  const all = db.all("SELECT p.wbs1, p.name, p.principal, p.proj_mgr, v.billing_type, v.authorized_cents, v.billed_cents, v.projection_cents FROM projects p JOIN vp_billing_projects v ON v.wbs1 = p.wbs1 WHERE p.status = 'A' ORDER BY p.name");
  const requests = db.all('SELECT id, wbs1, month, status, kind FROM billing_requests ORDER BY rowid');
  const lines = db.all('SELECT wbs1, SUM(fee_cents) AS fee, SUM(billed_cents) AS billed, SUM(projection_cents) AS projection FROM vp_billing_lines GROUP BY wbs1');
  const sums = Object.fromEntries(lines.map(l => [l.wbs1, l]));
  const canProcess = A.access(ref, { picCode: '', pmCode: '' }).process;
  const rows = [];
  for (const p of all) {
    if (!A.access(ref, codesOf(p)).view) continue;
    const adj = adjustState(db, p.wbs1);
    const month = o.month || Mo.currentBillingMonth(ctx.today, { rolloverDay: ctx.settings['billing.rolloverDay'], calendar, projectRolloverDay: adj.rolloverDay });
    const mine = requests.filter(r => r.wbs1 === p.wbs1);
    const listed = Mo.unbilledList([{ wbs1: p.wbs1, excluded: adj.excluded }], mine, month);
    const openReq = mine.find(r => ['draft', 'submitted', 'review', 'returned'].includes(r.status)) || null;
    const forMonth = mine.filter(r => r.month === month && ['submitted', 'review', 'processed'].includes(r.status));
    const last = forMonth[forMonth.length - 1] || null;
    const req = listed.unbilled[0] && listed.unbilled[0].requestId ? mine.find(r => r.id === listed.unbilled[0].requestId) : last;
    const rev = last ? latestRevision(db, last.id) : null;
    const assigned = currentAssigned(db, p.wbs1);
    const fixed = p.billing_type === 'fixed', sum = sums[p.wbs1] || {};
    rows.push({
      wbs1: p.wbs1, name: p.name, billingType: p.billing_type, month,
      pic: emp[p.principal] || '', pm: emp[p.proj_mgr] || '', picCode: p.principal, pmCode: p.proj_mgr,
      state: listed.excluded[0] ? 'excluded' : listed.unbilled[0] ? listed.unbilled[0].state : last.status,
      excludedReason: listed.excluded[0] ? listed.excluded[0].reason : '',
      requestId: req ? req.id : null, kind: req ? req.kind : null,
      assignedTo: assigned ? { id: assigned, name: names[assigned] || '' } : null,
      deadline: Mo.deadlineStatus(month, ctx.today, calendar),
      feeCents: fixed ? sum.fee || 0 : p.authorized_cents, billedCents: fixed ? sum.billed || 0 : p.billed_cents, projectionCents: fixed ? sum.projection || 0 : p.projection_cents,
      amountCents: rev ? rev.total_cents : null,
      done: listed.done.length > 0,
      open: openReq ? { id: openReq.id, status: openReq.status, kind: openReq.kind, month: openReq.month } : null, // any open request, in any month (a second, mid-month one shows here)
    });
  }
  const unassigned = rows.filter(r => !r.assignedTo).length;
  let shown = rows;
  if (canProcess && o.scope === 'mine') shown = rows.filter(r => r.assignedTo && r.assignedTo.id === user.id);
  else if (canProcess && o.scope === 'unassigned') shown = rows.filter(r => !r.assignedTo);
  const count = s => rows.filter(r => r.state === s).length;
  return {
    month: o.month || null, today: ctx.today, rows: shown,
    counts: { total: rows.length, awaiting: count('awaiting'), draft: count('draft'), returned: count('returned'), submitted: count('submitted'), review: count('review'), processed: count('processed'), excluded: count('excluded'), unassigned: canProcess ? unassigned : undefined },
  };
}

function projectDetail(db, user, wbs1, ctx, opts) {
  const p = projectRow(db, wbs1);
  if (!p) throw new HttpError(404, 'Project not found, or it has no billing data.');
  const acc = A.access(userRef(user), codesOf(p));
  if (!acc.view) throw forbidden();
  const o = opts || {};
  if (o.month && !MONTH_RE.test(o.month)) throw bad('That is not a valid billing month.');
  const calendar = calendarMap(db), emp = employeeNames(db), names = userNames(db);
  const adj = adjustState(db, wbs1);
  const month = o.month || Mo.currentBillingMonth(ctx.today, { rolloverDay: ctx.settings['billing.rolloverDay'], calendar, projectRolloverDay: adj.rolloverDay });
  const all = db.all('SELECT * FROM billing_requests WHERE wbs1 = ? ORDER BY rowid', wbs1);
  const open = all.find(r => ['draft', 'submitted', 'review', 'returned'].includes(r.status)) || null;
  const note = db.get('SELECT body, created_at, created_by FROM billing_project_notes WHERE wbs1 = ? ORDER BY id DESC LIMIT 1', wbs1);
  const assigned = currentAssigned(db, wbs1);
  return {
    wbs1, name: p.name, billingType: p.billing_type, month, pic: emp[p.principal] || '', pm: emp[p.proj_mgr] || '', access: acc,
    facts: facts(db, wbs1, open ? open.id : null),
    open: open ? requestOut(open, names) : null,
    canStart: Mo.canStartRequest(all, wbs1, month),
    history: all.slice().reverse().map(r => { const v = latestRevision(db, r.id); return { id: r.id, month: r.month, kind: r.kind, status: r.status, revision: r.revision, totalCents: v ? v.total_cents : null, submittedOn: r.submitted_on }; }),
    notes: note ? { body: note.body, at: note.created_at, by: names[note.created_by] || '' } : null,
    assignedTo: assigned ? { id: assigned, name: names[assigned] || '' } : null,
    deadline: Mo.deadlineStatus(month, ctx.today, calendar),
    adjustments: adj,
    thresholdCents: ctx.settings['billing.varianceThreshold'],
  };
}

/* ---------- writing requests ---------- */

function createRequest(db, user, wbs1, body, ctx) {
  const p = projectRow(db, wbs1);
  if (!p) throw new HttpError(404, 'Project not found, or it has no billing data.');
  const acc = A.access(userRef(user), codesOf(p));
  if (!acc.view) throw forbidden();
  if (!acc.edit) throw forbidden();
  const month = (body && body.month) || projectMonth(db, ctx, wbs1);
  if (!MONTH_RE.test(month)) throw bad('That is not a valid billing month.');
  const start = Mo.canStartRequest(db.all('SELECT id, wbs1, month, status FROM billing_requests WHERE wbs1 = ?', wbs1), wbs1, month);
  if (!start.ok) throw new HttpError(409, 'This project already has an open billing request. Finish or withdraw it first.', { requestId: start.requestId });
  const f = facts(db, wbs1, null);
  const id = crypto.randomUUID();
  const now = db.now();
  try {
    db.run(`INSERT INTO billing_requests (id, wbs1, month, kind, form, status, pm_code, pic_code, draft_json, source_hash, created_at, created_by, updated_at, updated_by)
            VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)`, id, wbs1, month, start.kind, f.form, p.proj_mgr, p.principal, JSON.stringify(defaultDraft(f)), f.hash, now, user.id, now, user.id);
  } catch (e) {
    if (/UNIQUE/i.test(String(e.message))) throw new HttpError(409, 'This project already has an open billing request. Finish or withdraw it first.');
    throw e;
  }
  db.run('INSERT INTO billing_events (request_id, at, user_id, event, from_status, to_status, text) VALUES (?, ?, ?, ?, ?, ?, ?)', id, now, user.id, 'create', 'draft', 'draft', '');
  ctx.audit('billing.create', `${wbs1} ${month}`, { requestId: id, kind: start.kind });
  return requestDetail(db, user, id);
}

/* Save Draft: always allowed for the author, however incomplete. Editing a returned request first makes it a draft again. */
function saveDraft(db, user, id, body, ctx) {
  const b = body || {};
  const { r, kinds } = loadAs(db, user, id);
  if (!kinds.includes('author')) throw forbidden();
  if (b.rev !== r.rev) throw new HttpError(409, 'Someone changed this request since you opened it. Reload to see their changes.', { rev: r.rev });
  if (r.status !== 'draft' && r.status !== 'returned') throw new HttpError(409, r.status === 'processed' ? 'A processed request takes no more changes.' : 'This request is submitted. Use Revise to change it.');
  const f = facts(db, r.wbs1, r.id);
  if (!f) throw new HttpError(409, 'This project has no billing data right now.');
  const draft = cleanDraft(b, f, JSON.parse(r.draft_json));
  const to = 'draft', now = db.now();
  db.tx(() => {
    const res = db.run('UPDATE billing_requests SET status = ?, draft_json = ?, source_hash = ?, rev = rev + 1, updated_at = ?, updated_by = ? WHERE id = ? AND rev = ?', to, JSON.stringify(draft), typeof b.sourceHash === 'string' && b.sourceHash ? b.sourceHash : f.hash, now, user.id, r.id, r.rev);
    if (res.changes !== 1) throw new HttpError(409, 'Someone changed this request since you opened it. Reload to see their changes.');
    if (r.status === 'returned') db.run('INSERT INTO billing_events (request_id, at, user_id, event, from_status, to_status, text) VALUES (?, ?, ?, ?, ?, ?, ?)', r.id, now, user.id, 'edit', 'returned', 'draft', '');
  });
  return requestDetail(db, user, id);
}

const STATUS_WORDS = { draft: 'a draft', submitted: 'submitted', review: 'in review', returned: 'returned', processed: 'processed' };

/* Every status change goes through here: submit, withdraw, revise, answer, edit, resubmit, start-review, return, process, release. */
function act(db, user, id, event, body, ctx) {
  const b = body || {};
  const { r, p, kinds } = loadAs(db, user, id);
  if (b.rev !== r.rev) throw new HttpError(409, 'Someone changed this request since you opened it. Reload to see their changes.', { rev: r.rev });
  const makesRevision = ['submit', 'resubmit', 'revise'].includes(event);
  if (event === 'answer' && String(b.text == null ? '' : b.text).trim() === '') throw bad('Write your answer first.');
  let draft = JSON.parse(r.draft_json), sourceHash = r.source_hash, evaluated = null, exceeds = false;
  if (makesRevision) {
    const f = facts(db, r.wbs1, r.id);
    if (!f) throw new HttpError(409, 'This project has no billing data right now.');
    draft = cleanDraft(b, f, draft);
    if (typeof b.sourceHash === 'string' && b.sourceHash) sourceHash = b.sourceHash;
    evaluated = evaluate(f, draft);
    const verdict = R.review(evaluated, { noBilling: draft.noBilling, notes: Z.plainText(draft.notes), projectionCents: evaluated.projectionCents, thresholdCents: ctx.settings['billing.varianceThreshold'], sourceHash, currentSourceHash: f.hash });
    if (!verdict.canSubmit) throw new HttpError(422, 'This request cannot be submitted yet.', { issues: verdict.issues });
    exceeds = verdict.needsNote;
    draft.noBilling = R.normalizeForSubmit(evaluated, draft.noBilling);
  }
  const t = S.transition(r.status, event, { kinds }, { reason: b.reason }, { actorId: user.id, handledBy: r.handled_by, wasReturned: !!r.was_returned, exceedsVariance: exceeds });
  if (!t.ok) {
    if (t.error === 'not-allowed') throw forbidden();
    if (t.error === 'handled-by-other') throw new HttpError(409, 'Another processor has this request in review.');
    if (t.error === 'reason-required') throw bad('Say what is unclear, so the PM knows what to fix.');
    throw new HttpError(409, `That is not possible for a request that is ${STATUS_WORDS[r.status]}.`);
  }
  const now = db.now();
  const number = t.revision ? r.revision + 1 : r.revision;
  const handled = 'handledBy' in t ? t.handledBy : r.handled_by;
  const text = event === 'return' ? String(b.reason).trim().slice(0, 2000) : event === 'answer' ? String(b.text).trim().slice(0, 2000) : event === 'process' ? String(b.invoiceRef || '').trim().slice(0, 80) : '';
  db.tx(() => {
    const res = db.run(`UPDATE billing_requests SET status = ?, draft_json = ?, source_hash = ?, revision = ?, handled_by = ?, was_returned = ?, invoice_ref = ?, submitted_on = ?, rev = rev + 1, updated_at = ?, updated_by = ?, processed_at = ?
                        WHERE id = ? AND rev = ?`,
      t.status, JSON.stringify(draft), sourceHash, number, handled, event === 'return' || r.was_returned ? 1 : 0, event === 'process' ? text : r.invoice_ref,
      ['submit', 'resubmit'].includes(event) ? ctx.today : r.submitted_on, now, user.id, t.status === 'processed' ? now : r.processed_at, r.id, r.rev);
    if (res.changes !== 1) throw new HttpError(409, 'Someone changed this request since you opened it. Reload to see their changes.');
    if (t.revision) {
      db.run(`INSERT INTO billing_revisions (request_id, number, event, entries_json, no_billing, notes, lines_json, total_cents, projection_cents, source_hash, created_at, created_by)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, r.id, number, event, JSON.stringify(draft.entries), draft.noBilling ? 1 : 0, draft.notes, JSON.stringify(evaluated.lines), evaluated.totalCents, evaluated.projectionCents, sourceHash, now, user.id);
    }
    db.run('INSERT INTO billing_events (request_id, at, user_id, event, from_status, to_status, text) VALUES (?, ?, ?, ?, ?, ?, ?)', r.id, now, user.id, event, r.status, t.status, text);
    const assignedTo = currentAssigned(db, r.wbs1);
    for (const n of t.notify) queueNotification(db, ctx, n, r.wbs1, r.id, N.recipients(n, { assignedTo }, processors(db).map(x => x.id)));
    ctx.audit('billing.' + event, `${p ? p.name : r.wbs1} ${r.month}`, { requestId: r.id, wbs1: r.wbs1, from: r.status, to: t.status, revision: number });
  });
  return requestDetail(db, user, id);
}

/* ---------- notes, adjustments, assignments, calendar, email settings ---------- */

function addProjectNote(db, user, wbs1, body, ctx) {
  const p = projectRow(db, wbs1);
  if (!p) throw new HttpError(404, 'Project not found, or it has no billing data.');
  const acc = A.access(userRef(user), codesOf(p));
  if (!acc.view) throw forbidden();
  if (!acc.edit) throw forbidden();
  if (!body || typeof body.body !== 'string') throw bad('Notes must be text.');
  const clean = Z.sanitize(body.body, 20000);
  db.run('INSERT INTO billing_project_notes (wbs1, body, created_at, created_by) VALUES (?, ?, ?, ?)', wbs1, clean, db.now(), user.id);
  ctx.audit('billing.project-notes', `${p.name}`, { wbs1 });
  return { body: clean };
}

/* a PM, PIC or the Admin, under Advanced settings: a different reset day for this project, or leaving it out of a month (with a reason) */
function adjustProject(db, user, wbs1, body, ctx) {
  const p = projectRow(db, wbs1);
  if (!p) throw new HttpError(404, 'Project not found, or it has no billing data.');
  const acc = A.access(userRef(user), codesOf(p));
  if (!acc.view) throw forbidden();
  if (!acc.edit) throw forbidden();
  const b = body || {}, now = db.now();
  const before = adjustState(db, wbs1);
  db.tx(() => {
    if ('rolloverDay' in b) {
      const v = b.rolloverDay;
      if (v !== null && !(Number.isInteger(v) && v >= 1 && v <= 28)) throw bad('The reset day must be between 1 and 28.');
      if (v !== before.rolloverDay) { db.run('INSERT INTO billing_project_adjust (wbs1, kind, value, reason, set_by, set_at) VALUES (?, ?, ?, ?, ?, ?)', wbs1, 'rollover', v === null ? '' : String(v), '', user.id, now); ctx.audit('billing.adjust', p.name, { wbs1, rolloverDay: v, was: before.rolloverDay }); }
    }
    if (b.exclude !== undefined) {
      const e = b.exclude;
      if (!isObj(e) || !MONTH_RE.test(e.month) || typeof e.reason !== 'string' || !e.reason.trim()) throw bad('Leaving a project out of a month needs the month and a reason.');
      db.run('INSERT INTO billing_project_adjust (wbs1, kind, value, reason, set_by, set_at) VALUES (?, ?, ?, ?, ?, ?)', wbs1, 'exclude', e.month, e.reason.trim().slice(0, 500), user.id, now);
      ctx.audit('billing.adjust', p.name, { wbs1, exclude: e.month, reason: e.reason.trim() });
    }
    if (b.include !== undefined) {
      if (!MONTH_RE.test(b.include)) throw bad('That is not a valid billing month.');
      db.run('INSERT INTO billing_project_adjust (wbs1, kind, value, reason, set_by, set_at) VALUES (?, ?, ?, ?, ?, ?)', wbs1, 'include', b.include, '', user.id, now);
      ctx.audit('billing.adjust', p.name, { wbs1, include: b.include });
    }
  });
  return adjustState(db, wbs1);
}

function assignments(db, user) {
  if (!A.access(userRef(user), { picCode: '', pmCode: '' }).process) throw forbidden();
  const names = userNames(db), emp = employeeNames(db);
  const rows = db.all("SELECT p.wbs1, p.name, p.proj_mgr FROM projects p JOIN vp_billing_projects v ON v.wbs1 = p.wbs1 WHERE p.status = 'A' ORDER BY p.name").map(p => {
    const a = currentAssigned(db, p.wbs1);
    return { wbs1: p.wbs1, name: p.name, pm: emp[p.proj_mgr] || '', assignedTo: a ? { id: a, name: names[a] || '' } : null };
  });
  rows.sort((a, b) => Number(!!a.assignedTo) - Number(!!b.assignedTo)); // unassigned first; the sort is stable, so names stay in order
  const log = db.all('SELECT * FROM billing_assignments ORDER BY id DESC LIMIT 50').map(x => ({ at: x.set_at, wbs1: x.wbs1, to: x.processor_id ? names[x.processor_id] || '' : null, by: names[x.set_by] || x.set_by }));
  return { processors: processors(db), rows, unassigned: rows.filter(r => !r.assignedTo).length, log };
}

function setAssignment(db, user, wbs1, body, ctx) {
  if (!A.access(userRef(user), { picCode: '', pmCode: '' }).assign) throw forbidden();
  const p = projectRow(db, wbs1);
  if (!p) throw new HttpError(404, 'Project not found, or it has no billing data.');
  const to = body && body.processorId !== undefined ? body.processorId : undefined;
  if (to === undefined) throw bad('Say who the project goes to, or null for nobody.');
  if (to !== null && !processors(db).some(x => x.id === to)) throw bad('That person is not an invoice processor.');
  const from = currentAssigned(db, wbs1);
  if (from === to) return { changed: false };
  const now = db.now();
  db.tx(() => {
    db.run('INSERT INTO billing_assignments (wbs1, processor_id, set_by, set_at) VALUES (?, ?, ?, ?)', wbs1, to, user.id, now);
    const involved = N.recipients('assignment', { assignedTo: to, previousAssignedTo: from }, []);
    queueNotification(db, ctx, 'assignment', wbs1, null, involved);
    const names = userNames(db);
    ctx.audit('billing.assign', p.name, { wbs1, from: from ? names[from] : null, to: to ? names[to] : null });
  });
  return { changed: true };
}

function calendar(db) {
  return db.all('SELECT month, deadline, starts_on FROM billing_calendar ORDER BY month').map(r => ({ month: r.month, deadline: r.deadline, startsOn: r.starts_on }));
}
/* the Admin's deadline (and start date) for one billing month; null clears it */
function setCalendar(db, user, body, ctx) {
  const b = body || {};
  if (!MONTH_RE.test(b.month)) throw bad('That is not a valid billing month.');
  // a real calendar date: 2026-02-30 looks right but is not one (it must survive a round trip)
  const ok = v => v === null || v === undefined || (typeof v === 'string' && DATE_RE.test(v) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v);
  if (!ok(b.deadline) || !ok(b.startsOn)) throw bad('Dates must look like 2026-11-05.');
  const old = db.get('SELECT * FROM billing_calendar WHERE month = ?', b.month);
  const deadline = b.deadline || null, startsOn = b.startsOn || null;
  db.tx(() => {
    if (!deadline && !startsOn) { if (old) db.run('UPDATE billing_calendar SET deadline = NULL, starts_on = NULL, set_by = ?, set_at = ? WHERE month = ?', user.id, db.now(), b.month); }
    else if (old) db.run('UPDATE billing_calendar SET deadline = ?, starts_on = ?, set_by = ?, set_at = ? WHERE month = ?', deadline, startsOn, user.id, db.now(), b.month);
    else db.run('INSERT INTO billing_calendar (month, deadline, starts_on, set_by, set_at) VALUES (?, ?, ?, ?, ?)', b.month, deadline, startsOn, user.id, db.now());
    ctx.audit('billing.calendar', b.month, { from: old ? { deadline: old.deadline, startsOn: old.starts_on } : null, to: { deadline, startsOn } });
  });
  return calendar(db);
}

function getPrefs(db, user) {
  if (!A.access(userRef(user), { picCode: '', pmCode: '' }).process) throw forbidden();
  const row = db.get('SELECT prefs_json FROM billing_email_prefs WHERE user_id = ?', user.id);
  return row ? JSON.parse(row.prefs_json) : N.DEFAULT_PREFS;
}
function setPrefs(db, user, body) {
  if (!A.access(userRef(user), { picCode: '', pmCode: '' }).process) throw forbidden();
  const problems = N.validatePrefs(body);
  if (problems.length) throw bad('Some email settings are not allowed.', { problems });
  const clean = { events: {}, digest: {}, reminders: {} };
  for (const e of N.EVENTS) clean.events[e] = body.events[e];
  for (const k of Object.keys(N.DEFAULT_PREFS.digest)) clean.digest[k] = body.digest[k];
  for (const k of Object.keys(N.DEFAULT_PREFS.reminders)) clean.reminders[k] = body.reminders[k];
  db.tx(() => {
    db.run('DELETE FROM billing_email_prefs WHERE user_id = ?', user.id);
    db.run('INSERT INTO billing_email_prefs (user_id, prefs_json, updated_at) VALUES (?, ?, ?)', user.id, JSON.stringify(clean), db.now());
  });
  return clean;
}

module.exports = { loadVpBilling, seedBilling, portfolio, projectDetail, requestDetail, createRequest, saveDraft, act, addProjectNote, adjustProject, assignments, setAssignment, calendar, setCalendar, getPrefs, setPrefs, facts, MONTH_RE };
