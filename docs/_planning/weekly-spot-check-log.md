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

---

## Cycle 2 — 2026-09-15 (run by Claude)

Checked `GS-008` (`MovementTracker.gs`), `JS-013`
(`repeat-offenders-pdf.js`), `JS-022` (`tab-repeat-offenders.js`) — all
three untouched by cycle 1. All three had real, substantial drift, not
just line-anchor slippage — this cycle landed between two batches of
real feature commits (the Lead History & Versioning Review's
content-hash dedup, `641398e`/`1c19d1a`; the 2026-09-12 `pruneMovementLog_`
interruption-safety fix, `16a9ec6`; and the 5-part Repeat Offenders
Architecture Redesign, `16b2a7c`..`6259552`) and none of the three
records' `Last Verified` (all still `c82ec67`, 2026-09-10) had been
refreshed since.

**`GS-008`** — every `FN-XXX` line anchor had drifted (the file grew
1000L → 1186L across intervening commits); `pruneMovementLog_`'s
description didn't mention the 2026-09-12 interruption-safety rewrite
(kept rows now written before the tail is cleared, and the whole
clear/write/shrink sequence is skipped when nothing needs pruning — the
old ordering caused a real production data-loss incident on a mid-run
kill); and the record was missing the 2026-09-11 content-hash dedup
entirely — `snapshotOpenLeads_` no longer appends a `Movement_Log` row
for a lead whose content hash is unchanged, and a new `Movement_Log_Runs`
sheet now records that a capture ran independently of whether any lead
changed (`checkMovementLogFreshness_` was silently repointed to read
that new sheet instead of `Movement_Log`'s own last row). Fixed: all
line anchors, `FN-218`/`FN-220`/`FN-226` descriptions, added `CFG-063`
and `EXC-091`, `Sheets touched`, `Cross-runtime duplication`,
`Version / change reference`. **Flagged, not fixed:** `Movement_Log_Runs`
has existed since 2026-09-11 with no `SHEET-XXX` record — needs
`HOW_TO_REGISTER_A_COMPONENT.md` registration (noted as `GS-008`'s own
`## Next action` and caught independently by `check-catalog.py`'s
advisory check L).

**`JS-013`** — every `FN-XXX` line anchor had drifted (492L → 545L), and
the record's central claim — that this file calls `JS-008`'s
`computeRmPerformance`/`computeRmPerformanceByRegion` directly — went
**false** on 2026-09-12 (`9dea24a`, Repeat Offenders Architecture
Redesign Part 5 of 5, "PDF reads the cache, never recomputes"): the PDF
now reads `JS-022`'s `_repeatOffendersLastResult` cache instead, and
gained two new refusal states (no cache yet; cache behind the live
recalculation run). Fixed: Purpose, Responsibilities, the `FN-088`/
`089`/`093` rows, two new `EXC-092`/`093`, Data lineage, `Depends On`.
The same false claim also meant `JS-008`'s own `FN-052`/`FN-060`/`FN-062`
`Called by` cells still wrongly listed `JS-013` — corrected there too
(scoped edit only; `JS-008`'s `Record Status` downgraded `Closed +
Monitored` → `Validated` since the rest of that record wasn't
re-verified this pass).

**`JS-022`** — every `FN-15X` line anchor had drifted (717L → 764L), and
the record didn't mention the `9dea24a` redesign's canonical result
cache (`_repeatOffendersLastResult`/`_repeatOffendersRunId`) at all —
this file is where that cache actually lives and gets populated (in
`_renderRepeatOffendersResult`), and it now also disables
`#repeatOffendersDownloadPdfBtn` for the duration of a recalculation.
Fixed: Purpose, Responsibilities, `FN-153`/`154`/`155` line anchors,
`State owned here`, UI relationships, `Used By`.

**Flagged for human review, not fixed (out of this spot-check's `docs/`
catalog scope):** `HANDOVER.md` §9 (Repeat Offenders) and §2 (Movement
Log) are both still dated "current as of 2026-09-09" and predate every
one of the real changes above — per `CLAUDE.md`'s own rule that a real
architectural change updates `HANDOVER.md` in the *same commit*, this
should have happened when `9dea24a`/`641398e`/`16a9ec6` landed and did
not. Noted on `JS-013`'s and `JS-022`'s own `## Next action`/`## Handover
relationship` fields rather than edited directly here.

Verified before push: `python3 test/check-catalog.py` clean (all
blocking checks A-D, plus G/H/I/N/O/P; only the pre-existing advisory
notes — `Movement_Log_Runs` coverage (L) and the unrelated 46
`c82ec67`-not-in-history last-verified-drift notes (D) — remain, both
already tolerated by that check as advisory); `node
test/check-docs-coverage.js` full coverage; `node test/run-gs-tests.js`
751/751 passing (untouched by this doc-only change). GitHub Actions
confirmed green on the commit after push.
