SELECT COALESCE(g.WBS1, k.WBS1) AS project,
       LTRIM(RTRIM(ISNULL(e.LastName, ''))) + ', ' + LTRIM(RTRIM(ISNULL(e.FirstName, ''))) AS pic,
       ISNULL(t.Description, p.ProjectType) AS sector,
       ISNULL(g.gross, 0) AS gross,
       ISNULL(k.consultant, 0) AS consultant_ledger
FROM (SELECT WBS1, -SUM(Amount) AS gross
      FROM dbo.LedgerAR
      WHERE TransType = 'IN' AND Period BETWEEN {{yearStart}} AND {{period}}
      GROUP BY WBS1) g
FULL JOIN (SELECT x.WBS1, SUM(x.Amount) AS consultant
           FROM (SELECT WBS1, Account, Amount FROM dbo.LedgerAP WHERE Period BETWEEN {{yearStart}} AND {{period}}
                 UNION ALL
                 SELECT WBS1, Account, Amount FROM dbo.LedgerEX WHERE Period BETWEEN {{yearStart}} AND {{period}}
                 UNION ALL
                 SELECT WBS1, Account, Amount FROM dbo.LedgerMisc WHERE Period BETWEEN {{yearStart}} AND {{period}}) x
           JOIN (SELECT Account, MIN(Type) AS Type FROM dbo.CA GROUP BY Account) a ON a.Account = x.Account
           WHERE a.Type IN (8)
           GROUP BY x.WBS1) k ON k.WBS1 = g.WBS1
JOIN dbo.PR p ON p.WBS1 = COALESCE(g.WBS1, k.WBS1) AND p.WBS2 = '' AND p.WBS3 = ''
LEFT JOIN dbo.EMMain e ON e.Employee = p.Principal
LEFT JOIN (SELECT Code, MIN(Description) AS Description FROM dbo.CFGProjectTypeDescriptions GROUP BY Code) t ON t.Code = p.ProjectType
