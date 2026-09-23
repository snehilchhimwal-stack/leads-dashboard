# GS-011 — RmHierarchy.gs

| | |
|---|---|
| **Type** | `GS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `RmHierarchy.gs` (1200 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-23 against commit (pending commit) (line-anchor resync only, +39-line offset from the 2026-09-22 refresh — see `## Version / change reference`) |

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

**None** — `setupRmHierarchy()` (`#L1190`) creates sheets only, installs
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
| FN-240 | `resolveRmHierarchy_()` / `loadRmHierarchyAndEmails_(ss)` `#L493/#L917` | — | the name→chain map (+ emails if the private file is present) | reads `RM_Hierarchy` / `Manager_Directory` | `RmHierarchy.private.gs` (optional, `typeof`-guarded), `lookupEmployeeEmail_` (FN-242) | `resolveRecipientBucketsForRms_` (FN-241), the emailers | reusable |
| FN-241 | `resolveRecipientBucketsForRms_(ss, rmNames, hierarchyData)` `#L1092` | flagged RM names + the chain data | `[{primary, cc, rms}]` — one bucket per manager | reads `Region_Recipients` for a fallback | `lookupRmChain_` (FN-243), `isTopOfOrgRole_` (FN-244), `groupChLevelRmsByCh_` (`GS-004`) | `GS-001`, `GS-010` (via `GS-004`) | reusable — **the routing algorithm**: primary = nearest existing tier in `tl → tm → rh → ch`; a top-of-org person with a fully blank chain diverts to a CH-level backstop, not a normal bucket primary |
| FN-242 | `lookupEmployeeEmail_(name)` / `normPersonName_(name)` / `stripRoleSuffix_(name)` `#L473/#L450/#L1064` | a name | the email (`''` if the private file is absent) / a normalised name | none | `EMPLOYEE_EMAIL_BY_NAME_RAW_` (from the private file) | FN-240, FN-241 | reusable |
| FN-243 | `lookupRmChain_(byRmNameLower, rmName)` `#L1073` | the map + an RM name | that RM's `{tl, tm, rh, ch}` chain | none | `stripRoleSuffix_` (FN-242) | FN-241 | reusable |
| FN-244 | `isTopOfOrgRole_(role)` `#L988` | a role string | bool — true for `TOP_OF_ORG_ROLES_` = `['cluster head', 'city lead', 'commercial head']` | none | — | FN-241 | reusable — **mirrors `RM_PERF_NON_RM_ROLES`'s top-3 (`JS-008` CFG-020)** |
| FN-245 | `rebuildRmHierarchy()` / `ensureRmHierarchySheet_(ss)` / `ensureManagerDirectorySheetInternal_(ss, forceRefresh)` / `ensureManagerDirectorySheet_(ss)` `#L548/#L513/#L843/#L906` | — | rebuilds the sheets from `RM_HIERARCHY_RAW_` | Sheets writes | — | `setupRmHierarchy` (FN-247), manual | specific |
| FN-246 | `auditUnresolvedRms_(ss)` / `auditUnresolvedRmsNow()` / `auditManagerDirectoryEmailGaps_(ss)` / `auditManagerDirectoryEmailGapsNow()` / `listExcludedRmsNow()` / `clearAllRmHierarchyExclusionsNow()` `#L769/#L821/#L694/#L716/#L624/#L652` | spreadsheet | resolution-gap / email-gap reports (console + return value) | none (audits) / clears exclusions (the two `...Now` mutating ones) | FN-240 | `OpsChecklistRunner.gs` (`GS-009`), `OPS_CHECKLIST.md` manual runs | reusable |
| FN-247 | `setupRmHierarchy()` `#L1190` | — | creates `RM_Hierarchy` + `Manager_Directory` (no trigger) | Sheets writes | FN-245 | Apps Script editor; **called by `setupOvernightEmailer()`** | specific |

## Config constants — `CFG-XXX` sub-table

| ID | Constant | Value | Meaning | Changing it affects |
|---|---|---|---|---|
| CFG-054 | `RM_HIERARCHY_RAW_` | ~270 rows, columns `['team','role','name','tl','tm','rh','ch','excluded','note','email']` — role mix as of `c82ec67`: S1 (163), A1 (23), Executive (8), BDM (8), Cluster Head (6), TM (6), S3 (5), RH (4), City Lead (3), Manager (1), Commercial Head (1). **2026-09-16 (`42ebfaf`):** Akash A Ugale's own row role formalized A1 → TM (his real title, confirmed by the user — his 8 direct Central S1 reports are unaffected, their rows already carry `tl:'Akash A Ugale'` directly); moved from Yash Sharma's row's `tl` column into `tm` (matching the Pune TM pattern) so `TM_STILL_CC_` (`CFG-064` below) picks him up; added `['Thane','S1','Mamtaben S 1','Amit Upadhyay','','','Bipin More']` as a confirmed alias row for `Mamtaben Sosa` — the leads sheet drops her surname and appends a role suffix, a pattern `stripRoleSuffix_` alone doesn't catch (it only strips the suffix, not a dropped surname). **2026-09-17 (`77e1eb9`):** Krishna Murthy's row removed (left the company, same handling as Prathamesh A Pande 2026-08-31); his 4 direct reports' `tl` cleared, falling through to their already-present `ch:'Mukesh Mishra'`. Vidya Jadhav's and Bipin More's own rows (both previously blank-chain Cluster Heads) gained `ch:'Shitij Kaushal'`; a new row added for him (`['Leadership','Leadership','Shitij Kaushal','','','','']` — role corrected same day from an initial 'Commercial Head' guess to 'Leadership' per the user directly; not in `TOP_OF_ORG_ROLES_`, harmless since he's never himself a flagged RM). **2026-09-21 (`d71c492`):** Mukesh Yadav's row removed (left the company, confirmed by the user, same handling as Krishna Murthy). His 3 direct reports with a confirmed replacement manager in the fresh HR export (Zeya Shaikh, Karan Shinde, Mayuresh Chavan) had `tl` updated to `'Kumar Babu'` — their real current manager, not a blank fallback — since Kumar Babu already has his own row elsewhere in this array with other direct reports; this was a genuine staleness bug (3 rows still pointed at Mukesh Yadav after Kumar Babu had already been onboarded for his other reports). Vivek Yadav's `tl` was cleared to blank (falls through to his own already-present `rh:'Rajkumar Ombase'`) since he doesn't appear anywhere in the fresh HR export either — unconfirmed whether he also left; flagged to the user rather than guessed. The `Mamtaben S 1` alias row (added `42ebfaf`, see above) was corrected to `Mamtaben S 1 Account` — the user clarified the full leads-sheet string includes "Account", which the original entry was missing (a real routing-miss risk: a partial alias string never matches the leads sheet's actual name). | the static org chart | every routing decision — **requires `setupRmHierarchy()` / `rebuildRmHierarchy()` re-run to reflect in the sheets** |
| CFG-055 | `TOP_OF_ORG_ROLES_` | `['cluster head', 'city lead', 'commercial head']` | roles that get the CH-level backstop, not a normal bucket primary | `isTopOfOrgRole_`; **overlaps `RM_PERF_NON_RM_ROLES` (`JS-008` CFG-020)** — the same 3 roles |
| CFG-056 | `CH_LEVEL_EMAIL_` / `ALWAYS_CC_EMAILS_` | fallback addresses | where routing degrades to when a chain is blank / who is always CC'd | recipient resolution when the private file is absent |
| CFG-064 | `TM_STILL_CC_` | `['ayaz bagwan', 'rahul poudel', 'akash a ugale']` (`#L1052`) | lowercased names of TMs who are also, for specific named exceptions, the direct manager of some of their own reports (not just a `tl`-level report of someone else) — `resolveRecipientBucketsForRms_` (FN-241, `#L1167`) CCs a matching TM even when they're not the resolved primary, since a person's direct manager already IS the "To" and would otherwise never see it. Renamed from `PUNE_TM_STILL_CC_` and generalized (no longer Pune-exclusive) when Akash A Ugale was added `42ebfaf` — the exception now names a mechanism, not a region | who gets CC'd on issue emails for these 3 TMs' own direct reports |

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
§3.7; `CLAUDE.md` (the private-file gotcha; the `check-rm-hierarchy-
drift.py` pre-edit step, added 2026-09-21). `test/check-rm-hierarchy-
drift.py` — not part of this file's own code, but a standing companion
check to run against a fresh HR export before hand-editing
`RM_HIERARCHY_RAW_` off of it (catches the Mukesh Yadav-class staleness
bug `auditUnresolvedRmsNow()` can't see).

## Relationships

- **Depends On:** `GS-002` (`Core.gs`), `GS-004` (`EmailInfra.gs` —
  `withRetry_`, `passesGoogleNonUtmSearchGs_`; a file-level circular
  reference, harmless in Apps Script's single namespace), `SHEET-006`,
  `SHEET-007`, `SHEET-012`
- **Used By:** `GS-001`, `GS-004` (`EmailInfra.gs`), `GS-009`
  (`OpsChecklistRunner.gs` — the audit functions), `GS-010`,
  `SHEET-006`, `SHEET-007`
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
  `Tests_RmHierarchy.gs` runs in CI. Revalidated 2026-09-17 against
  `42ebfaf`: read the current `RM_HIERARCHY_RAW_`/`TM_STILL_CC_` source
  directly (`grep` confirmed both the Akash A Ugale row change and the
  Mamtaben alias row); `Tests_RmHierarchy.gs` gained a real-data
  spot-check for both hierarchy changes plus a new self-contained
  mock-hierarchy test exercising `TM_STILL_CC_`'s Cc-injection mechanism
  for the first time under test (previously only implicitly relied on in
  production). Same-day, `77e1eb9`: read the Krishna Murthy removal and
  Shitij Kaushal addition directly in source; confirmed the `ch`-slot
  placement (not `tm`) means no `TM_STILL_CC_` entry is needed for Shitij
  — `ch` is already in `resolveRecipientBucketsForRms_`'s default CC set.
- **Evidence:** `.github/workflows/test.yml` (`Tests_RmHierarchy.gs`,
  last green run); `LOGIC_AUDIT.md` Part 3 §3.7; commits `42ebfaf`,
  `77e1eb9`; `python3 test/run-gs-tests-headless.py` local run (785/785
  pass) for the 2026-09-21 change.
- **Status:** Validated 2026-09-21. Revalidated against a live HR export
  (`HR Live - Sheet1 (2).csv`, user-supplied, real employee data — not
  committed) cross-checked directly against `RM_HIERARCHY_RAW_`: Mukesh
  Yadav's departure and Kumar Babu's already-in-file entry both confirmed
  from the same export rather than guessed.

## Version / change reference

Verified at `77e1eb9`; record created by DOC-029, revalidated 2026-09-17
twice same day: for the Akash A Ugale role formalization (A1 → TM, moved
into `TM_STILL_CC_`) and the Mamtaben Sosa alias row (`42ebfaf`), then
for the Krishna Murthy departure and Shitij Kaushal addition (`77e1eb9`).
File grew 1054L → 1139L since the 2026-09-05 audit (added audit
functions for `OpsChecklistRunner.gs`). Revalidated 2026-09-21
(`d71c492`) for Mukesh Yadav's departure, the Kumar Babu tl staleness fix
on 3 of his reports, Vivek Yadav's tl clear, and the `Mamtaben S 1` →
`Mamtaben S 1 Account` alias correction. Revalidated again 2026-09-21
(`69623d2`) — orthogonal: the header docblock gained a pointer to
`test/check-rm-hierarchy-drift.py` as a standing pre-edit step;
`RM_HIERARCHY_RAW_` itself unchanged. **Line-anchor resync 2026-09-22**
(weekly spot-check cycle 3, against `2943ec9`): every `#Lnn` citation in
this record (`## Trigger schedule`, all of `FN-240`..`FN-247`, `CFG-064`)
had drifted by the ~36 lines the `d71c492` departure-comment additions
inserted before them — the file's own line count (1139 → 1161) was never
carried into this record's per-function anchors even though the header's
prose was updated same-day. Re-grepped every citation against current
source and corrected; no functional/behavioral change, `Record Status`
unaffected.

**Revalidated 2026-09-22** (`187450a`): added `test/refresh-rm-hierarchy.py`
— the first tool that actually PERFORMS a refresh instead of only detecting
drift (see its own docstring and the header docblock's updated pointer);
`check-rm-hierarchy-drift.py` is unchanged and still imported by the new
script, not replaced. Used it against the 2026-09-21 HR export to add Zoya
Fathima's own row plus 2 other unambiguous new hires, and correct 7 rows'
`ch` from the old Mukesh-Mishra override to her (Vemula Ajay's Hyderabad
sub-cluster). `RM_HIERARCHY_RAW_` grew by ~35 lines (228 → 231 rows plus a
multi-line explanatory comment for the Zoya Fathima addition).

**Line-anchor resync 2026-09-23** (pending commit — closing the gap the note
above left open, per `CLAUDE.md`'s own "resolve check D drift your own
session caused before ending it" rule): every `#Lnn` citation in this
record (`## Trigger schedule`, all of `FN-240`..`FN-247`, `CFG-064`) had
drifted by a uniform +39 lines from the 2026-09-22 refresh's insertion
before `RM_HIERARCHY_RAW_` — confirmed uniform by grepping every cited
function's real current line and diffing against the citation (all 39,
no exceptions), then re-grepped and corrected each one individually
rather than blind-applying the offset. `check-catalog.py`'s check D
flagged this same drift while working on an unrelated task
(`t-tf-78184a3471c5`, the email-lifecycle redesign) — fixed immediately
rather than deferred. No functional/behavioral change,
`Record Status` unaffected.

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
`docs/changes/` record (DOC-029). Revalidated 2026-09-17 (`42ebfaf`):
`CFG-054` updated for the Akash A Ugale role change + Mamtaben alias row;
`CFG-064` (`TM_STILL_CC_`) added. Revalidated again same day (`77e1eb9`):
`CFG-054` updated for the Krishna Murthy departure + Shitij Kaushal
addition; `docs/INDEX.md` row bumped to match both times.
