# JS-022 — tab-repeat-offenders.js

| | |
|---|---|
| **Type** | `JS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `js/tab-repeat-offenders.js` (717 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

Implements the Repeat Offenders tab (`TAB-004`): it dispatches the
RM-performance computation (to the Web Worker `JS-017`, with a
synchronous main-thread fallback), renders the RM / Region / A1-TM / RH
leaderboards plus the "Worst 5 RMs by Region" breakdown, owns this
report's **own** filter set (separate from the shared filter bar since
2026-09-07), and independently fetches `RM_Hierarchy` for the display
rollup (`rmHierarchyByNameLower` / `rmHierarchyFetchState`). It exists so
"repeat offender" ranking has a dedicated surface with its own filters
and a browser-side hierarchy read that is separate from the Apps Script
routing read.

## Responsibilities

- `fetchRmHierarchyForRollup` — the read-only browser `RM_Hierarchy`
  fetch; owns `rmHierarchyByNameLower` + `rmHierarchyFetchState`.
- This report's private filter set + Time range
  (`captureRepeatOffendersFilterSnapshot`,
  `repeatOffendersDateKeysForRange`, `repeatOffendersResolvedDateRange`).
- `renderRepeatOffenders` — dispatch compute (worker or sync) + render.
- `runRepeatOffendersRecalculation` / `_runRepeatOffendersSynchronously`
  / `_renderRepeatOffendersResult` — the recalc lifecycle incl. the
  `byRegion` section.
- `rmPerformanceTableHtml` — the leaderboard table markup.

## Load order / position

In the tab group, before `core-rm-performance.js` in the real order (the
compute file loads late). `LOGIC_AUDIT.md` Part 1 §4c.

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-150 | `fetchRmHierarchyForRollup(sheetId)` `#L61` | sheet id | populates `rmHierarchyByNameLower`; sets `rmHierarchyFetchState` (`idle`→`loading`→`ready`/`error`) | one Sheets read; state write | `sheetsApiValuesGet` / `valuesToGvizShape` (`JS-009`) | `fetchAndRender` (`JS-003`, in the `Promise.all` gate ~`#L624`) | specific — the browser-side hierarchy read |
| FN-151 | `renderRepeatOffenders()` `#L250` | this report's filters + Time range, `movementSnapshots` | dispatches compute + renders the tab | constructs the `Worker` (`JS-017`) or falls back to FN-153; DOM writes | `captureRepeatOffendersFilterSnapshot` (FN-152), `runRepeatOffendersRecalculation` (FN-153) | `renderAll` (`JS-012`), `#repeatOffendersRecalculateBtn` (`BTN-010`) | specific |
| FN-152 | `captureRepeatOffendersFilterSnapshot()` / `_repeatOffendersFilterSummaryText(filters)` / `repeatOffendersDateKeysForRange(range, now)` / `repeatOffendersResolvedDateRange(dateKeys)` / `_repeatOffendersUpdateRangeDisplay` `#L124`–`#L250` | the tab's filter inputs, a range, `now` | a frozen filter snapshot / a summary string / the resolved date keys | DOM range display | `repeatOffendersFormatDate` | FN-151, FN-153 | specific — this report's private filter model |
| FN-153 | `runRepeatOffendersRecalculation(ctx)` / `_runRepeatOffendersSynchronously(ctx, onDone)` / `_renderRepeatOffendersResult(ctx, msg, elapsedMs, startedAtWall)` `#L337/#L398/#L440` | a recalc context; a worker `done` message | drives the recalc; renders RM / Region / A1-TM / RH tables + the **`byRegion`** "Worst 5 RMs by Region" section | posts to / receives from the Worker; DOM writes; progress label | `computeRmPerformance` / `computeRmPerformanceByRegion` (`JS-008`, sync path), `rmPerformanceTableHtml` (FN-155) | FN-151 | specific — handles both worker and sync results |
| FN-154 | `_repeatOffendersStatusHtml(opts)` / `_repeatOffendersDebugPanelHtml(sc, hierarchyMissing)` / `_repeatOffendersSyncCustomRangeVisibility()` `#L516/#L536/#L670` | worker `stageCounts`, hierarchy-missing flag | the status line / debug panel / custom-range visibility | DOM | — | FN-153 | specific |
| FN-155 | `rmPerformanceTableHtml(title, list, hierarchyMissing, emptyMessage, rmHierarchyByNameLower)` `#L621` | a result list + a hierarchy map | one leaderboard table's HTML | none | `rmPerformanceDrivenBy` / `rmPerformanceHierarchyCells` (`JS-008`), `esc` (`JS-010`) | FN-153, `JS-013` reuses the shared helpers | reusable |

## State owned here

| Symbol | Type | Notes |
|---|---|---|
| `rmHierarchyByNameLower` | `Map` (name-lowercased → hierarchy row) | shared **by reference** with `JS-013` so the tab and the PDF can't diverge |
| `rmHierarchyFetchState` | `'idle'` \| `'loading'` \| `'ready'` \| `'error'` | gates the PDF export (`JS-013` EXC-022, added `ddc0097`); part of the `JS-003` render `Promise.all` |
| `_repeatOffendersRegionKey` | fn ref (re-exported from `JS-008` `repeatOffendersRegionKey`) | reused directly by `JS-013` |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-046 | `Worker` construction fails (e.g. `importScripts` blocked) | `renderRepeatOffenders` falls back to `_runRepeatOffendersSynchronously` (main-thread) | tab still computes, main thread briefly blocks |
| EXC-047 | worker posts `{type:'error'}` | logged; the previous good table stays on screen | no blank table; a debug panel shows the error |
| EXC-048 | `RM_Hierarchy` fetch still `loading` when the tab renders | the `JS-003` `Promise.all` gate defers the render | loading state, not partial rows |

## Data lineage

`RM_Hierarchy` (`SHEET-006`) → `fetchRmHierarchyForRollup` (FN-150) →
`rmHierarchyByNameLower` (state). `Movement_Log` (`SHEET-002`) →
`movementSnapshots` (`JS-021`) + this report's filter snapshot →
Worker (`JS-017`) or sync `computeRmPerformance` (`JS-008`) →
`{rm, region, a1tm, rh, byRegion}` → `rmPerformanceTableHtml` (FN-155) →
`#tab-repeatoffenders`. PDF path shares the same inputs (`JS-013`). Full
flow: `DATA-002` + `DATA-004`.

## Data sources accessed

`SHEET-006` (`RM_Hierarchy`, its own read), `movementSnapshots` (from
`SHEET-002`). Auth: `gateAccessToken` (`JS-001`). Integration: `EXT-001`.

## Data written / modified

None to a Sheet — read-only tab. Writes `rmHierarchyByNameLower` /
`rmHierarchyFetchState` state.

## Failure / error behaviour

Worker failures degrade to the sync path (EXC-046) or leave the last
good table with a debug panel (EXC-047). The `RM_Hierarchy` load is
gated so the tab never renders leadership rows from a half-loaded map
(EXC-048), and the PDF refuses outright (`JS-013` EXC-022).

## Cross-runtime duplication

The browser `RM_Hierarchy` read here is **separate from** the Apps
Script routing read (`RmHierarchy.gs` `resolveRmHierarchy_`, `GS-011`) —
same source tab, different consumers, no shared code
(`LOGIC_AUDIT.md` Part 1 §4c). The scoring itself is `JS-008` ↔ `GS-003`.

## UI relationships

`#tab-repeatoffenders` panel; `#repeatOffendersRecalculateBtn`
(`BTN-010`), `#repeatOffendersDownloadPdfBtn` (`BTN-011`, handled in
`JS-013`), this report's filter multi-selects + Time range (`UI-005`),
the progress label (`UI-006`) — all on `TAB-004`.

## Architecture relationship

`DASH-001`. Layer 10 (render) + its own layer-3 `RM_Hierarchy` read.
Belongs to `TAB-004`.

## Related documentation

`HANDOVER.md` §9 (the whole subsystem + the Time-range gotcha);
`OPS_CHECKLIST.md`; `LOGIC_AUDIT.md` Part 1 §4c, Part 3 §3.6.

## Relationships

- **Depends On:** `JS-009` (`sheetsApiValuesGet`), `JS-017` (the
  Worker), `JS-008` (`computeRmPerformance*`, the shared region-key /
  hierarchy helpers), `JS-021` (`movementSnapshots`), `JS-014`
  (`mainRegionFor`), `JS-010` (`esc`), `JS-003` (render gate),
  `SHEET-006`, `SHEET-002`, `EXT-001`
- **Used By:** `TAB-004`; `JS-013` (reuses `rmHierarchyByNameLower`,
  `primaryManagerForRm`, `_repeatOffendersRegionKey` by reference);
  `JS-003` (`fetchRmHierarchyForRollup` in the `Promise.all` gate);
  `JS-012` (`renderAll` calls `renderRepeatOffenders`)
- **Related:** `GS-011` (`RmHierarchy.gs` — the separate Apps Script
  hierarchy read), `GS-003` (the `.gs` scoring mirror)

## Source of truth

`js/tab-repeat-offenders.js` at `HEAD`.

## Validation

- **Method:** full read at `c82ec67`; function + state list verified by
  grep; cross-check `LOGIC_AUDIT.md` Part 1 §4c + Part 3 §3.6. The
  `rmHierarchyFetchState` gate and the `byRegion` section were **added
  and verified this session** (`812a3cb`, `ddc0097`).
  `tests/frontend-harness.html` exercises the sync compute path;
  worker + hierarchy fetch verified by manual run.
- **Evidence:** commits `812a3cb` / `ddc0097`; `LOGIC_AUDIT.md` Part 3
  §3.6; `tests/frontend-harness.html`.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-028. File grew 383L →
717L this session (the region worst-5 breakdown + the
`rmHierarchyFetchState` gate).

## Revalidation trigger

Any commit touching `js/tab-repeat-offenders.js`; the worker message
contract (`JS-017`) changes; `computeRmPerformance*` (`JS-008`)
signatures change; `rmHierarchyFetchState` states change; this report's
filter model changes; `RM_Hierarchy` (`SHEET-006`) columns change.

## Handover relationship

`HANDOVER.md` §9 covers this in depth. Current as of 2026-09-09 but
predates this session's region-worst-5 + PDF-gate work by a day — a §9
refresh should mention both. A methodology change here must update §9
and run `OPS_CHECKLIST.md`'s worst-performer items.

## Lifecycle / retention

N/A — code. Its history source `SHEET-003` retains 7 days;
`Movement_Log` (`SHEET-002`) 7 days.

## Next action

none — Closed + Monitored.

## Closure evidence

Record committed for DOC-028; `docs/INDEX.md` `JS-022` → `Closed +
Monitored`, `Last Verified` 2026-09-10, reciprocal links to `TAB-004`,
`JS-013`, `JS-017` confirmed; state table + `EXC-046`..`048` recorded.
No `docs/changes/` record (DOC-028).
