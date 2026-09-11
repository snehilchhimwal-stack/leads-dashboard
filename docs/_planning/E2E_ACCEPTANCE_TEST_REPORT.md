# E2E Acceptance Test — Final Report

**Spec:** `docs/_planning/E2E_ACCEPTANCE_TEST_SPEC.md`. **Full working
log (every command, every output):**
`docs/_planning/E2E_ACCEPTANCE_TEST_LOG.md` (1,300+ lines, 8 parts).
**Run:** 2026-09-11, on branch `e2e-acceptance-test` (baseline `master`
@ `58d165c`; catalog code frozen at `c82ec67` for the entire test).
**Method:** every intentional failure was a real, committed change on
the test branch, verified with `python3 test/check-catalog.py <before>
<after>`, evidence captured verbatim, then reverted before the next
test — except Part 8's recovery drills, which were carried through to
a genuinely resolved state before their own revert. **Nothing in this
report was pushed to `master`** except this file itself.

**Test count:** 25 named tests (TEST 1–25) + a 13-item false-pass
battery, across 9 parts. **27 escape-path findings**, numbered
sequentially as they were discovered (Parts 2–8), referenced
throughout as **F1–F27**.

---

## Remediation status (updated 2026-09-11, same day) — all 10 required fixes done

Sections B–K below are the **unmodified original findings** — what
this run actually found on the day it ran, kept intact as the
historical record. This box is the only thing added since: every fix
section **I** proposed has since been designed, built, and **verified
against a real, reproduced fixture** (mostly on disposable branches,
deleted after — never assumed from the fix's own description). Full
narrative for each: the chat transcript this report doesn't carry, but
every commit message below is self-contained and cites the exact test
it re-ran.

| # | Fix | Status | Commit |
|---|---|---|---|
| 1 | Content-comparison mitigation for the P0 finding (F11/F13) | ✅ **DONE — both the process option chosen (recurring task) AND the lighter code option, built afterward** | Recurring weekly spot-check task `t-tf-1a5592408317` (To-Do Dashboard, first real cycle already run — found and fixed one real stale line-anchor citation, `SHEET-007` commit `85c1e2d`); **plus** new check I, the cited-literal checker — `2c8dedb` |
| 2 | Task closure has no path back into this repo (F18) | ✅ **DONE** | `update-tasks.ps1`'s new `-VerifyCatalogRepo` flag (To-Do Dashboard — not a git repo, no commit sha; verified by reproducing a real drift scenario on a disposable branch and confirming the close was refused) |
| 3 | Check B never scanned `docs/_archive/` (F26) | ✅ **DONE** | `b26774e` |
| 4 | Check E impact is 1-hop only (F8) | ✅ **DONE** — now 2 hops | `c6e12b5` |
| 5 | Architecture overlays excluded from impact (F14) | ✅ **DONE** | `068a388` |
| 6 | HANDOVER freshness wording implies correctness (F15) | ✅ **DONE** | `32312fc` |
| 7 | Sub-table types (~460 rows) uncovered (F10) | ✅ **DONE** — new check G (sub-table ID uniqueness) | `9b9b9b2` |
| 8 | Blank `Owner`/`Evidence` unenforced (F17) | ✅ **DONE** — new check H | `fcde284` |
| 9 | No rename semantics (F6) | ✅ **DONE** — check C now suggests a likely rename target | `e3ec3e5` |
| 10 | Check F's counting logic vs. `HOW_TO_RETIRE`'s worked example (F27) | ✅ **DONE** — doc-only fix | `5781a69` |

**Two real bugs were found and fixed while building these fixes**,
neither known at the time this report was written: a PowerShell gotcha
in `update-tasks.ps1` (an empty collection returned through the success
pipeline silently becomes `$null` — the zero-element sibling of the
single-element-array-unwrap gotcha `CLAUDE.md` already documented), and
a git quirk in `check-catalog.py`'s new rename-hint (`git log -M --
<path>` silently degrades a real rename to a plain delete, because git
applies the pathspec filter *before* running rename detection — fixed
by scanning history unfiltered instead). Check I's own build also
surfaced a real design flaw in itself before shipping: the first,
naive version produced 27 false positives against the real (known
clean) catalog; narrowed against real re-testing to 0, then confirmed
it could still be fooled by a real explanatory code comment before
that was fixed too. All of this — the false starts included — is
consistent with, not contrary to, this report's own central finding:
building something that reliably reads meaning instead of structure is
genuinely hard, which is exactly why the P0 finding (section H, #1)
remains open by design. Both mitigations for it are deliberately
narrow, not a substitute for the general fix this report declined to
build.

**What this changes about the verdict below: nothing, on purpose.**
Section K's **FAIL** describes what the system was doing on
2026-09-11 when it was tested — that doesn't retroactively become
untrue because gaps it found were later closed. The honest updated
claim is a *new* one, not yet tested: check A/B/C/F/G/H (structural
integrity) stay exactly as strong as they always were; checks D/E/I
(advisory, content-adjacent) are now measurably better — 2-hop and
architecture-overlay-aware impact analysis, two new content-adjacent
checks — while the core P0 finding (no general content-comparison
mechanism) is unchanged and was never claimed to be closed. A real
re-run of Parts 2–8 against this updated tooling has not been done;
this status box reports what was fixed and how each fix was verified,
not a new overall verdict.

---

## B. Test results

`Result` — PASS (control works as the spec expects) / PARTIAL (some
signal, not enforced or not complete) / FAIL (no signal, or the
control's own claim is contradicted). `Severity` — the real-world cost
if this specific gap is exploited or simply happens by accident.

| Test | Expected | Actual | Evidence | Result | Severity |
|---|---|---|---|---|---|
| 1 — Baseline | A measurable, CI-green, internally consistent starting state | 71/71 records, 0 reciprocity gaps, 0 drift, CI green (`test` + `frontend-harness`) | Part 1 | **PASS** | — |
| 2 — Add undocumented component | Detected, typed, located, task produced, ID assignable | Advisory only (check E); file-granular (a new function in an existing file is invisible) | Part 2, F1–F2 | **PARTIAL** | Medium |
| 3 — Modify `Closed+Monitored` w/o updating record | Marked/flagged Stale, revalidation required, not falsely trusted | Advisory only (check D); record's own status field never auto-updated | Part 2, F1, F3 | **PARTIAL** | High |
| 4 — Rename/move a file | Detected; stable ID preserved; no silent 2nd component | Detected, **BLOCKING** (check C) — but zero rename semantics (reads as delete+add); the only documented remediation always mints a new ID | Part 3, F6 | **PARTIAL** | Medium |
| 5 — Delete a documented component | Location→missing flagged, orphan/broken-deps found | **BLOCKING** (check C), full 1-hop impact printed | Part 2 | **PASS** | — |
| 6 — Dependency change `A→B→C` | B flagged; A/C surfaced; not "dev remembered" | 1-hop set correctly includes both immediate neighbors | Part 3 | **PASS** (for 1-hop scope) | — |
| 7 — Comment change (+ conflicting comment) | Sync/validation/review need determined; conflict exposed | Comment-only edit gets the *same generic signal* as any code change; a **deliberately false** comment produces **zero** distinct signal | Part 4, F11 | **FAIL** (conflict half) | High |
| 8 — UI element (undocumented) | Element/invoker/callee/output traceable, no undocumented entry point | **Zero signal** — `BTN-`/`UI-` rows are outside `check-catalog.py`'s parse scope entirely | Part 4, F10 | **FAIL** | Medium |
| 9 — Sheet/tab change (rename/retention/add/remove, simulated) | Per-tab traceability, retention/lifecycle checked | All four scenarios collapse to one indistinguishable generic signal; no cross-check against the tab's own retention prose | Part 4, F12 | **FAIL** | High |
| 10 — New exception path | Documented, owned, handled, validated | **Zero signal** — same structural gap as `BTN-`/`UI-` | Part 4, F10 | **FAIL** | Medium |
| 11 — Doc-only change (record edited, no code) | System can tell drift occurred, validation flagged | **Zero signal from all 6 checks** — including a record made to say the exact opposite of the real code | Part 5, F13 | **FAIL** | **Critical** |
| 12 — Architecture change | Affected components → docs → validation → tasks → handover → revalidation | Component-level detection works; the `FLOW-`/architecture-overlay record itself is **structurally excluded** from impact propagation | Part 5, F14 | **PARTIAL** | High |
| 13 — Handover change | Impact detected; `HANDOVER.md` flagged stale; owner identified | No code-level detection; the only freshness signal is a **calendar proxy**, confirmed to report "OK" the same day it became wrong | Part 5, F15 | **FAIL** | High |
| 14 — `LOGIC_AUDIT.md` protection | Historical info stays historical; not silently rewritten | Held by convention (verified via git history) but **zero code enforcement**; a forward-edit fixture succeeded silently | Part 5, F16 | **FAIL** (enforcement) | Medium |
| 15 — Missing owner | Not closeable; owner gap visible; remediation required | Structurally correct record with blank Owner + `Closed+Monitored` — **zero signal** | Part 6, F17 | **FAIL** | High |
| 16 — Missing evidence | `Validated` state rejected/downgraded without evidence | Same fixture, same zero signal — a label is treated as evidence | Part 6, F17 | **FAIL** | High |
| 17 — Invalid revalidation | Closure fails without re-validating a changed component | The task-closing tool has **no path back into this repo at all** — architecturally impossible to enforce | Part 6, F18 | **FAIL** | **Critical** |
| 18 — Downstream failure / false-closure prevention | Downstream component found; false closure prevented | Found (advisory); **not prevented** — the downstream record's own status field is untouched | Part 3, F9 | **FAIL** (prevention) | High |
| 19 — TBD data (unknown required property) | Recorded as `TBD`, never invented; task/owner/evidence defined | The 7 **real** cases are genuinely honest (audited); a fabricated non-TBD value gets **zero signal** | Part 6, F20 | **PASS** (real instances) **/ FAIL** (enforcement) | Medium |
| 20 — New-file escape (`.html`/`.css`/`.js`/`.gs`/config/doc) | Coverage system catches what it can | `.gs` caught (advisory); `.html`/config/doc **completely outside** every scanner's extension filter | Part 7, F21 | **PARTIAL** | Medium |
| 21 — Comment escape battery (8 categories) | Pair-marker flag + `PRE_SHIP` catch what they claim to | Exactly 3/8 categories (marker-bearing) caught; 5/8 escape entirely — matches the control's own documented scope | Part 4 | **PARTIAL** (as designed) | Medium |
| 22 — Orphan test (6 types) | Each orphan detected + actionable | 1/6 blocking (doc-with-no-impl, via check C), 1/6 advisory, 4/6 invisible or incidental-only | Part 7, F23 | **PARTIAL** | High |
| 23 — Full cascade `A→B→C→D→HANDOVER` | Full chain traced | Hop 1–2 caught; hop 3 (the real automated-email consumer) **invisible** — check E is 1-hop, not transitive | Part 3, F8 | **FAIL** | **Critical** |
| 24 — Failure injection (8 types) | Each bypass fails visibly | 1/8 fails visibly (remove-a-record, check B, blocking); 7/8 fail silently or not at all | Part 7, F24 | **FAIL** | High |
| 25 — Clean recovery + automation matrix | Recovery reaches legitimate `Closed+Monitored`, traceable | Demonstrated for real (2 of 3 classes); found + fixed a **real tool bug** along the way (check B never scanned `docs/_archive/`) | Part 8, F26–F27 | **PASS** (recovery works when a human does it correctly) | — |
| False-pass battery (13 items) | The system should not be foolable | **12 of 13 succeed** — see section E | Part 7 | **FAIL** | **Critical** |

**Tally: 5 PASS, 8 PARTIAL, 12 FAIL** (25 rows; TEST 19 and 25 counted
once each toward their stronger-qualified verdict). The 5 PASSes are
exactly the tests whose failure mode is "a file/row is missing" —
every test whose failure mode lives in *content* is PARTIAL or FAIL.

---

## C. Automation results

Full table with Control/Expected/Actual/Evidence/Failure
mode/Human intervention/Gap columns: **Part 8** of the log
(21 controls). Summary:

| Verdict | Count | Controls |
|---|---|---|
| **PASS** | 4 | Check A (reciprocity), Check C (Location→file), `check-docs-coverage.js` file scan (within its narrow scope), the `Owner: Snehil` template default (as a mitigation) |
| **PARTIAL** | 8 | Check B (had a real bug, now fixed on this branch), Check D (advisory-only), Check E 1-hop (not transitive), Check E pair-marker (allowlist-only), Check F (counting-logic ambiguity), `check-docs-coverage.js` HANDOVER freshness (calendar proxy), the 3-registration `.gs` requirement (inconsistent severity), the `FLOW-`/`TRIGGER-` exemption (correct implementation of an incomplete design) |
| **FAIL** | 3 | The template's "blank field blocks closure" rule, `sheet-template.md`'s TBD-enforcement, `update-tasks.ps1` closure validation |
| **NOT AUTOMATED** | 3 | `PRE_SHIP_DOCUMENTATION_CHECKLIST.md`, the `HOW_TO_*` process guides, `LOGIC_AUDIT.md`'s immutability rule |
| **NOT APPLICABLE** | 2 | `frontend-harness` CI job, `Tests_*.gs`/`run-gs-tests.js` (both work correctly for code correctness — outside doc-governance scope) |

**Zero controls reach a clean PASS on content correctness.** Every PASS
is structural (existence, reciprocity) or a control scoped away from
documentation governance entirely.

---

## D. Escape paths found (F1–F27)

Grouped by mechanism, each with the Part/test that proved it:

**Detection is file-granular, not content-granular (F2, F10, F21)** —
A new/changed *function*, *button*, *exception*, *retention value*, or
*comment* inside an already-documented file produces the exact same
generic "file X changed" signal as any other edit — never a
type-specific one. `BTN-`/`UI-`/`RULE-`/`EXC-`/`CFG-`/`API-`/`FN-`
sub-tables (~460 rows at baseline) are **entirely outside**
`check-catalog.py`'s parse scope (it hard-filters to exactly-8-cell
INDEX rows). A new `.html`, config, or doc file is likewise outside
every scanner's file-extension filter (F21).

**Nothing reads content, only structure (F1, F11, F13, F17, F20)** —
`check-catalog.py` never compares what a record *says* to what the
code *does*. A record can claim the exact opposite of real behavior
(F13, proven with `USER_ENTERED` vs. `RAW`), a comment can flatly
contradict the code beside it (F1), an `Owner`/`Evidence` field can be
blank while `Closed + Monitored` stands (F17), a retention value can be
invented instead of honestly `TBD` (F20) — all with **zero** signal.

**1-hop, not transitive (F8, F14)** — Impact analysis stops exactly one
edge from the changed component. A real 3-hop production cascade
(dashboard action → write function → Sheet → the unattended Apps
Script system that reads that Sheet) loses coverage at hop 3 — the
precise shape of `CLAUDE.md`'s own stated cross-runtime risk.
Architecture-overlay records (`FLOW-`/`TRIGGER-`) are *structurally*
excluded from ever appearing in the impact set, because check A's own
one-directional exemption for them means the changed component never
points back.

**No rename/lineage concept (F4, F6, F7)** — A move is always
delete+add, never one event. The only documented remediation
(`HOW_TO_RETIRE_A_COMPONENT.md`) mints a fresh ID even for a pure,
logic-free move, and nothing compares history across two different IDs
to catch an accidental duplicate.

**Calendar proxies standing in for correctness (F15)** — The one
HANDOVER-freshness signal measures days-since-edit, not
truth-as-of-now; confirmed reporting "OK" on the exact day a real
change made it wrong.

**Two systems, one bridge, and the bridge is a human (F18, F19)** —
`update-tasks.ps1` has no code path into this repository at all;
closing a task cannot be — architecturally cannot be — gated on
catalog state. A task can be `Completed` while the question it was
scoped to remains genuinely open (F19), invisible to anyone reading
task status instead of the underlying doc.

**Prose rules with no code behind them (F16, F27)** — `LOGIC_AUDIT.md`
"never edit forward," the template's "blank field blocks closure," and
`sheet-template.md`'s "never invent, write TBD" are all real, clearly
written, and — where checked — genuinely followed today. None has a
line of enforcing code. One process guide's own worked example
(`HOW_TO_RETIRE_A_COMPONENT.md`, on check F's counting logic, F27)
turned out to contradict the tool it's supposed to satisfy.

**One found-and-fixed real bug (F26)** — `check-catalog.py` check B
never scanned `docs/_archive/`, so a component retired via the
documented process failed the very check that process exists to keep
green. Discovered by actually performing a retirement in Part 8, fixed
on the test branch, **not yet on `master`** (see Required Fixes).

**The one mechanism that is genuinely, reliably, blocking, end to
end:** an `INDEX.md` `Location` pointer — in either direction — naming
a file that does not exist (check C, and check B for the
record-file direction). Every test whose failure mode was "a file is
missing" was caught. Every test whose failure mode was "the words are
wrong" was not.

---

## E. False-pass results

Full 13-item table: Part 7. **12 of 13 attempted false-passes
succeed.** The lone item the system genuinely defeats — orphaned
documentation (a `Location` naming a file that doesn't exist) — is
caught by the same single mechanism named in section D above, not a
separate control. Every other attempted deception (documented
nonexistent function, stale dependency, stale handover, incorrect
comment, missing/wrong-version validation, untracked Sheet tab/button/
exception, missing owner, false `Done`) **succeeds** — the system is
fooled.

---

## F. Dead ends

Cases where a real gap is genuinely detected and written down, but has
no automated or even clearly-owned path to resolution:

| Item | Dead end | Detection | Remediation | Result |
|---|---|---|---|---|
| 7 Sheet-tab retention `TBD`s (`SHEET-001/004/005/008/011/013/014`) | Decision needs the CRM-export owner and/or a compliance call, outside this project's authority | `retention-decisions-needed.md` (excellent — data type, growth rate, options, named decision-owner, per tab) | None tracked as an *open* task — the only tracked task (`t-mtr4wul567lit`) covers "produce and route the list," already `Completed`; the 7 actual decisions have nothing currently chasing them (F19) | **Stuck, cleanly documented, invisible to task-status scanning** |
| Loan-region `effectiveRegion` override missing from 3 scheduled-email call sites | A real, HIGH-severity code bug (`LOGIC_AUDIT.md` Part 7 §18) | Recorded on `DATA-005`, `JS-014` `RULE-018`, `GS-001`/`GS-010`/`GS-004`, `RELATIONSHIP_MAP.md` §2 | Explicitly out of scope for a *documentation* project — needs a real code fix nobody has scheduled | **Detected, catalogued, unowned for the actual fix** |
| `OUTCOME_RULES` (~110) vs. `OUTCOME_RULES_GS_` (~30) | Needs a maintainer determination — fewer outcomes on the `.gs` side by design, or a real gap? | `OPEN_ITEMS.md` §F, `GS-005 ## Next action`, `DATA-003 ## Known gaps` | "Needs a maintainer determination" — no decision deadline, no assigned reviewer | **Stuck pending a judgment call nobody has made** |
| `check-catalog.py` check B's `docs/_archive/` gap (until this test's Part 8) | Following the documented retirement process broke the process's own gate | Nothing — this test found it by *doing* a retirement, not by any existing signal | Now fixed on the test branch (F26); **not yet on `master`** | **Was a silent dead end; now a named required fix (see H/I)** |

---

## G. Coverage metrics (reported separately — not blended)

| Dimension | Metric | Real value | Source |
|---|---|---|---|
| **Inventory** | Source files catalogued | 24/24 `js/*.js`, 13/13 production `.gs`, 1/1 `dashboard.html` | Part 1 baseline |
| **Documentation** | Own-file record coverage | 71/71 INDEX rows have a record file and vice versa (0 orphans in the real catalog, verified independently in Part 8 Recovery C's audit) | Part 1, Part 8 |
| **Documentation** | Sub-table (function/button/exception/etc.) coverage by any automated check | **0 / ~460** rows in `check-catalog.py`'s parse scope (F10) | Part 4, Part 7 |
| **Stable-ID** | IDs never reused, retirement preserves history | Confirmed by design (`HOW_TO_RETIRE_A_COMPONENT.md`) and by the one real retirement performed in Part 8 | Part 8 |
| **Dependency** | `Depends On`/`Used By` reciprocity | 0 one-directional pairs across all 71+ real records (independently re-broken and re-fixed twice in Parts 8's Recovery A) | Part 1, Part 8 |
| **Validation** | Records with a `## Validation` section | 69/69 real component records | Part 8 Recovery C audit |
| **Evidence** | Records with a non-blank `Evidence` line | 69/69 (0 blank) | Part 8 Recovery C audit (independent Python scan, not trusting the docs' own claim) |
| **Evidence** | Records with a non-blank `Owner` | 69/69 (0 blank) | Part 8 Recovery C audit |
| **Change-detection** | Of the 25 tests, how many produced *any* automated signal | 15/25 (60%) got at least advisory-level signal; **10/25 (40%) got zero signal from any of the 6 checks** | Section B above |
| **Change-detection** | Of signal-producing tests, how many were *blocking* (not just advisory) | 5/25 (20%) — all missing-file cases | Section B above |
| **Stale-detection** | Mechanism | Check D (advisory only), the >14-day HANDOVER calendar proxy (Part 5 F15) | — |
| **Handover** | Cross-check between `HANDOVER.md` content and live code | **0** — no automated cross-reference exists at all | Part 5, F15 |
| **Comment** | Categories caught by the pair-marker flag | 3/8 tested categories (business-rule, dependency, operational — those containing a listed marker string) | Part 4 TEST 21 |
| **CI** | Blocking checks | `test/check-catalog.py` A, B, C, F; `node test/run-gs-tests.js`; `frontend-harness` job | `.github/workflows/test.yml` |
| **CI** | Advisory-only checks | `check-catalog.py` D, E; `check-docs-coverage.js` (both its checks) | Same |
| **Recovery** | Failure classes with a demonstrated, real, working recovery path | 2/3 tested (blocking, advisory) — the zero-signal class has no path *to* recovery because nothing signals a need for one | Part 8 |

---

## H. Critical failures, ranked

**P0 — breaks the stated final principle outright, no mitigation exists today**

1. **(F11, F13) A documentation record can state the opposite of the
   real code with zero detection.** This is the single sharpest result
   of the whole test: `check-catalog.py`'s entire model is structural
   (edges, file existence, a commit sha) — it has no mechanism to ever
   compare a record's *words* to the code's *behavior*.
2. **(F18) The task-closing tool cannot be gated on catalog state —
   architecturally, not just by omission.** "Closure requires updated
   evidence" (TEST 17) is currently impossible to enforce with the
   two-repo split as built.
3. **(F26) `check-catalog.py` check B was broken for the one workflow
   it most needs to support — retiring a component correctly.** Found
   and fixed on the test branch during this run; **not yet on
   `master`.**

**P1 — silently defeats a stated acceptance criterion in realistic use**

4. **(F8) Check E's impact analysis is 1-hop, not transitive** — the
   exact shape of `CLAUDE.md`'s own named cross-runtime risk escapes
   detection at hop 3.
5. **(F14) Architecture-overlay records are structurally excluded**
   from impact propagation by the same design choice that lets check A
   pass cleanly.
6. **(F15) HANDOVER staleness detection is a calendar proxy**, not a
   correctness check — confirmed reporting "OK" the day it went wrong.
7. **(F10) All sub-table component types (~460 rows) have zero
   automated coverage** — new functions, buttons, exceptions inside an
   already-documented file are as invisible as fabricated ones.

**P2 — real gap, lower blast radius or partially mitigated by human discipline today**

8. **(F17) `Owner`/`Evidence` fields are unparsed** — mitigated today
   only by the fact that all 69 real records are genuinely honest
   (verified), not by anything that would catch a lapse.
9. **(F6/F7) No rename semantics, no cross-ID duplicate detection.**
10. **(F12) Sheet/tab rename, retention change, add, and remove are
    indistinguishable to the tooling.**
11. **(F27) Check F's counting logic contradicts
    `HOW_TO_RETIRE_A_COMPONENT.md`'s own worked example** — a doc/tool
    inconsistency, not yet triggered in real use.

**P3 — narrow, cosmetic, or already well-mitigated by convention**

12. **(F16) `LOGIC_AUDIT.md`'s immutability is honor-system** — but
    genuinely held so far (verified via real git history).
13. **(F24) No markdown link is ever validated.**
14. **(F22) Inconsistent severity for the same "forgot to register a
    `.gs` file" mistake** (loud `ReferenceError` vs. silent doc gap).
15. **(F23) `Used By` conflates writer and consumer** — one real
    instance found (`Send_Log`), not currently causing observed harm.

---

## I. Required fixes

**Status (2026-09-11): all 10 done** — see the Remediation status box
at the top of this report for the commit list. The `Smallest effective
fix` column below is preserved exactly as originally proposed (the
plan); the `Status` column records what was actually verified against
a real fixture, which in three cases (#4, #7, #9) turned out to need
more than the original one-line plan once tested for real — narrower
scoping (#7, discovered the "sequential" framing didn't fit how sub-IDs
are actually assigned) or an extra bug fix found along the way (#4's
2-hop walk shipped as designed; #9 needed a real git-quirk fix, not
scope creep) are called out inline rather than silently absorbed.

| # | Problem | Root cause | Smallest effective fix (as planned) | Status — what actually shipped, verified how |
|---|---|---|---|---|
| 1 | Record content can contradict code with zero signal (F11/F13, P0) | No content-comparison mechanism exists anywhere in the toolchain | Not a small fix — (a) a recurring spot-check task, or (b) LLM-diffing in CI | ✅ **DONE, both lighter options** — (a) recurring task `t-tf-1a5592408317`, cycle 1 already run for real (found + fixed a real stale citation); (b) also built the narrower code option afterward, check I (cited-literal checker) — `2c8dedb`. (c), the heavy LLM-diffing option, deliberately **not** built — still the honest open P0. |
| 2 | Task closure has no path back into this repo (F18, P0) | Two-repo architecture; `update-tasks.ps1` never reads `docs/INDEX.md` | Optional `--verify-catalog` flag, refuses a close referencing a drifted component | ✅ **DONE** as `-VerifyCatalogRepo` — verified by reproducing real drift on a disposable branch and confirming the close was refused, nothing written |
| 3 | Check B never scanned `docs/_archive/` (F26, P0) | Oversight — `_archive/` didn't exist as a concept when B was built | Port the test-branch fix to `master` | ✅ **DONE** — `b26774e` |
| 4 | Check E impact is 1-hop only (F8, P1) | `onehop` computation deliberately one level, never recursed | Recurse 1 more level (2-hop) | ✅ **DONE as planned** — `c6e12b5`; `GS-010` confirmed appearing for a `JS-016` change, reproducing TEST 23 exactly |
| 5 | Architecture overlays excluded from impact (F14, P1) | Check A's arch exemption means no back-edge to walk | Scan `FLOW-`/`TRIGGER-` rows' `Depends On` separately | ✅ **DONE** — `068a388`; `FLOW-002` confirmed appearing for a `GS-010` change, reproducing TEST 12 exactly |
| 6 | HANDOVER freshness is a calendar proxy (F15, P1) | Only parses the header date, never cross-references content | Reword the output so it doesn't imply correctness | ✅ **DONE** — `32312fc`; verified via a faked Node environment (no local Node) against the real header date and a synthetic stale one, then confirmed in real CI |
| 7 | Sub-table types (~460 rows) uncovered (F10, P1) | `parse_index()` hard-filters to exactly-8-cell rows | A lighter parser checking sub-IDs are unique and sequential | ✅ **DONE, narrower than planned** — new check G checks **uniqueness only** (486 real sub-IDs scanned, 0 duplicates); "sequential" was dropped once building it showed sub-IDs are assigned as one global running number across the whole catalog, not per-record, so per-record sequence isn't a meaningful check — `9b9b9b2` |
| 8 | Blank `Owner`/`Evidence` unenforced (F17, P2) | No field-content parsing at all | New advisory check for blank Owner / unevidenced Closed+Monitored | ✅ **DONE as planned** — new check H, `fcde284`; reproduced the exact `JS-025` fixture, both findings named correctly |
| 9 | No rename semantics (F6, P2) | Nothing reads git's own rename detection | Check C's message names a likely rename target | ✅ **DONE**, one real bug fixed en route — `e3ec3e5`. First attempt used a pathspec-filtered `git log`, which **silently degrades a real rename to a plain delete** (git applies the pathspec before running rename detection — confirmed directly, `git show -M` with no pathspec correctly found the same rename `git log -M -- <path>` missed). Fixed by scanning history unfiltered instead. |
| 10 | Check F's counting logic vs. `HOW_TO_RETIRE`'s worked example (F27, P2) | Never reconciled against each other | Fix the doc: count stays the same on retirement | ✅ **DONE** — `5781a69`, doc-only; re-read against check F's live source line by line, confirmed no remaining contradiction |

Items 11–27 (the remaining findings) have no code-level fix proposed —
they are process/discipline items already correctly identified as such
in this report's H section (P3) and in `OPEN_ITEMS.md`.

---

## J. Retest plan

**All 10 retests below were actually run** (2026-09-11, on disposable
`temp-*` branches per fix, deleted after) — this is not a plan anymore,
it's a record of what really happened, alongside what was expected.

| After fixing # | Rerun | Expected new result | Actual result |
|---|---|---|---|
| 1 | TEST 11 (Part 5) | Some signal where there was none — even advisory is progress | ✅ Recurring spot-check cycle 1 caught a real stale citation (not the synthetic fixture — an actual pre-existing drift); check I (cited-literal) also independently flags mismatched `RAW`/`USER_ENTERED`-style literals in function bodies against sub-table citations |
| 2 | TEST 17 (Part 6) | Close attempt refused for a drifted component | ✅ Confirmed — reproduced real drift on a disposable branch, `-VerifyCatalogRepo` refused the close, nothing written to `tasks.json` |
| 3 | Part 8 Recovery A, steps 1–3 | Zero reciprocity/coverage noise after a real retirement | ✅ Confirmed — check B now scans `docs/_archive/`; a real retirement fixture produced zero spurious coverage findings |
| 4 | TEST 23 (Part 3) | `GS-010` appears in the printed impact set | ✅ Confirmed exactly as predicted |
| 5 | TEST 12 (Part 5) | `FLOW-002` appears in the printed impact set | ✅ Confirmed, plus `FLOW-001` also surfaced as a bonus (both overlays depend on the changed component) |
| 6 | TEST 13 (Part 5) | Warning text no longer implies correctness | ✅ Confirmed — output now reads "edited within 14 days (not a correctness check)"; verified against both the real header date and a synthetic stale one in a faked Node environment, then in real CI |
| 7 | TEST 8 and TEST 10 (Part 4) | A new advisory line for the specific sub-table gap | ✅ Confirmed, narrower than planned — new check G catches **duplicate** sub-table IDs (486 real IDs scanned, 0 duplicates on a clean run); "sequential" numbering was dropped as a check criterion once building it showed sub-IDs run as one global counter, not per-record |
| 8 | TEST 15/16 (Part 6) | `JS-025`-style record explicitly named by the new check | ✅ Confirmed — new check H named the exact fixture record for both blank-Owner and unevidenced-Closed+Monitored cases |
| 9 | TEST 4 (Part 3) | Error message suggests the rename target | ✅ Confirmed, after fixing a real bug found while verifying: the first implementation used a pathspec-filtered `git log`, which silently misreports a genuine rename as a plain delete (git applies the pathspec before rename detection runs) — fixed by scanning history unfiltered |
| 10 | (doc-only) | Re-read `HOW_TO_RETIRE_A_COMPONENT.md`'s worked example | ✅ Confirmed — worked example now says the count stays `24 / 24`, matches check F's real live behavior line by line |

Every retest above was **already fully specified** in the log (exact
commands, exact fixtures) before the fix work started — no new test
design was needed, only re-running the existing ones against the fixed
tool. Two real bugs (not in the original test fixtures) surfaced
*during* this verification work itself — the PowerShell empty-collection
gotcha (#2) and the git pathspec/rename-detection quirk (#9) — both are
documented in the fix commits and in this project's working notes.

---

## K. Final verdict

# **FAIL**

The stated acceptance principle is:

> *"Introduce a meaningful change anywhere in the system, and the
> documentation architecture must either automatically update the
> machine-derived state or automatically identify every affected item
> that requires human review. No meaningful change may silently pass
> through as if nothing changed."*

**10 of the 25 tests (40%) produced zero signal from any of the 6
checks.** Twelve of thirteen attempted false-passes succeeded. The one
mechanism that is genuinely, reliably blocking end to end — a
`Location` pointer naming a file that doesn't exist — covers exactly
one class of defect ("a file is missing") out of the dozens this test
exercised. Content-level drift — a false claim in a record, an
undocumented function inside a documented file, a fabricated retention
value, a stale `HANDOVER.md` reference, a blank required field sitting
next to a `Closed + Monitored` status — passes through silently, every
time it was tested.

This is not a marginal, "PASS WITH CONDITIONS" gap. It reconfirms,
with 27 concrete, reproduced, first-hand findings (one of them a real
tool bug found and fixed during the run), the forensic completeness
audit's own prior estimate: **one-time completeness is genuinely
excellent (~95–100%, independently re-verified in Part 8: 0 blank
owners, 0 blank evidence, 0 reciprocity gaps across 69–72 real
records) — continuous completeness is not.** The system that exists
today is very good at describing a snapshot and very poor at noticing
when that snapshot stops being true.

**What does work, without qualification:** structural integrity. A
missing file, a broken reciprocal link, a mismatched coverage count —
these are caught, blocking, every time, with zero exceptions found in
25 tests. That is real, load-bearing, and should not be
under-credited: it is exactly the control class this project's own
forensic audit (P0/P1) set out to build, and it was built correctly.

**What does not work:** anything where the defect lives in the
*meaning* of a sentence rather than the *existence* of a file. No
control in this repository reads content. That is the single sentence
that explains all 27 findings.

### The 16 questions, answered directly

1. **Can a new meaningful component escape detection?** Partially —
   a new `.js`/`.gs` **file** gets an advisory flag; a new
   **function, button, Sheet tab, or exception** inside an existing
   file gets none (F1, F2, F10, F12, F21).
2. **Can a changed component remain falsely `Closed`?** Yes, always —
   `Record Status` is never auto-updated by anything; check D only
   ever prints an advisory note elsewhere (F3, F9).
3. **Can a dependency change escape impact analysis?** Beyond 1 hop,
   yes — confirmed with a real, named production cascade (F8).
4. **Can an architecture change escape revalidation?** The
   architecture-overlay record itself, yes, structurally (F14); the
   directly-touched component, no (1-hop works).
5. **Can a meaningful comment escape the control system?** Yes for
   5 of 8 tested categories, and for any comment that flatly
   contradicts the code beside it (F1, F11).
6. **Can a button/UI element escape documentation?** Yes, completely
   — outside the parser's scope entirely (F10).
7. **Can a Sheet/tab escape documentation?** Yes — rename, retention
   change, add, and remove are all indistinguishable to the tooling
   (F12).
8. **Can an exception escape documentation?** Yes, same mechanism as
   #6 (F10).
9. **Can validation exist without evidence?** Yes — a label
   (`Status: Validated`) with a blank `Evidence:` line is accepted
   identically to a properly-evidenced one (F17).
10. **Can evidence refer to the wrong implementation/version?** Yes —
    a fabricated CI-run citation for a test file that doesn't exist
    produced zero signal (F17, TEST 19/24 cross-reference).
11. **Can handover become stale silently?** Yes — the only freshness
    signal is a calendar proxy, confirmed wrong on the day it mattered
    (F15).
12. **Can an orphaned record remain unnoticed?** This is the one
    genuine "no" — a `Location` pointing at nothing is always caught,
    blocking (the one reliable mechanism in this whole report).
13. **Can a task be closed without all required evidence?** Yes,
    always — `update-tasks.ps1` never checks (F18).
14. **Does failure reliably return to remediation?** No — advisory
    failures print a remediation path but nothing forces it to be
    taken; zero-signal failures never even surface a path (F1–F27,
    broadly).
15. **Does recovery reliably return to validated closure?** Yes, **if
    a human does it correctly** — demonstrated for real in Part 8 —
    but nothing initiates or requires that recovery happen.
16. **Is the system genuinely continuously synchronized?** No. It is
    genuinely synchronized **once**, at the moment a human last
    touched it, and drifts undetected from there except for the one
    structural class of defect (missing files) this report has
    repeatedly named.

### Per the spec's own 21-point PASS/FAIL criteria

Criteria **2, 3, 6, 9, 10, 11, 12, 13, 14, 15, 16, 17 (enforcement, not
observation), 18, 19 (only for structural cases), 21** are violated in
the spec's own strict sense — *silent*, with no detection, no forced
owner action, no traceability of the fact that a review never
happened. Criteria **1, 4, 7, 8, 20** are partially met (detection
exists but enforcement does not). Only criterion **5** — "renamed/moved
components preserve traceability" — is met, and only via git's own
history mechanism, not the documentation tooling. That is fewer than a
quarter of the 21 criteria genuinely satisfied.

**Do not build more architecture beyond what section I already
proposes.** Every fix in section I is the smallest change that closes
a test this report actually ran — nothing here recommends a redesign,
per the spec's own instruction, and per the finding that the
*structural* half of this architecture (checks A/B/C/F) is already
correctly built and should be extended, not replaced.
