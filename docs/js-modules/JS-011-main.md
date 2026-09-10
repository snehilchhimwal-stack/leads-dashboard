# JS-011 — main.js

| | |
|---|---|
| **Type** | `JS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `js/main.js` (20 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

The `<script src>` files share one global scope and have no module
system — so a file that calls another file's function *at parse time*
must load after it. `main.js` is the one place that happens: it loads
last and makes exactly 4 top-level calls that must run once the page is
parsed. Everything else (event handlers, `renderAll()`, the fetch) only
fires after full page load or after sign-in, so it doesn't care about
load order. This file exists to isolate that single ordering hazard.

## Responsibilities

- Run the 4 bootstrap calls, in order:
  `initCollapsibleSectionInfo()` → `initRMTimelineUI()` →
  `initMovementUI()` → `initAuthGate()`.

## Load order / position

**Last** in the `<script src>` list — every other `js/*.js` file must
already be parsed so its `init*` function is defined.

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| — | none | — | — | this file *defines* no functions; it is 4 call statements at module top level | `initCollapsibleSectionInfo` (`JS-010`), `initRMTimelineUI` (`JS-023`), `initMovementUI` (`JS-021`), `initAuthGate` (`JS-001`) | the browser, at parse time | N/A |

## Data lineage

None — pure bootstrap. It wires UI; the first real data flow starts when
`initAuthGate()`'s sign-in callback calls `fetchAndRender()` (`JS-003`).

## Data sources accessed

None.

## Data written / modified

None (its callees wire DOM event listeners).

## Failure / error behaviour

If any `init*` function is undefined at parse time (a `<script src>` tag
in the wrong order or missing), that line throws a `ReferenceError` and
the remaining bootstrap calls don't run — the classic ordering failure
this file's own comment warns about. No try/catch; a load-order bug must
surface loudly.

## Cross-runtime duplication

None.

## UI relationships

Indirectly wires every tab's event handling via the 4 `init*` calls. No
buttons of its own.

## Architecture relationship

`DASH-001`. The entry point — nothing in the catalog depends on
`main.js`; it depends on the `init*` exports of 4 other modules.

## Related documentation

`HANDOVER.md` §2 ("Loaded last…"), §3; `LOGIC_AUDIT.md` Part 1 §4b;
`CLAUDE.md` (load-order note); the file-split plan's ordering rule.

## Relationships

- **Depends On:** `JS-001` (`initAuthGate`), `JS-010`
  (`initCollapsibleSectionInfo`), `JS-021` (`initMovementUI`), `JS-023`
  (`initRMTimelineUI`)
- **Used By:** `TAB-005`, `JS-023`
- **Related:** `DASH-001` (`dashboard.html` loads this last)

## Source of truth

`js/main.js` at `HEAD` (read in full).

## Validation

- **Method:** full read of the 20-line file at `c82ec67` — the 4 calls
  and their order confirmed directly; each callee confirmed exported by
  its owning module's record (`JS-010` FN-075, `JS-023`, `JS-021`,
  `JS-001` FN-006). `tests/frontend-harness.html` grafts the real
  `dashboard.html` including this file, so a broken bootstrap fails the
  harness.
- **Evidence:** `js/main.js` source; `tests/frontend-harness.html`.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-027.

## Revalidation trigger

Any commit touching `js/main.js`; a bootstrap call is added/removed; any
of the 4 `init*` functions is renamed or moved to a different module;
the `<script src>` order in `dashboard.html` changes such that a callee
loads after `main.js`.

## Handover relationship

`HANDOVER.md` §2 describes `main.js` as "loaded last, the couple of
top-level bootstrap calls." Current as of 2026-09-09. A change to the
bootstrap set should update `HANDOVER.md` §2's row.

## Lifecycle / retention

N/A — code.

## Next action

none — Closed + Monitored.

## Closure evidence

Record committed for DOC-027; `docs/INDEX.md` `JS-011` → `Closed +
Monitored`, `Last Verified` 2026-09-10, links filled. No `FN-XXX` rows
(the file defines no functions). No `docs/changes/` record (DOC-027).
