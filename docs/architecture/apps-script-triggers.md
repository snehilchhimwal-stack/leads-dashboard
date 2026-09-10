# Apps Script trigger set — index

Every time-based trigger in the bound Apps Script project, in one place.
Not an ID'd catalog record (no `INDEX.md` row) — a reference index; each
row's authority is the linked `GS-` record's `## Trigger schedule`
section. Forensic-audit P2 item 10 (`t-tf-5ad22d8e4c2e`).

> **Apps Script does not auto-deploy from git** (`CLAUDE.md`). These
> triggers live in the Sheet's Extensions → Apps Script editor. A `.gs`
> edit here is not live until pasted there, and a **schedule** change
> needs the file's `setupXxx()` re-run — a trigger's schedule is fixed
> at creation.

## The triggers

Verified against source at `HEAD`, 2026-09-10.

| # | Schedule (IST) | Handler function | File (`GS-`) | Installed by | `.inTimezone('Asia/Kolkata')`? |
|---|---|---|---|---|---|
| 1–4 | `atHour(h).everyDays(1)` for `h` in `SNAPSHOT_HOURS_ = [0, 6, 12, 18]` — **no `.nearMinute()`** | `snapshotPeriodic` (→ `snapshotOpenLeads_`) | `MovementTracker.gs` (`GS-008`) | `setupMovementTracking()` | **yes** (each) |
| 5 | `atHour(22).nearMinute(50).everyDays(1)` | `captureDailyRmIssues` | `DailyRmIssueLog.gs` (`GS-003`) | `setupDailyRmIssueLog()` | **yes** |
| 6 | `atHour(10).nearMinute(0).everyDays(1)` | `sendOvernightMorningEmails` (overnight region email) | `OvernightEmailer.gs` (`GS-010`) | `setupOvernightEmailer()` | **NO** — the sole outlier |
| 7 | `atHour(13).nearMinute(0).everyDays(1)` | `sendOvernightFollowupEmails` (same-thread "what got resolved") | `OvernightEmailer.gs` (`GS-010`) | `setupOvernightEmailer()` | **NO** |
| 8 | `atHour(ALL_ISSUES_RUN_HOUR_ = 17).nearMinute(0).everyDays(1)` | `sendAllIssuesEmails` | `AllIssuesEmailer.gs` (`GS-001`) | `setupAllIssuesEmailTrigger()` | **yes** |
| 9 | `onWeekDay(MONDAY).atHour(9).nearMinute(0)` | `runWeeklyOpsChecklistNow` | `OpsChecklistRunner.gs` (`GS-009`) | `setupOpsChecklistRunner()` | **yes** |

**No trigger of their own** (called only from other `.gs` or a one-time
setup): `Core.gs` (`GS-002`), `EmailInfra.gs` (`GS-004`),
`FollowupEngine.gs` (`GS-005`), `RmHierarchy.gs` (`GS-011`) —
`setupRmHierarchy()` creates sheets only, `SlaEngine.gs` (`GS-012`),
`LeadFollowupsStaleness.gs` (`GS-007`) — `setupLeadFollowupsStalenessFormatting()`
applies conditional formatting immediately, no trigger.
`InteractionHistoryLogger.gs` (`GS-006`) and `UnmatchedCommentLogger.gs`
(`GS-013`) **piggyback** on trigger 1–4 (see `FLOW-001`).

## Known issue

Triggers 6 and 7 (`OvernightEmailer.gs`) have **no `.inTimezone('Asia/Kolkata')`
pin** — they rely on the Apps Script project's default timezone. If that
default is ever not IST, the 10:00 / 13:00 sends drift. Every other
trigger pins explicitly. Recorded on `GS-010` `## Trigger schedule` and
`LOGIC_AUDIT.md`; not yet fixed.

## When a trigger changes

1. Edit the `atHour`/`nearMinute` in the `.gs` file **and paste it into
   the live editor**.
2. Re-run that file's `setupXxx()` once (delete + recreate the trigger).
3. Update the linked `GS-` record's `## Trigger schedule` + `Last
   Verified`, and this table.
4. `check-catalog.py` E will flag the changed `.gs` path on the next push
   — run its ops JSON to open the revalidation task.
