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
   A `changes/<date>-<sha>.md` record is also created (Governance Model
   DoD point 14) — `test/check-catalog.py` check E prints the target
   filename and a starter template.
8. **Record who verified it, and get a second look when you can.** Today
   the project is single-owner (`Owner: Snehil`), so record closure is
   author-verifies-own-work. When the change lands on a PR, request one
   review and note the reviewer in `## Validation`
   (`Status: Validated 2026-mm-dd, reviewed by <name>`); solo, at least
   let `test/check-catalog.py` run (its A/B/C are the independent check)
   and note the CI run. A record closed with no second signal —
   reviewer or a green CI run — is `Validated`, not
   `Closed + Monitored`.

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

## Recording a new dependency edge (`DOC-045`)

The single most failure-prone part of keeping a relationship-based
catalog current: a code change adds a new import / call / Sheet write,
and only one side's record gets the link.

**Every time a change introduces a dependency `A → B`:**

1. **Identify both IDs.** `A` = the record whose code now needs `B`;
   `B` = what it now needs. Use `docs/INDEX.md` to resolve filenames →
   IDs.
2. **Edit both records in the same commit:**
   - `A`'s `## Relationships → Depends On` gains `B` (with a short "why"
     — e.g. "`JS-021` (`movementSnapshots`)").
   - `B`'s `## Relationships → Used By` gains `A`.
   - Both records' `docs/INDEX.md` rows get the same edit in their
     `Depends On` / `Used By` columns.
3. **Re-run a scoped reference check on just the 2 touched records:**
   confirm `A` is in `B`'s `Used By` **and** `B` is in `A`'s
   `Depends On` — in the record file **and** the `INDEX.md` row (4
   places total). This is `DOC-040`'s check, scoped to one edge.
4. If `A` and `B` are a cross-runtime pair, this is also a duplication
   edit — see the rule above.

`Related:` (non-dependency "worth reading" links) is **not** required to
be reciprocal, but reciprocating it is good practice.

---

## Worked example — a real `.gs` change (`DOC-047`)

*The `Daily_RM_Issues` retention fix, made 2026-09-07: after the
2026-09-06 10M-cell-workbook-ceiling crash, `pruneDailyRmIssueLog_()`
was added to `DailyRmIssueLog.gs` at a 7-day retention
(`DAILY_RM_ISSUE_LOG_RETENTION_DAYS_ = 7`), with a matching assertion in
`Tests_DailyRmIssueLog.gs` and a `HANDOVER.md` §9.2 write-up.*

Had this catalog existed at the time, `HOW_TO_UPDATE_A_COMPONENT.md`'s
process would have produced exactly these edits, in the same commit as
the code:

| # | Record | Edit |
|---|---|---|
| 1 | `GS-003` (`DailyRmIssueLog.gs`) | `## Significant functions` → add `pruneDailyRmIssueLog_` + `pruneDailyRmIssueLogNow` as `FN-NNN` rows; `## Config constants` → `DAILY_RM_ISSUE_LOG_RETENTION_DAYS_ = 7` as a `CFG-NNN`; `## Exceptions` → the 2026-09-06 ceiling crash + the prune-**before**-write ordering as an `EXC-NNN`; `Last Verified` → the fix commit; `## Version / change reference` → that commit + the incident. |
| 2 | `SHEET-003` (`Daily_RM_Issues`) | `## Data Lifecycle` → `Retention Period: 7 days`, `Enforced By: pruneDailyRmIssueLog_ (GS-003)`, `Archive/Delete Behavior: rows deleted + row allocation shrunk`; `Retention Period` moves from `TBD` → a confirmed value, so `docs/_planning/OPEN_ITEMS.md` §B loses this row. |
| 3 | new dependency edge | `GS-003` `Depends On` gains nothing new (it already read `Daily_RM_Issues`), but `SHEET-003`'s `## Writers` table gains the `pruneDailyRmIssueLog_` row → reciprocal: `SHEET-003 ## Data Lifecycle → Enforced By` names `GS-003`, and `GS-003 ## Sheets touched` marks `SHEET-003` "Write (append + prune)". Re-check both (4 places). |
| 4 | `docs/INDEX.md` | `GS-003` and `SHEET-003` rows → `Last Verified` bumped; `SHEET-003`'s row annotation `TBD` → `7 days confirmed`. |
| 5 | `HANDOVER.md` | §9.2 gets the incident + fix write-up (a `.gs` architectural change — `CLAUDE.md`). `GS-003 ## Handover relationship` records that §9.2 now covers this. |
| 6 | tests | `Tests_DailyRmIssueLog.gs` gets the chunk-boundary + prune assertion — `GS-003 ## Validation` references it. `CLAUDE.md`'s three-registration rule if a new `Tests_` were added (it wasn't — same file). |

**The shape to repeat for any real change:** the owning module record's
functions/constants/exceptions, any `SHEET-XXX` field it moves, the
reciprocal side of any new edge, the `INDEX.md` rows, `HANDOVER.md` if
architectural, and the test reference — all in the code change's own
commit.

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
