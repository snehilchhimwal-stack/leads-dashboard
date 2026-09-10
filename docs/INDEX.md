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
| TAB-001 | TAB- | Morning Brief | `js/tab-morning.js` (JS-020) | Not Started | | | |
| TAB-002 | TAB- | Overview | `js/overview-distribution-people-ops.js` (JS-012) | Not Started | | | |
| TAB-003 | TAB- | Operations | `js/overview-distribution-people-ops.js` (JS-012) | Not Started | | | |
| TAB-004 | TAB- | Repeat Offenders | `js/tab-repeat-offenders.js` (JS-022) + `js/repeat-offenders-pdf.js` (JS-013) + worker (JS-017) | Not Started | | | |
| TAB-005 | TAB- | People | `js/overview-distribution-people-ops.js` (JS-012) + `js/tab-rmtimeline.js` (JS-023) | Not Started | | | |
| TAB-006 | TAB- | Audit | `js/tab-audit.js` (JS-019) | Not Started | | | |
| TAB-007 | TAB- | Movement | `js/tab-movement.js` (JS-021) | Not Started | | | |
| TAB-008 | TAB- | Tracking | `js/tab-tracking.js` (JS-024) | Not Started | | | |

### `JS-` — client-side modules

| ID | Type | Name | Location | Record Status | Depends On | Used By | Last Verified |
|---|---|---|---|---|---|---|---|
| JS-001 | JS- | core-auth | `js/core-auth.js` | Not Started | | | |
| JS-002 | JS- | core-collation | `js/core-collation.js` | Not Started | | | |
| JS-003 | JS- | core-fetch-and-render | `js/core-fetch-and-render.js` | Not Started | | | |
| JS-004 | JS- | core-filters | `js/core-filters.js` | Not Started | | | |
| JS-005 | JS- | core-foundation | `js/core-foundation.js` | Not Started | | | |
| JS-006 | JS- | core-lead-model | `js/core-lead-model.js` | Not Started | | | |
| JS-007 | JS- | core-outcome-engine | `js/core-outcome-engine.js` | Not Started | | | |
| JS-008 | JS- | core-rm-performance | `js/core-rm-performance.js` | Not Started | | | |
| JS-009 | JS- | core-sheets-fetch | `js/core-sheets-fetch.js` | Not Started | | | |
| JS-010 | JS- | core-ui | `js/core-ui.js` | Not Started | | | |
| JS-011 | JS- | main | `js/main.js` | Not Started | | | |
| JS-012 | JS- | overview-distribution-people-ops | `js/overview-distribution-people-ops.js` | Not Started | | | |
| JS-013 | JS- | repeat-offenders-pdf | `js/repeat-offenders-pdf.js` | Not Started | | | |
| JS-014 | JS- | reports-build | `js/reports-build.js` | Not Started | | | |
| JS-015 | JS- | reports-gmail | `js/reports-gmail.js` | Not Started | | | |
| JS-016 | JS- | reports-ui | `js/reports-ui.js` | Not Started | | | |
| JS-017 | JS- | rm-performance-worker | `js/rm-performance-worker.js` | Not Started | | | |
| JS-018 | JS- | sheets-writeback | `js/sheets-writeback.js` | Not Started | | | |
| JS-019 | JS- | tab-audit | `js/tab-audit.js` | Not Started | | | |
| JS-020 | JS- | tab-morning | `js/tab-morning.js` | Not Started | | | |
| JS-021 | JS- | tab-movement | `js/tab-movement.js` | Not Started | | | |
| JS-022 | JS- | tab-repeat-offenders | `js/tab-repeat-offenders.js` | Not Started | | | |
| JS-023 | JS- | tab-rmtimeline | `js/tab-rmtimeline.js` | Not Started | | | |
| JS-024 | JS- | tab-tracking | `js/tab-tracking.js` | Not Started | | | |

### `GS-` — Apps Script backend modules (production; `Tests_*.gs` excluded per `DOC-007`)

| ID | Type | Name | Location | Record Status | Depends On | Used By | Last Verified |
|---|---|---|---|---|---|---|---|
| GS-001 | GS- | AllIssuesEmailer | `AllIssuesEmailer.gs` | Not Started | | | |
| GS-002 | GS- | Core | `Core.gs` | Not Started | | | |
| GS-003 | GS- | DailyRmIssueLog | `DailyRmIssueLog.gs` | Not Started | | | |
| GS-004 | GS- | EmailInfra | `EmailInfra.gs` | Not Started | | | |
| GS-005 | GS- | FollowupEngine | `FollowupEngine.gs` | Not Started | | | |
| GS-006 | GS- | InteractionHistoryLogger | `InteractionHistoryLogger.gs` | Not Started | | | |
| GS-007 | GS- | LeadFollowupsStaleness | `LeadFollowupsStaleness.gs` | Not Started | | | |
| GS-008 | GS- | MovementTracker | `MovementTracker.gs` | Not Started | | | |
| GS-009 | GS- | OpsChecklistRunner | `OpsChecklistRunner.gs` | Not Started | | | |
| GS-010 | GS- | OvernightEmailer | `OvernightEmailer.gs` | Not Started | | | |
| GS-011 | GS- | RmHierarchy | `RmHierarchy.gs` | Not Started | | | |
| GS-012 | GS- | SlaEngine | `SlaEngine.gs` | Not Started | | | |
| GS-013 | GS- | UnmatchedCommentLogger | `UnmatchedCommentLogger.gs` | Not Started | | | |

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
| SHEET-009 | SHEET- | Interaction_History | Google Sheet | Not Started | | | |
| SHEET-010 | SHEET- | Unmatched_Comments_Log | Google Sheet | Not Started | | | |

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

- `JS-` records: 0 / 24
- `GS-` records: 0 / 13
- `TAB-` records: 0 / 8
- `SHEET-` records: 0 / ≥10 (count TBD, `DOC-010`)
- `EXT-` records: 0 / 4
- **This matches `test/check-docs-coverage.js`'s current warn output** —
  when Phase 3 lands records, that check's coverage % and this snapshot
  should move together.
