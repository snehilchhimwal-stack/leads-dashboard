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

**Nothing fully enforces this catalog automatically.** As of 2026-09-10:

- `test/check-docs-coverage.js` (CI, `CI-001`–`CI-005`) **warns** when a
  `js/*.js` or `.gs` file has no matching record, and when `HANDOVER.md`
  goes stale — it does **not** yet block a build, and it does **not**
  check function-level coverage, cross-references, retired components, or
  "code changed without doc review." See the Governance Model's
  "CI-001–CI-005 Evaluation" for the full list of what it does and
  doesn't catch.
- Everything else — keeping a record current when its code changes,
  keeping `Depends On` / `Used By` reciprocal, revalidating a `Stale`
  record — is **process, done by whoever makes the change** (see
  `HOW_TO_UPDATE_A_COMPONENT.md`, once `DOC-023` is worked).

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
| DASH-001 | DASH- | Leads Dashboard | `dashboard.html` + `js/*.js` | Closed + Monitored | TAB-001..008, JS-001..024, EXT-001..004, SHEET-001/002/004/005/006/008/011 | none | 2026-09-10 (`c82ec67`) |

### `TAB-` — dashboard UI tabs (confirm the tab↔`JS-` mapping in `DOC-026`)

| ID | Type | Name | Location | Record Status | Depends On | Used By | Last Verified |
|---|---|---|---|---|---|---|---|
| TAB-001 | TAB- | Morning Brief | `js/tab-morning.js` (JS-020) | Closed + Monitored | JS-020, JS-012 | DASH-001 | 2026-09-10 (`c82ec67`) |
| TAB-002 | TAB- | Overview | `js/overview-distribution-people-ops.js` (JS-012) | Closed + Monitored | JS-012, JS-004, JS-006, JS-009 | DASH-001 | 2026-09-10 (`c82ec67`) |
| TAB-003 | TAB- | Operations | `js/overview-distribution-people-ops.js` (JS-012) + reports-*.js (JS-014/15/16) + JS-018 | Closed + Monitored | JS-012, JS-014, JS-015, JS-016, JS-018, JS-006, EXT-002, SHEET-004, SHEET-011 | DASH-001 | 2026-09-10 (`c82ec67`) |
| TAB-004 | TAB- | Repeat Offenders | `js/tab-repeat-offenders.js` (JS-022) + `js/repeat-offenders-pdf.js` (JS-013) + worker (JS-017) | Closed + Monitored | JS-022, JS-017, JS-008, JS-013, JS-021, JS-003, JS-014, SHEET-002, SHEET-003, SHEET-006, EXT-004 | DASH-001 | 2026-09-10 (`c82ec67`) |
| TAB-005 | TAB- | People | `js/overview-distribution-people-ops.js` (JS-012) + `js/tab-rmtimeline.js` (JS-023) | Closed + Monitored | JS-012, JS-023, JS-019, JS-024, JS-021, JS-014, JS-011 | DASH-001 | 2026-09-10 (`c82ec67`) |
| TAB-006 | TAB- | Audit | `js/tab-audit.js` (JS-019) | Closed + Monitored | JS-019, JS-007, JS-004, JS-006 | DASH-001 | 2026-09-10 (`c82ec67`) |
| TAB-007 | TAB- | Movement | `js/tab-movement.js` (JS-021) | Closed + Monitored | JS-021, JS-018, JS-014, JS-016, JS-003, JS-009, SHEET-002, SHEET-004, SHEET-011, EXT-001, EXT-002 | DASH-001 | 2026-09-10 (`c82ec67`) |
| TAB-008 | TAB- | Tracking | `js/tab-tracking.js` (JS-024) | Closed + Monitored | JS-024, JS-018, JS-004, JS-021, JS-014, SHEET-002, SHEET-005, SHEET-008, EXT-001 | DASH-001 | 2026-09-10 (`c82ec67`) |

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
| JS-001 | JS- | core-auth | `js/core-auth.js` | Closed + Monitored | EXT-003, JS-015, JS-003 | JS-009, JS-003, JS-004, JS-018, JS-011, DASH-001 | 2026-09-10 (`c82ec67`) |
| JS-002 | JS- | core-collation | `js/core-collation.js` | Closed + Monitored | JS-010, JS-003 | JS-010, JS-012, JS-014, JS-019, JS-021, JS-024 | 2026-09-10 (`c82ec67`) |
| JS-003 | JS- | core-fetch-and-render | `js/core-fetch-and-render.js` | Closed + Monitored | JS-001, JS-009, JS-006, JS-014, JS-012, JS-004, JS-021, JS-022, SHEET-001, EXT-001 | JS-001, DASH-001, (transitively every tab) | 2026-09-10 (`c82ec67`) |
| JS-004 | JS- | core-filters | `js/core-filters.js` | Closed + Monitored | JS-009, JS-006, JS-014, JS-002, JS-012, JS-010, JS-001, JS-018, SHEET-005 | JS-003, JS-001, JS-019, DASH-001, TAB-002..008 | 2026-09-10 (`c82ec67`) |
| JS-005 | JS- | core-foundation | `js/core-foundation.js` | Closed + Monitored | none | JS-004, JS-006, JS-007, JS-008, JS-012, JS-014, JS-019, JS-021, JS-023, JS-024 (+more) | 2026-09-10 (`c82ec67`) |
| JS-006 | JS- | core-lead-model | `js/core-lead-model.js` | Closed + Monitored | JS-005, JS-007, JS-021, SHEET-001, SHEET-002 | JS-004, JS-003, JS-008, JS-012, JS-014, JS-019, JS-021, JS-023, JS-024, JS-018 | 2026-09-10 (`c82ec67`) |
| JS-007 | JS- | core-outcome-engine | `js/core-outcome-engine.js` | Closed + Monitored | JS-005, JS-006 | JS-006, JS-010, JS-003, JS-012, JS-014, JS-019, JS-021, JS-023, JS-024 | 2026-09-10 (`c82ec67`) |
| JS-008 | JS- | core-rm-performance | `js/core-rm-performance.js` | Closed + Monitored | JS-005, JS-006, JS-021, JS-022, JS-014, SHEET-002, SHEET-006 | JS-017, JS-022, JS-013, TAB-004 | 2026-09-10 (`c82ec67`) |
| JS-009 | JS- | core-sheets-fetch | `js/core-sheets-fetch.js` | Closed + Monitored | JS-001, JS-005, JS-006, EXT-001, SHEET-001 | JS-003, JS-004, JS-021, JS-022, (most tabs) | 2026-09-10 (`c82ec67`) |
| JS-010 | JS- | core-ui | `js/core-ui.js` | Closed + Monitored | JS-002, JS-007, JS-005 | JS-004, JS-003, JS-011, (most tabs) | 2026-09-10 (`c82ec67`) |
| JS-011 | JS- | main | `js/main.js` | Closed + Monitored | JS-010, JS-023, JS-021, JS-001 | none (entry point) | 2026-09-10 (`c82ec67`) |
| JS-012 | JS- | overview-distribution-people-ops | `js/overview-distribution-people-ops.js` | Closed + Monitored | JS-004, JS-006, JS-005, JS-010, JS-002, JS-021, JS-014 | TAB-002, TAB-003, TAB-005, JS-003, JS-004, JS-020, (every tab file) | 2026-09-10 (`c82ec67`) |
| JS-013 | JS- | repeat-offenders-pdf | `js/repeat-offenders-pdf.js` | Closed + Monitored | JS-008, JS-022, JS-021, EXT-004 | TAB-004 | 2026-09-10 (`c82ec67`) |
| JS-014 | JS- | reports-build | `js/reports-build.js` | Closed + Monitored | JS-005, JS-006, JS-007, JS-002, JS-010, JS-021, JS-004 | JS-016, JS-015, JS-021, JS-008, JS-023, JS-024, TAB-003, TAB-007 | 2026-09-10 (`c82ec67`) |
| JS-015 | JS- | reports-gmail | `js/reports-gmail.js` | Closed + Monitored | EXT-002, JS-014, JS-016, JS-018, JS-001, SHEET-011 | TAB-003, TAB-007, JS-016 | 2026-09-10 (`c82ec67`) |
| JS-016 | JS- | reports-ui | `js/reports-ui.js` | Closed + Monitored | JS-014, JS-018, JS-015, JS-020, SHEET-004 | TAB-003, JS-015 | 2026-09-10 (`c82ec67`) |
| JS-017 | JS- | rm-performance-worker | `js/rm-performance-worker.js` | Closed + Monitored | JS-008, JS-005, JS-006, JS-007, JS-014, JS-021 | JS-022, TAB-004 | 2026-09-10 (`c82ec67`) |
| JS-018 | JS- | sheets-writeback | `js/sheets-writeback.js` | Closed + Monitored | JS-001, JS-009, JS-006, JS-021, JS-003, EXT-001, SHEET-002, SHEET-004, SHEET-005, SHEET-008, SHEET-011 | TAB-007, TAB-003, TAB-008, JS-015, JS-016, JS-021, JS-024, JS-004 | 2026-09-10 (`c82ec67`) |
| JS-019 | JS- | tab-audit | `js/tab-audit.js` | Closed + Monitored | JS-007, JS-006, JS-004, JS-005, JS-012, JS-010 | TAB-006, JS-012, JS-023 | 2026-09-10 (`c82ec67`) |
| JS-020 | JS- | tab-morning | `js/tab-morning.js` | Closed + Monitored | JS-012, JS-005, JS-010, JS-004 | TAB-001, JS-012, JS-016, JS-021 | 2026-09-10 (`c82ec67`) |
| JS-021 | JS- | tab-movement | `js/tab-movement.js` | Closed + Monitored | JS-009, JS-006, JS-014, JS-018, JS-007, JS-012, JS-020, JS-003, SHEET-002, SHEET-004, SHEET-011, EXT-001, EXT-002 | TAB-007, TAB-004, TAB-005, TAB-008, JS-008, JS-013, JS-023, JS-024, JS-003, JS-011, JS-006 | 2026-09-10 (`c82ec67`) |
| JS-022 | JS- | tab-repeat-offenders | `js/tab-repeat-offenders.js` | Closed + Monitored | JS-009, JS-017, JS-008, JS-021, JS-014, JS-010, JS-003, SHEET-006, SHEET-002, EXT-001 | TAB-004, JS-013, JS-003, JS-012 | 2026-09-10 (`c82ec67`) |
| JS-023 | JS- | tab-rmtimeline | `js/tab-rmtimeline.js` | Closed + Monitored | JS-019, JS-024, JS-021, JS-014, JS-005, JS-003, JS-011 | TAB-005, JS-012, JS-011 | 2026-09-10 (`c82ec67`) |
| JS-024 | JS- | tab-tracking | `js/tab-tracking.js` | Closed + Monitored | JS-021, JS-018, JS-004, JS-014, JS-010, JS-005, SHEET-002, SHEET-005, SHEET-008 | TAB-008, JS-012, JS-023 | 2026-09-10 (`c82ec67`) |

### `GS-` — Apps Script backend modules (production; `Tests_*.gs` excluded per `DOC-007`)

| ID | Type | Name | Location | Record Status | Depends On | Used By | Last Verified |
|---|---|---|---|---|---|---|---|
| GS-001 | GS- | AllIssuesEmailer | `AllIssuesEmailer.gs` | Closed + Monitored | GS-002, GS-012, GS-005, GS-004, GS-008, GS-011, SHEET-001, SHEET-002, SHEET-006, SHEET-007, SHEET-012, EXT-002 | none (scheduled leaf) | 2026-09-10 (`c82ec67`) |
| GS-002 | GS- | Core | `Core.gs` | Closed + Monitored | GS-004 (`HEADER_ALIASES_`) | GS-001, GS-003, GS-005, GS-006, GS-008, GS-010, GS-011, GS-012, GS-013 | 2026-09-10 (`c82ec67`) |
| GS-003 | GS- | DailyRmIssueLog | `DailyRmIssueLog.gs` | Closed + Monitored | GS-002, GS-012, GS-004, GS-008, SHEET-001, SHEET-002, SHEET-003 | none (capture scheduled; leaderboard manual) | 2026-09-10 (`c82ec67`) |
| GS-004 | GS- | EmailInfra | `EmailInfra.gs` | Closed + Monitored | GS-002, GS-011, SHEET-001, SHEET-006, SHEET-007, SHEET-012, EXT-002 | GS-001, GS-008, GS-010, GS-011, GS-003 | 2026-09-10 (`c82ec67`) |
| GS-005 | GS- | FollowupEngine | `FollowupEngine.gs` | Closed + Monitored | GS-002 | GS-012, GS-010, GS-001, GS-013, GS-006 | 2026-09-10 (`c82ec67`) |
| GS-006 | GS- | InteractionHistoryLogger | `InteractionHistoryLogger.gs` | Closed + Monitored | GS-002, GS-005, GS-004, SHEET-001, SHEET-009 | GS-008 (piggyback) | 2026-09-10 (`c82ec67`) |
| GS-007 | GS- | LeadFollowupsStaleness | `LeadFollowupsStaleness.gs` | Closed + Monitored | SHEET-004 | none (manual setup utility) | 2026-09-10 (`c82ec67`) |
| GS-008 | GS- | MovementTracker | `MovementTracker.gs` | Closed + Monitored | GS-002, GS-012, GS-004, GS-013, GS-006, SHEET-001, SHEET-002, SHEET-005, SHEET-008, SHEET-009, SHEET-010 | GS-001, GS-010, GS-003, GS-009 | 2026-09-10 (`c82ec67`) |
| GS-009 | GS- | OpsChecklistRunner | `OpsChecklistRunner.gs` | Closed + Monitored | GS-011, GS-008, GS-004, SHEET-002, SHEET-006, SHEET-007, EXT-002 | none (scheduled leaf) | 2026-09-10 (`c82ec67`) |
| GS-010 | GS- | OvernightEmailer | `OvernightEmailer.gs` | Closed + Monitored | GS-002, GS-012, GS-005, GS-004, GS-008, GS-011, SHEET-001, SHEET-004, SHEET-006, SHEET-007, SHEET-012, EXT-002 | none (scheduled leaf) | 2026-09-10 (`c82ec67`) |
| GS-011 | GS- | RmHierarchy | `RmHierarchy.gs` | Closed + Monitored | GS-002, GS-004, SHEET-006, SHEET-007, SHEET-012 | GS-004, GS-001, GS-010, GS-009 | 2026-09-10 (`c82ec67`) |
| GS-012 | GS- | SlaEngine | `SlaEngine.gs` | Closed + Monitored | GS-002, GS-005 | GS-008, GS-010, GS-001, GS-003 | 2026-09-10 (`c82ec67`) |
| GS-013 | GS- | UnmatchedCommentLogger | `UnmatchedCommentLogger.gs` | Closed + Monitored | GS-002, GS-005, GS-004, SHEET-001, SHEET-010 | GS-008 (piggyback) | 2026-09-10 (`c82ec67`) |

`RmHierarchy.private.gs` is **not** cataloged — gitignored, real employee
emails, never in this repo (`DOC-007`).

### `SHEET-` — Google Sheet tabs (partial seed — full list + count confirmed in `DOC-010` / `DOC-032`)

| ID | Type | Name | Location | Record Status | Depends On | Used By | Last Verified |
|---|---|---|---|---|---|---|---|
| SHEET-001 | SHEET- | leads (the live leads tab) | Google Sheet | Not Started | | | |
| SHEET-002 | SHEET- | Movement_Log | Google Sheet | Not Started | | | |
| SHEET-003 | SHEET- | Daily_RM_Issues | Google Sheet | Not Started | | | |
| SHEET-004 | SHEET- | Lead_Followups | Google Sheet | Not Started | | | |
| SHEET-005 | SHEET- | SLA_History | Google Sheet | Not Started | | | |
| SHEET-006 | SHEET- | RM_Hierarchy | Google Sheet | Not Started | | | |
| SHEET-007 | SHEET- | Manager_Directory | Google Sheet | Not Started | | | |
| SHEET-008 | SHEET- | Daily_Cohort_History | Google Sheet | Not Started | | | |
| SHEET-009 | SHEET- | Comment_History | Google Sheet | Not Started | | | |
| SHEET-010 | SHEET- | Unmatched_Comments_Log | Google Sheet | Not Started | | | |
| SHEET-011 | SHEET- | Send_Log | Google Sheet | Not Started | | | |
| SHEET-012 | SHEET- | Region_Recipients | Google Sheet | Not Started | | | |
| SHEET-013 | SHEET- | AllIssues_Log | Google Sheet | Not Started | | | |
| SHEET-014 | SHEET- | Overnight_Log | Google Sheet | Not Started | | | |

**Seed correction (DOC-029):** `SHEET-009` renamed `Interaction_History` →
`Comment_History` (the real tab name, per `LOGIC_AUDIT.md` Part 1 §1 and
`InteractionHistoryLogger.gs` `ensureCommentHistorySheet_`); `SHEET-011`..`014`
added — the full 14-tab set matches `LOGIC_AUDIT.md` Part 1 §1's datastore
list. `DOC-032` writes the base records; `DOC-036` fills lifecycle/retention.

### `EXT-` — external integrations (confirm exact set in `DOC-011` / `DOC-033`)

| ID | Type | Name | Location | Record Status | Depends On | Used By | Last Verified |
|---|---|---|---|---|---|---|---|
| EXT-001 | EXT- | Google Sheets API (v4) | via `js/core-sheets-fetch.js` / `SpreadsheetApp` | Not Started | | | |
| EXT-002 | EXT- | Gmail (send) — dashboard OAuth grant + `GmailApp` | `js/reports-gmail.js` / `EmailInfra.gs` | Not Started | | | |
| EXT-003 | EXT- | Google Identity / OAuth (sign-in gate) | `js/core-auth.js` | Not Started | | | |
| EXT-004 | EXT- | jsPDF + jspdf-autotable (PDF export) | `js/repeat-offenders-pdf.js` | Not Started | | | |

### `DATA-` / `FLOW-` / `TRIGGER-` — filled in Phase 3 (`DOC-034` / `DOC-035`)

No rows yet — data flows and cross-file workflows are identified and
recorded in Phase 3.

---

## Coverage snapshot (auto-checkable target)

- `JS-` records: 24 / 24 (core `JS-001`..`JS-011` DOC-027; feature `JS-012`..`JS-024` DOC-028)
- `GS-` records: 13 / 13 (DOC-029 — trigger schedules + `setupXxx()` re-run conditions on each)
- `TAB-` records: 8 / 8 (DOC-026)
- `SHEET-` records: 0 / 14 (list confirmed against `LOGIC_AUDIT.md` Part 1 §1; base records = `DOC-032`)
- `EXT-` records: 0 / 4
- `DASH-` records: 1 / 1 (DOC-025)
- **This matches `test/check-docs-coverage.js`'s current warn output** —
  when Phase 3 lands records, that check's coverage % and this snapshot
  should move together.
