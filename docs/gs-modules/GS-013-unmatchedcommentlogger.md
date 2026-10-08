# GS-013 — UnmatchedCommentLogger.gs

| | |
|---|---|
| **Type** | `GS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `UnmatchedCommentLogger.gs` (409 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-10-08 against commit `78e47f5` - email audit P18: `pruneUnmatchedCommentsLog_` archives through `archiveChunksVerifiedGs_` (see `## Version / change reference`) |

## Purpose / reason to exist

Every open lead whose latest comment matches **no** `OUTCOME_RULES_GS_`
keyword is logged into `Unmatched_Comments_Log`, for periodic human
review. It exists as the **feedback loop that surfaces classifier gaps**:
the comment-classification keyword table can only be improved if someone
sees which real RM comments it fails to interpret. Without this, a
growing blind spot in `FollowupEngine.gs` (`GS-005`) / `core-outcome-engine.js`
(`JS-007`) would be invisible. **Update 2026-09-29:** the cell-budget
diagnostic (`GS-002` FN-301) found this tab at 383,058 cells 2026-09-28,
and the pre-existing `clearReviewedUnmatchedCommentsNow` — manual,
review-gated — does nothing for a backlog of rows nobody ever reviewed.
Snehil confirmed adding a 30-day AGE-based prune (`pruneUnmatchedCommentsLog_`)
ALONGSIDE that manual clear, not instead of it — see Lifecycle /
retention below for the real tradeoff this accepts.

## Responsibilities

- `scanUnmatchedCommentsGs_` — find open leads with an unclassifiable
  latest comment and append them (de-duped).
- `unmatchedCommentDedupKeyGs_` — the `(lead_id, comment_at-or-comment)`
  dedup key.
- `ensureUnmatchedCommentsLogSheet_` — create/repair the tab.
- `scanUnmatchedCommentsNow` — a manual run.
- `clearReviewedUnmatchedCommentsNow` — clear rows marked reviewed
  (manual, human-gated — unchanged).
- `dedupeUnmatchedCommentsNow` — an incident-recovery function for a
  real 2026-09-03 bug (see Exceptions).
- `pruneUnmatchedCommentsLog_` / `pruneUnmatchedCommentsLogNow` (added
  2026-09-29) — archive-then-remove rows older than
  `UNMATCHED_COMMENTS_LOG_RETENTION_DAYS_` (30), regardless of `reviewed`.

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
| FN-250 | `scanUnmatchedCommentsGs_(ss, dataRows, colIndex, now)` `#L140` | open-lead rows + column index + now | appends one row per open lead with an unclassifiable latest comment (de-duped) | Sheets append; dedup read against existing rows | `latestOutcomeGs_` (`GS-005`), `unmatchedCommentDedupKeyGs_` (FN-251) | `snapshotOpenLeads_` (`GS-008`), `scanUnmatchedCommentsNow` (FN-252) | specific |
| FN-251 | `unmatchedCommentDedupKeyGs_(leadId, outcomeEntry)` `#L128` | lead id + a comment entry | a dedup key, de-duped by `(lead_id, comment_at-or-comment)` | none | — | FN-250 | specific |
| FN-252 | `ensureUnmatchedCommentsLogSheet_(ss)` / `scanUnmatchedCommentsNow()` `#L107/#L227` | spreadsheet / — | ensures the tab / runs FN-250 once by hand | may create the tab / Sheets append | FN-250 | FN-250 / Apps Script editor | specific |
| FN-253 | `clearReviewedUnmatchedCommentsNow()` `#L241` | — | removes rows flagged reviewed | Sheets delete | — | Apps Script editor (manual, after a review pass) | specific |
| FN-254 | `dedupeUnmatchedCommentsNow()` `#L276` | — | removes duplicate rows caused by the 2026-09-03 Date-coercion bug | Sheets delete | — | Apps Script editor (incident recovery) | specific — **a documented incident-recovery function** |
| FN-309 | `pruneUnmatchedCommentsLog_(ss)` `#L336` (added 2026-09-29) | a spreadsheet | none | archives (chunked) then removes rows older than `UNMATCHED_COMMENTS_LOG_RETENTION_DAYS_` (30) — REGARDLESS of `reviewed`; no-op if nothing is old enough | `archiveRowsToDriveCsv_` (`GS-002` FN-265), `parseIstDayKeyOrDateGs_` (`GS-002` FN-306) | `snapshotOpenLeads_` (`GS-008`), `pruneUnmatchedCommentsLogNow` | specific — re-inserts checkboxes on the `reviewed` column after rewriting, same discipline as FN-253 |
| FN-310 | `pruneUnmatchedCommentsLogNow()` `#L397` (added 2026-09-29) | — | runs FN-309 once by hand | as FN-309 | FN-309 | Apps Script editor (manual) | specific |

## Config constants — `CFG-XXX` sub-table

| ID | Constant | Value | Meaning | Changing it affects |
|---|---|---|---|---|
| CFG-073 | `UNMATCHED_COMMENTS_LOG_RETENTION_DAYS_` / `UNMATCHED_COMMENTS_LOG_ROW_HEADROOM_` / `UNMATCHED_COMMENTS_LOG_ARCHIVE_CHUNK_` (added 2026-09-29) | `30` / `2000` / `5000` | how far back `Unmatched_Comments_Log` keeps live rows regardless of review status; extra allocated-row buffer after a prune; max rows archived per Drive CSV | `pruneUnmatchedCommentsLog_` (FN-309); a shorter retention means more genuinely-unreviewed comments get archived before a human ever sees them (Snehil's explicit tradeoff, 2026-09-29) |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-089 | Sheets silently auto-converts a **string-typed `comment_at`** cell to a **Date-typed** cell, defeating the string-equality de-dup (real 2026-09-03 bug) | recovery via `dedupeUnmatchedCommentsNow()` (FN-254); the dedup key also considers the comment text, not just `comment_at` | duplicate rows can appear; a one-command cleanup exists (`HANDOVER.md` §8) |
| EXC-090 | the scan throws inside `snapshotOpenLeads_` | that call is **independently try/catch-wrapped** by `GS-008` | the core `Movement_Log` capture still completes; the scan failure is logged, not fatal |
| EXC-105 | the archive's own row count doesn't match the number of rows about to be dropped (added 2026-09-29) | `pruneUnmatchedCommentsLog_` throws, refuses to touch the sheet | a human sees the error in Executions rather than silently losing an unreviewed comment |

## Data lineage

Open-lead rows (from `leads`, `SHEET-001`, passed in by
`snapshotOpenLeads_`) → `latestOutcomeGs_` (`GS-005`) classifies the
latest comment → if it matches no rule → append `(lead_id, RM,
comment_at, comment, …)` to `Unmatched_Comments_Log` (`SHEET-010`),
de-duped → a human reviews the tab and improves `OUTCOME_RULES_GS_` /
`OUTCOME_RULES`. Full flow: a `DATA-003` side-channel (the
classifier-improvement loop). Since 2026-09-29, a row older than 30 days
— reviewed or not — is archived to a Drive CSV then removed, independent
of the human-review flow above.

## Sheets touched

| `SHEET-XXX` | Read / Write | Which `FN-XXX` | Notes |
|---|---|---|---|
| `SHEET-001` `leads` | Read (indirect — rows passed in) | FN-250 | via `snapshotOpenLeads_` |
| `SHEET-010` `Unmatched_Comments_Log` | Write (append) + ensure + clear/dedupe/prune | FN-250 / FN-252 / FN-253 / FN-254 / FN-309 (added 2026-09-29) | de-duped by `(lead_id, comment_at-or-comment)`; 30-day age-based retention since 2026-09-29, on top of the pre-existing manual reviewed-clear |

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

- **Depends On:** `GS-002` (`Core.gs`), `GS-004` (`EmailInfra.gs`),
  `GS-005` (`FollowupEngine.gs` — `latestOutcomeGs_`), `SHEET-001`,
  `SHEET-010`
- **Used By:** `GS-008` (`MovementTracker.gs` — `snapshotOpenLeads_`
  invokes it, same piggyback pattern as InteractionHistoryLogger),
  `SHEET-010`, `DATA-003`
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

**2026-10-07** (`58ab8e1`, email audit P17): `pruneUnmatchedCommentsLog_`'s archive check now counts records with `countCsvRecordsGs_` (`GS-002` FN-348). Root cause (found 2026-10-07 on the live data - `Comment_History` held 6,369 rows and `Unmatched_Comments_Log` 2,134 rows past their 30-day retention): the prune proved its Drive archive by counting `split('\n')` lines of the CSV, but a comment containing a line break is ONE record on several lines (the writer quotes it). With 102 multi-line comments the count read 6,518 against 6,369 and the prune threw "Drive archive holds ... but ... were expected - refusing to prune"; the throw was only logged, so nobody was told. The fixtures had only single-line comments. Fixed with `countCsvRecordsGs_` (`GS-002` FN-348). `docs/_planning/EMAIL_AUDIT.md` P17. (This tab: 2,134 expired rows, 7 multi-line, "2148 ... but 2134".) **Not live until pasted.**

**2026-10-08** (`78e47f5`, email audit P18): `pruneUnmatchedCommentsLog_` archives through `archiveChunksVerifiedGs_` (`GS-002` FN-352): a failed proof trashes the files it wrote, a retry reuses the identical archive, and the `archive_log.csv` row is written only after the rows are gone. A prune archives first, proves the archive, then deletes. When the proof (or a later sheet write) failed, the files it had written stayed in Drive and the next run - 4 a day - wrote another identical copy: 14 extra `Comment_History` and 18 extra `Unmatched_Comments_Log` archives sat in Drive from 2026-10-03. Fixed in `Core.gs` (`FN-350`..`FN-353`): an identical archive is reused, a failed proof trashes the files that call created, and the `archive_log.csv` row is written only after the rows are gone. `docs/_planning/EMAIL_AUDIT.md` P18. **Not live until pasted.**

## Revalidation trigger

Any commit touching `UnmatchedCommentLogger.gs` or its `Tests_` file;
the dedup-key logic changes; the retention window
(`UNMATCHED_COMMENTS_LOG_RETENTION_DAYS_`) changes; `latestOutcomeGs_`
(`GS-005`) changes; `Unmatched_Comments_Log` (`SHEET-010`) columns
change; `snapshotOpenLeads_` (`GS-008`) stops calling it.

## Handover relationship

`HANDOVER.md` §2 names the file ("Logs every RM comment the
classification keywords fail to match … for periodic human review"); §8
has the 2026-09-03 dedup incident. Updated 2026-09-29 (same commit as
the age-based prune) to note the new retention behavior alongside the
still-unchanged manual reviewed-clear.

## Lifecycle / retention

`Unmatched_Comments_Log` (`SHEET-010`): shipped with **no automatic
pruning** — `clearReviewedUnmatchedCommentsNow()` removes rows *after a
human marks them reviewed*, manually curated rather than time-limited.
**Changed 2026-09-29:** `pruneUnmatchedCommentsLog_` (FN-309) ADDS a
30-day age-based prune on top of that — a row this old is archived to
Drive and removed **whether or not a human ever reviewed it**. This is a
real, deliberate tradeoff Snehil confirmed: a comment nobody got to
within 30 days is archived rather than sitting in the live review queue
forever. `clearReviewedUnmatchedCommentsNow()` itself is UNCHANGED — it
still exists and still only removes reviewed=true rows, on its own
manual schedule. Confirmed policy, not `TBD`. See
`docs/_planning/DB_ARCHITECTURE_REVIEW.md`'s own "unmatched_comments_log"
section for the pre-2026-09-29 reasoning this partially supersedes.

## Next action

none — Closed + Monitored.

## Closure evidence

Record committed for DOC-029; `docs/INDEX.md` `GS-013` → `Closed +
Monitored`, `Last Verified` 2026-09-10, links + "piggyback trigger"
recorded; `EXC-089`/`090` (the 2026-09-03 dedup incident + the
try/catch isolation). No `docs/changes/` record (DOC-029).
