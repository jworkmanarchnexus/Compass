/* Session: who is signed in. Locally "sign in as" picks a seeded test person.
   In production this becomes the firm's network sign-in; the methods stay the same. */
import { request, pref } from './http.js';

let me = null;

export const Session = {
  /* test people for the picker (local only) */
  devUsers() { return request('GET', '/api/dev/users'); },

  async signInAs(userId) {
    pref('user', userId);
    me = null;
    const person = await Session.load().catch((e) => { pref('user', ''); throw e; });
    if (!person) throw new Error('That person is not in Compass.');
    return person;
  },
  signOut() { pref('user', ''); me = null; },

  /* the signed-in person, or null when nobody is signed in or the saved sign-in is no longer valid */
  async load() {
    if (!pref('user')) { me = null; return null; }
    try { me = await request('GET', '/api/me'); } catch (e) { if (e.status === 401) { pref('user', ''); me = null; } else throw e; }
    return me;
  },
  me() { return me; },
};
