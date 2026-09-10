# `HANDOVER.md` coverage map (`DOC-002`)

**Produced:** 2026-09-10, against `HANDOVER.md` at commit `e281f9b`
(last content update to `HANDOVER.md` itself: header dated 2026-09-09;
§9's subsection dates run 2026-09-01 … 2026-09-05).
**Purpose:** a section-by-section map of what `HANDOVER.md` already
documents, so Phase 3 reuses it instead of re-deriving, nothing gets
contradicted, and Phase 5 knows which claims to re-verify
(`DOCUMENTATION_PROJECT_PLAN.md` Phase 1, `DOC-002`).

> **Ordering note.** Phase 3 (`DOC-025`–`DOC-034`) was already worked
> before this task. The Phase 3 records were built partly from
> `HANDOVER.md` — each record's `## Handover relationship` field names
> the section it draws on and whether that section is current. This map
> is the consolidated view, and the ID column shows where the material
> landed.

**Legend for the "Verdict" column:**
- **Reuse as-is** — accurate and current; Phase 3 cited it directly.
- **Needs updating** — a claim that is now stale (a redesign shipped, a
  count moved, an "in progress" that is done). Not wrong when written;
  wrong now.
- **Needs verification (Phase 5)** — a specific claim not independently
  cross-checked by `LOGIC_AUDIT.md` that `DOC-039`/Phase 5 should test
  against current code.

---

## §1 — What this is

| Field | Value |
|---|---|
| **Components covered** | the two-halves architecture; `dashboard.html` + `js/*.js`; the `.gs` backend (names `Core.gs`, `SlaEngine.gs`, `FollowupEngine.gs`, `EmailInfra.gs`, `MovementTracker.gs`, `OvernightEmailer.gs`, `AllIssuesEmailer.gs`, `RmHierarchy.gs`, `RmHierarchy.private.gs`, `UnmatchedCommentLogger.gs`, `DailyRmIssueLog.gs`); the duplication principle (`OUTCOME_RULES` ↔ `OUTCOME_RULES_GS_` named as the example) |
| **Completeness** | High — the canonical statement of the architecture |
| **Verdict** | **Reuse as-is.** Cited by `DASH-001`, `DATA-001`. **Needs updating (minor):** the `.gs` list here omits `OpsChecklistRunner.gs` + `LeadFollowupsStaleness.gs` (both added 2026-09-09; §2/§4.3 do include them). |
| **Where it landed** | `DASH-001` `## Purpose`, `## What should / should not be changed` |

## §2 — Repository layout

| Field | Value |
|---|---|
| **Components covered** | **every file in the repo**, with a one-line role each: `dashboard.html`; the 9-file `js/core-*.js` group + its load order; `js/tab-audit.js`, `js/tab-tracking.js`, `js/tab-rmtimeline.js`, `js/tab-movement.js`, `js/tab-repeat-offenders.js`, `js/tab-morning.js`; `js/reports-build.js` / `-gmail.js` / `-ui.js`; `js/sheets-writeback.js`; `js/overview-distribution-people-ops.js`; `js/main.js`; all 13 production `.gs` (incl. `OpsChecklistRunner.gs`, `LeadFollowupsStaleness.gs`); `Tests_*.gs`; `working files on 28th…/`; `design/live-ops-redesign.html`. Plus the `<script src>` load-order list. |
| **Completeness** | High — this is the file-map spine |
| **Verdict** | **Needs updating.** (a) The `js/core-*.js` group is described as **"9 files"** and the load-order list ends at `main.js` — **`js/rm-performance-worker.js` (the 24th JS file) is not listed at all** (it loads as a `new Worker()`, not a `<script src>`, so it slipped the layout table). (b) Otherwise current as of 2026-09-09. |
| **Where it landed** | `DASH-001` `## HTML / CSS structure`; every `JS-XXX` / `GS-XXX` record's `## Load order / position`; `docs/_planning/file-inventory.md` (`DOC-001`) — which **does** call out the 24th file. |

## §3 — How the dashboard works (browser side)

| Field | Value |
|---|---|
| **Components covered** | the 5-step flow: sign-in gate (`js/core-auth.js`, `#authGate`, `GATE_SCOPE`), `#sheetIdInput` → `fetchAndRender()` (`HEADER_ALIASES`, `enrichLead()`, `applyFiltersAndRender`), `renderAll()` (in `overview-distribution-people-ops.js`), region email reports (`reports-*.js`, `GMAIL_SCOPE`), write-back paths (`js/sheets-writeback.js`). |
| **Completeness** | High for the pipeline shape |
| **Verdict** | **Reuse as-is.** Cited by `DATA-001`, `TAB-002`, `JS-003`, `JS-004`. |
| **Where it landed** | `DATA-001` `## Transformation`; `JS-003` / `JS-004` records. |

## §4 — Permissions & credentials

The section a new maintainer needs first. Four independent gates.

| Sub | Components covered | Verdict |
|---|---|---|
| **§4.1** Google Sheet access | the production Sheet id `1QmYB1VqLMisiQXoed6-vSQqgA9nroGIMHsBInZafKGU`; Editor vs Viewer; Extensions → Apps Script needs Editor | **Reuse as-is.** Cited by `EXT-001`, `SHEET-001`. |
| **§4.2** Google Cloud OAuth Client ID | the **one** Client ID `888792607049-4u0ok266girae40pt4o1m74uhn08rg19.apps.googleusercontent.com` (`DEFAULT_CLIENT_ID` in `js/reports-gmail.js`, `getGmailClientId()` fallback); two scopes / two `initTokenClient()` calls; Authorized JavaScript origins; OAuth consent screen / test-user list; `#gateClientIdInput` / `#gmailClientIdInput` override | **Reuse as-is.** Cited by `EXT-002`, `EXT-003`, `JS-001`, `JS-015`. **Needs verification (Phase 5):** "Verify the GitHub Pages source branch/folder under Settings → Pages — not re-verified in this document" (§4.4 repeats this). |
| **§4.3** Apps Script project | no CI/`clasp`/auto-deploy; `RmHierarchy.private.gs` out-of-band; first-run authorization dialog; **the one-time setup-function table** (`setupMovementTracking` / `setupOvernightEmailer` / `setupAllIssuesEmailTrigger` / `setupDailyRmIssueLog` / `setupWeeklyOpsChecklistTrigger` — with schedules); config constants `OPS_ALERT_EMAIL_`, `CH_LEVEL_EMAIL_`, `ALWAYS_CC_EMAILS_`, `TEST_MODE_OVERRIDE_EMAIL_`; console-only utilities `downloadNoIssueLeadsNow()`, `debugFollowupStatusNow()`, `debugDailyCohortEvidence()` | **Reuse as-is** for the setup table + constants — cited by every `GS-XXX` Trigger Schedule + `GS-004` CFG rows + `GS-009`. **Needs verification (Phase 5):** the setup table does **not** list `setupRmHierarchy()` as its own row (it's mentioned as a side-effect of `setupOvernightEmailer()`); `GS-011` documents it as a real, separately-runnable function. Confirm the table's completeness vs the actual `setup*()` set. |
| **§4.4** GitHub repo access | push access for `dashboard.html` / `js/*.js` and keeping the `.gs` copies in sync; GitHub Pages source not re-confirmed | **Reuse as-is.** |

## §5 — Data the Sheet holds

| Field | Value |
|---|---|
| **Components covered** | the `leads` tab (`TAB_NAME_OVERRIDE` in `Core.gs`) + a **writer/reader table** for: `Movement_Log`, `SLA_History`, `Lead_Followups`, `Daily_Cohort_History`, `Unmatched_Comments_Log`, `RM_Hierarchy`, `Manager_Directory`, `Daily_RM_Issues` (8 tabs) |
| **Completeness** | Partial — **8 of the 14 tabs.** Not listed here: `Send_Log`, `Region_Recipients`, `AllIssues_Log`, `Overnight_Log`, `Comment_History`, and `leads` is described separately. |
| **Verdict** | **Needs updating.** (a) 6 tabs missing from the table. (b) "`Movement_Log` … every 6h" — the cadence is **4×/day at fixed hours `[0,6,12,18]`**, which is every 6h but the fixed-hours framing matters (`GS-008` CFG-048). (c) The writer/reader columns are coarser than `SHEET-XXX`'s Writers/Readers tables. |
| **Where it landed** | `SHEET-001`–`SHEET-014` (`DOC-032`) — the full 14-tab set with exact column lists; `docs/INDEX.md` `SHEET-` section. |

## §6 — Logic duplicated across the two runtimes

| Field | Value |
|---|---|
| **Components covered** | the **4 canonical pairs**: `HEADER_ALIASES` ↔ `HEADER_ALIASES_`; `enrichLead()` ↔ `computeSlaFlags_`; `OUTCOME_RULES` / `inferOutcome` ↔ `OUTCOME_RULES_GS_` / `inferOutcomeGs_`; `FOLLOWUP_SUGGESTIONS` ↔ (`FollowupEngine.gs`). Plus the "edit both together" rule and the note that `.gs` headers still say `js/core.js`. |
| **Completeness** | Good for the *headline* pairs |
| **Verdict** | **Needs updating / needs verification (Phase 5).** The table names 4 pairs but `LOGIC_AUDIT.md` Part 4 + the Phase 3 records track **more**: `REGION_GROUP_MAP` ↔ `REGION_GROUP_MAP_` (§4.3), IST helpers (`Core.gs` §4.6), and the **RM-performance constants** `RM_PERF_*` ↔ `RM_PERF_*_GS_` (`JS-008` ↔ `GS-003`) — none of which appear in §6's table. Phase 5 should reconcile §6's list against `LOGIC_AUDIT.md` Part 4's full set and `docs/RELATIONSHIP_MAP.md` (`DOC-035`). |
| **Where it landed** | `JS-005`/`JS-006`/`JS-007`/`JS-009` and `GS-002`/`GS-005`/`GS-012`/`GS-004` `## Cross-runtime duplication` + `CFG-XXX` twin columns; `DATA-002`/`DATA-003` `## Known gaps`. |

## §7 — Testing

| Sub | Components covered | Verdict |
|---|---|---|
| **§7.1** Apps Script mock suite | `Tests_Mocks.gs` + one `Tests_<File>.gs` per production file + `Tests_RunAll.gs`; the `SpreadsheetApp`/`GmailApp`/`Utilities`/`ScriptApp` reassign-in-`finally` pattern; `runAllTests` / per-file `run<File>TestsNow()`; `TEST_EMAIL_PRIMARY_` / `TEST_EMAIL_CH_` | **Reuse as-is.** Cited by every `GS-XXX` `## Validation`. **Needs updating (minor):** doesn't mention the **Node CI harness** (`test/run-gs-tests.js`, `.github/workflows/test.yml`) that now runs this same suite on every push — CI **does** exist for the test suite (just not for `.gs` deploy). |
| **§7.2** Dashboard JS testing | "no permanent suite exists today"; the ad-hoc serve-and-console approach; recommends building `test/dashboard.test.html` | **Needs updating.** `tests/frontend-harness.html` **now exists** (grafts the real `dashboard.html` + `js/*.js`, mocks the Sheets read + OAuth token pair, runs synthetic leads through the real `fetchAndRender()`). Every Phase 3 `JS-XXX` record cites it as the validation method. §7.2's "not built yet" is stale. |

## §8 — Where to look when something breaks

| Field | Value |
|---|---|
| **Components covered** | 8 reactive incident bullets: DevTools console for dashboard data/write-back; Apps Script Executions for emails; `RM_Hierarchy`/`Manager_Directory`/`RmHierarchy.private.gs` for routing; `Unmatched_Comments_Log` for wrong follow-ups; the **`Unmatched_Comments_Log` duplicate-rows bug** (fixed 2026-09-03, `scanUnmatchedCommentsGs_`, `dedupeUnmatchedCommentsNow()`); the **`captureDailyRmIssues` ~475s/zero-rows incident** (2026-09-01); the **`sendAllIssuesEmails` ~50-min slow send** (`withSendRetry_` "Not found" backoff, fixed to flat 400ms); **lead 2229674 / `Lead_Followups` staleness** (2026-09-09, + the `isOppOrAbove` closing-reason fallback fix); pointers to `OPS_CHECKLIST.md` + `LEAD_FOLLOWUPS_STALENESS.md`. |
| **Completeness** | High — this is the incident-history record `CLAUDE.md` points at |
| **Verdict** | **Reuse as-is.** Cited by `SHEET-002`/`SHEET-003`/`SHEET-004`/`SHEET-010`, `GS-001`/`GS-003`/`GS-008`/`GS-013`, `EXT-002` `## Exceptions`. This is exactly the kind of content `DOCUMENTATION_PROJECT_PLAN.md` says **not** to migrate into `docs/` — the records **link** to §8, they don't copy it. |

## §9 — Repeat Offenders (the Daily_RM_Issues subsystem)

The single largest section (686 lines, §9.1–§9.7.2). "Newest, least
battle-tested part."

| Sub | Components covered | Verdict |
|---|---|---|
| **§9.1** What it is and why | `DailyRmIssueLog.gs` `captureDailyRmIssues` (22:50 IST, unscoped); `Daily_RM_Issues`; `js/tab-repeat-offenders.js` ranking by **Avg Flagged** (instances ÷ distinct leads) | **Needs updating.** "Avg Flagged" ranking is the **pre-redesign** model — §9.7 (below) describes replacing it, and the replacement (`computeRmPerformance`'s empirical-Bayes composite score) has **shipped**. §9.1's opening framing is stale. |
| **§9.2** Scale/reliability gotcha | ~26,660 rows/night; the 2026-09-01 ~475s/zero-rows incident; the chunked-write fix (`BACKFILL_CHUNK_SIZE_ = 5000`, `Tests_DailyRmIssueLog.gs`); the **2026-09-06 10M-cell-ceiling crash** + `pruneDailyRmIssueLog_()` at **7-day** retention (`DAILY_RM_ISSUE_LOG_RETENTION_DAYS_`), prune-**before**-write | **Reuse as-is.** Cited by `GS-003` EXC-060/061, `SHEET-003` `## Data Lifecycle` (this is where the confirmed 7-day retention comes from). |
| **§9.3** Console utilities | `captureDailyRmIssuesNow()`, `backfillDailyRmIssuesFromMovementLogNow()`, `backfillOneDayFromMovementLogNow(dayKey?)`, `repairDailyRmIssuesMissingFieldsNow()`, `reportRepeatOffenderRmsNow()` | **Needs verification (Phase 5).** `reportRepeatOffenderRmsNow()` — the Phase 3 grep of `DailyRmIssueLog.gs` found **`reportRmPerformanceNow()`** (the post-redesign name), not `reportRepeatOffenderRmsNow()`. Confirm whether §9.3's name is stale or the function was renamed/kept as an alias. The other 4 names verified present in `GS-003`. |
| **§9.3.1** "Total Leads" column (2026-09-03) | `totalLeadsByKey()` (`js/tab-repeat-offenders.js`); cross-references `movementSnapshots` not `Daily_RM_Issues`; "Flagged Leads" vs "Total Leads"; mentions `aggregateRepeatOffenders` | **Needs verification (Phase 5).** `aggregateRepeatOffenders` / `totalLeadsByKey` — the Phase 3 grep found `aggregateRmPerformance` (in `js/core-rm-performance.js`) and the tab's own helpers, **not** these names. Likely renamed in the §9.7 redesign. Phase 5 to confirm the current function set for the "Total Leads" column and update §9.3.1. |
| **§9.4** Time-range filter date-basis split | a documented gotcha in `js/tab-repeat-offenders.js` — the Time-range filter's assigned-date vs captured-date basis; "read before touching this file" | **Reuse as-is** (as a *pointer*). Cited by `TAB-004` `## Related documentation`, `JS-022` Handover relationship. The specific mechanism should be re-read against the current file by anyone touching it (the file grew 383L → 717L this session). |
| **§9.5** `isNotUpdated`'s 48h gate fix (2026-09-03) | the change to not gate `isNotUpdated` on `isUnder48h`, on **both** runtimes | **Reuse as-is.** Cited by `JS-006` RULE-007 / `GS-012` RULE-034. |
| **§9.6** `OUTCOME_RULES` keyword mining (2026-09-03) | using `Unmatched_Comments_Log` to grow `OUTCOME_RULES` / `OUTCOME_RULES_GS_` | **Reuse as-is.** Cited by `DATA-003` `## Transformation`, `GS-013`. |
| **§9.7** RM Performance redesign — "replacing Avg Flagged (**in progress, 2026-09-04**)" (+ §9.7.1 "Below Expectations only" filter 2026-09-04, §9.7.2 root-cause investigation 2026-09-05) | the empirical-Bayes shrinkage composite score design; `RM_PERF_*` constants; `computeRmPerformance` / `classifyRmPerformance`; the `js/rm-performance-worker.js` off-thread move; the `.gs` mirror in `DailyRmIssueLog.gs` | **Needs updating — highest priority.** The section is explicitly titled **"in progress, 2026-09-04"** and dated; the redesign has **shipped and iterated further** (this session added `rmPerfCanonicalRmName` aliases, broadened `RM_PERF_NON_RM_ROLES` leadership exclusion `7ef26db`, and `computeRmPerformanceByRegion` per-region worst-5 `812a3cb` — none of which §9.7 mentions). `js/core-rm-performance.js` grew 485L → 869L, `js/tab-repeat-offenders.js` 383L → 717L, `DailyRmIssueLog.gs` 980L → 1127L since §9.7 was written. Phase 5 should rewrite §9.7 to describe the **shipped** state, or shrink it to a pointer at `TAB-004` / `JS-008` / `GS-003` / `DATA-002`. |

---

## Every component name mentioned in `HANDOVER.md` — captured for cross-check

**Files:** `dashboard.html`; all 24 `js/*.js` (§2 lists 23 + the missing worker); all 13 production `.gs`; `RmHierarchy.private.gs` (absent); `Tests_*.gs`; `working files on 28th…/`; `design/live-ops-redesign.html`; `CLAUDE.md`, `LOGIC_AUDIT.md`, `OPS_CHECKLIST.md`, `LEAD_FOLLOWUPS_STALENESS.md`; `test/dashboard.test.html` (recommended, → became `tests/frontend-harness.html`).

**Sheet tabs:** `leads`, `Movement_Log`, `SLA_History`, `Lead_Followups`, `Daily_Cohort_History`, `Unmatched_Comments_Log`, `RM_Hierarchy`, `Manager_Directory`, `Daily_RM_Issues`. *(Not named in `HANDOVER.md`: `Send_Log`, `Region_Recipients`, `AllIssues_Log`, `Overnight_Log`, `Comment_History` — a coverage gap `SHEET-011`–`014` + `SHEET-009` fill.)*

**Functions / constructs:** `fetchAndRender()`, `enrichLead()`, `applyFiltersAndRender`, `renderAll()`, `HEADER_ALIASES` / `HEADER_ALIASES_`, `OUTCOME_RULES` / `inferOutcome` / `OUTCOME_RULES_GS_` / `inferOutcomeGs_`, `FOLLOWUP_SUGGESTIONS`, `computeSlaFlags_`, `TAB_NAME_OVERRIDE`, `GATE_SCOPE` / `GMAIL_SCOPE`, `DEFAULT_CLIENT_ID` / `getGmailClientId()`, `setupMovementTracking` / `setupOvernightEmailer` / `setupAllIssuesEmailTrigger` / `setupDailyRmIssueLog` / `setupWeeklyOpsChecklistTrigger` / `setupRmHierarchy`, `snapshotPeriodic`, `sendOvernightMorningEmails` / `sendOvernightFollowupEmails` / `sendAllIssuesEmails`, `captureDailyRmIssues` / `captureDailyRmIssues_`, `runWeeklyOpsChecklistNow`, `OPS_ALERT_EMAIL_` / `CH_LEVEL_EMAIL_` / `ALWAYS_CC_EMAILS_` / `TEST_MODE_OVERRIDE_EMAIL_`, `SNAPSHOT_HOURS_`, `ALL_ISSUES_RUN_HOUR_`, `notifyOpsAlertGs_`, `withSendRetry_`, `resolveRecipientEmailsForRegion_`, `downloadNoIssueLeadsNow()` / `debugFollowupStatusNow()` / `debugDailyCohortEvidence()`, `clearSlaHistory()` / `backfillSlaHistoryFromMovementLog()`, `scanUnmatchedCommentsGs_` / `dedupeUnmatchedCommentsNow()`, `snapshotOpenLeads_`, `pruneMovementLog_` / `pruneMovementLogNow()` / `MOVEMENT_LOG_RETENTION_DAYS`, `pruneDailyRmIssueLog_()` / `pruneDailyRmIssueLogNow()` / `DAILY_RM_ISSUE_LOG_RETENTION_DAYS_` / `BACKFILL_CHUNK_SIZE_`, `captureDailyRmIssuesNow()` / `backfillDailyRmIssuesFromMovementLogNow()` / `backfillOneDayFromMovementLogNow()` / `repairDailyRmIssuesMissingFieldsNow()` / `reportRepeatOffenderRmsNow()`, `totalLeadsByKey()` / `aggregateRepeatOffenders` / `passesRepeatOffenderFilters` / `movementSnapshots`, `isOppOrAbove` / `isBookingLead`, `RM_PERF_*`, `runAllTests` / `run<File>TestsNow()`, `TEST_EMAIL_PRIMARY_` / `TEST_EMAIL_CH_`.

All of the above are covered by a Phase 3 record's `FN-XXX` / `CFG-XXX`
sub-table or named in `docs/_planning/function-inventory.md`, **except**
the redesign-renamed names flagged for Phase 5 verification:
`reportRepeatOffenderRmsNow()`, `aggregateRepeatOffenders`,
`totalLeadsByKey()` (§9.3 / §9.3.1).

---

## Consolidated `HANDOVER.md` verification list

Most items closed 2026-09-10 (`t-tf-7e4d0dffdf6c`, `t-tf-5ad22d8e4c2e`).

1. ~~**§9.7**~~ — **DONE** (`t-tf-5ad22d8e4c2e` P3): title +
   **Status: shipped and live** banner pointing at the catalog records;
   the §9.7.1/§9.7.2 sub-notes are dated design-record, kept.
2. ~~**§9.1**~~ — **DONE**: rewritten to the composite RM-performance
   score (shrinkage `K=8`, 4 independent RM/Region/A1-TM/RH computations,
   `Movement_Log`-reconstructed eligible book). "Avg Flagged" gone from
   the prose.
3. ~~**§9.3 / §9.3.1**~~ — **DONE**: §9.3 `reportRmPerformanceNow()`;
   §9.3.1 rewritten (retitled; describes the current single "Unique
   Leads" column; `aggregateRepeatOffenders` / `totalLeadsByKey` called
   out as removed; the still-valid lessons kept). §9.4/§9.5/§9.6 re-read
   against current source — **accurate, unchanged**.
4. ~~**§2**~~ — **DONE** (`t-tf-7e4d0dffdf6c`): `rm-performance-worker.js`
   + the full 23-tag load order + the `new Worker()` note.
5. ~~**§5**~~ — **DONE** (`t-tf-5ad22d8e4c2e` P3): `Comment_History` /
   `Send_Log` / `Region_Recipients` / `AllIssues_Log` / `Overnight_Log`
   added to the §5 tab table (each with writer/reader); the
   `Movement_Log` cadence was already fixed (`t-tf-7e4d0dffdf6c`). §5
   now points at `docs/sheets/SHEET-001..014` for full detail.
6. ~~**§6**~~ — **DONE** (`t-tf-5ad22d8e4c2e` P3): §6's table now carries
   all 10 pairs (`CONFIG` ↔ `Core.gs`/`SlaEngine.gs`, `REGION_GROUP_MAP`
   ↔ `_`, `FOLLOWUP_SUGGESTIONS` ↔ `_GS_`, `RM_PERF_*` ↔ `_GS_`, IST
   helpers, `TEST_MODE_OVERRIDE_EMAIL` ↔ `_`, + the **HIGH** Loan-region
   "no working twin" finding) and points at `RELATIONSHIP_MAP.md` §2 for
   the `CFG-`/`RULE-` sub-IDs.
7. ~~**§7.1 / §7.2**~~ — **DONE** (`t-tf-7e4d0dffdf6c` + P2): §7.1 Node CI
   harness; §7.2 now "in CI headless (non-blocking)".
8. ~~**§1**~~ — **DONE** (`t-tf-7e4d0dffdf6c`): `OpsChecklistRunner.gs` +
   `LeadFollowupsStaleness.gs`, "13 production `.gs` files".
9. ~~**§2 / §4.4**~~ — **DONE** (`t-tf-5ad22d8e4c2e` P3): GitHub Pages
   source **confirmed** — "Deploy from a branch", `master` / `/` (root),
   no `index.html`, entry URL `…/leads-dashboard/dashboard.html`.
   Evidence: the `pages-build-deployment` (`dynamic/pages/…`) workflow on
   `master` + live 200s for root/`js/`/`docs/` paths.
10. **§4.3** — ⚠ open: confirm the one-time-setup table vs the actual
    `setup*()` set (`setupRmHierarchy()` has no own row).
    `architecture/apps-script-triggers.md` (P2) is the verified trigger
    index — §4.3's setup table could point at it. (Low priority — the
    trigger index already carries the authoritative version.)

> These are **not** blockers on the Phase 3 records — every record's
> `## Handover relationship` already states whether its section is
> current. This list is the input to Phase 5's `HANDOVER.md`
> reconciliation and to the eventual `CONSOLIDATED` handoff of the
> living-architecture role from `HANDOVER.md` §1–§3 to `docs/`.

---

## Definition of Done check

- **Every one of `HANDOVER.md`'s 9 sections has an entry** — ✅ (§1–§9
  above; §4 and §7 and §9 broken to their subsections).
- **Every component name mentioned in `HANDOVER.md` captured for
  cross-checking** — ✅ (the "Every component name mentioned" section;
  all resolve to a Phase 3 record or `function-inventory.md`, with the
  3 redesign-renamed names explicitly flagged).
- **Claims Phase 5 should re-verify are flagged** — ✅ (per-section
  "Verdict" + the consolidated 10-item Phase 5 list).
