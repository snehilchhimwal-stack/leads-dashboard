# GS-019 - DailyChecklist.gs

| | |
|---|---|
| **Type** | `GS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `DailyChecklist.gs` |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-10-09 against commit `f475d10` - created (Email Ops EO-6) |

## Purpose / reason to exist

The spec's daily checklist, stages A to K, evaluated from evidence instead of ticked by hand. Eleven rows - A start of day, B lead sourcing, C data quality, D reason for
contact, E the 10:00 emails, F the 13:00 checkpoint, G the silent audits, H 17:00 preparation, I 17:00 send and verification, J bounce / reply monitoring, K end-of-day
reconciliation - each with a FLAG (GREEN / AMBER / RED / GREY) and the EVIDENCE for it. They are computed by the 16:30 report (`GS-016`) from the records the system
already keeps (ledger counts, exclusions, Leads-tab freshness, the watchdog's view of the job run records, the sweep columns, the last result of each silent audit,
`GS-018`), shown in the report as "Daily checklist (A-K)" and stored in the `Daily_Checklist` tab (`SHEET-023`) so a bad stage can be found afterwards.
Plan: `docs/_planning/EMAIL_OPS_SYSTEM_AUDIT.md` (EO-6).

The flags: GREEN = done and the evidence supports it. AMBER = look at it, OR the evidence is missing (missing evidence is never reported as a confirmed failure).
RED = a failure is on record. GREY = not applicable (nothing to judge). Nothing is ever marked complete because it was planned or attempted: a bucket left PLANNED /
ATTEMPTING is unfinished, so its stage is RED.

## Responsibilities

- Evaluate the eleven stages as a pure function of the report's data (`dailyChecklistGs_`) - no sheet reads of its own.
- Render the report section (`dailyChecklistSectionGs_`; red accent when any stage is RED).
- Store the rows, one set per IST day, replacing (never duplicating) a same-day re-send (`dailyChecklistRecordGs_`); fail-open; TEST MODE writes nothing.
- `showDailyChecklistNow()` logs the checklist as it would be built right now (read-only, first in the file because the editor's Run lags one selection).

## Trigger schedule

None of its own - it runs inside the 16:30 report (`GS-016`, `sendEmailCycleReport`).

## Requires `setupXxx()` re-run when

Never - no trigger of its own.

## Significant functions - `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-415 | `dailyChecklistGs_(input)` | `{ data (the report's cycle data), jobProblems (the watchdog's problems, or null when unreadable), audits: { morning, followup, allIssues } }` | the eleven rows `[{ stage, name, flag, evidence }]` | none (pure) | FN-416 | `GS-016` `cycleReportDataGs_` | specific - RULE-062 / RULE-063 |
| FN-416 | `dailyChecklistWorstGs_` / `dailyChecklistCountsGs_` / `dailyChecklistSendFlagGs_` / `dailyChecklistSendTextGs_` / `dailyChecklistAuditGs_` | flags / per-job counts / one audit record and the cycle window | the worst flag; summed counts or null; a flag; the evidence text; `{ flag, text }` | none (pure) | - | FN-415 | specific |
| FN-417 | `dailyChecklistSectionGs_(rows)` / `dailyChecklistRecordGs_(ss, rows, now)` / `showDailyChecklistNow()` | the rows, the workbook, the time | the report section; none; none | the record function writes `Daily_Checklist` (replace-or-append, fail-open); the preview only logs | `emailLedgerEnsureSheetGs_`, `emailLedgerAppendBlockGs_` (`GS-015`), `writeUnlessTestModeGs_` (`GS-004`) | `GS-016` | specific |

## Business rules implemented - `RULE-XXX` sub-table

| ID | Rule | Where | Duplicated elsewhere? |
|---|---|---|---|
| RULE-062 | A stage is RED only on a recorded failure (a failed / blocked / unfinished email, an audit exception, a bounce, a failed or never-started job, a RED Leads tab); AMBER when something needs a look (unconfirmed, left out with a reason, a deferred audit) OR when the evidence is missing (no row for the job, no audit result in the cycle, an unreadable record, the sweep has not run); GREY only when the stage does not apply (no 10:00 email to reply to, nothing accepted to monitor). A planned or attempted email never counts as done | FN-415 | the manual's "flags" table (`docs/EMAIL_OPS_OPERATING_MANUAL.md` section 4) |
| RULE-063 | K, the end-of-day reconciliation, is the worst of A-J, and never GREEN while a serious incident is open or alerts are still held | FN-415 | - |

## Config constants - `CFG-XXX` sub-table

| ID | Constant | Value | Meaning | Changing it affects |
|---|---|---|---|---|
| CFG-119 | `DAILY_CHECKLIST_SHEET_`, `DAILY_CHECKLIST_HEADERS_`, `DAILY_CHECKLIST_STAGES_`, `DAILY_CHECKLIST_FLAG_RANK_` | `Daily_Checklist`, `report_day, stage, check, flag, evidence, evaluated_at`, `11`, RED 3 > AMBER 2 > GREEN 1 > GREY 0 | the tab and its columns; how many rows a day; which flag wins when stages are combined | where the rows go (never reorder the columns by hand); how G, I and K combine |

## Exceptions - `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-135 | the rows cannot be stored (a broken tab, a failed write) | logged only; the report is already sent | none - the checklist is still in that day's email |
| EXC-136 | the checklist cannot be built | caught in `cycleReportDataGs_`; `data.checklist` stays null | the report has no checklist section; everything else is unchanged |

## Data lineage

The report's data (`GS-016`) <- `SHEET-019` Email_Ledger, `SHEET-020` Email_Ledger_Exclusions, `SHEET-021` Incident_Log, the Leads tab, the job run records and the audits' `EMAIL_AUDIT_LAST_<job>` properties -> FN-415 -> the report section and `SHEET-023` Daily_Checklist.

## Sheets touched

| `SHEET-XXX` | Read / Write | Which `FN-XXX` | Notes |
|---|---|---|---|
| `SHEET-023` `Daily_Checklist` | Read + write | FN-417 | today's contiguous block at the bottom is replaced (or appended) once the report is sent |

## Failure / error behaviour

Fail-open at both ends: a checklist that cannot be built leaves the report as before; rows that cannot be stored leave the email unaffected.

## Cross-runtime duplication

None - backend only.

## Not live until pasted

Paste `DailyChecklist.gs` (new), `Tests_DailyChecklist.gs` (new), `CycleReport.gs`, `Tests_RunAll.gs`; no `setupXxx()`. `showDailyChecklistNow()` (read-only) previews it. Until `OpsAudit.gs` is pasted and has run, G and I read AMBER ("no audit result in this cycle") - expected.

## UI relationships

N/A - backend.

## Architecture relationship

Apps Script backend; evaluated inside the 16:30 report job (no trigger, no lock of its own).

## Related documentation

`docs/_planning/EMAIL_OPS_SYSTEM_AUDIT.md`; `docs/EMAIL_OPS_OPERATING_MANUAL.md` section 5; `HANDOVER.md` section 4.3.5.

## Relationships

- **Depends On:** `GS-002` (`Core.gs`), `GS-004` (`EmailInfra.gs`), `GS-015` (`EmailLedger.gs`), `GS-016` (`CycleReport.gs`), `SHEET-023`
- **Used By:** `GS-016` (the report builds and stores the checklist when this file is present), `SHEET-023`
- **Related:** `GS-018` (the audits G and I read), `SHEET-019`, `SHEET-021`

## Source of truth

`DailyChecklist.gs` at `HEAD`.

## Validation

- **Method:** `Tests_DailyChecklist.gs` - the helpers, every flag of every stage on hand-built data, the report section, the `Daily_Checklist` tab (create, replace the same day, a new day, a partial block, TEST MODE, a broken tab), then a real 17:00 -> 10:00 -> 13:00 cycle with the report built from it (all GREEN) and damaged one piece at a time; deliberate regressions (DC1..DC48) each caught.
- **Evidence:** `.github/workflows/test.yml`; the first live 16:30 report after the paste.
- **Status:** Validated 2026-10-09 (locally); live behaviour proven by the first report.

## Version / change reference

**2026-10-09** (`f475d10`): file created - Email Ops EO-6. `CycleReport.gs` gathers the job problems and audit results, builds the checklist (fail-open), adds the "Daily checklist (A-K)" section before "Ready for 17:00?" and stores the rows after the send. **Not live until pasted.**

## Revalidation trigger

Any commit touching `DailyChecklist.gs` or `Tests_DailyChecklist.gs`; the report's data shape (`cycleReportDataGs_`); the audits' record shape (`OpsAudit.gs`).

## Handover relationship

`HANDOVER.md` section 4.3.5 updated in the same commit.

## Lifecycle / retention

`SHEET-023`: eleven rows a day, never pruned.

## Next action

After a week of reports, look at which stage is most often AMBER and decide whether its rule is too strict.

## Closure evidence

Record created with the feature; `docs/INDEX.md` `GS-019`.
