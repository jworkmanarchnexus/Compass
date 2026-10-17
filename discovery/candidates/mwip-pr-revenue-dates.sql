SELECT p.WBS1 AS project,
       LTRIM(RTRIM(ISNULL(e.LastName, ''))) + ', ' + LTRIM(RTRIM(ISNULL(e.FirstName, ''))) AS pic,
       ISNULL(t.Description, p.ProjectType) AS sector,
       ISNULL(p.Revenue, 0) AS revenue,
       ISNULL(p.WeightedRevenue, 0) AS weighted,
       p.Status AS status,
       p.Stage AS stage,
       p.Probability AS probability,
       CONVERT(varchar(10), p.EstStartDate, 120) AS est_start,
       CONVERT(varchar(10), p.EstCompletionDate, 120) AS est_completion,
       CONVERT(varchar(10), p.EstEndDate, 120) AS est_end,
       CONVERT(varchar(10), p.StartDate, 120) AS start_date,
       CONVERT(varchar(10), p.EndDate, 120) AS end_date
FROM dbo.PR p
LEFT JOIN dbo.EMMain e ON e.Employee = p.Principal
LEFT JOIN (SELECT Code, MIN(Description) AS Description FROM dbo.CFGProjectTypeDescriptions GROUP BY Code) t ON t.Code = p.ProjectType
WHERE p.WBS2 = '' AND p.WBS3 = '' AND p.WBS1 LIKE '[A-Za-z]%' AND p.Status = 'A' AND p.Probability > 0 AND p.Probability < 100
