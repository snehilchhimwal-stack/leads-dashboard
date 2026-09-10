# Reciprocity normalisation — what was done

**Task:** `t-tf-47c37923c3bd` — "docs/: normalise Depends On / Used By
reciprocity across all component records".
**Done:** 2026-09-10 in two passes — (1) additive (every record brought up
to a superset of its `INDEX.md` row), then (2) **prune** (Snehil's call:
every record's `Depends On` / `Used By` aligned to **exactly** its
`INDEX.md` row; the 57 record-only edges in §3 removed).

**Final state (verified `recip_verify.py`): 69/69 records' `Depends On` /
`Used By` == their `INDEX.md` row exactly; 0 one-directional pairs across
the record set.** `## Related` bullets, inline `` `ID` (annotation) ``
notes, and accurate summary tails ("— every other production `.gs`") were
kept; 3 annotations that named a since-pruned ID were reworded
(`GS-006`/`GS-013` "same pattern as", `JS-021` "via FN-148"). `INDEX.md` /
`LOGIC_AUDIT.md` not touched. §3 below is retained as the record of what
was pruned and why.

---

## 1. What this pass did (safe, additive, no information removed)

`docs/INDEX.md`'s master table was made internally reciprocal by `DOC-040`
(`79ce29d`) — 0 asymmetries. The 69 component **record files** were
written in Phase 3 (`DOC-025`..`DOC-034`), mostly *before* the `DATA-`
records, so their `## Relationships → Depends On / Used By` bullets never
got the reciprocal back-links `DOC-040` later put in `INDEX.md`.

This pass walked every record file and **added every `Depends On` /
`Used By` id that its `INDEX.md` row has but the record was missing** —
nothing was removed, `## Related` bullets and all other prose were left
untouched, and `LOGIC_AUDIT.md` / `INDEX.md` were not touched.

- **53 of 69 record files updated.**
- Back-links added: **+57 `Depends On`, +171 `Used By`** entries.
- Verified after: every record's `## Relationships` is now a **superset
  of its `INDEX.md` row** (`recip_analyze.py` → "+0 / +0 to add"), so the
  authoritative `INDEX.md` edge set is now fully reciprocal in the record
  files too.
- Inline `` `ID` (annotation) `` notes were preserved per side (a
  depends-side note is not bled onto the used-by side); vague tails
  ("and more", "…") were dropped once the list became complete.
- The two named categories from `RELATIONSHIP_MAP.md` §5 are fully
  covered: (a) `DATA-00x` back-links now sit on every `JS-`/`GS-`/`SHEET-`
  record they touch; (b) `EXT-001` (Sheets API) and `EXT-003` (OAuth)
  `Used By` lists are now enumerated, not summarised.

Scripts: `../../<scratch>/recip_apply3.py` (this additive pass, applied)
and `recip_apply4.py` (the prune alternative in §3, **not** applied).

---

## 2. Result you can rely on now

**Every edge that `docs/INDEX.md` asserts is reciprocal in both record
files.** `INDEX.md` remains the single authoritative dependency surface;
the record files no longer lag it.

---

## 3. The 57 record-only edges — PRUNED 2026-09-10

These edges existed **in a record file but not in `INDEX.md`**. Snehil's
decision: **prune them** — `INDEX.md`'s "immediate next-hop" model wins,
so every record now matches its `INDEX.md` row exactly. This section is
kept as the record of *what was removed and why*; if any specific edge
should come back, add it to **both** ends (record + `INDEX.md` row).

Every one fell in a category below. **None was a factually wrong
relationship** — the question was only *at what depth the catalog models
it*; the answer chosen is "as `INDEX.md` models it".

### 3a. `DATA-` flow records list transitive consumers; `INDEX` lists the immediate next hop (37 edges)

| Record | Side | Record-only edges |
|---|---|---|
| `DATA-001` | Used By | `TAB-002`, `TAB-003`, `TAB-005`, `TAB-006` |
| `DATA-002` | Used By | `TAB-003`, `TAB-004`, `TAB-008` |
| `DATA-003` | Used By | `TAB-005`, `TAB-006`, `TAB-007` |
| `DATA-004` | Used By | `GS-003`, `GS-010`, `JS-013`, `JS-017`, `JS-023`, `JS-024`, `TAB-005`, `TAB-007`, `TAB-008` |
| `DATA-005` | Depends On | `GS-004`, `GS-010`, `GS-011`, `JS-015`, `JS-016`, `JS-018`, `SHEET-006`, `SHEET-007`, `SHEET-012` |
| `DATA-005` | Used By | `SHEET-013`, `SHEET-014` |

`INDEX.md` models a `DATA-` flow as pointing only at the `SHEET-`/module
it directly lands in or is directly aggregated by; the downstream
consumers are then listed on **that `SHEET-`/module** record (and they
are). The record authors instead listed the full transitive consumer set
on the flow itself.

### 3b. `DASH-001` lists everything it transitively touches; `INDEX` lists direct children only (9 edges)

`DASH-001 Depends On` record-only: `EXT-002`, `EXT-003`, `EXT-004`,
`JS-024`, `SHEET-002`, `SHEET-004`, `SHEET-005`, `SHEET-006`, `SHEET-008`.

> `DASH-001`'s record was **left as-is** by this pass (only `DATA-001`
> was added) — its `Depends On` uses the range `` `JS-001`..`JS-024` ``
> and the automated additive rewrite would have flattened that to the 4
> `JS-` ids `INDEX.md` names. A naive id scan of `` `JS-001`..`JS-024` ``
> sees only `JS-001` + `JS-024`, so `recip_analyze.py` still reports
> "`+2 Depends On`" for `DASH-001` (`JS-003`, `JS-004`) — a **false
> positive**; both are inside the range. Resolve when you settle 3b.

`INDEX.md` models `DASH-001` as depending on its 8 `TAB-`, the 3 entry
`JS-` (`JS-001/003/004`), `SHEET-001` (`leads`), `SHEET-011` (`Send_Log`,
shown on the page), `EXT-001`, `DATA-001` — Gmail / jsPDF / the other
sheets are reached through the tabs, and are already on those tab /
`EXT-` records.

### 3c. Spurious / wrong-direction — `INDEX` is right, the record over-reached (11 edges)

| Record | Side | Edge | Why it should go |
|---|---|---|---|
| `GS-006` | Used By | `GS-013` | neither calls the other; both are `GS-008` (`snapshotOpenLeads_`) piggybacks — belongs in `## Related`, and the annotation already says "same pattern as `GS-013`" |
| `GS-013` | Used By | `GS-006` | mirror of the above |
| `EXT-001` | Used By | `GS-004`, `GS-008`, `GS-011` | `INDEX` models the Sheets API as used directly only by `GS-002` (`Core.gs` wraps `SpreadsheetApp`); the rest reach it through `GS-002` |
| `JS-016` | Used By | `JS-018`, `JS-021` | wrong direction — `JS-016` *depends on* `JS-018`; and its own annotation says `JS-021` "reuses the `JS-018` writeback functions, **not this module** directly" |
| `JS-020` | Used By | `JS-011`, `JS-023` | `main.js` / `tab-rmtimeline` do not consume `tab-morning` |
| `SHEET-002` | Used By | `TAB-005` | the People tab does not read `Movement_Log` directly (`JS-023` does) |
| `TAB-006` | Used By | `TAB-005` | a `TAB-` is only ever "used by" `DASH-001`; shared render helpers live on the `JS-` modules |
| `TAB-007` | Used By | `JS-013`, `TAB-004`, `TAB-005`, `TAB-008` | same — conflates the tab with `JS-021`'s shared `movementSnapshots` state |
| `TAB-008` | Used By | `TAB-005` | same |
| `TAB-001` | Depends On | `JS-004`, `JS-009` | Morning Brief reaches these through `JS-012`; it has "no new logic" (`HANDOVER.md`) |

---

## 4. Decision taken — Option A (prune)

Snehil chose to **keep `INDEX.md`'s "immediate next-hop" model** and prune
the records to match (2026-09-10). Rationale: simpler to maintain — a
`DATA-` flow that points only at the `SHEET-` it lands in never needs
re-editing when a 9th consumer tab is added; only that `SHEET-` record
does. All 57 edges in §3 (§3a transitive-consumer over-listing, §3b
`DASH-001` whole-system listing, §3c spurious/wrong-direction) were
removed. The alternative (expand `INDEX.md` to the full transitive set via
a `DOC-040`-style union regen) was not taken.

Applied with `<scratch>/recip_apply4.py --apply` + 4 manual touch-ups
(`EXT-003` mid-list prose, `JS-005` `none —` tail, and the 3 reworded
annotations). Verified: `recip_verify.py` → 69/69 records == `INDEX.md`,
0 one-directional pairs.

Pointers updated: `OPEN_ITEMS.md` §E, `RELATIONSHIP_MAP.md` §5,
`FORENSIC_COMPLETENESS_AUDIT_2026-09-10.md` (P1 item 8).
