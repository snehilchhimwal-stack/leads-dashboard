# Code audit A - core Apps Script logic (Core.gs, SlaEngine.gs, FollowupEngine.gs, StaleLeads.gs)

Audited at commit `19038e7` (2026-10-10). Read-only line-by-line review; no code changed. Browser twins were opened only for parity
checks (`js/core-lead-model.js`, `js/core-outcome-engine.js`, `js/core-foundation.js`, `js/core-sheets-fetch.js`).
`python3 test/check-runtime-parity.py` was run: 1 mismatch, the known and intentional `HEADER_ALIASES` browser-only keys
(`lead_closing_comment`, `project_region`).

---

## 1. Scope and summary

| File | Lines | Role |
|---|---|---|
| `Core.gs` | 529 | Reading a lead row (header aliases, column index, `getVal_`), stage classification (funnel / closed / open), IST day keys, working-minutes, HTML escaping, the shared Drive-CSV archive used by every prune, and the workbook cell-budget diagnostic. |
| `SlaEngine.gs` | 333 | The 5 SLA rules (`computeSlaFlags_`), the priority used to pick "the" issue (`primaryIssueGs_`), and the checkpoint comparison the 10:00 / 13:00 follow-up emails use (`computeAllIssuesCheckpointGs_`). |
| `FollowupEngine.gs` | 739 | Comment-log timestamp parsing (used by the SLA rules), the keyword engine that classifies an RM comment (`inferOutcomeGs_`, 31 rules, typo-tolerant), the suggested follow-up text (`overnightFollowupHintGs_`) with its extra "modifier" clauses, and the stage label shown in emails. |
| `StaleLeads.gs` | 111 | Decision D8 (2026-10-10): a lead with no change for more than 24 h is "stale"; judged from the Movement_Log content-hash history; emails move such rows into a red block at the bottom (`splitStaleSectionsGs_`). |

**What it does, in one paragraph.** Every unattended backend job (snapshots, SLA history, the 17:00 issue emails, the 10:00 / 13:00
follow-ups, the RM issue log, routing) reads the `leads` tab through `buildColIndex_` + `getVal_` and decides with
`isOpenLead_` whether a row is still an open, pre-Opportunity lead. For open rows, `computeSlaFlags_` evaluates the five SLA rules
against a single `now` and a lead-id-keyed baseline of yesterday's `call_attempts` (from Movement_Log), and `primaryIssueGs_` picks
the highest-priority one. Emails then attach a human hint: `latestOutcomeGs_` picks the lead owner's newest real comment,
`inferOutcomeGs_` classifies it with fuzzy keyword rules, and `overnightFollowupHintGs_` maps the class to advice plus optional modifier
clauses. The follow-up emails re-judge yesterday's flagged leads with `computeAllIssuesCheckpointGs_` (still open / changed /
escalated / resolved / not found / reopened). Separately, `StaleLeads.gs` compares a live row's content hash with its latest
Movement_Log row to find leads that have not changed for more than 24 h, and moves them to the bottom of each email. `Core.gs` also
owns the Drive archive that every prune writes before it deletes rows.

---

## 2. Per file

### 2.1 Core.gs

**Purpose.** The shared "how do we read a lead row and decide what stage it is in" layer, plus archive and cell-budget utilities.
All `.gs` files share one global namespace, so every constant and function here is visible everywhere.

**Globals / constants**

| Name | Line | Value | Meaning |
|---|---|---|---|
| `TAB_NAME_OVERRIDE` | 33 | `'leads'` | The one fixed leads tab name (the monthly-rotating tab detection was removed 2026-09-01). |
| `HEADER_ALIASES_` | 37-71 | 24 keys -> alias lists | Canonical field -> accepted header labels (lower-case, exact match). Twin of `HEADER_ALIASES` in `js/core-sheets-fetch.js` (browser has 2 extra keys, intentional). `lead_closing_reason` and `rm_is_active` are read only for open/closed and the Inactive-RM rule. Note `'source'` maps to `group_source` and `'stage'` to `current_stage`; `'attempts'` to `call_attempts`. |
| `FUNNEL_ORDER_` | 78 | `not updated, suspect, opportunity, visit booked, visit, pipeline, gross eoi application, soft booking, booking` | Funnel order; index >= index of `opportunity` means Opportunity+. Order also matters for substring matching (first band that matches wins). |
| `STAGE_ALIASES_` | 79-89 | per band | Substring aliases per band, e.g. `visit` also covers `revisit`, `hpop`, `video presentation`, `video call`; `gross eoi application` covers `eoi`; `booking` covers `booked`. |
| `OPPORTUNITY_STAGE_` | 90 | `'opportunity'` | The threshold band. |
| `CLOSED_STAGE_EXACT_` | 91 | `won, lost, junk, dead, not interested` | Whole-word (or phrase-substring for multi-word) closed markers. |
| `CLOSED_STAGE_STEMS_` | 92 | `cancel, close, reject` | Word-prefix closed markers (`Cancelled`, `Closure`, `Rejected`). |
| `ARCHIVE_ROOT_FOLDER_` | 246 | `'Leads Dashboard Archive'` | Drive folder (of whoever owns the trigger) that holds one subfolder per archived table. |
| `ARCHIVE_MANIFEST_FILE_` | 251 | `'archive_log.csv'` | One append-only ledger in the root folder: `archived_at,table,filename,row_date_range,row_count`. |
| `WORKBOOK_CELL_CEILING_` | 458 | `10000000` | Google Sheets' per-workbook declared-grid cap. |
| `WORKBOOK_CELL_ALERT_WARN_PCT_` / `_CRITICAL_PCT_` | 459-460 | `0.70` / `0.85` | Thresholds used by `OpsChecklistRunner.gs`'s weekly alert. |

**Functions (file order)**

- **`canonicalStage_(stage)`** - `Core.gs:94`. Lower-cases and trims; empty -> `null`. Walks `FUNNEL_ORDER_` in order and, for each
  band, its aliases; returns the band if the text equals an alias OR merely CONTAINS it (`indexOf`). So `"Visit Booked"` resolves to
  `visit booked` only because that band is checked before `visit`; any text containing `booked` (e.g. `"booked elsewhere"`) resolves to
  `booking`; any text containing `visit` to `visit`. Returns `null` if nothing matches. Callers: `isOppOrAbove_`,
  `computeSlaFlags_` (Not Updated check), `overnightStatusLabelGs_`, `AllIssuesEmailer.gs:269` / `OvernightEmailer.gs:1049` (stage rank).
- **`isOppOrAbove_(stage, closingReason, leadClosingReason)`** - `Core.gs:115`. `canonicalStage_(stage)`; if `null`, falls back to
  `canonicalStage_` of `leadClosingReason || closingReason` (the sheet's own disposition is preferred; a filled-but-unmappable
  `leadClosingReason` hides a mappable `closingReason`). Unmappable -> `false`. Otherwise `true` when the band index >= `opportunity`.
  See finding A-2 for the substring problem in the reason fallback.
- **`isClosedStage_(stage)`** - `Core.gs:125`. Splits on anything that is not `a-z` or `'` (so `won't` stays one token and never hits
  `won`). Exact list: single-word keywords must be a whole token; multi-word (`not interested`) is a substring check. Then stems: any
  token that STARTS with `cancel`/`close`/`reject`. Returns boolean.
- **`isOpenLead_(stage, closingReason, leadClosingReason)`** - `Core.gs:141`. Closed if the stage is closed OR either closing reason
  has text. Open = not closed AND not Opportunity+. This is the gate in front of every SLA/email/logging path (12 call sites across
  AllIssuesEmailer, DailyRmIssueLog, InteractionHistoryLogger, MovementTracker, OvernightEmailer, RmHierarchy,
  UnmatchedCommentLogger, SlaEngine).
- **`resolveTabName_(ss)`** - `Core.gs:153`. Returns `TAB_NAME_OVERRIDE`; `ss` is unused (kept so callers did not change).
- **`buildColIndex_(headerRow)`** - `Core.gs:159`. For each canonical key, the FIRST header column (left to right) whose trimmed,
  lower-cased label is in that key's alias list; `-1` when absent. Column priority is by sheet position, not alias order (a sheet
  with both `source` and `group_source` maps whichever is further left). If `lead_id` is not found it silently falls back to column 0
  (same as the dashboard). Header row = row 2 of the tab (row 1 is the import banner), per the comment at 157-158; the caller
  (`readLeadsTab_`, EmailInfra.gs) supplies the row.
- **`getVal_(row, colIndex, key)`** - `Core.gs:175`. `''` when the key is unmapped or the cell is `null`/`undefined`; otherwise the raw
  cell value with its type preserved (Date stays Date, checkbox `false` stays `false`, numbers stay numbers). Several rules depend on
  that type preservation (Date-instance checks in `computeSlaFlags_`, the `rm_is_active` false case).
- **`istDayKeyGs_(date)`** - `Core.gs:182`. `Utilities.formatDate(date, 'Asia/Kolkata', 'yyyy-MM-dd')` - the IST calendar-day key used
  everywhere on the backend. Twin of `istDateKey` (`js/core-foundation.js`).
- **`pad2Gs_(n)`** - `Core.gs:186`. Zero-pads a number below 10.
- **`parseIstDayKeyOrDateGs_(cell)`** - `Core.gs:202`. A Date cell is returned as-is; a string starting `YYYY-MM-DD` becomes
  `new Date(y, m-1, d)` - midnight in the SCRIPT's time zone, not explicitly IST (comment acknowledges day resolution is enough);
  anything else -> `null` (callers keep, do not prune). Used only by `pruneCommentHistory_` (InteractionHistoryLogger.gs) and
  `pruneUnmatchedCommentsLog_` (UnmatchedCommentLogger.gs) for their 30-day cutoff and their archive date label.
- **`businessMinutesBetweenGs_(start, end)`** - `Core.gs:216`. 0 when either is missing or `end <= start`. Walks IST days: for the
  cursor's IST day key it builds `09:00+05:30` and `19:00+05:30` instants (from `WORK_START_HOUR_`/`WORK_END_HOUR_` in SlaEngine.gs),
  adds the overlap of `[cursor, end]` with that window, then jumps to the next IST midnight (+24 h; IST has no DST). Returns minutes.
  No weekend/holiday exclusion (same as the browser). Callers: `computeSlaFlags_` (10-minute first contact), and a second copy of the
  same rule in `DailyRmIssueLog.gs`.
- **`esc_(s)`** - `Core.gs:236`. HTML-escapes `& < > "` (not `'`; every attribute in the email builders is double-quoted, so this is
  sufficient as used).
- **`archiveRowsToDriveCsv_(tableName, header, rows, rowDateRangeLabel, opts)`** - `Core.gs:291`. Returns `null` and writes nothing for
  empty `rows`. Gets/creates the root folder and the `tableName` subfolder. Builds CSV: Date cells -> `toISOString()` (UTC), other cells
  quoted when they contain `"`, `,` or `\n` (a lone `\r` is not quoted), records joined with `\n`, no trailing newline. File name
  prefix `<table>_rows_<label>_archived_`. **Idempotence:** `findIdenticalArchiveFileGs_` looks for an existing file with that prefix and
  byte-identical content; if found, sets `opts.info.reused = true` and returns it (no new file, no manifest row). Otherwise creates
  `<prefix><IST yyyy-MM-dd_HHmmss>.csv`, sets `reused = false`, and (unless `opts.skipManifest`) appends a manifest row with IST
  timestamp. Returns the Drive `File`. Callers: `pruneMovementLog_` and its backup-tab helpers (MovementTracker.gs),
  `archiveChunksVerifiedGs_`, `EmailLedger.gs`, `RmHierarchySync.gs` (backups), `AllIssuesEmailer.gs` (test-mode one-off).
- **`archiveRootFolderGs_()`** - `Core.gs:331`. First Drive folder named `ARCHIVE_ROOT_FOLDER_`, created if missing.
- **`findIdenticalArchiveFileGs_(folder, namePrefix, csv)`** - `Core.gs:338`. Iterates EVERY file in the folder, name-prefix check,
  then reads the content of prefix matches and compares with `csv`. No `isTrashed()` check despite the comment saying "(not trashed)"
  (finding A-4).
- **`archiveChunksVerifiedGs_(tableName, header, rows, labelBase, chunkSize, usePartSuffix)`** - `Core.gs:355`. For each chunk of
  `chunkSize` rows: archive with `skipManifest: true` (label `<labelBase>_part<N>` when `usePartSuffix`), throw if no file comes back.
  Then re-reads every file, counts CSV records with `countCsvRecordsGs_`, subtracts one header per file and requires the total to equal
  `rows.length`. On any error, trashes the files THIS call created (never a reused one) and re-throws, so the caller deletes nothing.
  Returns `[{file, label, rowCount, reused}]`. Callers: `pruneCommentHistory_`, `pruneUnmatchedCommentsLog_` (5,000-row-style chunks,
  part suffix) and `pruneDailyRmIssueLog_` (one chunk of `dropped.length`, no suffix). Empty `rows` -> `[]` (loop never runs, 0 == 0).
- **`commitArchiveManifestGs_(tableName, entries)`** - `Core.gs:386`. After the caller has removed the rows: reads the manifest once,
  and for each entry whose file name does not already appear as `,<name>,` appends a row. Fail-open (logs, never throws).
- **`countCsvRecordsGs_(text)`** - `Core.gs:409`. Counts records the way the writer writes them: 1 + number of `\n` outside quotes;
  `""` toggles twice so it never ends a quoted cell. Empty -> 0.
- **`archiveAppendManifestRow_(rootFolder, rowValues)`** - `Core.gs:427`. Read-whole-file + append one line + `setContent`; creates
  the file with a header row on first use. Not atomic (two concurrent prunes could lose one line; the ledger is a convenience).
- **`computeWorkbookCellUsageGs_(ss)`** - `Core.gs:462`. Per tab `getMaxRows() * getMaxColumns()` (declared grid, not content),
  sorted largest first; returns `{sheets, totalCells, ceiling, pctUsed}`. Used by `reportWorkbookCellUsageNow` and
  `OpsChecklistRunner.gs`.
- **`fmtCellsGs_(n)`** - `Core.gs:475`. Rounds and inserts thousands commas (locale-independent).
- **`reportWorkbookCellUsageNow()`** - `Core.gs:482`. Console helper: logs total and per-tab breakdown.
- **`removeOppConversionTrackingTabNow()`** - `Core.gs:506`. One-off: deletes `Opp_Conversion_Tracking` if it has no data rows,
  throws if it has any. Already run 2026-09-29 (STALENESS_TRACKER.md; TEAM_CLAUDE_HANDOVER.md section 18) - dead now (A-14).

### 2.2 SlaEngine.gs

**Constants (twins of `CONFIG.*` in `js/core-foundation.js`, values identical)**

| Name | Line | Value | Meaning |
|---|---|---|---|
| `LEAD_GRACE_HOURS_` | 33 | 3 | Grace from assignment before most rules can fire. |
| `LEAD_LIFECYCLE_HOURS_` | 34 | 48 | The fresh-lead window. |
| `MIN_CALLS_PER_DAY_` | 35 | 5 | "Behind on Today's Calls" threshold. |
| `FOLLOWUP_REVIEW_HOURS_` | 36 | 4 | Post-connect review cadence. |
| `FIRST_CONTACT_SLA_MINUTES_` | 37 | 10 | First-contact window, in working minutes. |
| `WORK_START_HOUR_` / `WORK_END_HOUR_` | 38-39 | 9 / 19 | IST working window for `businessMinutesBetweenGs_`. |
| `ISSUE_PRIORITY_GS_` | 168-174 | inactiveRmNewLead > isNotUpdated > followupOverdue > underCalledToday > stageStuck48h | Same ORDER as the browser's `ISSUE_PRIORITY`; labels are shorter (`Follow-up Overdue`, `Stuck 48h+`). The labels are stored in AllIssues_Log JSON and compared by text in the checkpoints. |

**Functions**

- **`computeSlaFlags_(row, colIndex, now, baselineMap)`** - `SlaEngine.gs:46`. Returns
  `{isOpenLead, inactiveRmNewLead, isNotUpdated, followupOverdue, underCalledToday, stageStuck48h}`.
  1. `isOpenLead_` on stage + both closing reasons; not open -> all false.
  2. `created` = `lead_assigned_at` ONLY if it is a real Date (a text cell -> no rule fires; browser's `parseDate` would parse it -
     A-9).
  3. `ageHours`; `pastGrace = age >= 3`; `isUnder48h = age <= 48`; `past48h = age > 48`; `isCreatedToday` = same IST day key as `now`.
  4. **Inactive-RM Lead Added** = created today AND `rm_is_active` (stringified, keeps a real `false`) in `false/no/inactive/0/n`. No grace.
  5. **Stuck 48h+** = `past48h && pastGrace` (`pastGrace` is redundant there).
  6. `connectDate` = `last_connect_time` if a Date; `hasConnected` = connectDate OR non-empty `last_connect` text.
  7. `neverConnectedPastWindow` = under 48 h AND no connectDate AND more than 10 working minutes since assignment (no grace).
  8. **Not Updated** = (pastGrace AND stage band is `not updated`) OR neverConnectedPastWindow. Deliberately not gated on 48 h
     (2026-09-03), so a lead can be both Not Updated and Stuck; priority reports Not Updated.
  9. **Follow-up Overdue** = under 48 h AND pastGrace AND hasConnected AND hours since the newest dated comment (else since connect,
     else since assignment) > 4.
  10. **Behind on Today's Calls**: `callAttempts = Number(call_attempts) || 0`; `commentCountToday` = dated comment entries on `now`'s IST
      day. Created today -> today's count is `callAttempts`. Otherwise baseline = `baselineMap[lead_id]` (lead-id keyed since email audit
      F18); with a baseline -> `max(0, callAttempts - baseline, commentCountToday)`; without -> `commentCountToday`. Flag =
      `pastGrace && attemptsToday < 5`. Throws a TypeError if `baselineMap` is null/undefined for a non-today lead (all callers pass one).
  Time zone: day comparisons through `istDayKeyGs_`; comment timestamps parsed as `+05:30`. Callers: `writeSlaHistorySnapshot_`
  (MovementTracker.gs, per ROW, every snapshot), `AllIssuesEmailer.gs:262`, `OvernightEmailer.gs:1043/1991/2466`, `DailyRmIssueLog.gs`
  (live 194 and three historical replays 784/907/1410 that pass a past `now` with a Movement_Log row), and the checkpoint below.
- **`primaryIssueGs_(flags)`** - `SlaEngine.gs:175`. First `ISSUE_PRIORITY_GS_` entry whose key is truthy, as `{key, label}`; else `null`.
- **`allIssuesCheckpointPriorLabel_(entry)`** - `SlaEngine.gs:230`. `currentIssueLabel` for a checkpoint-result-shaped entry (has
  `state`), else `issueLabel` (raw 17:00 snapshot entry).
- **`allIssuesCheckpointPriorWasActive_(entry)`** - `SlaEngine.gs:233`. True unless `state` is `resolved` or `not_found` (a raw
  snapshot entry has no `state`, so it is always active).
- **`computeAllIssuesCheckpointGs_(ss, priorEntries, now, baselineMap, leadsData)`** - `SlaEngine.gs:241`. Empty input -> `[]`. Uses the
  caller's `{colIndex, dataRows}` if given (one sheet read per job, consistent moment), else `readLeadsTab_(ss)`. Indexes the FIRST row
  per wanted `lead_id` (a lead id can have several RM rows; the first in sheet order is used whatever the prior entry's RM was - A-11).
  Per prior entry: no row -> `not_found`; not open -> `resolved`; open but no SLA issue -> `resolved`; prior entry was resolved /
  not_found -> `reopened`; same label -> `still_open`; else `escalated` if the new label ranks higher in `ISSUE_PRIORITY_GS_`, else
  `category_changed`. Each result carries `currentStatus` (`overnightStatusLabelGs_`). Called once with the 17:00 snapshot (Checkpoint
  1, 10:00) and again with Checkpoint 1's own output (Checkpoint 2, 13:00) - `OvernightEmailer.gs:~740` and `~1690`.
- **`filterAllIssuesCheckpoint2ForEmailGs_(checkpoint1Entries, checkpoint2Results)`** - `SlaEngine.gs:323`. Since 2026-09-26 just
  filters `checkpoint2Results` to active states; `checkpoint1Entries` is unused, kept for the signature.
- **`allIssuesCheckpointIsActiveGs_(result)`** - `SlaEngine.gs:331`. Truthy result whose state is not `resolved` / `not_found`.

### 2.3 FollowupEngine.gs

**Functions and data, in file order**

- **`parseDatedCommentEntries_(internalComments, stageComments)`** - `:47`. Joins the non-empty columns with ` | `, splits on `|`, and for
  each entry takes a trailing `- YYYY-MM-DD HH:MM` and parses it as IST (`+05:30`). Does NOT require a `Name:` prefix (the browser's
  `parseActionLog` does - A-8). Returns an array of Dates.
- **`latestCommentTimestamp_(...)`** - `:62`. Max of the above, or `null`. Used by Follow-up Overdue.
- **`countTodayCommentEntries_(..., now)`** - `:68`. Count of entries on `now`'s IST day. Used by Behind on Today's Calls.
- **`_editDistanceGs_(a, b)`** - `:77`. Optimal-string-alignment distance (insert/delete/substitute + adjacent transposition = 1) with
  three rolling rows. Byte-identical logic to the browser `_editDistance`.
- **`_typoBudgetGs_(len)`** - `:100`. Target length <=4 -> 0 edits, <=8 -> 1, else 2.
- **`_wordsMatchGs_(word, target)`** - `:105`. Exact, or within the budget (with a cheap length-difference pre-filter).
- **`_wordsOfGs_(text)`** - `:111`. Lower-case, strip apostrophes, tokens of `[a-z0-9]+`.
- **`_signalWordsCacheGs_` / `_signalWordsOfGs_(signal)`** - `:114-119`. Cached split of a signal phrase on spaces.
- **`_signalMatchesGs_(commentWords, signal)`** - `:120`. One-word signal: any comment word fuzzy-matches. Phrase: the words must appear
  consecutively and in order, each fuzzy-matched.
- **`_anySignalGs_(words, signals)`** - `:132`. Any signal matches.
- **`OUTCOME_RULES_GS_`** - `:147-401`. 31 ordered rules `{outcome, signals?, test?(c, words)}`; first match wins. Order: Do Not
  Disturb, Switched Off, Wrong Number, Junk / Duplicate Lead, Call Declined, Busy, Booked Elsewhere, Needs Cross-Team Routing, Already
  With Another RM/CP, Channel Partner / Broker Lead, BPCL Not Shared, Resale / Rental (Out of Scope), RNR, Ringing / RNR, Disconnected,
  Voice Unclear, Out of Station, WhatsApp Unavailable, WhatsApp Sent, Details Shared, Visit Completed, Visit Arranged, Loan In Process,
  Not Interested, Considering, Budget Concern, Interested, DNP, Follow-up Missed, Already Visited (Other Project), Requirement Noted (No
  Status). Signal lists match the browser (`check-runtime-parity.py` ruleset pairs clean) and I compared every `test` body by hand:
  identical logic on both sides.
- **`inferOutcomeGs_(comment)`** - `:403`. Punctuation-only text -> `No Real Update`; else first matching rule; else `Update`. No cache
  (the browser caches by string).
- **`FOLLOWUP_SUGGESTIONS_GS_`** - `:414-447`. Outcome -> advice text, one per outcome plus `No Real Update` (no entry for `Update`, which
  routes to the unmatched text). Parity-checked identical.
- **`unmatchedFollowUpGs_(comment, loggedBy)`** - `:454`. Empty -> "Manual review required ..." line; else quotes the note with the logger
  name. The browser version also adds the IST timestamp and a longer manual-review sentence (cosmetic divergence).
- **`FOLLOWUP_MODIFIERS_GS_`** - `:490-550`. Backend-only (no browser twin): `budgetConcern` (skipped when the primary outcome is
  Budget Concern), `preferredTime` (explicit `after|before|around|by <1-2 digits>[:mm][am/pm]`, else an exact part-of-day word),
  `preferredChannel` (a preference word AND a channel word), `decisionMakerElsewhere` (family word AND consult word). Each `detect`
  returns a clause or `null`. See A-6 / A-7 for false positives.
- **`detectFollowupModifiersGs_(comment, primaryOutcome)`** - `:557`. Runs every modifier (with `this` bound to the modifier) and returns
  the clauses that fire.
- **`combinedCommentsTextGs_(row, colIndex)`** - `:580`. Own-row `internal_status_comments` + `stage_comments`, ` | `-joined, or the
  sentinel `'(no comments logged)'`. No sibling-copy pooling (that needs the browser's identity clustering).
- **`overnightStatusLabelGs_(stage)`** - `:590`. Title-cased funnel band, else the raw stage text, else `Unrecognized Stage`.
- **`overnightFollowupHintGs_(row, colIndex, now, baselineEntry)`** - `:635`. If `latestOutcomeGs_` returns an entry with text: advice
  for its outcome (or the unmatched quote) + any modifier clauses. Otherwise `noCommentFollowUpGs_`. Callers: AllIssuesEmailer.gs:278,
  OvernightEmailer.gs:1052/2100/2356.
- **`noCommentFollowUpGs_(row, colIndex, now, baselineEntry)`** - `:658`. `baselineEntry` = `{atMs, call_attempts}` from
  `lastSnapshotMap[lead_id]` (latest Movement_Log row before now). No entry, or entry younger than 4 h -> "connect and log". Current
  attempts <= baseline -> "no new call attempts in over 4 hours". Else "N more call attempts ... also send a WhatsApp message". Because
  Movement_Log only gains a row on change, the entry is the last observed change - the "over 4 hours" wording stays true.
- **`latestOutcomeGs_(row, colIndex)`** - `:693`. Parses entries with `^(.*?):\s*(.*?)\s*-\s*(ts)\s*$`; unparseable entries are kept as
  unattributed (`loggedBy ''`). Keeps entries whose logger equals the row's RM (case-insensitive) or is blank (all entries when RM is
  blank). Among those, prefers entries with text; picks the newest by IST timestamp, falling back to the last parsed. No entries ->
  `last_comment` (loggedBy `''`; the browser uses `l.RM`). Nothing -> `null`. Returns `{loggedBy, comment, ts, outcome}`. Also used by
  `InteractionHistoryLogger.gs:149` and `UnmatchedCommentLogger.gs:194`.

### 2.4 StaleLeads.gs

- **`LEAD_STALE_HOURS_`** - `:23` = 24 (strictly more than).
- **`staleSinceOfRowGs_(row, colIndex, lastChangeMap, now)`** - `:26`. Fail-open wrapper: the last-change Date if stale, else `null`
  (also `null` on any throw). Called per lead row by AllIssuesEmailer.gs:279 and OvernightEmailer.gs:1054/1997.
- **`leadStaleStateGs_(row, colIndex, lastChangeMap, now)`** - `:34`. Looks up `lastChangeMap[_dedupKeyGs_(lead_id, RM)]` (lead id + RM,
  blank RM = `Unassigned`). `lastChangeMap` comes from `buildMovementLogMapsGs_` -> `_collapseLatestChangeGs_`: per dedup key, the newest
  Movement_Log row that has a content hash, `{atMs, hash}`. No entry -> not stale. Live hash (`_leadContentHashGs_` over
  `SNAPSHOT_COLUMNS_`, MovementTracker.gs:165) differs from the entry -> not stale (changed since the last snapshot). Same hash ->
  stale when `now - atMs > 24 h`; returns `{stale, lastChangeAt, reason}`.
- **`staleSinceMapGs_(items)`** - `:50`. `{lead_id: Date}` for items whose `staleSince` is a Date.
- **`staleSinceForLeadIdsGs_(leadIds, leadsData, now)`** - `:58`. For checkpoint tables (which have lead ids but no row objects): scans
  `leadsData.dataRows`; a lead id is stale if ANY of its RM rows is stale. Fail-open to `{}` when the rows or `lastChangeMap` are missing
  or anything throws.
- **`splitStaleSectionsGs_(sections, staleSince)`** - `:80`. No stale ids -> the same array back. Only sections whose first column is
  `Lead ID` are split. Stale rows leave their table; a table left empty disappears and hands its `regionBand` to the next Lead-ID table
  without its own band (`pendingBand`). Moved rows go, oldest first, into a red copy of the table with an extra `No update since` column
  (`d MMM HH:mm IST`), its subheading prefixed with the region band; the first stale table carries the band "Stale leads - no update
  for more than 24 hours". Output = fresh sections then stale sections.

---

## 3. Data / control flow

```
leads tab (row 2 headers) --readLeadsTab_ (EmailInfra)--> buildColIndex_ -> getVal_
        |
        +--> isOpenLead_ (isClosedStage_ / closing reasons / isOppOrAbove_ -> canonicalStage_)
        |        | open only
        |        v
        |    computeSlaFlags_(row, now, baselineMap)          baselineMap = lead_id -> call_attempts at last
        |        | uses businessMinutesBetweenGs_,             Movement_Log row before today's IST midnight
        |        |      latestCommentTimestamp_, countTodayCommentEntries_
        |        v
        |    primaryIssueGs_  --> 17:00 AllIssues email rows / Overnight rows / SLA_History counts / Daily_RM_Issues
        |
        +--> overnightFollowupHintGs_ --> latestOutcomeGs_ -> inferOutcomeGs_ -> FOLLOWUP_SUGGESTIONS_GS_ (+ modifiers)
        |                              \-> noCommentFollowUpGs_ (lastSnapshotMap entry)
        |
        +--> staleSinceOfRowGs_ --> leadStaleStateGs_ (live hash vs lastChangeMap[lead_id|RM])
                                         \--> splitStaleSectionsGs_ at report build time

17:00 issue_snapshot_json --computeAllIssuesCheckpointGs_--> checkpoint1 (10:00)
checkpoint1 --computeAllIssuesCheckpointGs_--> raw checkpoint2 --filterAllIssuesCheckpoint2ForEmailGs_--> 13:00 email

Every prune: rows --archiveChunksVerifiedGs_ (or archiveRowsToDriveCsv_)--> Drive CSV --verify--> delete rows
              --> commitArchiveManifestGs_ (archive_log.csv)
```

Movement_Log interplay that matters for this subsystem: the snapshot job (4x/day) appends a row for a lead only when its content hash
differs from its latest row (keyed lead_id + RM), then (same run, later phase) prunes rows older than 7 days regardless of whether
they are a lead's only row (`MovementTracker.gs:834`). See A-1.

---

## 4. Cross-runtime parity

| Pair | Status | Notes |
|---|---|---|
| `HEADER_ALIASES_` vs `HEADER_ALIASES` | Matches except 2 browser-only keys | Intentional (no `.gs` reads them). Core.gs:35 comment still says "dashboard.html" (A-13). |
| `FUNNEL_ORDER_`/`STAGE_ALIASES_`/`CLOSED_STAGE_*` vs `CONFIG.*` | Match | Parity script clean. |
| `canonicalStage_`/`isOppOrAbove_`/`isClosedStage_` vs browser | Same logic | `Core.gs:94-136` vs `core-lead-model.js:83-161`. Shared weakness A-2. |
| `isOpenLead_` vs `isLeadClosed` + `isOppOrAbove` (`enrichLead` 258-261) | Same | |
| `businessMinutesBetweenGs_` vs `businessMinutesBetween` | Same result | GS builds day bounds from the IST key; browser via `istWallToInstant`. |
| `computeSlaFlags_` vs `enrichLead` | Same rules, same thresholds, same priority order | Divergences: (a) GS needs real Date cells for `lead_assigned_at` / `last_connect_time`, browser parses strings (A-9); (b) GS counts nameless dated comment entries, browser does not (A-8); (c) `ISSUE_PRIORITY` labels differ (display only). The F18 lead-id baseline and the 2026-10-01 `max(delta, commentCount)` fix are mirrored exactly (`SlaEngine.gs:146-161` vs `core-lead-model.js:386-400`; the browser additionally takes the best per-lead delta for merged records). |
| `OUTCOME_RULES_GS_` / `inferOutcomeGs_` vs `OUTCOME_RULES` / `inferOutcome` | Match | Signals via parity script; every `test` body compared by hand - identical. |
| `FOLLOWUP_SUGGESTIONS_GS_` | Match | |
| `latestOutcomeGs_` vs `latestFamilyOutcome` | Same selection logic | `last_comment` fallback loggedBy `''` vs `l.RM`; browser comment (core-outcome-engine.js:702) says the twin is in `OvernightEmailer.gs` - it is in `FollowupEngine.gs`. |
| `unmatchedFollowUpGs_` vs `unmatchedFollowUp` | Wording differs | Browser adds timestamp and a longer manual-review sentence. Cosmetic. |
| `noCommentFollowUpGs_` vs `noCommentFollowUp` | Same | |
| `FOLLOWUP_MODIFIERS_GS_` | Backend only | The dashboard's Suggested Follow-up never shows these clauses, so the same lead reads differently in the email and on the dashboard (by design as far as the code says; not listed in HANDOVER.md section 6). |
| `istDayKeyGs_` vs `istDateKey` | Match | |
| Stale leads | Backend only | HANDOVER.md:865 says the dashboard's "Stalled Leads" uses older rules. |

---

## 5. Findings

**A-1 - MED - `StaleLeads.gs:34-41` with `MovementTracker.gs:657-669, 722, 834-870` - long-quiet leads periodically lose their stale
status, and "No update since" is wrong once a lead has been quiet for more than 7 days.**
The stale check needs the lead's latest Movement_Log row. Because the snapshot only writes a row on change, a lead that stays unchanged
keeps exactly one old row, and `pruneMovementLog_` deletes it once it is 7 days old (it never keeps the latest row per lead). Order
within a run is capture then prune, so: run N captures nothing for the lead (hash still matches), then prunes its only row; until run
N+1 the lead has no entry -> "not stale"; run N+1 finds no prior hash and re-appends the lead with `snapshot_at = now` -> its
`lastChangeAt` resets to that moment, and it is "not stale" again for the next 24 h. Failure scenario: a lead last touched on 1 Oct
is correctly in the red stale block from 2 Oct; on about 8 Oct it drops back into the ordinary tables for roughly 24-30 h, then returns
to the stale block showing "No update since 8 Oct" although nothing has changed since 1 Oct. This repeats every 7 days, so a lead is
never shown as quiet for more than about 7 days, and at any moment a fraction of the oldest stale leads (roughly 24-30 h out of every
168 h, so about 15-18 %) are left out of the block. The same re-capture also makes `baselineMap` miss that lead for that day (it falls
back to the comment count). StaleLeads.gs:21 mentions "pruned" leads only as "no history", not the re-capture reset. CONFIRMED (code
path read end to end; I did not measure live frequency).

**A-2 - MED - `Core.gs:115-123` (and the browser twin `core-lead-model.js:104-114`, `isBookingLead`) - the closing-reason fallback uses
substring stage matching, so closed-lost reasons count as Opportunity+.**
When the stage text is unrecognised (typical closed stages such as `Lost`, `Junk`, `Closed` are not funnel bands), `isOppOrAbove_` runs
`canonicalStage_` on the closing reason, which matches by substring: any reason containing `booked` maps to `booking`, `visit` to
`visit`, `eoi` to `gross eoi application`. Scenario: stage `Lost`, `lead_closing_reason` `Booked elsewhere` -> `isOppOrAbove_` = true.
Effects on the backend: `MovementTracker.gs:1081/1192` (daily cohort same-day / 48 h Opp counts) credit it as a conversion;
`OvernightEmailer.gs:1989/2464` label it "Reached Opportunity+" instead of "Closed". `isOpenLead_` is unaffected (any reason closes the
lead anyway). On the dashboard the same reason would make `isBookingLead` count the lead as a booking. CONFIRMED for the code path;
how often such reason values occur in live data is not verified.

**A-3 - LOW - `FollowupEngine.gs:333` (`Interested` signal, shared with the browser) - `uninterested` classifies as Interested.**
`interested` has 10 letters -> typo budget 2; `uninterested` is 2 insertions away, so it matches. "Not interested" and "no interest"
are caught earlier, but a bare "uninterested" / "client uninterested" (no `not`) reaches the `Interested` rule and the email advises
"move quickly to the next step". CONFIRMED (edit distance worked by hand; same on both runtimes).

**A-4 - MED (SUSPECTED, depends on Drive behaviour) - `Core.gs:338-346` - the idempotent-archive lookup does not skip trashed files.**
The comment says "(not trashed)" but the code never calls `isTrashed()`. If `Folder.getFiles()` returns trashed children (my
understanding is that DriveApp iterators do include trashed items unless filtered), this can happen: `archiveChunksVerifiedGs_`
creates chunk 1, fails on chunk 2, trashes chunk 1 and throws (nothing deleted - correct). Next run: chunk 1's content is identical,
so the lookup "reuses" the TRASHED file, chunk 2 succeeds, verification passes, the rows are deleted, and the only archive copy of
chunk 1 sits in the Drive trash and is purged after 30 days. The verification reads the trashed file's content fine, so nothing
notices. `archiveRootFolderGs_` (`Core.gs:331`) has the same gap for a trashed root folder. Fix direction: skip `f.isTrashed()`.
SUSPECTED.

**A-5 - LOW - `Core.gs:338-346` - archive lookup cost grows with the folder.** Every archive call iterates every file in the table's
subfolder. Movement_Log prunes about 4x/day (plus chunked backups), so the folder grows by roughly 1,500 files a year, and each prune
(which already runs inside a 30-minute job with an 840 s optional-phase budget) iterates all of them. Not a defect today; it will keep
getting slower. CONFIRMED (code), impact estimated.

**A-6 - LOW - `FollowupEngine.gs:506` - `preferredTime` treats day counts as clock times.** The regex
`\b(after|before|around|by)\s*(\d{1,2})(?:[:.]\d{2})?\s*(am|pm|...)?\b` has an optional am/pm, so "call after 2 days", "will decide by
15 days", "after 6 months" all match and the email adds: They mentioned a specific time ("after 2") - target the callback for then.
Day-count phrasing is common in RM notes. Backend-only (emails). CONFIRMED.

**A-7 - LOW - `FollowupEngine.gs:529-548` - `preferredChannel` / `decisionMakerElsewhere` false positives.** `only` (exact) plus any
channel word fires the channel clause: "Interested only in 3bhk, details sent on whatsapp" -> "They asked to be reached via WhatsApp
instead of a call". `partner` (budget 1) plus `decide`/`discuss`/`ask` fires the decision-maker clause on channel-partner comments
("channel partner, will discuss with client"). CONFIRMED (code path); frequency unknown.

**A-8 - LOW - `FollowupEngine.gs:54` vs `js/core-outcome-engine.js:80` - backend counts nameless dated comment entries, the dashboard
does not.** The backend regex only needs a trailing `- YYYY-MM-DD HH:MM`; the browser's `parseActionLog` needs `Name:` first (the colon
inside `HH:MM` does not satisfy it - I traced the backtracking). An entry like `Called, no answer - 2026-10-10 11:05` therefore counts
toward the backend's latest-comment time (Follow-up Overdue) and today's count (Behind on Today's Calls) but not the dashboard's, so the
two can disagree on the same lead. CONFIRMED (code); depends on whether such entries exist in live data.

**A-9 - LOW - `SlaEngine.gs:60, 84` vs `core-lead-model.js:243, 289` - Date-typed cells required on the backend only.** If
`lead_assigned_at` comes back as text (a text-formatted or re-imported column), `computeSlaFlags_` returns no flags for the lead
while the dashboard's `parseDate` reads the string and flags it; likewise a text `last_connect_time` makes the backend treat the lead
as never connected (and so Not Updated), while the dashboard sees a connection. Today the cells are presumably Date-typed (the
suite and the live emails agree with the dashboard), so this is a latent divergence. SUSPECTED.

**A-10 - INFO - `SlaEngine.gs:85, 90, 124` (same on the browser) - "connected" is really "attempted".** `FollowupEngine.gs:601-611`
documents that `last_connect` and `last_connect_time` are set on every logged attempt, including Ringing / Not Reachable. The SLA
engine still uses them as "connected": Follow-up Overdue (4 h post-connect) fires for leads that were only dialled, and the 10-minute
never-connected path (`!connectDate`) stops firing after a failed dial. That makes the rules' names stronger than their data. Design
question, not a code slip.

**A-11 - LOW - `SlaEngine.gs:246-254` - the checkpoint judges the first row for a lead id, whatever its RM.** A lead id can have
several RM rows (MovementTracker.gs:446-456 counts about 1,852 multi-row leads). The prior entry carries an RM, but the lookup takes the
first row in sheet order. When the rows differ (for example the RM-specific `rm_is_active`, or comment history if it differs per
copy), the state can be computed for another RM's row. Probably small in practice (stage, counters and closing reasons are lead-level;
Inactive-RM only fires on the assignment day). `staleSinceForLeadIdsGs_` (`StaleLeads.gs:66`) likewise marks a lead id stale if ANY
of its rows is stale. SUSPECTED impact.

**A-12 - LOW - `StaleLeads.gs:83-97` - a region band can attach to the wrong table.** `pendingBand` is carried past non-`Lead ID`
sections (line 85 pushes them without clearing it). If a region's only Lead-ID table empties, a non-Lead-ID section follows, and the
next Lead-ID table belongs to another region but has no `regionBand` of its own, the emptied region's band is attached to it. Depends
on the section layouts the emailers build (I did not check every layout). Also, stale copies of continuation tables (no `regionBand`)
carry no region name in the stale block. SUSPECTED.

**A-13 - INFO - stale comments / doc mismatches.**
- `StaleLeads.gs:16` says `splitStaleSectionsGs_` is in EmailInfra.gs and `:45` says `leadStaleStateGs_` is in MovementTracker.gs - both
  are in StaleLeads.gs.
- `Core.gs:35, 73-77` and `SlaEngine.gs:4, 24`, `FollowupEngine.gs:3-4, 25-29, 571, 596, 671` point at `dashboard.html` / `js/core.js`
  (now `js/core-sheets-fetch.js`, `js/core-foundation.js`, `js/core-lead-model.js`, `js/core-outcome-engine.js`).
- `Core.gs:2-6, 20-25` list 11/13 backend files; the project now has 22 production `.gs` files (InteractionHistoryLogger, StaleLeads,
  EmailLedger, EmailReroute, RmHierarchySync, CycleReport, EmailSweep, OpsAudit, DailyChecklist, FollowupTracker, ...). CLAUDE.md's
  "What this is" list is equally out of date.
- `js/core-outcome-engine.js:702` says `latestOutcomeGs_` is in OvernightEmailer.gs (it is in FollowupEngine.gs).
- `Core.gs:196` cites `InteractionHistoryLogger.gs`/`UnmatchedCommentLogger.gs` correctly; fine.
- `FollowupEngine.gs:589` "Never called for a closed lead" is no longer true: `computeAllIssuesCheckpointGs_` (`SlaEngine.gs:269`) calls
  `overnightStatusLabelGs_` before the open check, so a closed stage shows its raw text (harmless).

**A-14 - INFO - dead code.** `removeOppConversionTrackingTabNow` (`Core.gs:506`) already ran on 2026-09-29; it is a guarded no-op now.
`resolveTabName_`'s `ss` parameter and `filterAllIssuesCheckpoint2ForEmailGs_`'s `checkpoint1Entries` parameter are unused (kept for
call-site compatibility). `stageStuck48h`'s `&& pastGrace` (`SlaEngine.gs:81`) can never change the result.

**A-15 - INFO - `Core.gs:202-208` / `Core.gs:299` - time-zone loose ends.** `parseIstDayKeyOrDateGs_` builds midnight in the script's
zone, not IST (fine for a 30-day cutoff, off by up to a day at the boundary if the project zone is not IST). Archive CSVs write Date
cells in UTC ISO form while file names and labels are IST dates, so someone reading an archive sees times 5.5 h earlier than the
labels suggest.

**A-16 - INFO - `SlaEngine.gs:161` with `MovementTracker.gs:546-565` - SLA_History "Behind on Today's Calls" depends on clock time.**
`underCalledToday` has no time-of-day scaling: at an early-morning snapshot nearly every open lead older than 3 h has 0 calls today and
counts as behind. SLA_History is written at every snapshot (4x/day), so the same day's rows swing widely with the capture hour. It also
counts per ROW (each RM copy of a lead), not per lead. Same rule on the dashboard; noted for anyone reading SLA_History trends.

---

## 6. Open questions

1. Does `DriveApp`'s `Folder.getFiles()` / `getFoldersByName()` return trashed items in this account's runtime? This decides whether A-4
   is a real data-loss path.
2. How often do live `lead_closing_reason` / `closing_reason` values contain `booked`, `visit` or `eoi` while the stage text is
   unrecognised (A-2)? A read-only count over the leads tab would settle it.
3. Do the comment logs contain dated entries with no `Name:` prefix (A-8), or entries whose prefix is a label rather than a person, for
   example the `Calling Status/Comment : Not Reachable - <ts>` shape quoted in `SlaEngine.gs:131-133`? If that entry really has no
   person name in front, `latestOutcomeGs_` treats `Calling Status/Comment` as a different logger and drops it from the owner's latest
   outcome (on both runtimes).
4. Are the RM rows of one lead id identical apart from RM / TL / `rm_is_active` (comments included)? That decides whether A-11 has any
   real effect.
5. Does the dashboard (browser) still write Movement_Log rows? If so, any field whose cell type differs between runtimes (for example a
   `duration` cell that Sheets auto-types as a time) would make browser-written and backend-computed hashes disagree. For the stale check
   that only fails safe (reads "not stale"), but it would also defeat dedup.
6. Is the absence of `FOLLOWUP_MODIFIERS` on the dashboard deliberate? HANDOVER.md section 6 does not list it as a one-sided construct.
