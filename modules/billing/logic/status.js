/* ===== Billing: the life of a request =====
   Pure. Tested from tests/fixtures/status.json. The SERVER applies every change through `transition`; a refused change changes nothing.

   Stored statuses: draft, submitted, review, returned, processed. "Awaiting PM" is not stored: it is a project with no request yet
   (months.unbilledList). Nothing is ever locked, and nothing is deleted: every change after submission is a new revision.

   actor.kinds: who the person is for this request: 'author' (the project's PM or PIC) and/or 'processor' (an invoice processor).
   The Admin is both. ctx: { actorId, handledBy, wasReturned, exceedsVariance }. */
'use strict';

const STATUSES = ['draft', 'submitted', 'review', 'returned', 'processed'];

/* event -> { to, by, revision, reason, notify }. `to: null` means the status stays the same. */
const TABLE = {
  draft: {
    submit: { to: 'submitted', by: 'author', revision: true, notify: 'submission' },
  },
  submitted: {
    withdraw: { to: 'draft', by: 'author' },
    'start-review': { to: 'review', by: 'processor', takes: true },
    return: { to: 'returned', by: 'processor', reason: true },
    revise: { to: null, by: 'author', revision: true, notify: 'revision' },
    answer: { to: null, by: 'author', notify: 'clarification' },
  },
  review: {
    return: { to: 'returned', by: 'processor', reason: true, handler: true },
    process: { to: 'processed', by: 'processor', handler: true },
    release: { to: 'submitted', by: 'processor', handler: true, releases: true },
    revise: { to: null, by: 'author', revision: true, notify: 'revision' },
    answer: { to: null, by: 'author', notify: 'clarification' },
  },
  returned: {
    edit: { to: 'draft', by: 'author' },
    resubmit: { to: 'submitted', by: 'author', revision: true, notify: 'resubmit' },
    answer: { to: null, by: 'author', notify: 'clarification' },
  },
  processed: {},
};

function transition(status, event, actor, payload, ctx) {
  const c = ctx || {}, p = payload || {};
  const rule = (TABLE[status] || {})[event];
  if (!rule) return { ok: false, error: 'bad-state' };
  if (!(actor && actor.kinds && actor.kinds.includes(rule.by))) return { ok: false, error: 'not-allowed' };
  if (rule.handler && c.handledBy && c.actorId !== c.handledBy && !actor.kinds.includes('admin')) return { ok: false, error: 'handled-by-other' };
  if (rule.reason && String(p.reason == null ? '' : p.reason).trim() === '') return { ok: false, error: 'reason-required' };
  let notify = [];
  if (rule.notify) notify.push(event === 'submit' && c.wasReturned ? 'resubmit' : rule.notify);
  if (rule.revision && c.exceedsVariance) notify.push('variance');
  const out = { ok: true, status: rule.to || status, revision: !!rule.revision, notify, audit: 'billing.' + event };
  if (rule.takes) out.handledBy = c.actorId;
  if (rule.releases || rule.to === 'returned' || rule.to === 'processed') out.handledBy = null;
  return out;
}

/* what a person with these kinds may do now: the buttons to show (the server still checks) */
function actionsFor(status, actor) {
  return Object.entries(TABLE[status] || {}).filter(([, r]) => actor.kinds.includes(r.by)).map(([event]) => event);
}

const api = { STATUSES, transition, actionsFor };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else if (typeof window !== 'undefined') window.CompassBilling = Object.assign(window.CompassBilling || {}, api);
