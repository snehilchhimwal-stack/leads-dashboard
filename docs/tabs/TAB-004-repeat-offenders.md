# TAB-004 — Repeat Offenders

| | |
|---|---|
| **Type** | `TAB-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `dashboard.html` `#tab-repeatoffenders` (`#L1128`); `js/tab-repeat-offenders.js` + `js/rm-performance-worker.js` + `js/core-rm-performance.js` + `js/repeat-offenders-pdf.js` |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

Accountability leaderboards. It ranks RMs, Regions, and the A1-TM / RH
tiers by `computeRmPerformance()`'s workload-normalized composite score
(empirical-Bayes shrinkage toward a peer average, severity-weighted), so
a manager can see *who is consistently off-SLA* rather than who had one
bad day. Added 2026-09-01 as its own top-level tab. It reads the
`Daily_RM_Issues` / `Movement_Log` history rather than the live `leads`
tab, because "repeat" is a claim about the past, not the present.

## Responsibilities

- Run the RM-performance computation (in a Web Worker,
  `js/rm-performance-worker.js`, to keep the main thread free).
- Render the RM / Region / A1-TM / RH leaderboards plus the "Worst 5 RMs
  by Region" additional breakdown (added this session).
- Independently fetch `RM_Hierarchy` for the display rollup (read-only,
  browser-side — separate from the Apps Script routing read).
- Export a filter-matching PDF.

## Who / what uses it

Regional heads / leadership reviewing sustained RM performance
(`HANDOVER.md` §9).

## Inputs (which in-memory state arrays / filter state it reads)

`movementSnapshots` + `movementFetchState` (`JS-021`); the `RM_Hierarchy`
sheet via its own fetch (`fetchRmHierarchyForRollup`, sets
`rmHierarchyFetchState`); its **own** filter set (Project / Region / TL /
Source / Sub-source / Time range) — deliberately separate from the shared
filter bar since 2026-09-07 (`passesRepeatOffenderFilters()`, *not* the
same predicate as `passesMovementFilters()` — a documented region-filter
gap, `LOGIC_AUDIT.md` Part 1 §4c / Part 4/6).

## Outputs / what it renders

RM / Region / A1-TM / RH leaderboard tables + the per-region worst-5
breakdown into `#tab-repeatoffenders`; a PDF download.

## Data displayed

Per-RM: Avg Flagged (instances ÷ distinct leads), composite score,
"driven by" contributor list, chronic-streak flag; classified vs an
"Insufficient Data" floor (`RM_PERF_MIN_VOLUME_LEADS`). RM / A1-TM / RH
tables show "Below Expectations only, worst first"; the By-Region table
shows *all* regions (live tab) — the PDF shows Below-Expectations-only in
all 4 tables, an intentional divergence (`LOGIC_AUDIT.md` Part 1 §4c).

## Data written / modified

None — read-only tab. (`Daily_RM_Issues` is written by `GS-003`, not
here.)

## Navigation relationships

Reached from `#tabBar`. Gated at render behind
`Promise.all([fetchRmHierarchyForRollup(sheetId), movementLogPromise])`
in `JS-003` (~`#L624`). Shares `computeRmPerformance` and the
`rmHierarchyByNameLower` / `primaryManagerForRm` / `_repeatOffendersRegionKey`
helpers with the PDF module so the two surfaces "can never independently
invent different data" (`LOGIC_AUDIT.md` Part 1 §4c).

## Buttons / actions — `BTN-XXX` sub-table

| ID | Label | Element id | What it does | Invokes (`FN-XXX`) | Confirm/irreversible? | Failure behaviour |
|---|---|---|---|---|---|---|
| BTN-010 | ↻ Recalculate | `#repeatOffendersRecalculateBtn` | Re-runs this report's own computation against its current filters (this report only, not the whole dashboard) | worker dispatch → `computeRmPerformanceByRegion` / `computeRmPerformance` (`JS-017` / `JS-008`) | no | shows a progress label; on worker error, prior table stays |
| BTN-011 | Download PDF | `#repeatOffendersDownloadPdfBtn` | Exports the current filter's tables as a vector PDF, broken out per date | `downloadRepeatOffendersPdf` (`JS-013`) | no (local download) | **refuses with a status message** if `rmHierarchyFetchState` is `loading`/`idle` (added `ddc0097`) so leadership rows can't leak into the export; inert in a sandboxed viewer |

## Non-button UI elements — `UI-XXX` sub-table

| ID | Element | Behaviour | Invokes (`FN-XXX`) |
|---|---|---|---|
| UI-005 | Project/Region/TL/Source/Sub-source multi-selects + Time range | writes this report's private filter object; `↻ Recalculate` applies | `passesRepeatOffenderFilters` (`JS-022`) |
| UI-006 | progress label | shows worker stage (`byRegion` etc.) | `_REPEAT_OFFENDERS_PROGRESS_LABEL` (`JS-022`) |

## Owning module(s)

`JS-022` (`tab-repeat-offenders.js`, tab render + `RM_Hierarchy` rollup
fetch), `JS-017` (`rm-performance-worker.js`, off-thread compute),
`JS-008` (`core-rm-performance.js`, the engine), `JS-013`
(`repeat-offenders-pdf.js`, export). Reciprocal `Used By: TAB-004` on
each.

## Relevant functions

`renderRepeatOffenders` / `fetchRmHierarchyForRollup` /
`_runRepeatOffendersSynchronously` / `_renderRepeatOffendersResult`
(`JS-022`); worker `done`/progress with the `byRegion` field (`JS-017`);
`computeRmPerformance` / `computeRmPerformanceByRegion` /
`filterRmPerformanceWorst` / `rmPerfIsLeadershipExcluded` /
`rmPerfCanonicalRmName` (`JS-008`); `downloadRepeatOffendersPdf`
(`JS-013`). Detail on those FN sub-tables.

## Important logic / business rules

- Shrinkage / severity constants (`RM_PERF_SHRINKAGE_K`,
  `RM_PERF_RULE_WEIGHTS`, `RM_PERF_MIN_VOLUME_LEADS`,
  `RM_PERF_CHRONIC_STREAK_DAYS`, `RM_PERF_FLAG_RATIO`,
  `RM_PERF_CONCENTRATION_BREADTH_CEILING`) **must stay numerically
  identical** to `GS-003`'s `RM_PERF_*_GS_` (`LOGIC_AUDIT.md` Part 1 §4b).
- "RM" excludes A1 / TM / RH / Cluster Head / City Lead / Commercial
  Head roles and the name-based leadership set (`RM_PERF_NON_RM_ROLES`,
  `rmPerfIsLeadershipExcluded`, broadened this session `7ef26db`).
- Per-region worst-5 uses `REPEAT_OFFENDERS_REGION_RM_CAP = 5`, a
  region-scoped peer average, and only lists regions with ≥1 rankable RM
  (`computeRmPerformanceByRegion`).
- Region-filter gap: this tab's region filter does **not** run through
  `effectiveRegion()`'s Loan-source inference (`LOGIC_AUDIT.md` Part 1
  §4c, flagged Part 4/6).

## Exceptions & error handling

`EXC` (on `JS-013`): `RM_Hierarchy` fetch in flight at PDF-gen time →
refuse + "Still loading RM_Hierarchy — try again in a moment" status
message, user retries once loaded. Worker failure leaves the last good
table on screen.

## Architecture relationship

`DASH-001`. Consumes `DATA-002` (SLA-flag pipeline history) and
`DATA-004` (Movement snapshot pipeline).

## Related documentation

`HANDOVER.md` §9 (the whole Repeat Offenders subsystem + the Time-range
gotcha); `OPS_CHECKLIST.md` (worst-performer methodology drift);
`LOGIC_AUDIT.md` Part 1 §4b/§4c, Part 3 §3.6.

## Relationships

- **Depends On:** `JS-022`, `JS-017`, `JS-008`, `JS-013`, `JS-021`
  (`movementSnapshots`), `JS-003` (render gate), `JS-014` (`mainRegionFor`),
  `SHEET-002` (`Movement_Log`), `SHEET-003` (`Daily_RM_Issues` history),
  `SHEET-006` (`RM_Hierarchy`), `EXT-004` (jsPDF)
- **Used By:** `DASH-001`
- **Related:** `GS-003` (the `.gs` console mirror of the same scoring),
  `TAB-007` (shared `movementSnapshots` source)

## Source of truth

`dashboard.html` `#tab-repeatoffenders`; `js/tab-repeat-offenders.js`,
`js/rm-performance-worker.js`, `js/core-rm-performance.js`,
`js/repeat-offenders-pdf.js` at `HEAD`.

## Validation

- **Method:** read of the four owning modules + `#tab-repeatoffenders`
  markup at `c82ec67`; cross-check `LOGIC_AUDIT.md` Part 1 §4b/§4c + Part
  3 §3.6; the RM-exclusion and per-region-worst-5 behaviour was
  hand-verified this session against live data (the alias / leadership /
  PDF-race fixes `fef04b0`, `7ef26db`, `812a3cb`, `8d9acbc`, `ddc0097`).
- **Evidence:** `LOGIC_AUDIT.md` Part 3 §3.6; the session's fix commits;
  `tests/frontend-harness.html` (RM-performance compute path).
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-026. The scoring engine
grew materially this session (`js/core-rm-performance.js` 485L →
869L) — new record reflects the post-session state.

## Revalidation trigger

Any commit touching `js/tab-repeat-offenders.js`,
`js/rm-performance-worker.js`, `js/core-rm-performance.js`, or
`js/repeat-offenders-pdf.js`; any `RM_PERF_*` constant changes value
(also requires the `RM_PERF_*_GS_` twin to change); `RM_PERF_NON_RM_ROLES`
membership changes; `#tab-repeatoffenders` button set changes.

## Handover relationship

`HANDOVER.md` §9 covers this subsystem in depth, including the Time-range
gotcha. Current as of 2026-09-09 (it predates this session's engine
growth by one day — a methodology change here should refresh §9). A
scoring-constant change must update both `HANDOVER.md` §6 (duplication
pairs) and §9.

## Lifecycle / retention

N/A — code. Its history source `SHEET-003` retains 7 days.

## Next action

none — Closed + Monitored.

## Closure evidence

Record committed for DOC-026; `docs/INDEX.md` `TAB-004` → `Closed +
Monitored`, `Last Verified` 2026-09-10; `BTN-010`/`BTN-011` rows added;
validation evidence as above. No `docs/changes/` record (DOC-026).
