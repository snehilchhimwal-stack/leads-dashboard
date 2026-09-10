# JS-004 — core-filters.js

| | |
|---|---|
| **Type** | `JS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `js/core-filters.js` (413 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

There is no server-side filtering in this system — the whole book of
leads is in the browser, and every "filter by region / project / TL /
source / sub-source" is done here, in memory. This module rebuilds
`leads` / `issueLeads` from `allParsedLeads` per the multi-select filter
bar's `filterState`, re-runs `enrichLead`, and triggers `renderAll()`.
It also owns the shared multi-select dropdown widget (`buildMultiSelect`)
every filter bar in the app uses, and the `SLA_History`
snapshot/clear admin actions. It exists so filtering is instant and
consistent across all 8 tabs from one code path.

## Responsibilities

- `applyFiltersAndRender()` — the debounced, overlay-guarded filter pass.
- `buildFilterUI()` / `buildMultiSelect()` — the dropdown-checklist-with-
  search widget backing `#msProject` / `#msRegion` / `#msTL` /
  `#msSource` / `#msBucket` (+ `#msAuditPeriod`).
- `snapshotSlaHistory()` / `clearSlaHistory()` — SLA_History admin.

## Load order / position

Ninth in the real order — last of the core group, right before the tab
files (`LOGIC_AUDIT.md` Part 1 §4a; CLAUDE.md's list pair-swaps it with
`core-ui`).

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-020 | `applyFiltersAndRender()` `#L38` | reads `filterState`, `allParsedLeads` | rebuilds `leads` / `issueLeads`; calls `renderAll()` | shows/hides the loading overlay; nested `setTimeout(…,0)` so the overlay paints first | `_applyFiltersAndRenderImpl` (FN-021), `showLoadingOverlay` (`JS-010`), `renderAll` (`JS-012`) | `fetchAndRender` (`JS-003`), `#clearFiltersBtn`, every `buildMultiSelect` `onChange`, `core-auth.js` | reusable (the one filter path) |
| FN-021 | `_applyFiltersAndRenderImpl()` `#L54` | — | the real rebuild | mutates `leads` / `issueLeads` | `enrichLead` (`JS-006`), `effectiveRegion` (`JS-014`), `dedupeToFamilies` (`JS-002`) | FN-020 | specific |
| FN-022 | `buildMultiSelect(containerId, label, options, counts, selectedSet, onChange)` `#L300` | container id, option list, per-option counts, a `Set`, a callback | a live dropdown-checklist-with-search | mutates `selectedSet`, calls `onChange` | `renderOptions` / `refreshButtonLabel` (inner) | `buildFilterUI` (FN-024), `tab-audit.js` (`#msAuditPeriod`), other filter bars | reusable |
| FN-023 | `buildFilterUI()` `#L238` | — | builds all filter-bar multi-selects | DOM writes | `buildMultiSelect` (FN-022), `uniqueVals` / `countsFor` (inner) | `fetchAndRender` (`JS-003`) after a fetch | specific |
| FN-024 | `snapshotSlaHistory(asOf)` `#L161` | as-of date | upserts `SLA_History` rows | Sheets write (via `JS-018` helper) | `upsertSlaHistoryRows` (`JS-018`) | `MovementTracker`-equivalent client checkpoints, tracking admin | specific |
| FN-025 | `clearSlaHistory()` `#L206` | — | **deletes every `SLA_History` row** | its **own** raw `fetch(:batchUpdate)` — outside `sheetsApiValuesGet` / `JS-018` | `gateAccessToken` (`JS-001`, read by name `#L215`) | `#clearSlaHistoryBtn` (`BTN-020`, `TAB-008`) | specific — irreversible |

## Config constants — `CFG-XXX` sub-table

| ID | Constant | Value | Meaning | Changing it affects |
|---|---|---|---|---|
| CFG-002 | `_refreshMorningBriefOnNextRender` `#L20` | `true` initially | flag gating whether the next `renderAll()` also repaints Morning Brief | `TAB-001` refresh cadence |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-008 | `clearSlaHistory` batchUpdate not `resp.ok` | logs, status text shows failure `#L220` | "clear failed" — rows may be partially deleted |
| EXC-009 | re-entrant `applyFiltersAndRender` while one is running | `_isApplyingFilters` guard early-returns `#L39` | second rapid change is dropped (`LOGIC_AUDIT.md` Part 7 §18 LOW #3) |

## Data lineage

`allParsedLeads` (from `JS-003`) + `filterState` → per-filter predicate
pass + `enrichLead` (`JS-006`) → `leads` (customer-deduped) /
`issueLeads` (copy-expanded) → `renderAll()`. `SLA_History` admin path:
in-memory lead state → `upsertSlaHistoryRows` (`JS-018`) → `SHEET-005`.
`applyFiltersAndRender` flow Mermaid: `LOGIC_AUDIT.md` Part 2 §3.

## Data sources accessed

Reads `allParsedLeads` (state). `clearSlaHistory` reads `SLA_History`
(`SHEET-005`) to know what to delete.

## Data written / modified

`leads` / `issueLeads` (state, every filter pass). `SHEET-005`
(`SLA_History`): `snapshotSlaHistory` upserts; `clearSlaHistory` deletes
all rows via its own `batchUpdate`.

## Failure / error behaviour

Filter pass never throws to the user — a bad predicate just yields fewer
rows. `clearSlaHistory` surfaces a failure in status text and may leave
partial deletion.

## Cross-runtime duplication

None for filtering (the backend has no user filter bar). The
`SLA_History` write schema is shared with `MovementTracker.gs`'s
`SLA_History` write — the two writers agree exactly (`LOGIC_AUDIT.md`
Part 4 §4.7); the *shape* lives on `SHEET-005` / `JS-018`.

## UI relationships

`#msProject` / `#msRegion` / `#msTL` / `#msSource` / `#msBucket`
(filter bar, `DASH-001`), `#msAuditPeriod` (`TAB-006` `UI-010`),
`#clearFiltersBtn` (`DASH-001`), `#clearSlaHistoryBtn` (`BTN-020`,
`TAB-008`).

## Architecture relationship

`DASH-001`. Layer 9 (Filtering) in `LOGIC_AUDIT.md` Part 1 §1.

## Related documentation

`HANDOVER.md` §3 step 2; `LOGIC_AUDIT.md` Part 1 §1 layer 9, §4b, Part 2
§3, Part 5 §5.2 (filters/sort/pagination — 3 of 4 don't exist as the
generic template assumes), Part 7 §18 LOW #3.

## Relationships

- **Depends On:** `JS-001` (`gateAccessToken` for `clearSlaHistory`),
  `JS-002` (`dedupeToFamilies`), `JS-005`, `JS-006` (`enrichLead`),
  `JS-009` (`allParsedLeads` / `filterState`), `JS-010`
  (`showLoadingOverlay`), `JS-012` (`renderAll`), `JS-014`
  (`effectiveRegion`), `JS-018` (`upsertSlaHistoryRows`), `SHEET-005`,
  `EXT-001`, `EXT-003`
- **Used By:** `DASH-001`, `TAB-002`, `TAB-006`, `TAB-008` (every render
  goes through `applyFiltersAndRender` → `renderAll`), `JS-001`,
  `JS-003`, `JS-012`, `JS-014`, `JS-019` (`buildMultiSelect`), `JS-020`,
  `JS-024`, `DATA-001`
- **Related:** `JS-021` (Movement filter uses a different predicate,
  `passesMovementFilters`), `JS-022` (Repeat Offenders' own filter set)

## Source of truth

`js/core-filters.js` at `HEAD`.

## Validation

- **Method:** full read at `c82ec67`; function list verified by grep;
  cross-check `LOGIC_AUDIT.md` Part 1 §4b + Part 5 §5.2.
  `tests/frontend-harness.html` runs `applyFiltersAndRender` with
  synthetic `filterState` and confirms `leads` / `issueLeads` rebuild.
- **Evidence:** `LOGIC_AUDIT.md` Part 5 §5.2; `tests/frontend-harness.html`.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-027.

## Revalidation trigger

Any commit touching `js/core-filters.js`; a filter dimension is
added/removed; `buildMultiSelect`'s signature changes (used by
`tab-audit.js`); the `SLA_History` write/delete schema changes;
`enrichLead` output shape changes.

## Handover relationship

`HANDOVER.md` §3 step 2 covers filtering at the pipeline level; current
as of 2026-09-09. Adding a filter dimension or changing the widget
contract should update `HANDOVER.md` §3.

## Lifecycle / retention

N/A — code. `SLA_History` retention: `SHEET-005` (`TBD`, DOC-036).

## Next action

none — Closed + Monitored.

## Closure evidence

Record committed for DOC-027; `docs/INDEX.md` `JS-004` → `Closed +
Monitored`, `Last Verified` 2026-09-10, links filled; `CFG-002`,
`EXC-008`/`009` recorded. No `docs/changes/` record (DOC-027).
