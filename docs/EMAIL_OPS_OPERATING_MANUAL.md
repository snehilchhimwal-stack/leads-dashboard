# Email Operations - operating manual

Written 2026-10-09. This manual describes what is **built** (EO-1, EO-2, EO-5, EO-8, EO-9 for the 17:00 emails, EO-10 as a warning) and labels what is **planned**.
Nothing here is live until the files are pasted into the Sheet's Apps Script project (`docs/_planning/EMAIL_OPS_SYSTEM_AUDIT.md`, "Built so far").
Why and how it was designed: `docs/_planning/EMAIL_OPS_SYSTEM_AUDIT.md`. Technical records: `GS-015` .. `GS-017`, `SHEET-019` .. `SHEET-022`.

> Every sample record below is **fictional and labelled SAMPLE**. None of it is operational data.

## 1. Executive summary

The automated email system sends three kinds of **internal** email - to the managers and RMs who own flagged leads, never to a client:

| Time (IST) | Email | Job |
|---|---|---|
| 10:00 | Overnight leads + the Checkpoint 1 follow-up of yesterday's 17:00 report | `sendOvernightMorningEmails` |
| 13:00 | Threaded reply: overnight follow-up + Checkpoint 2 | `sendOvernightFollowupEmails` |
| 17:00 | **All-issues email - the primary send** | `sendAllIssuesEmails` |

Until now each send was logged only after it succeeded, so nobody could say what *should* have gone out and didn't. The evidence trail changes that:
every bucket email is recorded from the moment it is planned to its final status, with the Gmail message and thread ids; every lead left out is recorded with the
reason; every alert is an incident; a daily bounce/reply sweep adds what came back; and **one report at 16:30 tells Snehil the whole cycle**.
The principle from the specification holds throughout: **isolate the fault, continue the safe work, alert, recover the blocked items, reconcile everything.**

What it cannot do: **delivery and opens are invisible to Apps Script.** "Accepted" means Gmail took the message; "no bounce found" means no delivery-failure message was found. Neither is
proof of delivery, and no report says so.

## 2. Assumptions and decisions (2026-10-09)

| # | Decision |
|---|---|
| D1 | One report to **Snehil only** at 16:30 every day, covering the cycle since the previous day's 17:00 - sent when everything is fine **and** when it is not |
| D2 | An error is emailed **after the rest of that job's emails are confirmed sent**, as one message that opens with "N bucket emails handled: A accepted, F failed...". A whole-job failure is sent at once |
| D3 | Per-lead isolation: **only the defective lead** is dropped; the rest of its bucket still goes |
| D4 | The Leads tab refreshes about every other hour, at varying times, with no "last imported" cell: judged from the newest lead assignment - 12 h AMBER, at least 24 h RED ("stale"; D7). A **warning** in the report; a RED tab also adds a bottom notice to every email (D6) |
| D5 | A failed 17:00 bucket can be re-sent until **18:30 IST**; after that it is not sent late |
| D6 | A RED Leads tab **never holds an email**; every email ends with a separate red "Data freshness notice" section instead |
| D7 | A stale lead must be **at least 24 hours old**: the Leads tab is RED only when its newest lead is 24 h or more old (AMBER from 12 h is a report-only warning) |

Adapted from the specification (it was written for outbound email to leads): the "recipient" is a manager/RM bucket; "suppression" is the `excluded` flag in `RM_Hierarchy`; "follow-up" is
the Checkpoint 1/2 re-check of yesterday's flagged leads; there is no unsubscribe, no tracking pixel and no email to clients.

## 3. Work breakdown (the 19 phases) and how each is handled

Status: **B** built, **P** partial, **X** outside this system (the Homesfy CRM), **Plan** not built. "Independent?" = whether a failure here lets unrelated work continue.

| # | Phase | Owner | Checkpoint | Evidence kept | Failure condition -> severity -> corrective action | Independent? | Status |
|---|---|---|---|---|---|---|---|
| 1 | Lead sourcing | CRM / import process | Leads tab refresh ~every 2 h | newest lead assignment time | Leads tab 12 h / 24 h old -> AMBER/RED warning in the 16:30 report; RED also puts a bottom "Data freshness notice" on every email (nothing is held) -> check the refresh before 17:00 | yes (warning only) | P (X for the import itself) |
| 2 | Qualification / relevance | `SlaEngine.gs` | each job | the flagged lead and its issue type in the email and the ledger's lead list | a lead flagged wrongly is a rule bug -> MEDIUM -> fix the rule | yes | B |
| 3 | Entry into CRM / tracking | CRM + Leads tab | continuous | the Leads tab | n/a here | - | X |
| 4 | Validation / duplicates | `emailLedgerSplitLeadsGs_` | before each 17:00 bucket | `Email_Ledger_Exclusions` row with reason | blank id / over-long id / blank reason for contact / duplicate id -> MEDIUM -> that lead is dropped, the rest goes | yes (per lead) | B (17:00) |
| 5 | Eligibility / compliance | `RM_Hierarchy` (`excluded`), the send gate | each bucket | exclusion rows; `BLOCKED` ledger status with the gate's reason | invalid address, empty body, missing lead in body -> MEDIUM -> that bucket is blocked, others go | yes (per bucket) | B |
| 6 | Reason for contact | issue type per lead | each job | the issue label on every lead line | blank reason -> lead dropped (phase 4) | yes | B |
| 7 | Segmentation / priority | region/bucket resolution | each job | ledger `region`, `bucket_label`, `primary_role` | unroutable RM -> goes to the CH-level backstop; exclusion row | yes | B |
| 8 | Template / personalisation | `renderOvernightReportEmailHTML_` | each job | the email itself, plain + HTML | n/a | - | B |
| 9 | Recipient + content verification | `sendGuardedEmailGs_` | each send | `BLOCKED` + reason | HIGH only if the whole job is blocked | yes (per bucket) | B |
| 10 | 13:00 send | `sendOvernightFollowupEmails` | 13:00 (watchdog 13:30) | ledger row `followup13` with message + thread id | failed/unconfirmed/blocked -> MEDIUM -> held alert after the run | yes (per bucket) | B |
| 11 | **Immediate post-13:00 audit** | held alert (D2) + the 16:30 report | right after the run | the alert's confirmation line; Incident_Log | any failure in the 13:00 run is emailed once the rest is confirmed sent | yes | B (as the held alert; a separate silent audit pass is Plan) |
| 12 | 17:00 preparation | `sendAllIssuesEmails_` | 17:00 | ledger rows PLANNED per region in one write | a crash before planning -> CRITICAL, sent at once | n/a | B |
| 13 | 17:00 validation + send | the send gate, per-lead isolation | 17:00 (watchdog 17:30) | per-bucket status | see phases 4, 5, 9 | yes (per bucket / per lead) | B |
| 14 | Post-send verification + reconciliation | the ledger, the sweep, the 16:30 report | 15:45 sweep, 16:30 report | `bounce_status`, `reply_status`, `swept_at`; Daily_Report row | bounce -> HIGH alert; PLANNED/ATTEMPTING left over = outcome unknown -> attention | yes | B |
| 15 | Follow-up scheduling / execution | Checkpoint 1 (10:00) and 2 (13:00) | next day | `AllIssues_Log` checkpoint columns, `Lead_Followups` | a skipped checkpoint -> MEDIUM | yes (per bucket) | B (the tracker lists every checkpoint) |
| 16 | Reply / bounce / engagement monitoring | `EmailSweep.gs` | 15:45 daily | the three sweep columns | search fails -> `UNKNOWN`, never "no bounce" | yes | B (opens: not available) |
| 17 | Lead status updates / next action | CRM | - | - | n/a here | - | X |
| 18 | Exception resolution + recovery | `recoverFailedAllIssuesBucketsNow` (17:00), `recoverFailedMorningBucketsNow` (10:00), `recoverFailedFollowupBucketsNow` (13:00) | until 18:30 / 12:45 / 16:00 | ledger attempts, SKIPPED reason | still failing -> alert again; past the cutoff -> not sent late | yes | B |
| 19 | End-of-day reconciliation + report | `CycleReport.gs` | 16:30 daily (watchdog 17:00) | the email; `Daily_Report` row | not sent by 17:00 -> CRITICAL watchdog alert | yes | B |

Responsible owner for every row where a person must act: **Snehil**. Escalation: the alert already goes to Snehil; there is no further tier in this system.

## 4. Flags and severity

The system records statuses; read them as the specification's flags:

| Flag | Meaning | Ledger / report evidence |
|---|---|---|
| **GREEN** - completed, evidence as strong as Apps Script allows | the email was ACCEPTED by Gmail and, once 30 minutes old, no bounce was found | `ACCEPTED` + `NO_BOUNCE_SEEN` (this is *not* proof of delivery) |
| **AMBER** - pending, uncertain or awaiting evidence | the outcome is not known yet or cannot be known | `PLANNED`, `ATTEMPTING` (run died), `UNCONFIRMED` (a timeout - it may have gone), `UNKNOWN (...)`, not swept yet, Leads tab AMBER |
| **RED** - failed, incorrect or needs you | nothing reached the recipient, or a data problem | `FAILED`, `BLOCKED`, `BOUNCED`, Leads tab RED, a CRITICAL/HIGH incident |
| **GREY** - not due or not applicable | nothing to do | `SKIPPED` (nothing to send), an email not yet 30 minutes old |

Incident severity (`Incident_Log.severity`, a guess from the alert's subject):

| Severity | Used for |
|---|---|
| CRITICAL | a whole job crashed / did not run / did not finish / was skipped |
| HIGH | a test-mode run suppressed recipients; no overlap lock; an address that cannot be resolved; a **bounce** |
| MEDIUM | one bucket or item failed, was blocked or was unconfirmed |
| LOW | bookkeeping notes (e.g. the ledger itself could not be written) |

Missing evidence is never reported as a confirmed failure: it is AMBER/`UNKNOWN`.

## 5. Daily checklist (stages A-K)

| Stage | What | Who / what does it | Evidence |
|---|---|---|---|
| A Start of day | the watchdog confirms yesterday's 23:15 sync and the morning jobs are on schedule | automatic (hourly watchdog) | run records; alerts only on a problem |
| B Lead sourcing + qualification | the Leads tab is refreshed; the SLA rules flag leads | CRM import + `SlaEngine.gs` | freshness line in the 16:30 report |
| C CRM + data quality | duplicates and unusable leads dropped per lead | automatic at 17:00 | `Email_Ledger_Exclusions` |
| D Reason for contact | every lead line carries its issue type | automatic | the email |
| E Email preparation | buckets resolved and PLANNED | automatic | `Email_Ledger` |
| F 13:00 checkpoint | the threaded reply | automatic | ledger `followup13` |
| G Immediate post-13:00 audit | a failure is emailed after the run (D2); the 14:00 silent audit checks the 13:00 replies against their logs | automatic | held alert + Incident_Log; `EMAIL_AUDIT_LAST_auditFollowupEmails` |
| H 17:00 preparation | as E | automatic | as E |
| I 17:00 send + verification | send, per-bucket isolation, ACCEPTED/FAILED; the 18:00 silent audit; recovery until 18:30 | automatic; **you** run `recoverFailedAllIssuesBucketsNow()` after fixing a cause | ledger, AllIssues_Log |
| J Follow-up monitoring | bounces and replies (15:45 sweep) | automatic | sweep columns, the report |
| K End-of-day reconciliation | **the 16:30 report** | automatic; **you read it** | the email, `Daily_Report` |

The report evaluates this table itself and shows it as "Daily checklist (A-K)" with a flag and the evidence per stage (also stored in the `Daily_Checklist` tab): GREEN done and supported; AMBER look, or the evidence is missing; RED a failure is on record; GREY not applicable. `showDailyChecklistNow()` previews it.

Never mark an action complete because it was planned or attempted: a ledger row stays `PLANNED`/`ATTEMPTING` until a result is recorded, and the report counts such rows as unfinished.

## 6. After the 13:00 run - what an error looks like

You are emailed only when something went wrong, **after** the rest of the run is confirmed sent. A single problem keeps its own subject; several are one message.
The first line always states what went out. SAMPLE (fictional):

```
Subject: [Overnight Emailer] 1pm follow-up failed for Pune        <- SAMPLE
CONFIRMATION: 14 bucket email(s) were handled in this run - 13 accepted by Gmail, 1 failed. ("Accepted" means Gmail took the message; delivery and opens
cannot be seen from here.) The alert(s) below were held until the rest of the run finished.

Region: Pune
Thread: <thread id>
Intended recipient: sample.manager@example.test
...
Nothing was marked as sent ... running sendOvernightFollowupEmailsNow again TODAY will retry this bucket.
```

For each issue the alert gives: the lead/email, expected vs actual, severity (Incident_Log), evidence (the ids), corrective action, and whether you must act. Confirmed failures
(`FAILED`, `BLOCKED`) and items lacking evidence (`UNCONFIRMED`, `UNKNOWN`) are kept apart.

## 7. 17:00 pre-send and post-send checklist

Before 17:00 (the 16:30 report's "Ready for 17:00?" table): recipient addresses resolve; no held alerts waiting; Leads tab fresh (GREEN) or its AMBER/RED noted.
At 17:00 (automatic): the Leads tab is read once; flagged leads become buckets per region; each bucket is PLANNED, then ATTEMPTING, then ACCEPTED/FAILED/UNCONFIRMED/BLOCKED; defective leads are dropped individually and recorded; the same-day re-run guard stops a region being sent twice.
After 17:00: failures arrive as one held alert; fix the cause and run `recoverFailedAllIssuesBucketsNow()` before 18:30 (the same for the morning: `recoverFailedMorningBucketsNow()` before 12:45, `recoverFailedFollowupBucketsNow()` before 16:00); about 18:00 a silent audit checks the 17:00 records and speaks only if they disagree; next day 15:45 the sweep records bounces and replies; 16:30 the report reconciles planned vs accepted vs failed vs left out.

The reconciliation numbers (all in the report, each with numerator and denominator): planned, accepted by Gmail, skipped, failed, unconfirmed, blocked, unfinished, leads sent, leads left out (with reasons), bounced, replies, incidents.
There is no "delivered" number and no "opened" number, by design.

## 8. Fault isolation and continuity (the decision matrix)

| Fault | Smallest affected unit | What continues | What happens to the blocked item |
|---|---|---|---|
| A lead with no id / blank reason / duplicate id | that lead | the rest of its bucket and every other bucket | dropped, exclusion row with the reason; a duplicate is not reported as unsent (its first copy was) |
| The send gate objects to specific leads | those leads | the rest of the bucket (re-sent once without them) and all other buckets | dropped, exclusion row; reported in "Leads NOT sent" |
| A bad recipient address | that bucket | all other buckets | `BLOCKED`, reason recorded; fix the address, then recover (until 18:30) |
| Gmail refuses one send | that bucket | all other buckets | `FAILED`; recover |
| A timeout (may have been delivered) | that bucket | all other buckets | `UNCONFIRMED` - **never re-sent automatically**; check Gmail Sent first |
| One RM cannot be routed | that RM's leads | everything else | goes to the CH-level backstop; exclusion row |
| An excluded RM | that RM's leads | everything else | their leads never go to the manager chain; they go to the CH-level backstop only |
| The whole sending platform fails | every bucket | nothing can send | all `FAILED`; ONE consolidated alert; recover everything once it is back (until 18:30) |
| The Leads tab cannot be read / the job crashes | the whole job | - | CRITICAL alert **at once** (nothing left to confirm); the run record says failed; the watchdog also flags it |
| The job is killed by the platform | the run | - | its ledger rows stay `PLANNED`/`ATTEMPTING` (outcome unknown); held alerts are released by the watchdog after 45 minutes |
| The ledger / incident log / Daily_Report cannot be written | the evidence only | **every email** | one LOW note after the run; the emails are unaffected (the evidence is never a gate) |
| Duplicate-send risk | - | - | per-region/day guard, the job lock, deterministic email ids, UNCONFIRMED never retried, recovery only for `FAILED`/`BLOCKED` |

Rules that never bend: a safety check is never bypassed to keep going (a refused email stays refused); a retry never repeats an `UNCONFIRMED` send; nothing is reported sent without the Gmail ids.

## 9. Follow-ups

What exists: Checkpoint 1 (next day 10:00) and Checkpoint 2 (13:00) re-check yesterday's flagged leads against the current data and email only what is still unresolved (`AllIssues_Log` checkpoint columns;
`Lead_Followups` for the suggested actions). The **follow-up tracker** (`Followup_Tracker`, also a section of the 16:30 report) lists, for every 17:00 bucket, where Checkpoint 1 and Checkpoint 2 stand: COMPLETED, NOT_NEEDED, BLOCKED (a failure, an unconfirmed send or a run that died is on record), OVERDUE (30 minutes past its hour with nothing recorded), DUE or FUTURE. A bounced 17:00 email marks the row **STOP** (the recipient never got it); a reply is shown only. STOP is a status for you to act on - the jobs still send as before. Whether a bounce or reply should stop follow-ups automatically is an open decision for you.

## 10. The 16:30 report (template)

Subject: `Email Ops cycle report <date>: all clear (N of M emails accepted by Gmail)` / `K need attention (...)` / `no emails recorded in this cycle`.
Sections: KPI tiles; **What went out** (per job: planned / accepted / skipped / failed / unconfirmed / blocked / unfinished / leads sent); **Bounces and replies**; **Needs attention**;
**Left out of emails** (reasons); **Incidents in this cycle**; **Ready for 17:00?** (addresses, held alerts, Leads tab freshness, what is not tracked).
SAMPLE (fictional):

```
Email Ops cycle report 9 Oct 2026: 2 need attention (11 of 13 emails accepted by Gmail)          <- SAMPLE
Whole cycle: 8 Oct 16:30 to 9 Oct 16:30 IST
Email execution: 11 of 12 (92%) accepted by Gmail (accepted / planned minus skipped).
What went out:  17:00 All-Issues  planned 8  accepted 7  failed 1 ... | 10:00 ...  | 13:00 ...
Needs attention (2):  17:00 All-Issues | Pune | Sample A1 | FAILED | Gmail send blocked ...
                      17:00 All-Issues | Thane | Sample TM | BOUNCED | ... delivery-failure message came back
Ready for 17:00?  Leads tab freshness | GREEN: the newest lead was assigned 1.2 h ago ...
```

Rates and their definitions: **email execution rate** = accepted / (planned - skipped); lead-level counts (leads sent, leads left out) are kept apart from email-level counts (an email carries many leads).
Reply rate and verified-delivery rate are not reported (delivery is unobservable); follow-up completion is shown as the tracker's counts, not as a rate.

## 11. Master tracker schema (where each table lives)

| Spec table | Tab | Key | Notes |
|---|---|---|---|
| A. Lead master | `leads` (CRM export) + `Daily_RM_Issues` + `Lead_Followups` | `lead_id` | reused, not copied |
| B. Email activity log | **`Email_Ledger`** (+ `Email_Ledger_Exclusions`) | `email_id` = `yyyymmdd|job|region|role|bucket` (10:00/13:00 add the recipient) | statuses `PLANNED`, `ATTEMPTING`, `ACCEPTED`, `FAILED`, `UNCONFIRMED`, `BLOCKED`, `SKIPPED`; + `message_id`, `thread_id`, `bounce_status`, `reply_status`, `swept_at`; 90-day retention archived to Drive |
| C. Follow-up tracker | `AllIssues_Log` checkpoint columns + `Lead_Followups` | thread/lead | a dedicated view is planned |
| D. Daily quality checklist | the 16:30 report's tables | - | a per-check sheet is planned (EO-6) |
| E. Incident and exception log | **`Incident_Log`** | `incident_id` = `INC-yyyymmdd-hhmmss-n` | severity, scope, notification (`HELD`/`SENT`/`RELEASED`...), continuity note |
| F. Daily performance report | **`Daily_Report`** | `report_day` | one row a day, upserted |

Duplicates are prevented by deterministic email ids (a re-run finds its own row), the per-region/day guard, the job lock and once-only appends. Corrections keep the audit trail: a row's attempts count and result are updated in place; exclusions are append-only.

## 12. Automation and notification plan (what is configured, not hoped)

| Automation | Trigger | Data | Notifies | Retry / failure | Others continue? |
|---|---|---|---|---|---|
| 10:00 / 13:00 / 17:00 emails | `atHour(10/13/17).nearMinute(0)` | Leads tab, hierarchy | managers | gate; `withSendRetry_` only for a definite refusal; never an ambiguous one | yes, per bucket |
| Held alerts | inside those jobs | Incident_Log | Snehil, after the run | released by the watchdog after 45 min if the run died | yes |
| Bounce / reply sweep | 15:45 daily (no job lock) | ledger + Gmail search/threads | Snehil on a new bounce | a failed search -> `UNKNOWN`, retried next day | yes |
| Cycle report | 16:30 daily (no job lock) | the three evidence tabs, Leads tab | Snehil (every day) | a crash alerts at once and re-throws; the watchdog flags a missing report from 17:00 | yes |
| Recovery | manual `recoverFailedAllIssuesBucketsNow()` / `recoverFailedMorningBucketsNow()` / `recoverFailedFollowupBucketsNow()` | ledger FAILED / BLOCKED / PLANNED (never UNCONFIRMED or ATTEMPTING) | Snehil if still failing | until 18:30 / 12:45 / 16:00; `...ForceNow` overrides on purpose | yes |
| Silent audits | ~11:15, ~14:00, ~18:00 daily (no job lock) | ledger + `Overnight_Log` + `AllIssues_Log` | Snehil, only on an exception | a job still running is deferred, never alerted; an unreadable input alerts once as "could not run" | yes |
| Watchdog | hourly | run records | Snehil | one alert per job per day per problem | - |

**Stale Leads tab (D6).** When the newest lead on the Leads tab was assigned at least 24 h ago (RED - a stale lead is at least a day old, D7), the 17:00, 10:00 and 13:00 emails and the CH-level reports are sent as normal, and each ends with a red "Data freshness notice" section (how old the newest lead is; a listed lead may already be handled; check the CRM before acting). AMBER (12 h up to 24 h) and UNKNOWN add nothing to the emails; both still show in the 16:30 report. The notice is judged at the moment of each send (a re-send after the tab refreshed has none) and is fail-open: if the check errors, the email goes without it.

Human judgement stays with a person: fixing an address or hierarchy row, deciding to re-send an `UNCONFIRMED` email, and reading the report.
No notification is claimed sent unless the send path confirmed it: an incident is `HELD`, then `SENT`/`SEND-FAILED`/`RELEASED`.

## 13. Roadmap

Built: EO-1a/1b ledger (17:00, 10:00, 13:00, CH-level), EO-2 incident log + held alerts, EO-5 sweep, EO-8 report + daily row, EO-9 17:00 recovery, EO-9b 10:00/13:00 recovery, EO-3/EO-4 silent audits, EO-6 daily checklist, EO-7 follow-up tracker, EO-10 freshness warning + the bottom notice on every email (D6), EO-11 acceptance scenarios (as tests).
Planned: nothing more from the original plan. Open decision: should a bounce or a reply stop the follow-ups automatically (today a bounce only marks the row STOP)?

## 14. First five actions

1. Paste the 18 files from `Downloads\Email-Ops-package` (new files via "+" -> Script); run `runAllTests()` and read the total.
2. Run `setupEmailCycleReportTrigger()`, `setupEmailSweepTrigger()` and `setupOpsAuditTriggers()` once each.
3. Preview without sending: `showEmailCycleReportNow()`, `showEmailSweepPlanNow()`, `showEmailLedgerTodayNow()`, `showEmailAuditNow()`.
4. After the next 17:00 run, run `showEmailLedgerTodayNow()`; next day expect the 16:30 report.
5. Record the deploy (`python3 test/match-live-gs.py ... --apply`).

## Appendix - the specification's acceptance scenarios and the tests that prove them

All in `Tests_EmailLedger.gs`, `Tests_CycleReport.gs`, `Tests_EmailSweep.gs` (every one also mutation-proved: a deliberate bug in the rule makes the named test fail).

| Scenario | Proved by |
|---|---|
| Invalid lead | lead checks and splits ("lead check:", "split:"); scenario "duplicate id"; "one bad lead" |
| Failed email | "refused send"; "timeout" (UNCONFIRMED); "every lead refused" (BLOCKED) |
| Duplicate-send risk | "re-run"; "unconfirmed: it is not a recovery target"; "recovery: once recovered there is nothing left"; the job lock and region guard tests |
| CRM / data-source outage | "crash" (CRITICAL, sent at once); "freshness: an unreadable Leads tab is UNKNOWN" |
| Sending-platform outage | "outage:" and "outage recovery:" (all FAILED, one consolidated alert, both recovered) |
| Unsubscribe / suppression | "excluded RM:" (never emailed to the chain; backstop only) |
| Delayed follow-up | "resolved before 13:00", "nothing for 13:00" (skipped with reason); the follow-up tracker lists it as BLOCKED or OVERDUE |
| Mixed batch | "held alert:" (one bucket fails, the other is fine, one alert, 1 of 2 confirmed); "one bad lead"; "recovery:" with a sibling |
