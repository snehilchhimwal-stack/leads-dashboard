# GS-016 - CycleReport.gs

| | |
|---|---|
| **Type** | `GS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `CycleReport.gs` |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-10-10 against commit `PENDING_SHA` - plain-text column constant for the tab pre-creation helper (no behaviour change) |

## Purpose / reason to exist

The one report Snehil asked to read every day (plan decision D1, `docs/_planning/EMAIL_OPS_SYSTEM_AUDIT.md`): at 16:30 IST, a single email to the ops
address covering the whole cycle that started at the previous day's 17:00 - every bucket email of the 17:00, 10:00 and 13:00 jobs and the CH-level
reports by final status, what was left out and why, the incidents raised, what needs attention, and whether the coming 17:00 send is ready. It is
sent when everything is fine AND when it is not; errors are emailed separately and earlier, after the rest of their run is confirmed sent
(`GS-015` RULE-047). It is built only from the evidence tabs (`SHEET-019`, `SHEET-020`, `SHEET-021`) - nothing is guessed, and it states what it
cannot see (delivery and opens cannot be seen from Apps Script; bounces and replies come from the daily sweep, `GS-017`; the age of the Leads tab is judged from the newest lead assignment time, RULE-054).

## Responsibilities

- Compute the cycle window: 16:30 of the previous IST day up to now (`cycleReportWindowGs_`).
- Turn ledger / exclusion / incident rows into counts and lists (`cycleReportDataGs_`, pure) and then into the email (`cycleReportRenderGs_`, pure).
- Send ONE email to `opsAlertEmailGs_()` only, once per IST day (`sendEmailCycleReport_`); `sendEmailCycleReportNow()` sends again on purpose.
- Keep a run record so the hourly watchdog alerts when it did not run by 17:00 (`emailJobScheduleGs_`, `GS-004`) - deliberately WITHOUT the script-wide job lock (a `nearMinute` trigger fires up to 15 minutes either side of its minute, and holding the lock near 17:00 could make the primary 17:00 send skip).

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
| FN-397 | `sendEmailCycleReport()` / `sendEmailCycleReportNow()` / `setupEmailCycleReportTrigger()` / `showEmailCycleReportNow()` | - | - | the run record (no job lock); a crash alerts ops at once and re-throws; trigger install; a read-only preview in the log | `withEmailJobLockGs_`, `notifyOpsAlertGs_` (`GS-004`) | the trigger / Apps Script editor | specific |
| FN-404 | `cycleFreshnessLevelGs_(ageHours)` / `cycleLeadsFreshnessGs_(ss, now)` | the age in hours / the workbook, the time | GREEN / AMBER / RED; `{level, ageHours, newest, text}` (UNKNOWN when the Leads tab cannot be read or has no assignment times) - thin wrappers since 2026-10-09; the rules are `leadsFreshnessLevelGs_` / `leadsFreshnessFromRowsGs_` (`GS-004` FN-408) | reads the Leads tab (`readLeadsTab_`, `GS-004`) | `leadsFreshnessLevelGs_`, `leadsFreshnessFromRowsGs_` (`GS-004` FN-408) | FN-396 | specific - RULE-054 |
| FN-405 | `cycleReportRecordDailyGs_(ss, data, now)` | the workbook, the report data, the time | none | upserts today's row in `Daily_Report`; fail-open; TEST MODE writes nothing | `emailLedgerEnsureSheetGs_`, `emailLedgerAppendBlockGs_` (`GS-015`) | FN-396 | specific - RULE-055 |

## Business rules implemented - `RULE-XXX` sub-table

| ID | Rule | Where | Duplicated elsewhere? |
|---|---|---|---|
| RULE-049 | "All clear" needs at least one planned email, none left unfinished/failed/unconfirmed/blocked, and no incident above LOW in the cycle; an empty cycle is "no emails recorded", never all clear. The execution rate is accepted / (planned minus skipped), shown with numerator and denominator. The report lists what it cannot see instead of implying it | FN-395 | `docs/_planning/EMAIL_OPS_SYSTEM_AUDIT.md` sections 0 and 6 |
| RULE-050 | One report per IST day (a re-fire is skipped; the sent day is recorded only after a real send; TEST MODE neither honours nor consumes the guard); it goes to the ops address only, with no Cc | FN-396 | - |
| RULE-054 | The Leads tab is judged from the newest lead assignment time (decision D4: the tab refreshes about every other hour and has no last-imported cell): up to 3 h GREEN, over 3 h AMBER, over 5 h RED. AMBER/RED are attention items (so not all clear) and say the 17:00 emails would describe stale data; a tab that cannot be read or has no times is UNKNOWN and is shown but never raised; times in the future are ignored. It is a warning only - nothing is held or blocked, and no email changes. (Not to be confused with a *stale lead* - `GS-021` RULE-066) | FN-404 | `docs/_planning/EMAIL_OPS_SYSTEM_AUDIT.md` D4 |
| RULE-055 | One `Daily_Report` row per IST day: written after the report email was sent, updated (not duplicated) by a re-send the same day; the email never depends on it | FN-405 | - |

## Config constants - `CFG-XXX` sub-table

| ID | Constant | Value | Meaning | Changing it affects |
|---|---|---|---|---|
| CFG-110 | `CYCLE_REPORT_HOUR_`, `CYCLE_REPORT_MINUTE_` | `16`, `30` | the report time (IST); also the cycle boundary | the trigger (re-run `setupEmailCycleReportTrigger`), the watchdog deadline, the window |
| CFG-111 | `CYCLE_REPORT_SENT_PROPERTY_`, `CYCLE_REPORT_MAX_ROWS_` | `EMAIL_CYCLE_REPORT_SENT_DAY`, `30` | the once-a-day record; the per-table row cap | duplicate protection; report length |
| CFG-115 | `CYCLE_REPORT_DAILY_SHEET_`, `CYCLE_REPORT_DAILY_HEADERS_` | `Daily_Report`, 21 columns | the daily-row tab and its column order | where the daily numbers go; never reorder by hand |

## Exceptions - `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-124 | the report cannot be built or sent | the wrapper alerts ops at once and re-throws; the run record says failed; the watchdog also flags a day it did not run | an ops alert; Executions shows Failed |
| EXC-125 | an evidence tab is missing or empty | its section is simply empty; if all three are, the report says "no emails recorded in this cycle" | the report still arrives |
| EXC-129 | the `Daily_Report` row cannot be written (unrecognised columns, a Sheets error) | logged only; the report email is already sent | none |

## Data lineage

`SHEET-019` Email_Ledger, `SHEET-020` Email_Ledger_Exclusions, `SHEET-021` Incident_Log (read only) -> FN-395 -> one email to the ops address.

## Sheets touched

| `SHEET-XXX` | Read / Write | Which `FN-XXX` | Notes |
|---|---|---|---|
| `SHEET-019` | Read | FN-396 | the cycle's bucket emails |
| `SHEET-020` | Read | FN-396 | what was left out |
| `SHEET-021` | Read | FN-396 | incidents and held alerts |
| `SHEET-022` `Daily_Report` | Write | FN-405 | one row per day |

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

Apps Script backend; a time-driven job (16:30 IST) with a run record watched by the hourly watchdog, and no job lock.

## Related documentation

`docs/_planning/EMAIL_OPS_SYSTEM_AUDIT.md`; `HANDOVER.md` section 4.3.5; `OPS_CHECKLIST.md` (Automatic email).

## Relationships

- **Depends On:** `GS-002` (`Core.gs`), `GS-004` (`EmailInfra.gs`), `GS-015` (`EmailLedger.gs`), `SHEET-019`, `SHEET-020`, `SHEET-021`, `SHEET-022`
- **Used By:** `GS-004` (the watchdog schedule reads `CYCLE_REPORT_HOUR_` / `CYCLE_REPORT_MINUTE_`), `SHEET-022`
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

**2026-10-09** (`c18d89f`, Email Ops EO-5): the report shows a "Bounces and replies" section from the sweep's columns (`GS-017`), lists a bounced email under "Needs attention" (it counts as accepted by Gmail but is not all clear), and lists replies; the row reader and job labels moved to `GS-015` (FN-398). **Not live until pasted.**

**2026-10-09** (`bc39815`, Email Ops EO-10 / EO-8b): the report also judges the Leads tab's freshness (FN-404, RULE-054, thresholds from decision D4) and stores a `Daily_Report` row per day (FN-405, RULE-055). A stale tab is a warning in the report; nothing is held or blocked. **Not live until pasted.**

**2026-10-09** (`93a120a`, Email Ops review): the report entry points use `runEmailJobTrackedGs_` (run record) instead of `withEmailJobLockGs_` - deliberately WITHOUT the script-wide job lock (a `nearMinute` trigger fires up to 15 minutes either side of its minute, and holding the lock near 17:00 could make the primary 17:00 send skip). **Not live until pasted.**

**2026-10-09** (`ea5fdc5`, Email Ops, decision D6): the freshness rules and thresholds (CFG-114) moved to `EmailInfra.gs` (`GS-004` FN-408); FN-404 is now two thin wrappers over them, behaviour unchanged. The emailers use the same rules to add RULE-057's bottom notice. **Not live until pasted.**

**2026-10-09** (`f475d10`, Email Ops EO-6): the report gathers the watchdog's job problems and the audits' last results (`cycleReportJobProblemsGs_`, `cycleReportAuditsGs_`), builds the daily checklist (`GS-019` FN-415, fail-open) into `data.checklist`, shows it as a "Daily checklist (A-K)" section before "Ready for 17:00?" and stores the rows in `Daily_Checklist` (`SHEET-023`) after the send. With `DailyChecklist.gs` absent the report is exactly as before. **Not live until pasted.**

**2026-10-09** (`d9e2b97`, Email Ops EO-7): the report reads the cycle day's 17:00 buckets from `AllIssues_Log`, builds the follow-up tracker (`GS-020` FN-420, fail-open) into `data.followups`, shows its sections before the daily checklist and stores the rows in `Followup_Tracker` (`SHEET-024`) after the send. With `FollowupTracker.gs` absent the report is exactly as before. **Not live until pasted.**

**2026-10-10** (`59db11b`, decision D8): RULE-057 (a RED tab adds a bottom notice to every email) was **withdrawn** and the thresholds are back to 3 h / 5 h - see `GS-004` and `GS-021`. **Not live until pasted.**

**2026-10-10** (`ec19415`, Email Ops EO-13, decision D9): the report counts bounced emails that were re-sent to the next person as "re-routed" (status `BOUNCED - RE-ROUTED`; a Cc-only bounce counts too), gains a "Re-routed addresses in force" section from `Email_Reroutes` (`SHEET-025`), and says "the 15:30 sweep" (was 15:45). **Not live until pasted.**

**2026-10-10** (`PENDING_SHA`): `CYCLE_REPORT_DAILY_TEXT_COLUMNS_` constant (shared with `precreateEmailOpsTabsNow`, `GS-015`); no behaviour change **Not live until pasted.**

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
