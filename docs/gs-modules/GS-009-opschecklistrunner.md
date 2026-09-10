# GS-009 — OpsChecklistRunner.gs

| | |
|---|---|
| **Type** | `GS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `OpsChecklistRunner.gs` (153 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

A weekly (Monday ~09:00 IST) automated summary email that runs 3 of
`OPS_CHECKLIST.md`'s periodic checks an unattended script *can* judge —
RM-hierarchy resolution gaps, `Manager_Directory` email gaps, and
`Movement_Log` capture freshness — and reduces each to a pass/fail. It
sends **every week, issues or not**, on purpose: an absent email would
be ambiguous ("did it not run, or was everything fine?"). Added
2026-09-09. It exists to catch this project's slow-drift failure class
(from `OPS_CHECKLIST.md`) *before* it becomes one of `HANDOVER.md` §8's
incidents.

## Responsibilities

- `buildWeeklyOpsChecklistSummary_(ss, now)` — run the 3 checks, build
  the pass/fail summary.
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
| FN-227 | `runWeeklyOpsChecklist_(ss, now)` `#L111` | an injected spreadsheet + a fixed `now` | builds the summary and sends one email | Gmail send | `buildWeeklyOpsChecklistSummary_` (FN-228), `withSendRetry_` (`GS-004`) | `runWeeklyOpsChecklistNow` (FN-229), `Tests_OpsChecklistRunner.gs` | reusable — **the testable core** (split out this session, `daba775`, so tests pass a fixed `now` instead of drifting `new Date()`) |
| FN-228 | `buildWeeklyOpsChecklistSummary_(ss, now)` `#L43` | spreadsheet + now | the 3-check pass/fail summary text | none (reads sheets) | `auditUnresolvedRms_` / `auditManagerDirectoryEmailGaps_` (`GS-011`), `checkMovementLogFreshness_` (`GS-008`) | FN-227 | reusable |
| FN-229 | `runWeeklyOpsChecklistNow()` `#L130` | — | thin wrapper: `runWeeklyOpsChecklist_(SpreadsheetApp.getActiveSpreadsheet(), new Date())` | Gmail send (via FN-227) | FN-227 | the Monday trigger; Apps Script editor (manual) | specific — the production entry point |
| FN-230 | `setupWeeklyOpsChecklistTrigger()` `#L141` | — | installs the Monday ~09:00 IST trigger (deleting any prior one for `runWeeklyOpsChecklistNow`) | creates a trigger | `ScriptApp` | Apps Script editor (manual) | specific |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-076 | `Movement_Log` capture drifted past `MOVEMENT_LOG_FRESHNESS_GRACE_HOURS_` (8h) | `checkMovementLogFreshness_` (`GS-008`) returns stale → that check reads FAIL | the Monday email flags a stale-capture problem |
| EXC-077 | a fixture / real-clock mismatch (the CI failure this session) | fixed by FN-227 taking `now` as a parameter — tests pass the fixed anchor, not `new Date()` (`daba775`) | CI is green; the production path still uses real `new Date()` |
| EXC-078 | a send fails | `withSendRetry_` (`GS-004`) retries; persistent failure raises | shows as Failed in Executions; the check summary is still logged |

## Data lineage

`RM_Hierarchy` / `Manager_Directory` (`SHEET-006` / `SHEET-007`, via
`GS-011` audit functions) + `Movement_Log` freshness (`SHEET-002`, via
`GS-008` `checkMovementLogFreshness_`) → `buildWeeklyOpsChecklistSummary_`
→ a pass/fail text → one weekly email (`EXT-002`). Reads only; the only
side effect is the send.

## Sheets touched

| `SHEET-XXX` | Read / Write | Which `FN-XXX` | Notes |
|---|---|---|---|
| `SHEET-006` `RM_Hierarchy` | Read | FN-228 (via `GS-011` `auditUnresolvedRms_`) | resolution-gap check |
| `SHEET-007` `Manager_Directory` | Read | FN-228 (via `GS-011` `auditManagerDirectoryEmailGaps_`) | email-gap check |
| `SHEET-002` `Movement_Log` | Read | FN-228 (via `GS-008` `checkMovementLogFreshness_`) | freshness check |

## Failure / error behaviour

Read-only apart from the send; a send failure retries then raises. The
core `runWeeklyOpsChecklist_` was split from the wrapper this session
specifically so a real-clock-vs-fixture mismatch stops failing CI
(EXC-077, `daba775`).

## Cross-runtime duplication

None — this is a backend-only monitoring script. It reuses the audit
functions in `GS-011` and the freshness check in `GS-008` rather than
re-implementing them; `OPS_CHECKLIST.md` is the human checklist it
partially automates (not duplicated code — a different surface).

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
  `withSendRetry_`), `SHEET-002`, `SHEET-006`, `SHEET-007`, `EXT-002`
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
  test in app script".
- **Evidence:** commit `daba775`; `.github/workflows/test.yml`
  (`Tests_OpsChecklistRunner.gs`, last green run); the user's Apps
  Script test confirmation this session.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-029. Added 2026-09-09;
`runWeeklyOpsChecklist_(ss, now)` split committed `daba775` this session.

## Revalidation trigger

Any commit touching `OpsChecklistRunner.gs` or `Tests_OpsChecklistRunner.gs`;
the Monday schedule changes (needs the setup re-run); a check is
added/removed; `checkMovementLogFreshness_` (`GS-008`) or the `GS-011`
audit functions change signature; `OPS_CHECKLIST.md`'s automatable checks
change.

## Handover relationship

`HANDOVER.md` §2 names the file ("Weekly (Monday ~9am IST) automated
summary email … sends EVERY week, issues or not, on purpose (see §8)").
Current as of 2026-09-09. A change to which checks run must update
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
