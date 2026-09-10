# Naming Conventions & Component ID Scheme

The single reference every record and cross-reference in this catalog
uses. Built by `DOC-015` (+ the relationship rule from `DOC-017`), to the
**extended Governance Model taxonomy** (see
`../DOCUMENTATION_PROJECT_PLAN.md` → Governance Model → "Component ID
Taxonomy (extended)"), not the original 9-prefix list.

---

## ID format

`<PREFIX>-<NNN>` — a prefix from the table below, then a **zero-padded
3-digit number** (`JS-001`, `SHEET-014`, `RULE-007`).

- Numbers are assigned **in first-documented order** within each prefix.
- A retired ID is **never reused**. A gap in a sequence is expected and
  fine (see `HOW_TO_RETIRE_A_COMPONENT.md`, `DOC-024`).
- The number carries no meaning beyond identity — `JS-001` is not "more
  important" than `JS-020`, just documented earlier.

---

## Prefix table

| Prefix | Covers | Record lives as |
|---|---|---|
| `DASH-` | A whole dashboard / app | Own file in `dashboards/` |
| `TAB-` | A **dashboard UI** tab / page / view — explicitly **NOT** a Google Sheet tab | Own file in `tabs/` |
| `JS-` | A client-side `js/*.js` module | Own file in `js-modules/` |
| `GS-` | An Apps Script `.gs` backend module | Own file in `gs-modules/` |
| `SHEET-` | A **Google Sheet** tab — explicitly **NOT** a dashboard UI tab | Own file in `sheets/` |
| `DATA-` | A traced data flow (origin → transform → storage → consumer) | Own file in `data-flows/` |
| `EXT-` | An external integration / API (Sheets API, Gmail, jsPDF, OAuth) | Own file in `integrations/` |
| `FLOW-` | A cross-file workflow spanning several `JS-`/`GS-`/`SHEET-` records (e.g. "overnight email generation"). Broader than `DATA-`'s pure lineage | Own file in `architecture/` |
| `FN-` | A significant function | **Sub-table inside its owning `JS-`/`GS-` record** — not its own file |
| `BTN-` | A button / user action | **Sub-table inside its owning `TAB-` record** |
| `RULE-` | A named business rule / decision (RM Performance shrinkage formula, leadership-exclusion criteria) — distinct from the function that implements it | **Sub-table inside the record that owns the rule** (usually a `JS-`/`GS-` module or a `FLOW-`) |
| `EXC-` | A named exception / failure mode + its handling | **Sub-table inside the record where it can occur** |
| `CFG-` | A configuration constant with real operational weight (`RM_PERF_MIN_VOLUME_LEADS`, `CONFIG.LEAD_GRACE_HOURS`, a trigger's `nearMinute` pin) | **Sub-table inside its owning `JS-`/`GS-`/`TRIGGER-` record** |
| `TRIGGER-` | An Apps Script time-based / event trigger — schedule, target function, `setupXxx()` owner | Own file in `architecture/` (small; or a sub-table inside the owning `GS-` record if there's only one) |
| `UI-` | A non-button UI element with real behaviour (a filter multi-select, a modal, a chart). Buttons stay `BTN-` | **Sub-table inside its owning `TAB-` record** |
| `RANGE-` | A specific critical cell range within a `SHEET-` where the range, not the whole tab, is the meaningful unit (a header-row banner, a lookup range) | **Sub-table inside its owning `SHEET-` record** |
| `HTML-` | A distinct structural region of `dashboard.html` itself (not every `<div>`) | Own file in `dashboards/` (or a sub-table inside `DASH-001`) |
| `CSS-` | A named non-trivial style concern (a component's visual system, not every selector) | Sub-table inside `DASH-001` or the relevant `TAB-` record |
| `CLASS-` | A real reusable JS class / constructor. This codebase is mostly function-based — expect few, possibly zero | Sub-table inside its owning `JS-` record |
| `API-` | A specific API *surface* beyond "the whole integration" `EXT-` already covers (one call pattern with its own quota / retry behaviour). Likely folds into `EXT-` in practice — an escape hatch, not a mandate to split | Sub-table inside the owning `EXT-` record |

`DOC-` is **not** in this list — it is the To-Do Dashboard's own
Documentation-Project *task* numbering (`DOC-001..050`). A documentation
file that itself needs a component record uses the `architecture/` folder
or folds into `DASH-001`'s "Related Documentation" — never a `DOC-` ID.

### The one collision this scheme resolves, stated plainly

**"Tab" means two different things in this project.** A *dashboard UI
tab* (Overview, Operations, Repeat Offenders, …) is a `TAB-`. A *Google
Sheet tab* (`leads`, `Movement_Log`, `Daily_RM_Issues`, …) is a
`SHEET-`. They are never the same record and never share a prefix.

---

## Threshold — what earns its own record vs. a sub-table

A thing gets its **own file** (a `DASH-`/`TAB-`/`JS-`/`GS-`/`SHEET-`/
`DATA-`/`EXT-`/`FLOW-` record) when it is a structural container someone
navigates *to*.

A thing gets a **sub-table inside another record** (`FN-`/`BTN-`/`RULE-`/
`EXC-`/`CFG-`/`UI-`/`RANGE-`/`CSS-`/`CLASS-`/`API-`) when it is a unit
*within* a container. It still gets its own stable ID and a row in
`INDEX.md`, so it stays independently addressable — it just doesn't get
its own file, to avoid a 150+-file explosion that would itself hurt
maintainability.

A thing gets **no ID at all** — documented only as prose inside its
owner's "Important Logic" / "Exceptions" fields — when **none** of these
hold:

1. It has its own real failure mode someone would need to look up.
2. It is referenced from more than one other component.
3. It has non-obvious business logic a reader could not infer from its
   name alone.
4. It has its own lifecycle / retention / ownership distinct from its
   container.

A single `<div>`, a single CSS selector, a one-line helper called from
exactly one place, a routine log-and-continue `catch` — none clear the
bar.

---

## Prefixes defined but with zero instances (`t-tf-5ad22d8e4c2e`, 2026-09-10)

Four prefixes exist in the taxonomy for completeness but **have no
instance today**, deliberately — not a coverage gap:

| Prefix | Why zero, and when to add one |
|---|---|
| `RANGE-` | Every `SHEET-` tab is a flat append-only data table written whole-row by Apps Script or the CRM export. **No named cell range, lookup range, or header banner carries behaviour that the whole-tab `SHEET-` record doesn't already cover.** Add a `RANGE-` only if a future feature makes one specific range (a config block, a formula-driven lookup) the meaningful unit. |
| `HTML-` | `DASH-001`'s `## HTML / CSS structure` section covers `dashboard.html`'s shell as one unit; no single structural region has its own failure mode / multi-referrer / non-obvious logic (the §"no ID at all" bar). Add an `HTML-` only if one region grows its own documented behaviour. |
| `CSS-` | The dark-theme custom-property system is described in `DASH-001`; no single style concern clears the bar. |
| `CLASS-` | This codebase is function-based — `grep -nE '^\s*class \|new [A-Z]\w+\(' js/*.js` finds only `new Worker()` (an `EXT`/`FLOW` concern, not a project class). Add a `CLASS-` if a real reusable constructor is introduced. |

**Sheet formulas / data-validation / filter views:** none are documented
because **none was found** — `LOGIC_AUDIT.md` Part 1 §1 describes every
tab as a flat data table, and no `.gs` / `js` code reads or writes a cell
*formula* (all writes are literal values via `appendRow` / `setValues` /
the Sheets API `RAW`/`USER_ENTERED` value path). The live Google Sheet
was **not** inspected cell-by-cell; if a maintainer finds a
behaviourally-significant formula, named range, or filter view, add a
`RANGE-` sub-table row to the owning `SHEET-` record.

---

## Relationships & the reciprocity rule (`DOC-017`)

Every record has a `## Relationships` section with three fixed
sub-fields, **all lists of IDs** (not prose):

- **`Depends On:`** — IDs this component needs to function.
- **`Used By:`** — IDs that depend on this one.
- **`Related:`** — IDs relevant but not a hard dependency (e.g. shared
  helper, sibling feature).

**Reciprocity rule:** adding `Depends On: JS-014` to one record
*obligates* adding `Used By: <this ID>` to `JS-014`'s record **in the
same edit**. A one-directional link is a defect. `DOC-040` (Phase 5)
verified every link; `test/check-catalog.py` A now enforces it on every
push.

**Exception — architecture overlays.** A `FLOW-` / `TRIGGER-` record
lists its participants in `Depends On` (which must resolve — no
dangling), but is **not** reciprocated: it carries `Used By: none`, and
its participants do **not** gain `Used By: <the FLOW>`. An overlay is a
view *across* components, not a dependency they know about — the same
reason `HANDOVER.md` references everything without the reverse. The
reciprocity rule above governs the own-file component rows
(`DASH`/`TAB`/`JS`/`GS`/`SHEET`/`EXT`/`DATA`) only. (`t-tf-5ad22d8e4c2e`,
2026-09-10.)

`Used By: none` is a valid, meaningful answer (a leaf component, or an
output with no consumer — the latter is a finding, per the Governance
Model's Dead-End Register). A **blank** `Used By:` is not — it means
"not yet checked."

---

## `Owner:` default

Every record's `Owner:` defaults to **`Snehil`** until a real per-component
ownership assignment exists (this is the Governance Model's decision; it
overrides the original `DOC-020` "default TBD" wording — a blank/TBD owner
invites "nobody's job" on every gap). Whether to introduce a real
multi-owner assignment is a maintainer decision, out of scope for the
documentation project to make unilaterally.

---

## `Status` — two axes, not one

Each record carries **two** status fields, tracking different things:

- **`Record Status:`** — the documentation's own validity, per the
  Governance Model's 7-state model:
  `Not Started` → `Drafted` → `Validated` → `Closed + Monitored` →
  (`Stale` → `Reopened` → back to `Closed + Monitored`), and `Retired`.
  `Closed + Monitored` is the only "done" state and is **not terminal** —
  a record can drop back to `Stale` any time its Revalidation Trigger
  fires.
- **`Component Status:`** — the real-world state of the *thing* itself:
  `Active` / `Deprecated` / `Planned` / `Retired`.

A record can be `Record Status: Closed + Monitored` while its
`Component Status: Deprecated` — the docs are current and correct, and
what they correctly describe is a deprecated component.
