# K — Catalog (`docs/`) index, guides and `GS-` records vs the code at `19038e7`

Audit date: 2026-10-10/12 (read-only; HEAD `19038e7`, unchanged during the audit).
Scope: `docs/INDEX.md`, `docs/RELATIONSHIP_MAP.md`, `docs/NAMING_CONVENTIONS.md`, the four `docs/HOW_TO_*.md`,
`docs/PRE_SHIP_DOCUMENTATION_CHECKLIST.md`, `docs/_templates/*`, and all 22 `docs/gs-modules/GS-*.md` records
(the brief said 23; there are 22 — one per production `.gs` file, `RmHierarchy.private.gs` deliberately excluded).
Nothing was edited, committed, or run against the live Sheet / Gmail / Apps Script. No personal data is quoted here
(note: `GS-011` CFG-093 itself quotes two real leadership names in a committed doc — see §6 item 14).

Method: the three repo checks (`check-catalog.py`, `check-staleness.py`, `whatis.py`), then four throw-away
scripts (in the session scratchpad, not the repo) that (a) list every top-level `function`/`const`/`let` in each
`.gs` and diff them against every backticked name in its record and its `FN-`/`CFG-` tables, (b) find every
cross-file call and sheet-name constant use per `.gs` (comments stripped) and compare with `Depends On` /
`Sheets touched`, (c) diff each record's `## Relationships` against its `INDEX.md` row, and (d) resolve every
`#Lnn` anchor in the 22 records — prose as well as table rows — against the real declaration line. Every
discrepancy below was then checked by hand in the source.

---

## 1. How the catalog is organised and maintained (understanding aid)

**IDs.** `<PREFIX>-NNN`, numbered in first-documented order, never reused (`NAMING_CONVENTIONS.md`).
Own-file records: `DASH-` (1), `TAB-` (9), `JS-` (25), `GS-` (22), `SHEET-` (25), `EXT-` (4), `DATA-` (5),
`FLOW-` (2, overlays in `architecture/`). Sub-table IDs live inside their owner record: `FN-` (001–433),
`CFG-`, `RULE-`, `EXC-`, `BTN-` (001–022), `UI-`, `API-`. Four prefixes (`RANGE- HTML- CSS- CLASS-`) are
deliberately empty; `TRIGGER-` is not used — triggers are one un-ID'd index, `architecture/apps-script-triggers.md`.

**The master table.** `docs/INDEX.md` has one row per own-file record (93 rows) with Location, Record Status,
Depends On, Used By, Last Verified. Only `BTN-` sub-IDs get rows there; `FN-/CFG-/RULE-/EXC-` do **not**
(contrary to what `NAMING_CONVENTIONS.md` and `_templates/README.md` say — see §4).

**A `GS-` record** (template `_templates/gs-module-template.md`): header table → Purpose → Responsibilities →
Trigger schedule → "Requires setupXxx() re-run when" → `FN-` / `RULE-` / `CFG-` / `EXC-` tables (with `#Lnn`
anchors) → Data lineage → Sheets touched → Failure behaviour → Cross-runtime duplication → Not live until
pasted → Relationships (Depends On / Used By / Related) → Validation → dated Version / change history →
Revalidation trigger → Handover relationship → Next action → Closure evidence.

**Automated half of the change-control loop.**
- `test/check-catalog.py` (CI): blocking A (INDEX reciprocity), B (INDEX↔record-file coverage), C (Location
  file exists), F (coverage-snapshot counts); advisory D (Last Verified behind the Location file's last
  commit), E (changed paths → component IDs + 1-hop + an `update-tasks.ps1` JSON), G–P (sub-ID uniqueness,
  owner/evidence, cited literals, LOGIC_AUDIT immutability, TBD retention, sheet-tab coverage, button coverage,
  EXC thrown-literal, HANDOVER load order, **P: every `FN-` cited name exists in its owner's source**).
- `test/check-staleness.py`: A (anchor drift — **only `FN-`/`CFG-` table rows, only when the count of
  backticked names equals the count of anchors**), B (record TTLs), C (stated facts), D (Apps Script deploy
  register), E (watch register), F–H.
- `test/whatis.py <file|id|name>`: prints Purpose / cross-runtime / handover / one hop of Depends On.

**Human half.** `HOW_TO_REGISTER / UPDATE / RETIRE` + `PRE_SHIP_DOCUMENTATION_CHECKLIST.md`: on every code
change update the affected record fields, Last Verified, the INDEX row, both sides of any new edge, HANDOVER
if architectural, a `docs/changes/` record.

**What none of the checks look at** (this is where the drift below sits): (1) whether a record's
`## Relationships` matches its own `INDEX.md` row; (2) whether a `Depends On` edge reflects a real call in the
code (A only checks the two INDEX columns agree with each other); (3) functions/constants present in the code
but absent from the record (P only checks the reverse); (4) prose `#Lnn` anchors and RULE/EXC anchors, and
any FN/CFG row whose names and anchors do not pair one-to-one; (5) `## Sheets touched` vs real sheet access;
(6) `(N lines)` counts in the Location cell; (7) the narrative/coverage paragraphs in INDEX, RELATIONSHIP_MAP
and the guides.

---

## 2. Output of the checks run

| Check | Result |
|---|---|
| `python3 test/check-catalog.py` | **All clean.** 93 INDEX rows; A/B/C/F OK; D, E (skipped — no base sha), G (730 sub-IDs), H, I, J, K, L (25 tab names), M (26 buttons), N, O, P (646 FN names all exist) clean. |
| `python3 test/check-staleness.py` | A: 609 anchors checked, 607 ok, 0 drifted, **61 "not machine-checkable"**. B: 0 drifted / 0 overdue records, JS-005 + JS-010 overdue in 8 d. C: 0 stale facts. D: all 22 `.gs` files match their confirmed-live commit. E: **2 STALE watch items** (Movement_Log dedup health, `leads` header vs `HEADER_ALIASES` — both due 2026-10-02), 2 AT-RISK. F–H clean. |
| `python3 test/whatis.py EmailReroute.gs` | works (GS-022 purpose + relationships). `whatis.py Email_Reroutes` works (SHEET-025). **`whatis.py sweepBouncesAfterMorning` (a trigger handler / function name) → "No docs/INDEX.md row matches"** — no function-level lookup. |

The green result is real but narrow: the checks prove the INDEX is internally consistent and that cited
names exist, not that the records describe the code. The manual pass below found anchor drift the checker
reported as "0 drifted", 10 records whose Relationships disagree with their own INDEX row, and missing edges
that A cannot see.

---

## 3. Per-record verdicts

Legend: ACCURATE · MINOR DRIFT (stale counts/anchors/omitted helpers, nothing that would mislead a change) ·
MATERIALLY WRONG (would mislead someone making a change: wrong owner, wrong/missing dependency, contradictory
trigger statement, missing public entry point) · MISSING.

Common to most of GS-001…GS-013: the Location cell's `(N lines)` is stale (e.g. GS-001 says 702, real 844;
GS-002 417/529; GS-003 1346/1669; GS-004 1314/1444; GS-010 2349/2517; GS-011 1355/1367; GS-008 1700/1718).
Not repeated below.

### GS-001 AllIssuesEmailer.gs — MINOR DRIFT
- Trigger section anchor `setupAllIssuesEmailTrigger()` `#L605` (record line 36) → real `AllIssuesEmailer.gs:770`. Schedule itself (17:00 nearMinute 0, IST) correct (`:774-779`).
- `## Sheets touched` last row still says "`AllIssues_Log` … not yet a `SHEET-XXX` (count TBD, DOC-010/032)" — `SHEET-013` has existed for weeks. Table also omits `SHEET-019`/`SHEET-020` (Email_Ledger/Exclusions), which Depends On does list.
- Record `Depends On` lacks `GS-021` (StaleLeads — real calls `staleSinceOfRowGs_`/`splitStaleSectionsGs_`); INDEX row has it. Record `Used By` lacks `GS-022` (INDEX has it; GS-022 reads `ALL_ISSUES_LATE_CUTOFF_HOUR_/_MINUTE_`).
- Constants with no mention: `ALL_ISSUES_WINDOW_DAYS_BACK_` (the 3-calendar-day window size — operationally significant), `TEST_MODE_ROWS_FROM_/TO_/EXPECTED_`.
- `ensureAllIssuesLogSheetOnce_` mentioned in prose but no FN row (helper; acceptable).

### GS-002 Core.gs — MATERIALLY WRONG (one edge) + MINOR DRIFT
- **`Depends On: GS-004 (HEADER_ALIASES_ for buildColIndex_)` is false.** `HEADER_ALIASES_` is declared in `Core.gs:37` and read at `Core.gs:161`; Core.gs calls nothing in EmailInfra.gs (verified: zero cross-file function or constant references). Core has no `.gs` dependency at all. The reciprocal `GS-004 Used By: GS-002` is equally spurious — check A cannot catch it because both sides agree.
- Record `Used By` stops at GS-017; INDEX row also lists GS-018…GS-022.
- `CFG-071` anchor `#L321` → real `Core.gs:458-460`.
- `TAB_NAME_OVERRIDE = 'leads'` (`Core.gs:33`, the single place the leads tab name is set) and `OPPORTUNITY_STAGE_` (`:90`) are not mentioned anywhere in the record.

### GS-003 DailyRmIssueLog.gs — MATERIALLY WRONG (missing dependency + public functions)
- Trigger anchor `setupDailyRmIssueLog()` `#L771` → real `:1094`. Schedule (22:50 IST) correct.
- **Reads `RM_Hierarchy` directly** (`buildRmHierarchyRoleByNameLowerGs_`, `DailyRmIssueLog.gs:1255`, using `RM_HIERARCHY_SHEET_` from RmHierarchy.gs) but `## Sheets touched` has no `SHEET-006` row and Depends On has neither `SHEET-006` nor `GS-011`.
- Two editor-run entry points not mentioned anywhere: `backfillDailyRmIssuesFromMovementLogNow()` (`:816`), `backfillOneDayFromMovementLogNow(dayKey)` (`:944`). `captureDailyRmIssuesNow` only in prose.
- Constants never mentioned: `DAILY_RM_ISSUE_LOG_SHEET_`, `DAILY_RM_ISSUE_LOG_RETENTION_DAYS_` (CFG-036 describes it only as "retention / 7 days" without the name), `DAILY_RM_ISSUE_LOG_ROW_HEADROOM_`, `RM_PERF_SCORED_RULE_KEYS_GS_`, `RM_PERF_RULES_GS_`, `RM_PERF_NAME_ALIASES_GS_` — the last three are part of the `RM_PERF_*` cross-runtime pair that `RELATIONSHIP_MAP.md` §2 says must stay numerically identical, yet they have no `CFG-` row.

### GS-004 EmailInfra.gs — MATERIALLY WRONG
- **Self-contradiction:** `## Trigger schedule` says one hourly watchdog trigger installed by `setupEmailJobWatchdogTrigger()` (FN-334); the very next section, `## Requires setupXxx() re-run when`, says "Never — no `setupXxx()`, no schedule."
- **`CFG-037 HEADER_ALIASES_` is owned by the wrong record** — the constant is in `Core.gs:37` and is already `GS-002` CFG-066. Responsibilities also says `readLeadsTab_` "holds `HEADER_ALIASES_`". Two IDs for one constant, one of them pointing at the wrong file; `RELATIONSHIP_MAP.md` §2 and `HOW_TO_UPDATE_A_COMPONENT.md`'s pair table both route maintainers to the wrong one.
- Missing real dependencies (code calls verified): `GS-008` (`snapshotRunProblemsGs_`, `EmailInfra.gs:953`), `GS-010` (`notifyChLevelLeadsGs_`, `:1184`), `GS-001` (`ALL_ISSUES_RUN_HOUR_`, `:834`), `GS-018` (`OPS_AUDIT_SPECS_`, `:850`), `GS-022` (`emailRerouteApplyGs_`, `:710`). INDEX has GS-018/GS-022 but not GS-001/008/010; the record has none of the five.
- Record `Used By` lacks GS-012, GS-018, GS-019, GS-020, GS-022 (all in INDEX) and wrongly includes GS-002.
- `FN-333` anchors `#L679/#L708/#L736` → real `:919` / `:949` / `:1001` (`emailJobProblemsGs_`, `checkEmailJobsCompletedGs_`, `emailJobWatchdog`) — the watchdog's own anchors, invisible to check-staleness (4 names, 3 anchors → "unpairable").
- Purpose/Responsibilities predate Email Ops: no mention of the job lock/run records/watchdog schedule (`emailJobScheduleGs_`), the alert hold, the reroute hand-off; `EMAIL_ALERT_HOLD_`, `REGION_RECIPIENTS_SHEET_`, `emailJobRunKeyGs_`, `emailJobAlertedKeyGs_` unmentioned (the FN-391 row lists `EMAIL_ALERT_HOLD_JOBS_` in the Function column — a constant, not a function).

### GS-005 FollowupEngine.gs — ACCURATE (trivial drift)
- Relationships match INDEX; 31 `OUTCOME_RULES_GS_` rules and `#L147–#L401` range verified exact. `FOLLOWUP_MODIFIERS_GS_` and the `_signalWordsCacheGs_` cache not mentioned (minor). A RULE-row anchor `#L401` (record line 63) points at the closing bracket, not a declaration — harmless.

### GS-006 InteractionHistoryLogger.gs — ACCURATE
- All 6 functions covered, relationships match INDEX. Only `COMMENT_HISTORY_SHEET_`/`_COLUMNS_` names unmentioned.

### GS-007 LeadFollowupsStaleness.gs — ACCURATE
- Every function and constant covered; manual-setup-only description correct.

### GS-008 MovementTracker.gs — MINOR DRIFT (borderline material on Relationships)
- Trigger anchors `setupMovementTracking()` `#L1079` and `#L1108` → real `:1401` / `:1430`; schedule (`SNAPSHOT_HOURS_ = [0,6,12,18]`, `:93`) correct.
- `FN-222` anchors `#L372/#L451/#L470/#L483` → real `:379/:471/:490/:503` (unpairable row, so unchecked). `CONTENT_HASH_DATE_FIELDS_` `#L150` → `:164`. RULE/prose anchors `#L627`, `#L644`, `#L1153` dead.
- **Header `Last Verified` = `59db11b` (2026-10-10) but INDEX row says `58ab8e1` (2026-10-07).**
- Record `Depends On` lacks `SHEET-015` (Movement_Log_Runs — it is in this record's own Sheets touched table) and `Used By` lacks `GS-021` and `SHEET-015`; INDEX has all three.
- `ensureDailyCohortHistorySheetGs_` not mentioned; `ensureMovementLogRunsSheet_`, `_leadContentHashGs_` (now used by GS-021), `persistDailyCohortHistoryNow`, `removeEarlyCorruptedMovementLogDataNow` only in prose, no FN row. Sheet-name constants (`MOVEMENT_LOG_SHEET`, `SLA_HISTORY_SHEET_`, …, `STALE_MOVEMENT_LOG_BACKUP_TAB_`) unmentioned.

### GS-009 OpsChecklistRunner.gs — MINOR DRIFT
- Trigger anchor `setupWeeklyOpsChecklistTrigger()` `#L141` (record lines 43 and 170) → real `:300`. Monday 09:00 IST schedule correct.
- Relationships match INDEX. (OpsChecklist mentions `pruneDailyRmIssueLogNow`/`reportRmPerformanceNow` only inside alert strings — correctly not a dependency.)

### GS-010 OvernightEmailer.gs — MATERIALLY WRONG (anchors of the trigger entry points + relationships)
- **`FN-231` `sendOvernightMorningEmails()` / `_()` `#L871/#L883` → real `:951` / `:968`; `FN-232` `sendOvernightFollowupEmails()` / `_()` `#L1620/#L1632` → real `:1871` / `:1886`.** These are the two 10:00/13:00 trigger handlers; check-staleness skips them because `_()` is filtered out of the name list, leaving 1 name for 2 anchors.
- Trigger anchor `setupOvernightEmailer()` `#L1907` → real `:2285` (also `#L1222` in later prose). The "no `.inTimezone`" outlier statement is still true (`:2298-2299`).
- `FN-237` `formatFollowupAgeGs_` `#L1262` → real `:1416`; FN rows at record lines 142/147 (`#L516`, `#L496`) dead.
- Record `Depends On` lacks `GS-021` (StaleLeads) and `GS-022` (EmailReroute — real call `emailRerouteApplyGs_`); `Used By` lacks `GS-022`. INDEX has all three.
- `## Sheets touched` omits `SHEET-002` (Movement_Log via GS-008 maps) and `SHEET-019/020` (ledger) although Depends On lists them.
- `debugFollowupStatusNow()` (`:2404`, editor-run) not mentioned. `OVERNIGHT_START_HOUR_ = 17` / `OVERNIGHT_END_HOUR_ = 9` (`:103-104`, the definition of "overnight") not named anywhere — the record only says "the overnight window".

### GS-011 RmHierarchy.gs — MINOR DRIFT
- Trigger anchor `setupRmHierarchy()` `#L1190` → real `:1357` (no trigger — statement correct). CFG-056/CFG-093 anchors `#L1052/#L1053/#L1071` → real `:1064/:1065/:1083`; RULE rows at record lines 75-77 (`#L1052`, `#L1167`, `#L1056`, `#L1070`) dead; prose `#L663` → `:685`.
- Record `Used By` lacks `GS-022` (INDEX has it; EmailReroute calls into the hierarchy for "who is above").
- `rebuildRmHierarchyForce` only in prose; sheet-name constants unmentioned.
- CFG-093 quotes two real leadership names verbatim in a committed doc (they are also in source) — inconsistent with the "names/emails never in git" stance for the private file; flag for the owner, not a factual error.

### GS-012 SlaEngine.gs — MINOR DRIFT
- RULE-row anchors `#L209/#L212/#L305` and history-prose anchors `#L215`, `#L296/#L297` dead (real `computeAllIssuesCheckpointGs_ :241`, `filterAllIssuesCheckpoint2ForEmailGs_ :323`, `allIssuesCheckpointIsActiveGs_ :331`).
- `allIssuesCheckpointPriorLabel_`, `allIssuesCheckpointPriorWasActive_`, `allIssuesCheckpointIsActiveGs_` have no FN row (only RULE prose). `ISSUE_PRIORITY_GS_` (the issue tie-break order, a cross-runtime twin of `ISSUE_PRIORITY`) has no CFG row and is never named.
- Relationships match INDEX.

### GS-013 UnmatchedCommentLogger.gs — ACCURATE
- All 8 functions covered; relationships match INDEX.

### GS-014 RmHierarchySync.gs — MINOR DRIFT (coverage thin)
- Schedule (23:15 IST) and watchdog wiring correct. Relationships match INDEX.
- 12 of 33 functions unmentioned, including **`readHrRosterValuesGs_` (`:576` — the only read of the external HR roster spreadsheet)** and `rmHierarchySyncApplyEnabledGs_` (`:383`, the apply switch reader). 17 of 27 `RMSYNC_*` constants unmentioned (column map, role→field map, out-of-scope teams, noise tokens) — these encode the business rules of the sync.
- The external HR roster spreadsheet (`RMSYNC_HR_SHEET_ID_`, `:30`) is listed in Sheets touched only as "the HR roster sheet"; it has no `EXT-` or `SHEET-` record (see §5).

### GS-015 EmailLedger.gs — MINOR DRIFT
- Record `Depends On` lacks `GS-022` (real calls `emailRerouteTakeNoteGs_`/`emailRerouteClearNoteGs_`); record `Used By` lacks GS-018, GS-019, GS-020, GS-022, SHEET-021 (all in INDEX).
- Missing edge in both: `precreateEmailOpsTabsNow()` (`EmailLedger.gs:267-292`, FN-433) creates `Daily_Report`, `Daily_Checklist`, `Followup_Tracker`, `Email_Reroutes` using `GS-016/019/020/022` header constants (typeof-guarded) — `SHEET-022…025` not in Sheets touched, those GS edges not in Depends On.
- FN-387 and FN-389 are rows owned by GS-015 that describe code living in `AllIssuesEmailer.gs` / `OvernightEmailer.gs` (`sendAllIssuesEmails_`, `sendCombinedMorningEmail_`, …) — the FN-to-owner-file rule is broken (check P passes only because it searches names globally or tolerates this).
- Prose anchors `emailLedgerEnsureSheetGs_ #L235` etc. are fine; unmentioned: `emailLedgerCol_`, `emailLedgerLiveGs_`, `emailLedgerLoadRowGs_`, 11 constants (job-name constants, `EMAIL_LEDGER_STATUS_`, `DUPLICATE_LEAD_REASON_`, `EMAIL_INCIDENT_SEQ_`).

### GS-016 CycleReport.gs — MATERIALLY WRONG (relationships)
- **Record `Depends On` = GS-002, GS-004, GS-015 + SHEET-019..022.** Real code also calls `GS-019` (`dailyChecklistGs_`…), `GS-020` (`followupTrackerGs_`…), `GS-022` (`cycleReportRerouteRowsGs_` reads `Email_Reroutes`) and `GS-018` (`opsAuditReadRecordGs_`, `CycleReport.gs:299-300`). INDEX has 019/020/022/SHEET-025 but **neither record nor INDEX has GS-018**.
- Record `Used By` lacks GS-019/GS-020 (INDEX has them; they call `buildEmailCycleReportGs_`).
- `cycleReportRerouteRowsGs_` not mentioned; `SHEET-025` missing from Sheets touched. `cycleReportJobProblemsGs_`, `cycleReportAuditsGs_` (the GS-018 read) only in prose.
- No `#L` anchors at all in GS-016…GS-022 (a deliberate style change for the Email Ops records, but it means `check-staleness` A covers none of them).

### GS-017 EmailSweep.gs — MINOR DRIFT
- Four triggers (15:30 full sweep; 10:30/13:30/17:30 bounce-only) and watchdog deadlines verified exactly against `EMAIL_SWEEP_*` (`:35-42`) and `setupEmailSweepTrigger` (`:273-284`). Relationships match INDEX.
- `emailSweepBouncesOnlyRunGs_` (the shared body of the three bounce-only handlers), `emailSweepStampGs_`, `emailSweepOwnAddressGs_` and `EMAIL_SWEEP_BOUNCE_MAX_THREADS_` not mentioned.

### GS-018 OpsAudit.gs — MINOR DRIFT
- Triggers (11:15 / 14:00 / 18:00 IST from `OPS_AUDIT_SPECS_`, `:42-46`) and deadlines correct. Relationships match INDEX.
- `Used By` misses `GS-016` (CycleReport reads `opsAuditReadRecordGs_`) — the edge is absent on both sides.
- Editor entry points `auditMorningEmailsNow`, `auditFollowupEmailsNow`, `auditAllIssuesEmailsNow` (`:322-324`) unmentioned; also `opsAuditLabelGs_`, `opsAuditFindingLinesGs_`, `opsAuditTopSeverityGs_`, `OPS_AUDIT_SEVERITY_RANK_`.

### GS-019 DailyChecklist.gs — ACCURATE
- All 9 functions covered; relationships match INDEX (the `GS-004` edge is real via `TEST_MODE_OVERRIDE_EMAIL_`). `DAILY_CHECKLIST_TEXT_COLUMNS_` mentioned without a CFG row (trivial).

### GS-020 FollowupTracker.gs — ACCURATE
- All 8 functions covered; relationships match INDEX. `SHEET-019` in Depends On is through GS-015 (fine).

### GS-021 StaleLeads.gs — ACCURATE
- Every function/constant/rule verified line by line. (Two source comments are stale — `StaleLeads.gs:16` says `splitStaleSectionsGs_` lives in EmailInfra.gs and `:45` says `leadStaleStateGs_` lives in MovementTracker.gs; both are in StaleLeads.gs. A code-comment issue, reported here for the code auditors.)

### GS-022 EmailReroute.gs — MINOR DRIFT
- Relationships match INDEX; GS-001/GS-010 edges are real but constant-only (`*_LATE_CUTOFF_*`). Purpose verified (the swap happens in `sendGuardedEmailGs_` `EmailInfra.gs:710` and in OvernightEmailer's threaded reply).
- 7 of 27 functions and 7 of 12 constants unmentioned (`EMAIL_REROUTE_VIA_HIERARCHY_` / `_VIA_OPS_` encode the "next in hierarchy, else ops" decision D9; `emailRerouteResetCacheGs_`).

### Coverage of production files
All 22 production `.gs` files have a record (StaleLeads GS-021, EmailReroute GS-022, OpsAudit GS-018,
DailyChecklist GS-019, FollowupTracker GS-020, CycleReport GS-016, EmailSweep GS-017, EmailLedger GS-015,
RmHierarchySync GS-014). `RmHierarchy.private.gs` deliberately excluded (stated in INDEX and in GS-011 EXC-084).
**No file is MISSING.**

Summary: ACCURATE 7 (005, 006, 007, 013, 019, 020, 021) · MINOR DRIFT 10 (001, 008, 009, 011, 012, 014,
015, 017, 018, 022) · MATERIALLY WRONG 5 (002, 003, 004, 010, 016) · MISSING 0.

---

## 4. `INDEX.md` / `RELATIONSHIP_MAP.md` / guides / templates — problems

### INDEX.md
1. **Record files and INDEX rows disagree for 10 GS records** (GS-001, 002, 004, 008, 010, 011, 015, 016 — plus GS-008's Last Verified, 59db11b vs 58ab8e1). In every case INDEX was updated and the record's `## Relationships` was not. `RELATIONSHIP_MAP.md` §5 claims "69/69 records' Depends On / Used By == their INDEX.md row exactly" — no longer true, and no check enforces it.
2. **Missing real edges in INDEX itself** (A cannot see them): GS-004→GS-001, GS-004→GS-008, GS-004→GS-010, GS-016→GS-018, GS-003→GS-011 + SHEET-006, GS-015→GS-016/019/020 + SHEET-022…025 (pre-create). **Spurious edge:** GS-002→GS-004 / GS-004 Used By GS-002.
3. Stale narrative paragraphs:
   - "Seed note" (lines 148-155): "Every `Record Status` is `Not Started` — no record file exists yet."
   - Maintenance model (lines 56-85) "As of 2026-09-10": lists only A–E; says function-level `FN-` coverage is "Not yet built" — check P now does exactly that.
   - Coverage snapshot (line 358-362): "25 `JS-`, **14 `GS-` (+ `FN-001`..`263`), 17 `SHEET-`**, `BTN-001`..`023`" — reality 22 GS, FN up to 433, 25 SHEET, BTN up to 022 (a few lines above it correctly says 22/22 and 25/25).
   - SHEET coverage paragraph: operational-importance and retention tallies cover only SHEET-001…018 (Email Ops tabs 019-025 absent); "IMPORTANT x4" lists three names plus a stray fragment; says `Comment_History` is "append-only-by-design" and `Unmatched_Comments_Log` "manually-curated" while their own rows (and INDEX table) say 30-day retention since 2026-09-29; "10 TBD" in one place vs "7 TBD" in "Still open".
   - SHEET table heading still "partial seed"; seed correction says SHEET-016/017 are "both `Drafted`" while their rows say `Validated`.
4. `BTN-/UI-` section is the only sub-ID section; `FN-`, `CFG-`, `RULE-`, `EXC-` have no INDEX rows although `NAMING_CONVENTIONS.md` ("still gets its own stable ID and a row in INDEX.md") and `_templates/README.md` + `subtable-snippets.md` say they do.
5. `EXT-002` Used By lists GS-001/004/009/010 only; GS-014, 016, 017, 018, 022 also send or read Gmail (via GS-004 or directly — e.g. the sweep reads bounces, the reroute re-sends from a Gmail message). Consistent with the "summarised" caveat but no longer summarised consistently.

### RELATIONSHIP_MAP.md (dated 2026-09-10, `9cafa68`; never updated for Email Ops)
6. §2 cross-runtime table: "Row parsing / header aliases → `HEADER_ALIASES_` (`GS-004` CFG-037)" — wrong owner; it is `Core.gs` / `GS-002` CFG-066. Missing pair `ISSUE_PRIORITY` ↔ `ISSUE_PRIORITY_GS_`. The Loan-region row says "NO working twin"; still true for the emailers, but `GS-008` now has a partial port (`_effectiveRegionGs_`, `MovementTracker.gs:1057-1066`, cohort grouping only) that the row does not mention.
7. §3 hub table: GS-002 downstream lists GS-001…GS-013; GS-004 downstream lists 5 records — both omit GS-014…GS-022. The Email Ops subsystem (9 files, 7 sheets, 12 triggers) appears nowhere in the map.
8. §1 line anchors drifted: `core-fetch-and-render.js:566` → `:584`; `tab-movement.js:87` → `:102`; `sheets-writeback.js:275` → `:296`.
9. §5 "69 rows" / "69/69 … exactly" — INDEX now has 93 rows, and see item 1.

### NAMING_CONVENTIONS.md
10. `TRIGGER-` is described as an own-file record type; in practice none exist and INDEX says triggers are one un-ID'd index. The "sub-table IDs get an INDEX row" sentence is false for FN/CFG/RULE/EXC (item 4).

### HOW_TO_* / PRE_SHIP / templates
11. `HOW_TO_REGISTER_A_COMPONENT.md` worked examples hard-code stale "next IDs": next JS = JS-025 (taken), TAB-009 (taken by Opp Monitor), GS-014 (taken), SHEET-015 (taken), next FN after FN-254 (now 433), BTN-023. Step 8 still names `check-docs-coverage.js`; the three-registration step does not mention `check-gs-registration.py`, `check-runtime-parity.py`, or the deploy register in `STALENESS_TRACKER.md`.
12. `HOW_TO_UPDATE_A_COMPONENT.md` pair table repeats the wrong `GS-004 HEADER_ALIASES_ (CFG-037)` and lacks the send-safety-gate pair (`prepareGmailSend` ↔ `prepareOutgoingEmailGs_`, which RELATIONSHIP_MAP §2 has) and the `ISSUE_PRIORITY` pair. Requires a `docs/changes/` record per change; `docs/changes/` holds one file (`2026-09-10-build.md`) — the habit never took.
13. `HOW_TO_RETIRE_A_COMPONENT.md` "retirement-candidate scan" is dated 2026-09-10 with "24 js, 13 .gs, 14 SHEET"; `docs/TEAM_CLAUDE_HANDOVER.md` §18 now records real withdrawn/unused code, so "no real retirement candidate exists" is stale.
14. `PRE_SHIP_DOCUMENTATION_CHECKLIST.md` says "10 checkboxes" (it has 10 — fine) but its duplicated-pair list omits the send-safety gate and the issue-priority order; it does not mention the deploy register / live paste, nor that check A cannot detect a record↔INDEX mismatch.
15. `gs-module-template.md` gives no instruction on anchor format; the Email Ops records dropped anchors entirely while older records use `#La/#Lb` groups the checker cannot pair. `gs-modules/README.md` still says "13 production `*.gs` files … `FN-174`..`FN-254`".

---

## 5. Navigability — dead ends by entry point

| Entry point | Path today | Dead end? |
|---|---|---|
| **File name** | `whatis.py <file>` or grep INDEX → record | Works for all 22 `.gs`. |
| **Function name** | `whatis.py <fn>` → "No docs/INDEX.md row matches". Must `grep -r docs/gs-modules`. | **Yes.** No function index; 38 top-level production functions are not mentioned anywhere in their owner record (and ~25 more appear only in prose, with no FN row) (e.g. `backfillDailyRmIssuesFromMovementLogNow`, `readHrRosterValuesGs_`, `debugFollowupStatusNow`, `auditMorningEmailsNow`, `emailSweepBouncesOnlyRunGs_`). FN rows owned by the wrong record (GS-015 FN-387/389; GS-004 CFG-037) send a grep reader to the wrong file. |
| **Constant / config** | grep records | Partial dead end: many operational constants have no CFG row (`TAB_NAME_OVERRIDE`, `OVERNIGHT_START/END_HOUR_`, `ALL_ISSUES_WINDOW_DAYS_BACK_`, `ISSUE_PRIORITY_GS_`, most `RMSYNC_*`, `EMAIL_REROUTE_VIA_*`). `HEADER_ALIASES_` resolves to two IDs. |
| **Sheet tab** | `whatis.py <tab>` → SHEET record → Writers/Readers | Works. Gaps: SHEET-006 Readers lack GS-003; SHEET-022…025 lack GS-015 (pre-create); SHEET-025 readers lack GS-016 in the record (INDEX has it). |
| **Trigger** | `architecture/apps-script-triggers.md` | **Yes — lists 10 of the 19 live triggers** ("verified 2026-09-10; row 10 added 2026-10-05"): missing `syncRmHierarchyNightly` (23:15), `sendEmailCycleReport` (16:30), `sweepEmailBouncesAndReplies` + 3 `sweepBouncesAfter*` (10:30/13:30/15:30/17:30), `auditMorningEmails`/`auditFollowupEmails`/`auditAllIssuesEmails` (11:15/14:00/18:00). The handler names are reachable only by grepping GS-014/016/017/018. Not linked from INDEX's maintenance table either. |
| **Button** | INDEX BTN table → TAB record | Works (check M clean). Apps Script editor "buttons" (the `...Now()` functions people run by hand) have no index at all. |
| **External source** | EXT- records | **Dead end:** the HR roster spreadsheet read by `RmHierarchySync.gs` (`RMSYNC_HR_SHEET_ID_`) has no EXT-/SHEET- record; Drive archive (Core `archiveRowsToDriveCsv_`) is only a CFG note. Script Properties used as state (job run records, apply switch, reroute cache, alert hold) have no catalog home. |
| **Email Ops as a feature** | No FLOW- record; RELATIONSHIP_MAP silent | **Yes** — the only map is the separate `docs/EMAIL_OPS_OPERATING_MANUAL.md`, not linked from INDEX or RELATIONSHIP_MAP. |

---

## 6. Prioritised fixes (not made)

**P1 — would mislead a change**
1. GS-004: resolve the trigger/"never re-run" contradiction (name `setupEmailJobWatchdogTrigger()`); remove/retire `CFG-037` (or mark it a pointer to GS-002 CFG-066) and fix "readLeadsTab_ holds HEADER_ALIASES_"; add Depends On GS-001/008/010/018/022; drop GS-002 from Used By; sync Used By with INDEX.
2. GS-002 + INDEX: delete the false `GS-002 → GS-004` edge (both rows, both records).
3. Fix `RELATIONSHIP_MAP.md` §2 and `HOW_TO_UPDATE_A_COMPONENT.md` pair table (`HEADER_ALIASES_` → GS-002 CFG-066; add `ISSUE_PRIORITY`; add the send-gate pair to HOW_TO_UPDATE; note GS-008's partial Loan port).
4. GS-010: re-anchor FN-231/232 (`:951/:968`, `:1871/:1886`), `setupOvernightEmailer` (`:2285`), FN-237 (`:1416`); add GS-021/GS-022 to Depends On and GS-022 to Used By; add SHEET-002/019/020 to Sheets touched; add `debugFollowupStatusNow`, `OVERNIGHT_START/END_HOUR_`.
5. GS-016 (+INDEX): add GS-018 dependency (and GS-016 to GS-018 Used By); sync the record with INDEX (GS-019/020/022, SHEET-025); add `cycleReportRerouteRowsGs_` and SHEET-025 to Sheets touched.
6. GS-003 (+INDEX, SHEET-006): add the `RM_Hierarchy` read (SHEET-006, GS-011); add FN rows for the two backfill `...Now()` entry points; name the retention constant and the three unlisted `RM_PERF_*_GS_` constants as CFG rows (they are a must-match pair).
7. `architecture/apps-script-triggers.md`: add the 9 missing triggers (now 19) and link it from INDEX's maintenance table.

**P2 — consistency / trust in the checks**
8. Sync every record `## Relationships` with its INDEX row (GS-001, 002, 004, 008, 010, 011, 015, 016) and GS-008's Last Verified; then add a check-catalog check "record Relationships == INDEX row" so §5 of RELATIONSHIP_MAP becomes enforced rather than asserted.
9. Make `check-staleness.py` A cover prose anchors and RULE/EXC rows, and stop silently skipping "unpairable" rows (or require one anchor per name); then run `--fix-anchors` — about 45 dead anchors in GS records today (list in §3).
10. Add a code→record direction to check P: flag public (`...Now`, trigger handler, `setup...`) functions with no mention in their owner record.
11. GS-015: add Depends On GS-022 (+016/019/020 for pre-create) and SHEET-022…025; move FN-387/FN-389 to the records that own that code (GS-001/GS-010) or mark them cross-file wiring notes.
12. GS-001: replace "not yet a SHEET-XXX" with SHEET-013; add SHEET-019/020 rows; GS-021 dependency; `ALL_ISSUES_WINDOW_DAYS_BACK_`. GS-018: add the three `...Now()` entry points and GS-016 to Used By. GS-014: FN row for `readHrRosterValuesGs_`, CFG rows for the `RMSYNC_*` rule constants.
13. Rewrite the stale INDEX narrative (seed note, maintenance model, coverage snapshot counts, SHEET tallies for 019-025, "partial seed", Drafted/Validated contradiction), RELATIONSHIP_MAP header/§3/§5 (Email Ops hubs), `gs-modules/README.md`, and HOW_TO_REGISTER's hard-coded "next ID" examples (use placeholders), HOW_TO_RETIRE's dated scan.
14. Decide whether GS-011 CFG-093 should quote real leadership names in a committed doc.

**P3 — navigability**
15. Add a function→record lookup to `whatis.py` (grep FN/CFG cells across records) so the function entry point stops dead-ending.
16. Add an EXT- (or SHEET-) record for the HR roster spreadsheet; a short note on Script Properties used as state and the Drive archive.
17. Add a FLOW-003 overlay for the Email Ops cycle (10:00 → 10:30 → 11:15 → 13:00 → 13:30 → 14:00 → 15:30 → 16:30 → 17:00 → 17:30 → 18:00 → 23:15, watchdog hourly) and link `EMAIL_OPS_OPERATING_MANUAL.md` from INDEX.
18. Refresh the `(N lines)` Location counts or remove them (nothing checks them).
19. Close the two STALE watch-register items reported by check-staleness E (Movement_Log dedup health; `leads` header vs `HEADER_ALIASES`).
