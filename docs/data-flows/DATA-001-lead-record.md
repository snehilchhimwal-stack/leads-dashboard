# DATA-001 — The core lead record

| | |
|---|---|
| **Type** | `DATA-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | traced path — not a file |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

The spine every other flow branches off: how one raw CRM row becomes the
enriched, collated lead object the whole dashboard renders. Traced here
once so the component records don't each re-explain it.

## Origin

`SHEET-001` (`leads` tab) — one row per RM copy of a lead, from the
external CRM export. Read via `EXT-001`.

## Transformation

1. `sheetsApiValuesGet` (`JS-009` FN-065) → raw values.
2. `valuesToGvizShape` + `HEADER_ALIASES` (`JS-009` FN-066 / CFG-022) →
   column-mapped rows.
3. Union-find identity match — same `lead_id` OR same `client_id` +
   similar region, transitively (`JS-003` FN-017, `RULE-001`).
4. `mergeRowsIntoOneLead` (`JS-003` FN-016) — furthest-progressed stage;
   `call_attempts`/`call_count`/`duration` by **MAX not SUM**
   (`RULE-002`); `collatedFrom` = distinct `lead_id` count (`RULE-003`);
   closed only if every copy is closed (`RULE-004`).
5. `enrichLead` (`JS-006` FN-034) applied per `filterState` in
   `applyFiltersAndRender` (`JS-004` FN-021) → derived SLA/funnel state.
6. Display formatting via `JS-002` (`collationBadge`, `leadIdentityLine`).

## Stored As

In-memory only: `allParsedLeads` (post-collation, pre-enrich; `JS-009`
declared, `JS-003` `#L566` written), then `leads` (customer-deduped) /
`issueLeads` (copy-expanded) after `enrichLead`. **Never persisted back
to a Sheet.**

## Display

Every tab: `TAB-002` (KPIs / breakdowns), `TAB-003` (issue cards),
`TAB-005` (RM tables + RM Timeline), `TAB-006` (Audit event lists),
`TAB-001` (Morning Brief). Rendered by `renderAll()` (`JS-012` FN-077).

## Ultimate consumer(s)

A human on screen. Also the input to `DATA-002` (SLA flags), `DATA-003`
(comment classification), `DATA-005` (region emails).

## Retention

N/A — not persisted. Rebuilt from scratch on every `fetchAndRender`
(`JS-003`). The source `SHEET-001` has its own (`TBD`, `DOC-036`)
retention governed by the CRM export.

## What happens on update

A changed `leads` row is picked up on the **next `fetchAndRender`**
(user clicks refresh, or the sign-in callback). No live sync — the
dashboard shows "as of last fetch." Filter changes re-run `enrichLead`
over the already-fetched `allParsedLeads` without re-reading the Sheet.

## What happens on delete

A row removed from `leads` simply doesn't appear after the next fetch —
silently dropped, no error. A previously-collated family loses that
copy; `collatedFrom` drops accordingly on the next merge.

## Known gaps

- The collation merge is internal to `fetchAndRender` and not exported —
  no independent test of the merge in isolation (`LOGIC_AUDIT.md` Part 1
  §1 layer 5).
- `project_region` is read here but **not** carried into `Movement_Log`
  (`SHEET-002`), which is why the Loan override is reduced downstream
  (`DATA-004` / `DATA-005` known gaps).

## Exceptions & error handling

403/404 on the read → `ACCESS_DENIED` / `NOT_FOUND` banners (`JS-003`
EXC-004/005). A malformed row is parsed best-effort and kept.

## Architecture relationship

`DASH-001`. Spans `LOGIC_AUDIT.md` Part 1 §1 layers 3, 5, 6, 9, 10.

## Related documentation

`HANDOVER.md` §3 steps 2–3; `LOGIC_AUDIT.md` Part 1 §1/§2, Part 2 §1
(field trace), §2 (initial-load Mermaid).

## Relationships

- **Depends On:** `SHEET-001`, `EXT-001`, `JS-009`, `JS-003`, `JS-006`,
  `JS-004`, `JS-002`, `JS-005`
- **Used By:** `DATA-002`, `DATA-003`, `DATA-005`; `TAB-001`, `TAB-002`,
  `TAB-003`, `TAB-005`, `TAB-006`; `DASH-001`
- **Related:** `DATA-004` (the persisted-snapshot counterpart of this
  in-memory flow)

## Source of truth

`js/core-fetch-and-render.js` `fetchAndRender` `#L27`; `js/core-lead-model.js`
`enrichLead` `#L202`; `js/core-sheets-fetch.js` `HEADER_ALIASES` `#L17`.

## Validation

- **Method:** traced against `LOGIC_AUDIT.md` Part 2 §1/§2 + the `JS-003`
  / `JS-006` records at `c82ec67`. Exercised end-to-end by
  `tests/frontend-harness.html` (synthetic leads incl. multi-copy
  families through the real `fetchAndRender`).
- **Evidence:** `LOGIC_AUDIT.md` Part 2 §1/§2; `tests/frontend-harness.html`.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by `DOC-034`.

## Revalidation trigger

`fetchAndRender`'s collation rules (`RULE-001`..`004`), `HEADER_ALIASES`,
the `allParsedLeads` / `leads` / `issueLeads` shape, or `enrichLead`'s
output changes.

## Handover relationship

`HANDOVER.md` §3 steps 2–3 describe this pipeline. Current as of
2026-09-09. A pipeline-order or collation-rule change must update
`HANDOVER.md` §3 in the same commit.

## Lifecycle / retention

N/A — in-memory, rebuilt every fetch. See `SHEET-001` for the source's
retention (`TBD`, `DOC-036`).

## Next action

none — Closed + Monitored.

## Closure evidence

Record committed for `DOC-034`; `docs/INDEX.md` `DATA-001` row →
`Closed + Monitored`; `Depends On` resolves entirely to existing
`SHEET-`/`JS-` IDs. No `docs/changes/` record (`DOC-034`).
