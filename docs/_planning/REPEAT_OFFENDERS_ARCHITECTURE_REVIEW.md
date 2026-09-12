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

## Part 2 — Explicit Business Rules for Unique Lead / Repeat Offender

Every rule below is stated so a future engineer can check real code
against it directly — each cites the exact function/line it comes from.
Where the original brief's terminology doesn't quite match what this
codebase actually implements, that mismatch is called out explicitly
rather than papered over.

**Rule 1 — Identity is two-level: customer, then copy.**
`buildMovementHistories()` (`js/tab-movement.js:330`) groups every raw
Movement_Log row by **`client_id`** (falling back to `'l:' + lead_id`
when `client_id` is blank) — this is the *customer* identity.
`splitHistoryByCopy(history)` (`js/tab-movement.js:724`) then splits
one customer's full history further, by **`lead_id`** — because the
same customer can legitimately be represented by more than one
`lead_id` row (documented elsewhere in this codebase: a customer
independently assigned to two different RMs, sometimes in different
regions). Each resulting "copy" is one `lead_id`'s own sub-history,
tracked entirely separately from any other copy of the same customer.

**Rule 2 — "One lead" for this report means one copy (one `lead_id`),
not one customer.** `distinctLeads`/"Unique Leads" is a count of
distinct `lead_id` values that survived Stage 1 (`allEligibleLeads`,
`core-rm-performance.js:606,636`) — a customer split across two RMs
contributes up to 2 to that count, once per copy, by design (Rule 1's
whole reason for existing: RM A's work on their copy must never be
credited to or blamed on RM B for the other copy of the same person).

**Rule 3 — Filtering is evaluated per raw snapshot record, not once per
lead.** `passesRepeatOffenderFilters(rec, filters)`
(`core-rm-performance.js:186`) is called inside the per-record loop
over a copy's own chronological history
(`reconstructRmPerformanceObservations`, line 420), checking that
individual record's own `project`/`region`/`TL`/`group_source`/
`source_bucket` values. There is no separate "does this lead pass the
filter" gate evaluated once and then applied to the whole lead's
history.

**Rule 4 — Dedup order, precisely: identity grouping happens
structurally before filtering; day-level collapse happens after
filtering, among survivors.** The two dedup steps in this pipeline are
not both "before" or both "after" the filter — they're on opposite
sides of it:
  - **Before filtering**: Rule 1's customer→copy grouping
    (`buildMovementHistories`/`splitHistoryByCopy`) — this is structural
    identity resolution, not filtering, and happens unconditionally.
  - **The filter check itself** (line 421): applied per raw record,
    inside the per-copy loop.
  - **After filtering**: "latest snapshot wins" per calendar day
    (the `byDay` map, lines 419-433) — a record that FAILS the filter
    is skipped (`return`) *before* it's ever compared against that
    day's current `byDay` entry. This means the record actually used
    for a given (copy, day) is **the latest-by-timestamp record that
    ALSO passed the filter that day** — not unconditionally the day's
    true-latest capture. A day where the lead's latest capture happens
    to fail the filter (e.g. its `source_bucket` value changed between
    two same-day captures) falls back to an earlier same-day capture
    that did pass, if one exists, rather than being dropped outright.

**Rule 5 — A lead's eligibility for this report can genuinely differ
day to day, and that's intentional, not a bug.** Because filtering is
per-record (Rule 3) and Movement_Log stores one snapshot's worth of a
lead's fields as they stood at capture time, a lead whose own
`group_source`/`source_bucket`/`region`/`TL` value changes between
captures (a reassignment, a data correction, a real re-classification)
will pass the filter on some days and not others. This directly answers
the original brief's "one lead associated with multiple Source/Sub
Source values" question: there is no single canonical Source/Sub-source
attributed to a lead for this report — each day's own eligibility is
judged from that day's own captured values.

**Rule 6 — "Unique Leads" is scoped to the group AND the current
filters AND the current time range, together.** The full definition:
the count of distinct `lead_id` values with at least one (day, rule)
observation that (a) passed the active filters that day, (b) falls
within the selected time range's `dateKeys`, (c) belongs to this
group (RM/Region/A1-TM/RH, per the caller's `keyFn`), and (d) was
eligible for at least one of the 5 scored SLA rules that day
(`RM_PERF_RULES`, `core-rm-performance.js:142`). Changing any one of
group / filters / time range changes this number — by design, not by
accident.

**Rule 7 — "Repeat Offender" is a GROUP-level classification in this
codebase, not a per-lead flag — a real terminology gap between the
original brief and the actual implementation, worth stating plainly.**
There is no code anywhere that marks an individual lead as "a repeat
offender." `classifyRmPerformance` (`core-rm-performance.js:598`)
classifies **RMs, Regions, A1-TM managers, and RHs** — never leads —
into `Insufficient Data` / `On Track` / `Watch — concentrated` /
`Below Expectations`, based on that group's own composite SLA-violation
score relative to its peers. The tab is named "Repeat Offenders"
because it surfaces which *people/regions* have a repeat pattern of SLA
violations across their book of leads — the leads themselves are the
evidence the classification is built from, not the thing being
classified. Any redesign work should keep using "Unique Leads",
"Region Average", "Individual Work" (all group-level, per Rule 6/10) as
the real vocabulary — not introduce a new "is this lead a repeat
offender" concept the current system was never designed around.

**Rule 8 — The one lead-level concept that DOES exist: "chronic."** A
lead violating the *same* rule on `RM_PERF_CHRONIC_STREAK_DAYS` (3, line
97) or more **consecutive calendar days** is "chronic" for that rule
(`aggregateRmPerformance`, lines 536-550). This feeds the group-level
`concentrated` distinction (line 622): a group's elevated score is
"Watch — concentrated" (a case-management question — go check those
specific leads) rather than "Below Expectations" (a broad pattern
across the whole book) when at least one violated lead is chronic AND
violated leads are ≤25% of the group's eligible book
(`RM_PERF_CONCENTRATION_BREADTH_CEILING`, line 118). This is the
closest analogue to "repeat offender" the codebase actually has at the
lead level — a chronic lead, not a classified one.

**Rule 9 — No filter selected on a dimension means no restriction on
that dimension, full stop.** `filters.X.size === 0` short-circuits that
check to always pass (`core-rm-performance.js:187-191`) — confirmed
identical for Project, Region, TL, Source, and Sub-source. This applies
per-dimension independently: leaving Source unset while Region is set
restricts only by Region, exactly as expected.

**Rule 10 — "Region Average" and "Individual Work" are the same
calculation pipeline, differing only in grouping key — not two
concepts needing two implementations.** `computeRmPerformance`
(line 692) is called with `keyFn = undefined` (defaults to RM name) for
Individual Work, and with `keyFn = rec => repeatOffendersRegionKey(rec)`
for Region — same Stage 1-4 pipeline, same filter, same shrinkage
math, same classification thresholds. "Region Average" specifically
refers to a region-keyed group's own `peerComposite` (line 661) — the
*other regions'* average, which that region's own composite is judged
against — not a company-wide average applied uniformly to every level.

*(Part 2 complete. Continues in Part 3 — target architecture: data
flow, contracts, layer responsibilities.)*

## Part 3 — Target Architecture: Data Flow, Contracts, Layer Responsibilities

### D. Proposed Target Architecture

The Stage 1-4 calculation pipeline (`core-rm-performance.js`) is
**already correct** (Part 1) and needs no redesign — every metric it
produces is already filtered once, consistently, at the right layer.
The one real structural addition is new: **a single canonical result
object**, produced exactly once per completed calculation, cached at
the point it's produced, and read — never recomputed — by every
consumer. Concretely: `_renderRepeatOffendersResult`
(`tab-repeat-offenders.js:440`), which already receives everything a
result needs from the Worker's `'done'` message, additionally stores it
in one module-level variable before it renders the DOM. The PDF export
(`repeat-offenders-pdf.js`) is rewritten to read that cache and nothing
else — it stops calling `computeRmPerformance` (or anything downstream
of it) entirely.

This is deliberately the *smallest* structural change that satisfies
"one source of truth" — it does not introduce a new module, a new
message-passing protocol, or a state-management library. The Worker
already produces the complete result; the only gap is that nothing
remembers it for a second consumer.

### E. End-to-End Data Flow (text diagram)

```
Movement_Log (Google Sheet)
  │  fetched once per page load/refresh via the Sheets API
  ▼
movementSnapshots                                   [js/tab-movement.js, in-memory global]
  │
  ▼
buildMovementHistories()                            [group by client_id — "customer"]
  │
  ▼
splitHistoryByCopy(history)                         [split by lead_id within a customer — "copy"]
  │
  ▼
passesRepeatOffenderFilters(rec, filters)           [PER RAW RECORD — Project/Region/TL/Source/Sub-source]
  │  (records failing this are dropped before anything below ever sees them)
  ▼
byDay "latest snapshot wins" collapse               [PER (copy, day) — this IS where "the unique-lead
  │                                                   dataset for this day" is actually formed]
  ▼
RM_PERF_RULES eligibility check                     [per (copy, day, rule) — 5 SLA rules]
  │
  ▼
Stage 1 observations: [{name, lead_id, dayKey, rule, violated, rm, region}, ...]
  │
  ▼
aggregateRmPerformance(observations)                [group by keyFn: RM (default) | Region | A1-TM | RH]
  │
  ▼
classifyRmPerformance(byGroup)                      [Unique Leads, composite, peerComposite
  │                                                   ("Region Average" when keyFn=region),
  │                                                   classification — ONE function, every rollup level]
  ▼
┌─────────────────────────────────────────────────────────────────┐
│  CANONICAL RESULT  (NEW — the actual fix)                        │
│  { rm[], region[], a1tm[], rh[], byRegion[], stageCounts,        │
│    computedFrom: {filters, dateKeys, hierarchyMissing},          │
│    computedAtWall, runId }                                       │
│  — produced exactly once, cached in _repeatOffendersLastResult   │
└─────────────────────────────────────────────────────────────────┘
  │                                    │
  ▼                                    ▼
Screen render                    PDF export
(_renderRepeatOffendersResult    (downloadRepeatOffendersPdf —
 builds bodyEl.innerHTML          reads the cache ONLY, never
 from the SAME object it          calls computeRmPerformance,
 just cached)                     never calls captureRepeatOffendersFilterSnapshot
                                   for a fresh compute)
```

The critical property this diagram makes visible: **today, the two
branches at the bottom each start their own arrow back up to
`computeRmPerformance`. In the target architecture, there is exactly
one arrow down to the canonical result, and both branches only ever
read from it.**

### F. Data Contracts / Interfaces

Every boundary in the pipeline above, with its exact shape — this is
what "avoid duplicated calculation logic" actually means in practice:
each stage has ONE producer and one documented shape, and every
consumer of that shape gets it from the same place.

| Boundary | Shape | Producer | Consumers |
|---|---|---|---|
| Filter snapshot | `{project, region, TL, source, bucket}`, each a frozen `Set<string>` | `captureRepeatOffendersFilterSnapshot()` (`tab-repeat-offenders.js:124`) | `passesRepeatOffenderFilters`, threaded through every Stage 1 call |
| Stage 1 observation | `{name, lead_id, dayKey, rule, violated, rm, region}` | `reconstructRmPerformanceObservations` (`core-rm-performance.js:406`) | `aggregateRmPerformance` only |
| Stage 2 group entry | `{name, rules: Map<ruleKey,{eligibleDays,violationDays,eligibleLeads:Set,violatedLeads:Set,perLead:Map,rate,distinctEligibleLeads,distinctViolatedLeads,maxStreak,chronicLeads}>, distinctRMs:Set, regionCounts:Map}` | `aggregateRmPerformance` (`core-rm-performance.js:494`) | `classifyRmPerformance`, `computeRmPerfPeerAverages` |
| Classified row (one per RM/Region/A1-TM/RH) | `{name, distinctLeads, composite, peerComposite, rules, routingIssueDays, classification, totalInstances, distinctRMs, primaryRegion}` | `classifyRmPerformance` (`core-rm-performance.js:598`) | Table renderer (`rmPerformanceTableHtml`), PDF row-builder (`_repeatOffendersPdfTableRows`) — **both already consume this exact shape today; this contract doesn't change** |
| **Canonical result (NEW)** | `{rm: Row[], region: Row[], a1tm: Row[], rh: Row[], byRegion: {region,list:Row[]}[], stageCounts, computedFrom: {filters, dateKeys, hierarchyMissing}, computedAtWall: Date, runId: number}` | `_renderRepeatOffendersResult` (`tab-repeat-offenders.js:440`), at the moment a Worker (or synchronous-fallback) run completes | Screen renderer (same function, immediately) **and** `downloadRepeatOffendersPdf` (reads it, doesn't produce it) |

`runId` is not new plumbing — `_repeatOffendersRunId`
(`tab-repeat-offenders.js:248`) already exists exactly to distinguish a
superseded run from the live one; the cache simply also records which
`runId` it came from, so the PDF export can tell "this is the latest
completed run" from "a newer run is currently in flight" (Part 4).

### G. Responsibility of Each Layer / Component

| Responsibility | Owner | Notes |
|---|---|---|
| Filter application | `passesRepeatOffenderFilters` (`core-rm-performance.js:186`) | Unchanged — already correct, already the single implementation for this report. (`core-filters.js`'s `passesFilters`, line 73, is a *different* predicate for non-Movement-Log views — narrow, documented, deliberate divergence per Part 1's anti-pattern table; not unified here, see Risks in Part 6.) |
| Lead/copy identity & dedup | `buildMovementHistories`/`splitHistoryByCopy` (`js/tab-movement.js:330,724`) | Unchanged |
| Unique Lead calculation | `classifyRmPerformance`'s `distinctLeads` (`core-rm-performance.js:636,659`) | Unchanged |
| Repeat Offender classification | `classifyRmPerformance` (`core-rm-performance.js:598`) | Unchanged — see Part 2 Rule 7 for what this term actually means here |
| Region Average | `computeRmPerformance` keyed by region (`repeatOffendersRegionKey`) | Unchanged — same engine as Individual Work |
| Individual Work | `computeRmPerformance` keyed by RM (default `keyFn`) | Unchanged — same engine as Region Average |
| Recalculation orchestration (when/how often to run) | `runRepeatOffendersRecalculation` (`tab-repeat-offenders.js:337`) | Unchanged — still Worker-based, still triggered by `renderRepeatOffenders()` on every filter/range change |
| **UI state / canonical result ownership (NEW)** | `_renderRepeatOffendersResult` (`tab-repeat-offenders.js:440`) | **New responsibility**: caches the completed result before rendering, not just after |
| Screen rendering | `_renderRepeatOffendersResult` / `rmPerformanceTableHtml` | Unchanged in what it renders; now explicitly reads from the same object it just cached, not implicitly "whatever the worker just sent" |
| PDF rendering | `js/repeat-offenders-pdf.js` | **Responsibility narrows**: from "compute + render" to "render only" — it should not import, call, or depend on `computeRmPerformance`/`reconstructRmPerformanceObservations`/`aggregateRmPerformance`/`classifyRmPerformance` at all after this redesign |

*(Part 3 complete. Continues in Part 4 — PDF export redesign, the
single-source-of-truth mechanism in full detail.)*

## Part 4 — PDF Export Redesign (Single Source of Truth)

### H. PDF Export Design

**A refinement to Part 3's canonical-result contract, found while
designing this part — stated explicitly rather than silently folded
in.** Part 3 specified `computedFrom: {filters, dateKeys,
hierarchyMissing}`. That's not quite enough: `repeat-offenders-pdf.js`
today *also* independently re-reads the range-select's live value and
`_renderNow` (`_repeatOffendersPdfCurrentFilterInfo`, line 82) purely to
print the PDF's own "Filter: X" / "Date Range: Y – Z" header lines
(`_repeatOffendersPdfFilterSummaryLine`, line 182;
`_repeatOffendersPdfDateLine`, line 66) — both **separately from**
`filters`/`dateKeys` used for the actual calculation. If those live
values change between the cache being produced and the PDF being
generated (the exact race Part 1 identified), the printed header could
describe filters different from the data actually in the tables below
it — a subtler version of the same bug, in the report's own
self-description rather than its numbers. **`computedFrom` must also
carry `range` (the range-select value string) and `now` (the `Date`
`dateKeys` was resolved against)**, so every piece of text the PDF
prints — header line, date line, and table contents alike — traces
back to the one cached object, never to a live global read at export
time.

**Final cache shape** (supersedes Part 3's `computedFrom`):
```js
_repeatOffendersLastResult = {
  runId,                 // which _repeatOffendersRunId produced this
  computedAtWall,        // Date — when this calculation completed
  computedFrom: {
    filters,             // frozen Set snapshot used
    dateKeys,            // frozen Set of day-keys used
    range,               // the range-select value ('yesterday' | 'thisWeek' | ... )
    now,                 // the Date dateKeys was resolved against
    hierarchyMissing,
  },
  rm, region, a1tm, rh, byRegion,   // raw classifyRmPerformance() arrays, exactly as the worker returned them
  stageCounts,
}
```

**Where it's set.** `_renderRepeatOffendersResult`
(`tab-repeat-offenders.js:440`) sets `_repeatOffendersLastResult` at the
top of the function, from its own `msg`/`ctx`/`runId`/`elapsedMs`
parameters — **before** the existing `if (!rmFull.length)` early-return
branch, so a genuinely-empty result (filters narrowing to zero matches)
is cached too. An empty result is still a real, valid "this is what's
currently on screen" state; the PDF must be able to correctly report
"nothing to export for these filters" by reading the cache, the same
way it would for a non-empty one — never by recomputing to rediscover
the same zero.

**Where display-ordering still runs twice, deliberately, and why
that's fine.** The worst-N ranking (`sortRmPerformanceByScore` +
`filterRmPerformanceRankable`) and per-table caps (20/10/5/uncapped)
are pure, stateless functions of already-computed rows — they touch
neither `movementSnapshots` nor `filterState` nor any Sheets data. The
screen and the PDF each still call them independently, on the SAME
cached `rm`/`region`/`a1tm`/`rh` arrays, which is safe: called twice on
identical input, a pure sort/filter/slice cannot diverge. What must
never run twice is the expensive, `filterState`/`movementSnapshots`-
dependent Stage 1-4 calculation — and after this redesign, it doesn't.

**The three states `downloadRepeatOffendersPdf` must handle
explicitly:**

| State | Condition | Behavior |
|---|---|---|
| 1. Nothing computed yet | `_repeatOffendersLastResult === null` | Block export. Status message: e.g. "Nothing calculated yet — wait for the Repeat Offenders table to finish loading, then try again." |
| 2. A newer recalculation is in flight | `_repeatOffendersLastResult.runId !== _repeatOffendersRunId` | Block export. Status message: e.g. "Still recalculating for the current filters — wait for the table to finish updating, then try again." **This is the exact race window from Part 1, closed by construction**: `_repeatOffendersRunId` (`tab-repeat-offenders.js:248`) is already bumped synchronously the instant a new run starts (`runRepeatOffendersRecalculation`, line 339) — before the async Worker work even begins — so this single integer comparison is sufficient to detect the race with no new plumbing. |
| 3. A completed, current cache exists | `_repeatOffendersLastResult && .runId === _repeatOffendersRunId` | Export proceeds, building every PDF section (tables, header, filter line, date line) from `_repeatOffendersLastResult` only. |

No new flag is needed for "is a recalculation in flight" — reusing the
run-id counter that already exists for exactly this "supersede an
in-flight run" purpose (Part 3) is both simpler and cannot drift out of
sync with the mechanism the live tab already trusts for the same
question.

**Function-level changes** (signatures shown as pseudocode — real
diffs are Part 5's job):

- `_repeatOffendersPdfSectionTables(dateKeys)` → `_repeatOffendersPdfSectionTables(cached)` —
  reads `cached.rm/region/a1tm/rh/byRegion` directly; **no
  `computeRmPerformance` call anywhere in this function after the
  redesign.**
- `_repeatOffendersPdfCurrentFilterInfo()` → reads `cached.computedFrom.range`/`.now`/`.dateKeys`
  instead of `document.getElementById('repeatOffendersRangeSelect').value`/`_renderNow`.
- `_repeatOffendersPdfFilterSummaryLine()` → takes `cached.computedFrom.filters` as a
  parameter instead of reading the live `filterState` global.
- `downloadRepeatOffendersPdf()` → gains the 3-state check above as its
  first real branch (after the existing `_repeatOffendersPdfGenerating`
  re-entrancy guard, which is unrelated and stays as-is).

**UX addition, not strictly required for correctness but worth doing
alongside it**: proactively disable the "Download PDF" button itself
while `_repeatOffendersLastResult.runId !== _repeatOffendersRunId` (set
disabled at the start of `runRepeatOffendersRecalculation`, re-enabled
in `_renderRepeatOffendersResult` once the cache updates) — the same
pattern the "Recalculate" button already uses on itself
(`_repeatOffendersRecalculateBtnEl`, line 711). The reactive 3-state
check inside `downloadRepeatOffendersPdf` must exist regardless (defense
in depth against any click that lands before a disable takes effect),
but a disabled button is a clearer signal than a status message that
only appears after the click.

*(Part 4 complete. Continues in Part 5 — the refactoring/migration
plan.)*

## Part 5 — Refactoring / Migration Plan

### I. Staged Implementation Steps

**A real deployment fact that shapes the staging discipline below,
confirmed before writing this plan**: unlike this project's `.gs` files
(which need a manual copy-paste into the Apps Script editor before
anything takes effect live — `CLAUDE.md`), `dashboard.html`/`js/*.js`
are served **directly from this repo via GitHub Pages** — this
project's own CI already runs a `deploy`/`pages build and deployment`
job on every push to `master` (observed directly, Parts 1-4's own CI
runs). **A push to `master` here takes effect on the live dashboard
immediately.** There is no Apps-Script-style manual gate to hide a
half-finished change behind. That's the reason every step below is
staged to be independently safe and independently verified *before*
being pushed — not staged onto a disposable branch the way the
production Apps Script capture logic was (Lead History &
Versioning Review) — a disposable branch would only delay when the
live site changes, not add any real safety net for a file that
auto-deploys the moment it lands on `master` regardless of which
branch it was written on.

**Step 1 — Add the cache, populate it, change nothing that reads it
yet.** Purely additive; the live tab's behavior must be byte-identical
before and after this step.
  - Add `let _repeatOffendersLastResult = null;` (module-level,
    `tab-repeat-offenders.js`, alongside the existing
    `_repeatOffendersWorker`/`_repeatOffendersRunId` declarations, line
    247-248).
  - Thread `range` and `now` through the `ctx` object end to end — a
    real, precise plumbing gap confirmed by re-reading the current code:
    `renderRepeatOffenders()` (line 322-324) computes `filters` and
    calls `runRepeatOffendersRecalculation({ dateKeys, hierarchyMissing,
    filters, bodyEl, noticeEl, countEl, statusEl, clear })` — `range`
    and `now` (both already computed locally at lines 301-303) are
    **not currently included**. Add them to this object literal.
    `runRepeatOffendersRecalculation`'s `onDone` (line 348) constructs
    the object passed to `_renderRepeatOffendersResult` as `{ bodyEl,
    noticeEl, countEl, statusEl, filters, hierarchyMissing }` — neither
    `dateKeys` (available in scope, just not forwarded) nor the new
    `range`/`now` are included there either. Add all three.
  - At the top of `_renderRepeatOffendersResult` (line 440), before the
    existing `if (!rmFull.length)` branch, populate
    `_repeatOffendersLastResult` with the full shape from Part 4
    (`runId` — the closure's own `ctx`/call already has it via
    `onDone`'s outer `runId`; `computedAtWall` — `startedAtWall` is
    already a parameter; `computedFrom` built from `ctx.filters`,
    `ctx.dateKeys`, `ctx.range`, `ctx.now`, `ctx.hierarchyMissing`; and
    `rm/region/a1tm/rh/byRegion/stageCounts` straight from `msg`).
  - **Verify**: reload the dashboard, exercise every filter/range
    combination already covered by manual testing today, confirm the
    screen renders exactly as before (this step reads from nothing new,
    so there is no behavior to regress) — then, via the Browser pane's
    JS console, confirm `_repeatOffendersLastResult` populates with the
    expected shape after each recalculation. Commit on its own.

**Step 2 — Cut the PDF over to the cache; delete its independent
calculation entirely (not alongside it).** This is the actual fix.
  - Rewrite `_repeatOffendersPdfSectionTables` to take the cached object
    (not `dateKeys`) and build `candidates` from
    `cached.rm/region/a1tm/rh/byRegion` directly — remove every
    `computeRmPerformance`/`computeRmPerformanceByRegion` call from this
    file. (Both functions stay exported/used elsewhere —
    `_runRepeatOffendersSynchronously`, line 398, still needs them for
    the no-Worker fallback path, which is unrelated to this fix and
    stays as-is.)
  - Rewrite `_repeatOffendersPdfCurrentFilterInfo`/
    `_repeatOffendersPdfFilterSummaryLine`/`_repeatOffendersPdfDateLine`
    to take the cached `computedFrom` fields as parameters instead of
    reading `filterState`/`document.getElementById(...)`/`_renderNow`
    live.
  - Add the Part 4 three-state check as the first real branch inside
    `downloadRepeatOffendersPdf`, after the existing
    `_repeatOffendersPdfGenerating` re-entrancy guard (unrelated, stays
    as-is).
  - **Verify**: (a) export immediately after a filter change completes
    normally and produces a PDF matching the screen — the common case,
    must keep working; (b) manually simulate the race — start a
    recalculation, click "Download PDF" before it finishes (throttle
    CPU in DevTools, or filter on a combination known to take a few
    seconds against real data, to actually open the window) — confirm
    the new state-2 message appears instead of a silently-mismatched
    export; (c) click "Download PDF" on a completely fresh page load,
    before any calculation has ever run — confirm the new state-1
    message appears instead of a crash or a stale/empty PDF. Commit on
    its own, separate from Step 1.

**Step 3 — UX: disable the PDF button while stale (Part 4's
recommended addition).**
  - Disable `repeatOffendersDownloadPdfBtn` at the top of
    `runRepeatOffendersRecalculation` (mirroring how the "Recalculate"
    button already disables itself); re-enable it in
    `_renderRepeatOffendersResult` once the new cache entry lands.
  - **Verify**: button visibly greys out during a real multi-second
    recalculation, re-enables the moment the table updates. Commit on
    its own — this step is UX polish, not correctness, so isolating it
    means Step 2's correctness fix can ship (and be reverted
    independently, if ever needed) without depending on this one.

**Step 4 — Regression tests (Part 6).** Add the Part 6 test suite to
`tests/frontend-harness.html` immediately after Step 2 lands, before
Step 3 — specifically including a test that reproduces the race against
a **checked-out pre-Step-2 copy of the code first**, confirming it
actually fails there, before confirming it passes against the fixed
code. This is the same reproduce-before-fix discipline this project's
own `.gs` test suites already follow, applied here for the first time
to a `js/*.js` frontend bug. Full detail in Part 6.

**Step 5 — Final cleanup + full verification pass (Part 7).** Confirm
no dead parameters remain (e.g. `_repeatOffendersPdfSectionTables`'s old
`dateKeys`-only signature fully replaced, not left as an unused
alternate path); run the complete `tests/frontend-harness.html` suite;
do one full manual pass in the Browser pane across every filter
combination named in Part 6's test list.

### Why this order satisfies the stated priorities

- **Correctness first**: Step 1 (the cache existing and being correct)
  must be verified before Step 2 (anything actually depending on it) —
  a wrong cache shape caught at Step 1 is a no-op bug; caught at Step 2
  it's a live, user-facing PDF bug.
- **Minimal duplication**: Step 2 *replaces* the PDF's calculation call
  outright, in the same commit that adds its dependency on the cache —
  there is never a commit where both the old (independent) and new
  (cache-based) PDF logic coexist.
- **Backward compatibility**: `core-rm-performance.js` itself is never
  touched by any step — the engine Part 1 already found correct stays
  exactly as it is; only its two callers change.
- **Testability**: every step has its own explicit verification before
  the next begins, and Step 4 is deliberately sequenced right after the
  real fix (Step 2), not deferred to the very end, so regression
  coverage exists before the UX-only Step 3 and cleanup-only Step 5 are
  layered on top.
- **Performance**: the end state is strictly cheaper than today — one
  Stage 1-4 calculation per filter/range change instead of two (the
  live tab's Worker run plus whatever the PDF used to trigger
  independently) — Step 2 removes work, it doesn't add any.

*(Part 5 complete. Continues in Part 6 — comprehensive test strategy +
risks/edge cases.)*

## Part 6 — Comprehensive Test Strategy + Risks/Edge Cases

Grounded in `tests/frontend-harness.html`'s **real, existing**
conventions (confirmed by reading it directly, not assumed): a global
`assert(name, cond, detail)` helper; the real `dashboard.html` + every
`js/*.js` file loaded live; `Date` frozen to a fixed instant
(`2026-09-09T14:00:00+05:30`); save-mutate-restore-in-`finally` around
any global this suite temporarily overrides (`movementSnapshots`,
`movementFetchState`, `rmHierarchyFetchState`, a status element's own
`textContent`) — the existing test at line 419-439
(`downloadRepeatOffendersPdf: refuses to generate while RM_Hierarchy is
still loading`) is the **direct precedent and pattern template** for
every new race-condition test below; it already proves this exact style
of async-gate regression test works in this harness.

Per Part 5's migration plan (Step 4), the tests below are **specified
here**, ready to transcribe into `tests/frontend-harness.html` in that
same style; they get physically added once Part 7 lands the real Step
1/2 code, immediately after — not before, since several of them assert
against APIs (`_repeatOffendersLastResult`, the redesigned
`_repeatOffendersPdfSectionTables` signature) that don't exist until
then.

### J. Comprehensive Test Plan

**Filter correctness** (mostly reconfirming Part 1's finding that
filtering itself already works — worth locking down explicitly since
the original bug report's own words were "Source and Sub Source"):

1. **Source filter alone** — two synthetic leads differing only in
   `group_source`; filtering to one Source reduces `distinctLeads` to
   exactly that source's lead(s), for RM, Region, and byRegion rollups
   alike.
2. **Sub-source filter alone** — same shape, keyed on `source_bucket`.
3. **Multiple filters together** (Region + Source) — combined
   restriction is AND, not OR: a lead matching Region but not Source is
   excluded, and vice versa.
4. **A lead with multiple Movement_Log copies** (same `client_id`, two
   `lead_id`s, per Part 2 Rule 1) — each copy counts independently
   toward Unique Leads; a filter matching only one copy's own raw
   field values excludes the other copy without affecting the first.
5. **A lead whose raw records span multiple `source_bucket` values
   across different captured days** (Part 2 Rule 5) — the lead
   contributes an observation on the days its OWN captured value passed
   the filter, and correctly contributes none on days it didn't — not
   an all-or-nothing per-lead gate.
6. **A filter combination producing zero results** — `computeRmPerformance`
   returns `[]` for every rollup; confirm the live tab's own
   already-existing empty-state message renders (partially covered
   already by this harness's documented "graceful empty-history path"
   coverage, line 49 — this test specifically forces it via an
   impossible filter combination rather than an empty dataset).

**The actual fix — race-condition regression coverage (the heart of
this redesign):**

7. **PDF export attempted while a recalculation is in flight** — seed
   `movementSnapshots`, trigger a recalculation (or directly bump
   `_repeatOffendersRunId` past whatever `_repeatOffendersLastResult.runId`
   currently is, to deterministically simulate "in flight" without
   depending on real Worker timing), call `downloadRepeatOffendersPdf()`,
   assert the Part 4 state-2 message appears in `#repeatOffendersPdfStatus`
   and that `doc.save` is never reached (stub/spy `window.jspdf.jsPDF`
   or count calls into `_repeatOffendersPdfRenderPages`).
8. **PDF export before any calculation has ever completed** —
   `_repeatOffendersLastResult === null`; assert the Part 4 state-1
   message, same no-`doc.save` assertion as #7.
9. **PDF values match the screen exactly, for the same completed
   calculation** — the specific assertion the original brief names
   explicitly. Seed a known fixture, run `renderRepeatOffenders()` to
   completion (await it, same as this harness's own existing
   `fetchAndRender` pattern), read the rendered Unique Leads/Score/
   Instances/Region text directly out of `#repeatOffendersBody`'s DOM
   for one known RM, then build that same RM's PDF row via the
   redesigned `_repeatOffendersPdfTableRows`/`_repeatOffendersPdfSectionTables`
   (called directly, not through a real file download) and assert every
   field matches the DOM text byte-for-byte.
10. **A filter changes again while a previous filter change's
    recalculation is already in flight** — the superseded run's
    eventual completion must never overwrite the cache with stale data.
    The existing `onmessage`/`onDone` guard (`if (runId !==
    _repeatOffendersRunId) return;`, already present, unrelated to this
    redesign) already protects the DOM render from this; this test
    specifically confirms `_repeatOffendersLastResult` also ends up
    reflecting the LATEST request, not an intermediate superseded one —
    a real gap the existing guard alone doesn't obviously cover for a
    NEW piece of state.

**Fallback-path parity:**

11. **The non-Worker synchronous fallback populates the cache
    correctly too** — force `_runRepeatOffendersSynchronously`
    (`tab-repeat-offenders.js:398`) by making `new Worker(...)` throw
    (the same technique this fallback path already exists to handle —
    "a locked-down environment, or this file opened directly over
    file://"), confirm `_repeatOffendersLastResult` still populates with
    the correct shape and the PDF still works against it — since Part
    5's Step 1 change lives in `_renderRepeatOffendersResult`, shared by
    both the Worker and fallback paths, this is a real parity check, not
    a redundant one.

### K. Risks and Edge Cases Beyond the Test Plan

- **Rapid, repeated filter toggling extends the wait, by design.**
  Each toggle bumps `_repeatOffendersRunId` and supersedes whatever was
  already in flight (test #10 above) — correct, but a user rapidly
  clicking through several filter combinations will see the PDF button
  stay blocked/disabled for longer than any single recalculation takes.
  Not a defect — the alternative (letting a stale run's result populate
  the cache) is exactly the bug being fixed — but worth calling out so
  it isn't mistaken for a new problem during Part 7 verification.
- **The synthetic test harness cannot reproduce the real ~12-15s race
  window by timing alone.** Every fixture in this harness completes
  near-instantly; tests #7 and #10 above simulate "in flight" by
  directly manipulating `_repeatOffendersRunId`/`_repeatOffendersLastResult`
  rather than by genuinely racing a slow calculation. This is a
  legitimate, deterministic way to test the *mechanism*, but it doesn't
  replace a real manual check against real data volume (Part 7 should
  do at least one manual reproduction, CPU-throttled or against a
  filter combination known to take real seconds, per Part 5 Step 2's
  own verification note) — stated honestly here rather than implying
  the automated suite alone proves the real-world race is closed.
- **The non-Worker fallback still blocks the main thread for the full
  calculation duration** — pre-existing behavior, unrelated to and
  unworsened by this redesign, since it was never Worker-based to begin
  with. Noted for completeness, not treated as in-scope to fix here.
- **The deliberate divergence between `passesRepeatOffenderFilters` and
  `passesFilters`/`passesMovementFilters`** (Part 1's anti-pattern
  table, Part 3's ownership table) — a Loan-sourced lead's Region-filter
  behavior specifically is **not** covered by this test plan, because
  it's a known, narrow, pre-existing, intentionally out-of-scope
  limitation (Movement_Log's raw `region` field vs. `effectiveRegion()`'s
  cross-field inference) — not something this redesign changes. Stated
  explicitly so its absence from the test list reads as a deliberate
  scoping decision, not an oversight.
- **Tab navigation away from Repeat Offenders mid-calculation** —
  already handled by existing code (`renderAll()` calls
  `renderRepeatOffenders()` regardless of which tab is currently
  visible; the Worker keeps running or is `terminate()`d by the existing
  run-superseding logic) — unaffected by this redesign, not a new risk
  it introduces.

*(Part 6 complete. Continues in Part 7 — final recommendation, real
implementation, and verification.)*

## Part 7 — Final Recommendation, Real Implementation, and Verification

Part 5's migration plan was executed for real, on `master`, one commit
per step, each verified in the browser before the next began:

| Step | Commit | What changed | Verification |
|---|---|---|---|
| 1 | `8fa3895` | Added `_repeatOffendersLastResult`, threaded `range`/`now`/`dateKeys` through the ctx chain, populated the cache in `_renderRepeatOffendersResult` | 59/59 existing tests unchanged; directly confirmed in the browser that the cache populates with the full expected shape after a real render |
| 2 | `9dea24a` | `_repeatOffendersPdfSectionTables`/`_repeatOffendersPdfCurrentFilterInfo`/`_repeatOffendersPdfFilterSummaryLine` rewritten to read the cache; `downloadRepeatOffendersPdf` gained the 3-state check; every `computeRmPerformance`/`computeRmPerformanceByRegion` call removed from `repeat-offenders-pdf.js` | 59/59 unchanged; **directly confirmed the actual fix**: a real 6-lead fixture's DOM row ("Verify RM", 6 Unique Leads, "2.50 / 2.50" Score) and the PDF row built from the same cached object matched byte-for-byte: `["1","Verify RM","6","2.50 / 2.50","12","Verify Region"]` |
| 3 | `a74a65f` | "Download PDF" button disables the instant a recalculation starts, re-enables when the cache updates | Confirmed disabled synchronously right after triggering (before the async Worker could possibly have replied), confirmed re-enabled after completion |
| 4 | `4b420b2` | All 11 Part 6 tests written for real into `tests/frontend-harness.html` | **76/76 tests passing** (up from 59) — confirmed both locally (dashboard dev server, fresh browser tab) and in real CI (the `frontend-harness` GitHub Actions job) |
| 5 | (this commit) | Final cleanup + verification pass | No dead references to the old PDF function signatures found (grepped); `dashboard.html` itself loads with zero JS errors beyond the expected, pre-existing, harmless unauthenticated-Sheets-API 401 |

**A real bug was found and fixed during Step 4 — in the new test code,
not in the redesign itself.** The first draft of Test 8 ("PDF export
before any calculation has completed") forgot to seed a non-empty
`movementSnapshots`, so the pre-existing "Movement_Log itself hasn't
loaded" guard fired before the new state-1 check was ever reached,
producing the wrong status message and masking what the test was
actually meant to prove. Caught by actually running the suite (75/76,
1 failure) rather than assuming the test was correct because it looked
right — fixed by seeding a minimal fixture, re-ran, 76/76.

### An honest limitation, stated plainly rather than glossed over

Per Part 6's own risk note: **the real ~12-15s race window this whole
redesign closes could not be reproduced by genuine timing** in either
the browser dev-server check or the automated suite — every synthetic
fixture here completes near-instantly. Tests 7 and 10 (and the manual
verification in Step 2) simulate "a recalculation is in flight" by
directly manipulating `_repeatOffendersRunId`/`_repeatOffendersLastResult`
rather than by genuinely racing a slow calculation against a real
click. This is a legitimate, deterministic way to test the *mechanism*
the fix relies on (the run-id comparison, the cache being read instead
of recomputed) — and Step 2's byte-for-byte DOM-vs-PDF comparison is
real, direct proof the values agree — but it is not the same as
clicking "Download PDF" a half-second after toggling a filter against
the real, ~232k-row production `Movement_Log` and watching it not
diverge. That specific manual check requires a signed-in Google session
against the real spreadsheet, which this environment does not have.
**Recommended as a follow-up, by whoever next has that access**: toggle
a filter on the real dashboard, immediately click "Download PDF" before
the table finishes recalculating, and confirm the button is disabled /
the status message appears, rather than a mismatched PDF downloading.

### L. Final Recommendation

**Adopt the redesign — it is real, tested, and already on `master`.**
The root cause (a second, independent, synchronous calculation racing
the live tab's asynchronous one) is closed by construction: there is
now exactly one calculation per filter/range change, cached once, read
by both the screen and the PDF. 76/76 tests passing, 5/5 CI checks
green on every one of the 4 implementation commits.

**One thing named in the original brief that does not literally apply
to this codebase, stated honestly rather than forced to fit**: several
of the brief's requirements (API boundaries, frontend/backend
disagreement, repeated database/API queries) assume a client/server
split. This dashboard has none — `dashboard.html` + `js/*.js` is a
single static page reading Google Sheets directly from the browser, with
`Movement_Log` fetched once per page load and held in memory
thereafter. There was no "backend" to redesign, and no repeated network
query to eliminate — the actual duplication was entirely in
client-side *computation*, which Part 1 identified precisely and this
redesign closes precisely.

**Deployment note, same fact Part 5 already flagged**: unlike this
project's `.gs` files, these changes are already live — `dashboard.html`/
`js/*.js` auto-deploy via GitHub Pages on every push to `master`, and
every commit above has already been pushed. No further deployment step
is needed for this fix, unlike the separate Lead History & Versioning
Review's Apps Script changes.

*(Part 7 complete. Repeat Offenders Architecture Redesign complete —
7 of 7 parts.)*
