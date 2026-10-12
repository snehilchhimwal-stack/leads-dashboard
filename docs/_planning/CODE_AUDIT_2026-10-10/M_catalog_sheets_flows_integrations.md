# M - Catalog audit: SHEET / DATA / EXT / FLOW / triggers / changes / validation

Audit of the `docs/` catalog records listed below against the code at HEAD `19038e7` (2026-10-10). Read-only: no record was edited.
Line numbers are `file:line` at HEAD. "Record" = the catalog file; "code" = `*.gs` / `js/*.js` (tests excluded).

Documents read in full: `docs/sheets/SHEET-001..025` + `README.md` (25 records, not 26 - the 26th file is the README),
`docs/data-flows/DATA-001..005` + README, `docs/integrations/EXT-001..004` + README, `docs/architecture/FLOW-001`, `FLOW-002`,
`apps-script-triggers.md`, README, `docs/changes/*` (2 files), `docs/validation/README.md`, `docs/_archive/README.md` (a stub; the archive is empty).

Method: every tab name and every constant that holds one was grepped across all production `.gs` and `js/*.js`; each hit was mapped to its
enclosing function, then the callers of each `ensure*Sheet_` / read / write helper were mapped the same way. Every `ScriptApp.newTrigger`
and every `setupXxx()` was read in full.

---

## 1. Map of every Sheet tab the system touches

Legend: W = writes, R = reads, D = deletes/prunes. "Human" = edited by a person in the Sheet. Retention = what the CODE enforces.

### 1a. Tabs with a record

| Tab | Writers (file:function) | Readers (file:function) | Retention in code | Record |
|---|---|---|---|---|
| `leads` (name fixed by `Core.gs:33` `TAB_NAME_OVERRIDE`; header row 2, data from row 3 - `EmailInfra.gs:1327`) | none in this project (external CRM / MySQL import) | browser: `core-fetch-and-render.js:fetchAndRender` (`A2:AZ`, :75). Backend: `EmailInfra.gs:readLeadsTab_` (:1319) used by `AllIssuesEmailer.gs:sendAllIssuesEmails_`, `OvernightEmailer.gs` (morning, follow-up, backfill, debug, `downloadNoIssueLeadsNow`), `DailyRmIssueLog.gs:captureDailyRmIssues_` + refill, `SlaEngine.gs`, `UnmatchedCommentLogger.gs`, `InteractionHistoryLogger.gs`, `CycleReport.gs:cycleLeadsFreshnessGs_` (:256). Direct reads: `MovementTracker.gs:snapshotOpenLeads_` (:633), `MovementTracker.gs` :1322, `RmHierarchy.gs:auditUnresolvedRms_` (:870) | none (external) | SHEET-001 |
| `Movement_Log` | `MovementTracker.gs:snapshotOpenLeads_` (append, content-hash dedup); `sheets-writeback.js:browserSnapshotOpenLeads` (append); one-off repair fns `removeEarlyCorruptedMovementLogDataNow`, `removeDedupIncidentRowsNow` | `MovementTracker.gs:_readMovementLogRowsGs_`, `_latestContentHashByKeyGs_`, `_readMovementLogHistoryRowsGs_`, `buildMovementLogMapsGs_` (-> `AllIssuesEmailer`, `OvernightEmailer`, `DailyRmIssueLog`, and `StaleLeads` via lastChangeMap), `checkMovementLogFreshness_`; `DailyRmIssueLog.gs` backfill / repair / `buildAssignedAtLookupsGs_` / `reconstructRmPerformanceObservationsGs_`; browser `tab-movement.js:fetchMovementLog` (`A1:Z`, :182) | 7 days (`MovementTracker.gs:80`), `pruneMovementLog_` (:834) after every capture AND from `DailyRmIssueLog.gs:captureDailyRmIssues_` (:175); prefix rows archived to Drive first | SHEET-002 |
| `Movement_Log_Runs` | `MovementTracker.gs:snapshotOpenLeads_` (8 cols, row written right after core capture, completed at run end); `sheets-writeback.js:browserSnapshotOpenLeads` (:886, 4 cols) | `MovementTracker.gs:checkMovementLogFreshness_` (-> `checkMovementLogFreshnessNow`, `OpsChecklistRunner.gs:buildWeeklyOpsChecklistSummary_` :181), `removeDedupIncidentRowsNow` | none (unbounded, 4+ rows/day) | SHEET-015 |
| `SLA_History` | `MovementTracker.gs:writeSlaHistorySnapshot_` (optional phase of every capture, source `AppsScript`); `core-filters.js:snapshotSlaHistory` -> `sheets-writeback.js:upsertSlaHistoryRows` (every `fetchAndRender` + Snapshot-now, source `Dashboard`); `backfillSlaHistoryFromMovementLog` (source `Backfill`); `sortSlaHistorySheet_`; `core-filters.js:clearSlaHistory` (D, all rows) | **no reader of the data.** Only key-column reads for upsert/clear (`sheets-writeback.js:360` `I2:I`, `core-filters.js:210` `A2:A`). The Tracking trend chart is computed from `Movement_Log` (`tab-tracking.js:708` `computeIssueTalliesByRun`) | none | SHEET-005 |
| `Daily_Cohort_History` | `MovementTracker.gs:persistDailyCohortHistoryGs_` -> `upsertDailyCohortHistoryRowsGs_` (last optional phase, source `AppsScript`); `tab-tracking.js:persistDailyCohortHistory` -> `upsertDailyCohortHistoryRows` (source `Dashboard`); `backfillDailyCohortHistoryFromMovementLog` (source `Backfill`); `clearDailyCohortHistory` (D) | `sheets-writeback.js:fetchDailyCohortHistoryForDate`, `fetchAllDailyCohortHistoryRows` (-> `tab-tracking.js`); `MovementTracker.gs:_readArchivedDailyCohortDatesGs_` | none | SHEET-008 |
| `Daily_RM_Issues` | `DailyRmIssueLog.gs:captureDailyRmIssues_` (22:50, 5,000-row chunks), backfill fns, `repairDailyRmIssuesMissingFieldsNow`, `refillDailyRmIssueAssignedAt*` | **only its own file** (prune, refill, repair). No dashboard reader since the 2026-09-04 redesign (`core-fetch-and-render.js:635-640`, `tab-repeat-offenders.js:14`, `:284`) | 7 days (`DailyRmIssueLog.gs:85`), `pruneDailyRmIssueLog_` (:562), archive-to-Drive verified (`archiveChunksVerifiedGs_`, ~:617) then rewrite + tail clear | SHEET-003 |
| `Lead_Followups` | `sheets-writeback.js:clearLeadFollowupsTab` (D), `pushLeadsToFollowups` (A-E, G, H); `OvernightEmailer.gs:pushUnresolvedToLeadFollowups_` (:1314, read-modify-write of ALL rows A-H, 13:00 job only, :2012); column F by a human | `sheets-writeback.js:waitForAllFollowups` (`A2:G`, :794); `OvernightEmailer.gs:waitForFollowupSuggestions_` (13:00 job); `LeadFollowupsStaleness.gs` conditional formatting (col G) | none (dashboard Generate clears it; backend never clears) | SHEET-004 |
| `RM_Hierarchy` | `RmHierarchy.gs:rebuildRmHierarchy` (deletes + recreates the tab from `RM_HIERARCHY_RAW_`, keeps prior `excluded`/`note`/`email`, :596-650), `ensureRmHierarchySheet_`, `clearAllRmHierarchyExclusionsNow`; **`RmHierarchySync.gs:applyRmHierarchySyncPlanGs_`** (nightly 23:15, cell updates to tl/tm/rh/ch, note append, new-joiner rows, :529-539, only when Script Property `RM_HIERARCHY_SYNC_APPLY`=true); human (`excluded`) | `RmHierarchy.gs:loadRmHierarchyAndEmails_` (:1021; -> AllIssues, Overnight, EmailInfra `regionPnlHeadEmailGs_`, `EmailReroute.gs:emailRerouteHierarchyGs_`, audits), `listExcludedRmsNow`; `RmHierarchySync.gs:runRmHierarchySyncGs_`, `showRmHierarchySyncPlanNow`; `DailyRmIssueLog.gs:buildRmHierarchyRoleByNameLowerGs_` (:1255); browser `tab-repeat-offenders.js:fetchRmHierarchyForRollup` (`A1:Z`) | config, none; sync backs both tabs up to Drive CSV before applying (`RmHierarchySync.gs:511-516`) | SHEET-006 |
| `Manager_Directory` | `RmHierarchy.gs:ensureManagerDirectorySheetInternal_` (deletes + recreates, preserves prior emails, :944-991); **`RmHierarchySync.gs:applyRmHierarchySyncPlanGs_`** (fills blank emails with source `HR sheet sync`, appends new managers, :549-554); human | `RmHierarchy.gs:loadRmHierarchyAndEmails_` (:1037), `auditManagerDirectoryEmailGaps_` (:795); `RmHierarchySync.gs` | config | SHEET-007 |
| `Region_Recipients` | `EmailInfra.gs:ensureRegionRecipientsSheet_` (header AND one row per region from `REGION_GROUP_MAP_`, :1108-1121); human | `EmailInfra.gs:loadRegionRecipients_` (:1295) <- `AllIssuesEmailer` :213, `OvernightEmailer` :982, :2224, :2512 | config | SHEET-012 |
| `Comment_History` | `InteractionHistoryLogger.gs:logInteractionHistoryGs_` (optional capture phase), `logInteractionHistoryNow` | none (prune only) | 30 days (`:191`), `pruneCommentHistory_` (:213) every capture, verified archive | SHEET-009 |
| `Unmatched_Comments_Log` | `UnmatchedCommentLogger.gs:scanUnmatchedCommentsGs_` (optional capture phase), `clearReviewedUnmatchedCommentsNow` (D), `dedupeUnmatchedCommentsNow` (D) | human only | 30 days (`:323`), `pruneUnmatchedCommentsLog_` (:336) every capture, verified archive | SHEET-010 |
| `Send_Log` | `sheets-writeback.js:logEmailSend` (:171) - called ONLY from `reports-gmail.js:performGmailSend` (:377); the mailto path does not log | none | none | SHEET-011 |
| `AllIssues_Log` | `AllIssuesEmailer.gs:sendOneAllIssuesEmail_` (append once per thread), `ensureAllIssuesLogSheet_` (self-healing header, :140-153); `OvernightEmailer.gs:sendCombinedMorningEmail_` (cols K/L), `sendCombinedFollowupEmail_` (cols M/N); `AllIssuesEmailer.gs:removeAllIssuesLogRowsInWindowGs_` (one-off D, archived) | `AllIssuesEmailer.gs:sendAllIssuesEmails_` (re-run guard); `OvernightEmailer.gs:loadYesterdaysAllIssuesBucketsGs_`, `loadTodaysCheckpoint1PendingGs_`; `FollowupTracker.gs:followupTrackerReadLogGs_` (:137, -> 16:30 report); `OpsAudit.gs:opsAuditReadAllIssuesLogGs_` (:205) | none | SHEET-013 |
| `Overnight_Log` | `OvernightEmailer.gs:sendCombinedMorningEmail_` (append), `sendCombinedFollowupEmail_` (`followup_sent_at`), `writeFollowupResultGs_` (:304), `ensureOvernightLogSheet_` (self-heal, :317), `backfillTodaysOvernightLogRecipientsNow` | `OvernightEmailer.gs:sendOvernightFollowupEmails_`, `sendOvernightMorningEmails_` (idempotency, A-F of today), `debugFollowupStatusNow`; `OpsAudit.gs:opsAuditReadOvernightLogGs_` (:226) | none | SHEET-014 |
| `Opp_Monitor_Period` | none in code (written by hand / a separate analytics session) | `tab-oppmonitor.js:_fetchOppMonitorTab` | none | SHEET-016 |
| `Opp_Monitor_Month` | none in code | `tab-oppmonitor.js:_fetchOppMonitorTab` | none | SHEET-017 |
| `Feature_Usage` | `sheets-writeback.js:recordComponentUsage` (upsert by `component_id`) | `OpsChecklistRunner.gs:checkStaleComponents_` (positional `A2:D`) | bounded (9 rows) | SHEET-018 |
| `Email_Ledger` | `EmailLedger.gs` plan/attempt/result (called from `AllIssuesEmailer`, `OvernightEmailer` 10:00 + 13:00, CH-level reports, `EmailReroute.gs:emailRerouteResendGs_`); `EmailSweep.gs:sweepEmailBouncesAndReplies_` (bounce/reply/swept_at, :213); `precreateEmailOpsTabsNow` | `EmailLedger.gs:emailLedgerOpenGs_`, `showEmailLedgerTodayNow`, `emailLedgerRecoveryTargetsGs_`; `EmailSweep.gs` (:26, :162); `OpsAudit.gs:opsAuditRun_` (:265); `CycleReport.gs:buildEmailCycleReportGs_` (:310) | 90 days, `pruneEmailLedgerGs_` (:466) only at the end of the 17:00 run; archive via plain `archiveRowsToDriveCsv_` (no record-count proof) | SHEET-019 |
| `Email_Ledger_Exclusions` | `EmailLedger.gs:emailLedgerExcludeGs_` (same callers as above) | `showEmailLedgerTodayNow`; `CycleReport.gs` (:311) | 90 days, same prune | SHEET-020 |
| `Incident_Log` | `EmailLedger.gs:incidentRecordGs_` (every `notifyOpsAlertGs_`, `EmailInfra.gs:362`), `incidentNotifiedGs_`, `releaseHeldIncidentsGs_` | `releaseHeldIncidentsGs_` (hourly watchdog, `EmailInfra.gs:995`); `CycleReport.gs` (:312) | none | SHEET-021 |
| `Daily_Report` | `CycleReport.gs:cycleReportRecordDailyGs_` (upsert by day) | none (`showEmailCycleReportNow` only previews) | none | SHEET-022 |
| `Daily_Checklist` | `DailyChecklist.gs:dailyChecklistRecordGs_` (replace day block) | none | none | SHEET-023 |
| `Followup_Tracker` | `FollowupTracker.gs:followupTrackerRecordGs_` via `emailLedgerReplaceDayBlockGs_` | none | none | SHEET-024 |
| `Email_Reroutes` | `EmailReroute.gs:emailRerouteRecordGs_` (from `emailRerouteHandleBouncesGs_` <- sweep), `endAllEmailReroutesNow`; human (`status`) | `EmailReroute.gs:emailRerouteReadEntriesGs_` / cached (every guarded send + threaded reply via `emailRerouteApplyGs_`), `EmailSweep.gs` (:175), `CycleReport.gs:cycleReportRerouteRowsGs_` (:288) | none | SHEET-025 |

### 1b. Tabs the code touches that have NO record

| Tab | Code | What it is | Recommendation |
|---|---|---|---|
| `Debug_NoIssueLeads` | `OvernightEmailer.gs:downloadNoIssueLeadsNow` (:2374-2383) - deletes and re-creates the tab, writes a diagnostic dump of leads | manual diagnostic; `TEAM_CLAUDE_HANDOVER.md:676` says a ~26,000-cell copy may still exist | a short SHEET record (or a "diagnostic tabs" note in `sheets/README.md`) - it eats cell budget and holds lead data |
| `Movement_Log_backup_2026-09-17_1115` | `MovementTracker.gs:1666` const, `removeStaleMovementLogBackupTabNow` (:1699) archives then deletes it | one-off removal of a stale backup | a retired/one-off note is enough |
| `Opp_Conversion_Tracking` | `Core.gs:removeOppConversionTrackingTabNow` (:506) deletes it if empty | one-off dead-tab removal | same |

Not tabs, but data stores the catalog has no record for: the Drive folder `Leads Dashboard Archive` with one sub-folder per table and
`archive_log.csv` (`Core.gs:246`, `:251`, `:291-410`) - every prune writes there; the `RM_Hierarchy_sync_backup` / `Manager_Directory_sync_backup`
CSVs (`RmHierarchySync.gs:511-516`); `Movement_Log_removed_rows_*.csv` (`MovementTracker.gs:1553`); and Script Properties used as state
(`EMAIL_JOB_RUN_*`, `EMAIL_JOB_ALERTED_*`, `EMAIL_AUDIT_LAST_*`, `RM_HIERARCHY_SYNC_STATE`/`_APPLY`, `EMAIL_CYCLE_REPORT_SENT_DAY`,
`DAILY_RM_ISSUE_DIAG`, `SNAPSHOT_PHASE_ALERTED`). One more external source: the HR roster spreadsheet read by
`RmHierarchySync.gs:readHrRosterValuesGs_` (`SpreadsheetApp.openById`, :576).

---

## 2. Triggers: code vs `docs/architecture/apps-script-triggers.md`

Found in code: **19 time-based triggers from 10 setup functions.** The doc lists **10 triggers (rows 1-10)**. No installable
onEdit/onOpen/onFormSubmit trigger exists anywhere.

| # | Handler | Schedule (IST) | `.inTimezone`? | Installed by (file:line) | In doc? |
|---|---|---|---|---|---|
| 1-4 | `snapshotPeriodic` | `atHour(h)` h in `[0,6,12,18]`, no nearMinute | yes | `MovementTracker.gs:setupMovementTracking` :1401/:1430 | yes |
| 5 | `captureDailyRmIssues` | 22:50 | yes | `DailyRmIssueLog.gs:setupDailyRmIssueLog` :1094-1103 | yes |
| 6 | `sendOvernightMorningEmails` | 10:00 | **no** | `OvernightEmailer.gs:setupOvernightEmailer` :2298 | yes |
| 7 | `sendOvernightFollowupEmails` | 13:00 | **no** | same :2299 | yes |
| 8 | `sendAllIssuesEmails` | 17:00 | yes | `AllIssuesEmailer.gs:setupAllIssuesEmailTrigger` :770-779 | yes |
| 9 | `runWeeklyOpsChecklistNow` | Monday 09:00 | yes | `OpsChecklistRunner.gs:setupWeeklyOpsChecklistTrigger` :300-309 | yes |
| 10 | `emailJobWatchdog` | `everyHours(1)` | no (n/a) | `EmailInfra.gs:setupEmailJobWatchdogTrigger` :1015-1019 | yes (description stale, see below) |
| 11 | `syncRmHierarchyNightly` | 23:15 | yes | `RmHierarchySync.gs:setupRmHierarchySync` :681-690 | **MISSING** |
| 12 | `sendEmailCycleReport` | 16:30 | yes | `CycleReport.gs:setupEmailCycleReportTrigger` :369-378 | **MISSING** |
| 13 | `sweepEmailBouncesAndReplies` | 15:30 (full sweep) | yes | `EmailSweep.gs:setupEmailSweepTrigger` :273-283 | **MISSING** |
| 14 | `sweepBouncesAfterMorning` | 10:30 | yes | same | **MISSING** |
| 15 | `sweepBouncesAfterFollowup` | 13:30 | yes | same | **MISSING** |
| 16 | `sweepBouncesAfterAllIssues` | 17:30 | yes | same | **MISSING** |
| 17 | `auditMorningEmails` | 11:15 | yes | `OpsAudit.gs:setupOpsAuditTriggers` :328-335 | **MISSING** |
| 18 | `auditFollowupEmails` | 14:00 | yes | same | **MISSING** |
| 19 | `auditAllIssuesEmails` | 18:00 | yes | same | **MISSING** |

Other drift in the trigger doc:
- Row 10 says the watchdog watches "a 10:00 / 13:00 / 17:00 email job". `EmailInfra.gs:emailJobScheduleGs_` (:830-857) watches up to 13
  jobs: the 3 email jobs + the RM sync, the cycle report, the full sweep, the 3 bounce checks and the 3 audits (and the snapshot job per the
  P16 change). The deadline is not always hh:30 - a job with a `minute` is due at hh:mm + `EMAIL_JOB_DEADLINE_MINUTES_`.
- "No trigger of their own" list omits `GS-015` EmailLedger, `GS-019` DailyChecklist, `GS-020` FollowupTracker, `GS-021` StaleLeads,
  `GS-022` EmailReroute (all trigger-less, called from other jobs) and wrongly implies `GS-014`/`GS-016`/`GS-017`/`GS-018` are absent.
- "Verified against source at HEAD, 2026-09-10; row 10 added 2026-10-05" - the header claims a verification it no longer has.
- The "Known issue" (triggers 6/7 without `inTimezone`) is still true at HEAD.
- `setupOvernightEmailer()` also calls `setupRmHierarchy()` and creates `Region_Recipients`/`Overnight_Log` (side effects not mentioned).
- `precreateEmailOpsTabsNow()` (`EmailLedger.gs:267`) is a one-off setup step that belongs in the "when you set up" list.

---

## 3. Per-record verdicts

Verdict scale: ACCURATE / MINOR DRIFT / MATERIALLY WRONG / MISSING.

### SHEET records

**SHEET-001 `leads` - MINOR DRIFT**
- Readers table lists GS-001/003/004/008/010; missing `CycleReport.gs:cycleLeadsFreshnessGs_` (:256), `RmHierarchy.gs:auditUnresolvedRms_` (:870),
  `InteractionHistoryLogger`, `UnmatchedCommentLogger`, `SlaEngine` direct read (`SlaEngine.gs:244`). "Automation" list omits the 16:30 report.
- Data Lifecycle: "the only `prune*_` functions are `pruneMovementLog_` / `pruneDailyRmIssueLog_`" - false today (also `pruneCommentHistory_`,
  `pruneUnmatchedCommentsLog_`, `pruneEmailLedgerGs_`). Harmless to the conclusion but stale.
- Not documented: the tab has a banner row 1, header in row 2, data from row 3 (`EmailInfra.gs:1327-1329`, `MovementTracker.gs:637-640`);
  the browser reads `A2:AZ` (52-column cap, `core-fetch-and-render.js:75`).
- The record describes the source as an "external CRM export"; `EmailLedger.gs:263` describes a "live MySQL import". Owner should confirm.

**SHEET-002 `Movement_Log` - MATERIALLY WRONG (purpose/row semantics) + MINOR DRIFT**
- Purpose and Data stored say "every open lead, snapshotted 4x/day". Code: every lead with a non-blank `lead_id`, open or closed
  (`MovementTracker.gs:607-609`, `sheets-writeback.js:854` "any source, open or closed"), and only leads whose content hash changed get a row
  (`MovementTracker.gs:654-668`). The `content_hash` row in the columns table explains dedup, so the record contradicts itself.
- Data Lifecycle "old rows deleted in place" vs its own 2026-10-07 note (prefix archived to Drive first). Prune also runs from
  `DailyRmIssueLog.gs:175` (not listed).
- Readers table missing `DailyRmIssueLog` `buildAssignedAtLookupsGs_` / `reconstructRmPerformanceObservationsGs_` / repair, and StaleLeads (lastChangeMap).
- Risk not recorded: the browser reads exactly `A1:Z` (`tab-movement.js:182`) and the tab now has exactly 26 columns (A-Z) - a 27th column
  would be silently dropped by the dashboard read.
- "Exceptions": the browser writer snapshots `allParsedLeads` (post-collation merged leads, `sheets-writeback.js:854`) while the backend writes
  raw tab rows - "identical schema" holds, identical row semantics does not. Worth one line.

**SHEET-003 `Daily_RM_Issues` - MATERIALLY WRONG**
- Purpose, Destination, Readers table, Operational importance and Relationships all say the dashboard's Repeat Offenders tab (`JS-022`/`TAB-004`)
  reads it. No `js/*.js` reads the tab (it was dropped as a data source 2026-09-04: `core-fetch-and-render.js:635-640`,
  `tab-repeat-offenders.js:14`, `:284`). The record's own 2026-10-08 note says "Nothing reads this tab" - the record contradicts itself.
- Archive/Delete says "old rows deleted in place"; code archives to Drive with a verified record count first, then rewrites kept rows and clears
  the tail (`DailyRmIssueLog.gs:~617-631`).
- `INDEX.md:276` still lists `JS-022, TAB-004` under Used By.

**SHEET-004 `Lead_Followups` - MATERIALLY WRONG (two points)**
- "Automation" says it is written by "the `OvernightEmailer.gs` 10:00 trigger". The backend push and poll happen only in the 13:00 job
  (`OvernightEmailer.gs:2012-2014`); the 10:00 job does not touch the tab.
- "Column F is never written by any script": the backend push reads A-H of every existing row and writes the whole block back
  (`OvernightEmailer.gs:1330`, `:1352-1355`), re-writing column F with the value it read. A human edit to F (or any column) between that
  read and that write is lost. The never-write-F contract is broken in practice by a read-modify-write race; the record and
  `LEAD_FOLLOWUPS_STALENESS.md` should say so.
- Minor: the `#L171` / `#L226-230` / `#L773` anchors are stale (the comment is now `OvernightEmailer.gs:1296`, reads at `sheets-writeback.js:224/794`).

**SHEET-005 `SLA_History` - MATERIALLY WRONG**
- Destination/Readers: "`JS-024` reads it for the trend chart". Nothing reads the data: the Tracking chart is computed from `Movement_Log`
  runs (`tab-tracking.js:708`); the only reads are key columns for upsert/clear. The tab is write-only, which changes its purpose
  ("keeps the trend after 7 days" is not consumed anywhere).
- `source` values: record says `movement` / `browser` / `backfill`; code writes `AppsScript` (`MovementTracker.gs:564`), `Dashboard`
  (`core-filters.js:195`), `Backfill` (`sheets-writeback.js:469`).
- The backend write is an optional phase that is skipped when the run is past its 840 s budget (`MovementTracker.gs:578`, `:585-591`,
  `:707`) - "written every capture" is not guaranteed. Browser writes on every `fetchAndRender`, not mentioned.
- `#L185` anchor stale (`SLA_HISTORY_COLUMNS_` is at :312). Prune-list claim stale (see SHEET-001).

**SHEET-006 `RM_Hierarchy` - MATERIALLY WRONG (missing writer)**
- Writers table has only `rebuildRmHierarchy` + a human. `RmHierarchySync.gs` (GS-014, live since 2026-10-08) writes chain fields, notes and
  new rows nightly at 23:15 when apply mode is on (`:529-539`), and backs the tab up to Drive. Not mentioned anywhere in the record, though
  `INDEX.md:279` lists GS-014 under Used By.
- Interaction risk not recorded: `rebuildRmHierarchy` deletes and recreates the tab from `RM_HIERARCHY_RAW_`, preserving only
  `excluded`/`note`/`email` (`RmHierarchy.gs:596-650`). A manual rebuild therefore reverts every chain change the nightly sync applied and
  drops every new joiner the sync added that is not in `RM_HIERARCHY_RAW_`.
- Readers missing: `DailyRmIssueLog.gs:buildRmHierarchyRoleByNameLowerGs_` (:1255), `EmailReroute.gs` (via `loadRmHierarchyAndEmails_`), the sync.
- "Source of the data ... Not hand-edited as the source (edits should go to `RM_HIERARCHY_RAW_` + a rebuild)" is superseded by the sync.
- The record names a specific employee in "Data stored"; consider replacing with a role description (repository is public per `RmHierarchySync.gs` comment).

**SHEET-007 `Manager_Directory` - MATERIALLY WRONG (missing writer, resolved TBD)**
- Missing writer `RmHierarchySync.gs` (:549-554: fills blank emails with `email_source` `HR sheet sync`, appends managers).
- `email_source` values: record `private_file` / `manual` / blank; code writes `manual`, `HR export auto-match`, blank (`RmHierarchy.gs:~986`)
  and `HR sheet sync`.
- The open "TBD - whether a rebuild preserves hand-filled email values" is answered by code: it does (`priorEmails`, `RmHierarchy.gs:955`), then
  deletes and recreates the tab (:991). Close the TBD.
- `resolveRecipientEmailsForRegion_` does not read the tab directly; it goes through `loadRmHierarchyAndEmails_`.

**SHEET-008 `Daily_Cohort_History` - MINOR DRIFT**
- `source` values wrong (`AppsScript` / `Dashboard` / `Backfill`, not `movement`/`browser`/`backfill`).
- "Written every capture" - it is the last optional phase and is skipped past the time budget (`MovementTracker.gs:727-733`).
- Line anchors `#L559/#L561/#L472` stale (`MovementTracker.gs:1008`, `sheets-writeback.js:493`). Columns match.

**SHEET-009 `Comment_History` - MINOR DRIFT**
- "Important logic" still says "No automatic pruning (EXC-069)"; Validation still says "the 'no pruning by design' ... claims" - both
  contradict the record's own 30-day section. Sensitivity "accumulated indefinitely" likewise stale. Columns, retention, prune: correct.

**SHEET-010 `Unmatched_Comments_Log` - MINOR DRIFT**
- Validation says "the manual-curation retention model"; Revalidation trigger says "a time-based prune is added" (it has been). Columns,
  retention (30 days, `:323`) and writers correct.

**SHEET-011 `Send_Log` - MINOR DRIFT**
- "every region email the dashboard sends (via Gmail or `mailto:`)" - only the Gmail API path logs (`reports-gmail.js:377` is the sole
  caller of `logEmailSend`); a `mailto:` send leaves no row. Columns match (`sheets-writeback.js:136`).

**SHEET-012 `Region_Recipients` - MINOR DRIFT**
- "writes the header only" - `ensureRegionRecipientsSheet_` also seeds one row per region from `REGION_GROUP_MAP_` (`EmailInfra.gs:1117-1120`).
- Says `GS-011 resolveRecipientBucketsForRms_` reads it; the legacy map is loaded in `EmailInfra.gs:loadRegionRecipients_` and passed in.
- `#L280` anchor stale.

**SHEET-013 `AllIssues_Log` - MATERIALLY WRONG (importance + readers)**
- Operational importance LOW / "Read only by GS-001 itself ... pruning old rows is functionally safe" is wrong: the next day's 10:00 job builds
  Checkpoint 1 from yesterday's rows and the 13:00 job builds Checkpoint 2 from today's (`loadYesterdaysAllIssuesBucketsGs_`,
  `loadTodaysCheckpoint1PendingGs_`) - the record's own column table says so. Pruning recent rows would silently drop follow-ups.
- Readers missing `FollowupTracker.gs` (:137) and `OpsAudit.gs` (:205); record Used By lacks GS-018/GS-020 that `INDEX.md:286` has.
- "Risks ... Only GS-001 touches it, so the blast radius is one file" - false (GS-001, GS-010, GS-018, GS-020).
- Writers missing the one-off `removeAllIssuesLogRowsInWindowGs_` deletion path (`AllIssuesEmailer.gs:799-844`).
- Columns correct (`AllIssuesEmailer.gs:140-141`).

**SHEET-014 `Overnight_Log` - MINOR DRIFT (one material line)**
- Writers table still lists `sendOneOvernightEmail_` (FN-233) as a writer; that function has no caller at HEAD (`OvernightEmailer.gs:424`,
  dead code). The real writer is `sendCombinedMorningEmail_` (:728).
- Readers missing `OpsAudit.gs:opsAuditReadOvernightLogGs_` (:226) (INDEX has GS-018). The retention suggestion "keep ~2 days is likely safe"
  should note the audits read today's rows only - still safe.
- Header anchors `#L266/#L274/#L282` stale (now `:297`, `:317`). Columns correct.

**SHEET-015 `Movement_Log_Runs` - MINOR DRIFT**
- "Both write at the end of their capture, after the prune": the backend writes the row right after the core capture, BEFORE the prune and the
  optional phases, then completes `total_s`/`skipped_phases`/`failed_phases`/`phase_s` at run end (`MovementTracker.gs:690-697`).
- Data Lifecycle "Small enough (4 columns ...)" - 8 columns. `lead_count_seen` is "total leads with an id", not "total open leads".
- Readers missing `removeDedupIncidentRowsNow` (one-off). "Two-writer schema parity" is already broken by design (browser writes 4 of 8 columns,
  `tab-movement.js:55`); the record notes it in Columns but the Risks section still demands same-commit parity.

**SHEET-016 `Opp_Monitor_Period` - ACCURATE** (21 columns match `tab-oppmonitor.js`). Small gap: since 2026-09-21 the tab shows a computed "Live"
row from the `leads` tab when no official row exists (`tab-oppmonitor.js:12-22`); worth one line under Destination.

**SHEET-017 `Opp_Monitor_Month` - ACCURATE** (18 columns match). Same "Live row" note.

**SHEET-018 `Feature_Usage` - ACCURATE** (columns, 9 tracked ids on both runtimes, positional read in `OpsChecklistRunner.gs`).

**SHEET-019 `Email_Ledger` - MINOR DRIFT (stale "future" wording)**
- Columns match `EmailLedger.gs:122-124`. Retention 90 days correct.
- Source/Automation say written only from GS-001 / "during the 17:00 trigger"; it is also written by the 10:00 and 13:00 jobs, CH-level
  reports, `EmailReroute.gs` re-sends (job `reroute`), the bounce sweep (cols U-W) and `precreateEmailOpsTabsNow`.
- Destination says "None yet except showEmailLedgerTodayNow ... will read it" - EO-3/4/5/8 are built and live (OpsAudit, EmailSweep, CycleReport).
- `job` list misses `reroute` (`EmailLedger.gs:138`).
- Component Status "created on the first 17:00 run after GS-015 is pasted" and "Not live until pasted" are stale (deployed 2026-10-10; tabs
  pre-created).
- Not recorded: the ledger prune uses plain `archiveRowsToDriveCsv_` without the record-count proof the other prunes use (`EmailLedger.gs:~489`).

**SHEET-020 `Email_Ledger_Exclusions` - MINOR DRIFT** - same stale "17:00 only" / "none yet" / "not live" wording; CycleReport reads it.
"Risks" copies SHEET-019's "writes the nine outcome columns" text, which does not apply to this tab. Columns match (`:125`).

**SHEET-021 `Incident_Log` - MINOR DRIFT** - CycleReport (16:30) already reads it (`CycleReport.gs:312`), not "will count". Columns match (`:509-510`).
"Not live until pasted" stale.

**SHEET-022 `Daily_Report` - ACCURATE** (21 columns match `CycleReport.gs:34-35`; "not live until pasted" stale only).

**SHEET-023 `Daily_Checklist` - ACCURATE** (6 columns, `DailyChecklist.gs:25`).

**SHEET-024 `Followup_Tracker` - ACCURATE** (14 columns, `FollowupTracker.gs:30`). Version line cites `d9e2b97` while header says `b6e714b` - pick one.

**SHEET-025 `Email_Reroutes` - ACCURATE** (12 columns, `EmailReroute.gs:42`; readers incl. the sweep). Status line "Not live until pasted" stale.

**`docs/sheets/README.md` - MATERIALLY WRONG**: "base records for the 14 Google Sheet tabs ... the other 10 carry TBD" - there are 25.

### DATA records

**DATA-001 core lead record - MINOR DRIFT** - flow is right. Anchors stale: `allParsedLeads` written at `core-fetch-and-render.js:584` (record
`#L566`), `enrichLead` at `core-lead-model.js:241` (record `#L202`). `mergeRowsIntoOneLead` is a nested function (:353), fine.

**DATA-002 SLA-flag pipeline - MATERIALLY WRONG (display/consumer claims)**
- Display: "`TAB-004` Repeat Offenders leaderboards" fed by these flags via `Daily_RM_Issues`, and "`TAB-008` Tracking trend chart (from
  `SLA_History`)" - neither tab reads those sheets (see SHEET-003/005).
- `computeRmPerformanceGs_` cited at `#L1289`; it is at `DailyRmIssueLog.gs:1612` and is only called by the console helper
  `reportRmPerformanceNow` (:1651) - it is not part of any scheduled flow.
- Ultimate consumers omit the 13:00 reply and CH-level reports.

**DATA-003 comment classification - MINOR DRIFT**
- Retention: "Unmatched log: SHEET-010 (manually curated - rows persist until marked reviewed)" - 30-day prune since 2026-09-29.
- `Comment_History` "append-only" - now pruned at 30 days.
- `pushLeadsToFollowups` anchor `#L187` stale (:208). Classification steps match code anchors (`core-outcome-engine.js:230/569`, `FollowupEngine.gs:147/403`).

**DATA-004 Movement snapshot pipeline - MATERIALLY WRONG (steps 1-2)**
- Step 1 "Open-lead filter `isOpenLead_` / `isLeadClosed`" - neither writer filters; both snapshot every lead with an id (`MovementTracker.gs:607-609`,
  `sheets-writeback.js:850-854`).
- Step 2 "+ `computeSlaFlags_` for the flag columns" - `Movement_Log` has no flag columns (`SNAPSHOT_COLUMNS_`, `MovementTracker.gs:105-131`).
- Missing: the content-hash dedup step, `Movement_Log_Runs`, the 840 s optional-phase budget.
- Display: "TAB-008 Tracking (cohorts + trend, via SLA_History / Daily_Cohort_History)" - trend comes from `Movement_Log`.
- Anchors stale (`snapshotOpenLeads_` :618 not `#L365`; `browserSnapshotOpenLeads` :830 not `#L809`; `fetchMovementLog` :158 not `#L138`).

**DATA-005 region-email pipeline - MATERIALLY WRONG (send step and logs)**
- Step 5 names `sendOneOvernightEmail_` as the 10:00 send; it has no caller. The scheduled sends are `sendCombinedMorningEmail_` (:728),
  `sendCombinedFollowupEmail_` (:1687), `sendOneAllIssuesEmail_`, all through `EmailInfra.gs:sendGuardedEmailGs_` (:707), with the
  bounce re-route (`emailRerouteApplyGs_`) applied first.
- The whole Email Ops layer is absent: `Email_Ledger` / `Email_Ledger_Exclusions` / `Incident_Log` / `Email_Reroutes`, the bounce sweep, the
  audits and the 16:30 report. "Stored As" lists only Send_Log / AllIssues_Log / Overnight_Log.
- Backend human-review step: the push+wait runs only in the 13:00 job.
- The HIGH Loan-region finding is still open at HEAD (no `project_region` in `Core.gs` `HEADER_ALIASES_`, no `.gs` `effectiveRegion` twin) - that part is accurate.
- Anchors stale (`sendOvernightMorningEmails_` :968, `sendAllIssuesEmails_` :196, `resolveRecipientEmailsForRegion_` :1170, `performGmailSend` :339).

### EXT records

**EXT-001 Google Sheets API - MINOR DRIFT**
- "What it's used for" lists 11 tabs; the backend now reads/writes 25 (all Email Ops tabs, Feature_Usage, Movement_Log_Runs, Opp_Monitor_*,
  RM sync). "Called from" misses `JS-025` (Opp Monitor reads), `JS-024`/cohort reads, the RM sync.
- A second spreadsheet is opened by ID: the HR roster (`RmHierarchySync.gs:576`, `SpreadsheetApp.openById`) - an external read needing the
  owner's access; not recorded here or in any EXT.
- "10M-cell ceiling mitigated by pruneMovementLog_ / pruneDailyRmIssueLog_" - also the comment prunes and the ledger prune; the cell-budget
  diagnostic (`Core.gs computeWorkbookCellUsageGs_`).
- Anchors stale (`sheetsApiValuesGet` :107 not `#L100`; `readLeadsTab_` :1319 not `#L431`).

**EXT-002 Gmail - MINOR DRIFT (one material gap)**
- Called-from still lists `sendOneOvernightEmail_` (dead). Missing: `sendGuardedEmailGs_` (the single report-send path), `sendCombinedMorningEmail_`,
  `EmailReroute.gs:emailRerouteResendGs_`, `OpsChecklistRunner.gs:277`, `RmHierarchySync.gs:645`, CycleReport/OpsAudit alerts.
- **Gmail READ use is not recorded at all**: `EmailSweep.gs` uses `GmailApp.search` and `GmailApp.getThreadById`, `EmailReroute.gs` uses
  `GmailApp.getMessageById`, `OvernightEmailer.gs` uses `Gmail.Users.Threads.get`. The backend therefore needs a read-capable Gmail scope;
  the record's scope/permissions section only discusses send.
- API-005 says `GmailApp.sendEmail` for reports; reports go through `GmailApp.createDraft(...).send()` (`EmailInfra.gs:718`); `sendEmail` is used
  for ops alerts and the RM-sync / weekly reports. The record's later revalidation notes say this; the API table was never updated.
- `performGmailSend` / `withSendRetry_` / `sendThreadedGmailReply_` anchors stale.

**EXT-003 Google Identity / OAuth - ACCURATE** (`GATE_SCOPE` :27, `initGateTokenClient` :39, `fetchGateUserEmail` :60, `gateSignIn` :78,
`DEFAULT_CLIENT_ID` :42 all match).

**EXT-004 jsPDF - ACCURATE** (CDN versions 2.5.1 / 3.8.2 at `dashboard.html:22-23`, load order as described).

**Missing EXT coverage:** Google Drive (`DriveApp` - every prune archive, `archive_log.csv`, sync backups); the HR roster spreadsheet; Apps Script
platform services relied on for correctness (`LockService` job lock, `PropertiesService` run records/state). One `EXT-` for Drive and a
note for the HR sheet would close the gap.

### FLOW records

**FLOW-001 Movement hub - MATERIALLY WRONG (row semantics + missing parts)**
- Step 2 "writes one `Movement_Log` row per open lead" - every lead with an id, changed-content only.
- Missing participants/outputs: `Movement_Log_Runs`, the comment prunes, the per-run time budget that can skip SLA_History / scans /
  Daily_Cohort_History, failure e-mail (`failed_phases`).
- "Produces: Movement_Log + SLA_History rows (always)" - SLA_History is optional and skippable.
- "Loan leads can be attributed to the wrong region in `Movement_Log`" - `Movement_Log` stores the raw region; the reduction happens at read time
  (`_effectiveRegionGs_`, `MovementTracker.gs:1063`).
- The JS on-demand path also writes `SLA_History` (true) but not `Comment_History`/`Unmatched_Comments_Log` or the prunes - worth saying.
- Cell numbers (5.6M + 2.4M) are dated; `Daily_RM_Issues` now holds ~7 x 10,000 rows by design (SHEET-003 2026-10-08 note).

**FLOW-002 Generate cycle - MATERIALLY WRONG (who fills column F)**
- Step 3 "never F, which the backend owns" and step 4a "the backend ... compute and write col F" contradict SHEET-004 and the code: nothing in
  code writes column F - it is filled by a human (`OvernightEmailer.gs:1340-1345` comment; `pushLeadsToFollowups` writes A-E, G, H). The
  backend 13:00 job is a second *consumer* of F, not its producer. As written, the doc tells a reader the wait completes on its own.
- Step 4 attributes `waitForAllFollowups` to `JS-016`; it is in `sheets-writeback.js` (JS-018) and called from `reports-ui.js`.
- Business rules: "browser writes A-E/G, backend owns F" - same error; also omits column H.

### apps-script-triggers.md - MATERIALLY WRONG (see section 2: 9 of 19 triggers missing).

### architecture/README.md - MINOR DRIFT - "Index of every time-based Apps Script trigger" - it is not every one.

### changes/ - MATERIALLY WRONG (process gap)
`2026-09-10-build.md` promises "The next real post-catalog code change gets its own `docs/changes/<date>-<sha>.md`". Dozens of code changes
since (email audit P1-P18, Email Ops EO-1..EO-13, RM sync) have no change record; the folder still holds only that one file. Either produce the
records or change the governance rule to point at the per-record "Version / change reference" sections (which is what actually happens).

### validation/README.md - MATERIALLY WRONG
- "All 69 records ... `git log c82ec67..HEAD -- js/*.js *.gs dashboard.html` is empty, so still current" - false; the catalog now has far more
  records and the code has moved a long way.
- "7 other SHEET- tabs - retention genuinely unknown ... TBD" - outdated (Comment_History/Unmatched 30 d, Email_Ledger 90 d, Feature_Usage bounded).
- Frontend harness "59/59" vs records citing 170/170.

### _archive/README.md - ACCURATE (stub; archive empty). Note: no retired-component records exist even though the code has removed tabs
(`Opp_Conversion_Tracking`, the Movement_Log backup) and dead functions (`sendOneOvernightEmail_`).

---

## 4. Prioritised fixes (not made)

P1 - wrong in a way that misleads a maintainer or hides a risk
1. `apps-script-triggers.md`: add the 9 missing triggers (RM sync 23:15, cycle report 16:30, sweep 15:30 + 10:30/13:30/17:30, audits
   11:15/14:00/18:00), fix row 10's scope, the "no trigger" list and the verification header. Total = 19.
2. SHEET-006 / SHEET-007: add `RmHierarchySync.gs` (GS-014) as a writer; record the rebuild-vs-sync conflict (a manual `rebuildRmHierarchy`
   reverts synced chain fields and drops synced new joiners not in `RM_HIERARCHY_RAW_`); close SHEET-007's email-preservation TBD; fix
   `email_source` values.
3. SHEET-004 / `LEAD_FOLLOWUPS_STALENESS.md`: correct "10:00 trigger" to 13:00; document the backend read-modify-write of all rows A-H
   (a concurrent human edit to F can be overwritten). FLOW-002: remove "backend owns/fills column F".
4. SHEET-003 and SHEET-005 (+ DATA-002, DATA-004, `INDEX.md:276/278` Used By): remove the dashboard readers that no longer exist; mark
   `SLA_History` as write-only (and decide whether it is still needed); mark `Daily_RM_Issues` as audit-only.
5. SHEET-013: raise operational importance (the 10:00/13:00 Checkpoint flow depends on recent rows), add GS-018/GS-020 readers, fix the
   "one file" blast radius.
6. DATA-005 / EXT-002 / SHEET-014: replace dead `sendOneOvernightEmail_` with the real send path (`sendCombinedMorningEmail_` /
   `sendGuardedEmailGs_`); add the Email Ops layer to DATA-005; record EXT-002's Gmail READ usage (search/getThreadById/getMessageById/Threads.get).
7. SHEET-002 / FLOW-001 / DATA-004: replace "every open lead" with "every lead with an id, only when its content hash changed"; remove the
   open-lead-filter and `computeSlaFlags_` steps; add Movement_Log_Runs and the time budget; note the `A1:Z` 26-column read limit.

P2 - stale but low risk
8. Add short records or a "diagnostic / one-off tabs" section for `Debug_NoIssueLeads`, `Movement_Log_backup_2026-09-17_1115`,
   `Opp_Conversion_Tracking`; add an EXT (or SHEET-like) record for the Drive archive (`Leads Dashboard Archive`, `archive_log.csv`,
   sync backups) and note the HR roster spreadsheet as an external source.
9. SHEET-019..025: drop "not live until pasted" / "created on first run" / "none yet ... will read it"; add the real readers/writers
   (OpsAudit, EmailSweep, CycleReport, EmailReroute, 10:00/13:00 jobs); add `reroute` job id; fix SHEET-020's copied "nine outcome columns" text.
10. `source` values in SHEET-005/008 (`AppsScript` / `Dashboard` / `Backfill`); Send_Log is Gmail-path only (SHEET-011); Region_Recipients seeds
    region rows (SHEET-012).
11. SHEET-009/010: remove the leftover "no pruning / manual curation" sentences. DATA-003 retention lines.
12. `docs/sheets/README.md` (14 -> 25 tabs), `docs/validation/README.md` (false "still current" claim, retention row, harness count),
    `docs/changes/` (either write records or retire the rule).
13. Refresh stale `#Lnn` anchors across SHEET-001..015, DATA-001..005, EXT-001/002 (`python3 test/check-staleness.py --fix-anchors` covers part).
14. SHEET-015: "after the prune" wording, 8 columns, `lead_count_seen` meaning, parity rule vs the 4-column browser writer.

P3 - observations for the code owners (outside this audit's write scope)
- `EmailLedger.gs:pruneEmailLedgerGs_` archives without the record-count proof the other prunes adopted in P18 (`archiveChunksVerifiedGs_`).
- `OvernightEmailer.gs:sendOneOvernightEmail_` (:424) has no caller - candidate for removal (and for `TEAM_CLAUDE_HANDOVER.md` section 18).
- The two `OvernightEmailer.gs` triggers still lack `.inTimezone('Asia/Kolkata')` (`:2298-2299`) - long-known, still open.
- `SLA_History` has no reader; every dashboard refresh still writes to it.
