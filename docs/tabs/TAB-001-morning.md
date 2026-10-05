# TAB-001 — Morning Brief

| | |
|---|---|
| **Type** | `TAB-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `dashboard.html` `#tab-morning` (`#L950`); `js/tab-morning.js` |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-10-03 against commit (`9efec5d`) |

## Purpose / reason to exist

A single first-thing-in-the-morning summary screen: 10 fixed cards that
mirror the "0–48h Funnel Audit" closing checklist so a regional head can
scan the state of the desk in one view instead of opening five tabs. It
introduces **no new business logic** — every card reuses an existing
shared function or predicate from other modules (`LOGIC_AUDIT.md` Part 1
§4c). It is deliberately kept out of `renderAll()` and only refreshes on
a real data refresh or a Generate-report checkpoint, so it reads as a
stable "as of this morning" snapshot rather than shifting on every filter
tweak.

**Since 2026-10-03, this tab is hidden from the UI** (the user's own
request — "not really useful to me"). Its `#tabBar` button
(`dashboard.html`) was removed; the panel (`#tab-morning`), its render
function, and its checkpoint re-calls from `TAB-003`/`TAB-007` are all
**unchanged** — they still compute and render into `#morningBriefCards`
exactly as before, just into a DOM node nothing can navigate to anymore
(`.tab-panel{display:none}`, never gains `.active` with no button to set
it). This is a UI-visibility change only, not a retirement of the
feature — `Component Status` stays `Active` since the code is correct
and complete, just unreachable; re-enabling it is a one-line revert
(restore the button, `dashboard.html` `#L939` as of this change).

## Responsibilities

- Render 10 summary cards from data other tabs already compute.
- Refresh only at explicit checkpoints, not on every filter change.
- Keep Card 3 ("48h failure rate, live") clearly labelled as a
  *different*, live-recomputed number from Tracking's cohort-correct
  0–48h section.

## Who / what uses it

Regional heads / team leads at the start of the working day
(`CLAUDE.md`).

## Inputs (which in-memory state arrays / filter state it reads)

`leads`, `issueLeads` (post-`enrichLead` state, from `JS-009` /
`JS-004`). Reads no filter state directly — it consumes whatever
`leads`/`issueLeads` currently hold at checkpoint time.

## Outputs / what it renders

10 static cards into `#tab-morning`. No exports, no writes.

## Data displayed

Per-card: counts and rates already computed by `computeRMScoreRows`,
`computeDailyLeadCounts`, `topBreakdown` (all in `JS-012`) and core
predicates on `leads`/`issueLeads`. Card 3 = a live 48h failure rate
recomputed in `JS-020` itself.

## Data written / modified

None.

## Navigation relationships

**No longer reachable from `#tabBar`** — its button was removed
2026-10-03 (see Purpose above). Still re-called by `renderReports()`
(`JS-016`) and `tab-movement.js` (`JS-021`) at Generate checkpoints,
gated by `_refreshMorningBriefOnNextRender` — those calls are harmless
no-ops from the user's perspective now (they repaint a hidden panel).
Not part of `renderAll()`.

## Buttons / actions — `BTN-XXX` sub-table

| ID | Label | Element id | What it does | Invokes (`FN-XXX`) | Confirm/irreversible? | Failure behaviour |
|---|---|---|---|---|---|---|
| — | none | — | Morning Brief has no buttons of its own | — | — | — |

## Non-button UI elements — `UI-XXX` sub-table

| ID | Element | Behaviour | Invokes (`FN-XXX`) |
|---|---|---|---|
| UI-001 | 10 summary cards | static; repaint only at checkpoint | `renderMorningBrief` (`JS-020`) |

## Owning module(s)

`JS-020` (`js/tab-morning.js`). Reciprocal `Used By: TAB-001` recorded on
`JS-020`.

## Relevant functions

`renderMorningBrief` (`JS-020`), plus the borrowed helpers
`computeRMScoreRows` / `computeDailyLeadCounts` / `topBreakdown`
(`JS-012`). Detail on `JS-020` / `JS-012` FN sub-tables.

## Important logic / business rules

Card 3 is intentionally a separate metric from Tracking's 0–48h cohort
number and is labelled as such to stop the two being read as the same
figure (`LOGIC_AUDIT.md` Part 1 §4c). No card computes anything not
already computed elsewhere — this is the module's defining constraint.

## Exceptions & error handling

If `leads`/`issueLeads` are empty (no fetch yet), cards render zeros. No
error path of its own.

## Architecture relationship

`DASH-001`.

## Related documentation

`HANDOVER.md` §2 (file role), §3 (render model); `LOGIC_AUDIT.md` Part 1
§4c.

## Relationships

- **Depends On:** `JS-012` (borrowed compute helpers), `JS-020`,
  `DATA-001`
- **Used By:** `DASH-001`
- **Related:** `TAB-008` (Card 3 vs the cohort-correct 0–48h metric)

## Source of truth

`js/tab-morning.js` at `HEAD`; `dashboard.html` `#tab-morning`.

## Validation

- **Method:** read of `js/tab-morning.js` + `dashboard.html` `#tab-morning`
  at `c82ec67`; cross-check against `LOGIC_AUDIT.md` Part 1 §4c;
  `tests/frontend-harness.html` exercises the render path via
  `renderMorningBrief` after a synthetic `fetchAndRender`.
- **Evidence:** `LOGIC_AUDIT.md` Part 1 §4c; `js/tab-morning.js` header
  comment (states the "no new logic" rule).
- **Status:** Validated 2026-09-10. **Revalidated 2026-10-03**: confirmed
  directly in the browser (DOM inspection, both the real `dashboard.html`
  and `tests/frontend-harness.html`) that the button no longer exists,
  `#tab-morning` computes to `display:none`, and nothing else in the app
  ever sets its `.active` class.

## Version / change reference

Verified at `c82ec67`; record created by DOC-026.

**2026-10-03** (`9efec5d`): the `#tabBar` button removed at the
user's request — see Purpose above. No change to `js/tab-morning.js`
or any of its borrowed helpers.

## Revalidation trigger

Any commit touching `js/tab-morning.js`; a card is added/removed; a
borrowed helper in `JS-012` changes signature; the checkpoint set that
re-calls `renderMorningBrief` changes; the tab button is restored or the
panel is removed outright.

## Handover relationship

`HANDOVER.md` §2 names the file; §3 covers the render/checkpoint model.
§2's row updated 2026-10-03, same commit as this revalidation, to note
the hidden tab button. A change to the card set or the "no new logic"
rule should update `HANDOVER.md` §2's row.

## Lifecycle / retention

N/A — code.

## Next action

none — Closed + Monitored.

## Closure evidence

Record file committed for DOC-026; `docs/INDEX.md` `TAB-001` row →
`Closed + Monitored`, `Last Verified` 2026-09-10; validation evidence as
above. No `docs/changes/` record (closure prompted by DOC-026, not a code
change).
