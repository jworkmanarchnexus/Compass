SELECT p.WBS1 AS project,
       LTRIM(RTRIM(ISNULL(e.LastName, ''))) + ', ' + LTRIM(RTRIM(ISNULL(e.FirstName, ''))) AS pic,
       ISNULL(t.Description, p.ProjectType) AS sector,
       p.Name AS name,
       ISNULL(h.oct_v, 0) AS hr_oct, ISNULL(h.nov_v, 0) AS hr_nov, ISNULL(h.dec_v, 0) AS hr_dec,
       ISNULL(h.oct_h, 0) AS hours_oct, ISNULL(h.nov_h, 0) AS hours_nov, ISNULL(h.dec_h, 0) AS hours_dec,
       ISNULL(c.oct_b, 0) AS con_oct, ISNULL(c.nov_b, 0) AS con_nov, ISNULL(c.dec_b, 0) AS con_dec,
       ISNULL(x.oct_b, 0) AS exp_oct, ISNULL(x.nov_b, 0) AS exp_nov, ISNULL(x.dec_b, 0) AS exp_dec
FROM dbo.PR p
LEFT JOIN (SELECT k.WBS1,
                  SUM(CASE WHEN r.StartDate >= '20261001' AND r.StartDate < '20261101' THEN r.PeriodHrs * r.BillingRate ELSE 0 END) AS oct_v,
                  SUM(CASE WHEN r.StartDate >= '20261101' AND r.StartDate < '20261201' THEN r.PeriodHrs * r.BillingRate ELSE 0 END) AS nov_v,
                  SUM(CASE WHEN r.StartDate >= '20261201' AND r.StartDate < '20270101' THEN r.PeriodHrs * r.BillingRate ELSE 0 END) AS dec_v,
                  SUM(CASE WHEN r.StartDate >= '20261001' AND r.StartDate < '20261101' THEN r.PeriodHrs ELSE 0 END) AS oct_h,
                  SUM(CASE WHEN r.StartDate >= '20261101' AND r.StartDate < '20261201' THEN r.PeriodHrs ELSE 0 END) AS nov_h,
                  SUM(CASE WHEN r.StartDate >= '20261201' AND r.StartDate < '20270101' THEN r.PeriodHrs ELSE 0 END) AS dec_h
           FROM dbo.PNPlannedLabor r JOIN dbo.PNTask k ON k.PlanID = r.PlanID AND k.TaskID = r.TaskID GROUP BY k.WBS1) h ON h.WBS1 = p.WBS1
LEFT JOIN (SELECT k.WBS1,
                  SUM(CASE WHEN r.StartDate >= '20261001' AND r.StartDate < '20261101' THEN r.PeriodBill ELSE 0 END) AS oct_b,
                  SUM(CASE WHEN r.StartDate >= '20261101' AND r.StartDate < '20261201' THEN r.PeriodBill ELSE 0 END) AS nov_b,
                  SUM(CASE WHEN r.StartDate >= '20261201' AND r.StartDate < '20270101' THEN r.PeriodBill ELSE 0 END) AS dec_b
           FROM dbo.PNPlannedConsultant r JOIN dbo.PNTask k ON k.PlanID = r.PlanID AND k.TaskID = r.TaskID GROUP BY k.WBS1) c ON c.WBS1 = p.WBS1
LEFT JOIN (SELECT k.WBS1,
                  SUM(CASE WHEN r.StartDate >= '20261001' AND r.StartDate < '20261101' THEN r.PeriodBill ELSE 0 END) AS oct_b,
                  SUM(CASE WHEN r.StartDate >= '20261101' AND r.StartDate < '20261201' THEN r.PeriodBill ELSE 0 END) AS nov_b,
                  SUM(CASE WHEN r.StartDate >= '20261201' AND r.StartDate < '20270101' THEN r.PeriodBill ELSE 0 END) AS dec_b
           FROM dbo.PNPlannedExpenses r JOIN dbo.PNTask k ON k.PlanID = r.PlanID AND k.TaskID = r.TaskID GROUP BY k.WBS1) x ON x.WBS1 = p.WBS1
LEFT JOIN dbo.EMMain e ON e.Employee = p.Principal
LEFT JOIN (SELECT Code, MIN(Description) AS Description FROM dbo.CFGProjectTypeDescriptions GROUP BY Code) t ON t.Code = p.ProjectType
WHERE p.WBS2 = '' AND p.WBS3 = '' AND p.Status = 'A' AND p.WBS1 NOT LIKE '[A-Za-z]%'
