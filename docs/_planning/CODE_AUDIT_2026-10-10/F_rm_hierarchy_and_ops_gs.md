# Code audit 2026-10-10 — F: RM hierarchy, nightly HR sync, weekly ops checklist

Auditor F of 9. Read-only, line-by-line. No code changed.

## 1. Scope and summary

**Files read in full:** `RmHierarchy.gs` (1367 lines), `RmHierarchySync.gs` (702), `OpsChecklistRunner.gs` (312).
`RmHierarchy.private.gs` was read for **structure only** (no name or address from it appears here). The parts of
`EmailInfra.gs` that consume this code were read as needed: the name-to-address accessors (L61-155), the P&L-head Cc
(L157-190), `withRetry_`/`withSendRetry_` (L532-605), the job lock / run record / watchdog (L775-1021),
`resolveRecipientEmailsForRegion_` + `mergeBucketsByAddressGs_` + `loadRegionRecipients_` (L1107-1309). `Core.gs`'s
`archiveRowsToDriveCsv_` (L291) was read for the sync's backup. Context: `CLAUDE.md`, `HANDOVER.md` §4.3 (config table),
§4.3.2, §4.3.3, the second §4.3.4 (nightly sync), and `docs/_planning/RM_HIERARCHY_NIGHTLY_SYNC.md`.

**Summary.** `RmHierarchy.gs` turns an RM name on a lead into exactly one "To" manager plus a Cc set. The truth at send
time is the live `RM_Hierarchy` tab (one row per person: team, role, name, tl, tm, rh, ch, excluded, note, email) and
the `Manager_Directory` tab (manager name to address). Both tabs were seeded from the hard-coded, pre-resolved
`RM_HIERARCHY_RAW_` table (231 rows) plus the private name-to-email table. Routing picks the nearest filled tier
(tl, then tm, then rh, then ch). Three overrides sit on top: the loan team always goes to its City Lead with no Cc; two
Pre Sales A1s get a Cc of only one named person; senior / top-of-org people holding a lead themselves go to a CH-level
report. `EmailInfra.gs` then adds the region's `Region_Recipients` fallback, a company-wide CH-level backstop, the Futwork
vendor route, the leadership Cc and the P&L-head Cc. `RmHierarchySync.gs` (2026-10-08) compares the HR roster sheet with
the live tabs every night at about 23:15 IST. It auto-applies new joiners and single-candidate manager changes only when
apply is switched on, reports everything else, never removes anyone, backs both tabs up to Drive first, and locks out
`rebuildRmHierarchy()` once it is active. `OpsChecklistRunner.gs` emails ops every Monday at about 09:00 IST. The email
always goes out and covers five automatable health checks.

The main risks found:
- **(a)** The P&L-head Cc is added after the loan-team "no Cc" and Pre Sales "only one Cc" overrides, so the hard
  override is not hard (F-1).
- **(b)** The watchdog can almost never see a missed or stuck nightly sync, because its deadline (23:45) is 15 minutes
  before the IST day rolls over (F-2).
- **(c)** A crash after the sync has written leaves an alert saying "RM_Hierarchy was NOT changed" and loses the
  applied-changes report (F-3).
- **(d)** The sync never detects a manager tier that is blank in the tab but now filled in HR (F-4). It never refreshes
  alias rows (F-5). Hand-made rows have no way to opt out of auto-fixes except Excluded, which also stops routing (F-6).

---

## 2. Per file

### 2.1 `RmHierarchy.gs`

**Purpose.** Holds the static seed table, builds and rebuilds the two sheet tabs, reads them back for routing, applies
the per-RM bucketing and Cc rules, and provides coverage audits.

**Constants / globals**

| Name | Line | Value / meaning |
|---|---|---|
| `RM_HIERARCHY_SHEET_` | 140 | `'RM_Hierarchy'` |
| `MANAGER_DIRECTORY_SHEET_` | 141 | `'Manager_Directory'` |
| `RM_HIERARCHY_RAW_` | 155-479 | 231 rows `[team, role, name, tl, tm, rh, ch]`, already resolved per person. Mechanical check (script, this audit): no duplicate names (case-insensitive); every tl/tm/rh/ch value has its own row; 10 rows have a fully blank chain (7 top-of-org people, 1 'Leadership', the 'Sourabh Sareen Pnl' alias, the Pre Sales City Lead). Roles used: A1, BDM, City Lead, Cluster Head, Commercial Head, Executive, Leadership, Manager, RH, S1, S3, TM. Teams: 14, including Loan, Pre Sales, Sourcing - Pune, Leadership, Commercial. Tier quirks are deliberate: 5 S1 rows put a **TM** (the Central TM) in `tl`; 7 Pre Sales rows put a **City Lead** in `rh`. There are about 12 alias rows (old or leads-sheet spellings that point at the same chain as the real person). |
| `_employeeEmailLookupCache_` | 508 | lazy cache, normalised name to address (see `lookupEmployeeEmail_`) |
| `LEADERSHIP_NAMES_` | 1064 | two senior leaders (names only) |
| `ALWAYS_CC_EMAILS_` | 1065 | `null` in production (= look up by name); tests assign an array |
| `LEADERSHIP_NAME_TO_EMAIL_` | 1083 | `null` in production; tests assign an object |
| `RESTRICTED_CC_PRIMARY_NAMES_` | 1107 | `['rajesh muni','manisha rathod']`, bucket keys whose Cc is forced to one person |
| `LOAN_TEAM_CH_NAME_` | 1122 | `'mayur panjari'`, compared with the reporting RM's own `chain.ch` |
| `TOP_OF_ORG_ROLES_` | 1136 | `['cluster head','city lead','commercial head']` (not 'leadership') |
| `TM_STILL_CC_` | 1201 | three TMs who stay in Cc because they have real A1s under them |
| `ROLE_SUFFIX_RE_` | 1212 | `/\s+s\s*\d+.*$/i`, strips "S 1 Account"-style suffixes |

**`RmHierarchy.private.gs` (structure only).** It defines one global, `EMPLOYEE_EMAIL_BY_NAME_RAW_`: an array of about
338 two-element `[name, email]` rows covering the whole company. It has a header comment and a few "AUTO-REFRESH"
marker comments. There is **no top-level executable code** on purpose, because of the load-order rule. No name repeats
after normalisation (checked). Lookups happen only through `lookupEmployeeEmail_` (here) and
`resolvedEmailForNameGs_` (`EmailInfra.gs:66`, which lower-cases the result).

**Functions, in file order**

1. **`normPersonName_(name)`, L486.** `String(name||'').trim().toLowerCase()`, collapses runs of whitespace, removes one
   trailing period. Pure. It is used by the private-table lookup and by the whole sync. **It is not used by the routing
   lookups** (`loadRmHierarchyAndEmails_` and `lookupRmChain_` use `trim().toLowerCase()` only). See F-13.
2. **`lookupEmployeeEmail_(name)`, L509.** Returns `''` if `EMPLOYEE_EMAIL_BY_NAME_RAW_` is undefined (private file not
   pasted). Builds the cache on the first call (never at load time, because Apps Script file load order is not
   guaranteed). Returns the address or `''`. Callers: `resolveRmHierarchy_`, `ensureManagerDirectorySheetInternal_`,
   `resolvedEmailForNameGs_` (and through it the ops / CH-level / Futwork / leadership / sync-report addresses).
3. **`resolveRmHierarchy_()`, L529.** Pure. Maps the raw table to
   `{team, role, name, tl, tm, rh, ch, excluded:false, note, email}`. `note` is
   `'No manager on file for this person.'` when all four tiers are blank. `email` is the person's own address from the
   private table. Callers: `ensureRmHierarchySheet_`, `rebuildRmHierarchy`, `ensureManagerDirectorySheetInternal_`.
4. **`ensureRmHierarchySheet_(ss)`, L549.** If the tab exists, returns it untouched. Otherwise it inserts the tab,
   flushes, writes the 10-column header and freezes it, writes every resolved row, and inserts checkboxes in column H.
   Each step is retried separately with `withRetry_`. **It is called on every routing load**
   (`loadRmHierarchyAndEmails_`), so a missing tab is silently re-seeded from the raw table, even when the sync is active
   (F-11).
5. **`rebuildRmHierarchy(force)`, L588.**
   - **Guard:** unless `force === true`, it refuses and logs when `rmHierarchySyncIsActiveGs_()` is true (`typeof`
     guard, so it works without the sync file).
   - **Steps:** reads the existing tab (all columns, so older layouts still read) into `priorByName`, keyed by
     trim-lower name, holding `{excluded: col H, note: col I, email: col J}`. Rebuilds rows from the raw table: Excluded
     comes from the prior row when there is one; note and email come from the prior row when non-blank, otherwise the
     generated value. It then deletes the tab, flushes, inserts it again, flushes, writes the header, rows and
     checkboxes. Next it calls `ensureManagerDirectorySheetInternal_(ss, true)` (a full rebuild of Manager_Directory,
     keeping emails) and `logPostRebuildCoverageAudit_`.
   - **Edge cases:** it is not atomic. Between the delete and the insert there is no `RM_Hierarchy` tab, and nothing
     takes the job lock (F-11). A prior auto-generated note "No manager on file…" survives forever even after the person
     gains a chain (F-15). People dropped from the raw table vanish, including sync-added rows on a forced rebuild (this
     is intended).
6. **`rebuildRmHierarchyForce()`, L659.** Calls `rebuildRmHierarchy(true)`.
7. **`logPostRebuildCoverageAudit_(ss)`, L685.** Two independent try/catch halves. `auditUnresolvedRms_` logs either a
   "COVERAGE GAP" line per name or "all clear". `auditManagerDirectoryEmailGaps_` logs a gap count or "all clear"
   (`null` means the tab is missing, so it stays silent). It never throws. Log only.
8. **`listExcludedRmsNow()`, L724.** Read-only. Logs every row whose column H is truthy.
9. **`clearAllRmHierarchyExclusionsNow()`, L752.** Sets column H to `false` on every row. Only the `getRange` is retried,
   not `getValues`. Its final log line points at `backfillTodaysOvernightLogRecipientsNow` (exists,
   `OvernightEmailer.gs`).
10. **`auditManagerDirectoryEmailGaps_(ss)`, L794.** Returns `null` if the tab is missing and `[]` if it is empty.
    Otherwise it returns rows with a name, `people_reporting_up_to_them > 0` and a blank email, as
    `{rowNum, name, roles, regions, reportCount}`. Note that the report count is only rewritten by a rebuild. The sync
    never updates it for existing managers (F-16).
11. **`auditManagerDirectoryEmailGapsNow()`, L816.** Console wrapper. Logs the result.
12. **`auditUnresolvedRms_(ss)`, L869.**
    - **Reads:** the current month's leads tab (`resolveTabName_`, header in row 2, data from row 3).
    - **Filter, per row:** needs a `lead_id`; must pass `passesGoogleNonUtmSearchGs_(group_source, source_bucket)`; must
      be open (`isOpenLead_` on stage and two closing-reason columns); RM column non-blank. A recognised leadership name
      is skipped. Otherwise it calls `lookupRmChain_`, and a missing or Excluded chain counts as a gap.
    - **Returns:** `[{name, count, leadIds (≤20), inCompanyRoster}]`, sorted by name. `inCompanyRoster` is an **exact,
      case-sensitive** match against the private table's names (F-14).
    - It throws if the tab is missing. It calls `loadRmHierarchyAndEmails_`, which can create tabs (F-11).
13. **`auditUnresolvedRmsNow()`, L921.** Console wrapper. Its advice ("add an alias row to RM_HIERARCHY_RAW_ and run
    rebuildRmHierarchy()") is wrong once the sync is active (F-9).
14. **`ensureManagerDirectorySheetInternal_(ss, forceRefresh)`, L943.** If the tab exists and this is not a forced
    refresh, it returns the tab. Otherwise:
    - It reads the prior name-to-email map (trim-lower).
    - It rebuilds one row per distinct manager name across tl/tm/rh/ch **from `RM_HIERARCHY_RAW_`, not the live tab**,
      with role labels TL/TM/RH/CH, regions (= team values), a report count, and an email. The email is the prior email,
      else the private-table address. `email_source` is 'manual' when a prior email existed (even one auto-filled
      before), else 'HR export auto-match', else blank.
    - It deletes and recreates the tab with the 6-column header.
    - Only `rebuildRmHierarchy` forces a refresh, and that path is locked while the sync is active.
15. **`ensureManagerDirectorySheet_(ss)`, L1006.** The non-forced form of the above.
16. **`loadRmHierarchyAndEmails_(ss)`, L1017.** Ensures both tabs exist, then (inside one `withRetry_`) reads them.
    - `byRmNameLower[name.trim().toLowerCase()]` = `{role, tl, tm, rh, ch, excluded: !!colH}`. A later duplicate
      overwrites an earlier one.
    - `emailByManagerNameLower[name.trim().toLowerCase()]` = column D.
    - **The RM_Hierarchy `email` column (J) is not read.**
    - Callers: `AllIssuesEmailer.gs:218`, `OvernightEmailer.gs:989/2229/2490`, `EmailReroute.gs:320`,
      `regionPnlHeadEmailGs_` (fallback), `resolveRecipientBucketsForRms_` (fallback), `auditUnresolvedRms_`.
17. **`alwaysCcEmailsGs_()`, L1066.** Returns the test array if one is set, otherwise looks up each leadership name.
    Names that cannot be resolved are skipped.
18. **`leadershipEmailByNameGs_(nameLower)`, L1084.** Takes the test map if set, otherwise an exact (case-insensitive)
    match against `LEADERSHIP_NAMES_`, then the private-table address.
19. **`isTopOfOrgRole_(role)`, L1137.** Membership in `TOP_OF_ORG_ROLES_` (trim-lower).
20. **`stripRoleSuffix_(name)`, L1213.** Removes a trailing `" S <digits>…"`.
21. **`lookupRmChain_(byRmNameLower, rmName)`, L1222.** Tries the exact trim-lower key first. If that misses, it tries
    the key with the suffix stripped, but only when that key differs. Returns the chain object or `undefined`. It is
    also used by `OvernightEmailer.gs`'s `debugFollowupStatusNow`.
22. **`resolveRecipientBucketsForRms_(ss, rmNames, hierarchyData)`, L1241.** The core routing function. See §3.1.
    Returns `{buckets:[{primaryName, primaryEmail, primaryRole, cc[], rmNames[]}], unresolved:[{rmName, reason}],
    chLevelRms:[{rmName, chName, chEmail, chRole}]}`. Buckets are sorted by the lower-cased primary name.
23. **`setupRmHierarchy()`, L1357.** Ensures both tabs exist. **It does not rebuild.** The header (L129-131) and the
    HANDOVER §4.3 table say re-running it refreshes the tabs. That is wrong (F-10).

**Time zone.** Nothing in this file depends on the clock.

### 2.2 `RmHierarchySync.gs`

**Purpose.** The nightly HR-roster to live-tab reconciliation (`GS-014`).

**Constants (L30-59):**
- **Sheet and job:** `RMSYNC_HR_SHEET_ID_` (the HR sheet, first tab only); job name `syncRmHierarchyNightly`; run time
  23:15.
- **Script Properties:** `RM_HIERARCHY_SYNC_APPLY` (`'true'` turns writing on) and `RM_HIERARCHY_SYNC_STATE` (JSON
  `{items:{hash:1}, lastReminderDay, appliedEver}`).
- **Report and limits:** report recipients by name (3 people); minimum 250 HR people; maximum 25 changes per night;
  60 lines per report section; state capped at 8000 characters.
- **HR columns (0-indexed):** code 0, name 1, role 2, team 15, exit 17, email 35, chain 6/8/10/12.
- **Header check:** `RMSYNC_HR_HEADER_EXPECT_` lists the expected header text at columns 1, 2, 6, 8, 10, 12, 15, 17, 35
  (column 0 is not checked).
- **Tab layout:** `RMSYNC_TAB_HEADER_` (the 10 tab columns); `RMSYNC_FIELD_COL_` maps tl/tm/rh/ch to columns 4-7.
- **Scope:** `RMSYNC_SALES_ROLES_` (12 roles; not Executive / Manager / Leadership); `RMSYNC_OUT_OF_SCOPE_TEAMS_` (two
  Magnet teams).
- **Role to field:** `RMSYNC_ROLE_TO_FIELD_` maps a1/tl to tl, tm to tm, rh to rh, and cluster head / city lead /
  commercial head / leadership to ch.
- **Near-name matching:** `RMSYNC_NOISE_TOKENS_` = pnl / account / acct.

**Functions, in file order**

1. **`showRmHierarchySyncPlanNow()`, L64.** Read-only. Reads the HR sheet and both tabs (it **throws** if `RM_Hierarchy`
   is missing, because `readRmHierarchyRowsGs_(null)` is called). Logs the would-apply lines and the attention items.
   No email, no state written.
2. **`showRmHierarchySyncStatusNow()`, L81.** Logs whether apply is on, `appliedEver`, the count of remembered items, the
   last reminder day, and the run record.
3. **`rmSyncStr_` / `rmSyncUnique_`, L87-88.** Trimmed string; order-preserving de-duplication.
4. **`rmSyncNameTokensGs_(name)`, L97.** Lower case, letters and digits only. Drops one-letter tokens, pure-number
   tokens, and the noise words.
5. **`rmSyncEditDistanceGs_(a,b)`, L104.** Optimal-string-alignment distance (adjacent swaps count as one edit).
6. **`rmSyncTokenCloseGs_(a,b)`, L120.** Exact match when the longer token is under 5 letters; up to 1 edit at 5-6
   letters; up to 2 edits at 7 or more.
7. **`rmSyncNearNameGs_(rowName, person)`, L128.** "Is the tab name an old spelling of this HR person?" It returns true
   on any of four rules:
   1. Identical token lists.
   2. The smaller list has at least 2 tokens, all of them appear in the bigger list, and the bigger list has at most 2
      extra tokens (a dropped middle name or a reordered name).
   3. Same token count (at least 2) and every token pair is close.
   4. The tab name ends in "account", has a single token, and that token equals the HR person's first token.
   The caller requires **exactly one** current (not exited) HR match.
8. **`parseHrRosterGs_(values)`, L146.**
   - **Header check:** whitespace-collapsed and lower-cased; any mismatch adds to `problems` and returns early.
   - **Per row:** a row with a blank name is skipped. `email` is kept only if it contains '@'. `chainNames` takes
     columns 6/8/10/12 minus blanks and '-'. `exited` means the exit cell is not '' and not '-'; a Date counts as
     exited.
   - **Several rows per person:** keyed by `normPersonName_`. Chain names are unioned and exit flags are OR'd. The first
     non-blank email and code win. Role and team come from the **first** row.
   - **Returns:** `{problems, people, count}`.
9. **`readRmHierarchyRowsGs_(sheet)`, L186.** Reads 10 columns from row 2. Rows with a blank name are skipped. Returns
   objects with `rowNumber`, the fields, `excluded` (strictly `true` or the text "true"), `note`, `email`.
10. **`readManagerDirectoryRowsGs_(sheet)`, L202.** Returns `{rowNumber, name, email}`.
11. **`classifyRmSyncJoinerGs_(person, roleByKey)`, L218.** A blank chain is LOW. Otherwise each chain name is looked up
    by its own role in the tab and mapped to a field. An unknown role is LOW. Two different names for one field is LOW.
    Otherwise HIGH, returning `{confidence, fields, notes}`.
12. **`computeRmHierarchySyncPlanGs_(hr, rows, directory)`, L236.** Pure. See §3.2 for the full logic. Returns
    `{newJoiners, newJoinersLow, fixes, needsHuman, leavers, aliases, emailFills, emailChanges, directoryAdds}`.
13. **`rmSyncHashGs_(s)`, L355.** djb2-xor 32-bit hash written in hex, used for the state keys. Collisions are possible
    but negligible at this scale.
14. **`readRmSyncStateGs_()` / `writeRmSyncStateGs_(state)`, L360 / L372.** Script Property JSON. A read error gives
    blank state. A write over 8000 characters or a write error is logged and returns `false`; nothing throws.
15. **`rmHierarchySyncApplyEnabledGs_()`, L383.** The property equals the text `'true'`.
16. **`rmHierarchySyncIsActiveGs_()`, L388.** Apply is on, **or** `state.appliedEver`. This is the rebuild lock-out.
17. **`rmSyncIsMondayIstGs_(now)`, L391.** Adds 330 minutes, then `getUTCDay() === 1`. Correct for IST and not affected
    by the host time zone.
18. **`rmSyncLinesGs_`, L395.** Truncates to 60 lines plus a "… and N more" line.
19. **`rmSyncWhoGs_`, L399.** "name (team, role, code)".
20. **`rmSyncAttentionItemsGs_(plan)`, L402.** One item per needsHuman / newJoinersLow / leavers / aliases / emailChanges
    entry, each with a stable id (`H|name|field|old`, `J|name`, `L|name`, `A|name|match`, `E|name|hrEmail`) and the
    report line.
21. **`rmSyncChangeLinesGs_(plan)`, L422.** Text lines for joiners, fixes and directory changes.
22. **`buildRmHierarchySyncReportGs_(info)`, L437.**
    - **Header:** the day, the mode, and counts.
    - **Mode text:** REPORT-ONLY says nothing changed. HELD gives the count and the limit.
    - **Changes:** an "APPLIED" or "WOULD BE APPLIED" block (joiners, fixes, directory).
    - **Five "new only" sections:** human, joiner, leaver, alias, email.
    - **Then:** the Monday reminder block, apply problems, warnings, and backup URLs.
    - **Subject:** counts changes and the non-alias new attention items.
23. **`rmSyncRecipientsGs_(hr)`, L488.**
    - In test mode, the test address only.
    - Otherwise, each report name resolves from the private table first, then from that person's HR-sheet email.
      Addresses are de-duplicated; names that cannot be resolved are listed as `missing`.
    - If nobody resolves, the ops address is used.
24. **`applyRmHierarchySyncPlanGs_(...)`, L507.**
    - **Backup:** writes the tab rows (from the in-memory read) to Drive `RM_Hierarchy_sync_backup`, and the raw
      Manager_Directory values to `Manager_Directory_sync_backup`. `archiveRowsToDriveCsv_` throws on a Drive failure,
      so no backup means no write. It returns null only for an empty tab, which is harmless. An identical file is
      reused.
    - **Fixes:** for each fix, re-reads the name and current value. If either changed, the fix is skipped and recorded
      as a problem. Otherwise it writes the new value and appends a `sync <day>: field old -> new` note (joined with
      ' | ').
    - **New joiners:** appended after `getLastRow()` with Excluded = false, the note "added by the nightly sync <day>",
      and the HR email; checkboxes are inserted.
    - **Manager_Directory:** for each email fill, re-checks the name and that the cell is still blank, then writes the
      email and `email_source='HR sheet sync'`. New managers are appended.
    - **Read-back:** flushes, re-reads the tab, and confirms every fix (unless skipped) and every joiner. Manager_Directory
      writes are **not** read back.
    - **Returns:** `{problems, backupUrls}`.
25. **`readHrRosterValuesGs_()`, L576.** `openById` (a failure throws an error explaining the access needed); the first
    tab; its whole data range `getValues()`.
26. **`runRmHierarchySyncGs_(opts)`, L592.** The orchestrator. See §3.2. Returns `{mode, plan, held, newAttention,
    outstanding, reminders, applyProblems, recipients}`.
27. **`syncRmHierarchyNightly()`, L663.** The trigger target. Runs inside `withEmailJobLockGs_` (script lock, 30 s wait,
    run record). On error it sends an ops alert titled "…RM_Hierarchy was NOT changed" and re-throws (F-3).
28. **`syncRmHierarchyNightlyNow()`, L678.** The manual alias of the above.
29. **`setupRmHierarchySync()`, L681.** Deletes its own triggers, then creates a daily trigger at hour 23, near minute 15,
    in Asia/Kolkata.
30. **`enableRmHierarchySyncApplyNow()` / `disableRmHierarchySyncApplyNow()`, L695 / L699.** Set the property to
    'true' / 'false'. Note: disabling does **not** lift the rebuild lock-out once `appliedEver` is true (intended).

**Time zone.** `day = istDayKeyGs_(now)`. Monday is computed with an explicit +05:30 shift. The trigger uses
`inTimezone('Asia/Kolkata')`. Correct throughout.

### 2.3 `OpsChecklistRunner.gs`

**Purpose.** A weekly always-sent ops summary of five automatable checks (CHECKLIST-006).

**Constants:**
- `FEATURE_USAGE_SHEET_GS_` = 'Feature_Usage'.
- `TRACKED_COMPONENT_IDS_GS_`: 9 tab ids, a hand-kept mirror of `js/sheets-writeback.js`.
- `STALE_COMPONENT_DAYS_GS_` = 30.
- `FEATURE_USAGE_TRACKING_STARTED_GS_` = `new Date(2026, 9, 3)`, local midnight in the script's time zone, not pinned to
  IST (F-17).

**Functions**

1. **`parseFeatureUsageTimestampGs_(cell)`, L89.** A Date is returned as is. A string `YYYY-MM-DD HH:mm:ss` is parsed as
   a **local** time (the string is IST wall time; harmless at a 30-day scale). Otherwise null.
2. **`checkStaleComponents_(ss, now)`, L107.**
   - `neverObservedIsStale` is true once tracking has run for more than 30 days.
   - If the sheet is missing or has only a header, status is 'missing' or 'empty': every id goes to `stale`
     (neverUsed) or `neverObserved`, depending on that flag.
   - Otherwise it reads columns A-D, keeps the last row per id, and buckets each tracked id as never observed, stale
     (more than 30 days) or recent.
   - Returns `{status, stale, neverObserved, recent}`.
3. **`buildWeeklyOpsChecklistSummary_(ss, now)`, L154.** Builds `{issueCount, lines}` from five checks:
   1. `auditUnresolvedRms_` (retried). Shows the first 10 names.
   2. `auditManagerDirectoryEmailGaps_`. A null result (tab missing) counts as 1 issue.
   3. `checkMovementLogFreshness_(ss, now)`. Anything other than fresh is an issue.
   4. `computeWorkbookCellUsageGs_`. WARN and CRITICAL each count as 1 issue; the top 3 tabs are named.
   5. `checkStaleComponents_`. Each stale tab is an issue. The **'missing' status prints an info line and ignores
      `stale` even after the 30-day grace period** (F-12).
   It ends with a manual reminder line. No try/catch per check, so one throwing check kills the whole email (F-18).
4. **`runWeeklyOpsChecklist_(ss, now)`, L270.** Builds the summary. The subject is `[Ops Checklist] N item(s) to review`
   or `all clear`, plus the IST date. Sends `GmailApp.sendEmail(opsAlertEmailGs_(), …)` under `withSendRetry_` (the
   correct retry for a send). A send failure is logged and re-thrown.
5. **`runWeeklyOpsChecklistNow()`, L289.** The trigger target. Real spreadsheet, `new Date()`.
6. **`setupWeeklyOpsChecklistTrigger()`, L300.** Deletes its own triggers, then creates one on Monday at hour 9, near
   minute 0, Asia/Kolkata.

Not registered in `emailJobScheduleGs_`, so the hourly watchdog does not watch it. By design, a missing Monday email is
the alarm.

---

## 3. End-to-end narratives

### 3.1 From an RM name on a lead to recipient buckets

The callers are `AllIssuesEmailer.gs` (17:00) and `OvernightEmailer.gs` (10:00, and 13:00 by stored Cc). They gate every
lead through `passesGoogleNonUtmSearchGs_`, group the RM names by region (Futwork names are keyed to the pseudo-region
`Futwork` by `regionKeyForRmGs_`), load the hierarchy once, and call
`resolveRecipientEmailsForRegion_(ss, region, rmNames, legacyRecipients, opts)` (`EmailInfra.gs:1170`):

1. **Futwork split** (`EmailInfra.gs:1176`). Any name matching `/futwork/i` is removed from normal routing.
2. **P&L head** (`regionPnlHeadEmailGs_`, `EmailInfra.gs:166`). The region (case-insensitive) is mapped through
   `REGION_PNL_HEAD_CC_` (Hyderabad, Bangalore, Thane, Navi Mumbai) to a name, and the name to its `Manager_Directory`
   address. If there is no address, a line is logged and no Cc is added.
3. **`resolveRecipientBucketsForRms_`** (`RmHierarchy.gs:1241`). For each name:
   1. **Look up the chain** (`lookupRmChain_`): exact trim-lower first, then with the role suffix stripped. Aliases are
      simply extra rows with the alternate spelling.
   2. **No chain:** if the name is a leadership name with an address, it goes to `chLevelRms`
      (chRole 'Leadership'). Otherwise it is `unresolved` ("Not found…").
   3. **Chain Excluded:** `unresolved`.
   4. **Self top-of-org:** all four tiers blank **and** the role is Cluster Head / City Lead / Commercial Head **and** the
      person's own name has a `Manager_Directory` address (that only happens when they are someone else's manager). Then
      it goes to `chLevelRms` with the real role. If there is no address it falls through to step 5 and normally ends
      `unresolved`. The 'Leadership' role never qualifies.
   5. **Loan override:** if the reporting RM's `chain.ch` is the loan City Lead, the primary is that `ch`. Otherwise the
      primary is `tl || tm || rh || ch`. If there is no primary, `unresolved`.
   6. **Primary address:** `emailByManagerNameLower[primary.toLowerCase()]`. If there is none, `unresolved`
      ("…no email in Manager_Directory").
   7. **Bucket:** keyed by the lower-cased primary name (one bucket per distinct primary, never several people in To).
      The bucket's role is the primary's own row role.
   8. **Cc candidates come from the primary's own row:** rh and ch, plus tm only if that tm is in `TM_STILL_CC_`. The
      reporting RM's own row is used only if the primary has no row. Each name is turned into an address through
      `Manager_Directory`.
   9. **Finalise each bucket:**
      - loan City Lead bucket: Cc emptied;
      - restricted primary: Cc replaced by the one named person's `Manager_Directory` address;
      - any other bucket: the leadership addresses are added;
      - then the To address is removed from Cc.
4. **Back in `EmailInfra.gs`:** every bucket's Cc gets the P&L head added (`withRegionPnlHeadCcGs_`), unless that address
   is already the To or already present. **This runs after the loan and restricted overrides (F-1).**
5. **Optional CH-level alert.** `fireAlerts` sends `notifyChLevelLeadsGs_` (ops plus the CH-level address, no
   leadership).
6. **`unresolved` names:**
   - If the region has a `Region_Recipients` row (to and cc): one combined bucket with legacy cc + leadership + P&L head.
   - Otherwise: the **CH-level backstop**, a bucket to `chLevelEmailGs_()` (the CH-level person, else ops) with no Cc at
     all.
7. **Merge.** `mergeBucketsByAddressGs_` merges buckets that share a To address (union of RM names and Cc lists).
8. **Futwork bucket.** Appended after the merge: To `futworkRouteEmailGs_()` (named person, else ops), no Cc.
9. **Test mode.** If `TEST_MODE_OVERRIDE_EMAIL_` is set, every To is redirected, Cc is dropped, and the originals are kept.

**Where names become addresses:**
- **Managers:** only `Manager_Directory` column D. It was filled at seed or rebuild time from the private table (the
  existing cell wins), by hand, or by the sync from the HR sheet's mail column.
- **Ops / CH-level / Futwork / leadership / sync-report recipients:** the private table by name, at call time.

### 3.2 The nightly HR sync (`syncRmHierarchyNightly`, about 23:15 IST)

1. **Lock and run record.** `withEmailJobLockGs_`. If the lock is busy, the run is skipped and ops is alerted. A run
   record (running, then completed or failed) is written unless in test mode.
2. **Read the HR sheet** (first tab). Throws on: no access, no tabs, a header mismatch, or fewer than 250 distinct
   people.
3. **Read the live tab.** Throws if `RM_Hierarchy` is missing or its 10-column header differs. Manager_Directory is
   optional; if it is missing, a warning is added and directory checks are skipped.
4. **Plan** (pure; `computeRmHierarchySyncPlanGs_`):
   - **Lookups:** `roleByKey` and `nameByKey` come from the tab (alias rows included). `canon()` maps any spelling back
     to the tab's own spelling.
   - **Existing rows** (Excluded rows are skipped entirely):
     - **Not in HR by exact normalised name:** compute near-name matches. Exactly one current match goes to `aliases`
       ("old spelling", nothing changed). Otherwise it goes to `leavers` (reason "not in the HR sheet", with up to 3
       similar names).
     - **In HR but exited:** `leavers`.
     - **Otherwise,** for each **non-blank** tier value not in the person's HR chain:
       - If the chain has exactly one distinct name and that name's tab role maps to this field, it is a **fix**
         (written only when apply is on).
       - Otherwise it goes to `needsHuman`, with a suggested value when the whole chain classifies HIGH and gives a
         different name for that field.
       - **Blank tiers are never examined (F-4). Alias rows are never examined (F-5).**
   - **New joiners:** HR people with no tab row, not exited, a role in the 12 sales roles, and a team that is not Magnet.
     They are sorted by key and classified for up to 4 passes, so a joiner who reports to another joiner can resolve once
     that joiner is placed. HIGH goes to `newJoiners` (tiers through `canon`, the HR email). Leftovers go to
     `newJoinersLow`. Out-of-scope roles such as Executive / Manager (the loan team's shapes) are silently ignored, not
     reported (F-8).
   - **Manager_Directory:**
     - `finalRows` = the tab with fixes applied, plus joiners.
     - The manager set is computed from it.
     - Each directory row whose name is in HR with an email: a blank cell becomes `emailFills`; a different email
       becomes `emailChanges` (reported, never overwritten).
     - Each manager in `finalRows` who is in HR but not in the directory becomes `directoryAdds`.
     - Existing rows' roles, regions and counts are never refreshed (F-16).
5. **Mode.** `applyOn` = the property is 'true' and not test mode. `held` = joiners + fixes > 25. Mode is REPORT-ONLY,
   HELD or APPLIED. Writes happen only when APPLIED and there is something to write (`applyRmHierarchySyncPlanGs_`: Drive
   backup of both tabs first, then guarded cell writes, appends, and a read-back).
6. **Attention de-duplication.** Each attention item's hashed id is checked against the stored `state.items`: unseen ids
   are `newAttention`, seen ids are `outstanding`. The next state keeps only tonight's ids. A **Monday reminder** repeats
   all outstanding items (aliases included, F-19) once per Monday (`lastReminderDay`).
7. **Report.** Sent only when there is something to say: apply problems, held, any change, a fill or add, new attention,
   reminders, or warnings. It goes to the 3 named people with `GmailApp.sendEmail` inside `withRetry_` (F-7). Apply
   problems also raise an ops alert.
8. **State.** Unless in test mode: `items`, `lastReminderDay`, and `appliedEver` (true once an APPLIED night actually
   wrote something). It is written **after** the report send, so a send failure loses the state update (F-3).
9. **Failure path.** Any throw sends an ops alert ("RM_Hierarchy was NOT changed") and re-throws, so Executions shows
   Failed and the run record says failed. The watchdog is meant to catch a night with no run at all, but structurally it
   almost cannot (F-2).
10. **Rebuild lock-out.** `rebuildRmHierarchy()` refuses while apply is on or `appliedEver` is true;
    `rebuildRmHierarchyForce()` overrides. **Not locked:** `ensureRmHierarchySheet_` re-seeding a missing tab from the
    raw table (F-11).
11. **Leavers.** Never removed. They are reported on first sight, then every Monday. Removal is a manual edit of the
    sheet.
12. **Old spellings.** Recognised (exactly one current near match), listed once under "OLD SPELLINGS", and repeated on
    Mondays. The row is kept as it is.
13. **Backups.** Two Drive folders under "Leads Dashboard Archive", no manifest line, an identical file is reused, one per
    applied night.

### 3.3 The weekly ops checklist (Monday about 09:00 IST)

`runWeeklyOpsChecklistNow` → `buildWeeklyOpsChecklistSummary_` runs the five checks in order:
1. Unresolved RM names on open Google Non-UTM/Search leads in the current month's tab.
2. Managers with reports but no address.
3. Movement_Log freshness.
4. Workbook cell budget (warning and critical percentages).
5. Dashboard tabs unused for 30 days or more (Feature_Usage).

It then appends the manual reminder for `reportRmPerformanceNow()` and the RM_PERF constant-parity check. One plain-text
email goes to the ops address with the issue count in the subject, every week. Nothing is written, except that check 1
can create the RM_Hierarchy / Manager_Directory tabs if they are missing (through `loadRmHierarchyAndEmails_`).

---

## 4. Findings

**F-1 — MED — `EmailInfra.gs:1181` (with `RmHierarchy.gs:1332-1344`). The P&L-head Cc defeats the loan-team "no Cc"
and Pre Sales "Cc only one person" overrides.** `resolveRecipientBucketsForRms_` hard-sets the Cc for the loan City Lead's
bucket to empty, and for the two restricted Pre Sales primaries to one address. `resolveRecipientEmailsForRegion_` then
calls `withRegionPnlHeadCcGs_(pnlHeadEmail, …)` on **every** bucket. Scenario: a Pre Sales S1 under one of the restricted
A1s holds a Google lead whose region is Thane, Navi Mumbai, Hyderabad or Bangalore. That A1's email goes out with Cc =
the one allowed person **plus that region's P&L head**, which contradicts §4.3.3 ("must cc ONLY…"; the loan team
"with no cc at all"). The loan part matters only if loan-team RMs hold leads in those four regions (loan leads may
mostly be region 'Loan', which has no P&L entry). Also, `mergeBucketsByAddressGs_` can union a restricted bucket's Cc
with another bucket that has the same To address. No test covers the combination (grep found none). Confidence:
CONFIRMED in code; real-world impact SUSPECTED (depends on which regions Pre Sales leads carry).

**F-2 — MED — `EmailInfra.gs:838` + `926-931` + `1019`. The watchdog almost never detects a nightly sync that did not
run or died.** The sync's deadline is 23:15 + 30 min = 23:45 IST. `emailJobProblemsGs_` compares against *today's* IST
day, and the watchdog trigger is `everyHours(1)` with a minute that is not pinned. A missed run is only flagged if the
hourly trigger happens to fire between 23:45 and 23:59. After midnight, `minutesIntoDay` resets and the job is "not due
yet" for the new day, until 23:45 again. A "stuck" run (more than 35 min after a ~23:15 start) can likewise only be seen
between about 23:50 and 23:59. So in roughly three nights out of four (whenever the hourly trigger's minute falls outside
:45-:59), a deleted trigger or a platform-killed sync goes unreported indefinitely. HANDOVER §4.3.4 ("the hourly
watchdog also flags a night it did not run") overstates the coverage. A crash that throws is still alerted by the
sync's own catch; a kill or a missing trigger is not. Confidence: CONFIRMED (logic).

**F-3 — MED — `RmHierarchySync.gs:621-653, 668-674`. A failure after the writes is reported as "RM_Hierarchy was NOT
changed", and the applied-changes report and state are lost.** The writes happen in `applyRmHierarchySyncPlanGs_`
(L622). Then `GmailApp.sendEmail` (L645), `notifyOpsAlertGs_` and `writeRmSyncStateGs_` follow. If the report send
throws (quota, a Gmail error after retries) or a later `withRetry_` write inside apply exhausts its retries part-way, the
catch at L668 tells ops "The nightly RM hierarchy sync stopped **before changing anything**", which is false. The next
night the applied fixes and joiners are no longer in the plan (already applied), so nobody is ever emailed what changed;
only the per-row Note text and the Drive backup remain. `appliedEver` is not saved on such a night either; the rebuild
lock-out still holds through the apply property, but if apply is later switched off, `rebuildRmHierarchy()` becomes
allowed and silently undoes those writes. Confidence: CONFIRMED.

**F-4 — MED — `RmHierarchySync.gs:261`. A tier that is blank in the tab but filled in HR is never detected.**
`if (!value || chainKeys.indexOf(...) !== -1) return;` only checks fields that already hold a value. Scenario: the four
Bangalore S1s whose `tl` was cleared after their A1 left (raw L188, 260, 265, 330), or the 2026-09-29 joiners with only
`ch` (L440-443). When HR later lists a new A1 for them, the sync stays silent forever, and their leads keep routing to
the Cluster Head instead of the new A1. This is the "routing to the wrong tier" drift class the sync was built to end.
Confidence: CONFIRMED.

**F-5 — MED — `RmHierarchySync.gs:249-255`. Alias rows are never refreshed and drift away from the real person's
chain.** A row not found in HR by exact name returns early (alias or leaver), so its tl/tm/rh/ch are never compared or
fixed. When the sync auto-fixes the real person's row (e.g. the real Hyderabad S1 or the Pune S1 whose alias spellings
exist at raw L416-417), the alias row keeps the old manager. Leads carrying the leads-sheet spelling then route to the
old (possibly departed) manager, while the dashboard shows the new one. Confidence: CONFIRMED (logic); the impact needs a
real manager change for an aliased person.

**F-6 — MED — `RmHierarchySync.gs:246-271`. Hand-made rows cannot opt out of auto-fixes except through Excluded, and
Excluded also stops routing.** The bespoke rows are the Pre Sales team (rh = a City Lead who is not their HR chain), the
loan A1 and City Lead overrides, the Sourcing - Pune TM, the Cluster Head `ch` overrides (e.g. Navi Mumbai / Thane
Cluster Heads under a 'Leadership' person), and the Central TM sitting in `tl`. All of them are auto-rewritten whenever
the HR chain holds exactly one name whose tab role maps to that field. The plan doc says "all `ch` overrides, aliases:
report only", and the test message says "a deliberate CH override … is flagged, never overwritten"
(`Tests_RmHierarchySync.gs:186`). The code only guarantees that when the HR chain has more than one name. Note
(parity): `test/refresh-rm-hierarchy.py:386-396` applies the same rule to `ch`, so HANDOVER's wording ("a stale
TL/TM/RH/CH … exactly one name") is accurate and the plan doc and test message are not. Scenario: if HR lists a Pre Sales
A1's sole manager as someone whose tab role is RH, the A1's `rh` changes from the bespoke City Lead to that RH. Their own
leads then route to that RH with leadership Cc. Confidence: SUSPECTED (depends on HR data); the missing "pin row"
mechanism is CONFIRMED.

**F-7 — LOW — `RmHierarchySync.gs:645`. The report send uses `withRetry_` and bypasses the outgoing-email gate.**
`withRetry_` retries on "timed out" / "server error", which `EmailInfra.gs:547-558` says must not wrap a send (it can
duplicate). The send also skips `sendGuardedEmailGs_` (address validation). Worst case: a duplicate nightly report.
Confidence: CONFIRMED.

**F-8 — LOW — `RmHierarchySync.gs:56, 286-289`. New loan-team or other non-sales-role joiners are silently ignored,
not reported.** The loan team's rows use roles 'Executive' and 'Manager', which are not in `RMSYNC_SALES_ROLES_`, so a
new loan Executive in HR goes to neither `newJoiners` nor `newJoinersLow`. Once leads are assigned to them they surface
only via `auditUnresolvedRms_` (weekly) or a region-fallback email. Matches the Python scope, but the report never says
so. Confidence: CONFIRMED.

**F-9 — LOW — `RmHierarchy.gs:937` (also the 'Not automated' guidance and `OPS_CHECKLIST.md` references). The repair
advice is stale once the sync is active.** `auditUnresolvedRmsNow` says "add a name-variant alias row to
RM_HIERARCHY_RAW_ … and run rebuildRmHierarchy()". With the sync applying, rebuild refuses; the forced rebuild would wipe
synced rows. The right instruction is to add the alias row directly in the live tab. Confidence: CONFIRMED (whenever
apply is on or `appliedEver` is true).

**F-10 — LOW — `RmHierarchy.gs:129-131`, `HANDOVER.md` §4.3 table row `setupRmHierarchy()`. Docs say re-running
`setupRmHierarchy()` refreshes / rebuilds the tabs; it does not.** `setupRmHierarchy` (L1357) only calls the
`ensure*` functions, which return early when the tabs exist. HANDOVER also says `rebuildRmHierarchy()` is "the function
this calls under the hood when re-run", which is false. Header L19 ("there's no live sync") and L125-128 ("a blank Email
column") are also stale. Confidence: CONFIRMED.

**F-11 — LOW — `RmHierarchy.gs:549-551, 636-651, 1017-1019`. A missing tab is silently re-seeded from the raw table on
any routing read, even with the sync active, and the rebuild is not atomic and takes no lock.** `loadRmHierarchyAndEmails_`
→ `ensureRmHierarchySheet_` recreates `RM_Hierarchy` from `RM_HIERARCHY_RAW_` (and `Manager_Directory` likewise) if it
is missing. Possible triggers: a forced rebuild that failed between `deleteSheet` and `insertSheet`, an accidental
delete, or a 17:00 job, the weekly checklist or the bounce re-route reading while a rebuild is mid-way. Every synced
joiner and fix disappears with no message, and the lock-out does not apply. A concurrent reader can also make the
rebuild's own `insertSheet` fail ("already exists") because no lock is taken. Confidence: CONFIRMED (code path);
unlikely in practice.

**F-12 — LOW — `OpsChecklistRunner.gs:222-224`. A missing Feature_Usage tab is never flagged after the grace period.**
When the status is 'missing', the caller prints "nothing to report until someone signs in" and ignores
`componentUsage.stale`, even though `checkStaleComponents_` has already promoted every id to stale after 30 days. If the
dashboard's usage tracking is broken so the tab is never created (or it is deleted), the weekly email keeps saying "not
found yet" with 0 issues indefinitely. Confidence: CONFIRMED.

**F-13 — LOW — `RmHierarchy.gs:1028, 1043, 1223, 1307, 1324`. Routing name keys are only trimmed and lower-cased, not
whitespace-normalised.** `normPersonName_` (whitespace collapse, trailing '.') exists but routing does not use it. A
leads-sheet RM value or a Manager_Directory / tab name with a double space or a trailing period fails to resolve. It then
falls to the region fallback or CH backstop, and the bucket shows as "unmatched" even though a row exists. The sync uses
`normPersonName_`, so the sync and routing can disagree about whether two names are the same person. Confidence:
CONFIRMED (code); frequency unknown.

**F-14 — LOW — `RmHierarchy.gs:912-913`. The `inCompanyRoster` hint is an exact, case-sensitive comparison.**
`r[0] === name`, unlike `lookupEmployeeEmail_` (normalised). A current employee whose leads-sheet spelling differs only in
case or spacing is labelled "likely departed". It only affects the audit's hint text. Confidence: CONFIRMED.

**F-15 — LOW — `RmHierarchy.gs:624`. An auto-generated note becomes permanent.** `note = prior && prior.note ? prior.note
: p.note`. Once the "No manager on file for this person." note is written, every later rebuild treats it as human text
and keeps it after the person gains a chain. Cosmetic: the note is not used for routing. Confidence: CONFIRMED.

**F-16 — LOW — `RmHierarchySync.gs:336-348`, `RmHierarchy.gs:805`. Manager_Directory's roles, regions and
`people_reporting_up_to_them` are never refreshed while the sync is active.** The sync only fills blank emails and
appends new managers, and the full rebuild is locked out. A manager whose reports all move away still shows a positive
count, so `auditManagerDirectoryEmailGaps_` keeps flagging them if their email is blank. A manager who gains reports
through a fix keeps the old roles and regions. Mostly informational drift. Confidence: CONFIRMED.

**F-17 — LOW — `OpsChecklistRunner.gs:79, 94`. Dates are built in script-local time, not explicitly in IST.**
`new Date(2026, 9, 3)` and the parsed Feature_Usage timestamps use the Apps Script project time zone (or UTC in CI),
against the CLAUDE.md rule "everything pinned to IST explicitly". The effect is at most 5.5 hours on a 30-day threshold.
Confidence: CONFIRMED; impact negligible.

**F-18 — LOW — `OpsChecklistRunner.gs:154-243, 270-271`. One failing check suppresses the whole weekly email.** No check
has its own try/catch. If `auditUnresolvedRms_` throws (e.g. the month tab is missing on the 1st, or a non-transient read
error), `computeWorkbookCellUsageGs_` throws, or similar, nothing is sent, and the job is not in the watchdog schedule.
By the file's own design the missing email is the alarm, but it then hides the four checks that would have passed (or
failed) independently. Confidence: CONFIRMED.

**F-19 — LOW — `RmHierarchySync.gs:630-636`. Old-spelling (alias) items are repeated in every Monday reminder.**
`outstanding` includes alias items, so recognised old spellings are re-listed each Monday under "still open", and a
Monday with only aliases outstanding sends an email just for them. The plan doc says alias rows are "listed once and
then ignored", and the report itself calls them "nothing to do". Confidence: CONFIRMED.

**F-20 — LOW — `RmHierarchy.gs:1285-1300` with raw L419 (and L405). Two top-of-org rows can never reach the CH-level
report.** The self path needs the person's own name in `Manager_Directory`. The alias row "Sourabh Sareen Pnl" (City
Lead, blank chain) is nobody's manager, so its leads go to `unresolved` and then the region fallback / CH backstop, not
the CH-level report its real counterpart gets. The 'Leadership' role (raw L405) is not top-of-org, so that person's own
leads always end up `unresolved` (the comment at L401-404 accepts this). Confidence: CONFIRMED.

**F-21 — INFO — `RmHierarchySync.gs:334-341`. Emails filled by the sync come from the HR sheet, not the private
table.** The private table holds at least one address documented (in its own comment) as correcting a wrong HR-export
address. When a manager's Manager_Directory cell is blank, the sync writes the HR sheet's address, while
`lookupEmployeeEmail_` would have given the corrected one. Low likelihood (only blank cells are filled). Confidence:
SUSPECTED.

**F-22 — INFO — stale comments in `RmHierarchy.gs`:**
- L164-169 refers to the "TM_STILL_CC_ docblock above" (it is below, at L1195).
- L172-182 describes Vivek Yadav "(below)" (row removed 2026-09-30, see L451-456).
- L423 "same person as 'Nikhil Goud'" is an orphaned comment (that row was removed) and sits on top of the Mamtaben
  alias comment.
- L1095 says the restricted A1s' rh/ch are "both blank" (their rh is set; same outcome because the Cc is replaced).
- L1014 says the function is used by OvernightEmailer only (AllIssues and EmailReroute use it too).
- L422 calls Kavya Gowda "confirmed by the user — same person as Kavya B R", while L457-460 calls her an open,
  never-matched question.

Also outside these three files: `EmailInfra.gs:1127-1128` still describes `chLevelRms` as "RMs whose chain resolves all
the way to a real CH", which is the pre-correction meaning (now it only covers a top-of-org person holding a lead
themselves).

**F-23 — INFO — `RmHierarchySync.gs:615, 621`. The 25-change cap counts only joiners and fixes.** Manager_Directory email
fills and adds are not counted against `RMSYNC_MAX_CHANGES_`. They are still not written on a HELD night (the apply is
skipped as a whole). This matches the plan's wording ("field changes"). Noted for clarity. Confidence: CONFIRMED.

**F-24 — INFO — `RmHierarchy.gs:1270` vs managers. Excluded only stops routing for the excluded person's own leads.** An
Excluded row that is someone else's tl/tm/rh/ch still receives their reports' emails. The header (L118-120: "a row that
shouldn't route") can be read as broader than this. Confidence: CONFIRMED (intended behaviour, unclear docs).

---

## 5. Open questions

1. Is the sync's apply currently ON in the live project (`RM_HIERARCHY_SYNC_APPLY`), and has it ever applied
   (`appliedEver`)? That decides whether F-3, F-5, F-6, F-9 and F-11 are live risks or future ones.
2. F-1: should the P&L head be excluded from the loan-team and restricted Pre Sales buckets, or is the P&L Cc a
   deliberate exception that §4.3.3 did not anticipate? Which regions do Pre Sales / loan-team leads actually carry?
3. Restricted Cc scope: the override is keyed on the **bucket primary** (the two A1s). A lead held by one of those A1s
   *themselves* routes to the Pre Sales City Lead (their `rh`), whose bucket gets the normal leadership Cc. Is that
   intended, or should the restriction also cover the A1s' own leads?
4. Are the Pre Sales team members and the loan Executives in the HR roster sheet at all? If they are not, they are
   permanent "possible leavers" every Monday. If they are, F-6 auto-fixes may rewrite their bespoke chains.
5. Should the sync gain a "pinned / manual" marker (e.g. a note prefix) that exempts a row from auto-fixes without
   excluding it from routing (F-6), and a "blank tier now filled in HR" report category (F-4)?
6. Should the sync also update alias rows whenever their real person's row changes (F-5), e.g. by treating a recognised
   old spelling as a follower of the matched person's row?
7. F-2: should the sync's watchdog deadline move to a time the hourly check reliably sees (e.g. report the previous
   night's missing run in the morning), or should the hourly trigger be complemented by a check at a pinned minute?
