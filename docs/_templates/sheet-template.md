<!-- GOOGLE SHEET TAB TEMPLATE (SHEET-XXX). NOT a dashboard UI tab (that's TAB-XXX). -->

# <SHEET-ID> — <tab name>

<Table header block, Purpose, Responsibilities — as `component-record-template.md`.>

## Reason to exist
<Why this tab exists at all — MANDATORY, and distinct from "what data it
holds." e.g. "Movement_Log exists so the dashboard can reconstruct SLA
history for a past day that the live leads tab no longer reflects.">

## Data stored
## Source of the data (who/what writes it — `JS-XXX` / `GS-XXX` / manual / a formula)
## Destination / consumers (`JS-XXX` / `GS-XXX` / `TAB-XXX` that read it)

## Columns / fields
| Column | Type | Meaning | Notes (auto-Date coercion? blank-allowed?) |
|---|---|---|---|

## Critical ranges — `RANGE-XXX` sub-table (optional)
| ID | Range | Why it's special (header banner, lookup, conditional-format anchor) |
|---|---|---|

## Writers
| `JS-XXX` / `GS-XXX` | Which `FN-XXX` | Append / upsert / overwrite / clear |
|---|---|---|

## Readers
| `JS-XXX` / `GS-XXX` / `TAB-XXX` | Which `FN-XXX` | What they use it for |
|---|---|---|

## Automation / triggers touching it
<`TRIGGER-XXX` list — scheduled captures, prunes, nightly writes.>

## Apps Script functions touching it
<`GS-XXX` `FN-XXX` list — read + write.>

<!-- DOC-046 — RECORDING RETENTION GOING FORWARD (do this when you create
this record, not "later"):
  * `## Data Lifecycle` below MUST be filled at creation. No blank fields.
  * `Retention Period` = a REAL confirmed value (grep the codebase for a
    `prune*_` / `clear*` function that touches this tab) OR the literal
    string `TBD`. NEVER invent a number.
  * If it's `TBD`: add a one-line row for this tab to
    `../_planning/OPEN_ITEMS.md` §B (that file is kept alive going
    forward, not archived) so the open question is tracked.
  * If a real prune function is later added, that's a `.gs`/`.js` change
    with its own task — then fold the confirmed value back into this
    field.
See ../HOW_TO_REGISTER_A_COMPONENT.md example 5. -->

## Data Lifecycle   (DOC-019 — fill from a real value or literal `TBD` + an `OPEN_ITEMS.md` §B entry)
- **Data Type:** historical / temporary / cached / operational / configuration
- **Retention Period:** `<real value>` or `TBD` (never invented — if unknown, write `TBD` and add a row to `../_planning/OPEN_ITEMS.md` §B)
- **Enforced By:** `<the FN-XXX / TRIGGER-XXX that actually prunes it>` or `None` (retention currently unenforced)
- **Archive / Delete Behavior:** <what happens to aged-out rows — deleted in place, moved, row-count shrunk>
- **Sensitivity:** operational / configuration / contains real employee data / `TBD` (`DOC-038`: also state operational importance — CRITICAL / IMPORTANT / LOW — with a one-line reason)

<!-- WORKED EXAMPLES — two real, confirmed values, so Phase 4 starts from a
pattern not a blank:

  Movement_Log:
    Data Type:        historical
    Retention Period: 7 days
    Enforced By:      FN pruneMovementLog_  (MovementTracker.gs)
    Archive/Delete:   old rows deleted in place; row allocation shrunk in the same run
    Sensitivity:      operational

  Daily_RM_Issues:
    Data Type:        historical
    Retention Period: 7 days  (as of the 2026-09-07 fix)
    Enforced By:      FN pruneDailyRmIssueLog_  (DailyRmIssueLog.gs — added 2026-09-07 after a real cell-limit incident)
    Archive/Delete:   old rows deleted in place; row allocation shrunk
    Sensitivity:      operational
-->

## Risks of changing this tab's structure
<Which writers/readers break if a column moves; the self-healing header
logic if any; the Date-vs-string coercion trap.>

## Relationships to other tabs
<`SHEET-XXX` IDs it feeds or is fed by.>

<Then: Important logic, Exceptions, Related documentation
(`LEAD_FOLLOWUPS_STALENESS.md` for `Lead_Followups`; `HANDOVER.md` §5/§8),
Relationships, Source of truth (the live Sheet + the `.gs` that defines
its `SNAPSHOT_COLUMNS_` if applicable), Validation, Version/change
reference, Revalidation trigger ("column change, retention change, or a
new writer/reader"), Handover relationship, Next action, Closure evidence
— as generic.>
