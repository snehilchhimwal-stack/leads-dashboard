# GS-011 — RmHierarchy.gs

| | |
|---|---|
| **Type** | `GS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `RmHierarchy.gs` (1122 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

Holds the static org-chart data (~270 rows: RM → TL → TM → RH → CH) and
the recipient-bucketing algorithm that turns a set of flagged RM names
into **one email bucket per manager**, so a scheduled issue email goes
to the specific managers responsible rather than a blanket list. It
exists because the routing logic is intricate (nearest existing tier,
top-of-org backstop, blank-chain handling) and needs one home. The real
employee emails live in `RmHierarchy.private.gs` — **not in this repo**
(gitignored); without it every resolved email is `''` and routing
degrades to a generic fallback (a confirmed soft-degrade, not a crash).

## Responsibilities

- `resolveRmHierarchy_` / `loadRmHierarchyAndEmails_` — build the
  name→chain map (+ emails, if the private file is present).
- `lookupRmChain_` / `lookupEmployeeEmail_` / `normPersonName_` /
  `stripRoleSuffix_` — chain + email lookups.
- `resolveRecipientBucketsForRms_` — the bucketing algorithm (one bucket
  per manager; nearest tier in `tl → tm → rh → ch`; top-of-org backstop).
- `isTopOfOrgRole_` — the `TOP_OF_ORG_ROLES_` test.
- `rebuildRmHierarchy` / `ensureRmHierarchySheet_` /
  `ensureManagerDirectorySheet_` — build/refresh the sheets.
- `auditUnresolvedRms_` / `auditManagerDirectoryEmailGaps_` — the audits
  `OpsChecklistRunner.gs` reuses.
- `setupRmHierarchy` — create the sheets (no trigger).

## Trigger schedule

**None** — `setupRmHierarchy()` (`#L1112`) creates sheets only, installs
no time-based trigger (`LOGIC_AUDIT.md` Part 1 §5). It is, however,
**called by `setupOvernightEmailer()`** (`GS-010`) as a side effect.

## Requires `setupXxx()` re-run when

Re-run `setupRmHierarchy()` when: the org-chart data
(`RM_HIERARCHY_RAW_`) changes and the `RM_Hierarchy` / `Manager_Directory`
sheets need rebuilding; a new column is added to either sheet; or the
private-email file is added/updated and the directory needs a refresh.
It is **not** a schedule change (there is no schedule) — it is a
data-rebuild.

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-240 | `resolveRmHierarchy_()` / `loadRmHierarchyAndEmails_(ss)` `#L418/#L842` | — | the name→chain map (+ emails if the private file is present) | reads `RM_Hierarchy` / `Manager_Directory` | `RmHierarchy.private.gs` (optional, `typeof`-guarded), `lookupEmployeeEmail_` (FN-242) | `resolveRecipientBucketsForRms_` (FN-241), the emailers | reusable |
| FN-241 | `resolveRecipientBucketsForRms_(ss, rmNames, hierarchyData)` `#L1014` | flagged RM names + the chain data | `[{primary, cc, rms}]` — one bucket per manager | reads `Region_Recipients` for a fallback | `lookupRmChain_` (FN-243), `isTopOfOrgRole_` (FN-244), `groupChLevelRmsByCh_` (`GS-004`) | `GS-001`, `GS-010` (via `GS-004`) | reusable — **the routing algorithm**: primary = nearest existing tier in `tl → tm → rh → ch`; a top-of-org person with a fully blank chain diverts to a CH-level backstop, not a normal bucket primary |
| FN-242 | `lookupEmployeeEmail_(name)` / `normPersonName_(name)` / `stripRoleSuffix_(name)` `#L398/#L375/#L986` | a name | the email (`''` if the private file is absent) / a normalised name | none | `EMPLOYEE_EMAIL_BY_NAME_RAW_` (from the private file) | FN-240, FN-241 | reusable |
| FN-243 | `lookupRmChain_(byRmNameLower, rmName)` `#L995` | the map + an RM name | that RM's `{tl, tm, rh, ch}` chain | none | `stripRoleSuffix_` (FN-242) | FN-241 | reusable |
| FN-244 | `isTopOfOrgRole_(role)` `#L913` | a role string | bool — true for `TOP_OF_ORG_ROLES_` = `['cluster head', 'city lead', 'commercial head']` | none | — | FN-241 | reusable — **mirrors `RM_PERF_NON_RM_ROLES`'s top-3 (`JS-008` CFG-020)** |
| FN-245 | `rebuildRmHierarchy()` / `ensureRmHierarchySheet_(ss)` / `ensureManagerDirectorySheetInternal_(ss, forceRefresh)` / `ensureManagerDirectorySheet_(ss)` `#L473/#L438/#L768/#L831` | — | rebuilds the sheets from `RM_HIERARCHY_RAW_` | Sheets writes | — | `setupRmHierarchy` (FN-247), manual | specific |
| FN-246 | `auditUnresolvedRms_(ss)` / `auditUnresolvedRmsNow()` / `auditManagerDirectoryEmailGaps_(ss)` / `auditManagerDirectoryEmailGapsNow()` / `listExcludedRmsNow()` / `clearAllRmHierarchyExclusionsNow()` `#L694/#L746/#L619/#L641/#L549/#L577` | spreadsheet | resolution-gap / email-gap reports (console + return value) | none (audits) / clears exclusions (the two `...Now` mutating ones) | FN-240 | `OpsChecklistRunner.gs` (`GS-009`), `OPS_CHECKLIST.md` manual runs | reusable |
| FN-247 | `setupRmHierarchy()` `#L1112` | — | creates `RM_Hierarchy` + `Manager_Directory` (no trigger) | Sheets writes | FN-245 | Apps Script editor; **called by `setupOvernightEmailer()`** | specific |

## Config constants — `CFG-XXX` sub-table

| ID | Constant | Value | Meaning | Changing it affects |
|---|---|---|---|---|
| CFG-054 | `RM_HIERARCHY_RAW_` | ~270 rows, columns `['team','role','name','tl','tm','rh','ch','excluded','note','email']` — role mix: S1 (163), A1 (23), Executive (8), BDM (8), Cluster Head (6), TM (6), S3 (5), RH (4), City Lead (3), Manager (1), Commercial Head (1) | the static org chart | every routing decision — **requires `setupRmHierarchy()` / `rebuildRmHierarchy()` re-run to reflect in the sheets** |
| CFG-055 | `TOP_OF_ORG_ROLES_` | `['cluster head', 'city lead', 'commercial head']` | roles that get the CH-level backstop, not a normal bucket primary | `isTopOfOrgRole_`; **overlaps `RM_PERF_NON_RM_ROLES` (`JS-008` CFG-020)** — the same 3 roles |
| CFG-056 | `CH_LEVEL_EMAIL_` / `ALWAYS_CC_EMAILS_` | fallback addresses | where routing degrades to when a chain is blank / who is always CC'd | recipient resolution when the private file is absent |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-084 | `RmHierarchy.private.gs` **absent** (the normal state in this repo) | `lookupEmployeeEmail_` returns `''`; routing falls back to `Region_Recipients` then `CH_LEVEL_EMAIL_` | **confirmed a soft-degrade, not a crash** — scheduled emails still send, to a generic fallback (`LOGIC_AUDIT.md` Part 1 §4d) |
| EXC-085 | an RM with a fully blank chain who is top-of-org | diverts to the CH-level backstop rather than becoming a bucket primary | the email reaches a CH-level address, not nobody |
| EXC-086 | an RM name that doesn't resolve at all | `auditUnresolvedRms_` reports it; routing uses the region fallback | flagged for the weekly Ops Checklist email (`GS-009`) |

## Data lineage

`RM_HIERARCHY_RAW_` (in-file) → `rebuildRmHierarchy` → `RM_Hierarchy`
(`SHEET-006`) + `Manager_Directory` (`SHEET-007`). At send time: flagged
RM names → `lookupRmChain_` (FN-243) → `resolveRecipientBucketsForRms_`
(FN-241) reading `RM_Hierarchy` + `Manager_Directory` (+ the private
emails, if present) → `[{primary, cc, rms}]` buckets → used by
`resolveRecipientEmailsForRegion_` (`GS-004`) for every scheduled email.
Full flow: `DATA-005`.

## Sheets touched

| `SHEET-XXX` | Read / Write | Which `FN-XXX` | Notes |
|---|---|---|---|
| `SHEET-006` `RM_Hierarchy` | Write (rebuild) + Read | FN-245 / FN-240 | the org chart, rebuilt from `RM_HIERARCHY_RAW_` |
| `SHEET-007` `Manager_Directory` | Write (rebuild) + Read | FN-245 / FN-242 | hand-filled emails when the private file is absent |
| `SHEET-012` `Region_Recipients` | Read | FN-241 | the routing fallback |

## Failure / error behaviour

The dominant failure mode is the **absent private file** (EXC-084) —
handled as a documented soft-degrade, verified in code, not assumed. The
audits (`auditUnresolvedRms_` / `auditManagerDirectoryEmailGaps_`)
surface gaps proactively via `GS-009`.

## Cross-runtime duplication

`TOP_OF_ORG_ROLES_` overlaps `RM_PERF_NON_RM_ROLES`'s top-3 (`JS-008`
CFG-020) — the same "not a real RM" role set, defined on both runtimes.
The browser reads `RM_Hierarchy` separately for a *display* rollup
(`fetchRmHierarchyForRollup`, `JS-022`) — same source tab, different
consumer, no shared code (`LOGIC_AUDIT.md` Part 1 §4c).

## Not live until pasted

Not running until pasted into the Sheet's Apps Script editor. `RM_HIERARCHY_RAW_`
changes need `rebuildRmHierarchy()` / `setupRmHierarchy()` run to reflect
in the sheets. `RmHierarchy.private.gs` must be obtained out of band and
pasted separately (it is never in git).

## UI relationships

N/A — backend routing. The dashboard's `TAB-004` does its own read of
`RM_Hierarchy` for display.

## Architecture relationship

Apps Script backend. Layer 18 (backend infra / routing) in
`LOGIC_AUDIT.md` Part 1 §1.

## Related documentation

`HANDOVER.md` §2, §4.3; **`OPS_CHECKLIST.md`** (RM-hierarchy gaps,
`Manager_Directory` email gaps); `LOGIC_AUDIT.md` Part 1 §4d, Part 3
§3.7; `CLAUDE.md` (the private-file gotcha).

## Relationships

- **Depends On:** `GS-002` (`Core.gs`), `GS-004` (`EmailInfra.gs` —
  `withRetry_`, `passesGoogleNonUtmSearchGs_`; a file-level circular
  reference, harmless in Apps Script's single namespace),
  `RmHierarchy.private.gs` (optional, `typeof`-guarded, **not in repo**),
  `SHEET-006`, `SHEET-007`, `SHEET-012`
- **Used By:** `GS-004` (`EmailInfra.gs`), `GS-001`, `GS-010`, `GS-009`
  (`OpsChecklistRunner.gs` — the audit functions)
- **Related:** `JS-022` (`tab-repeat-offenders.js` — the separate
  browser read of `RM_Hierarchy`), `JS-008` (`RM_PERF_NON_RM_ROLES`
  overlap)

## Source of truth

`RmHierarchy.gs` at `HEAD`. (`RmHierarchy.private.gs` — never in this
repo; obtain from whoever last held it.)

## Validation

- **Method:** full read at `c82ec67`; function + `TOP_OF_ORG_ROLES_` +
  `RM_HIERARCHY_RAW_` structure verified by grep; the "no trigger,
  creates sheets only" claim and the private-file soft-degrade
  cross-checked against `LOGIC_AUDIT.md` Part 1 §4d/§5 + Part 3 §3.7.
  `Tests_RmHierarchy.gs` runs in CI.
- **Evidence:** `.github/workflows/test.yml` (`Tests_RmHierarchy.gs`,
  last green run); `LOGIC_AUDIT.md` Part 3 §3.7.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-029. File grew 1054L →
1122L since the 2026-09-05 audit (added audit functions for
`OpsChecklistRunner.gs`).

## Revalidation trigger

Any commit touching `RmHierarchy.gs` or `Tests_RmHierarchy.gs`;
`RM_HIERARCHY_RAW_` changes (needs `rebuildRmHierarchy()` / setup re-run);
`TOP_OF_ORG_ROLES_` changes (check the `RM_PERF_NON_RM_ROLES` overlap in
`JS-008`); the bucketing algorithm changes; `RM_Hierarchy` /
`Manager_Directory` (`SHEET-006` / `SHEET-007`) columns change;
`RmHierarchy.private.gs` is added.

## Handover relationship

`HANDOVER.md` §2 names the file ("Resolves each RM's manager chain … so
issue emails route to the right specific managers") and §4.3 covers
`RmHierarchy.private.gs`. Current as of 2026-09-09. An org-chart or
routing-algorithm change must update `HANDOVER.md` §2 and run
`OPS_CHECKLIST.md`'s RM-hierarchy items.

## Lifecycle / retention

N/A — code. `RM_Hierarchy` / `Manager_Directory` are configuration data,
rebuilt from `RM_HIERARCHY_RAW_`, not time-series.

## Next action

none — Closed + Monitored. (The absent private file, EXC-084, is the
expected repo state, handled by design.)

## Closure evidence

Record committed for DOC-029; `docs/INDEX.md` `GS-011` → `Closed +
Monitored`, `Last Verified` 2026-09-10, links + "no trigger / setup
rebuilds sheets" recorded; `CFG-054`..`056`, `EXC-084`..`086`. No
`docs/changes/` record (DOC-029).
