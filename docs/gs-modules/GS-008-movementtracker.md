# GS-008 — MovementTracker.gs

| | |
|---|---|
| **Type** | `GS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `MovementTracker.gs` (1285 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-21 against commit `55bf870` |

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
  points; `setupMovementTracking` — install the 4 triggers.
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
| FN-218 | `snapshotOpenLeads_(label)` `#L478` | `leads` tab | appends a `Movement_Log` row (the `SNAPSHOT_COLUMNS_` shape + `content_hash`) **only for a lead whose content hash differs from its latest known hash** — an unchanged lead is skipped (no duplicate row) though still counted in `leadCountSeen`; always appends one `Movement_Log_Runs` row (`run_at`, `run_label`, `lead_count_seen`, `leads_changed`) regardless of whether any lead changed (2026-09-11 content-hash dedup, Lead History & Versioning Review Phase 6 — `641398e`) | Sheets write; **each side-effect (SLA_History write, unmatched-comment scan, interaction-history log, cohort-history persist, Movement_Log_Runs write) is independently try/catch-wrapped so one failing never blocks the core capture** | `readLeadsTab_` (`GS-004`), `isOpenLead_` (`GS-002`), `computeSlaFlags_` (`GS-012`), `writeSlaHistorySnapshot_` (FN-221), `scanUnmatchedCommentsGs_` (`GS-013`), `logInteractionHistoryGs_` (`GS-006`), `persistDailyCohortHistoryGs_` (FN-223), `_leadContentHashGs_` / `_latestContentHashByKeyGs_` / `ensureMovementLogRunsSheet_` (dedup + run-log helpers) | `snapshotPeriodic` (FN-219), `snapshotNow` (FN-219) | specific — the hub capture |
| FN-219 | `snapshotPeriodic()` / `snapshotNow()` / `setupMovementTracking()` `#L1099/#L1145/#L1104` | — | scheduled capture / manual capture / installs the 4 triggers | Sheets writes / creates triggers | FN-218 / `ScriptApp` | the 4 triggers / editor | specific |
| FN-220 | `pruneMovementLog_(ss)` / `pruneMovementLogNow()` `#L629/#L701` | spreadsheet | deletes rows older than the retention cutoff **and shrinks the sheet's row allocation via `deleteRows`**; writes kept rows first, clears only the leftover tail after, and no-ops entirely when nothing is outside retention (2026-09-12 interruption-safety fix — see `EXC-091`); **archives dropped rows to Drive before clearing them (2026-09-21)** | Sheets structural change (skipped when nothing to prune); Drive write via `archiveRowsToDriveCsv_` (`GS-002`) when there's anything to drop | `archiveRowsToDriveCsv_` (`GS-002`) | FN-218 (after each capture) | specific — "to avoid the 10M-cell workbook ceiling this project has hit once before" |
| FN-221 | `ensureSlaHistorySheet_(ss)` / `writeSlaHistorySnapshot_(ss, dataRows, colIndex, now)` `#L413/#L443` | the snapshot rows | one `SLA_History` row per run | Sheets write | `computeSlaFlags_` (`GS-012`) | FN-218 | specific — **schema matches `js/sheets-writeback.js`'s `SLA_History` writer exactly** (`LOGIC_AUDIT.md` Part 4 §4.7) |
| FN-222 | `_collapseLatestByKeyGs_` `#L302` / `_lastMovementLogSnapshotByKeyGs_` `#L319` / `buildTodayCallBaselineGs_(ss, beforeDate)` `#L372` / `lastSnapshotBeforeGs_(ss, beforeDate)` `#L391` / `buildMovementLogMapsGs_(ss, now)` `#L404` | `Movement_Log` rows | the baseline / last-snapshot / combined maps every scheduled emailer reads | none | `_readMovementLogRowsGs_` (FN-224) | `GS-001`, `GS-010`, `GS-003` | reusable — the hub's read API |
| FN-223 | `eligibleDailyCohortDatesGs_` `#L849` / `computeDailyCohortByRegionGs_(dateKey, historyRows, liveByKey, now)` `#L906` / `upsertDailyCohortHistoryRowsGs_` `#L980` / `_readArchivedDailyCohortDatesGs_` `#L1029` / `persistDailyCohortHistoryGs_(ss, dataRows, colIndex, now)` `#L1043` | history rows + a date | per-region cohort outcomes; upserts `Daily_Cohort_History` | Sheets write (`RAW`); **never re-writes an archived date** | `_evidenceAtDeadlineGs_` (FN-225), `_effectiveRegionGs_` (FN-225) | FN-218, `persistDailyCohortHistoryNow()` (manual) | specific — **`.gs` twin of `JS-024`'s cohort persist** |
| FN-224 | `ensureMovementLogSheet_(ss)` / `_readMovementLogRowsGs_(ss)` / `_readMovementLogHistoryRowsGs_(ss)` `#L196/#L271/#L782` | spreadsheet | ensures the tab (self-healing header — new columns **appended** to `SNAPSHOT_COLUMNS_`, never inserted mid-array; forces a datetime cell format on `lead_assigned_at`/`last_connect_time`/`opp_at` explicitly by name — see `EXC-XXX` risk note); reads rows | may create the tab | — | FN-218, FN-222, FN-223 | reusable |
| FN-225 | `_effectiveRegionGs_(groupSource, region)` `#L822` / `_evidenceAtDeadlineGs_(historyForKey, deadlineMs, liveEvidence)` `#L832` / `_buildLiveLeadIndexGs_` `#L880` | a lead's history + a deadline | status as of the deadline / the effective region | none | — | FN-223, `GS-003` | reusable — twin of `evidenceAtDeadline` (`JS-024` FN-162); `_effectiveRegionGs_` is the **reduced** Loan override (`group_source` only — `SNAPSHOT_COLUMNS_` has no `project_region`) |
| FN-226 | `checkMovementLogFreshness_(ss, now)` / `checkMovementLogFreshnessNow()` `#L1179/#L1196` | spreadsheet + now | `{status, ageHours, label}` — stale if age > `MOVEMENT_LOG_FRESHNESS_GRACE_HOURS_` (8h); **reads `Movement_Log_Runs`' last row, not `Movement_Log`'s own last row** (changed 2026-09-11 alongside the content-hash dedup — a capture run that changes no leads no longer writes a new `Movement_Log` row at all, so `Movement_Log`'s own last-row timestamp stopped being a reliable freshness signal; `Movement_Log_Runs` gets a row every run regardless) | none | — | `OpsChecklistRunner.gs` (`GS-009`), manual | reusable |

## Config constants — `CFG-XXX` sub-table

| ID | Constant | Value | Meaning | Changing it affects |
|---|---|---|---|---|
| CFG-047 | `MOVEMENT_LOG_RETENTION_DAYS` `#L80` | `7` | how many days of `Movement_Log` are kept | `pruneMovementLog_` — one of the **two confirmed retention values** in the whole system |
| CFG-048 | `SNAPSHOT_HOURS_` (a.k.a. `SNAPSHOT_HOURS_`) | `[0, 6, 12, 18]` | the 4 IST capture hours | the trigger cadence — **requires `setupMovementTracking()` re-run** |
| CFG-049 | `MOVEMENT_LOG_FRESHNESS_GRACE_HOURS_` `#L1178` | `8` | max age before `Movement_Log` reads "stale" (covers the `[0,6,12,18]` gap + `atHour()` slack) | `checkMovementLogFreshness_` / `OpsChecklistRunner.gs`'s freshness check (this is the constant behind the CI drift `runWeeklyOpsChecklist_(ss, now)` was split to fix) |
| CFG-050 | `SNAPSHOT_COLUMNS_` `#L105` | the snapshot column list — has `region` + `group_source`, **NOT `project_region`** | the `Movement_Log` write schema | every `Movement_Log` reader; the reduced Loan override (FN-225); **matches `js/sheets-writeback.js`'s writer** (`LOGIC_AUDIT.md` Part 4 §4.7) |
| CFG-063 | `CONTENT_HASH_COLUMN_` `#L139` | `'content_hash'` | trailing `Movement_Log` bookkeeping column — a SHA-256 digest computed over the `SNAPSHOT_COLUMNS_` fields (NUL-joined, excluding `snapshot_at`/`snapshot_label`/itself); a separate column, outside the `SNAPSHOT_COLUMNS_` array | `FN-218`'s dedup skip; must hash identically to `js/sheets-writeback.js`'s twin or dedup silently breaks across runtimes. `CONTENT_HASH_DATE_FIELDS_` (`#L150`) — the sub-set of `SNAPSHOT_COLUMNS_` needing IST-string normalization before hashing so both runtimes hash an identical instant identically — gained `opp_at` 2026-09-21 alongside `lead_assigned_at`/`last_connect_time`; a lead reaching Opportunity between two captures now correctly registers as a real content change (`Tests_MovementTracker.gs`'s new dedup-sensitivity assertion proves this, not just that the field is present). |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-072 | one side-effect (SLA_History / unmatched scan / interaction log / cohort persist) throws | each is **independently try/catch-wrapped** in `snapshotOpenLeads_` | the core `Movement_Log` capture still completes; the failed side-effect is logged, not fatal |
| EXC-073 | `Movement_Log` approaches the 10M-cell workbook ceiling | `pruneMovementLog_` trims rows **and shrinks the row allocation** via `deleteRows` | (historical) a real ceiling incident — mitigated every capture |
| EXC-091 | a `snapshotPeriodic` run is killed mid-function by Apps Script's 30-minute execution ceiling while `pruneMovementLog_` is running (real 2026-09-12 incident — the old clear-then-write ordering left `Movement_Log` with its row *allocation* intact but almost all real *data* gone) | fixed 2026-09-12: kept rows are written to their final position **first**, only the leftover tail is cleared after, and the whole clear/write/shrink sequence is skipped when nothing needs pruning | a mid-run kill now leaves at worst some already-expired rows sitting past their prune point (stale, not lost); the next successful run re-prunes them |
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
| `Movement_Log_Runs` (**not yet catalogued — no `SHEET-XXX` record exists**) | Write (append, one row every run) + ensure | FN-218 → `ensureMovementLogRunsSheet_` / FN-226 (reads it) | added 2026-09-11 (Lead History & Versioning Review Phase 6, `641398e`); records `run_at`/`run_label`/`lead_count_seen`/`leads_changed` so "did a capture run" stays answerable once an unchanged-leads run stops writing a new `Movement_Log` row; **flagged for a `SHEET-XXX` registration** — see this cycle's spot-check log entry |

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

Verified at `9e55e36`; record created by DOC-029, line anchors and the
`pruneMovementLog_` behavior description refreshed 2026-09-15 (weekly
doc spot-check, cycle 2 — no code changed). File grew 945L → 1000L
since the 2026-09-05 audit (cohort-history persist helpers), then
1000L → 1186L since the 2026-09-10 (`c82ec67`) verification: the Lead
History & Versioning content-hash dedup work (Phases 6-8) and the
2026-09-12 `pruneMovementLog_` interruption-safety fix (`16a9ec6`,
`EXC-091`). 1260L → 1276L by 2026-09-21 (`3a19bdb`, the Drive-archive
addition to `pruneMovementLog_`).

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
