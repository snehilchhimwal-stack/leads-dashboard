# DATA-002 — The SLA-flag pipeline

| | |
|---|---|
| **Type** | `DATA-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | traced path — not a file |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

How a lead's raw stage + timestamps become the 5 Operations SLA flags
and a single headline issue — computed **twice** (browser + Apps
Script), and fanned out to the Operations cards, the nightly census, and
both scheduled emails. Traced once so the seam is visible in one place.

## Origin

A lead row's stage / `lead_assigned_at` / `last_connect_time` / comment
timestamps / `call_attempts` — from `DATA-001` on the browser side, from
`SHEET-001` via `readLeadsTab_` (`GS-004`) on the backend side. Plus a
`Movement_Log` (`SHEET-002`) call-count baseline for `underCalledToday`.

## Transformation

1. **Browser:** `enrichLead` (`JS-006` FN-034, `RULE-005`..`RULE-008`)
   applies `CONFIG` thresholds (`JS-005` CFG-003..CFG-008) →
   `firstContactBreach`, `neverConnected…`, `isNotUpdated`,
   `stageStuck48h`, `followupOverdue` (+ recording / closed-no-comment /
   inactive-RM signals).
2. **Backend:** `computeSlaFlags_` (`GS-012` FN-248, `RULE-033`..`RULE-034`)
   — the port, with `SlaEngine.gs` thresholds (`GS-012` CFG-057..CFG-062).
3. Headline issue: `ISSUE_PRIORITY` (`JS-005` CFG-012) / `primaryIssueGs_`
   (`GS-012` FN-249).
4. RM-performance aggregation over history: `computeRmPerformance`
   (`JS-008` FN-052, `RULE-013`) / `computeRmPerformanceGs_` (`GS-003`
   FN-190).

## Stored As

- Browser: in-memory flags on `leads` / `issueLeads` (not persisted).
- Backend: `SLA_History` (`SHEET-005`) row per run (`GS-008` FN-221);
  `Daily_RM_Issues` (`SHEET-003`) row per open flagged lead at 22:50
  (`GS-003` FN-187).

## Display

`TAB-003` Operations issue cards (`JS-012` FN-081); `TAB-002` KPI strip;
`TAB-004` Repeat Offenders leaderboards (`JS-022` / `JS-017` / `JS-013`);
`TAB-008` Tracking trend chart (from `SLA_History`).

## Ultimate consumer(s)

A human triaging Operations; email recipients of the 17:00 all-issues
digest (`GS-001`) and the 10:00 overnight email (`GS-010`); a manager
reviewing Repeat Offenders.

## Retention

The **flags** are transient (recomputed every render / every run). The
**persisted derivatives** point at their own records: `SHEET-005`
`SLA_History` (`TBD`, long-lived, `DOC-036`) and `SHEET-003`
`Daily_RM_Issues` (**7 days**, confirmed).

## What happens on update

A stage/timestamp change re-derives every dependent flag on the **next**
`enrichLead` pass (browser: next filter/fetch) or the **next trigger
fire** (backend: next `computeSlaFlags_` run). No incremental update —
full recompute each time.

## What happens on delete

A deleted lead drops out of the flag set on the next pass. Its historical
`SLA_History` / `Daily_RM_Issues` rows remain (they are point-in-time
records) until pruned.

## Known gaps

- **Cross-runtime drift risk** — `enrichLead` ↔ `computeSlaFlags_` must
  be edited on both sides; full diff `LOGIC_AUDIT.md` Part 4 §4.2.
- `CONFIG.MIN_CALLS_AFTER_48H` (client) is display-only and disagrees
  with the real threshold (`LOGIC_AUDIT.md` Part 4 §4.9 / Part 7 §18
  MEDIUM #2).
- RM-performance constants (`RM_PERF_*` ↔ `RM_PERF_*_GS_`) must stay
  numerically identical (`JS-008` / `GS-003`).

## Exceptions & error handling

A missing `Movement_Log` baseline → `underCalledToday` falls back to an
absolute count (`JS-006` EXC-011 / `GS-012` EXC-087). An unparseable
timestamp suppresses the dependent flag rather than erroring.

## Architecture relationship

`DASH-001` (browser side) + the Apps Script backend. `LOGIC_AUDIT.md`
Part 1 §1 layers 6, 7, 17.

## Related documentation

`HANDOVER.md` §3 step 3, §6; `OPS_CHECKLIST.md` (SLA-rule drift);
`LOGIC_AUDIT.md` Part 3 §3.1, §3.6, Part 4 §4.2/§4.9, Part 7 §18 MEDIUM
#2.

## Relationships

- **Depends On:** `JS-005`, `JS-006`, `JS-008`, `JS-012`, `GS-002`,
  `GS-003`, `GS-004`, `GS-008`, `GS-012`, `SHEET-001`, `SHEET-002`,
  `DATA-001`, `DATA-004`
- **Used By:** `TAB-002`, `GS-001`, `GS-010`, `SHEET-003`, `SHEET-005`,
  `DATA-005` (the region email consumes the same flags)
- **Related:** `DATA-004` (supplies the baselines + history this flow
  aggregates)

## Source of truth

`js/core-lead-model.js` `enrichLead` `#L202`; `SlaEngine.gs`
`computeSlaFlags_` `#L46`; `DailyRmIssueLog.gs` `computeRmPerformanceGs_`
`#L1071`.

## Validation

- **Method:** traced against `LOGIC_AUDIT.md` Part 3 §3.1/§3.6 + Part 4
  §4.2 (the field-by-field `enrichLead` ↔ `computeSlaFlags_` diff) at
  `c82ec67`. `tests/frontend-harness.html` runs known SLA states;
  `Tests_SlaEngine.gs` / `Tests_DailyRmIssueLog.gs` cover the backend.
- **Evidence:** `LOGIC_AUDIT.md` Part 4 §4.2; `.github/workflows/test.yml`;
  `tests/frontend-harness.html`.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by `DOC-034`.

## Revalidation trigger

Any SLA rule/threshold change on either runtime (`JS-006` / `JS-005` /
`GS-012`); an `RM_PERF_*` / `RM_PERF_*_GS_` constant change; the
`ISSUE_PRIORITY` order changes; `SHEET-003` / `SHEET-005` columns change.

## Handover relationship

`HANDOVER.md` §3 step 3 and §6 cover the flow + its duplication. Current
as of 2026-09-09. A rule change must update `HANDOVER.md` §6 and both
runtimes in the same commit, and run `OPS_CHECKLIST.md`.

## Lifecycle / retention

Flags transient. Persisted derivatives: `SHEET-003` (7d), `SHEET-005`
(`TBD`, `DOC-036`).

## Next action

none — Closed + Monitored. (The cross-runtime drift risk and the
`MIN_CALLS_AFTER_48H` mismatch are known findings tracked on `GS-012` /
`JS-006`.)

## Closure evidence

Record committed for `DOC-034`; `docs/INDEX.md` `DATA-002` row →
`Closed + Monitored`; `Depends On` resolves entirely to existing IDs. No
`docs/changes/` record (`DOC-034`).
