# Google Sheet tab inventory (`DOC-010`)

**Produced:** 2026-09-10, against the codebase at commit `e281f9b`.
**Purpose:** the confirmed list of every Google Sheet tab the system
reads or writes + its writer(s)/reader(s), as the base for `SHEET-XXX`
records (`DOC-032`) and Phase 4's retention work (`DOC-036`).
(`DOCUMENTATION_PROJECT_PLAN.md` Phase 1, `DOC-010`.)

---

## One spreadsheet — confirmed from a real check

**All 14 tabs live in the single production spreadsheet**
`1QmYB1VqLMisiQXoed6-vSQqgA9nroGIMHsBInZafKGU` — the same id baked into
`dashboard.html`'s `#sheetIdInput` default.

Evidence (not assumed):
- `grep -rhoE "1[A-Za-z0-9_-]{40,}" js/ *.gs dashboard.html` → **exactly
  one** id literal (the one above). No second spreadsheet id anywhere.
- `grep -rnE "openById|SpreadsheetApp\.open" js/ *.gs` → **zero hits**.
- The **backend** always uses `SpreadsheetApp.getActiveSpreadsheet()`
  (the bound Sheet — same one) and addresses tabs by `getSheetByName(...)`.
- The **browser** uses `_currentSheetId` (`js/tab-movement.js`, defaults
  to the literal above; user-overridable via `#sheetIdInput` for
  pointing at a test copy) and addresses tabs by name in the API `range`
  (`TAB_NAME!A1:Z`).

There is **no** multi-spreadsheet split, and no tab lives in a second
workbook. (`DOC-010`'s follow-up — "flag any tab in a second
spreadsheet" — is N/A: there is no second spreadsheet.)

---

## The 14 tabs

| # | Tab | Written by | Read by | `SHEET-` ID |
|---|---|---|---|---|
| 1 | `leads` | **external CRM export** — no `JS-`/`GS-` writes it | `JS-009` (`sheetsApiValuesGet`) → `JS-003`; `GS-004` (`readLeadsTab_`) → every scheduled `GS-`; `GS-008` (`snapshotOpenLeads_`) | `SHEET-001` |
| 2 | `Movement_Log` | `GS-008` (`snapshotOpenLeads_`, 4×/day) **+** `JS-018` (`browserSnapshotOpenLeads`, on-demand) — **identical schema** (`LOGIC_AUDIT.md` Part 4 §4.7); pruned by `GS-008` `pruneMovementLog_` | `JS-021` (`fetchMovementLog` → `movementSnapshots`), `JS-008`, `JS-024`, `JS-023`, `JS-013`; `GS-008` (`buildMovementLogMapsGs_`) → `GS-001`/`GS-010`/`GS-003` | `SHEET-002` |
| 3 | `Daily_RM_Issues` | `GS-003` (`captureDailyRmIssues_`, 22:50 IST, chunked) + its backfill/repair utilities; pruned by `GS-003` `pruneDailyRmIssueLog_` (7d) | `JS-022` (Repeat Offenders tab) — **nothing reads it programmatically on the `.gs` side** (`reportRmPerformanceNow` reconstructs from `Movement_Log` instead) | `SHEET-003` |
| 4 | `Lead_Followups` | `JS-018` (`pushLeadsToFollowups` cols A–E,G,H; `clearLeadFollowupsTab`) **+** `GS-010` (`pushUnresolvedToLeadFollowups_`); **col F written only by a human** | `JS-018` / `JS-016` (`waitForAllFollowups`, poll col F); `GS-010` (`waitForFollowupSuggestions_`, poll col F); `GS-007` (conditional-format rules read col G) | `SHEET-004` |
| 5 | `SLA_History` | `GS-008` (`writeSlaHistorySnapshot_`, same 4×/day) **+** `JS-018` (`upsertSlaHistoryRows`, `backfillSlaHistoryFromMovementLog`); cleared by `JS-004` `clearSlaHistory` | `JS-024` (Tracking trend chart) | `SHEET-005` |
| 6 | `RM_Hierarchy` | `GS-011` (`rebuildRmHierarchy` from `RM_HIERARCHY_RAW_`); `excluded` col hand-toggled | `GS-011` (`resolveRmHierarchy_`) → routing for `GS-001`/`GS-010`; `JS-022` (`fetchRmHierarchyForRollup`) → display rollup + `JS-013`; `GS-009` (`auditUnresolvedRms_`) | `SHEET-006` |
| 7 | `Manager_Directory` | `GS-011` (`ensureManagerDirectorySheet_` header + derived rows); **`email` col hand-filled** when `RmHierarchy.private.gs` is absent | `GS-004` (`resolveRecipientEmailsForRegion_`); `GS-011` (`loadRmHierarchyAndEmails_`); `GS-009` (`auditManagerDirectoryEmailGaps_`) | `SHEET-007` |
| 8 | `Daily_Cohort_History` | `GS-008` (`persistDailyCohortHistoryGs_`, guarded) **+** `JS-018` (`upsertDailyCohortHistoryRows`, `backfillDailyCohortHistoryFromMovementLog`) — **identical schema** (`MovementTracker.gs` `#L559` comment); cleared by `JS-024`; **never re-writes an archived date** | `JS-024` (Daily Cohort by Region, Week-over-Week); `JS-018` (`fetchDailyCohortHistoryForDate`/`fetchAllDailyCohortHistoryRows` → `JS-024`) | `SHEET-008` |
| 9 | `Comment_History` | `GS-006` (`logInteractionHistoryGs_`, piggybacks on `snapshotOpenLeads_`) | **none in code** — direct sheet analysis only | `SHEET-009` |
| 10 | `Unmatched_Comments_Log` | `GS-013` (`scanUnmatchedCommentsGs_`, piggybacks on `snapshotOpenLeads_`); reviewed rows removed by `clearReviewedUnmatchedCommentsNow`; deduped by `dedupeUnmatchedCommentsNow` | **a human** (classifier-gap review) — the source for what to add to `OUTCOME_RULES`/`OUTCOME_RULES_GS_` | `SHEET-010` |
| 11 | `Send_Log` | `JS-018` (`logEmailSend`, fire-and-forget from `JS-015` + the `mailto:` path); `ensureSendLogSheet_` | **none in code** — manual audit surface | `SHEET-011` |
| 12 | `Region_Recipients` | `GS-004` (`ensureRegionRecipientsSheet_` header); `to`/`cc` **hand-filled** per region | `GS-004` (`loadRegionRecipients_`, `resolveRecipientEmailsForRegion_`) — the scheduled-email recipient fallback; `GS-011` (`resolveRecipientBucketsForRms_`, last-resort primary) | `SHEET-012` |
| 13 | `AllIssues_Log` | `GS-001` (`sendOneAllIssuesEmail_` per send; `ensureAllIssuesLogSheet_` with a self-healing header) | `GS-001` (`sendAllIssuesEmails_`, dedupe within a run) | `SHEET-013` |
| 14 | `Overnight_Log` | `GS-010` (`sendOneOvernightEmail_` per 10:00 send; `ensureOvernightLogSheet_`); `backfillTodaysOvernightLogRecipientsNow` repair | `GS-010` (`sendOvernightFollowupEmails_`, 13:00 — **functional**: needs `thread_id` + resolved `to`/`cc` for the threaded reply) | `SHEET-014` |

---

## Writer / reader summary

| Pattern | Tabs |
|---|---|
| **Written by both runtimes, identical schema** | `Movement_Log`, `SLA_History`, `Daily_Cohort_History`, `Lead_Followups` (browser + `GS-010`) |
| **Written by the backend only** | `Daily_RM_Issues`, `RM_Hierarchy`, `Manager_Directory`, `Comment_History`, `Unmatched_Comments_Log`, `Region_Recipients`, `AllIssues_Log`, `Overnight_Log` |
| **Written by the browser only** | `Send_Log` |
| **Not written by this project at all** | `leads` (external CRM export) |
| **Read by no code** (manual/analysis surfaces) | `Comment_History`, `Send_Log`; `Unmatched_Comments_Log` (human reviewer); `Daily_RM_Issues` (only `JS-022`, the browser tab) |
| **Configuration, rebuilt on demand** | `RM_Hierarchy`, `Manager_Directory`, `Region_Recipients` |

---

## Cross-check against `LOGIC_AUDIT.md`

`LOGIC_AUDIT.md` Part 1 §1's datastore list names all 14: `leads`,
`Movement_Log`, `SLA_History`, `Daily_Cohort_History`, `Lead_Followups`,
`Send_Log`, `Region_Recipients`, `RM_Hierarchy`, `Manager_Directory`,
`Unmatched_Comments_Log`, `Comment_History`, `Overnight_Log`,
`AllIssues_Log`, `Daily_RM_Issues`. **Every one appears above.** (The
`docs/INDEX.md` Phase 2 seed had `SHEET-009` mis-named
`Interaction_History`; corrected to `Comment_History` in `DOC-029` — the
real tab name per `InteractionHistoryLogger.gs` `ensureCommentHistorySheet_`.)

`HANDOVER.md` §5's table names only 8 of the 14 — the 6 it omits
(`Send_Log`, `Region_Recipients`, `AllIssues_Log`, `Overnight_Log`,
`Comment_History`, and `leads` is separate) are flagged in
`handover-coverage-map.md` (`DOC-002`) as a §5 gap.

---

## Definition of Done check

- **Every tab named anywhere in `LOGIC_AUDIT.md` appears** — ✅ (all 14
  from Part 1 §1).
- **The single-spreadsheet-vs-multiple-spreadsheets question is answered
  from a real check, not assumed** — ✅ (`grep` for id literals → one;
  `grep` for `openById` → zero; backend uses the bound sheet, browser
  uses one `_currentSheetId`). **One spreadsheet, 14 tabs.**
