# JS-024 — tab-tracking.js

| | |
|---|---|
| **Type** | `JS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `js/tab-tracking.js` (1478 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

Implements the Tracking tab (`TAB-008`): issue-count-over-time, cohort
comparison, the 0–48h Cohort Outcome, Daily Cohort by Region, and
Week-over-Week Cohort Comparison. Every number here is **cohort-correct**
— keyed to when a lead entered a cohort, evaluated against the nearest
snapshot at-or-before its deadline — so it does not silently drift as
`Movement_Log`'s 7-day window ages out. It owns `persistDailyCohortHistory`
(which never re-writes an archived date) and the `SLA_History` /
`Daily_Cohort_History` admin buttons, and it owns `buildTrackingChartSvg`
— reused verbatim by RM Timeline.

## Responsibilities

- `computeZeroTo48hCohort` / `computeCohortComparison` /
  `computeDailyCohortByRegion` / `computeWeekOverWeekCohort` — the
  cohort computations.
- `evidenceAtDeadline` — the shared "status as of a deadline" lookup.
- `persistDailyCohortHistory` — archive daily cohorts, **never
  re-writing** an already-archived date.
- `buildTrackingChartSvg` (+ `_ensureChartHoverTip`) — the chart
  builder.
- `renderTrackingTab` + the per-section renders; the `SLA_History` /
  `Daily_Cohort_History` admin button status handlers.

## Load order / position

Second of the tab files in the real order (`… tab-audit → tab-tracking →
tab-rmtimeline → …`), so `buildTrackingChartSvg` is defined before
`tab-rmtimeline.js` reuses it.

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-162 | `evidenceAtDeadline(history, deadlineMs, liveLead)` `#L205` | a lead's snapshot history + a deadline | the lead's status **as of that deadline** — nearest snapshot at-or-before, else forward, else `null` (never a guess) | none | — | every cohort computation here, `debugDailyCohortEvidence` | reusable — the shared as-of-deadline lookup |
| FN-163 | `computeZeroTo48hCohort()` / `computeCohortComparison(regionFilter, fromAt, toAt)` `#L282/#L110` | `movementSnapshots` | the 0–48h cohort outcome / a windowed cohort comparison | none | FN-162, `buildMovementHistories` (`JS-021`), `passesMovementFilters` (`JS-021`) | `render48hCohort` (FN-167), `renderTrackingTab` (FN-166) | specific |
| FN-164 | `computeDailyCohortByRegion(dateKey, opts)` / `eligibleDailyCohortDates()` / `_dailyCohortLiveByKeyCache(leadsArr)` `#L947/#L1058/#L931` | a date key | per-region cohort outcomes for that day; the dates it is valid to compute live | memoisation cache | FN-162, `mainRegionFor` / `effectiveRegion` (`JS-014`) | `renderDailyCohortByRegion` (FN-168), `persistDailyCohortHistory` (FN-169) | specific — **refuses live recompute past retention** (shows "NA") |
| FN-165 | `buildTrackingChartSvg(allRuns, fromAt, toAt)` / `_ensureChartHoverTip()` / `splitDailyAndScatter(runs)` `#L364/#L506/#L336` | issue-tally runs + a window | the trend-chart SVG (native `<title>` tooltips today) | injects one shared hover-tip element | `computeIssueTalliesByRun` (FN-170) | `renderTrackingTab` (FN-166), **`JS-023` `renderRMIssueHistory` (verbatim reuse)** | reusable |
| FN-166 | `renderTrackingTab()` `#L662` | `movementSnapshots` | renders every Tracking section | DOM writes | FN-163..FN-165, `getPickedTrackingWindow` (FN-171) | `renderAll` (`JS-012`) | specific |
| FN-167 | `render48hCohort()` / `renderWeekOverWeekCohort()` `#L842/#L1414` | computed cohorts | the 0–48h + week-over-week tables | DOM writes | FN-163, `computeWeekOverWeekCohort` (FN-172), `wowPctCellHtml` / `wowDeltaBadgeHtml` | FN-166 | specific |
| FN-168 | `renderDailyCohortByRegion()` `#L1177` | a picked date | the Daily Cohort by Region table | DOM write; **staleness guard** — refuses live recomputation past `Movement_Log` retention, shows "NA" | FN-164 | FN-166 | specific |
| FN-169 | `persistDailyCohortHistory()` `#L1132` | eligible dates | upserts `Daily_Cohort_History` rows | Sheets write via `upsertDailyCohortHistoryRows` (`JS-018`); **never re-writes an already-archived date** | `eligibleDailyCohortDates` (FN-164), `JS-018` | auto after a snapshot; `#backfillDailyCohortHistoryBtn` (`BTN-021`) | specific |
| FN-170 | `computeIssueTalliesByRun(regionFilter)` / `findRunTally(runs, at)` `#L31/#L93` | `movementSnapshots` | per-run issue tallies | none | FN-162 | FN-165, RM Timeline (`JS-023`) | reusable |
| FN-171 | `getPickedTrackingWindow()` / `trackingPopulateSnapshotSelectors()` `#L648/#L626` | the snapshot pickers | the selected From/To window | DOM | `populateMovementDateSelect` etc. (`JS-021`) | FN-166 | specific |
| FN-172 | `computeWeekOverWeekCohort()` / `weekOverWeekDateKeys()` / `wowPctDelta` / `wowDeltaBadgeHtml` / `wowPctCellHtml` `#L1336`–`#L1403` | two week windows | the week-over-week cohort deltas + badge/cell HTML | none | FN-164, FN-162 | FN-167 | specific |
| FN-173 | `setSlaHistoryAdminStatus(text, color)` / `setDailyCohortHistoryAdminStatus(text, color)` `#L534/#L580` | status text | writes the admin button status lines | DOM | — | the admin button handlers | specific — the buttons' write logic is in `JS-018` / `JS-004` |

## Business rules implemented — `RULE-XXX` sub-table

| ID | Rule | Where | Duplicated in (`GS-XXX`)? | Notes |
|---|---|---|---|---|
| RULE-029 | `persistDailyCohortHistory()` **never re-writes an already-archived date** — "not optional": re-deriving a stale archived day from `Movement_Log`'s 7-day window would substitute wrong late evidence | FN-169 | `MovementTracker.gs`'s cohort-history persist has the same rule (`GS-008`) | `LOGIC_AUDIT.md` Part 1 §4c |
| RULE-030 | `renderDailyCohortByRegion` refuses live recomputation past `Movement_Log` retention — shows "NA", not a wrong number | FN-168 | — | staleness guard |
| RULE-031 | `evidenceAtDeadline` prefers the nearest snapshot at-or-before the deadline, falls forward, else returns `null` — never guesses | FN-162 | conceptually mirrors the backend's cohort evidence lookup | `LOGIC_AUDIT.md` Part 1 §4c |
| RULE-032 | `upsert*` writes (via `JS-018`) use `RAW` value-input to stop Sheets auto-converting date-text to a serial number | FN-169 → `JS-018` FN-129 | same on the backend cohort writer | documented Sheets bug class |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-052 | requested cohort date is older than `Movement_Log` retention and not archived | FN-168 shows "NA"; FN-169 skips it | "NA" cell, not a fabricated number |
| EXC-053 | `Daily_Cohort_History` backfill partial failure | re-runnable (upsert by key) | status line shows the error; retry |
| EXC-054 | `Clear SLA History` / `Clear Daily Cohort History` mid-operation failure | rows may be partially deleted | status line shows the error |

## Data lineage

`Movement_Log` (`SHEET-002`) → `movementSnapshots` (`JS-021`) →
`buildMovementHistories` → `evidenceAtDeadline` (FN-162) per cohort
member → cohort tables + trend chart → screen. Archive path: computed
daily cohorts → `persistDailyCohortHistory` (FN-169) →
`upsertDailyCohortHistoryRows` (`JS-018`) → `Daily_Cohort_History`
(`SHEET-008`). `SLA_History` (`SHEET-005`) is written by `JS-018` on
snapshot and read here for the archived portion. Full flow: `DATA-004`.

## Data sources accessed

Reads `movementSnapshots` (from `SHEET-002`); reads `SLA_History`
(`SHEET-005`) and `Daily_Cohort_History` (`SHEET-008`) for archived
data (via `JS-018` fetch helpers).

## Data written / modified

Via `JS-018`: `Daily_Cohort_History` (`SHEET-008`) upsert (auto +
`BTN-021`), clear (`BTN-022`). `SLA_History` (`SHEET-005`) backfill
(`BTN-019`) is also routed through `JS-018`; `Clear SLA History`
(`BTN-020`) is in `JS-004`. No direct Sheet write of its own.

## Failure / error behaviour

Cohort computations past retention degrade to "NA" rather than a wrong
number (RULE-030 / EXC-052). Archive writes are keyed and re-runnable.
The clear operations can leave partial deletion (EXC-054), surfaced in
the status line.

## Cross-runtime duplication

`persistDailyCohortHistory`'s never-re-archive rule and the
`Daily_Cohort_History` schema match `MovementTracker.gs`'s own cohort
persist (`GS-008`) — "written by both a browser path and an Apps Script
path with matching schema" (`LOGIC_AUDIT.md` Part 1 §4d). `SLA_History`
schema is shared with the same file's SLA_History write.

## UI relationships

`#tab-tracking` panel; the tracking chart SVG (`UI-013`), cohort /
week-over-week tables (`UI-014`), `#backfillSlaHistoryBtn` (`BTN-019`),
`#clearSlaHistoryBtn` (`BTN-020`, logic in `JS-004`),
`#backfillDailyCohortHistoryBtn` (`BTN-021`), `#clearDailyCohortHistoryBtn`
(`BTN-022`) — all on `TAB-008`.

## Architecture relationship

`DASH-001`. Layer 10 (render) + layer 11-facing (its archive writes go
through `JS-018`). Belongs to `TAB-008`.

## Related documentation

`HANDOVER.md` §2, §5 (sheets), §8; `LOGIC_AUDIT.md` Part 1 §4c/§4d.

## Relationships

- **Depends On:** `JS-021` (`movementSnapshots`, `buildMovementHistories`,
  `passesMovementFilters`, snapshot selectors), `JS-018` (archive
  writes), `JS-004` (`clearSlaHistory`), `JS-014` (`mainRegionFor`,
  `effectiveRegion`), `JS-010` (`esc`), `JS-005` (IST helpers),
  `SHEET-002`, `SHEET-005`, `SHEET-008`
- **Used By:** `TAB-008`; `JS-012` (`renderAll` calls `renderTrackingTab`);
  `JS-023` (RM Timeline reuses `buildTrackingChartSvg`)
- **Related:** `GS-008` (`MovementTracker.gs` — matching cohort/SLA
  history writer), `TAB-002` (live rates vs these cohort-correct numbers)

## Source of truth

`js/tab-tracking.js` at `HEAD`.

## Validation

- **Method:** full read at `c82ec67`; function list verified by grep;
  cross-check `LOGIC_AUDIT.md` Part 1 §4c/§4d (never-re-archive rule,
  retention staleness guard, `evidenceAtDeadline` fallback chain).
  `tests/frontend-harness.html` runs `renderTrackingTab` /
  `computeZeroTo48hCohort` and exercises `upsertDailyCohortHistoryRows`
  with a mocked write boundary.
- **Evidence:** `LOGIC_AUDIT.md` Part 1 §4c/§4d; `tests/frontend-harness.html`.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-028.

## Revalidation trigger

Any commit touching `js/tab-tracking.js`; `buildTrackingChartSvg`
signature changes (also affects `JS-023`); the never-re-archive rule or
the retention staleness guard changes; `evidenceAtDeadline`'s fallback
chain changes; `SLA_History` (`SHEET-005`) or `Daily_Cohort_History`
(`SHEET-008`) columns change.

## Handover relationship

`HANDOVER.md` §2 names the file; §5 covers the sheets it writes. Current
as of 2026-09-09. A change to the cohort-archival rule must update
`HANDOVER.md` §5 and note the `buildTrackingChartSvg` reuse by `JS-023`.

## Lifecycle / retention

N/A — code. `SLA_History` / `Daily_Cohort_History` are the **long-lived
archives** that exist *because* `Movement_Log` is 7-day — their retention
is `TBD` (DOC-036), not 7-day.

## Next action

none — Closed + Monitored.

## Closure evidence

Record committed for DOC-028; `docs/INDEX.md` `JS-024` → `Closed +
Monitored`, `Last Verified` 2026-09-10, reciprocal links to `TAB-008`
+ `JS-023` confirmed; `RULE-029`..`032`, `EXC-052`..`054` recorded. No
`docs/changes/` record (DOC-028).
