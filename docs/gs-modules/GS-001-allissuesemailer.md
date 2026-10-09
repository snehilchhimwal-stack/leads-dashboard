# GS-001 — AllIssuesEmailer.gs

| | |
|---|---|
| **Type** | `GS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `AllIssuesEmailer.gs` (702 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-10-09 against commit `0213c9f` - the 17:00 recovery runs on the shared driver and also re-sends PLANNED buckets (see `## Version / change reference`) |

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
| FN-174 | `sendAllIssuesEmails()` / `sendAllIssuesEmails_()` `#L167/#L191` | `leads` tab, `Movement_Log` maps | one email per region | Gmail sends; `AllIssues_Log` rows | `computeSlaFlags_` (`GS-012`), `buildMovementLogMapsGs_` (`GS-008`), `resolveRecipientEmailsForRegion_` (`GS-004`), `sendOneAllIssuesEmail_` (FN-176), `withSendRetry_` (`GS-004`) | the 17:00 trigger; `sendAllIssuesEmailsNow()` (manual) | specific — scheduled |
| FN-175 | `allIssuesWindowGs_(asOf)` / `allIssuesDateRangeLabelGs_(win)` `#L89/#L99` | as-of date | `{start, end}` IST-midnight-anchored 3-calendar-day window + a label | none | `istDayKeyGs_` (`GS-002`) | FN-174 | specific — **not rolling-hours** (documented undercount fix) |
| FN-176 | `sendOneAllIssuesEmail_(ss, logSheet, region, rec, leads, dateLabel, todayKey, now, win)` `#L546` | one region's data | that region's email | Gmail send; log row | `renderOvernightReportEmailHTML_` (`GS-004`), `withSendRetry_` (`GS-004`) | FN-174 | specific |
| FN-177 | `notifyChLevelIssuesGs_(region, chLevelRms, rmToLeads, win)` `#L442` | CH-level RMs + their leads | a CH-level rollup email | Gmail send | `groupLeadsByRmAndFlatten_` (`GS-004`) | FN-174 | specific |
| FN-178 | `ensureAllIssuesLogSheet_(ss)` `#L133` | spreadsheet | ensures `AllIssues_Log` exists (now 14 columns — see `## Version / change reference`) | may create the tab | — | FN-174 | specific |
| FN-179 | `sendAllIssuesEmailsNow()` / `setupAllIssuesEmailTrigger()` `#L706/#L765` | — | manual run / installs the trigger | Gmail sends / creates a trigger | FN-174 / `ScriptApp` | Apps Script editor, manual | specific |
| FN-299 | `removeAllIssuesLogRowsInWindowGs_(ss, from, to, recipient, expectedCount)` `#L797` / `removeTestModeAllIssuesRowsNow()` `#L793` | a spreadsheet, a time window, a recipient, an expected row count | deletes those `AllIssues_Log` rows | archives them to a Drive CSV first (`archiveRowsToDriveCsv_`, `GS-002`) and checks the archive, then `deleteRows`; touches NOTHING unless the header is as expected, the matching rows are one contiguous block, and their count equals `expectedCount` | `archiveRowsToDriveCsv_` (`GS-002`) | run once by hand from the Apps Script editor (`removeTestModeAllIssuesRowsNow`, window 2026-09-24 10:00-10:30 IST, recipient the tester, expected 28) — not wired to any trigger | specific — **one-off remediation, 2026-09-26** for the rows a TEST MODE run wrote before `writeUnlessTestModeGs_` existed; safe to re-run (a second run finds nothing). Same pattern as `removeDedupIncidentRowsNow` (`GS-008`) |
| FN-341 | `testModeRowsRecipientGs_()` `#L791` | none | the tester address whose test-mode `AllIssues_Log` rows `removeTestModeAllIssuesRowsNow` (FN-299) deletes — the ops address | none | `opsAlertEmailGs_` (`GS-004` FN-338) | `removeTestModeAllIssuesRowsNow` | specific — **added 2026-10-07 (email audit P13)**; replaces the old test-rows recipient string constant (a corporate address in a public repo) |
| FN-406 | `allIssuesRecoveryTargetsGs_(ss, now)` / `allIssuesLateCutoffPassedGs_(now)` (thin wrappers over `GS-015` FN-409) | the workbook, the time | today's FAILED, BLOCKED or PLANNED 17:00 bucket rows `[{emailId, region, bucket, status}]`; whether it is past 18:30 IST | reads `Email_Ledger` | `emailLedgerReadRowsGs_` (`GS-015`) | FN-407 | specific - RULE-056 |
| FN-407 | `recoverFailedAllIssuesBuckets_(opts)` / `recoverFailedAllIssuesBucketsNow()` / `recoverFailedAllIssuesBucketsForceNow()` / `sendAllIssuesEmails_({ onlyEmailIds })` | `{now, force}` | `{targets, cutoff, ran}` | re-runs the 17:00 pipeline for ONLY the targeted buckets (region guard skipped, exclusions and CH-level reports not repeated), closes untargeted-but-missing buckets as SKIPPED; the entry points go through the job lock (job `recoverAllIssuesBuckets`, alerts held) | `sendAllIssuesEmails_`, `withEmailJobLockGs_` (`GS-004`) | the Apps Script editor (manual) | specific - RULE-056 |

## Business rules implemented - `RULE-XXX` sub-table

| ID | Rule | Where | Duplicated elsewhere? |
|---|---|---|---|
| RULE-056 | A failed 17:00 bucket can be re-sent the same IST day, until 18:30 IST (decision D5), by `recoverFailedAllIssuesBucketsNow()`: only buckets the ledger shows FAILED, BLOCKED or still PLANNED (the run died before reaching them) (never ATTEMPTING or UNCONFIRMED - it may have been delivered; never ACCEPTED), everything re-checked from the CURRENT data, siblings in the region untouched; a bucket whose leads are resolved or whose routing changed is closed as SKIPPED with the reason; after 18:30 nothing is sent late (`...ForceNow` overrides on purpose) | FN-406, FN-407 | `docs/_planning/EMAIL_OPS_SYSTEM_AUDIT.md` D3, D5 |

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

## Failure / error behaviour

Per-region isolation — one region's send failing does not abort the run.
Transient failures retry via `withSendRetry_`; persistent ones raise an
ops alert. A failure shows as **Failed** in Apps Script Executions only
if it escapes all retries.

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

**2026-10-09** (`0811d3a`, Email Ops, decision D6): `sendAllIssuesEmails_` judges the Leads tab's freshness once per run from the rows it already read (`staleLeadsNoticeFromRowsGs_`, `GS-004` FN-408) and, when the tab is RED, a RED Leads tab (newest lead assigned at least 24 h ago) now adds a separate **"Data freshness notice"** section at the very bottom of every email (17:00 bucket and CH-level, 10:00 combined and CH-level, 13:00 reply) - the lead tables above stay complete and **no email is ever held** for it (user decision D6, 2026-10-09). The section is carried in the per-bucket context (so the quarantine-and-resend keeps it) and passed to `notifyChLevelIssuesGs_`; the recovery job re-judges the tab at its own send time. Nothing is held. **Not live until pasted.**

**2026-10-09** (`0213c9f`, Email Ops EO-9b): the recovery's target reader, cutoff test and driver are now the shared `GS-015` FN-409 (this file keeps its wrappers and its own cutoff constants, CFG-116); buckets left PLANNED by a run that died are targets too (`GS-015` RULE-058). **Not live until pasted.**

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
