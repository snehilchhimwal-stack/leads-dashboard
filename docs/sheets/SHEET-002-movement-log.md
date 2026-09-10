# SHEET-002 — Movement_Log

| | |
|---|---|
| **Type** | `SHEET-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | Google Sheet, tab `Movement_Log` |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

The `leads` tab only shows the present. `Movement_Log` is the periodic
frozen history: every open lead, snapshotted 4×/day, so the system can
reconstruct "this lead stopped moving 3 days ago," the 0–48h cohort
outcome, an RM's issue history, and the RM-performance leaderboard — none
of which the live tab can answer. It is **the largest tab in the
project** and is pruned to 7 days.

## Reason to exist

So SLA/cohort/performance questions about a *past* day can be answered
from stored evidence rather than re-derived (wrongly) from a live tab
that has since moved on.

## Data stored

Two bookkeeping columns (`snapshot_at`, `snapshot_label`) plus the
`SNAPSHOT_COLUMNS_` copy of each open lead's key fields at capture time.

## Source of the data

Written by **two independent writers with an identical schema**:
`GS-008` `snapshotOpenLeads_` (the 4×/day trigger) and `JS-018`
`browserSnapshotOpenLeads` (the on-demand "Snapshot now" button).

## Destination / consumers

`JS-021` (`fetchMovementLog` → `movementSnapshots`), and via that state:
`JS-008` (RM performance), `JS-024` (cohorts), `JS-023` (RM Timeline),
`JS-013` (PDF). Backend: `GS-008` `buildMovementLogMapsGs_` → `GS-001` /
`GS-010` / `GS-003` (baselines + backfill).

## Columns / fields

| Column | Type | Meaning | Notes |
|---|---|---|---|
| `snapshot_at` | datetime | capture instant | written `RAW` to avoid serial coercion |
| `snapshot_label` | text | the run label (`snapshotPeriodic` / manual) | |
| `lead_id`, `client_id`, `RM`, `TL`, `project`, `region`, `client` | text | identity + routing copy | **`project_region` is NOT here** — root of the reduced Loan override (`GS-008` FN-225) |
| `lead_assigned_at`, `group_source`, `source_bucket`, `current_stage` | mixed | lifecycle + source copy | |
| `last_connect`, `last_connect_time`, `last_comment`, `internal_status_comments`, `closing_reason` | mixed | contact + comment copy | |
| `call_attempts`, `call_count`, `duration` | number | cumulative call figures at capture | |
| `stage_comments` | text | stage comment copy | |
| `rm_is_active`, `lead_closing_reason` | text | **appended 2026-09-01** — rows captured before then have neither column at all | for `backfillDailyRmIssuesFromMovementLog_` to reconstruct past SLA flags |

Exact list: `MovementTracker.gs` `SNAPSHOT_COLUMNS_` `#L105` (+
`snapshot_at`, `snapshot_label` prefixed).

## Writers

| Writer | Which `FN-XXX` | Mode |
|---|---|---|
| `GS-008` | `snapshotOpenLeads_` (FN-218) | append (4×/day) |
| `JS-018` | `browserSnapshotOpenLeads` (FN-121) | append (on demand) |
| `GS-008` | `pruneMovementLog_` (FN-220) | delete rows + shrink allocation |

## Readers

| Reader | Which `FN-XXX` | For |
|---|---|---|
| `JS-021` | `fetchMovementLog` (FN-140), `buildMovementHistories` (FN-141) | the `movementSnapshots` hub |
| `JS-008` | `reconstructRmPerformanceObservations` (FN-053) | RM performance |
| `JS-024` | cohort computes (FN-163/164) | 0–48h + daily cohorts |
| `GS-008` | `buildMovementLogMapsGs_` (FN-222) | baselines for the scheduled emails |
| `GS-003` | `backfillDailyRmIssuesFromMovementLog_` (FN-189) | rebuild past `Daily_RM_Issues` days |

## Automation / triggers touching it

`setupMovementTracking()`'s 4 `atHour([0,6,12,18])` triggers (write +
prune). Read by the 10:00/13:00/17:00/22:50 scheduled jobs. `TRIGGER`
detail: `GS-008` Trigger Schedule.

## Apps Script functions touching it

Write: `snapshotOpenLeads_`, `pruneMovementLog_`, `ensureMovementLogSheet_`
(`GS-008`). Read: `_readMovementLogRowsGs_`, `buildMovementLogMapsGs_`,
`_readMovementLogHistoryRowsGs_`, `buildTodayCallBaselineGs_`,
`lastSnapshotBeforeGs_` (`GS-008`); `backfill…` (`GS-003`).

## Data Lifecycle (DOC-019 — worked example, confirmed)

- **Data Type:** historical
- **Retention Period:** **7 days** (`MOVEMENT_LOG_RETENTION_DAYS`,
  `MovementTracker.gs` `#L80`) — one of the two confirmed retention
  values in the system
- **Enforced By:** `pruneMovementLog_` (`GS-008` FN-220) — runs after
  every capture
- **Archive / Delete Behavior:** old rows deleted in place; the sheet's
  row allocation is **shrunk in the same run** (`deleteRows`) to stay
  under the 10M-cell workbook ceiling
- **Sensitivity:** operational

*(This section is complete — `Movement_Log` is one of the two tabs
`DOC-032`/`DOC-036` already know for certain.)*

## Risks of changing this tab's structure

New columns must be **appended to `SNAPSHOT_COLUMNS_`, never inserted
mid-array** — `ensureMovementLogSheet_`'s self-healing header relies on
order (`LOGIC_AUDIT.md` Part 6 §6.3). The `JS-018` writer's schema must
be changed **in the same commit** or the two writers diverge
(`LOGIC_AUDIT.md` Part 4 §4.7). Reducing retention below what a consumer
needs (e.g. the 0–48h cohort needs ~2 days) breaks that consumer
silently.

## Relationships to other tabs

Snapshot of `SHEET-001` (`leads`). Feeds `SHEET-005` (`SLA_History`,
written in the same capture) and `SHEET-008` (`Daily_Cohort_History`,
guarded persist). `SHEET-003` (`Daily_RM_Issues`) can be *backfilled*
from it.

## Important logic / business rules

The two-writer schema-parity rule (`LOGIC_AUDIT.md` Part 4 §4.7); the
append-only column-order rule; the reduced Loan override
(`_effectiveRegionGs_`, `GS-008` FN-225) because `project_region` isn't
captured.

## Exceptions & error handling

A capture failure shows as Failed in Executions. `pruneMovementLog_`
uses a machine-clock-relative cutoff — the one date boundary in `GS-008`
not built through `istDayKeyGs_` (`LOGIC_AUDIT.md` Part 1 §4d, EXC-074).

## Related documentation

`HANDOVER.md` §2, §8; `LOGIC_AUDIT.md` Part 1 §4c/§4d, Part 4 §4.5/§4.7,
Part 6 §6.3; `OPS_CHECKLIST.md` (freshness).

## Relationships

- **Depends On:** `SHEET-001` (`leads` — the snapshot source), `GS-008`,
  `JS-018` (the writers), `EXT-001`
- **Used By:** `JS-021`, `JS-008`, `JS-024`, `JS-023`, `JS-013`,
  `TAB-004`, `TAB-007`, `TAB-008`, `TAB-005`, `GS-001`, `GS-010`,
  `GS-003`, `SHEET-005`, `SHEET-008`
- **Related:** `SHEET-003` (backfillable from it)

## Source of truth

The live `Movement_Log` tab; schema defined by `SNAPSHOT_COLUMNS_`
(`MovementTracker.gs`) and mirrored in `js/sheets-writeback.js`.

## Validation

- **Method:** column list read from `SNAPSHOT_COLUMNS_` `#L105` at
  `c82ec67`; two-writer parity confirmed by `Tests_MovementTracker.gs` +
  the `LOGIC_AUDIT.md` Part 4 §4.7 diff; retention read from
  `MOVEMENT_LOG_RETENTION_DAYS`.
- **Evidence:** `LOGIC_AUDIT.md` Part 4 §4.7; `.github/workflows/test.yml`
  (`Tests_MovementTracker.gs`, last green run).
- **Status:** Validated 2026-09-10 (**including** lifecycle — this tab is
  a confirmed worked example).

## Version / change reference

Verified at `c82ec67`; record created by `DOC-032`.

## Revalidation trigger

`SNAPSHOT_COLUMNS_` changes (must be appended, and matched on the
`js/sheets-writeback.js` side); `MOVEMENT_LOG_RETENTION_DAYS` changes;
the capture cadence changes; a new reader/writer is added.

## Handover relationship

`HANDOVER.md` §2 covers the tab and its 7-day retention; §8 has the
missing-capture incidents. Current as of 2026-09-09. A schema/retention
change must update `HANDOVER.md` §2 and both writers in the same commit.

## Lifecycle / retention

**7 days**, enforced by `pruneMovementLog_` (`GS-008`). Confirmed, not
`TBD`.

## Next action

none — Closed + Monitored (lifecycle already complete).

## Closure evidence

Record committed for `DOC-032`; `docs/INDEX.md` `SHEET-002` → `Closed +
Monitored`, `Last Verified` 2026-09-10; column list + retention sourced
from `MovementTracker.gs`, not approximated; the Data Lifecycle section
is fully filled (this tab is a `DOC-032` exception — its retention was
already confirmed).
