# Button inventory (`DOC-009` + `DOC-031`)

**Status:** built `DOC-031` (Phase 3), reconciled against `DOC-009`'s
Phase 1 spec 2026-09-10 (see "`DOC-009` reconciliation" at the end).
Verified 2026-09-10 against commit `c82ec67` (record set) / `e281f9b`
(this note).
**Scope:** every `<button>` / user-action control in `dashboard.html`
that runs application logic. `DOC-009` (the standalone inventory task)
was `Not Started` when Phase 3 ran, so this was **enumerated directly**
from `dashboard.html` —
`grep -oE '<button[^>]*id="[^"]*"'` plus the id-less `.tab-btn` set and
the `#autoSnapshotCheck` checkbox — and the `BTN-XXX` rows in the
`TAB-XXX` records ARE the inventory. This file is the reconciliation
record required by `DOC-031`.

---

## Reconciliation result

`dashboard.html` contains **34 `<button>` elements**:

| Group | Count | Where documented |
|---|---|---|
| Id'd `<button>` on a tab panel | 22 | `BTN-001`..`BTN-022`, in their owning `TAB-XXX` record's `## Buttons / actions` sub-table |
| Id'd `<button>` in the persistent top bar | 4 | `DASH-001` → `## Top-level buttons / actions` (sign in, refresh, change source, clear filters) + 1 more (`#downloadLeadIdsBtn`) noted there |
| Id-less `.tab-btn` (`data-tab=…`) | 8 | one delegated handler on `#tabBar` → `DASH-001` "Tab switch" row (not 8 separate `BTN-XXX`) |
| **Total `<button>`** | **34** | — |
| Plus `#autoSnapshotCheck` (`<input type=checkbox>`, not a `<button>`) | 1 | `BTN-015` (`TAB-007`) — a user action, so it gets a `BTN-XXX` |

**`BTN-001` … `BTN-022`** assigned, contiguous, no gaps, each owned by
exactly one `TAB-XXX` record. Zero unresolved gaps between "buttons in
`dashboard.html`" and "`BTN-XXX` rows in a record."

---

## Full map

### Top bar — `DASH-001` (persistent across every tab)

| Element id | Action | Handler | Documented |
|---|---|---|---|
| `#gateSignInBtn` | sign in (Sheets OAuth) | `gateSignIn` (`JS-001` FN-004) | `DASH-001` top-level actions |
| `#refreshBtn` | full re-fetch + `renderAll()` | `fetchAndRender` (`JS-003` FN-015) | `DASH-001` |
| `#changeSourceBtn` | switch the Sheet source | `JS-012` + `JS-003` | `DASH-001` |
| `#clearFiltersBtn` | reset `filterState` | `JS-004` FN-020 | `DASH-001` |
| `#downloadLeadIdsBtn` | filtered lead-ids CSV | `downloadFilteredLeadIdsCSV` (`JS-012` FN-085) | `DASH-001` (population = Overview "Total Leads" KPI) |
| `.tab-btn` × 8 (`data-tab`) | tab switch (pure `display` toggle) | delegated click on `#tabBar` (`JS-012`) | `DASH-001` "Tab switch" |

### `TAB-003` Operations

| `BTN-XXX` | id | Invokes |
|---|---|---|
| BTN-001 | `#downloadIssuesBtn` | `downloadIssuesCSV` (`JS-012` FN-085) |
| BTN-002 | `#generateBtn` | `renderReports` (`JS-016` FN-111) |
| BTN-003 | `#generateAllReportsBtn` | `renderAllRegionReports` (`JS-016` FN-112) |
| BTN-004 | `#downloadAllReportsBtn` | `downloadAllReports` (`JS-016` FN-118) |
| BTN-005 | `#regionRecipientsToggle` | recipient-editor toggle (`JS-016` FN-117) |
| BTN-006 | `#gmailConnectBtn` | `connectGmail` (`JS-015` FN-105) |
| BTN-007 | `#gmailSaveClientIdBtn` | `saveGmailClientId` (`JS-015` FN-105) |
| BTN-008 | `#gmailSetupToggle` | Gmail setup panel toggle (`JS-015`) |
| BTN-009 | `#followupsWaitCancelBtn` | keyed cancel via `_followupWaitCancelled` Map (`JS-018` FN-127) |

### `TAB-004` Repeat Offenders

| `BTN-XXX` | id | Invokes |
|---|---|---|
| BTN-010 | `#repeatOffendersRecalculateBtn` | worker dispatch → `computeRmPerformance*` (`JS-017` / `JS-008`) |
| BTN-011 | `#repeatOffendersDownloadPdfBtn` | `downloadRepeatOffendersPdf` (`JS-013` FN-088) — refuses if `RM_Hierarchy` still loading |

### `TAB-006` Audit

| `BTN-XXX` | id | Invokes |
|---|---|---|
| BTN-012 | `#auditCopyBtn` | `copyAuditIds` (`JS-019` FN-136) |
| BTN-013 | `#auditCsvBtn` | `downloadAuditCSV` (`JS-019` FN-136) |

### `TAB-007` Movement

| `BTN-XXX` | id | Invokes | Note |
|---|---|---|---|
| BTN-014 | `#snapshotNowBtn` | `browserSnapshotOpenLeads` (`JS-018` FN-121) | **DOM position = top bar; function owner = `TAB-007`** (wired by `initMovementUI`). Placed on `TAB-007` deliberately — its behaviour is Movement-specific — and cross-listed under `DASH-001`'s top-level actions as "snapshot" |
| BTN-015 | `#autoSnapshotCheck` (checkbox) | auto-snapshot tick (`JS-018` / `JS-021`) | same top-bar/owner split as BTN-014 |
| BTN-016 | `#overnightGenerateReportsBtn` | Overnight generate cycle (`JS-021` FN-146 → `JS-016` / `JS-018`) | |
| BTN-017 | `#overnightFollowupsWaitCancelBtn` | keyed cancel (`JS-018` FN-127) | |
| BTN-018 | `#downloadUnmatchedCommentsBtn` | `downloadUnmatchedCommentsCSV` (`JS-021` FN-145) | |

### `TAB-008` Tracking

| `BTN-XXX` | id | Invokes | Irreversible? |
|---|---|---|---|
| BTN-019 | `#backfillSlaHistoryBtn` | `backfillSlaHistoryFromMovementLog` (`JS-018` FN-128) | no — upsert, re-runnable |
| BTN-020 | `#clearSlaHistoryBtn` | `clearSlaHistory` (`JS-004` FN-025) | **yes — permanent delete** |
| BTN-021 | `#backfillDailyCohortHistoryBtn` | `upsertDailyCohortHistoryRows` (`JS-018` FN-129) | no — never overwrites an archived date |
| BTN-022 | `#clearDailyCohortHistoryBtn` | clear handler (`JS-024`) | **yes — permanent delete** |

### Tabs with no buttons of their own

`TAB-001` Morning Brief, `TAB-002` Overview, `TAB-005` People (RM
Timeline uses UI elements — the RM selector `UI-007`, calendar cells
`UI-008` — not buttons). Recorded as an explicit "none" in each record's
`BTN-XXX` sub-table.

---

## Console-only actions — deliberately NOT given a `BTN-XXX`

These run from the browser console or the Apps Script editor and have
**no UI control** — out of scope for the button inventory (recorded here
so their absence is not a gap):

| Function | Where | Why no button |
|---|---|---|
| `clearSlaHistory` batch path, `snapshotSlaHistory` | `JS-004` | `clearSlaHistory` *does* have `BTN-020`; `snapshotSlaHistory` is checkpoint-driven, no button |
| `backfillSlaHistoryFromMovementLog` sibling utilities | `JS-018` | console-callable admin |
| every `*Now()` / `setup*()` in the `GS-*` files | Apps Script editor | backend, editor-run — see each `GS-XXX` record's Trigger Schedule + FN sub-table |

---

## How this stays reconciled

`test/check-docs-coverage.js` does **not** check button coverage. So it
is process: `DOC-031`'s revalidation trigger is "any commit that
adds/removes a `<button id>` or user-action control in `dashboard.html`"
— at which point this file and the owning `TAB-XXX` record's `BTN-XXX`
sub-table are updated in the same commit.

## Gaps found and resolved during this reconciliation

None. All 26 id'd buttons + the tab-switcher set + the `#autoSnapshotCheck`
checkbox were already covered by `BTN-001`..`BTN-022` and the `DASH-001`
top-level actions section (both written under `DOC-026`). The only
judgment call — placing `#snapshotNowBtn` / `#autoSnapshotCheck` on
`TAB-007` rather than `DASH-001` despite their top-bar DOM position — is
documented above and cross-referenced in both records.

---

## `DOC-009` reconciliation (Phase 1)

`DOC-009` is the Phase 1 task whose deliverable *is* this file. It ran
**after** `DOC-031` produced the file. This section confirms the file
satisfies `DOC-009`'s spec.

### What `DOC-009` asks for

1. Search `dashboard.html` for every `<button` / interactive control by
   `id`.
2. For each, confirm **by reading the actual `addEventListener` call
   site** which file/function wires it and which function it calls — not
   from the button's `id` alone.
3. Note that `dashboard.html` has **zero inline `onclick=`-style
   handlers** — every button is wired in JS.

### `DOC-009` DoD check

- **Every `<button` (and any other clickable control that triggers a
  real action, e.g. `#autoSnapshotCheck`) in `dashboard.html` has a
  row** — ✅. The "Reconciliation result" section: 34 `<button>`
  elements — 22 tab-panel (`BTN-001`..`BTN-022`) + 4 top-bar + the
  8-button tab switcher (→ `DASH-001` top-level actions) — plus the
  `#autoSnapshotCheck` checkbox (`BTN-015`). Nothing left.
- **Every row's target function is confirmed by reading the actual
  `addEventListener` call site** — ✅. Every `BTN-XXX` `Invokes` cell
  and every `DASH-001` top-level-action handler was resolved by
  `grep -rnE "getElementById\('<id>'\)" js/` + reading the wiring during
  `DOC-026` (see that task's session work); the "Full map" tables here
  name the wiring file/function for each. `dashboard.html`'s
  **zero inline handlers** confirmed by
  `grep -c 'onclick=' dashboard.html` → 0 (`LOGIC_AUDIT.md` Part 1 §4a).

### `DOC-009` note

The one place a button's behaviour is *not* a plain
`getElementById(...).addEventListener(...)` in a tab file is the tab
switcher — a single **delegated** `click` handler on `#tabBar`
(`js/overview-distribution-people-ops.js:364`) covering all 8
`.tab-btn`s. Recorded as `DASH-001`'s "Tab switch" action, not 8
`BTN-XXX` rows.
