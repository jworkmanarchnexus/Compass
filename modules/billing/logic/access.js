/* ===== Billing: who may do what =====
   Pure. The SERVER enforces it on every call; the browser only hides controls. Tested from tests/fixtures/access.json.

   user:    { role, employeeCode }   role: admin | processor | pic | finance | marketing | sysadmin (PAs have no Compass role here)
   project: { picCode, pmCode }      the Vantagepoint principal and project-manager codes
   A user with the 'pic' role is the author of a project when their code is its principal or its project manager.
   Finance, Marketing, System admin (and anyone else) have no access to Billing at all, not even to read. */
'use strict';

const NONE = { view: false, edit: false, process: false, assign: false, admin: false };

function access(user, project) {
  if (!user) return NONE;
  if (user.role === 'admin') return { view: true, edit: true, process: true, assign: true, admin: true };
  if (user.role === 'processor') return { view: true, edit: false, process: true, assign: true, admin: false };
  if (user.role === 'pic') {
    const mine = !!user.employeeCode && !!project && (project.picCode === user.employeeCode || project.pmCode === user.employeeCode);
    return mine ? { view: true, edit: true, process: false, assign: false, admin: false } : NONE;
  }
  return NONE;
}

/* the kinds the state machine needs (status.js) */
function kinds(user, project) {
  const a = access(user, project), k = [];
  if (a.edit) k.push('author');
  if (a.process) k.push('processor');
  if (a.admin) k.push('admin');
  return k;
}

/* does Billing appear in the side bar at all? */
const canSeeBilling = role => role === 'admin' || role === 'processor' || role === 'pic';

/* the projects this user may see in Billing */
const visibleProjects = (user, projects) => projects.filter(p => access(user, p).view);

const api = { access, kinds, canSeeBilling, visibleProjects };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else if (typeof window !== 'undefined') window.CompassBilling = Object.assign(window.CompassBilling || {}, api);
