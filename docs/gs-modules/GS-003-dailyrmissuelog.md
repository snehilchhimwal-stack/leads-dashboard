# GS-003 — DailyRmIssueLog.gs

| | |
|---|---|
| **Type** | `GS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `DailyRmIssueLog.gs` (1127 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-11 against commit `74107f7` |

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
  census.
- `pruneDailyRmIssueLog_` — 7-day retention (added 2026-09-07 after a
  cell-limit incident).
- `backfillDailyRmIssuesFromMovementLog_` / `backfillOneDayFromMovementLog_`
  — rebuild past days from `Movement_Log`.
- `computeRmPerformanceGs_` + `reconstructRmPerformanceObservationsGs_` /
  `aggregateRmPerformanceGs_` / `computeRmPerfPeerAveragesGs_` /
  `classifyRmPerformanceGs_` — the `.gs` scoring mirror.
- `reportRmPerformanceNow` — the console leaderboard.
- `setupDailyRmIssueLog` — install the 22:50 trigger.

## Trigger schedule

`setupDailyRmIssueLog()` (`#L715`) installs `captureDailyRmIssues` on
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
| FN-187 | `captureDailyRmIssues()` / `captureDailyRmIssues_()` `#L128/#L140` | `leads` tab, `Movement_Log` | appends a row per open SLA-flagged lead to `Daily_RM_Issues` | Sheets write in **chunks of `BACKFILL_CHUNK_SIZE_ = 5000`** (after a real 2026-09-01 incident where one oversized `setValues()` silently failed for a whole night) | `computeSlaFlags_` (`GS-012`), `buildMovementLogMapsGs_` (`GS-008`), `ensureDailyRmIssueLogSheet_` (FN-188) | the 22:50 trigger; `captureDailyRmIssuesNow()` (manual) | specific — scheduled |
| FN-188 | `ensureDailyRmIssueLogSheet_(ss)` / `pruneDailyRmIssueLog_(ss)` / `pruneDailyRmIssueLogNow()` `#L94/#L252/#L292` | spreadsheet | ensures the tab; prunes rows older than 7 days | may create the tab; deletes rows | — | FN-187 | specific — retention added 2026-09-07 |
| FN-189 | `backfillDailyRmIssuesFromMovementLog_(ss)` / `backfillOneDayFromMovementLog_(ss, dayKey)` / `repairDailyRmIssuesMissingFieldsNow()` `#L331/#L473/#L603` | `Movement_Log` history | rebuilds past `Daily_RM_Issues` days | chunked Sheets writes | `_evidenceAtDeadlineGs_` (`GS-008`), `computeSlaFlags_` (`GS-012`) | manual recovery | specific |
| FN-190 | `computeRmPerformanceGs_(ss)` `#L1071` | `Movement_Log` | the scored per-RM leaderboard (in memory) | none | FN-191..FN-194 | `reportRmPerformanceNow` (FN-195) | specific — **the `.gs` mirror of `computeRmPerformance` (`JS-008`)** |
| FN-191 | `reconstructRmPerformanceObservationsGs_(ss)` / `aggregateRmPerformanceGs_(observations)` `#L869/#L940` | `Movement_Log` rows / observations | per-(lead,day,rule) observations → per-group aggregates | none | `computeRmPerfEligibilityGs_` (FN-193), `computeSlaFlags_` (`GS-012`) | FN-190 | specific — mirrors `JS-008` FN-053/FN-054 |
| FN-192 | `rmPerfCanonicalRmNameGs_(rawName)` / `rmPerformanceDrivenByGs_(r)` / `sortRmPerformanceByPriorityGs_(list)` `#L815/#L1081/#L1097` | RM name / a result row | canonical name / driver list / sorted list | none | — | FN-190 | reusable — twin of `JS-008` `rmPerfCanonicalRmName` etc. |
| FN-193 | `computeRmPerfEligibilityGs_(row, colIndex, now)` / `_rmPerfDaysBetweenKeysGs_(a, b)` `#L836/#L824` | a row + now | the eligibility window (separately implemented — it does **not** reuse `computeSlaFlags_` for eligibility, only for pass/fail) | none | `istDayKeyGs_` (`GS-002`) | FN-191 | specific |
| FN-194 | `computeRmPerfPeerAveragesGs_(byGroup)` / `classifyRmPerformanceGs_(byGroup)` `#L987/#L1014` | per-group aggregates | peer-average baseline per rule → classification (`Below Expectations` / `Insufficient Data` / …) + shrunk score | none | `RM_PERF_*_GS_` constants | FN-190 | specific — mirrors `JS-008` FN-055/FN-056 |
| FN-195 | `reportRmPerformanceNow()` / `setupDailyRmIssueLog()` `#L1108/#L715` | — | **`Logger.log()` console output only** — no sheet write, no email / installs the trigger | console log / creates a trigger | FN-190 / `ScriptApp` | Apps Script editor (manual) / editor | specific |

## Config constants — `CFG-XXX` sub-table

| ID | Constant | Value | Meaning | Changing it affects |
|---|---|---|---|---|
| CFG-031 | `RM_PERF_RULE_WEIGHTS_GS_` | `isNotUpdated 1.5`, `followupOverdue 1.2`, `underCalledToday 1.0` | per-rule severity weights | the leaderboard; **must stay numerically identical to `RM_PERF_RULE_WEIGHTS` (`JS-008` CFG-013)** |
| CFG-032 | `RM_PERF_SHRINKAGE_K_GS_` | `8` | shrinkage strength | twin `RM_PERF_SHRINKAGE_K` (`JS-008` CFG-014) |
| CFG-033 | `RM_PERF_MIN_VOLUME_LEADS_GS_` | `5` | "Insufficient Data" floor | twin `RM_PERF_MIN_VOLUME_LEADS` (`JS-008` CFG-015) |
| CFG-034 | `RM_PERF_CHRONIC_STREAK_DAYS_GS_` / `RM_PERF_FLAG_RATIO_GS_` / `RM_PERF_CONCENTRATION_BREADTH_CEILING_GS_` | `3` / `1.25` / `0.25` | chronic / classification / concentration | twins `CFG-016`..`CFG-018` (`JS-008`) |
| CFG-035 | `BACKFILL_CHUNK_SIZE_` | `5000` | max rows per `setValues()` write | write reliability — the 2026-09-01 incident fix |
| CFG-036 | retention | 7 days | how far back `Daily_RM_Issues` is kept | `pruneDailyRmIssueLog_` (added 2026-09-07) |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-060 | an oversized `setValues()` write | **chunked into 5000-row batches** | (historical) a whole night's capture silently lost — fixed |
| EXC-061 | `Daily_RM_Issues` grows past the workbook cell ceiling | `pruneDailyRmIssueLog_` trims to 7 days | (historical) a real cell-limit incident — fixed 2026-09-07 |
| EXC-062 | a run takes very long / writes nothing | shows in Apps Script Executions; a documented past incident (~8 min, wrote nothing — `HANDOVER.md` §2/§9) | Repeat Offenders shows stale data until the next successful capture |

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
| `SHEET-003` `Daily_RM_Issues` | Write (append, chunked) + prune | FN-187 / FN-188 | the audit trail; `DAILY_RM_ISSUE_LOG_COLUMNS_` |

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
- **Evidence:** `.github/workflows/test.yml` (`Tests_DailyRmIssueLog.gs`,
  last green run); `LOGIC_AUDIT.md` Part 1 §4d, Part 3 §3.6; the user's
  Apps Script test confirmation this session; commits `8eb4b85`/`95305fb`
  (leadership-exclusion mirror + its Scenario D tests); the user's
  confirmation of pasting the fix into the live Apps Script editor,
  2026-09-11.
- **Status:** Validated 2026-09-11.

## Version / change reference

Verified at `c82ec67`; record created by DOC-029. File grew 980L →
1127L since the 2026-09-05 audit (retention prune + backfill helpers).

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
