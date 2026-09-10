# JS-010 — core-ui.js

| | |
|---|---|
| **Type** | `JS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `js/core-ui.js` (159 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

The generic UI chrome every tab reuses: HTML-escaping (`esc`), a
reference-counted loading overlay, the lazy action-log expand
(`toggleActionLog`), the shared alert-card template (`renderAlertCard`),
and collapsible section-info toggles. It exists so ~20 render functions
across 8 tabs don't each re-implement "escape a string," "show a spinner
while I work," or "render one issue card" — and so the action-log
registry (`_logLeadRegistry`) has exactly one owner.

## Responsibilities

- `esc(s)` — the app-wide HTML escaper.
- `showLoadingOverlay` / `hideLoadingOverlay` — depth-counted (regular +
  "heavy") overlay so nested callers don't clear it early.
- `toggleActionLog` / `logToggleMarkup` — lazy per-lead action-log
  expand, backed by `_logLeadRegistry`.
- `renderAlertCard` — the shared issue-card template.
- `toggleInlineDetail` / `initCollapsibleSectionInfo` — section-info
  disclosure.
- `MAX_CARDS` / `truncationNotice` — the render cap + its "N more not
  shown" note.

## Load order / position

Eighth in the real order (`… core-fetch-and-render → **core-ui** →
core-filters → …`). CLAUDE.md's documented list pair-swaps it with
`core-filters` (`LOGIC_AUDIT.md` Part 1 §4a — harmless).

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-070 | `esc(s)` `#L15` | any value | HTML-escaped string | none | — | virtually every render function in the app | reusable — the app-wide escaper |
| FN-071 | `showLoadingOverlay(text, heavy)` / `hideLoadingOverlay(heavy)` `#L42/#L52` | text, a "heavy" flag | shows/hides `#loadingOverlay` | mutates `_loadingOverlayDepth` / `_loadingOverlayHeavyDepth` | — | `applyFiltersAndRender` (`JS-004`), `fetchAndRender` (`JS-003`), write paths (`JS-018`), `main.js` | reusable — depth-counted so nested callers are safe |
| FN-072 | `toggleActionLog(logId)` `#L80` | a registry key | expands/collapses that lead's action log | reads `_logLeadRegistry`; DOM write | `parseActionLog` / `istStamp` (`JS-007`) | `.log-toggle` clicks on issue cards | reusable |
| FN-073 | `logToggleMarkup(l, logId)` `#L92` | a lead + key | the `.log-toggle` control markup; registers the lead in `_logLeadRegistry` | writes `_logLeadRegistry` | — | `renderAlertCard` (FN-074), Operations card renderers (`JS-012`) | reusable |
| FN-074 | `renderAlertCard(l, idx, prefix, requiredCalls)` `#L101` | a lead + context | one issue-card's HTML | none | `leadIdentityLine` (`JS-002`), `logToggleMarkup` (FN-073), `esc` (FN-070) | Operations issue lists (`JS-012`), Movement lists (`JS-021`) | reusable — the shared card template |
| FN-075 | `toggleInlineDetail(btn)` / `initCollapsibleSectionInfo()` `#L127/#L143` | a button / — | toggles a section-info panel / wires all of them | DOM writes | — | `main.js` (`JS-011`) bootstrap; section-info clicks | reusable |
| FN-076 | `truncationNotice(total, shown)` `#L73` | two counts | "N more not shown" HTML | none | — | list renderers hitting `MAX_CARDS` | reusable |

## Config constants — `CFG-XXX` sub-table

| ID | Constant | Value | Meaning | Changing it affects |
|---|---|---|---|---|
| CFG-023 | `MAX_CARDS` `#L71` | `200` | cap on cards rendered in one list before a truncation notice | every card list's length; render performance |

## State owned here

| Symbol | `#L` | Type | Notes |
|---|---|---|---|
| `_logLeadRegistry` | `#L78` | `Map` | backs `toggleActionLog`; **cleared at the top of every `renderAll()` pass** (`JS-012` `#L164`) — the previously-flagged unbounded-growth concern is already addressed (`LOGIC_AUDIT.md` Part 6 §6.1 row 1). Owned here, not in a tab file. |
| `_loadingOverlayDepth` / `_loadingOverlayHeavyDepth` | `#L33/#L41` | `let` counters | reference counts so nested show/hide pairs don't clear early |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-018 | `toggleActionLog` called with a key not in `_logLeadRegistry` (e.g. after a `renderAll()` clear) | no-op | the expand does nothing rather than throwing; a re-render re-registers |
| EXC-019 | unbalanced `hideLoadingOverlay` calls | depth counter floors at 0 | overlay can't be "over-hidden" into a negative state |

## Data lineage

No data flows through it — it formats and displays data other modules
already hold. `_logLeadRegistry` holds transient references to leads for
the lifetime of one render pass.

## Data sources accessed

None.

## Data written / modified

DOM only (`#loadingOverlay`, `.log-toggle` panels, section-info panels).
No Sheet, no persistent state.

## Failure / error behaviour

Defensive throughout — missing registry keys and unbalanced overlay
calls are handled as no-ops. No throw paths.

## Cross-runtime duplication

None — this is pure browser UI chrome with no backend counterpart.

## UI relationships

`#loadingOverlay` (global), `.log-toggle` (issue cards on `TAB-003` /
`TAB-007`, `UI-003`), section-info toggles across tabs.
`initCollapsibleSectionInfo()` is one of `main.js`'s 4 bootstrap calls.

## Architecture relationship

`DASH-001`. Layer 10 (Render / UI — shared chrome) in `LOGIC_AUDIT.md`
Part 1 §1.

## Related documentation

`HANDOVER.md` §2, §3 step 3; `LOGIC_AUDIT.md` Part 1 §4b, Part 6 §6.1
row 1 (`_logLeadRegistry` — does not reproduce).

## Relationships

- **Depends On:** `JS-002` (`leadIdentityLine`), `JS-007` (`istStamp`,
  `parseActionLog`), `JS-005` (`MAX_CARDS` forward ref is here, not
  `core-foundation`)
- **Used By:** `JS-004`, `JS-003`, `JS-011`, and virtually every
  tab/report file (`esc`, overlay, `renderAlertCard`)
- **Related:** `JS-012` (`renderAll()` clears `_logLeadRegistry`)

## Source of truth

`js/core-ui.js` at `HEAD`.

## Validation

- **Method:** full read at `c82ec67`; function + state list verified by
  grep (`_logLeadRegistry` `#L78`, `MAX_CARDS` `#L71`); cross-check
  `LOGIC_AUDIT.md` Part 1 §4b + Part 6 §6.1 row 1 (registry clear
  confirmed at `JS-012` `#L164`). Exercised by every
  `tests/frontend-harness.html` render scenario.
- **Evidence:** `LOGIC_AUDIT.md` Part 6 §6.1 row 1; `tests/frontend-harness.html`.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-027.

## Revalidation trigger

Any commit touching `js/core-ui.js`; `renderAlertCard`'s signature
changes (used by `JS-012` / `JS-021`); the `_logLeadRegistry` clear at
`JS-012` `#L164` is removed or moved (would re-open the growth concern);
`MAX_CARDS` changes; `esc`'s escaping set changes.

## Handover relationship

`HANDOVER.md` §2 names the file; §3 covers the render model. Current as
of 2026-09-09. No `HANDOVER.md` edit needed for chrome tweaks unless the
render cap or the overlay contract changes materially.

## Lifecycle / retention

N/A — code. `_logLeadRegistry` is per-render-pass transient.

## Next action

none — Closed + Monitored.

## Closure evidence

Record committed for DOC-027; `docs/INDEX.md` `JS-010` → `Closed +
Monitored`, `Last Verified` 2026-09-10, links filled; `CFG-023`,
`EXC-018`/`019` recorded. No `docs/changes/` record (DOC-027).
