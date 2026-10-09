# GS-018 - OpsAudit.gs

| | |
|---|---|
| **Type** | `GS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `OpsAudit.gs` |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-10-09 against commit `15bec89` - created (Email Ops EO-3 / EO-4) |

## Purpose / reason to exist

Three short, silent audit passes - about 11:15 (the 10:00 emails), 14:00 (the 13:00 replies) and 18:00 (the 17:00 emails) - that compare the two sets of
records an email job leaves behind: the evidence ledger (`SHEET-019`) and the older working logs the NEXT job relies on (`SHEET-014` Overnight_Log, `SHEET-013`
AllIssues_Log). Nothing fails today when an email went out but its working-log row was lost; the next job just silently skips that bucket (no Checkpoint 1 at
10:00, no threaded reply at 13:00). The audits find that class of gap while there is still time to recover (they run before the recovery cutoffs 12:45, 16:00 and
18:30). They are SILENT when the records agree, send ONE alert to the ops address when they do not, and never block, re-send or change anything.
Plan: `docs/_planning/EMAIL_OPS_SYSTEM_AUDIT.md` (EO-3 / EO-4; spec "reconcile everything").

## Responsibilities

- `UNFINISHED` - a bucket left PLANNED or ATTEMPTING after its job ended (the run died); names the matching recovery.
- `ACCEPTED_WITHOUT_LOG` - Gmail accepted a bucket email but its Overnight_Log / AllIssues_Log row is missing (the next job would skip it).
- `LOG_WITHOUT_LEDGER` - a working-log row with no ledger row; or NO ledger rows at all for a job that did send (one finding, not one per row).
- `DUPLICATE_LOG` - the same recipient logged twice for the same region and day (a possible double send).
- `CHECKPOINT1_GAP` (10:00 audit) - yesterday's 17:00 bucket still has no Checkpoint 1 stamp and no FAILED / BLOCKED / UNCONFIRMED ledger row explaining it.
- `FOLLOWUP_GAP` (13:00 audit) - a 10:00 bucket has no 13:00 reply and no ledger row for one.
- Defer (never alert) while the audited job is still running; skip (never alert) when the job has no run record today - the hourly watchdog owns "stuck" and "never started".
- Keep a "last audit" record per audit (`EMAIL_AUDIT_LAST_<job>` Script Property) for the daily report.

## Trigger schedule

`setupOpsAuditTriggers()` installs THREE daily triggers (`atHour(11/14/18).nearMinute(15/0/0)`, `Asia/Kolkata`) for `auditMorningEmails`, `auditFollowupEmails`, `auditAllIssuesEmails`. Each runs through
`runEmailJobTrackedGs_` - a run record the watchdog watches (`emailJobScheduleGs_`, deadlines 11:45, 14:30, 18:30) - and deliberately WITHOUT the script-wide job lock (an audit must never make an email job skip).

## Requires `setupXxx()` re-run when

First install (run `setupOpsAuditTriggers()` once after pasting) and whenever an audit's hour or minute (`OPS_AUDIT_SPECS_`) changes.

## Significant functions - `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-411 | `opsAuditUnfinishedGs_` / `opsAuditAcceptedWithoutLogGs_` / `opsAuditLogWithoutLedgerGs_` / `opsAuditDuplicateLogGs_` / `opsAuditCheckpoint1GapsGs_` / `opsAuditFollowupGapsGs_` | ledger rows and working-log rows as plain objects | a finding `{code, severity, summary, count, items, more, why, action}` or `null` | none (pure) | `opsAuditKeyGs_`, `opsAuditFindingGs_` | FN-412 | specific - RULE-060 / RULE-061 |
| FN-412 | `opsAuditMorningRulesGs_` / `opsAuditFollowupRulesGs_` / `opsAuditAllIssuesRulesGs_` | `{ledger, allIssuesLog, prevAllIssuesLog, overnightLog}` | the findings of that audit | none (pure) | FN-411 | FN-413 | specific |
| FN-413 | `opsAuditRun_(spec, opts)` / `opsAuditJobStateGs_` / `opsAuditReadAllIssuesLogGs_` / `opsAuditReadOvernightLogGs_` / `opsAuditRecordGs_` / `opsAuditReadRecordGs_` | an audit spec, `{now, dryRun}` | `{job, day, status: clean / exceptions / deferred / skipped / failed, reason, findings}` | reads the ledger and the two working logs (narrow columns); one ops alert when there are findings (or when it could not run); writes the "last audit" property; a dry run or TEST MODE sends and records nothing | `emailLedgerReadRowsGs_` (`GS-015`), `readEmailJobRunGs_`, `notifyOpsAlertGs_` (`GS-004`) | FN-414 | specific - RULE-060 |
| FN-414 | `auditMorningEmails()` / `auditFollowupEmails()` / `auditAllIssuesEmails()` (+ `...Now`) / `setupOpsAuditTriggers()` / `showEmailAuditNow()` / `opsAuditEntryGs_` | - | - | the run record (no job lock); a crash alerts ops at once and re-throws; trigger install; a read-only dry run in the log | `runEmailJobTrackedGs_` (`GS-004`) | the triggers / Apps Script editor | specific |

## Business rules implemented - `RULE-XXX` sub-table

| ID | Rule | Where | Duplicated elsewhere? |
|---|---|---|---|
| RULE-060 | An audit is silent unless it finds an exception: no email when the records agree. When it does, ONE alert goes to the ops address (severity = the worst finding), naming the finding, what is affected, why it matters and what to do. It never blocks, re-sends or edits anything. A job still running (and not yet stuck) is DEFERRED, a job with no run record today is SKIPPED - neither alerts (the watchdog owns those); an audit that cannot read its inputs says so once and records `failed` | FN-413 | - |
| RULE-061 | A gap rule is judged only when the ledger was running for that job today (there is at least one ledger row for it): with none, ONE `LOG_WITHOUT_LEDGER` finding says so instead of a finding per bucket (expected once, on the day the ledger is first pasted). A bucket whose 10:00 email FAILED / was BLOCKED / is UNCONFIRMED is a known, already-alerted problem and is not raised again as a checkpoint gap | FN-411, FN-412 | - |

## Config constants - `CFG-XXX` sub-table

| ID | Constant | Value | Meaning | Changing it affects |
|---|---|---|---|---|
| CFG-118 | `OPS_AUDIT_SPECS_`, `OPS_AUDIT_MAX_LIST_`, `OPS_AUDIT_RECORD_PREFIX_` | three audits at `11:15`, `14:00`, `18:00`; `8` items named per finding; `EMAIL_AUDIT_LAST_` | when each audit runs and which job it watches; how long an alert can get; where the last result is kept | the triggers (re-run `setupOpsAuditTriggers`), the watchdog deadlines, the length of the alert |

## Exceptions - `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-133 | the audit cannot read the ledger or a working log | status `failed`; one "Email audit (...) could not run" alert at MEDIUM; the "last audit" record says failed | the emails are unaffected; the audit is a check, not a gate |
| EXC-134 | the audited job is still running when the audit fires | status `deferred`; no alert; recorded for the daily report | none (a later manual `auditXxxNow()` re-checks) |

## Data lineage

`SHEET-019` Email_Ledger + `SHEET-013` AllIssues_Log + `SHEET-014` Overnight_Log -> FN-413 -> (only on an exception) one ops alert and an `Incident_Log` row (`SHEET-021`); every run -> a Script Property `EMAIL_AUDIT_LAST_<job>`.

## Sheets touched

| `SHEET-XXX` | Read / Write | Which `FN-XXX` | Notes |
|---|---|---|---|
| `SHEET-019` `Email_Ledger` | Read | FN-413 | today's rows |
| `SHEET-013` `AllIssues_Log` | Read | FN-413 | date, region, label, recipient, lead count and the Checkpoint 1 stamp only (not the large JSON columns) |
| `SHEET-014` `Overnight_Log` | Read | FN-413 | date, region, recipient, reply stamp |
| `SHEET-021` `Incident_Log` | Write (via the alert) | FN-413 | one row per alert |

## Failure / error behaviour

An unreadable input is a `failed` audit with one alert, never an exception or a false "clean"; a crash alerts ops at once and re-throws.

## Cross-runtime duplication

None - backend only.

## Not live until pasted

Paste `OpsAudit.gs` (new) and `Tests_OpsAudit.gs` (new) with `EmailInfra.gs` (the watchdog schedule), `Tests_EmailInfra.gs`, `Tests_RunAll.gs`; then run `setupOpsAuditTriggers()` once and `showEmailAuditNow()` (read-only) to see what each audit would say right now.
The first audit after the ledger is first pasted may say "Email_Ledger has none for the ... job" - expected once, for the jobs that ran before the ledger existed.

## UI relationships

N/A - backend.

## Architecture relationship

Apps Script backend; three time-driven jobs with run records watched by the hourly watchdog, and no job lock.

## Related documentation

`docs/_planning/EMAIL_OPS_SYSTEM_AUDIT.md`; `docs/EMAIL_OPS_OPERATING_MANUAL.md`; `HANDOVER.md` section 4.3.5.

## Relationships

- **Depends On:** `GS-002` (`Core.gs`), `GS-004` (`EmailInfra.gs`), `GS-015` (`EmailLedger.gs`), `SHEET-013`, `SHEET-014`, `SHEET-019`, `SHEET-021`
- **Used By:** `GS-004` (the watchdog schedule reads `OPS_AUDIT_SPECS_`)
- **Related:** `GS-001` / `GS-010` (the jobs it audits), `GS-016` (the report)

## Source of truth

`OpsAudit.gs` at `HEAD`.

## Validation

- **Method:** `Tests_OpsAudit.gs` - every rule against hand-built rows (every edge), then real 17:00 / 10:00 / 13:00 runs audited clean and with exactly one piece of evidence damaged at a time, the failure modes (unreadable inputs, a crash, no lock), the triggers and the watchdog schedule; deliberate regressions (OA1..OA38) each caught.
- **Evidence:** `.github/workflows/test.yml`; the first live audits (`showEmailAuditNow()`).
- **Status:** Validated 2026-10-09 (locally); live behaviour proven by the first audits.

## Version / change reference

**2026-10-09** (`15bec89`): file created - Email Ops EO-3 / EO-4. `emailJobScheduleGs_` (`GS-004` FN-332) lists the three audits once this file is part of the project. **Not live until pasted.**

## Revalidation trigger

Any commit touching `OpsAudit.gs` or `Tests_OpsAudit.gs`; the columns of `Overnight_Log` / `AllIssues_Log`; the ledger's statuses.

## Handover relationship

`HANDOVER.md` section 4.3.5 updated in the same commit.

## Lifecycle / retention

N/A - writes one small Script Property per audit.

## Next action

After the first live audits, break one working-log row on a copy and confirm the matching alert arrives.

## Closure evidence

Record created with the feature; `docs/INDEX.md` `GS-018`.
