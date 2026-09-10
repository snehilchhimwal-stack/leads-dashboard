# JS-003 — core-fetch-and-render.js

| | |
|---|---|
| **Type** | `JS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `js/core-fetch-and-render.js` (659 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

This is the pipeline. `fetchAndRender()` is the single largest function
in the app: it takes a Sheet ID + tab name, pulls the `leads` tab,
parses every row through `HEADER_ALIASES`, runs the **union-find
identity-match collation** that turns many RM copies into one real
customer, does the real merge (`mergeRowsIntoOneLead` — stage from the
furthest-progressed copy, `call_attempts`/`call_count`/`duration` by
**MAX not SUM**), writes `allParsedLeads`, and triggers the first
`renderAll()`. It exists because every downstream module — filters,
every tab, every report — starts from `allParsedLeads`, and this is the
one place that array is built.

## Responsibilities

- Orchestrate fetch → parse → collate → `allParsedLeads` → render.
- Own the collation merge (not exported — internal to `fetchAndRender`).
- Distinguish 403 (`ACCESS_DENIED`) from 404 (`NOT_FOUND`) and surface
  each with its own message.
- Provide the shared `showError` / `hideError` / `setPulse` chrome.
- Gate the Repeat Offenders render behind
  `Promise.all([fetchRmHierarchyForRollup, movementLogPromise])`
  (~`#L624`).

## Load order / position

Seventh in the real order — after every core parsing/model file, before
`core-ui` / `core-filters` (`LOGIC_AUDIT.md` Part 1 §4a).

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-015 | `fetchAndRender()` `#L27` | reads `#sheetIdInput` / `#tabNameInput` | writes `allParsedLeads`; triggers `renderAll()` and dependent tab renders | Sheets read, DOM overlay, `_currentSheetId` set via callee, source-mix computation | `gateTokenValid` (`JS-001`), `sheetsApiValuesGet` (`JS-009`), `valuesToGvizShape` (`JS-009`), `enrichLead` (`JS-006`), `applyFiltersAndRender` (`JS-004`), `fetchMovementLog` (`JS-021`), `fetchRmHierarchyForRollup` (`JS-022`), `renderAll` (`JS-012`) | `handleGateSignInClick` (`JS-001`), `#refreshBtn` / `#changeSourceBtn` (`DASH-001`) | specific (the app entry pipeline) |
| FN-016 | `mergeRowsIntoOneLead(rows)` `#L347` (internal) | array of raw rows for one family | one merged lead: `collatedFrom` (distinct `lead_id` count), `collatedRMs`, `collatedLeadIds`, `collatedRegions`, MAX'd counters, furthest stage | none (pure) | `canonicalStage` / `isClosedStage` (`JS-006`), region helpers | `fetchAndRender` (FN-015) only | specific |
| FN-017 | `_ufFind(x)` / `_ufUnion(a,b)` `#L280/#L284` (internal) | row indices | union-find structure over rows sharing `lead_id` OR `client_id`+similar-region | none | — | `fetchAndRender` (FN-015) | specific |
| FN-018 | `showError(html)` / `hideError()` `#L13/#L19` | HTML string | toggles `#errorBanner` | DOM write | — | `fetchAndRender` (FN-015), other modules on a caught error | reusable |
| FN-019 | `setPulse(live)` `#L23` | bool | toggles the live-data pulse indicator | DOM write | — | `fetchAndRender` (FN-015) | reusable |

## Business rules implemented — `RULE-XXX` sub-table

| ID | Rule | Where | Duplicated in (`GS-XXX`)? | Notes |
|---|---|---|---|---|
| RULE-001 | Two rows collate iff same `lead_id`, OR same `client_id` + similar region — transitively (union-find) | FN-017 + FN-015 `#L258` | No — the backend reads raw rows and groups more simply (`EmailInfra.gs` `readLeadsTab_`) | display counterpart is `familyKeyOf` (`JS-002`) |
| RULE-002 | On merge, `call_attempts` / `call_count` / `duration` are taken by **MAX, not SUM** — they are client-cumulative figures every copy reports identically | FN-016 `#L403` comment | No | summing would multiply by copy count — a real correctness rule (`LOGIC_AUDIT.md` Part 1 §1 layer 5) |
| RULE-003 | `collatedFrom` counts **distinct `lead_id`s**, not `rows.length` — a row read twice must not inflate a "collated" badge | FN-016 `#L403`–`#L430` | No | every badge/label in `JS-002` reads `collatedFrom` expecting this meaning |
| RULE-004 | A collated lead reads as **closed only when every copy is closed** | FN-015 `#L244` | conceptually mirrors `isOpenLead_` (`GS-002`) | cross-runtime pair (`LOGIC_AUDIT.md` Part 1 §4b) |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-004 | Sheets GET 403 | `throw new Error('ACCESS_DENIED')` → caught `#L639` | "access denied" message (you can't see this sheet) |
| EXC-005 | Sheets GET 404 | `throw new Error('NOT_FOUND')` → caught `#L641` | "sheet not found" message (correctly distinct from EXC-004 — `LOGIC_AUDIT.md` Part 6 §6.1 row 7) |
| EXC-006 | token invalid at fetch time | early return after `showLoadingOverlay`, re-prompt path via `JS-001` | overlay clears, gate reappears |
| EXC-007 | `RM_Hierarchy` / Movement fetch still pending at Repeat Offenders render | `Promise.all` gate defers that tab's render | Repeat Offenders shows a loading state, not stale/partial rows |

## Data lineage

`leads` tab (`SHEET-001`) → `sheetsApiValuesGet` (`JS-009`) →
`valuesToGvizShape` → `HEADER_ALIASES` column map → union-find collation
(RULE-001) → `mergeRowsIntoOneLead` (RULE-002/003) → `allParsedLeads`
(state, declared `JS-009`, **written here** `#L566`) → `enrichLead`
(`JS-006`) via `applyFiltersAndRender` (`JS-004`) → `leads` /
`issueLeads` → renderers. Full flow: `DATA-001`.

## Data sources accessed

`SHEET-001` (`leads`) via `EXT-001`. Triggers reads of `SHEET-002`
(`Movement_Log`, via `JS-021`) and `SHEET-006` (`RM_Hierarchy`, via
`JS-022`).

## Data written / modified

No Sheet writes. Writes in-memory state: `allParsedLeads`, and (through
callees) `leads` / `issueLeads` / the source-mix cache.

## Failure / error behaviour

Every failure path resolves to a visible `showError` banner + a cleared
overlay; no unhandled rejection. A partial parse (some rows bad) keeps
the good rows and renders.

## Cross-runtime duplication

The collation *concept* has no backend twin (the backend's
`readLeadsTab_` groups differently and more simply). RULE-004's
open/closed test is the client counterpart to `GS-002` `isOpenLead_`
(`LOGIC_AUDIT.md` Part 1 §4b / Part 4).

## UI relationships

No buttons of its own; driven by `#refreshBtn` / `#changeSourceBtn`
(`DASH-001`) and the sign-in callback (`JS-001`). Its `showError` banner
is `#errorBanner`.

## Architecture relationship

`DASH-001`. Layers 3+5+15 in `LOGIC_AUDIT.md` Part 1 §1 (client fetch,
collation, refresh-after-mutation wiring).

## Related documentation

`HANDOVER.md` §3 steps 2–3; `LOGIC_AUDIT.md` Part 1 §1 layers 3/5,
§2, §4b, Part 2 §2 (initial load Mermaid); `DATA-001`.

## Relationships

- **Depends On:** `JS-001`, `JS-004` (`applyFiltersAndRender`),
  `JS-006`, `JS-007`, `JS-009`, `JS-010`, `JS-012` (`renderAll`),
  `JS-014` (region helpers), `JS-021` (`fetchMovementLog`), `JS-022`
  (`fetchRmHierarchyForRollup`), `SHEET-001`, `EXT-001`
- **Used By:** `DASH-001`, `TAB-004`, `TAB-007`, `JS-001`, `JS-002`,
  `JS-018`, `JS-021`, `JS-022`, `JS-023`, `DATA-001` — transitively
  every tab (all read `allParsedLeads` / `leads` / `issueLeads` it
  produces)
- **Related:** `JS-002` (display side of the merge), `JS-018` (write
  paths re-invoke `fetchAndRender` / dependent renders after a write)

## Source of truth

`js/core-fetch-and-render.js` at `HEAD`.

## Validation

- **Method:** full read at `c82ec67`; function + error-code list
  verified by grep (`ACCESS_DENIED` `#L77`, `NOT_FOUND` `#L78`,
  `mergeRowsIntoOneLead` `#L347`, `_ufFind`/`_ufUnion` `#L280`–`#L284`);
  cross-check `LOGIC_AUDIT.md` Part 1 §4b + Part 6 §6.1 row 7 (error
  names verified correct). `tests/frontend-harness.html` runs synthetic
  leads (including multi-copy families) through the **real**
  `fetchAndRender()` with only the Sheets read + OAuth mocked.
- **Evidence:** `tests/frontend-harness.html`; `LOGIC_AUDIT.md` Part 1
  §4b, Part 6 §6.1.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-027.

## Revalidation trigger

Any commit touching `js/core-fetch-and-render.js`; `RULE-001`..`RULE-004`
change; `HEADER_ALIASES` (`JS-009`) changes; the `allParsedLeads` shape
changes; the `ACCESS_DENIED` / `NOT_FOUND` codes are renamed; the
Repeat-Offenders render gate changes.

## Handover relationship

`HANDOVER.md` §3 steps 2–3 describe this pipeline directly; current as of
2026-09-09. Any change to the collation rules or the pipeline order must
update `HANDOVER.md` §3 in the same commit (`CLAUDE.md` gotcha).

## Lifecycle / retention

N/A — code. All state it builds is in-memory, rebuilt every fetch.

## Next action

none — Closed + Monitored.

## Closure evidence

Record committed for DOC-027; `docs/INDEX.md` `JS-003` → `Closed +
Monitored`, `Last Verified` 2026-09-10, links filled; `RULE-001`..`004`
and `EXC-004`..`007` recorded. No `docs/changes/` record (DOC-027).
