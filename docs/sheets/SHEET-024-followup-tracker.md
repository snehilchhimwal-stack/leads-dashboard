# SHEET-024 - Followup_Tracker

| | |
|---|---|
| **Type** | `SHEET-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | Google Sheet, tab `Followup_Tracker` |
| **Owner** | Snehil |
| **Component Status** | Active (created by the first 16:30 report after `GS-020` is pasted) |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-10-09 against commit `b6e714b` - created (Email Ops EO-7) |

## Purpose / reason to exist

The follow-up tracker (`GS-020`) as it stood when each day's 16:30 report was sent: one row per 17:00 bucket of that report's cycle, with where Checkpoint 1 (the 10:00 email) and
Checkpoint 2 (the 13:00 reply) stood - `COMPLETED`, `NOT_NEEDED`, `BLOCKED`, `OVERDUE`, `DUE` or `FUTURE` - the reason, and whether the 17:00 email bounced or got a reply (a bounce
marks the row `stop`). The email shows the counts and what needs a look; this tab keeps every bucket so a missed follow-up can be found afterwards.

## Data stored

Per row: `report_day` (text, `yyyy-MM-dd`), `cycle_day` (the day of the 17:00 emails), `region`, `bucket`, `role`, `recipient`, `leads`, `checkpoint1`, `checkpoint1_note`, `checkpoint2`,
`checkpoint2_note` (notes cut to 300 characters), `email_status` (`BOUNCED` / `REPLIED` / blank), `stop` (`yes` / blank), `evaluated_at`.

## Source of the data

`GS-020` `followupTrackerRecordGs_`, after the report email was sent. A forced re-send on the same day REPLACES that day's block (also when the number of buckets changed); a new day
appends its own. Fail-open: a failure to write never affects the email; TEST MODE writes nothing; with no 17:00 bucket nothing is written.

## Destination / consumers

People. Nothing reads it automatically yet.

## Columns / fields

See "Data stored"; exact list: `FollowupTracker.gs` `FOLLOWUP_TRACKER_HEADERS_`. The recipient column holds internal manager addresses (as `Email_Ledger` does).

## Writers

| Writer | `FN-XXX` | Mode |
|---|---|---|
| `GS-020` | `followupTrackerRecordGs_` (FN-421) via `GS-015` `emailLedgerReplaceDayBlockGs_` (FN-422) | replace today's block, or append |

## Readers

None.

## Automation / triggers touching it

Written by the 16:30 `sendEmailCycleReport` trigger (`GS-016`) through `GS-020`.

## Apps Script functions touching it

`GS-020`: `followupTrackerRecordGs_`; `GS-015`: `emailLedgerReplaceDayBlockGs_`.

## Data Lifecycle

- **Data Type:** historical (one row per 17:00 bucket per day, about 50 a day).
- **Retention Period:** none - about 18,000 small rows a year.
- **Enforced By:** None.
- **Archive / Delete Behavior:** grows by one block a day; nothing removes rows.
- **Sensitivity:** internal manager email addresses and bucket names; no lead data.

## Sensitivity & operational importance (DOC-038)

- **Operational importance:** **LOW** - history only; nothing depends on it.
- **Data sensitivity:** contact emails of internal managers (the same the ledger already holds).
- **Reason:** a tracking record of the follow-ups.

## Risks of changing this tab's structure

`GS-015` `emailLedgerReplaceDayBlockGs_` finds today's block by the first column and `GS-020` writes the 14 columns positionally: never reorder or rename a column by hand, and keep each day's rows together at the bottom.

## Relationships to other tabs

Summarises `SHEET-013` (the checkpoint stamps) and `SHEET-019` (the results) for one cycle; sits beside `SHEET-022` and `SHEET-023`.

## Important logic / business rules

`RULE-064`, `RULE-065` in `GS-020`.

## Exceptions & error handling

A write failure is logged only (`GS-020` `EXC-138`).

## Related documentation

`docs/_planning/EMAIL_OPS_SYSTEM_AUDIT.md` (EO-7); `HANDOVER.md` section 4.3.5.

## Relationships

- **Depends On:** `GS-020`, `EXT-001`
- **Used By:** `GS-020`
- **Related:** `SHEET-013`, `SHEET-019`, `SHEET-023`

## Source of truth

The live tab; header authored in `FollowupTracker.gs` (`FOLLOWUP_TRACKER_HEADERS_`).

## Validation

- **Method:** `Tests_FollowupTracker.gs` (create, same-day replace with fewer rows, a new day, long notes, TEST MODE, no bucket, a broken tab), mutation-proved.
- **Evidence:** `.github/workflows/test.yml`.
- **Status:** Validated 2026-10-09 (locally); live behaviour proven by the first 16:30 report.

## Version / change reference

**2026-10-09** (`d9e2b97`): tab created. **Not live until pasted.**

## Revalidation trigger

The header constant changes; the status list changes.

## Handover relationship

`HANDOVER.md` section 4.3.5.

## Lifecycle / retention

None yet.

## Next action

After a few weeks, decide whether to prune it like the ledger (90 days).

## Closure evidence

Record created with the feature; `docs/INDEX.md` `SHEET-024`.
