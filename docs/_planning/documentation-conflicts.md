# Documentation conflicts register (`DOC-012`)

**Produced:** 2026-09-10, cross-checking `CLAUDE.md`, `HANDOVER.md`,
`LOGIC_AUDIT.md`, `DOCUMENTATION_PROJECT_PLAN.md`, and in-code comments
against each other and against the current source at commit `e281f9b`.
**Purpose:** every place the docs disagree with each other or with the
code, so Phase 3 records the **current, verified** fact rather than
propagating a stale one. (`DOCUMENTATION_PROJECT_PLAN.md` Phase 1,
`DOC-012`; depends on `DOC-002` + `DOC-003`.)

**"Currently correct" = verified by a direct read of the source at
`e281f9b`.**

---

## C-1 — Script-load order: `CLAUDE.md`'s "9 files" claim *(the known one, per `DOC-012`)*

| | |
|---|---|
| **In** | `CLAUDE.md:24` — "`js/core-*.js` load first (9 files, `HANDOVER.md` §2 for the exact order)" |
| **Reality** | There are **10** `js/core-*.js` files (`core-auth`, `core-collation`, `core-fetch-and-render`, `core-filters`, `core-foundation`, `core-lead-model`, `core-outcome-engine`, **`core-rm-performance`**, `core-sheets-fetch`, `core-ui`). Only **9** load first (positions 1–9 in `dashboard.html`'s `<script src>` list). `core-rm-performance.js` loads at **position 15**, interleaved among the tab files (`tab-audit … tab-repeat-offenders → core-rm-performance → repeat-offenders-pdf → …`). |
| **Currently correct** | The real order (positions 1–9): `core-foundation → core-sheets-fetch → core-auth → core-lead-model → core-collation → core-outcome-engine → core-fetch-and-render → core-ui → core-filters`. **This exactly matches `HANDOVER.md` §2's *first* order paragraph** (the one with per-file descriptions). |
| **Impact** | Functionally harmless — nothing at parse time in any of the first 9 calls into `core-rm-performance` (`LOGIC_AUDIT.md` Part 1 §4a). It's a documentation accuracy issue, not a bug. |
| **Fix recommendation** | Edit `CLAUDE.md:24` to: "9 of the 10 `js/core-*.js` files load first (`HANDOVER.md` §2 for the exact order); `core-rm-performance.js` loads later, interleaved with the tab files — harmless, nothing at parse time calls into it." |
| **Status** | **Follow-up task opened** — `t-tf-7e4d0dffdf6c` "[Leads Dashboard] Doc-accuracy touch-up: CLAUDE.md script-load-order + HANDOVER.md C-2..C-7 one-liners" (Low priority, tags `leads-dashboard` / `documentation`). Not blocking this catalog project's critical path (`DOC-012`'s own follow-up instruction). Already recorded on `DASH-001` `## HTML / CSS structure` and every `JS-XXX` `## Load order / position`. |

## C-2 — `HANDOVER.md` §2's *second* load-order paragraph is stale (pre-split)

| | |
|---|---|
| **In** | `HANDOVER.md` §2, the "**Load order matters**" block (~`#L113`): "`core.js` → `tab-audit.js` → `tab-tracking.js` → `tab-rmtimeline.js` → `tab-movement.js` → `tab-repeat-offenders.js` → `tab-morning.js` → `reports.js` → `sheets-writeback.js` → `overview-distribution-people-ops.js` → `main.js`" |
| **Reality** | `core.js` was split into 9 `core-*.js` files and `reports.js` into 3 `reports-*.js` files in the **2026-09 modularity refactor** (pure code motion). The real order also has `core-rm-performance.js` (pos 15) and `repeat-offenders-pdf.js` (pos 16) that this paragraph omits entirely. |
| **Currently correct** | The full 23-entry `<script src>` order + the `js/rm-performance-worker.js` 24th file loaded as a `new Worker()` — see `docs/_planning/js-module-inventory.md` (`DOC-006`) and `DASH-001`'s `## HTML / CSS structure`. `HANDOVER.md` §2's *first* paragraph (per-file, first-9) is fine; only this *second* paragraph is stale. |
| **Contradiction type** | `HANDOVER.md` vs itself (§2 para 1 correct, §2 para 2 stale) **and** `HANDOVER.md` vs code. |
| **Fix recommendation** | Fold into the same `HANDOVER.md` §2 refresh as `handover-coverage-map.md`'s Phase 5 list item for §2 — replace the pre-split names with the current 24-file picture (or point at `docs/_planning/js-module-inventory.md`). Same follow-up owner as C-1. |
| **Status** | Logged; not separately tasked (it rides the `HANDOVER.md` §2 Phase 5 refresh, `handover-coverage-map.md` item 4). |

## C-3 — File counts: all three root docs predate 3 files

| | |
|---|---|
| **In** | `CLAUDE.md` (the `.gs` list in "What this is" omits `OpsChecklistRunner.gs` + `LeadFollowupsStaleness.gs`); `HANDOVER.md` §1's `.gs` list (same omission — but §2 and §4.3 **do** list them); `LOGIC_AUDIT.md` Part 1 §4a ("23 `js/*.js` files"), §4d (11 production `.gs`); `DOCUMENTATION_PROJECT_PLAN.md` `DOC-001`/`DOC-006`/`DOC-007` text ("23 js, 11 gs"). |
| **Reality** | **24** `js/*.js` (`rm-performance-worker.js` added), **13** production `.gs` (`OpsChecklistRunner.gs` + `LeadFollowupsStaleness.gs`, both 2026-09-09), **15** `Tests_*.gs`. |
| **Currently correct** | `docs/_planning/file-inventory.md` (`DOC-001`) — the drift table, 4 additions / 0 removals. |
| **Contradiction type** | Every root doc vs current code — a dating artifact (the docs are older than the files), not a real disagreement. |
| **Fix recommendation** | `CLAUDE.md` "What this is" + `HANDOVER.md` §1 `.gs` list: add the two files. `LOGIC_AUDIT.md` is **frozen** — do **not** edit it; its dated nature is the point (`file-inventory.md` records the drift instead). |
| **Status** | Logged; captured in `file-inventory.md` + `handover-coverage-map.md` (items 4, 8). Not separately tasked. |

## C-4 — `HANDOVER.md` §7.2: "no dashboard test suite exists / not built yet"

| | |
|---|---|
| **In** | `HANDOVER.md` §7.2 — "There is currently **no permanent, run-anytime test suite** for `js/*.js` … **Recommended first task** … build `test/dashboard.test.html` … **Not built yet**." |
| **Reality** | `tests/frontend-harness.html` **exists** — it grafts the real `dashboard.html` + `js/*.js`, mocks only the Sheets read + OAuth token pair, and runs synthetic leads through the real `fetchAndRender()`. Every Phase 3 `JS-XXX` record cites it as the validation method. (It is **not** in CI — that part of §7.2 stays true.) |
| **Currently correct** | `tests/frontend-harness.html` at repo root; `CLAUDE.md`'s Testing section already references it. |
| **Contradiction type** | `HANDOVER.md` §7.2 vs `CLAUDE.md` Testing section + reality. |
| **Fix recommendation** | `HANDOVER.md` §7.2: replace "not built yet" with a pointer to `tests/frontend-harness.html`; keep the "not in CI" caveat. |
| **Status** | Logged; `handover-coverage-map.md` item 7. Not separately tasked. |

## C-5 — `HANDOVER.md` §9.7: "RM Performance redesign … in progress, 2026-09-04"

| | |
|---|---|
| **In** | `HANDOVER.md` §9.7 title + body — describes replacing "Avg Flagged" as **in progress**, dated 2026-09-04. §9.1 still frames the tab as "ranks … by **Avg Flagged**". |
| **Reality** | The redesign **shipped** (`computeRmPerformance`'s empirical-Bayes composite score in `js/core-rm-performance.js`) and iterated further **this session, 2026-09-10** (`rmPerfCanonicalRmName` aliases, broadened `RM_PERF_NON_RM_ROLES`, `computeRmPerformanceByRegion`). `js/core-rm-performance.js` 485→869 lines since §9.7 was written. |
| **Currently correct** | `TAB-004` / `JS-008` / `JS-017` / `JS-022` / `GS-003` records + `DATA-002`; this session's fix commits. |
| **Contradiction type** | `HANDOVER.md` §9 vs current code — the largest stale claim. |
| **Fix recommendation** | Rewrite §9.7 to the shipped state, or shrink it to a pointer at `TAB-004` / `JS-008` / `GS-003` / `DATA-002`. Update §9.1's "Avg Flagged" framing. |
| **Status** | Logged; `handover-coverage-map.md` items 1–2 (highest-priority Phase 5). Not separately tasked (it's a Phase 5 job). |

## C-6 — `HANDOVER.md` §9.3 / §9.3.1: renamed function names

| | |
|---|---|
| **In** | §9.3 lists `reportRepeatOffenderRmsNow()`; §9.3.1 references `aggregateRepeatOffenders` and `totalLeadsByKey()`. |
| **Reality** | The Phase 3 grep of `DailyRmIssueLog.gs` found **`reportRmPerformanceNow()`** (not `reportRepeatOffenderRmsNow`); the grep of `js/core-rm-performance.js` found **`aggregateRmPerformance`** (not `aggregateRepeatOffenders`). Likely renamed in the §9.7 redesign. `totalLeadsByKey()` — not found in this session's greps; needs a targeted check. |
| **Currently correct** | `GS-003` `## Significant functions` (`reportRmPerformanceNow` = FN-195); `JS-008` (`aggregateRmPerformance` folded into FN-054). `totalLeadsByKey` — **unresolved, flag for Phase 5.** |
| **Contradiction type** | `HANDOVER.md` §9 vs current code. |
| **Fix recommendation** | Part of the §9.7 rewrite (C-5). Phase 5 to confirm the current name for the "Total Leads" column helper and whether `reportRepeatOffenderRmsNow` survives as an alias. |
| **Status** | Logged; `handover-coverage-map.md` item 3. |

## C-7 — `HANDOVER.md` §5: `Movement_Log` "every 6h"

| | |
|---|---|
| **In** | `HANDOVER.md` §5 writer/reader table — "`Movement_Log` \| `MovementTracker.gs` (every 6h) …" (and §4.3's setup table says "4 daily triggers at 00:00, 06:00, 12:00, 18:00 IST"). |
| **Reality** | 4 separate `atHour()` triggers at **fixed hours `[0,6,12,18]` IST** (`SNAPSHOT_HOURS_`), deliberately **not** a single `everyHours(6)` trigger — the file's own comment says `everyHours()` "can silently skip or drift by hours under load" (`GS-008` CFG-048). §4.3's own table already states it correctly; §5's "every 6h" shorthand is looser. |
| **Currently correct** | `SHEET-002` `## Automation / triggers touching it`; `GS-008` `## Trigger schedule`. |
| **Contradiction type** | `HANDOVER.md` §5 vs `HANDOVER.md` §4.3 (§4.3 correct) — a shorthand imprecision, not a real conflict. |
| **Fix recommendation** | Minor: §5 → "4×/day at 00:00/06:00/12:00/18:00 IST". Rides the §5 Phase 5 refresh (`handover-coverage-map.md` item 5). |
| **Status** | Logged; low priority. |

## C-8 — In-code `.gs` comments still say `js/core.js`

| | |
|---|---|
| **In** | Several `.gs` file header comments name the browser construct they port from as living in `js/core.js` (the pre-split single file). |
| **Reality** | `js/core.js` was split into 9 `core-*.js` files (2026-09 refactor); the construct itself didn't move logic, just files. |
| **Currently correct** | The Phase 3 `GS-XXX` `## Cross-runtime duplication` sections name the current file (e.g. `SlaEngine.gs` ports from `js/core-lead-model.js`, not `js/core.js`). |
| **Contradiction type** | In-code comment vs current file layout — **self-acknowledged**: `HANDOVER.md` §6 already notes "still describing the file as `js/core.js` in some older comments." |
| **Fix recommendation** | Not urgent; a comment-only touch-up per `.gs` file when it's next edited. Not tasked. |
| **Status** | Logged; acknowledged by `HANDOVER.md` §6 already. |

## C-9 — `LOGIC_AUDIT.md` line-number citations vs grown files

| | |
|---|---|
| **In** | Every `LOGIC_AUDIT.md` Part 1 §4b/§4c/§4d citation is `#Lnn` against the **2026-09-05** file version. |
| **Reality** | `core-rm-performance.js` 485→869, `tab-repeat-offenders.js` 383→717, `DailyRmIssueLog.gs` 980→1127, `OvernightEmailer.gs` 1374→1409, `RmHierarchy.gs` 1054→1122, `MovementTracker.gs` 945→1000, `core-lead-model.js` 435→449, `core-outcome-engine.js` 935→934. |
| **Currently correct** | The Phase 3 records cite current line numbers (`grep -n` at `c82ec67`/`e281f9b`). `LOGIC_AUDIT.md` remains the authority for *what a file does*, not *where in the file*. |
| **Contradiction type** | Frozen doc vs current code — **by design.** `LOGIC_AUDIT.md` is explicitly a dated, point-in-time record. |
| **Fix recommendation** | **None.** Do not edit `LOGIC_AUDIT.md`. `logic-audit-source-map.md` (`DOC-003`) + `file-inventory.md` (`DOC-001`) record the drift. |
| **Status** | Logged; no action (frozen-by-design). |

---

## Summary

| ID | Docs involved | Severity | Action |
|---|---|---|---|
| **C-1** | `CLAUDE.md` vs code | low (accuracy) | **Follow-up task opened** — correct `CLAUDE.md:24` |
| C-2 | `HANDOVER.md` §2 vs itself + code | low | rides the §2 Phase 5 refresh |
| C-3 | all root docs vs code | low (dating) | `CLAUDE.md` + `HANDOVER.md` §1 add 2 `.gs`; `LOGIC_AUDIT.md` untouched |
| C-4 | `HANDOVER.md` §7.2 vs `CLAUDE.md` + reality | low | §7.2 Phase 5 refresh |
| C-5 | `HANDOVER.md` §9.7 vs code | **medium** (largest stale claim) | Phase 5 — rewrite/retire §9.7 |
| C-6 | `HANDOVER.md` §9.3/§9.3.1 vs code | low | part of the §9.7 rewrite + a Phase 5 targeted check |
| C-7 | `HANDOVER.md` §5 vs §4.3 | trivial | §5 shorthand fix |
| C-8 | `.gs` comments vs file layout | trivial | acknowledged by §6; touch-up when next edited |
| C-9 | `LOGIC_AUDIT.md` vs code | N/A (frozen by design) | none |

**No new bug was found** — every conflict is doc-accuracy / staleness,
and in every case the *code* is the currently-correct authority and a
Phase 3 record already carries the current fact.

---

## Definition of Done check

- **The known script-load-order discrepancy is logged with a concrete
  fix recommendation** — ✅ (C-1: exact `CLAUDE.md:24` rewrite text;
  follow-up task opened per `DOC-012`'s follow-up instruction; C-2 logs
  the related `HANDOVER.md` §2 staleness).
- **Any newly found contradiction has the same treatment** — ✅ (C-3
  through C-9: each has the doc(s) involved, the currently-correct fact
  from direct code verification, a fix recommendation, and a status).

## `DOC-012` follow-up item — done

> "Create a small follow-up task to actually correct `CLAUDE.md`'s
> script-load-order claim once this catalog project is far enough along."

**Opened** via `update-tasks.ps1` alongside closing `DOC-003`..`DOC-012`
— one task, `tag: leads-dashboard`, low priority, not blocking the
catalog's critical path. It also carries C-2/C-3/C-4/C-7's small
`CLAUDE.md` + `HANDOVER.md` §2/§5/§7.2 touch-ups as a batch, since they
are the same kind of one-line accuracy fix in the same two files.
