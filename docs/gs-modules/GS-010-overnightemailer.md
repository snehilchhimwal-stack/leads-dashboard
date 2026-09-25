# GS-010 — OvernightEmailer.gs

| | |
|---|---|
| **Type** | `GS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `OvernightEmailer.gs` (2074 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-25 against commit `684956b` — single Futwork email across regions (see `## Version / change reference`) |

## Purpose / reason to exist

The unattended daily overnight-lead email, per region, at 10:00 IST —
plus a 13:00 IST same-thread follow-up showing which of the morning's
flagged leads got resolved. It exists so a regional head starts the day
with the overnight cohort's state even if nobody opened the dashboard,
and gets a mid-day nudge on what's still open. It is the scheduled
counterpart of the Movement tab's on-demand "Generate Region Emails"
cycle (`TAB-007`), and it writes into the same `Lead_Followups` bridge
for human review of the algorithmic follow-up suggestions.

**Since 2026-09-23** (two-checkpoint email lifecycle redesign,
`docs/_planning/EMAIL_LIFECYCLE_TWO_CHECKPOINT_REDESIGN.md`, goal
`g-tf-fc7cc3383b`): the 10:00 email is no longer Overnight-only. It's now
a COMBINED send — Section 1 is the Overnight content above, unchanged;
Section 2 is "Checkpoint 1" of yesterday's 17:00 `AllIssues_Log` report
(`GS-001`), comparing that snapshot against the live sheet right now via
`computeAllIssuesCheckpointGs_` (`GS-012`). `sendOneOvernightEmail_`
itself is untouched and still works standalone; the new
`sendCombinedMorningEmail_` composes around it rather than replacing it.

**Step 7/11** (same redesign, same day): the 13:00 follow-up is now
ALSO combined. Section 1 is the existing "still unresolved from this
morning" content, unchanged logic; Section 2 is "Checkpoint 2" —
this morning's own Checkpoint 1 result (`checkpoint1_json`, read back
from `AllIssues_Log`) compared against the live sheet again via the
SAME `computeAllIssuesCheckpointGs_` called a second time, then
filtered down to what's actually news via
`filterAllIssuesCheckpoint2ForEmailGs_` (`GS-012` FN-271). Both
sections reply into the ONE thread `Overnight_Log` already stored that
morning — Checkpoint 2's own bucket set is always a SUBSET of that
thread list (never an independent union the way the 10:00 job needed),
because `sendCombinedMorningEmail_` always logs an `Overnight_Log` row
for any bucket it sets `checkpoint1_json` on, in that same call.

**Step 8/11** (same day): a real gap found while auditing idempotency
across all three daily jobs — Section 2 (Checkpoint 2) was already
guarded against a duplicate resend (`AllIssues_Log`'s `checkpoint2_sent_at`,
Step 7), but Section 1 (the unresolved-lead follow-up) had NO per-day
guard at all, so a trigger retry or manual re-run resent a duplicate
reply into the same Gmail thread every time. Fixed by adding
`Overnight_Log`'s own `followup_sent_at` column — the idempotency guard
for the WHOLE combined 13:00 reply. The 10:00 job (Section 1 via the
existing region-level `alreadyLoggedRegionsToday`, Section 2 via
`checkpoint1_sent_at`) and the 17:00 job (region-level
`alreadyLoggedRegionsToday` in `AllIssuesEmailer.gs`, covering both the
email and `issue_snapshot_json`) were both already correctly guarded —
confirmed by direct audit, not assumed — so this step's only real code
change is the one new column and its guard.

## Responsibilities

- `sendOvernightMorningEmails` / `_` — the 10:00 per-region email; now
  orchestrates the UNION of today's Overnight buckets and yesterday's
  pending `AllIssues_Log` buckets (by recipient email, not region alone).
- `sendOvernightFollowupEmails` / `_` — the 13:00 same-thread follow-up;
  now ALSO a combined send (Section 1 unresolved-leads + Section 2
  Checkpoint 2) via `sendCombinedFollowupEmail_`.
- `sendCombinedMorningEmail_` — added 2026-09-23: builds and sends the
  two-section 10:00 email for one union bucket; writes back
  `checkpoint1_json`/`checkpoint1_sent_at` to `AllIssues_Log`.
- `buildOvernightSectionOptsGs_` — added 2026-09-23: Section 1's opts,
  extracted from `sendOneOvernightEmail_` so both it and
  `sendCombinedMorningEmail_` share one source of truth.
- `buildAllIssuesCheckpointSectionOptsGs_` / `renderTwoSectionEmailHTML_` /
  `loadYesterdaysAllIssuesBucketsGs_` — added 2026-09-23: Section 2's opts,
  the two-section HTML composer, and the yesterday's-`AllIssues_Log`
  reader, respectively.
- `sendCombinedFollowupEmail_` — added 2026-09-23 (Step 7): builds and
  sends the two-section 13:00 reply for one bucket; writes back
  `checkpoint2_json`/`checkpoint2_sent_at` to `AllIssues_Log`.
- `buildOvernightFollowupSectionOptsGs_` — added 2026-09-23 (Step 7):
  Section 1's opts for the 13:00 reply, extracted from
  `sendOvernightFollowupEmails_`'s own former inline object.
- `loadTodaysCheckpoint1PendingGs_` — added 2026-09-23 (Step 7): reads
  today's Checkpoint-1-done-but-Checkpoint-2-pending `AllIssues_Log`
  rows, keyed by recipient email.
- `ensureOvernightLogSheet_` — extended 2026-09-23 (Step 8): now
  self-heals a missing header column on an existing sheet, same pattern
  `ensureAllIssuesLogSheet_` already used; this sheet had none before.
- `sendThreadedGmailReply_` — a raw Advanced Gmail Service reply (works
  around `GmailThread.reply()` hard-coding the recipient).
- `pushUnresolvedToLeadFollowups_` / `waitForFollowupSuggestions_` — the
  `Lead_Followups` review bridge (polls ~2 min for a human/dashboard
  suggestion before falling back to the keyword engine).
- `overnightWindowGs_` — the overnight window.
- `notifyChLevelLeadsGs_` — the blank-chain CH-level rollup (untouched —
  Section 2 has no equivalent diversion; design doc Part 7).
- `setupOvernightEmailer` — install both triggers (+ calls
  `setupRmHierarchy()`).

## Trigger schedule

`setupOvernightEmailer()` (`#L1889`) installs `sendOvernightMorningEmails`
on `atHour(10).nearMinute(0).everyDays(1)` and
`sendOvernightFollowupEmails` on `atHour(13).nearMinute(0).everyDays(1)`
— **both WITHOUT an explicit `.inTimezone('Asia/Kolkata')`**. This is
the **sole outlier** among every trigger installer in the project — it
relies on the Apps Script project's own timezone setting being IST (a
required manual step, per the file's own setup docs) (`LOGIC_AUDIT.md`
Part 1 §5). `setupOvernightEmailer()` also calls `setupRmHierarchy()`
(`GS-011`) as a side effect.

## Requires `setupXxx()` re-run when

Only when a **schedule** changes (either hour). A change to the email
logic, the window, or the follow-up bridge takes effect on the next
fire. **Also re-run if the Apps Script project timezone is ever
changed** — because these two triggers inherit it rather than pinning
their own.

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-231 | `sendOvernightMorningEmails()` / `_()` `#L858/#L870` | `leads` tab, prior `Overnight_Log`, prior `AllIssues_Log` | one combined email per union bucket (10:00) | Gmail sends; `Overnight_Log` rows; `AllIssues_Log` checkpoint writes; calls the `Lead_Followups` bridge | `readLeadsTab_` (`GS-004`), `computeSlaFlags_` (`GS-012`), `overnightWindowGs_` (FN-234), `loadYesterdaysAllIssuesBucketsGs_` (FN-276), `sendCombinedMorningEmail_` (FN-275), `resolveRecipientEmailsForRegion_` (`GS-004`) | the 10:00 trigger; `sendOvernightMorningEmailsNow()` | specific — scheduled |
| FN-232 | `sendOvernightFollowupEmails()` / `_()` `#L1587/#L1599` | prior day's `Overnight_Log` thread ids; today's Checkpoint-1-pending `AllIssues_Log` rows | a same-thread combined reply per bucket (13:00): Section 1 (still unresolved) + Section 2 (Checkpoint 2) | threaded Gmail replies; `Overnight_Log` `followup_sent_at` write-back (via FN-280, Step 8/11); `AllIssues_Log` `checkpoint2_json`/`checkpoint2_sent_at` write-back (via FN-280) | `sendThreadedGmailReply_` (FN-236), `computeSlaFlags_` (`GS-012`), `formatFollowupAgeGs_` (FN-237), `loadTodaysCheckpoint1PendingGs_` (FN-279), `sendCombinedFollowupEmail_` (FN-280) | the 13:00 trigger; `sendOvernightFollowupEmailsNow()` | specific — scheduled — **Step 8/11: Pass 1 now skips a row outright when `Overnight_Log`'s own `followup_sent_at` is already set — the idempotency guard a trigger retry needs** |
| FN-233 | `sendOneOvernightEmail_(ss, logSheet, region, rec, leads, dateLabel, todayKey, now, win)` `#L375` | one region's data | that region's STANDALONE morning email (still used directly by tests/manual calls) | Gmail send; `Overnight_Log` row | `renderOvernightReportEmailHTML_` (`GS-004`), `buildOvernightSectionOptsGs_` (FN-272), `overnightFollowupHintGs_` (`GS-005`), `withSendRetry_` (`GS-004`) | tests, manual calls — **no longer called by FN-231's own loop**, which now always goes through FN-275 | specific |
| FN-234 | `overnightWindowGs_(asOf)` / `ensureOvernightLogSheet_(ss)` `#L245/#L282` | as-of date | the overnight window `{start, end}`; ensures `Overnight_Log` | may create the tab; **Step 8/11: now self-heals a missing header column on an EXISTING sheet too**, same pattern `ensureAllIssuesLogSheet_` uses (this sheet had no self-healing before) | `istDayKeyGs_` (`GS-002`) | FN-231, FN-232 | specific |
| FN-235 | `pushUnresolvedToLeadFollowups_(ss, entries)` / `waitForFollowupSuggestions_(ss, leadIds)` `#L1148/#L1209` | flagged-lead entries | upserts `Lead_Followups`; **polls up to ~2 minutes for a human/dashboard-generated follow-up suggestion before falling back to the keyword engine** | Sheets write; polling read | `noCommentFollowUpGs_` / `overnightFollowupHintGs_` (`GS-005`) | FN-231 | specific — **the backend side of the same `Lead_Followups` bridge the client's Generate cycle writes into** (`JS-016` / `JS-018`); already idempotent by construction (upsert by `lead_id`, never appends a duplicate row — confirmed during the Step 8/11 idempotency audit, no code change needed here) |
| FN-236 | `sendThreadedGmailReply_(threadId, to, cc, subject, plainBody, htmlBody)` `#L1279` | a thread id + content | a reply on that Gmail thread | raw **Advanced Gmail Service** call | — | FN-232, FN-280, `backfillTodaysOvernightLogRecipientsNow` | specific — uses the raw API because `GmailThread.reply()`/`replyAll()` hard-code the recipient to "sender of the last message" (a real production bug this works around) |
| FN-237 | `formatFollowupAgeGs_(updatedAt, now)` / `overnightStatusLabelGs_` (in `GS-005`) `#L1241` | a timestamp | a human age string | none | — | FN-232 | reusable |
| FN-238 | `notifyChLevelLeadsGs_(region, chLevelRms, rmToLeads, dateLabel)` `#L134` | CH-level RMs + leads | a CH-level rollup email | Gmail send | `groupLeadsByRmAndFlatten_` (`GS-004`) | FN-231 | specific — called from inside `resolveRecipientEmailsForRegion_` (`GS-004` FN-…, `fireAlerts:true`), itself only reached from FN-231's `alreadyLoggedRegionsToday`-guarded branch — confirmed already idempotent during the Step 8/11 audit |
| FN-239 | `setupOvernightEmailer()` `#L1889` | — | installs the 10:00 + 13:00 triggers; **also calls `setupRmHierarchy()`** | creates triggers; runs `GS-011` setup | `ScriptApp`, `setupRmHierarchy` (`GS-011`) | Apps Script editor (manual) | specific |
| FN-272 | `buildOvernightSectionOptsGs_(region, leads, dateLabel, win)` `#L337` | a bucket's leads | Section 1's full `renderOvernightReportEmailHTML_` opts | none (pure) | — | FN-233, FN-275 | reusable — **extracted 2026-09-23 so a standalone overnight email and Section 1 of the combined email share one source of truth** |
| FN-273 | `buildAllIssuesCheckpointSectionOptsGs_(region, checkpointLabel, originalDateLabel, snapshotEntries, checkpointResults)` `#L538` | the 17:00 snapshot + a checkpoint's comparison results | Section 2's full `renderOvernightReportEmailHTML_` opts, grouped by RM | none (pure) | `allIssuesCheckpointStateLabelGs_` `#L516` (private helper, same file) | FN-275, FN-280 | reusable — **joins `computeAllIssuesCheckpointGs_`'s output (`GS-012` FN-270, no RM/TL) back to the original snapshot entries (which have RM/TL) by `lead_id`; reused UNCHANGED for Checkpoint 2 (Step 7), just a different `checkpointLabel`/`checkpointResults`** |
| FN-274 | `renderTwoSectionEmailHTML_(section1Opts, section2Opts)` `#L600` | both sections' opts | the combined email HTML — two full `renderOvernightReportEmailHTML_` renders concatenated with a labeled divider | none (pure) | `renderOvernightReportEmailHTML_` (`GS-004`) ×2 | FN-275, FN-280 | reusable — **deliberately does NOT modify `renderOvernightReportEmailHTML_`'s own signature** (design doc Part 8: "wrap, don't modify" — that function also backs every `GS-001` single-section email) |
| FN-275 | `sendCombinedMorningEmail_(ss, overnightLogSheet, allIssuesLogSheet, region, section1, section2, dateLabel, todayKey, now, win, baselineMap, section1SkippedReason)` `#L674` | one union bucket's Section 1/2 inputs | the combined 10:00 email | Gmail send; `Overnight_Log` row (if Section 1 sent); `AllIssues_Log` `checkpoint1_json`/`checkpoint1_sent_at` write-back (if Section 2 present, even on send failure — see its own comment on why that differs from Section 1's choice) | `buildOvernightSectionOptsGs_`/`buildOvernightSectionEmptyStateOptsGs_`/`buildAllIssuesCheckpointSectionOptsGs_`/`buildAllIssuesCheckpointEmptyStateOptsGs_`/`renderTwoSectionEmailHTML_` (all same file), `computeAllIssuesCheckpointGs_` (`GS-012` FN-270), `withSendRetry_`/`notifyOpsAlertGs_` (`GS-004`) | FN-231 | specific |
| FN-276 | `loadYesterdaysAllIssuesBucketsGs_(ss, now)` `#L621` | spreadsheet + now | `{region -> [{rowNumber, to, cc, bucketLabel, primaryRole, snapshotEntries}]}` for yesterday's un-checkpointed `AllIssues_Log` rows | reads `AllIssues_Log` (`GS-001`/`SHEET-013`) | `ensureAllIssuesLogSheet_` (`GS-001`), `istDayKeyGs_` (`GS-002`) | FN-231 | specific — **the idempotency check for Section 2 (`checkpoint1_sent_at` blank)** |
| FN-277 | `buildOvernightFollowupSectionOptsGs_(region, unresolvedRows)` `#L1377` | this morning's still-unresolved rows | Section 1's full `renderOvernightReportEmailHTML_` opts for the 13:00 reply | none (pure) | — | FN-280 | reusable — **added 2026-09-23 (Step 7), extracted from `sendOvernightFollowupEmails_`'s own former inline object, same pattern as FN-272** |
| FN-278 | `buildOvernightFollowupSectionEmptyStateOptsGs_(region, reasonText)` `#L1401` | a reason string | Section 1's empty-state opts (nothing still unresolved) | none (pure) | — | FN-280 | reusable — same shape/role as its 10:00 sibling `buildOvernightSectionEmptyStateOptsGs_` `#L496` |
| FN-279 | `loadTodaysCheckpoint1PendingGs_(ss, now)` `#L1418` | spreadsheet + now | `{lowercasedEmail -> {rowNumbers, to, cc, bucketLabel, primaryRole, snapshotEntries, checkpoint1Entries}}` for today's Checkpoint-1-done-but-Checkpoint-2-pending `AllIssues_Log` rows | reads `AllIssues_Log` (`GS-001`/`SHEET-013`) | `ensureAllIssuesLogSheet_` (`GS-001`), `istDayKeyGs_` (`GS-002`) | FN-232 | specific — **the idempotency check for Checkpoint 2 (`checkpoint2_sent_at` blank); keyed by EMAIL directly, not region-then-email like FN-276, since the caller (FN-232's own `perRegion`) already has one entry per recipient** |
| FN-280 | `sendCombinedFollowupEmail_(ss, overnightLogSheet, overnightLogRowNumber, allIssuesLogSheet, region, threadId, sendTo, sendCc, subject, testModeBanner, section1UnresolvedRows, section2Input, now, baselineMap)` `#L1476` | one bucket's Section 1/2 inputs + its `Overnight_Log` row number | the combined 13:00 reply | threaded Gmail reply (with plain-fallback); `Overnight_Log` `followup_sent_at` write-back (**success ONLY** — Step 8/11, so a total failure stays retryable on the next run); `AllIssues_Log` `checkpoint2_json`/`checkpoint2_sent_at` write-back (even on total send failure — same reasoning `GS-012`'s comment on `computeAllIssuesCheckpointGs_` gives, and FN-275's own Checkpoint 1 write, since an un-checkpointed row silently falls out of FN-279's own "today" scope once the day rolls over — a DIFFERENT tradeoff from `followup_sent_at`'s, see this function's own comment on why) | `buildOvernightFollowupSectionOptsGs_`/`buildOvernightFollowupSectionEmptyStateOptsGs_`/`buildAllIssuesCheckpointSectionOptsGs_`/`buildAllIssuesCheckpointEmptyStateOptsGs_`/`renderTwoSectionEmailHTML_` (all same file), `computeAllIssuesCheckpointGs_` (`GS-012` FN-270), `filterAllIssuesCheckpoint2ForEmailGs_` (`GS-012` FN-271), `sendThreadedGmailReply_` (FN-236), `withSendRetry_`/`notifyOpsAlertGs_` (`GS-004`) | FN-232 | specific — **unlike FN-275, no separate "resolve recipient" step — both sections' routing is already frozen (Section 1 from `Overnight_Log`, Section 2 from `AllIssues_Log`), never re-derived here** |

## Config constants — `CFG-XXX` sub-table

| ID | Constant | Value | Meaning | Changing it affects |
|---|---|---|---|---|
| CFG-051 | morning / follow-up hours | `10` / `13` | the two send hours | the trigger schedule — **requires `setupOvernightEmailer()` re-run** |
| CFG-052 | follow-up-suggestion poll budget | ~2 minutes | how long `waitForFollowupSuggestions_` waits for a human/dashboard suggestion before the keyword-engine fallback | overlap window with the client Generate cycle (`LOGIC_AUDIT.md` Part 7 §18 MEDIUM #3) |
| CFG-053 | *(no `.inTimezone()`)* | — | these triggers inherit the Apps Script project timezone | **the sole project outlier** — every other trigger pins `Asia/Kolkata` explicitly (`LOGIC_AUDIT.md` Part 1 §5) |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-079 | Apps Script project timezone not set to IST | **no guard** — the 10:00/13:00 triggers fire at the project's timezone hour, not IST | emails go out at the wrong wall-clock time; the one trigger-config footgun in the project |
| EXC-080 | `GmailThread.reply()` would send to the wrong recipient | `sendThreadedGmailReply_` uses the raw Advanced Gmail Service instead | the 13:00 follow-up reaches the intended region recipients |
| EXC-081 | no human/dashboard follow-up suggestion arrives within ~2 min | `waitForFollowupSuggestions_` falls back to the keyword engine (`GS-005`) | the email uses the algorithmic suggestion, clearly the fallback |
| EXC-082 | client Generate cycle writes `Lead_Followups` at the same time | **not guarded across runtimes** (`LOGIC_AUDIT.md` Part 7 §18 MEDIUM #3) | a possible overlap-window clobber |
| EXC-083 | `RmHierarchy.private.gs` absent → resolved emails `''` | routing degrades to `Region_Recipients` / `CH_LEVEL_EMAIL_` | email still sends, to the fallback (`GS-011`) |

## Data lineage

`leads` tab (`SHEET-001`) → `overnightWindowGs_` filter → `computeSlaFlags_`
(`GS-012`) → per-region grouping (`GS-004`) → `renderOvernightReportEmailHTML_`
(`GS-004`) → Gmail (10:00). Flagged leads → `pushUnresolvedToLeadFollowups_`
→ `Lead_Followups` (`SHEET-004`) col A–E,G; a human edits col F in the
sheet or the dashboard's Generate cycle fills it → `waitForFollowupSuggestions_`
picks it up → the email uses it. `Overnight_Log` (`SHEET`, TBD id)
records thread ids for the 13:00 reply. Full flow: `DATA-005` +
`DATA-003`.

## Sheets touched

| `SHEET-XXX` | Read / Write | Which `FN-XXX` | Notes |
|---|---|---|---|
| `SHEET-001` `leads` | Read | FN-231 | source |
| `SHEET-004` `Lead_Followups` | Write (upsert A–E,G) + poll-read col F | FN-235 | shares the bridge + `_generateCycleOwner`-style contention with the client (`JS-018`) |
| `SHEET-014` `Overnight_Log` | Write (append) + ensure (self-healing header as of Step 8/11) + Read (`followup_sent_at`, col I) | FN-233 / FN-234 / FN-275 (write); FN-232 (read); FN-280 (write `followup_sent_at`, success only, Step 8/11) | thread ids for the 13:00 reply; `followup_sent_at` is the 13:00 job's own per-day idempotency guard, added 2026-09-23 |
| `SHEET-006` `RM_Hierarchy` / `SHEET-007` `Manager_Directory` / `SHEET-012` `Region_Recipients` | Read | FN-231 (via `GS-004` / `GS-011`) | routing |
| `SHEET-013` `AllIssues_Log` | Read (`GS-001`'s own 17:00 rows; also `checkpoint1_json`, col K) + Write (`checkpoint1_json`/`checkpoint1_sent_at` cols K/L; `checkpoint2_json`/`checkpoint2_sent_at` cols M/N) | FN-276 / FN-275 (Checkpoint 1); FN-279 / FN-280 (Checkpoint 2, added 2026-09-23 Step 7) | Checkpoint 1/2's own state; routing (`to`/`cc`) is read from this table's STORED values, never re-resolved (design doc Part 7) |

## Failure / error behaviour

Per-region isolation; `withSendRetry_` absorbs transient send failures;
persistent failures raise + ops-alert. The timezone footgun (EXC-079)
and the cross-runtime `Lead_Followups` overlap (EXC-082) are the two
known unguarded risks.

## Cross-runtime duplication

Uses `computeSlaFlags_` (`GS-012`, twin of `enrichLead` `JS-006`),
`mainRegionForGs_` (`GS-004`, twin of `mainRegionFor` `JS-014`), and the
`FollowupEngine.gs` classifier (`GS-005`, twin of `JS-007`). **The
Loan-region `effectiveRegion` override is missing here** — one of the 3
scheduled-email call sites in `LOGIC_AUDIT.md` Part 4 §4.4 / Part 7 §18
HIGH. The `Lead_Followups` review bridge parallels the client's 3-phase
Generate cycle (`JS-016`).

## Not live until pasted

Not running until pasted into the Sheet's Apps Script editor. Re-run
`setupOvernightEmailer()` when a send hour changes **or when the Apps
Script project timezone changes** (these triggers inherit it).

## UI relationships

N/A — backend. `TAB-007`'s "Generate Region Emails" is the on-demand
human counterpart, sharing the `Lead_Followups` bridge.

## Architecture relationship

Apps Script backend. Layer 17 (backend automation) in `LOGIC_AUDIT.md`
Part 1 §1.

## Related documentation

`HANDOVER.md` §2, §4.3, §8; `LEAD_FOLLOWUPS_STALENESS.md`;
`OPS_CHECKLIST.md`; `LOGIC_AUDIT.md` Part 1 §4d/§5, Part 3 §3.9, Part 4
§4.4, Part 7 §18 HIGH / MEDIUM #3; `CLAUDE.md`.

## Relationships

- **Depends On:** `GS-001` (`AllIssuesEmailer.gs` — `ensureAllIssuesLogSheet_`,
  `ALL_ISSUES_LOG_SHEET_`, added 2026-09-23 for Section 2), `GS-002`
  (`Core.gs`), `GS-004` (`EmailInfra.gs`), `GS-005` (`FollowupEngine.gs`),
  `GS-008` (`MovementTracker.gs` maps), `GS-011` (`RmHierarchy.gs` —
  routing + `setupRmHierarchy()` side-call), `GS-012` (`SlaEngine.gs` —
  `computeAllIssuesCheckpointGs_`, added 2026-09-23), `SHEET-001`,
  `SHEET-002`, `SHEET-004`, `SHEET-006`, `SHEET-007`, `SHEET-012`,
  `SHEET-013`, `SHEET-014`, `EXT-002` (incl. Advanced Gmail Service),
  `DATA-002`
- **Used By:** `SHEET-004`, `SHEET-013` (added 2026-09-23 — checkpoint write-back), `SHEET-014`, `DATA-003`
- **Related:** `TAB-007` / `JS-016` / `JS-018` (the on-demand
  equivalent, shared `Lead_Followups` bridge), `GS-001`
  (`AllIssuesEmailer.gs` — the other scheduled emailer), `JS-014` (the
  client report builder it parallels)

## Source of truth

`OvernightEmailer.gs` at `HEAD`.

## Validation

- **Method:** full read at `c82ec67`; function list verified by grep;
  the **no-`.inTimezone()` outlier** and the 10:00/13:00 hours read
  directly from `setupOvernightEmailer()` (`#L1214`), cross-checked
  against `LOGIC_AUDIT.md` Part 1 §5. `Tests_OvernightEmailer.gs` runs
  in CI.
- **Evidence:** `.github/workflows/test.yml` (`Tests_OvernightEmailer.gs`,
  last green run); `LOGIC_AUDIT.md` Part 1 §5, Part 3 §3.9.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-029. File grew 1374L →
1409L since the 2026-09-05 audit.

**Revalidated 2026-09-23** `c7e22ae`: Step 6/11 of the
two-checkpoint email lifecycle redesign
(`docs/_planning/EMAIL_LIFECYCLE_TWO_CHECKPOINT_REDESIGN.md`, goal
`g-tf-fc7cc3383b`) — `sendOvernightMorningEmails_` now unions today's
Overnight buckets with yesterday's pending `AllIssues_Log` buckets (by
recipient email) and sends ONE combined email per bucket via the new
`sendCombinedMorningEmail_` (FN-275), instead of calling
`sendOneOvernightEmail_` (FN-233) directly — that function itself is
UNCHANGED and still works standalone (tests/manual calls only, no
longer in FN-231's own send path). File grew 1409L → 1789L (+380,
8 new functions: FN-272–276 plus 3 unnumbered private helpers — see
each's own docstring for why). Every `#Lnn` citation in this record
re-grepped and corrected against the real current file, not
assumed/offset-guessed given the number and size of insertions.
`Tests_OvernightEmailer.gs` gained a dedicated block: two new union
scenarios (a region whose Section 1 already sent separately today, and
a brand-new region with Section 2 content but zero overnight leads),
the checkpoint1_json/checkpoint1_sent_at write-back, and idempotency
across a third run. 831/831 local .gs tests pass (+17 new).

**Revalidated 2026-09-23** `c8c5976`: follow-up fix, found while
planning Step 7 — `sendCombinedMorningEmail_`'s `Overnight_Log` write
now fires on ANY successful combined send, not just when Section 1 had
real content. The original Step 6 version only logged when `section1`
was truthy, which left a Section-2-only bucket (real Checkpoint 1
content, zero overnight leads that day) with no thread reference at
all — breaking the design's own "one Gmail thread per bucket per day"
principle (Part 7) for Checkpoint 2's 13:00 reply. File grew 1789L →
1800L; every `#Lnn` citation in this record re-grepped and corrected
again (a genuinely tedious but necessary consequence of a growing file
with heavily-referenced line numbers — `test/whatis.py`-style tooling
for this specific pain is worth considering if it recurs much more).
`Tests_OvernightEmailer.gs` gained 1 new assertion confirming the
Harbour (Section-2-only) bucket now gets an `Overnight_Log` row with a
correctly-empty `issueLog`. 833/833 local .gs tests pass (+2 new).

**Revalidated 2026-09-23** `7aa9786`: Step 7/11 — the 13:00
follow-up (`sendOvernightFollowupEmails_`, FN-232) is now ALSO a
combined send, same shape as the 10:00 job: Section 1 (unresolved leads,
unchanged logic) + Section 2 (Checkpoint 2, new). Added
`buildOvernightFollowupSectionOptsGs_`/`buildOvernightFollowupSectionEmptyStateOptsGs_`
(FN-277/278, Section 1's opts, extracted from Pass 2's own former inline
object), `loadTodaysCheckpoint1PendingGs_` (FN-279, today's
Checkpoint-1-pending `AllIssues_Log` rows by recipient email), and
`sendCombinedFollowupEmail_` (FN-280, the actual send + `checkpoint2_json`/
`checkpoint2_sent_at` write-back) — reusing `buildAllIssuesCheckpointSectionOptsGs_`/
`buildAllIssuesCheckpointEmptyStateOptsGs_`/`renderTwoSectionEmailHTML_`
(FN-273/274) UNCHANGED, and `computeAllIssuesCheckpointGs_`/
`filterAllIssuesCheckpoint2ForEmailGs_` (`GS-012` FN-270/271) exactly as
designed for this second checkpoint. Unlike Step 6, Checkpoint 2's own
bucket set never needed an independent union — it's always a SUBSET of
`sendOvernightFollowupEmails_`'s own `perRegion` (every bucket
`sendCombinedMorningEmail_` sets `checkpoint1_json` on ALSO gets an
`Overnight_Log` row for the same recipient, in that same call, per the
Step 6 follow-up fix above) — so Pass 2 just augments its existing loop
with a lookup instead.

A real gap was found and fixed WHILE building this: Pass 1's original
`if (!issueLog.length) return;` skipped pushing a row to `perRegion`
entirely whenever `Overnight_Log`'s own issueLog was empty — exactly the
shape a Section-2-only 10:00 bucket produces (the Harbour case above).
Left as-is, Checkpoint 2 would have had no thread to reply into for any
such bucket, silently losing it every time — the very case the Step 6
follow-up fix was meant to enable. Fixed by removing that early return
(the loop body is already a no-op on an empty `issueLog`, so nothing
else needed to change). File grew 1800L → 1959L (+159, 4 new functions:
FN-277–280). Every `#Lnn` citation in this record re-grepped and
corrected. `Tests_OvernightEmailer.gs` gained 2 new scenarios: a bucket
with real content in BOTH sections (same thread, one combined reply,
`checkpoint2_json` persisted matches what the email showed), and a
dedicated Section-2-only regression test for the `perRegion` fix above
(decodes the threaded reply's raw MIME via a new `TestOE_decodeRawMime_`
helper, since `TestMockGmailAdvanced_` only stores the raw base64
payload, not a separate `htmlBody` field the way drafts/sent do).
847/847 local .gs tests pass (+14 new). Note: a re-run of
`sendOvernightFollowupEmails()` the same day is NOT idempotent for
Section 1 specifically (a still-unresolved lead is resent every run,
by design — no per-day-once guard exists for it) — that gap is real
but explicitly out of this step's scope, tracked as Step 8/11's job.

**Revalidated 2026-09-23** `4df2dd7`: Step 8/11 — idempotency
across all three daily jobs. Direct audit (not assumed) confirmed the
10:00 job (Section 1 via the existing region-level
`alreadyLoggedRegionsToday`, Section 2 via `checkpoint1_sent_at`, both
including their own CH-level diversions — those are called from inside
`resolveRecipientEmailsForRegion_`'s `fireAlerts:true` path, itself only
reached from the SAME guarded branch) and the 17:00 job
(`AllIssuesEmailer.gs`'s own `alreadyLoggedRegionsToday`, covering the
email, `issue_snapshot_json`, and its own CH-level diversion the same
way) were already correctly guarded. `Lead_Followups` (`pushUnresolvedToLeadFollowups_`)
is idempotent by construction — an upsert by `lead_id` can never create
a duplicate row, so a re-run just re-writes the same (or updated) value,
never duplicates.

The one real, confirmed gap: the 13:00 job's own Section 1
(unresolved-lead follow-up) had NO per-day guard at all — a trigger
retry or manual re-run always resent a duplicate reply into the same
Gmail thread for every still-unresolved lead (the exact gap flagged in
Step 7's own revalidation note above). Fixed by adding `Overnight_Log`'s
own `followup_sent_at` column (col I) — `ensureOvernightLogSheet_`
gained a self-healing header (append-missing-columns, mirroring
`ensureAllIssuesLogSheet_`'s pattern; this sheet had none before), Pass
1 (`sendOvernightFollowupEmails_`) now captures each row's real sheet
row number and skips a row outright when `followup_sent_at` is already
set, and `sendCombinedFollowupEmail_` (FN-280) writes it back —
deliberately **success-only** (unlike `AllIssues_Log`'s checkpoint
columns, which are written even on failure for a different reason — see
that function's own comment) so a failed send stays retryable on the
next run instead of being permanently marked done.

This one new column is a deliberate, documented deviation from
`docs/_planning/EMAIL_LIFECYCLE_TWO_CHECKPOINT_REDESIGN.md` Part 5's
original "`Overnight_Log` gets no new columns" statement — refined, not
violated: that statement was about not letting Chain B (checkpoint)
CONTENT leak into `Overnight_Log`, and `followup_sent_at` carries none —
it is a Chain-A-internal idempotency flag Section 1's own classification
logic is entirely unaware of. `Overnight_Log` already gained columns
once before this redesign (`to`/`cc`/`subject`, the recipient-storing
fix) for the exact same kind of Chain-A-only operational reason. Full
reasoning in that doc's own Part 5/Part 9 notes. File grew 1959L →
2032L (+73). Every `#Lnn` citation in this record re-grepped and
corrected. `Tests_OvernightEmailer.gs` gained 12 new assertions:
`ensureOvernightLogSheet_`'s self-healing (fresh sheet has the column;
an existing 8-column sheet gets healed to 9; healing twice doesn't
duplicate); the same-bucket-both-sections scenario now also asserts
`followup_sent_at` gets written and that a genuine re-run sends nothing
new; the Section-2-only scenario gained the same `followup_sent_at`
assertion; and two new scenarios cover a total send failure (both the
threaded reply and the plain fallback fail) leaving `followup_sent_at`
blank, followed by a real retry once Gmail works again. 859/859 local
`.gs` tests pass (+12 new).

**Revalidated 2026-09-23** `e119115`: Step 9/11 — failure and
edge-case audit across the full two-checkpoint cycle. Full reasoning
for every scenario checked (job failures, Gmail unavailable, hierarchy
unresolved, manager changes mid-cycle, a lead crossing 48h, CH-level
diversion, empty populations, duplicate execution) lives in
`docs/_planning/EMAIL_LIFECYCLE_TWO_CHECKPOINT_REDESIGN.md` Parts 10/11
— most were already correctly handled by pre-existing or Step 6-8 code,
confirmed by direct audit rather than assumed.

The one real, NEW gap this audit found: the checkpoint/log write-backs
added in Steps 6-8 — `sendCombinedMorningEmail_`'s `Overnight_Log`
append and `checkpoint1_json` write (FN-275), `sendCombinedFollowupEmail_`'s
`checkpoint2_json` and `followup_sent_at` writes (FN-280) — were NOT
wrapped in their own try/catch, unlike the established precedent
`sendOneAllIssuesEmail_` (`GS-001` FN-176) already set for this exact
shape of write. An uncaught failure on any ONE bucket's write (most
plausibly an oversized JSON blob past Sheets' ~50,000-char cell limit
on a very large bucket, but any Sheets error qualifies) would have
propagated out and aborted the caller's per-bucket loop entirely,
silently skipping every OTHER region/bucket still left to process that
run — even though each of those emails had already sent successfully
and had nothing wrong with them. Fixed by wrapping all 4 write sites in
their own try/catch, matching `sendOneAllIssuesEmail_`'s exact pattern:
log and continue, never let a logging/tracking failure take down sends
that already succeeded. File grew 2032L → 2074L (+42). Every `#Lnn`
citation in this record re-grepped and corrected (the historical
`## Validation` citation at `#L1214`, tied to commit `c82ec67`,
deliberately left as-is — a snapshot of what was true then, not a
current-state claim). `Tests_OvernightEmailer.gs` gained 6 new
assertions: direct calls to `sendCombinedMorningEmail_`/
`sendCombinedFollowupEmail_` with a deliberately-throwing
`Overnight_Log` write, confirming the email/reply still sends and the
function returns normally instead of propagating the exception. Also
confirmed (documented, not fixed — a genuine structural redesign, not
an edge case): CH-level-diverted leads (`notifyChLevelIssuesGs_`,
`GS-001`) get no Checkpoint 1/2 follow-up at all, since they never
enter `AllIssues_Log` — see the design doc's own Part 7 note for the
full reasoning on why every CH currently sharing the same fixed `to`
makes this incompatible with the "union by recipient email" pattern
without a real redesign. 865/865 local `.gs` tests pass (+6 new).

**Revalidated 2026-09-23** `f1a2519`: Step 10/11 (test-coverage
half — the live `TEST_MODE_OVERRIDE_EMAIL_` verification is tracked
separately, see the task's own record). Added
`Tests_EmailLifecycleFullCycle.gs` — a new, dedicated test file
(registered in `Tests_RunAll.gs`'s `suites` array and
`test/run-gs-tests.js`'s `TEST_FILES` list; no matching production
`.gs` file, by design — it tests the INTEGRATION of `GS-001` +
`GS-010`, not a new module) that chains REAL calls to
`sendAllIssuesEmails()` (17:00), `sendOvernightMorningEmails()` (10:00),
and `sendOvernightFollowupEmails()` (13:00) against ONE shared mock
spreadsheet, for the first time letting each job's own real code produce
the state the next job reads, rather than hand-constructing an
`AllIssues_Log`/`Overnight_Log` fixture row the way every earlier
single-file test necessarily did. Proves the real 17:00 writer
(`sendOneAllIssuesEmail_`) and the real 10:00/13:00 readers
(`loadYesterdaysAllIssuesBucketsGs_`/`loadTodaysCheckpoint1PendingGs_`)
actually agree on `AllIssues_Log`'s column shape end to end — including
a full second pass of all 3 real jobs the same day proving every
idempotency guard (`alreadyLoggedRegionsToday` ×2,
`checkpoint1_sent_at`, `checkpoint2_sent_at`, `followup_sent_at`) holds
together, not just individually. 898/898 local `.gs` tests pass (+33
new, all in the one new file).

**Deployed live 2026-09-24**: Step 10/11's own live verification —
pasted into the Sheet's Apps Script editor (full-file replace, verified
byte-for-byte via the editor's own Monaco model length against the
local file before saving — `git`'s own commit history is NOT what runs
live, per this project's own standing gotcha). `TEST_MODE_OVERRIDE_EMAIL_`
set temporarily, then `sendAllIssuesEmails`/`sendOvernightMorningEmails`/
`sendOvernightFollowupEmails` each run for real against the live
spreadsheet and confirmed clean (0 errors across all three; `sendAllIssuesEmails`
sent 28 real bucket emails, correctly redirected). Real production state
at the time meant Section 1 (Overnight) was already sent earlier that
day for every region (confirmed the `alreadyLoggedRegionsToday` skip
path firing correctly on real data) and there was no "yesterday" `AllIssues_Log`
row to exercise Checkpoint 1/2 against live (a separate finding: no
`AllIssues_Log` rows existed dated the day before this deployment at
all — the real 17:00 job does not appear to have run recently; flagged
to the user as its own follow-up, not fixed here). `TEST_MODE_OVERRIDE_EMAIL_`
reverted to `''` and confirmed persisted via a fresh page reload before
ending the session.

**2026-09-25** (`57e5545`): TEST MODE hardening — the `Overnight_Log` append, checkpoint1/2 write-backs and `followup_sent_at` all go through `writeUnlessTestModeGs_`; `sendCombinedMorningEmail_` sends a Section-2-only bucket to the tester (not the stored 17:00 recipient) and tags the subject `[TEST MODE]`; Section 1 buckets are keyed by `originalTo` so TEST MODE keeps the same per-recipient structure as production; the region + `followup_sent_at` guards are bypassed in TEST MODE; `notifyChLevelLeadsGs_` sends to `chLevelReportToGs_()`. +3 lines (2074L → 2077L, anchors re-mapped). Full incident narrative + the helper functions are in `GS-004`'s Version/change reference (`FN-283`/`FN-284`).

**2026-09-25, later** (`684956b`): single Futwork email across regions — the 10:00 grouping and Section 1/Section 2/13:00 builders (`buildOvernightSectionOptsGs_`, `buildAllIssuesCheckpointSectionOptsGs_`, `buildOvernightFollowupSectionOptsGs_`) render the Futwork group region-by-region with bands and every region spelled out; `sendCombinedMorningEmail_`'s subject spells the regions out; `loadYesterdaysAllIssuesBucketsGs_` re-keys legacy per-region Futwork rows into the single group (stamping each entry's real region) and both Section-2 merges (`section2ByEmail`, `loadTodaysCheckpoint1PendingGs_`) are de-duplicated by `lead_id`; the 13:00 unresolved rows carry the lead's real region. Full narrative and the helper functions are in `GS-004`'s Version/change reference (`FN-290`..`FN-294`, `CFG-068`).

## Revalidation trigger

Any commit touching `OvernightEmailer.gs` or `Tests_OvernightEmailer.gs`;
either send hour changes (needs the setup re-run); **the Apps Script
project timezone changes** (needs the setup re-run — these triggers
inherit it); the `Lead_Followups` bridge contract changes (update
`LEAD_FOLLOWUPS_STALENESS.md`); `computeSlaFlags_` (`GS-012`) changes;
the Loan-region HIGH finding is addressed here.

## Handover relationship

`HANDOVER.md` §2 names the file ("10:00 IST daily region email … + 13:00
IST same-thread follow-up"); §4.3 covers the trigger setup; §8 has
email-timing incidents. Current as of 2026-09-09. A schedule/timezone or
bridge change must update `HANDOVER.md` §2/§4.3 and
`LEAD_FOLLOWUPS_STALENESS.md`, and run `OPS_CHECKLIST.md`'s email items.

## Lifecycle / retention

N/A — code. `Overnight_Log` retention: `TBD` (DOC-036).

## Next action

The no-`.inTimezone()` outlier (EXC-079) and the Loan-region HIGH
finding are known — tracked via the revalidation trigger, not this
record's to fix.

## Closure evidence

Record committed for DOC-029; `docs/INDEX.md` `GS-010` → `Closed +
Monitored`, `Last Verified` 2026-09-10, links + the two-trigger schedule
(and the timezone outlier) recorded; `CFG-051`..`053`, `EXC-079`..`083`.
No `docs/changes/` record (DOC-029).
