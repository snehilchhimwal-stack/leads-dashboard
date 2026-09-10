# TAB-005 — People

| | |
|---|---|
| **Type** | `TAB-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `dashboard.html` `#tab-people` (`#L1158`); `js/overview-distribution-people-ops.js` (RM/TL score tables, allocation) + `js/tab-rmtimeline.js` (the RM Timeline sub-view) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

The per-person view. It carries the RM and TL SLA-score tables, the
over/under-loaded flags, the fan-out / claim-rate and allocation-matrix
breakdowns, and it embeds **RM Timeline** — a per-RM 7-day calendar, a
day-timeline of that RM's dated events, their current open-issue list,
and an issue-history trend chart. It exists so a manager can go from
"this region is behind" to "this specific RM, on these specific days" in
one tab.

## Responsibilities

- Render the per-RM and per-TL score tables (score =
  `(open − breached) / open × 100`, over open leads only) and the ±25%
  load flags.
- Render the allocation matrix, fan-out and claim-rate breakdowns.
- Host RM Timeline: calendar, day timeline, open-issue list, trend chart.

## Who / what uses it

Regional heads / team leads doing per-RM review (`CLAUDE.md`).

## Inputs (which in-memory state arrays / filter state it reads)

`leads`, `issueLeads` (score tables, via `renderAll()`); RM Timeline
reads `movementSnapshots` + `passesMovementFilters` (`JS-021`),
`allParsedLeads` + `effectiveRegion` (`JS-014`), and `updateEventsFor`
(`JS-019`). RM Timeline is anchored to the top bar's "To" date but
**deliberately excludes** the top bar's Assigned-date range from its own
scoping (`rmtlScopedLeads()` — a fix for a real bug where an invalid
top-bar range emptied `leads` app-wide, blanking every RM's calendar).

## Outputs / what it renders

Score tables + allocation/fan-out cards into `#tab-people`; the RM
Timeline calendar / timeline / trend chart. No writes, no exports.

## Data displayed

Per-RM: open count, breached count, score, load-vs-peer flag. Per-TL:
same rolled up. RM Timeline: per-day call/issue counts, a dated-event
list, open issues, an issue-count trend line (reuses `JS-024`'s
`buildTrackingChartSvg` verbatim).

## Data written / modified

None.

## Navigation relationships

Reached from `#tabBar`. RM Timeline lives *inside* this tab (initialised
by `initRMTimelineUI()` from `JS-011`). Shares its score-table module and
`renderAll()` pass with `TAB-002` / `TAB-003`. RM Timeline reuses
`updateEventsFor` from `TAB-006` and the chart builder from `TAB-008`.

## Buttons / actions — `BTN-XXX` sub-table

| ID | Label | Element id | What it does | Invokes (`FN-XXX`) | Confirm/irreversible? | Failure behaviour |
|---|---|---|---|---|---|---|
| — | none | — | People / RM Timeline have no buttons; selection is via UI elements | — | no | — |

## Non-button UI elements — `UI-XXX` sub-table

| ID | Element | Behaviour | Invokes (`FN-XXX`) |
|---|---|---|---|
| UI-007 | RM selector (dropdown) | picks the RM whose timeline is shown | `renderRMTimelineTab` (`JS-023`) |
| UI-008 | 7-day calendar cells | click-to-select-day (event delegation); CSS-only hover today | `renderRMTimelineTab` (`JS-023`) |
| UI-009 | score tables | repainted every `renderAll()` | `computeRMScoreRows` / `renderRMTable` (`JS-012`) |

## Owning module(s)

`JS-012` (score tables, allocation), `JS-023` (`tab-rmtimeline.js`, the
timeline sub-view). Reciprocal `Used By: TAB-005` on both.

## Relevant functions

`computeRMScoreRows` / `renderRMTable` (`JS-012`); `renderRMTimelineTab`
/ `initRMTimelineUI` / `rmtlScopedLeads` (`JS-023`); borrowed
`updateEventsFor` (`JS-019`), `buildTrackingChartSvg` (`JS-024`). Detail
on those FN sub-tables.

## Important logic / business rules

- RM score is computed **only over open leads** (`computeRMScoreRows`,
  `JS-012`).
- `renderRMTable` flags an RM over/under-loaded at ±25% of the peer
  average open-lead count.
- `rmtlScopedLeads()` excludes the top-bar Assigned-date range on purpose
  (`LOGIC_AUDIT.md` Part 1 §4c).

## Exceptions & error handling

No RM selected / no dated leads for the RM → empty calendar, no error.
Empty `leads` → zeroed score tables.

## Architecture relationship

`DASH-001`. RM Timeline consumes `DATA-004` (Movement snapshot pipeline).

## Related documentation

`HANDOVER.md` §2, §3; `LOGIC_AUDIT.md` Part 1 §4c.

## Relationships

- **Depends On:** `JS-012`, `JS-023`, `JS-019` (`updateEventsFor`),
  `JS-024` (`buildTrackingChartSvg`), `JS-021` (`movementSnapshots`),
  `JS-014` (`effectiveRegion`), `JS-011` (`initRMTimelineUI` bootstrap)
- **Used By:** `DASH-001`
- **Related:** `TAB-002`, `TAB-003` (same module + `renderAll()` pass),
  `TAB-006` / `TAB-008` (shared helpers)

## Source of truth

`dashboard.html` `#tab-people`; `js/overview-distribution-people-ops.js`,
`js/tab-rmtimeline.js` at `HEAD`.

## Validation

- **Method:** read of `#tab-people` markup + the score-table and RM
  Timeline code paths at `c82ec67`; cross-check `LOGIC_AUDIT.md` Part 1
  §4c; `tests/frontend-harness.html` runs `renderAll` (score tables) and
  `renderRMTimelineTab` on synthetic data.
- **Evidence:** `LOGIC_AUDIT.md` Part 1 §4c; `tests/frontend-harness.html`.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-026.

## Revalidation trigger

Any commit touching `js/overview-distribution-people-ops.js` (score
tables/allocation) or `js/tab-rmtimeline.js`; the RM-score formula or the
±25% load threshold changes; `buildTrackingChartSvg` (`JS-024`) or
`updateEventsFor` (`JS-019`) changes signature; `#tab-people` markup
changes.

## Handover relationship

`HANDOVER.md` §2 names both files; §3 covers the render model. Current as
of 2026-09-09. A change to the RM-score formula should update
`HANDOVER.md` §3.

## Lifecycle / retention

N/A — code.

## Next action

none — Closed + Monitored.

## Closure evidence

Record committed for DOC-026; `docs/INDEX.md` `TAB-005` → `Closed +
Monitored`, `Last Verified` 2026-09-10; validation evidence as above. No
`docs/changes/` record (DOC-026).
