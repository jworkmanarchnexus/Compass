SELECT g.WBS1 AS project,
       LTRIM(RTRIM(ISNULL(e.LastName, ''))) + ', ' + LTRIM(RTRIM(ISNULL(e.FirstName, ''))) AS pic,
       ISNULL(t.Description, p.ProjectType) AS sector,
       g.gross AS gross,
       p.Fee AS fee,
       p.ConsultFee AS consult_fee,
       p.ReimbAllow AS reimb_allow,
       p.TotalContractValue AS total_contract_value
FROM (SELECT WBS1, -SUM(Amount) AS gross
      FROM dbo.LedgerAR
      WHERE TransType = 'IN' AND Period BETWEEN {{yearStart}} AND {{period}}
      GROUP BY WBS1) g
JOIN dbo.PR p ON p.WBS1 = g.WBS1 AND p.WBS2 = '' AND p.WBS3 = ''
LEFT JOIN dbo.EMMain e ON e.Employee = p.Principal
LEFT JOIN (SELECT Code, MIN(Description) AS Description FROM dbo.CFGProjectTypeDescriptions GROUP BY Code) t ON t.Code = p.ProjectType
