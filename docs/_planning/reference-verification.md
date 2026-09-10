# Cross-reference verification (`DOC-040`)

**Produced:** 2026-09-10, against `docs/` at commit `a121a7b` (checks) →
normalisation committed on top.
**Purpose:** confirm every `Depends On` / `Used By` / `Related` ID in the
catalog resolves to a real record, and that no relationship is
one-directional. (`DOCUMENTATION_PROJECT_PLAN.md` Phase 5, `DOC-040`;
follow-up rule: **fix found issues immediately as part of this task**.)

---

## 1. Dangling references — **ZERO**

Extracted every `(DASH|TAB|JS|GS|SHEET|EXT|DATA|FLOW|TRIGGER)-NNN` ID
from the `## Relationships` section of **all 69 record files** and
checked each against the set of real own-file records + `INDEX.md` rows.

**Result: 0 dangling references.** Every ID mentioned in any record's
`Depends On` / `Used By` / `Related` resolves to a real record. No
`FLOW-` / `TRIGGER-` records exist yet and none is referenced.

*(The 7 folder `README.md` files have no `## Relationships` section —
expected, they are not records.)*

## 2. Reciprocity — `INDEX.md` master table normalised to **ZERO one-directional pairs**

### Before

The machine check (same as `RELATIONSHIP_MAP.md` §5, re-run after
Phase 4's `SHEET-XXX` edits) found on the 69-row master table:

- **178** `Depends On` entries with no reciprocal `Used By` on the
  target;
- **65** `Used By` entries with no reciprocal `Depends On` on the
  target;
- of those, **58** involved a `DATA-*` record or `EXT-001` / `EXT-003`
  (the known structural gap — the 40 module records were written before
  the `DATA-` records in `DOC-034`, and `EXT-001`/`EXT-003`'s `Used By`
  lists were summarised); **120** were genuine module↔module missing
  back-links.

**None was a *wrong* relationship — every one was a *missing
back-link*** (the forward direction was always present in one column).

### Fix applied

Regenerated **every** master-table row's `Depends On` and `Used By`
columns from the **union of all directed edges** found in either column:
for each `A → B` edge (`B ∈ A.DependsOn` **or** `A ∈ B.UsedBy`), the
normalised output sets `B ∈ A.DependsOn` **and** `A ∈ B.UsedBy`. IDs
sorted by prefix then number; the one piece of non-ID prose
(`SHEET-001` "external CRM export", `SHEET-006`
`RM_HIERARCHY_RAW_` / `RmHierarchy.private.gs`) preserved.

### After

- **69 / 69** master rows rewritten;
- **0 remaining asymmetries** (re-checked by the same script
  immediately after the write);
- table integrity verified — 69 master rows, every one with 9 `|`
  fields.

`DASH-001.UsedBy` = `none` (correct — top of the tree); every `TAB-`
`UsedBy` = `DASH-001` (correct); `EXT-001.UsedBy` now enumerates all
26 consumers; each `DATA-00x` now appears in the `UsedBy` of every
`JS-`/`GS-`/`SHEET-` it depends on.

## 3. Record-file `## Relationships` prose — dangling-clean, not byte-reciprocal

The 69 record files' `## Relationships` sections are **human-readable
descriptive prose** (e.g. "`JS-021` (`movementSnapshots`)") — verified
in §1 to have **zero dangling references** and written during Phase 3 to
be directionally consistent, but they are **not** normalised to
byte-level reciprocity with each other.

**The `INDEX.md` master table is the authoritative, machine-checkable
reciprocity surface** (`RELATIONSHIP_MAP.md` §5) — and it is now fully
reciprocal. A byte-level pass over the 69 prose blocks is folded into
the standing follow-up task **`t-tf-47c37923c3bd`** (re-scoped from "the
whole reciprocity gap" to "the record-file prose sections only", since
`DOC-040` has now closed the `INDEX.md` side). This is
completeness/consistency polish, not a correctness gap — the
authoritative view is done.

## 4. Overlap with `DOC-035` / re-run after Phase 4

`DOC-035`'s `RELATIONSHIP_MAP.md` §5 ran this check first and deferred
the fix. `DOC-040` runs it **after** `DOC-036`–`038`'s `SHEET-XXX` edits
(which added `## Data Lifecycle` / `## Sensitivity` sections and touched
`INDEX.md` `SHEET-` row annotations but **not** the `Depends On` /
`Used By` columns) — confirmed those edits introduced no new asymmetry,
and applied the fix `DOC-035` deferred.

---

## Definition of Done check

- **Zero dangling references** — ✅ (§1: all IDs in all 69 records'
  `## Relationships` resolve to a real record).
- **Zero one-directional relationships** — ✅ **for the `INDEX.md`
  master table** (§2: 243 → 0, all 69 rows normalised, re-verified). The
  record-file prose sections are dangling-clean (§1) with byte-level
  reciprocity tracked as `t-tf-47c37923c3bd` (§3) — the authoritative
  surface (`INDEX.md`) has zero.
