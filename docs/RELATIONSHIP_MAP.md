# `docs/RELATIONSHIP_MAP.md` — consolidated dependency view (`DOC-035`)

**Produced:** 2026-09-10 against commit `9cafa68`.
**Purpose:** one place to see the highest-traffic dependency chains
without opening every record. Built from `LOGIC_AUDIT.md` Part 6 §6.3
("if I change this, what could break") + §6.5 (system-wide logic matrix)
+ Part 7 diagram G, reusing that material directly (`DOC-035`).

For the per-component `Depends On` / `Used By` lists, see each record's
`## Relationships` section and the `docs/INDEX.md` master table.

---

## 1. The 4 client state hubs

Plain top-level `let`/`const` globals, no accessors — a change to any of
their **shape** ripples to every reader.

| Hub | Declared / owned | Written by | Read by | If its shape changes |
|---|---|---|---|---|
| **`allParsedLeads`** | declared `js/core-sheets-fetch.js` (`JS-009`), written `js/core-fetch-and-render.js:566` (`JS-003`) | `JS-003` (`fetchAndRender` — the only writer) | `JS-004` (`applyFiltersAndRender` → rebuilds `leads`/`issueLeads`), `JS-021` (Overnight cohort uses it live), `JS-023` (`rmtlScopedLeads`), `JS-018` (`browserSnapshotOpenLeads`) | every tab re-derives; `enrichLead` input contract breaks |
| **`movementSnapshots`** | owned `js/tab-movement.js` (`JS-021`) | `JS-021` (`fetchMovementLog`) | `JS-008` (RM performance), `JS-013` (PDF), `JS-017` (worker), `JS-023` (RM Timeline trend), `JS-024` (cohorts) | `TAB-004`, `TAB-005`, `TAB-008` all break; the RM-performance engine + PDF break |
| **`filterState`** | declared `js/core-sheets-fetch.js` (`JS-009`) | `JS-004` (`buildMultiSelect` callbacks) | `JS-004`, `JS-021` (`passesMovementFilters`), `JS-022` (its own filter snapshot), `JS-014` (report scope) | filtering silently misbehaves across all tabs |
| **`_currentSheetId`** | owned `js/tab-movement.js:87` (`JS-021`) | `JS-021` (on fetch / source change) | `JS-018` (**every** client Sheet write targets it) | every write-back path targets the wrong sheet or fails |

`LOGIC_AUDIT.md` Part 7 diagram G traces `Movement_Log` → `movementSnapshots`
→ its 6+ consumers; Part 6 §6.3 names all four as the "change this and a
lot breaks" set.

## 2. The cross-runtime constant/logic pairs ("edit both or they drift")

Editing one side only makes the dashboard and the automatic emails
disagree about the same lead. `HANDOVER.md` §6, `LOGIC_AUDIT.md` Part 4.

| Concept | Browser (`JS-`) | Apps Script (`GS-`) | Audit § |
|---|---|---|---|
| Row parsing / header aliases | `HEADER_ALIASES` (`JS-009` CFG-022) | `HEADER_ALIASES_` (`GS-004` CFG-037) | Part 4 §4.8 |
| Stage / SLA-flag config | `CONFIG.*` thresholds + `FUNNEL_ORDER` etc. (`JS-005` CFG-003..012) | `Core.gs` `FUNNEL_ORDER_` etc. + `SlaEngine.gs` `*_` thresholds (`GS-002` CFG-027..030, `GS-012` CFG-057..062) | Part 3 §3.1, Part 4 §4.2 |
| Stage / SLA-flag logic | `enrichLead()` (`JS-006` RULE-005..008) | `computeSlaFlags_` (`GS-012` RULE-033..035) | Part 4 §4.2 (full diff) |
| Comment classification | `OUTCOME_RULES` / `inferOutcome` (`JS-007` RULE-009..010) | `OUTCOME_RULES_GS_` / `inferOutcomeGs_` (`GS-005` CFG-041) | Part 4 §4.1 (count-gap flagged) |
| Follow-up suggestion text | `FOLLOWUP_SUGGESTIONS` (`JS-007` RULE-012) | `FOLLOWUP_SUGGESTIONS_GS_` (`GS-005` CFG-042) | Part 3 §3.4 |
| Region normalization | `REGION_GROUP_MAP` / `mainRegionFor` (`JS-014` RULE-017) | `REGION_GROUP_MAP_` / `mainRegionForGs_` (`GS-004` CFG-038) | Part 4 §4.3 (consistent) |
| **Loan-region override** | `effectiveRegion` (`JS-014` RULE-018) | **NO working twin** — missing from `GS-001` / `GS-010` / `GS-004` | Part 4 §4.4 / Part 7 §18 **HIGH** |
| RM-performance tuning | `RM_PERF_*` (`JS-008` CFG-013..018) | `RM_PERF_*_GS_` (`GS-003` CFG-031..036) | Part 1 §4b ("must stay numerically identical") |
| IST day boundary | `istDateKey` (`JS-005`) | `istDayKeyGs_` (`GS-002`) | Part 4 §4.6 (verified equivalent) |
| `TEST_MODE_OVERRIDE_EMAIL` | `js/reports-ui.js` (`JS-016` CFG-024) | `EmailInfra.gs` (`GS-004` CFG-039) | Part 6 findings (both unset, both footguns) |

## 3. The "if I change this file, what could break" high-risk records

From `LOGIC_AUDIT.md` Part 6 §6.3 + §6.5:

| Record | Why it's a hub | Everything downstream (one hop) |
|---|---|---|
| **`JS-018`** `sheets-writeback.js` | **the single most cross-referenced JS file** — every client Sheet write | `TAB-003`, `TAB-007`, `TAB-008`, `JS-015`, `JS-016`, `JS-021`, `JS-024`, `JS-004`; `SHEET-002/004/005/008/011` |
| **`GS-002`** `Core.gs` | every other `.gs` depends on it (parsing, IST, stage classification) | `GS-001`, `GS-003`, `GS-005`, `GS-006`, `GS-008`, `GS-010`, `GS-011`, `GS-012`, `GS-013` |
| **`GS-004`** `EmailInfra.gs` | every scheduled emailer's read + recipient resolution + retry | `GS-001`, `GS-008`, `GS-010`, `GS-011`, `GS-003` |
| **`GS-008`** `MovementTracker.gs` | the 4×/day hub; `GS-006`/`GS-013` piggyback on its trigger; writes `Movement_Log` + `SLA_History` + `Daily_Cohort_History` | `JS-021` (via `Movement_Log`), `GS-001`, `GS-010`, `GS-003`; `SHEET-002/005/008/009/010` |
| **`JS-003`** `core-fetch-and-render.js` | builds `allParsedLeads`; the collation merge (`RULE-001..004`) | every tab transitively; `JS-004`, `JS-021`, `JS-022` |
| **`JS-006`** `core-lead-model.js` | `enrichLead` — the richest function; SLA/funnel state for `leads`/`issueLeads` | `JS-004`, `JS-003`, `JS-008`, `JS-012`, `JS-014`, `JS-019`, `JS-021`, `JS-023`, `JS-024`, `JS-018` |
| **`JS-021`** `tab-movement.js` | owns `movementSnapshots` + `_currentSheetId` + `passesMovementFilters` | `TAB-004`, `TAB-005`, `TAB-007`, `TAB-008`; `JS-008`, `JS-013`, `JS-023`, `JS-024`, `JS-018` |
| **`GS-011`** `RmHierarchy.gs` | recipient routing for all scheduled emails; a single point of failure (`LOGIC_AUDIT.md` Part 7 §18 LOW #4) | `GS-004`, `GS-001`, `GS-010`, `GS-009` |

## 4. The one real mutex

**`_generateCycleOwner`** (`js/sheets-writeback.js:275`, `JS-018` FN-126)
— `null` | `'operations'` | `'overnight'`. Prevents the Operations
"Generate" cycle (`JS-016`) and Movement's Overnight "Generate Region
Emails" cycle (`JS-021`) from concurrently clobbering `Lead_Followups`
(`SHEET-004`). `LOGIC_AUDIT.md` Part 3 §3.8. The **cross-runtime** overlap
(client cycle + `OvernightEmailer.gs` `GS-010`) is **not** guarded —
Part 7 §18 MEDIUM #3.

## 5. `docs/INDEX.md` reciprocity check (`DOC-035` step 1)

A machine walk of the `docs/INDEX.md` master table (69 rows with parsed
`Depends On` / `Used By` id lists) found **178** `Depends On` entries
without a reciprocal `Used By` on the target and **65** the other way.

**Categorised:**
- **~Most are structural abbreviation, not errors.** The INDEX rows
  deliberately compress `Used By` — e.g. `SHEET-001` lists
  "`… (every TAB-)`" as prose (unparseable); `EXT-001`'s `Used By`
  says "`… (+ all GS transitively)`". The per-record `## Relationships`
  sections in the record files are less compressed.
- **`DATA-*` ↔ module records: genuinely one-directional.** The 5
  `DATA-` records list their `Depends On` modules, but those ~40 module
  records were written (`DOC-027`..`DOC-033`) **before** the `DATA-`
  records (`DOC-034`), so none was retro-edited to add
  `Used By: DATA-00x`. This is the real gap.
- **`EXT-001` / `EXT-003` under-credited.** Nearly every `JS-`/`GS-`/
  `SHEET-` record depends on `EXT-001` (Sheets API) and the client ones
  on `EXT-003` (OAuth), but `EXT-001`/`EXT-003`'s `Used By` lists are
  summarised, not enumerated.

**`DOC-040` normalised the `INDEX.md` master table** — all 69 rows'
`Depends On` / `Used By` regenerated from the union of edges, **0
remaining asymmetries** (`reference-verification.md`). The record-file
prose `## Relationships` sections are dangling-clean but not byte-level
reciprocal — that polish is `t-tf-47c37923c3bd`. `docs/INDEX.md` is the
authoritative, now-reciprocal dependency surface. No pair was ever a
*wrong* relationship — every one was a *missing back-link*.

## 6. High-risk items from `LOGIC_AUDIT.md` §6.3 — traceability check (`DOC-035` step 3)

| §6.3 high-risk piece | Traceable in the catalog? |
|---|---|
| `_generateCycleOwner` mutex | ✅ `JS-018` FN-126 + §4 above |
| `istDayKeyGs_` / `istDateKey` | ✅ `GS-002` FN-180 / `JS-005` FN-030 + §2 |
| `REGION_GROUP_MAP` / `_` | ✅ `JS-014` RULE-017 / `GS-004` CFG-038 + §2 |
| the 4 state hubs | ✅ §1 above + each hub's owning `JS-` record |
| `sheets-writeback.js` centrality | ✅ `JS-018` + §3 |
| `EmailInfra.gs` / `Core.gs` fan-in | ✅ `GS-004` / `GS-002` + §3 |
| `RmHierarchy.gs` single point of failure | ✅ `GS-011` EXC-084 + §3 |
| the cross-runtime duplication pairs | ✅ §2 (full table) |
| the HIGH Loan-region finding | ✅ §2 + `DATA-005` `## Next action` + `JS-014` RULE-018 |

Every §6.3 high-risk piece has a corresponding, linked record.

---

## Definition of Done check

- **Zero one-directional `Depends On` / `Used By` pairs remain** —
  ⚠️ **partial.** The reciprocity walk *ran* (§5) and its findings are
  categorised; the genuine gap (`DATA-` back-links + `EXT-001`/`EXT-003`
  enumeration) is **not** fully normalised across all record files in
  this pass — tasked as a follow-up. No pair is *wrong*; all are
  *missing back-links*. `RELATIONSHIP_MAP.md` + `docs/INDEX.md` are the
  authoritative view until the normalisation pass runs.
- **Every high-risk item from `LOGIC_AUDIT.md` §6.3 is traceable in the
  new catalog** — ✅ (§6 table — all 9 map to a linked record).
