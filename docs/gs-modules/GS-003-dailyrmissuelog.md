# GS-003 — DailyRmIssueLog.gs

| | |
|---|---|
| **Type** | `GS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `DailyRmIssueLog.gs` (1346 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-10-08 against commit `78e47f5` - email audit P18: undated rows are repaired, never dropped; date columns re-asserted after every write (`FN-354`..`FN-358`, `CFG-097`/`098`, `EXC-112`/`113`; see `## Version / change reference`) |

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
- `pruneDailyRmIssueLog_` — 7-day retention (added 2026-09-07 after a
  cell-limit incident; **fixed again 2026-09-19/21** — see `EXC-097`).
  Now archives dropped rows to Drive via `archiveRowsToDriveCsv_`
  (`GS-002`) before clearing them, and both shrinks AND grows the sheet's
  row grid to fit `kept.length + incomingRowCount` exactly.
- `backfillDailyRmIssuesFromMovementLog_` / `backfillOneDayFromMovementLog_`
  — rebuild past days from `Movement_Log`.
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
| FN-187 | `captureDailyRmIssues()` / `captureDailyRmIssues_()` `#L135/#L147` | `leads` tab, `Movement_Log` | appends a row per open SLA-flagged lead to `Daily_RM_Issues` | Sheets write in **chunks of `BACKFILL_CHUNK_SIZE_ = 5000`** (after a real 2026-09-01 incident where one oversized `setValues()` silently failed for a whole night); idempotency check now runs FIRST (2026-09-19), before pruning, so a double-fire bails out cheaply | `computeSlaFlags_` (`GS-012`), `buildMovementLogMapsGs_` (`GS-008`), `ensureDailyRmIssueLogSheet_` (FN-188), `pruneDailyRmIssueLog_` (FN-188, now called AFTER `rows.length` is known, passing it in) | the 22:50 trigger; `captureDailyRmIssuesNow()` (manual) | specific — scheduled |
| FN-188 | `ensureDailyRmIssueLogSheet_(ss)` / `pruneDailyRmIssueLog_(ss, incomingRowCount)` / `pruneDailyRmIssueLogNow()` `#L101/#L413/#L504` | spreadsheet (+ the caller's about-to-be-written row count, added 2026-09-19) | ensures the tab; prunes rows older than 7 days, sizing the sheet's row grid to `kept.length + incomingRowCount + headroom` exactly (shrinks OR grows) | may create the tab; deletes/inserts rows; archives dropped rows to Drive via `archiveRowsToDriveCsv_` (`GS-002` FN-265) before clearing them | `archiveRowsToDriveCsv_` (`GS-002` FN-265) | FN-187 | specific — retention added 2026-09-07, the incoming-count sizing + archive fix added 2026-09-19/21 (`EXC-097`) |
| FN-189 | `backfillDailyRmIssuesFromMovementLog_(ss)` / `backfillOneDayFromMovementLog_(ss, dayKey)` / `repairDailyRmIssuesMissingFieldsNow()` `#L543/#L685/#L815` | `Movement_Log` history | rebuilds past `Daily_RM_Issues` days | chunked Sheets writes | `_evidenceAtDeadlineGs_` (`GS-008`), `computeSlaFlags_` (`GS-012`) | manual recovery | specific |
| FN-190 | `computeRmPerformanceGs_(ss)` `#L1445` | `Movement_Log` | the scored per-RM leaderboard (in memory) | none | FN-191..FN-194 | `reportRmPerformanceNow` (FN-195) | specific — **the `.gs` mirror of `computeRmPerformance` (`JS-008`)** |
| FN-191 | `reconstructRmPerformanceObservationsGs_(ss)` / `aggregateRmPerformanceGs_(observations)` `#L1178/#L1264` | `Movement_Log` rows / observations | per-(lead,day,rule) observations → per-group aggregates | none | `computeRmPerfEligibilityGs_` (FN-193), `computeSlaFlags_` (`GS-012`) | FN-190 | specific — mirrors `JS-008` FN-053/FN-054 |
| FN-192 | `rmPerfCanonicalRmNameGs_(rawName)` / `rmPerformanceDrivenByGs_(r)` / `sortRmPerformanceByPriorityGs_(list)` `#L1034/#L1455/#L1471` | RM name / a result row | canonical name / driver list / sorted list | none | — | FN-190 | reusable — twin of `JS-008` `rmPerfCanonicalRmName` etc. |
| FN-193 | `computeRmPerfEligibilityGs_(row, colIndex, now)` / `_rmPerfDaysBetweenKeysGs_(a, b)` `#L1145/#L1133` | a row + now | the eligibility window (separately implemented — it does **not** reuse `computeSlaFlags_` for eligibility, only for pass/fail) | none | `istDayKeyGs_` (`GS-002`) | FN-191 | specific |
| FN-194 | `computeRmPerfPeerAveragesGs_(byGroup)` / `classifyRmPerformanceGs_(byGroup)` `#L1340/#L1367` | per-group aggregates | peer-average baseline per rule → classification (`Below Expectations` / `Insufficient Data` / …) + shrunk score + `confidence`/`compositeVariance` (added 2026-09-30) | none | `RM_PERF_*_GS_` constants, FN-319 | FN-190 | specific — mirrors `JS-008` FN-055/FN-056; classification now gated on posterior confidence, see HANDOVER.md §9.7.5 |
| FN-195 | `reportRmPerformanceNow()` / `setupDailyRmIssueLog()` `#L1482/#L927` | — | **`Logger.log()` console output only** — no sheet write, no email / installs the trigger; log line now includes confidence % when not null | console log / creates a trigger | FN-190 / `ScriptApp` | Apps Script editor (manual) / editor | specific |
| FN-319 | `rmPerfNormalCdfGs_(z)` / `rmPerfBetaPosteriorVarianceGs_(peer, raw, n, K)` `#L1316/#L1330` (added 2026-09-30) | a z-score / a Beta-posterior's parameters | standard-normal CDF probability / the posterior's variance | none | — | FN-194 | reusable — BYTE-FOR-BYTE port of `JS-008` FN-317, kept in parity by hand + identical reference-value tests |
| FN-354 | `dailyRmIssueDateKeyGs_(cell)` `#L259` | a `date`/`captured_at` cell (Date or string) | `'yyyy-MM-dd'` (IST) or `''` when unreadable | none | `istDayKeyGs_` | `pruneDailyRmIssueLog_`, `repairDailyRmIssueDatesGs_` | specific - **added 2026-10-08 (email audit P18)** |
| FN-355 | `repairDailyRmIssueDatesGs_(values, todayKey)` `#L269` | the sheet's rows as read for the prune | `{rows, blank, fromCapturedAt, fromNeighbour, fromToday, blocks, sampleLeadIds, indexes}`; sets `row[0]` of each undated row **in place** | none | FN-354 | `pruneDailyRmIssueLog_` | specific - **added 2026-10-08**; gives an undated row a date: its own `captured_at`, else the nearest FOLLOWING dated row (a later date only keeps a row longer), else the nearest PRECEDING, else today - EXC-113 |
| FN-356 | `persistRepairedDailyRmIssueDatesGs_(logSheet, values, indexes)` `#L308` | the repaired rows | none | writes the repaired date cells (column A) back, one contiguous run at a time, then re-asserts them | FN-357 | `pruneDailyRmIssueLog_` when nothing else is rewritten | specific - **added 2026-10-08** |
| FN-357 | `reassertDateColumnsGs_(sheet, startRow, rows, colIdxs, phase)` `#L325` | a range just written and the rows it should hold | `{checked, blankFound, rewrittenCols, escalatedCols}` | reads the date columns back; re-writes any that came back blank; if a plain re-write still reads blank, stores that column as TEXT (`setNumberFormat('@')`, IST string); records what it found (FN-358), **never emails** | `withRetry_`, FN-358 | `captureDailyRmIssues_` (after the write), `pruneDailyRmIssueLog_` (after the rewrite / repair) | specific - **added 2026-10-08**; EXC-112 |
| FN-358 | `recordDailyRmIssueDiagGs_(diag)` / `showDailyRmIssueDiagNow()` `#L365/#L384` | an observation | the last 4 observations in the `DAILY_RM_ISSUE_DIAG` Script Property; `showDailyRmIssueDiagNow` logs them (Run from the editor, log-only) | `PropertiesService`, `Logger` | - | FN-355/357 callers | specific - **added 2026-10-08**; fail-open |

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
| CFG-097 | `DAILY_RM_ISSUE_DATE_COLS_` `#L255` | `[0, 8, 12]` | the Date-typed columns re-asserted after every write: `date`, `captured_at`, `lead_assigned_at` | FN-357; **added 2026-10-08** |
| CFG-098 | `DAILY_RM_ISSUE_DIAG_PROPERTY_` `#L256` | `'DAILY_RM_ISSUE_DIAG'` | the Script Property that keeps the last 4 date-integrity observations | FN-358; **added 2026-10-08** |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-060 | an oversized `setValues()` write | **chunked into 5000-row batches** | (historical) a whole night's capture silently lost — fixed |
| EXC-061 | `Daily_RM_Issues` grows past the workbook cell ceiling | `pruneDailyRmIssueLog_` trims to 7 days | (historical) a real cell-limit incident — fixed 2026-09-07 |
| EXC-062 | a run takes very long / writes nothing | shows in Apps Script Executions; a documented past incident (~8 min, wrote nothing — `HANDOVER.md` §2/§9) | Repeat Offenders shows stale data until the next successful capture |
| EXC-097 | `Daily_RM_Issues` hits the workbook's 10,000,000-cell ceiling again (2026-09-19, second real occurrence of the same bug class `GS-008`'s `EXC-XXX` first hit) | root cause: `pruneDailyRmIssueLog_` used to prune BEFORE `rows.length` was known, sizing the sheet to `kept.length` + a small FIXED headroom regardless of tonight's real volume (~26,660 rows/night) — the write right after had to expand the grid, which is what pushed the workbook over. Fixed: prune now runs AFTER `rows.length` is known, passed in as `incomingRowCount`, and the sheet is sized to fit exactly (shrinking OR growing) so the write never touches the grid | the nightly capture no longer crashes; dropped rows are also now archived to Drive (`archiveRowsToDriveCsv_`, `GS-002`) instead of just deleted |
| EXC-099 | third 10,000,000-cell crash (2026-09-24 22:53 IST, thrown from `pruneDailyRmIssueLog_`'s own `insertRowsAfter` grow step): the workbook had no cell budget left. `snapshotOpenLeads_` (`GS-008`) writes new Movement_Log rows FIRST and prunes AFTER, and `snapshotPeriodic` had been failing/timing out since 2026-09-23 evening, so Movement_Log was likely going unpruned | `captureDailyRmIssues_` now calls `pruneMovementLog_` up front (after the idempotency guard so a double-fire stays cheap, before `readLeadsTab_`), wrapped in try/catch so a failing prune never blocks tonight's capture. Frees space only if Movement_Log actually holds rows older than its 7-day retention — `pruneMovementLog_` returns early (touches nothing) when nothing is stale, so an over-allocated-but-within-retention grid is NOT shrunk by this | the nightly capture gets a chance to free the biggest tab before it needs to grow `Daily_RM_Issues`; does not by itself cap the workbook's steady-state size (see `HANDOVER.md` §9.2) |
| EXC-112 | the archive of rows about to be pruned cannot be proved (fewer/more records than expected) or a chunk cannot be created | `archiveChunksVerifiedGs_` (FN-352) throws and trashes the files it created; `pruneDailyRmIssueLog_` now PROVES its archive (it deleted without proving anything before 2026-10-08) | the prune refuses for that night; nothing is deleted; no stray file is left in Drive |
| EXC-113 | a row's `date` cell reads blank (2026-10-02..07: ~600 KB of rows a night, filed as `unknown-dates`, archived and deleted as "older than the window") | FN-355 gives it a date and writes it back; FN-357 re-asserts the date columns after every write; the observation goes to `DAILY_RM_ISSUE_DIAG` | nothing is dropped for lack of a date and nothing is emailed; the cause of the blanking is still unidentified |

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
| `SHEET-003` `Daily_RM_Issues` | Write (append, chunked) + prune | FN-187 / FN-188 | the audit trail; `DAILY_RM_ISSUE_LOG_COLUMNS_`. Pruned rows also archived to Drive (not a Sheet) since 2026-09-21 — see `GS-002` `CFG-065`. |

## Failure / error behaviour

Capture failures show as **Failed** in Executions. Chunked writes limit
the blast radius of one bad write. The leaderboard side is read-only
(console) — it cannot corrupt anything.

## Cross-runtime duplication

`computeRmPerformanceGs_` + all its helpers ↔ `js/core-rm-performance.js`
(`JS-008`). The `RM_PERF_*_GS_` constants **must stay numerically
identical** to the `RM_PERF_*` constants on the client (the file's own
comment says so — `LOGIC_AUDIT.md` Part 1 §4b). `computeSlaFlags_`
reuse means the SLA-rule duplication (`JS-006` ↔ `GS-012`) applies here
transitively. **Note:** the client-only per-region worst-5
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

**2026-10-08** (`78e47f5`, email audit P18): from 2026-10-02 every nightly `Daily_RM_Issues` archive was filed `unknown-dates` - the `date`, `captured_at` and `lead_assigned_at` cells of those rows (the three Date-typed columns) read back blank, and `pruneDailyRmIssueLog_` compared a blank date as older than the window, so it archived and deleted them. Nothing reads this tab (the dashboard moved to `Movement_Log` on 2026-09-05), so there was no user-visible effect; the audit trail was thin and undated. The tab holds no undated row in the morning, so the cause is not identified. Now: an undated row is repaired and kept (FN-355), the date columns are re-asserted after the capture write and the prune rewrite (FN-357), the prune writes the kept rows first and clears only the tail (never clear-then-write) and proves its archive before deleting (FN-352), and what is seen is recorded in `DAILY_RM_ISSUE_DIAG`. The archives already in Drive cannot be re-dated from the files; nights still in `Movement_Log` (1 Oct onward) can be rebuilt with `backfillOneDayFromMovementLog_` (`FN-189`). **Not live until pasted.**

## Revalidation trigger

Any commit touching `DailyRmIssueLog.gs` or `Tests_DailyRmIssueLog.gs`;
**any `RM_PERF_*_GS_` constant changes** (requires the `JS-008` twin to
change — `HANDOVER.md` §6); the capture schedule, `BACKFILL_CHUNK_SIZE_`,
or the 7-day retention changes; `computeSlaFlags_` (`GS-012`) changes;
`DAILY_RM_ISSUE_LOG_COLUMNS_` (`SHEET-003`) changes.

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
