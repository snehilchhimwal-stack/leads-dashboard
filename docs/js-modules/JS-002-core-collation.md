# JS-002 — core-collation.js

| | |
|---|---|
| **Type** | `JS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `js/core-collation.js` (172 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

One real customer often appears in the `leads` tab as several rows —
different RMs each holding a copy. The *real* merge of those copies
happens in `fetchAndRender` (`JS-003`); this module is the **display
layer** for the merged families: the badges, identity lines, and
grouping/counting helpers that let every table and card show "this is
one customer, collated from 3 RM copies" honestly instead of either
double-counting or silently hiding copies. It exists so "COLLATE, DON'T
DEDUPLICATE" is visible in the UI, not just true in the data.

## Responsibilities

- Render the collation badge / sibling note / identity line for a merged
  lead.
- Provide a stable family key (`familyKeyOf`).
- Group siblings together in a list; dedupe a list to one row per
  family; count unique-vs-cloned; produce the "N customers (M collated)"
  label text.

## Load order / position

Fifth in the real order (`… core-auth → core-lead-model → **core-collation**
→ core-outcome-engine → …`). Forward-references `esc` from `core-ui.js`
(safe — only used inside function bodies).

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-007 | `collationBadge(l)` `#L19` | a merged lead | badge HTML string | none | `esc` (`JS-010`) | `leadIdentityLine` (FN-009), card renderers | reusable |
| FN-008 | `siblingNote(l)` `#L42` | a merged lead | note HTML string | none | `esc` (`JS-010`) | card renderers | reusable |
| FN-009 | `leadIdentityLine(l)` `#L54` | a merged lead | identity line HTML | none | `collationBadge` (FN-007) | `renderAlertCard` (`JS-010`), most tab card/table renderers | reusable |
| FN-010 | `familyKeyOf(l)` `#L66` | a lead | stable string key `[own id, …siblingLeadIds]` sorted | none | — | `groupSiblingsTogether` (FN-011), `dedupeToFamilies` (FN-012) | reusable |
| FN-011 | `groupSiblingsTogether(items, compareFn)` `#L81` | a list + comparator | list re-ordered so family members are adjacent | none | `familyKeyOf` (FN-010) | list renderers | reusable |
| FN-012 | `dedupeToFamilies(items)` `#L99` | a list | one item per family | none | `familyKeyOf` (FN-010) | `reports-build.js` (`JS-014`), list renderers | reusable |
| FN-013 | `countUniqueAndCloned(items)` `#L115` | a list | `{unique, cloned}` counts | none | — | `collatedCountText` (FN-014) | reusable |
| FN-014 | `collatedCountText(arr)` / `collatedCountLabel(arr, noun)` `#L148/#L155` | a list (+ noun) | display string "N (M collated)" | none | `countUniqueAndCloned` (FN-013) | KPI / table headers across tabs | reusable |

## Data lineage

Input: a lead object *after* the real collation merge in `JS-003`
(`collatedFrom`, `siblingLeadIds`, `siblingRMs` fields already set) →
transformation: pure string/label formatting → output: HTML fragments
consumed by renderers. Persists nothing.

## Data sources accessed

None directly — operates on already-merged in-memory lead objects.

## Data written / modified

None.

## Failure / error behaviour

Defensive: `collationBadge` returns `''` when `collatedFrom < 2`;
`siblingNote` returns `''` with no siblings. No throw paths.

## Cross-runtime duplication

None. The Apps Script side reads the raw `leads` tab and does its own,
simpler grouping (`EmailInfra.gs` `readLeadsTab_`) — it does not use
this display layer.

## UI relationships

No buttons. Its output appears in `renderAlertCard` (`JS-010`) and
nearly every tab's card/table rows (`TAB-002`..`TAB-008`).

## Architecture relationship

`DASH-001`. Layer 5 (Transform / collation — display side) in
`LOGIC_AUDIT.md` Part 1 §1.

## Related documentation

`HANDOVER.md` §2, §3 step 2; `LOGIC_AUDIT.md` Part 1 §1 layer 5, §4b;
`DATA-001` (the core lead record flow).

## Relationships

- **Depends On:** `JS-003` (produces the merged lead objects it
  formats), `JS-010` (`esc`, forward ref)
- **Used By:** `JS-004`, `JS-010` (`renderAlertCard`), `JS-012`,
  `JS-014`, `JS-019`, `JS-021`, `JS-024`, `DATA-001` — most tab
  renderers
- **Related:** `JS-006` (`enrichLead` runs on the same merged objects)

## Source of truth

`js/core-collation.js` at `HEAD`.

## Validation

- **Method:** full read at `c82ec67`; function list verified by grep;
  cross-check `LOGIC_AUDIT.md` Part 1 §4b. Exercised end-to-end by
  `tests/frontend-harness.html` — synthetic multi-copy families run
  through `fetchAndRender` and the badges/labels appear in rendered
  output.
- **Evidence:** `LOGIC_AUDIT.md` Part 1 §4b; `tests/frontend-harness.html`.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-027.

## Revalidation trigger

Any commit touching `js/core-collation.js`; the merged-lead field shape
from `JS-003` changes (`collatedFrom` / `siblingLeadIds` / `siblingRMs`);
`esc` (`JS-010`) signature changes.

## Handover relationship

`HANDOVER.md` §3 step 2 covers collation at the pipeline level; this
module is the display half. Current as of 2026-09-09. A change to the
badge/label vocabulary does not need a `HANDOVER.md` edit unless the
"collate not dedupe" rule itself changes.

## Lifecycle / retention

N/A — code.

## Next action

none — Closed + Monitored.

## Closure evidence

Record committed for DOC-027; `docs/INDEX.md` `JS-002` → `Closed +
Monitored`, `Last Verified` 2026-09-10, links filled; validation
evidence as above. No `docs/changes/` record (DOC-027).
