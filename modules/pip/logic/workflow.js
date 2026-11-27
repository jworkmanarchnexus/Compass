/* ===== Projects in Pursuit: who may do what, the statuses, who is told, and the list =====
   Pure. Tested from tests/fixtures/workflow.json. The SERVER enforces every rule; the browser only hides controls.

   person: { id, role, employeeCode, picProjects, pmProjects }  (counts of active Vantagepoint projects where they are PIC / PM)
   cfg (the Admin settings for PiP): { admins: [userIds], viewers: [userIds], primaryAdmin: userId | '', cfo: userId | '', cfoThreshold, recentDays }
   request: { id, status, submittedBy, submittedAt, decidedAt, fields: { principal, pm, fee, ... } } */
'use strict';

/* Statuses (from the intake concept). 'created' = entered in Vantagepoint; 'withdrawn' takes the place of deleting. */
const STATUSES = ['new', 'review', 'returned', 'created', 'withdrawn'];
const STATUS_LABEL = { new: 'New', review: 'In review', returned: 'Returned', created: 'Created in Vantagepoint', withdrawn: 'Withdrawn' };
const OPEN = ['new', 'review', 'returned'];
const FINAL = ['created', 'withdrawn'];

const isPicOrPm = p => !!p && (p.role === 'pic' || p.role === 'pm' || p.picProjects > 0 || p.pmProjects > 0);
const isPipAdmin = (p, cfg) => !!p && (p.role === 'admin' || ((cfg && cfg.admins) || []).includes(p.id));

/* the module: principals and project managers, the PiP admins, and anyone the Admin added. Nobody else sees it at all. */
function canSee(p, cfg) {
  if (!p) return false;
  return isPicOrPm(p) || isPipAdmin(p, cfg) || ((cfg && cfg.viewers) || []).includes(p.id);
}
/* only principals and project managers fill one out (the Admin too, who is also a principal) */
const canSubmit = (p, cfg) => canSee(p, cfg) && (isPicOrPm(p) || (p && p.role === 'admin'));
const canReview = (p, cfg) => isPipAdmin(p, cfg);

function perms(p, cfg) {
  return { see: canSee(p, cfg), submit: canSubmit(p, cfg), review: canReview(p, cfg) };
}

/* ---- transitions ----
   action -> { from: [statuses], to, by: 'submitter' | 'reviewer' | 'either', needs: 'note' | 'number' | null } */
const ACTIONS = {
  review: { from: ['new'], to: 'review', by: 'reviewer', needs: null },
  return: { from: ['new', 'review'], to: 'returned', by: 'reviewer', needs: 'note' },
  resubmit: { from: ['returned'], to: 'new', by: 'submitter', needs: null },
  created: { from: ['new', 'review'], to: 'created', by: 'reviewer', needs: 'number' },
  withdraw: { from: ['new', 'review', 'returned'], to: 'withdrawn', by: 'either', needs: 'note' },
};
const ACTION_LABEL = { submit: 'Submitted', review: 'Started the review', return: 'Returned with a note', resubmit: 'Changed and resubmitted', created: 'Created in Vantagepoint', withdraw: 'Withdrew it' };

/* may this person take this action on this request? { ok, reason } with reason: 'not-allowed' | 'wrong-status' | 'needs-note' | 'needs-number' */
function check(p, cfg, request, action, input) {
  const a = ACTIONS[action];
  if (!a || !canSee(p, cfg)) return { ok: false, reason: 'not-allowed' };
  const mine = request.submittedBy === p.id;
  const who = a.by === 'reviewer' ? canReview(p, cfg) : a.by === 'submitter' ? mine : (mine || canReview(p, cfg));
  if (!who) return { ok: false, reason: 'not-allowed' };
  if (!a.from.includes(request.status)) return { ok: false, reason: 'wrong-status' };
  const text = v => typeof v === 'string' && v.trim().length > 0;
  if (a.needs === 'note' && !text(input && input.note)) return { ok: false, reason: 'needs-note' };
  if (a.needs === 'number' && !text(input && input.number)) return { ok: false, reason: 'needs-number' };
  return { ok: true, to: a.to };
}

/* the buttons a person sees on one request */
const actionsFor = (p, cfg, request) => Object.keys(ACTIONS).filter(k => {
  const r = check(p, cfg, request, k, { note: 'x', number: 'x' });
  return r.ok;
});

/* ---- who is told (Josh, 2026-11-26). Returns user-free recipients: { employees: [codes], users: [userIds] }.
   submitted / resubmitted: the PIC and the PM on the form, and the primary PiP admin; the CFO too when the fee is at or over the threshold.
   returned: whoever submitted it. Nothing else sends an email. */
function recipients(event, request, cfg) {
  const c = cfg || {};
  const f = request.fields || {};
  if (event === 'submit' || event === 'resubmit') {
    const users = [c.primaryAdmin].filter(Boolean);
    if (c.cfo && Number(f.fee) >= (c.cfoThreshold === undefined ? 1000000 : c.cfoThreshold)) users.push(c.cfo);
    return { employees: [...new Set([f.principal, f.pm].filter(Boolean))], users: [...new Set(users)] };
  }
  if (event === 'return') return { employees: [], users: [request.submittedBy] };
  return { employees: [], users: [] };
}

/* ---- the PiP home list ----
   Waiting: everything not yet created or withdrawn, however old, oldest first, so nothing is lost.
   Recent: created or withdrawn in the last recentDays days (counted from the day it was decided), newest first.
   `review` is true on waiting rows a reviewer still has to act on (New or In review). */
const DAY = 86400000;
function homeList(requests, p, cfg, now) {
  const days = (cfg && cfg.recentDays) || 30;
  const reviewer = canReview(p, cfg);
  const waiting = requests.filter(r => OPEN.includes(r.status)).sort((a, b) => a.submittedAt - b.submittedAt)
    .map(r => ({ id: r.id, review: reviewer && (r.status === 'new' || r.status === 'review'), mineToFix: r.status === 'returned' && r.submittedBy === p.id }));
  const recent = requests.filter(r => FINAL.includes(r.status) && r.decidedAt && now - r.decidedAt <= days * DAY).sort((a, b) => b.decidedAt - a.decidedAt)
    .map(r => ({ id: r.id, review: false, mineToFix: false }));
  return { waiting, recent };
}

const workflowApi = { STATUSES, STATUS_LABEL, OPEN, FINAL, ACTIONS, ACTION_LABEL, isPicOrPm, isPipAdmin, canSee, canSubmit, canReview, perms, check, actionsFor, recipients, homeList };
if (typeof module !== 'undefined' && module.exports) module.exports = workflowApi;
else if (typeof window !== 'undefined') window.CompassPip = Object.assign(window.CompassPip || {}, workflowApi);
