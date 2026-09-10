# JS-020 — tab-morning.js

| | |
|---|---|
| **Type** | `JS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `js/tab-morning.js` (251 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

Implements the Morning Brief tab (`TAB-001`): 10 fixed cards mirroring
the "0–48h Funnel Audit" closing checklist, so a regional head gets the
state of the desk in one scan. Its defining constraint is that it
introduces **no new business logic** — every card reuses an existing
shared function or predicate from `JS-012` / core. It exists so a
morning summary can't silently diverge from the numbers the rest of the
dashboard computes.

## Responsibilities

- `renderMorningBrief()` — build the 10 cards from borrowed compute.
- `briefCard` / `briefPill` — the card + status-pill markup.
- Keep Card 3 ("48h failure rate, live") labelled as a *different*,
  live-recomputed metric from Tracking's cohort-correct 0–48h number.

## Load order / position

In the tab group before `main.js` (`LOGIC_AUDIT.md` Part 1 §4a). Not
part of `renderAll()`'s always-run set — refreshed only at checkpoints.

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-138 | `renderMorningBrief()` `#L43` | `leads`, `issueLeads` | the 10 Morning Brief cards | DOM write into `#tab-morning`; only runs when `_refreshMorningBriefOnNextRender` (`JS-004`) is set or at a Generate checkpoint | `computeRMScoreRows` / `computeDailyLeadCounts` / `topBreakdown` (`JS-012`), core predicates on `leads`/`issueLeads`, `briefCard` (FN-139) | `renderAll` (`JS-012`, gated), `renderReports` (`JS-016`), `tab-movement.js` (`JS-021`) at Generate checkpoints | specific |
| FN-139 | `briefCard(opts)` / `briefPill(status, label)` `#L27/#L18` | card options / a status | the card / status-pill HTML | none | `esc` (`JS-010`) | FN-138 | reusable (within this module) |

## Business rules implemented — `RULE-XXX` sub-table

| ID | Rule | Where | Duplicated in (`GS-XXX`)? | Notes |
|---|---|---|---|---|
| RULE-021 | Morning Brief introduces **no new business logic** — every card reuses an existing shared function/predicate | FN-138 | No | this module's defining constraint (`js/tab-morning.js` header comment, `LOGIC_AUDIT.md` Part 1 §4c) |
| RULE-022 | Card 3 ("48h failure rate, live") is a *separate*, live-recomputed metric from Tracking's cohort-correct 0–48h section, and is labelled so | FN-138 | No | prevents the two being read as the same number |
| RULE-023 | Not live-updated on every filter tweak — refreshes only on a real data refresh or a Generate checkpoint | FN-138 + `_refreshMorningBriefOnNextRender` (`JS-004`) | No | keeps it a stable "as of this morning" view |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-042 | `leads` / `issueLeads` empty (no fetch yet) | cards render zeros | Morning Brief shows a blank/zeroed set of cards, no error |

## Data lineage

`leads` / `issueLeads` (state, from `JS-004`) → borrowed
`computeRMScoreRows` / `computeDailyLeadCounts` / `topBreakdown`
(`JS-012`) + core predicates → the 10 cards → screen. Nothing persists.
Card 3 recomputes its own live 48h rate.

## Data sources accessed

Reads `leads` / `issueLeads` (state). No `SHEET-XXX`.

## Data written / modified

None.

## Failure / error behaviour

Renders zeros on empty state (EXC-042). No throw paths — it only reads
and formats.

## Cross-runtime duplication

None. (`RULE-021` is precisely a rule *against* introducing logic that
would need a backend twin.)

## UI relationships

`#tab-morning` panel (`TAB-001`), 10 cards (`UI-001`). No buttons.

## Architecture relationship

`DASH-001`. Layer 10 (Render / UI) — one of the two tabs deliberately
excluded from `renderAll()`'s always-run set (`LOGIC_AUDIT.md` Part 1
§1 layer 10). Belongs to `TAB-001`.

## Related documentation

`HANDOVER.md` §2; `LOGIC_AUDIT.md` Part 1 §4c; `js/tab-morning.js`
header comment.

## Relationships

- **Depends On:** `JS-012` (`computeRMScoreRows`, `computeDailyLeadCounts`,
  `topBreakdown`), `JS-005` (IST helpers), `JS-010` (`esc`), `JS-004`
  (`_refreshMorningBriefOnNextRender` gating)
- **Used By:** `TAB-001`; `JS-012` (`renderAll`, gated), `JS-016` /
  `JS-021` (re-called at Generate checkpoints), `JS-011`
  (`initRMTimelineUI` is `JS-023` — but `main.js` also indirectly
  refreshes this via the render chain)
- **Related:** `TAB-008` (Card 3 vs the cohort-correct 0–48h metric)

## Source of truth

`js/tab-morning.js` at `HEAD`.

## Validation

- **Method:** full read at `c82ec67`; the 3 functions verified by grep;
  cross-check `LOGIC_AUDIT.md` Part 1 §4c and the file's own header
  comment (the "no new logic" rule). `tests/frontend-harness.html` calls
  `renderMorningBrief` after a synthetic `fetchAndRender`.
- **Evidence:** `js/tab-morning.js` header comment; `LOGIC_AUDIT.md` Part
  1 §4c; `tests/frontend-harness.html`.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-028.

## Revalidation trigger

Any commit touching `js/tab-morning.js`; a card is added/removed; a
borrowed helper in `JS-012` changes signature; the checkpoint set that
re-calls `renderMorningBrief` changes; **any card starts computing a
value not already computed elsewhere** (would break `RULE-021`).

## Handover relationship

`HANDOVER.md` §2 names the file and states "all backed by data other tabs
already compute (no new logic)." Current as of 2026-09-09. A change to
the card set or a violation of `RULE-021` must update `HANDOVER.md` §2's
row.

## Lifecycle / retention

N/A — code.

## Next action

none — Closed + Monitored.

## Closure evidence

Record committed for DOC-028; `docs/INDEX.md` `JS-020` → `Closed +
Monitored`, `Last Verified` 2026-09-10, reciprocal `Used By: TAB-001`
confirmed; `RULE-021`..`023`, `EXC-042` recorded. No `docs/changes/`
record (DOC-028).
