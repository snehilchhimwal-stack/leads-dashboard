# Code audit H — dashboard tab files (browser side)

Auditor: H (one of 9 parallel line-by-line auditors), 2026-10-10, against `HEAD` = `19038e7`.
Read-only audit: no code was edited, nothing was committed, nothing live was touched.

## 1. Scope and summary

**Files read in full, every line:**

| File | Lines | Role |
|---|---|---|
| `js/overview-distribution-people-ops.js` | 1571 | `renderAll()` orchestrator, tab switching, Overview KPIs/funnel/trend, People tables, the 5 Operations SLA lists + 4 non-SLA lists, CSV exports |
| `js/tab-audit.js` | 299 | Audit tab: "which leads were touched in period X", activity-by-hour chart |
| `js/tab-tracking.js` | 1458 | Tracking tab: issue trend chart, From/To table, fixed cohort, 0–48h cohort, Daily Cohort by Region, Week-over-Week, history admin buttons |
| `js/tab-oppmonitor.js` | 445 | Opp Monitor tab: 12-step checklist + Period/Month tables (sheet rows + "Live" fill-ins) |
| `js/tab-rmtimeline.js` | 309 | RM Timeline tab: 7-day calendar, day timeline, current issues, issue history chart |
| `js/tab-movement.js` | 1435 | Movement_Log fetch/parse/cache, shared Movement helpers, Stalled Leads, RM Stall Leaderboard, Time to Opportunity, Unmatched Comments, Overnight cohort + its region emails |
| `js/tab-repeat-offenders.js` | 810 | Repeat Offenders tab: RM_Hierarchy fetch, Worker orchestration, result cache, table rendering |
| `js/repeat-offenders-pdf.js` | 572 | Repeat Offenders "Download PDF" (jsPDF + autoTable), built from the cached result |
| `js/tab-morning.js` | 251 | Morning Brief (10 cards). Tab button removed 2026-10-03; still rendered into a hidden panel |

Core helpers (`core-*.js`, `reports-build.js`, `sheets-writeback.js`, `MovementTracker.gs`) were opened only where needed to judge behaviour.

**Summary.** These nine files are the whole "what the user sees" layer of the dashboard. All of them render from four module-level datasets built elsewhere: `leads` (one record per customer, **filtered** by the top filter bar including the Assigned-date range, which defaults to the last 7 days), `issueLeads` (same filter, but every multi-RM customer split back into per-copy records — feeds every SLA list), `allParsedLeads` (the unfiltered, collated live sheet) and `movementSnapshots` (the parsed `Movement_Log` history, ~7 days). `renderAll()` re-renders every tab on every filter change. Escaping is generally careful (`esc()` everywhere user/sheet text meets `innerHTML`), IST handling is mostly correct via the `istParts`/`istDateKey` core, and the main counting conventions (customer vs copy, `uniqueCloneLabel`) are applied consistently. The serious problems are not in rendering but in **data assumptions that have drifted**: (1) since the 2026-09-11 content-hash dedup, `Movement_Log` only gets a row when a lead *changes*, yet the Tracking chart, From/To table, fixed cohort, RM issue history and RM Stall Leaderboard still treat each `snapshot_at` run as a complete census of all leads; (2) Opp Monitor's "Live" rows are computed from the filtered `leads` array, so they silently inherit the default 7-day Assigned-date filter (and any other filter) on a tab where the filter bar is hidden; (3) the Week-over-Week cohort recomputes old days from aged-out evidence without the staleness guard its sibling table has. Section 4 lists 28 findings.

---

## 2. Per file

Conventions used below: "reads" = globals read, "writes" = globals or DOM written. `L` = line in that file.

### 2.1 `js/overview-distribution-people-ops.js`

**Purpose.** Main render orchestrator plus the Overview, People and Operations tabs and the CSV exports. Its header says it was pure code motion out of `dashboard.html`.

**Module-level state and constants.**
- `kpiTile` (L149): arrow function that builds a KPI tile (hover card with a detail panel). `opts.numHtml` and `opts.detailHtml` are inserted raw (callers pass numbers or already-escaped HTML); `label` and `detailLabel` are escaped.
- `NAV_SECTIONS` (L271): the 4 Overview jump-nav entries (Funnel, Daily Volume, Regions, Projects). Only Projects has a count.
- `OFFTAB_COUNT_SECTIONS` (L280): 16 sections on other tabs whose count pill gets severity styling (`urgent`/`has-items`/`clear`).
- `TABS_HIDING_FILTER_BAR` (L343): `{'tab-oppmonitor'}`.
- `_rmScoreRowsCacheSrc` / `_rmScoreRowsCache` (L487–488): memo for `computeRMScoreRows`, keyed on the identity of the `leads` array.
- `ISSUE_COLOR_MAP` (L1413) / `ISSUE_COLOR_FALLBACK` (L1424): fixed colour per `ISSUE_PRIORITY` label, so chart colours stay stable.
- Top-level listeners: `#tabBar` click (L345), `#refreshBtn` → `fetchAndRender()` (L1377), `#changeSourceBtn` shows `#configPanel` (L1378), `#dateFromInput`/`#dateToInput` change → `applyFiltersAndRender()` once data exists (L1381–1386), the three CSV buttons (L1569–1571; the third calls `downloadUnmatchedCommentsCSV` from `tab-movement.js`).

**Functions, in file order.**

- **`renderStageBreakdown()` L17.** Writes `#stageBreakdown`. One pass over `leads`, bucketing by raw trimmed `current_stage` (`'(blank)'` if empty). Per bucket: count `n`, `booking` (`isBookingLead`), `collated` (`collatedFrom>1`). Sorted by count, descending. Per row: tag Closed (red, `isClosedStage`) / Opportunity+ (green, `isOppOrAbove`) / Open. Funnel band = `canonicalStage(stage)`; overridden to `booking` if every lead in the bucket is a booking, or `"<band> / booking (mixed)"` if some are. If there is no band and the stage is closed, the band shows "Exits funnel"; otherwise "NO FUNNEL BAND" in amber, and the count is added to `unmapped`. Bar width = % of `leads.length`. Footer warning when `unmapped>0`. Empty `leads` → "No leads match". Reads `leads`.
- **`renderSourceBreakdown(sourceCounts, dedupedLeads)` L90.** Called once per fetch from `core-fetch-and-render.js:581`, with counts over the **unfiltered** deduped sheet (the header says "whole tab (not filtered)"). Shows the top 5 sources as bars, the rest behind an `ⓘ +N more` toggle (`toggleInlineDetail`). Bar % = n / total deduped leads.
- **`topBreakdown(arr, keyFn, opts)` L133.** Groups `arr` with `groupBy` (from `reports-build.js`) by `keyFn(item)||'Unknown'`, keeps the top `opts.limit||4`, and returns `{html, top:{key,pct}}`, or `{html:"Nothing…", top:null}` when empty. Keys are escaped.
- **`renderAll()` L159.** The orchestrator, called by `applyFiltersAndRender` (core-filters) on every filter change and after the Movement_Log fetch resolves. Steps:
  1. `_logLeadRegistry.clear()` (action-log lazy-render registry).
  2. `renderStageBreakdown()`.
  3. If `_refreshMorningBriefOnNextRender` is true, calls `renderMorningBrief()` and resets the flag (only real refreshes set it).
  4. KPI arrays in one pass: `noCallsLeads` = `leads` with `isOpenLead && call_attempts===0`; `dueTodayLeads` = `issueLeads.underCalledToday`; `notConnLeads` = `issueLeads.firstContactBreach`.
  5. Counts: `countUniqueAndCloned` for the two `issueLeads`-based arrays (distinct customers via `familyKeyOf`); `countCollatedAmong` for the `leads`-based ones.
  6. Writes `#kpiStrip` with 4 tiles (details in §3.1).
  7. Calls, in this order: `renderFunnel`, `renderTrackingTab`, `renderRMTimelineTab`, `renderRegionTable`, `renderTLTable`, `renderRMTable`, `renderProjectTable`, `renderStalledFlaggedLeadsOps`, `renderInactiveRmList`, `renderNotUpdatedList`, `renderNotConnectedList`, `renderFollowupList`, `renderDueTodayList`, `renderApproachingDeadlineList`, `renderStuckList`, `renderRecordingList`, `renderClosedNoCommentList`, `renderRepeatOffenders`, `renderDailyTrend`, `renderRMScoreTable`, `renderFanout`, `renderAllocationMatrix`, `renderSourceMix`, `buildAuditControls`, `renderAudit`, `renderActivityByHour`, `renderMovementTab`, `renderOppMonitorTab`, `renderJumpNav`, `updateTabBadges`.
  Every tab re-renders on every pass. Tab switching is just a CSS toggle. `renderRepeatOffenders` starts a new Web Worker on every pass (see H-6).
- **`numFromCountEl(id)` L299.** Returns the first run of digits in an element's text, or null. Note: `"1,234 leads"` would parse as `1`. Harmless today: badges built by `uniqueCloneLabel` are not locale-formatted, and only zero/non-zero matters for severity.
- **`renderJumpNav()` L306.** Builds `#jumpNav` links (badge only for Projects), then for every section in both lists resets the count pill class and adds `severity` when n>0, or `clear` when n===0. When a section has a severity, its `.section-scroll` gets toggled `is-empty`.
- **Tab bar click listener L345.** Toggles `.active` on the button and panel and calls `recordComponentUsage(tab)` (`Feature_Usage`, best-effort). If `#dashboardContent` is visible, sets `#filterBar` to `none` for `tab-oppmonitor`, otherwise `flex`.
- **`updateTabBadges()` L371.** `#tabBadgeOps` = distinct customers in `issueLeads` with any of `inactiveRmNewLead, firstContactBreach, followupOverdue, underCalledToday, stageStuck48h, isNotUpdated`. The tooltip carries the cloned count.
- **`computeDailyLeadCounts()` L397.** `Map<istDateKey(lead_assigned_at), {total,totalCollated,oppPlus}>` over `leads`. IST-correct. Shared with Morning Brief card 1.
- **`renderDailyTrend()` L415.** The last 30 day-keys present (sorted, `slice(-30)`), shown newest first. Bar width is relative to the busiest day (minimum 1.5%); the inner green fill is the `oppPlus/total` share. The date label is built from the key's own digits plus `IST_MONTHS` (no `new Date()` re-parse, so no timezone risk).
- **`medianOfSorted` L465 / `percentileOfSorted(sorted,p)` L470.** Median uses an even-length average; the percentile uses nearest rank `ceil(p/100·n)−1`, clamped. Both return null for empty input.
- **`computeRMScoreRows()` L489.** Memoized on the `leads` reference. Groups by `RM||'Unassigned'` (the TL shown comes from the first lead seen). Accumulates totals and collated counts, `calls`, `durationSec`, `contactMins` (every non-null `businessMinsToConnect`, open or closed), opp/visit/soft booking/booking counts, and, for `isOpenLead` only: `open`, `breached` (any of the 5 SLA checks), and `breachByCheck` per check. Derived fields: `slaScore = round((open−breached)/open·100)` (null when open=0); `avgCalls`; `avgDurationMin = durationSec/calls/60`; `convRate = opp/total·100`; median/p90 contact time and sample size. Sorted worst SLA first, nulls last. Callers: `renderRMScoreTable`, `renderMorningBrief`.
- **`renderRMScoreTable()` L562.** A 14-column table. The SLA cell is heat-coloured (≥80 green, ≥50 amber, else red; null shows "n/a" and is coloured green) and has a hover panel listing `breachByCheck`. The contact cell shows the median with a p90/n hover.
- **`renderFanout()` L615.** Over filtered `leads`: copies = `collatedLeadIds.length || collatedFrom || 1`, which gives a histogram of customers by copy count. Claim stats: each RM in `collatedRMs` (or the RM) has `received++`; it gets `claimed++` when it is the record's own `RM`. Summary: total lead ids, the multi-RM share, average copies, the widest fan-out. Claim table sorted by worst claim rate, capped at 200 rows; heat ≥60 green, ≥30 amber.
- **`renderAllocationMatrix()` L701.** Groups `leads` by `region||TL||RM`. Shows leads, average attempts, average `ageHours`, opp/visit/soft/booking. Sorted by region, then TL (A–Z), then total descending. Capped at 300 rows.
- **`renderSourceMix()` L754.** Region × `group_source` crosstab over `leads`, each cell showing a count and a row %.
- **`renderFunnel()` L791.** Bands come from `CONFIG.FUNNEL_ORDER`. Per lead: soft booking first, then booking, then `canonicalStage`. Width is relative to the largest band (4% floor; the count moves outside the bar below 12%). "% of total" uses `leads.length`. "conv. from prev" = this band / previous band. Bands at or after `CONFIG.OPPORTUNITY_STAGE` get `.opp-stage`. A dashed "Exited" row shows `leads.length − inFunnel`.
- **`renderRegionTable()` L861.** Grouped by raw `l.region` (not `effectiveRegion`); "Reports as" = `mainRegionFor(effectiveRegion(l))` of the first lead seen. Columns: Total, Opp+, Call SLA (`underCalledToday`), Critical % (= Call SLA ÷ Total, **including closed leads**), Not Conn. 10m (`firstContactBreach`), No Attempts (`isOpenLead && call_attempts===0`). The TL list sits in a hover panel.
- **`renderTLTable()` L909.** Grouped by TL: distinct RMs, totals, Opp+, Call SLA, average attempts.
- **`renderProjectTable()` L946.** Grouped by project. Opp % heat (≥15 green, ≥5 amber). Capped at 100 rows.
- **`renderRMTable()` L993.** Grouped by RM: Total/Open/Opp+/Call SLA/Multi-Agent (`isMultiAgent`)/average attempts. "vs Avg (Open)" = (open − mean open over RMs with open>0) / mean, red above +25%, amber below −25%. Summary line: overloaded/under-loaded counts and the multi-agent share.
- **`renderDueTodayList()` L1079.** SLA check "Behind on Today's Calls". `issueLeads.filter(isOpenLead && underCalledToday)`, siblings grouped together, ordered by `ageHours` ascending (newest first). Split at render time into `isUnder48h` (main list; **the badge counts only this part**) and `>48h` (a secondary block). Each card shows `attemptsToday/CONFIG.MIN_CALLS_PER_DAY`, a "New today" chip when `isCreatedToday`, the last comment, and the action-log toggle. Both blocks use `renderCardsByDay` (MAX_CARDS=200 applies before the day bucketing).
- **`renderApproachingDeadlineList()` L1137.** Not an SLA check. Shows `isOpenLead && !stageStuck48h && 36 ≤ ageHours ≤ 48`, oldest first, through `renderAlertCard(…, CONFIG.MIN_CALLS_AFTER_48H)`.
- **`renderStuckList()` L1158.** SLA check "Stuck 48h+": `isOpenLead && stageStuck48h`, oldest first. Above the list, a stage breakdown (`topBreakdown` by `current_stage`, top 6).
- **`renderInactiveRmList()` L1183.** SLA check "Inactive-RM Lead Added": `issueLeads.inactiveRmNewLead`, oldest first. Cards show the "RM marked inactive" chip and the TL.
- **`renderNotUpdatedList()` L1210.** SLA check "Not Updated": `isOpenLead && isNotUpdated`, oldest first. Required calls = `MIN_CALLS_AFTER_48H` if `past48h`, else `MIN_CALLS_PER_DAY`.
- **`renderRecordingList()` L1235.** Not an SLA check. `issueLeads.recordingCommentsNoCalls` with no open/closed gate. The card shows open/closed/Opportunity+ state, the closing reason, and "N comments, 0 calls" or "comment logged, 0 calls". Sets the static `#recordingDesc` text.
- **`renderClosedNoCommentList()` L1291.** Not an SLA check. `issueLeads.closedWithNoComment`.
- **`lastCommentTimestamp(l)` L1321.** Returns `l.lastCommentAt || null`.
- **`renderNotConnectedList()` L1323.** SLA check "Not Connected in 10 min": `issueLeads.firstContactBreach`, ordered by `businessMinsToConnect` descending. The card shows `fmtWorkingWait(mins,'late')` plus assigned and connected stamps.
- **`renderFollowupList()` L1348.** SLA check "Follow-up Overdue": `issueLeads.followupOverdue`, ordered by `hoursSinceLastComment` descending. The card shows the last comment's IST stamp (or "no dated comment since connecting") and the attempt count.
- **`colorForIssue(issue, i)` L1425.** Looks up the fixed map, otherwise falls back to a palette cycling on `i`.
- **`renderBreakdownCard(el, opts)` L1433.** Generic "big number + proportional bar + legend" card used by Movement (Stalled, Overnight). Keys are escaped; `colorFn(k,i)` supplies the colours; `emptyText` is shown when total is 0.
- **`csvEscape(v)` L1474.** Quotes when the value contains `"`, `,` or `\n` and doubles inner quotes. It does not quote `\r` and does not neutralise leading `= + - @` (H-15).
- **`downloadFilteredLeadIdsCSV()` L1488.** One row per lead id (expanding `collatedLeadIds`) for filtered `leads`: `lead_id, client, cloned, clone_id(s)` (the clone ids are the siblings, not including the row's own id). Blob download; the filename stamp is UTC (H-14).
- **`downloadIssuesCSV()` L1517.** Grouped by issue. `issueLeads` × `ISSUE_PRIORITY` (5 keys: inactive-RM, Not Updated, Follow-up Overdue, Behind on Calls, Stuck 48h — note **Not Connected in 10 min is deliberately excluded** from `ISSUE_PRIORITY`, see `core-foundation.js`), plus Recording Not Working, plus Closed with No Comment, plus Stalled Leads (`applyMovementFilters(computeStalledLeads())`). Columns: `issue, lead_id, region, RM Name`. The `ISSUE_PRIORITY` flags are not re-gated by `isOpenLead` here, unlike some on-screen lists (the flags are already open-gated in `enrichLead`, per the on-screen comments).

### 2.2 `js/tab-audit.js`

**Purpose.** Answers "which leads were touched in the selected period(s)" plus an hour-of-day activity chart.

**State and constants.** `startOfDay = istStartOfDay`, `addDays = istAddDays` (L10–11). `AUDIT_PRESETS` (L15): Today = [IST midnight, now]; Yesterday = [yesterday's IST midnight, today's midnight −1 ms]; This week = from the IST Monday at midnight to now (`(dow+6)%7`); Last 7 days = [midnight 6 days ago, now]; Custom range = `#auditFrom 00:00:00` to `#auditTo 23:59:59` via `parseDate` (IST), null when incomplete or reversed. Every preset resolves against `_renderNow`. `auditState.periods` (L34): a Set, default `{'Today'}`, mutated by `buildMultiSelect`. `_updateEventsForCache` (L55): a WeakMap keyed by lead object. `HOUR_LABELS` (L173).

**Functions.**
- **`updateEventsFor(l)` L56.** Memoized. Events = `{kind:'Call connect', at:last_connect_time, by:RM}` (when parseable) plus one `{kind:'Comment', at, by:loggedBy, text}` per dated entry of `parseActionLog(combinedCommentsText(l))`, sorted newest first. Also used by the RM Timeline (on raw `allParsedLeads` objects, whose identity is stable between fetches).
- **`activeAuditRanges()` L71.** Maps the selected presets to `{name, from, to}`, dropping null ones.
- **`auditMatches()` L82.** For each filtered `leads` record, `hits` = events inside any range. Returns rows `{lead, hits, latest:hits[0]}` sorted by latest descending, with `ranges`.
- **`auditLeadIds(rows)` L96.** All collated lead ids, de-duplicated.
- **`renderAudit()` L109.** Shows `#auditCustomWrap` only when Custom is selected. Handles the "no valid range" message. Count badge = `numWithClone(rows, collated)+' leads'`. The summary gives leads, cloned, lead ids, events, and the window as IST stamps. Table capped at 300 rows: ids (×N chip), RM (+N other copy holders), region, stage, last update (IST), type, updates in window, by.
- **`renderActivityByHour()` L183.** Reuses `auditMatches()`. Buckets every hit by IST hour into comments vs connects. Draws a stacked vertical bar (2% minimum stack height when non-zero), labels every 3rd hour, with tooltips.
- **`copyAuditIds()` L241.** Copies the ids joined by newline to the clipboard and shows "Copied N IDs" for 1.8 s. No rejection handler.
- **`downloadAuditCSV()` L253.** One row per event: `lead_id, all_lead_ids, RM, TL, region, project, stage, updated_at (IST), type, by, comment`. Re-filters hits by ranges, which is redundant. Filename stamp is UTC.
- **`buildAuditControls()` L278.** Counts leads per preset (to label the dropdown), then `buildMultiSelect('msAuditPeriod', …)`. Its onChange rebuilds the controls and re-renders the audit and the chart.
- **DOMContentLoaded L290.** `#auditFrom`/`#auditTo` change → `renderAudit` + `renderActivityByHour` (but **not** `buildAuditControls`, H-16). Also wires the Copy and CSV buttons.

### 2.3 `js/tab-tracking.js`

**Purpose.** Tracking tab. Every section is `Movement_Log`-backed except the admin buttons.

**State and constants.** `TRACKING_SHORT_LABEL` (L9). `_chartHoverTipEl` (L485) plus document-level `mousemove`/`mouseout` listeners (L494–507), shared by every `[data-tt]` element on the page. Admin buttons wired at load (L518–600): Backfill/Clear SLA_History and Backfill/Clear Daily_Cohort_History. Clear asks for `confirm()`. All call into `sheets-writeback.js` and show status in `#slaHistoryAdminStatus` / `#dailyCohortHistoryAdminStatus`. `_dailyCohortLiveByKeyCacheMap` (L910, WeakMap keyed on the `allParsedLeads` array). `_dailyCohortEntriesCacheMap` (L925, WeakMap keyed on the `buildMovementHistories()` Map).

**Functions.**
- **`computeIssueTalliesByRun(regionFilter)` L31.** One pass over `movementSnapshots`, filtered by `passesMovementFilters(rec, currentDateFilterRange())` (Project/Region/TL/Source/Sub-source plus top-bar Assigned date on `lead_assigned_at`) and optionally `mainRegionFor(effectiveRegion(rec))===regionFilter`. Groups by `snapshot_at` ms, then by customer key (`client_id` or `'l:'+lead_id`). A customer is open if any copy is open, and flagged per check if any copy is flagged (`enrichSnapshotCached` = `enrichLead` with `_renderNow` pinned to the snapshot instant). Per run: `totalAll`, `openTotal`, `breachedTotal`, `byCheck[5]`. Runs are sorted oldest first; a run with no matching rows is absent. **Assumes every run contains every lead — no longer true (H-1).**
- **`findRunTally(runs, at)` L93.** Exact-instant lookup, otherwise a zero tally.
- **`computeCohortComparison(regionFilter, fromAt, toAt)` L110.** Only rows at exactly `fromAt`/`toAt`, after the same filters. Per customer it records which side(s) it was seen on and the flags per side. The cohort is customers seen at **both** instants. Per check: `flaggedAtFrom`, `stillFlaggedAtTo`. Overall: `matchedCount`, `breachedAtFromCount`, `stillBreachedCount`. **Biased by dedup (H-1).**
- **`debugDailyCohortEvidence(dateKey, region)` L214.** Console-only diagnostic. For leads assigned that day, a `console.table` of the same-day vs 48h evidence snapshot and whether the same snapshot served both.
- **`computeZeroTo48hCohort()` L262.** Returns null unless the top-bar Assigned date has a From or To. Over `buildMovementHistories()` (customers with any history only): filtered by `passesMovementFilters(first, {fromDate,toDate})` and `created` in range → popA. Deadline = created + `LEAD_LIFECYCLE_HOURS`h; not elapsed → population D. Otherwise popB, then `evidenceAtDeadline` → opp (C_opp) / open (C_stillOpen, collected for the list) / closed (C_closed) / no evidence (unresolved). Uses `Date.now()`, not `_renderNow`.
- **`splitDailyAndScatter(runs)` L316.** The latest run per IST day becomes the daily point; the rest become scatter.
- **`buildTrackingChartSvg(allRuns, fromAt, toAt)` L344.** SVG with two panels, W=900: top = Total Leads in System (`totalAll`), bottom = the 5 checks plus Total Breaching. Each panel has its own y-max (×1.15 over all in-window runs). The x scale spans [fromAt,toAt]. Dim scatter dots (up to 800). Invisible hit circles carrying `data-tt` (escaped) are painted last for the shared tooltip. About 7 x-ticks with weekday labels. Reused by the RM Timeline.
- **`_ensureChartHoverTip()` L486** plus listeners: a single floating tooltip that follows `[data-tt]` (text via `textContent`, so safe).
- **`setSlaHistoryAdminStatus` L514 / `setDailyCohortHistoryAdminStatus` L560.** Status text setters.
- **`trackingPopulateSnapshotSelectors()` L606.** Fills the From/To date+time selects (`populateMovementDateSelect`/`populateMovementTimeSelect`). Defaults to the second-newest and newest runs. Called after each Movement_Log fetch.
- **`getPickedTrackingWindow()` L628.** `{fromAt,toAt}` from the time selects, otherwise null. No ordering check.
- **`renderTrackingTab()` L642.** Always first calls `render48hCohort()`, then `renderDailyCohortByRegion()` and `renderWeekOverWeekCohort()` (both async, **not awaited**). Then: rebuilds the region select from `REGION_GROUP_MAP`, keeping the previous value; handles the not-ok / no-window / no-runs notices (the cohort notice gets `movementUnavailableReason()` **unescaped**, H-9); draws the chart when at least 2 runs are in the window; builds the From/To table (per check: From, To, Change badge (green when it went down), % of Total at each side, plus Total Breaching, Open Leads and Total Leads rows); builds the fixed-cohort table (Flagged at From / Still at To / Resolved / Resolved %).
- **`render48hCohort()` L822.** Five stat cards (A, B with D note, Opp+ %B, Closed %B, Still open %B), an unresolved note, and the "Still open at 48h" list (oldest first, capped at MAX_CARDS). The card id shows `item.key` (a client_id or `l:<lead_id>`).
- **`_dailyCohortLiveByKeyCache(leadsArr)` L911.** `Map<customerKey, rawLead>` built from `allParsedLeads`.
- **`computeDailyCohortByRegion(dateKey, opts)` L927.** IST day bounds via `parseDate`. Entries = every history customer plus every live customer that has no history (cached). Per entry: `first` = first snapshot, or the live record; unless `ignoreFilters`, applies `passesMovementFilters(first,{skipDateFilter:true})`; keeps entries created on that day. Region = `mainRegionFor(effectiveRegion(first))||'Unmapped'`. Same-day evidence at `min(dayEnd, now)` → sameDayResolved/sameDayOpp. If the 48h window has elapsed: windowComplete; evidence → resolved48h, opp48h, and closed48h (when not opp and not open). Live-only entries hit the broken `liveLead` fallback (H-4).
- **`eligibleDailyCohortDates()` L1038.** Assignment days of history customers whose day end is at or after the earliest retained snapshot and whose day end + 48h ≤ now.
- **`persistDailyCohortHistory()` L1112.** Fire-and-forget after each Movement_Log fetch. Skips when there is no data or no sheet id; reads the archive (skips on failure); for each **new** eligible date runs `computeDailyCohortByRegion(…,{ignoreFilters:true})` and upserts one row per region with created>0, `source:'Dashboard'`. Never rewrites an archived date.
- **`renderDailyCohortByRegion()` L1157 (async).** Uses its own `#trackingDailyDateInput` (defaults to IST two days ago, `initMovementUI`). `isStale` = the day end is before the earliest retained snapshot. Live compute first; when stale (or no result), fetches the archive for that date and uses it if non-empty; if stale with no archive but a live result exists, outcome cells show "NA" (`unreliable`). Table rows: regions from `REGION_GROUP_MAP` A–Z with created>0, plus an All Regions total summed over **every** `byRegion` entry (including `Unmapped`, H-5). Columns: Assigned, Same-Day Opp% (sameDayOpp/sameDayResolved), 48h Opp% (opp48h/resolved48h), 48h Close% (closed48h/resolved48h), 48h Window Complete ("resolved48h of created (partial)").
- **`emptyCohortBucket` L1286 / `addCohortBucket` L1289.** Bucket shape and summing.
- **`weekOverWeekDateKeys()` L1299.** Days 1–7 and 8–14 back from `_renderNow` (IST keys; IST has no DST, so 86 400 000 ms steps are exact).
- **`computeWeekOverWeekCohort()` L1316 (async).** For each of the 14 days: live `computeDailyCohortByRegion(…,{ignoreFilters:true})` if totalCreated>0, otherwise the archive (fetched lazily, once). **No staleness check** (H-3). Aggregated per week into `{byRegion, daysWithData, totalDays}`.
- **`wowPctDelta` L1365 / `wowDeltaBadgeHtml(delta, polarity)` L1375 / `wowPctCellHtml` L1383.** Percentage-point deltas. |delta|<0.05 shows "flat"; polarity decides green/red. `wowDeltaBadgeHtml` is reused by Opp Monitor.
- **`renderWeekOverWeekCohort()` L1394 (async).** Region rows (`REGION_GROUP_MAP` A–Z, present in either week) plus an All Regions row (same Unmapped gap, H-5). The notice states the two date ranges and the days with data.

### 2.4 `js/tab-oppmonitor.js`

**Purpose.** Shows the monthly Google Non-UTM/Search Same-day/48h Opp% workflow: a checklist plus results tables from two externally written tabs, filling empty slots with "Live" rows computed from `leads.opp_at`.

**State and constants.** Tab names and column lists (L24–38); `oppMonitorPeriodFetchState`/`oppMonitorMonthFetchState` (`idle|loading|ok|missing|error`) and the row arrays (L40–43); `OPP_MONITOR_MONTH_NAMES_` (L120).

**Functions.**
- **`_fetchOppMonitorTab(sheetId, tabName, columns)` L49.** `A1:Z` through `sheetsApiValuesGet`. HTTP 400 → `missing`; any other error → `error`. Header lookup by exact label; no key column → `missing`. Rows are objects keyed by column, kept only when the first (key) column is non-empty.
- **`fetchOppMonitorData(sheetId)` L80.** Fetches both tabs in parallel and sets state. Called from `core-fetch-and-render.js:650`, then `renderOppMonitorTab()`.
- **`oppMonitorPctDelta` L96 / `_oppMonitorPctCellHtml` L102.** Percentage-point diff between two stored percentages, rendered through `wowDeltaBadgeHtml(delta, 1)`.
- **`_oppMonitorYearMonth(date)` L109.** IST `YYYY-MM`. **`_oppMonitorShiftYearMonth` L114.** Month arithmetic via `Date.UTC`. **`_oppMonitorMonthName` L121.**
- **`_oppMonitorOrdinal` L143 / `_oppMonitorPeriodDayRange(ym, p)` L153 / `_oppMonitorDateStr` L161.** Periods are days 1–10, 11–20 and 21–end of month.
- **`_oppMonitorComputeLiveMetrics(leadsArr, ym, fromDay, toDay)` L170.** For leads whose IST assignment day falls in range: total++. When `opp_at` parses: hours = opp − created; negative values are skipped (still counted in total); same IST day → sameDay; ≤48h → h48; hours go into the average. Returns null when total=0, otherwise the counts, the percentages (1 dp), average hours/days, and `_live:true`. **Called with the filtered `leads` array (H-2).**
- **`_oppMonitorLivePeriodRow` L206 / `_oppMonitorLiveMonthRow` L217.** Build synthetic rows in the sheet-row shape with `source:'live'`.
- **`_oppMonitorStepDone` L228 / `_oppMonitorStepChipHtml` L232.** Status "done" (case-insensitive) → green chip with an escaped timestamp.
- **`_renderOppMonitorChecklist()` L240.** If both tabs are `missing` → notice. Otherwise, for the current IST month: 3 periods × 3 steps plus 3 month steps, and a `done/12` badge. When both are `error`, shows all-Pending with no error notice (H-20).
- **`_oppMonitorOrderedPeriodSlots()` L301.** The 9 slots oldest first: months −2, −1 and 0, each P1–P3.
- **`_renderOppMonitorPeriodTable()` L321.** `error` → notice. Otherwise each slot takes the sheet row if one exists, else a live row; slots with neither are skipped. The delta compares against the **previous array slot**, even when that slot was skipped (null) — in that case the delta shows "—". Count cells use `|| ''`, so a real 0 renders blank (H-19).
- **`_renderOppMonitorMonthTable()` L382.** The same for months −2..0.
- **`renderOppMonitorTab()` L441.** Calls the three renderers. Runs on every `renderAll` and after the fetch.

### 2.5 `js/tab-rmtimeline.js`

**State.** `_rmtlLastRM` (L15): the last RM rendered, used to decide whether to reset the picked day.

**Functions.**
- **`rmtlScopedLeads()` L28.** `allParsedLeads` (raw, collated) filtered by Project/Region(effective)/TL/Source/Sub-source and **not** by the Assigned date.
- **`populateRMTimelineSelect(scopedLeads)` L49.** A–Z RM options (escaped). Keeps the previous selection when still present; returns the selected value or null.
- **`renderRMDailyCalendar(rm, selectedDay, scopedLeads)` L68.** Per-day assigned counts for the RM (IST keys). The 7-cell window ends at `#dateToInput` (or `defaultDateRangeValue().to`, which is browser-local). "today" is highlighted using the IST key (the comment at L94 says browser-local — the two can disagree near midnight on a non-IST machine). Cell opacity scales with count. The badge shows the window total.
- **`renderRMDayTimeline(rm, dayKey, scopedLeads)` L130.** All `updateEventsFor` events on that IST day across the RM's leads, oldest first. Each card shows time, identity, kind, by/text, stage, last comment and closing reason (all escaped).
- **`renderRMIssueList(rm)` L164.** `issueLeads` for this RM that have any `ISSUE_PRIORITY` flag. **`issueLeads` is date-gated** (H-17). Table: id, stage, assigned, issue chips.
- **`computeIssueTalliesByRunForRM(rmName)` L192.** Like `computeIssueTalliesByRun`, but grouped by `rec.RM` (the RM historically recorded on each row) and **not** de-duplicated by customer. Applies the top-bar date filter (H-17). Inherits the census assumption (H-1).
- **`renderRMIssueHistory(rm)` L225.** Needs at least 2 runs; calls `buildTrackingChartSvg(runs, first, last)`.
- **`renderRMTimelineTab()` L248.** Computes `scopedLeads` once and selects the RM. On an RM change it sets `#rmtlDayInput` to the RM's latest event day (or today in IST), then renders all 4 sections.
- **`initRMTimelineUI()` L292.** Called from `main.js`. RM change → full tab render; day change or calendar cell click (delegated) → calendar + timeline only.

### 2.6 `js/tab-movement.js`

**State and constants.** `movementSnapshots`, `movementFetchState`, `movementFetchError`, `movementFetchStartedAt`, `_lastOvernightCohort` (L25–44); `MOVEMENT_LOG_TAB_NAME`, `MOVEMENT_LOG_RUNS_TAB_NAME` plus its 4 columns, `LEAD_FOLLOWUPS_TAB_NAME`, `SLA_HISTORY_TAB_NAME` (L46–67); `MOVEMENT_LOG_COLUMNS` (25 fields, order mirrors `MovementTracker.gs` — append-only), `SNAPSHOT_FIELD_KEYS` (= columns minus the 2 metadata columns), `_currentSheetId`, `MOVEMENT_LOG_DATE_KEYS` (L78–104); caches `_movementHistoriesCache*` (L353), `_movementEnrichCache` (WeakMap, L402), `_splitHistoryByCopyCache` (L793), `_unmatchedMovementComments*` (L933).

**Functions.**
- **`buildTodayCallBaseline(asOf)` L115.** `Map<lead_id, call_attempts>` from each lead's latest snapshot strictly before IST midnight of `asOf`. Used by `enrichLead.attemptsToday`. Correct under dedup, because the latest row before the cutoff still holds the current value.
- **`lastSnapshotBefore(asOf)` L143.** Same, with no day boundary: `{atMs, call_attempts}`. Mirrors `lastSnapshotBeforeGs_`.
- **`fetchMovementLog(sheetId)` L158.** `A1:Z`, raced against a 30 s timeout. HTTP 400 → `missing`; timeout → `error` with a prune hint; other errors → `error` carrying the HTTP status and message. Missing `lead_id`/`snapshot_at` headers → `missing`. Rows are parsed through gviz shape: dates for the 4 date keys (converted to ISO strings for `lead_assigned_at`/`last_connect_time`), numbers coerced, `rm_is_active` kept raw (preserves `false`), plus `content_hash`. Undated rows are dropped. Note: `opp_at` is parsed as a date but **not copied** into the record object (only `snapshot_at`, `lead_assigned_at` and `last_connect_time` are) — fine today, since nothing in these files reads `rec.opp_at`. State becomes `ok`/`missing`.
- **`movementUnavailableReason()` L302.** Text for loading/error/missing (contains raw `movementFetchError`).
- **`movementDedupKey(leadId, rm)` L336.** `lead_id|RM` (or `|Unassigned`). Must match `_dedupKeyGs_`.
- **`latestMovementLogHashByKey()` L340.** Latest `content_hash` per dedup key, used by the browser "Snapshot now" writer.
- **`buildMovementHistories()` L355.** `Map<client_id || 'l:'+lead_id, rows sorted ascending>`, cached on array identity.
- **`enrichLeadAsOf(raw, asOf)` L382.** Temporarily sets `_renderNow` and `_enrichingHistorical`, calls `enrichLead`, restores in `finally`.
- **`enrichSnapshotCached(rec)` L403.** WeakMap memo of the above at `rec.snapshot_at`.
- **`evidenceAtDeadline(history, deadlineMs, liveLead)` L436.** Latest row at or before the deadline, else the first row after it; enriches that row → `{oppOrAbove, isOpenLead, evidence}`; otherwise the `liveLead` fallback reads `liveLead.oppOrAbove/isOpenLead` (**undefined on raw `allParsedLeads` rows** — a known, documented bug, H-4); otherwise null.
- **`currentDateFilterRange()` L479.** Parses the top-bar From/To once.
- **`passesMovementFilters(rec, opts)` L488.** Project/Region(effective)/TL/Source (case-insensitive)/Sub-source; then, unless `skipDateFilter`, the Assigned-date range on `rec.lead_assigned_at` (from `opts.fromDate/toDate` when supplied, otherwise read from the DOM).
- **`movementChangedBetween(a, b)` L520.** True if any of stage (case-insensitive), call_attempts, internal_status_comments, stage_comments, last_comment or closing_reason differ.
- **`distinctMovementSnapshotRuns()` L535.** `{at, label, count}` per distinct `snapshot_at`. Since dedup, `count` = **changed** rows in that run, not leads seen (H-1).
- **`movementDatesAvailable()` L548 / `istTimeLabel(date)` L559 / `populateMovementDateSelect` L568 / `populateMovementTimeSelect` L579 / `getSelectedMovementSnapshot` L596.** IST-keyed date → runs dropdowns. Time option text is "hh:mm AM IST (N leads)".
- **`applyMovementFilters(rows)` L607.** The same 6-dimension filter applied to an array.
- **`computeStalledLeads()` L647.** Over `issueLeads`: open, assigned at least 2 days ago (wall clock). If there is any dated comment: stalled when the last comment is more than 6 h old (`'No Comment in 6h+'`, since = lastCommentAt). If never commented: compares this lead's own (lead_id-matched) latest snapshot at or before now−6 h; stalled if `call_attempts` hasn't increased (`'Attempts Unchanged (6h+)'`, since = that snapshot); skipped when there is no such snapshot. Returns copies of the lead with `issue` and `stalledSinceAt`.
- **`currentStalledRowsByRegion()` L698.** Filtered stalled rows grouped by report region (used by `reports-build.js`).
- **`renderStalledFlaggedLeadsOps()` L709.** Operations "Stalled Leads": a distinct-customer count, a breakdown card by issue, then day-bucketed cards ordered by `stalledSinceAt` ascending, each with `suggestedFollowUp(r)`.
- **`fmtHoursSpan(h)` L758.** `<24` → "x.xh", otherwise "x.xd".
- **`splitHistoryByCopy(history)` L794.** Splits a customer history into per-`lead_id` sequences (memoized).
- **`computeRmStallLeaderboard()` L808.** For every consecutive pair in each copy's history: skip if `cur` fails the filters, if `cur` has no `ISSUE_PRIORITY` flag, or if `movementChangedBetween(prev,cur)`. Otherwise credit `cur.RM`: gap count +1, distinct customers, total hours, longest gap. Sorted by gap count. **Under dedup, consecutive rows almost always differ, so stalls are under-counted (H-1).**
- **`computeTimeToOpportunity()` L854.** Per copy: the first row must pass the filters and must not already be Opp+. The crossing is the first later row that is Opp+. hours = crossing.snapshot_at − lead_assigned_at (≥0). Credited to `crossing.RM`. Works under dedup (a stage change always creates a row) but has up to about 6 h of capture-cadence slack.
- **`summarizeTimeToRemediate(episodes)` L886.** Per RM: count, average, median (even-length correct), max. Sorted by average descending.
- **`computeUnmatchedMovementComments()` L935.** Cached on array identity. Every distinct (case-insensitive) comment text across the whole unfiltered history that `inferOutcome` classifies as `'Update'` (no keyword match), with distinct lead count and example metadata. Sorted by lead count, then text.
- **`renderUnmatchedCommentsCount()` L966 / `downloadUnmatchedCommentsCSV()` L974.** Count badge and CSV (UTC filename stamp; RM-written comment text goes through `csvEscape`, H-15).
- **`renderRmStallLeaderboard()` L991 / `renderTimeToOpportunity()` L1027.** Tables of the two computations.
- **`computeOvernightCohort(asOf)` L1071.** Window = [yesterday `OVERNIGHT_START_HOUR`:00 IST, today `OVERNIGHT_END_HOUR`:00 IST]. Candidates = `allParsedLeads` with multi-copy customers expanded to `copySplits`; keeps copies whose own `lead_assigned_at` falls in the window, then `applyMovementFilters`. Status reflects the live sheet now.
- **`overnightStatusLabel(l)` L1102.** "Closed" / title-cased canonical stage / raw stage / "Unrecognized Stage".
- **`overnightEmailableLeads(leads)` L1122.** Drops closed and Opp+ leads (raw-record logic, equivalent to `enrichLead`).
- **`buildOvernightRegionReports(cohort, start, end, followupLookup)` L1137.** Per report region: text body grouped by RM+TL (one line per lead: id, status, follow-up — the human `Lead_Followups` suggestion if present, else `suggestedFollowUp`), headline counts de-duplicated to customers, and HTML via `renderReportEmailHTML`. Returns `{region, subject, body, html, count, regionNames}`.
- **`renderOvernightCohort(asOf)` L1206.** Stores `_lastOvernightCohort`. Breakdown by status (distinct customers) and per-copy cards (capped at MAX_CARDS, siblings together, newest first).
- **`renderOvernightRegionReports()` L1274 (async, button).** Calls `renderMorningBrief()`; empty/no-emailable guards; claims the shared generate-cycle lock (`tryClaimGenerateCycle('overnight')`); clears `Lead_Followups` → pushes the emailable leads → waits for every follow-up (cancellable); releases the lock in `finally`; builds the reports (with a fallback banner offering "Send all (unreviewed)" if the wait was cancelled); renders report cards (Copy / Open in Mail / Send via Gmail; subject and body escaped). **Writes to the live Sheet** (`Lead_Followups`) and can send Gmail on a click — user-initiated only.
- **`renderMovementTab()` L1372.** Leaderboard, time-to-opp, unmatched count, the setup/error notice, then `renderOvernightCohort(_renderNow)`.
- **`initMovementUI()` L1395.** Called from `main.js` (the file header still says it lives in `dashboard.html` — stale). Wires Snapshot now, the auto-snapshot checkbox, Overnight Generate, the Tracking From/To/region selects (each change re-runs the **whole** `renderTrackingTab`, including the async cohort sections), and the daily-cohort date input (default IST two days ago).

### 2.7 `js/tab-repeat-offenders.js`

**State.** `_repeatOffendersLoadingPollScheduled` (L53); `rmHierarchyByNameLower` / `rmHierarchyFetchState` (L55–56); `RM_HIERARCHY_*` (L58–59); `_repeatOffendersWorker`, `_repeatOffendersRunId` (L247–248); `_repeatOffendersLastResult` (L266, the canonical cache the PDF reads); `RM_PERF_CLASSIFICATION_CHIP_CLASS`/`_TITLE` (L671–677). Listeners: range select, custom From/To, Recalculate (L776–810).

**Functions.**
- **`fetchRmHierarchyForRollup(sheetId)` L61.** `RM_Hierarchy!A1:Z`. 400 → missing. Builds `Map<lower(name), {name, role, tl, tm, rh, ch}>` (the `email` column is listed but not stored — good, keeps addresses out of browser state).
- **`captureRepeatOffendersFilterSnapshot()` L124.** Fresh Set copies of the 5 filter dimensions.
- **`_repeatOffendersFilterSummaryText(filters)` L138.** "Project: All · …".
- **`repeatOffendersDateKeysForRange(range, now)` L159.** Returns a Set of IST day keys, or null for all time. Yesterday; This Week = Monday..yesterday of yesterday's ISO week (**on a Monday this returns the whole previous week**, H-11); Last 7 Days = yesterday and the 6 days before; Custom = inclusive IST days between the two inputs (order-insensitive), null if either is empty; `'today'` is not reachable from the UI.
- **`repeatOffendersFormatDate` L199 / `repeatOffendersResolvedDateRange` L215 / `_repeatOffendersUpdateRangeDisplay` L230.** Turn the min/max of the Set into "From: … To: …".
- **`renderRepeatOffenders()` L268.** Called on every `renderAll`, on range/custom changes, on Recalculate, and after `Promise.all([RM_Hierarchy, Movement_Log])`. Loading → message with elapsed seconds and a 1 s self re-poll (guarded). Error/missing → notices. Otherwise computes dateKeys, `hierarchyMissing = state!=='ok'`, freezes the filters, and calls `runRepeatOffendersRecalculation`.
- **`runRepeatOffendersRecalculation(ctx)` L355.** `runId = ++counter`; disables the PDF button; terminates any previous worker; status "started"; `new Worker('js/rm-performance-worker.js')` (on construction failure → synchronous fallback). `postMessage({snapshots: movementSnapshots (full structured clone), dateKeys, filters, rmHierarchyByNameLower|null, nowMs})`. `progress` messages update the status; a result calls `onDone` only when the runId is still current. Error → `onFail` → `clear()` + the synchronous fallback.
- **`_runRepeatOffendersSynchronously(ctx, onDone)` L433.** The same pipeline on the main thread: `reconstructRmPerformanceObservations` → `aggregateRmPerformance` → peer averages → `classifyRmPerformance`; the opp cohort (`reconstructRmOppCohort`, `liveLead` never used) → aggregate → classify → `joinRmOppConversion`; region/A1-TM/RH via `computeRmPerformanceWithOpp` (A1-TM/RH empty when the hierarchy is missing); `computeRmPerformanceByRegion`; stage counts for the debug panel.
- **`_renderRepeatOffendersResult(ctx, msg, elapsedMs, startedAtWall)` L488.** Writes the cache first (including empty results) and re-enables the PDF button. Empty RM list → a diagnostic notice naming the active filters. Otherwise: ranked lists (`filterRmPerformanceRankable` drops Insufficient Data; `sortRmPerformanceByScore`); badge = count of strictly Below Expectations plus the double-flag count; 4 tables (RM top 20, Region all, A1/TM top 10, RH top 5), then "Worst 5 RMs by Region" tables, then the debug panel.
- **`_repeatOffendersStatusHtml(opts)` L583.** "Started HH:MM:SS IST" using `toLocaleTimeString('en-IN')` **with no `timeZone`** (H-10).
- **`_repeatOffendersDebugPanelHtml(sc, hierarchyMissing)` L603.** A collapsed `<details>` with stages 1–9 counts, peer rates, a sample of observations, classification counts and the methodology text (values escaped).
- **`rmPerformanceTableHtml(title, list, hierarchyMissing, emptyMsg, hierarchy)` L696.** A 12-column table: #, Name (plus routing-days note), Unique Leads, Status chip (+ Low conversion chip, + confidence label), Score / peer, Instances, Same-Day Opp%, 48h Opp% (red when `lowConversion`), Region, RMs, A1/TM, RH (`rmPerformanceHierarchyCells`).
- **`_repeatOffendersSyncCustomRangeVisibility()` L763.** Shows the custom inputs only for `custom`.

### 2.8 `js/repeat-offenders-pdf.js`

- **`_repeatOffendersPdfDateLine(dateKeys)` L85.** "Date: X" or "Date Range: X – Y", or null.
- **`_repeatOffendersPdfCurrentFilterInfo(cached)` L103.** Everything comes from `cached.computedFrom` (range, now, dateKeys, filters) plus the display name.
- **`_repeatOffendersPdfHasAnyRowsForRange(dateKeys)` L128.** Whether any live `movementSnapshots` row has an IST day in the set (used only to word the empty message).
- **`_repeatOffendersPdfSectionTables(cached)` L156.** The same rank/cap rules as the live tab, applied to the cached arrays, plus `byRegion` tables. Empty tables are dropped.
- **`_repeatOffendersPdfBuildPageSpecs` L197.** One combined report (no per-day sections any more).
- **`_repeatOffendersPdfFilterSummaryLine(filters)` L208.** Active filters, or null.
- **`_repeatOffendersPdfTableRows(list, hierarchy)` L241.** 8 plain-text columns; Name carries newline-joined notes (routing, BOTH flag, confidence).
- **`_repeatOffendersPdfEnsureRoom` L281 / `_repeatOffendersPdfEstimateTableHeight` L298.** Page-break helpers.
- **`_repeatOffendersPdfRenderPages(specs, filterInfo)` L321.** jsPDF A4 portrait in points: title, gold rule, filter, date line, "Generated <istStamp>", a long methodology note, then per spec a room check, title and `autoTable` (grid theme, `pageBreak:'avoid'`, `rowPageBreak:'avoid'`), then "Page p of n" footers. Called with the **live global** `rmHierarchyByNameLower` (L384, H-13).
- **`downloadRepeatOffendersPdf()` L454.** Guards, in order: already generating; Movement_Log loading / not ok; RM_Hierarchy loading or idle; no cache; cache runId ≠ live runId (recalculation in flight). Then builds the specs — empty → a message that distinguishes "no raw rows" from "nothing rankable" — renders, and saves `Repeat-Offender-Report-<IST date>.pdf`. All synchronous inside an async function; `finally` re-enables the button.

### 2.9 `js/tab-morning.js`

- **`briefPill(status, label)` L18.** ok → green, warn → amber, anything else → red; escapes `label`.
- **`briefCard(opts)` L27.** Card shell; `numHtml`/`detailHtml` raw; `label`, `why`, `action` escaped.
- **`renderMorningBrief()` L43.** 10 cards, described in §3.9. Called from `renderAll` only when `_refreshMorningBriefOnNextRender` is set (each real fetch), and at the start of `renderOvernightRegionReports` (plus a reports.js checkpoint, per comments). The tab button was removed 2026-10-03, so this renders into a hidden panel (TAB-001).

---

## 3. Per tab: what the user sees and how each number is computed

Population legend: **L** = `leads` (customers, filtered, default Assigned range = last 7 days + today, browser-local dates — `defaultDateRangeValue`); **I** = `issueLeads` (per-copy, same filter); **A** = `allParsedLeads` (unfiltered); **M** = `movementSnapshots`.

### 3.1 Overview / People / Operations (`overview-distribution-people-ops.js`)

**KPI strip (Overview).**
| Tile | Number | Hover breakdown |
|---|---|---|
| Total Leads | `L.length` (+ "(N cloned)" = records with `collatedFrom>1`) | top 4 `group_source` |
| Behind on Today's Calls | distinct customers in I with `underCalledToday` (any age) | top regions |
| Not Connected in 10 min | distinct customers in I with `firstContactBreach` | top RMs |
| No Attempts Yet | L with `isOpenLead && call_attempts===0` | top regions |

Each tile's subline is the top key's share. "Distinct customers" = `familyKeyOf` (lead_id + sorted sibling ids).

**Funnel.** Band counts per §2.1 `renderFunnel`, % of L, step conversion vs the previous band, plus an "Exited" row. **Daily Volume.** Per IST assignment day (last 30 present): total, opp+ share. **Stage breakdown** (above the KPIs): raw stage text → band/tag, with an unmapped-live warning. **Source breakdown:** whole unfiltered sheet. **Regions / Projects / TLs / RMs / Allocation / Source mix / Fan-out & claim rate / RM Performance & SLA score:** see §2.1. "Call SLA" columns everywhere = `underCalledToday` count. RM SLA Score = % of the RM's open leads with none of the 5 checks failing.

**Operations — the 5 SLA checks** (flags are computed in `enrichLead`, `core-lead-model.js`; this file only selects and displays):
1. **Inactive-RM Lead Added** — `I.inactiveRmNewLead`; badge = distinct customers.
2. **Not Updated** — `I.isOpenLead && isNotUpdated`.
3. **Not Connected in 10 min** (`firstContactBreach`) — business-minutes late. Shown and badged, but **not** in `ISSUE_PRIORITY`, so it is absent from the Issues CSV, Tracking, RM issue history and Repeat Offenders.
4. **Follow-up Overdue (4h post-connect)** — `I.followupOverdue`; card shows the last dated comment.
5. **Behind on Today's Calls** — `I.isOpenLead && underCalledToday`; the badge counts only `<48h` (`isUnder48h`), and a second block lists `>48h`. The KPI tile counts both, so the same label shows two different numbers (H-18).
6. **Stuck 48h+** — `I.isOpenLead && stageStuck48h` + stage breakdown.

(The code and UI also say "5 SLA checks", meaning items 1/2/4/5/6 in `ISSUE_PRIORITY`, with item 3 shown alongside. `updateTabBadges` counts all six flags.) Additional non-SLA lists: Approaching 48h (36–48h, open, not yet stuck), Stalled Leads (§3.6), Recording Not Working, Closed with No Comment. Every list: siblings grouped, MAX_CARDS=200 with a truncation notice, day-bucketed by IST assignment day.

**Ops tab badge:** distinct customers with any of the six flags. **Issues CSV:** `ISSUE_PRIORITY` (5) + Recording + Closed-no-comment + Stalled, one row per (issue, lead copy). **Lead IDs CSV:** every lead id of filtered L.

### 3.2 Audit (`tab-audit.js`)
- **Period dropdown** (multi-select; counts per preset = leads with at least one event in that preset).
- **Updated Leads table:** leads (customers in L) with at least one event (call connect or dated comment) inside any selected window. Count = such leads; "updates in window" = number of in-window events; Last update / Type / By = newest in-window event. Up to 300 rows on screen; Copy and CSV cover all.
- **Activity by Hour:** every in-window event bucketed by IST hour, stacked comments vs connects.

### 3.3 Tracking (`tab-tracking.js`)
- **Region Issue Trend chart:** per Movement_Log run within the picked From→To window (daily-latest connected, others dimmed): top = Total Leads in System (customers with a row in that run that pass the filters); bottom = per-check flagged customers and Total Breaching (open customers with any flag). **Since 2026-09-11 a run only contains leads that changed (H-1), so these are "changed customers in that run", not the system total.**
- **From/To table:** the same tallies at the two exact picked runs, plus Change (▼ green when it went down) and % of Total.
- **Fixed cohort:** customers present at both picked instants (biased by dedup, H-1) → flagged at From / still flagged at To / Resolved %.
- **0–48h Cohort Outcome:** for leads assigned within the top-bar Assigned range that have Movement_Log history — A (assigned), B (48h elapsed), D=A−B, and among B: reached Opp+ / closed never converted / still open, as % of B; plus a list of the still-open ones. Evidence = the nearest retained snapshot at or before the deadline (else the first after).
- **Daily Cohort by Region** (own date picker): per region, Assigned; Same-Day Opp% = Opp+ by min(day end, now) ÷ leads with evidence; 48h Opp% and 48h Close% over leads whose 48h has elapsed and have evidence; "N of created (partial)". Uses the archive or NA when the date is older than retention.
- **Week-over-Week:** sums of the daily-cohort buckets for days 1–7 vs 8–14 ago (unfiltered), with percentage-point deltas (polarity-aware).
- **SLA History / Daily Cohort History maintenance:** backfill and clear buttons (clear is destructive, behind `confirm()`).

### 3.4 Opp Monitor (`tab-oppmonitor.js`)
- **Checklist:** for the current IST month, 3 periods × (Data collection / Analysis / Leadership email) + Monthly × (aggregation / historical comparison / trend summary); a step is "Done" iff its status cell equals "done". Badge `done/12`.
- **Period table** (9 slots, oldest first) and **Month table** (3 months): the external row when present; otherwise a "Live" row from L: total = leads assigned (IST day) in the slot; Same-Day = `opp_at` on the same IST day; 48h = `opp_at − assigned ≤ 48h`; averages over converted leads; the Δ badge compares with the previous slot. **Live rows inherit L's filters, including the default 7-day Assigned range, and are not limited to Google Non-UTM/Search (H-2).** The filter bar is hidden on this tab.

### 3.5 RM Timeline (`tab-rmtimeline.js`)
- **Daily calendar:** 7 days ending at the top-bar "To" date; per day, leads assigned to the RM (A-based, ignoring the Assigned filter); the badge = window total.
- **Day timeline:** every call-connect / dated-comment event on the picked IST day across the RM's leads, chronological.
- **Current issues:** the RM's copies in I with any `ISSUE_PRIORITY` flag (I is date-filtered).
- **Issue history chart:** per-run tallies of rows whose recorded `RM` is this RM (date-filtered, census-biased).

### 3.6 Movement (`tab-movement.js`)
- **Stalled Leads** (rendered in Operations): open copies assigned at least 48h ago that either have a comment history with no comment for more than 6 h (wall clock), or have never been commented on and show no call-attempt increase vs their own snapshot from 6 h or more ago. Badge = distinct customers; breakdown by reason.
- **Overnight Leads:** copies assigned between yesterday `OVERNIGHT_START_HOUR` and today `OVERNIGHT_END_HOUR` (IST), live status, distinct-customer headline, breakdown by status; the Generate button builds region emails (Opp+/closed excluded) through the Lead_Followups push/wait cycle.
- **RM Stall Leaderboard:** per RM, count of consecutive same-copy snapshot pairs where the later row is flagged and nothing changed; leads with a stall; total and longest gap hours. Under-counts since dedup (H-1).
- **Time to Opportunity:** per RM, observed crossings (the copy's first retained row is pre-Opp, a later row is Opp+): count, average, median and maximum of (crossing snapshot − assignment).
- **Unmatched comments:** a count of distinct unclassified comment texts across all history, plus CSV.

### 3.7 Repeat Offenders + PDF
- **Time range:** Yesterday / This Week / Last 7 Days (all anchored at yesterday) / all history / Custom.
- **Tables:** worst first by composite Score (empirical-Bayes shrunk violation-day rates over each group's eligible book, 4 scored rules, peer-relative), Insufficient Data excluded; caps 20/all/10/5; plus per-region worst 5. Badge = strictly Below Expectations count, plus elevated + low-conversion count. Opp% columns = Movement_Log-based same-day/48h conversion attributed to the RM on the first snapshot. The full methodology lives in `core-rm-performance.js` (another auditor).
- **PDF:** the same cached result, 8 columns (no Status/RMs/A1-TM/RH), one combined report; blocked while a recalculation is in flight or RM_Hierarchy is unsettled.

### 3.8 Morning Brief (hidden)
1. Leads with `ageHours ≤ 24` (L) vs the average of up to 7 prior IST days (`computeDailyLeadCounts`) — warns at ±30%. 2. L `isUnder48h`. 3. Live 48h failure rate = open ÷ (`ageHours>48`) — red above 20%. 4. Median business-minutes to first connect (L, open or closed) vs `FIRST_CONTACT_SLA_MINUTES`. 5. Open, 0 attempts, `ageHours ≥ LEAD_GRACE_HOURS`. 6. Distinct customers in the 36–48h tier (I). 7. Stuck count (I copies, not distinct) + stage breakdown, red when the top stage holds more than 40%. 8. RMs below 60% SLA — **counted among the worst 8 only** (H-7). 9. Data-quality notices (column-map banner, dedupe banner, unmapped non-closed stages). 10. p90 ÷ median first-contact ratio, warns above 3×.

---

## 4. Findings

| ID | Sev | Location | Confidence |
|---|---|---|---|
| H-1 | HIGH | `tab-tracking.js:31,93,110`; `tab-rmtimeline.js:192`; `tab-movement.js:535,808` | CONFIRMED (code); live since `641398e` |
| H-2 | HIGH | `tab-oppmonitor.js:348,411` (+ `core-filters.js:96,265-275`) | CONFIRMED - **FIXED 2e33f8d (2026-10-12)** |
| H-3 | HIGH | `tab-tracking.js:1316-1342` | CONFIRMED (logic); size of the error SUSPECTED |
| H-4 | MED | `tab-movement.js:448` via `tab-tracking.js:979,987,1006,1015` | CONFIRMED (logic); frequency SUSPECTED low |
| H-5 | MED | `tab-tracking.js:1267-1277, 1442-1455` | CONFIRMED |
| H-6 | MED | `overview…js:253` → `tab-repeat-offenders.js:391-426`; `tab-tracking.js:658-659` | CONFIRMED (path); cost SUSPECTED |
| H-7 | LOW | `tab-morning.js:174-175` | CONFIRMED |
| H-8 | LOW | `tab-morning.js:164` | CONFIRMED |
| H-9 | LOW | `tab-tracking.js:692` | CONFIRMED |
| H-10 | LOW | `tab-repeat-offenders.js:586` | CONFIRMED |
| H-11 | LOW | `tab-repeat-offenders.js:163-173` | CONFIRMED |
| H-12 | LOW | `tab-repeat-offenders.js:807` | CONFIRMED |
| H-13 | LOW | `repeat-offenders-pdf.js:384` | CONFIRMED |
| H-14 | LOW | `overview…js:1508,1560`; `tab-audit.js:273`; `tab-movement.js:982` | CONFIRMED |
| H-15 | LOW | `overview…js:1474` | CONFIRMED |
| H-16 | LOW | `tab-audit.js:291-294` | CONFIRMED |
| H-17 | LOW | `tab-rmtimeline.js:94,171,196` | CONFIRMED |
| H-18 | LOW | `overview…js:193,1098` | CONFIRMED (by design, confusing) |
| H-19 | LOW | `tab-oppmonitor.js:362-365,423-426` | CONFIRMED - **FIXED 2e33f8d (2026-10-12)** |
| H-20 | LOW | `tab-oppmonitor.js:246-256` | CONFIRMED - **FIXED 2e33f8d (2026-10-12)** |
| H-21 | LOW | `tab-tracking.js:658-659,1157,1394` | SUSPECTED |
| H-22 | LOW | `tab-morning.js:220` vs `overview…js:58-75` | SUSPECTED |
| H-23 | LOW | `overview…js:895` (+ 865) | CONFIRMED |
| H-24 | INFO | `tab-movement.js:661-665` | CONFIRMED (design note) |
| H-25 | INFO | `tab-morning.js:158-162` | CONFIRMED |
| H-26 | INFO | various (stale comments) | CONFIRMED |
| H-27 | INFO | `HANDOVER.md:2202-2204`, `docs/js-modules/JS-025-tab-oppmonitor.md` | CONFIRMED (doc mismatch) |
| H-28 | INFO | `tab-audit.js:245`; `tab-movement.js:249-282` | CONFIRMED |

**H-1 (HIGH) — Movement_Log is no longer a per-run census, but the per-run tallies still treat it as one.**
Since `641398e` (2026-09-11, "Lead History & Versioning Review, Phase 6"), `MovementTracker.gs` (`snapshotOpenLeads_`, around L667–669: `if (latestHashByKey[key] === hash) return;`) and the browser "Snapshot now" writer append a row **only when a lead's content hash changed**. `Movement_Log_Runs` exists precisely because "a row exists at time T" no longer means "the lead was there at T". The architecture review that introduced dedup (`docs/_planning/DB_ARCHITECTURE_REVIEW.md` ~L3130) checked only two consumers (freshness and the cohort archive) and concluded that "last-known-value-at-or-before-T" lookups are unaffected — which is true for `evidenceAtDeadline`, `buildTodayCallBaseline` and `lastSnapshotBefore`. It missed every consumer that groups rows by **exact `snapshot_at`**:
- `computeIssueTalliesByRun` / `findRunTally` (Tracking chart and From/To table): "Total Leads in System", "Open Leads", per-check counts and "Total Breaching" now count only leads that changed in that run. A lead sitting untouched and flagged — the exact case the chart exists to show — disappears from every run after its first.
- `computeCohortComparison`: the "fixed cohort" becomes customers that changed in **both** picked runs. Untouched, still-flagged leads are excluded, so "Resolved %" is overstated.
- `computeIssueTalliesByRunForRM` (RM Timeline issue history): same distortion.
- `computeRmStallLeaderboard`: a consecutive pair now almost always differs (that is why the second row exists). A "stall gap" is only found when the change was in a hashed field outside `movementChangedBetween`'s six fields. Stalls are heavily under-counted and the gap hours become "time since the last change", not one 6-hour check.
- `distinctMovementSnapshotRuns` time options label `(N leads)` = changed rows.
Failure scenario: a region with 300 open leads of which 40 changed in the 12:00 run plots "Total Leads in System = 40" at 12:00, and the From/To table shows large swings that only reflect activity, not backlog. Fix direction (for the owner): carry each lead's last-known row forward to every run listed in `Movement_Log_Runs` before tallying (an as-of join), and do the same for the stall walk.

**H-2 (HIGH) — Opp Monitor "Live" rows are computed from the filtered `leads`, which defaults to the last 7 days.** **FIXED 2e33f8d (2026-10-12)**
`_renderOppMonitorPeriodTable`/`_renderOppMonitorMonthTable` pass the global `leads`. `leads` = `allParsedLeads.filter(passesFilters)` (`core-filters.js:88-96`), and `buildFilterUI` sets the Assigned range to today−7..today whenever it is empty (`core-filters.js:265-275`). The filter bar is hidden on this tab (`TABS_HIDING_FILTER_BAR`), so the user can neither see nor change it there. Consequences: (a) by default, every live row for months −2 and −1 and for current-month periods older than about 8 days is computed from zero or a few leads — usually null (row missing) or wildly partial; (b) any Project/Region/Source filter chosen on another tab silently changes the "company-wide" live numbers; (c) the live computation is not restricted to Google Non-UTM/Search, while the official rows and the tab's stated scope are. The record `docs/js-modules/JS-025-tab-oppmonitor.md` (and the file header L4–10) says the tab "still reads no `filterState`" — technically true, but `leads` already embodies it. Fix direction: compute live rows from `allParsedLeads` with an explicit Google Non-UTM/Search source predicate.

**H-3 (HIGH) — Week-over-Week recomputes aged-out days from degraded evidence.**
`computeWeekOverWeekCohort` uses the live `computeDailyCohortByRegion` result for any date whose `totalCreated>0`, and only falls back to `Daily_Cohort_History` when live is empty. Live is almost never empty for a past date (entries include every live lead, `tab-tracking.js:979`). For days 8–14 ago, every snapshot near the day end and the 48h deadline has been pruned (7-day retention), so `evidenceAtDeadline` uses the first snapshot **after** the deadline — days later — and credits late conversions to Same-Day/48h. `renderDailyCohortByRegion` has exactly this guard (`isStale` → archive or "NA", L1185–1220, with a comment explaining why the number would be "actively misleading"); WoW lacks it. Scenario: last week's Same-Day Opp% reads several points higher than its archived value, so this week's delta shows a red ▼ that is an artefact. Fix direction: apply the same `isStale` test per date and prefer the archive, otherwise exclude the day.

**H-4 (MED) — `evidenceAtDeadline` live fallback returns `{undefined, undefined}`, and the Tracking tab does hit it.**
`tab-movement.js:427-435` documents the bug; `HANDOVER.md:2202-2204` says "the Tracking tab's own pre-existing calls are unaffected either way". They are not: `computeDailyCohortByRegion` deliberately adds every live customer with **no** history (`built.push([key, []])`, L979) and passes the raw `allParsedLeads` record as `liveLead` (L1006/1015). For such a lead: `sameDayResolved++` but never Opp; `resolved48h++`; `!undefined` → `closed48h++`. Every never-captured lead is counted as "closed without converting", and this is persisted to `Daily_Cohort_History` by `persistDailyCohortHistory` (permanently, since archived dates are never rewritten). It matters mostly for leads assigned and resolved between two captures. Fix direction: pass `enrichLead(liveLead)` or compute `isOppOrAbove`/open from the raw fields, as `overnightEmailableLeads` does.

**H-5 (MED) — Region tables' "All Regions" totals include rows that are never shown.**
Daily Cohort by Region builds visible rows only from `REGION_GROUP_MAP` regions, but totals sum every `result.byRegion` entry, including `'Unmapped'` (L1002) and any archived region name not in the map. Same in WoW (L1442 vs L1453–1454). Scenario: 12 Unmapped leads make "All Regions Assigned" 12 higher than the sum of the visible rows, with no explanation. Fix direction: add an "Unmapped/Other" row, or exclude those entries from the totals.

**H-6 (MED, performance) — Every filter change re-runs the heaviest work.**
`renderAll` → `renderRepeatOffenders` → `runRepeatOffendersRecalculation` creates a **new Worker** (re-running `importScripts`) and structured-clones the entire `movementSnapshots` (about 232k row objects per the code's own comments) on every Project/Region/TL/Source/date click and on every Refresh — twice on first load (once from the post-Movement `applyFiltersAndRender`, once from the `Promise.all` at `core-fetch-and-render.js:642`). The clone happens synchronously on the main thread. Separately, `renderTrackingTab` re-runs `renderDailyCohortByRegion` (which fetches the archive when the picked date is stale) and `renderWeekOverWeekCohort` (which fetches the archive when any of the 14 days has no live data) on every pass, and on every Tracking select change. Fix direction: run Repeat Offenders only when its tab is visible, or when its inputs actually change (memoize on the filter snapshot + dateKeys + snapshots identity); transfer the snapshots to the worker once and keep it alive; cache the archive rows per fetch.

**H-7 (LOW) — Morning Brief card 8 caps the "RMs below 60% SLA" number at 8.** `belowThreshold` is counted on `rmRows` after `.slice(0, 8)`. With 15 RMs below 60%, it shows "8". Count before slicing.

**H-8 (LOW) — Double escaping in Morning Brief card 7.** `statusLabel` is built with `esc(b.top.key)` and then `briefPill` escapes it again, so a stage like "Visit & Revisit" renders as "Visit &amp; Revisit".

**H-9 (LOW) — Unescaped error text into `innerHTML`.** `renderTrackingTab` L692 `clearCohort(movementUnavailableReason())` writes `cohortNoticeEl.innerHTML` with `movementFetchError` (the HTTP error message from the Sheets API / network) unescaped, while L690 escapes the same string for the sibling notice. Low exploitability (the text comes from Google's API), but it is inconsistent with the file's own convention.

**H-10 (LOW) — "IST" label on a browser-local time.** `_repeatOffendersStatusHtml` L586: `startedAtWall.toLocaleTimeString('en-IN', {hour12:false})` + " IST" with no `timeZone: 'Asia/Kolkata'`. On a non-IST machine the time shown is local but labelled IST. This breaks the CLAUDE.md "pin to IST" rule.

**H-11 (LOW) — "This Week" on a Monday shows last week.** The anchor is yesterday (Sunday), so `daysSinceMonday=6` and the whole previous Mon–Sun is returned under the label "This Week". The comment covers the Tuesday case but not Monday. Either label it, or return an empty set / note "no completed day this week yet".

**H-12 (LOW) — Recalculate mutates the shared clock.** L807 sets the global `_renderNow = new Date()` but re-renders only Repeat Offenders. Other tabs' enriched flags (`ageHours`, `underCalledToday`, …) still reflect the old instant, while later partial re-renders that read `_renderNow` directly (Audit presets via `buildAuditControls`/`renderAudit`, `renderCardsByDay` "Today/Yesterday" labels, RM Timeline default day, Opp Monitor current month, WoW day keys) use the new one. The effect is small, but it breaks the "one consistent clock per pass" invariant stated in `core-filters.js:90`.

**H-13 (LOW) — PDF reads the live `rmHierarchyByNameLower`.** `_repeatOffendersPdfRenderPages` L384 passes the global, not the hierarchy the cached run used — contrary to the file's own "every piece of text … from one cached object" rule (L92–102). After a Refresh that changed RM_Hierarchy, but before the new run completes (which is blocked by the runId check), there is no exposure. The exposure only arises if the hierarchy was missing at calculation time and loaded later, or similar. Store the hierarchy (or the computed hierarchy cells) in the cache.

**H-14 (LOW) — CSV filenames stamped in UTC.** `new Date().toISOString().slice(0,16)` in `downloadFilteredLeadIdsCSV`, `downloadIssuesCSV`, `downloadAuditCSV`, `downloadUnmatchedCommentsCSV`. An export at 01:00 IST is named for the previous day at 19:30. The PDF uses `istDateKey` correctly, so these are inconsistent with it.

**H-15 (LOW) — `csvEscape` gaps.** It does not quote values containing `\r` (a CRLF inside a comment breaks the row) and does not neutralise leading `=`, `+`, `-`, `@`. RM-typed comment text exported through `downloadAuditCSV` (the `comment` column) and `downloadUnmatchedCommentsCSV` (`comment`) opens as a formula in Excel/Sheets — a classic CSV/formula injection vector from free-text CRM input.

**H-16 (LOW) — Audit custom-range count goes stale.** Changing `#auditFrom`/`#auditTo` re-renders the table and chart but not `buildAuditControls()`, so the "Custom range (N)" count in the dropdown keeps the value for the previous dates until the next full render.

**H-17 (LOW) — RM Timeline date-gating is inconsistent with its own stated rule.** The header (L17–27) says the tab deliberately ignores the top-bar Assigned range, but `renderRMIssueList` reads `issueLeads` (date-filtered) and `computeIssueTalliesByRunForRM` applies `currentDateFilterRange()`. With the default 7-day range, an RM's "current issues" silently omit their older open leads. Also L94: the comment says browser-local "today" but the code uses the IST key, while the window anchor (`defaultDateRangeValue`) is browser-local, so on a non-IST machine near midnight the "today" highlight and the window can disagree by a day.

**H-18 (LOW) — Same label, two numbers.** The "Behind on Today's Calls" KPI tile counts all ages (L193); the Operations section badge counts only `<48h` (L1098), with the `>48h` rows listed below it. The code calls this intentional, but nothing on the KPI tile says so; a reader comparing the two sees a mismatch.

**H-19 (LOW) — Opp Monitor renders a real zero as blank.** **FIXED 2e33f8d (2026-10-12)** `esc(String(row.same_day_count || ''))` (and `total_leads`, `h48_count`): a period with 0 same-day opps shows an empty cell rather than "0".

**H-20 (LOW) — Opp Monitor checklist hides fetch errors.** **FIXED 2e33f8d (2026-10-12)** When both tabs are in `error` state (permission/network), the checklist renders 12 "Pending" chips and no notice. Only `missing` + `missing` shows a message. The tables do show an error notice.

**H-21 (LOW, SUSPECTED) — Async render race.** `renderDailyCohortByRegion` and `renderWeekOverWeekCohort` are async, called without `await` or a run token on every `renderAll`. If two passes overlap (quick filter clicks while an archive fetch is pending), the older pass can resolve last and overwrite the newer table. Repeat Offenders solved the same problem with `_repeatOffendersRunId`.

**H-22 (LOW, SUSPECTED) — Morning Brief "unmapped" disagrees with the Stage Breakdown.** Card 9 counts `!isClosedStage && !canonicalStage` and calls them "open leads". `renderStageBreakdown` treats booking-band leads (`isBookingLead`) as mapped, and Opp+ leads are not "open". Booking or soft-booking leads whose text has no canonical band are counted in card 9 but not in the Overview warning.

**H-23 (LOW) — Region table oddities.** "Critical %" = Call-SLA count ÷ **all** leads, including closed and Opp+ (L895), so a region with many closed leads looks healthier. Rows are keyed on raw `l.region` while "Reports as" uses `effectiveRegion`, so Loan-routed leads are split across their raw region rows.

**H-24 (INFO) — Stalled "No Comment in 6h+" uses wall-clock hours.** Every open lead older than 48h with any comment history becomes "stalled" overnight (after 6 h with no comment, e.g. 23:00 → 05:00). This is a design choice, worth knowing when reading the morning view; the rest of the SLA engine uses business hours.

**H-25 (INFO) — Morning Brief card 7 counts copies, not customers** (`stuck.length`), unlike every Operations badge (`uniqueCloneLabel`).

**H-26 (INFO) — Stale comments** (each verified against the code):
- `overview…js:1071` "Direct check #1: assigned today (calendar day)" — the function covers every open lead at any age.
- `overview…js:1345` orphan "SOP Rule 3 — attempts made but not logged in CRM." with no code under it.
- `overview…js:1484` "see e.g. line ~2828" (an old `dashboard.html` line).
- `overview…js:1389-1394` and `HANDOVER.md` "ISSUE_PRIORITY's five categories" — the 5 do not include Not Connected in 10 min.
- `tab-tracking.js:635-641` says the chart spans "the WHOLE captured history (dimmed)"; L333-337 says that was dropped.
- `tab-movement.js:5-7` and `tab-rmtimeline.js:4-7` say `initMovementUI`/`initRMTimelineUI` "still live in dashboard.html" — they live in these files (called from `main.js`).
- `tab-movement.js:1064-1069` "the log only ever tracks open/under-Opportunity leads" — it captures every lead.
- `tab-movement.js:916-920` "comment columns carry the running history forward each capture" — not each capture since dedup.
- `tab-repeat-offenders.js:2` "Repeat Offenders section (Operations tab)" — it is its own tab.
- `repeat-offenders-pdf.js:3-12` (per-date breakout) and L292-296 ("Top Issues" column) — both superseded.
- `tab-morning.js:104-105` "the Overview KPI tile" for median contact — no such tile exists.

**H-27 (INFO) — Doc mismatches.** `HANDOVER.md:2202-2204` claims the Tracking tab is unaffected by the `liveLead` bug (see H-4). `docs/js-modules/JS-025-tab-oppmonitor.md` / file header: "reads no filterState … not sliceable" is misleading (see H-2). `DB_ARCHITECTURE_REVIEW.md` Phase 2's consumer list for dedup is incomplete (see H-1).

**H-28 (INFO) — Minor.**
- `copyAuditIds` has no `.catch` on `navigator.clipboard.writeText` (an unhandled rejection when the clipboard is denied; no user feedback).
- `fetchMovementLog` parses `opp_at` as a date column but never stores it on the record, so the column is silently unavailable to every Movement consumer — harmless today, but a trap for whoever first needs it.
- `renderFanout`: if one RM appears twice in `collatedRMs` (two copies held by the same RM), `received` counts it twice.

---

## 5. Open questions

1. **Dedup vs census (H-1):** was the loss of per-run tallies accepted knowingly when Phase 6 shipped? The Tracking chart's history before 2026-09-11 has aged out, so every chart currently visible is post-dedup. Which is wanted: carry-forward from `Movement_Log_Runs`, or relabelling the chart as "leads that changed per run"?
2. **Opp Monitor scope (H-2):** should live rows be Google Non-UTM/Search only (matching the official workflow), and should they ignore every top-bar filter? Also, for a collated customer, whose `opp_at` lands on the merged record (`core-fetch-and-render.js:154-176`, not audited here)?
3. **Pruning and history:** `pruneMovementLog_` drops every row older than 7 days, including a lead's only row. The next capture then re-appends it (no hash to match), so each unchanged lead reappears about every 7 days. Is that intended? It inflates "changed rows" counts around that boundary and interacts with H-1.
4. **`applyFiltersAndRender` re-entrancy guard** (`core-filters.js:39`, outside my files): if the Movement_Log fetch resolves while the first deferred filter pass is still pending, the post-Movement re-render (`core-fetch-and-render.js:608`) is dropped silently, and Operations keeps `attemptsToday` without a baseline until the next filter change. Unlikely with a ~12 s fetch, plausible with a small sheet or in the harness. Worth confirming with the core auditor.
5. **Morning Brief:** with the tab button gone since 2026-10-03, should `renderMorningBrief` (run on every fetch and every Overnight Generate) be retired, per `docs/TEAM_CLAUDE_HANDOVER.md` §18?
6. **Not Connected in 10 min** is shown, badged and counted in the Ops badge, but excluded from the Issues CSV, Tracking, RM issue history and Repeat Offenders. Is the CSV omission intended? The CSV header comment implies "every issue".
