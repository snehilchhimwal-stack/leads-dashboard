# SHEET-006 — RM_Hierarchy

| | |
|---|---|
| **Type** | `SHEET-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | Google Sheet, tab `RM_Hierarchy` |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-10-07 against commit `c416a01` (weekly spot-check cycle 5) |

## Purpose / reason to exist

The org chart, materialised as a sheet: for each RM, their team, role,
and manager chain (TL → TM → RH → CH), plus an `excluded` flag and a
`note`. It exists so the scheduled issue emails can route to the
**specific** managers responsible for a flagged RM (via
`resolveRecipientBucketsForRms_`), and so the dashboard's Repeat
Offenders tab can label each RM's tier. It is **configuration data**,
rebuilt from `RM_HIERARCHY_RAW_` in `RmHierarchy.gs` — not a log.

## Reason to exist

Routing logic needs a queryable org chart; keeping it in a sheet (rather
than only in code) lets a non-developer see and, via `excluded`, adjust
who is in scope.

## Data stored

231 rows (role mix: S1 162, A1 22, BDM 9, Executive 8, Cluster Head 7,
TM 7, S3 5, City Lead 4, RH 4, Manager 1, Commercial Head 1, Leadership 1 —
the last is Shitij Kaushal, added 2026-09-17 with role literally
`'Leadership'`, deliberately not in `TOP_OF_ORG_ROLES_` (`RmHierarchy.gs`
`#L401`'s comment)).

## Source of the data

`GS-011` `rebuildRmHierarchy` / `ensureRmHierarchySheet_` — written from
the in-code `RM_HIERARCHY_RAW_` constant. Not hand-edited as the source
(edits should go to `RM_HIERARCHY_RAW_` + a rebuild), though `excluded`
can be toggled in-sheet.

## Destination / consumers

- `GS-011` `resolveRmHierarchy_` → routing for `GS-001` / `GS-010`.
- `JS-022` `fetchRmHierarchyForRollup` → `rmHierarchyByNameLower` → the
  Repeat Offenders display rollup + `JS-013` PDF (leadership exclusion).
- `GS-009` `auditUnresolvedRms_` → the weekly Ops Checklist email.

## Columns / fields

| Column | Type | Meaning |
|---|---|---|
| `team` | text | the RM's team |
| `role` | text | S1 / A1 / TM / RH / Cluster Head / City Lead / Commercial Head / … |
| `name` | text | the person |
| `tl` / `tm` / `rh` / `ch` | text | the manager chain (blank where none) |
| `excluded` | bool-ish | exclude this RM from routing / ranking |
| `note` | text | free-text |
| `email` | text | populated from `RmHierarchy.private.gs` if present, else `''` |

Exact list: `RmHierarchy.gs` `#L554` (`ensureRmHierarchySheet_`) / `#L586`
(`rebuildRmHierarchy`)
(`['team','role','name','tl','tm','rh','ch','excluded','note','email']`).

## Writers

| Writer | `FN-XXX` | Mode |
|---|---|---|
| `GS-011` | `rebuildRmHierarchy` / `ensureRmHierarchySheet_` (FN-245) | full rebuild from `RM_HIERARCHY_RAW_` |
| *(a human)* | — | `excluded` toggles in-sheet |

## Readers

| Reader | `FN-XXX` | For |
|---|---|---|
| `GS-011` | `resolveRmHierarchy_` / `lookupRmChain_` (FN-240/243) | routing buckets |
| `JS-022` | `fetchRmHierarchyForRollup` (FN-150) | display rollup + leadership exclusion |
| `JS-013` | via `rmHierarchyByNameLower` | keeps leadership out of the PDF |
| `GS-009` | `auditUnresolvedRms_` (via `GS-011` FN-246) | the weekly checklist |

## Automation / triggers touching it

`setupRmHierarchy()` creates/rebuilds it (no time trigger).
`setupOvernightEmailer()` calls `setupRmHierarchy()` as a side effect.

## Apps Script functions touching it

Write: `rebuildRmHierarchy`, `ensureRmHierarchySheet_`,
`ensureManagerDirectorySheetInternal_` (`GS-011`). Read:
`resolveRmHierarchy_`, `loadRmHierarchyAndEmails_`, `lookupRmChain_`,
`auditUnresolvedRms_`, `auditManagerDirectoryEmailGaps_` (`GS-011`).

## Data Lifecycle (DOC-019 — completed by `DOC-036`, 2026-09-10)

- **Data Type:** **configuration** (a current-state table, not a time
  series).
- **Retention Period:** **N/A — configuration.** Rebuilt on demand from
  the in-code `RM_HIERARCHY_RAW_` constant; there is no history to
  retain and no `prune*_` function (correctly — none is needed).
- **Enforced By:** N/A — `rebuildRmHierarchy` (`GS-011`) overwrites the
  tab in full.
- **Archive / Delete Behavior:** overwritten on every rebuild; no
  history kept. `clearAllRmHierarchyExclusionsNow` clears the
  `excluded`-column flags only, not rows.
- **Sensitivity:** **contains real employee names, and (when
  `RmHierarchy.private.gs` is present) real employee emails — FLAGGED
  for review**, adjacent to the `RmHierarchy.private.gs` real-employee-
  data concern. A backend job depends on it directly (routing —
  `LOGIC_AUDIT.md` Part 3 §3.7). `DOC-038` completes the classification.

## Sensitivity & operational importance (DOC-038)

- **Operational importance:** **CRITICAL** — an unattended backend job breaks or mis-routes if this tab is broken/missing.
- **Data sensitivity:** **contains real employee data** — employee names, and (with `RmHierarchy.private.gs`) real emails.
- **Reason:** `GS-011` resolves **every** scheduled email's recipient bucket from it (`LOGIC_AUDIT.md` Part 3 §3.7); a stale/broken row mis-routes or (via the fallback chain) sends an issue email to a generic backstop instead of the responsible manager. FLAGGED per `DOC-036`.

## Risks of changing this tab's structure

A column rename breaks `resolveRmHierarchy_`'s parsing and `JS-022`'s
rollup. Adding a column is safe if `RM_HIERARCHY_RAW_` and the sheet
writer are updated together. `TOP_OF_ORG_ROLES_` (`GS-011`) and
`RM_PERF_NON_RM_ROLES` (`JS-008`) both depend on the `role` values —
changing role vocabulary needs both updated.

## Relationships to other tabs

Feeds routing for the scheduled emails (with `SHEET-007`
`Manager_Directory` for the actual addresses and `SHEET-012`
`Region_Recipients` as a fallback). Independent of `leads`.

## Important logic / business rules

Primary recipient = nearest existing tier in `tl → tm → rh → ch`; a
top-of-org person with a fully blank chain diverts to a CH-level backstop
(`GS-011` FN-241 / EXC-085). The browser's read is separate from the
routing read — same tab, different consumers (`LOGIC_AUDIT.md` Part 1
§4c).

## Exceptions & error handling

`RmHierarchy.private.gs` absent → `email` column is all `''` → routing
degrades to `Region_Recipients` / `CH_LEVEL_EMAIL_` (`GS-011` EXC-084) —
a confirmed soft-degrade.

## Related documentation

`HANDOVER.md` §2, §4.3; `OPS_CHECKLIST.md` (RM-hierarchy gaps);
`LOGIC_AUDIT.md` Part 1 §4c/§4d, Part 3 §3.7.

## Relationships

- **Depends On:** `GS-011`, `EXT-001`
- **Used By:** `TAB-004`, `JS-008`, `JS-013`, `JS-022`, `GS-001`,
  `GS-004`, `GS-009`, `GS-010`, `GS-011`, `SHEET-007`
- **Related:** `SHEET-007` (`Manager_Directory`), `SHEET-012`
  (`Region_Recipients`)

## Source of truth

The live `RM_Hierarchy` tab; its content is authored by
`RM_HIERARCHY_RAW_` (`RmHierarchy.gs`).

## Validation

- **Method:** header read from `RmHierarchy.gs` `#L554`/`#L586` at
  `c416a01`; role distribution recomputed directly from the live
  `RM_HIERARCHY_RAW_` array at the same commit (weekly spot-check cycle 5,
  2026-10-07); `Tests_RmHierarchy.gs` in CI.
- **Evidence:** `.github/workflows/test.yml` (`Tests_RmHierarchy.gs`,
  last green run); `LOGIC_AUDIT.md` Part 3 §3.7.
- **Status:** Validated 2026-10-07 (non-lifecycle); lifecycle framing
  `TBD` (`DOC-036`).

## Version / change reference

Verified at `c82ec67`; record created by `DOC-032`. Re-verified at
`c416a01` (2026-10-07, weekly spot-check cycle 5) — the row count/role mix
and the header-array line anchors had drifted from the roster churn
between 2026-09-10 and 2026-10-01 (new-joiner batches, the Pre Sales team
addition, departures); fixed both, no other field affected.

## Revalidation trigger

The column set changes; `RM_HIERARCHY_RAW_` role vocabulary changes
(check `TOP_OF_ORG_ROLES_` + `RM_PERF_NON_RM_ROLES`); a new consumer
reads it; `RmHierarchy.private.gs` is added.

## Handover relationship

`HANDOVER.md` §2/§4.3 cover it. Current as of 2026-09-09. A column or
role-vocabulary change must update `HANDOVER.md` §2 and run
`OPS_CHECKLIST.md`'s RM-hierarchy items.

## Lifecycle / retention

`TBD` — deferred to `DOC-036`. Framing: **configuration table**, rebuilt
on demand, no history retained.

## Next action

`DOC-036` — record the "configuration, no retention" framing + the
employee-data sensitivity classification.

## Closure evidence

Record committed for `DOC-032`; `docs/INDEX.md` `SHEET-006` → `Closed +
Monitored` (non-lifecycle scope), `Last Verified` 2026-09-10; columns
sourced from `RmHierarchy.gs`, not approximated; Data Lifecycle `TBD`
per `DOC-032` boundary.
