# Staffing projections (as built, 2026-11-27)

A mockup on made-up data: the people the revenue forecast needs each month, by role, against the people on staff today. Firm-wide (Josh, 2026-11-27; a neighborhood breakdown may come later). Rules: `modules/staffing/logic/staffing.js` (pure, tested from `modules/staffing/tests/fixtures/staffing.json`). Server: `server/staffing.js`. Page: `modules/staffing/ui/page.js`. Admin: `modules/staffing/ui/admin.js`.

## 1. Who sees it

| Who | Page | Admin > Staffing |
|---|---|---|
| Admin | yes | edit |
| Principals (`pic`) | yes | no |
| Neighborhood leaders: people the Admin picks in Admin > Staffing (any role; a principal or associate who leads a neighborhood) | yes | no |
| System admin | no | view |
| Everyone else | no | no |

Everyone who opens the page sees all of it, including the role grid (Josh, 2026-11-27). `shared/rules/roles.js` (`canView`, and `canUse` for the leaders list). An inactive person never gets in through the list.

## 2. The calculation

For one month of revenue R (architectural: consultants taken out), with a staffing mix of each role's share of the **hours**:

- blended rate B = sum over roles of (mix % x role billing rate)
- hours = R / B
- hours in a role = hours x the role's mix %
- people in a role = hours in the role / (hours in a month x the role's utilization target)

Contracted work (the PMs' forecast) and pursuits (weighted by win probability) are kept apart throughout: stacked on the chart, and a switch on the role grid (With pursuits / Contracted work only).

- **Role billing rate** = the average of its categories' rates, weighted by people on staff in each category (a plain average when nobody is). A category's rate is the latest one in effect today from the standard rate table, unless the Admin types one to use instead. Billing rates only; never pay or cost (Josh, 2026-11-26).
- **People on staff** = active people by billing category, summed into roles. Categories marked "not counted" are neither work nor people. A category with people that is in no role and not marked "not counted" is **flagged on the page and left out**, never dropped quietly.
- **Gap** = people needed less people on staff, per role and month. The page colours a gap of half a person or more (short: red, spare: blue).
- **Months**: the `staffing.monthsShown` months after the current one. Months after `staffing.firmMonths` are shaded "less certain", because PMs plan the near months in detail and later ones thinly, so the contracted bars always fall away later on. That fall is missing information, not less work.
- **A project or pursuit with its own mix** uses that mix and so its own blended rate. See section 4.
- A role in the mix with no billing rate cannot be priced: the work that needs it is listed as a warning, never guessed.

## 3. Settings (Admin > Staffing; effective-dated like every setting)

| Setting | Default | Decided |
|---|---|---|
| `staffing.levels`: roles, their Vantagepoint billing categories, mix %, utilization target % | Principal (2, 5) 60%; Project Manager (13, 32) 85%; Project Architect (42, 8) 85%; Job Captain / Architect (16, 46) 85%; Design / Production (34, 18, 40) 85%; Interior Design (15, 17) 85%; Graphic Design (14, 19) 50% | roles, categories and targets: Josh, 2026-11-27. **The mix % (10/20/15/25/20/7/3) is made up**: Josh sets the real one. |
| `staffing.untracked` | 11 Info Tech, 37 Administration, 45 Building Performance Analyst, 47 Sr Principal CFO, 36 Principal Communications | Josh, 2026-11-27 |
| `staffing.hoursPerMonth` | 173 | proposed, not objected to |
| `staffing.monthsShown` / `staffing.firmMonths` | 12 / 6 | Claude's default |
| `staffing.rateOverrides` | none (follow Vantagepoint) | Josh: rates in settings, pulled from VP |
| `staffing.leaders` | nobody | Josh: neighborhood leaders see it |

Saving checks that the mix adds to 100%, that a category sits in one role only and is not also "not counted", and that a role with a share of the mix has a target (`settings.staffingProblem`).

## 4. A project's own staffing mix (no screen, on purpose)

Josh, 2026-11-27: one standard mix; build the means for a project to have its own, for huge projects only, but do not advertise it ("everyone will want to be the exception"). So there is a table and no screen: `staffing_custom_mix` (`wbs1`, `effective_from` YYYY-MM-DD, `mix_json` = `{ roleId: percent }` adding to 100 or `null` for back to standard, `note`, `set_by`, `set_at`). Append-only (database triggers). Josh asks; Claude or Kent adds a row. When a project does use one, the page's "How this is worked out" names it, so a number that differs from the standard rule is never a surprise. A row that no longer fits the roles (a role removed, or not adding to 100) is ignored and flagged.

## 5. Data (the source's `loadStaffing()`)

`{ categories: [{ code, title, staff }], rates: [{ category, rate, effective }], contracted: [{ id, name, month, amount }], pipeline: [...], rateTable }`. Locally from `server/db/seed/staffing_*.csv` (made up; `tools/make-seed-staffing.js`). In Vantagepoint (checked 2026-11-27, read only):

- categories: `BTLaborCats` (Category, Description); people: `EM.BillingCategory` where `Status = 'A'`.
- rates: `BTRCTCats` for the table named "Current Standard Rates" (`BTRCT.TableNo` 2024), rows effective-dated (`EffectiveDate`). Utah and California were merged into it (Josh). Some categories had no August 2026 row on purpose (rates unchanged); the latest row in effect carries forward.
- contracted: the Marketing Report's forecast rule (`modules/bd/logic/forecast.js`) with the window extended to the months shown, times the architectural share (`architectural.js`).
- pipeline: the MWIP rule (`modules/bd/logic/mwip.js`) with `through` set to the months shown, times the MWIP factor if Josh wants it (open: S3).

None of these tables are on the Vantagepoint policy's approved list yet (`server/vp/config.js`).

## 6. Not built

Live Vantagepoint pull for this page; a neighborhood breakdown; an export; history (the page is worked out each time it opens, like a live view, not a published run).
