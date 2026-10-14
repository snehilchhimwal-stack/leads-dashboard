# Sync note for the other Claude account - what changed, what is live, what is pending (2026-10-14)

**Written:** 2026-10-14 ~11:30 IST, by the personal-account Claude session (it signs commits `Co-Authored-By: Claude Sonnet 5.5`), at Snehil's request: "make a file to tell the other Claude account about the current and pending changes and the logic behind them, then it can read and make relevant changes".
**Read this first, then act.** It tells you (1) exactly what the repo, the live Apps Script project and the Sheet look like **right now**, (2) every change since your read-through checkpoint and *why* it was made, (3) what is still pending and who has to do it, and (4) **where every changed file lives**.
**No addresses, tokens or secrets are in this file** (the repo is public).

> **Attribution caveat.** Every commit in this repo carries the same git author (`snehilchhimwal-stack`), so authorship is inferred only from the `Co-Authored-By` trailer: `Claude Opus 5.5` = the sessions that made the Opp Monitor, RM-hierarchy and email commits below (I assume that is your account); `Claude Sonnet 5.5` = this personal-account session; `Claude Sonnet 5` = the weekly cloud spot-check routine. If that is wrong, say so - nothing below depends on it except who needs to be told what.

---

## 1. The baseline and how to check everything yourself

- **Your checkpoint:** `f919d8a` ("Full line-by-line code + documentation audit (read-only)", 2026-10-12 12:40 IST; the audit reports are in `docs/_planning/CODE_AUDIT_2026-10-10/`, summary `00_SUMMARY.md`). It audited code as of `19038e7`.
- **Everything since:** `git log --reverse f919d8a..HEAD` (13 commits) and `git diff f919d8a..HEAD --stat`. HEAD when this was written: `cc0a53b` plus the commit that adds this file.
- **The authoritative live state** is not in git. It was read from the live editor **2026-10-14 ~11:25 IST** by hashing every open file (procedure in `docs/STALENESS_TRACKER.md`; `python3 test/match-live-gs.py`) - result in section 2. `docs/STALENESS_TRACKER.md`'s deploy register was refreshed from it in the same commit as this file.
- **Local test state:** `python3 test/run-gs-tests-headless.py` -> **3,461 passed, 0 failed** (also clean at 8 clock/zone settings). CI on `cc0a53b`: both jobs (`test`, `frontend-harness`) green. Frontend harness: 283 assertions at the last Opp Monitor commit.

---

## 2. Where things stand right now

### 2.1 Live Apps Script project ("Dashboard Google Leads", 48 files, hash-read 2026-10-14 ~11:25 IST)

| State | Files |
|---|---|
| **Live and equal to HEAD** | all 22 production files **except** the four below, i.e. including `RmHierarchy.gs` (at `a3a33a0`, the 13 Oct HR refresh), `OvernightEmailer.gs`, `AllIssuesEmailer.gs`, `FollowupTracker.gs`, `StaleLeads.gs` (all at `e8d33f8`, the 13 Oct email changes), and 20 of the 25 test files (including `Tests_FollowupTracker.gs`, `Tests_StaleLeads.gs` at `e8d33f8`) |
| **BEHIND HEAD - pending paste (Snehil must press Save)** | production: `Core.gs` (live `78e47f5`), `MovementTracker.gs` (live `59db11b`), `InteractionHistoryLogger.gs` (live `78e47f5`), `UnmatchedCommentLogger.gs` (live `78e47f5`) - all four are the 14 Oct `snapshotPeriodic` fix `c590758`. Tests: `Tests_Core.gs`, `Tests_MovementTracker.gs`, `Tests_EmailInfra.gs`, `Tests_EmailLifecycleFullCycle.gs` (the same fix) and **`Tests_RmHierarchy.gs`** (live `ca7802c`; `a3a33a0` added 17 assertions that are not live) |
| Not in git | the private employee table (`RmHierarchy.private.gs`), unchanged |

So **your 13 Oct changes (RM hierarchy, stale-count tile, follow-up tracker rule) are already live**; only my 14 Oct fix and one test file are waiting. **No trigger changed in any of these commits**, so no `setupXxx()` is needed.

### 2.2 Browser side (GitHub Pages)

`dashboard.html` and `js/*.js` go live by themselves a minute or two after a push to `master`. Latest pages build: `cc0a53b` succeeded; `https://snehilchhimwal-stack.github.io/leads-dashboard/js/tab-oppmonitor.js` returns 200. So the Opp Monitor changes (section 3 A, C) are **live now**.

### 2.3 Sheet data written by hand-run sessions (not in git except as CSV copies)

- `Opp_Monitor_Period` / `Opp_Monitor_Month`: rows written/rewritten on 2026-10-12 and 2026-10-13 (section 3 B, C).
- `RM_Hierarchy` / `Manager_Directory`: rebuilt in the live editor on 2026-10-13 15:05-15:10 (two `rebuildRmHierarchy` runs in Executions) after pasting `a3a33a0`.

### 2.4 One open question from today, unanswered

Snehil asked whether the `snapshotPeriodic` 12:44 run picked up the maintenance the 06:08 run skipped. **At 11:24 IST that run had not happened.** After it finishes (~12:50) read the newest row of `Movement_Log_Runs`: `skipped_phases` should be empty and `phase_s` should list the four maintenance steps. (The 06:08 run was *before* the fix and the fix is not live, so the 12:44 run still uses the old code: if it is slow again it can skip again.)

---

## 3. Every change since `f919d8a`, with the logic behind it

### A. Opp Monitor - live figures were wrong (commits `2e33f8d`, `f9d060b`) - **live (Pages)**

Fixes your audit findings **G-5, H-2, H-19, H-20**. The tab's live rows were wrong in two independent ways:
- **G-5:** `opp_at` is a date-typed cell but was missing from `fetchAndRender`'s date-column list, so it arrived as a serial number, parsed to blank for every lead, and every live Opp% read 0.
- **H-2:** live rows were computed from the *filtered* `leads` (the filter bar is hidden on this tab; default last 7 days plus any filter picked elsewhere) with no source scope.

Now live rows use `allParsedLeads`, apply the Google Non-UTM/Search rule (same as `passesGoogleNonUtmSearchGs_`), respect the leads tab's ~7-day window (a partly covered period is tagged "Live - partial (from <date>)", one before the window gets no row), use the earliest `opp_at` across RM copies, render a real 0 as "0" (H-19) and show a checklist notice on a fetch error instead of 12 "Pending" chips (H-20). No change badge is drawn next to a partial row or between an official and a live row (the official Jul/Aug rows used all Google leads and an 18:30-to-18:30 "day").
Files: `js/tab-oppmonitor.js`, `js/core-fetch-and-render.js`, `dashboard.html`, `tests/frontend-harness.html` (+12 assertions; exactly those 12 fail on the pre-fix code). Records: `JS-025`, `JS-003`, `TAB-009`, `DASH-001`, `HANDOVER.md` section 9.7.3 follow-up (3).

### B. Opp Monitor - the data gap and the Sheet rows (commits `2e33f8d` doc, `e06e781`, `d131239`) - Sheet data live

Document: `docs/_planning/OPP_MONITOR_DATA_GAP_2026-10-12.md`. The logic:
- **`homesfy_analytics.dim_leads` omits 15-40% of leads** (it appears to hold only leads that moved past Suspect), so any Opp% that takes its denominator from `dim_leads` is **inflated** (7-25 points). The Sheet's `leads` tab is complete but keeps only ~7 days.
- The original July/August official rows had a **timezone double-shift** (+5h30 on data already in IST), making "same day" run 18:30-to-18:30; midnight-to-midnight IST is 1-5 points lower. 48 h figures are unaffected.
- **Decisions taken by Snehil (2026-10-12):** fix the same-day definition everywhere; scope going forward = Google **Non-UTM/Search**; no catch-up emails for missed periods; official numbers paused until a complete source exists.
- **What was written (2026-10-12):** Sep P1-P3, Oct P1 and the Sep month, then Jul/Aug rewritten with the same method (`source = backfill_mcp`: analytics only, all Google). Previous values kept in `docs/_planning/opp_monitor_jul_aug_original_rows_2026-10-12.csv`; an interim Non-UTM/Search rebuild from the Movement_Log archive is in `docs/_planning/opp_monitor_archive_rebuild_2026-10-12.csv`.
- **No new capture job is needed** for Non-UTM/Search: `snapshotPeriodic` already records `source_bucket` and `opp_at` in `Movement_Log`, and the 7-day prune archives older rows to Drive ("Leads Dashboard Archive/Movement_Log").
- Later note (`d131239`): the first all-leads run, and a coverage exception - on 5 Oct 2026, 61 Google leads (created 13:20-14:24, mostly `website`) never appeared in `Movement_Log` (that day shows 42% coverage; likely a bulk import - not confirmed with the import owner).

### C. Opp Monitor - the "all-leads" method and Search / Non-UTM / Discovery breakdown (commits `4030402`, `1bc1f67`, `eba2752`) - live (Pages) + Sheet data

- `Opp_Monitor_Period`/`Opp_Monitor_Month` gain per-lead-type columns (`search_`/`nonutm_`/`discovery_` x leads, same_day, h48); the read range was widened to `A1:AZ`. Live rows count each type too (Discovery stays out of the headline, which remains Google Search + Non-UTM). New "By Lead Type" table. No change badge between official rows recorded with different `source` values.
- **Standing procedure** (`OPP_MONITOR_DATA_GAP...` section 7, decided 2026-10-13): every official row from **11 Sep 2026** is produced by a Claude session, by hand, once the period has fully closed (last day + 48 h): lead list and `source_bucket` label from the Sheet (`Movement_Log` live + Drive archive), creation/first-Opportunity times from analytics (fallback: first stage change), same-day = midnight-to-midnight IST, **denominator = all leads**, headline = Search + Non-UTM, breakdown columns V:AD, `source = all_leads`. No Apps Script job (decided against).
- **First run (2026-10-13):** Sep P2, Sep P3, Oct P1 written (headline same-day / 48 h: 27.9% / 35.7%, 31.6% / 40.4%, 30.1% / 38.6%).
- Harness +4 assertions (283/283).
- **Left for whoever resumes:** `Opp_Monitor_Month` still has only 18 columns (A-R); its nine breakdown columns must be added **before the first all-leads month row (October 2026)** is written. The next period (Oct P2, 11-20 Oct) can only be written after 22 Oct.

### D. RM hierarchy refresh and a per-RM extra Cc (commits `a3a33a0`, `a6d736a`) - **live**

From the 2026-10-13 HR Live roster, all decisions confirmed by Snehil: 19 joiners added (e.g. Sanket Patil TM; Hitesh Choudhary A1; Vishal Singh, Suryapratap Singh, Rushikesh Nigade, Danish Shaikh, Sanjay Verma in Loan, others); 6 leavers removed (Pratapkumar Yadav, Sonam Dubey, Saravash Upadhyay, Adil Shaikh, Narayan Dhimar, Vemula Ajay - his 9 reports now sit under Zoya Fathima); manager moves (Zeya Shaikh -> Sachin Rana, Nagmma Mujnayak -> Firoj Shaikh, Ajay Gupta/Shruti Sharma -> Sanket Patil, Buddhabhushan Wakode/Vijay Kshirsagar -> Hitesh Choudhary, Aarya Sadanam -> Manisha rathod); aliases (Mohd Shaikh, Mukesh Mishra Admin); "Jay Renaviker" kept as HR's new spelling of Jay Renavikar.
**New logic - `EXTRA_CC_FOR_RM_` (`RmHierarchy.gs`, `CFG-123`):** a per-RM Cc applied in `resolveRecipientBucketsForRms_` **after every override** (including the restricted-cc one), so Aarya Sadanam's emails go to Manisha rathod with Snehil Chhimwal and Neha Mishra in Cc (a Cc that survives Manisha's "Snehil only" restriction). Tests: +17 assertions in `Tests_RmHierarchy.gs` (**not live yet** - section 2.1).
Files: `RmHierarchy.gs`, `Tests_RmHierarchy.gs`, `docs/gs-modules/GS-011-rmhierarchy.md`, `docs/INDEX.md`. Note: the nightly sync (`RmHierarchySync.gs`) was report-only as of 2026-10-09; this refresh was done by hand with `test/refresh-rm-hierarchy.py`-style review, not by the sync.

### E. Emails - stale count tile and the follow-up tracker rule (commit `e8d33f8`) - **live**

- **Stale-count tile (`StaleLeads.gs`, `applyStaleSplitGs_` + `staleLeadCountGs_` + `staleCountNoteGs_`):** an email that moves stale leads (D8) to the bottom block now says so next to the headline count and in the plain-text summary. Real case, 2026-10-13: one manager's 10:00 and 13:00 emails said "2 Leads Still Unresolved" over a table of 1 - the second was in the stale block further down. The headline still counts every lead (stale ones are still in the email); a second tile reads "1 of these is stale - listed at the bottom". `AllIssuesEmailer.gs` and `OvernightEmailer.gs` call it instead of `splitStaleSectionsGs_` directly.
- **Follow-up tracker (`FollowupTracker.gs`):** once Checkpoint 1 is NOT_NEEDED, Checkpoint 2 is NOT_NEEDED too **unless a 13:00 email really went out** (ACCEPTED, or a log stamp -> COMPLETED). The 13:00 job only replies to buckets the 10:00 job sent, so for a bucket with nothing left after 17:00 it normally records nothing, and that silence used to read as OVERDUE (false alarm 2026-10-11/12). Decided by Snehil 2026-10-13.
- Tests: `Tests_StaleLeads.gs` (+19 lines), `Tests_FollowupTracker.gs` (+29 lines).
- **Documentation not yet revalidated for this commit:** `check-staleness.py` flags `GS-001`, `GS-010`, `GS-020`, `GS-021` (`Last Verified` is behind `e8d33f8`). `HANDOVER.md` section 4.3.5 (stale leads) and the tracker description do not mention the tile or the new rule. **This is work you can do** (section 5).

### F. Weekly doc spot-check, cycle 6 (commit `270efaa`, the scheduled cloud routine, Sonnet 5)

Re-read `SHEET-005`, `SHEET-012`, `JS-010`, `DATA-003`, `DATA-005` against source; fixed four drifted line anchors; re-confirmed `DATA-005`'s HIGH Loan-region finding is still open. Docs only (`docs/_planning/weekly-spot-check-log.md` has the entry).

### G. `snapshotPeriodic` slowness (commits `c590758`, `cc0a53b`) - **committed, tested, NOT live**

Full write-up: `HANDOVER.md` section 4.3.4 **P19**, `docs/gs-modules/GS-008-movementtracker.md` (FN-439, FN-440) and `GS-002-core.md` (FN-438), `docs/STALENESS_TRACKER.md` sweep log. In short:
- **Incident:** the 14 Oct 06:08 run took 946 s and skipped its four maintenance steps (Movement_Log prune, Comment_History prune, Unmatched_Comments_Log prune, Daily_Cohort_History persist). From `Movement_Log_Runs.phase_s` (all runs since 9 Oct) and the run's `[timing]` log: the leads-tab read (6 s) and the Movement_Log hash read (35 s) were normal, but **every per-lead step ran 3-10x slower than its median** (core capture 266 s vs 88; SLA_History write 261 vs 75; Unmatched scan 56 vs ~14; Comment_History log 360 vs 61). Those loops make tens of thousands of `Utilities.formatDate` **service calls** per run (~20k hashing the leads; ~50k computing SLA flags - two per lead plus one per dated comment entry, ~28,000 entries in the tab; one per existing Comment_History / Unmatched row), so a platform whose per-call latency rises multiplies exactly that work. Not data volume (7,326 leads, 655 changed). 4 of 21 runs since 9 Oct took over 600 s. Related, unfixed: `captureDailyRmIssues` timed out at 1,802.9 s on 13 Oct 22:53 (and 9 Oct).
- **Changes:** (1) `istFormatGs_` (`Core.gs`) formats IST dates by arithmetic, byte-identical to `Utilities.formatDate` (inputs outside 1946..9999, invalid, non-Date or another pattern fall back to the service); `istDayKeyGs_`, the content hash's three date fields and the two comment-log dedup loops use it, so **no lead's hash changes and nothing re-appends**; `_leadContentHashViaServiceGs_` keeps the old hash as a **reference-only** function for tests and the benchmark. (2) Read-only `benchmarkSnapshotCostNow()` proves formatter, hash and SLA flags against the REAL service on ~1,000 real leads and prints per-call/per-lead cost. (3) `phase_s` core entry now reads `... [read Ns, hash lookup Ns, hashing Ns, append Ns]`. (4) Maintenance skipped for budget is **owed** (Script Property `SNAPSHOT_MAINTENANCE_OWED`); the next run does it straight after the core capture, before the SLA/comment steps. (5) The watchdog (`snapshotRunProblemsGs_`) is silent on a single maintenance skip and alerts when a data step was skipped or maintenance has been owed for 2 runs / 12 h. (6) `businessMinutesBetweenGs_` now advances forward-only and stops after 4,000 passes (it would loop forever if a day key were ever wrong at a day boundary - found because the formatter mutation tests hung instead of failing).
- **Not changed on purpose:** the 840 s budget; the trigger set (19 of the 20 triggers Google allows per user per script are in use, so the job was not split in two).
- **Tests:** +91 assertions (3,461 pass); 23 one-at-a-time regressions all caught; clean at `--tz UTC`, around IST midnight, a Saturday, Los Angeles.
- **Effect on your audit reports:** their line numbers for `Core.gs`, `MovementTracker.gs`, `InteractionHistoryLogger.gs`, `UnmatchedCommentLogger.gs` (and for the files changed in D and E) are now off; the findings themselves are unchanged. Audit item A-5/E notes on the 840 s start-gate still hold.

### H. Documents this session also changed

- `docs/TEAM_CLAUDE_HANDOVER.md` (the hand-over written 2026-10-10): added the 14 Oct incident rows (snapshot slowness; `captureDailyRmIssues` timeouts), the reference-only `_leadContentHashViaServiceGs_` to the dead/dormant register (section 18.2), the post-paste benchmark and the 12:44 check to section 21.1, and an open item in 21.3.
- `docs/STALENESS_TRACKER.md`: a sweep-log entry for G, and **the deploy register refreshed from the live read** (22 rows).
- `HANDOVER.md`: header unchanged; §4.3.4 P19 and a §8 bullet added.

---

## 4. Where the changed files are

**Local repo root:** `C:\Users\User\Desktop\Strategy\Google leads Dashboard\` (git remote `https://github.com/snehilchhimwal-stack/leads-dashboard`, branch `master`). **GitHub file view:** `https://github.com/snehilchhimwal-stack/leads-dashboard/blob/master/<repo path>`. **Live Apps Script copy:** the Sheet's *Extensions -> Apps Script* project "Dashboard Google Leads" (owner Sakshi Sonawane; files carry the same names as the repo `.gs` files; **not auto-synced from git**). **Sheet:** `https://docs.google.com/spreadsheets/d/1QmYB1VqLMisiQXoed6-vSQqgA9nroGIMHsBInZafKGU/edit`. **Dashboard:** `https://snehilchhimwal-stack.github.io/leads-dashboard/dashboard.html`.

### 4.1 Code files

| Repo path | Changed in | What | Live? |
|---|---|---|---|
| `js/tab-oppmonitor.js` | `2e33f8d`, `4030402` | Opp Monitor live-row fixes; all-leads breakdown, By Lead Type table | **Live (Pages)** |
| `js/core-fetch-and-render.js` | `2e33f8d` | `opp_at` added to the date-column list | **Live (Pages)** |
| `dashboard.html` | `2e33f8d`, `4030402` | Opp Monitor scope text / table container | **Live (Pages)** |
| `tests/frontend-harness.html` | `2e33f8d`, `4030402` | +12 and +4 assertions (283 total) | CI job `frontend-harness` |
| `RmHierarchy.gs` | `a3a33a0` | HR refresh + `EXTRA_CC_FOR_RM_` | **Live** (hash-matched at `a3a33a0`) |
| `Tests_RmHierarchy.gs` | `a3a33a0` | +17 assertions | **PENDING paste** (live is `ca7802c`) |
| `OvernightEmailer.gs`, `AllIssuesEmailer.gs` | `e8d33f8` | use `applyStaleSplitGs_` | **Live** (`e8d33f8`) |
| `StaleLeads.gs`, `Tests_StaleLeads.gs` | `e8d33f8` | tile + count helpers | **Live** |
| `FollowupTracker.gs`, `Tests_FollowupTracker.gs` | `e8d33f8` | NOT_NEEDED rule | **Live** |
| `Core.gs` | `c590758` | `istFormatGs_`, forward-only `businessMinutesBetweenGs_` | **PENDING paste** (live `78e47f5`) |
| `MovementTracker.gs` | `c590758` | owed-first maintenance, watchdog policy, timing breakdown, `benchmarkSnapshotCostNow` | **PENDING paste** (live `59db11b`) |
| `InteractionHistoryLogger.gs` | `c590758` | dedup read uses `istFormatGs_` | **PENDING paste** (live `78e47f5`) |
| `UnmatchedCommentLogger.gs` | `c590758` | same | **PENDING paste** (live `78e47f5`) |
| `Tests_Core.gs`, `Tests_MovementTracker.gs`, `Tests_EmailInfra.gs`, `Tests_EmailLifecycleFullCycle.gs` | `c590758` | tests for the above | **PENDING paste** |

**Copies outside the repo:** `C:\Users\User\Downloads\Google Leads Dashboard - snapshotPeriodic slowness fix (2026-10-14)\` holds the 8 files of `c590758` (`Core.gs`, `MovementTracker.gs`, `InteractionHistoryLogger.gs`, `UnmatchedCommentLogger.gs`, `Tests_Core.gs`, `Tests_MovementTracker.gs`, `Tests_EmailInfra.gs`, `Tests_EmailLifecycleFullCycle.gs`). `Tests_RmHierarchy.gs` has no Downloads copy - take it from the repo. Also in `C:\Users\User\Downloads\` and dated 12-13 Oct (presumably from the Opp Monitor work; I did not create them): `Opp-Monitor-Report OCT.pdf`, `old data Opp-Monitor-Report-2026-10-12.pdf`, `Discovery Opp-Monitor-Report-2026-10-13.pdf`, `loan not mentioned Opp-Monitor-Report-2026-10-13.pdf`, `Google-Leads-Oct5-Burst-2026-10-05.xlsx`, and three `Movement_Log_rows_..._archived_...csv` files (Drive archive downloads used for the rebuild).

### 4.2 Documents and data copies

| Repo path | Changed in | What |
|---|---|---|
| `docs/_planning/OPP_MONITOR_DATA_GAP_2026-10-12.md` | `2e33f8d`, `e06e781`, `d131239` | the data gap, the reconstructed method, decisions, standing procedure (sections 1-7) |
| `docs/_planning/opp_monitor_jul_aug_original_rows_2026-10-12.csv`, `docs/_planning/opp_monitor_archive_rebuild_2026-10-12.csv` | `e06e781` | before/after copies of Sheet rows |
| `docs/_planning/opp_monitor_no_loan_rows_2026-10-13.csv` | **untracked** | present in the working tree, never committed - decide whether to commit or delete |
| `docs/js-modules/JS-025-tab-oppmonitor.md`, `JS-003-core-fetch-and-render.md`, `docs/tabs/TAB-009-opp-monitor.md`, `docs/dashboards/DASH-001-leads-dashboard.md`, `docs/sheets/SHEET-016`/`SHEET-017` | `2e33f8d`, `f9d060b`, `4030402`, `1bc1f67`, `eba2752` | Opp Monitor records (revalidated) |
| `docs/gs-modules/GS-011-rmhierarchy.md` | `a6d736a` | CFG-123 `EXTRA_CC_FOR_RM_`, 13 Oct refresh |
| `docs/gs-modules/GS-002-core.md`, `GS-006-interactionhistorylogger.md`, `GS-008-movementtracker.md`, `GS-013-unmatchedcommentlogger.md` | `c590758`, `cc0a53b` | FN-438/439/440, CFG-124/125, change notes |
| `docs/INDEX.md` | several | `Last Verified` cells |
| `HANDOVER.md` | `2e33f8d`, `c590758` | section 9.7.3 follow-up (3); section 4.3.4 P19 and a section 8 bullet |
| `docs/STALENESS_TRACKER.md` | `c590758` + this commit | sweep-log entry; deploy register refreshed from the live read |
| `docs/TEAM_CLAUDE_HANDOVER.md` | this session | 14 Oct additions (see H) |
| `docs/_planning/weekly-spot-check-log.md`, `docs/sheets/SHEET-005`/`SHEET-012`, `docs/data-flows/DATA-003`/`DATA-005` | `270efaa` | cycle 6 |
| `docs/_planning/SYNC_FOR_OTHER_CLAUDE_ACCOUNT_2026-10-14.md` | this commit | this file |

### 4.3 Sheet tabs and Script Properties touched by the work above

`Opp_Monitor_Period`, `Opp_Monitor_Month` (rows written/rewritten 12-13 Oct; breakdown columns V:AD in Period; Month still A-R), `RM_Hierarchy`, `Manager_Directory` (rebuilt 13 Oct), `Movement_Log_Runs` (new `phase_s` format once the fix is pasted; the 12:44 row is the one to read), `Script Properties` (`SNAPSHOT_MAINTENANCE_OWED` appears only after the fix is live and a run skips maintenance).

---

## 5. What is pending, in order, and who does it

| # | Pending | Who | Notes |
|---|---|---|---|
| 1 | Paste + save the 9 files in section 4.1 marked PENDING (8 from the Downloads folder + `Tests_RmHierarchy.gs` from the repo) | **Snehil** (the Save press is his; agents are blocked from Save and from running `setupXxx()`). The staging procedure (`file_upload`, dry run, `pushEditOperations`, hash re-read) is in `docs/STALENESS_TRACKER.md` | no trigger changes |
| 2 | Run `benchmarkSnapshotCostNow()` **once** after the paste and read the Execution log: every `RESULT` mismatch count must be 0 and it must print PASS; confirm in Executions that it was the function that ran (the editor's Run button lags one selection) | Snehil / a session with him | read-only |
| 3 | Run `runAllTests()` live; read the per-suite lines (last live total 3,340 before the 10-12/13 changes) | Snehil | |
| 4 | Read the 12:44 `Movement_Log_Runs` row (section 2.4) and the first run after the paste | any session | |
| 5 | Revalidate `GS-001`, `GS-010`, `GS-020`, `GS-021` for `e8d33f8`; add the stale tile and the NOT_NEEDED rule to `HANDOVER.md` section 4.3.5, the operating manual and `OPS_CHECKLIST.md` if relevant; run `check-catalog.py`, `check-staleness.py` | **you** | docs only |
| 6 | Update your audit reports' line references / mark findings G-5, H-2, H-19, H-20 as fixed by `2e33f8d` (`CODE_AUDIT_2026-10-10/`) | **you** | |
| 7 | Add the nine breakdown columns to `Opp_Monitor_Month` before writing October's all-leads month row; write Oct P2 after 22 Oct | the session that runs the Opp Monitor procedure | needs the Homesfy MCP - **never call it without Snehil's per-instance confirmation** |
| 8 | Commit or delete the untracked `docs/_planning/opp_monitor_no_loan_rows_2026-10-13.csv` | you / Snehil | |
| 9 | Decisions waiting for Snehil (none made yet): retire `Daily_RM_Issues` + `captureDailyRmIssues` (nothing reads it; it timed out 13 Oct and 9 Oct); whether a reply to a report email should change anything; the 17:30 bounce-check slot and 10-minute minimum email age (my assumptions); whether the nightly RM-hierarchy sync apply is switched on; who the triggers run as | Snehil | all in `docs/TEAM_CLAUDE_HANDOVER.md` section 21.2 |
| 10 | Overdue chores (`check-staleness.py` section E): `Movement_Log` dedup health (last 2026-09-25), `leads` header vs `HEADER_ALIASES` (last 2026-09-22) | any session | |

---

## 6. Rules to keep (unchanged - they come from Snehil)

Commit and push each finished change and copy changed files to Downloads; ask before big autonomous work; audit-plan-approve before code on audit tasks; no HTML artifact edits until content is settled in chat; never query the Homesfy MCP without a fresh yes; never press Save or run `setupXxx()` on the live project yourself; test emails only to the maintainer's three plus-addresses; dates are IST; update `HANDOVER.md` and the records **in the same commit** as an architectural change; never leave `(pending commit)` as a final `Last Verified`. Full list: `docs/TEAM_CLAUDE_HANDOVER.md` sections 3-4.

## 7. What I could not verify

- Who authored what (section 0 caveat).
- The content of the Opp Monitor Sheet rows beyond what the commit messages and `OPP_MONITOR_DATA_GAP_2026-10-12.md` state (I did not open `Opp_Monitor_Period`/`Month`).
- Whether the 13 Oct HR refresh's `rebuildRmHierarchy` runs (Executions 15:05 and 15:10) completed with a clean coverage audit - I saw only that they ran and completed.
- That the 12:44 `snapshotPeriodic` run will complete inside its budget.
