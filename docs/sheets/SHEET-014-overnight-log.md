# SHEET-014 — Overnight_Log

| | |
|---|---|
| **Type** | `SHEET-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | Google Sheet, tab `Overnight_Log` |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

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

Exact list: `OvernightEmailer.gs` `#L266`
(`['date','region','thread_id','lead_ids_json','sent_at','to','cc','subject']`).

## Writers

| Writer | `FN-XXX` | Mode |
|---|---|---|
| `GS-010` | `sendOneOvernightEmail_` (FN-233) | append (one per 10:00 send) |
| `GS-010` | `ensureOvernightLogSheet_` (FN-234) | header, on first use |
| `GS-010` | `backfillTodaysOvernightLogRecipientsNow` | in-place `to`/`cc` repair (manual) |

## Readers

| Reader | `FN-XXX` | For |
|---|---|---|
| `GS-010` | `sendOvernightFollowupEmails_` (FN-232) | **functional** — find the thread + recipients for the 13:00 reply |

## Automation / triggers touching it

Written by `setupOvernightEmailer()`'s `atHour(10)` trigger; read by its
`atHour(13)` trigger. **Both triggers lack an explicit `.inTimezone()`**
(the project's sole outlier — `GS-010` Trigger Schedule / EXC-079).

## Apps Script functions touching it

`ensureOvernightLogSheet_`, `sendOneOvernightEmail_`,
`sendOvernightFollowupEmails_`, `backfillTodaysOvernightLogRecipientsNow`
(all `GS-010`).

## Data Lifecycle (DOC-019 — `TBD`, filled by `DOC-036`)

- **Data Type:** operational (a same-day state handoff, plus a historical
  send log)
- **Retention Period:** `TBD` — only *today's* rows are functionally
  needed (by the 13:00 run); older rows are dead weight. No prune
  function → likely unbounded. `DOC-036` to confirm intent / whether a
  short prune is safe.
- **Enforced By:** `None`
- **Archive / Delete Behavior:** grows unbounded; no clear function
- **Sensitivity:** operational (recipient addresses + `lead_ids_json`) —
  `DOC-036` to classify

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
resolution.

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
