# Handover — Leads Dashboard

This document is for whoever takes this project over. It explains what the
system is, how the code is organized, exactly which permissions/credentials
are needed and how to get them, and how to run the test suite. It does not
duplicate what the code comments already say in detail — where a file's own
header comment covers something thoroughly, this doc points at it instead of
repeating it.

**For a per-component lookup** ("what does this exact file / function / tab
/ Sheet do, what depends on it") see **`docs/INDEX.md`** — the living
component catalog (`DOCUMENTATION_PROJECT_PLAN.md`). This file is the
narrative; `docs/` is the reference; `LOGIC_AUDIT.md` is the frozen
2026-09-07 audit. As of 2026-09-10 the catalog is **built** — every JS
module, `.gs` module, tab, button, Sheet tab, integration, and key data
flow has a record (`docs/INDEX.md` master table); `docs/INDEX.md` →
"Maintaining this catalog" has the guides for keeping it current, and
`docs/_planning/OPEN_ITEMS.md` tracks what the build could not resolve
(including this file's own §9.7 staleness).

Written 2026-08-31, updated 2026-09-29 (§9.7.3, RM Opp-Conversion join).
This file went a full week
(2026-09-02 → 2026-09-09) without a single update despite real
architectural changes landing in that window — the RM Performance
redesign's alias/leadership-exclusion fixes, the region-wise worst-5-RM
breakdown, the OpsChecklistRunner/LeadFollowupsStaleness subsystems, and
the CI-001–CI-005 documentation-coverage check itself — even though the
very next sentence already said not to let that happen. That gap is
exactly what prompted "CONSOLIDATED" (To-Do Dashboard, 2026-09-09): **this
file's own architecture-relevant sections (§1–§3) are the living,
continuously-updated architecture description for this project, until
`docs/RELATIONSHIP_MAP.md` + the component records
(`DOCUMENTATION_PROJECT_PLAN.md` Phase 2/3) exist to take that job over** —
not a full narrative backfill of the missed week (a separate, larger
undertaking, deliberately not attempted in this same pass; see
`CLAUDE.md`'s Testing section and `.github/workflows/test.yml` for the new
CI check that now WARNS when this file goes stale for too long, precisely
because stating the rule alone already proved insufficient once).
If something below goes stale, fix this file in the same commit that
changes the thing it describes.

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
   `RmHierarchy.private.gs`, `UnmatchedCommentLogger.gs`, `DailyRmIssueLog.gs`,
   `OpsChecklistRunner.gs`, `LeadFollowupsStaleness.gs` — 13 production `.gs`
   files; see the §2 table and §9) — a script bound to
   the same Google Sheet, running on Google's own servers on a fixed
   schedule. It exists specifically for the things a static page can't do
   unattended: snapshotting the sheet 4×/day (00:00/06:00/12:00/18:00 IST)
   and sending automatic emails at fixed clock times, whether or not anyone
   has the dashboard open.

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
**Pages source (confirmed 2026-09-10, `t-tf-5ad22d8e4c2e`):** "Deploy from
a branch" — branch **`master`**, folder **`/` (root)**. Evidence: the
auto-generated `pages-build-deployment` workflow (`dynamic/pages/…`, the
branch-deploy signature) runs green on `master`;
`https://snehilchhimwal-stack.github.io/leads-dashboard/dashboard.html`,
`/js/core-foundation.js` and `/HANDOVER.md` all return 200. There is **no
`index.html`** — the entry URL is `…/leads-dashboard/dashboard.html`.

| File | Role |
|---|---|
| `dashboard.html` | The page shell: `<style>` block (dark theme), all markup/tab containers, the sign-in gate UI, and `<script src>` tags loading the `js/*.js` files below **in order** (order matters — see §3). |
| `js/core-*.js` (9 load first; 10 exist) | Loaded first, in this order: `core-foundation.js` (CONFIG, ISSUE_PRIORITY, IST date helpers) → `core-sheets-fetch.js` (HEADER_ALIASES, the `leads`/`issueLeads`/`filterState` module state, Sheets API v4 read + gviz parsing) → `core-auth.js` (the sign-in gate, `GATE_SCOPE`) → `core-lead-model.js` (stage classifiers + `enrichLead`, the single source of truth for a lead's derived state — SLA flags, stage, funnel position) → `core-collation.js` (multi-RM-copy dedup/collation display) → `core-outcome-engine.js` (comment classification, `OUTCOME_RULES`/`inferOutcome`) → `core-fetch-and-render.js` (`fetchAndRender` itself) → `core-ui.js` (generic UI chrome: `esc`, loading overlay, alert cards) → `core-filters.js` (`applyFiltersAndRender`, the filter-bar UI). Formerly one `js/core.js` file (3,120 lines) — split in the 2026-09 modularity refactor (pure code motion, no logic changed; see git history). Everything else still depends on this whole group exactly as it depended on the single file before — order AMONG the 9 mostly doesn't matter (see `core-foundation.js`'s own header comment for why), but all 9 must load before every other `js/*.js` file below. A 10th `core-*.js` file, `core-rm-performance.js`, loads *later* — interleaved among the tab files at position 16 of 24 — which is harmless because nothing at parse time calls into it. |
| `js/tab-audit.js` | Audit tab — "when was a lead last touched." |
| `js/tab-tracking.js` | Tracking tab — issue-count-over-time chart, cohort comparison. |
| `js/tab-oppmonitor.js` | Opp Monitor tab (added 2026-09-18) — Google Non-UTM/Search Same-day/48h Opp% workflow: a 12-step checklist + Period/Month results tables reading two externally-populated Sheet tabs (`Opp_Monitor_Period`/`Month`, no writer in this codebase). As of 2026-09-21 also computes the same metrics LIVE from `leads`' new `opp_at` column for any slot without an official row yet (tagged "Live", never overriding a real one) — see `TAB-009`/`JS-025`. The one tab hiding the shared filter bar. |
| `js/tab-rmtimeline.js` | RM Timeline tab — per-RM daily calendar and day timeline. |
| `js/tab-movement.js` | Movement tab — reads the `Movement_Log` sheet tab that `MovementTracker.gs` populates; stalled leads, overnight cohort, RM stall leaderboard, time-to-Opportunity. |
| `js/tab-repeat-offenders.js` | Repeat Offenders tab (own top-level tab, added 2026-09-01) — reads the `Daily_RM_Issues` sheet tab that `DailyRmIssueLog.gs` populates nightly; RM/A1-TM/RH/Region leaderboards ranked by the empirical-Bayes composite RM-performance score (`computeRmPerformance`, `js/core-rm-performance.js`), which **replaced** the old "Avg Flagged" ratio in the §9.7 redesign. See §9 for the whole subsystem, including a real Time-range filtering gotcha worth reading before touching this file. |
| `js/tab-morning.js` | Morning Brief tab — 10 summary cards, all backed by data other tabs already compute (no new logic). **Since 2026-10-03:** the tab button is removed from `#tabBar` (`dashboard.html`) at the user's request ("not really useful") — the panel, render function, and checkpoint re-calls are all untouched and still run harmlessly into a DOM node nobody can navigate to; see `TAB-001`. |
| `js/reports-build.js` / `js/reports-gmail.js` / `js/reports-ui.js` | Formerly one `js/reports.js` file (2,246 lines) — split in the 2026-09 modularity refactor (pure code motion; see git history). `reports-build.js` builds report content (region grouping, email templates); `reports-gmail.js` is the real one-click Gmail-API send flow (separate OAuth grant — see §4); `reports-ui.js` is the mailto flow + all render/copy/download UI, and loads LAST of the three (see its own header comment for why). |
| `js/sheets-writeback.js` | Every write path back to the Sheet: on-demand Movement_Log snapshot, `Lead_Followups`, `SLA_History`, `Daily_Cohort_History`, and (added 2026-10-03, dead-code-audit follow-up Part 3) `Feature_Usage` — per-tab client-side usage tracking (`recordComponentUsage`), read by `OpsChecklistRunner.gs`'s weekly stale-component check (Part 4, below). |
| `js/overview-distribution-people-ops.js` | The main Overview: `renderAll()` orchestrator, tab switching, KPI/trend/RM-score tables, Operations issue lists (the 5 SLA checks), CSV export. |
| `js/main.js` | Loaded last. Just the couple of top-level bootstrap calls that must run after every other file has defined its functions. |
| `Core.gs` | Apps Script shared foundation — row parsing/stage classification, ported from `js/core.js`. Every other `.gs` file depends on it. |
| `SlaEngine.gs` | The 5 SLA rules, ported from `enrichLead` in `js/core.js`. |
| `FollowupEngine.gs` | Comment classification + Suggested Follow-up text, ported from `js/core.js`'s `OUTCOME_RULES`/`inferOutcome`. |
| `EmailInfra.gs` | Shared email plumbing: retry wrappers, the leads-tab reader, region-name mapping, ops alerting, the HTML email template. |
| `MovementTracker.gs` | The 4x/day (00:00/06:00/12:00/18:00 IST) snapshot trigger — writes `Movement_Log` and `SLA_History` rows. |
| `OvernightEmailer.gs` | **Since 2026-09-24 (two-checkpoint email lifecycle redesign — full design: `docs/_planning/EMAIL_LIFECYCLE_TWO_CHECKPOINT_REDESIGN.md`):** the 10:00 IST and 13:00 IST sends are each now a COMBINED email — Section 1 is the original overnight-leads / still-unresolved content (unchanged logic), Section 2 is a follow-up on yesterday's 17:00 `AllIssues_Log` report (`AllIssuesEmailer.gs`): "Checkpoint 1" at 10:00, "Checkpoint 2" (incremental vs Checkpoint 1) at 13:00, both riding the SAME Gmail thread as Section 1 rather than a separate reply chain. `sendOneOvernightEmail_` (the pre-redesign standalone send) still exists and still works, just no longer called by the live send loop — `sendCombinedMorningEmail_`/`sendCombinedFollowupEmail_` are the real entry points now. **Since 2026-09-26 ("no email for resolved status"):** Section 2 lists ONLY leads still unresolved (a lead that resolved is never listed, even the moment it resolves), and a bucket with nothing unresolved in either section gets no email at all — its `checkpoint1_json`/`checkpoint2_json` is still recorded so the row is not re-checked, but `Overnight_Log` gets no row at 10:00 and `followup_sent_at` stays blank at 13:00 (it records a send). The one rule lives in `allIssuesCheckpointIsActiveGs_` (`SlaEngine.gs`). |
| `AllIssuesEmailer.gs` | 17:00 IST daily email covering all 5 Operations SLA checks for Google Non-UTM/Search leads assigned in the last 3 calendar days. **Since 2026-09-24:** also persists a JSON snapshot of what it sent (`issue_snapshot_json`, `AllIssues_Log`) — the state `OvernightEmailer.gs`'s two checkpoints above compare against. |
| `RmHierarchy.gs` | Resolves each RM's manager chain (A1/TM/RH/CH) from the HR export, so issue emails route to the right specific managers. |
| `RmHierarchy.private.gs` | **Not in git** (see §4.3) — the raw `[name, email]` table `RmHierarchy.gs` looks employees up in. |
| `UnmatchedCommentLogger.gs` | Logs every RM comment the classification keywords fail to match, into `Unmatched_Comments_Log`, for periodic human review. Since 2026-09-29 also age-prunes (30 days, regardless of review status) alongside the pre-existing manual `clearReviewedUnmatchedCommentsNow()`. |
| `InteractionHistoryLogger.gs` | Logs every open lead's genuinely NEW owner-logged comment (any outcome) into `Comment_History` — a forward-capture interaction-history dataset, no dashboard reader. Since 2026-09-29 age-prunes at 30 days (was unbounded-by-design before that). |
| `DailyRmIssueLog.gs` | Nightly (22:50 IST) full-company SLA-issue census — feeds `js/tab-repeat-offenders.js`. Added 2026-09-01. See §9 — this one has real operational quirks (unbounded nightly row growth, a real incident where a run took ~8min and wrote nothing) worth knowing before you're debugging it live. |
| `OpsChecklistRunner.gs` | Weekly (Monday ~9am IST) automated summary email — 5 of `OPS_CHECKLIST.md`'s periodic checks reduced to a pass/fail an unattended script can judge: RM-hierarchy gaps, `Manager_Directory` email gaps, `Movement_Log` freshness, the workbook's shared 10M-cell budget (added 2026-09-28), and (added 2026-10-03, dead-code-audit follow-up Part 4) a 30-day stale-dashboard-tab check against `Feature_Usage` (written by `js/sheets-writeback.js`'s Part 3 client-side usage tracking) — a tab the browser side has never recorded a visit to is reported separately as "too early to tell" until `Feature_Usage` itself has existed for 30+ days, then promoted into the same flagged bucket (see `GS-009`'s own doc record / `checkStaleComponents_`'s header comment for why). Sends EVERY week, issues or not, on purpose (see §8). Added 2026-09-09. |
| `LeadFollowupsStaleness.gs` | One-time conditional-formatting setup — highlights any `Lead_Followups` row amber/red once its `updated_at` (column G) is 12h/24h old, so a person directly opening the sheet (the actual surface of the lead 2229674 incident) can't miss a stale row. See `LEAD_FOLLOWUPS_STALENESS.md`. No trigger — applies immediately when run. Added 2026-09-09. |
| `Tests_*.gs` | The Apps Script mock test suite — see §7. |
| `working files on 28th for automatic email/` | **Not in git**, and not authoritative — a manual backup snapshot of a few `.gs` files from mid-development. The root-level `.gs` files are always the source of truth; this folder is safe to ignore or delete. |
| `design/live-ops-redesign.html` | A standalone visual mockup from an earlier exploration pass — not wired to real data, not part of the live app. |

**Load order matters** for the `<script src>` tags in `dashboard.html`.
The real order (24 `<script src>` tags as of 2026-09-21, one more than the
23 this section stated from 2026-09-18 through 2026-09-20 — a new tab file
was added `TAB-XXX`-side but this list was never updated for it, exactly
the kind of drift `test/check-catalog.py` check O only partially catches,
since it samples rather than fully diffing) is: the **9 `core-*.js`
files** in the order listed above → `tab-audit.js` → `tab-tracking.js` →
`tab-oppmonitor.js` → `tab-rmtimeline.js` → `tab-movement.js` →
`tab-repeat-offenders.js` →
`core-rm-performance.js` → `repeat-offenders-pdf.js` → `tab-morning.js` →
`reports-build.js` → `reports-gmail.js` → `reports-ui.js` →
`sheets-writeback.js` → `overview-distribution-people-ops.js` → `main.js`.
(A 25th file, `js/rm-performance-worker.js`, is not a `<script>` tag —
`tab-repeat-offenders.js` loads it with `new Worker()`.) Read
`dashboard.html`'s own tag list as the authority. These are classic
`<script>` tags (no modules, no bundler) sharing one global scope — a
function or `let`/`const` defined in one file is a bare global every later
file can call directly. If you add a new `js/*.js` file, add its
`<script src>` tag in the right position (after whatever it depends on,
before `main.js`) **and update this list in the same commit** — it's a
prose description with nothing mechanically checking it stays accurate
beyond `check-catalog.py`'s check O sample.

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
| `setupMovementTracking()` | `MovementTracker.gs` | 4 daily triggers at 00:00, 06:00, 12:00, 18:00 IST (`SNAPSHOT_HOURS_`) → `snapshotPeriodic` → snapshot + SLA_History row (core capture first, optional phases inside an 840 s budget, run record watched by `emailJobWatchdog` - §4.3.4 P16). Also removes any stale legacy `snapshotEvening` trigger. |
| `setupOvernightEmailer()` | `OvernightEmailer.gs` | Daily triggers at 10:00 IST (`sendOvernightMorningEmails`) and 13:00 IST (`sendOvernightFollowupEmails`, same Gmail thread). **Since 2026-09-24:** each of these is now a combined send — Section 1 (unchanged) + Section 2 (a Checkpoint on yesterday's 17:00 `AllIssuesEmailer.gs` report — see §2's own row for the full picture). Also calls `setupRmHierarchy()` — one run of this sets up `RM_Hierarchy`/`Manager_Directory` sheet tabs too. |
| `setupAllIssuesEmailTrigger()` | `AllIssuesEmailer.gs` | One daily trigger at 17:00 IST (`ALL_ISSUES_RUN_HOUR_`) → `sendAllIssuesEmails`. |
| `setupEmailJobWatchdogTrigger()` | `EmailInfra.gs` | **Added 2026-10-05 (email audit P9).** ONE hourly trigger → `emailJobWatchdog`, which alerts `OPS_ALERT_EMAIL_` when a 10:00 / 13:00 / 17:00 email job did not run, did not finish, or failed (§4.3.4, P9). Run it once after pasting `EmailInfra.gs`. |
| `setupDailyRmIssueLog()` | `DailyRmIssueLog.gs` | One daily trigger at 22:50 IST → `captureDailyRmIssues`, plus creates the `Daily_RM_Issues` sheet tab. See §9 for what this actually does and its known quirks. |
| `setupWeeklyOpsChecklistTrigger()` | `OpsChecklistRunner.gs` | One weekly trigger, Monday ~9:00 IST → `runWeeklyOpsChecklistNow`, emailing `OPS_ALERT_EMAIL_` a summary of `OPS_CHECKLIST.md`'s 5 automatable checks (added 2026-10-03: a 30-day stale-dashboard-tab check against `Feature_Usage`). Sends every week regardless of outcome — see §8. |
| `setupRmHierarchy()` | `RmHierarchy.gs` | **No trigger** — creates the `RM_Hierarchy` / `Manager_Directory` sheet tabs and seeds them from `RM_HIERARCHY_RAW_` / `RmHierarchy.private.gs`. Called as a side-effect of `setupOvernightEmailer()`, but also separately runnable to (re)build just those two tabs (`GS-011`). **Since 2026-10-01:** `rebuildRmHierarchy()` (the function this calls under the hood when re-run) now automatically runs `auditUnresolvedRms_`/`auditManagerDirectoryEmailGaps_` at the end of every rebuild and logs the result — see §4.3.2. |
| `setupLeadFollowupsStalenessFormatting()` | `LeadFollowupsStaleness.gs` | **No trigger** — applies the amber/red conditional formatting to `Lead_Followups` (a row 12h/24h stale on its `updated_at` column). Runs immediately; re-run only if the rule changes (`GS-007`, `LEAD_FOLLOWUPS_STALENESS.md`). |

The **full, source-verified trigger set** (schedules, handlers, timezone
pins) is `docs/architecture/apps-script-triggers.md`.

None of these have a menu/`onOpen()` — they only run from the Apps Script
editor's function dropdown (select the function name, click Run), by a human
with Editor access.

**Config constants a new maintainer will likely need to update** (these are
real people — update on personnel change). **Since 2026-10-07 (email audit P13)
the repository holds only each role's NAME; the address is looked up from the
git-ignored `RmHierarchy.private.gs` employee table at run time** (the repo is
public). A personnel change is therefore two edits: the name constant here (or
`LEADERSHIP_NAMES_` in `RmHierarchy.gs`), and a row for that person in
`RmHierarchy.private.gs`. After any paste, run **`showEmailConfigNow()`** — it
logs where each address comes from and lists anything unresolved (the hourly
watchdog alerts about the same thing once a day):

| Constant | File | Current value | Purpose |
|---|---|---|---|
| `OPS_ALERT_EMAIL_` (blank) / `OPS_ALERT_NAME_` | `EmailInfra.gs` | name `Snehil Chhimwal` — address from the private table; the variable is blank in the repo and only a test/override | Where ops/failure alerts (e.g. a send failure) go. Read via `opsAlertEmailGs_()`. If the private table has no row for that name, alerts fall back to the workbook owner (and the watchdog says so). |
| `CH_LEVEL_EMAIL_` (blank) / `CH_LEVEL_NAME_` | `EmailInfra.gs` | name `Ashish Ivlekar` — address from the private table (read via `chLevelEmailGs_()`; falls back to the ops address if absent) | Fallback CH-level routing address — used both for a real top-of-org person personally holding a lead, and (since 2026-09-01) as the last-resort backstop when an RM name doesn't resolve anywhere (departed employee, unaliased spelling variant) AND that region has no `Region_Recipients` fallback configured either, so a broken chain still reaches someone instead of the lead being silently dropped. See `resolveRecipientEmailsForRegion_`'s own comment (`EmailInfra.gs`). |
| `ALWAYS_CC_EMAILS_` (null) / `LEADERSHIP_NAMES_` | `RmHierarchy.gs` | names `Ashish Kukreja`, `Saurabh Mishra` — addresses from the private table (read via `alwaysCcEmailsGs_()`; a name with no row is skipped, not blanked) | CC'd on every region issue email, regardless of region — **except** the `CH_LEVEL_EMAIL_` backstop above when NEITHER `RM_Hierarchy` nor `Region_Recipients` resolves an RM at all (fixed 2026-09-24, real production case — see `EmailInfra.gs`'s own comment on `resolveRecipientEmailsForRegion_`): that specific "couldn't route this at all" email deliberately excludes leadership, matching the sibling CH-level-personally-holds-a-lead backstop's own long-standing rule. |
| `FUTWORK_ROUTE_EMAIL_` (blank) / `FUTWORK_ROUTE_NAME_` | `EmailInfra.gs` | name `Snehil Chhimwal` — address from the private table (read via `futworkRouteEmailGs_()`; falls back to the ops address if absent) | The ONLY recipient for any RM whose name contains "Futwork" (tele-calling vendor agents, added 2026-09-25) — ONE `Futwork` email per job across ALL regions (each region a separate band, every region spelled out at the top and in the subject), no Cc, bypassing `RM_Hierarchy`, `Region_Recipients`, the `CH_LEVEL_EMAIL_` backstop and `ALWAYS_CC_EMAILS_`. Applied inside `resolveRecipientEmailsForRegion_`, so both the 17:00 and 10:00 emails inherit it. |
| `REGION_PNL_HEAD_CC_` | `EmailInfra.gs` | `{ Hyderabad, Bangalore } -> 'Mukesh Mishra'; { Thane, 'Navi Mumbai' } -> 'Shitij Kaushal'` (NAMES, not addresses) | The P&L head Cc'd on every automatic email for that region (added 2026-09-26 for Hyderabad/Bangalore, extended 2026-09-30 to Thane/Navi Mumbai, from the HR export's P&L column). The address is looked up by name in Manager_Directory at send time (this repo is public, so no address is committed) - if Manager_Directory has no address for the name, no Cc is added and a line is logged. Applied where `resolveRecipientEmailsForRegion_` builds each bucket's Cc, so the 17:00, 10:00 and 13:00 emails all carry it; the 10:00 Section-2-only and 13:00 sends reuse the Cc STORED at 17:00 / 10:00, so a NEW region reaches them from the next 17:00 run. Not applied to the CH-level backstop or the Futwork email. |
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
too. `removeEarlyCorruptedMovementLogDataNow()` (`MovementTracker.gs`,
added 2026-09-17) is a one-time cleanup for the Sep 2026 `Movement_Log`
data-loss incident (see §8) — backs up only the rows about to be removed,
as a Drive CSV file (`Movement_Log_removed_rows_<timestamp>.csv`), then
drops every row snapshotted before 12 Sep 2026 IST. Deliberately **not**
a full-sheet duplicate: `sheet.copyTo()` throws `"This operation is not
supported"` on a sheet this large, and a plain-values full duplicate then
throws `"This action would increase the number of cells in the workbook
above the limit of 10000000 cells"` — both because any full duplicate of
a ~100k-row sheet competes for the same finite per-workbook cell budget
the live data already needs room in. Safe to re-run; not wired to any
trigger or button on purpose — it's remediation for one specific
incident, not standing functionality.

**The full-sheet-duplicate bug above was real, not hypothetical** — the
FIRST version of this function (`9413f6a`, 2026-09-17 ~11:15 IST) shipped
with exactly that full-sheet-duplicate backup, was run live, and did push
the workbook toward its cell ceiling; fixed 20 minutes later (`834d7ea`).
The fix landed same-day, but the one backup tab the buggy version had
already created (`Movement_Log_backup_2026-09-17_1115`) was never
deleted — it sat costing 2,860,000 cells (29% of the workbook) for 11
days until the cell-budget diagnostic (§9.3, below) found it 2026-09-28.
Removed by the one-off `removeStaleMovementLogBackupTabNow()`
(`MovementTracker.gs`), same archive-then-delete discipline, once
confirmed via direct read that the tab genuinely held nothing but that
one incident's duplicate data and nothing in this project ever reads it.

**Which `.gs` files are actually live (2026-09-25).** Nothing in git records
what has been pasted into the editor, so `docs/STALENESS_TRACKER.md` carries
a per-file **deploy register** (last commit confirmed pasted, and when).
`python3 test/check-staleness.py` compares it against `git log` and flags any
`.gs` commit newer than its confirmed paste as PENDING. Refresh the register
by reading the live editor directly (`python3 test/match-live-gs.py`, hashes
taken in Chrome — procedure in the tracker) rather than from memory. **The live
project is the "Dashboard Google Leads" one owned by Sakshi Sonawane**; two
identically named projects under Snehil's own account are stale 2026-09-12
copies, so pasting into them changes nothing. The same tracker and script also catch drifted
`#Lnn` anchors in `docs/` records, stale stated facts in `CLAUDE.md`/this file,
and overdue recurring chores; the recurring `[Stale Sweep]` To-Do tasks
(1st/11th/21st of each month) work through it.

### 4.3.1 Standing Drive-CSV archival (2026-09-21) — every prune, not just a one-off

`archiveRowsToDriveCsv_` (`Core.gs`) generalizes
`removeEarlyCorruptedMovementLogDataNow`'s one-off backup pattern above into
something both `pruneMovementLog_` (`MovementTracker.gs`) and
`pruneDailyRmIssueLog_` (`DailyRmIssueLog.gs`) now call automatically, every
single time either function actually drops rows past its retention window —
not a manual/one-time thing. Everything lands in ONE shared Drive folder,
**"Leads Dashboard Archive"** (`ARCHIVE_ROOT_FOLDER_`, created on first use,
in whichever Google account owns the nightly trigger — i.e. whoever last ran
`setupMovementTracking()`/`setupDailyRmIssueLog()`), with a subfolder per
table (`Movement_Log`, `Daily_RM_Issues`). Each archived file's name encodes
the ACTUAL row-date range it covers, not just when the archive ran — e.g.
`Movement_Log_rows_2026-09-01_to_2026-09-07_archived_2026-09-21_225003.csv`
— so what's inside is readable without opening the file. A single
append-only ledger, `archive_log.csv`, sits in the root folder itself
(`archived_at,table,filename,row_date_range,row_count` — one line per
archive event across BOTH tables) as one place to see the full archive
history without browsing subfolders. Every archive also logs its Drive URL
via `Logger.log`, visible in that run's execution log.

Same zero-cell-cost reasoning as the one-off version: a Drive file's size
has nothing to do with the workbook's 10,000,000-cell ceiling, so this turns
"7 days retained in-workbook" into "kept indefinitely, just not counted
against that ceiling." Reading it back is a script job (parse the relevant
CSV, or check `archive_log.csv` first to find which file covers a given
date), not a live formula/filter — this is a cold archive, not a second live
table. No new trigger or setup function needed; it rides inside the two
prune functions' existing nightly call sites.

### 4.3.2 RM_Hierarchy rebuild now self-audits for coverage gaps (2026-10-01)

**Why:** `OPS_CHECKLIST.md`'s "RM hierarchy routing" section has always said
to run `auditUnresolvedRmsNow()` and `auditManagerDirectoryEmailGapsNow()`
"immediately after any RM-roster or org-chart change" — but that was a
manual reminder, easy to skip, and nothing enforced it. Real incident: the
2026-10-01 Pre Sales team (Manisha rathod, Rajesh Muni, Jagruti Borude,
Nishant Lambe, Shivani Pathak, Suresh Rajoriya, Priya Chaubey) had 25-498
real leads each — a meaningful share genuinely `google`/Non-UTM/Search, so
a real `AllIssuesEmailer.gs`/`OvernightEmailer.gs` send WOULD have hit
them — with literally no `RM_Hierarchy` row at all, for an unknown stretch
of time before this was found by hand while investigating an unrelated
"wrong manager shown in an email" report. Both audit functions already
existed and would have caught this instantly; nobody had separately run
either one since this team started appearing in the `leads` tab.

**Fix:** `rebuildRmHierarchy()` (`RmHierarchy.gs`) now calls a new
`logPostRebuildCoverageAudit_(ss)` at the end of every rebuild — it runs
`auditUnresolvedRms_` and `auditManagerDirectoryEmailGaps_` (the SAME
tested functions the standalone `*Now()` wrappers call, not a
reimplementation) and logs a plain "COVERAGE GAP: ..." or "Coverage
check: all clear" line either way, same "always report, don't wait for a
threshold" philosophy `OpsChecklistRunner.gs`'s weekly email already uses
(a missing report is itself the alarm). Each half is independently
try/caught — `rebuildRmHierarchy()` has already finished writing the sheet
by the time this runs, so a transient read problem on `leads` or
`Manager_Directory` logs a note instead of making the rebuild itself look
like it failed. Net effect: **any session (human or Claude) that adds,
removes, or re-points a row in `RM_HIERARCHY_RAW_` and then runs
`rebuildRmHierarchy()` — which is the normal way to apply that change —
automatically sees the coverage report in the same execution log, with no
separate step to remember.** `OPS_CHECKLIST.md`'s two checklist items stay
listed (they're still useful to run standalone, anytime, not just after a
rebuild) but now note this automatic side-effect.

### 4.3.3 Per-manager cc overrides — restricted cc + loan-team routing (2026-10-01 / 2026-10-03)

**Why:** Two routing requests, both from the user directly, both scoped to
the SAME place — `resolveRecipientBucketsForRms_`'s final per-bucket cc
step (`RmHierarchy.gs`) — rather than the Rajesh Muni/Manisha rathod CC
restriction and the loan-team routing change feeling unrelated enough to
scatter across the file.

**Restricted cc (`c80fabc`, 2026-10-01):** Rajesh Muni and Manisha
rathod's (the Pre Sales team leads, §4.3.2 above) issue emails must cc
ONLY Snehil Chhimwal — never the standing leadership cc
(`ALWAYS_CC_EMAILS_`, Ashish Kukreja/Saurabh Mishra) or anything else
their own chain would otherwise pull in. `RESTRICTED_CC_PRIMARY_NAMES_`
(`GS-011` CFG-080) is checked by name against the resolved bucket's own
key; when it matches, `ccSet` is hard-replaced with just Snehil's looked-up
email — a replacement, not a conditional skip of `ALWAYS_CC_EMAILS_`
alone, so it stays correct even if either person's row later grows a real
rh/ch.

**Loan-team routing (`ca7802c`, 2026-10-03):** a loan-team RM's issue
email (Mayur Panjari's reports — `GS-011` CFG-054's 'Loan' region rows)
must go straight to Mayur Panjari as primary, bypassing any tl/tm/rh in
between (6 of the 17 loan-team rows carry `tl:'Zahid Shaikh'`, the Loan
team's own A1), with no cc at all. `LOAN_TEAM_CH_NAME_` (`GS-011`
CFG-081) is checked against the REPORTING RM's own `chain.ch` — not the
resolved primary's — before the normal `tl‖tm‖rh‖ch` cascade runs, so it
can override which tier becomes primary, not just filter cc afterward.
Also closed the one gap in the user's full 16-name loan-BDM roster:
`Mohd Ali Abdul Gaffar` (distinct from the already-present `Mohd Ali
Khan`) added to `RM_HIERARCHY_RAW_`; a 16th name, "Mohammad Azar Izhar
Ansari", confirmed a typo for the already-known "Mohammad Azaz Izhar
Ansari" (3 existing spelling-alias rows already route to Mayur Panjari).

**Both confirmed scoped to Google Non-UTM/Search leads only — already
true for free, no extra filtering code needed.** `resolveRecipientBucketsForRms_`
has exactly two real callers that ever route a per-RM issue email —
`AllIssuesEmailer.gs`'s `sendAllIssuesEmails_` (`GS-001`) and
`OvernightEmailer.gs`'s `sendOvernightMorningEmails`/
`sendOvernightFollowupEmails` (`GS-010`) — and BOTH gate every candidate
lead through `passesGoogleNonUtmSearchGs_` (`EmailInfra.gs`) before an RM
name is ever collected to pass into this function at all. Confirmed by
auditing every `.gs` file that sends mail at all
(`DailyRmIssueLog.gs`'s `reportRmPerformanceNow` only `Logger.log`s,
sends nothing) — there is no third, non-Google-scoped path either
override could leak onto. A useful side effect worth knowing: this whole
project's entire automated per-lead SLA-issue email system has never
covered anything but Google Non-UTM/Search leads — a non-Google lead's
SLA issue currently has no automatic email path at all, only the
dashboard's own live view.

**Verified:** `Tests_RmHierarchy.gs` — 5 assertions for the restricted-cc
override, 7 for the loan-team override, both the same self-contained-mock
+ temporary-reassignment pattern already established by the file's own
`TM_STILL_CC_` test (synthetic names; real names referenced only where
the production code itself hardcodes them — 'Snehil Chhimwal', the loan
team's shape). Full suite 1232/1232 via `run-gs-tests-headless.py`.

### 4.3.4 Email audit (2026-10-05) — the outgoing-email safety gate and what follows it

The full audit, plan (P1–P14) and re-audit live in **`docs/_planning/EMAIL_AUDIT.md`** — read that
for the findings (F1–F25) and their evidence. This section records only what is now *true of the
code*, one bullet per plan step as each lands.

- **P1 — every report email goes through one gate.** `sendGuardedEmailGs_` (`EmailInfra.gs`) is now
  the ONLY place a report email is drafted and sent (`GmailApp.createDraft` appears nowhere else in
  the emailers; ops alerts keep using `GmailApp.sendEmail` on purpose so an alert can always go out).
  It validates the exact payload first (`prepareOutgoingEmailGs_`): a syntactically valid To (and
  Cc), a non-blank subject (CR/LF collapsed), a non-whitespace plain body, an HTML body with visible
  text, and — for report emails — a non-empty list of claimed lead ids that **all appear in the HTML
  body** (the plain-text part is a one-line stub until P2, so it is only checked for being non-blank).
  A failure throws `blockedByGuard` *before any draft exists*; each caller's existing failure path
  turns that into an ops alert ("…BLOCKED by the send-safety gate…" or "Email BLOCKED by the
  send-safety gate — nothing was drafted or sent: <reasons>") and a "not sent" entry, and **nothing
  is marked as sent**. The 13:00 follow-up runs the gate once on the payload both of its paths
  (threaded reply, plain fallback) would send; the threaded sender also re-validates and collapses
  CR/LF, since it builds a raw MIME message by hand. `sendCombinedMorningEmail_` now treats a
  Section 1 with no leads as no Section 1, and both CH-level reports skip silently when they would
  carry zero leads. If a BLOCKED alert fires, fix the named cause (a bad cell in `Manager_Directory`
  / `Region_Recipients`, or a content/count mismatch that is a code bug) and run the job's `…Now`
  function by hand — the 13:00 job can be re-run the same day because a blocked reply writes no state.
- **P2 — the plain-text part is a real email, not a stub.** Every report email's plain-text body is
  now rendered from the *same opts object* as its HTML (`plainTextFromReportOptsGs_` /
  `plainTextReportGs_` / `plainTextTwoSectionGs_`, `EmailInfra.gs`): title, region, KPIs, action,
  every section's heading + table rows, footer, one signature — so a text-only client or a phone
  preview shows the leads, and the two parts cannot describe different content. Each email still
  opens with its old one-line count summary. The gate (P1) now requires every counted lead id in
  the plain text **and** the HTML. A missing table cell now renders blank in both parts (it used to
  print the word "undefined" in the HTML).
- **P3 — each region's 13:00 reply carries only its own Checkpoint 2.** `loadTodaysCheckpoint1PendingGs_`
  (`OvernightEmailer.gs`) is now keyed by **region + recipient** (`checkpoint1PendingKeyGs_`), and
  `sendOvernightFollowupEmails_` looks it up with the Overnight_Log row's own region and uses each
  key once per run. Before, it was keyed by recipient email alone, so a manager who covers several
  regions got every region's Checkpoint 2 in *each* region's thread — confirmed in production on 1
  Oct 2026 (the Central thread listed 7 leads at 10:05 and 68 at 13:04; the Thane, SoBo and Central
  replies were all ~36 KB). Legacy per-region Futwork rows still join the single `Futwork` group.
- **P4 — the three email jobs cannot overlap.** `sendOvernightMorningEmails`, `sendOvernightFollowupEmails`
  and `sendAllIssuesEmails` each run inside `withEmailJobLockGs_` (`EmailInfra.gs`), one script-wide
  `LockService` lock held for the whole run. Their "already sent today?" guards read log rows that
  are written only *after* each send, so two overlapping runs (a manual `…Now` during the schedule,
  a double-fired trigger, a slow run still going) would both send to everyone. A second job waits up
  to 30 s, then **skips and alerts ops** ("`<job>` SKIPPED — another email job was still running"); a
  skipped job is **not** retried — run its `…Now` function by hand once the other has finished.
  **It fails open:** only a clear "someone else holds the lock" skips a job; if the lock service
  itself errors, the job runs without the lock and ops get "`<job>` ran WITHOUT its overlap lock" —
  a broken lock must never silently stop all three daily emails. If Apps Script asks to
  re-authorize the first time you run a job after pasting this, approve it.
- **P5 — a checkpoint is "done" only when its email was delivered.** `checkpoint1_json` /
  `checkpoint1_sent_at` (10:00) and `checkpoint2_json` / `checkpoint2_sent_at` (13:00) used to be
  written even when the send **failed**; the loaders skip any row whose stamp is set, so the same-day
  re-run the failure alert asks for could never deliver that Section 2 (the 13:00 re-run replied
  *without* it). Now a definite failure leaves **both** the checkpoint stamp and `followup_sent_at`
  blank, so running `sendOvernightMorningEmailsNow` / `sendOvernightFollowupEmailsNow` again the same
  day retries that bucket, Section 2 included. A deliberate "nothing to send" outcome is still
  recorded (that is a final result, not a failure). The scheduled jobs still do **not** retry — the
  13:00 job reads only today's rows — and the 13:00 failure alert now says exactly that (it used to
  claim "retried on the next run").
- **P6 — no second copy after an ambiguous 13:00 send.** The 13:00 reply is sent by the Advanced Gmail
  Service into the 10:00 thread, with a plain `GmailApp` send as a fallback. The fallback used to
  follow *any* threaded error — including a timeout or "server error", where the message may already
  have been delivered, so it could deliver a duplicate. Now `isAmbiguousSendErrorGs_` (`EmailInfra.gs`)
  classifies the error: a **definite** refusal (bad argument, "operation not allowed", quota, "Not
  found") still falls back; an **ambiguous** one (timeout, internal/server/backend error, 5xx,
  network) sends **nothing more**, marks the bucket `unconfirmed <time>` in
  `Overnight_Log.followup_sent_at` (so it is not re-sent automatically), records Checkpoint 2, and
  alerts ops "1pm follow-up UNCONFIRMED for <region>". **To resolve an UNCONFIRMED alert:** look in
  Gmail Sent for a reply in that thread; if it is missing, clear that cell *and* the row(s)'
  `checkpoint2_sent_at` in `AllIssues_Log`, then run `sendOvernightFollowupEmailsNow`.
- **P9 — the logs say what happened and when, and a dead job gets noticed.** On 2 Oct the 13:00 job
  ended `Failed` with a platform "server error occurred" and nothing told anyone (its own alert never
  arrived; no check asked "did today's jobs run?"). Five changes:
  (1) *Run records.* Each of the three jobs writes `running` → `completed` / `failed` into Script
  Properties (`EMAIL_JOB_RUN_<job>`, latest run only) from inside `withEmailJobLockGs_`. A job the
  platform kills never writes its ending, so its record stays `running`. A quiet day is a `completed`
  run, so it never false-alarms the way "no log rows today" would. `showEmailJobRunsNow()` logs them.
  (2) *Watchdog.* ONE new hourly trigger runs `emailJobWatchdog`; for each job whose deadline (scheduled
  hour + 30 min) has passed it reports **never started** (no record for today), **stuck** (still
  `running` 35+ min after it started — it died) or **failed** (with the error). One alert per job per day
  per problem; the first alert arrives within about an hour of the deadline. **Install it once:** paste
  `EmailInfra.gs`, then run `setupEmailJobWatchdogTrigger()` (safe to re-run). After fixing a problem, run
  the job by hand (`…Now`) — a completed record silences the watchdog.
  (3) *Real send times.* `Overnight_Log.sent_at` / `followup_sent_at` and `AllIssues_Log.checkpoint1_sent_at`
  / `checkpoint2_sent_at` are stamped when the row is written (`istStampGs_`), not with the job's start
  time (3 Oct: a reply sent 13:12 was stamped 13:01:49).
  (4) *`Overnight_Log.followup_result` (new column J, appended — the sheet heals itself on the next run).*
  What the 13:00 job did with the row: `sent (threaded reply)`, `sent (fallback: a new message, not
  threaded …)`, `skipped: nothing unresolved`, `skipped: no stored recipient …`, `blocked: …`,
  `unconfirmed: …`, `failed: …`. A **blank** result on today's row after 13:30 means the job never got to
  it. `followup_sent_at` keeps its meaning (the "already sent" guard) and is still blank for a skip.
  (5) *Ops alerts retry.* `notifyOpsAlertGs_` tries GmailApp twice (3 s apart), then the Advanced Gmail
  Service (already authorized), and only then gives up (logged). A job that starts with
  `TEST_MODE_OVERRIDE_EMAIL_` set now alerts ops ("ran in TEST MODE") and writes no run record.
  No new OAuth scope is needed (Script Properties and the Advanced Gmail Service are already covered).
- **P10 — CH-level reports go once a day.** A CH-level report (a Cluster/Commercial Head or leader personally
  holding leads, or an RM whose chain resolves all the way up to one) goes to OPS + the CH-level address, but
  it was never logged — and the 10:00 / 17:00 region guards only read log rows. A region with **only**
  CH-level leads never gets a row, so **every re-run of the job re-sent the same report** (a region with a
  normal bucket as well was protected by that bucket's row). `wasChReportSentTodayGs_` / `markChReportSentGs_`
  (`EmailInfra.gs`) now keep one Script Property per report type (`EMAIL_CH_REPORTS_overnight` for the 10:00
  report, `EMAIL_CH_REPORTS_allissues` for the 17:00 one) holding today's `region|CH` keys; it is replaced
  when the IST day changes, so it never grows. The key is recorded only after a **successful** send (a failed
  send is retried by a same-day re-run). It is same-day only, like the region guards: a re-run recovers a
  failure, it does not pick up leads that arrived later. It **fails open** (an unreadable/unwritable record
  means the report may be re-sent, never withheld) and TEST MODE neither reads nor writes it. To force a
  re-send the same day, delete that property in Project Settings → Script properties.
- **P11 — the dashboard's own Gmail send has the same last-line gate (browser, `js/reports-gmail.js`).**
  `performGmailSend` — the one place every dashboard send funnels through (the single "Send via Gmail"
  button and both bulk flows) — used to hand whatever it was given straight to the Gmail API: nothing
  checked that a recipient was a real address, that the subject/body had any content, or that a line break
  hidden in a Region-recipients cell or a subject could not become an extra header (`buildRawEmail` pastes
  `to`/`cc`/subject into the MIME header block). `prepareGmailSend` now runs first and **blocks** the send
  — nothing reaches the Gmail API, no "Sent ✓" state, no `Send_Log` row — when: neither To nor Cc holds an
  address; any To/Cc address is malformed (the same shape the Apps Script gate uses); the subject is empty;
  the plain-text body is empty; or the HTML body has no visible text. A line break in the subject is
  *collapsed to a space* (the send still goes). A single send shows a red **"Blocked ✗"** button (tooltip =
  why) and an alert; a bulk send finishes the rest and reports "n blocked by the safety check". It does
  **not** check lead ids the way the backend gate does: a browser report carries a lead *count*, and a
  combined report can legitimately count zero in its numbered sections. Live as soon as GitHub Pages
  deploys this push (no Apps Script paste). Kept in parity with `EmailInfra.gs` — see §6.
- **P12 — `withRetry_` retries the platform's own "server error occurred".** `withRetry_` (`EmailInfra.gs`)
  wraps every Sheets read/write the email jobs make and retries only errors that are Google's own transient
  hiccups (`timed out`, `service (spreadsheets|gmail|error)`, `internal error`). The platform's wording for a
  transient failure — *"We're sorry, a server error occurred. Please wait a bit and try again."* — matched
  none of them, so the first such error from a Sheets call aborted the whole job; that is very likely what
  ended the 2 Oct 13:00 run `Failed`. It is now in the shared list (`TRANSIENT_ERROR_RE_`): the same 4
  attempts / 2 s + 4 s + 6 s backoff. Safe to retry because the log appends inside the wrapper are once-only
  (P7) and the other writes are idempotent. Deliberately narrow — only `server error occurred`, not the
  generic "please wait a bit" — so a permanent refusal (quota, permission) is still thrown on the first
  attempt. A blip longer than ~12 s still fails the job; that is what P9's watchdog is for.
- **P13 — the corporate addresses are no longer in the public repository.** `EmailInfra.gs` / `RmHierarchy.gs`
  held five corporate addresses as string literals (the ops address, the CH-level address, the Futwork route,
  and the two leadership Cc addresses) in a **public** GitHub repo. The code now keeps each role's **name**
  (`OPS_ALERT_NAME_`, `CH_LEVEL_NAME_`, `FUTWORK_ROUTE_NAME_`, `LEADERSHIP_NAMES_`) and looks the address up
  from `RmHierarchy.private.gs` — the git-ignored employee table you already paste beside `RmHierarchy.gs`,
  which already holds all of these people — at the moment it is needed (never at load time, per the load-order
  rule in `lookupEmployeeEmail_`). Read an address only through `opsAlertEmailGs_()` / `chLevelEmailGs_()` /
  `futworkRouteEmailGs_()` / `alwaysCcEmailsGs_()` / `leadershipEmailByNameGs_()`; the old variables
  (`OPS_ALERT_EMAIL_` …) are now blank/null **overrides** that only the tests assign. **No new file to paste, no
  new Script Property** — but `RmHierarchy.private.gs` is now needed for ops alerts and leadership Cc as well as
  routing. If it is absent or a person has no row, nothing is dropped silently: ops alerts fall back to the
  workbook owner, CH-level and Futwork mail to the ops address, a leadership Cc is skipped, and the hourly
  watchdog alerts once a day naming exactly what is unresolved (`emailConfigProblemsGs_`). **After pasting:
  run `showEmailConfigNow()` and read the Executions log.** Not changed: the addresses still exist in
  this repository's earlier commits (git history) — removing them from history means rewriting it and
  force-pushing, which was deliberately NOT done (it breaks every clone and open PR, and the addresses are
  ordinary corporate mailboxes). The test suite's third address is now a plus-address of the maintainer's own
  gmail instead of a colleague's corporate address.
- **P14 — deployed 2026-10-07.** Steps P1–P13 are live: the six production files (`EmailInfra.gs`,
  `OvernightEmailer.gs`, `AllIssuesEmailer.gs`, `RmHierarchy.gs`, `SlaEngine.gs`, `OpsChecklistRunner.gs`)
  were verified equal to the repo by hash after a server reload (`docs/STALENESS_TRACKER.md` sweep log has
  the method). **Still to do by hand: run `setupEmailJobWatchdogTrigger()` once, after midnight and before
  ~10:00 IST** (run earlier in the day it flags the jobs that ran before run records existed as "did not run"),
  then `showEmailConfigNow()` should still say `Every configured address resolves.` The five changed
  `Tests_*.gs` files and the never-pasted `Tests_EmailLifecycleFullCycle.gs` are not in the live project, so
  `runAllTests()` fails there with a ReferenceError (true before this work) — optional to fix.
  Rollback: paste the previous version of any of the six files back (`git show <old-sha>:<file>`; the old
  shas are in the tracker's sweep log). The new `Overnight_Log` column and the Script Properties may stay.
- **P15 — "calls so far today" is measured per LEAD, not per customer (F18).** `call_attempts` is a per-*lead*
  lifetime counter: every RM copy of one lead id carries the identical value (0 of 1,852 multi-row leads
  differed), but a customer's several leads (one `client_id`, different `lead_id`s) each carry their own. The
  baseline maps (`_readMovementLogRowsGs_` -> `buildTodayCallBaselineGs_` / `lastSnapshotBeforeGs_` /
  `buildMovementLogMapsGs_`, `MovementTracker.gs`) were keyed by `client_id`, so a lead was compared with
  whichever sibling's snapshot came first. On the live data (open Google Non-UTM leads, 7 Oct): 37 of 764 had a
  different baseline and 3 were wrongly NOT flagged "Behind on Today's Calls" (lead 2246693: 17 attempts, own
  baseline 19 = 0 calls today; the shared key held 7 = "10 calls today"); none was wrongly flagged. Everything
  now keys by **lead id**, in both runtimes (§6): `computeSlaFlags_`, the three emailer lookups behind the
  no-comment follow-up text (`OvernightEmailer.gs` x3 - morning, 13:00 reply, the debug download -
  `AllIssuesEmailer.gs`), and in the dashboard `buildTodayCallBaseline` / `lastSnapshotBefore`
  (`js/tab-movement.js`), `enrichLead` (via `callsTodayFromBaseline`, `js/core-lead-model.js`),
  `noCommentFollowUp` (via `lastSnapshotForLead`, `js/core-outcome-engine.js`) and Stalled-Leads detection
  (a lead is compared only with its own snapshots). A *merged* customer record (several leads) carries each
  lead's own counter (`callAttemptsByLeadId`, built in `fetchAndRender`'s merge) and takes the best per-lead
  delta, because its `call_attempts` is the max over its leads. Deliberately unchanged: everything that is
  about the *customer* (cohort history, `buildMovementHistories`, the one-row-per-customer `identityKey`
  collapse in the emails). No data is migrated - every `Movement_Log` row already carries its `lead_id`. Takes
  effect for the emails when `MovementTracker.gs`, `SlaEngine.gs`, `OvernightEmailer.gs` and
  `AllIssuesEmailer.gs` are pasted; the dashboard side is live when GitHub Pages deploys the push.
- **P16 — `snapshotPeriodic` stays inside the 30-minute limit (F23).** It hit the limit three times in five days
  (1,802-1,803 s on 1 Oct 00:18, 2 Oct 18:51, 4 Oct 06:08) and several other runs took 12-29 minutes. Its
  snapshots are the "calls so far today" baseline behind every email, so a killed run left the history
  without that capture and nothing said so. The cost was `Movement_Log` (~48K rows x 26 columns): four
  full-width reads per run (SLA baseline, hash lookup, prune, cohort history) and - with a 7-day window and
  ~1.7K rows appended per run - a prune that **rewrote the whole sheet on nearly every run**. Now: (1) the
  readers read only the columns they use (`_readMovementLogColumnsGs_`; 3-4 of 27 columns); (2) `pruneMovementLog_`
  reads just the `snapshot_at` column and, when the expired rows are a contiguous prefix (the normal case),
  archives those rows to Drive and removes them with ONE `deleteRows` - nothing is rewritten or cleared; any
  other shape (an out-of-order row, a blank cell, every row expired) falls back to the old full rewrite;
  (3) the **core capture** (hash lookup + append) runs first and its `Movement_Log_Runs` row is written right
  after it, then the optional phases (SLA_History, the two loggers, prune, the two prunes, cohort history) each
  start only while the run is inside `SNAPSHOT_OPTIONAL_PHASE_DEADLINE_SECONDS_` (840 s) - a skipped phase is
  idempotent, the next run does it; a failing prune still fails the run, but only after the run record is
  complete; (4) the log carries `[timing]` lines (where the time went); `Movement_Log_Runs` gained `total_s`
  and `skipped_phases` (a row with `total_s` blank is a run killed after its capture); (5) `snapshotPeriodic`
  leaves a run record in Script Properties (`EMAIL_JOB_RUN_snapshotPeriodic`) and the hourly watchdog
  (`snapshotRunProblemsGs_`) alerts once per run when it is stuck past 35 minutes, failed, overdue (no run for
  more than 8 hours) or finished having skipped phases. **Not measured live** - the speed-up is expected from
  the reads/writes removed, not yet observed: after the first scheduled runs read the `[timing]` lines and
  `Movement_Log_Runs.total_s` (expect minutes, not tens of minutes, and an empty `skipped_phases`). The
  watchdog trigger (`setupEmailJobWatchdogTrigger`, see P14) must be installed for the alerts to fire.
- **P17 — the comment prunes had been failing silently; a failed snapshot step is now emailed (2026-10-07).**
  `Comment_History` held 6,369 rows (oldest 32.8 days) and `Unmatched_Comments_Log` 2,134 (oldest 34.8) past their 30-day
  retention. Both prunes prove their Drive archive before deleting by counting the CSV's lines - but a comment with a line
  break is ONE record on several lines (the writer quotes it), so 102 multi-line comments made the count 6,518 against 6,369
  and the prune threw `Drive archive holds ... refusing to prune`. That throw was only written to the log, so nobody knew.
  Fixed: `countCsvRecordsGs_` (`Core.gs`) counts RECORDS (quote-aware); both prunes use it. **Alerting:** every optional step of
  `snapshotOpenLeads_` that throws is now emailed to ops (`alertSnapshotPhaseFailuresGs_`), at most once per day per step,
  listed in `Movement_Log_Runs.failed_phases` and in the run record; a `Movement_Log` prune failure is emailed AND still
  fails the execution. New column `Movement_Log_Runs.phase_s` shows where each run's time went. Not changed: the
  `Movement_Log` prune itself was not failing - with a 7-day window it simply had nothing expired when last run. The first run
  after the paste archives and removes the ~8,500 expired comment rows. Earlier failed attempts probably left duplicate archive
  CSVs in the Drive archive folders (harmless).
- **P18 — duplicate prune archives stopped; `Daily_RM_Issues` never drops a row for lack of a date (2026-10-08).**
  *Duplicates:* a prune archives, proves the archive, then deletes. When the proof or a later sheet write failed, the files stayed in
  Drive and the next run (4 a day) wrote another identical copy - 32 extra archives sat in Drive from 2026-10-03 (14 in
  `Comment_History`, 18 in `Unmatched_Comments_Log`; moved to the Drive trash 2026-10-08). Now `archiveRowsToDriveCsv_` reuses an
  identical existing file, `archiveChunksVerifiedGs_` (`Core.gs`) proves the archive and trashes the files it just made if the proof
  fails, and the `archive_log.csv` row is written only after the rows are gone. Used by the `Comment_History`,
  `Unmatched_Comments_Log` and `Daily_RM_Issues` prunes; `Movement_Log` gets the reuse through the shared writer.
  *`unknown-dates`:* from 2026-10-02 every nightly `Daily_RM_Issues` archive (~600 KB) was filed `unknown-dates` - the `date`,
  `captured_at` and `lead_assigned_at` cells of those rows read back blank and the prune compared a blank date as older than the
  window, so it archived and deleted them. Nothing reads this tab (the dashboard moved to `Movement_Log` on 2026-09-05), so there
  was no user-visible effect, only a thin, undated audit trail. **The cause of the blanking is not identified** (the tab holds no
  undated row in the morning). Fix: an undated row is given a date (its `captured_at`, else the next dated row's, else the previous
  one's, else today's) and written back instead of being dropped; the date columns are read back after the capture write and the
  prune rewrite and re-written (as text if a plain re-write still reads blank); the prune writes kept rows first, clears only the
  tail, and proves its archive before deleting. Nothing is emailed - what was seen goes to the `DAILY_RM_ISSUE_DIAG` Script Property
  (`showDailyRmIssueDiagNow()`). The 6 existing `unknown-dates` archives cannot be re-dated from the files; nights still in
  `Movement_Log` (1 Oct onward) can be rebuilt with `backfillOneDayFromMovementLog_`, which skips a day that already has a dated row.
  *`lead_assigned_at` refill (P18b, same day):* On 2026-10-08 the newest night kept `lead_assigned_at` on 505 of 505 rows, the night before on 75 of 674, 5 Oct on 5 of 41 and 4 Oct on 0 of 2, while the Leads tab (6,680 of 6,680) and every `Movement_Log` snapshot of 1-7 Oct have it for every lead - so the cell is lost after the row is written, not at the source. After every prune, any remaining row with a lead id and no value is filled from the
  lead's own record - that day's `Movement_Log` snapshot, else the Leads tab today, else the lead's latest snapshot. Fill only (a populated
  cell is never touched), nothing is emailed, the observation goes to `DAILY_RM_ISSUE_DIAG`. The capture hands the prune its own Leads read
  (the tab is read once a night) and the column is re-asserted after the rewrite. `refillDailyRmIssueAssignedAtNow()` does it on demand.
- **P7 — log rows written once, same-address buckets merged, a truthful "already sent" label, no
  duplicate `Lead_Followups` rows.** Four small defects, one change each:
  (1) *Once-only log appends (F10).* Every `Overnight_Log` / `AllIssues_Log` append runs inside a retry
  wrapper, and Sheets can write the row and *then* time out — the retry used to append a second
  identical row (a duplicate `Overnight_Log` row = a duplicate 13:00 reply into the same thread).
  `appendRowOnceGs_` (`EmailInfra.gs`) makes the write a closure: its first attempt just appends (no
  extra read), a retry first looks for its own thread id in the last 100 rows and does nothing if it
  is already there. (2) *Same-address buckets merge (F9).* Two resolved buckets on one address (e.g. a
  `Region_Recipients` fallback equal to an A1's own address) used to overwrite each other in the 10:00
  job — the first bucket's leads were never emailed and never reported as "not sent".
  `mergeBucketsByAddressGs_` now merges them inside `resolveRecipientEmailsForRegion_` (union of RM
  names and Cc, first bucket's label/role kept), so the 10:00 *and* 17:00 jobs both get one bucket.
  The Futwork bucket is added after the merge and stays separate. (3) *Truthful label (F16).* The
  10:00 region guard says "this region ran today", not "this recipient got their email"; a
  Section-2-only recipient with no `Overnight_Log` row of their own used to be told "Already sent
  separately earlier today". They now get "No Overnight email to you is recorded for today… contact
  Lead Ops". (4) *No duplicate `Lead_Followups` rows (F17, duplicate half only).*
  `pushUnresolvedToLeadFollowups_` appended one row per repeated lead id (e.g. a lead in two
  `Overnight_Log` rows); a repeat now updates the pending row (later entry wins). Not changed: the
  stale-read rewrite of column F (millisecond window, noted in the audit) and the 17:00 Section-1
  region guard, which is still per-region by design.
- **P8 — one leads-tab read per job.** `computeAllIssuesCheckpointGs_` (`SlaEngine.gs`) used to call
  `readLeadsTab_` itself, so the 10:00 and 13:00 jobs re-read the whole leads tab once **per bucket**
  (~30 reads — the 3 Oct 13:00 run took 663 s) *and* judged each bucket, and Section 1 vs Section 2 of
  one email, against a different moment of a sheet that is re-imported underneath a 4–11 minute run.
  It now takes an optional fifth argument `leadsData` (the `{colIndex, dataRows}` `readLeadsTab_`
  returns); `sendOvernightMorningEmails_` / `sendOvernightFollowupEmails_` pass the snapshot they
  already read at the start (through `sendCombinedMorningEmail_` / `sendCombinedFollowupEmail_`'s new
  optional last parameter). Omitted, or not a usable `{colIndex, dataRows}`, it reads the tab exactly
  as before, so any other caller is unaffected. Behaviour change to know about: Section 2 is now
  judged against the job's *start-of-run* sheet, not the sheet as it is minutes later — consistent
  with Section 1, and the same moment for every bucket. The per-bucket scan of the in-memory rows to
  find the wanted lead ids is unchanged (cheap next to a Sheets read). The 17:00 job already read
  once and is unchanged.

### 4.4 GitHub repo access

Push access to `github.com/snehilchhimwal-stack/leads-dashboard` is needed to
change `dashboard.html`/`js/*.js` (the deployed frontend) or to keep this
repo's copies of the `.gs` files in sync with what's actually pasted into the
Apps Script editor. Ask the current repo owner to add the new maintainer as
a collaborator. **GitHub Pages source: "Deploy from a branch", `master` / `/`
(root)** — confirmed 2026-09-10 (see §2); a push to `master` that touches
`dashboard.html` / `js/*.js` is live within a minute or two of the
`pages-build-deployment` run finishing.

---

## 5. Data the Sheet holds

Beyond the leads tab itself (one fixed tab, named `leads` — see
`TAB_NAME_OVERRIDE` in `Core.gs`), the system reads/writes these tabs:

| Tab | Written by | Read by |
|---|---|---|
| `Movement_Log` | `MovementTracker.gs` (4×/day at 00:00/06:00/12:00/18:00 IST — see §4.3) + optionally the dashboard's on-demand snapshot | Movement tab, RM Timeline tab, `UnmatchedCommentLogger.gs` |
| `SLA_History` | `MovementTracker.gs` (same 4×/day trigger) + the dashboard on refresh | Trend/history views |
| `Lead_Followups` | `OvernightEmailer.gs`'s send paths + the dashboard's Operations "Generate" flow | The follow-up email content itself |
| `Daily_Cohort_History` | `js/sheets-writeback.js` | Tracking tab's cohort comparison |
| `Feature_Usage` | `js/sheets-writeback.js` (`recordComponentUsage`, fire-and-forget — per-tab client-side usage tracking, added 2026-10-03) | `OpsChecklistRunner.gs`'s weekly `checkStaleComponents_` (30-day stale-dashboard-tab check, same date) |
| `Unmatched_Comments_Log` | `UnmatchedCommentLogger.gs` (piggybacks on every `snapshotOpenLeads_` run); pruned (30-day, age-based, independent of `reviewed`) by the same file's `pruneUnmatchedCommentsLog_` since 2026-09-29 | Manual human review — the source for deciding what to add to `OUTCOME_RULES`/`OUTCOME_RULES_GS_` next |
| `RM_Hierarchy`, `Manager_Directory` | `setupRmHierarchy()` (one-time, then manually maintained) | `RmHierarchy.gs`'s recipient routing |
| `Daily_RM_Issues` | `DailyRmIssueLog.gs` (nightly, 22:50 IST) + its own backfill/repair utilities | `js/tab-repeat-offenders.js` (Repeat Offenders tab) — see §9 |
| `Comment_History` | `InteractionHistoryLogger.gs` (piggybacks on every `snapshotOpenLeads_` run); pruned (30-day) by the same file's `pruneCommentHistory_` since 2026-09-29 — was unbounded-by-design before that | `InteractionHistoryLogger.gs` itself (within-run dedup); no dashboard reader — a forward-capture dataset |
| `Send_Log` | `js/sheets-writeback.js` (fire-and-forget, after a dashboard region-email send) | no code reader — a send-audit trail (holds recipient/sender emails) |
| `Region_Recipients` | manually / the dashboard's "Edit region recipients" UI (`js/reports-ui.js`, `localStorage` + this tab) | `EmailInfra.gs` recipient resolution |
| `AllIssues_Log` | `AllIssuesEmailer.gs` (17:00 IST run) | `AllIssuesEmailer.gs` itself (within-run dedup) — a send-audit trail |
| `Overnight_Log` | `OvernightEmailer.gs` (10:00 IST run) | `OvernightEmailer.gs`'s 13:00 follow-up run (same-day thread handoff) — older rows are dead weight |

Full per-tab detail (columns, retention, sensitivity, every reader/writer)
is in `docs/sheets/SHEET-001`..`SHEET-018`; this table is the onboarding
overview.

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
| Stage / SLA-flag **config** (thresholds, `FUNNEL_ORDER`) | `CONFIG.*` (`js/core-foundation.js`) | `Core.gs` `FUNNEL_ORDER_` + `SlaEngine.gs` `*_` thresholds |
| Stage / SLA-flag **logic** | `enrichLead()` (`js/core-lead-model.js`) | `computeSlaFlags_` (`SlaEngine.gs`) |
| Comment classification | `OUTCOME_RULES` / `inferOutcome` (`js/core-outcome-engine.js`) | `OUTCOME_RULES_GS_` / `inferOutcomeGs_` (`FollowupEngine.gs`) |
| Suggested follow-up text | `FOLLOWUP_SUGGESTIONS` (`js/core-outcome-engine.js`) | `FOLLOWUP_SUGGESTIONS_GS_` (`FollowupEngine.gs`) |
| Region normalization | `REGION_GROUP_MAP` / `mainRegionFor` (`js/reports-build.js`) | `REGION_GROUP_MAP_` / `mainRegionForGs_` (`EmailInfra.gs`) |
| **Loan-region override** | `effectiveRegion` (`js/reports-build.js`) | **NO working twin** — a real HIGH finding (`LOGIC_AUDIT.md` Part 4 §4.4 / Part 7 §18; `docs/data-flows/DATA-005`). Loan leads can be mis-attributed on the `.gs` side. |
| RM-performance tuning constants | `RM_PERF_*` (`js/core-rm-performance.js`) | `RM_PERF_*_GS_` (`DailyRmIssueLog.gs`) — must stay numerically identical |
| IST day boundary | `istDateKey` (`js/core-foundation.js`) | `istDayKeyGs_` (`Core.gs`) |
| "Calls so far today" baseline key (added 2026-10-07, email audit F18): per **lead id**, never `client_id` - `call_attempts` is a per-lead counter | `buildTodayCallBaseline` / `lastSnapshotBefore` (`js/tab-movement.js`), `callsTodayFromBaseline` / `lastSnapshotForLead` (`js/core-lead-model.js`), `noCommentFollowUp` (`js/core-outcome-engine.js`) | `_readMovementLogRowsGs_` (`MovementTracker.gs`), `computeSlaFlags_` (`SlaEngine.gs`), the three `lastSnapshotMap[leadId]` lookups in `OvernightEmailer.gs` and the one in `AllIssuesEmailer.gs` - the same scenarios (a sibling lead with a different counter) are asserted in `Tests_SlaEngine.gs` / `Tests_MovementTracker.gs` / the emailer tests and `tests/frontend-harness.html` 2i-b |
| Outgoing-email send-safety gate (added 2026-10-07, email audit P11): address shape, visible-text check, CR/LF-in-subject collapse | `GMAIL_ADDRESS_RE` / `gmailAddressListProblems` / `gmailVisibleText` / `prepareGmailSend` (`js/reports-gmail.js`) | `EMAIL_ADDRESS_RE_` / `emailAddressListProblemsGs_` / `visibleTextOfHtmlGs_` / `prepareOutgoingEmailGs_` (`EmailInfra.gs`) — the two address regex literals are diffed by `check-runtime-parity.py`'s regex-pair check; the functions are kept in parity by hand, backed by the SAME address/visible-text vectors in `tests/frontend-harness.html` 2k and `Tests_EmailInfra.gs`. The browser gate does not check lead ids (the backend one does). |
| Test-mode email override (must be `''` in prod) | `TEST_MODE_OVERRIDE_EMAIL` (`js/reports-ui.js`) | `TEST_MODE_OVERRIDE_EMAIL_` (`EmailInfra.gs`) |
| Tracked dashboard tab roster (added 2026-10-03) | `TRACKED_COMPONENT_IDS` (`js/sheets-writeback.js`) | `TRACKED_COMPONENT_IDS_GS_` (`OpsChecklistRunner.gs`) — the browser side writes `Feature_Usage` rows for exactly these 9 tabs, the Apps Script side judges 30-day staleness against the same list |

(This table mirrors `docs/RELATIONSHIP_MAP.md` §2, which carries the exact
`CFG-`/`RULE-` sub-IDs and `LOGIC_AUDIT.md` Part 4 section for each pair.)

**Run `python3 test/check-runtime-parity.py`** (added 2026-09-21) to diff
the DATA in most of the rows above (keyword lists, weights, region/header
maps, `FUNNEL_ORDER`'s order) directly between the two files, instead of
relying on a session remembering to eyeball both sides after an edit. It
compares the data these rules carry, not the matching algorithm itself
(a `test`/`eligible` function body's logic isn't diffed) — a first real
run found `HEADER_ALIASES` carrying 2 browser-only keys
(`lead_closing_comment`, `project_region`) absent from `HEADER_ALIASES_`,
confirmed intentional (no `.gs` file reads either column) rather than
drift, which is the expected shape of its output: a lead to verify, not
an automatic verdict.

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
appear anywhere in the suite are `snehil.chhimwal@gmail.com` and its `+test2` /
`+testch` plus-addresses (`TEST_EMAIL_PRIMARY_`/`TEST_EMAIL_SECONDARY_`/`TEST_EMAIL_CH_`) —
no corporate address (the tests override the ops/CH/Futwork/leadership settings with these).

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

**One exception to "one `Tests_<File>.gs` per production file"**:
`Tests_EmailLifecycleFullCycle.gs` (added 2026-09-24), which chains REAL
calls to `sendAllIssuesEmails`/`sendOvernightMorningEmails`/
`sendOvernightFollowupEmails` against ONE shared mock spreadsheet — an
INTEGRATION test across `AllIssuesEmailer.gs` + `OvernightEmailer.gs`, not
a new module's own suite. It has no matching production `.gs` file by
design; `test/check-gs-registration.py` prints one expected false positive
for it, documented in the file's own header comment.

**The snapshot -> baseline -> email -> watchdog chain, end to end (2026-10-07, email audit F18/F23).**
`Tests_EmailLifecycleFullCycle.gs`'s `TestEFC_runSnapshotChain_` runs the REAL `snapshotPeriodic()` against a mock
spreadsheet and lets the real writers feed the real readers - nothing a writer produces is hand-built: capture #1
("yesterday": its rows' `snapshot_at` are moved back a day, the one cell the comparison depends on) -> the REAL 17:00
all-issues job and the REAL 10:00 overnight job read the `Movement_Log` it wrote (two sibling leads of one customer with
different counters, plus controls) -> capture #2 (only changed leads get a row; the baselines stay yesterday's;
`SLA_History`, written after the capture, does not read the run's own fresh rows) -> the prune against rows the snapshot
wrote (one `deleteRows`, archive first) -> the watchdog (clean run / run killed at the limit / budget-starved run / failed
run, each alerted once). The same lead ids (`E101`/`E102`/`E201`/`E301`, plus `E401`/`E402` created today) and the same
expected "behind on today's calls" table are asserted by `tests/frontend-harness.html` section 7, a second real
`fetchAndRender()` fed a `Movement_Log` in the Sheets-API shape (header = `MOVEMENT_LOG_COLUMNS` + `content_hash`, dates as
serial numbers), so the two runtimes are checked against ONE table. 14 + 7 deliberate chain regressions (reader keyed by
the wrong column, today's own capture used as a baseline, dedup removed, prune fast path off, run record never completed,
watchdog not wired, ...) each fail an `E2E` assertion by themselves.

**Run the suite at awkward clock times and zones before trusting a test that uses the real clock.**
`python3 test/run-gs-tests-headless.py --at 2026-10-08T00:00:20+05:30` starts the browser's clock at that moment (it keeps
ticking) and `--tz UTC` sets its local zone (CI runs in UTC; this machine is in IST; the two combine). The first sweep -
13 clock times (just after and just before IST midnight, 01:30, 03:00, 08:59:50, 10:03, 13:01, 17:04, 18:51, a Saturday, a
Sunday just after midnight) and 4 zones - found ONE fixture that was only clean at some hours:
`Tests_OvernightEmailer.gs`'s `midWindow` is 01:00 IST, the overnight window's end (09:00 today) is in the future between
midnight and ~04:30, and a lead younger than the 3 h grace is not flagged, so a P7 assertion failed only in those hours (the
job itself runs at 10:00, so production was never affected). It is now `min(middle of the window, now - 3.5 h)`. After the
fix all 13 times and all 4 zones pass, and no assertion of the e2e reads the IST hour (every offset is >= 24 h, the leads are
> 48 h old at any hour, and the watchdog assertions look only at `snapshotPeriodic` alerts).

**The first live `runAllTests()` (2026-10-07, 17:54 IST, after the P15/P16 paste) - what it showed.** 14 suites ran
clean on the real platform, including every new F18/F23 test (`Tests_MovementTracker.gs` 224/224, `Tests_SlaEngine.gs`,
`Tests_AllIssuesEmailer.gs`, `Tests_DailyRmIssueLog.gs`, ...), but THREE suites (`EmailInfra`, `OvernightEmailer`,
`EmailLifecycleFullCycle`) threw `ReferenceError: atob is not defined` partway through: `TestOE_decodeRawMime_`
(`Tests_OvernightEmailer.gs`) used `atob()` and `TextDecoder`, which exist in a browser and in the Node CI sandbox (after the
2026-09-24 shim) but NOT in Apps Script. Every local and CI run was green because both runners provide them. Test-only (no
production code touched); fixed with a pure-JavaScript base64 + UTF-8 decoder. **Guard:** `python3 test/check-gs-runtime-globals.py`
flags browser/Node-only globals in any `.gs` file (comments and strings ignored) - it flags the old helper and passes the fixed
tree. A green headless/CI run is therefore not proof the suite runs in the editor; run `runAllTests()` live after a paste and read
the per-suite lines, not only the total.

**Two traps found while building the e2e (keep them in mind for the next one):** (1) `tests/frontend-harness.html` freezes
`Date.now()`, so a wait loop capped with `Date.now() - start < N` can never expire - a FAILING check hangs the whole harness
instead of failing (use an iteration cap; the two wait loops there now do); (2) the baseline maps take snapshots STRICTLY
BEFORE their cutoff and the mock runs fast enough for a capture and a following `new Date()` to land in the same millisecond,
so the e2e takes its map cutoff 5 ms after "now".

**Real gotcha (2026-09-24): the Node CI harness (`test/run-gs-tests.js`)
does not inherit Node's own globals.** `vm.createContext()` builds a
genuinely isolated sandbox — `atob`/`TextDecoder`/`TextEncoder`, used
directly by `TestOE_decodeRawMime_` (`Tests_OvernightEmailer.gs`, added
Step 7 of the two-checkpoint redesign), were simply undefined there, so
every test calling it threw a bare `ReferenceError`. **3 consecutive CI
runs were red with no readable log** (the Actions log-download endpoint
403s for this repo — same gap the "no local Node" note above already
covers) before this was found by directly querying the Actions API's
check-run/job/annotation endpoints (all accessible unauthenticated for a
public repo, unlike the log-download endpoint) to get the failing
step name, then reasoning from there — `test/run-gs-tests-headless.py`
(the local pre-push check) never caught it because it drives a REAL
Chrome browser, where these are real globals. Fixed by forwarding Node
20's own `atob`/`TextDecoder`/`TextEncoder` into the sandbox (no
reimplementation needed). **Lesson for the next browser-only global a
test file reaches for**: it needs adding to `buildSandbox()` in
`test/run-gs-tests.js` too, not just working locally in the headless
Python/Chrome runner — the two harnesses' mock globals are maintained
as two separate files and can drift apart silently, exactly like this.

### 7.2 Dashboard (browser JS) — `tests/frontend-harness.html` (own CI job, blocking)

The persisted browser-JS suite is **`tests/frontend-harness.html`** at the
repo root. It grafts the real `dashboard.html` + every `js/*.js` file into
one page, mocks only the network boundary (the Sheets API read + the OAuth
token pair), runs a fixed synthetic dataset through the real
`fetchAndRender()` pipeline, and asserts on the resulting DOM. Open it in a
browser and read `window.__harnessResults` (or the on-page PASS/FAIL log).
Re-run it after any dashboard-side change, and extend it — add the
assertions in the same commit — rather than hand-verifying in the console.

**In CI as of 2026-09-10** (`t-tf-5ad22d8e4c2e`): `.github/workflows/test.yml`
has a **dedicated `frontend-harness` job** that runs on the **official
Playwright container** (`mcr.microsoft.com/playwright:v1.47.2-jammy` —
chromium + all system libraries + a matching `playwright` npm package are
already in the image, so nothing is downloaded and there is no apt step
to be flaky). It serves the repo over `http.server`, runs the harness
headless via `test/run-frontend-harness.mjs`, and prints `N passed, M
failed` + every failing assertion + the page's console on any failure.
**Blocking** — a real assertion failure fails that job. Confirmed green
(`3675b93`, 59/59). Two problems were fixed getting here: (1) an earlier
bare-runner attempt (`fd59944`) hit a missing-system-libs
`chromium.launch()` at ~28 s — the container has every lib; (2) the
harness's own **clock is now frozen** to a fixed weekday IST-afternoon
instant (top of `tests/frontend-harness.html`) — one assertion (`L011`,
"missed first-contact inside the 3 h grace") counts *working* minutes
(9 AM–7 PM IST) and so only held when the harness happened to run
in-window; this was the long-known "time-of-day flake" (§9.7.2). It is a
separate job so the fast Node/Python `test` job is never gated on a
browser. Locally it runs the same way — serve the repo (`preview_start`
the "dashboard" config), open the page, read `window.__harnessResults`.

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
- **`Movement_Log` growing far faster than it should, or the workbook hitting the 10M-cell ceiling**: read `Movement_Log_Runs` (`lead_count_seen` vs `leads_changed`). A healthy run changes a small fraction of the ~10k open leads; **~100% every run means the dedup cannot read the hash column** — usually the header no longer matches the writers' column order (`snapshot_at`, `snapshot_label`, every `SNAPSHOT_COLUMNS_` field, then `content_hash` last). Real incident 2026-09-22 → 09-25: adding `opp_at` made the self-heal append its header *after* `content_hash`, one column off from where every writer puts it, so every capture re-appended every lead (~52k junk rows in two days, then the ceiling crash). Fixed by inserting before `content_hash`, a guard that refuses to write into a misaligned sheet, and regression tests (`GS-008` `EXC-100`); the live header was repaired by swapping the two cells, and the 52,060 junk rows were archived to Drive CSV and deleted by the one-off `removeDedupIncidentRowsNow` (2026-09-25; `GS-008` FN-285). 2026-09-26: the dedup identity was still too coarse — keyed by `client_id`, so one customer's several rows could match only one stored hash and ~2,000 identical rows were re-appended per capture (44-62% of open leads per run even after the header fix); it is now `lead_id|RM` in both runtimes (`GS-008` FN-296, `JS-021` FN-297). Also 2026-09-25: a raw NUL byte in `MovementTracker.gs`'s hash separator became a space when pasted, so live Apps Script and the browser hashed differently — the source now uses the escape `'\u0000'`.
- **An automatic email didn't send, or sent to the wrong people**: Apps
  Script editor → **Executions** (left sidebar) — shows every trigger-fired
  run, its logs, and any thrown error, going back further than the
  in-session `Logger.log` output. `notifyOpsAlertGs_`/`OPS_ALERT_EMAIL_`
  (§4.3) should also have already emailed a failure notice for anything that
  threw inside a guarded path.
- **An automatic email job never ran, died part-way, or ended `Failed` with no alert** (real incident,
  2026-10-02: `sendOvernightFollowupEmails` ended `Failed` after 2 minutes with the platform error "a server
  error occurred", no 13:00 reply went out and no alert arrived). Since the 2026-10-05 email audit: (1) a
  **WATCHDOG** alert from `emailJobWatchdog` (hourly) says which job did not run / did not finish / failed —
  run `showEmailJobRunsNow()` to see the three run records it reads, and `Overnight_Log.followup_result`
  says what the 13:00 job did with each row (blank after 13:30 = never reached); (2) `withRetry_` now
  retries that platform error (§4.3.4 P12); (3) ops alerts retry and fall back to a second send path (P9).
  After fixing the cause, run the job's `…Now` function by hand — its "already sent today" guards stop it
  re-sending what already went out — and the watchdog goes quiet once the run completes.
- **Recipient routing looks wrong** (an issue email went to the wrong
  manager, or fell back to a generic address): check `RM_Hierarchy` /
  `Manager_Directory` sheet tabs for a blank/stale email against that RM's
  actual current manager, and confirm `RmHierarchy.private.gs` is present
  and current in the Apps Script project (§4.3) — a missing or stale entry
  there is the most common cause.
- **A real RM/team with real leads has NO row in `RM_Hierarchy` at all**
  (not stale — just never added, e.g. a team that never appears in any HR
  export this project refreshes from): real incident, 2026-10-01 — the
  Pre Sales team (7 people, 25-498 leads each) went unnoticed this way.
  `auditUnresolvedRmsNow()` now runs automatically at the end of every
  `rebuildRmHierarchy()` call (§4.3.2) and logs any such gap — check the
  execution log from the last rebuild first. A lead naming an unresolved
  RM still routes safely to the `Region_Recipients`/CH-level fallback in
  the meantime (never silently dropped), it just doesn't reach that RM's
  actual manager.
- **A real RM comment produced a generic/wrong Suggested Follow-up**: check
  `Unmatched_Comments_Log` — if the exact phrasing shows up there, the
  keyword engine genuinely doesn't recognize it yet; that's the signal to
  add a rule per §6, not a bug to chase elsewhere.
- **`Unmatched_Comments_Log` has thousands of exact-duplicate rows** (the
  same `lead_id`+comment repeating across many capture dates): this was a
  real, confirmed bug from this file's creation through 2026-09-03 — the
  de-dup check compared `comment_at` as a string, but Sheets silently
  converts that "yyyy-MM-dd HH:mm"-shaped string into a real Date-typed
  cell on write, so the read-back never matched and every still-open
  comment got re-logged on every 6-hourly run forever. Fixed in
  `UnmatchedCommentLogger.gs`'s `scanUnmatchedCommentsGs_` (reformats a
  Date-typed `comment_at` cell back to the write-side string format before
  comparing — same "date column silently became a Date" handling already
  used for `Daily_RM_Issues`/`Overnight_Log`/`Movement_Log` elsewhere in
  this project). The existing test suite's mock sheet never simulated this
  real Sheets behavior, so it stayed green the whole time — a real
  regression test for it (writing a literal `Date` object into the mock,
  the same shape a real sheet hands back) was added to
  `Tests_UnmatchedCommentLogger.gs`. Run `dedupeUnmatchedCommentsNow()`
  ONCE, after syncing the fix to the live Apps Script project, to collapse
  the backlog this bug produced (keeps one row per genuinely unique
  comment, preferring a reviewed duplicate over an unreviewed one so no
  review work is lost).
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
- **A lead reads as still stuck on an issue it's clearly already past**
  (e.g. shown "in Follow-up" despite being an Opportunity, or "Not
  Connected" despite a logged call): almost always `Lead_Followups`
  staleness, not a classification bug — check that sheet's `updated_at`
  column (G) for the lead in question before assuming
  `isOppOrAbove`/`computeSlaFlags_` is wrong. Real incident, lead
  2229674, reported 2026-09-09: live inspection confirmed the dashboard's
  own current classification was already correct (`current_stage`
  mapped cleanly, every SLA flag `false`) — the stale read was a
  `Lead_Followups` row written ~19h earlier by a Generate cycle that ran
  before the lead progressed. `Lead_Followups` is only rewritten by a
  full Generate or refreshed per-lead by `sendOvernightFollowupEmails`
  (13:00 IST) for a lead still matching its ORIGINAL flagged issue — once
  a lead resolves, nothing touches its row again until the next full
  Generate. The investigation did surface one real, separate, latent
  gap while ruling out the classification-bug hypothesis (`isOppOrAbove`
  lacked a closing-reason fallback its sibling `isBookingLead` already
  had) — fixed the same day, but confirmed NOT the cause of this specific
  incident. Full consumer map, the two visibility fixes (conditional
  formatting on the sheet, an age caption in the 1pm email), and the
  freshness-policy decision: `LEAD_FOLLOWUPS_STALENESS.md` (repo root).
- **`Movement_Log` held corrupted rows for 9–11 Sep 2026** (a restore from
  a prior catastrophic-data-loss incident — see the `movement-log-prune-safety-fix`
  merge, 2026-09-12 — brought back rows that broke the "most recent
  content-hash per lead" dedup lookup's assumption of chronological row
  order, causing every subsequent capture to write 4,600–6,500 rows
  instead of only genuinely changed leads). Fix: `removeEarlyCorruptedMovementLogDataNow()`
  (`MovementTracker.gs`, see the console-utilities list above) backs up
  then drops every row before 12 Sep 2026 IST. Run once from the Apps
  Script editor; re-check per-snapshot row counts afterward to confirm
  dedup recovered (should drop back toward only-changed-leads volume, not
  a near-full-table rewrite every run).
- **A CH-level "backstop" issue email CC's people it shouldn't** (subject
  prefixed `(Unmatched RMs (backstop))` — the specific case of an RM
  matching NEITHER `RM_Hierarchy` NOR `Region_Recipients` at all): this
  was a real, confirmed bug through 2026-09-24 — reported by a maintainer
  off a real "(Unmatched RMs (backstop)) Navi Mumbai Google Overnight
  Leads" email that CC'd the two leadership addresses
  (`ALWAYS_CC_EMAILS_` — Ashish Kukreja / Saurabh Mishra). Fixed in
  `EmailInfra.gs`'s `resolveRecipientEmailsForRegion_` — this ONE branch
  no longer adds that CC, matching the sibling CH-level backstop
  (`notifyChLevelLeadsGs_`/`notifyChLevelIssuesGs_`, used when someone
  personally holds a lead with nobody below them), which already
  deliberately excludes leadership from this class of email. The
  DIFFERENT "Unmatched RMs" legacy `Region_Recipients` fallback (a
  human HAS configured an address for that region) still CC's leadership,
  unchanged — only the total-backstop case was wrong. See §4.3's own
  `ALWAYS_CC_EMAILS_` row.
- **A "Futwork" RM's leads reach someone other than Snehil** (the RM's name
  contains "Futwork", e.g. "Kajal Futwork"): by rule they go ONLY to
  `FUTWORK_ROUTE_EMAIL_` (`EmailInfra.gs`), as ONE `Futwork` email per job across all regions (regions spelled out at the top, each its own band; grouping key `FUTWORK_REGION_KEY_`).
  Before 2026-09-25 they fell into the "Unmatched RMs (backstop)" email to
  `CH_LEVEL_EMAIL_` because they aren't in `RM_Hierarchy`. If one still
  lands elsewhere, check that the live `EmailInfra.gs` has been re-pasted
  (a `.gs` edit isn't live until then), and remember Section 2 / 13:00
  follow-ups reuse the recipient STORED at 17:00, so rows logged before the
  rule was live keep their old routing.
- **A test run made the real send skip, or emailed the wrong people**
  (2026-09-24/25 incident, from the Step 10 live verification): with
  `TEST_MODE_OVERRIDE_EMAIL_` set, a live `sendAllIssuesEmails` run wrote
  real-looking `AllIssues_Log` rows (recipient = the tester), so that
  afternoon's real 17:00 run skipped every region (managers never got the
  report) and the next morning's Checkpoint 1 — which reuses the STORED
  17:00 recipient, never re-resolved — went to the tester instead of the
  managers (9 of 26 digests). Also found: the CH-level reports and a
  Section-2-only bucket ignored TEST MODE entirely and used real addresses.
  Fixed 2026-09-25: TEST MODE now writes NO production state
  (`writeUnlessTestModeGs_` — `AllIssues_Log`/`Overnight_Log` rows,
  checkpoint1/2, `followup_sent_at`), bypasses the region/follow-up
  idempotency guards so a test is repeatable, routes EVERY send (CH-level via
  `chLevelReportToGs_`, and Section-2-only) to the tester, and tags the
  digest subject `[TEST MODE]`. Limits: a TEST MODE 10:00 only sees Section 2
  for rows the real run hasn't already checkpointed, and the 13:00 job's
  `Lead_Followups` push still happens (an idempotent upsert). If polluted
  rows ever recur, delete that day's `AllIssues_Log` rows from the sheet
  (or adapt `removeTestModeAllIssuesRowsNow`, `AllIssuesEmailer.gs` - a guarded one-off
  that archives to Drive first). The 28 rows of the 2026-09-24 test run were removed
  that way on 2026-09-26 (archive: Drive `Leads Dashboard Archive/AllIssues_Log`).
- **The 13:00 follow-up crashed after only a few buckets** (2026-09-25,
  alert "sendOvernightFollowupEmails crashed — NO 1pm follow-up emails were
  sent", error "Your input contains more than the maximum of 50000
  characters in a single cell"): a Checkpoint 2 write of ~81,000 characters
  (9 test rows sharing one recipient, each already holding the full merged
  list, re-merged into 9 copies). Sheets reports a bad write on the NEXT
  sheet call, which was outside the try/catch around the write, so one
  bucket aborted the whole run — only the 3 buckets before it got a
  follow-up. Fixed: the merges are de-duplicated by `lead_id`;
  `writeUnlessTestModeGs_` flushes inside the guarded write; every JSON
  log-cell write is capped (`jsonForCellGs_`, 45,000 chars, ops alert on
  truncation); and the 10:00/13:00 loops isolate a throwing bucket (reported,
  the rest still send). Recovery for a missed 13:00: delete any polluted
  rows first, then re-run `sendOvernightFollowupEmails()` — buckets that
  already have `followup_sent_at` are skipped.
- **This whole §8 list is reactive** — real incidents, found after the
  fact. `OPS_CHECKLIST.md` (repo root, added 2026-09-09) is the proactive
  counterpart: periodic checks for RM-hierarchy gaps, `Manager_Directory`
  email gaps, `Movement_Log` capture freshness, and worst-performer
  methodology drift between `js/core-rm-performance.js` and
  `DailyRmIssueLog.gs` — the class of silent, slow-drifting gap that tends
  to surface HERE only once it's already caused a real symptom. Five of
  its checks now also run unattended, weekly (RM-hierarchy gaps,
  `Manager_Directory` email gaps, `Movement_Log` freshness, the workbook
  cell budget, and — added 2026-10-03 — a 30-day stale-dashboard-tab
  check) — see `OpsChecklistRunner.gs` in §4.3's trigger table below.
  `LEAD_FOLLOWUPS_STALENESS.md` is the same idea for one specific sheet —
  see the bullet just above.

---

## 9. Repeat Offenders (the Daily_RM_Issues subsystem)

Added 2026-09-01, iterated heavily that day and the next, and **redesigned
2026-09-04** — the ranking changed from "Avg Flagged" to the composite
RM-performance score (§9.7; §9.1 has the current summary). This is the
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

**How the tab ranks (post the §9.7 redesign, shipped 2026-09-04).** The
Repeat Offenders tab (`js/tab-repeat-offenders.js` + `js/core-rm-performance.js`
`computeRmPerformance`) no longer uses "Avg Flagged" (instances ÷ flagged
leads — see §9.7 for why that had no real denominator). It now ranks by a
**severity-weighted, workload-adjusted composite score**: for each of the
4 *scored* rules (Not Updated / Follow-up Overdue / Behind on Today's
Calls / Stuck 48h+ — "Inactive-RM Lead Added" is a routing issue, never
scored), the RM's violation-day rate over their **eligible book** (every
distinct lead eligible for that rule in the range, not just the flagged
ones) is shrunk toward the peer average — `shrunkRate = n/(n+8)·rawRate +
8/(n+8)·peerRate`, `RM_PERF_SHRINKAGE_K = 8` — so a tiny sample can't
dominate. The weighted sum across the 4 rules is the **Score**, shown
against the peer composite; a row is classified **Below Expectations** /
**Watch — concentrated** / **On Track** / **Insufficient Data** (< 5
distinct eligible leads). RM / Region / A1-TM / RH are **four independent
computations**, each with its own peer population — none is rolled up by
averaging another level. The eligible-population and instance counts are
reconstructed from `Movement_Log` (`reconstructRmPerformanceObservations`),
**not** read back from `Daily_RM_Issues` (which only holds flagged rows).

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

**2026-09-06 incident — the workbook's 10,000,000-cell ceiling, hit for
real**: `captureDailyRmIssues` crashed with `Exception: This action
would increase the number of cells in the workbook above the limit of
10000000 cells`, thrown from the chunked write itself
(`DailyRmIssueLog.gs:169` at the time). Root cause: `Daily_RM_Issues` had
**no retention at all** from the day it shipped (2026-09-01) until this
fix — every night's ~26,660 rows (see above) were appended forever,
unlike every other log tab in this project (`Movement_Log` has had
`pruneMovementLog_` since before this table existed). This is the exact
same failure class Movement_Log itself hit before `pruneMovementLog_` was
built — see that function's own comment in `MovementTracker.gs` for the
underlying mechanism (Google Sheets' 10M-cell cap is on the workbook's
*declared grid size*, summed across every tab, not on cells holding real
content — `clearContent()` alone never shrinks it back down, only
`deleteRows()` does).

**Fix**: `pruneDailyRmIssueLog_()` (`DailyRmIssueLog.gs`), same
rewrite-and-shrink approach as `pruneMovementLog_`, at a **7-day**
retention (`DAILY_RM_ISSUE_LOG_RETENTION_DAYS_`) — deliberately matching
`MOVEMENT_LOG_RETENTION_DAYS` rather than something longer: at ~26,660
rows/night x 13 columns, even 7 days is ~2.4M cells, and Movement_Log
alone already uses ~5.6M cells at its own 7-day retention — the two
tables together were already most of the 10M budget before this fix, and
nothing in this codebase actually reads `Daily_RM_Issues` back
programmatically (`reportRmPerformanceNow` deliberately reconstructs from
`Movement_Log` instead — see §9.3 below), so there was no reason to
gamble on a longer window. **Pruning runs BEFORE the nightly write, not
after** — the opposite order from `pruneMovementLog_`, and deliberately
so: once a sheet is already over the ceiling, an *after*-write prune can
never self-heal, because the write itself throws before pruning is ever
reached (this is precisely what happened here). A one-off manual recovery
function, `pruneDailyRmIssueLogNow()`, exists for exactly this situation
— same pattern as `pruneMovementLogNow()` — run it once from the Apps
Script editor's function dropdown to free capacity immediately if this
error ever resurfaces before the next scheduled capture. **This fix must
still be manually pasted into the live Apps Script project** (per
`CLAUDE.md`'s top gotcha — a `.gs` edit in this repo is not live until
copied over the matching file in Extensions → Apps Script and saved) —
but **no `setupXxx()` re-run is needed** for this specific change, since
it only changes what `captureDailyRmIssues_` does internally the next
time its existing trigger fires, not the trigger's own schedule. Tonight's
missed capture (2026-09-06) can still be recovered via
`backfillOneDayFromMovementLogNow('2026-09-06')` as long as
`Movement_Log`'s 7-day retention still covers that date.

**2026-09-24 incident — third occurrence, and why pruning order matters
across BOTH logs**: `captureDailyRmIssues` crashed again (22:53 IST,
`DailyRmIssueLog.gs`'s `pruneDailyRmIssueLog_` → `insertRowsAfter`, the
"grow to fit tonight" step added in the 2026-09-19 fix — it fails there BY
DESIGN when the workbook has no budget left, rather than mid-write). The
real cause was elsewhere: `snapshotOpenLeads_` (`MovementTracker.gs`)
writes new `Movement_Log` rows FIRST and prunes AFTER, and `snapshotPeriodic`
had been failing/timing out (Executions: last clean run 2026-09-23 12:44,
then 6 failures + a 30-minute timeout), so `Movement_Log` — the largest tab
— was likely going unpruned and the shared 10M budget kept shrinking. Same
"an after-write prune can't self-heal" trap as §9.2 above, in the other log.
**Fix**: `captureDailyRmIssues_` now calls `pruneMovementLog_` up front —
after the idempotency guard (a double-fire stays cheap), before the company
scan — in a try/catch so a failing prune never blocks tonight's capture.
**Known limits**: (1) it only frees space if `Movement_Log`
has rows older than its 7-day retention — `pruneMovementLog_` returns early,
touching nothing, when none are stale, so an over-allocated grid within
retention is not shrunk; (2) `snapshotOpenLeads_` itself still writes before
it prunes (moving it needs an incoming-row-count sizing step like
`pruneDailyRmIssueLog_`'s, since one run can write more than the 5000-row
headroom); (3) nothing caps the workbook's steady-state size — the durable
fix would be a separate log spreadsheet (not built; a real architectural
change, not a follow-up-sized item). Recovery if it recurs: `pruneMovementLogNow()`
then `pruneDailyRmIssueLogNow()` from the editor. Like every `.gs` change this
must be pasted into the live Apps Script project; no `setupXxx()` re-run
needed (no trigger changed).

**2026-09-28 follow-up — advance warning, not a capacity fix**:
`snapshotOpenLeads_` now also prunes right after its own write (closing
half of limit (2) above — it still writes before pruning, but no longer
*only* relies on the next `snapshotPeriodic` run to catch up), and the
Monday `[Ops Checklist]` email (`GS-009`) now reports the whole workbook's
declared cell usage every week — `computeWorkbookCellUsageGs_`/
`reportWorkbookCellUsageNow()` (`Core.gs`) sum `getMaxRows()*getMaxColumns()`
across every tab, WARN at 70% of the 10M ceiling, CRITICAL at 85% (naming
the top 3 tabs and, at CRITICAL, the exact recovery functions to run). This
gives days of lead time instead of finding out via a crash — it does not
reduce the workbook's actual steady-state size, so limit (3) is still open.

### 9.3 Utility functions (console-callable, `DailyRmIssueLog.gs`)

| Function | What it does |
|---|---|
| `captureDailyRmIssuesNow()` | Runs tonight's capture immediately (same logic the 22:50 trigger runs). Idempotent per IST day — a second run the same day does nothing. |
| `backfillDailyRmIssuesFromMovementLogNow()` | Reconstructs **every** day `Movement_Log` still retains (up to 7 days) that `Daily_RM_Issues` doesn't already have rows for, using each day's latest snapshot as a stand-in for the missed 22:50 capture. One combined write across all days found. |
| `backfillOneDayFromMovementLogNow(dayKey?)` | Added 2026-09-02, in response to the incident in §9.2. Same idea, but scoped to exactly **one** day — no argument defaults to yesterday. Lower blast radius than the multi-day version, and writes in chunks (see §9.2). This is the one to reach for after confirming a specific night is missing. |
| `repairDailyRmIssuesMissingFieldsNow()` | One-off repair for rows written before `TL`/`group_source`/`source_bucket`/`lead_assigned_at` existed in the schema — backfills them from `Movement_Log` by matching `lead_id` and nearest timestamp. Safe to re-run; leaves already-complete rows untouched. |
| `reportRmPerformanceNow()` | Logs a quick RM leaderboard straight to the Apps Script console — a lighter-weight sanity check than opening the dashboard. (Renamed from `reportRepeatOffenderRmsNow()` in the §9.7 redesign.) |

### 9.3.1 The lead-count denominator — "Unique Leads" (history)

**Current state (post §9.7 redesign):** the tab shows **one** count per
row — **Unique Leads**: the exact number of distinct leads eligible for
at least one *scored* SLA rule in the current range/filters — this
group's real book, computed inside `computeRmPerformance`
(`js/core-rm-performance.js`) from the reconstructed `Movement_Log`
observations. It is the denominator every rate in the Score column is
taken over. The old separate **Flagged Leads** / **Total Leads** columns
and the helpers behind them (`aggregateRepeatOffenders`,
`totalLeadsByKey`) were **removed** in the 2026-09-04 redesign — a single
"eligible book" count replaced both.

**Why this history still matters** (the lessons carried forward into the
current column):

- **A raw denominator is essential.** The whole reason "Total Leads" was
  added on 2026-09-03 — a PDF per-RM count that "looked too high" turned
  out correct, but there was no honest book to read it against — is
  exactly what "Avg Flagged" lacked and what the composite Score now
  builds in.
- **Count from `Movement_Log`, not the live `leads` tab.** The first cut
  (2026-09-03) used `allParsedLeads` (the live tab), which only ever
  holds currently-OPEN leads, so it silently missed every lead that had
  since closed. `snapshotOpenLeads_` (`MovementTracker.gs`) captures
  "every lead… open or closed", so the count survives a lead closing.
  `computeRmPerformance` still reconstructs from `Movement_Log` for the
  same reason.
- **Known limitation, unchanged:** `Movement_Log` is pruned to a 7-day
  rolling window (`MOVEMENT_LOG_RETENTION_DAYS`) — a lead closed **and**
  aged out past that window is not counted. Yesterday / Last 7 Days /
  This Week are within it; a Custom or All-time range reaching further
  back can undercount. Same category as §9.4's date-basis gotcha.

Wiring note (still current): `renderRepeatOffenders()` needs the
`Movement_Log` data, so `core-fetch-and-render.js` threads the SAME
in-flight `fetchMovementLog()` promise into Repeat Offenders' own
`Promise.all` — a promise takes multiple `.then()` subscribers, so this
adds no second network call.

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
reimplementation) via a disposable browser harness before commit.
Synced into the live Apps Script project manually the same day (per the
user, not independently re-verified from this session — see §4.3 on why
that sync is always a separate manual step from the git push).

### 9.6 `OUTCOME_RULES` keyword mining — added 2026-09-03

Requested after the §"Unmatched_Comments_Log de-dup bug" fix (see §8)
finally made the log trustworthy: with de-dup working, the ~2,500-row
export was mined by hand for new recurring patterns not covered by any
existing rule. Four changes landed in both `OUTCOME_RULES_GS_`
(`FollowupEngine.gs`) and `OUTCOME_RULES` (`js/core-outcome-engine.js`),
kept in sync per §6:

- **`Wrong Number` gained a `test` function** to catch a reversed phrasing
  the existing multi-word signals miss: "Number is invalid"/"No.is
  invalid" (noun-then-verb-then-adjective, not the existing "invalid
  number" signal's adjective-then-noun order) and "doesnt exist" as its
  own 2-word contraction (the existing "does not exist" signal needs 3
  consecutive words and can't match a contraction).
- **New outcome `Already With Another RM/CP`** — by far the single
  largest recurring bucket in the audited export: a customer already
  being worked by a different RM or channel partner ("already in touch
  with RM X", "already discussed with other rtmi"). Distinct from
  `Booked Elsewhere` (no purchase decision implied) and from `Needs
  Cross-Team Routing` (that's the RM requesting a hand-off; this is the
  customer reporting they're already someone else's).
- **New outcome `Channel Partner / Broker Lead`** — the lead itself is a
  channel partner/broker calling on a client's behalf, not the end
  customer ("He is cp", "Its a channel partners,"). Bare `'cp'` as an
  exact-match signal mirrors this file's existing precedent (`'ni'`,
  `'wn'`, `'cb'`).
- **New outcome `Voice Unclear`** — call connected (unlike `Disconnected`)
  but audio was unusable ("Voice not audible", "Voice was cracking").

**Patterns deliberately left out**, per this file's own established
discipline against guessing on ambiguous shorthand (same reasoning as the
`BPCL Not Shared` note above it in `FollowupEngine.gs`): bare "AA" and
"After answering" shorthand of unconfirmed meaning, and "bought/purchased/
booked at [named project]" comments, which carry the same
our-project-vs-competitor ambiguity already flagged as a reason to leave
a pattern out. Revisit if/when their meaning is confirmed with the team.

Verified two ways before commit: (1) a disposable browser harness running
25 real comment strings pulled directly from the audited export against
the real `inferOutcomeGs_`/`OUTCOME_RULES_GS_` (all pass), plus a second
harness confirming frontend/backend parity on a subset (all pass); (2)
the existing **`Tests_FollowupEngine.gs` suite run in full** against the
modified rule set — 106/106 pass, confirming the new rules (inserted
mid-array) didn't steal a match that used to belong to a pre-existing,
later rule.

### 9.7 RM Performance redesign — replaced "Avg Flagged" (shipped 2026-09-04; iterated 09-05 and 09-10)

> **Status: shipped and live.** The empirical-Bayes composite score
> replaced "Avg Flagged" in `js/core-rm-performance.js`
> (`computeRmPerformance`) and its `.gs` console mirror
> `DailyRmIssueLog.gs` (`reportRmPerformanceNow`, `RM_PERF_*_GS_`), and
> was iterated further on 2026-09-05 (§9.7.2) and 2026-09-10 (region-wise
> worst-5, `rmPerfCanonicalRmName` aliases, broadened leadership
> exclusion). For the current per-component picture see the catalog:
> `docs/tabs/TAB-004`, `docs/js-modules/JS-008` / `JS-017` / `JS-022`,
> `docs/gs-modules/GS-003`, `docs/data-flows/DATA-002`. The narrative
> below is the design record of the change; a deeper §9 reconciliation
> (function-name sweep, §9.1/§9.3/§9.4 wording) is tracked in
> `docs/_planning/documentation-conflicts.md` C-5 / C-6.

**Why**: `Avg Flagged` (Instances ÷ Flagged Leads, §9.3/9.4's ranking key)
has no real denominator — it's conditioned on leads that are ALREADY
flagged, never on an RM's actual book, so it can't distinguish "2 of this
RM's 30 leads went chronically bad" from "both of this RM's 2 total leads
went chronically bad" (identical score, radically different stories). Full
first-principles rationale (why the old logic is wrong, what "below
expectations" should actually mean, denominator analysis, small-sample
handling, worked examples) was worked out in chat before any code was
written — ask for that writeup if it's not already in this session's
history. User decision: **replace** the existing Repeat Offenders tables
outright (not add the new metric alongside them), delivered in phases —
dashboard engine first, then live-tab wiring, then PDF export, then the
`DailyRmIssueLog.gs` console leaderboard, each phase independently
verified and committed.

**Phase 1 (done) — `js/core-rm-performance.js`**: the reconstruction +
aggregation + classification engine, no UI wiring yet (the existing
Repeat Offenders tables are UNCHANGED and still live). Core idea: for
every (lead, calendar day, one of the 5 SLA rules), was the lead ELIGIBLE
for that rule that day, and did it pass or fail — rolled up per RM per
rule into violations ÷ eligible lead-days, a real rate, then adjusted for
small samples (empirical-Bayes shrinkage toward a peer average, weighted
by DISTINCT LEADS not lead-days, since consecutive-day violations on one
lead are correlated observations, not independent trials) and weighted by
rule severity into one composite score, gated by a minimum-volume
threshold before classifying an RM as anything other than "Insufficient
Data".

**Reuses existing infrastructure entirely — no SLA logic reimplemented a
third time.** `computeRmPerformance` re-derives eligibility AND outcome
for all 5 rules by re-running `enrichLead` (via the ALREADY-EXISTING
`enrichLeadAsOf`/`enrichSnapshotCached` helpers, `tab-movement.js` —
previously only used by the RM Stall Leaderboard/Time to Opportunity)
against each day's `Movement_Log` snapshot — not `Daily_RM_Issues`, which
only ever stores the single highest-priority issue per lead per night
(`ISSUE_PRIORITY`) and never records a lead that was eligible and PASSED,
making it structurally unable to supply a true denominator.
`Movement_Log`'s snapshots already carry every raw field `enrichLead`
needs (confirmed against `MovementTracker.gs`'s own `SNAPSHOT_COLUMNS_`),
so this needed no new capture-side changes — same 7-day retention caveat
as `totalLeadsByKey` (§9.3.1) applies here too.

Per-rule eligibility gates are derived purely from fields `enrichLead`
already returns (`ageHours`, `isUnder48h`, `hasConnected`,
`neverConnectedPastWindow`) plus two cheap local derivations (`pastGrace`
from `ageHours`, `isCreatedThatDay` via `istSameDay`) — see the file's own
header comment for the full per-rule table. `inactiveRmNewLead` is
DELIBERATELY excluded from the composite score (it's an assignment/
routing failure, not an RM execution failure) but still tracked
separately as `routingIssueDays` on each classified result.

**A real design fix found via building the verification harness, not
before**: "concentrated" (a case-management question — go check 1-2
specific leads) vs "broad" (a coaching question — the RM's whole book is
affected) was first defined as `chronicLeads / distinctViolatedLeads`
(share of violated leads that are chronic) — but that can't tell "6 of
this RM's 6 leads are ALL chronically bad" (breadth 100%, arguably the
worst case there is) apart from "2 of this RM's 30 leads are chronically
bad" (breadth 6.7%, genuinely a small-case problem) — both read as "every
violated lead is chronic" under that ratio. Fixed to use BREADTH instead
(`distinctViolatedLeads / distinctEligibleLeads <= 25%`, combined with
"at least one chronic lead") — caught by hand-computing the fixture's
expected numbers before running it, not by the test itself.

Verified via `_verify-rm-performance.html` (disposable, deleted after
use): 32/32 assertions, in two parts — (1) a hand-built multi-day
`Movement_Log` fixture run through the REAL `reconstructRmPerformanceObservations`/
`aggregateRmPerformance`, checking exact eligible/violation lead-day
counts against hand computation, including a specific regression case for
the streak-vs-gap logic (a lead violated on day 1 and day 3 with a
COMPLIANT day 2 between them must NOT read as a 2-day streak — proven via
`_rmPerfDaysBetweenKeys`' calendar-adjacency check, not just "consecutive
array entries"); (2) a direct unit test of `classifyRmPerformance` against
a hand-built peer pool (a modest, realistic ~7%-rate baseline, NOT mixed
with the intentionally-extreme test RMs — an early version of this test
mixed them and produced 2 failures that were test-design bugs, not module
bugs: an extreme outlier in the same peer pool inflates the peer average
enough to make a genuinely-elevated RM read as "normal by comparison"),
covering all 4 classification branches (Insufficient Data / On Track /
Watch — concentrated / Below Expectations) plus confirming
`inactiveRmNewLead` truly never moves the composite score. No real
`Movement_Log` data has been checked yet (needs a signed-in live session)
— flagged as the natural next confirmation once Phase 2 wiring makes the
numbers visible in the UI.

**Phase 2 (done) — live tab wiring, tables replaced outright.**
`renderRepeatOffenders()`/`repeatOffenderTableHtml()` (`js/tab-repeat-offenders.js`)
now call `computeRmPerformance()` directly instead of `aggregateRepeatOffenders()`
— the old "Top 20 RMs / Leads > 50 / By Region / Top 10 A1-TM / Top 5 RH"
tables are gone, replaced by the same 4 groupings (RM/Region/A1-TM/RH) run
through the new engine and rendered by a new `rmPerformanceTableHtml()`
(`repeatOffenderTableHtml` itself was dead code after this and removed —
nothing else called it; the PDF export still uses `aggregateRepeatOffenders`
directly, untouched, so it stays defined for Phase 3). New columns:
**Workload** (distinct eligible leads), **Status** (the 4-value
classification, as a colored chip — red/amber/green/dim matching this
dashboard's existing `.chip` variants), **Score** (composite vs. peer
composite), **Driven by** (the 1-2 scored rules actually pushing an
elevated score, worst first, shown only for Watch/Below Expectations rows
— filtered to rules with a REAL violation, not just a nonzero
shrinkage-blended rate). Sorted by classification tier first (Below
Expectations → Watch → On Track → Insufficient Data), composite within
each tier — not pure composite, since shrinkage means even a clean RM
carries a small nonzero score and could otherwise outrank a real finding.

**A generalization made during this phase, not before**: `computeRmPerformance`/
`reconstructRmPerformanceObservations`/`aggregateRmPerformance`/
`classifyRmPerformance` all now take a `keyFn` (defaulting to RM), so the
exact same reconstruction/rate/shrinkage/classification pipeline serves
Region/A1-TM/RH rollups too — mirroring how `aggregateRepeatOffenders(rows,
keyFn)` already generalizes across the old 4 tables. The observation/output
field carrying the group name was renamed `RM` → `name` accordingly.
Re-verified after the generalization (not assumed safe): the same 25
RM-keyed assertions from Phase 1's harness, still passing, PLUS new
assertions proving a region-keyed reconstruction produces the same
underlying numbers under a different grouping, and that a `keyFn`
resolving to null/'' (an unresolvable A1-TM/RH lookup) excludes the record
entirely rather than silently bucketing it as "Unassigned" — same
population rule `aggregateRepeatOffenders`/`totalLeadsByKey` already use.

Section gating also moved from `dailyRmIssuesFetchState` to
`movementFetchState` (this section no longer reads `Daily_RM_Issues` at
all) — the static filter-summary text (`dashboard.html`) was rewritten to
match: no more "Leads/Instances/Avg Flagged" or the old assigned-vs-
captured date-field split (the new engine always matches a lead-day
against its own Movement_Log observation day, which is the correct basis
for a rate that measures exposure, not a one-off assignment event).

Verified via two disposable harnesses (both deleted after use): (1) a
regenerated engine-level harness confirming the `keyFn` generalization
didn't change RM-keyed behavior (25/25) plus the new region-keyed/
null-key assertions (25/25 total, see above); (2) a DOM-level harness
that grafts the real `dashboard.html` body, drives `movementSnapshots`/
`movementFetchState`/`rmHierarchyFetchState` directly (bypassing the
network), calls `renderRepeatOffenders()` for real, and asserts on the
actual rendered HTML — 12/12 pass, including "no `undefined`/`NaN`
leaked into the markup", "Insufficient Data correctly suppresses the
'Driven by' callout even at a 100% raw rate", and "the hierarchy-missing
message renders in exactly both of the A1-TM and RH cards". Also
`tests/frontend-harness.html`'s own empty-history assertion was updated
(it checked for literal "Daily_RM_Issues" text in the notice — now checks
"Movement_Log", matching the new gating) and the full suite re-run clean,
26/26.

**Phase 3 (done) — PDF export rewired to match.** `js/repeat-offenders-pdf.js`
now calls `computeRmPerformance()` (via the same `sortRmPerformanceByPriority`/
`rmPerformanceDrivenBy` helpers the live tab uses — added to
`core-rm-performance.js` specifically so "what's driving an elevated
score" and "what order to list groups in" can never drift between the two
surfaces, both being plain JS) instead of `aggregateRepeatOffenders`/
`totalLeadsByKey`. Table titles/columns now match the live tab exactly
(RMs / By Region / A1-TM / RH; #, Name, Workload, Status, Score, Driven
by — 6 columns, down from 7). `usesAssignedDate` was retired entirely
(no longer meaningful — the new engine always matches a lead-day against
its own Movement_Log observation day, the same for every Time range
option, so there's no more "which date field" choice to make). Gating
moved from `dailyRmIssuesFetchState`/`dailyRmIssues` to
`movementFetchState`/`movementSnapshots`, matching Phase 2. The printed
header note was rewritten to explain the new columns instead of the old
"Total Leads" caveat (which no longer applies — there's no separate Total
Leads concept now, Workload IS the new denominator).

Verified via a disposable harness (deleted after use), 13/13 assertions,
in two parts: (1) `_repeatOffendersPdfTableRows()` called directly against
real `computeRmPerformance()` output from a hand-built fixture (a
6-lead RM chronically failing 3 of the 5 rules vs. a fully-compliant
6-lead peer) — checked exact row content (workload, classification,
"Driven by" text) column-by-column, not just "did it run". This also
caught a genuinely correct-but-non-obvious behavior worth noting: the
fixture's "Driven by" for the bad RM named `isNotUpdated` and
`stageStuck48h`, NOT `underCalledToday` — despite `underCalledToday`
having a higher rule weight — because the fixture's peer RM happened to
have an equally OLD book (so `stageStuck48h`'s peer baseline was ALSO
near 100%, correctly making it not a differentiating signal after
shrinkage), while the peer was fully compliant on calls specifically (so
`underCalledToday`'s peer baseline was near 0%, and Broad's real edge
over peer there should have dominated — worth a closer look if this
surprises anyone reading real output, though the shrinkage math checks
out by hand). (2) A true end-to-end run —
`_repeatOffendersPdfCurrentFilterInfo` → `_repeatOffendersPdfBuildPageSpecs`
→ `_repeatOffendersPdfRenderPages` — against real jsPDF + jspdf-autotable
(loaded from the same CDN URLs `dashboard.html` uses), confirming no
throw and a real multi-page `doc` comes back. Also re-ran the full
`tests/frontend-harness.html` suite clean, 26/26, confirming the Phase 3
changes didn't disturb anything Phase 1/2 already covered.

**Phase 4 (done) — `.gs` console leaderboard, `DailyRmIssueLog.gs`.**
`reportRmPerformanceNow()` replaces `reportRepeatOffenderRmsNow()`/
`computeRepeatOffenderRmsGs_` outright (same "replace, don't keep the old
metric alongside" call as Phases 2-3) — the function it replaces had the
exact same missing-denominator problem the whole redesign exists to fix,
one level further removed: it read `Daily_RM_Issues`, a violations-only
log with no record of a lead that was eligible and PASSED.

Reuses `computeSlaFlags_` (`SlaEngine.gs`) for every rule's actual
pass/fail outcome — no rule logic reimplemented a third time. The one
new piece is `computeRmPerfEligibilityGs_`, a ~15-line port of the
eligibility-WINDOW derivation (`pastGrace`/`isUnder48h`/
`isCreatedThatDay`/`hasConnected`/`neverConnectedPastWindow`) that
`computeSlaFlags_` computes internally but doesn't expose — mirrors
`js/core-rm-performance.js`'s own `RM_PERF_RULES` design exactly (a thin
eligibility layer on top of the rule engine, not a re-derivation of the
rules themselves). `reconstructRmPerformanceObservationsGs_` walks
`Movement_Log` grouped by `lead_id` (the `client_id`-level intermediate
grouping the browser engine's `buildMovementHistories` does is a no-op
here — `splitHistoryByCopy` immediately re-splits back to `lead_id`
anyway), keeps the LATEST snapshot per (lead, calendar day), and processes
day-by-day so `buildMovementLogMapsGs_` (a full rescan) runs once per
distinct day, not once per lead — same granularity
`backfillDailyRmIssuesFromMovementLog_` already uses.
`aggregateRmPerformanceGs_`/`computeRmPerfPeerAveragesGs_`/
`classifyRmPerformanceGs_`/`rmPerformanceDrivenByGs_`/
`sortRmPerformanceByPriorityGs_` are direct ports of the browser engine's
Stage 2-4 (pure arithmetic, zero DOM dependency, so these port
byte-for-byte modulo `function` vs arrow-function syntax to match this
project's established `.gs` style). **Scope, deliberately narrower than
the live tab**: RM-level only, no Region/A1-TM/RH rollups — those already
exist, fully verified, on the live dashboard; this console function's job
is a quick sanity check, not a duplicate delivery surface.

Verified two ways, since this machine has no local Node (the
`test/run-gs-tests.js` GitHub Actions harness is the only way to actually
execute `Tests_*.gs` here) and the local Apps Script test suite couldn't
be run before committing: (1) the exact same `{name, lead_id, dayKey,
rule, violated}` observation shape both engines share means Stage 2-4's
pure arithmetic could be cross-checked directly against the REAL,
already-proven `js/core-rm-performance.js` functions (`aggregateRmPerformance`/
`classifyRmPerformance`, zero browser dependency) via a disposable browser
harness (deleted after use) — 3 scenarios (Below Expectations/broad, Watch
— concentrated, Insufficient Data), each isolated in its own peer pool
(the exact "don't mix an extreme test RM into too small a peer pool" pitfall
this file's own Phase 1 section names), gave composite/peerComposite/
classification values matched exactly by hand computation before being
carried into `Tests_DailyRmIssueLog.gs`'s new `reportRmPerformanceNow()`
test block as Movement_Log-row fixtures reconstructing the identical
observations; (2) pushed to GitHub for the existing Actions CI
(`.github/workflows/test.yml`) to actually run.

**CI genuinely caught a real fixture bug on the first push (commit
`acfc1f4`)** — worth recording precisely because this is exactly the
scenario `run-gs-tests.js`/GitHub Actions exists for: a browser cross-check
of Stage 2-4's pure arithmetic against hand-built observation objects
isn't the same as the fixture's Movement_Log ROWS actually reconstructing
those observations through the real Stage 1. The rows' shared, fixed-old
`lead_assigned_at` made `stageStuck48h` (no stage/connection condition at
all — purely `past48h && pastGrace`) fire unconditionally for every row,
bad and clean alike, diluting Scenario A/B below their intended
classification thresholds. A concurrent session working the same CI
failure independently found and fixed a second, related contamination
(`underCalledToday`, via a dated comment-log fixture addition) before the
two sessions coordinated (each on this project's own concurrent-session
messaging) to avoid duplicating the fix. Resolved in commit `e8818bd`
(anchoring `lead_assigned_at` to 10h before each row's own snapshot
instead of one fixed date, plus matching `call_attempts` between the
"bad" and "clean" row builders) — CI confirmed green on that commit,
569/569 across the full suite.

Real `Movement_Log` data still hasn't been checked against any of this
(needs a signed-in live session) — worth doing now that all 4 phases are
wired end to end (engine → live tab → PDF → console).

**Deploying `.gs` changes**: same manual-copy step every prior `.gs`
change in this project has needed — Apps Script does not auto-deploy from
GitHub (§4.3). `DailyRmIssueLog.gs` needs re-pasting into the live Apps
Script project before `reportRmPerformanceNow()` is callable there for
real.

### 9.7.1 "Below Expectations only" filter — added 2026-09-04

Per explicit request ("i want below expectation only, and those which are
worst so that i can focus on them") — every table on the live tab AND
every table in the PDF export now shows **only** `classification ===
'Below Expectations'` rows. `On Track`, `Watch — concentrated`, and
`Insufficient Data` are still fully COMPUTED (the peer average and
shrinkage genuinely need the whole group, not just the bad rows) but
never displayed — dropped entirely, not just de-emphasized. Confirmed via
`AskUserQuestion`: `Watch — concentrated` (a real, actionable finding —
1-2 chronically-bad leads) is deliberately excluded too, not just
`On Track`/`Insufficient Data` — the user's own words: "i only want to
weed out the worst performers."

Two new shared functions in `js/core-rm-performance.js`, alongside
`sortRmPerformanceByPriority`/`rmPerformanceDrivenBy` (same reasoning —
one filter used by both the live tab and the PDF, never two copies that
could drift):

```js
function filterRmPerformanceWorst(list){
  return list.filter(r => r.classification === 'Below Expectations');
}
```

Callers run `sortRmPerformanceByPriority(filterRmPerformanceWorst(list))`
— the priority sort still works unchanged (its classification-tier
comparison degrades to a no-op once every row shares one tier, sorting
purely by composite descending, worst first).

**Empty state redesigned as good news, not an error.** An empty
"Below Expectations" table now means nobody currently qualifies —
`rmPerformanceTableHtml`'s empty-row message and the PDF's "no data"
status text were both reworded to say so explicitly (not the old generic
"nothing to show", which reads like something broke).
`#repeatOffendersCount` now reports the FILTERED count ("2 RMs below
expectations"), not the total number of RMs with any eligible lead-day.

**Real fixture-testing catch during verification, not assumed safe going
in**: an initial harness assertion expected a single-region test fixture's
Region rollup to ALSO read Below Expectations (since it aggregates the
same bad RM) — it read On Track instead. Root cause, confirmed by
inspection, not a bug: with only ONE region in the fixture, that region
has no peer to compare against (the peer average IS itself), so it can
structurally never read as "elevated relative to peer" — correct,
pre-existing shrinkage/classification behavior (Phase 1), unrelated to
this filter. Fixed the test assertion, not the code.

Verified via a disposable harness (deleted after use), 12/12 assertions:
a 3-RM fixture (one clearly Below Expectations, one On Track, one
Insufficient Data) confirmed the Below-Expectations RM appears and the
other two are excluded from BOTH the live-tab DOM and the PDF row-builder
output, the count/status text update correctly, and an all-clean fixture
renders the new friendly empty-state message rather than looking broken.

### 9.7.2 Root-cause investigation ("seriously wrong, not working") — 2026-09-05

User report, verbatim in spirit: the Repeat Offenders tab looked broken,
and existing verification hadn't caught it. Explicit instruction: distrust
every existing assumption, re-derive from first principles, prove
correctness with evidence the same implementation didn't produce.

**What was actually checked, live, against real production data (not
synthetic fixtures)**, using a signed-in Claude-in-Chrome session:
- Independently hand-reconstructed one real RM's (Sanjay Gupta,
  2026-09-03) eligible-lead-day count straight from raw `Movement_Log`
  fields, using hand-written open/closed/age logic — deliberately NOT
  calling `enrichLead` or any function under audit. First attempt used a
  flawed methodology (filtered by RM before picking each lead's true
  latest snapshot of the day) and produced a false "88 raw leads vs 15
  reported workload" alarm. Redone correctly — matching
  `reconstructRmPerformanceObservations`'s actual method: pick the TRUE
  latest snapshot of the day first, THEN check whose RM it shows (handles
  reassignment correctly) — it produced 26 correctly-attributed lead-days,
  14 of them open-past-3h by the same from-scratch logic. The engine's own
  reported workload: 15 (the +1 is `isNotUpdated`'s extra
  `neverConnectedPastWindow` eligibility path, which doesn't require the
  3h grace — exactly explains the gap). **Conclusion: the classification
  pipeline is correct for this real case; my own first verification
  attempt had the bug.**
- Verified the shrinkage arithmetic directly from raw observation counts:
  `followupOverdue` peer rate = 667 violated ÷ 903 eligible lead-days =
  0.7386, and a zero-eligible RM's `shrunkRate` for that rule came back as
  exactly 0.7386 (100% peer weight when `distinctEligibleLeads=0`, per the
  shrinkage formula) — confirms the formula is implemented as specified,
  not just "looks plausible."
- Confirmed via GitHub's own API (`check-runs`) and a direct HTTP fetch of
  the live URL (bypassing browser cache) that the deployed code matches
  the repository — not a caching illusion.

**Two real, confirmed defects found and fixed** (a genuine root cause,
not the calculation logic):
1. **A fully dead, gating network fetch.** `fetchDailyRmIssues()`
   (`js/tab-repeat-offenders.js`) still fetched all of `Daily_RM_Issues`
   on every page load and was one of the 3 members of the `Promise.all`
   that gates `renderRepeatOffenders()` — but a full-codebase grep
   confirmed the `dailyRmIssues` array it populated was never read by
   anything, anywhere, since the 2026-09-04 redesign moved this section
   onto `Movement_Log`. Live-measured cost: **41,718 rows, 2.4s**, for
   zero benefit. Removed entirely — the function, its module state
   (`dailyRmIssues`/`dailyRmIssuesFetchState`/`dailyRmIssuesFetchError`),
   its constants (`DAILY_RM_ISSUES_TAB_NAME`/`DAILY_RM_ISSUES_COLUMNS`),
   and its slot in `core-fetch-and-render.js`'s `Promise.all`. Also
   removed `aggregateRepeatOffenders`/`totalLeadsByKey` — the old
   pre-redesign aggregation functions, confirmed dead by the same grep
   (nothing called either one anymore; the PDF export was already rewired
   in Phase 3).
2. **A real, unindicated ~12-second load.** `Movement_Log` has grown to
   **232,607 rows** at current real scale; a live-measured fetch took
   **~12 seconds**. `renderRepeatOffenders()` already showed a "Loading
   Movement_Log history…" message during this wait (confirmed present and
   correctly wired — an earlier hypothesis that there was NO loading
   state at all was investigated and disproven), but it was static for
   the entire ~12+ seconds with no progress signal, while every other tab
   in the dashboard renders near-instantly by comparison — a plausible,
   evidence-backed explanation for "feels broken" that has nothing to do
   with correctness. Fixed: `fetchMovementLog()` (`js/tab-movement.js`)
   now records `movementFetchStartedAt`; `renderRepeatOffenders()`'s
   loading branch shows real elapsed seconds and self-schedules ONE
   re-render 1s later (guarded by `_repeatOffendersLoadingPollScheduled`
   against stacking multiple timers) purely to refresh that number — it
   never re-fetches anything, and stops rescheduling itself the moment
   `movementFetchState` stops being `'loading'`.

**Not found to be a bug, but worth flagging to ops as a real number worth
a gut-check**: the company-wide `followupOverdue` rate is genuinely
73.9% (667/903 real lead-days, verified above) — high enough to be
surprising, but it's the same `followupOverdue` rule Operations has used
since before this redesign, just newly reused here for scoring. Not
something this investigation changed or should change without a business
conversation.

Verified via two disposable harnesses (deleted after use): the existing
`tests/frontend-harness.html` suite re-run clean (25/26, the 1 failure
the same pre-existing, already root-caused time-of-day flake from
§9.6/§9.7.1 — unrelated; **that flake is fixed as of 2026-09-10 by
freezing the harness clock, see §7.2**); and a dedicated 9-assertion harness
specifically exercising the new elapsed-time poll (confirms it shows 0s
immediately, ticks up on its own without any external re-render call,
never stacks more than one pending timer, and — critically — stops
rescheduling itself once loading finishes, rather than looping forever).

### 9.7.3 RM Opp-Conversion join — Same-Day/48h Opp% as a second signal, 2026-09-29

**Why**: the violation-rate composite score (§9.7) measures process
compliance — did the RM follow the 5 SLA rules — but never whether their
leads actually *converted*. A user request to think about better logic
for finding a problematic RM specifically on Google leads led to this:
join the existing violation engine with a NEW, RM-level Same-Day/48h
Opp-conversion signal, so a manager can see who is **both** high-violation
**and** low-conversion — a materially stronger "needs coaching" signal
than either alone, since a high violation rate that still converts fine
might just mean the SLA rules don't fit that RM's real working style,
while low conversion with a clean violation record might be a lead-quality/
territory problem, not a coaching one. Two are needed together to be
confident it's genuinely the RM.

**Two constraints confirmed by Snehil before building anything, closing
off two directions an initial audit raised:** (1) Non-UTM and Search (and
whatever else is in the active Sub-source filter selection) are pooled
into ONE peer group — never split into separate per-bucket peer pools;
(2) no new filter UI of any kind — no quick-preset button, no dedicated
Google view. The feature works exclusively through whatever the existing
shared Project/Region/TL/Source/Sub-source filter bar already has
selected, same as every other column in this section already does.

**Why Movement_Log-based, not `opp_at`-vs-live-`leads`-array (the Opp
Monitor tab's own live-computation method, `js/tab-oppmonitor.js`
`_oppMonitorComputeLiveMetrics`)**: that method reads a lead's CURRENT
RM off the live sheet — if a lead was ever reassigned, it would silently
credit/blame whoever holds it NOW, not whoever actually worked it during
the window being judged, which is disqualifying for an RM-attribution
feature. This join instead attributes each Movement_Log lead-copy to the
RM shown on its OWN first captured snapshot — historically accurate, and
the exact same attribution the violation engine already uses, so the two
joined signals are guaranteed to share one peer population (same filter,
same leadership exclusion, same name canonicalization) rather than two
subtly different ones. **A real, deliberate consequence: these numbers
will not exactly match the Opp Monitor tab's own company-wide monthly
Same-Day/48h Opp% for the same segment** — different method, different
population (Movement_Log's 7-day retention + per-copy attribution vs.
Opp Monitor's live-leads-array, whole-history method) — documented, not
"fixed" to reconcile.

**Design decision: a parallel signal, joined at display time — NOT a 5th
classification tier.** `classifyRmPerformance` has a `.gs` twin with a
numeric-parity check (`test/check-runtime-parity.py`), and its 4
classification strings drive sort order, chip styling, and the PDF —
touching them would be high-risk for an engine already verified against
real production data (§9.7.2). Instead: `reconstructRmOppCohort` →
`aggregateRmOppConversion` → `classifyRmOppConversion` computes the
conversion side entirely independently, and `joinRmOppConversion` merges
it onto each violation-engine row afterward, copying every existing field
through completely unchanged and adding `opp`/`oppBasis`/`oppPeer`/
`doubleFlag`. `doubleFlag` requires BOTH an elevated violation
classification (Below Expectations or Watch — concentrated) AND
`lowConversion` — neither alone is enough.

**No `DailyRmIssueLog.gs` port** — existing precedent (§9.7 Phase 4): the
console leaderboard is "a quick sanity check, not a duplicate delivery
surface" and already deliberately skips the Region/A1-TM/RH rollups the
live tab has. Stronger reason here: `reconstructRmPerformanceObservationsGs_`
is UNFILTERED by design (its own comment: "no dashboard top-bar filter
concept applies to a console function") — the Source/Sub-source scoping
this feature exists for can't even be expressed there. New constants are
named `RM_OPP_*`, not `RM_PERF_*` — every `RM_PERF_*` constant has a `.gs`
twin that must stay numerically identical (§6); `RM_OPP_*` has none, by
design, same precedent as the browser-only `REPEAT_OFFENDERS_REGION_RM_CAP`.

**The threshold math, and why `RM_OPP_LOW_RATIO=0.5` is not a literal
mirror of `RM_PERF_FLAG_RATIO` (1.25):**

```
per table:  basis = (Σ 48h-complete leads >= 0.5 x Σ leads assigned in range) ? '48h' : 'sameDay'
            peer[basis] = Σ opp / Σ resolved, pooled over every group (volume-weighted)
per group:  n = leads with evidence on that basis; raw = opp / n
            shrunk = n/(n+8) * raw + 8/(n+8) * peer[basis]
            lowConversion = n >= 5 && peer[basis] > 0 && shrunk <= 0.5 * peer[basis]
doubleFlag = classification in {Below Expectations, Watch — concentrated} && lowConversion
```

Each lead here gives ONE yes/no outcome — far less evidence per lead than
a violation rate built from many lead-days. At peer=20% and a literal
0.8-style ratio, an RM converting at EXACTLY the peer rate still
false-flags ~33% of the time even at n=10 (barely improves with more
data). At 0.5 that drops to ~11% at n=10, ~7% at n=20, and keeps falling;
with K=8 an RM needs ≥8 leads before a 0%-raw rate can even reach the
threshold at all, so tiny samples can't trigger it alone; a genuinely bad
RM (true rate 5% vs peer 20%) is still caught ~74% of the time at n=20.

**Real constraint found and worked around during planning, not
discovered live:** `evidenceAtDeadline` (the shared "status as of a
deadline" lookup the Tracking tab's cohort computations already used)
lived in `js/tab-tracking.js`, which runs `document.addEventListener` at
module-parse time — `js/rm-performance-worker.js`'s `importScripts()`
would throw immediately trying to load it in the Worker. Moved verbatim
to `js/tab-movement.js` (no DOM code at parse time, already
`importScripts`-able), same relocation reasoning `core-rm-performance.js`
itself was moved for on 2026-09-06. Its own callers (`computeZeroTo48hCohort`/
`computeDailyCohortByRegion`, `js/tab-tracking.js`) are unaffected — a
global function, callable regardless of which file defines it. **A
known, separate bug in its `liveLead` fallback was found, not fixed**:
it reads `liveLead.oppOrAbove`/`.isOpenLead`, fields only `enrichLead`'s
own return value sets — nothing wires them onto a raw `allParsedLeads`
row, so a caller passing one through gets `{undefined, undefined}`, not
a real answer. `reconstructRmOppCohort` always passes `liveLead=null`
specifically to avoid depending on this path at all; the Tracking tab's
own pre-existing calls are unaffected either way (same behavior as
before this session). Flagged as a real follow-up task, not fixed here.

**The Worker needs `nowMs` passed in explicitly, never `Date.now()`
internally** — `tests/frontend-harness.html` freezes `Date` on the main
thread only (§7.2); a Worker runs on its own real wall clock and would
silently disagree with both the synchronous fallback path and the test
harness if it ever called `Date.now()` itself. `runRepeatOffendersRecalculation`
(`js/tab-repeat-offenders.js`) now sends `nowMs` in the Worker's
`postMessage` payload; `_runRepeatOffendersSynchronously` receives the
same `now` via its own `ctx`.

**Verified**: `tests/frontend-harness.html` §2g, 9 sub-tests covering the
cohort/lag guard, the peer-average arithmetic and low-conversion
threshold exactly (mutation-checked by hand — disabling either the
0.5-ratio threshold or the 12h lag guard makes the matching assertion
fail, confirmed then reverted), the `doubleFlag` truth table, same-filter
population parity between the two engines, no regression on any existing
field, region-restricted peer averages, and a real-Worker async test
proving `nowMs` threading actually works (a lead created at the frozen
test "now" reads as pending48h, not resolved — it would read resolved if
the Worker silently used its own real clock instead). Full suite:
132/132 pass.

**Real bug caught before this ever ran live**: `aggregateRmOppConversion`'s
default `keyFn` initially read `entry.rec.RM` inside a lambda that was
actually called as `getKey(entry.rec)` — i.e. it read `.rec.RM` off an
ALREADY-unwrapped record, throwing `Cannot read properties of undefined
(reading 'RM')` the moment any table without an explicit `keyFn` (the RM
level, and the synchronous fallback path) tried to run. Caught by the
`tests/frontend-harness.html` run itself (a real Worker construction
failure cascading into the synchronous fallback, which then threw) before
ever reaching a live signed-in session. Fixed to `rec => rmPerfCanonicalRmName(rec.RM)`,
matching `reconstructRmPerformanceObservations`'s own default exactly.

**Follow-up tasks flagged, not part of this change:** (1) the
`evidenceAtDeadline` live-fallback bug above; (2) whether Movement_Log's
content-hash dedup (fully effective since 2026-09-25/26) is thinning the
violation engine's own observations for days with no real change — found
worth checking, not confirmed broken, does not affect the Opp-conversion
side; (3) `js/tab-oppmonitor.js`'s own live-computation fallback
(`_oppMonitorComputeLiveMetrics`) has no Google/Non-UTM/Search filter in
its code at all, despite its header comment claiming it matches the
external workflow's scoping — found while researching this change,
unrelated to it.

### 9.7.4 Vendor (Futwork) + admin exclusion — added 2026-09-29

**Request**: "remove agents that have 'futwork' in their name from
list, also remove Snehil Chhimwal from list." Both are excluded
ENTIRELY from the RM Performance engine (RM table, Region/A1-TM/RH
rollups, the §9.7.3 Opp-Conversion join, the console leaderboard) — the
same Stage-1 drop `rmPerfIsLeadershipExcluded` already applies to
leadership, not merely hidden from display, so neither can inflate a
peer average or a region's distinct-RM count either:

- **Futwork agents** — tele-calling vendor staff. `EmailInfra.gs`
  already treats any Movement_Log RM name containing "Futwork"
  (case-insensitive) as a vendor agent for email-routing purposes
  (`isFutworkRmNameGs_`, §6); `RM_PERF_VENDOR_NAME_PATTERN`/`_GS_`
  (`/futwork/i`) reuses that exact same convention here, matched by
  pattern (not a fixed name list) since vendor agents rotate.
- **'Snehil Chhimwal'** — the dashboard's own account holder/admin, not
  a front-line RM. `RM_PERF_ADMIN_NAME_EXCLUSIONS`/`_GS_`, an exact-name
  Set (parity-checked, unlike the regex constant above — see its own
  code comment for why a regex literal isn't one of
  `check-runtime-parity.py`'s checkable shapes).

Both constants are OR'd into `rmPerfIsLeadershipExcluded`/
`rmPerfIsLeadershipExcludedGs_` alongside the existing leadership-role
and leadership-name paths (`js/core-rm-performance.js` FN-060,
`DailyRmIssueLog.gs` — the function's name predates this broader scope
and was deliberately kept, since callers/tests/docs already reference
it by that name). Because §9.7.3's Opp-Conversion cohort reuses this
same function, the exclusion applies there automatically too — no
separate change needed on that side. Docs: `JS-008` CFG-075/FN-060,
`GS-003` CFG-076. Tests: `tests/frontend-harness.html` §2d-2 (5 new
assertions) + `Tests_DailyRmIssueLog.gs` (5 new assertions) — full
suites 137/137 (frontend) and 1192/1192 (backend, via
`test/run-gs-tests-headless.py`) after the change.

### 9.7.5 Posterior-confidence flagging — added 2026-09-30

**Why**: signed into the live dashboard to investigate a direct user
question ("why does Google Non-UTM/Search show 0 RMs Below Expectations")
and found a real, structural gap. `classifyRmPerformance`'s `composite`
is already an empirical-Bayes shrinkage POSTERIOR MEAN — confirmed
algebraically, `shrunkRate = (n/(n+K))*raw + (K/(n+K))*peer` is exactly
the posterior mean of `Beta(K*peer+n*raw, K*(1-peer)+n*(1-raw))` with
`n = distinctEligibleLeads` — but classification only ever compared that
MEAN to `peerComposite * RM_PERF_FLAG_RATIO (1.25)`. Under a narrow
filter (confirmed live: Source=Google + Sub-source=Non-UTM/Search, Last 7
Days), per-RM `n` collapses to 5-16 leads; the shrinkage weight
(`K/(n+K)`, 44-62% at that range) pulls the mean back toward the peer
average regardless of how extreme the observed rate is, so nobody ever
crossed the ratio line — even RMs whose actual evidence would be quite
improbable under the peer rate by chance (several sat at 1.12-1.18x peer
on n=5-16, all reading "On Track").

**The fix** also computes the posterior's VARIANCE (not just its mean —
`rmPerfBetaPosteriorVariance`, the standard Beta variance formula) and
changes the decision rule from "is the point estimate above the ratio" to
"does a z-score against the ratio line, run through a normal-CDF
approximation (`rmPerfNormalCdf`, Abramowitz & Stegun 7.1.26, no library
needed), clear a confidence bar." Every existing field (`composite`,
`peerComposite`, `shrunkRate` per rule, etc.) is computed EXACTLY as
before — this only adds `compositeVariance`/`confidence` and changes the
one comparison that decides `classification`.

**Critical, counter-intuitive property — the threshold MUST sit below
0.5, this is not a typo.** Because `z` is centered exactly at
`peerComposite * RM_PERF_FLAG_RATIO`, `confidence >= 0.5` is
MATHEMATICALLY IDENTICAL to the old point-estimate rule (same
comparison, just via the sign of `z` instead of the raw composite) —
proven by hand and independently by a planning subagent. Raising the
threshold toward 0.8-0.9 (the "feels right" instinct for something named
"confidence") would make flagging STRICTLY MORE conservative than
today — the opposite of the goal. To actually catch more small-sample
problems the threshold has to sit below 0.5: it stops meaning "how sure
are we" in the everyday sense and means "does the weight of evidence lean
far enough past pure noise to act on it, even before the point estimate
itself has fully crossed the line." A future reader "fixing" this
constant back up above 0.5 would silently revert the whole feature to
today's behavior — see the constant's own prominent code comment in
`js/core-rm-performance.js`.

**Calibration, confirmed with the user via AskUserQuestion** (catch rate
for a genuinely-1.5x-peer RM vs. false-flag rate for an at-peer-rate
clean RM, both at n=5-16 — worked out by a planning subagent's Monte
Carlo / closed-form method):

| threshold | false-flag rate (clean RM) | catch rate (bad RM, n=5) | catch rate (bad RM, n=16) |
|---|---|---|---|
| 0.50 (= old rule, no change) | 6-7% | 36.5% | 68.2% |
| **0.40 — CHOSEN (violation composite)** | **10-13%** | **50.6%** | **78.1%** |
| **0.35 — CHOSEN (Opp-conversion)** | 13-18% | 58.6% | 82.3% |

`RM_PERF_CONFIDENCE_THRESHOLD = 0.40` for the violation composite (4
scored rules); `RM_OPP_CONFIDENCE_THRESHOLD = 0.35` for the §9.7.3
Opp-conversion signal (a single proportion). They're deliberately
different: the violation composite's `compositeVariance` is a documented
**anti-conservative** approximation (see next paragraph) — its threshold
is the more conservative of the two to partially offset that; the
Opp-conversion side has no such bias and can sit closer to its true
calibration.

**Known limitation, confirmed algebraically**: `compositeVariance = Σ
w_k² * var_k` treats the 4 scored rules as independent. They plausibly
correlate positively (a neglected lead trips several rules on the same
bad days), so this UNDERSTATES true variance — confidence numbers run
somewhat hot (anti-conservative), not the reverse. Not fixed here (would
need real covariance data this codebase doesn't have); documented as a
reason the violation-side threshold is the more conservative pick above.

**`.gs` port**: unlike the browser-only §9.7.3 Opp-Conversion engine,
this DOES get a full `.gs` port (`RM_PERF_CONFIDENCE_THRESHOLD_GS_`,
`rmPerfNormalCdfGs_`, `rmPerfBetaPosteriorVarianceGs_`,
`classifyRmPerformanceGs_` updated) — `RM_PERF_FLAG_RATIO` and its
sibling constants are already in `test/check-runtime-parity.py`'s
parity-checked pairs, meaning the project's own convention is that the
dashboard's classification and the console leaderboard's
(`reportRmPerformanceNow`) should agree, not just share constant values.
`RM_PERF_CONFIDENCE_THRESHOLD` is registered there too (a plain scalar,
parseable); `rmPerfNormalCdf`/`rmPerfBetaPosteriorVariance` (functions)
are not — kept in parity by hand, backed by identical reference-value
unit tests on both sides instead (4 known z→confidence values each).

**Fixture methodology, worth noting for future test-writers**: the
`tests/frontend-harness.html` fixtures were tuned EMPIRICALLY against the
real running engine (built a candidate fixture, called
`computeRmPerformance` directly via the browser console, read the actual
composite/confidence numbers, iterated) rather than hand-derived on
paper — the 4 scored rules have different weights AND different
eligibility gates (`stageStuck48h` and `followupOverdue` are mutually
exclusive by lead age; `isNotUpdated` keys off `canonicalStage`), so a
pure pen-and-paper calculation would have been fragile and error-prone.
The `Tests_DailyRmIssueLog.gs` fixtures, by contrast, reuse the file's
own existing `rmPerfBadRow_`/`rmPerfCleanRow_` helpers, which already
isolate `isNotUpdated` as the only rule that ever differs from its peer
average for any group in those fixtures — that reduces to a clean
single-rule Beta-Binomial problem, hand-derived by closed-form algebra
and confirmed correct on the first real test run (0 failures).

**Verified**: `tests/frontend-harness.html` +16 assertions (large-n
regression pair, the small-n reproduction of the originally-reported bug,
a degenerate-variance fallback check, an Opp-conversion mirror of the
first two, `rmPerfNormalCdf` reference values, and a rendered-HTML check
that the confidence annotation appears only on elevated rows) — full
suite 153/153. `Tests_DailyRmIssueLog.gs` +12 assertions (the same
large-n/small-n pair via `rmPerfBadRow_`/`rmPerfCleanRow_`, plus
`rmPerfNormalCdfGs_` reference values) — full suite 1204/1204 via
`test/run-gs-tests-headless.py`. `test/check-runtime-parity.py`: 15 plain
pairs checked, `RM_PERF_CONFIDENCE_THRESHOLD` clean.

**UI/PDF**: the computed confidence percentage is surfaced now (user
confirmed, not deferred) — `js/tab-repeat-offenders.js`'s
`rmPerformanceTableHtml` appends it next to the Status chip, and
`js/repeat-offenders-pdf.js`'s `_repeatOffendersPdfTableRows` appends it
to the Name cell's second line — both via the shared
`rmPerfConfidenceLabel` helper (`js/core-rm-performance.js`), only ever
shown for an elevated (Below Expectations / Watch) row, never for On
Track / Insufficient Data, and never when the degenerate fallback fired
(`confidence === null`).

**Not part of this change**: the §9.7.3 Opp-Conversion engine's own
`RM_OPP_*` constants stay browser-only (no `.gs` twin), same as before —
this change only added a confidence gate to its existing `lowConversion`
decision, it didn't change which runtime owns it.

### 9.8 "Behind on Today's Calls" could UNDERCOUNT a real interaction — fixed 2026-10-01

Root-caused via a read-only diagnostic against the live production sheet,
triggered by lead 2245665 (Riya Yadav, Minas Patel's Western team)
receiving a real, incorrect "Still open — Behind on Today's Calls"
follow-up email (`OvernightEmailer.gs` Checkpoint 1+2).

**What was wrong**: `computeSlaFlags_`/`enrichLead`'s `attemptsToday`, for
a lead not created today, is normally `call_attempts - baseline` (today's
real delta against the most recent pre-today `Movement_Log` snapshot — see
§6's own entry for why this exists at all: it was itself a 2026-0X fix for
the OPPOSITE failure mode, undercounting a lead that was called but never
commented on). Lead 2245665's `call_attempts` was identical to its own
pre-today baseline (11 = 11) despite a real, dated, TODAY-timestamped
"Calling Status/Comment : Not Reachable" entry in
`internal_status_comments` — a genuine interaction happened, it just never
incremented `call_attempts` for whatever reason on the CRM side. The delta
read 0, so the lead was flagged (and emailed) as behind, when a real
RM action had actually happened that day.

**The fix**: `attemptsToday` (both `SlaEngine.gs`'s `computeSlaFlags_` and
`js/core-lead-model.js`'s `enrichLead`, kept in sync as always) now takes
`MAX(delta, today's dated comment count)` instead of the delta alone. The
comment-count side (`countTodayCommentEntries_`/`loggedToday`) already
existed as the no-baseline-yet fallback; it's now computed unconditionally
and folded into the baseline branch via `Math.max`, rather than only ever
running when there's no baseline at all. This doesn't reopen the original
undercount problem the delta itself was built to fix — an uncommented real
call still wins via the delta, completely unaffected — and it closes the
new failure mode: a commented interaction the counter failed to increment
for can no longer be invisible to this check.

**Verified**: `Tests_SlaEngine.gs` +3 assertions (the exact incident shape
— 5 today-dated comments with a zero delta correctly clears the daily
minimum; 4 comments alone still correctly falls short of it, proving this
is a MAX, not an automatic pass; a real delta with zero same-day comments
still clears via the delta alone, unaffected) — full suite 1220/1220 via
`test/run-gs-tests-headless.py`. `tests/frontend-harness.html` +3
assertions, same 3 scenarios, calling `enrichLead` directly with
`_todayCallBaselineByKey` set by hand (the harness's own mocked
Movement_Log always comes back empty, so the full `fetchAndRender()`
pipeline alone can never populate a baseline and exercise this branch) —
full suite 156/156. Not tracked by `test/check-runtime-parity.py` (full
function logic, not a parseable constant — same category as
`rmPerfNormalCdf` in §9.7.5, kept in parity by hand instead).
