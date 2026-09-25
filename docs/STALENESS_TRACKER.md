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
**PENDING**, and any file with no baseline (`-`) as **UNCONFIRMED**. When Snehil
says a file is pasted (or a session pastes and verifies it), set that row's sha
to the commit it matched and today's date. `Tests_*.gs` and
`RmHierarchy.private.gs` are not tracked here. If a time trigger changed, the
matching `setupXxx()` must also be re-run after the paste.

| File | Confirmed-live sha | Confirmed on | Basis |
|---|---|---|---|
| `AllIssuesEmailer.gs` | `68680ec` | 2026-09-24 | pasted + verified byte-for-byte (two-checkpoint Step 10/11; see `GS-010` Version / change reference) |
| `Core.gs` | `2943ec9` | 2026-09-22 | ASSUMED: last paste predates the `opp_at` change (`55bf870`); no evidence it was pasted since |
| `DailyRmIssueLog.gs` | `-` | | no deploy evidence recorded |
| `EmailInfra.gs` | `68680ec` | 2026-09-24 | ASSUMED live as of the 09-24 deploy pass; the CH-backstop CC fix (`8fe9714`) came after and has no paste evidence |
| `FollowupEngine.gs` | `-` | | no deploy evidence recorded |
| `InteractionHistoryLogger.gs` | `-` | | no deploy evidence recorded |
| `LeadFollowupsStaleness.gs` | `-` | | no deploy evidence recorded |
| `MovementTracker.gs` | `2943ec9` | 2026-09-22 | ASSUMED: last paste predates the `opp_at` change (`55bf870`); browser side is already live with `opp_at`, so the two runtimes hash Movement_Log rows differently until this is pasted |
| `OpsChecklistRunner.gs` | `-` | | no deploy evidence recorded |
| `OvernightEmailer.gs` | `68680ec` | 2026-09-24 | pasted + verified byte-for-byte (Step 10/11) |
| `RmHierarchy.gs` | `-` | | no deploy evidence recorded (last commit 2026-09-22) |
| `SlaEngine.gs` | `68680ec` | 2026-09-24 | pasted + verified byte-for-byte (Step 10/11) |
| `UnmatchedCommentLogger.gs` | `-` | | no deploy evidence recorded |

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
  **Left open:** `Core.gs`, `MovementTracker.gs` (the `opp_at` change, 09-22) and
  `EmailInfra.gs` (CH-backstop CC fix, 09-24) are PENDING paste into the live
  editor; 7 other `.gs` files have no deploy baseline; live check of the Opp
  Monitor "Live" figures still needs a signed-in browser.

## Current status

<!-- AUTO:BEGIN -->

_Generated by `python3 test/check-staleness.py --write` -- do not edit by hand._

**HEAD `887830a`, 2026-09-25 IST -- STALE 3 | OVERDUE records 0 | AT-RISK 15**

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
   ok       AllIssuesEmailer.gs              OK matches confirmed-live 68680ec (2026-09-24)
   STALE    Core.gs                          PENDING 1 commit(s) since confirmed-live 2943ec9; newest: 55bf870 2026-09-22 Wire opp_at through both runtimes; Opp Monitor computes live Opp% from 
   AT-RISK  DailyRmIssueLog.gs               UNCONFIRMED no confirmed-live baseline; last changed 2026-09-21 3a19bdb
   STALE    EmailInfra.gs                    PENDING 1 commit(s) since confirmed-live 68680ec; newest: 8fe9714 2026-09-24 Fix: CH-level backstop email no longer CCs leadership
   AT-RISK  FollowupEngine.gs                UNCONFIRMED no confirmed-live baseline; last changed 2026-09-04 cba3a82
   AT-RISK  InteractionHistoryLogger.gs      UNCONFIRMED no confirmed-live baseline; last changed 2026-09-05 42a896c
   AT-RISK  LeadFollowupsStaleness.gs        UNCONFIRMED no confirmed-live baseline; last changed 2026-09-09 6e4c904
   STALE    MovementTracker.gs               PENDING 1 commit(s) since confirmed-live 2943ec9; newest: 55bf870 2026-09-22 Wire opp_at through both runtimes; Opp Monitor computes live Opp% from 
   AT-RISK  OpsChecklistRunner.gs            UNCONFIRMED no confirmed-live baseline; last changed 2026-09-09 daba775
   ok       OvernightEmailer.gs              OK matches confirmed-live 68680ec (2026-09-24)
   AT-RISK  RmHierarchy.gs                   UNCONFIRMED no confirmed-live baseline; last changed 2026-09-22 187450a
   ok       SlaEngine.gs                     OK matches confirmed-live 68680ec (2026-09-24)
   AT-RISK  UnmatchedCommentLogger.gs        UNCONFIRMED no confirmed-live baseline; last changed 2026-09-03 cc7910b

E. Watch register:
   ok       RM_HIERARCHY_RAW_ vs the HR Live roster export -- last 2026-09-22, due 2026-10-06 (+11d)
   AT-RISK  `leads` tab header vs `HEADER_ALIASES` / `HEADER_ALIASES_` -- last 2026-09-22, due 2026-10-02 (+7d)
   ok       HANDOVER.md section 8 incident list + section dates -- last 2026-09-24, due 2026-10-24 (+29d)
   AT-RISK  Weekly doc spot-check cloud routine still firing -- last 2026-09-22, due 2026-09-30 (+5d)
   ok       Claude memory index vs reality -- last 2026-09-25, due 2026-10-25 (+30d)
   ok       OPS_CHECKLIST.md open items -- last 2026-09-24, due 2026-10-24 (+29d)

F. Uncommitted code changes with no matching record edit: 0

G. HANDOVER.md: last changed 887830a (2026-09-24); 0 code commit(s) and 1d since -> OK
```

<!-- AUTO:END -->
