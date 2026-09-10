# JS-013 — repeat-offenders-pdf.js

| | |
|---|---|
| **Type** | `JS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `js/repeat-offenders-pdf.js` (492 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

The "Download PDF" export for Repeat Offenders — real vector tables via
jsPDF / jspdf-autotable, mirroring the on-screen filter, broken out per
date. It exists so a manager can hand a leadership review a fixed
document that matches exactly what the tab shows. It deliberately reuses
`JS-022`'s `rmHierarchyByNameLower` / `primaryManagerForRm` /
`_repeatOffendersRegionKey` and `JS-008`'s `computeRmPerformance`
directly "so the two surfaces can never independently invent different
data" (`LOGIC_AUDIT.md` Part 1 §4c).

## Responsibilities

- `downloadRepeatOffendersPdf()` — build and download the PDF against
  the current filter + Time range.
- Room-estimation / page-break logic (`_repeatOffendersPdfEnsureRoom`,
  `_repeatOffendersPdfEstimateTableHeight`) — fixed a real bug where a
  table title alone was room-checked while its body overflowed.
- Refuse the export if `RM_Hierarchy` is still loading (added
  `ddc0097`).

## Load order / position

Loads after `tab-repeat-offenders.js` and `core-rm-performance.js`
(interleaved tab group).

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-088 | `downloadRepeatOffendersPdf()` `#L401` | current Repeat Offenders filter + Time range; `rmHierarchyFetchState` | a downloaded PDF | triggers a browser download; **early-returns with a status message if `rmHierarchyFetchState` is `loading`/`idle`** | `computeRmPerformance` (`JS-008`), `_repeatOffendersPdf*` helpers, jsPDF (`EXT-004`) | `#repeatOffendersDownloadPdfBtn` (`BTN-011`) | specific |
| FN-089 | `_repeatOffendersPdfSectionTables(dateKeys)` / `_repeatOffendersPdfTableRows(list, map)` `#L126/#L205` | date keys / a result list | per-section autotable specs / row arrays | none | `computeRmPerformance` (`JS-008`), `filterRmPerformanceWorst` (`JS-008`), `repeatOffendersRegionKey` (`JS-008`) | FN-088 | specific |
| FN-090 | `_repeatOffendersPdfRenderPages(specs, filterInfo)` `#L262` | page specs | writes tables into the jsPDF doc | mutates the doc | `_repeatOffendersPdfEnsureRoom` (FN-091), jspdf-autotable (`EXT-004`) | FN-088 | specific |
| FN-091 | `_repeatOffendersPdfEnsureRoom(doc, y, minSpace)` / `_repeatOffendersPdfEstimateTableHeight(rowCount, compact)` `#L224/#L241` | doc, cursor, needed space | a safe y / an estimated height | may add a page | — | FN-090 | specific — the room-estimation fix |
| FN-092 | `_repeatOffendersPdfHasAnyRowsForRange(dateKeys)` `#L107` | date keys | bool | none | `computeRmPerformance` (`JS-008`) | FN-088 | specific — a period with nothing flagged prints no always-populated 11-row table |
| FN-093 | `_repeatOffendersPdfDateLine` / `_repeatOffendersPdfCurrentFilterInfo` / `_repeatOffendersPdfFilterSummaryLine` `#L66/#L82/#L182` | current filter state | header text lines | none | `_repeatOffendersRegionKey` etc. (`JS-022`) | FN-088 | specific |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-022 | `RM_Hierarchy` fetch still in flight (`rmHierarchyFetchState` `loading`/`idle`) at PDF-gen time | FN-088 early-returns after setting a status message — **does not export** | "Still loading RM_Hierarchy — try again in a moment (this keeps managers/leadership correctly out of the export)." (added `ddc0097` to fix the RH/CH-in-PDF bug) |
| EXC-023 | no rows for the selected Time range | `_repeatOffendersPdfHasAnyRowsForRange` false → that section is skipped | PDF prints only populated sections |
| EXC-024 | sandboxed viewer blocks the download | jsPDF `save()` is inert | nothing downloads; no error |

## Data lineage

`movementSnapshots` (`JS-021`, from `SHEET-002`) + `rmHierarchyByNameLower`
(`JS-022`, from `SHEET-006`) → `computeRmPerformance` (`JS-008`) →
`filterRmPerformanceWorst` → per-date autotable specs → jsPDF doc
(`EXT-004`) → a downloaded file. Nothing persists.

## Data sources accessed

Reads `movementSnapshots` and the RM-hierarchy map (both in-memory).
Integration: `EXT-004` (jsPDF + jspdf-autotable).

## Data written / modified

None — a local file download only.

## Failure / error behaviour

Refuses rather than exports on the `RM_Hierarchy` race (EXC-022). A
sandboxed-viewer download failure is silent (EXC-024). No throw paths.

## Cross-runtime duplication

None — PDF export is browser-only. It **intentionally diverges** from the
live tab: the PDF's By-Region table shows Below-Expectations-only in all
4 tables, while the live tab's By-Region table shows every region —
documented as intentional (a period with nothing flagged shouldn't print
an always-populated 11-row table), not a drift bug (`LOGIC_AUDIT.md`
Part 1 §4c).

## UI relationships

`#repeatOffendersDownloadPdfBtn` (`BTN-011` on `TAB-004`).

## Architecture relationship

`DASH-001`. Layer 16 (Export) in `LOGIC_AUDIT.md` Part 1 §1. Belongs to
`TAB-004`.

## Related documentation

`HANDOVER.md` §9; `LOGIC_AUDIT.md` Part 1 §4c; this session's fix
`ddc0097` (the RM_Hierarchy PDF race).

## Relationships

- **Depends On:** `JS-008` (`computeRmPerformance`,
  `filterRmPerformanceWorst`, `repeatOffendersRegionKey`,
  `rmPerfIsLeadershipExcluded`), `JS-022` (`rmHierarchyByNameLower`,
  `primaryManagerForRm`, `_repeatOffendersRegionKey`,
  `rmHierarchyFetchState`), `JS-021` (`movementSnapshots`), `EXT-004`
- **Used By:** `TAB-004`
- **Related:** `JS-017` (worker — the live tab's compute path; the PDF
  computes synchronously)

## Source of truth

`js/repeat-offenders-pdf.js` at `HEAD`.

## Validation

- **Method:** full read at `c82ec67`; function list verified by grep;
  cross-check `LOGIC_AUDIT.md` Part 1 §4c. The `rmHierarchyFetchState`
  gate (EXC-022) was **added and verified this session** (`ddc0097`)
  against the live RH/CH-in-PDF bug the user reported.
  `tests/frontend-harness.html` exercises `computeRmPerformance`; the
  PDF assembly is verified by manual download.
- **Evidence:** commit `ddc0097`; `LOGIC_AUDIT.md` Part 1 §4c.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-028. File grew 432L →
492L this session (the `rmHierarchyFetchState` gate + per-region worst-5
table support).

## Revalidation trigger

Any commit touching `js/repeat-offenders-pdf.js`; `computeRmPerformance`
(`JS-008`) output shape changes; the `rmHierarchyFetchState` states
change; the intentional live-tab-vs-PDF By-Region divergence changes;
jsPDF / jspdf-autotable CDN version changes (`EXT-004`).

## Handover relationship

`HANDOVER.md` §9 covers Repeat Offenders including the export. Current as
of 2026-09-09 but predates the `ddc0097` gate by a day — a §9 refresh
should mention the RM_Hierarchy load gate on the PDF path.

## Lifecycle / retention

N/A — code.

## Next action

none — Closed + Monitored.

## Closure evidence

Record committed for DOC-028; `docs/INDEX.md` `JS-013` → `Closed +
Monitored`, `Last Verified` 2026-09-10, links filled; `EXC-022`..`024`
recorded. No `docs/changes/` record (DOC-028).
