# Team Claude Hand-over — Leads Dashboard

**Audience:** a Claude instance (or a person) taking over this project from Snehil Chhimwal's *personal* Claude account, with no memory of any earlier session.
**Written:** 2026-10-10, by the personal-account Claude that built and deployed most of what is described here. State described: repository `master` at commit `2c99544` (plus this document); live Apps Script project matches that commit (47 non-private files, hash-verified 2026-10-10 17:27 IST).
**Safe to commit to the public repo:** yes — this file deliberately contains **no email addresses, passwords, tokens or Script/Sheet secrets**. Names of colleagues appear only where `HANDOVER.md` (already public) already names them.

> **How confident is each statement?** Where it matters, claims carry a tag: **[verified]** = checked against code, git or the live system on the date shown; **[recorded]** = taken from a repo document without re-checking; **[assumption]** = my own interpretation that Snehil has not explicitly confirmed; **[unknown]** = I could not determine it. Treat anything untagged as [recorded]. If a tag and the code disagree, the code wins.

---

## Table of contents

0. [How to use this document](#0-how-to-use-this-document)
1. [The project in one page](#1-the-project-in-one-page)
2. [People, accounts, and what does NOT migrate from the personal account](#2-people-accounts-and-what-does-not-migrate-from-the-personal-account)
3. [Working agreements with Snehil (the unwritten rules)](#3-working-agreements-with-snehil-the-unwritten-rules)
4. [Hard safety rules](#4-hard-safety-rules)
5. [The working environment](#5-the-working-environment)
6. [Architecture and file inventory](#6-architecture-and-file-inventory)
7. [Domain logic: leads, stages, SLA rules, comments, scope](#7-domain-logic-leads-stages-sla-rules-comments-scope)
8. [The daily clock: every trigger and what runs when](#8-the-daily-clock-every-trigger-and-what-runs-when)
9. [The email system in depth](#9-the-email-system-in-depth)
10. [The Email Operations System (evidence, alerts, recovery, bounces)](#10-the-email-operations-system-evidence-alerts-recovery-bounces)
11. [Data stores, retention and the 10-million-cell wall](#11-data-stores-retention-and-the-10-million-cell-wall)
12. [RM Performance / Repeat Offenders](#12-rm-performance--repeat-offenders)
13. [RM hierarchy and recipient routing](#13-rm-hierarchy-and-recipient-routing)
14. [The dashboard (browser side)](#14-the-dashboard-browser-side)
15. [Testing and quality gates](#15-testing-and-quality-gates)
16. [Deploying a `.gs` change (the live procedure)](#16-deploying-a-gs-change-the-live-procedure)
17. [The documentation system](#17-the-documentation-system)
18. [Written but unused, withdrawn, superseded or dormant — what, when, why](#18-written-but-unused-withdrawn-superseded-or-dormant--what-when-why)
19. [Decision log](#19-decision-log)
20. [Incident history and the lessons each one left](#20-incident-history-and-the-lessons-each-one-left)
21. [Open items, unconfirmed assumptions and first-run checks](#21-open-items-unconfirmed-assumptions-and-first-run-checks)
22. [Project timeline](#22-project-timeline)
23. [Your first week](#23-your-first-week)
24. [Glossary](#24-glossary)

---

## 0. How to use this document

This repository already holds roughly 12,000 lines of documentation. This file does **not** replace it — it is the map, the history and the reasons, written so a newcomer does not have to infer them. Read in this order:

1. This file, sections 1–5 and 18–21 (about 40 minutes). They contain what no other file does: the working agreements, the safety rules, and *why* things are the way they are, including everything that was built and then not used.
2. `CLAUDE.md` (repo root) — loaded automatically by Claude Code; the gotchas that cost time.
3. `HANDOVER.md` — architecture narrative and the incident list (§8). Sections 4.3.x are the most recent subsystem write-ups.
4. `docs/INDEX.md` — the per-component catalog (one record per file, tab, sheet, function group). `python3 test/whatis.py <filename>` prints the relevant record for any file in one command. **Run it before touching a file.**
5. `docs/EMAIL_OPS_OPERATING_MANUAL.md` and `docs/_planning/EMAIL_OPS_SYSTEM_AUDIT.md` — the Email Operations System, which is the newest and most operationally sensitive part.
6. `OPS_CHECKLIST.md` and `LEAD_FOLLOWUPS_STALENESS.md` — periodic and per-sheet checks.

**Authority order when documents disagree:** the code first; then `docs/` records (kept current by a CI check); then `HANDOVER.md`; then `LOGIC_AUDIT.md` (frozen on 2026-09-07 — it is *never* edited forward, its line numbers are stale by design); then this file's summaries. This file is a snapshot dated 2026-10-10 and will drift: when you change something described here, fix this file in the same commit (add a row to `FACT_CLAIMS` in `test/check-staleness.py` for any fact that tends to go stale).

**Where the detail lives** — pointers used throughout:

| Topic | Authoritative place |
|---|---|
| Any file / sheet / tab / function | `docs/INDEX.md` → the record (`GS-0xx`, `JS-0xx`, `SHEET-0xx`, `TAB-00x`, `EXT-00x`, `DATA-00x`, `FLOW-00x`) |
| Incidents | `HANDOVER.md` §8 (plus §4.3.x, §9.x for subsystem-specific ones) |
| Email audit that produced P1–P18 | `docs/_planning/EMAIL_AUDIT.md` |
| Email Operations System plan, decisions D1–D9, runbook | `docs/_planning/EMAIL_OPS_SYSTEM_AUDIT.md` |
| Two-checkpoint (10:00/13:00) lifecycle design | `docs/_planning/EMAIL_LIFECYCLE_TWO_CHECKPOINT_REDESIGN.md` |
| Nightly hierarchy sync design | `docs/_planning/RM_HIERARCHY_NIGHTLY_SYNC.md` |
| RM Performance maths | `HANDOVER.md` §9.7–9.7.5 |
| What is live in Apps Script | `docs/STALENESS_TRACKER.md` (deploy register + sweep log) |
| Trigger list | `docs/architecture/apps-script-triggers.md` (written 2026-09-10 — **out of date**; §8 below is current) |
| Unresolved documentation items | `docs/_planning/OPEN_ITEMS.md` |
| Dead-code audit | `docs/_planning/DEAD_CODE_AUDIT_2026-10-03.md` |

---

## 1. The project in one page

**What it is.** A lead-operations system for Homesfy's first-sale (developer/builder) real-estate leads, built on **one Google Sheet** (title "Region Wise Leads"; id `1QmYB1VqLMisiQXoed6-vSQqgA9nroGIMHsBInZafKGU`). A CRM export (the "Coefficient MySQL Import" add-on, refreshing about every other hour at varying times) fills the `leads` tab (~8,500 rows on 2026-10-10). Everything else is built on top of that tab.

**Two halves that never talk to each other directly** — they share only the Sheet:

1. **The dashboard** — `dashboard.html` + `js/*.js` (25 files, ~17,000 lines incl. HTML). Static, client-only, no build step, served by GitHub Pages from `master` at `https://snehilchhimwal-stack.github.io/leads-dashboard/dashboard.html`. A signed-in browser reads the Sheet via the Sheets API, renders eight visible tabs (one more is hidden), writes back (snapshots, follow-ups, SLA history, usage), and can send region-summary emails through a *separate* Gmail OAuth grant. Everything needs a human with a browser open.
2. **The Apps Script backend** — 22 production `.gs` files + `RmHierarchy.private.gs` + test files (~30,800 lines total including tests). Bound to the same Sheet, running unattended on time triggers: snapshotting leads four times a day, sending the 10:00, 13:00 and 17:00 emails to managers, auditing those emails, mailing Snehil a daily 16:30 report, and a few nightly jobs.

**Why two runtimes with duplicated logic.** A browser cannot import Apps Script and vice-versa, so SLA rules, comment-classification keywords, row parsing and a dozen constants exist twice. A one-sided edit makes the dashboard and the automatic emails silently disagree about the same lead. `python3 test/check-runtime-parity.py` diffs the data; `HANDOVER.md` §6 lists the pairs.

**What the automatic emails are.** Not marketing and not to customers: **internal** emails to managers (team leads, team managers, regional heads, cluster heads) about leads that break service-level rules. Scope is deliberately **Source = google, Sub-source = Non-UTM or Search** only; a non-Google lead's SLA issue has no automatic email path at all (only the dashboard's live view).

**The single most important operating fact.** *Apps Script does not deploy from git.* The copy that runs is the one pasted into the Sheet's Extensions → Apps Script editor. A `.gs` change in this repo is **not live** until someone pastes it and saves. Several real incidents were "the fix is committed but the bug is still happening". `docs/STALENESS_TRACKER.md` carries a deploy register, and `test/match-live-gs.py` verifies it from hashes read out of the live editor (§16).

**Scale and fragility to keep in mind.** The workbook is near Google's 10,000,000-cell limit (98.2% on 2026-09-28, 69.4% after cleanup, 5.37M on 2026-10-08), has dozens of tabs, and its spreadsheet service times out under load or right after a tab is added. Several incidents came from this (§11, §20). Apps Script executions have a 30-minute hard limit (`snapshotPeriodic` hit it three times in five days in early October, §20), and a single oversized `setValues()`/`getValues()` on a big range can fail or crawl.

---

## 2. People, accounts, and what does NOT migrate from the personal account

### 2.1 People (names only; addresses are in the git-ignored private file)

| Who | Role in this project |
|---|---|
| **Snehil Chhimwal** | Owner and sole decision-maker; the "ops address" that receives every alert and the 16:30 report; also appears in `RM_Hierarchy` with the Pre-Sales team (added 2026-10-01). Every `docs/` record says `Owner: Snehil` — the project was single-owner by design (`OPEN_ITEMS.md` §A). If a team now owns it, ownership is a per-record edit. |
| **Sakshi Sonawane** | Owns the **live** Apps Script project "Dashboard Google Leads" (shared with Snehil). Two identically named projects under Snehil's own account are stale 2026-09-12 copies — pasting into them changes nothing. |
| **Sushil Kannojiya, Ashish Ivlekar** | Receive the nightly RM-hierarchy sync report along with Snehil. Ashish Ivlekar is also the configured "CH-level" name (`CH_LEVEL_NAME_`). |
| **Ashish Kukreja, Saurabh Mishra** | Standing leadership Cc on region issue emails (`LEADERSHIP_NAMES_`, `RmHierarchy.gs`). |
| **Mayur Panjari** | Receives the whole Loan team's issue emails directly, no Cc (rule of 2026-10-03). |
| **Rajesh Muni, Manisha rathod** | Pre-Sales team leads whose issue emails Cc **only** Snehil (rule of 2026-10-01). |
| **Mukesh Mishra / Shitij Kaushal** | P&L heads Cc'd on Hyderabad+Bangalore / Thane+Navi Mumbai emails (rules of 2026-09-26 and 2026-09-30). |

### 2.2 Access you need (all granted by Snehil — you cannot self-provision these)

| Access | Why | Detail |
|---|---|---|
| Editor on the Sheet | read/write tabs, open the Apps Script editor | `HANDOVER.md` §4.1 |
| Editor on the live Apps Script project | paste code, run functions | owner is Sakshi; the signed-in browser account must have edit access |
| Google Cloud project membership | rotate/inspect the one OAuth Client ID | `HANDOVER.md` §4.2; client id is already public in the repo |
| GitHub push to `snehilchhimwal-stack/leads-dashboard` | ship dashboard changes and keep `.gs` copies in sync | Pages deploys on push to `master` within about a minute |
| The git-ignored `RmHierarchy.private.gs` | real employee name→email table; **without it routing silently degrades** to generic fallbacks and ops alerts fall back to the workbook owner | Must be handed over *out of band*, never through git. A copy of it exists inside the live Apps Script project; the repo working tree on Snehil's machine also holds it. |
| A Chrome sign-in with the Claude-in-Chrome extension | reading the live editor's file hashes and staging a paste | Snehil's own signed-in session; sign-ins are his, never sign out or change credentials |

**Which Google account the triggers run as** is a fact to confirm with Snehil **[unknown]**: Apps Script time triggers run as the account that ran each `setupXxx()`; that account's Gmail is the *sender* (display name "Homesfy Lead Ops") and its Drive holds the archive folder. On 2026-10-10 the triggers page showed "Owned by: Me" for the signed-in account.

### 2.3 What lives in the *personal* Claude account and will NOT follow you

Everything below is attached to the old account and must be recreated or consciously abandoned:

| Item | Status | What to do |
|---|---|---|
| **Auto-memory** (`~/.claude/projects/…/memory/*.md`, 20 notes) | Not transferable. Its content is **captured in §3, §4 and §5** of this file. | Decide whether to re-save them as your own memory; the substance is here. Two notes concern *separate* projects under `C:\Users\User\Desktop\Strategy\` (the To-Do Dashboard / Research Dashboard, and a finished booked-vs-non-booked "client journey" study) — they are **not** part of this repo, and Snehil asked that that research never change the production dashboard. |
| **Weekly doc spot-check cloud routine** "leads-dashboard weekly doc spot-check" (Tuesdays 03:30 UTC = 09:00 IST, created 2026-09-11 under the personal account) | Still enabled on the old account. **Its last run on 2026-10-06 FAILED: usage limit reached** (cycle 6 never happened; next scheduled 2026-10-13). | After migration disable it there and re-create it under the team account (prompt is in the routine; summary in §17.4), or drop it. The staleness tracker's "Weekly doc spot-check cloud routine still firing" watch item will flag the gap. |
| **Local scheduled tasks** | None exist (`list_scheduled_tasks` returned empty on 2026-10-10). | — |
| **To-Do Dashboard** (`C:\Users\User\Desktop\Strategy\To-do Dashboard\`, `tasks.json`, `update-tasks.ps1`) | Snehil's local task board, **separate from this repo**. Tasks reference it (`g-tf-d895943847` is the Email Ops goal; recurring `[Stale Sweep]` tasks fire on the 1st, 11th, 21st). | Ask Snehil whether the team keeps using it. See §3 rule 9. |
| **Connectors** (Gmail, Google Drive, "Homesfy_Connector" analytics MCP, Metabase) | Attached to the personal account. | Do not assume they exist for you. See §4 rule on the Homesfy analytics MCP. |
| **Personal permission overrides** `.claude/settings.local.json` | git-ignored, machine-local | Your harness will have its own. |
| **Downloads folders** with earlier deliverables (`Email-Ops-package`, `Email-Ops-fix-2026-10-10`, …) | On Snehil's machine only | Reproducible from git (`ec19415`, `000c1e6`). |

---

## 3. Working agreements with Snehil (the unwritten rules)

These were stated by Snehil in earlier sessions and held in the personal account's memory. They are **standing instructions** unless Snehil changes them. Each has a "why" so you can judge edge cases.

1. **Commit and push after every completed change in this repo, without asking.** *Why:* he said yes to "commit?" every time, then made it standing. *Scope:* this governs finishing an *already-approved* piece of work; experimental/exploratory changes can still be asked first. Commit message ends with the attribution trailer your harness requires. Pushes can be rejected if the weekly cloud routine pushed first: `git pull --rebase origin master`, re-run `python3 test/check-catalog.py`, push; `git pull --rebase` rewrites commit ids, so remap any sha you wrote into docs.
2. **After every code change: list the changed files and put a copy outside the repo** (historically `C:\Users\User\Downloads\Google Leads Dashboard - <short description> (YYYY-MM-DD)\`, preserving `js/` subfolders), together with the push, in the same turn. *Why:* `.gs` files are deployed by manual paste, so a ready local copy matters; the file-card in his client has **no working download button** (`SendUserFile` alone is not delivery — always also state a plain path). *If you run on a different machine, ask where he wants copies.*
3. **Ask before starting a large autonomous body of work** — a multi-part audit, spawning two or more agents for one effort, or creating more than a handful of to-do tasks at once. State what and roughly how big, then wait for a go-ahead. *Why:* on 2026-09-09 he flagged that a 7-part logic audit and a 50-task documentation project had both run to completion without a checkpoint ("too much is being spent on automatic work"). Routine steps inside approved work (reading, one edit, one commit) stay automatic.
4. **Audit-then-plan-then-code.** When asked to "audit everything, then fix", deliver the written audit (findings, evidence, severity, root cause) and a step-by-step plan, re-audit the plan, then **stop for approval before editing code**. Keep any drafted fixes uncommitted. *Why:* on 2026-10-05 he stopped mid-implementation because audit and fixes had become interleaved.
5. **No HTML/artifact creation or edits until the content is settled in plain chat.** Iterate on content with text, tables, ASCII diagrams; only build the HTML when he explicitly says to. This includes "small fixes". *Why:* repeated HTML rebuilds before the structure was decided wasted his time and tokens. (This document is Markdown for that reason.)
6. **Never call the Homesfy analytics/performance/core MCP tools without his explicit per-instance confirmation.** Loading a schema is fine; *calling* a `core_*`/`analytics_*`/`perf_*` tool needs a fresh yes each time, even if the previous turn used the same family. *Why:* real employee-performance data and client PII; he stopped a session that drifted into repeated pulls.
7. **If another session is already doing the same task, stop** — do not review, finish or redo it. Uncommitted changes you did not make are the tell. *Why:* two sessions finishing the same task risks one clobbering the other.
8. **Read a comment with no "Name:" prefix as probably the assigned RM's own** (not certain). Code already does this (`latestOutcomeGs_`, `latestFamilyOutcome`); an entry explicitly attributed to someone else is excluded. *Why:* discarding unattributed entries understates real signal.
9. **Task tracking must be cheap.** In his workflow any mention of "to do list" (any spelling/variant) means *add a task*; each task-worthy prompt opens/closes a task with a one-line note (long write-ups only for significant decisions), via `update-tasks.ps1`, never a bespoke splice script. *Why:* a long session's per-task overhead (multi-paragraph notes, hand-written scripts, 3–5 tool calls per close) was "too much computing". *Applies only if the team keeps using his To-Do Dashboard — confirm.*
10. **Write multi-line edit scripts with the file-write tool, not shell heredocs.** Heredocs repeatedly turned `\n`/quotes inside embedded JS/markdown into real newlines or broken quotes. Always *compute the new text first, then open the file for writing* (a helper that opened the file before computing truncated one record to empty once). Commit a checkpoint before destructive mutation scripts.
11. **E2E requests mean:** real writer → real reader (never hand-built state), mutate the production code one regression at a time and require a test to fail by itself ("a test that cannot fail is the commonest false pass here"), sweep clock times and zones (`--at`, `--tz`), mind the frozen-clock frontend harness, no real side effects, and check **both** CI jobs afterwards. Details in §15.
12. **Honest reporting.** Never say an email was "delivered" or "opened" — Apps Script can only see that Gmail *accepted* it. If a test fails or a step was skipped, say so with the output.
13. **State what the production-deploy classifier blocked and stop** — do not route around it (§4, §16).

---

## 4. Hard safety rules

1. **Never expose, commit or print**: employee email addresses, the contents of `RmHierarchy.private.gs`, tokens, API keys. The repo is **public**; since the 2026-10-05 email audit (P13) the code carries role *names* and looks addresses up from the private table at run time. Addresses from earlier commits are still in git history (rewriting history was deliberately not done).
2. **Never press Save / Ctrl+S in the live Apps Script editor, never run a `setupXxx()` or any data-writing function there on your own.** On 2026-10-07 and 2026-10-10 the permission classifier blocked the agent from Save and from selecting/running trigger-setup functions ("Production Deploy"), and from a throwaway localhost payload server ("Security Weaken"). Snehil presses Ctrl+S and runs the setup functions himself. If your harness blocks something, stage everything, hand over exact manual steps, and stop. Do not try a different route to the same effect.
3. **Allowed live in the editor:** running read-only `show…Now()` / audit helpers — after zooming to verify the dropdown selection and **reading the Execution log afterwards** to see which function really ran (the Run button follows the *previous* selection on the first click after changing the dropdown; this once ran `captureDailyRmIssues`, which writes live data, by accident — §20).
4. **No real sends from tests or experiments.** Test emails are confined to three plus-addresses of the maintainer's own mailbox (`TEST_EMAIL_PRIMARY_/CH_/SECONDARY_` in `Tests_Mocks.gs`; `TestAssertOnlyTestEmails_()` fails any test that would reach another address). `TEST_MODE_OVERRIDE_EMAIL_` must be `''` in production.
5. **Fail open for evidence, fail closed for safety.** The email ledger, incident log and reports must never block an email (evidence is not a gate); the send-safety gate must never be bypassed to "keep going".
6. **Never give the 16:30 report, the bounce sweeps or the audits the script-wide job lock** (`withEmailJobLockGs_`). A `nearMinute` trigger fires up to ±15 minutes from its minute and could hold the lock when the 17:00 job starts, making it skip. They keep run records for the watchdog but take no lock.
7. **Never create a tab inside a running email job**, and never leave `(pending commit)` as a final `Last Verified` value in a docs record (§17).
8. **Dates are IST, always.** Use `istDateKey`/`IST_TZ` (browser) and `istDayKeyGs_` + literal `+05:30` offsets (Apps Script). Never trust the machine or browser timezone — CI runs in UTC, Snehil's machine in IST, and `TZ=Asia/Kolkata date` in this project's Git-Bash silently returns UTC mislabelled as `+05:30` (compute IST as `date -u -d '+5 hours 30 minutes' …`).
9. **Destructive data operations follow the archive-then-verify-then-delete pattern** (Drive CSV archive, prove the record count with the quote-aware `countCsvRecordsGs_`, only then delete) — `archiveRowsToDriveCsv_`, `archiveChunksVerifiedGs_`. Never delete a sheet/rows without reading the target first.
10. **The Homesfy MCP rule (§3.6), the "no HTML until locked" rule (§3.5) and the "ask before big work" rule (§3.3)** are safety rules too.

---

## 5. The working environment

*As of 2026-10-10; yours may differ — re-check before relying on any of it.*

- **Machine:** Windows 11, PowerShell 5.1 (primary) and Git Bash. Repo at `C:\Users\User\Desktop\Strategy\Google leads Dashboard`.
- **Python 3.14 works** (`openpyxl` yes, `pandas` no). **Node, `npx` and `gh` are not installed**, so `node test/run-gs-tests.js` (what CI runs) cannot run here — use `python3 test/run-gs-tests-headless.py` (Playwright driving the installed Chrome; needs `python3 -m pip install playwright`, no browser download). A CI run's failing line is not readable from here (the Actions log endpoint returns 403 without admin); check job status through the public Actions API.
- **PowerShell traps:** a function returning one element is unwrapped to a scalar (`.Count` becomes `$null`) — wrap call sites in `@(...)`; `Get-Content` without `-Encoding UTF8` mis-decodes non-ASCII; copying files to the clipboard through the PowerShell pipeline mangles UTF-8 (use `[System.Windows.Forms.Clipboard]::SetText(…, UnicodeText)` or avoid the clipboard).
- **Chrome:** the Claude-in-Chrome extension drives Snehil's real signed-in Chrome. The built-in browser pane is separate and unsigned. Reading the live Apps Script editor needs the signed-in Chrome. If a tab reports `document.visibilityState === 'hidden'`, `find`/`read_page`/screenshots time out while `javascript_tool` still works: open a *fresh* tab on the project and close the old one (two editors on one project risk conflicting saves). Adding a new file in the editor needs the tab in the **foreground** and ≥ 5 s between additions.
- **Git:** `master` is the only branch in use; pushes go straight to it. `.claude/worktrees/…` holds a stale untracked copy of the whole repo — ignore it (§18).
- **Line endings:** tooling that edits files should preserve CRLF/LF per file (`newline=''` in Python, detect `\r\n`).

---

## 6. Architecture and file inventory

### 6.1 How the pieces connect

```
 CRM export (Coefficient add-on, ~every 2 h)  ──►  tab "leads"  (the only external input)
                                                    │
        ┌───────────────────────────────────────────┴─────────────────────────────┐
        ▼                                                                         ▼
 Dashboard (browser, human present)                              Apps Script (Google servers, unattended)
  read leads + Movement_Log + RM_Hierarchy …                      snapshotPeriodic 00/06/12/18  → Movement_Log, SLA_History
  render 8 tabs · region email reports (manual)                   captureDailyRmIssues 22:50    → Daily_RM_Issues
  write-back: Movement_Log (on demand), Lead_Followups,           sendOvernightMorningEmails 10:00  ─┐
   SLA_History, Daily_Cohort_History, Feature_Usage, Send_Log     sendOvernightFollowupEmails 13:00  ├─ Gmail → managers
                                                                  sendAllIssuesEmails 17:00         ─┘
                                                                  + ledger / audits / sweeps / 16:30 report / watchdog
                                                                  + nightly RM-hierarchy sync, weekly ops checklist
```

All `.gs` files share **one global namespace** (the split into files is organisational). All dashboard `js/*.js` are classic `<script>` tags sharing one global scope — **load order matters** (`dashboard.html` is the authority; `HANDOVER.md` §2 describes it). Nine of the ten `js/core-*.js` files load first; `core-rm-performance.js` loads later (position 16 of 24) which is harmless because nothing calls into it at parse time; `main.js` loads last; `rm-performance-worker.js` is loaded with `new Worker()`.

### 6.2 Apps Script production files (22 + the private table)

| File | Record | Role |
|---|---|---|
| `Core.gs` | GS-002 | Foundation every other file uses: row parsing (`HEADER_ALIASES_`), canonical stages and `FUNNEL_ORDER_`, `isOpenLead_`, IST helpers (`istDayKeyGs_`), Drive-CSV archival (`archiveRowsToDriveCsv_`, `archiveChunksVerifiedGs_`, `countCsvRecordsGs_`), workbook cell-budget diagnostic (`computeWorkbookCellUsageGs_`). `TAB_NAME_OVERRIDE = 'leads'`. |
| `SlaEngine.gs` | GS-012 | The 5 SLA rules (`computeSlaFlags_`), issue priority, and the two-checkpoint comparison engine (`computeAllIssuesCheckpointGs_`, `allIssuesCheckpointIsActiveGs_`). |
| `FollowupEngine.gs` | GS-005 | Comment classification (`OUTCOME_RULES_GS_`, `inferOutcomeGs_`) and the Suggested Follow-up text engine. |
| `EmailInfra.gs` | GS-004 | Shared email plumbing: `withRetry_`/`withSendRetry_`, leads-tab reader, region mapping, recipient resolution wrapper (`resolveRecipientEmailsForRegion_`), the send-safety gate (`prepareOutgoingEmailGs_`/`sendGuardedEmailGs_`), ops alerts (`notifyOpsAlertGs_`), the job lock, run records, the hourly watchdog, HTML/plain-text rendering, Leads-tab freshness. |
| `MovementTracker.gs` | GS-008 | The 4×/day snapshot: `Movement_Log` (content-hash dedup), `Movement_Log_Runs`, `SLA_History`, prunes with Drive archive, cohort history, snapshot alerts, the "calls so far today" baseline maps. |
| `OvernightEmailer.gs` | GS-010 | The combined 10:00 email and threaded 13:00 reply; log `Overnight_Log`; CH-level overnight report; recoveries; threaded send via Advanced Gmail Service. |
| `AllIssuesEmailer.gs` | GS-001 | The 17:00 email; `AllIssues_Log` incl. per-bucket `issue_snapshot_json` and checkpoint columns; recovery; one-off remediation helpers. |
| `RmHierarchy.gs` | GS-011 | `RM_Hierarchy`/`Manager_Directory` tabs, `RM_HIERARCHY_RAW_` seed, alias maps, `resolveRecipientBucketsForRms_`, audits. |
| `RmHierarchy.private.gs` | — | **Never in git.** Name → email table from an HR export. |
| `RmHierarchySync.gs` | GS-014 | Nightly ~23:15 sync from the HR roster sheet; report-only until switched on. |
| `DailyRmIssueLog.gs` | GS-003 | Nightly 22:50 company-wide issue census (`Daily_RM_Issues`), backfill/repair tools, the `.gs` mirror of the RM-performance classifier, `reportRmPerformanceNow`. |
| `InteractionHistoryLogger.gs` | GS-006 | `Comment_History` forward capture (30-day prune). |
| `UnmatchedCommentLogger.gs` | GS-013 | `Unmatched_Comments_Log` of comments no keyword rule matched (30-day prune). |
| `OpsChecklistRunner.gs` | GS-009 | Weekly Monday ~09:00 summary email of the automatable `OPS_CHECKLIST.md` checks (incl. cell budget, stale-tab check). |
| `LeadFollowupsStaleness.gs` | GS-007 | One-time conditional formatting on `Lead_Followups` (amber 12 h / red 24 h). |
| `EmailLedger.gs` | GS-015 | **Email Ops:** per-email ledger, exclusions, `Incident_Log`, held alerts, the shared recovery driver, tab pre-creation. |
| `CycleReport.gs` | GS-016 | **Email Ops:** the daily 16:30 report + `Daily_Report` tab. |
| `EmailSweep.gs` | GS-017 | **Email Ops:** bounce/reply sweeps (15:30 full; 10:30/13:30/17:30 bounce-only). |
| `OpsAudit.gs` | GS-018 | **Email Ops:** three silent audits (~11:15/14:00/18:00). |
| `DailyChecklist.gs` | GS-019 | **Email Ops:** checklist A–K with GREEN/AMBER/RED/GREY. |
| `FollowupTracker.gs` | GS-020 | **Email Ops:** where each 17:00 bucket's two checkpoints stand. |
| `StaleLeads.gs` | GS-021 | **Email Ops D8:** per-lead stale detection and the red bottom block. |
| `EmailReroute.gs` | GS-022 | **Email Ops D9:** bounce escalation, `Email_Reroutes`. |

Plus 25 `Tests_*.gs` files (one per production file, `Tests_Mocks.gs`, `Tests_RunAll.gs`, and `Tests_EmailLifecycleFullCycle.gs`). **A new `.gs` or `Tests_*.gs` file needs three registrations**: the `suites` array in `Tests_RunAll.gs`, the `PRODUCTION_FILES`/`TEST_FILES` lists in `test/run-gs-tests.js`, and a paste into the live editor. `python3 test/check-gs-registration.py` checks the first two (real incident CHECKLIST-006, 2026-09-09: CI threw `ReferenceError` on an unregistered suite).

### 6.3 Dashboard files

| File(s) | Record | Role |
|---|---|---|
| `dashboard.html` | DASH-001 | Shell, CSS (dark theme), tab containers, sign-in gate, `<script>` tags in load order. No `index.html` exists — entry URL is `…/dashboard.html`. |
| `js/core-foundation.js` | JS-005 | `CONFIG`, `ISSUE_PRIORITY`, IST helpers. |
| `js/core-sheets-fetch.js` | JS-009 | `HEADER_ALIASES`, module state (`leads`, `issueLeads`, `filterState`), Sheets API v4 read. |
| `js/core-auth.js` | JS-001 | Sign-in gate, `GATE_SCOPE` (spreadsheets + userinfo.email). |
| `js/core-lead-model.js` | JS-006 | `enrichLead` — the single source of truth for a lead's derived state. |
| `js/core-collation.js` | JS-002 | Merges multi-RM copies for display. |
| `js/core-outcome-engine.js` | JS-007 | `OUTCOME_RULES`, `inferOutcome`, `FOLLOWUP_SUGGESTIONS`. |
| `js/core-fetch-and-render.js`, `core-ui.js`, `core-filters.js` | JS-003/010/004 | `fetchAndRender`, UI chrome, filter bar. |
| `js/core-rm-performance.js`, `rm-performance-worker.js` | JS-008/017 | RM-performance classifier (also run in a Web Worker). |
| `js/tab-*.js` | JS-019…025 | One file per tab: audit, tracking, oppmonitor, rmtimeline, movement, repeat-offenders, morning (hidden). |
| `js/overview-distribution-people-ops.js` | JS-012 | `renderAll()` orchestrator, Overview/Operations/People rendering, CSV export. |
| `js/reports-build.js`, `reports-gmail.js`, `reports-ui.js` | JS-014/015/016 | Region-report content, real Gmail-API send (second OAuth grant), mailto/UI flow. |
| `js/sheets-writeback.js` | JS-018 | Every write back to the Sheet, incl. `Feature_Usage`. |
| `js/repeat-offenders-pdf.js` | JS-013 | PDF export of the Repeat Offenders tab (jsPDF). |
| `js/main.js` | JS-011 | Final bootstrap. |

The page was a single 3,100-line script until the **2026-08-21/09-02 modularity refactor** (pure code motion: `js/core.js` → 9 `core-*` files, `js/reports.js` → 3 files); older `.gs` comments still say `js/core.js`.

### 6.4 The Sheet's tabs

Record ids `SHEET-001…025`. "R" = retention.

| Tab | Written by | Read by / purpose | R |
|---|---|---|---|
| `leads` | CRM export (external) | everything | external |
| `Movement_Log` | `snapshotPeriodic`; dashboard on demand | Movement/Timeline tabs, RM Performance reconstruction, stale-lead detection, call baselines | 7 days, archived to Drive |
| `Movement_Log_Runs` | snapshot job | health of dedup (`leads_changed` vs `lead_count_seen`), timings | — |
| `SLA_History` | snapshot job + dashboard | SLA trend | none |
| `Daily_Cohort_History` | `MovementTracker.gs` auto + dashboard | Tracking cohort tables | none |
| `Lead_Followups` | dashboard Generate flow; 13:00 job refreshes | follow-up text for emails | cleared each Generate |
| `Daily_RM_Issues` | `captureDailyRmIssues` 22:50 | **nothing in the repo reads it any more** (§18.2) | 7 days |
| `Comment_History` | snapshot job | no dashboard reader (forward-capture dataset) | 30 days |
| `Unmatched_Comments_Log` | snapshot job | human review → new keyword rules | 30 days |
| `Send_Log` | dashboard after a region-email send | no code reader (audit trail) | none |
| `Region_Recipients` | human / dashboard panel | legacy fallback recipients | none |
| `RM_Hierarchy`, `Manager_Directory` | `setupRmHierarchy`, sync, humans | recipient routing | none |
| `AllIssues_Log`, `Overnight_Log` | the 17:00 / 10:00–13:00 jobs | idempotency guards and the next job's inputs (checkpoint JSON, thread ids) | none |
| `Opp_Monitor_Period`, `Opp_Monitor_Month` | **external process (no writer in this repo)** | Opp Monitor tab | — |
| `Feature_Usage` | dashboard (`recordComponentUsage`) | weekly stale-tab check | none |
| `Email_Ledger`, `Email_Ledger_Exclusions` | Email Ops | evidence | 90 days, archived |
| `Incident_Log`, `Daily_Report`, `Daily_Checklist`, `Followup_Tracker`, `Email_Reroutes` | Email Ops | evidence/reports/escalation | none (hand-delete if they grow) |

**Date columns silently become `Date` objects when Sheets writes a "yyyy-MM-dd HH:mm"-shaped string** — a recurring source of bugs (Unmatched_Comments dedup, `Overnight_Log` comparison, `Daily_RM_Issues` blank dates). Compare as dates or reformat on read; write plain-text columns explicitly (`emailLedgerEnsureSheetGs_` keeps a text-column list).

---

## 7. Domain logic: leads, stages, SLA rules, comments, scope

### 7.1 The lead row and identity

- One row per lead **per RM copy** ("clones"); `lead_id`, `client_id`, `RM`, region, `group_source`, `current_stage`, `closing_reason`, `lead_closing_reason`, `lead_assigned_at` (renamed from `lead_created_at` 2026-08-25), `last_connect_time`, `call_attempts` (a **per-lead lifetime counter**, identical across RM copies of one lead; different leads of one customer have different counters — fixed as email audit F18, 2026-10-07), `internal_status_comments`, `stage_comments`, `rm_is_active`, `opp_at` (added 2026-09-22), …
- Row parsing is alias-based: `HEADER_ALIASES` (browser) / `HEADER_ALIASES_` (Apps Script). New CRM columns that no alias covers are silently ignored (this is how `opp_at` sat unwired until 2026-09-22) — the staleness tracker has a recurring check.
- The dashboard collates copies of the same customer (by `lead_id` OR `client_id`, transitively) for display, but **judges each RM copy independently** for issue detection (since 2026-08-17) and does not merge copies across genuinely different regions (2026-08-24).
- **Region** comes from the region column, but "Loan" is derived from `group_source`/`project_region`; sub-regions roll up via `REGION_GROUP_MAP`/`mainRegionFor` (browser) and `REGION_GROUP_MAP_`/`mainRegionForGs_` (Apps Script). The browser's `effectiveRegion` Loan override has **no working Apps Script twin** — a known HIGH finding (`OPEN_ITEMS.md` §F; §21).

### 7.2 Stages

`FUNNEL_ORDER_ = not updated → suspect → opportunity → visit booked → visit → pipeline → gross eoi application → soft booking → booking` (Gross EOI added 2026-08-19). "Closed" stages: exact `won, lost, junk, dead, not interested`; stems `cancel, close, reject`. `isOpenLead_(stage, closingReason, leadClosingReason)` decides open vs closed; `isOppOrAbove` (and its `.gs` twin) got a closing-reason fallback on 2026-09-09 (the same fallback `isBookingLead` already had).

### 7.3 The five SLA rules (`SlaEngine.gs` ↔ `enrichLead`)

Constants: grace 3 h (`LEAD_GRACE_HOURS_`), lifecycle 48 h, minimum 5 calls/day, follow-up review 4 h, first-contact SLA 10 **business** minutes, working hours 09:00–19:00. Only **open** leads with a datable `lead_assigned_at` can be flagged.

| Rule (label) | Fires when |
|---|---|
| **Inactive-RM Lead Added** | created today (IST) and `rm_is_active` reads false/no/inactive/0/n. No grace period (the problem is the assignment, not RM speed). A routing issue — **never scored** against the RM. |
| **Not Updated** | past the 3 h grace and canonical stage is literally "not updated", **or** never connected and more than 10 business minutes old (grace-exempt). Since 2026-09-03 *not* capped at 48 h (a real data check found ~40% of still-"Not Updated" leads silently reclassified as "Stuck" at 48 h). |
| **Follow-up Overdue (4 h post-connect)** | under 48 h, past grace, has connected, and hours since last comment (else since connect, else since creation) exceed 4. |
| **Behind on Today's Calls** | past grace and calls today < 5. Calls today = `call_attempts` if created today, else `max(0, call_attempts − baseline, commentsLoggedToday)`, where baseline is the lead's last pre-today `Movement_Log` snapshot (keyed by **lead id**). The comment-count max was added 2026-10-01 after a real lead (a logged "Not Reachable" comment, counter unchanged) sent a wrong "Still open" email. |
| **Stuck 48h+ ("Leads Pending Beyond 48 Hours")** | older than 48 h and past grace. |

Priority when several fire (`ISSUE_PRIORITY_GS_`): Inactive-RM → Not Updated → Follow-up Overdue → Behind on Calls → Stuck 48h+. The email shows the primary one. The 2026-08-17 "Not Connected in 10 Minutes" retrospective marker was disconnected from the other issues; "Recording Not Working", "Closed with No Work Recorded" (renamed "Closed with No Comment") and "Stalled Leads" exist on the dashboard only.

### 7.4 Comments → outcome → Suggested Follow-up

`OUTCOME_RULES` (browser, ~110 rules) / `OUTCOME_RULES_GS_` (Apps Script, ~30 — **the count difference is an unresolved question**, `OPEN_ITEMS.md` §F) classify an RM's latest owner-only comment by keywords (RNR, switched off, DND, call back, visit, budget…). Fuzzy matching (edit distance) replaced hand-typed typos on 2026-08-21 after a severe performance regression (`edacfaa`); a "buy/busy" collision was fixed the same day. Owner-only filtering with the unattributed-comment heuristic (§3.8). Do-Not-Disturb follow-ups are verified via a cross-call before stopping outreach (2026-09-04). A "modifier layer" stacks extra clauses onto the primary text (2026-08-28). No keyword match → a call-attempts-aware "No comment added" fallback. **`Unmatched_Comments_Log` is the feedback loop:** mine it, then add the keyword to **both** rule sets. 

### 7.5 Scope of the automatic emails

`passesGoogleNonUtmSearchGs_`: source google, sub-source Non-UTM or Search. The 17:00 email covers leads **assigned in the last 3 calendar days (IST)** — a calendar window, not a rolling 48 h (changed 2026-08-28 after a real undercount). The 10:00 "overnight" email covers leads assigned 17:00 the previous day → 09:00 today, with converted/closed leads dropped, plus unresolved flagged ones.

---

## 8. The daily clock: every trigger and what runs when

**19 time triggers are live** (verified on the triggers page 2026-10-10 17:27 IST). All `setupXxx()` functions delete and recreate only their own triggers, so re-running is safe. **A trigger's schedule is fixed at creation:** changing an hour in code requires pasting and re-running the setup function. Triggers fire *near* their requested minute (`nearMinute` ≈ ±15 min), and `atHour` without a minute is similar.

| IST | Handler | File | Installed by | What it does |
|---|---|---|---|---|
| 00:00, 06:00, 12:00, 18:00 | `snapshotPeriodic` | `MovementTracker.gs` | `setupMovementTracking()` | Core capture first (hash lookup + append to `Movement_Log`), then optional phases inside an 840 s budget (SLA_History, the two loggers, prunes, cohort history). Four separate `atHour` triggers, deliberately not `everyHours(6)` (which drifts/skips under load). |
| 22:50 | `captureDailyRmIssues` | `DailyRmIssueLog.gs` | `setupDailyRmIssueLog()` | Nightly company-wide issue census (prunes `Movement_Log` up front). |
| ~23:15 | `syncRmHierarchyNightly` | `RmHierarchySync.gs` | `setupRmHierarchySync()` | HR-sheet sync; report-only until apply is enabled. |
| 10:00 | `sendOvernightMorningEmails` | `OvernightEmailer.gs` | `setupOvernightEmailer()` | Combined email: Section 1 overnight + Section 2 Checkpoint 1 of yesterday's 17:00 buckets. |
| 10:30 | `sweepBouncesAfterMorning` | `EmailSweep.gs` | `setupEmailSweepTrigger()` | Bounce-only check. |
| ~11:15 | `auditMorningEmails` | `OpsAudit.gs` | `setupOpsAuditTriggers()` | Silent audit of the 10:00 emails. |
| 13:00 | `sendOvernightFollowupEmails` | `OvernightEmailer.gs` | `setupOvernightEmailer()` | Threaded reply: overnight follow-up + Checkpoint 2. |
| 13:30 | `sweepBouncesAfterFollowup` | `EmailSweep.gs` | `setupEmailSweepTrigger()` | Bounce-only check. |
| 14:00 | `auditFollowupEmails` | `OpsAudit.gs` | `setupOpsAuditTriggers()` | Silent audit of the 13:00 replies. |
| ~15:30 | `sweepEmailBouncesAndReplies` | `EmailSweep.gs` | `setupEmailSweepTrigger()` | Full sweep: bounces **and** replies; feeds the 16:30 report. |
| ~16:30 | `sendEmailCycleReport` | `CycleReport.gs` | `setupEmailCycleReportTrigger()` | The daily report to Snehil; also writes `Daily_Report`, `Daily_Checklist`, `Followup_Tracker`. |
| 17:00 | `sendAllIssuesEmails` | `AllIssuesEmailer.gs` | `setupAllIssuesEmailTrigger()` | The primary send. Pinned `nearMinute(0)` since 2026-09-02 (the unpinned trigger had fired 50–58 minutes late). |
| 17:30 | `sweepBouncesAfterAllIssues` | `EmailSweep.gs` | `setupEmailSweepTrigger()` | Bounce-only check (slot added by Claude, see §21). |
| 18:00 | `auditAllIssuesEmails` | `OpsAudit.gs` | `setupOpsAuditTriggers()` | Silent audit of the 17:00 emails. |
| hourly | `emailJobWatchdog` | `EmailInfra.gs` | `setupEmailJobWatchdogTrigger()` | Alerts if a scheduled job did not run / did not finish / failed; also releases held alerts of a killed job after 45 min; daily config-problem check. |
| Mon ~09:00 | `runWeeklyOpsChecklistNow` | `OpsChecklistRunner.gs` | `setupWeeklyOpsChecklistTrigger()` | Weekly pass/fail email of 5 automatable checks; sends every week on purpose. |

Late-send cutoffs for recoveries (decision D5): 17:00 emails until **18:30**, 10:00 until **12:45**, 13:00 replies until **16:00**.

**Known gap:** the 10:00 and 13:00 triggers (`OvernightEmailer.gs:2298–2299`) do **not** call `.inTimezone('Asia/Kolkata')`; they rely on the project's default timezone being IST. Every other trigger pins it. Recorded in `docs/architecture/apps-script-triggers.md` since 2026-09-10; never fixed **[verified 2026-10-10]**.

---

## 9. The email system in depth

### 9.1 Who gets what (routing)

`resolveRecipientBucketsForRms_` (`RmHierarchy.gs`) takes the RMs that have leads in an email's scope and returns **buckets**, one per distinct *primary recipient*. Primary = the RM's **TL (A1)**, else **TM**, else **RH**, else **CH**. Cc = the primary's own RH and CH, plus the standing leadership addresses (`LEADERSHIP_NAMES_`), plus the TM only for exception TMs (`TM_STILL_CC_`: Ayaz Bagwan, Rahul Poudel, Akash A Ugale — a Pune exception from 2026-08-26, Akash added 2026-09-16). Special cases (read `resolveRecipientBucketsForRms_` and `resolveRecipientEmailsForRegion_` for the exact precedence — the list below is by topic, not by code order):

1. **Loan team** (RM whose own chain ends at `LOAN_TEAM_CH_NAME_`): primary Mayur Panjari, **no Cc** (2026-10-03).
2. **Restricted-cc primaries** (Rajesh Muni, Manisha rathod): Cc **only** Snehil (2026-10-01).
3. **Leadership/CH personally holding a lead:** not emailed to the CH; instead a **CH-level report** goes to the ops address + the CH-level address with the same full content, naming who holds each lead (2026-08-26/27 design: "a human decides how to route them"). Only an RM *at* leadership/CH/City-Lead level holding the lead themselves, with nobody below them, goes this way (`chLevelRms` in `resolveRecipientBucketsForRms_`, verified 2026-10-10); an RM whose chain merely resolves up to a CH is a normal recipient (`b4555a8`). **Doc drift to be aware of:** the header comment of `OvernightEmailer.gs` and `HANDOVER.md` P10 still describe the broader older rule ("or an RM whose chain resolves all the way up to one") — the code is the narrower one.
4. **Futwork** (any RM name containing "Futwork", tele-calling vendor agents, 2026-09-25): one `Futwork` email per job across **all** regions, to Snehil only, no Cc, bypassing hierarchy/Region_Recipients/backstop/leadership.
5. **P&L-head Cc** per region (`REGION_PNL_HEAD_CC_`).
6. **Unresolved RM** (not in `RM_Hierarchy`, excluded, no email): falls back to `Region_Recipients`; if that is empty too, a **CH-level backstop** email (added 2026-09-01) so a broken chain never silently drops a lead — and that one email deliberately excludes the leadership Cc (bug fixed 2026-09-24).
7. **Same-address buckets** are merged (`mergeBucketsByAddressGs_`, P7) so two buckets on one address cannot overwrite each other.

### 9.2 The three jobs

**17:00 — `sendAllIssuesEmails` (`AllIssuesEmailer.gs`).** For each region, bucket the affected RMs, render one email per bucket (subject `"<bucket label> (<role>) google Leads With Issue (<from> to <to>)"`), send through `sendGuardedEmailGs_`, then write an `AllIssues_Log` row holding recipients, thread/message ids and **`issue_snapshot_json`** — the exact population reported (the state the next day's checkpoints compare against). Same-day idempotency: a region with an `AllIssues_Log` row today is skipped; hence a failed sibling bucket can't be re-sent by a plain re-run (use `recoverFailedAllIssuesBucketsNow`, §10.5).

**10:00 — `sendOvernightMorningEmails`.** One **combined** email per bucket since 2026-09-24:
- *Section 1 — Overnight* (the original logic): leads assigned/flagged overnight; logged in `Overnight_Log` with the Gmail thread id.
- *Section 2 — Checkpoint 1*: yesterday's 17:00 snapshot for that recipient compared with the live sheet now; each lead is resolved or still unresolved.
Since 2026-09-26 ("no email for resolved status") Section 2 lists **only still-unresolved** leads and a bucket with nothing unresolved in either section gets **no email** (its checkpoint JSON is still stamped so it isn't re-checked).

**13:00 — `sendOvernightFollowupEmails`.** A **threaded reply** into the bucket's own 10:00 conversation (raw MIME through the Advanced Gmail Service in `sendThreadedGmailReply_`, falling back to a plain new message if threading is unavailable): Section 1 overnight follow-up (still flagged for the same issue = unresolved, red) + Section 2 Checkpoint 2, **incremental** versus Checkpoint 1. Recipients/thread are the ones **stored** at 10:00 — routing is frozen at the earlier send. It also refreshes `Lead_Followups` suggestions with a bounded wait.

The full design (state model, empty-state rules, why a lead may appear in both sections) is `EMAIL_LIFECYCLE_TWO_CHECKPOINT_REDESIGN.md` (built in 11 tracked steps 2026-09-23/24; live and verified 2026-09-24).

### 9.3 The send-safety gate (email audit P1/P2, 2026-10-05)

`sendGuardedEmailGs_` is the **only** place a report email is drafted and sent (ops alerts use `GmailApp.sendEmail` on purpose so an alert can always go out). `prepareOutgoingEmailGs_` validates the exact payload: valid To (and Cc) addresses, non-blank subject (CR/LF collapsed), non-blank plain and HTML bodies with visible text, and for report emails **every counted lead id appears in both the HTML and the plain-text body**. A refusal throws `blockedByGuard` *before any draft exists*; the caller records "not sent". The plain-text part is a real rendering of the same options object (P2), so the two parts cannot describe different content. The dashboard has the same last-line gate in `performGmailSend` (P11); the address regexes are diffed by `check-runtime-parity.py`.

### 9.4 Reliability layers

- `withRetry_`: 4 attempts, 2/4/6 s, only for Google's transient wording (`timed out`, `service (spreadsheets|gmail|error)`, `internal error`, and — since P12 — `server error occurred`). `withSendRetry_` retries only *definitive* Gmail refusals ("operation not allowed", "Not found" with a flat 400 ms wait — a 2026-09 fix after a 50-minute run) and **never an ambiguous timeout**, which might have delivered (`isAmbiguousSendErrorGs_`).
- **Ambiguous 13:00 send (P6):** no duplicate fallback; the row is marked `unconfirmed`, ops alerted; to resolve, look in Gmail Sent, and if absent clear the cells and re-run.
- **A checkpoint counts as done only when its email was delivered (P5)**, so a same-day re-run can retry it.
- **Job lock (P4):** `withEmailJobLockGs_` — one script-wide `LockService` lock around the three jobs; a second job waits 30 s then skips and alerts; the lock **fails open**.
- **Run records + watchdog (P9):** each job writes running→completed/failed to Script Properties; the hourly watchdog compares with each job's deadline (hh:30). `Overnight_Log.followup_result` records what the 13:00 job did per row.
- **Once-only appends (P7):** `appendRowOnceGs_` (a retry looks for its own thread id before appending again).
- **One leads read per job (P8)** and `jsonForCellGs_` caps JSON cells at 45,000 characters (a 50,000-character-cell crash on 2026-09-25 aborted the whole 13:00 run).
- **CH-level reports go once a day (P10)** via Script Properties (`EMAIL_CH_REPORTS_*`).
- **TEST MODE** (`TEST_MODE_OVERRIDE_EMAIL_`, empty in production) redirects every send, tags subjects `[TEST MODE]`, and since 2026-09-25 **writes no production state** (`writeUnlessTestModeGs_`) — a live test once polluted `AllIssues_Log` and made the real 17:00 run skip.

---

## 10. The Email Operations System (evidence, alerts, recovery, bounces)

**Why it exists.** Every older log is written only *after* a successful send, so the system knew what went out and could not know what *should* have gone out and didn't. The 2026-10-09 audit (`EMAIL_OPS_SYSTEM_AUDIT.md`) answered a specification for an auditable operation: *isolate the fault, continue the safe work, alert, recover blocked items, reconcile everything.* It was built 2026-10-09/10 as parts EO-1…EO-13 and deployed 2026-10-10. The operating manual is `docs/EMAIL_OPS_OPERATING_MANUAL.md`.

### 10.1 The ledger (`EmailLedger.gs`)

`Email_Ledger` has one row per **bucket email**: `email_id`, `cycle_day`, `job` (`allIssues17`, `chLevel17`, `morning10`, `chLevel10`, `followup13`, `reroute`), `region`, `bucket_label`, `primary_role`, `to`, `cc`, `subject`, `leads_planned`, `planned_at`, `attempted_at`, `finished_at`, `status`, `status_reason`, `attempts`, `message_id`, `thread_id`, `leads_sent`, `lead_ids_json`, `bounce_status`, `reply_status`, `swept_at`. Ids are deterministic (`emailLedgerIdGs_`), so a rerun cannot duplicate a row.

Statuses: `PLANNED` (whole region written in one batch) → `ATTEMPTING` (just before send) → `ACCEPTED` (Gmail's `send()` returned — **not** delivered/opened) / `FAILED` / `UNCONFIRMED` (timeout-class; may have gone) / `BLOCKED` (gate refused) / `SKIPPED` (nothing to say). A row stuck in `PLANNED`/`ATTEMPTING` means the run died. `Email_Ledger_Exclusions` records every lead or region left out, with the reason (unroutable RM, defective lead, duplicate id, same-day guard). **The ledger is evidence, not a gate:** every call is fail-open; an unrecognised header disables it; TEST MODE never writes.

**Per-lead isolation (D3):** a lead with no id, a control character/over-long id, or no reason for contact is dropped and recorded; when the gate objects to specific leads only those are dropped and the bucket is re-sent once; if it objects to all, the bucket is `BLOCKED`.

### 10.2 Held alerts and `Incident_Log` (D2)

Inside the three email jobs (and the recoveries) `notifyOpsAlertGs_` writes the alert to `Incident_Log` as `HELD` and sends it **once after the job**, as one message opening with a CONFIRMATION line ("N bucket emails handled — A accepted by Gmail, …"). A whole-job crash (`… crashed`) is sent immediately. If a job is killed, the hourly watchdog releases held alerts older than 45 minutes. Alerts outside email jobs (watchdog, sync, snapshot) go out at once and are also logged.

### 10.3 The 16:30 report and the checklist

`sendEmailCycleReport` mails Snehil one report a day (D1), fine or not: emails by job and final status; "Needs attention"; what was left out and why; incidents; "Ready for 17:00?" (config problems, held alerts, Leads-tab freshness AMBER >3 h / RED >5 h from the newest lead assignment — **a warning only**, D4); bounces/replies; re-routed addresses in force; the **Daily checklist A–K** (A start of day, B Leads tab, C leads dropped, D no lead without reason, E 10:00, F 13:00 checkpoint, G audits of 10:00/13:00, H 17:00 preparation, I 17:00 send + audit, J bounces/replies, K reconciliation) with GREEN / AMBER (look, or *evidence missing* — never reported as failure) / RED / GREY; and the **follow-up tracker** per 17:00 bucket (COMPLETED / NOT_NEEDED / BLOCKED / OVERDUE / DUE / FUTURE; `REROUTED` or `STOP` for a bounced 17:00 email). Subject reads `all clear (N of M emails accepted by Gmail)`, `K need attention (…)` or `no emails recorded in this cycle`.

### 10.4 Silent audits (`OpsAudit.gs`)

After each job an audit compares the ledger with `Overnight_Log`/`AllIssues_Log`. Silent when they agree; ONE ops alert for: `UNFINISHED`, `ACCEPTED_WITHOUT_LOG`, `LOG_WITHOUT_LEDGER`, `DUPLICATE_LOG`, `CHECKPOINT1_GAP`, `FOLLOWUP_GAP`. Never blocks, re-sends or edits.

### 10.5 Recovery

`recoverFailedAllIssuesBucketsNow` (until 18:30), `recoverFailedMorningBucketsNow` (12:45), `recoverFailedFollowupBucketsNow` (16:00), each with a `…ForceNow` variant that sends past the cutoff on purpose. They target `FAILED`/`BLOCKED`/`PLANNED` only — **never** `ATTEMPTING`/`UNCONFIRMED`/`ACCEPTED` — after re-checking everything from current data (a lead resolved meanwhile is dropped; an empty bucket closes as `SKIPPED`). They go through the job lock and hold alerts like the originals. The shared driver is `emailRecoverBucketsGs_`.

### 10.6 Stale leads (D8, `StaleLeads.gs`)

A **stale lead** = no update *at all* (no stage change, no comment, no call-count increase) for **more than 24 h, regardless of when it was created or assigned**. Every automatic email lists them in a separate red block at the very bottom ("Stale leads — no update for more than 24 hours"), oldest first; they stay in the email and its counts. Judged from `Movement_Log`: a row is written only when a lead's content hash changes, so a lead is stale iff its live hash equals the latest row's hash **and** that row is more than 24 h old. No history, a change since the last snapshot, or any error all mean "not stale" (fail-open). The snapshot runs four times a day, so a quiet 24–30 h lead may show a snapshot *later*, never earlier. The dashboard's manual flow and its "Stalled Leads" section use older rules and are unchanged.

### 10.7 Bounce checks and escalation (D9, `EmailSweep.gs` + `EmailReroute.gs`)

- **Checks:** full sweep ~15:30 plus bounce-only checks 10:30, 13:30 and 17:30. Looks at emails Gmail accepted in the last 3 days that are ≥ 10 minutes old. A bounce is matched when a delivery-failure message (from mailer-daemon/postmaster) names one of the email's recipients — **including an address a re-route redirected it to** — and either quotes the subject or arrived within 15 minutes of the send. `NO_BOUNCE_SEEN` means only "none found", never "delivered"; a failed search is `UNKNOWN`. A reply is any later message in the thread from someone other than the sender. 4.5-minute time budget.
- **Escalation:** the bounced email, and that bucket's later follow-ups, go to **the next person up the dead person's own `RM_Hierarchy` row (TL → TM → RH → CH, first with an email in `Manager_Directory`); if nobody, to the ops address**. Mechanism: a row in `Email_Reroutes` (14 days, `via` = `hierarchy` or `ops fallback`); `emailRerouteApplyGs_` rewrites To/Cc at the two send functions *before* the safety gate (fail-open; TEST MODE exempt); `AllIssues_Log`/`Overnight_Log`/ledger keep the **original** address so audits, tracker and guards are unaffected; an amber banner tells the new person why; the ledger `status_reason` says "re-routed to X (the bounced Y)". The bounced **To** email itself is re-sent once from its own Gmail message (ledger `message_id`) as ledger job `reroute`, id `RR|<original email id>`, only inside the original job's late-send window (3 h for a copy that bounces again). A bounce on a **Cc** only changes the Cc. A replacement that bounces gets its own row one level up; the chain ends at the ops address, capped at 6 hops. CH-level reports (already to ops) are never re-routed.
- **Not covered:** the dashboard's manual "Generate region emails" flow. A **reply changes nothing** (only a bounce escalates) **[assumption — Snehil has not explicitly confirmed this]**.
- Console: `showEmailReroutesNow()`, `endAllEmailReroutesNow()`.

### 10.8 Lessons built into the design

Hold alerts until the rest of the job is confirmed (D2); keep reports and sweeps off the job lock; **pre-create tabs ahead of time** (`precreateEmailOpsTabsNow()`) and wrap a job's *first* read of its log tab in a retry (`lastRowRetryGs_`) — both added after the first live 17:00 run crashed (§20, 2026-10-10).

---

## 11. Data stores, retention and the 10-million-cell wall

Google Sheets caps a **workbook at 10,000,000 cells of declared grid size**, summed over every tab. `clearContent()` does **not** shrink the grid; only `deleteRows()` does. This one fact produced at least six incidents (2026-08-26, 09-06, 09-17, 09-21, 09-24, 09-28). Rules the code now follows:

- **Prune before you write** where an after-write prune could never self-heal (`pruneDailyRmIssueLog_` runs before the nightly write; `captureDailyRmIssues_` also prunes `Movement_Log` up front, in a try/catch).
- **Archive-then-verify-then-delete** to the Drive folder **"Leads Dashboard Archive"** (a subfolder per table, a manifest `archive_log.csv`), in 5,000-row chunks (a single CSV for 110k rows hit Drive's file-size ceiling on 2026-09-28). Archives are idempotent (P18: an identical file is reused; files are trashed if the proof fails).
- **`pruneMovementLog_`** reads only the `snapshot_at` column and, when the expired rows are a contiguous prefix, archives them and removes them with ONE `deleteRows`; otherwise it falls back to a full rewrite. Its first version was unsafe against interruption and caused the catastrophic 2026-09-12 data loss.
- **Weekly cell-budget report** (`reportWorkbookCellUsageNow`; WARN at 70%, CRITICAL at 85%) in the Monday ops-checklist email.
- **Not solved:** nothing caps the workbook's steady-state size. A separate log spreadsheet would be the durable fix and has **not** been built.

**`Movement_Log` content-hash dedup** (Lead History review Phase 6, 2026-09-11): `content_hash` is always the **last** column; a snapshot appends a row for a lead only if its hash differs from that `lead_id|RM`'s latest row (dedup key was `client_id` until 2026-09-26). `Movement_Log_Runs.leads_changed` ≈ `lead_count_seen` means dedup is broken. The hash is SHA-256 over a `'\u0000'`-joined field list, identical in both runtimes (shared known-answer test vector).

---

## 12. RM Performance / Repeat Offenders

Purpose: tell *repeated* neglect from a one-off. The tab (`js/tab-repeat-offenders.js` + `js/core-rm-performance.js`) ranks RMs, A1/TM groups, RHs and regions by a **severity-weighted, workload-adjusted composite** (redesign of 2026-09-04; replaced the earlier "Avg Flagged" ratio, which had no real denominator).

- Four **scored** rules with weights: Not Updated 1.5, Follow-up Overdue 1.2, Behind on Calls 1.0, Stuck 48h+ 0.8. Inactive-RM is a routing issue, tracked (`routingIssueDays`) but never scored.
- Per rule, the RM's violation-day rate over their **eligible book** (every distinct lead eligible for that rule in the range, reconstructed from `Movement_Log`, not from `Daily_RM_Issues`) is **shrunk toward the peer rate**: `n/(n+8)·raw + 8/(n+8)·peer` (`RM_PERF_SHRINKAGE_K = 8`, in distinct-lead units). Fewer than 5 distinct eligible leads → "Insufficient Data".
- Flagged when the composite exceeds the peer composite by `RM_PERF_FLAG_RATIO = 1.25`; "Watch — concentrated" when the violations are concentrated in a few chronic leads rather than spread across the book (constants `RM_PERF_CHRONIC_STREAK_DAYS = 3`, `RM_PERF_CONCENTRATION_BREADTH_CEILING = 0.25`; exact test in `core-rm-performance.js`).
- **Posterior-confidence flagging (2026-09-30, `HANDOVER.md` §9.7.5):** because of heavy shrinkage a narrow filter (e.g. Google Non-UTM/Search, n = 5–16 per RM) flagged nobody. The decision rule now uses the Beta-posterior *variance* too: `confidence = Φ((composite − peer·1.25)/sd)` and an RM is flagged when `confidence ≥ 0.40` (violations; `RM_PERF_CONFIDENCE_THRESHOLD`) / `≥ 0.35` (Opp-conversion; `RM_OPP_CONFIDENCE_THRESHOLD`). **The thresholds are deliberately below 0.5** — at exactly 0.5 the rule is mathematically identical to the old one. Do not "fix" them upward; the calibration table is in §9.7.5. The independence assumption across the four rules is anti-conservative (the reason the violation side is the stricter 0.40). The planning file for this change is complete.
- **Opp-conversion join (2026-09-29):** each RM's Same-Day/48 h Opportunity conversion as a second signal (browser only — there is no `.gs` twin of the `RM_OPP_*` engine).
- **Exclusions:** leadership/CH-tier roles (2026-09-07/09), Futwork vendor agents and one admin name (2026-09-29).
- Computation runs in a Web Worker (2026-09-07) with a canonical result cache so the PDF never recomputes (2026-09-12 redesign steps 1–4).
- The `.gs` mirror (`classifyRmPerformanceGs_`) feeds only the console leaderboard `reportRmPerformanceNow()`; the constants must stay numerically identical (`RM_PERF_*_GS_`, parity-checked).

---

## 13. RM hierarchy and recipient routing

- `RM_Hierarchy` (name, team, role, tl, tm, rh, ch, excluded, note) and `Manager_Directory` (manager → email). Seeded from `RM_HIERARCHY_RAW_` in `RmHierarchy.gs`, emails from `RmHierarchy.private.gs` (a lookup built lazily, **not at file load** — a load-order `ReferenceError` on 2026-08-24).
- Names in the leads sheet vary (typos, old spellings, "Pnl" suffixes): alias maps and a role-suffix-stripping fallback; `auditUnresolvedRmsNow()` lists RMs that won't route and now runs automatically at the end of every rebuild (2026-10-01, after the Pre-Sales team of 7 with 25–498 leads each was found to have **no row at all**).
- **Staleness that stays hidden:** a stale-but-still-resolving `tl/tm/rh/ch` is invisible to the unresolved-name audit (three RMs kept pointing at a manager who had left three months earlier). Tools: `test/check-rm-hierarchy-drift.py`, and `test/refresh-rm-hierarchy.py <HR Live export.csv>` (dry run by default, `--apply` after reading) which also finds *missing* people — the direction the drift script cannot see (a Cluster Head, joined 2026-09-16, was missing for ~13 days).
- **Nightly sync (2026-10-08, `RmHierarchySync.gs`):** at ~23:15 compares the HR roster sheet (first tab; layout checked at fixed positions; stops if fewer than 250 people or more than 25 changes) with the live tabs. Auto-applies (only once `enableRmHierarchySyncApplyNow()` is run): new sales-track joiners whose whole chain resolves, an unambiguous stale field, blank manager emails. **Only reports:** everything ambiguous, and **possible leavers — never removed** (reported on first sight, then each Monday). Old spellings of current staff are recognised and listed once instead of as leavers (2026-10-08, `RULE-042`). Backups to Drive first. **State as last recorded (2026-10-09): report-only; apply OFF [unknown whether since enabled — run `showRmHierarchySyncStatusNow()`].**
- **Once the sync applies, the live tab is the source of truth and `RM_HIERARCHY_RAW_` is only a seed:** `rebuildRmHierarchy()` refuses to run (it would silently undo every synced change); `rebuildRmHierarchyForce()` overrides on purpose.
- Departures are handled by hand-editing `RM_HIERARCHY_RAW_` (e.g. 15 departed RMs removed 2026-09-30) — and reports of departed RMs are re-routed.

---

## 14. The dashboard (browser side)

**Sign-in:** Google Identity Services token client; scope `spreadsheets` + `userinfo.email` (`GATE_SCOPE`). Sending mail needs a **second, separate** grant (`gmail.send`) so browsing never asks for send permission. One OAuth Client ID serves both (`HANDOVER.md` §4.2; override in `localStorage` key `gsl_gmail_client_id`).

**Visible tabs (8):** Overview (KPIs, funnel, trends), Operations (the 5 SLA issue lists by calendar-day bucket, region email generation), Repeat Offenders (RM Performance + PDF), People (merged People + Distribution + RM Timeline on 2026-08-25), Audit (when a lead was last touched; Activity by Hour), Movement (reads `Movement_Log`: stalled leads, overnight cohort, RM stall leaderboard, time-to-Opportunity), Tracking (issue counts over time, cohort comparison, Daily Cohort by Region), Opp Monitor (added 2026-09-18: Google Non-UTM/Search Same-day/48 h Opp% workflow, a 12-step checklist; reads two externally populated tabs and, since 2026-09-21, also computes "Live" figures from `opp_at`). **Hidden:** Morning Brief (§18.1).

**Behaviour to know:** `renderAll()` renders every tab in one pass; switching tabs is a `display:none` toggle. A blocking loading overlay prevents heavy renders stacking (2026-08-21). The Recalculate button (2026-09-04) re-runs the RM-performance engine. A "Last 7 days / Yesterday" range excludes today (2026-09-07). The Repeat Offenders time-range filter has a real date-basis split (assignment date vs capture date; `HANDOVER.md` §9.4) — read it before touching that file.

**Write-backs** (`js/sheets-writeback.js`): on-demand `Movement_Log` snapshot (guarded against duplicate dedup keys), `Lead_Followups`, `SLA_History`, `Daily_Cohort_History`, `Send_Log`, `Feature_Usage`. All reuse the Sheets token — a Viewer-only account can read the dashboard but every write fails.

**Region email flow (manual):** `reports-build.js` builds the same per-region content the automatic emails use; "Generate" first populates `Lead_Followups` and waits for suggestions; sending uses the Gmail grant with a one-hour "Sent ✓" state. It has the browser send-safety gate (P11) but **no** stale-lead block, no re-route and no ledger.

---

## 15. Testing and quality gates

### 15.1 Apps Script suite (the one that matters for every `.gs` change)

`Tests_Mocks.gs` temporarily replaces `SpreadsheetApp`, `GmailApp`, `Utilities`, `ScriptApp`, the Advanced `Gmail` service, `LockService`, `PropertiesService` and Drive with in-memory fakes, then restores the real objects in a `finally`. Nothing touches the real Sheet or sends mail. One `Tests_<File>.gs` per production file, plus `Tests_RunAll.gs` and the integration suite `Tests_EmailLifecycleFullCycle.gs`. **When you add or change a `.gs` function, add the assertion in the same commit.**

| What | Command / place | Notes |
|---|---|---|
| Local run (no Node here) | `python3 test/run-gs-tests-headless.py` | Playwright + installed Chrome, headless; reads `PRODUCTION_FILES`/`TEST_FILES` from `test/run-gs-tests.js` by regex (so it cannot drift from CI's list). Local total on 2026-10-10: **3,370 passed, 0 failed**. |
| Awkward clocks/zones | `… --at 2026-10-08T00:00:20+05:30` and `… --tz UTC` | Most of the suite uses the real clock. The first sweep (13 clock times × 4 zones) found a fixture clean only at some hours (`midWindow` in `Tests_OvernightEmailer.gs`). Do this after adding any test that uses `new Date()`. `HANDOVER.md` §7.1 lists the times used. |
| Editor-only globals | `python3 test/check-gs-runtime-globals.py` | Flags `atob`, `TextDecoder`, `Promise`… that browsers/Node provide but Apps Script does not. A green headless/CI run is **not** proof the suite runs in the editor (first live `runAllTests()` on 2026-10-07 threw `atob is not defined` in three suites). |
| Live | `runAllTests()` in the editor | Last live total: **3,340 passed, 0 failed across 23 files** (2026-10-10, before the final retry/pre-create fix; that fix's new tests have **not** been run live). Read the per-suite lines, not just the total. |
| CI | `.github/workflows/test.yml` → job `test` (Node 20: `node test/run-gs-tests.js`, then warn-only `check-docs-coverage.js`, then blocking `check-catalog.py`) and job `frontend-harness` (official Playwright container, **blocking**) | The authority. After every push check **both** jobs via the public Actions API (no `gh`, log download 403s). The Node sandbox does not inherit Node's globals; two harnesses (Node `vm` and Chrome) keep **separate** mock globals that can drift (3 red CI runs on 2026-09-24/25 came from `atob`/`TextDecoder` missing in `buildSandbox()`). |
| Dashboard | `tests/frontend-harness.html` (served; read `window.__harnessResults`) | Grafts the real `dashboard.html` + `js/*.js`, mocks only the network boundary, runs synthetic leads through the real `fetchAndRender()`. Its clock is **frozen**, so never cap a wait loop with `Date.now() - start` (use an iteration cap). |
| Cross-runtime | `python3 test/check-runtime-parity.py` | Diffs the *data* of duplicated pairs (keywords, weights, maps, regexes). A mismatch is a lead to verify — two browser-only `HEADER_ALIASES` keys are legitimate. |
| Registration | `python3 test/check-gs-registration.py` | Disk vs `run-gs-tests.js` lists vs `Tests_RunAll.gs`; prints one expected false positive for `Tests_EmailLifecycleFullCycle.gs`. |

### 15.2 How tests are proven (house style)

- **Mutation-prove everything new.** Scripts in the old session scratchpad changed production code one regression at a time and required a test to fail *by itself* (e.g. 25 mutations on the sweep, 21 on held alerts, 14 on freshness, 10 on tab pre-creation). Survivors are either fixed with a new test or explained as equivalent mutants.
- **Real writers feed real readers** in E2E (`snapshotPeriodic()` writes `Movement_Log`; the real 17:00/10:00 jobs read it).
- **Same-millisecond ties:** captures that share a millisecond in the mock collide; `Tests_MovementTracker.gs` goes through `capture_()` which waits for the clock to pass.
- **Test emails only to the three maintainer plus-addresses; every swapped global restored in `finally`; end with `TestAssertOnlyTestEmails_()`.**
- A newly added intermittent `F23 slow run` failure existed before; rerun before blaming your change.

---

## 16. Deploying a `.gs` change (the live procedure)

Nothing deploys itself. **Who does what:** you stage and verify; **Snehil presses Ctrl+S and runs `setupXxx()`** (§4.2).

1. **Know what is live.** In the live editor tab run the hash snippet from `docs/STALENESS_TRACKER.md` (SHA-256 of each Monaco model) and feed the string to `python3 test/match-live-gs.py "<hashes>"` (add `--apply` to rewrite the deploy register, or `--push` for one combined ready-to-paste snippet that brings *every* behind file — production **and** `Tests_*.gs` — to HEAD, SHA-verified per file). Always take the **bulk** hash of every open file, never only the file you edit (real incident 2026-10-01: `RmHierarchy.gs` was current while its own tests sat two commits behind).
2. **Stage.** Inject an `<input type=file>` into the editor page, upload the repo files with the extension's `file_upload` (works for 12 files / 874 KB in one call; a throwaway localhost payload server is *blocked*), **dry run** (each live model still equals its expected old hash; each upload equals HEAD), then `model.pushEditOperations([], [{range: model.getFullModelRange(), text}], () => null)` per file and re-hash. New files: "+" → Script → type the name in the inline rename box (focus it via JS), Enter — tab in the foreground, ≥ 5 s between additions.
3. **Save by Snehil.** Reload the page (so hashes come from the server, not the open tab), re-read all hashes, run `match-live-gs.py … --apply`, commit the register.
4. **Run the right `setupXxx()`** if a trigger changed (Snehil does). A new trigger whose checks depend on run records written by just-pasted code (the watchdog) must be installed after midnight and before the first job's deadline, or it flags jobs that ran before the records existed.
5. **Live checks:** `runAllTests()` (read per-suite lines), then the relevant read-only `show…Now()` function; after the next scheduled run read Executions and the log tabs.
6. **Rollback:** paste the previous version from `git show <sha>:<file>`; new tabs can simply stay.
7. **Never close the editor tab holding unsaved edits.** Copying via the PowerShell clipboard once mangled every multi-byte character; `Ctrl+A` once selected the file list instead of the editor — always compare the focused model's hash before saving.
8. **The Run button lags one selection** (§4.3): put read-only helpers *first* in new files; verify in Executions which function ran.

The record of the last big deploy (2026-10-10: 24 files, then a 9-file fix, then the triggers) is in `docs/STALENESS_TRACKER.md`'s sweep log.

---

## 17. The documentation system

Because no one else knew this codebase, a heavy documentation system grew around it (2026-09-07 → 09-11, largely driven by the "Documentation Project", 50 tasks `DOC-001…050`). It is real, mostly automated, and slightly over-built for a single-owner project — **respect it, but use judgment** about how much record maintenance a small change needs.

### 17.1 What exists

- **`docs/INDEX.md`** — the master table; one row and one record per component with stable ids: `TAB-`, `JS-`, `GS-`, `SHEET-`, `EXT-`, `DATA-`, `DASH-`, `FLOW-` (records), and sub-ids inside records: `FN-` (function), `RULE-`, `CFG-` (constant), `EXC-` (exception path), `BTN-`. Each record has Purpose, Location (`path#Lnn` anchors), Depends On / Used By (**must reciprocate with INDEX.md**), Last Verified (a real commit sha), Handover relationship, Validation, Next action.
- **Guides:** `HOW_TO_FIND_DOCS_FOR_A_FEATURE`, `HOW_TO_REGISTER_A_COMPONENT`, `HOW_TO_UPDATE_A_COMPONENT`, `HOW_TO_RETIRE_A_COMPONENT`, `NAMING_CONVENTIONS`, `PRE_SHIP_DOCUMENTATION_CHECKLIST`.
- **Tools:** `test/whatis.py <file>` (look-up), `test/check-catalog.py` (checks A–P: **A** reciprocity, **B** INDEX↔record-file coverage, **C** Location→file are *blocking*; **D** `Last Verified` drift and **E** change→component impact + a ready-to-run task JSON are advisory unless `CATALOG_STRICT=1`; F–P are further consistency checks added after the E2E acceptance test), `test/check-staleness.py` (anchors, stated facts via `FACT_CLAIMS`, deploy register, overdue chores; `--fix-anchors` repairs `#Lnn` drift; `--write` refreshes the tracker's AUTO block), `test/check-docs-coverage.js` (warn-only).
- **Frozen audits:** `LOGIC_AUDIT.md` (2026-09-07, 7 parts, never edited forward).

### 17.2 Rules that bit people

1. **Architecture changes update `HANDOVER.md` in the same commit** (it went a full week unmentioned through real redesigns on 2026-09-02→09 despite saying not to).
2. **Resolve check D's drift for records *your own* change caused before the session ends.** D is advisory because it can't tell your drift from old debt, but advisory ≠ ignorable (2026-09-21: eight records sat drifted/with `(pending commit)`).
3. **Never leave `(pending commit)` as a final `Last Verified`.** The working pattern: write a `PENDING_SHA` token, commit, then replace it with the real sha in the next commit (and remap again after any `git pull --rebase`).
4. **Adding a stale-prone fact? Register it** in `FACT_CLAIMS`.
5. After changing anything that reads/writes `Lead_Followups`, read `LEAD_FOLLOWUPS_STALENESS.md` first and add new consumers to its map.
6. After changing email routing/automatic-email/worst-performer logic, run `OPS_CHECKLIST.md`'s pre- and post-deploy items *in addition to* the test suite (it catches "correct but silently incomplete": an unthreaded argument, a rolling-vs-calendar window, a drifted constant).

### 17.3 Recurring chores (all manual today)

`[Stale Sweep]` on the 1st/11th/21st (work `check-staleness.py` top-to-bottom, append a sweep-log line); refresh the deploy register at least every 10 days; check `Movement_Log_Runs` dedup health weekly; re-compare the `leads` header with `HEADER_ALIASES` every 10 days; refresh `RM_HIERARCHY_RAW_` against the HR export every 14 days (largely superseded by the nightly sync once switched on); skim `OPS_CHECKLIST.md` monthly; confirm the weekly spot-check routine is firing.

### 17.4 The weekly spot-check routine

A cloud routine reads 3–5 component records against current source each week (checks cited literals, described behaviour, `#Lnn` anchors), fixes *documentation only*, and appends a "Cycle N" entry to `docs/_planning/weekly-spot-check-log.md`; cycles 1–5 ran (latest 2026-10-07); cycle 6 on 2026-10-06 failed for usage-limit reasons. Its prompt forbids touching code and requires CI green after its push.

---

## 18. Written but unused, withdrawn, superseded or dormant — what, when, why

This is the chapter you asked for. Every entry says **what it is, where, when it came about, why, and what to do** — and whether the reason is *recorded* (a commit message, doc or user statement) or *unknown* (git shows what changed, not why). **Do not delete anything here without asking Snehil**; several items are retained on purpose, and the project's convention for finished one-offs is "leave as a safe no-op".

### 18.1 Features that shipped, then were hidden or removed from the dashboard

| Item | When | Why (and how known) | State today |
|---|---|---|---|
| **Morning Brief tab** (the audit's "10 things every morning", `js/tab-morning.js`) | added 2026-08-22 (`c5c42a8`); **hidden 2026-10-03** (`9efec5d`) | User: "not really useful" [recorded]. | Tab *button* removed from `#tabBar`; the panel `#tab-morning`, `renderMorningBrief()`, and its checkpoint re-calls still run harmlessly into a DOM node nobody can reach (`TAB-001`, `JS-020`). Safe to resurrect by re-adding the button. |
| **Opportunity+ and Median 1st-Contact KPI tiles** on Overview | median/p90 first-contact added 2026-08-22 (`d993c52`); tiles removed 2026-10-03 (`9efec5d`) | Same commit as the Morning Brief hide, at the user's request; no separate reason recorded [unknown]. | Tiles gone. The underlying computations may still exist elsewhere — verify (`JS-012`) before deleting any helper. |
| **Anthropic-API "Claude-reviewed follow-up suggestions"** | added 2026-08-18 (`8687902`), **removed the same day** (`2525a1f` "Remove the Anthropic API integration") | Reason **not recorded** in git [unknown]. | Gone, except `js/core-outcome-engine.js:599` still runs `localStorage.removeItem('gsl_claude_api_key')` to clean up any stored key. |
| **"Stalled – Not Moved Since Last Email"** card | added 2026-08-18 (`6c783b2`), explained-absent (`1469b7e`), later folded into **Stalled (Flagged) Leads**, renamed **Stalled Leads** (`7029eed`), redefined comment-timing-based 2026-08-25 (`d5074e9`) | Iterations on one idea after real use [recorded]. | Dashboard-only; **not** the D8 stale-lead rule (§10.6). Two different definitions of "stale/stalled" coexist deliberately (D8: "the manual flow … stays as it is"). |
| **Compare-from/to picker, Status Changes, Time to Remediate** | picker added 2026-08-18; all three removed 2026-08-25 (`68ae2b3`) | Redundant after Stalled Leads was redefined [inferred]. | Removed. |
| **"Calls Made — Not Logged in CRM"** section | removed 2026-08-25 (`f74f7da`) | Reason not recorded in the subject [unknown]. | Removed. |
| **Reversed-stage detection** | added then removed 2026-08-22 (`c83ba37` → `ded05d7`) | "not possible by system design" [recorded in the commit]. | Removed. |
| **SLA Compliance Trend section** on Overview | removed 2026-08-19 (`86a7675`) | Moved to the persisted `SLA_History` tab and the Tracking tab [recorded] (`004a576`). | Removed from Overview. |
| **Redundant Movement CSV export** | dropped 2026-08-18 (`54e870a`) | Redundant [recorded]. | Gone. |
| **Tracking-chart "evenly-spaced days" X axis** | tried and reverted 2026-08-19 (`f2d7aa5`) | Reverted by the user/author [unknown reason]. | Continuous-time axis retained. |
| **Week-over-Week paired-bar chart** | removed 2026-08-28 (`989709f`) | [unknown]. | Gone. |
| **Repeat Offenders: "Avg Flagged" ranking, "Driven by" column, "Today" range option, >100-RM table, `aggregateRepeatOffenders`/`totalLeadsByKey`, the dashboard fetch of `Daily_RM_Issues`** | "Today" dropped 2026-09-02; ">100" table 2026-09-04; Avg Flagged replaced by the composite 2026-09-04; fetch removed 2026-09-04 (`7dc47ae`); "Driven by" replaced by instance count + hierarchy columns 2026-09-07 (`ff37899`) | Avg Flagged had no real denominator; Today has no complete data; the >100 table was always empty; the tab now reconstructs from `Movement_Log` [recorded, `HANDOVER.md` §9]. | Gone from the UI; see 18.2 for what remains in code. |
| **Region table "cap at worst 5"** | added then reverted 2026-09-09 (`1a37c14` → `9bcdcc0`), replaced by per-region worst-5-RM tables (`812a3cb`) | The cap hid regions; the user wanted per-region worst RMs [recorded in commit chain]. | Per-region tables live. |

### 18.2 Code present in the repo but no longer called

(From `DEAD_CODE_AUDIT_2026-10-03.md`, re-checked against the tree on 2026-10-10 unless noted.)

| Symbol | Where | When / why | Recommended handling |
|---|---|---|---|
| `rmPerformanceDrivenBy(r)` | `js/core-rm-performance.js:1241` | The "Driven by" column was removed 2026-09-07; the function is **deliberately kept** "in case a future request brings a 'why' column back" (its header comment). The `.gs` twin `rmPerformanceDrivenByGs_` *is* used (console leaderboard). `JS-008` FN-063 wrongly claimed use until fixed 2026-10-03 (`02463f6`). | Leave as is unless Snehil says otherwise. |
| `collatedCountLabel(arr, noun)` | `js/core-collation.js:155` | Duplicate of `uniqueCloneLabel` (16 real call sites); zero callers [verified 2026-10-10]. No removal decision recorded. | Safe to remove; ask first. |
| `MOVEMENT_LOG_RUNS_COLUMNS` | `js/tab-movement.js:55` | Looks intended for a header self-heal check like `MOVEMENT_LOG_COLUMNS`, never wired; the one write hardcodes the shape. The `.gs` twin is used. | Wire it up or remove. |
| `.hover-row:hover .card-detail{…}` | `dashboard.html:133` | CSS for a class never attached to markup (sibling `.hover-card` is used). | Remove or apply. |
| `sendOneOvernightEmail_` | `OvernightEmailer.gs` | The pre-redesign standalone 10:00 send. **Superseded 2026-09-23/24** by `sendCombinedMorningEmail_`/`sendCombinedFollowupEmail_`; not called by the live loop; kept alive by `Tests_OvernightEmailer.gs` (its Gmail-failure branch) and by comments elsewhere that name its pattern; retention clarified in a comment-only commit 2026-10-03 (`bed9dd2`). | **A genuine pending policy decision**: keep as a manual single-region tool or retire it with its ~2 test blocks. |
| **The `Daily_RM_Issues` nightly census itself** (`captureDailyRmIssues`, `Daily_RM_Issues` tab, backfill/repair helpers) | `DailyRmIssueLog.gs` | Built 2026-09-01 as the data source of the Repeat Offenders tab. On **2026-09-04/05** the tab moved to reconstructing the eligible book from `Movement_Log`, so **nothing in this repo reads `Daily_RM_Issues` any more** (`HANDOVER.md` §9.3, P18 note "the dashboard moved to Movement_Log on 2026-09-05"). Yet it still writes ~10,000 rows a night (≈ 1.5 M cells at 7-day retention), caused three of the 10M-cell crashes, and consumed the entire P18 effort. The `.gs` classifier in the same file *is* still used by `reportRmPerformanceNow()`. | **Strong candidate for retirement** — a decision for Snehil, not something to do silently. Check nothing external (a Looker/Sheets chart) reads the tab first [unknown]. |
| `Send_Log` writer (dashboard), `Comment_History` writer | `js/sheets-writeback.js`, `InteractionHistoryLogger.gs` | Audit-trail/forward-capture datasets with **no code reader** by design (`Comment_History`: "a forward-capture interaction-history dataset", pruned to 30 days since 2026-09-29; before that unbounded-by-design). | Keep; retention decisions in `retention-decisions-needed.md`. |
| `CONFIG.MIN_CALLS_AFTER_48H` (= 10) | `js/core-foundation.js:33` | Display-only; disagrees with the real "5 calls" threshold. Known MED finding #2 (`GS-012` EXC-088). | Fix or document; unresolved since 2026-09-07. |
| Browser-only `HEADER_ALIASES` keys `lead_closing_comment`, `project_region` | `js/core-sheets-fetch.js` | Intentional: no `.gs` file reads those columns. | Keep. |

### 18.3 Superseded designs whose remains you will meet

| What | When superseded and why | Remains |
|---|---|---|
| **Monthly-rotating leads tab** (the sheet tab was renamed each month and auto-detected) | Switched to a fixed `leads` tab **2026-09-01** (`3ec2310`): "the sheet no longer rotates". | `TAB_NAME_OVERRIDE = 'leads'`; comments still mention the old behaviour. |
| **Fixed per-region recipient list** (`Region_Recipients`) | Replaced 2026-08-24 (`4723ab3`, `837fa98`) by per-RM manager-chain routing. | Still the **fallback** for unresolvable RMs; the dashboard's "Edit region recipients" panel (browser `localStorage` + this tab) and the manual summary email (commit `5053a38`: "always uses Region Recipients, never RM_Hierarchy") are alive. The DB review flagged the `localStorage` store as the strongest single inconsistency. |
| **Snapshot cadence**: twice-daily → `everyHours(6)` → four `atHour` triggers | `everyHours` drifted/skipped under load; changed 2026-08-25 (`2c8100b`). | `setupMovementTracking()` deletes legacy `snapshotEvening`/`snapshotMorning`/`everyHours` triggers. |
| **Movement_Log dedup**: timestamp-only → `content_hash` (2026-09-11) → keyed `client_id` → keyed `lead_id|RM` (2026-09-26) | Each step fixed a concrete junk-row incident (§20). | Header must end `…, opp_at, content_hash`; `assertMovementLogHeaderAligned_` guards it. |
| **Hierarchy source**: org chart → HR "Book7" export (2026-08-25) → HR Live export + Python refresh scripts (2026-08-31/09-22) → nightly sync (2026-10-08) | Each manual refresh lapsed (new Cluster Head missing ~13 days; a departed manager persisting 3 months). | `RM_HIERARCHY_RAW_` is now only a seed once the sync applies; Python scripts remain for the by-hand path. |
| **Chain-resolves-to-CH emails going to the CH directly** | Replaced 2026-08-26/27 by CH-level *reports to ops* after a real "Rahul Gandhi" incident (an RH/CH became a recipient). | `notifyChLevel*Gs_` functions. |
| **Sweep time & semantics**: 15:45 → 15:30; STOP-only tracker row on a bounce → `REROUTED`; minimum email age 30 → 10 min | Decision D9 (2026-10-10). | `setupEmailSweepTrigger()` removes the old 15:45 trigger. |
| **Standalone 10:00 + 13:00 overnight emails with no 17:00 follow-up** | Two-checkpoint lifecycle (2026-09-23/24): the 17:00 population is followed twice, inside the same emails. | `sendOneOvernightEmail_` (above); `Overnight_Log` rows older than same-day are dead weight (prune candidate, `retention-decisions-needed.md`). |

### 18.4 Email Operations System: planned or decided, then dropped, withdrawn or only partly built

| Item | Date | Why | State |
|---|---|---|---|
| **Separate 13:35 / 17:35 / 19:00 audit and end-of-day emails** | planned 2026-10-09; dropped same day | Decisions D1/D2: one report to Snehil at 16:30; clean audits stay silent. | The *checks* run silently (`OpsAudit.gs`) and feed the 16:30 report. |
| **Decision D6 – bottom "Data freshness notice" for a stale Leads tab, and D7 – "stale = tab's newest lead ≥ 24 h (AMBER from 12 h)"** | built 2026-10-09 (`ea5fdc5`, `8ebf41a`); **withdrawn 2026-10-10** (`5850ed5`, `5341dfe`) | They rested on a **misreading**: "stale lead" meant *a lead with no activity for 24 h* (D8), not a stale Leads *tab*. Thresholds returned to the original 3 h / 5 h as a 16:30 warning only. | Removed from the emails; docs scrubbed. Do not reintroduce a tab-level notice. |
| **`Email_Ledger_Leads` (per-lead child rows)** | designed 2026-10-09 | Replaced by exclusion-only `Email_Ledger_Exclusions`; lead ids live in `lead_ids_json`. | Never built as designed. |
| **EO-10 row-count sanity check and duplicate-lead-id check on the Leads tab** | 2026-10-09 | Only the freshness warning was built. | Not built. |
| **EO-11 fault-injection suite as a separate `Tests_EmailOps_E2E.gs`** | 2026-10-09 | Built as acceptance scenarios inside the existing suites (table at the end of the operating manual). | Different shape than planned. |
| **"Stop follow-ups automatically on bounce/reply"** | open question 2026-10-09; answered 2026-10-10 (D9) | A bounce *re-routes* instead of stopping; a reply changes nothing **[assumption]**. | No auto-stop exists. |
| **Bounce-check slots**: user wrote "keep check after every email. 15:30, 10:30, 01:30 even for follow up" | 2026-10-10 | I read "01:30" as 13:30 PM and **added 17:30** myself for the 17:00 emails ("after every email"). | **[assumption] — confirm with Snehil.** |
| **Email-lifecycle "Step 10/11 live verification" test rows** | 2026-09-24 | A live TEST-MODE run wrote 28 real-looking `AllIssues_Log` rows. | Removed 2026-09-26 by `removeTestModeAllIssuesRowsNow` (constants `TEST_MODE_ROWS_*` remain). |

### 18.5 One-off remediation functions that have done their job

Convention here: **leave finished one-offs as safe, guarded, idempotent no-ops rather than deleting them** — each archives before deleting and refuses to act on an unexpected shape.

| Function | File | Ran | Purpose / incident |
|---|---|---|---|
| `removeEarlyCorruptedMovementLogDataNow` | `MovementTracker.gs` | 2026-09-17 | Drop `Movement_Log` rows before 12 Sep (a restore after the 09-12 data loss had broken chronological order). Its first version duplicated the whole sheet (2.86 M cells) and its stray backup tab sat for 11 days (fixed `834d7ea`/`2d4a573`; the tab removed 09-28). |
| `removeDedupIncidentRowsNow` | `MovementTracker.gs` | 2026-09-25 | Archive and delete 52,060 junk rows from the `opp_at`/header-misalignment incident. |
| `removeStaleMovementLogBackupTabNow` | `MovementTracker.gs` | 2026-09-28 | Removed the leftover 109,999-row backup tab (cell budget 98.2% → 69.6%). First live attempt hit Drive's file-size ceiling → chunked archive. |
| `removeOppConversionTrackingTabNow` | `Core.gs` | 2026-09-29 | Removed the empty `Opp_Conversion_Tracking` scratch tab (refuses if it ever finds data). |
| `removeTestModeAllIssuesRowsNow` | `AllIssuesEmailer.gs` | 2026-09-26 | Removed the 2026-09-24 test rows. |
| `backfillTodaysOvernightLogRecipientsNow` | `OvernightEmailer.gs` | 2026-08-25 | One-off backfill of that day's already-logged `Overnight_Log` recipients (`8e60432`); its comment calls it a one-off. |
| `repairDailyRmIssuesMissingFieldsNow`, `refillDailyRmIssueAssignedAtNow` | `DailyRmIssueLog.gs` | 2026-09-01 / 2026-10-08 | Schema/date repairs for the nightly census. |
| `dedupeUnmatchedCommentsNow` | `UnmatchedCommentLogger.gs` | after the 2026-09-03 fix | Collapse the duplicate backlog. |
| `precreateEmailOpsTabsNow` | `EmailLedger.gs` | 2026-10-10 17:26 | Created the four missing Email Ops tabs after the first-run crash. Safe to run again (leaves existing tabs; refuses foreign headers). |

### 18.6 Console and debug utilities (intentional, no UI)

`downloadNoIssueLeadsNow` / `debugFollowupStatusNow` (`OvernightEmailer.gs`; the first is why a `Debug_NoIssueLeads` tab of 26,000 cells exists), `debugDailyCohortEvidence` (browser console), `listExcludedRmsNow` / `clearAllRmHierarchyExclusionsNow`, `auditUnresolvedRmsNow`, `auditManagerDirectoryEmailGapsNow`, `reportWorkbookCellUsageNow`, `reportRmPerformanceNow`, `checkMovementLogFreshnessNow`, `snapshotNow`, `persistDailyCohortHistoryNow`, all `show…Now` previews of the Email Ops system, and the `…ForceNow` recovery variants. `sendOpsAlertNowGs_` is a sender used by tests/ops. Each is named in `HANDOVER.md` §4.3/§9.3.

### 18.7 Switches that exist but are off or empty

- `TEST_MODE_OVERRIDE_EMAIL_` / `TEST_MODE_OVERRIDE_EMAIL` — empty in both runtimes; a silent recipient-redirect footgun if ever set (known item).
- RM-hierarchy sync **apply** — script property `RM_HIERARCHY_SYNC_APPLY`; report-only as of 2026-10-09 [state since unknown].
- `…ForceNow` recovery variants — send past the cutoff only on purpose.
- Browser `localStorage` override of the OAuth Client ID.

### 18.8 Written strategic documents that were **not** adopted or only partly implemented

| Document | Size | Status |
|---|---|---|
| `docs/_planning/DB_ARCHITECTURE_REVIEW.md` (2026-09-11; a 12-part review proposing a central database with an 8-phase migration, plus an 8-phase "Lead History & Versioning Review" appended) | 4,257 lines | **A proposal with an "Approval Checkpoint"; no approval or migration is recorded; nothing from the database proposal was built.** One slice **was** implemented: Phase 6, content-hash dedup of `Movement_Log` (merged 2026-09-11, `1c19d1a`), later hardened (§20). Do not treat the document as a description of reality. |
| `docs/_planning/REPEAT_OFFENDERS_ARCHITECTURE_REVIEW.md` (2026-09-12) | 895 lines | Steps 1–4 of 5 landed (canonical result cache; PDF reads the cache; PDF disabled while recalculating; regression tests). Step 5, "final cleanup + full verification pass", has no recorded commit [unknown]. |
| `docs/_planning/E2E_ACCEPTANCE_TEST_*` (2026-09-10/11) | 843 + 304 lines | An acceptance test of the *documentation system*: verdict **FAIL** in three rounds (the final round had zero automation-matrix FAILs); ten required fixes became checks F–P in `check-catalog.py`. |
| `docs/_planning/FORENSIC_COMPLETENESS_AUDIT_*` | 643 + 436 lines | Verdict "one-time completeness ~95%, continuous ~15%"; P0–P3 actions done (§17). |
| `docs/_planning/OPEN_ITEMS.md` §B | — | 7 retention decisions (`leads`, `Lead_Followups`, `SLA_History`, `Daily_Cohort_History`, `Send_Log`, `AllIssues_Log`, `Overnight_Log`) routed to the owner; 2 already decided and offered for ratification. Mostly **unanswered**. |
| `docs/Lead_Lifecycle_Tracking.pptx` (2026-09-03), `design/live-ops-redesign.html`, the 2026-08-22 redesign mockups (`eee5dfb`…) | — | Presentation and mockups; not wired to anything. The 5-phase redesign that followed the mockup *was* implemented (`212e6fc`…`f05d02f`). |
| `LOGIC_AUDIT.md` | — | Frozen 2026-09-07 point-in-time audit; its HIGH/MED findings live on in `OPEN_ITEMS.md` §F. |
| `DOCUMENTATION_PROJECT_PLAN.md` | — | Plan for the catalog; marked a "pre-build snapshot". |

### 18.9 Stale copies and loose artifacts — do not mistake them for the real thing

- **`working files on 28th for automatic email/`** — untracked snapshot of five `.gs` files from mid-development (2026-08-28). **Not authoritative; contains older code including a hard-coded ops address** — never commit or publish it. Safe to delete (`HANDOVER.md` line 132, dead-code audit).
- **`.claude/worktrees/serene-chaplygin-6a5170/`** — a complete stale copy of the repo inside the untracked `.claude/` folder (from a 2026-09 worktree session). Greps return hits from it; exclude it.
- **Two same-named Apps Script projects under Snehil's own account** (ids starting `1dyTKj…` and `1PHcBS…`, last modified 2026-09-12) — byte-identical *old* copies, **not live**.
- **`Debug_NoIssueLeads` tab** (26,000 cells) — created by `downloadNoIssueLeadsNow`; flagged 2026-09-28 as probably scratch; no deletion recorded [unknown whether still present].
- **`docs/_archive/`** is an empty placeholder; `docs/changes/` holds one backfill record (no post-catalog code change has yet produced one).
- **`Tests_EmailLifecycleFullCycle.gs`** had never been pasted into the live project until 2026-10-07, so `runAllTests()` failed there with a `ReferenceError` before that date.

---

## 19. Decision log

User-made decisions (dates are when stated; "D#" labels belong to the Email Operations plan).

| Date | Decision | Notes |
|---|---|---|
| 2026-08-17 | Judge each RM copy of a lead independently; show unique-vs-cloned counts everywhere | Fixed several double-counting bugs. |
| 2026-08-24 | Overnight emails route to each RM's real manager chain, one email per **A1/TL** bucket, never combined; Cc RH/CH + two standing leadership addresses | `837fa98`, `bf9c569`. |
| 2026-08-26 | RH/CH never an *intended* recipient; CH-level alert → full report to ops (+CH-level address), no Cc | Rahul Gandhi incident. |
| 2026-08-27 | AllIssues email added and set to 17:00 IST | `e93508b`, `91b333c`. |
| 2026-09-01 | Fixed `leads` tab name; CH-level backstop for unresolved chains | |
| 2026-09-09 | **Ask before large autonomous work** | §3.3. |
| 2026-09-10 | Pruned 57 record-only INDEX edges (Option A) so records equal INDEX exactly | Documentation project. |
| 2026-09-24 | Two-checkpoint lifecycle live | |
| 2026-09-25 | Futwork agents emailed only to Snehil, one email per job | |
| 2026-09-26 | "No email for resolved status" — checkpoint sections list only unresolved leads; P&L-head Cc for Hyderabad/Bangalore (Thane/Navi Mumbai added 09-30) | |
| 2026-09-29 | 30-day retention for `Comment_History` and `Unmatched_Comments_Log`, age-based **independent of `reviewed`** (an unreviewed comment can age out — an explicit tradeoff); Futwork + one admin excluded from RM Performance | Reversed earlier "unbounded by design". |
| 2026-09-30 | Posterior-confidence thresholds 0.40 / 0.35 (below 0.5 on purpose); UI/PDF show the confidence % | Two rounds of questions. |
| 2026-10-01 | Rajesh Muni / Manisha rathod: Cc Snehil only | |
| 2026-10-03 | Loan-team emails → Mayur Panjari, no Cc; hide Morning Brief; remove two KPI tiles | |
| 2026-10-05 | Audit before fixes (rule 4); then P1–P18 executed | |
| 2026-10-08 | RM hierarchy sync: leavers never removed until told; report to Snehil, Sushil, Ashish; first tab only; report-only default; `rebuildRmHierarchy` refuses once applying | |
| 2026-10-09 | D1–D5: report to Snehil only, one 16:30 report; errors only after the rest of the job is confirmed (held alerts); drop only the defective lead; Leads tab ~2-hourly, AMBER >3 h / RED >5 h as a warning; late-send until 18:30 | |
| 2026-10-10 | D8: stale lead = no update for >24 h whenever created; listed in a red block at the bottom of **every** automatic email, staying in counts. D9: bounce → next in hierarchy, else Snehil; checks after every email. Dashboard manual flow "left as it be for now". | D6/D7 withdrawn. |
| 2026-10-10 | "send email based on previous method and understanding" → the 17:00 emails were re-sent by hand after the crash (28 buckets, 0 failed) | |
| 2026-10-10 | "I want to migrate from personal Claude to team Claude" | This document. |

---

## 20. Incident history and the lessons each one left

(More detail: `HANDOVER.md` §8, §9.2, §4.3.4; `STALENESS_TRACKER.md` sweep log.)

| Date | What happened | Root cause | Fix / lesson |
|---|---|---|---|
| 2026-08-21 | Fuzzy keyword matching froze the dashboard | O(n²) edit-distance on every render | Perf fix `edacfaa`; blocking loading overlay. |
| 2026-08-24 | Recurring Sheets timeouts right after `insertSheet`/`deleteSheet` | Service stalls after structure changes | `SpreadsheetApp.flush()` after each (`4e0c472`). **The same lesson recurred on 2026-10-10.** |
| 2026-08-25 | 1 pm follow-up silently sent zero emails; didn't thread; went to the script's own account | Date-vs-string comparison; thread-id handling | Fixed same day. Sheets turns date-like strings into `Date`s — compare as dates. |
| 2026-08-26 | `Movement_Log` unbounded row allocation hit the 10 M cap | Grid growth | `951ceea`; later retention/prune work. |
| 2026-09-01 | `captureDailyRmIssues` ran ~475 s and wrote zero rows | Single oversized `setValues()` (unconfirmed) | 5,000-row chunks; `backfillOneDayFromMovementLogNow`. |
| 2026-09-02 | 17:00 email 50–58 min late; later slow runs | Unpinned `atHour` trigger; Gmail "Not found" retry with a rate-limit backoff | `.nearMinute(0)`; flat 400 ms wait. |
| 2026-09-03 | `Unmatched_Comments_Log` re-logged every comment each run; `isNotUpdated` dropped leads past 48 h | Date-typed read-back; a gate that silently reclassified | Fixed; regression tests simulate the real Date behaviour. |
| 2026-09-06 | Nightly capture crashed: 10 M-cell limit | `Daily_RM_Issues` had no retention from launch | 7-day prune, run **before** the write. |
| 2026-09-09 | Lead 2229674 read as stuck on an issue it had passed | `Lead_Followups` row ~19 h stale | Conditional formatting, age caption in the 13:00 email, `LEAD_FOLLOWUPS_STALENESS.md`. |
| 2026-09-12 | **Catastrophic `Movement_Log` data loss** | `pruneMovementLog_` was unsafe against interruption (mechanism in `GS-008`; commit `16a9ec6`) | Crash-safe ordering — write the kept rows first, prove the archive, only then delete — which every later prune copies. The restore then broke chronological order → corrupt dedup → cleanup 09-17 → its own full-duplicate backup bug (fixed same day) → leftover tab found 09-28. |
| 2026-09-21 → 09-24 | `captureDailyRmIssues` hit the 10 M ceiling again (twice more) | Large `Movement_Log`/`Daily_RM_Issues`; after-write prune can't self-heal | Prune up front; Monday cell-budget alert. |
| 2026-09-22 → 09-26 | ~52 k junk `Movement_Log` rows; every capture re-appended every lead | Adding `opp_at` made the header self-heal append *after* `content_hash`; a raw NUL byte in the hash separator turned into a space on paste; dedup key too coarse (`client_id`) | Insert before `content_hash`, alignment guard, `'\u0000'` escape, `lead_id|RM` key; archived and deleted the junk. **Raw control characters in `.gs` are now detected by `check-staleness.py`.** |
| 2026-09-24/25 | CH-level backstop Cc'd leadership; TEST-MODE run polluted production state and sent a Checkpoint to the tester; 13:00 job crashed on a 50,000-character cell | Missing rules; test mode wrote real state; unbounded JSON merge | CC fix; `writeUnlessTestModeGs_`; `jsonForCellGs_` cap + per-bucket isolation. |
| 2026-09-28 | Workbook at 98.2% | Leftover 2.86 M-cell backup tab + unbounded comment tabs | Removed (archive-first); 30-day retention; weekly report. |
| 2026-10-01 | Pre-Sales team (7 people) had no hierarchy row; "Behind on Calls" undercounted | Never in any HR export; delta-vs-baseline ignored a logged comment | Self-auditing rebuild; `max(delta, comment count)`. |
| 2026-10-01/02 | 13:00 replies carried every region's Checkpoint 2; 13:00 job `Failed` silently after a server error | Keyed by recipient email only; `withRetry_` didn't match the platform's wording; no one asked "did the jobs run?" | Email audit P3, P12, P9 (watchdog). |
| 2026-10-05 | Full email-pipeline audit (F1–F25) | Systemic | P1–P18; docs in `EMAIL_AUDIT.md`. |
| 2026-10-07 | Comment prunes had been failing silently; `atob` in tests; per-customer call baseline wrong; `snapshotPeriodic` hit the 30-min limit 3× in 5 days | Multi-line CSV comments miscounted by a line-count proof; test helper used a browser global; baseline keyed by `client_id`; four full-width reads per run | `countCsvRecordsGs_`; `check-gs-runtime-globals.py`; per-lead baseline; time-budgeted optional phases. |
| 2026-10-08 | `Daily_RM_Issues` rows lost their dates and were deleted as "older than the window"; an unintended midday capture run | A Date written to a bulk range read back blank (chunk-dependent); the editor's Run lagged one selection | Text-written date columns, undated rows get a date, refill; **put read-only helpers first**. |
| 2026-10-09 | `snapshotPeriodic` died after 1,360 s with platform "Error code INTERNAL" | Platform fault in `computeDigest` under heavy call volume; not a catchable JS error | Expected occasional noise; watchdog superseded by next run. |
| **2026-10-10 17:04** | **First scheduled 17:00 run on the new Email Ops code failed after 50 s; no email sent** | New ledger tabs were *created inside the job*; the spreadsheet service then timed out; the job's own first `getLastRow()` of `AllIssues_Log` wasn't wrapped in `withRetry_` | Re-ran by hand at 17:12 (28 buckets, 0 failed); first reads retried; `precreateEmailOpsTabsNow()`. **Lesson: pre-create tabs at a quiet time; never rely on in-job tab creation.** I should have pre-created them before the first scheduled run. |

Recurring themes worth internalising: (1) *date-like strings become dates*; (2) *the workbook's size and structure changes are the dominant fragility*; (3) *"fixed in git" ≠ "live"*; (4) *a test harness that provides browser/Node globals can hide an Apps Script gap*; (5) *a platform "INTERNAL" error does not unwind through try/catch, so a run record can stay `running`*.

---

## 21. Open items, unconfirmed assumptions and first-run checks

*Snapshot: 2026-10-10 evening.*

### 21.1 Waiting to be observed (new code, never run on a real schedule)

| When | What | Look at |
|---|---|---|
| 2026-10-10 ~17:30 / ~18:00 | `sweepBouncesAfterAllIssues`, `auditAllIssuesEmails` | Executions; no unexpected ops alert. |
| 2026-10-11 10:30, ~11:15, 13:30, 14:00, ~15:30 | first bounce-only checks, first audits of the 10:00/13:00 emails, first full sweep | Executions + `Email_Ledger.bounce_status`/`swept_at`. |
| 2026-10-11 ~16:30 | **first `sendEmailCycleReport`** | The email, `Daily_Report`, `Daily_Checklist`, `Followup_Tracker` rows. The report also writes tabs that now exist (pre-created), so the in-job stall should not recur. |
| Next days | A bounce for real | `Email_Reroutes` row, banner on the replacement's copy, ledger job `reroute`. |
| Now | Hourly watchdog may have flagged "did not run" for jobs scheduled before their triggers existed (today only) | Expected once. |

### 21.2 Unconfirmed assumptions (ask Snehil)

1. A **reply** to a report email changes nothing (only a bounce escalates).
2. The **17:30** bounce-check slot, the **10-minute** minimum email age, and the 3-hour limit for re-sending a copy that itself bounced are my choices.
3. An email still being sent after ~17:45 is first bounce-checked at 10:30 next morning.
4. Which Google account the triggers run as; whether the RM-hierarchy sync **apply** has been switched on.
5. Whether anything outside this repo reads `Daily_RM_Issues`.
6. Whether the team still wants the To-Do Dashboard workflow and the Downloads-copy rule.

### 21.3 Known gaps and findings (carried from `OPEN_ITEMS.md` §F and later work)

- **HIGH — Loan-region `effectiveRegion` override has no working Apps Script twin** (`MovementTracker.gs` has a `GROUP_SOURCE`-only port; the emailers don't override). Partly mitigated since 2026-10-03 by loan-team routing straight to Mayur Panjari. Unverified whether anyone considers it closed.
- MED: `browserSnapshotOpenLeads` has no reentrancy guard (`JS-018` EXC-034); `CONFIG.MIN_CALLS_AFTER_48H` display-only (§18.2); unguarded cross-runtime `Lead_Followups` overlap window.
- LOW: "Possible Premature Closes" has no email equivalent; KPI strip mixes customer- and issue-level counts; dropped click during rapid filter changes; `RmHierarchy.gs` is a single point of failure for both scheduled emails; `_allReports` bare cross-file `let`.
- **`OUTCOME_RULES` ~110 vs `OUTCOME_RULES_GS_` ~30** — needs a maintainer determination (fewer outcomes, or incomparable counts?).
- 10:00 and 13:00 triggers lack `.inTimezone('Asia/Kolkata')` (§8).
- A blank RM or region hashes `Unassigned` in the browser but blank in Apps Script, so the two `Movement_Log` writers disagree on those rows (minor, recorded 2026-09-26).
- The dashboard's manual region-email flow has no stale block, no re-route, no ledger.
- 7 retention decisions (`OPEN_ITEMS.md` §B) and the `Manager_Directory` rebuild question (does a rebuild preserve hand-filled emails?).
- Email Ops: row-count and duplicate-id checks on the Leads tab (EO-10 remainder); live `runAllTests()` not re-run after the 2026-10-10 retry/pre-create fix.
- **Structural:** the workbook's steady-state size is uncapped; a separate log spreadsheet or retiring `Daily_RM_Issues` would give the most headroom. `snapshotPeriodic` and `captureDailyRmIssues` can still hit platform limits (§20).
- Pending retirement decisions: `sendOneOvernightEmail_`, `collatedCountLabel`, `MOVEMENT_LOG_RUNS_COLUMNS`, the `.hover-row` CSS, `Daily_RM_Issues` (§18.2).
- Cleanup: `working files on 28th…`, `.claude/worktrees/…`, the two stale Apps Script projects, `Debug_NoIssueLeads` (§18.9).
- Weekly spot-check routine failing on the old account (§2.3).
- **Overdue chores right now** (`python3 test/check-staleness.py`, 2026-10-10): the `Movement_Log` dedup-health check (last done 2026-09-25, due 2026-10-02) and the `leads`-header-vs-`HEADER_ALIASES` check (last done 2026-09-22, due 2026-10-02) are both STALE; the deploy-register refresh and the spot-check routine are AT-RISK. The "Claude memory index vs reality" watch item refers to the old account's memory and should be rewritten for the team account.

---

## 22. Project timeline

| Period | What happened |
|---|---|
| **2026-08-14 → 08-19** | Repo created as "Google Search Leads SLA Monitor dashboard"; region email reports, lead collation, `call_attempts` delta logic, Tracking/RM Timeline/Audit tabs, `SLA_History` persisted to a tab. |
| **08-21 → 08-23** | Modularity refactor of the monolithic script; visual redesign (5 phases); Morning Brief. |
| **08-24 → 08-31** | First Apps Script emailers (`OvernightEmailer.gs` 10:00/13:00, then `AllIssuesEmailer.gs` 17:00); `RmHierarchy` routing from the HR export; CH-level handling; `.gs` split into 8 files and the mock test suite; perf passes; `HANDOVER.md` written (08-31). |
| **09-01 → 09-05** | Fixed `leads` tab; Repeat Offenders built and rebuilt into the RM Performance engine; `CLAUDE.md`; CI for the test suite; `Comment_History`. |
| **09-07 → 09-12** | `LOGIC_AUDIT.md` (7 parts); Documentation Project (50 tasks) and the catalog; DB architecture and lead-history reviews; content-hash dedup; the `Movement_Log` data-loss incident (09-12). |
| **09-15 → 09-22** | Data-loss cleanup; Opp Monitor tab; Drive-CSV archive; drift/parity/registration tooling; `opp_at`. |
| **09-23 → 09-30** | Two-checkpoint email lifecycle; Futwork; test-mode fix; 10 M-cell cleanup; posterior-confidence flagging; staleness tracker and live-editor reading. |
| **10-01 → 10-05** | Pre-Sales/Loan routing; dead-code audit and feature-usage tracking; Morning Brief hidden; full email audit. |
| **10-05 → 10-09** | Audit fixes P1–P18; watchdog; nightly hierarchy sync; Email Operations System plan and build. |
| **10-10** | D8/D9 decisions, deployment of 24 files, first-run crash and fix, 8 new triggers, this hand-over. 746 commits since 2026-08-14. |

---

## 23. Your first week

1. Read §1–5 and §18–21 of this file, then `CLAUDE.md`.
2. Ask Snehil the §21.2 questions, and for: the private hierarchy file (out of band), editor access, the Chrome sign-in arrangement, and whether to keep the To-Do Dashboard and the Downloads-copy rule.
3. `git pull`, run `python3 test/run-gs-tests-headless.py` (expect 3,370 passed), `python3 test/check-catalog.py`, `python3 test/check-staleness.py`. Read what they print.
4. In the live editor run **only** the read-only `show…Now()` helpers (`showEmailConfigNow`, `showEmailJobRunsNow`, `showEmailCycleReportNow`, `showEmailLedgerTodayNow`, `showEmailSweepPlanNow`, `showEmailAuditNow`, `showFollowupTrackerNow`, `showDailyChecklistNow`, `showEmailReroutesNow`, `showRmHierarchySyncStatusNow`) and read the Execution log after each.
5. After 16:30 on 2026-10-11 read the first cycle report with Snehil and walk the §21.1 table.
6. Take a recorded decision on the weekly spot-check routine (§2.3).
7. Before your first change, run `python3 test/whatis.py <file>`; after it, update the record, run the checks, commit, push, copy to Downloads as agreed, and tell Snehil the file is **not live until pasted**.

---

## 24. Glossary

**A1 / TL** team lead (the first-level manager of an RM; "A1" and "TL" are used interchangeably; `tl` field) · **TM** team manager · **RH** regional head · **CH** cluster head (plus City Lead, Commercial Head, "Leadership") · **RM** relationship manager (the sales person a lead is assigned to) · **Bucket** one recipient group × one region × one job = one email · **Primary** the bucket's addressee · **Checkpoint 1/2** the 10:00 and 13:00 re-checks of yesterday's 17:00 snapshot · **Section 1/2** the two parts of the combined 10:00/13:00 emails · **CH-level report** a report sent to ops (not the CH) when leadership or a CH/City Lead personally holds leads · **Backstop** the last-resort route for an RM that resolves nowhere · **Futwork** a tele-calling vendor whose agents' leads go only to Snehil · **Opp / Opportunity+** a lead at or beyond the Opportunity stage · **Same-day / 48 h Opp%** the share of leads reaching Opportunity within the same day / 48 hours · **Clones / collation** several RM rows of one customer · **Snapshot** a `Movement_Log` capture · **Content hash** the SHA-256 of a lead's tracked fields · **Held alert** an ops alert deferred until the rest of the job is confirmed · **Accepted** Gmail's `send()` returned (never "delivered") · **Ledger** `Email_Ledger` · **Ops address** Snehil's mailbox, the sink for alerts and reports · **Deploy register** the table of last-confirmed-live commits per `.gs` file · **IST** Indian Standard Time, UTC+05:30, the only timezone that counts.

---

*End of hand-over. If you find this file wrong, the code is right — fix this file in the same commit that proves it.*
