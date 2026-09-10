# Pre-ship documentation checklist (`DOC-049`)

Run this **before considering a feature done** — the concrete "is the
catalog still current" check that ties `docs/` into real development
workflow.

It sits **alongside** `CLAUDE.md`'s "Testing" section, not on top of it:
that covers `.gs` assertions / the frontend harness / `OPS_CHECKLIST.md`
/ `LEAD_FOLLOWUPS_STALENESS.md`. This one covers the catalog.

---

## The checklist

- [ ] **Every new or renamed component has a record.** New `js/*.js` /
      `.gs` file → a `JS-`/`GS-` record (`HOW_TO_REGISTER_A_COMPONENT.md`).
      New tab / button / Sheet tab / integration / significant function →
      its own record or sub-table row. *(`test/check-docs-coverage.js`
      warns for missing `js/*.js`/`.gs` file records — but not tabs,
      buttons, functions, or Sheet tabs.)*
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
  ✅ (8 checkboxes; each links the one guide with the detail, none
  repeats it). Cross-references `CLAUDE.md`'s Testing section as the
  sibling discipline rather than duplicating it.
