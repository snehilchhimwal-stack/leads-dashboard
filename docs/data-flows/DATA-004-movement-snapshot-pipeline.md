# DATA-004 — The Movement snapshot pipeline

| | |
|---|---|
| **Type** | `DATA-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | traced path — not a file |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

How the live leads become a periodic frozen history in `Movement_Log`,
and how 6+ downstream surfaces read that history. This is the flow that
lets the system answer questions about a *past* day after the live tab
has moved on.

## Origin

`SHEET-001` (`leads`) — every open lead, at capture time.

## Transformation

1. Open-lead filter: `isOpenLead_` (`GS-002` FN-183) / `isLeadClosed`
   (`JS-006` FN-041).
2. Per-lead field copy into the `SNAPSHOT_COLUMNS_` shape (`SHEET-002`
   CFG-050) + `computeSlaFlags_` (`GS-012`) for the flag columns.
3. **Two independent writers, identical schema** (`LOGIC_AUDIT.md` Part 4
   §4.7): `snapshotOpenLeads_` (`GS-008` FN-218, 4×/day) and
   `browserSnapshotOpenLeads` (`JS-018` FN-121, on-demand `BTN-014`).
4. Prune to 7 days + shrink allocation: `pruneMovementLog_` (`GS-008`
   FN-220).
5. Browser read + history build: `fetchMovementLog` → `movementSnapshots`
   → `buildMovementHistories` / `enrichSnapshotCached` (`JS-021` FN-140/141).

## Stored As

`SHEET-002` (`Movement_Log`) — the raw 7-day history. Derived, longer-lived
rows: `SHEET-005` (`SLA_History`, written in the same capture) and
`SHEET-008` (`Daily_Cohort_History`, guarded persist — never re-writes an
archived date). Browser: `movementSnapshots` (state).

## Display

`TAB-007` Movement (Stalled Leads, RM Stall Leaderboard,
Time-to-Opportunity, Unmatched Comments, Overnight cohort); `TAB-004`
Repeat Offenders (via `JS-008` / `JS-017` / `JS-013`); `TAB-008` Tracking
(cohorts + trend, via `SLA_History` / `Daily_Cohort_History`); `TAB-005`
RM Timeline (calendar + trend chart).

## Ultimate consumer(s)

A human reviewing stalls / cohort outcomes / RM performance; the
scheduled emails' `underCalledToday` baseline (`buildMovementLogMapsGs_`,
`GS-008` FN-222 → `GS-001` / `GS-010`); `DailyRmIssueLog.gs`'s backfill.

## Retention

`SHEET-002` (`Movement_Log`) — **7 days** (`MOVEMENT_LOG_RETENTION_DAYS`,
confirmed). The derived archives outlive it on purpose: `SHEET-005`
(`TBD`, `DOC-036`), `SHEET-008` (`TBD`, immutable-once-complete,
`DOC-036`).

## What happens on update

A lead's state change is captured at the **next** snapshot (next
trigger, or a manual "Snapshot now"). Browser consumers see it after the
next `fetchMovementLog`. A day's cohort row, once `window_complete`, is
**never** re-derived (`SHEET-008` `RULE-029`).

## What happens on delete

A deleted lead simply stops being snapshotted. Its existing
`Movement_Log` rows age out within 7 days; its `SLA_History` /
`Daily_Cohort_History` contributions are point-in-time and remain.

## Known gaps

- **`project_region` is not in `SNAPSHOT_COLUMNS_`** — so any
  `Movement_Log`-derived Loan detection uses `group_source` only (`GS-008`
  FN-225 `_effectiveRegionGs_`; `JS-008` `RULE-016`). This is the
  reduced Loan override — consistent between the two Movement paths
  (`LOGIC_AUDIT.md` Part 4 §4.5) but narrower than the live-tab flow.
- `pruneMovementLog_`'s cutoff is machine-clock-relative — the one date
  boundary in `GS-008` not via `istDayKeyGs_` (`LOGIC_AUDIT.md` Part 1
  §4d, EXC-074) — functionally fine, inconsistent.
- Reducing retention below a consumer's need (the 0–48h cohort needs
  ~2 days) breaks that consumer silently.

## Exceptions & error handling

Each side-effect in `snapshotOpenLeads_` is independently
try/catch-wrapped so one failing never blocks the core capture (`GS-008`
EXC-072). A failed `Movement_Log` read fails *safe* — dependent tabs show
"not loaded," not stale data (`JS-021` EXC-043). `browserSnapshotOpenLeads`
has **no reentrancy guard** (`JS-018` EXC-034 / `LOGIC_AUDIT.md` Part 7
§18 MEDIUM #1).

## Architecture relationship

The Apps Script backend (write) + `DASH-001` (read + the on-demand
write). `LOGIC_AUDIT.md` Part 1 §1 layers 3, 11, 17; Part 7 diagram G.

## Related documentation

`HANDOVER.md` §2, §3 step 5, §8; `OPS_CHECKLIST.md` (freshness);
`LOGIC_AUDIT.md` Part 1 §4c/§4d, Part 2 §4, Part 4 §4.5/§4.7, Part 7
§18 MEDIUM #1.

## Relationships

- **Depends On:** `JS-018`, `JS-021`, `GS-002`, `GS-008`, `GS-012`,
  `SHEET-001`, `SHEET-002`, `EXT-001`
- **Used By:** `TAB-004`, `JS-008`, `GS-001`, `SHEET-005`, `SHEET-008`,
  `DATA-002` (aggregates this history)
- **Related:** `DATA-001` (the in-memory counterpart — same source, not
  persisted)

## Source of truth

`MovementTracker.gs` `snapshotOpenLeads_` `#L365` + `SNAPSHOT_COLUMNS_`
`#L105`; `js/sheets-writeback.js` `browserSnapshotOpenLeads` `#L809`;
`js/tab-movement.js` `fetchMovementLog` `#L138`.

## Validation

- **Method:** traced against `LOGIC_AUDIT.md` Part 2 §4 + Part 4 §4.5/§4.7
  (the two-writer schema-parity proof) + Part 7 diagram G at `c82ec67`.
  `Tests_MovementTracker.gs` asserts schema parity + the never-re-archive
  rule; `tests/frontend-harness.html` mocks the `Movement_Log` read.
- **Evidence:** `LOGIC_AUDIT.md` Part 4 §4.7; `.github/workflows/test.yml`
  (`Tests_MovementTracker.gs`, last green); `tests/frontend-harness.html`.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by `DOC-034`.

## Revalidation trigger

`SNAPSHOT_COLUMNS_` changes (both writers); `MOVEMENT_LOG_RETENTION_DAYS`
changes; the capture cadence changes; a new consumer starts reading
`movementSnapshots`; `SHEET-005` / `SHEET-008` columns change.

## Handover relationship

`HANDOVER.md` §2/§3 step 5/§8 cover the flow. Current as of 2026-09-09. A
schema/retention change must update `HANDOVER.md` §2 and both writers in
the same commit.

## Lifecycle / retention

`Movement_Log` 7 days (confirmed). Derived archives: `SHEET-005` /
`SHEET-008` (`TBD`, `DOC-036`).

## Next action

none — Closed + Monitored. (The `project_region` gap and the snapshot
reentrancy are known findings tracked on `SHEET-002` / `JS-018`.)

## Closure evidence

Record committed for `DOC-034`; `docs/INDEX.md` `DATA-004` row →
`Closed + Monitored`; `Depends On` resolves entirely to existing IDs. No
`docs/changes/` record (`DOC-034`).
