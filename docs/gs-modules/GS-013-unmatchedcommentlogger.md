# GS-013 — UnmatchedCommentLogger.gs

| | |
|---|---|
| **Type** | `GS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `UnmatchedCommentLogger.gs` (303 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

Every open lead whose latest comment matches **no** `OUTCOME_RULES_GS_`
keyword is logged into `Unmatched_Comments_Log`, for periodic human
review. It exists as the **feedback loop that surfaces classifier gaps**:
the comment-classification keyword table can only be improved if someone
sees which real RM comments it fails to interpret. Without this, a
growing blind spot in `FollowupEngine.gs` (`GS-005`) / `core-outcome-engine.js`
(`JS-007`) would be invisible.

## Responsibilities

- `scanUnmatchedCommentsGs_` — find open leads with an unclassifiable
  latest comment and append them (de-duped).
- `unmatchedCommentDedupKeyGs_` — the `(lead_id, comment_at-or-comment)`
  dedup key.
- `ensureUnmatchedCommentsLogSheet_` — create/repair the tab.
- `scanUnmatchedCommentsNow` — a manual run.
- `clearReviewedUnmatchedCommentsNow` — clear rows marked reviewed.
- `dedupeUnmatchedCommentsNow` — an incident-recovery function for a
  real 2026-09-03 bug (see Exceptions).

## Trigger schedule

**None of its own.** `scanUnmatchedCommentsGs_` is invoked from inside
`snapshotOpenLeads_` (`GS-008`), so it effectively runs 4×/day
(`00:00/06:00/12:00/18:00 IST`) on the Movement hub's trigger
(`LOGIC_AUDIT.md` Part 1 §5).

## Requires `setupXxx()` re-run when

Never — it has no `setupXxx()`. It becomes live purely by being pasted
into the Apps Script editor (so `snapshotOpenLeads_` can call it) — see
"Not live until pasted." A logic change takes effect on the next
Movement hub fire.

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-250 | `scanUnmatchedCommentsGs_(ss, dataRows, colIndex, now)` `#L128` | open-lead rows + column index + now | appends one row per open lead with an unclassifiable latest comment (de-duped) | Sheets append; dedup read against existing rows | `latestOutcomeGs_` (`GS-005`), `unmatchedCommentDedupKeyGs_` (FN-251) | `snapshotOpenLeads_` (`GS-008`), `scanUnmatchedCommentsNow` (FN-252) | specific |
| FN-251 | `unmatchedCommentDedupKeyGs_(leadId, outcomeEntry)` `#L116` | lead id + a comment entry | a dedup key, de-duped by `(lead_id, comment_at-or-comment)` | none | — | FN-250 | specific |
| FN-252 | `ensureUnmatchedCommentsLogSheet_(ss)` / `scanUnmatchedCommentsNow()` `#L95/#L215` | spreadsheet / — | ensures the tab / runs FN-250 once by hand | may create the tab / Sheets append | FN-250 | FN-250 / Apps Script editor | specific |
| FN-253 | `clearReviewedUnmatchedCommentsNow()` `#L229` | — | removes rows flagged reviewed | Sheets delete | — | Apps Script editor (manual, after a review pass) | specific |
| FN-254 | `dedupeUnmatchedCommentsNow()` `#L264` | — | removes duplicate rows caused by the 2026-09-03 Date-coercion bug | Sheets delete | — | Apps Script editor (incident recovery) | specific — **a documented incident-recovery function** |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-089 | Sheets silently auto-converts a **string-typed `comment_at`** cell to a **Date-typed** cell, defeating the string-equality de-dup (real 2026-09-03 bug) | recovery via `dedupeUnmatchedCommentsNow()` (FN-254); the dedup key also considers the comment text, not just `comment_at` | duplicate rows can appear; a one-command cleanup exists (`HANDOVER.md` §8) |
| EXC-090 | the scan throws inside `snapshotOpenLeads_` | that call is **independently try/catch-wrapped** by `GS-008` | the core `Movement_Log` capture still completes; the scan failure is logged, not fatal |

## Data lineage

Open-lead rows (from `leads`, `SHEET-001`, passed in by
`snapshotOpenLeads_`) → `latestOutcomeGs_` (`GS-005`) classifies the
latest comment → if it matches no rule → append `(lead_id, RM,
comment_at, comment, …)` to `Unmatched_Comments_Log` (`SHEET-010`),
de-duped → a human reviews the tab and improves `OUTCOME_RULES_GS_` /
`OUTCOME_RULES`. Full flow: a `DATA-003` side-channel (the
classifier-improvement loop).

## Sheets touched

| `SHEET-XXX` | Read / Write | Which `FN-XXX` | Notes |
|---|---|---|---|
| `SHEET-001` `leads` | Read (indirect — rows passed in) | FN-250 | via `snapshotOpenLeads_` |
| `SHEET-010` `Unmatched_Comments_Log` | Write (append) + ensure + clear/dedupe | FN-250 / FN-252 / FN-253 / FN-254 | de-duped by `(lead_id, comment_at-or-comment)` |

## Failure / error behaviour

Protected by `GS-008`'s per-side-effect try/catch (EXC-090) — a scan
failure never blocks the core `Movement_Log` capture. The 2026-09-03
Date-coercion bug has a dedicated recovery function (EXC-089).

## Cross-runtime duplication

None — there is no client counterpart. It reuses `latestOutcomeGs_`
(`GS-005`), so the comment-classification duplication (`JS-007` ↔
`GS-005`) applies transitively, but this file adds no new duplicated
logic. Its output is precisely what *drives* the manual sync of that
duplicated rule table.

## Not live until pasted

Not running until pasted into the Sheet's Apps Script editor **and**
`snapshotOpenLeads_` (`GS-008`) actually calls it. Per `CLAUDE.md`'s
three-registration rule for a `.gs` file: `Tests_RunAll.gs`'s `suites`,
`test/run-gs-tests.js`'s file lists, and the live editor paste. No
`setupXxx()` re-run (it has none).

## UI relationships

N/A — backend. `Unmatched_Comments_Log` is reviewed directly in the
Sheet; the dashboard's Movement tab has a related "Unmatched Comments"
compute (`JS-021` FN-145) that is a **separate** browser-side view, not
this file's output.

## Architecture relationship

Apps Script backend. Layer 17 (backend automation — a piggyback on the
Movement hub) in `LOGIC_AUDIT.md` Part 1 §1.

## Related documentation

`HANDOVER.md` §2, §8 (the 2026-09-03 dedup bug); `LOGIC_AUDIT.md` Part 1
§4d; `OPS_CHECKLIST.md` (periodic unmatched-comment review); `CLAUDE.md`
(the three-registration rule).

## Relationships

- **Depends On:** `GS-002` (`Core.gs`), `GS-005` (`FollowupEngine.gs` —
  `latestOutcomeGs_`), `GS-004` (`EmailInfra.gs`), `SHEET-001`,
  `SHEET-010`
- **Used By:** `GS-008` (`MovementTracker.gs` — `snapshotOpenLeads_`
  invokes it, same pattern as `GS-006`)
- **Related:** `GS-006` (`InteractionHistoryLogger.gs` — the other
  piggyback logger), `GS-005` / `JS-007` (the classifier this loop
  improves), `SHEET-010` (`Unmatched_Comments_Log` — its output)

## Source of truth

`UnmatchedCommentLogger.gs` at `HEAD`.

## Validation

- **Method:** full read at `c82ec67`; function list verified by grep;
  the "no own trigger, piggybacks on `snapshotOpenLeads_`" claim and the
  2026-09-03 dedup incident cross-checked against `LOGIC_AUDIT.md` Part 1
  §4d + `HANDOVER.md` §8. `Tests_UnmatchedCommentLogger.gs` runs in CI.
- **Evidence:** `.github/workflows/test.yml`
  (`Tests_UnmatchedCommentLogger.gs`, last green run); `LOGIC_AUDIT.md`
  Part 1 §4d; `HANDOVER.md` §8.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-029.

## Revalidation trigger

Any commit touching `UnmatchedCommentLogger.gs` or its `Tests_` file;
the dedup-key logic changes; `latestOutcomeGs_` (`GS-005`) changes;
`Unmatched_Comments_Log` (`SHEET-010`) columns change; `snapshotOpenLeads_`
(`GS-008`) stops calling it.

## Handover relationship

`HANDOVER.md` §2 names the file ("Logs every RM comment the
classification keywords fail to match … for periodic human review"); §8
has the 2026-09-03 dedup incident. Current as of 2026-09-09. A change to
the scan condition or the dedup key should update `HANDOVER.md` §2 and
§8.

## Lifecycle / retention

`Unmatched_Comments_Log` (`SHEET-010`): **no automatic pruning** —
`clearReviewedUnmatchedCommentsNow()` removes rows *after a human marks
them reviewed*, so it is manually curated rather than time-limited.
Confirmed, not `TBD`.

## Next action

none — Closed + Monitored.

## Closure evidence

Record committed for DOC-029; `docs/INDEX.md` `GS-013` → `Closed +
Monitored`, `Last Verified` 2026-09-10, links + "piggyback trigger"
recorded; `EXC-089`/`090` (the 2026-09-03 dedup incident + the
try/catch isolation). No `docs/changes/` record (DOC-029).
