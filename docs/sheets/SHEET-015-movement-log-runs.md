# SHEET-015 — Movement_Log_Runs

| | |
|---|---|
| **Type** | `SHEET-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | Google Sheet, tab `Movement_Log_Runs` |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-17 against commit `641398e` |

## Purpose / reason to exist

Content-hash dedup (Phase 6 of the Lead History & Versioning Review) means
an unchanged lead no longer gets a new `Movement_Log` row on every capture
— so `Movement_Log`'s own last row stopped being a reliable "did a capture
run happen" signal (it would read as increasingly stale on a perfectly
healthy system with few real changes). `Movement_Log_Runs` exists purely
to answer that one question: one row per capture RUN, regardless of how
many leads' content actually changed, decoupled on purpose from
`Movement_Log`'s per-lead rows. Mirrors the target design's
`lead_ingestion_runs` table (`docs/_planning/DB_ARCHITECTURE_REVIEW.md`)
as closely as a Sheets tab reasonably can.

## Data stored

One row per snapshot run: `run_at`, `run_label`, `lead_count_seen`,
`leads_changed`. Apps Script has no real transactions, so there is no
separate `completed_at` column — a run either finishes and this row gets
written, or it throws and nothing after that point runs at all (including
this write); the row's mere existence is the "completed" signal, not a
nullable flag on it.

## Source of the data

Written by **two independent writers with an identical schema** — the
same two-writer pattern as `Movement_Log` itself (`SHEET-002`):
`GS-008` (`MovementTracker.gs`'s `snapshotOpenLeads_`, the 4×/day
trigger) and `JS-018` (`sheets-writeback.js`'s `browserSnapshotOpenLeads`,
the on-demand "Snapshot now" button, via constants mirrored in `JS-021`).
Both write at the end of their respective `Movement_Log` capture, after
the prune — so each reads `Movement_Log`'s true post-prune retained range
rather than a stale about-to-be-trimmed one. Both wrap the write in a
`try/catch` (same "can never block the core `Movement_Log` capture"
pattern as the `SLA_History`/`Unmatched_Comments_Log` writes) — a write
failure here logs and moves on, it never fails the capture itself.

## Destination / consumers

`GS-008`'s own `checkMovementLogFreshness_` (console-callable wrapper:
`checkMovementLogFreshnessNow()`) — reads this tab's last row, not
`Movement_Log`'s, specifically because it stays a correct freshness
signal even when nothing changed on a given run. No browser-side reader
exists yet — `JS-018`/`JS-021` only write.

## Columns / fields

| Column | Type | Meaning | Notes |
|---|---|---|---|
| `run_at` | datetime | capture instant | same clock as `Movement_Log.snapshot_at` |
| `run_label` | text | the run label (`snapshotPeriodic` / manual) | |
| `lead_count_seen` | number | total open leads read this run | denominator for `leads_changed` |
| `leads_changed` | number | how many got a new `Movement_Log` row this run | 0 on a fully-idempotent run — expected, not an error |

Exact list: `MovementTracker.gs` `MOVEMENT_LOG_RUNS_COLUMNS_` `#L177`.

## Writers

| Writer | Which `FN-XXX` | Mode |
|---|---|---|
| `GS-008` | `snapshotOpenLeads_` (end of run, after prune) | append (4×/day trigger) |
| `GS-008` | `ensureMovementLogRunsSheet_` | creates tab + header on first use |
| `JS-018` | `browserSnapshotOpenLeads` (FN-121, via `appendSheetRows`) | append (on-demand "Snapshot now") |

## Readers

| Reader | Which `FN-XXX` | For |
|---|---|---|
| `GS-008` | `checkMovementLogFreshness_` / `checkMovementLogFreshnessNow` | freshness check (console-callable, also backs `OpsChecklistRunner.gs`'s weekly check) |

## Automation / triggers touching it

Written at the tail of the same 4× `atHour([0,6,12,18])` triggers that
write `Movement_Log` (`setupMovementTracking()`), and also at the tail of
the on-demand "Snapshot now" button (`JS-018`, no trigger — a user
click). No trigger reads it directly — `checkMovementLogFreshnessNow` is
manual/console, though `OpsChecklistRunner.gs`'s Monday weekly summary
calls the same `checkMovementLogFreshness_` underneath.

## Data Lifecycle

- **Data Type:** operational/diagnostic
- **Retention Period:** none enforced — this tab is NOT pruned by
  `pruneMovementLog_` (that only touches `Movement_Log` itself); it grows
  by 4 rows/day indefinitely. Small enough (4 columns, ~4 rows/day) that
  this hasn't been a problem, but it is unbounded — TBD whether it needs
  its own retention policy.
- **Enforced By:** n/a
- **Sensitivity:** operational — no PII, just counts and timestamps

## Sensitivity & operational importance (DOC-038)

- **Operational importance:** MEDIUM — if this tab breaks/goes missing,
  `checkMovementLogFreshnessNow` and `OpsChecklistRunner.gs`'s freshness
  check degrade to `'missing'`/unreadable status, but the actual
  `Movement_Log` capture itself is unaffected (the write is wrapped so a
  failure here can't block it).
- **Data sensitivity:** operational — no names, no lead identifiers, just
  run-level counts.

## Risks of changing this tab's structure

Columns must stay in `MOVEMENT_LOG_RUNS_COLUMNS_` order —
`ensureMovementLogRunsSheet_` writes the header directly from that array
on first creation only; an existing tab's header is never rewritten, so a
column reorder here would silently desync a live tab from a code change.
**Two-writer schema parity**: `GS-008`'s `MOVEMENT_LOG_RUNS_COLUMNS_` and
`JS-021`'s `MOVEMENT_LOG_RUNS_COLUMNS` must be changed **in the same
commit** — the same discipline `SHEET-002` documents for its own two
writers (`LOGIC_AUDIT.md` Part 4 §4.7) — or the two runtimes silently
disagree about this tab's shape.

## Relationships to other tabs

Sibling of `SHEET-002` (`Movement_Log`) — same capture cycle, same
writer (`GS-008`), deliberately independent row-count semantics (see
Purpose above).

## Important logic / business rules

The "existence of the row is the completion signal, not a flag" design
(no transactions in Apps Script); the "run happened" vs "a lead changed"
independence that motivated splitting this from `Movement_Log` in the
first place (Lead History & Versioning Review, Phase 2 finding).

## Exceptions & error handling

Write failure logs `'Movement_Log_Runs write failed (Movement_Log capture
continues): ' + e` and does not re-throw — the capture always completes
regardless of this tab's state.

## Related documentation

`HANDOVER.md` §2, §8 (`Movement_Log` freshness); `MovementTracker.gs`
`#L163-187` (definition), `#L1138-1186` (freshness check + console
wrapper); `docs/_planning/DB_ARCHITECTURE_REVIEW.md` (`lead_ingestion_runs`
target design this mirrors).

## Relationships

- **Depends On:** `GS-008`, `JS-018`, `JS-021`, `EXT-001`
- **Used By:** `GS-008`, `JS-018`, `JS-021`, `TAB-007` (documents the
  write as part of its own Snapshot-now button)
- **Related:** `SHEET-002` (sibling, same capture cycle, same two-writer
  pattern)

## Source of truth

The live `Movement_Log_Runs` tab; schema defined by
`MOVEMENT_LOG_RUNS_COLUMNS_` (`MovementTracker.gs`).

## Validation

- **Method:** column list and read/write sites read directly from
  `MovementTracker.gs` source (`MOVEMENT_LOG_RUNS_SHEET_`,
  `MOVEMENT_LOG_RUNS_COLUMNS_`, `ensureMovementLogRunsSheet_`,
  `checkMovementLogFreshness_`) and, once the record's initial write-up
  had missed it, `js/sheets-writeback.js` (`browserSnapshotOpenLeads`)
  and `js/tab-movement.js` (`MOVEMENT_LOG_RUNS_TAB_NAME`/
  `MOVEMENT_LOG_RUNS_COLUMNS`) — the second, on-demand writer, confirmed
  same-day against commit `641398e`'s own diff.
- **Evidence:** source line citations above; commit `641398e`.
- **Status:** Validated 2026-09-17. This record closes the gap flagged by
  `test/check-catalog.py` check L ("untracked Sheet tab: 'Movement_Log_Runs'
  referenced in MovementTracker.gs:176 but no docs/sheets/ record
  declares it") — the tab predates this record (added in the Lead History
  & Versioning Review's Phase 6, before this record existed), it was never
  undocumented functionality, just an undocumented one.

## Version / change reference

Record created 2026-09-17, closing a gap found by `check-catalog.py`
check L. Tab itself introduced by the Lead History & Versioning Review,
Phase 6 (`641398e`, predates this record). Same-day correction: the
record's first write-up only named `GS-008` as a writer; `JS-018`/`JS-021`
(the on-demand browser writer) added once found while revalidating those
records' own drift.

## Revalidation trigger

`MOVEMENT_LOG_RUNS_COLUMNS_` changes; the freshness-check grace window
(`MOVEMENT_LOG_FRESHNESS_GRACE_HOURS_`) changes; a new reader is added.

## Handover relationship

`HANDOVER.md` §2, §8. No dedicated entry needed beyond the freshness-check
mentions already there — this record is the first full write-up.

## Lifecycle / retention

None enforced (see Data Lifecycle above) — `TBD` whether this needs one.

## Next action

None for now — Closed + Monitored. Revisit if the tab's unbounded growth
ever becomes a real size concern (4 rows/day is trivial today).

## Closure evidence

Record created 2026-09-17 to close the `check-catalog.py` check L gap;
`docs/INDEX.md` `SHEET-015` added with `Depends On`/`Used By` reciprocal
to `GS-008`'s row. Same-day correction while revalidating `JS-018`/
`JS-021` (their own separate stale-doc revalidation): added `JS-018` as
a second writer and `JS-021` as the constants' owner, both now reciprocal
in `docs/INDEX.md` too.
