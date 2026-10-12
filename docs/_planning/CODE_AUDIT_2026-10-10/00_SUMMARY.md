# Full code + documentation audit — summary (2026-10-10 → 2026-10-12)

**Scope.** Every line of the production code at HEAD `19038e7` (22 `.gs` files + the private table's structure, `dashboard.html`,
25 `js/*.js` — about 33k lines / 3.2 MB) and every documentation file (166 `.md`, about 2.9 MB), read by 15 auditors. Read-only: no code
was changed, nothing live was touched. Test files (`Tests_*.gs`, `tests/frontend-harness.html`) were not audited line by line.

**Backup taken first:** tag `backup/2026-10-10-pre-audit` (pushed), plus a folder zip and a full-history git bundle in
`C:\Users\User\Desktop\Strategy\Leads Dashboard Backups\` (local only — the zip holds `RmHierarchy.private.gs`).

| File | Covers |
|---|---|
| [A](A_core_logic_gs.md) | `Core.gs`, `SlaEngine.gs`, `FollowupEngine.gs`, `StaleLeads.gs` |
| [B](B_email_infra_gs.md) | `EmailInfra.gs`, `EmailLedger.gs`, `EmailReroute.gs` |
| [C](C_overnight_emailer_gs.md) | `OvernightEmailer.gs` (10:00 + 13:00) |
| [D](D_allissues_and_email_ops_gs.md) | `AllIssuesEmailer.gs` (17:00), `CycleReport.gs`, `EmailSweep.gs`, `OpsAudit.gs`, `DailyChecklist.gs`, `FollowupTracker.gs` |
| [E](E_capture_and_logs_gs.md) | `MovementTracker.gs`, `DailyRmIssueLog.gs`, `UnmatchedCommentLogger.gs`, `InteractionHistoryLogger.gs`, `LeadFollowupsStaleness.gs` |
| [F](F_rm_hierarchy_and_ops_gs.md) | `RmHierarchy.gs`, `RmHierarchySync.gs`, `OpsChecklistRunner.gs` |
| [G](G_dashboard_core_js.md) | `dashboard.html`, `js/core-*.js`, worker, `main.js` |
| [H](H_dashboard_tabs_js.md) | every tab file, Overview/Operations, Repeat Offenders PDF |
| [I](I_reports_and_writeback_js.md) | `js/reports-*.js`, `js/sheets-writeback.js` |
| [J](J_logic_audit_md_review.md) | `LOGIC_AUDIT.md` claim by claim |
| [K](K_catalog_index_and_gs_records.md) | `docs/INDEX.md`, `RELATIONSHIP_MAP.md`, guides, all GS records |
| [L](L_catalog_js_and_tab_records.md) | all JS, TAB, DASH records |
| [M](M_catalog_sheets_flows_integrations.md) | all SHEET, DATA, EXT, FLOW records, trigger list — includes the full tab map |
| [N](N_top_level_docs_review.md) | `HANDOVER.md`, `CLAUDE.md`, `OPS_CHECKLIST.md`, `TEAM_CLAUDE_HANDOVER.md`, operating manual, tracker |
| [O](O_planning_docs_status.md) | `DOCUMENTATION_PROJECT_PLAN.md` + all `docs/_planning/` — status of every plan item, decisions register |

Each code file walks every function in file order (what it does, callers, sheets touched, time-zone handling); start there for depth.

---

## 1. How the system works — the one-page version

Two runtimes share one Google Sheet and never call each other:

- **Dashboard** (browser, GitHub Pages): sign in (`core-auth.js`) → read the `leads` tab with the Sheets API as raw values
  (`core-sheets-fetch.js`) → parse with `HEADER_ALIASES` → collapse a customer's several RM rows into one record (`core-collation.js`,
  `fetchAndRender`) → filter (shared bar, default *last 7 days*) → `enrichLead` computes stage, the 5 SLA flags and funnel position
  (`core-lead-model.js`) → `renderAll` renders every tab once. Movement_Log is fetched alongside and feeds Movement, Tracking, RM Timeline,
  and the RM-performance engine (Repeat Offenders, in a Web Worker). Write-backs: snapshots, `Lead_Followups`, `SLA_History`,
  `Daily_Cohort_History`, `Feature_Usage`, `Send_Log`; region emails via a separate Gmail grant.
- **Apps Script** (19 time triggers, all in IST):

| Time (IST) | Job | Writes |
|---|---|---|
| 00:00 / 06:00 / 12:00 / 18:00 | `snapshotPeriodic` — content-hash capture of every lead that **changed**, then optional phases (SLA_History, comment loggers, prunes + Drive archive, cohort history) | `Movement_Log`, `Movement_Log_Runs`, `SLA_History`, `Comment_History`, `Unmatched_Comments_Log`, `Daily_Cohort_History` |
| 10:00 | `sendOvernightMorningEmails` — Section 1 overnight leads + Section 2 *Checkpoint 1* on yesterday's 17:00 report, one email per recipient bucket | `Overnight_Log`, `AllIssues_Log` checkpoint 1, ledger |
| 10:30 / 13:30 / 17:30 | bounce-only sweeps (→ re-route on bounce) | ledger bounce cols, `Email_Reroutes` |
| 11:15 / 14:00 / 18:00 | silent audits: ledger vs working logs, one alert only on disagreement | Script Property |
| 13:00 | `sendOvernightFollowupEmails` — *Checkpoint 2* threaded reply, waits ~100 s for human suggestions | `Lead_Followups`, `Overnight_Log`, `AllIssues_Log` |
| 15:30 | full bounce + reply sweep | ledger |
| 16:30 | cycle report to ops: emails by status, exclusions, incidents, checklist A–K, follow-up tracker | `Daily_Report`, `Daily_Checklist`, `Followup_Tracker` |
| 17:00 | `sendAllIssuesEmails` — 5 SLA checks, Google Non-UTM/Search leads of the last 3 days, per bucket | `AllIssues_Log`, `Email_Ledger(_Exclusions)` |
| 22:50 | `captureDailyRmIssues` (nobody reads this tab any more) | `Daily_RM_Issues` |
| 23:15 | HR-roster → `RM_Hierarchy` sync (report-only) | backups, report email |
| hourly | watchdog: job run records, held alerts, config problems | `Incident_Log` |
| Mon ~09:00 | weekly ops checklist email | — |

Every report email passes one gate (`sendGuardedEmailGs_`), runs under one script lock, leaves a run record, and is recorded
PLANNED → ATTEMPTING → ACCEPTED/FAILED/UNCONFIRMED/BLOCKED in `Email_Ledger`; alerts raised inside a job are held until the job ends.
Routing: RM → `RM_Hierarchy` chain (tl → tm → rh → ch) → `Manager_Directory` address, with Futwork, loan-team, restricted-Cc,
leadership-Cc and P&L-head-Cc overrides and the `Region_Recipients` / CH-level fallbacks (F §3 has the full walk-through).

## 2. The one systemic problem

**`Movement_Log` changed meaning and most of its readers were not told.** Since the content-hash dedup (2026-09-25/26) a run writes a row
only for a lead whose tracked content changed; before, every run wrote every lead. Readers that still assume "one row per lead per run/day":

- the RM-performance engine, both runtimes (G-1, E-5): an untouched lead is observed only on days it changed, so neglect — what the
  score exists to catch — is under-measured, and *Stuck 48h+* is almost never seen;
- Tracking: issue counts per run, From/To cohort comparison, Week-over-Week (H-1, H-3);
- the stale-lead block: the 7-day prune deletes a quiet lead's only row, the next run re-adds it stamped *now*, so it drops out of the
  block for ~30 h and returns with the wrong "stale since" (A-1, E-1);
- both `Daily_RM_Issues` backfills rebuild only the changed fraction, then the per-day guard blocks a correct refill (E-2);
- related: several RMs' copies of one lead collapse into one history (G-2, E-6).

Found independently by four auditors. HANDOVER §9.7.3 had flagged it as "worth checking, not confirmed".

## 3. Code findings, ranked

✔ = re-checked against the code by the coordinating session. Full text, scenarios and line refs are in each lettered file.

**HIGH**
| Id | Finding |
|---|---|
| G-1 / E-5 / H-1 / H-3 / A-1 / E-1 / E-2 ✔ | §2 above |
| D-1 ✔ | `CycleReport.gs:40-45` — a 16:30 trigger that fires before 16:30 (nearMinute fires 16:15–16:45) makes the window start two days back: the report covers ~48 h and repeats yesterday's emails |
| D-2 / B-2 ✔ (logic; confirm on one real bounce) | Bounce matching is "any To/Cc address appears anywhere in the bounce text". Gmail bounces quote the original headers, so one bounce can mark other emails bounced and mark healthy Cc addresses (leadership, RH) dead → replaced by their manager for 14 days |
| H-2 ✔ | Opp Monitor "Live" rows are computed from the filtered `leads` (default last 7 days, plus any project/region filter) while the filter bar is hidden on that tab |
| G-5 ✔ (logic; confirm the cell type) | `opp_at` is not in the dashboard's date-column list; read as a raw serial number it parses to blank. If the sheet stores it as a real date, every live Opp% is 0 |

**MEDIUM**
| Id | Finding |
|---|---|
| C-3 ✔ | 10:00 job: an error resolving one region stops every later region (no per-region try), then the crash alert says *nothing* was sent |
| D-7 / D-8 | 17:00 job: a mid-loop death leaves the unreached regions invisible to recovery; its crash alert is also false |
| F-1 ✔ | P&L-head Cc is added after the loan-team "no Cc" and Pre-Sales "Snehil only" overrides, defeating them in Hyderabad/Bangalore/Thane/Navi Mumbai |
| B-5 | A re-sent bounced email goes again to every original Cc |
| B-1, B-3, D-3, D-4, D-5 | Held alert lost if its `Incident_Log` write failed; ledger appends from the sweep race the email jobs; sweep writes by row number that a prune can shift; a BOUNCED status can be downgraded and re-alerted |
| D-6 | A 17:00 recovery run re-sends every region's "Leads NOT sent" alert |
| C-1, C-2 | "(typed Xh ago)" caption never shows the real age; a TEST MODE 13:00 run writes production `Lead_Followups` |
| M (Lead_Followups) / I-7 / J-2 | 13:00 job reads all `Lead_Followups` rows and rewrites them (incl. human column F) — a human edit in between is lost; the dashboard's Generate clears the tab while the backend may be waiting on it |
| E-3 (suspected, high confidence) | `Daily_Cohort_History` write-once check compares the date as text; Sheets has likely made it a Date, so finished days are recomputed and overwritten every 6 h |
| F-2…F-6 | Watchdog rarely sees a missed 23:15 sync; a post-write sync failure is reported as "NOT changed"; blank-in-tab tiers never detected; alias rows never refreshed; hand-made rows cannot opt out |
| A-2 / G-6 | Closing-reason fallback is a substring match ("Booked elsewhere" → Booking / Opp+), both runtimes |
| G-3, G-4 | Loading overlay stuck after a failed re-auth; sign-in hangs if the Google popup is closed |
| H-4, H-5, H-6 | `evidenceAtDeadline` live fallback returns undefined and Tracking hits it; "All Regions" totals include hidden rows; every filter change re-runs the heaviest work |
| I-1, I-2, I-3 | Browser snapshot writes merged-customer records; the unbounded follow-up wait outlives the OAuth token; a stashed Gmail send can fire later unasked |
| J-1 | Loan-region override still has no `.gs` twin (re-rated from HIGH: only Google leads reach the emails, loan RMs route to the loan head) |
| J-3 | "Snapshot Now" has no re-entrancy guard; two overlapping runs both write full batches |

**LOW / INFO** — about 120 more (stale comments, dead code, UTC-stamped filenames, CSV escaping, IST labels on local times, the
`A1:Z` 26-column ceiling for Movement_Log in the browser (E-10), no `inTimezone` on the 10:00/13:00 triggers, `CONFIG.MIN_CALLS_AFTER_48H`
= 10 shown vs 5 used, …). See each file's Findings section.

**Checked and fine:** cross-runtime parity of the 31 outcome rules, SLA thresholds, flag rules, issue priority, region map, Movement_Log
schema and the send-gate address regex (`check-runtime-parity.py`: only the two intended browser-only header aliases differ); no XSS gap in
the core JS; every function name the top-level docs cite exists.

## 4. Documentation findings

- **Code-to-record coverage is complete** (every `.gs` and `js` file has a record; `check-catalog.py` A–P pass), but the **content** has
  drifted: GS records 5 materially wrong / 10 minor (K); JS+TAB 12 materially wrong (L); SHEET 7 materially wrong, both FLOW records wrong (M).
  The checks pass because none compares a record with its own INDEX row, the anchor checker skips prose/RULE/EXC rows, and the Email Ops
  records carry no anchors at all (K §3–4).
- **Wrong in a way that could cause harm:**
  - `HANDOVER.md` §4.3.5 still says the Email Ops tabs "create themselves on the first run" — the exact behaviour that crashed the 10 Oct 17:00 run.
  - `precreateEmailOpsTabsNow()` is missing from the §4.3 setup table.
  - `OPS_CHECKLIST.md` says to confirm `OPS_ALERT_EMAIL_`/`CH_LEVEL_EMAIL_`, which have been blank by design since P13.
  - `docs/architecture/apps-script-triggers.md` lists 10 of 19 triggers.
- **Stale status lines:**
  - `HANDOVER.md` "Not live until pasted" and "13 production .gs files" (also in `CLAUDE.md`).
  - The operating manual says "nothing is live".
  - `EMAIL_OPS_SYSTEM_AUDIT` says "not yet live"; the forensic and E2E specs say "not yet executed".
  - `HANDOVER.md` §9.7.1 says "Below Expectations only"; the tables show all rankable rows.
  - §5's tab table is missing 9 tabs and still names Repeat Offenders as a reader of `Daily_RM_Issues`.
- **Historical, should be marked so:**
  - the nine September inventories in `docs/_planning/`;
  - most of `LOGIC_AUDIT.md` Parts 1 and 7 — it also has one wrong finding: the backend never clears `Lead_Followups` (J);
  - `RELATIONSHIP_MAP.md` (10 Sep, no Email Ops).
- **Process trail stopped on 10 Sep:** no `docs/changes/` or `docs/validation/` entries since; `OPEN_ITEMS.md` not maintained;
  `check-staleness.py` reports 0 stale facts only because just 4 facts are registered.
- `TEAM_CLAUDE_HANDOVER.md` is the most accurate document (but its "~110 vs ~30 outcome rules" is wrong — both have 31).

## 5. Open decisions and items (from O, J, E, F)

1. Retention: 7 tabs still TBD (Send_Log, AllIssues_Log, Overnight_Log, SLA_History, Daily_Cohort_History, Lead_Followups, leads) and 6 newer
   tabs have no prune at all (Movement_Log_Runs, Followup_Tracker, Daily_Checklist, Incident_Log, Daily_Report, Email_Reroutes) — against the
   10M-cell workbook limit.
2. RM-hierarchy sync: still report-only — switch to apply?
3. First live runs of the Email Ops jobs and the snapshot speed-up were never recorded as checked.
4. CH-level-diverted leads get no 10:00/13:00 follow-up.
5. Dead code awaiting a decision: `sendOneOvernightEmail_`, `collatedCountLabel`, `sortRmPerformanceByPriority`, `rmPerformanceDrivenBy`,
   JS `MOVEMENT_LOG_RUNS_COLUMNS`, `.hover-row`, the design mockup; `Daily_RM_Issues` itself (written nightly, read by nothing);
   `SLA_History` (written on every refresh, read by nothing).
6. The untracked `working files on 28th…` folder holds an old hard-coded ops address — delete?
7. The database-migration proposal (`DB_ARCHITECTURE_REVIEW.md`) — never approved, nothing built: keep or drop?
8. `TEST_MODE_OVERRIDE_EMAIL` remains a footgun (only an alert).

## 6. Facts to check live before fixing (read-only)

| Question | Settles |
|---|---|
| Is `leads!opp_at` a real date cell or text? | G-5 |
| Does `Email_Reroutes` already hold rows for addresses that never bounced? Open one real bounce in the sending mailbox | D-2 |
| Do `Daily_Cohort_History` rows' `updated_at` keep changing for old days? | E-3 |
| How many lead ids carry more than one RM in `Movement_Log`? | G-2 / E-6 size |
| What are the real `closing_reason` values? | A-2 / G-6 |

## 7. Proposed order of work (for approval — nothing has been changed)

1. **Live checks of §6** (read-only, minutes).
2. **Email-path correctness:** D-2 (bounce matcher: use the bounce's own failed-recipient line, never re-route a Cc not named as failed),
   D-1 (cycle window), C-3 + D-7/D-8 (per-region isolation, truthful crash alerts), F-1 (P&L Cc after overrides), B-5, C-2.
3. **The Movement_Log census problem (§2):** one design decision — either make readers carry each lead forward from its last row
   ("last observation carried forward"), or write a cheap per-run heartbeat — then fix the RM-performance engine (both runtimes), Tracking,
   the stale-lead prune interaction and the backfills against it.
4. **Dashboard:** H-2 (use `allParsedLeads`), G-5, G-3/G-4, H-4.
5. **Docs:** the harmful-if-followed items in §4 first, then the trigger index, HANDOVER §1/§4.3/§4.3.5/§5/§9.7.1, `OPS_CHECKLIST.md`, the
   operating manual, then the catalog record drift (K/L/M fix lists).
6. Decisions in §5.

Each fix follows the project's own rules: tests in the same commit, `check-runtime-parity.py` for twin logic, headless run at awkward
clock times, paste + hash-verify to the live project.
