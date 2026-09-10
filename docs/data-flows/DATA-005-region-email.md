# DATA-005 — The region-email pipeline

| | |
|---|---|
| **Type** | `DATA-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | traced path — not a file |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

How a flagged lead becomes a per-region summary email — via region
resolution, report building, human-review of follow-ups, and the send —
on **two parallel paths** (on-demand dashboard vs. unattended Apps
Script). This flow carries the one confirmed **HIGH** finding in the
system.

## Origin

The SLA-flagged leads from `DATA-002` (`issueLeads` on the browser;
`computeSlaFlags_` output on the backend), scoped by the
Google-Non-UTM/Search source filter (`passesGoogleNonUtmSearchGs_`,
`GS-004` FN-201) and a date window.

## Transformation

1. **Region resolution:** `effectiveRegion` (`JS-014` FN-094, `RULE-018`)
   — `project_region` / `group_source` = "Loan" overrides the geographic
   region — and `mainRegionFor` (`JS-014` FN-096, `RULE-017`) →
   `REGION_GROUP_MAP`. Backend twin: `mainRegionForGs_` (`GS-004`
   FN-200).
2. **Report build:** `buildRegionReports` / `buildRegionWiseReports` /
   `buildAllRegionReports` (`JS-014` FN-097/098) →
   `renderReportEmailHTML` (`JS-014` FN-100). Backend: the
   `renderOvernightReportEmailHTML_` template (`GS-004` FN-202) in
   `GS-010` / `GS-001`.
3. **Human review (browser):** the 3-phase Generate cycle
   (`renderReports`, `JS-016` FN-111) — push to `Lead_Followups`
   (`SHEET-004`) → wait → rebuild; `_generateCycleOwner` mutex (`JS-018`
   FN-126). Backend: `pushUnresolvedToLeadFollowups_` /
   `waitForFollowupSuggestions_` (`GS-010` FN-235).
4. **Recipient resolution:** `recipientsForReport` (`JS-016` FN-113,
   applying `TEST_MODE_OVERRIDE_EMAIL` if set) / `resolveRecipientEmailsForRegion_`
   (`GS-004` FN-198) → `resolveRecipientBucketsForRms_` (`GS-011` FN-241),
   falling back through `Manager_Directory` (`SHEET-007`) →
   `Region_Recipients` (`SHEET-012`) → `CH_LEVEL_EMAIL_`.
5. **Send:** `performGmailSend` (`JS-015` FN-103, `EXT-002`) /
   `sendOneOvernightEmail_` + `sendOneAllIssuesEmail_` + the threaded
   13:00 reply (`GS-010` FN-232/236 / `GS-001` FN-176).

## Stored As

`Lead_Followups` (`SHEET-004`) during the review phase. After the send:
`Send_Log` (`SHEET-011`, browser, fire-and-forget), `AllIssues_Log`
(`SHEET-013`, `GS-001`), `Overnight_Log` (`SHEET-014`, `GS-010` — with
the `thread_id` the 13:00 run needs).

## Display

`TAB-003` Operations (Generate previews) and `TAB-007` Movement
(Overnight generate previews). The email itself lands in recipients'
inboxes.

## Ultimate consumer(s)

Region email recipients (regional heads / the manager buckets). Also a
human reviewing follow-ups in `Lead_Followups` before the send.

## Retention

Review state: `SHEET-004` (`TBD`, per-cycle, `DOC-036`). Send logs:
`SHEET-011` / `SHEET-013` / `SHEET-014` (all `TBD`, `DOC-036`;
`Overnight_Log` is a prune candidate — only today's rows are functionally
needed).

## What happens on update

A lead's flag/region change re-derives the report on the **next**
Generate (browser) or the **next** scheduled run (10:00 / 13:00 / 17:00).
A human editing `Lead_Followups` column F changes what the pending email
says (that is the whole point of the review phase).

## What happens on delete

A removed lead drops out of the next report. Sent emails and their log
rows are immutable history.

## Known gaps

- **🟠 HIGH — the Loan-region `effectiveRegion` override (`RULE-018`) is
  missing from all 3 scheduled-email call sites** (`GS-001`, `GS-010`,
  and the shared resolution in `GS-004`) — so a Loan lead is emailed to
  its geographic region by the automation but to "Loan" by the
  dashboard. `LOGIC_AUDIT.md` Part 4 §4.4 / Part 7 §18 HIGH — the one
  confirmed live, production-affecting logic conflict. Root cause:
  `project_region` absent from `HEADER_ALIASES_` (`GS-004` CFG-037) and
  `SNAPSHOT_COLUMNS_` (`SHEET-002` CFG-050).
- **`TEST_MODE_OVERRIDE_EMAIL` / `_`** (`JS-016` CFG-024 / `GS-004`
  CFG-039) silently redirects every recipient if left set — a footgun on
  both paths.
- **Unguarded cross-runtime `Lead_Followups` overlap window** (`JS-018`
  EXC-038 / `LOGIC_AUDIT.md` Part 7 §18 MEDIUM #3) — the dashboard
  Generate cycle and `OvernightEmailer.gs` can write the tab at once.
- "Possible Premature Closes" (`JS-014` `RULE-019`) has **no**
  scheduled-email equivalent (`LOGIC_AUDIT.md` Part 7 §18 LOW #1).

## Exceptions & error handling

Review wait cancelled → algorithmic fallback report with an "UNREVIEWED"
banner, never unlabelled (`JS-016` EXC-029 / `GS-010` EXC-081).
Concurrent Generate blocked intra-runtime by the mutex (`JS-018`
EXC-035). Send failure: browser restores the button preserving a prior
"Sent" state (`JS-015` EXC-027); backend retries via `withSendRetry_`
then ops-alerts (`GS-004` EXC-063). `GmailThread.reply()` misroute
worked around by the Advanced Gmail Service (`GS-010` EXC-080).

## Architecture relationship

`DASH-001` (on-demand path) + the Apps Script backend (scheduled path).
`LOGIC_AUDIT.md` Part 1 §1 layers 13, 14, 12, 17, 18.

## Related documentation

`HANDOVER.md` §3 step 4, §4.2, §4.3, §6; `LEAD_FOLLOWUPS_STALENESS.md`;
`OPS_CHECKLIST.md`; `LOGIC_AUDIT.md` Part 3 §3.5/§3.7/§3.9, Part 4 §4.3/§4.4,
Part 7 §18 HIGH / MEDIUM #3 / LOW #1.

## Relationships

- **Depends On:** `DATA-002`, `DATA-003`, `SHEET-004`, `SHEET-006`,
  `SHEET-007`, `SHEET-012`, `JS-014`, `JS-015`, `JS-016`, `JS-018`,
  `GS-001`, `GS-004`, `GS-010`, `GS-011`, `EXT-002`
- **Used By:** `TAB-003`, `TAB-007`; `SHEET-011`, `SHEET-013`,
  `SHEET-014`; email recipients
- **Related:** `DATA-003` (supplies the follow-up text that rides in the
  email)

## Source of truth

`js/reports-build.js` `effectiveRegion` `#L80` / `buildRegionReports`
`#L410`; `js/reports-ui.js` `renderReports` `#L387`; `js/reports-gmail.js`
`performGmailSend` `#L270`; `OvernightEmailer.gs` `sendOvernightMorningEmails_`
`#L465`; `AllIssuesEmailer.gs` `sendAllIssuesEmails_` `#L153`;
`EmailInfra.gs` `resolveRecipientEmailsForRegion_` `#L336`.

## Validation

- **Method:** traced against `LOGIC_AUDIT.md` Part 3 §3.5/§3.7/§3.9 +
  Part 4 §4.3/§4.4 (the region-map diff + the HIGH Loan finding) + Part 7
  §18 at `c82ec67`. `tests/frontend-harness.html` runs
  `buildRegionReports` / `renderReports` (mocked I/O + wait);
  `Tests_OvernightEmailer.gs` / `Tests_AllIssuesEmailer.gs` /
  `Tests_EmailInfra.gs` / `Tests_RmHierarchy.gs` cover the backend path.
- **Evidence:** `LOGIC_AUDIT.md` Part 4 §4.4, Part 7 §18;
  `.github/workflows/test.yml`; `tests/frontend-harness.html`.
- **Status:** Validated 2026-09-10 (flow is correct as documented; the
  HIGH finding is a **known unresolved defect within the flow**, not a
  doc gap).

## Version / change reference

Verified at `c82ec67`; record created by `DOC-034`.

## Revalidation trigger

`effectiveRegion` / `REGION_GROUP_MAP` (or the `_GS_` twins) changes; the
HIGH Loan-region finding is fixed (port `effectiveRegion` to the `.gs`
side + add `project_region` to `HEADER_ALIASES_`); the 3-phase Generate
cycle or the recipient-resolution fallback order changes; `SHEET-004` /
`SHEET-011` / `SHEET-013` / `SHEET-014` columns change; the `gmail.send`
scope changes.

## Handover relationship

`HANDOVER.md` §3 step 4 covers the on-demand path; §4.2/§4.3 the send
config; §6 the region-map duplication. Current as of 2026-09-09. Fixing
the HIGH finding must update `HANDOVER.md` §6, both runtimes, and both
alias tables in the same commit, and run `OPS_CHECKLIST.md`.

## Lifecycle / retention

Review state per-cycle (`SHEET-004`). Send logs `TBD` (`SHEET-011` /
`SHEET-013` / `SHEET-014`, `DOC-036`).

## Next action

**Fix the HIGH Loan-region finding** (`LOGIC_AUDIT.md` Part 4 §4.4 / Part
7 §18) — port `effectiveRegion` to the scheduled-email call sites and add
`project_region` to `HEADER_ALIASES_` + `SNAPSHOT_COLUMNS_`. Tracked on
`JS-014` / `GS-001` / `GS-010` / `GS-004`; this record's revalidation
trigger names it.

## Closure evidence

Record committed for `DOC-034`; `docs/INDEX.md` `DATA-005` row →
`Closed + Monitored` (the flow's documentation is complete and verified;
the HIGH finding is recorded as a known in-flow defect); `Depends On`
resolves entirely to existing IDs. No `docs/changes/` record (`DOC-034`).
