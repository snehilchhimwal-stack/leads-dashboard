# GS-015 — EmailLedger.gs

| | |
|---|---|
| **Type** | `GS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `EmailLedger.gs` |
| **Owner** | Snehil |
| **Component Status** | Active (wired into the 17:00, 10:00 and 13:00 jobs and both CH-level reports) |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-10-09 against commit `0213c9f` - the shared recovery driver (FN-409; see `## Version / change reference`) |

## Purpose / reason to exist

The per-email evidence trail of the Email Operations System (`docs/_planning/EMAIL_OPS_SYSTEM_AUDIT.md`, part EO-1a). Every other
log in this project (`AllIssues_Log`, `Overnight_Log`) is written only AFTER a send succeeded, so the system knew what went out and
could never know what *should* have gone out and did not, what was blocked, or why. The ledger records each bucket email from the
moment it is planned to its final status, with the Gmail message and thread ids as evidence, and records every lead or region that
was left out with the reason. The later parts (13:00 audit, 17:00 reconciliation, bounce/reply sweep, 16:30 cycle report) read it.

## Responsibilities

- Record every ops alert as an incident and hold the alerts of an email job until the job has ended (EO-2); release held alerts of a killed job (`incidentRecordGs_`, `releaseHeldIncidentsGs_`).
- Be the single evidence trail for the 17:00, 10:00 and 13:00 emails and the two CH-level reports (jobs `allIssues17`, `morning10`, `followup13`, `chLevel10`, `chLevel17`).
- Create and open the two sheets (`SHEET-019` `Email_Ledger`, `SHEET-020` `Email_Ledger_Exclusions`) and refuse to write into one whose
  columns it does not recognise (`emailLedgerOpenGs_`, `emailLedgerEnsureSheetGs_`).
- Record a region's buckets as PLANNED in one write, then ATTEMPTING / ACCEPTED / FAILED / UNCONFIRMED / BLOCKED per bucket
  (`emailLedgerPlanGs_`, `emailLedgerAttemptGs_`, `emailLedgerResultGs_`).
- Record leads and regions that did not go out, with the reason (`emailLedgerExcludeGs_`).
- Per-lead isolation (plan decision D3): decide which individual leads cannot be shown reliably (`emailLedgerSplitLeadsGs_`) so the
  rest of their bucket still goes.
- Archive to Drive and remove rows older than 90 days (`pruneEmailLedgerGs_`).
- Stay out of the way: every function is fail-open and a null/disabled handle makes each call a no-op.

## Trigger schedule

None of its own. It runs inside `sendAllIssuesEmails` (`GS-001`, 17:00 IST), `sendOvernightMorningEmails` (10:00) and `sendOvernightFollowupEmails` (13:00) (`GS-010`).

## Requires `setupXxx()` re-run when

Never - no trigger. Paste the file (with `Tests_EmailLedger.gs`, `AllIssuesEmailer.gs`, `EmailInfra.gs`, `Tests_Mocks.gs`,
`Tests_RunAll.gs`) and the two sheets create themselves on the next 17:00 run. `showEmailLedgerTodayNow()` is a read-only check.

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-378 | `emailLedgerOpenGs_(ss)` / `emailLedgerEnsureSheetGs_` `#L232/#L211` | the spreadsheet | a handle (`null` in test mode; DISABLED when the sheets cannot be opened) | creates the two sheets with their header row; indexes existing email ids | `istDayKeyGs_` (`GS-002`) | FN-387 | specific |
| FN-379 | `emailLedgerPlanGs_(h, plans)` / `emailLedgerAppendBlockGs_` `#L278/#L257` | the buckets of one region | — | ONE write of PLANNED rows; a re-run keeps the existing row; a retry never writes the batch twice | `writeUnlessTestModeGs_`, `jsonForCellGs_` (`GS-004`) | FN-387 | specific |
| FN-380 | `emailLedgerAttemptGs_` / `emailLedgerResultGs_` / `emailLedgerPatchGs_` `#L316/#L327/#L302` | an email id; a result `{status, reason, messageId, threadId, leadIds}` | — | rewrites the nine outcome columns of one row | `writeUnlessTestModeGs_` (`GS-004`) | FN-387 | specific |
| FN-381 | `emailLedgerExcludeGs_(h, items)` `#L341` | leads/regions left out, each with a reason | — | one write to `Email_Ledger_Exclusions` | `writeUnlessTestModeGs_` (`GS-004`) | FN-387 | specific |
| FN-382 | `emailLedgerSplitLeadsGs_(leads)` / `emailLedgerLeadDefectGs_` `#L170/#L157` | flagged leads | `{valid, defective:[{lead, reason, covered}]}` | none (pure) | — | FN-387 | specific - RULE-045 |
| FN-383 | `emailLedgerIdGs_`, `emailLedgerDayKeyOfGs_`, `emailLedgerSentIdsGs_`, `emailLedgerStatusForErrorGs_` `#L146/#L138/#L184/#L192` | job/day/region/role/bucket; a cell; a sent message; an error | the deterministic email id; a day key; `{messageId, threadId}`; a status | none (pure) | `isAmbiguousSendErrorGs_` (`GS-004`) | FN-387 | specific |
| FN-384 | `pruneEmailLedgerGs_(h, now)` `#L397` | the handle, now | — | archives leading rows older than 90 days to Drive, then deletes them | `archiveRowsToDriveCsv_` (`GS-002`) | FN-387 | specific - RULE-046 |
| FN-385 | `emailLedgerGuardGs_` / `emailLedgerFinishGs_` `#L200/#L422` | the handle | — | counts a ledger failure; one ops note at the end of the job | `notifyOpsAlertGs_` (`GS-004`) | FN-378..FN-384, FN-387 | specific - RULE-044 |
| FN-386 | `showEmailLedgerTodayNow()` `#L69` | — | — | read-only: logs today's counts per status | — | Apps Script editor (manual) | specific |
| FN-388 | `emailLedgerTrackSendGs_(h, meta, sendFn)` / `emailLedgerSkipGs_` / `emailLedgerFailIfOpenGs_` / `emailLedgerStatusOfGs_` | a plan-shaped `meta`, a send function | the send's result (the error is re-thrown unchanged) | plan + attempt + outcome in the ledger; SKIPPED rows; closes a still-open row as FAILED but never overwrites a final one | FN-379, FN-380 | the CH-level reports (`GS-001`, `GS-010`), the 10:00/13:00 wiring | specific - RULE-043 |
| FN-389 | the 10:00 / 13:00 ledger calls in `sendOvernightMorningEmails_`, `sendCombinedMorningEmail_`, `sendOvernightFollowupEmails_`, `sendCombinedFollowupEmail_` (`GS-010`) | — | — | the same wiring for the two other jobs; a bucket exception closes its row | FN-378..FN-385, FN-388 | the 10:00 and 13:00 triggers | specific |
| FN-390 | `incidentRecordGs_(info)` / `incidentNotifiedGs_(ids, status, continuity)` / `incidentSeverityGs_(subject)` / `emailIncidentSheetGs_` | an alert (subject, text, job, held) / incident ids | the incident id; none | appends an `Incident_Log` row (HELD when the alert is held); marks incidents SENT / SEND-FAILED / RELEASED with the time; never throws | FN-378 | `notifyOpsAlertGs_` (`GS-004`) | specific - RULE-047 |
| FN-391 | `emailLedgerConfirmationLineGs_()` / `emailLedgerSetActiveGs_` / `emailLedgerResetActiveGs_` | none | the line a held alert opens with: how many of THIS run's emails Gmail accepted / failed / skipped / left unfinished, or "confirmation unavailable" | none | FN-378 | `emailAlertHoldFlushGs_` (`GS-004`) | specific - RULE-047 |
| FN-392 | `releaseHeldIncidentsGs_(now)` | the time | how many held incidents were released | sends ONE "released" message and marks the rows RELEASED | FN-390 | `checkEmailJobsCompletedGs_` (`GS-004`, the hourly watchdog) | specific - RULE-048 |
| FN-398 | `emailLedgerReadRowsGs_(sheet, headers, startDayKey)` + `EMAIL_LEDGER_JOB_LABELS_` | an evidence tab, its headers, a day key | the rows from the first row of that day as objects keyed by header, each with its `rowNo`; human names of the jobs | reads the tab | `emailLedgerDayKeyOfGs_` | `GS-016`, `GS-017` | specific - moved here from `CycleReport.gs` (EO-5) |
| FN-387 | `sendAllIssuesEmails_` / `sendOneAllIssuesEmail_` ledger calls (`GS-001`) | — | — | the wiring: open, split, plan, attempt, result, exclude, prune, finish | FN-378..FN-385 | the 17:00 trigger | specific |
| FN-409 | `emailLedgerRecoveryTargetsGs_(ss, now, job)` / `emailLateCutoffPassedGs_(now, hour, minute)` / `emailRecoverBucketsGs_(spec, opts)` | the workbook, the time, a job id / a recovery spec `{job, label, cutoffHour, cutoffMinute, forceName, run}` | today's recoverable emails `[{emailId, region, bucket, status}]` / whether the cutoff has passed / `{targets, cutoff, ran}` | reads `Email_Ledger`; `run(ids, regions)` re-sends exactly the targets | `emailLedgerReadRowsGs_`, `istDayKeyGs_` | `GS-001` FN-406/407, `GS-010` FN-410 | reusable - RULE-058 |

## Business rules implemented — `RULE-XXX` sub-table

| ID | Rule | Where | Duplicated elsewhere? |
|---|---|---|---|
| RULE-043 | The statuses never imply one another: SKIPPED means the email was planned and deliberately not sent because there was nothing to say (a final outcome, not a failure); ACCEPTED means Gmail's `send()` returned a message - not delivered, not opened (Apps Script cannot see either); UNCONFIRMED (a timeout-class error) is NOT FAILED because the message may have gone; a row left PLANNED/ATTEMPTING means the run died before/during the send | FN-380, FN-383 | `docs/_planning/EMAIL_OPS_SYSTEM_AUDIT.md` section 6 |
| RULE-044 | The ledger is evidence, not a gate: a ledger error is counted, logged and reported once at the end; the email always proceeds. A sheet with unrecognised columns disables the ledger rather than being overwritten. TEST MODE never writes | FN-378, FN-385 | the same fail-open stance as `withEmailJobLockGs_` (`GS-004`) |
| RULE-045 | Per-lead isolation (decision D3): a lead with no id, an id with control characters or over 100 characters, or no reason for contact is left out and recorded; a second copy of a lead id is left out but NOT reported as unsent (its first copy was sent); anything subtler is caught by the send gate, which now names the leads it objected to, and only those are dropped and the rest resent once | FN-382, FN-387 | — |
| RULE-046 | Retention is 90 days; only LEADING rows older than the window are removed, and only after they were archived to Drive (a failed archive deletes nothing) | FN-384 | the other pruned logs (`archiveRowsToDriveCsv_`) |
| RULE-047 | An alert raised while one of the three email jobs runs is recorded in `Incident_Log` as HELD at once and emailed only after the job ended, as ONE message that opens with the count of emails Gmail accepted (decision D2). A whole-job failure (crash) is sent immediately - nothing is left to confirm. A single held alert keeps its own subject; several are consolidated. Outside a job an alert is sent at once | FN-390, FN-391, `notifyOpsAlertGs_` / `emailAlertHoldFlushGs_` (`GS-004`) | `docs/_planning/EMAIL_OPS_SYSTEM_AUDIT.md` section 0 |
| RULE-048 | A HELD incident older than 45 minutes belongs to a job that was killed before it could send it: the hourly watchdog sends ONE release message listing them and marks them RELEASED; a fresh HELD incident is left alone (its job may still be running) | FN-392 | — |
| RULE-058 | A failed email can be recovered the same IST day: FAILED and BLOCKED (the send was refused) and PLANNED (the run died before reaching it - nothing was attempted, so nothing can be duplicated; the recovery runs under the job lock) are targets; ATTEMPTING and UNCONFIRMED (the send may have gone out) and ACCEPTED never are. Everything is re-checked from the CURRENT data; a target the run no longer produces is closed as SKIPPED with the reason; after the job's cutoff (17:00 emails 18:30, 10:00 emails 12:45, 13:00 replies 16:00) nothing is sent late unless forced | FN-409 | `GS-001` RULE-056 |
| RULE-059 | The 10:00 recovery bypasses the region "already sent today" guard for the targeted bucket only, re-sends no sibling, no CH-level report, no exclusion row and no unroutable-RM report of the original run; the 13:00 recovery retries a reply only while its Overnight_Log `followup_sent_at` is still blank and the ledger says it failed (a stamped or unconfirmed one is never sent twice), and re-evaluates only the targeted rows - a SKIPPED sibling is not sent late | `GS-010` FN-410 | - |

## Config constants — `CFG-XXX` sub-table

| ID | Constant | Value | Meaning | Changing it affects |
|---|---|---|---|---|
| CFG-105 | `EMAIL_LEDGER_SHEET_`, `EMAIL_LEDGER_EXCLUSIONS_SHEET_` | `Email_Ledger`, `Email_Ledger_Exclusions` | the two tab names | where the evidence is written; existing tabs are not renamed for you |
| CFG-106 | `EMAIL_LEDGER_HEADERS_`, `EMAIL_LEDGER_EXCLUSION_HEADERS_` | 23 and 9 columns | the column order; the outcome block `attempted_at..lead_ids_json` must stay contiguous | any reorder breaks the one-write row update and the header check |
| CFG-107 | `EMAIL_LEDGER_RETENTION_DAYS_` | `90` | rows older than this are archived and removed | how long the evidence stays in the workbook |
| CFG-108 | `EMAIL_LEDGER_JOB_ALL_ISSUES_`, `_MORNING_`, `_FOLLOWUP_`, `_CH_OVERNIGHT_`, `_CH_ISSUES_` | `allIssues17`, `morning10`, `followup13`, `chLevel10`, `chLevel17` | the job id in every email id (the 10:00/13:00 ids also carry the recipient) | email ids (a change makes today's re-run plan new rows) |
| CFG-109 | `EMAIL_INCIDENT_LOG_SHEET_`, `EMAIL_INCIDENT_HEADERS_`, `EMAIL_INCIDENT_RELEASE_AFTER_MINUTES_` | `Incident_Log`, 15 columns, `45` | the incident tab, its column order, and how old a HELD incident must be before the watchdog releases it | where incidents are recorded; the release window must stay above the 35-minute run cap (`EMAIL_JOB_MAX_RUN_MINUTES_`) |
| CFG-112 | `EMAIL_LEDGER_JOB_LABELS_` | `allIssues17`, `chLevel17`, `morning10`, `chLevel10`, `followup13` -> human names | how the jobs are named in the 16:30 report and the bounce alert | wording only |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-119 | a ledger sheet has unrecognised columns, or cannot be opened | the handle is DISABLED; every ledger call is a no-op | one ops note at the end of the job; the emails are unaffected |
| EXC-120 | a ledger write throws mid-run | counted on the handle, logged; the send path never sees it | the same single ops note |
| EXC-121 | the run dies mid-send | the row stays ATTEMPTING (or PLANNED if it never started) | the later audit (EO-3/EO-4) reads that as "outcome unknown" |
| EXC-122 | the job is killed while it holds alerts | the incidents stay HELD; the hourly watchdog releases them after 45 minutes | one "held alert(s) released" message |
| EXC-123 | `Incident_Log` has unrecognised columns, or a write to it fails | the alert is sent anyway (held or not); nothing is written into the unrecognised sheet | a log line only; the alert text is complete |

## Data lineage

`sendAllIssuesEmails_` (`GS-001`) -> plan (per region, one write) -> attempt -> `sendGuardedEmailGs_` (`GS-004`) -> result with the
Gmail ids -> `Email_Ledger`; skipped leads/regions -> `Email_Ledger_Exclusions`. Nothing reads them yet except `showEmailLedgerTodayNow()`.

## Sheets touched

| `SHEET-XXX` | Read / Write | Which `FN-XXX` | Notes |
|---|---|---|---|
| `SHEET-019` `Email_Ledger` | Read + write | FN-378..FN-380, FN-384 | one row per bucket email |
| `SHEET-020` `Email_Ledger_Exclusions` | Read + write | FN-378, FN-381, FN-384 | one row per lead/region left out |
| `SHEET-021` `Incident_Log` | Read + write | FN-390, FN-392 | one row per ops alert |

## Failure / error behaviour

Fail-open (RULE-044). Nothing in this file can stop, delay beyond a few sheet writes, or change the content of an email.

## Cross-runtime duplication

None - backend only.

## Not live until pasted

Paste `EmailLedger.gs` as a NEW file, then `AllIssuesEmailer.gs`, `EmailInfra.gs`, `Tests_EmailLedger.gs` (new), `Tests_Mocks.gs`,
`Tests_RunAll.gs`. Registrations: `Tests_RunAll.gs` `suites`, `test/run-gs-tests.js` lists, the live editor.

## UI relationships

N/A - backend.

## Architecture relationship

Apps Script backend; a library called from the 17:00 emailer. Part of the Email Operations System (`goal g-tf-d895943847`).

## Related documentation

`docs/_planning/EMAIL_OPS_SYSTEM_AUDIT.md`; `docs/_planning/EMAIL_AUDIT.md`; `HANDOVER.md` (the Email Operations section).

## Relationships

- **Depends On:** `GS-002` (`Core.gs`), `GS-004` (`EmailInfra.gs`), `SHEET-019`, `SHEET-020`, `SHEET-021`
- **Used By:** `GS-001` (`AllIssuesEmailer.gs`), `GS-004` (`EmailInfra.gs` - the alert hold and the watchdog release call it), `GS-010` (`OvernightEmailer.gs`), `GS-016` (`CycleReport.gs` - reads the three tabs), `GS-017` (`EmailSweep.gs` - reads the ledger rows and fills the sweep columns), `SHEET-019`, `SHEET-020`
- **Related:** `SHEET-013` (`AllIssues_Log`) - the success-only log this complements

## Source of truth

`EmailLedger.gs` at `HEAD`.

## Validation

- **Method:** `Tests_EmailLedger.gs` (in-memory sheets, Gmail, Drive) in CI and the headless runner, including end-to-end runs of the
  real 17:00, 10:00 and 13:00 jobs and the CH-level reports (a whole cycle, a lead resolved before 10:00 and before 13:00, the threaded-reply fallback, an ambiguous reply) and of the 17:00 job (normal, re-run, test mode, Gmail refusal, timeout, one bad lead, every lead refused, duplicate id, unroutable RM,
  broken ledger sheet); 24 deliberate regressions (ML1..ML24, scratchpad `mutate_ledger.py`), 23 caught and 1 equivalent mutant;
  clock/zone sweeps (`--at`, `--tz`).
- **Evidence:** `.github/workflows/test.yml`; the first live 17:00 run after the paste (`showEmailLedgerTodayNow()`).
- **Status:** Validated 2026-10-09 (locally); live behaviour proven by the first 17:00 run.

## Version / change reference

**2026-10-09** (`f46ebc7`, EO-2): `Incident_Log` (`SHEET-021`) and the held-alert mechanism - FN-390..FN-392, RULE-047, RULE-048, CFG-109, EXC-122, EXC-123. `notifyOpsAlertGs_` (`GS-004`) now records every alert and, inside one of the three email jobs, holds it until the job has ended.

**2026-10-09** (`eaffb47`, EO-1b): wired into the 10:00 and 13:00 jobs and both CH-level reports; new `SKIPPED` status; ids of the 10:00/13:00 emails carry the recipient; plans can be written directly in a final state (`initialStatus`); tracked-send helpers (FN-388).

**2026-10-09** (`b1dbc3a`): file created - Email Ops EO-1a. `EmailInfra.gs` `prepareOutgoingEmailGs_` also returns
`missingLeadIds` and the gate's refusal carries it. **Not live until pasted.**

**2026-10-09** (`0213c9f`, Email Ops EO-9b): the 17:00 recovery's reader, cutoff test and driver moved here as the shared FN-409 so the 10:00 and 13:00 recoveries (`GS-010` FN-410) reuse them; PLANNED rows (never attempted) became recovery targets (RULE-058). **Not live until pasted.**

## Revalidation trigger

Any commit touching `EmailLedger.gs` or `Tests_EmailLedger.gs`; the `AllIssues_Log`/ledger column lists; the send gate
(`prepareOutgoingEmailGs_`, `sendGuardedEmailGs_`); the 17:00 flow (`sendAllIssuesEmails_`, `sendOneAllIssuesEmail_`).

## Handover relationship

`HANDOVER.md` updated in the same commit (the Email Operations System section).

## Lifecycle / retention

90 days in the workbook, then archived to Drive (`Email_Ledger`, `Email_Ledger_Exclusions` folders under the archive root).

## Next action

EO-1b wires the 10:00/13:00 jobs; EO-2 adds the incident log and held alerts; EO-3/EO-4 read the ledger.

## Closure evidence

Record created with the feature; `docs/INDEX.md` `GS-015`.
