# GS-017 - EmailSweep.gs

| | |
|---|---|
| **Type** | `GS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `EmailSweep.gs` |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-10-09 against commit `93a120a` - created (Email Ops EO-5) |

## Purpose / reason to exist

Once a day, shortly before the 16:30 cycle report, it checks the emails of the last three days that Gmail ACCEPTED for two things the send call
cannot tell: did a **delivery-failure (bounce)** message come back, and did anybody **reply** in the thread. It fills the three evidence columns the
ledger keeps for this (`bounce_status`, `reply_status`, `swept_at` in `SHEET-019`), raises one ops alert for each NEW bounce (a manager did not get
the email), and gives the 16:30 report (`GS-016`) its "Bounces and replies" section. Plan: `docs/_planning/EMAIL_OPS_SYSTEM_AUDIT.md` (gap G5).

What it cannot know: delivered and opened are invisible to Apps Script. `NO_BOUNCE_SEEN` means only that no bounce message was found - it is never
reported as delivered, and a bounce Gmail does not file as a mailer-daemon message would be missed.

## Responsibilities

- Pick the emails to check (`emailSweepIsCandidateGs_`): ACCEPTED or UNCONFIRMED, finished 30 minutes to 3 days ago.
- Find bounces (`GmailApp.search` for mailer-daemon / postmaster, `emailSweepFetchBouncesGs_`) and match each to an email (`emailSweepMatchBounceGs_`).
- Find replies in each email's thread (`emailSweepFetchThreadGs_`, `emailSweepRepliesGs_`): later messages from someone other than the sending account.
- Write the result for the whole range in ONE call, stop after a time budget (4.5 minutes), alert on new bounces, never throw on a Gmail error.

## Trigger schedule

`setupEmailSweepTrigger()` installs ONE trigger for `sweepEmailBouncesAndReplies`: `atHour(16).nearMinute(10).everyDays(1)` in `Asia/Kolkata`, run
with a run record (`runEmailJobTrackedGs_`) - deliberately WITHOUT the script-wide job lock (a `nearMinute` trigger fires up to 15 minutes either side of its minute, and holding the lock near 17:00 could make the primary 17:00 send skip) - and watched by the hourly watchdog (`emailJobScheduleGs_`, deadline 16:15).

## Requires `setupXxx()` re-run when

First install (run `setupEmailSweepTrigger()` once after pasting) and whenever `EMAIL_SWEEP_HOUR_` / `EMAIL_SWEEP_MINUTE_` change.

## Significant functions - `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-399 | `emailSweepIsCandidateGs_(row, now)` / `emailSweepAddressesGs_` | a ledger row object, the time | whether to sweep it; lower-cased addresses | none (pure) | - | FN-402 | specific - RULE-051 |
| FN-400 | `emailSweepMatchBounceGs_(row, bounces)` | a ledger row, `[{at, subject, body}]` | the bounce that belongs to it, or null | none (pure) | `emailSweepAddressesGs_` | FN-402 | specific - RULE-052 |
| FN-401 | `emailSweepRepliesGs_(row, messages, ownAddress)` / `emailSweepIsOwnGs_` / `emailSweepIsBounceSenderGs_` | a ledger row, `[{from, date}]` | `{count, latest}` | none (pure) | - | FN-402 | specific |
| FN-402 | `sweepEmailBouncesAndReplies_(opts)` / `emailSweepFetchBouncesGs_` / `emailSweepFetchThreadGs_` / `emailSweepReadRowsGs_` | `{now, maxRunMs}` | `{checked, bounced, replied, newBounces, unswept, errors}` | reads Gmail; one write to `Email_Ledger`; one ops alert for new bounces | `emailLedgerReadRowsGs_` (`GS-015`), `notifyOpsAlertGs_`, `writeUnlessTestModeGs_` (`GS-004`) | FN-403 | specific - RULE-053 |
| FN-403 | `sweepEmailBouncesAndReplies()` / `sweepEmailBouncesAndRepliesNow()` / `setupEmailSweepTrigger()` / `showEmailSweepPlanNow()` | - | - | the run record (no job lock); a crash alerts ops at once and re-throws; trigger install; a read-only count in the log | `withEmailJobLockGs_` (`GS-004`) | the trigger / Apps Script editor | specific |

## Business rules implemented - `RULE-XXX` sub-table

| ID | Rule | Where | Duplicated elsewhere? |
|---|---|---|---|
| RULE-051 | Only ACCEPTED/UNCONFIRMED emails are swept, and only once they are 30 minutes old (a bounce arrives within minutes, so a clean result earlier would prove nothing) and while they are under 3 days old | FN-399 | - |
| RULE-052 | A bounce belongs to an email only when it names one of that email's recipients (To or Cc) AND (quotes the email's subject, OR arrived within 15 minutes of the send), no earlier than a minute before the send and no later than 24 hours after it - so two emails to the same person are not both blamed for one bounce | FN-400 | - |
| RULE-053 | A status is never stronger than the evidence: no bounce found = `NO_BOUNCE_SEEN` (never "delivered"); a failed bounce search = `UNKNOWN (the bounce search failed)`; an unreadable thread = `UNKNOWN (the thread could not be read)`; no thread id = `UNKNOWN (no thread id recorded)` | FN-402 | `GS-015` RULE-043 |

## Config constants - `CFG-XXX` sub-table

| ID | Constant | Value | Meaning | Changing it affects |
|---|---|---|---|---|
| CFG-113 | `EMAIL_SWEEP_HOUR_`, `EMAIL_SWEEP_MINUTE_`, `EMAIL_SWEEP_LOOKBACK_DAYS_`, `EMAIL_SWEEP_MIN_AGE_MINUTES_`, `EMAIL_SWEEP_MAX_RUN_MS_`, `EMAIL_SWEEP_QUICK_BOUNCE_MS_`, `EMAIL_SWEEP_BOUNCE_QUERY_`, `EMAIL_SWEEP_OWN_NAME_` | `15`, `45`, `3`, `30`, `270000`, 15 minutes, `from:(mailer-daemon OR postmaster) newer_than:3d`, `homesfy lead ops` | when it runs and what it looks at; how our own messages are told apart (the display name every send uses) | the trigger (re-run `setupEmailSweepTrigger`), the watchdog deadline, what counts as a bounce or a reply |

## Exceptions - `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-126 | the Gmail bounce search fails | recorded in the summary; every checked email reads `UNKNOWN (the bounce search failed)`; replies are still checked | nothing is claimed about bounces; the next sweep retries |
| EXC-127 | a thread cannot be read | that email reads `UNKNOWN (the thread could not be read)`; the sweep goes on | the report shows it as unknown |
| EXC-128 | the 4.5-minute budget runs out | the remaining emails are counted as unswept and left blank for the next sweep | none |

## Data lineage

`SHEET-019` Email_Ledger (rows + thread ids) -> FN-402 -> Gmail search / threads -> the three sweep columns of `SHEET-019`; new bounces -> one ops alert and an `Incident_Log` row (`SHEET-021`) -> the 16:30 report (`GS-016`).

## Sheets touched

| `SHEET-XXX` | Read / Write | Which `FN-XXX` | Notes |
|---|---|---|---|
| `SHEET-019` `Email_Ledger` | Read + write | FN-402 | only the `bounce_status`, `reply_status`, `swept_at` columns, in one call |

## Failure / error behaviour

A Gmail error never stops the sweep; a crash alerts ops at once and re-throws.

## Cross-runtime duplication

None - backend only.

## Not live until pasted

Paste `EmailSweep.gs` (new) and `Tests_EmailSweep.gs` (new) with `EmailLedger.gs`, `CycleReport.gs`, `EmailInfra.gs`, `Tests_EmailInfra.gs`,
`Tests_CycleReport.gs`, `Tests_RunAll.gs`; then run `setupEmailSweepTrigger()` once and `showEmailSweepPlanNow()` (read-only) to see what it would check.
The first run asks Google for Gmail read access if the project does not already hold the full Gmail scope (any `GmailApp` use normally does).

## UI relationships

N/A - backend.

## Architecture relationship

Apps Script backend; a time-driven job (15:45 IST) with a run record watched by the hourly watchdog, and no job lock.

## Related documentation

`docs/_planning/EMAIL_OPS_SYSTEM_AUDIT.md`; `HANDOVER.md` section 4.3.5.

## Relationships

- **Depends On:** `GS-002` (`Core.gs`), `GS-004` (`EmailInfra.gs`), `GS-015` (`EmailLedger.gs`), `SHEET-019`
- **Used By:** `GS-004` (the watchdog schedule reads `EMAIL_SWEEP_HOUR_` / `_MINUTE_`)
- **Related:** `GS-016` (the report that shows its result), `SHEET-021`

## Source of truth

`EmailSweep.gs` at `HEAD`.

## Validation

- **Method:** `Tests_EmailSweep.gs` (the pure matching rules, a sweep against a real ledger with fake Gmail search/threads, an unreadable thread, a failing search, the time budget, the trigger entry points, setup, the watchdog) and `Tests_CycleReport.gs` (the report's bounce/reply section); deliberate regressions (ME1..ME25) each caught.
- **Evidence:** `.github/workflows/test.yml`; the first live sweep (`Email_Ledger` columns U-W).
- **Status:** Validated 2026-10-09 (locally); live behaviour proven by the first sweep.

## Version / change reference

**2026-10-09** (`c18d89f`): file created - Email Ops EO-5. `EmailLedger.gs` gained `emailLedgerReadRowsGs_` / `EMAIL_LEDGER_JOB_LABELS_` (moved from `CycleReport.gs`); `CycleReport.gs` shows a "Bounces and replies" section and lists bounced emails under "Needs attention"; `emailJobScheduleGs_` lists the sweep. **Not live until pasted.**

**2026-10-09** (`93a120a`, Email Ops review): moved from 16:10 to 15:45 so it reliably finishes before the 16:30 report, and the entry point uses `runEmailJobTrackedGs_` instead of `withEmailJobLockGs_` - deliberately WITHOUT the script-wide job lock (a `nearMinute` trigger fires up to 15 minutes either side of its minute, and holding the lock near 17:00 could make the primary 17:00 send skip). **Not live until pasted.**

## Revalidation trigger

Any commit touching `EmailSweep.gs` or `Tests_EmailSweep.gs`; the ledger's sweep columns; the display name every send uses.

## Handover relationship

`HANDOVER.md` section 4.3.5 updated in the same commit.

## Lifecycle / retention

N/A - writes into the ledger's existing rows.

## Next action

After the first live sweep, compare a bounced and a replied email with Gmail once.

## Closure evidence

Record created with the feature; `docs/INDEX.md` `GS-017`.
