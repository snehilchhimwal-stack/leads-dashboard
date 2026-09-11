# How to retire an obsolete component (`DOC-024`)

The process for marking a component obsolete **without losing its
historical record** — deletion throws away information a future
developer needs ("why did this used to exist, and what replaced it").

> Companion guides: **add** →
> `HOW_TO_REGISTER_A_COMPONENT.md`; **update** →
> `HOW_TO_UPDATE_A_COMPONENT.md`.

---

## Core rule: preserve, never delete

**Never `rm` a record file.** Retiring a component moves its record to
`_archive/` with a retirement note appended — the record stays
readable, searchable, and linkable forever. A deleted file leaves a
dangling `INDEX.md` row and a `Depends On` / `Used By` pointing at
nothing.

---

## The process

1. **Set the two status axes on the record** (Governance Model's
   7-state model; this supersedes the plan's original
   `Status: Deprecated` single field):
   - `Component Status:` → `Deprecated` (still present, don't use) or
     `Retired` (gone from the codebase).
   - `Record Status:` → `Retired` (the terminal record state).
2. **Append a retirement note** to the record (a `## Retirement`
   section at the end):
   ```
   ## Retirement
   - **Retired On:** <date>
   - **Retired In:** <commit that removed the code>
   - **Reason:** <one line — why it's obsolete>
   - **Replaced By:** <ID> | None
   - **Last Closed + Monitored at:** <the commit it was last valid>
   ```
3. **Move the file into `_archive/`**: `git mv <folder>/<ID>-<slug>.md
   _archive/<ID>-<slug>.md`. (`_archive/` was created in `DOC-014`.)
4. **Update the `../docs/INDEX.md` row** for the ID:
   - `Record Status` column → `Retired`.
   - `Location` column → `_archive/<ID>-<slug>.md` + a `(retired
     <date>, <commit>)` note.
   - Leave the row in place — do **not** delete it. A reader scanning
     the master table needs to see that `<ID>` existed and where its
     record went.
   - **The coverage snapshot count at the bottom does not change.**
     (Corrected 2026-09-11, E2E acceptance test Required Fix #10 —
     this used to say to decrement it, which would have made
     `test/check-catalog.py` check F fail: F counts every row in the
     master table for that prefix regardless of `Record Status`, so a
     retired row — kept in place per the point above, never removed —
     still counts. Retiring a component changes what a row *says*,
     never how many rows exist.)
5. **Fix every reference to it.** Grep the catalog for the ID
   (`grep -rn '<ID>' docs/`). On every record that had it in
   `Depends On` / `Used By` / `Related`:
   - if the component is `Retired` (gone), remove the reference and note
     the removal in that record's `## Version / change reference`;
   - if it's only `Deprecated` (still present), keep the reference but
     annotate it `<ID> (deprecated)`.
   - Fix the matching `INDEX.md` rows too. Nothing may silently point at
     a removed component (`RELATIONSHIP_MAP.md` §5 reciprocity).
6. **If the retirement was driven by a code removal**, a `changes/`
   record is created, and `HANDOVER.md`'s relevant section is updated in
   the same commit if the removal is architectural (`CLAUDE.md`).
7. **Sub-table components** (`FN-` / `BTN-` / `CFG-` / `RULE-` / `UI-` /
   …) don't have their own file — retiring one is: strike its row in the
   owning record's sub-table (leave the row, mark it `~~FN-NNN~~
   (retired <date>)`), and its `INDEX.md` sub-component row the same
   way.

---

## IDs are never reused

**A retired `<PREFIX>-NNN` is dead forever.** The next new component of
that prefix gets `NNN+1` (or the next free number), never the retired
one — even years later, even if the retired component's file was
`_archive/`d and nobody remembers it. A gap in the sequence
(`JS-017` retired → next new JS module is `JS-025`, not `JS-017`) is
**expected and correct**, not a bug to "tidy up" (`NAMING_CONVENTIONS.md`
numbering rule).

Why: a stable ID is a permanent address. If `JS-017` is reused, every
old commit message, `changes/` record, `LOGIC_AUDIT.md` citation, and
git-blame comment that says "see `JS-017`" now points at the wrong
thing. The `_archive/` file at `JS-017` must stay the one and only
`JS-017`.

---

## Retirement-candidate scan (`DOC-048`)

**As of 2026-09-10 (`0360b79`): no real retirement candidate exists in
this project.** This was checked, and a clean "none" is a valid, useful
result:

- `LOGIC_AUDIT.md` Part 6 §6.2 found **no confirmed dead code**.
- `DOC-012` (conflicts) and `DOC-041` (consistency) turned up nothing
  dead.
- All 24 `js/*.js`, 13 production `.gs`, 8 tabs, 22 `BTN-XXX`, 14
  `SHEET-XXX`, and 4 `EXT-XXX` are live and referenced (`DOC-039`).
- The two "not part of the live app" artifacts — `design/live-ops-redesign.html`
  and `working files on 28th for automatic email/` — were **never
  cataloged** (`file-inventory.md` §9), so there is nothing to *retire*;
  they can simply be deleted from the repo if desired.
- `Send_Log` / `Comment_History` have no code reader but are **deliberate
  audit / forward-capture datasets**, not dead — recorded as `LOW`
  operational (`DOC-038`), not retirement candidates.

So the worked example below is a **clearly-labelled hypothetical**, run
only to exercise `## The process` end-to-end.

## Worked example — HYPOTHETICAL (no such retirement has happened)

> **This is not a real retirement.** `JS-017` is live and in use. This
> walks `## The process` against a plausible future scenario so the
> guide has a concrete example.

*Hypothetical: `js/rm-performance-worker.js` (`JS-017`) is removed — the
RM-performance compute moves back onto the main thread.*

1. `_archive/JS-017-rm-performance-worker.md`:
   `Component Status: Retired`, `Record Status: Retired`, append:
   ```
   ## Retirement
   - Retired On: 2026-11-04
   - Retired In: abc1234
   - Reason: RM-performance compute moved back to the main thread; the
     Worker's off-thread benefit no longer outweighed the importScripts
     maintenance cost.
   - Replaced By: None (the logic folded into JS-008 / JS-022)
   - Last Closed + Monitored at: c82ec67
   ```
2. `git mv docs/js-modules/JS-017-*.md docs/_archive/`.
3. `INDEX.md`: `JS-017` row → `Retired`, `Location` →
   `_archive/JS-017-rm-performance-worker.md (retired 2026-11-04,
   abc1234)`; `JS-` coverage snapshot **stays** `24 / 24` — the row is
   retired, not removed, so check-catalog.py's check F (which counts
   every row regardless of `Record Status`) sees no change in count.
4. Grep `JS-017`: it was in `JS-008`'s and `JS-022`'s `Used By`, and
   `TAB-004`'s `Depends On`, and `DATA-002`/`DATA-004`'s `Depends On`,
   and `RELATIONSHIP_MAP.md` §1/§3. Remove `JS-017` from each; note the
   removal in each record's `## Version / change reference`; update
   those `INDEX.md` rows.
5. The **next** new JS module is `JS-025` — `JS-017` is never reused.

---

## Definition of Done check (`DOC-024`)

- **The process preserves the record rather than deleting it** — ✅
  (Core rule: move to `_archive/` with a `## Retirement` note; never
  `rm`; keep the `INDEX.md` row).
- **The "IDs are never reused" rule is restated here for visibility** —
  ✅ (its own section, with the *why*: a stable ID is a permanent
  address across commits, `changes/` records, and `LOGIC_AUDIT.md`
  citations).
