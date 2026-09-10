# JS-015 — reports-gmail.js

| | |
|---|---|
| **Type** | `JS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `js/reports-gmail.js` (411 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

The real one-click Gmail send. It owns the **second, separate** OAuth
grant (`gmail.send` scope — kept distinct from the Sheets sign-in gate so
a user can browse without ever being asked for send permission), the
raw-MIME message encoding, the one real
`fetch(POST gmail.googleapis.com/.../messages/send)` call, and a
`localStorage` 1-hour sent-log used **only** for button cosmetics. It
exists so a manager can send a generated region report from the browser
without leaving the page for their mail client.

## Responsibilities

- `connectGmail()` / `initGmailTokenClient()` — the separate Gmail OAuth
  grant.
- `buildRawEmail()` + the base64url / UTF-8 header helpers — RFC 2047 /
  raw-MIME encoding.
- `performGmailSend(pending)` — the one real send call, with
  OAuth-resume support for single **and** bulk sends.
- `sendReportViaGmail` / `sendAllReportsGmail` / `_runBulkGmailSend` —
  single and sequential-bulk send orchestration.
- `loadGmailSentLog` / `markReportSent` / `applyGmailButtonState` — the
  cosmetic 1-hour sent-log.

## Load order / position

Second of the 3 reports files (`reports-build` → **reports-gmail** →
`reports-ui`).

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-103 | `performGmailSend(pending)` `#L270` | a `pending` send descriptor (`kind: 'single' | 'bulk'`, report(s), recipients) | resolves on a 200 from Gmail | **the one real `fetch(POST .../messages/send)`**; may re-request the token; on OAuth resume branches on `pending.kind==='bulk'` and calls `_runBulkGmailSend` | `buildRawEmail` (FN-104), `gmailTokenValid` (FN-106), `logEmailSend` (`JS-018`, fire-and-forget) | `sendReportViaGmail` (FN-107), `_runBulkGmailSend` (FN-108) | specific — the send boundary |
| FN-104 | `buildRawEmail(to, cc, subject, body, htmlBody)` `#L244` | recipients + content | a base64url raw MIME string | none | `utf8ToBase64` / `encodeHeaderUtf8` / `toBase64Url` (`#L216`–`#L236`) | FN-103 | reusable |
| FN-105 | `connectGmail()` / `initGmailTokenClient(clientId)` / `saveGmailClientId()` `#L188/#L155/#L204` | — / Client ID | triggers the `gmail.send` grant; persists a Client-ID override | GIS token client for the Gmail scope; `localStorage` write | `getGmailClientId` (FN-106), GIS (`EXT-002`) | `#gmailConnectBtn` (`BTN-006`), `#gmailSaveClientIdBtn` (`BTN-007`) | specific |
| FN-106 | `getGmailClientId` / `setGmailClientId` / `gmailTokenValid` / `updateGmailStatusUI` / `fetchGmailUserEmail` `#L114`–`#L142` | — | Client ID / bool / status UI / user email | `localStorage` read/write; DOM status | — | FN-103, FN-105, `core-auth.js` (`JS-001`) fallback | reusable |
| FN-107 | `sendReportViaGmail(report, btnId)` / `sendRegionReportGmail(idx)` / `sendAllReportGmail(i)` `#L313/#L334/#L338` | a report + button id / an index | initiates a single send | button state changes | `performGmailSend` (FN-103), `recipientsForReport` (`JS-016`) | onclick handlers in generated report HTML | specific |
| FN-108 | `_runBulkGmailSend(reports, btnIdFn, statusElId, confirmText)` / `sendAllReportsGmail(...)` `#L349/#L378` | a report list + UI ids | sends every report **sequentially** (not `Promise.all`) | per-report button + status updates | `performGmailSend` (FN-103) | `#generateAllReportsBtn`-driven bulk send | specific — sequential to reduce Gmail rate-limit risk |
| FN-109 | `loadGmailSentLog` / `markReportSent(subject)` / `gmailSentAt(subject)` / `applyGmailButtonState(btn, subject)` / `applyGmailButtonStatesFor(...)` `#L59`–`#L107` | a subject / a button | reads/writes the 1-hour sent-log; sets button cosmetics | `localStorage` read/write | — | render paths after a send | reusable — **cosmetic only**, not a send guard |
| FN-110 | `initGmailUI()` `#L394` | — | wires the Gmail connect/setup buttons | DOM listeners | FN-105, FN-106 | `reports-ui.js` `initGmailUI` call | specific |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-026 | Gmail consent denied / popup closed | `performGmailSend` rejects; button restored | send does not happen; status text shows failure |
| EXC-027 | a send fails **after** one had already succeeded (bulk) | the button is restored to its prior **"Sent"** state, not a bare "Send" | the earlier success is not visually lost — a real UX-correctness detail (`LOGIC_AUDIT.md` Part 1 §4c) |
| EXC-028 | OAuth token expires mid-batch | resume branches on `pending.kind==='bulk'` → `_runBulkGmailSend` continues from where it was | no double-click needed (`LOGIC_AUDIT.md` Part 6 §6.1 row 3 — does not reproduce) |

## Data lineage

Report objects (`window._regionReports` / `_allReports`, from `JS-014` /
`JS-016`) + recipients (`recipientsForReport`, `JS-016`) → `buildRawEmail`
(FN-104) → base64url MIME → `performGmailSend` (FN-103) → Gmail API
(`EXT-002`) → an email is sent; `logEmailSend` (`JS-018`) fire-and-forget
appends a `Send_Log` row (`SHEET-011`). Full flow: `DATA-005`.

## Data sources accessed

Reads `window._regionReports` / `_allReports` (state). `localStorage`
for the sent-log + Client-ID override. Integration: `EXT-002` (Gmail
send).

## Data written / modified

Sends real email via `EXT-002`. Appends `Send_Log` (`SHEET-011`) via
`logEmailSend` (`JS-018`), fire-and-forget. `localStorage` sent-log.

## Failure / error behaviour

A failed send rejects and restores the button (preserving a prior "Sent"
state, EXC-027). Bulk sends are sequential so one failure doesn't abort
the rest. OAuth resume covers both single and bulk (EXC-028). The
`Send_Log` append is fire-and-forget — a failure there is not surfaced.

## Cross-runtime duplication

The unattended email path (`OvernightEmailer.gs` / `AllIssuesEmailer.gs`,
`GS-010` / `GS-001`) sends via Apps Script's own Gmail service (and the
Advanced Gmail Service for threaded replies) — a parallel implementation,
not shared code. `TEST_MODE_OVERRIDE_EMAIL_` (`EmailInfra.gs` `#L43`) is
the backend's twin of the `reports-ui.js` `TEST_MODE_OVERRIDE_EMAIL`
footgun (`LOGIC_AUDIT.md` Part 1 §4d / §6).

## UI relationships

`#gmailConnectBtn` (`BTN-006`), `#gmailSaveClientIdBtn` (`BTN-007`),
`#gmailSetupToggle` (`BTN-008`) on `TAB-003`; the per-report "Send via
Gmail" buttons in generated report HTML.

## Architecture relationship

`DASH-001`. Layer 12 (Mutation / Gmail send) in `LOGIC_AUDIT.md` Part 1
§1.

## Related documentation

`HANDOVER.md` §3 step 4, §4.2 (the shared Client ID, the Gmail scope),
§4.3; `LOGIC_AUDIT.md` Part 1 §4c, Part 6 §6.1 row 3.

## Relationships

- **Depends On:** `JS-001` (shared Client ID via `getGmailClientId`),
  `JS-014`, `JS-016` (report objects, `recipientsForReport`), `JS-018`
  (`logEmailSend`), `SHEET-011`, `EXT-002` (Gmail send)
- **Used By:** `TAB-003`, `TAB-007` (onclick handlers in generated
  report HTML), `JS-001`, `JS-016` (`initGmailUI`), `SHEET-011`
- **Related:** `GS-010` / `GS-001` (the unattended send path — parallel,
  not shared), `EXT-003` (the other, separate OAuth grant)

## Source of truth

`js/reports-gmail.js` at `HEAD`.

## Validation

- **Method:** full read at `c82ec67`; function list verified by grep;
  cross-check `LOGIC_AUDIT.md` Part 1 §4c + Part 6 §6.1 row 3 (batch
  OAuth-resume confirmed working). `tests/frontend-harness.html` mocks
  `window.fetch` and drives `performGmailSend` / `sendAllReportsGmail`,
  confirming no throw and correct status text.
- **Evidence:** `LOGIC_AUDIT.md` Part 6 §6.1 row 3; `tests/frontend-harness.html`.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-028.

## Revalidation trigger

Any commit touching `js/reports-gmail.js`; the `gmail.send` scope or the
shared Client ID changes; the `pending` descriptor shape changes (breaks
OAuth resume); `_runBulkGmailSend`'s sequential model changes; the raw
MIME encoding changes.

## Handover relationship

`HANDOVER.md` §3 step 4 and §4.2 cover this directly; current as of
2026-09-09. A scope or Client-ID change must update `HANDOVER.md` §4.2 in
the same commit.

## Lifecycle / retention

N/A — code. The `localStorage` sent-log is per-browser, 1-hour cosmetic
only. `Send_Log` retention: `SHEET-011`.

## Next action

none — Closed + Monitored.

## Closure evidence

Record committed for DOC-028; `docs/INDEX.md` `JS-015` → `Closed +
Monitored`, `Last Verified` 2026-09-10, links filled; `EXC-026`..`028`
recorded. No `docs/changes/` record (DOC-028).
