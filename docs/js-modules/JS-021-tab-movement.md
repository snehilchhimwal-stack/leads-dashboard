# JS-021 — tab-movement.js

| | |
|---|---|
| **Type** | `JS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `js/tab-movement.js` (1328 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

Fetches and parses the `Movement_Log` tab (the 4×/day backend snapshot
of every lead) and is **the shared Movement_Log data hub** — most other
tab files read the `movementSnapshots` / `buildMovementHistories` /
`passesMovementFilters` it owns. On top of that it implements the
Movement tab (`TAB-007`): Stalled Leads, the RM Stall Leaderboard,
Time-to-Opportunity, Unmatched Comments, and the Overnight-Leads cohort
with its region-email trigger. It exists because reconstructing "this
lead stopped moving N days ago" needs snapshot history, and this is the
one module that loads and owns it.

## Responsibilities

- `fetchMovementLog` → parse → `movementSnapshots` / `movementFetchState`
  / `_currentSheetId` (module state).
- `buildMovementHistories` / `enrichSnapshotCached` / `enrichLeadAsOf` —
  per-lead snapshot history + as-of enrichment.
- `passesMovementFilters` — the Movement/Tracking filter predicate
  (distinct from `passesRepeatOffenderFilters`).
- Stalled Leads / RM Stall Leaderboard / Time-to-Opportunity / Unmatched
  Comments compute + render.
- The Overnight cohort + its region-email write cycle.
- `initMovementUI` — wire the tab's controls (bootstrapped from
  `main.js`).

## Load order / position

In the tab group before `main.js`; `initMovementUI()` is one of
`main.js`'s 4 bootstrap calls (`LOGIC_AUDIT.md` Part 1 §4b).

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-140 | `fetchMovementLog(sheetId)` `#L138` | sheet id | populates `movementSnapshots`; sets `movementFetchState` / `_currentSheetId` | one Sheets read; state writes | `sheetsApiValuesGet` / `valuesToGvizShape` (`JS-009`) | `fetchAndRender` (`JS-003`), refresh paths | specific — the hub's loader |
| FN-141 | `buildMovementHistories()` / `enrichSnapshotCached(rec)` / `enrichLeadAsOf(rawRecord, asOfDate)` `#L293/#L341/#L320` | `movementSnapshots` | per-lead ordered snapshot history; per-snapshot enriched record | memoisation caches | `enrichLead` (`JS-006`), `parseDate` | Stalled/leaderboard/time-to-opp compute here, `JS-008`, `JS-024`, `JS-023` | reusable — hub API |
| FN-142 | `passesMovementFilters(rec, opts)` `#L384` | a record + options | bool | none | `mainRegionFor` / `effectiveRegion` (`JS-014`) | Movement/Tracking renders, `JS-024`, `JS-023` | reusable — **not** the same predicate as `passesRepeatOffenderFilters` (`JS-008`); this one *does* run `effectiveRegion`'s Loan inference |
| FN-143 | `computeStalledLeads()` / `currentStalledRowsByRegion()` `#L543/#L591` | histories | leads ≥2 days old AND (comments but none in 6h, OR never commented + `call_attempts` unchanged vs a ~6h-old snapshot) | none | FN-141 | `renderStalledFlaggedLeadsOps` (FN-146), `overview-…` (`JS-012`), `reports-build.js` (`JS-014`) | reusable |
| FN-144 | `computeRmStallLeaderboard()` / `computeTimeToOpportunity()` / `summarizeTimeToRemediate(episodes)` `#L701/#L747/#L779` | histories | per-RM stall counts / time-to-Opportunity episodes | none | FN-141, `splitHistoryByCopy` | `renderRmStallLeaderboard` / `renderTimeToOpportunity` (FN-146) | reusable |
| FN-145 | `computeUnmatchedMovementComments()` / `downloadUnmatchedCommentsCSV()` / `renderUnmatchedCommentsCount()` `#L828/#L867/#L859` | histories | the unmatched-comment list / a CSV / a count badge | download | `inferOutcome` (`JS-007`), `csvEscape` (`JS-012`) | `#downloadUnmatchedCommentsBtn` (`BTN-018`), `renderMovementTab` (FN-147) | reusable |
| FN-146 | `computeOvernightCohort(asOf)` / `overnightStatusLabel(l)` / `overnightEmailableLeads(cohortLeads)` / `buildOvernightRegionReports(...)` / `renderOvernightCohort(asOf)` / `renderOvernightRegionReports()` `#L964`–`#L1167` | as-of date, cohort leads, a follow-up lookup | the overnight cohort + its per-region reports + the write cycle | Overnight cycle: `clearLeadFollowupsTab` → `pushLeadsToFollowups` → `waitForAllFollowups` (`JS-018`); `renderMorningBrief` at checkpoints | `JS-018`, `buildRegionReports` (`JS-014`), `JS-020` | `#overnightGenerateReportsBtn` (`BTN-016`), `#overnightFollowupsWaitCancelBtn` (`BTN-017`) | specific — uses **live** `allParsedLeads`, not a frozen snapshot |
| FN-147 | `renderMovementTab()` / `initMovementUI()` `#L1265/#L1288` | — | renders every Movement section; wires the tab controls | DOM writes / listeners; wires `#snapshotNowBtn` → `browserSnapshotOpenLeads` (`JS-018`) | all the compute + render fns here | `renderAll` (`JS-012`), `main.js` (`JS-011`) | specific |
| FN-148 | `buildTodayCallBaseline(asOf)` / `lastSnapshotBefore(asOf)` `#L97/#L124` | as-of date | the `_todayCallBaselineByKey` / `_lastSnapshotByKey` seeds that `enrichLead` (`JS-006`) reads for `underCalledToday` | populates `JS-006`'s baseline Maps | FN-141 | called during the fetch/enrich pipeline | reusable — the seam between Movement history and `enrichLead` |
| FN-149 | snapshot-selector helpers: `populateMovementDateSelect` / `populateMovementTimeSelect` / `getSelectedMovementSnapshot` / `distinctMovementSnapshotRuns` / `movementDatesAvailable` `#L444`–`#L503` | — | the From/To snapshot pickers | DOM writes | `istTimeLabel` | Movement + Tracking pickers | reusable |

## Business rules implemented — `RULE-XXX` sub-table

| ID | Rule | Where | Duplicated in (`GS-XXX`)? | Notes |
|---|---|---|---|---|
| RULE-024 | Stalled = ≥2 days old AND (has comments but none in 6h, OR never commented and `call_attempts` unchanged vs a ~6h-old snapshot) | FN-143 | conceptually related to `GS-008`'s snapshot semantics, not a shared function | `LOGIC_AUDIT.md` Part 1 §4c |
| RULE-025 | The Overnight cohort window uses **live** `allParsedLeads`, not a frozen snapshot — status reflects "as of last refresh," not "as of window end" | FN-146 | `OvernightEmailer.gs` reads its own leads-tab snapshot | `LOGIC_AUDIT.md` Part 1 §4c |
| RULE-026 | `passesMovementFilters` runs region filtering through `effectiveRegion`'s Loan inference; `passesRepeatOffenderFilters` (`JS-008`) deliberately does **not** | FN-142 vs `JS-008` FN-057 | — | a documented client-side inconsistency (`LOGIC_AUDIT.md` Part 4/6) |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-043 | `Movement_Log` read fails | `movementFetchState = 'error'`; `movementUnavailableReason()` sets the message | dependent tabs (`TAB-004`/`005`/`008`) show "not loaded" instead of stale rows |
| EXC-044 | Overnight Generate while the Operations Generate cycle holds the mutex | `tryClaimGenerateCycle('overnight')` fails | "cycle in progress" message; no `Lead_Followups` clobber |
| EXC-045 | Overnight review wait cancelled (`BTN-017`) | falls back to the algorithmic report + "UNREVIEWED" banner | never sends unreviewed text unlabelled |

## Data lineage

`Movement_Log` (`SHEET-002`) → `fetchMovementLog` (FN-140) →
`movementSnapshots` (state) → `buildMovementHistories` (FN-141) →
per-lead history → Stalled / leaderboard / time-to-opp / unmatched /
overnight compute → `renderMovementTab` → screen. Overnight write path:
live `allParsedLeads` → `buildOvernightRegionReports` → `Lead_Followups`
(`SHEET-004`, via `JS-018`) → Gmail (`JS-015`). Full flows: `DATA-004`
(Movement snapshot pipeline) + `DATA-005`.

## Data sources accessed

`SHEET-002` (`Movement_Log`, its own read via `sheetsApiValuesGet`);
reads `allParsedLeads` (state). Auth: `gateAccessToken` (`JS-001`).
Integration: `EXT-001`, `EXT-002` (Overnight Gmail send).

## Data written / modified

No direct Sheet write of its own — the Overnight cycle writes
`Lead_Followups` (`SHEET-004`) and `Send_Log` (`SHEET-011`) via `JS-018`.
Writes `movementSnapshots` / `movementFetchState` / `_currentSheetId`
state and (via FN-148) `JS-006`'s baseline Maps.

## Failure / error behaviour

A failed hub load fails *safe* — dependent tabs show "not loaded," not
stale data (EXC-043). The Overnight cycle is mutex-guarded (EXC-044) and
degrades to a labelled fallback report (EXC-045).

## Cross-runtime duplication

`Movement_Log` is written by both this module's `browserSnapshotOpenLeads`
(via `JS-018`) and `MovementTracker.gs` (`GS-008`) — the two writers'
schemas agree exactly (`LOGIC_AUDIT.md` Part 4 §4.7). The Overnight
region-email cycle mirrors `OvernightEmailer.gs` (`GS-010`).

## UI relationships

`#tab-movement` panel; `#snapshotNowBtn` (`BTN-014`, wired here despite
being in the top bar), `#autoSnapshotCheck` (`BTN-015`),
`#overnightGenerateReportsBtn` (`BTN-016`), `#overnightFollowupsWaitCancelBtn`
(`BTN-017`), `#downloadUnmatchedCommentsBtn` (`BTN-018`), the Movement
filter multi-selects (`UI-012`). `initMovementUI` is a `main.js`
bootstrap call.

## Architecture relationship

`DASH-001`. Layer 3 (client fetch — its own `Movement_Log` read), layer
10 (render), layer 17-facing (it consumes `MovementTracker.gs`'s output).
Belongs to `TAB-007`; its state serves `TAB-004`/`005`/`008`.

## Related documentation

`HANDOVER.md` §2, §3 step 5, §8; `LEAD_FOLLOWUPS_STALENESS.md`;
`LOGIC_AUDIT.md` Part 1 §4c, Part 2 §4, Part 4 §4.7, Part 7 §18 MEDIUM
#1/#3.

## Relationships

- **Depends On:** `JS-002`, `JS-003` (`allParsedLeads`), `JS-005`,
  `JS-006` (`enrichLead`), `JS-007` (`inferOutcome` for unmatched
  comments), `JS-009` (`sheetsApiValuesGet`), `JS-012` (`csvEscape`,
  `renderBreakdownCard`), `JS-014` (`effectiveRegion`, `mainRegionFor`,
  `buildRegionReports`), `JS-018` (Overnight write cycle), `JS-020`
  (`renderMorningBrief`), `SHEET-002`, `SHEET-004`, `SHEET-011`,
  `EXT-001`, `EXT-002`, `EXT-003`
- **Used By:** `TAB-004`, `TAB-005`, `TAB-007`, `TAB-008` (read
  `movementSnapshots` / `buildMovementHistories` /
  `passesMovementFilters`), `JS-003` (`fetchMovementLog`), `JS-006`
  (baseline Maps via FN-148), `JS-008`, `JS-011` (`initMovementUI`),
  `JS-012`, `JS-013`, `JS-014`, `JS-017`, `JS-018`, `JS-022`, `JS-023`,
  `JS-024`, `DATA-004`
- **Related:** `GS-008` (`MovementTracker.gs` — writes the `Movement_Log`
  it reads), `GS-010` (`OvernightEmailer.gs` — the unattended Overnight
  equivalent)

## Source of truth

`js/tab-movement.js` at `HEAD`.

## Validation

- **Method:** full read at `c82ec67`; function list verified by grep;
  cross-check `LOGIC_AUDIT.md` Part 1 §4c + Part 2 §4 + Part 4 §4.7.
  `tests/frontend-harness.html` mocks the `Movement_Log` read and
  exercises `buildMovementHistories` / `computeStalledLeads` /
  `browserSnapshotOpenLeads` (write boundary mocked).
- **Evidence:** `LOGIC_AUDIT.md` Part 1 §4c, Part 4 §4.7;
  `tests/frontend-harness.html`.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-028.

## Revalidation trigger

Any commit touching `js/tab-movement.js`; the stalled-lead thresholds or
the Overnight cohort window logic change; `movementSnapshots` /
`buildMovementHistories` / `passesMovementFilters` shape changes (breaks
`TAB-004`/`005`/`008` consumers); `Movement_Log` (`SHEET-002`) columns
or retention change; `initMovementUI`'s wired controls change.

## Handover relationship

`HANDOVER.md` §2 names the file; §3 step 5 covers the write-back paths;
§8 has the Movement_Log incidents. Current as of 2026-09-09. A change to
the snapshot schema or the shared-hub API must update `HANDOVER.md` §3
and note the downstream `TAB-004`/`005`/`008` dependency.

## Lifecycle / retention

N/A — code. `Movement_Log` retains 7 days (`SHEET-002`).

## Next action

none — Closed + Monitored.

## Closure evidence

Record committed for DOC-028; `docs/INDEX.md` `JS-021` → `Closed +
Monitored`, `Last Verified` 2026-09-10, reciprocal links to `TAB-007`
and downstream tabs confirmed; `RULE-024`..`026`, `EXC-043`..`045`
recorded. No `docs/changes/` record (DOC-028).
