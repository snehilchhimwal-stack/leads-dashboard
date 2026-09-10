# Open items (`DOC-042`)

**One consolidated list of everything this Documentation Project could
not fully resolve** — so nothing is quietly lost when the project is
called "done." (`DOCUMENTATION_PROJECT_PLAN.md` Phase 5, `DOC-042`.)

**This file IS the follow-up tracker** — it does not spawn numbered
tasks; it is the durable home for "not yet resolved." Two small
`update-tasks.ps1` tasks *were* opened (they need a code/doc edit, not
just a note): `t-tf-7e4d0dffdf6c` and `t-tf-47c37923c3bd` — both listed
below.

Last compiled: 2026-09-10 at commit `29f564c`.

---

## A. `Owner:` — no open items

`DOC-020`'s plan text said "default `Owner: TBD`". The **Governance
Model overrode this to default `Owner: Snehil`** (a blank owner invites
"nobody's job"). Every one of the ~90 records carries `Owner: Snehil`.
**Zero `TBD` owners.** The forensic audit's P3 "distribute ownership"
item is **no-action by design** — this is a single-owner project; if a
team ever forms, ownership is a per-record edit, not a project gap.
`test/check-catalog.py` B/A are the independent (non-author) check in
the meantime, and `HOW_TO_UPDATE_A_COMPONENT.md` step 8 makes the
review signal explicit.

## B. Retention — 7 `TBD`, routed for a decision (`DOC-037`)

Full context per tab (data type, growth rate, options, decision owner)
is in **`retention-decisions-needed.md`**. Summary — **owner decision
needed**:

| Tab | Character of the decision |
|---|---|
| `leads` (`SHEET-001`) | needs the **CRM-export owner** — confirm overwrite-vs-append; not a change this project can make |
| `Lead_Followups` (`SHEET-004`) | likely "no action — self-bounded by the per-cycle clear" |
| `SLA_History` (`SHEET-005`) | negligible growth; "keep forever" is implied not stated → ratify + put in code, or cap |
| `Daily_Cohort_History` (`SHEET-008`) | same as `SLA_History`; the most legitimate "keep indefinitely" candidate |
| `Send_Log` (`SHEET-011`) | audit/compliance call — holds email addresses; **no `clear*` function exists** |
| `AllIssues_Log` (`SHEET-013`) | audit/compliance call; a prune is functionally safe |
| `Overnight_Log` (`SHEET-014`) | **clearest prune candidate** — ~all rows older than same-day are waste; ~2-day retention likely safe |

Plus two **decisions already made, offered to the owner to ratify or
override** (`retention-decisions-needed.md` tail): `Comment_History`
unbounded-by-design; `Unmatched_Comments_Log` manually-curated. And one
**data-safety `TBD`** (not retention): does a `Manager_Directory`
rebuild preserve hand-filled `email` values? (`SHEET-007` — a rebuild
that wipes them silently breaks routing.)

> Resolved retention decisions fold back into the matching `SHEET-XXX`
> `## Data Lifecycle → Retention Period` field as a small edit
> (`DOC-037`'s own follow-up note); if a decision adds a `pruneXxx_`
> function that is a real `.gs` change with its own task.

## C. Doc-vs-doc / doc-vs-code conflicts (`DOC-012`)

Full detail in **`documentation-conflicts.md`** (C-1..C-9). The actionable
subset (**tasked as `t-tf-7e4d0dffdf6c`**, Low) is **DONE — `2026-09-10`**:

- ~~**C-1**~~ `CLAUDE.md` load-order line + `HANDOVER.md` §2 table row —
  now "9 of the 10 `js/core-*.js` load first; `core-rm-performance.js`
  loads later, position 15 of 23". ✅
- ~~**C-2**~~ `HANDOVER.md` §2 "Load order matters" paragraph — rewritten
  to the real 23-`<script>`-tag order + the `new Worker()` 24th file. ✅
- ~~**C-3**~~ `HANDOVER.md` §1 `.gs` list — `OpsChecklistRunner.gs` +
  `LeadFollowupsStaleness.gs` added, "13 production `.gs` files".
  (`CLAUDE.md`'s list already carried them.) ✅
- ~~**C-4**~~ `HANDOVER.md` §7.2 + `CLAUDE.md` testing bullet — rewritten
  to point at `tests/frontend-harness.html`; the "not in CI" gap kept
  explicit. ✅
- ~~**C-7**~~ `HANDOVER.md` §1 prose + §5 table — "every 6h" → "4×/day at
  00:00/06:00/12:00/18:00 IST". ✅

`C-8` (in-code `.gs` comments say `js/core.js`) and `C-9`
(`LOGIC_AUDIT.md` line numbers vs grown files — **frozen by design, no
action**) are logged, not tasked. **`LOGIC_AUDIT.md` is never edited
forward.**

## D. `HANDOVER.md` §9.7 + the Phase 5 `HANDOVER.md` reconciliation list

**`handover-coverage-map.md`** (`DOC-002`) carries a 10-item list of
`HANDOVER.md` sections Phase 5 should re-verify/update, headed by the
biggest:

- **§9.7 / C-5 / C-6 — RESOLVED `2026-09-10`** (`t-tf-5ad22d8e4c2e`, P3).
  §9.7 title + **Status: shipped and live** banner; §2's
  `tab-repeat-offenders.js` row; §9 intro notes the 2026-09-04 redesign.
  **§9.1 rewritten** to the composite RM-performance score (shrinkage
  `K=8`, 4 independent RM/Region/A1-TM/RH computations, `Movement_Log`-
  reconstructed eligible book) — "Avg Flagged" is gone from the prose.
  **§9.3.1 rewritten** — retitled, describes the current single
  "Unique Leads" column, states `aggregateRepeatOffenders` /
  `totalLeadsByKey` were removed, keeps the still-valid lessons.
  §9.4 (date-basis split), §9.5 (`isNotUpdated` 48h gate), §9.6
  (`OUTCOME_RULES` mining) re-read against current source — **still
  accurate, left as-is**. §9.7.1/§9.7.2 are dated design-record
  sub-notes, kept. `handover-coverage-map.md` items 1–3 closed.
- §2 (add `js/rm-performance-worker.js` — **done `2026-09-10`** via
  `t-tf-7e4d0dffdf6c`, along with the load-order rewrite), §5 (add 5
  missing Sheet tabs; the `Movement_Log`/`SLA_History` "every 6h" wording
  **fixed `2026-09-10`**), §6 (reconcile the duplication-pairs list),
  §7.1/§7.2 (note the Node CI harness + the frontend harness — **§7.2
  done `2026-09-10`**), §1 (add 2 `.gs` — **done `2026-09-10`**),
  §4.2/§4.4 (GitHub Pages source still unconfirmed), §4.3
  (`setupRmHierarchy()` has no own row in the setup table).

These are `HANDOVER.md` edits, not catalog gaps — every catalog record's
`## Handover relationship` already states whether its section is current.
**Not tasked** (it's the eventual `CONSOLIDATED` hand-off of the
living-architecture role from `HANDOVER.md` §1–§3 to `docs/`).

## E. Cross-reference reciprocity — DONE (2026-09-10)

`DOC-040` normalised the **`docs/INDEX.md` master table** to **0
one-directional pairs** (`reference-verification.md`).
**`t-tf-47c37923c3bd` (2026-09-10, done)** then aligned the record files
to it in two passes: (1) additive — added every `INDEX.md` back-link the
53 lagging record files were missing; (2) **prune** (Snehil's call —
Option A in `reciprocity-normalisation-notes.md`) — removed the 57
record-only edges so every record's `Depends On` / `Used By` matches its
`INDEX.md` row **exactly**.

**Final: 69/69 records == `INDEX.md`; 0 one-directional pairs across the
record set** (verified `recip_verify.py`). `## Related` bullets and
accurate summary prose kept. No open item.

## F. Known code findings the catalog records but does not fix

These are `LOGIC_AUDIT.md` Part 7 §18 findings — **real code issues,
out of scope for a documentation project**, recorded on the relevant
records with a `## Next action` / `Revalidation trigger` so they stay
visible. Listed here so "the catalog is done" doesn't read as "these are
resolved":

| Sev | Finding | Recorded on |
|---|---|---|
| 🟠 HIGH | Loan-region `effectiveRegion` override missing from all 3 scheduled-email call sites | `DATA-005 ## Next action`, `JS-014` RULE-018, `GS-001`/`GS-010`/`GS-004`, `RELATIONSHIP_MAP.md` §2 |
| 🟡 MED #1 | `browserSnapshotOpenLeads` has no reentrancy guard | `JS-018` EXC-034 |
| 🟡 MED #2 | `CONFIG.MIN_CALLS_AFTER_48H` display-only, disagrees with the real threshold | `GS-012` EXC-088 |
| 🟡 MED #3 | unguarded cross-runtime `Lead_Followups` overlap window | `JS-018` EXC-038, `RELATIONSHIP_MAP.md` §4 |
| 🔵 LOW | "Possible Premature Closes" has no scheduled-email equivalent | `JS-014` RULE-019 |
| 🔵 LOW | KPI strip mixes customer-level + issue-level counts, undocumented in the UI | `TAB-002 ## Data displayed`, `DASH-001 ## Known limitations` |
| 🔵 LOW | dropped click during rapid filter changes | `JS-004` EXC-009 |
| 🔵 LOW | `RmHierarchy.gs` single point of failure for both scheduled emails | `GS-011 ## Known ...`, `RELATIONSHIP_MAP.md` §3 |
| — | `OUTCOME_RULES` ~110 vs `OUTCOME_RULES_GS_` ~30 — needs a maintainer determination (fewer outcomes, or counts not comparable?) | `GS-005 ## Next action`, `DATA-003 ## Known gaps` |
| — | `TEST_MODE_OVERRIDE_EMAIL` / `_` — silent recipient-redirect footgun, both runtimes, both unset | `JS-016` CFG-024, `GS-004` CFG-039 |
| — | `_allReports` bare cross-file `let` — consistency, not a bug (`window._regionReports` is the better pattern) | `JS-016 ## Next action` |

## G. Process / CI

- **`test/check-docs-coverage.js` is warn-only** (`continue-on-error`).
  Graduating it to build-blocking is an explicit decision tied to this
  project's completion (`CLAUDE.md` Testing note; Maintenance Model —
  "graduation criteria … not a fixed date"). Not done; a post-project
  call. The check also does **not** verify function-level coverage,
  cross-reference reciprocity, retired components, or "code changed
  without doc review" — **but `test/check-catalog.py` (2026-09-10,
  `t-tf-5ad22d8e4c2e`) now does**: reciprocity + record↔file coverage +
  `Location`→file are BLOCKING; `Last Verified` drift + change→ID impact
  are advisory. Kept for its `HANDOVER.md`-age signal.
- The Governance Model's **Change-Control Mechanism** detection half
  (steps 1–3, 5–6) is **built** — `check-catalog.py`, `fetch-depth: 0`
  set, green in CI (run #76). The *write* side of steps 5–6 (mark rows
  `Stale`, open the task) and steps 7–10 (re-verify, refresh evidence,
  close) are **human by design** — CI prints the ops JSON, a person runs
  it. `DOC-045` (the `HOW_TO_UPDATE` worked example) already exists.
- **`docs/changes/`** is still empty — no `changes/` record exists yet
  because every closure so far was prompted by the doc project itself,
  not a code change (DoD point 14). The first real post-catalog code
  change should produce `docs/changes/<date>-<sha>.md` (check E prints
  the target name).

### G.1 Forensic completeness audit (2026-09-10) — `FORENSIC_COMPLETENESS_AUDIT_2026-09-10.md`

Full adversarial closed-loop audit (task `t-tf-cc97c00a3839`, done
`d2b5fda`). Verdict: **one-time completeness ~95%, continuous
completeness ~15%** — the change→stale→task→revalidate loop was designed
in `DOCUMENTATION_PROJECT_PLAN.md` and essentially unbuilt.

- **P0 — DONE** (`3d2db17`, `cb5afb1`, `t-tf-5ad22d8e4c2e`):
  `fetch-depth: 0` + `test/check-catalog.py` check E (diff→component-ID
  resolver: affected IDs + 1-hop impact + a ready-to-run
  `update-tasks.ps1` ops JSON; a changed `js/`/`.gs` with no row ⇒
  "undocumented component"). The *write* side (mark `Stale`, open the
  task) is human — CI can't reach `tasks.json`. **3 live contradictions
  fixed** — plan governance section bannered PRE-BUILD SNAPSHOT,
  `INDEX.md` footer rewritten, `HANDOVER.md` §9.7 headline + §2 + §9.3
  (deep §9 body sweep still tracked, §D above / C-5·C-6).
- **P1 — mostly DONE**: `check-catalog.py` A (reciprocity, BLOCKING),
  B/C (record↔file both ways + `Location`→file, BLOCKING), D
  (`Last Verified` drift, advisory) — all green in CI run #76.
  "Flip `check-docs-coverage.js` Check 1 to hard-fail" → **skipped as
  moot** (`check-catalog.py` B is the broader blocking version). 57
  record-only edges → done (pruned, §E).
- **P2 — DONE** (`acc7cbe`, `519a377`, `78f3816`): `check-catalog.py`
  check F (snapshot self-consistency, BLOCKING); `FLOW-001` +
  `FLOW-002` + `docs/architecture/apps-script-triggers.md`;
  `docs/changes/2026-09-10-build.md` + `docs/validation/README.md`;
  comment-change / pair-marker flag in check E + two new
  `PRE_SHIP_DOCUMENTATION_CHECKLIST.md` checkboxes; `frontend-harness.html`
  headless in CI (`run-frontend-harness.mjs`, non-blocking, green run
  #83); `NAMING_CONVENTIONS.md` zero-instance + Sheet-formula note.
- **P3 — DONE where doable** (`e4a51ca` + this commit): the deep
  `HANDOVER.md` §9 sweep (C-5/C-6 resolved — §9.1/§9.3.1 rewritten,
  §9.4–§9.6 re-verified accurate); `goal_id` — the 5 `t-tf-*` catalog
  follow-ups linked to `g-docproject01` (the `DOC-*`/`CI-*`/`TASKFLOW-*`
  families were already linked; the audit's "Goal↔Task broken" was a
  stale read); `_planning/task-to-component-map.md` (the reverse index);
  `HOW_TO_UPDATE_A_COMPONENT.md` step 8 (review signal);
  `retention-decisions-needed.md` P3 appendix (copy-paste prune code for
  the "if prune" branch). **Not doable by this project:** the 7 retention
  `TBD`s (§B — owner + CRM-owner + compliance call, code sketch now
  ready); `Owner:` distribution (§A — no team); flipping the two
  non-blocking CI steps (premature — needs a few more clean runs +ideally
  a real revalidation cycle to prove the habit); §5 tab-table / §6
  pairs-list additions to `HANDOVER.md` + §4.2/§4.4 repo-settings
  confirmation (`handover-coverage-map.md` items 5/6/9/10).

---

## H. Naming inconsistencies (`DOC-039` / `DOC-040`)

- **None material.** `DOC-039`'s mechanical re-check found 0 undocumented
  components in any category. The one cosmetic note: `TAB-004`'s file
  slug is `repeat-offenders` while the `dashboard.html` DOM id is
  `tab-repeatoffenders` (no hyphen) — the record covers it correctly;
  not a gap, not worth renaming.
- `SHEET-009` was mis-named `Interaction_History` in the Phase 2 seed →
  corrected to `Comment_History` in `DOC-029`. Closed.

---

## Definition of Done check

- **Every open item logged anywhere else in this plan is represented
  here exactly once** — ✅. Sources folded in: `DOC-020` owner default
  (§A), `DOC-036`/`DOC-037` retention `TBD` (§B), `DOC-012` conflicts
  (§C), `DOC-002` `HANDOVER.md` reconciliation list (§D), `DOC-035`/
  `DOC-040` reciprocity (§E), `LOGIC_AUDIT.md` Part 7 §18 findings the
  catalog records-but-doesn't-fix (§F), process/CI gaps (§G), `DOC-039`
  naming (§H). Two items that need an edit rather than a note are tasked
  (`t-tf-7e4d0dffdf6c`, `t-tf-47c37923c3bd`); everything else lives
  here.
