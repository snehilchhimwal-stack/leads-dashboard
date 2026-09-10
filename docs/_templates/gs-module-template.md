<!-- APPS SCRIPT BACKEND MODULE TEMPLATE (GS-XXX). One per production .gs file
(Tests_*.gs excluded — they get one combined note on the GS record they test). -->

# <GS-ID> — <filename>

<Table header block, Purpose, Responsibilities — as `component-record-template.md`.>

## Trigger schedule
<Exact `atHour()` / `nearMinute()` / `everyDays()` / `onWeekDay()` values,
whether `.inTimezone()` is set (flag `OvernightEmailer.gs`'s known outlier),
the `setupXxx()` function that installs it, and its `TRIGGER-XXX` id if it
has its own architecture record. "None — called only from other .gs files"
if it has no trigger of its own.>

## Requires `setupXxx()` re-run when
<Schedule changes only — per `CLAUDE.md`'s gotcha. State this explicitly so
it doesn't get over-applied to every `.gs` edit. Name the setup function.>

## Significant functions — `FN-XXX` sub-table
<Same shape as the JS module template's FN sub-table.>

## Business rules implemented — `RULE-XXX` sub-table (optional)
<Same shape as JS. Flag any pair duplicated in a `JS-XXX` file.>

## Config constants — `CFG-XXX` sub-table (optional)
<Same shape as JS.>

## Exceptions — `EXC-XXX` sub-table (optional)
<Same shape as JS. Include `withRetry_` / `withSendRetry_` behaviour where
relevant.>

## Data lineage
<Which `SHEET-XXX` tabs it reads / writes; the shape of what it writes.
Per DOC-018.>

## Sheets touched
| `SHEET-XXX` | Read / Write | Which `FN-XXX` | Notes |
|---|---|---|---|

## Failure / error behaviour
<Re-throw vs. swallow; whether a failure shows in Apps Script Executions
as Failed; retry/backoff.>

## Cross-runtime duplication
<Logic intentionally mirrored from a `js/*.js` file — name the pair.
`HANDOVER.md` §6, `LOGIC_AUDIT.md` Part 4.>

## Not live until pasted
<Standing reminder: a `.gs` edit in the repo is not running until pasted
into the Sheet's Apps Script editor. `CLAUDE.md` top gotcha.>

<Then: Architecture relationship, Related documentation, Relationships,
Source of truth, Validation (`Tests_<filename>.gs` + which asserts + last
green CI run), Version/change reference, Revalidation trigger ("any commit
touching `<filename>` or its `Tests_` file"), Handover relationship,
Lifecycle/retention (N/A), Next action, Closure evidence — as generic.>
