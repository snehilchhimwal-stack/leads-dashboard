# `docs/` — Component Catalog Index

The central lookup table for every meaningful component of the Leads
Dashboard system, and the front matter explaining what this catalog is.

Built by `DOC-013` (this introduction) + `DOC-021` (the seeded table),
to the **extended Governance Model** (see
`../DOCUMENTATION_PROJECT_PLAN.md` → Governance Model).

---

## What this is, and how it relates to the other two root docs

This project deliberately runs **three** documentation artifacts, each
with a different job — this catalog does **not** replace either of the
other two:

| Artifact | Job | Shape |
|---|---|---|
| `../HANDOVER.md` | Onboarding narrative + incident history — *why does the project look like this, what has broken before* | One flowing document, read start-to-finish |
| `../LOGIC_AUDIT.md` | A **dated, point-in-time** system-wide logic/connection audit — *what was true when it ran (2026-09-07)* | 7-part frozen report, not maintained forward |
| **`docs/` (this catalog)** | *What is this exact component, right now, what does it touch, and is its record still correct* | One small record per component, individually owned, cross-referenced by stable ID |

### Why a separate system, not an expansion of `HANDOVER.md`

`HANDOVER.md` is a single narrative file. It has no natural boundary
between "the part about `SlaEngine.gs`" and "the part about
`RmHierarchy.gs`" — editing one risks touching prose that reads through
both — and finding a narrow technical answer means searching a
1,000+-line document. A catalog needs one clearly-bounded record per
component so an edit to `JS-014` never touches `JS-015`, and so a
narrow question ("what calls this function") is answered by opening one
record, not reading everything.

### Why not `LOGIC_AUDIT.md`

`LOGIC_AUDIT.md` is intentionally a **point-in-time audit** — findings,
diffs, and a severity ranking dated to when it ran. Turning it into a
continuously-edited source of truth would destroy the one thing it's
for: a dated record of what was true on 2026-09-07. **Start with
`LOGIC_AUDIT.md` Part 1 for the architecture overview** — this catalog
is its living, component-level complement, not a replacement.

### The three-document relationship, as a rule

`HANDOVER.md` (narrative + history) **+** `LOGIC_AUDIT.md` (frozen
audit) **+** `docs/` (living component catalog). A code change updates
the relevant `docs/` record(s) and — if architecturally significant —
`HANDOVER.md` §1–§3 in the **same commit**; `LOGIC_AUDIT.md` is never
edited forward.

---

## Maintenance model — read this before trusting any record

**The catalog is partly enforced automatically; the rest is process.**
As of 2026-09-10:

- `test/check-catalog.py` (CI, blocking; `t-tf-5ad22d8e4c2e`) **fails the
  build** on: (A) a broken `Depends On` / `Used By` back-link in this
  file, (B) an `INDEX.md` row with no record file or a record file with
  no row (all 7 own-file types), (C) an `INDEX.md` `Location` naming a
  `js/`/`.gs` file that was deleted/renamed/moved. It also **prints**
  (advisory): (D) any record whose `Last Verified` commit is behind
  `HEAD` on its `## Location` path, and (E) for each push, the component
  IDs the changed paths touch + their 1-hop impact + a ready-to-run
  `update-tasks.ps1` ops JSON for the revalidation task.
- `test/check-docs-coverage.js` (`CI-001`–`CI-005`) **warns** on
  `js/*.js` / `.gs` file↔record existence and `HANDOVER.md` age
  (superseded for coverage by `check-catalog.py` B; kept for the
  `HANDOVER.md` age signal).
- **Still process, done by whoever makes the change** — the human half
  of the loop (`DOCUMENTATION_PROJECT_PLAN.md` Change-Control Mechanism
  steps 7–10): actually re-reading a flagged record against the code,
  refreshing `## Validation` + `Last Verified` + the row, updating
  `HANDOVER.md` where flagged, writing the `docs/changes/` record, and
  setting the row back to `Closed + Monitored`. Guides:
  `HOW_TO_REGISTER_A_COMPONENT.md` (add), `HOW_TO_UPDATE_A_COMPONENT.md`
  (change — incl. the duplicated-pair rule), `HOW_TO_RETIRE_A_COMPONENT.md`
  (retire, preserving the record).
- **Not yet built** (`FORENSIC_COMPLETENESS_AUDIT_2026-09-10.md`):
  function-level (`FN-`) coverage; comment-change detection; a
  `docs/changes/` / `docs/validation/` population habit; CI opening the
  revalidation task itself (it can't reach `tasks.json` — E prints the
  ops JSON for a human).

**A record is only as current as its own `Last Verified` field.** A
record whose `Record Status` is `Closed + Monitored` but whose
`Last Verified` commit is far behind `HEAD` on the paths it covers
should be treated as **possibly `Stale`**, not trusted. A drifted record
is worse than no record — it actively misleads a reader who trusts it
instead of checking the source.

---

## How to use this index

The catalog answers, for any component, the questions from this project's
Goals — via one record plus its cross-references:

| Question | Where the answer is |
|---|---|
| **What is this?** | the record's `## Purpose / reason to exist` |
| **Where is it?** | the `Location` column here / the record's header |
| **What does it depend on?** | the record's `Relationships → Depends On` |
| **What depends on it?** | the record's `Relationships → Used By` (reciprocal) |
| **What data does it use, and where is that data stored?** | the record's `## Data lineage` + linked `SHEET-XXX` records |
| **What should I read next?** | the record's `## Related documentation` |
| **Is it still correct?** | the record's `Record Status` + `Last Verified`, and this file's maintenance-model note above |

To look something up: find its ID below (or search the file for the
filename / feature name), open the linked record, follow its
cross-references.

---

## Maintaining this catalog (`DOC-044`)

Four short guides — reachable from here so you don't need to know their
filenames:

| Guide | When |
|---|---|
| **[`HOW_TO_FIND_DOCS_FOR_A_FEATURE.md`](HOW_TO_FIND_DOCS_FOR_A_FEATURE.md)** | starting on a feature — the single entry point into the catalog (surface → `Depends On` → `SHEET-XXX`, then stop) |
| **[`HOW_TO_REGISTER_A_COMPONENT.md`](HOW_TO_REGISTER_A_COMPONENT.md)** | you added a real new tab / JS or `.gs` module / function / button / Sheet tab / integration / data flow |
| **[`HOW_TO_UPDATE_A_COMPONENT.md`](HOW_TO_UPDATE_A_COMPONENT.md)** | code changed and an existing record needs correcting — includes **the duplicated-pair rule**, **"Recording a new dependency edge"** (`DOC-045`), and a real worked example (`DOC-047`) |
| **[`HOW_TO_RETIRE_A_COMPONENT.md`](HOW_TO_RETIRE_A_COMPONENT.md)** | a component is obsolete — preserve the record (`_archive/`), never delete; IDs are never reused |

And before shipping any feature:
**[`PRE_SHIP_DOCUMENTATION_CHECKLIST.md`](PRE_SHIP_DOCUMENTATION_CHECKLIST.md)**
(`DOC-049`) — the 8-point "is the catalog still current" check, sibling
to `../CLAUDE.md`'s Testing section.

Open questions this project could not resolve live in
**[`_planning/OPEN_ITEMS.md`](_planning/OPEN_ITEMS.md)** (`DOC-042`) — a
tracker kept alive going forward, not archived.

---

## Master table

Columns: **ID | Type | Name | Location | Record Status | Depends On |
Used By | Last Verified**. Full per-component detail (inputs, outputs,
exceptions, validation, revalidation trigger, owner, …) lives in each
record file — this table is an index, not a second copy.

**Seed note (`DOC-021`):** rows below are seeded from the **live
filesystem as of 2026-09-10**, not from Phase 1's inventories (which are
`Not Started`). IDs are assigned in alphabetical-by-filename order as a
deterministic "first-documented order" per `NAMING_CONVENTIONS.md`; if
Phase 1/Phase 3 renumbers for a better grouping, that's allowed as long
as retired IDs stay retired. `Location` is filled where known; `Depends
On` / `Used By` are blank until the matching Phase 3 record is written.
Every `Record Status` is `Not Started` — no record file exists yet.

### `DASH-` — dashboards

| ID | Type | Name | Location | Record Status | Depends On | Used By | Last Verified |
|---|---|---|---|---|---|---|---|
| DASH-001 | DASH- | Leads Dashboard | `dashboard.html` + `js/*.js` | Closed + Monitored | DATA-001, EXT-001, JS-001, JS-003, JS-004, SHEET-001, SHEET-011, TAB-001, TAB-002, TAB-003, TAB-004, TAB-005, TAB-006, TAB-007, TAB-008 | none | 2026-09-10 (`c82ec67`) |

### `TAB-` — dashboard UI tabs (confirm the tab↔`JS-` mapping in `DOC-026`)

| ID | Type | Name | Location | Record Status | Depends On | Used By | Last Verified |
|---|---|---|---|---|---|---|---|
| TAB-001 | TAB- | Morning Brief | `js/tab-morning.js` (JS-020) | Closed + Monitored | DATA-001, JS-012, JS-020 | DASH-001 | 2026-09-10 (`c82ec67`) |
| TAB-002 | TAB- | Overview | `js/overview-distribution-people-ops.js` (JS-012) | Closed + Monitored | DATA-002, JS-004, JS-006, JS-009, JS-012 | DASH-001 | 2026-09-10 (`c82ec67`) |
| TAB-003 | TAB- | Operations | `js/overview-distribution-people-ops.js` (JS-012) + reports-*.js (JS-014/15/16) + JS-018 | Closed + Monitored | DATA-003, DATA-005, EXT-002, JS-006, JS-012, JS-014, JS-015, JS-016, JS-018, SHEET-004, SHEET-011 | DASH-001 | 2026-09-10 (`c82ec67`) |
| TAB-004 | TAB- | Repeat Offenders | `js/tab-repeat-offenders.js` (JS-022) + `js/repeat-offenders-pdf.js` (JS-013) + worker (JS-017) | Closed + Monitored | DATA-004, EXT-004, JS-003, JS-008, JS-013, JS-014, JS-017, JS-021, JS-022, SHEET-002, SHEET-003, SHEET-006 | DASH-001 | 2026-09-10 (`c82ec67`) |
| TAB-005 | TAB- | People | `js/overview-distribution-people-ops.js` (JS-012) + `js/tab-rmtimeline.js` (JS-023) | Closed + Monitored | JS-011, JS-012, JS-014, JS-019, JS-021, JS-023, JS-024 | DASH-001 | 2026-09-10 (`c82ec67`) |
| TAB-006 | TAB- | Audit | `js/tab-audit.js` (JS-019) | Closed + Monitored | JS-004, JS-006, JS-007, JS-019 | DASH-001 | 2026-09-10 (`c82ec67`) |
| TAB-007 | TAB- | Movement | `js/tab-movement.js` (JS-021) | Closed + Monitored | DATA-005, EXT-001, EXT-002, JS-003, JS-009, JS-014, JS-015, JS-016, JS-018, JS-021, SHEET-002, SHEET-004, SHEET-011 | DASH-001 | 2026-09-10 (`c82ec67`) |
| TAB-008 | TAB- | Tracking | `js/tab-tracking.js` (JS-024) | Closed + Monitored | EXT-001, JS-004, JS-014, JS-018, JS-021, JS-024, SHEET-002, SHEET-005, SHEET-008 | DASH-001 | 2026-09-10 (`c82ec67`) |

### `BTN-` / `UI-` — tab sub-components (detail lives in the owning `TAB-XXX` record, no own file)

| ID | Owner | Label / element | Invokes |
|---|---|---|---|
| BTN-001 | TAB-003 | Download Issues CSV (`#downloadIssuesBtn`) | `downloadIssuesCSV` (JS-012) |
| BTN-002 | TAB-003 | Generate (`#generateBtn`) | `renderReports` (JS-016) |
| BTN-003 | TAB-003 | Generate all regions (`#generateAllReportsBtn`) | `renderAllRegionReports` (JS-016) |
| BTN-004 | TAB-003 | Download all reports (`#downloadAllReportsBtn`) | `downloadAllReports` (JS-016) |
| BTN-005 | TAB-003 | Edit region recipients (`#regionRecipientsToggle`) | recipient UI (JS-016) |
| BTN-006 | TAB-003 | Connect Gmail (`#gmailConnectBtn`) | `connectGmail` (JS-015) |
| BTN-007 | TAB-003 | Save Client ID (`#gmailSaveClientIdBtn`) | Gmail setup (JS-015) |
| BTN-008 | TAB-003 | Gmail setup toggle (`#gmailSetupToggle`) | toggle (JS-015) |
| BTN-009 | TAB-003 | Cancel wait (`#followupsWaitCancelBtn`) | `_followupWaitCancelled` Map (JS-018) |
| BTN-010 | TAB-004 | ↻ Recalculate (`#repeatOffendersRecalculateBtn`) | worker → `computeRmPerformance*` (JS-017/JS-008) |
| BTN-011 | TAB-004 | Download PDF (`#repeatOffendersDownloadPdfBtn`) | `downloadRepeatOffendersPdf` (JS-013) |
| BTN-012 | TAB-006 | Copy (`#auditCopyBtn`) | audit copy (JS-019) |
| BTN-013 | TAB-006 | Download CSV (`#auditCsvBtn`) | audit CSV (JS-019) |
| BTN-014 | TAB-007 | Snapshot now (`#snapshotNowBtn`) | `browserSnapshotOpenLeads` (JS-018) |
| BTN-015 | TAB-007 | Auto-snapshot (`#autoSnapshotCheck`) | auto-snapshot tick (JS-018/JS-021) |
| BTN-016 | TAB-007 | Generate Region Emails (`#overnightGenerateReportsBtn`) | Overnight generate (JS-021→JS-016/JS-018) |
| BTN-017 | TAB-007 | Cancel wait (`#overnightFollowupsWaitCancelBtn`) | `_followupWaitCancelled` Map (JS-018) |
| BTN-018 | TAB-007 | Download Unmatched Comments CSV (`#downloadUnmatchedCommentsBtn`) | `downloadUnmatchedCommentsCSV` (JS-021) |
| BTN-019 | TAB-008 | Backfill SLA_History (`#backfillSlaHistoryBtn`) | `backfillSlaHistoryFromMovementLog` (JS-018) |
| BTN-020 | TAB-008 | Clear SLA History (`#clearSlaHistoryBtn`) — **irreversible** | `clearSlaHistory` (JS-004) |
| BTN-021 | TAB-008 | Backfill Daily Cohort History (`#backfillDailyCohortHistoryBtn`) | `upsertDailyCohortHistoryRows` (JS-018) |
| BTN-022 | TAB-008 | Clear Daily Cohort History (`#clearDailyCohortHistoryBtn`) — **irreversible** | clear handler (JS-024) |
| UI-001..014 | TAB-001..008 | non-button UI elements (multi-selects, charts, calendars) | see each `TAB-XXX` record's `UI-XXX` sub-table |

Global (top-bar) actions — sign in (`#gateSignInBtn`), refresh (`#refreshBtn`),
change source (`#changeSourceBtn`), clear filters (`#clearFiltersBtn`),
Download Lead IDs (`#downloadLeadIdsBtn`) — live on the `DASH-001` record's
"Top-level buttons / actions" section, not a `TAB-XXX`.

### `JS-` — client-side modules

| ID | Type | Name | Location | Record Status | Depends On | Used By | Last Verified |
|---|---|---|---|---|---|---|---|
| JS-001 | JS- | core-auth | `js/core-auth.js` | Closed + Monitored | EXT-003, JS-003, JS-004, JS-015 | DASH-001, JS-003, JS-004, JS-009, JS-011, JS-015, JS-018 | 2026-09-10 (`c82ec67`) |
| JS-002 | JS- | core-collation | `js/core-collation.js` | Closed + Monitored | JS-003, JS-010 | DATA-001, JS-004, JS-010, JS-012, JS-014, JS-019, JS-021, JS-024 | 2026-09-10 (`c82ec67`) |
| JS-003 | JS- | core-fetch-and-render | `js/core-fetch-and-render.js` | Closed + Monitored | EXT-001, JS-001, JS-004, JS-006, JS-007, JS-009, JS-010, JS-012, JS-014, JS-021, JS-022, SHEET-001 | DASH-001, DATA-001, JS-001, JS-002, JS-018, JS-021, JS-022, JS-023, TAB-004, TAB-007 | 2026-09-10 (`c82ec67`) |
| JS-004 | JS- | core-filters | `js/core-filters.js` | Closed + Monitored | EXT-001, EXT-003, JS-001, JS-002, JS-005, JS-006, JS-009, JS-010, JS-012, JS-014, JS-018, SHEET-005 | DASH-001, DATA-001, JS-001, JS-003, JS-012, JS-014, JS-019, JS-020, JS-024, TAB-002, TAB-006, TAB-008 | 2026-09-10 (`c82ec67`) |
| JS-005 | JS- | core-foundation | `js/core-foundation.js` | Closed + Monitored | none | DATA-001, DATA-002, JS-004, JS-006, JS-007, JS-008, JS-009, JS-010, JS-012, JS-014, JS-017, JS-019, JS-020, JS-021, JS-023, JS-024 | 2026-09-10 (`c82ec67`) |
| JS-006 | JS- | core-lead-model | `js/core-lead-model.js` | Closed + Monitored | JS-005, JS-007, JS-021, SHEET-001, SHEET-002 | DATA-001, DATA-002, DATA-003, JS-003, JS-004, JS-007, JS-008, JS-009, JS-012, JS-014, JS-017, JS-018, JS-019, JS-021, JS-023, JS-024, TAB-002, TAB-003, TAB-006 | 2026-09-10 (`c82ec67`) |
| JS-007 | JS- | core-outcome-engine | `js/core-outcome-engine.js` | Closed + Monitored | JS-005, JS-006 | DATA-003, JS-003, JS-006, JS-010, JS-012, JS-014, JS-017, JS-019, JS-021, JS-023, JS-024, TAB-006 | 2026-09-10 (`c82ec67`) |
| JS-008 | JS- | core-rm-performance | `js/core-rm-performance.js` | Closed + Monitored | DATA-004, JS-005, JS-006, JS-014, JS-021, JS-022, SHEET-002, SHEET-006 | DATA-002, JS-013, JS-017, JS-022, TAB-004 | 2026-09-10 (`c82ec67`) |
| JS-009 | JS- | core-sheets-fetch | `js/core-sheets-fetch.js` | Closed + Monitored | EXT-001, EXT-003, JS-001, JS-005, JS-006, SHEET-001 | DATA-001, JS-003, JS-004, JS-018, JS-021, JS-022, TAB-002, TAB-007 | 2026-09-10 (`c82ec67`) |
| JS-010 | JS- | core-ui | `js/core-ui.js` | Closed + Monitored | JS-002, JS-005, JS-007 | JS-002, JS-003, JS-004, JS-011, JS-012, JS-014, JS-019, JS-020, JS-022, JS-024 | 2026-09-10 (`c82ec67`) |
| JS-011 | JS- | main | `js/main.js` | Closed + Monitored | JS-001, JS-010, JS-021, JS-023 | JS-023, TAB-005 | 2026-09-10 (`c82ec67`) |
| JS-012 | JS- | overview-distribution-people-ops | `js/overview-distribution-people-ops.js` | Closed + Monitored | JS-002, JS-004, JS-005, JS-006, JS-007, JS-010, JS-014, JS-019, JS-020, JS-021, JS-022, JS-023, JS-024 | DATA-002, JS-003, JS-004, JS-019, JS-020, JS-021, TAB-001, TAB-002, TAB-003, TAB-005 | 2026-09-10 (`c82ec67`) |
| JS-013 | JS- | repeat-offenders-pdf | `js/repeat-offenders-pdf.js` | Closed + Monitored | EXT-004, JS-008, JS-021, JS-022, SHEET-002, SHEET-006 | TAB-004 | 2026-09-10 (`c82ec67`) |
| JS-014 | JS- | reports-build | `js/reports-build.js` | Closed + Monitored | JS-002, JS-004, JS-005, JS-006, JS-007, JS-010, JS-021 | DATA-005, EXT-002, JS-003, JS-004, JS-008, JS-012, JS-015, JS-016, JS-017, JS-021, JS-022, JS-023, JS-024, TAB-003, TAB-004, TAB-005, TAB-007, TAB-008 | 2026-09-10 (`c82ec67`) |
| JS-015 | JS- | reports-gmail | `js/reports-gmail.js` | Closed + Monitored | EXT-002, JS-001, JS-014, JS-016, JS-018, SHEET-011 | JS-001, JS-016, SHEET-011, TAB-003, TAB-007 | 2026-09-10 (`c82ec67`) |
| JS-016 | JS- | reports-ui | `js/reports-ui.js` | Closed + Monitored | JS-014, JS-015, JS-018, JS-020, SHEET-004 | DATA-003, EXT-002, JS-015, TAB-003, TAB-007 | 2026-09-10 (`c82ec67`) |
| JS-017 | JS- | rm-performance-worker | `js/rm-performance-worker.js` | Closed + Monitored | JS-005, JS-006, JS-007, JS-008, JS-014, JS-021 | JS-022, TAB-004 | 2026-09-10 (`c82ec67`) |
| JS-018 | JS- | sheets-writeback | `js/sheets-writeback.js` | Closed + Monitored | EXT-001, EXT-002, EXT-003, JS-001, JS-003, JS-006, JS-009, JS-021, SHEET-002, SHEET-004, SHEET-005, SHEET-008, SHEET-011 | DATA-003, DATA-004, JS-004, JS-015, JS-016, JS-021, JS-024, SHEET-002, SHEET-004, SHEET-005, SHEET-008, SHEET-011, TAB-003, TAB-007, TAB-008 | 2026-09-10 (`c82ec67`) |
| JS-019 | JS- | tab-audit | `js/tab-audit.js` | Closed + Monitored | JS-002, JS-004, JS-005, JS-006, JS-007, JS-010, JS-012 | JS-012, JS-023, TAB-005, TAB-006 | 2026-09-10 (`c82ec67`) |
| JS-020 | JS- | tab-morning | `js/tab-morning.js` | Closed + Monitored | JS-004, JS-005, JS-010, JS-012 | JS-012, JS-016, JS-021, TAB-001 | 2026-09-10 (`c82ec67`) |
| JS-021 | JS- | tab-movement | `js/tab-movement.js` | Closed + Monitored | EXT-001, EXT-002, EXT-003, JS-002, JS-003, JS-005, JS-006, JS-007, JS-009, JS-012, JS-014, JS-018, JS-020, SHEET-002, SHEET-004, SHEET-011 | DATA-004, JS-003, JS-006, JS-008, JS-011, JS-012, JS-013, JS-014, JS-017, JS-018, JS-022, JS-023, JS-024, TAB-004, TAB-005, TAB-007, TAB-008 | 2026-09-10 (`c82ec67`) |
| JS-022 | JS- | tab-repeat-offenders | `js/tab-repeat-offenders.js` | Closed + Monitored | EXT-001, EXT-003, JS-003, JS-008, JS-009, JS-010, JS-014, JS-017, JS-021, SHEET-002, SHEET-003, SHEET-006 | JS-003, JS-008, JS-012, JS-013, TAB-004 | 2026-09-10 (`c82ec67`) |
| JS-023 | JS- | tab-rmtimeline | `js/tab-rmtimeline.js` | Closed + Monitored | JS-003, JS-005, JS-006, JS-007, JS-011, JS-014, JS-019, JS-021, JS-024, SHEET-002 | JS-011, JS-012, TAB-005 | 2026-09-10 (`c82ec67`) |
| JS-024 | JS- | tab-tracking | `js/tab-tracking.js` | Closed + Monitored | JS-002, JS-004, JS-005, JS-006, JS-007, JS-010, JS-014, JS-018, JS-021, SHEET-002, SHEET-005, SHEET-008 | JS-012, JS-023, TAB-005, TAB-008 | 2026-09-10 (`c82ec67`) |

### `GS-` — Apps Script backend modules (production; `Tests_*.gs` excluded per `DOC-007`)

| ID | Type | Name | Location | Record Status | Depends On | Used By | Last Verified |
|---|---|---|---|---|---|---|---|
| GS-001 | GS- | AllIssuesEmailer | `AllIssuesEmailer.gs` | Closed + Monitored | DATA-002, DATA-004, EXT-002, GS-002, GS-004, GS-005, GS-008, GS-011, GS-012, SHEET-001, SHEET-002, SHEET-006, SHEET-007, SHEET-012, SHEET-013 | DATA-005, SHEET-013 | 2026-09-10 (`c82ec67`) |
| GS-002 | GS- | Core | `Core.gs` | Closed + Monitored | EXT-001, GS-004 | DATA-002, DATA-003, DATA-004, GS-001, GS-003, GS-004, GS-005, GS-006, GS-008, GS-010, GS-011, GS-012, GS-013 | 2026-09-10 (`c82ec67`) |
| GS-003 | GS- | DailyRmIssueLog | `DailyRmIssueLog.gs` | Closed + Monitored | GS-002, GS-004, GS-008, GS-012, SHEET-001, SHEET-002, SHEET-003 | DATA-002, SHEET-003 | 2026-09-10 (`c82ec67`) |
| GS-004 | GS- | EmailInfra | `EmailInfra.gs` | Closed + Monitored | EXT-002, GS-002, GS-011, SHEET-001, SHEET-006, SHEET-007, SHEET-012 | DATA-002, EXT-002, GS-001, GS-002, GS-003, GS-006, GS-008, GS-009, GS-010, GS-011, GS-013, SHEET-012 | 2026-09-10 (`c82ec67`) |
| GS-005 | GS- | FollowupEngine | `FollowupEngine.gs` | Closed + Monitored | GS-002 | DATA-003, GS-001, GS-006, GS-010, GS-012, GS-013, SHEET-010 | 2026-09-10 (`c82ec67`) |
| GS-006 | GS- | InteractionHistoryLogger | `InteractionHistoryLogger.gs` | Closed + Monitored | GS-002, GS-004, GS-005, SHEET-001, SHEET-009 | DATA-003, GS-008, SHEET-009 | 2026-09-10 (`c82ec67`) |
| GS-007 | GS- | LeadFollowupsStaleness | `LeadFollowupsStaleness.gs` | Closed + Monitored | SHEET-004 | none | 2026-09-10 (`c82ec67`) |
| GS-008 | GS- | MovementTracker | `MovementTracker.gs` | Closed + Monitored | GS-002, GS-004, GS-006, GS-012, GS-013, SHEET-001, SHEET-002, SHEET-005, SHEET-008, SHEET-009, SHEET-010 | DATA-002, DATA-004, GS-001, GS-003, GS-009, GS-010, SHEET-002, SHEET-005, SHEET-008, SHEET-009, SHEET-010 | 2026-09-10 (`c82ec67`) |
| GS-009 | GS- | OpsChecklistRunner | `OpsChecklistRunner.gs` | Closed + Monitored | EXT-002, GS-004, GS-008, GS-011, SHEET-002, SHEET-006, SHEET-007 | none | 2026-09-10 (`c82ec67`) |
| GS-010 | GS- | OvernightEmailer | `OvernightEmailer.gs` | Closed + Monitored | DATA-002, EXT-002, GS-002, GS-004, GS-005, GS-008, GS-011, GS-012, SHEET-001, SHEET-002, SHEET-004, SHEET-006, SHEET-007, SHEET-012, SHEET-014 | DATA-003, SHEET-004, SHEET-014 | 2026-09-10 (`c82ec67`) |
| GS-011 | GS- | RmHierarchy | `RmHierarchy.gs` | Closed + Monitored | GS-002, GS-004, SHEET-006, SHEET-007, SHEET-012 | GS-001, GS-004, GS-009, GS-010, SHEET-006, SHEET-007 | 2026-09-10 (`c82ec67`) |
| GS-012 | GS- | SlaEngine | `SlaEngine.gs` | Closed + Monitored | GS-002, GS-005 | DATA-002, DATA-004, GS-001, GS-003, GS-008, GS-010 | 2026-09-10 (`c82ec67`) |
| GS-013 | GS- | UnmatchedCommentLogger | `UnmatchedCommentLogger.gs` | Closed + Monitored | GS-002, GS-004, GS-005, SHEET-001, SHEET-010 | DATA-003, GS-008, SHEET-010 | 2026-09-10 (`c82ec67`) |

`RmHierarchy.private.gs` is **not** cataloged — gitignored, real employee
emails, never in this repo (`DOC-007`).

### `SHEET-` — Google Sheet tabs (partial seed — full list + count confirmed in `DOC-010` / `DOC-032`)

| ID | Type | Name | Location | Record Status | Depends On | Used By | Last Verified |
|---|---|---|---|---|---|---|---|
| SHEET-001 | SHEET- | leads (the live leads tab) | Google Sheet | Closed + Monitored (lifecycle DOC-036 -> TBD, feeds DOC-037; DOC-038: CRITICAL / contact+comment) | EXT-001, external CRM export | DASH-001, DATA-001, DATA-002, DATA-003, DATA-004, GS-001, GS-003, GS-004, GS-006, GS-008, GS-010, GS-013, JS-003, JS-006, JS-009, SHEET-002, SHEET-003, SHEET-004, SHEET-009, SHEET-010 | 2026-09-10 (`c82ec67`) |
| SHEET-002 | SHEET- | Movement_Log | Google Sheet | Closed + Monitored (lifecycle 7d confirmed; DOC-038: CRITICAL / operational) | EXT-001, GS-008, JS-018, SHEET-001 | DATA-002, DATA-004, GS-001, GS-003, GS-008, GS-009, GS-010, JS-006, JS-008, JS-013, JS-018, JS-021, JS-022, JS-023, JS-024, SHEET-003, SHEET-005, SHEET-008, TAB-004, TAB-007, TAB-008 | 2026-09-10 (`c82ec67`) |
| SHEET-003 | SHEET- | Daily_RM_Issues | Google Sheet | Closed + Monitored (lifecycle 7d confirmed; DOC-038: IMPORTANT / operational) | DATA-002, EXT-001, GS-003, SHEET-001, SHEET-002 | GS-003, JS-022, TAB-004 | 2026-09-10 (`c82ec67`) |
| SHEET-004 | SHEET- | Lead_Followups | Google Sheet | Closed + Monitored (lifecycle DOC-036 -> TBD, feeds DOC-037; DOC-038: CRITICAL / comment-text) | EXT-001, GS-010, JS-018, SHEET-001 | DATA-003, DATA-005, GS-007, GS-010, JS-016, JS-018, JS-021, TAB-003, TAB-007 | 2026-09-10 (`c82ec67`) |
| SHEET-005 | SHEET- | SLA_History | Google Sheet | Closed + Monitored (lifecycle DOC-036 -> TBD, feeds DOC-037; DOC-038: LOW / operational) | DATA-002, DATA-004, EXT-001, GS-008, JS-018, SHEET-002 | GS-008, JS-004, JS-018, JS-024, TAB-008 | 2026-09-10 (`c82ec67`) |
| SHEET-006 | SHEET- | RM_Hierarchy | Google Sheet | Closed + Monitored (lifecycle N/A config; DOC-038: CRITICAL / EMPLOYEE-DATA) | EXT-001, GS-011, RM_HIERARCHY_RAW_ (GS-011), RmHierarchy.private.gs (opt) | GS-001, GS-004, GS-009, GS-010, GS-011, JS-008, JS-013, JS-022, SHEET-007, TAB-004 | 2026-09-10 (`c82ec67`) |
| SHEET-007 | SHEET- | Manager_Directory | Google Sheet | Closed + Monitored (lifecycle N/A config; DOC-038: CRITICAL / EMPLOYEE-DATA) | EXT-001, GS-011, SHEET-006 | GS-001, GS-004, GS-009, GS-010, GS-011 | 2026-09-10 (`c82ec67`) |
| SHEET-008 | SHEET- | Daily_Cohort_History | Google Sheet | Closed + Monitored (lifecycle DOC-036 -> TBD, feeds DOC-037; DOC-038: LOW / operational) | DATA-004, EXT-001, GS-008, JS-018, SHEET-002 | GS-008, JS-018, JS-024, TAB-008 | 2026-09-10 (`c82ec67`) |
| SHEET-009 | SHEET- | Comment_History | Google Sheet | Closed + Monitored (retention append-only by design; DOC-038: LOW / COMMENT-TEXT) | DATA-003, EXT-001, GS-006, GS-008, SHEET-001 | GS-006, GS-008 | 2026-09-10 (`c82ec67`) |
| SHEET-010 | SHEET- | Unmatched_Comments_Log | Google Sheet | Closed + Monitored (retention manually curated; DOC-038: LOW / COMMENT-TEXT) | DATA-003, EXT-001, GS-005, GS-008, GS-013, SHEET-001 | GS-008, GS-013 | 2026-09-10 (`c82ec67`) |
| SHEET-011 | SHEET- | Send_Log | Google Sheet | Closed + Monitored (lifecycle DOC-036 -> TBD, feeds DOC-037; DOC-038: LOW / contact-emails) | DATA-005, EXT-001, EXT-002, JS-015, JS-018 | DASH-001, JS-015, JS-018, JS-021, TAB-003, TAB-007 | 2026-09-10 (`c82ec67`) |
| SHEET-012 | SHEET- | Region_Recipients | Google Sheet | Closed + Monitored (lifecycle N/A config; DOC-038: IMPORTANT / contact-emails) | EXT-001, GS-004 | GS-001, GS-004, GS-010, GS-011 | 2026-09-10 (`c82ec67`) |
| SHEET-013 | SHEET- | AllIssues_Log | Google Sheet | Closed + Monitored (lifecycle DOC-036 -> TBD, feeds DOC-037; DOC-038: LOW / contact-emails) | EXT-001, EXT-002, GS-001 | GS-001 | 2026-09-10 (`c82ec67`) |
| SHEET-014 | SHEET- | Overnight_Log | Google Sheet | Closed + Monitored (lifecycle DOC-036 -> TBD, feeds DOC-037; DOC-038: IMPORTANT / contact-emails) | EXT-001, EXT-002, GS-010 | GS-010 | 2026-09-10 (`c82ec67`) |

**Seed correction (DOC-029):** `SHEET-009` renamed `Interaction_History` →
`Comment_History` (the real tab name, per `LOGIC_AUDIT.md` Part 1 §1 and
`InteractionHistoryLogger.gs` `ensureCommentHistorySheet_`); `SHEET-011`..`014`
added — the full 14-tab set matches `LOGIC_AUDIT.md` Part 1 §1's datastore
list. `DOC-032` writes the base records; `DOC-036` fills lifecycle/retention.

### `EXT-` — external integrations (confirm exact set in `DOC-011` / `DOC-033`)

| ID | Type | Name | Location | Record Status | Depends On | Used By | Last Verified |
|---|---|---|---|---|---|---|---|
| EXT-001 | EXT- | Google Sheets API (v4) | via `js/core-sheets-fetch.js` / `SpreadsheetApp` | Closed + Monitored | EXT-003 | DASH-001, DATA-001, DATA-004, GS-002, JS-003, JS-004, JS-009, JS-018, JS-021, JS-022, SHEET-001, SHEET-002, SHEET-003, SHEET-004, SHEET-005, SHEET-006, SHEET-007, SHEET-008, SHEET-009, SHEET-010, SHEET-011, SHEET-012, SHEET-013, SHEET-014, TAB-007, TAB-008 | 2026-09-10 (`c82ec67`) |
| EXT-002 | EXT- | Gmail (send) — dashboard OAuth grant + `GmailApp` + Advanced Gmail Service | `js/reports-gmail.js` / `EmailInfra.gs` | Closed + Monitored | EXT-003, GS-004, JS-014, JS-016 | DATA-005, GS-001, GS-004, GS-009, GS-010, JS-015, JS-018, JS-021, SHEET-011, SHEET-013, SHEET-014, TAB-003, TAB-007 | 2026-09-10 (`c82ec67`) |
| EXT-003 | EXT- | Google Identity / OAuth (sign-in gate) | `js/core-auth.js` | Closed + Monitored | none | EXT-001, EXT-002, JS-001, JS-004, JS-009, JS-018, JS-021, JS-022 | 2026-09-10 (`c82ec67`) |
| EXT-004 | EXT- | jsPDF 2.5.1 + jspdf-autotable 3.8.2 (PDF export) | `js/repeat-offenders-pdf.js` | Closed + Monitored | none | JS-013, TAB-004 | 2026-09-10 (`c82ec67`) |

### `DATA-` — traced data flows (`DOC-034`)

| ID | Type | Name | Location | Record Status | Depends On | Used By | Last Verified |
|---|---|---|---|---|---|---|---|
| DATA-001 | DATA- | The core lead record | traced path | Closed + Monitored | EXT-001, JS-002, JS-003, JS-004, JS-005, JS-006, JS-009, SHEET-001 | DASH-001, DATA-002, DATA-003, DATA-005, TAB-001 | 2026-09-10 (`c82ec67`) |
| DATA-002 | DATA- | The SLA-flag pipeline | traced path | Closed + Monitored | DATA-001, DATA-004, GS-002, GS-003, GS-004, GS-008, GS-012, JS-005, JS-006, JS-008, JS-012, SHEET-001, SHEET-002 | DATA-005, GS-001, GS-010, SHEET-003, SHEET-005, TAB-002 | 2026-09-10 (`c82ec67`) |
| DATA-003 | DATA- | The comment-classification pipeline | traced path | Closed + Monitored | DATA-001, GS-002, GS-005, GS-006, GS-010, GS-013, JS-006, JS-007, JS-016, JS-018, SHEET-001, SHEET-004 | DATA-005, SHEET-009, SHEET-010, TAB-003 | 2026-09-10 (`c82ec67`) |
| DATA-004 | DATA- | The Movement snapshot pipeline | traced path | Closed + Monitored | EXT-001, GS-002, GS-008, GS-012, JS-018, JS-021, SHEET-001, SHEET-002 | DATA-002, GS-001, JS-008, SHEET-005, SHEET-008, TAB-004 | 2026-09-10 (`c82ec67`) |
| DATA-005 | DATA- | The region-email pipeline | traced path | Closed + Monitored (⚠ carries the HIGH Loan-region finding) | DATA-001, DATA-002, DATA-003, EXT-002, GS-001, JS-014, SHEET-004 | SHEET-011, TAB-003, TAB-007 | 2026-09-10 (`c82ec67`) |

### `FLOW-` — cross-file workflow overlays (`architecture/`; `t-tf-5ad22d8e4c2e`)

An overlay names its participants in `Depends On` but is **not**
reciprocated (`Used By: none`) — a component does not list every overlay
spanning it. See `../NAMING_CONVENTIONS.md` and `_templates/architecture-template.md`.
Standalone `TRIGGER-` records were not needed — the trigger set is one
non-ID'd index, `architecture/apps-script-triggers.md`.

| ID | Type | Name | Location | Record Status | Depends On | Used By | Last Verified |
|---|---|---|---|---|---|---|---|
| FLOW-001 | FLOW- | Movement snapshot hub + piggyback loggers | `architecture/FLOW-001-movement-hub.md` | Closed + Monitored | GS-006, GS-008, GS-013, JS-018, SHEET-001, SHEET-002, SHEET-005, SHEET-008, SHEET-009, SHEET-010 | none | 2026-09-10 (`c82ec67`) |
| FLOW-002 | FLOW- | The 3-phase "Generate region emails" cycle | `architecture/FLOW-002-generate-cycle.md` | Closed + Monitored | EXT-002, GS-005, GS-010, JS-014, JS-015, JS-016, JS-018, JS-021, SHEET-004, SHEET-011 | none | 2026-09-10 (`c82ec67`) |

---

## Coverage snapshot (auto-checkable target)

- `JS-` records: 24 / 24 (core `JS-001`..`JS-011` DOC-027; feature `JS-012`..`JS-024` DOC-028)
- `GS-` records: 13 / 13 (DOC-029 — trigger schedules + `setupXxx()` re-run conditions on each)
- `TAB-` records: 8 / 8 (DOC-026)
- `SHEET-` records: 14 / 14 (base DOC-032; `## Data Lifecycle` DOC-036; sensitivity + operational-importance DOC-038, all with a stated reason). **Operational importance:** CRITICAL x5 (`leads`, `Movement_Log`, `Lead_Followups`, `RM_Hierarchy`, `Manager_Directory`), IMPORTANT x4 (`Daily_RM_Issues`, `Region_Recipients`, `Overnight_Log`; `Movement_Log` degradations), LOW x6 (`SLA_History`, `Daily_Cohort_History`, `Comment_History`, `Unmatched_Comments_Log`, `Send_Log`, `AllIssues_Log`). **Employee data:** `RM_Hierarchy` + `Manager_Directory` (names/emails). **Comment text:** `leads`, `Lead_Followups`, `Comment_History`, `Unmatched_Comments_Log`. Retention: 2 confirmed 7d (`Movement_Log`, `Daily_RM_Issues`), 1 append-only-by-design (`Comment_History`), 1 manually-curated (`Unmatched_Comments_Log`), 3 N/A-configuration (`RM_Hierarchy`, `Manager_Directory`, `Region_Recipients`), **7 `TBD` — no pruning function found** (`leads`, `Lead_Followups`, `SLA_History`, `Daily_Cohort_History`, `Send_Log`, `AllIssues_Log`, `Overnight_Log`) → `DOC-037`.
- `EXT-` records: 4 / 4 (DOC-033)
- `DASH-` records: 1 / 1 (DOC-025)
- `DATA-` records: 5 / 5 (DOC-034)
- `FLOW-` records: 2 / 2 (`t-tf-5ad22d8e4c2e`; overlays in `architecture/`)
- **Component-record set is complete** — 1 `DASH-`, 8 `TAB-`
  (+ `BTN-001`..`022`), 24 `JS-`, 13 `GS-` (+ `FN-001`..`254`),
  14 `SHEET-`, 4 `EXT-`, 5 `DATA-`. `test/check-docs-coverage.js`'s
  file-coverage check reports `js/*.js` and `*.gs` as **100% covered**
  (verified in CI).
- **All six phases (`DOC-001`–`DOC-050`) + the Governance Model + the
  `CONSOLIDATED` task are complete** (2026-09-10, goal `g-docproject01`).
  Phase 1 inventories are in `_planning/` (`file-inventory.md`,
  `handover-coverage-map.md`, `logic-audit-source-map.md`,
  `dashboard-inventory.md`, `tab-inventory.md`, `js-module-inventory.md`,
  `gs-module-inventory.md`, `function-inventory.md`, `button-inventory.md`,
  `sheet-inventory.md`, `integration-inventory.md`,
  `documentation-conflicts.md`); Phase 2 built this file + `_templates/`
  + the `HOW_TO_*` guides; Phases 4–6 filled `SHEET-` lifecycle
  (`DOC-036`), ran the verification passes (`completeness-verification.md`,
  `reference-verification.md`, `consistency-check.md`), and wrote the
  process guides + `PRE_SHIP_DOCUMENTATION_CHECKLIST.md`. The reciprocity
  walk (`DOC-035` / `DOC-040`) is done, and the record files were then
  aligned to `docs/INDEX.md` exactly (`t-tf-47c37923c3bd`); the `DOC-012`
  `HANDOVER.md` / `CLAUDE.md` accuracy touch-up is done
  (`t-tf-7e4d0dffdf6c`).
- **Still open** — tracked in
  **[`_planning/OPEN_ITEMS.md`](_planning/OPEN_ITEMS.md)**: 7 `SHEET-`
  retention `TBD`s awaiting a CRM-owner / product decision (`DOC-037`,
  `retention-decisions-needed.md`); `HANDOVER.md` §9.7's deep §9
  reconciliation (`documentation-conflicts.md` C-5 / C-6); the
  `LOGIC_AUDIT.md` Part 7 §18 code findings the catalog records but does
  not fix; and the **continuous-completeness gap** — the
  change-detection → stale → revalidation loop is designed but only
  partly built (`FORENSIC_COMPLETENESS_AUDIT_2026-09-10.md`,
  in progress as `t-tf-5ad22d8e4c2e`).
