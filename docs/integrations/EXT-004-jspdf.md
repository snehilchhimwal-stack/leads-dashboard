# EXT-004 — jsPDF + jspdf-autotable (PDF export)

| | |
|---|---|
| **Type** | `EXT-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `js/repeat-offenders-pdf.js`; the two CDN `<script>` tags in `dashboard.html` `#L22`–`#L23`. |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Component / Record** | Active / Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

The Repeat Offenders tab's "Download PDF" produces a **real vector PDF**
with proper tables — not a screenshot. jsPDF builds the document;
jspdf-autotable lays out the leaderboard tables with pagination. It
exists so a manager can hand a leadership review a fixed document that
matches the on-screen filter exactly, broken out per date.

## What it's used for

The single PDF export in the app: `downloadRepeatOffendersPdf` (`JS-013`)
renders the RM / Region / A1-TM / RH leaderboards + the per-region
worst-5 breakdown for the current Time range.

## Called from — `JS-XXX` / `GS-XXX` list

| ID | Which `FN-XXX` | Operation |
|---|---|---|
| `JS-013` | `downloadRepeatOffendersPdf` (FN-088) | create the doc, `doc.save()` |
| `JS-013` | `_repeatOffendersPdfRenderPages` (FN-090) | `doc.autoTable(...)` per section |
| `JS-013` | `_repeatOffendersPdfEnsureRoom` / `…EstimateTableHeight` (FN-091) | page-break math |

## API surfaces — `API-XXX` sub-table

| ID | Call pattern | Quota / rate limit | Retry behaviour |
|---|---|---|---|
| API-009 | `new window.jspdf.jsPDF(...)`, `doc.autoTable({ head, body, … })`, `doc.addPage()`, `doc.save('<name>.pdf')` | none — fully client-side, no network | N/A |

## Auth mechanism

None — a pure client-side library. No token, no scope, no server.

## Known failure modes

| Condition | Result |
|---|---|
| the CDN scripts fail to load | `window.jspdf` undefined → `downloadRepeatOffendersPdf` throws when it tries to construct the doc; the tab's tables still render (they don't need jsPDF) |
| **sandboxed viewer blocks the download** | `doc.save()` is inert — nothing downloads, no error (`JS-013` EXC-024) — a general artifact/preview constraint, not a library bug |
| a table body overflows a page while only its title was room-checked | **fixed** — `_repeatOffendersPdfEnsureRoom` / `_repeatOffendersPdfEstimateTableHeight` estimate the full body height (`JS-013` FN-091, a real past bug) |
| `RM_Hierarchy` still loading at export time | `downloadRepeatOffendersPdf` **refuses** with a status message rather than exporting leadership rows (`JS-013` EXC-022, added `ddc0097`) — not a library issue, a data-readiness guard |

## Rate-limit / retry behaviour

N/A — no network. Generation is synchronous.

## Permissions / security-sensitive notes

The PDF contains RM names + performance scores. It is generated and
downloaded entirely locally — nothing is uploaded. The
`rmHierarchyFetchState` guard (`JS-013` EXC-022) exists specifically so
managers / leadership don't leak into an exported artifact that outlives
the session.

## Load order / CSP

Both scripts load from `cdnjs.cloudflare.com` **synchronously** (no
`async`/`defer`) so `window.jspdf.jsPDF` and `.autoTable()` are ready
before any JS uses them; **jspdf-autotable's tag must come after jsPDF's**
because it extends jsPDF's prototype (`dashboard.html` `#L20`–`#L23`
comment). Pinned versions: **jsPDF 2.5.1**, **jspdf-autotable 3.8.2**.

## Data lineage

`computeRmPerformance` result rows (`JS-008`, from `movementSnapshots` /
`RM_Hierarchy`) → `_repeatOffendersPdfTableRows` (`JS-013` FN-089) →
`doc.autoTable(...)` → a downloaded `.pdf`. Nothing persists. Full flow:
`DATA-002` (its output side).

## Exceptions & error handling

See "Known failure modes." The `RM_Hierarchy` guard refuses rather than
exports; a sandboxed-viewer download failure is silent; a missing CDN
throws only on the export path.

## Architecture relationship

Layer 16 (Export) in `LOGIC_AUDIT.md` Part 1 §1. Belongs to `TAB-004`.

## Related documentation

`HANDOVER.md` §2, §9; `LOGIC_AUDIT.md` Part 1 §4c; commit `ddc0097` (the
`RM_Hierarchy` PDF-race guard).

## Relationships

- **Depends On:** the two cdnjs scripts (jsPDF 2.5.1, jspdf-autotable
  3.8.2)
- **Used By:** `JS-013`, `TAB-004`
- **Related:** `JS-008` (supplies the data), `JS-022` (supplies
  `rmHierarchyByNameLower` + `rmHierarchyFetchState`)

## Source of truth

`js/repeat-offenders-pdf.js`; `dashboard.html` `#L22`–`#L23`.

## Validation

- **Method:** CDN versions + load-order read from `dashboard.html` at
  `c82ec67`; the room-estimation fix and the `RM_Hierarchy` guard
  confirmed in `js/repeat-offenders-pdf.js` (the guard added and verified
  this session, `ddc0097`). PDF assembly is verified by manual download;
  `computeRmPerformance` (the data) is covered by
  `tests/frontend-harness.html`.
- **Evidence:** commit `ddc0097`; `dashboard.html` `#L20`–`#L23`;
  `LOGIC_AUDIT.md` Part 1 §4c.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by `DOC-033`.

## Revalidation trigger

Either CDN version changes (jsPDF or jspdf-autotable); the load-order
constraint changes; the `autoTable` call shape changes; a second PDF/
export surface is added.

## Handover relationship

`HANDOVER.md` §2/§9 cover the Repeat Offenders subsystem including the
export. Current as of 2026-09-09 but predates the `ddc0097` guard by a
day — a §9 refresh should mention the `RM_Hierarchy` load gate on the
PDF path. A CDN version bump should be noted in `HANDOVER.md` §2.

## Lifecycle / retention

N/A — a client-side library. The PDFs it produces live on the user's
disk only.

## Next action

none — Closed + Monitored.

## Closure evidence

Record committed for `DOC-033`; `docs/INDEX.md` `EXT-004` → `Closed +
Monitored`, `Last Verified` 2026-09-10, pinned CDN versions + real
call-site references recorded. No `docs/changes/` record (`DOC-033`).
