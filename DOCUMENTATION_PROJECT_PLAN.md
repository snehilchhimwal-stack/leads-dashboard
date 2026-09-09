# Central Data & System Documentation Project

**Target system**: Leads Dashboard (`C:\Users\User\Desktop\Strategy\Google leads Dashboard`) —
`dashboard.html` + 23 `js/*.js` files (static, client-only, GitHub Pages) +
11 production `.gs` files (Google Apps Script, bound to the same Google
Sheet, running unattended). This plan does not assume implementation
details beyond what is already independently verified in this
repo's own `CLAUDE.md`, `HANDOVER.md`, and — most heavily — the 7-part
`LOGIC_AUDIT.md` produced in this same working session. Where this plan
names a real file, function, or Sheet tab, it is because that name was
independently confirmed by direct code reads during that audit, not
invented for this plan. Anything not yet confirmed is marked
**UNKNOWN/TBD** with its own resolution task — never guessed.

---

## Goals

1. Give any developer a way to understand ONE dashboard, tab, JS module,
   function, button, or Sheet tab without reading the rest of the
   project — the current state requires reading `HANDOVER.md` end to
   end (or the code itself) to answer even a narrow question.
2. Make every component individually addressable by a stable ID
   (`DASH-001`, `TAB-001`, `JS-001`, `GS-001`, `FN-001`, `BTN-001`,
   `SHEET-001`, `DATA-001`, `EXT-001`) so components can be
   cross-referenced instead of re-described.
3. Make dependencies and data lineage explicit and queryable: "what
   does this depend on," "what depends on this," "where does this data
   come from and where does it end up," answerable by reading one
   record plus its cross-references, not the whole codebase.
4. Make Google Sheet tab retention/lifecycle explicit for every tab
   that stores data — recording a real answer where one is known
   (several are, from `LOGIC_AUDIT.md`'s own research this session:
   `Movement_Log` = 7 days, `Daily_RM_Issues` = 7 days as of the
   2026-09-07 fix, `Comment_History` = unbounded by design) and an
   honest **TBD** plus a decision task everywhere one isn't.
5. Define a durable *process* — not just a one-time document — for
   registering a new component, recording a new dependency, and
   retiring an obsolete one, so the catalog doesn't go stale the way a
   one-off audit document naturally does.
6. Keep `HANDOVER.md`'s narrative/onboarding value intact and keep
   `LOGIC_AUDIT.md`'s point-in-time findings intact — this project adds
   a third, structurally different artifact rather than trying to force
   either existing document into a shape it wasn't designed for.

---

## Maintenance Model — What This Does and Does Not Automate

Stated plainly, because it changes how much this system is worth trusting:
**nothing in this plan enforces itself.** Phase 6 defines a *process*
(`DOC-022`/`023`/`024` — how to register/update/retire a component;
`DOC-049`'s pre-ship checklist) — it does not build anything that blocks a
commit, fails CI, or otherwise stops a real change from landing without
the matching `docs/` record being touched. There is no mechanism here
comparable to `.github/workflows/test.yml`'s automatic enforcement of the
`.gs` test suite.

This means the catalog's value is entirely conditional on whoever makes a
future change actually following `docs/PRE_SHIP_DOCUMENTATION_CHECKLIST.md`
(`DOC-049`) — by habit, by being told to, or by a future session being
pointed at it explicitly. A record that drifts from the real code is
**worse than no record**, not neutral — it actively misleads a reader who
trusts it instead of checking the source. Treat the catalog as accurate
only as of its own `Last Updated` field, the same way `LOGIC_AUDIT.md` is
only accurate as of the date it was run.

**Update, 2026-09-09 — this candidate follow-up is no longer hypothetical.**
`CI-001` through `CI-005` (To-Do Dashboard) built exactly the check this
paragraph used to only propose: `test/check-docs-coverage.js` lists every
`js/*.js` file and every production `.gs` file (`Tests_*.gs` excluded, per
`DOC-007`'s own exclusion decision) with no matching `docs/js-modules/`/
`docs/gs-modules/` record, wired into `.github/workflows/test.yml`
(`CI-003`) as a step right after the `.gs` test suite — see `CLAUDE.md`'s
own Testing section for the day-to-day pointer.

It runs in **WARN-ONLY mode right now, deliberately** (`CI-001`'s design
note): it prints a summary but always exits 0, never blocking a commit —
correct, not a bug, since `docs/` doesn't have a `js-modules/`/`gs-modules/`
folder yet at all (this plan's own Phase 2/3 haven't run). Expect every
production file to show as uncovered until they do.

**Graduation criteria** (when this stops being advisory and starts
actually blocking a build without the matching record): only once Phase 5's
`DOC-039` verification task confirms full coverage — every production file
tracked at that point has a real `docs/` record. Not a fixed date, and not
"most files covered" — `DOC-039`'s own completeness check is the trigger.
Flipping the check itself (removing its `continue-on-error: true` in
`.github/workflows/test.yml`) is a small, mechanical follow-up once that
condition is met, not decided further here.

---

## Documentation Architecture Decision

**Recommendation: build a new, separate, modular documentation system —
do not expand `HANDOVER.md` into it.**

### Why not `HANDOVER.md`

`HANDOVER.md` (confirmed by direct read) is a single **narrative** file:
numbered prose sections (`## 1. What this is` through `## 9. Repeat
Offenders`), written to be read start-to-finish by someone onboarding,
with real incident history woven into the explanation. That shape is
exactly right for its actual job — orienting a new reader — and exactly
wrong for what this project asks for:

- **Maintainability**: a single flowing document has no natural
  boundary between "the part about `SlaEngine.gs`" and "the part about
  `RmHierarchy.gs`" — editing one risks touching prose that reads
  through both. A catalog needs one file (or one clearly bounded
  section) per component specifically so an edit to `JS-014` never
  touches the text describing `JS-015`.
- **Discoverability**: `HANDOVER.md` is discovered by reading it, not by
  looking something up. A developer who needs to know one function's
  callers has to search a 1,000+-line prose document and hope the
  answer is stated somewhere, rather than opening one record.
- **Separation of concerns**: `HANDOVER.md`'s job is "why does this
  project look the way it does, and what's broken before." The
  requested system's job is "what is this specific thing, right now,
  and what does it touch." Conflating them means either the catalog
  becomes bloated with historical narrative it doesn't need, or
  `HANDOVER.md` loses the readability that makes it useful for
  onboarding.
- **Updating one section without reading unrelated material**: this is
  the sharpest test, and `HANDOVER.md` fails it by construction — it's
  one file, and a large one. A catalog of small, individually-owned
  records passes it by construction too.

### Why not `LOGIC_AUDIT.md` either

`LOGIC_AUDIT.md` (also produced this session) is closer in spirit —
it's already ID-free but structured, evidence-heavy, and modular by
"Part." But it is explicitly a **point-in-time audit report**: findings,
diffs, and a severity ranking dated to when it was run. It is not
designed to be edited going forward as the source of truth for "what is
`FN-047` right now" — that would slowly turn an audit report into
something else entirely, and lose its value as a dated record of what
was true when the audit ran. It should stay exactly what it is.

### Architecture documentation already exists — this does not replace it

One more thing worth stating explicitly so it isn't rebuilt by accident:
**this project is not the architecture documentation, and doesn't need to
become it.** `LOGIC_AUDIT.md` Part 1 already IS the architecture-level
reference — the 19-layer breakdown adapted to this app's real stack, the
full Mermaid architecture diagram, and the list of central files/sources
of truth. That's the birds-eye view, and it already exists, dated
2026-09-05.

The new `docs/` catalog sits one level down from that: `RELATIONSHIP_MAP.md`
(`DOC-035`) gives the dependency-level view between the most important
components, and each individual `DASH-`/`TAB-`/`JS-`/`GS-XXX` record gives
the per-component detail `LOGIC_AUDIT.md`'s own file table already
summarizes at a coarser grain. `docs/INDEX.md`'s introduction (`DOC-013`)
should link to `LOGIC_AUDIT.md` Part 1 directly as "start here for the
architecture overview" rather than re-deriving one — a third,
independently-maintained architecture document would just be a fourth
thing that can drift from the other three.

### The new system, and how the three relate

A new, dedicated, modular documentation system — proposed home:
`docs/` at the repo root (design in **Final Documentation Structure**
below) — becomes the **living catalog**: one record per component,
one central index, explicit IDs, explicit cross-references, explicit
retention/lineage fields, and a defined process for keeping it current.

Relationship between the three root-level documents going forward:

| Document | Role | Update cadence |
|---|---|---|
| `HANDOVER.md` | Narrative onboarding + real incident history — "how did we get here" | As real incidents happen, same as today |
| `LOGIC_AUDIT.md` | Point-in-time audit findings, severity ranking, **and the architecture-level diagram/layer breakdown** — "what did a full pass find, as of this date" | Effectively frozen; a future full re-audit gets a new dated report, not an edit to this one |
| `docs/` (new) | Living, component-level catalog — "what is this, right now, and what does it touch" — complements `LOGIC_AUDIT.md` Part 1's architecture view, does not replace or duplicate it | Every time a component is added, changed, or retired (Phase 6 defines the process — see the Maintenance Model note above for what this does and does not automate) |

A short cross-link is added at the top of `HANDOVER.md` pointing to
`docs/INDEX.md`, and `docs/INDEX.md` points back to `HANDOVER.md` for
narrative context and `LOGIC_AUDIT.md` for the last full consistency
audit — three documents, three distinct jobs, explicitly linked rather
than merged (Phase 6, task `DOC-050`).

---

## Phases

### Phase 1 — Audit and Preparation

**Task ID:** DOC-001
**Task:** Inspect current project structure and confirm the file inventory
**Order:** 1
**Depends on:** None
**Objective:**
Establish a verified, current file list for the whole repo before any
documentation work begins — the starting ground truth every later task
is checked against.

**Work to perform:**
1. List every file at the repo root and in `js/`, confirming against
   what `LOGIC_AUDIT.md` Part 1 already found (23 `js/*.js` files, 11
   production `.gs` files, `dashboard.html`, `CLAUDE.md`, `HANDOVER.md`,
   `LOGIC_AUDIT.md`, this plan, plus the `Tests_*.gs`/`test/` suite and
   `.github/workflows/`).
2. Note anything added or removed since `LOGIC_AUDIT.md` was written
   (it is dated; the repo may have moved on).
3. Record `RmHierarchy.private.gs`'s confirmed absence (gitignored, real
   employee data) as a standing fact, not a gap to chase.

**Capture/document:**
- Full current file list, grouped by directory.
- Any drift from `LOGIC_AUDIT.md`'s Part 1 file inventory.

**Deliverable:**
`docs/_planning/file-inventory.md` — a plain list, not yet IDed
(IDs are assigned in Phase 2).

**Definition of done:**
- Every file in the repo appears in the list exactly once.
- Any file present in `LOGIC_AUDIT.md`'s inventory but no longer in the
  repo (or vice versa) is called out explicitly, not silently dropped.

**Follow-up/TBD items:**
- None expected — this is a mechanical listing task.

---

**Task ID:** DOC-002
**Task:** Inspect `HANDOVER.md` and extract its existing component coverage
**Order:** 2
**Depends on:** DOC-001
**Objective:**
Determine exactly what `HANDOVER.md` already documents well, so Phase 3
reuses that material instead of re-deriving it, and so nothing gets
contradicted between the old narrative doc and the new catalog.

**Work to perform:**
1. Read `HANDOVER.md` section by section (currently 9 numbered
   sections, per its own table of contents).
2. For each section, note which components (files, Sheet tabs,
   functions) it describes and how completely.
3. Flag any claim in `HANDOVER.md` that Phase 5 should specifically
   re-verify against current code (e.g., anything not already
   cross-checked by `LOGIC_AUDIT.md`).

**Capture/document:**
- A section-by-section map: `HANDOVER.md` section → components it
  covers → reuse-as-is / needs updating / needs verification.

**Deliverable:**
`docs/_planning/handover-coverage-map.md`.

**Definition of done:**
- Every one of `HANDOVER.md`'s 9 sections has an entry.
- Every component name mentioned in `HANDOVER.md` is captured for
  cross-checking against the Phase 1 inventories below.

**Follow-up/TBD items:**
- None expected.

---

**Task ID:** DOC-003
**Task:** Inspect `LOGIC_AUDIT.md` and extract reusable material
**Order:** 3
**Depends on:** DOC-001
**Objective:**
`LOGIC_AUDIT.md`'s 7 parts already contain most of the raw material
Phase 3 needs (file responsibilities, function purposes, Sheet tab
purposes, data flows, cross-component dependencies) — this task turns
that into a lookup so Phase 3 tasks can cite it directly instead of
re-deriving verified facts from scratch.

**Work to perform:**
1. Re-read `LOGIC_AUDIT.md` Part 1 §4 (the full file/component table) —
   this is the primary source for `DOC-025` through `DOC-029`.
2. Re-read Part 2 (data flow, user flows) — primary source for
   `DOC-034`.
3. Re-read Part 3 (business logic map) — primary source for the
   "important business logic" fields on `DASH-XXX`/`TAB-XXX` records.
4. Re-read Part 6 (hidden dependencies, source-of-truth matrix, logic
   matrix) — primary source for `DOC-035`.
5. Build an explicit index: "if documenting component X, read
   `LOGIC_AUDIT.md` Part N §M first."

**Capture/document:**
- A table: component category → which `LOGIC_AUDIT.md` Part(s)/section(s)
  are the primary source.

**Deliverable:**
`docs/_planning/logic-audit-source-map.md`.

**Definition of done:**
- Every Phase 3 category (dashboards, tabs, JS, GS, functions, buttons,
  Sheets, integrations, data flows, relationships) has at least one
  `LOGIC_AUDIT.md` pointer, or is explicitly marked "not covered by the
  audit — original research needed."

**Follow-up/TBD items:**
- None expected.

---

**Task ID:** DOC-004
**Task:** Inventory dashboards
**Order:** 4
**Depends on:** DOC-001
**Objective:**
Produce the definitive list of what counts as a "dashboard" in this
project before any `DASH-XXX` records are written.

**Work to perform:**
1. Confirm from `dashboard.html` and its own script-load list
   (`LOGIC_AUDIT.md` Part 1 §4a) whether this project has one dashboard
   (the single `dashboard.html` page) or whether "dashboard" should
   instead map to each of its 8 tabs individually.
2. Make and record this granularity decision explicitly — it determines
   whether `DASH-001` is "the Leads Dashboard" (one record) and the 8
   tabs become `TAB-001`..`TAB-008` under it, or something else.
3. List every distinct top-level entry point a user reaches directly
   (confirm there is exactly one: `dashboard.html`, gated by
   `#authGate`).

**Capture/document:**
- The dashboard-vs-tab granularity decision and its reasoning.
- The confirmed list of dashboard(s).

**Deliverable:**
`docs/_planning/dashboard-inventory.md`.

**Definition of done:**
- Exactly one clear statement of what "a dashboard" means in this
  project's catalog, used consistently by every later task.

**Follow-up/TBD items:**
- None — this is a scoping decision, not a discovery task.

---

**Task ID:** DOC-005
**Task:** Inventory tabs/pages/views
**Order:** 5
**Depends on:** DOC-004
**Objective:**
Produce the definitive list of every dashboard tab, confirmed against
`dashboard.html`'s real DOM, not assumed from memory.

**Work to perform:**
1. Re-read `dashboard.html`'s `#tabBar` and each `#tab-*` container
   (confirmed in `LOGIC_AUDIT.md` Part 1 §2: `tab-morning`,
   `tab-overview`, `tab-operations`, `tab-repeatoffenders`,
   `tab-people`, `tab-audit`, `tab-movement`, `tab-tracking` — 8 tabs).
2. Confirm each tab's rendering entry function (e.g. `renderMorningBrief`,
   `renderAll`'s own sub-sections for Overview/Operations, etc.).
3. Note any tab that is itself a container for sub-sections that behave
   like their own view (e.g. RM Timeline living inside the People tab).

**Capture/document:**
- Tab name, DOM id, owning file, primary render function, for each of
  the 8 tabs (or however many are confirmed).

**Deliverable:**
`docs/_planning/tab-inventory.md`.

**Definition of done:**
- Every `#tab-*` id in `dashboard.html` has a row.
- Every row's render function is confirmed by reading the actual call
  site, not inferred from the tab's name.

**Follow-up/TBD items:**
- None expected — this list is fully derivable from existing code.

---

**Task ID:** DOC-006
**Task:** Inventory JS files/modules (client-side)
**Order:** 6
**Depends on:** DOC-001
**Objective:**
Confirm the full `js/*.js` file list and each file's one-line
responsibility, as the base for the `JS-XXX` records in Phase 3.

**Work to perform:**
1. List all files in `js/` (23 confirmed in `LOGIC_AUDIT.md` Part 1 §4b/§4c).
2. For each, confirm its one-line responsibility already stated in
   `LOGIC_AUDIT.md`'s file table, or re-derive it if the file has
   changed since that audit ran (check `DOC-001`'s drift notes).
3. Split the list into "core/foundation" (loads first, 11 files) and
   "tab/feature" (12 files) per the load-order groupings already
   confirmed — this split becomes `DOC-027`/`DOC-028`'s scope boundary.

**Capture/document:**
- File name, one-line responsibility, core-vs-feature grouping, for
  all 23 files.

**Deliverable:**
`docs/_planning/js-module-inventory.md`.

**Definition of done:**
- Every file in `js/` has a row.
- The core/feature split is stated explicitly and will be reused
  verbatim by `DOC-027`/`DOC-028`.

**Follow-up/TBD items:**
- None expected.

---

**Task ID:** DOC-007
**Task:** Inventory the Apps Script backend (`.gs`) modules
**Order:** 7
**Depends on:** DOC-001
**Objective:**
Confirm the full production `.gs` file list — kept explicitly separate
from `js/*.js` because it is a genuinely different runtime with
different deployment rules (manual paste into the Apps Script editor,
per `CLAUDE.md`'s own top gotcha), so it gets its own ID family
(`GS-XXX`) rather than being folded into `JS-XXX`.

**Work to perform:**
1. List all production `.gs` files (11 confirmed:
   `Core.gs`, `SlaEngine.gs`, `FollowupEngine.gs`, `EmailInfra.gs`,
   `MovementTracker.gs`, `OvernightEmailer.gs`, `AllIssuesEmailer.gs`,
   `RmHierarchy.gs`, `UnmatchedCommentLogger.gs`,
   `InteractionHistoryLogger.gs`, `DailyRmIssueLog.gs`).
2. Confirm `RmHierarchy.private.gs`'s status explicitly (gitignored,
   real employee data, not in this repo, referenced but never read).
3. Exclude the 12 `Tests_*.gs` files from the primary catalog (they get
   one combined note in the `GS-XXX` records they test, not their own
   IDs — a scope decision, stated here so it isn't silently applied
   later).

**Capture/document:**
- File name, one-line responsibility (from `LOGIC_AUDIT.md` Part 1 §4d),
  for all 11 production files, plus the private-file and test-file
  scope notes above.

**Deliverable:**
`docs/_planning/gs-module-inventory.md`.

**Definition of done:**
- Every production `.gs` file has a row.
- The test-file and private-file scope decisions are stated explicitly.

**Follow-up/TBD items:**
- None expected.

---

**Task ID:** DOC-008
**Task:** Inventory significant functions
**Order:** 8
**Depends on:** DOC-006, DOC-007
**Objective:**
Define "significant" concretely (this project has hundreds of
functions; documenting every one-line helper would violate this
project's own stated maintainability goal), then produce the list that
definition yields.

**Work to perform:**
1. Adopt this concrete significance bar (state it in the deliverable,
   don't leave it implicit): a function is "significant" if it is
   (a) called from a file other than the one it's defined in — i.e.
   part of the app's real cross-file API surface, OR (b) named and
   described as load-bearing in `LOGIC_AUDIT.md`'s own file table
   ("Important Logic" column), OR (c) a `setupXxx()`/trigger-installer
   function on the backend.
2. Walk `LOGIC_AUDIT.md` Part 1 §4's "Important Logic" column and Part
   1 §5's trigger table to seed the initial list — this is already
   substantially populated from confirmed research, not a blank-page
   exercise.
3. Cross-check with a `grep` for cross-file call sites to catch
   anything the audit's own file-level summary didn't name explicitly.

**Capture/document:**
- Function name, owning file, one-line purpose, for every function
  meeting the bar above.
- The significance bar itself, stated plainly, so a future contributor
  can apply it consistently when adding a new function.

**Deliverable:**
`docs/_planning/function-inventory.md`.

**Definition of done:**
- Every function named in `LOGIC_AUDIT.md`'s file table or trigger
  table appears.
- The significance bar is written down, not just applied silently.

**Follow-up/TBD items:**
- If the cross-file-call grep turns up a function that seems load-
  bearing but wasn't named in `LOGIC_AUDIT.md`, flag it for a
  targeted read rather than guessing its purpose.

---

**Task ID:** DOC-009
**Task:** Inventory buttons and user actions
**Order:** 9
**Depends on:** DOC-005
**Objective:**
Produce the definitive list of every button/user-triggerable action in
`dashboard.html`, as the base for `BTN-XXX` entries.

**Work to perform:**
1. Search `dashboard.html` for every `<button`/interactive control by
   `id`.
2. For each, confirm (via `LOGIC_AUDIT.md` Part 1/2 or a fresh read)
   which `addEventListener` call wires it and which function it calls —
   confirmed examples already on record: `#snapshotNowBtn` →
   `browserSnapshotOpenLeads()`, `#generateBtn` → `renderReports()`,
   `#overnightGenerateReportsBtn` → `renderOvernightRegionReports()`,
   `#backfillSlaHistoryBtn`/`#clearSlaHistoryBtn`/
   `#backfillDailyCohortHistoryBtn`/`#clearDailyCohortHistoryBtn`
   (Tracking tab admin actions), `#gmailConnectBtn`, per-report
   "Send via Gmail" buttons.
3. Note that `dashboard.html` itself confirmed zero inline
   `onclick=`-style handlers (`LOGIC_AUDIT.md` Part 1) — every
   button is wired in JS, which is where the real wiring must be
   confirmed, not assumed from the button's `id` alone.

**Capture/document:**
- Button `id`, owning tab, wiring file/function, target function, for
  every button found.

**Deliverable:**
`docs/_planning/button-inventory.md`.

**Definition of done:**
- Every `<button` (and any other clickable control that triggers a
  real action, e.g. a checkbox like `#autoSnapshotCheck`) in
  `dashboard.html` has a row.
- Every row's target function is confirmed by reading the actual
  `addEventListener` call site.

**Follow-up/TBD items:**
- None expected — `LOGIC_AUDIT.md` already traced most of these.

---

**Task ID:** DOC-010
**Task:** Inventory Google Sheets and tabs
**Order:** 10
**Depends on:** DOC-001
**Objective:**
Produce the definitive list of every Google Sheet tab this system reads
or writes, as the base for `SHEET-XXX` records and Phase 4's deeper
retention work.

**Work to perform:**
1. List every tab name confirmed in `LOGIC_AUDIT.md`: `leads`,
   `Movement_Log`, `SLA_History`, `Daily_Cohort_History`,
   `Lead_Followups`, `Send_Log`, `Region_Recipients`, `RM_Hierarchy`,
   `Manager_Directory`, `Unmatched_Comments_Log`, `Comment_History`,
   `Overnight_Log`, `AllIssues_Log`, `Daily_RM_Issues` — 14 tabs.
2. Confirm each tab's spreadsheet — record whether all 14 live in one
   spreadsheet (the same one `dashboard.html`'s `#sheetIdInput` default
   points at) or are split across more than one; do not assume without
   checking the actual sheet ID(s) referenced in code.
3. For each tab, note whether the client (`js/sheets-writeback.js`),
   the backend (which `.gs` file), or both write to it — this table
   already exists in `LOGIC_AUDIT.md` Part 1 §4c/§4d for most tabs and
   should be reused, not re-derived.

**Capture/document:**
- Tab name, spreadsheet, writer(s), reader(s), for all 14 tabs.

**Deliverable:**
`docs/_planning/sheet-inventory.md`.

**Definition of done:**
- Every tab named anywhere in `LOGIC_AUDIT.md` appears.
- The single-spreadsheet-vs-multiple-spreadsheets question is answered
  from a real check, not assumed.

**Follow-up/TBD items:**
- If any tab turns out to live in a second spreadsheet not yet
  documented anywhere, flag it — this would be a genuinely new fact,
  not one already covered by the audit.

---

**Task ID:** DOC-011
**Task:** Inventory external integrations/APIs
**Order:** 11
**Depends on:** DOC-001
**Objective:**
Produce the definitive list of every third-party/external service this
system talks to, as the base for `EXT-XXX` records.

**Work to perform:**
1. Confirm the 4 already-identified integrations: Google Sheets API v4
   (`sheetsApiValuesGet`/`appendSheetRows`/`sheetsApiValuesBatchUpdate`,
   client; `SpreadsheetApp`, backend), Google Identity Services / OAuth
   (2 separate grants — Sheets sign-in gate and a separate Gmail-send
   grant, confirmed distinct in `CLAUDE.md`/`LOGIC_AUDIT.md`), Gmail
   API (`performGmailSend`, and the Advanced Gmail Service on the
   backend for threaded replies), jsPDF + jspdf-autotable (client-side
   PDF export, no network call — a library dependency, not a live
   integration, note this distinction explicitly).
2. Check for any other external call not yet confirmed (e.g., any
   analytics, error-reporting, or other third-party script tag in
   `dashboard.html`'s `<head>`).

**Capture/document:**
- Integration name, which runtime(s) use it, what it's used for, for
  each confirmed integration.

**Deliverable:**
`docs/_planning/integration-inventory.md`.

**Definition of done:**
- All 4 known integrations are listed with their real call sites.
- `dashboard.html`'s `<head>` has been checked for anything not yet
  accounted for.

**Follow-up/TBD items:**
- None expected.

---

**Task ID:** DOC-012
**Task:** Identify duplicated or conflicting documentation
**Order:** 12
**Depends on:** DOC-002, DOC-003
**Objective:**
Before building the new catalog, find every place `HANDOVER.md`,
`CLAUDE.md`, `LOGIC_AUDIT.md`, and in-code comments disagree with each
other, so Phase 3 records the *current, verified* fact rather than
propagating a stale one.

**Work to perform:**
1. Cross-check `DOC-002`'s `HANDOVER.md` coverage map against
   `DOC-003`'s `LOGIC_AUDIT.md` source map for contradictions.
2. Specifically check the one confirmed real discrepancy already on
   record: `CLAUDE.md`'s documented `js/core-*.js` script-load order
   vs. `dashboard.html`'s actual order (`LOGIC_AUDIT.md` Part 1 §6) —
   this needs a `CLAUDE.md` correction, tracked here, not silently
   fixed as a side effect of another task.
3. Note any other disagreement found during the cross-check.

**Capture/document:**
- A list of every found contradiction, which document(s) it's in, and
  which one is currently correct (per direct code verification).

**Deliverable:**
`docs/_planning/documentation-conflicts.md`.

**Definition of done:**
- The known script-load-order discrepancy is logged with a concrete
  fix recommendation.
- Any newly found contradiction has the same treatment.

**Follow-up/TBD items:**
- Create a small follow-up task to actually correct `CLAUDE.md`'s
  script-load-order claim once this catalog project is far enough
  along that doc-maintenance capacity exists (not blocking this
  project's own critical path).

---

**Task ID:** DOC-013
**Task:** Record the documentation architecture decision as the catalog's own front matter
**Order:** 13
**Depends on:** DOC-004 through DOC-012
**Objective:**
Formally capture (not re-litigate) the architecture decision already
made in this plan's own "Documentation Architecture Decision" section,
as the first real content written into the new system — so anyone who
later finds `docs/` understands why it exists separately from
`HANDOVER.md`/`LOGIC_AUDIT.md` without re-reading this planning
document.

**Work to perform:**
1. Copy this plan's architecture-decision reasoning (new system vs.
   expanding `HANDOVER.md`, and the 3-document relationship table) into
   `docs/INDEX.md`'s own introduction.
2. Add the cross-links described in that section: a pointer from
   `HANDOVER.md`'s top to `docs/INDEX.md`, and from `docs/INDEX.md`
   back to `HANDOVER.md` and `LOGIC_AUDIT.md`.
3. Explicitly link `LOGIC_AUDIT.md` Part 1 as "start here for the
   architecture overview" — this catalog is the component-level
   complement to it, not a replacement, and should say so in its own
   introduction rather than leaving that implied (see this plan's
   "Architecture documentation already exists" note).
4. Add a short, visible note in the same introduction stating the
   maintenance model plainly: this catalog is only as current as its
   own `Last Updated` fields — nothing enforces it automatically (see
   this plan's "Maintenance Model" section) — so a future reader knows
   to check currency, not just trust the record.

**Capture/document:**
- The architecture decision, stated once, in its permanent home.

**Deliverable:**
`docs/INDEX.md`'s introduction section (created here; the rest of
`INDEX.md` is built out in Phase 2).

**Definition of done:**
- `docs/INDEX.md` exists with a real introduction explaining what it is
  and how it relates to the other two root docs.
- `HANDOVER.md` has the added cross-link.
- The introduction explicitly names `LOGIC_AUDIT.md` Part 1 as the
  architecture overview and states the catalog is its component-level
  complement, not a replacement.
- The introduction explicitly states the maintenance model (no
  automatic enforcement; currency depends on `Last Updated`).

**Follow-up/TBD items:**
- None.

---

### Phase 2 — Central Documentation Foundation

**Task ID:** DOC-014
**Task:** Create the `docs/` directory structure
**Order:** 14
**Depends on:** DOC-013
**Objective:**
Stand up the physical folder structure every later Phase 3 task writes
into, per the **Final Documentation Structure** defined below.

**Work to perform:**
1. Create `docs/`, `docs/dashboards/`, `docs/tabs/`, `docs/js-modules/`,
   `docs/gs-modules/`, `docs/sheets/`, `docs/integrations/`,
   `docs/data-flows/`, `docs/_planning/` (holding this phase's
   inventory outputs), `docs/_archive/` (for retired components, per
   Phase 6).
2. Add a `.gitkeep` or placeholder `README.md` in any folder that would
   otherwise be empty, so the structure is visible in the repo before
   Phase 3 populates it.

**Capture/document:**
- N/A — structural task.

**Deliverable:**
The `docs/` directory tree, committed.

**Definition of done:**
- Every folder listed above exists in the repo.

**Follow-up/TBD items:**
- None.

---

**Task ID:** DOC-015
**Task:** Define naming conventions and component ID scheme
**Order:** 15
**Depends on:** DOC-014
**Objective:**
Lock the ID scheme every record and cross-reference in this system
will use, resolving the one real naming collision risk this project has
(the word "tab" means two different things — a dashboard UI tab and a
Google Sheet tab) before it causes confusion.

**Work to perform:**
1. Adopt and document these prefixes: `DASH-` (dashboards),
   `TAB-` (dashboard UI tab/page/view — explicitly NOT a Sheet tab),
   `JS-` (client-side JS module), `GS-` (Apps Script backend module),
   `FN-` (significant function, documented inside its owning `JS-`/`GS-`
   record, not its own file — see `DOC-016`), `BTN-` (button/user
   action, documented inside its owning `TAB-` record), `SHEET-`
   (Google Sheet tab — explicitly NOT a dashboard UI tab), `DATA-`
   (a traced data flow), `EXT-` (external integration).
2. Adopt a zero-padded 3-digit numbering convention (`DASH-001`,
   `JS-014`, etc.), assigned in first-documented order, never reused
   after retirement (a retired ID stays retired, per Phase 6).
3. Write this all down as the single naming-conventions reference every
   later task points back to.

**Capture/document:**
- The full prefix table with one example ID per prefix.
- The explicit `TAB-` vs `SHEET-` disambiguation rule.

**Deliverable:**
`docs/NAMING_CONVENTIONS.md`.

**Definition of done:**
- Every prefix in this plan's own ID list has a definition here.
- The disambiguation rule is stated in plain language, not just
  implied by the prefix choice.

**Follow-up/TBD items:**
- None.

---

**Task ID:** DOC-016
**Task:** Define the component record template structure
**Order:** 16
**Depends on:** DOC-015
**Objective:**
Define one canonical template per component type — every later Phase 3
task fills in a copy of the matching template, so every record of the
same type has the same shape and nothing gets forgotten.

**Work to perform:**
1. Draft the 8 templates listed in this plan's own **Component Record
   Templates** section below (Dashboard, Tab/Page, JS module, Function,
   Button/Action, Google Spreadsheet/Tab, Data Flow, External
   Integration).
2. Decide and document the "functions live inside their module record,
   not as separate files" and "buttons live inside their tab record,
   not as separate files" decisions explicitly (stated in this plan's
   architecture section; formalize it here as the binding rule Phase 3
   follows) — chosen specifically because this project has enough
   individual functions and buttons that one-file-per-function/button
   would work against this project's own maintainability goal, while
   the ID scheme still makes each one independently addressable via
   the central index.
3. Save each template as a literal, reusable file.

**Capture/document:**
- The 8 template files.
- The functions-in-module / buttons-in-tab placement rule.

**Deliverable:**
`docs/_templates/` containing one template file per component type.

**Definition of done:**
- All 8 templates exist and match this plan's own template section.
- The placement rule is written down, not just applied silently later.

**Follow-up/TBD items:**
- None.

---

**Task ID:** DOC-017
**Task:** Define relationship/dependency fields
**Order:** 17
**Depends on:** DOC-016
**Objective:**
Standardize exactly how one record points to another, so "what depends
on this" is mechanically answerable (e.g. by a future search) rather
than left to prose.

**Work to perform:**
1. Add a standard `## Relationships` section to every template from
   `DOC-016`, with fixed sub-fields: `Depends On:` (a list of IDs this
   component needs to function), `Used By:` (a list of IDs that depend
   on this one — filled in as the *other* record is written, kept
   reciprocal), `Related:` (components that are relevant but not a
   hard dependency, e.g. `TAB-006` RM Timeline reusing `TAB-005`'s
   `updateEventsFor` and `TAB-008`'s chart builder, per `LOGIC_AUDIT.md`
   Part 1's cross-file dependency notes).
2. Define the reciprocity rule: adding `Depends On: JS-014` to one
   record obligates adding `Used By: <this ID>` to `JS-014`'s record in
   the same edit — stated as a rule Phase 5's `DOC-040` verifies.

**Capture/document:**
- The `## Relationships` field definition and the reciprocity rule.

**Deliverable:**
Update to `docs/_templates/` (all 8 templates gain the section) plus
`docs/NAMING_CONVENTIONS.md` gains the reciprocity rule.

**Definition of done:**
- All 8 templates have the identical `## Relationships` shape.

**Follow-up/TBD items:**
- None.

---

**Task ID:** DOC-018
**Task:** Define data lineage fields
**Order:** 18
**Depends on:** DOC-016
**Objective:**
Standardize how a record states where its data comes from and where it
goes, matching this project's own real data-flow shape (Sheet → fetch →
transform → state → render → [optional write] → Sheet) already traced
in `LOGIC_AUDIT.md` Part 2.

**Work to perform:**
1. Add a standard `## Data Lineage` section to the `JS-`/`GS-`/`DATA-`
   templates: `Origin:`, `Transformation:`, `Stored As (state or
   Sheet):`, `Consumed By:`, per the shape `LOGIC_AUDIT.md` Part 2 §1
   already uses for its own field-by-field trace table.
2. For `DATA-XXX` records specifically, also require: `Retention:`
   (pointing to the owning `SHEET-XXX` record's retention field, not
   restated), `What happens on update:`, `What happens on delete:`.

**Capture/document:**
- The `## Data Lineage` field definition.

**Deliverable:**
Update to the relevant templates in `docs/_templates/`.

**Definition of done:**
- The section shape matches `LOGIC_AUDIT.md` Part 2's own field-by-field
  table structure, so existing audit material can be transcribed
  directly rather than re-derived.

**Follow-up/TBD items:**
- None.

---

**Task ID:** DOC-019
**Task:** Define retention fields for `SHEET-XXX` records
**Order:** 19
**Depends on:** DOC-016
**Objective:**
Standardize the retention/lifecycle fields Phase 4 will fill in for
every Sheet tab — critical because several real retention values are
already known (and one was the subject of a real production incident
this session) while others are genuinely undetermined.

**Work to perform:**
1. Add a standard `## Data Lifecycle` section to the `SHEET-XXX`
   template: `Data Type:` (historical / temporary / cached /
   operational / configuration — pick one, per this project's own
   category list), `Retention Period:` (a real value, or the literal
   string `TBD` — never invented), `Enforced By:` (the function/trigger
   that actually prunes it, or `None` if retention is currently
   unenforced), `Archive/Delete Behavior:`, `Sensitivity:`
   (operational / configuration / contains real employee data / TBD).
2. Pre-fill the 2 already-known real values as worked examples in the
   template's own comments: `Movement_Log` = 7 days, enforced by
   `pruneMovementLog_` (`MovementTracker.gs`); `Daily_RM_Issues` = 7
   days, enforced by `pruneDailyRmIssueLog_` (`DailyRmIssueLog.gs`,
   added 2026-09-07 after a real cell-limit incident) — so Phase 4
   starts from a confirmed pattern, not a blank field.

**Capture/document:**
- The `## Data Lifecycle` field definition with its 2 worked examples.

**Deliverable:**
Update to `docs/_templates/sheet-template.md`.

**Definition of done:**
- The template exists with all 5 sub-fields and the 2 worked examples.

**Follow-up/TBD items:**
- None here — the actual per-tab retention values are Phase 4's job.

---

**Task ID:** DOC-020
**Task:** Define ownership/status fields
**Order:** 20
**Depends on:** DOC-016
**Objective:**
Add a status field to every template so a reader can tell "is this
still active" without reading the component's full history, and an
owner field for anything that has a clear one.

**Work to perform:**
1. Add `Status:` (`Active` / `Deprecated` / `Planned`) to every
   template.
2. Add `Owner:` to every template, with an explicit note: this project
   has no confirmed per-component ownership assignment anywhere in
   `HANDOVER.md`/`CLAUDE.md`/`LOGIC_AUDIT.md` — the field defaults to
   `TBD` for every record until a real owner is confirmed; do not
   assign a name.

**Capture/document:**
- The `Status:`/`Owner:` fields, with the explicit TBD-default rule for
  `Owner:` stated plainly.

**Deliverable:**
Update to all 8 templates in `docs/_templates/`.

**Definition of done:**
- All 8 templates carry both fields.
- The TBD-default rule for `Owner:` is written down so Phase 3 doesn't
  silently invent an owner to fill the field.

**Follow-up/TBD items:**
- Whether to introduce real ownership assignment at all is itself an
  open decision for the project maintainer — out of scope for this
  documentation project to decide unilaterally.

---

**Task ID:** DOC-021
**Task:** Build the central index/catalog skeleton
**Order:** 21
**Depends on:** DOC-015, DOC-016, DOC-017
**Objective:**
Create `docs/INDEX.md` as the master lookup table — structured and
ready to receive rows, even though it can't be fully populated until
Phase 3's records exist.

**Work to perform:**
1. Build the master table with columns: `ID | Type | Name | Location
   (file path) | Status | Depends On | Used By | Last Updated`.
2. Seed it with one row per item already confirmed in Phase 1's
   inventories (`DOC-004` through `DOC-011`), with `Location`/
   `Depends On`/`Used By` left blank until the matching Phase 3 task
   fills them in — this makes the index a real, if incomplete, table
   from day one rather than an empty placeholder.
3. Add a short "How to use this index" note at the top answering the
   6 questions from this plan's Goals section directly (what is this,
   where is it, what does it depend on, what depends on it, what data
   does it use, where is that data stored, what should I read next).

**Capture/document:**
- The seeded index table.

**Deliverable:**
`docs/INDEX.md` (main body; the introduction was already added in
`DOC-013`).

**Definition of done:**
- Every component named in `DOC-004`–`DOC-011`'s inventories has a row.
- The "how to use this index" note answers all 6 Goals questions.

**Follow-up/TBD items:**
- Full population (filling every blank cell) is tracked as the
  cumulative result of Phase 3, not a separate task here.

---

**Task ID:** DOC-022
**Task:** Define how new components are added
**Order:** 22
**Depends on:** DOC-021
**Objective:**
Write the process a developer follows the next time they add a real
new dashboard tab, JS module, function, button, or Sheet tab — so the
catalog doesn't start going stale the moment Phase 3 finishes.

**Work to perform:**
1. Write a step-by-step process: assign the next unused ID in the
   relevant prefix's sequence, copy the matching template from
   `docs/_templates/`, fill it in, add the row to `docs/INDEX.md`, add
   reciprocal `Depends On`/`Used By` entries on every record it
   touches.
2. Give one worked example per component type using this project's own
   real shape (e.g. "adding a new Operations issue card" walks through
   creating a `BTN-XXX` entry inside the Operations `TAB-XXX` record,
   an `FN-XXX` entry inside the owning `JS-XXX` record, and the index
   row).

**Capture/document:**
- The full process, plus the worked examples.

**Deliverable:**
`docs/HOW_TO_REGISTER_A_COMPONENT.md`.

**Definition of done:**
- One worked example exists for each of the 8 component types.

**Follow-up/TBD items:**
- None.

---

**Task ID:** DOC-023
**Task:** Define how existing components are updated
**Order:** 23
**Depends on:** DOC-021
**Objective:**
Write the process for correcting or extending an existing record when
the underlying code changes — distinct from adding a brand-new
component.

**Work to perform:**
1. Write the process: locate the record via `docs/INDEX.md`, update the
   affected fields only, update `Last Updated` in the index row, check
   whether the change affects any `Depends On`/`Used By` relationship
   and update the other side too if so.
2. State explicitly that a code change touching a duplicated-logic pair
   (per `LOGIC_AUDIT.md` Part 3/4 — e.g. `OUTCOME_RULES`/
   `OUTCOME_RULES_GS_`, `enrichLead`/`computeSlaFlags_`) must update
   BOTH the `JS-XXX` and `GS-XXX` records in the same pass, mirroring
   this project's own "edit both runtimes together" discipline.

**Capture/document:**
- The update process, with the duplicated-pair rule called out.

**Deliverable:**
`docs/HOW_TO_UPDATE_A_COMPONENT.md`.

**Definition of done:**
- The duplicated-pair rule is explicit, not left implicit.

**Follow-up/TBD items:**
- None.

---

**Task ID:** DOC-024
**Task:** Define how obsolete components are retired
**Order:** 24
**Depends on:** DOC-021
**Objective:**
Write the process for marking a component obsolete without losing its
historical record — deletion loses information a future developer might
need ("why did this used to exist").

**Work to perform:**
1. Write the process: set `Status: Deprecated` on the record (never
   delete it outright), add a `Deprecated On:`/`Reason:`/`Replaced By:`
   (ID or `None`) note, move the file into `docs/_archive/` (created in
   `DOC-014`), update `docs/INDEX.md`'s row to reflect the new status
   and location, and update every other record's `Depends On`/`Used
   By` entries that referenced it so nothing silently points at a
   removed component.
2. State that a retired ID is never reused (per `DOC-015`'s numbering
   rule) — a gap in the sequence is expected and fine.

**Capture/document:**
- The retirement process.

**Deliverable:**
`docs/HOW_TO_RETIRE_A_COMPONENT.md`.

**Definition of done:**
- The process preserves the record rather than deleting it.
- The "IDs are never reused" rule is restated here for visibility.

**Follow-up/TBD items:**
- None.

---

### Phase 3 — Component Documentation

**Task ID:** DOC-025
**Task:** Document the Leads Dashboard (`DASH-001`)
**Order:** 25
**Depends on:** DOC-004, DOC-016, DOC-021
**Objective:**
Write the single top-level `DASH-001` record for the Leads Dashboard
itself (per `DOC-004`'s granularity decision).

**Work to perform:**
1. Fill the Dashboard template (below) using: purpose (per
   `HANDOVER.md` §1/`LOGIC_AUDIT.md` Part 1 §0), who/what uses it
   (regional heads/team leads, per `CLAUDE.md`), inputs (the `leads`
   Sheet tab + `Movement_Log`), outputs (rendered tables/KPIs, region
   emails, Sheet writes), data sources (list every `SHEET-XXX` it
   touches, once those IDs exist), dependencies (every `TAB-XXX` it
   contains), buttons/actions (top-level ones: sign-in, refresh,
   snapshot, change source — tab-specific buttons stay on their own
   `TAB-XXX` record), important business logic (a short pointer list
   into `docs/data-flows/` and the relevant `JS-`/`GS-XXX` records, not
   restated), what should/should not be changed (the duplicated-logic
   discipline from `LOGIC_AUDIT.md` Part 3/4, and `CLAUDE.md`'s
   no-auto-deploy gotcha for anything touching `.gs`), known
   limitations (the confirmed findings from `LOGIC_AUDIT.md` Part 6 §6.6
   /Part 7 §18 — cite them by finding, don't re-describe).
2. Add the row to `docs/INDEX.md`.

**Capture/document:** Per this plan's Dashboard template, below.

**Deliverable:** `docs/dashboards/DASH-001-leads-dashboard.md`.

**Definition of done:**
- Every template field is filled with a real, sourced fact or an
  explicit `TBD` — no field left blank without a marker.
- `docs/INDEX.md` has the row.

**Follow-up/TBD items:**
- Any field that can't be sourced from existing material gets its own
  one-line TBD note in the record itself, not a silent gap.

---

**Task ID:** DOC-026
**Task:** Document all 8 dashboard tabs (`TAB-001`–`TAB-008`)
**Order:** 26
**Depends on:** DOC-005, DOC-016, DOC-021, DOC-025
**Objective:**
Write one `TAB-XXX` record per confirmed tab (Morning, Overview,
Operations, Repeat Offenders, People, Audit, Movement, Tracking),
including that tab's buttons (per `DOC-016`'s buttons-live-in-tab-
records decision) as `BTN-XXX` sub-entries.

**Work to perform:**
1. For each tab, fill the Tab/Page template: purpose, inputs (which
   state arrays it reads — `leads`/`issueLeads`/`movementSnapshots`,
   per `LOGIC_AUDIT.md` Part 2 §1's field trace), outputs, data
   displayed, data written/modified (most tabs write nothing directly;
   Movement and Tracking are the exceptions — cite `LOGIC_AUDIT.md`
   Part 1 §4c's write table), dependencies (owning `JS-XXX` file(s)),
   navigation relationships (e.g. RM Timeline living inside People;
   Tracking/RM Timeline sharing a chart builder), buttons/actions (the
   `BTN-XXX` sub-table, from `DOC-009`'s inventory), relevant
   functions (pointer to the owning `JS-XXX` record's `FN-XXX`
   entries, not restated).
2. Assign IDs in a stable order (e.g. `TAB-001` = Morning through
   `TAB-008` = Tracking, matching `dashboard.html`'s own tab-bar
   order).
3. Update `docs/INDEX.md` with all 8 rows plus every `BTN-XXX` row.

**Capture/document:** Per the Tab/Page template, below, ×8.

**Deliverable:** `docs/tabs/TAB-001-morning.md` through
`docs/tabs/TAB-008-tracking.md`.

**Definition of done:**
- All 8 tabs documented.
- Every button confirmed in `DOC-009` appears as a `BTN-XXX` entry on
  its owning tab's record.
- `docs/INDEX.md` updated.

**Follow-up/TBD items:**
- None expected — `LOGIC_AUDIT.md` Part 1/2 already covers this
  ground in depth.

---

**Task ID:** DOC-027
**Task:** Document the 11 core/foundation JS modules (`JS-001`–`JS-011`)
**Order:** 27
**Depends on:** DOC-006, DOC-008, DOC-016, DOC-021
**Objective:**
Write one `JS-XXX` record per core-layer file (the files that load
first and establish shared state — per `DOC-006`'s split), including
each file's significant functions as `FN-XXX` sub-entries.

**Work to perform:**
1. For each of the 11 files (`core-foundation.js`, `core-auth.js`,
   `core-sheets-fetch.js`, `core-collation.js`, `core-lead-model.js`,
   `core-outcome-engine.js`, `core-filters.js`,
   `core-fetch-and-render.js`, `core-rm-performance.js`, `core-ui.js`,
   `main.js`), fill the JS module template: purpose, significant
   functions (`FN-XXX` sub-table — name, inputs, outputs, side
   effects, calls/called-by, reusable-or-specific, per `DOC-008`'s
   inventory), data sources accessed, data written/modified,
   dependencies, failure/error behavior (per `LOGIC_AUDIT.md` Part 5
   §5.4's edge-case findings where relevant), reusable-vs-specific.
2. Reuse `LOGIC_AUDIT.md` Part 1 §4b's table content directly —
   this task is substantially a structured transcription, not fresh
   research, per `DOC-003`'s source map.
3. Update `docs/INDEX.md`.

**Capture/document:** Per the JS module + Function templates, below,
×11 files.

**Deliverable:** `docs/js-modules/JS-001-core-foundation.md` through
`docs/js-modules/JS-011-main.md`.

**Definition of done:**
- All 11 files documented, each with its significant functions listed.
- `docs/INDEX.md` updated with all `JS-XXX` and `FN-XXX` rows.

**Follow-up/TBD items:**
- None expected.

---

**Task ID:** DOC-028
**Task:** Document the 12 tab/feature JS modules (`JS-012`–`JS-023`)
**Order:** 28
**Depends on:** DOC-006, DOC-008, DOC-016, DOC-021, DOC-026
**Objective:**
Same as `DOC-027`, for the remaining 12 files
(`overview-distribution-people-ops.js`, `tab-movement.js`,
`tab-tracking.js`, `reports-build.js`, `reports-gmail.js`,
`reports-ui.js`, `sheets-writeback.js`, `tab-audit.js`,
`tab-morning.js`, `tab-repeat-offenders.js`, `tab-rmtimeline.js`,
`repeat-offenders-pdf.js`).

**Work to perform:**
1. Same field list as `DOC-027`, reusing `LOGIC_AUDIT.md` Part 1 §4c.
2. For `sheets-writeback.js` specifically, also capture the full write
   table already built in `LOGIC_AUDIT.md` Part 1 §4c (every write
   function, target Sheet tab, trigger, data written) as this record's
   own `## Data Lineage` section — this is the single most
   cross-referenced JS file in the app (per `LOGIC_AUDIT.md` Part 6
   §6.5's logic matrix) and deserves the most complete record.
3. Cross-link each `TAB-XXX` record (from `DOC-026`) to its owning
   `JS-XXX` file(s) — reciprocal `Depends On`/`Used By` per `DOC-017`.
4. Update `docs/INDEX.md`.

**Capture/document:** Per the JS module + Function templates, ×12
files.

**Deliverable:** `docs/js-modules/JS-012-overview-distribution-people-ops.md`
through `docs/js-modules/JS-023-repeat-offenders-pdf.md`.

**Definition of done:**
- All 12 files documented.
- `sheets-writeback.js`'s record includes the full write table.
- Reciprocal links to `TAB-XXX` records confirmed both directions.

**Follow-up/TBD items:**
- None expected.

---

**Task ID:** DOC-029
**Task:** Document the 11 Apps Script backend modules (`GS-001`–`GS-011`)
**Order:** 29
**Depends on:** DOC-007, DOC-008, DOC-016, DOC-021
**Objective:**
Write one `GS-XXX` record per production `.gs` file, including the
trigger schedule (backend-specific — no `JS-XXX` record needs this
field) and each file's significant functions.

**Work to perform:**
1. For each of the 11 files, fill a backend-specific variant of the JS
   module template (same core fields, plus): `Trigger Schedule:` (from
   `LOGIC_AUDIT.md` Part 1 §5's consolidated trigger table — exact
   `atHour()`/`nearMinute()` values, and whether `.inTimezone()` is
   set, flagging `OvernightEmailer.gs`'s one confirmed outlier),
   `Requires setupXxx() re-run when:` (schedule changes only, per
   `CLAUDE.md`'s own gotcha — explicit so this doesn't get
   over-applied to every `.gs` edit).
2. Reuse `LOGIC_AUDIT.md` Part 1 §4d directly.
3. Update `docs/INDEX.md`.

**Capture/document:** Per the JS module template (backend variant) +
Function template, ×11 files.

**Deliverable:** `docs/gs-modules/GS-001-core.md` through
`docs/gs-modules/GS-011-dailyrmissuelog.md`.

**Definition of done:**
- All 11 files documented with real trigger schedules.
- `docs/INDEX.md` updated.

**Follow-up/TBD items:**
- None expected.

---

**Task ID:** DOC-030
**Task:** Cross-check the function inventory against `JS-XXX`/`GS-XXX` records
**Order:** 30
**Depends on:** DOC-027, DOC-028, DOC-029
**Objective:**
Confirm every function from `DOC-008`'s inventory actually landed in
its owning module's `FN-XXX` sub-table — a reconciliation pass, not new
documentation.

**Work to perform:**
1. Diff `DOC-008`'s function list against the union of every `FN-XXX`
   entry now present across all `JS-XXX`/`GS-XXX` records.
2. Resolve any gap: either the function belongs in a record and was
   missed (add it), or it didn't meet the significance bar after all
   (remove it from the inventory with a one-line reason).

**Capture/document:**
- The reconciliation result — 0 gaps expected if `DOC-027`–`DOC-029`
  were done thoroughly; any gap found gets a one-line resolution note.

**Deliverable:** Updated `docs/_planning/function-inventory.md` marked
reconciled, plus any corrected `JS-XXX`/`GS-XXX` records.

**Definition of done:**
- Zero unresolved gaps between the inventory and the records.

**Follow-up/TBD items:**
- None if reconciled cleanly.

---

**Task ID:** DOC-031
**Task:** Cross-check the button inventory against `TAB-XXX` records
**Order:** 31
**Depends on:** DOC-026
**Objective:**
Same reconciliation as `DOC-030`, for buttons.

**Work to perform:**
1. Diff `DOC-009`'s button list against every `BTN-XXX` entry now
   present across all `TAB-XXX` records.
2. Resolve any gap the same way as `DOC-030`.

**Capture/document:**
- The reconciliation result.

**Deliverable:** Updated `docs/_planning/button-inventory.md` marked
reconciled.

**Definition of done:**
- Zero unresolved gaps.

**Follow-up/TBD items:**
- None if reconciled cleanly.

---

**Task ID:** DOC-032
**Task:** Document the 14 Google Sheet tabs (`SHEET-001`–`SHEET-014`) — base records
**Order:** 32
**Depends on:** DOC-010, DOC-016, DOC-021
**Objective:**
Write the base `SHEET-XXX` record for each confirmed tab (purpose,
columns, writers, readers, relationships) — the deep retention/
lifecycle fields are Phase 4's job specifically, kept separate so this
task isn't blocked on decisions Phase 4 hasn't made yet.

**Work to perform:**
1. For each of the 14 tabs, fill the Google Spreadsheet/Tab template's
   non-lifecycle fields: what data is stored, purpose, source of the
   data, destination/consumers, columns/fields and their meanings
   (reuse the exact column lists already confirmed in `LOGIC_AUDIT.md`
   — e.g. `Movement_Log`'s `SNAPSHOT_COLUMNS_`/`MOVEMENT_LOG_COLUMNS`,
   `Daily_RM_Issues`'s `DAILY_RM_ISSUE_LOG_COLUMNS_`,
   `SLA_History`'s column shape from `upsertSlaHistoryRows`),
   who/what writes to it, who/what reads it, relationships to other
   tabs (e.g. `Daily_Cohort_History` written by both a browser path and
   an Apps Script path with matching schema, per `LOGIC_AUDIT.md` Part
   1 §4d), formulas/scripts/automations, risks caused by changing the
   tab structure (cite the append-only-column-order risk already
   documented for `Movement_Log`/`Daily_RM_Issues` in `LOGIC_AUDIT.md`
   Part 6 §6.3).
2. Leave the `## Data Lifecycle` section's fields as `TBD` — Phase 4
   fills them.
3. Update `docs/INDEX.md`.

**Capture/document:** Per the Sheet template's non-lifecycle fields,
×14 tabs.

**Deliverable:** `docs/sheets/SHEET-001-leads.md` through
`docs/sheets/SHEET-014-daily-rm-issues.md`.

**Definition of done:**
- All 14 tabs have a base record with real column lists (not
  approximated) and confirmed writer/reader lists.
- `docs/INDEX.md` updated.

**Follow-up/TBD items:**
- Data lifecycle fields deferred to Phase 4 explicitly — not a gap in
  this task, a scoping boundary.

---

**Task ID:** DOC-033
**Task:** Document the 4 external integrations (`EXT-001`–`EXT-004`)
**Order:** 33
**Depends on:** DOC-011, DOC-016, DOC-021
**Objective:**
Write one `EXT-XXX` record per confirmed integration.

**Work to perform:**
1. Fill the External Integration template for: Google Sheets API v4
   (`EXT-001`), Google Identity Services/OAuth — both grants
   (`EXT-002`), Gmail API + Advanced Gmail Service (`EXT-003`), jsPDF +
   jspdf-autotable (`EXT-004`).
2. For each: what it's used for, which `JS-XXX`/`GS-XXX` records call
   it, auth mechanism, known failure modes (cite `LOGIC_AUDIT.md` Part
   5 §5.4's confirmed error-handling behavior for the Sheets API case),
   rate-limit/retry behavior where confirmed (`withRetry_`/
   `withSendRetry_`, `EmailInfra.gs`).
3. Update `docs/INDEX.md`.

**Capture/document:** Per the External Integration template, ×4.

**Deliverable:** `docs/integrations/EXT-001-google-sheets-api.md`
through `docs/integrations/EXT-004-jspdf.md`.

**Definition of done:**
- All 4 integrations documented with real call-site references.
- `docs/INDEX.md` updated.

**Follow-up/TBD items:**
- None expected.

---

**Task ID:** DOC-034
**Task:** Document key data flows (`DATA-001`–`DATA-00N`)
**Order:** 34
**Depends on:** DOC-025 through DOC-033
**Objective:**
Trace the handful of data concepts that matter most end-to-end — origin
through consumption — as standalone `DATA-XXX` records that cross-
reference the component records rather than re-explaining them.

**Work to perform:**
1. Write one `DATA-XXX` record for each of these confirmed real flows
   (from `LOGIC_AUDIT.md` Part 2 §1's field trace, restructured as
   flows rather than a flat field table): the core lead record
   (`leads`-tab row → collation → `allParsedLeads` → `enrichLead` →
   `leads`/`issueLeads` → render), the SLA-flag pipeline (raw stage/
   timestamps → `enrichLead`/`computeSlaFlags_` → `ISSUE_PRIORITY` →
   Operations cards / `Daily_RM_Issues` / both scheduled emails), the
   comment-classification pipeline (comment text → `inferOutcome`/
   `inferOutcomeGs_` → suggested follow-up → `Lead_Followups` column
   F), the Movement snapshot pipeline (live leads → 2 independent
   writers → `Movement_Log` → 6+ downstream tab consumers, per this
   plan's own diagram G in `LOGIC_AUDIT.md` Part 7 §14), the region-
   email pipeline (lead → region resolution [flagging the confirmed
   HIGH finding, `LOGIC_AUDIT.md` Part 4 §4.4/Part 7 §18] → report
   build → send → `Send_Log`).
2. Each record uses only `DATA-XXX`'s own template fields (origin,
   transformation, storage, display, consumer, retention pointer,
   update/delete behavior) plus `Depends On`/`Used By` IDs — no
   restated prose from the component records themselves.

**Capture/document:** Per the Data Flow template, ×5 (or however many
distinct flows are confirmed worth their own record).

**Deliverable:** `docs/data-flows/DATA-001-lead-record.md` through
`docs/data-flows/DATA-005-region-email.md`.

**Definition of done:**
- Every flow listed above has a record.
- Each record's `Depends On` list resolves to real, already-created
  `JS-`/`GS-`/`SHEET-XXX` IDs — no dangling references.

**Follow-up/TBD items:**
- None expected — this is a restructuring of already-verified material.

---

**Task ID:** DOC-035
**Task:** Build the full cross-component relationship map
**Order:** 35
**Depends on:** DOC-025 through DOC-034
**Objective:**
Verify and complete every `Depends On`/`Used By` pair across the entire
catalog now that all records exist, and produce one consolidated
dependency view a reader can scan without opening every record.

**Work to perform:**
1. Walk every record and confirm its `Depends On` list is reciprocated
   by a `Used By` entry on the target record (per `DOC-017`'s rule) —
   fix any one-directional link found.
2. Build one consolidated `docs/RELATIONSHIP_MAP.md` summarizing the
   highest-traffic dependency chains already identified in
   `LOGIC_AUDIT.md` Part 6 §6.3/§6.5 and Part 7's diagram G (the 4 real
   hubs: `allParsedLeads`, `movementSnapshots`, `filterState`,
   `_currentSheetId`, and everything that touches them) — reusing that
   diagram directly rather than redrawing it.
3. Cross-check against `LOGIC_AUDIT.md` Part 6 §6.3's "if I change
   this" table to confirm every high-risk shared piece named there has
   a corresponding, correctly-linked record in the new catalog.

**Capture/document:**
- The reciprocity-check result.
- The consolidated relationship map.

**Deliverable:** `docs/RELATIONSHIP_MAP.md`.

**Definition of done:**
- Zero one-directional `Depends On`/`Used By` pairs remain.
- Every high-risk item from `LOGIC_AUDIT.md` Part 6 §6.3 is traceable
  in the new catalog.

**Follow-up/TBD items:**
- None expected if Phase 3's earlier tasks were done to spec.

---

### Phase 4 — Google Sheets Data Inventory (Deep Dive)

**Task ID:** DOC-036
**Task:** Map data lifecycle and retention for every `SHEET-XXX` record
**Order:** 36
**Depends on:** DOC-032
**Objective:**
Fill the `## Data Lifecycle` section `DOC-032` deliberately left as
`TBD` — recording a real, sourced answer wherever one exists and an
honest `TBD` everywhere it doesn't. **Do not invent a retention period
for any tab this task can't confirm one for.**

**Work to perform:**
1. For each of the 14 tabs, determine and record:
   - **Data Type** (historical / temporary / cached / operational /
     configuration).
   - **Retention Period** — a real, confirmed value or `TBD`. Two are
     already known with certainty: `Movement_Log` = 7 days
     (`MOVEMENT_LOG_RETENTION_DAYS`, `MovementTracker.gs`),
     `Daily_RM_Issues` = 7 days (`DAILY_RM_ISSUE_LOG_RETENTION_DAYS_`,
     `DailyRmIssueLog.gs`, added 2026-09-07). One is known to be
     unbounded by explicit design: `Comment_History` (no pruning,
     documented as intentional in `InteractionHistoryLogger.gs`'s own
     header — "an order of magnitude slower than Movement_Log's rate,"
     per `LOGIC_AUDIT.md` Part 1). The remaining 11 tabs' retention was
     **not** confirmed anywhere in this session's research — check each
     one directly (grep for a `pruneXxx_`-style function referencing
     it) before recording anything; if none exists, the honest answer
     is `TBD — no pruning function found`, not a guess.
   - **Enforced By** — the real function name, or `None`.
   - **Archive/Delete Behavior**.
   - **Sensitivity** — flag `RM_Hierarchy`/`Manager_Directory`
     specifically for review (adjacent to the real-employee-data
     concern already on record for `RmHierarchy.private.gs`, even
     though that specific file isn't a Sheet tab).
2. Update each `SHEET-XXX` record and `docs/INDEX.md`.

**Capture/document:**
- The completed `## Data Lifecycle` section for all 14 tabs.

**Deliverable:** Updated `docs/sheets/SHEET-*.md` files.

**Definition of done:**
- Every tab's `Retention Period` field is either a sourced real value
  or the literal string `TBD` — no field left blank, none invented.

**Follow-up/TBD items:**
- Every `TBD` found here feeds directly into `DOC-037`.

---

**Task ID:** DOC-037
**Task:** Produce the retention-decision list and route it for a real decision
**Order:** 37
**Depends on:** DOC-036
**Objective:**
Turn `DOC-036`'s `TBD` findings into an explicit, actionable decision
list — this documentation project's job is to surface the gap, not to
decide a real business retention policy on its own authority.

**Work to perform:**
1. Compile every `TBD` retention value from `DOC-036` into one list,
   each with: the tab name, its confirmed data type, why a decision
   matters (growth risk, per the real `Daily_RM_Issues` cell-limit
   incident as a concrete cautionary example already on record),
   suggested options to consider (not a recommendation this task
   makes unilaterally).
2. Flag this list for the project owner's actual decision — this task's
   job ends at "the open questions are written down clearly," not at
   answering them.

**Capture/document:**
- The retention-decision list.

**Deliverable:** `docs/_planning/retention-decisions-needed.md`.

**Definition of done:**
- Every `TBD` from `DOC-036` appears here with enough context for a
  real decision to be made without re-researching the tab.

**Follow-up/TBD items:**
- Each resolved decision gets folded back into the matching
  `SHEET-XXX` record's `Retention Period` field as a small follow-up
  edit, not a new numbered task — tracked informally as decisions land.

---

**Task ID:** DOC-038
**Task:** Classify sensitivity/operational importance per Sheet tab
**Order:** 38
**Depends on:** DOC-032
**Objective:**
Complete the `Sensitivity` field `DOC-036` started, specifically
distinguishing tabs that matter operationally (breaking them breaks a
live automated flow) from ones that are lower-stakes.

**Work to perform:**
1. For each of the 14 tabs, classify: does an automated backend job
   depend on it directly (e.g. `RM_Hierarchy`/`Manager_Directory` feed
   real email routing — breaking them breaks recipient resolution,
   confirmed in `LOGIC_AUDIT.md` Part 3 §3.7), does it hold anything
   adjacent to real personal/employee data, is it purely a display/
   audit-trail tab with no automated dependency.
2. Record the classification and a one-line reason on each
   `SHEET-XXX` record.

**Capture/document:**
- The classification and reasoning per tab.

**Deliverable:** Updated `docs/sheets/SHEET-*.md` files.

**Definition of done:**
- All 14 tabs classified with a stated reason, not just a label.

**Follow-up/TBD items:**
- None expected.

---

### Phase 5 — Verification

**Task ID:** DOC-039
**Task:** Verify documentation completeness against the real codebase
**Order:** 39
**Depends on:** DOC-025 through DOC-038
**Objective:**
Confirm every real component has a record — catching anything Phase 3
missed — via a mechanical check against the actual repo, not a
re-reading of the documentation itself.

**Work to perform:**
1. Re-run the same inspection each Phase 1 inventory task used
   (file listing, DOM `<button>` search, Sheet-tab-name grep) and diff
   the result against `docs/INDEX.md`.
2. Specifically check for: undocumented dashboards, undocumented tabs,
   undocumented JS/GS files, undocumented significant functions,
   undocumented buttons, undocumented Sheet tabs.
3. Log every gap found.

**Capture/document:**
- The diff result — ideally empty; every real gap logged with the
  missing component's name and type.

**Deliverable:** `docs/_planning/completeness-verification.md`.

**Definition of done:**
- Every category has been mechanically re-checked, not assumed
  complete from Phase 3 alone.

**Follow-up/TBD items:**
- Any gap found becomes a small immediate fix (add the missing
  record), not a new numbered task — Phase 5 exists to close gaps, not
  just log them.

---

**Task ID:** DOC-040
**Task:** Verify all cross-references resolve and are reciprocal
**Order:** 40
**Depends on:** DOC-035
**Objective:**
Confirm every `Depends On`/`Used By`/`Related` ID mentioned anywhere in
the catalog actually exists as a real record, and that no relationship
is one-directional.

**Work to perform:**
1. Extract every ID referenced in every record's `## Relationships`
   section.
2. Confirm each resolves to a real file in `docs/`.
3. Re-confirm reciprocity (this overlaps with `DOC-035`'s own check —
   this pass happens after Phase 4's edits too, since `DOC-036`–`038`
   could have touched `SHEET-XXX` records referenced elsewhere).

**Capture/document:**
- Every broken/dangling reference found, with the record it's in.
- Every one-directional relationship found.

**Deliverable:** `docs/_planning/reference-verification.md`.

**Definition of done:**
- Zero dangling references.
- Zero one-directional relationships.

**Follow-up/TBD items:**
- Any found issue is fixed immediately as part of this task, mirroring
  `DOC-039`'s pattern.

---

**Task ID:** DOC-041
**Task:** Cross-check for duplicated logic and stale documentation
**Order:** 41
**Depends on:** DOC-025 through DOC-034
**Objective:**
Confirm the new catalog doesn't repeat `LOGIC_AUDIT.md`'s own already-
verified findings incorrectly, and doesn't introduce new
inconsistencies of its own.

**Work to perform:**
1. Re-read `LOGIC_AUDIT.md` Part 3/4's duplicated-logic pairs and Part
   6's stale-bug-list findings; confirm the new catalog's records for
   those same components (`JS-006`/`GS-002` for the SLA pair,
   `JS-006`/`GS-003` for the comment classifier, etc. — exact IDs once
   assigned) state the SAME facts, not a paraphrase that drifted.
2. Specifically confirm the new catalog does NOT re-list any of the 7
   items from the pending UI-redesign plan's bug list as open — those
   are confirmed stale (`LOGIC_AUDIT.md` Part 6 §6.1) and should not
   resurface here.
3. Spot-check 3-5 records against the live code directly (not just
   against `LOGIC_AUDIT.md`) to catch anything that changed between the
   audit and this documentation pass.

**Capture/document:**
- Confirmation that no contradiction exists between the two documents.
- Results of the direct spot-checks.

**Deliverable:** `docs/_planning/consistency-check.md`.

**Definition of done:**
- No contradiction found between `LOGIC_AUDIT.md` and the new catalog
  for any duplicated-logic pair.
- At least 3 records spot-checked directly against live code.

**Follow-up/TBD items:**
- Any drift found between the audit and current code is a real,
  separate finding — log it, don't silently correct `LOGIC_AUDIT.md`
  itself (it's a dated point-in-time report, per this plan's own
  architecture decision).

---

**Task ID:** DOC-042
**Task:** Compile the final open-items list (naming, ownership, retention)
**Order:** 42
**Depends on:** DOC-036, DOC-037, DOC-020, DOC-039, DOC-040, DOC-041
**Objective:**
One consolidated list of everything this project could not fully
resolve — naming inconsistencies, unclear ownership, unknown retention
— so nothing is quietly lost once this documentation project itself is
considered "done."

**Work to perform:**
1. Pull together: every `TBD` `Owner:` field (`DOC-020`'s default),
   every `TBD` retention value not yet resolved by `DOC-037`, any
   naming inconsistency found during `DOC-039`/`DOC-040`, any open
   question logged anywhere in Phase 1-4's tasks.
2. Present as one triaged list.

**Capture/document:**
- The consolidated list, grouped by type.

**Deliverable:** `docs/_planning/OPEN_ITEMS.md`.

**Definition of done:**
- Every open item logged anywhere else in this plan is represented
  here exactly once.

**Follow-up/TBD items:**
- This file itself IS the follow-up tracker — it doesn't spawn further
  numbered tasks, it's the durable home for "not yet resolved."

---

### Phase 6 — Compartmentalization and Future Workflow

**Task ID:** DOC-043
**Task:** Write the "find documentation for a feature" quick-start guide
**Order:** 43
**Depends on:** DOC-021, DOC-035
**Objective:**
Give a developer starting on one feature a single, short entry point
into the catalog — the practical payoff of the whole project.

**Work to perform:**
1. Write a short guide: "working on tab X? open `TAB-00N`'s record,
   follow its `Depends On` list to the owning `JS-XXX`/`GS-XXX`
   records, follow THEIR `Depends On` lists to the `SHEET-XXX` records
   they touch — you now have everything relevant without reading
   anything else."
2. Include 2-3 worked examples using real components (e.g. "changing
   the Snapshot button's behavior" → `BTN-XXX` on `TAB-007` → `JS-018`
   [`sheets-writeback.js`] → `SHEET-002`/`SHEET-003`
   [`Movement_Log`/`SLA_History`]).

**Capture/document:**
- The guide and worked examples.

**Deliverable:** `docs/HOW_TO_FIND_DOCS_FOR_A_FEATURE.md`.

**Definition of done:**
- A developer unfamiliar with the project can follow one worked example
  end-to-end using only this guide and the catalog.

**Follow-up/TBD items:**
- None.

---

**Task ID:** DOC-044
**Task:** Consolidate the component-registration guides into one index
**Order:** 44
**Depends on:** DOC-022, DOC-023, DOC-024
**Objective:**
`DOC-022`/`023`/`024` already wrote the individual how-to guides — this
task makes them discoverable from one place rather than requiring a
developer to already know 3 separate filenames.

**Work to perform:**
1. Add a `## Maintaining This Catalog` section to `docs/INDEX.md`
   linking to `HOW_TO_REGISTER_A_COMPONENT.md`,
   `HOW_TO_UPDATE_A_COMPONENT.md`, `HOW_TO_RETIRE_A_COMPONENT.md`, and
   `HOW_TO_FIND_DOCS_FOR_A_FEATURE.md`.

**Capture/document:**
- N/A — a linking task.

**Deliverable:** Updated `docs/INDEX.md`.

**Definition of done:**
- All 4 guides are reachable from `docs/INDEX.md` directly.

**Follow-up/TBD items:**
- None.

---

**Task ID:** DOC-045
**Task:** Define how dependencies are recorded going forward
**Order:** 45
**Depends on:** DOC-017, DOC-035
**Objective:**
State explicitly — as its own short reference, not buried in `DOC-017`
— exactly how to add a new dependency edge when a future change
introduces one, since this is the single most failure-prone part of
keeping a relationship-based catalog current.

**Work to perform:**
1. Write the short reference: identify both IDs, add `Depends On`/`Used
   By` to both records in the same edit, re-run a scoped version of
   `DOC-040`'s reference check on just the 2 touched records.

**Capture/document:**
- The reference.

**Deliverable:** A short section inside
`docs/HOW_TO_UPDATE_A_COMPONENT.md` (not a new file — this is a small
enough addition that a separate file would fragment the guide
unnecessarily).

**Definition of done:**
- The addition exists and is linked from `docs/INDEX.md`'s
  maintenance section (`DOC-044`).

**Follow-up/TBD items:**
- None.

---

**Task ID:** DOC-046
**Task:** Define how data-retention decisions are recorded going forward
**Order:** 46
**Depends on:** DOC-019, DOC-037
**Objective:**
State the process for the NEXT time a retention question comes up
(a new Sheet tab is added, or one of `DOC-037`'s TBDs gets resolved) —
so this project's own discipline (real value or explicit TBD, never
invented) survives past this one-time pass.

**Work to perform:**
1. Write the process: any new `SHEET-XXX` record's `## Data Lifecycle`
   section must be filled at creation time, using a real confirmed
   value or `TBD` plus an entry in `docs/_planning/OPEN_ITEMS.md`
   (`DOC-042`'s file, kept alive going forward, not archived).

**Capture/document:**
- The process.

**Deliverable:** A section inside `docs/_templates/sheet-template.md`
(as a comment/instruction) plus a link from
`HOW_TO_REGISTER_A_COMPONENT.md`.

**Definition of done:**
- The instruction is visible directly in the template a future
  contributor copies.

**Follow-up/TBD items:**
- None.

---

**Task ID:** DOC-047
**Task:** Confirm the "update an existing component" process covers real code changes
**Order:** 47
**Depends on:** DOC-023
**Objective:**
Pressure-test `DOC-023`'s process against a real, already-known example
change to confirm it's concrete enough to follow, not just theoretically
correct.

**Work to perform:**
1. Walk `DOC-023`'s process against the real Daily_RM_Issues retention
   fix made this session (a genuine `.gs` change with a matching test
   addition and a `HANDOVER.md` update) as a worked example: which
   records would have needed updating (`GS-011`'s `Daily_RM_Issues`
   entry, `SHEET-014`'s retention field, `docs/INDEX.md`'s `Last
   Updated`) had this catalog existed at the time.
2. Add this worked example to `HOW_TO_UPDATE_A_COMPONENT.md`.

**Capture/document:**
- The worked example.

**Deliverable:** Updated `docs/HOW_TO_UPDATE_A_COMPONENT.md`.

**Definition of done:**
- The worked example is concrete enough that a developer could repeat
  the same shape of update for a different real change.

**Follow-up/TBD items:**
- None.

---

**Task ID:** DOC-048
**Task:** Confirm the "retire a component" process against a real candidate
**Order:** 48
**Depends on:** DOC-024
**Objective:**
Same pressure-test as `DOC-047`, for retirement — using a real,
already-identified candidate rather than a hypothetical.

**Work to perform:**
1. Identify whether any component documented in Phase 3 is already a
   reasonable retirement candidate (e.g., if `DOC-012`'s conflict check
   or `DOC-041`'s consistency check turned up something genuinely dead
   — `LOGIC_AUDIT.md` Part 6 §6.2 found no confirmed dead code in this
   project as of this audit, so this may come back "no current
   candidate," which is itself a valid, useful result).
2. If no real candidate exists, walk `DOC-024`'s process against a
   clearly-labeled hypothetical instead, stated explicitly as
   hypothetical so it's never mistaken for a real retirement.

**Capture/document:**
- The result either way.

**Deliverable:** Updated `docs/HOW_TO_RETIRE_A_COMPONENT.md`.

**Definition of done:**
- The guide has either a real or a clearly-labeled hypothetical worked
  example.

**Follow-up/TBD items:**
- None.

---

**Task ID:** DOC-049
**Task:** Define a documentation-completeness checklist for future feature work
**Order:** 49
**Depends on:** DOC-022, DOC-039
**Objective:**
Give future feature work a concrete "is the catalog still current"
check to run before considering the feature done — tying this
documentation system into the project's actual development workflow,
not leaving it as a one-time artifact.

**Work to perform:**
1. Write a short checklist: does every new/changed component have a
   record; does every new dependency have a reciprocal link; does every
   new Sheet tab have a `Retention Period` (real or `TBD` +
   `OPEN_ITEMS.md` entry); does `docs/INDEX.md` reflect the change.
2. Cross-reference `CLAUDE.md`'s own existing "Testing" section so this
   checklist sits alongside, not duplicate of, the testing discipline
   already documented there.

**Capture/document:**
- The checklist.

**Deliverable:** `docs/PRE_SHIP_DOCUMENTATION_CHECKLIST.md`.

**Definition of done:**
- The checklist is short enough to actually be used (not a restatement
  of this entire plan).

**Follow-up/TBD items:**
- None.

---

**Task ID:** DOC-050
**Task:** Cross-link `HANDOVER.md`, `LOGIC_AUDIT.md`, and the new `docs/` system
**Order:** 50
**Depends on:** DOC-013, DOC-044
**Objective:**
Close the loop on this plan's own architecture decision — make sure
the three-document relationship is discoverable from any one of the
three, not just from this planning document.

**Work to perform:**
1. Confirm `HANDOVER.md`'s top-of-file cross-link to `docs/INDEX.md`
   (added in `DOC-013`) is still present and accurate.
2. Add a short pointer near the top of `LOGIC_AUDIT.md` noting that
   `docs/INDEX.md` is now the living component catalog, while this file
   remains the dated point-in-time audit record.
3. Confirm `docs/INDEX.md`'s introduction (from `DOC-013`) still
   accurately links back to both.

**Capture/document:**
- N/A — a final linking pass.

**Deliverable:** Updated `HANDOVER.md` and `LOGIC_AUDIT.md` (small
additions only), confirmed `docs/INDEX.md`.

**Definition of done:**
- All 3 documents cross-link to each other correctly.
- This documentation project is now complete per the **Completion
  Checklist** below.

**Follow-up/TBD items:**
- None — this is the closing task of the plan.

---

## Final Documentation Structure

```
Google leads Dashboard/
├── CLAUDE.md                              (existing — unchanged in role)
├── HANDOVER.md                            (existing — narrative/onboarding + incident history; gains one cross-link)
├── LOGIC_AUDIT.md                         (existing — dated point-in-time audit; gains one cross-link)
├── DOCUMENTATION_PROJECT_PLAN.md          (this file — the plan itself; not part of the living catalog)
└── docs/                                  (NEW — the living component catalog)
    ├── INDEX.md                           (central catalog — master table + how-to-use + architecture note)
    ├── NAMING_CONVENTIONS.md              (ID prefixes, numbering rule, TAB-vs-SHEET disambiguation)
    ├── RELATIONSHIP_MAP.md                (consolidated high-traffic dependency view)
    ├── HOW_TO_REGISTER_A_COMPONENT.md
    ├── HOW_TO_UPDATE_A_COMPONENT.md
    ├── HOW_TO_RETIRE_A_COMPONENT.md
    ├── HOW_TO_FIND_DOCS_FOR_A_FEATURE.md
    ├── PRE_SHIP_DOCUMENTATION_CHECKLIST.md
    ├── _templates/                        (one template file per component type, Phase 2)
    │   ├── dashboard-template.md
    │   ├── tab-template.md
    │   ├── js-module-template.md
    │   ├── gs-module-template.md
    │   ├── sheet-template.md
    │   ├── data-flow-template.md
    │   └── integration-template.md
    ├── _planning/                         (Phase 1-5 working outputs — inventories, verification results, open items)
    │   ├── file-inventory.md
    │   ├── handover-coverage-map.md
    │   ├── logic-audit-source-map.md
    │   ├── (…one file per Phase 1/4/5 task's deliverable…)
    │   └── OPEN_ITEMS.md                  (the living, never-archived TBD tracker)
    ├── _archive/                          (retired component records, Phase 6)
    ├── dashboards/
    │   └── DASH-001-leads-dashboard.md
    ├── tabs/
    │   └── TAB-001-morning.md … TAB-008-tracking.md
    ├── js-modules/
    │   └── JS-001-core-foundation.md … JS-023-repeat-offenders-pdf.md
    ├── gs-modules/
    │   └── GS-001-core.md … GS-011-dailyrmissuelog.md
    ├── sheets/
    │   └── SHEET-001-leads.md … SHEET-014-daily-rm-issues.md
    ├── integrations/
    │   └── EXT-001-google-sheets-api.md … EXT-004-jspdf.md
    └── data-flows/
        └── DATA-001-lead-record.md … DATA-005-region-email.md
```

Functions (`FN-XXX`) live as sub-tables inside their owning
`JS-XXX`/`GS-XXX` record. Buttons (`BTN-XXX`) live as sub-tables inside
their owning `TAB-XXX` record. Both still get their own stable ID and a
row in `docs/INDEX.md`, so they're independently searchable even though
they don't have their own physical file — a deliberate choice (stated in
Phase 2) to avoid a 150+-file explosion that would itself hurt
maintainability.

---

## Component Record Templates

### Dashboard (`DASH-XXX`)
```markdown
# DASH-XXX — [Name]
Status: Active | Deprecated | Planned    Owner: [name or TBD]    Last Updated: [date]

## Purpose
## Who/What Uses It
## Inputs
## Outputs
## Data Sources
(SHEET-XXX list)
## Buttons/Actions (top-level only — tab-specific buttons live on their TAB-XXX record)
## Important Business Logic
(pointers into data-flows/ and js-modules/gs-modules — not restated)
## What Should / Should Not Be Changed
## Known Limitations
(cite LOGIC_AUDIT.md findings by ID/section where applicable)
## Relationships
Depends On: | Used By: | Related:
```

### Tab/Page (`TAB-XXX`)
```markdown
# TAB-XXX — [Name]
Status: | Owner: | Last Updated:

## Purpose
## Inputs (which in-memory state arrays it reads)
## Outputs
## Data Displayed
## Data Written/Modified
## Navigation Relationships
## Buttons/Actions
| BTN-XXX | Label | Triggers | Target Function |
## Relevant Functions
(pointer to owning JS-XXX/GS-XXX record's FN-XXX entries)
## Relationships
Depends On: | Used By: | Related:
```

### JavaScript / Apps Script Module (`JS-XXX` / `GS-XXX`)
```markdown
# JS-XXX — [filename]
Status: | Owner: | Last Updated:
(GS-XXX only) Trigger Schedule: | Requires setupXxx() re-run when:

## Purpose
## Significant Functions
| FN-XXX | Name | Inputs | Outputs | Side Effects | Calls | Called By | Reusable? |
## Data Lineage
Origin: | Transformation: | Stored As: | Consumed By:
## Data Written/Modified
## Failure/Error Behavior
## Reusable or Feature-Specific
## Relationships
Depends On: | Used By: | Related:
```

### Function (`FN-XXX`, documented inline within its `JS-XXX`/`GS-XXX` record)
```markdown
FN-XXX — [functionName]
Purpose:
Inputs/Parameters:
Outputs/Return Value:
Side Effects:
Data Sources Accessed:
Data Written/Modified:
Calls: (FN-XXX list)
Called By: (FN-XXX list)
Failure/Error Behavior:
Reusable or Specific to One Feature:
```

### Button/Action (`BTN-XXX`, documented inline within its `TAB-XXX` record)
```markdown
BTN-XXX — [label/id]
Where It Exists: (TAB-XXX)
What Triggers It:
Function(s) Called: (FN-XXX)
Inputs Required:
Data Changed: (SHEET-XXX / DATA-XXX)
Output/Result:
User-Visible Effect:
Dependencies:
Why This Action Exists:
```

### Google Spreadsheet/Tab (`SHEET-XXX`)
```markdown
# SHEET-XXX — [Spreadsheet name] / [Tab name]
Status: | Owner: | Last Updated:

## Purpose
## Data Stored
## Source of the Data
## Destination/Consumers
## Columns/Fields
| Column | Meaning | Type |
## Writers
## Readers
## Data Lifecycle
Data Type: (historical/temporary/cached/operational/configuration)
Retention Period: [real value or TBD]
Enforced By: [function name or None]
Archive/Delete Behavior:
Sensitivity:
## Relationships to Other Tabs
## Formulas/Scripts/Automations
## Risks of Changing This Tab's Structure
## Relationships
Depends On: | Used By: | Related:
```

### Data Flow (`DATA-XXX`)
```markdown
# DATA-XXX — [Flow name]
Status: | Last Updated:

## Origin
## Transformation
## Storage
## Display
## Ultimate Consumer(s)
## Retention
(pointer to owning SHEET-XXX's Retention Period — not restated)
## What Happens on Update
## What Happens on Delete
## Relationships
Depends On: | Used By: | Related:
```

### External Integration (`EXT-XXX`)
```markdown
# EXT-XXX — [Service name]
Status: | Last Updated:

## What It's Used For
## Called From (JS-XXX / GS-XXX list)
## Auth Mechanism
## Known Failure Modes
## Rate-Limit/Retry Behavior
## Relationships
Depends On: | Used By: | Related:
```

---

## Completion Checklist

- [ ] `docs/` directory structure exists exactly as specified above.
- [ ] `docs/INDEX.md` has a row for every `DASH-`/`TAB-`/`JS-`/`GS-`/
      `SHEET-`/`EXT-`/`DATA-` ID, plus every `FN-`/`BTN-` sub-entry.
- [ ] Every record uses its category's exact template — no ad-hoc
      shape drift between records of the same type.
- [ ] Every `Depends On`/`Used By` pair is reciprocal (verified by
      `DOC-040`, zero dangling or one-directional references).
- [ ] Every `SHEET-XXX` record's `Retention Period` is either a real,
      sourced value or the literal string `TBD` with a matching entry
      in `docs/_planning/OPEN_ITEMS.md` — none invented.
- [ ] Every `Owner:` field is either a real, confirmed name or `TBD` —
      none invented.
- [ ] The 7-item pending-bug-list from `LOGIC_AUDIT.md` Part 6 does NOT
      reappear as an open item anywhere in the new catalog.
- [ ] `HANDOVER.md`, `LOGIC_AUDIT.md`, and `docs/INDEX.md` cross-link to
      each other, and each document's distinct role is stated plainly
      in at least one of them.
- [ ] `docs/HOW_TO_REGISTER_A_COMPONENT.md`,
      `HOW_TO_UPDATE_A_COMPONENT.md`, `HOW_TO_RETIRE_A_COMPONENT.md`,
      and `HOW_TO_FIND_DOCS_FOR_A_FEATURE.md` each contain at least one
      real, worked example using this project's own actual components —
      not a generic/hypothetical placeholder, except where `DOC-048`
      explicitly documents that no real retirement candidate exists.
- [ ] `docs/PRE_SHIP_DOCUMENTATION_CHECKLIST.md` exists and is short
      enough to actually be used on a real future feature.
- [ ] A developer unfamiliar with the project can pick ONE real
      component (e.g. a single button) and, starting only from
      `docs/INDEX.md`, reach every directly relevant record — its
      owning tab, owning JS/GS file, and any Sheet tab it touches —
      without reading anything outside that chain.
- [ ] `docs/_planning/OPEN_ITEMS.md` exists and is understood as a
      living file, not a closed record — genuinely unresolved questions
      (retention TBDs, ownership TBDs) are expected to remain there
      after this project's own tasks are all marked complete, and that
      is a correct, honest end state, not a failure of the project.
