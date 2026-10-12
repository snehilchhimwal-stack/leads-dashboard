# Code audit D - the 17:00 All-Issues emailer and the Email Ops reporting layer

Auditor D, 2026-10-10. Line-by-line read of the working tree at `19038e7`. No code was changed; nothing was run against the live Sheet, Gmail or Apps Script.

## 1. Scope and summary

**Files read in full, every line:** `AllIssuesEmailer.gs` (844 lines), `CycleReport.gs` (381), `EmailSweep.gs` (285), `OpsAudit.gs` (336), `DailyChecklist.gs` (187), `FollowupTracker.gs` (175).
**Helpers read only where needed:** `EmailLedger.gs` (lines 1-510: ledger, recovery driver, replace-day-block), `EmailReroute.gs` (195-428: the bounce hand-off), `EmailInfra.gs` (`notifyOpsAlertGs_`, `sendGuardedEmailGs_`, held alerts, the job lock, run records, the watchdog's `emailJobProblemsGs_`), `OvernightEmailer.gs` (the `Overnight_Log` header and the Section-2-only logging rule). Also `HANDOVER.md` sections 4.3.4/4.3.5 and `docs/EMAIL_OPS_OPERATING_MANUAL.md`.

**Summary.** `AllIssuesEmailer.gs` is the 17:00 primary send. It reads the Leads tab once and keeps open Google Non-UTM/Search leads assigned in the last 3 IST calendar days that trip one of the 5 SLA checks. It collapses duplicate customers, groups by region (Futwork RMs share one pseudo-region), resolves each region's RMs into manager buckets and sends one guarded email per bucket. Every bucket is recorded in `Email_Ledger` (PLANNED -> ATTEMPTING -> outcome), and one `AllIssues_Log` row is written per accepted bucket. That row is what the next day's 10:00/13:00 checkpoints read. The other five files are the Email Ops reporting layer, and none of them sends to a manager. `EmailSweep.gs` finds bounces (four times a day) and replies (15:30) for accepted emails and hands bounces to `EmailReroute.gs`. `OpsAudit.gs` runs three silent checks (about 11:15, 14:00 and 18:00) that compare the ledger with the working logs the next job relies on. `CycleReport.gs` is the 16:30 daily report to the ops address. It embeds `DailyChecklist.gs` (stages A-K) and `FollowupTracker.gs` (Checkpoint 1/2 status per 17:00 bucket). The code is careful and fail-open throughout. The real defects found:
- the 16:30 report's window doubles to about 48 hours whenever its trigger fires before 16:30, which its own comment says can happen;
- a bounce matcher (with its reroute consumer) that probably attributes one bounce to other emails that share a Cc, and re-routes healthy Cc addresses;
- the sweep's whole-block write races with the 17:00 job's ledger prune and its unlocked appends;
- a sticky-status gap that downgrades BOUNCED to UNKNOWN;
- a recovery run that re-reports every region's unroutable leads;
- a cluster of stale comments and doc statements.

---

## 2. Per-file reference

Conventions: "IST" means every day key goes through `istDayKeyGs_` (`Core.gs:182`, `Utilities.formatDate(d,'Asia/Kolkata','yyyy-MM-dd')`), and wall-clock instants are built as `new Date(dayKey + 'THH:MM:00+05:30')`. None of these files uses the machine's or browser's local zone. "TEST MODE" means `TEST_MODE_OVERRIDE_EMAIL_` is non-blank: `writeUnlessTestModeGs_` (`EmailInfra.gs:194`) skips every production write, `emailLedgerOpenGs_` returns `null` (every ledger call becomes a no-op), and `runEmailJobTrackedGs_` sends a "ran in TEST MODE" alert and writes no run record.

### 2.1 AllIssuesEmailer.gs

**Purpose.** The daily 17:00 IST "Leads With Issue" email per manager bucket, plus CH-level reports to ops, the EO-9 recovery of failed buckets, the trigger installer and a one-off clean-up of the 2026-09-24 test-mode rows.

**Constants.**
| Name | Line | Value / meaning |
|---|---|---|
| `ALL_ISSUES_LOG_SHEET_` | 62 | `'AllIssues_Log'` |
| `ALL_ISSUES_WINDOW_DAYS_BACK_` | 73 | 2 (today + 2 previous full IST days) |
| `ALL_ISSUES_RUN_HOUR_` | 74 | 17 (also read by `emailJobScheduleGs_` for the watchdog) |
| `ALL_ISSUES_LATE_CUTOFF_HOUR_/MINUTE_` | 77-78 | 18:30, recovery cutoff (decision D5); also read by `emailRerouteWindowOpenGs_` |
| `EMAIL_RECOVERY_JOB_` | 718 | `'recoverAllIssuesBuckets'`, the lock/run-record name of the recovery; it is in `EMAIL_ALERT_HOLD_JOBS_`, so its alerts are held |
| `TEST_MODE_ROWS_FROM_/TO_/EXPECTED_` | 793-797 | 2026-09-24 10:00-10:30 IST, 28 rows (one-off clean-up) |

**`AllIssues_Log` columns** (A-N): `date` (the run's `now`, a Date), `region`, `bucket_label`, `primary_role`, `to`, `cc`, `lead_count`, `sent_at` (Date of the write), `thread_id`, `issue_snapshot_json`, `checkpoint1_json`, `checkpoint1_sent_at`, `checkpoint2_json`, `checkpoint2_sent_at`. This job writes A-J; K-N are written by the 10:00/13:00 jobs.

**Functions, in file order.**

- **`allIssuesWindowGs_(asOf)` :89** returns `{from, to}`. `from` = IST midnight of today minus 2 x 24 h (so 00:00 IST two days ago); `to` = `asOf`. This is a calendar-day window, not a rolling 48 h (the comment explains the 2026-08-28 undercount bug). IST-correct, because India has no DST so the 24 h arithmetic is exact.
- **`allIssuesDateRangeLabelGs_(win)` :99** returns `'(dd-MMM-yyyy to dd-MMM-yyyy)'` formatted in IST. Used in both subject builders.
- **`ensureAllIssuesLogSheet_(ss)` :135** wraps `ensureAllIssuesLogSheetOnce_` in `withRetry_` (added after the 2026-10-10 first-run crash). Idempotent.
- **`ensureAllIssuesLogSheetOnce_(ss)` :138** creates the tab with headers and a frozen row 1. On an existing tab it appends any missing header names after the last column, in canonical order. It never reorders. Note that the readers in OpsAudit/FollowupTracker hard-code column positions (9 = thread_id, 12 = cp1, 14 = cp2), which is valid only if the live tab was created or healed in canonical order.
- **`sendAllIssuesEmails()` :172** is the trigger entry point. `withEmailJobLockGs_('sendAllIssuesEmails', ...)` takes one script-wide lock, waiting 30 s; if another job holds it, the run is skipped with an alert and not retried. Inside the lock, `runEmailJobTrackedGs_` writes the run record `EMAIL_JOB_RUN_sendAllIssuesEmails` (running -> completed/failed) and starts the alert hold (EO-2). Any throw from `sendAllIssuesEmails_` produces an **immediate** ops alert "crashed - NO All-Issues emails were sent this run", and the error is re-thrown so Executions shows Failed.
- **`sendAllIssuesEmails_(opts)` :196** is the run itself. `opts.onlyEmailIds` (`{emailId:true}`) is set only by recovery. Step by step:
  1. `now`, `win = allIssuesWindowGs_(now)`; `readLeadsTab_` (once); `loadRegionRecipients_` (legacy fallback); `loadRmHierarchyAndEmails_` (once, retried); `buildMovementLogMapsGs_` (one `Movement_Log` read giving `baselineMap`, `lastSnapshotMap`, `lastChangeMap`).
  2. Candidate scan (243-281). Each row goes through these gates in order: has a `lead_id`; `passesGoogleNonUtmSearchGs_(group_source, source_bucket)`; `lead_assigned_at` is a **real Date** in `[win.from, win.to]` (a text date is silently dropped); `mainRegionForGs_(region)` is one of the configured regions; `isOpenLead_`; `computeSlaFlags_(row, colIndex, now, baselineMap)`; `primaryIssueGs_` is non-null. Each surviving lead is pushed as `{identityKey: client_id || 'l:'+lead_id, stageRank, region, lead_id, RM ('Unassigned' if blank), TL, status, issueLabel, followup (overnightFollowupHintGs_ with the per-LEAD snapshot), staleSince (staleSinceOfRowGs_)}`.
  3. Dedupe by `identityKey` (283-293). A later copy replaces the kept one only if its `stageRank` is strictly higher; on a tie the first copy wins.
  4. `byRegion` keyed by `regionKeyForRmGs_(RM, region)`, so every region's Futwork RMs share the key `FUTWORK_REGION_KEY_`.
  5. `ensureAllIssuesLogSheet_`, `dateLabel`, `todayKey`; `ledger = emailLedgerOpenGs_(ss)` (null in TEST MODE). `exLedger` is null in recovery, so recovery writes no exclusion rows except gate-dropped leads.
  6. Region guard (317-326). Reads `AllIssues_Log` columns A:B and marks every region with a row whose IST day of col A is today. In the loop (335), a guarded region is skipped unless TEST MODE or recovery, and a `kind:'region'` exclusion is written.
  7. Per region, in sorted order (332-419):
     - `emailLedgerSplitLeadsGs_` gives `valid` / `defective`. Defective means no id, a control char or id > 100 chars, a blank issue label, or a duplicate id (`covered:true`). Non-covered defects go to `failedLeadEntries`; all defects become exclusion rows.
     - `resolveRecipientEmailsForRegion_(..., {fireAlerts:false, rmToLeads, dateLabel, hierarchyData})` returns `results` (buckets `{to, cc, bucketLabel, primaryRole, rmNames, source, originalTo?, originalCc?}`), `chLevelRms` and `trulyUnresolved`.
     - `notifyChLevelIssuesGs_` is called (not in recovery).
     - Truly unresolved RMs' leads go to `failedLeadEntries` and exclusion rows.
     - Buckets get `emailId = emailLedgerIdGs_('allIssues17', todayKey, region, primaryRole, bucketLabel)`. In recovery, only targeted ids are kept and marked `recoveredSeen`.
     - `emailLedgerPlanGs_`: ONE append of PLANNED rows for every bucket with leads. A pre-existing id (a re-run or recovery) keeps its row and attempt count.
     - Per bucket, `sendOneAllIssuesEmail_` runs with `ledgerCtx {ledger, emailId, dropped:[], isRetry:false}`. Gate-dropped leads go to `failedLeadEntries` and exclusions (with `emailId`). On failure, the remaining (non-dropped) leads go to `failedLeadEntries` with the failure reason.
  8. Recovery epilogue (420-425): every targeted id not produced this run is set `SKIPPED` with a reason.
  9. `notifyLeadSendFailuresGs_(failedLeadEntries)` sends one "Leads NOT sent" report (held until job end). Then `pruneEmailLedgerGs_` (90-day retention; archives to Drive, then `deleteRows(2, n)` on both ledger tabs) and `emailLedgerFinishGs_` (one LOW note if any ledger write failed).

  Writes: `AllIssues_Log` (append per accepted bucket), `Email_Ledger`, `Email_Ledger_Exclusions`, Script Property `EMAIL_CH_REPORTS_allissues` (via `markChReportSentGs_`). Reads: Leads tab, `Region_Recipients`, `RM_Hierarchy`, `Manager_Directory`, `Movement_Log`, `AllIssues_Log` A:B.
- **`notifyChLevelIssuesGs_(region, chLevelRms, rmToLeads, win, ledger)` :447** handles CH-tier RMs (self-holding, or a chain that resolves all the way up). It groups them by CH and builds subject `'<CH> (<real role>) google Leads With Issue (<range>)'`. The banner reads "Sent to Ops - not to <CH>". It skips when there are no leads, and skips when `wasChReportSentTodayGs_('allissues', region, ch)` is set. The body is a report with one section per RM; stale leads are moved to a bottom block (`splitStaleSectionsGs_`), and the plain text comes from the same opts. The send goes through `emailLedgerTrackSendGs_` (ledger job `chLevel17`, id `yyyymmdd|chLevel17|region|role|CH`, to `chLevelReportToGs_()` = ops[,CH-level address]) and `sendGuardedEmailGs_` with the lead ids. On success it calls `markChReportSentGs_`. On error it only logs, and alerts ops **only** when `e.blockedByGuard` (see finding D-9).
- **`sendOneAllIssuesEmail_(ss, logSheet, region, rec, leads, dateLabel, todayKey, now, win, ledgerCtx)` :551** returns `null` on success or `{reason}`.
  - Groups the leads by RM. Subject: `bucketLabel + ' (' + (Futwork ? region list : primaryRole) + ') google Leads With Issue ' + range`.
  - A TEST MODE banner is added when `rec.originalTo` is set. Futwork gets per-region sections.
  - The subtitle is the window in IST. Stale leads are split to the bottom. Plain body = one-line summary + `plainTextReportGs_` of the same opts.
  - `emailLedgerAttemptGs_` sets ATTEMPTING and attempts++ (and clears any reroute note), then `sendGuardedEmailGs_({to, cc, subject, plainBody, htmlBody, leadIds})`. Inside that call, `emailRerouteApplyGs_` may swap a dead address, then the gate runs, then `createDraft().send()` with retry.
  - On a throw: if the gate objected to specific `missingLeadIds` (and this is not already the retry, and some leads remain), the objected leads go to `ctx.dropped` and the function recurses **once** with the remainder (`isRetry:true`; attempts becomes 2). Otherwise it classifies the error (gate / "operation not allowed" / other), sends an ops alert (held), records the ledger result via `emailLedgerStatusForErrorGs_` (BLOCKED / UNCONFIRMED for an ambiguous error / FAILED) and returns `{reason}`.
  - On success: ledger ACCEPTED with message and thread ids (recorded **before** the log write). Then `appendRowOnceGs_` writes the `AllIssues_Log` row with key column index 8 (the thread id) inside `writeUnlessTestModeGs_`. A failed log write is only logged; OpsAudit's ACCEPTED_WITHOUT_LOG check later catches it.
- **`sendAllIssuesEmailsNow()` :711** manual alias of the trigger function (lock + run record).
- **`allIssuesRecoveryTargetsGs_(ss, now)` :721** returns today's `allIssues17` ledger rows with status FAILED, BLOCKED or PLANNED (`EmailLedger.gs:57`).
- **`allIssuesLateCutoffPassedGs_(now)` :725** returns true after 18:30 IST of `now`'s IST day.
- **`recoverFailedAllIssuesBuckets_(opts)` :730** calls the shared `emailRecoverBucketsGs_`. If there are no targets it logs and returns. If the cutoff has passed and `force` is not set, it refuses. Otherwise it runs `sendAllIssuesEmails_({onlyEmailIds})`.
- **`recoverFailedAllIssuesBucketsNow()` :737 / `...ForceNow()` :741** run under `withEmailJobLockGs_('recoverAllIssuesBuckets')`, the same script-wide lock, so a live job's PLANNED rows are never mistaken for abandoned ones.
- **`setupAllIssuesEmailTrigger()` :770** deletes the handler's existing triggers, then creates `atHour(17).nearMinute(0).everyDays(1).inTimezone('Asia/Kolkata')`.
- **`testModeRowsRecipientGs_()` :796** returns `opsAlertEmailGs_()`.
- **`removeTestModeAllIssuesRowsNow()` :798** one-off; calls the next function.
- **`removeAllIssuesLogRowsInWindowGs_(ss, from, to, recipient, expectedCount)` :802** deletes only when all of these hold: header A=`date` and E=`to`; matching rows (Date in window AND `to` equals recipient) form one contiguous block; the count equals `expectedCount`; the Drive CSV archive is created and its ISO-timestamp line count matches. Idempotent: a second run finds 0 rows.

### 2.2 CycleReport.gs

**Purpose.** The EO-8 daily report: one email to the ops address near 16:30 IST, built only from the evidence tabs, plus one `Daily_Report` row per IST day.

**Constants.** `CYCLE_REPORT_JOB_ = 'sendEmailCycleReport'` (:27); `CYCLE_REPORT_HOUR_/MINUTE_ = 16/30` (:28-29); `CYCLE_REPORT_SENT_PROPERTY_ = 'EMAIL_CYCLE_REPORT_SENT_DAY'` (:30); `CYCLE_REPORT_MAX_ROWS_ = 30` (:31); `CYCLE_REPORT_DAILY_SHEET_ = 'Daily_Report'` with 21 headers (:33-35); text column 1 (:36); `CYCLE_REPORT_JOB_ORDER_ = [allIssues17, chLevel17, morning10, chLevel10, followup13]` (:37). Other jobs, such as `reroute`, are appended after those.

**Functions.**
- **`showEmailCycleReportNow()` :21** builds the report for now and logs its subject and plain body. Sends nothing, writes nothing (it does read the Leads tab).
- **`cycleReportWindowGs_(now)` :40** sets `todayAt` = 16:30 IST of `now`'s day. `lastBoundary` = `todayAt` if `now >= todayAt`, else yesterday 16:30. Returns `{start: lastBoundary - 24h, end: now}`. **Before 16:30 the window spans about 48 h** (finding D-1).
- **`cycleReportInWindowGs_(value, win)` :47** true when `value` is a Date inside `[start, end]`; any non-Date is excluded.
- **`cycleRateGs_(n, d)` :52** returns `"n of d (p%)"`, or `'n/a'` when d <= 0.
- **`cycleReportDataGs_(input)` :58** pure.
  - Filters ledger rows by `planned_at`, exclusions by `recorded_at` and incidents by `detected_at` (all three in the window).
  - Counts per job and in total: planned / accepted (+`leads_sent`) / skipped / failed / unconfirmed / blocked / **unfinished** (anything else: PLANNED, ATTEMPTING, blank).
  - For ACCEPTED or UNCONFIRMED rows: `bounce_status` starting with `BOUNCED` adds to `sweep.bounced`. It is "re-routed" when an ACCEPTED ledger row `RR|<email_id>` is in the window or an `Email_Reroutes` row with note `'cc only'` names it as source; either way it is an attention row (BOUNCED - RE-ROUTED or BOUNCED). `NO_BOUNCE_SEEN` adds to `noBounce`; anything else (blank or UNKNOWN) adds to `notSwept`. `REPLIED*` adds to `replied`. `lastSweep` = the max `swept_at`.
  - Every row not ACCEPTED/SKIPPED is an attention row. An UNCONFIRMED row that bounced is therefore listed twice (finding D-13).
  - Exclusions are counted per kind and grouped by reason with digits replaced by `#` and the text cut at 90 chars.
  - Incidents are counted by severity; `serious` = severity is not LOW. `heldNow` = rows read (from the start day on) with notification `HELD`.
  - Freshness AMBER/RED adds an attention row. `allClear` = planned > 0 AND no attention AND no serious incidents.
  - `reroutes` keeps only rows still active at `win.end`.
  - It then builds `followups` (only if the caller passed `followupLog`; `null` means unreadable; `cycleDay = istDayKeyGs_(win.start)`) and `checklist`. Each is wrapped in try/catch, so the report is unaffected if either fails.
- **`cycleReportRenderGs_(data, now)` :154** pure. Subject: "no emails recorded in this cycle", or "all clear (A of P emails accepted by Gmail[, S had nothing to send])", or "N need attention (...)" where N = attention rows + serious incidents. Sections, in order: What went out (per-job table plus an "All emails" row); Bounces and replies; Re-routed addresses in force; Replies received; Needs attention (max 30); Left out of emails; Incidents; the follow-up tracker sections; the Daily checklist; Ready for 17:00? (config problems, held alerts, Leads tab freshness, "not tracked yet"). Also KPI tiles, the execution rate `accepted / (planned - skipped)`, and the same opts rendered to HTML and plain text.
- **`cycleFreshnessLevelGs_(ageHours)` :253** delegates to `leadsFreshnessLevelGs_` (EmailInfra: 3 h AMBER, 5 h RED).
- **`cycleLeadsFreshnessGs_(ss, now)` :256** does a full `readLeadsTab_` and `leadsFreshnessFromRowsGs_`; any error gives `UNKNOWN` with the error text.
- **`cycleReportRecordDailyGs_(ss, data, now)` :266** does nothing in TEST MODE. Otherwise it ensures the `Daily_Report` tab (header verified; it throws, and is swallowed, on a mismatch). If the last row's day equals today it overwrites that row, else it appends. All in a try/catch.
- **`cycleReportRerouteRowsGs_(ss)` :287** returns `emailRerouteReadEntriesGs_` rows, or `[]`.
- **`cycleReportJobProblemsGs_(now)` :292** returns `emailJobProblemsGs_(now)` (the watchdog's view, for checklist stage A), or `null`.
- **`cycleReportAuditsGs_()` :297** returns `{morning, followup, allIssues}` from the `EMAIL_AUDIT_LAST_<job>` properties.
- **`buildEmailCycleReportGs_(ss, now)` :305** reads `Email_Ledger`, `Email_Ledger_Exclusions` and `Incident_Log` from `startKey = istDayKeyGs_(win.start)` onwards (`emailLedgerReadRowsGs_` assumes the day column is ascending). It also gathers config problems, freshness, job problems, audits, `followupTrackerReadLogGs_(ss, startKey)` and reroutes, then renders. Returns `{subject, html, plainBody, data}`.
- **`sendEmailCycleReport_(opts)` :326** skips if the property `EMAIL_CYCLE_REPORT_SENT_DAY` equals today's IST day (unless `force` or TEST MODE). It builds the report and sends it via `sendGuardedEmailGs_` to `TEST_MODE_OVERRIDE_EMAIL_ || opsAlertEmailGs_()`, with no `leadIds`, so there is no lead check. It sets the property only after a successful send, then records `Daily_Report`, `Daily_Checklist` and `Followup_Tracker` (each fail-open; TEST MODE writes nothing).
- **`sendEmailCycleReport()` :352** is the trigger entry point: `runEmailJobTrackedGs_` (a run record, **no** lock, on purpose: a 16:15-16:45 fire must not make the 17:00 job skip). A crash produces an immediate alert and a re-throw.
- **`sendEmailCycleReportNow()` :364** sends again with `force:true` (run record, no crash alert).
- **`setupEmailCycleReportTrigger()` :369** deletes and re-creates `atHour(16).nearMinute(30)` IST.

### 2.3 EmailSweep.gs

**Purpose.** EO-5/EO-13: fill `bounce_status`, `reply_status` and `swept_at` for accepted emails of the last 3 days, alert on new bounces and hand every bounce to `EmailReroute.gs`.

**Constants.** `EMAIL_SWEEP_JOB_` (:34); full sweep 15:30 (:35-36); `EMAIL_SWEEP_SLOTS_` (:38) = bounce-only handlers `sweepBouncesAfterMorning` 10:30, `...AfterFollowup` 13:30, `...AfterAllIssues` 17:30 (each slot's `job` is its run-record and watchdog name); `LOOKBACK_DAYS_ 3`; `MIN_AGE_MINUTES_ 10`; `MAX_RUN_MS_ 270000` (4.5 min); `BOUNCE_QUERY_ 'from:(mailer-daemon OR postmaster) newer_than:3d'`; `BOUNCE_MAX_THREADS_ 100`; `QUICK_BOUNCE_MS_ 15 min`; `OWN_NAME_ 'homesfy lead ops'` (the display name `sendGuardedEmailGs_` uses).

**Functions.**
- **`showEmailSweepPlanNow()` :24** logs how many rows the next sweep would examine, then `showEmailReroutesNow()`. Reads no mail.
- **`emailSweepAddressesGs_(text)` :53** splits on commas, trims and lower-cases.
- **`emailSweepIsCandidateGs_(row, now)` :58** status ACCEPTED or UNCONFIRMED, `finished_at` is a Date, and age is between 10 min and 3 days.
- **`emailSweepMatchBounceGs_(row, bounces, extraRecipients)` :68** checks each bounce in turn. The bounce time must be in `[finished - 60 s, finished + 24 h]`. The bounce subject+body (lower-cased, whitespace collapsed) must contain **any** of the row's To/Cc/effective (rerouted) addresses as a substring. Then the row's subject (first 50 chars) must appear in that text **or** the bounce must have arrived within 15 min of the send. The first match is returned. See finding D-2.
- **`emailSweepIsOwnGs_(from, ownAddress)` :85** the From contains the display name or the effective user's address.
- **`emailSweepIsBounceSenderGs_(from)` :90** matches `/mailer-daemon|postmaster/i`.
- **`emailSweepRepliesGs_(row, messages, ownAddress)` :94** counts messages strictly after `finished_at` that are not our own and not bounces; returns `{count, latest}`.
- **`emailSweepStampGs_(date)` :107** IST `'yyyy-MM-dd HH:mm'`.
- **`emailSweepReadRowsGs_(sheet, now)` :112** ledger rows from the IST day of `now - 4 days` onwards (the tail; contiguous).
- **`emailSweepOwnAddressGs_()` :119** `Session.getEffectiveUser().getEmail()`, or `''`.
- **`emailSweepFetchBouncesGs_(state)` :124** runs one `GmailApp.search` (at most 100 threads) and returns every message whose sender is a bounce sender, as `{at, subject, body: getPlainBody()}`. On error it records the error and sets `bounceSearchFailed`.
- **`emailSweepFetchThreadGs_(threadId)` :142** returns `[{from, date}]`, or `null` on error.
- **`sweepEmailBouncesAndReplies_(opts)` :154** the run. `opts.bouncesOnly` is used by the three slot checks.
  1. Read the rows; `due` = the candidates; return early if there is nothing to do.
  2. Fetch the bounces once; own address (full sweep only); `Email_Reroutes` rows (fail-open).
  3. Build `block` = the existing `[bounce, reply, swept]` of **every** row read (rows that are not due keep what they had).
  4. For each due row, until the time budget runs out:
     - match a bounce, giving `BOUNCED <time>`, `UNKNOWN (the bounce search failed)` or `NO_BOUNCE_SEEN`. A matched row goes to `bouncedItems`; it is a "new bounce" only if its old status did not start with `BOUNCED`;
     - bounce-only mode: write only the bounce status and keep reply/swept;
     - full mode: read the thread (cached per thread id), giving `REPLIED n (latest t)`, `NO_REPLY_SEEN`, `UNKNOWN (thread could not be read)` or `UNKNOWN (no thread id recorded)`, and stamp `swept_at`.
  5. ONE `setValues` writes the 3-column block over rows `first .. first+n-1` (`writeUnlessTestModeGs_`, retried).
  6. `emailRerouteHandleBouncesGs_(ss, bouncedItems, rows, now)` runs on **every** bounced row, new or old (idempotent; it retries failed steps).
  7. If there are new bounces, ONE alert with severity HIGH lists each email plus what the reroute did. Outside an email job it is sent immediately.

  Returns `{checked, bounced, replied, newBounces, unswept, errors, reroutes}`.
- **`sweepEmailBouncesAndReplies()` :243** trigger entry point: run record, no lock, crash alert and re-throw.
- **`sweepEmailBouncesAndRepliesNow()` :254** manual alias.
- **`emailSweepBouncesOnlyRunGs_(slot)` :257** the same, with `bouncesOnly:true` and the slot's job name.
- **`sweepBouncesAfterMorning/Followup/AllIssues()` :267-269** the three slot handlers.
- **`setupEmailSweepTrigger()` :273** deletes all four handlers' triggers and creates four `nearMinute` daily IST triggers (15:30, 10:30, 13:30, 17:30).

### 2.4 OpsAudit.gs

**Purpose.** EO-3/EO-4: silent comparison of `Email_Ledger` with `Overnight_Log` / `AllIssues_Log` after each email job; one alert only when they disagree. It writes only its run record and `EMAIL_AUDIT_LAST_<job>`.

**Constants.** `OPS_AUDIT_MAX_LIST_ 8` (:40); `OPS_AUDIT_RECORD_PREFIX_ 'EMAIL_AUDIT_LAST_'` (:41). `OPS_AUDIT_SPECS_` (:42):
| key | job | watchJob | time |
|---|---|---|---|
| morning | auditMorningEmails | sendOvernightMorningEmails | 11:15 |
| followup | auditFollowupEmails | sendOvernightFollowupEmails | 14:00 |
| allIssues | auditAllIssuesEmails | sendAllIssuesEmails | 18:00 |

`OPS_AUDIT_SEVERITY_RANK_` (:73).

**Functions.**
- **`showEmailAuditNow()` :31** dry-runs all three and logs the findings (no alert, no record).
- **`opsAuditKeyGs_(region, to)` :51** `'region|to'` lower-cased, trimmed. This is the **only** join key between the ledger and the logs.
- **`opsAuditLabelGs_(r)` :55** `'region / bucket_label-or-to'`.
- **`opsAuditFindingGs_(...)` :60** caps the item list at 8 and sets `more`.
- **`opsAuditFindingLinesGs_(f)` :65** alert text lines.
- **`opsAuditTopSeverityGs_(findings)` :74** the worst severity (LOW by default).
- **`opsAuditUnfinishedGs_(ledgerRows, recoveryName)` :83** HIGH for any PLANNED/ATTEMPTING row.
- **`opsAuditAcceptedWithoutLogGs_(ledgerRows, logRows, logName, consequence)` :93** HIGH for an ACCEPTED ledger row with no log row of the same key.
- **`opsAuditLogWithoutLedgerGs_(ledgerRows, logRows, logName, jobLabel)` :105** MEDIUM. With no ledger rows at all it gives one summary finding; otherwise one item per log row with no ledger row of the same key.
- **`opsAuditDuplicateLogGs_(logRows, logName)` :123** MEDIUM for a key logged more than once.
- **`opsAuditCheckpoint1GapsGs_(prevAllIssuesRows, morningLedgerRows)` :138** HIGH for each of yesterday's `AllIssues_Log` rows that has a `to`, `lead_count > 0` and a blank `checkpoint1_sent_at`, where today's morning10 ledger shows no FAILED/BLOCKED/UNCONFIRMED row of the same key.
- **`opsAuditFollowupGapsGs_(overnightRows, followupLedgerRows)` :153** HIGH for each of today's `Overnight_Log` rows that has a `to`, a blank `followup_sent_at` and no followup13 ledger row of the same key.
- **`opsAuditMorningRulesGs_` :164** Unfinished(morning10+chLevel10), AcceptedWithoutLog(morning10 vs Overnight_Log), LogWithoutLedger, DuplicateLog(Overnight_Log), and Checkpoint1Gaps only when morning10 rows exist.
- **`opsAuditFollowupRulesGs_` :177** Unfinished(followup13); FollowupGaps if there are followup13 rows, else one LogWithoutLedger.
- **`opsAuditAllIssuesRulesGs_` :188** Unfinished(allIssues17+chLevel17), AcceptedWithoutLog, LogWithoutLedger, DuplicateLog(AllIssues_Log).
- **`opsAuditReadAllIssuesLogGs_(ss, startDay)` :204** reads column A in full, finds the first row with day >= startDay, then reads columns 1-9 and 12 to the end. Futwork label rows are mapped to the Futwork pseudo-region. The caller filters `day === wanted`.
- **`opsAuditReadOvernightLogGs_(ss, startDay)` :225** the same pattern over columns 1-9 (to = F, followup_sent_at = I).
- **`opsAuditJobStateGs_(record, day, now)` :240** returns `no_run` (no record, unreadable, or another day), `deferred` (running for at most 35 min), else `ok`. A `failed` job is `ok`, so the audit runs.
- **`opsAuditRun_(spec, opts)` :251** gets the state; when `ok`, reads today's ledger rows (filtered by `cycle_day === today`) plus the logs the spec needs (yesterday's AllIssues_Log for the morning audit), applies the rules, and wraps read errors as `failed`. In a dry run or TEST MODE it returns without side effects. Otherwise it sends ONE alert on findings (severity = the worst finding, scope 'item') or a MEDIUM "could not run" alert on `failed`, then writes the record property (for every status, including deferred and skipped).
- **`opsAuditRecordGs_` :291 / `opsAuditReadRecordGs_` :300** JSON `{day, ranAt (ISO), status, count, codes, reason}` in Script Properties.
- **`opsAuditEntryGs_(spec)` :309** run record + crash alert + re-throw. No lock.
- **`audit*Emails()` :320-322**, **`*Now()` :323-325** the triggers and manual aliases.
- **`setupOpsAuditTriggers()` :328** deletes and re-creates three `nearMinute` IST triggers.

### 2.5 DailyChecklist.gs

**Purpose.** EO-6: eleven stage rows A-K with a flag and evidence, computed inside `cycleReportDataGs_` and stored in `Daily_Checklist`.

**Constants.** Sheet `Daily_Checklist`, headers `report_day, stage, check, flag, evidence, evaluated_at` (:24-25); text column 1; `STAGES_ 11` (unused anywhere; informational); flag rank RED 3 > AMBER 2 > GREEN 1 > GREY 0.

**Functions.**
- **`showDailyChecklistNow()` :19** builds the full report and logs the checklist rows.
- **`dailyChecklistWorstGs_(flags)` :31** the worst flag (GREY if nothing else is present).
- **`dailyChecklistCountsGs_(byJob, jobs)` :38** sums the counts of the given jobs; `null` if none is present.
- **`dailyChecklistSendFlagGs_(c)` :51** null when there is nothing planned; RED for any failed/blocked/unfinished; AMBER for unconfirmed; else GREEN.
- **`dailyChecklistSendTextGs_(c)` :58** evidence text.
- **`dailyChecklistAuditGs_(rec, win, label)` :69** AMBER when there is no record or `ranAt` is outside the cycle window; GREEN when clean; RED on exceptions; otherwise AMBER (deferred / skipped / failed).
- **`dailyChecklistGs_(input)` :80** the stages:
  - **A**: from `jobProblems` (`emailJobProblemsGs_` at report time). Null gives AMBER, empty gives GREEN, a non-'unreadable' problem gives RED, otherwise AMBER.
  - **B**: freshness level (UNKNOWN or missing gives AMBER).
  - **C**: empty cycle AMBER; no exclusions GREEN; else AMBER.
  - **D**: AMBER if any exclusion reason matches "no reason for contact".
  - **E**: morning10+chLevel10 send flag (no rows AMBER).
  - **F**: followup13; no rows gives AMBER if 10:00 emails were accepted, else GREY.
  - **G**: the worst of the 10:00 and 13:00 audit flags.
  - **H**: allIssues17+chLevel17; RED if any unfinished.
  - **I**: the worst of the 17:00 send flag and the 17:00 audit flag.
  - **J**: no accepted email GREY; bounced > rerouted RED; all re-routed AMBER; no sweep yet or unswept rows AMBER; else GREEN.
  - **K**: the worst of A-J, raised to AMBER by serious incidents or held alerts.
- **`dailyChecklistSectionGs_(rows)` :164** the report section (red accent if any row is RED).
- **`dailyChecklistRecordGs_(ss, rows, now)` :177** in TEST MODE or with no rows it does nothing. Otherwise `emailLedgerReplaceDayBlockGs_` replaces today's block at the bottom of the tab (in place if the size is the same, else delete + append). Fail-open.

### 2.6 FollowupTracker.gs

**Purpose.** EO-7: for each 17:00 bucket of the cycle day, the status of Checkpoint 1 (10:00 next day) and Checkpoint 2 (13:00 next day), plus whether the 17:00 email bounced/was rerouted/got a reply. Stored in `Followup_Tracker`.

**Constants.** Sheet + 14 headers (:29-30); text column 1; CP1 hour 10, CP2 hour 13; `GRACE_MINUTES_ 30`; statuses `COMPLETED, NOT_NEEDED, BLOCKED, OVERDUE, DUE, FUTURE`; `MAX_ROWS_ 30`.

**Functions.**
- **`showFollowupTrackerNow()` :21** builds the report and logs the tracker rows.
- **`followupKeyGs_(region, to)` :39** the same key shape as OpsAudit.
- **`followupNextDayGs_(dayKey)` :44** noon IST of `dayKey` plus 24 h, then the IST day key (DST-safe by construction).
- **`followupCheckpointStatusGs_(s)` :50** precedence: the ledger status first (SKIPPED gives NOT_NEEDED; ACCEPTED gives COMPLETED; FAILED/BLOCKED/UNCONFIRMED/PLANNED/ATTEMPTING give BLOCKED), then the log stamp (COMPLETED), then `blockedBy` (BLOCKED), then time (FUTURE before due, DUE for 30 min, then OVERDUE).
- **`followupTrackerGs_(input)` :68** indexes ledger rows by job and key. allIssues17 rows must have `cycle_day === cycleDay`; morning10/followup13 rows must be on the next day; the last one wins. Reroute rows are indexed by id. For each log row: cp1 from the morning10 ledger row plus the `checkpoint1_sent_at` stamp; cp2 from the followup13 ledger row plus the `checkpoint2_sent_at` stamp, BLOCKED if cp1 is BLOCKED or OVERDUE. Email status: `BOUNCED` (or `REROUTED` if `RR|id` is ACCEPTED), else `REPLIED`. `stop` = BOUNCED. Returns counts, rows and attention items.
- **`followupTrackerSectionsGs_(t)` :108** "unreadable" / "no bucket" placeholder sections, or a counts table plus an attention table.
- **`followupTrackerReadLogGs_(ss, dayKey)` :135** scans column A for the first row of `dayKey` and **counts** matching rows (stopping at a later day), then reads `count` consecutive rows from the first match. It assumes the day's rows are contiguous (finding D-11). Columns 1-9 and 12-14; rows with a blank `to` are dropped; null on error.
- **`followupTrackerRecordGs_(ss, t, now)` :163** replace-day-block, fail-open, TEST MODE no-op.

---

## 3. End-to-end narratives

### 3.1 The 17:00 send
The trigger fires near 17:00 IST (nearMinute: roughly 16:45-17:15). It takes the script lock (or skips with an alert), sets the run record to `running` and starts holding alerts. Then: one Leads read, the hierarchy and `Movement_Log` maps, the candidate filter, the customer dedupe and the region map. `Email_Ledger` is opened, and the region guard is built from `AllIssues_Log`. Per region:
1. defective leads are dropped and recorded;
2. recipients are resolved;
3. the CH-level report goes to ops (ledger `chLevel17`; once per day per region+CH, using `EMAIL_CH_REPORTS_allissues`);
4. unroutable leads are recorded;
5. all buckets are written PLANNED in one append;
6. each bucket goes ATTEMPTING, then the guarded send (reroute swap, then the gate, then draft+send with retry), then ACCEPTED (ids) and the `AllIssues_Log` row, or a failure (ledger status plus a held alert). A gate objection to specific leads drops those leads and resends once.

After the loop: SKIPPED for unproduced recovery targets; one "Leads NOT sent" report; the 90-day ledger prune; a ledger-failure note. When `fn` returns, the run record is set to `completed` and the held alerts go out as ONE message headed by the ledger's CONFIRMATION line. A crash anywhere outside the per-bucket try sends an immediate CRITICAL alert, the record says `failed`, and the error is re-thrown.

### 3.2 The 15:30 sweep and the bounce-only checks
Triggers fire near 10:30, 13:30, 15:30 and 17:30, with no lock and with a run record each. Each run reads the ledger tail (4 days) and takes accepted/unconfirmed rows between 10 min and 3 days old. It runs one Gmail search for mailer-daemon/postmaster messages (at most 100 threads) and matches them by recipient plus subject-or-15-minutes. The bounce-only checks rewrite only `bounce_status`; the 15:30 run also reads each thread for replies and stamps `swept_at`. One block write follows. Then every bounced row goes to `emailRerouteHandleBouncesGs_`: an `Email_Reroutes` row per bounced address (next in hierarchy or the ops address, 14 days), and for a bounced To, a one-time re-send of the original Gmail message to the replacement inside the job's late-send window, recorded as ledger job `reroute`, id `RR|<id>`. A HIGH alert follows, but only for bounces seen for the first time.

### 3.3 The three audits
They fire near 11:15, 14:00 and 18:00, with no lock. If the watched job has no run record today, the audit is skipped. If the job is still running and under 35 minutes old, the audit is deferred; neither case alerts, and neither is retried later that day. Otherwise the audit reads today's ledger rows and the relevant log rows, keyed by `region|to`, and applies its rules (section 2.4). It sends one alert with severity = the worst finding, or a MEDIUM "could not run". It always stores `EMAIL_AUDIT_LAST_<job>` for checklist stages G and I.

### 3.4 The 16:30 cycle report, checklist A-K and the follow-up tracker
The trigger fires near 16:30, with a run record and no lock. The once-a-day property guard is checked first. The window is from yesterday 16:30 to now (but see D-1). It reads the three evidence tabs from the start day onward and filters them by timestamp. It collects freshness (a full Leads read), config problems, the watchdog's job problems, the three audit records, yesterday's `AllIssues_Log` buckets and `Email_Reroutes`. It computes the totals, the attention list, the sweep summary, the exclusions and the incidents. The tracker is built for `cycleDay` = the window start's IST day: each of that day's 17:00 buckets with CP1/CP2 status from the next day's morning10/followup13 ledger rows and the log stamps. Checklist A-K comes from all of the above. The report is rendered and sent to the ops address; then the sent-day property, `Daily_Report` (upsert), `Daily_Checklist` (replace-day-block) and `Followup_Tracker` (replace-day-block) are written.

### 3.5 Recovery
`recoverFailedAllIssuesBucketsNow()` runs under the same script lock, under the job name `recoverAllIssuesBuckets`, with alerts held. Targets are today's `allIssues17` ledger rows that are FAILED, BLOCKED or PLANNED. After 18:30 IST nothing is sent unless `...ForceNow`. Otherwise the whole 17:00 pipeline is recomputed from current data. The region guard is bypassed and CH-level reports and most exclusion rows are suppressed; only the targeted ids are planned and sent. A target that is no longer produced is closed SKIPPED with a reason. UNCONFIRMED and ATTEMPTING rows are never targeted (they may have been delivered). The 10:00 and 13:00 recoveries (outside this file) use the same driver. The reroute re-send (section 3.2) is a separate, automatic recovery path for bounces.

---

## 4. Findings

**D-1 - HIGH - `CycleReport.gs:40-45` (with `:349-350`) - the scheduled report covers about 48 hours whenever its trigger fires before 16:30. CONFIRMED (logic); how often it happens depends on the trigger jitter.**
`cycleReportWindowGs_` treats any `now` before 16:30 IST as "the cycle that just ended plus today so far": it sets `lastBoundary` to *yesterday* 16:30 and the start to *the day before yesterday* 16:30. That is right for a manual morning preview. But the trigger is `atHour(16).nearMinute(30)`, and the file's own comment (line 349) says it "can fire from 16:15 to 16:45". On any day it fires at 16:15-16:29:
- the counts include **two** 17:00 sends and two days of 10:00/13:00 emails;
- incidents, exclusions and the Daily_Report numbers are doubled;
- `followupTrackerReadLogGs_` and `followupTrackerGs_` use `cycleDay = istDayKeyGs_(win.start)`, i.e. the day before yesterday, so the tracker shows Checkpoints 1/2 of the *previous* cycle and today's checkpoints are not tracked at all;
- the once-a-day guard then stops a correct re-send.

Scenario: the trigger fires at 16:22 on 12 Oct. The report says "Whole cycle: 10 Oct 16:30 to 12 Oct 16:22", sums the 10 Oct and 11 Oct 17:00 sends, and the follow-up tracker lists the 10 Oct buckets. Fix direction: when the run is scheduled (or `now` is within, say, 30 min of 16:30), use the 16:30 boundary that is *nearest*; or anchor the window on the most recent 17:00 send. The tests (`Tests_CycleReport.gs:52`) only check the deliberate manual-before-16:30 behaviour.

**D-2 - HIGH - `EmailSweep.gs:68-83` with `EmailReroute.gs:389-412` - one bounce can be attributed to other emails, and Cc addresses that never bounced can be re-routed. SUSPECTED (depends on how Gmail bounce bodies render through `getPlainBody()`).**
The matcher accepts a bounce for a row when the bounce text contains **any** of the row's To/Cc addresses **and** (it quotes the subject **or** arrived within 15 min of the send). The tests assume bounce text quotes the original message, since the subject match depends on it (`Tests_EmailSweep.gs:80`). In that case the quoted original headers carry its To **and Cc** lines. The 17:00 job sends dozens of bucket emails within minutes, and many share Cc addresses (the always-Cc leadership addresses, the RH/CH on several buckets). So when email A's To bounces, every other email B whose Cc overlaps A's Cc and which finished within 15 min before the bounce matches too. B is marked `BOUNCED` and reported as "the recipient did NOT get it", which is false. Then `emailRerouteHandleBouncesGs_` marks as "bounced" every address of the row that appears anywhere in the bounce text (`named`). That includes healthy Cc addresses quoted in the original headers, even for the genuinely bounced email A itself. Each one gets a 14-day `Email_Reroutes` row ('cc only'), so a healthy leadership or RH Cc is silently replaced by their own manager in every email for two weeks. Only the ops address is excluded (`:394`). Fix direction: identify the failed recipient from the DSN's own failure line (the "wasn't delivered to X" / `Final-Recipient`) rather than from anywhere in the text; drop the 15-minute shortcut when the bounce does not name the row's **To**; never re-route a Cc unless the DSN names it as the failed recipient. Before changing anything, confirm against one real bounce message in the live mailbox how `getPlainBody()` renders it.

**D-3 - MED - `EmailSweep.gs:181-214` vs `AllIssuesEmailer.gs:433` / `EmailLedger.gs:466-488` - the sweep's block write targets row numbers that the 17:00 job's prune can shift. SUSPECTED (timing); the logic is CONFIRMED.**
The sweep reads row numbers at the start, spends seconds to minutes searching Gmail, then writes columns U:W for rows `first..first+n-1`. It takes no lock (by design). The 17:00 job ends with `pruneEmailLedgerGs_`, which `deleteRows(2, old)` on `Email_Ledger`. The 17:30 bounce check (fire window 17:15-17:45) and the end of the 17:00 job (fire window 16:45-17:15, 4-11 min runtime, historically longer) can overlap. If the prune lands between the sweep's read and its write, every bounce/reply/swept value is written `old` rows too high, onto newer rows. Rows past the new end get phantom sweep-only rows, and a BOUNCED status can land on the wrong email. Dormant until ledger rows are 90 days old (the first prune that deletes anything is about 2027-01-07); after that it is possible every day. Fix direction: in the sweep, re-check that the `email_id` column still matches before writing, or write per row by id; or prune in a job that never overlaps a sweep.

**D-4 - MED - `EmailSweep.gs:186-196` - a BOUNCED status is not sticky: a later failed search or a missed match downgrades it, and the "new bounce" alert then repeats. CONFIRMED.**
Every run recomputes `bounce_status` for every due row from the current search. If a search fails (a transient Gmail error), every previously `BOUNCED ...` row in the last 3 days is overwritten with `UNKNOWN (the bounce search failed)`. If the bounce message falls out of the 100-thread search window, the row becomes `NO_BOUNCE_SEEN`. The 16:30 report and stage J then no longer show the bounce. At the next successful run the row matches again, `!/^BOUNCED/.test(old)` is true, and a second HIGH "Email BOUNCED" alert is sent for the same email. Scenario: 13:30 search errors, 15:30 search fine: a duplicate bounce alert and an inconsistent ledger in between. Fix: never replace a `BOUNCED` status with a weaker one.

**D-5 - MED - `EmailSweep.gs` / `EmailReroute.gs:250-259` / `EmailLedger.gs:321-333` - ledger appends from the sweep's re-send are not serialized with the email jobs. SUSPECTED (narrow window).**
`emailLedgerAppendBlockGs_` computes `startRow = getLastRow()+1` and then writes. The 17:00 job (PLANNED blocks per region) and a concurrent 17:30 check that re-sends a bounced email (an `RR|` ledger row, plus a new `Email_Reroutes` row) each compute their start row independently. The same applies to 10:00/10:30 and 13:00/13:30. If both compute the same row before either writes, one block overwrites the other. The job's cached `rowById` then points at a row holding another email's data, and later outcome patches corrupt it. It needs a bounce at the exact moment of a region's plan write, so it is rare, but the comments state the sweep can never interfere with a send. Fix direction: take the script lock briefly around the reroute re-send (not the whole sweep), or have the sweep defer re-sends while an email job's run record says `running`.

**D-6 - MED - `AllIssuesEmailer.gs:332-378` (recovery mode) - a recovery run re-reports every region's defective and unroutable leads in a fresh "Leads NOT sent" alert. CONFIRMED.**
In recovery the region guard is bypassed for **all** regions (`!recoverIds`, :335), so every region is split and resolved again. The defective leads (:344) and truly unresolved leads (:372-376) of every region are pushed to `failedLeadEntries` even though only the targeted buckets are sent. `exLedger` suppresses only the *exclusion rows*, not the alert. Scenario: one Pune bucket failed and is recovered at 17:40. The recovery's held alert includes a "Leads NOT sent (N)" report listing every unroutable lead of all 11 regions from the original run, as if they had failed again. Fix: in recovery, process only regions that hold a target (the driver already passes `regions`; the 17:00 `run` ignores it), or skip the failed-lead pushes for non-targeted buckets.

**D-7 - MED - `AllIssuesEmailer.gs:392` + HANDOVER section 4.3.5 "Recovering a failed 17:00 bucket" - a run that dies mid-loop leaves its unreached regions invisible to recovery. CONFIRMED.**
PLANNED rows are written per region, immediately before that region's sends. Regions after the point of death have no ledger rows, so `recoverFailedAllIssuesBucketsNow()` cannot see them. The region in progress is now guarded by its own `AllIssues_Log` rows, so a plain re-run skips it while sending the unreached regions. The correct remedy is therefore a plain `sendAllIssuesEmailsNow()` **plus** recovery. HANDOVER says recovery re-sends "the buckets a run that died never reached (`PLANNED`...)". That is true only for the in-progress region. OpsAudit's UNFINISHED and the cycle report also cannot see the missing regions; only the watchdog's `failed`/`stuck` does. Fix: document the two-step procedure, or plan all regions up front.

**D-8 - LOW - `AllIssuesEmailer.gs:179-181` - the crash alert says "NO All-Issues emails were sent this run ... nothing was sent for ANY region", which is false for a mid-loop crash. CONFIRMED.**
Any exception outside the per-bucket try is reported this way after earlier regions already went out. Examples: an uncaught `resolveRecipientEmailsForRegion_` error, or a Sheets error in `lastRowRetryGs_` before the loop (only that case makes the text true). An operator who believes it and re-runs is protected by the region guard, but may still conclude managers got nothing. Fix: say "the run stopped at <region>; regions before it were sent - see Email_Ledger".

**D-9 - LOW - `AllIssuesEmailer.gs:533-536` - a failed CH-level 17:00 report raises no alert unless the gate blocked it, and it cannot be recovered. CONFIRMED.**
On a Gmail error the catch only logs; the `chLevel17` ledger row says FAILED, and nobody hears about it until the next day's 16:30 report. `emailLedgerRecoveryTargetsGs_` is called only for `allIssues17`, and a plain re-run skips the region if it had any normal bucket logged. Impact is small (the report goes to ops), but it breaks the "a failure is alerted after the run" rule (D2). Fix: alert on every failure, as the bucket path does.

**D-10 - LOW - `OpsAudit.gs:240-247` / `:256` - the audits never re-run after `deferred` or `skipped`, and a recovery run in progress is not detected. CONFIRMED.**
(a) If the 17:00 job is still running at the audit's fire time (a 17:15 start plus a slow run against an audit fire as early as 17:45), the 18:00 audit records `deferred` and that day's 17:00 audit never happens. Stage I shows AMBER, nothing more. (b) The audit watches only `sendAllIssuesEmails`'s run record. A `recoverAllIssuesBuckets` run in progress at 18:00 has its targets in ATTEMPTING/PLANNED, so the audit raises a false HIGH `UNFINISHED`. The same applies to the morning/follow-up recoveries around 11:15/14:00. Fix: treat any running job of the same family as `deferred`, and add a single late retry for deferred audits.

**D-11 - LOW - `FollowupTracker.gs:141-148` - the log reader assumes the day's rows are contiguous. CONFIRMED (latent).**
It counts the rows matching `dayKey` but reads `count` *consecutive* rows from the first match without filtering. If one row of another day sits between them (a hand edit, a manual paste-back after the test-mode clean-up), the tracker includes a wrong row and silently drops the last real one. `opsAuditReadAllIssuesLogGs_` reads to the end and filters, which is the safe pattern.

**D-12 - LOW - `CycleReport.gs:60` + trigger jitter - a report that fires at 16:45 can count today's 17:00 rows already in flight, and count them again tomorrow. SUSPECTED.**
The window's end is "now" and the next window starts at 16:30. A 17:00 job that fires at 16:45 (the code itself says it can) writes PLANNED rows that a report built at 16:45+ counts as "unfinished" (needs attention, not all clear). The next day's window counts them again. Fix: cap the end of the window at the time of the most recent completed 17:00 run, or use a boundary later than 16:30 (e.g. 16:40) as the cycle start.

**D-13 - INFO - `CycleReport.gs:87-108` - an UNCONFIRMED email that bounced produces two attention rows (BOUNCED and UNCONFIRMED), so the "N need attention" subject counts it twice.**

**D-14 - INFO - stale comments in `AllIssuesEmailer.gs`.**
- `:251` "not assigned in the last 48h", `:498` CH subtitle "last 48h" (the footer on the same email says 3 calendar days) and `:657` alert text "covers the trailing 48h window": the window is today + 2 calendar days.
- `:541-544`: the subject format "<primaryRole>/<bucketLabel>/google/Leads With Issue/<date>" is obsolete; the real format is at `:565`.
- `:428-431` names `OPS_ALERT_EMAIL_`, which is now a test-only override (P13).
- `notifyLeadSendFailuresGs_` (EmailInfra) says "automated overnight email" and "fixed to this morning's run" even when the 17:00 job calls it.

**D-15 - INFO - stale comments and docs elsewhere.**
- `CycleReport.gs:8-9` header: bounces/replies/Leads-tab age are "not tracked yet". They are tracked (EO-5, EO-10).
- HANDOVER section 4.3.5 (cycle report paragraph): "It cannot yet show bounces, replies or the age of the Leads tab". Contradicted by the next two paragraphs.
- `DailyChecklist.gs:97`: comment "(a stale lead is at least 24 h old)" on stage B, which is about Leads-tab freshness (3 h/5 h), not D8 stale leads.
- Operating manual section 5 stage A: "the watchdog confirms yesterday's 23:15 sync". At 16:30, `emailJobProblemsGs_` does not evaluate the sync (deadline 23:45 not yet passed; the record's day is yesterday), so A never covers it. A also never sees yesterday's 17:00 run record (deadline 17:30 not passed); stage I covers that through the ledger.
- Operating manual section 3 row 11 ("a separate silent audit pass is Plan"), section 11 rows C/D ("a dedicated view is planned", "per-check sheet is planned (EO-6)") and line 3 (built list stops at EO-10): all built now.
- `OpsAudit.gs:148` action text "run sendOvernightMorningEmailsNow is NOT safe (region guard)" is ungrammatical and does not mention `recoverFailedMorningBucketsNow()`. That recovery would not see the gap anyway, since the gap has no failure row, so the advice to handle it by hand stands.

**D-16 - INFO - `AllIssuesEmailer.gs:250` - a `lead_assigned_at` that the Leads tab returns as text (not a Date) silently drops the lead from scope**, with no exclusion row and no count. Shared with other emailers; noted because the ledger now promises "every lead left out is recorded".

**D-17 - INFO - `CycleReport.gs:124` - `heldNow` counts HELD incidents only among rows from the window's start day on.** An older HELD incident that the watchdog never released (for example, the watchdog trigger was not installed) is not shown under "Alerts waiting to be sent".

## 5. Open questions

1. **Bounce text format (D-2).** What does `GmailMessage.getPlainBody()` return for a real Gmail mailer-daemon DSN in this mailbox? Does it include the original headers (To/Cc/Subject)? This decides whether D-2 is live today. Check one real bounce read-only (with the owner's consent) before any change.
2. **Trigger jitter (D-1, D-12).** Does `nearMinute(30)` really fire before the minute on this project? The Executions history of `sendEmailCycleReport` since 2026-10-09 would show it. The code comments assume plus or minus 15 minutes.
3. **Recovery noise (D-6).** Was it intentional that a recovery re-reports the original run's unroutable leads (a "still not sent" reminder), or an oversight? The comment at `:199` ("the exclusions ... are not repeated") suggests an oversight.
4. **Prune scheduling (D-3).** Should `pruneEmailLedgerGs_` move out of the 17:00 job to a quiet hour (e.g. the 23:15 slot), which would remove D-3 entirely?
5. **Key mismatch risk.** OpsAudit and FollowupTracker join the 17:00 row and its next-day 10:00/13:00 rows on `region|to`. If a bucket's resolved recipient changes overnight (a hierarchy sync at 23:15 that applies changes, a merged bucket), the 10:00 email goes to the new address under the old region. CHECKPOINT1_GAP and the tracker then read the bucket as unhandled, or fall back to the log stamp only. Is that acceptable now that the nightly sync can be switched to apply mode?
