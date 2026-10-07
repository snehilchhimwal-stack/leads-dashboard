# JS-015 — reports-gmail.js

| | |
|---|---|
| **Type** | `JS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `js/reports-gmail.js` (499 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-10-07 against commit `b9e6c7b` — email audit P11: `performGmailSend` runs a send-safety gate first (`FN-337`; see `## Version / change reference`) |

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
| FN-103 | `performGmailSend(pending)` `#L339` | a `pending` send descriptor (`kind: 'single' | 'bulk'`, report(s), recipients) | resolves on a 200 from Gmail | **the one real `fetch(POST .../messages/send)`**; may re-request the token; on OAuth resume branches on `pending.kind==='bulk'` and calls `_runBulkGmailSend` | `buildRawEmail` (FN-104), `gmailTokenValid` (FN-106), `logEmailSend` (`JS-018`, fire-and-forget) | `sendReportViaGmail` (FN-107), `_runBulkGmailSend` (FN-108) | specific — the send boundary |
| FN-104 | `buildRawEmail(to, cc, subject, body, htmlBody)` `#L250` | recipients + content | a base64url raw MIME string | none | `utf8ToBase64` / `encodeHeaderUtf8` / `toBase64Url` (`#L216`–`#L236`) | FN-103 | reusable |
| FN-105 | `connectGmail()` / `initGmailTokenClient(clientId)` / `saveGmailClientId()` `#L194/#L155/#L210` | — / Client ID | triggers the `gmail.send` grant; persists a Client-ID override | GIS token client for the Gmail scope; `localStorage` write | `getGmailClientId` (FN-106), GIS (`EXT-002`) | `#gmailConnectBtn` (`BTN-006`), `#gmailSaveClientIdBtn` (`BTN-007`) | specific |
| FN-106 | `getGmailClientId` / `setGmailClientId` / `gmailTokenValid` / `updateGmailStatusUI` / `fetchGmailUserEmail` `#L114`–`#L142` | — | Client ID / bool / status UI / user email | `localStorage` read/write; DOM status | — | FN-103, FN-105, `core-auth.js` (`JS-001`) fallback | reusable |
| FN-107 | `sendReportViaGmail(report, btnId)` / `sendRegionReportGmail(idx)` / `sendAllReportGmail(i)` `#L399/#L420/#L424` | a report + button id / an index | initiates a single send | button state changes | `performGmailSend` (FN-103), `recipientsForReport` (`JS-016`) | onclick handlers in generated report HTML | specific |
| FN-108 | `_runBulkGmailSend(reports, btnIdFn, statusElId, confirmText)` / `sendAllReportsGmail(...)` `#L435/#L466` | a report list + UI ids | sends every report **sequentially** (not `Promise.all`) | per-report button + status updates | `performGmailSend` (FN-103) | `#generateAllReportsBtn`-driven bulk send | specific — sequential to reduce Gmail rate-limit risk |
| FN-109 | `loadGmailSentLog` / `markReportSent(subject)` / `gmailSentAt(subject)` / `applyGmailButtonState(btn, subject)` / `applyGmailButtonStatesFor(...)` `#L59`–`#L107` | a subject / a button | reads/writes the 1-hour sent-log; sets button cosmetics | `localStorage` read/write | — | render paths after a send | reusable — **cosmetic only**, not a send guard |
| FN-110 | `initGmailUI()` `#L482` | — | wires the Gmail connect/setup buttons | DOM listeners | FN-105, FN-106 | `reports-ui.js` `initGmailUI` call | specific |
| FN-337 | `prepareGmailSend(report, to, cc)` `#L315` (+ `gmailAddressListProblems` `#L290`, `gmailVisibleText` `#L303`, `GMAIL_ADDRESS_RE` `#L286`, `_alertIfGmailSendBlocked` `#L190`) | a report `{subject, body, html}` + the To and Cc lists | `{msg: {to, cc, subject, body, html}, problems: [...]}` — the exact normalised payload, and why it must not be sent | none (pure) — the CALLER (`performGmailSend`) blocks on a non-empty `problems`: no Gmail API call, no `markReportSent`, no `Send_Log` row, `pending.blockedReason` set, button shows "Blocked ✗" with the reason as its tooltip | — | `performGmailSend` (FN-103) | specific — **added 2026-10-07 (email audit P11 / F19)**; browser twin of `GS-004`'s `prepareOutgoingEmailGs_` (`FN-323`): no/invalid recipient, empty subject/body, all-markup HTML body -> blocked; a CR/LF in the subject is collapsed. Does NOT check lead ids (a browser report carries a count, and a combined report can count zero in its numbered sections) |

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

**Send-safety gate (2026-10-07, email audit P11).** `performGmailSend` first runs `prepareGmailSend` (FN-337). A send it refuses (no/invalid recipient, empty subject or body, an HTML body with no visible text) never reaches the Gmail API, is not marked "Sent", and writes no `Send_Log` row; the function returns `false` and records `pending.blockedReason`. A single send shows "Blocked ✗" (tooltip = the reason) and an alert; a bulk send finishes the rest and reports "n blocked by the safety check" separately from "failed" (a Gmail/HTTP error).

## Cross-runtime duplication

The unattended email path (`OvernightEmailer.gs` / `AllIssuesEmailer.gs`,
`GS-010` / `GS-001`) sends via Apps Script's own Gmail service (and the
Advanced Gmail Service for threaded replies) — a parallel implementation,
not shared code. `TEST_MODE_OVERRIDE_EMAIL_` (`EmailInfra.gs` `#L43`) is
the backend's twin of the `reports-ui.js` `TEST_MODE_OVERRIDE_EMAIL`
footgun (`LOGIC_AUDIT.md` Part 1 §4d / §6).

Since 2026-10-07 the send-safety gate is a second cross-runtime pair: `GMAIL_ADDRESS_RE` / `gmailAddressListProblems` / `gmailVisibleText` / `prepareGmailSend` here vs `EMAIL_ADDRESS_RE_` / `emailAddressListProblemsGs_` / `visibleTextOfHtmlGs_` / `prepareOutgoingEmailGs_` in `EmailInfra.gs` (`GS-004` FN-323). `test/check-runtime-parity.py` diffs the two address regex literals; the functions are kept in parity by hand, backed by the same address and visible-text vectors in `tests/frontend-harness.html` section 2k and `Tests_EmailInfra.gs`.

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

**2026-10-07** (`b9e6c7b`, email audit P11 — `docs/_planning/EMAIL_AUDIT.md` F19): `performGmailSend` (FN-103) runs `prepareGmailSend` (FN-337) before anything else and refuses an unsafe send (see `## Failure / error behaviour`); the bulk loop (FN-108) counts a refused report as "blocked", not "failed", and the single-send paths (FN-107) alert the user. +88 lines (411L -> 499L; anchors re-mapped). `tests/frontend-harness.html` section 2k: 68 assertions (shared address/visible-text vectors; end-to-end with `fetch` stubbed, incl. a bulk run of 2 good + 1 blocked); 15 deliberate regressions each fail a named test. **Live as soon as GitHub Pages deploys the push** (no Apps Script paste).

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
