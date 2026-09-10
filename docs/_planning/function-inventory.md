# Function inventory (`DOC-008` + `DOC-030`)

**Status:** built `DOC-030` (Phase 3), reconciled against `DOC-008`'s
significance bar 2026-09-10 (see "`DOC-008` reconciliation" at the end).
Verified 2026-09-10 against commit `c82ec67` (record set) / `e281f9b`
(this note).
**Scope:** every significant function in `js/*.js` (24 files) and the
production `*.gs` files (13 files) is assigned an `FN-XXX` id and lives
in a `## Significant functions — FN-XXX sub-table` in its owning module
record. `Tests_*.gs` and `RmHierarchy.private.gs` are out of scope
(`DOC-007` / `DOC-008`).

`DOC-008` (the standalone inventory task) was `Not Started` when Phase 3
ran, so this inventory was **built directly from the live source** —
`grep -nE '^(function|async function|const) …'` over each file at
`c82ec67` — and the `FN-XXX` rows in the module records ARE the
inventory. This file is the reconciliation record required by `DOC-030`:
it confirms zero gaps between "functions in the source" and "functions
in a record."

---

## Reconciliation result

- **`FN-001` … `FN-254`** assigned, **contiguous, no gaps, no
  duplicate ownership** (verified by
  `comm -23 <(seq) <(grep -oE '^\| FN-[0-9]{3} \|' …)` — empty).
- Each `FN-XXX` row is owned by exactly one `JS-XXX` / `GS-XXX` record.
- `JS-011` (`main.js`) owns **zero** `FN-XXX` — it defines no functions
  (4 bare bootstrap call statements). This is a deliberate, recorded
  "none," not a gap.

### Per-record allocation

| Record | File | `FN-XXX` range | Rows |
|---|---|---|---|
| JS-001 | `js/core-auth.js` | FN-001..FN-006 | 6 |
| JS-002 | `js/core-collation.js` | FN-007..FN-014 | 8 |
| JS-003 | `js/core-fetch-and-render.js` | FN-015..FN-019 | 5 |
| JS-004 | `js/core-filters.js` | FN-020..FN-025 | 6 |
| JS-005 | `js/core-foundation.js` | FN-026..FN-033 | 8 |
| JS-006 | `js/core-lead-model.js` | FN-034..FN-041 | 8 |
| JS-007 | `js/core-outcome-engine.js` | FN-042..FN-051 | 10 |
| JS-008 | `js/core-rm-performance.js` | FN-052..FN-064 | 13 |
| JS-009 | `js/core-sheets-fetch.js` | FN-065..FN-069 | 5 |
| JS-010 | `js/core-ui.js` | FN-070..FN-076 | 7 |
| JS-011 | `js/main.js` | — | 0 (defines no functions) |
| JS-012 | `js/overview-distribution-people-ops.js` | FN-077..FN-087 | 11 |
| JS-013 | `js/repeat-offenders-pdf.js` | FN-088..FN-093 | 6 |
| JS-014 | `js/reports-build.js` | FN-094..FN-102 | 9 |
| JS-015 | `js/reports-gmail.js` | FN-103..FN-110 | 8 |
| JS-016 | `js/reports-ui.js` | FN-111..FN-118 | 8 |
| JS-017 | `js/rm-performance-worker.js` | FN-119..FN-120 | 2 |
| JS-018 | `js/sheets-writeback.js` | FN-121..FN-131 | 11 |
| JS-019 | `js/tab-audit.js` | FN-132..FN-137 | 6 |
| JS-020 | `js/tab-morning.js` | FN-138..FN-139 | 2 |
| JS-021 | `js/tab-movement.js` | FN-140..FN-149 | 10 |
| JS-022 | `js/tab-repeat-offenders.js` | FN-150..FN-155 | 6 |
| JS-023 | `js/tab-rmtimeline.js` | FN-156..FN-161 | 6 |
| JS-024 | `js/tab-tracking.js` | FN-162..FN-173 | 12 |
| GS-001 | `AllIssuesEmailer.gs` | FN-174..FN-179 | 6 |
| GS-002 | `Core.gs` | FN-180..FN-186 | 7 |
| GS-003 | `DailyRmIssueLog.gs` | FN-187..FN-195 | 9 |
| GS-004 | `EmailInfra.gs` | FN-196..FN-204 | 9 |
| GS-005 | `FollowupEngine.gs` | FN-205..FN-211 | 7 |
| GS-006 | `InteractionHistoryLogger.gs` | FN-212..FN-215 | 4 |
| GS-007 | `LeadFollowupsStaleness.gs` | FN-216..FN-217 | 2 |
| GS-008 | `MovementTracker.gs` | FN-218..FN-226 | 9 |
| GS-009 | `OpsChecklistRunner.gs` | FN-227..FN-230 | 4 |
| GS-010 | `OvernightEmailer.gs` | FN-231..FN-239 | 9 |
| GS-011 | `RmHierarchy.gs` | FN-240..FN-247 | 8 |
| GS-012 | `SlaEngine.gs` | FN-248..FN-249 | 2 |
| GS-013 | `UnmatchedCommentLogger.gs` | FN-250..FN-254 | 5 |
| **Total** | 37 files | **FN-001..FN-254** | **253 owned** |

---

## The significance bar (what got an `FN-XXX`, what didn't)

An `FN-XXX` row was created for a function that is any of:

- an **exported / bare-global** entry point another module calls by name;
- a **rule-dense** function (SLA flags, comment classification, RM
  scoring, collation merge);
- a function that **touches a Sheet, the DOM, the network, or module
  state**;
- a **cross-runtime twin** (a `_Gs_` function mirroring a `js/` one, or
  vice versa);
- a function named in a `LOGIC_AUDIT.md` finding.

Below the bar and **deliberately folded into a parent `FN-XXX` row or
left undocumented** (recorded here so their absence is not read as a
gap):

| Kind | Examples | Why below the bar |
|---|---|---|
| Tiny formatters / pads | `pad2Gs_`, `istTimeLabel`, `fmtHoursSpan`, `attemptsTodayCell`, `todayDateLabel` | one-line string helpers, no logic |
| Internal closures | `_ufFind` / `_ufUnion` (in `fetchAndRender`), `renderOptions` / `refreshButtonLabel` (in `buildMultiSelect`) | not addressable from outside their parent — documented *as part of* the parent `FN-XXX` |
| Thin `…Now()` wrappers | `pruneMovementLogNow`, `snapshotNow`, `captureDailyRmIssuesNow`, `sendAllIssuesEmailsNow`, `logInteractionHistoryNow` | one-line manual entry points that just call the `_` core — folded into the core function's `FN-XXX` row |
| Debug / telemetry helpers | `debugDailyCohortEvidence`, `debugFollowupStatusNow`, `_rmPerfWorkerClassificationCounts` | not production-path (the last one *is* given `FN-120` because it shapes the worker's `done` message) |
| Pure sub-computations | `medianOfSorted`, `percentileOfSorted`, `splitDailyAndScatter`, `emptyCohortBucket`, `addCohortBucket`, `wowPctDelta` | leaf arithmetic inside a documented parent `FN-XXX` |

If any of these is later promoted (e.g. a debug helper becomes a real
entry point), it gets the **next free id** — never a reused one, never
`FN-194`-style backfill (per `../NAMING_CONVENTIONS.md`).

---

## How this stays reconciled

- `test/check-docs-coverage.js` (CI, warn-only) checks **file** coverage
  (`js/*.js` / `*.gs` ↔ a `docs/*-modules/*.md`), not function coverage —
  it will not catch a new function that lacks an `FN-XXX`.
- So function-level reconciliation is **process**: `DOC-030`'s
  revalidation trigger is "any commit that adds/removes an exported or
  rule-dense function in a `js/*.js` / production `*.gs` file" — at which
  point this file and the owning record's `FN-XXX` sub-table are updated
  in the same commit (the discipline in `CLAUDE.md`'s Testing section,
  applied to docs).
- `DOC-035` will re-walk every record for `Depends On` / `Used By`
  reciprocity, which incidentally re-touches every `FN-XXX` cross-ref.

## Gaps found and resolved during this reconciliation

| Gap | Resolution |
|---|---|
| `GS-003` FN-190's "Calls" cell referenced `FN-191..FN-194` but only `FN-191`..`FN-193` were defined (jump to `FN-195`) | Split the over-broad `FN-191` (which had folded 4 pipeline stages into one row) into `FN-191` (reconstruct + aggregate) and **`FN-194`** (peer averages + classify), matching `JS-008` FN-053..FN-056's 1:1 structure. Now contiguous. |

Zero unresolved gaps remain.

---

## `DOC-008` reconciliation (Phase 1)

`DOC-008` is the Phase 1 task whose deliverable *is* this file. It ran
**after** `DOC-030` produced the file, so this section confirms the file
satisfies `DOC-008`'s spec rather than rebuilding it.

### `DOC-008`'s significance bar, stated verbatim

> A function is "significant" if it is **(a)** called from a file other
> than the one it's defined in — i.e. part of the app's real cross-file
> API surface, **OR (b)** named and described as load-bearing in
> `LOGIC_AUDIT.md`'s own file table ("Important Logic" column), **OR
> (c)** a `setupXxx()` / trigger-installer function on the backend.

### Relationship to the bar this file already uses

The "significance bar" section above uses a **superset** of `DOC-008`'s:

| `DOC-008` criterion | Covered by this file's bar |
|---|---|
| (a) cross-file call surface | "exported / bare-global entry point another module calls by name" |
| (b) named in `LOGIC_AUDIT.md`'s "Important Logic" column | "a function named in a `LOGIC_AUDIT.md` finding" **+** the transcription source itself (`LOGIC_AUDIT.md` Part 1 §4b/§4c/§4d) |
| (c) `setupXxx()` / trigger installer | every `setup*()` appears — `setupMovementTracking` (`GS-008` FN-219), `setupOvernightEmailer` (`GS-010` FN-239), `setupAllIssuesEmailTrigger` (`GS-001` FN-179), `setupDailyRmIssueLog` (`GS-003` FN-195), `setupWeeklyOpsChecklistTrigger` (`GS-009` FN-230), `setupRmHierarchy` (`GS-011` FN-247), `setupLeadFollowupsStalenessFormatting` (`GS-007` FN-217) |

This file's bar additionally captures rule-dense functions, state/DOM/
network/Sheet touchers, and cross-runtime twins — a `DOC-008`-significant
function is always in this file; the reverse is not required.

### `DOC-008` DoD check

- **Every function named in `LOGIC_AUDIT.md`'s file table ("Important
  Logic" column) or trigger table (§5) appears** — ✅. `LOGIC_AUDIT.md`
  Part 1 §4b/§4c/§4d was the direct transcription source for `DOC-027`/
  `DOC-028`/`DOC-029`; every "Important Logic" name landed in an
  `FN-XXX` row (e.g. `fetchAndRender`, `enrichLead`, `OUTCOME_RULES`,
  `computeRmPerformance`, `mergeRowsIntoOneLead`, `_generateCycleOwner`,
  `snapshotOpenLeads_`, `computeSlaFlags_`, `resolveRecipientBucketsForRms_`,
  `sendThreadedGmailReply_`, …). §5's 5 `setupXxx()` installers +
  `setupRmHierarchy` all appear (row above).
- **The significance bar is written down, not just applied silently** —
  ✅ (the "significance bar" section above + `DOC-008`'s verbatim
  criterion here).

### `DOC-008` follow-up item

> "If the cross-file-call grep turns up a function that seems
> load-bearing but wasn't named in `LOGIC_AUDIT.md`, flag it for a
> targeted read rather than guessing."

None outstanding — `DOC-027`/`DOC-028`/`DOC-029` each grepped every file
for its own function declarations (`grep -nE '^(function|async function|const)'`)
and read the file, so the `FN-XXX` set is derived from the current source
directly, not only from the audit. Functions deliberately below the bar
are listed in the "significance bar" section's second table.
