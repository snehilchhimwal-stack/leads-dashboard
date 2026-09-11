# Weekly doc-content spot-check — log

**Purpose:** the recurring mitigation for Required Fix #1 (P0) from
`docs/_planning/E2E_ACCEPTANCE_TEST_REPORT.md` — `check-catalog.py` can
only ever verify structure (files exist, edges reciprocate, a commit sha
advanced); it cannot and will not tell you a record's PROSE is wrong,
confirmed for real in TEST 11 (a record made to state the exact opposite
of what the code does produced zero signal from any of the 6 checks that
existed at the time). This is a genuinely recurring, not just a
checklist-box, spot-check: each cycle samples a few real component
records and re-reads their stated claims against the real current source.

**Cadence:** weekly, Tuesday ~9am IST (matching `OpsChecklistRunner.gs`'s
own established weekly-automation convention in this project). Originally
run by hand (cycle 1); from cycle 2 on, run by a scheduled cloud routine
(TEST 7 follow-up, `docs/_planning/E2E_ACCEPTANCE_TEST_REPORT.md`'s round-2
remaining-gaps section — the "fold an LLM-assisted review into the
existing recurring task" option, built 2026-09-11).

**Each cycle:** pick 3–5 real component records from `docs/INDEX.md`,
rotating through different ones than recent cycles (check this log's own
history below before choosing). For each: open its `.md` record and
re-read every specific claim against the real current source at the
`## Location` it names — a cited literal/constant value (e.g. `RAW` vs
`USER_ENTERED`, a threshold number), a described behavior, a `#Lnn`
line-anchor that may no longer point at what it claims. If a real
mismatch is found: fix it via `docs/HOW_TO_UPDATE_A_COMPONENT.md`'s
process, commit, push, confirm CI green. Append one dated entry below
either way — "no drift found" is itself a real, useful result, not a
skip.

---

## Cycle 1 — 2026-09-11 (run by hand)

Checked `JS-009`, `TAB-001`, `GS-002`, `DATA-001`, `SHEET-007` — 16
line-anchor citations + 1 config-constant description verified against
real current source. 4/5 records fully clean. 1 real (minor) finding:
`SHEET-007` cited `RmHierarchy.gs` `#L826` for the `Manager_Directory`
header array in two places; the real line is `#L824` — pre-existing since
`Last Verified` (`git log c82ec67..HEAD -- RmHierarchy.gs` was empty at
the time), not new drift. Fixed + committed (`85c1e2d`), pushed.
