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
};
