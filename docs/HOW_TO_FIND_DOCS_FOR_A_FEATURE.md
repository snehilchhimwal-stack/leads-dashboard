# How to find the documentation for a feature (`DOC-043`)

You are about to work on one feature. This is the single short entry
point into the catalog — the practical payoff of the whole thing.

---

## The method

1. **Start at the surface you can see.** Working on a tab? Open its
   `TAB-00N` record (`docs/tabs/`). Working on a button? Its `BTN-XXX`
   row lives inside the owning `TAB-00N` record. A `.gs` job? Its
   `GS-0NN` record (`docs/gs-modules/`). A Sheet tab? `SHEET-0NN`
   (`docs/sheets/`). If you only know the filename, `grep` it in
   `docs/INDEX.md` — the master table maps every file to its ID.
2. **Follow `## Relationships → Depends On`** to the records that
   feature needs to function — usually the owning `JS-XXX` / `GS-XXX`
   module(s).
3. **Follow *their* `Depends On`** to the `SHEET-XXX` tabs they read or
   write, the `EXT-XXX` integrations they call, and the `JS-005` /
   `JS-006` / `GS-002` core records for shared logic.
4. **Stop.** You now have every record relevant to the change and can
   ignore everything else. `docs/RELATIONSHIP_MAP.md` shows the
   highest-traffic chains if you want the shape at a glance first.

Two things worth checking on every record before you change its code:

- **`## Cross-runtime duplication`** — if it names a `JS-` ↔ `GS-` pair,
  a code change touches **both** (`HOW_TO_UPDATE_A_COMPONENT.md`, the
  duplicated-pair rule).
- **`## Handover relationship`** — tells you whether a `HANDOVER.md`
  section also needs updating in the same commit.

---

## Worked example 1 — "change the Snapshot button's behaviour"

1. **Surface:** the "Snapshot now" button is `BTN-014`, in
   `docs/tabs/TAB-007-movement.md` (Movement). Its row says it invokes
   `browserSnapshotOpenLeads` (`JS-018` FN-121) and notes **"no
   reentrancy guard"** (a known finding — `EXC-034`).
2. **Depends On:** `TAB-007`'s Relationships → `JS-021`
   (`tab-movement.js`, which wires the button via `initMovementUI`) and
   `JS-018` (`sheets-writeback.js`, where `browserSnapshotOpenLeads`
   lives).
3. **Their Depends On:** `JS-018` → `SHEET-002` (`Movement_Log` — where
   the snapshot rows go), and it shares the write schema with `GS-008`
   (`MovementTracker.gs`) — `SHEET-002 ## Risks of changing this tab's
   structure` says the two writers' schemas **must be changed in the
   same commit** (`LOGIC_AUDIT.md` Part 4 §4.7). `JS-018` also writes
   `SHEET-005` (`SLA_History`) on the same path.
4. **You now know:** touching this button means `TAB-007` + `JS-021` +
   `JS-018` + `SHEET-002` (+ `GS-008` if the schema moves) + `SHEET-005`
   — and that a reentrancy guard is a legitimate improvement already
   noted in `JS-018` EXC-034 and `OPEN_ITEMS.md` §F.

## Worked example 2 — "add a keyword to the comment classifier"

1. **Surface:** comment classification is `JS-007`
   (`core-outcome-engine.js`), `RULE-009` (`OUTCOME_RULES`).
2. **`## Cross-runtime duplication`** on `JS-007` names the pair:
   `OUTCOME_RULES` ↔ `OUTCOME_RULES_GS_` in `GS-005`
   (`FollowupEngine.gs`), `CFG-041`. **Both** get the keyword, in the
   same commit.
3. **Depends On / Used By:** `JS-007` is used by `JS-006` (`enrichLead`),
   the Operations cards (`TAB-003`), Audit (`TAB-006`), RM Timeline
   (`TAB-005`), and both region-report surfaces — and `GS-005` feeds
   `GS-010` / `GS-001` (the scheduled emails). `DATA-003` traces the
   whole comment → outcome → `Lead_Followups` col F flow.
4. **You now know:** the edit is `JS-007` + `GS-005` (code + both
   records), a note on `DATA-003 ## Known gaps` if the `~110` / `~30`
   count moves, `INDEX.md` `Last Verified` on both, and
   `OPS_CHECKLIST.md`'s pre/post items — without reading any other file.

## Worked example 3 — "the Repeat Offenders ranking looks wrong"

1. **Surface:** `docs/tabs/TAB-004-repeat-offenders.md`.
2. **Depends On:** `JS-022` (`tab-repeat-offenders.js`, the tab),
   `JS-017` (`rm-performance-worker.js`, off-thread compute), `JS-008`
   (`core-rm-performance.js`, the engine — the scoring math + the
   `RM_PERF_*` constants + `rmPerfIsLeadershipExcluded`), `JS-013`
   (`repeat-offenders-pdf.js`, the export).
3. **Their Depends On:** `JS-008` → `SHEET-002` (`Movement_Log` history)
   + `SHEET-006` (`RM_Hierarchy` for the leadership exclusion). `JS-008
   ## Cross-runtime duplication` names the `.gs` mirror: `GS-003`
   (`DailyRmIssueLog.gs` `reportRmPerformanceNow`), whose `RM_PERF_*_GS_`
   constants **must stay numerically identical** (`DOC-041` confirmed
   they currently are).
4. **You now know:** the ranking spans `TAB-004` + `JS-022`/`017`/`008`/
   `013` + `SHEET-002`/`006` + the `GS-003` mirror — and `HANDOVER.md`
   §9 (via `JS-008 ## Handover relationship`) is the narrative context,
   though `OPEN_ITEMS.md` §D flags §9.7 as stale.

---

## Definition of Done check

- **A developer unfamiliar with the project can follow one worked
  example end-to-end using only this guide and the catalog** — ✅. Each
  example starts from a visible surface, names the exact record IDs to
  open at each hop, and ends with a concrete "you now have everything
  relevant" statement. No prior knowledge of the codebase is assumed
  beyond reading the linked records.
