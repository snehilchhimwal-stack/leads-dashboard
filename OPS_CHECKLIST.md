# OPS_CHECKLIST.md — the important-process checklist

**Why this exists:** lead 2229674 (reported 2026-09-09, "in Follow-up despite
being an Opportunity") turned out to be caused by a stale `Lead_Followups`
snapshot row, not a code bug — but reading the code during that
investigation surfaced a real, separate hardening gap in `isOppOrAbove`/
`isOppOrAbove_` (fixed the same day). The lesson wasn't "fix that one gap"
— it was "this project has several places where a silent, slow-drifting
gap can sit undetected between real incidents." This file is the answer:
one place naming every important recurring check across the three systems
most exposed to that risk — **automatic email** (`OvernightEmailer.gs`,
`AllIssuesEmailer.gs`), **RM hierarchy routing** (`RmHierarchy.gs`), and
**worst-performing-RM identification** (RM Performance /
`DailyRmIssueLog.gs`) — so a run doesn't forget anything, whether the
"someone" running it is a person or Claude.

Scope and structure defined under CHECKLIST-004 (To-Do Dashboard,
2026-09-09); content built under CHECKLIST-005; wired into CLAUDE.md/
HANDOVER.md under CHECKLIST-006. Companion effort:
[LEAD_FOLLOWUPS_STALENESS.md](LEAD_FOLLOWUPS_STALENESS.md)
(`LEADFOLLOWUPS-001..005`, To-Do Dashboard) does the equivalent work
specifically for `Lead_Followups` snapshot staleness — related, but
tracked and built separately since it's a narrower, single-sheet concern.

Three tiers, split by **when** a check actually needs to run — see each
section below.

**One-time setup for the automated part of Tier 3**: paste
`OpsChecklistRunner.gs` into the Apps Script editor (alongside every other
file — see `Core.gs`'s own header for the full list), run
`setupWeeklyOpsChecklistTrigger()` once from the function dropdown. From
then on, `OPS_ALERT_EMAIL_` gets a summary every Monday ~9am IST without
anyone needing to remember this file exists.

---

## Tier 1 — Pre-change

Run these *before* editing any of the shared logic these three systems
depend on. Manual, developer-read discipline — there's no natural trigger
to automate against, since nothing here is schedule-driven.

- [ ] **Touching `isOppOrAbove`/`isOppOrAbove_`, `isOpenLead`/`isOpenLead_`,
      or `computeSlaFlags_`?** Grep every call site on BOTH runtimes for
      full-argument threading before and after your change:
      ```
      grep -rn "isOppOrAbove(" js/ | grep -v "function isOppOrAbove"
      grep -rn "isOppOrAbove_(" *.gs | grep -v "^Core.gs:.*function isOppOrAbove_"
      ```
      Confirm every real call site passes `closingReason`/`leadClosingReason`
      (or the `.gs` equivalent), not just `stage` — a call site added later
      with only one argument silently reopens the exact class of gap fixed
      2026-09-09 (see `js/core-lead-model.js`'s own comment on `isOppOrAbove`).
- [ ] **Touching a time-window constant** (`ALL_ISSUES_WINDOW_DAYS_BACK_`,
      the overnight window, a `SNAPSHOT_HOURS_`-style schedule)? Confirm
      it's anchored to an IST calendar-day boundary (`istDayKeyGs_` /
      midnight math), never a rolling number of hours back from "now" — a
      rolling window silently drops whatever was assigned before its own
      start clock time on the earliest day (the real bug fixed in
      `AllIssuesEmailer.gs`, 2026-08-28 — see `allIssuesWindowGs_`'s own
      comment for the full story).
- [ ] **Touching `RM_PERF_RULE_WEIGHTS`/`SHRINKAGE_K`/`MIN_VOLUME_LEADS`/
      `CHRONIC_STREAK_DAYS`/`FLAG_RATIO`/`CONCENTRATION_BREADTH_CEILING`
      in EITHER `js/core-rm-performance.js` or `DailyRmIssueLog.gs`?**
      These 6 constants must stay numerically identical on both sides
      (documented in `DailyRmIssueLog.gs`'s own header) — edit both files
      in the same change, then run the parity check below before shipping.

## Tier 2 — Post-deploy

Run these *after* pasting a `.gs` change into the live Apps Script editor.

- [ ] Run the matching `Tests_<File>.gs` suite (function dropdown →
      `runAllTests` covers everything at once) — confirm it's still
      green in the *live* project, not just via CI (CI only proves the
      logic is correct, not that it's actually live on the Sheet — see
      CLAUDE.md's own gotcha list).
- [ ] **Did a trigger's fire-hour, `.everyDays`/`.everyHours` cadence, or
      `.nearMinute()` pinning change?** Re-run that file's `setupXxx()`
      function. A trigger's schedule is fixed at the moment it's created —
      editing the source does NOT retroactively move it (the real incident
      this bit: `sendAllIssuesEmails`'s trigger fired 54 minutes late until
      `.nearMinute(0)` was added AND `setupAllIssuesEmailTrigger()` was
      re-run, 2026-09-02).

## Tier 3 — Periodic operational

**4 of the checks below are now genuinely automated** (CHECKLIST-006,
2026-09-09; the 4th, the workbook cell-budget check, added 2026-09-28) —
`OpsChecklistRunner.gs`'s `runWeeklyOpsChecklistNow()` runs them every
Monday ~9am IST and emails `OPS_ALERT_EMAIL_` a summary,
**whether or not anything is flagged**. That "always send" choice is
deliberate: an only-alert-when-wrong design makes a silently broken or
deleted trigger look identical to "all clear" — the exact class of risk
this file exists to catch. A missing Monday email is itself the alarm.
The remaining checks below (marked **manual**) either don't reduce to a
clean pass/fail, or genuinely can't be automated (a live cross-runtime
`.gs`-vs-`.js` comparison isn't possible) — those still need someone
(or Claude) to actually run them, on the same weekly cadence, plus
**immediately after any RM-roster or org-chart change** (new hire,
departure, promotion, reporting-line change).

### Workbook cell budget (automated, added 2026-09-28)

Google Sheets caps a workbook at 10,000,000 cells total, summed across
every tab's DECLARED grid size — the exact mechanism behind 3 real
crashes (`HANDOVER.md` §9.2/9.3, 09-06/09-19/09-24). The Monday email now
reports total usage and flags WARNING at 70% / CRITICAL at 85% of the
ceiling, naming the largest tabs by cell count
(`computeWorkbookCellUsageGs_`, `Core.gs`). For the full breakdown any
time, run `reportWorkbookCellUsageNow()` from the Apps Script editor. A
CRITICAL reading means `pruneMovementLogNow()` / `pruneDailyRmIssueLogNow()`
need running by hand now, not waiting for the next scheduled capture —
same "an after-write prune can't self-heal" trap as the 09-24 incident.
This is advance warning, not a capacity fix — the durable fix (a separate
log spreadsheet) is still open, see `HANDOVER.md` §9.3.

### Movement_Log dedup health (manual, added 2026-09-25)

Movement_Log's content-hash dedup fails *silently* — rows still append, there is just one for every lead every run. Weekly, and after any change to `MovementTracker.gs` / `js/sheets-writeback.js` / `SNAPSHOT_COLUMNS_`:

1. Read `Movement_Log_Runs` (small tab): `leads_changed` should be a small fraction of `lead_count_seen` on ordinary runs. **~100% on consecutive runs = broken** (the 2026-09-22 → 09-25 incident: ~52k junk rows before anyone noticed). From a signed-in Chrome tab on docs.google.com: `fetch('/spreadsheets/d/<id>/gviz/tq?tqx=out:csv&sheet=Movement_Log_Runs&tq=select *', {credentials:'include'})`.
2. Confirm `Movement_Log`'s header ends `…, opp_at, content_hash` (last two columns, in that order) and that a newest row has a date/blank under `opp_at` and a 64-character hash under `content_hash`.
3. After any change to `SNAPSHOT_COLUMNS_`, the known-answer hash vector in `Tests_MovementTracker.gs` and `tests/frontend-harness.html` must be recomputed **together**.
4. (Added 2026-10-07, email audit P17.) The same `Movement_Log_Runs` rows also carry `total_s` (a normal run is a few minutes; ~1,800 s means it hit the time limit), `skipped_phases` (steps dropped to stay inside the deadline), `failed_phases` (steps that threw - **should be blank**; each is also emailed to ops once a day as "Movement snapshot: ... FAILED") and `phase_s` (where the time went). A non-blank `failed_phases` on consecutive runs means a step is failing every time - the 2026-10-07 case was the `Comment_History` / `Unmatched_Comments_Log` prunes, found only because those tabs were visibly past their 30-day window. Cheap independent check: the oldest `Comment_History` / `Unmatched_Comments_Log` row should be at most ~31 days old.
5. (Added 2026-10-08, email audit P18.) Daily_RM_Issues date integrity: after the 22:53 run, no file in the Drive `Daily_RM_Issues` archive folder should be named `unknown-dates`, and `showDailyRmIssueDiagNow()` (editor, log-only) should say nothing has been recorded. If it records an undated run, the rows were repaired and kept - the entry shows where they sat and how many; that is the lead to the cause. Also: each date range should appear once in the `Comment_History` / `Unmatched_Comments_Log` archive folders (a duplicate means a prune failed after archiving and was not reused).
6. (Added 2026-10-08, email audit P18b.) `lead_assigned_at` in `Daily_RM_Issues`: every row with a lead id should have one (count them with an Apps Script read or `reportWorkbookCellUsageNow()`, **not** a Sheets query: the query endpoint only sees the first ~1,200 of ~13,900 rows). `showDailyRmIssueDiagNow()` entries with phase `prune-refill` show how many were refilled and from which source; a count that is high every night means the cell is still being lost between prunes - the refill hides the damage, the diagnostic is the lead. Since P18c the date columns are written as text; a `capture-write` / `prune-rewrite` entry means even that was lost.

### RM hierarchy routing

**Since 2026-10-01, the two checks below also run automatically** at the
end of every `rebuildRmHierarchy()` call (`logPostRebuildCoverageAudit_`,
`HANDOVER.md` §4.3.2) — check that run's execution log before manually
re-running either one. They stay listed here because they're still useful
to run standalone, anytime, and because the automatic version is
try/caught and silently logs-and-continues on a transient read failure
rather than retrying — a manual run is the way to actually retry one that
didn't complete. The real gap this closed: a checklist item that only
existed in writing ("run this after any RM-roster change") is easy to
skip — the 2026-10-01 Pre Sales team (7 people, 25-498 real leads each)
sat with zero `RM_Hierarchy` row for an unknown stretch of time because
nobody separately ran either check after they started appearing in the
`leads` tab.

- [ ] **`auditUnresolvedRmsNow()`** (`RmHierarchy.gs`, pre-existing,
      2026-08-31) — **automated weekly, and automatically after every
      `rebuildRmHierarchy()` call (since 2026-10-01).** Finds every RM
      name on a currently-open lead that doesn't resolve in `RM_Hierarchy`
      at all (missing row, or found but hand-marked Excluded). Each one
      silently falls back to the legacy `Region_Recipients` catch-all
      instead of reaching that RM's real manager chain.
- [ ] **`listExcludedRmsNow()`** (`RmHierarchy.gs`, pre-existing) —
      **manual.** Lists every row currently hand-flagged Excluded in
      `RM_Hierarchy`, so an old flag from months ago doesn't sit forgotten
      and stale (a *count* of these isn't itself a problem the way an
      unresolved RM or a missing email is, so it's left out of the
      automated summary on purpose — reviewing WHICH ones are still
      correct needs a human judgment call, not a threshold). Follow up
      with `clearAllRmHierarchyExclusionsNow()` if any turn out to be
      wrong.
- [ ] **`auditManagerDirectoryEmailGapsNow()`** (`RmHierarchy.gs`, NEW —
      built 2026-09-09) — **automated weekly, and automatically after
      every `rebuildRmHierarchy()` call (since 2026-10-01).** The gap the
      two tools above don't cover: a manager who resolves fine in `RM_Hierarchy` but
      has no email in `Manager_Directory` doesn't show up as an
      "unresolved RM" anywhere, since the RM side of the lookup succeeds.
      Every RM reporting to that manager silently falls back to
      `Region_Recipients` instead. Run this right after
      `rebuildRmHierarchy()`/`setupRmHierarchy()` too — a rebuild only
      *preserves* emails already on file, it never fills a new manager's
      email in on its own.


- [ ] **Nightly RM hierarchy sync report** (`RmHierarchySync.gs`, added 2026-10-08) — the ~23:15 IST report to Snehil, Sushil and
      Ashish. Check it arrives on nights something changed; read the "NEEDS A PERSON" and "POSSIBLE LEAVERS" lists and tell Claude which
      leavers to remove (the sync never removes anyone). A subject starting "HELD" means more than 25 changes were pending and nothing was
      written. An ops alert "syncRmHierarchyNightly failed" means no access to the HR sheet, a changed layout or a missing tab. While it
      is still report-only (`showRmHierarchySyncStatusNow()`), review 2-3 reports, then run `enableRmHierarchySyncApplyNow()`. Remember
      `rebuildRmHierarchy()` refuses to run once the sync is applying (`rebuildRmHierarchyForce()` overrides).
### Worst-performing-RM identification

- [ ] **`reportRmPerformanceNow()`** (`DailyRmIssueLog.gs`, pre-existing,
      Phase 4 2026-09-04) — **manual** (a full leaderboard dump for a
      human to read, not a boolean an unattended script can judge).
      Console mirror of the live dashboard's own workload-normalized
      methodology. Run it and spot-check its ranking against the live
      dashboard's **People → RM Performance & SLA Score** table for the
      same RMs/period — a divergence between the two independently-
      computed sides is the earliest possible signal one has drifted out
      of sync with the other. The weekly automated email ends with a
      plain-text reminder to do this.
- [ ] **`RM_PERF_*` constant parity** — **manual**, and can't be
      automated: Apps Script has no way to read a `.js` file, so a live
      cross-runtime comparison genuinely isn't possible here. Confirm the
      6 constants named in Tier 1 above still match exactly:
      ```
      grep -A1 "^const RM_PERF_RULE_WEIGHTS" js/core-rm-performance.js DailyRmIssueLog.gs
      grep -E "^const RM_PERF_(SHRINKAGE_K|MIN_VOLUME_LEADS|CHRONIC_STREAK_DAYS|FLAG_RATIO|CONCENTRATION_BREADTH_CEILING)" js/core-rm-performance.js DailyRmIssueLog.gs
      ```
      Spot-checked 2026-09-09: all 6 match. Nothing enforces this
      mechanically — a future edit to one side alone would silently
      drift, so this stays a manual step until/unless it's folded into
      the CI doc-coverage work (`CI-001..005`, To-Do Dashboard). The
      weekly automated email also reminds you to do this by hand.
- [ ] **`checkMovementLogFreshnessNow()`** (`MovementTracker.gs`, NEW —
      built 2026-09-09) — **automated weekly.** Both the live dashboard's
      Repeat Offenders tab AND `reportRmPerformanceNow()` above depend on
      `Movement_Log` having recent, regularly-captured history. A
      silently paused, deleted, or repeatedly-failing capture trigger
      degrades both the same way (a stale, gapped picture presented as
      current) without either one checking for it on its own. Flags
      anything past an 8-hour grace window on the `[0, 6, 12, 18]` IST
      schedule as worth a look at Triggers (clock icon, left sidebar).

### Automatic email

- [ ] **Daily: read the 16:30 cycle report** (`CycleReport.gs`, added 2026-10-09) — one email to Snehil near 16:30 IST. `all clear` means every planned
      email reached a final result and no incident above LOW happened in the cycle; `need attention` lists what to look at; `no emails recorded`
      on a working day means the jobs or the ledger did not run (`showEmailJobRunsNow()`, `showEmailLedgerTodayNow()`). If it did not arrive by
      17:00 the watchdog alerts. "Accepted by Gmail" is not "delivered"; the report cannot yet show bounces, replies or the age of the Leads tab.

Since 2026-09-24 this is a **two-checkpoint lifecycle**, not three
independent sends: 17:00 `AllIssuesEmailer.gs` opens one Gmail thread per
region bucket for the day; 10:00 and 13:00 `OvernightEmailer.gs` (the
combined-send path, `sendOvernightMorningEmails`/
`sendOvernightFollowupEmails`) each reply into that SAME thread rather than
starting a new one — see `docs/_planning/EMAIL_LIFECYCLE_TWO_CHECKPOINT_REDESIGN.md`
and `HANDOVER.md` §2. A check that only confirms "an email went out" no
longer proves the lifecycle is healthy — it also has to still be the same
thread.

- [ ] **Manual.** Spot-check the last few days' `Overnight_Log`/
      `AllIssues_Log` rows — does every region that should have had
      flagged leads that day actually have a row? A silent per-region
      skip (the idempotency guard misfiring, or a region simply producing
      zero buckets when it shouldn't have) wouldn't otherwise surface on
      its own. (Not automated: "should have had flagged leads" needs a
      human's read of what actually happened that day, not a fixed rule.)
- [ ] **Manual.** For a few of those rows, confirm the 10:00/13:00
      `Overnight_Log` entries actually threaded onto the 17:00
      `AllIssues_Log` send for the same region/day (same Gmail thread in
      the inbox, not three separate emails) — and that `Overnight_Log`'s
      `followup_sent_at` column is populated once the 13:00 checkpoint has
      run, not left blank. A threading failure (e.g. the stored
      message-id/thread-id for that bucket/day going stale or unresolved)
      degrades silently to a new, disconnected email rather than an error
      — nothing else in this checklist would catch it.
- [ ] **Manual.** Confirm `OPS_ALERT_EMAIL_`/`CH_LEVEL_EMAIL_`
      (`EmailInfra.gs`) are still the right, actively-monitored addresses.
      Every failure mode above degrades to "silently nothing happened" if
      nobody is actually reading whatever inbox these route to — including
      the weekly automated email itself. Since 2026-09-24 the CH-level
      backstop branch (`bucketLabel: 'Unmatched RMs (backstop)'` — nobody
      resolves in `RM_Hierarchy` OR `Region_Recipients`) deliberately does
      **not** Cc `ALWAYS_CC_EMAILS_` (fixed real mis-routing, `GS-004`
      commit `8fe9714`) — if a future change reintroduces that Cc, it's a
      regression of this specific fix, not a new feature.

---

## Maintenance of this file itself

This is a living checklist, not a one-time snapshot — when a new call
site, constant, or system-level dependency is added to any of the three
named systems, add the check for it here in the same change, the same
discipline `CLAUDE.md`'s own Testing section already asks for `.gs`
assertions. Cross-linked from `CLAUDE.md`'s Testing section and
`HANDOVER.md` §8 (where to look when something breaks) — see those files
for how this fits into the rest of the project's documentation.
