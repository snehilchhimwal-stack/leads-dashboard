# JS-005 — core-foundation.js

| | |
|---|---|
| **Type** | `JS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `js/core-foundation.js` (246 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

The base everything else is built on: `CONFIG` (SLA thresholds, funnel
order, stage aliases, closed-stage lists), `ISSUE_PRIORITY`, and the
IST wall-clock ↔ instant conversion helpers. It exists because
**every date/time in this system is pinned to IST explicitly, never to
the browser's timezone** (`CLAUDE.md` gotcha) — and this file holds the
one set of helpers that does that correctly. A "midnight" or "today"
computed with `new Date(y,m,d,...)` instead would be wrong for anyone
not in IST and wrong in the UTC CI environment.

## Responsibilities

- Define `CONFIG` and `ISSUE_PRIORITY` — the tuning constants the client
  business logic reads.
- Provide `istWallToInstant` / `istParts` / `istStartOfDay` /
  `istAddDays` / `istSameDay` / `istDateKey` / `relativeDayLabel`.
- Provide `groupLeadsByCalendarDay` / `renderCardsByDay` — day-grouped
  card rendering used by several tabs.

## Load order / position

First in the real `<script src>` order — nothing precedes it. Its own
header comment documents why the order among the other 8 core files
mostly doesn't matter.

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-026 | `istWallToInstant(y, mo, d, h, mi, s)` `#L139` | IST wall-clock parts | a `Date` (correct instant) | none | — | everywhere a date is constructed | reusable |
| FN-027 | `istParts(date)` `#L144` | a `Date` | `{y, mo, d, h, mi, s}` in IST | none | — | `istDateKey` (FN-030), `core-outcome-engine.js` timestamp formatters, many | reusable |
| FN-028 | `istStartOfDay(date)` `#L152` | a `Date` | IST-midnight `Date` | none | `istParts` (FN-027), `istWallToInstant` (FN-026) | cohort windows, day grouping | reusable |
| FN-029 | `istAddDays(date, n)` / `istSameDay(a, b)` `#L157/#L162` | date(s) | date / bool | none | `istParts` / `istWallToInstant` | calendars, windows | reusable |
| FN-030 | `istDateKey(date)` `#L170` | a `Date` | `YYYY-MM-DD` IST string | none | `istParts` (FN-027) | Movement histories, cohort keys, RM Timeline, Audit | reusable — the canonical day key |
| FN-031 | `relativeDayLabel(dayKey, todayKey)` `#L185` | two day keys | "Today (…)" / "Yesterday (…)" / "N days ago (…)" | none | — | card day headers | reusable |
| FN-032 | `groupLeadsByCalendarDay(leadsArr, asOfDate)` `#L203` | lead list + as-of | `[{key, label, leads}]` groups | none | `istDateKey` (FN-030), `relativeDayLabel` (FN-031) | `renderCardsByDay` (FN-033), Operations / Movement lists | reusable |
| FN-033 | `renderCardsByDay(group, cardFn)` `#L236` | a day group + a card renderer | HTML | none | `dayGroupHeaderHtml` (inner) | Operations / Movement / Morning card lists | reusable |

## Config constants — `CFG-XXX` sub-table

| ID | Constant | Value | Meaning | Changing it affects |
|---|---|---|---|---|
| CFG-003 | `CONFIG.MIN_CALLS_PER_DAY` `#L32` | `5` | under-called-today threshold | `enrichLead` `underCalledToday` (`JS-006` RULE), `GS-012` `MIN_CALLS_PER_DAY_` twin |
| CFG-004 | `CONFIG.LEAD_LIFECYCLE_HOURS` `#L34` | `48` | stuck-48h boundary | `enrichLead` `stageStuck48h`; `GS-012` `LEAD_LIFECYCLE_HOURS_` twin |
| CFG-005 | `CONFIG.FIRST_CONTACT_SLA_MINUTES` `#L35` | `10` | first-contact breach window | `enrichLead` `firstContactBreach`; `GS-012` twin |
| CFG-006 | `CONFIG.LEAD_GRACE_HOURS` `#L49` | `3` | grace before SLA flags apply | `enrichLead`; `GS-012` `LEAD_GRACE_HOURS_` twin |
| CFG-007 | `CONFIG.FOLLOWUP_REVIEW_HOURS` `#L50` | `4` | follow-up-overdue window | `enrichLead` `followupOverdue`; `GS-012` twin |
| CFG-008 | `CONFIG.WORK_START_HOUR` / `WORK_END_HOUR` `#L44/#L45` | `9` / `19` | business-hours window for `businessMinutesBetween` | SLA timing on both runtimes; `GS-012` `WORK_START_HOUR_` / `WORK_END_HOUR_` |
| CFG-009 | `CONFIG.FUNNEL_ORDER` `#L51` | 9-stage list | canonical funnel ordering | `canonicalStage` / `isOppOrAbove` (`JS-006`); `Core.gs` `FUNNEL_ORDER_` (ported verbatim) |
| CFG-010 | `CONFIG.CLOSED_STAGE_EXACT` / `CLOSED_STAGE_STEMS` `#L85/#L86` | `['won','lost','junk','dead','not interested']` / `['cancel','close','reject']` | closed-stage detection | `isClosedStage` (`JS-006`); `Core.gs` `CLOSED_STAGE_EXACT_` / `_STEMS_` twins |
| CFG-011 | `IST_OFFSET_MS` `#L135` | `330 * 60000` (+05:30, no DST) | the IST offset all helpers use | every IST helper here |
| CFG-012 | `ISSUE_PRIORITY` `#L116` | ordered issue-type list | tie-break order for a lead's primary issue | Operations card ordering; `SlaEngine.gs` `primaryIssueGs_` shares the order |

## Data lineage

Pure constants + pure functions. No data flows through it; other modules
*read* `CONFIG` and *call* the helpers. `CONFIG` values are the client
half of the cross-runtime constant pairs audited in `LOGIC_AUDIT.md`
Part 4.

## Data sources accessed

None.

## Data written / modified

None.

## Failure / error behaviour

Pure functions; `istSameDay` guards null inputs. No throw paths.

## Cross-runtime duplication

**Extensive, by design.** `CONFIG.FUNNEL_ORDER` / `STAGE_ALIASES` /
`CLOSED_STAGE_*` are ported "verbatim" into `Core.gs` (per its own
comment); the SLA thresholds (`CFG-003`..`CFG-008`) are mirrored as
`SlaEngine.gs`'s `*_` constants; the IST offset logic is re-implemented
(different mechanism, verified equivalent — `LOGIC_AUDIT.md` Part 4
§4.6). Every one of these pairs must be edited on both sides
(`HANDOVER.md` §6).

## UI relationships

None directly. `renderCardsByDay` output appears on `TAB-001` /
`TAB-003` / `TAB-007`.

## Architecture relationship

`DASH-001`. Layer 6/8 base (`LOGIC_AUDIT.md` Part 1 §1).

## Related documentation

`HANDOVER.md` §2, §6; `CLAUDE.md` (IST gotcha); `LOGIC_AUDIT.md` Part 1
§4b, Part 3 §3.1 (the SLA thresholds), Part 4 §4.2/§4.6.

## Relationships

- **Depends On:** `none` — top of the module tree
- **Used By:** nearly every other `JS-XXX` (`CONFIG` + IST helpers) —
  `JS-004`, `JS-006`, `JS-007`, `JS-008`, `JS-012`, `JS-014`, `JS-019`,
  `JS-021`, `JS-023`, `JS-024`, and more
- **Related:** `GS-002` (`Core.gs` — the ported backend twin of this
  file's config + IST helpers)

## Source of truth

`js/core-foundation.js` at `HEAD`.

## Validation

- **Method:** full read at `c82ec67`; function + constant list verified
  by grep; cross-check `LOGIC_AUDIT.md` Part 1 §4b + Part 3 §3.1 (the
  reproduced threshold list) + Part 4 §4.2/§4.6 (the diffs against the
  `.gs` twins). Exercised indirectly by every `tests/frontend-harness.html`
  scenario and directly by the `Tests_*.gs` cross-runtime constant
  checks in CI.
- **Evidence:** `LOGIC_AUDIT.md` Part 3 §3.1, Part 4 §4.2/§4.6;
  `.github/workflows/test.yml` (last green run).
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-027.

## Revalidation trigger

Any commit touching `js/core-foundation.js`; **any `CONFIG` constant
changes value** (requires the matching `.gs` twin to change too, per
`HANDOVER.md` §6); `FUNNEL_ORDER` / `STAGE_ALIASES` / `CLOSED_STAGE_*`
change; the IST offset logic changes.

## Handover relationship

`HANDOVER.md` §2 names the file; §6 lists the duplication pairs this file
anchors; `CLAUDE.md` states the IST rule. Current as of 2026-09-09. A
constant change must update `HANDOVER.md` §6 and the `.gs` side in the
**same commit**.

## Lifecycle / retention

N/A — code.

## Next action

none — Closed + Monitored.

## Closure evidence

Record committed for DOC-027; `docs/INDEX.md` `JS-005` → `Closed +
Monitored`, `Last Verified` 2026-09-10, links filled; `CFG-003`..`012`
recorded (the client half of the cross-runtime pairs). No `docs/changes/`
record (DOC-027).
