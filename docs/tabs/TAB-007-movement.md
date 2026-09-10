# TAB-007 — Movement

| | |
|---|---|
| **Type** | `TAB-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `dashboard.html` `#tab-movement` (`#L1262`); `js/tab-movement.js` |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

The change-over-time tab, and the **shared `Movement_Log` data hub** for
the rest of the dashboard. It fetches and parses `Movement_Log` (the
4×/day backend snapshot of every lead), then derives Stalled Leads, the
RM Stall Leaderboard, Time-to-Opportunity, Unmatched Comments, and the
Overnight-Leads cohort with its region-email trigger. It exists because
the live `leads` tab only shows the present — reconstructing "this lead
stopped moving 3 days ago" or "here is the overnight cohort" needs the
snapshot history, and this is the one module that loads and owns it.

## Responsibilities

- `fetchMovementLog()` → parse → `movementSnapshots` / `movementFetchState`
  / `_currentSheetId` (module state other tabs read).
- Render Stalled Leads, RM Stall Leaderboard, Time-to-Opportunity,
  Unmatched Comments, Overnight cohort.
- Host the on-demand Movement_Log snapshot button + auto-snapshot
  checkbox (physically in the shared top bar, wired here by
  `initMovementUI()`).
- Host the Overnight "Generate Region Emails" write cycle.

## Who / what uses it

Regional heads / team leads reviewing stalls and the overnight cohort;
its state is consumed by `TAB-004`, `TAB-005`, `TAB-008`
(`LOGIC_AUDIT.md` Part 1 §4c).

## Inputs (which in-memory state arrays / filter state it reads)

`Movement_Log` sheet rows (`SHEET-002`, via its own `sheetsApiValuesGet`
read); `allParsedLeads` + `enrichLead` (core); `filterState`. The
Overnight cohort window uses **live** `allParsedLeads`, not a frozen
snapshot — status is "as of last refresh," not "as of window end"
(`LOGIC_AUDIT.md` Part 1 §4c).

## Outputs / what it renders

Stalled / leaderboard / time-to-opp / unmatched-comment / overnight-cohort
sections into `#tab-movement`; an Unmatched Comments CSV; the generated
Overnight region emails (preview + `Lead_Followups` write).

## Data displayed

Per stalled lead: age, last-comment age, call-attempt delta vs a ~6h-old
snapshot. Leaderboard: per-RM stall counts. Overnight cohort: leads
assigned overnight and their current status.

## Data written / modified

Via `JS-018` (`sheets-writeback.js`):

| Target | When | Function |
|---|---|---|
| `SHEET-002` `Movement_Log` | Snapshot Now button / auto-snapshot tick | `browserSnapshotOpenLeads` |
| `SHEET-004` `Lead_Followups` | Overnight "Generate Region Emails" cycle (clear → push → wait) | `clearLeadFollowupsTab` / `pushLeadsToFollowups` / `waitForAllFollowups` |
| `SHEET-011` `Send_Log` | after an Overnight Gmail send | `logEmailSend` |

The Overnight cycle competes with Operations' Generate cycle for the
`_generateCycleOwner` mutex (`JS-018` `#L275`).

## Navigation relationships

Reached from `#tabBar`. Its `movementSnapshots` / `buildMovementHistories`
/ `passesMovementFilters` are read by `TAB-004`, `TAB-005`, `TAB-008` and
`JS-013`. `initMovementUI()` is bootstrapped from `JS-011`.

## Buttons / actions — `BTN-XXX` sub-table

| ID | Label | Element id | What it does | Invokes (`FN-XXX`) | Confirm/irreversible? | Failure behaviour |
|---|---|---|---|---|---|---|
| BTN-014 | Snapshot now | `#snapshotNowBtn` | Writes an on-the-spot `Movement_Log` checkpoint (same sign-in, no separate connect) | `browserSnapshotOpenLeads` (`JS-018`) | writes to `Movement_Log`; **no reentrancy guard** (`LOGIC_AUDIT.md` Part 7 §18 MEDIUM #1) | on write failure, status text shows the error; rows may be partial |
| BTN-015 | Auto-snapshot (checkbox) | `#autoSnapshotCheck` | Enables periodic auto-snapshot while the tab is open | auto-snapshot tick (`JS-018` / `JS-021`) | writes to `Movement_Log` | same as BTN-014 per tick |
| BTN-016 | Generate Region Emails | `#overnightGenerateReportsBtn` | Runs the Overnight region-email clear→push→wait→rebuild cycle | Overnight generate handler (`JS-021`) → `JS-016` / `JS-018` | writes `Lead_Followups`; gated by the mutex | falls back to the algorithmic report with "UNREVIEWED" banner if the wait is cancelled |
| BTN-017 | Cancel wait | `#overnightFollowupsWaitCancelBtn` | Cancels the Overnight cycle's human-review wait | keyed cancel via `_followupWaitCancelled` Map (`JS-018`) | no | triggers the UNREVIEWED fallback |
| BTN-018 | Download Unmatched Comments CSV | `#downloadUnmatchedCommentsBtn` | Exports the unmatched-comment list as CSV | `downloadUnmatchedCommentsCSV` (`JS-021`) | no (local download) | inert in a sandboxed viewer |

## Non-button UI elements — `UI-XXX` sub-table

| ID | Element | Behaviour | Invokes (`FN-XXX`) |
|---|---|---|---|
| UI-012 | Movement filter multi-selects | write `filterState`, re-render via `passesMovementFilters` | `passesMovementFilters` (`JS-021`) |

## Owning module(s)

`JS-021` (`js/tab-movement.js`); write paths in `JS-018`; Overnight report
content from `JS-014` / `JS-016`. Reciprocal `Used By: TAB-007` on each.

## Relevant functions

`fetchMovementLog`, `computeStalledLeads`, `renderMovementTab`,
`initMovementUI`, `buildMovementHistories`, `passesMovementFilters`,
`downloadUnmatchedCommentsCSV` (`JS-021`); `browserSnapshotOpenLeads`,
`clearLeadFollowupsTab`, `pushLeadsToFollowups`, `waitForAllFollowups`
(`JS-018`). Detail on those FN sub-tables.

## Important logic / business rules

- Stalled-lead rule (`JS-021` `~#L543`): ≥2 days old AND (has comments
  but none in 6h, OR never commented and `call_attempts` unchanged vs a
  ~6h-old snapshot).
- Overnight cohort window uses live `allParsedLeads` (`LOGIC_AUDIT.md`
  Part 1 §4c).
- `window._overnightRegionReports` is consistently `window.`-prefixed —
  no shadow-`let` bug here (`LOGIC_AUDIT.md` Part 1 §4c).
- `browserSnapshotOpenLeads` has no reentrancy guard — a fast double
  Snapshot-Now can double-write (`LOGIC_AUDIT.md` Part 7 §18 MEDIUM #1).

## Exceptions & error handling

Failed `Movement_Log` read → `movementFetchState = 'error'`, dependent
tabs show "not loaded." Snapshot write failure surfaces in the button's
status text. Mutex-blocked Generate cycle shows a "cycle in progress"
message.

## Architecture relationship

`DASH-001`. Owns `DATA-004` (Movement snapshot pipeline) on the read
side; participates in `DATA-005` (region-email pipeline) via the
Overnight cycle.

## Related documentation

`HANDOVER.md` §2, §3 step 5, §8 (Movement_Log incidents);
`LEAD_FOLLOWUPS_STALENESS.md`; `LOGIC_AUDIT.md` Part 1 §4c, Part 2 §4
(write-back flow), Part 7 §18 MEDIUM #1.

## Relationships

- **Depends On:** `JS-003` (`allParsedLeads`), `JS-009`
  (`sheetsApiValuesGet`), `JS-014`, `JS-015`, `JS-016` (Overnight report
  content), `JS-018` (writes), `JS-021`, `SHEET-002`, `SHEET-004`,
  `SHEET-011`, `EXT-001`, `EXT-002`, `DATA-005`
- **Used By:** `DASH-001`
- **Related:** `GS-008` (`MovementTracker.gs` writes the `Movement_Log` it
  reads), `GS-010` (`OvernightEmailer.gs` — the unattended equivalent of
  its Overnight cycle), `TAB-003` (shared `Lead_Followups` mutex)

## Source of truth

`dashboard.html` `#tab-movement`; `js/tab-movement.js` at `HEAD`.

## Validation

- **Method:** read of `js/tab-movement.js` + `#tab-movement` markup at
  `c82ec67`; cross-check `LOGIC_AUDIT.md` Part 1 §4c + Part 2 §4;
  `tests/frontend-harness.html` mocks the `Movement_Log` read and
  exercises `computeStalledLeads` / `browserSnapshotOpenLeads` with a
  mocked write boundary.
- **Evidence:** `LOGIC_AUDIT.md` Part 1 §4c, Part 2 §4;
  `tests/frontend-harness.html`.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-026.

## Revalidation trigger

Any commit touching `js/tab-movement.js`; the stalled-lead rule
thresholds change; a new consumer starts reading `movementSnapshots`;
`#tab-movement` button set changes; `Movement_Log` (`SHEET-002`) columns
or retention change.

## Handover relationship

`HANDOVER.md` §3 step 5 covers the write-back paths; §2 names the file;
§8 has the Movement_Log incidents. Current as of 2026-09-09. A change to
the snapshot schema or the shared-hub role must update `HANDOVER.md` §3
and note the downstream `TAB-004`/`005`/`008` dependency.

## Lifecycle / retention

N/A — code. The `Movement_Log` it reads/writes retains 7 days
(`SHEET-002`).

## Next action

none — Closed + Monitored.

## Closure evidence

Record committed for DOC-026; `docs/INDEX.md` `TAB-007` → `Closed +
Monitored`, `Last Verified` 2026-09-10; `BTN-014`..`BTN-018` rows added;
validation evidence as above. No `docs/changes/` record (DOC-026).
