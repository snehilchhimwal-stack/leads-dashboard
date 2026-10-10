# GS-022 - EmailReroute.gs

| | |
|---|---|
| **Type** | `GS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `EmailReroute.gs` |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-10-10 against commit `000c1e6` - plain-text column constant for the tab pre-creation helper (no behaviour change) |

## Purpose / reason to exist

Decision D9 (2026-10-10, the user): **when an email bounces, it goes to the person next in the hierarchy; if nobody is above, to Snehil** - the bounced email itself AND that bucket's
later follow-ups (the 10:00 Checkpoint 1, the 13:00 reply, the next day's 17:00 email). Before this, a bounce was only reported ("fix the address and send it by hand - nothing re-sends
it automatically") and the follow-ups kept going to the dead address.

It works at the one place every report email passes: the bounce sweep (`GS-017`) records the dead address with its replacement in the `Email_Reroutes` tab (`SHEET-025`), and
`sendGuardedEmailGs_` (`GS-004`) and `sendThreadedGmailReply_` (`GS-010`) swap a dead address for its replacement just before the safety gate. Nothing upstream changes: `AllIssues_Log`,
`Overnight_Log` and the ledger keep the ORIGINAL address, so the audits, the follow-up tracker and every "already sent today" guard see what they always saw. The replacement's copy
opens with a banner saying whom the email was meant for and why it came to them. The bounced email itself is re-sent from its own Gmail message, once, and recorded as its own ledger row.

## Responsibilities

- Keep the table of redirected addresses (`emailRerouteReadEntriesGs_`, `emailRerouteRecordGs_`, `endAllEmailReroutesNow`), read it at most once per two minutes of a run, and decide which rows are in force at a moment (`emailRerouteIsActiveGs_`, `emailRerouteMapGs_`).
- Follow a chain of replacements to its end with a loop/length guard (`emailRerouteResolveGs_`) and translate a To/Cc pair (`emailRerouteTranslateAddressesGs_`).
- Pick who is next from the dead person's own `RM_Hierarchy` row - TL, TM, RH, CH, the first with an email - else the ops address (`emailRerouteNextGs_`).
- Redirect an outgoing message and put the banner in front of it (`emailRerouteApplyGs_`), leave a note for the ledger row (`emailRerouteTakeNoteGs_`).
- After a bounce (`emailRerouteHandleBouncesGs_`, called by the sweep on EVERY bounced row of the last 3 days, idempotently): record a row for each bounced address, re-send a bounced To email once while its window is open (`emailRerouteWindowOpenGs_`, `emailRerouteResendGs_`), and say what was done for the alert.
- Tell the sweep which address an email REALLY went to (`emailRerouteEffectiveAddressesGs_`), because a bounce names that one.

## Trigger schedule

None of its own - it runs inside the four bounce checks (`GS-017`: 10:30, 13:30, 15:30, 17:30) and inside every send.

## Requires `setupXxx()` re-run when

Never for this file. (`setupEmailSweepTrigger()` of `GS-017` must be re-run once because it now installs four triggers.)

## Significant functions - `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-427 | `emailRerouteIsActiveGs_` / `emailRerouteMapGs_` / `emailRerouteResolveGs_` / `emailRerouteTranslateAddressesGs_` | table rows, a moment, addresses | which rows are in force; `{ dead: row }`; the end of a chain; `{ to, cc, changes }` | none (pure) | - | FN-430, FN-432 | specific - RULE-068 |
| FN-428 | `emailRerouteNextGs_(data, deadEmail, nameHint, opsEmail)` | the hierarchy data, the dead address, the bucket name, the ops address | `{ email, name, role, via, deadName }` or null | none (pure) | - | FN-432 | specific - RULE-068 |
| FN-429 | `emailRerouteReadEntriesGs_` / `emailRerouteEntriesCachedGs_` / `emailRerouteRecordGs_` / `endAllEmailReroutesNow` / `showEmailReroutesNow` | the workbook | the rows; a new row; a count | reads/writes `Email_Reroutes` (`SHEET-025`); the cache is per run (two minutes) | `emailLedgerEnsureSheetGs_`, `emailLedgerAppendBlockGs_` (`GS-015`) | FN-430, FN-432, `GS-016`, `GS-017` | specific - RULE-069 |
| FN-430 | `emailRerouteApplyGs_(msg)` / `emailRerouteBannerGs_` / `emailRerouteNoteTextGs_` / `emailRerouteTakeNoteGs_` / `emailRerouteClearNoteGs_` | an outgoing message | the message to send (a dead address swapped, a banner in front) or the same object | none; sets the note the ledger row will carry | FN-427, FN-429, `esc_` (`GS-002`) | `sendGuardedEmailGs_` (`GS-004`), `sendThreadedGmailReply_` (`GS-010`), `GS-015` | specific - RULE-071 |
| FN-431 | `emailRerouteResendGs_(ss, row, now)` / `emailRerouteWindowOpenGs_(row, now)` | a bounced ledger row | `{ ok, text }`; whether it may still be re-sent | reads the original Gmail message; one email; one `reroute` ledger row (`RR|<email id>`) | `emailLedgerTrackSendGs_` (`GS-015`), `sendGuardedEmailGs_` (`GS-004`) | FN-432 | specific - RULE-070 |
| FN-432 | `emailRerouteHandleBouncesGs_(ss, items, ledgerRows, now)` / `emailRerouteEffectiveAddressesGs_` / `emailRerouteHierarchyGs_` | the bounced ledger rows with their bounce messages | `{ emailId: { action, text } }` | records rows; re-sends; never throws to the sweep | FN-427..FN-431, `loadRmHierarchyAndEmails_` (`GS-011`), `opsAlertEmailGs_` (`GS-004`) | `sweepEmailBouncesAndReplies_` (`GS-017`) | specific - RULE-070 |

## Business rules implemented - `RULE-XXX` sub-table

| ID | Rule | Where | Duplicated elsewhere? |
|---|---|---|---|
| RULE-068 | A dead To address is replaced by the person next in the hierarchy: from the dead person's own `RM_Hierarchy` row TL, TM, RH, CH - the first with an email in `Manager_Directory` and a different address; nobody (or an address that is nobody in the directory) = the ops address, marked `ops fallback`. A dead Cc is replaced the same way, or DROPPED when its chain ends at the ops fallback (the ops address is not added to other people's mail); a replacement already in To is not repeated in Cc. A replacement that bounces gets its own row, so the chain climbs one level per bounce and ends at the ops address; a loop or a chain longer than 6 falls back to the original address. The ops address itself has nobody above it - nothing is re-routed for it | FN-427, FN-428 | the dashboard's manual flow is NOT re-routed (decision D9: left as it is) |
| RULE-069 | A row lasts 14 days (then the dead address is tried again), is ignored once ended (`endAllEmailReroutesNow()`), and never applies to an email sent before it was created. A second bounce of an address that already has a row in force adds no row. A row stops mattering by itself when the directory holds a different address for the person | FN-429 | - |
| RULE-070 | The bounced email is re-sent ONCE, from its own Gmail message (`message_id` in the ledger), to the replacement, only while the original job's late-send window is open (17:00 -> 18:30, 10:00 -> 12:45, 13:00 -> 16:00, on the email's own IST day - decision D5; a copy that bounces again gets 3 hours). Every bounced row is looked at on every check, so a step that failed (the hierarchy could not be read, the send failed or was refused by the gate) is retried until the window closes; a copy left `ACCEPTED` / `UNCONFIRMED` / `ATTEMPTING` is never sent again; one left `FAILED` / `BLOCKED` is. Only a bounce of the To address triggers a re-send (a Cc bounce changes the Cc only); reports that go to the ops address are never re-routed | FN-431, FN-432 | `GS-015` RULE-046 (the same no-duplicate-send principle) |
| RULE-071 | The redirect happens on the payload that is really sent, BEFORE the safety gate (so the gate judges it), leaves the stored recipients (logs, ledger) unchanged, puts a banner in the html and plain text when a To changed, and is written into the ledger row of that send (`status_reason`: "re-routed to X (the bounced Y)"). It is fail-open: any error, an unreadable table, TEST MODE, or no row in force = the email goes to its original address, untouched (the very same object) | FN-430 | - |

## Config constants - `CFG-XXX` sub-table

| ID | Constant | Value | Meaning | Changing it affects |
|---|---|---|---|---|
| CFG-122 | `EMAIL_REROUTE_DAYS_`, `EMAIL_REROUTE_MAX_HOPS_`, `EMAIL_REROUTE_CACHE_MS_`, `EMAIL_REROUTE_RESEND_MAX_HOURS_` | `14`, `6`, 120000, `3` | how long a row lasts; the longest chain followed; how long the table is cached in a run; the window for a copy that bounces again | how long a dead address stays redirected; the chain depth; the read cost; how late a second-level copy may still go |

## Exceptions - `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-140 | the hierarchy (`RM_Hierarchy` / `Manager_Directory`) cannot be read after a bounce | no row is made and nothing is sent to a guessed person; the outcome is `ERROR`; the next check retries | the alert says "no re-route made yet ... the next check retries" |
| EXC-141 | the original email cannot be copied (no Gmail message id recorded, or Gmail cannot read it, or the gate refuses the copy) | the redirect row is still made (later emails are redirected); nothing is re-sent; the outcome says why | the alert says "NOT re-sent ..." with the reason |
| EXC-142 | the `Email_Reroutes` tab cannot be read when an email is sent | the table reads as empty; the email goes to its original address | none - exactly the behaviour before this file existed |

## Data lineage

`SHEET-019` `Email_Ledger` bounced row + the bounce message (`GS-017`) -> FN-432 -> `RM_Hierarchy` / `Manager_Directory` (`SHEET-006` / `SHEET-007`, via `GS-011`) -> a row in `Email_Reroutes` (`SHEET-025`) -> every later send through `sendGuardedEmailGs_` / `sendThreadedGmailReply_`; the copy -> a `reroute` row in `SHEET-019`.

## Sheets touched

| `SHEET-XXX` | Read / Write | Which `FN-XXX` | Notes |
|---|---|---|---|
| `SHEET-025` `Email_Reroutes` | Read + append; status cell on a manual end | FN-429, FN-432 | created on the first bounce |
| `SHEET-019` `Email_Ledger` | Write (through the ledger API) | FN-431 | the copy's own row, job `reroute` |
| `SHEET-006` / `SHEET-007` `RM_Hierarchy` / `Manager_Directory` | Read (through `GS-011`) | FN-432 | who is above the dead person |

## Failure / error behaviour

Fail-open everywhere (see RULE-071, EXC-140..142). A bounce record is written BEFORE the escalation runs, so a failure here never loses it.

## Cross-runtime duplication

None - backend only. The dashboard's manual "Generate region emails" flow does not re-route (decision D9).

## Not live until pasted

Paste `EmailReroute.gs` (new), `Tests_EmailReroute.gs` (new), `EmailSweep.gs`, `EmailInfra.gs`, `OvernightEmailer.gs`, `EmailLedger.gs`, `CycleReport.gs`, `DailyChecklist.gs`, `FollowupTracker.gs`, `Tests_EmailSweep.gs`, `Tests_EmailInfra.gs`, `Tests_CycleReport.gs`, `Tests_RunAll.gs`; then re-run `setupEmailSweepTrigger()` once (it now installs four triggers and removes the old 15:45 one). Until then bounces are only reported, as before.

## UI relationships

N/A - backend.

## Architecture relationship

Apps Script backend; a pure/near-pure helper layer used by the sweep and by the two send functions.

## Related documentation

`docs/_planning/EMAIL_OPS_SYSTEM_AUDIT.md` (D9 design); `docs/EMAIL_OPS_OPERATING_MANUAL.md`; `HANDOVER.md` section 4.3.5.

## Relationships

- **Depends On:** `GS-001`, `GS-002`, `GS-004`, `GS-010`, `GS-011`, `GS-015`, `SHEET-019`, `SHEET-025`
- **Used By:** `GS-004`, `GS-010`, `GS-015`, `GS-016`, `GS-017`, `SHEET-025`
- **Related:** `GS-019`, `GS-020`, `SHEET-006`, `SHEET-007`

## Source of truth

`EmailReroute.gs` at `HEAD`.

## Validation

- **Method:** `Tests_EmailReroute.gs` - the table (in force / expired / ended / newest wins), the chain (loop, limit), the translation (To, Cc, ops fallback, dedupe), the banner (escaped), who is next (every tier, shared address, no email, no hierarchy, the ops address), the re-send window (each job, the email's own day), the table on a sheet (record, no duplicate, expiry, cache, end), the redirect inside the real senders (draft and threaded raw MIME, Cc, gate, TEST MODE, expiry, fail-open), then the real sweep against a ledger with a bounce: the whole story (alert, ledger row, follow-ups, no second copy), Cc only, the chain climbing, too late, the hierarchy unreadable then readable, the ops fallback, the original not copyable, the gate refusing the copy, the send failing then succeeding, UNCONFIRMED never repeated, CH-level reports, TEST MODE, bounce-only checks, entry points/triggers/watchdog, and the report/checklist/tracker reading the outcome; 69 deliberate regressions, 68 caught (the survivor is equivalent: the redirect note is also cleared by the next send).
- **Evidence:** `.github/workflows/test.yml`; the first live bounce.
- **Status:** Validated 2026-10-10 (locally, 15 clock times and zones); live behaviour proven by the first bounce.

## Version / change reference

**2026-10-10** (`ec19415`): file created - Email Ops EO-13, decision D9. `EmailSweep.gs` now checks four times a day and hands every bounce to this file; `sendGuardedEmailGs_` / `sendThreadedGmailReply_` redirect; `EmailLedger.gs` writes the redirect note; the 16:30 report, checklist stage J and the follow-up tracker read the outcome. **Not live until pasted.**

**2026-10-10** (`000c1e6`): `EMAIL_REROUTE_TEXT_COLUMNS_` constant (shared with `precreateEmailOpsTabsNow`, `GS-015`); no behaviour change **Not live until pasted.**

## Revalidation trigger

Any commit touching `EmailReroute.gs` or `Tests_EmailReroute.gs`; the shape of an `Email_Ledger` row; `sendGuardedEmailGs_` / `sendThreadedGmailReply_`; the late-send cutoffs; `loadRmHierarchyAndEmails_`.

## Handover relationship

`HANDOVER.md` section 4.3.5 updated in the same commit.

## Lifecycle / retention

Rows in `Email_Reroutes` are never removed (a handful a month); see `SHEET-025`.

## Next action

After the first live bounce, compare the banner, the re-sent copy and the `Email_Reroutes` row with what the recipient actually received.

## Closure evidence

Record created with the feature; `docs/INDEX.md` `GS-022`.
