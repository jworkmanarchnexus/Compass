'use strict';
/* Approved diagnostic operations: the default way the agent (and Claude, through the tool server) questions Vantagepoint.
   Each operation builds a fixed statement from validated pieces: table and column names must exist in the data dictionary
   and the table must be on the approved list; no caller text is ever pasted into SQL. Results are counts and structure only
   and leave through the gateway. The SQL is plain and portable so tests run the very same text against synthetic data. */
const registry = require('./registry');
const approvals = require('./approvals');
const { assertReadOnlySql, assertApprovedTable } = require('../server/vp/policy');
const { describeError, scrub } = require('../server/vp/redact');

const q = name => `[${name}]`;
const from = t => `[dbo].${q(t)}`;
const NUMERIC = /^(int|bigint|smallint|tinyint|decimal|numeric|money|smallmoney|float|real)\b/i;

function createOperations({ store, gateway, cfg, vp, investigationId = 'adhoc' }) {
  const table = name => assertApprovedTable(name, cfg);
  const col = (t, c) => registry.resolveColumn(store, t, c);
  const run = async (op, target, sql, opts) => {
    gateway.spend(investigationId, op, target);
    try { return (await vp.query(sql, opts)).rows; }
    catch (e) { throw Object.assign(new Error(scrub(e.message, cfg)), { diagnosticFailed: true, state: e.state }); }
  };
  const num = v => Number(v);
  const log = (op, params, outcome) => store.audit('operation', op, { params, outcome, investigationId });
  const typeOf = (t, c) => store.knowledge.prepare('SELECT data_type FROM dict_columns WHERE tbl = ? AND col = ?').get(t, c)?.data_type || '';

  const ops = {
    async tablePopulation({ table: t }) {
      const T = table(t);
      if (!registry.describeTable(store, T)) throw new Error('registry: unknown table');
      const [r] = await run('tablePopulation', T, `SELECT COUNT(*) AS n FROM ${from(T)}`);
      const out = { table: T, rowCount: num(r.n) };
      log('tablePopulation', { table: T }, 'ok'); return gateway.release(out, cfg);
    },

    async columnPopulation({ table: t, column }) {
      const T = table(t), { column: C } = col(T, column), type = typeOf(T, C);
      const nonzero = NUMERIC.test(type) ? `SUM(CASE WHEN ${q(C)} IS NOT NULL AND ${q(C)} <> 0 THEN 1 ELSE 0 END)` : `SUM(CASE WHEN ${q(C)} IS NOT NULL AND ${q(C)} <> '' THEN 1 ELSE 0 END)`;
      const [r] = await run('columnPopulation', `${T}.${C}`, `SELECT COUNT(*) AS total, COUNT(${q(C)}) AS non_null, ${nonzero} AS nonzero, COUNT(DISTINCT ${q(C)}) AS distinct_n FROM ${from(T)}`);
      const out = { table: T, column: C, valueKind: NUMERIC.test(type) ? 'numeric' : 'text', totalRows: num(r.total), nonNullCount: num(r.non_null), nonzeroCount: num(r.nonzero), distinctCount: num(r.distinct_n) };
      log('columnPopulation', { table: T, column: C }, 'ok'); return gateway.release(out, cfg);
    },

    /* is the table current, and which accounting periods does it cover? Period columns are YYYYMM integers, not money. */
    async periodCoverage({ table: t, column }) {
      const T = table(t), { column: C } = col(T, column);
      if (!/period/i.test(C)) throw new Error('operation: periodCoverage needs a period column');
      const [r] = await run('periodCoverage', `${T}.${C}`, `SELECT MIN(${q(C)}) AS min_p, MAX(${q(C)}) AS max_p, COUNT(DISTINCT ${q(C)}) AS periods FROM ${from(T)}`);
      const out = { table: T, column: C, minPeriod: num(r.min_p), maxPeriod: num(r.max_p), distinctPeriods: num(r.periods) };
      log('periodCoverage', { table: T, column: C }, 'ok'); return gateway.release(out, cfg);
    },

    /* what happens when A is joined to B on these columns: unmatched rows, duplicate keys on B, fan-out (rows after the join) */
    async joinCardinality({ leftTable, leftColumns, rightTable, rightColumns }) {
      if (!Array.isArray(leftColumns) || leftColumns.length === 0 || leftColumns.length !== rightColumns?.length || leftColumns.length > 6) throw new Error('operation: column lists must be the same length (1 to 6)');
      const L = table(leftTable), R = table(rightTable);
      const lc = leftColumns.map(c => col(L, c).column), rc = rightColumns.map(c => col(R, c).column);
      const on = lc.map((c, i) => `l.${q(c)} = r.${q(rc[i])}`).join(' AND ');
      const grp = rc.map(q).join(', ');
      const [r] = await run('joinCardinality', `${L}>${R}`,
        `SELECT (SELECT COUNT(*) FROM ${from(L)}) AS left_rows, ` +
        `(SELECT COUNT(*) FROM ${from(L)} l WHERE NOT EXISTS (SELECT 1 FROM ${from(R)} r WHERE ${on})) AS left_unmatched, ` +
        `(SELECT COUNT(*) FROM ${from(L)} l JOIN ${from(R)} r ON ${on}) AS joined_rows, ` +
        `(SELECT COUNT(*) FROM (SELECT 1 AS x FROM ${from(R)} GROUP BY ${grp} HAVING COUNT(*) > 1) d) AS right_duplicate_keys, ` +
        `(SELECT MAX(c) FROM (SELECT COUNT(*) AS c FROM ${from(R)} GROUP BY ${grp}) g) AS max_per_key`);
      const leftRows = num(r.left_rows), joined = num(r.joined_rows), unmatched = num(r.left_unmatched);
      const out = {
        leftTable: L, rightTable: R, leftColumns: lc, rightColumns: rc,
        leftRows, leftUnmatched: gateway.cell(unmatched), joinedRows: joined, rightDuplicateKeys: gateway.cell(num(r.right_duplicate_keys)), maxPerKey: num(r.max_per_key),
        // fan-out is what double-counts money: joined rows beyond the matched left rows
        fanOutRows: Math.max(0, joined - (leftRows - unmatched)),
        verdict: joined - (leftRows - unmatched) > 0 ? 'many-to-one violated: the join multiplies left rows' : unmatched > 0 ? 'unique on the right, some left rows unmatched' : 'unique on the right, every left row matched',
      };
      log('joinCardinality', { L, R, lc, rc }, out.verdict); return gateway.release(out, cfg);
    },

    async duplicateCheck({ table: t, columns }) {
      if (!Array.isArray(columns) || columns.length === 0 || columns.length > 8) throw new Error('operation: 1 to 8 columns');
      const T = table(t), cs = columns.map(c => col(T, c).column), grp = cs.map(q).join(', ');
      const [r] = await run('duplicateCheck', T, `SELECT COUNT(*) AS total, (SELECT COUNT(*) FROM (SELECT 1 AS x FROM ${from(T)} GROUP BY ${grp}) g) AS distinct_keys, (SELECT COUNT(*) FROM (SELECT 1 AS x FROM ${from(T)} GROUP BY ${grp} HAVING COUNT(*) > 1) d) AS duplicate_keys FROM ${from(T)}`);
      const out = { table: T, columns: cs, totalRows: num(r.total), distinctKeys: num(r.distinct_keys), duplicateKeys: gateway.cell(num(r.duplicate_keys)), unique: num(r.duplicate_keys) === 0 };
      log('duplicateCheck', { T, cs }, out.unique ? 'unique' : 'duplicates'); return gateway.release(out, cfg);
    },

    /* Why might ledger revenue not equal a report? Counts only: projects the join would drop, projects with no known principal or
       type name, and rows that fall in or out of the period depending on posting period versus transaction date. */
    async grossGapChecks({ period }) {
      if (!/^\d{6}$/.test(String(period))) throw new Error('operation: period must be YYYYMM');
      const y = String(period).slice(0, 4), m = Number(String(period).slice(4)), ys = `${y}01`;
      if (m < 1 || m > 12) throw new Error('operation: month out of range');
      const next = m === 12 ? `${Number(y) + 1}0101` : `${y}${String(m + 1).padStart(2, '0')}01`, start = `${y}0101`;
      const rev = `SELECT WBS1 FROM dbo.LedgerAR WHERE TransType = 'IN' AND Period BETWEEN ${ys} AND ${period} GROUP BY WBS1`;
      const parent = `SELECT 1 FROM dbo.PR p WHERE p.WBS1 = g.WBS1 AND p.WBS2 = '' AND p.WBS3 = ''`;
      const withP = `FROM (${rev}) g JOIN dbo.PR p ON p.WBS1 = g.WBS1 AND p.WBS2 = '' AND p.WBS3 = ''`;
      const [r] = await run('grossGapChecks', String(period),
        `SELECT (SELECT COUNT(*) FROM (${rev}) z) AS a, ` +
        `(SELECT COUNT(*) FROM (${rev}) g WHERE NOT EXISTS (${parent})) AS b, ` +
        `(SELECT COUNT(*) FROM (${rev}) g WHERE NOT EXISTS (SELECT 1 FROM dbo.PR p WHERE p.WBS1 = g.WBS1)) AS b2, ` +
        `(SELECT COUNT(*) FROM (${rev}) g WHERE NOT EXISTS (SELECT 1 FROM dbo.PR p WHERE p.WBS1 = g.WBS1) AND EXISTS (SELECT 1 FROM dbo.PR p WHERE UPPER(LTRIM(RTRIM(p.WBS1))) = UPPER(LTRIM(RTRIM(g.WBS1))))) AS b3, ` +
        `(SELECT COUNT(*) FROM (${rev}) g WHERE NOT EXISTS (SELECT 1 FROM dbo.PR p WHERE p.WBS1 = g.WBS1) AND EXISTS (SELECT 1 FROM dbo.PR p WHERE p.WBS1 LIKE g.WBS1 + '%')) AS b4, ` +
        `(SELECT COUNT(*) ${withP} WHERE p.Principal IS NULL OR p.Principal = '') AS c, ` +
        `(SELECT COUNT(*) ${withP} WHERE p.Principal IS NOT NULL AND p.Principal <> '' AND NOT EXISTS (SELECT 1 FROM dbo.EMMain e WHERE e.Employee = p.Principal)) AS d, ` +
        `(SELECT COUNT(*) ${withP} WHERE NOT EXISTS (SELECT 1 FROM dbo.CFGProjectTypeDescriptions t WHERE t.Code = p.ProjectType)) AS e, ` +
        `(SELECT COUNT(*) FROM dbo.LedgerAR WHERE TransType = 'IN' AND Period BETWEEN ${ys} AND ${period}) AS f, ` +
        `(SELECT COUNT(*) FROM dbo.LedgerAR WHERE TransType = 'IN' AND (Period < ${ys} OR Period > ${period}) AND TransDate >= '${start}' AND TransDate < '${next}') AS g2, ` +
        `(SELECT COUNT(*) FROM dbo.LedgerAR WHERE TransType = 'IN' AND Period BETWEEN ${ys} AND ${period} AND (TransDate < '${start}' OR TransDate >= '${next}')) AS h`);
      const out = { period: String(period), projectsWithInvoicesCount: num(r.a), projectsWithoutParentCount: gateway.cell(num(r.b)), projectsWithoutAnyProjectRowCount: gateway.cell(num(r.b2)), unmatchedButMatchAfterTrimAndCaseCount: gateway.cell(num(r.b3)), unmatchedButMatchAsPrefixCount: gateway.cell(num(r.b4)), projectsWithoutPrincipalCount: gateway.cell(num(r.c)),
        projectsPrincipalNotInEmployeesCount: gateway.cell(num(r.d)), projectsWithoutTypeNameCount: gateway.cell(num(r.e)), invoiceRowsInPeriodCount: num(r.f),
        invoiceRowsDateInRangePeriodOutsideCount: gateway.cell(num(r.g2)), invoiceRowsPeriodInRangeDateOutsideCount: gateway.cell(num(r.h)) };
      log('grossGapChecks', { period }, 'ok'); return gateway.release(out, cfg);
    },

    /* Did invoice postings made after a date change the answer? Counts of posted-in-range invoice rows whose posting run happened
       on or after cutoffDate (YYYYMMDD), and the projects they touch. Explains small differences against a report run earlier. */
    async latePostingsCheck({ period, cutoffDate }) {
      if (!/^\d{6}$/.test(String(period)) || !/^\d{8}$/.test(String(cutoffDate))) throw new Error('operation: period YYYYMM and cutoffDate YYYYMMDD');
      const ys = `${String(period).slice(0, 4)}01`;
      const late = `EXISTS (SELECT 1 FROM dbo.CFGPostControl pc WHERE pc.Period = l.Period AND pc.PostSeq = l.PostSeq AND pc.PostDate >= '${cutoffDate}')`;
      const base = `FROM dbo.LedgerAR l WHERE l.TransType = 'IN' AND l.Period BETWEEN ${ys} AND ${period}`;
      const [r] = await run('latePostingsCheck', `${period}:${cutoffDate}`,
        `SELECT (SELECT COUNT(*) ${base} AND ${late}) AS a, (SELECT COUNT(*) FROM (SELECT l.WBS1 ${base} AND ${late} GROUP BY l.WBS1) z) AS b, ` +
        `(SELECT COUNT(*) ${base} AND NOT EXISTS (SELECT 1 FROM dbo.CFGPostControl pc WHERE pc.Period = l.Period AND pc.PostSeq = l.PostSeq)) AS c`);
      const out = { period: String(period), cutoffDate: String(cutoffDate), invoiceRowsPostedOnOrAfterCount: gateway.cell(num(r.a)), projectsTouchedCount: gateway.cell(num(r.b)), invoiceRowsWithNoPostingRecordCount: gateway.cell(num(r.c)) };
      log('latePostingsCheck', { period, cutoffDate }, 'ok'); return gateway.release(out, cfg);
    },

    /* How are rows spread across a short code column (transaction type, status, section)? Only columns of code size (1 to 3
       characters, or small integers) and at most 25 distinct codes: such values are categories, never names or identifiers. */
    async codeCounts({ table: t, column, fromPeriod = null, toPeriod = null, onlyColumn = null, onlyEquals = null }) {
      const T = table(t), { column: C } = col(T, column), type = typeOf(T, C);
      if (!/^(n?var)?char\((1|2|3)\)$|^(small|tiny)int$/i.test(type)) throw new Error('operation: codeCounts is only for short code columns');
      let where = '';
      if (fromPeriod !== null || toPeriod !== null) {
        if (!/^\d{6}$/.test(String(fromPeriod)) || !/^\d{6}$/.test(String(toPeriod))) throw new Error('operation: periods are YYYYMM');
        if (!store.knowledge.prepare("SELECT 1 FROM dict_columns WHERE tbl = ? AND col = 'Period'").get(T)) throw new Error('operation: that table has no Period column');
        where = ` WHERE [Period] BETWEEN ${fromPeriod} AND ${toPeriod}`;
      }
      if (onlyColumn !== null) { // optional second filter, itself a short code column: e.g. only TransType = 'IN'
        const { column: F } = col(T, onlyColumn);
        if (!/^(n?var)?char\((1|2|3)\)$|^(small|tiny)int$/i.test(typeOf(T, F)) || !/^[A-Za-z0-9]{1,3}$/.test(String(onlyEquals))) throw new Error('operation: the filter must be a short code column and a short code');
        where += `${where ? ' AND' : ' WHERE'} ${q(F)} = '${String(onlyEquals)}'`;
      }
      const rows = await run('codeCounts', `${T}.${C}|${onlyColumn}=${onlyEquals}`, `SELECT ${q(C)} AS code, COUNT(*) AS n FROM ${from(T)}${where} GROUP BY ${q(C)}`);
      if (rows.length > 25) throw new Error('operation: too many distinct codes for a category column');
      const out = { table: T, column: C, codes: rows.map(r => ({ code: r.code === null ? '(null)' : String(r.code).trim(), rowCount: gateway.cell(num(r.n)) })).sort((a, b) => String(a.code).localeCompare(String(b.code))) };
      log('codeCounts', { T, C, fromPeriod, toPeriod }, 'ok'); return gateway.release(out, cfg);
    },

    /* One project the reconciliation flagged, named only by its surrogate id. The real number is resolved here on this computer
       (never printed) and used for fixed counts of how its invoice rows are built: automatic entries, retainage, credits, phases,
       rows tied to it from another project, rows whose date and period disagree. Counts are exact here: one project is already
       anonymous, and small counts are the whole point. */
    async projectProfile({ projectId, period }) {
      if (!/^\d{6}$/.test(String(period))) throw new Error('operation: period must be YYYYMM');
      const latest = store.raw.prepare('SELECT data FROM candidate_rows ORDER BY rowid DESC LIMIT 1').get();
      const candidates = latest ? JSON.parse(latest.data).map(r => r.project) : [];
      const wbs1 = gateway.reverseLocal('project', projectId, candidates);
      if (!wbs1 || !/^[A-Za-z0-9._-]{1,30}$/.test(wbs1)) throw new Error('operation: that project id is not in the latest run');
      const y = String(period).slice(0, 4), m = Number(String(period).slice(4)), ys = `${y}01`, start = `${y}0101`;
      const next = m === 12 ? `${Number(y) + 1}0101` : `${y}${String(m + 1).padStart(2, '0')}01`;
      const IN = `FROM dbo.LedgerAR WHERE WBS1 = '${wbs1}' AND TransType = 'IN' AND Period BETWEEN ${ys} AND ${period}`;
      const [r] = await run('projectProfile', projectId,
        `SELECT (SELECT COUNT(*) ${IN}) AS a, (SELECT COUNT(*) ${IN} AND AutoEntry = 'Y') AS b, (SELECT COUNT(*) ${IN} AND SubType = 'R') AS c, ` +
        `(SELECT COUNT(*) ${IN} AND Amount > 0) AS d, (SELECT COUNT(*) ${IN} AND WBS2 <> '') AS e, ` +
        `(SELECT COUNT(*) FROM dbo.LedgerAR WHERE TransType = 'IN' AND Period BETWEEN ${ys} AND ${period} AND WBS1 <> '${wbs1}' AND (LinkWBS1 = '${wbs1}' OR XferWBS1 = '${wbs1}' OR BilledWBS1 = '${wbs1}')) AS f, ` +
        `(SELECT COUNT(*) FROM dbo.LedgerAR WHERE WBS1 = '${wbs1}' AND TransType = 'IN' AND (Period < ${ys} OR Period > ${period}) AND TransDate >= '${start}' AND TransDate < '${next}') AS g2, ` +
        `(SELECT COUNT(*) ${IN} AND (TransDate < '${start}' OR TransDate >= '${next}')) AS h, ` +
        `(SELECT COUNT(*) FROM dbo.PR WHERE WBS1 = '${wbs1}') AS i, (SELECT COUNT(*) FROM dbo.PR WHERE WBS1 = '${wbs1}' AND WBS2 <> '') AS j, ` +
        `(SELECT COUNT(*) FROM dbo.LedgerAR WHERE WBS1 = '${wbs1}' AND TransType = 'IN' AND Period > ${period}) AS k`);
      const out = { projectId, period: String(period), invoiceRowsInPeriodCount: num(r.a), automaticEntryRowsCount: num(r.b), retainageRowsCount: num(r.c), creditRowsCount: num(r.d),
        rowsOnPhaseLevelCount: num(r.e), rowsLinkedFromOtherProjectCount: num(r.f), dateInRangePeriodOutsideCount: num(r.g2), periodInRangeDateOutsideCount: num(r.h),
        projectRecordRowsCount: num(r.i), projectPhaseRecordRowsCount: num(r.j), invoiceRowsLaterPeriodCount: num(r.k) };
      log('projectProfile', { projectId, period }, 'ok'); return gateway.release(out, cfg);
    },

    /* Projects whose market sector in the latest run differs from the reference's grouping: how many, and what is true of them in
       Vantagepoint (does the reference's sector appear on a phase row, was the parent record changed after the period, is its type blank).
       The project numbers and sector names are used only to build the statement here and are never returned; counts only. */
    async sectorMismatchChecks({ referenceId, period, sheet = 'R_M' }) {
      if (!/^\d{6}$/.test(String(period))) throw new Error('operation: period must be YYYYMM');
      const refs = require('./reference-library');
      const latest = store.raw.prepare('SELECT data FROM candidate_rows ORDER BY rowid DESC LIMIT 1').get();
      if (!latest) throw new Error('operation: no candidate run yet');
      const candSector = new Map(JSON.parse(latest.data).map(r => [r.project, String(r.sector || '').trim()]));
      const ref = refs.readEarnings(store, referenceId, { sheet, groupPrefix: 'Project Type:' });
      if (!ref.projects.length) throw new Error('operation: that reference has no project rows');
      const diff = ref.projects.filter(p => candSector.has(p.project) && candSector.get(p.project).toLowerCase() !== p.group.toLowerCase());
      const ok = diff.filter(d => /^\d{7}\.\d{2}$/.test(d.project) && /^[A-Za-z0-9 &,.'\/()-]{1,60}$/.test(d.group));
      const base = { period: String(period), projectsComparedCount: ref.projects.length, projectsInDifferentSectorCount: diff.length };
      if (!ok.length) return gateway.release({ ...base, referenceSectorOnPhaseRowCount: 0, referenceSectorOnParentCount: 0, parentChangedAfterPeriodCount: 0, parentTypeBlankCount: 0, allComparedParentsChangedAfterPeriodCount: 0 }, cfg);
      const allVals = ref.projects.filter(x => /^\d{7}\.\d{2}$/.test(x.project)).map(x => `('${x.project}')`).join(', ');
      const vals = ok.map(d => `('${d.project}', '${d.group.replace(/'/g, "''")}')`).join(', ');
      const V = `(VALUES ${vals}) AS v(w, l)`;
      const after = `${String(period).slice(0, 4)}${String(Number(String(period).slice(4)) + 1).padStart(2, '0')}01`;
      const nextMonth = Number(String(period).slice(4)) === 12 ? `${Number(String(period).slice(0, 4)) + 1}0101` : after;
      const [r] = await run('sectorMismatchChecks', String(referenceId),
        `SELECT (SELECT COUNT(*) FROM ${V} WHERE EXISTS (SELECT 1 FROM dbo.PR p JOIN dbo.CFGProjectTypeDescriptions t ON t.Code = p.ProjectType WHERE p.WBS1 = v.w AND p.WBS2 <> '' AND t.Description = v.l)) AS a, ` +
        `(SELECT COUNT(*) FROM ${V} WHERE EXISTS (SELECT 1 FROM dbo.PR p JOIN dbo.CFGProjectTypeDescriptions t ON t.Code = p.ProjectType WHERE p.WBS1 = v.w AND p.WBS2 = '' AND p.WBS3 = '' AND t.Description = v.l)) AS b, ` +
        `(SELECT COUNT(*) FROM ${V} WHERE EXISTS (SELECT 1 FROM dbo.PR p WHERE p.WBS1 = v.w AND p.WBS2 = '' AND p.WBS3 = '' AND p.ModDate >= '${nextMonth}')) AS c, ` +
        `(SELECT COUNT(*) FROM ${V} WHERE EXISTS (SELECT 1 FROM dbo.PR p WHERE p.WBS1 = v.w AND p.WBS2 = '' AND p.WBS3 = '' AND (p.ProjectType IS NULL OR p.ProjectType = ''))) AS d, ` +
        `(SELECT COUNT(*) FROM (VALUES ${allVals}) AS u(w) WHERE EXISTS (SELECT 1 FROM dbo.PR p WHERE p.WBS1 = u.w AND p.WBS2 = '' AND p.WBS3 = '' AND p.ModDate >= '${nextMonth}')) AS e`);
      log('sectorMismatchChecks', { referenceId, period }, 'ok');
      return gateway.release({ ...base, referenceSectorOnPhaseRowCount: num(r.a), referenceSectorOnParentCount: num(r.b), parentChangedAfterPeriodCount: num(r.c), parentTypeBlankCount: num(r.d), allComparedParentsChangedAfterPeriodCount: num(r.e) }, cfg);
    },

    /* Column names and types of one table as the live database has them (metadata only, no data). Finds firm-defined custom fields
       that the standard dictionary does not list. Table must be in the dictionary; names and types are not sensitive. */
    async liveColumns({ table: t, namePattern = null }) {
      const row = store.knowledge.prepare('SELECT name FROM dict_tables WHERE lower(name) = lower(?)').get(String(t));
      if (!row) throw new Error('registry: unknown table');
      if (namePattern !== null && !/^[A-Za-z0-9_%]{1,30}$/.test(String(namePattern))) throw new Error('operation: bad pattern');
      const like = namePattern ? ` AND COLUMN_NAME LIKE '${namePattern}'` : '';
      const rows = await run('liveColumns', row.name, `SELECT COLUMN_NAME AS name, DATA_TYPE AS type FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${row.name}'${like}`);
      const known = new Set(store.knowledge.prepare('SELECT lower(col) AS c FROM dict_columns WHERE lower(tbl) = lower(?)').all(row.name).map(r => r.c));
      const out = { table: row.name, columnCount: rows.length, columns: rows.map(r => ({ name: String(r.name), type: String(r.type), inDictionary: known.has(String(r.name).toLowerCase()) })).sort((a, b) => a.name.localeCompare(b.name)) };
      // firm-defined columns the dictionary lacks are remembered as such so the other operations can address them
      const add = store.knowledge.prepare("INSERT OR IGNORE INTO dict_columns (tbl, col, primary_key, domain, data_type, nullable, description) VALUES (?,?,?,?,?,?,?)");
      for (const c of out.columns) if (!c.inDictionary) add.run(row.name, c.name, '', 'firm-defined', c.type, '', 'Firm-defined column found in the live schema (not in the Deltek dictionary).');
      log('liveColumns', { table: row.name }, 'ok'); return gateway.release(out, cfg);
    },

    /* Column finder. When no field name is known, look for the column whose per-project totals equal a reference column, across the
       planning and project tables that carry a WBS1 key (tables named PN*, RP*, PR*, Project*, Opp*, EB; no ledgers, no templates).
       Needs an approved scan request first. The reference values are read here, on this computer; only per-column counts leave. */
    requestColumnScan({ referenceId, sheet, projectColumn, amountColumn, amountColumns = null, weightedColumn = null, matchBy = 'number' }) {
      const tables = store.knowledge.prepare("SELECT DISTINCT tbl FROM dict_columns WHERE lower(col) = 'wbs1'").all().map(r => r.tbl)
        .filter(x => /^(PN|RP|PR|Project|Opp|EB$|Plan)/i.test(x) && !/Template$/i.test(x));
      const cols = store.knowledge.prepare(`SELECT tbl, col, data_type FROM dict_columns WHERE tbl IN (${tables.map(() => '?').join(',')})`).all(...tables)
        .filter(c => /^(decimal|money|smallmoney|float|real|int|bigint|smallint)/i.test(c.data_type) && !/^(wbs\d|rowversion|uid)$/i.test(c.col));
      const id = approvals.request(store, { kind: 'disclosure', description: `Scan ${tables.length} project and planning tables (${cols.length} numeric columns) for the column whose per-project totals equal the reference column "${amountColumn}"`,
        scope: { scan: true, tables: tables.length, columns: cols.length, referenceId, sheet, projectColumn, amountColumn: amountColumn || (amountColumns || []).join(' + '), amountColumns, weightedColumn, matchBy, willDisclose: 'for each column, only how many reference projects match exactly; no values, no names' }, investigationId });
      return gateway.release({ approvalId: id, status: 'pending', tablesCount: tables.length, numericColumnsCount: cols.length }, cfg);
    },

    async runColumnScan({ approvalId }) {
      const a = approvals.require(store, approvalId, {});
      if (a.kind !== 'disclosure' || !a.scope.scan) throw new Error('approvals: not a column scan approval');
      const refs = require('./reference-library');
      const Dec = require('./lib/decimal');
      const { referenceId, sheet, projectColumn, amountColumn, amountColumns, weightedColumn, matchBy } = a.scope;
      const multi = Array.isArray(amountColumns) && amountColumns.length > 0;
      const columns = { project: projectColumn, ...(multi ? Object.fromEntries(amountColumns.map((c, i) => ['a' + i, c])) : { amount: amountColumn }), ...(weightedColumn ? { weighted: weightedColumn } : {}) };
      const numericFields = [...(multi ? amountColumns.map((_, i) => 'a' + i) : ['amount']), ...(weightedColumn ? ['weighted'] : [])];
      let ref = refs.readDataset(store, referenceId, { sheet, headerRow: 0, columns, numeric: numericFields, requireNumeric: multi ? [] : ['amount'] });
      if (multi) ref = ref.map(r => ({ ...r, amount: amountColumns.reduce((t, _, i) => t + (r['a' + i] || 0n), 0n) }));
      if (matchBy === 'name') { // the reference lists project names, not numbers: map each unique name to its project number on this computer
        const names = (await vp.query("SELECT WBS1 AS k, Name AS n FROM dbo.PR WHERE WBS2 = '' AND WBS3 = '' AND Status = 'A' AND WBS1 NOT LIKE '[A-Za-z]%'", { rowLimit: 20000 })).rows;
        const count = new Map(); names.forEach(r => count.set(String(r.n).trim(), (count.get(String(r.n).trim()) || 0) + 1));
        const toNo = new Map(names.filter(r => count.get(String(r.n).trim()) === 1).map(r => [String(r.n).trim(), String(r.k).trim()]));
        ref = ref.filter(r => toNo.has(String(r.project).trim())).map(r => ({ ...r, project: toNo.get(String(r.project).trim()) }));
      }
      const want = new Map(ref.map(r => [r.project, r]));
      const keys = [...want.keys()].filter(k => /^[A-Za-z0-9._-]{1,30}$/.test(k));
      const inList = keys.map(k => `'${k}'`).join(', ');
      const tables = store.knowledge.prepare("SELECT DISTINCT tbl FROM dict_columns WHERE lower(col) = 'wbs1'").all().map(r => r.tbl).filter(x => /^(PN|RP|PR|Project|Opp|EB$|Plan)/i.test(x) && !/Template$/i.test(x));
      const results = []; let skipped = 0;
      for (const T of tables) {
        const cols = store.knowledge.prepare('SELECT col, data_type FROM dict_columns WHERE tbl = ?').all(T).filter(c => /^(decimal|money|smallmoney|float|real|int|bigint|smallint)/i.test(c.data_type) && !/^(wbs\d|rowversion|uid)$/i.test(c.col));
        if (!cols.length) continue;
        for (let i = 0; i < cols.length; i += 60) { // a few dozen sums per statement
          const part = cols.slice(i, i + 60);
          gateway.spend(a.id, 'runColumnScan', T + ':' + i);
          let rows;
          try { rows = (await vp.query(`SELECT WBS1 AS k, ${part.map((c, j) => `SUM(${q(c.col)}) AS c${j}`).join(', ')} FROM ${from(T)} WHERE WBS1 IN (${inList}) GROUP BY WBS1`, { rowLimit: 5000, timeoutSeconds: 60 })).rows; }
          catch { skipped += part.length; continue; }
          part.forEach((c, j) => {
            let est = 0, wt = 0, tot = 0;
            for (const r of rows) {
              const w = want.get(String(r.k).trim()); if (!w || r[`c${j}`] === null || r[`c${j}`] === undefined) continue;
              let sum; try { sum = Dec.parse(typeof r[`c${j}`] === 'bigint' ? r[`c${j}`].toString() : r[`c${j}`], { round: true }); } catch { continue; }
              if (w.amount !== 0n && sum === w.amount) est++;
              if (w.weighted !== undefined && w.weighted !== 0n && sum === w.weighted) wt++;
              tot++;
            }
            if (est > 0 || wt > 0) results.push({ table: T, column: c.col, matchesEstimateCount: est, matchesWeightedCount: wt, projectsWithDataCount: tot });
          });
        }
      }
      results.sort((x, y) => (y.matchesEstimateCount + y.matchesWeightedCount) - (x.matchesEstimateCount + x.matchesWeightedCount));
      const payload = { referenceProjectsCount: keys.length, tablesScannedCount: tables.length, columnsNotReadableCount: skipped, matches: results.slice(0, 15) };
      // keep the result locally first so a refused or failed release never costs another full scan; the approval is spent only after release works
      store.raw.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').run('scan:' + approvalId, JSON.stringify(payload));
      const out = gateway.release(payload, cfg);
      approvals.require(store, approvalId, { consume: true });
      log('runColumnScan', { approvalId, tables: tables.length }, 'ok');
      return out;
    },

    /* Where could the contracted revenue forecast come from? Counts for active contracted (non-pursuit) parent projects: how many have
       plans, plan tasks with revenue dates still ahead, task fees, a fee on the project record, tasks dated past year end, and projects
       with more than one plan. Counts only; asOf is YYYYMMDD. */
    async forecastMapping({ asOf }) {
      if (!/^\d{8}$/.test(String(asOf))) throw new Error('operation: asOf must be YYYYMMDD');
      const yearEnd = `${String(asOf).slice(0, 4)}1231`;
      const P = `FROM dbo.PR p WHERE p.WBS2 = '' AND p.WBS3 = '' AND p.Status = 'A' AND p.WBS1 NOT LIKE '[A-Za-z]%'`;
      const hasTask = cond => `EXISTS (SELECT 1 FROM dbo.PNTask k WHERE k.WBS1 = p.WBS1 AND ${cond})`;
      const [r] = await run('forecastMapping', String(asOf),
        `SELECT (SELECT COUNT(*) ${P}) AS a, ` +
        `(SELECT COUNT(*) ${P} AND EXISTS (SELECT 1 FROM dbo.PNPlan x WHERE x.WBS1 = p.WBS1)) AS b, ` +
        `(SELECT COUNT(*) ${P} AND ${hasTask(`k.RevenueEndDate >= '${asOf}'`)}) AS c, ` +
        `(SELECT COUNT(*) ${P} AND ${hasTask(`(k.CompensationFee <> 0 OR k.ConsultantFee <> 0)`)}) AS d, ` +
        `(SELECT COUNT(*) ${P} AND p.Fee <> 0) AS e, ` +
        `(SELECT COUNT(*) ${P} AND ${hasTask(`k.RevenueEndDate > '${yearEnd}'`)}) AS f, ` +
        `(SELECT COUNT(*) ${P} AND (SELECT COUNT(*) FROM dbo.PNPlan x WHERE x.WBS1 = p.WBS1) > 1) AS g, ` +
        `(SELECT COUNT(*) ${P} AND ${hasTask(`k.RevenueEndDate >= '${asOf}' AND (k.CompensationFee <> 0 OR k.ConsultantFee <> 0)`)}) AS h, ` +
        `(SELECT COUNT(*) ${P} AND p.Revenue <> 0) AS i`);
      const out = { asOf: String(asOf), activeContractedProjectsCount: num(r.a), withPlanCount: num(r.b), withTaskDatesAheadCount: num(r.c), withNonzeroTaskCount: num(r.d), withNonzeroProjectTotalCount: num(r.e),
        withTaskDatedPastYearEndCount: num(r.f), withSeveralPlansCount: num(r.g), withNonzeroAndDatesAheadCount: num(r.h), withEarnedFieldCount: num(r.i) };
      log('forecastMapping', { asOf }, 'ok'); return gateway.release(out, cfg);
    },

    /* How many rows fall in each calendar month of a date column (dates are not sensitive): shows what period a time-phased table covers. */
    async dateHistogram({ table: t, column, nonzeroColumn = null }) {
      const T = table(t), { column: C } = col(T, column);
      if (!/date/i.test(typeOf(T, C)) && !/datetime|date/i.test(typeOf(T, C))) throw new Error('operation: dateHistogram needs a date column');
      const nz = nonzeroColumn ? ` WHERE ${q(col(T, nonzeroColumn).column)} <> 0` : '';
      const rows = await run('dateHistogram', `${T}.${C}`, `SELECT CONVERT(varchar(7), ${q(C)}, 120) AS ym, COUNT(*) AS n FROM ${from(T)}${nz} GROUP BY CONVERT(varchar(7), ${q(C)}, 120)`);
      const out = { table: T, column: C, months: rows.filter(r => r.ym).map(r => ({ month: String(r.ym), rowCount: num(r.n) })).sort((a, b) => a.month.localeCompare(b.month)) };
      log('dateHistogram', { T, C }, 'ok'); return gateway.release(out, cfg);
    },

    /* Ratio finder. When a reference column is a percentage nobody can explain (Consultants %), look for two stored columns, or two sums,
       whose ratio reproduces it for every project: a / b and a / (a + b), over per-project totals from the project and planning tables
       plus ledger billing and consultant cost to date. Needs an approved scan request. Only the best pairs (names, counts) leave. */
    requestRatioScan({ referenceId, sheet, projectColumn, ratioColumn, matchBy = 'name' }) {
      const tables = store.knowledge.prepare("SELECT DISTINCT tbl FROM dict_columns WHERE lower(col) = 'wbs1'").all().map(r => r.tbl).filter(x => /^(PN|RP|PR|Project|Opp|EB$|Plan)/i.test(x) && !/Template$/i.test(x) && !/^(PNPlanned|RPPlanned)/i.test(x));
      const id = approvals.request(store, { kind: 'disclosure', description: `Search ${tables.length} project and planning tables, plus ledger billing and consultant cost to date, for the two columns whose ratio equals the reference column "${ratioColumn}"`,
        scope: { scan: true, ratio: true, tables: tables.length, referenceId, sheet, projectColumn, ratioColumn, matchBy, willDisclose: 'only the best column pairs and how many projects each reproduces; no values, no names' }, investigationId });
      return gateway.release({ approvalId: id, status: 'pending', tablesCount: tables.length }, cfg);
    },

    async runRatioScan({ approvalId }) {
      const a = approvals.require(store, approvalId, {});
      if (a.kind !== 'disclosure' || !a.scope.ratio) throw new Error('approvals: not a ratio scan approval');
      const refs = require('./reference-library');
      const { referenceId, sheet, projectColumn, ratioColumn } = a.scope;
      let ref = refs.readDataset(store, referenceId, { sheet, headerRow: 0, columns: { project: projectColumn, ratio: ratioColumn }, numeric: [], requireNumeric: [] });
      const names = (await vp.query("SELECT WBS1 AS k, Name AS n FROM dbo.PR WHERE WBS2 = '' AND WBS3 = '' AND Status = 'A' AND WBS1 NOT LIKE '[A-Za-z]%'", { rowLimit: 20000 })).rows;
      const count = new Map(); names.forEach(r => count.set(String(r.n).trim(), (count.get(String(r.n).trim()) || 0) + 1));
      const toNo = new Map(names.filter(r => count.get(String(r.n).trim()) === 1).map(r => [String(r.n).trim(), String(r.k).trim()]));
      const target = new Map(); // project number -> ratio
      for (const r of ref) { const k = toNo.get(String(r.project).trim()); const v = Number(r.ratio); if (k && Number.isFinite(v)) target.set(k, v); }
      const keys = [...target.keys()].filter(k => /^[A-Za-z0-9._-]{1,30}$/.test(k));
      const inList = keys.map(k => `'${k}'`).join(', ');
      // per-project totals: name -> Map(project -> number)
      const cols = new Map();
      const tables = store.knowledge.prepare("SELECT DISTINCT tbl FROM dict_columns WHERE lower(col) = 'wbs1'").all().map(r => r.tbl).filter(x => /^(PN|RP|PR|Project|Opp|EB$|Plan)/i.test(x) && !/Template$/i.test(x) && !/^(PNPlanned|RPPlanned)/i.test(x));
      for (const T of tables) {
        const cs = store.knowledge.prepare('SELECT col, data_type FROM dict_columns WHERE tbl = ?').all(T).filter(c => /^(decimal|money|smallmoney|float|real|int|bigint|smallint)/i.test(c.data_type) && !/^(wbs\d|rowversion|uid)$/i.test(c.col));
        for (let i = 0; i < cs.length; i += 60) {
          const part = cs.slice(i, i + 60); gateway.spend(a.id, 'runRatioScan', T + ':' + i);
          let rows; try { rows = (await vp.query(`SELECT WBS1 AS k, ${part.map((c, j) => `SUM(${q(c.col)}) AS c${j}`).join(', ')} FROM ${from(T)} WHERE WBS1 IN (${inList}) GROUP BY WBS1`, { rowLimit: 5000, timeoutSeconds: 60 })).rows; } catch { continue; }
          part.forEach((c, j) => { const m = new Map(); for (const r of rows) { const v = Number(r[`c${j}`]); if (Number.isFinite(v)) m.set(String(r.k).trim(), v); } cols.set(`${T}.${c.col}`, m); });
        }
      }
      // ledger billing and consultant cost to date
      const led = (await vp.query(`SELECT WBS1 AS k, -SUM(Amount) AS v FROM dbo.LedgerAR WHERE TransType = 'IN' AND ISNULL(SubType, '') <> 'R' AND WBS1 IN (${inList}) GROUP BY WBS1`, { rowLimit: 5000 })).rows;
      cols.set('ledger billed to date', new Map(led.map(r => [String(r.k).trim(), Number(r.v)])));
      const cons = (await vp.query(`SELECT x.WBS1 AS k, SUM(x.Amount) AS v FROM (SELECT WBS1, Account, Amount FROM dbo.LedgerAP UNION ALL SELECT WBS1, Account, Amount FROM dbo.LedgerEX UNION ALL SELECT WBS1, Account, Amount FROM dbo.LedgerMisc) x JOIN (SELECT Account, MIN(Type) AS Type FROM dbo.CA GROUP BY Account) a ON a.Account = x.Account WHERE a.Type = 8 AND x.WBS1 IN (${inList}) GROUP BY x.WBS1`, { rowLimit: 5000, timeoutSeconds: 120 })).rows;
      cols.set('ledger consultant cost to date', new Map(cons.map(r => [String(r.k).trim(), Number(r.v)])));
      // keep columns with enough nonzero projects
      const usable = [...cols].filter(([, m]) => [...m.values()].filter(v => v !== 0).length >= 15);
      const results = []; const nz = [...target.values()].filter(v => v !== 0).length;
      const hit = (fn) => { let ok = 0, okNz = 0; for (const k of keys) { const v = fn(k); if (v === null) continue; if (Math.abs(v - target.get(k)) < 0.000001) { ok++; if (target.get(k) !== 0) okNz++; } } return [ok, okNz]; };
      for (const [an, am] of usable) for (const [bn, bm] of usable) {
        if (an === bn) continue;
        const g = k => am.get(k) || 0, h = k => bm.get(k) || 0;
        let [ok, okNz] = hit(k => (h(k) === 0 ? (target.get(k) === 0 ? 0 : null) : g(k) / h(k)));
        if (okNz >= nz * 0.5) results.push({ formula: `${an} / ${bn}`, matchesCount: ok, nonzeroMatchesCount: okNz });
        [ok, okNz] = hit(k => (g(k) + h(k) === 0 ? (target.get(k) === 0 ? 0 : null) : g(k) / (g(k) + h(k))));
        if (okNz >= nz * 0.5) results.push({ formula: `${an} / (${an} + ${bn})`, matchesCount: ok, nonzeroMatchesCount: okNz });
      }
      results.sort((x, y) => y.nonzeroMatchesCount - x.nonzeroMatchesCount);
      const payload = { referenceProjectsCount: keys.length, nonzeroReferenceCount: nz, columnsUsedCount: usable.length, matches: results.slice(0, 10) };
      store.raw.prepare('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)').run('scan:' + approvalId, JSON.stringify(payload));
      const out = gateway.release(payload, cfg);
      approvals.require(store, approvalId, { consume: true });
      log('runRatioScan', { approvalId }, 'ok'); return out;
    },

    /* Extended mode. The agent proposes SQL; it cannot run until the owner approves that exact text. Output is shape only
       (column names, row count) unless the approval was scoped to release values, which is then single-use. */
    proposeSql({ sql, why, willDisclose = 'column names and row count only', release = null, maxRows = null }) {
      assertReadOnlySql(sql);
      const tables = [...new Set([...String(sql).matchAll(/\b(?:FROM|JOIN)\s+(?:\[?dbo\]?\.)?\[?([A-Za-z_][A-Za-z0-9_]*)\]?/gi)].map(m => m[1]))];
      const unknown = tables.filter(t => !store.knowledge.prepare('SELECT 1 FROM dict_tables WHERE lower(name) = lower(?)').get(t));
      const id = approvals.request(store, { kind: 'sql', description: String(why || '').slice(0, 300), sql, scope: { tables, unknownTables: unknown, willDisclose, ...(release === 'values' ? { release: 'values', maxRows: Math.min(Number(maxRows) || 1, 20) } : {}) }, investigationId });
      return gateway.release({ approvalId: id, status: 'pending', tables, unknownTables: unknown, message: 'Waiting for the owner to review and approve this exact statement.' }, cfg);
    },

    async runApprovedSql({ approvalId }) {
      const a = approvals.require(store, approvalId, {});
      if (a.kind !== 'sql') throw new Error('approvals: not an SQL approval');
      approvals.require(store, approvalId, { sql: a.sql_text });
      const text = assertReadOnlySql(a.sql_text);
      gateway.spend(investigationId, 'runApprovedSql', approvalId);
      let res;
      try { res = await vp.query(text); }
      catch (e) { throw Object.assign(new Error(scrub(e.message, cfg)), { diagnosticFailed: true }); }
      const columns = res.rows[0] ? Object.keys(res.rows[0]) : [];
      if (a.scope.release === 'values') {
        approvals.require(store, approvalId, { consume: true });
        return gateway.releaseApproved(approvalId, { columns, rows: res.rows.slice(0, a.scope.maxRows || 20), truncated: res.truncated });
      }
      return gateway.release({ columns, rowCount: res.rows.length, truncated: res.truncated }, cfg);
    },
  };
  return ops;
}

module.exports = { createOperations };
