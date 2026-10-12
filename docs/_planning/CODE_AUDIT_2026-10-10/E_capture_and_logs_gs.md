# Code audit E: capture and log files (Apps Script)

Auditor E of 9, 2026-10-10. Read line by line at HEAD `19038e7`: `MovementTracker.gs` (1,718 lines), `DailyRmIssueLog.gs` (1,669),
`UnmatchedCommentLogger.gs` (399), `InteractionHistoryLogger.gs` (270), `LeadFollowupsStaleness.gs` (99). Helpers opened as needed:
`Core.gs` (column mapping, IST helpers, Drive archive helpers), `SlaEngine.gs` (`computeSlaFlags_` baseline use), `StaleLeads.gs`
(`leadStaleStateGs_`), `FollowupEngine.gs` (`latestOutcomeGs_`), and the browser twins `js/core-rm-performance.js` and
`js/tab-movement.js`. Nothing was edited or run against the live Sheet. The only thing run was `python3 test/check-runtime-parity.py`
(local, read-only).

## 1. Scope and summary

These five files are the project's **unattended history layer**. `snapshotPeriodic` (MovementTracker, 00/06/12/18 IST) reads the
leads tab once. It appends one `Movement_Log` row for each lead (lead_id + RM) whose content hash changed since that lead's latest
row, and records the run in `Movement_Log_Runs` and in a Script Properties run record that the watchdog reads. It then runs up to
seven optional phases, in priority order, inside an 840 s start budget: the SLA_History row, the Unmatched_Comments_Log scan, the
Comment_History log, the Movement_Log prune (Drive-CSV archive, then a prefix delete or a full rewrite), two 30-day comment-log
prunes, and the write-once Daily_Cohort_History persist. A failed phase is emailed once per day per phase. `captureDailyRmIssues`
(DailyRmIssueLog, 22:50 IST) writes one row per open, SLA-flagged lead copy into `Daily_RM_Issues`, with 7-day retention. It
writes the date columns as text, repairs dates and refills `lead_assigned_at` (the P18 work), and grows or shrinks its row grid
to fit the night's rows. The same file holds a console-only twin of the browser's RM Performance engine. The two comment loggers
de-duplicate on lead_id + comment timestamp. LeadFollowupsStaleness only installs two conditional-format rules.

The code is careful about crash ordering (archive first, write before clear) and about cell budget. The main defects are
**semantic side effects of the Phase 6 content-hash dedup that the readers never adapted to**:
- backfills and the RM-perf engine assume every lead has a row in every run or on every day;
- the 7-day prune silently re-appends unchanged leads, which resets their "last change" time;
- a date-shaped string is used as a lookup key after Sheets has auto-converted it, which breaks Daily_Cohort_History's
  write-once rule.

## 2. Per-file reference

### 2.1 MovementTracker.gs

**Purpose.** It captures lead history four times a day so that the history survives even when nobody opens the dashboard. It
also hosts the shared Movement_Log readers that every email path uses (call baselines, last snapshot, last change), the
SLA_History writer, the Daily_Cohort_History port, the snapshot run record and watchdog probe, and several one-off cleanups.

**Constants.**
- `MOVEMENT_LOG_SHEET`='Movement_Log' (L79)
- `MOVEMENT_LOG_RETENTION_DAYS`=7 (L80)
- `MOVEMENT_LOG_ROW_HEADROOM_`=5000 (L85)
- `SNAPSHOT_HOURS_`=[0,6,12,18] (L93)
- `SNAPSHOT_COLUMNS_` (L105-132): 23 fields, in this order: lead_id, client_id, RM, TL, project, region, client, lead_assigned_at,
  group_source, source_bucket, current_stage, last_connect, last_connect_time, last_comment, internal_status_comments,
  closing_reason, call_attempts, call_count, duration, stage_comments, rm_is_active, lead_closing_reason, opp_at. New fields are
  appended only, never inserted.
- `CONTENT_HASH_COLUMN_`='content_hash' (L139)
- `CONTENT_HASH_DATE_FIELDS_` (L164): lead_assigned_at, last_connect_time, opp_at
- `MOVEMENT_LOG_RUNS_SHEET_` / `_COLUMNS_` (L190/197): run_at, run_label, lead_count_seen, leads_changed, total_s, skipped_phases,
  failed_phases, phase_s
- `SLA_HISTORY_SHEET_` / `_COLUMNS_` (L308/312)
- `SNAPSHOT_OPTIONAL_PHASE_DEADLINE_SECONDS_`=840 (L578)
- `SNAPSHOT_PHASE_ALERT_PROPERTY_`='SNAPSHOT_PHASE_ALERTED' (L761)
- `DAILY_COHORT_HISTORY_SHEET_` / `_COLUMNS_` (L1005/1008, 12 columns, must match `js/sheets-writeback.js`)
- `SNAPSHOT_RUN_JOB_`='snapshotPeriodic' (L1346)
- `MOVEMENT_LOG_FRESHNESS_GRACE_HOURS_`=8 (L1475)
- `DEDUP_INCIDENT_FROM_` / `_TO_` (L1595-1596)
- `STALE_MOVEMENT_LOG_BACKUP_TAB_` (L1666)

The full row layout is `snapshot_at, snapshot_label, <23 fields>, content_hash`: **26 columns, A..Z exactly** (see E-10).

**Functions, in file order:**

- **`_leadContentHashGs_(getFieldValue)` L165.** Maps each `SNAPSHOT_COLUMNS_` key through the accessor. The three date fields
  become the IST string `yyyy-MM-dd HH:mm:ss` when the value is a real Date, and **'' otherwise**: a date field held as text, or
  any non-Date value, hashes as empty. Other fields become `String(v)`, with null/undefined as ''. The parts are joined with the
  `'\u0000'` escape and hashed with SHA-256 (`Utilities.computeDigest`). Signed bytes are converted to lowercase hex. Returns a
  64-character hex string. Callers: `snapshotOpenLeads_` and `leadStaleStateGs_` (StaleLeads.gs). It must equal the browser's
  hash for identical input; tests assert one shared vector in both runtimes.
- **`ensureMovementLogRunsSheet_(ss)` L199.** Creates the tab (header, frozen row 1). On an existing tab it appends any missing
  header labels to the right; it never reorders.
- **`ensureMovementLogSheet_(ss)` L216.**
  - Creates the tab with the full header.
  - Self-heal: if field labels are missing and `content_hash` exists, it inserts the missing columns *before* `content_hash`
    (the fix for the 2026-09-22..25 incident). Otherwise it appends them at the end.
  - Every call re-applies the datetime format `yyyy-mm-dd hh:mm:ss` to snapshot_at, lead_assigned_at, last_connect_time and
    opp_at across `getMaxRows()-1` rows. That costs 4 range-format calls per run that writes; there is no cell-budget cost.
  - It is only called when the run has at least one changed row.
- **`assertMovementLogHeaderAligned_(sheet)` L290.** Reads the first 26 header cells and throws if any differs from the writer
  layout. Called before every append and by `removeDedupIncidentRowsNow`.
- **`_readMovementLogRowsGs_(ss)` L336.** Reads 5 columns (snapshot_at, lead_id, call_attempts, RM, content_hash) through
  `_readMovementLogColumnsGs_`. For each row with a Date stamp and a lead_id it emits
  `{key: leadId, atMs, call_attempts, dedupKey: leadId|RM, hash}`. If snapshot_at, call_attempts or lead_id is missing it returns
  []. Keyed by **lead id**, not client_id (F18).
- **`_readMovementLogColumnsGs_(sheet, names)` L360.** Reads the header once, then one single-column `getRange` for each name.
  Returns `{rowCount, idx, cols}`. A missing name gets idx -1 and no cols entry. Exact-match header lookup, no trim.
- **`_collapseLatestByKeyGs_(rows, cutoffMs)` L379.** For each key, the latest row strictly before the cutoff:
  `{atMs, call_attempts}`. Pure.
- **`_collapseLatestChangeGs_(rows)` L392.** For each dedupKey (lead|RM), the latest row that has a hash: `{atMs, hash}`. This is
  the stale-lead input (decision D8).
- **`_lastMovementLogSnapshotByKeyGs_(ss, cutoffMs)` L409.** Read plus collapse in one call.
- **`_latestContentHashByKeyGs_(ss)` L423.** Reads 4 columns. Returns `{leadId|RM: hash}` for the latest hashed row of each key,
  whatever its age. Returns {} when the hash column is absent, so every lead writes (fail-safe).
- **`_dedupKeyGs_(leadId, rm)` L459.** `trim(leadId)|trim(rm)`, with a blank RM keyed as 'Unassigned'. Mirrors the browser's
  `movementDedupKey`.
- **`buildTodayCallBaselineGs_(ss, beforeDate)` L471.** Cutoff = IST midnight of `beforeDate`, built with
  `new Date(dayKey+'T00:00:00+05:30')`. Returns `{leadId: call_attempts}` from the latest pre-today snapshot.
- **`lastSnapshotBeforeGs_(ss, beforeDate)` L490.** The latest snapshot strictly before `beforeDate`.
- **`buildMovementLogMapsGs_(ss, now)` L503.** One read; returns `{baselineMap, lastSnapshotMap, lastChangeMap}`. Used by
  AllIssuesEmailer, OvernightEmailer, the DailyRmIssueLog capture, the backfills, and the RM perf engine. Note that
  `lastChangeMap` ignores `now`, so a backfill "as of" call still gets current change data. No backfill caller uses it.
- **`ensureSlaHistorySheet_(ss)` L512.** Create, or append missing headers.
- **`writeSlaHistorySnapshot_(ss, dataRows, colIndex, now)` L542.**
  1. Calls `buildTodayCallBaselineGs_`, which is a **separate** 5-column Movement_Log read on top of the hash read.
  2. Runs `computeSlaFlags_` on each lead row that has a lead_id, and counts open leads, breached leads and per-check totals.
  3. Appends `[istDayKey, openTotal, breachedTotal, 5 counts, 'yyyy-MM-dd HH:mm:ss', 'AppsScript']`.

  The `date` string will be auto-converted by Sheets (see E-3). No upsert, so a double-fire writes a duplicate row.
- **`runSnapshotPhaseGs_(ctx, name, fn, rethrow)` L585.** If elapsed time exceeds `deadlineS`, it pushes the phase onto
  `skipped`, logs, and returns without running it. Otherwise it times `fn()`, pushes `"name Ns"` onto `timings`, and on a throw
  records `failed{phase, message≤400}`. When `rethrow` is set the error also goes onto `errors`. The budget is a **start** gate
  only: a phase that starts at 839 s can run until the platform kill.
- **`snapshotOpenLeads_(label, opts)` L618.** The core capture. Narrative in §3.1. Returns
  `{leadCountSeen, leadsChanged, totalSeconds, skipped, failed, timings}`, or **null** when the leads tab has fewer than 3 rows.
  The null path writes no Movement_Log_Runs row (see E-14).
- **`alertSnapshotPhaseFailuresGs_(failed, label, now)` L762.**
  1. Reads the property `{day, phases}`. An unreadable property counts as nothing alerted yet.
  2. Filters out phases already alerted for today's IST day key.
  3. Calls `notifyOpsAlertGs_(subject, lines)` and writes the property back.
  4. Returns the count of fresh alerts.
- **`pruneMovementLog_(ss)` L834.**
  1. Cutoff = `Date.now()` - 7 days (an absolute instant, not an IST day boundary).
  2. Reads column A only and classifies each row as kept (a Date at or after the cutoff) or expired (anything else, including
     blank or non-Date cells).
  3. **Fast path:** if the expired rows are a contiguous prefix and not every row is expired, it reads those rows at full width,
     archives them, calls `deleteRows(2, n)`, then shrinks.
  4. **Full path:** reads every row at full width, filters, archives the dropped rows, writes the kept rows from row 2, clears the
     leftover tail, then shrinks.
  5. Returns nothing.

  Callers: the snapshot phase (with rethrow), `captureDailyRmIssues_` up front (errors swallowed), and `pruneMovementLogNow`.
- **`archiveDroppedMovementLogRowsGs_(header, dropped)` L894.** Builds the IST min..max date label from Date stamps (else
  'unknown-dates') and calls `archiveRowsToDriveCsv_` **directly**. That means no record-count proof and no deferred manifest,
  unlike the other three prunes (see E-9). It throws if Drive throws, so nothing is deleted after a failed archive.
- **`shrinkMovementLogAllocationGs_(logSheet, keptCount)` L914.** Deletes grid rows beyond `1+kept+5000`. Grow is never needed:
  the next append auto-expands the grid.
- **`pruneMovementLogNow()` L947.** Console wrapper.
- **`ensureDailyCohortHistorySheetGs_(ss)` L1013.** Create only; no header self-heal.
- **`_readMovementLogHistoryRowsGs_(ss)` L1028.** Reads 8 columns. Emits
  `{key: client_id || 'l:'+lead_id, atMs, region, groupSource, stage, closingReason, leadAssignedAt}`. Customer identity is
  deliberate here. Its header comment still says "full-row reader".
- **`_effectiveRegionGs_(groupSource, region)` L1063.** Returns 'Loan' when `normRegionKeyGs_(group_source)==='loan'`, else the
  trimmed region.
- **`_evidenceAtDeadlineGs_(history, deadlineMs, liveEvidence)` L1073.** Takes the latest record at or before the deadline, else
  the first one after it, and returns `{oppOrAbove, isOpenLead}` via `isOppOrAbove_`/`isOpenLead_`, with lead_closing_reason
  passed as ''. If neither exists it returns `liveEvidence`, which may be null.
- **`eligibleDailyCohortDatesGs_(historyRows, now)` L1090.** Collects the creation-day keys (IST, from the earliest row of each
  customer) and keeps a day when `dayEnd(23:59:59 IST) >= earliest snapshot` and `dayEnd + 48h <= now`. Returns them sorted.
- **`_buildLiveLeadIndexGs_(dataRows, colIndex)` L1121.** The first live row of each customer key wins.
- **`computeDailyCohortByRegionGs_(dateKey, historyRows, liveByKey, now)` L1147.**
  - Works over the union of customer keys. The created time comes from the first history row, else from the live row; the
    customer must be created inside the day.
  - Region: `mainRegionForGs_(effectiveRegion)`, or 'Unmapped'.
  - Counts `created`, same-day evidence at `min(dayEnd, now)`, `windowComplete` once 48h have elapsed, and 48h evidence:
    `resolved48h`, `opp48h`, or `closed48h` (not opp and not open).
  - Returns `{region: stats}`.
- **`upsertDailyCohortHistoryRowsGs_(ss, entries, now)` L1221.** Reads column A keys (`date|region`). Matched rows are
  overwritten one row per call; the rest are appended. After an append, the data is sorted by date then region.
- **`_readArchivedDailyCohortDatesGs_(ss)` L1270.** Builds a `{String(colB): true}` set. **This is where E-3 lives.**
- **`persistDailyCohortHistoryGs_(ss, dataRows, colIndex, now)` L1284.** Narrative in §3.1, phase 7.
- **`persistDailyCohortHistoryNow()` L1320.** Reads the leads tab and runs the persist. Its comment says it recomputes "every
  currently-eligible date"; the code only does dates with no row yet.
- **`snapshotPeriodic()` L1347.** The trigger entry point.
  1. Writes run record `running` with `{day, startedAt}`.
  2. Calls `snapshotOpenLeads_(label)`.
  3. On a throw, writes `failed` with the error (≤300 characters) and rethrows. On success, writes `completed` with
     `totalSeconds`, `skipped` and `failed`.
- **`snapshotRunProblemsGs_(now)` L1374.** Watchdog probe, called from `EmailInfra.gs:953`. Returns at most one problem:
  - `stuck`: still `running` more than 35 minutes after start;
  - `failed`;
  - `overdue`: last start more than 8 h ago;
  - `degraded`: completed but skipped phases.

  Marker = `startedAt|kind`. A *failed phase* on a completed run does not count as degraded; it is alerted separately by
  `alertSnapshotPhaseFailuresGs_`.
- **`setupMovementTracking()` L1401.** Ensures both tabs exist, deletes the snapshotPeriodic, snapshotEvening and snapshotMorning
  triggers, and installs 4 `atHour(h).everyDays(1).inTimezone('Asia/Kolkata')` triggers.
- **`snapshotNow()` L1442.** A manual capture. It writes a Movement_Log_Runs row but no run record.
- **`checkMovementLogFreshness_(ss, now)` L1476.** Reads the last `run_at` cell of Movement_Log_Runs. Returns status
  missing/empty/unreadable/fresh/stale against 8 h. Used by OpsChecklistRunner L181.
- **`checkMovementLogFreshnessNow()` L1493.** Console wrapper.
- **`removeEarlyCorruptedMovementLogDataNow()` L1528.** One-off with a hard-coded 2026-09-12 cutoff. Drive backup, then
  **clear-then-write** (the pattern the prune comments call unsafe), then shrink. No null guard on the sheet. See E-13.
- **`removeDedupIncidentRowsNow()` L1597.** One-off. The rows inside the window must be contiguous, and their count must equal
  the sum of leads_changed in Movement_Log_Runs. It archives, counts ISO-stamped line starts, then calls `deleteRows`. Already
  executed (2026-09-25); a re-run is a no-op.
- **`removeStaleMovementLogBackupTabNow()` L1667.** One-off. Checks the header shape, archives in chunks of 5,000, verifies the
  ISO line count, then `deleteSheet`.

**Sheets written:** Movement_Log, Movement_Log_Runs, SLA_History, Daily_Cohort_History (plus the comment logs, through the other
files). **Drive:** `Leads Dashboard Archive/Movement_Log/*.csv` and `archive_log.csv`. **Script Properties:**
`SNAPSHOT_PHASE_ALERTED`, plus `EMAIL_JOB_RUN_snapshotPeriodic` through `writeEmailJobRunGs_`.

**Time zone.** Every day boundary is built from `istDayKeyGs_` plus a literal `+05:30`. Every rendered timestamp uses
`Utilities.formatDate(…, 'Asia/Kolkata', …)`. The retention cutoffs are rolling instants (`Date.now()-7d`), which is fine.

### 2.2 DailyRmIssueLog.gs

**Purpose.** A nightly lead-level audit trail of SLA violations (22:50 IST). It also holds a console-only twin of the RM
Performance engine. Nothing reads `Daily_RM_Issues` programmatically; this was verified with a grep across `js/` and `.gs`.

**Constants.**
- `DAILY_RM_ISSUE_LOG_SHEET_` (L38)
- `_COLUMNS_` (L39, 13 columns): date, RM, region, project, lead_id, client_id, issue_key, issue_label, captured_at, TL,
  group_source, source_bucket, lead_assigned_at
- `_RETENTION_DAYS_`=7 (L85)
- `_ROW_HEADROOM_`=5000 (L99)
- `DAILY_RM_ISSUE_DATE_COLS_`=[0,8,12] (L258)
- `DAILY_RM_ISSUE_DIAG_PROPERTY_` (L259)
- `DAILY_RM_ISSUE_ASSIGNED_COL_`=12 (L438)
- `BACKFILL_CHUNK_SIZE_`=5000 (L829)
- RM-perf constants (L1146-1161)
- `RM_PERF_RULES_GS_` (L1169)
- name aliases (6 pairs), leadership exclusions (5 names), non-RM roles (6), vendor regex, admin exclusions (1 name), L1188-1243.
  These hold real people's names; they are not reproduced here.

**Functions:**

- **`ensureDailyRmIssueLogSheet_` L101.** Create, or append missing headers.
- **`captureDailyRmIssues()` L135.** A try/catch wrapper. On a throw it emails ops (`notifyOpsAlertGs_`, including the stack)
  and rethrows. No run record and no watchdog entry.
- **`captureDailyRmIssues_()` L147.** Narrative in §3.2.
- **`captureDailyRmIssuesNow()` L249.** Same body, no alert wrapper.
- **`dailyRmIssueDateKeyGs_(cell)` L262.** A Date becomes its IST day key. A string becomes its leading `yyyy-mm-dd`, else ''.
- **`repairDailyRmIssueDatesGs_(values, todayKey)` L272.** For every row whose column A is unreadable, it takes a date from (in
  order): its captured_at, the nearest following dated row, the nearest preceding dated row, else today. The resolved key is
  written into `values[i][0]` in place. Returns counters, the first 5 runs of blanks as `{row, len}`, 3 sample lead ids, and the
  indexes. The sample lead ids go to the Script Property; they are lead ids, not personal data.
- **`persistDailyRmIssueColumnGs_(logSheet, values, indexes, colIdx, phase)` L315.** One write covering the first to the last
  changed index, column formatted '@'. The rows in between are rewritten with their own (text-converted) values, then reasserted.
- **`persistRepairedDailyRmIssueDatesGs_` L328.** Wrapper for column A.
- **`dailyRmIssueTextCellGs_(v, colIdx)` L338.** Date → IST text (`yyyy-MM-dd` for column 0, `yyyy-MM-dd HH:mm:ss` otherwise).
- **`dailyRmIssueTextRowsGs_(rows)` L344.** Converts the three date columns in place.
- **`setDailyRmIssueTextFormatGs_(sheet, startRow, numRows)` L352.** `setNumberFormat('@')` on columns A, I and M. Fail-open.
- **`reassertDateColumnsGs_(sheet, startRow, rows, colIdxs, phase)` L368.** For each column: read it back and count cells that
  were written non-blank but came back blank. If any, rewrite the column and read again. If still lost, format '@' and write IST
  text. Every rewrite covers the whole column span. Records diagnostics when anything was found. Cost: up to 3 reads and 2
  writes per column.
- **`recordDailyRmIssueDiagGs_(diag)` L408.** Keeps the last 4 records in the Script Property (the indexes are stripped). Logs.
- **`showDailyRmIssueDiagNow()` L427.** Console.
- **`dailyRmIssueBlankCellGs_` L440.** Blank test.
- **`buildAssignedAtLookupsGs_(ss, leadsRead)` L447.** Builds `leads{id:v}` from the Leads tab (reusing the caller's read), plus
  `movementByDay{id|IST day: v}` (the latest snapshot that day) and `movementLatest{id: v}` from a 3-column Movement_Log read.
  Each source is optional.
- **`refillDailyRmIssueAssignedAtGs_(values, lookups)` L491.** Fills blanks only, in the order day snapshot → leads tab → latest
  snapshot. Counts.
- **`dailyRmIssueNeedsAssignedAtGs_` L514.** A cheap in-memory test.
- **`refillDailyRmIssueAssignedAtNow()` L524.** Console. Reads the whole tab and persists only the filled span.
- **`pruneDailyRmIssueLog_(ss, incomingRowCount, leadsRead)` L562.** Narrative in §3.2.
- **`pruneDailyRmIssueLogNow()` L671.** Console. `incomingRowCount` = 0.
- **`backfillDailyRmIssuesFromMovementLog_(ss)` L710.**
  1. Reads Movement_Log at full width.
  2. Groups rows by IST day and keeps only the rows whose snapshot_at **equals that day's latest timestamp**.
  3. Skips days already present.
  4. Computes flags with `computeSlaFlags_` against a `buildMovementLogMapsGs_(asOf)` baseline, one full map read per day.
  5. Writes everything in **one** `setValues`, without text conversion.

  Returns `{daysBackfilled, daysSkipped, rowsWritten}`. **Broken by the dedup; see E-2.**
- **`backfillDailyRmIssuesFromMovementLogNow()` L816.** Console.
- **`backfillOneDayFromMovementLog_(ss, dayKey)` L852.** The same logic for one day, chunked at 5,000 rows. Same defect.
- **`backfillOneDayFromMovementLogNow(dayKey)` L944.** Defaults to yesterday, computed as `Date.now()-24h` then formatted in IST.
- **`repairDailyRmIssuesMissingFieldsNow()` L982.** One-off. For rows with blank TL/group_source/source_bucket or a blank
  lead_assigned_at, it copies values from the lead's Movement_Log snapshot nearest to captured_at. Writes 3 or 4 whole columns,
  with Date values and no text format, so it could re-trigger the P18c loss.
- **`setupDailyRmIssueLog()` L1094.** Deletes old triggers, installs `atHour(22).nearMinute(50)` IST, ensures the sheet.
- **`rmPerfCanonicalRmNameGs_` L1201.** Alias lookup on the lowercased trimmed name.
- **`buildRmHierarchyRoleByNameLowerGs_(ss)` L1254.** Reads `RM_Hierarchy` columns name and role into a lowercased Map. Returns
  null when the tab is missing or empty.
- **`rmPerfIsLeadershipExcludedGs_(rmName, roleByNameLower)` L1284.** Exact-name sets, the vendor regex, or a role in the
  non-RM set.
- **`_rmPerfDaysBetweenKeysGs_(a, b)` L1300.** Noon-UTC day difference.
- **`computeRmPerfEligibilityGs_(row, colIndex, now)` L1312.** Returns null when lead_assigned_at is not a Date. Otherwise
  returns pastGrace (≥3 h), isUnder48h, isCreatedThatDay (IST), hasConnected, and neverConnectedPastWindow (under 48 h, no
  connect time, and business minutes > 10).
- **`reconstructRmPerformanceObservationsGs_(ss)` L1345.**
  1. Reads Movement_Log at full width.
  2. Drops leadership, vendor and admin RMs.
  3. Keeps the latest row per `leadId|IST day`. **This is keyed by lead_id only**, not lead+RM; see E-6.
  4. For each day, fetches the baseline map (`buildMovementLogMapsGs_`, another 5-column read per day).
  5. For each open, datable entry, emits `{name, leadId, dayKey, rule, violated}` for every eligible rule.
- **`aggregateRmPerformanceGs_` L1431.** RM × rule: eligible and violation lead-days, distinct leads, longest consecutive-day
  violation streak, and the count of chronic leads (streak ≥3).
- **`rmPerfNormalCdfGs_` L1483.** Abramowitz-Stegun erf.
- **`rmPerfBetaPosteriorVarianceGs_` L1497.** Beta posterior variance.
- **`computeRmPerfPeerAveragesGs_` L1507.** Lead-day-weighted rate per rule across all RMs.
- **`classifyRmPerformanceGs_` L1534.**
  - Shrunk rate per rule: `n/(n+8)·raw + 8/(n+8)·peer`, with n = distinct eligible leads.
  - Composite = the weighted sum of shrunk rates. Variance = Σ w²·Var.
  - Classification:
    - Insufficient Data when fewer than 5 distinct leads;
    - otherwise confidence = Φ((composite − 1.25·peerComposite)/√var); below 0.40 → On Track; else concentrated → Watch,
      else Below Expectations;
    - degenerate fallback when the variance is 0.
  - Sorted by composite, descending.
- **`computeRmPerformanceGs_` L1612, `rmPerformanceDrivenByGs_` L1622, `sortRmPerformanceByPriorityGs_` L1638,
  `reportRmPerformanceNow` L1649.** Orchestration and logging of the top 40. Console only.

**Sheets:** Daily_RM_Issues (read/write), Movement_Log (read, and pruned up front), Leads tab (read), RM_Hierarchy (read).
**Drive:** `Leads Dashboard Archive/Daily_RM_Issues`. **Properties:** `DAILY_RM_ISSUE_DIAG`.

### 2.3 UnmatchedCommentLogger.gs

**Purpose.** A review queue of open leads whose latest owner comment has text that matches no OUTCOME rule (outcome 'Update').

**Constants.**
- `UNMATCHED_COMMENTS_LOG_SHEET_`, `_COLUMNS_` (10 columns: date, lead_id, RM, region, project, comment, comment_at, logged_at,
  reviewed, note)
- `_RETENTION_DAYS_`=30
- `_ROW_HEADROOM_`=2000
- `_ARCHIVE_CHUNK_`=5000

**Functions:**

- **`ensureUnmatchedCommentsLogSheet_` L107.** Create with retries and a flush. No header self-heal; columns are read
  positionally.
- **`unmatchedCommentDedupKeyGs_(leadId, entry)` L128.** `leadId|(ts || comment)`.
- **`scanUnmatchedCommentsGs_(ss, dataRows, colIndex, now)` L140.**
  1. Reads columns 1-7 of the existing log and rebuilds the keys; a Date-typed comment_at is reformatted to `yyyy-MM-dd HH:mm`.
  2. For each open lead, calls `latestOutcomeGs_`, skips anything that is not 'Update', and skips keys already logged.
  3. Appends the new rows and adds checkboxes in column I.

  Returns the number appended.
- **`scanUnmatchedCommentsNow` L227.** Console.
- **`clearReviewedUnmatchedCommentsNow` L241.** Keeps unreviewed rows using clear-then-write (manual, accepted risk).
- **`dedupeUnmatchedCommentsNow` L276.** One-off backlog collapse (prefers reviewed, then the earliest logged_at). Note that
  `row[7] < existing[7]` compares whatever types the cells hold.
- **`pruneUnmatchedCommentsLog_(ss)` L336.**
  1. Rows whose `parseIstDayKeyOrDateGs_(date)` is older than now-30d are dropped; unparseable dates are kept.
  2. The dropped rows are archived with `archiveChunksVerifiedGs_` (part-suffixed, record-count proof, rollback).
  3. The kept rows are written first and checkboxes re-inserted, then the tail is cleared, the grid shrunk to kept+2000, and
     the manifest committed.
- **`pruneUnmatchedCommentsLogNow` L397.** Console.

### 2.4 InteractionHistoryLogger.gs

**Purpose.** A forward-only interaction log (`Comment_History`) of each open lead's latest owner comment, with any outcome.

**Constants.**
- `COMMENT_HISTORY_SHEET_`, `_COLUMNS_` (9 columns: date, lead_id, client_id, RM, region, project, comment, comment_at, logged_at)
- `_RETENTION_DAYS_`=30
- `_ROW_HEADROOM_`=2000
- `_ARCHIVE_CHUNK_`=5000

**Functions:** `ensureCommentHistorySheet_` L87, `commentHistoryDedupKeyGs_` L105, `logInteractionHistoryGs_` L116,
`logInteractionHistoryNow` L179, `pruneCommentHistory_` L213, `pruneCommentHistoryNow` L268. They mirror the unmatched logger
exactly, minus the outcome filter and the checkboxes. The prune reads `lastCol` dynamically, where the unmatched prune uses a
fixed 10.

### 2.5 LeadFollowupsStaleness.gs

**Purpose.** Conditional formatting on `Lead_Followups!A2:H1000`: red when updated_at (column G) is more than 24 h old, amber
when more than 12 h. The rules are specified as data in `buildLeadFollowupsStalenessRuleSpecs_` (L58), so they are testable.
`setupLeadFollowupsStalenessFormatting` (L80) replaces the whole rule set. Red is listed first, so it wins.

- `LEAD_FOLLOWUPS_SHEET_` is defined in OvernightEmailer.gs L1293.
- Column G = updated_at is confirmed by OvernightEmailer.gs L1299.
- `NOW()-$G2` assumes G holds a parsed Date and that the spreadsheet's time zone is IST, which the setup steps require.
- Rows beyond 1,000 get no formatting (E-15).

## 3. End-to-end narratives

### 3.1 `snapshotPeriodic` (4 times a day)

1. **Run record `running`.** Written to `EMAIL_JOB_RUN_snapshotPeriodic`.
2. **Read the leads tab.** Row 2 is the header (`buildColIndex_` maps it through `HEADER_ALIASES_`); data starts at row 3. If
   `lastRow<3`, return null. The run record then becomes `completed` with 0 s, and no Movement_Log_Runs row is written.
3. **Core capture.**
   1. `_latestContentHashByKeyGs_`: one 4-column read of the whole Movement_Log.
   2. For each lead row with a lead_id: compute `key=lead|RM` and the hash. When the hash equals the key's latest stored hash,
      skip the row. Otherwise build `[now, label, 23 fields, hash]`.
   3. If anything changed: `ensureMovementLogSheet_` (self-heal plus formats), `assertMovementLogHeaderAligned_`, then one
      `setValues` append.
   4. The appended rows are stamped `now` (one shared timestamp for the whole run, which the backfill grouping relies on).
4. **Run row.** `[now, label, seen, changed, '', '', '', '']` is appended to Movement_Log_Runs straight away, wrapped so a
   failure here cannot block anything.
5. **Optional phases.** Each starts only while elapsed time is under 840 s:
   1. **SLA_History:** its own baseline read, then one appended row.
   2. **Unmatched_Comments_Log scan.**
   3. **Comment_History log.**
   4. **Movement_Log prune**, with rethrow. The prefix fast path or the full rewrite, then a Drive CSV through
      `archiveRowsToDriveCsv_` (an identical-content file is reused), then the grid is shrunk to kept+5000.
   5. **Comment_History prune.**
   6. **Unmatched prune.**
   7. **Daily_Cohort_History persist:**
      1. an 8-column history read;
      2. the eligible dates;
      3. minus the dates already present in column B (E-3);
      4. the live index;
      5. per-day, per-region stats;
      6. upsert, then sort.
6. **Finish the run row.** `total_s`, `skipped_phases`, `failed_phases` and `phase_s` are filled in.
7. **Alert.** `alertSnapshotPhaseFailuresGs_` emails each failed phase once per IST day.
8. **Rethrow** the first prune error, if any, so the execution shows Failed. The run record becomes `failed` in that case,
   otherwise `completed`.

**Cell budget.** Movement_Log is the largest tab (~48K rows × 26 columns before F23). The append auto-grows the grid, and only
the prune shrinks it. `captureDailyRmIssues_` prunes it up front too, so a run of failed snapshots cannot ratchet the grid
forever.

**Concurrency.** There is no `LockService`. The browser also appends to Movement_Log (`js/sheets-writeback.js:880`, using
`INSERT_ROWS`). The full-rewrite prune path reads N rows, writes the kept rows, clears the tail to the *old* lastRow, then deletes
grid rows beyond kept+5000. A browser append that lands between the read and the shrink sits at old-lastRow+1. That position is
deleted when more than 5,000 rows expired. The fast path is safe, because `deleteRows` shifts appended rows up. This race is rare,
since the full path only runs on a non-prefix layout (E-12).

**Dedup lifecycle side effect.** A lead whose content does not change keeps exactly one Movement_Log row. Each run captures
first and prunes later, so when that row passes 7 days it is deleted *after* the capture that still matched it. The next run
finds no stored hash and re-appends the lead, stamped with that run's time. Every unchanged lead therefore gets a fresh row
about every 7 days, with a gap of up to 6 h in which it has no row at all. Consequences: E-1 (stale-lead detection) and E-2 /
E-5 (the backfills and the RM perf engine assume rows exist).

### 3.2 22:50 `captureDailyRmIssues`

1. **Idempotency check.** A one-column read. If any column A cell (a Date, or text) equals today's IST key, return.
   *Consequence:* a run that wrote even one chunk and then died blocks the rest of the night. There is no resume.
2. **Up-front `pruneMovementLog_`.** Errors are logged and swallowed.
3. **Read and compute.** `readLeadsTab_`, then `buildMovementLogMapsGs_(now)`, both with retries.
4. **Build the rows.** For each open lead copy, take its primary issue (`primaryIssueGs_` priority) and build a 13-column row:
   date = `todayKey` as a string, captured_at as IST text, lead_assigned_at as the raw cell (a Date).
5. **No rows → return.** No prune happens on a quiet night either.
6. **`pruneDailyRmIssueLog_(ss, rows.length, leadsRead)`:**
   1. Full read of the tab.
   2. Cutoff = the IST day key of now-7d. Kept rows have day key ≥ cutoff, so today plus the 7 previous days survive (8
      nights).
   3. `repairDailyRmIssueDatesGs_` fills in missing dates (recorded in diagnostics).
   4. Optional `lead_assigned_at` refill.
   5. If nothing expired, persist only the repaired or refilled span.
   6. Otherwise: `archiveChunksVerifiedGs_` (one file, proof, rollback on failure); then write the kept rows (text-converted,
      column formatted '@', reasserted); then clear the tail; then commit the manifest.
   7. **Grid sizing:** `neededRows = 1+kept+incoming+5000`. The grid is shrunk, or **grown up front** with `insertRowsAfter`,
      so the write itself never expands it. If the workbook is at its ceiling, the failure happens here and is caught by the
      wrapper, which emails.
   8. An archive failure throws out of the prune, so **that night's capture is also lost** (an email is sent). That is the price
      of the prune-before-write ordering.
7. **Write.** Rows are converted to text, the target rows formatted '@', then written in 5,000-row chunks with retries. Then
   `reassertDateColumnsGs_` runs over the three date columns.

### 3.3 Comment loggers

Both loggers run inside the snapshot run and reuse its `dataRows`. They:
1. read the existing log's key columns and rebuild `lead|comment_at-or-text`, normalising Date cells back to `yyyy-MM-dd HH:mm`;
2. take each open lead's `latestOutcomeGs_` entry. It considers only owner-attributed or unattributed entries of
   `internal_status_comments`/`stage_comments` split on '|', and prefers the newest timestamped entry that has text. It falls
   back to `last_comment`, which has no timestamp;
3. append the keys they have not seen.

Only the **latest** comment per lead per run is ever seen. Several comments logged between two 6-hourly runs collapse into one
(E-8). The 30-day prunes archive to Drive with proof and only then delete. **Re-log after prune:** once a row ages out, the same
still-latest comment on a still-open lead is no longer in the key set, so it is logged again under a new `date` (E-7).

### 3.4 RM performance console engine (`reportRmPerformanceNow`)

1. Reads Movement_Log at full width.
2. Drops leadership, vendor and admin RMs (exact name list, regex, and RM_Hierarchy role).
3. Keeps the latest row per `lead_id|IST day`.
4. For each day: builds the baseline map for that day, then for each open, datable lead evaluates the eligibility context and
   `computeSlaFlags_` as of the snapshot time, and emits one observation per eligible rule.
5. Aggregates per RM and rule, shrinks toward the peer average, computes the weighted composite and its posterior confidence,
   and classifies.
6. Logs the top 40, sorted by tier then composite.

Parity with the browser (`js/core-rm-performance.js` L529+) holds for the constants, the rule gates and the per-copy split.
`splitHistoryByCopy` also keys by lead_id. Both runtimes therefore share E-5 and E-6.

## 4. Cross-runtime parity notes

- `python3 test/check-runtime-parity.py` reports one mismatch: `HEADER_ALIASES` has two browser-only keys
  (`lead_closing_comment`, `project_region`). CLAUDE.md documents this as legitimate.
- **RM perf constants:**
  - weights 1.5/1.2/1.0/0.8, K=8, minimum volume 5, streak 3, ratio 1.25, breadth ceiling 0.25 and confidence 0.40 are equal on
    both sides;
  - the rule eligibility gates match;
  - the alias, exclusion and role sets are checked by the parity script, except the regex, which is identical by inspection;
  - `rmPerfNormalCdfGs_` and the Beta variance are hand-ported.
- **Content hash / dedup key.** `'\u0000'` separator, IST date rendering and `lead|RM` with 'Unassigned' for a blank RM. Tests
  assert both runtimes against the same literal. Latent drift: both runtimes render a date field held as text as ''.
- **Movement_Log keying.** The baseline maps are keyed by lead_id (F18), matching `js/tab-movement.js`'s
  `buildTodayCallBaseline`.
- **Daily cohort `evidenceAtDeadline`.** The GS port computes `liveEvidence` correctly with `isOppOrAbove_`/`isOpenLead_`. The
  browser has a documented bug (HANDOVER §9.7.3): its live fallback reads fields a raw row lacks, yielding undefined. For a
  customer seen only live, Apps Script counts the real opp/closed state, while the browser counts the customer as resolved but
  not opp, and as **closed** at 48h (`!undefined`). The two writers can therefore write different numbers for the same
  date|region (E-11).
- **Daily_Cohort_History date column.** The browser appends with `valueInputOption=RAW` (text). Apps Script `setValues` lets
  Sheets auto-convert. The same column ends up holding mixed types; see E-3.

## 5. Findings

**E-1 · MED · MovementTracker.gs L657-669 with L834 (prune), StaleLeads.gs L34-42. Unchanged leads are re-appended every ~7
days, which resets their stale-lead clock.** CONFIRMED (code logic).
- *What is wrong:* the capture compares against the latest stored hash. The prune runs after the capture in the same run and
  deletes a lead's only row once it is 7 days old. The next run re-appends the unchanged lead, stamped "now".
- *Effect on the stale-lead check:* `_collapseLatestChangeGs_` treats that row's time as the last observed change. A lead
  untouched for a week therefore:
  1. has no history for up to 6 h ("not stale: no history");
  2. then reads as "not stale" for 24 h, because it "changed" at the re-append;
  3. then reappears with `staleSince` equal to the re-append date instead of the real last change.
- *Failure scenario:* a lead quiet since 1 Oct drops out of the D8 stale block for roughly 30 hours around 8 Oct. When it
  returns, it reads "last update 8 Oct". The StaleLeads.gs header claims "a lead is only ever called stale when it has really
  been quiet", but the converse fails.
- *Fix options:* have the prune keep the newest row per key, or compare against a hash that survives retention.

**E-2 · MED · DailyRmIssueLog.gs L725-745, L883-893. The Movement_Log backfills reconstruct only the leads that changed in the
day's last capture.** CONFIRMED (code logic).
- *What is wrong:* `backfillDailyRmIssuesFromMovementLog_` and `backfillOneDayFromMovementLog_` take the rows whose snapshot_at
  equals the day's latest timestamp. That was "every lead" before Phase 6. Since content-hash dedup, a run writes only the
  changed leads (a small fraction).
- *Failure scenario:* after a missed 22:50 night, `backfillOneDayFromMovementLogNow()` writes a few dozen rows instead of
  thousands. The idempotency guard then permanently blocks a correct refill for that day.
- *Also:* both functions write Date objects without the P18c text conversion, and the multi-day version writes in one unchunked
  call. Their header comments ("every lead captured together in one snapshotOpenLeads_ run") are stale.
- *Fix:* take each lead's latest row at or before the as-of instant, not the rows equal to the latest timestamp.

**E-3 · MED · MovementTracker.gs L1270-1282 (with L1239-1253). Daily_Cohort_History's write-once guard probably never matches
Apps Script-written rows.** SUSPECTED, high confidence.
- *What is wrong:* the persist writes column B (`date`) as a `'yyyy-MM-dd'` string through `Range.setValues`. Sheets
  auto-converts date-shaped strings. The project has confirmed this for `Unmatched_Comments_Log.comment_at`, for
  `Lead_Followups.updated_at`, and through Core.gs L188-201. `_readArchivedDailyCohortDatesGs_` then does `String(cell)`, which
  gives "Thu Oct 08 2026 00:00:00 GMT+0530 …", never equal to `'2026-10-08'`.
- *Effect:* every 6-hourly run treats every still-eligible day (about 5 days) as new, recomputes it, and **overwrites** the row
  (the column A key `date|region` is not auto-converted, so the upsert matches). The header (L990-1002) calls this exact
  behaviour "actively dangerous". As near-deadline snapshots age out, the same-day and 48h evidence falls back to later
  snapshots and silently credits late conversions.
- *Why tests miss it:* the mock `setValues` (Tests_Mocks.gs L131) does not simulate auto-conversion, so the write-once test
  (Tests_MovementTracker.gs L643-647) passes.
- *How to verify live (read only):* check whether `updated_at` on Apps Script rows keeps changing for dates 2-6 days old.
- *Fix:* normalise with `dailyRmIssueDateKeyGs_`/`parseIstDayKeyOrDateGs_`, and/or write column B as '@' text.
- *Same pattern elsewhere:* SLA_History `date` (L562) lands as a Date. No `.gs` reader keys on it.

**E-4 · LOW · DailyRmIssueLog.gs L158-170 with L237-241. A partial nightly write blocks its own retry.** CONFIRMED.
- *What is wrong:* the idempotency guard skips the night if any row carries today's date. If chunk 2 of 3 fails after its
  retries are exhausted, chunk 1 is on the sheet, `captureDailyRmIssues` emails "NOT captured" (misleading: it is partially
  captured), and a manual re-run is a no-op.
- *Effect:* the comment at L228-230 presents "loses only the rows after the failed chunk" as a feature, but there is no
  recovery path. Severity is low because nothing reads this tab programmatically.

**E-5 · MED · DailyRmIssueLog.gs L1364-1391 (and the browser twin js/core-rm-performance.js L539-558). The RM Performance
engine only observes a lead on days its content changed.** CONFIRMED (code logic); this answers HANDOVER §9.7.3 follow-up (2).
- *What is wrong:* the engine takes "latest row per lead per day". Since dedup, a lead with no change on day D has no row on D,
  so it contributes no observation that day.
- *Effect:* stagnant leads (the ones most likely to violate Not Updated, Stuck 48h or Behind on Today's Calls) are
  under-sampled. Leads that are actively worked are over-represented. Rates, streaks (a missing day breaks adjacency, so
  `chronicLeads` falls) and peer averages are all biased toward "fine".
- *Scope:* the GS side is console only. The same defect drives the live Repeat Offenders tab and PDF through the browser twin
  (outside this audit's files; flagged for auditor of `js/core-rm-performance.js`).
- *Fix:* carry each lead's last-known row forward across days inside the retained window.

**E-6 · MED · DailyRmIssueLog.gs L1380 (and js/tab-movement.js L794-806). RM Performance collapses different RMs' copies of one
lead id into one observation per day.** SUSPECTED (depends on how often one lead_id has several RM rows).
- *What is wrong:* MovementTracker's own comments show one lead_id appears on several RM rows (L328-332: "1,852 multi-row
  leads"; dedup is keyed lead|RM for that reason). The engine keys `leadId|day` and keeps the latest row. With equal timestamps
  from one run, the strict `>` keeps the first one met.
- *Effect:* one RM's copy steals the lead-day and the other RM's copy is never scored. Attribution depends on row order or on
  which copy changed last. `splitHistoryByCopy`'s name suggests a per-copy split, but it keys on lead_id only.
- *Fix:* key by `lead|RM` (`_dedupKeyGs_`).

**E-7 · LOW · UnmatchedCommentLogger.gs L140-200 and L336-352; InteractionHistoryLogger.gs L116-154 and L213-230. A comment is
re-logged after its row is pruned at 30 days.** CONFIRMED (code logic).
- *What is wrong:* the dedup key set is built only from rows currently on the sheet. When a lead stays open with the same latest
  comment for more than 30 days, the prune drops its row and the next scan logs it again as new, with a new `date`.
- *Effect:* in Unmatched_Comments_Log it returns to the review queue as unreviewed every 30 days. In Comment_History it creates a
  phantom "new interaction" row (comment_at still holds the original timestamp, so analysis can de-duplicate).

**E-8 · LOW (doc mismatch) · InteractionHistoryLogger.gs L2-4, L48-51. "Every genuinely new comment" is captured only if it is
the latest at a 6-hourly run.** CONFIRMED.
- *What is wrong:* `latestOutcomeGs_` returns one entry per lead. Two or more comments between runs keep only the newest.
- *Also:* two different comments with the same minute timestamp share one key, so the second is never logged.
- *Effect:* the tab under-states real interaction cadence, which is the purpose the header gives it.

**E-9 · LOW · MovementTracker.gs L894-910. The Movement_Log prune skips the verified-archive protocol the other three prunes
use.** CONFIRMED.
- *What is wrong:* `archiveRowsToDriveCsv_` is called directly. There is no record-count proof and the manifest row is written
  *before* the delete.
- *Failure scenario:* if the run dies after the archive but before `deleteRows`, the ledger lists an archive whose rows are still
  live. The next run's expired set is usually a superset, so a second file with overlapping rows is created (the
  identical-content reuse only helps when the set is identical). This is a duplicate-archive class P18 fixed for the other
  tables. No data is lost.

**E-10 · LOW (latent) · MovementTracker.gs L105-132 vs js/tab-movement.js L182. The next column added to Movement_Log silently
breaks browser dedup.** CONFIRMED.
- *What is wrong:* the layout is exactly 26 columns (A..Z), and the browser reads `Movement_Log!A1:Z`. Appending any new field
  to `SNAPSHOT_COLUMNS_` (the documented way to extend it) pushes `content_hash` to column AA.
- *Effect:* the browser would read no hash, its dedup would treat every lead as changed, and its snapshot writes would
  re-append every lead. The Apps Script side would be unaffected.
- *Fix:* widen the browser range or read it by header.

**E-11 · INFO · MovementTracker.gs L1073-1084 vs js/tab-movement.js evidenceAtDeadline. The two runtimes write different cohort
numbers for live-only customers.** CONFIRMED (the browser bug is documented in HANDOVER §9.7.3).
- *Effect:* rows tagged `AppsScript` and rows tagged `Dashboard` for the same date|region can disagree on
  same_day_opp/opp_48h/closed_48h. Whichever writer reaches a date first wins (or, with E-3, Apps Script keeps overwriting).

**E-12 · LOW · MovementTracker.gs L865-889 with js/sheets-writeback.js L880. Race between the full-rewrite prune and a browser
append.** SUSPECTED (needs concurrent timing).
- *Failure scenario:* during the full-rewrite path, a browser `INSERT_ROWS` append lands below the old lastRow. When more than
  5,000 rows expired, `shrinkMovementLogAllocationGs_` deletes that row, and it is lost without being archived. The path is
  rare (it needs a non-prefix layout). There is no LockService, and the browser cannot share an Apps Script lock anyway.

**E-13 · LOW · MovementTracker.gs L1528-1582. The one-off `removeEarlyCorruptedMovementLogDataNow` uses the unsafe
clear-then-write order and claims "Safe to re-run any time".** CONFIRMED.
- *Failure scenario:* re-run today, it would remove nothing (the cutoff is in the past), yet it clears all ~40K+ rows and
  rewrites them in 10K chunks. A platform kill mid-way reproduces the 2026-09-12 data loss (backup = removed rows only, i.e.
  none). It has no `!sheet` guard. Recommend deleting it or guarding with "no-op when removed.length===0".

**E-14 · INFO · MovementTracker.gs L639, L1358-1364. An empty leads tab reports success with no run row.** CONFIRMED.
- *What is wrong:* when `snapshotOpenLeads_` returns null, the run record says `completed` with 0 s and no Movement_Log_Runs row
  is written.
- *Effect:* `checkMovementLogFreshness_` then goes stale while `snapshotRunProblemsGs_` reports nothing. The two health signals
  disagree. Harmless in practice (it only happens when the leads tab is empty).

**E-15 · INFO · LeadFollowupsStaleness.gs L48, L88. Staleness formatting covers only rows 2-1000.** SUSPECTED relevance. If
Lead_Followups ever exceeds 999 data rows, the later rows get no amber or red warning. Re-running the setup with a larger range
is cheap.

**E-16 · LOW · Stale comments.** CONFIRMED. Each item below is a comment that no longer matches the code.
- MovementTracker.gs L1-8 and L606-610: "appends one row per lead". Since Phase 6 it is changed leads only.
- MovementTracker.gs L1336-1339 and L1426: "every-N-hours trigger … known limitation note above". The header has no such note,
  and the triggers are `atHour`.
- MovementTracker.gs L1023-1027: "Full-row Movement_Log reader". It reads 8 columns.
- MovementTracker.gs L1262-1265: orchestrator comment sits above the wrong function.
- MovementTracker.gs L1314-1319: "recomputes … every currently-eligible date". The code only does new dates.
- MovementTracker.gs L1573: anchor "#L644" is stale.
- MovementTracker.gs L29-36: the REQUIRES list omits InteractionHistoryLogger.gs.
- DailyRmIssueLog.gs L821-828: "captureDailyRmIssues_ … writes its whole night in ONE call". It is chunked.
- DailyRmIssueLog.gs L561: "line ~144" is stale.
- DailyRmIssueLog.gs L64-84 and InteractionHistoryLogger.gs L12-24: the volume arguments assume a full row per lead per run
  (pre-dedup).

**E-17 · INFO · MovementTracker.gs L164-170. Date fields held as text are invisible to the content hash.** SUSPECTED relevance.
A lead_assigned_at, last_connect_time or opp_at value that is not a real Date contributes '' to the hash. If the CRM sync ever
delivers one of these columns as text, changes to it stop producing new Movement_Log rows (and stale detection would miss them).
Both runtimes behave the same way, so parity holds.

**E-18 · LOW · MovementTracker.gs L662-677. Duplicate lead|RM rows in the leads tab are re-appended on every run.** SUSPECTED
(depends on the source data).
- *What is wrong:* two rows with the same lead_id and RM but different content are both appended. The rows share a timestamp, and
  the strict `>` in `_latestContentHashByKeyGs_` keeps the first. On the next run the second row's hash differs, so it is
  appended again.
- *Effect:* this repeats forever, and `leadStaleStateGs_` would call the second copy permanently "changed".

**E-19 · INFO · UnmatchedCommentLogger.gs L202-213, InteractionHistoryLogger.gs L156-169. Comments can be parsed as formulas or
numbers.** SUSPECTED.
- *What is wrong:* free-text comments go in through `setValues` with automatic parsing. A comment beginning with `=`, `+` or `-`
  (for example a phone number such as "+91 …") may be stored as a formula error or a number.
- *Effect:* the stored text no longer equals the key text, so the no-timestamp fallback key never matches and the comment is
  re-logged every run. Formatting the comment column '@' would close this.

## 6. Open questions

1. **E-3.** Do Apps Script-written `Daily_Cohort_History` rows for dates 2-6 days old show `updated_at` changing every 6 h? A
   read-only check in the live sheet settles E-3.
2. **P18c.** The capture lost Date cells in 5,000-row chunks into Daily_RM_Issues. Movement_Log's append also writes Date
   objects (snapshot_at, lead_assigned_at, …) in one `setValues`, and occasionally a large one (the weekly re-append wave, or
   ~12K rows after a hash change). Has Movement_Log ever shown blank snapshot_at cells? Blank stamps would be dropped by the
   readers and pruned as "expired" (archived first, but removed).
3. **E-6.** How many live lead_ids actually carry more than one RM row today? This sets its real impact.
4. **Rows silently dropped by the backfills.** Should the backfills (E-2) be fixed or removed? Both are console-only, and
   `repairDailyRmIssuesMissingFieldsNow` is a finished one-off.
5. **E-4.** Is the 22:50 job's lack of a watchdog run record (unlike `snapshotPeriodic`) deliberate? Its crash email covers a
   throw but not a timeout kill: a platform kill skips the catch, so no email is sent.
