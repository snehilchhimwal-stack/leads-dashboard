# File inventory (`DOC-001`)

**Produced:** 2026-09-10, against commit `e281f9b` (`git ls-files` +
working-tree scan).
**Purpose:** the verified, current file list for the whole repo — the
ground truth every later Documentation Project task is checked against
(`DOCUMENTATION_PROJECT_PLAN.md` Phase 1).

> **Ordering note.** Phase 3 (`DOC-025`–`DOC-034`, the component records)
> was worked **before** this Phase 1 task, because Phase 1 was `Not
> Started` at the time. Phase 3 therefore built its inventory directly
> from live `git ls-files` + `LOGIC_AUDIT.md` rather than from this file.
> This document is the retroactive confirmation the plan asks for; the
> ID column shows where each file's record already landed. Nothing here
> contradicts the Phase 3 records — it is the same file set, listed
> plainly.

This is a **plain list** (`DOC-001`'s deliverable spec). IDs shown for
convenience are from Phase 2/3 (`docs/INDEX.md`).

---

## 1. Repo root — application

| File | Role | ID (if cataloged) |
|---|---|---|
| `dashboard.html` | the dashboard page shell (DOM + `<style>` + `<script src>` tags) | part of `DASH-001` |

## 2. Repo root — client JS (`js/`) — **24 files**

| File | ID | Loaded how |
|---|---|---|
| `js/core-auth.js` | JS-001 | `<script src>` |
| `js/core-collation.js` | JS-002 | `<script src>` |
| `js/core-fetch-and-render.js` | JS-003 | `<script src>` |
| `js/core-filters.js` | JS-004 | `<script src>` |
| `js/core-foundation.js` | JS-005 | `<script src>` |
| `js/core-lead-model.js` | JS-006 | `<script src>` |
| `js/core-outcome-engine.js` | JS-007 | `<script src>` |
| `js/core-rm-performance.js` | JS-008 | `<script src>` |
| `js/core-sheets-fetch.js` | JS-009 | `<script src>` |
| `js/core-ui.js` | JS-010 | `<script src>` |
| `js/main.js` | JS-011 | `<script src>` (last) |
| `js/overview-distribution-people-ops.js` | JS-012 | `<script src>` |
| `js/repeat-offenders-pdf.js` | JS-013 | `<script src>` |
| `js/reports-build.js` | JS-014 | `<script src>` |
| `js/reports-gmail.js` | JS-015 | `<script src>` |
| `js/reports-ui.js` | JS-016 | `<script src>` |
| `js/rm-performance-worker.js` | JS-017 | **`new Worker('js/rm-performance-worker.js')`** in `js/tab-repeat-offenders.js:361` — **not** a `<script src>` tag |
| `js/sheets-writeback.js` | JS-018 | `<script src>` |
| `js/tab-audit.js` | JS-019 | `<script src>` |
| `js/tab-morning.js` | JS-020 | `<script src>` |
| `js/tab-movement.js` | JS-021 | `<script src>` |
| `js/tab-repeat-offenders.js` | JS-022 | `<script src>` |
| `js/tab-rmtimeline.js` | JS-023 | `<script src>` |
| `js/tab-tracking.js` | JS-024 | `<script src>` |

`dashboard.html` has **23** `<script src="js/...">` tags; the 24th file
(`rm-performance-worker.js`) is loaded as a Web Worker.

## 3. Repo root — Apps Script backend, production (`*.gs`) — **13 files**

| File | ID |
|---|---|
| `AllIssuesEmailer.gs` | GS-001 |
| `Core.gs` | GS-002 |
| `DailyRmIssueLog.gs` | GS-003 |
| `EmailInfra.gs` | GS-004 |
| `FollowupEngine.gs` | GS-005 |
| `InteractionHistoryLogger.gs` | GS-006 |
| `LeadFollowupsStaleness.gs` | GS-007 |
| `MovementTracker.gs` | GS-008 |
| `OpsChecklistRunner.gs` | GS-009 |
| `OvernightEmailer.gs` | GS-010 |
| `RmHierarchy.gs` | GS-011 |
| `SlaEngine.gs` | GS-012 |
| `UnmatchedCommentLogger.gs` | GS-013 |

## 4. Repo root — Apps Script test suite (`Tests_*.gs`) — **15 files**

One `Tests_<File>.gs` per production `.gs` (13) plus `Tests_Mocks.gs` and
`Tests_RunAll.gs`:

`Tests_AllIssuesEmailer.gs`, `Tests_Core.gs`, `Tests_DailyRmIssueLog.gs`,
`Tests_EmailInfra.gs`, `Tests_FollowupEngine.gs`,
`Tests_InteractionHistoryLogger.gs`, `Tests_LeadFollowupsStaleness.gs`,
`Tests_Mocks.gs`, `Tests_MovementTracker.gs`,
`Tests_OpsChecklistRunner.gs`, `Tests_OvernightEmailer.gs`,
`Tests_RmHierarchy.gs`, `Tests_RunAll.gs`, `Tests_SlaEngine.gs`,
`Tests_UnmatchedCommentLogger.gs`.

Out of catalog scope per `DOC-007` — each `GS-XXX` record's `Validation`
section names its `Tests_` file.

## 5. Node CI harness

| File | Role |
|---|---|
| `test/run-gs-tests.js` | the Node harness that concatenates the `.gs` files + `Tests_*.gs` into a sandbox and runs `runAllTests()` — CI on every push |
| `test/check-docs-coverage.js` | warn-only doc-coverage + `HANDOVER.md` freshness check (`CI-001`–`CI-005`) |
| `package.json` | Node manifest — `"test": "node test/run-gs-tests.js"`, no runtime deps |
| `tests/frontend-harness.html` | the browser harness — grafts the real `dashboard.html` + `js/*.js`, mocks only the Sheets read + OAuth token pair; **not** part of CI |

## 6. CI / workflow

| File | Role |
|---|---|
| `.github/workflows/test.yml` | GitHub Actions — runs the `.gs` suite + (warn-only) the doc-coverage check on every push |

## 7. Root documentation (`*.md`)

| File | Role |
|---|---|
| `CLAUDE.md` | quick orientation + gotchas |
| `HANDOVER.md` | onboarding narrative + incident history; §1–§3 the living architecture description until `docs/` takes over |
| `LOGIC_AUDIT.md` | the frozen 2026-09-07 point-in-time logic/connection audit (7 parts) |
| `DOCUMENTATION_PROJECT_PLAN.md` | this project's own plan (+ the Governance Model section) |
| `OPS_CHECKLIST.md` | proactive periodic checks (RM-hierarchy gaps, Manager_Directory email gaps, Movement_Log freshness, worst-performer drift) |
| `LEAD_FOLLOWUPS_STALENESS.md` | the `Lead_Followups` consumer map + each consumer's staleness tolerance |

## 8. `docs/` — the component catalog

**97 tracked files** as of `e281f9b`: `INDEX.md`, `NAMING_CONVENTIONS.md`,
13 folder `README.md`s, `_templates/` (11 files), `_planning/`
(`file-inventory.md` = this file, `function-inventory.md`,
`button-inventory.md`), and the Phase 3 record set —
`dashboards/` (1), `tabs/` (8), `js-modules/` (24), `gs-modules/` (13),
`sheets/` (14), `integrations/` (4), `data-flows/` (5). `_archive/`
empty. Full breakdown: `docs/INDEX.md` coverage snapshot.

## 9. `design/`

| File | Role |
|---|---|
| `design/live-ops-redesign.html` | a standalone visual mockup from an earlier exploration pass — **not wired to real data, not part of the live app** (`HANDOVER.md` §2). Present in the repo; **not cataloged** (not a live component). |

## 10. Config

| File | Role |
|---|---|
| `.gitignore` | excludes `RmHierarchy.private.gs` and `.claude/settings.local.json` |

---

## Standing facts (not gaps to chase)

### `RmHierarchy.private.gs` — **confirmed absent, by design**

Gitignored (`.gitignore` line 4). It supplies `EMPLOYEE_EMAIL_BY_NAME_RAW_`
(real employee emails from an HR roster export). It is pasted into the
bound Apps Script project alongside `RmHierarchy.gs` but is **never** in
this public repo. Its absence degrades every resolved email to `''` and
routing falls back to `Region_Recipients` / `CH_LEVEL_EMAIL_` — a
confirmed soft-degrade, not a crash (`GS-011` EXC-084). **This is a
standing fact, not a missing-file finding.**

### `appsscript.json` — not in the repo, by design

There is no `appsscript.json` checked in. The authoritative Apps Script
manifest (timezone, Advanced Gmail Service enablement, etc.) lives inside
the Sheet's own bound Apps Script project (`HANDOVER.md` §2, §4.3). Not a
gap.

### `.clasp.json` / any `clasp` config — absent, by design

No `clasp`, no automated `.gs` deploy. The authoritative running copy of
each `.gs` file is inside the Sheet's Apps Script editor; a repo edit is
not live until pasted (`CLAUDE.md` top gotcha).

---

## Drift from `LOGIC_AUDIT.md` Part 1's inventory

`LOGIC_AUDIT.md` Part 1 was researched against the **2026-09-05** file
state (its own note) and the audit is dated **2026-09-07**. The plan's
`DOC-001` text paraphrases it as "23 `js/*.js` files, 11 production `.gs`
files." Both counts have since moved:

| Item | `LOGIC_AUDIT.md` Part 1 (2026-09-05/07) | Now (2026-09-10, `e281f9b`) | What changed |
|---|---|---|---|
| `js/*.js` files | **23** (Part 1 §4a: "loads all 23 `js/*.js` files") | **24** | `js/rm-performance-worker.js` **added** (the off-thread RM-performance compute) — loaded as a Web Worker, so `dashboard.html` still has 23 `<script src>` tags but `js/` holds 24 files. |
| Production `.gs` files | **11** (Part 1 §4d main table lists 11; the plan text says 11) | **13** | `OpsChecklistRunner.gs` **added** 2026-09-09 (weekly Ops-checklist email); `LeadFollowupsStaleness.gs` **added** 2026-09-09 (one-time `Lead_Followups` conditional-formatting installer). Both post-date the audit. |
| `Tests_*.gs` files | **12** `Tests_*.gs` + `Tests_Mocks.gs` + `Tests_RunAll.gs` (Part 1 §4d) = 14 | **15** | `Tests_OpsChecklistRunner.gs` + `Tests_LeadFollowupsStaleness.gs` **added** alongside their production files. (`Tests_InteractionHistoryLogger.gs` already existed at the audit — `InteractionHistoryLogger.gs` was the audit's own "most recent shipped feature.") |
| `docs/` tree | did not exist | **97 tracked files** | Created by `DOCUMENTATION_PROJECT_PLAN.md` Phase 2 (`c82ec67`) + Phase 3 (`8b05395`..`e281f9b`). |
| `DOCUMENTATION_PROJECT_PLAN.md` | not mentioned as a repo file | present | this plan itself. |
| `package.json` | not called out in Part 1 | present | a minimal Node manifest for `test/run-gs-tests.js` (no runtime deps). Likely present at the audit but not enumerated. |

**Nothing was removed.** Every file `LOGIC_AUDIT.md` Part 1 named is
still in the repo. `RmHierarchy.private.gs`'s absence was already
correctly recorded by the audit as "not in this repo" — unchanged.

### Consequence for the rest of the plan

`DOC-001`'s own spec text ("23 `js/*.js` files, 11 production `.gs`
files") and any later Phase 1 task that quotes those numbers should be
read as **24** and **13**. The Phase 3 records already use the current
counts; `docs/INDEX.md` and the two `_planning/` inventories
(`function-inventory.md`, `button-inventory.md`) are authoritative for
the file set.

---

## Definition of Done check

- **Every file in the repo appears exactly once** — ✅ (§1–§10 above;
  `docs/`'s 97 files summarised in §8 rather than enumerated, since they
  are the catalog itself and each is a `docs/INDEX.md` row).
- **Any file in `LOGIC_AUDIT.md`'s inventory no longer in the repo (or
  vice versa) called out explicitly** — ✅ (Drift table: 4 additions,
  0 removals).
- **`RmHierarchy.private.gs`'s confirmed absence recorded as a standing
  fact** — ✅ (Standing facts section).

## Untracked working-tree items (noted, not part of the deliverable)

| Path | Status |
|---|---|
| `.claude/` (`devserver.ps1`, `launch.json`, and gitignored `settings.local.json`) | session/dev tooling for this machine — not application code |
| `working files on 28th for automatic email/` (4 `.gs` copies) | **not in git, not in `.gitignore`** — a mid-development manual backup snapshot; **not authoritative**, safe to ignore or delete (`HANDOVER.md` §2). The root-level `.gs` files are always the source of truth. |
