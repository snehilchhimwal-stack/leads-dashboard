# GS-008 — MovementTracker.gs

| | |
|---|---|
| **Type** | `GS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `MovementTracker.gs` (1000 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

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

- `snapshotOpenLeads_` — capture every open lead into `Movement_Log`;
  independently try/catch each side-effect.
- `snapshotPeriodic` / `snapshotNow` — the scheduled and manual entry
  points; `setupMovementTracking` — install the 4 triggers.
- `pruneMovementLog_` — trim rows **and** shrink the sheet's row
  allocation (to stay under the 10M-cell workbook ceiling).
- `writeSlaHistorySnapshot_` — the per-snapshot `SLA_History` row.
- `buildTodayCallBaselineGs_` / `lastSnapshotBeforeGs_` /
  `buildMovementLogMapsGs_` — the maps every other scheduled file reads.
- `computeDailyCohortByRegionGs_` / `persistDailyCohortHistoryGs_` /
  `_evidenceAtDeadlineGs_` — the cohort-history persist (the `.gs` twin
  of `JS-024`'s).
- `checkMovementLogFreshness_` — the freshness check `OpsChecklistRunner.gs`
  reuses.

## Trigger schedule

`setupMovementTracking()` (`#L903`) installs **four separate**
`snapshotPeriodic` triggers — one per entry in `SNAPSHOT_HOURS_` =
`[0, 6, 12, 18]` — each
`ScriptApp.newTrigger('snapshotPeriodic').timeBased().atHour(hour).everyDays(1).inTimezone('Asia/Kolkata')`
(`LOGIC_AUDIT.md` Part 1 §5). Four `atHour()` triggers, **not** one
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
| FN-218 | `snapshotOpenLeads_(label)` `#L365` | `leads` tab | appends one `Movement_Log` row per open lead (the `SNAPSHOT_COLUMNS_` shape) | Sheets write; **each side-effect (SLA_History write, unmatched-comment scan, interaction-history log, cohort-history persist) is independently try/catch-wrapped so one failing never blocks the core capture** | `readLeadsTab_` (`GS-004`), `isOpenLead_` (`GS-002`), `computeSlaFlags_` (`GS-012`), `writeSlaHistorySnapshot_` (FN-221), `scanUnmatchedCommentsGs_` (`GS-013`), `logInteractionHistoryGs_` (`GS-006`), `persistDailyCohortHistoryGs_` (FN-223) | `snapshotPeriodic` (FN-219), `snapshotNow` (FN-219) | specific — the hub capture |
| FN-219 | `snapshotPeriodic()` / `snapshotNow()` / `setupMovementTracking()` `#L898/#L943/#L903` | — | scheduled capture / manual capture / installs the 4 triggers | Sheets writes / creates triggers | FN-218 / `ScriptApp` | the 4 triggers / editor | specific |
| FN-220 | `pruneMovementLog_(ss)` / `pruneMovementLogNow()` `#L451/#L500` | spreadsheet | deletes rows older than the retention cutoff **and shrinks the sheet's row allocation via `deleteRows`** | Sheets structural change | — | FN-218 (after each capture) | specific — "to avoid the 10M-cell workbook ceiling this project has hit once before" |
| FN-221 | `ensureSlaHistorySheet_(ss)` / `writeSlaHistorySnapshot_(ss, dataRows, colIndex, now)` `#L300/#L330` | the snapshot rows | one `SLA_History` row per run | Sheets write | `computeSlaFlags_` (`GS-012`) | FN-218 | specific — **schema matches `js/sheets-writeback.js`'s `SLA_History` writer exactly** (`LOGIC_AUDIT.md` Part 4 §4.7) |
| FN-222 | `buildTodayCallBaselineGs_(ss, beforeDate)` / `lastSnapshotBeforeGs_(ss, beforeDate)` / `buildMovementLogMapsGs_(ss, now)` / `_collapseLatestByKeyGs_` / `_lastMovementLogSnapshotByKeyGs_` `#L259`–`#L291` | `Movement_Log` rows | the baseline / last-snapshot / combined maps every scheduled emailer reads | none | `_readMovementLogRowsGs_` (FN-224) | `GS-001`, `GS-010`, `GS-003` | reusable — the hub's read API |
| FN-223 | `computeDailyCohortByRegionGs_(dateKey, historyRows, liveByKey, now)` / `persistDailyCohortHistoryGs_(ss, dataRows, colIndex, now)` / `eligibleDailyCohortDatesGs_` / `_readArchivedDailyCohortDatesGs_` / `upsertDailyCohortHistoryRowsGs_` `#L705/#L842/#L648/#L828/#L779` | history rows + a date | per-region cohort outcomes; upserts `Daily_Cohort_History` | Sheets write (`RAW`); **never re-writes an archived date** | `_evidenceAtDeadlineGs_` (FN-225), `_effectiveRegionGs_` (FN-225) | FN-218, `persistDailyCohortHistoryNow()` (manual) | specific — **`.gs` twin of `JS-024`'s cohort persist** |
| FN-224 | `ensureMovementLogSheet_(ss)` / `_readMovementLogRowsGs_(ss)` / `_readMovementLogHistoryRowsGs_(ss)` `#L127/#L200/#L581` | spreadsheet | ensures the tab (self-healing header — new columns **appended** to `SNAPSHOT_COLUMNS_`, never inserted mid-array); reads rows | may create the tab | — | FN-218, FN-222, FN-223 | reusable |
| FN-225 | `_evidenceAtDeadlineGs_(historyForKey, deadlineMs, liveEvidence)` / `_effectiveRegionGs_(groupSource, region)` / `_buildLiveLeadIndexGs_` `#L631/#L621/#L679` | a lead's history + a deadline | status as of the deadline / the effective region | none | — | FN-223, `GS-003` | reusable — twin of `evidenceAtDeadline` (`JS-024` FN-162); `_effectiveRegionGs_` is the **reduced** Loan override (`group_source` only — `SNAPSHOT_COLUMNS_` has no `project_region`) |
| FN-226 | `checkMovementLogFreshness_(ss, now)` / `checkMovementLogFreshnessNow()` `#L968/#L985` | spreadsheet + now | `{status, ageHours, label}` — stale if age > `MOVEMENT_LOG_FRESHNESS_GRACE_HOURS_` (8h) | none | — | `OpsChecklistRunner.gs` (`GS-009`), manual | reusable |

## Config constants — `CFG-XXX` sub-table

| ID | Constant | Value | Meaning | Changing it affects |
|---|---|---|---|---|
| CFG-047 | `MOVEMENT_LOG_RETENTION_DAYS` `#L80` | `7` | how many days of `Movement_Log` are kept | `pruneMovementLog_` — one of the **two confirmed retention values** in the whole system |
| CFG-048 | `SNAPSHOT_HOURS_` (a.k.a. `SNAPSHOT_HOURS_`) | `[0, 6, 12, 18]` | the 4 IST capture hours | the trigger cadence — **requires `setupMovementTracking()` re-run** |
| CFG-049 | `MOVEMENT_LOG_FRESHNESS_GRACE_HOURS_` `#L967` | `8` | max age before `Movement_Log` reads "stale" (covers the `[0,6,12,18]` gap + `atHour()` slack) | `checkMovementLogFreshness_` / `OpsChecklistRunner.gs`'s freshness check (this is the constant behind the CI drift `runWeeklyOpsChecklist_(ss, now)` was split to fix) |
| CFG-050 | `SNAPSHOT_COLUMNS_` `#L105` | the snapshot column list — has `region` + `group_source`, **NOT `project_region`** | the `Movement_Log` write schema | every `Movement_Log` reader; the reduced Loan override (FN-225); **matches `js/sheets-writeback.js`'s writer** (`LOGIC_AUDIT.md` Part 4 §4.7) |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-072 | one side-effect (SLA_History / unmatched scan / interaction log / cohort persist) throws | each is **independently try/catch-wrapped** in `snapshotOpenLeads_` | the core `Movement_Log` capture still completes; the failed side-effect is logged, not fatal |
| EXC-073 | `Movement_Log` approaches the 10M-cell workbook ceiling | `pruneMovementLog_` trims rows **and shrinks the row allocation** via `deleteRows` | (historical) a real ceiling incident — mitigated every capture |
| EXC-074 | retention cutoff uses `Date.now() - 7 days` (machine-clock-relative, `#L458`) — the **one** date boundary in this file not built through `istDayKeyGs_` | functionally fine, flagged as inconsistent with the file's own IST convention | none — a consistency note, not a bug (`LOGIC_AUDIT.md` Part 1 §4d) |
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
| `SHEET-002` `Movement_Log` | Write (append) + prune/shrink + ensure | FN-218 / FN-220 / FN-224 | the core output; 7-day retention |
| `SHEET-005` `SLA_History` | Write (append) + ensure | FN-221 | schema matches the client writer |
| `SHEET-008` `Daily_Cohort_History` | Write (upsert, `RAW`) + ensure | FN-223 | never re-writes an archived date |
| `SHEET-010` `Unmatched_Comments_Log` | Write (via `GS-013`) | FN-218 → `GS-013` | piggyback |
| `SHEET-009` `Comment_History` | Write (via `GS-006`) | FN-218 → `GS-006` | piggyback |

## Failure / error behaviour

The core capture is protected by per-side-effect try/catch (EXC-072). A
core-capture failure shows as **Failed** in Executions. `pruneMovementLog_`
runs after each capture to keep the workbook bounded.

## Cross-runtime duplication

`snapshotOpenLeads_`'s `Movement_Log` write schema ↔ `js/sheets-writeback.js`
`browserSnapshotOpenLeads` (`JS-018`) — "agree exactly" (`LOGIC_AUDIT.md`
Part 4 §4.7). `writeSlaHistorySnapshot_` ↔ `upsertSlaHistoryRows`
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

- **Method:** full read at `c82ec67`; function + constant list verified
  by grep (`MOVEMENT_LOG_RETENTION_DAYS = 7` `#L80`; the 4 `atHour()`
  triggers `#L931`; `MOVEMENT_LOG_FRESHNESS_GRACE_HOURS_ = 8` `#L967`;
  the `Date.now()-7d` cutoff `#L458`); cross-check `LOGIC_AUDIT.md` Part
  1 §4d/§5 + Part 4 §4.5/§4.7. `Tests_MovementTracker.gs` runs in CI.
- **Evidence:** `.github/workflows/test.yml` (`Tests_MovementTracker.gs`,
  last green run); `LOGIC_AUDIT.md` Part 4 §4.7.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-029. File grew 945L →
1000L since the 2026-09-05 audit (cohort-history persist helpers).

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

none — Closed + Monitored. (EXC-074, the machine-clock retention cutoff,
is a documented consistency note, not a defect.)

## Closure evidence

Record committed for DOC-029; `docs/INDEX.md` `GS-008` → `Closed +
Monitored`, `Last Verified` 2026-09-10, links + the 4-trigger schedule
recorded; `CFG-047`..`050`, `EXC-072`..`075`. No `docs/changes/` record
(DOC-029).
