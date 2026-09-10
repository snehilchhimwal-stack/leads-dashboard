# `_planning/` — Documentation Project working notes

The Phase 1 inventories + cross-checks the component catalog is built
from. Not component records — planning artifacts. Each names the `DOC-`
task that produced it and includes a Definition-of-Done check.

| File | Task | What it is |
|---|---|---|
| `file-inventory.md` | `DOC-001` | verified current file list + drift vs `LOGIC_AUDIT.md` Part 1 |
| `handover-coverage-map.md` | `DOC-002` | `HANDOVER.md` section-by-section → components covered / verdict / where it landed; the Phase 5 `HANDOVER.md` re-verify list |
| `logic-audit-source-map.md` | `DOC-003` | component category → which `LOGIC_AUDIT.md` Part/section is the primary source |
| `dashboard-inventory.md` | `DOC-004` | the one-dashboard granularity decision (`DASH-001`, tabs beneath it) |
| `tab-inventory.md` | `DOC-005` | the 8 `#tab-*` containers + each one's code-confirmed render function |
| `js-module-inventory.md` | `DOC-006` | all 24 `js/*.js` + the core/feature split (→ `DOC-027`/`DOC-028` scope) |
| `gs-module-inventory.md` | `DOC-007` | all 13 production `.gs` + the `Tests_*.gs` / private-file scope decisions |
| `function-inventory.md` | `DOC-008` + `DOC-030` | `FN-001`..`FN-254` allocation + the significance bar; reconciled |
| `button-inventory.md` | `DOC-009` + `DOC-031` | all 34 `<button>` + `#autoSnapshotCheck` → `BTN-XXX` / `DASH-001`; reconciled |
| `sheet-inventory.md` | `DOC-010` | the 14 Sheet tabs + writer/reader; the one-spreadsheet check |
| `integration-inventory.md` | `DOC-011` | the 4 `EXT-` integrations + real call sites; the `<head>` check |
| `documentation-conflicts.md` | `DOC-012` | 9 doc-vs-doc / doc-vs-code conflicts (C-1..C-9) + fixes |
| `retention-decisions-needed.md` | `DOC-037` | the 7 `TBD` Sheet-tab retention values from `DOC-036`, each with context + options, routed for the owner's decision |
| `completeness-verification.md` | `DOC-039` | mechanical re-check of every category against the live repo — zero gaps |
| `reference-verification.md` | `DOC-040` | dangling-ref check (0) + `INDEX.md` reciprocity normalised to 0 one-directional pairs |
| `consistency-check.md` | `DOC-041` | catalog vs `LOGIC_AUDIT.md` duplicated-logic pairs + 5 direct live-code spot-checks |
| `OPEN_ITEMS.md` | `DOC-042` | the consolidated open-items tracker (retention `TBD`, conflicts, `HANDOVER.md` reconciliation, code findings recorded-not-fixed) |

Phase 1 (`DOC-001`–`DOC-013`) is complete. `DOC-013` (the catalog's
front matter) lives in `../INDEX.md`, not here. Phase 4's `DOC-036`
completed the `## Data Lifecycle` sections in `../sheets/`; `DOC-037`'s
list (above) is the open-questions hand-off.
