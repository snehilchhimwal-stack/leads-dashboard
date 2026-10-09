# GS-004 — EmailInfra.gs

| | |
|---|---|
| **Type** | `GS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `EmailInfra.gs` (1314 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-10-09 against commit `15bec89` - the watchdog schedule lists the three audits; the new recovery jobs hold their alerts (see `## Version / change reference`) |

## Purpose / reason to exist

Shared cross-script email plumbing: the retry wrappers every scheduled
send goes through (`withRetry_`, `withSendRetry_`), the one leads-tab
reader the backend uses (`readLeadsTab_`), region-name mapping
(`mainRegionForGs_`), the **one** place recipient resolution happens for
every scheduled email (`resolveRecipientEmailsForRegion_`), ops alerting,
and the shared HTML email template. It exists so `OvernightEmailer.gs`,
`AllIssuesEmailer.gs`, `DailyRmIssueLog.gs` and `MovementTracker.gs`
don't each re-implement retries, reading the leads tab, or figuring out
who an email goes to.

## Responsibilities

- `withRetry_` / `withSendRetry_` — retry/backoff wrappers.
- `readLeadsTab_` — the backend leads-tab reader (holds `HEADER_ALIASES_`).
- `resolveRecipientEmailsForRegion_` + `loadRegionRecipients_` +
  `ensureRegionRecipientsSheet_` — recipient resolution.
- `mainRegionForGs_` / `normRegionKeyGs_` — region normalisation.
- `passesGoogleNonUtmSearchGs_` — the source filter for the scheduled
  emails.
- `renderOvernightReportEmailHTML_` — the shared email template.
- `notifyOpsAlertGs_` / `notifyLeadSendFailuresGs_` — ops alerting.
- CH-level grouping helpers (`groupChLevelRmsByCh_`,
  `splitSelfAndReportingRmNames_`, `groupLeadsByRmAndFlatten_`).
- **The overlapping-run lock** (2026-10-05) — `withEmailJobLockGs_` wraps each of the three email jobs.
- **The outgoing-email safety gate** (2026-10-05) — `sendGuardedEmailGs_` /
  `prepareOutgoingEmailGs_` and helpers: the single place a report email is
  drafted and sent, after validating the exact payload.

## Trigger schedule

**One**, since 2026-10-05 (email audit P9): `setupEmailJobWatchdogTrigger()` (`FN-334`) installs a single hourly trigger
(`.timeBased().everyHours(1)`, deliberately not pinned to a minute — the watchdog only compares the clock with each job's deadline)
for `emailJobWatchdog`. Everything else in this file is called only from other `.gs` files.

## Requires `setupXxx()` re-run when

Never — no `setupXxx()`, no schedule.

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-196 | `withRetry_(fn, label)` / `withSendRetry_(fn, label)` `#L532/#L578` | a fn + a label | the fn's result, retried on transient failure (`TRANSIENT_ERROR_RE_`, CFG-091) with backoff | logs each retry; may raise after exhausting attempts | — | every scheduled read/send in `GS-001` / `GS-008` / `GS-010` / `GS-011` | reusable — the retry backbone |
| FN-197 | `readLeadsTab_(ss)` `#L1336` | spreadsheet | the parsed `leads` rows + a column index | one Sheets read | `buildColIndex_` (`GS-002`), `HEADER_ALIASES_` | every scheduled emailer | reusable — the one backend leads read |
| FN-198 | `resolveRecipientEmailsForRegion_(ss, region, rmNames, legacyRecipients, opts)` `#L1186` | region + RM names | the `{to, cc}` for that region's email | reads `Region_Recipients` + `RM_Hierarchy` / `Manager_Directory` | `loadRegionRecipients_` (FN-199), `resolveRecipientBucketsForRms_` (`GS-011`) | `GS-001`, `GS-010` | reusable — **the single recipient-resolution point for every scheduled email**; since 2026-10-05 (email audit P7) buckets that resolve to the SAME address are merged into one (`mergeBucketsByAddressGs_`, FN-330) before test mode redirects them, and the Futwork bucket is added after the merge so it stays separate |
| FN-199 | `loadRegionRecipients_(ss)` / `ensureRegionRecipientsSheet_(ss)` `#L1312/#L1123` | spreadsheet | the region→recipients map; ensures the tab | may create `Region_Recipients` | — | FN-198 | reusable |
| FN-200 | `mainRegionForGs_(rawRegion)` / `normRegionKeyGs_(s)` `#L480/#L475` | a raw region | the normalised main region | none | `REGION_GROUP_MAP_` | every scheduled emailer, `GS-008` | reusable — **twin of `mainRegionFor` / `normRegionKey` (`JS-014`)** |
| FN-201 | `passesGoogleNonUtmSearchGs_(groupSourceRaw, sourceBucketRaw)` `#L497` | source fields | bool | none | — | `GS-001`, `GS-010`, `GS-011` | reusable — the source filter for the scheduled digests |
| FN-202 | `renderOvernightReportEmailHTML_(opts)` `#L1407` | report options | the HTML email body | none | `esc_` (`GS-002`) | `GS-001`, `GS-010` | reusable — the shared email template |
| FN-203 | `notifyOpsAlertGs_(subject, bodyLines, opts)` / `notifyLeadSendFailuresGs_(entries)` `#L354/#L425` | alert content | sends an ops-alert email; `notifyOpsAlertGs_` returns `true` when a path sent it | Gmail send — **since 2026-10-05 (email audit P9): GmailApp twice (3 s apart), then the Advanced Gmail Service (`sendOpsAlertViaGmailApiGs_`, FN-331), then gives up (logged, never throws)** | `withSendRetry_` (FN-196) | error paths in every scheduled file | reusable |
| FN-204 | `groupChLevelRmsByCh_(chLevelRms)` / `splitSelfAndReportingRmNames_(chName, rmNames)` / `groupLeadsByRmAndFlatten_(rmNames, rmToLeads)` `#L1361/#L1375/#L1386` | RM/CH names + leads | CH-level grouping for the "blank chain" rollup emails | none | — | `GS-001`, `GS-010` | reusable |
| FN-281 | `isFutworkRmNameGs_(name)` `#L155` | an RM name | bool — does the name contain "Futwork" (case-insensitive)? | none | — | FN-198 | reusable — the single definition of "is this a Futwork-named RM" (added 2026-09-25) |
| FN-283 | `writeUnlessTestModeGs_(fn, label)` `#L194` | a write closure + label | the closure's result, or `undefined` when skipped | runs `fn` through `withRetry_` and then `SpreadsheetApp.flush()` INSIDE the retry, so a deferred write error (e.g. an oversize cell) surfaces inside the caller's try/catch — except in TEST MODE, where it logs and skips (2026-09-25) | `withRetry_` (FN-196) | `GS-001`'s `AllIssues_Log` append; `GS-010`'s `Overnight_Log` append, checkpoint1/2 write-back, `followup_sent_at` | reusable — the single guard that keeps a TEST MODE run from writing production state |
| FN-284 | `chLevelReportToGs_()` `#L249` | none | the To string for a CH-level report | none | — | `GS-001` / `GS-010` CH-level report sends | reusable — `OPS_ALERT_EMAIL_,CH_LEVEL_EMAIL_`, or only the tester in TEST MODE (both sends used to ignore TEST MODE) |
| FN-290 | `regionKeyForRmGs_(rmName, region)` `#L305` | an RM name + its real region | the grouping key: `FUTWORK_REGION_KEY_` for a Futwork RM, else the region | none | `isFutworkRmNameGs_` (FN-281) | `GS-001`, `GS-010` lead grouping | reusable — puts every Futwork lead from every region under ONE key |
| FN-291 | `regionSummaryGs_(items)` `#L308` | items carrying `.region` | `{regions (sorted), counts, label}` e.g. `Pune (3) · Thane (1)` | none | — | FN-292 | reusable |
| FN-292 | `regionHeaderOptsGs_(regionKey, items)` `#L316` | a region key + items | `{region}` or, for the Futwork key, `{region: 'A, B', regionLabel: 'Regions: A (n) · B (m)'}` | none | FN-291 | `GS-001`/`GS-010` email builders | reusable — spells every real region out at the top of a Futwork email |
| FN-293 | `sectionsByRegionGs_(items, sectionsForRegion)` `#L325` | items + a per-region section builder | sections grouped region → RM, the first of each region carrying a `regionBand` | none | — | `GS-001`/`GS-010` email builders | reusable — keeps regions visibly separate inside one email |
| FN-294 | `dedupeByLeadIdGs_(entries)` `#L338` | lead entries | the same list, first occurrence of each `lead_id` only | none | — | `GS-010`'s Section-2 merges | reusable — a merged bucket must never repeat a lead |
| FN-295 | `jsonForCellGs_(entries, label)` `#L232` | a list + a label for the alert | the JSON text for ONE cell, at most `MAX_CELL_JSON_CHARS_` (45,000) characters | if the list is too big, drops trailing entries (10% at a time) and sends ONE ops alert | `notifyOpsAlertGs_` | `GS-001`'s `issue_snapshot_json`, `GS-010`'s `lead_ids_json` / `checkpoint1_json` / `checkpoint2_json` writes | reusable — a write can never exceed Sheets' 50,000-character cell limit |
| FN-298 | `withRegionPnlHeadCcGs_(pnlHeadEmail, to, cc)` `#L181` | a P&L head's address (or blank), the email's To, its Cc list (comma text) | the Cc list with that address added — comma text, or `undefined` when empty | none (pure) | — | `resolveRecipientEmailsForRegion_` (regular buckets and the legacy `Region_Recipients` fallback bucket; NOT the CH-level backstop or the Futwork bucket, which deliberately have no Cc) | specific — **added 2026-09-26** ("add pnl head of Hyderabad and Bangalore in cc"); never Cc's someone who is already the To or already in the Cc (compared case-insensitively) |
| FN-300 | `regionPnlHeadEmailGs_(ss, region, hierarchyData)` `#L166` | the spreadsheet, a region name, optionally the hierarchy data a caller already loaded | the region's P&L head's email address, or `''` | reads `RM_Hierarchy`/`Manager_Directory` via `loadRmHierarchyAndEmails_` (`GS-011`) only when the region has a P&L head configured and no `hierarchyData` was passed; logs (never throws) when the name has no address | `loadRmHierarchyAndEmails_` (`GS-011`) | `resolveRecipientEmailsForRegion_`, once per call | specific — **added 2026-09-26**; the region key and the name are matched case- and space-insensitively |
| FN-323 | `prepareOutgoingEmailGs_(msg)` `#L653` (+ `emailAddressListProblemsGs_` `#L625`, `visibleTextOfHtmlGs_` `#L638`) | `{to, cc, subject, plainBody, htmlBody, leadIds}` | `{msg, problems[]}` — the normalised payload (CR/LF collapsed in the subject) and every reason it must not be sent: bad/missing To/Cc, blank subject, whitespace-only plain body, HTML with no visible text, and (when `leadIds` is given) an empty lead list or a counted lead missing from the HTML body OR from the plain-text body | none (pure) | — | `sendGuardedEmailGs_`; `GS-010` `sendThreadedGmailReply_` and `sendCombinedFollowupEmail_` (the 13:00 pre-gate) | reusable — **added 2026-10-05 (email audit P1)**; since P2 the plain-text part must also list every counted lead |
| FN-324 | `sendGuardedEmailGs_(msg, label)` `#L707` (+ `sendBlockedErrorGs_` `#L697`) | the same `msg` + a label | the sent `GmailMessage` | validates first; on a problem throws an Error with `.blockedByGuard = true` and `.guardProblems` BEFORE any draft exists; otherwise `createDraft(...).send()` inside `withSendRetry_` | `prepareOutgoingEmailGs_`, `withSendRetry_` | `GS-010` (`sendOneOvernightEmail_`, `sendCombinedMorningEmail_`, `notifyChLevelLeadsGs_`, the 13:00 fallback), `GS-001` (`sendOneAllIssuesEmail_`, `notifyChLevelIssuesGs_`) | reusable — **added 2026-10-05**; the ONLY `createDraft` call in the emailers. Ops alerts deliberately stay on `GmailApp.sendEmail` so an alert can always go out |
| FN-325 | `plainTextFromReportOptsGs_(opts)` `#L1082` / `plainTextReportGs_(opts)` `#L1106` / `plainTextTwoSectionGs_(s1, s2)` `#L1111` | the same opts object `renderOvernightReportEmailHTML_` takes (one section) or two of them | the plain-text twin: title, region line (or `regionLabel`), subtitle, KPIs, recommended action, each section's heading/subheading + column header + rows (a blank cell stays blank; a region band is kept), footer, and ONE signature | none (pure) | — | `GS-010` (`sendOneOvernightEmail_`, `sendCombinedMorningEmail_`, `sendCombinedFollowupEmail_`, `notifyChLevelLeadsGs_`), `GS-001` (`sendOneAllIssuesEmail_`, `notifyChLevelIssuesGs_`) | reusable — **added 2026-10-05 (email audit P2)**; replaces the one-line "Open this email in Gmail for the full breakdown" stub, so a text-only client/preview shows the leads. Each email still opens with its old one-line count summary |
| FN-327 | `withEmailJobLockGs_(jobName, fn)` `#L773` | a job name + the job body | `true` if the body ran, `false` if it was skipped | since 2026-10-05 (email audit P9) ALSO records the run (`running` -> `completed`/`failed`, `FN-332`) and alerts when the job starts in TEST MODE; takes the script-wide `LockService` lock (waits `EMAIL_JOB_LOCK_WAIT_MS_`), runs `fn`, releases the lock in a `finally`; on contention SKIPS the job and sends ONE ops alert; **fails open** — if the lock service itself errors (`getScriptLock`/`tryLock` throws) the body still runs and ops are alerted "ran WITHOUT its overlap lock"; with no `LockService` at all it just runs the body | `notifyOpsAlertGs_` (`FN-203`) | `GS-010`'s `sendOvernightMorningEmails` / `sendOvernightFollowupEmails`, `GS-001`'s `sendAllIssuesEmails` (their trigger entry points) | reusable — **added 2026-10-05 (email audit P4)**; a skipped job is not retried |
| FN-328 | `isAmbiguousSendErrorGs_(err)` `#L692` | an error (object or string) | `true` when the wording says the send MAY still have been delivered (timeout, deadline, internal/server/backend error, service failed/unavailable, empty response, socket/network, 500/502/503/504); `false` for a definite refusal ("operation not allowed", bad argument, quota, "Not found") | none (pure) | — | `GS-010`'s `sendThreadedGmailReply_` (tags the thrown error `sendOutcomeUnknown`) and `sendCombinedFollowupEmail_` (classifies the fallback's error) | reusable — **added 2026-10-05 (email audit P6)**; a short allow-list: anything not listed is treated as a definite failure |
| FN-329 | `appendRowOnceGs_(sheet, row, keyIndex)` `#L208` | a sheet, the row to append, and the index of its identity column (the Gmail thread id) | a closure to hand to `withRetry_` / `writeUnlessTestModeGs_`; calling it appends the row and returns `true`, or returns `false` when this write already landed | its FIRST attempt just `appendRow`s (no extra read); a RETRY first reads the last `APPEND_ONCE_TAIL_ROWS_` rows' key column and does nothing if its own key is there | — | the three log appends: `GS-010` (`sendOneOvernightEmail_`, `sendCombinedMorningEmail_`) and `GS-001` (`sendOneAllIssuesEmail_`) | reusable — **added 2026-10-05 (email audit P7 / F10)**; Sheets can write a row and then time out, and the retry used to append a second identical row; a blank key cannot be matched, so it appends as before |
| FN-330 | `mergeBucketsByAddressGs_(buckets)` `#L1284` | resolved recipient buckets `{to, cc, rmNames, source, bucketLabel, primaryRole}` | the same list with buckets that share a To address (case/space-insensitive) merged: first bucket's label/role/address kept, union of RM names, union of Cc (never the To address, never a repeat), sources joined with ` + ` | none (pure; input not modified) | — | `resolveRecipientEmailsForRegion_` (FN-198) | reusable — **added 2026-10-05 (email audit P7 / F9)**; buckets with no To address are never merged (the send gate reports them) |
| FN-331 | `sendOpsAlertViaGmailApiGs_(subject, body)` `#L395` / `istStampGs_(date)` `#L407` | an alert subject + body / an optional date | the Gmail API send result / `"yyyy-MM-dd HH:mm:ss"` in IST | the first sends a plain-text raw MIME message to `OPS_ALERT_EMAIL_` through the Advanced Gmail Service (non-ASCII subject as an RFC 2047 encoded word, line breaks collapsed); the second is pure | — | `notifyOpsAlertGs_` (FN-203) / every log stamp in `GS-010`, `GS-001` | reusable — **added 2026-10-05 (email audit P9 / F12, F21)**; the second send path needs no new OAuth scope; `istStampGs_` is the one place log stamps come from, so they are taken at the write, not at the job's start |
| FN-332 | `emailJobScheduleGs_()` `#L827` / `readEmailJobRunGs_(jobName)` `#L856` / `writeEmailJobRunGs_(jobName, record)` `#L865` / `runEmailJobTrackedGs_(jobName, fn)` `#L879` | a job name (+ record / body) | the schedule `{job: {hour, label}}`; a job's latest run record (object, `null`, or `{unreadable}`); a write result; (runs the body) | the run record is ONE Script Property per job, `EMAIL_JOB_RUN_<job>` = `{day, startedAt, finishedAt, status: running\|completed\|failed, error}`; a failure is re-thrown; TEST MODE writes nothing and alerts ops; every Properties call is wrapped (a broken service never stops a job) | `istDayKeyGs_` (`GS-002`), `notifyOpsAlertGs_` (FN-203) | `withEmailJobLockGs_` (FN-327); the watchdog (FN-333) | reusable — **added 2026-10-05 (email audit P9 / F20, F21)**; holds only the LATEST run per job |
| FN-333 | `emailJobProblemsGs_(now)` `#L679` / `checkEmailJobsCompletedGs_(now)` `#L708` / `emailJobWatchdog()` `#L736` / `emailJobWatchdogNow()` | `now` | `[{job, kind, detail}]` — `kind` is `never_started` (no record for today, deadline = scheduled hour + `EMAIL_JOB_DEADLINE_MINUTES_`), `stuck` (still `running` more than `EMAIL_JOB_MAX_RUN_MINUTES_` after it started), `failed`, or `unreadable` | `checkEmailJobsCompletedGs_` alerts ops ONCE per job per day per kind (`EMAIL_JOB_ALERTED_<job>` = `day\|kind` in Script Properties; `unreadable` is never de-duplicated); since 2026-10-07 (P13) it ALSO alerts, once a day per set of problems, when a configured address cannot be resolved from the private employee table (`emailConfigProblemsGs_`, FN-339); since 2026-10-07 (P16) it ALSO checks the Movement_Log snapshot job: `snapshotRunProblemsGs_` (`GS-008` FN-344) contributes at most one `{job: 'snapshotPeriodic', kind: stuck\|failed\|overdue\|degraded, marker, hint}` problem, alerted once per RUN (its `marker`, not once per day) with its own hint; `emailJobWatchdog` never throws (alerts "WATCHDOG itself failed" instead) | `readEmailJobRunGs_` (FN-332), `notifyOpsAlertGs_` (FN-203) | the hourly trigger (`FN-334`) | specific — **added 2026-10-05 (email audit P9 / F21)**; a quiet day is a `completed` record, so it cannot false-alarm the way "no log rows today" would |
| FN-334 | `setupEmailJobWatchdogTrigger()` `#L1008` / `showEmailJobRunsNow()` `#L1017` | none | installs ONE hourly trigger for `emailJobWatchdog` (deleting only its own earlier trigger) / logs each job's latest run record (and `snapshotPeriodic`'s) | creates / deletes a time-based trigger / `Logger.log` | `ScriptApp` | a person, once after pasting this file | specific — **added 2026-10-05 (email audit P9)** |
| FN-336 | `wasChReportSentTodayGs_(kind, region, chName)` `#L281` / `markChReportSentGs_(kind, region, chName)` `#L287` (+ `readChReportsTodayGs_` `#L269`, `chReportKeyGs_` `#L265`, `chReportPropertyGs_` `#L268`) | a report kind (`CH_REPORT_KINDS_`), a region, a CH name | `true`/`false` — was this report already sent today? / `true` when the key was recorded | reads/writes ONE Script Property per kind, `EMAIL_CH_REPORTS_<kind>` = `{day, keys: ['<region>\|<ch>', ...]}` (today's keys only — replaced when the IST day changes); the key is trimmed and lower-cased; **fails open** (an unreadable/unwritable record reads as "not sent" and never throws); **TEST MODE neither reads nor writes it** | `istDayKeyGs_` (`GS-002`) | `GS-010`'s `notifyChLevelLeadsGs_` (FN-238), `GS-001`'s `notifyChLevelIssuesGs_` (FN-177) | reusable — **added 2026-10-05 (email audit P10 / F11)**; the region guards read log rows, which a region with ONLY CH-level leads never gets |
| FN-338 | `resolvedEmailForNameGs_(name)` `#L66` / `opsAlertEmailGs_()` `#L86` / `chLevelEmailGs_()` `#L109` / `futworkRouteEmailGs_()` `#L120` (+ `warnEmailConfigOnceGs_` `#L76`) | a person's name / none | the lower-cased address from the private employee table (`lookupEmployeeEmail_`, `GS-011`), or the role's fallback | none (pure apart from a once-per-run `Logger.log` warning); an override (the blank-in-prod `*_EMAIL_` variable) wins; **ops** falls back to the Spreadsheet's owner (needs no extra scope), **CH-level** and **Futwork** fall back to the ops address; never throws | `lookupEmployeeEmail_` (`GS-011`) | every production read of the ops / CH-level / Futwork address: `notifyOpsAlertGs_`, `notifyLeadSendFailuresGs_`, `chLevelReportToGs_`, `resolveRecipientEmailsForRegion_`, `GS-009`'s weekly summary, `GS-001`'s `testModeRowsRecipientGs_` | reusable — **added 2026-10-07 (email audit P13 / F24)**; read an address ONLY through these, never the variable |
| FN-339 | `emailConfigProblemsGs_()` `#L130` / `showEmailConfigNow()` `#L147` | none | `[{key, detail}]` for every configured name that does not resolve (ops, CH, Futwork, each leadership name); `showEmailConfigNow` logs where each address comes from + the problems | `Logger.log` only | `resolvedEmailForNameGs_` (FN-338), `alwaysCcEmailsGs_` (`GS-011` FN-340) | `checkEmailJobsCompletedGs_` (FN-333, once-a-day alert); a person after a deploy (run `showEmailConfigNow()` and read the Executions log) | specific — **added 2026-10-07 (email audit P13)**; an override counts as resolved, so a test run raises nothing |
| FN-391 | `emailAlertHoldStartGs_(jobName)` / `emailAlertHoldFlushGs_()` / `sendOpsAlertNowGs_(subject, bodyLines)` + `EMAIL_ALERT_HOLD_JOBS_` | a job name / none / an alert | none / none / `true` when some path sent it | while one of the three email jobs runs, `notifyOpsAlertGs_` records each alert in `Incident_Log` (`GS-015`) and holds it; the flush after the job sends them as ONE message that opens with the ledger's count of emails accepted; `opts.immediate` (the three whole-job crash alerts) sends at once; `sendOpsAlertNowGs_` is the former body of `notifyOpsAlertGs_` (two GmailApp tries, then the Gmail API) | `incidentRecordGs_`, `emailLedgerConfirmationLineGs_` (`GS-015`) | `runEmailJobTrackedGs_` (FN-332), every alert caller | specific - `GS-015` RULE-047 |
| FN-408 | `leadsFreshnessLevelGs_(ageHours)` / `leadsFreshnessFromRowsGs_(colIndex, dataRows, now)` / `staleLeadsNoticeSectionGs_(freshness)` / `staleLeadsNoticeFromRowsGs_(colIndex, dataRows, now)` | an age in hours / the Leads tab's header map and rows, the time / a freshness reading | GREEN / AMBER / RED; `{level, ageHours, newest, text}` (UNKNOWN when no row has a lead assignment time; times more than 1 h in the future are ignored); the red "Data freshness notice" section for a RED reading, else `null`; the same, fail-open (`null` on any error) | none (pure) | `getVal_` (`GS-002`) | `GS-001` `sendAllIssuesEmails_`, `GS-010` `sendOvernightMorningEmails_` / `sendOvernightFollowupEmails_` (each passes the section into every email it builds), `GS-016` `cycleLeadsFreshnessGs_` (FN-404) | reusable - `GS-016` RULE-054 (the levels) and RULE-057 (the notice) |

## Config constants — `CFG-XXX` sub-table

| ID | Constant | Value | Meaning | Changing it affects |
|---|---|---|---|---|
| CFG-037 | `HEADER_ALIASES_` | column → `[accepted header names]` | the backend's column vocabulary | `readLeadsTab_` / `buildColIndex_`; **twin `HEADER_ALIASES` (`JS-009` CFG-022)** — `LOGIC_AUDIT.md` Part 4 §4.8 (small diff; **`project_region` missing here** feeds the HIGH Loan finding) |
| CFG-038 | `REGION_GROUP_MAP_` | region-group map | region normalisation | `mainRegionForGs_`; **twin `REGION_GROUP_MAP` (`JS-014` RULE-017)** — audited consistent (`LOGIC_AUDIT.md` Part 4 §4.3) |
| CFG-039 | `TEST_MODE_OVERRIDE_EMAIL_` `#L43` | `''` (unset) | if set, redirects **every** scheduled-email recipient to one address, silently — and, since 2026-09-25, a TEST MODE run also writes NO production state (log rows, checkpoint columns, `followup_sent_at`), bypasses the region/follow-up idempotency guards, routes CH-level reports and Section-2-only buckets to the tester too, and tags the digest subject `[TEST MODE]` (`FN-283`/`FN-284`) | `resolveRecipientEmailsForRegion_` — the backend twin of the `reports-ui.js` footgun (`JS-016` CFG-024); `LOGIC_AUDIT.md` Part 1 §4d / Part 6 |
| CFG-040 | `ALWAYS_CC_EMAILS_` | a CC list | addresses CC'd on every scheduled email — **except** the CH-level backstop path (`bucketLabel: 'Unmatched RMs (backstop)'`, no `RM_Hierarchy` match and no `Region_Recipients` fallback either), fixed 2026-09-24 to deliberately exclude leadership, matching the sibling `notifyChLevelLeadsGs_`/`notifyChLevelIssuesGs_` backstop's own "not leadership" rule | recipient resolution |
| CFG-067 | `FUTWORK_ROUTE_EMAIL_` `#L119` / `FUTWORK_ROUTE_NAME_` `#L63` | `''` (blank override) / name `'Snehil Chhimwal'` | the ONLY address any RM whose name contains "Futwork" (tele-calling vendor agents) is ever emailed — never their manager chain, `Region_Recipients`, the CH backstop, or the leadership Cc. Since 2026-10-07 (email audit P13) the repo holds only the NAME; the address is looked up from the private employee table by `futworkRouteEmailGs_()` (FN-338), falling back to the ops address. The `let` is a test override (blank in prod), assigned in `Tests_Mocks.gs` |
| CFG-068 | `FUTWORK_REGION_KEY_` `#L304` | `'Futwork'` | the single pseudo-region every Futwork RM's leads are grouped under, so each job sends ONE Futwork email; each lead keeps its real `.region` for display (added 2026-09-25) | `GS-001`/`GS-010` lead grouping, the renderer's region bands, `loadYesterdaysAllIssuesBucketsGs_`'s legacy-row normalization |
| CFG-069 | `MAX_CELL_JSON_CHARS_` `#L231` | `45000` | the most characters `jsonForCellGs_` will put in one log cell (Sheets rejects >50,000; the headroom is deliberate) (added 2026-09-25) | every JSON log-cell write |
| CFG-070 | `REGION_PNL_HEAD_CC_` `#L162` | `{ Hyderabad: 'Mukesh Mishra', Bangalore: 'Mukesh Mishra', Thane: 'Shitij Kaushal', 'Navi Mumbai': 'Shitij Kaushal' }` (names, not addresses - the repo is public; the address comes from Manager_Directory) | the P&L head Cc'd on every automatic email for that region — the 17:00 All-Issues email, the 10:00 combined email, the 13:00 threaded reply (the 10:00 Section-2-only and 13:00 sends use the Cc STORED at 17:00 / 10:00, so a new entry reaches them from the next 17:00 run) (added 2026-09-26; source: the HR export's P&L column — Mukesh Mishra for both teams) | `regionPnlHeadEmailGs_` (`FN-300`) / `withRegionPnlHeadCcGs_` (`FN-298`) — add a region here to Cc its P&L head; `let` so `Tests_Mocks.gs` can reassign it |
| CFG-085 | `EMAIL_ADDRESS_RE_` `#L622` | `/^[^\s@<>,;"()\[\]\\]+@[^\s@<>,;"()\[\]\\]+\.[^\s@<>,;"()\[\]\\]+$/` | the address shape the safety gate accepts: one plain address, no display name, no whitespace/quotes/brackets/commas (so a CR/LF header-injection payload can never pass). Checked 2026-10-05 against all 7,854 addresses in `Manager_Directory`, `Region_Recipients`, `Overnight_Log` and `AllIssues_Log` — none rejected (added 2026-10-05) | `emailAddressListProblemsGs_` (`FN-323`) — tightening it blocks mail; a `;`-separated list is rejected (Gmail wants commas) |
| CFG-086 | `EMAIL_JOB_LOCK_WAIT_MS_` `#L772` | `30000` | how long a second email job waits for the script lock before it skips itself and alerts ops (added 2026-10-05) | `withEmailJobLockGs_` (`FN-327`) — raising it lets a job wait out a longer overlap; the Apps Script execution limit is 30 minutes |
| CFG-087 | `APPEND_ONCE_TAIL_ROWS_` `#L207` | `100` | how many of the sheet's last rows a RETRIED log append searches for its own row (`appendRowOnceGs_`, FN-329) — a row that just landed is always among the last few |
| CFG-088 | `EMAIL_JOB_DEADLINE_MINUTES_` `#L825` | `30` | a job should have STARTED by its scheduled hour + this many minutes, else the watchdog reports it `never_started` (so the 10:00 job is judged from 10:30) |
| CFG-089 | `EMAIL_JOB_MAX_RUN_MINUTES_` `#L826` | `35` | a run still `running` this long after it started is reported `stuck` (it died) — Apps Script's own execution cap is 30 minutes |
| CFG-090 | `CH_REPORT_KINDS_` `#L264` | `{ overnight: 'overnight', allIssues: 'allissues' }` | the two CH-level report types tracked separately by `FN-336` (the 10:00 overnight report and the 17:00 issues report); each is its own Script Property, `EMAIL_CH_REPORTS_overnight` / `EMAIL_CH_REPORTS_allissues` |
| CFG-091 | `TRANSIENT_ERROR_RE_` `#L531` | `/timed out\|service (spreadsheets\|gmail\|error)\|internal error\|server error occurred/i` | the error wording `withRetry_` (FN-196) treats as Google's own transient hiccup and retries (4 attempts, 2 s + 4 s + 6 s backoff). `server error occurred` was added 2026-10-07 (email audit P12 / F22) — the platform's "We're sorry, a server error occurred. Please wait a bit and try again." ended the 2 Oct 13:00 run `Failed`. Deliberately narrow: a permanent refusal (quota, permission) is still thrown on the first attempt |
| CFG-092 | `OPS_ALERT_NAME_` `#L61` / `CH_LEVEL_NAME_` `#L62` / `FUTWORK_ROUTE_NAME_` `#L63` (+ blank overrides `OPS_ALERT_EMAIL_` `#L85`, `CH_LEVEL_EMAIL_` `#L108`, `FUTWORK_ROUTE_EMAIL_` `#L119`) | `'Snehil Chhimwal'` / `'Ashish Ivlekar'` / `'Snehil Chhimwal'`; the three `*_EMAIL_` overrides are `''` | **added 2026-10-07 (email audit P13 / F24)** — the people the ops-alert, CH-level and Futwork-route addresses belong to. The repository is public, so it holds only these NAMES; each address is looked up from `RmHierarchy.private.gs` (git-ignored) at the moment it is needed, via the accessors in FN-338. Personnel change = edit the name here AND add the person's row to the private file |
| CFG-114 | `LEADS_FRESH_AMBER_HOURS_`, `LEADS_FRESH_RED_HOURS_` | `12`, `24` | the Leads-tab freshness thresholds in hours (decisions D4 and D7: stale = at least 24 h; changed from 3 / 5 on 2026-10-09); moved here from `CycleReport.gs` on 2026-10-09 so every emailer shares them | the 16:30 report's AMBER/RED and the bottom notice on every email (RED only) |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-063 | a transient Sheets read / Gmail send failure | `withRetry_` / `withSendRetry_` retry with backoff | the operation usually succeeds on a later attempt; a persistent failure raises |
| EXC-064 | `RmHierarchy.private.gs` absent → resolved emails `''` | `resolveRecipientEmailsForRegion_` falls back to `Region_Recipients` then `CH_LEVEL_EMAIL_` | email still sends, to a generic fallback (`GS-011`) |
| EXC-065 | `TEST_MODE_OVERRIDE_EMAIL_` left set after testing | **no guard** — silently redirects every recipient | every scheduled email goes to one address, no indicator (`LOGIC_AUDIT.md` Part 6/7) |
| EXC-132 | the freshness check itself fails (unreadable rows) | `staleLeadsNoticeFromRowsGs_` catches it and returns `null` | the email goes out without the notice - the warning can never stop an email |

## Data lineage

`leads` tab (`SHEET-001`) → `readLeadsTab_` (FN-197) → parsed rows +
column index, consumed by every scheduled emailer. Recipient resolution:
region + RM names → `resolveRecipientEmailsForRegion_` (FN-198) reading
`Region_Recipients` (`SHEET-012`) + `RM_Hierarchy` (`SHEET-006`) +
`Manager_Directory` (`SHEET-007`) → `{to, cc}`. Full flow: `DATA-005`.

## Sheets touched

| `SHEET-XXX` | Read / Write | Which `FN-XXX` | Notes |
|---|---|---|---|
| `SHEET-001` `leads` | Read | FN-197 | the one backend leads read |
| `SHEET-012` `Region_Recipients` | Read + ensure | FN-199 | recipient fallback; created if missing |
| `SHEET-006` `RM_Hierarchy` | Read | FN-198 (via `GS-011`) | routing |
| `SHEET-007` `Manager_Directory` | Read | FN-198 (via `GS-011`) | employee emails |

## Failure / error behaviour

Retries absorb transient failures; a persistent one raises (shows as
Failed in Executions) and typically triggers an ops alert
(`notifyOpsAlertGs_`). The `TEST_MODE_OVERRIDE_EMAIL_` footgun is
unguarded.

## Cross-runtime duplication

`HEADER_ALIASES_` ↔ `HEADER_ALIASES` (`JS-009`) — `LOGIC_AUDIT.md` Part 4
§4.8. `REGION_GROUP_MAP_` ↔ `REGION_GROUP_MAP` (`JS-014`) — Part 4 §4.3
(consistent). `mainRegionForGs_` ↔ `mainRegionFor` (`JS-014`).
`TEST_MODE_OVERRIDE_EMAIL_` ↔ `TEST_MODE_OVERRIDE_EMAIL` (`JS-016`) —
same footgun shape on both runtimes, both unset (`LOGIC_AUDIT.md` Part 6
findings).

## Not live until pasted

Not running until pasted into the Sheet's Apps Script editor. Run
`setupEmailJobWatchdogTrigger()` ONCE after pasting this file (function dropdown -> Run; safe to re-run) — until then the
watchdog does not exist (the run records and the retrying alert work from the paste alone).

## UI relationships

N/A — backend infra.

## Architecture relationship

Apps Script backend. Layer 18 (backend infra / routing) in
`LOGIC_AUDIT.md` Part 1 §1. Depended on by every scheduled emailer.

## Related documentation

`HANDOVER.md` §2, §4.3; `OPS_CHECKLIST.md` (Manager_Directory email
gaps); `LOGIC_AUDIT.md` Part 1 §4d, Part 3 §3.7, Part 4 §4.3/§4.8, Part
6 findings; `CLAUDE.md`.

## Relationships

- **Depends On:** `GS-017` (`EmailSweep.gs` - `EMAIL_SWEEP_HOUR_` / `_MINUTE_`, read by `emailJobScheduleGs_` behind a `typeof` guard), `GS-016` (`CycleReport.gs` - `CYCLE_REPORT_HOUR_` / `_MINUTE_`, read by `emailJobScheduleGs_` behind a `typeof` guard), `GS-015` (`EmailLedger.gs` - `incidentRecordGs_`, `emailLedgerConfirmationLineGs_`, `releaseHeldIncidentsGs_`, all behind `typeof` guards so the file works before it is pasted), `GS-002` (`Core.gs`), `GS-014` (`RmHierarchySync.gs` — `RMSYNC_RUN_HOUR_`, read by `emailJobScheduleGs_`), `GS-011` (`RmHierarchy.gs` —
  `resolveRecipientBucketsForRms_`, `ALWAYS_CC_EMAILS_`; a file-level
  circular reference, harmless in Apps Script's single namespace),
  `SHEET-001`, `SHEET-006`, `SHEET-007`, `SHEET-012`, `EXT-002`
- **Used By:** `GS-001`, `GS-002`, `GS-003`, `GS-006`, `GS-008`,
  `GS-009`, `GS-010`, `GS-011`, `GS-013`, `GS-014`, `GS-015`, `GS-016`, `GS-017`, `SHEET-012`, `EXT-002`,
  `DATA-002` — every scheduled emailer / logger
- **Related:** `JS-009` (`HEADER_ALIASES` twin), `JS-014`
  (`REGION_GROUP_MAP` twin), `JS-016` (`TEST_MODE_OVERRIDE_EMAIL` twin)

## Source of truth

`EmailInfra.gs` at `HEAD`.

## Validation

- **Method:** full read at `c82ec67`; function list verified by grep;
  `TEST_MODE_OVERRIDE_EMAIL_` confirmed at `#L43` (value `''`);
  cross-check `LOGIC_AUDIT.md` Part 3 §3.7 + Part 4 §4.3/§4.8.
  `Tests_EmailInfra.gs` runs in CI.
- **Evidence:** `.github/workflows/test.yml` (`Tests_EmailInfra.gs`, last
  green run); `LOGIC_AUDIT.md` Part 4 §4.3/§4.8.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-029.

**Revalidated 2026-09-24** `8fe9714`: real production bug fix,
reported directly by the user off a real email
("(Unmatched RMs (backstop)) Navi Mumbai Google Overnight Leads")
that landed with `cc:` the two leadership addresses (Ashish Kukreja, Saurabh Mishra)
(`ALWAYS_CC_EMAILS_`). `resolveRecipientEmailsForRegion_`'s CH-level
backstop branch (`bucketLabel: 'Unmatched RMs (backstop)'` — no
`RM_Hierarchy` match AND no `Region_Recipients` fallback either) was
Cc'ing leadership on a raw "couldn't route this at all" email,
inconsistent with the SAME company-wide backstop's other trigger
(`notifyChLevelLeadsGs_`/`notifyChLevelIssuesGs_`, `OvernightEmailer.gs`/
`AllIssuesEmailer.gs`), which already deliberately excludes leadership
from this class of email ("per explicit request, this goes only to
`OPS_ALERT_EMAIL_` + `CH_LEVEL_EMAIL_`, not leadership" — that
function's own comment). Fixed by removing the `ALWAYS_CC_EMAILS_` Cc
from this ONE branch only — the legacy `Region_Recipients` fallback
branch (`bucketLabel: 'Unmatched RMs'`, a DIFFERENT, less-severe case
where a human HAS configured a fallback address) still Cc's leadership,
unchanged, since the user's report and this fix are both scoped
specifically to the backstop path. `CFG-040`'s own row updated to note
the exception. File grew 552L → 559L (+7); every `#Lnn` citation in
this record re-grepped and corrected. `Tests_EmailInfra.gs` gained 1 new
assertion locking in `cc === undefined` for this exact branch. 899/899
local `.gs` tests pass (+1 new).

**2026-09-25** (`ff91419`): any RM whose name contains "Futwork" is now pulled OUT of `resolveRecipientBucketsForRms_` and emailed only at `FUTWORK_ROUTE_EMAIL_` (`CFG-067`, `FN-281`), as ONE dedicated bucket per region (`bucketLabel: 'Futwork'`, no Cc, no `Region_Recipients`/CH-backstop/`ALWAYS_CC_EMAILS_`). Motivation: Futwork agents (e.g. "Kajal Futwork", manager "Deepali Tharwani Futwork") aren't in `RM_Hierarchy`, so they were falling into the "Unmatched RMs (backstop)" email to `CH_LEVEL_EMAIL_`. Applied at the one choke point, so it covers the 17:00 and 10:00 sends; the 10:00 Checkpoint-1 Section 2 inherits it because it reuses the 17:00 stored recipient. Not re-resolved for already-logged rows (routing is frozen at 17:00). File grew 559L → 570L (+11); every `#Lnn` after line 65 re-mapped. `Tests_EmailInfra.gs` +13 assertions; `Tests_Mocks.gs` save/sets/restores `FUTWORK_ROUTE_EMAIL_`. **Deployed live 2026-09-25**: applied to the Sheet's Apps Script editor as the same three edits, then verified after a full page reload that the saved file's SHA-256 equals the committed file's (`6cf083fa…28d6`, 34,611 chars LF-normalized). No `setupXxx()` re-run needed (no trigger changed). `Tests_Mocks.gs`/`Tests_EmailInfra.gs` were NOT re-pasted into the live project (only matters if `runAllTests` is run there).

**2026-09-25** (`57e5545`): TEST MODE hardening after a real incident — a Step 10 live verification run (TEST MODE, 2026-09-24 10:16) wrote real-looking `AllIssues_Log` rows with the TESTER as recipient, so that day's real 17:00 run skipped every region (managers never got the report) and the next morning's Checkpoint 1 (which reuses the STORED 17:00 recipient) went to the tester instead of managers — 9 of 26 digests. Also found: the CH-level reports and a Section-2-only bucket ignored TEST MODE (real addresses). Added `FN-283`/`FN-284` (+10 lines, 570L → 580L; every `#Lnn` after line 71 re-mapped). Behaviour changes live in `GS-001`/`GS-010`; `Tests_AllIssuesEmailer.gs` +3 and `Tests_EmailLifecycleFullCycle.gs` +23 assertions (verified to fail against the pre-fix code).

**2026-09-25, later** (`684956b`): supersedes the per-region Futwork buckets described above — Futwork leads from EVERY region now share ONE pseudo-region (`CFG-068`), so each job sends ONE Futwork email. Regions stay separate inside it as bands (`sectionsByRegionGs_`), spelled out at the top (`regionHeaderOptsGs_`, the header line + the subject, e.g. "Futwork (Bangalore, Pune) google Leads With Issue"). `renderOvernightReportEmailHTML_` gained two optional inputs, `opts.regionLabel` (replaces the "Region:" line) and `section.regionBand` (a bar above a section). Rows logged before this change (one per real region, `bucket_label` 'Futwork') are re-keyed into the single group when the next 10:00/13:00 loads them, each entry stamped with its row's real region; and the two merges are now de-duplicated by `lead_id` (`FN-294`) — a plain concat repeated every lead once per row, which is what pushed the 2026-09-25 13:00 Checkpoint 2 write past Sheets' 50,000-character cell limit. +44 lines (580L → 624L; anchors re-mapped). New rows `FN-290`..`FN-294`, `CFG-068`; `Tests_EmailInfra.gs`, `Tests_AllIssuesEmailer.gs`, `Tests_EmailLifecycleFullCycle.gs` cover it (18 of them fail with the grouping disabled). **Deployed live 2026-09-25**: `EmailInfra.gs`, `AllIssuesEmailer.gs` and `OvernightEmailer.gs` were each edited in the Sheet's Apps Script editor from the committed diff and verified after a full reload by SHA-256 against the committed files (`9f08cfd5…1683`, `7ac150c3…d6cb`, `7a13ef06…4886`). No `setupXxx()` re-run needed (no trigger changed); first effect at tomorrow's 10:00 (Section 1/2 + legacy re-keying) and 17:00.

**2026-09-25, evening** (`b3a58f9`): 13:00 crash hardening. The 13:00 `sendOvernightFollowupEmails` aborted after 3 of ~26 buckets with "Your input contains more than the maximum of 50000 characters in a single cell" — Sheets reports a bad write on the NEXT sheet call, which sat outside every caller's try/catch. Three layers now: (1) `writeUnlessTestModeGs_` flushes inside the retry so the error surfaces inside the guarded write (`FN-283`); (2) every JSON log-cell write goes through `jsonForCellGs_` (`FN-295`, `CFG-069`), so an oversize list is truncated with one ops alert instead of attempted; (3) `GS-010`'s 10:00 and 13:00 loops catch a per-bucket throw, report it and carry on with the other buckets. The trigger for the incident (polluted test rows + the merge duplicating leads) is fixed separately (`FN-294`). +21 lines (624L → 645L; anchors re-mapped). `Tests_EmailInfra.gs` +13, `Tests_EmailLifecycleFullCycle.gs` +14 assertions; the isolation tests fail if the per-bucket handlers re-throw. **Deployed live 2026-09-25**: the three files were edited in the Sheet's Apps Script editor from the committed diff and verified after a full reload by SHA-256 (`daa128d3…6f38`, `f9622bff…6368`, `e0f30efe…2227`). No `setupXxx()` re-run needed; first effect at tomorrow's 10:00.

**2026-09-26** (`5aafbd4`): region P&L head Cc. `resolveRecipientEmailsForRegion_` looks up the region's P&L head address (`regionPnlHeadEmailGs_`, `FN-300` - by NAME from Manager_Directory, so no address is committed to the public repo) and runs each regular bucket's Cc (and the legacy fallback bucket's) through `withRegionPnlHeadCcGs_` (`FN-298`) using `REGION_PNL_HEAD_CC_` (`CFG-070`): Hyderabad and Bangalore emails Cc Mukesh Mishra (the export's P&L owner for both teams; he was already Cc'd on Bangalore as Cluster Head, Hyderabad had Zoya Fathima only). A name with no Manager_Directory address adds no Cc and logs a line. Not applied to the CH-level backstop or the Futwork bucket (no Cc by design), and TEST MODE still sends with no Cc (the P&L head shows only in the test email's own "would have gone to" line). +35 lines (645L → 680L). Tests: `Tests_EmailInfra.gs` (Cc added / not duplicated / not the To / no address on record / legacy path / no Cc for backstop and Futwork / TEST MODE), `Tests_EmailLifecycleFullCycle.gs` (Cc'd at 17:00, stored, carried through 10:00 and 13:00), `Tests_Mocks.gs` (`REGION_PNL_HEAD_CC_` reset to `{}` during tests). **Deployed live 2026-09-26** (~14:55 IST) with `AllIssuesEmailer.gs` (`GS-001`): exact diff edits, saved, SHA-256 of the saved files matches the committed files. Confirmed `Manager_Directory` has an address for `Mukesh Mishra` (the name `REGION_PNL_HEAD_CC_` points at). First run to watch: today's 17:00 All-Issues (Hyderabad and Bangalore emails should Cc him; the stored Cc in `AllIssues_Log` col F then carries it into tomorrow's 10:00/13:00 sends).

**2026-09-30** (`a1a21b4`): user request "also add pnl head in cc for both the region of each email" — added Thane and Navi Mumbai to `REGION_PNL_HEAD_CC_` (`CFG-070`), both mapped to Shitij Kaushal (the export's P&L owner for both teams — Bipin More/Vidya Jadhav are their Cluster Heads, both reporting up to him for P&L). No mechanism change — same `regionPnlHeadEmailGs_`/`withRegionPnlHeadCcGs_` (`FN-300`/`FN-298`) already built for Hyderabad/Bangalore. +1 line (680L -> 681L). Tests: `Tests_EmailInfra.gs` gained a production-config sanity check (all 4 configured regions have a P&L head, catches a region silently dropped) — the existing mechanism tests already cover the code path generically. **Deployed live 2026-09-30** (~11:20 IST) together with the RM hierarchy roster refresh (`GS-011`): applied as an exact diff edit, saved, SHA-256 of the saved file (trailing-newline-stripped, matching this project's standard live-read formula) equals the committed file. Confirmed `Manager_Directory` has an address for `Shitij Kaushal`.

**2026-10-05** (`fb17144`, email audit P1 — `docs/_planning/EMAIL_AUDIT.md` F3/F4/F14): every report email now goes through ONE gate. `sendGuardedEmailGs_` (`FN-324`) validates the exact payload (`FN-323`, `CFG-085`) before any draft exists and throws `blockedByGuard` on a problem; callers turn that into the same ops alert + "not sent" entry a send failure already produced, and nothing is marked as sent. +97 lines (681L -> 778L; anchors re-mapped by `check-staleness.py --fix-anchors`). `Tests_EmailInfra.gs` +45 assertions (address list, visible-text, payload preparation, guarded send incl. the unchanged retry underneath); behaviour at the call sites is in `GS-010`/`GS-001`. Verified by 9 deliberate regressions, each failing a named test. **Not live until pasted** into the Sheet's Apps Script editor.

**2026-10-05** (`dbeb7da`, email audit P2 — `docs/_planning/EMAIL_AUDIT.md` F13/F15): the plain-text part of every report email is now rendered from the SAME opts as its HTML (`FN-325`) instead of a one-line stub, and the send gate (`FN-323`) now requires every counted lead id in the plain text as well as the HTML. `renderOvernightReportEmailHTML_` (`FN-202`) renders a null/undefined cell blank (it used to print the word "undefined"). +43 lines (778L -> 821L; anchors re-mapped). Tests: `Tests_EmailInfra.gs` (renderer, plain-text twin, gate), `Tests_OvernightEmailer.gs`, `Tests_AllIssuesEmailer.gs`; whole suite 1332 -> 1384; 7 deliberate regressions each fail a named test. **Not live until pasted.**

**2026-10-05** (`6fc3f3c`, email audit P4 — `docs/_planning/EMAIL_AUDIT.md` F5): the three automated email jobs now each run inside `withEmailJobLockGs_` (`FN-327`), one script-wide lock held for the whole run. Their "already sent today?" guards read log rows written only AFTER each send, so overlapping runs would send everything twice. Contention skips the second job and alerts ops; a lock-service ERROR fails open (the job runs, ops are alerted) so a broken lock can never silently stop the daily emails. +51 lines (821L -> 872L; anchors re-mapped). `Tests_Mocks.gs` gained `TestMockLockService_` (deny / throw-on-get / throw-on-tryLock) and saves/restores `LockService`; `Tests_EmailInfra.gs`, `Tests_OvernightEmailer.gs`, `Tests_AllIssuesEmailer.gs` cover free / contended / broken-lock / no-lock-service / job-throws; 7 deliberate regressions each fail a named test; whole suite 1395 -> 1433. **Not live until pasted.** No `setupXxx()` re-run needed (no trigger changed); if Apps Script asks to re-authorize on the first run, approve.

**2026-10-05** (`d1caf9d`, email audit P6 — `docs/_planning/EMAIL_AUDIT.md` F7): `isAmbiguousSendErrorGs_` (`FN-328`) classifies a send error as "may have been delivered" vs "definitely not"; `GS-010` uses it so the 13:00 plain fallback no longer follows an ambiguous threaded failure (which could deliver a duplicate). +10 lines (872L -> 882L; anchors re-mapped). `Tests_EmailInfra.gs` +12 assertions for the classifier; the call-site behaviour is in `GS-010`. **Not live until pasted.**

**2026-10-05** (`6acea29`, email audit P7 — `docs/_planning/EMAIL_AUDIT.md` F9/F10): `appendRowOnceGs_` (`FN-329`, `CFG-087`) makes a log append safe under the retry wrappers (a retry after a write that landed before a timeout no longer appends a second row), and `mergeBucketsByAddressGs_` (`FN-330`) merges recipient buckets that share an address inside `resolveRecipientEmailsForRegion_` (`FN-198`) — the 10:00 job keyed Section 1 by address, so the second bucket overwrote the first and those leads were never emailed. +67 lines (882L -> 949L; anchors re-mapped). `Tests_EmailInfra.gs` gained once-only-append and merge assertions (incl. through the real resolver); 14 deliberate regressions across P7 each fail a named test. **Not live until pasted.**

**2026-10-05** (`fe9b37f`, email audit P9 — `docs/_planning/EMAIL_AUDIT.md` F12/F20/F21): (1) `withEmailJobLockGs_` (`FN-327`) now records each job's run (`FN-332`) in Script Properties — `running`, then `completed`/`failed` — so a job the platform kills is distinguishable from one that never started and from a quiet day; (2) a new hourly trigger, `emailJobWatchdog` (`FN-333`/`FN-334`, `CFG-088`/`CFG-089`), alerts ops once per job per day when a job never started, never finished, or failed — **this file now installs a trigger; run `setupEmailJobWatchdogTrigger()` once after pasting**; (3) `notifyOpsAlertGs_` (`FN-203`) retries GmailApp then falls back to the Advanced Gmail Service (`FN-331`) — the 2 Oct 13:00 failure left no alert at all; (4) `istStampGs_` (`FN-331`) is the single source of log stamps (taken at the write); (5) a job that starts with `TEST_MODE_OVERRIDE_EMAIL_` set alerts ops and writes no run record. +198 lines (949L -> 1147L; anchors re-mapped). `Tests_Mocks.gs` gained `TestMockPropertiesService_`, an `everyHours` trigger-builder step and `Utilities.base64Encode`; both test runners' `Utilities` shims gained `base64Encode`. 29 deliberate regressions across P9 each fail a named test; whole suite 1552 -> 1660. **Not live until pasted.**

**2026-10-05** (`15d74d4`, email audit P10 — `docs/_planning/EMAIL_AUDIT.md` F11): `wasChReportSentTodayGs_` / `markChReportSentGs_` (`FN-336`, `CFG-090`) make a CH-level report go once per day per region + CH. The reports were never logged and the 10:00 / 17:00 region guards only read log rows, so a region with only CH-level leads re-sent the same report on every re-run of the job. Recorded only after a successful send; same-day only; fails open; TEST MODE ignores it. +47 lines (1147L -> 1194L; anchors re-mapped). `Tests_EmailInfra.gs` gained record unit tests (day rollover, normalising, fail-open, test mode); 11 deliberate regressions each fail a named test; whole suite 1660 -> 1700. **Not live until pasted.** To force a same-day re-send, delete the property in Project Settings -> Script properties.

**2026-10-07** (`415be48`, email audit P12 — `docs/_planning/EMAIL_AUDIT.md` F22): `withRetry_` (FN-196) now reads its transient list from the shared constant `TRANSIENT_ERROR_RE_` (`CFG-091`), which includes the platform's own "server error occurred" wording. That error matched none of the old patterns, so the first one from a Sheets call aborted the whole job — very likely the 2 Oct 13:00 failure. Safe to retry: the log appends inside the wrapper are once-only (`FN-329`, P7) and the other writes are idempotent. +8 lines (1194L -> 1202L; anchors re-mapped). `Tests_EmailInfra.gs` gained retry tests (the platform wording as an Error and as a bare string, backoff, 4-attempt cap, existing wording still retried, permanent refusals NOT retried, once-only append + platform error = one row); 6 deliberate regressions each fail a named test; whole suite 1700 -> 1715. **Not live until pasted.**

**2026-10-07** (`c416a01`, email audit P13 — `docs/_planning/EMAIL_AUDIT.md` F24): the ops-alert, CH-level and Futwork-route addresses were string literals in this PUBLIC repository (and the two leadership Cc addresses in `GS-011`). The code now keeps each role's NAME (`CFG-092`) and looks the address up from the git-ignored `RmHierarchy.private.gs` when it is needed, through `opsAlertEmailGs_` / `chLevelEmailGs_` / `futworkRouteEmailGs_` (`FN-338`); the old `*_EMAIL_` variables are blank overrides that only tests assign. No new file and no new Script Property — but `RmHierarchy.private.gs` is now needed for alerts and leadership Cc too. A missing table or person falls back safely (ops -> workbook owner, CH-level/Futwork -> ops address, leadership Cc skipped) and the hourly watchdog alerts once a day naming it (`FN-339`). `showEmailConfigNow()` logs what resolves — **run it after pasting**. Verified against the real private table: every name resolves to exactly the address the repo used to hard-code. The addresses remain in git history (not rewritten). +106 lines (1202L -> 1308L; anchors re-mapped). `Tests_EmailInfra.gs` gained resolution/override/fallback/watchdog tests; `Tests_Mocks.gs`'s `TEST_EMAIL_CH_` is now a plus-address of the maintainer's own gmail (no colleague's corporate address). 22 deliberate regressions each fail a named test; whole suite 1715 -> 1758. **Not live until pasted.**

**2026-10-07** (`7799e44`, email audit P16 / F23): `checkEmailJobsCompletedGs_` (`FN-333`) now also reports the Movement_Log snapshot job — its snapshots are the "calls so far today" baseline behind every email and it hit the 30-minute wall 3 times in 5 days with nothing noticing. `GS-008`'s `snapshotRunProblemsGs_` (`FN-344`) reads the run record `snapshotPeriodic` now leaves (`EMAIL_JOB_RUN_snapshotPeriodic`) and returns at most one problem; a problem may carry its own `marker` (alerted once per run) and `hint` (what to run). `showEmailJobRunsNow` also logs the snapshot record. The hourly watchdog trigger (`setupEmailJobWatchdogTrigger`) must be installed for any of this to alert. +6 lines (1308L -> 1314L). `Tests_EmailInfra.gs` gained the snapshot-watchdog cases. **Not live until pasted.**

**2026-10-08** (`d897529`): `emailJobScheduleGs_` also lists `syncRmHierarchyNightly` (the nightly HR-roster sync, `GS-014`; hour 23, so the hourly watchdog alerts when it has not run by 23:30). Only added when `RMSYNC_RUN_HOUR_` exists, so pasting this file without `RmHierarchySync.gs` does not break the watchdog. **Not live until pasted.**

**2026-10-09** (`b1dbc3a`, Email Ops EO-1a): `prepareOutgoingEmailGs_` (FN-323) also returns `missingLeadIds` - the counted leads absent from a body - and the gate's refusal (`sendBlockedErrorGs_`, FN-324) carries it as `err.missingLeadIds` (empty for any other kind of refusal), so the 17:00 emailer can drop just those leads and resend the rest (`GS-015` RULE-045). Additive: callers that ignore the field behave exactly as before. **Not live until pasted.**

**2026-10-09** (`f46ebc7`, Email Ops EO-2): `notifyOpsAlertGs_` takes an optional `opts` and, inside the three email jobs, holds the alert until the job has ended (`emailAlertHoldStartGs_` / `emailAlertHoldFlushGs_`, FN-391; the former body is `sendOpsAlertNowGs_`); `runEmailJobTrackedGs_` (FN-332) starts and flushes the hold and writes the run record before the flush; `checkEmailJobsCompletedGs_` (FN-333) releases held incidents of a killed job (`GS-015` RULE-048). **Not live until pasted.**

**2026-10-09** (`d79aae5`, Email Ops EO-8): `emailJobScheduleGs_` (FN-332) lists `sendEmailCycleReport` (hour 16, minute 30) once `CycleReport.gs` is part of the project, and `emailJobProblemsGs_` (FN-333) computes a job's deadline from hour:minute plus the 30-minute grace (17:00 for the report; every other job's deadline text is unchanged). **Not live until pasted.**

**2026-10-09** (`c18d89f`, Email Ops EO-5): `emailJobScheduleGs_` (FN-332) also lists `sweepEmailBouncesAndReplies` (hour 15, minute 45) once `EmailSweep.gs` is part of the project. **Not live until pasted.**

**2026-10-09** (`ec0948e`, Email Ops EO-9): `EMAIL_ALERT_HOLD_JOBS_` also lists `recoverAllIssuesBuckets` (the 17:00 recovery job, `GS-001` FN-407). **Not live until pasted.**

**2026-10-09** (`0811d3a`, Email Ops, decision D6): the Leads-tab freshness rules move here from `CycleReport.gs` (`LEADS_FRESH_*_HOURS_` = CFG-114; FN-408) so every emailer shares them, and a RED Leads tab (newest lead assigned at least 24 h ago (changed from 5 h by user decision D7 the same day)) now adds a separate **"Data freshness notice"** section at the very bottom of every email (17:00 bucket and CH-level, 10:00 combined and CH-level, 13:00 reply) - the lead tables above stay complete and **no email is ever held** for it (user decision D6, 2026-10-09). `staleLeadsNoticeSectionGs_` builds the section (a red accent, three plain sentences: how old the newest lead is, that a listed lead may already be handled, check the CRM first); `staleLeadsNoticeFromRowsGs_` is fail-open (EXC-132). `CycleReport.gs` keeps thin wrappers (`GS-016` FN-404). **Not live until pasted.**

**2026-10-09** (`15bec89`, Email Ops EO-9b / EO-3 / EO-4): `EMAIL_ALERT_HOLD_JOBS_` also lists `recoverMorningBuckets` and `recoverFollowupBuckets` (`GS-010` FN-410); `emailJobScheduleGs_` (FN-332) lists the three silent audits of `OpsAudit.gs` (`GS-018`: 11:15, 14:00, 18:00) once that file is part of the project. **Not live until pasted.**

## Revalidation trigger

Any commit touching `EmailInfra.gs` or `Tests_EmailInfra.gs`;
`HEADER_ALIASES_` or `REGION_GROUP_MAP_` changes (check the `js/` twins —
`LOGIC_AUDIT.md` Part 4 §4.3/§4.8); `resolveRecipientEmailsForRegion_`'s
fallback order changes; `TEST_MODE_OVERRIDE_EMAIL_` is used differently;
`Region_Recipients` (`SHEET-012`) schema changes.

## Handover relationship

`HANDOVER.md` §2 names the file ("Shared email plumbing: retry wrappers,
the leads-tab reader, region-name mapping, ops alerting, the HTML email
template"). Current as of 2026-09-09. A `HEADER_ALIASES_` or
`REGION_GROUP_MAP_` change must update `HANDOVER.md` §6 and the `js/`
twin in the same commit.

## Lifecycle / retention

N/A — code. `Region_Recipients` is configuration, not time-series data.

## Next action

none — Closed + Monitored. (The `project_region` gap in `HEADER_ALIASES_`
and the `TEST_MODE_OVERRIDE_EMAIL_` footgun are known `LOGIC_AUDIT.md`
findings — tracked via the revalidation trigger.)

## Closure evidence

Record committed for DOC-029; `docs/INDEX.md` `GS-004` → `Closed +
Monitored`, `Last Verified` 2026-09-10, links recorded; `CFG-037`..`040`
(the backend half of the cross-runtime pairs), `EXC-063`..`065` recorded.
No `docs/changes/` record (DOC-029).
