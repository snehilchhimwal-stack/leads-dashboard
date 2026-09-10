# SHEET-011 — Send_Log

| | |
|---|---|
| **Type** | `SHEET-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | Google Sheet, tab `Send_Log` |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

An append-only record of every region email the **dashboard** sends (via
Gmail or `mailto:`) — subject, recipients, region, lead count, who sent
it. It exists so there is a durable "we sent X to Y at Z" trail for the
on-demand sends, independent of anyone's Gmail Sent folder. The write is
**fire-and-forget** — a failure to log never blocks the send.

## Reason to exist

To answer "did we send the SoBo digest today, and to whom" without
digging through a person's mailbox — an audit trail for the human-driven
send path.

## Data stored

One row per dashboard-initiated send.

## Source of the data

`JS-018` `logEmailSend` (+ `ensureSendLogSheet_` to create the tab),
called fire-and-forget from `JS-015` `performGmailSend` and the
`mailto:` path.

## Destination / consumers

**None in code.** A manual audit surface.

## Columns / fields

| Column | Type | Meaning |
|---|---|---|
| `sent_at` | datetime | when the send happened |
| `issue_key` / `issue_label` | text | which SLA digest |
| `region` | text | the region emailed |
| `subject` | text | the email subject |
| `to` / `cc` | text | resolved recipients |
| `lead_count` | number | leads covered |
| `sent_by` | text | the signed-in user's email |

Exact list: `js/sheets-writeback.js` `SEND_LOG_COLUMNS` `#L115`.

## Writers

| Writer | `FN-XXX` | Mode |
|---|---|---|
| `JS-018` | `logEmailSend` (FN-130) | append (fire-and-forget) |
| `JS-018` | `ensureSendLogSheet_` (FN-130) | create the tab + header if missing |

## Readers

| Reader | `FN-XXX` | For |
|---|---|---|
| *(none in code)* | — | manual audit only |

## Automation / triggers touching it

None — written only by the dashboard's send buttons (`BTN-002`..`BTN-004`,
`BTN-016` via `JS-015`). The **scheduled** emails log to `SHEET-013`
(`AllIssues_Log`) / `SHEET-014` (`Overnight_Log`) instead, not here.

## Apps Script functions touching it

None — this tab is written only from the browser (`JS-018`).

## Data Lifecycle (DOC-019 — completed by `DOC-036`, 2026-09-10)

- **Data Type:** historical (audit log).
- **Retention Period:** **`TBD` — no pruning function found.** grep at
  `9cafa68`: no `prune*_` and **no `clear*` function of any kind**
  touches this tab. Grows unbounded in practice (~a few rows per
  Generate/send). Not invented — feeds `DOC-037`.
- **Enforced By:** `None`.
- **Archive / Delete Behavior:** grows unbounded; no automated or manual
  removal path exists.
- **Sensitivity:** operational — contains recipient email addresses +
  the signed-in sender's email. `DOC-038` for the operational-importance
  classification (read by no code — a pure audit surface).

## Sensitivity & operational importance (DOC-038)

- **Operational importance:** **LOW** — display / audit-trail only — no automated dependency; losing it loses history, nothing stops working.
- **Data sensitivity:** recipient + sender email addresses.
- **Reason:** **No code reads it** — a dashboard-send audit trail; nothing breaks if it is gone. Holds resolved recipient addresses + the signed-in sender's email (a data-minimisation consideration, no operational one).

## Risks of changing this tab's structure

Only `JS-018` writes it, so a column change is a single-file edit — but
because the write is fire-and-forget, a broken write is **silent** (no
error surfaces). A self-healing header check like the other log tabs
have is **not** present here — a header/order mismatch would corrupt
rows quietly. `DOC-036` / a future task should consider adding one.

## Relationships to other tabs

Records sends of the region digests built from `SHEET-001` (`leads`)-
derived issues. Sibling to `SHEET-013` / `SHEET-014` (the scheduled
emailers' own logs).

## Important logic / business rules

Fire-and-forget — the send is authoritative, the log is best-effort
(`JS-018` EXC-037). Populated with the **resolved** recipients (after
`recipientsForReport`, including any `TEST_MODE_OVERRIDE_EMAIL` — so a
misconfigured override would be visible here).

## Exceptions & error handling

A logging failure is swallowed (EXC-037). Missing tab → `ensureSendLogSheet_`
creates it on the next send.

## Related documentation

`HANDOVER.md` §2; `LOGIC_AUDIT.md` Part 1 §1 (datastore), §4c.

## Relationships

- **Depends On:** `JS-015` (the caller), `JS-018`, `EXT-001`, `EXT-002`,
  `DATA-005`
- **Used By:** `DASH-001` (write side, via `TAB-003` / `TAB-007`),
  `TAB-003`, `TAB-007`, `JS-015`, `JS-018`, `JS-021` — no code reader
- **Related:** `SHEET-013` (`AllIssues_Log`), `SHEET-014`
  (`Overnight_Log`) — the scheduled-email equivalents

## Source of truth

The live `Send_Log` tab; schema `SEND_LOG_COLUMNS`
(`js/sheets-writeback.js`).

## Validation

- **Method:** column list read from `SEND_LOG_COLUMNS` `#L115` at
  `c82ec67`; the fire-and-forget behaviour + no-reader status
  cross-checked against `LOGIC_AUDIT.md` Part 1 §4c.
  `tests/frontend-harness.html` exercises `logEmailSend` (write boundary
  mocked).
- **Evidence:** `LOGIC_AUDIT.md` Part 1 §4c; `tests/frontend-harness.html`.
- **Status:** Validated 2026-09-10 (non-lifecycle); lifecycle `TBD`
  (`DOC-036`).

## Version / change reference

Verified at `c82ec67`; record created by `DOC-032`.

## Revalidation trigger

`SEND_LOG_COLUMNS` changes; a reader or a prune policy is added; a
self-healing header check is added; the scheduled emailers start writing
here.

## Handover relationship

`HANDOVER.md` §2 lists it among the datastore tabs. Current as of
2026-09-09. A schema change must update `HANDOVER.md` §2.

## Lifecycle / retention

`TBD` — deferred to `DOC-036`. Currently **unbounded** (no prune, no
clear); `DOC-036` confirms whether that is intentional and whether a
self-healing header check is warranted.

## Next action

`DOC-036` — decide/record retention + sensitivity; consider a
self-healing header check (this tab lacks one, unlike its siblings).

## Closure evidence

Record committed for `DOC-032`; `docs/INDEX.md` `SHEET-011` → `Closed +
Monitored` (non-lifecycle scope), `Last Verified` 2026-09-10; columns
sourced from `SEND_LOG_COLUMNS`, not approximated; Data Lifecycle `TBD`
per `DOC-032` boundary.
