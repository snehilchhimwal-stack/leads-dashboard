# FLOW-001 — Movement snapshot hub + piggyback loggers

| | |
|---|---|
| **Type** | `FLOW-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `docs/architecture/FLOW-001-movement-hub.md` (an overlay — no code file of its own) |
| **Owner** | Snehil (default) |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

The dashboard is client-only and needs a human present. Four things must
happen unattended, on a clock: an open-leads snapshot for movement/stall
tracking, an SLA-history row for trend views, a comment-history capture,
and an unmatched-comment capture for keyword-rule tuning. Rather than four
separate triggers (four clocks that can drift apart, four cold starts),
they run as **one hub**: `MovementTracker.gs`'s 4×/day trigger fires
`snapshotOpenLeads_`, and the other three loggers **piggyback** on that
same pass so they see exactly the same set of leads at exactly the same
instant.

## Reason to exist

One trigger, one lead set, one timestamp — so `Movement_Log`,
`SLA_History`, `Comment_History` and `Unmatched_Comments_Log` can never
disagree about "what was true at 06:00 today". Separate triggers could
capture slightly different lead sets seconds apart and make the
cross-tab joins lie.

## Participants (in execution order)

| Step | Component (`ID`) | What it does here |
|---|---|---|
| 1 | `TRIGGER` (see `apps-script-triggers.md`) | 4 `atHour(h).everyDays(1).inTimezone('Asia/Kolkata')` IST triggers, `h` ∈ `SNAPSHOT_HOURS_ = [0,6,12,18]` → `snapshotPeriodic` → `snapshotOpenLeads_` |
| 2 | `GS-008` `MovementTracker.gs` | `snapshotOpenLeads_` reads the `leads` tab (`SHEET-001`), classifies via `Core.gs` + `SlaEngine.gs`, writes one `Movement_Log` (`SHEET-002`) row per open lead |
| 3 | `GS-008` | in the **same** pass writes the matching `SLA_History` (`SHEET-005`) rows (two-writer schema-parity rule, `LOGIC_AUDIT.md` Part 4 §4.7) and, guarded, `Daily_Cohort_History` (`SHEET-008`) |
| 4 | `GS-006` `InteractionHistoryLogger.gs` | piggyback — appends new comment rows to `Comment_History` (`SHEET-009`) for the same lead set |
| 5 | `GS-013` `UnmatchedCommentLogger.gs` | piggyback — `scanUnmatchedCommentsGs_` appends any RM comment the classification keywords missed to `Unmatched_Comments_Log` (`SHEET-010`) |
| — | `JS-018` `sheets-writeback.js` | the **browser** on-demand path (`#snapshotNowBtn` → `browserSnapshotOpenLeads`) writes the same `Movement_Log` / `SLA_History` shape, so a human can force a capture between triggers |

## Inputs / Outputs

- **Triggered by:** the 4 daily IST time triggers (or the dashboard's
  Snapshot-now button).
- **Produces:** `Movement_Log` + `SLA_History` rows (always);
  `Daily_Cohort_History` (guarded); `Comment_History` +
  `Unmatched_Comments_Log` appends (piggyback).

## Data lineage

`SHEET-001` (`leads`) → `snapshotOpenLeads_` (`GS-008`) → `SHEET-002` /
`SHEET-005` / `SHEET-008`; the same lead set → `GS-006` → `SHEET-009`
and `GS-013` → `SHEET-010`. Per-component detail: those records +
`DATA-004` (the Movement snapshot pipeline as pure lineage).

## Business rules — `RULE-XXX` list

Applied by the participants, not restated here: the two-writer
schema-parity rule (`SHEET-002` / `GS-008`), the reduced Loan-region
override `_effectiveRegionGs_` (`GS-008`, because `project_region` isn't
captured — the HIGH finding, see `DATA-005`), the machine-clock-relative
prune cutoff `pruneMovementLog_` (`SHEET-002` `EXC-074`), the 7-day
retention on `Movement_Log`.

## Exceptions & failure behaviour

- A whole pass failing shows as **Failed** in the Apps Script Executions
  log; the next scheduled pass self-heals (a missed day is tolerated —
  `MovementTracker.gs` comment, ~`#L536`).
- A **piggyback** logger throwing does **not** abort the snapshot — the
  loggers are best-effort; `snapshotOpenLeads_` completes its own writes
  first.
- `pruneMovementLog_` uses a machine-clock-relative cutoff — the one date
  boundary in `GS-008` not built through `istDayKeyGs_` (`LOGIC_AUDIT.md`
  Part 1 §4d).

## Known limitations

- `LOGIC_AUDIT.md` Part 4 §4.4 / Part 7 §18 (HIGH): the Loan-region
  override on this path has no working `.gs` twin of the client
  `effectiveRegion` logic — Loan leads can be attributed to the wrong
  region in `Movement_Log`.
- The 10M-cell workbook ceiling: `Movement_Log` (~5.6M cells) +
  `Daily_RM_Issues` (~2.4M) ≈ 8M of 10M — this hub is the largest
  contributor (`DailyRmIssueLog.gs` `#L69-72`).

## Related documentation

`HANDOVER.md` §2, §5, §8; `LOGIC_AUDIT.md` Part 1 §1/§4c/§4d, Part 4
§4.5/§4.7; `OPS_CHECKLIST.md` (Movement_Log freshness); `RELATIONSHIP_MAP.md`
§1 (the 4 state hubs) + §3.

## Relationships

- **Depends On:** `GS-006`, `GS-008`, `GS-013`, `JS-018`, `SHEET-001`,
  `SHEET-002`, `SHEET-005`, `SHEET-008`, `SHEET-009`, `SHEET-010`
- **Used By:** `none` — an architecture overlay; nothing in the catalog
  *depends on* a `FLOW-`. Its participants carry their own reciprocal
  `Depends On` / `Used By` in the component graph (`INDEX.md`).
- **Related:** `DATA-004` (same path, traced as pure data lineage),
  `FLOW-002` (the other scheduled multi-component workflow).

## Source of truth

`MovementTracker.gs` `snapshotOpenLeads_`; `InteractionHistoryLogger.gs`;
`UnmatchedCommentLogger.gs` `scanUnmatchedCommentsGs_`;
`js/sheets-writeback.js` `browserSnapshotOpenLeads`. All at `HEAD`.

## Validation

- **Method:** traced against `LOGIC_AUDIT.md` Part 4 §4.5/§4.7 + the
  `GS-006` / `GS-008` / `GS-013` records at `c82ec67`;
  `Tests_MovementTracker.gs` covers the two-writer parity.
- **Evidence:** `docs/validation/README.md` (`SHEET-002` retention row +
  the `GS-` records); `.github/workflows/test.yml` last green run.
- **Status:** Validated 2026-09-10.

## Version / change reference

Record created by `t-tf-5ad22d8e4c2e` (2026-09-10), forensic-audit P2
item 10. Verified against code at `c82ec67`.

## Revalidation trigger

Any participant record (`GS-006` / `GS-008` / `GS-013` / `JS-018` / any of
the 5 `SHEET-`) goes `Stale`; the `[0,6,12,18]` trigger schedule changes;
a new piggyback logger is added to `snapshotOpenLeads_`;
`SNAPSHOT_COLUMNS_` / `SLA_HISTORY_COLUMNS_` change.

## Handover relationship

`HANDOVER.md` §2 and §5 describe the trigger and the tabs; §1–§3 remain
the living-architecture authority until this `architecture/` folder takes
that role over (Governance Model / `CONSOLIDATED`). Current as of
2026-09-10.

## Lifecycle / retention

N/A — an overlay. The tabs it writes carry their own retention
(`SHEET-002` / `SHEET-003` = 7d; the rest `TBD`, `DOC-037`).

## Next action

none — Closed + Monitored.

## Closure evidence

Record committed for `t-tf-5ad22d8e4c2e`; `INDEX.md` `FLOW-001` row added;
`Depends On` resolves entirely to existing `GS-`/`JS-`/`SHEET-` IDs
(`check-catalog.py` A verifies no dangling).
