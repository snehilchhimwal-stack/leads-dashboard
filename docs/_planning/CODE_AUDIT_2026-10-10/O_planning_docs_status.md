# O. Planning documents: status against the code (HEAD 19038e7)

Scope: `DOCUMENTATION_PROJECT_PLAN.md` (repo root) and all 32 files in `docs/_planning/` except `CODE_AUDIT_2026-10-10/`.
Method: each document was read in full. Every plan item, decision and open item was checked against the code at HEAD with grep/read, `git log --grep` / `-S`, and one local run of `python3 test/check-catalog.py`, which printed only and wrote nothing: checks A–P all clean at HEAD.
Nothing live was touched: no Sheet, Gmail or Apps Script editor. Where only the live system can answer, the status is **CANNOT VERIFY**. Where the evidence is a deploy note, the source is `docs/STALENESS_TRACKER.md` (read only).

Status words used below:
- **DONE**: the code or file exists and does what the plan said.
- **PARTLY**: some of the item is done; what is missing is named.
- **NOT STARTED**: nothing for this item is in the code.
- **SUPERSEDED**: a later decision or design replaced the item.
- **WITHDRAWN**: the owner cancelled the item.
- **CANNOT VERIFY**: only the live system can answer.

---

## 1. Document table

| File | Purpose | Date (last commit) | Relevance |
|---|---|---|---|
| `DOCUMENTATION_PROJECT_PLAN.md` | 6-phase, 50-task plan (DOC-001..050) for the `docs/` component catalog, plus a Governance Model and a Change-Control Mechanism | 2026-09-10 (`adb40d4`) | HISTORICAL. Every task is done. Its governance section is bannered as a pre-build snapshot. Its numbers (23 js / 11 gs) are wrong for today's code. |
| `_planning/README.md` | Index of `_planning/` | 2026-09-10 (`0360b79`) | STALE. Lists only the September documentation-project files; none of the October documents. |
| `file-inventory.md` (DOC-001) | Repo file list | 2026-09-10 | HISTORICAL snapshot (13 gs / 24 js). Today: 22 / 25. |
| `handover-coverage-map.md` (DOC-002) | `HANDOVER.md` sections mapped to components, plus a 10-item re-verify list | 2026-09-10 | HISTORICAL. Its list was worked off on 2026-09-10 (see OPEN_ITEMS §D). |
| `logic-audit-source-map.md` (DOC-003) | Lookup into the frozen `LOGIC_AUDIT.md` | 2026-09-10 | HISTORICAL. Accurate for a frozen source. |
| `dashboard-inventory.md` (DOC-004) | Decision: one dashboard, with tabs beneath it | 2026-09-10 | The decision is LIVE and still holds. Its tab count (8) is stale; there are 9 today. |
| `tab-inventory.md` (DOC-005) | The 8 tabs and their render functions | 2026-09-10 | HISTORICAL. TAB-009 Opp Monitor is missing (`4bbb58c`, 2026-09-18). |
| `js-module-inventory.md` (DOC-006) | 24 js files plus the core/feature split | 2026-09-10 | HISTORICAL. `js/tab-oppmonitor.js` is missing. |
| `gs-module-inventory.md` (DOC-007) | 13 production .gs files plus scope decisions | 2026-09-10 | HISTORICAL. 9 files are missing (all added 2026-10-08..10). The scope decisions (Tests_* and the private file are not cataloged) still hold. |
| `function-inventory.md` (DOC-008/030) | FN-001..254 allocation plus the significance bar | 2026-09-10 | HISTORICAL. Records now reach FN-433. The significance bar is still the rule used. |
| `button-inventory.md` (DOC-009/031) | 34 buttons mapped to BTN/DASH | 2026-09-10 | Count still CURRENT (34). Check M enforces button coverage. |
| `sheet-inventory.md` (DOC-010) | 14 tabs, writers/readers, one-spreadsheet check | 2026-09-10 | HISTORICAL. 25 SHEET rows now exist. The one-spreadsheet finding is still true except for the new HR roster read (`RmHierarchySync.gs` uses `openById`, read only). |
| `integration-inventory.md` (DOC-011) | EXT-001..004 | 2026-09-10 | CURRENT as far as checked. Does not mention the HR roster spreadsheet read. |
| `documentation-conflicts.md` (DOC-012) | Conflicts C-1..C-9 | 2026-09-10 | HISTORICAL. 7 resolved, C-8 logged, C-9 frozen by design. |
| `completeness-verification.md` (DOC-039) | Mechanical completeness re-check | 2026-09-10 | HISTORICAL. Superseded by `check-catalog.py` B/C/L/M, which run on every push. |
| `reference-verification.md` (DOC-040) | Dangling-reference and reciprocity check | 2026-09-10 | HISTORICAL. Superseded by `check-catalog.py` A. |
| `reciprocity-normalisation-notes.md` | Record of the 57-edge prune | 2026-09-10 | HISTORICAL. |
| `consistency-check.md` (DOC-041) | Catalog vs `LOGIC_AUDIT.md` vs code | 2026-09-10 | HISTORICAL. Partly superseded by `test/check-runtime-parity.py`. |
| `task-to-component-map.md` | DOC task to component reverse index | 2026-09-10 | HISTORICAL. Covers DOC/t-tf tasks only. |
| `OPEN_ITEMS.md` (DOC-042) | The "durable home for unresolved" tracker | 2026-09-10 (`dc29045`) | LIVE in role, STALE in content. Not touched for a month; does not list any open item from the October work. Two SHEET records (016/017) claim to be logged in its §B but are not. |
| `retention-decisions-needed.md` (DOC-037) | 7 TBD retention decisions plus ready-to-paste prune code | 2026-10-07 (`7dd50a8`) | LIVE. All 7 decisions are still TBD in code and records. |
| `weekly-spot-check-log.md` | Weekly LLM content spot-check (the E2E P0 mitigation) | 2026-10-07 (`633211f`) | LIVE. 5 cycles; the last was 2026-10-07 and the next is due about 2026-10-14. |
| `FORENSIC_COMPLETENESS_AUDIT_BRIEF.md` | Brief for an adversarial audit of the doc system | 2026-09-10 | HISTORICAL. Its header still says "NOT YET EXECUTED", which is wrong: the audit ran the same day. |
| `FORENSIC_COMPLETENESS_AUDIT_2026-09-10.md` | That audit: ~95% one-time, ~15% continuous; P0–P3 plan | 2026-09-10 (`dc29045`) | HISTORICAL. P0–P3 done where doable. |
| `E2E_ACCEPTANCE_TEST_SPEC.md` | 9-part acceptance test of the doc system | 2026-09-10 | HISTORICAL. Its header also still says "NOT YET EXECUTED". |
| `E2E_ACCEPTANCE_TEST_REPORT.md` | 3 rounds; verdict FAIL; checks F–P built | 2026-09-11 (`d69acb7`) | HISTORICAL. One item (TEST 7) stays open by design. Cites `E2E_ACCEPTANCE_TEST_LOG.md`, which is not in the repo (it lived on a deleted branch). |
| `DB_ARCHITECTURE_REVIEW.md` | (a) 12-part proposal to move the Sheet tabs into a relational database behind an API; (b) appended 8-phase "Lead History & Versioning Review" | 2026-09-11 (`64f49d8`) | (a) DORMANT. Not approved, nothing built, and in practice overtaken (see §2.9). (b) Phase 6 implemented and merged (`1c19d1a`); HISTORICAL. |
| `REPEAT_OFFENDERS_ARCHITECTURE_REVIEW.md` | Cache-based fix for the PDF-vs-screen race | 2026-09-12 (`6259552`) | HISTORICAL. Implemented (steps 1–5). |
| `EMAIL_LIFECYCLE_TWO_CHECKPOINT_REDESIGN.md` | 17:00 → 10:00 CP1 → 13:00 CP2 design | 2026-10-07 (`c416a01`) | LIVE as a design record. Implemented. One known limitation is still open. Part 10's "never LockService" is superseded. |
| `EMAIL_AUDIT.md` | Email pipeline audit F1–F25, fixes P1–P18c | 2026-10-08 (`0f38cfa`) | LIVE (recent). P1–P18c committed. A few owner decisions and live checks remain. |
| `RM_HIERARCHY_NIGHTLY_SYNC.md` | Nightly HR roster → `RM_Hierarchy` sync plan | 2026-10-08 (`3dc9852`) | LIVE. Built and deployed report-only. 3 open questions. |
| `EMAIL_OPS_SYSTEM_AUDIT.md` | Email Operations System (EO-1..EO-13, D1–D9) | 2026-10-10 (`000c1e6`) | LIVE. Every part is built. Its status line still says "NOT yet live", which is stale: `STALENESS_TRACKER.md` records the deploy and 19 triggers on 2026-10-10. |
| `DEAD_CODE_AUDIT_2026-10-03.md` | Dead/stale code report | 2026-10-03 (`6b01dcf`) | LIVE. 4 of 6 actionable items are still undecided. |

---

## 2. Per-document plan items: status and evidence

### 2.1 DOCUMENTATION_PROJECT_PLAN.md

| Item | Status | Evidence |
|---|---|---|
| Phase 1, DOC-001..012 (inventories, conflicts) | DONE | Commits `47ac409`, `fb4caac`, `da558d1`, `89f5ca1`, `df25797`, `40032ba`, `0393630`. The deliverables are the `_planning/*-inventory.md` files. |
| Phase 2, DOC-013..024 (docs tree, naming, templates, INDEX, HOW_TO_*) | DONE | `c82ec67`, `bc6781c`, `2a1990e`, `daa77f7`. `docs/_templates/` (10 templates), `docs/NAMING_CONVENTIONS.md`, `docs/INDEX.md`, `docs/HOW_TO_{REGISTER,UPDATE,RETIRE}_A_COMPONENT.md`. |
| Phase 3, DOC-025..035 (DASH/TAB/JS/GS/SHEET/EXT/DATA records, relationship map) | DONE | `8b05395`, `92075f5`, `a4a99a5`, `3d49955`, `0e75257`, `71b50e1`, `dc2713d`, `4081ab3`, `57bdf63`. The catalog has been kept current since: INDEX has 22 GS / 25 JS / 25 SHEET / 9 TAB rows, which match the files on disk. |
| Phase 4, DOC-036..038 (lifecycle, retention list, sensitivity) | DONE as a deliverable | `1ceefd9`, `82a22b6`. The 7 retention decisions themselves are still open (see 2.3). |
| Phase 5, DOC-039..042 (verification, open items) | DONE | `79ce29d`, `29f564c`, `a13b5e4`. |
| Phase 6, DOC-043..050 (find-docs guide, checklist, cross-links) | DONE | `bf06501`, `2a39c6d`, `99170a8`. `docs/HOW_TO_FIND_DOCS_FOR_A_FEATURE.md` and `docs/PRE_SHIP_DOCUMENTATION_CHECKLIST.md` exist. |
| Maintenance Model: graduate `check-docs-coverage.js` to blocking | SUPERSEDED | Still `continue-on-error: true` (`.github/workflows/test.yml:33`). Replaced by the blocking `check-catalog.py` B (`:43`). |
| Change-Control steps 1–3 (detect, resolve ID, dependencies) | DONE | `check-catalog.py` E, with `fetch-depth: 0` (`test.yml:17`). |
| Change-Control steps 5–6 (mark Stale, open task) | PARTLY, human by design | E prints the stale set and the ops JSON; nothing writes it. |
| Change-Control step 7 ("write a fresh `docs/validation/` evidence line") | NOT STARTED in practice | `docs/validation/` holds only `README.md`. |
| Change-Control step 11 (one `docs/changes/<date>-<sha>.md` per change) | NOT STARTED in practice | `docs/changes/` holds only `2026-09-10-build.md`. A month of large code changes (email audit P1–P18c, Email Ops, RM sync) produced no change record. |
| Governance "Current-State Audit" section | SUPERSEDED (self-bannered) | Bannered as a pre-build snapshot (`3d2db17`). |
| Repository Structure (`docs/architecture`, `changes`, `validation`, `_archive`) | DONE as folders | All exist. `_archive/` is empty apart from its README. |

### 2.2 OPEN_ITEMS.md

| Item | Status today | Evidence |
|---|---|---|
| §A Owner = the project owner on every record | DONE (no-action by design) | `check-catalog.py` H clean. |
| §B 7 retention TBDs | NOT STARTED (owner decision) | Records still say `TBD`: SHEET-001:108, 004:97, 005:84, 008:94, 011:80, 013:95, 014:101. There is no `prune*` for Send_Log, AllIssues_Log or Overnight_Log (the grep of `function prune` finds only Movement_Log, Daily_RM_Issues, Comment_History, Unmatched_Comments, Email_Ledger). |
| §B ratify: Comment_History / Unmatched unbounded | SUPERSEDED | 30-day prunes since 2026-09-29: `InteractionHistoryLogger.gs:191,213`, `UnmatchedCommentLogger.gs:323,336`. |
| §B data-safety: does a Manager_Directory rebuild keep hand-filled emails? | DONE in code | `RmHierarchy.gs:131,654` ("Manager_Directory refreshed (emails preserved)"). Live behaviour: CANNOT VERIFY. |
| §C C-1..C-7 | DONE | `documentation-conflicts.md` status rows; check O enforces the load-order claim. |
| §C C-8 (.gs comments still say `js/core.js`) | NOT STARTED (logged, low) | Not re-grepped item by item. |
| §D HANDOVER reconciliation list | DONE | `fd59944`, `e4a51ca`. |
| §E reciprocity | DONE, enforced | check A clean at HEAD. |
| §F HIGH: Loan-region `effectiveRegion` override missing from the scheduled emails | PARTLY | `js/reports-build.js:80` has it. The emailers do not: `AllIssuesEmailer.gs` and `OvernightEmailer.gs` contain no Loan handling. A partial `.gs` twin `_effectiveRegionGs_` exists only for the cohort (`MovementTracker.gs:1063,1187`). Loan-team routing goes to the Loan City Lead through the hierarchy (`ca7802c`), which reduces the impact. `DATA-005` "Next action" is still open. |
| §F MED #1: `browserSnapshotOpenLeads` has no reentrancy guard | NOT STARTED (apparently) | `js/sheets-writeback.js:830-842`: no in-flight flag found. |
| §F MED #2: `CONFIG.MIN_CALLS_AFTER_48H` is display-only | NOT STARTED | `js/core-foundation.js:33`; used at `js/overview-distribution-people-ops.js:1148,1180,1222`. |
| §F MED #3: browser/backend `Lead_Followups` overlap window | PARTLY | The P4 lock (`EmailInfra.gs:776`) serialises the backend jobs only; the browser path has no lock. |
| §F LOW: no scheduled "Premature Closes"; KPI strip mixing; dropped click; RmHierarchy single point of failure | NOT STARTED | No change found. |
| §F `OUTCOME_RULES` ~110 vs ~30 | Likely resolved / mis-stated | A count of rule objects gives 31 in `js/core-outcome-engine.js` and 31 in `FollowupEngine.gs`. `check-runtime-parity.py` now diffs the pair. |
| §F `TEST_MODE_OVERRIDE_EMAIL` footgun | PARTLY | Still a mutable global in both runtimes (`js/reports-ui.js:212`; `EmailInfra.gs`). Email audit P9 added an alert when a scheduled run executes in test mode (`fe9b37f`). |
| §F `_allReports` bare cross-file `let` | NOT STARTED (cosmetic) | Not re-checked. |
| §G `docs/changes/` first real record | NOT STARTED | See 2.1, step 11. |
| §G.1 forensic P0–P3 | DONE where doable | See 2.4. |

### 2.3 retention-decisions-needed.md

| Item | Status | Evidence |
|---|---|---|
| 7 TBD tabs | NOT STARTED (owner decision) | As in 2.2 §B. Check K confirms the records and the list agree (still TBD). |
| "Decisions already made" table | CURRENT | Movement_Log 7 d (`MovementTracker.gs:80`), Daily_RM_Issues 7 d (`DailyRmIssueLog.gs:85`), Comment_History and Unmatched 30 d. |
| Prune appendix (copy-paste code) | Not used | No new prune was added for the 7 tabs. |
| Gap: tabs created since this doc have no retention | NEW | Movement_Log_Runs (SHEET-015, "none enforced"), Incident_Log (SHEET-021), Daily_Report (022), Daily_Checklist (023, ~4k rows/yr), Followup_Tracker (024, ~18k rows/yr), Email_Reroutes (025, expired rows stay). SHEET-016/017 say `TBD`, "logged in OPEN_ITEMS §B", but OPEN_ITEMS §B does not list them. |

### 2.4 FORENSIC_COMPLETENESS_AUDIT_BRIEF.md + _2026-09-10.md

| Item | Status | Evidence |
|---|---|---|
| P0-1 diff → component-ID resolver | DONE | check E; `test.yml:17,43`. |
| P0-2 auto-stale + task per push | PARTLY (human write side) | E prints the ops JSON. |
| P0-3 3 live contradictions | DONE | `3d2db17`. |
| P1-4 reverse walk record → file | DONE | checks B/C, blocking. |
| P1-5 INDEX reciprocity | DONE | check A. |
| P1-6 Last-Verified drift | DONE (advisory) | check D: "clean" at HEAD. |
| P1-7 flip `check-docs-coverage` to hard-fail | SUPERSEDED | Moot; check B is the blocking coverage check. |
| P1-8 57 record-only edges | DONE | `reciprocity-normalisation-notes.md`. |
| P2-9 INDEX snapshot self-consistency | DONE | check F. |
| P2-10 FLOW-001/002 + trigger index | DONE | `docs/architecture/FLOW-001…`, `FLOW-002…`, `apps-script-triggers.md`. |
| P2-11 `changes/` + `validation/` backfill | DONE once | One build record and a README only (see 2.1). |
| P2-12 comment-change flag | DONE | check E pair-marker flag. |
| P2-13 frontend harness in CI | DONE, blocking | `test.yml:57` `frontend-harness` job. |
| P2-14/15 coverage of other types; zero-instance prefixes | DONE | checks B/L/M; `NAMING_CONVENTIONS.md`. |
| P3-16 goal links / REQ- IDs | PARTLY | Task-to-component map done; REQ- IDs not built (deferred). |
| P3-17 review signal | DONE (process) | `HOW_TO_UPDATE_A_COMPONENT.md` step 8. |
| P3-18 retention | NOT STARTED (owner) | See 2.3. |
| P3-19 Owner distribution | WITHDRAWN (no-action by design) | Single owner. |
| Optional: make `frontend-harness` a required status check | CANNOT VERIFY | Branch-protection setting, not in the repo. |
| Brief header "NOT YET EXECUTED" | STALE text | The audit ran on 2026-09-10. |

### 2.5 E2E_ACCEPTANCE_TEST_SPEC.md + _REPORT.md

| Item | Status | Evidence |
|---|---|---|
| Required fixes #1–#10 | DONE | `b26774e`, `c6e12b5`, `068a388`, `32312fc`, `9b9b9b2`, `fcde284`, `e3ec3e5`, `5781a69`. Fix #2 (`-VerifyCatalogRepo`) lives in the To-Do repo's `update-tasks.ps1`: CANNOT VERIFY from here. |
| Round-2 gaps 1–7 (checks D-ext, J, K, L, M, N, O) | DONE | `6fb75f1`, `c97254c`, `8fc9bb5`, `b8f1a3c`, `e177475`, `b49c8da`, `ba8ff03`. All 16 `check_*` functions present in `test/check-catalog.py`; all clean at HEAD. |
| Round-3 false-pass: check P | DONE | `5133f56`. |
| TEST 7 (a comment contradicting the code gets zero signal); overall verdict FAIL | OPEN by design | Mitigated by the weekly spot-check: 5 cycles, last 2026-10-07 (`weekly-spot-check-log.md`). The routine is external (cloud), so whether it is still scheduled: CANNOT VERIFY. |
| 6 confirmed dead ends (broad exceptions, stale dependency, general comment, general handover, false Done, wrong-version validation) | WITHDRAWN (no structural fix) | Report §"Round 3 remaining". |
| Check N covers only 2 EXC rows | PARTLY by design | As reported. |
| Reference to `E2E_ACCEPTANCE_TEST_LOG.md` | Dangling | The file is not in the repo (it was on a deleted branch). |

### 2.6 EMAIL_AUDIT.md (F1–F25, P1–P18c)

| Item | Status | Evidence |
|---|---|---|
| P1 send-safety gate | DONE | `fb17144`; `EmailInfra.gs:707` `sendGuardedEmailGs_`. |
| P2 real plain-text part | DONE | `dbeb7da`. |
| P3 Checkpoint 2 keyed by region + recipient (F1) | DONE | `5e57a1d`. |
| P4 job lock, fail-open (Amendment A1) | DONE | `6fc3f3c`; `EmailInfra.gs:776`. |
| P5 stamp only on delivery | DONE | `f9728cc`. |
| P6 no resend after an ambiguous send | DONE | `d1caf9d`. |
| P7 once-only appends, merged buckets, no duplicate Lead_Followups | DONE | `6acea29`. |
| P8 one leads read per job | DONE | `83be0fe`. |
| P9 run records, watchdog, real send time, retrying alert, test-mode alert | DONE | `fe9b37f`; `EmailInfra.gs:1001,1015`. |
| P10 CH-level once per day | DONE | `15d74d4`; `EmailInfra.gs:281`. |
| P11 browser send gate | DONE | `b9e6c7b`; `js/reports-gmail.js:276`. |
| P12 retry "server error occurred" | DONE | `415be48`; `EmailInfra.gs:531`. |
| P13 corporate addresses out of the public repo | DONE for HEAD | `c416a01`. A scan of tracked .gs/js/html finds 0 company-domain addresses. The addresses remain in git history by owner decision. |
| P14 docs + deploy | DONE | `448ea58`. |
| P15 per-lead call baseline (F18) | DONE | `7799e44`. |
| P16 `snapshotPeriodic` under 30 min (F23) | DONE in code | `7799e44`. Live timing measurement: CANNOT VERIFY (`HANDOVER.md:709` still says "not yet observed"). |
| P17 / P18 / P18b / P18c | DONE | `58ab8e1`, `78e47f5`, `80a1768`, `1cd1cfa`. |
| §7 "run `setupEmailJobWatchdogTrigger()`" | Probably DONE | Tracker 2026-10-10: 19 live triggers. No dedicated line confirms the watchdog by name, so CANNOT VERIFY directly. |
| §7 "read `showDailyRmIssueDiagNow()` after the first 22:53 text-write run" | CANNOT VERIFY | Tracker 2026-10-08 notes an accidental midday capture; no later result recorded. |
| F24 (addresses in history), F25 (3 business-rule ambiguities) | OPEN (owner decision) | Left as-is per §7. |
| Stale untracked folder `working files on 28th…` | OPEN | Still present on disk (2 .gs files). |

### 2.7 EMAIL_LIFECYCLE_TWO_CHECKPOINT_REDESIGN.md

| Item | Status | Evidence |
|---|---|---|
| Part 5 AllIssues_Log columns J–N | DONE | `AllIssuesEmailer.gs:113-127`. |
| Part 8 steps 2–5 (snapshot, CP1, CP2, combined sends) | DONE | `SlaEngine.gs:241` `computeAllIssuesCheckpointGs_`, `:331` `allIssuesCheckpointIsActiveGs_`. |
| Part 10 `Overnight_Log.followup_sent_at` guard | DONE | `OvernightEmailer.gs:281`. |
| 2026-09-26 amendment: list only unresolved leads | DONE | `allIssuesCheckpointIsActiveGs_`; `OvernightEmailer.gs:805` skip. |
| Part 10 "never LockService" stance | SUPERSEDED | Email audit P4 added a lock (`EmailInfra.gs:776`). |
| Part 11 write-backs wrapped in try/catch | DONE | Per the doc; later hardened by P5/P7. |
| Known limitation: CH-level-diverted leads get no Checkpoint 1/2 | NOT STARTED | P10 only made CH reports once per day; no checkpoint path for them found. |
| Mentions `sendOneOvernightEmail_` as the live Section 1 | SUPERSEDED | Production now uses `sendCombinedMorningEmail_` (see 2.11). |

### 2.8 RM_HIERARCHY_NIGHTLY_SYNC.md

| Item | Status | Evidence |
|---|---|---|
| `RmHierarchySync.gs` + tests, three registrations | DONE | `d897529`, `70f21c4`, `3dc9852`. Check-catalog L/B clean. |
| Trigger after 23:00 | DONE | `RmHierarchySync.gs:681-688`. Live install: tracker 2026-10-08. |
| Report-only by default; apply property | DONE | `RmHierarchySync.gs:18,34`. |
| Safety gates (fewer than 250 people, more than 25 changes) | DONE | `:39-40`. |
| Rebuild refuses unless forced | DONE | `RmHierarchy.gs:586-591,659`. |
| Old-spelling refinement (RULE-042) | DONE | `3dc9852`. |
| Turn apply on after 2–3 reviewed reports | NOT STARTED / CANNOT VERIFY | Tracker 2026-10-08/09: "Apply is OFF". State since is unknown (the TEAM hand-over §18.7 says the same). |
| Open Q1: is the owner account in the company domain? | DONE | The first report-only run read the HR sheet (tracker 2026-10-08). |
| Open Q2: does a leaver really disappear from the HR sheet? | OPEN | No record. |
| Open Q3: is the owner OK with the rebuild refusing? | De facto accepted | Built and deployed that way. |

### 2.9 DB_ARCHITECTURE_REVIEW.md

**(a) Database migration review, Parts 1–12.**

| Item | Status | Evidence |
|---|---|---|
| Part 3 13-table schema; Part 6 API layer; Part 8 migration phases 1–8 | NOT STARTED (never approved) | No `api/`, `db/`, `config/`, `scripts/`, `runbooks/` directories. |
| Part 9 Central Repository Structure: extend this repo; add `api/`, `db/schema.sql` + `migrations/`, `config/*.env.example`, `docs/db/`, `docs/api/`, `scripts/`, `runbooks/`, CODEOWNERS, a check-catalog schema check, staging-then-production promotion | NOT STARTED | None of these exist. Direct-to-`master` pushes continue. The "extend, don't fragment" principle is honoured de facto (all new work landed in this repo), but every Part 9 artifact is absent. |
| Approval Checkpoint items 1–9 | NOT STARTED | No approval recorded anywhere (TEAM_CLAUDE_HANDOVER §18.8 says the same). |
| Roadmap P0-2 (rebuild keeps hand-filled emails) | DONE | `RmHierarchy.gs:131,654`. |
| Roadmap P0-1/3/4/5/6 (live facts, regions list, ambiguous columns, baseline, export) | NOT STARTED | — |
| Roadmap P3-24 (automate the weekly Ops Checklist) | DONE (already existed) | `OpsChecklistRunner.gs`. |
| Roadmap P3-26 (OUTCOME_RULES duplication) | PARTLY | Parity check script exists; duplication remains by design. |
| Checkpoint 3 (unify region recipients; drop the browser localStorage store) | NOT STARTED | `js/reports-ui.js:51,56` still uses localStorage. |
| Overall direction | SUPERSEDED in practice | The October Email Ops build added 7+ new Sheet tabs (SHEET-019..025). The Sheets-as-database design was chosen again, without revisiting this proposal. |

**(b) Lead History & Versioning Review, Phases 1–8.**

| Item | Status | Evidence |
|---|---|---|
| Phase 6 content-hash dedup + `Movement_Log_Runs` | DONE | Merged `1c19d1a`, CI fix `0cdf6cd`; `MovementTracker.gs:139,165`. |
| Issue #1 (two writers race on Movement_Log) | NOT STARTED | No lock covers the browser writer (see OPEN_ITEMS MED #1). |
| Issue #2 (prune after write) | NOT DONE (by later design) | `MovementTracker.gs:722`: the prune is still a phase after the capture write. P16 deliberately put "core capture first". The cell-ceiling risk is accepted rather than removed. |
| Issue #3 (`Movement_Log_Runs` has no idempotency key) | WITHDRAWN (platform limit) | Documented. |
| Issue #4 (no general point-in-time helper) | NOT STARTED (deferred, no consumer) | — |
| Issue #5 (`status` not wired into the capture) | NOT STARTED | No `status` column in `MovementTracker.gs`. |

### 2.10 REPEAT_OFFENDERS_ARCHITECTURE_REVIEW.md

| Item | Status | Evidence |
|---|---|---|
| Step 1 result cache | DONE | `8fa3895`; `_repeatOffendersLastResult` in `js/tab-repeat-offenders.js`. |
| Step 2 PDF reads the cache, never recomputes | DONE | `9dea24a`. All 10 `computeRmPerformance` mentions in `js/repeat-offenders-pdf.js` are comments. |
| Step 3 PDF button disabled while stale | DONE | `a74a65f`. |
| Step 4 harness tests | DONE | `4b420b2`. |
| Step 5 cleanup + verification | DONE | Recorded in the doc's own commit `6259552`. The TEAM hand-over's "[unknown]" can be closed. |
| Manual real-data race check (signed-in session) | CANNOT VERIFY | Recommended follow-up; no record. |
| `passesRepeatOffenderFilters` vs `effectiveRegion` (Loan) | OPEN (known limitation) | Same family as the HIGH Loan finding. |

### 2.11 DEAD_CODE_AUDIT_2026-10-03.md

| Item | Status | Evidence |
|---|---|---|
| `collatedCountLabel` (dead) | NOT STARTED | `js/core-collation.js:155`. |
| `MOVEMENT_LOG_RUNS_COLUMNS` (JS, unused) | NOT STARTED | `js/tab-movement.js:55`. |
| `.hover-row` CSS rule (dead) | NOT STARTED | `dashboard.html:133`. |
| `rmPerformanceDrivenBy` (kept on purpose) | DONE (leave as-is) | `js/core-rm-performance.js:1241`. |
| JS-008 FN-063 doc row | DONE | FN-063 now names only `rmPerformanceHierarchyCells` (`docs/js-modules/JS-008…:79`). |
| `sendOneOvernightEmail_` (superseded, kept alive by tests) | NOT STARTED (owner decision) | `OvernightEmailer.gs:424`. |
| `working files on 28th…` folder | NOT STARTED | Still present. |
| `design/live-ops-redesign.html` | NOT STARTED (owner decision) | Still tracked. |
| "Checked clean" list | Out of date | Written against 14 .gs / 6 triggers; today there are 22 .gs and 19 triggers. |

### 2.12 EMAIL_OPS_SYSTEM_AUDIT.md (EO parts)

| Item | Status | Evidence |
|---|---|---|
| EO-1a/1b ledger + exclusions | DONE | `EmailLedger.gs`; SHEET-019/020; 90-day prune at `EmailLedger.gs:114,466`. |
| EO-2 Incident_Log + held alerts | DONE | `EmailLedger.gs:598` `releaseHeldIncidentsGs_`. |
| EO-3/4 silent audits (11:15 / 14:00 / 18:00) | DONE | `OpsAudit.gs:43-45`. |
| EO-5 sweep (15:30 full + 10:30 / 13:30 / 17:30 bounce-only) | DONE | `EmailSweep.gs:35,39-41`. |
| EO-6 checklist A–K | DONE | `DailyChecklist.gs`. |
| EO-7 follow-up tracker | DONE | `FollowupTracker.gs`. |
| EO-8 16:30 report + Daily_Report | DONE | `CycleReport.gs:28,376`. |
| EO-9 recovery | DONE | `AllIssuesEmailer.gs` `recoverFailedAllIssuesBucketsNow`; `OvernightEmailer.gs` `recoverFailedMorningBucketsNow` / `recoverFailedFollowupBucketsNow`. |
| EO-10 freshness warning | PARTLY | `EmailInfra.gs:1036-1037` (3 h / 5 h). The row-count sanity check and the duplicate-lead-id check are **not built** (the plan says so itself). |
| EO-11 fault-injection E2E | PARTLY / changed | Folded into existing suites; the planned `Tests_EmailOps_E2E.gs` does not exist. |
| EO-12 operating manual | DONE | `docs/EMAIL_OPS_OPERATING_MANUAL.md`. |
| EO-13 bounce re-route | DONE | `EmailReroute.gs:44` (14 days); hooks at `EmailInfra.gs:708-710` and `OvernightEmailer.gs:1455-1458`. |
| Deploy runbook steps 1–5 | DONE | Tracker 2026-10-10 17:27: 19 triggers; all live files match HEAD. |
| Doc header "NOT yet live" | STALE text | — |
| First-run checks (16:30 report, sweeps, audits) | CANNOT VERIFY | Live only. |

---

## 3. Still-open items across all plans (ranked)

1. **HIGH Loan-region override missing from the scheduled emails.** No `effectiveRegion` twin in `AllIssuesEmailer.gs` / `OvernightEmailer.gs`; DATA-005 next action. Mitigated only by Loan-team hierarchy routing (`ca7802c`). (OPEN_ITEMS §F, consistency-check, REPEAT_OFFENDERS)
2. **7 retention decisions still TBD**, while the workbook sits against a 10M-cell ceiling. Send_Log, AllIssues_Log, Overnight_Log, SLA_History, Daily_Cohort_History, Lead_Followups, leads. (OPEN_ITEMS §B, retention doc, DB review checkpoint 1)
3. **New tabs with no retention**: Movement_Log_Runs, Followup_Tracker (~18k rows/yr), Daily_Checklist, Incident_Log, Daily_Report, Email_Reroutes; plus SHEET-016/017 `TBD` but missing from OPEN_ITEMS §B. (new)
4. **Movement_Log prune still runs after the capture write.** Cell-ceiling self-healing risk; this exact failure happened three times on Daily_RM_Issues. (DB review issue #2)
5. **Two Movement_Log writers (browser + trigger) with no lock, and no browser reentrancy guard.** (OPEN_ITEMS MED #1/#3, DB review issue #1)
6. **RM hierarchy sync apply mode still off (last known), and the leaver-removal behaviour of the HR sheet is unconfirmed.** (RM_HIERARCHY_NIGHTLY_SYNC)
7. **Email Ops first-run checks not recorded**: 16:30 report, sweeps, audits, watchdog-by-name; plus the P16 timing measurement and the `showDailyRmIssueDiagNow()` post-run check. (EMAIL_OPS, EMAIL_AUDIT §7)
8. **CH-level-diverted leads get no Checkpoint 1/2 follow-up.** (EMAIL_LIFECYCLE Part 7/11)
9. **EO-10 remainder**: Leads-tab row-count sanity check and duplicate-lead-id check not built. (EMAIL_OPS)
10. **Change-control trail not kept**: no `docs/changes/` record and no `docs/validation/` evidence for any change since 2026-09-10 (steps 7 and 11). (DOC PLAN, OPEN_ITEMS §G)
11. **`OPEN_ITEMS.md` not maintained since 2026-09-10.** It no longer is "the durable home for unresolved". (new)
12. **`TEST_MODE_OVERRIDE_EMAIL(_)` mutable-global footgun** (alerting added, footgun remains). (OPEN_ITEMS §F, EMAIL_AUDIT F20)
13. **`CONFIG.MIN_CALLS_AFTER_48H` display-only mismatch.** (OPEN_ITEMS MED #2)
14. **F25 business-rule ambiguities** (overdue in raw clock hours; Section 1 drops a category-changed lead; "he will call back"). (EMAIL_AUDIT)
15. **TEST 7 (prose contradicting code)**: open by design; depends on the external weekly spot-check continuing (next due ~2026-10-14). (E2E report)
16. **Dead code awaiting a decision**: `sendOneOvernightEmail_`, `collatedCountLabel`, JS `MOVEMENT_LOG_RUNS_COLUMNS`, `.hover-row`; `design/live-ops-redesign.html`. (DEAD_CODE_AUDIT)
17. **Delete the untracked `working files on 28th for automatic email/` folder** (contains an old hard-coded ops address). (DEAD_CODE_AUDIT, EMAIL_AUDIT)
18. **Region-recipient dual store** (browser localStorage vs `Region_Recipients` tab). (DB review checkpoint 3)
19. **Repeat Offenders manual real-data race check** with a signed-in session. (REPEAT_OFFENDERS Part 7)
20. **Remaining LOW items**: no scheduled "Premature Closes" email, KPI-strip mixed counts, dropped click on rapid filtering, `RmHierarchy.gs` single point of failure, C-8 comment touch-ups, `_allReports` let. (OPEN_ITEMS §F/§C)
21. **The whole database-migration proposal** (Approval Checkpoint 1–9; Part 9 repo structure). Unapproved; needs an explicit keep-or-drop decision. (DB review)
22. **F24**: corporate addresses remain in public git history (owner chose not to rewrite). (EMAIL_AUDIT)

---

## 4. Decisions register

| Decision | Where made | Honoured in code? | Evidence |
|---|---|---|---|
| D1: one 16:30 report, ops address only, every day | EMAIL_OPS §0 | Yes | `CycleReport.gs:28,338`. |
| D2: alerts held until the job's other emails are confirmed; whole-job crash sent at once | EMAIL_OPS §0 | Yes | `EmailLedger.gs:598`. |
| D3: drop only the defective lead | EMAIL_OPS §0 | Yes | `AllIssuesEmailer.gs:342,400-411`. |
| D4: Leads freshness AMBER >3 h / RED >5 h, warning only | EMAIL_OPS §0 | Yes | `EmailInfra.gs:1036-1037`. |
| D5: late send until 18:30, then "rescheduled" | EMAIL_OPS §0 | Yes | `AllIssuesEmailer.gs:77-78,726`. |
| D6 / D7: stale Leads-tab notice / "stale" meaning | EMAIL_OPS §0 | WITHDRAWN 2026-10-10 | Replaced by D8. |
| D8: stale lead = no update for more than 24 h; red block at the bottom of every automatic email; stays in counts | EMAIL_OPS §0 | Yes | `StaleLeads.gs:23`. |
| D9: bounce → next in hierarchy, else ops; checks at 10:30 / 13:30 / 15:30 / 17:30; 14-day redirect | EMAIL_OPS §0 | Yes | `EmailInfra.gs:708-710`, `OvernightEmailer.gs:1455-1458`, `EmailSweep.gs:35,39-41`, `EmailReroute.gs:44`. |
| One dashboard (DASH-001), tabs beneath it | dashboard-inventory (DOC-004) | Yes | 9 tab panels in one `dashboard.html`. |
| Tests_*.gs and the private file are not cataloged | gs-module-inventory (DOC-007) | Yes | INDEX GS rows = 22 production files. |
| FN significance bar | function-inventory | Yes | Check P verifies the FN names exist. |
| Owner default = the project owner (not TBD) | Governance model / OPEN_ITEMS §A | Yes | check H clean. |
| Prune record-only edges to INDEX exactly (Option A) | reciprocity notes | Yes | check A clean. |
| `LOGIC_AUDIT.md` is frozen, never edited forward | documentation-conflicts C-9 | Yes, enforced | check J. |
| D/E checks advisory (`CATALOG_STRICT=1` to block) | forensic §L | Yes | `test.yml:41-43`. |
| Comment_History / Unmatched 30-day, independent of `reviewed` (2026-09-29) | retention doc / TEAM hand-over §19 | Yes | `InteractionHistoryLogger.gs:191`, `UnmatchedCommentLogger.gs:323`. |
| Checkpoints list only unresolved leads (2026-09-26) | EMAIL_LIFECYCLE amendment | Yes | `SlaEngine.gs:331`. |
| Checkpoint routing frozen at the 17:00 recipients | EMAIL_LIFECYCLE Part 7 | Yes (per design; stored to/cc read back) | Not re-traced line by line. |
| "Never LockService" | EMAIL_LIFECYCLE Part 10 | SUPERSEDED | Lock added by email audit P4 (`EmailInfra.gs:776`). |
| Email audit P1–P13 approved and committed (A1 fail-open lock) | EMAIL_AUDIT §6/§7 | Yes | Commits listed in 2.6. |
| Keep the addresses in git history (no rewrite) | EMAIL_AUDIT §7 | Yes (deliberate) | — |
| RM sync: leavers never removed until told; report-only default; rebuild refuses once applying; first HR tab only | RM_HIERARCHY_NIGHTLY_SYNC | Yes | `RmHierarchySync.gs:18,34`; `RmHierarchy.gs:586-591`. |
| Merge the Lead-History Phase 6 dedup | DB review post-merge note | Yes | `1c19d1a`. |
| P16: core capture first, optional phases (incl. prune) after | EMAIL_AUDIT P16 | Yes; this conflicts with DB review issue #2 | `MovementTracker.gs:722`. |
| Weekly LLM spot-check as the TEST 7 mitigation | E2E report fix #1 | Yes, as of 2026-10-07 | `weekly-spot-check-log.md` cycle 5. |
| DB review Approval Checkpoint 1–9 | DB review Part 12 | Never decided | — |

---

## 5. Documents to archive or mark superseded

**Mark HISTORICAL** and point to `docs/INDEX.md` (frozen snapshots whose counts are wrong today):
- `file-inventory.md`
- `js-module-inventory.md`
- `gs-module-inventory.md`
- `function-inventory.md`
- `tab-inventory.md`
- `sheet-inventory.md`
- `dashboard-inventory.md`
- `integration-inventory.md`
- `button-inventory.md`

**Archive** to `docs/_archive/` or bannered as complete (one-time deliverables of a closed project; their checks now run in `check-catalog.py`):
- `completeness-verification.md`
- `reference-verification.md`
- `reciprocity-normalisation-notes.md`
- `consistency-check.md`
- `handover-coverage-map.md`
- `logic-audit-source-map.md`
- `task-to-component-map.md`
- `documentation-conflicts.md`

**Banner as complete or with corrected status lines:**
- `FORENSIC_COMPLETENESS_AUDIT_BRIEF.md` and `E2E_ACCEPTANCE_TEST_SPEC.md`: their headers still say "NOT YET EXECUTED". Banner them as executed and point to the result documents.
- `FORENSIC_COMPLETENESS_AUDIT_2026-09-10.md`, `E2E_ACCEPTANCE_TEST_REPORT.md`, `REPEAT_OFFENDERS_ARCHITECTURE_REVIEW.md`: HISTORICAL, complete. In the E2E report, note that the log file it cites is gone.
- `DOCUMENTATION_PROJECT_PLAN.md`: mark COMPLETE / HISTORICAL. Keep the Governance Model and the Change-Control Mechanism as the live process description, or move them into `docs/`.
- `DB_ARCHITECTURE_REVIEW.md`: mark Parts 1–12 as an **unapproved, dormant proposal** that later work overtook (new tabs keep going into Sheets). Mark the Lead-History section HISTORICAL (implemented). The owner should decide whether to keep the proposal at all.

**Keep LIVE, but update:**
- `EMAIL_OPS_SYSTEM_AUDIT.md`: correct the "NOT yet live" status line.
- `OPEN_ITEMS.md`: refresh with the October items in §3 above, or retire it in favour of one maintained tracker.
- `_planning/README.md`: list the October documents.
- `EMAIL_LIFECYCLE_TWO_CHECKPOINT_REDESIGN.md`: add a note that Part 10's no-lock stance is superseded by P4.
- `DEAD_CODE_AUDIT_2026-10-03.md`: still has undecided items.

**Keep LIVE as is:**
- `EMAIL_AUDIT.md`
- `RM_HIERARCHY_NIGHTLY_SYNC.md`
- `retention-decisions-needed.md`
- `weekly-spot-check-log.md`
