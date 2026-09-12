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
