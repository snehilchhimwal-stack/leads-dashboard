# SHEET-025 - Email_Reroutes

| | |
|---|---|
| **Type** | `SHEET-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | Google Sheet, tab `Email_Reroutes` |
| **Owner** | Snehil |
| **Component Status** | Active (created by the first bounce after `GS-022` is pasted) |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-10-10 against commit `PENDING_SHA` - created (Email Ops EO-13, decision D9) |

## Purpose / reason to exist

The list of email addresses that bounced and who receives their mail instead (decision D9: the person next in the hierarchy, or the ops address when nobody is above). While a row is in
force, every report email addressed to the dead address - the 10:00 and 13:00 follow-ups and the next day's 17:00 email as much as the bounced one - goes to the replacement, with a banner
(`GS-022`). The row is also the visible reminder that an address needs fixing in `Manager_Directory`.

## Data stored

Per row: `created_at`, `expires_at` (created + 14 days), `dead_email`, `dead_name`, `new_email`, `new_name`, `new_role`, `via` (`hierarchy` or `ops fallback`), `source_email_id` (the ledger
email that proved it), `source_job`, `status` (`ACTIVE` or `ENDED`), `note` (`cc only` when only a Cc address bounced).

## Source of the data

`GS-022` `emailRerouteRecordGs_`, called by the bounce sweep (`GS-017`) the first time it sees a bounce for an address that has no row in force. Written only by code, except that a person may edit
`status` to `ENDED` (or run `endAllEmailReroutesNow()`) to stop a redirect early. TEST MODE writes nothing.

## Destination / consumers

Every outgoing report email (through `sendGuardedEmailGs_` and `sendThreadedGmailReply_`), the bounce sweep (to match a bounce to the address an email really went to), and the 16:30 report
("Re-routed addresses in force").

## Columns / fields

See "Data stored"; exact list: `EmailReroute.gs` `EMAIL_REROUTE_HEADERS_`. Addresses are internal manager addresses.

## Writers

| Writer | `FN-XXX` | Mode |
|---|---|---|
| `GS-022` | `emailRerouteRecordGs_` (FN-429) | append one row |
| a person | the `status` cell, or `endAllEmailReroutesNow()` | mark `ENDED` |

## Readers

| Reader | `FN-XXX` | Notes |
|---|---|---|
| `GS-022` | `emailRerouteEntriesCachedGs_` (FN-429) | at most once per two minutes of a run |
| `GS-016` | `cycleReportRerouteRowsGs_` | for the 16:30 report |

## Automation / triggers touching it

The bounce checks (10:30, 13:30, 15:30, 17:30; `GS-017`) write it; every send reads it.

## Apps Script functions touching it

`GS-022`: `emailRerouteReadEntriesGs_`, `emailRerouteRecordGs_`, `endAllEmailReroutesNow`, `showEmailReroutesNow`; `GS-016`: `cycleReportRerouteRowsGs_`.

## Data Lifecycle

- **Data Type:** historical (one row per dead address per 14 days; a handful a month).
- **Retention Period:** none.
- **Enforced By:** None - rows expire by their `expires_at` but stay in the tab.
- **Archive / Delete Behavior:** nothing removes rows; delete old `ENDED`/expired rows by hand if the tab grows.
- **Sensitivity:** internal manager names and email addresses; no lead data.

## Sensitivity & operational importance (DOC-038)

- **Operational importance:** **MEDIUM** - a wrong `ACTIVE` row redirects a person's mail; a missing one only means a bounce is not yet escalated.
- **Data sensitivity:** contact emails of internal managers (the same the ledger and `Manager_Directory` already hold).
- **Reason:** it changes who receives report emails.

## Risks of changing this tab's structure

`GS-022` reads and writes the 12 columns positionally and refuses to write into a tab whose header it does not recognise (`emailLedgerEnsureSheetGs_`): never reorder or rename a column. Setting a row's
`status` to anything but `ACTIVE` ends it. Editing `new_email` redirects to that address.

## Relationships to other tabs

Built from `SHEET-019` (the bounced ledger row) and `SHEET-006` / `SHEET-007` (who is above the dead person); the copy it causes is a row in `SHEET-019`.

## Important logic / business rules

`RULE-068`..`RULE-071` in `GS-022`.

## Exceptions & error handling

An unreadable tab reads as empty (emails go to their original addresses): `GS-022` `EXC-142`.

## Related documentation

`docs/_planning/EMAIL_OPS_SYSTEM_AUDIT.md` (D9); `docs/EMAIL_OPS_OPERATING_MANUAL.md`; `HANDOVER.md` section 4.3.5.

## Relationships

- **Depends On:** `GS-022`, `EXT-001`
- **Used By:** `GS-016`, `GS-022`
- **Related:** `SHEET-006`, `SHEET-007`, `SHEET-019`

## Source of truth

The live tab; header authored in `EmailReroute.gs` (`EMAIL_REROUTE_HEADERS_`).

## Validation

- **Method:** `Tests_EmailReroute.gs` (create, no duplicate, expiry, end, cache, an unreadable tab), mutation-proved.
- **Evidence:** `.github/workflows/test.yml`.
- **Status:** Validated 2026-10-10 (locally); live behaviour proven by the first bounce.

## Version / change reference

**2026-10-10** (`PENDING_SHA`): tab created. **Not live until pasted.**

## Revalidation trigger

The header constant changes; the meaning of `status`, `via` or `note` changes.

## Handover relationship

`HANDOVER.md` section 4.3.5.

## Lifecycle / retention

None yet.

## Next action

After a month, look at how many rows there are and whether any address was redirected for a transient reason (a full mailbox).

## Closure evidence

Record created with the feature; `docs/INDEX.md` `SHEET-025`.
