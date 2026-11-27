/* Staffing projections' data. The server decides who may read it (the Admin, Principals and the neighborhood leaders picked in Admin). */
import { request } from './http.js';

export const Staffing = {
  get() { return request('GET', '/api/staffing'); },
  /* Admin > Staffing: every billing category with its people, its Vantagepoint rate and where it sits */
  adminInputs() { return request('GET', '/api/admin/staffing'); },
};
