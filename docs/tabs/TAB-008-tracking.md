# TAB-008 — Tracking

| | |
|---|---|
| **Type** | `TAB-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `dashboard.html` `#tab-tracking` (`#L1306`); `js/tab-tracking.js` |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

Cohort-correct history. It shows issue-count-over-time, cohort
comparison, the 0–48h Cohort Outcome, Daily Cohort by Region, and
Week-over-Week Cohort Comparison — all keyed to *when a lead entered a
cohort*, not to the present. It exists so a manager can ask "of the
leads that came in on Tuesday, how many were still failing at 48h" and
get an answer that doesn't silently drift as `Movement_Log`'s 7-day
window ages out. It owns the `SLA_History` and `Daily_Cohort_History`
admin buttons because it is the tab whose numbers those archives back.

## Responsibilities

- Render the tracking chart, cohort comparison, 0–48h outcome, Daily
  Cohort by Region, Week-over-Week comparison.
- Persist `Daily_Cohort_History` — **never re-writing an already-archived
  date**.
- Refuse live recomputation past `Movement_Log` retention (show "NA", not
  a wrong number).
- Host the `SLA_History` / `Daily_Cohort_History` backfill + clear
  buttons.

## Who / what uses it

Regional heads / leadership reviewing trend and cohort outcomes over
time (`HANDOVER.md` §2).

## Inputs (which in-memory state arrays / filter state it reads)

`movementSnapshots` + `buildMovementHistories` + `passesMovementFilters`
(`JS-021`); `mainRegionFor` / `effectiveRegion` (`JS-014`); reads
`SLA_History` / `Daily_Cohort_History` for the archived portion (via
`JS-018` helpers).

## Outputs / what it renders

The tracking SVG chart + cohort tables into `#tab-tracking`. Writes:
`SLA_History` (`SHEET-005`) and `Daily_Cohort_History` (`SHEET-008`) via
`JS-018`, both auto (on snapshot) and on the admin buttons.

## Data displayed

Issue count per day; cohort pass/fail at deadline; per-region daily
cohort outcomes; week-over-week deltas. `evidenceAtDeadline()` supplies
"status as of a deadline" (nearest snapshot at-or-before, else forward,
else `null`).

## Data written / modified

| Target | When | Function |
|---|---|---|
| `SHEET-005` `SLA_History` | auto on snapshot; Backfill button | `upsertSlaHistoryRows` / `backfillSlaHistoryFromMovementLog` |
| `SHEET-005` `SLA_History` | Clear button (destructive) | `clearSlaHistory` (`JS-004`) — own `batchUpdate` fetch |
| `SHEET-008` `Daily_Cohort_History` | auto via `persistDailyCohortHistory`; Backfill button | `upsertDailyCohortHistoryRows` |
| `SHEET-008` `Daily_Cohort_History` | Clear button (destructive) | clear handler (`JS-024`) |

## Navigation relationships

Reached from `#tabBar`. Part of the `renderAll()` pass
(`renderTrackingTab`). Its `buildTrackingChartSvg` is reused **verbatim**
by RM Timeline (`TAB-005` / `JS-023`).

## Buttons / actions — `BTN-XXX` sub-table

| ID | Label | Element id | What it does | Invokes (`FN-XXX`) | Confirm/irreversible? | Failure behaviour |
|---|---|---|---|---|---|---|
| BTN-019 | Backfill from Movement_Log (SLA_History) | `#backfillSlaHistoryBtn` | Rebuilds `SLA_History` from every loaded `Movement_Log` snapshot; upserts by `snapshot_at`, never duplicates | `backfillSlaHistoryFromMovementLog` (`JS-018`) | no — safe to re-run (upsert) | partial write leaves status text with the error; re-runnable |
| BTN-020 | Clear SLA History… | `#clearSlaHistoryBtn` | **Permanently deletes every row in `SLA_History`** | `clearSlaHistory` (`JS-004`) | **yes — irreversible**, styled red, "Cannot be undone" | on failure, rows may be partially deleted; status text shows error |
| BTN-021 | Backfill Daily Cohort History | `#backfillDailyCohortHistoryBtn` | Upserts `Daily_Cohort_History` rows from loaded snapshots for non-archived dates | `upsertDailyCohortHistoryRows` (`JS-018`) | no — never overwrites an archived date | re-runnable |
| BTN-022 | Clear Daily Cohort History | `#clearDailyCohortHistoryBtn` | Deletes `Daily_Cohort_History` rows | clear handler (`JS-024`) | **yes — irreversible** | status text shows error |

## Non-button UI elements — `UI-XXX` sub-table

| ID | Element | Behaviour | Invokes (`FN-XXX`) |
|---|---|---|---|
| UI-013 | tracking chart SVG | hover shows a native `<title>` tooltip today | `buildTrackingChartSvg` (`JS-024`) |
| UI-014 | cohort / week-over-week tables | repainted every `renderAll()` | `renderTrackingTab` (`JS-024`) |

## Owning module(s)

`JS-024` (`js/tab-tracking.js`); write helpers in `JS-018`;
`clearSlaHistory` in `JS-004`. Reciprocal `Used By: TAB-008` on each.

## Relevant functions

`renderTrackingTab`, `computeZeroTo48hCohort`, `computeDailyCohortByRegion`,
`persistDailyCohortHistory`, `buildTrackingChartSvg`, `evidenceAtDeadline`
(`JS-024`); `upsertSlaHistoryRows`, `upsertDailyCohortHistoryRows`,
`backfillSlaHistoryFromMovementLog` (`JS-018`); `clearSlaHistory`
(`JS-004`). Detail on those FN sub-tables.

## Important logic / business rules

- `persistDailyCohortHistory()` **never re-writes an already-archived
  date** — explicitly "not optional": re-deriving a stale archived day
  from `Movement_Log`'s 7-day window would substitute wrong late evidence
  (`LOGIC_AUDIT.md` Part 1 §4c).
- The staleness guard in `renderDailyCohortByRegion` refuses live
  recomputation past retention — shows "NA" not a wrong number.
- `evidenceAtDeadline()` prefers nearest snapshot at-or-before, falls
  forward, else returns `null` rather than guessing.
- `upsert*` writes use `RAW` value-input to stop Sheets auto-converting
  date-text to a serial number (`JS-018`).

## Exceptions & error handling

Past-retention recompute → "NA". Backfill partial failure → re-runnable
(upsert). Clear-history failure → possibly partial deletion, status text
shows the error.

## Architecture relationship

`DASH-001`. Consumes `DATA-004` (Movement snapshot pipeline); its cohort
archives feed nothing else in the catalog directly (read by this tab
only).

## Related documentation

`HANDOVER.md` §2, §5 (sheets), §8; `LOGIC_AUDIT.md` Part 1 §4c.

## Relationships

- **Depends On:** `JS-004` (`clearSlaHistory`), `JS-014`
  (`mainRegionFor` / `effectiveRegion`), `JS-018` (writes), `JS-021`
  (`movementSnapshots`), `JS-024`, `SHEET-002`, `SHEET-005`,
  `SHEET-008`, `EXT-001`
- **Used By:** `DASH-001`
- **Related:** `TAB-002` (live rates vs these cohort-correct numbers),
  `GS-008` (`MovementTracker.gs` also writes `SLA_History`)

## Source of truth

`dashboard.html` `#tab-tracking`; `js/tab-tracking.js` at `HEAD`.

## Validation

- **Method:** read of `js/tab-tracking.js` + `#tab-tracking` markup at
  `c82ec67`; cross-check `LOGIC_AUDIT.md` Part 1 §4c;
  `tests/frontend-harness.html` runs `renderTrackingTab` /
  `computeZeroTo48hCohort` and exercises `upsertSlaHistoryRows` with a
  mocked write boundary.
- **Evidence:** `LOGIC_AUDIT.md` Part 1 §4c; `tests/frontend-harness.html`.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-026.

## Revalidation trigger

Any commit touching `js/tab-tracking.js`; `buildTrackingChartSvg` changes
(also affects `TAB-005`); the never-re-archive rule or the retention
staleness guard changes; `SLA_History` (`SHEET-005`) or
`Daily_Cohort_History` (`SHEET-008`) columns change; `#tab-tracking`
button set changes.

## Handover relationship

`HANDOVER.md` §2 names the file; §5 covers the sheets it writes. Current
as of 2026-09-09. A change to the cohort-archival rule must update
`HANDOVER.md` §5 and note the `buildTrackingChartSvg` reuse by `TAB-005`.

## Lifecycle / retention

N/A — code. `SLA_History` / `Daily_Cohort_History` retention: see
`SHEET-005` / `SHEET-008` (`TBD` until DOC-036 — they are *not*
`Movement_Log`-style 7-day; they are the long-lived archives that exist
*because* `Movement_Log` is 7-day).

## Next action

none — Closed + Monitored.

## Closure evidence

Record committed for DOC-026; `docs/INDEX.md` `TAB-008` → `Closed +
Monitored`, `Last Verified` 2026-09-10; `BTN-019`..`BTN-022` rows added;
validation evidence as above. No `docs/changes/` record (DOC-026).
