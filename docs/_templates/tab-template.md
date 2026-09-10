<!-- DASHBOARD UI TAB TEMPLATE (TAB-XXX). NOT a Google Sheet tab (that's SHEET-XXX). -->

# <TAB-ID> — <Name>

<Table header block, Purpose, Responsibilities — as `component-record-template.md`.>

## Who / what uses it
## Inputs (which in-memory state arrays / filter state it reads)
## Outputs / what it renders
## Data displayed
## Data written / modified (via which `JS-XXX` write function)
## Navigation relationships (how you get here; what it links to)

## Buttons / actions — `BTN-XXX` sub-table
| ID | Label | Element id | What it does | Invokes (`FN-XXX`) | Confirm/irreversible? | Failure behaviour |
|---|---|---|---|---|---|---|
| BTN-00N | ... | `#...` | ... | `FN-0NN` | ... | ... |

## Non-button UI elements — `UI-XXX` sub-table (optional)
| ID | Element | Behaviour | Invokes (`FN-XXX`) |
|---|---|---|---|
| UI-00N | ... | ... | ... |

## Owning module(s)
<`JS-XXX` file(s) that implement this tab. Reciprocal `Used By` on those.>

## Relevant functions
<`FN-XXX` list — the functions that render/handle this tab. Detail is in
the owning `JS-XXX` record's FN sub-table, linked, not restated.>

<Then: Important logic / business rules, Exceptions & error handling,
Architecture relationship, Related documentation, Relationships, Source of
truth, Validation, Version/change reference, Revalidation trigger,
Handover relationship, Lifecycle/retention (usually N/A), Next action,
Closure evidence — as generic.>
