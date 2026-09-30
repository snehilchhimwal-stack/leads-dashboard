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
| Movement_Log dedup health | `Movement_Log_Runs`: `leads_changed` must be a small fraction of `lead_count_seen`; ~100% on consecutive runs means dedup is broken (2026-09-22 to 09-25: ~52k junk rows). Also confirm the `Movement_Log` header ends `opp_at, content_hash`. Method + query in `OPS_CHECKLIST.md` Tier 3 | 7 | 2026-09-25 | Claude |
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
| `AllIssuesEmailer.gs` | `5aafbd4` | 2026-09-30 | read directly from the live editor by hash-match (2026-09-30) |
| `Core.gs` | `c9c0b66` | 2026-09-30 | read directly from the live editor by hash-match (2026-09-30) |
| `DailyRmIssueLog.gs` | `26bf0cf` | 2026-09-29 | read directly from the live editor by hash-match (2026-09-29) |
| `EmailInfra.gs` | `a1a21b4` | 2026-09-30 | read directly from the live editor by hash-match (2026-09-30) |
| `FollowupEngine.gs` | `cba3a82` | 2026-09-30 | read directly from the live editor by hash-match (2026-09-30) |
| `InteractionHistoryLogger.gs` | `c9c0b66` | 2026-09-29 | read directly from the live editor by hash-match (2026-09-29) |
| `LeadFollowupsStaleness.gs` | `6e4c904` | 2026-09-29 | read directly from the live editor by hash-match (2026-09-29) |
| `MovementTracker.gs` | `c9c0b66` | 2026-09-30 | read directly from the live editor by hash-match (2026-09-30) |
| `OpsChecklistRunner.gs` | `4c99f7f` | 2026-09-29 | read directly from the live editor by hash-match (2026-09-29) |
| `OvernightEmailer.gs` | `87114a3` | 2026-09-30 | read directly from the live editor by hash-match (2026-09-30) |
| `RmHierarchy.gs` | `2af4b48` | 2026-09-30 | read directly from the live editor by hash-match (2026-09-30) |
| `SlaEngine.gs` | `87114a3` | 2026-09-30 | read directly from the live editor by hash-match (2026-09-30) |
| `UnmatchedCommentLogger.gs` | `c9c0b66` | 2026-09-29 | read directly from the live editor by hash-match (2026-09-29) |

### Known live-vs-repo differences

None open. (Resolved 2026-09-25: the raw NUL hash separator in `MovementTracker.gs` — now the escape `'\u0000'`, hashed identically in both runtimes and pinned by a shared known-answer vector — and the `Movement_Log` header misalignment described in `GS-008` `EXC-100`. Detector H in `check-staleness.py` keeps flagging raw control characters in any `.gs`.)

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

- 2026-09-25 (later) — pasted `FollowupEngine.gs` (`cba3a82`) and
  `UnmatchedCommentLogger.gs` (`cc7910b`) into the live project on Snehil's
  instruction: fetched each from GitHub at its commit inside the editor page,
  hash-checked against the local file before writing, applied, saved, then
  reloaded and re-read all 29 files — both persisted, the other 27 unchanged.
  `DailyRmIssueLog.gs` (`26bf0cf`) turned out to have been pasted by someone else
  minutes earlier (hash equals HEAD), so it was left alone. No trigger
  changes in any of the three, so no `setupXxx()` re-run. All 13 production
  `.gs` files now match HEAD; **still open:** the `MovementTracker.gs` NUL
  separator (needs a decision on timing) and the `Tests_*.gs` copies in the
  live editor, several of which are older than the repo's.

- 2026-09-25 (evening pass) — **Movement_Log dedup incident + NUL separator.** Reading `Movement_Log_Runs` showed `leads_changed == lead_count_seen` on every run from 09-22 12:44: my `opp_at` change made the header self-heal append `opp_at` after `content_hash`, one column off from the writers, so dedup read the wrong column (~52k junk rows in two days). Repaired the live header by hand (two cells), fixed the self-heal (insert before `content_hash`), added `assertMovementLogHeaderAligned_`, replaced the raw-NUL separator with `'\u0000'`, added regression tests (mutation-checked) and a shared hash vector in both runtimes, and pasted `MovementTracker.gs` (`797302d`) into the live project (hash-verified after reload). **Left open:** every `snapshotPeriodic` since 09-23 12:44 failed or timed out (Executions list), most likely the workbook cell ceiling; the junk rows from 09-22 12:44 to 09-23 12:45 stay until retention removes them (~09-29/30) unless archived and deleted on Snehil's decision; the first capture after this deploy re-appends every open lead once (hash definition changed) and the one after that should append only real changes — verify in `Movement_Log_Runs`.

- 2026-09-25 (16:28 IST) — **junk-row cleanup done.** After the fix was live the 12:44 capture **succeeded** (180 s; `leads_changed` = 12,648 = every open lead, the expected one-time re-append from the hash change; `Movement_Log` 78,050 → 90,698). Then `removeDedupIncidentRowsNow` (new one-off, `GS-008` FN-285; tested; every guard held) archived the 52,060 junk rows of 09-22 12:44 → 09-23 12:45 to a Drive CSV (folder `Leads Dashboard Archive/Movement_Log`, listed in `archive_log.csv`), verified the archive, and deleted them: `Movement_Log` is now 38,638 data rows, header still `…opp_at, content_hash`. **Still to verify:** the ~18:51 IST capture should show `leads_changed` far below `lead_count_seen` (dedup working); ~100% again means the fix failed. **Also noticed, not investigated:** `sendOvernightFollowupEmails` FAILED at 13:01 IST (142 s) — unrelated to this work.

- 2026-09-26 — **dedup identity fixed.** After the 09-25 fixes captures succeeded (09-25 18:51 / 09-26 00:18 / 06:08 appended 8,631 / 6,154 / 5,473 of ~13k) but 44-62% is still far too many: keyed by `client_id`, a customer's several rows could match only one stored hash. In the last batch ~2,000 of 5,473 rows were identical to their previous row, and `lead_id|RM` was unique across all of them. Both runtimes now key by `lead_id|RM` (`_dedupKeyGs_` / `movementDedupKey`, shared test literals); no migration, no burst expected. **Deployed 2026-09-26 ~13:45 IST:** `MovementTracker.gs` (`29b7146`) pasted and re-read after a reload (hash matches); the browser side is live on Pages (`movementDedupKey` served in `tab-movement.js` and `sheets-writeback.js`). **Verify** after the next capture: `leads_changed` should fall well below ~35% of `lead_count_seen`. Also cleaned up: raw NULs my own doc edits had written into this file, `GS-008` and `HANDOVER.md` (detector H now scans `.md` files too). **Open, minor:** a lead with a blank RM or region hashes `Unassigned` in the browser but blank in Apps Script, so the two writers disagree on those rows.

- 2026-09-28 — **cell-budget diagnostic + Monday alert built and deployed** (`Core.gs`/`OpsChecklistRunner.gs`, commit 4c99f7f/543e267), live and re-verified after a reload. First real run: **workbook at 98.2% (9,822,618 / 10,000,000 cells) — CRITICAL.** Found immediately: a leftover `Movement_Log_backup_2026-09-17_1115` tab alone holds 2,860,000 cells (29% of the entire budget) — flagged to Snehil, not deleted (destructive, unclear ownership). Also found: `Comment_History` (1,048,164 cells) and `Unmatched_Comments_Log` (383,058 cells) have no retention at all by original design (`InteractionHistoryLogger.gs`'s own docblock argued they'd stay a small fraction of Movement_Log's volume — no longer true at current scale) — flagged, not changed. Two small unrecognized tabs (`Opp_Conversion_Tracking`, `Debug_NoIssueLeads`, 26,000 cells each) also surfaced, likely scratch/leftover.

- 2026-09-28 (later same day) — **stale backup tab removed, real Drive file-size ceiling hit and fixed along the way.** Snehil authorized deleting `Movement_Log_backup_2026-09-17_1115` specifically (confirmed via git archaeology: created same-day by a bug in `9413f6a`, fixed same-day by `834d7ea` — a leftover artifact, not a real backup), while explicitly leaving the actual Movement_Log backup mechanism untouched and holding `Opp_Conversion_Tracking` for further review (it checked out clean — zero code references anywhere in the repo or live project, genuinely empty — still awaiting explicit go-ahead to delete). Built `removeStaleMovementLogBackupTabNow()` (guarded: header-shape check, archive-then-verify-count-then-delete, re-run-safe) with full test coverage. **First live run failed for real**: `archiveRowsToDriveCsv_` (the shared archive helper every prune function uses) had never been exercised at this tab's actual scale (109,999 rows) and hit Drive's file-size ceiling on the single-CSV write — caught by the guard before any deletion happened, nothing lost. Fixed by chunking the archive into 5,000-row pieces at the call site (`d98efbb`), added a regression test for the chunking itself (mutation-checked), redeployed `MovementTracker.gs` to the live editor and hash-verified after reload (`311afc5f96fa5648`). Re-ran `removeStaleMovementLogBackupTabNow()` live: succeeded in 35s, archived all 109,999 rows to 22 Drive CSVs (`…superseded_backup_part1`…`part22`, first at `https://drive.google.com/file/d/1XBPwuyTk-TiMo2UsSpK8pDQDmHE-anAZ/view`), then deleted the tab. **Verified via `reportWorkbookCellUsageNow()`: workbook cell usage dropped from 98.2% to 69.6% (6,962,618 / 10,000,000)** — `Movement_Log` (the real, current, untouched tab) is now the largest at 2,016,924 cells. One real near-miss during the run: the first attempt actually executed `pruneMovementLogNow` instead (a stray Escape keypress reverted the Apps Script function-picker's pending selection) — harmless (a normal, already-scheduled prune of the live Movement_Log, not the backup), caught immediately by checking the Executions list rather than trusting the in-editor panel's generic "Execution completed" text, and the correct function was re-selected and re-verified by screenshot before running again.

- 2026-09-29 — **the two remaining flagged tabs resolved.** `Opp_Conversion_Tracking` (`Core.gs`'s new `removeOppConversionTrackingTabNow()`, guarded to refuse if it ever finds real data) deleted after Snehil's explicit go-ahead — confirmed empty, zero references, removed cleanly. For `Comment_History`/`Unmatched_Comments_Log`, an initial "prune old rows" request got a clarifying pass first: both tabs turned out to have **real, prior, deliberate design decisions on record** (`InteractionHistoryLogger.gs`'s own "NO AUTOMATIC PRUNING" docblock, `docs/_planning/DB_ARCHITECTURE_REVIEW.md`'s "unbounded by explicit design" / "manually curated" classification, and `Unmatched_Comments_Log`'s pre-existing human-gated `clearReviewedUnmatchedCommentsNow()`) — surfaced to Snehil before building anything, since an automatic prune would have reversed those on the spot. Snehil confirmed: 30-day retention for both, age-based for `Unmatched_Comments_Log` **independent of `reviewed`** (an explicit tradeoff — an unreviewed comment can now age out). Built `pruneCommentHistory_`/`pruneUnmatchedCommentsLog_`, following `pruneMovementLog_`'s crash-safety ordering and the chunked-archive lesson from the day before; caught and fixed a real ordering bug pre-commit (a first draft used clear-then-write despite the doc comment already claiming the safer order). Both wired into `snapshotOpenLeads_`'s existing trigger, deployed live, hash-verified, and run for real: both came back a clean no-op (neither tab has data older than 30 days yet — both started in late Aug/early Sep 2026), confirming the code path works without erroring. Final live cell usage: 69.4% (6,943,430 / 10,000,000), consistent with the prior day's reading. Deploy register refreshed (`c9c0b66` confirmed live for `Core.gs`/`MovementTracker.gs`/`InteractionHistoryLogger.gs`/`UnmatchedCommentLogger.gs`) — 12 `Tests_*.gs` files remain behind their newest commit, pre-existing drift, not part of this change.

## Current status

<!-- AUTO:BEGIN -->

_Generated by `python3 test/check-staleness.py --write` -- do not edit by hand._

**HEAD `881577f`, 2026-09-29 IST -- STALE 35 | OVERDUE records 0 | AT-RISK 10**

```text
A. Line anchors: 471 checked, 435 ok, 35 DRIFTED (41 anchors not machine-checkable: prose / multi-name cells)
   STALE  GS-002 FN-185: `businessMinutesBetweenGs_` cites #L194, real line 216
   STALE  GS-002 FN-186: `esc_` cites #L214, real line 236
   STALE  GS-002 FN-301: `computeWorkbookCellUsageGs_` cites #L328, real line 350
   STALE  GS-002 FN-302: `fmtCellsGs_` cites #L341, real line 363
   STALE  GS-002 FN-303: `reportWorkbookCellUsageNow` cites #L348, real line 370
   STALE  GS-002 FN-305: `removeOppConversionTrackingTabNow` cites #L372, real line 394
   STALE  GS-006 FN-212: `logInteractionHistoryGs_` cites #L109, real line 116
   STALE  GS-006 FN-213: `commentHistoryDedupKeyGs_` cites #L98, real line 105
   STALE  GS-006 FN-214: `ensureCommentHistorySheet_` cites #L80, real line 87
   STALE  GS-006 FN-215: `logInteractionHistoryNow` cites #L172, real line 179
   STALE  GS-008 FN-219: `snapshotPeriodic` cites #L1157, real line 1174
   STALE  GS-008 FN-219: `snapshotNow` cites #L1203, real line 1220
   STALE  GS-008 FN-219: `setupMovementTracking` cites #L1162, real line 1179
   STALE  GS-008 FN-220: `pruneMovementLog_` cites #L687, real line 704
   STALE  GS-008 FN-220: `pruneMovementLogNow` cites #L759, real line 776
   STALE  GS-008 FN-223: `eligibleDailyCohortDatesGs_` cites #L907, real line 924
   STALE  GS-008 FN-223: `computeDailyCohortByRegionGs_` cites #L964, real line 981
   STALE  GS-008 FN-223: `upsertDailyCohortHistoryRowsGs_` cites #L1038, real line 1055
   STALE  GS-008 FN-223: `_readArchivedDailyCohortDatesGs_` cites #L1087, real line 1104
   STALE  GS-008 FN-223: `persistDailyCohortHistoryGs_` cites #L1101, real line 1118
   STALE  GS-008 FN-224: `_readMovementLogHistoryRowsGs_` cites #L840, real line 857
   STALE  GS-008 FN-285: `removeDedupIncidentRowsNow` cites #L1358, real line 1375
   STALE  GS-008 FN-304: `removeStaleMovementLogBackupTabNow` cites #L1428, real line 1445
   STALE  GS-008 FN-225: `_effectiveRegionGs_` cites #L880, real line 897
   STALE  GS-008 FN-225: `_evidenceAtDeadlineGs_` cites #L890, real line 907
   ... +10 more (run --fix-anchors)

B. Records: 0 DRIFTED (source moved since Last Verified), 0 OVERDUE (> TTL), 5 DUE-SOON (<= 10d)
   AT-RISK  DASH-001 (dashboard.html) goes overdue in 6d (verified 2026-09-21, TTL 14d) [hot]
   AT-RISK  JS-025 (js/tab-oppmonitor.js) goes overdue in 6d (verified 2026-09-21, TTL 14d) [hot]
   AT-RISK  TAB-009 (dashboard.html) goes overdue in 6d (verified 2026-09-21, TTL 14d) [hot]
   AT-RISK  GS-011 (RmHierarchy.gs) goes overdue in 7d (verified 2026-09-22, TTL 14d) [hot]
   AT-RISK  GS-003 (DailyRmIssueLog.gs) goes overdue in 10d (verified 2026-09-25, TTL 14d) [hot]

C. Stated facts: 0 STALE (of 4 registered claims)

D. Apps Script deploy register (git does NOT deploy -- see CLAUDE.md):
   ok       AllIssuesEmailer.gs              OK matches confirmed-live 5aafbd4 (2026-09-29)
   ok       Core.gs                          OK matches confirmed-live c9c0b66 (2026-09-29)
   ok       DailyRmIssueLog.gs               OK matches confirmed-live 26bf0cf (2026-09-29)
   ok       EmailInfra.gs                    OK matches confirmed-live 5aafbd4 (2026-09-29)
   ok       FollowupEngine.gs                OK matches confirmed-live cba3a82 (2026-09-29)
   ok       InteractionHistoryLogger.gs      OK matches confirmed-live c9c0b66 (2026-09-29)
   ok       LeadFollowupsStaleness.gs        OK matches confirmed-live 6e4c904 (2026-09-29)
   ok       MovementTracker.gs               OK matches confirmed-live c9c0b66 (2026-09-29)
   ok       OpsChecklistRunner.gs            OK matches confirmed-live 4c99f7f (2026-09-29)
   ok       OvernightEmailer.gs              OK matches confirmed-live 87114a3 (2026-09-29)
   ok       RmHierarchy.gs                   OK matches confirmed-live 187450a (2026-09-29)
   ok       SlaEngine.gs                     OK matches confirmed-live 87114a3 (2026-09-29)
   ok       UnmatchedCommentLogger.gs        OK matches confirmed-live c9c0b66 (2026-09-29)

E. Watch register:
   AT-RISK  Deploy register refreshed from the live editor -- last 2026-09-29, due 2026-10-09 (+10d)
   AT-RISK  Movement_Log dedup health -- last 2026-09-25, due 2026-10-02 (+3d)
   AT-RISK  RM_HIERARCHY_RAW_ vs the HR Live roster export -- last 2026-09-22, due 2026-10-06 (+7d)
   AT-RISK  `leads` tab header vs `HEADER_ALIASES` / `HEADER_ALIASES_` -- last 2026-09-22, due 2026-10-02 (+3d)
   ok       HANDOVER.md section 8 incident list + section dates -- last 2026-09-29, due 2026-10-29 (+30d)
   AT-RISK  Weekly doc spot-check cloud routine still firing -- last 2026-09-29, due 2026-10-07 (+8d)
   ok       Claude memory index vs reality -- last 2026-09-25, due 2026-10-25 (+26d)
   ok       OPS_CHECKLIST.md open items -- last 2026-09-28, due 2026-10-28 (+29d)

F. Uncommitted code changes with no matching record edit: 0

G. HANDOVER.md: last changed c9c0b66 (2026-09-29); 0 code commit(s) and 0d since -> OK

H. Raw control characters in .gs sources and .md docs: 0
```

<!-- AUTO:END -->
