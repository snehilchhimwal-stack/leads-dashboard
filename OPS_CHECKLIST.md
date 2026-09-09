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
[LEADFOLLOWUPS-001..005](#) (To-Do Dashboard) does the equivalent work
specifically for `Lead_Followups` snapshot staleness — related, but
tracked and built separately since it's a narrower, single-sheet concern.

Three tiers, split by **when** a check actually needs to run — see each
section below.

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

Run these on a standing cadence (recommended: **weekly**, plus
**immediately after any RM-roster or org-chart change** — new hire,
departure, promotion, reporting-line change). Semi-automated: most of
these already exist as one console function each — the checklist's real
job is making sure they actually get *run*, not building them from
scratch.

### RM hierarchy routing

- [ ] **`auditUnresolvedRmsNow()`** (`RmHierarchy.gs`, pre-existing,
      2026-08-31) — finds every RM name on a currently-open lead that
      doesn't resolve in `RM_Hierarchy` at all (missing row, or found but
      hand-marked Excluded). Each one silently falls back to the legacy
      `Region_Recipients` catch-all instead of reaching that RM's real
      manager chain.
- [ ] **`listExcludedRmsNow()`** (`RmHierarchy.gs`, pre-existing) — lists
      every row currently hand-flagged Excluded in `RM_Hierarchy`, so an
      old flag from months ago doesn't sit forgotten and stale. Follow up
      with `clearAllRmHierarchyExclusionsNow()` if any turn out to be
      wrong.
- [ ] **`auditManagerDirectoryEmailGapsNow()`** (`RmHierarchy.gs`, NEW —
      built 2026-09-09 for this checklist) — the gap the two tools above
      don't cover: a manager who resolves fine in `RM_Hierarchy` but has
      no email in `Manager_Directory` doesn't show up as an "unresolved
      RM" anywhere, since the RM side of the lookup succeeds. Every RM
      reporting to that manager silently falls back to
      `Region_Recipients` instead. Run this right after
      `rebuildRmHierarchy()`/`setupRmHierarchy()` too — a rebuild only
      *preserves* emails already on file, it never fills a new manager's
      email in on its own.

### Worst-performing-RM identification

- [ ] **`reportRmPerformanceNow()`** (`DailyRmIssueLog.gs`, pre-existing,
      Phase 4 2026-09-04) — console mirror of the live dashboard's own
      workload-normalized methodology. Run it and spot-check its ranking
      against the live dashboard's **People → RM Performance & SLA
      Score** table for the same RMs/period — a divergence between the
      two independently-computed sides is the earliest possible signal
      one has drifted out of sync with the other.
- [ ] **`RM_PERF_*` constant parity** (manual — no live cross-runtime
      check is possible, Apps Script can't read a `.js` file) — confirm
      the 6 constants named in Tier 1 above still match exactly:
      ```
      grep -A1 "^const RM_PERF_RULE_WEIGHTS" js/core-rm-performance.js DailyRmIssueLog.gs
      grep -E "^const RM_PERF_(SHRINKAGE_K|MIN_VOLUME_LEADS|CHRONIC_STREAK_DAYS|FLAG_RATIO|CONCENTRATION_BREADTH_CEILING)" js/core-rm-performance.js DailyRmIssueLog.gs
      ```
      Spot-checked 2026-09-09: all 6 match. Nothing enforces this
      mechanically — a future edit to one side alone would silently
      drift, so this stays a manual step until/unless it's folded into
      the CI doc-coverage work (`CI-001..005`, To-Do Dashboard).
- [ ] **`checkMovementLogFreshnessNow()`** (`MovementTracker.gs`, NEW —
      built 2026-09-09 for this checklist) — both the live dashboard's
      Repeat Offenders tab AND `reportRmPerformanceNow()` above depend on
      `Movement_Log` having recent, regularly-captured history. A
      silently paused, deleted, or repeatedly-failing capture trigger
      degrades both the same way (a stale, gapped picture presented as
      current) without either one checking for it on its own. Flags
      anything past an 8-hour grace window on the `[0, 6, 12, 18]` IST
      schedule as worth a look at Triggers (clock icon, left sidebar).

### Automatic email

- [ ] Spot-check the last few days' `Overnight_Log`/`AllIssues_Log` rows
      — does every region that should have had flagged leads that day
      actually have a row? A silent per-region skip (the idempotency
      guard misfiring, or a region simply producing zero buckets when it
      shouldn't have) wouldn't otherwise surface on its own.
- [ ] Confirm `OPS_ALERT_EMAIL_`/`CH_LEVEL_EMAIL_` (`EmailInfra.gs`) are
      still the right, actively-monitored addresses. Every failure mode
      above degrades to "silently nothing happened" if nobody is actually
      reading whatever inbox these route to.

---

## Maintenance of this file itself

This is a living checklist, not a one-time snapshot — when a new call
site, constant, or system-level dependency is added to any of the three
named systems, add the check for it here in the same change, the same
discipline `CLAUDE.md`'s own Testing section already asks for `.gs`
assertions. Cross-linked from `CLAUDE.md`'s Testing section and
`HANDOVER.md` §8 (where to look when something breaks) — see those files
for how this fits into the rest of the project's documentation.
