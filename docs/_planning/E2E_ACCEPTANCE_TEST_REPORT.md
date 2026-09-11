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

## Round 2 retest (2026-09-11) — the real re-run, updated verdict

**Verdict: still FAIL — narrower than round 1, not reversed.** This is
the real re-run the remediation box above said hadn't happened yet:
Parts 1–9 of `docs/_planning/E2E_ACCEPTANCE_TEST_SPEC.md`, run again in
full on a fresh disposable branch (`e2e-acceptance-test`, re-created off
`master` @ `a15f87c`, deleted after this report was committed — same
discipline as round 1), every test reproduced against a REAL fixture,
every fixture reverted, nothing pushed except this section and two real
fixes found along the way (below). Full working log:
`docs/_planning/E2E_ACCEPTANCE_TEST_LOG.md` on that now-deleted branch —
same fate as round 1's own log, per this project's established
"commit only the report" discipline; this section is the durable record.

### Two real bugs found DURING this retest (not pre-existing, not in the original 27 findings)

1. **`check-catalog.py` check H had a genuine regex bug** (TEST 16):
   `\*\*Evidence:\*\*\s*(.*)` used `\s*` before the capture group — `\s`
   matches a newline, so on a genuinely blank Evidence line the match
   slid past the line break onto the NEXT bullet (`**Status:**...`) and
   captured THAT text instead of recognizing blankness. `JS-018`'s real
   field order (Evidence-then-Status, the actual template order) is
   exactly the layout that triggers it — confirmed check H read a truly
   blank Evidence line as "evidenced," missing the exact case Fix #8 was
   built to catch. **Fixed and shipped to `master`** the moment it was
   found (commit `74107f7`, CI confirmed green) — not left for a future
   round, since this is production tooling, not a test artifact. Verified
   the fix doesn't change behavior on the real, unmodified catalog, then
   re-ran the identical fixture against the corrected script: caught
   correctly.
2. **Real, organic documentation drift, used as evidence rather than
   papered over**: `GS-003` (`DailyRmIssueLog.gs`) had gone stale earlier
   in this same session (the leadership-exclusion mirror, commits
   `8eb4b85`/`95305fb`, landed without a revalidation). Rather than
   treating this as noise, it became TEST 3's real fixture (Part 2) and
   TEST 25's real recovery drill (Part 8) — revalidated for real on
   `master` (commit `6981257`), `check-catalog.py` D confirmed clean
   afterward, and a task-closure probe citing `GS-003` flipped from
   BLOCKED to allowed once the drift was genuinely resolved.

### What moved, test by test (25 named tests + the false-pass battery)

| # | Test | Round 1 | Round 2 | Why |
|---|---|---|---|---|
| 2 | Add undocumented component | PARTIAL | PARTIAL (impact analysis much better) | still file-granular, not function-granular; but the file-level signal now walks 2 hops + surfaces architecture overlays |
| 3 | Modify Closed+Monitored, no record update | PARTIAL | PARTIAL (proven on a real incident) | still advisory-only; confirmed via `GS-003`'s own genuine drift, not a hypothetical |
| 4 | Rename/move | PARTIAL | PARTIAL (now with a correct, active hint) | still no ID auto-preservation; check C now names the likely rename target |
| 5 | Delete a component | PASS | PASS (unchanged) | check C still blocks correctly; correctly does NOT false-positive a rename hint on a genuine delete |
| 6 / 23 | Dependency chain / full cascade | PARTIAL / FAIL | PARTIAL / **PARTIAL** | the NAMED real cascade (`JS-016`→`SHEET-004`→`GS-010`) now caught at 2 hops; general transitivity still capped by design |
| 7 | Conflicting comment (general) | FAIL | FAIL (unchanged) | a plain, unformatted comment contradiction is still invisible |
| 8 / 9 / 10 | UI / Sheet / exception coverage | FAIL | FAIL (unchanged) | check G only catches DUPLICATE sub-table IDs, confirmed it doesn't help here |
| 11 | Doc-only change (P0) | **FAIL, zero signal** | **PARTIAL — real signal** | check I catches a disguised, bold-cited literal falsification for real; the general case (any doc-only lie) is still open by design |
| 12 | Architecture change | PARTIAL | **PARTIAL → materially fixed** | `FLOW-001`/`FLOW-002` now surface correctly on a real `GS-010` change |
| 13 | Handover change | FAIL | FAIL (wording fixed, mechanism unchanged) | still a calendar proxy; no longer overclaims correctness |
| 14 | LOGIC_AUDIT.md protection | FAIL (enforcement) | FAIL (unchanged) | zero code references, confirmed by grep; no fix was proposed |
| 15 | Missing owner | FAIL | **PASS** | check H catches it |
| 16 | Missing evidence | FAIL | **PASS** (after fixing check H itself) | see bug #1 above |
| 17 | Invalid revalidation / task closure | FAIL | **PARTIAL** | `-VerifyCatalogRepo` blocks a close citing a directly-drifted ID |
| 18 | Downstream / false-closure prevention | FAIL | FAIL (unchanged, confirmed live) | the SAME guard does NOT block a close citing only a downstream (non-directly-drifted) ID |
| 19 | TBD data | PASS (real) / FAIL (enforce) | unchanged | zero TBD-enforcement code exists; no fix was proposed |
| 21 | Comment escape battery | PARTIAL (as designed) | unchanged by design | no fix touched the pair-marker allowlist |
| 25 | Clean recovery | PASS (human-driven) | **PASS, on a real incident** | `GS-003`'s genuine drift, revalidated for real, confirmed via a real task-closure probe |
| — | False-pass battery (13 items) | 12/13 succeed | **10/13 succeed** | #6 (missing evidence) and #12 (missing owner) now caught; #5 (incorrect comment) caught in its one narrow lane |

Tests not in this table (1, 20, 22, 24) were not independently re-fixtured
this round — Test 1 is superseded by this retest's own Part 1 baseline;
20/22/24's underlying mechanisms were untouched by any of the 10 fixes
and their specific catch/escape shapes were already directly exercised
elsewhere in this round (see the working log's Part 7 for the exact
citations) — noted unchanged by inspection, not re-run from scratch.

### Updated automation matrix (Section C's 21 controls, now 24)

| Verdict | Round 1 | Round 2 |
|---|---|---|
| PASS | 4 | **7** |
| PARTIAL | 8 | **11** |
| FAIL | 3 | **1** |
| NOT AUTOMATED | 3 | 3 (unchanged) |
| NOT APPLICABLE | 2 | 2 (unchanged in kind) |

The single remaining FAIL: `sheet-template.md`'s TBD-enforcement — no
fix was proposed for it, confirmed unchanged.

### The honest read

**Zero controls reach a clean PASS on content correctness — still true,
exactly as round 1 found.** Every PASS above is structural, or a control
now correctly enforcing something it already claimed to (Owner/Evidence),
not a new content-understanding capability. Per the spec's own strict
rule — *"a change that occurs silently, with no detection, no owner, no
traceability, no review, is a FAIL"* — TEST 8/9/10 (new UI element, Sheet
change, exception path) still produce **literal zero signal**, the same
standard round 1 used to fail those tests. That alone is enough to keep
the overall verdict at **FAIL**, and this report is not going to round
that up. What genuinely changed: the P0 finding (content can contradict
code with zero signal) now has a real, narrow mitigation where it had
none; two governance gates (owner, evidence) that were pure prose now
have working enforcement; the one real cascade named as broken in round 1
is fixed; and the automation matrix's FAIL count dropped by two-thirds.
That is real, evidence-backed progress on the 10 fixes this project
actually scoped and shipped — not a verdict flip, and not nothing either.

**Per the 21-point criteria**: criteria 9 (validation is evidence-backed)
and, narrowly, 4 (architecture changes trigger impact analysis, for the
overlay's own visibility) move from violated to satisfied. Criterion 13
(a task can be closed without required evidence) moves from fully
violated to partially satisfied (direct-drift citations only). The
remaining ~17 criteria are unchanged from round 1's own accounting.

**Do not build more architecture beyond what Section I already
proposed.** Nothing in this retest surfaced a gap the 10 fixes didn't
already know about and choose not to build (the P0's general case,
sub-table registration, TBD enforcement, wrong-validation-version
detection) — every real finding this round was either confirmation of an
existing, correctly-scoped fix, or a genuine bug IN one of those fixes,
found and fixed in the same session it was found.

---

## Round 2 remaining-gaps fixes (2026-09-11, same day) — 6 of 7 done

The round-2 box above says "do not build more architecture" — these
fixes don't; every one closes a gap round 2 already named and scoped,
the same discipline as the original 10. Worked one at a time, each
investigated for a real structural angle **before** any code was
written — three (marked "narrowed" below) turned out to need a smaller
fix than first scoped once actually tested; one (TEST 7) was
investigated and found to have **no** reliable structural angle at all,
and was left alone rather than forced.

| # | Gap | Check | Status | Commit |
|---|---|---|---|---|
| 1 | TEST 18 — `-VerifyCatalogRepo` missed downstream-only drift citations | Check D extended | ✅ **DONE** — a component only reachable via check E's 2-hop walk, never itself directly drifted, is now flagged too; zero changes needed to `update-tasks.ps1` itself | `6fb75f1` |
| 2 | TEST 14 — `LOGIC_AUDIT.md` immutability had zero code enforcement | New check J | ✅ **DONE** — compares the audit body (from the first `## Part N of M` heading onward) against its content at the cited final commit; header above that heading stays editable (2 real precedent edits exist) | `c97254c` |
| 3 | TEST 19 — a fabricated retention value got zero signal | New check K | ✅ **DONE** — cross-checks `retention-decisions-needed.md`'s "needing a decision" list against each tab's own record; a consistency check, not a truth check | `8fc9bb5` |
| 4 | TEST 9 — an untracked Sheet tab got zero signal | New check L | ✅ **DONE** — every real tab name is a top-level `const ..._SHEET_`/`..._TAB_NAME` constant; flags one with no matching `docs/sheets/` record | `b8f1a3c` |
| 5 | TEST 8 — an untracked UI button got zero signal | New check M | ✅ **DONE**, narrowed to `<button id>` only — 5 of 26 real buttons are cited *descriptively* in their own record, not by literal id; search scope is `button-inventory.md` + every tabs/dashboards record together, not the owning record alone | `e177475` |
| 6 | TEST 10 — an untracked exception path got zero signal | New check N | ✅ **DONE, deliberately PARTIAL** — most `EXC-` rows describe a *condition* with no matching literal in code at all (confirmed by inspection); only the 2 rows citing a literal thrown string are checkable. A brand-new exception with no `EXC-` row at all still gets zero signal — that half stays open by design | `b49c8da` |
| 7 | TEST 13 — HANDOVER staleness was a pure calendar-date proxy | New check O | ✅ **DONE** — HANDOVER §2 makes one precise claim (the real `<script src>` load order for 14 of 23 files); compares it against `dashboard.html`'s actual tag order | `ba8ff03` |
| — | TEST 7 — a plain comment contradicting the code beside it | *(none — deferred)* | ⏸ **Investigated, no clean structural fix exists.** This is the P0 finding itself (Fix #1's own deliberately-not-built territory), not a narrower slice of it — comments cite numbers/dates/other constants for too many unrelated reasons for a reliable regex signal. The one real fix (folding an LLM-assisted review into the existing recurring spot-check task) is genuinely heavier than every check above; set aside by explicit choice, not forgotten | — |

**One real bug found and fixed along the way, unrelated to any single
check above**: the shared `git()` helper had no explicit encoding, so
`git show <sha>:<path>` decoded with the OS locale (cp1252 on the dev
machine, not UTF-8) — a file containing a real UTF-8 character threw
`UnicodeDecodeError`, silently caught and returned as `""`. Fixed with
`encoding="utf-8", errors="replace"`, benefiting every caller of `git()`,
not just check J (where it was found).

**Automation matrix, updated again**: `check-catalog.py` now runs 15
checks (A–O, up from the original 8 and round 2's 11) — 4 blocking, 11
advisory. The single remaining automation-matrix FAIL from round 2
(`sheet-template.md`'s TBD-enforcement) is unchanged — no fix was ever
proposed for it, and it wasn't in scope for this pass either.

**The honest read, again**: the verdict does not flip. TEST 7's general
case — a plain comment silently contradicting the code beside it — still
produces **literal zero signal**, and per the spec's own strict rule that
alone is enough to keep the overall verdict at **FAIL**. What moved:
every OTHER named test-8/9/10/13/14/18/19 finding from round 2 is now
either fully or partially closed, each verified against a real fixture on
a disposable branch, not assumed correct from the code alone.

---

## Round 3 retest (2026-09-11, same day) — verdict FAIL, zero automation-matrix FAILs for the first time

**Verdict: still FAIL — not reversed, and this report is not going to
round that up.** Same discipline as rounds 1 and 2: all 9 parts of
`docs/_planning/E2E_ACCEPTANCE_TEST_SPEC.md` run again in full on a
fresh disposable branch (`e2e-acceptance-test`, re-created off `master`
@ `4bc250e`, deleted after this report was committed), every one of the
7 tests whose mechanism changed since round 2 (TEST 8/9/10/13/14/18/19)
reproduced against a REAL fixture — a fresh, correctly-constructed one
in every case, not a copy of a round-2 fixture — every fixture reverted,
nothing pushed except this section and one real tooling fix found along
the way. Full working log: `docs/_planning/E2E_ACCEPTANCE_TEST_LOG.md`
on that now-deleted branch, same fate as rounds 1 and 2's own logs —
this section is the durable record. Efficiency note carried the same
discipline forward: TEST 2/3/4/5/6/7/11/12/15/16/17/20/21/22/23/25 were
cited directly from round-2-this-session evidence rather than re-run,
since no fix since round 2 touched any of their mechanisms — round 3's
own real-fixture effort went entirely into the 7 tests that actually
could have moved.

### One real bug found DURING this retest (not pre-existing)

**Check J's own violation message mislabeled its evidence.** When check
J (LOGIC_AUDIT.md immutability, shipped just before this round started)
fires, it lists every commit since the cited final SHA that touched the
file and called the WHOLE list "confirmed legitimate precedent" — but
by definition, when the check fires, at least one of those commits IS
the violator, not precedent. Round 3's own TEST 14 fixture commit landed
in that exact list and was mislabeled legitimate in its own violation
message — a real, reproducible bug, not a hypothetical. **Fixed and
shipped to `master` the moment it was found** (commit `7da7e68`, CI
confirmed green, merged back into the test branch to keep testing with
the corrected tool) — not left for a future round, same discipline as
round 2's check-H regex bug. The message now lists commits neutrally
instead of asserting they're all fine.

### What moved, test by test

| # | Test | Round 2 | Round 3 | Why |
|---|---|---|---|---|
| 8 | UI element (undocumented button) | FAIL (zero signal) | **real structural signal** | check M, fresh fixture confirmed it fires correctly |
| 9 | Sheet/tab change (undocumented tab) | FAIL (zero signal) | **real structural signal** | check L, fresh fixture confirmed it fires correctly (after 2 fixture-naming false starts — no real constant uses digits, and the fixture had to avoid them too) |
| 10 | New exception path (thrown-literal staleness) | FAIL (zero signal) | **real, narrow structural signal** | check N, fresh fixture confirmed — but only covers 2 catalog-wide citable EXC- rows |
| 13 | Handover change | FAIL (calendar proxy only) | **real, narrow structural signal** | check O, fresh fixture (swapped two script names' stated order) confirmed it fires correctly — one precise claim, not general staleness |
| 14 | LOGIC_AUDIT.md protection | FAIL (zero code references) | **real structural signal** | check J, fresh fixture (unauthorized body edit) confirmed it fires correctly — plus found+fixed a real bug in its own message (above) |
| 18 | Downstream / false-closure prevention | FAIL (not blocked) | **PASS** | check D's downstream extension, fresh fixture (real `JS-016` change, probe task citing only the downstream `GS-010`) confirmed `-VerifyCatalogRepo` now blocks it |
| 19 | TBD data (enforcement half) | FAIL (zero TBD-enforcement code) | **real structural signal** | check K, fresh fixture (fabricated non-TBD retention value, decision not actually made) confirmed it fires correctly |
| 7 | Conflicting comment (general, the P0) | FAIL | FAIL (unchanged) | still zero code-level signal by design; real mitigation is the external weekly LLM routine, deliberately outside this test's disposable-branch scope |
| 21 | Comment escape battery | PARTIAL (3/8, as designed) | unchanged | no fix touched the pair-marker allowlist |
| — | False-pass battery (13 items) | 10/13 succeed (strict convention) | **7/13 succeed** | 6/13 now fully caught (was 3), 4/13 partial (was 2) — driven by checks K/L/M/N/O |

Tests not re-fixtured this round (2/3/4/5/6/11/12/15/16/17/20/22/23/25)
were cited from round-2-this-session evidence, same reasoning round 2
itself used for its own untouched tests — their mechanisms were not
touched by any of the 7 fixes this round shipped.

### Updated automation matrix (28 controls — 24 + 4 brand new)

| Verdict | Round 1 | Round 2 | Round 3 |
|---|---|---|---|
| PASS | 4 | 7 | **10** |
| PARTIAL | 8 | 11 | **14** |
| FAIL | 3 | 1 | **0** |
| NOT AUTOMATED | 3 | 3 | **2** |
| NOT APPLICABLE | 2 | 2 | 2 (unchanged) |

**Zero FAIL controls for the first time across all three rounds.** The
last one standing after round 2 (`sheet-template.md`'s TBD-enforcement)
is now closed by check K. `LOGIC_AUDIT.md`'s immutability rule graduates
out of NOT AUTOMATED via check J. Four brand-new controls join the
matrix (checks L/M/N/O), each independently verified. The 2 remaining
NOT AUTOMATED controls (`PRE_SHIP_DOCUMENTATION_CHECKLIST.md`, the
`HOW_TO_*` process guides) are process documents by design — no fix was
ever scoped for them, and none is proposed now.

### The honest read

**Zero controls reach a clean PASS on content correctness — still true,
exactly as rounds 1 and 2 found.** Every PASS above is structural
(existence, reciprocity, narrow-but-reliable sub-element coverage) or a
control now correctly enforcing something it already claimed to — never
a new content-understanding capability. Per the spec's own strict rule
— *"a change that occurs silently, with no detection, no owner, no
traceability, no review, is a FAIL"* — TEST 7's general case (a plain
comment silently contradicting the code beside it) still produces
**literal zero code-level signal**, and that alone is enough to keep
the overall verdict at **FAIL**. This report is not going to round that
up, no matter how the automation matrix moved.

What genuinely changed, for real, verified against fresh fixtures: the
three tests round 2 found completely unmitigated (UI/Sheet/exception
coverage, TEST 8/9/10) now all produce real structural signal; the two
prose-only governance rules round 2 found had zero enforcement
(HANDOVER staleness for its one precise claim, LOGIC_AUDIT.md
immutability) now have real code behind them; the one remaining FAIL
in the entire 28-control automation matrix is gone; the false-pass
battery's "still fully succeeds" count dropped from 8/13 to 3/13. That
is real, evidence-backed progress on all 7 gaps round 2 named and
scoped — not a verdict flip, and not nothing either. The P0 (general
content-vs-code contradiction, TEST 7) remains the one structural gap
this project has explicitly chosen not to close with more automation,
mitigated instead by the external weekly LLM-assisted spot-check
routine (`trig_01XCaCVj4YuDcy2NwpDAHbs4`) — a real, working, but
external and judgment-based mitigation, not a code check, and therefore
not counted toward the automation matrix's FAIL-free result above.

**Per the 21-point criteria**: no additional criterion crosses from
violated to satisfied this round beyond what round 2 already recorded —
the criteria round 3's fixes touch (13, evidence-backed validation;
19, TBD honesty) were already counted as satisfied or partially
satisfied in round 2's accounting, and round 3 only deepens that
evidence rather than crossing a new criterion.

**Do not build more architecture beyond what round 2's own scoping
already covered.** Nothing in this retest surfaced a gap the 7 fixes
didn't already know about and choose to build — every real finding this
round was either confirmation of an existing, correctly-scoped fix, a
genuine fixture-construction lesson (no real constant uses digits — a
lesson about the fixture, not the check), or a genuine bug IN one of
those fixes (check J's message), found and fixed in the same session it
was found.

---

## Round 3 remaining false-pass items (2026-09-11, same day) — 1 of 7 fixed, 6 confirmed dead ends

Round 3's false-pass recompute left 7 items still not fully caught (3
still fully succeeding, 4 partial). Opened as a backlog task
(`t-tf-21fbf968b999`), then investigated one at a time for a real
structural angle before writing anything — same discipline as every
check this project has built.

**Fixed (1):** Documented nonexistent function — new check P.
`FN-XXX` sub-table rows cite function names with a line anchor, the
same row shape check I already parses for cited-literal verification.
Tested against the real, unmodified catalog before writing any check
code: 254 `FN-` rows, 401 extracted name citations, checks clean at
401/401 once two real codebase conventions are handled — this
codebase's own `` `_()` `` shorthand for "same name + trailing
underscore private twin" (confirmed real against `OvernightEmailer.gs`,
line anchors match exactly), and one Web Worker `onmessage =
function(e){` assignment that isn't the usual `function name(`
declaration style. Verified with a real fixture (a fabricated `FN-999`
row citing a nonexistent function) on a disposable branch, reverted,
shipped to `master` (`5133f56`), CI confirmed green.

**Confirmed dead ends (6), no low-noise structural angle exists:**
- *Untracked exception, broadened* — 42 real `throw new Error(...)`
  sites exist, but ~35 throw dynamic/computed messages (generic
  API-error passthroughs), not stable codes; only ~2 are genuinely
  catalog-able, which is exactly why check N was already scoped that
  narrowly. Broadening would flood the check with noise on legitimate
  passthrough errors.
- *Stale dependency* — `Depends On`/`Used By` pairs frequently
  represent Sheet-based or external-API relationships with no
  function-call signature to verify; a "still calls a function" check
  would misfire on structurally legitimate non-call dependencies.
- *Incorrect comment (general)* — this is TEST 7, the P0 itself,
  already exhaustively investigated this session. The external weekly
  LLM-assisted spot-check routine remains the only mitigation.
- *Stale handover (general)* — same class of problem as the P0; check
  O's one precise load-order claim is the ceiling without semantic
  understanding.
- *False "Done" (general, no-citation case)* — architecturally
  impossible to enforce without knowing what should have been cited for
  that specific task; the citable-drift case is already fixed (TEST 18).
- *Missing/wrong-version validation* — no concrete trigger scenario
  survives from the original finding to scope a check against without
  guessing at intent.

`check-catalog.py` now runs **16 checks (A–P)** — 4 blocking, 12
advisory. The false-pass battery moves from round 3's 7/13 still
succeeding (by the report's own strict convention) to **6/13**.

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
