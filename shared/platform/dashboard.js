/* My dashboard: the signed-in person's own layout. Nobody can read or change anyone else's. */
import { request } from './http.js';

export const Dashboard = {
  get() { return request('GET', '/api/dashboard'); },
  save(layout) { return request('PUT', '/api/dashboard', { layout }); },
  reset() { return request('PUT', '/api/dashboard', { reset: true }); },
};
