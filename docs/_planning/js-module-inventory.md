# JS module inventory (`DOC-006`)

**Produced:** 2026-09-10, against `js/` at commit `e281f9b`.
**Purpose:** the confirmed `js/*.js` file list + each file's one-line
responsibility + the core-vs-feature split, as the base for `DOC-027`
(core) and `DOC-028` (feature).
(`DOCUMENTATION_PROJECT_PLAN.md` Phase 1, `DOC-006`.)

> **Count drift.** The plan text says "23 files … 11 core + 12 feature."
> The current count is **24** (`js/rm-performance-worker.js` added since
> `LOGIC_AUDIT.md` — see `file-inventory.md`, `DOC-001`), split **11
> core + 13 feature**. Responsibilities below are the ones already
> written into the Phase 3 `JS-XXX` records (`DOC-027`/`DOC-028`), each
> verified against the current file.

---

## Core / foundation layer — 11 files → `DOC-027` scope

Loads first (real order per `LOGIC_AUDIT.md` Part 1 §4a); establishes
the shared globals every other file uses.

| ID | File | One-line responsibility |
|---|---|---|
| JS-001 | `core-auth.js` | Google OAuth sign-in gate for the Sheets scope; owns `gateAccessToken`, the token every Sheets call uses. |
| JS-002 | `core-collation.js` | Display layer for multi-RM-copy customer families — badges, identity lines, family grouping/counting helpers. |
| JS-003 | `core-fetch-and-render.js` | `fetchAndRender()` — the fetch → parse → union-find collation → merge → `allParsedLeads` → `renderAll()` pipeline; also `showError`/`setPulse`. |
| JS-004 | `core-filters.js` | `applyFiltersAndRender()` (rebuild `leads`/`issueLeads` from `allParsedLeads` per `filterState`) + the shared `buildMultiSelect` widget + `SLA_History` snapshot/clear admin. |
| JS-005 | `core-foundation.js` | `CONFIG`, `ISSUE_PRIORITY`, and the IST wall-clock↔instant helpers everything else is built on. |
| JS-006 | `core-lead-model.js` | Lead-shape domain logic: business-hour math, date parsing, funnel-stage classification, and `enrichLead()` — the single source of truth for a lead's derived SLA/funnel state. |
| JS-007 | `core-outcome-engine.js` | Comment classification: `OUTCOME_RULES`/`inferOutcome`, the typo-tolerant matcher, `FOLLOWUP_SUGGESTIONS`/`suggestedFollowUp`, action-log parsing, IST timestamp formatters. |
| JS-008 | `core-rm-performance.js` | RM-performance engine: reconstructs per-(lead,day,rule) observations from Movement_Log, aggregates, applies empirical-Bayes shrinkage + severity weighting, classifies; `computeRmPerformance` + `computeRmPerformanceByRegion`. Pure, no DOM. |
| JS-009 | `core-sheets-fetch.js` | `HEADER_ALIASES` column map; declares `leads`/`issueLeads`/`allParsedLeads`/`filterState`; the one literal Sheets API v4 GET (`sheetsApiValuesGet`) + gviz-shape adapter. |
| JS-010 | `core-ui.js` | Generic UI chrome: `esc()`, the reference-counted loading overlay, lazy action-log expand (`toggleActionLog`, `_logLeadRegistry`), the shared alert-card template. |
| JS-011 | `main.js` | Bootstrap only — the 4 top-level calls that must run at parse time (`initCollapsibleSectionInfo`, `initRMTimelineUI`, `initMovementUI`, `initAuthGate`). Defines no functions. |

## Tab / feature layer — 13 files → `DOC-028` scope

| ID | File | One-line responsibility |
|---|---|---|
| JS-012 | `overview-distribution-people-ops.js` | `renderAll()` master orchestrator + tab switching; Overview/Distribution/People/Operations content — KPI strip, funnel/region/TL/project/RM tables, RM SLA score table, fan-out/allocation/source-mix, every Operations issue-list card, 2 CSV exports. |
| JS-013 | `repeat-offenders-pdf.js` | The "Download PDF" export for Repeat Offenders — real vector tables via jsPDF/jspdf-autotable, mirroring the on-screen filter, broken out per date. |
| JS-014 | `reports-build.js` | Pure computation of region-email report content: region normalization (`REGION_GROUP_MAP`, `effectiveRegion`), per-issue + combined "all issues" builders, the shared HTML email template. No DOM, no network. |
| JS-015 | `reports-gmail.js` | The real one-click Gmail send: the separate `gmail.send` OAuth grant, raw-MIME encoding, `performGmailSend` (the one real send call), sequential bulk send, a `localStorage` 1-hour sent-log for button cosmetics. |
| JS-016 | `reports-ui.js` | The per-region recipient (To/Cc) chip-input UI, the `mailto:` flow, and the `#generateBtn` 3-phase Generate cycle (preliminary → push to `Lead_Followups` → wait for human review → rebuild). Loads last of the 3 reports files. |
| JS-017 | `rm-performance-worker.js` | A Web Worker that `importScripts()` the real `core-rm-performance.js` stack and runs the RM-performance compute off-thread, posting stage progress + one `done` message. **Loaded via `new Worker()` in `tab-repeat-offenders.js`, not a `<script src>` tag.** |
| JS-018 | `sheets-writeback.js` | **Every real Sheets write in the client** — Movement_Log snapshot, `Lead_Followups` upsert/clear, `Send_Log` append, `SLA_History` + `Daily_Cohort_History` upsert; the low-level `appendSheetRows`/`sheetsApiValuesBatchUpdate` helpers; the `_generateCycleOwner` mutex; `waitForAllFollowups`. |
| JS-019 | `tab-audit.js` | Audit tab — multi-period matcher over every dated comment/connect event on a lead; Activity-by-Hour chart. Owns `updateEventsFor` (the canonical per-lead event list, reused by RM Timeline). |
| JS-020 | `tab-morning.js` | Morning Brief — 10 fixed cards mirroring the "0–48h Funnel Audit" checklist. Introduces **no new business logic**; every card reuses an existing shared function. |
| JS-021 | `tab-movement.js` | Fetches/parses `Movement_Log`; **the shared Movement_Log data hub** (`movementSnapshots`/`buildMovementHistories`/`passesMovementFilters`). Movement tab: Stalled Leads, RM Stall Leaderboard, Time-to-Opportunity, Unmatched Comments, Overnight cohort + its region-email trigger. |
| JS-022 | `tab-repeat-offenders.js` | Repeat Offenders tab — dispatches the RM-performance compute (worker or sync), renders the RM/Region/A1-TM/RH leaderboards + "Worst 5 RMs by Region", owns this report's own filter set, independently fetches `RM_Hierarchy` for the display rollup. |
| JS-023 | `tab-rmtimeline.js` | RM Timeline (inside the People tab) — per-RM 7-day calendar, day timeline of dated events, current open-issue list, issue-history trend chart (reuses `tab-tracking.js`'s chart builder). |
| JS-024 | `tab-tracking.js` | Tracking tab — issue-count-over-time chart, cohort comparison, 0–48h Cohort Outcome, Daily Cohort by Region, Week-over-Week; owns the `SLA_History`/`Daily_Cohort_History` admin buttons and `persistDailyCohortHistory` (never re-writes an archived date). Owns `buildTrackingChartSvg`. |

---

## The core/feature split (reused verbatim by `DOC-027`/`DOC-028`)

- **`DOC-027` scope = `JS-001`..`JS-011`** — the 11 core/foundation
  files above. Boundary: these load first and establish shared globals
  (`CONFIG`, IST helpers, `gateAccessToken`, `leads`/`issueLeads`/
  `allParsedLeads`/`filterState`, `enrichLead`, `OUTCOME_RULES`, `esc`,
  the collation display layer, the fetch pipeline). `LOGIC_AUDIT.md`
  Part 1 §4b covers exactly this set.
- **`DOC-028` scope = `JS-012`..`JS-024`** — the 13 tab/feature files.
  `LOGIC_AUDIT.md` Part 1 §4c covers `JS-012`..`JS-016` and `JS-018`..
  `JS-024`; `JS-017` (the worker) is a post-audit addition covered by a
  direct read.
- `core-rm-performance.js` (`JS-008`) is grouped **core** here (it's a
  pure engine other modules call, and `DOC-027`'s scope list names it),
  even though `dashboard.html` loads its `<script src>` tag late among
  the tab files (`LOGIC_AUDIT.md` Part 1 §4a — a documented load-order
  nuance, functionally harmless).

---

## Definition of Done check

- **Every file in `js/` has a row** — ✅ (24 rows: 11 core + 13 feature;
  `rm-performance-worker.js` included, with its non-`<script src>`
  loading noted).
- **The core/feature split is stated explicitly and will be reused
  verbatim by `DOC-027`/`DOC-028`** — ✅ (`JS-001`..`JS-011` core /
  `JS-012`..`JS-024` feature — already the exact scope those two tasks
  used).
