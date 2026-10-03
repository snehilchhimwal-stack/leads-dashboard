# Dead/Stale Code Audit — Google leads Dashboard

**Date:** 2026-10-03
**Scope:** 14 production `.gs` files (Apps Script backend), 25 `js/*.js` files + `dashboard.html` (client dashboard), plus cross-cutting checks (loose repo artifacts, `test/` tooling usage, cross-runtime duplication drift per `HANDOVER.md` §6, `docs/INDEX.md` accuracy, deprecated/legacy markers, feature-flag staleness).
**Method:** Three parallel read-only investigations (backend, frontend, cross-cutting), each cross-referencing `docs/gs-modules/`/`docs/js-modules/` FN-tables and `HANDOVER.md` before judging anything "dead" — a documented "Called by" entry was trusted over a raw grep miss unless a concrete contradiction turned up. Every finding below was independently re-verified by a direct grep against the live source before inclusion in this report. No code was deleted or modified — this is a report for your review, per the brief.
**Backup:** a full, verified pre-audit backup exists — see the closed "Part 1" task (`t-tf-2e9cff4ee6e3`) for the archive location/manifest.

## Confirmed dead (zero static references anywhere, including dynamic/HTML call sites)

| File | Line(s) | Symbol | Evidence | Recommended action |
|---|---|---|---|---|
| `js/core-collation.js` | 155–159 | `collatedCountLabel(arr, noun)` | Zero call sites in any `js/*.js` file or `dashboard.html` (verified: only its own declaration). Its doc record `docs/js-modules/JS-002-core-collation.md` FN-014 claims it's "Called by: KPI / table headers across tabs" alongside its sibling `collatedCountText` — true for the sibling (2 real call sites), false for this one. The same job is done everywhere by a different helper, `uniqueCloneLabel` (16 real call sites). | Safe to remove, or correct JS-002's FN-014 row if kept intentionally — duplicate of `uniqueCloneLabel`. |
| `js/tab-movement.js` | 51 | `const MOVEMENT_LOG_RUNS_COLUMNS` | Zero reads anywhere in `js/*.js`/`dashboard.html` (verified). The one real write to `Movement_Log_Runs` (`js/sheets-writeback.js:886`) hardcodes the row shape positionally instead of using this constant — looks like it was meant to drive a header-write/self-heal check the way `MOVEMENT_LOG_COLUMNS` does, but was never wired up. (Its `.gs` twin `MOVEMENT_LOG_RUNS_COLUMNS_` in `MovementTracker.gs` **is** genuinely used there — this finding is JS-side only.) | Flag for review — either wire it into a header self-heal check, or remove it. |
| `dashboard.html` | 130–133 | `.hover-row:hover .card-detail{...}` CSS rule | The `hover-row` class name never appears in any markup or JS `classList`/template-string call (verified) — only in its own CSS rule. Its sibling `.hover-card` (same pattern, same section) is genuinely applied in 2 real places. Looks like a planned companion effect that was never actually attached to a row element. | Safe to remove the dead CSS rule, or apply the class if the hover effect is still wanted. |
| `js/core-rm-performance.js` | 1236–1251 | `rmPerformanceDrivenBy(r)` | Zero call sites anywhere (verified). **Its own header comment explains why**: the "Driven by" column was deliberately removed from all 4 live tables + the PDF on 2026-09-07 per explicit request, replaced by `rmPerformanceHierarchyCells` + `totalInstances` — "left defined... in case a future request brings a 'why' column back." Its `.gs` twin `rmPerformanceDrivenByGs_` (`DailyRmIssueLog.gs`) is a different runtime and **is** actively used there (console tool `reportRmPerformanceNow()`) — not a pair to delete symmetrically. | **Leave as-is** — deliberately retained by the author, not an oversight. (But see the doc-accuracy finding below — the record describing it is wrong.) |

## Doc-accuracy finding (not code — a documentation record making a false claim)

| Record | Issue | Recommended action |
|---|---|---|
| `docs/js-modules/JS-008-core-rm-performance.md`, row **FN-063** | Bundles `rmPerformanceDrivenBy(r)` and `rmPerformanceHierarchyCells(r, map)` under one "Called by: table + PDF renderers" claim. True for `rmPerformanceHierarchyCells`, **false** for `rmPerformanceDrivenBy` (confirmed dead above, and confirmed dead since 2026-09-07 by the code's own comment). The record's `Last Verified` stamp is 2026-09-30 — i.e. a revalidation pass happened *three weeks after* the code already admitted it was orphaned, and missed it. A separate record, `docs/js-modules/JS-022-tab-repeat-offenders.md` FN-155, already has this correct ("no longer `rmPerformanceDrivenBy`, unused... since 2026-09-07") — so only JS-008's row needs fixing. | Split FN-063 into two rows (or caveat it) the next time JS-008 is revalidated, per `docs/HOW_TO_UPDATE_A_COMPONENT.md`. |

## Likely stale — a real decision pending, not an oversight

| File | Line(s) | Symbol | Evidence | Recommended action |
|---|---|---|---|---|
| `OvernightEmailer.gs` | 375 | `sendOneOvernightEmail_` | `docs/gs-modules/GS-010-overnightemailer.md` FN-233 itself states it's "no longer called by [the production loop], which now always goes through [`sendCombinedMorningEmail_`]" (superseded 2026-09-23). Zero production call sites confirmed; it survives only via `Tests_OvernightEmailer.gs`'s own dedicated test block (exercising its Gmail-failure-handling branch) and inline comments elsewhere referencing its pattern. | Flag for your decision: keep as a standalone manual/ops single-region-send tool, or retire it (and its ~2 dedicated test blocks). Not safe to delete without that call since it's deliberately retained today. |

## Needs runtime evidence — checked individually, all resolved to "intentional" (no action needed)

These all showed zero static callers, which is exactly what you'd expect from a manual/console-only entry point — each was cross-checked against `HANDOVER.md` and its own doc record, which independently confirm it's a deliberate, documented utility, not dead code:

- **Already-completed one-off remediations (safe idempotent no-ops by project convention):** `removeOppConversionTrackingTabNow` (`Core.gs`), `removeTestModeAllIssuesRowsNow` (`AllIssuesEmailer.gs`), `removeStaleMovementLogBackupTabNow` (`MovementTracker.gs`) — all three already ran live and finished their one job per `docs/STALENESS_TRACKER.md`'s incident log; kept around as safe no-ops rather than deleted, matching this project's established pattern.
- **Documented manual/console utilities, no evidence of obsolescence:** `downloadNoIssueLeadsNow`, `debugFollowupStatusNow`, `persistDailyCohortHistoryNow`, `pruneCommentHistoryNow`, `pruneUnmatchedCommentsLogNow`, `repairDailyRmIssuesMissingFieldsNow`, `backfillDailyRmIssuesFromMovementLogNow`, `backfillOneDayFromMovementLogNow` (all in various `.gs` files) — every one named explicitly in `HANDOVER.md` §4.3/§9.3 or §9.3's own "Utility functions (console-callable)" list.

## Loose artifacts outside the tracked application (not code-level findings)

| Path | What it is | Recommended action |
|---|---|---|
| `working files on 28th for automatic email/` | Untracked (not in git), a manual backup snapshot of 5 `.gs` files from mid-development (dated 2026-08-28, now a month+ behind the real files). `HANDOVER.md` line 123 already says this explicitly: "**Not in git**, and not authoritative... safe to ignore or delete." | Lowest-risk cleanup in this whole audit — just needs someone to actually delete it. |
| `design/live-ops-redesign.html` | Git-tracked, a standalone design mockup (its own fonts/CSS, not wired to real data or included from `dashboard.html`). `HANDOVER.md` line 124 already labels it "a standalone visual mockup from an earlier exploration pass — not wired to real data, not part of the live app." | Not dead code — an intentional artifact. Worth a human decision on whether to keep as reference or move to an archive folder. |

## Checked clean (no findings — recorded so this doesn't get re-checked later)

- **No commented-out code blocks, `if(false)`-style dead branches, or unreachable-after-`return` code found anywhere** across all 39 files (14 `.gs` + 25 `js/*.js`) — genuinely none, not just none-found-by-the-method-used.
- **All 6 live Apps Script time-based triggers** (`snapshotPeriodic`, `captureDailyRmIssues`, `sendOvernightMorningEmails`, `sendOvernightFollowupEmails`, `sendAllIssuesEmails`, `runWeeklyOpsChecklistNow`) verified matching real, present handler functions against `HANDOVER.md` §4.3 and `docs/architecture/apps-script-triggers.md` — no orphaned triggers.
- **All 9 dashboard tabs** fully wired (every `render*Tab()` reachable from `renderAll()`'s tab registry); `rm-performance-worker.js` confirmed genuinely invoked via `new Worker()`.
- **`test/` tooling (13 scripts):** every one referenced by name in `CLAUDE.md`, `.github/workflows/test.yml`, `package.json`, or imported by another `test/` script. None orphaned.
- **9 spot-checked cross-runtime duplication pairs** from `HANDOVER.md` §6 (`HEADER_ALIASES`, `FUNNEL_ORDER`, `enrichLead`/`computeSlaFlags_`, `OUTCOME_RULES`, `FOLLOWUP_SUGGESTIONS`, `REGION_GROUP_MAP`, `RM_PERF_*`, `istDateKey`, `TEST_MODE_OVERRIDE_EMAIL`) — all intact on both sides, no silent one-sided drift found. (The one already-known gap, `effectiveRegion` having no `.gs` twin, is a pre-existing tracked item in `LOGIC_AUDIT.md`/`DATA-005`, not a new discovery.)
- **`docs/INDEX.md` file-coverage:** every `TAB-`/`JS-`/`GS-`/`EXT-` row's `Location` names a file that actually exists — no orphaned doc records found (consistent with `test/check-catalog.py` check C already reporting clean).
- **Feature flags:** no dead booleans found. `TEST_MODE_OVERRIDE_EMAIL`/`_` correctly empty and guarded in both runtimes. `AllIssuesEmailer.gs`'s `TEST_MODE_ROWS_FROM_`/etc. constants are a one-off remediation tool (hardcoded to a past window), not a live toggle — likely done its job, worth a glance but not flagged as a defect.
- **CDN includes** (`accounts.google.com/gsi/client`, `jspdf`, `jspdf-autotable`): all genuinely used.
- **"deprecated"/"legacy"/"obsolete" marker grep** (repo-wide): every real hit refers to the still-active `Region_Recipients` fallback path (intentionally retained) or an already-cleanly-completed rename with no old code left behind.

## Summary

| Confidence | Count |
|---|---|
| Confirmed dead (code) | 4 |
| Doc-accuracy issue (not code) | 1 |
| Likely stale (pending decision) | 1 |
| Needs runtime evidence → resolved intentional | 11 |
| Loose non-code artifacts | 2 |

**Most worth attention, in order:**
1. **`rmPerformanceDrivenBy` + `docs/js-modules/JS-008` FN-063** — the one place code and docs actively disagree: the function is correctly dead-and-intentionally-kept, but its doc record still falsely claims active use three weeks after the code itself said otherwise. Worth fixing the doc row regardless of what happens to the code.
2. **`sendOneOvernightEmail_`** — the one genuine "is this still needed?" policy question in the whole audit. Superseded in production, kept alive by its own tests.
3. **`working files on 28th for automatic email/`** — zero-risk cleanup, already self-labeled safe-to-delete in `HANDOVER.md`.
4. **`collatedCountLabel`** and **`MOVEMENT_LOG_RUNS_COLUMNS`** — small, low-risk, genuinely orphaned; safe to remove once you confirm nothing external calls them.

Everything else — the large majority of what was checked — came back clean. This is a well-maintained codebase by the evidence available: three independent passes across ~39 files found only 4 small dead-code items (one intentionally so) and one documentation drift.
