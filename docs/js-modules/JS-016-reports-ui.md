# JS-016 — reports-ui.js

| | |
|---|---|
| **Type** | `JS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `js/reports-ui.js` (609 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

The report UI half: the per-region recipient (To/Cc) chip-input editor
(`localStorage`-persisted), the `mailto:` send flow, the render/copy/
download controls, and — most importantly — the `#generateBtn` **3-phase
Generate cycle**: preliminary build → push qualifying leads to
`Lead_Followups` → wait for human review → rebuild for real. It exists
so a human reviews the algorithmic follow-up suggestions before a region
email goes out, and it never sends unreviewed text unlabelled — a
cancelled wait falls back to the preliminary report with an explicit
"UNREVIEWED" banner. Loads **last** of the 3 reports files.

## Responsibilities

- Recipient chip UI: `renderRegionRecipientsTable`, `addRegionRecipientEmails`,
  `removeRegionRecipientEmail`, `loadRegionRecipients` /
  `saveRegionRecipients` (`localStorage`).
- `renderReports()` — the 3-phase Generate cycle.
- `renderAllRegionReports()` — the all-region variant.
- `recipientsForReport` / `openMailto` / `sendReport` — the mailto path.
- `copyRegionReport` / `copyAllReport` / `downloadAllReports` /
  `toggleReportPreview` — the copy/download/preview controls.

## Load order / position

**Last** of the 3 reports files (`reports-build` → `reports-gmail` →
**reports-ui**) — see its own header comment.

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-111 | `renderReports()` `#L387` | selected region + `issueLeads` | the generated region report(s), previewed | 3 phases: preliminary `buildRegionReports` → `clearLeadFollowupsTab` + `pushLeadsToFollowups` → `waitForAllFollowups` → rebuild; falls back to preliminary + "UNREVIEWED" banner if the wait is cancelled | `buildRegionReports` / `buildRegionWiseReports` (`JS-014`), `tryClaimGenerateCycle` / `clearLeadFollowupsTab` / `pushLeadsToFollowups` / `waitForAllFollowups` (`JS-018`), `renderMorningBrief` (`JS-020`) | `#generateBtn` (`BTN-002`) | specific — the Generate cycle |
| FN-112 | `renderAllRegionReports()` `#L511` | all regions | every region's report | same 3-phase cycle across regions | FN-111's callees, `buildAllRegionReports` (`JS-014`) | `#generateAllReportsBtn` (`BTN-003`) | specific |
| FN-113 | `recipientsForReport(report)` `#L228` | a report | `{to, cc}` resolved from the per-region store | reads `localStorage`; **applies `TEST_MODE_OVERRIDE_EMAIL` if set** | `loadRegionRecipients` (FN-115) | `sendReport` (FN-114), `sendReportViaGmail` (`JS-015`) | reusable — **footgun**: `TEST_MODE_OVERRIDE_EMAIL` (`#L212`, currently `''`) silently redirects **every** resolved recipient if set from the console, no UI indicator (`LOGIC_AUDIT.md` Part 1 §4c, flagged Part 6/7) |
| FN-114 | `sendReport(report)` / `sendRegionReport(idx)` / `sendAllReport(i)` `#L285/#L294/#L298` | a report / index | opens a `mailto:` | `openMailto` builds the URL; `flagMissingRegionRecipients` warns | `recipientsForReport` (FN-113), `openMailto` (FN-116) | mailto buttons in report HTML | specific |
| FN-115 | recipient store: `loadRegionRecipients` / `saveRegionRecipients` / `setRegionRecipientField` / `addRegionRecipientEmails` / `removeRegionRecipientEmail` / `clearRegionRecipientField` `#L49`–`#L133` | region, field, email(s) | mutates the `localStorage`-backed store | `localStorage` read/write; DOM chip refresh | `splitEmails`, `refreshRecipientCell` | the chip UI, FN-113 | reusable |
| FN-116 | `openMailto(subject, body, to, cc)` / `flagMissingRegionRecipients(regions)` `#L250/#L263` | content + recipients | a `mailto:` navigation / a warning banner | `window.location` set; DOM warn | — | FN-114 | reusable |
| FN-117 | `renderRegionRecipientsTable()` / `initRegionRecipientsPanel()` / `initEmailChipHandlers(container)` `#L171/#L191/#L133` | — | the recipient editor table + its handlers | DOM writes / listeners | FN-115 | `#regionRecipientsToggle` (`BTN-005`), bootstrap | specific |
| FN-118 | `copyRegionReport(idx)` / `copyAllReport(i)` / `copyGenericReport(...)` / `downloadAllReports()` / `toggleReportPreview(i)` / `syncReportControls()` `#L337`–`#L589` | index / — | clipboard copy / a bundle download / preview toggle / control sync | clipboard / download / DOM | `csvEscape` etc. | copy/download/preview buttons (`BTN-004` etc.) | reusable |

## Config constants — `CFG-XXX` sub-table

| ID | Constant | Value | Meaning | Changing it affects |
|---|---|---|---|---|
| CFG-024 | `TEST_MODE_OVERRIDE_EMAIL` `#L212` | `''` (unset) | if set, **every** resolved recipient (any report, incl. bulk) is redirected to this one address, silently, no UI indicator | `recipientsForReport` (FN-113) — a live footgun; backend twin `TEST_MODE_OVERRIDE_EMAIL_` (`GS-004`) |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-029 | the human-review wait is cancelled (`#followupsWaitCancelBtn`, `BTN-009`) | falls back to the algorithmic preliminary report | report shows with an explicit **"UNREVIEWED"** banner — never sends unlabelled text |
| EXC-030 | another Generate cycle holds `_generateCycleOwner` | `tryClaimGenerateCycle` fails; this cycle is refused | "cycle in progress" message; no `Lead_Followups` clobber |
| EXC-031 | a region has no recipients configured | `flagMissingRegionRecipients` warns before send | a visible warning; `mailto:` still opens with empty To |

## Data lineage

`issueLeads` (state) → `buildRegionReports` (`JS-014`) preliminary →
qualifying leads pushed to `Lead_Followups` (`SHEET-004`, via `JS-018`)
→ human edits col F in the sheet → `waitForAllFollowups` polls →
`buildRegionReports` rebuild with the reviewed text → report objects
(`window._regionReports` / `_allReports`) → preview / mailto / Gmail
send (`JS-015`). Full flow: `DATA-003` + `DATA-005`.

## Data sources accessed

Reads `issueLeads` / `filterState` (state), `window._regionReports` /
`_allReports`, `localStorage` (recipients). Polls `Lead_Followups`
(`SHEET-004`) via `waitForAllFollowups` (`JS-018`).

## Data written / modified

Via `JS-018`: clears + pushes `Lead_Followups` (`SHEET-004`) during the
cycle. `localStorage` recipient store. No direct Sheet write of its own.

## Failure / error behaviour

The cycle degrades gracefully — a cancelled or timed-out wait produces
the labelled fallback report (EXC-029); a contended mutex refuses the
cycle (EXC-030). `_allReports` is a **bare cross-file `let`** (declared
`reports-build.js:1262`, read/written here and in `JS-015`) — works only
because all three files share one global scope; more fragile than the
`window._regionReports` pattern (`LOGIC_AUDIT.md` Part 1 §4c / §6).

## Cross-runtime duplication

The 3-phase review cycle has a backend counterpart in
`OvernightEmailer.gs`'s `pushUnresolvedToLeadFollowups_` /
`waitForFollowupSuggestions_` (`GS-010`) — both write into the same
`Lead_Followups` bridge; the unguarded overlap window between the two
runtimes is `LOGIC_AUDIT.md` Part 7 §18 MEDIUM #3.

## UI relationships

`#generateBtn` (`BTN-002`), `#generateAllReportsBtn` (`BTN-003`),
`#downloadAllReportsBtn` (`BTN-004`), `#regionRecipientsToggle`
(`BTN-005`), `#followupsWaitCancelBtn` (`BTN-009`), the recipient chip
editor (`UI-004`) — all on `TAB-003`.

## Architecture relationship

`DASH-001`. Layer 14 (Report UI / send orchestration) in `LOGIC_AUDIT.md`
Part 1 §1.

## Related documentation

`HANDOVER.md` §3 step 4; `LEAD_FOLLOWUPS_STALENESS.md`; `LOGIC_AUDIT.md`
Part 1 §4c, Part 3 §3.8/§3.9, Part 7 §18 MEDIUM #3.

## Relationships

- **Depends On:** `JS-014` (`buildRegionReports` etc.), `JS-015`
  (`initGmailUI`), `JS-018` (`tryClaimGenerateCycle` /
  `clearLeadFollowupsTab` / `pushLeadsToFollowups` /
  `waitForAllFollowups`), `JS-020` (`renderMorningBrief` at
  checkpoints), `SHEET-004`
- **Used By:** `TAB-003`, `TAB-007`, `JS-015` (`recipientsForReport`),
  `JS-018`, `JS-021` (Overnight cycle reuses the same `JS-018` writeback
  functions, not this module directly), `EXT-002`, `DATA-003`
- **Related:** `GS-010` (`OvernightEmailer.gs` — the unattended
  counterpart of the review cycle)

## Source of truth

`js/reports-ui.js` at `HEAD`.

## Validation

- **Method:** full read at `c82ec67`; function list verified by grep;
  `TEST_MODE_OVERRIDE_EMAIL` confirmed at `#L212` (value `''`);
  cross-check `LOGIC_AUDIT.md` Part 3 §3.8/§3.9 + Part 1 §4c.
  `tests/frontend-harness.html` runs `renderReports` with mocked
  `Lead_Followups` I/O and a mocked wait, and verifies the "UNREVIEWED"
  fallback path.
- **Evidence:** `LOGIC_AUDIT.md` Part 3 §3.8; `tests/frontend-harness.html`.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-028.

## Revalidation trigger

Any commit touching `js/reports-ui.js`; the 3-phase Generate cycle
changes; `TEST_MODE_OVERRIDE_EMAIL` is used differently or removed; the
recipient `localStorage` schema changes; `waitForAllFollowups` /
`tryClaimGenerateCycle` (`JS-018`) signatures change; `_allReports` is
promoted to `window.` (a consistency fix).

## Handover relationship

`HANDOVER.md` §3 step 4 covers the on-demand report flow; current as of
2026-09-09. A change to the review-cycle contract must update
`HANDOVER.md` §3 and `LEAD_FOLLOWUPS_STALENESS.md`'s consumer map in the
same commit (`CLAUDE.md` gotcha).

## Lifecycle / retention

N/A — code. `localStorage` recipients are per-browser. `Lead_Followups`
retention/staleness: `SHEET-004` + `LEAD_FOLLOWUPS_STALENESS.md`.

## Next action

none — Closed + Monitored. (`_allReports` → `window._allReports` is a
noted consistency improvement, not a defect — tracked via the
revalidation trigger.)

## Closure evidence

Record committed for DOC-028; `docs/INDEX.md` `JS-016` → `Closed +
Monitored`, `Last Verified` 2026-09-10, links filled; `CFG-024`,
`EXC-029`..`031` recorded. No `docs/changes/` record (DOC-028).
