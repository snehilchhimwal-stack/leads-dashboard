# J — Review of `LOGIC_AUDIT.md` against current code

Reviewer scope: documentation-vs-code check of `LOGIC_AUDIT.md` (2,347 lines,
~194 KB) against HEAD `19038e7`. Read in full. Every claim below was checked by
grep/read of the current `.gs` / `js/*.js` files, by running
`python3 test/check-runtime-parity.py`, and by a one-off normalising diff of
`OUTCOME_RULES` vs `OUTCOME_RULES_GS_` (scratch script, not committed). No
existing file was edited and nothing was committed. Line numbers are HEAD
`19038e7`. No personal data is copied here.

---

## 1. What `LOGIC_AUDIT.md` is and how it is organised

- A **frozen, dated record** of a 7-part "system-wide logic and connection
  audit". Part 1 was committed 2026-09-05, Parts 2-7 on 2026-09-07 (final
  report `0d69729`). Its own header says it is "not maintained forward", and
  that `docs/INDEX.md` plus the component records and `HANDOVER.md` are the
  current picture. A code change is supposed to never edit this file.
- Structure:
  - **Part 1**: architecture and file map. A 19-layer table, the central
    sources of truth, a Mermaid architecture diagram, per-file tables
    (§4a-4d) and the trigger table (§5).
  - **Part 2**: data flow and user flows. A field-by-field trace, 3 Mermaid
    diagrams, and end-to-end flows (load, filter, snapshot, Generate, Gmail
    send, SLA_History).
  - **Part 3**: the business-logic rules (§3.1-3.9). SLA flags, comment
    classification, DND, follow-up suggestions, region normalisation, RM
    Performance, RM routing, the Generate mutex, and region-email rules.
  - **Part 4**: cross-runtime diffs (§4.1-4.10). This is where the HIGH
    Loan-region finding (§4.4) and the `MIN_CALLS_AFTER_48H` finding (§4.9)
    come from.
  - **Part 5**: KPIs, filter/search/sort/pagination, the state inventory and
    edge cases.
  - **Part 6**: re-checks a stale known-bug list (§6.1), adds new
    duplicate/dead-logic findings, hidden dependencies, a source-of-truth
    matrix and a system logic matrix.
  - **Part 7**: the assembled final report. Sections 1-22 are mostly pointers
    back into Parts 1-6. §18 ranks the findings (1 HIGH, 3 MEDIUM, 4 LOW),
    §19 recommends fixes, §20 is a verification checklist, §21 is the
    "if I change X" list, and §22 is the final assessment.

## 2. The business logic it describes (understanding aid)

- **Two runtimes share one Sheet.**
  - A static browser dashboard reads the `leads` tab with the Sheets API.
  - An Apps Script backend runs on clock triggers.
  - The two never call each other. They meet only through tabs:
    `Movement_Log`, `SLA_History`, `Lead_Followups`, the logs.
- **Collation.** Raw rows that share a `lead_id`, or a `client_id` with a
  similar region, are merged into one customer:
  - stage comes from the furthest-progressed copy;
  - the call counters are MAXed, not summed;
  - comments are merged and sorted.

  The merged customers form `allParsedLeads`. Filtering plus `enrichLead()`
  then produces `leads` (one row per customer) and `issueLeads` (one row per
  RM copy).
- **The 5 operational SLA rules** (plus the client-only retrospective
  `firstContactBreach`):
  - `inactiveRmNewLead`: assigned today to an inactive RM.
  - `isNotUpdated`: stage is still "not updated" past the 3 h grace, or the
    lead was never connected past the 10-minute window.
  - `followupOverdue`: connected, under 48 h old, and quiet for more than
    4 h.
  - `underCalledToday`: fewer than 5 attempts today.
  - `stageStuck48h`: open and past 48 h.

  `ISSUE_PRIORITY` picks one label per lead for single-label consumers. The
  rules are duplicated in `enrichLead` (browser) and `computeSlaFlags_`
  (Apps Script).
- **Comment classification.** 31 ordered, first-match-wins outcome rules
  with fuzzy typo tolerance. "Do Not Disturb" is checked first. The result
  drives the suggested follow-up text, which a human can override in
  `Lead_Followups` column F. Duplicated in `OUTCOME_RULES` and
  `OUTCOME_RULES_GS_`.
- **Region.** `effectiveRegion()` turns a lead into "Loan" when
  `project_region` or `group_source` says Loan. `mainRegionFor()` then maps
  it to one of 11 canonical regions.
- **RM Performance.** Per-RM, per-day, per-rule eligibility and violation
  are reconstructed from `Movement_Log`. Rates are shrunk with empirical
  Bayes and weighted by severity, then each RM gets a tier. Duplicated on
  both sides.
- **Scheduled emails.**
  - The Overnight email (10:00, with a 13:00 follow-up) and the All-Issues
    email (17:00) cover Google Non-UTM/Search leads only.
  - Recipients come from the RM hierarchy (`tl → tm → rh → ch`), one bucket
    per manager, with `Region_Recipients` as the legacy fallback.
- **The Generate cycle (browser).** Preliminary build → clear and push
  `Lead_Followups` → wait for a human suggestion → rebuild. An in-memory
  mutex (`_generateCycleOwner`) stops the two browser Generate flows from
  colliding.

## 3. Claim-by-claim status

Status key:
- **STILL TRUE**: the claim still holds.
- **FIXED**: the problem it describes has been resolved.
- **CHANGED**: the logic moved or now works differently.
- **N/A**: the code has been removed.
- **CNV**: cannot verify from here.

| Section / finding | Claim (one line) | Status | Evidence |
|---|---|---|---|
| Header | Frozen 2026-09-07 record, never edited by code changes | STILL TRUE (by convention) | file header; 40+ commits since to `reports-build.js`/`OvernightEmailer.gs`/`AllIssuesEmailer.gs` |
| P1 §0/§4a | 23 `js/*.js` files loaded by `dashboard.html` | CHANGED | 24 `<script src>` locals now, because `js/tab-oppmonitor.js` was added. `js/rm-performance-worker.js` exists but is a Worker, not a script tag. `dashboard.html` script list |
| P1 §4a | CLAUDE.md's load order is wrong (pairs swapped, `core-rm-performance` not in first 9) | FIXED (doc side) | CLAUDE.md now says 9 of 10 core files load first and `core-rm-performance.js` loads at position 16 of 24, matching `dashboard.html` |
| P1 §1 L19 / P7 §20 Testing / §22 | No persisted client-side test suite in CI | FIXED | `.github/workflows/test.yml:48-57`, a blocking `frontend-harness` job |
| P1 §1 L19 | 12 `Tests_*.gs` files | CHANGED | ~30 `Tests_*.gs` files now |
| P1 §1/§4d | 11 production `.gs` files | CHANGED | 21 production `.gs` files now. New ones: `CycleReport`, `DailyChecklist`, `EmailLedger`, `EmailReroute`, `EmailSweep`, `FollowupTracker`, `LeadFollowupsStaleness`, `OpsAudit`, `OpsChecklistRunner`, `RmHierarchySync`, `StaleLeads`. None of them is covered by the audit. |
| P1 §2 | `allParsedLeads`, `enrichLead`, `computeSlaFlags_`, `_currentSheetId`, `_generateCycleOwner` are the central hubs | STILL TRUE (line numbers drifted) | `js/tab-movement.js:102` (`_currentSheetId`), `js/sheets-writeback.js:296` (mutex) |
| P1 §2 / §4d | Backend `OUTCOME_RULES_GS_` has "~30 rules", fewer than the client | FIXED in the audit itself (P3 §3.2 / P4 §4.1); still matched | both have 31 `outcome:` entries; normalised full-body diff (arrow vs `function` syntax only) is identical; parity script ruleset pair passes |
| P1 §4b `core-ui` / P6 §6.1 #1 | `_logLeadRegistry` cleared every `renderAll()` | STILL TRUE | `js/overview-distribution-people-ops.js:164` |
| P1 §4c `reports-ui` / P2 §5 | `TEST_MODE_OVERRIDE_EMAIL` is a silent redirect footgun, currently `''` | STILL TRUE, now mitigated | `js/reports-ui.js:212,244`, `EmailInfra.gs:43`. Both are `''`. `check-runtime-parity.py` now asserts both stay `''` (prod-safety pair). There is still no UI indicator when it is set. |
| P1 §4c / P5 §5.3 | `_allReports` is a bare cross-file `let` | STILL TRUE | `js/reports-build.js:1262`; written at `js/reports-ui.js:469,521` |
| P1 §4c `sheets-writeback` / P6 §6.1 #2 | `_followupWaitCancelled` is a keyed `Map` | STILL TRUE | `js/sheets-writeback.js:753` |
| P1 §4c `tab-morning` | Morning Brief tab is live and gated by `_refreshMorningBriefOnNextRender` | CHANGED | tab hidden in commit `9efec5d` (2026-10-03) |
| P1 §4c `tab-repeat-offenders` | Region filter skips `effectiveRegion`'s `project_region` part | STILL TRUE (documented) | `js/core-rm-performance.js:266` comment |
| P1 §4d `MovementTracker` | Prune cutoff uses `Date.now() - 7 days`, not IST helpers | STILL TRUE (harmless) | `MovementTracker.gs:839` |
| P1 §4d / §5 | Overnight trigger installer has no `.inTimezone('Asia/Kolkata')` | STILL TRUE | `OvernightEmailer.gs:2298-2299`. Every newer installer (`EmailSweep.gs:279`, `OpsAudit.gs:333`) does set it. |
| P1 §4d `InteractionHistoryLogger` | `Comment_History` has no pruning | CNV in depth (not re-traced) | — |
| P1 §5 | Trigger table: 5 installers, ~7 triggers | CHANGED / incomplete | `newTrigger` now also appears in `EmailInfra.gs:1019` (hourly watchdog), `EmailSweep`, `CycleReport`, `OpsAudit`, `OpsChecklistRunner`, `RmHierarchySync`. Project memory records 19 live triggers. |
| P1 §4d `RmHierarchy` | Routing degrades to a fallback when the `.private.gs` file is absent | STILL TRUE (design) | the `.private.gs` file now exists locally (gitignored). Not inspected, by rule. |
| P2 §0/§1 | Field trace (`lead_id`, `client_id`, `RM`, region three-layer, MAX merge, earliest `lead_assigned_at`) | STILL TRUE in substance | `js/core-sheets-fetch.js:24` (`project_region`), `js/reports-build.js:80-84` |
| P2 §1 `call_attempts` | `underCalledToday` uses the day-over-day delta, or the comment-count proxy when there is no baseline | CHANGED | Since 2026-10-01 both sides use `MAX(delta, commentsLoggedToday)`. The baseline is now keyed by **lead_id**, not `client_id`. See `SlaEngine.gs:144-161`, `js/core-lead-model.js:386-400`. |
| P2 §4 / §5 snapshot flow | Manual snapshot appends every lead | CHANGED | A content-hash dedup now re-fetches `Movement_Log` and skips leads that are unchanged since the last capture (`js/sheets-writeback.js:830-880`). There is a new auto-snapshot-on-refresh path (`js/core-fetch-and-render.js:611`). |
| P3 §3.1 / P4 §4.2 | 7 thresholds equal on both sides (3/48/5/4/10/9/19) | STILL TRUE | `js/core-foundation.js:32-50`, `SlaEngine.gs:33-39` |
| P3 §3.1 / P4 §4.2 | The 5 flags agree rule for rule | STILL TRUE | `SlaEngine.gs:78,81,114,124,161` vs `js/core-lead-model.js:400,405,425,441,486` (the client also ANDs `isOpenLead`; the backend returns early when the lead is closed, so the result is the same) |
| P3 §3.1 / P6 §6.3 | `ISSUE_PRIORITY` order is identical | STILL TRUE | inactiveRm > NotUpdated > followupOverdue > underCalled > stuck48h on both sides |
| P3 §3.3 | DND is advisory text only, with no enforced cross-call verification | STILL TRUE (not re-traced end to end; `FOLLOWUP_SUGGESTIONS` parity passes) | parity script `FOLLOWUP_SUGGESTIONS` pair OK |
| P3 §3.5 / P4 §4.3 | `REGION_GROUP_MAP` matches `REGION_GROUP_MAP_` | STILL TRUE | parity script pair OK; `EmailInfra.gs:470-487` |
| P3 §3.6 | RM Performance constants are identical on both sides | STILL TRUE, broader | The parity script now checks 12 `RM_PERF_*` pairs, all OK. The algorithm body is still not diffed automatically, and part of it now runs in `js/rm-performance-worker.js`. |
| P3 §3.7 / P7 §18 LOW | `RmHierarchy.gs` is a single point of failure | STILL TRUE, mitigated | `RmHierarchySync.gs` (nightly sync), `EmailReroute.gs` (bounce re-route), `OpsAudit.gs` |
| P3 §3.8 / P7 §18 MEDIUM | Apps Script 10am/1pm can "clear/rewrite" `Lead_Followups` under a human | CHANGED / mis-described | The backend has been **upsert-only** since at least `e3c2413` (2026-08-28): it writes columns A-E, G and H, never F, and never clears (`OvernightEmailer.gs:1297-1314`). The real residual risk runs the other way; see §4 #2. |
| P3 §3.9 | Grace non-suppression in `reportableIssueFor` | STILL TRUE | `js/reports-build.js:653` |
| P3 §3.9 / P6 §6.2 / P7 §18 LOW | "Possible Premature Closes" has no `.gs` equivalent | STILL TRUE | `js/reports-build.js:809-853`; no `premature` logic in any production `.gs` |
| P3 §3.9 | The Google Non-UTM/Search scope is backend-only | STILL TRUE | `EmailInfra.gs:497-502`; no equivalent in `js/reports-build.js` |
| **P4 §4.4 / P6 §6.4 / P7 §18 HIGH** | Loan override is missing at all 3 scheduled-email call sites, and `HEADER_ALIASES_` has no `project_region` | **STILL TRUE (code); impact narrower than stated** | The raw region is still passed at `OvernightEmailer.gs:1029-1030` (`sendOvernightMorningEmails_`), `AllIssuesEmailer.gs:253-254` (`sendAllIssuesEmails_`) and `OvernightEmailer.gs:2346-2347` (now inside the manual `downloadNoIssueLeadsNow`, not a scheduled path). `Core.gs` still has no `project_region` alias (parity script: "only in js: lead_closing_comment, project_region"). Git `-S project_region` on `.gs` shows only `22962ec` (cohort persistence), not a fix. The impact is narrower for two reasons: (a) both emails gate on `group_source==='google'` first, so the `group_source==='loan'` branch can never apply, and only `project_region==='Loan'` leads are affected; (b) recipients are resolved **per RM** (`resolveRecipientEmailsForRegion_` → `resolveRecipientBucketsForRms_`, `EmailInfra.gs:1170-1179`), and since 2026-10-03 loan-team RMs are forced to the loan CH (`RmHierarchy.gs:1109-1122,1302`). The "wrong recipient" scenario is therefore mostly mitigated. What remains is the wrong region grouping, the wrong legacy fallback, and silent drops (see §4 #1). |
| P4 §4.5 | The reduced Movement_Log Loan override is symmetric and documented | STILL TRUE | `MovementTracker.gs:1057-1066`, `js/core-rm-performance.js:266` |
| P4 §4.6 | IST helpers differ in mechanism but are equivalent | STILL TRUE | `js/core-foundation.js:170`, `Core.gs:182` |
| P4 §4.7 | Movement_Log schema is identical across the two writers | STILL TRUE, extended | Both added `opp_at` (2026-09-21) and a trailing `content_hash` (`MovementTracker.gs:105-139`, `js/tab-movement.js:78-100`) |
| P4 §4.8 / P6 §6.2 | `HEADER_ALIASES` differs only by `project_region` and `lead_closing_comment` | STILL TRUE | parity script output (the only mismatch); CLAUDE.md records it as an accepted difference |
| **P4 §4.9 / P7 §18 MEDIUM** | `MIN_CALLS_AFTER_48H=10` is display-only; the flag uses 5 | **STILL TRUE** | `js/core-foundation.js:33`; display at `js/overview-distribution-people-ops.js:1148,1180,1222`; flag at `js/core-lead-model.js:400`. The table header tooltip at `:884/:928` now says "fewer than 5 calls … any lead age", which contradicts the cards. |
| P5 §5.1 / P7 §18 LOW | KPI strip has 6 tiles mixing customer-level and issue-level counts | CHANGED (largely resolved) | Opportunity+ and Median 1st Contact tiles removed in `9efec5d`. The 2 issue tiles now show distinct customers (`countUniqueAndCloned(...).unique`, `js/core-collation.js:115-119`) plus a "(N cloned)" suffix (`js/overview-distribution-people-ops.js:196-233`). A stale comment at `:180-182` still says "counts as two". |
| P5 §5.2 | No lead search, no user sort, no pagination; `MAX_CARDS=200` | STILL TRUE | `js/core-ui.js:71` |
| **P5 §5.4 / P7 §18 MEDIUM** | Snapshot Now has no reentrancy guard | **STILL TRUE, partly mitigated** | `js/tab-movement.js:1397` calls `browserSnapshotOpenLeads()` with no disable/flag. The content-hash dedup only helps once the first write has landed. |
| P5 §5.4 / P7 §18 LOW | `_isApplyingFilters` drops a second apply instead of queueing it | STILL TRUE | `js/core-filters.js:11,39-48` |
| P5 §5.4 | 6 distinct fetch error messages, `ACCESS_DENIED`/`NOT_FOUND` | STILL TRUE | `js/core-fetch-and-render.js:77-78,669` |
| P6 §6.1 #3-#7 | Stale UI-redesign bug list (bulk OAuth resume, `.log-toggle`, `.ms-panel`, `NOT_SHARED`, `clearLeadFollowupsTab` comment) does not reproduce | STILL TRUE | `js/reports-gmail.js:178`; one `.ms-panel{`; no `NOT_SHARED` identifier |
| P6 §6.4 | No app-level permission system | STILL TRUE (not re-traced) | — |
| P6 §6.5 / P2 | `Daily_RM_Issues` not read programmatically by the dashboard | STILL TRUE | `js/core-fetch-and-render.js:635-638`, `js/core-rm-performance.js:821` |
| P7 §19 #6 | Update CLAUDE.md's load order | FIXED | see the P1 §4a row |
| P7 §20 / §22 | "No persisted client-side suite"; "run harness manually" | FIXED | the CI `frontend-harness` job |

## 4. Findings still open today, ranked by severity

1. **MEDIUM (down from HIGH): the Loan-region override is still missing on
   the backend.**
   - Call sites: `OvernightEmailer.gs:1030` and `AllIssuesEmailer.gs:254`
     (plus the manual `:2347`). `Core.gs` still has no `project_region`
     alias.
   - Failure scenario: a Google Non-UTM lead has `project_region="Loan"`
     and raw `region="Pune"`.
     - The dashboard's report builder groups it under Loan.
     - The 10:00 and 17:00 emails group it in the **Pune** region's email
       and `Overnight_Log`/`AllIssues_Log` rows instead.
     - Its RM is still resolved through the hierarchy, so a loan-team RM
       still lands with the loan CH, but inside a "Pune" email and log
       band.
   - Worse case: the raw region is blank or unmapped. `mainRegionForGs_`
     returns `null` and the lead is **silently dropped** from both
     scheduled emails (`if (!main) return;`). On the dashboard the same
     lead appears under Loan.
   - Also affected: an unresolved RM falls back to the Pune
     `Region_Recipients` entry rather than Loan's. Region-level idempotency
     and the 13:00 follow-up are keyed on the wrong region.
   - Why downgraded: the recipient is mostly right (per-RM routing plus the
     loan-CH rule since 2026-10-03), and the `group_source` half of the
     original scenario cannot occur behind the Google-only gate.
2. **MEDIUM: cross-runtime and cross-user `Lead_Followups` overlap, with the
   direction corrected.**
   - The backend is upsert-only and never touches column F. The risk is
     the browser's `clearLeadFollowupsTab()` (`js/sheets-writeback.js:319`,
     called from `js/reports-ui.js:439` and `js/tab-movement.js:1310`).
   - The `_generateCycleOwner` mutex is per browser tab, in memory only.
   - Failure scenario: at 13:00 the follow-up job upserts unresolved leads
     and polls column F for up to ~2 min. A manager clicks Generate on the
     dashboard during that window and the tab is cleared. The job then
     reads nothing back and sends keyword-engine text, even if a human had
     typed a reviewed suggestion.
   - The same thing happens between two users' browsers, which the
     per-tab mutex cannot see.
3. **MEDIUM: Snapshot Now has no reentrancy guard**
   (`js/tab-movement.js:1397`; also auto-snapshot on refresh,
   `js/core-fetch-and-render.js:611`).
   - Failure scenario: a double-click, or a Refresh with auto-snapshot on
     followed by a click. Both runs `fetchMovementLog` before either one
     appends, both see the same latest hashes, and both append a full batch
     plus two `SLA_History` upserts for the same moment.
   - The content-hash dedup does not catch this, because the race happens
     before the first write lands.
4. **LOW-MEDIUM: `MIN_CALLS_AFTER_48H` display/logic mismatch.**
   - Failure scenario: a lead is 3 days old with 7 calls today. Its
     Approaching/Stuck card reads "requires 10 calls".
   - Meanwhile the People table tooltip says "fewer than 5 calls … any
     lead age" and `underCalledToday` uses 5.
   - An RM is told two different bars on the same screen.
5. **LOW: "Possible Premature Closes" is browser-only.**
   - Failure scenario: a lead closed overnight with a last comment of
     "visit arranged" is never surfaced if nobody clicks Generate that
     day.
   - Porting it to the backend would also need a `lead_closing_comment`
     alias in `HEADER_ALIASES_`.
6. **LOW: the Overnight trigger has no `.inTimezone('Asia/Kolkata')`**
   (`OvernightEmailer.gs:2298-2299`).
   - Failure scenario: if the Apps Script project's timezone setting is
     ever changed or reset, the 10:00 and 13:00 sends shift silently.
   - Every newer installer pins IST, so this one is the outlier.
7. **LOW: a filter apply is dropped while another is in flight**
   (`js/core-filters.js:39`). If the user toggles a second checkbox while a
   heavy pass runs, the checkbox UI and the rendered data disagree until
   the next interaction.
8. **LOW: `TEST_MODE_OVERRIDE_EMAIL(_)` still has no on-screen indicator**
   when it is set. CI parity now checks it is `''` in git, but a value set
   from the console, or edited live in the Apps Script editor, would
   redirect sends with no visible sign.
9. **LOW (resilience, not a defect): RM hierarchy routing is single-source.**
   It is now backed by sync, re-route and audit jobs; keep it watched.
10. **Info: `_allReports` is a bare cross-file `let`.** Not a bug, only a
    style inconsistency.

Closed or no longer applicable from the §18 list:
- **KPI-strip mixing**: substantively resolved.
- **Stale bug list**: still stale, no action needed.

## 5. Parts of the document that are now misleading (mark as superseded)

- **P1 §0, §1, §4a-4d, §5 and P7 §1, §5**:
  - File counts (23 JS, 11 `.gs`, 12 tests, 35 production files), most line
    numbers and per-file line counts.
  - The trigger table: it omits about 12 later triggers and ~10 new `.gs`
    subsystems (Email Ops, sweep, ledger, reroute, cycle report, ops audit,
    hierarchy sync, stale leads, follow-up tracker, daily checklist).
  - Point readers to `docs/INDEX.md`, `HANDOVER.md` §4.3 and
    `docs/TEAM_CLAUDE_HANDOVER.md`.
- **P1 §4a and P7 §19 #6**: the "CLAUDE.md load order is wrong" claim is
  fixed.
- **P1 L19, P7 §20 Testing and §22**: "no client-side CI suite" is wrong
  now that the `frontend-harness` CI job exists.
- **P2 §1 (`call_attempts` row) and P4 §4.2 (`underCalledToday`)**: the
  delta-only and `client_id`-keyed baseline description is superseded by
  MAX(delta, today's comment count) keyed by `lead_id` (2026-10-01).
- **P2 §4/§5 snapshot flow**: does not mention the content-hash dedup or
  the auto-snapshot-on-refresh path.
- **P3 §3.8, P6 §6.5 row "Generate/Lead_Followups" and P7 §18 MEDIUM #3**:
  these say the backend "clears/rewrites" `Lead_Followups`. That is wrong
  (it is upsert-only and never touches F); the risk runs browser → backend
  instead.
- **P4 §4.4, P6 §6.4 and §6.5, P7 §1, §12, §18 HIGH, §19 #2, §22**:
  - The "routed to the wrong recipient" impact is overstated. Routing is
    per RM, and loan-team RMs are pinned to the loan CH since 2026-10-03.
  - The `group_source` path is unreachable behind the Google-only gate.
  - The third call site is no longer a scheduled path.
  - Keep the finding open, but re-rate it MEDIUM and restate the scenario
    as region grouping, legacy fallback and silent drop.
- **P5 §5.1, P7 §3 step 7, §11 and §18 LOW (KPI strip)**: 6 tiles and the
  "counts as 2" description are superseded. There are now 4 tiles, all
  showing distinct customers plus clones.
- **P1 §4c `tab-morning`, P5 §5.3 `_refreshMorningBriefOnNextRender` and
  P7 diagram G (`MORNING`)**: the Morning Brief tab is hidden since
  `9efec5d`.
- **P7 §22 "Zero CRITICAL … one HIGH"**: should be read as a 2026-09-07
  snapshot only. The newer Email Ops code has not been audited here.
