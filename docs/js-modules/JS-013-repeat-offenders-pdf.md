# JS-013 — repeat-offenders-pdf.js

| | |
|---|---|
| **Type** | `JS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `js/repeat-offenders-pdf.js` (545 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-15 against commit `9e55e36` |

## Purpose / reason to exist

The "Download PDF" export for Repeat Offenders — real vector tables via
jsPDF / jspdf-autotable, mirroring the on-screen filter, broken out per
date. It exists so a manager can hand a leadership review a fixed
document that matches exactly what the tab shows. **As of the 2026-09-12
"PDF reads the cache, never recomputes" redesign (`9dea24a`, Repeat
Offenders Architecture Redesign Part 5), it no longer calls `JS-008`'s
`computeRmPerformance`/`computeRmPerformanceByRegion` itself** — every
table and every piece of header text is built from
`_repeatOffendersLastResult`, `JS-022`'s canonical result cache
(populated once per completed calculation), never from a live
recomputation at export time. This closes a real race: the live tab's
own calculation runs asynchronously via a Worker (`JS-017`, up to
~12-15s at real data volume), and exporting mid-recalculation used to
silently compute against newer inputs than what was still on screen.
Display-ordering (`filterRmPerformanceRankable` / `sortRmPerformanceByScore`,
both `JS-008`) and hierarchy-cell rendering (`rmPerformanceHierarchyCells`,
`JS-008`) still run here — pure, stateless functions of the already-cached
rows, safe to run twice on identical input, "so the two surfaces can
never independently invent different data" (`LOGIC_AUDIT.md` Part 1
§4c, written before this redesign but still the guiding principle).

## Responsibilities

- `downloadRepeatOffendersPdf()` — build and download the PDF against
  the current filter + Time range, reading `JS-022`'s
  `_repeatOffendersLastResult` cache rather than recomputing.
- Room-estimation / page-break logic (`_repeatOffendersPdfEnsureRoom`,
  `_repeatOffendersPdfEstimateTableHeight`) — fixed a real bug where a
  table title alone was room-checked while its body overflowed.
- Refuse the export if `RM_Hierarchy` is still loading (added
  `ddc0097`), if no cached result exists yet, or if the cache is behind
  the live recalculation run counter (both added `9dea24a`).

## Load order / position

Loads after `tab-repeat-offenders.js` and `core-rm-performance.js`
(interleaved tab group).

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-088 | `downloadRepeatOffendersPdf()` `#L427` | `JS-022`'s `_repeatOffendersLastResult` cache + `_repeatOffendersRunId`; `rmHierarchyFetchState` | a downloaded PDF | triggers a browser download; **early-returns with a status message if `movementFetchState`/`rmHierarchyFetchState` isn't settled, if no cache exists yet ("Nothing calculated yet"), or if the cache is behind the live run counter ("Still recalculating")** | `_repeatOffendersPdfCurrentFilterInfo` (FN-093), `_repeatOffendersPdfBuildPageSpecs` (FN-089), `_repeatOffendersPdf*` helpers, jsPDF (`EXT-004`) — **no longer `computeRmPerformance`/`computeRmPerformanceByRegion`** (`JS-008`) as of `9dea24a` | `#repeatOffendersDownloadPdfBtn` (`BTN-011`) | specific |
| FN-089 | `_repeatOffendersPdfSectionTables(cached)` `#L156` / `_repeatOffendersPdfBuildPageSpecs(cached)` `#L197` / `_repeatOffendersPdfTableRows(list, rmHierarchyByNameLower)` `#L231` | the cached result object / a result list | per-section autotable specs / row arrays | none | `filterRmPerformanceRankable`, `sortRmPerformanceByScore`, `rmPerformanceHierarchyCells` (`JS-008`) — **takes `cached` directly since `9dea24a`; no longer calls `computeRmPerformance`/`computeRmPerformanceByRegion`/`filterRmPerformanceWorst`/`repeatOffendersRegionKey`** | FN-088 | specific |
| FN-090 | `_repeatOffendersPdfRenderPages(specs, filterInfo)` `#L288` | page specs | writes tables into the jsPDF doc | mutates the doc | `_repeatOffendersPdfEnsureRoom` (FN-091), jspdf-autotable (`EXT-004`) | FN-088 | specific |
| FN-091 | `_repeatOffendersPdfEnsureRoom(doc, y, minSpace)` / `_repeatOffendersPdfEstimateTableHeight(rowCount, compact)` `#L250/#L267` | doc, cursor, needed space | a safe y / an estimated height | may add a page | — | FN-090 | specific — the room-estimation fix |
| FN-092 | `_repeatOffendersPdfHasAnyRowsForRange(dateKeys)` `#L128` | date keys | bool | none | `movementSnapshots` (`JS-021`) | FN-088 | specific — a period with nothing flagged prints no always-populated 11-row table |
| FN-093 | `_repeatOffendersPdfDateLine(dateKeys)` `#L85` / `_repeatOffendersPdfCurrentFilterInfo(cached)` `#L103` / `_repeatOffendersPdfFilterSummaryLine(filters)` `#L208` | the cached result object (for `_repeatOffendersPdfCurrentFilterInfo`) / current filter state | header text lines | none | reads `cached.computedFrom` (range/now/dateKeys/filters) — **no longer live `filterState`/`_renderNow`/the range-select's DOM value** as of `9dea24a` (closes the same race in the PDF's own header text) | FN-088 | specific |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-022 | `RM_Hierarchy` fetch still in flight (`rmHierarchyFetchState` `loading`/`idle`) at PDF-gen time | FN-088 early-returns after setting a status message — **does not export** | "Still loading RM_Hierarchy — try again in a moment (this keeps managers/leadership correctly out of the export)." (added `ddc0097` to fix the RH/CH-in-PDF bug) |
| EXC-023 | no rows for the selected Time range | `_repeatOffendersPdfHasAnyRowsForRange` false → that section is skipped | PDF prints only populated sections |
| EXC-024 | sandboxed viewer blocks the download | jsPDF `save()` is inert | nothing downloads; no error |
| EXC-092 | no completed calculation exists yet (`_repeatOffendersLastResult` is unset — e.g. a fresh page load before the first render finishes) | FN-088 early-returns after setting a status message — **does not export** (added `9dea24a`, Repeat Offenders Architecture Redesign) | "Nothing calculated yet — wait for the Repeat Offenders table to finish loading, then try again." |
| EXC-093 | the cache is stale (`cached.runId !== _repeatOffendersRunId` — a newer recalculation is in flight because a filter/range change bumped the run counter synchronously while the `JS-017` worker is still computing) | FN-088 early-returns after setting a status message — **does not export** (added `9dea24a` — the actual fix for the race `LOGIC_AUDIT.md` Part 1 §4c's "can never independently invent different data" promise didn't fully cover: the old code still recomputed synchronously at click time against whatever live inputs were current, which could differ from the async Worker calculation the screen was about to show) | "Still recalculating for the current filters — wait for the table to finish updating, then try again." |

## Data lineage

`JS-022`'s own compute path (`movementSnapshots` (`JS-021`, from
`SHEET-002`) + `rmHierarchyByNameLower` (`JS-022`, from `SHEET-006`) →
`computeRmPerformance`/`computeRmPerformanceByRegion`, `JS-008`, via the
`JS-017` worker) populates `_repeatOffendersLastResult` once per
completed run → **this file reads that cache directly** (no independent
recomputation since `9dea24a`) → `filterRmPerformanceRankable` /
`sortRmPerformanceByScore` (`JS-008`, re-ranks the already-computed rows)
→ per-section autotable specs → jsPDF doc (`EXT-004`) → a downloaded
file. Nothing persists.

## Data sources accessed

Reads `_repeatOffendersLastResult` (`JS-022`'s cache) and
`rmHierarchyByNameLower` (both in-memory). Integration: `EXT-004` (jsPDF
+ jspdf-autotable).

## Data written / modified

None — a local file download only.

## Failure / error behaviour

Refuses rather than exports on the `RM_Hierarchy` race (EXC-022), no
cache yet (EXC-092), or a stale cache (EXC-093). A sandboxed-viewer
download failure is silent (EXC-024). No throw paths.

## Cross-runtime duplication

None — PDF export is browser-only. It **intentionally diverges** from the
live tab: the PDF's By-Region table shows Below-Expectations-only in all
4 tables, while the live tab's By-Region table shows every region —
documented as intentional (a period with nothing flagged shouldn't print
an always-populated 11-row table), not a drift bug (`LOGIC_AUDIT.md`
Part 1 §4c). Since `9dea24a` the two surfaces also share the exact SAME
computed rows (both read `_repeatOffendersLastResult`), not merely
"agreeing math" from two independent calculations — verified byte-for-byte
identical for a synthetic fixture in that commit's own testing.

## UI relationships

`#repeatOffendersDownloadPdfBtn` (`BTN-011` on `TAB-004`).

## Architecture relationship

`DASH-001`. Layer 16 (Export) in `LOGIC_AUDIT.md` Part 1 §1. Belongs to
`TAB-004`.

## Related documentation

`HANDOVER.md` §9; `LOGIC_AUDIT.md` Part 1 §4c; this session's fix
`ddc0097` (the RM_Hierarchy PDF race).

## Relationships

- **Depends On:** `JS-008` (`filterRmPerformanceRankable`,
  `sortRmPerformanceByScore`, `rmPerformanceHierarchyCells` — **not**
  `computeRmPerformance`/`computeRmPerformanceByRegion`/
  `filterRmPerformanceWorst`/`repeatOffendersRegionKey`/
  `rmPerfIsLeadershipExcluded` since `9dea24a`), `JS-021`
  (`movementSnapshots`, `movementFetchState`), `JS-022`
  (`_repeatOffendersLastResult`, `_repeatOffendersRunId`,
  `rmHierarchyByNameLower`, `rmHierarchyFetchState` — **not**
  `primaryManagerForRm`/`_repeatOffendersRegionKey` since `9dea24a`),
  `SHEET-002`, `SHEET-006`, `EXT-004`
- **Used By:** `TAB-004`
- **Related:** `JS-017` (worker — populates `JS-022`'s
  `_repeatOffendersLastResult` cache the PDF now reads; the PDF itself no
  longer computes, synchronously or otherwise, since `9dea24a`)

## Source of truth

`js/repeat-offenders-pdf.js` at `HEAD`.

## Validation

- **Method:** full read at `9e55e36` (weekly doc spot-check, cycle 2);
  function list + line anchors re-verified by grep against real current
  source — every `FN-XXX` anchor and several function signatures had
  drifted since the `c82ec67` verification, and the record's central
  claim (that this file calls `computeRmPerformance` directly) had gone
  **false** since the 2026-09-12 "PDF reads the cache, never recomputes"
  redesign (`9dea24a`, Repeat Offenders Architecture Redesign Part 5 of
  5) — corrected throughout (Purpose, Responsibilities, `FN-088`/`089`/`093`,
  two new `EXC-092`/`093`, Data lineage, Depends On). The reciprocal
  `Called by` cells on `JS-008`'s `FN-052`/`FN-060`/`FN-062` were also
  stale (still listing `JS-013`) and corrected in the same pass. The
  `rmHierarchyFetchState` gate (EXC-022) remains unchanged, originally
  added/verified `ddc0097`. `tests/frontend-harness.html` exercises the
  underlying `JS-008` functions; the PDF assembly itself is verified by
  manual download (per the redesign commit's own byte-for-byte fixture
  check).
- **Evidence:** commits `ddc0097`, `9dea24a`; `LOGIC_AUDIT.md` Part 1
  §4c; `docs/_planning/REPEAT_OFFENDERS_ARCHITECTURE_REVIEW.md`.
- **Status:** Validated 2026-09-15.

## Version / change reference

Verified at `9e55e36`; record created by DOC-028, corrected 2026-09-15
(weekly doc spot-check, cycle 2 — no code changed) for the `9dea24a`
cache-read redesign. File grew 432L → 492L in the `ddc0097` session
(the `rmHierarchyFetchState` gate + per-region worst-5 table support),
then 492L → 545L for the Repeat Offenders Architecture Redesign
(`9dea24a`, 2026-09-12): reads `JS-022`'s `_repeatOffendersLastResult`
cache instead of recomputing, gains the two new cache-freshness guards
(`EXC-092`/`093`).

## Revalidation trigger

Any commit touching `js/repeat-offenders-pdf.js`; `_repeatOffendersLastResult`'s
shape (`JS-022`) or the worker's (`JS-017`) output shape changes; the
`rmHierarchyFetchState`/`movementFetchState` states change; the
intentional live-tab-vs-PDF By-Region divergence changes; jsPDF /
jspdf-autotable CDN version changes (`EXT-004`).

## Handover relationship

`HANDOVER.md` §9 covers Repeat Offenders including the export. Current as
of 2026-09-09 — predates both the `ddc0097` gate and, more significantly,
the entire `9dea24a` cache-read redesign (2026-09-12). Per `CLAUDE.md`'s
own rule ("a real architectural change updates `HANDOVER.md` … in the
SAME commit"), §9 should have been refreshed when `9dea24a` landed and
was not — flagged here 2026-09-15 (weekly doc spot-check) for a human to
action; not edited in this pass, since `HANDOVER.md` is outside this
spot-check's scoped `docs/` catalog correction.

## Lifecycle / retention

N/A — code.

## Next action

`HANDOVER.md` §9 needs a refresh for the `9dea24a` cache-read redesign
(see Handover relationship above) — flagged 2026-09-15, not fixed in
this pass. Otherwise none — Closed + Monitored.

## Closure evidence

Record committed for DOC-028; `docs/INDEX.md` `JS-013` → `Closed +
Monitored`, `Last Verified` 2026-09-10, links filled; `EXC-022`..`024`
recorded. No `docs/changes/` record (DOC-028).
