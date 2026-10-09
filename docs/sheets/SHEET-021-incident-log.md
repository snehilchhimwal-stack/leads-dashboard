# SHEET-021 - Incident_Log

| | |
|---|---|
| **Type** | `SHEET-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | Google Sheet, tab `Incident_Log` |
| **Owner** | Snehil |
| **Component Status** | Active (created on the first ops alert after `GS-015` is pasted) |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-10-09 against commit `f46ebc7` - created (Email Ops EO-2) |

## Purpose / reason to exist

One row for every ops alert the email system raises (`notifyOpsAlertGs_`, `GS-004`): what happened, how bad, which job, whether and when
Snehil was told, and what was confirmed about the rest of the run at that moment. It is the incident record the Email Operations System
plan asks for (`docs/_planning/EMAIL_OPS_SYSTEM_AUDIT.md`, rule 5) and the safety net behind decision D2: an alert raised while one of the
three email jobs runs is recorded here as `HELD` at once and emailed only after the job; if the job is killed before it can send it, the
watchdog finds the `HELD` row and releases it.

## Data stored

One row per alert: `incident_id`, `day`, `detected_at`, `job` (the email job that was running, blank outside one), `severity`, `scope`,
`subject`, `detail` (the alert text, 1,500 characters at most), `attention_required`, `owner`, `notification`, `notified_at`, `continuity`,
`resolved_at`, `resolution`.

## Source of the data

`GS-015` `incidentRecordGs_`, called by `notifyOpsAlertGs_` (`GS-004`) for every alert; `incidentNotifiedGs_` updates the notification columns.
Created with its header row on first use; `GS-015` refuses to write into a tab whose columns it does not recognise.

## Destination / consumers

`releaseHeldIncidentsGs_` (`GS-015`, called by the hourly watchdog in `GS-004`) reads it. The 16:30 cycle report (EO-8) and the daily
checklist (EO-6) will count it. People read it directly.

## Columns / fields

| Column | Type | Meaning |
|---|---|---|
| `incident_id` | text | `INC-yyyymmdd-hhmmss-n` (IST) |
| `day` | text | the IST day (`yyyy-MM-dd`, text format) |
| `detected_at` | datetime | when the alert was raised |
| `job` | text | the email job running at the time (`sendAllIssuesEmails`, `sendOvernightMorningEmails`, `sendOvernightFollowupEmails`) or blank |
| `severity` | text | `CRITICAL` (a whole job crashed / did not run / was skipped), `HIGH` (test mode, no lock, an address that cannot be resolved), `MEDIUM` (one bucket or item), `LOW` (bookkeeping notes); a guess from the subject unless the caller passes one |
| `scope` | text | `system` for CRITICAL, otherwise `item` |
| `subject` / `detail` | text | the alert subject and text |
| `attention_required` | text | `yes` unless the severity is LOW |
| `owner` | text | who must act (Snehil) |
| `notification` | text | `HELD` (waiting for the job to end), `PENDING` (sent immediately, not yet confirmed), `SENT`, `SEND-FAILED`, `RELEASED` (sent by the watchdog because the job never finished) |
| `notified_at` | datetime | when the notification was sent - blank until it was |
| `continuity` | text | why it was held or sent at once; once flushed, the confirmation line (how many emails Gmail accepted) |
| `resolved_at` / `resolution` | datetime / text | filled by a person (or EO-9) when the incident is closed |

Exact list: `EmailLedger.gs` `EMAIL_INCIDENT_HEADERS_`.

## Writers

| Writer | `FN-XXX` | Mode |
|---|---|---|
| `GS-015` | `incidentRecordGs_` (FN-390) | append |
| `GS-015` | `incidentNotifiedGs_` (FN-390) | update the notification columns |
| `GS-015` | `releaseHeldIncidentsGs_` (FN-392) | via `incidentNotifiedGs_` |

## Readers

| Reader | `FN-XXX` | For |
|---|---|---|
| `GS-015` | `releaseHeldIncidentsGs_` (FN-392) | finds HELD incidents older than 45 minutes |

## Automation / triggers touching it

Written whenever an alert is raised. Read by the hourly `emailJobWatchdog` trigger (`GS-004`).

## Apps Script functions touching it

`GS-015`: `incidentRecordGs_`, `incidentNotifiedGs_`, `releaseHeldIncidentsGs_`, `emailIncidentSheetGs_`.

## Data Lifecycle

- **Data Type:** historical (incident record).
- **Retention Period:** none yet - a few rows a day; revisit with the 16:30 cycle report (EO-8).
- **Enforced By:** None.
- **Archive / Delete Behavior:** grows slowly; nothing removes rows.
- **Sensitivity:** operational - alert text can name recipients and lead ids.

## Sensitivity & operational importance (DOC-038)

- **Operational importance:** **MEDIUM** - alerts still go out without it, but a job killed while holding alerts relies on the `HELD` rows to release them.
- **Data sensitivity:** recipient addresses and lead ids inside the alert text.
- **Reason:** the held-alert safety net and the incident history.

## Risks of changing this tab's structure

`GS-015` checks the header positionally and updates three adjacent columns (`notification`, `notified_at`, `continuity`) in one call: never
reorder or rename a column by hand. Deleting a `HELD` row loses that alert.

## Relationships to other tabs

Complements `SHEET-019` (`Email_Ledger`): the ledger says what happened to each email, this says what went wrong and who was told.

## Important logic / business rules

`RULE-047` (held alerts) and `RULE-048` (the watchdog release) in `GS-015`.

## Exceptions & error handling

`EXC-122`, `EXC-123` in `GS-015`.

## Related documentation

`docs/_planning/EMAIL_OPS_SYSTEM_AUDIT.md` (decision D2, rule 5); `HANDOVER.md` section 4.3.5.

## Relationships

- **Depends On:** `GS-015`, `EXT-001`
- **Used By:** `GS-015`
- **Related:** `SHEET-019`

## Source of truth

The live tab; header authored in `EmailLedger.gs` (`EMAIL_INCIDENT_HEADERS_`).

## Validation

- **Method:** `Tests_EmailLedger.gs` (alerts outside and inside a job, several alerts, a crash, a killed job released by the watchdog, test mode, a broken sheet), mutation-proved.
- **Evidence:** `.github/workflows/test.yml`.
- **Status:** Validated 2026-10-09 (locally); live behaviour proven by the first alert after the paste.

## Version / change reference

**2026-10-09** (`f46ebc7`): tab created by Email Ops EO-2. **Not live until pasted.**

## Revalidation trigger

The header constant changes; `notifyOpsAlertGs_` or the job wrapper changes; the release window changes.

## Handover relationship

`HANDOVER.md` section 4.3.5.

## Lifecycle / retention

None yet.

## Next action

After the first live alert, read the tab once; add retention with the 16:30 cycle report.

## Closure evidence

Record created with the feature; `docs/INDEX.md` `SHEET-021`.
