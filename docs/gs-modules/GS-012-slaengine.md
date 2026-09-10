# GS-012 — SlaEngine.gs

| | |
|---|---|
| **Type** | `GS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `SlaEngine.gs` (159 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

The 5 Operations SLA rules on the backend — `computeSlaFlags_` is the
`.gs` port of the client's `enrichLead` (`JS-006`), so every scheduled
email and logger judges a lead off-SLA by the *same* rules the dashboard
shows. It also owns `primaryIssueGs_` (the tie-break for a lead's
headline issue) and the shared threshold constants. It exists because
Apps Script can't call the browser's `enrichLead`, and a scheduled email
that disagreed with the dashboard about whether a lead is breaching
would undermine both.

## Responsibilities

- `computeSlaFlags_(row, colIndex, now, baselineMap)` — compute all 5
  SLA flags for one lead.
- `primaryIssueGs_(flags)` — pick the headline issue via the shared
  priority order.
- Hold the threshold constants (`LEAD_GRACE_HOURS_` etc.).

## Trigger schedule

None — called only from other `.gs` files (`MovementTracker.gs`,
`OvernightEmailer.gs`, `AllIssuesEmailer.gs`, `DailyRmIssueLog.gs`).

## Requires `setupXxx()` re-run when

Never — no `setupXxx()`, no schedule. A threshold or rule change takes
effect on the next trigger fire of whatever calls it (`CLAUDE.md`
gotcha).

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-248 | `computeSlaFlags_(row, colIndex, now, baselineMap)` `#L46` | a leads row + column index + `now` + a `Movement_Log` call-count baseline map | `{firstContactBreach, neverConnected…, isNotUpdated, stageStuck48h, followupOverdue, …}` | none (pure) | `canonicalStage_` / `businessMinutesBetweenGs_` / `istDayKeyGs_` (`GS-002`), `latestCommentTimestamp_` / `countTodayCommentEntries_` (`GS-005`) | `MovementTracker.gs`, `OvernightEmailer.gs`, `AllIssuesEmailer.gs`, `DailyRmIssueLog.gs` | reusable — **the `.gs` twin of `enrichLead` (`JS-006` FN-034)** |
| FN-249 | `primaryIssueGs_(flags)` `#L154` | the SLA flags | the single headline issue key | none | `ISSUE_PRIORITY`-order | the emailers (subject line + sort) | reusable — shares the tie-break order with `CONFIG.ISSUE_PRIORITY` (`JS-005` CFG-012) |

## Config constants — `CFG-XXX` sub-table

| ID | Constant | Value | Meaning | Changing it affects |
|---|---|---|---|---|
| CFG-057 | `LEAD_GRACE_HOURS_` | `3` | grace before SLA flags apply | `computeSlaFlags_`; **twin `CONFIG.LEAD_GRACE_HOURS` (`JS-005` CFG-006)** |
| CFG-058 | `LEAD_LIFECYCLE_HOURS_` | `48` | stuck-48h boundary | twin `CONFIG.LEAD_LIFECYCLE_HOURS` (`JS-005` CFG-004) |
| CFG-059 | `MIN_CALLS_PER_DAY_` | `5` | under-called-today threshold | twin `CONFIG.MIN_CALLS_PER_DAY` (`JS-005` CFG-003) |
| CFG-060 | `FOLLOWUP_REVIEW_HOURS_` | `4` | follow-up-overdue window | twin `CONFIG.FOLLOWUP_REVIEW_HOURS` (`JS-005` CFG-007) |
| CFG-061 | `FIRST_CONTACT_SLA_MINUTES_` | `10` | first-contact breach window | twin `CONFIG.FIRST_CONTACT_SLA_MINUTES` (`JS-005` CFG-005) |
| CFG-062 | `WORK_START_HOUR_` / `WORK_END_HOUR_` | `9` / `19` | business-hours window | twin `CONFIG.WORK_START_HOUR` / `WORK_END_HOUR` (`JS-005` CFG-008) |

## Business rules implemented — `RULE-XXX` sub-table

| ID | Rule | Where | Duplicated in (`JS-XXX`)? | Notes |
|---|---|---|---|---|
| RULE-033 | The 5 SLA checks (first-contact breach, not-connected-in-window, `isNotUpdated`, stage-stuck-48h, follow-up-overdue) | FN-248 | **Yes — `enrichLead` (`JS-006` RULE-005)**. Full field-by-field diff: `LOGIC_AUDIT.md` Part 4 §4.2 | the primary cross-runtime seam |
| RULE-034 | `isNotUpdated` deliberately does **not** gate on `isUnder48h` — changed 2026-09-03 so a neglected lead doesn't silently reclassify as "Stuck 48h+" once past 48h | FN-248 | Yes — `JS-006` got the same change 2026-09-03 (`JS-006` RULE-007) | keep the two changes in lockstep |
| RULE-035 | `primaryIssueGs_` uses the shared `ISSUE_PRIORITY` order for the tie-break | FN-249 | shares the order with `CONFIG.ISSUE_PRIORITY` (`JS-005`) | subject-line + sort consistency |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-087 | no `Movement_Log` baseline for a lead's key in `baselineMap` | the under-called-today check falls back to an absolute count | a slightly different `underCalledToday` result until a baseline exists (mirrors `JS-006` EXC-011) |
| EXC-088 | `CONFIG.MIN_CALLS_AFTER_48H` on the **client** is display-only and disagrees with the real threshold used here | this file uses `MIN_CALLS_PER_DAY_` for the actual flag; the client's display text can read differently | `LOGIC_AUDIT.md` Part 4 §4.9 / Part 7 §18 MEDIUM #2 — a display/logic mismatch, maintainer decides which to align |

## Data lineage

A `leads` row (`SHEET-001`, parsed by `readLeadsTab_`, `GS-004`) + a
`Movement_Log` call-count baseline (`SHEET-002`, from
`buildMovementLogMapsGs_`, `GS-008`) → `computeSlaFlags_` (FN-248) →
per-lead SLA flags → consumed by the emailers (`GS-001`, `GS-010`), the
Movement hub's `SLA_History` write (`GS-008`), and the nightly census
(`GS-003`). Full flow: `DATA-002`.

## Sheets touched

| `SHEET-XXX` | Read / Write | Which `FN-XXX` | Notes |
|---|---|---|---|
| — | — | — | `SlaEngine.gs` operates on rows/maps passed in; it touches no sheet directly |

## Failure / error behaviour

Pure computation — a missing baseline degrades one sub-check
gracefully (EXC-087), never a throw. Nothing here shows as Failed in
Executions on its own.

## Cross-runtime duplication

**The primary SLA-rule seam.** `computeSlaFlags_` ↔ `enrichLead`
(`JS-006`) — full diff in `LOGIC_AUDIT.md` Part 4 §4.2. All six threshold
constants (`CFG-057`..`CFG-062`) are twins of `CONFIG.*` (`JS-005`). The
`isNotUpdated`-not-gating-on-48h change (RULE-034) was made on both sides
on 2026-09-03. Every rule/threshold change must be made on both sides
(`HANDOVER.md` §6, `CLAUDE.md`).

## Not live until pasted

Not running until pasted into the Sheet's Apps Script editor. No
`setupXxx()` re-run needed (no trigger).

## UI relationships

N/A — backend. The dashboard's Operations tab (`TAB-003`) shows the same
flags via `enrichLead` (`JS-006`).

## Architecture relationship

Apps Script backend. Layer 7 (backend business logic — duplicated by
necessity) in `LOGIC_AUDIT.md` Part 1 §1.

## Related documentation

`HANDOVER.md` §2, §6; `OPS_CHECKLIST.md` (SLA-rule drift);
`LOGIC_AUDIT.md` Part 1 §4d, Part 3 §3.1, Part 4 §4.2/§4.9, Part 7 §18
MEDIUM #2; `CLAUDE.md` (duplication gotcha).

## Relationships

- **Depends On:** `GS-002` (`Core.gs`), `GS-005` (`FollowupEngine.gs` —
  `latestCommentTimestamp_`, `countTodayCommentEntries_`) — the only two
  dependencies
- **Used By:** `GS-008` (`MovementTracker.gs`), `GS-010`
  (`OvernightEmailer.gs`), `GS-001` (`AllIssuesEmailer.gs`), `GS-003`
  (`DailyRmIssueLog.gs`)
- **Related:** `JS-006` (`core-lead-model.js` — `enrichLead`, the client
  twin), `JS-005` (`CONFIG` — the client threshold twins)

## Source of truth

`SlaEngine.gs` at `HEAD`.

## Validation

- **Method:** full read at `c82ec67`; the two functions + all six
  threshold constants verified by grep; the `isNotUpdated` /
  `isUnder48h` change and every threshold cross-checked against
  `LOGIC_AUDIT.md` Part 3 §3.1 + Part 4 §4.2 (the field-by-field diff
  against `enrichLead`). `Tests_SlaEngine.gs` runs in CI.
- **Evidence:** `.github/workflows/test.yml` (`Tests_SlaEngine.gs`, last
  green run); `LOGIC_AUDIT.md` Part 4 §4.2.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-029.

## Revalidation trigger

Any commit touching `SlaEngine.gs` or `Tests_SlaEngine.gs`; **any of the
5 SLA rules or 6 thresholds changes** (requires the `enrichLead` /
`CONFIG` twins in `JS-006` / `JS-005` to change — `HANDOVER.md` §6); the
`ISSUE_PRIORITY` order changes; the `CONFIG.MIN_CALLS_AFTER_48H`
display/logic mismatch (Part 4 §4.9) is resolved.

## Handover relationship

`HANDOVER.md` §2 names the file ("The 5 SLA rules, ported from
`enrichLead` in `js/core.js`"); §6 lists it as the anchor of the
SLA-rule duplication pair. Current as of 2026-09-09. A rule/threshold
change must update `HANDOVER.md` §6 and `js/core-lead-model.js` in the
**same commit**, and run `OPS_CHECKLIST.md`'s pre/post items.

## Lifecycle / retention

N/A — code.

## Next action

Resolve the `CONFIG.MIN_CALLS_AFTER_48H` display/logic mismatch
(`LOGIC_AUDIT.md` Part 4 §4.9 / Part 7 §18 MEDIUM #2) — a maintainer
decision on which side to align, tracked via the revalidation trigger.

## Closure evidence

Record committed for DOC-029; `docs/INDEX.md` `GS-012` → `Closed +
Monitored`, `Last Verified` 2026-09-10, links recorded; `CFG-057`..`062`
(the backend half of the SLA-threshold pairs), `RULE-033`..`035`,
`EXC-087`/`088`. No `docs/changes/` record (DOC-029).
