# JS-008 — core-rm-performance.js

| | |
|---|---|
| **Type** | `JS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `js/core-rm-performance.js` (869 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

Ranking RMs on raw flag counts punishes whoever holds the most leads.
This module is the fair version: it reconstructs, from `Movement_Log`
history, per-(lead, day, rule) eligibility/violation observations,
aggregates them per RM, applies **empirical-Bayes shrinkage toward a
peer average** (weighted by distinct-eligible-lead count), severity-
weights the rules, and classifies each RM. It backs the Repeat Offenders
tab (`TAB-004`) and its PDF (`JS-013`). It exists so "repeat offender"
means "consistently and disproportionately off-SLA," not "busy."

## Responsibilities

- `reconstructRmPerformanceObservations` → `aggregateRmPerformance` →
  `computeRmPerfPeerAverages` → `classifyRmPerformance` → the pipeline
  `computeRmPerformance` runs.
- `computeRmPerformanceByRegion` — the additional per-region worst-5
  breakdown (added this session).
- RM identity normalisation (`rmPerfCanonicalRmName` + aliases) and
  leadership exclusion (`rmPerfIsLeadershipExcluded`).
- Sort/filter helpers (`sortRmPerformanceByPriority`/`ByScore`,
  `filterRmPerformanceWorst`/`Rankable`, `rmPerformanceDrivenBy`).

## Load order / position

Loads **late**, interleaved with the tab files — not among the first 9,
despite CLAUDE.md's documented order (`LOGIC_AUDIT.md` Part 1 §4a;
harmless — nothing at parse time calls into it).

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-052 | `computeRmPerformance(dateKeys, keyFn, filters, rmHierarchyByNameLower)` `#L692` | date keys, a group key fn (RM or Region), filters, hierarchy map | `[{group, …score, classification, drivenBy}]` | none (pure) | FN-053..FN-056 | worker (`JS-017`), sync path (`JS-022`), `JS-013` | reusable — the engine entry |
| FN-053 | `reconstructRmPerformanceObservations(dateKeys, keyFn, filters, rmHierarchyByNameLower)` `#L406` | as above | per-(lead,day,rule) observation list | none | `movementSnapshots` (`JS-021`), `enrichSnapshotCached`, `passesRepeatOffenderFilters` (FN-057) | FN-052 | specific |
| FN-054 | `aggregateRmPerformance(observations)` `#L494` | observations | per-group violation/eligibility totals | none | — | FN-052 | specific |
| FN-055 | `computeRmPerfPeerAverages(byGroup)` `#L561` | grouped totals | peer-average baseline per rule | none | — | FN-052 | specific |
| FN-056 | `classifyRmPerformance(byGroup)` `#L598` | grouped totals + peer averages | classification (`Below Expectations` / `Insufficient Data` / …) + shrunk score + chronic-streak flag | none | `RM_PERF_*` constants | FN-052 | specific |
| FN-057 | `passesRepeatOffenderFilters(rec, filters)` `#L186` | a record + this report's filter set | bool | none | `mainRegionFor` (`JS-014`) | FN-053 | specific — **not** `passesMovementFilters`; no `effectiveRegion` Loan inference (`LOGIC_AUDIT.md` Part 4/6) |
| FN-058 | `computeRmPerformanceByRegion(dateKeys, filters, rmHierarchyByNameLower)` `#L730` | date keys, filters, hierarchy map | `[{region, list}]` — worst-5 RMs per region, region-scoped peer average, regions with ≥1 rankable RM only | none | FN-052 (Region pass to discover regions, then RM pass per region), `mainRegionFor` (`JS-014`) | worker (`JS-017`), sync path (`JS-022`) | specific — added this session |
| FN-059 | `rmPerfCanonicalRmName(rawName)` `#L320` | a raw RM name | canonical name (via `RM_PERF_NAME_ALIASES`) | none | — | FN-053, FN-060 | reusable |
| FN-060 | `rmPerfIsLeadershipExcluded(rmName, rmHierarchyByNameLower)` `#L360` | RM name + hierarchy map | bool — true for A1/TM/RH/Cluster Head/City Lead/Commercial Head roles or the name-based leadership set | none | `RM_PERF_NON_RM_ROLES`, `RM_PERF_LEADERSHIP_NAME_EXCLUSIONS` | FN-053, FN-058, `JS-013` | reusable |
| FN-061 | `rmPerfPrimaryManagerFor` / `rmPerfRhFor(rmName, map)` `#L203/#L208` | RM name + map | manager / RH name | none | — | `rmPerformanceHierarchyCells` (FN-063) | reusable |
| FN-062 | `repeatOffendersRegionKey(rec)` `#L222` | a record | region bucket — Loan iff `group_source` says Loan, else `mainRegionFor(rec.region)` | none | `normRegionKey` / `mainRegionFor` (`JS-014`) | FN-058, `JS-013` | reusable — Loan detection via `group_source` ONLY (Movement_Log has no `project_region`) |
| FN-063 | `rmPerformanceDrivenBy(r)` / `rmPerformanceHierarchyCells(r, map)` `#L770/#L798` | a result row | the "driven by" contributor list / hierarchy cells | none | FN-061 | table + PDF renderers | reusable |
| FN-064 | `sortRmPerformanceByPriority` / `ByScore` / `filterRmPerformanceWorst` / `filterRmPerformanceRankable(list)` `#L826/#L839/#L851/#L867` | a result list | sorted / filtered list | none | — | `JS-022`, `JS-013` | reusable |

## Config constants — `CFG-XXX` sub-table

| ID | Constant | Value | Meaning | Changing it affects |
|---|---|---|---|---|
| CFG-013 | `RM_PERF_RULE_WEIGHTS` `#L68` | `isNotUpdated 1.5`, `followupOverdue 1.2`, `underCalledToday 1.0` | per-rule severity weights | the composite score; **twin `RM_PERF_RULE_WEIGHTS_GS_` (`GS-003`)** |
| CFG-014 | `RM_PERF_SHRINKAGE_K` `#L84` | `8` | empirical-Bayes shrinkage strength | score smoothing; twin in `GS-003` |
| CFG-015 | `RM_PERF_MIN_VOLUME_LEADS` `#L90` | `5` | below this many distinct eligible leads → "Insufficient Data" | which RMs are rankable; twin `RM_PERF_MIN_VOLUME_LEADS_GS_` |
| CFG-016 | `RM_PERF_CHRONIC_STREAK_DAYS` `#L97` | `3` | consecutive-day streak → "chronic" flag | the chronic marker; twin in `GS-003` |
| CFG-017 | `RM_PERF_FLAG_RATIO` `#L102` | `1.25` | how far above peer average = "Below Expectations" | classification cutoff; twin in `GS-003` |
| CFG-018 | `RM_PERF_CONCENTRATION_BREADTH_CEILING` `#L118` | `0.25` | violated leads must be ≤25% of the eligible book to count as "concentrated" | classification; twin in `GS-003` |
| CFG-019 | `REPEAT_OFFENDERS_REGION_RM_CAP` `#L729` | `5` | worst-N per region in `computeRmPerformanceByRegion` | `TAB-004`'s per-region breakdown only (client, no `.gs` twin) |
| CFG-020 | `RM_PERF_NON_RM_ROLES` `#L344` | `{a1, tm, rh, cluster head, city lead, commercial head}` | roles excluded from "RM" | `rmPerfIsLeadershipExcluded` (FN-060); mirrors `RmHierarchy.gs` `TOP_OF_ORG_ROLES_` |
| CFG-021 | `RM_PERF_NAME_ALIASES` `#L306` / `RM_PERF_LEADERSHIP_NAME_EXCLUSIONS` `#L257` | name→canonical map / name set | RM identity normalisation + name-based leadership exclusion | ranking membership |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-014 | `movementSnapshots` undefined / empty at compute time | `reconstructRmPerformanceObservations` returns `[]` `#L408` | Repeat Offenders shows "no data"; PDF export refuses (`JS-013` EXC) |
| EXC-015 | RM below `RM_PERF_MIN_VOLUME_LEADS` | classified "Insufficient Data", excluded from worst-first lists | RM not shown in the leaderboard |

## Business rules implemented — `RULE-XXX` sub-table

| ID | Rule | Where | Duplicated in (`GS-XXX`)? | Notes |
|---|---|---|---|---|
| RULE-013 | Score = severity-weighted violation rate, shrunk toward the peer average with strength `K`, weighted by distinct-eligible-lead count (not lead-days) | FN-054..FN-056 | **Yes — `DailyRmIssueLog.gs` `reportRmPerformanceNow`** (`GS-003`); `RM_PERF_*` constants must stay numerically identical (`LOGIC_AUDIT.md` Part 1 §4b) | console-only on the backend |
| RULE-014 | "RM" = anyone **not** A1/TM/RH/Cluster Head/City Lead/Commercial Head and not in the name-based leadership set | FN-060 | partial — `RmHierarchy.gs` `TOP_OF_ORG_ROLES_` = the last 3 | broadened this session (`7ef26db`) after managers appeared in the per-region worst-5 |
| RULE-015 | Per-region worst-5 uses a **region-scoped** peer average and lists only regions with ≥1 rankable RM | FN-058 | No — client-only feature | added this session (`812a3cb`) |
| RULE-016 | Loan bucket is decided by `group_source` only; `Movement_Log` has no `project_region`, so Loan leads tagged via `project_region` never bucket as "Loan" here | FN-062 | related to the HIGH finding in `GS-*` (`LOGIC_AUDIT.md` Part 4 §4.4) | known gap |

## Data lineage

`Movement_Log` (`SHEET-002`) → `movementSnapshots` (state, `JS-021`) →
`enrichSnapshotCached` per snapshot → `reconstructRmPerformanceObservations`
(FN-053) → `aggregateRmPerformance` → peer averages → `classifyRmPerformance`
→ result rows → `TAB-004` tables / `JS-013` PDF. Runs off-thread in
`JS-017`. Full flow: `DATA-002` (SLA-flag pipeline, history side) +
`DATA-004`.

## Data sources accessed

Reads `movementSnapshots` (from `SHEET-002`) and the
`rmHierarchyByNameLower` map (from `SHEET-006`, via `JS-022`). No direct
Sheet read.

## Data written / modified

None — pure computation, no DOM, no Sheet.

## Failure / error behaviour

Returns `[]` on missing input rather than throwing. Runs in a Web Worker
(`JS-017`) so a slow compute never blocks the main thread.

## Cross-runtime duplication

`RM_PERF_*` constants + the scoring math ↔ `DailyRmIssueLog.gs`'s
`RM_PERF_*_GS_` + `reportRmPerformanceNow` (`GS-003`). The backend's own
comment says the constants "must stay numerically identical." The
per-region worst-5 (`FN-058`, `CFG-019`) has **no** `.gs` twin — it is
client-only.

## UI relationships

No buttons. Feeds `TAB-004`'s leaderboards and per-region breakdown, and
`JS-013`'s PDF. `#repeatOffendersRecalculateBtn` (`BTN-010`) triggers a
recompute via the worker.

## Architecture relationship

`DASH-001`. Layer 6 (Business logic — client) in `LOGIC_AUDIT.md` Part 1
§1.

## Related documentation

`HANDOVER.md` §6, §9 (Repeat Offenders subsystem); `OPS_CHECKLIST.md`
(worst-performer methodology drift); `LOGIC_AUDIT.md` Part 1 §4b, Part 3
§3.6, Part 4 §4.4; this session's fix commits `fef04b0` / `7ef26db` /
`812a3cb` / `8d9acbc`.

## Relationships

- **Depends On:** `JS-005` (`CONFIG`, IST helpers), `JS-006`
  (`parseDate`), `JS-021` (`movementSnapshots`, `buildMovementHistories`,
  `enrichSnapshotCached`), `JS-022` (`passesRepeatOffenderFilters` is
  here but the filter *state* comes from the tab; `rmHierarchyByNameLower`
  map), `JS-014` (`mainRegionFor`), `SHEET-002`, `SHEET-006`
- **Used By:** `JS-017` (worker), `JS-022` (sync path), `JS-013` (PDF),
  `TAB-004`
- **Related:** `GS-003` (`DailyRmIssueLog.gs` — the `.gs` console mirror)

## Source of truth

`js/core-rm-performance.js` at `HEAD`.

## Validation

- **Method:** full read at `c82ec67`; function + constant list verified
  by grep; cross-check `LOGIC_AUDIT.md` Part 3 §3.6. The RM-exclusion,
  alias, and per-region worst-5 behaviour was **hand-verified against
  live data this session** while landing `fef04b0` / `7ef26db` /
  `812a3cb` / `8d9acbc`. `tests/frontend-harness.html` exercises
  `computeRmPerformance` on synthetic snapshot histories.
- **Evidence:** `LOGIC_AUDIT.md` Part 3 §3.6; this session's fix commits;
  `tests/frontend-harness.html`.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-027. **File nearly doubled
this session** (485L on 2026-09-05 → 869L) — alias handling, broadened
leadership exclusion, and `computeRmPerformanceByRegion`.

## Revalidation trigger

Any commit touching `js/core-rm-performance.js`; **any `RM_PERF_*`
constant changes value** (requires the `RM_PERF_*_GS_` twin in `GS-003`
to change — `HANDOVER.md` §6); `RM_PERF_NON_RM_ROLES` / alias set
changes; `computeRmPerformanceByRegion` region-scoping logic changes;
`movementSnapshots` shape changes.

## Handover relationship

`HANDOVER.md` §6 lists the RM-performance constant pair; §9 covers the
subsystem. §9 is current as of 2026-09-09 but predates this session's
engine growth by a day — a methodology change here should refresh §9. A
constant change must update `HANDOVER.md` §6 and `DailyRmIssueLog.gs` in
the same commit, and run `OPS_CHECKLIST.md`'s worst-performer items.

## Lifecycle / retention

N/A — code. Its history source `SHEET-003` retains 7 days.

## Next action

none — Closed + Monitored.

## Closure evidence

Record committed for DOC-027; `docs/INDEX.md` `JS-008` → `Closed +
Monitored`, `Last Verified` 2026-09-10, links filled; `CFG-013`..`021`,
`RULE-013`..`016`, `EXC-014`/`015` recorded. No `docs/changes/` record
(DOC-027).
