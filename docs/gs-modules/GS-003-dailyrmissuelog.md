# GS-003 — DailyRmIssueLog.gs

| | |
|---|---|
| **Type** | `GS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `DailyRmIssueLog.gs` (1781 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-10-19 against commit `94a90c4` - re-read against 4b83dae (SLA rule changes: Not Updated stage-only, "No follow up in last 4 hours", 3 calls a day); 2026-10-19 change note matches the code; line count corrected 1783 -> 1781 |

## Purpose / reason to exist

Two features in one file:
**(a)** a nightly (22:50 IST) snapshot of every open, SLA-flagged lead
into `Daily_RM_Issues` — the audit trail the dashboard's Repeat
Offenders tab (`TAB-004`) reads;
**(b)** a **console-only** RM Performance leaderboard
(`reportRmPerformanceNow()` → `Logger.log()` only, run by hand from the
Apps Script editor) — the `.gs` mirror of `js/core-rm-performance.js`
(`JS-008`). It exists so "repeat offender" history survives even when
nobody has the dashboard open, and so a maintainer can sanity-check the
scoring from the editor.

## Responsibilities

- `captureDailyRmIssues` / `captureDailyRmIssues_` — the nightly
  census. Since 2026-09-25 it first calls `pruneMovementLog_` (`GS-008`)
  — after the idempotency guard, before the company scan — to free
  Movement_Log's stale rows/grid before anything else runs (`EXC-099`).
  Since 2026-10-13: checks the header order first (DR-11), and "tonight
  is done" is the `DAILY_RM_ISSUE_DONE` Script Property written after the
  last chunk (DR-03) - a partly written night is completed by a re-run
  that appends only the missing leads.
- `pruneDailyRmIssueLog_` — 7-day retention (added 2026-09-07 after a
  cell-limit incident; **fixed again 2026-09-19/21** — see `EXC-097`).
  Now archives dropped rows to Drive via `archiveRowsToDriveCsv_`
  (`GS-002`) before clearing them, and both shrinks AND grows the sheet's
  row grid to fit `kept.length + incomingRowCount` exactly.
- `backfillDailyRmIssuesFromMovementLog_` / `backfillOneDayFromMovementLog_`
  — rebuild past days from `Movement_Log`; since 2026-10-13 each lead's
  state is its latest row at or before the day's last snapshot (DR-01),
  written through the capture's own write path (DR-06/07).
- `computeRmPerformanceGs_` + `reconstructRmPerformanceObservationsGs_` /
  `aggregateRmPerformanceGs_` / `computeRmPerfPeerAveragesGs_` /
  `classifyRmPerformanceGs_` — the `.gs` scoring mirror. Classification is
  now gated on posterior confidence, not a raw point estimate
  (`rmPerfNormalCdfGs_`/`rmPerfBetaPosteriorVarianceGs_`, added
  2026-09-30 — byte-for-byte port of `JS-008`, HANDOVER.md §9.7.5).
- `reportRmPerformanceNow` — the console leaderboard.
- `setupDailyRmIssueLog` — install the 22:50 trigger.

## Trigger schedule

`setupDailyRmIssueLog()` (`#L771`) installs `captureDailyRmIssues` on
`atHour(22).nearMinute(50).everyDays(1).inTimezone('Asia/Kolkata')`
(`LOGIC_AUDIT.md` Part 1 §5). The leaderboard side
(`reportRmPerformanceNow`) has **no trigger** — it is manual, editor-run.

## Requires `setupXxx()` re-run when

Only when the **capture schedule** changes. A change to the capture
logic, the retention days, or any `RM_PERF_*_GS_` constant takes effect
on the next 22:50 fire (or the next manual `reportRmPerformanceNow()`
run) automatically — no `setupDailyRmIssueLog()` re-run needed
(`CLAUDE.md` gotcha).

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-187 | `captureDailyRmIssues()` / `captureDailyRmIssues_()` `#L135/#L210` | `leads` tab, `Movement_Log` | appends a row per open SLA-flagged lead to `Daily_RM_Issues` | Sheets write in **chunks of `BACKFILL_CHUNK_SIZE_ = 5000`** (after a real 2026-09-01 incident where one oversized `setValues()` silently failed for a whole night), via `writeDailyRmIssueRowsGs_` (FN-505) since 2026-10-13; order since 2026-10-13: header-order check (FN-504; misaligned = ops alert, return, nothing written - DR-11), then the idempotency check on the `DAILY_RM_ISSUE_DONE` marker (FN-503, DR-03 - was "any row dated today"); rows already dated today without the marker are a partial night and only the missing lead_ids are appended; the Daily_RM_Issues prune now runs on a quiet night too (DR-04); the marker is set after the last chunk, or on a quiet night after the prune; the crash alert now says the night may be partly written and to re-run `captureDailyRmIssuesNow()` (DR-12) | `computeSlaFlags_` (`GS-012`), `buildMovementLogMapsGs_` (`GS-008`), `ensureDailyRmIssueLogSheet_` (FN-188), `pruneDailyRmIssueLog_` (FN-188, now called AFTER `rows.length` is known, passing it in) | the 22:50 trigger; `captureDailyRmIssuesNow()` (manual) | specific — scheduled |
| FN-188 | `ensureDailyRmIssueLogSheet_(ss)` / `pruneDailyRmIssueLog_(ss, incomingRowCount)` / `sizeDailyRmIssueGridGs_(logSheet, keptRows, incomingRowCount)` `#L101` / `pruneDailyRmIssueLogNow()` `#L650/#L740/#L770` | spreadsheet (+ the caller's about-to-be-written row count, added 2026-09-19) | ensures the tab; prunes rows older than 7 days, sizing the sheet's row grid to `kept.length + incomingRowCount + headroom` exactly (shrinks OR grows) | may create the tab; deletes/inserts rows; archives dropped rows to Drive before clearing them - since 2026-10-13 in 5,000-row files (`DAILY_RM_ISSUE_ARCHIVE_CHUNK_` `#L729`, DR-09; was one file per prune); an EMPTY tab still has its grid sized (`sizeDailyRmIssueGridGs_`, DR-05) | `archiveRowsToDriveCsv_` (`GS-002` FN-265) | FN-187 | specific — retention added 2026-09-07, the incoming-count sizing + archive fix added 2026-09-19/21 (`EXC-097`) |
| FN-189 | `backfillDailyRmIssuesFromMovementLog_(ss)` / `backfillOneDayFromMovementLog_(ss, dayKey)` / `repairDailyRmIssuesMissingFieldsNow()` `#L904/#L965/#L1039` | `Movement_Log` history | rebuilds past `Daily_RM_Issues` days (since 2026-10-13 from FN-506's per-lead reconstruction, DR-01; both refuse a misordered header, FN-504) | chunked, text-dated writes through FN-505 (DR-06/07; were one unchunked `setValues`); the repair writes only the span of rows that changed per column through FN-363 (DR-08; was four whole-column rewrites) | `_evidenceAtDeadlineGs_` (`GS-008`), `computeSlaFlags_` (`GS-012`) | manual recovery | specific |
| FN-190 | `computeRmPerformanceGs_(ss)` `#L1724` | `Movement_Log` | the scored per-RM leaderboard (in memory) | none | FN-191..FN-194 | `reportRmPerformanceNow` (FN-195) | specific — **the `.gs` mirror of `computeRmPerformance` (`JS-008`)** |
| FN-191 | `reconstructRmPerformanceObservationsGs_(ss)` / `aggregateRmPerformanceGs_(observations)` `#L1431/#L1543` | `Movement_Log` rows / observations | per-(lead,day,rule) observations → per-group aggregates; **since 2026-10-13 (DR-02), with `RM_PERF_FORWARD_FILL_CAPTURE_DAYS_GS_` on (CFG-140), a lead with no `Movement_Log` row on a capture day after its first row is observed that day from its latest earlier row, timed at that day's last snapshot (RULE-082); the stand-in row still passes the leadership exclusion** | none | `computeRmPerfEligibilityGs_` (FN-193), `computeSlaFlags_` (`GS-012`) | FN-190 | specific — mirrors `JS-008` FN-053/FN-054 |
| FN-192 | `rmPerfCanonicalRmNameGs_(rawName)` / `rmPerformanceDrivenByGs_(r)` / `sortRmPerformanceByPriorityGs_(list)` `#L1256/#L1734/#L1750` | RM name / a result row | canonical name / driver list / sorted list | none | — | FN-190 | reusable — twin of `JS-008` `rmPerfCanonicalRmName` etc. |
| FN-193 | `computeRmPerfEligibilityGs_(row, colIndex, now)` / `_rmPerfDaysBetweenKeysGs_(a, b)` / `rmPerfDateCellGs_(v)` `#L1383/#L1355/#L1378` | a row + now | the eligibility window (separately implemented — it does **not** reuse `computeSlaFlags_` for eligibility, only for pass/fail; a KEEP IN SYNC note with `computeSlaFlags_` was added 2026-10-13, DR-10; since then the two date cells are read through `parseSlaDateGs_` (`GS-012`) when it exists, so text dates parse as IST like `computeSlaFlags_` does) | none | `istDayKeyGs_` (`GS-002`) | FN-191 | specific |
| FN-194 | `computeRmPerfPeerAveragesGs_(byGroup)` / `classifyRmPerformanceGs_(byGroup)` `#L1619/#L1646` | per-group aggregates | peer-average baseline per rule → classification (`Below Expectations` / `Insufficient Data` / …) + shrunk score + `confidence`/`compositeVariance` (added 2026-09-30) | none | `RM_PERF_*_GS_` constants, FN-319 | FN-190 | specific — mirrors `JS-008` FN-055/FN-056; classification now gated on posterior confidence, see HANDOVER.md §9.7.5 |
| FN-195 | `reportRmPerformanceNow()` / `setupDailyRmIssueLog()` `#L1761/#L1149` | — | **`Logger.log()` console output only** — no sheet write, no email / installs the trigger; log line now includes confidence % when not null | console log / creates a trigger | FN-190 / `ScriptApp` | Apps Script editor (manual) / editor | specific |
| FN-319 | `rmPerfNormalCdfGs_(z)` / `rmPerfBetaPosteriorVarianceGs_(peer, raw, n, K)` `#L1595/#L1609` (added 2026-09-30) | a z-score / a Beta-posterior's parameters | standard-normal CDF probability / the posterior's variance | none | — | FN-194 | reusable — BYTE-FOR-BYTE port of `JS-008` FN-317, kept in parity by hand + identical reference-value tests |
| FN-354 | `dailyRmIssueDateKeyGs_(cell)` `#L350` | a `date`/`captured_at` cell (Date or string) | `'yyyy-MM-dd'` (IST) or `''` when unreadable | none | `istDayKeyGs_` | `pruneDailyRmIssueLog_`, `repairDailyRmIssueDatesGs_` | specific - **added 2026-10-08 (email audit P18)** |
| FN-355 | `repairDailyRmIssueDatesGs_(values, todayKey)` `#L360` | the sheet's rows as read for the prune | `{rows, blank, fromCapturedAt, fromNeighbour, fromToday, blocks, sampleLeadIds, indexes}`; sets `row[0]` of each undated row **in place** | none | FN-354 | `pruneDailyRmIssueLog_` | specific - **added 2026-10-08**; gives an undated row a date: its own `captured_at`, else the nearest FOLLOWING dated row (a later date only keeps a row longer), else the nearest PRECEDING, else today - EXC-113 |
| FN-356 | `persistRepairedDailyRmIssueDatesGs_(logSheet, values, indexes)` `#L416` | the repaired rows | none | writes the repaired date cells (column A) back, one contiguous run at a time, then re-asserts them | FN-357 | `pruneDailyRmIssueLog_` when nothing else is rewritten | specific - **added 2026-10-08** |
| FN-357 | `reassertDateColumnsGs_(sheet, startRow, rows, colIdxs, phase)` `#L456` | a range just written and the rows it should hold | `{checked, blankFound, rewrittenCols, escalatedCols}` | reads the date columns back; re-writes any that came back blank; if a plain re-write still reads blank, stores that column as TEXT (`setNumberFormat('@')`, IST string); records what it found (FN-358), **never emails** | `withRetry_`, FN-358 | `captureDailyRmIssues_` (after the write), `pruneDailyRmIssueLog_` (after the rewrite / repair) | specific - **added 2026-10-08**; EXC-112 |
| FN-358 | `recordDailyRmIssueDiagGs_(diag)` / `showDailyRmIssueDiagNow()` `#L496/#L515` | an observation | the last 4 observations in the `DAILY_RM_ISSUE_DIAG` Script Property; `showDailyRmIssueDiagNow` logs them (Run from the editor, log-only) | `PropertiesService`, `Logger` | - | FN-355/357 callers | specific - **added 2026-10-08**; fail-open |
| FN-359 | `dailyRmIssueBlankCellGs_(c)` `#L528` | a cell value | `true` for `''`, `null`, `undefined` or an invalid Date | none | - | FN-360..FN-362 | specific - **added 2026-10-08 (email audit P18b)** |
| FN-360 | `buildAssignedAtLookupsGs_(ss, leadsRead)` `#L535` | the spreadsheet; the caller's own `{colIndex, dataRows}` read of the Leads tab, or `null` | `{leads: {leadId: value}, movementByDay: {'leadId\|yyyy-MM-dd': value}, movementLatest: {leadId: value}, leadsOk, movementOk}` | none (reads the Leads tab unless handed one, and three single columns of `Movement_Log`); each source is optional - one that cannot be read is logged and skipped | `readLeadsTab_`, `_readMovementLogColumnsGs_` (`GS-008`), `getVal_`, `istDayKeyGs_` | `pruneDailyRmIssueLog_`, FN-362 | specific - **added 2026-10-08**; for a day it keeps the LATEST snapshot of that day |
| FN-361 | `refillDailyRmIssueAssignedAtGs_(values, lookups)` / `dailyRmIssueNeedsAssignedAtGs_(values)` `#L579/#L602` | the sheet's rows; the lookups | `{rows, blank, filled, fromMovementDay, fromLeads, fromMovementLatest, noSource, indexes}`; fills `row[12]` in place | none (pure) | FN-354, FN-359 | `pruneDailyRmIssueLog_`, FN-362 | specific - **added 2026-10-08**; fills a blank `lead_assigned_at` from that day's `Movement_Log` snapshot, else the Leads tab today, else the lead's latest snapshot; never touches a populated cell - EXC-114 |
| FN-362 | `refillDailyRmIssueAssignedAtNow()` `#L612` | none | the counts (also logged) | writes every blank `lead_assigned_at` that has a source (fill only); Run from the editor | FN-360, FN-361, FN-363 | the Apps Script editor (manual) | specific - **added 2026-10-08** |
| FN-363 | `persistDailyRmIssueColumnGs_(logSheet, values, indexes, colIdx, phase)` `#L403` | rows and the 0-based indexes whose one column changed | none | writes that column back, one contiguous run at a time, then re-asserts it (FN-357); FN-356 is now a thin wrapper over it for column A | FN-357 | FN-356, `pruneDailyRmIssueLog_`, FN-362 | specific - **added 2026-10-08** |
| FN-364 | `dailyRmIssueTextCellGs_(v, colIdx)` `#L426` | a cell value and its 0-based column | a valid Date becomes its IST text (`yyyy-MM-dd` for column A, `yyyy-MM-dd HH:mm:ss` for I and M); an invalid Date becomes `''`; anything else is returned as is | none (pure) | `Utilities.formatDate` | FN-365, FN-363 | specific - **added 2026-10-08 (email audit P18c)** |
| FN-365 | `dailyRmIssueTextRowsGs_(rows)` `#L432` | rows about to be written | the same rows, with the Date cells of columns A, I and M converted to IST text **in place** | none | FN-364 | `captureDailyRmIssues_` (before the chunked write), `pruneDailyRmIssueLog_` (the kept rows, after the archive) | specific - **added 2026-10-08** |
| FN-366 | `setDailyRmIssueTextFormatGs_(sheet, startRow, numRows)` `#L440` | the target range | none | formats columns A, I and M of those rows as plain text (`setNumberFormat('@')`) BEFORE the values are written; fail-open | `Range.setNumberFormat` | `captureDailyRmIssues_`, `pruneDailyRmIssueLog_` | specific - **added 2026-10-08** |
| FN-503 | `dailyRmIssueDoneDayGs_()` `#L157` / `markDailyRmIssueDoneGs_(dayKey)` `#L167` / `dailyRmIssueLeadIdsForDayGs_(logSheet, dayKey)` `#L195` (added 2026-10-13, DR-03) | - / an IST day key / the sheet + a day key | the day key in Script Property `DAILY_RM_ISSUE_DONE` (`''` when unreadable - then the per-lead check decides) / nothing / `{count, ids: {leadId: true}}` of the rows already dated that day (reads columns A..E only) | reads / writes the Script Property (through `withRetry_`) | `PropertiesService`, `dailyRmIssueDateKeyGs_` (FN-354) | FN-187 | specific - the completion marker: only it means "tonight is done"; without it a re-run appends only the missing lead_ids (append-only, never deletes) |
| FN-504 | `dailyRmIssueHeaderMisalignmentGs_(logSheet)` `#L176` / `assertDailyRmIssueHeaderAlignedGs_(logSheet)` `#L189` (added 2026-10-13, DR-11) | the `Daily_RM_Issues` sheet | `''` when the first `DAILY_RM_ISSUE_LOG_COLUMNS_.length` headers match exactly, else the first mismatch / throws on a mismatch | none (reads row 1) | `withRetry_` | FN-187 (alert + return), FN-189 (throw) | specific - rows are written by position, so a hand-reordered header would put every value under the wrong heading; extra columns after ours are allowed |
| FN-505 | `writeDailyRmIssueRowsGs_(logSheet, rows, phase)` `#L317` (added 2026-10-13, DR-06/07) | rows in `DAILY_RM_ISSUE_LOG_COLUMNS_` order + a phase label | none | grows the row grid FIRST when the rows would not fit (so a full workbook fails before any write), converts the date columns to IST text (FN-365/366), writes in `BACKFILL_CHUNK_SIZE_` chunks with `withRetry_`, then re-asserts the date columns (FN-357) | FN-357, FN-365, FN-366 | FN-187 (`capture-write`), FN-189 (`backfill-write`, `backfill-one-day-write`) | specific - the one write path for this tab |
| FN-506 | `dailyRmIssueStatesByDayGs_(allRows, snapAtIdx, colIndex, onlyDayKey)` `#L783` / `dailyRmIssueRowsForStateGs_(ss, state, colIndex)` `#L812` / `readMovementLogForBackfillGs_(ss)` `#L847` / `dailyRmIssueCapturedDaysGs_(logSheet)` `#L861` (added 2026-10-13, DR-01) | `Movement_Log` rows / one reconstructed day / spreadsheet / the sheet | `[{dayKey, asOf, rows}]` ascending - per lead_id its LATEST row at or before that day's last `snapshot_at`, whichever day it is from / that day's `Daily_RM_Issues` rows (open + flagged as of `asOf`, same columns and rules as the capture) / `{snapAtIdx, colIndex, allRows}` or null / `{dayKey: true}` already captured | none (reads) | `buildMovementLogMapsGs_` (`GS-008`), `computeSlaFlags_` (`GS-012`), `isOpenLead_`, `primaryIssueGs_` | FN-189 | specific - since content-hash dedup a run writes rows only for CHANGED leads, so the old "rows stamped with the day's last run" missed every untouched lead. Limit: a lead whose last row aged out of `Movement_Log` cannot be rebuilt |

## Business rules implemented — `RULE-XXX` sub-table

| ID | Rule | Where | Duplicated elsewhere? |
|---|---|---|---|
| RULE-082 | RM Performance forward-fill (2026-10-13, DR-02): since `Movement_Log`'s content-hash dedup, "no row that day" means "unchanged", not "not observed". On every capture day (an IST day with at least one `Movement_Log` row) after a lead's first retained row, a lead with NO row that day is observed from its latest earlier row, evaluated as of that day's last snapshot; a day on which the lead has rows is never filled (even when they are all excluded); the stand-in row still goes through the leadership exclusion. Switch: CFG-140 | FN-191 | yes - `JS-008` `reconstructRmPerformanceObservations` (twin, `RM_PERF_FORWARD_FILL_CAPTURE_DAYS`); keep identical |

## Config constants — `CFG-XXX` sub-table

| ID | Constant | Value | Meaning | Changing it affects |
|---|---|---|---|---|
| CFG-031 | `RM_PERF_RULE_WEIGHTS_GS_` | `isNotUpdated 1.5`, `followupOverdue 1.2`, `underCalledToday 1.0` | per-rule severity weights | the leaderboard; **must stay numerically identical to `RM_PERF_RULE_WEIGHTS` (`JS-008` CFG-013)** |
| CFG-032 | `RM_PERF_SHRINKAGE_K_GS_` | `8` | shrinkage strength | twin `RM_PERF_SHRINKAGE_K` (`JS-008` CFG-014) |
| CFG-033 | `RM_PERF_MIN_VOLUME_LEADS_GS_` | `5` | "Insufficient Data" floor | twin `RM_PERF_MIN_VOLUME_LEADS` (`JS-008` CFG-015) |
| CFG-034 | `RM_PERF_CHRONIC_STREAK_DAYS_GS_` / `RM_PERF_FLAG_RATIO_GS_` / `RM_PERF_CONCENTRATION_BREADTH_CEILING_GS_` | `3` / `1.25` / `0.25` | chronic / classification / concentration | twins `CFG-016`..`CFG-018` (`JS-008`) |
| CFG-035 | `BACKFILL_CHUNK_SIZE_` | `5000` | max rows per `setValues()` write | write reliability — the 2026-09-01 incident fix |
| CFG-036 | retention | 7 days | how far back `Daily_RM_Issues` is kept | `pruneDailyRmIssueLog_` (added 2026-09-07) |
| CFG-076 | `RM_PERF_VENDOR_NAME_PATTERN_GS_` / `RM_PERF_ADMIN_NAME_EXCLUSIONS_GS_` (added 2026-09-29) | `/futwork/i` / `{Snehil Chhimwal}` | non-RM identities excluded entirely from `rmPerfIsLeadershipExcludedGs_` | twin `RM_PERF_VENDOR_NAME_PATTERN` / `RM_PERF_ADMIN_NAME_EXCLUSIONS` (`JS-008` CFG-075) |
| CFG-079 | `RM_PERF_CONFIDENCE_THRESHOLD_GS_` (added 2026-09-30) | `0.40` — deliberately below 0.5, not a typo | posterior-confidence flagging bar for the violation composite | `classifyRmPerformanceGs_` (FN-194); twin `RM_PERF_CONFIDENCE_THRESHOLD` (`JS-008` CFG-077, parity-checked); HANDOVER.md §9.7.5 has the full derivation |
| CFG-139 | `DAILY_RM_ISSUE_DONE_PROPERTY_` `#L155` (added 2026-10-13, DR-03) | `'DAILY_RM_ISSUE_DONE'` | the Script Property holding the IST day key (`yyyy-MM-dd`) of the last night whose capture finished (after its last chunk, or after the prune on a quiet night); the idempotency guard skips only when it equals today | FN-503, FN-187 |
| CFG-140 | `RM_PERF_FORWARD_FILL_CAPTURE_DAYS_GS_` `#L1410` (added 2026-10-13, DR-02) | `true` | forward-fill a lead's last known row onto capture days on which it has no row (RULE-082); `false` = the pre-2026-10-13 behaviour | FN-191 and the leaderboard's rates, streaks and classifications; **must stay identical to `RM_PERF_FORWARD_FILL_CAPTURE_DAYS` in `js/core-rm-performance.js` (`JS-008`) - flip both together** |
| CFG-097 | `DAILY_RM_ISSUE_DATE_COLS_` `#L346` | `[0, 8, 12]` | the Date-typed columns re-asserted after every write: `date`, `captured_at`, `lead_assigned_at` | FN-357; **added 2026-10-08** |
| CFG-098 | `DAILY_RM_ISSUE_DIAG_PROPERTY_` `#L347` | `'DAILY_RM_ISSUE_DIAG'` | the Script Property that keeps the last 4 date-integrity observations | FN-358; **added 2026-10-08** |
| CFG-099 | `DAILY_RM_ISSUE_ASSIGNED_COL_` `#L526` | `12` | the 0-based index of `lead_assigned_at`, the column the refill fills | FN-359..FN-362; **added 2026-10-08** |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-060 | an oversized `setValues()` write | **chunked into 5000-row batches** | (historical) a whole night's capture silently lost — fixed |
| EXC-061 | `Daily_RM_Issues` grows past the workbook cell ceiling | `pruneDailyRmIssueLog_` trims to 7 days | (historical) a real cell-limit incident — fixed 2026-09-07 |
| EXC-062 | a run takes very long / writes nothing | shows in Apps Script Executions; a documented past incident (~8 min, wrote nothing — `HANDOVER.md` §2/§9) | Repeat Offenders shows stale data until the next successful capture |
| EXC-097 | `Daily_RM_Issues` hits the workbook's 10,000,000-cell ceiling again (2026-09-19, second real occurrence of the same bug class `GS-008`'s `EXC-XXX` first hit) | root cause: `pruneDailyRmIssueLog_` used to prune BEFORE `rows.length` was known, sizing the sheet to `kept.length` + a small FIXED headroom regardless of tonight's real volume (~26,660 rows/night) — the write right after had to expand the grid, which is what pushed the workbook over. Fixed: prune now runs AFTER `rows.length` is known, passed in as `incomingRowCount`, and the sheet is sized to fit exactly (shrinking OR growing) so the write never touches the grid | the nightly capture no longer crashes; dropped rows are also now archived to Drive (`archiveRowsToDriveCsv_`, `GS-002`) instead of just deleted |
| EXC-099 | third 10,000,000-cell crash (2026-09-24 22:53 IST, thrown from `pruneDailyRmIssueLog_`'s own `insertRowsAfter` grow step): the workbook had no cell budget left. `snapshotOpenLeads_` (`GS-008`) writes new Movement_Log rows FIRST and prunes AFTER, and `snapshotPeriodic` had been failing/timing out since 2026-09-23 evening, so Movement_Log was likely going unpruned | `captureDailyRmIssues_` now calls `pruneMovementLog_` up front (after the idempotency guard so a double-fire stays cheap, before `readLeadsTab_`), wrapped in try/catch so a failing prune never blocks tonight's capture. Frees space only if Movement_Log actually holds rows older than its 7-day retention — `pruneMovementLog_` returns early (touches nothing) when nothing is stale, so an over-allocated-but-within-retention grid is NOT shrunk by this | the nightly capture gets a chance to free the biggest tab before it needs to grow `Daily_RM_Issues`; does not by itself cap the workbook's steady-state size (see `HANDOVER.md` §9.2) |
| EXC-162 | the nightly capture dies part-way through its chunked write (added 2026-10-13, DR-03) | the `DAILY_RM_ISSUE_DONE` marker is not written; the crash alert says the night may be partly written; a re-run the same IST night appends only the lead_ids not yet written | `captureDailyRmIssuesNow()` completes the night (before, any row dated today blocked every re-run, so the night stayed incomplete) |
| EXC-163 | `Daily_RM_Issues` header is not in `DAILY_RM_ISSUE_LOG_COLUMNS_` order (added 2026-10-13, DR-11) | the capture emails ops ("header is out of order") and returns without writing; the backfills throw | nothing is written under the wrong headings; fix the column order by hand, then run `captureDailyRmIssuesNow()` |
| EXC-112 | the archive of rows about to be pruned cannot be proved (fewer/more records than expected) or a chunk cannot be created | `archiveChunksVerifiedGs_` (FN-352) throws and trashes the files it created; `pruneDailyRmIssueLog_` now PROVES its archive (it deleted without proving anything before 2026-10-08) | the prune refuses for that night; nothing is deleted; no stray file is left in Drive |
| EXC-113 | a row's `date` cell reads blank (2026-10-02..07: ~600 KB of rows a night, filed as `unknown-dates`, archived and deleted as "older than the window") | FN-355 gives it a date and writes it back; FN-357 re-asserts the date columns after every write; the observation goes to `DAILY_RM_ISSUE_DIAG` | nothing is dropped for lack of a date and nothing is emailed; the cause of the blanking is still unidentified |
| EXC-114 | a refill source (the Leads tab or `Movement_Log`) cannot be read, or the refill itself throws | `buildAssignedAtLookupsGs_` logs and skips the source; `pruneDailyRmIssueLog_` wraps the refill so it never stops the prune | the prune completes; the blank cells are tried again at the next prune |

## Data lineage

`leads` tab (`SHEET-001`) + `Movement_Log` maps (`SHEET-002`) →
`computeSlaFlags_` (`GS-012`) → per open flagged lead → chunked append
to `Daily_RM_Issues` (`SHEET-003`, `DAILY_RM_ISSUE_LOG_COLUMNS_` shape) →
read by `js/tab-repeat-offenders.js` (`JS-022`). The leaderboard side:
`Movement_Log` → observations → scored rows → `Logger.log()`. Full flow:
`DATA-002` + `DATA-004`.

## Sheets touched

| `SHEET-XXX` | Read / Write | Which `FN-XXX` | Notes |
|---|---|---|---|
| `SHEET-001` `leads` | Read | FN-187 | the source |
| `SHEET-002` `Movement_Log` | Read | FN-187, FN-190, FN-191 | baselines + observation reconstruction |
| `SHEET-003` `Daily_RM_Issues` | Write (append, chunked, through FN-505) + prune | FN-187 / FN-188 / FN-189 | the audit trail; `DAILY_RM_ISSUE_LOG_COLUMNS_`. Pruned rows also archived to Drive (not a Sheet) since 2026-09-21 — see `GS-002` `CFG-065`. |

## Failure / error behaviour

Capture failures show as **Failed** in Executions. Chunked writes limit
the blast radius of one bad write, and since 2026-10-13 a partly written
night is completed by a same-night re-run (EXC-162); a misordered header
stops the capture with an ops alert (EXC-163). The leaderboard side is read-only
(console) — it cannot corrupt anything.

## Cross-runtime duplication

`computeRmPerformanceGs_` + all its helpers ↔ `js/core-rm-performance.js`
(`JS-008`). The `RM_PERF_*_GS_` constants **must stay numerically
identical** to the `RM_PERF_*` constants on the client (the file's own
comment says so — `LOGIC_AUDIT.md` Part 1 §4b). `computeSlaFlags_`
reuse means the SLA-rule duplication (`JS-006` ↔ `GS-012`) applies here
transitively. The forward-fill switch (CFG-140 / RULE-082) has a JS twin
that must stay identical. **Note:** the client-only per-region worst-5
(`computeRmPerformanceByRegion`, `JS-008` FN-058) has **no** twin here.

## Not live until pasted

Not running until pasted into the Sheet's Apps Script editor. Re-run
`setupDailyRmIssueLog()` only if the **capture schedule** changed.

## UI relationships

N/A — backend. The dashboard's `TAB-004` reads this file's
`Daily_RM_Issues` output; `reportRmPerformanceNow` is editor-run.

## Architecture relationship

Apps Script backend. Layer 17 (backend automation — the capture side) +
a manual analysis tool (the leaderboard side). `LOGIC_AUDIT.md` Part 1
§1 layer 17.

## Related documentation

`HANDOVER.md` §2, §9 (the Repeat Offenders subsystem + this file's
operational quirks); `OPS_CHECKLIST.md` (worst-performer methodology
drift); `LOGIC_AUDIT.md` Part 1 §4b/§4d/§5, Part 3 §3.6.

## Relationships

- **Depends On:** `GS-002` (`Core.gs`), `GS-004` (`EmailInfra.gs`),
  `GS-008` (`MovementTracker.gs` maps + `_evidenceAtDeadlineGs_`),
  `GS-012` (`SlaEngine.gs`), `SHEET-001`, `SHEET-002`, `SHEET-003`
- **Used By:** `SHEET-003`, `DATA-002`
- **Related:** `JS-008` (`core-rm-performance.js` — the client twin),
  `JS-022` / `TAB-004` (consume the `Daily_RM_Issues` output),
  `JS-017` (the client worker)

## Source of truth

`DailyRmIssueLog.gs` at `HEAD`.

## Validation

- **Method:** full read at `c82ec67`; function list verified by grep;
  trigger schedule cross-checked against `LOGIC_AUDIT.md` Part 1 §5; the
  `reportRmPerformanceNow()` "console-only" claim confirmed
  (`LOGIC_AUDIT.md` Part 1 §4d, verified against source). The user
  confirmed this session: "DailyRmIssueLog.gs … successfully ran in test
  in app script". `Tests_DailyRmIssueLog.gs` runs in CI. **Re-verified
  2026-09-11** after `t-rmperf-leadexcl01` (the leadership-exclusion
  mirror for `reportRmPerformanceNow()` — `RM_PERF_NON_RM_ROLES_GS_` /
  `RM_PERF_LEADERSHIP_NAME_EXCLUSIONS_GS_` /
  `buildRmHierarchyRoleByNameLowerGs_` / `rmPerfIsLeadershipExcludedGs_`,
  commits `8eb4b85`/`95305fb`): new `Tests_DailyRmIssueLog.gs` Scenario D
  (role-excluded + name-list-excluded leaders absent from both
  `reconstructRmPerformanceObservationsGs_`'s output and
  `computeRmPerformanceGs_`'s results, a genuine RM still classifies
  normally) — 700/700 assertions passing (`node test/run-gs-tests.js` in
  CI; also independently reproduced locally via
  `test/run-gs-tests-headless.py`, this repo's headless-browser stand-in
  for the same suite). The user confirmed pasting the fix into the live
  Apps Script editor this session (`reportRmPerformanceNow()` is
  console-callable, not trigger-based, so no `setupXxx()` re-run needed).
  **Revalidated 2026-09-21** (`3a19bdb`, commit authored 2026-09-21
  10:13-10:30, this record's own catalog-drift note going unresolved for
  those 2 commits until this pass): read the `EXC-097` fix
  (`incomingRowCount` sizing + Drive archive) directly in
  `pruneDailyRmIssueLog_`/`captureDailyRmIssues_` source; confirmed via
  the commit's own message that all 778 local tests pass, reconfirmed
  independently this session via `python3 test/run-gs-tests-headless.py`.
- **Evidence:** `.github/workflows/test.yml` (`Tests_DailyRmIssueLog.gs`,
  last green run); `LOGIC_AUDIT.md` Part 1 §4d, Part 3 §3.6; the user's
  Apps Script test confirmation this session; commits `8eb4b85`/`95305fb`
  (leadership-exclusion mirror + its Scenario D tests); the user's
  confirmation of pasting the fix into the live Apps Script editor,
  2026-09-11; commit `3a19bdb` (`EXC-097` fix).
- **Status:** Validated 2026-09-21.

## Version / change reference

Verified at `c82ec67`; record created by DOC-029. File grew 980L →
1127L since the 2026-09-05 audit (retention prune + backfill helpers),
then 1127L → 1264L by 2026-09-21 (`EXC-097`'s incoming-count sizing +
Drive archive call). **Line-anchor resync 2026-09-22** (weekly
spot-check cycle 3, against `2943ec9`): every `#Lnn` citation in
`## Trigger schedule` and `FN-187`..`FN-195` still pointed at the
pre-`EXC-097` line numbers — the 1127L → 1264L growth noted above was
recorded in prose but never propagated into the per-function anchors.
Re-grepped every citation against current source and corrected (drift
ranged from ~48 lines for functions before the growth to ~137 lines for
functions after it); no functional/behavioral change, `Record Status`
unaffected.

**2026-09-25** (`26bf0cf`): third 10M-cell incident — `captureDailyRmIssues_` now prunes Movement_Log up front (`EXC-099`); +8 lines (1264L → 1272L), every `#Lnn` anchor after the insertion point (line ~171) shifted +8 and was re-grepped. `Tests_DailyRmIssueLog.gs` gained 7 assertions (prune runs before the scan, skipped on an idempotency-guard early return, a throwing prune doesn't block the capture). **Deployed live 2026-09-25**: applied to the Sheet's Apps Script editor as the same 8-line insertion, then verified after a full page reload that the saved file's SHA-256 equals the committed file's (`3aaf93a3…d287`, 69,980 chars LF-normalized). No `setupXxx()` re-run needed (no trigger changed); takes effect at the next 22:50 IST fire.

**2026-10-08** (`78e47f5`, email audit P18): from 2026-10-02 every nightly `Daily_RM_Issues` archive was filed `unknown-dates` - the `date`, `captured_at` and `lead_assigned_at` cells of those rows (the three Date-typed columns) read back blank, and `pruneDailyRmIssueLog_` compared a blank date as older than the window, so it archived and deleted them. Nothing reads this tab (the dashboard moved to `Movement_Log` on 2026-09-05), so there was no user-visible effect; the audit trail was thin and undated. (The cause was found later the same day - see the P18c entry below.) Now: an undated row is repaired and kept (FN-355), the date columns are re-asserted after the capture write and the prune rewrite (FN-357), the prune writes the kept rows first and clears only the tail (never clear-then-write) and proves its archive before deleting (FN-352), and what is seen is recorded in `DAILY_RM_ISSUE_DIAG`. The archives already in Drive cannot be re-dated from the files; nights still in `Movement_Log` (1 Oct onward) can be rebuilt with `backfillOneDayFromMovementLog_` (`FN-189`). **Not live until pasted.**

**2026-10-08** (`80a1768`, email audit P18b): after every prune, any row that remains with a lead id and no `lead_assigned_at` is filled from the lead's own record (FN-359..FN-362); the capture hands the prune its own Leads read, so the Leads tab is read once a night; the filled column is re-asserted after the rewrite (`DAILY_RM_ISSUE_DATE_COLS_` still covers it). On 2026-10-08 the newest night kept `lead_assigned_at` on 505 of 505 rows, the night before on 75 of 674, 5 Oct on 5 of 41 and 4 Oct on 0 of 2, while the Leads tab (6,680 of 6,680) and every `Movement_Log` snapshot of 1-7 Oct have it for every lead - so the cell is lost after the row is written, not at the source. Fill only, nothing is emailed, the observation goes to `DAILY_RM_ISSUE_DIAG` (`prune-refill`). `refillDailyRmIssueAssignedAtNow()` does it on demand. **Not live until pasted.**

**2026-10-08** (`1cd1cfa`, email audit P18c): the three Date-typed columns are now WRITTEN AS TEXT (FN-364..FN-366) by the capture and by the prune rewrite, and `persistDailyRmIssueColumnGs_` (FN-363) writes ONE span per column instead of one call per contiguous run. Found by running the refill live on 2026-10-08: the Sheets query endpoint (gviz) only sees the first ~1,200 rows of this tab, which is why earlier counts ("1,222 rows", "no undated row in the morning") were wrong. `reportWorkbookCellUsageNow()` shows the tab at 13,877 rows: the nightly capture writes ~10,000 rows (in 5,000-row chunks) and kept the date, `captured_at` and `lead_assigned_at` of only its last, small chunk (505 rows for 7 Oct); the rest read back blank - and a single `lead_assigned_at` written as a Date read back blank too - while the same values written as text in a plain-text column stuck every time. The `unknown-dates` archives are those ~5,000-row chunks, dropped the next night because a blank date compared as older than the window. The per-run persist took over six minutes on the manual refill (it was stopped from the Executions page) and, with the retention window holding every row, would have made tonight's prune spend its time there before the capture's own write. The refill filled `lead_assigned_at` on the rows the query endpoint could see (585 -> 1,187 of 1,222; 35 have no source anywhere). **Consequence to know:** the old behaviour deleted the ~10,000 blank-dated rows every night (as `unknown-dates`); now they are dated, kept and aged out after 7 days, so the tab holds about 7 nights x ~10,000 rows (+~1.5M cells; the workbook was at 5.37M of 10M on 2026-10-08). **Not live until pasted.**

**2026-10-15** (`450565a`, audit 2026-10-13 DR-01..DR-12): **DR-03** - the capture's idempotency guard is now the `DAILY_RM_ISSUE_DONE` Script Property (CFG-139, FN-503), written after the last chunk; rows dated today without it are a partial night, and a re-run appends only the missing lead_ids (EXC-162). **DR-01** - both backfills rebuild each lead's latest row at or before the day's last snapshot (FN-506), so untouched leads are no longer missed. **DR-02** - RM Performance forward-fills a lead's last known row onto capture days with no row (RULE-082, CFG-140 = on; JS twin in `JS-008`). **DR-04/05** - the prune runs on quiet nights, and an empty tab still has its grid sized. **DR-06/07** - backfills write through the capture's chunked, text-dated, grid-sized path (FN-505). **DR-08** - the repair writes only changed spans. **DR-09** - archives in 5,000-row files. **DR-10/12** - KEEP IN SYNC note on the eligibility helper (which now reads dates via `parseSlaDateGs_` when present) and corrected comments / crash alert text. **DR-11** - header-order check (FN-504, EXC-163). **Not live until pasted.**

**2026-10-19** (user request): `computeRmPerfEligibilityGs_` no longer derives `neverConnectedPastWindow` (and no longer uses `FIRST_CONTACT_SLA_MINUTES_`, removed from `SlaEngine.gs`); `RM_PERF_RULES_GS_`'s `isNotUpdated` gate is `pastGrace` only and `followupOverdue` is labelled "No follow up in last 4 hours" - twin of `js/core-rm-performance.js` (`JS-008`). `Daily_RM_Issues` rows written before today keep `issue_label` "Follow-up Overdue"; nothing reads that column for logic (readers key on `issue_key`). Tests in `Tests_DailyRmIssueLog.gs`.

## Revalidation trigger

Any commit touching `DailyRmIssueLog.gs` or `Tests_DailyRmIssueLog.gs`;
**any `RM_PERF_*_GS_` constant changes** (requires the `JS-008` twin to
change — `HANDOVER.md` §6); the capture schedule, `BACKFILL_CHUNK_SIZE_`,
or the 7-day retention changes; `computeSlaFlags_` (`GS-012`) changes;
`DAILY_RM_ISSUE_LOG_COLUMNS_` (`SHEET-003`) changes;
`RM_PERF_FORWARD_FILL_CAPTURE_DAYS_GS_` or its JS twin changes.

## Handover relationship

`HANDOVER.md` §2 names the file; §9 covers its operational quirks
(unbounded nightly row growth — now pruned; the ~8-min-wrote-nothing
incident). Current as of 2026-09-09. A constant change must update
`HANDOVER.md` §6 and the `js/` side in the same commit, and run
`OPS_CHECKLIST.md`'s worst-performer items.

## Lifecycle / retention

N/A — code. `Daily_RM_Issues` (`SHEET-003`) retains **7 days**
(`pruneDailyRmIssueLog_`, added 2026-09-07 — one of the two confirmed
retention values, per `../_templates/sheet-template.md`).

## Next action

none — Closed + Monitored.

## Closure evidence

Record committed for DOC-029; `docs/INDEX.md` `GS-003` → `Closed +
Monitored`, `Last Verified` 2026-09-10, links + trigger schedule
recorded; `CFG-031`..`036` (the backend half of the RM-performance
constant pairs), `EXC-060`..`062` recorded. No `docs/changes/` record
(DOC-029).
