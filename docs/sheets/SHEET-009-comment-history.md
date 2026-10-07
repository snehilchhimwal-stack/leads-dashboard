# SHEET-009 — Comment_History

| | |
|---|---|
| **Type** | `SHEET-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | Google Sheet, tab `Comment_History` |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-10-07 against commit `58ab8e1` - email audit P17: the 30-day prune had been failing silently; fixed (see `## Version / change reference`) |

## Purpose / reason to exist

A forward-looking, append-only record of every genuinely-new comment on
an open lead (any outcome). Added 2026-09-05. It exists so the project
accumulates an interaction history it never previously kept — a dataset
for later analysis of how RMs actually work a lead over time. It is
**not** consumed by the dashboard or any email; it is a capture for the
future.

*(Seed correction: `docs/INDEX.md` originally named `SHEET-009`
"Interaction_History"; the real tab is `Comment_History`, per
`InteractionHistoryLogger.gs` `ensureCommentHistorySheet_` and
`LOGIC_AUDIT.md` Part 1 §1. Fixed in `DOC-029`.)*

## Reason to exist

To keep a full interaction trail that outlives `Movement_Log`'s 7 days
and captures the *content* of each comment, not just SLA-relevant
signals.

## Data stored

One row per genuinely-new comment on an open lead, de-duped by
`(lead_id, comment)`.

## Source of the data

`GS-006` `logInteractionHistoryGs_`, invoked from `snapshotOpenLeads_`
(`GS-008`) — so it captures 4×/day, but only writes when a comment is
actually new.

## Destination / consumers

**None in code.** Reviewed / analysed directly in the sheet.

## Columns / fields

| Column | Type | Meaning |
|---|---|---|
| `date` | date | capture day |
| `lead_id` / `client_id` | text | identity |
| `RM` / `region` / `project` | text | routing |
| `comment` | text | the new comment |
| `comment_at` | datetime | when the RM logged it |
| `logged_at` | datetime | when this row was written |

Exact list: `InteractionHistoryLogger.gs` `COMMENT_HISTORY_COLUMNS_`
`#L76`.

## Writers

| Writer | `FN-XXX` | Mode |
|---|---|---|
| `GS-006` | `logInteractionHistoryGs_` (FN-212) | append (comment-triggered, de-duped) |
| `GS-006` | `logInteractionHistoryNow` (FN-215) | append (manual run) |

## Readers

| Reader | `FN-XXX` | For |
|---|---|---|
| *(none in code)* | — | direct sheet analysis only |

## Automation / triggers touching it

Piggybacks on `MovementTracker.gs`'s 4×/day trigger via
`snapshotOpenLeads_`. No trigger of its own (`GS-006` Trigger Schedule).

## Apps Script functions touching it

`logInteractionHistoryGs_`, `commentHistoryDedupKeyGs_`,
`ensureCommentHistorySheet_`, `logInteractionHistoryNow` (all `GS-006`).

## Data Lifecycle (DOC-019 — confirmed; DOC-036 signed off 2026-09-10)

- **Data Type:** historical
- **Retention Period:** **30 days since 2026-09-29** (`COMMENT_HISTORY_RETENTION_DAYS_`).
  It shipped 2026-09-05 with no limit (append-only by design - comment-triggered
  writes are an order of magnitude rarer than `Movement_Log`'s unconditional
  4×/day, `LOGIC_AUDIT.md` Part 1 §4d, which is a dated snapshot and still
  describes that original state), then a 30-day window was confirmed because
  the tab counts against the workbook's shared cell ceiling.
- **Enforced By:** `pruneCommentHistory_` (`GS-006` FN-307), on every
  scheduled snapshot (`snapshotOpenLeads_`, 4×/day) and by hand via
  `pruneCommentHistoryNow()`
- **Archive / Delete Behavior:** rows past the window are first written to a
  Drive CSV (chunks of 5,000), then removed; the prune refuses to delete when
  the archive's record count does not match (`GS-006` EXC-104). A failure is
  emailed to ops since 2026-10-07 (`GS-008` FN-349)
- **Sensitivity:** contains RM comment text + customer context —
  `DOC-036` to confirm the classification, but the retention answer is
  **known**.

## Sensitivity & operational importance (DOC-038)

- **Operational importance:** **LOW** — display / audit-trail only — no automated dependency; losing it loses history, nothing stops working.
- **Data sensitivity:** **free-text RM comment content + customer context**, accumulated indefinitely.
- **Reason:** **No code reads it at all** — a pure forward-capture dataset for future analysis; nothing breaks if it is gone. But its append-only accumulation of full comment text makes it the highest data-minimisation concern among the LOW-operational tabs.

## Risks of changing this tab's structure

A column rename breaks `logInteractionHistoryGs_`'s dedup. Adding a
column is safe. Because nothing reads it in code, a structural change has
low downstream blast radius — but any future consumer added should be
recorded here.

## Relationships to other tabs

Derived from `SHEET-001` (`leads`) via the piggyback scan. Independent
of every other tab.

## Important logic / business rules

Dedup by `(lead_id, comment)` rather than purely by `comment_at` — a
deliberate hedge against the Sheets string→Date coercion class that bit
`SHEET-010` (`GS-006` EXC-068). No automatic pruning (EXC-069).

## Exceptions & error handling

The scan is try/catch-isolated inside `snapshotOpenLeads_` — a failure
never blocks the core `Movement_Log` capture (`GS-006` EXC-070).

## Related documentation

`HANDOVER.md` §2, §9; `LOGIC_AUDIT.md` Part 1 §4d; `CLAUDE.md` (the
three-registration rule for a new `.gs` file).

## Relationships

- **Depends On:** `GS-006`, `GS-008` (the piggyback host), `SHEET-001`
  (`leads`), `EXT-001`, `DATA-003`
- **Used By:** `GS-006`, `GS-008` — only (writer)
- **Related:** `SHEET-010` (`Unmatched_Comments_Log` — the sibling
  piggyback logger's output)

## Source of truth

The live `Comment_History` tab; schema `COMMENT_HISTORY_COLUMNS_`
(`InteractionHistoryLogger.gs`).

## Validation

- **Method:** column list read from `COMMENT_HISTORY_COLUMNS_` `#L76` at
  `c82ec67`; the "no pruning by design" and piggyback-trigger claims
  cross-checked against `LOGIC_AUDIT.md` Part 1 §4d.
  `Tests_InteractionHistoryLogger.gs` in CI.
- **Evidence:** `.github/workflows/test.yml`
  (`Tests_InteractionHistoryLogger.gs`, last green run); `LOGIC_AUDIT.md`
  Part 1 §4d.
- **Status:** Validated 2026-09-10 (**including** retention — this tab's
  lifecycle answer is known; only the sensitivity label is `TBD`).

## Version / change reference

Verified at `c82ec67`; record created by `DOC-032` (tab renamed in
`DOC-029`).

**2026-10-07** (`58ab8e1`, email audit P17): found 6,369 rows (oldest 32.8 days) past the 30-day retention because `pruneCommentHistory_` refused to run - its archive check counted CSV lines and a multi-line comment is one record on several lines (`GS-006`; fixed with `countCsvRecordsGs_`, `GS-002` FN-348). The first run after the paste archives and removes them (chunks of 5,000 rows). Earlier failed attempts probably left duplicate archive CSVs in the Drive archive folder (harmless; not touched).

## Revalidation trigger

`COMMENT_HISTORY_COLUMNS_` changes; a pruning policy is added; a consumer
starts reading it; `snapshotOpenLeads_` stops calling `GS-006`.

## Handover relationship

`HANDOVER.md` §2 names the file. Current as of 2026-09-09. Adding a
consumer or a pruning policy must update `HANDOVER.md` §2/§9.

## Lifecycle / retention

**30 days since 2026-09-29**, enforced by `pruneCommentHistory_`
(`GS-006`), archive-to-Drive first. Before that it was append-only by design
(`LOGIC_AUDIT.md` Part 1 §4d, a dated snapshot). Sensitivity classification
`TBD` (`DOC-036`).

## Next action

`DOC-036` — record the comment-data sensitivity classification (the
retention answer is already settled).

## Closure evidence

Record committed for `DOC-032`; `docs/INDEX.md` `SHEET-009` (renamed
`Comment_History` in `DOC-029`) → `Closed + Monitored`, `Last Verified`
2026-09-10; columns sourced from `COMMENT_HISTORY_COLUMNS_`, not
approximated; retention confirmed, sensitivity `TBD` per `DOC-032`
boundary.
