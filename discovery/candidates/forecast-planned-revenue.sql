SELECT p.WBS1 AS project,
       LTRIM(RTRIM(ISNULL(e.LastName, ''))) + ', ' + LTRIM(RTRIM(ISNULL(e.FirstName, ''))) AS pic,
       ISNULL(t.Description, p.ProjectType) AS sector,
       p.Name AS name,
       ISNULL(p.Fee, 0) AS pr_fee, ISNULL(p.ConsultFee, 0) AS pr_consult, ISNULL(p.ReimbAllow, 0) AS pr_reimb,
       ISNULL(rl.oct_b, 0) AS rl_oct, ISNULL(rl.nov_b, 0) AS rl_nov, ISNULL(rl.dec_b, 0) AS rl_dec,
       ISNULL(pl.oct_b, 0) AS lab_oct, ISNULL(pl.nov_b, 0) AS lab_nov, ISNULL(pl.dec_b, 0) AS lab_dec,
       ISNULL(pc.oct_b, 0) AS con_oct, ISNULL(pc.nov_b, 0) AS con_nov, ISNULL(pc.dec_b, 0) AS con_dec,
       ISNULL(px.oct_b, 0) AS exp_oct, ISNULL(px.nov_b, 0) AS exp_nov, ISNULL(px.dec_b, 0) AS exp_dec
FROM dbo.PR p
LEFT JOIN (SELECT k.WBS1,
                  SUM(CASE WHEN r.StartDate >= '20261001' AND r.StartDate < '20261101' THEN r.PeriodBill ELSE 0 END) AS oct_b,
                  SUM(CASE WHEN r.StartDate >= '20261101' AND r.StartDate < '20261201' THEN r.PeriodBill ELSE 0 END) AS nov_b,
                  SUM(CASE WHEN r.StartDate >= '20261201' AND r.StartDate < '20270101' THEN r.PeriodBill ELSE 0 END) AS dec_b
           FROM dbo.PNPlannedRevenueLabor r JOIN dbo.PNTask k ON k.PlanID = r.PlanID AND k.TaskID = r.TaskID GROUP BY k.WBS1) rl ON rl.WBS1 = p.WBS1
LEFT JOIN (SELECT k.WBS1,
                  SUM(CASE WHEN r.StartDate >= '20261001' AND r.StartDate < '20261101' THEN r.PeriodBill ELSE 0 END) AS oct_b,
                  SUM(CASE WHEN r.StartDate >= '20261101' AND r.StartDate < '20261201' THEN r.PeriodBill ELSE 0 END) AS nov_b,
                  SUM(CASE WHEN r.StartDate >= '20261201' AND r.StartDate < '20270101' THEN r.PeriodBill ELSE 0 END) AS dec_b
           FROM dbo.PNPlannedLabor r JOIN dbo.PNTask k ON k.PlanID = r.PlanID AND k.TaskID = r.TaskID GROUP BY k.WBS1) pl ON pl.WBS1 = p.WBS1
LEFT JOIN (SELECT k.WBS1,
                  SUM(CASE WHEN r.StartDate >= '20261001' AND r.StartDate < '20261101' THEN r.PeriodBill ELSE 0 END) AS oct_b,
                  SUM(CASE WHEN r.StartDate >= '20261101' AND r.StartDate < '20261201' THEN r.PeriodBill ELSE 0 END) AS nov_b,
                  SUM(CASE WHEN r.StartDate >= '20261201' AND r.StartDate < '20270101' THEN r.PeriodBill ELSE 0 END) AS dec_b
           FROM dbo.PNPlannedConsultant r JOIN dbo.PNTask k ON k.PlanID = r.PlanID AND k.TaskID = r.TaskID GROUP BY k.WBS1) pc ON pc.WBS1 = p.WBS1
LEFT JOIN (SELECT k.WBS1,
                  SUM(CASE WHEN r.StartDate >= '20261001' AND r.StartDate < '20261101' THEN r.PeriodBill ELSE 0 END) AS oct_b,
                  SUM(CASE WHEN r.StartDate >= '20261101' AND r.StartDate < '20261201' THEN r.PeriodBill ELSE 0 END) AS nov_b,
                  SUM(CASE WHEN r.StartDate >= '20261201' AND r.StartDate < '20270101' THEN r.PeriodBill ELSE 0 END) AS dec_b
           FROM dbo.PNPlannedExpenses r JOIN dbo.PNTask k ON k.PlanID = r.PlanID AND k.TaskID = r.TaskID GROUP BY k.WBS1) px ON px.WBS1 = p.WBS1
LEFT JOIN dbo.EMMain e ON e.Employee = p.Principal
LEFT JOIN (SELECT Code, MIN(Description) AS Description FROM dbo.CFGProjectTypeDescriptions GROUP BY Code) t ON t.Code = p.ProjectType
WHERE p.WBS2 = '' AND p.WBS3 = '' AND p.Status = 'A' AND p.WBS1 NOT LIKE '[A-Za-z]%'
