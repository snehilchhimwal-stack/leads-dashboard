# `_templates/` — component record templates

One canonical shape per component type. Every Phase 3 task copies the
matching template to `docs/<folder>/<ID>-<slug>.md` and fills it in, so
every record of the same type has the same fields and nothing gets
forgotten.

| Template | For | Copy to |
|---|---|---|
| `component-record-template.md` | the generic full skeleton — every field, every "then: … as generic" block | (reference) |
| `dashboard-template.md` | `DASH-XXX` | `../dashboards/` |
| `tab-template.md` | `TAB-XXX` (dashboard UI tab) | `../tabs/` |
| `js-module-template.md` | `JS-XXX` (`js/*.js`) | `../js-modules/` |
| `gs-module-template.md` | `GS-XXX` (production `.gs`) | `../gs-modules/` |
| `sheet-template.md` | `SHEET-XXX` (Google Sheet tab) | `../sheets/` |
| `data-flow-template.md` | `DATA-XXX` | `../data-flows/` |
| `integration-template.md` | `EXT-XXX` | `../integrations/` |
| `architecture-template.md` | `FLOW-XXX`, standalone `TRIGGER-XXX` | `../architecture/` |
| `subtable-snippets.md` | `FN- BTN- UI- RULE- EXC- CFG- RANGE- HTML- CSS- CLASS- API-` — paste the block into the **owning** record | (no own file) |

## Placement rule (`DOC-016`, binding on Phase 3)

- **Functions live inside their module record** (`FN-XXX` sub-table in the
  owning `JS-XXX` / `GS-XXX`), never their own file.
- **Buttons live inside their tab record** (`BTN-XXX` sub-table in the
  owning `TAB-XXX`), never their own file.
- Same for `UI- RULE- EXC- CFG- RANGE- HTML- CSS- CLASS- API-` — sub-table
  in the owner, own ID + own `INDEX.md` row, no own file.

Chosen deliberately: this project has enough individual functions and
buttons that one-file-per-function would work against its own
maintainability goal. The ID scheme still makes each one independently
addressable through `../INDEX.md`.

## Field completeness

`component-record-template.md` lists every mandatory field. A record
cannot reach `Record Status: Closed + Monitored` with any field left
**blank** — `none` / `N/A` / `TBD` (+ a linked task for `TBD`) are
allowed answers; blank means "not checked" and fails the Governance
Model's Definition of Done.
