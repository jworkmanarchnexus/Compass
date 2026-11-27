/* ===== Who may see what (product spec: Roles) =====
   Pure functions. The SERVER enforces them on every call; the browser only uses them to hide controls.
   Written without DOM or network so Kent can port them, and tested from tests/fixtures/roles.json.

   access = the Admin setting "access" (see settings.js). It lets Josh widen what the narrower roles may see
   without a code change, because the spec leaves some of this open (docs/DECISIONS.md, open questions). */
const ROLES = ['admin', 'pic', 'pm', 'processor', 'finance', 'marketing', 'sysadmin'];
const ROLE_LABEL = { admin: 'Admin', pic: 'PIC', pm: 'Project manager (Billing only)', processor: 'Invoice processor (Billing)', finance: 'Finance, view only', marketing: 'Marketing director, view only', sysadmin: 'System admin' };

/* areas of the app that have a page of their own */
const AREAS = ['turnaround', 'checkins', 'bd', 'pipeline', 'billing', 'admin'];

function canView(role, area, access) {
  const a = access || {};
  switch (area) {
    case 'turnaround': return role === 'admin' || role === 'pic' || role === 'finance' || (role === 'marketing' && !!a.marketingTurnaround);
    case 'checkins': return role === 'admin'; // the reminder queue is Josh's alone
    case 'bd': return role === 'admin' || role === 'finance' || role === 'marketing' || (role === 'pic' && !!a.picBd);
    case 'pipeline': return role === 'admin' || role === 'finance' || role === 'marketing' || (role === 'pic' && !!a.picPipeline);
    case 'billing': return role === 'admin' || role === 'processor' || role === 'pic' || role === 'pm'; // a PIC or PM sees only their own projects (modules/billing/logic/access.js)
    case 'admin': return role === 'admin' || role === 'sysadmin';
    default: return false;
  }
}

/* Admin tabs, in display order. 'edit' = may change it, 'view' = may read it, null = hidden. */
const ADMIN_TABS = ['turnaround', 'reminders', 'bd', 'pipeline', 'billing', 'dashboards', 'people', 'runs', 'patterns', 'audit'];
function adminTab(role, tab) {
  if (role === 'admin') return 'edit';
  if (role === 'sysadmin') {
    // Keeps the site running. Never sees plan content or what PICs promised (no access to PIC content decisions), nor the commitment analysis.
    return tab === 'patterns' ? null : 'view';
  }
  return null;
}

/* ===== Preview: a module released to a few people first =====
   release = the Admin setting "release" (see settings.js): { area: { stage: 'live' | 'preview', testers: [userId] } }.
   In preview, an area is open only to the Admin and the people the Admin picked. Preview never widens a role:
   a tester still needs a role that opens the area. The Admin always sees a preview, so they can try it themselves.
   Admin and the check-in drafts are never in preview (Admin must stay reachable; the drafts are the Admin's alone). */
const PREVIEWABLE = ['turnaround', 'bd', 'pipeline', 'billing'];

function inPreview(area, release) {
  const r = release && release[area];
  return !!r && r.stage === 'preview';
}
function released(user, area, release) {
  if (!inPreview(area, release)) return true;
  return user.role === 'admin' || release[area].testers.includes(user.id);
}
/* the one check the server makes: may this person open this area today? settings = all settings in force */
function canUse(user, area, settings) {
  const s = settings || {};
  return canView(user.role, area, s.access) && released(user, area, s.release);
}

function describe(role, access) {
  const areas = Object.fromEntries(AREAS.map(a => [a, canView(role, a, access)]));
  const adminTabs = Object.fromEntries(ADMIN_TABS.map(t => [t, adminTab(role, t)]));
  return { areas, adminTabs };
}
/* describe() for a signed-in person: what they may open, and which of those are in preview (for the "Preview" tag) */
function describeUser(user, settings) {
  const s = settings || {};
  const areas = Object.fromEntries(AREAS.map(a => [a, canUse(user, a, s)]));
  const adminTabs = Object.fromEntries(ADMIN_TABS.map(t => [t, adminTab(user.role, t)]));
  const preview = Object.fromEntries(PREVIEWABLE.map(a => [a, areas[a] && inPreview(a, s.release)]));
  return { areas, adminTabs, preview };
}

/* the last active admin can never be removed or demoted, or nobody could change settings again */
function canChangeUser(users, targetId, change) {
  const target = users.find(u => u.id === targetId);
  if (!target) return { ok: false, reason: 'not-found' };
  if (change.role !== undefined && !ROLES.includes(change.role)) return { ok: false, reason: 'bad-role' };
  const losesAdmin = target.role === 'admin' && target.active &&
    ((change.role !== undefined && change.role !== 'admin') || change.active === false);
  if (losesAdmin) {
    const others = users.filter(u => u.id !== targetId && u.role === 'admin' && u.active).length;
    if (!others) return { ok: false, reason: 'last-admin' };
  }
  return { ok: true };
}

const rolesApi = { ROLES, ROLE_LABEL, AREAS, ADMIN_TABS, PREVIEWABLE, canView, adminTab, inPreview, canUse, describe, describeUser, canChangeUser };
if (typeof module !== 'undefined' && module.exports) module.exports = rolesApi;
else if (typeof window !== 'undefined') window.CompassRules = Object.assign(window.CompassRules || {}, rolesApi);
