# FLOW-002 — the 3-phase "Generate region emails" cycle

| | |
|---|---|
| **Type** | `FLOW-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `docs/architecture/FLOW-002-generate-cycle.md` (an overlay — no code file of its own) |
| **Owner** | Snehil (default) |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

Two buttons produce per-region summary emails: Operations → **Generate**
(`BTN-002`) and Movement → **Generate Region Emails** (`BTN-016`). Both
need the same thing: a fresh `Lead_Followups` tab with one row per
unresolved lead **plus** the backend's suggested follow-up text filled
in. The backend fills that text on its own schedule, so the browser
cannot just read-and-build in one shot — it has to **write, wait, then
build**. That write→wait→build is this cycle. A module-level mutex stops
the two buttons (or two tabs, or a double-click) from running it
concurrently and corrupting `Lead_Followups`.

## Reason to exist

`Lead_Followups` is a shared mutable tab written from both runtimes. Two
overlapping Generate runs would interleave a clear against a push and
ship half a follow-up queue. The cycle serialises access and makes the
cross-runtime wait explicit and cancellable.

## Participants (in execution order)

| Step | Component (`ID`) | What it does here |
|---|---|---|
| 0 | `TAB-003` `BTN-002` / `TAB-007` `BTN-016` | user clicks Generate; handler calls into `JS-016` (Ops) or `JS-021` → `JS-016` (Movement/Overnight) |
| 1 | `JS-018` `sheets-writeback.js` | `tryClaimGenerateCycle` — claim the `_generateCycleOwner` mutex (`FN-126`, `RELATIONSHIP_MAP.md` §6.3). If already held, abort with a status message |
| 2 | `JS-018` | `clearLeadFollowupsTab` — wipe `Lead_Followups` (`SHEET-004`) rows (fires **pre-Generate**, not post-send — the doc-comment on it was corrected, C-4-adjacent) |
| 3 | `JS-018` | `pushLeadsToFollowups` — write one row per unresolved lead (cols A–E, G; **never** F, which the backend owns) |
| 4 | `JS-016` `reports-ui.js` | `waitForAllFollowups` — poll `Lead_Followups` col F until the backend has filled the suggested text, or the user cancels |
| 4a | `GS-010` `OvernightEmailer.gs` / `GS-005` `FollowupEngine.gs` | the backend side: `pushUnresolvedToLeadFollowups_` / `waitForFollowupSuggestions_` compute and write col F (`FOLLOWUP_SUGGESTIONS` / `_GS_`) |
| 4b | `TAB-003` `BTN-009` / `TAB-007` `BTN-017` | Cancel-wait — sets the per-wait entry in the `_followupWaitCancelled` Map (`JS-018`); the poll in step 4 exits |
| 5 | `JS-014` `reports-build.js` | `buildRegionReports` — group the now-complete `Lead_Followups` rows by region, render the email HTML/text |
| 6 | `JS-016` (mailto) / `JS-015` `reports-gmail.js` + `EXT-002` (Gmail API) | render / send; `JS-018` appends a `Send_Log` (`SHEET-011`) row per send |
| 7 | `JS-018` | release the `_generateCycleOwner` mutex |

## Inputs / Outputs

- **Triggered by:** `BTN-002` (Operations) or `BTN-016` (Movement).
- **Produces:** a populated `Lead_Followups` tab; rendered per-region
  report objects (`window._regionReports`); optional real Gmail sends +
  `Send_Log` rows.

## Data lineage

`SHEET-001` leads → `enrichLead` (`JS-006`) → unresolved set →
`pushLeadsToFollowups` (`JS-018`) → `SHEET-004` cols A–E/G → backend fills
col F (`GS-010`/`GS-005`) → `buildRegionReports` (`JS-014`) → email →
`SHEET-011`. Traced as pure lineage in `DATA-003` (comment/follow-up) +
`DATA-005` (region email).

## Business rules — `RULE-XXX` list

The `_generateCycleOwner` mutex discipline (`JS-018`); the "browser writes
A–E/G, backend owns F" column split (`SHEET-004`); region normalisation +
the Loan override (`JS-014` `RULE-017`/`RULE-018` — the HIGH finding);
`FOLLOWUP_SUGGESTIONS` keyword set kept in sync `JS-007` ↔ `GS-005`
(`RELATIONSHIP_MAP.md` §2).

## Exceptions & failure behaviour

- **Mutex already held** → the second caller aborts immediately with a
  visible status, no writes.
- **Wait cancelled** (step 4b) → the cycle proceeds to build with
  whatever col F it has; partial follow-up text is possible and expected.
- **`_followupWaitCancelled` was a single shared module boolean** — a
  known concurrency bug where the Ops wait and the Movement/Overnight
  wait could cross-cancel; the fix scopes it per in-flight wait (a
  `Map`). See `JS-018` / the redesign plan's bug list.
- Backend never fills col F (trigger down) → the wait times out; the
  cycle still builds and releases the mutex.

## Known limitations

- The wait is a client-side poll with a timeout — a slow backend makes
  Generate feel hung; the Cancel button is the escape hatch.
- Bulk "Send all via Gmail" historically didn't auto-resume after an
  OAuth consent redirect the way the single-send path does (`JS-015`
  `_pendingGmailSend` was single-report-shaped) — see the redesign plan.

## Related documentation

`HANDOVER.md` §3, §6; `LEAD_FOLLOWUPS_STALENESS.md`; `RELATIONSHIP_MAP.md`
§6.3 (`_generateCycleOwner`); `LOGIC_AUDIT.md` Part 2 (follow-up flow).

## Relationships

- **Depends On:** `JS-014`, `JS-015`, `JS-016`, `JS-018`, `JS-021`,
  `GS-005`, `GS-010`, `SHEET-004`, `SHEET-011`, `EXT-002`
- **Used By:** `none` — an architecture overlay; nothing in the catalog
  *depends on* a `FLOW-`. Participants carry their own reciprocal edges
  in `INDEX.md`.
- **Related:** `DATA-003`, `DATA-005` (the lineage views), `FLOW-001`
  (the other scheduled multi-component workflow), `TAB-003` / `TAB-007`
  (the two entry surfaces).

## Source of truth

`js/reports-ui.js` (`waitForAllFollowups`, `tryClaimGenerateCycle` call
sites); `js/sheets-writeback.js` (`_generateCycleOwner`,
`clearLeadFollowupsTab`, `pushLeadsToFollowups`, `_followupWaitCancelled`);
`js/reports-build.js` (`buildRegionReports`); `OvernightEmailer.gs`
(`pushUnresolvedToLeadFollowups_`, `waitForFollowupSuggestions_`). All at
`HEAD`.

## Validation

- **Method:** traced against the `JS-016` / `JS-018` / `JS-021` / `GS-010`
  records at `c82ec67`; `tests/frontend-harness.html` exercises the
  Operations Generate path on synthetic data (not the real Gmail send).
- **Evidence:** `docs/validation/README.md` (`js/*.js` render-pipeline
  row — manual harness); the `JS-`/`GS-` records.
- **Status:** Validated 2026-09-10.

## Version / change reference

Record created by `t-tf-5ad22d8e4c2e` (2026-09-10), forensic-audit P2
item 10. Verified against code at `c82ec67`.

## Revalidation trigger

Any participant record goes `Stale`; the `_generateCycleOwner` /
`_followupWaitCancelled` mechanism changes; the `Lead_Followups` column
split (A–E/G vs F) changes; a third Generate entry point is added.

## Handover relationship

`HANDOVER.md` §3 describes the browser-side flow; §6 lists the
`FOLLOWUP_SUGGESTIONS` pair. Current as of 2026-09-10. A cycle-mechanism
change updates `HANDOVER.md` §3 in the same commit.

## Lifecycle / retention

N/A — an overlay. `Lead_Followups` retention is `TBD` (`DOC-037`);
`Send_Log` `TBD`.

## Next action

none — Closed + Monitored.

## Closure evidence

Record committed for `t-tf-5ad22d8e4c2e`; `INDEX.md` `FLOW-002` row added;
`Depends On` resolves entirely to existing IDs (`check-catalog.py` A).
