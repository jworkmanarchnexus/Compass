SELECT p.WBS1 AS project,
       LTRIM(RTRIM(ISNULL(e.LastName, ''))) + ', ' + LTRIM(RTRIM(ISNULL(e.FirstName, ''))) AS pic,
       ISNULL(t.Description, p.ProjectType) AS sector,
       ISNULL(p.Fee, 0) AS pr_fee,
       ISNULL(p.ConsultFee, 0) AS pr_consult,
       ISNULL(p.Fee, 0) + ISNULL(p.ConsultFee, 0) AS pr_fee_consult,
       ISNULL(p.Fee, 0) + ISNULL(p.ConsultFee, 0) + ISNULL(p.ReimbAllow, 0) AS pr_total,
       ISNULL(k.comp_all, 0) + ISNULL(k.cons_all, 0) AS task_all,
       ISNULL(k.comp_parent, 0) + ISNULL(k.cons_parent, 0) AS task_parent_level,
       ISNULL(k.comp_child, 0) + ISNULL(k.cons_child, 0) AS task_phase_level,
       ISNULL(k.comp_all, 0) AS task_compensation_all,
       ISNULL(pl.comp, 0) + ISNULL(pl.cons, 0) AS plan_level
FROM dbo.PR p
LEFT JOIN (SELECT WBS1,
                  SUM(CompensationFee) AS comp_all, SUM(ConsultantFee) AS cons_all,
                  SUM(CASE WHEN WBS2 = '' THEN CompensationFee ELSE 0 END) AS comp_parent,
                  SUM(CASE WHEN WBS2 = '' THEN ConsultantFee ELSE 0 END) AS cons_parent,
                  SUM(CASE WHEN WBS2 <> '' THEN CompensationFee ELSE 0 END) AS comp_child,
                  SUM(CASE WHEN WBS2 <> '' THEN ConsultantFee ELSE 0 END) AS cons_child
           FROM dbo.PNTask GROUP BY WBS1) k ON k.WBS1 = p.WBS1
LEFT JOIN (SELECT WBS1, SUM(CompensationFee) AS comp, SUM(ConsultantFee) AS cons FROM dbo.PNPlan GROUP BY WBS1) pl ON pl.WBS1 = p.WBS1
LEFT JOIN dbo.EMMain e ON e.Employee = p.Principal
LEFT JOIN (SELECT Code, MIN(Description) AS Description FROM dbo.CFGProjectTypeDescriptions GROUP BY Code) t ON t.Code = p.ProjectType
WHERE p.WBS2 = '' AND p.WBS3 = '' AND p.WBS1 LIKE '[A-Za-z]%'
