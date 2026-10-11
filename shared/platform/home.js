/* The Home page's data. The server shapes it by role: an admin gets what needs attention, a PIC gets their own plans. */
import { request } from './http.js';

export const Home = { get() { return request('GET', '/api/home'); } };
