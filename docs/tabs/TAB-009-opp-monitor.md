# TAB-009 — Opp Monitor

| | |
|---|---|
| **Type** | `TAB-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `dashboard.html` `#tab-oppmonitor`; `js/tab-oppmonitor.js` |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Validated |
| **Last Verified** | 2026-09-21 (pending commit — fill in the real sha immediately after committing, same session) |

## Purpose / reason to exist

Displays the recurring monthly Google Non-UTM/Search Same-day/48h Opp%
workflow — a 12-step-per-month cycle (3 periods x 3 steps + 3 month-level
steps) tracked as its own set of recurring reminder tasks in a separate
local To-Do Dashboard tool this app has no connection to. This tab exists
so the workflow's *results* (not the task-tracking itself) are visible on
the live production dashboard: a checklist of which of the 12 steps are
done for the in-progress month, plus a results/trend table for the
current month and the last 2 months. The checklist and the workflow's
official step tracking still only ever reflect whatever an external
analytics session has written into two new Sheet tabs.

**Changed 2026-09-21**: this is no longer the one tab computing nothing
and reading no live lead data — the `leads` tab gained a real `opp_at`
column, and any period/month slot with no official Sheet row yet is now
computed live, right here, straight from `leads`, and shown with a
"Live" tag rather than left blank. It's still the one tab ignoring the
shared filter bar (both the official and live numbers are fixed
aggregates for the stated scope), and the CHECKLIST specifically is
unaffected — step completion genuinely can't be computed, only recorded.

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

**Still no `filterState`**, but as of 2026-09-21 it DOES read the global
`leads` array (for the live-computation gap-fill — see Purpose). Inputs:
its own fetched `oppMonitorPeriodRows` / `oppMonitorMonthRows` (`JS-025`),
`leads` (`JS-003`), and `_renderNow` (`JS-006`, for "which month is
current").

## Outputs / what it renders

The checklist, Period Results table, and Monthly Trend table into
`#tab-oppmonitor`. No exports, no downloads.

## Data displayed

Per period: date range, total leads, same-day/48h opp counts, Same-day
Opp%, Within-48h Opp%, Avg Days/Hrs to Opp, and each percentage's delta
vs the immediately preceding period (chronological, crossing month
boundaries correctly — a month's Period 1 compares against the prior
month's Period 3). Per month: the same metrics + deltas vs the prior
month. A slot with no official Sheet row is filled with a live-computed
row (tagged "Live") whenever there's a qualifying lead in scope
(2026-09-21); otherwise it's simply omitted, never a blank placeholder. A
slot that already has an official row is never overridden by a live
computation, even if qualifying leads exist for that window.

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
- **No backfill for the OFFICIAL record**: a period/month never gets an
  official Sheet row invented after the fact, and the already-recorded
  July/August 2026 history was never touched by the 2026-09-21 change —
  this was an explicit user decision, not a technical limitation.
- **Live computation (2026-09-21)**: methodology matches the external
  analytics session's own exactly — same-day = `opp_at` on the same IST
  calendar day as `lead_assigned_at`; within-48h = the gap `<=48` hours; a
  negative gap (a data anomaly, not a real conversion) is excluded from
  every metric. Never overrides a slot with a real official row, even
  with qualifying leads in scope — see `JS-025` FN-268/269.
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

- **Depends On:** `EXT-001`, `JS-025`, `SHEET-001` (`leads`, via `opp_at`
  — added 2026-09-21), `SHEET-016`, `SHEET-017`
- **Used By:** `DASH-001`
- **Related:** shares `leads` with every other tab as of 2026-09-21 (was
  previously intentionally decoupled from all shared data) — still no
  `filterState`, and still the only tab hiding the shared filter bar

## Source of truth

`dashboard.html` `#tab-oppmonitor`; `js/tab-oppmonitor.js` at `HEAD`.

## Validation

- **Method:** built and verified in the same session as this record.
  `tests/frontend-harness.html` extended with an isolated-fixture block
  (synthetic `Opp_Monitor_Period`/`Opp_Monitor_Month` rows) asserting
  checklist chip counts, cross-month delta resolution, absent-row
  omission, and the filter-bar show/hide behavior. Live-sheet check done
  2026-09-18 (real `Opp_Monitor_Period`/`Month` data confirmed via
  screenshot). **Revalidated 2026-09-21** for the live-computation
  addition: 4 synthetic leads scoped to a real absent slot (Sep P3, per
  the frozen 2026-09-09 clock) produced exactly the hand-calculated
  expected metrics (25.0%/50.0%/50 hrs/2.08 days), AND a slot with a real
  sourced row was confirmed to never be overridden even with qualifying
  leads added (94/94 harness assertions pass). Also confirmed against the
  real production `leads` tab's own `opp_at` data via the signed-in
  dashboard.
- **Evidence:** `tests/frontend-harness.html`; commit `4bbb58c`; the
  2026-09-21 live-computation test block.
- **Status:** Validated 2026-09-21 (author-verified, solo project — no
  second-reviewer signal yet, so not `Closed + Monitored`).

## Version / change reference

Verified at `4bbb58c`; record created same commit (net-new feature, no
prior version). Revalidated 2026-09-21 for the live-computation feature —
this record's "reads neither `leads` nor `filterState`" / "computes
nothing" claims are now corrected throughout (still no `filterState`).

## Revalidation trigger

Any commit touching `js/tab-oppmonitor.js`; the `Opp_Monitor_Period` /
`Opp_Monitor_Month` column schema changes; the filter-bar-hiding
mechanism in `js/overview-distribution-people-ops.js` changes; the
12-step/3-period structure of the underlying workflow changes; the
live-computation methodology changes; `HEADER_ALIASES.opp_at` (`JS-009`)
changes.

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
