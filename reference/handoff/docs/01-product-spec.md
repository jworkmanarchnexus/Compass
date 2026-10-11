# Product spec

Sample data throughout the mockup is invented. Numbers below that define **rules** are real decisions.

## Roles
| Role | Can |
|---|---|
| Admin (Josh) | Runs and publishes reports, edits all settings, adds Admin notes, sees the check-in queue and audit trail. Cannot write in a PIC's voice. |
| PIC | Writes entries on projects they lead. Reads every other PIC's plans and numbers. Sees only the last published run. |
| Finance (view only) | Reads what they've been given. |
| Marketing director (view only) | Sees BD and Pipeline. **Mockup Admin text also says Turnaround; see open questions.** |
| System admin (Kent) | Keeps site running; reads data checks and audit log. No access to PIC content decisions. |

Sign-in is company SSO. Role comes from the People table in Admin.

## Shell
Left sidebar: Home, Project Turnaround (with child "Check-in drafts" + count badge), BD report, Pipeline watch (alert badge), Admin. Breadcrumb, page header, "Sample data" tag (remove in production), user at bottom.

## Home
- **Needs your attention** (Admin only): Turnaround draft ready to review; check-in drafts waiting; pipeline alerts crossing thresholds.
- **Recently published** (BD, Turnaround runs). **Snapshot** (weekly MWIP/forecast).
- **Data checks:** Vantagepoint pull status; active projects with no PIC; revenue with no market sector.
- **Next scheduled runs:** weekly snapshot (Mon 5:00 a.m.), Turnaround (first business day, 6:00 a.m.), BD (first business day).
- **Firm snapshot:** YTD billed and % of pace; utilization YTD vs target; net profit % of YTD billed; projected architectural revenue % of goal. (Utilization and net profit sources are not defined yet; see open questions.)

## Project Turnaround
Monthly. Lists active projects with **negative YTD profit**, grouped by PIC.

**Run lifecycle:** scheduled job creates **Draft** → Josh reviews (numbers, warnings) → **Publish for viewing** → locked. PICs see the previous published run until then. If a number is wrong: Archive and rerun (reason + type `RERUN`); old run stays in the archive marked Archived.

**Josh's view:** KPI strip (total negative YTD profit and % of billed; plans current X of N; waiting on an update; check-in drafts ready; change since last month), chart of negative YTD profit by month (current vs last year, grey = last year), count of projects below break-even each month end, then a card per PIC (projects, profit YTD, %, plan status, latest update, next commitment, earlier commitments missed, on-time %, kept %).

**PIC view:** toggle "Just mine / Everyone". Own KPIs: your negative YTD profit, plans current, need action, your record (e.g. 79% on time: 11 of 14 updates on time, 5 of 7 commitments kept).

**Plan status** (per project): `Current` | `Update due` (due within 14 days) | `Overdue` | `No plan`. "Plan current" = has an open commitment, an entry in the last 30 days, and nothing past due.
Due dates (Admin): a new turnaround project needs a plan within **14** days of first appearing; after any entry the next update is due in **30** days (every update, explanation or commitment resets the clock); January grace period, default Feb 1.

**Standing label** per PIC: `Good standing` needs ≥ X% updates on time AND ≥ Y% commitments kept; `Escalated` below Z% on either; between = `Needs attention`. Cutoffs are Admin settings.

### Plan page (per project)
Header: project, PM, YTD profit. Who sees this: PIC adds entries; other PICs read; Admin reads + adds Admin notes; Marketing director reads.
**Add to the log** entry types: `Explanation`, `Commitment`, `Update`, `Correction`.
- Commitment: "Promised by" date + **one lever** + **one number** ("your best estimate is fine"). Levers:
  - *Bring in money:* Request additional services fee · Submit a change order · Renegotiate the fee · Speed up billing or collection
  - *Spend less:* Reduce staffing hours · Move work to lower-cost staff · Reduce consultant cost · Shorten the schedule
  Number meaning differs per lever (dollars vs hours); the mockup has the labels (`LEV` map in `source-pages/TurnaroundPlan.dc.html`).
- Commitment states: open → **Done** (asks actual result) | **Date revised** (reason required; earlier dates stay) | **Missed** (recorded by the system when the date passes with no update).
- Correction: pick the entry being corrected; original stays with a note.
- Entries are timestamped, locked, shown newest first. Admin notes are visibly labeled and public. Posting a PIC entry sends Josh no email; he sees it at next review.

### Check-in drafts (Admin only)
Queue of drafted messages, one per PIC per situation (overdue commitment, missing plan). Each: To, Subject, Message (editable), `Open in Outlook`, `Mark as sent`, `Dismiss`. Sent items show "If still open in 7 days, one follow-up draft appears." Dismissed doesn't return for that commitment. Both have Undo.
**Reminder ladder** (days counted from update due date, all Admin settings): Overdue flag on due date (automatic, shown everywhere) → Reminder 1 (draft, casual, one per PIC) → Reminder 2 (draft, more direct; Josh gets one email) → Escalate (listed in monthly summary; task for Josh to talk in person) → Repeat next monthly run (marked Repeat, listed first).
**Do not create a draft if:** PIC added an entry in the last 2 days, or was sent a reminder in the last 5 days. Draft tone: casual-short or direct. Josh email: weekdays 7:00 a.m., only if something is waiting.

## BD report
Monthly, versioned ("September 2026, version 1"), Draft → Published, locked; same archive/rerun rule. Billing cutoff = last day of previous month. Revenue is net of consultants. PDF export.
Two tabs: **By PIC**, **By market sector** (same columns). Columns: Revenue goal · YTD goal (pace) · YTD revenue · Revenue forecast · MWIP backlog · Total projected · % of pace billed · % of goal (YTD + forecast) · % of goal (YTD + forecast + MWIP) · Status. Firm total row first.
- **Pace** = annual goal × months elapsed ÷ 12 (e.g. 9/12 at September).
- **% of pace billed** = YTD revenue ÷ pace.
- **Status:** `On Track` if (YTD + forecast + MWIP) ÷ goal ≥ 100%; else `On Pace` if YTD ≥ 99% of pace; else `Behind Pace`. (Verified against mock rows.)
- **MWIP factor** (0.67, effective-dated in Admin) applies to MWIP backlog. Not shown on PIC pages. Confirm in open questions whether the stored column is raw or weighted.
- Two stacked-bar charts (by PIC, by sector; largest total first) with YTD, forecast, MWIP, pace line and goal line.
- Revenue with no market sector: setting "Stop and ask me before I publish". Labs rolls into Healthcare through 2026; Labs becomes its own sector Jan 1, 2027. 2027 goals set in January.
- Annual goals by PIC and sector are Admin data.

## Pipeline watch
Weekly snapshots (Mondays 5:00 a.m.), last 8 shown, older kept forever. **MWIP** (pursuits not yet contracted, through Dec 31) and **Forecast** (contracted, still to be billed through Dec 31) are separate tabs.
Per PIC: 8 weekly values, this week change, vs 4 weeks ago, new pursuits (30d) [MWIP] or Moved to 2027 [Forecast], new contracts (30d). Row click = pursuit-level detail: stage, last week, this week, change, what happened. Pursuits are tracked from the day they first appear.
**Match logic:** a pursuit leaving MWIP either *converted* to a project (match by project number → "Matched, not a loss") or *removed with no matching project* (flag: lost, or converted and nobody opened the job).
**This week panel:** alerts and watch items; alert email Mondays 7:30 a.m. to Josh after the snapshot (PIC copy off by default; "alerts are about the numbers, not the person").
**Alert rules** (Admin; Alert = counts toward menu badge, Watch = shown only): MWIP drops fast (amount in N days) · Forecast drops fast · MWIP slides week after week (N weeks in a row) · Pursuit removed with no matching project (Watch, after N days) · Conversion not matched (after N days) · Win probability falls (N points in a week) · No new pursuits in N days (Watch).
Firm total line chart over the last 8 snapshots. Export Excel.

## Admin tabs
Project Turnaround · Reminders and standing · BD reports · Pipeline alerts · People · Report runs · Commitment patterns · Audit log.
- *Project Turnaround:* monthly run day/time, notifications, project inclusion rules (status = Active only; YTD profit below $X; ignore projects billed under $X; projects with no PIC: leave out and warn, or group as "Unassigned"), plan due dates.
- *Reminders and standing:* ladder, drafts and notifications, do-not-draft rules, standing thresholds, who sees PIC records (everyone signed in / Admin and principals only / Admin only).
- *BD reports:* MWIP factor table (effective-dated), annual goals, sectors, report rules, status labels.
- *Pipeline alerts:* rules above, snapshot and delivery.
- *People:* name, login, role, name used in drafts, status, turnaround project count. Inactive users keep history.
- *Report runs:* every run, status, version, created, published, by.
- *Commitment patterns:* admin-only per-lever rollups (this is where lever/number are visible).
- *Audit log:* every publish, rerun, setting change, role change.
Every settings card: "Changes apply to the next run. Published runs never change." with Discard / Save changes.
