'use strict';
/* Privacy and disclosure gateway. Every value that leaves the local machine toward the AI passes release().
   The AI is never given a tool that prints database values. This file enforces that in code, not in a prompt:

   1. Typed output only. Numbers are allowed only under count-like keys; money-like or identifier-like strings are refused.
   2. Surrogates. Real project numbers, PIC codes, client and employee names become stable keyed pseudonyms (HMAC with a local key
      kept in the protected store); the key never leaves, so a surrogate cannot be reversed or recomputed from outside.
   3. Small cells. Group counts below MIN_CELL are shown as "<5" so a count cannot single out one project.
   4. Budget. Each (investigation, operation, target) has a call budget, so repeated near-identical questions cannot
      reconstruct a hidden value by differencing.
   5. Approvals. Anything beyond the above (reviewed SQL, values) needs a human decision recorded outside the AI's reach. */
const crypto = require('node:crypto');
const { scrub } = require('../server/vp/redact');

const MIN_CELL = 5;
const MAX_COUNT = 1e9;
// numbers may only appear under a key built for counting; this list is deliberately short and explicit (add to it with care)
const COUNT_KEYS = new Set(['version', 'minPeriod', 'maxPeriod', 'score', 'seq', 'limit', 'ms', 'count', 'exact', 'withinTolerance', 'mismatched', 'missingInCandidate', 'unexpectedInCandidate', 'zeroOnBothSides',
  'sourcesEvaluated', 'testsExecuted', 'testsPassed', 'testsFailedToReproduce', 'testsCouldNotRun', 'requiredLevels', 'unmetLevels', 'pendingApprovals', 'maxPerKey', 'maxPerKeyCount']);
const COUNT_SUFFIX = /(Count|Rows|Keys|Groups|Periods|Cells|Unmatched)$/;
const FORBIDDEN_WORDS = new Set(['amount', 'amounts', 'revenue', 'billed', 'fee', 'fees', 'salary', 'rate', 'rates', 'balance', 'sum', 'avg', 'mean', 'median', 'min', 'max', 'value', 'values', 'dollars', 'dollar', 'cost', 'price', 'gross', 'arch', 'architectural', 'consultant']);
const FORBIDDEN_KEY = { test: k => String(k).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).some(w => FORBIDDEN_WORDS.has(w)) };
const ALLOWED_FORBIDDEN_KEYS = /^(maxPeriod|minPeriod|max_per_key|maxPerKey|dataType|data_type|valueKind|columnCount|variance_?class|varianceClass|feeFieldCount)$/;
const MONEYISH = /\$\s?\d|\b\d{1,3}(,\d{3})+(\.\d+)?\b|\b\d+\.\d{2,}\b/;

function secretKey(store) {
  const row = store.raw.prepare("SELECT v FROM kv WHERE k = 'surrogate_key'").get();
  if (row) return Buffer.from(row.v, 'hex');
  const key = crypto.randomBytes(32);
  store.raw.prepare("INSERT INTO kv (k, v) VALUES ('surrogate_key', ?)").run(key.toString('hex'));
  return key;
}

function createGateway(store, { minCell = MIN_CELL, budget = 200 } = {}) {
  const key = secretKey(store);
  const used = new Map();

  const gw = {
    /* stable pseudonym: same input -> same output on this machine; kind keeps projects, PICs and sectors in separate spaces */
    surrogate(kind, id) {
      const h = crypto.createHmac('sha256', key).update(kind + '\u0000' + String(id)).digest('hex').slice(0, 8);
      return `${String(kind).slice(0, 3).toUpperCase()}-${h}`;
    },
    /* lets the local owner (CLI only) look a surrogate back up; the tool server never exposes this */
    reverseLocal(kind, id, candidates) { return candidates.find(c => gw.surrogate(kind, c) === id) ?? null; },

    cell(n) { return n < minCell && n > 0 ? `<${minCell}` : n; },

    spend(investigationId, op, target) {
      const k = `${investigationId}|${op}|${target}`;
      const n = (used.get(k) || 0) + 1;
      used.set(k, n);
      if (n > budget) throw new Error('gateway: call budget for this question is used up; ask the owner to review');
    },

    /* walk the object; throw on anything that could carry a raw financial value or identifier */
    check(value, trail = '') {
      if (value === null || value === undefined || typeof value === 'boolean') return;
      if (typeof value === 'bigint') throw new Error(`gateway: raw number refused at ${trail || 'root'}`);
      if (typeof value === 'number') {
        // only whole numbers of count size may pass: money has cents, and large integers are amounts or timestamps
        const leaf = trail.split('.').pop().replace(/\[\d+\]$/, '');
        if (!Number.isInteger(value) || Math.abs(value) > MAX_COUNT || !(COUNT_KEYS.has(leaf) || COUNT_SUFFIX.test(leaf))) throw new Error(`gateway: number refused at ${trail || 'root'}`);
        return;
      }
      if (typeof value === 'string') {
        // dictionary text and messages are scrubbed on the way out; any other string that looks like money is refused outright
        if (MONEYISH.test(value) && !/(^|\.)(description|definition|note|message|detail)$/.test(trail.replace(/\[\d+\]/g, ''))) throw new Error(`gateway: money-like text refused at ${trail || 'root'}`);
        return;
      }
      if (Array.isArray(value)) { value.forEach((v, i) => gw.check(v, `${trail}[${i}]`)); return; }
      if (typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
          if (FORBIDDEN_KEY.test(k) && !ALLOWED_FORBIDDEN_KEYS.test(k) && typeof v === 'number') throw new Error(`gateway: field "${k}" cannot carry a number`);
          gw.check(v, trail ? `${trail}.${k}` : k);
        }
        return;
      }
      throw new Error('gateway: unsupported value');
    },

    /* the only exit. returns a deep copy with strings scrubbed */
    release(output, cfg = {}) {
      gw.check(output);
      const clean = v => (typeof v === 'string' ? scrub(v, cfg) : Array.isArray(v) ? v.map(clean) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)])) : v);
      const out = clean(output);
      store.audit('gateway', 'release', { keys: Object.keys(output || {}), bytes: JSON.stringify(out).length });
      return out;
    },

    /* the one exception: content the owner approved for disclosure, exactly as scoped. Logged; one use only (enforced by approvals.js). */
    releaseApproved(approvalId, payload) {
      store.audit('gateway', 'release-approved', { approvalId, bytes: JSON.stringify(payload, (_, v) => (typeof v === 'bigint' ? v.toString() : v)).length });
      const copy = JSON.parse(JSON.stringify(payload, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
      Object.defineProperty(copy, '__approved', { value: true, enumerable: false }); // lets the tool server pass it through unchanged
      return copy;
    },
  };
  return gw;
}

module.exports = { createGateway, MIN_CELL };
