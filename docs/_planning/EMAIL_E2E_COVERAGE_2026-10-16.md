# Email lifecycle - E2E coverage, failure matrix and defect report (2026-10-16)

Scope: the automated email lifecycle of the Leads Dashboard Apps Script project. New suite: `Tests_EmailLifecycleMatrix.gs`
(121 assertions at first; 234 after the fixes of section 8). The first pass changed no production `.gs` file; the fixes of
section 8 (same day, uncommitted, **not live until pasted**) changed `EmailLedger.gs`, `EmailSweep.gs`, `AllIssuesEmailer.gs`,
`OvernightEmailer.gs`, `CycleReport.gs` and `DailyChecklist.gs`.

Legend used throughout: **[V]** verified by reading the code and/or by a passing assertion · **[A]** assumed (not proven here) ·
**[U]** untested.

## 1. System discovery

| Entry point (trigger handler) | IST | Body | Lock | Ledger job id |
|---|---|---|---|---|
| `sendAllIssuesEmails` | 17:00 | `sendAllIssuesEmails_` (AllIssuesEmailer.gs) | script lock | `allIssues17` (+ `chLevel17`) |
| `sendOvernightMorningEmails` | 10:00 | Section 1 overnight + Section 2 Checkpoint 1 | script lock | `morning10` (+ `chLevel10`) |
| `sendOvernightFollowupEmails` | 13:00 | threaded reply (Overnight_Log `thread_id`), Checkpoint 2 | script lock | `followup13` |
| `recoverFailed{AllIssues,Morning,Followup}Buckets*Now` | manual | `emailRecoverBucketsGs_` (EmailLedger.gs) | script lock | same as the job |
| `sweepEmailBouncesAndReplies` + 10:30/13:30/17:30 bounce-only | 15:30 | EmailSweep.gs; re-route EmailReroute.gs | none | `reroute` rows |
| `sendEmailCycleReport` | 16:30 | CycleReport.gs (+ DailyChecklist, FollowupTracker) | none | - |
| ops audits 11:15 / 14:00 / 18:00, `emailJobWatchdog` hourly | | OpsAudit.gs, EmailInfra.gs | none | - |

Shared dependencies [V]: `prepareOutgoingEmailGs_` / `sendGuardedEmailGs_` (the send gate: address regex, CR/LF in the subject collapsed, every
counted lead id must be in both bodies), `withSendRetry_` (retries only "operation not allowed" / "not found", 3 attempts),
`isAmbiguousSendErrorGs_` (timeout/5xx class -> UNCONFIRMED), `withRetry_` (Sheets, 4 attempts, transient only), `appendRowOnceGs_`,
`withEmailJobLockGs_` (fails open), `runEmailJobTrackedGs_` (run record in Script Properties), held alerts (`notifyOpsAlertGs_`),
`TEST_MODE_OVERRIDE_EMAIL_` (no ledger, no log writes, all mail redirected).

## 2. Email_Ledger row state machine (as implemented, EmailLedger.gs)

States: `PLANNED`, `ATTEMPTING`, `ACCEPTED`, `FAILED`, `UNCONFIRMED`, `BLOCKED`, `SKIPPED`.

| From | To | Written by | Notes |
|---|---|---|---|
| (none) | PLANNED | `emailLedgerPlanGs_` (one block per region) | [V] |
| (none) | SKIPPED / other final | plan with `initialStatus` | [V] 13:00 nothing to send |
| PLANNED | SKIPPED | plan with `initialStatus` on an existing PLANNED row (EL-2) | [V] |
| PLANNED, FAILED, BLOCKED | ATTEMPTING | `emailLedgerAttemptGs_` (attempts += 1) | [V] |
| ATTEMPTING | ACCEPTED / FAILED / UNCONFIRMED / BLOCKED | `emailLedgerResultGs_` | [V] |
| PLANNED/ATTEMPTING | FAILED | `emailLedgerFailIfOpenGs_` (bucket threw) | [V] |
| FAILED/BLOCKED/PLANNED (targeted) | SKIPPED | recovery, bucket no longer produced | [V] |
| ACCEPTED/UNCONFIRMED | (unchanged) | sweep only fills `bounce_status/reply_status/swept_at` | [V] |

Forbidden / never automatic [V]: ACCEPTED -> anything (`emailLedgerFailIfOpenGs_` guards it); UNCONFIRMED or ATTEMPTING -> re-send
(recovery excludes them - since D2's fix per email id, so a stale FAILED/PLANNED copy of such an id is excluded too; the 17:00 re-run
guard treats them as sent, AI-3; the 10:00 and 13:00 re-run guards do NOT - open defects D5/D6). There is no programmatic guard on *direct* calls of
`emailLedgerAttemptGs_` against an ACCEPTED row [A: callers never do it].

Terminal: ACCEPTED, UNCONFIRMED, SKIPPED (final for automation). Recoverable same day until the late cutoff (17:00 -> 18:30, 10:00 -> 12:45,
13:00 -> 16:00 IST, exclusive at the exact instant): FAILED, BLOCKED, PLANNED. ATTEMPTING = outcome unknown, needs a human.
Recovery is per IST day: at IST midnight yesterday's failures stop being targets (M11).

## 3. Branch and failure matrix

| # | Branch / failure | Expected | Test |
|---|---|---|---|
| B1 | normal send | ACCEPTED + msg/thread ids, log row | Tests_EmailLedger (1),(12) |
| B2 | definite refusal, retries exhausted | FAILED, 3 drafts, 0 delivered | **M2** (first/middle/last); 10:00 **M12b**; 13:00 **M13b** (3 threaded + 3 fallback) |
| B3 | refusal x2 then accepted | ACCEPTED, 1 delivery, ledger attempts 1 | **M2b**; 10:00 **M12c**; 13:00 fallback accepted **M13c** |
| B4 | timeout AFTER delivery | UNCONFIRMED, no retry; recovery + re-run send nothing | **M1** (+ Tests_EmailLedger (5),(37)); 13:00 **M13a**; 10:00 **M12a -> DEFECT D5** (re-run) |
| B5 | gate refuses one lead / all leads | lead dropped / BLOCKED | Tests_EmailLedger (6),(7),(38) |
| B6 | kill mid-send (delivered, unrecorded) | ATTEMPTING; re-run sends only never-planned regions | **M3**; 10:00 **M12d -> D5**; 13:00 **M13d** (recovery sends the PLANNED reply only) **-> D6** (re-run) |
| B7 | kill before attempt | PLANNED; re-run reuses the row | **M3b**; Tests_EmailLedger 17:00 "run died" |
| B8 | accepted, ledger result write fails | ATTEMPTING on sheet, log row, 1 ops note, no duplicate | **M4**; 10:00 **M12e**; 13:00 **M13e** |
| B9 | accepted, AllIssues_Log append fails | ledger ACCEPTED blocks re-run | Tests_AllIssuesEmailer AI-3, Tests_OvernightEmailer OE-03 |
| B10 | plan write lands but reports an error | must not re-send | **M5** (D1 fixed; control: write did not land) |
| B11 | stale duplicate ledger row | must not re-send | **M6** (D2 fixed: ACCEPTED/UNCONFIRMED/ATTEMPTING x stale FAILED/PLANNED, above/below; control: 2 FAILED rows = 1 target) |
| B12 | job overlap (lock busy) | skipped + ops alert | Tests_AllIssuesEmailer P4, Tests_OvernightEmailer P4 |
| B13 | recovery while lock busy | skipped, rows untouched | **M7** |
| B14 | lock service error | runs without lock + alert | Tests_EmailInfra P4 |
| B15 | duplicate / out-of-order bounce notices | one bounce, one alert | **M8** |
| B16 | bounce older than the send | not attributed | **M8** |
| B17 | bounce > 15 min after a 17:00/10:00 send | attributed | **M1**, **M8**, **M12a** (D4 fixed) |
| B18 | 13:00 reply bounce vs the 10:00 row | not attributed | **M8** (D3 still refuted after D4: the `Re:` rule) |
| B19 | search failed / capped | keep recorded bounce | Tests_EmailSweep ES-1/ES-4 |
| B20 | cycle-report counts | equal to independent count; window `[start, end)` | **M9**; Tests_CycleReport; Tests_DailyChecklist (audit window) |
| B21 | header injection / Bcc / confinement | no CR/LF, no bcc, To/Cc exact | **M10**; Tests_EmailInfra gate, Tests_OvernightEmailer header-injection |
| B22 | IST boundaries | day flips 18:30Z; cutoffs exclusive | **M11**; Tests_CycleReport CR-1 |
| B23 | threaded reply fails -> fallback; ambiguous -> no fallback | | Tests_OvernightEmailer P6, Tests_EmailLedger (16),(17) |
| B24 | whole-job crash, held alerts, watchdog | | Tests_EmailLedger (22)-(31), Tests_EmailInfra P9 |
| B25 | TEST_MODE | no ledger/log writes | Tests_EmailLedger (3), Tests_EmailLifecycleFullCycle |

## 4. Field and calculation inventory

- **Email_Ledger** (`EMAIL_LEDGER_HEADERS_`): `email_id` = `yyyyMMdd|job|region|role|bucket[|to]` [V M1]; `cycle_day` = IST day of the run
  [V M1]; `planned_at <= attempted_at <= finished_at` [V M1]; `attempts` = bucket attempts, not provider retries [V M2b]; `leads_planned`
  = bucket size [V]; `leads_sent` = leads in an ACCEPTED email, else 0 [V M1/M2]; `lead_ids_json` = overwritten by the result: the leads carried on an ACCEPTED or
  UNCONFIRMED row, [] on FAILED/BLOCKED/SKIPPED (O3 fixed) [V M1/M2/M12a/M13a]; `subject` = the subject sent, for `allIssues17` and
  `morning10` too since the D4 fix (`followup13` keeps the 10:00 subject it replies to) [V M1/M12a/M13a]; `to/cc` = exactly what
  the provider received [V M1]; `message_id/thread_id` = from the sent message, `thread_id` equals AllIssues_Log `thread_id` [V M1].
- **AllIssues_Log**: `date` (IST day of the run) [V], `lead_count` [V], `thread_id` (append-once key) [V]; checkpoint columns: existing suites.
- **Overnight_Log**: `thread_id` drives the 13:00 reply; covered by Tests_OvernightEmailer [V there].
- **Subjects**: 17:00 `<bucket> (<role>) google Leads With Issue (<range>)` (Tests_AllIssuesEmailer); 13:00 `Re: <10:00 subject>` [V code].
- **Cycle report**: window `[yesterday 16:30, now)` (start inclusive, end exclusive since the O1 fix) [V M9]; counts per job and total, attemptable =
  planned - skipped, exclusions by kind [V M9 against a seeded 120-row ledger, independent count]. Timestamps: all IST via
  `istDayKeyGs_` / `Asia/Kolkata` [V M11].

## 5. Traceability summary

All rows of section 3 have a named test. N/A to Apps Script: webhooks, dead-letter queues, SMTP/TLS negotiation, multi-tenant isolation,
open/click tracking, delivery confirmation (Gmail only reports "accepted"; bounces are inferred from mailer-daemon messages).
Remaining GAPs [U]: (1) closed 2026-10-16 - the 10:00 / 13:00 fault matrix is M12 / M13; (2) a `not found` error after a real delivery (withSendRetry_ assumes it never happens - [A]);
(3) a real execution-time kill (emulated by an unhandleable exception, M3); (4) the re-route re-send under duplicate bounces (stubbed in
M8; Tests_EmailReroute covers repeated sweeps); (5) behaviour live in the Apps Script editor (only the headless runner was run).

## 6. Execution

```
python test/run-gs-tests-headless.py                 # whole suite (Chrome/Edge headless)
python test/run-gs-tests-headless.py --at 2026-10-17T00:00:20+05:30 --tz UTC   # awkward clocks
python test/check-gs-registration.py ; python test/check-catalog.py ; python test/check-staleness.py
```
In the editor: `runEmailLifecycleMatrixTestsNow()` or `runAllTests()`.
Results 2026-10-16: `TOTAL (local headless-browser run): 3870 passed, 0 failed` (baseline before this file: 3749). The new file
also passed at `--tz UTC` with `--at` 00:00:20, 03:00 and 18:51 IST; at 00:00:20 and 03:00 one unrelated pre-existing
`Tests_MovementTracker.gs` MT-01 assertion failed (its fixture fell on the day before its earliest in-window row before ~04:48 IST).
After the fixes (section 8): `TOTAL (local headless-browser run): 3985 passed, 0 failed`, also at `--tz UTC` with `--at` 00:00:20,
03:00, 04:50, 12:50, 18:51 and 23:59:30 IST (the MT-01 fixture is now clock-relative).

## 7. Defect report

| Id | Status | Where | Repro (test) | Impact |
|---|---|---|---|---|
| D1 | **Fixed 2026-10-16** | EmailLedger.gs:396-397 (`emailLedgerPlanGs_`), consumed by EmailLedger.gs:78 | M5: the plan block write lands but throws a non-transient error -> the id is never indexed, attempt/result writes are no-ops, the delivered email stays PLANNED -> `recoverFailedAllIssuesBuckets_` targets it and delivers it a 2nd time | duplicate email after a rare Sheets error; an ops "ledger write failed" note is sent, but the recovery doc says PLANNED is safe to re-send |
| D2 | **Fixed 2026-10-16** | EmailLedger.gs:78 (`emailLedgerRecoveryTargetsGs_` filters per row, not per email_id) | M6: a stale FAILED copy of an ACCEPTED row (backup restore / hand edit) is re-sent | duplicate; no production path found that creates the copy |
| D3 | **Refuted** (re-checked after D4) | EmailSweep.gs:122 | M8: a 13:00 reply's bounce is not attributed to the 10:00 row - before D4 because that row had no subject; since D4 because a quoted `Re: <subject>` never matches a row whose own subject has no `Re:` | none |
| D4 | **Fixed 2026-10-16** | AllIssuesEmailer.gs:430 and OvernightEmailer.gs:1302 (plans without `subject`) -> EmailSweep.gs:122 | M1: a bounce 40 min after a 17:00 send that quotes the exact subject is not matched; 5 min is | delayed bounces (deferred delivery) of 17:00 / 10:00 emails are never seen: no alert, no re-route, the report shows NO_BOUNCE_SEEN |
| O1 | **Fixed 2026-10-16** | CycleReport.gs:52 | M9: 16:30:00.000 belongs to two cycles | none today (no job plans at 16:30) |
| O2 | **Fixed 2026-10-16** | EmailSweep.gs (first match in search order) | M8: `bounce_status` stamp can change between sweeps | cosmetic |
| O3 | **Fixed 2026-10-16** (UNCONFIRMED only) | EmailLedger.gs:442 | M1: `lead_ids_json` becomes [] on UNCONFIRMED/FAILED rows | the ledger no longer lists which leads an UNCONFIRMED email may have delivered |

| D5 | **Confirmed, OPEN** (found 2026-10-16 by M12) | OvernightEmailer.gs `sendOvernightMorningEmails_` region guard (Overnight_Log only) | M12a: a same-day re-run re-sends an UNCONFIRMED 10:00 bucket; M12d: re-sends an ATTEMPTING (killed mid-send) one | duplicate 10:00 email when an operator re-runs the job by hand (the repair that is safe for 17:00, M3); scheduled runs are once a day |
| D6 | **Confirmed, OPEN** (found 2026-10-16 by M13) | OvernightEmailer.gs `sendOvernightFollowupEmails_` guard (`Overnight_Log.followup_sent_at` only) | M13d: a same-day re-run re-sends an ATTEMPTING (killed mid-send) 13:00 reply | duplicate threaded reply on a manual re-run after a crash |
| O4 | observation | OvernightEmailer.gs FN-443 `recoveryLeadOverlapTargetGs_` | code reading: a FAILED/BLOCKED row records `lead_ids_json` [], so the lead-overlap stand-in match only ever works for PLANNED targets | a recovery after a routing change may report a bucket as unsent instead of matching it |

Known-defect assertions are labelled `KNOWN DEFECT Dn` in the test file; they pin the current behaviour and must be flipped when fixed.
Open ones: D5 (M12a, M12d), D6 (M13d).

## 8. Fixes applied 2026-10-16 (uncommitted, not live until pasted)

| Item | Change | Where | Tests |
|---|---|---|---|
| D4 | the 17:00 and 10:00 plans record the subject that is sent (`allIssuesSubjectGs_`, shared with the send; `combinedMorningSubjectGs_` over the same region display) | AllIssuesEmailer.gs `allIssuesSubjectGs_` + plan; OvernightEmailer.gs 10:00 plan | M1, M12a |
| D3 guard | a quoted `Re: <subject>` does not match a row whose subject has no `Re:`; a `followup13` row is matched as `Re: <stored subject>` | EmailSweep.gs `emailSweepRowSubjectGs_`, `emailSweepQuotesSubjectGs_` | M8 |
| D1 | a plan write that throws re-reads the ledger tail and indexes the rows that landed (failure still reported) | EmailLedger.gs `emailLedgerPlanGs_`, `emailLedgerRelocateGs_` | M5 (landed / not landed) |
| D2 | recovery targets decided per `email_id`; an id with any ACCEPTED/UNCONFIRMED/ATTEMPTING row is excluded; one target per id | EmailLedger.gs `emailLedgerRecoveryTargetsGs_` | M6 (6 combinations + control) |
| O1 | cycle window `[start, end)`; the daily checklist's audit window likewise | CycleReport.gs `cycleReportInWindowGs_`; DailyChecklist.gs `dailyChecklistAuditGs_` | M9, Tests_DailyChecklist |
| O3 | an UNCONFIRMED row keeps the lead ids it may have delivered (`leads_sent` still 0; FAILED/BLOCKED unchanged). Consumers checked: recovery overlap matching only reads target rows (never UNCONFIRMED); OpsAudit, cycle report, follow-up tracker do not read `lead_ids_json`; the re-route re-send reads it only for its own gate | AllIssuesEmailer.gs, OvernightEmailer.gs (10:00 + 13:00), EmailLedger.gs `emailLedgerTrackSendGs_` | M1, M2, M12a, M13a |
| O2 | the earliest matching bounce is recorded, and a recorded earlier time is never replaced by a later one | EmailSweep.gs `emailSweepMatchBounceGs_` + sweep loop | M8 |
| MT-01 test | the cohort-guard fixture is clock-relative | Tests_MovementTracker.gs | runner `--at` 00:00:20 / 03:00 / 04:50 IST |
| registration | `Tests_E2E_Live.gs` is a documented live-only exception (must not be registered; registering it is a finding) | test/check-gs-registration.py | `python test/check-gs-registration.py` clean |
