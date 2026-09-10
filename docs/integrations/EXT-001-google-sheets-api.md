# EXT-001 — Google Sheets API (v4)

| | |
|---|---|
| **Type** | `EXT-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | Browser: `js/core-sheets-fetch.js` (`sheetsApiValuesGet`) + `js/sheets-writeback.js`. Backend: `SpreadsheetApp` (bound script). |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Component / Record** | Active / Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

Every read and write of the one Google Sheet goes through the Sheets
API — there is no other datastore. The dashboard uses the **REST v4
endpoint** directly (`fetch` to `sheets.googleapis.com/v4/spreadsheets/…`);
the Apps Script backend uses the built-in `SpreadsheetApp` service
against the same bound Sheet. This record covers both surfaces because
they are the same integration seen from two runtimes.

## What it's used for

- **Read:** the `leads` tab, `Movement_Log`, `RM_Hierarchy`,
  `SLA_History`, `Daily_Cohort_History`, `Lead_Followups` (poll).
- **Write:** `Movement_Log` snapshots, `Lead_Followups`, `SLA_History`,
  `Daily_Cohort_History`, `Send_Log`, and the backend's `Daily_RM_Issues`
  / `Overnight_Log` / `AllIssues_Log` / `Comment_History` /
  `Unmatched_Comments_Log`.

## Called from — `JS-XXX` / `GS-XXX` list

| ID | Which `FN-XXX` | Operation |
|---|---|---|
| `JS-009` | `sheetsApiValuesGet` (FN-065) | read (the one browser read call) |
| `JS-018` | `appendSheetRows` / `sheetsApiValuesBatchUpdate` (FN-122), `getSheetIdByTabName` (FN-123) | write / metadata |
| `JS-004` | `clearSlaHistory` (FN-025) | its own raw `batchUpdate` (outside `JS-018`) |
| `JS-021` | `fetchMovementLog` (FN-140) | read `Movement_Log` |
| `JS-022` | `fetchRmHierarchyForRollup` (FN-150) | read `RM_Hierarchy` |
| `GS-004` | `readLeadsTab_` (FN-197) | backend leads read (`SpreadsheetApp`) |
| `GS-008` | `snapshotOpenLeads_`, `pruneMovementLog_` (FN-218/220) | backend write / structural |
| `GS-011` | `rebuildRmHierarchy` (FN-245) | backend write |
| every other `GS-XXX` | via `readLeadsTab_` / `buildMovementLogMapsGs_` | read |

## API surfaces — `API-XXX` sub-table

| ID | Call pattern | Quota / rate limit | Retry behaviour |
|---|---|---|---|
| API-001 | `GET .../v4/spreadsheets/{id}/values/{range}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`, `Authorization: Bearer ${gateAccessToken}` | Google's per-user / per-project read quota | **none on the browser side** — a `!resp.ok` throws `{status}`; `JS-003` maps 403→`ACCESS_DENIED`, 404→`NOT_FOUND` |
| API-002 | `POST .../v4/spreadsheets/{id}/values:batchUpdate` (and `:append`) — `valueInputOption` `RAW` for date-text tabs, else `USER_ENTERED` | write quota | none on the browser side; upserts are keyed so a retry is safe |
| API-003 | `SpreadsheetApp` (backend) — `getRange().getValues()` / `setValues()` / `deleteRows()` | Apps Script's own 6-min execution + quota limits | wrapped in `withRetry_` (`GS-004` FN-196) with backoff |

## Auth mechanism

- **Browser:** the Sheets OAuth scope (`.../auth/spreadsheets`) obtained
  by `EXT-003` (the sign-in gate); the token is `gateAccessToken`
  (`JS-001`), read by name at every call site.
- **Backend:** the bound Apps Script project's own authorization (the
  script runs as whoever installed the triggers) — no token handling in
  code.
- The Sheet must be shared **Editor** with the signed-in account for
  writes to succeed; Viewer is enough to read (`HANDOVER.md` §4.1).

## Known failure modes

| Condition | Result |
|---|---|
| 403 on read | `ACCESS_DENIED` — the account can't see the sheet (`JS-003` EXC-004) |
| 404 on read | `NOT_FOUND` — wrong sheet id (`JS-003` EXC-005) — **correctly distinct** from 403 (`LOGIC_AUDIT.md` Part 6 §6.1 row 7) |
| 401 mid-session | expired token; the next user action re-prompts |
| Sheets coerces date-text → serial number on write | mitigated by `RAW` value-input on the affected tabs (`JS-018` RULE-032; a documented real bug class) |
| write while Viewer-only | permission error on every write path (`HANDOVER.md` §4.1) |
| 10M-cell workbook ceiling | mitigated by `pruneMovementLog_` / `pruneDailyRmIssueLog_` (structural `deleteRows`) |

## Rate-limit / retry behaviour

Backend: `withRetry_` / `withSendRetry_` (`GS-004`) wrap every read and
send with exponential-ish backoff. Browser: **no retry** — the app
relies on keyed upserts (safe to re-invoke) and surfaces read failures
to the user via `showError` (`JS-003`).

## Permissions / security-sensitive notes

The Sheet holds customer contact context and RM comments — Editor access
is a real privilege. `_currentSheetId` (`JS-021`) defaults to the
production sheet id, overridable via `#sheetIdInput` (`extractSheetId`,
`JS-009` FN-069). No sheet data is placed in a URL query string beyond
the API's own `range` path segment.

## Data lineage

Sheet ⇄ this API ⇄ (`allParsedLeads` / `movementSnapshots` / every write
target). The full per-flow detail is in `DATA-001`..`DATA-005`.

## Exceptions & error handling

See "Known failure modes." Browser throws are caught by `JS-003`;
backend throws are retried then surface as **Failed** in Apps Script
Executions.

## Architecture relationship

Shared boundary between both halves of the system and the datastore
(`SHEET-*`). `LOGIC_AUDIT.md` Part 1 §1 layers 3, 4, 11.

## Related documentation

`HANDOVER.md` §3 step 2, §4.1, §4.2; `LOGIC_AUDIT.md` Part 1 §1, Part 5
§5.4 (edge cases), Part 6 §6.1 row 7; `CLAUDE.md`.

## Relationships

- **Depends On:** `EXT-003` (the browser OAuth grant that authorises the
  read/write calls)
- **Used By:** `DASH-001`, `TAB-007`, `TAB-008`, `JS-003`, `JS-004`,
  `JS-009`, `JS-018`, `JS-021`, `JS-022`, `GS-002`, `SHEET-001`,
  `SHEET-002`, `SHEET-003`, `SHEET-004`, `SHEET-005`, `SHEET-006`,
  `SHEET-007`, `SHEET-008`, `SHEET-009`, `SHEET-010`, `SHEET-011`,
  `SHEET-012`, `SHEET-013`, `SHEET-014`, `DATA-001`, `DATA-004`
- **Related:** `EXT-002` (Gmail — the other Google API this project
  calls)

## Source of truth

`js/core-sheets-fetch.js` `sheetsApiValuesGet` `#L100`;
`js/sheets-writeback.js` `appendSheetRows` / `sheetsApiValuesBatchUpdate`
`#L65`/`#L85`; `EmailInfra.gs` `readLeadsTab_` `#L431`; `Core.gs`
`buildColIndex_`.

## Validation

- **Method:** call sites enumerated by grep at `c82ec67`; the 403/404
  distinction confirmed against `LOGIC_AUDIT.md` Part 6 §6.1 row 7; the
  `RAW`-vs-`USER_ENTERED` choice confirmed in `js/sheets-writeback.js`.
  `tests/frontend-harness.html` mocks exactly this boundary
  (`sheetsApiValuesGet` + `window.fetch`); `Tests_*.gs` mock
  `SpreadsheetApp`.
- **Evidence:** `tests/frontend-harness.html`; `.github/workflows/test.yml`;
  `LOGIC_AUDIT.md` Part 5 §5.4.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by `DOC-033`.

## Revalidation trigger

The Sheets API request shape changes (endpoint, `valueRenderOption`,
`valueInputOption`); a new read/write call site is added; the
403/404 error mapping changes; the retry policy changes; Google
deprecates the v4 `values` endpoint.

## Handover relationship

`HANDOVER.md` §3 step 2 (read), §4.1 (Sheet access), §4.2 (the OAuth
project). Current as of 2026-09-09. An API-shape or auth change must
update `HANDOVER.md` §3/§4 in the same commit.

## Lifecycle / retention

N/A — an integration, not stored data. (The tabs it touches have their
own retention — `SHEET-*`.)

## Next action

none — Closed + Monitored.

## Closure evidence

Record committed for `DOC-033`; `docs/INDEX.md` `EXT-001` → `Closed +
Monitored`, `Last Verified` 2026-09-10, real call-site references
recorded. No `docs/changes/` record (`DOC-033`).
