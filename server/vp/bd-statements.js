'use strict';
/* The Marketing Report's fixed Vantagepoint statements. Each was reconciled against a Vantagepoint export before it was put here:
     revenue    docs/BD-REVENUE-METHOD.md  (YTD gross less Direct Consultant, by posting period; June and July 2026, October 2026 exact)
     forecast   docs/FORECAST-METHOD.md    (plan revenue entries with their dates; spread by working days in logic/forecast.js)
     holidays   the firm holiday calendar the forecast spread leaves out
     pursuits   docs/MWIP-METHOD.md        (pursuit project records; spread with the Admin's options in logic/mwip.js)
     principals the people who are principal on a project or pursuit, for the PIC names
   Only plain SELECTs; the connection's policy (server/vp/policy.js) refuses anything else. Parameters are numbers built here,
   never text from a person. Amounts come back in dollars; server/vp/bd-snapshot.js turns them into cents. */

const PIC = "LTRIM(RTRIM(ISNULL(e.LastName, ''))) + ', ' + LTRIM(RTRIM(ISNULL(e.FirstName, '')))";
const SECTOR_JOIN = 'LEFT JOIN (SELECT Code, MIN(Description) AS Description FROM dbo.CFGProjectTypeDescriptions GROUP BY Code) t ON t.Code = p.ProjectType';

function check(period) {
  if (!Number.isInteger(period) || period < 200001 || period > 209912 || period % 100 < 1 || period % 100 > 12) throw new Error('bd-statements: period must be YYYYMM');
  return { year: Math.floor(period / 100), month: period % 100 };
}

function statements(period) {
  const { year, month } = check(period);
  const yearStart = year * 100 + 1;
  // the forecast counts the months after the report month through December 31 (empty for a December report)
  const firstDay = month === 12 ? `${year + 1}0101` : `${year}${String(month + 1).padStart(2, '0')}01`;
  return {
    revenue: `SELECT COALESCE(g.WBS1, k.WBS1) AS project, p.Name AS name, p.Principal AS pic_code, ${PIC} AS pic,
       ISNULL(t.Description, p.ProjectType) AS sector, ISNULL(g.gross, 0) AS gross, ISNULL(k.consultant, 0) AS consultant
FROM (SELECT WBS1, -SUM(Amount) AS gross FROM dbo.LedgerAR
      WHERE TransType = 'IN' AND ISNULL(SubType, '') <> 'R' AND Period BETWEEN ${yearStart} AND ${period} GROUP BY WBS1) g
FULL JOIN (SELECT x.WBS1, SUM(x.Amount) AS consultant
           FROM (SELECT WBS1, Account, Amount FROM dbo.LedgerAP WHERE Period BETWEEN ${yearStart} AND ${period}
                 UNION ALL SELECT WBS1, Account, Amount FROM dbo.LedgerEX WHERE Period BETWEEN ${yearStart} AND ${period}
                 UNION ALL SELECT WBS1, Account, Amount FROM dbo.LedgerMisc WHERE Period BETWEEN ${yearStart} AND ${period}) x
           JOIN (SELECT Account, MIN(Type) AS Type FROM dbo.CA GROUP BY Account) a ON a.Account = x.Account
           WHERE a.Type IN (8) GROUP BY x.WBS1) k ON k.WBS1 = g.WBS1
JOIN dbo.PR p ON p.WBS1 = COALESCE(g.WBS1, k.WBS1) AND p.WBS2 = '' AND p.WBS3 = ''
LEFT JOIN dbo.EMMain e ON e.Employee = p.Principal
${SECTOR_JOIN}`,

    forecast: `SELECT p.WBS1 AS project, p.Name AS name, p.Principal AS pic_code, ${PIC} AS pic, ISNULL(t.Description, p.ProjectType) AS sector,
       ISNULL(p.Fee, 0) AS fee, ISNULL(p.ConsultFee, 0) AS consult_fee, ISNULL(p.ReimbAllow, 0) AS reimb_allow,
       CONVERT(varchar(10), r.StartDate, 120) AS start_date, CONVERT(varchar(10), r.EndDate, 120) AS end_date, r.PeriodCost AS amount
FROM dbo.PR p
JOIN dbo.PNTask k ON k.WBS1 = p.WBS1
JOIN dbo.PNPlannedRevenueLabor r ON r.PlanID = k.PlanID AND r.TaskID = k.TaskID
LEFT JOIN dbo.EMMain e ON e.Employee = p.Principal
${SECTOR_JOIN}
WHERE p.WBS2 = '' AND p.WBS3 = '' AND p.Status = 'A' AND p.WBS1 NOT LIKE '[A-Za-z]%' AND r.PeriodCost <> 0
  AND r.EndDate >= '${firstDay}' AND r.StartDate < '${year + 1}0101'`,

    holidays: 'SELECT DISTINCT CONVERT(varchar(10), HolidayDate, 120) AS d FROM dbo.CFGHoliday',

    // Vantagepoint's forecast "Consultants %", as its own report query defines it ([dirjtd] / [JTDEarnedRevenue], from the
    // "CFO-Nexus Revenue Forecast Detail" report definition): direct costs = CA.Type 7 or 8 lines flagged ProjectCost = 'Y',
    // earned revenue = -(CA.Type 4 lines), both across all four ledgers, job to date through the report month.
    // 143 of 144 projects exact (2026-11-28). For active projects; the inputs, per project.
    toDate: `SELECT x.WBS1 AS project,
       SUM(CASE WHEN a.Type IN (7, 8) AND x.ProjectCost = 'Y' THEN x.Amount ELSE 0 END) AS direct_cost,
       -SUM(CASE WHEN a.Type = 4 THEN x.Amount ELSE 0 END) AS earned
FROM (SELECT WBS1, Account, Amount, ProjectCost FROM dbo.LedgerAP WHERE Period <= ${period}
      UNION ALL SELECT WBS1, Account, Amount, ProjectCost FROM dbo.LedgerAR WHERE Period <= ${period}
      UNION ALL SELECT WBS1, Account, Amount, ProjectCost FROM dbo.LedgerEX WHERE Period <= ${period}
      UNION ALL SELECT WBS1, Account, Amount, ProjectCost FROM dbo.LedgerMisc WHERE Period <= ${period}) x
JOIN (SELECT Account, MIN(Type) AS Type FROM dbo.CA GROUP BY Account) a ON a.Account = x.Account
JOIN dbo.PR p ON p.WBS1 = x.WBS1 AND p.WBS2 = '' AND p.WBS3 = ''
WHERE p.Status = 'A' AND p.WBS1 NOT LIKE '[A-Za-z]%' AND a.Type IN (4, 7, 8)
GROUP BY x.WBS1`,

    pursuits: `SELECT p.WBS1 AS project, p.Name AS name, p.Principal AS pic_code, ${PIC} AS pic, ISNULL(t.Description, p.ProjectType) AS sector,
       ISNULL(p.Revenue, 0) AS revenue, ISNULL(p.WeightedRevenue, 0) AS weighted, p.Stage AS stage, p.Probability AS probability,
       CONVERT(varchar(10), p.EstStartDate, 120) AS est_start, CONVERT(varchar(10), p.EstCompletionDate, 120) AS est_completion
FROM dbo.PR p
LEFT JOIN dbo.EMMain e ON e.Employee = p.Principal
${SECTOR_JOIN}
WHERE p.WBS2 = '' AND p.WBS3 = '' AND p.WBS1 LIKE '[A-Za-z]%' AND p.Status = 'A' AND p.Probability > 0 AND p.Probability < 100`,

    principals: `SELECT DISTINCT e.Employee AS code, LTRIM(RTRIM(ISNULL(e.FirstName, ''))) AS first_name, LTRIM(RTRIM(ISNULL(e.LastName, ''))) AS last_name
FROM dbo.EMMain e JOIN dbo.PR p ON p.Principal = e.Employee
WHERE p.WBS2 = '' AND p.WBS3 = ''`,
  };
}

module.exports = { statements };
