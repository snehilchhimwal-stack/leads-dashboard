# N - Top-level operating documentation vs code (audit 2026-10-10, HEAD 19038e7)

Scope: `HANDOVER.md`, `CLAUDE.md`, `OPS_CHECKLIST.md`, `LEAD_FOLLOWUPS_STALENESS.md`, `docs/TEAM_CLAUDE_HANDOVER.md`,
`docs/EMAIL_OPS_OPERATING_MANUAL.md`, `docs/STALENESS_TRACKER.md`. Root-level `*.md` in git: `CLAUDE.md`, `HANDOVER.md`,
`OPS_CHECKLIST.md`, `LEAD_FOLLOWUPS_STALENESS.md` (+ the excluded `LOGIC_AUDIT.md`, `DOCUMENTATION_PROJECT_PLAN.md`), so no
extra root file was in scope. `docs/architecture/apps-script-triggers.md` was read only where a reviewed doc points at it.

Method: every checkable claim (function names, constants and values, trigger times, counts, load order, sheet tabs, cutoffs,
retention, thresholds, recovery steps) was grepped against the production `.gs`/`js` sources. Read-only checks run:
`check-staleness.py` (STALE 2, AT-RISK 4, 0 drifted anchors, all 22 deploy-register rows OK), `check-gs-registration.py`
(Clean: 22 production + 25 test files, 23 suites), `check-runtime-parity.py` (1 mismatch: the 2 known browser-only
`HEADER_ALIASES` keys). Nothing was edited, committed or run live.

Severity: **HIGH** = following the doc would do the wrong thing in operation or leave a deploy incomplete; **MED** = a wrong
fact a maintainer is likely to act on; **LOW** = stale wording, history, cosmetic.

Overall: the function inventory is strong. Every one of about 160 function names cited across the seven documents exists in
the file the doc names, and every Email Ops constant checked matches the code (cutoffs 18:30/12:45/16:00, 90-day ledger
retention, 14-day reroute, 6 hops, 3 h re-send, 45-minute held-alert release, 3 h/5 h freshness, 45,000-character JSON
cap, 30 s lock wait, +30/35 min watchdog, 840 s snapshot budget, sync columns 1/2/6/8/10/12/15/17/35, at least 250 people,
at most 25 changes). The errors are concentrated in **counts and file lists frozen before the Email Ops build**, **"not yet
deployed" text that was never retired**, and **tab/reader tables that miss the 2026-10-09/10 additions**.

---

## 1. What each document is for and who reads it

| Document | Purpose | Reader | Authority claimed |
|---|---|---|---|
| `CLAUDE.md` | Short orientation plus the gotchas that cost time; auto-loaded into every Claude Code session | Every Claude session, first | Points to HANDOVER for depth |
| `HANDOVER.md` | Narrative architecture (§1-3), credentials (§4), deploy and setup (§4.3.x), tabs (§5), runtime pairs (§6), testing (§7), incidents (§8), RM Performance (§9) | A new human or Claude maintainer; incident triage | Says §1-3 are "the living architecture description" |
| `OPS_CHECKLIST.md` | Pre-change, post-deploy and periodic checks for email, routing and worst-RM logic; the human side of the Monday email | Whoever runs routine ops; the weekly email points here | Living checklist |
| `LEAD_FOLLOWUPS_STALENESS.md` | Map of every `Lead_Followups` consumer, its staleness tolerance, and the LEADFOLLOWUPS-00x decisions | Anyone touching `Lead_Followups` readers or writers | Mandated by CLAUDE.md |
| `docs/TEAM_CLAUDE_HANDOVER.md` | Hand-over to a team Claude account: working agreements, safety rules, trigger clock, Email Ops, unused-code inventory, decisions, incidents | The incoming team Claude, first | Ranks itself last (code > docs/ > HANDOVER > LOGIC_AUDIT > this) |
| `docs/EMAIL_OPS_OPERATING_MANUAL.md` | Day-to-day operation of the Email Ops system: decisions D1-D9, 19-phase table, flags, checklist A-K, fault matrix, report template, first actions | Snehil (the ops reader) and any operator of the 16:30 report | Operational |
| `docs/STALENESS_TRACKER.md` | Watch register, the Apps Script deploy register, the live-hash read procedure, the sweep log | Whoever runs `[Stale Sweep]` or a deploy | Source of truth for "what is live" |

---

## 2. Mismatches per document

### 2.1 `HANDOVER.md`

| Location | Claim | Reality (file:line) | Sev |
|---|---|---|---|
| L21 header | "updated 2026-10-09 (§4.3.5 ...)" | The file holds 2026-10-10 content: the `EmailReroute.gs` row at L121, D8/D9 at L865/L875, and the 17:04 incident at L1164. It was last changed in `000c1e6` (2026-10-10) | LOW |
| L33-35 | `docs/RELATIONSHIP_MAP.md` is a future artifact ("until ... exist to take that job over") | `docs/RELATIONSHIP_MAP.md` exists (produced 2026-09-10, `9cafa68`), and §6 L971 already cites it | LOW |
| §1 L58-63 | Backend = the 13 named files, "13 production `.gs` files" | 22 production files plus the private table on disk (`check-gs-registration.py`: 22 production). Missing from the list: `RmHierarchySync`, `InteractionHistoryLogger`, `EmailLedger`, `CycleReport`, `EmailSweep`, `EmailReroute`, `OpsAudit`, `DailyChecklist`, `FollowupTracker`, `StaleLeads` (the private file is counted in the 13). §2's own table (L108-130) is complete, so §1 contradicts §2 | MED |
| §1 L66 | Backend exists for "snapshotting 4x/day and sending automatic emails" | It now also runs audits, sweeps, the 16:30 report, the nightly sync and the watchdog (19 triggers) | LOW |
| §2 L102 (`js/tab-repeat-offenders.js` row) | "reads the `Daily_RM_Issues` sheet tab that `DailyRmIssueLog.gs` populates nightly" | No `js/*.js` reads `Daily_RM_Issues`. The fetch was removed 2026-09-04/05 (`js/core-fetch-and-render.js:635-638` comment; HANDOVER's own §9.7.2 L2048-2062) | MED |
| §2 L128 (`DailyRmIssueLog.gs` row) | "feeds `js/tab-repeat-offenders.js`" | Same as above. Nothing reads the tab (TEAM §18.2) | MED |
| §2 L117 | Sync "See §4.3.4" | Two sections are numbered §4.3.4 (L511 email audit, L785 nightly sync), so the link is ambiguous | LOW |
| §4.3 setup table L298-311 | Lists the one-time setup functions | Missing `precreateEmailOpsTabsNow()` (`EmailLedger.gs`), the one-time step whose absence caused the 2026-10-10 17:04 crash. It is only mentioned inside a §8 bullet (L1164). Also missing `setupRmHierarchy`'s companion `enableRmHierarchySyncApplyNow()` as a "switch-on" step (§4.3.4 has it) | HIGH |
| §4.3 L313-314 | "The **full, source-verified trigger set** is `docs/architecture/apps-script-triggers.md`" | That file lists 10 triggers (snapshot x4, 22:50, 10:00, 13:00, 17:00, Monday, watchdog). It has none of the 9 added since 2026-10-08 (sync, 4 sweeps, 3 audits, 16:30 report); 19 are live (TEAM §8, tracker 17:27 entry). TEAM §0 correctly calls it "out of date" | MED |
| §4.3 L375 | "Which `.gs` files are actually live (2026-09-25)" | The content defers to the tracker, which is current (2026-10-10). Only the heading date is stale | LOW |
| §4.3.4 L511 / L785 | Two different sections numbered 4.3.4 | Duplicate numbering. §4.3.5 follows the second | LOW |
| §4.3.4 L606-608 (P10) | A CH-level report covers "a Cluster/Commercial Head or leader personally holding leads, **or an RM whose chain resolves all the way up to one**" | The code is narrower: only an RM at leadership/CH/City-Lead level holding leads with nobody below (`chLevelRms` in `resolveRecipientBucketsForRms_`, `RmHierarchy.gs`; change `b4555a8`). TEAM §9.1 item 3 already flags this drift | MED |
| §4.3.4 L750-783 | Bullets run P1-P6, P9-P18, then P7, P8 | Out of order: P7/P8 come after P18. Easy to miss when scanning | LOW |
| §4.3.5 L822 | "What exists so far is **EO-1a** ... and **EO-1b**" | EO-1 through EO-13 are all built and deployed (manual §13; tracker 2026-10-10) | MED |
| §4.3.5 L857 | The cycle report "cannot yet show bounces, replies or the age of the Leads tab, and says so" | It shows all three now: the "Bounces and replies" section (L872) and Leads-tab freshness (L860-863, `LEADS_FRESH_*_HOURS_` in `EmailInfra.gs:1036-1037`) | MED |
| §4.3.5 L849, L898 | "`Incident_Log` is created on the first alert after the paste"; "Both tabs create themselves on the first run after the paste" | This is exactly the in-job tab creation that crashed the 2026-10-10 17:00 run. §8 L1164 and `precreateEmailOpsTabsNow()` (`EmailLedger.gs`) are the fix. The two passages contradict the §8 lesson | HIGH |
| §4.3.5 L902-903 "Not live until pasted" | Lists the files still to paste and says "what remains is deployment" | (a) Everything was deployed 2026-10-10 17:27: all 47 non-private files match HEAD (`STALENESS_TRACKER.md` L286; `check-staleness.py` D all OK). (b) The list itself is incomplete: it omits `EmailReroute.gs`, `Tests_EmailReroute.gs`, `Tests_MovementTracker.gs` (all in the real 24-file deploy, tracker L282) and the `precreateEmailOpsTabsNow()` step. It also names `EmailLedger.gs`, `CycleReport.gs` and `EmailInfra.gs` twice | HIGH |
| §5 table L923-937 | The tabs the system reads and writes | Missing: `Email_Ledger`, `Email_Ledger_Exclusions`, `Incident_Log`, `Daily_Report`, `Daily_Checklist`, `Followup_Tracker`, `Email_Reroutes` (all Email Ops), plus `Movement_Log_Runs` and `Opp_Monitor_Period`/`Opp_Monitor_Month` (read by `js/tab-oppmonitor.js`). TEAM §6.4 has the complete list | HIGH |
| §5 L928 | `Daily_Cohort_History` written by `js/sheets-writeback.js` | Also written automatically by `MovementTracker.gs:733` (`persistDailyCohortHistoryGs_`, the "Daily_Cohort_History persist" snapshot phase). TEAM §6.4 is correct | MED |
| §5 L932 | `Daily_RM_Issues` read by `js/tab-repeat-offenders.js` | No reader (see §2 rows above) | MED |
| §5 L936 | `AllIssues_Log` read by "`AllIssuesEmailer.gs` itself (within-run dedup) - a send-audit trail" | Also read by `OvernightEmailer.gs` (Checkpoint 1/2 source: `issue_snapshot_json`, checkpoint columns), `OpsAudit.gs`, `FollowupTracker.gs`, `DailyChecklist.gs` and the recoveries. It is a live input, not just an audit trail | MED |
| §5 L937 | `Overnight_Log` "older rows are dead weight" | Read by the 13:00 job, the 13:00 recovery (`followup_sent_at` guard), `OpsAudit.gs` (`ACCEPTED_WITHOUT_LOG`/`FOLLOWUP_GAP`) and `DailyChecklist.gs` | LOW |
| §5 L940 | Per-tab detail "in `docs/sheets/SHEET-001`..`SHEET-018`" | Records run to `SHEET-025` (`docs/sheets/SHEET-025-email-reroutes.md`) | LOW |
| §7.1 L1029-1031 | `check-gs-registration.py` "prints one expected false positive" for `Tests_EmailLifecycleFullCycle.gs` | It prints **Clean** with no false positive (run 2026-10-12 local) | LOW |
| §7.2 L1119 | CI runs the harness "via `test/run-frontend-harness.mjs`" | CI step is `node test/serve-and-harness.mjs` (`.github/workflows/test.yml:70`), which wraps `run-frontend-harness.mjs`. Close enough, but the entry point differs | LOW |
| §8 L1294 | Futwork leads go "ONLY to `FUTWORK_ROUTE_EMAIL_`" | Since P13 that variable is a blank test override (`EmailInfra.gs:119`). The route is `FUTWORK_ROUTE_NAME_` (`EmailInfra.gs:63`) via `futworkRouteEmailGs_()`. §4.3's own table is correct | LOW |
| §8 L1153 | Failure notices go to "`notifyOpsAlertGs_`/`OPS_ALERT_EMAIL_`" | The address comes from `opsAlertEmailGs_()` (name `OPS_ALERT_NAME_` plus the private table). `OPS_ALERT_EMAIL_` is blank in production (`EmailInfra.gs:85`) | LOW |
| §8 L1334-1336 | "Recovery for a missed 13:00: ... re-run `sendOvernightFollowupEmails()`" | Superseded by `recoverFailedFollowupBucketsNow()` (until 16:00, §4.3.5 L884-887). A plain re-run still works for an unsent bucket but bypasses the EO-9b targeting | LOW |
| §9.2 L1393-1396, L1437-1438 | `Daily_RM_Issues` grows ~26,660 rows/night x 13 columns | P18c (L744-747, 2026-10-08): about 10,000 rows/night, grid 13,877 x 26 columns. The two parts of the same document disagree | LOW |
| §9.7.5 L2395 | `check-runtime-parity.py`: "15 plain pairs checked" | 16 plain pairs, 1 regex pair, 1 prod-safety pair, 2 ruleset pairs now (dated history, still current-sounding) | LOW |

Verified correct (sample): `SNAPSHOT_HOURS_ = [0,6,12,18]` (`MovementTracker.gs:93`); `ALL_ISSUES_RUN_HOUR_ = 17` (`AllIssuesEmailer.gs:74`); 22:50 (`DailyRmIssueLog.gs:1100-1101`); 23:15 (`RmHierarchySync.gs:32-33`); audits 11:15/14:00/18:00 (`OpsAudit.gs:43-45`); sweeps 15:30 + 10:30/13:30/17:30 (`EmailSweep.gs:35-41`); 16:30 (`CycleReport.gs:28-29`); Monday 09:00 (`OpsChecklistRunner.gs:306-308`); `REGION_PNL_HEAD_CC_` values (`EmailInfra.gs:162`); `TRANSIENT_ERROR_RE_` (`EmailInfra.gs:531`); the 24-tag load order, matched exactly against `dashboard.html`; `TRACKED_COMPONENT_IDS` = 9 tabs (`js/sheets-writeback.js:951-954`); `DEFAULT_CLIENT_ID` (`js/reports-gmail.js:42`); `TEST_MODE_OVERRIDE_EMAIL_ = ''` (`EmailInfra.gs:43`); no `appsscript.json`; no `onOpen()`; retention 7/7/30/30/90 days.

### 2.2 `CLAUDE.md`

| Location | Claim | Reality | Sev |
|---|---|---|---|
| "What this is", item 2 | Backend = 13 named `.gs` files | 22 production files plus the private table (see 2.1). The auto-loaded orientation therefore never mentions the whole Email Ops system, `RmHierarchySync.gs` or `InteractionHistoryLogger.gs` | MED |
| Gotcha "A real architectural change updates HANDOVER.md" | `docs/RELATIONSHIP_MAP.md` + records are "not built yet" | `RELATIONSHIP_MAP.md` exists (2026-09-10). The record catalog is built (HANDOVER L14-16) | LOW |
| Testing, "Changing automatic email ..." | Names `OvernightEmailer.gs`/`AllIssuesEmailer.gs`, `RmHierarchy.gs`, `DailyRmIssueLog.gs` as the email/routing files that trigger `OPS_CHECKLIST.md` | Omits the files that now sit on the send path: `EmailInfra.gs` (gate, lock, watchdog), `EmailLedger.gs`, `EmailReroute.gs` (rewrites To/Cc before every send), `StaleLeads.gs`, `RmHierarchySync.gs` | MED |
| Testing, frontend harness | CI runs `test/run-frontend-harness.mjs` | Entry point is `test/serve-and-harness.mjs` (`.github/workflows/test.yml:70`) | LOW |
| `check-runtime-parity.py` "not run in CI yet" | Correct: `test.yml` runs only run-gs-tests, check-docs-coverage and check-catalog, plus the harness | (verified) | - |

All tool names, the 3-registration rule, the IST rule, the private-file rule and the live-project owner check out.

### 2.3 `OPS_CHECKLIST.md`

| Location | Claim | Reality | Sev |
|---|---|---|---|
| L28-30 | Paste `OpsChecklistRunner.gs` "alongside every other file - see `Core.gs`'s own header for the full list" | `Core.gs:3-6` and `:21-25` list the same 13 files (as of 2026-09-09). Following it builds a project without the 9 newer files | HIGH |
| L88-89 | "**4** of the checks below are now genuinely automated" | 5 (the stale-dashboard-tab check added 2026-10-03, `checkStaleComponents_`, `OpsChecklistRunner.gs:107`). HANDOVER L1344-1347 and TEAM §8 both say 5 | MED |
| Tier 1 L62-67; Tier 3 L192-204 | "These **6** constants must stay identical"; "Nothing enforces this mechanically ... stays a manual step" | (a) There is a 7th parity constant: `RM_PERF_CONFIDENCE_THRESHOLD` / `_GS_` = 0.40 (`js/core-rm-performance.js:150`, `DailyRmIssueLog.gs:1161`), plus the vendor/admin exclusions. (b) `python3 test/check-runtime-parity.py` (2026-09-21) diffs them all mechanically (it is not in CI, but it is no longer purely manual). The grep recipe shown misses the confidence threshold | MED |
| Tier 3 "Automatic email" L253-254 | "Confirm `OPS_ALERT_EMAIL_`/`CH_LEVEL_EMAIL_` (`EmailInfra.gs`) are still the right ... addresses" | Both are blank by design since P13 (`EmailInfra.gs:85,108`). The real settings are `OPS_ALERT_NAME_`/`CH_LEVEL_NAME_` (`EmailInfra.gs:61-62`) plus rows in the private table, checked with `showEmailConfigNow()`. A literal reader may "fix" the blank by committing an address to the public repo | HIGH |
| L32, L91 | The Monday summary goes to "`OPS_ALERT_EMAIL_`" | Sent via `opsAlertEmailGs_()` (name-resolved) | LOW |
| L205-213 | `checkMovementLogFreshnessNow()` "automated weekly", 8-hour grace | Function exists (`MovementTracker.gs`). 8 h is consistent with `snapshotRunProblemsGs_` "overdue" (HANDOVER P16) | - |
| L224 | Bounce checks at "10:30 / 13:30 / 15:30 / 17:30" | Matches `EmailSweep.gs:35-41` | - |
| L156-160, L150-151 | An unresolved or excluded RM "silently falls back to the legacy `Region_Recipients` catch-all" | Correct but incomplete: when `Region_Recipients` is empty it goes to the CH-level backstop (HANDOVER §4.3 table). The manual says the opposite simplification (see §3) | LOW |
| Structure L173-180 | The "Nightly RM hierarchy sync report" bullet has no blank line before `### Worst-performing-RM identification` | Markdown renders the heading inside the list item | LOW |

### 2.4 `LEAD_FOLLOWUPS_STALENESS.md`

Accurate. Verified: `clearLeadFollowupsTab`, `pushLeadsToFollowups`, `waitForAllFollowups`, `tryClaimGenerateCycle`/`releaseGenerateCycle` (`js/sheets-writeback.js`), `buildRegionWiseReports` (`js/reports-build.js`), `pushUnresolvedToLeadFollowups_`, `waitForFollowupSuggestions_`, `formatFollowupAgeGs_` (`OvernightEmailer.gs`), `overnightFollowupHintGs_` (`FollowupEngine.gs`); 6 x 20 s wait (`OvernightEmailer.gs:1294-1295`); amber 12 h / red 24 h on column G (`LeadFollowupsStaleness.gs:49-50,62`). No new code reader of `Lead_Followups` was added by the Email Ops work (other mentions are comments).

| Location | Claim | Reality | Sev |
|---|---|---|---|
| L99 | `pushLeadsToFollowups`, `js/sheets-writeback.js:227` | The `updatedAt` write is now at about L230 (anchor drift, not machine-checked) | LOW |

### 2.5 `docs/TEAM_CLAUDE_HANDOVER.md`

The most accurate of the set. The 22-file inventory, the 19-trigger clock, the cutoffs, the Email Ops mechanics, the safety rules and the §18 inventory all match code: `emailRecoverBucketsGs_`, `emailLedgerIdGs_`, `TM_STILL_CC_` (3 names, `RmHierarchy.gs:1201`), `RM_PERF_RULE_WEIGHTS` 1.5/1.2/1.0/0.8, `ISSUE_PRIORITY_GS_` order, the ledger header list (`EmailLedger.gs:122-124`), CH-level reports never re-routed (`EmailReroute.gs:385`), `gsl_claude_api_key` at `js/core-outcome-engine.js:599`, the missing `.inTimezone` at `OvernightEmailer.gs:2298-2299`.

| Location | Claim | Reality | Sev |
|---|---|---|---|
| §7.4 L312; §21.3 L771 | "`OUTCOME_RULES` (browser, ~110 rules) / `OUTCOME_RULES_GS_` (~30) - the count difference is an unresolved question" | Both arrays hold **31** `outcome:` entries (`js/core-outcome-engine.js:230`, `FollowupEngine.gs:147`; counted by bracket-matched parse). The "~110" probably counts signals or keywords, not rules. The "open question" it asks the next maintainer to settle is based on a miscount | MED |
| §15.1 L508 | `check-gs-registration.py` "prints one expected false positive" | It prints Clean (same as HANDOVER §7.1) | LOW |
| §15.1 L501, L504 | Local 3,370 / live 3,340 passed | Not re-verified here (would need a test run); dated snapshot | - |
| §8 L322 | "19 time triggers are live" | Consistent with code: 4+1+1+2+4+3+1+1+1+1 = 19 | - |
| §0 L4 | "47 non-private files" | 22 production + 25 test = 47 | - |
| §9.1 L357 | Calls the HANDOVER P10 wording drift | Correct, and still unfixed in HANDOVER | - |
| §18.9 L673 | "Safe to delete (`HANDOVER.md` line 132 ...)" | Correct today, but a line-number citation into a frequently edited file | LOW |

### 2.6 `docs/EMAIL_OPS_OPERATING_MANUAL.md`

| Location | Claim | Reality | Sev |
|---|---|---|---|
| L3 | "describes what is **built** (EO-1, EO-2, EO-5, EO-8, EO-9 for the 17:00 emails, EO-10 as a warning) and labels what is **planned**" | All of EO-1 to EO-13 are built (its own §13 L223-224 says "Planned: nothing more"). The header contradicts the body | MED |
| L4 | "Nothing here is live until the files are pasted" | Deployed 2026-10-10 (tracker L282-286) | MED |
| L5 | Records "`GS-015` .. `GS-017`, `SHEET-019` .. `SHEET-022`" | `GS-015`..`GS-022`, `SHEET-019`..`SHEET-025` | LOW |
| D1 L31 | The report covers "the cycle since the previous day's **17:00**" | The code window starts at **16:30** of the previous IST day (`CycleReport.gs:11`). HANDOVER L851-852 and the manual's own sample (L177 "8 Oct 16:30 to 9 Oct 16:30") say 16:30. (`CycleReport.gs:4`'s header comment also says 17:00, so the code comment drifts too) | LOW |
| §3 phase 11 L60 | "a separate silent audit pass is Plan" | Built: `OpsAudit.gs` 14:00 `auditFollowupEmails`. Stage G (L104) of the same manual describes it | MED |
| §3 phase 4 L53 | Per-lead validation "B (17:00)" | The status may understate: EO-1b wired the 10:00/13:00 jobs the same way (HANDOVER L822). Not re-verified line by line | LOW |
| §3 phase 7 L56; §8 L153 | "unroutable RM -> goes to the CH-level backstop" | `Region_Recipients` fallback first, then the backstop only if that region has none (HANDOVER §4.3 `CH_LEVEL_EMAIL_` row; `resolveRecipientEmailsForRegion_`) | LOW |
| §8 L154 | Excluded RM: "they go to the CH-level backstop only" | Same as above: `Region_Recipients` first (OPS_CHECKLIST L150-151) | LOW |
| §4 L78, L81 | GREEN = no bounce "once **30 minutes** old"; GREY = "an email not yet 30 minutes old" | The sweep minimum age is **10 minutes** (`EmailSweep.gs:44`, `EMAIL_SWEEP_MIN_AGE_MINUTES_ = 10`). TEAM §18.3 L615 records the 30 -> 10 change | MED |
| §11 rows C, D L194-195 | Follow-up tracker: "a dedicated view is planned"; checklist: "a per-check sheet is planned (EO-6)" | Both built: `Followup_Tracker` (`FollowupTracker.gs`) and `Daily_Checklist` (`DailyChecklist.gs`), described in §5/§9 of the same manual | MED |
| §14 step 1 L228 | "Paste the 23 files from `Downloads\Email-Ops-package`" | Already done (24 files plus a 9-file fix). The package exists only on Snehil's machine (TEAM §2.3). As a first action for a new reader it is obsolete | MED |
| §14 steps 2-3 | Run the setups, *then* `precreateEmailOpsTabsNow()` | For a fresh install the safe order is pre-create first, at a quiet time, before any trigger can fire (the HANDOVER §8 lesson). Setting up the 15:30/16:30 triggers first leaves a window where a scheduled job creates tabs | LOW |
| §12 L205 | Email jobs trigger "`atHour(10/13/17).nearMinute(0)`" | Correct, but 10/13 lack `.inTimezone('Asia/Kolkata')` (`OvernightEmailer.gs:2298-2299`), unlike every other trigger (TEAM §8 known gap). An operating manual should say so | LOW |
| §11 row A L192 | Lead master includes `Daily_RM_Issues` | Nothing reads that tab (TEAM §18.2) | LOW |

Verified correct: D5 18:30; recovery 12:45/16:00 (`OvernightEmailer.gs:2152-2155`, `AllIssuesEmailer.gs:77-78`); 14-day reroute (`EmailReroute.gs:44`); job label "Re-sent after a bounce" (`EmailLedger.gs:138`); reroute self-expiry when `Manager_Directory` changes (`EmailReroute.gs:21`); 45-minute release (`EmailLedger.gs:511`); severities; statuses.

### 2.7 `docs/STALENESS_TRACKER.md`

| Location | Claim | Reality | Sev |
|---|---|---|---|
| AUTO block L290-340 | "HEAD `02463f6`, 2026-10-03" with 13 deploy-register rows | 7 days and ~50 commits stale. The live report now shows 22 rows, all OK, at 19038e7. Nobody ran `--write` after the 2026-10-10 deploy | MED |
| `FACT_CLAIMS` (via section "Adding to the checks") | Stale stated facts are caught mechanically | Only 4 claims are registered (load position x2, core split x2, `test/check-staleness.py:226-229`). The ".gs file count" in CLAUDE.md/HANDOVER §1, the `SHEET-001..018` range and "4 automated checks" are unregistered, which is why section C reports 0 STALE while those claims are wrong | MED |
| Watch row "RM_HIERARCHY_RAW_ vs HR Live" | Proxy date = last `RmHierarchy.gs` commit; manual refresh is the control | Since 2026-10-08 the nightly sync (report-only) does this every night. The row's TTL and method predate it | LOW |
| Watch row "Claude memory index vs reality" | Owner Claude, `MEMORY.md` | Refers to the personal account's memory, which does not migrate (TEAM §21.3 says rewrite it) | LOW |
| Deploy register L92-115 | 22 rows, all 2026-10-10 | Matches `check-staleness.py` D, all OK | - |

---

## 3. Contradictions between documents

| # | Topic | Says A | Says B | Code / truth |
|---|---|---|---|---|
| C1 | Number of production `.gs` files | CLAUDE.md and HANDOVER §1: 13 (OPS_CHECKLIST defers to `Core.gs` header: 13) | TEAM §1/§6.2: 22 + private | 22 + private |
| C2 | Trigger reference | HANDOVER L313: `apps-script-triggers.md` is "full, source-verified" | TEAM §0: "out of date; §8 below is current" | 10 of 19 triggers listed. TEAM is right |
| C3 | Deploy state of Email Ops | HANDOVER §4.3.5 L902 "Not live until pasted ... what remains is deployment"; manual L4 the same | Tracker L282-286, TEAM §0/§10, check-staleness D: deployed and hash-verified 2026-10-10 | Deployed |
| C4 | Tab creation | HANDOVER §4.3.5 L849/L898: tabs and `Incident_Log` create themselves on first run | HANDOVER §8 L1164, TEAM §4.7/§10.8, manual §14.3: pre-create, never create in-job | Pre-create (`precreateEmailOpsTabsNow`) |
| C5 | CH-level report scope | HANDOVER P10 L606-608: includes an RM whose chain resolves up to a CH | TEAM §9.1.3: only an RM at CH/leadership level with nobody below | Narrow rule (`chLevelRms`, `RmHierarchy.gs`) |
| C6 | Who reads `Daily_RM_Issues` | HANDOVER §2 L102/L128, §5 L932: the Repeat Offenders tab | HANDOVER §9.7.2, P18 L733, TEAM §6.4/§18.2: nothing | Nothing |
| C7 | `Daily_Cohort_History` writer | HANDOVER §5: `js/sheets-writeback.js` only | TEAM §6.4: `MovementTracker.gs` auto + dashboard | Both (`MovementTracker.gs:733`) |
| C8 | Number of automated weekly checks | OPS_CHECKLIST L88: 4 | HANDOVER §8 L1344, §2 L129; TEAM §8: 5 | 5 |
| C9 | `RM_PERF_*` parity enforcement | OPS_CHECKLIST L200-204: "Nothing enforces this mechanically"; 6 constants | CLAUDE.md, HANDOVER §6/§9.7.5, TEAM §12: `check-runtime-parity.py` checks them, including the confidence threshold | Script exists; 7+ constants |
| C10 | Relationship map | CLAUDE.md: "not built yet"; HANDOVER L33 "until ... exist" | HANDOVER §6 L971 cites it as existing | Exists (2026-09-10) |
| C11 | Cycle-report window start | Manual D1: previous day's 17:00 | HANDOVER L852, manual sample L177: 16:30 | 16:30 (`CycleReport.gs:11`) |
| C12 | Bounce minimum age | Manual §4: 30 minutes | HANDOVER L868 "at least 10 minutes old"; TEAM §10.7/§18.3: 10 | 10 (`EmailSweep.gs:44`) |
| C13 | Unroutable/excluded RM destination | Manual §3 phase 7, §8: CH-level backstop | OPS_CHECKLIST, HANDOVER §4.3: `Region_Recipients` first, backstop only if empty | `Region_Recipients` then backstop |
| C14 | Email Ops tabs inventory | HANDOVER §5: none of the 7 Email Ops tabs | TEAM §6.4: all of them | TEAM |
| C15 | `OUTCOME_RULES` size | TEAM §7.4/§21.3: ~110 vs ~30, open question | HANDOVER §6/§9.6: pairs kept in sync | 31 vs 31 |

---

## 4. Procedures that would fail or misfire if followed literally

1. **Fresh deploy from HANDOVER §4.3.5 "Not live until pasted" (L902-903).** The list omits `EmailReroute.gs` and `Tests_EmailReroute.gs`. Bounce escalation would then be off silently: `sendGuardedEmailGs_` guards with `typeof emailRerouteApplyGs_` (`EmailInfra.gs:710`). Because `Tests_RunAll.gs` registers the reroute suite, `runAllTests()` would also throw a `ReferenceError` on that suite. The list also omits the `precreateEmailOpsTabsNow()` step.
2. **HANDOVER §4.3.5 "Check it live ... Both tabs create themselves on the first run after the paste" (L898) and "`Incident_Log` is created on the first alert" (L849).** Relying on this repeats the 2026-10-10 17:04 failure (`Service Spreadsheets timed out` after in-job `insertSheet`). The §4.3 setup table also lacks the pre-create step.
3. **OPS_CHECKLIST L28-30 "see `Core.gs`'s own header for the full list".** Building or rebuilding the Apps Script project from that 13-file list leaves out the ledger, sweep, audits, report, checklist, tracker, stale leads, reroute, the nightly sync and the interaction logger. Emailer calls into the ledger are not all `typeof`-guarded, so this is a likely `ReferenceError`. Not executed here; inferred from unguarded call sites.
4. **OPS_CHECKLIST L253-254 "Confirm `OPS_ALERT_EMAIL_`/`CH_LEVEL_EMAIL_` are the right addresses".** A literal reader finds them blank and may hard-code an address into a public repo, undoing P13. The correct check is `showEmailConfigNow()` plus the `*_NAME_` constants plus a row in the private table.
5. **`EMAIL_OPS_OPERATING_MANUAL.md` §14 "First five actions".** Step 1 points to a Downloads package that exists only on Snehil's machine and to a deploy that is already done. Step 2 installs the triggers before step 3 pre-creates tabs, which is the wrong order for a fresh install.
6. **HANDOVER §4.3 L313 "full, source-verified trigger set is `docs/architecture/apps-script-triggers.md`".** Auditing live triggers against that file would report 9 legitimate triggers as unknown or stale. Someone "cleaning up" would delete the sync, sweep, audit and report triggers.
7. **OPS_CHECKLIST Tier 3 parity grep (L196-199).** It checks 6 constants and passes while `RM_PERF_CONFIDENCE_THRESHOLD` could drift. Use `check-runtime-parity.py` instead.
8. **HANDOVER §4.3.4 P6 UNCONFIRMED recovery (L578-580): clear `followup_sent_at` + `checkpoint2_sent_at`, then run `sendOvernightFollowupEmailsNow`.** Written before EO-1b/EO-9b. The ledger now also holds that bucket as `UNCONFIRMED`, and `recoverFailedFollowupBucketsNow()` deliberately never targets it. The procedure does not say whether a plain re-run then double-records or is treated as a re-run by the deterministic ledger id. Not wrong as far as checked, but unverified against the ledger. Needs a one-line note.
9. **HANDOVER §8 L1334 "re-run `sendOvernightFollowupEmails()`" after a 13:00 crash.** Still works, but bypasses the EO-9b recovery (targeting, 16:00 cutoff, held alerts). Point to `recoverFailedFollowupBucketsNow()`.

Every other recovery procedure checked names a real function with the stated behaviour: `recoverFailed{AllIssues,Morning,Followup}Buckets{,Force}Now`, `pruneMovementLogNow`/`pruneDailyRmIssueLogNow`, `backfillOneDayFromMovementLogNow`, `dedupeUnmatchedCommentsNow`, `showEmailJobRunsNow`, `showEmailReroutesNow`/`endAllEmailReroutesNow`, `enable/disableRmHierarchySyncApplyNow`, `rebuildRmHierarchyForce`, `refillDailyRmIssueAssignedAtNow`, `showDailyRmIssueDiagNow`, `removeTestModeAllIssuesRowsNow`, `reportWorkbookCellUsageNow`.

---

## 5. Prioritised fix list (not made)

**P1 - deploy/operate correctness**
1. HANDOVER §4.3.5: replace the "Not live until pasted" paragraph with "Deployed 2026-10-10 (`000c1e6`), see tracker". If a fresh-install list is kept, make it complete: add `EmailReroute.gs`, `Tests_EmailReroute.gs`, `Tests_MovementTracker.gs`, de-duplicate, and add the pre-create step.
2. HANDOVER §4.3.5 L849/L898: replace "creates itself on first run" with "pre-created by `precreateEmailOpsTabsNow()`; run it at a quiet time before the first scheduled writer".
3. HANDOVER §4.3 setup table: add a `precreateEmailOpsTabsNow()` row (one-time, no trigger) and a pointer to `enableRmHierarchySyncApplyNow()`.
4. HANDOVER §5: add the 7 Email Ops tabs, `Movement_Log_Runs`, `Opp_Monitor_*`. Fix the `Daily_Cohort_History` writer, the `Daily_RM_Issues` reader ("none"), the `AllIssues_Log`/`Overnight_Log` readers and `SHEET-001..025`.
5. OPS_CHECKLIST: replace the `Core.gs`-header pointer with `test/run-gs-tests.js` `PRODUCTION_FILES` (or TEAM §6.2). Replace the `OPS_ALERT_EMAIL_`/`CH_LEVEL_EMAIL_` check with `showEmailConfigNow()` plus the `*_NAME_` constants. Change "4" to 5 automated checks. Replace the 6-constant grep with `check-runtime-parity.py` and add the confidence threshold.
6. HANDOVER §4.3 L313: stop calling `apps-script-triggers.md` "full"; point to TEAM §8 or update that file to 19 triggers (and fix its "10 triggers" content).

**P2 - wrong facts likely to be acted on**
7. CLAUDE.md and HANDOVER §1: list the 22 production files (or say "see `test/run-gs-tests.js`") and register a `FACT_CLAIMS` row for the count. Also update the `Core.gs` header comment (a code-comment fix, for the code auditors).
8. CLAUDE.md Testing: extend the "automatic email" trigger list to `EmailInfra.gs`, `EmailLedger.gs`, `EmailReroute.gs`, `StaleLeads.gs`, `RmHierarchySync.gs`.
9. HANDOVER P10: narrow the CH-level wording to match `chLevelRms` (and the `OvernightEmailer.gs` header).
10. HANDOVER §2 rows for `tab-repeat-offenders.js` and `DailyRmIssueLog.gs`: drop "reads/feeds `Daily_RM_Issues`".
11. Manual: refresh the header (L3-5), phase 11, §11 rows C/D, §4's 30-minute age (to 10), D1's window (to 16:30), §14 (mark it historical; put pre-create before trigger setup); fix the backstop wording in phase 7 and §8.
12. TEAM §7.4/§21.3: correct "~110 vs ~30" (31 vs 31) and drop the open question, or restate it as signal counts if that was meant.
13. HANDOVER §4.3.5 opening ("what exists so far is EO-1a/EO-1b") and L857 ("cannot yet show bounces ...").

**P3 - hygiene**
14. Renumber the second HANDOVER §4.3.4 to §4.3.5 (and shift Email Ops to §4.3.6), move P7/P8 into order, and update the header date.
15. `check-staleness.py --write` to refresh the tracker AUTO block. Update the "RM_HIERARCHY_RAW_" and "memory index" watch rows for the sync and the team account.
16. HANDOVER §7.1 and TEAM §15.1: remove the "expected false positive" note for `check-gs-registration.py`.
17. CLAUDE.md and HANDOVER §7.2: name `test/serve-and-harness.mjs` as the CI entry point.
18. HANDOVER §8 Futwork/ops-address bullets: use the `*_NAME_` and `…Gs_()` accessors. Point the 13:00 crash recovery to `recoverFailedFollowupBucketsNow()`. Add a ledger note to the P6 UNCONFIRMED procedure.
19. HANDOVER §9.2 row-volume figures (~26,660 x 13 vs ~10,000, grid 26 columns); `RELATIONSHIP_MAP.md` "not built" wording in CLAUDE.md and HANDOVER L33; LEAD_FOLLOWUPS_STALENESS L99 anchor.
20. Add `FACT_CLAIMS` rows for: the `.gs` file count (CLAUDE.md, HANDOVER §1), the number of automated weekly checks (OPS_CHECKLIST, HANDOVER), the `SHEET-` range, and the live trigger count (TEAM §8), so these stop drifting silently.
