# End-to-end acceptance test — Documentation Project (spec)

| | |
|---|---|
| **Status** | NOT YET EXECUTED — this file is the spec only |
| **Requested** | 2026-09-10 by Snehil |
| **Goal** | `g-e2eacctest01` — "E2E acceptance test of the Documentation Project" |
| **Structure** | 9 sequential parts (`t-tf-…`), each `depends_on` the previous — a part may not start until the one before is `Completed` |
| **Prereq** | the forensic-audit remediation (`t-tf-cc97c00a3839`, `t-tf-5ad22d8e4c2e` — P0/P1/P2/P3) is done and CI green; this tests **the system that now exists** |
| **Related** | `FORENSIC_COMPLETENESS_AUDIT_2026-09-10.md`, `FORENSIC_COMPLETENESS_AUDIT_BRIEF.md`, `test/check-catalog.py`, `DOCUMENTATION_PROJECT_PLAN.md` → Governance Model / Change-Control Mechanism |

> **This is an execution spec, not a planning exercise.** Test the system
> as built. Do **not** design more architecture unless a test proves the
> current architecture cannot meet the acceptance criterion. Every PASS
> needs **observable evidence that the behaviour occurred** — never "a
> script for it exists".

---

## The loop under test

```
CHANGE → DETECT → IDENTIFY → IMPACT ANALYZE
 → FIND: affected components / documentation / dependencies / validation / handover
 → MARK STALE → CREATE/UPDATE TASK → ASSIGN OWNER
 → UPDATE → VALIDATE → RECORD EVIDENCE
 → UPDATE central INDEX/tracking → UPDATE architecture links → UPDATE HANDOVER if required
 → CHECK DOWNSTREAM IMPACT → REVALIDATE → CLOSE + MONITOR
```

## Test principles (apply to every part)

1. Use the actual repo. 2. Work on a **safe isolated test branch** (never
`master`) / fixture / reversible environment. 3. Never corrupt production
data or permanently modify the real project to run the test. 4. Record
every action and the resulting state. 5. Do not assume a control worked
because its code exists — verify the observable result. 6. Test both
automated and human-required steps. 7. Deliberately introduce failures and
omissions. 8. Verify failures are **visible and actionable**, not silently
passing. 9. Cover deletion, creation, modification, rename, dependency,
comment, architecture, and handover changes. 10. Test whether a
previously-closed record becomes stale when its underlying truth changes.

Each part: create a branch off the current test branch (or reuse it),
make the changes, capture evidence (command output, `git` state,
`check-catalog.py` output, `tasks.json` deltas, record-file diffs), then
**revert the working changes** so the branch stays usable for the next
part. Do **not** push test changes to `master`. Keep a running
`docs/_planning/E2E_ACCEPTANCE_TEST_LOG.md` (created in Part 1) with a
dated entry per test.

Scope to cover where applicable: HTML, CSS, JavaScript, Apps Script,
functions, classes, modules, configuration, manifests, triggers, APIs,
integrations, UI components, buttons, menus, forms, Sheet files, Sheet
tabs, ranges, formulas, data sources, data destinations, workflows,
business rules, dependencies, data lineage, exceptions, error handling,
comments, TODOs, FIXMEs, warnings, documentation, architecture,
validation evidence, handover, task tracking. A deliberately-grouped
low-level item does **not** need its own record — but it must still be
**traceable**.

---

## The 9 parts

### Part 1 — Baseline inventory + environment (TEST 1; Final Output A)

Create the isolated test branch off `master`
(`git checkout -b e2e-acceptance-test`). Create
`docs/_planning/E2E_ACCEPTANCE_TEST_LOG.md`. Run every current check
(`node test/run-gs-tests.js` via a CI push if needed, `python3
test/check-catalog.py`, `node test/check-docs-coverage.js` — Node is not
local, note that). Record counts: source files (`js/*.js`, `*.gs`,
`dashboard.html`), documented files, functions (grep `^function` /
`^\s*function` per file) vs `FN-` rows, classes/modules, UI elements
(`BTN-`/`UI-`), Sheets + tabs (`SHEET-`), triggers
(`architecture/apps-script-triggers.md`), integrations (`EXT-`),
documented components (INDEX rows), tracked tasks (goal `g-docproject01`
+ `g-e2eacctest01`), validation records (`docs/validation/`), handover
records/references (`handover-coverage-map.md`). Record all current
warnings, the architecture/version id (HEAD sha + `HANDOVER.md` "updated"
date + `Last Verified` commit on the records), the catalog state
(`check-catalog.py` A–F result), and the CI state (latest `test` +
`frontend-harness` job conclusions). This is the measured baseline.

### Part 2 — Component lifecycle: add / modify / delete (TESTS 2, 3, 5)

**Add** an undocumented component (a new `js/*.js` or `.gs` function with
a real purpose, wired to an existing component, with a new dependency and
an output consumed elsewhere). Do **not** document it. Verify:
`check-catalog.py` E flags it as an "UNDOCUMENTED COMPONENT" on a diff
against baseline; check B flags the missing record; the type/location/
relationship are identifiable; a task or actionable failure is produced;
a stable ID can be assigned; the gap can be closed by the process.
**Modify** an existing `Closed + Monitored` component (signature /
behaviour / dependency / output / rule / config). Do **not** update its
record. Verify: the component + its record are identified; the prior
`Last Verified` commit no longer matches HEAD on its `## Location` path
(check D); it is (or should be) `Stale`; revalidation is required; a task
is generated/updated; downstream + handover impact are identified; the
old `Closed + Monitored` is **not** falsely trusted.
**Delete** a documented component (safely, on the branch). Verify:
check C flags the `Location` → missing file; the record is orphaned;
broken dependencies + downstream consumers are found; validation records
+ handover are flagged. Record evidence for each; revert.

### Part 3 — Rename/move + dependency + downstream + cascade (TESTS 4, 6, 18, 23)

**Rename/move** a component file. Verify: detected; the stable ID is
preserved (or migration is explicit, per `HOW_TO_RETIRE`); references
updated; broken links + dependent records identified; historical
traceability preserved; `INDEX.md` updated; **no** silent second
component while the old one still looks valid.
**Dependency change** — with `A → B → C`, modify **B** only. Verify the
system flags B changed, and A/C potentially affected where appropriate,
plus B's doc, dependents' docs, affected validation + handover — **not**
relying solely on "the dev remembered to update the dependent doc".
**Downstream failure** — change an upstream component in a way that
should affect a downstream one; verify the downstream component + its
doc are found, validation is requested, false closure is prevented, the
result is recorded.
**Full cascade (primary E2E)** — `A calls B → B writes Sheet C → C
consumed by D → D described in HANDOVER.md`; change A; trace
`A → B → C → D → docs → validation → handover`. Record the full trace.
Revert.

### Part 4 — Comments + UI + Sheets + Exceptions (TESTS 7, 8, 9, 10, 21)

**Comment change** — modify a meaningful comment (business rationale /
dependency / warning / TODO / FIXME / exception / workaround / retention
/ architecture). Determine: needs doc sync? needs validation? needs human
review? safe as source-only? Then introduce a comment that **conflicts
with the implementation** and check whether the system exposes the
inconsistency. **Comment escape test (TEST 21)** — insert TODO / FIXME /
business-rule / dependency / warning / workaround / exception /
operational-instruction comments; verify which the control (`check-catalog.py`
E pair-marker flag + the `PRE_SHIP` "did a comment go stale?" item)
identifies as needing treatment, and which genuinely escape.
**UI element** — add/modify a button / menu item / form / dialog / event
handler / link. Verify traceability: the element, what invokes it, what
it calls, its output, reason to exist, dependencies, validation, doc
status — no undocumented entry point.
**Sheet/tab change** — add a tab, rename a tab, remove a tab, change a
formula/structure, change a retention/lifecycle rule (all simulated —
there is no live Sheet in CI; use the `SHEET-` records + source
constants). For each affected tab verify: ID, purpose, reason to exist,
source, consumers, dependencies, logic, retention, lifecycle, validation,
automation, affected documentation.
**New exception** — introduce a new error/exception path; verify it is
documented (`EXC-`), handling documented, owner known, failure behaviour
defined, validation exists, remediation exists — no undocumented dead
end. Revert.

### Part 5 — Doc-only / architecture / handover / LOGIC_AUDIT (TESTS 11, 12, 13, 14)

**Doc-only change** — edit a component record without touching
implementation; verify the system can tell what changed, whether it is
allowed, whether source still matches the record, whether validation must
run, whether architecture links stay correct — docs must not drift
independently.
**Architecture change** — move responsibility between components / change
a dependency / introduce a new service / alter data flow / change
ownership; verify: architecture change → affected components → affected
documentation → affected validation → affected tasks → affected handover
→ revalidation. (`FLOW-001`/`FLOW-002`/`apps-script-triggers.md` are the
architecture surface.)
**Handover change** — change something described in `HANDOVER.md`; verify
the handover impact is detected, `HANDOVER.md` is flagged potentially
stale (the `check-docs-coverage.js` >14-day date check + the record's
`## Handover relationship`), the owner is identified, catalog + handover
stay consistent, closure requires updated evidence — the catalog does
**not** replace `HANDOVER.md`.
**LOGIC_AUDIT protection** — verify changes to the living system do **not**
turn `LOGIC_AUDIT.md` into a mutable source of truth: historical info
stays historical, current state lives in `docs/`, the cross-references
are clear, the audit is not silently rewritten. Revert.

### Part 6 — Governance gates: owner / evidence / revalidation / TBD (TESTS 15, 16, 17, 19)

**Missing owner (TEST 15)** — create a detected gap with no owner; the
system must **not** consider it closed; the missing owner is visible;
closure is prevented; remediation is required.
**Missing evidence (TEST 16)** — a record with `Validated` status but no
evidence link; the state must be rejected or downgraded — a label is not
evidence.
**Invalid revalidation (TEST 17)** — change a component after validation,
then try to close the task **without** re-validating against the new
version; closure must fail.
**TBD data (TEST 19)** — a component / Sheet tab with an unknown required
property (retention); verify the system records `TBD` (never invents an
answer), creates an actionable task, assigns an owner, defines required
evidence, and keeps the uncertainty from disappearing
(`retention-decisions-needed.md` + `OPEN_ITEMS.md` §B are the pattern).
Record which gates are enforced by code vs. by process. Revert.

### Part 7 — Escape & false-pass battery (TESTS 20, 22, 24; FALSE-PASS TESTING)

**New-file escape (TEST 20)** — create unregistered `.html`, `.css`,
`.js`, `.gs`, a config file, a doc file; verify which the coverage system
catches and which escape.
**Orphan test (TEST 22)** — create: documentation with no implementation;
component with no documentation; task with no output; output with no
consumer; validation with no current implementation; handover reference
to a stale component. Verify each orphan is detected + made actionable.
**Failure injection (TEST 24)** — deliberately bypass/break each control
where safe: skip doc update; skip validation; skip owner; skip handover
update; modify source without changing version metadata; break a doc
link; remove a record; falsify a validation status. For each, verify the
system fails **visibly**, not silently.
**False-pass battery** — actively try to fool the system into treating as
valid: undocumented new function; documented nonexistent function; stale
dependency; stale handover; incorrect comment; missing validation;
wrong validation version; orphaned documentation; untracked Sheet tab;
untracked button; untracked exception; missing owner; false `Done`.
Record every case the system misses. Revert everything.

### Part 8 — Clean recovery + automation verification (TEST 25; AUTOMATION VERIFICATION)

For a representative subset of the intentional failures from Parts 2–7:
(1) correct the underlying issue; (2) run the required validation;
(3) update evidence; (4) update central tracking (`INDEX.md` row +
`Last Verified`); (5) update dependencies; (6) update architecture
references; (7) update handover where applicable; (8) re-run all relevant
checks; (9) confirm the system returns to a **legitimate**
`Closed + Monitored` — and that the recovery itself is traceable
(a `docs/changes/` record, a closed task with evidence).
Then fill the **automation matrix** — one row per control:
`Control | Expected automatic behaviour | Actually happened? | Evidence |
Failure mode | Human intervention | Gap` — classified
`PASS / PARTIAL / FAIL / NOT AUTOMATED / NOT APPLICABLE`. A PASS needs
observed evidence, not "a script exists". Revert.

### Part 9 — Final report + verdict (Final Output B–K)

Assemble `docs/_planning/E2E_ACCEPTANCE_TEST_REPORT.md`:
- **B** Test results table: `Test | Expected | Actual | Evidence | Result | Severity`.
- **C** Automation results table.
- **D** Escape paths found — every way a meaningful change can currently
  bypass detection / documentation / validation / tracking / handover /
  closure.
- **E** False-pass results — every case the system wrongly allowed.
- **F** Dead-ends: `Item | Dead end | Detection | Remediation | Result`.
- **G** Coverage metrics, **reported separately** (do not blend): inventory,
  documentation, stable-ID, dependency, validation, evidence,
  change-detection, stale-detection, handover, comment, CI, recovery
  coverage — evidence-backed numbers only where real counts exist.
- **H** Critical failures ranked P0 / P1 / P2 / P3.
- **I** Required fixes: exact problem, root cause, smallest effective fix,
  owner, validation, expected evidence — for every failed/partial test.
- **J** Retest plan: the exact test to rerun after each correction.
- **K** Final verdict — **PASS / PASS WITH CONDITIONS / FAIL** — then
  explicitly answer the 16 questions:
  1. Can a new meaningful component escape detection?
  2. Can a changed component remain falsely `Closed`?
  3. Can a dependency change escape impact analysis?
  4. Can an architecture change escape revalidation?
  5. Can a meaningful comment escape the control system?
  6. Can a button/UI element escape documentation?
  7. Can a Sheet/tab escape documentation?
  8. Can an exception escape documentation?
  9. Can validation exist without evidence?
  10. Can evidence refer to the wrong implementation/version?
  11. Can handover become stale silently?
  12. Can an orphaned record remain unnoticed?
  13. Can a task be closed without all required evidence?
  14. Does failure reliably return to remediation?
  15. Does recovery reliably return to validated closure?
  16. Is the system genuinely continuously synchronized?

Delete the `e2e-acceptance-test` branch when the report is committed
(to `master` — the report is a deliverable, the test changes are not).
Do **not** recommend more architecture unless a test demonstrates the
current architecture cannot satisfy:

> *"Introduce a meaningful change anywhere in the system, and the
> documentation architecture must either automatically update the
> machine-derived state or automatically identify every affected item
> that requires human review. No meaningful change may silently pass
> through as if nothing changed."*

---

## PASS / FAIL criteria (Part 9 verdict must check all 21)

The system passes only if: (1) new meaningful components cannot silently
appear undocumented; (2) deleted components cannot leave silently valid
docs; (3) renamed/moved components preserve traceability; (4) meaningful
dependency changes propagate to affected records; (5) architecture
changes trigger impact analysis; (6) doc changes can be checked against
implementation; (7) meaningful comments are not an uncontrolled knowledge
escape; (8) UI elements are traceable; (9) Sheets/tabs are traceable;
(10) exceptions are traceable; (11) validation is evidence-backed;
(12) validation is tied to the correct version; (13) stale items become
visible; (14) stale items become actionable; (15) failed validation
prevents false closure; (16) handover staleness is detectable;
(17) `LOGIC_AUDIT.md` stays historically reliable; (18) central tracking
stays synchronized; (19) every failure has an owner/remediation path;
(20) recovery returns the system to a verifiably valid state;
(21) the system does not silently accept an incomplete state.

A failure that **requires human review** is acceptable **only** if the
change is still detected, owned, traceable, and produces an explicit
review decision. A change that occurs **silently** — no detection, no
owner, no traceability, no review — is a FAIL.
