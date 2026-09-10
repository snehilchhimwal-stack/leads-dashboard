# SHEET-008 — Daily_Cohort_History

| | |
|---|---|
| **Type** | `SHEET-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | Google Sheet, tab `Daily_Cohort_History` |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

The permanent archive of each day's cohort outcome per region — how many
leads came in, how many were resolved / became opportunities same-day
and by 48h. It exists **because `Movement_Log` is only 7 days**: once a
day's raw snapshots are pruned, its cohort outcome can no longer be
re-derived correctly, so it must be frozen here **once, and never
re-written**. This is what makes the Tracking tab's Week-over-Week and
historical cohort views trustworthy.

## Reason to exist

To retain cohort-correct daily outcomes past the 7-day raw window —
`persistDailyCohortHistory` writes a day's row once the day is "window
complete" and then treats it as immutable.

## Data stored

One row per (date × region): `created`, same-day and 48h resolution /
opportunity / closed counts, a `window_complete` flag, `updated_at`, and
the writing `source`.

## Source of the data

**Two writers, identical schema** (`MovementTracker.gs` `#L559` comment:
"Must exactly match `DAILY_COHORT_HISTORY_COLUMNS` in
`js/sheets-writeback.js`"): `GS-008` `persistDailyCohortHistoryGs_` (in
the 4×/day capture) and `JS-018` `upsertDailyCohortHistoryRows` /
`backfillDailyCohortHistoryFromMovementLog` (`BTN-021`). Cleared by
`JS-024` (`BTN-022`).

## Destination / consumers

`js/tab-tracking.js` (`JS-024`) — Daily Cohort by Region + Week-over-Week
(`TAB-008`).

## Columns / fields

| Column | Type | Meaning |
|---|---|---|
| `date_region` | text | `date` + `region` — the upsert key |
| `date` / `region` | date / text | the cohort day + region |
| `created` | number | leads that entered the cohort that day |
| `same_day_resolved` / `same_day_opp` | number | same-day outcomes |
| `window_complete` | bool-ish | is the 48h window closed (→ row is now immutable) |
| `resolved_48h` / `opp_48h` / `closed_48h` | number | 48h outcomes |
| `updated_at` | datetime | last write |
| `source` | text | `movement` / `browser` / `backfill` |

Exact list: `MovementTracker.gs` `DAILY_COHORT_HISTORY_COLUMNS_` `#L561`
== `js/sheets-writeback.js` `DAILY_COHORT_HISTORY_COLUMNS` `#L472`.

## Writers

| Writer | `FN-XXX` | Mode |
|---|---|---|
| `GS-008` | `persistDailyCohortHistoryGs_` / `upsertDailyCohortHistoryRowsGs_` (FN-223) | upsert by `date_region`; **never re-writes an archived date** |
| `JS-018` | `upsertDailyCohortHistoryRows` (FN-129) | upsert (`RAW`); same rule |
| `JS-018` | `backfillDailyCohortHistoryFromMovementLog` (FN-129) | backfill (`BTN-021`) |
| `JS-024` | clear handler | delete all rows (`BTN-022`, irreversible) |

## Readers

| Reader | `FN-XXX` | For |
|---|---|---|
| `JS-024` | `renderDailyCohortByRegion` / `computeWeekOverWeekCohort` (FN-168/172) | the cohort tables |
| `JS-018` | `fetchDailyCohortHistoryForDate` / `fetchAllDailyCohortHistoryRows` (FN-129) | supply archived days to `JS-024` |

## Automation / triggers touching it

Written every `Movement_Log` capture (`GS-008`, guarded). No trigger of
its own.

## Apps Script functions touching it

`persistDailyCohortHistoryGs_`, `computeDailyCohortByRegionGs_`,
`eligibleDailyCohortDatesGs_`, `_readArchivedDailyCohortDatesGs_`,
`ensureDailyCohortHistorySheetGs_` (`GS-008`).

## Data Lifecycle (DOC-019 — completed by `DOC-036`, 2026-09-10)

- **Data Type:** historical (permanent archive).
- **Retention Period:** **`TBD` — no pruning function found.** grep at
  `9cafa68`: no `prune*_` touches this tab. It is **explicitly not
  7-day** (it exists to *outlive* `Movement_Log`), and its rows are
  **immutable once `window_complete`** — but "keep indefinitely" is not
  stated in code, so the answer is `TBD`, not "unbounded by design".
  Feeds `DOC-037` (growth: ~11 regions/day, low risk).
- **Enforced By:** `None`. `clearDailyCohortHistory` (`JS-024`, `BTN-022`)
  is a manual all-or-nothing wipe.
- **Archive / Delete Behavior:** grows unbounded in practice; rows never
  re-derived once archived (`RULE-029`).
- **Sensitivity:** operational (per-region counts only, no PII).
  `DOC-038` for the operational-importance classification (read by
  `TAB-008` only; no backend job depends on it).

## Sensitivity & operational importance (DOC-038)

- **Operational importance:** **LOW** — display / audit-trail only — no automated dependency; losing it loses history, nothing stops working.
- **Data sensitivity:** operational — per-region counts only, no PII.
- **Reason:** Read only by the dashboard's Tracking tab (`JS-024`); no automated dependency. It is the permanent cohort archive — losing it loses long-term cohort history, but no live flow depends on it.

## Risks of changing this tab's structure

The two writers share this schema **verbatim** — the `.gs` file's own
comment mandates it. A column change on one side without the other
breaks parity (asserted in `Tests_MovementTracker.gs`). Anything that
re-writes an already-archived `date_region` **corrupts history** with
wrong late evidence — the never-re-archive rule is "not optional"
(`LOGIC_AUDIT.md` Part 1 §4c). `RAW` value-input is deliberate.

## Relationships to other tabs

Derived from `SHEET-002` (`Movement_Log`) while the raw days still exist;
read alongside `SHEET-005` (`SLA_History`) by the Tracking tab.

## Important logic / business rules

Never re-write an archived date (`JS-024` RULE-029 / `GS-008` FN-223);
`evidenceAtDeadline` / `_evidenceAtDeadlineGs_` as-of-deadline lookup;
the retention staleness guard that shows "NA" past the raw window
(`JS-024` RULE-030).

## Exceptions & error handling

A backfill for a date past the raw window that isn't archived → skipped,
"NA" shown (`JS-024` EXC-052). Partial write → re-runnable (upsert).

## Related documentation

`HANDOVER.md` §2, §5; `LOGIC_AUDIT.md` Part 1 §4c/§4d.

## Relationships

- **Depends On:** `JS-018`, `GS-008`, `SHEET-002` (`Movement_Log`),
  `EXT-001`, `DATA-004`
- **Used By:** `TAB-008`, `JS-018`, `JS-024`, `GS-008`
- **Related:** `SHEET-005` (`SLA_History` — the sibling long-lived
  archive)

## Source of truth

The live `Daily_Cohort_History` tab; schema
`DAILY_COHORT_HISTORY_COLUMNS_` (`MovementTracker.gs`) ==
`DAILY_COHORT_HISTORY_COLUMNS` (`js/sheets-writeback.js`).

## Validation

- **Method:** column list read from both constants at `c82ec67`
  (confirmed identical); schema-parity + never-re-archive asserted in
  `Tests_MovementTracker.gs`. `tests/frontend-harness.html` exercises
  `upsertDailyCohortHistoryRows` (write boundary mocked).
- **Evidence:** `LOGIC_AUDIT.md` Part 1 §4c/§4d;
  `.github/workflows/test.yml` (`Tests_MovementTracker.gs`, last green).
- **Status:** Validated 2026-09-10 (non-lifecycle); lifecycle `TBD`
  (`DOC-036`).

## Version / change reference

Verified at `c82ec67`; record created by `DOC-032`.

## Revalidation trigger

`DAILY_COHORT_HISTORY_COLUMNS_` / `DAILY_COHORT_HISTORY_COLUMNS` changes
(both writers); a prune policy is added; the never-re-archive rule
changes; a new reader is added.

## Handover relationship

`HANDOVER.md` §2/§5 cover it. Current as of 2026-09-09. A schema or
retention-policy change must update `HANDOVER.md` §5 and both writers.

## Lifecycle / retention

`TBD` — deferred to `DOC-036`. Currently **unbounded and immutable** (no
prune, no re-write); `DOC-036` confirms whether unbounded is intentional.

## Next action

`DOC-036` — decide/record the retention policy for this permanent
archive.

## Closure evidence

Record committed for `DOC-032`; `docs/INDEX.md` `SHEET-008` → `Closed +
Monitored` (non-lifecycle scope), `Last Verified` 2026-09-10; columns
sourced from the two matching constants, not approximated; Data Lifecycle
`TBD` per `DOC-032` boundary.
