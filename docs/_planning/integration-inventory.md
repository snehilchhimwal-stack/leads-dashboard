# External integration inventory (`DOC-011`)

**Produced:** 2026-09-10, against the codebase at commit `e281f9b`.
**Purpose:** the confirmed list of every third-party / external service
the system talks to, with real call sites — the base for `EXT-XXX`
records (`DOC-033`).
(`DOCUMENTATION_PROJECT_PLAN.md` Phase 1, `DOC-011`.)

---

## `dashboard.html`'s `<head>` — checked, nothing unaccounted for

The only external resources loaded by `dashboard.html` (full list, from
`grep -nE '<script src="https|<link .*href="https' dashboard.html`):

| Line | Resource | Belongs to |
|---|---|---|
| `#L10` | `https://accounts.google.com/gsi/client` (`async defer`) | `EXT-003` — Google Identity Services |
| `#L22` | `https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js` | `EXT-004` — jsPDF |
| `#L23` | `https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js` | `EXT-004` — jspdf-autotable |

**No external `<link>` stylesheet. No analytics, error-reporting, tag
manager, font CDN, or any other third-party `<script>`.** Every `fetch()`
in `js/` targets `www.googleapis.com` (Sheets values API + OAuth
userinfo) or `gmail.googleapis.com` (Gmail send) — i.e. `EXT-001` /
`EXT-002`. Nothing else.

---

## The 4 integrations

| ID | Integration | Runtime(s) | What it's used for | Real call sites |
|---|---|---|---|---|
| **EXT-001** | **Google Sheets API v4** | Browser (REST) + backend (`SpreadsheetApp`) | Every read/write of the one Google Sheet — there is no other datastore | Browser: `sheetsApiValuesGet` (`js/core-sheets-fetch.js:100`, the one GET), `appendSheetRows` / `sheetsApiValuesBatchUpdate` (`js/sheets-writeback.js:65/85`), `clearSlaHistory`'s own `:batchUpdate` (`js/core-filters.js:206`), `fetchMovementLog` (`js/tab-movement.js`), `fetchRmHierarchyForRollup` (`js/tab-repeat-offenders.js`). Backend: `readLeadsTab_` (`EmailInfra.gs:431`), `snapshotOpenLeads_` / `pruneMovementLog_` (`MovementTracker.gs`), `rebuildRmHierarchy` (`RmHierarchy.gs`), and every scheduled emailer transitively. |
| **EXT-002** | **Gmail send** — the dashboard `gmail.send` OAuth grant + `GmailApp` + the Advanced Gmail Service | Browser (REST) + backend | Send region summary emails: on-demand from the signed-in user's Gmail (browser), unattended per region (backend), + threaded 13:00 replies (Advanced Gmail Service) | Browser: `performGmailSend` (`js/reports-gmail.js:270`, the one `POST .../messages/send`), `buildRawEmail` (`:244`), `_runBulkGmailSend` (`:349`). Backend: `sendOneOvernightEmail_` (`OvernightEmailer.gs:299`), `sendThreadedGmailReply_` (`:801`, raw Advanced Gmail Service), `sendOneAllIssuesEmail_` (`AllIssuesEmailer.gs:420`), `notifyOpsAlertGs_` / `notifyLeadSendFailuresGs_` (`EmailInfra.gs:72/94`). `withSendRetry_` (`EmailInfra.gs:239`) wraps every backend send. |
| **EXT-003** | **Google Identity Services / OAuth** — the sign-in gate | Browser only | Obtain the **Sheets** OAuth token (`gateAccessToken`) that authorises every `EXT-001` call; also the OAuth substrate the separate `EXT-002` grant rides (same Client ID, second scope, second `initTokenClient()` call) | `initGateTokenClient` (`js/core-auth.js:39`, `google.accounts.oauth2.initTokenClient`), `gateSignIn` (`:78`), `fetchGateUserEmail` (`:60`, `GET .../oauth2/.../userinfo`), `initAuthGate` (`:122`). GIS library: `dashboard.html:10`. Client ID: `DEFAULT_CLIENT_ID` `js/reports-gmail.js:~42`. |
| **EXT-004** | **jsPDF + jspdf-autotable** (pinned CDN) | Browser only | The single PDF export — Repeat Offenders "Download PDF" | `downloadRepeatOffendersPdf` (`js/repeat-offenders-pdf.js:401`, `new window.jspdf.jsPDF(...)`, `doc.autoTable(...)`, `doc.save(...)`). **Library dependency, no network call** — the PDF is built and downloaded entirely in the browser. CDN tags: `dashboard.html:22-23` (jsPDF 2.5.1, jspdf-autotable 3.8.2). |

### The `EXT-004` distinction (noted explicitly, per `DOC-011`)

`EXT-004` is a **client-side library**, not a live integration: it makes
**no network call at run time**. It is loaded from a CDN once at page
load, then everything (`jsPDF` document assembly, `autoTable` layout,
`save()`) happens locally. It gets an `EXT-` record because it is a
third-party dependency with its own version/CSP/CDN-load concerns, but
its `## Auth mechanism` is "none" and its only failure modes are
CDN-load and sandboxed-viewer-blocks-download.

### OAuth: one Client ID, two grants (noted explicitly, per `DOC-011`)

`EXT-002` and `EXT-003` share **one** Google Cloud OAuth 2.0 Client ID
(`888792607049-4u0ok266girae40pt4o1m74uhn08rg19.apps.googleusercontent.com`,
`HANDOVER.md` §4.2) but request **two different scopes on two separate
`initTokenClient()` calls** — the Sheets sign-in gate (`EXT-003`) and the
`gmail.send` grant (`EXT-002`). Deliberately kept distinct so a user can
browse/read without ever being prompted for send permission
(`CLAUDE.md`, `LOGIC_AUDIT.md` Part 1 §1 layer 2). They are two `EXT-`
records, not one.

---

## Definition of Done check

- **All 4 known integrations are listed with their real call sites** —
  ✅ (the table above, with file:line for each).
- **`dashboard.html`'s `<head>` has been checked for anything not yet
  accounted for** — ✅ (3 external scripts, all mapped to `EXT-003` /
  `EXT-004`; no external CSS, analytics, or other third-party;
  every `js/` `fetch()` host is `*.googleapis.com` → `EXT-001` /
  `EXT-002`).
