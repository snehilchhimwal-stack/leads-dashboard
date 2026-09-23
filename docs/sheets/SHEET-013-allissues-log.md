# SHEET-013 — AllIssues_Log

| | |
|---|---|
| **Type** | `SHEET-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | Google Sheet, tab `AllIssues_Log` |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-23 against commit `51a6498` — Step 3, `issue_snapshot_json` now written (see `## Version / change reference`) |

## Purpose / reason to exist

The send-audit log for `AllIssuesEmailer.gs` (`GS-001`) — one row per
region digest sent at 17:00 IST, recording the resolved recipients, the
lead count, the send time, and the Gmail `thread_id`. It exists so the
17:00 run has a durable record of what went out to whom, and so a
same-day re-send / debug can reference the real thread.

## Reason to exist

To give the unattended 17:00 emailer its own persistent "what did I
send" trail, separate from the dashboard's `Send_Log` (`SHEET-011`) and
from `Overnight_Log` (`SHEET-014`).

## Data stored

One row per region email sent by the 17:00 job.

## Source of the data

`GS-001` `ensureAllIssuesLogSheet_` (header, with a self-healing check
that appends missing columns) + `sendOneAllIssuesEmail_` (one row per
send).

## Destination / consumers

`GS-001` itself (to know a region was already sent this run / for
debug). No dashboard reader.

## Columns / fields

| Column | Type | Meaning |
|---|---|---|
| `date` | date | the run's IST day |
| `region` | text | region emailed |
| `bucket_label` | text | the recipient bucket label |
| `primary_role` | text | the primary recipient's role (TL/TM/RH/CH) |
| `to` / `cc` | text | resolved recipients |
| `lead_count` | number | leads in the digest |
| `sent_at` | datetime | send instant |
| `thread_id` | text | the Gmail thread |
| `issue_snapshot_json` | text (JSON) | added 2026-09-23, **written as of Step 3/11**: the exact per-lead population this bucket's 17:00 email reported: `[{lead_id, RM, TL, status, issueLabel, followup}, ...]`. Written at send time by `sendOneAllIssuesEmail_`; blank on any row from before Step 3. |
| `checkpoint1_json` | text (JSON) | added 2026-09-23 — written by the next day's 10:00 job (not yet wired — Steps 4/6): `[{lead_id, state, currentIssueLabel, currentStatus}, ...]`. |
| `checkpoint1_sent_at` | datetime | added 2026-09-23 — idempotency guard for the 10:00 job (not yet wired — Steps 4/6/8). |
| `checkpoint2_json` | text (JSON) | added 2026-09-23 — written by that day's 13:00 job (not yet wired — Steps 5/7), same shape as `checkpoint1_json`, computed incrementally against it. |
| `checkpoint2_sent_at` | datetime | added 2026-09-23 — idempotency guard for the 13:00 job (not yet wired — Steps 5/7/8). |

Exact list: `AllIssuesEmailer.gs` `#L131`
(`['date','region','bucket_label','primary_role','to','cc','lead_count','sent_at','thread_id','issue_snapshot_json','checkpoint1_json','checkpoint1_sent_at','checkpoint2_json','checkpoint2_sent_at']`).
See `docs/_planning/EMAIL_LIFECYCLE_TWO_CHECKPOINT_REDESIGN.md` Part 5
for the full design these 5 columns serve — the two-checkpoint daily
email lifecycle redesign, goal `g-tf-fc7cc3383b`.

## Writers

| Writer | `FN-XXX` | Mode |
|---|---|---|
| `GS-001` | `sendOneAllIssuesEmail_` (FN-176) | append (one per send) |
| `GS-001` | `ensureAllIssuesLogSheet_` (FN-178) | header + self-healing (appends missing columns) |

## Readers

| Reader | `FN-XXX` | For |
|---|---|---|
| `GS-001` | `sendAllIssuesEmails_` (FN-174) | dedupe within a run / debug |

## Automation / triggers touching it

Written by `setupAllIssuesEmailTrigger()`'s `atHour(17).nearMinute(0)`
trigger. No trigger of its own. See `GS-001` Trigger Schedule.

## Apps Script functions touching it

`ensureAllIssuesLogSheet_`, `sendOneAllIssuesEmail_`,
`sendAllIssuesEmails_` (all `GS-001`).

## Data Lifecycle (DOC-019 — completed by `DOC-036`, 2026-09-10)

- **Data Type:** historical (send-audit log).
- **Retention Period:** **`TBD` — no pruning function found.** grep at
  `9cafa68`: no `prune*_` and no `clear*` touches this tab. Grows ~1 row
  per region per day (bounded, low risk). Not invented — feeds
  `DOC-037`.
- **Enforced By:** `None`.
- **Archive / Delete Behavior:** grows unbounded; `ensureAllIssuesLogSheet_`
  self-heals the header only, never removes rows.
- **Sensitivity:** operational — recipient addresses. `DOC-038` for the
  operational-importance classification (read only by `GS-001` itself,
  for within-run dedupe).

## Sensitivity & operational importance (DOC-038)

- **Operational importance:** **LOW** — display / audit-trail only — no automated dependency; losing it loses history, nothing stops working.
- **Data sensitivity:** recipient email addresses.
- **Reason:** Read only by `GS-001` itself, for within-run dedupe — pruning old rows is functionally safe. A 17:00-send audit trail; nothing breaks if old rows are gone.

## Risks of changing this tab's structure

`ensureAllIssuesLogSheet_` **self-heals** by appending any missing header
— so adding a column is safe (append it to the constant), but
**reordering or renaming** breaks the append-only heal and the reader.
Only `GS-001` touches it, so the blast radius is one file.

## Relationships to other tabs

Records sends of digests built from `SHEET-001` (`leads`). Sibling to
`SHEET-011` (dashboard sends) and `SHEET-014` (overnight sends).

## Important logic / business rules

Self-healing header (append-only), same pattern as `Movement_Log` /
`Daily_RM_Issues`. `thread_id` is captured even though `AllIssuesEmailer`
itself still only sends at 17:00 — kept for manual reference. As of
2026-09-23 this row's grain (one per manager bucket per 17:00 run) is
also the persistence layer for a real follow-up mechanism under active
build (`issue_snapshot_json`/`checkpoint1_json`/`checkpoint2_json`
above) — the follow-up SEND itself happens from `OvernightEmailer.gs`'s
10:00/13:00 jobs, not from this file, once Steps 3-5 of the redesign
wire it up (not yet done as of this row's own commit).

## Exceptions & error handling

A send failure (after retries) shows as Failed in Executions; the log
row for that region is simply absent. `ensureAllIssuesLogSheet_` creates
the tab if missing.

## Related documentation

`HANDOVER.md` §2; `LOGIC_AUDIT.md` Part 1 §1, §4d.

## Relationships

- **Depends On:** `GS-001`, `EXT-001`, `EXT-002`
- **Used By:** `GS-001` only
- **Related:** `SHEET-011` (`Send_Log`), `SHEET-014` (`Overnight_Log`) —
  the other send logs

## Source of truth

The live `AllIssues_Log` tab; header authored in `AllIssuesEmailer.gs`
`#L131`.

## Validation

- **Method:** header read from `AllIssuesEmailer.gs` `#L131` at
  `65df46c`; the self-healing behaviour confirmed in the same
  function. `Tests_AllIssuesEmailer.gs` in CI.
- **Evidence:** `.github/workflows/test.yml` (`Tests_AllIssuesEmailer.gs`,
  last green run).
- **Status:** Validated 2026-09-10 (non-lifecycle); lifecycle `TBD`
  (`DOC-036`).

## Version / change reference

Verified at `c82ec67`; record created by `DOC-032`.

**Revalidated 2026-09-23** `65df46c`: 5 columns added
(`issue_snapshot_json`, `checkpoint1_json`, `checkpoint1_sent_at`,
`checkpoint2_json`, `checkpoint2_sent_at`) — Step 2/11 of the
two-checkpoint email lifecycle redesign
(`docs/_planning/EMAIL_LIFECYCLE_TWO_CHECKPOINT_REDESIGN.md` Part 5,
goal `g-tf-fc7cc3383b`). Append-only, via `ensureAllIssuesLogSheet_`'s
existing self-healing header logic (`GS-001` FN-178) — no reader or
writer of the existing 9 columns changed.

**Revalidated 2026-09-23** `51a6498`: `issue_snapshot_json` is
now actually written (Step 3/11) — `sendOneAllIssuesEmail_` (`GS-001`
FN-176) appends it at send time. The other 4 columns remain unwritten
until Steps 4-7.

## Revalidation trigger

The header constant in `AllIssuesEmailer.gs` changes (append-only); a
prune policy or a reader is added; `GS-001`'s send schedule changes.

## Handover relationship

`HANDOVER.md` §2 lists it among the datastore tabs. Current as of
2026-09-09. A schema change must update `HANDOVER.md` §2.

## Lifecycle / retention

`TBD` — deferred to `DOC-036`. Currently **unbounded** (no prune);
`DOC-036` confirms whether that is intentional.

## Next action

`DOC-036` — decide/record retention + sensitivity.

## Closure evidence

Record committed for `DOC-032`; `docs/INDEX.md` `SHEET-013` → `Closed +
Monitored` (non-lifecycle scope), `Last Verified` 2026-09-10; header
sourced from `AllIssuesEmailer.gs`, not approximated; Data Lifecycle
`TBD` per `DOC-032` boundary.
