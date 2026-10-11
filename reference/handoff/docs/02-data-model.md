# Data model (proposed)

Two data owners. **Vantagepoint** (read-only) is the source of financial truth. **Compass's own DB** holds everything the portal creates. Keep them separate: the portal reads only Compass's DB.

## Read from Vantagepoint (via `sql/compass_negative_projects.sql`)
Tables: `PR` (projects), `EMMain` (employees), `LedgerAR`, `LD` (labor), `LedgerAP`, `LedgerMisc`, `LedgerEX`, `RPPlan` (overhead rates).
Profit = Billed − Labor × (1 + overhead%/100) − Expenses (AP + JE + EX, `ProjectCost='Y'`), at the WBS1 (project) level. Filters: Status `A`, ChargeType `R`, WBS1 not starting `Z` or `J`. YTD = January of `@RunPeriod`'s year through `@RunPeriod`. **Validated against the Excel report for August 2026.**
Three result sets: negative projects; projects that can't be evaluated (no overhead plan / mixed rates); active projects with no PIC.
BD and Pipeline need **new queries** (revenue by PIC and sector, forecast, MWIP/pursuit data). Those are not written yet; see open questions.

## Compass tables (sketch; adapt to your DB)
```
users(id, email, name, role, draft_name, pic_employee_code NULL, active)
settings(key, value_json, effective_from, set_by, set_at)        -- every Admin setting; effective-dated
mwip_factor(factor, effective_from, effective_to)                -- also covered by settings, kept explicit

runs(id, kind[turnaround|bd], period YYYYMM, version, status[draft|published|archived],
     created_at, published_at, published_by, archived_at, archive_reason)
run_projects(run_id, wbs1, name, pic_code, pm_code, billed_cur, billed_ytd, billed_jtd,
             profit_cur, profit_ytd, profit_jtd, pct_cur, pct_ytd, pct_jtd, first_seen_period)
run_warnings(run_id, kind[cant_evaluate|no_pic|no_sector], wbs1, detail)

plan_entries(id, wbs1, author_id, kind[explanation|commitment|update|correction|admin_note|system],
             body, created_at, corrects_entry_id NULL)           -- APPEND ONLY
commitments(id, entry_id, wbs1, promised_by_date, lever, qty, status[open|done|missed],
            actual_result NULL, closed_at NULL)
commitment_events(id, commitment_id, kind[date_revised|done|missed], old_date, new_date, reason, at, by)
checkin_drafts(id, wbs1, pic_user_id, reason, subject, body, status[waiting|sent|dismissed], created_at, resolved_at)

goals(year, scope[pic|sector], key, amount)
sector_map(wbs1 or rule, sector, effective_from)
bd_rows(run_id, scope, key, goal, ytd, forecast, mwip_raw, ...)  -- frozen per BD run

pipeline_snapshots(snapshot_date, pic_code, kind[mwip|forecast], amount, moved_to_next_year)
pursuits(id, first_seen_date, pic_code, name, stage, wbs1_match NULL)
pursuit_snapshots(snapshot_date, pursuit_id, kind, amount, stage, win_prob)
alerts(id, snapshot_date, rule, pic_code, severity[alert|watch], message, detail_json, cleared_at)

audit_log(id, at, user_id, action, object, detail_json)
```
## Invariants (enforce in the DB layer, not only the UI)
- `plan_entries`: no UPDATE/DELETE grants for the app role. Trigger or permission-level.
- `runs.status='published'` → every dependent row becomes immutable (reject writes).
- Settings are effective-dated; a run records the settings snapshot it was built with so a rerun and a historical view are reproducible.
- Plan data keyed by `wbs1`, never by `run_id`.
- The "on time / kept" percentages are computed from `plan_entries`/`commitments`, not stored.
