# SHEET-014 — Overnight_Log

| | |
|---|---|
| **Type** | `SHEET-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | Google Sheet, tab `Overnight_Log` |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-23 against commit `(pending commit)` — Step 8/11, gained `followup_sent_at` (see `## Version / change reference`) |

## Purpose / reason to exist

The state bridge between `OvernightEmailer.gs`'s two runs. The 10:00 IST
send records, per region, the Gmail `thread_id`, the exact resolved
`to`/`cc`, the subject, and the `lead_ids_json` it covered. The 13:00 IST
follow-up **reads this back** to reply *on the same thread, to the same
real people* — which it cannot do from `GmailThread.reply()` alone
(that hard-codes the recipient to the last sender). Without this tab the
1pm follow-up couldn't find its thread or its audience.

## Reason to exist

`GmailThread.reply()` / `replyAll()` send to the wrong recipient, so the
13:00 follow-up must send an explicit raw reply — and it needs the 10:00
run's `thread_id` + resolved recipients to do that. This tab is where
the 10:00 run leaves them.

## Data stored

One row per region per day: the 10:00 send's thread + recipient state.

## Source of the data

`GS-010` `ensureOvernightLogSheet_` (header) + `sendOneOvernightEmail_`
(one row per 10:00 send). `backfillTodaysOvernightLogRecipientsNow` can
repair a row's `to`/`cc` if the 10:00 run pre-dated the
resolved-recipient capture.

## Destination / consumers

`GS-010` `sendOvernightFollowupEmails_` (13:00) reads it to send the
threaded follow-up.

## Columns / fields

| Column | Type | Meaning |
|---|---|---|
| `date` | date | the run's IST day |
| `region` | text | region emailed at 10:00 |
| `thread_id` | text | the Gmail thread — **the 13:00 run replies here** |
| `lead_ids_json` | text (JSON) | the leads the 10:00 email flagged |
| `sent_at` | datetime | 10:00 send instant |
| `to` / `cc` | text | the **actual resolved** recipients (so the 13:00 reply reaches the same people explicitly) |
| `subject` | text | the 10:00 subject line |
| `followup_sent_at` | datetime | added 2026-09-23 (Step 8/11) — idempotency guard for the 13:00 job's own combined reply (Section 1 unresolved-leads + Section 2 Checkpoint 2 together). Written ONLY on a confirmed successful send (threaded reply OR its plain fallback) — a failed send leaves it blank so the next run retries, unlike `AllIssues_Log`'s checkpoint columns which are written even on failure for a different reason (see `GS-010` FN-280's own comment). Chain-A-internal only — carries no Chain-B/checkpoint content (see `docs/_planning/EMAIL_LIFECYCLE_TWO_CHECKPOINT_REDESIGN.md` Part 5's own note on why this doesn't violate "the two chains stay separate"). |

Exact list: `OvernightEmailer.gs` `#L274`
(`['date','region','thread_id','lead_ids_json','sent_at','to','cc','subject','followup_sent_at']`).
Self-healing header as of Step 8/11 (`ensureOvernightLogSheet_`, `#L282`)
— same append-missing-columns pattern `AllIssuesEmailer.gs`'s
`ensureAllIssuesLogSheet_` already used; before Step 8 this sheet had NO
self-healing at all (an existing sheet was returned as-is with whatever
columns it already had).

## Writers

| Writer | `FN-XXX` | Mode |
|---|---|---|
| `GS-010` | `sendOneOvernightEmail_` (FN-233) | append (one per 10:00 send) |
| `GS-010` | `sendCombinedMorningEmail_` (FN-275) | append (one per 10:00 combined send, Step 6/11) |
| `GS-010` | `ensureOvernightLogSheet_` (FN-234) | header, on first use; self-heals missing columns on an existing sheet (Step 8/11) |
| `GS-010` | `backfillTodaysOvernightLogRecipientsNow` | in-place `to`/`cc` repair (manual) |
| `GS-010` | `sendCombinedFollowupEmail_` (FN-280) | added 2026-09-23 (Step 8/11) — writes `followup_sent_at` (col I) back onto the exact row its reply came from, success only |

## Readers

| Reader | `FN-XXX` | For |
|---|---|---|
| `GS-010` | `sendOvernightFollowupEmails_` (FN-232) | **functional** — find the thread + recipients for the 13:00 reply; also reads `followup_sent_at` (col I) as of Step 8/11 to skip a bucket already replied to today |

## Automation / triggers touching it

Written by `setupOvernightEmailer()`'s `atHour(10)` trigger; read by its
`atHour(13)` trigger. **Both triggers lack an explicit `.inTimezone()`**
(the project's sole outlier — `GS-010` Trigger Schedule / EXC-079).

## Apps Script functions touching it

`ensureOvernightLogSheet_`, `sendOneOvernightEmail_`,
`sendCombinedMorningEmail_`, `sendOvernightFollowupEmails_`,
`sendCombinedFollowupEmail_`, `backfillTodaysOvernightLogRecipientsNow`
(all `GS-010`).

## Data Lifecycle (DOC-019 — completed by `DOC-036`, 2026-09-10)

- **Data Type:** operational (a same-day state handoff — the 13:00 run
  reads *today's* rows; older rows are dead weight).
- **Retention Period:** **`TBD` — no pruning function found.** grep at
  `9cafa68`: no `prune*_` and no `clear*` touches this tab.
  `backfillTodaysOvernightLogRecipientsNow` is a repair function, not a
  prune. Only ~today's rows are functionally needed, so this is the one
  `TBD` tab where a **short prune (keep ~2 days) is likely safe** — but
  that is a recommendation for `DOC-037`, not confirmed here.
- **Enforced By:** `None`.
- **Archive / Delete Behavior:** grows unbounded; no removal path.
- **Sensitivity:** operational — recipient addresses + `lead_ids_json`.
  A backend job depends on it directly (the 13:00 threaded reply — a
  **functional** read, higher stakes than the other send logs).
  `DOC-038` completes the classification.

## Sensitivity & operational importance (DOC-038)

- **Operational importance:** **IMPORTANT** — a live flow (dashboard feature or a degradable backend path) depends on it; no hard unattended-job failure.
- **Data sensitivity:** recipient email addresses + `lead_ids_json`.
- **Reason:** `GS-010`'s 13:00 run **functionally** reads *today's* rows (`thread_id` + resolved `to`/`cc`) to send the threaded follow-up — a missing/corrupt today-row breaks that region's 1pm follow-up. Rows older than same-day have no dependency.

## Risks of changing this tab's structure

`sendOvernightFollowupEmails_` reads `thread_id` / `to` / `cc` by
position/name — a rename or reorder **breaks the 13:00 follow-up**
(it would reply to nobody or to the wrong thread). This is a *functional*
dependency, not just an audit one — higher blast radius than the other
log tabs.

## Relationships to other tabs

Records sends of digests built from `SHEET-001` (`leads`). Sibling to
`SHEET-011` / `SHEET-013` (the other send logs) but, unlike them, has a
real code reader.

## Important logic / business rules

The 13:00 run **must** use the stored `to`/`cc` and `thread_id` for a raw
threaded reply — `GmailThread.reply()` would misroute (`GS-010` FN-236 /
EXC-080). `lead_ids_json` tells the 13:00 run which leads to re-check for
resolution. As of Step 8/11, `followup_sent_at` gates the WHOLE 13:00
reply (Section 1 + Section 2 together) — a row with it already set is
skipped entirely by `sendOvernightFollowupEmails_`'s Pass 1, so a trigger
retry or manual re-run reconciles with the existing cycle instead of
sending a second reply into the same thread.

## Exceptions & error handling

A 10:00 row written before the resolved-recipient capture existed can be
repaired by `backfillTodaysOvernightLogRecipientsNow`. A missing tab →
`ensureOvernightLogSheet_` creates it (the 13:00 run then has nothing to
reply to — sends nothing).

## Related documentation

`HANDOVER.md` §2; `LOGIC_AUDIT.md` Part 1 §1, §4d; `OPS_CHECKLIST.md`
(email routing).

## Relationships

- **Depends On:** `GS-010`, `EXT-001`, `EXT-002` (incl. Advanced Gmail
  Service)
- **Used By:** `GS-010` (both the write and the functional read)
- **Related:** `SHEET-011` (`Send_Log`), `SHEET-013` (`AllIssues_Log`) —
  the other send logs; `SHEET-004` (`Lead_Followups`) — the other
  overnight-cycle state

## Source of truth

The live `Overnight_Log` tab; header authored in `OvernightEmailer.gs`
`#L266`.

## Validation

- **Method:** header read from `OvernightEmailer.gs` `#L266` at
  `c82ec67`; the functional 13:00 read + the `GmailThread.reply()`
  workaround confirmed in `sendOvernightFollowupEmails_` /
  `sendThreadedGmailReply_`. `Tests_OvernightEmailer.gs` in CI.
- **Evidence:** `.github/workflows/test.yml` (`Tests_OvernightEmailer.gs`,
  last green run); `LOGIC_AUDIT.md` Part 1 §4d.
- **Status:** Validated 2026-09-10 (non-lifecycle); lifecycle `TBD`
  (`DOC-036`).

## Version / change reference

Verified at `c82ec67`; record created by `DOC-032`.

**Revalidated 2026-09-23** `(pending commit)`: Step 8/11 (two-checkpoint
email lifecycle redesign, `docs/_planning/EMAIL_LIFECYCLE_TWO_CHECKPOINT_REDESIGN.md`,
goal `g-tf-fc7cc3383b`) — gained `followup_sent_at` (col I), the
idempotency guard for the 13:00 job's own combined reply. A real gap
this closes: unlike Section 2 (already guarded by `AllIssues_Log`'s
`checkpoint2_sent_at` since Step 7), Section 1's unresolved-lead
follow-up had no per-day-once guard at all — a trigger retry resent a
duplicate reply into the same thread every time. `ensureOvernightLogSheet_`
gained a self-healing header (append-missing-columns), mirroring
`ensureAllIssuesLogSheet_`'s own pattern — this sheet had none before.
Also caught and fixed while revalidating: this record's own Writers
table was missing `sendCombinedMorningEmail_` (`GS-010` FN-275), the
ACTUAL primary writer since Step 6/11 — pre-existing drift, unrelated to
Step 8 itself, closed in the same pass. See `GS-010`'s own revalidation
entry for the full reasoning on why this deviates from
`EMAIL_LIFECYCLE_TWO_CHECKPOINT_REDESIGN.md` Part 5's original "gets no
new columns" statement (refined, not violated — that statement was about
Chain-B content specifically).

## Revalidation trigger

The header in `OvernightEmailer.gs` changes; the 13:00 run's read
expectations change; a prune policy is added; `GS-010`'s schedule /
timezone handling changes.

## Handover relationship

`HANDOVER.md` §2 lists it among the datastore tabs. Current as of
2026-09-09. A schema change must update `HANDOVER.md` §2 and note the
functional 13:00 dependency.

## Lifecycle / retention

`TBD` — deferred to `DOC-036`. Only today's rows are functionally needed;
currently **unbounded**. `DOC-036` should assess whether a short prune
(keep ~2 days) is safe.

## Next action

`DOC-036` — decide/record retention (a short prune may be viable here,
unlike the archive tabs) + sensitivity.

## Closure evidence

Record committed for `DOC-032`; `docs/INDEX.md` `SHEET-014` → `Closed +
Monitored` (non-lifecycle scope), `Last Verified` 2026-09-10; header
sourced from `OvernightEmailer.gs`, not approximated; Data Lifecycle
`TBD` per `DOC-032` boundary (with a noted prune candidacy).
