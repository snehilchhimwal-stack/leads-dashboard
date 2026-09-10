# Forensic Completeness Audit — Documentation Project

**Run:** 2026-09-10, against `HEAD = cddbd17` (working tree clean apart from
pre-existing untracked `.claude/` + `working files on 28th…/`).
**Auditor brief:** `FORENSIC_COMPLETENESS_AUDIT_BRIEF.md` (this folder).
**Method:** direct read of the live repo — `docs/**`, `DOCUMENTATION_PROJECT_PLAN.md`,
`test/check-docs-coverage.js`, `.github/workflows/test.yml`, `HANDOVER.md`,
`CLAUDE.md`, `tasks.json`, `update-tasks.ps1`, and a code-comment scan of
`js/*.js` + `*.gs`.
**Evidence labels:** `Confirmed` (verified against a file/command this run),
`Inferred`, `Unknown/Evidence Required`, `Recommendation`.

---

## A. Executive assessment

**One-time completeness: ~95% (Confirmed).** Every `js/*.js` (24), production
`.gs` (13), dashboard tab (8), Sheet tab (14), external integration (4),
traced data flow (5), and the one dashboard have a `Closed + Monitored`
record; `FN-001..254`, `BTN-001..022`, `RULE-`, `CFG-`, `EXC-`, `UI-`, `API-`
sub-tables are populated inside those records (850 `FN-` mentions, 208 `EXC-`,
121 `BTN-`, 116 `CFG-`, 87 `RULE-`, 28 `UI-`, 10 `API-` — Confirmed by grep).
`docs/INDEX.md` is internally reciprocal (0 asymmetries, `DOC-040`), and as of
this run every record's `## Relationships` is a superset of its INDEX row
(`t-tf-47c37923c3bd`, `cddbd17`). No code file has changed since the commit
the records were verified at (`c82ec67` → `HEAD`, `git log c82ec67..HEAD --
js/*.js *.gs dashboard.html` is **empty** — Confirmed), so the catalog is
genuinely current *today*.

**Continuous completeness: ~15% (Confirmed).** The property the brief asks
for — *change anywhere → detected → impact → stale → task → revalidated →
closed, forever* — **is designed in full (`DOCUMENTATION_PROJECT_PLAN.md`
Change-Control Mechanism, 11 steps) and built almost not at all.** The only
automation is `test/check-docs-coverage.js`: (1) warn-only file↔record
existence for `js/*.js` + `.gs` only, (2) a HANDOVER.md "updated" date-age
warning. It never runs `git diff`, has no `INDEX.md` awareness, no
`FN-`/`TAB-`/`SHEET-`/`EXT-`/`DATA-` awareness, no stale-marking, no
task-creation, no record→file reverse walk, and **always exits 0**
(`continue-on-error: true` on top of an unconditional `process.exit(0)`).

**Is it closed-loop? No (Confirmed).** The loop is a documented process
executed by whoever remembers to open `PRE_SHIP_DOCUMENTATION_CHECKLIST.md`.
`CLAUDE.md` and the plan both say, in writing, that this exact "written rule,
nothing enforcing it" pattern has already failed once in this repo
(HANDOVER.md sat stale 2026-09-02→09-09 through several redesigns).

**Can it stay current automatically? No (Confirmed).** A change to
`js/core-lead-model.js` tomorrow would: not mark `JS-006` `Stale`, not open a
revalidation task, not fail CI, not appear in any coverage report (the file
still has a record). The only eventual signal is HANDOVER.md crossing 14 days.

**Biggest risks**
1. **Silent drift after closure** — every one of the 69 records is
   `Closed + Monitored` with `Last Verified: c82ec67`; nothing re-checks that
   field against `HEAD`. The first real code change begins invisible decay.
2. **The plan's own governance section is already stale** — `DOCUMENTATION_PROJECT_PLAN.md`
   §"Current-State Audit (2026-09-10)" / "Task Audit" / "Dead-End Register" /
   "Priority Actions" describe a **pre-build** world ("all 50 tasks Not
   Started", "docs/ contains exactly one file: Lead_Lifecycle_Tracking.pptx").
   The authority document for the whole system contradicts reality.
3. **`docs/INDEX.md` footer is stale** — "Still open: DOC-035 … Phase 4
   DOC-036 … Phases 5–6" (all done).
4. **No change-record has ever been written** — `docs/changes/` is an empty
   stub; DoD point 14 is unmet for every closure that a code change prompted,
   and there is no trail of "which change made which record stale."
5. **`Owner:` is uniformly `Snehil`** — no distribution of accountability;
   fine for a one-person project, a single point of failure for a team.

**Most significant omissions**
- Change-detection (`fetch-depth: 0` + diff→ID step) — designed, not built.
- Record→file reverse walk (retired/renamed/deleted detection) — not built.
- Function-level, Sheet-tab-level, UI-level, comment-level coverage checks —
  not built.
- `docs/validation/` and `docs/changes/` and `docs/architecture/` folders —
  created empty, never populated.
- A machine-checkable `INDEX.md` ↔ record-file reciprocity check
  (`DOC-040` ran once by hand; nothing re-runs it).

---

## B. Requirement-by-requirement audit

Each row is one brief requirement. `Covered?` = Yes / Partial / No / Deferred.

| # | Requirement (from the brief) | Covered? | Where / Evidence | Gap | Required change |
|---|---|---|---|---|---|
| B1 | Continuously synchronized representation of the real system | **No** | Sync is a manual pre-ship checklist (`PRE_SHIP_DOCUMENTATION_CHECKLIST.md`); `Maintenance model` note in `INDEX.md` admits "nothing fully enforces this catalog automatically" (Confirmed) | No detection, no propagation | Build Change-Control steps 1–2, 5–6 into CI |
| B2 | Evidence-backed | **Partial** | Each record has `## Validation` (method + evidence link + status) and `## Closure evidence` (Confirmed). But `docs/validation/` is empty — evidence is inline prose, not a separate linkable record; and much cites `LOGIC_AUDIT.md` (frozen) or "hand-verified this session" | No durable, dated evidence artifacts; CI runs cited by number not linked | Populate `docs/validation/<ID>.md`; link the actual CI run URL |
| B3 | Closed-loop (change → … → closed + monitored) | **No** | Loop fully specified in `DOCUMENTATION_PROJECT_PLAN.md` Change-Control Mechanism; **0 steps automated past detection-of-new-file** | Steps 1–11 unbuilt | P0/P1 in §L |
| B4 | Continues after closure; nothing permanently trusted | **Partial (policy yes, mechanism no)** | 7-state model has `Closed + Monitored → Stale`; `Governing principle` says "no record becomes permanently trusted" (Confirmed) | Nothing *moves* a record to `Stale`; `Last Verified` never re-checked | A CI step comparing each record's `Last Verified` commit to `HEAD` on its `## Location` path |
| B5 | Zero unaccounted scope — every artifact type | **Partial** | Own-file types (`DASH/TAB/JS/GS/SHEET/EXT/DATA`) 100%; sub-types `FN/BTN/UI/RULE/CFG/EXC/API` populated in-record | `TRIGGER-`, `RANGE-`, `HTML-`, `CSS-`, `CLASS-` defined in the taxonomy, **0 instances** — no explicit "excluded because…" note | Add a one-line exclusion rationale for each unused prefix to `NAMING_CONVENTIONS.md` |
| B6 | HTML / CSS covered | **Partial** | `DASH-001 ## HTML / CSS structure` + `dashboard.html` is the `Location`; `TAB-XXX` records list `UI-XXX` | No `HTML-`/`CSS-` records; `dashboard.html` (~1400 lines of markup + `<style>`) has one paragraph, no automated check | Decide: is `DASH-001` enough (Recommendation: yes, note it) or does the `<style>` block need its own record |
| B7 | Functions / classes / methods | **Partial** | `FN-001..254` contiguous, each in a `## Significant functions` sub-table (Confirmed) | "Significant" only — non-significant functions are deliberately unlisted; **no check that a new function got an `FN-`** | Optional `FN-` count check in CI (grep `^function` vs record rows) |
| B8 | Config / constants / env vars | **Yes** | `CFG-` sub-tables (116 mentions); cross-runtime twin column; `RELATIONSHIP_MAP.md` §2 pairs | env vars: none exist (static site + Apps Script) — correctly N/A | — |
| B9 | Manifests | **Partial** | `HANDOVER.md` §2 notes "no `appsscript.json` checked in"; not a record | Apps Script manifest lives only in the live editor — genuinely un-versionable here | Note as an explicit `Unknown/out-of-repo` in `OPEN_ITEMS.md` |
| B10 | Triggers / scheduled jobs | **Yes (as prose)** | Every `GS-XXX` has `## Trigger schedule` with exact `atHour/nearMinute/inTimezone`; `GS-010` flagged as the sole no-`.inTimezone()` outlier (Confirmed) | Not modelled as `TRIGGER-XXX` sub-records; no single "all triggers" index | Recommendation: a `docs/architecture/TRIGGER-index.md` or a table in `RELATIONSHIP_MAP.md` |
| B11 | APIs / endpoints / integrations | **Yes** | `EXT-001..004` + `API-` sub-rows (10) + `integration-inventory.md` | — | — |
| B12 | Auth / authz / permissions | **Yes** | `EXT-003` (OAuth gate), `JS-001` (core-auth), `EXT-002` (separate Gmail grant); `HANDOVER.md` §4 | No record of the *Sheet-level* sharing model (who can open the Sheet) | Add to `SHEET-001` or `EXT-001` `## Auth` |
| B13 | UI components / buttons / menus / forms / dialogs / event handlers | **Partial** | `BTN-001..022`, `UI-001..014` per `TAB-` record; global buttons on `DASH-001` | No `menus`/`dialogs` as distinct concepts; event handlers implied by `BTN → FN` invokes column | Acceptable — note the modelling choice |
| B14 | Sheet tabs / ranges / named ranges / formulas / validations / filters / views | **Partial** | 14 `SHEET-` records with columns transcribed from real source constants; `RANGE-` prefix defined, **0 used** | No `formulas`/`named ranges`/`data validations`/`filter views` inventory — the Sheet is backend-written, formulas are rare, but this is asserted not verified | `Unknown/Evidence Required`: confirm the live Sheet has no behaviourally-significant formulas / filter views; record the finding |
| B15 | Data sources / destinations / transformations / schemas / mappings / lineage | **Yes** | `DATA-001..005` traced end-to-end; `JS-018 ## Data Lineage` write table; `HEADER_ALIASES` mapping documented | — | — |
| B16 | Business rules / calculations / assumptions | **Yes** | `RULE-` sub-tables (87); `DATA-002` SLA pipeline; constants cross-checked live in `consistency-check.md` (`DOC-041`) | — | — |
| B17 | Workflows / state transitions | **Partial** | `DATA-` flows + `FLOW-` prefix **defined, 0 records** (`docs/architecture/` empty) | The 4×/day Movement hub + piggyback loggers, the 3-phase Generate cycle — described in prose across records, no standalone `FLOW-` record | Write the 2–3 real `FLOW-` records the plan's own examples name |
| B18 | Retention / lifecycle / archival / deletion | **Partial** | `SHEET-XXX ## Data Lifecycle` (`DOC-036`); 2 confirmed 7-day, 2 by-design, 3 N/A-config, **7 `TBD`** with `OPEN_ITEMS.md` §B entries + `retention-decisions-needed.md` (`DOC-037`) | 7 tabs have genuinely unknown retention — correctly tracked, not resolved | Resolve the 7 `TBD` (needs product decision) |
| B19 | Exceptions / error handling / retries / fallbacks | **Yes** | `EXC-` sub-tables (208); `## Exceptions & error handling` per record | — | — |
| B20 | Alerts / logging / monitoring | **Partial** | `EmailInfra.gs` ops-alert path documented in `GS-004`; `Send_Log`/`AllIssues_Log`/`Overnight_Log` as `SHEET-` records | No single "what alerts exist / who gets them" view | Add to `RELATIONSHIP_MAP.md` |
| B21 | Comments (business logic, rationale, warnings, TODO/FIXME) | **Partial** | Cross-runtime duplication comments are captured (`RELATIONSHIP_MAP.md` §2, `HANDOVER.md` §6); `TEST_MODE_OVERRIDE_EMAIL` documented as `CFG-` | **No systematic comment classification pass** was ever run; §E below is the first | Do §E's pass; add a `## Meaningful comments` field to records that need it |
| B22 | Comments change-control (comment changes → doc review) | **No** | Nothing watches comments | Same infra gap as B1/B3 | The diff→ID step (§L P1) can include "changed a line matching `RULE-`/`CFG-`/a duplication-pair marker" |
| B23 | Implementation changes but stale comment stays — detect inconsistency | **No** | Nothing | Hardest to automate | Compensating control: `PRE_SHIP_DOCUMENTATION_CHECKLIST.md` item "did a comment near your change go stale?" |
| B24 | Disabled / commented-out / dead / deprecated code | **Yes (as a finding)** | `LOGIC_AUDIT.md` Part 6 §6.2 "no confirmed dead code"; `DOC-048` retirement scan = "no candidate exists"; `js/core-outcome-engine.js:659` naming-debt comment noted | — | Re-run the dead-code scan when code changes (revalidation trigger) |
| B25 | Feature flags / temporary workarounds / magic numbers | **Partial** | `TEST_MODE_OVERRIDE_EMAIL` (test override) is a `CFG-`; magic numbers → `CFG-`/`RULE-` where significant | No "feature flag" concept because there are none; the `for now` / `TEMPORARY` comments (§E) aren't all captured | §E |
| B26 | Documentation / READMEs / specs / ADRs / audit / handover / task records | **Partial** | `docs/` folder READMEs exist; `HANDOVER.md`, `LOGIC_AUDIT.md`, `DOCUMENTATION_PROJECT_PLAN.md`, `OPS_CHECKLIST.md`, `LEAD_FOLLOWUPS_STALENESS.md` all cross-referenced | No **decision records** (`docs/` has no ADR concept); big decisions live in the plan's prose | Recommendation: an `ADR-` prefix or a `decisions.md` |
| B27 | CI/CD checks / tests / validation evidence | **Partial** | `.github/workflows/test.yml` (`run-gs-tests.js` blocking + `check-docs-coverage.js` warn); `tests/frontend-harness.html` (not in CI) | `frontend-harness.html` not wired to CI; `check-docs-coverage.js` warn-only | `HANDOVER.md` §7.2 now states this gap (Task 1); wire the harness to CI or accept + document |
| B28 | Generated artifacts | **Yes (N/A)** | No build step, no generated code (static site); PDF export (`jsPDF`) is runtime, documented in `EXT-004`/`JS-013` | — | — |
| B29 | External deps / third-party services | **Yes** | `EXT-001..004`; CDN scripts (`jsPDF`, `jspdf-autotable`) in `EXT-004`; `integration-inventory.md` | version pinning of the CDN libs is noted (`2.5.1` / `3.8.2`) | — |
| B30 | Operational procedures | **Yes** | `OPS_CHECKLIST.md` + `OpsChecklistRunner.gs` (`GS-009`); `HANDOVER.md` §8 incidents | — | — |
| B31 | Ownership | **Partial** | `Owner: Snehil` on every record + the Governance schema default (Confirmed) | Uniform — no real accountability distribution; no owner on `docs/_planning/*` inventories | Acceptable for now; revisit if a team forms |
| B32 | Change history / version / commit references | **Yes** | Every record `## Version / change reference` names the verifying commit; `git log` is the authoritative history (Source-of-Truth table) | The verifying commit is `c82ec67` (Phase-2 scaffolding) for all 69 — predates the record-writing itself; harmless only while code == `c82ec67` | On first code change, bump `Last Verified` per revalidation |
| B33 | Bidirectional traceability (Goal↔Requirement↔Task↔Component↔Source↔…↔Handover) | **Partial** | Component↔Source↔Dependency↔Data↔Validation↔Handover all present in-record; INDEX gives Component↔Component both ways | **Goal↔Requirement↔Task↔Component is broken**: `DOC-0xx` tasks have `goalId: null` (not linked to `g-docproject01`); no requirement IDs exist; no record cites "implements requirement X / task DOC-0YY" | §D |
| B34 | Source-of-truth per information type; no two docs contradict | **Yes (table) / Partial (reality)** | `DOCUMENTATION_PROJECT_PLAN.md` Source-of-Truth Table is clean and complete (Confirmed) | Reality has 3 live contradictions: the plan's own governance section vs reality; `INDEX.md` footer vs reality; `documentation-conflicts.md` C-5/C-6/C-8 still open | Fix the 3 (2 are trivial; C-5 is Phase-5 `HANDOVER.md` §9.7) |
| B35 | Historical audits preserved, not merged into living catalog | **Yes** | `LOGIC_AUDIT.md` frozen, never edited forward; `DOC-050` added only a top pointer; `INDEX.md` "why not LOGIC_AUDIT.md" section (Confirmed) | — | — |
| B36 | One authoritative central tracking mechanism | **Partial** | `docs/INDEX.md` is declared authoritative for component state; `tasks.json` for task state | Two mechanisms, correctly separated — but nothing enforces INDEX rows track reality, and `tasks.json` DOC tasks aren't goal-linked | §D + §L |
| B37 | Definition of Done = full loop, not "work performed" | **Partial** | 14-point DoD in the plan is genuinely thorough (source link, deps, validation, architecture, handover, revalidation trigger, owner, INDEX row, change record) | Point 14 (`docs/changes/` record) is **unmet for every record** — folder is empty; point 8 (`## Architecture relationship → DASH/FLOW`) met via `DASH-001` only (no `FLOW-`) | Either drop point 14 or backfill change records for the build |
| B38 | Definition of Stale = objective triggers | **Yes (defined)** | 8 objective triggers in the plan (source changed, dep interface changed, SHEET columns/retention/writers changed, RULE/CFG value changed, TRIGGER schedule changed, HANDOVER section changed, N commits behind, validation evidence aged out) | Nothing detects any of them | §L |
| B39 | Automation honesty — distinguish auto-detect vs human revalidation | **Yes** | The plan explicitly says steps 1–2,5–6 automatable / 7–10 human; "do not call this automated revalidation" (Confirmed) | — | Keep this discipline in any build |
| B40 | Fail visibly when automation can't establish correctness | **No** | `check-docs-coverage.js` exits 0 always, `continue-on-error: true` | The one check that exists cannot fail | On graduation (`DOC-039` done → now), flip `continue-on-error` off for at least the file-coverage check |

---

## C. Complete scope matrix

Legend: ✔ yes · ~ partial · ✘ no · — N/A. "Chg-det" = automated change
detection. "Auto-reval" = automated stale-marking + task creation.

| Scope item | In repo? | Documented? | Stable ID? | Source-linked? | Arch-linked? | Dep-linked? | Validation defined? | Evidence? | Chg-det? | Auto-reval? | Handover impact noted? | Owner? | Lifecycle? | Gap | Required control |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `dashboard.html` (1) | ✔ | ✔ `DASH-001` | ✔ | ✔ | ✔ | ✔ | ✔ | ~ inline | ✘ | ✘ | ✔ | ✔ | — | HTML not in CI scope | add `dashboard.html` to a CI record→file check |
| `js/*.js` (24) | ✔ | ✔ `JS-001..024` | ✔ | ✔ | ✔ (`DASH-001`) | ✔ (INDEX + record, superset) | ✔ | ~ `frontend-harness.html` (not in CI) + `LOGIC_AUDIT` | ~ file-existence only, warn | ✘ | ✔ per record | ✔ Snehil | — code | file-coverage is the *only* covered dimension; add diff→ID |
| `.gs` production (13) | ✔ | ✔ `GS-001..013` | ✔ | ✔ | ✔ | ✔ | ✔ `Tests_*.gs` (in CI) | ✔ CI run | ~ file-existence only, warn | ✘ | ✔ | ✔ | — code | same |
| `Tests_*.gs` (15) | ✔ | ✘ (excluded, `DOC-007`) | — | — | — | — | — | — | — | — | — | — | — | **deliberate exclusion, documented** | none |
| `RmHierarchy.private.gs` | ✘ (gitignored) | ✘ (excluded, `DOC-007`) | — | — | — | — | — | — | — | — | ✔ (`HANDOVER.md` §4.3) | — | — | **deliberate exclusion, documented** | none |
| Functions (`FN-001..254`) | ✔ | ✔ in `## Significant functions` | ✔ | ✔ line refs | via owner | ~ ("Calls" column) | ~ via owning module | ~ | ✘ | ✘ | via owner | via owner | — | no check a new fn gets an `FN-` | optional CI fn-count check |
| Dashboard tabs (`TAB-001..008`) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ~ | ✘ | ✘ | ✔ | ✔ | — | **not in any CI check** | record→file + `INDEX` row check |
| Buttons (`BTN-001..022`) | ✔ | ✔ sub-table | ✔ | ✔ selector + `FN` | via `TAB` | via `TAB` | ~ | ~ | ✘ | ✘ | via `TAB` | via `TAB` | — | UI drift undetected | manual (`PRE_SHIP` checklist) |
| Non-button UI (`UI-001..014`) | ✔ | ✔ sub-table | ✔ | ✔ | via `TAB` | ~ | ~ | ~ | ✘ | ✘ | via `TAB` | via `TAB` | — | same | same |
| Sheet tabs (`SHEET-001..014`) | ✔ (live Google Sheet) | ✔ | ✔ | ✔ (source constants) | ✔ | ✔ | ✔ | ~ | ✘ | ✘ | ✔ | ✔ | ~ (7 `TBD`) | **not in any CI check; 7 unknown retention** | record→file impossible (external); needs a manual "Sheet structure changed?" checklist item |
| Ranges / named ranges / filter views | ✔ (assumed none significant) | ✘ (`RANGE-` unused) | ✘ | — | — | — | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | **Unknown/Evidence Required** | inspect live Sheet once; record "none significant" or add records |
| Formulas in Sheet | ~ | ✘ | ✘ | — | — | — | ✘ | ✘ | ✘ | ✘ | ✘ | — | — | **Unknown/Evidence Required** — asserted rare, not verified | same |
| Integrations (`EXT-001..004`) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ~ | ✘ | ✘ | ✔ | ✔ | — | CDN lib version bump undetected | dependabot-style check or `PRE_SHIP` item |
| Triggers / scheduled jobs | ✔ (in live Apps Script) | ✔ prose (`## Trigger schedule`) | ✘ (`TRIGGER-` unused) | ✔ (`setupXxx()` refs) | ~ | ✔ | ~ | ~ | ✘ | ✘ | ✔ | ✔ | — | no single trigger index; schedule change only caught by `Tests_*.gs` if asserted | a `TRIGGER-` index table |
| Data flows (`DATA-001..005`) | ✔ (traced) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ~ | ✘ | ✘ | ✔ | ✔ | — | **not in any CI check** | manual |
| Business rules (`RULE-`×87) | ✔ | ✔ | ✔ | ✔ | via owner | ~ | ~ (`consistency-check.md` did a live pass) | ~ | ✘ | ✘ | via owner | via owner | — | cross-runtime twin drift only caught if `Tests_*.gs` asserts the constant | keep the `consistency-check.md` pass as a revalidation ritual |
| Config (`CFG-`×116) | ✔ | ✔ | ✔ | ✔ | — | ✔ (twin column) | ~ | ~ | ✘ | ✘ | ✔ (§6 pairs) | via owner | — | same | same |
| Exceptions (`EXC-`×208) | ✔ | ✔ | ✔ | ✔ | — | — | ~ | ~ | ✘ | ✘ | — | via owner | — | — | — |
| Comments w/ system knowledge | ✔ | ~ (ad hoc) | ✘ | ✔ (file refs where captured) | — | — | ✘ | ✘ | ✘ | ✘ | ~ | — | — | **no systematic pass** — §E is the first | add a `## Meaningful comments` field where needed |
| `FLOW-` architecture records | ✘ (0) | ✘ | — | — | — | — | — | — | — | — | — | — | — | **defined, never created** | write the 2–3 real ones |
| `docs/changes/` records | ✘ (0) | — | — | — | — | — | — | — | — | — | — | — | — | **DoD point 14 unmet everywhere** | backfill or drop the requirement |
| `docs/validation/` records | ✘ (0) | — | — | — | — | — | — | — | — | — | — | — | — | **evidence is inline only** | populate for at least the CI tasks + `DATA-005` HIGH finding |
| `docs/architecture/` records | ✘ (0) | — | — | — | — | — | — | — | — | — | — | — | — | empty stub | see `FLOW-` |
| `docs/_archive/` | ✘ (0) | — | — | — | — | — | — | — | — | — | — | — | — | correct — nothing retired | none |
| Goals / Requirements | `g-docproject01` goal only | ~ | ✔ goal id | — | — | — | — | — | — | — | — | ✔ | — | **no requirement IDs; DOC tasks not goal-linked** | §D |
| Tasks (`DOC-`, `CI-`, `TASKFLOW-`, `t-tf-`) | ✔ `tasks.json` | ✔ | ✔ | ~ (task note references commits) | — | — | ~ | ~ (resolution notes) | — | — | — | ~ | — | not linked to the records they produced | add `goalId` + a `produces:` list, or accept the loose coupling and document it |

---

## D. Traceability audit

Chain the brief wants: `Goal ↔ Requirement ↔ Task ↔ Component ↔ Source ↔
Dependency ↔ Data lineage ↔ Architecture ↔ Validation ↔ Change ↔ Handover`.

| Link | State | Evidence | Missing |
|---|---|---|---|
| Goal ↔ Task | **Broken** | `g-docproject01` exists; all 50 `DOC-0xx` tasks have `goalId: null` (Confirmed, `tasks.json`) | tasks are not attached to the goal; the goal's completion note (added this session) is the only tie |
| Requirement ↔ anything | **Absent** | There are no requirement IDs anywhere. The brief's "requirement" maps loosely to the plan's Goals 1–6 | no `REQ-` concept; no record says "satisfies Goal 3" |
| Task ↔ Component | **Weak** | `DOC-027` "created" `JS-001..011`; recorded only in each record's `## Version / change reference` prose ("record created by DOC-027") | no structured `produces:`; can't query "which task made `SHEET-009`" without grep |
| Component ↔ Source | **Strong** | every record `## Source of truth` = file + `#Lnn` | `Last Verified` commit is `c82ec67` for all — will lie the moment code moves |
| Component ↔ Dependency (both ways) | **Strong (today)** | `INDEX.md` reciprocal; records now supersets (this session) | 57 record-only edges still one-directional (`reciprocity-normalisation-notes.md`) — decision pending |
| Component ↔ Data lineage | **Strong** | `DATA-001..005` + `JS-018 ## Data Lineage` | — |
| Component ↔ Architecture | **Partial** | client records → `DASH-001`; `.gs` records → no `DASH-`/`FLOW-` (there is no backend `DASH-`) | backend half has no architecture anchor record; `FLOW-` empty |
| Component ↔ Validation | **Partial** | inline `## Validation` | no `docs/validation/` artifact to link |
| Component ↔ Change | **Broken** | `docs/changes/` empty | no change→stale→task trail exists |
| Component ↔ Handover | **Strong** | every record `## Handover relationship` states the section + whether current; `handover-coverage-map.md` maps it | several say "current as of 2026-09-09" — a date, not a check |
| Change ↔ affected records | **Absent** | no mechanism | the core closed-loop gap |
| Validation result ↔ exact version tested | **Partial** | records name `c82ec67`; CI runs cited as "#51/#53" | run numbers not URLs; will age out |
| Handover statement ↔ underlying records | **Partial** | `handover-coverage-map.md` is the bridge | one-directional (map → sections); a `HANDOVER.md` edit doesn't ping the records |

**Net:** downstream half of the chain (Component→Source→Dep→Data→Handover) is
solid; the upstream half (Goal→Requirement→Task→Component) and the
change/validation-artifact half are weak-to-absent.

---

## E. Comment audit

Full scan of `js/*.js` + `*.gs` (excluding `Tests_*.gs`) for `TODO|FIXME|XXX|
HACK|@deprecated|WORKAROUND|for now|temporary`. The codebase is **unusually
clean of markers** — 0 literal `TODO`/`FIXME`. The meaningful hits:

| Location | Comment (paraphrased) | Class | In the catalog? | Action |
|---|---|---|---|---|
| `js/reports-ui.js:204` & `EmailInfra.gs:30` | `TEMPORARY TEST OVERRIDE — leave '' for real sends` (`TEST_MODE_OVERRIDE_EMAIL` / `_`) | **temporary workaround + security-relevant** (a non-empty value silently redirects every real email) | ~ — it's a `CFG-` and in the cross-runtime pair list (`RELATIONSHIP_MAP.md` §2), but its *"must be '' in prod"* operational meaning is not called out as a risk | Add an `EXC-`/risk note to `JS-016` + `GS-004`: "non-empty in prod = all mail misrouted; check before every deploy" (belongs in `OPS_CHECKLIST.md` too) |
| `js/core-outcome-engine.js:659` | "Despite the name (kept for now to avoid touching every call site …)" | **naming debt / rationale** | ✘ | one line in the owning `FN-` row's notes: "name is legacy, semantics differ — see comment" |
| `MovementTracker.gs:536` | "A day missed on one run (a trigger failure, a temporary error) is [tolerated / self-heals]" | **operational behaviour not obvious from code** | ~ — `SHEET-002` mentions the machine-clock-relative prune (`EXC-074`); the self-heal-on-miss behaviour is not stated | add to `GS-008` `## Exceptions` |
| `OvernightEmailer.gs:75` | "…fixed address than resolve per-RM for now, or leave it blank once …" | **implementation rationale + a latent config decision** | ✘ | note in `GS-010` / `SHEET-006` `## Assumptions` |
| `DailyRmIssueLog.gs:34` | "`setupXxx` in this project" (doc-comment, benign) | informational | — | none |
| `js/tab-movement.js:6` | "remaining inline script for now, alongside the other …" | **structural note** (there is still inline JS in `dashboard.html`) | ~ — `DASH-001 ## HTML/CSS structure` should mention inline `<script>` blocks | verify + note in `DASH-001` |

**Comment change-control:** none exists (B22). **Recommendation:** the diff→ID
CI step (P1) should additionally flag a changed line that contains a
cross-runtime-pair marker (`_GS_`, `HEADER_ALIASES`, `OUTCOME_RULES`, …) or a
`RULE-`/`CFG-` constant name, and the `PRE_SHIP` checklist should carry one
line: *"did an explanatory comment near your change become false?"* — the
stale-comment-vs-changed-code case (B23) cannot be caught mechanically.

---

## F. Automation audit

| Capability | State | Detail |
|---|---|---|
| **Automatically detected** | New `js/*.js` / `.gs` file with no record | `check-docs-coverage.js` Check 1, **warn-only**. Nothing else. |
| | HANDOVER.md age > 14 days | Check 2, warn-only. |
| **Automatically tracked** | — | Nothing writes to `INDEX.md`, `tasks.json`, or any record automatically. |
| **Automatically marked stale** | — | No code path sets any record/row to `Stale`. |
| **Automatically task-created** | — | Revalidation tasks are a design (`update-tasks.ps1` exists and is used **by hand**). |
| **Automatically validated** | `Tests_*.gs` via `run-gs-tests.js` (blocking) | Validates the `.gs` *logic*, not that a *record* matches code. `frontend-harness.html` is **not** in CI. |
| **Automatically updated machine metadata** | — | `Last Verified`, coverage snapshot, INDEX rows: all hand-edited. |
| **Human semantic review** | `PRE_SHIP_DOCUMENTATION_CHECKLIST.md` (`DOC-049`), the 3 `HOW_TO_*` guides | Entirely opt-in; nothing points a session at them except `CLAUDE.md` prose. |
| **Human approval / closure** | Whoever edits a record flips its `INDEX.md` row + `Last Verified` | No second-person review; author == approver. |
| **Currently unprotected** | code change to an existing file; any `TAB-`/`SHEET-`/`EXT-`/`DATA-`/`FN-`/`BTN-` change; comment change; Sheet-structure change; trigger-schedule change; dependency-interface change; `Last Verified` drift; retired/renamed/moved file; INDEX↔record divergence; validation evidence ageing | This is the majority of the brief's "should detect" list. |

**Safe to automate now (Recommendation):** file→record coverage as a *hard*
gate for `js/*.js` + `.gs` (graduation criterion `DOC-039` is met); a
record→file reverse walk; an `INDEX.md`-internal reciprocity check; a
`Last Verified`-commit-vs-`HEAD`-on-`Location`-path check; the diff→ID
resolver (needs `fetch-depth: 0`). **Must stay human:** deciding whether a
changed function still matches its `FN-` description; whether a comment went
false; whether a `TBD` retention is now known.

---

## G. CI-001–CI-005 audit

Single script `test/check-docs-coverage.js`, single workflow step, `continue-on-error: true`.

| Check | Detects | Does **not** detect | Evidence | Failure behaviour | Owner | Required improvement |
|---|---|---|---|---|---|---|
| **Check 1 — file↔record coverage** | a `js/*.js` or production `.gs` file with no `docs/js-modules|gs-modules/*-<slug>.md` | anything about `TAB/SHEET/EXT/DATA/FN/BTN/UI`; a record whose file was deleted/renamed/moved; a *changed* file; ID assigned/unique/in-INDEX; cross-refs | GH Actions log lines; run #51/#53 cited in the plan | **none** — prints, exits 0, `continue-on-error` | Snehil | (a) flip to hard-fail now that coverage is 100% (`DOC-039` done); (b) add the reverse walk (record→file); (c) extend to `TAB/SHEET/EXT/DATA` by parsing `INDEX.md` |
| **Check 2 — HANDOVER.md freshness** | `updated YYYY-MM-DD` in the header is > 14 days old | whether a *specific* change should have touched it; whether §-level content is stale; anything about `docs/` records | log line; currently "2026-09-09, 1 day — OK" | none | Snehil | when `docs/RELATIONSHIP_MAP.md` takes over the living-arch role, point the check there too; keep the age warning |
| **(P1, unbuilt) diff→ID** | "a documented path changed, no revalidation task" | — | — | — | Snehil | build: `fetch-depth: 0` + resolve `git diff --name-only` against `INDEX.md` `Location` column → mark rows `Stale` → open one `update-tasks.ps1` task |
| **(unbuilt) INDEX reciprocity** | a one-directional `Depends On`/`Used By` in `INDEX.md` | — | `DOC-040` ran it once by hand (python) | — | Snehil | commit the `DOC-040` python check as `test/check-index-reciprocity.js`, run it in the same step |
| **(unbuilt) Last-Verified drift** | record `## Version / change reference` commit is behind `HEAD` on its `## Location` path | — | — | — | Snehil | per Definition-of-Stale trigger 7 |

**Together, do CI-001–005 protect against documentation drift?** *Barely.*
They catch exactly one drift class (a brand-new `.js`/`.gs` file nobody
documented) and only warn. Every other drift class in the brief is
unprotected. This is **consistent with the plan's own honest scoping** —
`CI-001`'s design note and the plan's CI evaluation both say so — but the
brief's bar ("continuously tested rather than asserted once") is not met.

**New CI checks that should exist** (priority in §L): reverse walk;
diff→ID+stale+task; INDEX reciprocity; Last-Verified drift; `INDEX.md`
coverage-snapshot self-consistency (the footer is stale — a check would have
caught it); `frontend-harness.html` in CI.

---

## H. Document-relationship audit

| Document | Single responsibility | Authoritative for | Derived / mirrors | Drift risk today |
|---|---|---|---|---|
| `DOCUMENTATION_PROJECT_PLAN.md` | the plan + the governance framework | *what a `DOC-xx` task is for*; the taxonomy; the DoD/Stale/Change-Control definitions | — | **HIGH — its "Current-State Audit / Task Audit / Dead-End Register / Priority Actions" describe the pre-build state** (all 50 tasks "Not Started", "docs/ contains one .pptx"). Reader who trusts it is badly misled. |
| `docs/INDEX.md` | the master component table + how the catalog works | each component's `Record Status` + `Last Verified`; the reciprocal dep graph | master table rows mirror each record's header | **MEDIUM — footer "Coverage snapshot / Still open" lags** (says DOC-035/036/Phases 5–6 open; all done). Master table itself is current. |
| component records (`docs/<type>/<ID>-<slug>.md`) | one component's full current picture | that component's purpose/IO/deps/logic/validation/revalidation | `Depends On`/`Used By` now mirror `INDEX.md` (superset) | LOW today (no code drift since `c82ec67`); HIGH structurally (nothing re-checks them) |
| `HANDOVER.md` | onboarding narrative + incident history (§8) | *current living architecture* (§1–§3, per `CONSOLIDATED`, until `docs/` takes over) | — | **MEDIUM — §9.7 (`documentation-conflicts.md` C-5) still describes a shipped redesign as "in progress"**; §9.3/§9.3.1 function names (C-6) unverified |
| `LOGIC_AUDIT.md` | frozen point-in-time audit (2026-09-07) | *what was true on that date* | — | LOW — frozen by design; `DOC-050` pointer added; header fixed (`14ef03f`) |
| `docs/RELATIONSHIP_MAP.md` | consolidated dependency view + the `DOC-035` reciprocity walk record | the cross-runtime pair list; the reciprocity walk status | §1/§3 mirror `INDEX.md`; §5 updated this session | LOW (just refreshed) |
| `docs/_planning/*.md` | one-time Phase-1/4/5 working artifacts | the inventories + conflict/verification records *as of when run* | mirror the records | LOW — explicitly dated working docs; `README.md` frames them as retroactive |
| `docs/_planning/OPEN_ITEMS.md` | the living hand-off tracker | what the build could not resolve | — | LOW — actively maintained (updated this session) |
| `tasks.json` (To-Do Dashboard) | every task's open/closed state | task status; `g-docproject01` goal | — | LOW |
| `CLAUDE.md` | the active rules a session must follow | the gotchas + "update HANDOVER in the same commit" rule + the doc-coverage pointer | — | LOW (just refreshed, Task 1) |
| `OPS_CHECKLIST.md` / `LEAD_FOLLOWUPS_STALENESS.md` | proactive operational checks, scoped | their domains | — | LOW |

**No two documents claim the same source-of-truth responsibility** — the
Source-of-Truth Table enforces this cleanly. The problem is not overlap; it
is **three of them (plan governance section, `INDEX.md` footer, `HANDOVER.md`
§9) are out of date against reality**, i.e. the "no doc contradicts another"
property holds by design but is violated in fact.

---

## I. Dead-end register

| Item | Dead end | Cause | Impact | Fix | Automation opportunity | Owner |
|---|---|---|---|---|---|---|
| `docs/changes/` | every record → "change record that closed me" → **nothing** | folder created empty; DoD point 14 never enforced | no change→stale→revalidation trail exists; the loop's audit output is missing | backfill a single `changes/2026-09-10-build.md` for the whole build; require one per future revalidation | the diff→ID step can template it | Snehil |
| `docs/validation/` | every record `## Validation` → evidence → inline prose, no linkable artifact | folder created empty | "show me the proof `SHEET-002`'s columns are right" → read a paragraph citing a frozen audit | populate for the CI tasks + `DATA-005` HIGH finding + the 2 confirmed-retention SHEETs | link the real CI run URL | Snehil |
| `docs/architecture/` (`FLOW-`/`TRIGGER-`) | plan names "the 4×/day Movement hub", "the 3-phase Generate cycle" as `FLOW-` examples → **no record** | Phase 3 tail / Phase 6 never wrote them | cross-file workflows have no home; a reader chasing "the Generate cycle" hops 4 records with no anchor | write `FLOW-001` (Movement hub + piggybacks), `FLOW-002` (Generate cycle) | — | Snehil |
| `DOC-0xx` task → the record(s) it produced | `goalId: null`; "created by DOC-027" only as prose | tasks were opened before the goal; no `produces:` field | can't answer "what did DOC-029 deliver" without grep | add `goalId` + a `produces:` list on the closed tasks (one `update-tasks.ps1` pass) | — | Snehil |
| `INDEX.md` footer | "Still open: DOC-035 … Phases 5–6" → those are done | `DOC-040` rewrote the table, not the prose footer | a reader believes Phases 5–6 are pending | edit the footer to the real state | a self-consistency check (does the snapshot match the row counts + task states) | Snehil |
| plan governance section | "all 50 tasks Not Started / docs/ has one .pptx" → reality is 69 `Closed + Monitored` records | section added 2026-09-10 *before* the build session; never revisited | the system's own design doc misrepresents the system | add a dated "Post-build update" subsection, or mark the audit "(pre-build snapshot — see catalog)" | — | Snehil |
| `HANDOVER.md` §9.7 | "RM Performance redesign — in progress, 2026-09-04" → shipped + iterated | Phase-5 `HANDOVER.md` reconciliation (`handover-coverage-map.md` items 1–3) not done | biggest single stale claim in the living-arch doc | the C-5 fix (Phase 5) | Check 2 only sees whole-file age, not §-level | Snehil |
| `TAB-`/`SHEET-`/`EXT-`/`DATA-` records | none is referenced by any CI check | CI walks `js/`+`.gs` only | a deleted tab / renamed Sheet / dropped integration leaves a trusted-looking record | reverse walk + `INDEX.md`-driven coverage | yes | Snehil |
| `Last Verified: c82ec67` on all 69 | record → "still accurate?" → a commit hash with nothing comparing it to `HEAD` | no drift check | on the first code change, every record silently becomes "possibly stale" with no signal | Definition-of-Stale trigger 7 as a CI check | yes | Snehil |
| `RANGE-`/`HTML-`/`CSS-`/`CLASS-` prefixes | taxonomy → "instances" → none, and no "excluded because" note | defined for completeness, never needed | a future contributor wonders if coverage is missing | one line each in `NAMING_CONVENTIONS.md`: "defined; no instance; add when a real one appears" | — | Snehil |
| `frontend-harness.html` | `JS-xxx ## Validation` cites it as *the* evidence → it never runs in CI | needs a browser | JS-side "validation evidence points at a test that … aged out" is a live Definition-of-Stale trigger from day 1 | wire it (headless) or downgrade the claim to "manual, pre-ship" | — | Snehil |

---

## J. Stale-risk register

| Item | What makes it stale | Detection today | Revalidation path today | Owner |
|---|---|---|---|---|
| Any `JS-`/`GS-` record | edit to its `## Location` file | **none** (file-coverage only sees *new* files) | manual `PRE_SHIP` checklist | Snehil |
| Cross-runtime pairs (`HEADER_ALIASES`↔`_`, `OUTCOME_RULES`↔`_GS_`, `RM_PERF_*`↔`_GS_`, IST helpers, `TEST_MODE_OVERRIDE_EMAIL`↔`_`, `CONFIG`↔`Core.gs`, `enrichLead`↔`computeSlaFlags_`) | edit one side only | `Tests_*.gs` **iff** it asserts the specific constant; otherwise none | `consistency-check.md` manual re-pass | Snehil |
| `SHEET-` record columns | backend changes a `*_COLUMNS_` constant | `Tests_*.gs` for the writer iff asserted | manual | Snehil |
| `SHEET-` retention (7 `TBD`) | a `prune*_` fn added, or a product decision | none | `retention-decisions-needed.md` + `OPEN_ITEMS.md` §B | Snehil |
| `GS-` trigger schedule | `setupXxx()` edited / re-run | `Tests_*.gs` iff asserted; live Apps Script editor is the real state | manual + `OPS_CHECKLIST.md` for the email ones | Snehil |
| `EXT-004` (jsPDF/autotable) | CDN version bump in `dashboard.html` | none | manual | Snehil |
| `HANDOVER.md` §1–§3 (living arch) | any architectural change | Check 2 (14-day age, coarse) | `CLAUDE.md` "same commit" rule (has failed before) | Snehil |
| `DATA-005` HIGH finding (Loan-region override, no `.gs` twin) | the twin gets written, or the client override changes | `## Next action` + revalidation trigger in the record | manual | Snehil |
| Every record's `Last Verified` | any commit on its `Location` path after `c82ec67` | **none** | manual | Snehil |
| `INDEX.md` reciprocity | a record edited without updating both ends | `DOC-040` python check (not committed, not scheduled) | manual re-run | Snehil |
| 57 record-only `Depends On`/`Used By` edges | already one-directional | `reciprocity-normalisation-notes.md` documents them | Snehil's prune-vs-expand decision | Snehil |
| Meaningful comments (§E) | code changes, comment doesn't (or vice versa) | none | `PRE_SHIP` checklist (proposed) | Snehil |
| The plan's governance section | the catalog progressed past it (already happened) | none | this audit | Snehil |
| CI `check-docs-coverage.js` scope | a new taxonomy type is added | none | re-read `CI-001..005` (their own revalidation trigger, per the plan's Task Audit) | Snehil |

---

## K. Missing-control register

| Missing control | Risk it leaves open | Priority | Recommended implementation | How to verify it works |
|---|---|---|---|---|
| diff → component-ID resolver in CI | code changes with no doc review — the brief's #1 requirement | **P0** | `fetch-depth: 0` on `actions/checkout`; new step: `git diff --name-only $BEFORE $AFTER` → match each path against `INDEX.md` `Location` column → print affected IDs; a path with no row = "undocumented component" (fail) | push a 1-line change to `js/core-ui.js` → run flags `JS-010` + its 1-hop deps |
| auto-mark-stale + one revalidation task per push | detection without action = ignored | **P0** (with the above) | on ≥1 affected ID: set those `INDEX.md` rows to `Stale`, open one `update-tasks.ps1` task "Revalidate <IDs> after <sha>" with `Owner` from the records | the same test push opens exactly one task and flips the rows |
| record → file reverse walk | retired / renamed / moved file → orphan record trusted forever | **P1** | extend `check-docs-coverage.js`: for each `docs/{js,gs}-modules/*.md`, assert its slug maps to a real file; later, parse `INDEX.md` `Location` for all 69 | delete a `.js` file in a test branch → its record is flagged |
| `INDEX.md` internal reciprocity check | a hand-edit breaks a back-link silently | **P1** | commit the `DOC-040` python as `test/check-index-reciprocity.js`; run in the same CI step; non-zero on any asymmetry | remove one `Used By` entry → check fails |
| `Last Verified` drift check | every record silently decays after the first code change | **P1** | per record, `git log -1 --format=%H <Location>` vs the commit in `## Version / change reference`; warn if behind, fail if > N commits behind on that path | advance a file by 2 commits → its record warns |
| flip `check-docs-coverage.js` Check 1 to hard-fail | the graduation criterion (`DOC-039`) is met but the check still can't fail | **P1** | remove `continue-on-error: true` for the coverage step; keep Check 2 as warn | delete a record in a test branch → build fails |
| `INDEX.md` self-consistency check (snapshot vs rows vs tasks) | the footer went stale and nothing noticed | **P2** | assert the "Coverage snapshot" counts equal the actual row counts per prefix; assert "Still open" items map to non-`Completed` tasks | the current stale footer fails it |
| `FLOW-` / `TRIGGER-` records | cross-file workflows and the trigger set have no anchor | **P2** | write `FLOW-001/002` + a `TRIGGER-` index table (prose is fine) | a reader can start at "the Generate cycle" and land on one record |
| `docs/validation/` + `docs/changes/` population | DoD points 7 & 14 unmet; no evidence artifacts, no change trail | **P2** | backfill one `changes/` record for the build; `validation/` for CI tasks + `DATA-005` + the 2 confirmed-retention SHEETs | DoD checklist passes for a sampled record |
| comment-change flag in the diff step | meaningful comments drift undetected | **P2** | in the diff step, flag a changed line containing a pair-marker or a `RULE-`/`CFG-` name | change an `OUTCOME_RULES` line → flagged |
| `frontend-harness.html` in CI | JS-side validation evidence is a test that never runs = stale from day 1 | **P2** | headless run (Playwright/puppeteer) of the harness page, assert `window.__harnessResults` | a deliberately broken `enrichLead` fails CI |
| second-person review on record closure | author == approver | **P3** | lightweight: a PR label / checklist, not a gate | — |
| `Owner:` distribution | single point of failure | **P3** | revisit when a team exists | — |
| requirement IDs / goal-linking of `DOC-` tasks | upstream traceability broken | **P3** | add `goalId` + `produces:` to the closed tasks; optional `REQ-` for Goals 1–6 | query "what satisfies Goal 3" returns records |

---

## L. P0 / P1 / P2 / P3 action plan

**P0 — the loop does not exist without these**
1. `fetch-depth: 0` + **diff→ID resolver** step in `test/check-docs-coverage.js`
   (Change-Control steps 1–2). Undocumented changed path ⇒ fail.
2. **Auto-stale + one revalidation task per push** (steps 5–6), via
   `update-tasks.ps1`. Owner from the affected records.
3. Fix the **3 live contradictions**: the plan's governance section (add a
   dated post-build update / relabel it a pre-build snapshot), the
   `INDEX.md` footer, and open a Phase-5 item for `HANDOVER.md` §9.7 (C-5).
   *(Trivial; do first — the authority docs currently lie.)*

**P1 — closes the "trusted forever" hole**
4. **record → file reverse walk** in CI (retired/renamed/moved detection).
5. **`INDEX.md` reciprocity check** — commit the `DOC-040` python as a test,
   run every push.
6. **`Last Verified` drift check** (Definition-of-Stale trigger 7).
7. **Flip Check 1 to hard-fail** (graduation criterion `DOC-039` is met).
8. Decide the **57 record-only edges** (`reciprocity-normalisation-notes.md`)
   — prune (recommended, `recip_apply4.py` ready) or expand `INDEX.md`.

**P2 — completes coverage + evidence**
9. `INDEX.md` **self-consistency check** (snapshot ↔ rows ↔ task states).
10. Write **`FLOW-001/002`** + a **`TRIGGER-` index**.
11. Backfill **`docs/changes/2026-09-10-build.md`** and **`docs/validation/`**
    for the CI tasks + `DATA-005` + confirmed-retention SHEETs.
12. **comment-change flag** in the diff step; add the stale-comment line to
    `PRE_SHIP_DOCUMENTATION_CHECKLIST.md`.
13. Wire **`frontend-harness.html`** into CI (headless).
14. **Extend coverage** checks to `TAB-`/`SHEET-`/`EXT-`/`DATA-` by parsing
    `INDEX.md` rather than the filesystem.
15. Resolve the **`RANGE-`/`HTML-`/`CSS-`/`CLASS-` exclusion note** in
    `NAMING_CONVENTIONS.md`; confirm-and-record "no behaviourally-significant
    Sheet formulas / filter views" (or add records).

**P3 — hardening**
16. `goalId` + `produces:` on the closed `DOC-`/`CI-`/`TASKFLOW-` tasks;
    optional `REQ-` IDs for Goals 1–6.
17. Second-person review signal on record closure.
18. Resolve the 7 `TBD` retentions (`retention-decisions-needed.md`) — needs
    a product decision, not code.
19. `Owner:` distribution — when a team exists.

---

## M. Target operating model

The end state the brief describes, made concrete for this repo. **Bold =
automated; plain = tracked human step.**

```
push
 └─► CI job (.github/workflows/test.yml, fetch-depth: 0)
      ├─ run-gs-tests.js                         (blocking, unchanged)
      ├─ check-docs-coverage.js  [hard-fail]
      │   • file → record coverage (js + gs + INDEX-driven TAB/SHEET/EXT/DATA)
      │   • record → file reverse walk
      │   • INDEX.md internal reciprocity
      │   • INDEX.md snapshot self-consistency
      │   • HANDOVER.md age (warn)
      └─ change-control.js  [new]
          1. DETECT   git diff --name-only BEFORE..AFTER
          2. RESOLVE  path → INDEX.md Location column → {IDs}
                      path with no row  ⇒  FAIL "undocumented component"
          3. IMPACT   for each ID: its 1-hop Depends On + Used By  (from INDEX)
          4. GATHER   + each ID's record, its docs/validation/ record,
                        its HANDOVER.md section, any cross-runtime twin,
                        any changed line matching a RULE-/CFG-/pair marker
          5. MARK     set those INDEX.md rows → Stale
          6. TASK     one update-tasks.ps1 task:
                      "Revalidate <IDs> after <sha>", Owner = from records
     ── automated boundary ───────────────────────────────────────────────
          7. UPDATE   human edits each record vs the real code at <sha>
          8. VALIDATE re-run the cited test / harness / live check
          9. EVIDENCE append a docs/validation/<ID>.md line (run URL + sha)
         10. RIPPLE   repeat 3–9 for anything step 7 itself changed
         11. RECONCILE update RELATIONSHIP_MAP.md + INDEX.md rows →
                      Closed + Monitored, new Last Verified + sha
         12. HANDOVER if the record's ## Handover relationship flagged a
                      section, edit it in THIS change (CLAUDE.md rule)
         13. CHANGE   write docs/changes/<date>-<sha>.md:
                      what changed · IDs staled · task · closure evidence
         14. CLOSE    when nothing new is Stale, the task closes;
                      monitoring (the CI steps above) resumes automatically
     ── after closure, forever ──────────────────────────────────────────
          • every later push re-runs steps 1–6 against the new HEAD
          • Last-Verified drift check re-flags any record whose Location
            path advanced without a revalidation
          • nothing is permanently trusted: Closed + Monitored is a
            resting state, not a terminal one
```

**Automated:** detection, ID resolution, impact set, stale-marking, task
creation, all coverage/reciprocity/drift checks, the audit-trail template.
**Human:** the actual re-verification against code, the validation re-run
judgement, the `HANDOVER.md` prose edit, closing the task.
**Fails visibly:** undocumented changed path; missing record; broken
reciprocity; snapshot mismatch; a revalidation task open past N days.

---

## N. Final verdict

1. **Does the project cover everything it claims to cover?**
   *One-time: yes, ~95%.* Every own-file component type is at
   `Closed + Monitored` with `FN-`/`BTN-`/`RULE-`/`CFG-`/`EXC-`/`UI-`/`API-`
   sub-tables populated; `INDEX.md` reciprocal; no code drift since
   `c82ec67`. *Continuously: no* — the maintenance loop that would keep it
   covered is designed and unbuilt (Confirmed).

2. **What is still outside scope?** `FLOW-`/`TRIGGER-` records (0);
   `docs/changes/` (0) and `docs/validation/` (0) and `docs/architecture/`
   (0); Sheet formulas / named ranges / filter views (asserted insignificant,
   **Unknown/Evidence Required**); the Apps Script manifest (out-of-repo);
   requirement IDs; goal-linking of `DOC-` tasks; systematic comment capture
   (§E is the first pass); `RANGE-`/`HTML-`/`CSS-`/`CLASS-` (defined, unused,
   no exclusion note).

3. **Can a new / changed / deleted component escape detection?**
   - *New `js`/`.gs` file:* caught, **warn-only** (Confirmed).
   - *New `TAB`/`SHEET`/`EXT`/`DATA`/`FN`/`BTN`:* **yes, escapes entirely.**
   - *Changed file (record exists):* **yes, escapes entirely** — no diff step.
   - *Deleted / renamed / moved file:* **yes, escapes** — no record→file walk.

4. **Can a meaningful comment escape detection?** **Yes.** No comment-aware
   check exists; the stale-comment-vs-changed-code case can't be caught
   mechanically at all (compensating control proposed: one `PRE_SHIP` line).

5. **Can architecture changes escape doc revalidation?** **Yes.** Only signal
   is `HANDOVER.md` crossing 14 days (coarse, whole-file, delayed).
   `HANDOVER.md` §9.7 is the live proof — a shipped redesign still reads
   "in progress."

6. **Can dependency changes escape impact analysis?** **Yes.** No interface-
   change detection; `INDEX.md`/records are a static snapshot with no
   re-derivation. A changed function signature marks nothing stale.

7. **Can handover become stale without detection?** **Yes, up to 14 days**
   for whole-file age; **indefinitely** at §-level (Check 2 is date-only).

8. **Can a task be marked Done without evidence?** **Yes.** All 50 `DOC-`
   tasks are `Completed` in `tasks.json`; DoD point 14 (`docs/changes/`
   record) is unmet for every one; `docs/validation/` is empty. Evidence is
   inline record prose, much of it citing a frozen audit or "hand-verified
   this session." The plan's own Task Audit calls the analogous CI/CONSOLIDATED
   closures "conditionally closed."

9. **Can validation become invalid without reopening the task?** **Yes.**
   `frontend-harness.html` (the cited JS evidence) isn't in CI; CI runs are
   cited by number; nothing re-checks that a cited test still exists/passes.
   `Closed + Monitored` never reverts to `Stale` automatically.

10. **Can a doc record become stale without generating action?** **Yes** —
    this is the central gap. No trigger from Definition-of-Stale is wired;
    `Last Verified: c82ec67` on all 69 with nothing comparing it to `HEAD`.

11. **Is there one authoritative central tracking mechanism?** **Yes, by
    declaration** — `docs/INDEX.md` for component state, `tasks.json` for
    task state, cleanly separated by the Source-of-Truth Table. **But
    nothing keeps `INDEX.md` honest**, and its own footer is currently stale.

12. **Are historical audits preserved, not confused with the living
    catalog?** **Yes (Confirmed).** `LOGIC_AUDIT.md` frozen, never edited
    forward, pointer-linked, header fixed; `INDEX.md` and the plan both state
    the three-doc split explicitly; `docs/_planning/*` are dated working
    artifacts. This is the project's strongest area.

13. **What must change before it can honestly be called continuously
    synchronized?** The **P0 + P1** set in §L:
    (a) `fetch-depth: 0` + diff→ID resolver;
    (b) auto-stale + one revalidation task per push;
    (c) record→file reverse walk;
    (d) `INDEX.md` reciprocity check committed + scheduled;
    (e) `Last Verified` drift check;
    (f) flip Check 1 to hard-fail;
    (g) fix the 3 live contradictions (plan governance section, `INDEX.md`
    footer, `HANDOVER.md` §9.7).
    Until (a)–(b) exist, "continuously synchronized" is **aspirational** —
    the system is a high-quality one-time snapshot plus a warn-only
    new-file tripwire.

---

### Evidence appendix (key Confirmed facts)

- `git log c82ec67..HEAD -- js/*.js *.gs dashboard.html` → **empty** (no code drift).
- `test/check-docs-coverage.js` → 2 checks, both warn-only, `process.exit(0)` always.
- `.github/workflows/test.yml` → coverage step has `continue-on-error: true`.
- `docs/changes/`, `docs/validation/`, `docs/architecture/`, `docs/_archive/` → README stub only, 0 records.
- Sub-record grep across records: `FN-` 254 unique / `EXC-` 208 / `BTN-` 121 mentions / `CFG-` 116 / `RULE-` 87 / `UI-` 28 / `API-` 10; `TRIGGER-`/`RANGE-`/`HTML-`/`CSS-`/`CLASS-` → 0.
- `tasks.json`: `DOC-001..050` all `Completed`, all `goalId: null`; `g-docproject01` goal carries the completion note added earlier this session.
- `DOCUMENTATION_PROJECT_PLAN.md` L112–L167 "Current-State Audit (2026-09-10)" states all 50 tasks Not Started / docs/ = one `.pptx` — pre-build snapshot, never updated.
- `docs/INDEX.md` L314–L318 "Still open: DOC-035 … Phases 5–6" — stale.
- `HANDOVER.md` header: `updated 2026-09-09` (1 day old → CI Check 2 = OK).
- Comment scan: 0 literal `TODO`/`FIXME`; meaningful hits in §E (6).
