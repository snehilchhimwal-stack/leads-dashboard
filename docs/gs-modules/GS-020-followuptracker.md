# GS-020 - FollowupTracker.gs

| | |
|---|---|
| **Type** | `GS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `FollowupTracker.gs` |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-10-09 against commit `d9e2b97` - created (Email Ops EO-7) |

## Purpose / reason to exist

Every 17:00 bucket email starts two follow-ups the next day: Checkpoint 1 (the 10:00 email that re-checks yesterday's flagged leads) and Checkpoint 2 (the 13:00 reply in that
thread). The tracker lists, for each 17:00 bucket of the report's cycle, where each checkpoint stands - `COMPLETED`, `NOT_NEEDED` (nothing was left to follow up), `BLOCKED`
(a failure, a gate refusal, an unconfirmed send or a run that died is on record), `OVERDUE` (past its due time plus 30 minutes and nothing is recorded), `DUE` or `FUTURE` -
and whether the 17:00 email itself bounced or got a reply. The 16:30 report (`GS-016`) shows the counts and the items that need a look; the rows are stored in the
`Followup_Tracker` tab (`SHEET-024`). Plan: `docs/_planning/EMAIL_OPS_SYSTEM_AUDIT.md` (EO-7).

**STOP is a status, not a behaviour.** A bounced 17:00 email marks its row `STOP`: the recipient never received it, so their follow-ups are pointless until the address is fixed.
Nothing here changes what the 10:00 or 13:00 jobs send; whether replies or bounces should stop follow-ups automatically is a decision for the user.

## Responsibilities

- Decide each checkpoint's status from the ledger (outranks the log stamp), the `AllIssues_Log` stamp and the clock (`followupCheckpointStatusGs_`).
- Build the tracker for the cycle's 17:00 bucket rows (`followupTrackerGs_`): per-bucket statuses, counts, the attention list, the bounce / reply marker.
- Render the report sections (`followupTrackerSectionsGs_`): a counts table and, when needed, a red "needing attention" table (cut at 30 rows).
- Read the cycle day's 17:00 buckets narrowly from `AllIssues_Log` (`followupTrackerReadLogGs_`; null when unreadable) and store the rows (`followupTrackerRecordGs_`), one block per report day, replaced on a same-day re-send.
- `showFollowupTrackerNow()` logs the tracker as it would be built right now (read-only, first in the file).

## Trigger schedule

None of its own - it runs inside the 16:30 report (`GS-016`, `sendEmailCycleReport`).

## Requires `setupXxx()` re-run when

Never - no trigger of its own.

## Significant functions - `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-419 | `followupCheckpointStatusGs_(s)` / `followupKeyGs_` / `followupNextDayGs_` | `{stamp, ledgerStatus, ledgerReason, dueAt, now, blockedBy}` | `{ status, note }` | none (pure) | - | FN-420 | specific - RULE-064 |
| FN-420 | `followupTrackerGs_(input)` | `{ cycleDay, logRows, ledgerRows, now }` | `{ cycleDay, rows, counts: {cp1, cp2}, attention }` | none (pure) | FN-419 | `GS-016` `cycleReportDataGs_` | specific - RULE-064 / RULE-065 |
| FN-421 | `followupTrackerSectionsGs_(t)` / `followupTrackerReadLogGs_(ss, dayKey)` / `followupTrackerRecordGs_(ss, t, now)` / `showFollowupTrackerNow()` | the tracker, the workbook, the time | the report sections; the day's 17:00 bucket rows or null; none; none | reads `AllIssues_Log` (narrow columns); writes `Followup_Tracker` (replace-or-append, fail-open); the preview only logs | `emailLedgerEnsureSheetGs_`, `emailLedgerReplaceDayBlockGs_` (`GS-015` FN-422) | `GS-016` | specific |

## Business rules implemented - `RULE-XXX` sub-table

| ID | Rule | Where | Duplicated elsewhere? |
|---|---|---|---|
| RULE-064 | A checkpoint's status, in this order: ledger SKIPPED = `NOT_NEEDED`; ACCEPTED = `COMPLETED` (noting a missing log stamp); FAILED / BLOCKED / UNCONFIRMED / PLANNED / ATTEMPTING = `BLOCKED`; a log stamp alone = `COMPLETED`; a known blocker = `BLOCKED` (Checkpoint 2 when Checkpoint 1 is BLOCKED or OVERDUE - there is no 10:00 thread to reply in); then the clock: before its hour `FUTURE`, from the hour `DUE`, 30 minutes after it `OVERDUE`. The ledger outranks the stamp; a planned or attempted email is never "completed" | FN-419, FN-420 | `GS-019` RULE-062 (the same unfinished-is-a-problem principle) |
| RULE-065 | A 17:00 email that bounced (ACCEPTED by Gmail, then a delivery-failure message) marks its row STOP and is listed for attention; a reply is shown but flags nothing. STOP changes nothing that is sent | FN-420 | `GS-017` RULE-052/053 (how a bounce is found) |

## Config constants - `CFG-XXX` sub-table

| ID | Constant | Value | Meaning | Changing it affects |
|---|---|---|---|---|
| CFG-120 | `FOLLOWUP_TRACKER_SHEET_`, `FOLLOWUP_TRACKER_HEADERS_`, `FOLLOWUP_TRACKER_CP1_HOUR_`, `FOLLOWUP_TRACKER_CP2_HOUR_`, `FOLLOWUP_TRACKER_GRACE_MINUTES_`, `FOLLOWUP_TRACKER_STATUSES_`, `FOLLOWUP_TRACKER_MAX_ROWS_` | `Followup_Tracker`, 14 columns, `10`, `13`, `30`, the six statuses, `30` | the tab and its columns; when each checkpoint is due; how long it is DUE before it is OVERDUE; the status list the counts use; the attention list's length in the report | where the rows go (never reorder the columns by hand); when a checkpoint turns OVERDUE |

## Exceptions - `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-137 | `AllIssues_Log` cannot be read | `followupTrackerReadLogGs_` returns null; the report's tracker section says the follow-ups are NOT tracked this time (missing evidence, not a failure) | one line in the report |
| EXC-138 | the rows cannot be stored, or the tracker cannot be built | logged only (storing) / `data.followups` stays null (building); the report is otherwise unchanged | none, or no tracker section |

## Data lineage

`SHEET-013` AllIssues_Log (the cycle day's 17:00 rows and their checkpoint stamps) + `SHEET-019` Email_Ledger (the 17:00 rows' bounce / reply columns and the 10:00 / 13:00 results, through the report) -> FN-420 -> the report sections and `SHEET-024` Followup_Tracker.

## Sheets touched

| `SHEET-XXX` | Read / Write | Which `FN-XXX` | Notes |
|---|---|---|---|
| `SHEET-013` `AllIssues_Log` | Read | FN-421 | date, region, bucket, role, recipient, lead count and the two checkpoint stamps only (not the large JSON columns) |
| `SHEET-024` `Followup_Tracker` | Read + write | FN-421 | today's contiguous block at the bottom is replaced (or appended) once the report is sent |

## Failure / error behaviour

Fail-open at every end: an unreadable log shows a "not tracked" line; a tracker that cannot be built leaves the report as before; rows that cannot be stored leave the email unaffected.

## Cross-runtime duplication

None - backend only.

## Not live until pasted

Paste `FollowupTracker.gs` (new), `Tests_FollowupTracker.gs` (new), `EmailLedger.gs` (the shared block writer), `DailyChecklist.gs`, `CycleReport.gs`, `Tests_RunAll.gs`; no `setupXxx()`. `showFollowupTrackerNow()` (read-only) previews it.

## UI relationships

N/A - backend.

## Architecture relationship

Apps Script backend; evaluated inside the 16:30 report job (no trigger, no lock of its own).

## Related documentation

`docs/_planning/EMAIL_OPS_SYSTEM_AUDIT.md`; `docs/EMAIL_OPS_OPERATING_MANUAL.md`; `HANDOVER.md` section 4.3.5.

## Relationships

- **Depends On:** `GS-002` (`Core.gs`), `GS-004` (`EmailInfra.gs`), `GS-015` (`EmailLedger.gs`), `GS-016` (`CycleReport.gs`), `SHEET-013`, `SHEET-019`, `SHEET-024`
- **Used By:** `GS-016` (the report builds, shows and stores the tracker when this file is present), `SHEET-024`
- **Related:** `GS-010` (the 10:00 / 13:00 jobs whose checkpoints it follows), `GS-018` (the audits catch the same gaps while they can still be recovered), `GS-019`

## Source of truth

`FollowupTracker.gs` at `HEAD`.

## Validation

- **Method:** `Tests_FollowupTracker.gs` - every status and the time boundaries, the tracker over hand-built rows (blocking, STOP, matching, counts), the report sections, the shared day-block writer, the reader against a real `AllIssues_Log`, the `Followup_Tracker` tab, and a real 17:00 -> 10:00 -> 13:00 cycle reported on (complete, then damaged one piece at a time); deliberate regressions (FT1..FT57) each caught.
- **Evidence:** `.github/workflows/test.yml`; the first live 16:30 report after the paste.
- **Status:** Validated 2026-10-09 (locally); live behaviour proven by the first report.

## Version / change reference

**2026-10-09** (`d9e2b97`): file created - Email Ops EO-7. `CycleReport.gs` reads the cycle day's 17:00 buckets, builds the tracker (fail-open) into `data.followups`, shows its sections before the daily checklist and stores the rows after the send. `EmailLedger.gs` gained `emailLedgerReplaceDayBlockGs_` (`GS-015` FN-422), which `DailyChecklist.gs` now also uses. **Not live until pasted.**

## Revalidation trigger

Any commit touching `FollowupTracker.gs` or `Tests_FollowupTracker.gs`; the `AllIssues_Log` columns (checkpoint stamps); the ledger's statuses or sweep columns; the 10:00 / 13:00 hours.

## Handover relationship

`HANDOVER.md` section 4.3.5 updated in the same commit.

## Lifecycle / retention

`SHEET-024`: one row per 17:00 bucket per report day, never pruned (about 50 a day).

## Next action

After a week of reports, see which checkpoint is most often BLOCKED or OVERDUE, and decide whether a bounced email should stop its follow-ups automatically.

## Closure evidence

Record created with the feature; `docs/INDEX.md` `GS-020`.
