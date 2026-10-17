'use strict';
/* Settings for the live Vantagepoint connection (Discovery Agent). Read from the environment, or from `.env.vp` in the
   repo root (git-ignored; copy `.env.vp.example`). The password lives only there: never in chat, code, logs or git.
   The DSN is the Windows ODBC data source that already holds the server address (the same one DBeaver uses). */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

// the only tables the agent may touch: the ones reference/handoff/sql/compass_negative_projects.sql reads, plus CA (chart of accounts: account types)
const APPROVED_TABLES = ['PR', 'EMMain', 'LD', 'LedgerAP', 'LedgerAR', 'LedgerEX', 'LedgerMisc', 'RPPlan', 'CA', 'RPTask', 'PNPlan', 'PNTask', 'PRRevenue'];

function parseEnvFile(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  return out;
}

function loadConfig(env = process.env, file = path.join(ROOT, '.env.vp')) {
  let fromFile = {};
  try { fromFile = parseEnvFile(fs.readFileSync(file, 'utf8')); } catch { /* no file: environment only */ }
  const get = k => env[k] ?? fromFile[k];
  const num = (k, d) => { const n = Number(get(k)); return Number.isFinite(n) && n > 0 ? n : d; };
  return {
    dsn: get('VP_DSN') || '',
    user: get('VP_USER') || '',
    password: get('VP_PASSWORD') || '',
    database: get('VP_DATABASE') || '',
    queryTimeoutSeconds: num('VP_QUERY_TIMEOUT_S', 30),
    connectTimeoutSeconds: num('VP_CONNECT_TIMEOUT_S', 15),
    rowLimit: num('VP_ROW_LIMIT', 200),
    approvedTables: APPROVED_TABLES,
  };
}

function missing(cfg) {
  return [['VP_DSN', cfg.dsn], ['VP_USER', cfg.user], ['VP_PASSWORD', cfg.password]].filter(([, v]) => !v).map(([k]) => k);
}

module.exports = { loadConfig, missing, parseEnvFile, APPROVED_TABLES, ROOT };
