# JS-009 — core-sheets-fetch.js

| | |
|---|---|
| **Type** | `JS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `js/core-sheets-fetch.js` (183 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

The one literal Sheets API v4 GET call in the app lives here
(`sheetsApiValuesGet`), together with the `HEADER_ALIASES` column-mapping
table that lets the parser survive header-name variation, and a
gviz-shape adapter so downstream parsing (written for an older Sheets
endpoint) never had to be rewritten. It also **declares** the core
parsed-lead state (`leads`, `issueLeads`, `allParsedLeads`,
`filterState`) — declared here, written elsewhere. It exists so there is
exactly one place a Sheets read is issued and one place the column
vocabulary is defined.

## Responsibilities

- `HEADER_ALIASES` — the canonical column → accepted-header-name map.
- Declare `leads` / `issueLeads` / `allParsedLeads` / `filterState`
  (module-scope globals).
- `sheetsApiValuesGet(sheetId, range)` — the raw v4 GET.
- `valuesToGvizShape` / `gvizCellRaw` / `gvizCellDate` /
  `serialToGvizDateString` — adapt v4 rows into the gviz shape the
  parser expects.
- `extractSheetId(raw)` — pull an ID out of a pasted URL.

## Load order / position

Second in the real order (`core-foundation → **core-sheets-fetch** →
core-auth → …`). CLAUDE.md's documented list pair-swaps it with
`core-auth` (`LOGIC_AUDIT.md` Part 1 §4a — harmless).

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-065 | `sheetsApiValuesGet(sheetId, range)` `#L100` | sheet ID, A1 range | the v4 `values` payload | one `fetch` with `Authorization: Bearer ${gateAccessToken}`, `valueRenderOption=UNFORMATTED_VALUE`, `dateTimeRenderOption=SERIAL_NUMBER`; throws `{status}` on `!resp.ok` | `gateAccessToken` (`JS-001`, read by name `#L103`) | `fetchAndRender` (`JS-003`), `fetchMovementLog` (`JS-021`), `fetchRmHierarchyForRollup` (`JS-022`), `core-filters.js` | reusable — the one Sheets read |
| FN-066 | `valuesToGvizShape(values, isDateColumnLabel)` `#L138` | v4 `values`, a date-column predicate | `{cols, rows}` gviz-shaped | none | `serialToGvizDateString` (FN-068) | `fetchAndRender` (`JS-003`), Movement/RM-hierarchy parsers | reusable |
| FN-067 | `gvizCellRaw(cell)` / `gvizCellDate(cell)` `#L162/#L167` | a gviz cell | raw value / a `Date` | none | `parseDate` (`JS-006`) | row parsers across modules | reusable |
| FN-068 | `serialToGvizDateString(serial)` `#L123` | a Sheets serial number | a gviz `Date(...)` string | none | — | FN-066 | reusable |
| FN-069 | `extractSheetId(raw)` `#L87` | a pasted URL or bare ID | the sheet ID | none | — | `fetchAndRender` (`JS-003`), `#changeSourceBtn` handler | reusable |

## Config constants — `CFG-XXX` sub-table

| ID | Constant | Value | Meaning | Changing it affects |
|---|---|---|---|---|
| CFG-022 | `HEADER_ALIASES` `#L17` | column → `[accepted header names]` map (`lead_id`, `RM`, `TL`, `project`, `region`, `project_region`, `group_source`, `source_bucket`, `current_stage`, `call_attempts`, `call_count`, `duration`, …) | the parser's column vocabulary — tolerant of header-name variation | every field `enrichLead` / renderers read; **twin `HEADER_ALIASES_` on the backend** (`EmailInfra.gs`) — `LOGIC_AUDIT.md` Part 4 §4.8 |

## State declared here (written elsewhere)

| Symbol | `#L` | Declared as | Written by | Read by |
|---|---|---|---|---|
| `leads` | `#L68` | `let leads = []` | `applyFiltersAndRender` (`JS-004`) | every tab renderer |
| `issueLeads` | `#L75` | `let issueLeads = []` | `applyFiltersAndRender` (`JS-004`) | Operations, reports, Morning |
| `allParsedLeads` | `#L76` | `let allParsedLeads = []` | `fetchAndRender` (`JS-003` `#L566`) | `JS-004`, `JS-021`, `JS-023` |
| `filterState` | `#L83` | `const filterState = {project,region,source,TL,bucket: Set}` | `buildMultiSelect` callbacks (`JS-004`) | `JS-004`, Movement/Repeat-Offenders filters |
| `_lastCrossRegionCollations` | `#L82` | `let` | `fetchAndRender` (`JS-003`) | the cross-region collation notice |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-016 | `sheetsApiValuesGet` response not ok | `throw { status }` — caller (`JS-003`) maps 403→`ACCESS_DENIED`, 404→`NOT_FOUND` | one of the two distinct error banners |
| EXC-017 | empty `values` array | `valuesToGvizShape` returns `{cols:[], rows:[]}` `#L139` | render proceeds with zero leads, no crash |

## Data lineage

`SHEET-001` / `SHEET-002` / `SHEET-006` (Google Sheet) → `EXT-001`
(Sheets API v4) → `sheetsApiValuesGet` (FN-065) → `valuesToGvizShape`
(FN-066) → gviz rows → `HEADER_ALIASES` column map → parsed rows handed
to `JS-003`. Persists nothing.

## Data sources accessed

`SHEET-001` (`leads`) and, via other modules calling `sheetsApiValuesGet`,
`SHEET-002` / `SHEET-005` / `SHEET-006`. Auth: `gateAccessToken`
(`JS-001`). Integration: `EXT-001`.

## Data written / modified

No Sheet writes. Declares the state that `JS-003` / `JS-004` write.

## Failure / error behaviour

The one read call throws a `{status}` object on failure — deliberately
minimal so the caller decides the message. No retry here (the client has
no `withRetry_` equivalent).

## Cross-runtime duplication

`HEADER_ALIASES` ↔ `HEADER_ALIASES_` on the backend (`EmailInfra.gs`).
The remaining diff is small and audited in `LOGIC_AUDIT.md` Part 4 §4.8;
the **known gap** is `project_region` missing from the backend map,
feeding the HIGH Loan-region finding (`LOGIC_AUDIT.md` Part 4 §4.4).

## UI relationships

No buttons. `extractSheetId` backs `#sheetIdInput` / `#changeSourceBtn`
(`DASH-001`).

## Architecture relationship

`DASH-001`. Layer 3 (client fetch) + layer 8 (state — declares the
canonical arrays) in `LOGIC_AUDIT.md` Part 1 §1.

## Related documentation

`HANDOVER.md` §2, §3 step 2, §4.1 (Sheet access); `LOGIC_AUDIT.md` Part 1
§1 layers 3/8, §4b, Part 4 §4.4/§4.8.

## Relationships

- **Depends On:** `JS-001` (`gateAccessToken`), `JS-005`
  (`istWallToInstant`), `JS-006` (`parseDate`), `EXT-001`, `SHEET-001`
- **Used By:** `JS-003`, `JS-004`, `JS-021`, `JS-022`, and virtually
  every tab/report file (reads the state it declares)
- **Related:** `GS-004` (`EmailInfra.gs` — holds `HEADER_ALIASES_`, the
  backend twin, and `readLeadsTab_`, the backend read)

## Source of truth

`js/core-sheets-fetch.js` at `HEAD`.

## Validation

- **Method:** full read at `c82ec67`; function + `HEADER_ALIASES` +
  state-declaration list verified by grep; cross-check `LOGIC_AUDIT.md`
  Part 1 §4b + Part 4 §4.8. `tests/frontend-harness.html` mocks
  `sheetsApiValuesGet` at exactly this boundary and runs the real
  `valuesToGvizShape` / `HEADER_ALIASES` parse.
- **Evidence:** `LOGIC_AUDIT.md` Part 4 §4.8; `tests/frontend-harness.html`
  (mock point).
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-027.

## Revalidation trigger

Any commit touching `js/core-sheets-fetch.js`; `HEADER_ALIASES` gains /
loses a column (check the `HEADER_ALIASES_` twin — `LOGIC_AUDIT.md` Part
4 §4.8); the Sheets API request options change; the declared state
symbols change name or shape; a new module starts calling
`sheetsApiValuesGet`.

## Handover relationship

`HANDOVER.md` §2 names the file; §3 step 2 covers the read+parse;
§4.1 covers Sheet access. Current as of 2026-09-09. A `HEADER_ALIASES`
change must update `HANDOVER.md` §6 (it is a duplication pair) and the
backend twin in the same commit.

## Lifecycle / retention

N/A — code. All state is in-memory, rebuilt each fetch.

## Next action

none — Closed + Monitored.

## Closure evidence

Record committed for DOC-027; `docs/INDEX.md` `JS-009` → `Closed +
Monitored`, `Last Verified` 2026-09-10, links filled; `CFG-022`,
`EXC-016`/`017` recorded. No `docs/changes/` record (DOC-027).
