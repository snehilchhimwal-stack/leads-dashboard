<!-- DATA FLOW TEMPLATE (DATA-XXX). A traced path, not a file. -->

# <DATA-ID> — <name of the flow>

<Table header block, Purpose, Responsibilities — as `component-record-template.md`.>

## Origin
<Where the data starts — a `SHEET-XXX`, an `EXT-XXX`, user input.>

## Transformation
<Each step, in order, with the `JS-XXX`/`GS-XXX` `FN-XXX` that does it.
Reference `RULE-XXX` for any business logic applied along the way.>

## Stored As
<Intermediate state (`movementSnapshots`, a state var) and/or a
`SHEET-XXX` it lands in.>

## Display
<Which `TAB-XXX` / `UI-XXX` shows it, if any.>

## Ultimate consumer(s)
<Human on screen, an email recipient, another `DATA-XXX`, a `SHEET-XXX`.>

## Retention
<Point at the owning `SHEET-XXX` record's Data Lifecycle — do NOT restate
it here. If the flow is purely in-memory, "N/A — not persisted".>

## What happens on update
<If a source row changes, what re-derives and when (next fetch? next
trigger? not until manual recalc?).>

## What happens on delete
<If a source row is deleted, what the flow does — silently drops it,
errors, leaves a stale downstream copy.>

## Known gaps
<`LOGIC_AUDIT.md` Part 2 dead-ends; the Loan-region `group_source`-vs-
`project_region` bucketing gap; etc.>

<Then: Exceptions, Architecture relationship (`FLOW-XXX`), Related
documentation, Relationships, Source of truth, Validation,
Version/change reference, Revalidation trigger, Handover relationship,
Lifecycle/retention (link the SHEET record), Next action, Closure
evidence — as generic.>
