# validation — evidence index

Where a record's `## Validation` / `## Closure evidence` field points when
"show me the proof this is correct" needs more than a sentence. The
Governance Model's Final Control Model lists `docs/validation/` as
"evidence per ID — what test, which run, which commit".

At this project's scale most evidence is **one line**, so it lives here in
a table rather than 69 tiny files. Add a dedicated
`docs/validation/<ID>.md` only when an ID's evidence is genuinely
long-form (a reproduction, a dataset, a multi-step manual procedure).

---

## Evidence table

| Area / ID | Claim | Evidence | Verified at | Status |
|---|---|---|---|---|
| **All 69 records** | content matches the code | full read + grep during `DOC-025`–`DOC-034`; `LOGIC_AUDIT.md` (2026-09-07) cross-check; `_planning/completeness-verification.md` / `consistency-check.md` | `c82ec67` — and `git log c82ec67..HEAD -- js/*.js *.gs dashboard.html` is **empty**, so still current | ✅ |
| **`INDEX.md` reciprocity** | 0 one-directional `Depends On`/`Used By` | `DOC-040` python walk (→ `reference-verification.md`); now `test/check-catalog.py` A, blocking, green every push | `de693e5` + every later push | ✅ (enforced) |
| **69 records == `INDEX.md`** | each record's `## Relationships` == its row | `<scratch>/recip_verify.py` → 69/69, 0 asymmetries | `de693e5` | ✅ |
| **`CI-001`–`CI-005`** (`test/check-docs-coverage.js`) | file↔record coverage + `HANDOVER.md` age, warn-only | GitHub Actions "Apps Script tests", every push; script read directly (this repo wrote it) | live | ✅ (runs; warn-only by design) |
| **`t-tf-5ad22d8e4c2e`** (`test/check-catalog.py`) | catalog tripwires A–F | run #76 (`cb5afb1`) green on the runner; A/B/C/F green locally; E produces a correct ops JSON for a real `RM_PERF_` commit range | `cb5afb1` → | ✅ |
| **`.gs` logic** | every production `.gs` behaves as documented | `Tests_*.gs` via `node test/run-gs-tests.js`, blocking in CI, green (runs #66–#78+) | every push | ✅ |
| **`js/*.js` render pipeline** | `fetchAndRender` + tab renderers don't throw on synthetic data; key outputs correct | `tests/frontend-harness.html` — **in CI headless** (`test/run-frontend-harness.mjs` via Playwright, non-blocking) since 2026-09-10; `window.__harnessResults` / `HARNESS_RESULT` console line | CI run #83 (`78f3816`) — harness step green | ✅ (non-blocking; flip once stable) |
| **`DATA-005` — Loan-region override** | the client-side `effectiveRegion` Loan override has **no working `.gs` twin** (a real HIGH finding, `LOGIC_AUDIT.md` Part 4 §4.4 / Part 7 §18) | `DATA-005 ## Next action`; `JS-014` `RULE-018`; `LOGIC_AUDIT.md` | 2026-09-07 (audit) | ⚠ open finding — recorded, not fixed |
| **`SHEET-002` retention (`Movement_Log`, 7d)** | `pruneMovementLog_` enforces `MOVEMENT_LOG_RETENTION_DAYS = 7` | `MovementTracker.gs` constant read + `Tests_MovementTracker.gs`; `LOGIC_AUDIT.md` Part 1 §4d | `c82ec67` | ✅ confirmed |
| **`SHEET-003` retention (`Daily_RM_Issues`, 7d)** | `pruneDailyRmIssueLog_` enforces `DAILY_RM_ISSUE_LOG_RETENTION_DAYS_ = 7` (added after the 2026-09-06 10M-cell crash) | `DailyRmIssueLog.gs` constant read; `HANDOVER.md` §9.2 incident | `c82ec67` | ✅ confirmed |
| **7 other `SHEET-` tabs** | retention is genuinely unknown | no `prune*_` / `clear*` fn touches them (grep); `retention-decisions-needed.md` | 2026-09-10 | ⚠ `TBD` — awaiting a decision |

---

## How to add a row

When you revalidate a record (Change-Control Mechanism step 9), add or
update its row here: the claim, a link to the *actual* test / CI run /
commit (never "it was tested"), the commit you verified at, and a status
(✅ / ⚠ / ✘). If the evidence is a CI run, link the run URL.
