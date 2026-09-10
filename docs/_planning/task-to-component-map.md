# Task ↔ component map (`t-tf-5ad22d8e4c2e`, forensic-audit P3 item 16)

The forensic audit (`FORENSIC_COMPLETENESS_AUDIT_2026-09-10.md` §D) flagged
**Task ↔ Component** traceability as weak: each record's `## Version /
change reference` says which `DOC-` task created it, but there was no
reverse index ("which task produced `SHEET-009`?" needed a grep).

This is that index. **Goal ↔ Task is already wired** in `tasks.json` —
every `DOC-*` / `CI-*` / `TASKFLOW-*` / `CHECKLIST-*` / `LEADFOLLOWUPS-*`
task carries its `goal_id`, and the five `t-tf-*` catalog follow-ups were
linked to `g-docproject01` in this pass. (The audit's "Goal ↔ Task
broken" line was based on a stale read; corrected there.)

---

## `DOC-` task → what it produced

| Task | Goal `g-docproject01` | Produced |
|---|---|---|
| `DOC-001`…`DOC-012` | Phase 1 | `_planning/*` inventories + cross-checks (`file-inventory.md`, `handover-coverage-map.md`, `logic-audit-source-map.md`, `dashboard-inventory.md`, `tab-inventory.md`, `js-module-inventory.md`, `gs-module-inventory.md`, `function-inventory.md`, `button-inventory.md`, `sheet-inventory.md`, `integration-inventory.md`, `documentation-conflicts.md`) |
| `DOC-013` | Phase 2 | `INDEX.md` front matter |
| `DOC-014`…`DOC-021` | Phase 2 | `docs/` folder tree, `_templates/*`, `NAMING_CONVENTIONS.md`, `INDEX.md` master table seed |
| `DOC-022` / `DOC-023` / `DOC-024` | Phase 2 tail | `HOW_TO_REGISTER_A_COMPONENT.md` / `HOW_TO_UPDATE_A_COMPONENT.md` / `HOW_TO_RETIRE_A_COMPONENT.md` |
| **`DOC-025`** | Phase 3 | `DASH-001` |
| **`DOC-026`** | Phase 3 | `TAB-001`…`TAB-008` (+ `BTN-001`…`022`, `UI-001`…`014`) |
| **`DOC-027`** | Phase 3 | `JS-001`…`JS-011` (core layer) + `FN-001`…`FN-076` |
| **`DOC-028`** | Phase 3 | `JS-012`…`JS-024` (feature layer) + `FN-077`…`FN-173` |
| **`DOC-029`** | Phase 3 | `GS-001`…`GS-013` + `FN-174`…`FN-254` |
| **`DOC-030`** | Phase 3 | `function-inventory.md` + the `FN-191`/`FN-194` split reconciliation |
| **`DOC-031`** | Phase 3 | `button-inventory.md` reconciliation |
| **`DOC-032`** | Phase 3 | `SHEET-001`…`SHEET-014` (base records) |
| **`DOC-033`** | Phase 3 | `EXT-001`…`EXT-004` |
| **`DOC-034`** | Phase 3 | `DATA-001`…`DATA-005` |
| **`DOC-035`** | Phase 3 tail | `RELATIONSHIP_MAP.md` + the `INDEX.md` reciprocity walk (243 one-directional pairs found) |
| **`DOC-036`** | Phase 4 | `## Data Lifecycle` on all 14 `SHEET-` records; `retention-decisions-needed.md` |
| **`DOC-037`** | Phase 4 | `retention-decisions-needed.md` (the 7 `TBD` routing) |
| **`DOC-038`** | Phase 4 | `## Sensitivity & operational importance` on all 14 `SHEET-` records |
| **`DOC-039`** | Phase 5 | `completeness-verification.md` |
| **`DOC-040`** | Phase 5 | `reference-verification.md` + `INDEX.md` reciprocity normalisation (0 asymmetries) |
| **`DOC-041`** | Phase 5 | `consistency-check.md` (live-constant spot-checks) |
| **`DOC-042`** | Phase 5 | `OPEN_ITEMS.md` + `_planning/README.md` |
| `DOC-043` / `DOC-049` | Phase 6 | `HOW_TO_FIND_DOCS_FOR_A_FEATURE.md` / `PRE_SHIP_DOCUMENTATION_CHECKLIST.md` |
| `DOC-044` / `DOC-050` | Phase 6 | `INDEX.md` "Maintaining this catalog"; the 3-doc cross-links (`HANDOVER.md`, `LOGIC_AUDIT.md`, `INDEX.md`) |
| `DOC-045`…`DOC-048` | Phase 6 | the `HOW_TO_*` guides' worked examples (`DOC-047` = the real 2026-09-07 retention fix walked as 6 record edits; `DOC-048` = "no retirement candidate exists") |

## Follow-up (`t-tf-*`) task → what it produced

| Task | Produced |
|---|---|
| `t-tf-e4d1da76ca0f` | the Governance Model in `DOCUMENTATION_PROJECT_PLAN.md` (7-state status, 14-point DoD, Definition of Stale, Change-Control Mechanism, Source-of-Truth Table) |
| `t-tf-7e4d0dffdf6c` | `CLAUDE.md` load-order + `HANDOVER.md` C-1…C-4/C-7 accuracy fixes |
| `t-tf-47c37923c3bd` | 54 record files' `## Relationships` aligned to `INDEX.md` exactly (0 one-directional); `reciprocity-normalisation-notes.md` |
| `t-tf-cc97c00a3839` | `FORENSIC_COMPLETENESS_AUDIT_2026-09-10.md` |
| `t-tf-5ad22d8e4c2e` | `test/check-catalog.py` (A–F), `test/run-frontend-harness.mjs`, `fetch-depth: 0`; `FLOW-001` / `FLOW-002` / `apps-script-triggers.md`; `docs/changes/2026-09-10-build.md`; `docs/validation/README.md`; `task-to-component-map.md`; the 3 live-contradiction fixes; the HANDOVER §9 deep sweep |

## Reverse — record → task

Every own-file record's `## Version / change reference` (or `## Closure
evidence`) states its creating task. `grep -rn "created by" docs/<type>/`
gives the current answer if this table drifts; `check-catalog.py` does
**not** verify this mapping (it is a one-time provenance note, not a live
invariant).
