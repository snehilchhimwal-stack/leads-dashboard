# SHEET-013 — AllIssues_Log

| | |
|---|---|
| **Type** | `SHEET-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | Google Sheet, tab `AllIssues_Log` |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

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

Exact list: `AllIssuesEmailer.gs` `#L102`
(`['date','region','bucket_label','primary_role','to','cc','lead_count','sent_at','thread_id']`).

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

## Data Lifecycle (DOC-019 — `TBD`, filled by `DOC-036`)

- **Data Type:** historical (send-audit log)
- **Retention Period:** `TBD` — no prune function → likely unbounded.
  `DOC-036` to confirm intent (grows ~1 row per region per day).
- **Enforced By:** `None`
- **Archive / Delete Behavior:** grows unbounded; no clear function
- **Sensitivity:** operational (recipient addresses) — `DOC-036` to
  classify

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
has no follow-up run (`GS-001` is 17:00-only) — kept for manual
reference / a possible future follow-up.

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
`#L102`.

## Validation

- **Method:** header read from `AllIssuesEmailer.gs` `#L102` at
  `c82ec67`; the self-healing behaviour confirmed in the same function.
  `Tests_AllIssuesEmailer.gs` in CI.
- **Evidence:** `.github/workflows/test.yml` (`Tests_AllIssuesEmailer.gs`,
  last green run).
- **Status:** Validated 2026-09-10 (non-lifecycle); lifecycle `TBD`
  (`DOC-036`).

## Version / change reference

Verified at `c82ec67`; record created by `DOC-032`.

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
