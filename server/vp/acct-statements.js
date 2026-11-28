'use strict';
/* Principal Accountability's fixed Vantagepoint statements. GROSS figures, never a Marketing Report figure (Josh, 2026-11-27).

     ledger     billed, labor and expenses per project per month, January through the report month. The same arithmetic as
                reference/handoff/sql/compass_negative_projects.sql (the validated Project Turnaround query): billed is LedgerAR
                TransType 'IN' (sign flipped); labor is LD RegAmt + OvtAmt + SpecialOvtAmt; expenses are LedgerAP 'AP', LedgerMisc 'JE'
                and LedgerEX 'EX' where ProjectCost = 'Y'. That query ends in SELECT ... INTO #Profit, which the connection's
                policy refuses, so it is rewritten here as one plain SELECT that returns months instead of the three windows;
                modules/turnaround/logic/profit.js then adds them up and applies the overhead, as it does for the made-up files.
     projects   every top-level project (number, name, PIC, PM, status, charge type), so the job can apply the query's filters
                (Status 'A', ChargeType 'R', not Z or J) and Compass can see what those filters leave out
     overhead   the lowest and highest RPPlan overhead rate per project (a project with none, or two different ones, cannot be
                evaluated; no rate is ever invented)

   The backlog, MWIP, holiday and names statements are the same Vantagepoint reads the Marketing Report's pull uses
   (server/vp/bd-statements.js); Accountability takes the raw rows and works out its own gross figures from them.
   Only plain SELECTs on approved tables; parameters are numbers built here. Amounts come back in dollars. */

function check(period) {
  if (!Number.isInteger(period) || period < 200001 || period > 209912 || period % 100 < 1 || period % 100 > 12) throw new Error('acct-statements: period must be YYYYMM');
  return { year: Math.floor(period / 100) };
}

function statements(period) {
  const { year } = check(period);
  const from = year * 100 + 1, to = period;
  const win = `Period BETWEEN ${from} AND ${to}`;
  return {
    ledger: `WITH m AS (
  SELECT WBS1, Period, -SUM(Amount) AS billed, 0 AS labor, 0 AS expenses FROM dbo.LedgerAR WHERE TransType = 'IN' AND ${win} GROUP BY WBS1, Period
  UNION ALL
  SELECT WBS1, Period, 0, SUM(ISNULL(RegAmt, 0) + ISNULL(OvtAmt, 0) + ISNULL(SpecialOvtAmt, 0)), 0 FROM dbo.LD WHERE ${win} GROUP BY WBS1, Period
  UNION ALL
  SELECT WBS1, Period, 0, 0, SUM(Amount) FROM dbo.LedgerAP WHERE TransType = 'AP' AND ProjectCost = 'Y' AND ${win} GROUP BY WBS1, Period
  UNION ALL
  SELECT WBS1, Period, 0, 0, SUM(Amount) FROM dbo.LedgerMisc WHERE TransType = 'JE' AND ProjectCost = 'Y' AND ${win} GROUP BY WBS1, Period
  UNION ALL
  SELECT WBS1, Period, 0, 0, SUM(Amount) FROM dbo.LedgerEX WHERE TransType = 'EX' AND ProjectCost = 'Y' AND ${win} GROUP BY WBS1, Period
)
SELECT WBS1 AS project, Period AS period, SUM(billed) AS billed, SUM(labor) AS labor, SUM(expenses) AS expenses
FROM m GROUP BY WBS1, Period`,

    projects: `SELECT p.WBS1 AS project, p.Name AS name, p.Principal AS pic_code, p.ProjMgr AS pm_code, p.Status AS status, p.ChargeType AS charge_type
FROM dbo.PR p WHERE p.WBS2 = '' AND p.WBS3 = ''`,

    overhead: 'SELECT WBS1 AS project, MIN(OverheadPct) AS min_oh, MAX(OverheadPct) AS max_oh FROM dbo.RPPlan GROUP BY WBS1',
  };
}

module.exports = { statements };
