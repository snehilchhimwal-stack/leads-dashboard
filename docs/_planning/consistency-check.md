# Consistency check — catalog vs `LOGIC_AUDIT.md` vs live code (`DOC-041`)

**Produced:** 2026-09-10, against `docs/` + the codebase at commit
`79ce29d`.
**Purpose:** confirm the new catalog states the **same facts** as
`LOGIC_AUDIT.md` for every duplicated-logic pair (not a paraphrase that
drifted), does not resurface any confirmed-stale finding, and matches
**live code** on a direct spot-check.
(`DOCUMENTATION_PROJECT_PLAN.md` Phase 5, `DOC-041`.)

---

## 1. Duplicated-logic pairs — catalog vs `LOGIC_AUDIT.md` Part 3/4

For each pair, `LOGIC_AUDIT.md`'s finding and the catalog's record(s)
were compared for **the same fact**, not a reworded one.

| Pair (`LOGIC_AUDIT.md` §) | `LOGIC_AUDIT.md` says | Catalog says | Match? |
|---|---|---|---|
| `HEADER_ALIASES` ↔ `HEADER_ALIASES_` (Part 4 §4.8) | small diff; `project_region` missing from `HEADER_ALIASES_`, feeds the HIGH Loan finding | `JS-009` CFG-022 ↔ `GS-004` CFG-037, both note the `project_region` gap → Part 4 §4.4 | ✅ same |
| `enrichLead` ↔ `computeSlaFlags_` (Part 4 §4.2) | full field-by-field diff; the 5 SLA checks; `isNotUpdated` no longer gates on `isUnder48h` (2026-09-03, both sides) | `JS-006` RULE-005/007 ↔ `GS-012` RULE-033/034, both cite Part 4 §4.2 and the 2026-09-03 lockstep change | ✅ same |
| `OUTCOME_RULES` ↔ `OUTCOME_RULES_GS_` (Part 4 §4.1) | ~110 vs ~30 rule-count gap, **flagged unverified/unexplained** | `JS-007` RULE-009 ↔ `GS-005` CFG-041, both state the count gap **as an open flag**, not a resolved fact; `DATA-003 ## Known gaps` repeats it | ✅ same (gap preserved as a gap) |
| `FOLLOWUP_SUGGESTIONS` ↔ `_GS_` (Part 3 §3.4) | pure advisory text, human overwrites col F | `JS-007` RULE-012 ↔ `GS-005` CFG-042 | ✅ same |
| `REGION_GROUP_MAP` ↔ `REGION_GROUP_MAP_` (Part 4 §4.3) | **consistent** (audited, no diff) | `JS-014` RULE-017 ↔ `GS-004` CFG-038, both say "audited consistent" | ✅ same |
| `effectiveRegion` Loan override (Part 4 §4.4 / Part 7 §18 HIGH) | **no working `.gs` twin** — missing from all 3 scheduled-email call sites; the one HIGH, live, production-affecting finding | `JS-014` RULE-018 = "NO working twin"; `GS-001`/`GS-010`/`GS-004` each name it; `DATA-005 ## Next action` = "fix the HIGH Loan-region finding" | ✅ same (recorded as a known unresolved defect, not "fine") |
| `RM_PERF_*` ↔ `RM_PERF_*_GS_` (Part 1 §4b) | "must stay numerically identical" | `JS-008` CFG-013..018 ↔ `GS-003` CFG-031..036, both say "must stay numerically identical" | ✅ same (+ verified in §3 below) |
| IST helpers (Part 4 §4.6) | different mechanism, **verified equivalent** | `JS-005` ↔ `GS-002`, both say "different mechanism, verified equivalent" | ✅ same |
| `MIN_CALLS_AFTER_48H` (Part 4 §4.9 / Part 7 §18 MEDIUM) | display-only on the client, disagrees with the real flag threshold | `GS-012` EXC-088 / `JS-006` RULE-006 both cite Part 4 §4.9 as a display/logic mismatch | ✅ same |
| `TEST_MODE_OVERRIDE_EMAIL` ↔ `_` (Part 6 findings) | same footgun shape both runtimes, both unset | `JS-016` CFG-024 ↔ `GS-004` CFG-039, both "footgun, currently `''`" | ✅ same |

**No contradiction found for any duplicated-logic pair.**

## 2. The 7-item UI-redesign bug list (`LOGIC_AUDIT.md` Part 6 §6.1) — none resurfaced as open

`LOGIC_AUDIT.md` Part 6 §6.1 re-verified the pending UI-redesign plan's
7-item bug list and found **all 7 do not reproduce**. Checked the
catalog does **not** re-list any as an open bug:

| # | Item | Where the catalog records it | Listed as open? |
|---|---|---|---|
| 1 | `_logLeadRegistry` unbounded growth | `JS-010` (state table) + `JS-012` FN-077 — "cleared at the top of every `renderAll()` (`#L164`); the concern is already addressed" | **No** |
| 2 | shared `_followupWaitCancelled` boolean cross-cancel | `JS-018` FN-127 — "a `Map` keyed by `cancelBtnId`; the in-code comment describes this exact bug as already fixed" | **No** |
| 3 | `sendAllReportsGmail` missing batch OAuth resume | `JS-015` EXC-028 — "resume branches on `pending.kind==='bulk'` — does not reproduce" | **No** |
| 4 | 2 Operations cards missing `.log-toggle` | `JS-012` FN-081 — "all 9 issue lists confirmed to include `.log-toggle`" | **No** |
| 5 | stale `clearLeadFollowupsTab` doc-comment | `JS-018` FN-125 — "runs at the **START** of every Generate cycle; the comment is correct" | **No** |
| 6 | duplicated `.ms-panel` CSS rule | not cataloged (CSS-level, below the own-ID threshold); `DASH-001 ## Known limitations` cites Part 6 §6.1 "none reproduce" | **No** |
| 7 | `NOT_SHARED` inverted error name | `JS-003` EXC-004/005 — "distinct `NOT_FOUND` (404) / `ACCESS_DENIED` (403), correctly labelled; no `NOT_SHARED` identifier exists" | **No** |

`DASH-001 ## Known limitations` states outright: "The 7-item known bug
list from the earlier UI-redesign plan was **re-verified and none
reproduce**." Consistent with `LOGIC_AUDIT.md` Part 6 §6.1.

## 3. Direct spot-checks against **live code** (≥3 required — 5 done)

Not against `LOGIC_AUDIT.md` — against the current source at `79ce29d`.

| # | Record claim | Live-code check | Result |
|---|---|---|---|
| 1 | `JS-005` CFG-003..012: `MIN_CALLS_PER_DAY 5`, `LEAD_LIFECYCLE_HOURS 48`, `FIRST_CONTACT_SLA_MINUTES 10`, `LEAD_GRACE_HOURS 3`, `FOLLOWUP_REVIEW_HOURS 4`, `WORK_START/END_HOUR 9/19` | `grep -nE '…:' js/core-foundation.js` | ✅ **exact match** (lines 32/34/35/44/45/49/50) |
| 2 | `GS-012` CFG-057..062: `LEAD_GRACE_HOURS_ 3`, `LEAD_LIFECYCLE_HOURS_ 48`, `MIN_CALLS_PER_DAY_ 5`, `FOLLOWUP_REVIEW_HOURS_ 4`, `FIRST_CONTACT_SLA_MINUTES_ 10`, `WORK_START/END_HOUR_ 9/19` | `grep` `SlaEngine.gs` lines 33–39 | ✅ **exact match — and numerically identical to the `JS-005` twins** (the cross-runtime pair holds in live code) |
| 3 | `JS-008` CFG-013..019: `SHRINKAGE_K 8`, `MIN_VOLUME_LEADS 5`, `CHRONIC_STREAK_DAYS 3`, `FLAG_RATIO 1.25`, `CONCENTRATION_BREADTH_CEILING 0.25`, `REPEAT_OFFENDERS_REGION_RM_CAP 5` | `grep` `js/core-rm-performance.js` lines 84/90/97/102/118/729 | ✅ **exact match** |
| 4 | `GS-003` CFG-031..036: `RM_PERF_SHRINKAGE_K_GS_ 8`, `RM_PERF_MIN_VOLUME_LEADS_GS_ 5`, `RM_PERF_FLAG_RATIO_GS_ 1.25` | `grep` `DailyRmIssueLog.gs` lines 771–774 | ✅ **numerically identical** to the `JS-008` values → the "must stay numerically identical" pair is currently in sync |
| 5 | `GS-010` CFG-053 / EXC-079: `setupOvernightEmailer` installs `atHour(10)` + `atHour(13)`, both `.nearMinute(0).everyDays(1)`, **no `.inTimezone()`** — the project's sole trigger outlier | `sed -n '/function setupOvernightEmailer/,/^}/p' OvernightEmailer.gs` | ✅ **exact match** — `atHour(10).nearMinute(0).everyDays(1).create()` and `atHour(13)…`, no `.inTimezone()` on either |

**All 5 spot-checks pass. No drift between the audit, the catalog, and
live code for the checked items.**

## 4. Drift found between the audit and current code (logged, not silently corrected)

`LOGIC_AUDIT.md` is a dated point-in-time report — drift from current
code is **expected** and is logged here / in `logic-audit-source-map.md`
/ `file-inventory.md`, never fixed in `LOGIC_AUDIT.md` itself.

Drift already recorded by earlier Phase 1 tasks (no new drift found in
this pass):

- `LOGIC_AUDIT.md` file counts (23 JS / 11 GS) vs current (24 / 13) —
  `file-inventory.md` (`DOC-001`).
- `LOGIC_AUDIT.md` `#Lnn` citations are against the 2026-09-05 file
  versions; several files grew — `logic-audit-source-map.md` (`DOC-003`)
  / `documentation-conflicts.md` C-9 (`DOC-012`).
- `HANDOVER.md` §9.7 "in progress, 2026-09-04" RM-performance redesign
  has shipped + iterated — `handover-coverage-map.md` C-5 (`DOC-012`),
  a Phase 5 `HANDOVER.md` reconciliation item.

**No new audit-vs-code drift was found in this consistency pass** — the
spot-checks (§3) confirm the catalog's numeric claims match live code
exactly, and every duplicated-logic pair (§1) states the audit's fact
without drift.

---

## Definition of Done check

- **No contradiction found between `LOGIC_AUDIT.md` and the new catalog
  for any duplicated-logic pair** — ✅ (§1: all 10 pairs compared, all
  match; the unresolved-gap findings — the `~110/~30` count, the HIGH
  Loan override — are preserved *as* gaps, not paraphrased away).
- **At least 3 records spot-checked directly against live code** — ✅
  (§3: 5 spot-checks against source at `79ce29d`, all pass; includes a
  live re-verification that the `RM_PERF_*` ↔ `_GS_` "must stay
  numerically identical" pair is currently in sync).
