# JS-008 — core-rm-performance.js

| | |
|---|---|
| **Type** | `JS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `js/core-rm-performance.js` (1340 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Validated |
| **Last Verified** | 2026-09-30 against commit `(pending commit)` — posterior-confidence flagging added (HANDOVER.md §9.7.5, FN-056/FN-314/FN-317/FN-318, CFG-077/078, RULE-037) |

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
- **RM Opp-Conversion engine** (added 2026-09-29, HANDOVER.md §9.7.3) —
  `reconstructRmOppCohort` → `aggregateRmOppConversion` →
  `computeRmOppPeerAverages` → `classifyRmOppConversion` →
  `joinRmOppConversion`/`computeRmPerformanceWithOpp`: a SEPARATE,
  parallel Same-Day/48h Opp-conversion signal joined onto the violation
  engine's output at display time (`doubleFlag` when BOTH are bad).
  Browser-only, no `.gs` twin by design — see this file's own "RM
  Opp-Conversion engine" header comment.
- **Posterior-confidence flagging** (added 2026-09-30, HANDOVER.md
  §9.7.5) — `rmPerfNormalCdf`/`rmPerfBetaPosteriorVariance`: shared math
  both `classifyRmPerformance` and `classifyRmOppConversion` gate their
  elevated/`lowConversion` decision on, instead of a raw point-estimate
  comparison. Fixes small-sample under-flagging (narrow filters collapse
  per-RM `n` to 5-16 leads, where shrinkage alone can mask a genuinely
  elevated rate). `rmPerfConfidenceLabel` is the shared display helper.

## Load order / position

Loads **late**, interleaved with the tab files — not among the first 9,
despite CLAUDE.md's documented order (`LOGIC_AUDIT.md` Part 1 §4a;
harmless — nothing at parse time calls into it).

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-052 | `computeRmPerformance(dateKeys, keyFn, filters, rmHierarchyByNameLower)` `#L846` | date keys, a group key fn (RM or Region), filters, hierarchy map | `[{group, …score, classification, drivenBy}]` | none (pure) | FN-053..FN-056 | worker (`JS-017`), sync path (`JS-022`) — **no longer `JS-013`** as of 2026-09-12 (the "PDF reads the cache, never recomputes" redesign, `9dea24a`): the PDF now reads `JS-022`'s `_repeatOffendersLastResult` cache instead of calling this a second time; see `JS-013`'s own record | reusable — the engine entry |
| FN-053 | `reconstructRmPerformanceObservations(dateKeys, keyFn, filters, rmHierarchyByNameLower)` `#L529` | as above | per-(lead,day,rule) observation list | none | `movementSnapshots` (`JS-021`), `enrichSnapshotCached`, `passesRepeatOffenderFilters` (FN-057) | FN-052 | specific |
| FN-054 | `aggregateRmPerformance(observations)` `#L617` | observations | per-group violation/eligibility totals | none | — | FN-052 | specific |
| FN-055 | `computeRmPerfPeerAverages(byGroup)` `#L684` | grouped totals | peer-average baseline per rule | none | — | FN-052 | specific |
| FN-056 | `classifyRmPerformance(byGroup)` `#L721` | grouped totals + peer averages | classification (`Below Expectations` / `Insufficient Data` / …) + shrunk score + chronic-streak flag + `confidence`/`compositeVariance` (added 2026-09-30, HANDOVER.md §9.7.5) | none | `RM_PERF_*` constants, FN-317 | FN-052 | specific — classification now gated on posterior confidence, not the raw point estimate; see HANDOVER §9.7.5 for why the threshold sits below 0.5 |
| FN-057 | `passesRepeatOffenderFilters(rec, filters)` `#L234` | a record + this report's filter set | bool | none | `mainRegionFor` (`JS-014`) | FN-053 | specific — **not** `passesMovementFilters`; no `effectiveRegion` Loan inference (`LOGIC_AUDIT.md` Part 4/6) |
| FN-058 | `computeRmPerformanceByRegion(dateKeys, filters, rmHierarchyByNameLower, opts)` `#L892` | date keys, filters, hierarchy map, optional `{oppCohort}` (added 2026-09-29) | `[{region, list}]` — worst-5 RMs per region, region-scoped peer average, regions with ≥1 rankable RM only; each row also carries `opp`/`doubleFlag` when `opts.oppCohort` is passed | none | FN-052 (Region pass to discover regions, then RM pass per region), `mainRegionFor` (`JS-014`), FN-312/FN-315 when `opts.oppCohort` given | worker (`JS-017`), sync path (`JS-022`) | specific — `opts` optional, omitting it preserves pre-2026-09-29 behavior exactly |
| FN-311 | `reconstructRmOppCohort(dateKeys, filters, rmHierarchyByNameLower, nowMs)` `#L1002` (added 2026-09-29) | date keys, filters, hierarchy map, explicit "now" in ms | `[{rec, lead_id, createdMs, sameDayOpp, windowComplete, opp48h}]` — one entry per Movement_Log lead-copy assigned in range, first-capture-lag-guarded | none (pure) | `buildMovementHistories`/`splitHistoryByCopy`/`evidenceAtDeadline` (`JS-021`), FN-057, FN-060 | FN-312, FN-315 (via `computeRmPerformanceWithOpp`) | specific — `nowMs` REQUIRED, never `Date.now()` internally (Worker clock mismatch, see HANDOVER.md §9.7.3) |
| FN-312 | `aggregateRmOppConversion(cohort, keyFn)` `#L1060` (added 2026-09-29) | FN-311's cohort + optional group-key fn | `Map<name, {cohortLeads, sameDayResolved, sameDayOpp, windowComplete, resolved48h, opp48h}>` | none | — | FN-314, FN-315 | specific — same `keyFn(rawRecord)` convention as FN-053 |
| FN-313 | `computeRmOppPeerAverages(byGroup)` `#L1089` (added 2026-09-29) | FN-312's grouped totals | `{sameDay, h48}` volume-weighted pooled rates | none | — | FN-314 | specific |
| FN-314 | `classifyRmOppConversion(byGroup)` `#L1108` (added 2026-09-29; confidence gate added 2026-09-30) | FN-312's grouped totals | `{basis, peer, byName: Map<name, {…, shrunk, sufficient, lowConversion, confidence}>}` | none | FN-313, FN-317, `RM_OPP_*` constants | FN-315 | specific — `lowConversion` now gated on posterior confidence (`RM_OPP_CONFIDENCE_THRESHOLD`), not the raw shrunk-rate comparison; see HANDOVER §9.7.5 |
| FN-315 | `joinRmOppConversion(perfRows, oppClassified)` / `computeRmPerformanceWithOpp(dateKeys, keyFn, filters, rmHierarchyByNameLower, oppCohort)` `#L1158/#L1172` (added 2026-09-29) | violation-engine rows + FN-314's classification / same params as FN-052 plus a pre-built cohort | rows with `opp`/`oppBasis`/`oppPeer`/`doubleFlag` added, every existing field unchanged | none (pure) | FN-052, FN-312, FN-314 | worker (`JS-017`), sync path (`JS-022`), FN-058 | specific — deliberately does NOT touch `classifyRmPerformance`'s own 4-tier output (see HANDOVER.md §9.7.3's "parallel signal, not a 5th tier" decision) |
| FN-316 | `rmOppDisplayCells(r)` `#L1189` (added 2026-09-29) | a joined row | `{sameDay, h48, lowConversion, basis}` display strings | none (pure) | — | table (`JS-022`) + PDF (`JS-013`) renderers | reusable — shared so the two surfaces can't disagree, same precedent as FN-063 |
| FN-317 | `rmPerfNormalCdf(z)` / `rmPerfBetaPosteriorVariance(peer, raw, n, K)` `#L477/#L498` (added 2026-09-30) | a z-score / a Beta-posterior's parameters | standard-normal CDF probability / the posterior's variance | none (pure) | — | FN-056, FN-314 | reusable — the shared posterior-confidence math both classifiers gate on; BYTE-FOR-BYTE ported to `DailyRmIssueLog.gs`'s `rmPerfNormalCdfGs_`/`rmPerfBetaPosteriorVarianceGs_` (`GS-003`), kept in parity by hand + identical reference-value tests (functions, not parseable by `check-runtime-parity.py`) |
| FN-318 | `rmPerfConfidenceLabel(r)` `#L1210` (added 2026-09-30) | a classified row | `'NN% confidence'` or `''` | none (pure) | `RM_OPP_ELEVATED_CLASSIFICATIONS` | table (`JS-022`) + PDF (`JS-013`) renderers | reusable — only non-empty for an elevated (Below Expectations/Watch) row with a non-null confidence; shared so the two surfaces can't disagree, same precedent as FN-063/FN-316 |
| FN-059 | `rmPerfCanonicalRmName(rawName)` `#L368` | a raw RM name | canonical name (via `RM_PERF_NAME_ALIASES`) | none | — | FN-053, FN-060 | reusable |
| FN-060 | `rmPerfIsLeadershipExcluded(rmName, rmHierarchyByNameLower)` `#L440` | RM name + hierarchy map | bool — true for A1/TM/RH/Cluster Head/City Lead/Commercial Head roles, the name-based leadership set, a Futwork vendor-name pattern match, or the admin name set (added 2026-09-29; function name predates these last two, kept as-is) | none | `RM_PERF_NON_RM_ROLES`, `RM_PERF_LEADERSHIP_NAME_EXCLUSIONS`, `RM_PERF_VENDOR_NAME_PATTERN`, `RM_PERF_ADMIN_NAME_EXCLUSIONS` | FN-053, FN-058, FN-311 (the Opp-conversion cohort reuses this same exclusion) — **no longer `JS-013`** (that PDF no longer calls this directly since the 2026-09-12 cache-read redesign, `9dea24a`) | reusable |
| FN-061 | `rmPerfPrimaryManagerFor` / `rmPerfRhFor(rmName, map)` `#L251/#L256` | RM name + map | manager / RH name | none | — | `rmPerformanceHierarchyCells` (FN-063) | reusable |
| FN-062 | `repeatOffendersRegionKey(rec)` `#L270` | a record | region bucket — Loan iff `group_source` says Loan, else `mainRegionFor(rec.region)` | none | `normRegionKey` / `mainRegionFor` (`JS-014`) | FN-058 — **no longer `JS-013`** (that PDF no longer calls this directly since the 2026-09-12 cache-read redesign, `9dea24a`) | reusable — Loan detection via `group_source` ONLY (Movement_Log has no `project_region`) |
| FN-063 | `rmPerformanceDrivenBy(r)` / `rmPerformanceHierarchyCells(r, map)` `#L1241/#L1269` | a result row | the "driven by" contributor list / hierarchy cells | none | FN-061 | table + PDF renderers | reusable |
| FN-064 | `sortRmPerformanceByPriority` / `ByScore` / `filterRmPerformanceWorst` / `filterRmPerformanceRankable(list)` `#L1297/#L839/#L1322/#L1338` | a result list | sorted / filtered list | none | — | `JS-022`, `JS-013` | reusable |

## Config constants — `CFG-XXX` sub-table

| ID | Constant | Value | Meaning | Changing it affects |
|---|---|---|---|---|
| CFG-013 | `RM_PERF_RULE_WEIGHTS` `#L68` | `isNotUpdated 1.5`, `followupOverdue 1.2`, `underCalledToday 1.0` | per-rule severity weights | the composite score; **twin `RM_PERF_RULE_WEIGHTS_GS_` (`GS-003`)** |
| CFG-014 | `RM_PERF_SHRINKAGE_K` `#L84` | `8` | empirical-Bayes shrinkage strength | score smoothing; twin in `GS-003` |
| CFG-015 | `RM_PERF_MIN_VOLUME_LEADS` `#L90` | `5` | below this many distinct eligible leads → "Insufficient Data" | which RMs are rankable; twin `RM_PERF_MIN_VOLUME_LEADS_GS_` |
| CFG-016 | `RM_PERF_CHRONIC_STREAK_DAYS` `#L97` | `3` | consecutive-day streak → "chronic" flag | the chronic marker; twin in `GS-003` |
| CFG-017 | `RM_PERF_FLAG_RATIO` `#L102` | `1.25` | how far above peer average = "Below Expectations" | classification cutoff; twin in `GS-003` |
| CFG-018 | `RM_PERF_CONCENTRATION_BREADTH_CEILING` `#L166` | `0.25` | violated leads must be ≤25% of the eligible book to count as "concentrated" | classification; twin in `GS-003` |
| CFG-019 | `REPEAT_OFFENDERS_REGION_RM_CAP` `#L883` | `5` | worst-N per region in `computeRmPerformanceByRegion` | `TAB-004`'s per-region breakdown only (client, no `.gs` twin) |
| CFG-020 | `RM_PERF_NON_RM_ROLES` `#L392` | `{a1, tm, rh, cluster head, city lead, commercial head}` | roles excluded from "RM" | `rmPerfIsLeadershipExcluded` (FN-060); mirrors `RmHierarchy.gs` `TOP_OF_ORG_ROLES_` |
| CFG-021 | `RM_PERF_NAME_ALIASES` `#L354` / `RM_PERF_LEADERSHIP_NAME_EXCLUSIONS` `#L305` | name→canonical map / name set | RM identity normalisation + name-based leadership exclusion | ranking membership |
| CFG-075 | `RM_PERF_VENDOR_NAME_PATTERN` / `RM_PERF_ADMIN_NAME_EXCLUSIONS` `#L346-370` (added 2026-09-29) | `/futwork/i` / `{Snehil Chhimwal}` | non-RM identities (tele-calling vendor agents, the dashboard's own admin) excluded entirely from every RM Performance view | `rmPerfIsLeadershipExcluded` (FN-060); `RM_PERF_ADMIN_NAME_EXCLUSIONS` has a `.gs` twin (`RM_PERF_ADMIN_NAME_EXCLUSIONS_GS_`, `GS-003`, parity-checked); `RM_PERF_VENDOR_NAME_PATTERN` is a regex literal, kept in parity by hand (not `check-runtime-parity.py`-checkable — see the constant's own comment) |
| CFG-074 | `RM_OPP_MIN_RESOLVED_LEADS` / `RM_OPP_SHRINKAGE_K` / `RM_OPP_LOW_RATIO` / `RM_OPP_48H_BASIS_MIN_SHARE` / `RM_OPP_MAX_FIRST_CAPTURE_LAG_HOURS` / `RM_OPP_ELEVATED_CLASSIFICATIONS` `#L792-818` (added 2026-09-29) | `5` / `8` / `0.5` / `0.5` / `12` / `{Below Expectations, Watch — concentrated}` | Opp-conversion engine thresholds — see HANDOVER.md §9.7.3 for the false-alarm-rate reasoning behind `RM_OPP_LOW_RATIO=0.5` specifically (not a literal mirror of `RM_PERF_FLAG_RATIO`) | `classifyRmOppConversion` (FN-314), `reconstructRmOppCohort` (FN-311), `joinRmOppConversion` (FN-315) — deliberately **no `.gs` twin** (see this file's own "RM Opp-Conversion engine" header) |
| CFG-077 | `RM_PERF_CONFIDENCE_THRESHOLD` `#L150` (added 2026-09-30) | `0.40` — deliberately **below 0.5**, not a typo, see the constant's own comment | posterior-confidence flagging bar for the violation composite | `classifyRmPerformance` (FN-056); twin `RM_PERF_CONFIDENCE_THRESHOLD_GS_` (`GS-003`, parity-checked); HANDOVER.md §9.7.5 has the full derivation + calibration table |
| CFG-078 | `RM_OPP_CONFIDENCE_THRESHOLD` `#L971` (added 2026-09-30) | `0.35` — same "below 0.5" property as CFG-077, chosen lower since this signal has no cross-rule independence-approximation bias | posterior-confidence flagging bar for Opp-conversion `lowConversion` | `classifyRmOppConversion` (FN-314) — deliberately **no `.gs` twin** (same reasoning as CFG-074); HANDOVER.md §9.7.5 |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-014 | `movementSnapshots` undefined / empty at compute time | `reconstructRmPerformanceObservations` returns `[]` `#L408` | Repeat Offenders shows "no data"; PDF export refuses (`JS-013` EXC) |
| EXC-015 | RM below `RM_PERF_MIN_VOLUME_LEADS` | classified "Insufficient Data", excluded from worst-first lists | RM not shown in the leaderboard |
| EXC-106 | a lead-copy's first Movement_Log snapshot lags its own `lead_assigned_at` by more than `RM_OPP_MAX_FIRST_CAPTURE_LAG_HOURS` (12) (added 2026-09-29) | `reconstructRmOppCohort` silently excludes it from the Opp-conversion cohort entirely (FN-311) | that lead contributes nothing to Same-Day/48h Opp% for any row — never guessed at, never distorts the rate |

## Business rules implemented — `RULE-XXX` sub-table

| ID | Rule | Where | Duplicated in (`GS-XXX`)? | Notes |
|---|---|---|---|---|
| RULE-013 | Score = severity-weighted violation rate, shrunk toward the peer average with strength `K`, weighted by distinct-eligible-lead count (not lead-days) | FN-054..FN-056 | **Yes — `DailyRmIssueLog.gs` `reportRmPerformanceNow`** (`GS-003`); `RM_PERF_*` constants must stay numerically identical (`LOGIC_AUDIT.md` Part 1 §4b) | console-only on the backend |
| RULE-014 | "RM" = anyone **not** A1/TM/RH/Cluster Head/City Lead/Commercial Head and not in the name-based leadership set | FN-060 | partial — `RmHierarchy.gs` `TOP_OF_ORG_ROLES_` = the last 3 | broadened this session (`7ef26db`) after managers appeared in the per-region worst-5 |
| RULE-015 | Per-region worst-5 uses a **region-scoped** peer average and lists only regions with ≥1 rankable RM | FN-058 | No — client-only feature | added this session (`812a3cb`) |
| RULE-016 | Loan bucket is decided by `group_source` only; `Movement_Log` has no `project_region`, so Loan leads tagged via `project_region` never bucket as "Loan" here | FN-062 | related to the HIGH finding in `GS-*` (`LOGIC_AUDIT.md` Part 4 §4.4) | known gap |
| RULE-036 | `doubleFlag` = an elevated violation classification (Below Expectations or Watch — concentrated) AND `lowConversion` (shrunk Opp-conversion rate ≤ `RM_OPP_LOW_RATIO` × the table's own peer rate, with ≥`RM_OPP_MIN_RESOLVED_LEADS` resolved leads) — BOTH required, neither alone is enough (added 2026-09-29) | FN-315 | No — browser-only, see CFG-074 | HANDOVER.md §9.7.3 has the false-alarm-rate reasoning behind the exact `0.5` ratio |
| RULE-037 | Posterior-confidence classification: `nLeads < RM_PERF_MIN_VOLUME_LEADS` → Insufficient Data; else, with `compositeVariance` usable, `confidence = normalCdf((composite − peerComposite×RM_PERF_FLAG_RATIO) / sqrt(compositeVariance))` and elevated iff `confidence ≥ RM_PERF_CONFIDENCE_THRESHOLD`; else (degenerate) falls back to the literal point-estimate comparison. Mirrored, direction-flipped, for `classifyRmOppConversion`'s `lowConversion` (added 2026-09-30) | FN-056, FN-314, FN-317 | Yes — violation side ported to `GS-003`; Opp-conversion side browser-only, see CFG-074/078 | HANDOVER.md §9.7.5 has the full derivation, the "must sit below 0.5" property, and the calibration table |

## Data lineage

`Movement_Log` (`SHEET-002`) → `movementSnapshots` (state, `JS-021`) →
`enrichSnapshotCached` per snapshot → `reconstructRmPerformanceObservations`
(FN-053) → `aggregateRmPerformance` → peer averages → `classifyRmPerformance`
→ result rows → `TAB-004` tables / `JS-013` PDF. Runs off-thread in
`JS-017`. Full flow: `DATA-002` (SLA-flag pipeline, history side) +
`DATA-004`. **Second, parallel lineage (added 2026-09-29):** the same
`movementSnapshots` → `evidenceAtDeadline` (`JS-021`) → `reconstructRmOppCohort`
(FN-311) → `aggregateRmOppConversion`/`classifyRmOppConversion` →
`joinRmOppConversion` merges onto the classification-engine's own rows —
two independent readings of the same source data, joined only at the
very end, never sharing intermediate state.

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
client-only. **The entire RM Opp-Conversion engine (`RM_OPP_*`, FN-311..316,
added 2026-09-29) also has no `.gs` twin, by deliberate design** — see
HANDOVER.md §9.7.3: `DailyRmIssueLog.gs`'s console leaderboard stays
narrower than the dashboard by existing precedent (HANDOVER.md §9.7 Phase
4), and its own `reconstructRmPerformanceObservationsGs_` is unfiltered,
so it structurally can't express the Source/Sub-source scoping this
feature exists for.

## UI relationships

No buttons. Feeds `TAB-004`'s leaderboards and per-region breakdown, and
`JS-013`'s PDF. `#repeatOffendersRecalculateBtn` (`BTN-010`) triggers a
recompute via the worker.

## Architecture relationship

`DASH-001`. Layer 6 (Business logic — client) in `LOGIC_AUDIT.md` Part 1
§1.

## Related documentation

`HANDOVER.md` §6, §9, **§9.7.3** (RM Opp-Conversion join, 2026-09-29);
`OPS_CHECKLIST.md` (worst-performer methodology drift); `LOGIC_AUDIT.md`
Part 1 §4b, Part 3 §3.6, Part 4 §4.4; this session's fix commits
`fef04b0` / `7ef26db` / `812a3cb` / `8d9acbc`.

## Relationships

- **Depends On:** `JS-005` (`CONFIG`, IST helpers), `JS-006`
  (`parseDate`), `JS-014` (`mainRegionFor`), `JS-021`
  (`movementSnapshots`, `buildMovementHistories`,
  `enrichSnapshotCached`), `JS-022` (`passesRepeatOffenderFilters` is
  here but the filter *state* comes from the tab;
  `rmHierarchyByNameLower` map), `SHEET-002`, `SHEET-006`, `DATA-004`
- **Used By:** `TAB-004`, `JS-013` (PDF), `JS-017` (worker), `JS-022`
  (sync path), `DATA-002`
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
- **Status:** Validated 2026-09-15 (weekly doc spot-check, cycle 2) — a
  scoped correction only: `FN-052`/`FN-060`/`FN-062`'s `Called by` cells
  wrongly still listed `JS-013` after the 2026-09-12 "PDF reads the
  cache, never recomputes" redesign (`9dea24a`) stopped
  `js/repeat-offenders-pdf.js` from calling `computeRmPerformance` /
  `rmPerfIsLeadershipExcluded` / `repeatOffendersRegionKey` directly —
  see `JS-013`'s own record. The rest of this record (line anchors,
  `RM_PERF_*` constants, `#L692`/`#L360`/`#L222` etc.) was **not**
  re-verified this pass — downgraded to `Validated`, not re-closed.

## Version / change reference

Verified at `c82ec67`; record created by DOC-027. **File nearly doubled
this session** (485L on 2026-09-05 → 869L) — alias handling, broadened
leadership exclusion, and `computeRmPerformanceByRegion`. `Called by`
cells for `FN-052`/`FN-060`/`FN-062` corrected 2026-09-15 (weekly doc
spot-check, cycle 2) for the `JS-013` dependency-edge change above; no
other content re-verified against `HEAD` this pass.

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
