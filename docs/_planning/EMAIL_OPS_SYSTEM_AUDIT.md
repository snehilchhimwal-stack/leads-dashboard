# Email Operations System - audit and build plan

Written 2026-10-09. Status: **plan + audit written; EO-1, EO-2, EO-5 and EO-8 are built, tested and pushed - NOT yet live (see "Built so far" below).**
Source: the "Senior Sales Operations Manager / Workflow Architect / Email Process Auditor" specification (19-phase WBS, flags,
fault-isolation rules, 13:00 audit, 17:00 primary send, follow-ups, end-of-day report, six-table schema).
Builds on `docs/_planning/EMAIL_AUDIT.md` (P1-P18c, all deployed) - read that first; this document does not repeat it.

## Built so far (updated 2026-10-09 evening) - and how to put it live

| Part | What it does | Files | Record |
|---|---|---|---|
| EO-1a/1b | `Email_Ledger` + `Email_Ledger_Exclusions`: every 17:00 / 10:00 / 13:00 bucket email and both CH-level reports, planned -> attempting -> accepted/failed/unconfirmed/blocked/skipped with the Gmail message + thread ids; every lead or region left out, with the reason; per-lead isolation at 17:00 | `EmailLedger.gs` (new), `AllIssuesEmailer.gs`, `OvernightEmailer.gs`, `EmailInfra.gs` | `GS-015`, `SHEET-019`, `SHEET-020` |
| EO-2 | `Incident_Log`; an alert raised inside an email job is held and sent once AFTER the job, behind "N of M emails accepted"; a whole-job crash is sent at once; the watchdog releases alerts of a killed job | `EmailLedger.gs`, `EmailInfra.gs` | `GS-015`, `SHEET-021` |
| EO-8 | the 16:30 cycle report to Snehil (every day, fine or not) | `CycleReport.gs` (new) | `GS-016` |
| EO-5 | the 16:10 bounce / reply sweep (feeds the report; alerts on a new bounce) | `EmailSweep.gs` (new) | `GS-017` |

All twelve files are in one folder, `Downloads\Email-Ops-package`: `EmailLedger.gs`, `CycleReport.gs`, `EmailSweep.gs` and their three `Tests_` files are NEW; `AllIssuesEmailer.gs`, `OvernightEmailer.gs`, `EmailInfra.gs`,
`Tests_EmailInfra.gs`, `Tests_Mocks.gs`, `Tests_RunAll.gs` are changed. Nothing is live until pasted into the Sheet's Apps Script editor (CLAUDE.md; `docs/STALENESS_TRACKER.md` deploy register).

**Put it live (in this order, with Snehil at the keyboard for Ctrl+S):**
1. Paste the 12 files (new ones via "+" -> Script -> Rename). Run `runAllTests()` once and read the total (nothing sends, nothing touches the real sheet).
2. Run `setupEmailCycleReportTrigger()` once and `setupEmailSweepTrigger()` once (each installs one daily trigger and replaces only its own earlier one).
3. Preview without sending: `showEmailCycleReportNow()`, `showEmailSweepPlanNow()`, `showEmailLedgerTodayNow()` (all read-only).
4. The tabs `Email_Ledger`, `Email_Ledger_Exclusions` and `Incident_Log` create themselves on the first 17:00 run / first alert. After that day's 17:00 run, run `showEmailLedgerTodayNow()`; the next day expect the 16:10 sweep and the 16:30 report.
5. Update the deploy register (`python3 test/match-live-gs.py ... --apply`).
Rollback: paste the previous versions from git (`git show <sha>:EmailInfra.gs` etc.); the three new tabs can simply be left or hidden.

Also built: EO-10 as a warning in the 16:30 report (Leads-tab freshness, AMBER over 3 h / RED over 5 h; nothing is blocked) and the `Daily_Report` row per day (EO-8b).

**Not built yet:** EO-3/EO-4 (the silent 13:00 audit pass and the 17:00 pre-send / post-send reconciliation), EO-6 (daily checklist A-K with GREEN/AMBER/RED/GREY), EO-7 (follow-up tracker), EO-9 (recovery of blocked emails), EO-11 (the spec's eight fault-injection scenarios as one suite), EO-12 (operating manual).

## 0. Decisions recorded 2026-10-09 (these override anything below that disagrees)

| # | Question | Decision |
|---|---|---|
| D1 | Who gets reports, and when | **Snehil only** (the ops-alert address). **One report at 16:30 every day** covering the whole cycle that started at the previous day's 17:00 (that 17:00 send, today's 10:00 and 13:00, bounces/replies found since, follow-ups, incidents, rates) - sent when everything is fine **and** when it is not |
| D2 | When an error is reported | **After the rest of that job's emails are confirmed sent.** An error never delays or interrupts the safe work: alerts raised during a job are held, and sent once as one message at the end of the job, starting with a confirmation line ("N of M other bucket emails accepted"). A failure of the whole job (nothing left to confirm) is sent at once. The 13:00 / 17:00 audit passes run silently when clean and email only on an exception |
| D3 | Lead-level isolation | **Yes - drop only the defective lead.** The rest of that bucket's email still goes out. A bucket with no valid lead left is recorded as excluded. Every dropped lead is recorded with its reason |
| D4 | Leads-tab freshness | The tab refreshes about **every other hour, at varying times**; no "last imported" cell exists. Default gate: newest lead evidence older than 3 h on a working day = AMBER, older than 5 h = RED. If the refresh process can write one timestamp cell, the gate becomes exact (a one-cell change on your side; not required) |
| D5 | Late sends | Default: a blocked 17:00 bucket recovered up to **18:30** is sent late; after that it is recorded "rescheduled" and not sent |

Consequences already folded into the parts below: the separate 13:35 / 17:35 / 19:00 emails are gone (their checks still run,
silently, and feed the 16:30 report); `Email_Ledger_Leads` is now exclusion-only (see section 6); EO-2 also owns the held-alert
mechanism; EO-1 is built in two steps (EO-1a: ledger + the 17:00 job; EO-1b: the 10:00 and 13:00 jobs).

## 1. Goal

Turn the existing three-email pipeline (10:00 overnight + checkpoint 1, 13:00 checkpoint 2, **17:00 all-issues - the primary send**)
into an **auditable operation**: every planned email ends in a recorded final status with evidence; the 13:00 run is audited and
its exceptions reach the owners right after it; the 17:00 run is validated before and reconciled after; a fault in one bucket,
recipient or lead never stops the safe work; every blocked item has a reason, an owner and a recovery path; and one end-of-day
report states what was planned, what actually happened, and what is still open.

Principle carried over verbatim from the spec: **isolate the fault, continue the safe work, alert, recover the blocked items,
reconcile everything.**

## 2. How the spec's words map onto THIS system (read before the matrices)

The spec is written for outbound email **to leads**. This system's emails go **to internal managers and RMs about their leads**
(`EMAIL_AUDIT.md` section 1: no email to any client, no unsubscribe list, no bounce handling, no queue). Translation used throughout:

| Spec term | In this system |
|---|---|
| Lead | A row of the Leads tab (Homesfy CRM export). The Homesfy CRM is the system of record; this repo only reads it |
| Lead qualification / reason for contact | The SLA engine (`SlaEngine.gs`): a lead is "flagged" for one of 5 issue types, inside the Source=google / Sub-source=Non-UTM/Search scope. The issue type IS the reason for contact |
| Recipient | The RM's manager chain resolved from `RM_Hierarchy` / `Manager_Directory` (A1/TM/RH/CH bucket) |
| Email (unit of work) | One **bucket email** = one recipient group x one region x one job (10:00 / 13:00 / 17:00). Usually 40-60 per day per job; carries many leads |
| Email-level vs lead-level metric | Both exist: a bucket email is one row in the email ledger; each lead it carries is a child of that email. Report both, never mix numerators |
| Suppression / unsubscribe | **Do-not-email = the `excluded` flag in `RM_Hierarchy`** (and a recipient that fails the address check). There is no recipient-controlled opt-out. Adapted, not copied |
| Follow-up | Two things: (a) the next-day re-appearance of a still-open lead in a later email, (b) `Lead_Followups` suggestions and the checkpoint 1/2 results in `AllIssues_Log`. "Follow-up email to a lead" does not exist |
| Reply | A reply on the sent thread from a recipient. Ids are stored (`thread_id`), so this is detectable |
| Bounce | A delivery-status message (mailer-daemon / postmaster) in the sending mailbox. Detectable by Gmail search, not by the send call |
| Delivered / opened | **Not verifiable** from Apps Script. `send()` returning means Gmail *accepted* it. Delivered stays "not verified"; opened stays "not available" (no tracking pixel - deliberately not added). The report states this and never infers one from the other |
| CRM outage | The Leads tab / Sheets API unreadable. Handled as "the lead data source", see matrix 6 |

## 3. Current infrastructure - what already carries part of the spec

| Capability | Where | What it already gives |
|---|---|---|
| One send gate | `prepareOutgoingEmailGs_` / `sendGuardedEmailGs_` (EmailInfra.gs:635 / 686) | Address check, non-empty subject/body, every counted lead id present in both bodies. **Single choke point for every report email - the right place to hook a ledger** |
| Send-error classification | `isAmbiguousSendErrorGs_`, `sendBlockedErrorGs_` (`blockedByGuard`) | Temporary/ambiguous vs definite failure; guard-blocked vs sent-failed |
| Overlap lock | `withEmailJobLockGs_` | No double run |
| Run records + watchdog | `EMAIL_JOB_RUN_<job>`, `emailJobScheduleGs_`, `emailJobWatchdog` (hourly) | "Did the job start / finish / die" - **job level only** |
| Ops alert | `notifyOpsAlertGs_` (EmailInfra.gs:354), `notifyLeadSendFailuresGs_` (:407) | A consolidated failure email per run |
| Per-bucket isolation | `AllIssuesEmailer.gs` bucket loop (:311-356), `sendOneAllIssuesEmail_` returns `{reason}` instead of throwing | One bucket failing does not stop the others |
| Duplicate-send guards | per-region "already has an AllIssues_Log row today", `appendRowOnceGs_`, job lock | No second 17:00 email per region/day |
| State | `AllIssues_Log` (incl. `checkpoint1_json/2_json`), `Overnight_Log`, `Lead_Followups`, `Movement_Log`, `Daily_RM_Issues` | What was **sent** (written only after success) and how the lead state moved |
| Config / address problems | `emailConfigProblemsGs_`, `auditUnresolvedRmsNow` | Unresolvable recipients surface in the watchdog |
| Test harness | `Tests_*.gs`, `run-gs-tests-headless.py --at/--tz`, mutation scripts | Where every new piece is proven |

**Structural finding that drives the whole plan:** every log row in this system is written *after a successful send*. So the system
knows what went out and cannot know what **should** have gone out and didn't, what was blocked, or why. That single fact is why
the spec's reconciliation, exception report and end-of-day report cannot be produced today. Everything below hangs off fixing it.

## 4. Coverage matrix 1 - the 19 WBS phases

Legend: **C** covered, **P** partial, **G** gap, **X** outside this repo.

| # | Spec phase | Status | Where it lives today | What is missing |
|---|---|---|---|---|
| 1 | Lead sourcing / identification | X + G | Homesfy CRM -> Leads tab (not in this repo) | No check that the Leads tab is **fresh** before sending (stale import = emails about a stale world) |
| 2 | Qualification / relevance | C | `SlaEngine.gs` 5 issue types + scope filter | - |
| 3 | Entry into CRM / tracking | C | CRM + Leads tab; `Daily_RM_Issues`, `Movement_Log` | - |
| 4 | Validation / duplicate detection | P | Duplicate **email** guards exist; address validation | No duplicate-**lead** or bad-contact audit; no data-quality flag |
| 5 | Eligibility / compliance | P | Address check; `excluded` flag; fallback routing | Exclusions and fallbacks are not recorded per email (no "excluded, reason" record) |
| 6 | Reason-for-contact documentation | C | `issueLabel` per lead in the email; `issue_snapshot_json` | Not queryable per email/lead in one place |
| 7 | Segmentation / prioritization | C | Region/bucket, issue priority | - |
| 8 | Template / personalization | C | `renderOvernightReportEmailHTML_` + plain part | - |
| 9 | Recipient + content verification | C | The send gate | The gate's verdict is thrown away after the run (only the ops-alert text survives) |
| 10 | 13:00 prepare + send | C | `sendOvernightFollowupEmails` | - |
| 11 | **Immediate post-13:00 audit + exception notification** | **G** | Watchdog says "job ran" | No expected-vs-actual, no per-item exception report to the owners |
| 12 | 17:00 prepare | P | `sendAllIssuesEmails_` builds lists | No separate pre-send **validation report** |
| 13 | 17:00 pre-send validation + send | P | Gate + isolation | Pre-send summary (eligible/excluded/defective) not produced; defects found only as thrown errors |
| 14 | **Post-send verification + reconciliation** | **G** | - | Planned vs attempted vs accepted vs failed vs blocked: nowhere |
| 15 | Follow-up scheduling / execution | P | `Lead_Followups`, checkpoint 1/2 | No due / overdue / blocked tracker; no "do not follow up after reply/bounce" rule |
| 16 | **Reply / bounce / engagement monitoring** | **G** | `thread_id` is stored | Nothing reads replies or bounces |
| 17 | Lead status update / next action | P | `Lead_Followups` carries the suggested next action | Status itself lives in the CRM (X) |
| 18 | **Exception resolution + recovery** | **G/P** | Alerts say "run it by hand" | No incident record, no blocked-item queue, no revalidate-then-resume path |
| 19 | **End-of-day reconciliation + report** | **G** | - | Nothing at all |

## 5. Coverage matrix 2 - the 20 conditions the spec says to audit

| Condition | Status | Note |
|---|---|---|
| Lead missing from CRM | X | Not detectable here; the Leads tab IS the copy. Only a freshness/size sanity check is possible |
| Duplicate lead | G | Add a Leads-tab duplicate-id check to the data-quality stage |
| Inaccurate contact details | P | Applies to **recipient** addresses: covered by the gate; RM phone/email in the CRM is out of scope |
| Unqualified / irrelevant lead | C | The scope filter + SLA rules |
| Missing / invalid reason for contact | C | A flagged lead always has `issueLabel`; add a ledger assertion |
| Email content inconsistent with reason | C | Leads and reasons rendered from the same objects |
| Incorrect recipient | P | Hierarchy drift is audited (sync, OPS_CHECKLIST); per-email recipient is not recorded for later audit |
| Misleading personalization | P | Gate checks lead ids; names/regions from the same row |
| Wrong template | C | One template per job |
| Email sent outside schedule | G | Not recorded; the run record has start only. Ledger timestamps close this |
| Failed / bounced email | P / G | Failure of `send()` is alerted; **bounces are invisible** |
| Email not verifiably sent | G | A send is trusted if `send()` returned; no message id kept |
| Missing / overdue follow-up | P | See phase 15 |
| Inappropriate follow-up after a reply | G | Replies are not read |
| Unrecorded lead status change | X/P | CRM owns status; `Movement_Log` records movement for tracked leads |
| Unresolved reply | G | |
| Unsubscribe / suppression violation | adapted | `excluded` RM must never be a recipient - add an assertion + ledger status `EXCLUDED` |
| Planned vs actual recipients | **G** | The core gap |
| Duplicate-email risk | C | Existing guards; add a ledger-based second check before any manual re-run |
| Unresolved incident at end of day | G | No incident record |

## 6. Coverage matrix 3 - the six-table master schema

Reuse what exists; add only what is genuinely missing (no second copy of lead data).

| Spec table | Decision |
|---|---|
| A. Lead Master | **Reuse** Leads tab (CRM export) + `Daily_RM_Issues` + `Lead_Followups`. No new sheet. Lead-level status per email lives in the ledger's lead child rows |
| B. Email Activity Log | **NEW `Email_Ledger`** (one row per bucket email; the leads it carries are kept in its `lead_ids_json` cell, so lead-level counts come from there) + **`Email_Ledger_Exclusions`** (one row per lead or bucket that did NOT go, with the reason - small, because only the exceptions are stored) |
| C. Follow-up Tracker | **Derived view** (a function + a report section) over `Lead_Followups` + the checkpoint JSON; add a sheet only if the view proves too slow |
| D. Daily Quality Checklist | **NEW `Daily_Checklist`** (A-K stages x checks, auto-evaluated, one row per check per day) |
| E. Incident and Exception Log | **NEW `Incident_Log`** (fed by `notifyOpsAlertGs_` + the isolation paths) |
| F. Daily Performance Report | **NEW `Daily_Report`** (one row per day, numerators and denominators stored, not just percentages) |

Ledger design (decided now because everything depends on it):

- **Hook at `sendGuardedEmailGs_`**, not at six send sites. Add a context argument (`{job, region, bucket, leadIds, kind}`); the gate
  records the row: `PLANNED` on entry, then `BLOCKED` (guard problems), `FAILED` (error, ambiguous or definite), or `ACCEPTED`
  (the `GmailMessage` that `.send()` returns gives `getId()` and `getThread().getId()` - this is the evidence the spec demands).
- **Planned-but-never-reached items** (unresolvable recipient, region already sent today, excluded RM) are recorded at the point they
  are skipped, as `EXCLUDED` / `BLOCKED` with a reason - these are the rows the current logs can't show.
- **Statuses never infer each other:** `PLANNED -> ATTEMPTED -> ACCEPTED | FAILED | BLOCKED | EXCLUDED`, then independently
  `BOUNCED` / `REPLIED` / `NO_BOUNCE_SEEN` (set by the sweep, labelled as "no bounce found by <time>", never "delivered").
- **The ledger must never be a new way to stop an email.** A ledger write failure is caught, logged, alerted once per day, and the
  send proceeds (same fail-open stance as `withEmailJobLockGs_`). The ledger is evidence, not a gate.
- **Sheets, not Script Properties** (properties cap at ~9 KB per value / ~500 KB total). Idempotent appends via `appendRowOnceGs_`
  keyed on a deterministic email id (`YYYYMMDD-job-region-bucket`). Retention/prune follows the existing 90-day pattern.

## 7. Fault isolation and continuity - spec rules 1-6 against reality

| Rule | Today | Gap to close |
|---|---|---|
| 1 One error must not stop the operation | **Strong** at bucket level (17:00 loop); the smallest unit is a bucket email | Lead-level isolation inside a bucket (drop one bad lead, send the rest) is not done - decide if wanted (Q4) |
| 2 Never bypass safety checks to keep going | **Strong** (gate refuses; fail-open lock is the one deliberate exception, alerted) | Record each refusal so "why was this blocked" survives the run |
| 3 Independent processing, per-item status | P | Per-email and per-lead status rows (ledger) |
| 4 Controlled retries | P - `isAmbiguousSendErrorGs_` stops the 13:00 duplicate-fallback | Retry must consult the ledger first ("did attempt N succeed?"), record retry reason/outcome, never retry a permanent failure |
| 5 Record every disruption | G | `Incident_Log` with the 16 fields the spec lists |
| 6 Recover blocked items | G | A "blocked queue" view + `recoverBlockedEmailsNow()`: revalidate, check the sending window is still valid, send or reschedule, always end in a documented outcome |

## 8. Gaps ranked (what to build, in order of value to the stated priorities: 13:00 audit and 17:00 primary)

| Rank | Gap | Why this rank |
|---|---|---|
| G1 | Email ledger (planned / attempted / accepted / failed / blocked / excluded, with message + thread id) | Foundation: 4 of the next 5 items read it |
| G2 | Post-13:00 exception report (expected vs actual, confirmed failure vs lacking evidence) | Explicit priority #1 of the spec |
| G3 | 17:00 pre-send validation summary + post-send reconciliation | Explicit priority #2 (primary send) |
| G4 | Incident log + continuity decision per incident | Spec rule 5; also feeds G2/G3/G7 |
| G5 | Bounce + reply sweep (Gmail search, +30 min and +2 h after each job) | Turns "accepted" into evidence; unlocks the follow-up rule |
| G6 | Daily checklist A-K with GREEN/AMBER/RED/GREY auto-flags | The accountability layer; reads G1/G4/G5 |
| G7 | End-of-day report with ratio metrics (numerator + denominator stored) | The deliverable the owners read |
| G8 | Recovery queue + ledger-checked retries | Spec rules 4 and 6 |
| G9 | Leads-tab freshness / data-quality gate before the 17:00 send | Prevents "correct email about a stale world"; needs the import cadence (Q3) |
| G10 | Follow-up tracker view (due / overdue / blocked / future) and the stop-after-reply/bounce rule | Needs G5 |
| G11 | Fault-injection end-to-end tests (the spec's 8 scenarios) | The spec's own acceptance gate; written alongside each part, assembled last |
| G12 | Operating manual: the spec's 14-part document with clearly-labelled fictional sample records | Last, so it describes what is *configured*, not what is hoped |

## 9. Build plan in parts (sized to token/session availability)

Sizes: **S** one short sitting, **M** one full sitting, **L** more than one. Deploy waves exist because every `.gs` change costs the
user a manual paste + Ctrl+S; parts inside a wave are built and tested together and deployed once.

| Part | Delivers | Touches | Size | Needs |
|---|---|---|---|---|
| **EO-1a** | `Email_Ledger` + `Email_Ledger_Exclusions` and the **17:00 job** wired to them: buckets recorded PLANNED per region (one batch write), then ACCEPTED / FAILED / BLOCKED / EXCLUDED with message + thread id; skip points (unresolvable recipient, region already sent, excluded RM) recorded with reasons; **per-lead isolation (D3): a defective lead is dropped and recorded, the rest of the bucket goes**; fail-open | new `EmailLedger.gs` + `Tests_EmailLedger.gs`; `AllIssuesEmailer.gs` only (the shared sender is not touched, so the 10:00/13:00 jobs are unaffected) | L | - |
| **EO-1b** | The same ledger wiring for the **10:00 and 13:00 jobs** (and the CH-level reports) | `OvernightEmailer.gs` | M | EO-1a |
| **EO-2** | `Incident_Log` fed from `notifyOpsAlertGs_` (id, scope, continuity decision) **plus the held-alert mechanism (D2)**: alerts raised during a job are held and sent once, after the job, behind a "N of M other emails accepted" line; a whole-job failure is sent at once | `EmailLedger.gs`, `EmailInfra.gs` | M | EO-1a |
| *Deploy wave 1* | | | | |
| **EO-3** | **13:00 audit pass** (~13:35, silent when clean): expected vs actual per bucket, confirmed failure vs "no evidence", disruptions and whether unaffected emails continued. Emails Snehil only on an exception (after the rest is confirmed, D2); always feeds the 16:30 report | new `OpsAudit.gs` + tests; `EmailInfra.gs` schedule | M | EO-1a/b, EO-2 |
| **EO-4** | **17:00 pre-send validation** (eligible / excluded + reasons / defective leads dropped) and **post-send reconciliation** (~17:35, silent when clean): planned / attempted / accepted / failed / blocked / excluded / delayed; discrepancy count; late-send window to 18:30 (D5) | `OpsAudit.gs`, `AllIssuesEmailer.gs` | L | EO-1a, EO-2 |
| **EO-5** | Bounce + reply sweep: bounces matched to the ledger by recipient + time, replies by `thread_id`; sets `BOUNCED / REPLIED / NO_BOUNCE_SEEN` | new `EmailSweep.gs` + tests | M | EO-1 |
| *Deploy wave 2* | | | | |
| **EO-6** | `Daily_Checklist` stages A-K, auto-evaluated checks, GREEN/AMBER/RED/GREY, severities, "missing evidence is AMBER, never RED" | new `DailyChecklist.gs` + tests | L | EO-1..5 |
| **EO-7** | Follow-up tracker view + the "no follow-up after reply/bounce/ineligible" rule | `DailyChecklist.gs` / `LeadFollowupsStaleness.gs` read-only helpers | M | EO-5 |
| **EO-8** | **16:30 cycle report** (previous 17:00 -> today 16:30), always sent to Snehil: the spec's 25 counts and 9 rates with numerator, denominator and period; `Daily_Report` row; readiness section for the coming 17:00 (freshness, config problems, open incidents). Needs a minute field in the watchdog schedule | new `DailyReport.gs` + tests; `EmailInfra.gs` | L | EO-1..7 |
| **EO-9** | Recovery: `recoverBlockedEmailsNow()` (revalidate -> window check -> send / reschedule -> documented outcome) + ledger-checked retries (consult ledger, classify temporary vs permanent) | `EmailLedger.gs`, emailers | M | EO-1, EO-2 |
| *Deploy wave 3* | | | | |
| **EO-10** | Leads-tab freshness gate before 17:00 (D4: AMBER > 3 h, RED > 5 h of newest-lead age on a working day; row-count sanity; duplicate-id check); holds only what depends on the data | `OpsAudit.gs` | M | - |
| **EO-11** | Fault-injection E2E: invalid lead, failed email, duplicate-send risk, data-source outage, platform outage, excluded recipient, delayed follow-up, mixed batch - each mutation-proved, run at awkward clock times/zones | `Tests_EmailOps_E2E.gs` | M | EO-1..9 |
| **EO-12** | Operating manual (the spec's 14-part output) + `HANDOVER`/`OPS_CHECKLIST`/`docs/` records + deploy register | docs only | M | everything |
| *Deploy wave 4* | | | | |

Every part also carries the repo's standing obligations: the three file registrations for any new `.gs`
(`Tests_RunAll.gs`, `run-gs-tests.js` lists, live paste), `check-gs-registration.py`, `check-gs-runtime-globals.py`,
`check-catalog.py`, `check-staleness.py --fix-anchors`, a `docs/gs-modules/` record, a `HANDOVER.md` update in the same commit,
a deploy-register row, and the post-deploy `setupXxx()` for any new trigger.

## 10. Assumptions (usable baseline - nothing here blocks starting)

1. Emails stay internal; no outbound email to leads is introduced.
2. The ledger records **accepted**, never "delivered"; opens are not tracked (no tracking pixel).
3. Report recipient: Snehil only (decision D1).
4. Report times: the 16:30 cycle report (IST) is always sent and watched by the watchdog; the 13:35 and 17:35 audit passes run silently and email only on an exception (D1, D2). The watchdog's schedule table needs a minute field for the 16:30 job.
5. Severity mapping: CRITICAL = a whole job produced no email / the platform refused everything / an excluded recipient was emailed;
   HIGH = a region's bucket set failed or planned-vs-actual differs materially; MEDIUM = one bucket / one lead; LOW = administrative.
6. A ledger or report failure never blocks an email (fail open + one alert per day).
7. Nothing in this plan calls a live data-modifying function; every deploy follows the existing hash-verified paste procedure.

## 11. Questions - ANSWERED 2026-10-09 (see section 0; kept for the record)

1. **Report recipients and times** - are the defaults in assumptions 3 and 4 right?
2. **Lead-level isolation (spec rule 1)** - today a bucket email is the smallest unit: one bad address blocks that bucket, not the others.
   Do you also want a *single defective lead* dropped from a bucket while the rest of that bucket still goes out? (Higher value, more
   code; the default is bucket-level.)
3. **Leads-tab freshness** - how often is the Leads tab refreshed from Homesfy, and is there a "last imported" cell/timestamp? Without
   one I'd use the newest lead timestamp, which is weaker. (Blocks EO-10 only.)
4. **Late sends** - if the 17:00 job is blocked and recovered at, say, 17:50, send late or reschedule to next morning? Default: send
   up to 18:30, after that record "rescheduled".

## 12. First five actions (once the plan is approved)

1. Add the context argument to `sendGuardedEmailGs_` and the `Email_Ledger` writer, fail-open, with tests (EO-1 core).
2. Record `EXCLUDED/BLOCKED` at every skip point in the 10:00/13:00/17:00 code so planned-but-unsent items stop being invisible (EO-1).
3. Add `Incident_Log` fed from `notifyOpsAlertGs_` (EO-2).
4. Build the 13:35 exception report on top of the ledger, with the confirmed-failure vs no-evidence split (EO-3).
5. Build the 17:00 pre-send summary and 17:35 reconciliation (EO-4) - then deploy wave 1+2 together.

## 13. What this plan deliberately does not do

- It does not claim delivery or opens. It reports *accepted*, *bounce found*, *reply found* and says "not verifiable" for the rest.
- It does not change who gets which email, the SLA rules, or the send times. Those stay as audited in `EMAIL_AUDIT.md`.
- It does not add an outbound channel to leads, an unsubscribe mechanism, or any third-party mail service.
- It does not make the CRM-side items (phases 1, 3, 17) the system's responsibility - it only checks that the data it reads is fresh.
