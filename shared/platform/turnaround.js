/* Project Turnaround data: the page, a project's plan, and the admin's check-in queue.
   The server decides what each person may see or do (and removes what they may not see); this file only asks. */
import { request } from './http.js';

const enc = encodeURIComponent;

export const Turnaround = {
  /* the page for the last published run, as the signed-in person may see it. { run: null } until one is published. */
  current() { return request('GET', '/api/turnaround/current'); },
  /* the same page for any run, draft included (admin only) */
  runOverview(runId) { return request('GET', '/api/admin/runs/' + enc(runId) + '/overview'); },
};

export const Plan = {
  get(wbs1, cycle) { return request('GET', `/api/projects/${enc(wbs1)}/plan` + (cycle ? '?cycle=' + cycle : '')); },
  /* kind: update (a comment) | admin_note */
  add(wbs1, entry) { return request('POST', `/api/projects/${enc(wbs1)}/plan/entries`, entry); },
  /* the goal check-in, in one step: { cause?, helped?, comment?, keep?, approach?, how? } */
  goalCheckin(wbs1, input) { return request('POST', `/api/projects/${enc(wbs1)}/plan/checkin`, input); },
  /* the mid-month update: { status: track | done | stuck, comment } */
  midUpdate(wbs1, input) { return request('POST', `/api/projects/${enc(wbs1)}/plan/midmonth`, input); },
};

export const Checkins = {
  list() { return request('GET', '/api/admin/checkins'); },
  edit(id, { subject, body }) { return request('PUT', '/api/admin/checkins/' + enc(id), { subject, body }); },
  send(id) { return request('POST', '/api/admin/checkins/' + enc(id) + '/send', {}); },
  dismiss(id) { return request('POST', '/api/admin/checkins/' + enc(id) + '/dismiss', {}); },
  undo(id) { return request('POST', '/api/admin/checkins/' + enc(id) + '/undo', {}); },
  /* record missed commitments and prepare drafts now (the scheduled job does this daily) */
  runDaily() { return request('POST', '/api/admin/daily', {}); },
  patterns(year) { return request('GET', '/api/admin/patterns' + (year ? '?year=' + year : '')); },
};
