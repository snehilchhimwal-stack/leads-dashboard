# G — Dashboard core JS: line-by-line audit (2026-10-10)

Auditor G of 9. Read-only audit; no code was changed. Line numbers are from
`master` at `19038e7`.

## 1. Scope + summary

**Files read in full:** `dashboard.html` (1456 lines), `js/core-foundation.js`,
`js/core-sheets-fetch.js`, `js/core-auth.js`, `js/core-lead-model.js`,
`js/core-collation.js`, `js/core-outcome-engine.js`,
`js/core-fetch-and-render.js`, `js/core-ui.js`, `js/core-filters.js`,
`js/core-rm-performance.js`, `js/rm-performance-worker.js`, `js/main.js`.
**Read where needed for parity or call paths:** `SlaEngine.gs` `computeSlaFlags_`,
`Core.gs` stage classifiers, `DailyRmIssueLog.gs`
`reconstructRmPerformanceObservationsGs_`, `MovementTracker.gs`
(`SNAPSHOT_COLUMNS_`, content-hash dedup), `js/tab-movement.js`
(`buildTodayCallBaseline`, `lastSnapshotBefore`, `fetchMovementLog`,
`buildMovementHistories`, `enrichLeadAsOf`, `enrichSnapshotCached`,
`evidenceAtDeadline`, `splitHistoryByCopy`), `js/reports-build.js`
(`effectiveRegion`, `mainRegionFor`, `regionsAreSimilar`), and
`js/tab-repeat-offenders.js` (`runRepeatOffendersRecalculation`, the synchronous
fallback).

**Summary.** This is a static, client-only app. A Google Identity Services token
(the sign-in gate) is reused as the Bearer token for every Sheets API call.
`fetchAndRender` reads `leads!A2:AZ` and maps headers through `HEADER_ALIASES`.
It then collates RM copies of the same customer with a union-find over
lead_id/client_id, gated on region similarity. Each customer becomes one merged
record, and each RM copy is kept separately in `copySplits` for issue detection.
`applyFiltersAndRender` filters the records and runs `enrichLead` on each one to
derive every SLA flag against one pinned clock (`_renderNow`). It then calls
`renderAll`. Time handling is IST throughout (`istWallToInstant`/`istParts`), with
one deliberate exception: the default date range uses the browser's local date.

The RM Performance engine replays `enrichLead` against `Movement_Log` rows. It
builds per-(lead, day, rule) eligibility and violation observations, shrinks each
rate toward the peer average (empirical Bayes, K=8, distinct-lead units), takes a
severity-weighted composite, and classifies it with a posterior-confidence gate. A
separate Opp-conversion signal is joined on for display. The work runs in a Web
Worker, with a synchronous fallback that mirrors it line for line.

**Most important finding (G-1).** Since 2026-09-11, `Movement_Log` has been a
change-only log (content-hash dedup), but the violation engine still assumes one
row per lead per capture run. A lead that nobody touches stops producing
observations, so the engine under-measures exactly the neglect it is meant to
rank. HANDOVER §9.7.3 already listed this as "worth checking, not confirmed".
Reading the code confirms the mechanism.

## 2. dashboard.html

- **Head (L1-L839).**
  - The GIS client loads `async defer` (L10).
  - jsPDF 2.5.1 and autotable 3.8.2 load synchronously from cdnjs (L22-23), in
    that order because autotable extends jsPDF.
  - One `<style>` block (L24-L839):
    - Tokens on `:root`: a dark palette, the `--gutter`/radius scale and the
      Homesfy brand colours.
    - Component CSS: hover-card, cell-hint, chart tooltip, loading overlay
      (`#renderLoadingOverlay`, z-index 9999, with a `.heavy` brand variant),
      buttons, switch, config panel, filter bar, multi-select (`.ms-*`), report
      cards, email chips, funnel, heat cells, `.section-scroll` (with `.no-cap`
      and `.compact`), KPI strip, stall card, hour chart, RM-timeline calendar,
      sections and count pills, tab bar, jump nav, tables, chips, alert cards,
      action-log mini table.
    - Responsive breakpoints at 900, 760 and 600 px.
- **No inline `<script>` blocks.** Inline handlers are generated at runtime only:
  `onclick="toggleActionLog('…')"` in `core-ui.js` and
  `onclick="toggleInlineDetail(this)"` in `core-fetch-and-render.js`.
- **Body.**
  - `#renderLoadingOverlay` (L842).
  - `#authGate` (L849): logo, an optional Client ID row (`#authGateClientIdRow`,
    `#gateClientIdInput`), `#gateSignInBtn` and `#authGateStatus`.
  - `#appShell` (hidden until sign-in, L870):
    - Header: `#pulseDot`, `#gateUserBadge`, `#lastRefreshed`, `#changeSourceBtn`,
      `#refreshBtn`, `#snapshotNowBtn`, `#autoSnapshotCheck`, `#snapshotStatus`.
    - `#configPanel`: `#sheetIdInput`, prefilled with the production sheet id;
      `#tabNameInput`, defaulting to `leads`.
    - `#errorBox`, `#columnMapWarning`, `#dedupeNotice`.
    - `#dashboardContent`: the filter bar (`#msProject`, `#msRegion`, `#msTL`,
      `#msSource`, `#msBucket`, `#dateFromInput`, `#dateToInput`,
      `#clearFiltersBtn`, `#downloadLeadIdsBtn`), `#filterSummary`, and
      `#tabBar` with 8 buttons: Overview, Operations (badge `#tabBadgeOps`),
      Repeat Offenders, People, Audit, Movement, Tracking, Opp Monitor.
  - **Tab panels.**
    - `#tab-morning` (L950) exists but has no tab button. This is intentional
      since 2026-10-03 (HANDOVER §2, TAB-001); it still renders into an
      unreachable node.
    - `#tab-overview`: source/stage breakdown, KPI strip, jump nav, funnel,
      trend, region and project tables.
    - `#tab-operations`: stalled, inactive-RM, not-updated, not-connected,
      follow-up, due-today, approaching-48h, stuck, recording, closed-no-comment
      and region email reports (including the Gmail setup panel).
    - `#tab-repeatoffenders`: range select, custom From/To, recalculate, PDF.
    - `#tab-people`: RM score, TL, RM workload, fan-out, claim, matrix, source
      mix, and the RM timeline sections.
    - `#tab-audit`: updated leads, activity by hour.
    - `#tab-movement`: overnight, RM stall, time-to-opportunity, unmatched
      comments.
    - `#tab-tracking`: daily cohort, week-over-week, region trend + same-cohort
      grid, 0-48h cohort, SLA_History admin, Daily_Cohort_History admin.
    - `#tab-oppmonitor`: checklist, period and month tables.
- **Script load order (L1418-L1453).** Exactly as HANDOVER §2 says, 24 tags:
  - Positions 1-9 are the core files: core-foundation, core-sheets-fetch,
    core-auth, core-lead-model, core-collation, core-outcome-engine,
    core-fetch-and-render, core-ui, core-filters.
  - Then tab-audit, tab-tracking, tab-oppmonitor, tab-rmtimeline, tab-movement,
    tab-repeat-offenders, **core-rm-performance (position 16)**,
    repeat-offenders-pdf, tab-morning, reports-build, reports-gmail, reports-ui,
    sheets-writeback, overview-distribution-people-ops, and main.js last.
  - `rm-performance-worker.js` is loaded with `new Worker()`, not a script tag.
- **Event wiring for the header lives elsewhere.** The `refreshBtn`,
  `changeSourceBtn` and date-input listeners are in
  `overview-distribution-people-ops.js` (L1377-L1386).

## 3. Per-file walk-through

### 3.1 js/core-foundation.js (246 lines)

**Module state:**
- `CONFIG` (L31). Thresholds:
  - 5 calls/day; 10 calls after 48h (unused here); 48h lifecycle.
  - 10-minute first contact.
  - Overnight window 17→9.
  - Working hours 9-19 IST; 3h grace; 4h follow-up.
  - `FUNNEL_ORDER`, ordered `STAGE_ALIASES` (substring aliases; the order
    matters), `OPPORTUNITY_STAGE`.
  - `CLOSED_STAGE_EXACT` (whole word/phrase) and `CLOSED_STAGE_STEMS`
    (word-prefix).
- `ISSUE_PRIORITY` (L116): the 5 actionable checks in priority order.
  `firstContactBreach` is deliberately excluded. It must be defined at parse time
  because `reports-build.js` derives `_FLAG_BY_ISSUE_PRIORITY_LABEL` from it at
  its own top level.
- `IST_OFFSET_MS` (L135).

**Functions:**
- `istWallToInstant(y,mo,d,h,mi,s)` L139: `Date.UTC(...) - 5h30m`. Overflowing
  days roll over.
- `istParts(date)` L144: shifts by +5h30m and reads the UTC getters; returns
  {y,mo,d,h,mi,s,dow}.
- `istStartOfDay` L152, `istAddDays` L157: built from the two functions above.
  `istAddDays` keeps the wall-clock time.
- `istSameDay(a,b)` L162: false if either side is null.
- `istDateKey` L170: `YYYY-MM-DD` in IST.
- `relativeDayLabel(dayKey,todayKey)` L185: calendar-day difference via
  `Date.UTC`. Produces "Today/Yesterday/N days ago (d Mon)". Uses `IST_MONTHS`,
  which is defined in `reports-build.js` L276 and resolved at run time.
- `groupLeadsByCalendarDay(leads, asOf)` L203: buckets by the IST day of
  `lead_assigned_at`, newest day first, keeping the caller's order inside a
  bucket. Undated leads go into a trailing "Unknown date" bucket.
- `dayGroupHeaderHtml` L224: label goes through `esc()`.
- `renderCardsByDay(group, cardFn)` L236: caps the whole list at `MAX_CARDS`
  (200) first, then buckets. The card index is global across buckets so logId
  values stay unique.

### 3.2 js/core-sheets-fetch.js (190 lines)

**State:**
- `HEADER_ALIASES` L17: 27 keys; every key must have a reader. It includes
  browser-only `project_region` and `lead_closing_comment` (the known,
  intentional parity diff) and `opp_at` (since 2026-09-21).
- `_accessedHeaderKeys` L73.
- `leads` L75: filtered and enriched merged customers.
- `issueLeads` L82: filtered and enriched per-copy units.
- `allParsedLeads` L83: unfiltered, unenriched merged customers.
- `_lastCrossRegionCollations` L89.
- `filterState` L90: five Sets; an empty Set means no restriction.

**Functions:**
- `extractSheetId(raw)` L94: the `/d/<id>/` regex, otherwise the trimmed input.
- `sheetsApiValuesGet(sheetId, range)` L107:
  - `GET v4 …/values/{range}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`
    with `Authorization: Bearer ${gateAccessToken}`.
  - On a non-OK response it throws an Error carrying `.status`, using the API's
    message when available. Returns `data.values || []`.
  - **No token-validity check here.** Callers must ensure the token is valid.
- `serialToGvizDateString(serial)` L130: serial → epoch 1899-12-30 UTC + days +
  rounded milliseconds → the string `Date(y,mo,d,h,mi,s)`, built from UTC
  getters. The serial therefore stays as wall-clock time, assumed to be IST.
- `valuesToGvizShape(values, isDateColumnLabel)` L145: row 0 becomes the column
  labels. Cells in date columns whose value is a number are converted to the
  gviz date string; other cells pass through raw; blank or null cells become
  null.
- `gvizCellRaw` L169: `v`, then `f`, then `''`.
- `gvizCellDate` L174: a `Date(...)` string becomes an IST instant; otherwise it
  tries `parseDate(cell.f)`, then `parseDate(v)` if `v` is a string; a **raw
  number returns null**. See G-5.

### 3.3 js/core-auth.js (131 lines)

**State:** `GATE_SCOPE` (spreadsheets + userinfo.email), `gateTokenClient`,
`gateAccessToken`, `gateTokenExpiresAt`, `gateUserEmail`,
`_gateSignInResolvers`.

**Functions:**
- `gateTokenValid()` L35: the token is set and more than 5 s from expiry.
- `initGateTokenClient(clientId)` L39:
  - Returns null if GIS has not loaded yet.
  - Otherwise `initTokenClient({client_id, scope, callback})`. The callback sets
    the token and expiry (`expires_in`, default 3600), or shows the error and
    clears the token, then flushes every pending resolver.
  - **No `error_callback`.** See G-4.
- `fetchGateUserEmail()` L60: GET `oauth2/v3/userinfo`. Failures are ignored.
- `gateSignIn()` L78: returns a Promise.
  - The Client ID comes from `getGmailClientId()` (shared with the Gmail flow,
    `reports-gmail.js`), or from the gate input when that row is visible (the
    value is then saved).
  - With no Client ID, it shows the input row and resolves.
  - It lazily creates the token client; if GIS has not loaded, it resolves with
    a message.
  - Otherwise it pushes the resolver and calls
    `requestAccessToken({prompt: token ? '' : 'consent'})`.
- `handleGateSignInClick()` L109: `await gateSignIn()`; if the token is valid it
  fetches the email, swaps gate → app shell, sets the badge and calls
  `fetchAndRender()` without awaiting it.
- `initAuthGate()` L122: shows the Client ID row only when none is stored, and
  binds the button. Called from `main.js`.

### 3.4 js/core-lead-model.js (500 lines)

- `businessMinutesBetween(start,end)` L14: walks IST calendar days and sums the
  overlap with 09:00-19:00 IST each day. Returns 0 if `end <= start`.
  **No weekend or holiday exclusion** (a design choice).
- `parseDate(v)` L52, memoised in `_parseDateCache` (L51):
  - Date objects pass through (an invalid Date becomes null).
  - `YYYY-MM-DD[T ]HH:MM[:SS]` and `YYYY-MM-DD` are read as **IST**.
  - Anything else goes to `new Date(s)`: correct for Z/offset strings, but
    **browser-local** for other formats (G-10).
  - The cache is never cleared (G-9).
- `canonicalStage(stage)` L83: lowercases, then returns the first
  `FUNNEL_ORDER` entry any of whose aliases equals or is a *substring of* the
  text; otherwise null.
- `isOppOrAbove(stage, closingReason, leadClosingReason)` L104: canonicalises
  the stage. If unrecognised, it falls back to canonicalising
  `leadClosingReason || closingReason` (free text, substring match — see G-6),
  then checks index ≥ the Opportunity index.
- `isBookingLead(l)` L123 / `isSoftBookingLead(l)` L134: the stage equals the
  band, **or** the canonicalised closing reason equals the band. The reason is
  checked even when the stage is recognised (G-6).
- `isClosedStage(stage)` L141: tokenises on `[^a-z']`, keeping apostrophes so
  "won't" stays one word. Exact words or phrases: won/lost/junk/dead/
  "not interested". Stems: cancel/close/reject.
- `isLeadClosed(l)` L173: closed stage OR non-blank `closing_reason` OR non-blank
  `lead_closing_reason`.
- **State:**
  - `_renderNow` L182: initialised at script parse time and reset in every
    filter pass.
  - `_todayCallBaselineByKey` L194: lead_id → `call_attempts` before IST today.
  - `_lastSnapshotByKey` L199: lead_id → {atMs, call_attempts}.
  - `_enrichingHistorical` L239.
- `callsTodayFromBaseline(l)` L209: for each lead id (the keys of
  `callAttemptsByLeadId` on a merged record, otherwise `l.lead_id`) with a
  baseline, computes `max(0, attempts − baseline)` and returns the best delta,
  or null if no id has a baseline.
- `lastSnapshotForLead(l)` L226: over `collatedLeadIds` (when more than one) or
  the lead's own id, picks the entry with the highest `call_attempts`, tie →
  latest.
- **`enrichLead(l)` L241, the single source of truth.** Everything is evaluated
  against `now = _renderNow`.
  1. `created = parseDate(lead_assigned_at)`; `excluded = isLeadClosed`;
     `oppOrAbove`; `isOpenLead = !excluded && !oppOrAbove`.
  2. `ageHours`; `past48h` (open and > 48h); `isUnder48h` (≤ 48h; false when
     undated); `isCreatedToday` (IST day); `pastGrace` (≥ 3h).
  3. `connectDate = parseDate(last_connect_time)`; `hasConnected` = text in
     `last_connect` OR `connectDate`.
  4. **Rule 1:** `businessMinsToConnect`; `firstContactBreach` = open, under
     48h, and > 10 business minutes. `neverConnectedPastWindow` = open, under
     48h, no `connectDate`, created, and > 10 business minutes so far. This one
     is exempt from the grace period.
  5. **Multi-agent:** distinct `loggedBy` names in
     `parseActionLog(combinedCommentsText)`, compared with `collatedFrom`.
  6. `hoursSinceLastComment` / `lastCommentAt`, from the newest parsed timestamp
     (not the array position).
  7. **Behind on Today's Calls:**
     - `loggedToday` = parsed entries timestamped today (IST).
     - `attemptsToday`: created today → `call_attempts`; live (not historical) →
       `max(baselineDelta, loggedToday)`, or `loggedToday` when there is no
       baseline; historical → `loggedToday`.
     - `underCalledToday` = open, past grace, and fewer than 5 attempts.
  8. `stageStuck48h` = `past48h && pastGrace`.
  9. `isNotUpdated` = open AND ((past grace AND stage = "not updated") OR
     `neverConnectedPastWindow`). Not capped at 48h.
  10. `followupOverdue` = open, under 48h, past grace, `hasConnected`, and stale
      for more than 4h. Staleness is measured from the last comment, else the
      connect time, else the age.
  11. **Data-integrity checks:**
      - `recordingNotWorking` = `call_count === 0 && call_attempts === 0 &&
        hasAnyCommentField`.
      - `closedWithNoComment` = `excluded && !hasAnyNarrativeComment`.
  12. `rmIsInactive` (`'false'/'no'/'inactive'/'0'/'n'`, checkbox-safe);
      `inactiveRmNewLead` = open, created today, RM inactive.
  13. Returns a **new object** (`Object.assign({}, l, …)`) with defaults for the
      `collated*` fields.

### 3.5 js/core-collation.js (172 lines)

All display and counting helpers; no state.
- `collationBadge` L19: "merged ×N", IDs, RMs, and a red Regions chip when there
  is more than one region; all values go through `esc()`.
- `siblingNote` L42.
- `leadIdentityLine` L54: the badge, otherwise `id · RM` plus the sibling note.
- `familyKeyOf` L66: sorted own id plus `siblingLeadIds`.
- `groupSiblingsTogether(items, cmp)` L81: sorts within each family, orders
  families by their first member, then flattens.
- `dedupeToFamilies` L99.
- `countUniqueAndCloned` L115, `uniqueCloneLabel` L125: for per-copy arrays.
- `countCollatedAmong` L141, `collatedCountText` L148, `collatedCountLabel` L155
  (**unused**), `numWithClone` L167: for merged arrays.

### 3.6 js/core-outcome-engine.js (933 lines)

- `combinedCommentsText` L21: `internal_status_comments | stage_comments`.
- `hasAnyCommentField` L36: those two plus `last_comment` and `closing_reason`.
- `hasAnyNarrativeComment` L52: the same without `closing_reason`.
- `parseActionLog(text)` L72, cached in `_actionLogCache` (cleared on each
  fetch):
  - Splits on `|`.
  - Each entry is matched against
    `^(.*?):\s*(.*?)\s*-\s*(YYYY-MM-DD HH:MM)\s*$` to get
    {attempt, loggedBy, comment, ts, outcome=inferOutcome(comment)}.
  - An entry that does not match keeps its whole text as the comment, with no
    timestamp and no logger. A timestamp with seconds also fails to match.
- **Fuzzy matching:**
  - `_editDistance` L110: optimal string alignment with 3 rolling rows.
  - `_typoBudget` L156: length ≤ 4 → 0, ≤ 8 → 1, else 2.
  - `_wordsMatch` L161, `_wordsOf` L171 (strips apostrophes, `[a-z0-9]+`
    tokens), `_signalWordsOf` L178 (cached).
  - `_signalMatches` L190: a single word matches any token; a phrase must match
    consecutive tokens.
  - `_anySignal` L202.
- `OUTCOME_RULES` L230: 33 ordered rules, first match wins; `signals` and/or
  `test(c, words)`. Order: DND, Switched Off, Wrong Number, Junk/Duplicate, Call
  Declined, Busy, Booked Elsewhere, Cross-Team, Already With Another RM/CP,
  CP/Broker, BPCL Not Shared, Resale/Rental, RNR, Ringing, Disconnected, Voice
  Unclear, Out of Station, WhatsApp Unavailable, WhatsApp Sent, Details Shared,
  Visit Completed, Visit Arranged, Loan In Process, Not Interested, Considering,
  Budget, Interested, DNP, Follow-up Missed, Already Visited, Requirement Noted.
  Mirrored as `OUTCOME_RULES_GS_`; the parity checker passes.
- `inferOutcome` L569: cached in `_inferOutcomeCache`, which is never cleared.
- `_inferOutcomeUncached` L576: punctuation-only text → "No Real Update"; else the
  rules; fallback "Update".
- L598: a top-level try block removes two legacy localStorage keys. This is safe
  inside the Worker (the ReferenceError is caught).
- `FOLLOWUP_SUGGESTIONS` L607: outcome → advice text.
- `unmatchedFollowUp` L650: quotes the raw comment. The result is plain text, so
  callers must escape it.
- `latestFamilyOutcome(l)` L703: uses only entries logged by the lead's own RM,
  plus unattributed ones. Takes the newest entry that has text (by timestamp),
  else `last_comment`, else null. Mirrors `latestOutcomeGs_`.
- `commentsForCopy` L748, `sortCommentEntries` L769 (dated entries first,
  ascending), `collateFamilyComments` L784, `ownComments` L796: feed
  `Lead_Followups`.
- `suggestedFollowUp(l)` L818: tiers are the latest owner comment → the closing
  reason → `noCommentFollowUp`.
- `noCommentFollowUp(l)` L853: compares against the per-lead last snapshot, used
  only when that snapshot is at least 4h old. Messages: "no new attempts" or
  "N more attempts".
- `actionLogTableMarkup` L868: escaped, 12-hour IST.
- `istStamp` L906 (with aliases `isoStampIST`/`isoStamp`): `YYYY-MM-DD hh:mm AM
  IST`.
- `fmtWorkingWait` L924.

### 3.7 js/core-fetch-and-render.js (689 lines)

- `showError` L13: sets `innerHTML`; callers escape. `hideError` L19,
  `setPulse` L23.
- **`fetchAndRender()` L27:**
  1. Validates the inputs. Sets `_refreshMorningBriefOnNextRender`. Calls
     `showLoadingOverlay(heavy)` (L47).
  2. If the token is invalid it awaits `gateSignIn()`; if the token is still
     invalid it **returns without hiding the overlay** (L55, G-3).
  3. Disables the button; reads `${tab}!A2:AZ`. HTTP 403/404/400 map to
     ACCESS_DENIED/NOT_FOUND/BAD_RANGE.
  4. Calls `valuesToGvizShape` with date columns = only the
     `lead_assigned_at` and `last_connect_time` aliases (L83, G-5).
  5. Builds `colIndex` via `HEADER_ALIASES`. lead_id falls back to column 0. A
     missing `group_source` throws HEADERS. Unmatched keys trigger the amber
     `#columnMapWarning` (escaped).
  6. Parses each row with a non-blank lead_id into a raw lead record. Dates
     become ISO strings; numbers are coerced; `call_attempts` falls back to
     `call_count` only when its column is absent; `rm_is_active` is kept raw
     (checkbox-safe). The dead-alias resilience warning goes to the console.
  7. **Collation (union-find):**
     - Keys are `lead:<id>` and `client:<cid>`. Each key holds clusters of
       {index, region}.
     - A new row unions with the first cluster whose region
       `regionsAreSimilar(effectiveRegion)`, otherwise it starts a new cluster.
     - With the current `REGION_GROUP_MAP`, similarity is effectively
       transitive (every mapped key that shares a first word maps to the same
       group), so the "no smuggling" claim holds today.
  8. `mergeRowsIntoOneLead(rows)` L353:
     - One row → the row plus `collated*` fields.
     - Several rows:
       - **Primary** = highest `funnelRankOf` (closed −2, unrecognised −1,
         otherwise the funnel index); ties → most recent activity.
       - Comment fields are de-duplicated and sorted by trailing timestamp.
       - `call_attempts`/`call_count`/`duration` = **MAX** (email audit F18).
       - `callAttemptsByLeadId` per lead.
       - `last_connect_time` = latest; `lead_assigned_at` = earliest.
       - `collatedFrom` = number of distinct lead_ids.
  9. Per group: count extra rows. Only groups with at least 2 distinct lead_ids
     are "collated":
     - Cross-region groups are recorded.
     - `copySplits` = one single-row merge per distinct lead_id, with
       `siblingLeadIds`, `siblingRMs` and `siblingComments`.
  10. Builds the dedupe notice (one line, plus a hidden detail that wrongly says
      "summed" — G-8) and `renderSourceBreakdown`.
  11. `_actionLogCache.clear()`; `allParsedLeads = deduped`; `buildFilterUI()`;
      `applyFiltersAndRender()` (deferred); `_currentSheetId`;
      `snapshotSlaHistory()` (**runs before the deferred render**, G-7).
  12. In the background:
      - `fetchMovementLog`, then tracking selectors → `applyFiltersAndRender()`
        again (now with call baselines) → auto-snapshot →
        `persistDailyCohortHistory`.
      - `Promise.all([fetchRmHierarchyForRollup, movementLog])` →
        `renderRepeatOffenders()`.
      - `fetchOppMonitorData` → `renderOppMonitorTab()`.
  13. Shows the dashboard and records tab usage; `lastRefreshed` via
      `istStamp`.
  14. The catch block shows escaped error messages; `finally` re-enables the
      button and hides the overlay.

### 3.8 js/core-ui.js (159 lines)

- `esc` L15: escapes `& < > " '`.
- `showLoadingOverlay(text, heavy)` L42 / `hideLoadingOverlay(heavy)` L52:
  reference-counted depth plus a separate heavy depth; the overlay is removed
  only when the depth reaches 0.
- `MAX_CARDS = 200`; `truncationNotice` L73.
- `_logLeadRegistry` (Map logId → comment text), `toggleActionLog` L80 (builds
  the table lazily on first open), `logToggleMarkup` L92.
- `renderAlertCard(l, idx, prefix, requiredCalls)` L101: all text fields are
  escaped; numbers are interpolated raw.
- `toggleInlineDetail` L127.
- `initCollapsibleSectionInfo` L143: collapses every
  `.section-head + .filter-summary` behind an "ⓘ Why this section exists"
  button.

### 3.9 js/core-filters.js (413 lines)

- **State:** `_isApplyingFilters`, `_refreshMorningBriefOnNextRender`.
- `applyFiltersAndRender()` L38: drops the call if a pass is already in flight.
  Otherwise shows the overlay, then two nested `setTimeout(0)` calls (forcing a
  paint), then `_applyFiltersAndRenderImpl`, and `finally` hides the overlay.
- `_applyFiltersAndRenderImpl` L54:
  - From/To are parsed as **IST** day bounds.
  - `passesFilters` checks project, `effectiveRegion`, TL, source
    (case-insensitive), bucket, and the date range (an undated lead fails any
    date filter).
  - `filtered` = `allParsedLeads.filter`.
  - `_renderNow = new Date()`; rebuilds `_todayCallBaselineByKey` and
    `_lastSnapshotByKey` (`tab-movement.js`).
  - `leads = filtered.map(enrichLead)`.
  - `issueLeads` = every unit (the `copySplits` when there are more than 1,
    otherwise the record itself) that passes the filters **independently** of
    its parent, then enriched.
  - Writes the summary text, then `renderAll()`.
- `snapshotSlaHistory(asOf)` L161: temporarily sets `_renderNow = asOf ||
  _renderNow`. Enriches **all merged** leads (not the per-copy splits), counts
  open and breached leads per `ISSUE_PRIORITY` key, and calls
  `upsertSlaHistoryRows`; failures are swallowed.
- `clearSlaHistory` L206: reads `A2:A` to count rows, then `batchUpdate
  deleteDimension`. Errors propagate.
- `defaultDateRangeValue` L230: the **browser-local** date, `today-7 … today`
  (8 calendar days inclusive).
- `buildFilterUI` L238: options and counts come from `allParsedLeads` (Region via
  `effectiveRegion`). Defaults the date range only when both inputs are empty.
  Wires Reset.
- `buildMultiSelect` L300: a DOM-built checklist (options via `textContent`,
  safe), search, Select all, Clear.
- Global document click (L404) closes open panels.
- L411-413: a dangling comment fragment (leftover from the split).

### 3.10 js/core-rm-performance.js (1340 lines)

**Constants:**
- `RM_PERF_RULE_WEIGHTS`: notUpdated 1.5, followup 1.2, underCalled 1.0,
  stuck 0.8. `inactiveRm` is tracked but not scored.
- `SHRINKAGE_K = 8`; `MIN_VOLUME_LEADS = 5`; `CHRONIC_STREAK_DAYS = 3`;
  `FLAG_RATIO = 1.25`; `CONFIDENCE_THRESHOLD = 0.40`;
  `CONCENTRATION_BREADTH_CEILING = 0.25`.
- `RM_PERF_RULES` eligibility:
  - inactiveRm → created that day.
  - notUpdated → past grace OR never connected past the window.
  - followup → under 48h, past grace, connected.
  - underCalled and stuck → past grace.
- Exclusions: a leadership name set, an admin name set, the vendor regex
  `/futwork/i`, and the non-RM roles `a1, tm, rh, cluster head, city lead,
  commercial head`. Name aliases go through `RM_PERF_NAME_ALIASES`. The
  `.gs` twins are `RM_PERF_*_GS_`.
- Opp side: `RM_OPP_MIN_RESOLVED_LEADS 5`, `K 8`, `LOW_RATIO 0.5`,
  `CONFIDENCE 0.35`, `48H_BASIS_MIN_SHARE 0.5`, `MAX_FIRST_CAPTURE_LAG_HOURS
  12`. These are browser-only by design.

**Functions:**
- `passesRepeatOffenderFilters(rec, filters)` L234: the raw `region` OR its
  `mainRegionFor` value.
- `rmPerfPrimaryManagerFor` L251 (tl, then tm), `rmPerfRhFor` L256.
- `repeatOffendersRegionKey` L270: the Loan override via `group_source`, then
  `mainRegionFor`.
- `rmPerfCanonicalRmName` L368.
- `rmPerfIsLeadershipExcluded` L440.
- `_rmPerfDaysBetweenKeys` L458: UTC-noon calendar difference.
- `rmPerfNormalCdf` L477: Abramowitz & Stegun 7.1.26.
- `rmPerfBetaPosteriorVariance(peer, raw, n, K)` L498: αβ/((α+β)²(α+β+1)).
- **Stage 1 — `reconstructRmPerformanceObservations(dateKeys, keyFn, filters,
  hier)` L529.**
  - Takes `buildMovementHistories()` (grouped by client_id, sorted), then
    `splitHistoryByCopy` (**grouped by lead_id only**).
  - Per copy: drops records that fail the filters or are excluded, applies the
    day-key filter, and keeps the **latest record per IST day**.
  - Per day: works out the group key (null → skip) and runs
    `enrichSnapshotCached(rec)`, which replays `enrichLead` at
    `rec.snapshot_at` with `_enrichingHistorical = true`. A closed record is
    skipped.
  - For each eligible rule it pushes {name, lead_id, dayKey, rule, violated, rm,
    region}.
- **Stage 2 — `aggregateRmPerformance(obs)` L617.** Per group and rule:
  eligible/violation day counts, distinct eligible/violated lead sets, and per
  lead a sorted day list → longest run of consecutive violated days →
  `maxStreak` and `chronicLeads` (≥ 3). Per group: `distinctRMs` and
  `regionCounts`.
- `computeRmPerfPeerAverages` L684: rates pooled across groups, weighted by
  lead-days.
- **Stage 3+4 — `classifyRmPerformance(byGroup)` L721.** For each of the 4
  scored rules:
  - `shrunk = n/(n+K)·raw + K/(n+K)·peer`, with n = distinct eligible leads.
  - composite += w·shrunk; variance += w²·BetaVar.
  - concentrated = at least one chronic lead and breadth ≤ 25%.

  Classification:
  - nLeads (the union of eligible leads) < 5 → Insufficient Data.
  - Otherwise confidence = Φ((composite − 1.25·peerComposite)/√var); below
    0.40 → On Track; else concentrated → "Watch — concentrated", otherwise
    "Below Expectations".
  - A degenerate variance falls back to the point estimate.

  Also computes `primaryRegion` (the most frequent region) and `totalInstances`.
  The result is sorted by composite, descending.
- `computeRmPerformance` L846: the three stages above.
- `computeRmPerformanceByRegion` L892: discovers the regions, then runs a
  region-restricted RM rollup for each. The peer pool is that region only.
  Optionally joins Opp conversion, then rankable → score sort → top 5.
- **Opp side.**
  - `reconstructRmOppCohort(dateKeys, filters, hier, nowMs)` L1002: per copy,
    `first = copyHistory[0]`. Applies the filters and exclusions, requires an
    assigned date, and filters by the **assignment** day. Applies the lag guard
    (0-12h). Same-day evidence at `min(dayEnd IST, now)`. The 48h evidence is
    taken only once that window is complete. Uses
    `evidenceAtDeadline(…, null)` (latest at or before, else first after; never
    the live lead).
  - `aggregateRmOppConversion` L1060.
  - `computeRmOppPeerAverages` L1089.
  - `classifyRmOppConversion` L1108:
    - Picks one basis for the table: 48h if at least 50% of the cohort is
      complete, otherwise same-day.
    - Shrinks each rate.
    - `lowConversion` requires sufficient data, a peer rate > 0, and
      Φ((0.5·peer − shrunk)/sd) ≥ 0.35.
  - `joinRmOppConversion` L1158: `doubleFlag` = elevated AND low conversion.
  - `computeRmPerformanceWithOpp` L1172.
- **Display helpers:**
  - `rmOppDisplayCells` L1189 (raw percentages and fractions; "pending (N)").
  - `rmPerfConfidenceLabel` L1210.
  - `rmPerformanceDrivenBy` L1241 (**unused**, documented as such).
  - `rmPerformanceHierarchyCells` L1269.
  - `sortRmPerformanceByPriority` L1297 (**unused**, but its comment says both
    renderers use it).
  - `sortRmPerformanceByScore` L1310, `filterRmPerformanceWorst` L1322 (the
    count badge), `filterRmPerformanceRankable` L1338.

### 3.11 js/rm-performance-worker.js (189 lines)

- `importScripts` (L85) loads core-foundation, core-lead-model,
  core-outcome-engine, reports-build, tab-movement and core-rm-performance, all
  DOM-free at parse time.
- `onmessage` L98:
  - Receives {snapshots, dateKeys, filters, rmHierarchyByNameLower, nowMs}
    (structured clone; Sets, Maps and Dates survive) and assigns
    `movementSnapshots`.
  - Posts progress events for rm, opp, region, a1tm, rh and byRegion.
  - Runs stage by stage for the RM level, builds the Opp cohort once, joins it,
    and runs the region, a1tm and rh rollups only when the hierarchy is present,
    then byRegion.
  - Posts `done` with `stageCounts` (debug panel), or `error`.
- `_rmPerfWorkerClassificationCounts` L94.

### 3.12 js/main.js (20 lines)

Calls `initCollapsibleSectionInfo()`, `initRMTimelineUI()`, `initMovementUI()`
and `initAuthGate()` at parse time; it must load last.

## 4. End-to-end narrative

**Sign-in → fetch → render.**
1. `main.js` → `initAuthGate`. The user clicks Sign in → `gateSignIn` → a GIS
   popup → the callback stores the token.
2. → `fetchGateUserEmail` → the app shell is shown → `fetchAndRender`.
3. It reads `leads!A2:AZ` (row 2 holds the headers) through the Sheets API.
   UNFORMATTED/SERIAL date cells are rebuilt as gviz `Date()` strings for the
   two configured date columns only, and read as IST wall clock.
4. `HEADER_ALIASES` maps labels to fields → raw lead objects.
5. Union-find over lead_id/client_id, gated on region similarity, merges rows
   into customers. The primary copy is the furthest funnel stage that is not
   closed. Counters are MAX; comments are merged. Multi-lead_id customers also
   carry `copySplits`.
6. `allParsedLeads` → `buildFilterUI` → `applyFiltersAndRender`:
   - The overlay is shown, then two ticks pass.
   - Filters are applied to the merged records → `leads` (enriched); each
     split/unit independently → `issueLeads` (enriched).
   - The pass is pinned to one `_renderNow`. The call baselines come from
     `Movement_Log` (empty on the first pass; re-rendered when Movement_Log
     arrives).
7. → `renderAll()` (`overview-distribution-people-ops.js`) renders every tab.

**RM performance.**
1. `renderRepeatOffenders` / Recalculate → `runRepeatOffendersRecalculation`.
   It freezes a filter snapshot and the "now" timestamp and posts them to a
   fresh Worker. A newer run id supersedes older ones.
2. Stage 1 replays `enrichLead` at each record's own snapshot time (historical
   mode: today's attempts come from the comment-log count only).
3. Eligibility gates turn each record into per-rule pass/fail observations.
4. Stage 2 builds the rates and streaks. Peer averages are pooled across groups,
   weighted by lead-days.
5. Shrinkage uses distinct-lead units. The composite is weighted by severity.
   Classification uses a z-score against the 1.25× peer line, with a confidence
   threshold of 0.40 (deliberately below 0.5, so it is *less* conservative than
   the point-estimate rule).
6. The same pipeline runs again with other `keyFn`s for the Region, A1/TM and RH
   rollups, plus per-region RM top-5.
7. The Opp-conversion cohort is attributed to the first captured row of each
   copy and joined at display time; it is not a fifth classification tier.
8. If the Worker fails, `_runRepeatOffendersSynchronously` runs the same calls
   on the main thread.
9. The `.gs` console twin (`DailyRmIssueLog.gs`) keys on lead|day the same way
   and runs unfiltered.

## 5. Cross-runtime parity notes

- `python3 test/check-runtime-parity.py`: 16 plain pairs + regex + ruleset pairs.
  The only mismatch is the known, intentional `HEADER_ALIASES` browser-only keys
  (`lead_closing_comment`, `project_region`).
- **`enrichLead` vs `computeSlaFlags_` (`SlaEngine.gs` L46).** The rules match:
  - grace, `neverConnectedPastWindow` (not grace-gated), `isNotUpdated` (no
    48h cap), `followupOverdue` staleness chain, MAX(delta, logged-today), and
    the checkbox-safe `rm_is_active`.
  - Difference: the `.gs` side requires `lead_assigned_at` and
    `last_connect_time` to be real `Date` values (a text cell disables every
    rule there), while the browser parses strings too. This is benign while the
    sheet stores real dates.
- `isOppOrAbove` / `isClosedStage` / `isOpenLead` match `Core.gs` L94-L145
  exactly, **including the substring closing-reason fallback in G-6.** The defect
  is on both sides, so parity itself holds.
- The RM performance observation key (lead_id | IST day, latest row) matches
  `DailyRmIssueLog.gs` L1364-1383, so **G-1 affects both runtimes**. The console
  leaderboard has no Opp side by design.
- `rmPerfNormalCdf` is ported by hand (reference-value tests on both sides,
  per the comments).

## 6. Findings

**G-1 — HIGH — CONFIRMED (code mechanism; size of the effect unmeasured).**
`js/core-rm-performance.js:529-601` (and `DailyRmIssueLog.gs:1345-1390`).
- **What is wrong.** The violation engine emits observations only for (lead, IST
  day) pairs that have a `Movement_Log` row. Since content-hash dedup (Phase 6,
  fully effective 2026-09-25/26), `MovementTracker.gs` appends a row only when
  one of `SNAPSHOT_COLUMNS_` changes, and none of those columns is
  time-varying. A lead that nobody touches therefore has no rows after its last
  change.
- **Consequences.**
  - Such a lead contributes zero eligible lead-days on every untouched day.
  - `stageStuck48h` can never be observed for a lead untouched since before 48h.
  - The longest-streak / chronic-lead count is cut off.
  - Leads that are actively worked generate many observations.
  - The ranking therefore under-weights exactly the neglect it is meant to
    surface.
- **Scenario.** An RM leaves 10 new leads untouched for 5 days. Each lead
  produces about one observation (the first capture, often before the 3h grace
  ends, so only the never-connected path can fire). A diligent RM's leads change
  daily and accumulate eligible days and the occasional violation. The
  neglectful RM can read as "Insufficient Data" or "On Track".
- **Previous status.** HANDOVER §9.7.3 listed this as "worth checking, not
  confirmed broken".
- **Fix direction.** For each day, evaluate the latest row at or before that day's
  end, and evaluate it *as of* the day's reference time (for example 18:00 IST)
  rather than `rec.snapshot_at`, bounded by the lead's first row and its
  closure. This is the same carry-forward idea `evidenceAtDeadline` already uses
  on the Opp side.

**G-2 — MED — CONFIRMED (code); prevalence unmeasured.**
`js/tab-movement.js:794` (`splitHistoryByCopy`, which groups by lead_id only), as
used by `js/core-rm-performance.js:541-556` and `:1008-1012`.
- **What is wrong.** RM copies of one lead share a lead_id: F18 found 1,852
  leads with multiple rows, and `Movement_Log`'s dedup key is lead_id|RM. Those
  copies are merged into one "copy history".
- **Violation side.** Each day keeps only the latest row across *all* RMs. A tie
  on `snapshot_at` keeps the first row in sheet order, because of the strict
  `>` comparison. Only that row's RM gets the observation, and if that row is a
  closed unclaimed copy the day is dropped entirely (`!isOpenLead → return`).
  That hides the claiming RM's open copy.
- **Opp side.** `copyHistory[0]` attributes the whole lead to whichever RM's row
  is first.
- **Scenario.** A lead is pushed to RMs A and B. B's copy is cancelled at 14:00
  and A keeps working it. B's row (changed later) wins that day, the day is
  skipped as closed, and A's neglect or diligence on that lead is invisible.
- **Mismatch with the comments.** The code comments speak of "lead-copy"
  attribution as if it were per RM.

**G-3 — MED — CONFIRMED.**
`js/core-fetch-and-render.js:47-56`.
- **What is wrong.** `showLoadingOverlay('Loading your sheet…', true)` runs
  before the token check. When the silent re-auth leaves the token invalid, the
  function returns before the `try/finally`, so `hideLoadingOverlay(true)` never
  runs. Overlay depth stays at 1, and the solid full-screen "heavy" overlay
  (z-index 9999) blocks the page until a reload.
- **Scenario.** The tab sits idle for more than an hour. The user clicks
  Refresh, then cancels or denies the consent popup, or GIS returns an error.
  The page is stuck on the branded loading screen.

**G-4 — MED — CONFIRMED in code (GIS behaviour per Google's documentation).**
`js/core-auth.js:39-58, 78-106`.
- **What is wrong.** `initTokenClient` has no `error_callback`. GIS reports
  "popup closed" or "popup failed to open" through `error_callback`, not
  `callback`. The resolver pushed in `gateSignIn` is then never resolved.
- **Effects.**
  - In `fetchAndRender` this hangs forever with the overlay up (compounding
    G-3).
  - On the gate, each retry adds another pending resolver. When a later sign-in
    succeeds, every pending `handleGateSignInClick` continuation runs, so
    `fetchAndRender()` fires N times concurrently. The result is duplicate sheet
    reads, Movement_Log fetches, renders and SLA_History writes.
- **Fix.** Add an `error_callback` that flushes the resolvers, and de-duplicate
  concurrent sign-ins.

**G-5 — MED — SUSPECTED (depends on the `opp_at` cell type).** **FIXED 2e33f8d (2026-10-12)**
`js/core-fetch-and-render.js:83-84` with `js/core-sheets-fetch.js:159,174-190`.
- **What is wrong.** `isDateColLabel` covers only the `lead_assigned_at` and
  `last_connect_time` aliases. If `leads.opp_at` is a date-typed cell (as
  `lead_assigned_at` evidently is), the API returns a serial number, which is
  passed through raw. `gvizCellDate(number)` returns null, so `opp_at = ''` for
  every lead.
- **Impact.**
  - The Opp Monitor "Live" rows read 0% conversion.
  - Browser Movement_Log snapshots write a blank `opp_at`. The content hash then
    differs from `MovementTracker.gs`'s (which sees a `Date`), causing
    alternating re-appends.
- **Note.** `fetchMovementLog` also never maps `opp_at` onto its records, but
  that is outside this scope.
- **Verify.** In a signed-in console, run
  `allParsedLeads.filter(l => l.opp_at).length`.
- **Fix.** Add `HEADER_ALIASES.opp_at` to `isDateColLabel`.

**G-6 — MED — SUSPECTED (depends on the real closing-reason vocabulary).**
`js/core-lead-model.js:104-139` (and `Core.gs:115-123`).
- **What is wrong.** The closing-reason fallback runs the free-text reason
  through `canonicalStage`, which uses *substring* aliases.
- **Examples.**
  - "Booked elsewhere" or "Already booked with other builder" → 'booking'. So
    `isBookingLead` is true and the lead is counted as a confirmed Booking in
    the funnel, region and project tables. This applies even when
    `current_stage` is recognised, because the reason check is unconditional.
  - When the stage text is unrecognised (for example "Lost", "Junk" or "Closed",
    none of which are in `STAGE_ALIASES`), a reason mentioning
    visit/booked/eoi/opportunity/pipeline makes `isOppOrAbove` true.
- **Downstream effect.** This flows through `evidenceAtDeadline` into Daily Cohort
  and RM same-day/48h Opp%. A lost-to-competitor lead counts as a conversion.
  Notably, `OUTCOME_RULES` itself treats "already booked" and "booked elsewhere"
  as a *loss* signal.

**G-7 — LOW — CONFIRMED.**
`js/core-fetch-and-render.js:587-589` together with
`js/core-filters.js:42-51,161-173`.
- **What is wrong.** `applyFiltersAndRender()` defers its work by two ticks, but
  `snapshotSlaHistory()` is called synchronously right after it and enriches
  before its first `await`. So the SLA_History row uses the previous
  `_renderNow`, and empty or stale call baselines.
- **Scenario.** On first load, `_renderNow` is the script-parse time (when the
  sign-in page was opened). If the gate sat open across IST midnight, the row is
  dated the previous day, and `underCalledToday` uses only the comment-log
  count, inflating breaches.
- **Related mismatches.**
  - SLA_History counts come from merged records, while Operations counts come
    from `issueLeads`, so they disagree for multi-copy customers.
  - `dashboard.html` L1371 says SLA_History "feeds the trend chart above", but
    nothing in `js/` reads it (`core-filters.js` L144 says as much).

**G-8 — LOW — CONFIRMED.**
`js/core-fetch-and-render.js:556` (user-visible) and L226-229 (comment).
- **What is wrong.** The dedupe-notice detail says "calls and duration summed",
  and the FOUNDATION comment says attempts and duration are summed. Since the
  F18 fix the code takes the MAX (L435-437).
- **Impact.** Users are told the wrong merge rule.

**G-9 — LOW — SUSPECTED (memory only).**
`js/core-lead-model.js:51`, `js/core-outcome-engine.js:568` and `:177`.
- **What is wrong.** `_parseDateCache` and `_inferOutcomeCache` are never
  cleared; only `_actionLogCache` is cleared, on fetch.
- **Impact.** A long-lived tab refreshed many times keeps every distinct
  date/comment string seen, so memory grows without bound.

**G-10 — LOW — CONFIRMED.**
`js/core-lead-model.js:75` and `js/core-outcome-engine.js:80`.
- **What is wrong.** `parseDate` falls back to `new Date(s)` for any other
  format. Strings such as "2026-08-13 10:18:05.123", "2026/08/13 10:18" or
  "Aug 13 2026 10:18" resolve in the **browser's local zone**, breaking the IST
  pinning rule for non-IST viewers or CI.
- **Also.** `parseActionLog` accepts only `HH:MM`. An entry stamped `HH:MM:SS`
  loses its timestamp and logger, and becomes "unattributed".

**G-11 — LOW — CONFIRMED.**
`js/tab-repeat-offenders.js:420` vs `:438,447,457`.
- **What is wrong.** On a hierarchy failure the Worker receives
  `rmHierarchyByNameLower: null`. The synchronous fallback passes the global
  map to Stage 1, the cohort and byRegion, so a stale but non-empty map from an
  earlier fetch applies role exclusions on one path and not the other.
- **Impact.** This breaks the "can never quietly disagree" claim.

**G-12 — LOW — CONFIRMED.**
`js/core-fetch-and-render.js:75` (also `core-filters.js:210`).
- **What is wrong.** A1 ranges are built as `${tabName}!A2:AZ` without single
  quotes. A tab name containing spaces or punctuation fails with HTTP 400
  ("Couldn't read that tab").
- **Impact.** Harmless for `leads`.

**G-13 — INFO.** `js/core-filters.js:39`. `applyFiltersAndRender` silently drops
re-entrant calls. If the Movement_Log-arrival re-render (`fetchAndRender` L608)
lands inside the two-tick window of a pending pass, the call baseline is never
applied until the next filter change. Unlikely in practice.

**G-14 — INFO — dead code.**
- `sortRmPerformanceByPriority` (`core-rm-performance.js:1297`; its comment
  wrongly says both renderers use it).
- `collatedCountLabel` (`core-collation.js:155`).
- `rmPerformanceDrivenBy` (`core-rm-performance.js:1241`, documented as
  unused).
- `CONFIG.MIN_CALLS_AFTER_48H` is unused in the files read.

**G-15 — INFO — stale comments and docs.**
- `core-rm-performance.js:49-55`: says "nothing renders / later phases" and
  points to `_verify-rm-performance.html`, which has been deleted.
- `core-rm-performance.js:523-528`: says "4x-daily … latest is the 18:00
  capture". That is false under content-hash dedup (see G-1).
- `core-foundation.js:18-20,114,181`: refer to `reports.js` (now
  `reports-build.js` / `reports-ui.js`).
- `core-outcome-engine.js:731-747`: a duplicated docblock.
- `core-filters.js:411-413`: a dangling comment fragment.
- `rmOppDisplayCells`' comment says `rmPerformanceHierarchyCells` is "above"; it
  is below.
- `dashboard.html:1113`: says the Movement snapshot uses "its own, separate
  consent grant". In fact the gate token is reused (`core-auth.js:11-19`).
- `dashboard.html:1371`: see G-7.

**G-16 — INFO.** `js/core-filters.js:230-235`. The "last 7 days" default is
today−7 through today, which is 8 IST calendar days inclusive and is based on
the browser-local date (deliberate). Multi-select selections that no longer
exist after a refresh stay active, visible only as a count badge
(`buildMultiSelect`).

**G-17 — INFO — design.**
- `businessMinutesBetween` counts Sundays and holidays as working days.
- `isLeadClosed` treats any non-blank closing reason as closed, so a reopened
  lead with a leftover reason stays closed.
- `hasConnected` (text OR timestamp) and `neverConnectedPastWindow` (no
  timestamp) can both be true, so a lead with `last_connect` text but no time
  can be both Not Updated and Follow-up Overdue.

**XSS / escaping.** No gap found in these files. Every interpolated data value
goes through `esc()`; numbers and internal ids are interpolated raw; the
multi-select uses `textContent`. `suggestedFollowUp` / `unmatchedFollowUp`
return raw text containing RM comments. The dashboard call sites
(`tab-movement.js:753,1259`) escape it; the email builders in `reports-build.js`
are for the reports auditor to check.

## 7. Open questions

1. Is `leads.opp_at` stored as a real date cell? This decides G-5.
2. How many lead_ids in `Movement_Log` carry rows for more than one RM within the
   7-day window? This sizes G-2.
3. What are the real `closing_reason` / `lead_closing_reason` values? In
   particular, how many contain booked/visit/eoi/opportunity on lost leads?
   This sizes G-6.
4. Is G-1 worth confirming numerically before a fix? A practical check is to
   count distinct (lead, day) pairs in `Movement_Log` against
   `Movement_Log_Runs` × open leads for the same window.
5. Does any Apps Script job or external report read `SLA_History`? If so, G-7
   moves up in severity.
6. Was the merge of multiple RM copies into one lead_id history (G-2) a
   deliberate choice after the 2026-09-26 dedup-key change, or an unnoticed side
   effect of it?
