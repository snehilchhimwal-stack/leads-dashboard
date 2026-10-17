# GS-001 — AllIssuesEmailer.gs

| | |
|---|---|
| **Type** | `GS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `AllIssuesEmailer.gs` (902 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-10-15 against commit `1f51394` - stale-lead count tile (e8d33f8) and audit 2026-10-13 fixes AI-1..AI-9, EI-2/5/13 (09eb9ca) |

## Purpose / reason to exist

An unattended daily (17:00 IST) email, per region, covering **all 5**
Operations SLA checks for Google Non-UTM / Search leads assigned in the
last 3 calendar days. It exists so a regional head gets a complete
end-of-day issue digest even if nobody opened the dashboard — the
scheduled counterpart of the Operations tab's on-demand region reports
(`TAB-003`).

## Responsibilities

- `sendAllIssuesEmails` / `sendAllIssuesEmails_` — build and send the
  per-region digests.
- `allIssuesWindowGs_` — the IST-midnight-anchored 3-calendar-day
  window (explicitly **not** rolling-hours — a documented undercount
  fix).
- `sendOneAllIssuesEmail_` — one region's email.
- `notifyChLevelIssuesGs_` — the CH-level rollup for RMs whose chain is
  blank.
- `ensureAllIssuesLogSheet_` + `AllIssues_Log` bookkeeping.
- `setupAllIssuesEmailTrigger` — install the 17:00 trigger.

## Trigger schedule

`setupAllIssuesEmailTrigger()` (`#L605`) installs `sendAllIssuesEmails`
on `atHour(17).nearMinute(0).everyDays(1).inTimezone('Asia/Kolkata')`
(`LOGIC_AUDIT.md` Part 1 §5). The `.nearMinute(0)` is load-bearing —
the function's own comment documents a real incident where, without it,
this trigger once fired **54 minutes late**.

## Requires `setupXxx()` re-run when

Only when the **schedule itself** changes — e.g. editing
`ALL_ISSUES_RUN_HOUR_` alone does nothing until
`setupAllIssuesEmailTrigger()` is re-run (the file's own comment says
so). A change to the *logic* inside `sendAllIssuesEmails_` takes effect
on the next 17:00 fire automatically (`CLAUDE.md` gotcha).

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-174 | `sendAllIssuesEmails()` / `sendAllIssuesEmails_()` `#L237/#L261` | `leads` tab, `Movement_Log` maps | one email per region | Gmail sends; `AllIssues_Log` rows; since 2026-10-13: an ops alert when the Leads tab has no data rows (EI-13, EXC-152); the "already sent today" guard also reads `Email_Ledger` (RULE-076, AI-3); a recovery run no longer adds the original run's exclusions to a second "Leads NOT sent" report (AI-1); the "Leads NOT sent" report carries 17:00 wording (`notifyLeadSendFailuresGs_` opts, EI-2/AI-4); the timing log counts attempted vs accepted bucket emails apart (AI-9) | `computeSlaFlags_` (`GS-012`), `buildMovementLogMapsGs_` (`GS-008`), `resolveRecipientEmailsForRegion_` (`GS-004`), `sendOneAllIssuesEmail_` (FN-176), `withSendRetry_` (`GS-004`) | the 17:00 trigger; `sendAllIssuesEmailsNow()` (manual) | specific — scheduled |
| FN-175 | `allIssuesWindowGs_(asOf)` / `allIssuesDateRangeLabelGs_(win)` `#L154/#L164` | as-of date | `{start, end}` IST-midnight-anchored 3-calendar-day window + a label | none | `istDayKeyGs_` (`GS-002`) | FN-174 | specific — **not rolling-hours** (documented undercount fix) |
| FN-176 | `sendOneAllIssuesEmail_(ss, logSheet, region, rec, leads, dateLabel, todayKey, now, win, ledgerCtx)` `#L715` | one region's data | that region's email (`null`, or `{reason}` on failure) | Gmail send; log row; stale leads split to the bottom and counted in a KPI tile (`applyStaleSplitGs_`, `GS-021`, since 2026-10-13); since 2026-10-13 (audit): the subject omits the role brackets when a bucket has no role (AI-6), a direct call without `ledgerCtx` gets its own `dropped` list (AI-5), and the failure alerts say up to 3 identical drafts may exist - send one (EI-5) and name the 3-calendar-day window, not 48h (AI-4) | `renderOvernightReportEmailHTML_` (`GS-004`), `withSendRetry_` (`GS-004`) | FN-174 | specific |
| FN-177 | `notifyChLevelIssuesGs_(region, chLevelRms, rmToLeads, win, ledger)` `#L591` | CH-level RMs + their leads | a CH-level rollup email | Gmail send; stale leads split and counted via `applyStaleSplitGs_` (`GS-021`); since 2026-10-13 (audit AI-2) EVERY send failure raises an ops alert (`... FAILED` or `... BLOCKED`) listing the lead ids and how to re-send by hand (EXC-153); subtitle says "last 3 calendar days" (AI-4) | `groupLeadsByRmAndFlatten_` (`GS-004`) | FN-174 | specific |
| FN-178 | `ensureAllIssuesLogSheet_(ss)` `#L200` | spreadsheet | ensures `AllIssues_Log` exists (now 14 columns — see `## Version / change reference`) | may create the tab | — | FN-174 | specific |
| FN-179 | `sendAllIssuesEmailsNow()` / `setupAllIssuesEmailTrigger()` `#L885/#L944` | — | manual run / installs the trigger | Gmail sends / creates a trigger | FN-174 / `ScriptApp` | Apps Script editor, manual | specific |
| FN-299 | `removeAllIssuesLogRowsInWindowGs_(ss, from, to, recipient, expectedCount)` `#L976` / `removeTestModeAllIssuesRowsNow()` `#L972` | a spreadsheet, a time window, a recipient, an expected row count | deletes those `AllIssues_Log` rows | archives them to a Drive CSV first (`archiveRowsToDriveCsv_`, `GS-002`) and checks the archive, then `deleteRows`; touches NOTHING unless the header is as expected, the matching rows are one contiguous block, and their count equals `expectedCount` | `archiveRowsToDriveCsv_` (`GS-002`) | run once by hand from the Apps Script editor (`removeTestModeAllIssuesRowsNow`, window 2026-09-24 10:00-10:30 IST, recipient the tester, expected 28) — not wired to any trigger | specific — **one-off remediation, 2026-09-26** for the rows a TEST MODE run wrote before `writeUnlessTestModeGs_` existed; safe to re-run (a second run finds nothing). Same pattern as `removeDedupIncidentRowsNow` (`GS-008`) |
| FN-341 | `testModeRowsRecipientGs_()` `#L970` | none | the tester address whose test-mode `AllIssues_Log` rows `removeTestModeAllIssuesRowsNow` (FN-299) deletes — the ops address | none | `opsAlertEmailGs_` (`GS-004` FN-338) | `removeTestModeAllIssuesRowsNow` | specific — **added 2026-10-07 (email audit P13)**; replaces the old test-rows recipient string constant (a corporate address in a public repo) |
| FN-406 | `allIssuesRecoveryTargetsGs_(ss, now)` / `allIssuesLateCutoffPassedGs_(now)` (thin wrappers over `GS-015` FN-409) | the workbook, the time | today's FAILED, BLOCKED or PLANNED 17:00 bucket rows `[{emailId, region, bucket, status}]`; whether it is past 18:30 IST | reads `Email_Ledger` | `emailLedgerReadRowsGs_` (`GS-015`) | FN-407 | specific - RULE-056 |
| FN-407 | `recoverFailedAllIssuesBuckets_(opts)` / `recoverFailedAllIssuesBucketsNow()` / `recoverFailedAllIssuesBucketsForceNow()` / `sendAllIssuesEmails_({ onlyEmailIds })` | `{now, force}` | `{targets, cutoff, ran}` | re-runs the 17:00 pipeline for ONLY the targeted buckets (region guard skipped, exclusions and CH-level reports not repeated), closes untargeted-but-missing buckets as SKIPPED; the entry points go through the job lock (job `recoverAllIssuesBuckets`, alerts held) | `sendAllIssuesEmails_`, `withEmailJobLockGs_` (`GS-004`) | the Apps Script editor (manual) | specific - RULE-056 |

## Business rules implemented - `RULE-XXX` sub-table

| ID | Rule | Where | Duplicated elsewhere? |
|---|---|---|---|
| RULE-056 | A failed 17:00 bucket can be re-sent the same IST day, until 18:30 IST (decision D5), by `recoverFailedAllIssuesBucketsNow()`: only buckets the ledger shows FAILED, BLOCKED or still PLANNED (the run died before reaching them) (never ATTEMPTING or UNCONFIRMED - it may have been delivered; never ACCEPTED), everything re-checked from the CURRENT data, siblings in the region untouched; a bucket whose leads are resolved or whose routing changed is closed as SKIPPED with the reason; after 18:30 nothing is sent late (`...ForceNow` overrides on purpose) | FN-406, FN-407 | `docs/_planning/EMAIL_OPS_SYSTEM_AUDIT.md` D3, D5 |
| RULE-076 | A 17:00 region counts as "already sent today" (and the run skips it) when `AllIssues_Log` has a row dated today for it **or** today's `Email_Ledger` has a 17:00 row for it whose status is ACCEPTED, ATTEMPTING or UNCONFIRMED (sent, or may have been sent). Not applied in TEST MODE or a recovery run; a ledger that cannot be read falls back to the log alone (EXC-154) - added 2026-10-13 (audit AI-3): the log row is written after the send, so a run that died in between, or whose append failed, used to be re-sent in full | FN-174 | the 10:00/13:00 jobs have their own guards (`GS-010`) |

## Config constants — `CFG-XXX` sub-table

| ID | Constant | Value | Meaning | Changing it affects |
|---|---|---|---|---|
| CFG-025 | `ALL_ISSUES_RUN_HOUR_` | `17` | the send hour | the trigger schedule — **requires `setupAllIssuesEmailTrigger()` re-run to take effect** |
| CFG-026 | the 3-calendar-day window | 3 days, IST-midnight-anchored | which leads are in scope | `allIssuesWindowGs_` (FN-175) |
| CFG-116 | `ALL_ISSUES_LATE_CUTOFF_HOUR_`, `ALL_ISSUES_LATE_CUTOFF_MINUTE_`, `EMAIL_RECOVERY_JOB_` | `18`, `30`, `recoverAllIssuesBuckets` | the latest time a failed bucket is re-sent; the recovery job's name (its alerts are held like the three email jobs') | how late a recovery may send |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-055 | a send fails transiently | `withSendRetry_` (`GS-004`) retries with backoff; persistent failure → `notifyLeadSendFailuresGs_` ops alert | the run continues for other regions; ops gets an alert |
| EXC-056 | `RmHierarchy.private.gs` absent → all resolved emails `''` | routing degrades to `Region_Recipients` / `CH_LEVEL_EMAIL_` fallback | email still sends, to the fallback address (`GS-011`) |
| EXC-057 | trigger fires late without `.nearMinute(0)` | mitigated by `.nearMinute(0)` in the installer | (historical) a 54-minute-late fire |
| EXC-130 | recovery is called after 18:30 IST | nothing is sent; the log says so; the ledger keeps FAILED/BLOCKED | none (use `...ForceNow` to send on purpose) |
| EXC-131 | a targeted bucket is not produced by the recovery run (leads resolved, routing changed) | its ledger row is closed as SKIPPED with the reason | the 16:30 report shows it as skipped |
| EXC-152 | the Leads tab returns zero data rows (`readLeadsTab_`) | since 2026-10-13 (audit EI-13): ops alert "17:00 All-Issues: the Leads tab has NO data rows - no emails were sent" (names the tab, says to re-run `sendAllIssuesEmailsNow()` once it is filled); the run still completes | no 17:00 emails; ops are told why instead of it looking like a quiet day |
| EXC-153 | a CH-level All-Issues report fails to send (gate block or Gmail error) | since 2026-10-13 (audit AI-2): ops alert for every failure (was: gate blocks only), with the lead ids and a by-hand re-send note (not covered by `recoverFailedAllIssuesBucketsNow`; check Gmail Drafts on a Gmail error); not marked as sent | ops get an alert and can re-send |
| EXC-154 | `Email_Ledger` cannot be read for the "already sent today" guard (RULE-076) | logged; the guard uses `AllIssues_Log` alone; never blocks the run | none |

## Data lineage

`leads` tab (`SHEET-001`, via `readLeadsTab_`, `GS-004`) + `Movement_Log`
maps (`SHEET-002`, via `buildMovementLogMapsGs_`, `GS-008`) →
`computeSlaFlags_` (`GS-012`) → per-region grouping via
`mainRegionForGs_` / `resolveRecipientEmailsForRegion_` (`GS-004`) →
`renderOvernightReportEmailHTML_` (`GS-004`) → Gmail (`EXT-002`);
`AllIssues_Log` (`SHEET-013`) records each send. Full flow: `DATA-002` +
`DATA-005`.

## Sheets touched

| `SHEET-XXX` | Read / Write | Which `FN-XXX` | Notes |
|---|---|---|---|
| `SHEET-001` `leads` | Read | FN-174 (via `readLeadsTab_`) | the source data |
| `SHEET-002` `Movement_Log` | Read | FN-174 (via `buildMovementLogMapsGs_`) | for `underCalledToday` baselines and the follow-up text's last snapshot — both looked up by LEAD id since 2026-10-07 (email audit F18) |
| `SHEET-012` `Region_Recipients` | Read | FN-174 (via `resolveRecipientEmailsForRegion_`) | recipient fallback |
| `SHEET-006` `RM_Hierarchy` / `SHEET-007` `Manager_Directory` | Read | FN-174 (via `GS-011`) | routing |
| `AllIssues_Log` | Write (append) | FN-176 / FN-178 | send bookkeeping — not yet a `SHEET-XXX` (count TBD, DOC-010/032) |
| `SHEET-019` `Email_Ledger` | Read + write | FN-174 (via `GS-015`) | per-email evidence; since 2026-10-13 also read by the "already sent today" guard (RULE-076) |

## Failure / error behaviour

Per-region isolation — one region's send failing does not abort the run.
Transient failures retry via `withSendRetry_`; persistent ones raise an
ops alert. A failure shows as **Failed** in Apps Script Executions only
if it escapes all retries. Since 2026-10-13 an empty Leads tab (EXC-152)
and every CH-level report failure (EXC-153) raise an ops alert.

## Cross-runtime duplication

Uses `computeSlaFlags_` (`GS-012`) — the `.gs` twin of `enrichLead`
(`JS-006`). Region grouping uses `mainRegionForGs_` (`GS-004`) — twin of
`mainRegionFor` (`JS-014`). **The Loan-region `effectiveRegion` override
is missing here** — `LOGIC_AUDIT.md` Part 4 §4.4 / Part 7 §18 HIGH (this
is one of the 3 scheduled-email call sites named in that finding).

## Not live until pasted

A `.gs` edit in this repo is **not running** until pasted into the
Sheet's bound Apps Script editor and saved. If the schedule changed,
also re-run `setupAllIssuesEmailTrigger()` once (`CLAUDE.md` top gotcha).

## UI relationships

N/A — backend-only, scheduled. (The Operations tab, `TAB-003`, is the
on-demand human counterpart.)

## Architecture relationship

The Apps Script backend half (peer of `DASH-001`, sharing only
`SHEET-*`). Layer 17 (backend automation) in `LOGIC_AUDIT.md` Part 1 §1.

## Related documentation

`HANDOVER.md` §2, §4.3, §8; `OPS_CHECKLIST.md` (email routing checks);
`LOGIC_AUDIT.md` Part 1 §4d, §5, Part 4 §4.4, Part 7 §18 HIGH;
`CLAUDE.md`.

## Relationships

- **Depends On:** `GS-002` (`Core.gs`), `GS-004` (`EmailInfra.gs`),
  `GS-005` (`FollowupEngine.gs`), `GS-008` (`MovementTracker.gs` maps),
  `GS-011` (`RmHierarchy.gs`), `GS-012` (`SlaEngine.gs`), `SHEET-001`,
  `SHEET-002`, `SHEET-006`, `SHEET-007`, `SHEET-012`, `SHEET-013`,
  `EXT-002`, `DATA-002`, `DATA-004`, `GS-015` (`EmailLedger.gs` - the per-email evidence trail, EO-1a),
  `SHEET-019`, `SHEET-020`
- **Used By:** `SHEET-013`, `DATA-005`, `GS-010` (`OvernightEmailer.gs` —
  `ensureAllIssuesLogSheet_`/`ALL_ISSUES_LOG_SHEET_`, added 2026-09-23
  for the two-checkpoint email lifecycle redesign)
- **Related:** `TAB-003` (the on-demand equivalent), `GS-010`
  (`OvernightEmailer.gs` — the other scheduled emailer), `JS-014` (the
  client report builder it parallels)

## Source of truth

`AllIssuesEmailer.gs` at `HEAD`.

## Validation

- **Method:** full read at `c82ec67`; function list verified by grep;
  trigger schedule cross-checked against `LOGIC_AUDIT.md` Part 1 §5.
  `Tests_AllIssuesEmailer.gs` runs in CI (`node test/run-gs-tests.js`)
  against in-memory `SpreadsheetApp` / `GmailApp` fakes — proves the
  logic, **not** that it is live on the Sheet.
- **Evidence:** `.github/workflows/test.yml` (`Tests_AllIssuesEmailer.gs`,
  last green run); `LOGIC_AUDIT.md` Part 1 §4d/§5.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-029.

**Revalidated 2026-09-23** `65df46c`: `ensureAllIssuesLogSheet_`
(FN-178) gained 5 new columns — `issue_snapshot_json`,
`checkpoint1_json`, `checkpoint1_sent_at`, `checkpoint2_json`,
`checkpoint2_sent_at` — Step 2/11 of the two-checkpoint email lifecycle
redesign (`docs/_planning/EMAIL_LIFECYCLE_TWO_CHECKPOINT_REDESIGN.md`
Part 5, goal `g-tf-fc7cc3383b`). Purely additive to `AllIssues_Log`'s
schema via the function's existing missing-header backfill logic —
nothing reads or writes the new columns yet (that lands in Steps 3-5),
so `sendAllIssuesEmails`'s own behavior, scope, and every other cited
function are unchanged. Re-grepped and corrected every `#Lnn` citation
in this record below `ensureAllIssuesLogSheet_`'s insertion point (a
uniform +30 shift, confirmed per-function, not assumed).

**Revalidated 2026-09-23** `51a6498`: `sendOneAllIssuesEmail_`
(FN-176) now writes `issue_snapshot_json` at send time — Step 3/11 of
the same redesign. `Tests_AllIssuesEmailer.gs` gained 4 new assertions
(snapshot lead count, lead_ids, per-entry shape, priority-picked
issueLabel matches the email body). `sendOneAllIssuesEmail_`'s own
citation (`#L451`) is unchanged — the edit landed inside the function
body, not before it — but `FN-179`'s citations shifted +13 (the new
comment+code pushed everything after it down); corrected.

**Revalidated 2026-09-23** `c7e22ae`: Step 6/11 of the same
redesign — `GS-010` (`OvernightEmailer.gs`) now calls
`ensureAllIssuesLogSheet_` (FN-178) and reads `AllIssues_Log` directly,
a genuinely new caller/dependency edge (`GS-010` already listed this
file as a required paste-dependency for the shared Apps Script project,
but had no actual code dependency until now). No change to this file
itself — `Used By` updated to name the new caller.

**Deployed live 2026-09-24**: pasted into the Sheet's Apps Script editor
as part of Step 10/11's live verification pass — see `GS-010`'s own
Version/change reference for the full deployment + verification
narrative (all 3 changed files — this one, `OvernightEmailer.gs`,
`SlaEngine.gs` — deployed and verified together in one session).
`sendAllIssuesEmails` run for real under `TEST_MODE_OVERRIDE_EMAIL_`:
28 bucket emails sent (all correctly redirected), 0 errors, real
`issue_snapshot_json` confirmed written to `AllIssues_Log`.

**2026-09-25** (`57e5545`): TEST MODE hardening — the `AllIssues_Log` append now goes through `writeUnlessTestModeGs_` (a TEST MODE run writes no row), the per-region idempotency guard is bypassed in TEST MODE (so a test is repeatable and can never consume the real run's guard), and `notifyChLevelIssuesGs_` sends to `chLevelReportToGs_()` (tester only in TEST MODE). Line count unchanged. Full incident narrative + the helper functions are in `GS-004`'s Version/change reference (`FN-283`/`FN-284`).

**2026-09-25, later** (`684956b`): single Futwork email across regions — Futwork RMs' leads from every region are grouped under the one `Futwork` key (`regionKeyForRmGs_`), each lead keeping its real `region` (so the log's `issue_snapshot_json` entries carry it); `sendOneAllIssuesEmail_` renders that email region-by-region with bands, the regions spelled out in the subject and the header line, and no longer prints empty brackets for it. Ordinary buckets are unchanged. Full narrative and the helper functions are in `GS-004`'s Version/change reference (`FN-290`..`FN-294`, `CFG-068`).

**2026-09-25, evening** (`b3a58f9`): 13:00 crash hardening — the `issue_snapshot_json` cell now goes through `jsonForCellGs_` (never over 45,000 characters). Line count unchanged. Full narrative in `GS-004`'s Version/change reference (`FN-283`, `FN-295`, `CFG-069`).

**2026-09-26** (`5aafbd4`): added the guarded one-off `removeTestModeAllIssuesRowsNow` (`FN-299`) to delete the 28 `AllIssues_Log` rows the 2026-09-24 TEST MODE run left behind (user request "remove test rows"). +74 lines (604L → 678L). Also: `sendOneAllIssuesEmail_` now receives a Cc that includes the region's P&L head when one is configured (`GS-004` `FN-298`) — no change to this file for that; the Cc is stored in col F as before. Tests: `Tests_AllIssuesEmailer.gs` (count / contiguity / header aborts, happy path with archive, re-run). **Deployed live and run 2026-09-26** (~14:55 IST): `AllIssuesEmailer.gs` (with `EmailInfra.gs`) applied to the Sheet's Apps Script editor as exact diff edits, saved, SHA-256 of the saved files re-read in a fresh editor tab equals the committed files. `removeTestModeAllIssuesRowsNow` was then run once from the editor: it archived 28 rows to Drive (`Leads Dashboard Archive/AllIssues_Log`) and removed sheet rows 824-851; `AllIssues_Log` went to 852 data rows and no 2026-09-24 row remains (checked through the gviz export).

**2026-10-05** (`fb17144`, email audit P1 — `docs/_planning/EMAIL_AUDIT.md` F3/F4): `sendOneAllIssuesEmail_` and `notifyChLevelIssuesGs_` now send through `sendGuardedEmailGs_` (`GS-004` `FN-324`), claiming the lead ids they count; a blocked bucket is reported as "not sent" (no `AllIssues_Log` row), and `notifyChLevelIssuesGs_` skips silently when it would carry zero flagged leads. `Tests_AllIssuesEmailer.gs` gained assertions for the per-bucket plain part, a no-follow-up lead rendering blank, and the CH-level plain part. **Not live until pasted.**

**2026-10-05** (`dbeb7da`, email audit P2 — `docs/_planning/EMAIL_AUDIT.md` F13/F15): `sendOneAllIssuesEmail_` and `notifyChLevelIssuesGs_` build their plain-text body from the same opts as the HTML (`GS-004` `FN-325`) instead of a one-line count stub. `Tests_AllIssuesEmailer.gs` +9 assertions. **Not live until pasted.**

**2026-10-05** (`6fc3f3c`, email audit P4 — `docs/_planning/EMAIL_AUDIT.md` F5): `sendAllIssuesEmails` (the trigger entry point) runs its crash-alert wrapper inside `withEmailJobLockGs_` (`GS-004` `FN-327`): an overlapping job is skipped with an ops alert (not retried); a broken lock service fails open. No `setupXxx()` re-run. `Tests_AllIssuesEmailer.gs` gained the contended / normal / fail-open lock tests. **Not live until pasted.**

**2026-10-05** (`6acea29`, email audit P7 — `docs/_planning/EMAIL_AUDIT.md` F9/F10): `sendOneAllIssuesEmail_` (FN-176) appends its `AllIssues_Log` row through `appendRowOnceGs_` (`GS-004` FN-329, keyed on the thread id, column I), so a retry after a timeout that landed after the write cannot add a second snapshot row. Recipient buckets that share an address now arrive already merged from `resolveRecipientEmailsForRegion_` (`GS-004` FN-330), so one address no longer receives two separate emails from this job for the same region. No line-count change (the line count above is also corrected: it was stale). **Not live until pasted.**

**2026-10-05** (`15d74d4`, email audit P10 — `docs/_planning/EMAIL_AUDIT.md` F11): `notifyChLevelIssuesGs_` (FN-177) checks `wasChReportSentTodayGs_` (`GS-004` FN-336) after its zero-leads guard and records `markChReportSentGs_` only after a successful send, so a same-day re-run of the 17:00 job no longer re-sends the CH-level issues report for a region whose only flagged leads are CH-held (no `AllIssues_Log` row, so the region guard never protected it). The 10:00 overnight report and this one are tracked separately. +6 lines (anchors re-mapped). `Tests_AllIssuesEmailer.gs` gained once-a-day, separate-kind, failed-send and end-to-end CH-only-region tests. **Not live until pasted.**

**2026-10-07** (`c416a01`, email audit P13 — `docs/_planning/EMAIL_AUDIT.md` F24): `TEST_MODE_ROWS_RECIPIENT_` (a corporate address literal used only by the one-off `removeTestModeAllIssuesRowsNow`) is replaced by `testModeRowsRecipientGs_()` (`FN-341`), which returns the ops address resolved from the private employee table. No change to the job itself. +7 lines (695L -> 702L; anchors re-mapped). **Not live until pasted.**

**2026-10-07** (`7799e44`, email audit P15 / F18): the 17:00 email's follow-up text fetches the lead's last Movement_Log snapshot by `lead_id` instead of `client_id || 'l:' + lead_id` (`GS-008`'s maps are lead-keyed now). The per-customer `identityKey` collapse is unchanged. `Tests_AllIssuesEmailer.gs` gained an end-to-end scenario with two sibling leads (the surviving lead's issue label and "5 more call attempts" text come from its OWN baseline). **Not live until pasted.**

**2026-10-09** (`b1dbc3a`, Email Ops EO-1a): `sendAllIssuesEmails_` now records every bucket email in the ledger (`GS-015`): PLANNED per region in one write, ATTEMPTING before the send, then ACCEPTED / FAILED / UNCONFIRMED / BLOCKED with the Gmail ids; leads left out go to `Email_Ledger_Exclusions`. Per-lead isolation (plan decision D3): a defective lead is dropped and the rest of its bucket still goes; when the send gate objects to specific leads only those are dropped and the bucket is resent once (`sendOneAllIssuesEmail_` takes an optional `ledgerCtx`). A duplicate lead id is left out but not reported as unsent. The ledger is fail-open: it can never stop or change an email. **Not live until pasted.**

**2026-10-09** (`f46ebc7`, Email Ops EO-2): the whole-job crash alert of `sendAllIssuesEmails` is sent with `{ immediate: true }` - every other alert raised during the run is held until the run has ended (`GS-015` RULE-047). **Not live until pasted.**

**2026-10-09** (`ec0948e`, Email Ops EO-9): `recoverFailedAllIssuesBucketsNow()` re-sends just the failed or blocked 17:00 buckets of the day (until 18:30 IST) - a plain re-run could not, because the "region already sent today" guard skips the whole region when a sibling bucket succeeded. `sendAllIssuesEmails_` takes an optional `{ onlyEmailIds }` for it. **Not live until pasted.**

**2026-10-09** (`ea5fdc5`, Email Ops, decision D6): `sendAllIssuesEmails_` judges the Leads tab's freshness once per run from the rows it already read (`staleLeadsNoticeFromRowsGs_`, `GS-004` FN-408) and, when the tab is RED, a RED Leads tab (newest lead assigned at least 24 h ago) now adds a separate **"Data freshness notice"** section at the very bottom of every email (17:00 bucket and CH-level, 10:00 combined and CH-level, 13:00 reply) - the lead tables above stay complete and **no email is ever held** for it (user decision D6, 2026-10-09). The section is carried in the per-bucket context (so the quarantine-and-resend keeps it) and passed to `notifyChLevelIssuesGs_`; the recovery job re-judges the tab at its own send time. Nothing is held. **Not live until pasted.**

**2026-10-09** (`f774462`, Email Ops EO-9b): the recovery's target reader, cutoff test and driver are now the shared `GS-015` FN-409 (this file keeps its wrappers and its own cutoff constants, CFG-116); buckets left PLANNED by a run that died are targets too (`GS-015` RULE-058). **Not live until pasted.**

**2026-10-10** (`59db11b`, decision D8): the 2026-10-09 tab-level notice above was **withdrawn**. Instead `sendAllIssuesEmails_` puts a `staleSince` date on every flagged lead (`staleSinceOfRowGs_`, `GS-021`) and both the bucket email and the CH-level report move the stale leads (no update for more than 24 h) into a separate block at the bottom (`splitStaleSectionsGs_`); the leads stay in the body and in the counts. **Not live until pasted.**

**2026-10-10** (`000c1e6`): `ensureAllIssuesLogSheet_` retries a transient Sheets error (it opens the tab through `ensureAllIssuesLogSheetOnce_`), and the job's first read of the tab's size goes through `lastRowRetryGs_` (`GS-015`): the 2026-10-10 17:04 run died on exactly that unprotected call (HANDOVER section 8). **Not live until pasted.**

**2026-10-15** (`e8d33f8`): both the bucket email and the CH-level report now call `applyStaleSplitGs_` (`GS-021`) instead of `splitStaleSectionsGs_`: besides moving stale leads to the bottom block it adds a KPI tile right after the headline count ("n of these is/are stale - listed at the bottom"), which shows in the HTML and in the plain-text KPI line (`plainTextReportGs_`); the headline still counts every lead. This file does not use `staleCountNoteGs_` (its one-line plain summary is unchanged). **Live** (confirmed in the Apps Script editor 2026-10-14 - `docs/STALENESS_TRACKER.md` deploy register).

**2026-10-15** (`09eb9ca`, audit 2026-10-13 AI-1/2/3/4/5/6/7/9, EI-2/5/13): the "already sent today" guard also trusts `Email_Ledger` ACCEPTED/ATTEMPTING/UNCONFIRMED rows (RULE-076, AI-3); a recovery run no longer re-reports the original run's exclusions in a second "Leads NOT sent" email (AI-1); every CH-level report failure is alerted with re-send instructions (AI-2, EXC-153); window texts say "last 3 calendar days" instead of 48h and the "Leads NOT sent" report gets 17:00 wording (AI-4, EI-2); a direct `sendOneAllIssuesEmail_` call no longer crashes on `ctx.dropped` (AI-5); a role-less bucket's subject has no empty brackets (AI-6); stale comments corrected (AI-7); the timing log counts attempted and accepted emails apart (AI-9); failure alerts warn that up to 3 identical drafts may exist (EI-5); an empty Leads tab raises an ops alert (EI-13, EXC-152). +58 lines (844L -> 902L; the header's old count was stale). `Tests_AllIssuesEmailer.gs` gained regression tests. **Not live until pasted.**

**2026-10-16** (uncommitted; email E2E defect D4, `docs/_planning/EMAIL_E2E_COVERAGE_2026-10-16.md`): the 17:00 bucket subject is built by one helper, `allIssuesSubjectGs_(region, rec, leads, win)`, used by `sendOneAllIssuesEmail_` and by the `Email_Ledger` plan, so every `allIssues17` row records the subject that was sent (it was blank, so `EmailSweep.gs` could not attribute a bounce arriving more than 15 minutes after the send). An UNCONFIRMED send's ledger row keeps its lead ids (O3). Covered by `Tests_EmailLifecycleMatrix.gs` M1. **Not live until pasted.**

**2026-10-16** (consolidated 17:00 recipients, user request): the people in `ALL_ISSUES_CONSOLIDATED_RECIPIENTS_` (`['rajesh muni', 'manisha rathod']`, bucket primary name, case-insensitive) get ONE 17:00 email across every region instead of one per region. Each region is resolved as before; a bucket whose label matches is set aside and, after the region loop, sent once under the pseudo-region `consolidatedRegionKeyGs_(name)` (`GS-004`), e.g. `Multi-region: Rajesh Muni`. That key is the AllIssues_Log `region`, the ledger id/region and the "already sent today" key, so recovery and the guards treat it as one bucket. To = the person; Cc = ONLY `ALL_ISSUES_CONSOLIDATED_CC_NAME_` ('Snehil Chhimwal', resolved by name through `resolvedEmailForNameGs_`; test override `ALL_ISSUES_CONSOLIDATED_CC_EMAIL_`); no per-region, leadership, P&L-head or `EXTRA_CC_FOR_RM_` Cc. The email shows region bands and the subject lists the regions (Futwork style). Plan/send were factored into `planBuckets_`/`sendBucket_` inside `sendAllIssuesEmails_`. Known limit: a real region skipped by the same-day re-run guard contributes none of its leads to a not-yet-sent consolidated email. Tests: `Tests_EmailLifecycleFullCycle.gs` (17:00 -> 10:00 -> 13:00), `Tests_EmailLedger.gs` (32e, recovery). Same day: the 10:00/13:00 jobs reuse this list, `consolidatedAllIssuesRecGs_` and the key, so those people also get ONE 10:00 email (overnight leads of every region + Checkpoint 1) and ONE 13:00 reply (`GS-010`).

**2026-10-17** (Snehil Chhimwal consolidated, user request): `ALL_ISSUES_CONSOLIDATED_RECIPIENTS_` is now `['rajesh muni', 'manisha rathod', 'snehil chhimwal']`. Snehil's buckets are the leads whose chain resolves to him (Rajesh/Manisha personally holding a lead: their `rh` is Snehil); their S1s stay in their own buckets (each RM lands in exactly one bucket), so nothing is absorbed or sent twice. `consolidatedAllIssuesRecGs_` never adds the configured Cc (`ALL_ISSUES_CONSOLIDATED_CC_NAME_`) to that person's own email (by name, and by address via `taken[to]`): his email is To him, no Cc. New `emailRoleLabelGs_(bucketLabel, primaryRole)` returns '' for a consolidated person: no role (his `RM_Hierarchy` row says "City Lead") in the 17:00 subject or plain body (which now shows the real regions, not the `Multi-region:` key), nor in the 10:00 subject/plain body (`combinedMorningSubjectGs_`, `sendCombinedMorningEmail_`, `sendOneOvernightEmail_`), so not in the 13:00 `Re:` subject either. Ledger ids and `AllIssues_Log.primaryRole` keep the role (ids unchanged). `RmHierarchy*.gs` untouched. Tests: `Tests_EmailLifecycleFullCycle.gs` "Consolidated City Lead (Snehil)" block.

## Revalidation trigger

Any commit touching `AllIssuesEmailer.gs` or `Tests_AllIssuesEmailer.gs`;
`ALL_ISSUES_RUN_HOUR_` or the trigger schedule changes (also needs the
setup re-run); the 3-calendar-day window logic changes; `computeSlaFlags_`
(`GS-012`) changes; the Loan-region HIGH finding is addressed here.

## Handover relationship

`HANDOVER.md` §2 names the file ("17:00 IST daily email covering all 5
Operations SLA checks"); §8 has the `.nearMinute(0)` incident. Current
as of 2026-09-09. A schedule or scope change must update `HANDOVER.md` §2
and run `OPS_CHECKLIST.md`'s email items.

## Lifecycle / retention

N/A — code. `AllIssues_Log` retention: `TBD` (DOC-036).

## Next action

The Loan-region HIGH finding (missing `effectiveRegion` override at this
call site) is a known unresolved gap — tracked via the revalidation
trigger, not this record's to fix.

## Closure evidence

Record committed for DOC-029; `docs/INDEX.md` `GS-001` → `Closed +
Monitored`, `Last Verified` 2026-09-10, links + trigger schedule
recorded. No `docs/changes/` record (DOC-029).
