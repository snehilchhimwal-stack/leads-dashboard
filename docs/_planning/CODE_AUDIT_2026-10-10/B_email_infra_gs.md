# Code audit 2026-10-10 - B: EmailInfra.gs, EmailLedger.gs, EmailReroute.gs

Auditor B of 9. Read line by line, in full, at HEAD `19038e7`: `EmailInfra.gs` (1,444 lines), `EmailLedger.gs` (623), `EmailReroute.gs` (428).
Cross-checked only where needed: `js/reports-gmail.js` (browser twin of the send gate), and the callers in `AllIssuesEmailer.gs`,
`OvernightEmailer.gs`, `EmailSweep.gs`, `DailyChecklist.gs`, `FollowupTracker.gs`, `CycleReport.gs`, `RmHierarchySync.gs`, `Core.gs`.
Nothing was run against the live Sheet, Gmail or Apps Script. No code was edited. People's names and addresses are deliberately not
reproduced here (the repo is public): where a constant holds a person's name, it is written as `<name>`.

---

## 1. Scope and summary

These three files are the shared plumbing of every automated email the Apps Script backend sends.

`EmailInfra.gs` is the toolbox: how addresses for roles are resolved (by name, from the git-ignored private employee table, with loud
fallbacks), the retry wrappers for Sheets (`withRetry_`) and Gmail (`withSendRetry_`), the **outgoing-email safety gate**
(`prepareOutgoingEmailGs_` + `sendGuardedEmailGs_` - the only place a report email is drafted and sent), ops alerting with a second send path
and **held alerts** (EO-2), the **script-wide job lock** (`withEmailJobLockGs_`), **run records** in Script Properties and the hourly
**watchdog**, recipient resolution per region (RM_Hierarchy buckets -> Region_Recipients fallback -> CH-level backstop, plus Futwork and P&L Cc),
region normalisation, the leads-tab reader, the plain-text and HTML report renderers, and the Leads-tab freshness rule.

`EmailLedger.gs` is the evidence trail: `Email_Ledger` (one row per bucket email, PLANNED -> ATTEMPTING -> ACCEPTED / FAILED / UNCONFIRMED /
BLOCKED, or SKIPPED), `Email_Ledger_Exclusions` (leads/regions left out, with the reason), per-lead isolation helpers, the shared recovery
driver for failed buckets, 90-day prune, and `Incident_Log` (every ops alert recorded; held alerts released by the watchdog if a job died).
Every ledger function is fail-open.

`EmailReroute.gs` implements decision D9: a bounced address is redirected (table `Email_Reroutes`, 14 days) to the next person up the
dead person's hierarchy (else the ops address); the redirect is applied at the last moment inside the two senders, and the bounced email
itself is re-sent once from its own Gmail message, inside its job's late-send window.

---

## 2. Per-file reference

### 2.1 EmailInfra.gs

**Purpose.** Shared infrastructure used by OvernightEmailer.gs, AllIssuesEmailer.gs and (since EO-1..EO-13) EmailLedger, EmailSweep,
EmailReroute, CycleReport, OpsAudit, RmHierarchySync, MovementTracker. Depends on Core.gs (`esc_`, `resolveTabName_`, `buildColIndex_`,
`getVal_`, `istDayKeyGs_`, `pad2Gs_`) and RmHierarchy.gs (`resolveRecipientBucketsForRms_`, `loadRmHierarchyAndEmails_`,
`lookupEmployeeEmail_`, `alwaysCcEmailsGs_`, `ALWAYS_CC_EMAILS_`, `LEADERSHIP_NAMES_`), plus optional globals from other files guarded by
`typeof` (`emailRerouteApplyGs_`, `incidentRecordGs_`, `incidentNotifiedGs_`, `releaseHeldIncidentsGs_`, `emailLedger*`, `snapshotRunProblemsGs_`,
`RMSYNC_RUN_HOUR_`, `EMAIL_SWEEP_*`, `CYCLE_REPORT_*`, `OPS_AUDIT_SPECS_`). `ALL_ISSUES_RUN_HOUR_` (AllIssuesEmailer.gs) and
`notifyChLevelLeadsGs_` (OvernightEmailer.gs) are used unguarded.

**Globals / constants**

| Name | Line | Value | Meaning |
|---|---|---|---|
| `TEST_MODE_OVERRIDE_EMAIL_` | 43 | `''` (`let`) | When non-blank: every resolved To/Cc in `resolveRecipientEmailsForRegion_` becomes this one address; CH-level reports go only here; no production writes (`writeUnlessTestModeGs_`), no run records, no ledger, no incidents, no reroutes. Tests reassign it. |
| `REGION_RECIPIENTS_SHEET_` | 45 | `'Region_Recipients'` | Legacy per-region fallback recipients tab. |
| `OPS_ALERT_NAME_`, `CH_LEVEL_NAME_`, `FUTWORK_ROUTE_NAME_` | 61-63 | `<name>` each (ops and Futwork are the same person) | Role -> person name; address looked up at call time from the private table. |
| `_emailConfigWarned_` | 75 | `{}` | Per-execution "already logged this config warning" set. |
| `OPS_ALERT_EMAIL_`, `CH_LEVEL_EMAIL_`, `FUTWORK_ROUTE_EMAIL_` | 85/108/119 | `''` (`let`) | Test-only overrides. Read through the accessors, never directly. |
| `REGION_PNL_HEAD_CC_` | 162 | 4 regions -> 2 `<name>`s (`let`) | P&L head added to Cc of every email for that region (address from Manager_Directory). |
| `APPEND_ONCE_TAIL_ROWS_` | 207 | 100 | How far back a retried log append looks for its own key. |
| `MAX_CELL_JSON_CHARS_` | 231 | 45000 | Budget for a JSON cell (Sheets hard limit 50,000). |
| `CH_REPORT_KINDS_` | 264 | `{overnight:'overnight', allIssues:'allissues'}` | Suffix of the `EMAIL_CH_REPORTS_<kind>` Script Property. |
| `FUTWORK_REGION_KEY_` | 304 | `'Futwork'` | Pseudo-region grouping every Futwork RM. |
| `REGION_GROUP_MAP_` / `_REGION_LOOKUP_` | 459/478 | 33 raw names -> 11 main regions; lookup keyed by normalised name | Mirrors the browser `REGION_GROUP_MAP`. |
| `TRANSIENT_ERROR_RE_` | 531 | `/timed out|service (spreadsheets|gmail|error)|internal error|server error occurred/i` | Which errors `withRetry_` retries. |
| `EMAIL_ADDRESS_RE_` | 622 | `/^[^\s@<>,;"()\[\]\\]+@[^\s@<>,;"()\[\]\\]+\.[^\s@<>,;"()\[\]\\]+$/` | One bare address, no display name, no whitespace. Identical literal to browser `GMAIL_ADDRESS_RE`. |
| `EMAIL_ALERT_HOLD_JOBS_` | 726 | the 3 email jobs + 3 recovery jobs | Jobs whose alerts are held until the job ends. |
| `EMAIL_ALERT_HOLD_` | 727 | `null` / `{job, items:[{subject, bodyLines, incidentId}]}` | The current execution's held alerts. |
| `EMAIL_JOB_LOCK_WAIT_MS_` | 775 | 30000 | `tryLock` wait. |
| `EMAIL_JOB_DEADLINE_MINUTES_` | 828 | 30 | Grace after a job's scheduled time before "never started". |
| `EMAIL_JOB_MAX_RUN_MINUTES_` | 829 | 35 | A `running` record older than this is "stuck" (the platform cap is 30). |
| `LEADS_FRESH_AMBER_HOURS_` / `LEADS_FRESH_RED_HOURS_` | 1036/1037 | 3 / 5 | Leads-tab freshness thresholds (EO-10). |

**Script Properties used:** `EMAIL_CH_REPORTS_overnight`, `EMAIL_CH_REPORTS_allissues` (`{day, keys}`), `EMAIL_JOB_RUN_<job>`
(`{day, startedAt, finishedAt?, status, error?}`), `EMAIL_JOB_ALERTED_<job>` and `EMAIL_JOB_ALERTED___config` (dedupe markers).
**Lock:** `LockService.getScriptLock()` (script-wide; also taken by recoveries and the RM sync).

**Functions, in file order**

- **`resolvedEmailForNameGs_(name)`** (66). If `lookupEmployeeEmail_` exists, returns its result trimmed + lower-cased, else `''`. Any throw
  is logged and returns `''`. Called by every role accessor and `emailConfigProblemsGs_`.
- **`warnEmailConfigOnceGs_(key, text)`** (76). Logs `EMAIL CONFIG WARNING: ...` once per key per execution.
- **`opsAlertEmailGs_()`** (86). Order: override `OPS_ALERT_EMAIL_` -> private table by `OPS_ALERT_NAME_` -> `SpreadsheetApp.getActiveSpreadsheet().getOwner().getEmail()`
  (lower-cased, warned once) -> `''` (warned once: alerts cannot be delivered). Never throws (owner lookup is try/caught).
- **`chLevelEmailGs_()`** (109). Override -> table by `CH_LEVEL_NAME_` -> (warn) `opsAlertEmailGs_()`.
- **`futworkRouteEmailGs_()`** (120). Override -> table by `FUTWORK_ROUTE_NAME_` -> (warn) ops address.
- **`emailConfigProblemsGs_()`** (130). Returns `[{key, detail}]` for each of ops / ch / futwork whose override is blank AND name does not
  resolve; when `ALWAYS_CC_EMAILS_` is not an array (production: `null`), one `leadership:<name>` problem per unresolvable `LEADERSHIP_NAMES_` entry.
  Read by the watchdog and `showEmailConfigNow`.
- **`showEmailConfigNow()`** (147). Manual; logs the four resolved values (marking overrides) and the problems list. Read-only.
- **`isFutworkRmNameGs_(name)`** (155). `/futwork/i` on the name.
- **`regionPnlHeadEmailGs_(ss, region, hierarchyData)`** (166). Case-insensitive region match in `REGION_PNL_HEAD_CC_`; no name -> `''`. Uses the
  passed hierarchy data or calls `loadRmHierarchyAndEmails_(ss)` (a full read per call when not passed); returns
  `emailByManagerNameLower[name.lower]` or `''` (logged).
- **`withRegionPnlHeadCcGs_(pnlHeadEmail, to, cc)`** (181). Splits Cc on `,`, appends the P&L address unless it is already in Cc or To
  (case-insensitive); returns comma text, or `undefined` when empty.
- **`writeUnlessTestModeGs_(fn, label)`** (194). TEST MODE: logs and returns `undefined` without calling `fn`. Otherwise
  `withRetry_(() => { r = fn(); SpreadsheetApp.flush(); return r; })` - the flush is inside the retry so a bad write surfaces (and is retried)
  here, not at the next unrelated Sheets call.
- **`appendRowOnceGs_(sheet, row, keyIndex)`** (208). Returns a closure for a retry wrapper. First call: `appendRow`. Later calls (only if the key
  is non-blank): scan the last 100 rows of the key column; if the key is there, return `false` without appending. `attempted` is set before
  the write because a throwing attempt may have written. Blank key = plain append every time.
- **`jsonForCellGs_(entries, label)`** (232). `JSON.stringify`; if over 45,000 chars, repeatedly keeps the first 90% (floor) until it fits
  (terminates; a single huge entry ends as `[]`), then `notifyOpsAlertGs_` ("A log cell was too large...", severity LOW by subject).
- **`chLevelReportToGs_()`** (249). TEST MODE -> the test address. Else `ops,ch` or just `ops` when ch equals ops (ch falls back to ops). If ops is
  `''` the result can be `',ch'` or `''`; the gate then strips the blank / blocks.
- **`chReportKeyGs_(region, ch)`** (265) `'region|ch'` lower-cased. **`chReportPropertyGs_(kind)`** (268) `'EMAIL_CH_REPORTS_'+kind`.
- **`readChReportsTodayGs_(kind)`** (269). Parses the property; returns its `keys` only if `rec.day === istDayKeyGs_(now)` else `[]`;
  `null` when unreadable (no PropertiesService, parse error) - logged.
- **`wasChReportSentTodayGs_(kind, region, ch)`** (281). TEST MODE -> `false`. True only when the key is present (null record -> false: fail open).
- **`markChReportSentGs_(kind, region, ch)`** (287). TEST MODE -> `false`. Reads today's keys (or `[]`), adds the key, writes
  `{day: today IST, keys}`; a new day therefore replaces yesterday's record. Never throws. Called only after a successful send.
- **`regionKeyForRmGs_(rm, region)`** (305). `'Futwork'` for a Futwork RM, else the region.
- **`regionSummaryGs_(items)`** (308). Counts `.region`, returns `{regions (sorted), counts, label 'A (3) · B (1)'}`.
- **`regionHeaderOptsGs_(regionKey, items)`** (316). Normal region -> `{region}`; Futwork -> `{region: 'A, B', regionLabel: 'Region(s): ...'}`
  or `{region:'Futwork'}` if no item has a region.
- **`sectionsByRegionGs_(items, sectionsForRegion)`** (325). Groups by `.region` (`'Unknown region'` default), sorted; the first section of each
  region gets `regionBand = '<region> — N lead(s)'`.
- **`dedupeByLeadIdGs_(entries)`** (338). Keeps the first entry per `lead_id`; entries with `lead_id === undefined` are dropped.
- **`notifyOpsAlertGs_(subject, bodyLines, opts)`** (354). EO-2. `held = EMAIL_ALERT_HOLD_ && !opts.immediate`. Always first tries
  `incidentRecordGs_({subject, bodyLines, job, held, severity, scope})` (status `HELD` or `PENDING`; errors swallowed -> id `''`). If held: pushes
  `{subject, bodyLines, incidentId}` onto the hold and **returns `true`** (no send yet). Otherwise `sendOpsAlertNowGs_` and marks the incident
  `SENT` / `SEND-FAILED`. No caller uses the return value (checked).
- **`sendOpsAlertNowGs_(subject, bodyLines)`** (372). Subject prefixed `[Overnight Emailer] ` (for every alert, any job). Up to 2
  `GmailApp.sendEmail(ops, subject, body)` attempts 3 s apart (any error), then `sendOpsAlertViaGmailApiGs_`; returns true/false. A retry after
  an ambiguous error can duplicate an alert - accepted on purpose.
- **`sendOpsAlertViaGmailApiGs_(subject, body)`** (395). Throws if the Advanced Gmail Service is absent. CR/LF in the subject collapsed; non-ASCII
  subject RFC 2047 base64-encoded; raw MIME `To/Subject/MIME-Version/Content-Type: text/plain; charset=UTF-8` (no Content-Transfer-Encoding);
  `Gmail.Users.Messages.send({raw: web-safe base64}, 'me')`.
- **`istStampGs_(date)`** (407). `yyyy-MM-dd HH:mm:ss` in `Asia/Kolkata` for now or the given date.
- **`notifyLeadSendFailuresGs_(entries)`** (425). No-op for `[]`. Builds the "Leads NOT sent (N) - d MMM yyyy" report via
  `renderOvernightReportEmailHTML_` (one table: Lead ID, RM, To, Cc, Reason) + a plain body; **one un-retried `GmailApp.sendEmail` to ops**, not
  through the gate, not through `notifyOpsAlertGs_` (so not held and not in Incident_Log); a failure is only logged. Used by the 17:00 and 10:00 jobs.
- **`normRegionKeyGs_(s)`** (475) trim, lower, `[\s\-_]+` -> one space. **`mainRegionForGs_(raw)`** (480): exact normalised lookup, else strip a
  trailing ` <digits>` and retry, else `null` (region skipped by callers).
- **`passesGoogleNonUtmSearchGs_(groupSource, sourceBucket)`** (497). `source == 'google'` and sub-source `non-utm` or `search` (trimmed, lower).
- **`withRetry_(fn, label)`** (532). Up to 4 attempts; retries only messages matching `TRANSIENT_ERROR_RE_`; sleeps 2 s, 4 s, 6 s; rethrows the
  last error or any non-transient error immediately. Used for every Sheets read/write of the email jobs. **Not safe for sends** (see B-14).
- **`withSendRetry_(fn, label)`** (578). Up to 3 attempts; retries only `/operation not allowed/i` (wait 2 s, 4 s) or `/not found/i` (flat
  400 ms - the createDraft->send lookup race). Everything else (timeouts included) is thrown at once, so an ambiguous send is never repeated.
  A "not found" retry leaves the earlier unsent draft behind.
- **`emailAddressListProblemsGs_(list, field, required)`** (625). Array joined by `,`; split on **`,` only**; each trimmed non-blank part must
  match `EMAIL_ADDRESS_RE_`; empty list is a problem only when `required`.
- **`visibleTextOfHtmlGs_(html)`** (638). Removes `<style|script|head ...>...</same>` blocks, all tags, decodes 6 entities, collapses whitespace.
  Byte-identical body to the browser `gmailVisibleText`.
- **`prepareOutgoingEmailGs_(msg)`** (653). Normalises `{to, cc, subject, plainBody, htmlBody, leadIds}`: To/Cc arrays joined, strings
  trimmed; subject CR/LF -> space, trimmed; `htmlBody` `null/undefined` -> `undefined`. Problems: To required + valid, Cc valid, subject
  non-blank, plain body non-whitespace, HTML (when given) has visible text; when `leadIds` is given (even `[]`): non-empty after trimming, and
  each id must be a **substring** of the plain body and of the HTML visible text (first 5 missing listed per part). Returns
  `{msg (without leadIds), problems, missingLeadIds (union of both parts' misses)}`. Pure.
- **`isAmbiguousSendErrorGs_(err)`** (692). True for `timed out|timeout|deadline|internal error|server error|backend error|service error|service (gmail )?failed|unavailable|empty response|socket|network|temporar|\b50[0234]\b`.
  Used by the ledger (UNCONFIRMED vs FAILED) and by the 13:00 fallback decision.
- **`sendBlockedErrorGs_(label, problems, missingLeadIds)`** (697). Error with `.blockedByGuard = true`, `.guardProblems`, `.missingLeadIds`.
- **`sendGuardedEmailGs_(msg, label)`** (707). (1) `emailRerouteApplyGs_(msg)` if present (may swap dead addresses and prepend a banner);
  (2) gate; any problem -> throw the blocked error (nothing drafted); (3) options `{name: 'Homesfy Lead Ops', cc?, htmlBody?}`;
  (4) `withSendRetry_(() => GmailApp.createDraft(to, subject, plain, options).send())`. Returns the sent `GmailMessage`. TEST MODE is **not**
  enforced here - it relies on callers having redirected addresses upstream.
- **`emailAlertHoldStartGs_(job)`** (729). `EMAIL_ALERT_HOLD_ = {job, items: []}` and `emailLedgerResetActiveGs_()` so the later confirmation line
  describes only this run's ledger handle.
- **`emailAlertHoldFlushGs_()`** (734). Takes and clears the hold; nothing held -> return. Confirmation line from `emailLedgerConfirmationLineGs_()`
  (or "CONFIRMATION UNAVAILABLE"). One item: its own subject, body = confirmation + blank + its lines. Several: subject
  `<job label>: N alerts from this run`, each item framed `--- Alert i of N: subject ---`. Sends via `sendOpsAlertNowGs_`, then marks all incident ids
  `SENT`/`SEND-FAILED` with the confirmation as the continuity note. Whole body try/caught (never throws).
- **`withEmailJobLockGs_(jobName, fn)`** (776). No LockService -> run tracked, return true. `getScriptLock().tryLock(30000)` inside try:
  service error -> alert "ran WITHOUT its overlap lock" (HIGH) and run anyway (fail open); `false` -> alert "SKIPPED — another email job was
  still running" (CRITICAL) and return false (not queued, not retried, no run record written); acquired -> run tracked, release in `finally`
  (release errors logged). Callers: the 3 email jobs, 3 recoveries (x2 for Force variants), the nightly RM sync.
- **`emailJobScheduleGs_()`** (830). `{job: {hour, minute?, label}}`: 10:00, 13:00, `ALL_ISSUES_RUN_HOUR_` (17) always; plus, when the defining
  file is present: RM sync (23:15), full sweep (15:30), the 3 bounce-only slots (10:30, 13:30, 17:30), cycle report (16:30), the 3 silent audits
  (11:15, 14:00, 18:00). Recovery jobs are not watched.
- **`emailJobRunKeyGs_` / `emailJobAlertedKeyGs_`** (858/859). Property names.
- **`readEmailJobRunGs_(job)`** (863). Parsed record, `null` if none, `{unreadable}` on any error.
- **`writeEmailJobRunGs_(job, record)`** (872). Best effort, logs failures, returns bool.
- **`runEmailJobTrackedGs_(jobName, fn)`** (886). TEST MODE: alert "ran in TEST MODE" (sent immediately, HIGH), run `fn`, record nothing.
  Otherwise: write `running` (day = IST day of start), start the hold if the job is in `EMAIL_ALERT_HOLD_JOBS_`, run `fn` capturing any error,
  write `completed` or `failed` (error text sliced to 300), flush the hold, rethrow the original error. A job killed by the platform leaves
  `running`.
- **`emailJobProblemsGs_(now)`** (919). Minutes into the IST day computed with `Utilities.formatDate(now,'Asia/Kolkata','HH'/'mm')`. For each
  scheduled job whose `hour*60 + minute + 30` has passed: `unreadable`; `never_started` (no record or `rec.day !== today IST`); `failed`; or
  `stuck` (status `running` and started > 35 min ago). Returns `[{job, kind, detail}]`.
- **`checkEmailJobsCompletedGs_(now)`** (949). Problems = job problems + `snapshotRunProblemsGs_(now)` (MovementTracker.gs). For each, unless
  `unreadable`, skip when `EMAIL_JOB_ALERTED_<job>` equals the marker (`p.marker` or `day|kind`); send "WATCHDOG: <job> <did not run|did not
  finish|failed|is overdue|skipped work...|cannot be checked>" with a hint; store the marker. Then the address-config check, deduped by
  `day|config|<keys>`. Then `releaseHeldIncidentsGs_(now)`. Returns problems.
- **`emailJobWatchdog()`** (1001). Trigger entry: wraps the above; a throw becomes an immediate "WATCHDOG itself failed" alert.
  **`emailJobWatchdogNow()`** (1009) manual alias.
- **`setupEmailJobWatchdogTrigger()`** (1015). Deletes existing `emailJobWatchdog` triggers, installs `everyHours(1)`. (No timezone needed.)
- **`showEmailJobRunsNow()`** (1024). Logs each scheduled job's record and `snapshotPeriodic`'s. Read-only.
- **`leadsFreshnessLevelGs_(ageHours)`** (1039). `> 5` RED, `> 3` AMBER, else GREEN.
- **`leadsFreshnessFromRowsGs_(colIndex, rows, now)`** (1047). Newest `lead_assigned_at` that is a real `Date` and not more than 1 h in the future;
  none -> `UNKNOWN`. Returns `{level, ageHours, newest, text}` (time shown in IST). Pure. Used only by CycleReport.gs.
- **`plainTextFromReportOptsGs_(opts)`** (1066). Plain twin of the HTML: title, region line, subtitle, `value label | ...` KPIs, action,
  each section (`== band ==`, heading - subheading, `  col | col`, rows with `null`->`''`), footer.
- **`plainTextReportGs_(opts)`** (1090) adds the signature. **`plainTextTwoSectionGs_(s1, s2)`** (1095) "Section 1 - ..." / divider / "Section 2 - ..." + signature.
- **`ensureRegionRecipientsSheet_(ss)`** (1107). Returns the tab, or creates it (header `region,to,cc`, frozen row, the 11 main regions in col A),
  each step its own `withRetry_`, `flush()` after insert.
- **`resolveRecipientEmailsForRegion_(ss, region, rmNames, legacyRecipients, opts)`** (1170). Splits RMs into Futwork / regular; P&L head
  address for the region; `resolveRecipientBucketsForRms_` (retried) -> one result per bucket `{to: primaryEmail, cc: bucket cc + P&L,
  rmNames, source, bucketLabel: primaryName, primaryRole}`. If `opts.fireAlerts`: `notifyChLevelLeadsGs_(region, chLevelRms, rmToLeads,
  dateLabel, ledger)`. Unresolved RMs: Region_Recipients row for the region -> one bucket (legacy Cc + every leadership Cc + P&L); else the
  CH-level backstop bucket to `chLevelEmailGs_()` with **no Cc**. Then `mergeBucketsByAddressGs_`, then the Futwork bucket (to the Futwork route,
  no Cc). TEST MODE rewrites every result to the test address (bucketing kept, real To/Cc carried as `originalTo`/`originalCc`). Returns
  `{results, trulyUnresolved: [] (always - see B-17), chLevelRms}`.
- **`mergeBucketsByAddressGs_(buckets)`** (1267). Pure. Buckets with the same lower-cased To merge into the first: union of `rmNames`, union of
  Cc minus the To and duplicates, `source` concatenated with ` + `. Blank-To buckets pass through.
- **`loadRegionRecipients_(ss)`** (1295). `{region: {to, cc}}` for rows with both region and to (exact, case-sensitive region key).
- **`readLeadsTab_(ss)`** (1319). Tab via `resolveTabName_`; header row 2, data from row 3; `{colIndex, dataRows}` (empty when < 3 rows). Reads retried.
- **`groupChLevelRmsByCh_`** (1344), **`splitSelfAndReportingRmNames_`** (1358), **`groupLeadsByRmAndFlatten_`** (1369). Pure grouping helpers for both CH-level reports.
- **`renderOvernightReportEmailHTML_(opts)`** (1390). Inline-styled HTML shell (eyebrow "Lead Funnel · SLA Monitor", title, region label,
  subtitle, KPI cards, action box, sections with optional accent and region band, footer, fixed signature). Every dynamic value goes through
  `esc_`. Requires `opts.kpis` and `opts.sections` arrays and each section's `columns`/`rows`.

### 2.2 EmailLedger.gs

**Purpose.** EO-1a/1b evidence trail, EO-2 incidents, EO-9/9b recovery driver, plus a day-block writer shared by the daily tabs. Fail-open.

**Constants**

| Name | Line | Value |
|---|---|---|
| `EMAIL_LEDGER_SHEET_` / `EMAIL_LEDGER_EXCLUSIONS_SHEET_` | 112/113 | `'Email_Ledger'` / `'Email_Ledger_Exclusions'` |
| `EMAIL_LEDGER_RETENTION_DAYS_` | 114 | 90 |
| job ids | 115-119 | `allIssues17`, `morning10`, `followup13`, `chLevel10`, `chLevel17` (and `reroute` from EmailReroute.gs) |
| `EMAIL_LEDGER_HEADERS_` | 122 | 23 columns A-W: `email_id, cycle_day, job, region, bucket_label, primary_role, to, cc, subject, leads_planned, planned_at, attempted_at, finished_at, status, status_reason, attempts, message_id, thread_id, leads_sent, lead_ids_json, bounce_status, reply_status, swept_at` (L..T is the contiguous "outcome" span rewritten by every patch; U..W belong to the sweep) |
| `EMAIL_LEDGER_EXCLUSION_HEADERS_` | 125 | `recorded_at, cycle_day, job, region, kind, lead_id, rm, email_id, reason` |
| text columns | 127-129 | ledger `[1,2]`, exclusions `[2,6]`, incidents `[1,2]` (formatted `@`) |
| `EMAIL_LEDGER_STATUS_` | 130 | PLANNED, ATTEMPTING, ACCEPTED, FAILED, UNCONFIRMED, BLOCKED, SKIPPED |
| `EMAIL_LEDGER_JOB_LABELS_` | 136 | human names per job id |
| `DUPLICATE_LEAD_REASON_` | 193 | `'duplicate lead id - the first copy was sent'` |
| `EMAIL_INCIDENT_LOG_SHEET_` / headers | 508/509 | `'Incident_Log'`; 15 columns `incident_id, day, detected_at, job, severity, scope, subject, detail, attention_required, owner, notification, notified_at, continuity, resolved_at, resolution` |
| `EMAIL_INCIDENT_RELEASE_AFTER_MINUTES_` | 511 | 45 |
| `EMAIL_LEDGER_ACTIVE_` / `EMAIL_INCIDENT_SEQ_` | 512/513 | current job's ledger handle; per-execution incident counter |

**Handle shape** (`emailLedgerOpenGs_`): `{ledger, exclusions, rowById: {emailId: sheetRow}, rows: {sheetRow: cachedRowArray}, failures, lastError, disabled}`.

**Functions, in file order**

- **`emailLedgerReplaceDayBlockGs_(sheet, rows, day, label)`** (35). Used by Daily_Checklist / Followup_Tracker (day key in column A). Reads the
  last `min(last-1, max(120, 3*rows))` day cells, counts the trailing run equal to `day`. Same size -> overwrite in place; different size ->
  `deleteRows(first, count)` then append; none -> append. Both writes via `writeUnlessTestModeGs_` (retried). Throws to its callers, which swallow.
  Callers guard `rows.length > 0`.
- **`emailLedgerRecoveryTargetsGs_(ss, now, job)`** (57). Today's (IST) rows of that job with status FAILED, BLOCKED or PLANNED ->
  `[{emailId, region, bucket, status}]`. Never UNCONFIRMED / ATTEMPTING / ACCEPTED / SKIPPED.
- **`emailLateCutoffPassedGs_(now, h, m)`** (65). `now > <IST day of now>T hh:mm:00+05:30` - correct regardless of machine TZ.
- **`emailRecoverBucketsGs_(spec, opts)`** (72). Targets for `spec.job`; none -> log, `{targets:[], cutoff:false, ran:false}`. Past the cutoff and not
  `force` -> log, `{cutoff:true, ran:false}`. Else builds `ids` and `regions` sets, logs, `spec.run(ids, regions)`, `{ran:true}`. Always invoked
  inside `withEmailJobLockGs_` by its callers (AllIssuesEmailer.gs 731, OvernightEmailer.gs 2161/2168).
- **`showEmailLedgerTodayNow()`** (89). Read-only counts of today's ledger rows per status and today's exclusion rows.
- **`emailLedgerReadRowsGs_(sheet, headers, startDayKey)`** (143). Scans column B from the top for the first row with day key `>= start`, then returns
  every row from there to the end as objects with `rowNo`. Assumes rows are in day order (true for append-only tabs).
- **`emailLedgerCol_(name)`** (159) 1-based column. **`emailLedgerDayKeyOfGs_(cell)`** (162) Date -> IST key, else first 10 chars of the text.
- **`emailLedgerIdGs_(job, day, region, role, label, to?)`** (170). `yyyymmdd|job|region|role|label[|to lower]`, `|` in a part -> `/`, whitespace
  collapsed. Deterministic, so a re-run finds its row.
- **`emailLedgerLeadDefectGs_(lead)`** (181). `''` or a reason: no id; id with control chars or > 100 chars; blank `issueLabel`.
- **`emailLedgerSplitLeadsGs_(leads)`** (194). `{valid, defective:[{lead, reason, covered}]}`; a repeated id is defective with `covered: true`.
- **`emailLedgerSentIdsGs_(msg)`** (208). `{messageId, threadId}` from a GmailMessage, `''` on any problem.
- **`emailLedgerStatusForErrorGs_(err)`** (216). BLOCKED if `blockedByGuard`, UNCONFIRMED if ambiguous, else FAILED.
- **`emailLedgerLiveGs_(h)`** (221) `h && !h.disabled`. **`emailLedgerGuardGs_(h, label, fn)`** (224) runs fn; a throw increments
  `h.failures`, sets `lastError`, logs, returns `undefined`.
- **`emailLedgerEnsureSheetGs_(ss, name, headers, textCols)`** (235). Creates the tab (header, frozen row, text format on the text columns for all
  grid rows) or writes the header into an empty tab; otherwise **throws** if any of the first `headers.length` header cells differs. Not retried.
  Also used for Incident_Log, Email_Reroutes and the CycleReport/DailyChecklist/FollowupTracker tabs.
- **`lastRowRetryGs_(sheet)`** (256). `getLastRow()` inside `withRetry_` (the jobs' first log-tab read; commit 000c1e6).
- **`precreateEmailOpsTabsNow()`** (267). Manual. For each Email Ops tab (3 always, 4 when their files exist): retried `getSheetByName`, retried
  ensure, 3 s sleep + flush after each creation. Returns `{created, existed, failed}`.
- **`emailLedgerOpenGs_(ss)`** (296). TEST MODE -> `null` (before touching the active handle). Else builds the handle, sets it active, ensures
  both tabs and indexes column A ids -> row numbers. Any throw -> `disabled: true`, `failures: 1`. None of these reads is retried (B-11).
- **`emailLedgerAppendBlockGs_(sheet, rows, sameFirst, label)`** (321). `startRow = getLastRow()+1` computed once; grows the grid when needed
  (`insertRowsAfter`, +100 spare); then `setValues` at `startRow` via `writeUnlessTestModeGs_`, with a "did my first attempt land" probe. Returns
  `startRow`. Because the row is fixed, a retry overwrites rather than duplicates; the hazard is a *concurrent* writer (B-3).
- **`emailLedgerLoadRowGs_(h, id)`** (335). Caches one ledger row by its indexed row number.
- **`emailLedgerPlanGs_(h, plans)`** (342). For each plan: existing id -> load its row (keeps status and attempts); else fresh. Fresh rows written
  in ONE append: `leads_planned = leadIds.length` (so `leadIds` is mandatory), `planned_at`, `finished_at` + status from `initialStatus`
  (else PLANNED), `attempts 0`, `lead_ids_json` (planned ids). Index and cache updated.
- **`emailLedgerPatchGs_(h, id, label, mutate)`** (366). Loads the row if needed, mutates the cache, rewrites columns L..T with one `setValues`.
  Unknown id (plan failed) -> no-op.
- **`emailLedgerAttemptGs_(h, id)`** (380). Clears the reroute note first, then `attempted_at = now`, `finished_at = ''`, status ATTEMPTING,
  reason `''`, `attempts += 1`.
- **`emailLedgerResultGs_(h, id, result)`** (392). Always consumes the reroute note; appends it to the reason only for ACCEPTED/UNCONFIRMED. Sets
  `finished_at`, status, reason (500 chars), message/thread ids, `leads_sent` (= ids for ACCEPTED, else 0), `lead_ids_json` = **the ids the
  email carried** (overwrites the planned list; `[]` for a failure or skip).
- **`emailLedgerExcludeGs_(h, items)`** (410). One append of `[recorded_at, day, job, region, kind, lead_id, rm, email_id, reason]` rows.
- **`emailLedgerStatusOfGs_(h, id)`** (422). Status from the in-memory cache, `''` if unknown.
- **`emailLedgerFailIfOpenGs_(h, id, reason)`** (431). FAILED only if the cached status is PLANNED/ATTEMPTING.
- **`emailLedgerSkipGs_(h, meta, reason)`** (439). Plans if needed, then SKIPPED. **Unused in production** (tests only; B-18).
- **`emailLedgerTrackSendGs_(h, meta, sendFn)`** (448). Not live -> just `sendFn()`. Else plan (if needed), attempt, run; error -> status from
  `emailLedgerStatusForErrorGs_`, rethrow; success -> ACCEPTED with ids and `meta.leadIds`. Used by both CH-level reports and the reroute resend.
- **`pruneEmailLedgerGs_(h, now)`** (466). Cutoff key = IST day of `now - 90 d`. For each of the two tabs: count the leading rows whose day key is
  non-blank and `< cutoff`, archive them (`archiveRowsToDriveCsv_`, throws -> nothing deleted), `deleteRows(2, old)`. Called once, at the end of
  the 17:00 job (AllIssuesEmailer.gs 433). Does not update any handle's `rowById` (B-4).
- **`emailLedgerFinishGs_(h, label)`** (491). One ops alert (severity LOW) when `h.failures > 0`.
- **`emailLedgerSetActiveGs_` / `emailLedgerResetActiveGs_`** (515/516).
- **`emailLedgerConfirmationLineGs_()`** (519). From the active handle's cached rows (`h.rows` = rows this run planned **or loaded**): counts per
  status -> "CONFIRMATION: N bucket email(s) were handled in this run - A accepted by Gmail, ...". Not live -> "CONFIRMATION UNAVAILABLE".
- **`incidentSeverityGs_(subject)`** (540). CRITICAL: `crashed|did not run|did not finish|is overdue|SKIPPED - another`; HIGH: `TEST MODE|WITHOUT
  its overlap lock|cannot be checked|cannot be resolved`; LOW: `Email ledger:|truncated|log cell`; else MEDIUM.
- **`emailIncidentSheetGs_(create)`** (548). `null` when absent and `!create`; else ensure (throws on a header mismatch).
- **`incidentRecordGs_(info)`** (556). TEST MODE -> `''`. Id `INC-<yyyyMMdd-HHmmss IST>-<per-execution seq>`; row with day (IST text),
  `detected_at` (Date), job, severity, scope (`system` for CRITICAL else `item`), subject (300), detail (1500), attention (`no` for LOW), owner,
  notification `HELD`/`PENDING`, continuity note. One append. Any error -> `''` (logged).
- **`incidentNotifiedGs_(ids, status, continuity)`** (575). Reads the whole id column; for each matching row reads cols K..M and writes
  `[status, now, continuity || old continuity]` (each write retried). Errors logged, never thrown.
- **`releaseHeldIncidentsGs_(now)`** (598). Reads the whole Incident_Log; rows with notification `HELD` and `detected_at` a Date more than 45 min
  old -> one "Held alert(s) released: their job never finished (N)" message, then marks them `RELEASED` / `SEND-FAILED`. Returns the count.

### 2.3 EmailReroute.gs

**Purpose.** Decision D9 bounce escalation. Fail-open: any error leaves the email on its original address. TEST MODE never redirects,
records or re-sends.

**Constants:** `EMAIL_REROUTE_SHEET_ = 'Email_Reroutes'`; headers `created_at, expires_at, dead_email, dead_name, new_email, new_name, new_role,
via, source_email_id, source_job, status, note`; text columns `[3,5,9]`; `EMAIL_REROUTE_DAYS_ = 14`; `EMAIL_REROUTE_MAX_HOPS_ = 6`;
`EMAIL_REROUTE_CACHE_MS_ = 120000`; `EMAIL_REROUTE_RESEND_MAX_HOURS_ = 3`; `EMAIL_REROUTE_JOB_ = 'reroute'`; via values `'hierarchy'` /
`'ops fallback'`. Per-execution state: `EMAIL_REROUTE_CACHE_ = {key, at, entries}`, `EMAIL_REROUTE_NOTE_` (what the last send was redirected
from/to, consumed by the ledger).

**Functions, in file order**

- **`showEmailReroutesNow()`** (29). Read-only list of rows in force.
- **`emailRerouteLowerGs_`** (57), **`emailRerouteSplitGs_`** (60: splits on `,` **and `;`**, keeps case), **`emailRerouteTitleGs_`** (65: title-case),
  **`emailRerouteDateGs_`** (69: Date or parsed, else `null`).
- **`emailRerouteIsActiveGs_(e, atMs)`** (76). `status === 'ACTIVE'` and `created_at <= at < expires_at`.
- **`emailRerouteMapGs_(entries, atMs)`** (84). `{dead lower: row}` for active rows with a non-blank `new_email`; later rows overwrite earlier.
- **`emailRerouteResolveGs_(map, address)`** (96). Follows dead -> new up to 6 hops; a cycle or more hops returns the original address unchanged.
  `{address, changed, entry (last hop), viaOps}`.
- **`emailRerouteTranslateAddressesGs_(to, cc, map)`** (114). To: each resolved, deduped. Cc: a chain ending at an ops-fallback row is
  **dropped**; otherwise resolved; skipped when already in To or Cc. Returns `{to[], cc[], changes[{dead, final, part, entry}]}` (a change is
  recorded even when the replaced Cc is then dropped as a duplicate of a To).
- **`emailRerouteLabelGs_`** (138). **`emailRerouteBannerGs_(toChanges)`** (143) amber HTML box (text escaped) + plain prefix
  "RE-ROUTED TO YOU: ...". **`emailRerouteNoteTextGs_(changes)`** (161) the ledger note.
- **`emailRerouteNextGs_(data, deadEmail, nameHint, opsEmail)`** (169). Pure. `null` when the dead address is blank or is the ops address. Finds every
  Manager_Directory name whose address is the dead one (the hint first); for each, walks that person's RM_Hierarchy row `tl, tm, rh, ch` and
  returns the first manager with a directory address different from the dead one (`via 'hierarchy'`, role from that manager's own row).
  Nothing found -> the ops address (`via 'ops fallback'`, name from the directory or `'Ops'`).
- **`emailRerouteWindowOpenGs_(row, now)`** (195). Cutoff by job on the IST day of `finished_at`: allIssues17 -> 18:30, morning10 -> 12:45,
  followup13 -> 16:00 (constants from AllIssuesEmailer/OvernightEmailer). Any other job (i.e. `reroute`) -> within 3 h of its own send.
- **`emailRerouteEffectiveAddressesGs_(row, entries)`** (208). Addresses the email really went to, using the rows in force at `finished_at`; `[]`
  when nothing was redirected. Used by the sweep's bounce matcher.
- **`emailRerouteReadEntriesGs_(ss)`** (220). All rows as objects with `rowNo` (not retried).
- **`emailRerouteSsKeyGs_`** (231), **`emailRerouteResetCacheGs_`** (235).
- **`emailRerouteEntriesCachedGs_()`** (238). The table at most once per 2 minutes per execution; unreadable -> `[]` (logged).
- **`emailRerouteRecordGs_(ss, spec, now)`** (250). Fresh read; if an active row exists for the dead address return it; else ensure the tab, append
  one ACTIVE row valid 14 days (`emailLedgerAppendBlockGs_`, so TEST-MODE-safe), reset the cache, return `{created: true, row}`.
- **`endAllEmailReroutesNow()`** (268). Manual: sets `status = ENDED` on every row in force (plain `setValue`, no retry).
- **`emailRerouteApplyGs_(msg)`** (288). Called by `sendGuardedEmailGs_` and `sendThreadedGmailReply_` (OvernightEmailer.gs 1457) before the gate.
  TEST MODE / no map / no change / empty To -> the same `msg`. Else a copy with translated To/Cc; if a To changed, the banner is prepended to the plain
  body and (when present) the HTML body; sets `EMAIL_REROUTE_NOTE_`. Any error -> original msg.
- **`emailRerouteTakeNoteGs_`** (311) read + clear; **`emailRerouteClearNoteGs_`** (316).
- **`emailRerouteHierarchyGs_(ss)`** (320). `loadRmHierarchyAndEmails_(ss)` (seam for tests).
- **`emailRerouteResendGs_(ss, row, now)`** (324). Reads the original Gmail message by `message_id` (HTML + plain); recomputes the translation with a
  fresh table read and requires a To change; lead ids from `lead_ids_json`; opens a **new ledger handle**; `emailLedgerTrackSendGs_` with id
  `RR|<original id>`, job `reroute`, meta To/Cc = translated; the send itself is `sendGuardedEmailGs_({to: row.to, cc: row.cc, ...})` so the redirect
  and banner happen there. `emailLedgerFinishGs_` in `finally`. Returns `{ok, text}`.
- **`emailRerouteHandleBouncesGs_(ss, items, ledgerRows, now)`** (365). Called by EmailSweep.gs on every sweep with every bounced ledger row (new or
  old). TEST MODE -> every row `TEST_MODE`. Per row: CH-level jobs -> `OPS_REPORT`; no `finished_at` -> `NONE`; compute the addresses really sent
  to; `named` = those whose text appears (substring) in the lower-cased bounce subject+body (To wins over Cc); drop the ops address; none -> `NONE`.
  For each bounced address without an active row: load the hierarchy once (failure -> `ERROR`, retried next sweep), `emailRerouteNextGs_` (hint = the
  17:00 bucket label when the address is that row's To), record the row, re-read the table. Only Cc bounced -> `CC_ONLY`. Otherwise resolve the
  first bounced To; no change -> `ERROR`; an `RR|` ledger row already ACCEPTED/UNCONFIRMED/ATTEMPTING -> `ALREADY`; window closed -> `TOO_OLD`; no
  message id -> `NO_ID`; else resend -> `RESENT` / `RESEND_FAILED`. Any throw -> `ERROR`. Returns `{emailId: {action, text}}`.

---

## 3. Data flow and control flow

**One email job (10:00 / 13:00 / 17:00, and the three recoveries).**
`trigger -> withEmailJobLockGs_(job)` -> `tryLock(30 s)`: busy => SKIPPED alert, nothing else; lock service broken => alert + run anyway ->
`runEmailJobTrackedGs_`: `EMAIL_JOB_RUN_<job> = running` -> `emailAlertHoldStartGs_` (hold on, active ledger cleared) -> job body:
`emailLedgerOpenGs_` (active ledger set) -> per region: `resolveRecipientEmailsForRegion_` -> `emailLedgerPlanGs_` (PLANNED, one append per
region) -> per bucket `emailLedgerAttemptGs_` (ATTEMPTING) -> `sendGuardedEmailGs_` [`emailRerouteApplyGs_` -> `prepareOutgoingEmailGs_` ->
`createDraft().send()` with `withSendRetry_`] -> `emailLedgerResultGs_` (ACCEPTED + Gmail ids, or BLOCKED / UNCONFIRMED / FAILED) -> log row
(`appendRowOnceGs_` in `writeUnlessTestModeGs_`) -> ... -> `notifyLeadSendFailuresGs_` (sent at once) -> (17:00 only) `pruneEmailLedgerGs_` ->
`emailLedgerFinishGs_` -> back in the tracker: record `completed`/`failed` -> `emailAlertHoldFlushGs_` (one ops message: confirmation line + held
alerts) -> rethrow if failed -> release lock.

**Alerts.** Every `notifyOpsAlertGs_` call writes an `Incident_Log` row first. Inside a hold job and not `immediate`: kept in memory (`HELD`) until the
flush; otherwise sent now (`PENDING` -> `SENT` / `SEND-FAILED`). If the job dies, the hourly watchdog sends any `HELD` row older than 45 min
(`RELEASED`). An alert whose incident row could not be written lives only in memory while held (B-1).

**Watchdog (hourly).** For every scheduled job past `hh:mm + 30 min` IST: never started / stuck > 35 min / failed / unreadable, plus the snapshot job's
problems and unresolvable configured addresses; deduped per job per day per kind via `EMAIL_JOB_ALERTED_*`; then releases stale HELD incidents.

**Ledger lifecycle.** `PLANNED` (or planned directly as `SKIPPED` via `initialStatus`) -> `ATTEMPTING` (attempts += 1) -> `ACCEPTED` | `FAILED` |
`UNCONFIRMED` | `BLOCKED`; `SKIPPED` by a recovery that finds nothing to resend; `emailLedgerFailIfOpenGs_` closes an open row as FAILED after an
unexpected bucket error. Recovery (`emailRecoverBucketsGs_`) re-targets today's FAILED / BLOCKED / PLANNED rows of one job until its late cutoff (17:00 ->
18:30, 10:00 -> 12:45, 13:00 -> 16:00), under the job lock; the same email id is reused, so the row moves ATTEMPTING again with attempts 2+. Later the
sweep fills U..W (bounce/reply). Rows older than 90 days are archived to Drive and deleted at the end of a 17:00 run.

**Reroute.** Sweep (10:30/13:30/15:30/17:30, no lock) -> bounce matched -> `emailRerouteHandleBouncesGs_` -> `Email_Reroutes` row (dead -> next manager or ops,
14 days) -> resend of the bounced email as ledger row `RR|<id>` -> from then on every send passing through `sendGuardedEmailGs_` / `sendThreadedGmailReply_`
has the dead To replaced (banner) and a dead Cc replaced or dropped. Logs and the ledger keep the original addresses; the ledger reason records the redirect.

---

## 4. Cross-runtime parity (send gate vs `js/reports-gmail.js`)

| Point | Apps Script | Browser | Note |
|---|---|---|---|
| Address regex | `EMAIL_ADDRESS_RE_` | `GMAIL_ADDRESS_RE` | Identical literal (diffed by `check-runtime-parity.py`). |
| List split | `,` only | `[,;]+` | A `;`-separated `Region_Recipients` cell passes in the browser, is BLOCKED by the backend (B-13). `emailRerouteSplitGs_` also accepts `;`, so the backend result even depends on whether a reroute applies. |
| To required | yes (To must be non-empty) | To **or** Cc non-empty | Intentional (dashboard regions can be Cc-only). |
| Empty HTML string | `''` is checked -> "no visible text" | `''` treated as no HTML | Minor; backend callers always pass real HTML. |
| Visible text | `visibleTextOfHtmlGs_` | `gmailVisibleText` | Identical bodies. |
| Subject CR/LF | collapsed | collapsed | Same. |
| Lead ids | required for report emails, substring check in both parts | not checked | Intentional (browser carries counts). |
| Reroute | applied before the gate | none | The dashboard's manual flow deliberately does not reroute (D9). |

---

## 5. Findings

**B-1 - MED - EmailInfra.gs:362-365 - a held alert whose Incident_Log write failed can be lost silently.**
`notifyOpsAlertGs_` holds the alert (`hold.items.push`) even when `incidentRecordGs_` returned `''`. The only safety net for a job the platform
kills is the watchdog's `releaseHeldIncidentsGs_`, which works from `Incident_Log` rows. Scenario: a Sheets outage ("server error occurred") during
the 17:00 run makes the incident append fail (after `withRetry_` gives up), the alert is held in memory, then the same outage pushes the run past the
platform limit and it is killed: the alert exists nowhere, and `notifyOpsAlertGs_` had returned `true`. The watchdog will still report "did not
finish", but the specific alert (e.g. which bucket failed) is gone. Fix idea: when `incidentId === ''`, send immediately instead of holding.
Confidence: CONFIRMED (code path read end to end).

**B-2 - MED - EmailReroute.gs:390-393 (and EmailSweep.gs:77) - bounce-recipient matching is a plain substring test.**
`text.indexOf(a)` with no address boundaries. Scenario: the email went To `ab@x.in` with Cc `cab@x.in`; a delivery failure for `cab@x.in` contains the
string `ab@x.in` inside `cab@x.in`, so `ab@x.in` is "named" as a bounced **To**: a reroute row redirects a working address for 14 days to that person's
manager (with an alarming banner) and the email is re-sent. The same weakness in `emailSweepMatchBounceGs_` can attach a bounce to the wrong email.
Fix idea: match on a boundary (`(^|[^a-z0-9._%+-])addr($|[^a-z0-9.-])`) or parse the bounce's `Final-Recipient`/`X-Failed-Recipients`.
Confidence: CONFIRMED for the logic; real-world likelihood depends on address naming (short local parts that are suffixes of others).

**B-3 - MED - EmailLedger.gs:321-333 - concurrent appends can overwrite each other's rows; the sweep's "no email job touches it" claim is false.**
`emailLedgerAppendBlockGs_` computes `startRow = getLastRow()+1` once and writes with `setValues` (not the atomic `appendRow`). The bounce sweeps
(10:30/13:30/17:30, nearMinute => can fire from hh:15) run **without** the job lock (EmailSweep.gs:239-241 says the re-send "no email job touches"), yet
`emailRerouteResendGs_` appends an `RR|` row to `Email_Ledger` and records incidents in `Incident_Log`, both of which the running email job also
appends to. Scenario: the 17:00 run starts 17:10 and takes 10+ min (the 3 Oct 13:00 run took 663 s); the 17:30 slot fires 17:16 and re-sends a bounced
10:00... no, a bounced 17:00 email; both compute the same `startRow` within the same second: one row is overwritten, and the job's `rowById` then points
its later patches (columns L..T) at a row now holding the other email's id - mixed evidence. The same applies to `Incident_Log` (watchdog, audits,
sweep, jobs all append without a lock) and `Email_Reroutes`. Confidence: SUSPECTED (needs a sub-second interleave; the code path is confirmed).

**B-4 - LOW (latent until ~2027-01-08) - EmailLedger.gs:466-488 - prune shifts row numbers under other executions' cached row indexes.**
`pruneEmailLedgerGs_` deletes the oldest rows at the end of every 17:00 run once the ledger is older than 90 days. Any other execution that read row
numbers earlier - the 17:30 bounce sweep writes `bounce_status/reply_status/swept_at` as one block starting at `rows[0].rowNo` (EmailSweep.gs:181), and a
reroute resend's ledger handle patches by `rowById` - then writes `old` rows too low: bounce statuses land on the wrong emails, or an `RR|` outcome
overwrites another email's outcome columns. Only possible when the sweep overlaps the end of the 17:00 run (see B-3 timing). Confidence: SUSPECTED.

**B-5 - MED - EmailReroute.gs:352 - the re-sent bounced email goes again to every original Cc recipient.**
`emailRerouteResendGs_` sends with `cc: row.cc` (translated: only the dead / ops-fallback Cc is removed). The leadership Cc, the P&L head, the TL/RH and
any other Cc already received the original; they get a second copy with a banner saying "This email was addressed to X ... Please make sure the leads
below are actioned". D9's text ("the bounced email itself goes to the next person") does not ask for the Cc list to be repeated, and the next person is
usually already one of the Cc's (so they get it twice, once as Cc and once re-routed). Decide whether the resend should go To the replacement only.
Confidence: CONFIRMED (behaviour); whether it is intended is an open question.

**B-6 - LOW - EmailLedger.gs:575-594 + 598-618 - a held alert can be sent twice, the second time claiming its job "never finished".**
After `emailAlertHoldFlushGs_` sends the combined alert, it marks the incidents via `incidentNotifiedGs_`. If that marking fails (a Sheets error past
the retries - the function swallows it), the rows stay `HELD`, and 45+ min later the watchdog re-sends them as "Held alert(s) released: their job never
finished", which is false. Confidence: CONFIRMED.

**B-7 - LOW - EmailLedger.gs:562 - incident ids can collide across executions.**
`INC-<second>-<per-execution counter>`: two executions raising their first alert in the same second (e.g. the watchdog and a job, or two jobs'
"SKIPPED" alerts) both produce `...-1`. `incidentNotifiedGs_` matches by id, so one execution can mark the other's `HELD` row `SENT`, and that held
alert is then never released if its job dies. Confidence: SUSPECTED (needs a same-second collision).

**B-8 - LOW - EmailInfra.gs:653-683 - the gate's lead-id check is a substring test.**
`plainBody.indexOf(id)` / `visible.indexOf(id)`: lead `123456` counts as "present" if `1234567` (or a phone number, KPI or timestamp containing those
digits) is in the body. A report that silently dropped a lead whose id is a substring of another value passes the gate. Lead ids are 7-digit numbers,
so the realistic risk is low, but the gate is described as a hard guarantee. Confidence: CONFIRMED (logic).

**B-9 - LOW - EmailLedger.gs:519-537 - the confirmation line can count an earlier run's emails as "this run".**
It counts every row in `h.rows`, which includes rows **loaded** (not planned) by `emailLedgerPlanGs_` when a same-day re-run or recovery plans an id
that already exists (e.g. an ACCEPTED sibling from the first run). The held alert then says "N accepted by Gmail ... handled in this run" including
emails this run never touched. The comment at 518 admits "planned or loaded"; the message text does not. Confidence: CONFIRMED (depends on which ids a
re-run plans).

**B-10 - LOW - EmailLedger.gs:466-488 / 598 - Incident_Log (and Email_Reroutes) have no retention.**
Only `Email_Ledger` / `Email_Ledger_Exclusions` are pruned. `releaseHeldIncidentsGs_` reads the entire Incident_Log (15 columns) every hour, and
`incidentNotifiedGs_` reads the whole id column on every alert, so their cost grows without bound in a workbook that is already cell-budget-constrained.
Confidence: CONFIRMED (no prune found in any .gs file).

**B-11 - LOW - EmailLedger.gs:296-316 - the ledger open is not retried, so one transient timeout disables the evidence trail for a whole run.**
`emailLedgerEnsureSheetGs_`, `getLastRow` and the id-column read in `emailLedgerOpenGs_` run without `withRetry_` (commit 000c1e6 retried the log tabs'
first reads but not this). A single "Service Spreadsheets timed out" at open -> `disabled` -> no ledger rows for the run; the 16:30 report and the
silent audits then flag `LOG_WITHOUT_LEDGER` and the recovery functions see nothing to recover. Emails are unaffected (by design). Confidence: CONFIRMED.

**B-12 - LOW - EmailInfra.gs:425-452 - "Leads NOT sent" bypasses retries, the hold and Incident_Log, and its wording is 10:00-specific.**
One un-retried `GmailApp.sendEmail`: the P9/F21 lesson (an alert lost to the same outage) applies here too. It is not recorded in `Incident_Log`, so
the 16:30 report's incident list misses it. Its subtitle ("got no automated overnight email") and action ("fixed to this morning's run") are wrong
when the 17:00 All-Issues job sends it. Confidence: CONFIRMED.

**B-13 - LOW - EmailInfra.gs:625-627 vs js/reports-gmail.js:292 - list separator parity.**
Backend splits on `,` only; browser on `,` and `;`. A hand-edited `Region_Recipients` cell with `a@x;b@y` makes every backend legacy-fallback email
for that region BLOCKED, while the same list works in the dashboard. Also `emailRerouteSplitGs_` accepts `;`, so whether such a To is blocked depends on
whether a reroute happens to apply. Confidence: CONFIRMED.

**B-14 - INFO (cross-file) - RmHierarchySync.gs:645 wraps a send in `withRetry_`.**
`withRetry_` retries "timed out" / "service gmail" errors, which are exactly the ambiguous send errors `withSendRetry_` refuses to retry; the nightly sync
report can therefore be delivered twice. Low impact (one ops report), flagged for the RmHierarchySync auditor. Confidence: CONFIRMED.

**B-15 - INFO - EmailInfra.gs:30-42 - stale comment: `resolveRecipientEmailsForRegion_` is not "the single choke point every send path goes through".**
CH-level reports use `chLevelReportToGs_`, ops alerts always go to the real ops address, and `sendGuardedEmailGs_` itself does not enforce TEST MODE - a
caller that builds its own recipients (e.g. a future path, or the reroute resend if its TEST MODE guard in the caller were removed) would send for real.
Also the file header (lines 1-8) lists only OvernightEmailer/AllIssuesEmailer as users. Confidence: CONFIRMED.

**B-16 - INFO - EmailLedger.gs:30-31 - orphaned comment.** "Read-only helper FIRST in the file ... Writes nothing" now sits above
`emailLedgerReplaceDayBlockGs_` (a writer); `showEmailLedgerTodayNow` is at line 89. The run-dropdown rule still holds (every function before it ends in
`_`, so it is private and not in the dropdown), but the comment is misleading. Confidence: CONFIRMED.

**B-17 - INFO - EmailInfra.gs:1186 - `trulyUnresolved` is always `[]`.** Kept for callers (AllIssuesEmailer.gs:372, OvernightEmailer.gs:1190) whose loops
are therefore dead. Confidence: CONFIRMED.

**B-18 - INFO - EmailLedger.gs:439 - `emailLedgerSkipGs_` is unused in production** (only Tests_EmailLedger.gs). Confidence: CONFIRMED.

**B-19 - INFO - EmailReroute.gs:395 - misleading outcome text.** When no recipient of the email appears in the bounce at all (e.g. the sweep matched it by
the 15-minute rule but the address is spelled differently), the outcome says "the bounce names only the ops address". Similarly a manually ENDED reroute
row is ignored when reconstructing where a past email went (`emailRerouteIsActiveGs_` requires ACTIVE), so a bounce of that replacement address is not
recognised. Confidence: CONFIRMED.

**B-20 - INFO - EmailLedger.gs:392-406 - `lead_ids_json` changes meaning from "planned" to "carried".** A FAILED / BLOCKED / SKIPPED result overwrites the
planned list with `[]`, so the ledger no longer shows which leads a failed bucket was meant to carry (only `leads_planned` survives). Documented in the
code comment; worth knowing for anyone investigating a failure from the sheet. Confidence: CONFIRMED.

**B-21 - INFO - docs/EMAIL_OPS_OPERATING_MANUAL.md:157,206 - "released by the watchdog after 45 minutes".** The watchdog is hourly and unpinned, so release
happens at the first watchdog run after 45 min - up to about 1 h 45 min after the alert. Confidence: CONFIRMED.

Things checked and found correct (no finding): IST handling everywhere (`istDayKeyGs_`, explicit `+05:30` cutoffs, `formatDate(...'Asia/Kolkata')`);
`appendRowOnceGs_` retry semantics; `jsonForCellGs_` termination; the lock's fail-open/skip split; run-record overwrite semantics; watchdog deadline maths
for every scheduled job vs its nearMinute window (all fire within hh:mm +/- 15, deadline +30); recovery excludes UNCONFIRMED/ATTEMPTING; reroute loop/hop
cap; banner HTML escaping; TEST MODE short-circuits in every ledger/incident/reroute writer; the 23-column ledger header has been the same since its first
commit (b1dbc3a), so the strict header check cannot have disabled a live ledger created by an older version.

---

## 6. Open questions

1. B-5: should the re-sent bounced email go to the replacement only, or to the full original Cc list as now?
2. The 10:00 / 13:00 triggers (OvernightEmailer.gs:2298-2299) are created without `.inTimezone('Asia/Kolkata')`, unlike the newer triggers; the watchdog's
   deadlines are IST. Is the Apps Script project timezone confirmed as Asia/Kolkata? (Outside these three files; relevant to `emailJobProblemsGs_`.)
3. Should `notifyLeadSendFailuresGs_` go through `notifyOpsAlertGs_`-style retries and be recorded in `Incident_Log` (B-12)?
4. Is Incident_Log meant to be kept forever (B-10)? If not, it can reuse `pruneEmailLedgerGs_`'s archive-then-delete pattern.
5. Should the sweep take the script lock, or should the ledger/incident appends use an atomic `appendRow` (B-3/B-4)? The sweep deliberately avoids the
   lock so it can never make the 17:00 job skip; an atomic append would remove the race without that trade-off.
