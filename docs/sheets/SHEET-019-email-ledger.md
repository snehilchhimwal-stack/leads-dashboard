# SHEET-019 - Email_Ledger

| | |
|---|---|
| **Type** | `SHEET-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | Google Sheet, tab `Email_Ledger` |
| **Owner** | Snehil |
| **Component Status** | Active (created on the first 17:00 run after `GS-015` is pasted) |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-10-09 against commit `b1dbc3a` - created (Email Ops EO-1a) |

## Purpose / reason to exist

The per-email evidence trail (`GS-015`): one row per bucket email of the 17:00 job, from PLANNED to its final status, with the Gmail message and thread ids. It exists because every older log is written only after a successful send, so the system could not know what should have gone out and did not.

## Data stored

One row per bucket email (recipient group x region x job x day).

## Source of the data

`GS-015` (`EmailLedger.gs`), called from `GS-001` (`sendAllIssuesEmails_` / `sendOneAllIssuesEmail_`). Created with its header row on first
use; `GS-015` refuses to write into a tab whose columns it does not recognise (`EXC-119`).

## Destination / consumers

None yet except `showEmailLedgerTodayNow()` (read-only). The 13:00 audit, the 17:00 reconciliation, the bounce/reply sweep and the
16:30 cycle report (Email Ops EO-3, EO-4, EO-5, EO-8) will read it.

## Columns / fields

| Column | Type | Meaning |
|---|---|---|
| `email_id` | text | deterministic `yyyymmdd / job / region / role / bucket` joined with a pipe - the same bucket on the same day has the same id |
| `cycle_day` | text | the run's IST day (`yyyy-MM-dd`, text format so Sheets never turns it into a date) |
| `job` / `region` / `bucket_label` / `primary_role` | text | which email: job id (`allIssues17`), region, recipient bucket, its role |
| `to` / `cc` / `subject` | text | the planned recipients and subject |
| `leads_planned` | number | leads the bucket was planned with |
| `planned_at` | datetime | when the region's buckets were planned |
| `attempted_at` / `finished_at` | datetime | the last attempt's start and end; `finished_at` is empty while ATTEMPTING |
| `status` | text | `PLANNED`, `ATTEMPTING`, `ACCEPTED`, `FAILED`, `UNCONFIRMED`, `BLOCKED` (see `GS-015` RULE-043) |
| `status_reason` | text | the failure/block reason (500 characters at most) |
| `attempts` | number | send attempts (a quarantine-and-resend counts as a second) |
| `message_id` / `thread_id` | text | the Gmail ids - the evidence that Gmail accepted the message |
| `leads_sent` | number | leads the accepted email really carried (0 unless ACCEPTED) |
| `lead_ids_json` | text (JSON) | the lead ids (planned, then the ones really sent) |
| `bounce_status` / `reply_status` / `swept_at` | text | reserved for the bounce/reply sweep (Email Ops EO-5); blank until then |

Exact list: `EmailLedger.gs` `EMAIL_LEDGER_HEADERS_`.

## Writers

| Writer | `FN-XXX` | Mode |
|---|---|---|
| `GS-015` | `emailLedgerPlanGs_` (FN-379) | append (one batch per region) |
| `GS-015` | `emailLedgerAttemptGs_` / `emailLedgerResultGs_` (FN-380) | update the nine outcome columns of one row |
| `GS-015` | `pruneEmailLedgerGs_` (FN-384) | delete old rows (after archiving) |

## Readers

| Reader | `FN-XXX` | For |
|---|---|---|
| `GS-015` | `showEmailLedgerTodayNow` (FN-386), `emailLedgerOpenGs_` (FN-378) | the daily count; indexing existing ids |

## Automation / triggers touching it

Written during the 17:00 `sendAllIssuesEmails` trigger (`GS-001`). No trigger of its own.

## Apps Script functions touching it

`GS-015`: `emailLedgerOpenGs_`, `emailLedgerPlanGs_`, `emailLedgerAttemptGs_`, `emailLedgerResultGs_`, `pruneEmailLedgerGs_`, `showEmailLedgerTodayNow`.

## Data Lifecycle

- **Data Type:** historical (evidence trail).
- **Retention Period:** 90 days in the workbook (`EMAIL_LEDGER_RETENTION_DAYS_`).
- **Enforced By:** `pruneEmailLedgerGs_` (`GS-015`), at the end of each 17:00 run.
- **Archive / Delete Behavior:** leading rows older than the window are archived to Drive (`Email_Ledger` folder under the archive root), then deleted; a failed archive deletes nothing.
- **Sensitivity:** operational - recipient addresses and lead ids.

## Sensitivity & operational importance (DOC-038)

- **Operational importance:** **MEDIUM** - nothing sends from it, but the planned audit and reconciliation reports will rely on it; a missing row is reported, not silently skipped.
- **Data sensitivity:** recipient email addresses, lead ids.
- **Reason:** an evidence trail; losing old rows loses history only.

## Risks of changing this tab's structure

`GS-015` checks the header positionally and writes the nine outcome columns in one call: **never reorder or rename a column by hand.** Appending a
column at the end is safe only if the constant is extended in the same change. Hiding the tab is fine.

## Relationships to other tabs

Complements `SHEET-013` (`AllIssues_Log`, written only after a successful send) and `SHEET-014` (`Overnight_Log`).

## Important logic / business rules

`RULE-043` (statuses never imply one another), `RULE-044` (fail-open), `RULE-045` (per-lead isolation), `RULE-046` (retention) in `GS-015`.

## Exceptions & error handling

`EXC-119`..`EXC-121` in `GS-015`.

## Related documentation

`docs/_planning/EMAIL_OPS_SYSTEM_AUDIT.md` section 6; `HANDOVER.md`.

## Relationships

- **Depends On:** `GS-015`, `EXT-001`
- **Used By:** `GS-015`, `GS-001`
- **Related:** `SHEET-013`, `SHEET-014`, `SHEET-020`

## Source of truth

The live tab; header authored in `EmailLedger.gs` (`EMAIL_LEDGER_HEADERS_`).

## Validation

- **Method:** `Tests_EmailLedger.gs` (in CI and the headless runner).
- **Evidence:** `.github/workflows/test.yml`.
- **Status:** Validated 2026-10-09 (locally); live behaviour proven by the first 17:00 run after the paste.

## Version / change reference

**2026-10-09** (`b1dbc3a`): tab created by Email Ops EO-1a. **Not live until pasted.**

## Revalidation trigger

The header constant changes; `GS-015` or the 17:00 flow changes; retention changes.

## Handover relationship

`HANDOVER.md` Email Operations section.

## Lifecycle / retention

90 days, archived to Drive first.

## Next action

None until the first live 17:00 run; then check `showEmailLedgerTodayNow()`.

## Closure evidence

Record created with the feature; `docs/INDEX.md` `SHEET-019`.
