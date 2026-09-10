<!-- CLIENT-SIDE JS MODULE TEMPLATE (JS-XXX). One per js/*.js file. -->

# <JS-ID> — <filename>

<Table header block, Purpose, Responsibilities — as `component-record-template.md`.>

## Load order / position
<Where in `dashboard.html`'s script list; what must load before it.>

## Significant functions — `FN-XXX` sub-table
| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-0NN | `name()` | ... | ... | reads/writes `<state>` / DOM `<id>` | `FN-...` | `FN-...` / `BTN-...` | reusable / specific |

## Business rules implemented — `RULE-XXX` sub-table (optional)
| ID | Rule | Where | Duplicated in (`GS-XXX`)? | Notes |
|---|---|---|---|---|
| RULE-00N | ... | `FN-0NN` | `GS-0NN` `<const>` | keep both in sync — see `HOW_TO_UPDATE_A_COMPONENT.md` |

## Config constants — `CFG-XXX` sub-table (optional)
| ID | Constant | Value | Meaning | Changing it affects |
|---|---|---|---|---|
| CFG-00N | `NAME` | `8` | ... | `RULE-0NN`, downstream `<IDs>` |

## Exceptions — `EXC-XXX` sub-table (optional)
| ID | Condition | Handling | User-visible result |
|---|---|---|---|

## Data lineage
<Origin → Transformation → Stored As (which `movementSnapshots` / state
var) → Consumed By (`TAB-XXX` / other `JS-XXX`). Per DOC-018.>

## Data sources accessed
<`SHEET-XXX` tabs read (via `sheetsApiValuesGet`), `EXT-XXX`.>

## Data written / modified
<`SHEET-XXX` tabs written; `EXT-XXX` (Gmail send). Which `FN-XXX` does it.>

## Failure / error behaviour
<What the module does on a bad fetch / missing tab / OAuth failure.>

## Cross-runtime duplication
<If any `RULE-XXX`/parser here is intentionally duplicated in a `GS-XXX`
file — name the pair. `HANDOVER.md` §6.>

<Then: UI relationships, Architecture relationship, Related documentation,
Relationships, Source of truth, Validation (`tests/frontend-harness.html`
+ which asserts), Version/change reference, Revalidation trigger ("any
commit touching `js/<filename>`"), Handover relationship, Lifecycle/
retention (N/A), Next action, Closure evidence — as generic.>
