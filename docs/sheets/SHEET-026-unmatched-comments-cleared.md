# SHEET-026 - Unmatched_Comments_Cleared

| | |
|---|---|
| **Type** | `SHEET-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | Google Sheet, tab `Unmatched_Comments_Cleared` (hidden) |
| **Owner** | Snehil |
| **Component Status** | Active (code committed; the tab appears the first time `clearReviewedUnmatchedCommentsNow()` runs after the paste) |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-10-15 against commit `1f51394` - created (audit 2026-10-13 UC-01; code added in `450565a`) |

## Purpose / reason to exist

Remembers which `Unmatched_Comments_Log` (`SHEET-010`) rows a human reviewed
and cleared, so the 6-hourly scan does not log them again. Before this,
`clearReviewedUnmatchedCommentsNow()` removed reviewed rows and the scan's
dedup only looked at the live log, so a reviewed comment that was still the
lead's latest came straight back, unreviewed, on the next run (audit
2026-10-13 finding UC-01).

## Reason to exist

A review queue that refills itself with already-reviewed comments makes the
review pointless. A Script Property was rejected because one review batch can
be hundreds of keys (a property holds about 9 KB); keeping the reviewed rows
was rejected because the point of clearing them is a short queue (see the
comment above `UNMATCHED_COMMENTS_CLEARED_SHEET_` in
`UnmatchedCommentLogger.gs`).

## Data stored

One row per cleared review key, at most one retention window (30 days) of
them. No comment text, no RM names.

## Source of the data

`GS-013` `clearReviewedUnmatchedCommentsNow()` (manual, Apps Script editor),
via `recordClearedUnmatchedKeysGs_`, for each row whose `reviewed` cell is set.

## Destination / consumers

`GS-013` `scanUnmatchedCommentsGs_` (via `readClearedUnmatchedKeysGs_`):
every live key counts as "already logged", so the comment is not appended to
`Unmatched_Comments_Log` again.

## Columns / fields

| Column | Type | Meaning |
|---|---|---|
| `key` | text | the comment's dedup key, `commentHistoryReadBackKeyGs_(lead_id, comment_at, comment)` - the same key the scan builds |
| `day` | text (`yyyy-MM-dd`) | the day the entry stops mattering: the comment's own day (after that the scan's retention check, `commentBeyondRetentionGs_`, skips it anyway), or the clearing day for a comment with no timestamp |

Exact list: `UnmatchedCommentLogger.gs` `UNMATCHED_COMMENTS_CLEARED_COLUMNS_`.
Both columns are written with number format `@` (plain text) so Sheets does
not turn the key or day into a Date.

## Writers

| Writer | `FN-XXX` | Mode |
|---|---|---|
| `GS-013` | `clearReviewedUnmatchedCommentsNow` (FN-253) via `recordClearedUnmatchedKeysGs_` | creates the tab (hidden, header row) if missing; merges the new keys with the live ones, rewrites the whole tab, then clears only the leftover tail (never clear-then-write). Runs BEFORE the reviewed rows are removed, so an interruption only leaves them in place |

## Readers

| Reader | `FN-XXX` | For |
|---|---|---|
| `GS-013` | `scanUnmatchedCommentsGs_` (FN-250) via `readClearedUnmatchedKeysGs_` | dedup - skip comments a human already cleared |
| `GS-013` | `recordClearedUnmatchedKeysGs_` | merge before rewrite |

## Automation / triggers touching it

Read on every scheduled snapshot (4x/day, piggyback on `GS-008`
`snapshotOpenLeads_`). Written only by the manual clear. No trigger of its own.

## Apps Script functions touching it

`readClearedUnmatchedKeysGs_`, `recordClearedUnmatchedKeysGs_`,
`unmatchedClearedEntryLiveGs_`, `clearReviewedUnmatchedCommentsNow`,
`scanUnmatchedCommentsGs_` (all `GS-013`).

## Data Lifecycle (DOC-019)

- **Data Type:** operational (dedup memory)
- **Retention Period:** 30 days (`UNMATCHED_COMMENTS_LOG_RETENTION_DAYS_`,
  the same window as `SHEET-010`)
- **Enforced By:** `recordClearedUnmatchedKeysGs_` drops entries whose `day`
  is older than the window on every clear; `readClearedUnmatchedKeysGs_`
  ignores them on every read. An unreadable `day` is kept.
- **Archive / Delete Behavior:** expired entries are dropped without an
  archive (they hold only keys, no content)
- **Sensitivity:** lead ids inside the keys; no comment text

## Sensitivity & operational importance (DOC-038)

- **Operational importance:** **LOW** - losing the tab only means cleared
  comments can come back into the review queue once.
- **Data sensitivity:** **lead ids only**.
- **Reason:** only `GS-013` reads it, for dedup.

## Risks of changing this tab's structure

The scan matches `key` exactly against the key it builds for each comment,
so any change to `commentHistoryReadBackKeyGs_` makes every stored key stop
matching (cleared comments would come back once). The day is parsed from the
key's `|yyyy-MM-dd HH:mm` tail; a key format without it falls back to the
clearing day. Do not unhide-and-edit by hand.

## Relationships to other tabs

Companion to `SHEET-010` (`Unmatched_Comments_Log`): holds the keys of rows
cleared from it.

## Important logic / business rules

A comment with no timestamp can come back once its entry passes the 30-day
window (stated in the code comment).

## Exceptions & error handling

Every read/write goes through `withRetry_`; hiding the new tab is best-effort
(a failure is logged, not thrown).

## Related documentation

`GS-013`; `SHEET-010`; audit report
`docs/_planning/CODE_AUDIT_2026-10-13_APPS_SCRIPT.md` (UC-01).

## Relationships

- **Depends On:** `EXT-001`, `GS-013`
- **Used By:** `GS-013`
- **Related:** `SHEET-010`

## Source of truth

The live tab; schema `UNMATCHED_COMMENTS_CLEARED_COLUMNS_`
(`UnmatchedCommentLogger.gs`).

## Validation

- **Method:** read `UnmatchedCommentLogger.gs` at `1f51394` (the
  "Cleared-review memory (UC-01, 2026-10-13)" block and
  `clearReviewedUnmatchedCommentsNow`); `Tests_UnmatchedCommentLogger.gs`
  covers it (added in `450565a`).
- **Evidence:** `Tests_UnmatchedCommentLogger.gs` (via `.github/workflows/test.yml`); the UC-01 code comment in `UnmatchedCommentLogger.gs`.
- **Status:** Validated 2026-10-15 against the code; the live tab does not
  exist until the paste and the first clear.

## Version / change reference

**2026-10-15** (`450565a`, audit 2026-10-13 UC-01): record created. The tab is
new in this commit. **Not live until pasted.**

## Revalidation trigger

`UNMATCHED_COMMENTS_CLEARED_COLUMNS_` or `commentHistoryReadBackKeyGs_`
changes; `UNMATCHED_COMMENTS_LOG_RETENTION_DAYS_` changes; the clear stops
recording keys.

## Handover relationship

`HANDOVER.md` audit 2026-10-13 summary lists it.

## Lifecycle / retention

30 days, self-pruning on every clear (see above).

## Next action

After the paste and the first `clearReviewedUnmatchedCommentsNow()`, confirm
the hidden tab exists and the next scan does not re-log a cleared comment.

## Closure evidence

Columns sourced from `UNMATCHED_COMMENTS_CLEARED_COLUMNS_`, not approximated.
