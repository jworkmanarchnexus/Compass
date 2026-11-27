/* My dashboards (board = 'pic' or 'pm'): the signed-in person's own arrangement. Nobody can read or change anyone else's. */
import { request } from './http.js';

const url = board => '/api/dashboards/' + encodeURIComponent(board);
export const Dashboard = {
  get(board) { return request('GET', url(board)); },
  save(board, layout) { return request('PUT', url(board), { layout }); },
  reset(board) { return request('PUT', url(board), { reset: true }); },
};
