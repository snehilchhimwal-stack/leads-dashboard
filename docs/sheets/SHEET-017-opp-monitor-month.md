# SHEET-017 — Opp_Monitor_Month

| | |
|---|---|
| **Type** | `SHEET-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | Google Sheet, tab `Opp_Monitor_Month` |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Validated |
| **Last Verified** | 2026-09-18 against commit `f853a1c` |

## Purpose / reason to exist

Stores the completed month-level rollup of the recurring Google
Non-UTM/Search Same-day/48h Opp% monitoring workflow, plus that month's
own 3-step checklist status (monthly aggregation → historical comparison
→ trend summary — steps 10/11/12 of the workflow's 12 total). Sibling of
`SHEET-016` (`Opp_Monitor_Period`) at a different grain: one row per
month rather than up to 3 per month.

## Data stored

One row per completed month, 18 columns: identity, the raw counts and
percentages an external analytics session aggregated from that month's
periods, average time-to-first-Opportunity-transition (days/hours), and
per-step status/timestamp pairs for the month's own 3 checklist steps.

## Source of the data

**No writer exists anywhere in this codebase** — same situation as
`SHEET-016`. Written directly via the Sheets UI/API by a human or a
separate Claude session, after that month's 3 periods
(`Opp_Monitor_Period`) are all complete.

## Destination / consumers

`JS-025`'s `fetchOppMonitorData`/`_fetchOppMonitorTab`, for `TAB-009`.

## Columns / fields

| Column | Type | Meaning | Notes |
|---|---|---|---|
| `month_key` | text | upsert key, = `year_month` | column A |
| `year_month` | text | `"YYYY-MM"` | |
| `month_label` | text | `"September 2026"` | |
| `total_leads` | number | sum of the month's 3 periods | should reconcile with `SHEET-016`'s 3 rows for the same month — the workflow's own aggregation step is the cross-check, not this sheet's structure |
| `same_day_count` / `h48_count` | number | raw counts | |
| `same_day_pct` / `h48_pct` | number | already-computed percentages, not re-derived locally | same reasoning as `SHEET-016` |
| `step1_status` / `step1_at` | text | monthly aggregation | |
| `step2_status` / `step2_at` | text | historical comparison | |
| `step3_status` / `step3_at` | text | trend summary | |
| `updated_at` | text | last write timestamp | |
| `source` | text | who/what wrote the row | |
| `avg_days_to_opp` / `avg_hrs_to_opp` | number | mean time from lead creation to first `Opportunity`-stage transition, for the whole month | same "converted leads only" averaging as `SHEET-016`; added 2026-09-18 |

No month-over-month delta columns are stored — `JS-025` computes deltas
at render time from adjacent rows' raw `*_pct` values.

Exact list: `js/tab-oppmonitor.js` `OPP_MONITOR_MONTH_COLUMNS`.

## Writers

None — see "Source of the data" above.

## Readers

| Reader | Which `FN-XXX` | For |
|---|---|---|
| `JS-025` | `fetchOppMonitorData` (FN-259) / `_fetchOppMonitorTab` (FN-260) | `TAB-009`'s checklist + Monthly Trend table |

## Automation / triggers touching it

None.

## Data Lifecycle

- **Data Type:** operational/reporting snapshot
- **Retention Period:** `TBD`, logged in `docs/_planning/OPEN_ITEMS.md` §B
- **Enforced By:** n/a
- **Sensitivity:** operational — aggregate counts/percentages only

## Sensitivity & operational importance (DOC-038)

- **Operational importance:** LOW — display-only.
- **Data sensitivity:** operational.

## Risks of changing this tab's structure

Same as `SHEET-016`: a rename needs both the sheet header and
`OPP_MONITOR_MONTH_COLUMNS` updated together; no two-writer parity risk
since there is no writer in this codebase at all.

## Relationships to other tabs

Sibling of `SHEET-016` (`Opp_Monitor_Period`) — same workflow, month
grain instead of period grain.

## Important logic / business rules

A month's row should only ever be written once all 3 of that month's
periods are complete — this is a workflow-process rule (the To-Do
Dashboard task's own dependency, "Monthly aggregation depends on all 3
periods' Step 1+2"), not something this sheet or `JS-025` enforces
structurally.

## Exceptions & error handling

A missing tab is treated as "no rollups recorded yet," never an error —
see `JS-025` `EXC-094`.

## Related documentation

`TAB-009`, `JS-025`, `SHEET-016`; the session plan file (2026-09-18).

## Relationships

- **Depends On:** `EXT-001`
- **Used By:** `JS-025`, `TAB-009`
- **Related:** `SHEET-016` (sibling, same workflow)

## Source of truth

The live `Opp_Monitor_Month` tab; schema defined by
`OPP_MONITOR_MONTH_COLUMNS` (`js/tab-oppmonitor.js`).

## Validation

- **Method:** column list read directly from `js/tab-oppmonitor.js`
  source. Reader behavior verified via `tests/frontend-harness.html`'s
  isolated-fixture block (month-over-month delta, absent-month omission;
  90/90 pass after the 2026-09-18 column addition).
- **Evidence:** `tests/frontend-harness.html`; live sheet.
- **Status:** Validated 2026-09-18 against the live `Opp_Monitor_Month`
  tab — created via the Sheets API and backfilled with real July/August
  2026 rollups computed via the Homesfy analytics MCP. September
  intentionally left empty (month not yet complete).

## Version / change reference

Record created 2026-09-18, commit `4bbb58c`, alongside `TAB-009`/`JS-025`.
Revalidated 2026-09-18 (same day) for the `avg_days_to_opp`/
`avg_hrs_to_opp` column addition and first live backfill.

## Revalidation trigger

`OPP_MONITOR_MONTH_COLUMNS` changes; the workflow's month-level step
structure changes; a real writer is ever added.

## Handover relationship

Not yet in `HANDOVER.md` — see `TAB-009`'s Next action.

## Lifecycle / retention

`TBD`.

## Next action

Decide a retention policy once real usage patterns are known. Move
`Record Status` to `Closed + Monitored` once the recurring workflow has
run a full organic cycle (not just this one-time backfill).

## Closure evidence

Not yet closed — `Record Status: Validated`. Live sheet observed with
real backfilled July/August 2026 data as of 2026-09-18.
