# Pipeline watch (built)

Weekly snapshots of **MWIP** (pursuits not yet contracted, through Dec 31) and **Forecast** (contracted, still to be billed through Dec 31), by PIC, with what changed since last week and a short list of things that need a look. The rules are `modules/pipeline/logic/watch.js`, tested from `modules/pipeline/tests/fixtures/watch.json`. The server is `server/pipeline.js`; the screen is `modules/pipeline/ui/page.js`.

## 1. Who sees what

| Person | Sees |
|---|---|
| Admin | Everything; clears alerts, adds notes, edits the rules, takes a snapshot by hand |
| Finance, Marketing director | The page, view only |
| PICs | Nothing by default. When the Admin turns on `access.picPipeline` they see **every PIC** ("PICs view all PICs"), never notes, and they cannot clear anything |
| System admin | No page; reads the Admin tab |

The menu badge (Admin only) counts **Alerts** that nobody has cleared at the latest snapshot. **Watch** items never count.

## 2. The snapshot

Taken Monday morning (the plan is 5:00 a.m.; the schedule is Kent's). `npm run pipeline-snapshot` saves the pipeline as it stands, stamps it with that week's Monday, runs the alert rules, and emails the Admin only when an Alert needs a look (a count and a link, no names). Running it twice for the same Monday changes nothing. Snapshots are kept forever and can never be changed or deleted (database triggers); the page shows the last 8, and the picker reaches any older one.

A **pursuit** is tracked from the day it first appears. Its id is its project number: when it is promoted to a project it keeps the number.

## 3. The page

Two tabs, **MWIP, not yet contracted** and **Forecast, contracted**. For each PIC (and the firm): the last 8 weekly values, **this week** (change since the previous snapshot), **vs 4 weeks ago**, **new pursuits (30d)** (MWIP) or **moved to next year** (Forecast), and **new contracts (30d)**. Clicking a PIC opens the detail below: each pursuit (or contract) with its stage, last snapshot, this snapshot, change and **what happened**.

- A pursuit that left MWIP **with a project** that has its number is *Converted* ("Matched, not a loss"). One that left **with no such project** is *Removed*, with a red note: either it was lost, or it converted and nobody opened the job.
- The first snapshot's pursuits and contracts are not "new"; only ones that first appear after it are.
- **This week** panel: alerts and watch items (the Admin can **Clear** an alert once seen), and conversions marked Matched. **Firm total by week**: a line chart of the last 8 snapshots.
- **Export CSV** saves the table on screen as a file that opens in Excel.

## 4. Alert rules (Admin > Pipeline alerts)

Each rule is **Alert**, **Watch** or **Off**, with its thresholds (all settings, effective-dated):

| Rule | Default | Fires when |
|---|---|---|
| MWIP drops fast | Alert, $75,000 in 7 days | a PIC's MWIP total falls by at least that much; the message adds the slide and the pursuit that left |
| Forecast drops fast | Alert, $150,000 in 7 days | a PIC's forecast total falls by at least that much; the message names the contract moved into next year |
| MWIP slides | Alert, 8 snapshots in a row | a PIC's MWIP falls every week for that long (not raised when the drop rule already fired for them) |
| Pursuit left, no project | Watch, 3 days | a pursuit is gone from MWIP and no project has its number |
| Won, no project yet | Alert, 14 days | a pursuit has been marked Won that long with no project number |
| Win probability falls | Watch, 20 points | in one week |
| No new pursuits | Watch, 30 days | a PIC has added none in that time |

Alerts are about the numbers, not the person. Past alerts are never re-judged when a rule changes. The system never emails a PIC.

## 5. Not built

- Export to an actual .xlsx file (CSV opens in Excel).
- The spec's "PIC copy" of the alert email: it conflicts with the rule that the system never emails a PIC, so there is no switch for it.
- Re-running the rules on an old snapshot after a threshold changes.
- Alerts on firm totals (the rules run per PIC).
