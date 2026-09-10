# JS-012 — overview-distribution-people-ops.js

| | |
|---|---|
| **Type** | `JS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `js/overview-distribution-people-ops.js` (1576 lines — the largest tab file) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

The workhorse render module. It owns `renderAll()` — the single
orchestrator that renders **every** tab in one pass — plus the full
content of Overview, Distribution, People and Operations: the KPI strip,
funnel / region / TL / project / RM tables, the RM SLA-score table,
fan-out / claim-rate, the allocation matrix, source mix, and every one
of the Operations SLA issue-list cards. It also owns tab switching (a
pure `display` toggle) and 2 CSV exports. It exists because these four
tabs share so many helpers (`colorForIssue`, `renderBreakdownCard`,
`topBreakdown`, `csvEscape`) that splitting them would just create
cross-file churn.

## Responsibilities

- `renderAll()` — render all tabs once; clear `_logLeadRegistry` at the
  top (`#L164`).
- Overview/Distribution/People tables + KPI strip.
- All Operations issue-list cards (one `render*List` per SLA check).
- Tab switching (delegated click on `#tabBar`).
- `downloadIssuesCSV` / `downloadFilteredLeadIdsCSV`.

## Load order / position

Loads near the end of the tab group, before `main.js`
(`LOGIC_AUDIT.md` Part 1 §4a).

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-077 | `renderAll()` `#L159` | `leads`, `issueLeads` | writes every tab's DOM | `_logLeadRegistry.clear()` `#L164`; calls ~20 `render*` fns incl. `renderTrackingTab` / `renderAudit` / `renderRMTimelineTab` / `renderMorningBrief` (gated) | every `render*` here + `JS-019` / `JS-023` / `JS-024` / `JS-020` | `applyFiltersAndRender` (`JS-004`), `fetchAndRender` (`JS-003`) | specific — the master orchestrator |
| FN-078 | `computeRMScoreRows()` `#L494` | `leads` | per-RM `{open, breached, score}` rows; score = `(open − breached) / open × 100` over **open leads only** | none | `medianOfSorted` / `percentileOfSorted` | `renderRMScoreTable` (FN-079), `tab-morning.js` (`JS-020`) | reusable |
| FN-079 | `renderRMScoreTable` / `renderRMTable` `#L567/#L998` | score rows | the RM tables; `renderRMTable` flags ±25% load vs peer average | DOM write | `computeRMScoreRows` (FN-078), `renderBreakdownCard` (FN-082) | `renderAll` (FN-077) | specific |
| FN-080 | `renderStageBreakdown` / `renderFunnel` / `renderRegionTable` / `renderTLTable` / `renderProjectTable` / `renderSourceBreakdown` / `renderSourceMix` / `renderFanout` / `renderAllocationMatrix` `#L17`..`#L796` | `leads` | the Overview/Distribution tables | DOM writes | `topBreakdown` (FN-083), `renderBreakdownCard` (FN-082), `esc` (`JS-010`) | `renderAll` (FN-077) | specific |
| FN-081 | Operations issue lists: `renderDueTodayList`, `renderApproachingDeadlineList`, `renderStuckList`, `renderInactiveRmList`, `renderNotUpdatedList`, `renderRecordingList`, `renderClosedNoCommentList`, `renderNotConnectedList`, `renderFollowupList` `#L1084`..`#L1353` | `issueLeads` | the Operations SLA cards | DOM writes; `logToggleMarkup` on each card | `renderAlertCard` (`JS-010`), `logToggleMarkup` (`JS-010`), `groupLeadsByCalendarDay` (`JS-005`) | `renderAll` (FN-077) | specific — all 9 confirmed to include `.log-toggle` (`LOGIC_AUDIT.md` Part 6 §6.1 row 4) |
| FN-082 | `renderBreakdownCard(el, opts)` / `colorForIssue(issue, i)` `#L1438/#L1430` | element + options | a shared breakdown card / an issue colour | DOM write | `topBreakdown` (FN-083) | called back from nearly every tab file | reusable — shared helpers |
| FN-083 | `topBreakdown(arr, keyFn, opts)` `#L133` | list + key fn | top-N `{key, n, pct}` | none | — | breakdown cards across tabs, `tab-morning.js` | reusable |
| FN-084 | `computeDailyLeadCounts()` / `renderDailyTrend()` `#L402/#L420` | `leads` | per-day counts / the trend chart | DOM write | `istDateKey` (`JS-005`) | `renderAll` (FN-077), `tab-morning.js` | reusable / specific |
| FN-085 | `downloadIssuesCSV()` / `downloadFilteredLeadIdsCSV()` `#L1522/#L1493` | `issueLeads` / `leads` | a CSV download | triggers a browser download | `csvEscape` (FN-086) | `#downloadIssuesBtn` (`BTN-001`), `#downloadLeadIdsBtn` (`DASH-001`) | specific |
| FN-086 | `csvEscape(v)` `#L1479` | any value | CSV-safe string | none | — | every CSV export in the app | reusable |
| FN-087 | `updateTabBadges()` / `renderJumpNav()` `#L376/#L330` | counts | tab-bar badge counts / the in-page jump nav | DOM writes | `numFromCountEl` | `renderAll` (FN-077) | specific |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-020 | `renderAll` called before a fetch (`leads` empty) | every `render*` handles an empty list | all tabs render zeros/empties, no crash |
| EXC-021 | CSV export in a sandboxed viewer | `<a download>` is inert | nothing downloads; no error |

## Data lineage

`leads` / `issueLeads` (state, from `JS-004`) → the `render*` functions
here → DOM. CSV exports: `issueLeads` / `leads` → `csvEscape` → a
download blob. No Sheet writes. Tab switching reads no data — pure
`display` toggle on pre-rendered DOM.

## Data sources accessed

Reads `leads` / `issueLeads` (state). Borrows `computeStalledLeads` /
`downloadUnmatchedCommentsCSV` from `JS-021`.

## Data written / modified

None to a Sheet. Writes DOM for every tab; triggers CSV downloads.

## Failure / error behaviour

Every `render*` is defensive against an empty/partial list. No throw
paths surfaced to the user; a fetch error is shown by `JS-003`.

## Cross-runtime duplication

The RM-score formula (`computeRMScoreRows`) is a dashboard-only view —
no `.gs` twin. The Operations issue lists render the flags `enrichLead`
(`JS-006`) computed; the *rule* duplication is on `JS-006` ↔ `GS-012`,
not here.

## UI relationships

`#tabBar` (tab switching), all 8 tab panels' Overview/Distribution/
People/Operations content, `#downloadIssuesBtn` (`BTN-001`),
`#downloadLeadIdsBtn` (`DASH-001`). `.log-toggle` on issue cards
(`UI-003`).

## Architecture relationship

`DASH-001`. Layer 10 (Render / UI — `renderAll` is the orchestrator) in
`LOGIC_AUDIT.md` Part 1 §1.

## Related documentation

`HANDOVER.md` §2, §3 step 3; `LOGIC_AUDIT.md` Part 1 §1 layer 10, §4c,
Part 5 §5.1 (KPI audit), Part 6 §6.1 rows 1/4.

## Relationships

- **Depends On:** `JS-002` (`leadIdentityLine`), `JS-004` (`renderAll`
  is called from there), `JS-005` (IST helpers,
  `groupLeadsByCalendarDay`), `JS-006` (`enrichLead` output), `JS-007`,
  `JS-010` (`esc`, `renderAlertCard`, `logToggleMarkup`), `JS-014`
  (`effectiveRegion`, `mainRegionFor`), `JS-019`, `JS-020`, `JS-021`
  (`computeStalledLeads`, `downloadUnmatchedCommentsCSV`), `JS-022`,
  `JS-023`, `JS-024`
- **Used By:** `TAB-001`, `TAB-002`, `TAB-003`, `TAB-005`, `JS-003`,
  `JS-004` (call `renderAll`), `JS-019`, `JS-020` (borrows
  `computeRMScoreRows` / `computeDailyLeadCounts` / `topBreakdown`),
  `JS-021`, `DATA-002` — every tab file (borrows `colorForIssue` /
  `renderBreakdownCard` / `csvEscape`)
- **Related:** `JS-019`, `JS-023`, `JS-024`, `JS-020` (all called from
  `renderAll`)

## Source of truth

`js/overview-distribution-people-ops.js` at `HEAD`.

## Validation

- **Method:** full read at `c82ec67`; function list verified by grep;
  cross-check `LOGIC_AUDIT.md` Part 1 §4c + Part 5 §5.1 + Part 6 §6.1
  (rows 1 and 4 — `_logLeadRegistry` clear at `#L164` and all 9 issue
  lists carrying `.log-toggle` — both confirmed not-reproduce).
  `tests/frontend-harness.html` runs `renderAll` + each touched
  `render*` on synthetic leads.
- **Evidence:** `LOGIC_AUDIT.md` Part 5 §5.1, Part 6 §6.1;
  `tests/frontend-harness.html`.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-028.

## Revalidation trigger

Any commit touching `js/overview-distribution-people-ops.js`; a KPI /
breakdown table is added/removed; the RM-score formula or ±25% load
threshold changes; `renderAll`'s call list changes; the
`_logLeadRegistry.clear()` at `#L164` moves; `renderAlertCard` /
`csvEscape` contract changes.

## Handover relationship

`HANDOVER.md` §2 names the file; §3 covers the "renders every tab in one
pass" model. Current as of 2026-09-09. A change to the render-once model
or the KPI definitions must update `HANDOVER.md` §3 in the same commit.

## Lifecycle / retention

N/A — code.

## Next action

none — Closed + Monitored.

## Closure evidence

Record committed for DOC-028; `docs/INDEX.md` `JS-012` → `Closed +
Monitored`, `Last Verified` 2026-09-10, reciprocal links to `TAB-002` /
`TAB-003` / `TAB-005` confirmed both directions; `EXC-020`/`021`
recorded. No `docs/changes/` record (DOC-028).
