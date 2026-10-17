SELECT k.WBS1 AS project,
       LTRIM(RTRIM(ISNULL(e.LastName, ''))) + ', ' + LTRIM(RTRIM(ISNULL(e.FirstName, ''))) AS pic,
       ISNULL(t.Description, p.ProjectType) AS sector,
       k.TaskID AS task_id,
       ISNULL(k.WBS2, '') AS wbs2,
       ISNULL(k.WBS3, '') AS wbs3,
       k.WBSType AS wbs_type,
       k.OutlineLevel AS outline_level,
       k.ChildrenCount AS children_count,
       CONVERT(varchar(10), k.RevenueStartDate, 120) AS rev_start,
       CONVERT(varchar(10), k.RevenueEndDate, 120) AS rev_end,
       ISNULL(k.CompensationFee, 0) AS comp_fee,
       ISNULL(k.ConsultantFee, 0) AS cons_fee,
       ISNULL(k.PctComplete, 0) AS pct_complete,
       ISNULL(k.JTDLabBill, 0) AS jtd_lab_bill,
       ISNULL(k.JTDConBill, 0) AS jtd_con_bill,
       ISNULL(k.JTDExpBill, 0) AS jtd_exp_bill,
       ISNULL(p.Fee, 0) AS pr_fee,
       ISNULL(p.ConsultFee, 0) AS pr_consult,
       ISNULL(p.ReimbAllow, 0) AS pr_reimb,
       ISNULL(p.Revenue, 0) AS pr_revenue,
       ISNULL(b.billed, 0) AS billed_jtd
FROM dbo.PNTask k
JOIN dbo.PR p ON p.WBS1 = k.WBS1 AND p.WBS2 = '' AND p.WBS3 = ''
LEFT JOIN (SELECT WBS1, -SUM(Amount) AS billed FROM dbo.LedgerAR
           WHERE TransType = 'IN' AND ISNULL(SubType, '') <> 'R' GROUP BY WBS1) b ON b.WBS1 = k.WBS1
LEFT JOIN dbo.EMMain e ON e.Employee = p.Principal
LEFT JOIN (SELECT Code, MIN(Description) AS Description FROM dbo.CFGProjectTypeDescriptions GROUP BY Code) t ON t.Code = p.ProjectType
WHERE p.Status = 'A' AND p.WBS1 NOT LIKE '[A-Za-z]%'
