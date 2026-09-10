# JS-018 — sheets-writeback.js

| | |
|---|---|
| **Type** | `JS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `js/sheets-writeback.js` (868 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

**Every real Sheets write the browser makes lives here.** One module
owns the Movement_Log on-demand snapshot, the `Lead_Followups` upsert
and clear, the `Send_Log` append, the `SLA_History` upsert/sort/backfill,
and the `Daily_Cohort_History` upsert/sort/backfill/clear — plus the
shared low-level `appendSheetRows` / `sheetsApiValuesBatchUpdate`
helpers, the `_generateCycleOwner` mutex, and the human-review wait
(`waitForAllFollowups`). It exists so write behaviour (value-input
mode, dedup keys, self-healing headers, the cross-cycle mutex) is
defined and audited in exactly one place — it is the single most
cross-referenced JS file in the app (`LOGIC_AUDIT.md` Part 6 §6.5).

## Responsibilities

- Low-level write helpers (`appendSheetRows`, `sheetsApiValuesBatchUpdate`,
  `getSheetIdByTabName`).
- `browserSnapshotOpenLeads` + the auto-snapshot checkbox — Movement_Log.
- `pushLeadsToFollowups` / `clearLeadFollowupsTab` / `waitForAllFollowups`
  + `_generateCycleOwner` mutex + `_followupWaitCancelled` per-wait
  cancel — the Generate-cycle bridge.
- `logEmailSend` (+ `ensureSendLogSheet_`) — `Send_Log`.
- `upsertSlaHistoryRows` / `sortSlaHistorySheet_` /
  `backfillSlaHistoryFromMovementLog` — `SLA_History`.
- `upsertDailyCohortHistoryRows` / `sortDailyCohortHistorySheet_` /
  `backfill…` / `clearDailyCohortHistory` / `fetch…` —
  `Daily_Cohort_History`.

## Load order / position

Loads with the tab group, before `main.js` (`LOGIC_AUDIT.md` Part 1 §4a).

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-121 | `browserSnapshotOpenLeads()` `#L809` | `allParsedLeads`, `_currentSheetId` | appends Movement_Log rows | Sheets write; status text; **no reentrancy guard** | `movementCellValue` (FN-129), `appendSheetRows` (FN-122), `enrichLead` (`JS-006`) | `#snapshotNowBtn` (`BTN-014`), auto-snapshot tick (`BTN-015`) | specific — `LOGIC_AUDIT.md` Part 7 §18 MEDIUM #1 (no guard) |
| FN-122 | `appendSheetRows(tabName, rows, valueInputOption)` / `sheetsApiValuesBatchUpdate(data, valueInputOption)` `#L65/#L85` | tab name, rows, `RAW`/`USER_ENTERED` | the API result | one Sheets write call | `getSheetIdByTabName` (FN-123), `gateAccessToken` (`JS-001`) | every write function here | reusable — the low-level write primitives |
| FN-123 | `getSheetIdByTabName(tabName)` `#L253` | a tab name | the numeric sheetId | one metadata read | — | FN-122 and the clear/sort helpers | reusable |
| FN-124 | `pushLeadsToFollowups(rows, statusElId)` `#L187` | qualifying issue leads | upserts `Lead_Followups` cols A–E, G — **never column F** (`suggested_followup`, left for a human) | Sheets upsert; status text | `appendSheetRows` (FN-122), `sheetsApiValuesBatchUpdate` (FN-122) | `renderReports` (`JS-016`), Overnight cycle (`JS-021`) | specific |
| FN-125 | `clearLeadFollowupsTab()` `#L298` | — | clears `Lead_Followups` data rows | Sheets write | FN-122/FN-123 | start of every Generate cycle (`JS-016`, `JS-021`) — **runs at the START, "Not send-gated"** (`LOGIC_AUDIT.md` Part 6 §6.1 row 5 — comment is correct) | specific |
| FN-126 | `tryClaimGenerateCycle(owner)` / `releaseGenerateCycle(owner)` / `generateCycleOwnerLabel(owner)` `#L277/#L282/#L285` | `'operations'` \| `'overnight'` | claims/releases `_generateCycleOwner` (`null`\|owner) | mutates the module-level owner | — | `renderReports` (`JS-016`), Overnight cycle (`JS-021`) | reusable — **the real mutex** stopping the two cycles clobbering `Lead_Followups` |
| FN-127 | `waitForAllFollowups(leadIds, statusElId, cancelBtnId)` / `sleepCancelable(ms, cancelKey)` / `showFollowupWaitControls(show, btnId)` `#L759/#L714/#L734` | lead ids, a cancel-button id | polls `Lead_Followups` col F until filled or cancelled | reads Sheet; DOM; reads `_followupWaitCancelled` (a **`Map` keyed by `cancelBtnId`** — the cross-cancel bug is already fixed, `LOGIC_AUDIT.md` Part 6 §6.1 row 2) | FN-123, `sheetsApiValuesGet` (`JS-009`) | `renderReports` (`JS-016`), Overnight cycle (`JS-021`) | reusable |
| FN-128 | `upsertSlaHistoryRows(entries)` / `sortSlaHistorySheet_()` / `backfillSlaHistoryFromMovementLog()` `#L335/#L380/#L423` | SLA entries / — | upserts by `snapshot_at` (never duplicates); sorts; rebuilds from Movement_Log | Sheets write, **`RAW` value-input** (stops Sheets date-text→serial coercion) | FN-122, `movementSnapshots` (`JS-021`) | `snapshotSlaHistory` (`JS-004`), `MovementTracker`-equivalent checkpoints, `#backfillSlaHistoryBtn` (`BTN-019`) | specific |
| FN-129 | `upsertDailyCohortHistoryRows(entries)` + `ensureDailyCohortHistorySheet_` / `sortDailyCohortHistorySheet_` / `backfillDailyCohortHistoryFromMovementLog` / `clearDailyCohortHistory` / `fetchDailyCohortHistoryForDate` / `fetchAllDailyCohortHistoryRows` `#L506`, `#L479`–`#L690` | cohort entries / a date key | upserts / reads / clears `Daily_Cohort_History` | Sheets write (`RAW`); self-healing header | FN-122/FN-123 | `persistDailyCohortHistory` (`JS-024`), `#backfillDailyCohortHistoryBtn` (`BTN-021`), `#clearDailyCohortHistoryBtn` (`BTN-022`) | specific |
| FN-130 | `logEmailSend(report, to, cc)` + `ensureSendLogSheet_()` `#L147/#L124` | a sent report + recipients | appends a `Send_Log` row (fire-and-forget) | Sheets write; creates the tab if missing | FN-122 | `performGmailSend` (`JS-015`), the mailto path | specific |
| FN-131 | `initAutoSnapshotCheckbox()` / `autoSnapshotEnabled()` / `istDateTimeValue(date)` / `movementCellValue(l, key)` `#L15/#L26/#L37/#L47` | — / a lead + column key | wires the checkbox / a cell value | DOM listener / none | — | `initMovementUI` (`JS-021`), FN-121 | reusable |

## Data lineage — the full write table (`DOC-028` deliverable)

| `SHEET-XXX` | R / W | Which `FN-XXX` | Trigger | Data written | Notes |
|---|---|---|---|---|---|
| `SHEET-002` `Movement_Log` | W (append) | FN-121 `browserSnapshotOpenLeads` (via FN-122 `appendSheetRows`) | `#snapshotNowBtn` (`BTN-014`) / auto-snapshot tick (`BTN-015`) | one row per open lead: the `SNAPSHOT_COLUMNS_` shape (`region`, `group_source`, no `project_region`), enriched SLA flags, call counters, `snapshot_at` | schema **agrees exactly** with `MovementTracker.gs`'s writer (`LOGIC_AUDIT.md` Part 4 §4.7). No reentrancy guard on FN-121. |
| `SHEET-004` `Lead_Followups` | W (upsert cols A–E, G) | FN-124 `pushLeadsToFollowups` | Generate cycle (`JS-016` / `JS-021`) | lead id, region, RM, issue, latest comment, `updated_at` (col G) — **column F left blank for a human** | mutex-guarded (FN-126). Consumer map: `LEAD_FOLLOWUPS_STALENESS.md`. |
| `SHEET-004` `Lead_Followups` | W (clear data rows) | FN-125 `clearLeadFollowupsTab` | **start** of every Generate cycle | — | "Not send-gated" — runs before the push, not after the send (`LOGIC_AUDIT.md` Part 6 §6.1 row 5) |
| `SHEET-004` `Lead_Followups` | R (poll col F) | FN-127 `waitForAllFollowups` | Generate cycle wait phase | — | per-wait cancel via `_followupWaitCancelled` Map |
| `SHEET-005` `SLA_History` | W (upsert by `snapshot_at`) + sort | FN-128 `upsertSlaHistoryRows` / `sortSlaHistorySheet_` | `snapshotSlaHistory` (`JS-004`), checkpoints, `#backfillSlaHistoryBtn` (`BTN-019`) | per-snapshot SLA totals | **`RAW`** value-input (stops date→serial coercion) |
| `SHEET-005` `SLA_History` | W (rebuild) | FN-128 `backfillSlaHistoryFromMovementLog` | `#backfillSlaHistoryBtn` (`BTN-019`) | rebuilt from every loaded `Movement_Log` snapshot | upsert by `snapshot_at`, safe to re-run |
| `SHEET-008` `Daily_Cohort_History` | W (upsert) + sort, R, clear | FN-129 family | `persistDailyCohortHistory` (`JS-024`), `#backfillDailyCohortHistoryBtn` (`BTN-021`), `#clearDailyCohortHistoryBtn` (`BTN-022`) | per-date per-region cohort outcomes | **`RAW`** value-input; matching schema to the Apps Script cohort writer (`LOGIC_AUDIT.md` Part 1 §4d) |
| `SHEET-011` `Send_Log` | W (append), + create-if-missing | FN-130 `logEmailSend` / `ensureSendLogSheet_` | after a Gmail / mailto send (`JS-015`) | subject, to, cc, timestamp | **fire-and-forget** — a failure here is not surfaced |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-034 | double Snapshot-Now click before the first completes | **no guard** — both writes proceed | possible duplicate Movement_Log rows for one instant (`LOGIC_AUDIT.md` Part 7 §18 MEDIUM #1) |
| EXC-035 | both Generate cycles run concurrently | `tryClaimGenerateCycle` fails for the second | the second cycle is refused with a "cycle in progress" message — `Lead_Followups` not clobbered |
| EXC-036 | a partial write (network drop mid-upsert) | status text shows the error; upsert functions are re-runnable | user retries; no duplicate rows (upsert by key) |
| EXC-037 | `Send_Log` append fails | swallowed (fire-and-forget) | send still counts as done; the log row is simply missing |
| EXC-038 | cross-runtime `Lead_Followups` overlap (client cycle + `OvernightEmailer.gs` at once) | **not guarded across runtimes** | `LOGIC_AUDIT.md` Part 7 §18 MEDIUM #3 |

## Data sources accessed

Reads `allParsedLeads` / `movementSnapshots` / `_currentSheetId` (state);
reads `Lead_Followups` (`SHEET-004`, poll), `SLA_History` /
`Daily_Cohort_History` (backfill/fetch). Auth: `gateAccessToken`
(`JS-001`). Integration: `EXT-001`.

## Data written / modified

`SHEET-002`, `SHEET-004`, `SHEET-005`, `SHEET-008`, `SHEET-011` — see the
write table. No email send (that is `JS-015`), but `logEmailSend` logs
one.

## Failure / error behaviour

Upserts are keyed and re-runnable; the mutex prevents intra-runtime
clobber; `Send_Log` is fire-and-forget. `RAW` value-input is a
deliberate choice against a documented Sheets date-coercion bug class.
The cross-runtime overlap and the snapshot reentrancy are the two known
unguarded windows.

## Cross-runtime duplication

The Movement_Log snapshot schema is intentionally identical to
`MovementTracker.gs`'s writer (`LOGIC_AUDIT.md` Part 4 §4.7 — "agree
exactly"). The `Lead_Followups` bridge is shared with
`OvernightEmailer.gs`'s `pushUnresolvedToLeadFollowups_` (`GS-010`). The
`Daily_Cohort_History` schema matches the Apps Script cohort writer.

## UI relationships

`#snapshotNowBtn` (`BTN-014`), `#autoSnapshotCheck` (`BTN-015`),
`#followupsWaitCancelBtn` (`BTN-009`), `#overnightFollowupsWaitCancelBtn`
(`BTN-017`), `#backfillSlaHistoryBtn` (`BTN-019`), `#backfillDailyCohortHistoryBtn`
(`BTN-021`), `#clearDailyCohortHistoryBtn` (`BTN-022`). `clearSlaHistory`
itself lives in `JS-004` (`BTN-020`), not here.

## Architecture relationship

`DASH-001`. Layer 11 (Mutation / write-back — client) in `LOGIC_AUDIT.md`
Part 1 §1.

## Related documentation

`HANDOVER.md` §3 step 5, §8 (write-related incidents);
`LEAD_FOLLOWUPS_STALENESS.md` (every `Lead_Followups` consumer + its
staleness tolerance); `LOGIC_AUDIT.md` Part 1 §4c, Part 2 §4 (write-back
Mermaid), Part 3 §3.8, Part 4 §4.7, Part 6 §6.1 rows 2/5, §6.5, Part 7
§18 MEDIUM #1/#3; `CLAUDE.md` (the `Lead_Followups` testing rule).

## Relationships

- **Depends On:** `JS-001` (`gateAccessToken`), `JS-009`
  (`sheetsApiValuesGet`), `JS-006` (`enrichLead`), `JS-021`
  (`_currentSheetId`, `movementSnapshots`), `JS-003` (`allParsedLeads`),
  `EXT-001`, `SHEET-002`, `SHEET-004`, `SHEET-005`, `SHEET-008`,
  `SHEET-011`
- **Used By:** `TAB-007` (snapshot, Overnight cycle), `TAB-003`
  (Generate button via `JS-016`), `TAB-008` (4 admin buttons +
  auto-persist via `JS-024`), `JS-015` (`logEmailSend`), `JS-016`,
  `JS-021`, `JS-024`, `JS-004`
- **Related:** `GS-008` (`MovementTracker.gs` — matching Movement_Log /
  SLA_History writer), `GS-010` (`OvernightEmailer.gs` — shares the
  `Lead_Followups` bridge), `GS-007` (`LeadFollowupsStaleness.gs`)

## Source of truth

`js/sheets-writeback.js` at `HEAD`.

## Validation

- **Method:** full read at `c82ec67`; function list verified by grep;
  `_generateCycleOwner` (`#L277`) and `_followupWaitCancelled` (`#L714`
  `sleepCancelable` cancelKey / `#L759` `waitForAllFollowups`) confirmed;
  cross-check `LOGIC_AUDIT.md` Part 4 §4.7 (schema match), Part 6 §6.1
  rows 2/5 (both do-not-reproduce), §6.5 (this file's centrality).
  `tests/frontend-harness.html` mocks `window.fetch` +
  `sheetsApiValuesGet` and drives `pushLeadsToFollowups`,
  `upsertSlaHistoryRows`, `browserSnapshotOpenLeads` — confirmed no
  throw, correct status text.
- **Evidence:** `LOGIC_AUDIT.md` Part 4 §4.7, Part 6 §6.1/§6.5;
  `tests/frontend-harness.html`.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-028.

## Revalidation trigger

Any commit touching `js/sheets-writeback.js`; any write function's target
tab, dedup key, or value-input mode changes; a new write path is added
(update the write table **and** `LEAD_FOLLOWUPS_STALENESS.md` if it
touches `Lead_Followups`); the `_generateCycleOwner` mutex or the
`_followupWaitCancelled` Map keying changes; a `SHEET-XXX` this file
writes changes columns.

## Handover relationship

`HANDOVER.md` §3 step 5 covers the write paths; §8 has the write-related
incidents. Current as of 2026-09-09. A new write path must update
`HANDOVER.md` §3 and `LEAD_FOLLOWUPS_STALENESS.md`'s consumer map in the
**same commit** (`CLAUDE.md`'s explicit rule).

## Lifecycle / retention

N/A — code. The tabs it writes have their own retention: `SHEET-002` = 7
days; `SHEET-004`/`SHEET-005`/`SHEET-008`/`SHEET-011` = `TBD` (DOC-036).

## Next action

none — Closed + Monitored. (The two unguarded windows, EXC-034 /
EXC-038, are known `LOGIC_AUDIT.md` findings, not this record's to fix;
the revalidation trigger keeps them visible.)

## Closure evidence

Record committed for DOC-028; `docs/INDEX.md` `JS-018` → `Closed +
Monitored`, `Last Verified` 2026-09-10, links filled; full Data Lineage
write table + `EXC-034`..`038` recorded (the `DOC-028` deliverable for
this file). No `docs/changes/` record (DOC-028).
