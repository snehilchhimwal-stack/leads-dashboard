# TAB-006 — Audit

| | |
|---|---|
| **Type** | `TAB-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `dashboard.html` `#tab-audit` (`#L1234`); `js/tab-audit.js` |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-29 against commit `4a06803` |

## Purpose / reason to exist

"When was this lead last actually touched." It scans every dated
comment / connect event on a lead across a chosen set of periods
(Today / Yesterday / This week / Last 7 days / Custom) and shows which
leads had activity in any selected period, plus an activity-by-hour
chart. It exists to answer the accountability question that the SLA
flags approximate — was there *any* real RM action in this window — from
the raw event log rather than a derived flag. It is the cleanest,
most self-contained tab implementation and is used as the reference
pattern for the others (`plan`: "Audit tab is the one fully-clean
reference implementation").

## Responsibilities

- Build the canonical per-lead dated-event list (`updateEventsFor`).
- Match it against any active period (OR across periods, not AND).
- Render the results table + the Activity-by-Hour chart.
- Provide copy-to-clipboard and CSV export.

## Who / what uses it

Regional heads / team leads verifying real RM activity in a window
(`HANDOVER.md` §2).

## Inputs (which in-memory state arrays / filter state it reads)

`leads` (post-`enrichLead`); `parseActionLog` / `combinedCommentsText`
(`JS-007`); the shared multi-select builder `buildMultiSelect`
(`JS-004`); its own period/date inputs (`#msAuditPeriod` + custom date
range).

## Outputs / what it renders

The audit results table + Activity-by-Hour chart into `#tab-audit`; a
clipboard copy; a CSV download.

## Data displayed

Per matched lead: identity, RM, the dated events that fell in an active
period. The chart bins all events by hour of day.

## Data written / modified

None.

## Navigation relationships

Reached from `#tabBar`. Part of the `renderAll()` pass (`renderAudit`).
Its `updateEventsFor()` is **also** read by RM Timeline (`TAB-005` /
`JS-023`) — it is the single definition of a lead's event list.

## Buttons / actions — `BTN-XXX` sub-table

| ID | Label | Element id | What it does | Invokes (`FN-XXX`) | Confirm/irreversible? | Failure behaviour |
|---|---|---|---|---|---|---|
| BTN-012 | Copy lead IDs | `#auditCopyBtn` | Copies the matched leads' lead IDs (one per line) to the clipboard, via `copyAuditIds` | `copyAuditIds` (`JS-019`) | no | clipboard-API failure → no-op, button text unchanged |
| BTN-013 | Download CSV | `#auditCsvBtn` | Exports the audit result rows as CSV | audit CSV handler (`JS-019`) | no (local download) | inert in a sandboxed viewer |

## Non-button UI elements — `UI-XXX` sub-table

| ID | Element | Behaviour | Invokes (`FN-XXX`) |
|---|---|---|---|
| UI-010 | `#msAuditPeriod` multi-select | picks which periods are active (OR) | `buildMultiSelect` (`JS-004`) → `auditMatches` (`JS-019`) |
| UI-011 | custom date-range inputs | defines the Custom period | `updateEventsFor` / `renderAudit` (`JS-019`) |

## Owning module(s)

`JS-019` (`js/tab-audit.js`). Reciprocal `Used By: TAB-006` on `JS-019`.

## Relevant functions

`renderAudit`, `renderActivityByHour`, `updateEventsFor`, `auditMatches`
(`JS-019`); borrowed `parseActionLog` / `combinedCommentsText` (`JS-007`),
`buildMultiSelect` (`JS-004`). Detail on those FN sub-tables.

## Important logic / business rules

- `updateEventsFor()` (`JS-019` `~#L56`) is the canonical per-lead event
  list (call-connect + every dated comment line) — the single definition
  both this tab and RM Timeline's Day Timeline read.
- `auditMatches()` uses **OR across periods** (any active period), not
  AND (`LOGIC_AUDIT.md` Part 1 §4c).

## Exceptions & error handling

No period selected → empty table. Clipboard API unavailable → copy
silently no-ops.

## Architecture relationship

`DASH-001`. Consumes `DATA-001` (the core lead record — its comment /
action-log fields).

## Related documentation

`HANDOVER.md` §2; `LOGIC_AUDIT.md` Part 1 §4c.

## Relationships

- **Depends On:** `JS-004` (`buildMultiSelect`), `JS-006` (`enrichLead`
  output on `leads`), `JS-007` (`parseActionLog`), `JS-019`
- **Used By:** `DASH-001`
- **Related:** `TAB-005` (shared event-list definition)

## Source of truth

`dashboard.html` `#tab-audit`; `js/tab-audit.js` at `HEAD`.

## Validation

- **Method:** read of `js/tab-audit.js` + `#tab-audit` markup at
  `c82ec67`; cross-check `LOGIC_AUDIT.md` Part 1 §4c;
  `tests/frontend-harness.html` runs `renderAudit` on synthetic leads.
  Re-verified 2026-09-29 (weekly doc-content spot-check, cycle 4): the
  `#tab-audit` line anchor and BTN-012's description were re-checked
  directly against current `dashboard.html` / `js/tab-audit.js` and
  corrected (see Closure evidence).
- **Evidence:** `LOGIC_AUDIT.md` Part 1 §4c; `tests/frontend-harness.html`.
- **Status:** Validated 2026-09-10; re-verified 2026-09-29.

## Version / change reference

Verified at `c82ec67`; record created by DOC-026. Line-anchor + BTN-012
drift fixed 2026-09-29 (`docs/_planning/weekly-spot-check-log.md` cycle 4)
— no underlying code change, doc-only correction.

## Revalidation trigger

Any commit touching `js/tab-audit.js`; `updateEventsFor`'s shape changes
(would also affect `TAB-005`); the period set or the OR-across-periods
rule changes; `#tab-audit` button/UI set changes.

## Handover relationship

`HANDOVER.md` §2 names the file. Current as of 2026-09-09. A change to
`updateEventsFor`'s event model should update `HANDOVER.md` §2's row and
note the `TAB-005` shared dependency.

## Lifecycle / retention

N/A — code.

## Next action

none — Closed + Monitored.

## Closure evidence

Record committed for DOC-026; `docs/INDEX.md` `TAB-006` → `Closed +
Monitored`, `Last Verified` 2026-09-10; `BTN-012`/`BTN-013` rows added;
validation evidence as above. No `docs/changes/` record (DOC-026).

**2026-09-29 spot-check fix:** `#tab-audit`'s line anchor had drifted
`#L1233` → real `#L1234` (off by one — a blank line was inserted above
it by an intervening commit not otherwise touching this record). BTN-012
also mis-described the Copy button's real behaviour: it copies only the
matched leads' `lead_id`s (one per line, via `copyAuditIds`), not "the
audit result table" — the dashboard's own button label already reads
"Copy lead IDs" and was never wrong, only this record's `## Buttons /
actions` row text was. No code changed.
