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

---

## Cycle 3 — 2026-09-22 (run by Claude)

Checked `GS-011` (`RmHierarchy.gs`), `GS-003` (`DailyRmIssueLog.gs`),
`TAB-009` (Opp Monitor), `JS-025` (`tab-oppmonitor.js`) — none checked in
cycles 1 or 2. Two records (`GS-011`, `GS-003`) had real, fixed drift;
`TAB-009` and `JS-025` were clean against current source, with one
doc-internal inconsistency flagged (not fixed) on `TAB-009`.

**`GS-011`** — every `#Lnn` anchor in the record (`## Trigger schedule`,
all of `FN-240`..`FN-247`, `CFG-064`'s two citations) had drifted by
roughly 36 lines. `RmHierarchy.gs` grew 1139L → 1161L via `d71c492`
(2026-09-21, the Mukesh Yadav departure / Kumar Babu staleness-fix
comment block) — the record's own `## Version / change reference`
correctly narrates that commit's *content* change (it was genuinely
revalidated for `RM_HIERARCHY_RAW_`'s data), but the added comment lines
pushed every function below them down and the per-`FN-XXX` line anchors
were never re-grepped to match. Fixed: header `Location` line count
(1139 → 1161), all 13 line-anchor citations, `Last Verified` and
`docs/INDEX.md`'s row bumped to `2026-09-22 (2943ec9)`.

**`GS-003`** — same drift class, worse magnitude. Every `FN-187`..`FN-195`
anchor and the `## Trigger schedule` anchor were stale — the record's own
`## Version / change reference` already states the file grew 1127L →
1264L for the 2026-09-21 `EXC-097` fix (incoming-count sizing + Drive
archive), but, like `GS-011`, that growth was never propagated into the
per-function citations. Drift ranged ~48 lines for functions defined
before the growth to ~137 lines for functions after it — the larger gap
for the later functions is consistent with the record's own `##
Validation` section, which separately documents an earlier
leadership-exclusion mirror addition (`t-rmperf-leadexcl01`, commits
`8eb4b85`/`95305fb`) that added a `RM_PERF_NON_RM_ROLES_GS_` /
`rmPerfIsLeadershipExcludedGs_` block earlier in the file; that addition
was captured in prose but, like `EXC-097`, never propagated into the
line anchors either.
Also dropped one anchor (`pruneDailyRmIssueLog_`'s "shrinks OR grows"
parenthetical used to cite `#L323`) rather than re-verifying and
re-citing a specific sub-line inside that function — kept the claim, cut
the now-unverifiable line pointer. Fixed: all 9 line-anchor citations,
`Last Verified` and `docs/INDEX.md`'s row bumped to
`2026-09-22 (2943ec9)`.

**`TAB-009`** — no code-vs-doc mismatch found (line anchors live on the
owning `JS-025` record, checked clean below; the "hides `#filterBar` via
`TABS_HIDING_FILTER_BAR`" claim was re-verified directly against
`js/overview-distribution-people-ops.js` — still exactly
`new Set(['tab-oppmonitor'])`). **Flagged for human review, not fixed**
(a doc-internal inconsistency, not a code/doc mismatch, so out of this
check's remit to silently pick a side): the record's own `## Closure
evidence` section still reads "Not yet closed — `Record Status: Drafted`,
pending the live-data check noted above," but the header table and
`docs/INDEX.md` both already say `Record Status: Validated`, and
`JS-025`'s own `## Validation` section states the live-data check (real
signed-in dashboard against the live `Opp_Monitor_Period`/
`Opp_Monitor_Month` tabs, confirmed via screenshot) was already done
2026-09-18 — i.e. `TAB-009`'s own stated precondition for closing may
already be satisfied, but that's a judgment call for whoever owns the
record, not something to guess at here.

**`JS-025`** — fully clean. All 10 `#Lnn` citations across
`FN-259`..`FN-264` checked directly against `js/tab-oppmonitor.js`
(currently 324 lines, matching the record's header) and every one
pointed at the exact right line, including the two `async function`
declarations (`fetchOppMonitorData` `#L69`, `_fetchOppMonitorTab` `#L38`)
that a naive `^function ` grep would have missed. No drift.

Verified before push: `python3 test/check-catalog.py` clean (all
blocking checks A-C, plus F-P; only the same pre-existing advisory notes
as prior cycles — `Movement_Log_Runs` coverage (L, not applicable here)
and the `c82ec67`-not-in-history last-verified-drift notes (D, now 32,
unrelated to this cycle's edits) — remain, both already tolerated as
advisory); `node test/check-docs-coverage.js` full coverage (25/25 `js/`,
13/13 `.gs`). No `.gs`/`js/` source touched, so `node
test/run-gs-tests.js` was not re-run for this change. GitHub Actions
confirmed green on the commit after push.

---

## Cycle 4 — 2026-09-29 (run by Claude, scheduled cloud routine)

Checked `GS-006` (`InteractionHistoryLogger.gs`), `GS-013`
(`UnmatchedCommentLogger.gs`), `JS-002` (`core-collation.js`), `SHEET-009`
(`Comment_History`), `TAB-006` (Audit) — none checked in cycles 1-3, and
the oldest still-unrevisited `Last Verified` dates in the catalog
(all five still `2026-09-10 (c82ec67)` going in). 3/5 fully clean;
2 real (both minor) findings, fixed.

**`GS-006`** — fully clean. File length (177 lines) and all 4 `#Lnn`
`FN-XXX` anchors (`#L80`/`#L98`/`#L109`/`#L172`) matched exactly; the
dedup-key logic, the "no own trigger, piggybacks on `snapshotOpenLeads_`"
claim, and the `Depends On` set (`Core.gs`/`FollowupEngine.gs`/
`EmailInfra.gs`) all verified against the real file header + body. No
drift.

**`GS-013`** — fully clean. File length (303 lines) and all 6 `#Lnn`
citations (`#L95`/`#L116`/`#L128`/`#L215`/`#L229`/`#L264`) matched
exactly. No drift.

**`SHEET-009`** — fully clean. The `COMMENT_HISTORY_COLUMNS_` `#L76`
citation and the full 9-column list matched
`InteractionHistoryLogger.gs` exactly. No drift.

**`JS-002`** — real drift, fixed. `## Data lineage` and `##
Revalidation trigger` both described the post-`JS-003` lead object as
carrying only `collatedFrom`/`siblingLeadIds`/`siblingRMs`. Real current
`js/core-fetch-and-render.js` sets two distinct field groups: the
genuine-merge fields `collatedFrom`/`collatedLeadIds`/`collatedRMs`/
`collatedRegions` (what `collationBadge` — this module's primary,
first-documented function — actually reads) and the separate copySplit
"sibling" fields `siblingLeadIds`/`siblingRMs` (read by `siblingNote`/
`familyKeyOf` instead). The record had never named the `collated*`
fields despite `collationBadge` being its headline responsibility —
fixed both sections to name all five fields and which function reads
which. All 8 `#Lnn` `FN-XXX` anchors themselves (`#L19`/`#L42`/`#L54`/
`#L66`/`#L81`/`#L99`/`#L115`/`#L148`/`#L155`) matched exactly — this was
a described-behavior mismatch, not a line-anchor one.

**`TAB-006`** — real drift, fixed. Two independent issues: (1) the
`#tab-audit` line anchor had drifted `#L1233` → real `#L1234` (a one-line
shift from an intervening commit not otherwise touching this record);
(2) `BTN-012`'s "What it does" cell read "Copies the audit result table
to the clipboard" — real `copyAuditIds()` (`js/tab-audit.js` `#L241`)
copies only the matched leads' `lead_id`s, one per line, not the table.
The dashboard's own button label ("Copy lead IDs") was never wrong, only
this record's row text was. Fixed the location line anchor and the
BTN-012 `Label`/`What it does`/`Invokes` cells.

Also found, outside the 5 sampled records but in the same pass over
`docs/INDEX.md`: two stray unsubstituted `%s` template placeholders in
the `Last Verified` column (`GS-002`, `GS-009` rows) instead of a real
commit sha. Not a "correct value unknown" case — both components' own
record files (`docs/gs-modules/GS-002-core.md`,
`docs/gs-modules/GS-009-opschecklistrunner.md`) already stated the real
verifying sha (`4c99f7f`), so this was a mechanical INDEX.md sync gap,
not a judgment call. Fixed both `INDEX.md` cells to match.

Verified before push: `python3 test/check-catalog.py` clean (all
blocking checks A-C, plus F-P; the `GS-002`/`GS-009` rows dropped out of
check D's drift-note list once the `%s` placeholders were fixed,
confirming `4c99f7f` is a real, in-history sha; remaining D notes are the
same pre-existing `c82ec67`/other-sha-not-in-history drift as prior
cycles, unrelated to this cycle's edits); `node
test/check-docs-coverage.js` full coverage (25/25 `js/`, 13/13 `.gs`). No
`.gs`/`js/` source touched, so `node test/run-gs-tests.js` was not
re-run for this change. Pushed as `4a06803` (fixes) +
`31f3217` (placeholder-sha swap); GitHub Actions run 227 triggered on
`31f3217` — status at time of this log entry pending, see the Actions
tab / run 227 for the final result.

---

## Cycle 5 — 2026-10-07 (run by Claude, scheduled cloud routine)

Checked `SHEET-006` (`RM_Hierarchy`), `GS-005` (`FollowupEngine.gs`),
`JS-005` (`core-foundation.js`), `DATA-002` (the SLA-flag pipeline) — none
checked in cycles 1-4, and none touched by the large, separate
in-progress email-pipeline audit (P1-P16, `EMAIL_AUDIT.md`) that landed
immediately before this cycle ran. Note: this cycle's own local clone
started out shallow (50-commit `clone_depth` default) and also started
8 commits behind `origin/master` (the email audit's P13-P16 batch had
landed since this routine's prompt was stored) — unshallowed and
fast-forwarded before doing anything else, since both the catalog check
and an honest "what changed since Last Verified" comparison need full,
current history. 2/4 records had real, fixed drift; 2/4 were fully
clean.

**`SHEET-006`** — real drift, fixed. Two independent issues, both from
`RmHierarchy.gs` roster churn between 2026-09-10 (this record's prior
`Last Verified`) and 2026-10-01 (new-joiner batches, departures, the
Pre Sales team addition, the loan-team BDM alias) that was never
propagated into this record even though `GS-011`'s own record was kept
current through that same period: (1) the header-array line-anchor
citation had drifted `#L443`/`#L475` → real `#L554`/`#L586`
(`ensureRmHierarchySheet_` / `rebuildRmHierarchy`); (2) the stated row
count/role mix ("~270 rows: S1 163, A1 23, Executive 8, BDM 8, Cluster
Head 6, TM 6, S3 5, RH 4, City Lead 3, Manager 1, Commercial Head 1") no
longer matched `RM_HIERARCHY_RAW_`'s real current contents — recomputed
directly from source: 231 rows (S1 162, A1 22, BDM 9, Executive 8,
Cluster Head 7, TM 7, S3 5, City Lead 4, RH 4, Manager 1, Commercial Head
1, and a `Leadership` role not previously listed at all — Shitij Kaushal,
added 2026-09-17, deliberately outside `TOP_OF_ORG_ROLES_`). Fixed both,
`Last Verified`/`Version / change reference`/`docs/INDEX.md` row bumped
to `2026-10-07 (c416a01)`.

**`GS-005`** — fully clean. File length (739 lines, matching the header)
and all 17 `#Lnn` citations across `FN-205`..`FN-211` checked directly
against `FollowupEngine.gs` and every one pointed at the exact right
function; `OUTCOME_RULES_GS_` (`CFG-041`, `#L147`-`#L401`) recounted at
exactly 31 rule objects as claimed. No drift — matches the record's own
note that this file's source hasn't changed since `c82ec67`.

**`JS-005`** — fully clean. File length (246 lines, matching the header)
and all 9 `#Lnn` citations across `FN-026`..`FN-033` checked directly
against `js/core-foundation.js`, plus every `CFG-003`..`CFG-012` literal
value (`5`, `48`, `10`, `3`, `4`, `9`/`19`, the 9-stage `FUNNEL_ORDER`
list, `CLOSED_STAGE_EXACT`/`_STEMS`, `330 * 60000`) — all matched exactly.
No drift.

**`DATA-002`** — real drift, fixed. Its own `## Source of truth` /
`## Validation` sections cite 3 line anchors across 3 different files;
2 of the 3 had drifted: `js/core-lead-model.js` `enrichLead` moved
`#L202` → real `#L241` (the file grew from the 2026-10-07 email-audit
F18 per-lead-call-baseline change, `7799e44`), and
`DailyRmIssueLog.gs` `computeRmPerformanceGs_` moved `#L1071` → real
`#L1289` (unrelated `GS-003` growth, already fixed on `GS-003`'s *own*
record back in spot-check cycle 3). In both cases the owning component's
own record (`JS-006`, `GS-003`) already cited the correct current line —
this was purely a duplicate citation inside `DATA-002` that never got
the same propagation, the exact failure shape `HOW_TO_UPDATE_A_
COMPONENT.md`'s "Recording a new dependency edge" section warns about
for relationship edits, just for a line-anchor instead. The third anchor,
`SlaEngine.gs` `computeSlaFlags_` `#L46`, was already correct — unchanged
since `c82ec67`. Fixed both stale anchors, `Last Verified`/`Version /
change reference`/`docs/INDEX.md` row bumped to `2026-10-07 (7799e44)`.

**Not fixed, flagged for human review:** `SHEET-006`'s own `## Handover
relationship` field states `HANDOVER.md` §2/§4.3 are "current as of
2026-09-09" — `HANDOVER.md` itself has in fact been edited since then
(`check-docs-coverage.js` reports its last edit as 2026-09-29, and the
unshallow fetch pulled in further `HANDOVER.md` changes from the P15/P16
email-audit batch), so that staleness date is itself now wrong. Whether
§2/§4.3's *content* is still accurate for `RM_Hierarchy` is a separate,
larger question this cycle's scope (one record's cited literals/anchors)
didn't attempt — left on `SHEET-006` as a note rather than guessed at.

Verified before push: `python3 test/check-catalog.py` clean (all blocking
checks A-C, plus F-P; the only prints were the pre-existing advisory
notes, unrelated to this cycle's edits); `node test/check-docs-coverage.js`
full coverage (25/25 `js/`, 13/13 `.gs`). No `.gs`/`js/` source touched,
so `node test/run-gs-tests.js` was not re-run for this change. GitHub
Actions confirmed green on the pushed commit(s) before this entry was
finalized.
