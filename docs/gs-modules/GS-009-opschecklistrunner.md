# GS-009 — OpsChecklistRunner.gs

| | |
|---|---|
| **Type** | `GS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `OpsChecklistRunner.gs` (153 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-10-03 against commit `a325f00` |

## Purpose / reason to exist

A weekly (Monday ~09:00 IST) automated summary email that runs 5 of
`OPS_CHECKLIST.md`'s periodic checks an unattended script *can* judge —
RM-hierarchy resolution gaps, `Manager_Directory` email gaps,
`Movement_Log` capture freshness, the workbook's shared 10M-cell budget
(added 2026-09-28), and (added 2026-10-03, Part 4 of the dead-code-audit
follow-up, `docs/_planning/DEAD_CODE_AUDIT_2026-10-03.md`) a 30-day
stale-dashboard-tab check against `Feature_Usage` (`SHEET-018`, written
by Part 3's client-side usage tracking, `JS-018`) — and reduces each to
a pass/fail. It sends **every week, issues or not**, on purpose: an
absent email would be ambiguous ("did it not run, or was everything
fine?"). Added 2026-09-09. It exists to catch this project's slow-drift
failure class (from `OPS_CHECKLIST.md`) *before* it becomes one of
`HANDOVER.md` §8's incidents.

## Responsibilities

- `buildWeeklyOpsChecklistSummary_(ss, now)` — run the 5 checks, build
  the pass/fail summary.
- `checkStaleComponents_(ss, now)` / `parseFeatureUsageTimestampGs_(cell)`
  (added 2026-10-03) — read `Feature_Usage` (`SHEET-018`), bucket every
  tracked dashboard tab into stale / neverObserved / recent.
- `runWeeklyOpsChecklist_(ss, now)` — the testable core: build the
  summary and send the email.
- `runWeeklyOpsChecklistNow()` — the thin production wrapper (real
  `SpreadsheetApp` + `new Date()`).
- `setupWeeklyOpsChecklistTrigger()` — install the Monday trigger.

## Trigger schedule

`setupWeeklyOpsChecklistTrigger()` (`#L141`) installs
`runWeeklyOpsChecklistNow` on
`.onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9).nearMinute(0).inTimezone('Asia/Kolkata')`
— "runs every Monday near 09:00 IST." This is **not** in `LOGIC_AUDIT.md`
Part 1 §5's trigger table (the file was added 2026-09-09, after the
2026-09-07 audit).

## Requires `setupXxx()` re-run when

Only when the **schedule** changes (day/hour). A change to which checks
run, or their thresholds, takes effect on the next Monday fire
automatically.

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-227 | `runWeeklyOpsChecklist_(ss, now)` `#L270` | an injected spreadsheet + a fixed `now` | builds the summary and sends one email | Gmail send | `buildWeeklyOpsChecklistSummary_` (FN-228), `withSendRetry_` (`GS-004`) | `runWeeklyOpsChecklistNow` (FN-229), `Tests_OpsChecklistRunner.gs` | reusable — **the testable core** (split out this session, `daba775`, so tests pass a fixed `now` instead of drifting `new Date()`) |
| FN-228 | `buildWeeklyOpsChecklistSummary_(ss, now)` `#L154` | spreadsheet + now | the 5-check pass/fail summary text | none (reads sheets) | `auditUnresolvedRms_` / `auditManagerDirectoryEmailGaps_` (`GS-011`), `checkMovementLogFreshness_` (`GS-008`), `computeWorkbookCellUsageGs_`/`fmtCellsGs_` (`GS-002` FN-301/302, added 2026-09-28), `checkStaleComponents_` (FN-322, added 2026-10-03) | FN-227 | reusable |
| FN-229 | `runWeeklyOpsChecklistNow()` `#L289` | — | thin wrapper: `runWeeklyOpsChecklist_(SpreadsheetApp.getActiveSpreadsheet(), new Date())` | Gmail send (via FN-227) | FN-227 | the Monday trigger; Apps Script editor (manual) | specific — the production entry point |
| FN-230 | `setupWeeklyOpsChecklistTrigger()` `#L300` | — | installs the Monday ~09:00 IST trigger (deleting any prior one for `runWeeklyOpsChecklistNow`) | creates a trigger | `ScriptApp` | Apps Script editor (manual) | specific |
| FN-322 | `checkStaleComponents_(ss, now)` / `parseFeatureUsageTimestampGs_(cell)` `#L107/#L89` (added 2026-10-03) | spreadsheet + now | `{status, stale, neverObserved, recent}` — every tracked tab bucketed | reads `Feature_Usage` (`SHEET-018`) | `withRetry_` (`GS-004`) | FN-228 | reusable — a never-observed tab is promoted into `stale` once `FEATURE_USAGE_TRACKING_STARTED_GS_` (`CFG-084`) is itself more than `STALE_COMPONENT_DAYS_GS_` (`CFG-083`) days in the past, see the function's own comment for why the two buckets are kept separate before that point |

## Significant config — `CFG-XXX` sub-table

| ID | Constant | Value | Meaning | Relationships |
|---|---|---|---|---|
| CFG-082 | `TRACKED_COMPONENT_IDS_GS_` `#L68` (added 2026-10-03) | the 9 real dashboard tab ids (`tab-morning` … `tab-oppmonitor`) | which components this checker judges | `checkStaleComponents_` (FN-322); **byte-for-byte mirror** of `js/sheets-writeback.js`'s `TRACKED_COMPONENT_IDS` — kept in sync by hand, parity-checked (`test/check-runtime-parity.py`) |
| CFG-083 | `STALE_COMPONENT_DAYS_GS_` `#L72` (added 2026-10-03) | `30` | the staleness threshold, in days, for both the "last used" case and the "never used, tracking has run this long" promotion | `checkStaleComponents_` (FN-322); no `.js` twin — the actual 30-day *judgment* only happens server-side (Part 4), the browser side (Part 3) only writes timestamps |
| CFG-084 | `FEATURE_USAGE_TRACKING_STARTED_GS_` `#L79` (added 2026-10-03) | `2026-10-03` (the date `Feature_Usage`, `SHEET-018`, started accumulating real rows) | the rollout-grace anchor — a tab with zero rows reads as "too early to tell" until this date is itself `STALE_COMPONENT_DAYS_GS_` days in the past | `checkStaleComponents_` (FN-322); this file's own header "ROLLOUT NOTE" has the full reasoning — a future reader must NOT read "9 tabs never used" right after shipping as the checker being broken |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-076 | `Movement_Log` capture drifted past `MOVEMENT_LOG_FRESHNESS_GRACE_HOURS_` (8h) | `checkMovementLogFreshness_` (`GS-008`) returns stale → that check reads FAIL | the Monday email flags a stale-capture problem |
| EXC-077 | a fixture / real-clock mismatch (the CI failure this session) | fixed by FN-227 taking `now` as a parameter — tests pass the fixed anchor, not `new Date()` (`daba775`) | CI is green; the production path still uses real `new Date()` |
| EXC-078 | a send fails | `withSendRetry_` (`GS-004`) retries; persistent failure raises | shows as Failed in Executions; the check summary is still logged |
| EXC-101 | the workbook's total declared cell usage crosses `WORKBOOK_CELL_ALERT_WARN_PCT_`/`WORKBOOK_CELL_ALERT_CRITICAL_PCT_` (`GS-002` CFG-071) — added 2026-09-28 after 3 real 10M-cell crashes (`HANDOVER.md` §9.2/9.3, 09-06/09-19/09-24) | `issueCount` incremented once (WARN and CRITICAL are mutually exclusive, never both); the summary names the top 3 tabs by cell count | the Monday email reads "Cell budget WARNING" or "CELL BUDGET CRITICAL" with the largest tabs named; CRITICAL also names `pruneMovementLogNow()`/`pruneDailyRmIssueLogNow()` as the immediate recovery |
| EXC-107 | `Feature_Usage` (`SHEET-018`) doesn't exist yet — added 2026-10-03 | `checkStaleComponents_` returns `status: 'missing'`; `buildWeeklyOpsChecklistSummary_` reports it as an informational line, **not** an issue (`issueCount` untouched) | the Monday email reads "Feature usage tracking: Feature_Usage sheet not found yet" — expected until someone signs into the dashboard at least once after Part 3 shipped |
| EXC-108 | a tracked tab has zero `Feature_Usage` rows, but `FEATURE_USAGE_TRACKING_STARTED_GS_` (`CFG-084`) is not yet `STALE_COMPONENT_DAYS_GS_` (`CFG-083`) days in the past — added 2026-10-03 | that tab is bucketed `neverObserved`, **not** `stale`; contributes 0 to `issueCount` | the Monday email names it in a separate, non-alarming "never recorded as used yet … expected for a while" line, distinct from the numbered "N tab(s) to review" section |

## Data lineage

`RM_Hierarchy` / `Manager_Directory` (`SHEET-006` / `SHEET-007`, via
`GS-011` audit functions) + `Movement_Log` freshness (`SHEET-002`, via
`GS-008` `checkMovementLogFreshness_`) + every tab's declared grid size
via `GS-002` `computeWorkbookCellUsageGs_` (added 2026-09-28; reads
`ss.getSheets()` — the whole workbook, not one named tab) + (added
2026-10-03) `Feature_Usage` (`SHEET-018`) via `checkStaleComponents_` →
`buildWeeklyOpsChecklistSummary_` → a pass/fail text → one weekly email
(`EXT-002`). Reads only; the only side effect is the send.

## Sheets touched

| `SHEET-XXX` | Read / Write | Which `FN-XXX` | Notes |
|---|---|---|---|
| `SHEET-006` `RM_Hierarchy` | Read | FN-228 (via `GS-011` `auditUnresolvedRms_`) | resolution-gap check |
| `SHEET-007` `Manager_Directory` | Read | FN-228 (via `GS-011` `auditManagerDirectoryEmailGaps_`) | email-gap check |
| `SHEET-002` `Movement_Log` | Read | FN-228 (via `GS-008` `checkMovementLogFreshness_`) | freshness check |
| every tab (whole workbook) | Read | FN-228 (via `GS-002` `computeWorkbookCellUsageGs_`, added 2026-09-28) | cell-budget check reads `getMaxRows()`/`getMaxColumns()` on every sheet, not one named tab |
| `SHEET-018` `Feature_Usage` | Read | FN-322 `checkStaleComponents_` (added 2026-10-03) | 30-day stale-component check; this file is that tab's first and only reader so far |

## Failure / error behaviour

Read-only apart from the send; a send failure retries then raises. The
core `runWeeklyOpsChecklist_` was split from the wrapper this session
specifically so a real-clock-vs-fixture mismatch stops failing CI
(EXC-077, `daba775`).

## Cross-runtime duplication

Mostly none — this is a backend-only monitoring script that reuses the
audit functions in `GS-011` and the freshness check in `GS-008` rather
than re-implementing them; `OPS_CHECKLIST.md` is the human checklist it
partially automates (not duplicated code — a different surface). The
one real exception, added 2026-10-03: `TRACKED_COMPONENT_IDS_GS_`
(`CFG-082`) is a byte-for-byte duplicated pair with `js/sheets-writeback.js`'s
`TRACKED_COMPONENT_IDS` — the browser side writes `Feature_Usage` rows
for exactly these 9 components, this side judges staleness against the
same 9. Parity-checked (`test/check-runtime-parity.py`); if a component
is ever added/removed on the browser side, update this list too, in the
same commit (both files' own header comments say so).

## Not live until pasted

Not running until pasted into the Sheet's Apps Script editor **and**
`setupWeeklyOpsChecklistTrigger()` run once. Per `CLAUDE.md`'s
three-registration rule for a new `.gs` file, it also needs adding to
`Tests_RunAll.gs`'s `suites` array and `test/run-gs-tests.js`'s file
lists (both done — this was the `CHECKLIST-006` incident's lesson).

## UI relationships

N/A — backend, email-only.

## Architecture relationship

Apps Script backend. A scheduled monitoring automation (layer 17
adjacent). Not covered by `LOGIC_AUDIT.md` (post-dates the audit).

## Related documentation

`HANDOVER.md` §2, §8; **`OPS_CHECKLIST.md`** (the checklist it partially
automates); `CLAUDE.md` (the three-registration rule, `CHECKLIST-006`);
`GS-008` / `GS-011` (the checks it reuses).

## Relationships

- **Depends On:** `GS-011` (`RmHierarchy.gs` — `auditUnresolvedRms_`,
  `auditManagerDirectoryEmailGaps_`), `GS-008` (`MovementTracker.gs` —
  `checkMovementLogFreshness_`), `GS-004` (`EmailInfra.gs` —
  `withSendRetry_`), `GS-002` (`Core.gs` — `computeWorkbookCellUsageGs_`/
  `fmtCellsGs_`, added 2026-09-28), `SHEET-002`, `SHEET-006`, `SHEET-007`,
  `SHEET-018` (added 2026-10-03), `EXT-002`
- **Used By:** `none` — leaf, scheduled
- **Related:** `OPS_CHECKLIST.md` (the human checklist), `GS-007`
  (`LeadFollowupsStaleness.gs` — the other 2026-09-09 addition)

## Source of truth

`OpsChecklistRunner.gs` at `HEAD`.

## Validation

- **Method:** full read at `c82ec67`; function list verified by grep;
  the Monday ~09:00 IST trigger read directly from
  `setupWeeklyOpsChecklistTrigger()` (`#L141`–`#L152`). The
  `runWeeklyOpsChecklist_(ss, now)` split + a smoke test for the wrapper
  were **added and verified this session** (`daba775`) to fix the CI
  drift; `Tests_OpsChecklistRunner.gs` is green in CI. The user
  confirmed this session: "OpsChecklistRunner.gs successfully ran in
  test in app script". **Revalidated 2026-10-03** (Part 4,
  `a325f00`): `checkStaleComponents_`/`parseFeatureUsageTimestampGs_`
  read directly from source; 15 new assertions added to
  `Tests_OpsChecklistRunner.gs` covering the rollout-grace
  "missing/too-early" case, a genuine 30-day-stale component, the
  never-observed-promoted-to-stale case once the grace period has
  passed, the all-clean case, and the `buildWeeklyOpsChecklistSummary_`
  wiring itself — full suite `1247/1247`
  (`python3 test/run-gs-tests-headless.py`). `TRACKED_COMPONENT_IDS_GS_`
  parity against `js/sheets-writeback.js`'s `TRACKED_COMPONENT_IDS`
  confirmed via `test/check-runtime-parity.py` (clean — the one
  pre-existing `HEADER_ALIASES` mismatch it reports is unrelated and
  already documented as intentional, `CLAUDE.md`).
- **Evidence:** commit `daba775`; `.github/workflows/test.yml`
  (`Tests_OpsChecklistRunner.gs`, last green run); the user's Apps
  Script test confirmation this session; `a325f00` +
  `python3 test/run-gs-tests-headless.py` (1247/1247) for Part 4.
- **Status:** Validated 2026-10-03.

## Version / change reference

Verified at `c82ec67`; record created by DOC-029. Added 2026-09-09;
`runWeeklyOpsChecklist_(ss, now)` split committed `daba775` this
session.

**2026-10-03** (`a325f00`, Part 4 of the dead-code-audit follow-up,
`docs/_planning/DEAD_CODE_AUDIT_2026-10-03.md`): added
`checkStaleComponents_`/`parseFeatureUsageTimestampGs_` (FN-322) and
three new config constants (`TRACKED_COMPONENT_IDS_GS_`/CFG-082,
`STALE_COMPONENT_DAYS_GS_`/CFG-083, `FEATURE_USAGE_TRACKING_STARTED_GS_`/
CFG-084), wired into `buildWeeklyOpsChecklistSummary_` as a 5th check.
Reads `Feature_Usage` (`SHEET-018`, new 2026-10-03, written by Part 3's
`JS-018` client-side usage tracking). No change to the trigger schedule
— `setupWeeklyOpsChecklistTrigger()` does not need re-running for this
change (a new check, not a new schedule — see "Requires `setupXxx()`
re-run when" above).

## Revalidation trigger

Any commit touching `OpsChecklistRunner.gs` or `Tests_OpsChecklistRunner.gs`;
the Monday schedule changes (needs the setup re-run); a check is
added/removed; `checkMovementLogFreshness_` (`GS-008`) or the `GS-011`
audit functions change signature; `OPS_CHECKLIST.md`'s automatable checks
change; `TRACKED_COMPONENT_IDS_GS_`/`STALE_COMPONENT_DAYS_GS_` change; a
component is added/removed on the `js/sheets-writeback.js` side
(`TRACKED_COMPONENT_IDS`).

## Handover relationship

`HANDOVER.md` §2 names the file; its entry was updated 2026-10-03 (same
commit as this record's revalidation) to cover the stale-component
check and the `js/sheets-writeback.js` `Feature_Usage` write path
(Part 3/Part 4 of the dead-code-audit follow-up) alongside the
pre-existing 4 checks. A change to which checks run must update
`HANDOVER.md` §2 and `OPS_CHECKLIST.md`.

## Lifecycle / retention

N/A — code. It writes no time-series data.

## Next action

none — Closed + Monitored.

## Closure evidence

Record committed for DOC-029; `docs/INDEX.md` `GS-009` → `Closed +
Monitored`, `Last Verified` 2026-09-10, links + the Monday trigger
recorded; `EXC-076`..`078` (including the CI-drift fix this session). No
`docs/changes/` record (DOC-029).
