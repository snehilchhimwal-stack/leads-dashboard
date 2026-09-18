# TAB-009 — Opp Monitor

| | |
|---|---|
| **Type** | `TAB-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `dashboard.html` `#tab-oppmonitor`; `js/tab-oppmonitor.js` |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Validated |
| **Last Verified** | 2026-09-18 (pending commit) |

## Purpose / reason to exist

Displays the recurring monthly Google Non-UTM/Search Same-day/48h Opp%
workflow — a 12-step-per-month cycle (3 periods x 3 steps + 3 month-level
steps) tracked as its own set of recurring reminder tasks in a separate
local To-Do Dashboard tool this app has no connection to. This tab exists
so the workflow's *results* (not the task-tracking itself) are visible on
the live production dashboard: a checklist of which of the 12 steps are
done for the in-progress month, plus a results/trend table for the
current month and the last 2 months. It is the one tab in this app that
computes nothing and reads no live lead data at all — it only displays
whatever an external analytics session has already written into two new
Sheet tabs.

## Responsibilities

- Fetch `Opp_Monitor_Period` / `Opp_Monitor_Month` (`JS-025`).
- Render a 12-step checklist for the current month (done/pending +
  timestamp per step).
- Render a Period Results table (current month + last 2 months' periods,
  period-over-period delta badges).
- Render a Monthly Trend table (current + last 2 months, month-over-month
  delta badges).

## Who / what uses it

Whoever runs the recurring Opp% monitoring workflow (`HANDOVER.md` §2) —
a quick "what's done, what's the trend" view without leaving the
dashboard.

## Inputs (which in-memory state arrays / filter state it reads)

**Neither `leads` nor `filterState`** — the one tab in this app that
reads neither. Its only inputs are its own fetched
`oppMonitorPeriodRows` / `oppMonitorMonthRows` (`JS-025`) and `_renderNow`
(`JS-006`, for "which month is current").

## Outputs / what it renders

The checklist, Period Results table, and Monthly Trend table into
`#tab-oppmonitor`. No exports, no downloads.

## Data displayed

Per period: date range, total leads, Same-day Opp%, Within-48h Opp%, and
each metric's delta vs the immediately preceding period (chronological,
crossing month boundaries correctly — a month's Period 1 compares against
the prior month's Period 3). Per month: the same two metrics + deltas vs
the prior month. Absent rows (no data written yet — no backfill) are
simply omitted, never shown as a blank placeholder.

## Data written / modified

None — read-only tab. The two Sheet tabs it reads have **no writer in
this codebase at all** (see `SHEET-016`/`SHEET-017`) — a human or a
separate Claude session with analytics-tool access populates them
directly via the Sheets UI/API.

## Navigation relationships

Reached from `#tabBar`. Part of the `renderAll()` pass
(`renderOppMonitorTab`, `js/overview-distribution-people-ops.js`). The
**one tab that hides the shared filter bar** — see `## Important logic`
below.

## Buttons / actions — `BTN-XXX` sub-table

None — no interactive elements at all.

## Non-button UI elements — `UI-XXX` sub-table

None.

## Owning module(s)

`JS-025` (`js/tab-oppmonitor.js`). Reciprocal `Used By: TAB-009` on
`JS-025`.

## Relevant functions

`fetchOppMonitorData`, `_fetchOppMonitorTab`, `renderOppMonitorTab`,
`oppMonitorPctDelta` (`JS-025`). Detail on that file's own `FN-` sub-table.

## Important logic / business rules

- **Hides the shared filter bar** (`#filterBar`) while active — extends
  the tab-switch handler in `js/overview-distribution-people-ops.js`
  (`TABS_HIDING_FILTER_BAR` set). Confirmed via grep before building this
  that no such per-tab visibility mechanism existed anywhere in this app
  before this tab — genuinely new, not a reuse of an existing pattern.
  Every other tab's behavior is unchanged.
- **No backfill**: a period/month with no row yet is absent from its
  table, not a dash placeholder — this was an explicit user decision, not
  a technical limitation.
- Delta-badge rendering reuses `wowDeltaBadgeHtml` (`JS-024`) unmodified —
  no new visual language introduced for this tab.

## Exceptions & error handling

Missing `Opp_Monitor_Period`/`Opp_Monitor_Month` tabs (the normal state
until the recurring workflow's first cycle writes a row) → a "no data
yet" notice, not an error. A genuine fetch error (non-400 failure) → a
distinct "could not read" notice. Neither ever throws.

## Architecture relationship

`DASH-001`. Layer 10 (Render / UI) in `LOGIC_AUDIT.md` Part 1 §1 terms —
purely a display layer over externally-computed data, with no upstream
`DATA-XXX` pipeline of its own.

## Related documentation

`HANDOVER.md` §2; the plan file this feature was built from (session
2026-09-18) for the full design rationale.

## Relationships

- **Depends On:** `EXT-001`, `JS-025`, `SHEET-016`, `SHEET-017`
- **Used By:** `DASH-001`
- **Related:** none — this tab is intentionally decoupled from every
  other tab's data (no shared `leads`/`filterState`, no cross-tab reuse
  in either direction)

## Source of truth

`dashboard.html` `#tab-oppmonitor`; `js/tab-oppmonitor.js` at `HEAD`.

## Validation

- **Method:** built and verified in the same session as this record.
  `tests/frontend-harness.html` extended with an isolated-fixture block
  (synthetic `Opp_Monitor_Period`/`Opp_Monitor_Month` rows) asserting
  checklist chip counts, cross-month delta resolution, absent-row
  omission, and the filter-bar show/hide behavior — 87/87 harness
  assertions pass including these. No live-sheet check yet (needs a real
  sheet with the two new tabs populated, which won't exist until the
  recurring workflow's first real cycle).
- **Evidence:** `tests/frontend-harness.html`; commit `4bbb58c`.
- **Status:** Validated 2026-09-18 (author-verified, solo project — no
  second-reviewer signal yet, so not `Closed + Monitored`).

## Version / change reference

Verified at `4bbb58c`; record created same commit (net-new feature, no
prior version).

## Revalidation trigger

Any commit touching `js/tab-oppmonitor.js`; the `Opp_Monitor_Period` /
`Opp_Monitor_Month` column schema changes; the filter-bar-hiding
mechanism in `js/overview-distribution-people-ops.js` changes; the
12-step/3-period structure of the underlying workflow changes.

## Handover relationship

Not yet in `HANDOVER.md` — should be added (a short §2 entry) the next
time that file gets a real update pass, per this project's own "don't
let architecture changes sit undocumented" rule.

## Lifecycle / retention

N/A — code. The two Sheet tabs it reads have `TBD` retention (see
`SHEET-016`/`SHEET-017`).

## Next action

Add a `HANDOVER.md` §2 entry. Move `Record Status` to `Closed +
Monitored` once a live sheet with real `Opp_Monitor_Period`/
`Opp_Monitor_Month` data has been visually confirmed.

## Closure evidence

Not yet closed — `Record Status: Drafted`, pending the live-data check
noted above.
