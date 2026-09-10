# JS-001 — core-auth.js

| | |
|---|---|
| **Type** | `JS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `js/core-auth.js` (131 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

Nothing in the dashboard reads the Sheet without a Google OAuth token,
and this module is the gate that obtains it. It owns the sign-in
consent flow for the **Sheets** scope (`GATE_SCOPE` = `spreadsheets` +
`userinfo.email`), the single access token every Sheets call in the app
is authorised with (`gateAccessToken`), and the `#authGate` UI that
blocks the rest of the page until consent completes. It is deliberately
separate from the Gmail-send grant (`JS-015`) so a user can browse and
read without ever being asked for send permission.

## Responsibilities

- Initialise the Google Identity Services token client for the Sheets
  scope.
- Run the sign-in flow, hold `gateAccessToken` / `gateTokenExpiresAt` /
  `gateUserEmail`, expose `gateTokenValid()`.
- On successful sign-in, fetch the user's email and kick
  `fetchAndRender()`.
- Wire the `#authGate` button and the one-time Client-ID override input.

## Load order / position

Third in the real `<script src>` order (`core-foundation` →
`core-sheets-fetch` → **core-auth** → …), before every file that makes a
Sheets call. `HANDOVER.md` §2 documents it as one of the first 9; the
real order pair-swaps it with `core-sheets-fetch` vs CLAUDE.md's list
(`LOGIC_AUDIT.md` Part 1 §4a — harmless).

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-001 | `gateTokenValid()` `#L35` | — | bool | reads `gateAccessToken` / `gateTokenExpiresAt` | — | `handleGateSignInClick` (FN-005), `sheetsApiValuesGet` (`JS-009`), `fetchAndRender` (`JS-003`), `core-filters.js` (`JS-004`), `sheets-writeback.js` (`JS-018`), `main.js` | reusable |
| FN-002 | `initGateTokenClient(clientId)` `#L39` | Client ID | token client or `null` | creates the GIS token client | GIS `google.accounts.oauth2` (`EXT-003`) | `gateSignIn` (FN-004), `initAuthGate` (FN-006) | specific |
| FN-003 | `fetchGateUserEmail()` `#L60` | — | sets `gateUserEmail` | one `fetch` to the userinfo endpoint | — | `handleGateSignInClick` (FN-005) | specific |
| FN-004 | `gateSignIn()` `#L78` | — | Promise resolving when a token lands | requests a token, populates `gateAccessToken` / expiry | `initGateTokenClient` (FN-002) | `handleGateSignInClick` (FN-005), programmatic re-auth | reusable |
| FN-005 | `handleGateSignInClick()` `#L109` | click | — | updates the signed-in badge, clears status, calls `fetchAndRender()` | `gateSignIn` (FN-004), `gateTokenValid` (FN-001), `fetchGateUserEmail` (FN-003), `fetchAndRender` (`JS-003`) | `#gateSignInBtn` click (`BTN` on `DASH-001`) | specific |
| FN-006 | `initAuthGate()` `#L122` | — | — | shows/hides the Client-ID row, wires `#gateSignInBtn` | `getGmailClientId` (`JS-015`) | `main.js` (`JS-011`) bootstrap | specific |

## Config constants — `CFG-XXX` sub-table

| ID | Constant | Value | Meaning | Changing it affects |
|---|---|---|---|---|
| CFG-001 | `GATE_SCOPE` `#L27` | `spreadsheets` + `userinfo.email` | the OAuth scopes the sign-in gate requests | every Sheets read/write; `EXT-003` |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-001 | GIS library not loaded / `google.accounts.oauth2` undefined | `initGateTokenClient` returns `null` | sign-in button does nothing; page stays on the gate |
| EXC-002 | consent denied / popup closed | `gateSignIn` Promise never resolves | gate stays; user can retry |
| EXC-003 | token expired mid-session | `gateTokenValid()` returns false; next Sheets call surfaces a 401 (`JS-003` `showError`) | user re-prompted on next action |

## Data lineage

External: Google Identity Services (`EXT-003`) → `gateAccessToken`
(module state, bare `let` `#L30`) → read by name from
`core-sheets-fetch.js:103` and `core-filters.js:215` and used as the
`Authorization: Bearer` on every Sheets call. Nothing persists to a
Sheet.

## Data sources accessed

The Google userinfo endpoint (email), via `EXT-003`. No `SHEET-XXX`.

## Data written / modified

None. Provides the token other modules write *with*.

## Failure / error behaviour

Soft-fails: a missing library or denied consent leaves the page on the
gate with no thrown error to the console beyond GIS's own. A stale token
becomes a background 401 on the next Sheets call, handled by `JS-003`.

## Cross-runtime duplication

None. The Apps Script backend authenticates as itself (script-owned
OAuth), not through this module.

## UI relationships

`#authGate` (the gate panel), `#gateSignInBtn`, `#gateClientIdInput`
(one-time Client-ID override, `localStorage`). All on `DASH-001`'s
top-level actions, not a `TAB-XXX`.

## Architecture relationship

`DASH-001`. Layer 2 (Auth) in `LOGIC_AUDIT.md` Part 1 §1.

## Related documentation

`HANDOVER.md` §3 step 1, §4.2 (the shared Client ID), §4.3;
`LOGIC_AUDIT.md` Part 1 §1 layer 2, §4b; `CLAUDE.md`.

## Relationships

- **Depends On:** `EXT-003` (Google Identity / OAuth), `JS-015`
  (`getGmailClientId` / `setGmailClientId`), `JS-003` (`fetchAndRender`
  on success)
- **Used By:** `JS-009`, `JS-003`, `JS-004`, `JS-018`, `JS-011`,
  `DASH-001`
- **Related:** `JS-015` (the parallel Gmail grant — same Client ID, a
  second `initTokenClient` call, different scope), `EXT-001`

## Source of truth

`js/core-auth.js` at `HEAD`.

## Validation

- **Method:** full read of `js/core-auth.js` at `c82ec67`; function list
  verified by `grep -nE '^(function|async function)'`; cross-check
  `LOGIC_AUDIT.md` Part 1 §4b. `tests/frontend-harness.html` mocks the
  OAuth token pair (`gateAccessToken` / `gateTokenExpiresAt` set via
  bare identifiers) so the rest of the pipeline runs without a real
  grant — this module's own flow is exercised only manually.
- **Evidence:** `LOGIC_AUDIT.md` Part 1 §4b; `js/core-auth.js` source;
  `tests/frontend-harness.html` (token-pair mock).
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-027.

## Revalidation trigger

Any commit touching `js/core-auth.js`; `GATE_SCOPE` changes; the shared
Client ID (`DEFAULT_CLIENT_ID`, `JS-015`) changes; GIS API surface
changes; a new consumer starts reading `gateAccessToken` by name.

## Handover relationship

`HANDOVER.md` §3 step 1 and §4.2 cover this; current as of 2026-09-09. A
scope change or a Client-ID change must update `HANDOVER.md` §4.2 in the
same commit.

## Lifecycle / retention

N/A — code, lives and dies with the repo. The token is in-memory only,
never persisted.

## Next action

none — Closed + Monitored.

## Closure evidence

Record committed for DOC-027; `docs/INDEX.md` `JS-001` → `Closed +
Monitored`, `Last Verified` 2026-09-10, `Depends On` / `Used By` filled;
validation evidence as above. No `docs/changes/` record (DOC-027).
