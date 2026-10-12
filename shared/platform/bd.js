/* The BD report's data. The server decides who may read it (Finance, Marketing director, the Admin, PICs only if allowed) and
   removes the MWIP factor and raw amounts from PIC pages; this file only asks. */
import { request } from './http.js';

const enc = encodeURIComponent;

export const Bd = {
  reports() { return request('GET', '/api/bd/reports'); },
  report(id) { return request('GET', '/api/bd/reports/' + enc(id)); },
  /* the Admin's side */
  inputs() { return request('GET', '/api/admin/bd/inputs'); },
  setGoal({ year, scope, key, amount }) { return request('PUT', '/api/admin/bd/goals', { year, scope, key, amount }); },
  addFactor({ effectiveFrom, factorBp }) { return request('POST', '/api/admin/bd/factors', { effectiveFrom, factorBp }); },
  setSector(wbs1, sector) { return request('PUT', '/api/admin/bd/overrides', { wbs1, sector }); },
  build(period) { return request('POST', '/api/admin/runs', period ? { kind: 'bd', period } : { kind: 'bd' }); },
  rebuild(id) { return request('POST', `/api/admin/bd/runs/${enc(id)}/rebuild`, {}); },
  publish(id) { return request('POST', `/api/admin/bd/runs/${enc(id)}/publish`, {}); },
  archive(id, reason, confirm) { return request('POST', `/api/admin/bd/runs/${enc(id)}/archive`, { reason, confirm }); },
};
