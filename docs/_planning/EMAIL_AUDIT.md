# Email pipeline audit — findings, plan, re-audit

To-Do board goal: "Email pipeline audit: no empty or unjustified sends" (`g-tf-c6dda0f8f5`).
Trigger: the symptom *"a lead is reported as having an issue, but the email that goes out is
empty"*, then a request for a from-scratch audit of everything automated-email.

**Process note.** This audit was first done interleaved with drafting fixes. The fixes exist only as
an **uncommitted, undeployed draft** in the working tree (saved as a patch too); nothing is pushed
or live. This document is the written audit + plan that should be reviewed *before* any of it is
committed. Everything below was derived from the current code and from live evidence (Gmail Sent,
the production Sheet's log tabs) — not from earlier conclusions.

---

## 1. System map (what actually exists)

All automated email is **internal operations email to employees** (RMs, team leads, managers, ops,
leadership) about SLA breaches on Google leads. There are **no emails to leads/clients**, no
campaigns or sequences, no AI/LLM generation in the send path, no unsubscribe/suppression/bounce
handling, no webhooks, no queue. The "Suggested Follow-up" text comes from a keyword engine
(`FollowupEngine.gs`) or a human-typed `Lead_Followups` column. Phases of the audit brief that assume
those things are *not applicable* and are not invented here.

| Layer | Component | Role |
|---|---|---|
| Triggers (Apps Script, time-based) | `sendOvernightMorningEmails` ~10:00 · `sendOvernightFollowupEmails` ~13:00 · `sendAllIssuesEmails` ~17:00 | the three automated jobs; each is a trigger entry point wrapping `_` worker + a crash→ops-alert→rethrow |
| Eligibility | `computeSlaFlags_`, `primaryIssueGs_` (`SlaEngine.gs`); `passesGoogleNonUtmSearchGs_`, `mainRegionForGs_`; `isOpenLead_`/`isOppOrAbove_` (`Core.gs`) | which leads count as flagged; mirrors `js/core-lead-model.js` |
| Inputs | `readLeadsTab_` (whole leads tab), `buildMovementLogMapsGs_` (call baselines), `loadRmHierarchyAndEmails_`, `loadRegionRecipients_` | all read from the one production Sheet |
| Recipient resolution | `resolveRecipientEmailsForRegion_` → `resolveRecipientBucketsForRms_` (`RmHierarchy.gs`) | tl>tm>rh>ch chain → one bucket per primary; CH-level / Futwork / Loan / restricted-cc overrides |
| Content | `buildOvernightSectionOptsGs_`, `buildAllIssuesCheckpointSectionOptsGs_`, `buildOvernightFollowupSectionOptsGs_`, empty-state builders, `renderOvernightReportEmailHTML_`, `renderTwoSectionEmailHTML_` | pure builders; the HTML and a one-line plain stub |
| Checkpoint engine | `computeAllIssuesCheckpointGs_`, `filterAllIssuesCheckpoint2ForEmailGs_` | compares the 17:00 snapshot with the live sheet (Checkpoint 1 at 10:00, 2 at 13:00) |
| Send | `GmailApp.createDraft(...).send()` ×7 sites inside `withSendRetry_`; `Gmail.Users.Messages.send` (threaded 13:00 reply, raw MIME built by hand); `GmailApp.sendEmail` for ops alerts ×3 | **no validation of any kind before the provider call** |
| State | `Overnight_Log` (10:00 sends; `followup_sent_at`), `AllIssues_Log` (17:00 sends + `checkpoint1/2_json`/`_sent_at`), `Lead_Followups`, `Movement_Log` | the Sheet *is* the database; no locks, no transactions |
| Browser | `js/reports-gmail.js` (Gmail API send), `js/reports-ui.js`, `js/reports-build.js` | manual, human-clicked, confirm dialog; separate runtime |
| Stale copies | untracked folder `working files on 28th for automatic email/` (old `.gs` copies) | not code under audit; a wrong-version-paste hazard |

## 2. Actual workflow (as implemented)

1. **17:00** `sendAllIssuesEmails_`: scope = google + Non-UTM/Search, assigned in last 3 IST days,
   open, flagged → dedupe by customer → bucket by region then by resolved manager → **one email per
   bucket** → *after* each send, append one `AllIssues_Log` row incl. `issue_snapshot_json`.
   Idempotency = "region already has a row dated today" (read once at start).
2. **10:00** `sendOvernightMorningEmails_`: Section 1 = leads assigned 17:00→09:00; Section 2 =
   Checkpoint 1 of yesterday's 17:00 snapshot. Union by region then recipient → one combined email
   per bucket → *after* send, append `Overnight_Log` row (thread id) and stamp `checkpoint1_*` on
   the AllIssues rows. Idempotency = region has an `Overnight_Log` row today.
3. **13:00** `sendOvernightFollowupEmails_`: reads today's `Overnight_Log` rows (one per bucket
   thread); Section 1 = which morning-flagged leads are still flagged; Section 2 = Checkpoint 2
   from this morning's Checkpoint 1; replies **into the 10:00 thread** (raw MIME via the Gmail
   advanced service), plain-send fallback on any failure; stamps `followup_sent_at`/`checkpoint2_*`.
   Skip rule since 26 Sep: no reply when nothing is unresolved in either section.

Every state transition is a Sheet write *after* the external side effect, so the system relies on
"nothing runs twice and nothing fails halfway".

## 3. Findings

Severity = impact × likelihood. **Prod** = reproduced in real sent mail / real log data; **Code** =
proven by reading the code; **Data** = measured on the production Sheet.

| # | Finding | Sev | Evidence |
|---|---|---|---|
| F1 | **Cross-region leak in the 13:00 reply.** Checkpoint 2 is keyed by recipient email only, so a recipient who covers several regions gets *every* region's Checkpoint 2 in *each* region's reply. | **High** | **Prod.** 1 Oct, the CH-level recipient: Central thread Checkpoint 1 at 10:05 = **7** leads (one RM, Jagruti Borude); the 13:04 reply in the same thread = **68** leads across 5 RMs. Checkpoint 2 can only contain leads that were in *that thread's* 17:00 snapshot (7), so the other 61 came from the recipient's other region rows. Thane/SoBo/Central replies were 36,125 / 36,121 / 36,133 bytes — identical bodies, though their 10:00 mails were 31.8 / 8.1 / 9.3 KB. Exposure: 22 multi-region recipient-days in `AllIssues_Log`, 11 in `Overnight_Log`. Code: `loadTodaysCheckpoint1PendingGs_` + `sendOvernightFollowupEmails_` Pass 2. |
| F2 | **Fully empty 13:00 replies (both sections empty)** — the reported symptom. | High (already fixed live) | **Prod.** 26 Sep 13:04–13:06 IST, 5 buckets, ~4 KB. Fixed by `87114a3` (skip when nothing unresolved). No digest under 5 KB has gone out since. Appendix A. |
| F3 | **No last-line send gate.** 7 `createDraft().send()` sites, the raw-MIME builder and the threaded sender never check the recipient, subject, body, or that the leads an email *counts* are in the body it *sends*. The skip rules are the only protection, and they are per-call-site. | High | **Code.** `EmailInfra.gs` `withSendRetry_` takes an opaque closure; call sites in `OvernightEmailer.gs` / `AllIssuesEmailer.gs`. Why F2 was possible at all. |
| F4 | **Skip rules test object presence, not content.** `sendCombinedMorningEmail_` skips on `!section1`; a Section 1 *object with zero leads* + no active Checkpoint 1 would send a header-only digest. `notifyChLevel*` send a "0 Leads" report if `rmToLeads` lacks the CH-level RM's leads. | Med-High | **Code.** Unreachable through today's callers (buckets are non-empty by construction) but unenforced. |
| F5 | **No overlap protection.** "Already sent today" guards read log rows written *after* the send; no `LockService` anywhere in the project (grep). Two overlapping runs (manual + trigger, double-fire, a slow run) both pass the guard and send to everyone. | Med | **Code.** Observed frequency is low: 1 duplicate `Overnight_Log` pair in 787 rows (25 Aug). |
| F6 | **Premature "done" state on failure.** `checkpoint1_sent_at` / `checkpoint2_sent_at` are written *even when the send failed*; the loaders skip any row whose stamp is set, so the same-day re-run the failure alert asks for can never deliver that Section 2 (the 13:00 re-run sends a reply *without* Section 2). The 13:00 alert also says the bucket "will be retried on the next run" — the scheduled job only reads *today's* rows, so it is not. | Med | **Code.** `sendCombinedMorningEmail_` tail; `sendCombinedFollowupEmail_` `writeCheckpoint2State_`. |
| F7 | **Possible duplicate on ambiguous threaded send.** Any error from the threaded send — including a timeout where the message may already be delivered — falls through to a second, plain send. | Med | **Code.** `sendCombinedFollowupEmail_` catch. |
| F8 | **Whole-sheet re-read per bucket.** `computeAllIssuesCheckpointGs_` calls `readLeadsTab_` itself: ~30 full reads per job. Costs minutes (the 3 Oct 13:00 run took 663 s), adds timeout risk, and lets buckets — and Section 1 vs Section 2 of one email — be judged against different moments of a sheet that is re-imported underneath the run. | Med | **Code + Prod** (663 s run, 3 Oct). |
| F9 | **Two buckets on one address overwrite each other.** `section1ByEmail[key] = {…}` replaces the first bucket's leads: never emailed, never reported as "not sent". | Med | **Code.** Needs two resolved buckets with the same address (e.g. a `Region_Recipients` fallback equal to an A1's address). |
| F10 | **Log appends can duplicate.** Appends run inside `withRetry_`; a timeout that arrives *after* Sheets wrote the row triggers a retry that appends a second identical row (a duplicate `Overnight_Log` row = a duplicate 13:00 reply). | Med | **Code**, hazard reproduced in a control test. |
| F11 | **CH-level reports are unlogged** → resent on every re-run for a region that has *only* CH-level leads (the region guard needs a log row, which such a region never gets). | Med | **Code.** Not addressed by the draft. |
| F12 | **Logs don't show what happened.** `followup_sent_at`/`sent_at` are stamped with the job's start time, not the send time (3 Oct: stamped 13:01:49, reply sent 13:12; 26 Sep: 13:01:46 vs 13:04–13:06). A *skipped* bucket and a *failed/never-ran* job both leave the cell blank, and no log records why an email was skipped, what the provider answered, or how long a send took. | Med | **Prod/Data.** 2 Oct is the proof: 32 `Overnight_Log` rows, 0 stamps — the Executions list (now read) shows that run **Failed**, see F21. |
| F13 | **Plain-text part is a one-line stub** on every digest ("…Open this email in Gmail for the full breakdown") — a text-only client or preview shows no leads. | Low-Med | **Prod** (message bodies read via Gmail). |
| F14 | **No address validation; raw MIME headers from unsanitised cells.** `Manager_Directory`/`Region_Recipients` values are only trimmed; the threaded sender interpolates `to`/`cc`/`subject` straight into header lines (a line break in a cell = header injection / corrupt mail). | Low-Med | **Code.** All 7,854 real recipient/cc addresses in the production logs and directories pass a strict validator — a gate would have blocked none of them (Data). |
| F15 | **"Missing" cells render as the word `undefined`** (`esc_(String(cell))`). | Low | **Code.** |
| F16 | **A re-run after a partial failure tells the failed recipient "Already sent separately earlier today".** The region-level guard marks the whole region as sent. | Low | **Code.** |
| F17 | **`pushUnresolvedToLeadFollowups_`** appends a duplicate row per repeated lead and rewrites the whole range from a stale read (can overwrite a concurrent human edit in column F). | Low | **Code.** Duplicate part is simple; stale-write part is a millisecond window. |
| F18 | **Call baseline keyed by `client_id`.** 305 of 601 in-scope clients have more than one lead, so the "calls today" delta can compare a lead to a *sibling's* snapshot. Impact is small: only 27 of those 305 differ in `call_attempts` (8 by ≥5). Same key in the dashboard JS. | Low | **Code + Data.** Paired JS/GS decision. **Fixed as P15 (`7799e44`, 2026-10-07)**: both runtimes now key the baseline by lead id. Re-measured on the live data before the change: 37 of 764 open Google Non-UTM leads had a different baseline, 3 were wrongly NOT flagged "Behind on Today's Calls", none wrongly flagged. |
| F19 | **Browser Gmail send has no body gate** (`performGmailSend`). Manual + confirm, separate runtime. | Low | **Code.** |
| F20 | **Test mode can silently redirect or disable the real schedule.** `TEST_MODE_OVERRIDE_EMAIL_` is a mutable global; if it is left non-empty, every real email goes to one address *and* every production log write is skipped (so the idempotency guards see nothing). Scheduled runs never check it and nothing alerts. This already happened once: a 24 Sep test run's rows made the real 17:00 job skip every region and sent Checkpoint 1 to the tester. | Low-Med | **Code + history** (comments in `EmailInfra.gs`, `AllIssuesEmailer.gs`). Today it is blank (real recipients are being emailed). |
| F21 | **A whole job can fail silently, and nothing notices.** `sendOvernightFollowupEmails` on **2 Oct 13:01:45 ended `Failed` after 120 s** with the platform error *"We're sorry, a server error occurred. Please wait a bit and try again."* (logged 13:03:45). No 13:00 reply went to anyone that day, and **no ops alert email was ever received** — a search of the mailbox finds no `[Overnight Emailer]` email at all since 29 Sep. The job's own crash handler either never ran (uncatchable platform termination) or its single, un-retried alert send hit the same outage. There is no completion check anywhere (nothing verifies that today's 10:00/13:00/17:00 work happened), and the failed run left every row unstamped so nothing retries. The Triggers page shows exactly one trigger per email job (no duplicates) and a 14.29 % (1-in-7) error rate for this one. | **High** | **Prod** (Executions list + Gmail). The same day's 17:04 job completed normally. |
| F22 | **Transient platform errors are not retried.** `withRetry_` retries only `timed out`, `service (spreadsheets|gmail|error)`, `internal error`. The platform's own wording for a transient failure — *"a server error occurred. Please wait a bit and try again."* — matches none of them, so the first such error from a Sheets call aborts the whole job (very likely the 2 Oct failure). | Med | **Code + Prod.** `EmailInfra.gs` `withRetry_`. |
| F23 | **`snapshotPeriodic` hits the 30-minute execution wall.** Three `Timed Out` runs (1,802–1,803 s) in 5 days (1 Oct 00:18, 2 Oct 18:51, 4 Oct 06:08) and several other runs of 12–29 min. It feeds `Movement_Log`, whose snapshots are the "calls so far today" baseline behind the *Behind on Today's Calls* flag in every email. A timed-out snapshot leaves a partial/missing baseline. Not an email defect, but it silently feeds one. | Med | **Prod** (Executions list). Impact on specific emails unverified. **Fixed as P16 (`7799e44`, 2026-10-07)** - expected from the reads/writes removed; the live effect is NOT yet measured (see section 7). |
| F24 | **Real addresses are committed to a public repository.** The GitHub repo is public (confirmed). `EmailInfra.gs`/`RmHierarchy.gs` hold five corporate addresses in source (ops, the CH backstop, the CEO and another leader), even though the code comments say the employee-email table was deliberately kept out of the repo. | Low-Med | **Code + web.** Privacy/phishing-surface item; no functional impact. |
| F25 | **Business-rule ambiguities, not defects:** Follow-up Overdue counts raw clock hours (so every connected lead untouched since last evening is "overdue" at 10:00); Section 1 (1pm) drops a lead whose issue *category* changed while Section 2 lists it; "He said he will call back" is read as "client asked to be called back". | — | Needs an owner decision; nothing changed. |

### Why "issue reported, email empty" happened (root-cause chain)

State: a lead flagged at 17:00 is resolved by 13:00 → 13:00 job builds Section 1 empty-state + Section 2
empty-state → **no skip rule existed** (it was added 35 minutes after those sends) and **no gate
checks content**, so a header-only digest is sent; the log only records "sent at 13:01:46" with no
content indicator. Competing explanations rejected: empty body from a builder bug (all builders
return non-empty HTML; the 4 KB size is exactly two empty-state shells), provider truncation (sizes
identical across 5 buckets), stale state (the leads really were resolved).

### 3b. State machine (as implemented)

| Record | State | Entered by | Fields set | Failure behaviour today | Problem |
|---|---|---|---|---|---|
| `AllIssues_Log` row | *sent* | 17:00 job, **after** the bucket's send | row + `issue_snapshot_json` | send fails -> no row, bucket reported "not sent" | a retry that lands twice duplicates the row (F10) |
| | *checkpoint 1 done* | 10:00 job | `checkpoint1_json`, `checkpoint1_sent_at` | **stamped even if the send failed** | premature success (F6); a "nothing to send" outcome is also stamped (correct, final) |
| | *checkpoint 2 done* | 13:00 job | `checkpoint2_json`, `checkpoint2_sent_at` | **stamped even if both sends failed** | premature success (F6) |
| `Overnight_Log` row | *sent* | 10:00 job, **after** the send | thread id, recipients, subject, flagged lead ids | send fails -> no row (so no 13:00 thread to reply in) | duplicate row after a retried append (F10) |
| | *follow-up done* | 13:00 job, after a successful reply | `followup_sent_at` (job-start time) | blank on failure and on "skipped" | **stuck**: nothing retries it, and blank is ambiguous (F12/F21) |

Impossible/contradictory states reachable today: *checkpoint 2 done but no email delivered* (F6); *two
`Overnight_Log` rows for one thread/recipient* (F10); *a 13:00 reply carrying another region's leads* (F1);
*job failed but no record anywhere* (F21). States that become stuck: any row left blank by a failed 13:00 run.

### 3c. Concurrency and race audit

There is **no lock, no transaction and no unique key** anywhere; the Sheet is the database. Every guard is
check-then-act on a log row written after the side effect.

| Race | Window | Observed | Verdict |
|---|---|---|---|
| Two 10:00 (or 13:00 / 17:00) runs overlap - manual run + trigger, double-fired trigger | the whole run (2-11 min) | 1 duplicate row pair in 787 (25 Aug) | possible, rare (F5) |
| Send succeeds, process dies/times out before the log row | between `send()` and `appendRow` | none seen | a re-run would then re-send that bucket; low |
| `snapshotPeriodic` (12:44 slot, up to 30 min) overlapping the 13:01:45 job | up to 30 min | slot runs took 289-761 s, finishing before 13:01 | possible if the snapshot runs long; effect = a half-written snapshot read as baseline (hint text only) |
| Human edits `Lead_Followups` col F while the 13:00 job rewrites the range | milliseconds-seconds | none known | F17 |
| `readLeadsTab_` snapshot vs a re-import mid-run | each per-bucket re-read (F8) | job runs 4-11 min while the sheet is re-imported | buckets/sections can disagree (F8) |

Trigger inventory (live Triggers page): `snapshotPeriodic` x4 (00:18, 06:08, 12:44, 18:51 - the minute differs per
slot), `sendOvernightMorningEmails` (10:03:41), `sendOvernightFollowupEmails` (13:01:45), `sendAllIssuesEmails`
(17:04:10), `captureDailyRmIssues` (22:53), `runWeeklyOpsChecklistNow` (Mon 09:06). **One trigger per email job - no
duplicate triggers.** Email-job run times (7-day window): 10:00 job 115-181 s; 17:00 job 67-156 s; **13:00 job 120 s
(failed) / 261 / 276 / 419 / 663 s.**

### 3d. Loop / retry / recursion audit

No unbounded loop, no recursion, no queue consumer, no auto-reschedule. Every retry is bounded:
`withRetry_` 4 attempts (<=12 s); `withSendRetry_` 3 attempts for two definitive errors only (leaves one orphan
draft per failed attempt); `waitForFollowupSuggestions_` <=6 polls x 20 s (about 2 min, once per job); per-bucket
`try/catch` keeps one failure from stopping the rest. The hard ceiling is Apps Script's **30-minute** limit (proved by
`snapshotPeriodic` timing out at 1,802 s). The retry *gaps* are the findings: the platform "server error" is not
retried (F22); an ambiguous send falls through to a second send (F7); failed 13:00 work is never retried by the
schedule (F6/F21).

### 3e. Observability - can each attempt be reconstructed?

| Needed to reconstruct an attempt | Recorded? |
|---|---|
| lead ids, recipient/cc, subject, bucket | Yes (log rows + `issue_snapshot_json`) - only for sends that succeeded |
| thread id | Yes, on success |
| actual send time | **No** - job start time is stamped (F12) |
| validation result / content checked | **No** (no gate existed) |
| provider result | **No** - only "no exception"; ambiguous results are not recorded |
| skipped, and why | **No** - blank cell (F12) |
| failure reason | Only via an ops email, whose delivery is **not guaranteed and is not retried** (F21) |
| job-level outcome | Executions list only; no completion check |

The browser sender is better: it writes a `Send_Log` row per send (best-effort).

### 3f. External dependencies

| Dependency | Failure behaviour in the code | Gap |
|---|---|---|
| Gmail (`GmailApp.createDraft().send()`, advanced `Gmail.Users.Messages.send`) | timeouts are ambiguous; only "operation not allowed" / "Not found" are retried | duplicate-on-fallback (F7); orphan drafts on retries |
| Gmail quota | about 90 mails/day, each 1 To + ~4 Cc, so roughly 450 recipient-deliveries/day (estimate from the logs) | headroom against a 2,000/day Workspace limit is about 4x but unmeasured; no quota alert |
| Sheets service | `withRetry_` on timeouts/"service" errors | misses "server error occurred" (F22) |
| Apps Script runtime | 30-min cap; one platform failure on 2 Oct | no completion watchdog, no alert retry (F21) |
| Time triggers | pinned, firing 1-4 min after the hour in practice | fine |

### 3g. Security and privacy

- Dynamic text in HTML is escaped (`esc_`), including banners; plain-text parts are plain. Free-text RM comments are
  rendered escaped - they can mislead but cannot inject markup.
- Header injection in the hand-built MIME message is possible from a bad address/subject cell (F14).
- Alert emails go only to the ops address and contain lead ids, RM names and recipient addresses (no lead PII).
- The repo is public and contains five corporate addresses (F24); the OAuth client id in `reports-gmail.js` is
  public by design; the browser grant is `gmail.send` only (least privilege).
- `TEST_MODE_OVERRIDE_EMAIL_` is a mutable global: left set, every real email silently goes to one address.
  Nothing alerts when a *scheduled* run executes in test mode.

### 3h. Supporting actions audited

Eligibility (`Core.gs` stage/closed/Opp+ helpers, `SlaEngine.gs`), comment parsing (`parseDatedCommentEntries_`: an entry
needs `- YYYY-MM-DD HH:MM` or it carries no time - lead 2248179 fell back to time-since-connect), recipient routing
(`RmHierarchy.gs`, 7,854 real addresses valid), call baselines (`MovementTracker.gs`; client-keyed, F18 - fixed in P15; fed by a job that
timed out, F23 - fixed in P16), `Lead_Followups` push/wait, region mapping, the ops-alert path, the weekly checklist email (always
non-empty), the browser report builder/sender and `Send_Log`. `DailyRmIssueLog.gs` and the comment loggers send no mail.

## 4. Plan

Status column: **D** = already drafted in the working tree (uncommitted; headless `.gs` suite
1,423/1,423 passing, up from 1,254; 13 deliberate regressions each caught by a named test); **N** = not drafted.

| Step | Change | Fixes | Files | Test | Status |
|---|---|---|---|---|---|
| P1 | One **send-safety gate** (`prepareOutgoingEmailGs_` / `sendGuardedEmailGs_`): valid To/Cc, non-blank subject, non-whitespace plain body, HTML with visible text, and — for report emails — a non-empty list of claimed lead ids that **all appear in both** the plain and HTML bodies. A failure throws *before* any draft exists; callers already turn a throw into an ops alert + "not sent" entry. Route all 7 report sends + the threaded sender through it. | F3 F4 F14 | `EmailInfra.gs` + 3 emailers | unit + per-call-site + mutation | D |
| P2 | Real **plain-text body** rendered from the same opts as the HTML; blank cell renders blank. | F13 F15 | `EmailInfra.gs`, emailers | unit | D |
| P3 | **Key Checkpoint 2 by region + recipient**; one-use per key per run. | F1 | `OvernightEmailer.gs` | multi-region test incl. duplicate row | D |
| P4 | **One job lock** around the three trigger entry points; a skipped job alerts ops. | F5 | `EmailInfra.gs`, 3 entry points | lock tests | D (**needs Amendment A1**) |
| P5 | Stamp `checkpoint*_sent_at` **only on delivery** (or a deliberate "nothing to send"); definite failure stays retryable same-day; correct the alert wording. | F6 | `OvernightEmailer.gs` | fail → rerun delivers Section 2 | D |
| P6 | **No fallback after an ambiguous send**: record `unconfirmed <time>`, alert, don't resend. | F7 | `EmailInfra.gs`, `OvernightEmailer.gs` | timeout test | D |
| P7 | **Append log rows once** per thread id; **merge** buckets sharing an address; truthful "not re-sent" label; dedupe `Lead_Followups` pushes; skip a CH-level report with zero leads. | F9 F10 F16 F17(dup) F4 | emailers | per-defect tests | D |
| P8 | **One leads-tab snapshot per job**, passed to every checkpoint. | F8 | `SlaEngine.gs`, emailers | read-count test | D |
| P9 | **Observability + watchdog**: stamp the actual send time; write an explicit `skipped: nothing unresolved` marker (skipped != failed); a small **completion check** (e.g. 10:30 / 13:30 / 17:30) that alerts if today's `Overnight_Log` / follow-up stamps / `AllIssues_Log` rows are missing; make the ops alert retry once and fall back to a second send path; alert when a scheduled run executes with test mode on. | F12 F20 F21 | emailers, `EmailInfra.gs`, one new trigger | log + watchdog tests | N - needs a column/format decision and one new trigger |
| P10 | **CH-level report idempotency** (record once per day/region/CH). | F11 | emailers | rerun test | N — adds persistent state (ScriptProperties) |
| P11 | Browser `performGmailSend` body/recipient gate. | F19 | `js/reports-gmail.js` + harness | harness | N |
| P12 | Add the platform's "server error occurred" wording to `withRetry_`'s transient list (appends are already made safe to retry by P7). | F22 | `EmailInfra.gs` | retry test | N |
| P13 | Move the five committed corporate addresses out of the public repo (Script Properties / the private file). | F24 | `EmailInfra.gs`, `RmHierarchy.gs`, docs | tests keep using test addresses | N - decision |
| P14 | Docs, catalog, deploy register; **paste 9 changed `.gs` files** (4 production, 5 test) via the hash-verified procedure. If P9 is approved, run its one-time setup function so the watchdog trigger is installed; otherwise no trigger changes. | — | docs, tracker | check-catalog / check-staleness | N |
| P15 | **Per-lead call baseline.** `call_attempts` is a per-lead counter (0 of 1,852 multi-row leads differ across their RM copies); key `_readMovementLogRowsGs_` / `computeSlaFlags_` / the four emailer snapshot lookups and, in the dashboard, `buildTodayCallBaseline` / `lastSnapshotBefore` / `enrichLead` / `noCommentFollowUp` / Stalled Leads by lead id. A merged customer record carries each lead's counter and takes the best per-lead delta. Customer-level uses stay as they are. | F18 | `MovementTracker.gs`, `SlaEngine.gs`, 2 emailers, 4 `js/` files + harness | sibling-lead scenarios in every layer; 8 (`.gs`) + 13 (browser) deliberate regressions caught | `7799e44` |
| P16 | **`snapshotPeriodic` inside the 30-minute limit.** Single-column `Movement_Log` reads; prefix-delete prune (archive first, full rewrite as the fallback); core capture first and its `Movement_Log_Runs` row right after it; optional phases inside an 840 s budget (a failing prune still fails the run, at the end); `[timing]` lines; `Movement_Log_Runs` +`total_s`/`skipped_phases`; a run record + a watchdog check (stuck / failed / overdue / skipped phases, alerted once per run). | F23 | `MovementTracker.gs`, `EmailInfra.gs` | spy tests on read width / writes / deletes, slow-run and prune-failure end to end; 25 deliberate regressions caught | `7799e44` |

Out of scope / owner decisions: F24 (history), F25 and the stale untracked folder. F18 and F23 were first left out and then done as P15 and P16 (2026-10-07).

Post-deploy verification (next 3 scheduled runs): (1) no 13:00 reply in a multi-region recipient's
threads carries another region's leads and sizes differ by region; (2) no `[Overnight Emailer] … BLOCKED`
or `SKIPPED` alert unless something is genuinely wrong; (3) no digest under 5 KB; (4) 13:00 run time falls
well below 663 s.

## 5. Re-audit (of the plan and the draft)

Checks run against the draft, and what they found:

1. **Would the gate block legitimate mail?** Validated every real recipient/cc ever sent (Overnight_Log,
   AllIssues_Log), `Manager_Directory`, `Region_Recipients`: **7,854 addresses, 0 invalid.** A
   semicolon-separated list *would* be blocked (Gmail's `createDraft` wants commas) — none exist today.
2. **Could the lead-id check false-block?** Ids are digits; HTML entities are decoded before matching;
   plain and HTML both come from the same opts. A *real* block means the email counted a lead its body
   doesn't contain — exactly the bug class — and alerts ops.
3. **Region+recipient key vs. how rows are written.** Both rows carry the region key from the same
   canonical names (`mainRegionForGs_`) or the `Futwork` pseudo-region; the legacy per-region Futwork
   rows map to `Futwork` in both loaders. The full-cycle Futwork test passes.
4. **Does P5 create an infinite/auto retry?** No: nothing retries automatically; an unstamped row only
   matters to a *manual* same-day re-run. A morning failure leaves no `checkpoint1_sent_at`, so 13:00 does
   not pick that row up.
5. **P6 trade-off.** A timeout-class error now means "unconfirmed, alert a human" rather than "send again".
   A genuinely undelivered reply costs a manual re-run; the old behaviour risked a duplicate.
6. **⚠ Defect found in my own draft — Amendment A1:** `withEmailJobLockGs_` currently treats a *thrown*
   lock error as "lock not acquired" and **skips the job**. If `LockService` ever throws (e.g. an
   authorization problem after a new scope is needed), all three jobs would silently stop. Google's
   reference lists `tryLock` as returning a boolean and shows no extra scope, but I could not verify
   that live. **Required change before this is committed:** contention (`false`) → skip + alert; an
   *exception* → alert once and **run without the lock** (fail open).
7. **Cost of P1/P7.** One extra Sheets read per send (the once-only append) — ~30 small reads per job,
   against the ~30 *whole-sheet* reads P8 removes.
8. **Tests are real:** each fix was mutation-checked (revert the fix → a named test fails); the one
   mutation that survived (CH-level empty-guard) survived only because the gate backstops it, so the test
   now also asserts the first-line check stays silent.
9. **Untested:** the live paste, real `LockService`/Gmail behaviour, and the real 11-minute run profile
   — covered only by the post-deploy checks above.

## 6. Decisions needed from you

1. Approve P1–P8 (drafted) with Amendment A1, as one commit, then deploy to the live Apps Script project.
2. P9 (log the real send time, an explicit "skipped" marker, and a completion watchdog that alerts when a job didn't finish): OK to add a column to `Overnight_Log` and one new trigger?
3. P12 (retry the platform's "server error", tiny) — include now? P10 (CH-level idempotency), P11 (browser gate) and P13 (move the five addresses out of the public repo): now or later?
4. The three business rules in F25 — leave as is, or decide each?

## 7. Status — deployed 2026-10-07

Steps P1–P13 are implemented, committed (`docs/_planning/EMAIL_AUDIT.md` plan table) and **live in the Apps Script
project** as of 2026-10-07 ~14:35 IST: the six production files match repo `c416a01` (`83be0fe` for `SlaEngine.gs`),
verified by hash after a server reload. Verified live afterwards: `showEmailConfigNow()` — every address resolves from the
private employee table; `showEmailJobRunsNow()` — Script Properties readable, no authorization prompt.

Still open:

| Item | Why | Who / when |
|---|---|---|
| Run `setupEmailJobWatchdogTrigger()` once | installs the ONE hourly watchdog trigger. Deliberately not run on 2026-10-07: the 10:00 and 13:00 jobs ran before run records existed, so the first hourly check would have flagged them "did not run" | Snehil — any time after midnight and before ~10:00 IST |
| Paste the changed `Tests_*.gs` + create `Tests_EmailLifecycleFullCycle.gs` live | optional; lets `runAllTests()` run in the editor (it fails today with a ReferenceError — the full-cycle file was never in the live project). Expected 1914/1914 on the repo after P15/P16 and the e2e | Snehil, optional |
| Watch the first real runs | 17:04 today (All-Issues), 10:03 and 13:01 tomorrow: Executions `Completed`; `Overnight_Log.followup_result` filled for each 13:00 row; no WATCHDOG email once the trigger exists | Claude can read the Executions list on request |
| P15 + P16 live | F18 (per-lead call baseline) and F23 (`snapshotPeriodic` vs the 30-minute limit) are committed (`7799e44`) but NOT yet in the live Apps Script project: paste `MovementTracker.gs`, `SlaEngine.gs`, `OvernightEmailer.gs`, `AllIssuesEmailer.gs`, `EmailInfra.gs`. The dashboard half of F18 is live when GitHub Pages deploys | Claude can stage them in the editor; Snehil saves |
| Measure P16 | after the first scheduled `snapshotPeriodic` runs (00:18, 06:08, 12:44, 18:51 IST): read the `[timing]` lines in the Executions log and `Movement_Log_Runs.total_s`; expect minutes (was 209-1,803 s) and an empty `skipped_phases`. If a run still skips phases, the `[timing]` lines say which phase is the slow one | Claude can read the Executions list on request |
| F24-in-history, F25 | owner decisions / out of scope: the corporate addresses remain in git history (not rewritten), F25 business rules (left as is) | — |

## 8. End-to-end verification of P15 + P16 (2026-10-07)

What was run, and what it can and cannot tell you.

**Apps Script chain** (`Tests_EmailLifecycleFullCycle.gs`, `TestEFC_runSnapshotChain_`, 53 assertions): the real
`snapshotPeriodic()` writes `Movement_Log` / `Movement_Log_Runs` / `SLA_History` and its run record; the real 17:00 and 10:00
jobs read what it wrote; a second capture, the prune and four watchdog situations follow. Two sibling leads of one customer
(counters 13 and 4 -> 9) are the F18 trap; controls cover no-calls, many-calls and created-today leads. Result: the
sibling's email row is "Stuck 48h+" with "5 more call attempts" (its own baseline), the no-calls lead is "Behind on Today's
Calls", the many-calls lead says "6 more call attempts"; `SLA_History` after the second capture counts 2 under-called (it
would read 3 if it used the run's own rows as a baseline); the prune removes the 4 expired rows with one `deleteRows` after
archiving them.

**Browser chain** (`tests/frontend-harness.html` section 7, 8 assertions): a second real `fetchAndRender()` over a
`Movement_Log` in the Sheets-API shape; asserts the baselines, the rendered "Behind on Today's Calls" list and the shared
per-lead table (the same one the Apps Script e2e asserts).

**Robustness:** the whole `.gs` suite (1914) passed at 13 simulated clock times (IST midnight +-, 01:30, 03:00, 08:59:50,
10:03, 13:01, 17:04, 18:51, a Saturday, a Sunday after midnight) and in 4 time zones (IST, UTC, Los Angeles, Auckland) and
combinations around IST midnight; the browser harness (267) in the same 4 zones. The sweep found one old fixture that was
only clean at some hours (`Tests_OvernightEmailer.gs`'s `midWindow`, fixed). **Regressions:** 14 chain mutations on the
Apps Script side and 7 on the browser side each fail an `E2E` assertion on their own.

**First live `runAllTests()` (2026-10-07 17:54 IST, after the paste):** 14 suites clean, including every new F18/F23 test run
on the real platform (`Tests_MovementTracker.gs` 224/224). Three suites (`EmailInfra`, `OvernightEmailer`,
`EmailLifecycleFullCycle`) threw `atob is not defined` - a TEST helper used a browser/Node-only function that Apps Script does
not have, invisible to every local and CI run. Fixed (pure-JS decoder) and a permanent guard added
(`test/check-gs-runtime-globals.py`). The live total was therefore 1020 passed with 3 suites cut short, not the 1914 the repo
reports; the corrected `Tests_OvernightEmailer.gs` has to be pasted for the live number to match.

**Not covered - only the live system can show it:** the real speed-up of `snapshotPeriodic` (the platform's 30-minute limit,
real Sheets read/write cost - the run is expected to take minutes, not measured); real `LockService`, Gmail and Drive
behaviour; real `deleteRows` on a ~48K-row sheet; whether the live editor's pasted files equal the repo (checked by hash after
saving, then `runAllTests()` live). After the paste, the live checks are read-only: reload and re-hash all files, run
`runAllTests`, run `showEmailJobRunsNow` / `showEmailConfigNow`, and read the first scheduled `snapshotPeriodic` run's `[timing]`
lines and `Movement_Log_Runs.total_s`.

---

## Appendix A — A0: the reported symptom in real sent mail (2026-10-05)

Five 1pm follow-up replies went out 13:04–13:06 IST on 26 Sep with **zero leads in both sections**
(~4.0 KB vs ~7 KB): Thane/Swapnil Gowalkar (thread `1a0dc00606271e1d`, reply `1a0dca48ac6fc29b`),
Western/Minas Patel (`1a0dca4af844940e`), Navi Mumbai/Sampada Pawar (`1a0dca3791d6299a`),
Harbour/Akash A Ugale (`1a0dca339067638c`), Bangalore/Mainuddin T (`1a0dca2ca388f42d`). Section 1
"Nothing still unresolved from this morning — all clear."; Section 2 "Nothing changed since this
morning's Checkpoint 1". The 10:06 mail for the same thread had listed leads (Thane: 2243943, 2242023);
both were resolved by 1 PM. `Overnight_Log.followup_sent_at` = 13:01:46 on 29 of 30 rows that day, with
no content indicator. Commit `87114a3` (26 Sep 13:40 IST) added the skip; a Gmail search for digests
under 5 KB over 60 days finds none after 26 Sep.

3 Oct 13:12 Thane (Swapnil): Section 1 empty, Section 2 one lead (2248179) — sent legitimately: that
lead had one 5-minute call on 1 Oct 17:04 and `call_attempts` is still 1 (comments undated, so the
4-hour rule fell back to time-since-connect; it left the "under 48 h" window at 17:02 on 3 Oct, which is
why the 17:04 report relabelled it "Behind on Today's Calls").

Other measurements: `AllIssues_Log` 1,122 rows, 0 with `lead_count` = 0, 0 with blank `sent_at`; 25 Sep
07:34Z the 13:00 job crashed on the 50,000-character cell limit (hardened in `b3a58f9`).
Limits: size (<5 KB) only surfaces *small* empties. The Apps Script Executions list (7 days) and Triggers page were
read afterwards — see F21-F23 and sections 3c-3d; Cloud logs beyond the one expanded error line were not.
