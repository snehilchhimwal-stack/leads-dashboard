# JS-023 — tab-rmtimeline.js

| | |
|---|---|
| **Type** | `JS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `js/tab-rmtimeline.js` (309 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

Implements RM Timeline, which lives inside the People tab (`TAB-005`): a
per-RM 7-day calendar (anchored to the top bar's "To" date), a
day-timeline of that RM's dated events, their current open-issue list,
and an issue-history trend chart (the chart builder is reused verbatim
from Tracking). It exists so a manager can drill from "this region is
behind" straight to "this RM, on these days." Its one subtle behaviour:
`rmtlScopedLeads()` deliberately ignores the top bar's Assigned-date
range — a fix for a real bug where an invalid top-bar range emptied
`leads` app-wide and blanked every RM's calendar at once.

## Responsibilities

- `rmtlScopedLeads()` — the RM-Timeline-local lead scope (excludes the
  top-bar Assigned-date range).
- `populateRMTimelineSelect` — the RM picker.
- `renderRMDailyCalendar` / `renderRMDayTimeline` / `renderRMIssueList` /
  `renderRMIssueHistory` — the four sub-views.
- `renderRMTimelineTab` — orchestrate them.
- `initRMTimelineUI` — wire the picker + calendar (a `main.js` bootstrap
  call).

## Load order / position

In the tab group before `main.js`; `initRMTimelineUI()` is one of
`main.js`'s 4 bootstrap calls (`LOGIC_AUDIT.md` Part 1 §4b).

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-156 | `rmtlScopedLeads()` `#L28` | `allParsedLeads` | the lead set for RM Timeline — **excludes the top bar's Assigned-date range** from scoping | none | `effectiveRegion` (`JS-014`) | FN-157, FN-158, FN-159 | specific — documented fix for the "invalid top-bar range empties every RM's calendar" bug |
| FN-157 | `renderRMDailyCalendar(rm, selectedDay, scopedLeads)` `#L68` | RM, a day, scoped leads | the 7-day calendar grid (anchored to the top bar's "To" date), click-to-select-day via delegation, CSS-only hover | DOM write | `istDateKey` / `istAddDays` (`JS-005`), `passesMovementFilters` (`JS-021`) | `renderRMTimelineTab` (FN-161) | specific |
| FN-158 | `renderRMDayTimeline(rm, dayKey, scopedLeads)` `#L130` | RM, a day, scoped leads | that day's dated-event list for the RM | DOM write | `updateEventsFor` (`JS-019`) | FN-161 | specific — reuses the Audit tab's event-list definition |
| FN-159 | `renderRMIssueList(rm)` `#L164` | RM | the RM's current open-issue list | DOM write | `enrichLead` output on `issueLeads` | FN-161 | specific |
| FN-160 | `computeIssueTalliesByRunForRM(rmName)` / `renderRMIssueHistory(rm)` `#L192/#L225` | RM | the RM's issue-count-over-time trend chart | DOM write | `buildTrackingChartSvg` (`JS-024`, **reused verbatim**), `movementSnapshots` (`JS-021`) | FN-161 | specific |
| FN-161 | `renderRMTimelineTab()` / `populateRMTimelineSelect(scopedLeads)` / `initRMTimelineUI()` `#L248/#L49/#L292` | selected RM | orchestrates the 4 sub-views; populates the RM picker; wires the UI | DOM writes / listeners | FN-156..FN-160 | `renderAll` (`JS-012`), `main.js` (`JS-011`) | specific |

## Business rules implemented — `RULE-XXX` sub-table

| ID | Rule | Where | Duplicated in (`GS-XXX`)? | Notes |
|---|---|---|---|---|
| RULE-027 | RM Timeline's own lead scope **excludes** the top-bar Assigned-date range — so an invalid top-bar range doesn't empty every RM's calendar simultaneously | FN-156 | No | documented fix for a real bug (`LOGIC_AUDIT.md` Part 1 §4c) |
| RULE-028 | The issue-history trend chart reuses `JS-024`'s `buildTrackingChartSvg` **verbatim** — one chart implementation, two tabs | FN-160 | No | `LOGIC_AUDIT.md` Part 1 §4c |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-049 | no RM selected | the sub-views render empty | blank calendar/timeline, no error |
| EXC-050 | an RM with no dated leads in the window | empty calendar | correct — nothing to show |
| EXC-051 | `movementSnapshots` not loaded | the trend chart renders empty | the other three sub-views still render from `leads` / `issueLeads` |

## Data lineage

`allParsedLeads` (state) → `rmtlScopedLeads` (FN-156) → per-RM views;
`updateEventsFor` (`JS-019`) supplies the day-timeline events;
`movementSnapshots` (`JS-021`) + `buildTrackingChartSvg` (`JS-024`)
supply the trend chart. Nothing persists. Consumes `DATA-004` (Movement
snapshot pipeline).

## Data sources accessed

Reads `allParsedLeads` / `issueLeads` / `movementSnapshots` (state). No
`SHEET-XXX` read of its own.

## Data written / modified

None — read-only sub-view.

## Failure / error behaviour

Fully defensive — no RM, no dated leads, or an unloaded
`movementSnapshots` each degrade one sub-view to empty without affecting
the others (EXC-049..051). No throw paths.

## Cross-runtime duplication

None. The two reuse relationships (`updateEventsFor` from `JS-019`,
`buildTrackingChartSvg` from `JS-024`) are *within* the client — the
opposite of duplication.

## UI relationships

Lives inside `#tab-people` (`TAB-005`): the RM selector (`UI-007`), the
7-day calendar cells (`UI-008`). `initRMTimelineUI` is a `main.js`
bootstrap call. No buttons.

## Architecture relationship

`DASH-001`. Layer 10 (render). Belongs to `TAB-005` (People).

## Related documentation

`HANDOVER.md` §2; `LOGIC_AUDIT.md` Part 1 §4c.

## Relationships

- **Depends On:** `JS-019` (`updateEventsFor`), `JS-024`
  (`buildTrackingChartSvg`), `JS-021` (`movementSnapshots`,
  `passesMovementFilters`), `JS-014` (`effectiveRegion`), `JS-005` (IST
  helpers), `JS-003` (`allParsedLeads`), `JS-011` (`initRMTimelineUI`
  bootstrap)
- **Used By:** `TAB-005`; `JS-012` (`renderAll` calls
  `renderRMTimelineTab`); `JS-011` (`initRMTimelineUI`)
- **Related:** `TAB-006` (shares the event-list definition), `TAB-008`
  (shares the chart builder)

## Source of truth

`js/tab-rmtimeline.js` at `HEAD`.

## Validation

- **Method:** full read at `c82ec67`; function list verified by grep;
  cross-check `LOGIC_AUDIT.md` Part 1 §4c (`rmtlScopedLeads` bug fix,
  verbatim chart reuse). `tests/frontend-harness.html` runs
  `renderRMTimelineTab` on synthetic data.
- **Evidence:** `LOGIC_AUDIT.md` Part 1 §4c; `tests/frontend-harness.html`.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-028.

## Revalidation trigger

Any commit touching `js/tab-rmtimeline.js`; `rmtlScopedLeads`'s
exclude-the-Assigned-range behaviour changes; `updateEventsFor`
(`JS-019`) or `buildTrackingChartSvg` (`JS-024`) signature changes; the
calendar anchor (top-bar "To" date) semantics change.

## Handover relationship

`HANDOVER.md` §2 names the file. Current as of 2026-09-09. A change to
`rmtlScopedLeads`'s scoping rule should update `HANDOVER.md` §2's row (it
is a real-bug fix worth keeping visible).

## Lifecycle / retention

N/A — code.

## Next action

none — Closed + Monitored.

## Closure evidence

Record committed for DOC-028; `docs/INDEX.md` `JS-023` → `Closed +
Monitored`, `Last Verified` 2026-09-10, reciprocal `Used By: TAB-005`
+ links to `JS-019` / `JS-024` confirmed; `RULE-027`/`028`,
`EXC-049`..`051` recorded. No `docs/changes/` record (DOC-028).
