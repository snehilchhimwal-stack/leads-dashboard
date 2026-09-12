# Repeat Offenders Architecture Redesign

A full architectural redesign of the Repeat Offenders report — filtering,
unique-lead calculation, Region Average / Individual Work metrics, the
on-screen table, and the downloaded PDF — on the user's explicit
instruction: **"redesign the entire Repeat Offender logic architecture
rather than applying isolated fixes."** Grounded throughout in the real
code (`js/tab-repeat-offenders.js`, `js/repeat-offenders-pdf.js`,
`js/core-rm-performance.js`, `js/rm-performance-worker.js`,
`js/core-filters.js`), not assumed. 7 parts, tracked as their own series
(tag `repeat-offenders-review`), superseding the original single ticket
("wrong count of unique leads in repeat offender").

**One fact that shapes every part below, stated up front**: this
dashboard has **no backend/API layer at all**. It is a single static
HTML page (`dashboard.html`) plus client-side `js/*.js` files, served
from GitHub Pages, reading Google Sheets directly via the Sheets API
from the signed-in user's own browser. Several requirements in the
original brief (API boundaries, frontend/backend disagreement, repeated
database/API queries) assume a client/server split that does not exist
here — each is addressed explicitly below rather than silently ignored
or forced onto an architecture that isn't real.

## Part 1 — Current Architecture Assessment + Root Causes

### A. Current Architecture Assessment

**Data source.** Everything in this report is derived from
`movementSnapshots` (`js/tab-movement.js`) — a browser-side, in-memory
array holding every retained row of the `Movement_Log` Sheet tab
(7-day rolling window, `MOVEMENT_LOG_RETENTION_DAYS`), fetched once per
page load/refresh. No separate query happens per filter change or per
PDF export — the raw data is already resident in memory; what varies
is what gets *computed from* it, not what gets *fetched*.

**The 4-stage calculation engine** (`js/core-rm-performance.js`),
shared by every rollup level and by both the live tab and the PDF:

| Stage | Function | What it does |
|---|---|---|
| 1 | `reconstructRmPerformanceObservations` (line 406) | Walks every lead's Movement_Log history (`buildMovementHistories`/`splitHistoryByCopy`, `js/tab-movement.js`), applies `passesRepeatOffenderFilters` (line 186) **per raw record, before anything else**, excludes leadership (`rmPerfIsLeadershipExcluded`), and emits one `{name, lead_id, dayKey, rule, violated}` row per (lead, calendar day, SLA rule) the lead was eligible for that day. |
| 2 | `aggregateRmPerformance` (line 494) | Rolls Stage 1's observations up per group (RM, Region, A1-TM, or RH, depending on the caller's `keyFn`): eligible/violation lead-day counts, distinct eligible/violated lead counts, chronic-streak detection. |
| 3/4 | `classifyRmPerformance` (line 598) | Computes each group's peer average, empirical-Bayes-shrunk composite score, and classification (`Insufficient Data` / `On Track` / `Watch — concentrated` / `Below Expectations`). This is where **`distinctLeads`** ("Unique Leads") is set — `nLeads = allEligibleLeads.size` (line 636), the exact count of distinct leads that survived Stage 1's filter and were eligible for at least one scored rule. |

`computeRmPerformance` (line 692) is the one orchestration function
every caller uses: `reconstructRmPerformanceObservations` →
`aggregateRmPerformance` → `classifyRmPerformance`, in that order,
every time. **"Individual Work" is this pipeline keyed by RM name**
(the default `keyFn`); **"Region Average" is the peer/composite figures
this same pipeline produces when keyed by region** (`repeatOffendersRegionKey`,
line 222) — both are the *same engine*, not two separate calculations,
differing only in the grouping key passed in.

**Two callers of that engine, architecturally different:**

1. **The live tab** (`js/tab-repeat-offenders.js`). `renderRepeatOffenders()`
   (line 250) captures a frozen filter snapshot
   (`captureRepeatOffendersFilterSnapshot`, line 124 — a fresh `Set` copy
   of the live `filterState` global, not a reference to it) and a frozen
   `dateKeys` set for the selected time range, then calls
   `runRepeatOffendersRecalculation` (line 337), which **posts the whole
   job to a dedicated Web Worker** (`js/rm-performance-worker.js`) and
   waits for its `onmessage` reply. This is deliberate and necessary —
   the code's own comment cites ~12s+ compute time against the real
   ~232k-row dataset, and running it on the main thread would freeze the
   tab. Until the worker replies, the on-screen table
   (`_renderRepeatOffendersResult`, line 440) keeps showing whatever it
   last successfully rendered — there is no intermediate "clearing" of
   the table, only a status strip saying "Recalculation started…".
2. **The PDF export** (`js/repeat-offenders-pdf.js`). `downloadRepeatOffendersPdf`
   (line 401) → `_repeatOffendersPdfSectionTables` (line 126) calls
   `captureRepeatOffendersFilterSnapshot()` **again, independently**,
   and `computeRmPerformance()` **directly, synchronously, on the main
   thread** — no worker, no wait, no read of anything the live tab has
   already computed. It reads `filterState`, `_renderNow`, and
   `movementSnapshots` at the exact instant of the click.

**What triggers a recalculation today.** Every filter checkbox
(`buildMultiSelect`, `js/core-filters.js:300`) mutates `filterState`
**synchronously** in its `change` handler, then calls `onChange` =
`applyFiltersAndRender` (`js/core-filters.js:38`), which — after two
`setTimeout(…, 0)` hops to let the loading overlay actually paint —
calls `_applyFiltersAndRenderImpl` (line 54) → `renderAll()`
(`js/overview-distribution-people-ops.js:159`), which **unconditionally**
calls `renderRepeatOffenders()` (line 278, no gating flag around it,
unlike Morning Brief just above it). So a filter change **does**
already trigger a fresh Repeat Offenders recalculation automatically —
the separate "Recalculate" button on that tab (`js/tab-repeat-offenders.js:711`)
exists to re-anchor `_renderNow` to the current moment and to manually
retry, not because filter changes are otherwise ignored.

**Sequence — a filter change, today:**
```
checkbox click → filterState mutated (synchronous)
  → applyFiltersAndRender() [2 setTimeout(0) hops for overlay paint]
    → renderAll()
      → renderRepeatOffenders()
        → captureRepeatOffendersFilterSnapshot()  [reads filterState — already new]
        → Worker.postMessage(...)                  [async, up to ~12-15s]
        ← Worker 'done'                             [screen updates HERE, not before]
```

**Sequence — a PDF click, today:**
```
button click → downloadRepeatOffendersPdf()
  → captureRepeatOffendersFilterSnapshot()   [reads filterState — LIVE, whatever it is RIGHT NOW]
  → computeRmPerformance(...)                 [synchronous, main thread, independent of any worker]
  → doc.save(...)
```

### B. Root Causes and Architectural Problems

**The filtering logic itself is correct and applied once.** This needs
to be stated plainly because it contradicts the most literal reading of
the original bug report ("unique-lead calculation does not consistently
respect active filters"): `passesRepeatOffenderFilters` (line 186) is
called exactly once per raw record, at the very top of Stage 1, before
leadership exclusion, before day-key restriction, before eligibility
checking. There is no code path in `core-rm-performance.js` where a
metric is computed from an unfiltered population. Source and Sub-source
are both checked (lines 190-191) exactly like Project/Region/TL.

**The real bug: two independent evaluations of the same function,
racing.** `computeRmPerformance` is a pure(ish) function of
(`movementSnapshots`, `dateKeys`, `keyFn`, `filters`,
`rmHierarchyByNameLower`). Called twice with identical arguments it
must return identical results — and normally, moments apart with no
filter change in between, it does. The divergence only opens when
`filterState` (or `_renderNow`) changes **between** the live tab
starting its (slow, async) calculation and the PDF running its (fast,
sync) one. Because a filter checkbox mutates `filterState` *before* the
async chain even begins, the PDF — clicked during that window — computes
against the *new* filter while the screen is still showing the *old*
result. The PDF isn't wrong for the filters that exist at click time;
it simply isn't showing what the user is currently looking at, which is
exactly what the user experiences as "the report doesn't respect my
filters."

**This is not a new class of bug for this feature.** The file's own
history documents an earlier, structurally identical incident
(`js/repeat-offenders-pdf.js:414-436`, 2026-09-09): an RH and a CH
leaked into a downloaded PDF as ordinary RMs while the live tab
correctly excluded them, because the PDF's gating check
(`movementFetchState`) didn't also cover `rmHierarchyByNameLower`'s own,
separately-async fetch — the exclusion logic itself was fine, the gate
around *when it's safe to export* wasn't complete. The current bug is
the same shape, one layer up: the exclusion/filter logic is fine, the
gate around *when the PDF may safely compute* still doesn't fully
cover it — specifically, the live tab's Worker-based recalculation.

**Assessed against the named anti-pattern list:**

| Anti-pattern | Present? | Detail |
|---|---|---|
| Duplicate calculations | **Yes — the core issue** | `computeRmPerformance` is invoked independently by the live tab's worker path and by the PDF's own code, from the same inputs, at different times. |
| Calculation logic inside PDF/export code | **Partially** | `repeat-offenders-pdf.js` does not reimplement the math (it correctly reuses `computeRmPerformance`/`filterRmPerformanceRankable`/`sortRmPerformanceByScore`) — but it does independently *orchestrate a fresh run* of that shared engine, which is the actual problem: PDF code should consume a result, not produce one. |
| Different filtering logic in different components | **Yes, but narrow and deliberate** | `passesRepeatOffenderFilters` intentionally differs from `passesFilters` (`core-filters.js:73`, used for every non-Movement-Log view) — a Movement_Log row's `region` is the raw captured value, never run through `effectiveRegion()`'s Loan-source inference the way a live lead record is (documented at `core-rm-performance.js:176-182`). Real, already-known, and out of this bug's actual scope — noted here for completeness, addressed as a documented limitation in Part 3, not "fixed" by unifying two predicates that are checking genuinely different-shaped data. |
| Frontend/backend disagreement | **N/A** | No backend exists. Both "components" in question (live tab, PDF) are client-side JavaScript in the same browser tab. |
| Stale state | **Yes, and it's the mechanism of the bug** | The live tab's table intentionally shows stale (previous) data while a recalculation is in flight — reasonable for a screen with a visible "Recalculating…" status, but hazardous once a second, faster path (the PDF) can read fresher underlying state than what's stale-rendered. |
| Repeated database/API queries | **No** | `movementSnapshots` is fetched once per page load and reused in memory by every caller; the "duplication" here is repeated *computation*, not repeated network I/O. |
| Metrics calculated from unfiltered data | **No** | Confirmed: every metric traces back through `passesRepeatOffenderFilters`. |
| Metrics calculated independently when they should share a dataset | **Yes — same root cause as "duplicate calculations"** | Unique Leads, Region Average, and Individual Work are already one shared *dataset* per call (they all come out of one `computeRmPerformance` invocation) — the gap is that the live tab's call and the PDF's call are two different invocations, not two consumers of one. |

**Conclusion carried into Part 2 onward**: the fix is not "make the PDF
apply filters correctly" (it already does) — it is "make the PDF stop
computing at all, and instead consume whatever the live tab already
computed." Every subsequent part of this redesign is built on that
conclusion.

*(Part 1 complete. Continues in Part 2 — explicit business rules for
Unique Lead / Repeat Offender.)*
