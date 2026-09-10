# EXT-003 — Google Identity Services / OAuth (the sign-in gate)

| | |
|---|---|
| **Type** | `EXT-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `js/core-auth.js` (`initGateTokenClient`, `gateSignIn`); the GIS CDN script in `dashboard.html`. |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Component / Record** | Active / Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

The dashboard is a static page with no server — it authenticates the
user entirely client-side through **Google Identity Services** (the
`google.accounts.oauth2` token-client flow). This integration is what
produces `gateAccessToken`, the single OAuth token every Sheets API call
in the app is authorised with, and it is the gate that keeps the whole
page hidden until the user consents.

## What it's used for

- Obtain the **Sheets** scope
  (`.../auth/spreadsheets` + `.../auth/userinfo.email`) → `gateAccessToken`.
- Fetch the signed-in user's email (for the "Signed in as …" badge and
  `Send_Log`'s `sent_by`).
- It is also the OAuth substrate the **separate** Gmail-send grant
  (`EXT-002`) rides on — same Client ID, a second `initTokenClient()`
  call for a different scope.

## Called from — `JS-XXX` / `GS-XXX` list

| ID | Which `FN-XXX` | Operation |
|---|---|---|
| `JS-001` | `initGateTokenClient` (FN-002) | create the GIS token client |
| `JS-001` | `gateSignIn` (FN-004) | request a token |
| `JS-001` | `fetchGateUserEmail` (FN-003) | `GET` the userinfo endpoint |
| `JS-001` | `initAuthGate` (FN-006) | wire `#gateSignInBtn`, read a `localStorage` Client-ID override |
| `JS-015` | `initGmailTokenClient` (FN-105) | the parallel Gmail grant on the same Client ID (`EXT-002`) |

## API surfaces — `API-XXX` sub-table

| ID | Call pattern | Quota / rate limit | Retry behaviour |
|---|---|---|---|
| API-007 | `google.accounts.oauth2.initTokenClient({ client_id, scope, callback })` then `.requestAccessToken()` | none material | none — a denied/closed popup simply never resolves; the user retries |
| API-008 | `GET https://www.googleapis.com/oauth2/v3/userinfo` (or equivalent) with the bearer token | trivial | none — a failure just leaves the badge blank |

## Auth mechanism

- **One** OAuth 2.0 Client ID for the whole project
  (`888792607049-4u0ok266girae40pt4o1m74uhn08rg19.apps.googleusercontent.com`,
  `HANDOVER.md` §4.2), from one Google Cloud project. `DEFAULT_CLIENT_ID`
  lives in `js/reports-gmail.js` `~#L42`; the sign-in gate falls back to
  it via `getGmailClientId()`.
- Two scopes requested on **two separate `initTokenClient()` calls**:
  Sheets (here, `EXT-003`) and `gmail.send` (`EXT-002`).
- **Authorized JavaScript origins** on the Client ID must list the exact
  GitHub Pages origin — moving the dashboard's URL breaks every sign-in
  until this is updated (`HANDOVER.md` §4.2).
- The **OAuth consent screen** controls which Google accounts can even
  see a prompt (internal vs external/testing; the test-user list in
  Testing mode).
- Per-browser Client-ID override: `#gateClientIdInput` /
  `#gmailClientIdInput`, stored in `localStorage`.

## Known failure modes

| Condition | Result |
|---|---|
| GIS CDN script not loaded / `google.accounts.oauth2` undefined | `initGateTokenClient` returns `null`; sign-in button inert; page stays on the gate (`JS-001` EXC-001) |
| consent denied / popup closed | `gateSignIn` never resolves; gate stays (`JS-001` EXC-002) |
| account not on the Testing-mode test-user list | Google refuses **before** a consent screen appears (`HANDOVER.md` §4.2) |
| dashboard served from an origin not in "Authorized JavaScript origins" | every sign-in fails |
| token expired mid-session | `gateTokenValid()` false; next Sheets call is a background 401; next user action re-prompts (`JS-001` EXC-003) |

## Rate-limit / retry behaviour

None — token acquisition is interactive and one-shot; the app does not
auto-retry a failed grant.

## Permissions / security-sensitive notes

`gateAccessToken` is held **in memory only** — never persisted, never
sent anywhere but the Sheets/userinfo endpoints. The Client ID is public
(it is in the shipped JS, by design for a browser OAuth client). This
project never handles a password — the consent screen does all auth
(prohibited-action policy).

## Data lineage

GIS → `gateAccessToken` (module state, `JS-001` `#L30`) → the
`Authorization: Bearer` header on every `EXT-001` call. The user's email
→ `gateUserEmail` → the badge + `Send_Log.sent_by`. Nothing persists.

## Exceptions & error handling

See "Known failure modes." All are soft — the page stays on the gate or
re-prompts; there is no crash path.

## Architecture relationship

Layer 2 (Auth) in `LOGIC_AUDIT.md` Part 1 §1 — "Two *independent* OAuth
consent flows sharing one Google Client ID."

## Related documentation

`HANDOVER.md` §3 step 1, §4.2 (the Client ID + Cloud project),
§4.3; `LOGIC_AUDIT.md` Part 1 §1 layer 2, §4b; `CLAUDE.md`.

## Relationships

- **Depends On:** `none` — its real prerequisites (the GIS CDN script in
  `dashboard.html`, the Google Cloud OAuth Client ID + consent-screen
  config) are external, not cataloged components
- **Used By:** `JS-001` (the sign-in gate itself), `JS-004`, `JS-009`,
  `JS-018`, `JS-021`, `JS-022` (every module that reads `gateAccessToken`),
  `EXT-001` (authorises its calls), `EXT-002` (rides the same Client ID)
- **Related:** `EXT-002` (the parallel Gmail grant)

## Source of truth

`js/core-auth.js` (`GATE_SCOPE` `#L27`, `initGateTokenClient` `#L39`,
`gateSignIn` `#L78`); `js/reports-gmail.js` `DEFAULT_CLIENT_ID` `~#L42`.

## Validation

- **Method:** read of `js/core-auth.js` at `c82ec67`; the
  one-Client-ID / two-scope design and the origins/consent-screen
  requirements cross-checked against `HANDOVER.md` §4.2 + `LOGIC_AUDIT.md`
  Part 1 §4b. `tests/frontend-harness.html` **mocks** this grant (sets
  `gateAccessToken` / `gateTokenExpiresAt` via bare identifiers) so the
  rest of the pipeline runs — the grant flow itself is verified
  manually.
- **Evidence:** `HANDOVER.md` §4.2; `LOGIC_AUDIT.md` Part 1 §4b;
  `tests/frontend-harness.html` (mock).
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by `DOC-033`.

## Revalidation trigger

`GATE_SCOPE` changes; the shared Client ID changes; the GIS API surface
changes (`initTokenClient` signature); the dashboard's served origin
changes (needs "Authorized JavaScript origins" updated); the consent
screen moves between Testing/Production.

## Handover relationship

`HANDOVER.md` §3 step 1 and §4.2 cover this directly — §4.2 is the
section a new maintainer needs first. Current as of 2026-09-09. A scope
or Client-ID change must update `HANDOVER.md` §4.2 in the same commit.

## Lifecycle / retention

N/A — an integration. The token is in-memory only, for the browser
session.

## Next action

none — Closed + Monitored.

## Closure evidence

Record committed for `DOC-033`; `docs/INDEX.md` `EXT-003` → `Closed +
Monitored`, `Last Verified` 2026-09-10, real call-site references
recorded. No `docs/changes/` record (`DOC-033`).
