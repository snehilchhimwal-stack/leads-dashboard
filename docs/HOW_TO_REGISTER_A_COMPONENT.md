# How to register a new component (`DOC-022`)

The process to follow the next time you add a real new dashboard tab,
JS module, `.gs` module, function, button, Sheet tab, integration, or
data flow — so the catalog doesn't start going stale the moment it's
built.

> Companion guides: **update** an existing record →
> `HOW_TO_UPDATE_A_COMPONENT.md`; **retire** one →
> `HOW_TO_RETIRE_A_COMPONENT.md`. ID rules → `NAMING_CONVENTIONS.md`.
> The automated side of this loop is the Governance Model's
> **Change-Control Mechanism** (`../DOCUMENTATION_PROJECT_PLAN.md`).

---

## The process (every component type)

1. **Assign the next unused ID** in the relevant prefix's sequence.
   Look at `../docs/INDEX.md`, find the highest `<PREFIX>-NNN` for that
   prefix, use `NNN+1` (zero-padded to 3 digits). **Never reuse a
   retired ID** — a gap is expected and fine (`NAMING_CONVENTIONS.md`).
   - Own-file prefixes: `DASH- TAB- JS- GS- SHEET- DATA- EXT- FLOW-`
     (and standalone `TRIGGER-`).
   - Sub-table prefixes (no own file, live inside the owning record):
     `FN- BTN- RULE- EXC- CFG- TRIGGER- UI- RANGE- HTML- CSS- CLASS-
     API-`.
2. **Copy the matching template** from `_templates/` to
   `<folder>/<ID>-<slug>.md` (own-file types), or paste the matching
   block from `_templates/subtable-snippets.md` into the **owning**
   record (sub-table types). Folder ↔ template map is in
   `_templates/README.md`.
3. **Fill every mandatory field.** A record cannot reach `Record
   Status: Closed + Monitored` with any field blank — `none` / `N/A` /
   `TBD` (+ a linked task for `TBD`) are allowed answers; blank is not
   (`_templates/component-record-template.md`). Set `Owner: Snehil`
   (default), `Component Status` (`Active` for a new live component),
   `Record Status` (`Drafted` until validated), `Last Verified`
   (`<date>` against `<commit>`).
4. **Add the row to `../docs/INDEX.md`** — the master table row
   (`ID | Type | Name | Location | Record Status | Depends On | Used By
   | Last Verified`), and bump the coverage snapshot at the bottom.
5. **Add reciprocal `Depends On` / `Used By` entries on every record it
   touches.** If `JS-025` depends on `JS-006`, add `JS-025` to
   `JS-006`'s `## Relationships → Used By`, and vice versa — on the
   record file **and** its `INDEX.md` row (`NAMING_CONVENTIONS.md`
   reciprocity rule; `DOC-040` verifies this automatically).
6. **Validate**, then set `Record Status: Validated` → (after the
   architecture-link + handover checks + a revalidation trigger is
   written) `Closed + Monitored`. The 14-point Definition of Done is in
   the Governance Model.
7. **If the addition was prompted by a code change**, a
   `changes/` record should exist (Governance Model DoD point 14).
8. Run `node test/check-docs-coverage.js` (or let CI) — a new `js/*.js`
   / `.gs` file that lacks a record will warn.

---

## Worked examples — one per component type

### 1. `JS-` module + its `FN-` functions

*You added `js/tab-forecast.js`, a new feature module.*

- Next `JS-` id: `INDEX.md` shows `JS-024` is the highest → **`JS-025`**.
- `cp _templates/js-module-template.md js-modules/JS-025-tab-forecast.md`.
- Fill it: `Location` `js/tab-forecast.js`; `## Load order / position`
  (where its `<script src>` sits); `## Significant functions` — grep
  the file for `^(function|async function|const)` and give each
  cross-file-called or rule-dense one an **`FN-NNN`** row (next free FN
  after `FN-254` → `FN-255`, `FN-256`, …); `## Data sources accessed`,
  `## Data written / modified`, `## Cross-runtime duplication` (`none`
  if browser-only), `## Relationships`.
- `INDEX.md`: add the `JS-025` row; add `JS-025` to the `Used By` of
  every record it depends on (e.g. `JS-006`, `JS-021`).
- If a `TAB-` renders it, cross-link both ways (see example 2).

### 2. `TAB-` + a `BTN-` inside it

*You added an "Export Forecast" button to a new Forecast tab.*

- New tab: next `TAB-` → **`TAB-009`**;
  `cp _templates/tab-template.md tabs/TAB-009-forecast.md`. Fill
  `## Owning module(s)` = `JS-025`, and add `TAB-009` to `JS-025`'s
  `Used By` (reciprocal).
- The button: **not its own file** — a **`BTN-NNN`** row (next after
  `BTN-022` → `BTN-023`) in `TAB-009`'s `## Buttons / actions` sub-table:
  `| BTN-023 | Export Forecast | #exportForecastBtn | … | FN-255 (JS-025) | no | inert in sandboxed viewer |`.
- `INDEX.md`: add the `TAB-009` row; add `BTN-023` to the `BTN-` /
  `UI-` sub-component section; add `DATA-` / `DASH-001` links.
- `DASH-001`'s `## Tabs it contains` gets a `TAB-009` line, and its
  `Depends On` gains `TAB-009`.

### 3. Adding an Operations issue card (the plan's own example)

*A new SLA check → a new card on the Operations tab.*

- The **rule**: a `RULE-NNN` row in `JS-006`'s (`core-lead-model.js`)
  `## Business rules implemented` sub-table — because `enrichLead` is
  where the flag is computed. If it's mirrored on the backend, add the
  twin `RULE-NNN` in `GS-012` (`SlaEngine.gs`) **in the same pass**
  (see `HOW_TO_UPDATE_A_COMPONENT.md`, duplicated-pair rule).
- The **render function**: an `FN-NNN` row in `JS-012`'s
  (`overview-distribution-people-ops.js`) `## Significant functions`
  (`renderNewCheckList`, next to the other `render*List` fns).
- The card has **no button** (issue cards use the `.log-toggle` `UI-`
  element) — so a `UI-NNN` row in `TAB-003`'s `## Non-button UI
  elements` if it's a new interactive element, else nothing.
- `INDEX.md`: the new `RULE-` / `FN-` / `UI-` rows; no new own-file
  record (all sub-tables).

### 4. `GS-` module + a cross-runtime `CFG-`

*You added `NewFeature.gs` with a constant that mirrors a `js/` one.*

- Next `GS-` → **`GS-014`**;
  `cp _templates/gs-module-template.md gs-modules/GS-014-newfeature.md`.
- Fill `## Trigger schedule` (exact `atHour()` / `.inTimezone()` or
  "None — called only from other `.gs` files"), `## Requires setupXxx()
  re-run when` (schedule changes only), `## Sheets touched` table,
  `## Not live until pasted` (standing reminder).
- The constant: a **`CFG-NNN`** row in `GS-014`'s `## Config constants`
  with a **`Cross-runtime twin`** column pointing at the `js/` `CFG-`,
  **and** add the reciprocal note in that `JS-` record. Add the pair to
  `RELATIONSHIP_MAP.md` §2.
- Three registrations for a new `.gs` file (`CLAUDE.md`):
  `Tests_RunAll.gs`'s `suites`, `test/run-gs-tests.js`'s file lists,
  and the live Apps Script editor paste — the doc record notes this in
  `## Not live until pasted`.

### 5. `SHEET-` (Google Sheet tab)

*A new tab `Forecast_Log` the backend writes.*

- Next `SHEET-` → **`SHEET-015`**;
  `cp _templates/sheet-template.md sheets/SHEET-015-forecast-log.md`.
- `## Columns / fields` — **transcribe from the real source constant**
  (e.g. `FORECAST_LOG_COLUMNS_`), never approximate.
- `## Writers` / `## Readers` tables; `## Data Lifecycle` — a real
  `Retention Period` (grep for a `prune*_` fn) or the literal `TBD`
  (never invented — feeds `DOC-037`); `## Risks of changing this tab's
  structure` (append-only column order, Date-vs-string coercion).
- `INDEX.md`: the `SHEET-015` row; the coverage snapshot's `SHEET-`
  count; add `SHEET-015` to the `Used By` of every writer/reader.

### 6. `EXT-` (external integration)

*You added a Slack webhook for ops alerts.*

- Next `EXT-` → **`EXT-005`**;
  `cp _templates/integration-template.md integrations/EXT-005-slack-webhook.md`.
- `## Called from` table (file:line), `## API surfaces` (`API-NNN`
  rows: call pattern, quota, retry), `## Auth mechanism`, `## Known
  failure modes`, `## Rate-limit / retry behaviour`.
- Check `dashboard.html`'s `<head>` if it's a browser CDN script;
  record it in `integration-inventory.md` too (`DOC-011`).

### 7. `DATA-` (a traced data flow)

*A new "forecast pipeline" worth tracing end-to-end.*

- Next `DATA-` → **`DATA-006`**;
  `cp _templates/data-flow-template.md data-flows/DATA-006-forecast-pipeline.md`.
- `## Origin` / `## Transformation` (each step + the `FN-` that does
  it) / `## Stored As` / `## Display` / `## Ultimate consumer(s)` /
  `## Retention` (**point at the owning `SHEET-` record, don't restate**)
  / `## What happens on update` / `## What happens on delete` /
  `## Known gaps`.
- `## Relationships → Depends On` must resolve to **already-created**
  `JS-`/`GS-`/`SHEET-` IDs — and add `DATA-006` to each of their
  `Used By`.

### 8. `DASH-` (a whole new dashboard) — rare

*Only if a genuinely separate page/app is added, not a new tab.*

- Next `DASH-` → **`DASH-002`**;
  `cp _templates/dashboard-template.md dashboards/DASH-002-<name>.md`.
- Fill `## Entry points`, `## Tabs it contains` (its own `TAB-` set),
  `## Top-level buttons / actions`, `## What should / should not be
  changed`, `## Known limitations`.
- Re-read `dashboard-inventory.md` (`DOC-004`) — the "one dashboard"
  decision means this is a real architectural change; `HANDOVER.md`
  §1–§3 must be updated in the same commit.

### (bonus) `FLOW-` / `TRIGGER-` (standalone architecture record)

*A cross-file workflow or a trigger that deserves its own record
rather than living inside one `GS-`.*

- Next `FLOW-` / `TRIGGER-` →
  `cp _templates/architecture-template.md architecture/FLOW-001-<name>.md`.
- Used for things like the 4×/day Movement hub + its piggyback loggers,
  or the 3-phase Generate cycle spanning `JS-016` / `JS-018` / `GS-010`.

---

## Definition of Done check (`DOC-022`)

- **One worked example exists for each of the 8 component types** — ✅
  (`JS-`, `TAB-`, `GS-`, `SHEET-`, `EXT-`, `DATA-`, `DASH-`, plus the
  `FLOW-`/`TRIGGER-` architecture type; sub-table types `FN-`/`BTN-`/
  `RULE-`/`CFG-`/`UI-` are shown inside examples 1–4).
