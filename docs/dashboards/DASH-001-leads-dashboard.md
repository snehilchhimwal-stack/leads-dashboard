# DASH-001 — Leads Dashboard

| | |
|---|---|
| **Type** | `DASH-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `dashboard.html` + `js/*.js` (24 client modules) — deployed on GitHub Pages from `github.com/snehilchhimwal-stack/leads-dashboard` |
| **Owner** | Snehil (default — see `../NAMING_CONVENTIONS.md`) |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

The raw CRM export that lands in the Google Sheet's `leads` tab is a flat
row-per-lead dump with no operational layer: no SLA flags, no funnel
view, no per-RM accountability, no region routing, no history. DASH-001
is that operational layer. A signed-in regional head or team lead opens
one static web page and sees every lead classified by funnel stage and
by the 5 Operations SLA checks (`enrichLead`, `JS-006`), can slice it by
project / region / TL / source / issue bucket, can generate and send
per-region summary emails through their own Gmail, and can write
snapshots / a human-review follow-up queue / SLA history back to the
Sheet. It exists as a **client-only** page (no server, no build step) so
it can be hosted for free on GitHub Pages and so every write and send
requires a human present and signed in — the unattended half of the
system is the Apps Script backend (`GS-*`), which is deliberately a
separate runtime.

## Responsibilities

- Gate all access behind a Google sign-in (`JS-001`, `EXT-003`).
- Read the `leads` tab (and `Movement_Log`, `RM_Hierarchy` separately)
  via the Sheets API v4 (`JS-009`, `EXT-001`), collate multi-RM copies
  into one customer record, and enrich each with derived SLA/funnel
  state.
- Render all 8 tabs (`TAB-001`..`TAB-008`) from in-memory state.
- Apply the multi-select filter bar in-memory and re-render (`JS-004`).
- Build per-region email report content (`JS-014`) and send it by
  `mailto:` (`JS-016`) or the real Gmail API (`JS-015`, `EXT-002`).
- Own every client-side write back to the Sheet through one module
  (`JS-018`): on-demand `Movement_Log` snapshot, `Lead_Followups`
  upsert, `SLA_History` upsert, `Daily_Cohort_History` upsert,
  `Send_Log` append.
- Export PDF (`JS-013`, `EXT-004`) and CSV (in `JS-012`, `JS-019`,
  `JS-021`).

## Inputs

| Input | Originates from |
|---|---|
| Google OAuth token (Sheets scope) | `EXT-003` via `JS-001` |
| `leads` tab rows | `SHEET-001` (external CRM export) |
| `Movement_Log` rows | `SHEET-002` (written by `GS-008` + `JS-018`) |
| `RM_Hierarchy` rows | `SHEET-006` (read-only, for display rollup — `JS-022`) |
| `SLA_History` / `Daily_Cohort_History` rows | `SHEET-005` / `SHEET-008` (for cohort-correct history views) |
| Sheet ID / tab name | user input (`#sheetIdInput`, defaults to the production sheet) |
| Filter selections | user input → `filterState` (`JS-004`) |
| Per-region recipient lists | user input, `localStorage`-persisted (`JS-016`) |

## Outputs

| Output | Goes to |
|---|---|
| Rendered tables / KPIs / charts / issue cards | user / screen (`TAB-001`..`TAB-008`) |
| Per-region summary emails | email recipients, via `mailto:` or Gmail API (`EXT-002`) |
| `Movement_Log` snapshot rows | `SHEET-002` (via `JS-018`) |
| `Lead_Followups` rows (cols A–E, G; **never** F) | `SHEET-004` (via `JS-018`) |
| `SLA_History` rows | `SHEET-005` (via `JS-018`) |
| `Daily_Cohort_History` rows | `SHEET-008` (via `JS-018`) |
| `Send_Log` append rows | `SHEET-011` (via `JS-018`, fire-and-forget) |
| Repeat Offenders PDF | user download (`JS-013`) |
| CSV exports (issues, filtered lead-ids, unmatched comments) | user download (`JS-012`, `JS-021`) |

## Data lineage

`leads` tab (`SHEET-001`) → Sheets API GET (`JS-009` `sheetsApiValuesGet`)
→ `HEADER_ALIASES` column map → union-find collation + merge inside
`fetchAndRender` (`JS-003`) → `allParsedLeads` (state) → `enrichLead`
(`JS-006`) applied per `filterState` in `applyFiltersAndRender` (`JS-004`)
→ `leads` / `issueLeads` (state) → ~20 `render*()` functions → screen.
Write paths all funnel through `JS-018`. Full per-flow detail:
`DATA-001`..`DATA-005`.

## Important logic / business rules

Not restated here — each lives on its owning record:

- The 5 Operations SLA checks + funnel classification → `JS-006`
  (`enrichLead`), mirrored in `GS-012` (`computeSlaFlags_`).
- Comment classification (~110 signals) → `JS-007` (`OUTCOME_RULES`),
  mirrored in `GS-005` (`OUTCOME_RULES_GS_`).
- Multi-copy collation (MAX not SUM on `call_attempts`/`call_count`/
  `duration`) → `JS-003`.
- RM Performance scoring (empirical-Bayes shrinkage) → `JS-008`,
  mirrored in `GS-003` (`RM_PERF_*_GS_`).
- Region normalization / Loan override → `JS-014` (`effectiveRegion`).
- 3-phase Generate cycle + `_generateCycleOwner` mutex → `JS-016` +
  `JS-018`.
- End-to-end flows → `DATA-001`..`DATA-005`.

## Exceptions & error handling

- Bad / missing sign-in: page renders nothing but the gate (`JS-001`).
- 404 sheet-not-found vs 403 access-denied: distinct `NOT_FOUND` /
  `ACCESS_DENIED` codes in `fetchAndRender` (`JS-003`), each with its own
  message — confirmed correctly labelled (`LOGIC_AUDIT.md` Part 6 §6.1
  row 7).
- Expired token mid-session: a background 401; the next user action
  re-prompts.
- `RM_Hierarchy` still loading when a PDF export is requested: `JS-013`
  refuses with a status message rather than exporting leadership rows
  (`EXC` on `JS-013`, added `ddc0097`).
- A blocked download in a sandboxed viewer: PDF/CSV `<a download>` is
  inert; not handled, documented.

## UI relationships

Contains `TAB-001` Morning Brief, `TAB-002` Overview, `TAB-003`
Operations, `TAB-004` Repeat Offenders, `TAB-005` People, `TAB-006`
Audit, `TAB-007` Movement, `TAB-008` Tracking. Tab-specific buttons live
on each `TAB-XXX` record as `BTN-XXX` sub-tables.

## Architecture relationship

Top of the tree. Every `JS-XXX` record's `Architecture relationship`
points here. The other half of the system — the Apps Script backend
(`GS-*`) — is **not** part of `DASH-001`; the two share only the Google
Sheet (`SHEET-*`) and never call each other (`HANDOVER.md` §1).

## Entry points

- One URL: the GitHub Pages deployment (confirm the Pages source branch
  under repo Settings → Pages — `HANDOVER.md` §2 notes this is not
  re-verified there).
- `#authGate` sign-in (`JS-001`) — nothing renders until the Sheets
  OAuth grant completes.
- `#sheetIdInput` + fetch → `fetchAndRender()` (`JS-003`).

## Tabs it contains

`TAB-001` Morning Brief · `TAB-002` Overview · `TAB-003` Operations ·
`TAB-004` Repeat Offenders · `TAB-005` People (contains RM Timeline) ·
`TAB-006` Audit · `TAB-007` Movement · `TAB-008` Tracking. Tab-bar order
matches `dashboard.html`'s own `#tabBar`.

## Top-level buttons / actions

| Action | Element | What it does |
|---|---|---|
| Sign in | `#authGate` button | `gateSignIn()` (`JS-001`) — Sheets OAuth grant |
| Fetch / refresh | `#sheetIdInput` + fetch button | `fetchAndRender()` (`JS-003`) — full re-pull + `renderAll()` |
| Connect Gmail | reports UI | `connectGmail()` (`JS-015`) — the **separate** Gmail OAuth grant |
| Tab switch | `#tabBar` (delegated) | pure `display` toggle (`JS-012`) — content is pre-rendered, not re-rendered on switch |

Tab-scoped buttons (Snapshot Now, Generate Region Emails, SLA_History
admin, etc.) belong to their `TAB-XXX` records.

## HTML / CSS structure

`dashboard.html` (~1429 lines) = DOM shell + one ~815-line `<style>`
block (dark theme via CSS custom properties). No inline `<script>`, no
inline `onclick`, no `<template>` — all interactivity is wired by
`addEventListener` inside the JS files. It loads 3 CDN scripts (Google
Identity Services, jsPDF, jspdf-autotable) then all 24 local `js/*.js`
files. **The real `<script src>` order does not exactly match CLAUDE.md's
documented order** — `core-sheets-fetch`/`core-auth` and
`core-ui`/`core-filters` are pair-swapped, and `core-rm-performance.js`
loads late among the tab files, not in the first 9 (`LOGIC_AUDIT.md` Part
1 §4a; functionally harmless today, a documented staleness item Part
6/7). `HTML-XXX`/`CSS-XXX` sub-tables are not broken out — the structure
is a single shell and a single token system, below the own-file
threshold (`../NAMING_CONVENTIONS.md`).

## Data sources

Reads: `SHEET-001` (`leads`), `SHEET-002` (`Movement_Log`), `SHEET-005`
(`SLA_History`), `SHEET-006` (`RM_Hierarchy`), `SHEET-008`
(`Daily_Cohort_History`). Via `EXT-001` (Sheets API v4). Auth via
`EXT-003`.

## Data written / modified

Writes: `SHEET-002` (`Movement_Log` snapshot), `SHEET-004`
(`Lead_Followups`), `SHEET-005` (`SLA_History`), `SHEET-008`
(`Daily_Cohort_History`), `SHEET-011` (`Send_Log`) — **all via `JS-018`**
(`sheets-writeback.js`), the single client write module. Gmail send via
`JS-015` / `EXT-002`.

## What should / should not be changed

- **The two halves must stay independent.** The browser client and the
  Apps Script backend never call each other; they meet only through
  shared Sheet tabs (`HANDOVER.md` §1). Do not add a call from one to
  the other.
- **Duplicated logic must be edited in both runtimes.** SLA rules,
  comment classification, stage ordering, RM-performance constants,
  region maps all exist once in `js/*.js` and once in `*.gs`
  (`HANDOVER.md` §6, `LOGIC_AUDIT.md` Part 4). Editing one side only
  makes the dashboard and the automatic emails silently disagree.
- **Apps Script does not auto-deploy from git.** Any `.gs` edit is not
  live until pasted into the Sheet's bound Apps Script editor; a
  schedule change also needs its `setupXxx()` re-run (`CLAUDE.md` top
  gotcha).
- **Script load order:** a new `js/*.js` file needs its `<script src>`
  tag placed after its dependencies and before `main.js`.
- Element `id`s and top-level function names are a cross-file contract
  (9-way split, all `getElementById` / bare global calls) — renames
  ripple.

## Known limitations

Cited by finding, not re-described — see `LOGIC_AUDIT.md` Part 7 §18 and
Part 6 §6.6:

| Sev | Finding | Where |
|---|---|---|
| 🟠 HIGH | Loan-region `effectiveRegion` override missing from all 3 scheduled-email call sites (a `GS-*` gap, not a `DASH-001` bug, but it makes the dashboard and the emails disagree on Loan leads) | Part 4 §4.4 / Part 7 §18 HIGH |
| 🟡 MED | `browserSnapshotOpenLeads` has no reentrancy guard | §18 MEDIUM #1 |
| 🟡 MED | `CONFIG.MIN_CALLS_AFTER_48H` is display-only, disagrees with the real flag threshold | §18 MEDIUM #2 |
| 🟡 MED | Unguarded cross-runtime `Lead_Followups` overlap window | §18 MEDIUM #3 |
| 🔵 LOW | "Possible Premature Closes" has no scheduled-email equivalent | §18 LOW #1 |
| 🔵 LOW | KPI strip mixes customer-level and issue-level counts, undocumented in the UI | §18 LOW #2 |
| 🔵 LOW | Dropped click during rapid filter changes | §18 LOW #3 |
| 🔵 LOW | `RmHierarchy.gs` is a single point of failure for both scheduled emails | §18 LOW #4 |

The 7-item "known bug list" from the earlier UI-redesign plan was
**re-verified and none reproduce** against current code (`LOGIC_AUDIT.md`
Part 6 §6.1).

## Related documentation

`HANDOVER.md` §1–§3 (living architecture description until this catalog
takes over), §6 (duplication pairs), §8 (incident history);
`LOGIC_AUDIT.md` Part 1 (architecture), Parts 4/6/7 (findings);
`CLAUDE.md` (gotchas); `OPS_CHECKLIST.md`, `LEAD_FOLLOWUPS_STALENESS.md`
for the specific subsystems.

## Relationships

- **Depends On:** `TAB-001`, `TAB-002`, `TAB-003`, `TAB-004`, `TAB-005`,
  `TAB-006`, `TAB-007`, `TAB-008`, `JS-001`, `JS-003`, `JS-004`,
  `SHEET-001`, `SHEET-011`, `EXT-001`, `DATA-001`
- **Used By:** `none` — top of the tree; nothing in this catalog depends on `DASH-001`
- **Related:** the Apps Script backend (`GS-001`..`GS-013`) — a
  peer half of the system, sharing only `SHEET-*`, never a dependency

## Source of truth

`dashboard.html` and `js/*.js` at `HEAD`. `HANDOVER.md` §1–§3 is the
current narrative; `LOGIC_AUDIT.md` Part 1 is the frozen 2026-09-07
architecture snapshot.

## Validation

- **Method:** cross-read of `HANDOVER.md` §1–§3 + `LOGIC_AUDIT.md` Part 1
  against the live file list (`js/*.js`, 24 files) and `dashboard.html`
  at commit `c82ec67`; the client pipeline is exercised by
  `tests/frontend-harness.html` (grafts the real `dashboard.html` +
  `js/*.js`, mocks only the Sheets read + OAuth token pair, runs
  synthetic leads through the real `fetchAndRender()`).
- **Evidence:** `HANDOVER.md` §1–§3; `LOGIC_AUDIT.md` Part 1;
  `tests/frontend-harness.html`.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at commit `c82ec67` (Phase 2 of the Documentation Project);
record created by DOC-025.

## Revalidation trigger

Any of: a `js/*.js` file added or removed (changes the module count and
the `<script src>` list); `dashboard.html`'s tab-bar set changes; a new
top-level entry point / OAuth grant is added; `HANDOVER.md` §1–§3
changes; a new `SHEET-XXX` becomes a direct dashboard read/write target.

## Handover relationship

`HANDOVER.md` §1 (what this is), §2 (repository layout), §3 (how the
dashboard works) cover this directly and are current as of 2026-09-09
(their last update). A change to the two-halves architecture, the tab
set, or the load-order contract must update `HANDOVER.md` §1–§3 in the
**same commit** (`CLAUDE.md` gotcha; `INDEX.md` "three-document
relationship" rule).

## Lifecycle / retention

N/A — code, lives and dies with the repo.

## Next action

none — Closed + Monitored.

## Closure evidence

- Record file: `docs/dashboards/DASH-001-leads-dashboard.md` (this file),
  commit for DOC-025.
- `docs/INDEX.md` `DASH-001` row updated to `Closed + Monitored`,
  `Last Verified` 2026-09-10.
- Validation evidence: `HANDOVER.md` §1–§3, `LOGIC_AUDIT.md` Part 1,
  `tests/frontend-harness.html`.
- No `docs/changes/` record — this closure was prompted by the
  Documentation Project (DOC-025), not by a code change (DoD point 14).
