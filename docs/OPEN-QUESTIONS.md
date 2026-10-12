# Open questions

Everything still undecided, in one place. "Default" is what the prototype does today; most defaults are settings, so a different answer does not need a rebuild. **H** = from the handoff (`reference/handoff/docs/04-open-questions.md`, same numbers); **T** = raised while building.

Who decides: **Josh** (how it should behave), **Kent** (hosting and the firm's systems).

## For Kent

| # | Question | Default today | Notes |
|---|---|---|---|
| H1 | Language, database (PostgreSQL or SQL Server), hosting, where the jobs run, sign-in provider | Node + SQLite, one process, 127.0.0.1 only | `docs/FOR-KENT.md` lists exactly what to replace and what to keep |
| H7 | Which sign-in attribute is the user key, and does Vantagepoint carry it? Who maps a PIC's Vantagepoint employee code to a person? | the mapping is `users.employee_code`, set from a seed file | **Gap:** the People page cannot edit the code yet; Home flags a PIC with no login |
| H9 | How does the one daily email send (SMTP relay, Graph, company mail)? Does a `mailto:` open Outlook on the firm's setup, or does it need an Outlook web link? | writes a text file to `outbox/`; `mailto:` links | one method to implement: `sendToAdmin` |
| H3 | Where do BD revenue, forecast and MWIP/pursuit data live (Vantagepoint, a CRM, a spreadsheet)? | nothing built | blocks the BD report and Pipeline watch |
| T1 | Project number format (the mockup uses `2024-0207`) and the Vantagepoint project key | the mockup's | affects nothing in the logic; it is text |
| T2 | Time zone for "today" and entry dates | the server's local time | all rules work on plain dates |
| T3 | Public holidays for "first business day" | first weekday | one function (`schedule.js`) |
| T4 | Can the pull serve the past 12 month-ends (the SQL once per month)? | the local files hold history | each run stores its own chart history |
| H11 | Data retention for plan logs and archived runs | forever | |

## For Josh

| # | Question | Default today | Where it lives |
|---|---|---|---|
| H2 | Does the Marketing director see Project Turnaround? | no (BD and Pipeline only) | Admin > People > "What narrower roles can see" |
| T5 | May PICs see the BD report and Pipeline watch? Does Finance see Turnaround? | PICs: no. Finance: yes | same card (`access`) |
| H4 | Is the MWIP backlog column stored raw and weighted at calculation time, or already weighted? | n/a | blocks the BD report |
| H5 | Where do utilization and net profit come from? | tiles not shown | Home's Firm snapshot |
| H6 | Are earlier months' runs imported from the Excel workbook, or does history start at go-live? | the first run's "since last month" is blank | |
| H8 | Fallback for projects with several overhead rates? | reported as a warning, no profit invented | `profit.js` |
| H10 | Final product name and a vector logo | "Compass"; small raster logo | |
| H12 | Anything from the earlier ChatGPT engine? | nothing adopted | `reference/handoff/reference/chatgpt-engine-v0.1/` |
| T6 | Recorded as Missed after how many days past a commitment's date? | 14 | Admin > Project Turnaround > Plan due dates. The mockup's examples disagree (2 days, and 11 days still "past due") |
| T7 | What makes a plan's next update due? | the earlier of last entry + 30 days and the next commitment date | `plan.js`; the mockup's rows disagree |
| T8 | A PIC with one missed commitment: Escalated? | no: a measure needs 3 items first | Admin > Reminders and standing |
| T9 | Drafts: one per PIC per situation (listing their projects), or one per project? | one per PIC per situation | `drafts.js` |
| T10 | No-plan reminders: the mockup shows them 6 days after a project is listed; the ladder (counted from the 14-day due date) gives about 17 | the ladder | Admin: "days to a first plan", ladder days |
| T11 | May the Admin rebuild a draft run without typing RERUN? | yes (nobody else has seen a draft) | `runs.js` |
| T12 | "Ignore projects billed under $X": YTD billed? | yes | `selection.js` |
| T13 | A PIC's Home shows their own projects needing action (not in the spec) | yes | `home.js` |
| T14 | After posting, should a PIC be able to see their own commitment's action and amount? | no (never shown to any PIC) | the spec says not shown to PICs; the author is included |
| T15 | The ladder's last step, "Repeat next monthly run", and the monthly summary email | not built | |
| T16 | Should the Admin be able to see plan content for a project that is not on any run? | yes (any project by link) | |
| T18 | A project that was explained last year and lands on the list again: a new explanation each calendar year? | yes (the plan cycle is the year) | `plan.js` / `server/plan.js` |
| T17 | Export Excel on the Turnaround page; contract fee and billed-to-date on the plan page | not built (no fee data in the validated SQL) | |
