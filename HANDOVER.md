# Handover — Leads Dashboard

This document is for whoever takes this project over. It explains what the
system is, how the code is organized, exactly which permissions/credentials
are needed and how to get them, and how to run the test suite. It does not
duplicate what the code comments already say in detail — where a file's own
header comment covers something thoroughly, this doc points at it instead of
repeating it.

Written 2026-08-31, updated 2026-09-02 (added the Daily_RM_Issues/Repeat
Offenders subsystem — §9 — and the day's other fixes; see §9 for what's new).
If something below goes stale, fix this file in the same commit that changes
the thing it describes.

---

## 1. What this is

A lead-operations dashboard for Homesfy's first-sale (developer/builder)
real-estate leads, built on top of one Google Sheet. It has two independent
halves that never talk to each other directly — they only share the same
Google Sheet as a data layer:

1. **The dashboard** (`dashboard.html` + `js/*.js`) — a static, client-only
   web page (no server, no build step) hosted on GitHub Pages. A signed-in
   user's browser reads the Sheet directly via the Google Sheets API, renders
   every tab, and can write back to the Sheet (snapshots, follow-up queue,
   SLA history) and send region-summary emails via Gmail — all from that
   browser tab, all requiring a human present.

2. **The Apps Script backend** (`Core.gs`, `SlaEngine.gs`,
   `FollowupEngine.gs`, `EmailInfra.gs`, `MovementTracker.gs`,
   `OvernightEmailer.gs`, `AllIssuesEmailer.gs`, `RmHierarchy.gs`,
   `RmHierarchy.private.gs`, `UnmatchedCommentLogger.gs`, `DailyRmIssueLog.gs`
   — see §9) — a script bound to
   the same Google Sheet, running on Google's own servers on a fixed
   schedule. It exists specifically for the things a static page can't do
   unattended: snapshotting the sheet every 6 hours and sending automatic
   emails at fixed clock times, whether or not anyone has the dashboard open.

Because these are genuinely separate runtimes (browser JS vs. Apps Script),
several pieces of business logic are **intentionally duplicated** — e.g. the
comment-classification keyword rules exist once in `js/core-outcome-engine.js`
(`OUTCOME_RULES`) and once in `FollowupEngine.gs`
(`OUTCOME_RULES_GS_`), because Apps Script cannot `import` a browser file.
Any change to shared logic (SLA rules, comment classification, stage
ordering) must be made **in both places** or the dashboard and the automatic
emails will silently disagree. See §6 for the current list of duplicated
pairs.

---

## 2. Repository layout

Deployed at `github.com/snehilchhimwal-stack/leads-dashboard` (GitHub Pages).
Confirm the Pages source branch/folder under the repo's **Settings → Pages**
— not re-verified in this doc.

| File | Role |
|---|---|
| `dashboard.html` | The page shell: `<style>` block (dark theme), all markup/tab containers, the sign-in gate UI, and `<script src>` tags loading the `js/*.js` files below **in order** (order matters — see §3). |
| `js/core-*.js` (9 files) | Loaded first, in this order: `core-foundation.js` (CONFIG, ISSUE_PRIORITY, IST date helpers) → `core-sheets-fetch.js` (HEADER_ALIASES, the `leads`/`issueLeads`/`filterState` module state, Sheets API v4 read + gviz parsing) → `core-auth.js` (the sign-in gate, `GATE_SCOPE`) → `core-lead-model.js` (stage classifiers + `enrichLead`, the single source of truth for a lead's derived state — SLA flags, stage, funnel position) → `core-collation.js` (multi-RM-copy dedup/collation display) → `core-outcome-engine.js` (comment classification, `OUTCOME_RULES`/`inferOutcome`) → `core-fetch-and-render.js` (`fetchAndRender` itself) → `core-ui.js` (generic UI chrome: `esc`, loading overlay, alert cards) → `core-filters.js` (`applyFiltersAndRender`, the filter-bar UI). Formerly one `js/core.js` file (3,120 lines) — split in the 2026-09 modularity refactor (pure code motion, no logic changed; see git history). Everything else still depends on this whole group exactly as it depended on the single file before — order AMONG the 9 mostly doesn't matter (see `core-foundation.js`'s own header comment for why), but all 9 must load before every other `js/*.js` file below. |
| `js/tab-audit.js` | Audit tab — "when was a lead last touched." |
| `js/tab-tracking.js` | Tracking tab — issue-count-over-time chart, cohort comparison. |
| `js/tab-rmtimeline.js` | RM Timeline tab — per-RM daily calendar and day timeline. |
| `js/tab-movement.js` | Movement tab — reads the `Movement_Log` sheet tab that `MovementTracker.gs` populates; stalled leads, overnight cohort, RM stall leaderboard, time-to-Opportunity. |
| `js/tab-repeat-offenders.js` | Repeat Offenders tab (own top-level tab, added 2026-09-01) — reads the `Daily_RM_Issues` sheet tab that `DailyRmIssueLog.gs` populates nightly; RM/A1-TM/RH/Region leaderboards ranked by Avg Flagged (instances ÷ distinct leads). See §9 for the whole subsystem, including a real Time-range filtering gotcha worth reading before touching this file. |
| `js/tab-morning.js` | Morning Brief tab — 10 summary cards, all backed by data other tabs already compute (no new logic). |
| `js/reports-build.js` / `js/reports-gmail.js` / `js/reports-ui.js` | Formerly one `js/reports.js` file (2,246 lines) — split in the 2026-09 modularity refactor (pure code motion; see git history). `reports-build.js` builds report content (region grouping, email templates); `reports-gmail.js` is the real one-click Gmail-API send flow (separate OAuth grant — see §4); `reports-ui.js` is the mailto flow + all render/copy/download UI, and loads LAST of the three (see its own header comment for why). |
| `js/sheets-writeback.js` | Every write path back to the Sheet: on-demand Movement_Log snapshot, `Lead_Followups`, `SLA_History`, `Daily_Cohort_History`. |
| `js/overview-distribution-people-ops.js` | The main Overview: `renderAll()` orchestrator, tab switching, KPI/trend/RM-score tables, Operations issue lists (the 5 SLA checks), CSV export. |
| `js/main.js` | Loaded last. Just the couple of top-level bootstrap calls that must run after every other file has defined its functions. |
| `Core.gs` | Apps Script shared foundation — row parsing/stage classification, ported from `js/core.js`. Every other `.gs` file depends on it. |
| `SlaEngine.gs` | The 5 SLA rules, ported from `enrichLead` in `js/core.js`. |
| `FollowupEngine.gs` | Comment classification + Suggested Follow-up text, ported from `js/core.js`'s `OUTCOME_RULES`/`inferOutcome`. |
| `EmailInfra.gs` | Shared email plumbing: retry wrappers, the leads-tab reader, region-name mapping, ops alerting, the HTML email template. |
| `MovementTracker.gs` | The 4x/day (00:00/06:00/12:00/18:00 IST) snapshot trigger — writes `Movement_Log` and `SLA_History` rows. |
| `OvernightEmailer.gs` | 10:00 IST daily region email (overnight leads/issues) + 13:00 IST same-thread follow-up showing what got resolved. |
| `AllIssuesEmailer.gs` | 17:00 IST daily email covering all 5 Operations SLA checks for Google Non-UTM/Search leads assigned in the last 3 calendar days. |
| `RmHierarchy.gs` | Resolves each RM's manager chain (A1/TM/RH/CH) from the HR export, so issue emails route to the right specific managers. |
| `RmHierarchy.private.gs` | **Not in git** (see §4.3) — the raw `[name, email]` table `RmHierarchy.gs` looks employees up in. |
| `UnmatchedCommentLogger.gs` | Logs every RM comment the classification keywords fail to match, into `Unmatched_Comments_Log`, for periodic human review. |
| `DailyRmIssueLog.gs` | Nightly (22:50 IST) full-company SLA-issue census — feeds `js/tab-repeat-offenders.js`. Added 2026-09-01. See §9 — this one has real operational quirks (unbounded nightly row growth, a real incident where a run took ~8min and wrote nothing) worth knowing before you're debugging it live. |
| `Tests_*.gs` | The Apps Script mock test suite — see §7. |
| `working files on 28th for automatic email/` | **Not in git**, and not authoritative — a manual backup snapshot of a few `.gs` files from mid-development. The root-level `.gs` files are always the source of truth; this folder is safe to ignore or delete. |
| `design/live-ops-redesign.html` | A standalone visual mockup from an earlier exploration pass — not wired to real data, not part of the live app. |

**Load order matters** for the `<script src>` tags in `dashboard.html`:
`core.js` → `tab-audit.js` → `tab-tracking.js` → `tab-rmtimeline.js` →
`tab-movement.js` → `tab-repeat-offenders.js` → `tab-morning.js` →
`reports.js` → `sheets-writeback.js` → `overview-distribution-people-ops.js` →
`main.js`. These are classic
`<script>` tags (no modules, no bundler) sharing one global scope — a
function or `let`/`const` defined in one file is a bare global every later
file can call directly. If you add a new `js/*.gs` file, add its `<script
src>` tag in the right position (after whatever it depends on, before
`main.js`).

The `.gs` files work the same way inside one Apps Script project: **every
file in an Apps Script project shares one global namespace**, regardless of
filename. The split into `Core.gs`/`SlaEngine.gs`/etc. is purely
organizational (see each file's own header comment) — it has zero effect on
how the code runs. There is no `appsscript.json` checked into this repo; the
authoritative manifest lives inside the Sheet's own bound Apps Script
project (see §4.3).

---

## 3. How the dashboard works (browser side)

1. **Sign-in gate** (`js/core-auth.js`, `#authGate` in `dashboard.html`) — the
   page shows nothing until the user authorizes. Requests `GATE_SCOPE`
   (`.../auth/spreadsheets` + `.../auth/userinfo.email`) via Google
   Identity Services' token client. Nothing loads without this.
2. User pastes/confirms the **Sheet ID or URL** (`#sheetIdInput` — defaults
   to the production sheet, see §4.1) and clicks fetch. `fetchAndRender()`
   pulls the leads tab (a single fixed name, `TAB_NAME_OVERRIDE` in
   `Core.gs` on the Apps Script side / the `#tabNameInput` field in
   `js/core-fetch-and-render.js` on the browser side — currently `leads`;
   earlier versions of this project auto-detected a rotating monthly tab
   name, but the sheet no longer rotates), parses every row through
   `HEADER_ALIASES` (`js/core-sheets-fetch.js`) → `enrichLead()`
   (`js/core-lead-model.js`, called from `applyFiltersAndRender` in
   `js/core-filters.js`), and calls `renderAll()`.
3. `renderAll()` (in `overview-distribution-people-ops.js`) renders **every**
   tab in one pass — tab switching afterward is a pure `display:none` toggle
   on pre-rendered DOM, not a re-render.
4. **Region email reports** (`js/reports-build.js`/`js/reports-gmail.js`/`js/reports-ui.js`) — generates the same report
   content per region as `OvernightEmailer.gs`/`AllIssuesEmailer.gs` build
   automatically, but on demand from the browser. Sending requires a
   **second, separate** OAuth grant (`GMAIL_SCOPE`, `gmail.send` — see
   §4.2) — deliberately kept separate from the read/write Sheets grant so a
   user can browse the dashboard without ever being asked for send
   permission.
5. **Write-back paths** (`js/sheets-writeback.js`) — an on-demand
   Movement_Log snapshot button/auto-checkbox, plus the machinery that
   pushes unresolved issue leads into `Lead_Followups` and appends
   `SLA_History`/`Daily_Cohort_History` rows. All reuse the Sheets-write
   token from step 1 (no separate grant needed).

---

## 4. Permissions & credentials — what's needed, and how to get it

This is the section a new maintainer needs first. There are **four separate
things** that gate this system, and they are not all controlled by the same
person.

### 4.1 Google Sheet access

The data lives in one Google Sheet
(`1QmYB1VqLMisiQXoed6-vSQqgA9nroGIMHsBInZafKGU` — the default baked into
`#sheetIdInput` in `dashboard.html`). Whoever takes this over needs **Editor**
access to that Sheet, from whoever currently owns/shares it — that's the same
access needed to:
- Open **Extensions → Apps Script** on it (where the `.gs` backend actually
  runs — see §4.3), and
- Have the dashboard's write-back paths succeed (a Viewer-only Google account
  can sign in and read the dashboard fine, but every write — snapshot,
  follow-up push, SLA history — will fail with a permissions error).

Regional heads/team leads who only need to *read* the dashboard and generate
(not send) reports can work with Viewer access to the Sheet; anyone expected
to use the write-back buttons or maintain the Apps Script needs Editor.

### 4.2 Google Cloud OAuth Client ID

Both browser-side consent flows — the sign-in gate (§3 step 1) and the Gmail
send grant (§3 step 4) — share **one** OAuth 2.0 Client ID from one Google
Cloud project:

```
888792607049-4u0ok266girae40pt4o1m74uhn08rg19.apps.googleusercontent.com
```

(`DEFAULT_CLIENT_ID` in `js/reports-gmail.js`, line ~42 — also the value the
sign-in gate falls back to via `getGmailClientId()`.) They're deliberately
one Client ID requesting two different scopes on two separate
`initTokenClient()` calls, not two separate apps.

**To get access to this**, you need to be added as a member/editor on the
underlying Google Cloud project in the [Google Cloud
Console](https://console.cloud.google.com/) — ask whoever set this project up
(check the Cloud project's IAM page for current owners) to add your Google
account. From there:
- **APIs & Services → Credentials** — this is where the Client ID above
  lives, and where you'd rotate/regenerate it if it were ever compromised.
- **APIs & Services → OAuth consent screen** — controls which Google
  accounts can even see a consent prompt (internal vs. external/testing
  mode, and the explicit test-user list if it's still in "Testing" publish
  status — an account not on that list will be refused before ever seeing a
  consent screen).
- **Authorized JavaScript origins** on the Client ID's own settings — must
  list the exact origin the dashboard is served from (the GitHub Pages URL).
  If the dashboard is ever moved to a new domain/URL, this must be updated
  or every sign-in will fail.
- **Enabled APIs** — Google Sheets API and Gmail API must both be enabled on
  this Cloud project for the two scopes above to work.

If you ever need a **different** Client ID (e.g. spinning up a project under
new ownership), the only two places to change it are `DEFAULT_CLIENT_ID` in
`js/reports-gmail.js` and telling users to clear/replace their locally-saved one —
each browser also lets a user override it manually via the "one-time setup"
input fields (`#gateClientIdInput`, `#gmailClientIdInput`), stored in that
browser's own `localStorage` under the key `gsl_gmail_client_id`. Changing
the constant does not retroactively update anyone's already-saved override.

### 4.3 Apps Script project (the automated backend)

There is **no CI, no `clasp`, no automated deploy** for the `.gs` files.
The authoritative running copy lives inside the Sheet itself:
**Extensions → Apps Script** (requires Editor access to the Sheet, §4.1).
Deploying a change today is manual: edit the file in this repo, then copy
its full contents over the matching file in the Apps Script editor, save,
and (if you touched anything with a time trigger) re-run that file's
`setupXxx()` function once.

**One file is never in this git repo, on purpose:**
`RmHierarchy.private.gs` (see `.gitignore` and the file's own header) — it
holds a real internal employee-name → email lookup table sourced from an HR
export. It must exist in the Apps Script project alongside every other file
(RM hierarchy routing silently falls back to a generic per-region address
without it — nothing crashes, it just degrades). **Get this file directly
from the outgoing maintainer, out of band from git** (e.g. a direct file
transfer), never by pushing it to GitHub.

**First-run authorization**: the first time any Apps Script function that
touches Gmail/Sheets/Triggers is run from the Apps Script editor (including
the one-time `setupXxx()` calls below), Google will show its own
"this app wants to..." authorization dialog to whichever Google account is
running it. That account must accept it, and must be the account with Editor
access to the Sheet — there's no separate credential to request here, it
rides on the Sheet-editor account's own Google login.

**One-time setup functions** — each installs its own time-based trigger(s),
safe to re-run (each clears its own prior trigger before reinstalling, so
re-running after an edit never leaves a duplicate):

| Run this function... | ...from this file | Installs |
|---|---|---|
| `setupMovementTracking()` | `MovementTracker.gs` | 4 daily triggers at 00:00, 06:00, 12:00, 18:00 IST (`SNAPSHOT_HOURS_`) → `snapshotPeriodic` → snapshot + SLA_History row. Also removes any stale legacy `snapshotEvening` trigger. |
| `setupOvernightEmailer()` | `OvernightEmailer.gs` | Daily triggers at 10:00 IST (`sendOvernightMorningEmails`) and 13:00 IST (`sendOvernightFollowupEmails`, same Gmail thread). Also calls `setupRmHierarchy()` — one run of this sets up `RM_Hierarchy`/`Manager_Directory` sheet tabs too. |
| `setupAllIssuesEmailTrigger()` | `AllIssuesEmailer.gs` | One daily trigger at 17:00 IST (`ALL_ISSUES_RUN_HOUR_`) → `sendAllIssuesEmails`. |
| `setupDailyRmIssueLog()` | `DailyRmIssueLog.gs` | One daily trigger at 22:50 IST → `captureDailyRmIssues`, plus creates the `Daily_RM_Issues` sheet tab. See §9 for what this actually does and its known quirks. |

None of these have a menu/`onOpen()` — they only run from the Apps Script
editor's function dropdown (select the function name, click Run), by a human
with Editor access.

**Config constants a new maintainer will likely need to update** (all are
real people/addresses, hardcoded — update on personnel change):

| Constant | File | Current value | Purpose |
|---|---|---|---|
| `OPS_ALERT_EMAIL_` | `EmailInfra.gs` | `snehil.chhimwal@homesfy.in` | Where ops/failure alerts (e.g. a send failure) go. |
| `CH_LEVEL_EMAIL_` | `EmailInfra.gs` | `ashish.ivlekar@homesfy.in` | Fallback CH-level routing address — used both for a real top-of-org person personally holding a lead, and (since 2026-09-01) as the last-resort backstop when an RM name doesn't resolve anywhere (departed employee, unaliased spelling variant) AND that region has no `Region_Recipients` fallback configured either, so a broken chain still reaches someone instead of the lead being silently dropped. See `resolveRecipientEmailsForRegion_`'s own comment (`EmailInfra.gs`). |
| `ALWAYS_CC_EMAILS_` | `RmHierarchy.gs` | `ashish.kukreja@homesfy.in`, `saurabh.mishra@homesfy.in` | CC'd on every region issue email, regardless of region. |
| `TEST_MODE_OVERRIDE_EMAIL_` | `EmailInfra.gs` | `''` (empty) | Safety valve: if set to a real address, **every** real send (not just tests) redirects there instead of real recipients. Leave empty in production; useful for a live smoke-test without running the mock suite. |

Also worth knowing: **console-only utilities**, callable from the Apps
Script/browser console with no button in the UI (confirmed intentional,
not an oversight) — `downloadNoIssueLeadsNow()` / `debugFollowupStatusNow()`
(`OvernightEmailer.gs`), `debugDailyCohortEvidence()` (`js/tab-tracking.js`).
`clearSlaHistory()` / `backfillSlaHistoryFromMovementLog()`
(`js/core-filters.js` / `js/sheets-writeback.js`) and the equivalent pair
for `Daily_Cohort_History` (`js/sheets-writeback.js`) are no longer
console-only — Tracking → SLA History Maintenance / Daily Cohort History
have real buttons for both now — but both stay callable from the console
too.

### 4.4 GitHub repo access

Push access to `github.com/snehilchhimwal-stack/leads-dashboard` is needed to
change `dashboard.html`/`js/*.js` (the deployed frontend) or to keep this
repo's copies of the `.gs` files in sync with what's actually pasted into the
Apps Script editor. Ask the current repo owner to add the new maintainer as
a collaborator. Verify the GitHub Pages source (branch/folder) under this
repo's **Settings → Pages** — not independently re-confirmed in this
document.

---

## 5. Data the Sheet holds

Beyond the leads tab itself (one fixed tab, named `leads` — see
`TAB_NAME_OVERRIDE` in `Core.gs`), the system reads/writes these tabs:

| Tab | Written by | Read by |
|---|---|---|
| `Movement_Log` | `MovementTracker.gs` (every 6h) + optionally the dashboard's on-demand snapshot | Movement tab, RM Timeline tab, `UnmatchedCommentLogger.gs` |
| `SLA_History` | `MovementTracker.gs` (every 6h) + the dashboard on refresh | Trend/history views |
| `Lead_Followups` | `OvernightEmailer.gs`'s send paths + the dashboard's Operations "Generate" flow | The follow-up email content itself |
| `Daily_Cohort_History` | `js/sheets-writeback.js` | Tracking tab's cohort comparison |
| `Unmatched_Comments_Log` | `UnmatchedCommentLogger.gs` (piggybacks on every `snapshotOpenLeads_` run) | Manual human review — the source for deciding what to add to `OUTCOME_RULES`/`OUTCOME_RULES_GS_` next |
| `RM_Hierarchy`, `Manager_Directory` | `setupRmHierarchy()` (one-time, then manually maintained) | `RmHierarchy.gs`'s recipient routing |
| `Daily_RM_Issues` | `DailyRmIssueLog.gs` (nightly, 22:50 IST) + its own backfill/repair utilities | `js/tab-repeat-offenders.js` (Repeat Offenders tab) — see §9 |

---

## 6. Logic that's duplicated across the two runtimes

Because the browser and Apps Script can't share code, these pairs must be
edited **together**. Each `.gs` file's header comment names exactly which
browser-side construct it ports from (still describing the file as
`js/core.js` in some older comments — that file was later split into the
9 `js/core-*.js` files in §2's table, pure code motion, so the construct
itself hasn't moved logic, just files) — check there before assuming a
one-line fix in one file is complete:

| Concept | Browser | Apps Script |
|---|---|---|
| Row parsing / header aliases | `HEADER_ALIASES` (`js/core-sheets-fetch.js`) | `HEADER_ALIASES_` (`Core.gs`) |
| Stage classification / SLA flags | `enrichLead()` (`js/core-lead-model.js`) | `computeSlaFlags_` (`SlaEngine.gs`) |
| Comment classification | `OUTCOME_RULES` / `inferOutcome` (`js/core-outcome-engine.js`) | `OUTCOME_RULES_GS_` / `inferOutcomeGs_` (`FollowupEngine.gs`) |
| Suggested follow-up text | `FOLLOWUP_SUGGESTIONS` | `FollowupEngine.gs` |

A new comment pattern found via `Unmatched_Comments_Log` (§5) needs a keyword
added to **both** `OUTCOME_RULES` (dashboard) and `OUTCOME_RULES_GS_`
(automatic emails) — adding it to only one means the dashboard and the
automatic emails will classify the same lead differently.

---

## 7. Testing

### 7.1 Apps Script mock test suite (exists today, real, run this before shipping any `.gs` change)

`Tests_Mocks.gs` + one `Tests_<File>.gs` per production file +
`Tests_RunAll.gs`. **Nothing in this suite ever touches your real
spreadsheet or sends a real email** — every run temporarily reassigns the
global `SpreadsheetApp`/`GmailApp`/`Utilities`/`ScriptApp` to in-memory fakes
(`TestMockSpreadsheet_`, `MockGmailApp`, etc.), then restores the real ones
in a `finally` block, same pattern real-world Apps Script testing uses since
there's no official mocking API. See `Tests_Mocks.gs`'s own header for the
full explanation of why this is safe. The only two email addresses that ever
appear anywhere in the suite are `snehil.chhimwal@gmail.com` and
`ashish.ivlekar@homesfy.in` (`TEST_EMAIL_PRIMARY_`/`TEST_EMAIL_CH_`).

**To run it**: open the Sheet's Apps Script editor, make sure all the
`Tests_*.gs` files are pasted in alongside the production files, select
`runAllTests` (in `Tests_RunAll.gs`) from the function dropdown, click Run,
read the pass/fail summary in the execution log (View → Logs, or the
Executions panel). To check just one file after a targeted change, run its
own `run<File>TestsNow()` function instead (e.g. `runMovementTrackerTestsNow`)
— each file re-does its own setup, so file order never matters and one
file's fixtures can't leak into another's.

**When you add or change a `.gs` function**, add or update the matching
assertion in that file's `Tests_*.gs` — this suite is only as good as its
coverage, and past gaps in this project were closed reactively (see git
history around 2026-08-29) specifically because a change shipped without a
matching test.

### 7.2 Dashboard (browser JS) — no persisted suite exists today

There is currently **no permanent, run-anytime test suite** for
`js/*.js`. Verification during development so far has been ad hoc: serve
the repo locally, build a synthetic dataset covering every code path,
invoke the render/compute functions directly in the browser console, and
either eyeball the output or hash-compare it against the same call against
the pre-change version of the file (`git show HEAD:<file>`) to confirm
byte-identical behavior. That approach works but leaves nothing behind for
the next person to just run.

**Recommended first task for whoever takes this over**: build a small
permanent harness for this — a local HTML page that loads the real
`js/*.js` files against a fixed synthetic dataset and asserts on key
outputs, checked into the repo (e.g. `test/dashboard.test.html`), so a JS
change can be verified the same one-command way `runAllTests()` already
verifies the Apps Script side. Not built yet; flagging it here rather than
leaving it undiscoverable.

**Local preview in the meantime**: `dashboard.html` is a static file — any
local static file server pointed at the repo root works
(no build step, no `npm install`). Open it, sign in against a real (or
test) Sheet, and use the browser console directly.

---

## 8. Where to look when something breaks

- **Dashboard shows wrong/missing data, or a write-back fails**: browser
  DevTools console first — `HEADER_ALIASES` mismatches, OAuth scope/consent
  issues, and Sheets API errors all surface there with the actual API error
  text.
- **An automatic email didn't send, or sent to the wrong people**: Apps
  Script editor → **Executions** (left sidebar) — shows every trigger-fired
  run, its logs, and any thrown error, going back further than the
  in-session `Logger.log` output. `notifyOpsAlertGs_`/`OPS_ALERT_EMAIL_`
  (§4.3) should also have already emailed a failure notice for anything that
  threw inside a guarded path.
- **Recipient routing looks wrong** (an issue email went to the wrong
  manager, or fell back to a generic address): check `RM_Hierarchy` /
  `Manager_Directory` sheet tabs for a blank/stale email against that RM's
  actual current manager, and confirm `RmHierarchy.private.gs` is present
  and current in the Apps Script project (§4.3) — a missing or stale entry
  there is the most common cause.
- **A real RM comment produced a generic/wrong Suggested Follow-up**: check
  `Unmatched_Comments_Log` — if the exact phrasing shows up there, the
  keyword engine genuinely doesn't recognize it yet; that's the signal to
  add a rule per §6, not a bug to chase elsewhere.
- **A night's Daily_RM_Issues capture looks missing** (Repeat Offenders shows
  suspiciously little for a day you'd expect data): check Apps Script
  Executions for `captureDailyRmIssues` around 22:50 IST that night — a real
  2026-09-01 incident had it run for ~475s (platform-reported duration) and
  write zero rows, with no crash alert to explain why. If a specific night is
  confirmed missing, run `backfillOneDayFromMovementLogNow('YYYY-MM-DD')`
  (no argument defaults to yesterday) to recover it from Movement_Log — see
  §9.
- **AllIssuesEmailer's 17:00 send looks unusually slow**: check Executions
  for `sendAllIssuesEmails` — as of 2026-09-02 it logs `[timing]` markers
  after each preliminary read, after each region, and a final summary
  (elapsed + bucket count), specifically so a slow run is diagnosable
  without guesswork. A real incident had a normal ~few-minute run balloon to
  ~50 minutes; root cause was `withSendRetry_`'s "Not found" retry (a Gmail
  createDraft()/send() eventual-consistency race) using a rate-limit-sized
  backoff for a millisecond-scale timing issue — since fixed to a flat
  400ms for that specific error (EmailInfra.gs).

---

## 9. Repeat Offenders (the Daily_RM_Issues subsystem)

Added 2026-09-01, iterated heavily that day and the next. This is the
newest, least battle-tested part of the system — read this section before
changing anything under it.

### 9.1 What it is and why

Operations (§1) shows the 5 SLA checks against the CURRENT live sheet —
it can't tell you whether a lead's problem is a one-off or the same lead
breaking rules night after night. `DailyRmIssueLog.gs` exists to answer
that: every night at 22:50 IST, `captureDailyRmIssues` scans **every
currently open lead in the whole company** (deliberately unscoped by
date or region — see its own header comment) and writes one row per
lead currently flagged for any of the 5 SLA checks into `Daily_RM_Issues`.
The dashboard's Repeat Offenders tab (`js/tab-repeat-offenders.js`) reads
that accumulated history and ranks RMs/managers/regions by **Avg
Flagged** (instances ÷ distinct leads) — a lead flagged on 5 different
nights counts as 5 instances against 1 lead, which is exactly the
"keeps coming back" signal the feature is built to surface.

### 9.2 A real scale/reliability gotcha

Because the nightly scan is unscoped, `Daily_RM_Issues` grows by
**tens of thousands of rows per night** (one real capture alone produced
~26,660 rows) — this is by design, not a leak, but it means every
capture run genuinely does a lot of work: a full read of the leads tab,
a full read of `Movement_Log` (the largest sheet in the project), and
one very large write. A real 2026-09-01 incident: that night's
`captureDailyRmIssues` execution ran for ~475s (Executions log) but
wrote **zero rows**, with no crash alert — the leading theory is a
single oversized `setValues()` write failing non-transiently, though
this was never definitively confirmed from the Executions log alone (no
error text was shared). `backfillOneDayFromMovementLogNow()` (below)
exists to recover from exactly this after the fact, and writes in
5,000-row chunks instead of one call, so a future recovery run loses at
most one chunk instead of the whole night.

**2026-09 fix**: `captureDailyRmIssues_` itself (the actual 22:50
trigger, not just the recovery tool) now writes its nightly rows in the
same 5,000-row (`BACKFILL_CHUNK_SIZE_`) chunks, rather than one
unbounded `setValues()` call — so the class of incident above should now
fail (if it ever recurs) at a specific chunk, losing only the rows after
it, not the entire night. Covered by a dedicated test
(`Tests_DailyRmIssueLog.gs`) that runs a 10,037-row capture (2 full
chunks + a partial one) and checks both chunk boundaries for an
off-by-one.

### 9.3 Utility functions (console-callable, `DailyRmIssueLog.gs`)

| Function | What it does |
|---|---|
| `captureDailyRmIssuesNow()` | Runs tonight's capture immediately (same logic the 22:50 trigger runs). Idempotent per IST day — a second run the same day does nothing. |
| `backfillDailyRmIssuesFromMovementLogNow()` | Reconstructs **every** day `Movement_Log` still retains (up to 7 days) that `Daily_RM_Issues` doesn't already have rows for, using each day's latest snapshot as a stand-in for the missed 22:50 capture. One combined write across all days found. |
| `backfillOneDayFromMovementLogNow(dayKey?)` | Added 2026-09-02, in response to the incident in §9.2. Same idea, but scoped to exactly **one** day — no argument defaults to yesterday. Lower blast radius than the multi-day version, and writes in chunks (see §9.2). This is the one to reach for after confirming a specific night is missing. |
| `repairDailyRmIssuesMissingFieldsNow()` | One-off repair for rows written before `TL`/`group_source`/`source_bucket`/`lead_assigned_at` existed in the schema — backfills them from `Movement_Log` by matching `lead_id` and nearest timestamp. Safe to re-run; leaves already-complete rows untouched. |
| `reportRepeatOffenderRmsNow()` | Logs a quick RM leaderboard straight to the Apps Script console — a lighter-weight sanity check than opening the dashboard. |

### 9.4 The Time-range filter's date-basis split (dashboard side) — read before touching `js/tab-repeat-offenders.js`

The Repeat Offenders tab has its own Time range dropdown (Yesterday /
This Week / Last 7 Days / From when history began / Custom range — no
"Today", since capture only happens once, late at night). This dropdown
does **not** use one consistent date field — and that's deliberate,
learned the hard way from two real, contradictory bug reports the same
day:

- **Yesterday / Custom range** match on `leadAssignedDateKey` (the
  lead's own `lead_assigned_at`, not the night it was captured) — fixed
  after a report that "Today" was showing more flagged leads than the
  RM had even been assigned that day. Answers "how many of yesterday's
  newly-assigned leads are already a problem."
- **This Week / Last 7 Days** match on `date` instead (the night the row
  was captured) — reverted back to this after the OPPOSITE report:
  applying the assignment-date rule here made a real, severe repeat
  offender (14 old leads, 60 real instances across the week) collapse to
  1 lead / 6 instances, because a genuine repeat offender's leads are
  almost always OLD — their assignment date is never "this week," even
  while they keep generating fresh instances every night. Answers "how
  much repeat-flagging activity happened in this window, regardless of
  how old the lead is."
- **All-time** applies no date filter at all either way.

If you're tempted to "simplify" this back to one consistent rule,
re-read both bullets above first — each one exists because the other
rule was tried and broke a real, reported case.

### 9.5 `isNotUpdated`'s 48h gate — fixed 2026-09-03

Root-caused via a live data check (real `Daily_RM_Issues` + real `leads`
tab, signed in as an actual user), triggered by a user report that Repeat
Offenders was "not working properly" specifically for the `isNotUpdated`
("Not Updated") issue type.

**What was wrong**: `computeSlaFlags_`/`enrichLead`'s `isNotUpdated` used
to be gated on `isUnder48h` — it stopped firing the instant a lead crossed
48 hours old, even if the lead's CRM stage was STILL literally the text
"Not Updated" (nothing about the lead had changed; the check just went
silent). From then on the lead was only reachable via `stageStuck48h`
("Leads Pending Beyond 48 Hours"), which doesn't distinguish "still
sitting at the CRM's default untouched stage" from any other 48h+-stuck
lead. Measured against the real sheet: of 158 open leads whose stage text
was literally "Not Updated," **64 (40.5%) were past 48h** and had already
fallen out of this check — including one 141 hours old. This also
explains a pattern in `Daily_RM_Issues` history: no lead had ever
accumulated more than 4 nights of `isNotUpdated` instances, because the
gate capped it at ~2 nights before any lead migrated out, no matter how
long it actually sat untouched.

**The fix**: `isNotUpdated` (both `SlaEngine.gs`'s `computeSlaFlags_` and
`js/core-lead-model.js`'s `enrichLead`, kept in sync as always) no longer
checks `isUnder48h`. It now fires purely on "stage text is literally 'not
updated' past grace" OR "never connected past the 10-minute window" —
full stop, regardless of age. `isNotUpdated` and `stageStuck48h` can now
both be true for the same lead at once; `ISSUE_PRIORITY`/`ISSUE_PRIORITY_GS_`
already ranks `isNotUpdated` above `stageStuck48h`, so such a lead is
reported as "Not Updated," not silently absorbed into "Stuck 48h+."

**Real side effect to know about**: `AllIssuesEmailer.gs`/
`OvernightEmailer.gs` pick their reported issue the same priority-order
way, so a lead that used to email as "Stuck 48h+" once past 48h will now
email as "Not Updated" instead if its stage never changed. This is the
intended, requested behavior, not a regression — flag it if anyone asks
why a specific lead's reported issue changed.

Covered by new assertions in `Tests_SlaEngine.gs` (a 76h-old "Not
Updated"-stage lead now asserts both `isNotUpdated` and `stageStuck48h`
true) and verified directly against the real `.gs` source (not a
reimplementation) via a disposable browser harness before commit. Like
every other backend change, **this still needs the usual manual sync into
the live Apps Script project** (§4.3) before it affects the real 22:50 IST
capture or the email digests.
