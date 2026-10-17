#!/usr/bin/env node
'use strict';
/* Owner's command line. Run: node discovery/cli.js <command>. The owner is the only one who can approve, confirm a period,
   register a reference or see a real value. Output here is metadata and statuses; reconciliation detail stays in the protected store. */
const agent = require('./agent');
const registry = require('./registry');
const inv = require('./investigations');
const refs = require('./reference-library');
const approvals = require('./approvals');
const metrics = require('./metrics');
const pipeline = require('./pipeline');

const HELP = `Compass VP Discovery & Validation Agent

  setup [dictionaryDir]                     import the data dictionary and earlier findings (safe to repeat)
  dict search <words...>                    search the dictionary by meaning
  dict table <name>                         columns of a table
  refs register <file> --name N --kind primary-vp-export|downstream-workbook [--period YYYYMM --cutoff YYYY-MM-DD --report-type T --sheets A,B]
  refs list | refs headers <refId> <sheet> | refs confirm <refId> <YYYYMM> <YYYY-MM-DD>
  refs acknowledge <refId> <sheet> <rowText> <columnHeader> <vpValue> [reason...]   record that a cell was hand-edited and what VP itself produced
  inv start <title> -- <requirement>        open an investigation
  inv list | inv status <id> | inv resume <id>
  approvals                                 what is waiting for you, and exactly what it would run
  approve <id> | deny <id>
  candidate request <candidateId> <YYYYMM> <investigationId>      ask for approval to run a candidate statement
  run <specId> <candidateId> <YYYYMM> <refId> <approvalId> <investigationId>
  metric approve <name> <version>           OWNER ONLY: approve a reconciled metric for Compass to use
  metrics [name]                            metric definitions and status
  recon [runId]                             OWNER ONLY: the real names and amounts behind the latest (or a given) reconciliation run
  op <operation> '<json>' [investigationId] run one approved diagnostic (counts only), e.g. op periodCoverage '{"table":"LedgerAR","column":"Period"}'
  serve                                     start the local tool server for Claude (stdio)
`;

const flag = (args, name) => { const i = args.indexOf('--' + name); return i < 0 ? null : args.splice(i, 2)[1]; };
const print = o => console.log(typeof o === 'string' ? o : JSON.stringify(o, null, 2));

async function main(argv) {
  const [cmd, sub, ...rest] = argv;
  if (!cmd || cmd === 'help') return print(HELP);
  const ctx = agent.createContext();
  try {
    switch (cmd) {
      case 'setup': return print(agent.setup(ctx, sub ? { dictionaryDir: sub } : {}));
      case 'dict': return print(sub === 'search' ? registry.search(ctx.store, rest.join(' ')) : registry.describeTable(ctx.store, rest[0]) || 'unknown table');
      case 'refs': {
        if (sub === 'list') return print(refs.list(ctx.store));
        if (sub === 'confirm') return print(refs.confirm(ctx.store, rest[0], { period: rest[1], cutoff: rest[2] }) || 'confirmed');
        if (sub === 'acknowledge') { const [refId, sheet, rowText, column, value, ...reason] = rest; refs.acknowledgeEdit(ctx.store, refId, { sheet, rowContains: rowText, column, value, reason: reason.join(' ') }); return print('recorded (kept locally, not in git)'); }
        if (sub === 'headers') {
          const rows = ctx.store.raw.prepare('SELECT row_no, data FROM ref_rows WHERE ref_id = ? AND sheet = ? ORDER BY row_no LIMIT 12').all(rest[0], rest[1]);
          return print(rows.map(r => ({ row: r.row_no, text: JSON.parse(r.data).filter(c => c && c.num === 0 && c.t).map(c => c.t) })).filter(r => r.text.length)); // text cells only: headers, never numbers
        }
        if (sub === 'register') {
          const file = rest.shift();
          const o = { name: flag(rest, 'name'), kind: flag(rest, 'kind'), period: flag(rest, 'period'), cutoff: flag(rest, 'cutoff'), reportType: flag(rest, 'report-type'), sheets: (flag(rest, 'sheets') || '').split(',').filter(Boolean) };
          return print(refs.register(ctx.store, file, o));
        }
        break;
      }
      case 'inv':
        if (sub === 'start') { const i = rest.indexOf('--'); return print({ investigationId: inv.create(ctx.store, { title: rest.slice(0, i).join(' '), requirement: rest.slice(i + 1).join(' ') }) }); }
        if (sub === 'list') return print(inv.list(ctx.store));
        if (sub === 'status') return print(inv.status(ctx.store, rest[0]));
        if (sub === 'resume') return print(inv.resume(ctx.store, rest[0]));
        break;
      case 'approvals':
        return print(approvals.pending(ctx.store).map(a => ({ id: a.id, kind: a.kind, why: a.description, willDisclose: a.scope.release === 'values' ? `${a.scope.willDisclose} (values released to Claude once, at most ${a.scope.maxRows} row)` : a.scope.willDisclose, tables: a.scope.tables, sql: a.sql_text })));
      case 'approve': for (const id of [sub, ...rest]) approvals.decide(ctx.store, id, true); return print('approved ' + [sub, ...rest].join(' '));
      case 'deny': approvals.decide(ctx.store, sub, false); return print('denied ' + sub);
      case 'candidate': return print({ approvalId: pipeline.requestCandidateApproval(ctx.store, rest[0], { period: rest[1], from: rest[3] ?? null }, rest[2]), next: 'review with `approvals`, then `approve <id>`' });
      case 'run': {
        const [candidateId, period, refId, approvalId, investigationId] = rest;
        return print(await agent.runSpec(ctx, { specId: sub, candidateId, period, refId, approvalId, investigationId }));
      }
      case 'metric': if (sub === 'approve') { metrics.approve(ctx.store, rest[0], Number(rest[1])); return print(`approved ${rest[0]} v${rest[1]}`); } break;
      case 'metrics': return print(sub ? metrics.get(ctx.store, sub) : ctx.store.knowledge.prepare('SELECT name, version, status FROM metrics ORDER BY name, version').all());
      case 'recon': {
        const Dec = require('./lib/decimal');
        const runId = sub || ctx.store.raw.prepare('SELECT run_id FROM recon_detail ORDER BY rowid DESC LIMIT 1').get()?.run_id;
        if (!runId) return print('no runs yet');
        console.log(`Run ${runId} (private: real names and amounts, shown only here)`);
        for (const r of ctx.store.raw.prepare("SELECT level, detail FROM recon_detail WHERE run_id = ? AND key = 'summary' ORDER BY rowid").all(runId)) {
          for (const [lvl, v] of Object.entries(JSON.parse(r.detail))) {
            console.log(`
${lvl}: ${v.status}`);
            for (const e of v.exceptions) console.log(`  ${e.type}  ${Object.values(e.fields).join(' / ') || '(firm)'}  reference ${Dec.toString(BigInt(e.ref))}  ours ${Dec.toString(BigInt(e.cand))}  difference ${Dec.toString(BigInt(e.cand) - BigInt(e.ref))}`);
          }
        }
        return;
      }
      case 'op': return print(await ctx.operations(rest[1] || 'adhoc')[sub](JSON.parse(rest[0] || '{}')));
      case 'serve': { require('./mcp-server').serve(ctx); return new Promise(() => {}); }
    }
    print(HELP);
  } finally { if (cmd !== 'serve') { await ctx.vp.close(); ctx.store.close(); } }
}

main(process.argv.slice(2)).catch(e => { console.error(require('../server/vp/redact').scrub(e.message, require('../server/vp/config').loadConfig())); process.exitCode = 1; });
