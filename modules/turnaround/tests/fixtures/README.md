# Fixtures: the business rules as data

Each file here is a table of cases: inputs, and the answer the rule must give. They are plain JSON with no code in them, so a rebuild in any language can load them and check its own implementation against the same answers. The JavaScript tests that read them are `../logic.test.js` and `../../../../shared/rules/tests/rules.test.js`.

Everything is made up. Money is **whole cents** (integers). Dates are `YYYY-MM-DD` text, with no times and no time zones. Percentages are plain numbers (150 means 150%).

| File | Rule it pins down | Input | Expected |
|---|---|---|---|
| `profit.json` | Project profit: Billed - Labor x (1 + overhead%) - Expenses, over three windows (current month, year to date, job to date). Same math as `reference/handoff/sql/compass_negative_projects.sql`. | `projects`, monthly `ledger` rows, `overhead` min/max, `runPeriod` (YYYYMM) | per project: `billed` and `profit` for `cur`, `ytd`, `jtd`; `evaluable` and `reason` when not; YTD % to 1 decimal |
| `selection.json` | Which projects land on a run, and which become warnings. | computed projects (`base`) and the include settings | the ordered project list and the warnings (`no_pic`, `cant_evaluate`) |
| `lifecycle.json` | Run states (draft, published, archived): what may be built, published, rebuilt, archived (reason plus the word RERUN), and which run everyone else sees. | a list of runs and an action | allowed or not; the next version number; the visible run |
| `schedule.json` | Last closed month, first business day (first weekday), next first business day, last day of a period, month names. | dates | the answer |
| `plan.json` | The plan log: commitment states replayed from entries, plan status (no plan, current, update due, overdue), when a commitment is recorded Missed, on-time and kept counts, standing label, who may write which kind of entry. | log entries (`kind`, `date`, `commitmentId`, `data`), `today`, `firstAppeared`, settings | status, due date, days overdue; commitment status and kept; counts; label; allowed or not |
| `drafts.json` | The check-in ladder: who gets a draft, at which step, who is skipped, what is withdrawn or escalated, and the exact wording of a draft. | accountable projects, existing drafts, last entry per PIC, settings | drafts to create, drafts to withdraw, projects to escalate; subject and body text |
| `../../../../shared/rules/tests/fixtures/roles.json` | Who may see which area and Admin tab; the last active Admin cannot be removed. | role and access setting | allowed or not |
| `../../../../shared/rules/tests/fixtures/settings.json` | Which value of a setting is in force at a moment (settings are effective-dated), which values are valid, which combinations are not. | rows and a time; a key and a value | the value in force; valid or not |

## How to use them in another language

1. Load the JSON. Ignore any key that starts with `_` (they are notes).
2. For each case, call your implementation of the rule with the inputs and compare to `expect`. The case `name` says what the case is proving.
3. Match exactly, except percentages (compare to the number of decimals the field name says) and the `contains` lists in `drafts.json` text cases (the draft text must include each phrase).
4. `settings` blocks give the Admin values in force for that file; they are the defaults unless a case overrides one.

## Things the fixtures do not cover (they need a database)

These behaviors are tested only against the running server, in `server/tests/*.test.js`. Port those tests, not just the fixtures, when the back end is rebuilt:

- the published-run lock and the append-only plan log (the database refuses changes);
- what each role is sent (a PIC must never receive a commitment's lever, number or actual result);
- the daily job end to end (missed commitments, drafts, the one email);
- Home's data checks.

`docs/SPEC-turnaround.md` states each of those rules in plain language.
