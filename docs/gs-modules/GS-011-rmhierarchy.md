# GS-011 — RmHierarchy.gs

| | |
|---|---|
| **Type** | `GS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `RmHierarchy.gs` (1355 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-10-08 against commit `d897529` - `rebuildRmHierarchy` refuses to run once the nightly HR sync is applying (`GS-014`; see `## Version / change reference`) |

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
| FN-240 | `resolveRmHierarchy_()` / `loadRmHierarchyAndEmails_(ss)` `#L529/#L1017` | — | the name→chain map (+ emails if the private file is present) | reads `RM_Hierarchy` / `Manager_Directory` | `RmHierarchy.private.gs` (optional, `typeof`-guarded), `lookupEmployeeEmail_` (FN-242) | `resolveRecipientBucketsForRms_` (FN-241), the emailers | reusable |
| FN-241 | `resolveRecipientBucketsForRms_(ss, rmNames, hierarchyData)` `#L1241` | flagged RM names + the chain data | `[{primary, cc, rms}]` — one bucket per manager | reads `Region_Recipients` for a fallback | `lookupRmChain_` (FN-243), `isTopOfOrgRole_` (FN-244), `groupChLevelRmsByCh_` (`GS-004`) | `GS-001`, `GS-010` (via `GS-004`) | reusable — **the routing algorithm**: primary = nearest existing tier in `tl → tm → rh → ch`; a top-of-org person with a fully blank chain diverts to a CH-level backstop, not a normal bucket primary |
| FN-242 | `lookupEmployeeEmail_(name)` / `normPersonName_(name)` / `stripRoleSuffix_(name)` `#L509/#L486/#L1213` | a name | the email (`''` if the private file is absent) / a normalised name | none | `EMPLOYEE_EMAIL_BY_NAME_RAW_` (from the private file) | FN-240, FN-241 | reusable |
| FN-243 | `lookupRmChain_(byRmNameLower, rmName)` `#L1222` | the map + an RM name | that RM's `{tl, tm, rh, ch}` chain | none | `stripRoleSuffix_` (FN-242) | FN-241 | reusable |
| FN-244 | `isTopOfOrgRole_(role)` `#L1137` | a role string | bool — true for `TOP_OF_ORG_ROLES_` = `['cluster head', 'city lead', 'commercial head']` | none | — | FN-241 | reusable — **mirrors `RM_PERF_NON_RM_ROLES`'s top-3 (`JS-008` CFG-020)** |
| FN-245 | `rebuildRmHierarchy()` / `ensureRmHierarchySheet_(ss)` / `ensureManagerDirectorySheetInternal_(ss, forceRefresh)` / `ensureManagerDirectorySheet_(ss)` `#L588/#L549/#L943/#L1006` | — | rebuilds the sheets from `RM_HIERARCHY_RAW_` | Sheets writes | `logPostRebuildCoverageAudit_` (FN-246, since 2026-10-01 — see that row) | `setupRmHierarchy` (FN-247), manual | specific |
| FN-246 | `auditUnresolvedRms_(ss)` / `auditUnresolvedRmsNow()` / `auditManagerDirectoryEmailGaps_(ss)` / `auditManagerDirectoryEmailGapsNow()` / `listExcludedRmsNow()` / `clearAllRmHierarchyExclusionsNow()` / `logPostRebuildCoverageAudit_(ss)` `#L869/#L921/#L794/#L816/#L724/#L752/#L685` | spreadsheet | resolution-gap / email-gap reports (console + return value) | none (audits) / clears exclusions (the two `...Now` mutating ones) | FN-240 | `OpsChecklistRunner.gs` (`GS-009`), `OPS_CHECKLIST.md` manual runs, `rebuildRmHierarchy()` (FN-245, automatically, since 2026-10-01) | reusable — **`logPostRebuildCoverageAudit_` (2026-10-01) calls the first two audits above unconditionally at the end of every rebuild, each wrapped in its own try/catch so a read failure logs a note instead of making the rebuild itself look like it failed (`HANDOVER.md` §4.3.2)** |
| FN-247 | `setupRmHierarchy()` `#L1357` | — | creates `RM_Hierarchy` + `Manager_Directory` (no trigger) | Sheets writes | FN-245 | Apps Script editor; **called by `setupOvernightEmailer()`** | specific |
| FN-340 | `alwaysCcEmailsGs_()` `#L1066` / `leadershipEmailByNameGs_(nameLower)` `#L1084` | none / a (lowercase) name | the leadership Cc list — addresses resolved from the private employee table by `LEADERSHIP_NAMES_`, a name with no row SKIPPED (never a blank address) / one leader's address, or `''` | none (pure); an `ALWAYS_CC_EMAILS_` array / `LEADERSHIP_NAME_TO_EMAIL_` object override (tests) is used as is | `resolvedEmailForNameGs_` (`GS-004` FN-338) | `resolveRecipientBucketsForRms_` (the per-bucket leadership Cc + the leadership self-holding path), `resolveRecipientEmailsForRegion_` (`GS-004`, the legacy fallback's Cc), the unresolved-RM audit | reusable — **added 2026-10-07 (email audit P13 / F24)**; replaces direct reads of the two variables |

## Config constants — `CFG-XXX` sub-table

| ID | Constant | Value | Meaning | Changing it affects |
|---|---|---|---|---|
| CFG-054 | `RM_HIERARCHY_RAW_` | 230 rows, columns `['team','role','name','tl','tm','rh','ch','excluded','note','email']` — role mix as of `79ceeee`: S1 (162), A1 (22), Executive (8), BDM (8), Cluster Head (7), TM (7), S3 (5), RH (4), City Lead (4), Manager (1), Commercial Head (1), Leadership (1). **2026-09-16 (`42ebfaf`):** Akash A Ugale's own row role formalized A1 → TM (his real title, confirmed by the user — his 8 direct Central S1 reports are unaffected, their rows already carry `tl:'Akash A Ugale'` directly); moved from Yash Sharma's row's `tl` column into `tm` (matching the Pune TM pattern) so `TM_STILL_CC_` (`CFG-064` below) picks him up; added `['Thane','S1','Mamtaben S 1','Amit Upadhyay','','','Bipin More']` as a confirmed alias row for `Mamtaben Sosa` — the leads sheet drops her surname and appends a role suffix, a pattern `stripRoleSuffix_` alone doesn't catch (it only strips the suffix, not a dropped surname). **2026-09-17 (`77e1eb9`):** Krishna Murthy's row removed (left the company, same handling as Prathamesh A Pande 2026-08-31); his 4 direct reports' `tl` cleared, falling through to their already-present `ch:'Mukesh Mishra'`. Vidya Jadhav's and Bipin More's own rows (both previously blank-chain Cluster Heads) gained `ch:'Shitij Kaushal'`; a new row added for him (`['Leadership','Leadership','Shitij Kaushal','','','','']` — role corrected same day from an initial 'Commercial Head' guess to 'Leadership' per the user directly; not in `TOP_OF_ORG_ROLES_`, harmless since he's never himself a flagged RM). **2026-09-21 (`d71c492`):** Mukesh Yadav's row removed (left the company, confirmed by the user, same handling as Krishna Murthy). His 3 direct reports with a confirmed replacement manager in the fresh HR export (Zeya Shaikh, Karan Shinde, Mayuresh Chavan) had `tl` updated to `'Kumar Babu'` — their real current manager, not a blank fallback — since Kumar Babu already has his own row elsewhere in this array with other direct reports; this was a genuine staleness bug (3 rows still pointed at Mukesh Yadav after Kumar Babu had already been onboarded for his other reports). Vivek Yadav's `tl` was cleared to blank (falls through to his own already-present `rh:'Rajkumar Ombase'`) since he doesn't appear anywhere in the fresh HR export either — unconfirmed whether he also left; flagged to the user rather than guessed. The `Mamtaben S 1` alias row (added `42ebfaf`, see above) was corrected to `Mamtaben S 1 Account` — the user clarified the full leads-sheet string includes "Account", which the original entry was missing (a real routing-miss risk: a partial alias string never matches the leads sheet's actual name). **2026-10-03:** added `['Loan','BDM','Mohd Ali Abdul Gaffar','','','','Mayur Panjari']` — the user named the full current loan-BDM roster directly; 15 of 16 names already had a row, this was the one gap (distinct person from the already-present "Mohd Ali Khan" — different surname; a 16th name, "Mohammad Azar Izhar Ansari", was confirmed by the user to be a typo for the already-known "Mohammad Azaz Izhar Ansari", no new row). Zero current leads for him, same "close the gap before it causes a miss" reasoning as the Pre Sales addition. | the static org chart | every routing decision — **requires `setupRmHierarchy()` / `rebuildRmHierarchy()` re-run to reflect in the sheets** |
| CFG-055 | `TOP_OF_ORG_ROLES_` | `['cluster head', 'city lead', 'commercial head']` | roles that get the CH-level backstop, not a normal bucket primary | `isTopOfOrgRole_`; **overlaps `RM_PERF_NON_RM_ROLES` (`JS-008` CFG-020)** — the same 3 roles |
| CFG-056 | `CH_LEVEL_EMAIL_` (`GS-004` CFG-092) / `ALWAYS_CC_EMAILS_` `#L1053` | names, not addresses (since 2026-10-07, email audit P13) | where routing degrades to when a chain is blank / who is always CC'd — each address is looked up by NAME from the private employee table at run time (`chLevelEmailGs_` `GS-004` FN-338, `alwaysCcEmailsGs_` FN-340); with the private file absent the CH-level mail goes to the ops address and the leadership Cc is skipped (the hourly watchdog alerts) |
| CFG-064 | `TM_STILL_CC_` | `['ayaz bagwan', 'rahul poudel', 'akash a ugale']` (`#L1052`) | lowercased names of TMs who are also, for specific named exceptions, the direct manager of some of their own reports (not just a `tl`-level report of someone else) — `resolveRecipientBucketsForRms_` (FN-241, `#L1167`) CCs a matching TM even when they're not the resolved primary, since a person's direct manager already IS the "To" and would otherwise never see it. Renamed from `PUNE_TM_STILL_CC_` and generalized (no longer Pune-exclusive) when Akash A Ugale was added `42ebfaf` — the exception now names a mechanism, not a region | who gets CC'd on issue emails for these 3 TMs' own direct reports |
| CFG-080 | `RESTRICTED_CC_PRIMARY_NAMES_` | `['rajesh muni', 'manisha rathod']` (`#L1056`, lowercased — matches bucket keys) | added 2026-10-01 per the user directly: these two primaries' issue emails must cc ONLY Snehil Chhimwal, never `ALWAYS_CC_EMAILS_` or anything else their own chain's rh/ch/tm would otherwise pull in. `resolveRecipientBucketsForRms_` (FN-241) checks this list in its final bucket-mapping step — a HARD REPLACEMENT of `ccSet` (looked up fresh via `data.emailByManagerNameLower['snehil chhimwal']`), not a conditional skip of `ALWAYS_CC_EMAILS_` alone, so it stays correct even if either person's own row ever grows a real rh/ch later. **2026-10-03:** user asked this scope to Google Non-UTM/Search leads only — already true for free, since `resolveRecipientBucketsForRms_` has exactly two callers (`OvernightEmailer.gs`, `AllIssuesEmailer.gs`, `GS-010`/`GS-001`) and both gate every candidate lead through `passesGoogleNonUtmSearchGs_` before an RM name is ever collected; no code change needed, confirmed by auditing every `.gs` file that sends a per-RM email (`DailyRmIssueLog.gs`'s `reportRmPerformanceNow` only `Logger.log`s, sends nothing) | cc on every issue email whose resolved primary is Rajesh Muni or Manisha rathod (their Pre Sales reports' issues, `CFG-054`) |
| CFG-081 | `LOAN_TEAM_CH_NAME_` | `'mayur panjari'` (`#L1070`, lowercased) | added 2026-10-03 per the user directly: a loan-team RM's issue email must go straight to Mayur Panjari (their `ch`, `CFG-054`'s 'Loan' region rows), bypassing any `tl`/`tm`/`rh` in between, with NO cc at all. Checked against the REPORTING RM's own `chain.ch`, not the resolved primary's — `resolveRecipientBucketsForRms_` (FN-241) uses it twice: once to force `primaryName = chain.ch` instead of the normal `tl‖tm‖rh‖ch` cascade when `chain.ch` matches, and again in the final bucket-mapping step to hard-empty `ccSet` for that bucket. Same "already Google Non-UTM/Search only for free" scoping as `CFG-080` above — this file's only two real callers both gate on `passesGoogleNonUtmSearchGs_` first | primary + cc on every issue email for a loan-team RM (a loan Executive with `tl:'Zahid Shaikh'` now routes straight to Mayur Panjari instead of to Zahid Shaikh with Mayur Panjari only in cc; a loan BDM/Manager/A1 row, already resolving to `ch` as primary via the normal cascade, is unaffected in primary but now also gets the no-cc treatment) |
| CFG-093 | `LEADERSHIP_NAMES_` `#L1052` (+ the `null`-by-default overrides `ALWAYS_CC_EMAILS_` `#L1053`, `LEADERSHIP_NAME_TO_EMAIL_` `#L1071`) | `['Ashish Kukreja', 'Saurabh Mishra']`; both overrides `null` | **added 2026-10-07 (email audit P13 / F24)** — the senior leadership who are Cc'd on every issue email AND recognised by name when one of them personally holds a lead. The repo (public) holds only the names; the addresses come from `RmHierarchy.private.gs`. `null` = look them up; a test assigns an array / an object keyed lowercase |

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

- **Depends On:** `GS-002` (`Core.gs`), `GS-014` (`RmHierarchySync.gs` — `rmHierarchySyncIsActiveGs_`, read by the rebuild guard), `GS-004` (`EmailInfra.gs` —
  `withRetry_`, `passesGoogleNonUtmSearchGs_`; a file-level circular
  reference, harmless in Apps Script's single namespace), `SHEET-006`,
  `SHEET-007`, `SHEET-012`
- **Used By:** `GS-001`, `GS-004` (`EmailInfra.gs`), `GS-009`
  (`OpsChecklistRunner.gs` — the audit functions), `GS-010`,
  `GS-014` (`RmHierarchySync.gs` — reads `normPersonName_` and the tab constants), `SHEET-006`, `SHEET-007`
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

**2026-09-29** (`2af4b48`): `python3 test/refresh-rm-hierarchy.py` run against a fresh HR Live export
(`HR Live  - Sheet1 (4).csv`). Auto-applied the safe subset: 4 new joiners with a single
unambiguous manager each — Ajay Gupta / Shruti Sharma (Central, ch Sanjyota Bhosale), Disha Singh /
Pratik Singh (Thane, ch Bipin More) — and 6 new email rows to `RmHierarchy.private.gs` (not
committed). Everything else the script flagged (25 CH mismatches, 26 people not found in this
export) was left untouched — the CH mismatches are the same deliberate top-tier overrides already
documented above (Mukesh Mishra/Bangalore, Shitij Kaushal/Thane+Navi Mumbai), and "not found" needs
a human to confirm departure vs. a name/role-scope change, which this script deliberately never
guesses. +5 lines (1200L -> 1205L). `Tests_RmHierarchy.gs` unchanged (the added rows use the exact
shape existing tests already exercise; no new code path). **Deployed live and run 2026-09-30**
(~11:15 IST): `RmHierarchy.gs` applied to the Sheet's Apps Script editor as an exact diff edit,
`RmHierarchy.private.gs` got the matching 6-row insertion (verified by SHA-256 reconstruction of the
pre-edit state, since the private file carries no git history to diff against), both saved and
SHA-verified in a fresh editor tab, then `rebuildRmHierarchy()` run from the editor: "RM_Hierarchy
rebuilt: 236 people. Manager_Directory refreshed (emails preserved)."

**2026-09-30** (`d09d51e`): user-confirmed departures removed from `RM_HIERARCHY_RAW_`, same handling as
Prathamesh A Pande/Mukesh Yadav above (row removed, no downstream reassignment needed -- none had reports). Two
batches: 6 people last active in the 2026-09-21/23 HR export, gone by 2026-09-29 (Dhiraj Chhoda, Vishal Chavan,
Chandni Khatoon, Pranav Deshmukh, Darshana Javeri, Amit Dere); 8 more stale since 2026-09-21 (Purvesh Ugawekar,
Mustakim Sayyad, Akshay Kakade, Ritik Minekar, Vivek Yadav, Saurabh Pacharne, Shresth Bhuwania, Nikhil Goud) plus
"Shamakuri Goud", a partial-name duplicate row for the same Nikhil Goud (full HR name "Nikhil Shamakuri Goud",
confirmed by the user) -- 15 rows total. Checked first that none of the 15 are referenced as anyone else's
tl/tm/rh/ch, and that none currently have any leads assigned in the live `leads` tab (a lead naming a departed RM
would still route safely via the region fallback/CH backstop either way -- EmailInfra.gs -- this was just belt and
braces). Separately confirmed (not touched): "Kavya Gowda" is a pre-existing, already-tested alias of the
still-active "Kavya B R" (identical chain, `Tests_RmHierarchy.gs` already asserted this from an earlier session) --
NOT a departure, despite never matching any HR export by name; she has 51 real leads. +2 lines net (1205L -> 1207L:
-15 departure rows, but the explanatory comment block is longer than a single-line removal). `Tests_RmHierarchy.gs`
updated: the stale "Shamakuri Goud"/"Nikhil Goud" alias-identity assertions and the "Amit Dere new hire" assertion
replaced with departure-absence checks (same pattern the 2026-09-09 refresh block already established).

**2026-10-01** (`79ceeee`): investigating the `AllIssuesEmailer.gs`/`OvernightEmailer.gs` "Manager:" label bug
(a stale leads-tab `TL` column shown verbatim instead of the resolved `RM_Hierarchy` chain -- see `GS-008`'s own
changelog, not this file's business logic) surfaced a cross-reference of every current leads-tab `(RM, TL)` pair
against this table: 7 names -- Manisha rathod, Jagruti Borude, Nishant Lambe, Suresh Rajoriya, Priya Chaubey,
Shivani Pathak, Rajesh Muni -- carried 25-498 real live leads each with **no row here at all**, meaning any flagged
issue for them was resolving through the unresolved/CH-backstop path, not a named manager. Confirmed by the user
directly as a real "Pre Sales" team: Snehil Chhimwal (`City Lead`, top of its own chain, matches the
Sourabh Sareen/Rahul Gandhi pattern so `isTopOfOrgRole_` can self-alert him if he personally holds a flagged
lead -- an `RH` role would NOT have qualified, see `TOP_OF_ORG_ROLES_`'s own comment) is the reporting manager of
Rajesh Muni and Manisha rathod (`A1`, `rh:'Snehil Chhimwal'`), who in turn manage Jagruti Borude/Nishant Lambe/
Shivani Pathak and Suresh Rajoriya/Priya Chaubey respectively (`S1`, `tl:'Rajesh Muni'` or `tl:'Manisha rathod'`,
`rh:'Snehil Chhimwal'` as the fallback). All 7 already had an email row in `RmHierarchy.private.gs` from a prior
HR export (not committed; verified present, no change needed there). Same pass also added a 3rd leads-tab spelling
of Mohammad Azaz Izhar Ansari (`Mohmmad Azaz izhar ansari`, lowercase "izhar ansari") as an alias row pointing at
the same `Mayur Panjari` chain as the existing two rows (the real `Mohammad Azaz Izhar Ansari` and the earlier
alias `Mohmmad Azaz Izhar Anasair`) -- 128 leads were using this exact third spelling and resolving nowhere.
Darshana Javeri's remaining leads (one of the 2026-09-30 confirmed departures above) were explicitly NOT
re-added -- the user confirmed they've since been reassigned to someone else; the departure-removal handling
from 2026-09-30 stands as-is. +19 lines (1207L -> 1226L: 9 new rows + explanatory comments). The file header's
"11 real lead-assignment regions plus Sourcing - Pune" prose also updated to mention Pre Sales.
`Tests_RmHierarchy.gs` unchanged (same row shape existing tests already exercise; full suite re-run clean,
1215/1215). `rebuildRmHierarchy()` still needs a live re-run after deploy to pick up the 9 new rows in the
`RM_Hierarchy` sheet itself (tracked in the deploy register, not yet live as of this doc edit).

**2026-10-01** (`b5b595d`): the Pre Sales gap above sat undiscovered because `OPS_CHECKLIST.md`'s
"run `auditUnresolvedRmsNow()`/`auditManagerDirectoryEmailGapsNow()` after any RM-roster change" was a
manual-only reminder nobody separately acted on. Added `logPostRebuildCoverageAudit_(ss)` (new, `#L663`),
called unconditionally at the end of `rebuildRmHierarchy()` (FN-245) -- runs both audits (FN-246) via the
same tested `_` functions the standalone `*Now()` wrappers already call (no reimplemented logic) and logs
a `COVERAGE GAP: ...` or `Coverage check: all clear` line either way, same "always report" philosophy
`OpsChecklistRunner.gs`'s weekly email already uses. Each half independently try/caught -- the rebuild has
already finished writing the sheet by the time this runs, so a transient `leads`/`Manager_Directory` read
problem logs a note instead of making the whole rebuild throw. `Tests_RmHierarchy.gs`: 2 new assertions --
confirms it runs clean against the existing gap fixtures (`Ghost RM Nobody Knows`, `Test A1 NoMail`), and
confirms it NEVER throws even against a bare spreadsheet with neither sheet present (the specific case the
try/catch exists for) -- full suite 1217/1217. `OPS_CHECKLIST.md`'s two items annotated to note the new
automatic side-effect; `HANDOVER.md` gained a new §4.3.2 and a §8 "RM with real leads but no row at all"
entry (same commit, per this project's own architectural-change discipline).

**2026-10-01** (`c80fabc`, CC restriction): confirmed by the user directly — Rajesh Muni and Manisha rathod's
issue emails (their Pre Sales reports' SLA issues, routed to them as primary via `CFG-054`'s rows) must
cc ONLY Snehil Chhimwal, never the standing leadership cc (`ALWAYS_CC_EMAILS_`) or anything else. New
`RESTRICTED_CC_PRIMARY_NAMES_` (`CFG-080`); `resolveRecipientBucketsForRms_` (FN-241)'s final
bucket-mapping step now checks it and, when the resolved primary matches, hard-replaces `ccSet` with just
Snehil Chhimwal's looked-up email instead of the normal `ALWAYS_CC_EMAILS_` branch — see `CFG-080`'s own
entry for why this is a replacement, not a conditional skip. `Tests_RmHierarchy.gs`: 5 new assertions,
same self-contained-mock + temporary-push/splice pattern as the existing `TM_STILL_CC_` test (synthetic
names, no real employee data in the fixture itself — 'Snehil Chhimwal' is the one real name referenced,
unavoidably, since the production override hardcodes that exact lookup key) — proves a real rh that would
normally cc fine is dropped once restricted, leaving exactly one cc entry. Full suite 1225/1225 via
`run-gs-tests-headless.py`. Not live until pasted into the Sheet's Apps Script editor.

**2026-10-03** (`ca7802c`, loan-team routing): confirmed by the user directly — a loan-team RM's issue
email (Mayur Panjari's reports, `CFG-054`'s 'Loan' region rows) must go straight to Mayur Panjari as
primary, bypassing any tl/tm/rh in between (6 of them carry `tl:'Zahid Shaikh'`, the Loan team's own A1),
with NO cc at all. New `LOAN_TEAM_CH_NAME_` (`CFG-081`); `resolveRecipientBucketsForRms_` (FN-241) checks
`chain.ch` (the REPORTING rm's own chain, not the resolved primary's) before the normal `tl‖tm‖rh‖ch`
cascade, and again in the final bucket-mapping step to hard-empty `ccSet`. Confirmed with the user this is
scoped to Google Non-UTM/Search leads only — already true for free (`CFG-080`'s own 2026-10-03 note has the
full reasoning; applies identically here since both constants are checked inside the same function with
the same two real callers). Also closed the one gap in the user's full 16-name loan-BDM roster:
`RM_HIERARCHY_RAW_` (`CFG-054`) gained `Mohd Ali Abdul Gaffar` (distinct from the already-present `Mohd Ali
Khan`); a 16th name the user gave, "Mohammad Azar Izhar Ansari", was confirmed a typo for the already-known
"Mohammad Azaz Izhar Ansari" (3 existing spelling-alias rows) — no new row added for it.
`Tests_RmHierarchy.gs`: 7 new assertions — a 3-tier self-contained mock (RM → A1 → CH, mirroring the real
Zahid Shaikh → Mayur Panjari shape), `let`-reassigned (not push/splice — `LOAN_TEAM_CH_NAME_` is a single
string, not a list) so the test doesn't depend on the real `'mayur panjari'` string; proves both the
tl-bypass case AND the already-ch-primary case (a blank-tl BDM) get the no-cc treatment, not just the
bypassed one. Full suite 1232/1232 via `run-gs-tests-headless.py`. Not live until pasted into the Sheet's
Apps Script editor.

**2026-10-07** (`c416a01`, email audit P13 — `docs/_planning/EMAIL_AUDIT.md` F24): `ALWAYS_CC_EMAILS_` and `LEADERSHIP_NAME_TO_EMAIL_` were literal corporate addresses in this PUBLIC repository. They are now `null`-by-default overrides; the code keeps the leadership NAMES (`LEADERSHIP_NAMES_`, `CFG-093`) and reads the addresses through `alwaysCcEmailsGs_` / `leadershipEmailByNameGs_` (`FN-340`), which look them up from the git-ignored `RmHierarchy.private.gs` (the table this file already depends on). The three direct reads (`resolveRecipientBucketsForRms_` x2, the unresolved-RM audit) now use the accessors. A leader with no row in the private table is skipped, not blanked, and `GS-004`'s watchdog check reports it. +16 lines (1339L -> 1355L; anchors re-mapped). **Not live until pasted.**

**2026-10-08** (`d897529`): `rebuildRmHierarchy(force)` refuses to run (logs why, changes nothing) once the nightly HR-roster sync (`GS-014`) is applying changes - the LIVE tab is then the source of truth and rebuilding from `RM_HIERARCHY_RAW_` would silently undo the synced changes. `rebuildRmHierarchyForce()` overrides it on purpose. `RM_HIERARCHY_RAW_` is now only the seed. **Not live until pasted.**

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
