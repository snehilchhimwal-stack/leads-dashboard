# JS-017 — rm-performance-worker.js

| | |
|---|---|
| **Type** | `JS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `js/rm-performance-worker.js` (153 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

The RM-performance computation walks every `Movement_Log` snapshot and
reconstructs per-(lead, day, rule) observations — heavy enough to freeze
the main thread on a large book. This module is a **Web Worker** that
`importScripts()` the *real, unmodified* production files
(`core-rm-performance.js` and its deps) and runs the compute off-thread,
posting stage-by-stage progress and one `done` message back. It exists
so Repeat Offenders (`TAB-004`) stays responsive while it recalculates,
and so the worker and the on-screen tab run identical code.

## Responsibilities

- `importScripts` the production compute stack.
- Handle the inbound `{dateKeys, filters, rmHierarchyByNameLower}`
  message.
- Run `computeRmPerformance` per group key (RM, Region, A1-TM, RH) and
  `computeRmPerformanceByRegion`, posting a `progress` message per stage.
- Post one `done` message with `{rm, region, a1tm, rh, byRegion,
  stageCounts}` — or an `error` message with the stack.

## Load order / position

Not in `dashboard.html`'s `<script src>` list — it is loaded as a
`new Worker('js/rm-performance-worker.js')` from `tab-repeat-offenders.js`
(`JS-022`). It `importScripts` (relative to `js/`): `core-foundation.js`,
`core-lead-model.js`, `core-outcome-engine.js`, `reports-build.js`,
`tab-movement.js`, `core-rm-performance.js`.

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-119 | `onmessage(e)` `#L77` | `{dateKeys, filters, rmHierarchyByNameLower}` | `postMessage` a series of `{type:'progress', stage}` then one `{type:'done', rm, region, a1tm, rh, byRegion, stageCounts}` (or `{type:'error', message, stack}`) | runs the compute; posts messages | `passesRepeatOffenderFilters`, `computeRmPerformance`, `computeRmPerformanceByRegion`, `repeatOffendersRegionKey`, `rmPerfPrimaryManagerFor`, `rmPerfRhFor` (all `JS-008`, loaded via `importScripts`) | the `Worker` instance in `JS-022` | specific — the worker entry |
| FN-120 | `_rmPerfWorkerClassificationCounts(list)` `#L73` | a result list | `{classification: count}` map | none | — | FN-119 (for `stageCounts`) | specific — a debug/telemetry helper |

## Message contract

- **IN** (`postMessage` from `JS-022`): `{dateKeys, filters,
  rmHierarchyByNameLower}`.
- **OUT — progress**: `{type:'progress', stage:'rm'|'region'|'a1tm'|'rh'|'byRegion'}`
  — 3–5 of these (`a1tm` / `rh` only when a hierarchy map is present).
- **OUT — done**: `{type:'done', rm, region, a1tm, rh, byRegion,
  stageCounts}` — exactly one. `byRegion` added 2026-09-09 (the
  "Region wise repeat offender list").
- **OUT — error**: `{type:'error', message, stack}`.

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-032 | any throw inside `onmessage` | caught, posted as `{type:'error', message, stack}` | `JS-022` leaves the last good table on screen and logs the worker error |
| EXC-033 | `importScripts` fails to load a production file | the Worker fails to construct | `JS-022` falls back to `_runRepeatOffendersSynchronously` (main-thread compute) |

## Data lineage

`{dateKeys, filters, rmHierarchyByNameLower}` posted in →
`computeRmPerformance` / `computeRmPerformanceByRegion` (`JS-008`, running
inside the worker over a copy of `movementSnapshots` rebuilt from the
same `importScripts`-loaded `tab-movement.js` code) → `{rm, region,
a1tm, rh, byRegion}` posted out → `JS-022` renders the tables. No
persistence; the worker has no DOM and no Sheet access.

## Data sources accessed

None directly — it receives everything it needs by message. (The
`importScripts`-loaded `tab-movement.js` code rebuilds movement
histories from data passed in, not from a live fetch.)

## Data written / modified

None — pure compute, posts results back by message.

## Failure / error behaviour

All errors are caught and posted as `error` messages, never thrown out
of the worker. A worker that fails to construct triggers the
synchronous main-thread fallback in `JS-022` (EXC-033).

## Cross-runtime duplication

**None — deliberately the opposite.** The whole point of this module is
to run the *exact same* `core-rm-performance.js` code as the main thread
(via `importScripts`), so there is no second implementation to keep in
sync. (The separate `.gs` mirror is `GS-003` — that duplication is the
browser↔Apps-Script one, not a browser↔worker one.)

## UI relationships

No DOM. Its output drives `TAB-004`'s leaderboards + per-region
breakdown via `JS-022`. Triggered by `#repeatOffendersRecalculateBtn`
(`BTN-010`) and the initial Repeat Offenders render.

## Architecture relationship

`DASH-001`. Layer 6 (Business logic — client), run off-thread. Belongs
to `TAB-004`.

## Related documentation

`HANDOVER.md` §9; `LOGIC_AUDIT.md` Part 1 §4c (Repeat Offenders row);
`js/rm-performance-worker.js` own header comment (the message contract).

## Relationships

- **Depends On:** `JS-008` (`core-rm-performance.js` — the compute),
  `JS-005`, `JS-006`, `JS-007`, `JS-014`, `JS-021` (all `importScripts`-
  loaded)
- **Used By:** `JS-022` (constructs and messages the Worker), `TAB-004`
- **Related:** `JS-013` (PDF — computes the same numbers synchronously,
  not via this worker), `GS-003` (the `.gs` mirror)

## Source of truth

`js/rm-performance-worker.js` at `HEAD` (read in full, incl. the
`importScripts` list and the `onmessage` body).

## Validation

- **Method:** full read at `c82ec67`; the `importScripts` list (`#L64`–
  `#L71`) and the message contract (`#L46`–`#L61` header + the `onmessage`
  body `#L77`–`#L151`) confirmed directly. The compute it runs is
  validated on `JS-008`. `tests/frontend-harness.html` exercises
  `computeRmPerformance` on the main thread (the identical code path).
- **Evidence:** `js/rm-performance-worker.js` source (message contract +
  `importScripts` list); `JS-008` validation.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-028. The `byRegion` stage +
`done`-message field were added 2026-09-09 (`812a3cb`).

## Revalidation trigger

Any commit touching `js/rm-performance-worker.js`; the `importScripts`
file list changes; the IN/OUT message shape changes (breaks `JS-022`'s
handler); a new compute stage is added; `computeRmPerformance` /
`computeRmPerformanceByRegion` (`JS-008`) signatures change.

## Handover relationship

`HANDOVER.md` §9 covers the Repeat Offenders subsystem; the worker is
not called out separately there. Current as of 2026-09-09 but predates
the `byRegion` stage by a day — a §9 refresh should mention the
off-thread compute + the `byRegion` message field.

## Lifecycle / retention

N/A — code.

## Next action

none — Closed + Monitored.

## Closure evidence

Record committed for DOC-028; `docs/INDEX.md` `JS-017` → `Closed +
Monitored`, `Last Verified` 2026-09-10, links filled; message contract
+ `EXC-032`/`033` recorded. No `docs/changes/` record (DOC-028).
