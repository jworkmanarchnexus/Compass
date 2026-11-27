/* Projects in Pursuit's data. The server decides who may read or change what (server/pip.js); this file only asks. */
import { request } from './http.js';

const id = x => encodeURIComponent(x);

export const Pip = {
  /* the home list: waiting PiPs, then the recent ones, and what this person may do */
  home() { return request('GET', '/api/pip'); },
  /* the lists, pickers (Vantagepoint copy) and settings the form needs */
  form() { return request('GET', '/api/pip/form'); },
  submit(fields) { return request('POST', '/api/pip', { fields }); },
  get(pipId) { return request('GET', '/api/pip/' + id(pipId)); },
  /* action: review | return | resubmit | created | withdraw. body: { status (as seen), note, number, fields (resubmit) } */
  act(pipId, action, body) { return request('POST', '/api/pip/' + id(pipId) + '/' + action, body || {}); },
};
