# Pre-ship documentation checklist (`DOC-049`)

Run this **before considering a feature done** — the concrete "is the
catalog still current" check that ties `docs/` into real development
workflow.

It sits **alongside** `CLAUDE.md`'s "Testing" section, not on top of it:
that covers `.gs` assertions / the frontend harness / `OPS_CHECKLIST.md`
/ `LEAD_FOLLOWUPS_STALENESS.md`. This one covers the catalog.

---

## The checklist

- [ ] **CI's `check-catalog.py` output was read.** The blocking checks
      (INDEX reciprocity, record↔file coverage, `Location`→file,
      snapshot self-consistency) must be green; the advisory ones
      matter too — check **E**'s "1-hop impact set" and its
      ready-to-run `update-tasks.ps1` ops JSON (run it to open the
      revalidation task), and check **D**'s `Last Verified`-drift list.
- [ ] **Every new or renamed component has a record.** New `js/*.js` /
      `.gs` file → a `JS-`/`GS-` record (`HOW_TO_REGISTER_A_COMPONENT.md`).
      New tab / button / Sheet tab / integration / significant function →
      its own record or sub-table row. *(`check-catalog.py` B blocks on a
      missing `js/*.js`/`.gs` **or** `TAB-`/`SHEET-`/`EXT-`/`DATA-` record;
      it does **not** see new tabs/buttons/functions inside an existing
      file — those are on you.)*
- [ ] **Did an explanatory comment near your change go stale?** If the
      code moved but a `//`/`/* */` comment describing *why*, a
      threshold, a retention rule, or a cross-runtime caveat did not —
      fix the comment in the same commit, and if that knowledge belongs
      in a record (`## Important logic` / `## Exceptions` / `## Assumptions`)
      put it there too. `check-catalog.py` E flags a changed line
      touching a cross-runtime pair marker; a plain stale comment it
      cannot see.
- [ ] **Every changed component's record is updated** — affected fields
      only, `Last Verified` bumped to the commit, `## Version / change
      reference` set (`HOW_TO_UPDATE_A_COMPONENT.md`).
- [ ] **Duplicated-logic pair? Both records updated in the same commit.**
      If the code change touched `enrichLead`/`computeSlaFlags_`,
      `OUTCOME_RULES`/`_GS_`, `HEADER_ALIASES`/`_`, `REGION_GROUP_MAP`/
      `_`, `RM_PERF_*`/`_GS_`, `CONFIG`/`Core.gs`, or the IST helpers —
      the `JS-` **and** `GS-` record both change (`RELATIONSHIP_MAP.md`
      §2).
- [ ] **Every new dependency edge has a reciprocal link.** New import /
      call / Sheet write → add `Depends On` to one record and `Used By`
      to the other, on the record **and** its `INDEX.md` row
      (`HOW_TO_UPDATE_A_COMPONENT.md` → "Recording a new dependency
      edge").
- [ ] **New Sheet tab → `## Data Lifecycle` filled at creation.** A real
      confirmed `Retention Period` **or** the literal `TBD` **plus** an
      entry in `docs/_planning/OPEN_ITEMS.md` §B. Never invented
      (`_templates/sheet-template.md` DOC-046 note).
- [ ] **`docs/INDEX.md` reflects the change** — the row's status,
      `Depends On` / `Used By`, `Last Verified`; the coverage snapshot if
      a component was added/removed.
- [ ] **Architectural change → `HANDOVER.md` §1–§3 updated in the same
      commit** (`CLAUDE.md`; the record's `## Handover relationship`
      tells you which section).
- [ ] **Retiring something? Follow `HOW_TO_RETIRE_A_COMPONENT.md`** —
      move to `_archive/`, never delete; the ID is never reused.

---

## Definition of Done check

- **Short enough to actually be used, not a restatement of the plan** —
  ✅ (10 checkboxes; each links the one guide with the detail, none
  repeats it). Cross-references `CLAUDE.md`'s Testing section as the
  sibling discipline rather than duplicating it. The `check-catalog.py`
  and stale-comment items were added 2026-09-10 (`t-tf-5ad22d8e4c2e`).
