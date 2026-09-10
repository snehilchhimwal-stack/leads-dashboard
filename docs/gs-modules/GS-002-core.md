# GS-002 — Core.gs

| | |
|---|---|
| **Type** | `GS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `Core.gs` (214 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

The Apps Script foundation — shared row-parsing / stage-classification
primitives and the **one canonical IST-day helper** (`istDayKeyGs_`).
Every other `.gs` file depends on it. Its stage/funnel config
(`FUNNEL_ORDER_`, `STAGE_ALIASES_`, `CLOSED_STAGE_EXACT_`/`_STEMS_`) is
ported "verbatim" from the client's `CONFIG` (per its own comment), so
the two runtimes classify a lead's stage identically. It exists so the
backend has one place for "what stage is this," "is this lead open,"
and "what IST day is this instant."

## Responsibilities

- `canonicalStage_` / `isOppOrAbove_` / `isClosedStage_` / `isOpenLead_`
  — stage & open/closed classification (the `.gs` twin of `JS-006`'s
  funnel logic).
- `buildColIndex_` / `getVal_` / `resolveTabName_` — header-row column
  mapping.
- `istDayKeyGs_` / `pad2Gs_` — the canonical IST-day key.
- `businessMinutesBetweenGs_` — business-hour math.
- `esc_` — HTML escaping for the email templates.

## Trigger schedule

None — `Core.gs` installs no trigger and is called only from other `.gs`
files.

## Requires `setupXxx()` re-run when

Never — it has no `setupXxx()` and no schedule.

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-180 | `istDayKeyGs_(date)` `#L179` | a `Date` | `YYYY-MM-DD` IST string | none | `pad2Gs_` (FN-185) | every `.gs` file with a day boundary | reusable — the canonical backend IST-day key |
| FN-181 | `canonicalStage_(stage)` `#L91` | a raw stage string | a `FUNNEL_ORDER_` entry or `null` | none | `STAGE_ALIASES_` | `isOppOrAbove_` (FN-182), `computeSlaFlags_` (`GS-012`), the emailers | reusable — **ported verbatim from `JS-006` `canonicalStage`** |
| FN-182 | `isOppOrAbove_(stage, closingReason, leadClosingReason)` `#L112` | stage + reasons | bool | none | FN-181 | the emailers, `DailyRmIssueLog.gs` | reusable — twin of `JS-006` `isOppOrAbove` |
| FN-183 | `isClosedStage_(stage)` / `isOpenLead_(stage, closingReason, leadClosingReason)` `#L122/#L138` | stage + reasons | bool | none | FN-181 | every emailer + logger (open-lead filter) | reusable — **`isOpenLead_` is the twin of `JS-006` `isLeadClosed`** (`LOGIC_AUDIT.md` Part 1 §4b) |
| FN-184 | `buildColIndex_(headerRow)` / `getVal_(row, colIndex, key)` / `resolveTabName_(ss)` `#L156/#L172/#L150` | a header row / a row + key / a spreadsheet | column-index map / a cell value / the leads tab name | none | `HEADER_ALIASES_` (`GS-004`) | every file that reads a leads row | reusable |
| FN-185 | `businessMinutesBetweenGs_(start, end)` / `pad2Gs_(n)` `#L191/#L183` | two dates / a number | business minutes / a 2-char string | none | — | `computeSlaFlags_` (`GS-012`), FN-180 | reusable — twin of `JS-006` `businessMinutesBetween` |
| FN-186 | `esc_(s)` `#L211` | any value | HTML-escaped string | none | — | `renderOvernightReportEmailHTML_` (`GS-004`), all email builders | reusable — the backend `esc` |

## Config constants — `CFG-XXX` sub-table

| ID | Constant | Value | Meaning | Changing it affects |
|---|---|---|---|---|
| CFG-027 | `FUNNEL_ORDER_` | 9-stage list | canonical funnel ordering | every stage classification on the backend; **twin `CONFIG.FUNNEL_ORDER` (`JS-005`)** — ported verbatim |
| CFG-028 | `STAGE_ALIASES_` | alias map | raw stage → canonical | `canonicalStage_`; twin `CONFIG.STAGE_ALIASES` (`JS-005`) |
| CFG-029 | `CLOSED_STAGE_EXACT_` / `CLOSED_STAGE_STEMS_` | `['won','lost','junk','dead','not interested']` / `['cancel','close','reject']` | closed-stage detection | `isClosedStage_`; twins in `JS-005` |
| CFG-030 | IST offset | `+05:30` literal (no DST) | `istDayKeyGs_`'s day boundary | every backend IST computation (`LOGIC_AUDIT.md` Part 4 §4.6 — verified equivalent to the client mechanism) |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-058 | an unknown stage string | `canonicalStage_` returns `null`; callers treat it as pre-funnel | the lead classifies as "not updated" / earliest stage rather than erroring |
| EXC-059 | a header row missing an expected column | `buildColIndex_` leaves that key unmapped; `getVal_` returns `''` | the dependent flag is skipped, not a crash |

## Data lineage

Pure primitives — no data flows *through* `Core.gs`. Other `.gs` files
pass it rows/strings/dates and get back classifications. `FUNNEL_ORDER_`
etc. are the backend half of the cross-runtime config pairs audited in
`LOGIC_AUDIT.md` Part 4.

## Sheets touched

| `SHEET-XXX` | Read / Write | Which `FN-XXX` | Notes |
|---|---|---|---|
| — | — | — | `Core.gs` touches no sheet directly; `resolveTabName_` reads sheet metadata only |

## Failure / error behaviour

Pure functions — an unknown stage or missing column degrades to a
sensible default, never a throw. Nothing here shows as Failed in
Executions on its own.

## Cross-runtime duplication

**This file is one half of the biggest config duplication in the
project.** `FUNNEL_ORDER_` / `STAGE_ALIASES_` / `CLOSED_STAGE_*` ↔
`CONFIG.*` (`JS-005`) — ported verbatim. `isOpenLead_` ↔ `isLeadClosed`
(`JS-006`). `istDayKeyGs_` ↔ `istDateKey` (`JS-005`) — different
mechanism, verified equivalent (`LOGIC_AUDIT.md` Part 4 §4.6).
`businessMinutesBetweenGs_` ↔ `businessMinutesBetween` (`JS-006`). Every
one must be edited on both sides (`HANDOVER.md` §6).

## Not live until pasted

A `.gs` edit here is not running until pasted into the Sheet's Apps
Script editor and saved. No `setupXxx()` re-run needed (no trigger).

## UI relationships

N/A — backend-only.

## Architecture relationship

Apps Script backend foundation. Layer 7 (backend business logic — base)
in `LOGIC_AUDIT.md` Part 1 §1. Every other `GS-XXX` depends on it.

## Related documentation

`HANDOVER.md` §2, §6; `CLAUDE.md` (IST + duplication gotchas);
`LOGIC_AUDIT.md` Part 1 §4d, Part 3 §3.1, Part 4 §4.2/§4.6.

## Relationships

- **Depends On:** `GS-004` (`HEADER_ALIASES_` for `buildColIndex_`) —
  the only dependency
- **Used By:** `GS-001`, `GS-003`, `GS-005`, `GS-006`, `GS-008`,
  `GS-010`, `GS-011`, `GS-012`, `GS-013` — every other production `.gs`
- **Related:** `JS-005` (`core-foundation.js`) + `JS-006`
  (`core-lead-model.js`) — the client twins of this file's config and
  classifiers

## Source of truth

`Core.gs` at `HEAD`.

## Validation

- **Method:** full read at `c82ec67`; function list verified by grep;
  the `FUNNEL_ORDER_` / IST-key logic cross-checked against
  `LOGIC_AUDIT.md` Part 3 §3.1 (the reproduced config) + Part 4 §4.6
  (IST equivalence). `Tests_Core.gs` runs in CI.
- **Evidence:** `.github/workflows/test.yml` (`Tests_Core.gs`, last green
  run); `LOGIC_AUDIT.md` Part 3 §3.1, Part 4 §4.6.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-029.

## Revalidation trigger

Any commit touching `Core.gs` or `Tests_Core.gs`; **any of `FUNNEL_ORDER_`
/ `STAGE_ALIASES_` / `CLOSED_STAGE_*` changes** (requires the `JS-005`
twin to change — `HANDOVER.md` §6); `istDayKeyGs_`'s offset logic
changes; `buildColIndex_` / `HEADER_ALIASES_` mapping changes.

## Handover relationship

`HANDOVER.md` §2 names the file ("Apps Script shared foundation … ported
from `js/core.js`"); §6 lists the config duplication pairs it anchors.
Current as of 2026-09-09. A config change must update `HANDOVER.md` §6
and the `js/` side in the **same commit** (`CLAUDE.md` gotcha).

## Lifecycle / retention

N/A — code.

## Next action

none — Closed + Monitored.

## Closure evidence

Record committed for DOC-029; `docs/INDEX.md` `GS-002` → `Closed +
Monitored`, `Last Verified` 2026-09-10, links recorded; `CFG-027`..`030`
(the backend half of the cross-runtime config pairs), `EXC-058`/`059`
recorded. No `docs/changes/` record (DOC-029).
