<!-- ARCHITECTURE-LEVEL TEMPLATE. Use for FLOW-XXX (cross-file workflows) and
standalone TRIGGER-XXX records. Lives in docs/architecture/.
This is the living architecture view that HANDOVER.md §1-§3 hands over to
at graduation (Governance Model / CONSOLIDATED decision). -->

# <FLOW-ID or TRIGGER-ID> — <name>

<Table header block, Purpose, Responsibilities — as `component-record-template.md`.>

## What it is
<A workflow that spans several components / a scheduled job. One paragraph.>

## Reason to exist
<Why this workflow / trigger exists — the operational need. MANDATORY.>

## Participants (in execution order)
| Step | Component (`ID`) | What it does here |
|---|---|---|

## For a TRIGGER-XXX specifically
- **Schedule:** <exact `atHour`/`nearMinute`/`onWeekDay` etc.>
- **Target function:** `<FN-XXX>` in `<GS-XXX>`
- **Installed by:** `<setupXxx()>` — re-run required when the schedule changes
- **Timezone pin:** <`.inTimezone('Asia/Kolkata')` set? or relies on the project default?>

## Inputs / Outputs
<At the flow level: what triggers it, what it ultimately produces.>

## Data lineage
<The end-to-end path across the participant components. Link the
per-component records; don't restate them.>

## Business rules — `RULE-XXX` list
<The named decisions this flow applies. Link the sub-tables.>

## Exceptions & failure behaviour
<What happens if one participant fails partway — does the whole flow
abort, retry, skip? Is there a lock/collision concern (e.g. clear-vs-
concurrent-write)?>

## Known limitations
<`LOGIC_AUDIT.md` findings; documented gaps.>

<Then: Related documentation, Relationships, Source of truth, Validation,
Version/change reference, Revalidation trigger ("any participant component
goes Stale, or the trigger schedule changes"), Handover relationship,
Lifecycle/retention, Next action, Closure evidence — as generic.>

<!-- RECIPROCITY (t-tf-5ad22d8e4c2e, 2026-09-10): a FLOW-/TRIGGER- record
lists every participant in `Depends On` (those IDs must resolve — no
dangling; check-catalog.py A verifies this), but is NOT reciprocated:
`Used By: none`, and the participants do NOT gain `Used By: <this FLOW>`.
An overlay is a narrative view across components, not a dependency they'd
know about — the same reason HANDOVER.md references everything without the
reverse. This is the deliberate exception to NAMING_CONVENTIONS.md's
reciprocity rule (which governs the 69 own-file component rows). -->
