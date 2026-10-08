# GS-014 — RmHierarchySync.gs

| | |
|---|---|
| **Type** | `GS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `RmHierarchySync.gs` |
| **Owner** | Snehil |
| **Component Status** | Active (report-only until `enableRmHierarchySyncApplyNow` is run) |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-10-08 against commit `3dc9852` - old spellings of current staff are recognised instead of listed as leavers (`FN-377`, `RULE-042`; see `## Version / change reference`) |

## Purpose / reason to exist

Keeps `RM_Hierarchy` (`SHEET-006`) and `Manager_Directory` (`SHEET-007`) in step with the company HR roster sheet
(`16l-0STI31eL4oly0u1jVVHujzqNASmH5K8l83ahstJQ`, first tab) **every night, unattended**. Until 2026-10-08 the only way was
the manual routine: export "HR Live", run `test/refresh-rm-hierarchy.py`, paste `RmHierarchy.gs`, run `rebuildRmHierarchy()`. That
routine lapsed twice (Zoya Fathima missing for ~13 days; three reports routed to a manager who had left 3 months earlier), and a
manager change reaches the emails only when someone remembers to run it. The sync does the unambiguous part of that routine
itself and emails a report of the rest. Design and decisions: `docs/_planning/RM_HIERARCHY_NIGHTLY_SYNC.md`.

## Responsibilities

- Read the HR sheet by id (the script owner's account needs link access), check its header cells at fixed positions
  (`parseHrRosterGs_`), and stop if the layout changed or fewer than 250 people are listed.
- Compare it with the live tab and decide (`computeRmHierarchySyncPlanGs_`, pure): new joiners, stale manager fields, possible
  leavers, manager emails.
- Apply only what is unambiguous, only when `RM_HIERARCHY_SYNC_APPLY` is `true`, never more than 25 changes a night, after a Drive
  backup (`applyRmHierarchySyncPlanGs_`); read every change back.
- Email the report (`buildRmHierarchySyncReportGs_`) to Snehil Chhimwal, Sushil Kannojiya and Ashish Ivlekar - new items once, the
  open ones again on Mondays.
- Recognise an RM_Hierarchy name that is not in the HR sheet but is an old spelling of exactly ONE current person (a dropped middle name, an initial, a label like "Pnl" or "S 1 Account", a spelling slip) and list it once, in its own section, instead of as a possible leaver.
- **Never** removes a person, never overwrites a hand-written email, never writes a field it is not sure of.

## Trigger schedule

`setupRmHierarchySync()` installs ONE trigger for `syncRmHierarchyNightly`: `atHour(23).nearMinute(15).everyDays(1)` in
`Asia/Kolkata`. The run goes through `withEmailJobLockGs_` (`GS-004`), so it takes the script lock and leaves a run record, and
`emailJobScheduleGs_` (`GS-004`) lists it so the hourly watchdog alerts when it did not run by 23:30.

## Requires `setupXxx()` re-run when

Only when the run time changes (`RMSYNC_RUN_HOUR_` / `RMSYNC_RUN_MINUTE_`): run `setupRmHierarchySync()` again. First install:
paste the file, run `setupRmHierarchySync()` once, then `syncRmHierarchyNightlyNow()` for a report-only report.

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-367 | `parseHrRosterGs_(values)` `#L146` | the HR sheet's rows | `{problems, people, count}`; people keyed by normalised name with role, team, email (`@` only), current chain names, exited flag | none (pure) | `normPersonName_` (`GS-011`) | FN-373, FN-375 | specific |
| FN-368 | `classifyRmSyncJoinerGs_(person, roleByKey)` `#L218` | a person, name -> role | `{confidence, fields, notes}`; HIGH only when every chain name resolves, by that name's own role, to a distinct tier | none (pure) | — | FN-369 | specific - the rule `test/refresh-rm-hierarchy.py` `classify_new_joiner` uses |
| FN-369 | `computeRmHierarchySyncPlanGs_(hr, rows, directory)` `#L236` | parsed HR sheet, tab rows, directory rows | `{newJoiners, newJoinersLow, fixes, needsHuman, leavers, emailFills, emailChanges, directoryAdds}` | none (pure) | FN-368 | FN-373, FN-375 | specific - RULE-038..RULE-041 |
| FN-370 | `applyRmHierarchySyncPlanGs_(ss, sheet, rows, directorySheet, directory, plan, day)` `#L507` | the plan and the live tabs | `{problems, backupUrls}` | Drive backup CSVs of both tabs; cell writes (re-checked just before each), appended rows + checkboxes, directory emails/rows; read-back | `archiveRowsToDriveCsv_` (`GS-002`), `withRetry_` (`GS-004`) | FN-373 | specific |
| FN-371 | `rmSyncAttentionItemsGs_(plan)` / `rmSyncChangeLinesGs_(plan)` `#L402/#L422` | the plan | report lines; attention items with a stable id | none | — | FN-373, FN-374 | specific |
| FN-372 | `buildRmHierarchySyncReportGs_(info)` / `rmSyncRecipientsGs_(hr)` `#L437/#L488` | run facts / the HR sheet | `{subject, body}` / the recipient addresses | none (recipients read the private table by name, then the HR row) | `resolvedEmailForNameGs_`, `opsAlertEmailGs_` (`GS-004`) | FN-373 | specific |
| FN-373 | `runRmHierarchySyncGs_(opts)` `#L592` | `{now}` | the run summary | reads the HR sheet and both tabs; may write them (apply on); emails the report; saves state | all of the above | FN-374 | specific |
| FN-374 | `syncRmHierarchyNightly()` / `syncRmHierarchyNightlyNow()` `#L663/#L678` | — | — | the lock + run record; alerts ops and re-throws on a crash | `withEmailJobLockGs_`, `notifyOpsAlertGs_` (`GS-004`) | the trigger / Apps Script editor | specific |
| FN-375 | `setupRmHierarchySync()`, `enable/disableRmHierarchySyncApplyNow()`, `showRmHierarchySyncPlanNow()`, `showRmHierarchySyncStatusNow()` `#L681/#L695/#L699/#L64/#L81` | — | — | trigger install; Script Property switch; read-only logs | FN-367, FN-369 | Apps Script editor (manual) | specific |
| FN-377 | `rmSyncNameTokensGs_`, `rmSyncEditDistanceGs_`, `rmSyncTokenCloseGs_`, `rmSyncNearNameGs_(rowName, person)` `#L97/#L128` | a name; an HR person | `true` when the name is an old spelling of that person | none (pure) | — | FN-369 | specific - RULE-042 |
| FN-376 | `rmHierarchySyncIsActiveGs_()` `#L388` | — | `true` when apply is on or the sync has ever applied | none | — | `rebuildRmHierarchy` (`GS-011`) | specific |

## Business rules implemented — `RULE-XXX` sub-table

| ID | Rule | Where | Duplicated elsewhere? |
|---|---|---|---|
| RULE-038 | A stale `tl`/`tm`/`rh`/`ch` is auto-fixed only when the person's current HR chain holds exactly ONE name and that name's role maps to that field; otherwise it is reported (with a suggestion when the whole chain resolves) | FN-369 | the Python `test/refresh-rm-hierarchy.py` (Section 3) - same rule, kept in step by hand |
| RULE-039 | A new person is added only when every current-chain name resolves to a distinct tier (HIGH); sales-track roles only; Magnet teams and exited people never | FN-368, FN-369 | `test/refresh-rm-hierarchy.py` `classify_new_joiner`, `SALES_TRACK_ROLES`, `OUT_OF_SCOPE_TEAMS`, `ROLE_TO_FIELD` |
| RULE-040 | A person missing from the HR sheet or with an Exit date is only reported, never removed; reported on first sight, then every Monday while open | FN-369, FN-373 | — |
| RULE-041 | A `Manager_Directory` email is filled only when blank; a different HR email is reported; a row is added only for a manager who is in the HR sheet | FN-369 | — |
| RULE-042 | A row not in the HR sheet by exact name is an OLD SPELLING (not a leaver) only when exactly one current (not exited) HR person is a near match: same words ignoring initials, numbers and "Pnl"/"Account"; or one name's words are all in the other's (a dropped middle name, at least two shared words, at most two extra); or the same number of words each within a small edit distance (1 for 5-6 letters, 2 for 7+; a swap of neighbours counts once); or a label ending "Account" whose single remaining word is another person's first name. Zero, several or only-exited matches stay possible leavers, with the similar HR names listed | FN-377, FN-369 | — |

## Config constants — `CFG-XXX` sub-table

| ID | Constant | Value | Meaning | Changing it affects |
|---|---|---|---|---|
| CFG-100 | `RMSYNC_HR_SHEET_ID_`, `RMSYNC_RUN_HOUR_`/`MINUTE_` | the HR sheet id, `23` / `15` | where the roster is and when the job runs | which sheet is read; the trigger (re-run `setupRmHierarchySync`) and the watchdog's deadline |
| CFG-101 | `RMSYNC_MIN_PEOPLE_`, `RMSYNC_MAX_CHANGES_` | `250`, `25` | a smaller roster is a broken read; more changes than this in a night are held | the two safety gates |
| CFG-102 | `RMSYNC_HR_COL_*`, `RMSYNC_HR_CHAIN_COLS_`, `RMSYNC_HR_HEADER_EXPECT_` | name 1, role 2, team 15, exit 17, mail 35, chain 6/8/10/12 | the HR layout (0-indexed) and the header labels checked there | a change in the HR sheet's columns stops the run until these are updated |
| CFG-103 | `RMSYNC_APPLY_PROPERTY_`, `RMSYNC_STATE_PROPERTY_` | `RM_HIERARCHY_SYNC_APPLY`, `RM_HIERARCHY_SYNC_STATE` | the apply switch (`true` = write) and the "already told you" memory | report-only vs apply; which items are new tonight |
| CFG-104 | `RMSYNC_REPORT_NAMES_` | Snehil Chhimwal, Sushil Kannojiya, Ashish Ivlekar | who gets the report (addresses resolved by name; the repository is public) | the report recipients |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-115 | the HR sheet cannot be opened, its layout changed, or it lists fewer than 250 people | the run throws before changing anything; the job wrapper alerts ops and re-throws | an ops alert; Executions shows Failed; routing keeps using the tab as it was |
| EXC-116 | more than 25 changes would be written in one night | nothing is written; the report is headed HELD with the full list | a report to the three recipients |
| EXC-117 | a cell or email was edited by a person after the sync read it | that single change is skipped and listed under "problems while applying" | the person's edit survives; ops is alerted |
| EXC-118 | the Drive backup fails | the apply step throws before any write (no backup, no write) | an ops alert |

## Data lineage

HR roster sheet (first tab, read only) -> FN-367 -> FN-369 (with `RM_Hierarchy` `SHEET-006` and `Manager_Directory` `SHEET-007`)
-> optional writes to those two tabs (Drive backups first) -> email report. State (what was already reported) lives in the Script
Property `RM_HIERARCHY_SYNC_STATE`; the run record is the same one the email jobs use.

## Sheets touched

| `SHEET-XXX` | Read / Write | Which `FN-XXX` | Notes |
|---|---|---|---|
| `SHEET-006` `RM_Hierarchy` | Read always; write only with apply on | FN-370, FN-373 | fixes a manager cell and appends a note; appends new people with the Excluded checkbox; never deletes |
| `SHEET-007` `Manager_Directory` | Read always; write only with apply on | FN-370 | fills blank emails, appends missing managers |
| the HR roster sheet | Read | FN-373 | outside this workbook; first tab only |

## Failure / error behaviour

A structural problem throws (after the run record says `running`), so Executions shows Failed, the record says `failed`, ops is
alerted by the wrapper and the hourly watchdog; nothing was written. Per-change problems while applying are reported, not thrown.

## Cross-runtime duplication

With `test/refresh-rm-hierarchy.py` (RULE-038, RULE-039): the Python tool stays for the HR-export-by-hand path and for
`RM_HIERARCHY_RAW_`; the two are not machine-compared (they differ in what they write).

## Not live until pasted

Not running until pasted into the Sheet's Apps Script editor together with its `Tests_` file, **`EmailInfra.gs`** (watchdog
schedule) and **`RmHierarchy.gs`** (rebuild guard); then run `setupRmHierarchySync()`. Registrations: `Tests_RunAll.gs` `suites`,
`test/run-gs-tests.js` lists, the live editor.

## UI relationships

N/A - backend.

## Architecture relationship

Apps Script backend; a time-driven job (23:15 IST) sharing the email jobs' lock, run record and watchdog.

## Related documentation

`docs/_planning/RM_HIERARCHY_NIGHTLY_SYNC.md`; `HANDOVER.md` (RM hierarchy section and the rebuild warning); `OPS_CHECKLIST.md`
(the nightly report); `test/refresh-rm-hierarchy.py`.

## Relationships

- **Depends On:** `GS-002` (`Core.gs`), `GS-004` (`EmailInfra.gs`), `GS-011` (`RmHierarchy.gs`), `SHEET-006`, `SHEET-007`
- **Used By:** `GS-004` (the watchdog schedule), `GS-011` (the rebuild guard)
- **Related:** `test/refresh-rm-hierarchy.py`, `check-rm-hierarchy-drift.py`

## Source of truth

`RmHierarchySync.gs` at `HEAD`.

## Validation

- **Method:** `Tests_RmHierarchySync.gs` (in-memory HR sheet, tabs, Drive, Gmail, properties, triggers) in CI and the headless
  runner; deliberate regressions (SM1..SM24, `docs/_planning/EMAIL_AUDIT.md`-style) each caught; first live run is report-only.
- **Evidence:** `.github/workflows/test.yml`; the first report-only email.
- **Status:** Validated 2026-10-08 (locally); live behaviour proven by the first report-only run.

## Version / change reference

**2026-10-08** (`d897529`, reordered `70f21c4`): file created - nightly HR-roster sync, report-only by default; `EmailInfra.gs`
`emailJobScheduleGs_` watches it; `RmHierarchy.gs` `rebuildRmHierarchy` refuses to run once the sync is applying (use
`rebuildRmHierarchyForce`). **Not live until pasted.**

**2026-10-08** (`3dc9852`): the first report listed 19 possible leavers, 9 of them old spellings of people still in the HR sheet (Peddapally Shivaji, Atharva P Belose, Akash Ugale, Kavya Gowda, Sourabh Sareen Pnl, Jay Renavikar, Mamtaben S 1 Account and two Mohmmad Azaz spellings). `computeRmHierarchySyncPlanGs_` now recognises such a row (FN-377, RULE-042) and the report lists it once under "OLD SPELLINGS OF CURRENT STAFF" with the matched person and employee code; it is not counted as work in the subject. Report lines also carry the HR employee code (column A) for new people and manager-field items. **Not live until pasted.**

## Revalidation trigger

Any commit touching `RmHierarchySync.gs` or its `Tests_` file; a change to the HR sheet's columns; `RM_Hierarchy` / `Manager_Directory`
columns; `test/refresh-rm-hierarchy.py`'s rules; `emailJobScheduleGs_`.

## Handover relationship

`HANDOVER.md` RM hierarchy section updated in the same commit: the live tab is the source of truth once apply is on.

## Lifecycle / retention

N/A (the Drive backups `RM_Hierarchy_sync_backup` / `Manager_Directory_sync_backup` are kept; same-day identical reruns reuse the file).

## Next action

Review 2-3 report-only reports, then run `enableRmHierarchySyncApplyNow()`.

## Closure evidence

Record created with the feature; `docs/INDEX.md` `GS-014`.
