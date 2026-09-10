# JS-014 — reports-build.js

| | |
|---|---|
| **Type** | `JS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `js/reports-build.js` (1283 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

Pure computation of region-email report content: region normalisation,
the per-issue report builder, the combined "all issues" builder, and the
shared HTML email template. **No DOM writes, no network calls** — it
takes `issueLeads` / `leads` and returns report objects. It exists so
the on-demand dashboard reports and the unattended `OvernightEmailer.gs`
/ `AllIssuesEmailer.gs` produce the *same* per-region content, and so
that content can be unit-tested without a browser or a send. It also
owns `REGION_GROUP_MAP` and `effectiveRegion` — the client's region
vocabulary.

## Responsibilities

- `REGION_GROUP_MAP` (11 main regions) + `mainRegionFor` /
  `normRegionKey` / `regionsAreSimilar` — region normalisation.
- `effectiveRegion(l)` — override raw `region` with `project_region` /
  `group_source` when either says "Loan".
- `buildRegionReports` / `buildRegionWiseReports` / `buildAllRegionReports`
  — the report builders.
- `renderReportEmailHTML` — the shared HTML email template.
- `reportableIssueFor` — the generation-time issue re-check (a no-op
  after a real bug fix).

## Load order / position

First of the 3 reports files (`reports-build` → `reports-gmail` →
`reports-ui`).

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-094 | `effectiveRegion(l)` `#L80` | a lead | the region to use — `project_region` / `group_source` win when either says "Loan" (Loan leads aren't reliably geographic) | none | `normRegionKey` (FN-095), `mainRegionFor` (FN-096) | `core-filters.js` (`JS-004`), `tab-tracking.js`, `tab-rmtimeline.js`, report builders | reusable — **the client Loan override missing from the 3 scheduled emails** (`LOGIC_AUDIT.md` Part 4 §4.4 / Part 7 §18 HIGH) |
| FN-095 | `normRegionKey(s)` `#L65` | a raw region string | lowercased, `[\s\-_]+`→one space | none | — | FN-094, FN-096, `repeatOffendersRegionKey` (`JS-008`) | reusable |
| FN-096 | `mainRegionFor(rawRegion)` `#L91` | a raw region | one of the 11 `REGION_GROUP_MAP` main regions (HNI / HNI-SoBo fold into SoBo) | none | `normRegionKey` (FN-095) | filters, tracking, repeat offenders, reports | reusable |
| FN-097 | `buildRegionReports(issueKey)` `#L410` | an SLA issue key | `[{region, subject, body, html, leads}]` per region | none (pure) | `renderReportEmailHTML` (FN-100), `reportableIssueFor` (FN-099), `suggestedFollowUp` (`JS-007`), `dedupeToFamilies` (`JS-002`) | `reports-ui.js` (`JS-016`), `tab-movement.js` (`JS-021`) | reusable |
| FN-098 | `buildRegionWiseReports(combineAll, followupLookup)` / `buildAllRegionReports()` `#L726/#L1264` | flags / a follow-up lookup | the region-wise / all-issues combined reports | none | FN-097, `groupItemsByReportRegion` (FN-101) | `JS-016` | reusable |
| FN-099 | `reportableIssueFor(l)` `#L653` | a lead | its reportable issue key, or none | none | `enrichLead` output | FN-097 | specific — a blanket grace re-check that used to silently re-suppress `isNotUpdated` / `inactiveRmNewLead` was **removed as a no-op** (a real historical bug fix) |
| FN-100 | `renderReportEmailHTML(opts)` `#L344` | report options | the HTML email string | none | `esc` (`JS-010`), `attemptsTodayCell`, `istDayLabel` | FN-097, FN-098 | reusable — shared template |
| FN-101 | `groupItemsByReportRegion(items)` / `expandCopySplits(item)` `#L150/#L140` | a lead list | per-report-region groups; copies expanded | none | `effectiveRegion` (FN-094) | FN-097, FN-098 | reusable |
| FN-102 | `reportDateRange(includedLeads)` / `reportScopeNotice()` / `subjectScopeSuffix()` `#L678/#L178/#L325` | included leads / filter state | date-range text / a scope banner / a subject suffix | none | — | FN-097, FN-098 | reusable |

## Business rules implemented — `RULE-XXX` sub-table

| ID | Rule | Where | Duplicated in (`GS-XXX`)? | Notes |
|---|---|---|---|---|
| RULE-017 | Region normalisation: 11 main regions, `[\s\-_]+`-collapsed keys, HNI folds into SoBo | `REGION_GROUP_MAP` + FN-095/FN-096 | **Yes — `REGION_GROUP_MAP_` (`EmailInfra.gs`)** (`GS-004`). Full diff: `LOGIC_AUDIT.md` Part 4 §4.3 (consistent) | — |
| RULE-018 | Loan override: a lead whose `project_region` or `group_source` says "Loan" reports as region "Loan", not its geographic region | FN-094 | **NO — silently missing from all 3 scheduled-email call sites** (`LOGIC_AUDIT.md` Part 4 §4.4 / Part 7 §18 **HIGH**). The Movement_Log-only reduced override is consistent (Part 4 §4.5) | the one confirmed live production-affecting gap |
| RULE-019 | Possible-Premature-Closes: a closed lead whose latest family comment still reads "engaged" is flagged | FN-097/FN-098 | No scheduled-email equivalent (`LOGIC_AUDIT.md` Part 7 §18 LOW #1) | — |
| RULE-020 | The "Highlights" block is deterministic and rule-based — "no AI involved" | FN-100 | conceptually mirrored in the `.gs` email templates | `LOGIC_AUDIT.md` Part 3 §3.9 |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-025 | a lead with no resolvable region | `mainRegionFor` returns a fallback bucket ("Unassigned") | the lead appears in an "Unassigned" report section, not dropped |

## Data lineage

`issueLeads` / `leads` (state, from `JS-004`) → `reportableIssueFor`
(FN-099) filters → `groupItemsByReportRegion` (FN-101) via
`effectiveRegion` (FN-094) → `buildRegionReports` (FN-097) →
`renderReportEmailHTML` (FN-100) → report objects (`window._regionReports`
/ `_allReports`) → consumed by `JS-016` (render/mailto) and `JS-015`
(Gmail send). Full flow: `DATA-005` (region-email pipeline).

## Data sources accessed

Reads `issueLeads` / `leads` / `filterState` (state). Borrows
`currentStalledRowsByRegion` / `dedupeToFamilies` from `JS-021` / `JS-002`.
No `SHEET-XXX`, no network.

## Data written / modified

Nothing — pure. Writes only the in-memory `window._regionReports` /
`_allReports` objects other modules read.

## Failure / error behaviour

Cannot fail on I/O (there is none). A malformed lead just lands in a
fallback region bucket. No throw paths.

## Cross-runtime duplication

`REGION_GROUP_MAP` ↔ `REGION_GROUP_MAP_` (`GS-004`) — audited consistent
(`LOGIC_AUDIT.md` Part 4 §4.3). The **`effectiveRegion` Loan override
has no working `.gs` twin** — the HIGH finding. The report *content*
rules are mirrored in the `.gs` email builders (`GS-010` / `GS-001`).

## UI relationships

No DOM. Its output feeds `#generateBtn` / `#generateAllReportsBtn`
(`BTN-002` / `BTN-003`, `TAB-003`) and the Overnight cycle (`TAB-007`).

## Architecture relationship

`DASH-001`. Layer 13 (Report content computation) in `LOGIC_AUDIT.md`
Part 1 §1.

## Related documentation

`HANDOVER.md` §3 step 4, §6; `LOGIC_AUDIT.md` Part 1 §4c, Part 3 §3.5
(region normalisation), §3.9 (region-email rules), Part 4 §4.3/§4.4/§4.5,
Part 7 §18 HIGH.

## Relationships

- **Depends On:** `JS-005` (`CONFIG`, `IST_MONTHS`), `JS-006`
  (`enrichLead` output), `JS-007` (`suggestedFollowUp`), `JS-002`
  (`dedupeToFamilies`), `JS-010` (`esc`), `JS-021`
  (`currentStalledRowsByRegion`), `JS-004` (state)
- **Used By:** `JS-016` (`renderReports` / mailto), `JS-015`
  (`window._regionReports`), `JS-021` (Overnight cycle), `TAB-003`,
  `TAB-007`; `mainRegionFor` / `effectiveRegion` also used by `JS-008`,
  `JS-024`, `JS-023`
- **Related:** `GS-004` (`REGION_GROUP_MAP_` twin), `GS-010` / `GS-001`
  (the unattended report builders)

## Source of truth

`js/reports-build.js` at `HEAD`.

## Validation

- **Method:** full read at `c82ec67`; function + `REGION_GROUP_MAP`
  locations verified by grep; cross-check `LOGIC_AUDIT.md` Part 3 §3.5
  + Part 4 §4.3/§4.4/§4.5 (the region-map diff and the HIGH Loan
  finding). `tests/frontend-harness.html` runs `buildRegionReports` /
  `buildAllRegionReports` on synthetic leads and checks region grouping.
- **Evidence:** `LOGIC_AUDIT.md` Part 4 §4.3–§4.5; `tests/frontend-harness.html`.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-028.

## Revalidation trigger

Any commit touching `js/reports-build.js`; `REGION_GROUP_MAP` changes
(check the `REGION_GROUP_MAP_` twin — `LOGIC_AUDIT.md` Part 4 §4.3); the
`effectiveRegion` Loan override changes (and whether it gets ported to
the `.gs` side — the HIGH finding); the email HTML template changes; a
new report builder is added.

## Handover relationship

`HANDOVER.md` §3 step 4 covers report generation; §6 lists the region-map
duplication pair. Current as of 2026-09-09. A region-map change or a fix
to the Loan-override HIGH finding must update `HANDOVER.md` §6 and the
`.gs` side in the same commit, and run `OPS_CHECKLIST.md`'s email items.

## Lifecycle / retention

N/A — code. Report objects are in-memory, rebuilt each Generate.

## Next action

Track the HIGH Loan-override finding (`RULE-018`) — a known unresolved
gap, not this record's to fix, but its revalidation trigger names it.

## Closure evidence

Record committed for DOC-028; `docs/INDEX.md` `JS-014` → `Closed +
Monitored`, `Last Verified` 2026-09-10, links filled; `RULE-017`..`020`,
`EXC-025` recorded. The HIGH Loan finding is recorded as a known gap,
not a blocker to closure (it is a `GS-*`-side omission). No `docs/changes/`
record (DOC-028).
