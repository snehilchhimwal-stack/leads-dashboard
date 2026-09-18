# SHEET-016 — Opp_Monitor_Period

| | |
|---|---|
| **Type** | `SHEET-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | Google Sheet, tab `Opp_Monitor_Period` |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Validated |
| **Last Verified** | 2026-09-18 (pending commit) |

## Purpose / reason to exist

Stores the completed results of each ~10-day period (1st–10th, 11th–20th,
21st–end) of the recurring Google Non-UTM/Search Same-day/48h Opp%
monitoring workflow, plus that period's own 3-step checklist status
(data collection & validation → analysis → leadership email). It exists
so the live dashboard (`TAB-009`/`JS-025`) can display this workflow's
progress and results without any connection to the separate local To-Do
Dashboard tool the workflow's recurring reminders actually live in.

## Data stored

Up to 3 rows per month (one per period), 21 columns: identity + date
range, the raw counts and percentages an external analytics session
computed, average time-to-first-Opportunity-transition (days/hours,
averaged over converted leads only), and per-step status/timestamp pairs
for the period's own 3 checklist steps.

## Source of the data

**No writer exists anywhere in this codebase.** Written directly via the
Sheets UI/API by a human or a separate Claude session running the actual
Homesfy-analytics-MCP-based workflow — a genuinely different situation
from every other Sheet tab this project documents, all of which have at
least one `.gs`/`js/*.js` writer. State this plainly rather than implying
a writer exists that doesn't.

## Destination / consumers

`JS-025`'s `fetchOppMonitorData`/`_fetchOppMonitorTab`, for `TAB-009`.

## Columns / fields

| Column | Type | Meaning | Notes |
|---|---|---|---|
| `period_key` | text | upsert key, `"<year_month>_P<period_number>"` e.g. `"2026-09_P1"` | column A |
| `year_month` | text | `"YYYY-MM"` | |
| `period_number` | number | `1` \| `2` \| `3` | |
| `period_label` | text | `"1st-10th"` \| `"11th-20th"` \| `"21st-end"` | |
| `date_from` / `date_to` | text | `"YYYY-MM-DD"` | **stored as plain text, never a real Sheet date** — deliberate, same reasoning this project's other `RAW`-value-input writes give (avoids Sheets silently coercing a date-shaped string into a Date-typed cell) |
| `total_leads` | number | the denominator the external session used | |
| `same_day_count` / `h48_count` | number | raw counts | |
| `same_day_pct` / `h48_pct` | number | **already-computed percentages**, not re-derived locally | this app has no way to reproduce the external session's computation, so it stores and displays exactly what was computed, not a locally-recalculated value |
| `step1_status` / `step1_at` | text | data collection & validation | `step1_status` = `"done"` or blank |
| `step2_status` / `step2_at` | text | analysis | |
| `step3_status` / `step3_at` | text | leadership email | |
| `updated_at` | text | last write timestamp | |
| `source` | text | who/what wrote the row (e.g. `"Claude session"`) | |
| `avg_days_to_opp` / `avg_hrs_to_opp` | number | mean time from lead creation to first `Opportunity`-stage transition | averaged over converted leads only (leads with no Opportunity transition are excluded, not counted as 0); added 2026-09-18 alongside the per-period opp-count columns being surfaced in the Period Results table |

Exact list: `js/tab-oppmonitor.js` `OPP_MONITOR_PERIOD_COLUMNS`.

## Writers

None — see "Source of the data" above.

## Readers

| Reader | Which `FN-XXX` | For |
|---|---|---|
| `JS-025` | `fetchOppMonitorData` (FN-259) / `_fetchOppMonitorTab` (FN-260) | `TAB-009`'s checklist + Period Results table |

## Automation / triggers touching it

None. No trigger in this codebase reads or writes this tab.

## Data Lifecycle

- **Data Type:** operational/reporting snapshot
- **Retention Period:** `TBD` — no retention policy decided yet; logged
  in `docs/_planning/OPEN_ITEMS.md` §B per `DOC-046`'s rule against
  inventing one
- **Enforced By:** n/a
- **Sensitivity:** operational — aggregate counts/percentages only, no
  PII, no individual lead identifiers

## Sensitivity & operational importance (DOC-038)

- **Operational importance:** LOW — display-only; no automation in this
  codebase depends on this tab existing or being current. Same tier as
  `Daily_Cohort_History`.
- **Data sensitivity:** operational.

## Risks of changing this tab's structure

Columns must stay in `OPP_MONITOR_PERIOD_COLUMNS` order for `JS-025`'s
reader to find them by header-name lookup (it matches by column *label*,
not position, so a reorder is actually safe — but a rename requires the
same rename on both this sheet's header row and the constant array in
`js/tab-oppmonitor.js`). Since there is no writer in this codebase, there
is no "two-writer schema parity" risk the way `Movement_Log`/
`Movement_Log_Runs` have — only a single reader to keep in sync with
whatever the external analytics session actually writes.

## Relationships to other tabs

Sibling of `SHEET-017` (`Opp_Monitor_Month`) — same workflow, different
grain (period vs month rollup), same "no writer in this repo" situation.

## Important logic / business rules

"No backfill" is a workflow-level decision, not enforced by this sheet's
own structure — an absent period simply has no row, and `JS-025`'s
render logic treats that as "not reached yet," never inventing a
placeholder value.

## Exceptions & error handling

A missing tab (Sheets API 400 on the range read) is treated as "no data
yet," never an error — see `JS-025` `EXC-094`.

## Related documentation

`TAB-009`, `JS-025`; the session plan file (2026-09-18) for the full
design rationale, including why two tabs exist instead of one.

## Relationships

- **Depends On:** `EXT-001`
- **Used By:** `JS-025`, `TAB-009`
- **Related:** `SHEET-017` (sibling, same workflow)

## Source of truth

The live `Opp_Monitor_Period` tab; schema defined by
`OPP_MONITOR_PERIOD_COLUMNS` (`js/tab-oppmonitor.js`).

## Validation

- **Method:** column list read directly from `js/tab-oppmonitor.js`
  source. Reader behavior (missing-tab graceful handling, correct
  cross-month delta resolution) verified via
  `tests/frontend-harness.html`'s isolated-fixture block (90/90 pass
  after the 2026-09-18 column addition).
- **Evidence:** `tests/frontend-harness.html`; live sheet.
- **Status:** Validated 2026-09-18 against the live `Opp_Monitor_Period`
  tab — created directly via the Sheets API (dashboard's own OAuth
  session, `spreadsheets` scope) and backfilled with real July/August
  2026 Google Non-UTM/Search Same-day/48h Opp% + avg-time-to-Opp figures
  computed via the Homesfy analytics MCP. September intentionally left
  empty per the "no backfill" rule for the in-progress month.

## Version / change reference

Record created 2026-09-18, commit `4bbb58c`, alongside `TAB-009`/`JS-025`.
Revalidated 2026-09-18 (same day) for the `avg_days_to_opp`/
`avg_hrs_to_opp` column addition and first live backfill.

## Revalidation trigger

`OPP_MONITOR_PERIOD_COLUMNS` changes; the workflow's step structure
changes; a real writer is ever added to this codebase (would need a full
"Source of the data" rewrite, not just a note).

## Handover relationship

Not yet in `HANDOVER.md` — see `TAB-009`'s Next action.

## Lifecycle / retention

`TBD` (see Data Lifecycle above).

## Next action

Decide a retention policy once real usage patterns are known (`DOC-037`).
Move `Record Status` to `Closed + Monitored` once the recurring workflow
has run a full organic cycle (not just this one-time backfill).

## Closure evidence

Not yet closed — `Record Status: Validated`. Live sheet observed with
real backfilled July/August 2026 data as of 2026-09-18.
