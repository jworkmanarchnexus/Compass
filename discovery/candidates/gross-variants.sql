SELECT g.WBS1 AS project,
       LTRIM(RTRIM(ISNULL(e.LastName, ''))) + ', ' + LTRIM(RTRIM(ISNULL(e.FirstName, ''))) AS pic,
       ISNULL(t.Description, p.ProjectType) AS sector,
       g.gross_all AS gross_all,
       g.gross_no_auto AS gross_no_auto,
       g.gross_no_retainage AS gross_no_retainage,
       g.gross_neither AS gross_neither,
       g.gross_sectioned_only AS gross_sectioned_only
FROM (SELECT WBS1,
             -SUM(Amount) AS gross_all,
             -SUM(CASE WHEN AutoEntry = 'Y' THEN 0 ELSE Amount END) AS gross_no_auto,
             -SUM(CASE WHEN SubType = 'R' THEN 0 ELSE Amount END) AS gross_no_retainage,
             -SUM(CASE WHEN AutoEntry = 'Y' OR SubType = 'R' THEN 0 ELSE Amount END) AS gross_neither,
             -SUM(CASE WHEN InvoiceSection IS NULL THEN 0 ELSE Amount END) AS gross_sectioned_only
      FROM dbo.LedgerAR
      WHERE TransType = 'IN' AND Period BETWEEN {{yearStart}} AND {{period}}
      GROUP BY WBS1) g
JOIN dbo.PR p ON p.WBS1 = g.WBS1 AND p.WBS2 = '' AND p.WBS3 = ''
LEFT JOIN dbo.EMMain e ON e.Employee = p.Principal
LEFT JOIN (SELECT Code, MIN(Description) AS Description FROM dbo.CFGProjectTypeDescriptions GROUP BY Code) t ON t.Code = p.ProjectType
