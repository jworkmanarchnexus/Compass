/* Principal Accountability's data. The server decides who may read it (the Admin, Finance, PICs when allowed) and keeps drafts
   to the Admin; this file only asks. It is its own monthly report: built in Admin > Report runs, published and archived here. */
import { request } from './http.js';

const enc = encodeURIComponent;
export const Accountability = {
  reports() { return request('GET', '/api/accountability/reports'); },
  report(id) { return request('GET', '/api/accountability/reports/' + enc(id)); },
  /* the Admin's side: each PIC's billed goal for a year (amount in cents; null removes it) */
  goals() { return request('GET', '/api/admin/accountability/goals'); },
  setGoal({ year, pic, amount }) { return request('PUT', '/api/admin/accountability/goals', { year, pic, amount }); },
  build(period) { return request('POST', '/api/admin/runs', period ? { kind: 'acct', period } : { kind: 'acct' }); },
  rebuild(id) { return request('POST', `/api/admin/accountability/runs/${enc(id)}/rebuild`, {}); },
  publish(id) { return request('POST', `/api/admin/accountability/runs/${enc(id)}/publish`, {}); },
  archive(id, reason, confirm) { return request('POST', `/api/admin/accountability/runs/${enc(id)}/archive`, { reason, confirm }); },
};
