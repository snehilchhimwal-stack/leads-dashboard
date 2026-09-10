# EXT-002 — Gmail send (dashboard OAuth grant + `GmailApp` + Advanced Gmail Service)

| | |
|---|---|
| **Type** | `EXT-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | Browser: `js/reports-gmail.js` (`performGmailSend`). Backend: `GmailApp` + the Advanced Gmail Service in `OvernightEmailer.gs` / `AllIssuesEmailer.gs` / `EmailInfra.gs`. |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Component / Record** | Active / Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

The region summary emails are sent through Gmail. The dashboard sends
on-demand from the signed-in user's own Gmail (a **separate OAuth
grant** — `gmail.send`), so a manager can send without leaving the page;
the Apps Script backend sends unattended via `GmailApp` and, for
same-thread replies, the raw **Advanced Gmail Service** (because
`GmailThread.reply()` misroutes). This record covers both send paths.

## What it's used for

- **Browser:** one-click send of a generated region report
  (`sendReportViaGmail`) and bulk "send all" (`sendAllReportsGmail`).
- **Backend:** the 10:00 / 13:00 overnight emails (`GS-010`), the 17:00
  all-issues emails (`GS-001`), CH-level rollups, and ops-alert emails
  (`notifyOpsAlertGs_`, `notifyLeadSendFailuresGs_`).

## Called from — `JS-XXX` / `GS-XXX` list

| ID | Which `FN-XXX` | Operation |
|---|---|---|
| `JS-015` | `performGmailSend` (FN-103) | the one real browser `POST .../messages/send` |
| `JS-015` | `_runBulkGmailSend` / `sendAllReportsGmail` (FN-108) | sequential bulk send |
| `JS-018` | `logEmailSend` (FN-130) | logs a send to `Send_Log` (not a send itself) |
| `GS-010` | `sendOneOvernightEmail_` (FN-233), `sendThreadedGmailReply_` (FN-236) | 10:00 send / 13:00 threaded reply (Advanced Gmail Service) |
| `GS-001` | `sendOneAllIssuesEmail_` (FN-176) | 17:00 send |
| `GS-004` | `notifyOpsAlertGs_` / `notifyLeadSendFailuresGs_` (FN-203) | ops alerts |

## API surfaces — `API-XXX` sub-table

| ID | Call pattern | Quota / rate limit | Retry behaviour |
|---|---|---|---|
| API-004 | Browser: `POST gmail.googleapis.com/gmail/v1/users/me/messages/send` with a base64url raw MIME body (`buildRawEmail`, `JS-015` FN-104) | Gmail send quota (per user/day) | **none** — a failure rejects and restores the button (preserving a prior "Sent" state, `JS-015` EXC-027); bulk sends are **sequential** to reduce rate-limit risk |
| API-005 | Backend: `GmailApp.sendEmail(...)` | Apps Script Gmail quota | `withSendRetry_` (`GS-004` FN-196) — backoff, then an ops alert |
| API-006 | Backend: Advanced Gmail Service `Gmail.Users.Messages.send` for a **threaded reply** (`sendThreadedGmailReply_`) | as API-005 | `withSendRetry_` |

## Auth mechanism

- **Browser:** a **second, independent** OAuth grant for the `gmail.send`
  scope, sharing the **one** Client ID (`DEFAULT_CLIENT_ID`, `#L42` in
  `js/reports-gmail.js` — `888792607049-…apps.googleusercontent.com`,
  `HANDOVER.md` §4.2) via a separate `initTokenClient()` call. Kept
  distinct from the Sheets sign-in gate (`EXT-003`) so browsing never
  prompts for send permission. Token = `gmailAccessToken`; a
  `localStorage` Client-ID override is supported.
- **Backend:** the bound Apps Script project's own Gmail authorization
  (sends as the trigger installer). The Advanced Gmail Service must be
  enabled in the project's manifest.

## Known failure modes

| Condition | Result |
|---|---|
| consent denied / popup closed | `performGmailSend` rejects; send does not happen (`JS-015` EXC-026) |
| token expires mid-batch | OAuth resume branches on `pending.kind==='bulk'` and continues (`JS-015` EXC-028 — does not reproduce as a bug) |
| a send fails after one succeeded (bulk) | button restored to its prior **"Sent"** state, not bare "Send" (`JS-015` EXC-027) |
| `GmailThread.reply()` would send to the last sender | worked around by `sendThreadedGmailReply_` via the Advanced Gmail Service (`GS-010` EXC-080) |
| Gmail quota exhausted | backend: `withSendRetry_` then an ops alert; browser: the send fails visibly |
| `TEST_MODE_OVERRIDE_EMAIL` / `_` set | **every** recipient silently redirected — a footgun on both runtimes (`JS-016` CFG-024 / `GS-004` CFG-039) |

## Rate-limit / retry behaviour

Backend: `withSendRetry_` (backoff). Browser: no retry; bulk sends are
deliberately **sequential** (not `Promise.all`) to stay under Gmail's
rate limits (`JS-015` FN-108).

## Permissions / security-sensitive notes

The browser grant lets the page send email **as the signed-in user** —
the most privileged capability in the dashboard. Prohibited-action
policy: this project never asks a user to enter credentials; the OAuth
consent screen handles auth. `Send_Log` (`SHEET-011`) records what the
browser sent; `AllIssues_Log` / `Overnight_Log` record the backend
sends.

## Data lineage

Report objects (`JS-014`) + resolved recipients (`JS-016`
`recipientsForReport`, or `GS-004` `resolveRecipientEmailsForRegion_`) →
raw MIME → this API → an email. Then `Send_Log` / `AllIssues_Log` /
`Overnight_Log`. Full flow: `DATA-005`.

## Exceptions & error handling

See "Known failure modes." Browser rejections restore the UI; backend
failures retry then ops-alert and show as Failed in Executions.

## Architecture relationship

Layer 12 (client Gmail send) + layer 17 (backend automation) in
`LOGIC_AUDIT.md` Part 1 §1.

## Related documentation

`HANDOVER.md` §3 step 4, §4.2, §4.3; `LOGIC_AUDIT.md` Part 1 §1, §4c/§4d,
Part 3 §3.9, Part 6 findings; `CLAUDE.md`.

## Relationships

- **Depends On:** `EXT-003` (shares the one Client ID; the Gmail grant
  is a second scope on it), `JS-014` (report content), `JS-016` /
  `GS-004` (recipients)
- **Used By:** `JS-015`, `JS-018`, `GS-010`, `GS-001`, `GS-004`,
  `TAB-003`, `TAB-007`, `SHEET-011`, `SHEET-013`, `SHEET-014`
- **Related:** `EXT-001` (Sheets — the other Google API)

## Source of truth

`js/reports-gmail.js` `performGmailSend` `#L270`, `buildRawEmail` `#L244`,
`DEFAULT_CLIENT_ID` `~#L42`; `OvernightEmailer.gs` `sendThreadedGmailReply_`
`#L801`; `EmailInfra.gs` `withSendRetry_` `#L239`.

## Validation

- **Method:** call sites enumerated by grep at `c82ec67`; the
  single-Client-ID / two-scope design cross-checked against `HANDOVER.md`
  §4.2; the batch OAuth-resume confirmed working per `LOGIC_AUDIT.md`
  Part 6 §6.1 row 3; the `GmailThread.reply()` workaround confirmed in
  `sendThreadedGmailReply_`. `tests/frontend-harness.html` mocks
  `window.fetch` for `performGmailSend`; `Tests_OvernightEmailer.gs` /
  `Tests_AllIssuesEmailer.gs` mock `GmailApp`.
- **Evidence:** `LOGIC_AUDIT.md` Part 6 §6.1 row 3; `HANDOVER.md` §4.2;
  `.github/workflows/test.yml`; `tests/frontend-harness.html`.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by `DOC-033`.

## Revalidation trigger

The `gmail.send` scope or the shared Client ID changes; the raw MIME
encoding changes; `_runBulkGmailSend`'s sequential model changes; the
Advanced Gmail Service usage changes; `TEST_MODE_OVERRIDE_EMAIL` / `_`
handling changes.

## Handover relationship

`HANDOVER.md` §3 step 4, §4.2 cover this directly. Current as of
2026-09-09. A scope or Client-ID change must update `HANDOVER.md` §4.2 in
the same commit.

## Lifecycle / retention

N/A — an integration. Sends are logged to `SHEET-011` / `SHEET-013` /
`SHEET-014` (their own retention).

## Next action

none — Closed + Monitored. (The `TEST_MODE_OVERRIDE_EMAIL` footgun is a
known `LOGIC_AUDIT.md` finding on `JS-016` / `GS-004`, tracked there.)

## Closure evidence

Record committed for `DOC-033`; `docs/INDEX.md` `EXT-002` → `Closed +
Monitored`, `Last Verified` 2026-09-10, real call-site references
recorded. No `docs/changes/` record (`DOC-033`).
