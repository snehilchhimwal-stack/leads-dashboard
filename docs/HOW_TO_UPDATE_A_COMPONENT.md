# How to update an existing component record (`DOC-023`)

The process for correcting or extending a record when the underlying
code changes — distinct from adding a brand-new component
(`HOW_TO_REGISTER_A_COMPONENT.md`) or retiring one
(`HOW_TO_RETIRE_A_COMPONENT.md`).

---

## The process

1. **Locate the record via `../docs/INDEX.md`.** Search the master table
   for the file / feature name → the `ID` → open
   `<folder>/<ID>-<slug>.md`.
2. **Update the affected fields only.** Do not rewrite the whole record.
   Typical fields a code change touches: `## Significant functions`
   (an `FN-` added/removed/renamed), `## Config constants` (a `CFG-`
   value), `## Data written / modified`, `## Exceptions`, `## Data
   Lifecycle` (for `SHEET-`), `## Important logic / business rules`.
3. **Update the record header:** `Last Verified` → `<today>` against
   `<the commit that made the change>`; `## Version / change reference`
   → that commit + the task; bump `Record Status` if needed (`Validated`
   or `Closed + Monitored` once re-checked — see the Definition of
   Stale below).
4. **Update the `../docs/INDEX.md` row** for this ID — the `Last
   Verified` column at minimum, plus `Depends On` / `Used By` if step 5
   applies.
5. **Check whether the change affects any `Depends On` / `Used By`
   relationship** — a new import, a removed call, a changed return
   shape, a new Sheet write. If so, **update the other side too**: the
   reciprocal entry on the target record's `## Relationships` **and**
   its `INDEX.md` row. `DOC-040` verifies reciprocity, but don't rely
   on it catching your gap — fix it in the same commit
   (`NAMING_CONVENTIONS.md` reciprocity rule; `RELATIONSHIP_MAP.md` §5).
6. **Set the `Record Status`:**
   - If you re-verified the whole record against current code and every
     Definition-of-Done field still holds → `Closed + Monitored`.
   - If you only touched one field and didn't re-check the rest →
     `Validated` (or leave `Stale` if a revalidation task is open).
7. **If the change is a real architectural one**, update `HANDOVER.md`'s
   relevant section (§1–§3 especially) **in the same commit** — this is
   `CLAUDE.md`'s own rule and the `INDEX.md` three-document discipline.
   A `changes/` record is also created (Governance Model DoD point 14).

---

## THE DUPLICATED-PAIR RULE (explicit — this is the one that bites)

**A code change touching a duplicated-logic pair MUST update BOTH the
`JS-XXX` and the `GS-XXX` record in the same pass** — mirroring this
project's own "edit both runtimes together" discipline (`CLAUDE.md`,
`HANDOVER.md` §6, `LOGIC_AUDIT.md` Part 4).

Editing only one side's *code* makes the dashboard and the automatic
emails silently disagree about the same lead. Editing only one side's
*record* makes the catalog lie about a seam that is the exact thing a
future maintainer needs the catalog to be honest about.

### The pairs (from `RELATIONSHIP_MAP.md` §2 / `LOGIC_AUDIT.md` Part 4)

| Concept | Browser record | Apps Script record | Where the pair is documented |
|---|---|---|---|
| Header aliases | `JS-009` `HEADER_ALIASES` (CFG-022) | `GS-004` `HEADER_ALIASES_` (CFG-037) | Part 4 §4.8 |
| Stage / SLA thresholds | `JS-005` `CONFIG.*` (CFG-003..012) | `GS-002` `Core.gs` + `GS-012` `SlaEngine.gs` (CFG-027..030, CFG-057..062) | Part 3 §3.1, Part 4 §4.2 |
| Stage / SLA-flag logic | `JS-006` `enrichLead` (RULE-005..008) | `GS-012` `computeSlaFlags_` (RULE-033..035) | Part 4 §4.2 |
| Comment classification | `JS-007` `OUTCOME_RULES` (RULE-009..010) | `GS-005` `OUTCOME_RULES_GS_` (CFG-041) | Part 4 §4.1 |
| Follow-up suggestion text | `JS-007` `FOLLOWUP_SUGGESTIONS` (RULE-012) | `GS-005` `FOLLOWUP_SUGGESTIONS_GS_` (CFG-042) | Part 3 §3.4 |
| Region normalization | `JS-014` `REGION_GROUP_MAP` (RULE-017) | `GS-004` `REGION_GROUP_MAP_` (CFG-038) | Part 4 §4.3 |
| Loan-region override | `JS-014` `effectiveRegion` (RULE-018) | **NO working twin** — `GS-001`/`GS-010`/`GS-004` (the HIGH finding) | Part 4 §4.4 / Part 7 §18 |
| RM-performance constants | `JS-008` `RM_PERF_*` (CFG-013..018) | `GS-003` `RM_PERF_*_GS_` (CFG-031..036) | Part 1 §4b ("must stay numerically identical") |
| IST day boundary | `JS-005` `istDateKey` | `GS-002` `istDayKeyGs_` | Part 4 §4.6 |
| Test-mode override | `JS-016` `TEST_MODE_OVERRIDE_EMAIL` (CFG-024) | `GS-004` `TEST_MODE_OVERRIDE_EMAIL_` (CFG-039) | Part 6 findings |

### Worked example

*You add a new keyword to `OUTCOME_RULES` in `js/core-outcome-engine.js`
and the matching entry to `OUTCOME_RULES_GS_` in `FollowupEngine.gs`
(the code discipline).*

In the same commit, the **doc** update:
1. `JS-007`'s `## Business rules implemented` → note the added signal
   under `RULE-009` (or a new `RULE-NNN` if it's a new outcome, not a
   new synonym); `Last Verified` → today/commit.
2. `GS-005`'s `## Config constants` → `CFG-041` note updated the same
   way; `Last Verified` → today/commit.
3. `DATA-003` (comment-classification pipeline) `## Known gaps` → if the
   `~110 vs ~30` count gap moved, update it.
4. `INDEX.md` → `JS-007` and `GS-005` `Last Verified` columns.
5. `HANDOVER.md` §6's duplication list → only if the *set* of pairs
   changed (a new keyword doesn't; a new mirrored *function* does).
6. Run `OPS_CHECKLIST.md`'s pre/post items (a duplicated-logic change is
   exactly what that checklist guards).

---

## Definition of Stale (when a `Closed + Monitored` record must go back to `Stale`)

Any of (Governance Model):

- its source file changed (any commit touching the `## Location` path);
- a file in its `## Relationships → Depends On` changed an exported
  signature / message shape / returned-object shape;
- a `SHEET-` it touches changed columns, retention, or writers;
- a `RULE-` / `CFG-` it implements changed value or logic;
- a `TRIGGER-` it belongs to changed schedule;
- `HANDOVER.md`'s section covering it changed, or went stale per
  `test/check-docs-coverage.js`'s freshness check;
- the commit in `## Version / change reference` is now far behind `HEAD`
  on the paths it covers;
- its validation evidence points at a test that no longer exists.

When one fires: set the `INDEX.md` row to `Stale`, open a "Revalidate
`<ID>` after `<commit>`" task via `update-tasks.ps1`, then follow this
process to bring it back to `Closed + Monitored`.

---

## Definition of Done check (`DOC-023`)

- **The duplicated-pair rule is explicit, not left implicit** — ✅ (the
  "THE DUPLICATED-PAIR RULE" section above: the rule stated in bold, the
  full pair table with record IDs, and a worked `OUTCOME_RULES` /
  `OUTCOME_RULES_GS_` example showing both records updated in one pass).
