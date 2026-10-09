# GS-008 — MovementTracker.gs

| | |
|---|---|
| **Type** | `GS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `MovementTracker.gs` (1700 lines; 1496 -> 1648 in email audit P15/P16, then P17) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-10-07 against commit `58ab8e1` - email audit P17: a step that throws is emailed to ops (once a day per step), recorded in `Movement_Log_Runs.failed_phases`, and timed in `phase_s` (`FN-349`, `CFG-096`, `EXC-111`; see `## Version / change reference`) |

## Purpose / reason to exist

The 4×/day unattended snapshot of every open lead into `Movement_Log` —
the trigger backbone the whole backend history layer rests on, and the
hub that `UnmatchedCommentLogger.gs` and `InteractionHistoryLogger.gs`
piggyback on. It exists because the live `leads` tab only shows the
present; reconstructing "this lead stopped moving N days ago," the
0–48h cohort outcome, or an RM's issue history all need a periodic
frozen snapshot, and this is the one script that writes it. It also
writes the per-snapshot `SLA_History` row and (guarded) persists
`Daily_Cohort_History`.

## Responsibilities

- `snapshotOpenLeads_` — capture every open lead into `Movement_Log`,
  **skipping a lead whose content hash matches its latest known hash**
  (content-hash dedup, added 2026-09-11 — see `FN-218`/`CFG-063`); always
  writes one `Movement_Log_Runs` row per run regardless of whether
  anything changed; independently try/catch each side-effect.
- `removeEarlyCorruptedMovementLogDataNow()` — one-time, console-callable
  cleanup for the Sep 2026 data-loss/restore incident (`HANDOVER.md` §8):
  backs up only the rows about to be removed as a Drive CSV file
  (`Movement_Log_removed_rows_<timestamp>.csv`), then drops every row
  snapshotted before 12 Sep 2026 IST. Deliberately not a full-sheet
  duplicate — two real failures on this sheet's size (`sheet.copyTo()`'s
  `"This operation is not supported"`, then a plain-values duplicate's
  10M-cell workbook ceiling) ruled that out. Also calls `deleteRows()`
  after its rewrite (added 2026-09-18, `2d4a573`) — the first version of
  this fix cleared and rewrote content but never shrank the sheet's row
  allocation, which freed nothing toward the workbook ceiling (that cap
  counts declared grid size, not content — see `pruneMovementLog_`'s own
  comment, `#L644`) and was the direct cause of `captureDailyRmIssues_`
  (`DailyRmIssueLog.gs`) crashing on the same ceiling hours later. Not
  wired to any trigger or button — added 2026-09-17, backup mechanism
  corrected same day, `deleteRows()` gap fixed the day after.
- `snapshotPeriodic` / `snapshotNow` — the scheduled and manual entry
  points; `setupMovementTracking` — install the 4 triggers. Since 2026-10-07
  (email audit F23) `snapshotPeriodic` also leaves a run record in Script
  Properties that the hourly `emailJobWatchdog` (`GS-004`) reads
  (`snapshotRunProblemsGs_`, `FN-344`): alert once per run when it is stuck,
  failed, overdue or finished having skipped phases.
- `pruneMovementLog_` — trim rows **and** shrink the sheet's row
  allocation (to stay under the 10M-cell workbook ceiling); writes the
  kept rows to their final position **before** clearing the leftover
  tail (interruption-safe — a mid-run kill never lands between an
  unconditional clear and the rewrite), and skips the whole
  clear/write/shrink sequence when every row is already within
  retention. **Archives dropped rows to Drive** (2026-09-21,
  `archiveRowsToDriveCsv_`, `GS-002`) before clearing them — the same
  generalized mechanism `DailyRmIssueLog.gs`'s `EXC-097` fix uses,
  applied here too so pruned `Movement_Log` history is kept indefinitely
  in Drive instead of lost once it ages out of the sheet.
- `writeSlaHistorySnapshot_` — the per-snapshot `SLA_History` row.
- `buildTodayCallBaselineGs_` / `lastSnapshotBeforeGs_` /
  `buildMovementLogMapsGs_` — the maps every other scheduled file reads.
  **Keyed by LEAD id, not `client_id`** since 2026-10-07 (email audit F18):
  `call_attempts` is a per-lead counter (every RM copy of one lead id is
  identical; a customer's several leads differ).
- `computeDailyCohortByRegionGs_` / `persistDailyCohortHistoryGs_` /
  `_evidenceAtDeadlineGs_` — the cohort-history persist (the `.gs` twin
  of `JS-024`'s).
- `checkMovementLogFreshness_` — the freshness check `OpsChecklistRunner.gs`
  reuses.

## Trigger schedule

`setupMovementTracking()` (`#L1079`) installs **four separate**
`snapshotPeriodic` triggers — one per entry in `SNAPSHOT_HOURS_` =
`[0, 6, 12, 18]` — each
`ScriptApp.newTrigger('snapshotPeriodic').timeBased().atHour(hour).everyDays(1).inTimezone('Asia/Kolkata')`
(`#L1108`; `LOGIC_AUDIT.md` Part 1 §5). Four `atHour()` triggers, **not** one
`everyHours(6)` — the file's own comment explains `everyHours()` "can
silently skip or drift by hours under load."

## Requires `setupXxx()` re-run when

Only when the **cadence** changes — editing `SNAPSHOT_HOURS_` (or its
predecessor) does nothing until `setupMovementTracking()` is re-run
(the file's own comment says so). A change to the capture logic,
retention days, or any piggyback logger takes effect on the next
scheduled fire (`CLAUDE.md` gotcha).

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-218 | `snapshotOpenLeads_(label, opts)` `#L601` | `leads` tab; `opts` is a test hook only (`{nowMs, deadlineSeconds}`) | appends a `Movement_Log` row (the `SNAPSHOT_COLUMNS_` shape + `content_hash`) **only for a lead whose content hash differs from its latest known hash** — an unchanged lead is skipped (no duplicate row) though still counted in `leadCountSeen` (2026-09-11 content-hash dedup — `641398e`); **since 2026-10-07 (email audit F23) the order is: CORE capture first (hash lookup + append), then ONE `Movement_Log_Runs` row (`run_at`, `run_label`, `lead_count_seen`, `leads_changed`, blank `total_s`/`skipped_phases`), then the optional phases in priority order** — SLA_History write, unmatched-comment scan, interaction-history log, `pruneMovementLog_`, Comment_History prune, Unmatched_Comments_Log prune, cohort-history persist — each started only while the run is inside `SNAPSHOT_OPTIONAL_PHASE_DEADLINE_SECONDS_` (`CFG-094`) via `runSnapshotPhaseGs_` (`FN-343`); `total_s` / `skipped_phases` are filled in at the end; returns `{leadCountSeen, leadsChanged, totalSeconds, skipped, failed, timings}` (null when the tab has nothing to snapshot); a prune failure is re-thrown at the very end (the run still shows Failed) | Sheets write; **each optional phase is independently try/catch-wrapped so one failing never blocks the core capture** | `readLeadsTab_` (`GS-004`), `isOpenLead_` (`GS-002`), `computeSlaFlags_` (`GS-012`), `writeSlaHistorySnapshot_` (FN-221), `scanUnmatchedCommentsGs_` (`GS-013`), `logInteractionHistoryGs_` (`GS-006`), `persistDailyCohortHistoryGs_` (FN-223), `pruneCommentHistory_` (`GS-006` FN-307), `pruneUnmatchedCommentsLog_` (`GS-013` FN-309), `runSnapshotPhaseGs_` (FN-343), `_leadContentHashGs_` / `_latestContentHashByKeyGs_` / `ensureMovementLogRunsSheet_` (dedup + run-log helpers) | `snapshotPeriodic` (FN-219), `snapshotNow` (FN-219) | specific — the hub capture |
| FN-219 | `snapshotPeriodic()` / `snapshotNow()` / `setupMovementTracking()` `#L1330/#L1425/#L1384` | — | scheduled capture / manual capture / installs the 4 triggers | Sheets writes / creates triggers; **`snapshotPeriodic` (not `snapshotNow`) also writes the run record `EMAIL_JOB_RUN_snapshotPeriodic` in Script Properties** (`running` -> `completed` with `totalSeconds` + `skipped`, or `failed` with the error; a platform kill leaves it `running`) — added 2026-10-07 (email audit F23); a broken Properties service never stops the snapshot | FN-218 / `ScriptApp` / `writeEmailJobRunGs_` (`GS-004` FN-332) | the 4 triggers / editor | specific |
| FN-220 | `pruneMovementLog_(ss)` / `pruneMovementLogNow()` `#L817/#L930` | spreadsheet | deletes rows older than the retention cutoff **and shrinks the sheet's row allocation via `deleteRows`**; **since 2026-10-07 (email audit F23) it first reads ONLY the `snapshot_at` column; when the expired rows are a contiguous prefix (the normal case) it archives just those rows to Drive and removes them with ONE `deleteRows` call — nothing is rewritten or cleared (`EXC-109`/`EXC-110`)**; any other shape (an expired row after a kept one, a blank/non-date cell, every row expired — Sheets refuses to delete all non-frozen rows) falls back to the previous full rewrite: write kept rows first, clear only the leftover tail after (2026-09-12 interruption-safety fix — see `EXC-091`); no-ops entirely when nothing is outside retention; **archives dropped rows to Drive before removing them (2026-09-21)** — a failed archive throws before anything is deleted | Sheets structural change (skipped when nothing to prune); Drive write via `archiveDroppedMovementLogRowsGs_` -> `archiveRowsToDriveCsv_` (`GS-002`) when there's anything to drop; allocation shrink via `shrinkMovementLogAllocationGs_` (FN-345) | `archiveDroppedMovementLogRowsGs_` / `shrinkMovementLogAllocationGs_` (FN-345) | FN-218 (after each capture) | specific — "to avoid the 10M-cell workbook ceiling this project has hit once before"; the old full rewrite ran on nearly EVERY run (a 7-day window with ~1.7K rows appended per run always has something expiring) and was the biggest cost in the runs that hit the 30-minute wall |
| FN-221 | `ensureSlaHistorySheet_(ss)` / `writeSlaHistorySnapshot_(ss, dataRows, colIndex, now)` `#L495/#L525` | the snapshot rows | one `SLA_History` row per run | Sheets write | `computeSlaFlags_` (`GS-012`) | FN-218 | specific — **schema matches `js/sheets-writeback.js`'s `SLA_History` writer exactly** (`LOGIC_AUDIT.md` Part 4 §4.7) |
| FN-222 | `_collapseLatestByKeyGs_` `#L372` / `_lastMovementLogSnapshotByKeyGs_` / `buildTodayCallBaselineGs_(ss, beforeDate)` `#L451` / `lastSnapshotBeforeGs_(ss, beforeDate)` `#L470` / `buildMovementLogMapsGs_(ss, now)` `#L483` | `Movement_Log` rows | the baseline / last-snapshot / combined maps every scheduled emailer reads — **keyed by LEAD id** since 2026-10-07 (email audit F18; was `client_id`, which compared a lead with a sibling lead's snapshot; a row with no lead id is dropped) | none | `_readMovementLogRowsGs_` (FN-224) | `GS-001`, `GS-010`, `GS-003` | reusable — the hub's read API. The dashboard twin is `buildTodayCallBaseline` / `lastSnapshotBefore` (`JS-021` FN-148) — keep both keyed the same (`HANDOVER.md` §6) |
| FN-223 | `eligibleDailyCohortDatesGs_` `#L1073` / `computeDailyCohortByRegionGs_(dateKey, historyRows, liveByKey, now)` `#L1130` / `upsertDailyCohortHistoryRowsGs_` `#L1204` / `_readArchivedDailyCohortDatesGs_` `#L1253` / `persistDailyCohortHistoryGs_(ss, dataRows, colIndex, now)` `#L1267` | history rows + a date | per-region cohort outcomes; upserts `Daily_Cohort_History` | Sheets write (`RAW`); **never re-writes an archived date** | `_evidenceAtDeadlineGs_` (FN-225), `_effectiveRegionGs_` (FN-225) | FN-218, `persistDailyCohortHistoryNow()` (manual) | specific — **`.gs` twin of `JS-024`'s cohort persist** |
| FN-224 | `ensureMovementLogSheet_(ss)` / `_readMovementLogRowsGs_(ss)` / `_readMovementLogHistoryRowsGs_(ss)` `#L216/#L336/#L1011` | spreadsheet | ensures the tab (self-healing header — new fields are **appended** to `SNAPSHOT_COLUMNS_`, never inserted mid-array, and a missing field's header is **inserted immediately before `content_hash`** when that column exists (2026-09-25 fix — appending it after the hash while the writers put the value before it was a one-column offset that broke dedup for three days, `EXC-100`); forces a datetime cell format on `lead_assigned_at`/`last_connect_time`/`opp_at` explicitly by name — see `EXC-XXX` risk note); reads rows — **`_readMovementLogRowsGs_` reads only `snapshot_at`/`lead_id`/`call_attempts`, `_readMovementLogHistoryRowsGs_` only its 8 columns, each as a single-column range via `_readMovementLogColumnsGs_` (FN-342)** (email audit F23; they used to read the full 26-column width) | may create the tab | — | FN-218, FN-222, FN-223 | reusable |
| FN-282 | `assertMovementLogHeaderAligned_(sheet)` `#L290` | the `Movement_Log` sheet | nothing — throws if header cells 1..N are not exactly `snapshot_at`, `snapshot_label`, every `SNAPSHOT_COLUMNS_` field in order, then `content_hash` | none (reads row 1) | — | `FN-218` (right after `ensureMovementLogSheet_`, before any append) | specific — added 2026-09-25 so a misaligned header fails the run loudly instead of silently re-appending every lead |
| FN-285 | `removeDedupIncidentRowsNow()` `#L1580` | the `Movement_Log` and `Movement_Log_Runs` sheets | archives then deletes the 52,060 rows the five captures of 2026-09-22 12:44 → 09-23 12:44 IST appended — **only if** the header is aligned, the window rows are one contiguous block, and their count equals the sum of `leads_changed` `Movement_Log_Runs` recorded for those runs; the Drive CSV is written and its row count checked before any deletion | Drive CSV via `archiveRowsToDriveCsv_` (`GS-002`); `deleteRows` | `assertMovementLogHeaderAligned_` (FN-282), `archiveRowsToDriveCsv_` | editor only (not triggered) | one-off remediation, precedent `removeEarlyCorruptedMovementLogDataNow`. **Run 2026-09-25 16:28 IST** (41 s): archived + removed 52,060 rows; `Movement_Log` 90,698 → 38,638 data rows. Safe to re-run (finds nothing in the window). |
| FN-304 | `removeStaleMovementLogBackupTabNow()` `#L1650` | the hardcoded `Movement_Log_backup_2026-09-17_1115` tab | archives its 109,999 rows to Drive as multiple ~5,000-row CSV chunks (`ARCHIVE_CHUNK`), verifies the summed archived row count across every chunk file, then deletes the whole tab — refuses if the header doesn't match the exact schema the original backup copied, or if the archived total doesn't match | Drive CSVs via `archiveRowsToDriveCsv_` (`GS-002`, called once per chunk); `deleteSheet` | `archiveRowsToDriveCsv_` | editor only (not triggered) | one-off, added 2026-09-28. Removes a leftover artifact of `removeEarlyCorruptedMovementLogDataNow`'s FIRST version (`9413f6a`, `EXC-102`) — a bug fixed 20 minutes later (`834d7ea`) that had already created this one in-workbook duplicate before the fix landed; found costing 2,860,000 cells (29% of the workbook) by `computeWorkbookCellUsageGs_` (`GS-002` FN-301) on 2026-09-28. **First real run threw** `exceeds the maximum file size` from `DriveApp.createFile` on a single 109,999-row CSV (the guard aborted cleanly, nothing was touched); fixed same day by chunking the archive call itself rather than changing the shared `archiveRowsToDriveCsv_` helper, which never sees this volume from its normal callers |
| FN-296 | `_dedupKeyGs_(leadId, rm)` `#L442` | a lead_id and an RM | `lead_id|RM` (trimmed; a blank RM is `Unassigned`) — the content-hash dedup identity of ONE leads-tab row, used by `_latestContentHashByKeyGs_` and `snapshotOpenLeads_` | none (pure) | — | FN-218, `_latestContentHashByKeyGs_` | specific — added 2026-09-26. Keyed by `client_id` before, which a customer's several rows share, so only one of them could match the single stored hash and ~2,000 identical rows per capture were re-appended. `movementDedupKey` (`JS-021` FN-297) MUST build the identical string (shared literals asserted in `Tests_MovementTracker.gs` and `tests/frontend-harness.html`) |
| FN-225 | `_effectiveRegionGs_(groupSource, region)` `#L1046` / `_evidenceAtDeadlineGs_(historyForKey, deadlineMs, liveEvidence)` `#L1056` / `_buildLiveLeadIndexGs_` `#L1104` | a lead's history + a deadline | status as of the deadline / the effective region | none | — | FN-223, `GS-003` | reusable — twin of `evidenceAtDeadline` (`JS-024` FN-162); `_effectiveRegionGs_` is the **reduced** Loan override (`group_source` only — `SNAPSHOT_COLUMNS_` has no `project_region`) |
| FN-226 | `checkMovementLogFreshness_(ss, now)` / `checkMovementLogFreshnessNow()` `#L1459/#L1476` | spreadsheet + now | `{status, ageHours, label}` — stale if age > `MOVEMENT_LOG_FRESHNESS_GRACE_HOURS_` (8h); **reads `Movement_Log_Runs`' last row, not `Movement_Log`'s own last row** (changed 2026-09-11 alongside the content-hash dedup — a capture run that changes no leads no longer writes a new `Movement_Log` row at all, so `Movement_Log`'s own last-row timestamp stopped being a reliable freshness signal; `Movement_Log_Runs` gets a row every run regardless) | none | — | `OpsChecklistRunner.gs` (`GS-009`), manual | reusable |
| FN-342 | `_readMovementLogColumnsGs_(sheet, names)` `#L356` | a `Movement_Log` sheet + header names | `{rowCount, idx: {name: 0-based column or -1}, cols: {name: [[v], ...]}}` — only the named columns, one single-column range each; a missing name is `idx` -1 with no `cols` entry; a header-only sheet is `rowCount` 0 | none (reads) | — | `_readMovementLogRowsGs_` (3 columns), `_latestContentHashByKeyGs_` (4), `_readMovementLogHistoryRowsGs_` (8) | reusable — **added 2026-10-07 (email audit F23)**; `Movement_Log` is ~48K rows x 26 columns and every run read it in full four times |
| FN-343 | `runSnapshotPhaseGs_(ctx, name, fn, rethrow)` `#L568` | a run context `{nowMs, startedMs, deadlineS, skipped, errors}`, a phase name, its body, a rethrow flag | nothing — runs the phase only if the elapsed time is not PAST `ctx.deadlineS` (exactly at the deadline still runs); otherwise records the name in `ctx.skipped` and logs `[timing] SKIPPED`; a throwing phase is logged and swallowed, or (rethrow) kept in `ctx.errors` for the end of the run | `Logger.log` (`[timing]` lines) | — | `snapshotOpenLeads_` (FN-218), once per optional phase | specific — **added 2026-10-07 (email audit F23)**; a plain-object context so a test can drive the clock |
| FN-344 | `snapshotRunProblemsGs_(now)` `#L1357` | `now` | `[]` or exactly ONE `{job: 'snapshotPeriodic', kind, detail, marker, hint}` — `stuck` (still `running` more than `EMAIL_JOB_MAX_RUN_MINUTES_` = 35 min after it started), `failed`, `overdue` (the newest run started more than `MOVEMENT_LOG_FRESHNESS_GRACE_HOURS_` = 8 h ago), or `degraded` (completed but skipped phases); no record / an unreadable Properties service -> `[]` (the email-job check already reports that) | none (reads the run record) | `readEmailJobRunGs_` (`GS-004` FN-332) | `checkEmailJobsCompletedGs_` (`GS-004` FN-333, the hourly watchdog), which alerts once per RUN (`marker` = the run's start time + kind) | specific — **added 2026-10-07 (email audit F23)**; at most one problem per record, because the watchdog keeps ONE de-duplication marker per job and two kinds would re-alert each other every hour |
| FN-345 | `archiveDroppedMovementLogRowsGs_(header, dropped)` `#L877` / `shrinkMovementLogAllocationGs_(logSheet, keptCount)` `#L897` | the header + the rows about to be dropped / the sheet + how many rows are kept | the Drive CSV (labelled with the IST date range of the dropped rows; a loop, not `Math.min.apply`, so a very large drop cannot overflow the call stack) / the row allocation shrunk to kept rows + `MOVEMENT_LOG_ROW_HEADROOM_` | Drive write (throws on failure, so the caller never deletes unarchived rows) / `deleteRows` | `archiveRowsToDriveCsv_` (`GS-002`) | `pruneMovementLog_` (FN-220), both paths | specific — **added 2026-10-07 (email audit F23)**; extracted so the fast and the fallback prune share them |
| FN-349 | `alertSnapshotPhaseFailuresGs_(failed, label, now)` `#L745` | the steps that threw this run (`[{phase, message}]`), the run label, now | how many steps it emailed about; emails ops ONE message listing the steps not yet reported TODAY (Script Property `SNAPSHOT_PHASE_ALERTED` = `{day, phases}`), then records them; an unreadable property means "alert anyway" (fails open); a failing send/record is logged and swallowed | `notifyOpsAlertGs_` (`GS-004` FN-203), `PropertiesService` | `snapshotOpenLeads_` (FN-218), after every run and BEFORE a Movement_Log prune failure is re-thrown | specific - **added 2026-10-07 (email audit P17)**; before it a failed step was only written to the log (the comment prunes failed for days unnoticed) |

## Config constants — `CFG-XXX` sub-table

| ID | Constant | Value | Meaning | Changing it affects |
|---|---|---|---|---|
| CFG-047 | `MOVEMENT_LOG_RETENTION_DAYS` `#L80` | `7` | how many days of `Movement_Log` are kept | `pruneMovementLog_` — one of the **two confirmed retention values** in the whole system. With ~1.7K rows appended per run, a 7-day window always has a prefix expiring, which is why the prune is a prefix delete (FN-220) rather than a full rewrite |
| CFG-048 | `SNAPSHOT_HOURS_` (a.k.a. `SNAPSHOT_HOURS_`) | `[0, 6, 12, 18]` | the 4 IST capture hours | the trigger cadence — **requires `setupMovementTracking()` re-run** |
| CFG-049 | `MOVEMENT_LOG_FRESHNESS_GRACE_HOURS_` `#L1458` | `8` | max age before `Movement_Log` reads "stale" (covers the `[0,6,12,18]` gap + `atHour()` slack) | `checkMovementLogFreshness_` / `OpsChecklistRunner.gs`'s freshness check (this is the constant behind the CI drift `runWeeklyOpsChecklist_(ss, now)` was split to fix) |
| CFG-050 | `SNAPSHOT_COLUMNS_` `#L105` | the snapshot column list — has `region` + `group_source`, **NOT `project_region`** | the `Movement_Log` write schema | every `Movement_Log` reader; the reduced Loan override (FN-225); **matches `js/sheets-writeback.js`'s writer** (`LOGIC_AUDIT.md` Part 4 §4.7) |
| CFG-063 | `CONTENT_HASH_COLUMN_` `#L139` | `'content_hash'` | trailing `Movement_Log` bookkeeping column — a SHA-256 digest computed over the `SNAPSHOT_COLUMNS_` fields (joined with the escape `'\u0000'` — never a literal NUL byte in the source, which the Apps Script editor turned into a space on paste until 2026-09-25; excluding `snapshot_at`/`snapshot_label`/itself); a separate column, outside the `SNAPSHOT_COLUMNS_` array | `FN-218`'s dedup skip; must hash identically to `js/sheets-writeback.js`'s twin or dedup silently breaks across runtimes. `CONTENT_HASH_DATE_FIELDS_` (`#L150`) — the sub-set of `SNAPSHOT_COLUMNS_` needing IST-string normalization before hashing so both runtimes hash an identical instant identically — gained `opp_at` 2026-09-21 alongside `lead_assigned_at`/`last_connect_time`; a lead reaching Opportunity between two captures now correctly registers as a real content change (`Tests_MovementTracker.gs`'s new dedup-sensitivity assertion proves this, not just that the field is present). |
| CFG-094 | `SNAPSHOT_OPTIONAL_PHASE_DEADLINE_SECONDS_` `#L561` | `840` (14 min) | an optional phase of `snapshotOpenLeads_` STARTS only while the run is at most this old; the rest is skipped and left to the next run (every phase is idempotent). Leaves ~16 minutes for the slowest single phase to finish before the platform's 30-minute kill | `FN-218`/`FN-343`; **added 2026-10-07 (email audit F23)** — raise it only with evidence from the `[timing]` lines |
| CFG-095 | `SNAPSHOT_RUN_JOB_` `#L1329` | `'snapshotPeriodic'` | the job name under which `snapshotPeriodic` records its run in Script Properties (`EMAIL_JOB_RUN_snapshotPeriodic`) and the watchdog (`FN-344`) reads it | the watchdog's alert subject (`WATCHDOG: snapshotPeriodic ...`); **added 2026-10-07 (email audit F23)** |
| CFG-096 | `SNAPSHOT_PHASE_ALERT_PROPERTY_` `#L744` | `'SNAPSHOT_PHASE_ALERTED'` | the Script Property that remembers which steps were already emailed today, so a step that fails on every run (4 a day) is reported once a day, not four times | `FN-349`; **added 2026-10-07 (email audit P17)** |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-072 | one side-effect (SLA_History / unmatched scan / interaction log / cohort persist) throws | each is **independently try/catch-wrapped** in `snapshotOpenLeads_` (`runSnapshotPhaseGs_`, FN-343) | the core `Movement_Log` capture still completes; the failed side-effect is logged, not fatal |
| EXC-073 | `Movement_Log` approaches the 10M-cell workbook ceiling | `pruneMovementLog_` trims rows **and shrinks the row allocation** via `deleteRows` | (historical) a real ceiling incident — mitigated every capture |
| EXC-091 | a `snapshotPeriodic` run is killed mid-function by Apps Script's 30-minute execution ceiling while `pruneMovementLog_` is running (real 2026-09-12 incident — the old clear-then-write ordering left `Movement_Log` with its row *allocation* intact but almost all real *data* gone) | fixed 2026-09-12: kept rows are written to their final position **first**, only the leftover tail is cleared after, and the whole clear/write/shrink sequence is skipped when nothing needs pruning | a mid-run kill now leaves at worst some already-expired rows sitting past their prune point (stale, not lost); the next successful run re-prunes them |
| EXC-109 | a `snapshotPeriodic` run reaches Apps Script's 30-minute execution limit (3 `Timed Out` runs of 1,802-1,803 s in 5 days, 1 Oct 00:18 / 2 Oct 18:51 / 4 Oct 06:08, plus several of 12-29 min — email audit F23) | the core capture runs first and its `Movement_Log_Runs` row is written right after it; optional phases start only inside `CFG-094`; the prune no longer rewrites the sheet and every reader reads only the columns it uses; a killed run leaves its record `running` and the hourly watchdog alerts once per run (`FN-344`) | the capture (and so every email's call baseline) is no longer lost with the run; a blank `total_s` on a `Movement_Log_Runs` row marks a run killed after its capture; ops get a `WATCHDOG: snapshotPeriodic did not finish` email naming the run |
| EXC-110 | `pruneMovementLog_` finds expired rows that are NOT a contiguous prefix (a restored/backfilled older row later in the sheet, a blank or non-date `snapshot_at` in the middle), or EVERY row is expired (Sheets refuses to delete all non-frozen rows) | falls back to the previous full rewrite (write kept first, clear the tail after) | correct but slow, as before; nothing is lost in either path |
| EXC-111 | an optional step of `snapshotOpenLeads_` throws (real case 2026-10-07: the `Comment_History` / `Unmatched_Comments_Log` prunes refusing to run because their archive check counted CSV lines) | the run carries on; the step is recorded in `ctx.failed`, shown in `Movement_Log_Runs.failed_phases` / the run record, and emailed to ops once a day per step (`FN-349`); a `Movement_Log` prune failure is emailed AND still fails the execution | the capture and every email baseline are unaffected; ops now hear about the failed step the same day instead of never |
| EXC-100 | `Movement_Log`'s header is not in writer order (real 2026-09-22 → 09-25 incident: `opp_at` was appended after `content_hash` while every writer puts it before) | `assertMovementLogHeaderAligned_` throws `refusing to append rows into a misaligned sheet` before any row is written | the run fails visibly (Execution log; `checkMovementLogFreshness_` later); nothing is appended; the next run captures the same leads once the header is fixed. Before the guard existed the dedup read `opp_at` where it expected the hash and appended **every lead on every run** (~52k rows, 09-22..09-23) |
| EXC-102 | `removeEarlyCorruptedMovementLogDataNow`'s FIRST version (`9413f6a`, 2026-09-17 ~11:15 IST) backed up `Movement_Log` by duplicating the whole sheet into a new in-workbook tab, which pushed the workbook toward its 10M-cell ceiling | fixed 20 minutes later (`834d7ea`, same day) — backup switched to a Drive CSV of only the removed rows, no in-workbook cell cost | the fix landed same-day and has been stable since; the ONE backup tab the buggy version already created (`Movement_Log_backup_2026-09-17_1115`) was never deleted — sat costing 2,860,000 cells (29% of the workbook) for 11 days until `computeWorkbookCellUsageGs_` found it 2026-09-28; removed by `removeStaleMovementLogBackupTabNow` (FN-304) |
| EXC-074 | retention cutoff uses `Date.now() - 7 days` (machine-clock-relative, `#L627`) — the **one** date boundary in this file not built through `istDayKeyGs_` | functionally fine, flagged as inconsistent with the file's own IST convention | none — a consistency note, not a bug (`LOGIC_AUDIT.md` Part 1 §4d) |
| EXC-075 | `atHour()` trigger lands a few minutes late | tolerated — `MOVEMENT_LOG_FRESHNESS_GRACE_HOURS_ = 8` absorbs the `[0,6,12,18]` spacing + slack | `checkMovementLogFreshness_` stays green |

## Data lineage

`leads` tab (`SHEET-001`, via `readLeadsTab_`) → `isOpenLead_` filter
(`GS-002`) → `computeSlaFlags_` (`GS-012`) → one row per open lead
appended to `Movement_Log` (`SHEET-002`, `SNAPSHOT_COLUMNS_` shape) →
read downstream by every scheduled emailer, `DailyRmIssueLog.gs`, and
(via the API in FN-222) the dashboard's own Movement tab. Side writes:
`SLA_History` (`SHEET-005`) per run; `Daily_Cohort_History` (`SHEET-008`)
guarded. Full flow: `DATA-004`.

## Sheets touched

| `SHEET-XXX` | Read / Write | Which `FN-XXX` | Notes |
|---|---|---|---|
| `SHEET-001` `leads` | Read | FN-218 (via `readLeadsTab_`) | the source |
| `SHEET-002` `Movement_Log` | Write (append, **skipped for a lead whose `content_hash` is unchanged**) + prune/shrink + ensure | FN-218 / FN-220 / FN-224 | the core output; 7-day retention. Pruned rows archived to Drive (not a Sheet) since 2026-09-21 — see `GS-002` `CFG-065`. |
| `SHEET-005` `SLA_History` | Write (append) + ensure | FN-221 | schema matches the client writer |
| `SHEET-008` `Daily_Cohort_History` | Write (upsert, `RAW`) + ensure | FN-223 | never re-writes an archived date |
| `SHEET-010` `Unmatched_Comments_Log` | Write (via `GS-013`) | FN-218 → `GS-013` | piggyback |
| `SHEET-009` `Comment_History` | Write (via `GS-006`) | FN-218 → `GS-006` | piggyback |
| `SHEET-015` `Movement_Log_Runs` | Write (append, one row every run, written right after the core capture; `total_s` / `skipped_phases` filled in at the end) + ensure (self-heals the two new header columns) | FN-218 → `ensureMovementLogRunsSheet_` / FN-226 (reads it) | added 2026-09-11 (Lead History & Versioning Review Phase 6, `641398e`); records `run_at`/`run_label`/`lead_count_seen`/`leads_changed` so "did a capture run" stays answerable once an unchanged-leads run stops writing a new `Movement_Log` row; `total_s`/`skipped_phases` added 2026-10-07 (email audit F23) |

## Failure / error behaviour

The core capture is protected by per-side-effect try/catch (EXC-072). A
core-capture failure shows as **Failed** in Executions. `pruneMovementLog_`
runs after each capture to keep the workbook bounded.

## Cross-runtime duplication

`snapshotOpenLeads_`'s `Movement_Log` write schema ↔ `js/sheets-writeback.js`
`browserSnapshotOpenLeads` (`JS-018`) — "agree exactly" (`LOGIC_AUDIT.md`
Part 4 §4.7), **including the 2026-09-11 content-hash dedup**:
`_leadContentHashGs_` ↔ `leadContentHash` (`JS-018`, same field order/
hash algorithm — must stay byte-identical or dedup silently breaks
across runtimes) and both writers append the same `Movement_Log_Runs`
row shape on every run. `writeSlaHistorySnapshot_` ↔ `upsertSlaHistoryRows`
(`JS-018`). `persistDailyCohortHistoryGs_` ↔ `persistDailyCohortHistory`
(`JS-024`) — matching schema, same never-re-archive rule.
`_evidenceAtDeadlineGs_` ↔ `evidenceAtDeadline` (`JS-024`).
`_effectiveRegionGs_` ↔ the reduced Loan override — consistent
(`LOGIC_AUDIT.md` Part 4 §4.5).

## Not live until pasted

Not running until pasted into the Sheet's Apps Script editor. Re-run
`setupMovementTracking()` only when the **cadence** changes.

## UI relationships

N/A — backend. The dashboard's Movement tab (`TAB-007` / `JS-021`) reads
the `Movement_Log` this file writes.

## Architecture relationship

Apps Script backend. Layer 17 (backend automation — the 4×/day hub) in
`LOGIC_AUDIT.md` Part 1 §1. `GS-013` and `GS-006` piggyback on its
trigger.

## Related documentation

`HANDOVER.md` §2, §4.3, §8 (missing-nightly-capture incidents),
`OPS_CHECKLIST.md` (Movement_Log freshness); `LOGIC_AUDIT.md` Part 1
§4d/§5, Part 2 §4, Part 4 §4.5/§4.7; `CLAUDE.md`.

## Relationships

- **Depends On:** `GS-002` (`Core.gs`), `GS-004` (`EmailInfra.gs`),
  `GS-006` (`InteractionHistoryLogger.gs`, piggyback), `GS-012`
  (`SlaEngine.gs`), `GS-013` (`UnmatchedCommentLogger.gs`, piggyback),
  `SHEET-001`, `SHEET-002`, `SHEET-005`, `SHEET-008`, `SHEET-009`,
  `SHEET-010`
- **Used By:** `GS-001`, `GS-003` (all read `Movement_Log` / reuse
  `buildMovementLogMapsGs_`), `GS-009` (`checkMovementLogFreshness_`),
  `GS-010`, `SHEET-002`, `SHEET-005`, `SHEET-008`, `SHEET-009`,
  `SHEET-010`, `DATA-002`, `DATA-004`
- **Related:** `JS-018` / `JS-021` / `JS-024` (the client twins of its
  Movement_Log / SLA_History / cohort writes)

## Source of truth

`MovementTracker.gs` at `HEAD`.

## Validation

- **Method:** full read at `9e55e36` (weekly doc spot-check, cycle 2);
  function + constant list re-verified by grep against the real current
  line numbers (`MOVEMENT_LOG_RETENTION_DAYS = 7` `#L80`; the 4
  `atHour()` triggers `#L1108`; `MOVEMENT_LOG_FRESHNESS_GRACE_HOURS_ = 8`
  `#L1153`; the `Date.now()-7d` cutoff `#L627`) — every `FN-XXX` line
  anchor had drifted since the `c82ec67` verification (the file grew by
  186 lines across several commits in between) and has been corrected;
  cross-check `LOGIC_AUDIT.md` Part 1 §4d/§5 + Part 4 §4.5/§4.7.
  `Tests_MovementTracker.gs` runs in CI.
- **Evidence:** `.github/workflows/test.yml` (`Tests_MovementTracker.gs`,
  last green run); `LOGIC_AUDIT.md` Part 4 §4.7. Revalidated 2026-09-18
  (`2d4a573`): read `removeEarlyCorruptedMovementLogDataNow`'s current
  source directly to confirm the `deleteRows()` fix; real-world cause
  confirmed via the `captureDailyRmIssues_` crash report the user shared
  (`DailyRmIssueLog.gs:219`, same 10M-cell ceiling error). Revalidated
  again 2026-09-21 (`3a19bdb`, authored 10:30 that day — this record's
  own catalog-drift note going unresolved for 2 commits until this pass):
  read the Drive-archive addition to `pruneMovementLog_` directly in
  source; confirmed via the commit's own message that all 778 local
  tests pass, reconfirmed independently this session via `python3
  test/run-gs-tests-headless.py`.
- **Status:** Validated 2026-09-21.

## Version / change reference

**2026-09-26:** the content-hash dedup identity changed from `client_id` to `lead_id|RM` (`FN-296`), in both runtimes. After the 09-25 fixes the dedup worked but still appended 44-62% of open leads per capture, because rows sharing a `client_id` (one customer, several RMs/assignments) could only ever match one stored hash between them; in the last batch ~2,000 of 5,473 appended rows were byte-identical to their previous row and `lead_id|RM` was unique across all of them. No stored hash was migrated (every Movement_Log row already carries its own lead_id, RM and hash), so the deploy causes no re-append burst. Known minor difference, not fixed: for a lead with a blank RM or region the browser hashes `Unassigned` while Apps Script hashes blank, so the two writers still disagree on those rows.

**2026-09-25:** two `content_hash` defects fixed. (1) The live copy hashed with a space where the source had a raw NUL, so its digests differed from the browser's; the separator is now the escape `'\u0000'` and `test/check-staleness.py` detector H flags raw control characters in any `.gs`. (2) `ensureMovementLogSheet_` appended the new `opp_at` header after `content_hash`, misaligning the sheet by one column from 09-22 12:44 and defeating the dedup; the self-heal now inserts before `content_hash` and `assertMovementLogHeaderAligned_` (`FN-282`) refuses to write into a misaligned sheet. The live header was repaired by hand the same day (swap of the two header cells). Regression tests: `Tests_MovementTracker.gs` (legacy-header heal, guard, known-answer hash vector shared with `tests/frontend-harness.html`).

Verified at `9e55e36`; record created by DOC-029, line anchors and the
`pruneMovementLog_` behavior description refreshed 2026-09-15 (weekly
doc spot-check, cycle 2 — no code changed). File grew 945L → 1000L
since the 2026-09-05 audit (cohort-history persist helpers), then
1000L → 1186L since the 2026-09-10 (`c82ec67`) verification: the Lead
History & Versioning content-hash dedup work (Phases 6-8) and the
2026-09-12 `pruneMovementLog_` interruption-safety fix (`16a9ec6`,
`EXC-091`). 1260L → 1276L by 2026-09-21 (`3a19bdb`, the Drive-archive
addition to `pruneMovementLog_`).

**2026-10-07** (`7799e44`, email audit P15/P16 — `docs/_planning/EMAIL_AUDIT.md` F18 and F23). **F18 — the call baselines are keyed by lead id.** `call_attempts` is a per-LEAD lifetime counter (0 of 1,852 multi-row leads differed across their RM copies) but the maps were keyed by `client_id`, so a lead was compared with whichever sibling lead's snapshot came first. On the live data 37 of 764 open Google Non-UTM leads had a different baseline and 3 were wrongly not flagged "Behind on Today's Calls" (lead 2246693: 17 attempts, own baseline 19 = 0 calls today; the shared key held 7 = "10 calls today"); none was wrongly flagged. `_readMovementLogRowsGs_` now keys by lead id (a row with no lead id is dropped); `computeSlaFlags_` (`GS-012`) and the four emailer lookups (`GS-010` x3, `GS-001`) look up by lead id; the dashboard twin is keyed the same (`JS-021` FN-148, `JS-006`, `JS-007`). Customer-level uses are unchanged on purpose (`_readMovementLogHistoryRowsGs_` keeps customer identity for the daily cohort). **F23 — `snapshotPeriodic` stays inside the 30-minute limit.** Measured before the change: `Movement_Log` ~47.8K rows x 26 columns read in full four times per run (SLA baseline, hash lookup, prune, cohort history) and rewritten in full by the prune on nearly every run; durations 209-1,803 s. Now: single-column reads (`FN-342`), a prefix-delete prune with archive-first and the old rewrite as the fallback (`FN-220`, `EXC-109`/`EXC-110`), the core capture first with its run row written right after it, optional phases inside an 840 s budget (`FN-343`, `CFG-094`), `[timing]` log lines, `Movement_Log_Runs` +`total_s`/`skipped_phases` (`SHEET-015`), a run record the hourly watchdog reads (`FN-344`, `CFG-095`). **The speed-up is expected from the reads/writes removed, NOT yet measured live** — read the `[timing]` lines and `total_s` after the first scheduled runs. The SLA_History write now runs AFTER the capture instead of before it: its baseline is "the latest snapshot strictly before the start of today (IST)", so this run's own rows can never be what it reads. +152 lines (1496L -> 1648L; anchors re-mapped). Tests: `Tests_MovementTracker.gs` (per-lead baseline, narrow-read spies, prefix/gap/all-expired/archive-failure prune cases, phase runner, slow-run and prune-failure end to end, runs-sheet heal, run record) — 33 deliberate regressions across both findings each fail a named test (one equivalent mutant: the `downloadNoIssueLeadsNow` lookup only feeds a prefix test both hint branches satisfy). **Not live until pasted.**

**2026-10-07** (`58ab8e1`, email audit P17): a step that throws is no longer only logged. `runSnapshotPhaseGs_` (FN-343) records it; `alertSnapshotPhaseFailuresGs_` (FN-349) emails ops once a day per step; `Movement_Log_Runs` gained `failed_phases` and `phase_s` ("core capture 95s | SLA_History write 14s | ..." - where the run's time went; `SHEET-015`). The trigger was the silent failure of the `Comment_History` / `Unmatched_Comments_Log` prunes: Root cause (found 2026-10-07 on the live data - `Comment_History` held 6,369 rows and `Unmatched_Comments_Log` 2,134 rows past their 30-day retention): the prune proved its Drive archive by counting `split('\n')` lines of the CSV, but a comment containing a line break is ONE record on several lines (the writer quotes it). With 102 multi-line comments the count read 6,518 against 6,369 and the prune threw "Drive archive holds ... but ... were expected - refusing to prune"; the throw was only logged, so nobody was told. The fixtures had only single-line comments. Fixed with `countCsvRecordsGs_` (`GS-002` FN-348). `docs/_planning/EMAIL_AUDIT.md` P17. The first manual `snapshotNow` after the P15/P16 paste took 261 s (`total_s` 259, nothing skipped; earlier normal runs 270-348 s, the 06:08 run timed out at 1,802 s). **Not live until pasted.**

**2026-10-09** (test-only: `Tests_MovementTracker.gs`; `MovementTracker.gs` is unchanged, so nothing to paste into Apps Script): an intermittent `Tests_MovementTracker.gs` failure - `F23 slow run: the Movement_Log_Runs row ... records the changed lead (expected 1, got 2)`, about 1-5% of runs - was a test-fixture artifact, not a production bug. `snapshotOpenLeads_` (`FN-218`) stamps the rows it appends with `new Date()`, and `_latestContentHashByKeyGs_` (and its browser twin `latestMovementLogHashByKey`, `js/tab-movement.js`) keeps the FIRST of two rows of one lead that carry an identical `snapshot_at` (strict `>`). The in-memory mock runs a whole capture in under a millisecond, so two captures of `L-M|Test RM Two` (Prospect, then Opportunity) were stamped the same millisecond; the next capture compared that lead's live hash with the stale Prospect row, counted it as changed, and appended a second row. Production captures are hours apart (`SNAPSHOT_HOURS_`), so the tie cannot happen there and the strict `>` was deliberately left as it is in both runtimes. Fix: every capture in the suite now goes through `capture_`, which waits for the real clock to pass the end of the previous capture (capped; a stuck clock fails by name). No assertion was relaxed - F23 still demands exactly one changed lead. Revalidated by reading `snapshotOpenLeads_` and `_latestContentHashByKeyGs_` directly: this record's description of both still holds. Proof: on a clock coarsened to 20 ms the suite without the wait fails 7 assertions (the F23 one plus six earlier dedup ones - the same latent tie) and with it passes 2714/2714; 150 runs at the originally failing `--at 2026-10-08T00:10:00+05:30 --tz America/Los_Angeles`, 70 runs over 14 clock times x 5 zones and 40 runs under CPU load are all green.

## Revalidation trigger

Any commit touching `MovementTracker.gs` or `Tests_MovementTracker.gs`;
`MOVEMENT_LOG_RETENTION_DAYS`, `SNAPSHOT_HOURS_`,
`MOVEMENT_LOG_FRESHNESS_GRACE_HOURS_`, or `SNAPSHOT_COLUMNS_` changes
(cadence changes also need the setup re-run; column changes must be
**appended** and matched on the `js/sheets-writeback.js` side);
`computeSlaFlags_` (`GS-012`) changes; a piggyback logger's call
contract changes.

## Handover relationship

`HANDOVER.md` §2 names the file ("The 4x/day … snapshot trigger — writes
`Movement_Log` and `SLA_History` rows"); §8 has the missing-capture
incidents. Current as of 2026-09-09. A schema or cadence change must
update `HANDOVER.md` §2/§8 and the `js/` twin in the same commit, and
run `OPS_CHECKLIST.md`'s freshness items.

## Lifecycle / retention

N/A — code. `Movement_Log` (`SHEET-002`) retains **7 days**
(`MOVEMENT_LOG_RETENTION_DAYS`, `pruneMovementLog_`) — one of the two
confirmed retention values in the system.

## Next action

Register `Movement_Log_Runs` as its own `SHEET-XXX` record
(`HOW_TO_REGISTER_A_COMPONENT.md`) — it has existed and been written on
every capture since 2026-09-11 but was never catalogued; flagged here
2026-09-15 (weekly doc spot-check) for a human to action, not fixed in
this pass since registering a new component is a separate process from
correcting an existing record. Otherwise none — Closed + Monitored.
(EXC-074, the machine-clock retention cutoff, is a documented
consistency note, not a defect.)

## Closure evidence

Record committed for DOC-029; `docs/INDEX.md` `GS-008` → `Closed +
Monitored`, `Last Verified` 2026-09-10, links + the 4-trigger schedule
recorded; `CFG-047`..`050`, `EXC-072`..`075`. No `docs/changes/` record
(DOC-029).
