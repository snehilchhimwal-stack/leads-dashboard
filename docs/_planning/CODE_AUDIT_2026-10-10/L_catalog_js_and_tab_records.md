# L — Catalog audit: JS-module, TAB and DASH records vs code at HEAD `19038e7`

Auditor scope: every `docs/js-modules/JS-*.md` (25 records, JS-001..JS-025; the brief said 26, but 25 exist),
every `docs/tabs/TAB-*.md` (9 records, TAB-001..TAB-009; the brief said 10, but 9 exist), and `docs/dashboards/*`
(DASH-001 + README). Each was compared against `js/*.js` (25 files) and `dashboard.html` (1456 lines) at HEAD
`19038e7`. Read-only audit: no file other than this one was written, nothing was committed, and the live Sheet was not touched.

## 1. Orientation

**How this was checked**

- I read every record. Mechanical cross-checks used scratch scripts that were not committed:
  1. Every `name` `#Lnn` anchor in the FN/CFG rows, and the state tables, was resolved against the real definition line.
  2. Every top-level `function`/`const`/`let` in each JS file was diffed against the names its record mentions.
  3. Every backticked `#element-id` in the records was resolved against `dashboard.html` plus the ids the JS builds.
  4. Each record's `Depends On`/`Used By` JS-links were diffed against a cross-file identifier-reference scan. This scan is
     noisy because shared globals and the Worker's `importScripts` blur it, so only the clear misses are reported.
  5. `git log <LastVerified>..HEAD -- <file>` was checked for every record.
  6. The script order in `dashboard.html` (L1427–L1454) was checked against each record's "Load order" claim.
- The important claims were then confirmed by reading the code: what is rendered, the buttons, the filters, the
  exception paths and the module state.

**Headline results**

- **Freshness is good on paper.** For all 25 JS records, the file has had 0 commits since the record's `Last Verified` sha.
  Even so, 6 records state a wrong line count in `Location`: each was "verified" against the same commit that changed the
  file, but the count was never refreshed.
- **Coverage is complete.** Every `js/*.js` file has a record, and so does the Worker. No JS file is missing a record.
- **Anchors are mostly right.** About 90% of the FN-row function anchors are correct. The anchors that drift are in prose
  (EXC/RULE/state/lineage lines), in a few multi-function FN rows, and in 2 CFG ranges in JS-008.
- **The real problems are content claims that no longer match behaviour.** The worst cluster is Repeat Offenders: the
  records describe a private filter set, "Below Expectations only" tables, a "driven by" column, and a Worker-error
  behaviour that does not exist. Next come the Morning Brief's relationship to `renderAll()`, Opp Monitor's "no
  `filterState`" claim, and DASH-001's tab, write-path and inline-handler claims.

**Load order** (`dashboard.html` L1427–L1454, 24 `<script src>`):

1. foundation
2. sheets-fetch
3. auth
4. lead-model
5. collation
6. outcome-engine
7. fetch-and-render
8. ui
9. filters
10. tab-audit
11. tab-tracking
12. tab-oppmonitor
13. tab-rmtimeline
14. tab-movement
15. tab-repeat-offenders
16. core-rm-performance
17. repeat-offenders-pdf
18. tab-morning
19. reports-build
20. reports-gmail
21. reports-ui
22. sheets-writeback
23. overview-distribution-people-ops
24. main

The 25th file, the Worker, is not in this list: it is created with `new Worker` in `tab-repeat-offenders.js:391`.

All core records' ordinal claims (first through ninth) are correct. One tab record has a minor order error, noted under JS-024.

## 2. Per-record findings

Verdict scale:

- **ACCURATE**: nothing material.
- **MINOR DRIFT**: stale anchors, counts or incomplete lists; no behavioural misstatement.
- **MATERIALLY WRONG**: at least one claim about behaviour, UI or data flow is false.
- **MISSING**: no record exists.

### JS-001 core-auth.js — MINOR DRIFT
- FN-002 `initGateTokenClient` "Called by … `initAuthGate` (FN-006)" is wrong. Only `gateSignIn` calls it (`core-auth.js:98`); `initAuthGate` (L122-131) never does.
- FN-004 `gateSignIn` "Calls" omits `getGmailClientId`/`setGmailClientId` (L84-87), although Depends On lists them.
- Data lineage cites `core-sheets-fetch.js:103` for the Bearer read. The real line is **L110**.
- Module state `gateTokenClient` (L29) and `_gateSignInResolvers` (L33) are never mentioned. `_gateSignInResolvers` is the mechanism behind EXC-002.
- EXC-002 says "Promise never resolves" on a denied consent. In code, a consent *error* response does resolve (callback L44-55 always drains the resolvers). Only a popup closed with no callback leaves it pending. The record over-generalises.
- Depends On lists `JS-004`, but no code reference exists.

### JS-002 core-collation.js — MINOR DRIFT (borderline material on FN-013/014)
- FN-013 `countUniqueAndCloned` returns `{total, unique, cloned}`, not `{unique, cloned}`. It *calls* `dedupeToFamilies` (L117), but the record says "—".
- FN-013's "Called by `collatedCountText` (FN-014)" is wrong. `collatedCountText` (L148) calls `countCollatedAmong` (L141), a different function with different semantics: it counts `collatedFrom>1` records, not family dedupe.
- Missing functions: `uniqueCloneLabel` (L125), `countCollatedAmong` (L141), `numWithClone` (L167).
- The output strings say "(M collated)". The code emits "(M cloned)" (L128/L151/L160/L168).
- Used By: misses `JS-020` and `JS-023`.

### JS-003 core-fetch-and-render.js — MINOR DRIFT (several stale anchors, one wrong caller)
- **Location: "665 lines" vs 689 real.** The file was 689 lines at `7799e44`, the very commit it was verified against.
- **Prose anchors are stale:**

  | Record says | Code at HEAD |
  |---|---|
  | EXC-004/005 "caught `#L639`/`#L641`" | L669/L671 |
  | `allParsedLeads` "written here `#L566`" (also JS-009) | L584 |
  | RULE-004 `#L244` | L250 |
  | Validation section: `mergeRowsIntoOneLead #L347`, `_ufFind/_ufUnion #L280–284` | 353, 286/290 |
  | Promise.all gate "~`#L624`" | L642 |
  | RULE-001 `#L258` | `isLeadClosed` primary-copy pick, not the union rule |

- **A third error code is undocumented.** `BAD_RANGE` (HTTP 400, L79) and its handler are not in the EXC table.
- FN-018 and UI relationships name the banner `#errorBanner`. It is **`#errorBox`** (L14/L20).
- FN-015 "Called by … `#changeSourceBtn`" is wrong. That button only reveals `#configPanel` (`overview-distribution-people-ops.js:1378`).
- FN-015 "triggers `renderAll()`": `fetchAndRender` never calls `renderAll` directly; it goes through `applyFiltersAndRender` (L587/L608). It also directly calls these, which are undocumented as calls:
  - `renderSourceBreakdown` (L581, JS-012)
  - `snapshotSlaHistory` (L589, JS-004)
  - `persistDailyCohortHistory` (L616, JS-024)
  - `gateSignIn` (L53)
  - `buildFilterUI` (L586)
- Depends On lacks `JS-018` (`recordComponentUsage` L661) and `JS-024` (`persistDailyCohortHistory`). INDEX.md has JS-018 but also lacks JS-024.
- EXC-006 describes "early return after `showLoadingOverlay`". Real flow: the code first attempts a silent `gateSignIn()` re-auth (L52-55), and returns only if that fails. The overlay is then left shown; this is worth a code-side look.

### JS-004 core-filters.js — MINOR DRIFT
- FN-020 `applyFiltersAndRender`, "Called by `core-auth.js`": wrong. `core-auth.js` never calls it. The real callers are:
  - `fetchAndRender` (2x)
  - `buildFilterUI`'s reset (L294)
  - the `#dateFromInput`/`#dateToInput` change listeners (`overview-…:1382/1385`)
- FN-022 "Called by `buildFilterUI` (FN-024)": should be **FN-023**.
- FN-024 `snapshotSlaHistory`, "Called by `MovementTracker`-equivalent client checkpoints, tracking admin": wrong. The real callers are `fetchAndRender` (`core-fetch-and-render.js:589`) and `browserSnapshotOpenLeads` (`sheets-writeback.js:893`).
- Missing function: `defaultDateRangeValue` (L230). Its own comment says it deliberately uses **browser-local**, not IST, dates. That is a documented exception to the CLAUDE.md IST rule, and the record should carry it.
- Used By: misses `JS-018` (calls `snapshotSlaHistory`) and `JS-023` (calls `defaultDateRangeValue`).

### JS-005 core-foundation.js — MINOR DRIFT
- All FN and CFG anchors are correct. The CFG anchors point at keys inside the `CONFIG` literal; those were checked by hand.
- `CONFIG.MIN_CALLS_AFTER_48H` (L33) is not a CFG row. It is only referenced via JS-006 RULE-006.
- **Depends On: `none` is wrong** (INDEX.md too). `groupLeadsByCalendarDay` calls `parseDate` (JS-006, L207), and `dayGroupHeaderHtml` calls `esc` (JS-010, L225). Both are safe forward references, but they are real dependencies.
- FN-032 "Calls" omits `parseDate`.

### JS-006 core-lead-model.js — MATERIALLY WRONG (EXC-011)
- **Location: "449 lines" vs 500 real.** The file was 500 lines at `7799e44`, its own verify commit.
- **EXC-011 is wrong.** It says that with no `Movement_Log` baseline, `underCalledToday` "falls back to absolute call count". The real behaviour (L391-399):
  - `callsTodayFromBaseline` returns `null`, and `attemptsToday` = `loggedToday`, the count of **comment-log entries** dated today. That is the proxy FN-346's own row describes.
  - Only `isCreatedToday` leads use the absolute `call_attempts`.
  - Historical enrichment (`_enrichingHistorical`) also uses `loggedToday`.

  The EXC row contradicts FN-346 in the same record.
- `_enrichingHistorical` (L239) and `_parseDateCache` (L51) are not described as module state; `_parseDateCache` gets only a passing mention.
- Used By misses `JS-020`, `JS-022` and `JS-025`, all of which call `parseDate`/`isOppOrAbove`-family helpers.

### JS-007 core-outcome-engine.js — MINOR DRIFT
- **Location: "934 lines" vs 933.**
- FN-051 `istStamp`/`isoStampIST` has no anchor; the definition is at L906/L918.
- There is a third alias, `isoStamp` (L919), which is unmentioned.
- Missing functions:
  - `_wordsOf` (L171)
  - `_anySignal` (L202)
  - `ownComments` (L796)
  - `actionLogTableMarkup` (L868), used by JS-010's `toggleActionLog`
  - `fmtWorkingWait` (L924)
- RULE-009 "31 ordered rules" is confirmed (31 entries in `OUTCOME_RULES`, L230).
- EXC-012 says an unmatched comment "is logged for review". The browser logs nothing; only the backend (GS-013) does. The wording blurs the two runtimes.

### JS-008 core-rm-performance.js — MINOR DRIFT
- All 22 FN anchors resolve **except** FN-064's "`ByScore` `#L839`". `sortRmPerformanceByScore` is at **L1310**, and it is the sort actually used by every live table and the PDF.
- **CFG anchors are stale:**

  | Row | Record says | Code at HEAD |
  |---|---|---|
  | CFG-075 | `#L346-370` | L417/L418 |
  | CFG-074 | `#L792-818` | L946-L987 |

- EXC-014 says "returns `[]` `#L408`". L408 is a comment inside the admin-exclusion block.
- Unmentioned state: `RM_PERF_RULES` (L190), the rule table itself, and `RM_PERF_SCORED_RULE_KEYS` (L74).
- Missing function: `_rmPerfDaysBetweenKeys` (L458).
- **Cross-record conflict.** FN-052's Called-by and FN-064 imply the "worst" filter drives the tables. In fact the live tab and the PDF use `filterRmPerformanceRankable` + `sortRmPerformanceByScore`, which excludes only Insufficient Data. `filterRmPerformanceWorst` is used only for a count (`tab-repeat-offenders.js:545`). See TAB-004.

### JS-009 core-sheets-fetch.js — MINOR DRIFT
- **The whole "State declared here" table is off by +7:**

  | State | Record says | Code at HEAD |
  |---|---|---|
  | `leads` | `#L68` | L75 |
  | `issueLeads` | `#L75` | L82 |
  | `allParsedLeads` | `#L76` | L83 |
  | `_lastCrossRegionCollations` | `#L82` | L89 |
  | `filterState` | `#L83` | L90 |

- Two prose anchors are also stale:
  - The `gateAccessToken` read is at `#L103` in the record; the code has L110.
  - EXC-017's `#L139` points at a comment; the early return is at L146.
- `allParsedLeads` is "written by … `#L566`"; the real line is L584 (see JS-003).
- `_accessedHeaderKeys` (L73) is not mentioned.
- Used By is very incomplete: about ten tab modules read `leads`/`issueLeads`/`filterState` declared here. This is a judgement call, but the list as written implies a narrow blast radius.

### JS-010 core-ui.js — MATERIALLY WRONG (overlay id, registry contents)
- **FN-071 says the overlay is `#loadingOverlay`. The real ids are `#renderLoadingOverlay` / `#renderLoadingOverlayText`** (L45/L47).
- **`_logLeadRegistry` stores the lead's combined comment *text*, not a lead reference** (`logToggleMarkup` L96: `set(logId, combined)`). This contradicts FN-073 ("registers the lead") and "Data lineage"/"Lifecycle" ("transient references to leads").
- FN-072 `toggleActionLog` "Calls `parseActionLog` / `istStamp`": it calls `parseActionLog` and `actionLogTableMarkup` (JS-007), not `istStamp`.
- FN-073 "Calls —": it calls `combinedCommentsText` and `parseActionLog` (JS-007).
- Load-order claim (eighth) is correct.

### JS-011 main.js — ACCURATE
- The 4 bootstrap calls are verbatim (L11-14).
- Minor: Used By lists `JS-023`, which does not reference main.js.

### JS-012 overview-distribution-people-ops.js — MINOR DRIFT (one wrong caller)
- **Location: "1595 lines" vs 1571.** The file was 1571 lines at `9efec5d`, its own verify commit (the KPI-tile removal shrank it).
- FN-080:
  - The range `#L17..#L796` misses `renderRegionTable`/`TLTable`/`ProjectTable` (L861-L946).
  - **`renderSourceBreakdown` is not called by `renderAll`.** Its only caller is `fetchAndRender` (`core-fetch-and-render.js:581`).
- FN-081 range starts `#L1084`; `renderDueTodayList` is at L1079.
- `renderStalledFlaggedLeadsOps` (`tab-movement.js:709`) is called from `renderAll` (L224 area) but is not listed in FN-077.
- Missing items:
  - `lastCommentTimestamp` (L1321)
  - `kpiTile` (L149)
  - `NAV_SECTIONS`/`OFFTAB_COUNT_SECTIONS` (L271/L280)
  - `ISSUE_COLOR_MAP` (L1413)
  - the `_rmScoreRowsCache` pair (L487-488)
- The tab-switch handler's `recordComponentUsage` call (L353) means **every tab click is a Sheet write** (`Feature_Usage`). It is mentioned in Version history, but not in Side effects or UI relationships.
- Depends On misses `JS-018` (`recordComponentUsage`) and `JS-003` (`fetchAndRender` on `#refreshBtn`).

### JS-013 repeat-offenders-pdf.js — ACCURATE
- All 9 anchors resolve, and the cache-read design matches the code.
- Minor: module state is unlisted (`_repeatOffendersPdfGenerating` L67, `REPEAT_OFFENDERS_PDF_*` constants).
- Line 137 still names the phantom helpers `primaryManagerForRm`/`_repeatOffendersRegionKey`, correctly saying they are "not" used any more. That is harmless, but those names no longer exist anywhere in code.

### JS-014 reports-build.js — MATERIALLY WRONG (EXC-025)
- **EXC-025 is wrong.** It says "`mainRegionFor` returns a fallback bucket ('Unassigned') … appears in an 'Unassigned' report section". In code:
  - `mainRegionFor` returns **`null`** (L105).
  - `groupItemsByReportRegion` **silently skips** that item (L155, `if (!main) return;`).
  - Out-of-scope counts are surfaced instead through `_lastReportOutOfScope*` (L164-173) and `reportScopeNotice()` ("NOT IN REPORTS").
- Missing functions: `istDayLabelWithDow`, `todayDateLabel`, `groupBy`, `joinAnd`, `selectedSourceLabel`, `selectedRegionLabel`.
- Constants unlisted (CFG-worthy):
  - `ISSUE_REPORT_META` (L219)
  - `ISSUE_ACTION_MAP` (L252)
  - `EMAIL_SIGNATURE` (L313)
  - `_EMAILABLE_FLAG_KEYS` (L651)
- The 11-region count and the HNI→SoBo fold are confirmed.

### JS-015 reports-gmail.js — MINOR DRIFT
- The function anchors resolve. The undocumented items are constants and state:
  - `GMAIL_SCOPE`
  - `DEFAULT_CLIENT_ID` (L42), which JS-001 relies on
  - `GMAIL_SENT_WINDOW_MS`
  - token state (L33-57)
- The `TEST_MODE_OVERRIDE_EMAIL_ #L43` cross-file anchor into `EmailInfra.gs` is correct.
- Depends On lists `JS-001`; the code reference goes the other way (JS-001 calls this file's `getGmailClientId`).
- Used By misses `JS-021`, which calls `sendReportViaGmail`/`sendAllReportsGmail` from the Overnight report HTML (`tab-movement.js:1350/1361`).

### JS-016 reports-ui.js — MINOR DRIFT
- FN-115's range ends `#L133`, but the listed functions end at L125. FN-118's `#L337` start points at nothing; `syncReportControls` is at L371.
- Missing functions: `reportRegionNames` (L45), `emailChipBoxHTML` (L78), `renderRegionReports` (L302). `renderRegionReports` is the actual per-issue report renderer called from `renderReports` L395.
- `renderAllRegionReports` also calls `renderMorningBrief` (L514); only `renderReports` is cited.
- The `TEST_MODE_OVERRIDE_EMAIL` `#L212` description is confirmed accurate.

### JS-017 rm-performance-worker.js — MATERIALLY WRONG (message contract, EXC-032)
- **"## Message contract" is stale:**
  - IN is listed as `{dateKeys, filters, rmHierarchyByNameLower}`. The real payload also carries **`snapshots`** and **`nowMs`** (`tab-repeat-offenders.js:416-425`; the worker's own header comment, L51-62).
  - The progress stages omit `'opp'` (posted at L135).
  - The count "3–5" should be "4–6".
- FN-119's Inputs also omit `snapshots`. (FN-119 `onmessage` `#L98` is correct: it is an assignment, `onmessage = function`.)
- **EXC-032 is wrong.** It says that on a worker `{type:'error'}`, "JS-022 leaves the last good table on screen". Real behaviour: `onFail` → `_runRepeatOffendersSynchronously` (`tab-repeat-offenders.js:383-386, 407`). The tab **falls back to a main-thread recompute**, with a "Recalculation failed … falling back" status.

### JS-018 sheets-writeback.js — MINOR DRIFT
- **Location: "909 lines" vs 1028.** The file was 1028 lines at `ad481cf`, its own verify commit.
- FN-129's `#L506` and `#L479–#L690` are stale. The real lines are `upsertDailyCohortHistoryRows` L527 and the helper span L500–L711.
- Missing functions: `setFollowupsPushStatus` (L120) and `setSnapshotStatus` (L825).
- Constants and tab names unlisted:
  - `AUTO_SNAPSHOT_KEY`
  - `SEND_LOG_*`
  - `DAILY_COHORT_HISTORY_*`
  - `FEATURE_USAGE_*`
  - `TRACKED_COMPONENT_IDS` (L951)
- FN-128's "Called by … `MovementTracker`-equivalent checkpoints" is vague and wrong. The real callers are `snapshotSlaHistory` and the backfill button.
- `browserSnapshotOpenLeads` also calls `snapshotSlaHistory` (L893, JS-004) and `renderTrackingTab` (L902, JS-024). Depends On lacks both `JS-004` and `JS-024`.
- `backfillDailyCohortHistoryFromMovementLog` calls `computeDailyCohortByRegion` (L694, JS-024).

### JS-019 tab-audit.js — MINOR DRIFT
- All FN anchors resolve.
- FN-132 "caches on the lead object": it actually caches in a `WeakMap`, `_updateEventsForCache` (L55).
- Unlisted constants: `AUDIT_PRESETS` (L15, the period definitions, Monday-start weeks) and `HOUR_LABELS`.
- EXC-040 (clipboard throws `TypeError`) is confirmed at L241-249. **TAB-006 still contradicts it** (see below).

### JS-020 tab-morning.js — MINOR DRIFT
- The anchors and the 10-card / no-new-logic claims are confirmed (`briefCard` is called 11 times, including the definition).
- **No mention that the tab has been unreachable since 2026-10-03.** TAB-001 and DASH-001 carry this; the owning JS record does not.
- FN-138 Called-by omits `renderAllRegionReports` (`reports-ui.js:514`).
- Depends On lacks `JS-002`, `JS-006` and `JS-009` (it reads `leads`/`issueLeads`/`_renderNow`).

### JS-021 tab-movement.js — MINOR DRIFT (several unlisted functions, one phantom label)
- **Location: "1423 lines" vs 1435.** The file was 1435 lines at `7799e44`, its own verify commit.
- FN-146's range `#L964–#L1167` is stale. `computeOvernightCohort` is at L1071 and the group spans L1071–L1274.
- FN-149's range `#L444–#L503` is stale; the real span is L535–L596.
- **`applyMovementFilters` (L607) is undocumented.** It is a *second* global-filter predicate, distinct from `passesMovementFilters`. It also applies the top-bar Assigned-date range, and it drives:
  - Stalled Leads (L699/L720)
  - the Overnight cohort (L1096)
  - the issues CSV (`overview-…:1541`)

  RULE-026 compares only `passesMovementFilters` with `passesRepeatOffenderFilters`.
- `renderStalledFlaggedLeadsOps` (L709) renders into **Operations** (`#sec-stalled`). The record references it as "(FN-146)", but FN-146 is the Overnight group, so the label is phantom.
- Also unlisted:
  - `currentDateFilterRange` (L479), used by `tab-rmtimeline.js` and `tab-tracking.js`
  - `movementChangedBetween` (L520)
  - `fmtHoursSpan` (L758)
  - state: `movementFetchError`, `MOVEMENT_LOG_TAB_NAME`, `LEAD_FOLLOWUPS_TAB_NAME`, `SLA_HISTORY_TAB_NAME`, and several caches
- Depends On lacks `JS-015`/`JS-016` (Overnight Gmail/mailto actions) and `JS-024`.

### JS-022 tab-repeat-offenders.js — MATERIALLY WRONG (filters, EXC-047, phantom state)
- **"Owns this report's own filter set (separate from the shared filter bar since 2026-09-07)" is false** (Purpose and Responsibilities).
  - `captureRepeatOffendersFilterSnapshot` (L124-132) copies the **global** `filterState` Sets.
  - The tab's only own control is the Time range select plus custom From/To (`dashboard.html` L1135-1147).
  - The code's own comment (L116-119) says filter changes route through `applyFiltersAndRender → renderAll → renderRepeatOffenders`.
- **EXC-047 is wrong.** It says "worker posts `{type:'error'}` → logged; the previous good table stays". In fact it falls back to `_runRepeatOffendersSynchronously` (L407 → L383-386).
- The "State owned here" row `_repeatOffendersRegionKey` is **phantom**: no definition exists anywhere in `js/`. The name appears only in a comment (L104).
- FN-151 says `renderRepeatOffenders` "constructs the `Worker`". Construction is in `runRepeatOffendersRecalculation` (L391), which is FN-153.
- FN-152's range starts `#L124` for `_repeatOffendersUpdateRangeDisplay` (actual L230). Only the range start is wrong.
- Unlisted state:
  - `RM_HIERARCHY_TAB_NAME`/`_COLUMNS` (L58-59)
  - `_repeatOffendersWorker` (L247)
  - `RM_PERF_CLASSIFICATION_CHIP_CLASS`/`_TITLE` (L671/L677)
  - `_REPEAT_OFFENDERS_PROGRESS_LABEL` (L582), which TAB-004 UI-006 cites

### JS-023 tab-rmtimeline.js — MINOR DRIFT
- All FN anchors resolve; `_rmtlLastRM` (L15) is unlisted.
- FN-157 "Calls … `passesMovementFilters`" is fine.
- `renderRMIssueHistory` uses `currentDateFilterRange` (JS-021, L196) and `defaultDateRangeValue` (JS-004, L92). Neither is in Depends On.
- Code-side note: the comment at `tab-rmtimeline.js:94` calls `istDateKey(new Date())` "browser-local 'today', not IST". `istDateKey` is IST, so the comment is wrong. The catalog should not copy it.
- Depends On lists `JS-011`, but main.js calls this file, not the other way round.

### JS-024 tab-tracking.js — MINOR DRIFT
- Load-order prose says "tab-audit → tab-tracking → tab-rmtimeline". The real order is tab-tracking → **tab-oppmonitor** → tab-rmtimeline. The conclusion, that `buildTrackingChartSvg` is defined first, still holds.
- FN-172's range `#L1336–#L1403` is stale; the real span is L1299–L1394.
- FN-165 says the chart has "native `<title>` tooltips today". There is a real floating tooltip: `_ensureChartHoverTip` plus a delegated `mousemove` on `[data-tt]` (L480-505). The description, and TAB-008 UI-013, are stale.
- **FN-169 "Called by … `#backfillDailyCohortHistoryBtn` (BTN-021)" is wrong.** The button calls `backfillDailyCohortHistoryFromMovementLog` (JS-018, `tab-tracking.js:575`). `persistDailyCohortHistory`'s only caller is `fetchAndRender` (`core-fetch-and-render.js:616`), not "auto after a snapshot".
- Missing functions: `debugDailyCohortEvidence` (L214), `emptyCohortBucket`/`addCohortBucket` (L1286/1289).
- Missing constants: `TRACKING_SHORT_LABEL` (L9) and the cache maps.
- Used By misses `JS-003`, `JS-018`, `JS-021` and `JS-025` (`wowDeltaBadgeHtml`).

### JS-025 tab-oppmonitor.js — MATERIALLY WRONG (live-row scope; same defect as TAB-009)
- The anchors resolve.
- Missing functions: `_oppMonitorStepDone` (L228), `_oppMonitorStepChipHtml` (L232), `_oppMonitorOrderedPeriodSlots` (L301).
- Missing constants: the tab-name and fetch-state variables (L24-41) and `OPP_MONITOR_MONTH_NAMES_` (L120).
- **FN-268/269: the live gap-fill is passed the global `leads` (L348, L411).** `leads` is the **filtered** array:
  - project/region/TL/source/bucket from `filterState`
  - **plus the top-bar Assigned-date range, which defaults to the last 7 days** (`defaultDateRangeValue`, `core-filters.js:230/272`)

  The records repeatedly present these live rows as fixed, filter-independent aggregates. That is false. With default settings, a "Live" month row only counts leads assigned in the last 7 days. Because the filter bar is hidden on this tab, the user cannot even see that a filter applies. **This is also a code defect**, worth passing to the code auditors: the gap-fill should probably use `allParsedLeads`.
- Depends On lists `JS-003`. It reads `leads`, which is declared in JS-009 and written by JS-004.

### TAB-001 Morning Brief — MATERIALLY WRONG (renderAll relationship, gating)
- The hidden-tab facts are correct: there is no `#tabBar` button (`dashboard.html` L938-947), and the panel still exists at L950 (anchor correct).
- **"Kept out of `renderAll()`" / "Not part of `renderAll()`" is false** (Purpose, Navigation). `renderAll` calls `renderMorningBrief()` when `_refreshMorningBriefOnNextRender` is set (`overview-…:172-175`). The flag is set by every `fetchAndRender` (`core-fetch-and-render.js:40`).
- **"Re-called … at Generate checkpoints, gated by `_refreshMorningBriefOnNextRender`" is false.** Those calls are unconditional:
  - `reports-ui.js:393`
  - `reports-ui.js:514`
  - `tab-movement.js:1277`

  Only the `renderAll` path is gated.
- Net effect, worth stating: the hidden panel is still fully computed on every real refresh and every Generate.
- Outputs: the cards render into `#morningBriefCards` (inside `#tab-morning`). That is fine.

### TAB-002 Overview — MATERIALLY WRONG (contents list)
- The 4-tile KPI strip (Total Leads / Behind on Today's Calls / Not Connected in 10 min / No Attempts Yet) is confirmed (`overview-…:190-209`).
- **"Render … TL … breakdown tables" is wrong.** The TL table (`#sec-tl`) is in **People** (`dashboard.html` ~L1167).
- The Overview panel actually contains:
  - `#sourceBreakdown`
  - `#stageBreakdown`
  - `#kpiStrip`
  - `#jumpNav`
  - Funnel
  - **Daily Trend** (`#sec-trend`)
  - Region
  - Project

  Daily Trend and the jump nav are never mentioned.
- "Feeds the `#sourceBreakdown` region": `renderSourceBreakdown` is called from `fetchAndRender`, not from `renderAll`. So the source breakdown does **not** re-render on a filter change; this is worth stating explicitly.
- Top-bar controls are listed as "Download Lead IDs, Clear filters, Refresh, Change source". The button is labelled "Reset filters" (`#clearFiltersBtn`). The list also omits Snapshot now / Auto-snapshot (`#snapshotNowBtn` L888, `#autoSnapshotCheck` L890), which also live in the top bar.

### TAB-003 Operations — MINOR DRIFT
- **The Stalled Leads section (`#sec-stalled`, the first section in the panel, L1001) is never mentioned.** It is rendered by `renderStalledFlaggedLeadsOps` (JS-021), so JS-021 should also be an owning module.
- `_generateCycleOwner` is cited at `JS-018 #L275`; the code has **L296**.
- Button labels differ from the UI:

  | BTN | Record label | Real label |
  |---|---|---|
  | BTN-003 | "Generate (all regions)" | "Generate all issues × regions" |
  | BTN-004 | "Download all reports" | "Download all as .txt" |
  | BTN-007 | "Save Client ID" | "Save & Connect" (it also connects) |

- Unlisted controls: `#reportModeSelect`, `#reportIssueSelect`, `#combineRegionsCheck`, `#gmailClientIdInput`.
- The `TEST_MODE_OVERRIDE_EMAIL` `#L212` reference is confirmed.

### TAB-004 Repeat Offenders — MATERIALLY WRONG (filters, what is displayed, shared helpers)
- **Inputs and UI-005 claim a private Project/Region/TL/Source/Sub-source filter set "deliberately separate from the shared filter bar since 2026-09-07".** In reality the tab uses the global `filterState`; see JS-022. Its only own controls are the Time range select, custom From/To, Recalculate and Download PDF. The record's own Purpose bullet ("only work with global filters in dashboard") contradicts it.
- **Data displayed is stale:**
  - It lists "Avg Flagged" and a "'driven by' contributor list". Both were removed: "Driven by" on 2026-09-07 (JS-008 FN-320 confirms it is dead code), and "Avg Flagged" by the 2026-09-04 redesign (the panel's own `filter-summary` text says so).
  - Real columns (`tab-repeat-offenders.js:698-708`): #, Name, Unique Leads, Status, Score (vs peer), Instances, Same-Day Opp%, 48h Opp%, Region, RMs, A1/TM, RH.
- **"RM / A1-TM / RH tables show Below Expectations only, worst first … the PDF shows Below-Expectations-only in all 4 tables" is false.** Both the tab (L537-543) and the PDF (`repeat-offenders-pdf.js:158`) use `filterRmPerformanceRankable` + `sortRmPerformanceByScore`: every rankable row, excluding only Insufficient Data, with RM capped at 20. `filterRmPerformanceWorst` only feeds a count (L545).
- Navigation names shared helpers `primaryManagerForRm` / `_repeatOffendersRegionKey`. **Neither exists any more**: they were renamed (`rmPerfPrimaryManagerFor`, `repeatOffendersRegionKey`) and, since `9dea24a`, the PDF does not use them. The "Relevant functions" section also omits `runRepeatOffendersRecalculation`.
- The Promise.all gate is cited "~`#L624`"; the code has L642.

### TAB-005 People — MINOR DRIFT
- The content (RM score over open leads, ±25% load at L1025-1031, RM Timeline scoping) is confirmed.
- The panel actually contains:
  - `#sec-rmscore`
  - `#sec-tl`
  - `#sec-rm`
  - `#sec-fanout`
  - `#sec-matrix`
  - `#sec-sourcemix`
  - the 4 `#sec-rmtl-*` sections
- "Per-TL score tables" is loose: `renderTLTable` is a TL breakdown, not a TL score table (the TL rollup lives inside the RM score rows). The Source-mix section is unnamed.
- UI-008 "CSS-only hover today" agrees with JS-023.

### TAB-006 Audit — MATERIALLY WRONG (BTN-012 failure behaviour), MINOR otherwise
- **Location anchor `#L1234`; `id="tab-audit"` is at L1233.**
- **BTN-012 failure behaviour says "clipboard-API failure → no-op, button text unchanged". This is exactly the claim JS-019 corrected on 2026-09-30:** `copyAuditIds` throws a synchronous `TypeError` when `navigator.clipboard` is undefined (`tab-audit.js:241-249`). The tab record was never synced.
- BTN-013 "audit CSV handler" should name `downloadAuditCSV`.

### TAB-007 Movement — MATERIALLY WRONG (sections, filters)
- **Responsibilities say "Render Stalled Leads …"** in this tab. Stalled Leads is in **Operations** (`#sec-stalled` L1001). The Movement panel contains only:
  - `#sec-overnight`
  - `#sec-rmstall`
  - `#sec-opportunitytime`
  - `#sec-unmatched-comments`
- **UI-012 "Movement filter multi-selects"** does not exist. Movement has no multi-selects of its own; it uses the global bar via `applyFiltersAndRender`, with `applyMovementFilters`/`passesMovementFilters`.
- `_generateCycleOwner` is cited `#L275`; the code has L296.
- BTN-014/015 are correctly noted as living in the top bar.
- Relevant functions omit `applyMovementFilters`.

### TAB-008 Tracking — MINOR DRIFT
- BTN-021 "Invokes `upsertDailyCohortHistoryRows`": the button calls `backfillDailyCohortHistoryFromMovementLog` (JS-018, `tab-tracking.js:575`).
- BTN-022 "clear handler (`JS-024`)": the delete itself is `clearDailyCohortHistory` in **JS-018** (L711). JS-024 only wires the button. The data-written table repeats the same mis-attribution.
- BTN-022's "Confirm/irreversible" should also say that a `confirm()` dialog guards it (L586); BTN-020 likewise (L540).
- "Relevant functions" lists `evidenceAtDeadline` under `JS-024`. It moved to **JS-021** on 2026-09-29.
- UI-013 "native `<title>` tooltip today" is stale; a custom `[data-tt]` hover tip exists (`tab-tracking.js:480-505`).
- `persistDailyCohortHistory` is described as "auto (on snapshot)". It runs once per `fetchAndRender` (`core-fetch-and-render.js:616`), not on snapshot.

### TAB-009 Opp Monitor — MATERIALLY WRONG (filter independence)
- The filter-bar hiding (`TABS_HIDING_FILTER_BAR`, `overview-…:342-366`) and the absence of buttons are confirmed.
- **"Still no `filterState`" / "both the official and live numbers are fixed aggregates for the stated scope" is false for the Live rows.** See JS-025: they are computed from the filtered `leads`, including the default 7-day Assigned-date window.
- Location has no line anchor; `id="tab-oppmonitor"` is at L1388.

### DASH-001 Leads Dashboard — MATERIALLY WRONG (several structural claims)
- **"Render all 8 tabs (`TAB-001`..`TAB-008`)"**, and the Outputs row, should say 9 tabs (TAB-009 exists). Depends On also omits `TAB-009`.
- **"No inline `onclick` … all interactivity is wired by `addEventListener`" is false for generated markup.** The shell has 0 `onclick`, but the JS emits 18 inline `onclick=` handlers:

  | File | `onclick=` count |
  |---|---|
  | `reports-ui.js` | 11 |
  | `tab-movement.js` | 4 |
  | `core-ui.js` (`toggleActionLog`) | 1 |
  | `reports-build.js` | 1 |
  | `overview-…` | 1 |
  | `core-fetch-and-render.js` | 1 |

  JS-015 FN-107 itself documents "onclick handlers in generated report HTML".
- **"Every write … all via `JS-018`, the single client write module" is false.** `clearSlaHistory` (JS-004) does its own raw `fetch(:batchUpdate)` (`core-filters.js:213`), which JS-004 and TAB-008 both document.
- **The Writes list omits** `Movement_Log_Runs` (SHEET-015) and **`Feature_Usage` (SHEET-018)**, which is written on every tab click.
- **The Reads list omits** `Opp_Monitor_Period/Month` (SHEET-016/017) and the `Lead_Followups` polling read (`waitForAllFollowups`).
- **"Tab switch … pure `display` toggle — content is pre-rendered, not re-rendered on switch"** omits two things the handler does: it hides or shows the filter bar, and it writes `Feature_Usage` (`overview-…:353`).
- Line counts:
  - "~1429 lines" should be 1456.
  - "~815-line `<style>`": the real block is L24–L839, about 815 lines, so that one is fine.
  - "all 24 local `js/*.js` files" conflicts with the Location field's "25 client modules": 24 are script-loaded and 1 is the Worker.
- **Top-level actions:**
  - Sign in is wired to `handleGateSignInClick`, not `gateSignIn` directly.
  - Fetch is `#refreshBtn`, not "`#sheetIdInput` + fetch button".
  - Missing: `#snapshotNowBtn`, `#autoSnapshotCheck`, `#clearFiltersBtn`, `#downloadLeadIdsBtn`, `#changeSourceBtn`.
  - It also files "Snapshot Now" under tab-scoped buttons, but the button lives in the top bar.

### READMEs — MINOR DRIFT
- `docs/js-modules/README.md` says "all 24 `js/*.js` files … JS-001..JS-024". There are 25 files and 25 records (JS-025 exists).
- `docs/tabs/README.md` says "the 8 dashboard UI tabs … BTN-001..BTN-022". There are 9 TAB records.

## 3. Coverage gaps

- **JS files with no record: none.** All 25 `js/*.js` files map 1:1 to JS-001..JS-025.
- **Top-level functions not mentioned anywhere in their own record** (about 40). The most consequential:
  - `applyMovementFilters` (JS-021): the second global-filter predicate.
  - `renderStalledFlaggedLeadsOps` (JS-021): renders an Operations section; it is only referenced under a wrong FN label.
  - `countCollatedAmong` (JS-002): the real backer of `collatedCountText`.
  - `actionLogTableMarkup` (JS-007): used by JS-010.
  - `renderRegionReports` (JS-016): the per-issue report renderer.
  - `defaultDateRangeValue` (JS-004): the non-IST exception.
  - `currentDateFilterRange` (JS-021): used by 3 files.
  - `sortRmPerformanceByScore` (JS-008): anchor wrong, and it is the sort actually used.
  - The full per-file lists are in §2.
- **Constants and state with no CFG/state row** that would plausibly need changing:
  - `RM_PERF_RULES` (JS-008)
  - `ISSUE_REPORT_META`, `ISSUE_ACTION_MAP`, `EMAIL_SIGNATURE` (JS-014)
  - `GMAIL_SCOPE`, `DEFAULT_CLIENT_ID` (JS-015)
  - `TRACKED_COMPONENT_IDS` and the tab-name constants (JS-018)
  - `AUDIT_PRESETS` (JS-019)
  - `TABS_HIDING_FILTER_BAR` (JS-012): it is described, but there is no CFG row.
- **Phantom references** (names that do not exist in code):
  - `_repeatOffendersRegionKey`, as JS-022 state and in TAB-004
  - `primaryManagerForRm` (TAB-004)
  - `#errorBanner` (JS-003)
  - `#loadingOverlay` (JS-010)
  - "Avg Flagged" / "driven by" columns (TAB-004)
  - "Unassigned" region bucket (JS-014)
  - "Movement filter multi-selects" (TAB-007)
- **Line counts in `Location` are wrong even though `Last Verified` names the commit that set them:**

  | Record | Record says | Real |
  |---|---|---|
  | JS-003 | 665 | 689 |
  | JS-006 | 449 | 500 |
  | JS-007 | 934 | 933 |
  | JS-012 | 1595 | 1571 |
  | JS-018 | 909 | 1028 |
  | JS-021 | 1423 | 1435 |

  The revalidation step evidently checks the claims touched by a change, not the header. `check-staleness.py` does not catch this either.
- **INDEX vs record `Depends On` disagree** for JS-003: INDEX has JS-018 and the record lacks it; both lack JS-024. JS-005 is "none" in both, but the code uses JS-006 and JS-010.

## 4. Prioritised fixes (not made)

**P1: behaviour or UI claims that would mislead someone changing code**

1. **TAB-004 + JS-022:** remove the "own/private filter set" claim and state that the tab snapshots the global `filterState`. Replace "Below Expectations only, worst first" with "rankable (all but Insufficient Data), by score, RM capped at 20". Replace the stale column list. Drop the phantom `primaryManagerForRm`/`_repeatOffendersRegionKey`.
2. **JS-022 EXC-047 and JS-017 EXC-032:** a worker error falls back to the synchronous recompute; it does not keep the old table. Also update JS-017's message contract: IN gains `snapshots`/`nowMs`, progress gains `'opp'`, and the count becomes 4–6.
3. **TAB-009 + JS-025:** Live rows depend on `filterState` and the Assigned-date range, which defaults to 7 days, while the filter bar is hidden. Either correct the docs, or, preferably, raise this as a code defect so the gap-fill uses `allParsedLeads`.
4. **TAB-001:** Morning Brief *is* rendered from `renderAll()` (gated on a real refresh), and the Generate-checkpoint calls are *ungated*. Mirror the hidden-tab note into JS-020.
5. **JS-006 EXC-011:** with no baseline, the fallback is the comment-log count (`loggedToday`), not the absolute `call_attempts`.
6. **JS-014 EXC-025:** an unresolved region is excluded and counted as out-of-scope ("NOT IN REPORTS"); there is no "Unassigned" bucket.
7. **TAB-006 BTN-012:** sync with JS-019 EXC-040: the click throws a `TypeError`, it is not a no-op.
8. **TAB-007:** move Stalled Leads to TAB-003, where JS-021 should be an owning module, and delete UI-012.
9. **DASH-001:**
   - Make it 9 tabs and add TAB-009 to Depends On.
   - Drop "no inline onclick", "single write module" and "pure display toggle".
   - Add SHEET-015, SHEET-016, SHEET-017 and SHEET-018 plus the Lead_Followups read.
   - Fix the top-bar action list.
10. **JS-010:** use the overlay id `#renderLoadingOverlay`, and state that the registry holds comment text, not leads.

**P2: wrong callers, ids, labels and attributions**

11. JS-003 `#errorBanner`→`#errorBox`. Also: `#changeSourceBtn` is not a caller, add `BAD_RANGE`, list the direct callees, and add `JS-018`/`JS-024` to Depends On.
12. JS-004:
    - FN-020's caller list (remove core-auth; add the date inputs and `buildFilterUI`)
    - FN-022 FN-024→FN-023
    - FN-024's real callers
    - add `defaultDateRangeValue` and its non-IST note
13. JS-002 FN-013/FN-014 call graph and return shape; add `countCollatedAmong`/`uniqueCloneLabel`/`numWithClone`; "collated"→"cloned".
14. JS-012: `renderSourceBreakdown` is called by `fetchAndRender`, not `renderAll`. Add `renderStalledFlaggedLeadsOps` to FN-077 and the Feature_Usage write on tab switch.
15. JS-024 FN-169 caller (`fetchAndRender`, not BTN-021); TAB-008 BTN-021/BTN-022 function attribution; `evidenceAtDeadline` → JS-021.
16. JS-001 FN-002 caller; JS-021 add `applyMovementFilters` and drop the phantom "(FN-146)" label.
17. TAB-002 contents (no TL table; add Daily Trend and the jump nav; Source breakdown is not filter-reactive); TAB-003 add Stalled Leads and the real button labels.

**P3: anchors, counts, completeness**

18. Refresh the `Location` line counts in JS-003, JS-006, JS-007, JS-012, JS-018 and JS-021.
19. Stale anchors:

    | Record | Stale anchors |
    |---|---|
    | JS-003 | EXC/RULE/lineage anchors |
    | JS-008 | FN-064 ByScore; CFG-074/075; EXC-014 |
    | JS-009 | state table (+7); `#L103`; `#L139` |
    | JS-012 | FN-080/081 ranges |
    | JS-016 | FN-115/118 ranges |
    | JS-018 | FN-129 |
    | JS-021 | FN-146/149 |
    | JS-022 | FN-152 start |
    | JS-024 | FN-172 |
    | TAB-003/007 | `#L275` → L296 |
    | TAB-004 | `#L624` → L642 |
    | TAB-006 | `#L1234` → L1233 |

20. Add the unlisted functions and CFG/state rows from §2 and §3. Fix the two READMEs (25 JS records; 9 tabs).
21. Reconcile `Depends On` for JS-003 (and JS-005's "none") between the records and `docs/INDEX.md`.
22. Process suggestion: add a `FACT_CLAIMS` row to `test/check-staleness.py` for the `Location` "(N lines)" header of each JS record. It drifted in 6 of 25 records, each against its own verify commit.
