# JS-025 — tab-oppmonitor.js

| | |
|---|---|
| **Type** | `JS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `js/tab-oppmonitor.js` (445 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Validated |
| **Last Verified** | 2026-09-21 against commit `55bf870` |

## Purpose / reason to exist

Implements the Opp Monitor tab (`TAB-009`): displays the recurring
monthly Google Non-UTM/Search Same-day/48h Opp% workflow's results and
12-step checklist progress. Two new Sheet tabs (`SHEET-016`, `SHEET-017`)
an external analytics session writes to hold the OFFICIAL, recorded
figures — those are shown exactly as recorded, never recomputed. It
exists so that workflow's output doesn't live only in a separate local
To-Do Dashboard tool — the numbers and completion status are visible on
the production dashboard itself.

**Changed 2026-09-21**: the `leads` tab gained a real `opp_at` column
(first Opportunity-stage transition timestamp — `HEADER_ALIASES`,
`JS-009`), so this file now ALSO reads the global `leads` array: any
period/month slot with no official Sheet row yet (most usefully the one
still in progress) is computed live, right here, from
`lead_assigned_at`/`opp_at`, and rendered with a "Live" tag. It's no
longer a pure display-only file (still reads no `filterState` — the
official AND live numbers are both fixed aggregates for the tab's own
stated scope, not sliceable by the shared filters).

## Responsibilities

- `fetchOppMonitorData(sheetId)` / `_fetchOppMonitorTab(...)` — read both
  sheets, gracefully treating a missing tab as "nothing archived yet."
- `renderOppMonitorTab()` — the 3-section render (checklist, period
  table, month table).
- `oppMonitorPctDelta` / `_oppMonitorPctCellHtml` — delta computation +
  cell HTML, reusing `wowDeltaBadgeHtml` (`JS-024`) for the badge itself.
- `_oppMonitorYearMonth` / `_oppMonitorShiftYearMonth` — month-key
  arithmetic local to this file (nothing in `core-foundation.js` does
  this today).
- `_oppMonitorMonthName(yearMonth)` — `"YYYY-MM"` → `"<Month> YYYY"` for
  the Period Results table's Month column (added 2026-09-18; the Monthly
  Trend table already had a `month_label` column to fall back to, but the
  Period table only ever had the raw `year_month` key).
- **Live computation (added 2026-09-21)**: `_oppMonitorComputeLiveMetrics`
  / `_oppMonitorLivePeriodRow` / `_oppMonitorLiveMonthRow` /
  `_oppMonitorPeriodDayRange` / `_oppMonitorDateStr` / `_oppMonitorOrdinal`
  — fills a period/month slot lacking an official row by computing the
  same metrics from `leads`, scoped by `lead_assigned_at`'s IST calendar
  day. Never overrides a slot that already has a real Sheet row.

## Load order / position

Loads right after `tab-tracking.js` (`dashboard.html`'s script list) —
needs `wowDeltaBadgeHtml` from that file, plus everything from the
`core-*.js` files already loaded earlier. Order relative to the other
`tab-*.js` files is narrative only, per this app's own convention.

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-259 | `fetchOppMonitorData(sheetId)` `#L80` | a sheet id | populates `oppMonitorPeriodRows`/`oppMonitorMonthRows`; sets both fetch-state vars | 2 parallel Sheets reads | `_fetchOppMonitorTab` (FN-260) | `fetchAndRender` (`js/core-fetch-and-render.js`, best-effort, non-blocking) | specific — the tab's own loader, independent of every other fetch in the app |
| FN-260 | `_fetchOppMonitorTab(sheetId, tabName, columns)` `#L49` | sheet id, tab name, column list | `{rows, state}` | one Sheets read | `sheetsApiValuesGet` / `valuesToGvizShape` (`JS-009`) | FN-259 (called twice, once per sheet) | reusable — generic small-table reader, mirrors `fetchRmHierarchyForRollup` (`JS-022`)'s missing-tab-is-not-an-error pattern |
| FN-261 | `renderOppMonitorTab()` `#L441` | `oppMonitorPeriodRows`/`oppMonitorMonthRows`, global `leads`, `_renderNow` | the checklist + 2 tables in `#tab-oppmonitor` | DOM writes | `_renderOppMonitorChecklist`/`_renderOppMonitorPeriodTable`/`_renderOppMonitorMonthTable` (`#L240`/`#L321`/`#L382`) | `renderAll` (`JS-012`) | specific |
| FN-262 | `oppMonitorPctDelta(curPct, prevPct)` / `_oppMonitorPctCellHtml(curPct, prevPct)` `#L96/#L102` | two already-computed percentages | `{cur, prev, delta}` / a table-cell HTML string | none | `wowDeltaBadgeHtml` (`JS-024`) | FN-261's 3 render helpers | reusable — unlike `wowPctDelta` (`JS-024`), diffs two stored percentages directly rather than deriving cur/prev from raw counts, since this tab never has a local numerator/denominator to recompute from |
| FN-263 | `_oppMonitorYearMonth(date)` / `_oppMonitorShiftYearMonth(yearMonth, n)` `#L109/#L114` | a date / a `"YYYY-MM"` string + integer | the IST year-month key / that key shifted by n months | none | `istParts` (`JS-005`) | FN-261's 3 render helpers | reusable within this file |
| FN-264 | `_oppMonitorMonthName(yearMonth)` `#L121` | a `"YYYY-MM"` string | `"<Month name> YYYY"`, or the raw input if unparseable | none | — | `_renderOppMonitorPeriodTable`/`_renderOppMonitorMonthTable` | reusable within this file — local month-name array, not a reuse of `reports-build.js`'s `IST_MONTHS` (no cross-file dependency for a 12-item constant) |
| FN-267 | `_oppMonitorOrdinal(n)` / `_oppMonitorPeriodDayRange(yearMonth, periodNumber)` / `_oppMonitorDateStr(yearMonth, day)` `#L143/#L153/#L161` (added 2026-09-21) | a day number / a year-month + period number / a year-month + day | `"1st"`/`"21st"` etc. / `{fromDay, toDay, label}` matching the exact `period_label` style a sourced row has / a `"YYYY-MM-DD"` string | none | — | FN-268, FN-269 | reusable within this file |
| FN-268 | `_oppMonitorComputeLiveMetrics(leadsArr, yearMonth, fromDay, toDay)` `#L170` (added 2026-09-21) | the global `leads` array, a year-month, a day range | `null` if no leads in scope, else `{total_leads, same_day_count, h48_count, same_day_pct, h48_pct, avg_hrs_to_opp, avg_days_to_opp, _live:true}` | none (pure) | `parseDate` (`JS-006`), `istParts`/`istSameDay` (`JS-005`) | FN-269 | specific — same-day = `opp_at` on the same IST calendar day as `lead_assigned_at`; within-48h = the gap `<=48` hours; a negative gap (data anomaly, not a real conversion — same defensive guard the 2026-09-21 ClickHouse epoch-zero-sentinel incident showed is genuinely necessary) is excluded from every metric |
| FN-269 | `_oppMonitorLivePeriodRow(yearMonth, periodNumber, leadsArr)` / `_oppMonitorLiveMonthRow(yearMonth, leadsArr)` `#L206/#L217` (added 2026-09-21) | a year-month (+ period number) + `leads` | a synthesized row in the exact shape a real `Opp_Monitor_Period`/`Month` row has (`source:'live'`), or `null` | none | FN-267, FN-268 | `_renderOppMonitorPeriodTable`/`_renderOppMonitorMonthTable` | specific — lets the existing render code display a live row identically to a sourced one, only the `_live` flag/tag differ |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-094 | `Opp_Monitor_Period`/`Opp_Monitor_Month` tab doesn't exist yet (Sheets API 400 on the range) | `_fetchOppMonitorTab` returns `state:'missing'`, never throws | checklist shows a "no data yet" notice; tables show their own empty-state notice |
| EXC-095 | a genuine fetch failure (non-400) | `state:'error'` | a distinct "could not read — check the tab exists and is shared correctly" notice, not silently blank |
| EXC-096 | a period/month with no row for the current 3-month window | simply omitted from the table | no dash row, no placeholder — consistent with the "no backfill" design decision |
| EXC-098 | a period/month with no sourced row AND no `leads` in scope for that window either (added 2026-09-21) | `_oppMonitorComputeLiveMetrics` returns `null`; the row stays omitted, same as `EXC-096` | slot is simply absent, never a live row showing `0`/`—` — "genuinely nothing happened" reads differently from "0 of 0" |

## Data lineage

`Opp_Monitor_Period` / `Opp_Monitor_Month` (`SHEET-016`/`SHEET-017`,
written externally) → `fetchOppMonitorData` (FN-259) →
`oppMonitorPeriodRows`/`oppMonitorMonthRows` (state) →
`renderOppMonitorTab` (FN-261) → screen. **Second lineage, added
2026-09-21**: `SHEET-001` (`leads`, via `HEADER_ALIASES.opp_at`) →
`allParsedLeads`/`leads` (`JS-003`) → `_oppMonitorComputeLiveMetrics`
(FN-268, read directly from the global `leads`, no separate fetch) →
`_oppMonitorLivePeriodRow`/`_oppMonitorLiveMonthRow` (FN-269) → the same
render functions, for any slot the first lineage didn't fill. Nothing
persists back; this file has no write path at all — a live row is
recomputed on every render, never cached or written to a Sheet.

## Data sources accessed

`SHEET-016`, `SHEET-017` (own reads via `sheetsApiValuesGet`). `leads`
(global state, `JS-003`/`JS-009` — added 2026-09-21, read directly, no
own fetch). Auth: `gateAccessToken` (`JS-001`, indirectly via `JS-009`).
Integration: `EXT-001`.

## Data written / modified

None.

## Failure / error behaviour

Fully defensive by design — every fetch path is wrapped, every render
path handles a missing/error/empty state explicitly. No throw paths
reachable from normal use (verified: `tests/frontend-harness.html`'s
"fetch+render completes with no throw" assertion, both for the
empty-sheet case exercised by the main test's shared mock and the
isolated-fixture case).

## Cross-runtime duplication

None — browser-only, no `.gs` counterpart, for either lineage. The two
Sheet tabs it reads have no writer anywhere in this codebase (see
`SHEET-016`/`SHEET-017`'s own `## Writers` sections) — data arrives
entirely out-of-band. The live-computation logic added 2026-09-21
(`_oppMonitorComputeLiveMetrics` et al.) is also **deliberately
browser-only** — nothing in Apps Script currently sends an Opp% email or
otherwise needs this number server-side, so there is no `GS-XXX` twin to
keep in sync. Worth a second look if that ever changes (an automated
email quoting this figure would need the identical calculation
server-side, the same class of risk `test/check-runtime-parity.py`
exists to catch for the pairs that DO have both sides).

## UI relationships

`#tab-oppmonitor` panel and its 3 sections
(`#sec-oppmonitor-checklist`/`-periods`/`-months`) — all on `TAB-009`. No
buttons, no multi-selects.

## Architecture relationship

`DASH-001`. Layer 10 (Render / UI).

## Related documentation

`HANDOVER.md` §2 (once added — see `TAB-009`'s own Next action); the
session's plan file for the full design rationale (canonical-cache-style
tab structure was NOT used here on purpose — this tab has no live
recalculation to cache, it's pure display).

## Relationships

- **Depends On:** `JS-005` (`istParts`, `istSameDay`), `JS-006`
  (`_renderNow`, `parseDate` — the latter added as a real dependency
  2026-09-21), `JS-009` (`sheetsApiValuesGet`, `valuesToGvizShape`,
  `gvizCellRaw`, `HEADER_ALIASES.opp_at`), `JS-003` (the global `leads`
  array this file now reads directly), `JS-010` (`esc`), `JS-024`
  (`wowDeltaBadgeHtml`), `EXT-001`, `SHEET-001` (`leads`, via `opp_at`),
  `SHEET-016`, `SHEET-017`
- **Used By:** `JS-003` (`fetchOppMonitorData`/`renderOppMonitorTab`
  called directly from `fetchAndRender()`'s success path), `JS-012`
  (`renderAll` calls `renderOppMonitorTab`; the
  filter-bar-hiding block lives in this same file's tab-switch handler),
  `TAB-009`
- **Related:** `JS-022` (`fetchRmHierarchyForRollup` — the missing-tab
  read pattern this file's own reader mirrors), `JS-024` (`tab-tracking`
  — the delta-badge visual language this file reuses unmodified)

## Source of truth

`js/tab-oppmonitor.js` at `HEAD`.

## Validation

- **Method:** written and verified in the same session. Function list is
  exact (read directly from source, not estimated).
  `tests/frontend-harness.html`'s isolated-fixture block calls
  `fetchOppMonitorData`/`renderOppMonitorTab` directly against synthetic
  `Opp_Monitor_Period`/`Opp_Monitor_Month` rows (frozen clock 2026-09-09,
  so a 2026-07/08/09 window) and asserts chip counts, cross-month-boundary
  delta math, row-omission on absent data, opp-count/avg-days/avg-hrs
  column rendering, month-name rendering, and the filter-bar toggle
  (90/90 pass after the 2026-09-18 column addition). Also exercised
  live: `fetchOppMonitorData`/`renderOppMonitorTab` ran against the real
  signed-in dashboard against the live `Opp_Monitor_Period`/
  `Opp_Monitor_Month` tabs with real backfilled data, confirmed via
  screenshot.
- **Evidence:** `tests/frontend-harness.html`; live dashboard session.
- **Status:** Validated 2026-09-21. Revalidated for the live-computation
  addition: `tests/frontend-harness.html` gained a dedicated block
  (synthetic `leads` covering same-day/exactly-48h-boundary/never-reached-
  Opportunity/96h cases) asserting the exact hand-calculated expected
  values (25.0%/50.0%/50 hrs/2.08 days) AND that a slot with a real sourced
  row is never overridden even with qualifying `leads` in scope (94/94
  pass). Also confirmed against the real production `leads` tab's own
  `opp_at` data via the signed-in dashboard.

## Version / change reference

Verified at `4bbb58c`; record created same commit (net-new file).
Revalidated 2026-09-18 (same day) for the `_oppMonitorMonthName` helper,
the opp-count/avg-days/avg-hrs table columns, and the Scope line added to
`dashboard.html`'s `#tab-oppmonitor` intro text. Revalidated 2026-09-21
for the live-computation feature (file grew 324L → 445L) — this record's
"reads neither `leads` nor `filterState`" claim is now half-true (still
no `filterState`) and has been corrected throughout.

## Revalidation trigger

Any commit touching `js/tab-oppmonitor.js`; either sheet's column schema
changes (`OPP_MONITOR_PERIOD_COLUMNS`/`OPP_MONITOR_MONTH_COLUMNS`); the
underlying workflow's step count/structure changes (currently 3
periods x 3 steps + 3 month-level steps = 12); `wowDeltaBadgeHtml`'s
signature changes (`JS-024`); the live-computation methodology changes
(same-day/48h-hour thresholds, the negative-gap exclusion guard);
`HEADER_ALIASES.opp_at` (`JS-009`) changes.

## Handover relationship

Not yet in `HANDOVER.md` — see `TAB-009`'s Next action.

## Lifecycle / retention

N/A — code.

## Next action

Add a `HANDOVER.md` §2 entry alongside `TAB-009`'s.

## Closure evidence

Not yet closed — `Record Status: Validated`. Live-sheet data check done
2026-09-18 (see `TAB-009`'s Next action for the `HANDOVER.md` step still
outstanding).
