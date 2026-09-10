# SHEET-005 — SLA_History

| | |
|---|---|
| **Type** | `SHEET-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | Google Sheet, tab `SLA_History` |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

A long-lived time series of SLA totals — one row per snapshot run
recording how many leads were open and how many were breaching each of
the 5 checks. It exists **because `Movement_Log` is only 7 days**:
`SLA_History` keeps the aggregate trend after the raw snapshots it was
derived from have been pruned, so the Tracking tab's issue-count-over-time
chart can go back further than a week.

## Reason to exist

To retain the SLA *trend* past `Movement_Log`'s 7-day window — an
aggregate that is cheap to keep forever where the raw rows are not.

## Data stored

One row per snapshot: the run date/time, open + breached totals, and a
per-check breached count.

## Source of the data

`GS-008` `writeSlaHistorySnapshot_` (in the same 4×/day capture as
`Movement_Log`) and `JS-018` `upsertSlaHistoryRows` /
`backfillSlaHistoryFromMovementLog` (dashboard, keyed by `snapshot_at`,
never duplicates). Cleared by `JS-004` `clearSlaHistory` (`BTN-020`).

## Destination / consumers

`js/tab-tracking.js` (`JS-024`) — the issue-count-over-time chart and
cohort comparisons (`TAB-008`).

## Columns / fields

| Column | Type | Meaning |
|---|---|---|
| `date` | date | the run's IST day |
| `openTotal` / `breachedTotal` | number | open + total-breached counts |
| `inactiveRmNewLead` / `isNotUpdated` / `followupOverdue` / `underCalledToday` / `stageStuck48h` | number | per-check breached counts |
| `snapshot_at` | datetime | the run instant — **the upsert key** |
| `source` | text | which writer produced the row (`movement` / `browser` / `backfill`) |

Exact list: `MovementTracker.gs` `SLA_HISTORY_COLUMNS_` `#L185`.

## Writers

| Writer | `FN-XXX` | Mode |
|---|---|---|
| `GS-008` | `writeSlaHistorySnapshot_` (FN-221) | append (4×/day) |
| `JS-018` | `upsertSlaHistoryRows` (FN-128) | upsert by `snapshot_at` (`RAW`) |
| `JS-018` | `backfillSlaHistoryFromMovementLog` (FN-128) | upsert (`BTN-019`) |
| `JS-018` | `sortSlaHistorySheet_` (FN-128) | in-place sort |
| `JS-004` | `clearSlaHistory` (FN-025) | **delete all rows** (`BTN-020`, irreversible) |

## Readers

| Reader | `FN-XXX` | For |
|---|---|---|
| `JS-024` | `renderTrackingTab` / chart builders (FN-165/166) | the trend chart |
| `TAB-008` | — | displays it |

## Automation / triggers touching it

Written every `Movement_Log` capture (`GS-008`, 4×/day). No trigger of
its own.

## Apps Script functions touching it

`ensureSlaHistorySheet_`, `writeSlaHistorySnapshot_` (`GS-008`).

## Data Lifecycle (DOC-019 — completed by `DOC-036`, 2026-09-10)

- **Data Type:** historical (aggregate).
- **Retention Period:** **`TBD` — no pruning function found.** grep at
  `9cafa68`: the only `prune*_` functions are `pruneMovementLog_` /
  `pruneDailyRmIssueLog_`; neither touches `SLA_History`. It is
  **explicitly not 7-day** (it exists *because* `Movement_Log` is
  short-lived) — but "keep indefinitely" is not stated anywhere, so the
  honest answer is `TBD`, not "unbounded by design". Feeds `DOC-037`
  (growth: ~4 rows/day, low risk).
- **Enforced By:** `None`. `clearSlaHistory` (`JS-004` FN-025, `BTN-020`)
  is a manual all-or-nothing wipe, not a retention policy.
- **Archive / Delete Behavior:** grows unbounded in practice; only the
  manual clear removes rows.
- **Sensitivity:** operational (counts only, no PII). `DOC-038` for the
  operational-importance classification (read by `TAB-008` only; no
  backend job depends on it).

## Sensitivity & operational importance (DOC-038)

- **Operational importance:** **LOW** — display / audit-trail only — no automated dependency; losing it loses history, nothing stops working.
- **Data sensitivity:** operational — counts only, no PII.
- **Reason:** Read only by the dashboard's Tracking tab (`JS-024`); no automated dependency. Losing it loses the long-run SLA trend chart — nothing else breaks.

## Risks of changing this tab's structure

The two writers (`GS-008` + `JS-018`) share this schema and must be
changed together (`LOGIC_AUDIT.md` Part 4 §4.7 confirms current parity).
The `snapshot_at` upsert key is what makes backfill idempotent — moving
or renaming it breaks re-runnability. `RAW` value-input is deliberate
(stops Sheets date→serial coercion).

## Relationships to other tabs

Derived from `SHEET-002` (`Movement_Log`) at capture time and
backfillable from it. Read alongside `SHEET-008`
(`Daily_Cohort_History`) by the Tracking tab.

## Important logic / business rules

Upsert by `snapshot_at` (never duplicates); `RAW` value-input; the
per-check columns mirror the 5 SLA flags from `computeSlaFlags_`
(`GS-012`) / `enrichLead` (`JS-006`).

## Exceptions & error handling

A partial write is re-runnable (upsert). `clearSlaHistory` can leave
partial deletion, surfaced in the admin status line (`JS-004` EXC-008).

## Related documentation

`HANDOVER.md` §2, §5; `LOGIC_AUDIT.md` Part 1 §4c/§4d, Part 4 §4.7.

## Relationships

- **Depends On:** `JS-018`, `GS-008`, `SHEET-002` (`Movement_Log`),
  `EXT-001`, `DATA-002`, `DATA-004`
- **Used By:** `TAB-008`, `JS-004`, `JS-018`, `JS-024`, `GS-008`
- **Related:** `SHEET-008` (`Daily_Cohort_History` — the sibling
  long-lived archive)

## Source of truth

The live `SLA_History` tab; schema `SLA_HISTORY_COLUMNS_`
(`MovementTracker.gs`), mirrored in `js/sheets-writeback.js`.

## Validation

- **Method:** column list read from `SLA_HISTORY_COLUMNS_` `#L185` at
  `c82ec67`; two-writer parity per `LOGIC_AUDIT.md` Part 4 §4.7;
  `Tests_MovementTracker.gs` asserts the header. `tests/frontend-harness.html`
  exercises `upsertSlaHistoryRows` (write boundary mocked).
- **Evidence:** `LOGIC_AUDIT.md` Part 4 §4.7; `.github/workflows/test.yml`.
- **Status:** Validated 2026-09-10 (non-lifecycle); lifecycle `TBD`
  (`DOC-036`).

## Version / change reference

Verified at `c82ec67`; record created by `DOC-032`.

## Revalidation trigger

`SLA_HISTORY_COLUMNS_` changes (both writers); a prune/retention policy
is added; the `snapshot_at` upsert key changes; a new reader is added.

## Handover relationship

`HANDOVER.md` §2/§5 cover it. Current as of 2026-09-09. A schema or
retention-policy change must update `HANDOVER.md` §5 and both writers.

## Lifecycle / retention

`TBD` — deferred to `DOC-036`. Currently **unbounded** (no prune);
`DOC-036` confirms whether that is intentional.

## Next action

`DOC-036` — decide/record the retention policy for this long-lived
aggregate.

## Closure evidence

Record committed for `DOC-032`; `docs/INDEX.md` `SHEET-005` → `Closed +
Monitored` (non-lifecycle scope), `Last Verified` 2026-09-10; columns
sourced from `SLA_HISTORY_COLUMNS_`, not approximated; Data Lifecycle
`TBD` per `DOC-032` boundary.
