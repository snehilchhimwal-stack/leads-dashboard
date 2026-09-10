# TAB-003 — Operations

| | |
|---|---|
| **Type** | `TAB-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `dashboard.html` `#tab-operations` (`#L994`); `js/overview-distribution-people-ops.js` (issue lists) + `js/reports-build.js` / `js/reports-gmail.js` / `js/reports-ui.js` (the region-email panel) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

The action tab. It lists every lead currently failing one of the 5
Operations SLA checks (first-contact breach, not-connected-in-window,
not-updated, stage-stuck-48h, follow-up-overdue, plus the recording /
closed-no-comment / inactive-RM signals) as reviewable cards, and it
hosts the on-demand region-email panel — the same per-region summary
content `OvernightEmailer.gs` / `AllIssuesEmailer.gs` send automatically,
but generated and sent from the browser by a human. It exists so a
manager can both see who is off-SLA and immediately act (generate a
region email, push leads to the human-review queue) in one place.

## Responsibilities

- Render the Operations issue-list cards (one section per SLA check).
- Provide the `.log-toggle` lazy action-log expand on issue cards.
- Host the Generate / Generate-all region-email cycle and the separate
  Gmail connect flow.
- Own "Download Issues CSV".

## Who / what uses it

Regional heads / team leads doing daily SLA triage and sending region
summaries (`CLAUDE.md`, `HANDOVER.md` §3 step 4).

## Inputs (which in-memory state arrays / filter state it reads)

`issueLeads` (the copy-expanded, post-`enrichLead` array — issue cards),
`leads` (region-report population), `filterState` (via `renderAll()` /
the Generate cycle). Recipient lists from `localStorage` (`JS-016`).

## Outputs / what it renders

Issue-list cards into `#tab-operations`; the generated region reports
(HTML preview); a CSV download. Sends: `mailto:` links (`JS-016`) or real
Gmail API messages (`JS-015`, `EXT-002`).

## Data displayed

Per-SLA-check lead cards with lead identity, RM, age, latest comment,
suggested follow-up; the region report previews.

## Data written / modified

Via `JS-018` (`sheets-writeback.js`): `Lead_Followups` upsert
(`SHEET-004`) during the Generate cycle; `Send_Log` append (`SHEET-011`)
after a Gmail send (fire-and-forget). The `_generateCycleOwner` mutex
(`JS-018` `#L275`) stops this cycle and Movement's Overnight cycle
clobbering `Lead_Followups` concurrently.

## Navigation relationships

Reached from `#tabBar`. Shares its issue-list module and `renderAll()`
pass with `TAB-002` / `TAB-005`. The Generate cycle re-calls
`renderMorningBrief` (`TAB-001`) at its checkpoints.

## Buttons / actions — `BTN-XXX` sub-table

| ID | Label | Element id | What it does | Invokes (`FN-XXX`) | Confirm/irreversible? | Failure behaviour |
|---|---|---|---|---|---|---|
| BTN-001 | Download Issues CSV | `#downloadIssuesBtn` | Exports the current issue-lead list as CSV | `downloadIssuesCSV` (`JS-012`) | no (local download) | inert in a sandboxed viewer; no error |
| BTN-002 | Generate | `#generateBtn` | Runs the 3-phase region-report Generate cycle for the selected region | `renderReports` (`JS-016`) | no, but writes `Lead_Followups` | falls back to the algorithmic preliminary report with an "UNREVIEWED" banner if the review wait is cancelled |
| BTN-003 | Generate (all regions) | `#generateAllReportsBtn` | Same cycle across every region | `renderAllRegionReports` (`JS-016`) | no, writes `Lead_Followups` | as BTN-002, per region |
| BTN-004 | Download all reports | `#downloadAllReportsBtn` | Downloads the generated all-region report bundle | `downloadAllReports` (`JS-016`) | no | inert in a sandboxed viewer |
| BTN-005 | Edit region recipients ▾ | `#regionRecipientsToggle` | Opens the per-region To/Cc chip-input editor | recipient-UI toggle (`JS-016`) | no | — |
| BTN-006 | Connect Gmail | `#gmailConnectBtn` | Triggers the **separate** Gmail `gmail.send` OAuth grant | `connectGmail` (`JS-015`) | no (OAuth consent) | consent denial leaves send disabled; message shown |
| BTN-007 | Save Client ID | `#gmailSaveClientIdBtn` | Persists a user-supplied OAuth Client ID override to `localStorage` | Gmail setup handler (`JS-015`) | no | — |
| BTN-008 | Gmail setup ▾ | `#gmailSetupToggle` | Shows/hides the one-time Gmail Client-ID setup fields | toggle (`JS-015`) | no | — |
| BTN-009 | Cancel wait | `#followupsWaitCancelBtn` | Cancels the current human-review wait in the Generate cycle | keyed cancel via `_followupWaitCancelled` Map (`JS-018`) | no | cancelling triggers the "UNREVIEWED" fallback report |

## Non-button UI elements — `UI-XXX` sub-table

| ID | Element | Behaviour | Invokes (`FN-XXX`) |
|---|---|---|---|
| UI-003 | `.log-toggle` on issue cards | lazy-expands the lead's action log | `toggleActionLog` (`JS-010`) |
| UI-004 | region To/Cc chip inputs | `localStorage`-persisted recipient lists | recipient handlers (`JS-016`) |

## Owning module(s)

`JS-012` (issue lists, CSV), `JS-014` (report content), `JS-015` (Gmail
send), `JS-016` (Generate cycle + recipient UI + mailto), `JS-018`
(`Lead_Followups` / `Send_Log` writes). Reciprocal `Used By: TAB-003` on
each.

## Relevant functions

`downloadIssuesCSV` + issue-list `render*` (`JS-012`); `buildRegionReports`
/ `buildAllRegionReports` / `renderReportEmailHTML` (`JS-014`);
`renderReports` / `renderAllRegionReports` / `recipientsForReport` /
`sendReport` (`JS-016`); `performGmailSend` / `connectGmail` (`JS-015`);
`tryClaimGenerateCycle` / `pushLeadsToFollowups` / `logEmailSend`
(`JS-018`). Detail on those records' FN sub-tables.

## Important logic / business rules

- 3-phase Generate: preliminary build → push to `Lead_Followups` → wait
  for human review → rebuild; never sends unreviewed text unlabelled
  (`LOGIC_AUDIT.md` Part 3 §3.9, `JS-016`).
- `_generateCycleOwner` mutex vs Movement's Overnight cycle (`JS-018`).
- `TEST_MODE_OVERRIDE_EMAIL` (`js/reports-ui.js` `#L212`, currently `''`)
  is a live footgun — if set from the console it silently redirects
  every resolved recipient (`LOGIC_AUDIT.md` Part 1 §4c, flagged Part
  6/7).
- The 5 SLA checks themselves are `JS-006` logic, mirrored in `GS-012`.

## Exceptions & error handling

Gmail send failure restores the button to its prior "Sent" state, not a
bare "Send" (`JS-015`). Generate-cycle wait cancelled → algorithmic
fallback report with an "UNREVIEWED" banner (`JS-016`). Concurrent
Generate blocked by the mutex (`JS-018`).

## Architecture relationship

`DASH-001`. Feeds / mirrors `DATA-002` (SLA-flag pipeline) and `DATA-005`
(region-email pipeline).

## Related documentation

`HANDOVER.md` §3 step 4, §4.2 (Gmail grant), §6 (SLA-rule duplication);
`LOGIC_AUDIT.md` Part 3 §3.1 / §3.9, Part 1 §4c; `LEAD_FOLLOWUPS_STALENESS.md`.

## Relationships

- **Depends On:** `JS-012`, `JS-014`, `JS-015`, `JS-016`, `JS-018`,
  `JS-006` (SLA logic), `EXT-002` (Gmail), `SHEET-004`, `SHEET-011`
- **Used By:** `DASH-001`
- **Related:** `TAB-007` (its Overnight Generate cycle shares the
  `Lead_Followups` mutex), `TAB-001` (re-called at checkpoints),
  `GS-010` / `GS-001` (the unattended equivalents of this panel)

## Source of truth

`dashboard.html` `#tab-operations`; `js/overview-distribution-people-ops.js`,
`js/reports-*.js` at `HEAD`.

## Validation

- **Method:** read of `#tab-operations` markup + the issue-list and
  reports code paths at `c82ec67`; button IDs enumerated live from
  `dashboard.html`; cross-check `LOGIC_AUDIT.md` Part 1 §4c + Part 3
  §3.9; `tests/frontend-harness.html` exercises `buildRegionReports` /
  `renderReports` with mocked network.
- **Evidence:** `LOGIC_AUDIT.md` Part 3 §3.9; `tests/frontend-harness.html`;
  live button enumeration (`docs/_planning/button-inventory.md`, DOC-031).
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-026; `BTN-XXX` set
reconciled in DOC-031.

## Revalidation trigger

Any commit touching `js/overview-distribution-people-ops.js`,
`js/reports-build.js`, `js/reports-gmail.js`, `js/reports-ui.js`, or
`js/sheets-writeback.js`'s Generate-cycle code; a button added/removed in
`#tab-operations`; the 3-phase Generate design changes; an SLA check is
added/removed.

## Handover relationship

`HANDOVER.md` §3 step 4 covers the on-demand report flow; §4.2 covers the
Gmail grant. Current as of 2026-09-09. A change to the Generate cycle or
the SLA-check set must update `HANDOVER.md` §3 (and §6 if the mirrored
`.gs` logic moves) in the same commit.

## Lifecycle / retention

N/A — code. (The `Lead_Followups` rows it writes have their own retention
on `SHEET-004`.)

## Next action

none — Closed + Monitored.

## Closure evidence

Record committed for DOC-026; `docs/INDEX.md` `TAB-003` → `Closed +
Monitored`, `Last Verified` 2026-09-10; `BTN-001`..`BTN-009` rows added;
validation evidence as above. No `docs/changes/` record (DOC-026).
