# GS-021 - StaleLeads.gs

| | |
|---|---|
| **Type** | `GS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `StaleLeads.gs` |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-10-10 against commit `59db11b` - created (Email Ops decision D8) |

## Purpose / reason to exist

Decision D8 (2026-10-10, the user): a **stale lead** is a lead with **no update at all for more than 24 hours** - no stage change, no comment added, no call-count increase,
nothing - **no matter when it was created or assigned**. Every automatic email lists its stale leads in a **separate block at the very bottom**, after the ordinary tables
(the 17:00 bucket and CH-level emails, the 10:00 combined email and CH-level overnight report, the 13:00 reply). They are still in the email - every lead the email counts stays in
its body, so the send-safety gate, the ledger and the lead counts are unaffected - and nothing about who receives it changes. This file decides which leads are stale and builds the block.
(An earlier reading of "stale" as "the whole Leads tab is out of date" was withdrawn the same day: the Leads-tab freshness is again only a 16:30 report warning, `GS-004` FN-408.)

## Responsibilities

- Judge one live lead (`leadStaleStateGs_`): stale only when its live content still hashes the same as its latest `Movement_Log` row AND that row is more than 24 h old; a live row that already differs from its latest snapshot changed after it (not stale); a lead with no history is not stale (no evidence either way).
- Put the Date a stale lead last changed on each lead (`staleSinceOfRowGs_`), and look it up for the checkpoint tables (`staleSinceForLeadIdsGs_`, `staleSinceMapGs_`).
- Split a report (`splitStaleSectionsGs_`): move every stale row of every "Lead ID" table into a copy of that table with a "No update since" column, oldest first, under one red band "Stale leads - no update for more than 24 hours" at the bottom; a table left empty disappears (its region band passes on); nothing stale returns the input untouched.

## Trigger schedule

None - it runs inside the 17:00, 10:00 and 13:00 jobs.

## Requires `setupXxx()` re-run when

Never.

## Significant functions - `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-424 | `leadStaleStateGs_(row, colIndex, lastChangeMap, now)` / `staleSinceOfRowGs_(...)` | a live leads-tab row, its column index, the change map, the time | `{ stale, lastChangeAt, reason }` / the Date a stale lead last changed, else null (fail-open) | none (pure) | `_dedupKeyGs_`, `_leadContentHashGs_` (`GS-008`), `getVal_` (`GS-002`) | `GS-001`, `GS-010` | specific - RULE-066 |
| FN-425 | `staleSinceMapGs_(items)` / `staleSinceForLeadIdsGs_(leadIds, leadsData, now)` | leads carrying `staleSince` / lead ids and `{ colIndex, dataRows, lastChangeMap }` | `{ leadId: Date }` | none (pure; the second is fail-open: `{}` on any problem) | FN-424 | `GS-001`, `GS-010` | specific |
| FN-426 | `splitStaleSectionsGs_(sections, staleSince)` | a report's sections, `{ leadId: Date }` | the sections with the stale block at the bottom (or the same array) | none (pure; never modifies its input) | - | `GS-001`, `GS-010` | specific - RULE-067 |

## Business rules implemented - `RULE-XXX` sub-table

| ID | Rule | Where | Duplicated elsewhere? |
|---|---|---|---|
| RULE-066 | A lead is stale when it has had no update for MORE than 24 hours (exactly 24 h is not stale), judged from the Movement_Log content-hash history: unchanged since its latest snapshot and that snapshot is older than 24 h. The lead's creation / assignment time is never consulted. Because the snapshot runs four times a day and the observed time is never earlier than the real change, a lead is only called stale when it has really been quiet for more than 24 h (one quiet for 24-30 h may be missed). No history, a change since the snapshot, or any error means "not stale" | FN-424 | the dashboard's own "Stalled Leads" (`js/`) is a different, older rule (assigned 2+ days ago, no comment in 6+ h) and is unchanged |
| RULE-067 | Stale leads are held in a separate red block at the bottom of the email, oldest first, with their last-update time; they are never removed from the email or its counts; an email whose leads are all stale is still sent (only the block); the block exists in the HTML and the plain text; nothing stale = the email is exactly as before | FN-426 | - |

## Config constants - `CFG-XXX` sub-table

| ID | Constant | Value | Meaning | Changing it affects |
|---|---|---|---|---|
| CFG-121 | `LEAD_STALE_HOURS_` | `24` | the hours without an update after which a lead is stale | which leads move to the bottom block, and the block's heading |

## Exceptions - `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-139 | the stale check cannot run (an unreadable `Movement_Log`, bad data) | `staleSinceOfRowGs_` / `staleSinceForLeadIdsGs_` catch it and call nothing stale | the email is sent exactly as it was before this feature |

## Data lineage

Live `leads` tab row + `Movement_Log` (`SHEET-002`: `snapshot_at`, `lead_id`, `RM`, `content_hash` of the latest row per lead, read by `GS-008` `buildMovementLogMapsGs_` -> `lastChangeMap`) -> FN-424 -> `staleSince` on each lead -> FN-426 -> the report sections of the email.

## Sheets touched

| `SHEET-XXX` | Read / Write | Which `FN-XXX` | Notes |
|---|---|---|---|
| `SHEET-002` `Movement_Log` | Read (through `GS-008`) | FN-424 | five columns now: `snapshot_at`, `lead_id`, `call_attempts`, `RM`, `content_hash` |

## Failure / error behaviour

Fail-open everywhere: any problem means "no stale block" and the email goes out as before.

## Cross-runtime duplication

None - backend only. (The dashboard's manual "Generate region emails" flow does not have this block.)

## Not live until pasted

Paste `StaleLeads.gs` (new), `Tests_StaleLeads.gs` (new), `MovementTracker.gs`, `EmailInfra.gs`, `AllIssuesEmailer.gs`, `OvernightEmailer.gs`, `Tests_RunAll.gs`; no `setupXxx()`. Until the first snapshot after the paste has run, behaviour is unchanged: the history needs `content_hash` rows (already written since 2026-09-11).

## UI relationships

N/A - backend.

## Architecture relationship

Apps Script backend; a pure helper layer used by the three email jobs.

## Related documentation

`docs/_planning/EMAIL_OPS_SYSTEM_AUDIT.md` (D8); `docs/EMAIL_OPS_OPERATING_MANUAL.md`; `HANDOVER.md` section 4.3.5.

## Relationships

- **Depends On:** `GS-002` (`Core.gs`), `GS-008` (`MovementTracker.gs`)
- **Used By:** `GS-001`, `GS-010`
- **Related:** `GS-004`, `SHEET-002`

## Source of truth

`StaleLeads.gs` at `HEAD`.

## Validation

- **Method:** `Tests_StaleLeads.gs` - the change map (and a real-shaped `Movement_Log`), one lead at every boundary (23.9 / 24 / 24.01 h), every tracked change flipping it, creation time ignored, no history / wrong RM / blank RM, the lookups, the split (every shape: mixed, all stale, region-band handoff, non-lead tables, no mutation, ordering, plain text), then the real 17:00, 10:00 and 13:00 jobs and both CH-level reports against a fake workbook; deliberate regressions (SL1..SL44) each caught.
- **Evidence:** `.github/workflows/test.yml`; the first live emails after the paste.
- **Status:** Validated 2026-10-10 (locally); live behaviour proven by the first emails.

## Version / change reference

**2026-10-10** (`59db11b`): file created - decision D8. `MovementTracker.gs` reads two more `Movement_Log` columns (`RM`, `content_hash`) and returns a `lastChangeMap` (`GS-008` FN-423); `AllIssuesEmailer.gs` and `OvernightEmailer.gs` put `staleSince` on each lead and split every report. **Not live until pasted.**

## Revalidation trigger

Any commit touching `StaleLeads.gs` or `Tests_StaleLeads.gs`; `SNAPSHOT_COLUMNS_` or the content-hash function (`GS-008`); the shape of the report sections (`Lead ID` as the first column).

## Handover relationship

`HANDOVER.md` section 4.3.5 updated in the same commit.

## Lifecycle / retention

N/A - no data of its own.

## Next action

After the first live 17:00 run, compare a stale lead's "No update since" time with its comments in the CRM once.

## Closure evidence

Record created with the feature; `docs/INDEX.md` `GS-021`.
