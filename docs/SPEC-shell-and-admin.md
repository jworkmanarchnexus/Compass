# Spec: shell, roles, Admin and Home

The parts of Compass that are not a report: signing in, roles, the side bar, the Admin pages, the audit log, and Home. Rules are pinned by `shared/rules/tests/fixtures/*.json` and by `server/tests/api.test.js`, `home.test.js` and `settings-effect.test.js`.

## 1. Signing in

- **Production:** the firm's network (Windows domain) username and password. Which attribute is the user key, and whether Vantagepoint employees carry it, is open (`docs/OPEN-QUESTIONS.md`).
- **Local prototype:** a "sign in as" picker of the made-up people (`/api/dev/users`), and the browser sends `X-Compass-User: <user id>`. This has **no security value** and must not be exposed beyond 127.0.0.1. No real authentication code exists, on purpose.
- A person's **role** comes from Compass's own People table, set by the Admin. A user who is inactive cannot use the app, but keeps their history.

## 2. Roles and what each may open

Pure rule, `shared/rules/roles.js`. The server enforces it on every call; the browser only hides controls.

| Role | Opens |
|---|---|
| Admin | everything |
| PIC | Home, Project Turnaround (read all; write own projects) |
| Finance, view only | Home, Project Turnaround, BD report, Pipeline watch |
| Marketing director, view only | Home, BD report, Pipeline watch; Project Turnaround only if the Admin turns it on |
| System admin | Home (data checks, next runs), Admin: every tab except Commitment patterns, **read-only**; never a run's contents or a plan |

Three of these are **assumptions** the spec left open, each a setting (`access`): Finance sees Turnaround, BD and Pipeline; PICs see Turnaround only (BD and Pipeline are off for them until decided); Marketing does not see Turnaround. The last active Admin can never be demoted or deactivated.

## 3. Admin

Tabs, in order: Project Turnaround, Reminders and standing, BD reports, Pipeline alerts, People, Report runs, Commitment patterns, Audit log. BD reports and Pipeline alerts arrive with those modules.

- **Settings cards** (Project Turnaround, Reminders and standing, and the access card on People): every setting is stored as an effective-dated row; saving adds a row and never overwrites. Only changed values are saved, validated on the server (type, range, and rules that span settings: the reminder ladder must be in order, Escalated cutoffs not above Good). "Changes apply to the next run. Published runs never change."
- **People:** name, login, role, the name used in drafts, status (Active/Inactive, reversible), and the count of active projects the person leads in Vantagepoint.
- **Report runs:** the list of runs (everyone with Admin access) and, for the Admin, build / review / publish / rebuild / archive and rerun (`docs/SPEC-turnaround.md` section 3).
- **Commitment patterns:** this year's commitments by lever (count, open, kept, not kept, amounts promised and actual). The only place a lever and its number are shown in aggregate.
- **Audit log:** newest first. Records: setting changes (old and new value), role/status/draft-name changes, run build, rebuild, publish and archive (with the reason), check-in sent, dismissed and undone, daily checks run. Entries cannot be changed or removed (a database rule). The scheduled jobs write as "Scheduled job".

## 4. Home

Everything is shaped by role on the server (`server/home.js`) and shows only what exists.

| Section | Who | Content |
|---|---|---|
| Needs your attention | Admin | a draft run to review (hidden if `run.showOnHome` is off); check-in drafts waiting (counts of overdue updates and no-plan projects); projects 21+ days past due as conversations |
| Your projects | PIC | their projects on the last published run, worst plan status first, each with a link to its plan |
| Recently published | Admin, PIC, Finance, Marketing if allowed | the last five published runs; the Admin also sees who can see them |
| Data checks | Admin, System admin | monthly run built for the last closed month; active projects with no PIC; active projects whose PIC has no Compass login; projects the run could not evaluate; daily checks ran within 2 days |
| Next scheduled runs | Admin, System admin | the monthly run (next first business day) and the daily checks |

Not on Home yet, because the data does not exist: pipeline alerts, the BD report, the weekly snapshot, "$ unassigned to a market", and the Firm snapshot tiles (YTD billed against pace, utilization, net profit, projected revenue; their sources are open question 5).

## 5. The side bar and look

Matches the Toolbox (`design-system/`, copied; tokens and shared classes only, no hex colors in Compass CSS). Home; Project Turnaround with a Check-in drafts child and a count badge (Admin); BD report and Pipeline watch (placeholders); Admin. Each person sees only what their role opens. A "Sample data" tag marks the prototype. Theme (auto, light, dark) and density are per device.

## 6. Jobs

| Command | When | What |
|---|---|---|
| `npm run run-month` (add `--scheduled` for a daily trigger that acts only on the first business day) | monthly | build the draft for the last closed month; email the Admin a count and link |
| `npm run daily` | daily | record missed commitments; prepare and withdraw check-in drafts; email the Admin (weekdays, if any waiting, once) |

Both are safe to run twice. Neither publishes anything. Neither contacts a PIC.
