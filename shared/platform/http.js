/* The only place in the front end that calls fetch. Everything else in shared/platform/ goes through here.
   In production Kent re-implements the platform adapters; screens never see this file. */

export class ApiError extends Error {
  constructor(status, message, body) { super(message); this.name = 'ApiError'; this.status = status; this.body = body || {}; }
}

const config = {
  baseUrl: '',
  /* per-device preference store; the shell swaps in Toolbox.pref when it is loaded */
  pref: (() => { const m = new Map(); return (k, v) => (v === undefined ? (m.has(k) ? m.get(k) : null) : (m.set(k, v), v)); })(),
};
export function configure(opts) { Object.assign(config, opts); }
export function pref(k, v) { return config.pref(k, v); }

/* like request, but returns the response text (a CSV) instead of JSON */
export async function requestText(path) {
  const headers = {};
  const user = config.pref('user');
  if (user) headers['X-Compass-User'] = user;
  const res = await fetch(config.baseUrl + path, { headers });
  const text = await res.text();
  if (!res.ok) { let m = text; try { m = JSON.parse(text).error; } catch (e) { /* plain text */ } throw new ApiError(res.status, m || `Request failed (${res.status})`); }
  return text;
}

export async function request(method, path, body) {
  const headers = {};
  const user = config.pref('user');
  if (user) headers['X-Compass-User'] = user; // local "sign in as" only; production uses the network sign-in
  let payload;
  if (body !== undefined) { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
  const res = await fetch(config.baseUrl + path, { method, headers, body: payload });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch (e) { json = { error: text }; }
  if (!res.ok) throw new ApiError(res.status, json.error || `Request failed (${res.status})`, json);
  return json;
}
