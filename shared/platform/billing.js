/* Billing's data. The server decides who may read or change what (server/billing.js); this file only asks. Money is whole cents. */
import { request } from './http.js';

const q = o => { const s = Object.entries(o).filter(([, v]) => v).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&'); return s ? '?' + s : ''; };
const w = wbs1 => encodeURIComponent(wbs1);

export const Billing = {
  /* a project's Vantagepoint facts, open request, history, notes and adjustments */
  project(wbs1, month) { return request('GET', '/api/billing/projects/' + w(wbs1) + q({ month })); },
  startRequest(wbs1, month) { return request('POST', '/api/billing/projects/' + w(wbs1) + '/requests', month ? { month } : {}); },
  saveNotes(wbs1, body) { return request('POST', '/api/billing/projects/' + w(wbs1) + '/notes', { body }); },
  /* one request, with its revisions and events; every call that changes it quotes the rev it started from (409 if it moved) */
  request(id) { return request('GET', '/api/billing/requests/' + encodeURIComponent(id)); },
  saveDraft(id, body) { return request('PUT', '/api/billing/requests/' + encodeURIComponent(id) + '/draft', body); },
  act(id, event, body) { return request('POST', '/api/billing/requests/' + encodeURIComponent(id) + '/' + event, body || {}); },
  portfolio(opts) { return request('GET', '/api/billing/portfolio' + q(opts || {})); },
  calendar() { return request('GET', '/api/billing/calendar'); },
  /* the Admin's deadline (and start date) for one billing month; null clears it */
  saveCalendar(month, deadline, startsOn) { return request('PUT', '/api/admin/billing/calendar', { month, deadline: deadline || null, startsOn: startsOn || null }); },
  /* a project's own reset day, or leaving it out of a month (with a reason) */
  adjust(wbs1, body) { return request('POST', '/api/billing/projects/' + w(wbs1) + '/adjust', body); },
  assignments() { return request('GET', '/api/billing/assignments'); },
  assign(wbs1, processorId) { return request('PUT', '/api/billing/assignments/' + w(wbs1), { processorId }); },
};
