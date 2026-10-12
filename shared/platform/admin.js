/* Admin data: settings, people and the audit log. The server decides who may call these (shared/rules/roles.js). */
import { request } from './http.js';

export const Admin = {
  /* { key: { value, effectiveFrom, setBy } } */
  settings() { return request('GET', '/api/admin/settings'); },
  saveSettings(changes) { return request('PUT', '/api/admin/settings', { changes }); },
  people() { return request('GET', '/api/admin/people'); },
  changePerson(id, change) { return request('PUT', '/api/admin/people/' + encodeURIComponent(id), change); },
  audit(limit) { return request('GET', '/api/admin/audit' + (limit ? '?limit=' + limit : '')); },
  runs() { return request('GET', '/api/admin/runs'); },
  run(id) { return request('GET', '/api/admin/runs/' + encodeURIComponent(id)); },
  buildRun(period, kind) { return request('POST', '/api/admin/runs', Object.assign(period ? { period } : {}, kind ? { kind } : {})); },
  rebuildRun(id) { return request('POST', '/api/admin/runs/' + encodeURIComponent(id) + '/rebuild', {}); },
  publishRun(id) { return request('POST', '/api/admin/runs/' + encodeURIComponent(id) + '/publish', {}); },
  archiveRun(id, reason, confirm) { return request('POST', '/api/admin/runs/' + encodeURIComponent(id) + '/archive', { reason, confirm }); },
};
