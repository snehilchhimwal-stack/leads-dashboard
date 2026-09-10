# SHEET-006 — RM_Hierarchy

| | |
|---|---|
| **Type** | `SHEET-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | Google Sheet, tab `RM_Hierarchy` |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

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

~270 rows (role mix: S1 163, A1 23, Executive 8, BDM 8, Cluster Head 6,
TM 6, S3 5, RH 4, City Lead 3, Manager 1, Commercial Head 1).

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

Exact list: `RmHierarchy.gs` `#L443` / `#L475`
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

- **Depends On:** `RM_HIERARCHY_RAW_` (in `GS-011`),
  `RmHierarchy.private.gs` (optional), `EXT-001`
- **Used By:** `GS-011`, `GS-004`, `GS-001`, `GS-010`, `GS-009`,
  `JS-022`, `JS-013`, `TAB-004`
- **Related:** `SHEET-007` (`Manager_Directory`), `SHEET-012`
  (`Region_Recipients`)

## Source of truth

The live `RM_Hierarchy` tab; its content is authored by
`RM_HIERARCHY_RAW_` (`RmHierarchy.gs`).

## Validation

- **Method:** header read from `RmHierarchy.gs` `#L443`/`#L475` at
  `c82ec67`; role distribution from `LOGIC_AUDIT.md` Part 1 §4d / the
  summary in this session's context; `Tests_RmHierarchy.gs` in CI.
- **Evidence:** `.github/workflows/test.yml` (`Tests_RmHierarchy.gs`,
  last green run); `LOGIC_AUDIT.md` Part 3 §3.7.
- **Status:** Validated 2026-09-10 (non-lifecycle); lifecycle framing
  `TBD` (`DOC-036`).

## Version / change reference

Verified at `c82ec67`; record created by `DOC-032`.

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
