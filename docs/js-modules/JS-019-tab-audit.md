# JS-019 — tab-audit.js

| | |
|---|---|
| **Type** | `JS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `js/tab-audit.js` (299 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

Implements the Audit tab (`TAB-006`): "when was this lead last actually
touched." It builds the canonical per-lead dated-event list
(`updateEventsFor` — call-connect + every dated comment line), matches it
across a chosen set of periods (OR, not AND), and renders the results
table plus an Activity-by-Hour chart. It exists as the one definition of
"a lead's event list" — RM Timeline's Day Timeline (`JS-023`) reads the
same `updateEventsFor`. It is the cleanest, most self-contained tab
module and is the reference pattern for the others.

## Responsibilities

- `updateEventsFor(l)` — the canonical per-lead event list.
- `activeAuditRanges` / `auditMatches` — period matching (OR across
  active periods).
- `renderAudit` / `renderActivityByHour` — the two renders.
- `copyAuditIds` / `downloadAuditCSV` — export.
- `buildAuditControls` — the period multi-select + custom date range.

## Load order / position

First of the tab files in the real `<script src>` order (`… core-filters
→ tab-audit → tab-tracking → …`), so `updateEventsFor` is defined before
`tab-rmtimeline.js` reuses it.

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-132 | `updateEventsFor(l)` `#L56` | a lead | its canonical dated-event list (call-connect + every dated comment line), sorted | caches on the lead object | `parseActionLog` / `combinedCommentsText` (`JS-007`), `parseDate` (`JS-006`) | `auditMatches` (FN-133), `renderAudit` (FN-134), `renderRMDayTimeline` (`JS-023`) | reusable — **the single event-list definition** shared with RM Timeline |
| FN-133 | `auditMatches()` / `activeAuditRanges()` `#L82/#L71` | `leads`, `#msAuditPeriod` state | leads with ≥1 event in any active period | none | FN-132 | `renderAudit` (FN-134) | specific — **OR across periods**, not AND |
| FN-134 | `renderAudit()` `#L109` | `leads` | the audit results table | DOM write | FN-133, `updateEventsFor` (FN-132), `buildMultiSelect` (`JS-004`), `esc` (`JS-010`) | `renderAll` (`JS-012`) | specific |
| FN-135 | `renderActivityByHour()` `#L183` | `leads` events | the Activity-by-Hour bar chart | DOM write | FN-132, `istParts` (`JS-005`) | `renderAll` (`JS-012`) | specific |
| FN-136 | `auditLeadIds(rows)` / `copyAuditIds()` / `downloadAuditCSV()` `#L96/#L241/#L253` | matched rows | the lead-id list / a clipboard copy / a CSV download | clipboard / download | `csvEscape` (`JS-012`) | `#auditCopyBtn` (`BTN-012`), `#auditCsvBtn` (`BTN-013`) | reusable |
| FN-137 | `buildAuditControls()` `#L278` | — | the period multi-select + custom date-range inputs | DOM write | `buildMultiSelect` (`JS-004`) | render init | specific |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-039 | no period selected | `auditMatches` returns `[]` | empty table, no error |
| EXC-040 | clipboard API unavailable | `copyAuditIds` silently no-ops | copy button does nothing rather than throwing |
| EXC-041 | a lead with no dated events | excluded from all periods | not shown — correct |

## Data lineage

`leads` (state, from `JS-004`) → `updateEventsFor` (FN-132) builds the
per-lead event list from `parseActionLog` output → `auditMatches`
(FN-133) filters by active period → `renderAudit` / `renderActivityByHour`
→ screen; `downloadAuditCSV` → a CSV blob. Nothing persists. Consumes
`DATA-001` (the core lead record's comment/action-log fields).

## Data sources accessed

Reads `leads` (state). No `SHEET-XXX` read of its own.

## Data written / modified

None — read-only tab. Exports are local downloads / clipboard.

## Failure / error behaviour

Fully defensive — empty period sets, missing clipboard, event-less leads
all handled as no-ops. No throw paths.

## Cross-runtime duplication

None — the Audit tab has no backend counterpart. `updateEventsFor` is
shared *within* the client (with `JS-023`), not across runtimes.

## UI relationships

`#tab-audit` panel; `#msAuditPeriod` multi-select (`UI-010`), custom
date-range inputs (`UI-011`), `#auditCopyBtn` (`BTN-012`), `#auditCsvBtn`
(`BTN-013`) — all on `TAB-006`.

## Architecture relationship

`DASH-001`. Layer 10 (Render / UI). Belongs to `TAB-006`.

## Related documentation

`HANDOVER.md` §2; `LOGIC_AUDIT.md` Part 1 §4c.

## Relationships

- **Depends On:** `JS-002`, `JS-004` (`buildMultiSelect`), `JS-005`
  (`istParts`), `JS-006` (`parseDate`), `JS-007` (`parseActionLog`,
  `combinedCommentsText`), `JS-010` (`esc`), `JS-012` (`csvEscape`,
  called from `renderAll`)
- **Used By:** `TAB-005`, `TAB-006`, `JS-012` (`renderAll` calls
  `renderAudit` / `renderActivityByHour`), `JS-023` (RM Timeline reuses
  `updateEventsFor`)
- **Related:** `TAB-005` (RM Timeline — shares the event-list definition)

## Source of truth

`js/tab-audit.js` at `HEAD`.

## Validation

- **Method:** full read at `c82ec67`; function list verified by grep;
  cross-check `LOGIC_AUDIT.md` Part 1 §4c (`updateEventsFor` `~#L56`,
  OR-across-periods). `tests/frontend-harness.html` runs `renderAudit`
  on synthetic leads with known event timestamps.
- **Evidence:** `LOGIC_AUDIT.md` Part 1 §4c; `tests/frontend-harness.html`.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-028.

## Revalidation trigger

Any commit touching `js/tab-audit.js`; `updateEventsFor`'s event model
changes (also affects `JS-023` / `TAB-005`); the period set or the
OR-across-periods rule changes; `#tab-audit` control set changes.

## Handover relationship

`HANDOVER.md` §2 names the file. Current as of 2026-09-09. A change to
`updateEventsFor`'s shape should update `HANDOVER.md` §2 and note the
`JS-023` shared dependency.

## Lifecycle / retention

N/A — code.

## Next action

none — Closed + Monitored.

## Closure evidence

Record committed for DOC-028; `docs/INDEX.md` `JS-019` → `Closed +
Monitored`, `Last Verified` 2026-09-10, reciprocal `Used By: TAB-006`
+ `JS-023` confirmed; `EXC-039`..`041` recorded. No `docs/changes/`
record (DOC-028).
