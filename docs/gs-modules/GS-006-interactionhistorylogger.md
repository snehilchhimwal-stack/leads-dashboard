# GS-006 — InteractionHistoryLogger.gs

| | |
|---|---|
| **Type** | `GS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `InteractionHistoryLogger.gs` (284 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-10-08 against commit `78e47f5` - email audit P18: `pruneCommentHistory_` archives through `archiveChunksVerifiedGs_` (see `## Version / change reference`) |

## Purpose / reason to exist

A forward-looking capture: every time an open lead gets a **genuinely
new** comment (any outcome, not just SLA-relevant ones), one row is
appended to `Comment_History`. Added 2026-09-05. It exists so the
project builds an interaction record it did not previously keep — useful
for later analysis of how RMs actually work a lead. It shipped with **no
pruning** (unlike `Movement_Log`) on the stated assumption that write
volume — comment-triggered, not clock-driven — would stay an order of
magnitude below `Movement_Log`'s. **Update 2026-09-29:** that assumption
held on rate but not on absolute scale — the cell-budget diagnostic
(`GS-002` FN-301) found this tab at 1,048,164 cells 2026-09-28. Snehil
confirmed a 30-day retention policy; `pruneCommentHistory_` now
archives-then-removes anything older, on the same 4×/day trigger. See
Lifecycle / retention below.

## Responsibilities

- `logInteractionHistoryGs_` — detect genuinely-new comments on open
  leads and append them.
- `commentHistoryDedupKeyGs_` — the `(lead_id, comment)` dedup key.
- `ensureCommentHistorySheet_` — create/repair the `Comment_History`
  tab.
- `logInteractionHistoryNow` — a manual trigger for the same.
- `pruneCommentHistory_` / `pruneCommentHistoryNow` (added 2026-09-29) —
  archive-then-remove rows older than
  `COMMENT_HISTORY_RETENTION_DAYS_` (30).

## Trigger schedule

**None of its own.** It piggybacks on `MovementTracker.gs`'s trigger —
`logInteractionHistoryGs_` is invoked from inside `snapshotOpenLeads_`
(`GS-008`), which runs 4×/day (`00:00/06:00/12:00/18:00 IST`, via
`setupMovementTracking()`). So it effectively runs 4×/day, same schedule
as the Movement hub (`LOGIC_AUDIT.md` Part 1 §5).

## Requires `setupXxx()` re-run when

Never — it has no `setupXxx()`. It becomes live purely by being pasted
into the Apps Script editor (so `snapshotOpenLeads_` can call it) — see
"Not live until pasted." A logic change takes effect on the next
Movement hub fire.

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-212 | `logInteractionHistoryGs_(ss, dataRows, colIndex, now)` `#L116` | the open-lead rows + column index + now | appends one `Comment_History` row per genuinely-new comment | Sheets append; dedup against existing rows | `latestOutcomeGs_` (`GS-005`), `commentHistoryDedupKeyGs_` (FN-213) | `snapshotOpenLeads_` (`GS-008`), `logInteractionHistoryNow` (FN-215) | specific |
| FN-213 | `commentHistoryDedupKeyGs_(leadId, outcomeEntry)` `#L105` | lead id + a comment entry | a dedup key | none | — | FN-212 | specific |
| FN-214 | `ensureCommentHistorySheet_(ss)` `#L87` | spreadsheet | ensures `Comment_History` exists with the right header | may create/repair the tab | — | FN-212 | specific |
| FN-215 | `logInteractionHistoryNow()` `#L179` | — | runs FN-212 once by hand | Sheets append | FN-212 | Apps Script editor (manual) | specific |
| FN-307 | `pruneCommentHistory_(ss)` `#L213` (added 2026-09-29) | a spreadsheet | none | archives (chunked, `COMMENT_HISTORY_ARCHIVE_CHUNK_`) then removes rows older than `COMMENT_HISTORY_RETENTION_DAYS_` (30); no-op if nothing is old enough | `archiveRowsToDriveCsv_` (`GS-002` FN-265), `parseIstDayKeyOrDateGs_` (`GS-002` FN-306) | `snapshotOpenLeads_` (`GS-008`), `pruneCommentHistoryNow` | specific — follows `pruneMovementLog_`'s crash-safety ordering (`GS-008`) exactly |
| FN-308 | `pruneCommentHistoryNow()` `#L268` (added 2026-09-29) | — | runs FN-307 once by hand | as FN-307 | FN-307 | Apps Script editor (manual) | specific |

## Config constants — `CFG-XXX` sub-table

| ID | Constant | Value | Meaning | Changing it affects |
|---|---|---|---|---|
| CFG-072 | `COMMENT_HISTORY_RETENTION_DAYS_` / `COMMENT_HISTORY_ROW_HEADROOM_` / `COMMENT_HISTORY_ARCHIVE_CHUNK_` (added 2026-09-29) | `30` / `2000` / `5000` | how far back `Comment_History` keeps live rows; extra allocated-row buffer after a prune; max rows archived per Drive CSV (file-size ceiling, not a Sheets quota — see `EXC-102`, `GS-008`) | `pruneCommentHistory_` (FN-307); a smaller retention shrinks the tab faster but loses more recent history for future analysis (Snehil's call, 2026-09-29) |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-068 | a comment's `comment_at` is Sheets-coerced from string to Date (defeating string-equality dedup) | the dedup key is comment-text-based, not purely timestamp-based | reduced exposure to the coercion class that bit `UnmatchedCommentLogger.gs` (`GS-013`) |
| EXC-069 | `Comment_History` grows large (updated 2026-09-29 — see Purpose) | **pruned automatically since 2026-09-29** — `pruneCommentHistory_` (FN-307) archives-then-removes rows older than 30 days on the same 4×/day trigger | the live tab stays bounded; nothing is lost — everything pruned is archived to Drive first |
| EXC-104 | the archive's own row count doesn't match the number of rows about to be dropped (added 2026-09-29) | `pruneCommentHistory_` throws, refuses to touch the sheet | a human sees the error in Executions rather than silently losing rows — same discipline as `EXC-102` (`GS-008`) |

## Data lineage

Open-lead rows (from `leads`, `SHEET-001`, passed in by
`snapshotOpenLeads_`) → `latestOutcomeGs_` (`GS-005`) classifies the
latest comment → if genuinely new (dedup miss) → one row appended to
`Comment_History` (`SHEET-009`). Never re-derived. Since 2026-09-29, a
row older than 30 days is archived to a Drive CSV (`GS-002`'s
`ARCHIVE_ROOT_FOLDER_` / `Comment_History` subfolder) then removed from
the live tab — see Lifecycle / retention. Full flow: `DATA-003` (a
downstream sink).

## Sheets touched

| `SHEET-XXX` | Read / Write | Which `FN-XXX` | Notes |
|---|---|---|---|
| `SHEET-001` `leads` | Read (indirect — rows passed in) | FN-212 | via `snapshotOpenLeads_` |
| `SHEET-009` `Comment_History` | Write (append) + ensure + prune (added 2026-09-29) | FN-212 / FN-214 / FN-307 | 30-day retention since 2026-09-29; pruned rows archived to Drive first, never hard-lost |

## Failure / error behaviour

`snapshotOpenLeads_` wraps each piggyback logger in its own try/catch, so
a failure here **never blocks the core `Movement_Log` capture** (`GS-008`).
A failure shows in Executions attributed to the Movement trigger run.

## Cross-runtime duplication

None — there is no client counterpart to this logger. It reuses
`latestOutcomeGs_` (`GS-005`), which carries the comment-classification
duplication transitively, but this file adds no new duplicated logic.

## Not live until pasted

Not running until pasted into the Sheet's Apps Script editor **and**
`snapshotOpenLeads_` (`GS-008`) actually calls it. Per `CLAUDE.md`:
adding a new `.gs` file needs THREE registrations — `Tests_RunAll.gs`'s
`suites` array, `test/run-gs-tests.js`'s file lists, and the live editor
paste. No `setupXxx()` re-run (it has none).

## UI relationships

N/A — backend. `Comment_History` is not yet surfaced in the dashboard.

## Architecture relationship

Apps Script backend. Layer 17 (backend automation — a piggyback on the
Movement hub) in `LOGIC_AUDIT.md` Part 1 §1.

## Related documentation

`HANDOVER.md` §2, §9; `LOGIC_AUDIT.md` Part 1 §4d (measured rates:
~33,229 `Movement_Log` rows/day vs this file's comment-triggered rate);
`CLAUDE.md` (the three-registration rule).

## Relationships

- **Depends On:** `GS-002` (`Core.gs`), `GS-004` (`EmailInfra.gs`),
  `GS-005` (`FollowupEngine.gs` — `latestOutcomeGs_`), `SHEET-001`,
  `SHEET-009`
- **Used By:** `GS-008` (`MovementTracker.gs` — `snapshotOpenLeads_`
  invokes it, same piggyback pattern as UnmatchedCommentLogger),
  `SHEET-009`, `DATA-003`
- **Related:** `GS-013` (`UnmatchedCommentLogger.gs` — the other
  piggyback logger), `SHEET-009` (`Comment_History` — its output)

## Source of truth

`InteractionHistoryLogger.gs` at `HEAD`.

## Validation

- **Method:** full read at `c82ec67`; function list verified by grep;
  the "no own trigger, piggybacks on `snapshotOpenLeads_`" claim
  cross-checked against `LOGIC_AUDIT.md` Part 1 §4d/§5.
  `Tests_InteractionHistoryLogger.gs` runs in CI.
- **Evidence:** `.github/workflows/test.yml`
  (`Tests_InteractionHistoryLogger.gs`, last green run); `LOGIC_AUDIT.md`
  Part 1 §4d.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-029. Added 2026-09-05 — the
newest scheduled subsystem at the time of the 2026-09-07 audit.

**2026-10-07** (`58ab8e1`, email audit P17): `pruneCommentHistory_`'s archive check now counts records with `countCsvRecordsGs_` (`GS-002` FN-348) instead of `split('\n')` lines. Root cause (found 2026-10-07 on the live data - `Comment_History` held 6,369 rows and `Unmatched_Comments_Log` 2,134 rows past their 30-day retention): the prune proved its Drive archive by counting `split('\n')` lines of the CSV, but a comment containing a line break is ONE record on several lines (the writer quotes it). With 102 multi-line comments the count read 6,518 against 6,369 and the prune threw "Drive archive holds ... but ... were expected - refusing to prune"; the throw was only logged, so nobody was told. The fixtures had only single-line comments. Fixed with `countCsvRecordsGs_` (`GS-002` FN-348). `docs/_planning/EMAIL_AUDIT.md` P17. Its failure is now also emailed to ops by `GS-008`'s `alertSnapshotPhaseFailuresGs_` (FN-349). **Not live until pasted.**

**2026-10-08** (`78e47f5`, email audit P18): `pruneCommentHistory_` archives through `archiveChunksVerifiedGs_` (`GS-002` FN-352): a failed proof trashes the files it wrote, a retry reuses the identical archive, and the `archive_log.csv` row is written only after the rows are gone. A prune archives first, proves the archive, then deletes. When the proof (or a later sheet write) failed, the files it had written stayed in Drive and the next run - 4 a day - wrote another identical copy: 14 extra `Comment_History` and 18 extra `Unmatched_Comments_Log` archives sat in Drive from 2026-10-03. Fixed in `Core.gs` (`FN-350`..`FN-353`): an identical archive is reused, a failed proof trashes the files that call created, and the `archive_log.csv` row is written only after the rows are gone. `docs/_planning/EMAIL_AUDIT.md` P18. **Not live until pasted.**

## Revalidation trigger

Any commit touching `InteractionHistoryLogger.gs` or its `Tests_` file;
the dedup-key logic changes; the retention window (`COMMENT_HISTORY_RETENTION_DAYS_`)
changes; `latestOutcomeGs_` (`GS-005`) changes; `Comment_History`
(`SHEET-009`) columns change; `snapshotOpenLeads_` (`GS-008`) stops
calling it.

## Handover relationship

`HANDOVER.md` §2 and its sheet-lifecycle table (§4-area) both updated in
the SAME commit as this record and the pruning code itself (2026-09-29),
per `CLAUDE.md`'s own "real architectural change" rule.

## Lifecycle / retention

`Comment_History` (`SHEET-009`): shipped 2026-09-05 with **no retention
limit — append-only by design**. **Changed 2026-09-29** — Snehil
confirmed 30-day retention (`COMMENT_HISTORY_RETENTION_DAYS_`) after the
cell-budget diagnostic found this tab at 1,048,164 cells (2026-09-28).
`pruneCommentHistory_` (FN-307) archives every row past the window to
Drive, then removes it, on the same 4×/day trigger `logInteractionHistoryGs_`
already runs on. Confirmed policy, not `TBD` — see `docs/_planning/DB_ARCHITECTURE_REVIEW.md`'s
own "comment_history" section for the pre-2026-09-29 reasoning this
supersedes.

## Next action

none — Closed + Monitored.

## Closure evidence

Record committed for DOC-029; `docs/INDEX.md` `GS-006` → `Closed +
Monitored`, `Last Verified` 2026-09-10, links + "piggyback trigger"
recorded; `EXC-068`/`069`. No `docs/changes/` record (DOC-029).
