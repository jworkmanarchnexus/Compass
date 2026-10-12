/* Pipeline watch's data. The server decides who may read it and who may clear alerts or add notes; this file only asks. */
import { request, requestText } from './http.js';

const q = o => '?' + Object.entries(o).filter(([, v]) => v).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');

export const Pipeline = {
  view(date, kind) { return request('GET', '/api/pipeline' + q({ date, kind })); },
  detail(date, kind, pic) { return request('GET', '/api/pipeline/detail' + q({ date, kind, pic })); },
  exportCsv(date, kind) { return requestText('/api/pipeline/export' + q({ date, kind })); },
  /* the Admin's side */
  clearAlert(id) { return request('POST', '/api/admin/pipeline/alerts/' + id + '/clear', {}); },
  addNote(pursuitId, body) { return request('POST', '/api/admin/pipeline/notes', { pursuitId, body }); },
  snapshotNow() { return request('POST', '/api/admin/pipeline/snapshot', {}); },
};
