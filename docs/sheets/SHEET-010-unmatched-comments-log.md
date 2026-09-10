# SHEET-010 — Unmatched_Comments_Log

| | |
|---|---|
| **Type** | `SHEET-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | Google Sheet, tab `Unmatched_Comments_Log` |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

Every open lead whose latest comment matches **no** `OUTCOME_RULES_GS_`
keyword is logged here, for periodic human review. It exists as the
**feedback loop that surfaces classifier gaps**: the only way to improve
the comment-classification keyword tables (`GS-005` / `JS-007`) is to see
which real RM comments they fail to interpret. A person reviews this tab,
marks rows `reviewed`, and adds keywords to both runtimes.

## Reason to exist

To make the classifier's blind spots visible and actionable, rather than
letting an unmatched comment silently fall through to "manual review
required" forever.

## Data stored

One row per open lead with an unclassifiable latest comment, de-duped by
`(lead_id, comment_at-or-comment)`.

## Source of the data

`GS-013` `scanUnmatchedCommentsGs_`, invoked from `snapshotOpenLeads_`
(`GS-008`) — 4×/day, de-duped.

## Destination / consumers

**A human**, reviewing the tab directly and improving `OUTCOME_RULES_GS_`
/ `OUTCOME_RULES`. (The dashboard's Movement tab has a *separate*
browser-side "Unmatched Comments" compute — `JS-021` FN-145 — that does
**not** read this tab.)

## Columns / fields

| Column | Type | Meaning |
|---|---|---|
| `date` | date | capture day |
| `lead_id` / `RM` / `region` / `project` | text | identity + routing |
| `comment` | text | the unclassifiable comment |
| `comment_at` | datetime | when the RM logged it |
| `logged_at` | datetime | when this row was written |
| `reviewed` | bool-ish | a human marks this once handled |
| `note` | text | reviewer's note |

Exact list: `UnmatchedCommentLogger.gs` `UNMATCHED_COMMENTS_LOG_COLUMNS_`
`#L90`.

## Writers

| Writer | `FN-XXX` | Mode |
|---|---|---|
| `GS-013` | `scanUnmatchedCommentsGs_` (FN-250) | append (de-duped) |
| `GS-013` | `scanUnmatchedCommentsNow` (FN-252) | append (manual) |
| `GS-013` | `clearReviewedUnmatchedCommentsNow` (FN-253) | delete rows where `reviewed` is set |
| `GS-013` | `dedupeUnmatchedCommentsNow` (FN-254) | delete duplicate rows (2026-09-03 incident recovery) |

## Readers

| Reader | `FN-XXX` | For |
|---|---|---|
| *(a human)* | — | classifier-gap review |

## Automation / triggers touching it

Piggybacks on `MovementTracker.gs`'s 4×/day trigger via
`snapshotOpenLeads_`. No trigger of its own (`GS-013` Trigger Schedule).

## Apps Script functions touching it

`scanUnmatchedCommentsGs_`, `unmatchedCommentDedupKeyGs_`,
`ensureUnmatchedCommentsLogSheet_`, `scanUnmatchedCommentsNow`,
`clearReviewedUnmatchedCommentsNow`, `dedupeUnmatchedCommentsNow` (all
`GS-013`).

## Data Lifecycle (DOC-019 — confirmed; DOC-036 signed off 2026-09-10)

- **Data Type:** operational (a review queue)
- **Retention Period:** **manually curated, not time-limited** —
  `clearReviewedUnmatchedCommentsNow()` removes rows *after a human marks
  them reviewed*. Rows persist until reviewed.
- **Enforced By:** a human, via `clearReviewedUnmatchedCommentsNow()` —
  there is no time-based prune
- **Archive / Delete Behavior:** reviewed rows deleted on the manual
  clear; unreviewed rows kept indefinitely
- **Sensitivity:** contains RM comment text — `DOC-036` to classify

## Sensitivity & operational importance (DOC-038)

- **Operational importance:** **LOW** — display / audit-trail only — no automated dependency; losing it loses history, nothing stops working.
- **Data sensitivity:** **free-text RM comment content**.
- **Reason:** Only a human reads it (classifier-gap review), and `GS-013`'s piggyback scan is try/catch-isolated so a failure never blocks the Movement capture — no automated dependency. Holds RM comment text pending human review.

## Risks of changing this tab's structure

The dedup depends on `lead_id` + `comment_at`/`comment` — the 2026-09-03
bug was Sheets coercing a string `comment_at` to a Date, defeating
string-equality dedup, hence the dedup key also considers `comment`. A
column rename breaks `scanUnmatchedCommentsGs_`. The `reviewed` column
position matters for `clearReviewedUnmatchedCommentsNow`.

## Relationships to other tabs

Derived from `SHEET-001` (`leads`) via the piggyback scan. Its purpose
is to drive edits to the classifier code (`GS-005` / `JS-007`), not to
another tab.

## Important logic / business rules

De-dup by `(lead_id, comment_at-or-comment)` (`GS-013` FN-251);
try/catch-isolated inside `snapshotOpenLeads_` (`GS-013` EXC-090); the
2026-09-03 Date-coercion incident + its recovery function (`GS-013`
EXC-089, `HANDOVER.md` §8).

## Exceptions & error handling

A scan failure never blocks the core capture (EXC-090). Duplicate rows
from the coercion bug → `dedupeUnmatchedCommentsNow()` (EXC-089).

## Related documentation

`HANDOVER.md` §2, §8 (the 2026-09-03 dedup bug); `LOGIC_AUDIT.md` Part 1
§4d; `OPS_CHECKLIST.md` (periodic unmatched-comment review).

## Relationships

- **Depends On:** `GS-005` (`latestOutcomeGs_`), `GS-008` (piggyback
  host), `GS-013`, `SHEET-001` (`leads`), `EXT-001`, `DATA-003`
- **Used By:** `GS-008`, `GS-013` — only (writer); a human (reviewer)
- **Related:** `SHEET-009` (`Comment_History` — the sibling piggyback
  logger); `GS-005` / `JS-007` (the classifier this loop improves)

## Source of truth

The live `Unmatched_Comments_Log` tab; schema
`UNMATCHED_COMMENTS_LOG_COLUMNS_` (`UnmatchedCommentLogger.gs`).

## Validation

- **Method:** column list read from `UNMATCHED_COMMENTS_LOG_COLUMNS_`
  `#L90` at `c82ec67`; the manual-curation retention model + the
  2026-09-03 incident cross-checked against `LOGIC_AUDIT.md` Part 1 §4d +
  `HANDOVER.md` §8. `Tests_UnmatchedCommentLogger.gs` in CI.
- **Evidence:** `.github/workflows/test.yml`
  (`Tests_UnmatchedCommentLogger.gs`, last green run); `HANDOVER.md` §8.
- **Status:** Validated 2026-09-10 (**including** retention model; only
  the sensitivity label is `TBD`).

## Version / change reference

Verified at `c82ec67`; record created by `DOC-032`.

## Revalidation trigger

`UNMATCHED_COMMENTS_LOG_COLUMNS_` changes; the dedup-key logic changes;
a time-based prune is added; `snapshotOpenLeads_` stops calling `GS-013`.

## Handover relationship

`HANDOVER.md` §2 names the file; §8 has the 2026-09-03 incident. Current
as of 2026-09-09. A schema or dedup change must update `HANDOVER.md`
§2/§8.

## Lifecycle / retention

**Manually curated** — rows persist until a human marks them `reviewed`
and runs `clearReviewedUnmatchedCommentsNow()`. No time-based prune.
Confirmed. Sensitivity `TBD` (`DOC-036`).

## Next action

`DOC-036` — record the comment-data sensitivity classification.

## Closure evidence

Record committed for `DOC-032`; `docs/INDEX.md` `SHEET-010` → `Closed +
Monitored`, `Last Verified` 2026-09-10; columns sourced from
`UNMATCHED_COMMENTS_LOG_COLUMNS_`, not approximated; retention model
confirmed, sensitivity `TBD` per `DOC-032` boundary.
