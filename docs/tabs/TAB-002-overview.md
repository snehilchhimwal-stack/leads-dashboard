# TAB-002 — Overview

| | |
|---|---|
| **Type** | `TAB-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `dashboard.html` `#tab-overview` (`#L957`); `js/overview-distribution-people-ops.js` |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

The default landing tab: a KPI strip plus the funnel / region / TL /
project / source breakdown tables that answer "where does the desk stand
right now." It exists so a manager gets the top-line shape of the
pipeline (volume, stage distribution, source mix, per-region load)
without drilling into any single lead. It is the first of four tabs
(`TAB-002`/`TAB-003`/`TAB-005` here, plus Distribution content) served by
the one large `renderAll()` orchestrator module.

## Responsibilities

- Render the KPI strip (Total Leads, Opportunities, etc.).
- Render funnel-stage, region, TL, project and source breakdown tables.
- Stay consistent with the active `filterState` (re-rendered by
  `applyFiltersAndRender`).

## Who / what uses it

Regional heads / team leads (`CLAUDE.md`); the tab shown on first load
(`class="tab-panel active"`).

## Inputs (which in-memory state arrays / filter state it reads)

`leads`, `issueLeads` (post-`enrichLead`), plus `filterState`
indirectly — `renderAll()` is invoked after `applyFiltersAndRender`
rebuilds those arrays (`JS-004`).

## Outputs / what it renders

KPI tiles + breakdown tables into `#tab-overview`. Feeds the
`#sourceBreakdown` region. No writes.

## Data displayed

KPI counts; per-stage / per-region / per-TL / per-project / per-source
lead counts and shares; the source mix. The KPI strip mixes
customer-level and issue-level counts (documented undocumented-in-UI
`LOGIC_AUDIT.md` Part 7 §18 LOW #2).

## Data written / modified

None directly. (The "Download Lead IDs" control sits in the shared top
bar, not this tab — see `DASH-001` top-level actions.)

## Navigation relationships

Default active panel; reached from `#tabBar`. Shares its owning module
and `renderAll()` pass with `TAB-003` and `TAB-005`.

## Buttons / actions — `BTN-XXX` sub-table

| ID | Label | Element id | What it does | Invokes (`FN-XXX`) | Confirm/irreversible? | Failure behaviour |
|---|---|---|---|---|---|---|
| — | none in-panel | — | Overview's controls (Download Lead IDs, Clear filters, Refresh, Change source) live in the shared top bar on `DASH-001` | — | no | — |

## Non-button UI elements — `UI-XXX` sub-table

| ID | Element | Behaviour | Invokes (`FN-XXX`) |
|---|---|---|---|
| UI-002 | breakdown tables | static, repainted every `renderAll()` | `renderAll` (`JS-012`) |

## Owning module(s)

`JS-012` (`js/overview-distribution-people-ops.js`). Reciprocal
`Used By: TAB-002, TAB-003, TAB-005` on `JS-012`.

## Relevant functions

`renderAll` and its internal `render*` helpers (KPI strip, breakdown
cards), `topBreakdown`, `computeDailyLeadCounts` — detail on the `JS-012`
FN sub-table, not restated.

## Important logic / business rules

`_logLeadRegistry.clear()` runs at the top of `renderAll()` (`JS-012`
`#L164`) — the previously-flagged unbounded-growth concern is already
addressed (`LOGIC_AUDIT.md` Part 6 §6.1 row 1). KPI customer-vs-issue
mixing: `LOGIC_AUDIT.md` Part 7 §18 LOW #2.

## Exceptions & error handling

Empty `leads` → zeroed tiles/tables. No own error path; fetch errors are
surfaced by `JS-003` (`showError`).

## Architecture relationship

`DASH-001`. Part of the `renderAll()` render layer (`LOGIC_AUDIT.md` Part
1 §1 layer 10).

## Related documentation

`HANDOVER.md` §2, §3; `LOGIC_AUDIT.md` Part 1 §4c, Part 5 §5.1 (KPI
audit), Part 7 §18 LOW #2.

## Relationships

- **Depends On:** `JS-012`, `JS-004` (filter/render trigger), `JS-006`
  (`enrichLead` output), `JS-009` (state)
- **Used By:** `DASH-001`
- **Related:** `TAB-003`, `TAB-005` (same module + `renderAll()` pass),
  `TAB-008` (cohort-correct counterparts to some Overview rates)

## Source of truth

`js/overview-distribution-people-ops.js` at `HEAD`; `dashboard.html`
`#tab-overview`.

## Validation

- **Method:** read of the `#tab-overview` markup + the `renderAll` KPI /
  breakdown code paths at `c82ec67`; cross-check `LOGIC_AUDIT.md` Part 1
  §4c + Part 5 §5.1; `tests/frontend-harness.html` runs `renderAll` on
  synthetic leads.
- **Evidence:** `LOGIC_AUDIT.md` Part 5 §5.1 (KPI strip audit);
  `tests/frontend-harness.html`.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-026.

## Revalidation trigger

Any commit touching `js/overview-distribution-people-ops.js` that alters
the KPI strip or a breakdown table; a KPI definition changes; `#tab-overview`
markup changes; `LOGIC_AUDIT.md` Part 5 §5.1 is superseded.

## Handover relationship

`HANDOVER.md` §2 (file role) and §3 (render model) cover it; current as
of 2026-09-09. A KPI-definition change should also update `HANDOVER.md`
§3 if it changes the "renders every tab in one pass" description.

## Lifecycle / retention

N/A — code.

## Next action

none — Closed + Monitored.

## Closure evidence

Record committed for DOC-026; `docs/INDEX.md` `TAB-002` → `Closed +
Monitored`, `Last Verified` 2026-09-10; validation evidence as above. No
`docs/changes/` record (DOC-026, not a code change).
