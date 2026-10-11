-- compass_negative_projects.sql
-- Monthly Project Turnaround pull. Read-only against Vantagepoint.
-- @RunPeriod: the month being reported, YYYYMM (job passes the last CLOSED period).
-- YTD always starts in January of the same year. Nothing is carried across years.
DECLARE @RunPeriod INT = 202608;                       -- job supplies this
DECLARE @YearStart INT = (@RunPeriod / 100) * 100 + 1; -- e.g. 202601


WITH Projects AS (
    SELECT
        P.WBS1,
        P.Name,
        P.Principal,
        P.ProjMgr,
        P.Status,

        LTRIM(RTRIM(
            ISNULL(PIC.FirstName, '') + ' ' + ISNULL(PIC.LastName, '')
        )) PICName,

        LTRIM(RTRIM(
            ISNULL(PM.FirstName, '') + ' ' + ISNULL(PM.LastName, '')
        )) PMName

    FROM dbo.PR P

    LEFT JOIN dbo.EMMain PIC
        ON PIC.Employee = P.Principal

    LEFT JOIN dbo.EMMain PM
        ON PM.Employee = P.ProjMgr

    WHERE P.WBS2 = ''
      AND P.WBS3 = ''
      AND P.Status = 'A'
      AND P.ChargeType = 'R'
      AND P.WBS1 NOT LIKE 'Z%'
      AND P.WBS1 NOT LIKE 'J%'
),

Revenue AS (
    SELECT
        WBS1,

        -SUM(CASE WHEN Period = @RunPeriod
            THEN Amount ELSE 0 END) CurrentBilled,

        -SUM(CASE WHEN Period BETWEEN @YearStart AND @RunPeriod
            THEN Amount ELSE 0 END) YTDBilled,

        -SUM(Amount) JTDBilled

    FROM dbo.LedgerAR
    WHERE TransType = 'IN'
      AND Period <= @RunPeriod
    GROUP BY WBS1
),

Labor AS (
    SELECT
        WBS1,

        SUM(CASE WHEN Period = @RunPeriod
            THEN ISNULL(RegAmt, 0)
               + ISNULL(OvtAmt, 0)
               + ISNULL(SpecialOvtAmt, 0)
            ELSE 0 END) CurrentLabor,

        SUM(CASE WHEN Period BETWEEN @YearStart AND @RunPeriod
            THEN ISNULL(RegAmt, 0)
               + ISNULL(OvtAmt, 0)
               + ISNULL(SpecialOvtAmt, 0)
            ELSE 0 END) YTDLabor,

        SUM(
            ISNULL(RegAmt, 0)
          + ISNULL(OvtAmt, 0)
          + ISNULL(SpecialOvtAmt, 0)
        ) JTDLabor

    FROM dbo.LD
    WHERE Period <= @RunPeriod
    GROUP BY WBS1
),

AP AS (
    SELECT
        WBS1,

        SUM(CASE WHEN Period = @RunPeriod
            THEN Amount ELSE 0 END) CurrentAP,

        SUM(CASE WHEN Period BETWEEN @YearStart AND @RunPeriod
            THEN Amount ELSE 0 END) YTDAP,

        SUM(Amount) JTDAP

    FROM dbo.LedgerAP
    WHERE TransType = 'AP'
      AND ProjectCost = 'Y'
      AND Period <= @RunPeriod
    GROUP BY WBS1
),

JE AS (
    SELECT
        WBS1,

        SUM(CASE WHEN Period = @RunPeriod
            THEN Amount ELSE 0 END) CurrentJE,

        SUM(CASE WHEN Period BETWEEN @YearStart AND @RunPeriod
            THEN Amount ELSE 0 END) YTDJE,

        SUM(Amount) JTDJE

    FROM dbo.LedgerMisc
    WHERE TransType = 'JE'
      AND ProjectCost = 'Y'
      AND Period <= @RunPeriod
    GROUP BY WBS1
),

EX AS (
    SELECT
        WBS1,

        SUM(CASE WHEN Period = @RunPeriod
            THEN Amount ELSE 0 END) CurrentEX,

        SUM(CASE WHEN Period BETWEEN @YearStart AND @RunPeriod
            THEN Amount ELSE 0 END) YTDEX,

        SUM(Amount) JTDEX

    FROM dbo.LedgerEX
    WHERE TransType = 'EX'
      AND ProjectCost = 'Y'
      AND Period <= @RunPeriod
    GROUP BY WBS1
),

Overhead AS (
    SELECT
        WBS1,
        MIN(OverheadPct) MinOH,
        MAX(OverheadPct) MaxOH
    FROM dbo.RPPlan
    GROUP BY WBS1
),

Totals AS (
    SELECT
        P.WBS1,
        P.Name,
        P.Principal,
        P.ProjMgr,
        P.PICName,
        P.PMName,
        P.Status,

        O.MinOH,
        O.MaxOH,

        ISNULL(R.CurrentBilled, 0) CurrentBilled,
        ISNULL(R.YTDBilled, 0) YTDBilled,
        ISNULL(R.JTDBilled, 0) JTDBilled,

        ISNULL(L.CurrentLabor, 0) CurrentLabor,
        ISNULL(L.YTDLabor, 0) YTDLabor,
        ISNULL(L.JTDLabor, 0) JTDLabor,

        ISNULL(A.CurrentAP, 0)
          + ISNULL(J.CurrentJE, 0)
          + ISNULL(E.CurrentEX, 0) CurrentExpenses,

        ISNULL(A.YTDAP, 0)
          + ISNULL(J.YTDJE, 0)
          + ISNULL(E.YTDEX, 0) YTDExpenses,

        ISNULL(A.JTDAP, 0)
          + ISNULL(J.JTDJE, 0)
          + ISNULL(E.JTDEX, 0) JTDExpenses

    FROM Projects P

    LEFT JOIN Revenue R
        ON P.WBS1 = R.WBS1

    LEFT JOIN Labor L
        ON P.WBS1 = L.WBS1

    LEFT JOIN AP A
        ON P.WBS1 = A.WBS1

    LEFT JOIN JE J
        ON P.WBS1 = J.WBS1

    LEFT JOIN EX E
        ON P.WBS1 = E.WBS1

    LEFT JOIN Overhead O
        ON P.WBS1 = O.WBS1
),

Profit AS (
    SELECT
        WBS1,
        Name,
        Principal,
        ProjMgr,
        PICName,
        PMName,
        Status,
        MinOH,
        MaxOH,

        CurrentBilled,
        CurrentBilled
          - CurrentLabor * (1 + MinOH / 100.0)
          - CurrentExpenses CurrentProfit,

        YTDBilled,
        YTDBilled
          - YTDLabor * (1 + MinOH / 100.0)
          - YTDExpenses YTDProfit,

        JTDBilled,
        JTDBilled
          - JTDLabor * (1 + MinOH / 100.0)
          - JTDExpenses JTDProfit

    FROM Totals
)

SELECT * INTO #Profit FROM Profit;

-- RESULT SET 1: negative YTD projects (feeds the draft run)
SELECT
    PICName PIC,
    PMName PM,
    WBS1 + ' - ' + Name Project,

    CurrentBilled [Current Billed],
    CurrentProfit [Current Profit],

    CASE
        WHEN CurrentBilled <> 0
        THEN 100.0 * CurrentProfit / CurrentBilled
        ELSE NULL
    END [Current %],

    YTDBilled [YTD Billed],
    YTDProfit [YTD Profit],

    CASE
        WHEN YTDBilled <> 0
        THEN 100.0 * YTDProfit / YTDBilled
        ELSE NULL
    END [YTD %],

    JTDBilled [JTD Billed],
    JTDProfit [JTD Profit],

    CASE
        WHEN JTDBilled <> 0
        THEN 100.0 * JTDProfit / JTDBilled
        ELSE NULL
    END [JTD %],

    Status

FROM #Profit

WHERE MinOH = MaxOH
  AND MinOH IS NOT NULL
  AND YTDProfit < 0

ORDER BY
    Principal,
    YTDProfit,
    WBS1;

-- RESULT SET 2: projects the job could NOT evaluate (show as a warning on the draft)
-- Reason: no overhead plan row, or more than one overhead rate on the project.
SELECT WBS1 + ' - ' + Name Project, PICName PIC, PMName PM,
       YTDBilled [YTD Billed],
       CASE WHEN MinOH IS NULL THEN 'No overhead plan'
            ELSE 'Mixed overhead rates' END Reason
FROM #Profit
WHERE MinOH IS NULL OR MinOH <> MaxOH
ORDER BY YTDBilled DESC;

-- RESULT SET 3: active projects with no PIC (feeds the "no PIC" warning)
SELECT WBS1 + ' - ' + Name Project, PMName PM, YTDBilled [YTD Billed], YTDProfit [YTD Profit]
FROM #Profit
WHERE PICName = '' OR PICName IS NULL
ORDER BY YTDBilled DESC;

DROP TABLE #Profit;
