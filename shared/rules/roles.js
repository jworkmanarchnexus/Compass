/* ===== Who may see what (product spec: Roles) =====
   Pure functions. The SERVER enforces them on every call; the browser only uses them to hide controls.
   Written without DOM or network so Kent can port them, and tested from tests/fixtures/roles.json.

   access = the Admin setting "access" (see settings.js). It lets Josh widen what the narrower roles may see
   without a code change, because the spec leaves some of this open (docs/DECISIONS.md, open questions). */
const ROLES = ['admin', 'pic', 'finance', 'marketing', 'sysadmin'];
const ROLE_LABEL = { admin: 'Admin', pic: 'PIC', finance: 'Finance, view only', marketing: 'Marketing director, view only', sysadmin: 'System admin' };

/* areas of the app that have a page of their own */
const AREAS = ['turnaround', 'checkins', 'bd', 'pipeline', 'admin'];

function canView(role, area, access) {
  const a = access || {};
  switch (area) {
    case 'turnaround': return role === 'admin' || role === 'pic' || role === 'finance' || (role === 'marketing' && !!a.marketingTurnaround);
    case 'checkins': return role === 'admin'; // the reminder queue is Josh's alone
    case 'bd': return role === 'admin' || role === 'finance' || role === 'marketing' || (role === 'pic' && !!a.picBd);
    case 'pipeline': return role === 'admin' || role === 'finance' || role === 'marketing' || (role === 'pic' && !!a.picPipeline);
    case 'admin': return role === 'admin' || role === 'sysadmin';
    default: return false;
  }
}

/* Admin tabs, in display order. 'edit' = may change it, 'view' = may read it, null = hidden. */
const ADMIN_TABS = ['turnaround', 'reminders', 'bd', 'pipeline', 'people', 'runs', 'patterns', 'audit'];
function adminTab(role, tab) {
  if (role === 'admin') return 'edit';
  if (role === 'sysadmin') {
    // Keeps the site running. Never sees plan content or what PICs promised (no access to PIC content decisions), nor the commitment analysis.
    return tab === 'patterns' ? null : 'view';
  }
  return null;
}

function describe(role, access) {
  const areas = Object.fromEntries(AREAS.map(a => [a, canView(role, a, access)]));
  const adminTabs = Object.fromEntries(ADMIN_TABS.map(t => [t, adminTab(role, t)]));
  return { areas, adminTabs };
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

const rolesApi = { ROLES, ROLE_LABEL, AREAS, ADMIN_TABS, canView, adminTab, describe, canChangeUser };
if (typeof module !== 'undefined' && module.exports) module.exports = rolesApi;
else if (typeof window !== 'undefined') window.CompassRules = Object.assign(window.CompassRules || {}, rolesApi);
