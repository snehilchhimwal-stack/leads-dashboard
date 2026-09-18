# JS-025 — tab-oppmonitor.js

| | |
|---|---|
| **Type** | `JS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `js/tab-oppmonitor.js` (324 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Validated |
| **Last Verified** | 2026-09-18 (pending commit) |

## Purpose / reason to exist

Implements the Opp Monitor tab (`TAB-009`): a pure display layer over two
new Sheet tabs (`SHEET-016`, `SHEET-017`) an external analytics session
writes to, showing the recurring monthly Google Non-UTM/Search Same-day/
48h Opp% workflow's results and 12-step checklist progress. It exists so
that workflow's output doesn't live only in a separate local To-Do
Dashboard tool — the numbers and completion status are visible on the
production dashboard itself. Unlike every other tab file, it reads
neither `leads` nor `filterState`.

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

## Load order / position

Loads right after `tab-tracking.js` (`dashboard.html`'s script list) —
needs `wowDeltaBadgeHtml` from that file, plus everything from the
`core-*.js` files already loaded earlier. Order relative to the other
`tab-*.js` files is narrative only, per this app's own convention.

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-259 | `fetchOppMonitorData(sheetId)` `#L69` | a sheet id | populates `oppMonitorPeriodRows`/`oppMonitorMonthRows`; sets both fetch-state vars | 2 parallel Sheets reads | `_fetchOppMonitorTab` (FN-260) | `fetchAndRender` (`js/core-fetch-and-render.js`, best-effort, non-blocking) | specific — the tab's own loader, independent of every other fetch in the app |
| FN-260 | `_fetchOppMonitorTab(sheetId, tabName, columns)` `#L38` | sheet id, tab name, column list | `{rows, state}` | one Sheets read | `sheetsApiValuesGet` / `valuesToGvizShape` (`JS-009`) | FN-259 (called twice, once per sheet) | reusable — generic small-table reader, mirrors `fetchRmHierarchyForRollup` (`JS-022`)'s missing-tab-is-not-an-error pattern |
| FN-261 | `renderOppMonitorTab()` `#L320` | `oppMonitorPeriodRows`/`oppMonitorMonthRows`, `_renderNow` | the checklist + 2 tables in `#tab-oppmonitor` | DOM writes | `_renderOppMonitorChecklist`/`_renderOppMonitorPeriodTable`/`_renderOppMonitorMonthTable` (`#L128`/`#L209`/`#L264`) | `renderAll` (`JS-012`) | specific |
| FN-262 | `oppMonitorPctDelta(curPct, prevPct)` / `_oppMonitorPctCellHtml(curPct, prevPct)` `#L85/#L91` | two already-computed percentages | `{cur, prev, delta}` / a table-cell HTML string | none | `wowDeltaBadgeHtml` (`JS-024`) | FN-261's 3 render helpers | reusable — unlike `wowPctDelta` (`JS-024`), diffs two stored percentages directly rather than deriving cur/prev from raw counts, since this tab never has a local numerator/denominator to recompute from |
| FN-263 | `_oppMonitorYearMonth(date)` / `_oppMonitorShiftYearMonth(yearMonth, n)` `#L98/#L103` | a date / a `"YYYY-MM"` string + integer | the IST year-month key / that key shifted by n months | none | `istParts` (`JS-005`) | FN-261's 3 render helpers | reusable within this file |
| FN-264 | `_oppMonitorMonthName(yearMonth)` `#L109` | a `"YYYY-MM"` string | `"<Month name> YYYY"`, or the raw input if unparseable | none | — | `_renderOppMonitorPeriodTable`/`_renderOppMonitorMonthTable` | reusable within this file — local month-name array, not a reuse of `reports-build.js`'s `IST_MONTHS` (no cross-file dependency for a 12-item constant) |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-094 | `Opp_Monitor_Period`/`Opp_Monitor_Month` tab doesn't exist yet (Sheets API 400 on the range) | `_fetchOppMonitorTab` returns `state:'missing'`, never throws | checklist shows a "no data yet" notice; tables show their own empty-state notice |
| EXC-095 | a genuine fetch failure (non-400) | `state:'error'` | a distinct "could not read — check the tab exists and is shared correctly" notice, not silently blank |
| EXC-096 | a period/month with no row for the current 3-month window | simply omitted from the table | no dash row, no placeholder — consistent with the "no backfill" design decision |

## Data lineage

`Opp_Monitor_Period` / `Opp_Monitor_Month` (`SHEET-016`/`SHEET-017`,
written externally) → `fetchOppMonitorData` (FN-259) →
`oppMonitorPeriodRows`/`oppMonitorMonthRows` (state) →
`renderOppMonitorTab` (FN-261) → screen. Nothing persists back; this file
has no write path at all.

## Data sources accessed

`SHEET-016`, `SHEET-017` (own reads via `sheetsApiValuesGet`). Auth:
`gateAccessToken` (`JS-001`, indirectly via `JS-009`). Integration:
`EXT-001`.

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

None — browser-only, no `.gs` counterpart. The two Sheet tabs it reads
have no writer anywhere in this codebase (see `SHEET-016`/`SHEET-017`'s
own `## Writers` sections) — data arrives entirely out-of-band.

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

- **Depends On:** `JS-005` (`istParts`), `JS-006` (`_renderNow`), `JS-009`
  (`sheetsApiValuesGet`, `valuesToGvizShape`, `gvizCellRaw`), `JS-010`
  (`esc`), `JS-024` (`wowDeltaBadgeHtml`), `EXT-001`, `SHEET-016`,
  `SHEET-017`
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
- **Status:** Validated 2026-09-18 (author-verified, no second reviewer
  yet).

## Version / change reference

Verified at `4bbb58c`; record created same commit (net-new file).
Revalidated 2026-09-18 (same day) for the `_oppMonitorMonthName` helper,
the opp-count/avg-days/avg-hrs table columns, and the Scope line added to
`dashboard.html`'s `#tab-oppmonitor` intro text.

## Revalidation trigger

Any commit touching `js/tab-oppmonitor.js`; either sheet's column schema
changes (`OPP_MONITOR_PERIOD_COLUMNS`/`OPP_MONITOR_MONTH_COLUMNS`); the
underlying workflow's step count/structure changes (currently 3
periods x 3 steps + 3 month-level steps = 12); `wowDeltaBadgeHtml`'s
signature changes (`JS-024`).

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
