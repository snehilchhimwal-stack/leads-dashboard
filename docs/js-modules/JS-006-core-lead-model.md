# JS-006 — core-lead-model.js

| | |
|---|---|
| **Type** | `JS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `js/core-lead-model.js` (449 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

A raw `leads` row says almost nothing operationally useful on its own —
it has a stage string and some timestamps. `enrichLead()` is the single
function that turns that row into a lead with **derived state**: which of
the 5 Operations SLA checks it is failing, where it sits in the funnel,
whether it is closed, whether it is a booking. It is the single source
of truth for a lead's derived SLA/funnel state on the client, and it is
the most business-rule-dense function in the app. This module exists so
every tab reads the *same* derived state rather than each re-deriving it.

## Responsibilities

- `enrichLead(l)` — attach all derived SLA/funnel flags to a lead.
- Business-hour math (`businessMinutesBetween`), tolerant date parsing
  (`parseDate`, cached).
- Funnel-stage classification (`canonicalStage`, `isOppOrAbove`,
  `isBookingLead`, `isSoftBookingLead`, `isClosedStage`, `isLeadClosed`).

## Load order / position

Fourth in the real order (`… core-auth → **core-lead-model** →
core-collation → core-outcome-engine → …`). Forward-references
`combinedCommentsText` / `parseActionLog` from `core-outcome-engine.js`
(safe — used inside `enrichLead`'s body).

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-034 | `enrichLead(l)` `#L202` | a raw parsed lead + module state (`_renderNow`, `_todayCallBaselineByKey`, `_lastSnapshotByKey`) | the lead with `firstContactBreach`, `neverConnectedPastWindow`, `isNotUpdated`, `underCalledToday`, `stageStuck48h`, `followupOverdue`, `recordingNotWorking`, `closedWithNoComment`, `inactiveRmNewLead`, `isMultiAgent`, funnel position | reads module baseline `Map`s | `businessMinutesBetween` (FN-035), `parseDate` (FN-036), `canonicalStage` (FN-037), `combinedCommentsText` / `parseActionLog` (`JS-007`) | `applyFiltersAndRender` (`JS-004`), `fetchAndRender` (`JS-003`), `tab-movement.js`, `reports-build.js`, `overview-…`, and more | specific — the core enrichment |
| FN-035 | `businessMinutesBetween(start, end)` `#L14` | two dates | minutes within `WORK_START_HOUR`..`WORK_END_HOUR` | none | `CONFIG` (`JS-005`) | `enrichLead` (FN-034), SLA timing | reusable |
| FN-036 | `parseDate(v)` `#L52` | a string / Date / serial | a `Date` or `null` (cached in `_parseDateCache`) | populates the cache Map | — | virtually every module that reads a timestamp | reusable |
| FN-037 | `canonicalStage(stage)` `#L83` | a raw stage string | a `CONFIG.FUNNEL_ORDER` entry or `null` | none | `CONFIG` (`JS-005`) | `isOppOrAbove` (FN-038), `enrichLead`, renderers | reusable |
| FN-038 | `isOppOrAbove(stage, closingReason, leadClosingReason)` `#L104` | stage + reasons | bool (Opportunity or further) | none | `canonicalStage` (FN-037) | funnel counts, Repeat Offenders eligibility, reports | reusable |
| FN-039 | `isBookingLead(l)` / `isSoftBookingLead(l)` `#L123/#L134` | a lead | bool | none | `canonicalStage` (FN-037) | KPI counts, cohort outcomes | reusable |
| FN-040 | `isClosedStage(stage)` `#L141` | a stage string | bool (exact list or stem match) | none | `CONFIG` (`JS-005`) | `isLeadClosed` (FN-041), filters | reusable |
| FN-041 | `isLeadClosed(l)` `#L173` | a lead | bool | none | `isClosedStage` (FN-040), reason fields | filters, `mergeRowsIntoOneLead` (`JS-003` RULE-004) | reusable — **client counterpart to `Core.gs` `isOpenLead_`** |

## Business rules implemented — `RULE-XXX` sub-table

| ID | Rule | Where | Duplicated in (`GS-XXX`)? | Notes |
|---|---|---|---|---|
| RULE-005 | The 5 Operations SLA checks (`firstContactBreach`, not-connected-in-window, `isNotUpdated`, `stageStuck48h`, `followupOverdue`) + the recording / closed-no-comment / inactive-RM signals | FN-034 | **Yes — `SlaEngine.gs` `computeSlaFlags_`** (`GS-012`). Full diff: `LOGIC_AUDIT.md` Part 4 §4.2 | manual-sync risk — edit both sides |
| RULE-006 | `underCalledToday` = day-over-day call-count delta vs a `Movement_Log` baseline (`_todayCallBaselineByKey`), not an absolute count | FN-034 | Yes — backend derives its own baseline from `Movement_Log` | `MIN_CALLS_AFTER_48H` (`CONFIG`) is display-only, disagrees with the real threshold — `LOGIC_AUDIT.md` Part 4 §4.9 / Part 7 §18 MEDIUM #2 |
| RULE-007 | `isNotUpdated` deliberately does **not** gate on `isUnder48h` (changed 2026-09-03) — a neglected lead must not silently reclassify as "Stuck 48h+" once past 48h | FN-034 | Yes — `SlaEngine.gs` got the same change 2026-09-03 (`LOGIC_AUDIT.md` Part 1 §4d) | keep the two changes in lockstep |
| RULE-008 | A lead reads closed only via `isClosedStage` OR a closing-reason field; `isLeadClosed` is the client twin of `isOpenLead_` | FN-041 | Yes — `Core.gs` `isOpenLead_` | `LOGIC_AUDIT.md` Part 1 §4b |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-010 | unparseable timestamp | `parseDate` returns `null`; `enrichLead` treats the derived time as unknown, skips the dependent flag | lead shows without that SLA flag rather than a wrong one |
| EXC-011 | no `Movement_Log` baseline for a lead's key | `underCalledToday` falls back to absolute call count | slightly different `underCalledToday` result until a baseline exists |

## Data lineage

Raw `leads` row (`SHEET-001`, parsed in `JS-003`) → `enrichLead`
(FN-034) applies `CONFIG` thresholds + the `_todayCallBaselineByKey` /
`_lastSnapshotByKey` baselines (seeded from `Movement_Log`, `SHEET-002`)
→ enriched lead in `leads` / `issueLeads` → Operations cards, KPIs,
reports. Full flow: `DATA-001` + `DATA-002` (SLA-flag pipeline).

## Data sources accessed

Reads in-memory state only. Its baseline `Map`s are populated from
`Movement_Log` data by `JS-021` / `JS-003` before `enrichLead` runs.

## Data written / modified

None (mutates the lead object it is given; writes no Sheet).

## Failure / error behaviour

Never throws on bad row data — an unknown timestamp suppresses the
dependent flag rather than raising. Historical-enrichment mode
(`_enrichingHistorical`) changes which "now" is used.

## Cross-runtime duplication

The heaviest SLA-rule seam in the app. `enrichLead` ↔ `computeSlaFlags_`
(`GS-012`) — full field-by-field diff in `LOGIC_AUDIT.md` Part 4 §4.2.
`isLeadClosed` ↔ `isOpenLead_` (`GS-002`). `canonicalStage` /
`isOppOrAbove` ↔ `Core.gs` `canonicalStage_`. All must be kept in sync
by hand (`HANDOVER.md` §6).

## UI relationships

No buttons. Its output drives every Operations issue card (`TAB-003`),
the KPI strip (`TAB-002`), People score tables (`TAB-005`), the reports
(`TAB-003` / `TAB-007`), Tracking cohorts (`TAB-008`).

## Architecture relationship

`DASH-001`. Layer 6 (Business logic — client) in `LOGIC_AUDIT.md` Part 1
§1, called "the single richest function in the client."

## Related documentation

`HANDOVER.md` §2, §6; `LOGIC_AUDIT.md` Part 1 §4b, Part 3 §3.1, Part 4
§4.2/§4.9, Part 7 §18 MEDIUM #2; `OPS_CHECKLIST.md` (SLA-rule drift);
`CLAUDE.md` (duplication gotcha).

## Relationships

- **Depends On:** `JS-005` (`CONFIG`, IST helpers), `JS-007`
  (`combinedCommentsText` / `parseActionLog`, forward ref), `JS-021`
  (`Movement_Log`-seeded baselines), `SHEET-001`, `SHEET-002`
- **Used By:** `JS-004`, `JS-003`, `JS-008`, `JS-012`, `JS-014`,
  `JS-019`, `JS-021`, `JS-023`, `JS-024`, `JS-018` — nearly every
  feature module
- **Related:** `GS-012` (`SlaEngine.gs`), `GS-002` (`Core.gs`) — the
  backend twins

## Source of truth

`js/core-lead-model.js` at `HEAD`.

## Validation

- **Method:** full read at `c82ec67`; function list verified by grep;
  cross-check `LOGIC_AUDIT.md` Part 3 §3.1 + Part 4 §4.2 (the
  field-by-field diff against `computeSlaFlags_`). Client side:
  `tests/frontend-harness.html` runs synthetic leads with known SLA
  states through `fetchAndRender` → `enrichLead` and checks the flags.
  Backend twin: `Tests_SlaEngine.gs` in CI.
- **Evidence:** `LOGIC_AUDIT.md` Part 4 §4.2; `tests/frontend-harness.html`;
  `.github/workflows/test.yml` (`Tests_SlaEngine.gs`, last green).
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-027. File grew from 435L
(2026-09-05 audit) to 449L — minor.

## Revalidation trigger

Any commit touching `js/core-lead-model.js`; **any SLA rule or threshold
changes** (requires the `SlaEngine.gs` twin to change — `HANDOVER.md`
§6); `isLeadClosed` / `canonicalStage` logic changes; the
`_todayCallBaselineByKey` baseline source changes.

## Handover relationship

`HANDOVER.md` §2 names the file; §6 lists it as the anchor of the SLA-rule
duplication pair. Current as of 2026-09-09. An SLA-rule change must
update `HANDOVER.md` §6 and `SlaEngine.gs` in the **same commit**
(`CLAUDE.md` gotcha), and run `OPS_CHECKLIST.md`'s pre/post items.

## Lifecycle / retention

N/A — code.

## Next action

none — Closed + Monitored.

## Closure evidence

Record committed for DOC-027; `docs/INDEX.md` `JS-006` → `Closed +
Monitored`, `Last Verified` 2026-09-10, links filled; `RULE-005`..`008`,
`EXC-010`/`011` recorded. No `docs/changes/` record (DOC-027).
