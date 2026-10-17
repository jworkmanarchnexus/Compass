'use strict';
/* Nothing leaves the local environment (tool results, errors, logs, files) without passing through here.
   scrub(): removes credentials and anything that looks like a money amount or a long account-style number.
   Errors from the database driver are reduced to a short code plus a scrubbed message. */

const MONEY = /[-(]?\$\s?\d[\d,]*(\.\d+)?\)?|\b\d{1,3}(,\d{3})+(\.\d+)?\b|\b\d+\.\d{2}\b/g;

function scrub(text, cfg = {}) {
  let s = String(text ?? '');
  for (const secret of [cfg.password, cfg.user]) if (secret && secret.length >= 3) s = s.split(secret).join('[redacted]');
  s = s.replace(/\b(PWD|PASSWORD|UID|USER ID)\s*=\s*(\{[^}]*\}|[^;\s]*)/gi, '$1=[redacted]');
  s = s.replace(MONEY, '[amount]');
  return s.length > 300 ? s.slice(0, 300) + '…' : s;
}

function describeError(err, cfg) {
  const first = Array.isArray(err?.odbcErrors) && err.odbcErrors[0] ? err.odbcErrors[0] : {};
  return { state: first.state || err?.code || 'ERR', message: scrub(first.message || err?.message || 'error', cfg) };
}

module.exports = { scrub, describeError };
