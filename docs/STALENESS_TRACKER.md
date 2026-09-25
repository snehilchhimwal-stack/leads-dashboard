# Staleness tracker

The one file to open when the question is "what here is stale, or about to
be?" — so a session reads it (or runs the command below) instead of
re-deriving it from memory.

```bash
python3 test/check-staleness.py                # read the report
python3 test/check-staleness.py --fix-anchors  # auto-fix drifted #Lnn anchors in docs/ records
python3 test/check-staleness.py --write        # refresh the AUTO block at the bottom of this file
```

**Cadence:** the recurring **`[Stale Sweep]`** tasks in the To-Do Dashboard,
firing on the **1st, 11th and 21st** of every month (the same three trigger
days as the Opp Monitor workflow). Each run works this file top to bottom
and appends one line to the sweep log. It sits alongside — not instead of —
`check-catalog.py` (structure), the weekly cloud spot-check
(`_planning/weekly-spot-check-log.md`, prose accuracy) and the 1st-of-month
docs reconciliation task.

## What "stale" means here

| Word | Meaning | Action |
|---|---|---|
| **STALE** | already wrong: a line anchor points at the wrong line, a record's source moved since `Last Verified`, a stated fact in CLAUDE.md / HANDOVER.md no longer matches reality, a `.gs` commit is newer than its confirmed live paste, a watch item is past its TTL | fix it in the sweep |
| **OVERDUE** | a record is older than its TTL (30 days; 14 for a file with 3+ commits in the last 14) — probably still right, but nobody has looked | re-read it against source, bump `Last Verified` with the real sha |
| **AT-RISK** | will go stale within one sweep interval (10 days), or already has an unverified baseline: near-TTL records, uncommitted code with no record edit, an unconfirmed deploy baseline | act before the next sweep if cheap |

## Watch register (curated — edit this table)

Time-based items that no code path notices on its own. `Last done` is a
`YYYY-MM-DD` date, or `auto:` (computed from git / a log by the script). After
doing an item, set its date — that is the whole update.

| Item | How to check | TTL (days) | Last done | Owner |
|---|---|---|---|---|
| Deploy register refreshed from the live editor | read the live Apps Script editor from Chrome (snippet + steps in the deploy-register section below) and run `python3 test/match-live-gs.py "<hashes>" --apply`; needs a Chrome tab signed in as Snehil. Without this the register only knows what someone remembered to record | 10 | auto:deploy-register | Claude |
| RM_HIERARCHY_RAW_ vs the HR Live roster export | needs a fresh export from Snehil, then `python3 test/refresh-rm-hierarchy.py <export.csv>` (dry run, then `--apply`). Proxy date = last `RmHierarchy.gs` commit. Real incident: Zoya Fathima missing ~13 days, 2026-09-22 | 14 | auto:git:RmHierarchy.gs | Snehil + Claude |
| `leads` tab header vs `HEADER_ALIASES` / `HEADER_ALIASES_` | read row 1 through the signed-in dashboard tab's Sheets API session; any header no alias covers is a new CRM column (this is how `opp_at` sat unwired until 2026-09-22) | 10 | 2026-09-22 | Claude |
| HANDOVER.md section 8 incident list + section dates | re-read against recent incidents; also see the G line in the report | 30 | auto:git:HANDOVER.md | Claude |
| Weekly doc spot-check cloud routine still firing | latest `## Cycle N` date in `_planning/weekly-spot-check-log.md` — late means the routine died silently | 8 | auto:log:weekly-spot-check | Claude |
| Claude memory index vs reality | skim `MEMORY.md` against the repo; fix or drop contradicted entries (`consolidate-memory` skill) | 30 | 2026-09-25 | Claude |
| OPS_CHECKLIST.md open items | skim for unactioned items; run its periodic checks. Proxy date = last edit to the file, not a real review | 30 | auto:git:OPS_CHECKLIST.md | Claude |

## Apps Script deploy register (curated)

Git does **not** deploy `.gs` files — the copy running unattended is the one
pasted into the Sheet's Apps Script editor (CLAUDE.md). This table records,
per production `.gs` file, the last commit **confirmed** pasted live. The
script flags any commit to that file newer than the recorded sha as
**PENDING**, and any file with no baseline (`-`) as **UNCONFIRMED**.
`Tests_*.gs` and `RmHierarchy.private.gs` are not tracked here. If a time
trigger changed, the matching `setupXxx()` must also be re-run after the paste.

**Which project is live.** The Apps Script project named "Dashboard Google
Leads" **owned by Sakshi Sonawane** (shared with Snehil; script id
`1zeB_CeckbJnA1sc80eCUbCnY0g87Nlav7putMvbgehoUBuiJwwkCF36C`, open it at
`https://script.google.com/home/projects/<id>/edit`). Identified 2026-09-25 by
content — its files match the 09-24 deploy — not from its trigger list. Two
identically named projects under Snehil's own account (ids starting `1dyTKj…`
and `1PHcBS…`, both last modified 09-12) hold byte-identical **old** copies (e.g.
`OvernightEmailer.gs` from before 09-24) and are **not** live: pasting into
either does nothing.

**Reading what is live (no pasting, no guessing).** Open the live project in
Chrome, then run this in the page and read `window.__h`:

```js
(async()=>{const x=b=>[...new Uint8Array(b)].map(v=>v.toString(16).padStart(2,'0')).join('');const o=[];let i=0;for(const m of monaco.editor.getModels()){i++;const t=m.getValue().replace(/\r\n/g,'\n').replace(/\n+$/,'');o.push(i+':'+m.getValueLength()+':'+x(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(t))).slice(0,16));}window.__h=o.join(' ');})();
```

Then `python3 test/match-live-gs.py "<that string>" --apply` matches every file
against every historical local version and rewrites the rows below (only
hashes leave the browser, never source). Do this at each sweep instead of
trusting anyone's memory of what was pasted. After a paste, re-run it to
confirm the paste took.

| File | Confirmed-live sha | Confirmed on | Basis |
|---|---|---|---|
| `AllIssuesEmailer.gs` | `6a69364` | 2026-09-25 | read directly from the live editor by hash-match (2026-09-25) |
| `Core.gs` | `55bf870` | 2026-09-25 | read directly from the live editor by hash-match (2026-09-25) |
| `DailyRmIssueLog.gs` | `3a19bdb` | 2026-09-25 | read directly from the live editor by hash-match (2026-09-25) |
| `EmailInfra.gs` | `8fe9714` | 2026-09-25 | read directly from the live editor by hash-match (2026-09-25) |
| `FollowupEngine.gs` | `152f22f` | 2026-09-25 | read directly from the live editor by hash-match (2026-09-25) |
| `InteractionHistoryLogger.gs` | `42a896c` | 2026-09-25 | read directly from the live editor by hash-match (2026-09-25) |
| `LeadFollowupsStaleness.gs` | `6e4c904` | 2026-09-25 | read directly from the live editor by hash-match (2026-09-25) |
| `MovementTracker.gs` | `55bf870` | 2026-09-25 | read directly from the live editor by hash-match (2026-09-25); the file's raw NUL byte became a space when pasted - live differs from repo by that one character |
| `OpsChecklistRunner.gs` | `daba775` | 2026-09-25 | read directly from the live editor by hash-match (2026-09-25) |
| `OvernightEmailer.gs` | `e119115` | 2026-09-25 | read directly from the live editor by hash-match (2026-09-25) |
| `RmHierarchy.gs` | `187450a` | 2026-09-25 | read directly from the live editor by hash-match (2026-09-25) |
| `SlaEngine.gs` | `efc6137` | 2026-09-25 | read directly from the live editor by hash-match (2026-09-25) |
| `UnmatchedCommentLogger.gs` | `553831b` | 2026-09-25 | read directly from the live editor by hash-match (2026-09-25) |

### Known live-vs-repo differences (open until fixed)

- **`MovementTracker.gs` — raw NUL byte becomes a space when pasted.** Line
  166 of the repo file joins the content-hash fields with a raw NUL byte
  (`parts.join('<NUL>')`); the editor turns it into a space. The browser side
  (`js/sheets-writeback.js` `leadContentHash`) joins with `'\0'`. So live Apps
  Script and the browser compute **different** `content_hash` values for the
  same lead, and each runtime sees the other's latest row as "changed" — a
  probable source of extra Movement_Log rows. Fix is one line (write the
  separator as an escape, `'\0'`), but deploying it makes every stored
  hash stale once, so the next capture appends a row for every open lead —
  decide when to do that with the workbook's 10M-cell headroom in mind
  (three ceiling crashes so far, the latest fixed 2026-09-25). Detector H in
  `check-staleness.py` flags any raw control character in a `.gs` file.

## Adding to the checks

- A stated fact went stale (a count, an order, a date in CLAUDE.md /
  HANDOVER.md)? Add a row to `FACT_CLAIMS` in `test/check-staleness.py` so
  it can never go stale silently again.
- A new time-based chore appears? Add a row to the watch register above.
- A new production `.gs` file? The report flags it as `NO-ROW` until it has
  a deploy-register row (alongside the three registrations CLAUDE.md lists).

## Sweep log

One line per sweep: date — what was found — what was fixed / left open.

- 2026-09-25 — tracker + `check-staleness.py` created (first run). **Fixed:** 93
  drifted `#Lnn` anchors across 7 records (GS-002, GS-008, JS-003, JS-009,
  JS-012, JS-018, JS-021 — many caused by earlier edits that bumped `Last
  Verified` without re-anchoring; `sheets-writeback.js` had drifted +21 lines
  since 09-10); the "position 15 of 23" claim in CLAUDE.md and HANDOVER.md
  (now 16 of 24, registered in `FACT_CLAIMS`); 3 stale memory entries (a wrong
  "no Python" note, a finished CI task, a finished Phase-4 handoff).
  Then read the live editor directly from Chrome and replaced every ASSUMED
  deploy-register baseline with evidence: the earlier "Core.gs / MovementTracker.gs
  / EmailInfra.gs undeployed" assumption was **wrong** — all three are live at
  HEAD (Core, EmailInfra exactly; MovementTracker with the NUL→space
  difference above). **Left open:** PENDING paste — `FollowupEngine.gs` (Do-Not-Disturb
  fix `cba3a82`, 09-04), `UnmatchedCommentLogger.gs` (de-dup fix `cc7910b`, 09-03 — the
  HANDOVER §8 Date-vs-string bug is still live) and `DailyRmIssueLog.gs`
  (`26bf0cf`, 09-25, a peer session's ceiling-crash fix); the NUL finding above;
  live check of the Opp Monitor "Live" figures still needs a signed-in browser.

## Current status

<!-- AUTO:BEGIN -->

_Generated by `python3 test/check-staleness.py --write` -- do not edit by hand._

**HEAD `717617b`, 2026-09-25 IST -- STALE 4 | OVERDUE records 0 | AT-RISK 9**

```text
A. Line anchors: 440 checked, 439 ok, 0 DRIFTED (40 anchors not machine-checkable: prose / multi-name cells)

B. Records: 0 DRIFTED (source moved since Last Verified), 0 OVERDUE (> TTL), 6 DUE-SOON (<= 10d)
   AT-RISK  TAB-004 (js/tab-repeat-offenders.js) goes overdue in 6d (verified 2026-09-17, TTL 14d) [hot]
   AT-RISK  DASH-001 (dashboard.html) goes overdue in 10d (verified 2026-09-21, TTL 14d) [hot]
   AT-RISK  GS-002 (Core.gs) goes overdue in 10d (verified 2026-09-21, TTL 14d) [hot]
   AT-RISK  GS-008 (MovementTracker.gs) goes overdue in 10d (verified 2026-09-21, TTL 14d) [hot]
   AT-RISK  JS-025 (js/tab-oppmonitor.js) goes overdue in 10d (verified 2026-09-21, TTL 14d) [hot]
   AT-RISK  TAB-009 (dashboard.html) goes overdue in 10d (verified 2026-09-21, TTL 14d) [hot]

C. Stated facts: 0 STALE (of 4 registered claims)

D. Apps Script deploy register (git does NOT deploy -- see CLAUDE.md):
   ok       AllIssuesEmailer.gs              OK matches confirmed-live 6a69364 (2026-09-25)
   ok       Core.gs                          OK matches confirmed-live 55bf870 (2026-09-25)
   STALE    DailyRmIssueLog.gs               PENDING 1 commit(s) since confirmed-live 3a19bdb; newest: 26bf0cf 2026-09-25 Fix: captureDailyRmIssues_ prunes Movement_Log up front (3rd 10M-cell c
   ok       EmailInfra.gs                    OK matches confirmed-live 8fe9714 (2026-09-25)
   STALE    FollowupEngine.gs                PENDING 1 commit(s) since confirmed-live 152f22f; newest: cba3a82 2026-09-04 Do Not Disturb follow-up: verify via cross-call before stopping outreac
   ok       InteractionHistoryLogger.gs      OK matches confirmed-live 42a896c (2026-09-25)
   ok       LeadFollowupsStaleness.gs        OK matches confirmed-live 6e4c904 (2026-09-25)
   ok       MovementTracker.gs               OK matches confirmed-live 55bf870 (2026-09-25)
   ok       OpsChecklistRunner.gs            OK matches confirmed-live daba775 (2026-09-25)
   ok       OvernightEmailer.gs              OK matches confirmed-live e119115 (2026-09-25)
   ok       RmHierarchy.gs                   OK matches confirmed-live 187450a (2026-09-25)
   ok       SlaEngine.gs                     OK matches confirmed-live efc6137 (2026-09-25)
   STALE    UnmatchedCommentLogger.gs        PENDING 1 commit(s) since confirmed-live 553831b; newest: cc7910b 2026-09-03 Fix Unmatched_Comments_Log de-dup: comment_at read back as Date, not st

E. Watch register:
   AT-RISK  Deploy register refreshed from the live editor -- last 2026-09-25, due 2026-10-05 (+10d)
   ok       RM_HIERARCHY_RAW_ vs the HR Live roster export -- last 2026-09-22, due 2026-10-06 (+11d)
   AT-RISK  `leads` tab header vs `HEADER_ALIASES` / `HEADER_ALIASES_` -- last 2026-09-22, due 2026-10-02 (+7d)
   ok       HANDOVER.md section 8 incident list + section dates -- last 2026-09-25, due 2026-10-25 (+30d)
   AT-RISK  Weekly doc spot-check cloud routine still firing -- last 2026-09-22, due 2026-09-30 (+5d)
   ok       Claude memory index vs reality -- last 2026-09-25, due 2026-10-25 (+30d)
   ok       OPS_CHECKLIST.md open items -- last 2026-09-24, due 2026-10-24 (+29d)

F. Uncommitted code changes with no matching record edit: 0

G. HANDOVER.md: last changed 26bf0cf (2026-09-25); 0 code commit(s) and 0d since -> OK

H. Raw control characters in .gs sources: 1
   STALE  MovementTracker.gs line 166 holds a raw U+0000 -- the editor changes it on paste; write it as an escape
```

<!-- AUTO:END -->
