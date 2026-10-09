# GS-016 - CycleReport.gs

| | |
|---|---|
| **Type** | `GS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `CycleReport.gs` |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-10-09 against commit `d79aae5` - created (Email Ops EO-8) |

## Purpose / reason to exist

The one report Snehil asked to read every day (plan decision D1, `docs/_planning/EMAIL_OPS_SYSTEM_AUDIT.md`): at 16:30 IST, a single email to the ops
address covering the whole cycle that started at the previous day's 17:00 - every bucket email of the 17:00, 10:00 and 13:00 jobs and the CH-level
reports by final status, what was left out and why, the incidents raised, what needs attention, and whether the coming 17:00 send is ready. It is
sent when everything is fine AND when it is not; errors are emailed separately and earlier, after the rest of their run is confirmed sent
(`GS-015` RULE-047). It is built only from the evidence tabs (`SHEET-019`, `SHEET-020`, `SHEET-021`) - nothing is guessed, and it states what it
cannot see (delivery and opens cannot be seen from Apps Script; bounces and replies come from the daily sweep, `GS-017`; the age of the Leads tab is not tracked yet).

## Responsibilities

- Compute the cycle window: 16:30 of the previous IST day up to now (`cycleReportWindowGs_`).
- Turn ledger / exclusion / incident rows into counts and lists (`cycleReportDataGs_`, pure) and then into the email (`cycleReportRenderGs_`, pure).
- Send ONE email to `opsAlertEmailGs_()` only, once per IST day (`sendEmailCycleReport_`); `sendEmailCycleReportNow()` sends again on purpose.
- Run through the email jobs' lock and run record so the hourly watchdog alerts when it did not run by 17:00 (`emailJobScheduleGs_`, `GS-004`).

## Trigger schedule

`setupEmailCycleReportTrigger()` installs ONE trigger for `sendEmailCycleReport`: `atHour(16).nearMinute(30).everyDays(1)` in `Asia/Kolkata`. The
watchdog schedule lists it with `minute: 30`, so a missing report is flagged from 17:00 (16:30 + the 30-minute grace).

## Requires `setupXxx()` re-run when

First install (run `setupEmailCycleReportTrigger()` once after pasting) and whenever `CYCLE_REPORT_HOUR_` / `CYCLE_REPORT_MINUTE_` change.

## Significant functions - `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-393 | `cycleReportWindowGs_(now)` | the time | `{start, end}` - 16:30 IST of the previous day to now | none (pure) | `istDayKeyGs_`, `pad2Gs_` (`GS-002`) | FN-396 | specific |
| FN-394 | `cycleReportInWindowGs_` / `cycleRateGs_` | a value and the window / two counts | a window test; "n of d (p%)" | none (pure) | — | FN-395, FN-396 | specific (the row reader and the job labels now live in `GS-015`, FN-398) |
| FN-395 | `cycleReportDataGs_(input)` / `cycleReportRenderGs_(data, now)` | ledger / exclusion / incident rows + config problems | the counts and lists; `{subject, html, plainBody}` | none (pure) | `renderOvernightReportEmailHTML_`, `plainTextReportGs_` (`GS-004`) | FN-396 | specific - RULE-049 |
| FN-396 | `buildEmailCycleReportGs_(ss, now)` / `sendEmailCycleReport_(opts)` | the workbook, the time | the built report; sends it | reads the three evidence tabs; one email; records the sent day in a Script Property | `sendGuardedEmailGs_`, `opsAlertEmailGs_`, `emailConfigProblemsGs_` (`GS-004`) | FN-397 | specific - RULE-050 |
| FN-397 | `sendEmailCycleReport()` / `sendEmailCycleReportNow()` / `setupEmailCycleReportTrigger()` / `showEmailCycleReportNow()` | - | - | the lock + run record; a crash alerts ops at once and re-throws; trigger install; a read-only preview in the log | `withEmailJobLockGs_`, `notifyOpsAlertGs_` (`GS-004`) | the trigger / Apps Script editor | specific |

## Business rules implemented - `RULE-XXX` sub-table

| ID | Rule | Where | Duplicated elsewhere? |
|---|---|---|---|
| RULE-049 | "All clear" needs at least one planned email, none left unfinished/failed/unconfirmed/blocked, and no incident above LOW in the cycle; an empty cycle is "no emails recorded", never all clear. The execution rate is accepted / (planned minus skipped), shown with numerator and denominator. The report lists what it cannot see instead of implying it | FN-395 | `docs/_planning/EMAIL_OPS_SYSTEM_AUDIT.md` sections 0 and 6 |
| RULE-050 | One report per IST day (a re-fire is skipped; the sent day is recorded only after a real send; TEST MODE neither honours nor consumes the guard); it goes to the ops address only, with no Cc | FN-396 | - |

## Config constants - `CFG-XXX` sub-table

| ID | Constant | Value | Meaning | Changing it affects |
|---|---|---|---|---|
| CFG-110 | `CYCLE_REPORT_HOUR_`, `CYCLE_REPORT_MINUTE_` | `16`, `30` | the report time (IST); also the cycle boundary | the trigger (re-run `setupEmailCycleReportTrigger`), the watchdog deadline, the window |
| CFG-111 | `CYCLE_REPORT_SENT_PROPERTY_`, `CYCLE_REPORT_MAX_ROWS_` | `EMAIL_CYCLE_REPORT_SENT_DAY`, `30` | the once-a-day record; the per-table row cap | duplicate protection; report length |

## Exceptions - `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-124 | the report cannot be built or sent | the wrapper alerts ops at once and re-throws; the run record says failed; the watchdog also flags a day it did not run | an ops alert; Executions shows Failed |
| EXC-125 | an evidence tab is missing or empty | its section is simply empty; if all three are, the report says "no emails recorded in this cycle" | the report still arrives |

## Data lineage

`SHEET-019` Email_Ledger, `SHEET-020` Email_Ledger_Exclusions, `SHEET-021` Incident_Log (read only) -> FN-395 -> one email to the ops address.

## Sheets touched

| `SHEET-XXX` | Read / Write | Which `FN-XXX` | Notes |
|---|---|---|---|
| `SHEET-019` | Read | FN-396 | the cycle's bucket emails |
| `SHEET-020` | Read | FN-396 | what was left out |
| `SHEET-021` | Read | FN-396 | incidents and held alerts |

## Failure / error behaviour

A failure alerts ops immediately (`{ immediate: true }`) and re-throws. The report never changes any evidence tab.

## Cross-runtime duplication

None - backend only.

## Not live until pasted

Paste `CycleReport.gs` (new) and `Tests_CycleReport.gs` (new) with `EmailInfra.gs`, `Tests_EmailInfra.gs`, `Tests_RunAll.gs`; then run
`setupEmailCycleReportTrigger()` once and `showEmailCycleReportNow()` (read-only) to preview. Registrations: `Tests_RunAll.gs` `suites`,
`test/run-gs-tests.js` lists, the live editor.

## UI relationships

N/A - backend.

## Architecture relationship

Apps Script backend; a time-driven job (16:30 IST) sharing the email jobs' lock, run record and watchdog.

## Related documentation

`docs/_planning/EMAIL_OPS_SYSTEM_AUDIT.md`; `HANDOVER.md` section 4.3.5; `OPS_CHECKLIST.md` (Automatic email).

## Relationships

- **Depends On:** `GS-002` (`Core.gs`), `GS-004` (`EmailInfra.gs`), `GS-015` (`EmailLedger.gs`), `SHEET-019`, `SHEET-020`, `SHEET-021`
- **Used By:** `GS-004` (the watchdog schedule reads `CYCLE_REPORT_HOUR_` / `CYCLE_REPORT_MINUTE_`)
- **Related:** `GS-001`, `GS-010` (the jobs whose emails it reports)

## Source of truth

`CycleReport.gs` at `HEAD`.

## Validation

- **Method:** `Tests_CycleReport.gs` (window arithmetic, the pure counts and rendering, end-to-end cycles - clean, with a refused send, empty, test mode,
  the trigger entry points, trigger setup, the watchdog deadline); deliberate regressions (MD1..MD22) each caught; clock/zone sweeps.
- **Evidence:** `.github/workflows/test.yml`; the first live 16:30 report.
- **Status:** Validated 2026-10-09 (locally); live behaviour proven by the first report.

## Version / change reference

**2026-10-09** (`d79aae5`): file created - Email Ops EO-8. `EmailInfra.gs` `emailJobScheduleGs_` lists the job (with a `minute`) and
`emailJobProblemsGs_` computes its deadline from hour:minute. **Not live until pasted.**

**2026-10-09** (`(pending commit)`, Email Ops EO-5): the report shows a "Bounces and replies" section from the sweep's columns (`GS-017`), lists a bounced email under "Needs attention" (it counts as accepted by Gmail but is not all clear), and lists replies; the row reader and job labels moved to `GS-015` (FN-398). **Not live until pasted.**

## Revalidation trigger

Any commit touching `CycleReport.gs` or `Tests_CycleReport.gs`; the evidence tabs' columns (`GS-015`); `emailJobScheduleGs_`.

## Handover relationship

`HANDOVER.md` section 4.3.5 updated in the same commit.

## Lifecycle / retention

N/A - sends an email; keeps one Script Property.

## Next action

After the first live report, compare it with the three tabs once; later parts add bounces/replies (EO-5) and the Leads freshness line (EO-10).

## Closure evidence

Record created with the feature; `docs/INDEX.md` `GS-016`.
