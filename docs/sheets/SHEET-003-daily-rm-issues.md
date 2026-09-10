# SHEET-003 — Daily_RM_Issues

| | |
|---|---|
| **Type** | `SHEET-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | Google Sheet, tab `Daily_RM_Issues` |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

The nightly census of every open, SLA-flagged lead — the audit trail
behind the dashboard's Repeat Offenders tab (`TAB-004`). It exists so
"who is a repeat offender" is answered from a stored nightly record that
survives even when nobody opens the dashboard, and so the Repeat
Offenders ranking has a stable, filterable history to aggregate over.

## Reason to exist

`Movement_Log` (`SHEET-002`) is a raw 4×/day snapshot of *everything*;
`Daily_RM_Issues` is the once-a-night, SLA-flagged-only, filter-ready
distillation the Repeat Offenders leaderboard actually reads.

## Data stored

One row per (open lead × SLA issue) captured at 22:50 IST: the lead's
identity, RM/region/project/TL/source/bucket (for filter parity with the
rest of the dashboard), the `issue_key` / `issue_label`, the capture
timestamp, and `lead_assigned_at`.

## Source of the data

`GS-003` `captureDailyRmIssues_` (the 22:50 trigger), in chunked writes
(`BACKFILL_CHUNK_SIZE_ = 5000`). Backfillable from `Movement_Log` via
`backfillDailyRmIssuesFromMovementLog_` (`GS-003`).

## Destination / consumers

`js/tab-repeat-offenders.js` (`JS-022`) reads it for the RM / Region /
A1-TM / RH leaderboards (`TAB-004`).

## Columns / fields

| Column | Type | Meaning | Notes |
|---|---|---|---|
| `date` | date | the **capture** date | not the assignment date |
| `RM`, `region`, `project` | text | routing | |
| `lead_id`, `client_id` | text | identity | |
| `issue_key` / `issue_label` | text | the SLA issue (`isNotUpdated`, `Stuck 48h+`, …) | one row per issue |
| `captured_at` | datetime | capture instant | |
| `TL`, `group_source`, `source_bucket` | text | **appended 2026-09-01** for filter parity with the dashboard's top bar | rows before then lack these |
| `lead_assigned_at` | datetime | **appended 2026-09-01** — to tell "flagged tonight" from "assigned today" | |

Exact list: `DailyRmIssueLog.gs` `DAILY_RM_ISSUE_LOG_COLUMNS_` `#L39`.

## Writers

| Writer | Which `FN-XXX` | Mode |
|---|---|---|
| `GS-003` | `captureDailyRmIssues_` (FN-187) | append (chunked, 22:50) |
| `GS-003` | `backfillDailyRmIssuesFromMovementLog_` (FN-189) | append (recovery) |
| `GS-003` | `pruneDailyRmIssueLog_` (FN-188) | delete rows > 7 days |
| `GS-003` | `repairDailyRmIssuesMissingFieldsNow` (FN-189) | in-place field repair (manual) |

## Readers

| Reader | Which `FN-XXX` | For |
|---|---|---|
| `JS-022` | `fetchRmHierarchyForRollup` context / the tab render | the Repeat Offenders leaderboards |
| `TAB-004` | — | displays the aggregated ranking |

## Automation / triggers touching it

`setupDailyRmIssueLog()`'s `atHour(22).nearMinute(50)` trigger (write +
prune). `GS-003` Trigger Schedule.

## Apps Script functions touching it

Write: `captureDailyRmIssues_`, `backfillDailyRmIssuesFromMovementLog_`,
`backfillOneDayFromMovementLog_`, `pruneDailyRmIssueLog_`,
`ensureDailyRmIssueLogSheet_`, `repairDailyRmIssuesMissingFieldsNow`
(all `GS-003`).

## Data Lifecycle (DOC-019 — confirmed worked example; DOC-036 signed off 2026-09-10)

- **Data Type:** historical
- **Retention Period:** **7 days** (as of the 2026-09-07 fix)
- **Enforced By:** `pruneDailyRmIssueLog_` (`GS-003` FN-188), added
  2026-09-07 after a real cell-limit incident
- **Archive / Delete Behavior:** old rows deleted in place; row
  allocation shrunk
- **Sensitivity:** operational

*(Complete — this tab is the second confirmed worked example, per
`../_templates/sheet-template.md`.)*

## Sensitivity & operational importance (DOC-038)

- **Operational importance:** **IMPORTANT** — a live flow (dashboard feature or a degradable backend path) depends on it; no hard unattended-job failure.
- **Data sensitivity:** operational — SLA flags + identity, no free text.
- **Reason:** Only the dashboard's Repeat Offenders tab (`JS-022`) reads it; **no unattended job depends on it**. Breaking it degrades `TAB-004`; nothing stops sending or capturing.

## Risks of changing this tab's structure

New columns must be **appended, never inserted** —
`ensureDailyRmIssueLogSheet_` self-heals an older 9-column sheet by
appending the missing headers (same pattern as `Movement_Log`,
`LOGIC_AUDIT.md` Part 6 §6.3; asserted in `Tests_DailyRmIssueLog.gs`).
`JS-022` reads by header name, so a rename breaks the leaderboard's
filter parity.

## Relationships to other tabs

Distilled from `SHEET-001` (`leads`) nightly; backfillable from
`SHEET-002` (`Movement_Log`). Not fed by any other tab.

## Important logic / business rules

`captured_at`/`date` = capture time, not assignment time (why
`lead_assigned_at` was added). Chunked writes after the 2026-09-01
whole-night-silently-failed incident (`GS-003` EXC-060).

## Exceptions & error handling

A capture failure shows as Failed in Executions. The
`repairDailyRmIssuesMissingFieldsNow` function exists to backfill the
2026-09-01-added columns onto older rows.

## Related documentation

`HANDOVER.md` §2, §9; `LOGIC_AUDIT.md` Part 1 §4d, Part 3 §3.6;
`OPS_CHECKLIST.md`.

## Relationships

- **Depends On:** `SHEET-001` (`leads`), `SHEET-002` (`Movement_Log`,
  for backfill), `GS-003`, `EXT-001`
- **Used By:** `JS-022`, `TAB-004`
- **Related:** `SHEET-002` (`Movement_Log` — the raw source it distils)

## Source of truth

The live `Daily_RM_Issues` tab; schema `DAILY_RM_ISSUE_LOG_COLUMNS_`
(`DailyRmIssueLog.gs`).

## Validation

- **Method:** column list read from `DAILY_RM_ISSUE_LOG_COLUMNS_` `#L39`
  at `c82ec67`; self-heal + chunked-write behaviour asserted in
  `Tests_DailyRmIssueLog.gs`; retention read from the 2026-09-07 prune.
  The user confirmed `DailyRmIssueLog.gs` ran clean in the Apps Script
  editor this session.
- **Evidence:** `.github/workflows/test.yml` (`Tests_DailyRmIssueLog.gs`,
  last green run); `LOGIC_AUDIT.md` Part 3 §3.6.
- **Status:** Validated 2026-09-10 (**including** lifecycle).

## Version / change reference

Verified at `c82ec67`; record created by `DOC-032`.

## Revalidation trigger

`DAILY_RM_ISSUE_LOG_COLUMNS_` changes (must be appended); the 7-day
retention or the capture schedule changes; `JS-022`'s read expectations
change.

## Handover relationship

`HANDOVER.md` §2 covers the tab; §9 covers its operational quirks.
Current as of 2026-09-09. A schema/retention change must update
`HANDOVER.md` §2/§9.

## Lifecycle / retention

**7 days** (since 2026-09-07), enforced by `pruneDailyRmIssueLog_`
(`GS-003`). Confirmed.

## Next action

none — Closed + Monitored (lifecycle complete).

## Closure evidence

Record committed for `DOC-032`; `docs/INDEX.md` `SHEET-003` → `Closed +
Monitored`, `Last Verified` 2026-09-10; columns + retention sourced from
`DailyRmIssueLog.gs`, not approximated; Data Lifecycle fully filled
(second confirmed worked example).
