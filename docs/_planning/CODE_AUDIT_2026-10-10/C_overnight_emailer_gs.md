# Code audit 2026-10-10 — C: `OvernightEmailer.gs`

Auditor C of 9. Read every line of `OvernightEmailer.gs` (2,517 lines at HEAD `19038e7`), in order. Called functions in
`EmailInfra.gs`, `EmailLedger.gs`, `SlaEngine.gs`, `RmHierarchy.gs`, `AllIssuesEmailer.gs` and `MovementTracker.gs` were opened
only far enough to understand each call; other auditors cover them. No code was changed and nothing touched the live Sheet,
Gmail or Apps Script.

---

## 1. Scope and summary

`OvernightEmailer.gs` owns two of the three daily automatic emails, plus their recovery entry points and some manual
tools:

- **10:00 IST, `sendOvernightMorningEmails`**: one combined email per recipient ("bucket"). **Section 1 "Overnight"** lists
  every still-open Google Non-UTM/Search lead assigned between 17:00 IST yesterday and 09:00 IST today, grouped by RM.
  **Section 2 "Checkpoint 1"** re-checks the leads that yesterday's 17:00 All-Issues email (`AllIssues_Log`) reported against
  the live sheet, and lists only those still unresolved. It writes one `Overnight_Log` row per sent email (the thread id
  and the leads that had an SLA issue at send time). It writes `checkpoint1_json`/`checkpoint1_sent_at` back onto the
  `AllIssues_Log` row(s).
- **13:00 IST, `sendOvernightFollowupEmails`**: for each of today's `Overnight_Log` rows, one threaded reply (Advanced
  Gmail API, explicit recipients) into the 10:00 thread. **Section 1 "1pm Follow-up"** lists the morning's issue leads that
  are still flagged for the same issue. **Section 2 "Checkpoint 2"** re-checks this morning's Checkpoint 1 against the live
  sheet. It writes `followup_sent_at`/`followup_result` (Overnight_Log) and `checkpoint2_json`/`checkpoint2_sent_at`
  (AllIssues_Log).

Both jobs run under the script-wide email-job lock. Both record every bucket in the Email Ops ledger (`Email_Ledger`,
fail-open; disabled in TEST MODE). Neither sends or writes when there is nothing unresolved. Recipients are frozen:
Section 1 recipients are resolved at 10:00 (`resolveRecipientEmailsForRegion_`), Section 2 recipients come from the
17:00 row, and the 13:00 job reuses what was stored. Recovery (`recoverFailed*Buckets*Now`) re-runs the same job bodies
for just the ledger's FAILED/BLOCKED/PLANNED buckets, up to a late cutoff (12:45 / 16:00 IST). The code is defensive and
well commented. The real defects found are:

- The "typed Xh ago" age caption on human suggestions is defeated (C-1).
- A TEST MODE run writes production `Lead_Followups` rows (C-2).
- An error in one region's recipient resolution stops every later region, and the crash alert then says nothing at all
  was sent (C-3).
- An `AllIssues_Log` row can be left without a Checkpoint 2 forever (C-4).
- Some smaller post-send and reporting edges, plus several stale comments.

---

## 2. Constants

| Line | Constant | Value | Meaning |
|---|---|---|---|
| 103 | `OVERNIGHT_START_HOUR_` | `17` | Overnight window starts 17:00 IST the previous IST day |
| 104 | `OVERNIGHT_END_HOUR_` | `9` | Window ends 09:00 IST today |
| 106 | `OVERNIGHT_LOG_SHEET_` | `'Overnight_Log'` | Log tab name |
| 297 | `OVERNIGHT_LOG_HEADERS_` | `date, region, thread_id, lead_ids_json, sent_at, to, cc, subject, followup_sent_at, followup_result` | Columns A–J. **Append-only**: code reads by fixed position (`r[5]` = to, col 9 = followup_sent_at, `indexOf('followup_result')+1` = 10) |
| 1293 | `LEAD_FOLLOWUPS_SHEET_` | `'Lead_Followups'` | Dashboard-owned tab: A lead_id, B region, C RM, D issue, E collated_comments, F suggested_followup, G updated_at, H own_comments |
| 1294 | `FOLLOWUP_WAIT_POLL_MS_` | `20000` | Poll interval while waiting for human suggestions |
| 1295 | `FOLLOWUP_WAIT_MAX_ATTEMPTS_` | `6` | 6 reads, 5 sleeps, about 100 s total (comment says "~2 minutes") |
| 2152–2153 | `MORNING_LATE_CUTOFF_HOUR_/MINUTE_` | `12`, `45` | 10:00 recovery refuses to send after 12:45 IST unless forced |
| 2154–2155 | `FOLLOWUP_LATE_CUTOFF_HOUR_/MINUTE_` | `16`, `0` | 13:00 recovery cutoff 16:00 IST |
| 2156 | `EMAIL_RECOVERY_MORNING_JOB_` | `'recoverMorningBuckets'` | Lock/hold job name for 10:00 recovery |
| 2157 | `EMAIL_RECOVERY_FOLLOWUP_JOB_` | `'recoverFollowupBuckets'` | Lock/hold job name for 13:00 recovery |

External constants used: `TEST_MODE_OVERRIDE_EMAIL_` (EmailInfra.gs:43, `let`, blank in production), `FUTWORK_REGION_KEY_`,
`FUNNEL_ORDER_`, `EMAIL_LEDGER_JOB_MORNING_='morning10'`, `EMAIL_LEDGER_JOB_FOLLOWUP_='followup13'`,
`EMAIL_LEDGER_JOB_CH_OVERNIGHT_='chLevel10'`, `EMAIL_LEDGER_STATUS_`, `CH_REPORT_KINDS_`.

`AllIssues_Log` columns used (AllIssuesEmailer.gs:140): A date (a real `Date`, the 17:00 run's `now`), B region,
C bucket_label, D primary_role, E to, F cc, G lead_count, H sent_at, I thread_id, J issue_snapshot_json, K checkpoint1_json,
L checkpoint1_sent_at, M checkpoint2_json, N checkpoint2_sent_at.

### TEST MODE (cross-cutting)

When `TEST_MODE_OVERRIDE_EMAIL_` is non-blank:
- `resolveRecipientEmailsForRegion_` redirects every bucket to the tester and keeps the real address in `originalTo`.
- `sendCombinedMorningEmail_` sends Section-2-only buckets to the tester and adds `[TEST MODE] ` to the subject.
- The 13:00 job overrides `to` (and drops cc) and adds a "would have gone to" banner.
- Every Overnight_Log / AllIssues_Log state write goes through `writeUnlessTestModeGs_`, which skips the write.
- The region "already sent today" guard and the `followup_sent_at` guard are bypassed.
- The ledger handle is `null`, so every ledger call is a no-op. CH reports go only to the tester, and the CH once-a-day
  property is neither read nor written.
- **Exceptions**: see C-2 (`pushUnresolvedToLeadFollowups_`), and the dead or manual `sendOneOvernightEmail_` and
  `backfillTodaysOvernightLogRecipientsNow`.

### Time zone (cross-cutting)

- Day keys come from `istDayKeyGs_` (Core.gs).
- Window boundaries use literal `+05:30` ISO strings.
- Labels and stamps use `Utilities.formatDate(..., 'Asia/Kolkata', ...)`; `istStampGs_` gives `yyyy-MM-dd HH:mm:ss` IST.
- "Yesterday" is `now − 24 h`, which is safe because IST has no DST.
- Date cells that Sheets auto-converts from a written string (Overnight_Log `date`, `checkpoint*_sent_at`,
  `Lead_Followups.updated_at`) come back as `Date` objects and are normalized through `istDayKeyGs_`. That is correct only if
  the spreadsheet's own time zone is IST (see Open questions).
- Triggers use `atHour(10)` / `atHour(13)`, which run in the Apps Script project's time zone.

---

## 3. Every function, in file order

### 3.1 `notifyChLevelLeadsGs_(region, chLevelRms, rmToLeads, dateLabel, ledger)` — :134

- **Purpose.** The CH-level report. When an RM in `chLevelRms` is someone at CH/leadership level personally holding a lead,
  the full per-RM overnight report for their leads goes to OPS + the CH-level address (`chLevelReportToGs_()`), not to
  the CH. In TEST MODE it goes to the tester.
- **Called from.** Only inside `resolveRecipientEmailsForRegion_` (EmailInfra.gs:1183), and only when `opts.fireAlerts` is
  true. The 10:00 job passes `fireAlerts: !recoverIds`; backfill passes none.
- **Steps:**
  1. Return immediately when `chLevelRms` is empty.
  2. `groupChLevelRmsByCh_`: `chName -> {chEmail, chRole, rmNames}`.
  3. For each CH:
     - Subject `"(<chName> - <chRole>) <region> Google Overnight Leads - <d MMM yyyy>"`.
     - `splitSelfAndReportingRmNames_` splits self-held names (rmName == chName) from "reporting" names. Each part gets its
       own note and action sentence.
     - An amber banner "Sent to Ops — not to <CH>" (HTML + plain).
     - `groupLeadsByRmAndFlatten_(rmNames, rmToLeads)` builds the KPI and section data.
  4. **Zero leads → skip that CH** (`return` inside forEach = continue).
  5. **Once per day per region+CH**: `wasChReportSentTodayGs_(CH_REPORT_KINDS_.overnight, region, chName)`, a Script
     Property `EMAIL_CH_REPORTS_<kind>`.
  6. Build `reportOpts` (3 KPIs, one section per RM with subheading "Held directly by"/"Reports up to"). Stale leads are
     split to the bottom (`splitStaleSectionsGs_` + `staleSinceMapGs_`).
  7. Render HTML (banner + `renderOvernightReportEmailHTML_`) and plain text (banner + RM list + `plainTextReportGs_`).
  8. Send inside try/catch through `emailLedgerTrackSendGs_` (plan → attempt → ACCEPTED/FAILED/BLOCKED/UNCONFIRMED, then
     rethrow) wrapping `sendGuardedEmailGs_` with `leadIds`. Ledger id is `chLevel10|day|region|role|chName`.
  9. `markChReportSentGs_` runs only after success. On failure: log, and alert ops only if blocked by the gate.
- **No return value.** No sheet writes. Script Property written via `markChReportSentGs_`.
- **Note.** With the current `resolveRecipientBucketsForRms_` (RmHierarchy.gs:1186–1193, 1265–1296), `chLevelRms` holds only
  self-held entries (`chName: rmName`), so the "reporting" branch is effectively unreachable (C-11).

### 3.2 `overnightWindowGs_(asOf)` — :264

- Returns `{from: <IST day of asOf − 24h>T17:00+05:30, to: <IST day of asOf>T09:00+05:30}` as Dates.
- Pure. Callers: the 10:00 job, `downloadNoIssueLeadsNow`.

### 3.3 `writeFollowupResultGs_(logSheet, rowNumber, text, region)` — :301

- Writes `String(text).slice(0,500)` into column `followup_result` (J) of the given row through `writeUnlessTestModeGs_`.
- Never throws: errors are logged. Skipped in TEST MODE.
- Callers: `sendCombinedFollowupEmail_` and `sendOvernightFollowupEmails_`.
- Values written: `sent (threaded reply)`, `sent (fallback: …)`, `skipped: nothing unresolved`, `skipped: no stored
  recipient …`, `blocked: …`, `unconfirmed: …`, `failed: …`.

### 3.4 `ensureOvernightLogSheet_(ss)` — :317

- **Missing tab**: insert it, `flush`, then write the header and freeze row 1 (each step in `withRetry_`).
- **Existing tab**: read the header row and append any header from `OVERNIGHT_LOG_HEADERS_` that is missing, after the last
  column.
- Returns the sheet.
- **Caveat.** The heal appends by name, but readers use fixed positions. If the live sheet ever had a column out of order
  or an extra column in the middle, positions misalign silently (the comment warns about this).

### 3.5 `buildOvernightSectionOptsGs_(region, leads, dateLabel, win)` — :372

- Pure. Builds Section 1 opts for `renderOvernightReportEmailHTML_`:
  - Leads are grouped by RM (sorted). Each section is `{heading: RM, subheading: 'Manager: <TL|—>', columns [Lead ID, Status,
    Suggested Follow-up]}`.
  - For `FUTWORK_REGION_KEY_`, sections are grouped by real region with region bands (`sectionsByRegionGs_`).
  - KPIs: lead count, RM count, distinct status count.
  - `subtitle` = the window in IST (`d MMM, h:mm a`).
  - Fixed action text and footer.
  - Stale leads are split to the bottom.
  - Merged with `regionHeaderOptsGs_(region, leads)` (for Futwork, the region text lists the real regions).
- `dateLabel` is unused.
- Callers: `sendOneOvernightEmail_`, `sendCombinedMorningEmail_`.
- Note: the doc block at :339–361 describes `sendOneOvernightEmail_`, not this function (misplaced comment).

### 3.6 `sendOneOvernightEmail_(ss, logSheet, region, rec, leads, dateLabel, todayKey, now, win)` — :424 (dead in production)

- **Status.** The pre-redesign standalone Section-1-only send.
- **Steps:**
  1. Return null when there are no leads.
  2. Subject `"(<bucketLabel>[ - role]) <region> Google Overnight Leads - <date>"`. A TEST MODE banner is shown when
     `rec.originalTo` is set.
  3. Send through `sendGuardedEmailGs_` with `leadIds`.
  4. On error, classify it as gate-blocked / "operation not allowed" / other, send a detailed ops alert, and return
     `{reason}`.
  5. On success, append an Overnight_Log row (8 columns) through `withRetry_(appendRowOnceGs_(…, 2))`. Thread id is the
     identity key. This is not behind `writeUnlessTestModeGs_` and there is no ledger. Returns null.
- **Callers.** Only `Tests_OvernightEmailer.gs`. The comment says it is kept for "editor Run", but a trailing-underscore
  function does not appear in the editor dropdown and no wrapper exists (C-8).

### 3.7 `buildOvernightSectionEmptyStateOptsGs_(region, reasonText)` — :549

- Pure placeholder: `{title:'Overnight Leads', region, subtitle: reasonText, kpis:[], action:'', sections:[], footerNote:''}`.

### 3.8 `buildAllIssuesCheckpointEmptyStateOptsGs_(region, checkpointLabel, reasonText)` — :556

- Same idea for Section 2.

### 3.9 `allIssuesCheckpointStateLabelGs_(entry)` — :569

- Maps a checkpoint `state` to its display text:
  - `resolved` → Resolved
  - `not_found` → No longer found…
  - `still_open` → "Still open — <label>"
  - `category_changed` → "Now: <label>"
  - `escalated` → "ESCALATED — now: …"
  - `reopened` → "REOPENED — now: …"
  - anything else → the raw state

### 3.10 `buildAllIssuesCheckpointSectionOptsGs_(region, checkpointLabel, originalDateLabel, snapshotEntries, checkpointResults)` — :591

- Joins the 17:00 snapshot entries (which carry RM/TL/issueLabel/region) with checkpoint results by `lead_id`.
- Keeps only *active* results (`allIssuesCheckpointIsActiveGs_`: state not `resolved`/`not_found`).
- Groups by RM (`'Unassigned'` fallback); Futwork uses region bands. Columns are [Lead ID, Original Issue (17:00), Current
  State], with a purple accent.
- One KPI: count of still-unresolved leads. The action text appears only when the count is non-zero.
- Header comes from `regionHeaderOptsGs_(region, activeEntries)`. Pure.
- Used for both Checkpoint 1 (10:00) and Checkpoint 2 (13:00). At 13:00 the results passed in are already filtered to
  active ones.

### 3.11 `renderTwoSectionEmailHTML_(section1Opts, section2Opts)` — :652

- Two full `renderOvernightReportEmailHTML_` renders, each preceded by a "Section N — <title>" label, with a divider
  between them. Pure.

### 3.12 `loadYesterdaysAllIssuesBucketsGs_(ss, now)` — :673

- **Reads** AllIssues_Log A–N (one read, `withRetry_`). `yesterdayKey = istDayKeyGs_(now − 24h)`.
- **Per row, skip when:**
  - the date's IST key ≠ yesterday;
  - `checkpoint1_sent_at` (L) is set (**the idempotency guard**);
  - there is no snapshot (J);
  - the JSON does not parse (logged);
  - the snapshot is empty;
  - the region is blank.
- **Futwork.** A row whose bucket_label is `'Futwork'` joins region key `'Futwork'`, and each entry without a `region` gets
  the row's real region (legacy per-region Futwork rows).
- **Returns** `{regionKey: [{rowNumber, bucketLabel, primaryRole, to, cc, snapshotEntries}]}`.
- **Note.** A row from two or more days ago (for example a missed morning) is never checkpointed. That is by design.

### 3.13 `sendCombinedMorningEmail_(ss, overnightLogSheet, allIssuesLogSheet, region, section1, section2, dateLabel, todayKey, now, win, baselineMap, section1SkippedReason, leadsData, ledgerCtx)` — :728

The per-bucket 10:00 sender.

1. `section1` with zero leads is treated as null (email audit F4).
2. **Recipients and subject.**
   - `to = TEST_MODE || section1.rec.to || section2.to`.
   - `cc` = section1 cc || section2 cc (blank in TEST MODE).
   - `bucketLabel` and `primaryRole` come from section1 first, then section2.
3. **Section 1 opts.** Real opts when `section1` exists. Otherwise the empty state, whose text depends on
   `section1SkippedReason`:
   - `already_sent`: "Already sent separately earlier today…"
   - `already_sent_not_to_you`: "No Overnight email to you is recorded… contact Lead Ops"
   - anything else: "No overnight leads for your team today."
4. **Section 2.** If `section2` exists:
   - `computeAllIssuesCheckpointGs_(ss, snapshotEntries, now, baselineMap, leadsData)` is checked against the same
     `leadsData` snapshot the job read once.
   - `activeCheckpoint1Count` = the number of active results.
   - Real opts when the count is > 0, otherwise the empty state "Nothing pending … every flagged lead is already resolved."
   - Without `section2`, the empty state "Nothing pending from yesterday's 17:00 report."
5. Header: `regionHeaderOptsGs_` over both sections' items, applied to whichever sections are empty.
6. Subject: `[TEST MODE] ` + `(<label>[ - role]) ` + region text + ` Google Overnight + Follow-up Digest - <d MMM yyyy>`.
7. `writeCheckpoint1State_`: for every `section2.rowNumbers`, write K–L = `[jsonForCellGs_(checkpoint1Results), istStampGs_()]`.
   Goes through `writeUnlessTestModeGs_`, in its own try/catch. Note that **all** results are stored, resolved ones
   included.
8. **Nothing to say** (no Section 1 and 0 active Checkpoint 1):
   - write checkpoint1 state (a final outcome);
   - log, mark the ledger SKIPPED;
   - **return null without sending and without an Overnight_Log row**.
9. Stale split for Section 2 (`staleSinceForLeadIdsGs_`). Render the HTML two-section body and the plain body (summary +
   `plainTextTwoSectionGs_`).
10. `claimedLeadIds` = Section 1 lead ids + active Checkpoint 1 lead ids. The gate checks that each appears in both
    bodies.
11. **Send.** Ledger ATTEMPTING → `sendGuardedEmailGs_`.
    - On error: compute the reason (gate / operation not allowed / other), send an ops alert, and set the ledger status via
      `emailLedgerStatusForErrorGs_`.
    - On success: ledger ACCEPTED with the Gmail ids, recorded before the log write.
12. **After success:**
    - append an Overnight_Log row `[todayKey, region, threadId, jsonForCellGs_(issueLog), istStampGs_(), to, cc, subject]`
      through `writeUnlessTestModeGs_(appendRowOnceGs_(…, 2))`, in a try/catch. `issueLog` holds only Section 1 leads that
      have a primary SLA issue: `{lead_id, issueKey, issueLabel}`. An empty issueLog is still logged, so a Section-2-only
      bucket gets a thread for 13:00.
    - `threadId = sentMessage.getThread().getId()` is **outside** the try (C-5).
    - write checkpoint1 state **only on success** (email audit F6).
13. **Return**: null on success or skip; `{reason, section1Leads, section2}` on send failure.

### 3.14 `sendOvernightMorningEmails()` — :951 (trigger entry)

- `withEmailJobLockGs_('sendOvernightMorningEmails', …)`: a script lock that waits 30 s, then skips and alerts; it fails
  open if the lock service errors. Inside: try `sendOvernightMorningEmails_()`.
- On a throw: an immediate ops alert "crashed — NO overnight morning emails were sent this run", then rethrow (C-3: that
  text can be false).

### 3.15 `sendOvernightMorningEmails_(opts)` — :968 (the real 10:00 body)

See the narrative in §4.1. Options: `onlyEmailIds` (ledger ids to re-send) and `onlyRegions` (recovery only).

### 3.16 `pushUnresolvedToLeadFollowups_(ss, entries)` — :1314

- Upsert by lead_id into `Lead_Followups`. Returns false when there are no entries or the tab is missing; it does not
  create the tab.
- Inside one `withRetry_`:
  1. Read A–H once and map lead_id to its row offset.
  2. `updatedAt` = IST `yyyy-MM-dd HH:mm:ss` string.
  3. An existing row is rewritten with column **F (suggested_followup) preserved** and **G = updatedAt** (C-1).
  4. A new lead is appended. A repeated new id overwrites its pending new row.
  5. Write: at most one `setValues` over all existing rows plus one append. Returns true.
- Upsert-only (never clears). Re-running it is idempotent.
- Not behind TEST MODE (C-2). Caller: the 13:00 job.

### 3.17 `waitForFollowupSuggestions_(ss, leadIds)` — :1384

- Up to 6 reads of `Lead_Followups` A–G, with a 20 s sleep between them.
- Builds `{lead_id: {suggestion (col F), updatedAt (col G if it is a Date, else null)}}` for rows with a non-blank F.
- Returns as soon as every requested id has a suggestion. Otherwise it returns whatever exists after the last read.
- Returns `{}` when the tab is missing.

### 3.18 `formatFollowupAgeGs_(updatedAt, now)` — :1416

- Pure. Returns `''` for a non-Date or a negative age.
- Otherwise: `" (typed <1h ago)"`, `" (typed Nh ago)"` under 48 h, or `" (typed Nd ago)"`.

### 3.19 `sendThreadedGmailReply_(threadId, to, cc, subject, plainBody, htmlBody)` — :1454

1. If `emailRerouteApplyGs_` exists (EmailReroute.gs, decision D9), it swaps a bounced recipient for the next person up and
   may change the bodies. Stored recipients are untouched.
2. `prepareOutgoingEmailGs_` (no leadIds) checks the addresses and subject and collapses CR/LF. Problems throw
   `sendBlockedErrorGs_` (`blockedByGuard`).
3. `Gmail.Users.Threads.get(me, threadId, metadata Message-ID)` inside `withRetry_`. No messages → throw.
4. Take the last message's `Message-ID`.
5. Build raw MIME:
   - Headers: To, Cc, Subject, MIME-Version, In-Reply-To/References (when an id was found), multipart/alternative.
   - A text/plain part and a text/html part, both UTF-8. There is no Content-Transfer-Encoding header and the subject is not
     RFC 2047-encoded (C-14).
6. Web-safe base64 → `Gmail.Users.Messages.send({raw, threadId}, 'me')` inside `withSendRetry_` (retries only "operation not
   allowed" and "not found").
7. On a send error, tag `sendOutcomeUnknown = true` when `isAmbiguousSendErrorGs_` (timeout / 5xx wording) matches, then
   rethrow.
- Returns the API response `{id, threadId,…}`.
- Throws if the Advanced Gmail Service is off ("Gmail is not defined"). That is not ambiguous, so the caller falls back.

### 3.20 `buildOvernightFollowupSectionOptsGs_(region, unresolvedRows)` — :1572

- Section 1 at 13:00: one red "Still Unresolved" section, columns [Lead ID, RM, Issue, Suggested Follow-up]. Futwork uses
  region bands. One KPI. Stale split. Region header.

### 3.21 `buildOvernightFollowupSectionEmptyStateOptsGs_(region, reasonText)` — :1596

- Placeholder.

### 3.22 `checkpoint1PendingKeyGs_(region, to)` — :1602

- `lower(trim(region)) + '|' + lower(trim(to))`. It is the shared key for:
  - the 13:00 Section 2 lookup;
  - the 10:00 "was this recipient logged today" check.

### 3.23 `loadTodaysCheckpoint1PendingGs_(ss, now)` — :1621

- Reads AllIssues_Log A–N. Keeps rows where:
  - `checkpoint1_sent_at` is today's IST day (a Date normalized, or the first 10 characters of the string);
  - `checkpoint2_sent_at` is blank (**the guard**);
  - J and K both parse and K is non-empty;
  - `to` is non-blank.
- Legacy per-region Futwork rows get each entry's `region` filled in and are keyed under `'Futwork'`.
- Key: `checkpoint1PendingKeyGs_(rowRegionKey, to)`. Per region since email audit F1, after a real 1 Oct incident where one
  recipient got every region's Checkpoint 2 in each reply.
- Merges rows with the same key: `rowNumbers` pushed, `snapshotEntries` and `checkpoint1Entries` deduped by lead_id.
- Returns `{key: {to, cc, bucketLabel, primaryRole, rowNumbers, snapshotEntries, checkpoint1Entries}}`.

### 3.24 `sendCombinedFollowupEmail_(ss, overnightLogSheet, overnightLogRowNumber, allIssuesLogSheet, region, threadId, sendTo, sendCc, subject, testModeBanner, section1UnresolvedRows, section2Input, now, baselineMap, leadsData, ledgerCtx)` — :1687

1. **Section 1 opts**: the unresolved table, or the empty state "Nothing still unresolved from this morning — all clear."
2. **Section 2**:
   - `computeAllIssuesCheckpointGs_(ss, checkpoint1Entries, now, baselineMap, leadsData)`. Checkpoint 2 is incremental:
     the prior state is Checkpoint 1's output.
   - `filterAllIssuesCheckpoint2ForEmailGs_` keeps the active results only.
   - Real opts (joined with the original 17:00 snapshot) or an empty state.
3. `writeCheckpoint2State_` writes M–N = `[jsonForCellGs_(checkpoint2Results), stamp]` on every row. Only active results are
   stored. Goes through `writeUnlessTestModeGs_`, try/catch.
4. **Nothing unresolved in either section**:
   - write checkpoint2 state;
   - `followup_result = 'skipped: nothing unresolved'`; the ledger is marked SKIPPED;
   - return. `followup_sent_at` stays blank.
5. Stale split for Section 2. Render HTML (with the TEST banner) and plain text.
6. **Pre-send gate** on the exact payload, with `claimedLeadIds` = Section 1 unresolved + Checkpoint 2 active. If blocked:
   ops alert, `followup_result='blocked: …'`, ledger BLOCKED, return. No state is written, so the bucket is retryable the
   same day.
7. **Threaded send** (`sendThreadedGmailReply_`):
   - Success: outcome `sent`.
   - Error tagged `sendOutcomeUnknown`: outcome `unconfirmed`, no fallback.
   - Error with `blockedByGuard` (the reroute produced a bad payload): ledger BLOCKED, alert, outcome stays `failed`.
   - Any other error: a **plain fallback** via `sendGuardedEmailGs_` (same subject `Re: …`, not threaded). Success gives
     `sent (fallback…)`. A fallback error gives `unconfirmed` (ambiguous) or `failed` (alert).
   - `unconfirmed` → ops alert telling a human to check Gmail Sent.
8. Write `followup_result`. Ledger: ACCEPTED with ids, UNCONFIRMED, BLOCKED or FAILED.
9. When `outcome !== 'failed'`:
   - write checkpoint2 state;
   - write `followup_sent_at` (col I) = stamp, or `"unconfirmed <stamp>"`. Both are truthy, so the 13:00 Pass 1 never
     re-sends.
   - A definite failure leaves both blank, so a same-day manual re-run or recovery retries.
- Returns nothing.

### 3.25 `sendOvernightFollowupEmails()` — :1871 (trigger entry)

- Same lock + crash-alert + rethrow wrapper.

### 3.26 `sendOvernightFollowupEmails_(opts)` — :1886

See the narrative in §4.2. Option: `onlyEmailIds`.

### 3.27 Recovery — :2160–2188

- `recoverFailedMorningBuckets_` and `recoverFailedFollowupBuckets_` delegate to `emailRecoverBucketsGs_` (EmailLedger.gs:72).
  That function:
  - reads today's ledger targets (FAILED, BLOCKED or never-attempted PLANNED) for the job;
  - refuses after the cutoff unless `force`;
  - otherwise calls `run(ids, regions)`.
- 10:00 recovery calls `sendOvernightMorningEmails_({onlyEmailIds, onlyRegions})`. 13:00 recovery calls
  `sendOvernightFollowupEmails_({onlyEmailIds})`.
- The four public wrappers (`…Now`, `…ForceNow`) each take `withEmailJobLockGs_` under the recovery job name. It is the same
  script lock, so they cannot overlap the scheduled jobs.
- Manual only: no trigger.

### 3.28 `backfillTodaysOvernightLogRecipientsNow()` — :2208 (one-off repair)

- For today's Overnight_Log rows with a blank `to`:
  1. Rebuild the RM list from `lead_ids_json` via the current leads tab.
  2. Re-resolve with `resolveRecipientEmailsForRegion_` (no `fireAlerts`).
  3. Take bucket 0 (log a warning if there are several).
  4. Write F–H = to, cc and a **pre-redesign** subject (`… Google Overnight Leads - date`, not the current "Overnight +
     Follow-up Digest"), via `withRetry_` (not TEST-MODE guarded).
- Idempotent: it skips rows that already have a `to`.
- Practically obsolete: every combined send stores `to` (C-17).

### 3.29 `setupOvernightEmailer()` — :2285

- `ensureRegionRecipientsSheet_`, `ensureOvernightLogSheet_`, `setupRmHierarchy()`.
- Deletes the existing triggers for both handlers, then creates daily triggers at 10 (`nearMinute(0)`) and 13.
- The log text "a region with neither is silently skipped" is stale (C-12).

### 3.30 `sendOvernightMorningEmailsNow` / `sendOvernightFollowupEmailsNow` — :2309–2310

- Thin editor-runnable wrappers. They go through the lock.

### 3.31 `downloadNoIssueLeadsNow()` — :2326 (diagnostic)

- Recreates a `Debug_NoIssueLeads` tab listing today's overnight-eligible, open, Google leads whose follow-up hint starts
  with "No comment added".
- It filters on `group_source==='google'` only, **not** `passesGoogleNonUtmSearchGs_` (C-9).
- It uses `lastSnapshotBeforeGs_` keyed by lead id. It deletes and recreates its own tab only.

### 3.32 `debugFollowupStatusNow()` — :2404 (diagnostic, read-only)

- Re-walks the Section 1 classification for today's rows and logs each decision.
- When `to` is blank, it traces chain resolution (`lookupRmChain_`, primary TL→TM→RH→CH, Manager_Directory email).
- It does not know Section 2 / Checkpoint 2, `followup_result` or loan-team routing (C-10).
- It uses `buildTodayCallBaselineGs_`, which is equivalent to `buildMovementLogMapsGs_().baselineMap`.

---

## 4. End-to-end narratives

### 4.1 The 10:00 job (`sendOvernightMorningEmails_`)

1. **Reads, once each**:
   - `readLeadsTab_` → `leadsData {colIndex, dataRows}`, reused by every bucket's Checkpoint 1 (email audit F8);
   - `loadRegionRecipients_` (the Region_Recipients fallback);
   - `loadRmHierarchyAndEmails_` (RM_Hierarchy + Manager_Directory);
   - `buildMovementLogMapsGs_(ss, now)` → `baselineMap` (call_attempts at start of the IST day, for SLA flags),
     `lastSnapshotMap` (latest snapshot before now, for the "no comment" hint) and `lastChangeMap` (stale-lead block, D8),
     with `lastChangeMap` attached to `leadsData`.
2. **Candidates (Section 1).** Per leads row, in this order:
   1. needs a lead_id;
   2. **scope gate first**: `passesGoogleNonUtmSearchGs_` (group_source google AND source_bucket non-utm|search);
   3. `lead_assigned_at` must be a real Date within `[17:00 yesterday, 09:00 today]` IST, inclusive;
   4. `mainRegionForGs_` must map to one of the configured regions;
   5. drop Opportunity+ (`isOppOrAbove_`) and closed (`!isOpenLead_`).
   - Each lead gets: RM ('Unassigned' fallback), TL, `status` (`overnightStatusLabelGs_`), `followup`
     (`overnightFollowupHintGs_` with the per-lead last snapshot), `issue = primaryIssueGs_(computeSlaFlags_(…))` (not
     shown in the email; stored for 13:00) and `staleSince`.
3. **Customer dedupe.** Key `client_id || 'l:'+lead_id`; keep the copy with the furthest funnel stage; on a tie keep the
   first. Only open overnight copies take part, so a sibling elsewhere in the funnel is not considered.
4. **Group by region key**: `regionKeyForRmGs_(RM, region)`. Futwork RMs from every region share `'Futwork'`.
5. `ensureOvernightLogSheet_`, `dateLabel`, `todayKey`, the ledger handle (null in TEST MODE).
   `ensureAllIssuesLogSheet_` + `loadYesterdaysAllIssuesBucketsGs_` give the Section 2 inputs by region.
6. **Idempotency read**: Overnight_Log A–F. For today's rows, mark `alreadyLoggedRegionsToday[region]` and
   `loggedRecipientsToday[region|to]`.
7. **Region union**: Section 1 regions plus Section 2 regions, sorted. Filtered by `onlyRegions` in recovery.
8. **Per region:**
   - **Section 1 buckets.**
     - If the region already has a row today (and this is neither TEST MODE nor recovery), skip Section 1
       (`section1SkippedReason='already_sent'`) and record a ledger exclusion.
     - Otherwise build `rmToLeads` and call `resolveRecipientEmailsForRegion_(…, {fireAlerts: !recovery, rmToLeads,
       dateLabel, hierarchyData, ledger})`. This builds one bucket per distinct primary manager (TL→TM→RH→CH; the loan
       team forced to its CH), then:
       - adds the cc chain and the P&L-head cc;
       - **sends CH-level reports** for self-held leads (§3.1);
       - adds a Region_Recipients fallback bucket, or the CH-level backstop bucket, for unresolved RMs;
       - merges same-address buckets and adds a separate Futwork bucket;
       - redirects in TEST MODE.
     - `trulyUnresolved` → failed-lead entries + exclusions. That list is now always empty (C-13).
     - Each bucket is stored as `section1ByEmail[lower(originalTo||to)] = {rec, leads}`.
   - **Section 2 buckets.** Yesterday's rows for the region, keyed by their **stored** `to` (routing frozen at 17:00),
     merged and deduped.
   - **Union by recipient address.** Each recipient gets one combined email. Ledger meta per recipient: emailId
     `morning10|day|region|role|label|to`. All of them are PLANNED in one write (recovery: only the targeted ids).
   - **Per recipient:**
     - work out the label (`already_sent` becomes `already_sent_not_to_you` when no today row names this recipient);
     - call `sendCombinedMorningEmail_` inside try/catch. A throw → ledger fail-if-open plus a synthetic failure.
     - On failure, add Section 1 and Section 2 leads to `failedLeadEntries`.
9. Recovery: targeted ids this run did not produce → ledger SKIPPED with the reason.
10. `notifyLeadSendFailuresGs_(failedLeadEntries)`: one consolidated ops report. `emailLedgerFinishGs_` alerts only if
    ledger writes failed.

**Idempotency summary (10:00).**
- Region-level: an Overnight_Log row today means Section 1 is never re-sent by a plain re-run. Recovery bypasses this per
  bucket.
- Section 2: `checkpoint1_sent_at` set means the row is not re-loaded.
- Row-append: `appendRowOnceGs_` keyed by thread id.
- CH reports: a Script Property.
- Overlap: the script lock.
- A Section 1 bucket that failed in a region where other buckets succeeded is re-sent **only by recovery**. A plain re-run
  shows the `already_sent_not_to_you` placeholder instead (deliberate, per the :1101–1113 comment).

### 4.2 The 13:00 job (`sendOvernightFollowupEmails_`)

1. Read Overnight_Log A–I. Keep today's rows (Date cells normalized through `istDayKeyGs_`). Return early if there are none.
2. One `readLeadsTab_` and one `buildMovementLogMapsGs_`. Index rows by lead_id.
3. **Pass 1 (classify, no sending).** Per today's row:
   - skip when `followup_sent_at` is set (unless TEST MODE);
   - in recovery, skip unless `followup13|day|region|||to` is targeted.
   - Parse `issueLog`. Each entry becomes resolved or unresolved:
     - not found → resolved;
     - Opportunity+ → resolved;
     - closed → resolved;
     - `computeSlaFlags_(…)[entry.issueKey]` still true → **unresolved** (with the real region for Futwork, the issue label,
       the source row, the per-lead baseline and staleSince);
     - otherwise resolved (including "now flagged for a different issue").
   - The row joins `perRegion` even with an empty issueLog, because a Section-2-only morning bucket needs its thread.
4. **Lead_Followups.** If any lead is unresolved anywhere:
   - `pushUnresolvedToLeadFollowups_` (comments from `combinedCommentsTextGs_`);
   - if the tab exists, `waitForFollowupSuggestions_`, up to about 100 s.
5. **Section 2 input.** `loadTodaysCheckpoint1PendingGs_`, keyed by region|to.
6. **Ledger pre-pass.** Every `perRegion` entry is PLANNED, or directly SKIPPED when it has nothing to send or no stored
   `to`. It mirrors the Section 2 hand-out using a separate `consumedForLedger` map.
7. **Pass 2 (send).** Per `perRegion` entry:
   - Section 2 = the pending entry for `region|to`, unless already handed to an earlier row this run (`section2Consumed`,
     email audit P3).
   - Nothing in either section → `followup_result='skipped: nothing unresolved'`.
   - No stored `to` → skipped (legacy row).
   - Fill in suggestions: the human suggestion from Lead_Followups plus `formatFollowupAgeGs_`, otherwise a fresh
     `overnightFollowupHintGs_`.
   - TEST MODE: `sendTo` = tester, cc dropped, banner.
   - Subject `'Re: ' + stored subject`.
   - `sendCombinedFollowupEmail_` inside try/catch. A throw → ledger fail-if-open, `followup_result 'failed: unexpected
     error'`, collected into one ops alert.
8. Recovery: targeted ids not seen → ledger SKIPPED. `emailLedgerFinishGs_`.

**Idempotency summary (13:00).**
- `followup_sent_at` truthy (sent or unconfirmed) means the reply is never re-sent.
- `checkpoint2_sent_at` set means Section 2 is never re-loaded.
- A definite failure leaves both blank, so a manual re-run or recovery retries the same day.
- A `skipped` row is re-evaluated on a re-run. That is harmless, but a later re-run could send if a lead was re-flagged in
  the meantime.

**Fallback chain (13:00).** Threaded API send → if it fails *definitely* (for example the Advanced Service is off, or a bad
thread id) → plain `GmailApp` send (correct recipients, not threaded). An *ambiguous* failure never triggers the fallback
(email audit F7).

---

## 5. Findings

| ID | Sev | Where | Finding | Confidence |
|---|---|---|---|---|
| C-1 | MED | :1354, :1336, :1393–1396, :2096–2100 | **The "(typed Xh ago)" caption on human suggestions never shows the real age.** `pushUnresolvedToLeadFollowups_` rewrites column G `updated_at` = *now* on every existing row it upserts, and every lead it then waits on was just pushed. `waitForFollowupSuggestions_` then reads that same G as the suggestion's age. **Failure scenario**: a manager typed a suggestion in F four days ago. Today the lead is still unresolved, so it is pushed (G = now) and read back. Either Sheets parsed the stamp to a Date and the caption reads " (typed <1h ago)" (actively misleading, the opposite of LEADFOLLOWUPS-003's purpose), or it stayed a string and no caption appears. The pass also refreshes G for the sheet's amber/red staleness formatting (LEADFOLLOWUPS-002), hiding the suggestion's real age there too. A fix needs a separate "suggestion typed at" signal (or must stop touching G when F is non-blank). | CONFIRMED (code path) |
| C-2 | MED | :2012 (`pushUnresolvedToLeadFollowups_` :1314) | **A TEST MODE 13:00 run writes production `Lead_Followups`.** The push is not behind `writeUnlessTestModeGs_`, unlike every other state write. EmailInfra.gs:192 states that TEST MODE must never write production state. **Scenario**: a tester runs `sendOvernightFollowupEmailsNow` with the override on. Real rows get region/RM/issue/comments/updated_at overwritten and new rows appended, which refreshes the staleness colours on rows a dashboard user is reviewing. Also not guarded, but manual only: `sendOneOvernightEmail_` (:524, dead) and `backfillTodaysOvernightLogRecipientsNow` (:2274). | CONFIRMED |
| C-3 | MED | :1183 (outside the per-bucket try at :1262), :959–962 | **One region's resolution error stops every later region, and the crash alert is then false.** `resolveRecipientEmailsForRegion_` (and the ledger plan/exclude calls) run per region outside any try/catch. **Scenario**: regions are processed alphabetically. A malformed hierarchy row (or any non-transient error after `withRetry_`) throws in the 5th region. Regions 1–4 were already emailed, regions 5+ get nothing, and the wrapper's immediate alert says "NO overnight morning emails were sent… nothing was sent for ANY region". Regions 5+ were never PLANNED in the ledger, so `recoverFailedMorningBucketsNow` cannot see them. Only a plain re-run (Section 1 skipped for the logged regions, sent for the rest) recovers them, and the alert does not say so. The 13:00 wrapper's text has the same issue in principle, but its pre-send phase sends nothing, so it matters less there. | CONFIRMED (control flow) |
| C-4 | LOW | :803–808, :887–895; comments :1559–1566, :2018–2022 | **AllIssues_Log rows that can never get a Checkpoint 2.** Checkpoint 1 state is written without any Overnight_Log row in two cases: the "nothing to say" path (every Checkpoint 1 lead resolved, no overnight leads), and a successful send whose Overnight_Log append then failed (caught and only `Logger.log`ged, no ops alert). At 13:00, `loadTodaysCheckpoint1PendingGs_` returns those rows, but Section 2 is only handed out by iterating `perRegion` (the Overnight_Log rows), so they are silently never processed and `checkpoint2_sent_at` stays blank forever. **Scenario**: every lead was resolved at 10:00, one reopens or escalates by 13:00, and nobody is told (Checkpoint 2 has a `reopened` state precisely for this). The header comment "Section 2's bucket set here is ALWAYS a SUBSET of Section 1's own `perRegion` set" is therefore false. HANDOVER §2 documents the no-row behaviour, but not the orphaned Checkpoint 2. (FollowupTracker.gs may show these rows as pending or overdue; that was not verified here.) | CONFIRMED (logic) |
| C-5 | LOW | :875 | **Unguarded `sentMessage.getThread().getId()` after a successful send.** It sits outside the log-write try/catch, while `emailLedgerSentIdsGs_` (:848) guards the same call. A transient Gmail error here propagates to the per-bucket catch (:1264), which reports the bucket's leads as "not sent" in the consolidated failure report even though the email was delivered (the ledger stays ACCEPTED). It also skips the Overnight_Log row (no 13:00 reply for this bucket) and the checkpoint1 write (a later re-run re-sends Section 2 as a duplicate). Use `sentIds.threadId`. | SUSPECTED (needs a transient failure) |
| C-6 | LOW | :840, :1276–1278, :1755, :1772 | **Failure reports count every Section 2 lead, including resolved ones.** The 10:00 failure alert and `failedLeadEntries` list all `section2.snapshotEntries`, and the 13:00 alerts list all `checkpoint1Entries`, not just the active leads the email would have carried. The "leads not sent" report over-states what was missed. | CONFIRMED |
| C-7 | LOW | :1957, :2037 | **13:00 ledger ids can collide.** The id is `followup13|day|region|||to`. Two of today's Overnight_Log rows for the same region+recipient (possible: a re-run that sends a Section-2-only email after a checkpoint1 write failure, or two runs each logging a row) share one id. The plan, attempt and result of the second overwrite the first, and recovery's `recoverIds[recId]` matches both rows. | SUSPECTED (rare) |
| C-8 | LOW | :410–424 | **`sendOneOvernightEmail_` is dead, and the reason given for keeping it is false.** The status comment says it is kept so a standalone email "can be sent by hand (editor 'Run')". But a trailing-underscore function is hidden from the editor dropdown (the file's own :2397–2403 comment says so) and no wrapper exists, so its only callers are tests. It also bypasses the ledger and the TEST MODE write guard. Retire it with its 2 test blocks, or add a real wrapper. | CONFIRMED |
| C-9 | LOW | :2341–2342 | `downloadNoIssueLeadsNow` filters on `group_source==='google'` only. The real 10:00 scope also requires `source_bucket` ∈ {non-utm, search} (`passesGoogleNonUtmSearchGs_`), so the diagnostic includes leads the email never shows. The comment claims "same Google-only scope". | CONFIRMED |
| C-10 | INFO | :2451, :2500 | `debugFollowupStatusNow` predates the two-checkpoint redesign. For an empty issueLog it logs "correctly nothing to follow up on" even when a Checkpoint 2 is pending for that thread. It ignores `followup_result`. Its chain trace omits the loan-team override (RmHierarchy.gs ~:1304), so it can name the wrong primary for loan-team RMs. | CONFIRMED |
| C-11 | INFO | :37–45, :108–125, :149–173, :188–191, :354–356, :2504–2509 | **Stale CH-level comments and an unreachable branch.** The header and `notifyChLevelLeadsGs_` say an RM whose chain "resolves all the way up to a CH" is diverted to ops. Today `resolveRecipientBucketsForRms_` makes a CH-tier primary a normal bucket and puts only self-held leads in `chLevelRms` (`chName = rmName`). That makes the `reportingRmNames` note/action branch effectively unreachable, and makes the :354–356 claim "a bucket's primary is never a CH" false. `debugFollowupStatusNow`'s :2504 comment is the accurate one. | CONFIRMED |
| C-12 | INFO | various | **Stale or misplaced comments:** (a) :1945–1954 says AllIssues_Log checkpoint columns "are written even on failure" and that `followup_sent_at` is set "only on a CONFIRMED successful send". Both changed 2026-10-05: checkpoints are now written only on success, and `followup_sent_at` is also set as "unconfirmed". (b) :1858–1859 calls a lost `followup_sent_at` write "harmlessly resent". It is actually a duplicate Section 1 reply to real managers. (c) The `setupOvernightEmailer` log says a region with no recipient "is silently skipped"; it now goes to the CH-level backstop. (d) The header dependency list (:16–27) omits EmailLedger.gs, StaleLeads.gs, EmailReroute.gs and the SlaEngine checkpoint functions. (e) :90–96 "I cannot execute Apps Script myself…" is obsolete. (f) Doc blocks are detached from their functions: :339–361 (belongs to `sendOneOvernightEmail_`), :919–939, :1511–1549. (g) The `FOLLOWUP_WAIT_MAX_ATTEMPTS_` comment says "~2 minutes"; it is 5 sleeps × 20 s = 100 s. | CONFIRMED |
| C-13 | INFO | :1189–1196 | `resolution.trulyUnresolved` is always `[]`: `resolveRecipientEmailsForRegion_` never fills it, because unresolved RMs now go to the Region_Recipients fallback or the CH-level backstop bucket. The unresolved-exclusion and failed-lead branch is dead. | CONFIRMED |
| C-14 | LOW | :1479–1496 | **Raw threaded MIME** (`sendThreadedGmailReply_`): the subject is not RFC 2047-encoded, and the UTF-8 parts carry no `Content-Transfer-Encoding`. The bodies contain non-ASCII ("—", "’") and evidently deliver fine through the Gmail API. A non-ASCII character in a *subject* (for example a manager name with diacritics in the bucket label) could arrive garbled. EmailInfra's ops-alert raw path does encode its subject. | SUSPECTED |
| C-15 | INFO | :1384–1405, :2012–2015 | The bounded wait for human suggestions almost always runs to its full length on the unattended 13:00 trigger (nobody types within 100 s): about 100 s of `Utilities.sleep` per run while holding the script lock. Conversely, any lead with an old human suggestion counts as "answered" immediately (see C-1). Worth confirming whether the wait still earns its cost. | CONFIRMED (behaviour) |
| C-16 | INFO | :1756 | **TEST MODE 10:00 emails have no "would really have gone to" banner** (`sendOneOvernightEmail_` and the 13:00 reply both have one). A tester cannot see each bucket's real recipient in the combined morning email, only the `[TEST MODE]` subject tag. `rec.originalTo` is available but unused. | CONFIRMED |
| C-17 | INFO | :2266–2271, :372 | `backfillTodaysOvernightLogRecipientsNow` writes the pre-redesign subject ("Google Overnight Leads"), not the current "Google Overnight + Follow-up Digest", so the 13:00 `Re:` would not match the real thread subject. Practically obsolete, since every combined send stores `to`. `buildOvernightSectionOptsGs_`'s `dateLabel` parameter is unused. | CONFIRMED |

---

## 6. Open questions

1. **Spreadsheet and project time zones.** Several readers depend on Sheets auto-converting a written `yyyy-MM-dd` /
   `yyyy-MM-dd HH:mm:ss` string to a Date in the *spreadsheet's* time zone, then re-keying it through `istDayKeyGs_`:
   - Overnight_Log `date`
   - `checkpoint1_sent_at`
   - `Lead_Followups.updated_at`

   This is correct only if the spreadsheet time zone is IST (or west of IST for the midnight day keys). Is the live
   spreadsheet set to Asia/Kolkata? Similarly, the 10:00/13:00 triggers use the project's `appsscript.json` time zone, which
   is not in the repo. Is it Asia/Kolkata?
2. **C-4.** Should the 13:00 job also process Checkpoint 1 rows that have no Overnight_Log thread (send a fresh, unthreaded
   email, or open a thread), or is "all resolved at 10:00 → no Checkpoint 2" the intended product rule? If the latter,
   should `checkpoint2_sent_at` be stamped (for example "not needed") so the tracker does not show them as pending?
3. **C-1.** Which signal should mean "when the human typed the suggestion"? The dashboard's own Generate flow also writes G
   (js/sheets-writeback.js), so G cannot serve both "row refreshed" and "suggestion typed".
4. **`sendOneOvernightEmail_` (C-8).** Retire it, or give it a real editor wrapper? It is the last open item from
   DEAD_CODE_AUDIT_2026-10-03.
5. **Region "already sent" guard.** A region partly failed at 10:00 can only have its failed Section 1 bucket re-sent by
   recovery, and only until 12:45. Is it intended that a plain re-run after the cutoff shows the "No Overnight email to you
   is recorded" placeholder rather than the leads?
6. **The 13:00 "skipped" rows.** `followup_sent_at` stays blank, so any later manual re-run re-classifies them and could send
   a reply hours later if a lead was re-flagged. Should "skipped" also be terminal?
