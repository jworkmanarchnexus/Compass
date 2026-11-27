/* Principal Accountability's data. The server decides who may read it (the Admin and Finance) and keeps drafts to the Admin;
   this file only asks. The reports are the Marketing Report's versions: Accountability is built and published with them. */
import { request } from './http.js';

const enc = encodeURIComponent;
export const Accountability = {
  reports() { return request('GET', '/api/accountability/reports'); },
  report(id) { return request('GET', '/api/accountability/reports/' + enc(id)); },
  /* the Admin's side: each PIC's billed goal for a year (amount in cents; null removes it) */
  goals() { return request('GET', '/api/admin/accountability/goals'); },
  setGoal({ year, pic, amount }) { return request('PUT', '/api/admin/accountability/goals', { year, pic, amount }); },
};
