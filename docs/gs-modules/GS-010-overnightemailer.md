# GS-010 — OvernightEmailer.gs

| | |
|---|---|
| **Type** | `GS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `OvernightEmailer.gs` (1800 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-23 against commit `c8c5976` — Step 6 follow-up fix (see `## Version / change reference`) |

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

## Responsibilities

- `sendOvernightMorningEmails` / `_` — the 10:00 per-region email; now
  orchestrates the UNION of today's Overnight buckets and yesterday's
  pending `AllIssues_Log` buckets (by recipient email, not region alone).
- `sendOvernightFollowupEmails` / `_` — the 13:00 same-thread follow-up.
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

`setupOvernightEmailer()` (`#L1569`) installs `sendOvernightMorningEmails`
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
| FN-231 | `sendOvernightMorningEmails()` / `_()` `#L774/#L786` | `leads` tab, prior `Overnight_Log`, prior `AllIssues_Log` | one combined email per union bucket (10:00) | Gmail sends; `Overnight_Log` rows; `AllIssues_Log` checkpoint writes; calls the `Lead_Followups` bridge | `readLeadsTab_` (`GS-004`), `computeSlaFlags_` (`GS-012`), `overnightWindowGs_` (FN-234), `loadYesterdaysAllIssuesBucketsGs_` (FN-276), `sendCombinedMorningEmail_` (FN-275), `resolveRecipientEmailsForRegion_` (`GS-004`) | the 10:00 trigger; `sendOvernightMorningEmailsNow()` | specific — scheduled |
| FN-232 | `sendOvernightFollowupEmails()` / `_()` `#L1268/#L1280` | prior day's `Overnight_Log` thread ids | a same-thread reply per region (13:00) showing what resolved | threaded Gmail replies | `sendThreadedGmailReply_` (FN-236), `computeSlaFlags_` (`GS-012`), `formatFollowupAgeGs_` (FN-237) | the 13:00 trigger; `sendOvernightFollowupEmailsNow()` | specific — scheduled — **Section 2/Checkpoint 2 not yet wired here (Step 7/11)** |
| FN-233 | `sendOneOvernightEmail_(ss, logSheet, region, rec, leads, dateLabel, todayKey, now, win)` `#L339` | one region's data | that region's STANDALONE morning email (still used directly by tests/manual calls) | Gmail send; `Overnight_Log` row | `renderOvernightReportEmailHTML_` (`GS-004`), `buildOvernightSectionOptsGs_` (FN-272), `overnightFollowupHintGs_` (`GS-005`), `withSendRetry_` (`GS-004`) | tests, manual calls — **no longer called by FN-231's own loop**, which now always goes through FN-275 | specific |
| FN-234 | `overnightWindowGs_(asOf)` / `ensureOvernightLogSheet_(ss)` `#L245/#L258` | as-of date | the overnight window `{start, end}`; ensures `Overnight_Log` | may create the tab | `istDayKeyGs_` (`GS-002`) | FN-231, FN-232 | specific |
| FN-235 | `pushUnresolvedToLeadFollowups_(ss, entries)` / `waitForFollowupSuggestions_(ss, leadIds)` `#L1061/#L1122` | flagged-lead entries | upserts `Lead_Followups`; **polls up to ~2 minutes for a human/dashboard-generated follow-up suggestion before falling back to the keyword engine** | Sheets write; polling read | `noCommentFollowUpGs_` / `overnightFollowupHintGs_` (`GS-005`) | FN-231 | specific — **the backend side of the same `Lead_Followups` bridge the client's Generate cycle writes into** (`JS-016` / `JS-018`) |
| FN-236 | `sendThreadedGmailReply_(threadId, to, cc, subject, plainBody, htmlBody)` `#L1192` | a thread id + content | a reply on that Gmail thread | raw **Advanced Gmail Service** call | — | FN-232, `backfillTodaysOvernightLogRecipientsNow` | specific — uses the raw API because `GmailThread.reply()`/`replyAll()` hard-code the recipient to "sender of the last message" (a real production bug this works around) |
| FN-237 | `formatFollowupAgeGs_(updatedAt, now)` / `overnightStatusLabelGs_` (in `GS-005`) `#L1154` | a timestamp | a human age string | none | — | FN-232 | reusable |
| FN-238 | `notifyChLevelLeadsGs_(region, chLevelRms, rmToLeads, dateLabel)` `#L134` | CH-level RMs + leads | a CH-level rollup email | Gmail send | `groupLeadsByRmAndFlatten_` (`GS-004`) | FN-231 | specific |
| FN-239 | `setupOvernightEmailer()` `#L1569` | — | installs the 10:00 + 13:00 triggers; **also calls `setupRmHierarchy()`** | creates triggers; runs `GS-011` setup | `ScriptApp`, `setupRmHierarchy` (`GS-011`) | Apps Script editor (manual) | specific |
| FN-272 | `buildOvernightSectionOptsGs_(region, leads, dateLabel, win)` `#L309` | a bucket's leads | Section 1's full `renderOvernightReportEmailHTML_` opts | none (pure) | — | FN-233, FN-275 | reusable — **extracted 2026-09-23 so a standalone overnight email and Section 1 of the combined email share one source of truth** |
| FN-273 | `buildAllIssuesCheckpointSectionOptsGs_(region, checkpointLabel, originalDateLabel, snapshotEntries, checkpointResults)` `#L502` | the 17:00 snapshot + a checkpoint's comparison results | Section 2's full `renderOvernightReportEmailHTML_` opts, grouped by RM | none (pure) | `allIssuesCheckpointStateLabelGs_` `#L480` (private helper, same file) | FN-275 (also intended for Step 7's 13:00 job) | reusable — **joins `computeAllIssuesCheckpointGs_`'s output (`GS-012` FN-270, no RM/TL) back to the original snapshot entries (which have RM/TL) by `lead_id`** |
| FN-274 | `renderTwoSectionEmailHTML_(section1Opts, section2Opts)` `#L551` | both sections' opts | the combined email HTML — two full `renderOvernightReportEmailHTML_` renders concatenated with a labeled divider | none (pure) | `renderOvernightReportEmailHTML_` (`GS-004`) ×2 | FN-275 | reusable — **deliberately does NOT modify `renderOvernightReportEmailHTML_`'s own signature** (design doc Part 8: "wrap, don't modify" — that function also backs every `GS-001` single-section email) |
| FN-275 | `sendCombinedMorningEmail_(ss, overnightLogSheet, allIssuesLogSheet, region, section1, section2, dateLabel, todayKey, now, win, baselineMap, section1SkippedReason)` `#L620` | one union bucket's Section 1/2 inputs | the combined 10:00 email | Gmail send; `Overnight_Log` row (if Section 1 sent); `AllIssues_Log` `checkpoint1_json`/`checkpoint1_sent_at` write-back (if Section 2 present, even on send failure — see its own comment on why that differs from Section 1's choice) | `buildOvernightSectionOptsGs_`/`buildOvernightSectionEmptyStateOptsGs_`/`buildAllIssuesCheckpointSectionOptsGs_`/`buildAllIssuesCheckpointEmptyStateOptsGs_`/`renderTwoSectionEmailHTML_` (all same file), `computeAllIssuesCheckpointGs_` (`GS-012` FN-270), `withSendRetry_`/`notifyOpsAlertGs_` (`GS-004`) | FN-231 | specific |
| FN-276 | `loadYesterdaysAllIssuesBucketsGs_(ss, now)` `#L572` | spreadsheet + now | `{region -> [{rowNumber, to, cc, bucketLabel, primaryRole, snapshotEntries}]}` for yesterday's un-checkpointed `AllIssues_Log` rows | reads `AllIssues_Log` (`GS-001`/`SHEET-013`) | `ensureAllIssuesLogSheet_` (`GS-001`), `istDayKeyGs_` (`GS-002`) | FN-231 | specific — **the idempotency check for Section 2 (`checkpoint1_sent_at` blank) — a fuller retry story is Step 8/11** |

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
| `Overnight_Log` | Write (append) + ensure | FN-233 / FN-234 / FN-275 | thread ids for the 13:00 reply — id TBD (DOC-010/032) |
| `SHEET-006` `RM_Hierarchy` / `SHEET-007` `Manager_Directory` / `SHEET-012` `Region_Recipients` | Read | FN-231 (via `GS-004` / `GS-011`) | routing |
| `SHEET-013` `AllIssues_Log` | Read (`GS-001`'s own 17:00 rows) + Write (`checkpoint1_json`/`checkpoint1_sent_at`, cols K/L) | FN-276 / FN-275 | added 2026-09-23 — Section 2/Checkpoint 1's own state; routing (`to`/`cc`) is read from this table's STORED values, never re-resolved (design doc Part 7) |

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
  directly from `setupOvernightEmailer()` (`#L1178`), cross-checked
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
