# GS-001 — AllIssuesEmailer.gs

| | |
|---|---|
| **Type** | `GS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `AllIssuesEmailer.gs` (561 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

An unattended daily (17:00 IST) email, per region, covering **all 5**
Operations SLA checks for Google Non-UTM / Search leads assigned in the
last 3 calendar days. It exists so a regional head gets a complete
end-of-day issue digest even if nobody opened the dashboard — the
scheduled counterpart of the Operations tab's on-demand region reports
(`TAB-003`).

## Responsibilities

- `sendAllIssuesEmails` / `sendAllIssuesEmails_` — build and send the
  per-region digests.
- `allIssuesWindowGs_` — the IST-midnight-anchored 3-calendar-day
  window (explicitly **not** rolling-hours — a documented undercount
  fix).
- `sendOneAllIssuesEmail_` — one region's email.
- `notifyChLevelIssuesGs_` — the CH-level rollup for RMs whose chain is
  blank.
- `ensureAllIssuesLogSheet_` + `AllIssues_Log` bookkeeping.
- `setupAllIssuesEmailTrigger` — install the 17:00 trigger.

## Trigger schedule

`setupAllIssuesEmailTrigger()` (`#L549`) installs `sendAllIssuesEmails`
on `atHour(17).nearMinute(0).everyDays(1).inTimezone('Asia/Kolkata')`
(`LOGIC_AUDIT.md` Part 1 §5). The `.nearMinute(0)` is load-bearing —
the function's own comment documents a real incident where, without it,
this trigger once fired **54 minutes late**.

## Requires `setupXxx()` re-run when

Only when the **schedule itself** changes — e.g. editing
`ALL_ISSUES_RUN_HOUR_` alone does nothing until
`setupAllIssuesEmailTrigger()` is re-run (the file's own comment says
so). A change to the *logic* inside `sendAllIssuesEmails_` takes effect
on the next 17:00 fire automatically (`CLAUDE.md` gotcha).

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-174 | `sendAllIssuesEmails()` / `sendAllIssuesEmails_()` `#L133/#L153` | `leads` tab, `Movement_Log` maps | one email per region | Gmail sends; `AllIssues_Log` rows | `computeSlaFlags_` (`GS-012`), `buildMovementLogMapsGs_` (`GS-008`), `resolveRecipientEmailsForRegion_` (`GS-004`), `sendOneAllIssuesEmail_` (FN-176), `withSendRetry_` (`GS-004`) | the 17:00 trigger; `sendAllIssuesEmailsNow()` (manual) | specific — scheduled |
| FN-175 | `allIssuesWindowGs_(asOf)` / `allIssuesDateRangeLabelGs_(win)` `#L85/#L95` | as-of date | `{start, end}` IST-midnight-anchored 3-calendar-day window + a label | none | `istDayKeyGs_` (`GS-002`) | FN-174 | specific — **not rolling-hours** (documented undercount fix) |
| FN-176 | `sendOneAllIssuesEmail_(ss, logSheet, region, rec, leads, dateLabel, todayKey, now, win)` `#L420` | one region's data | that region's email | Gmail send; log row | `renderOvernightReportEmailHTML_` (`GS-004`), `withSendRetry_` (`GS-004`) | FN-174 | specific |
| FN-177 | `notifyChLevelIssuesGs_(region, chLevelRms, rmToLeads, win)` `#L341` | CH-level RMs + their leads | a CH-level rollup email | Gmail send | `groupLeadsByRmAndFlatten_` (`GS-004`) | FN-174 | specific |
| FN-178 | `ensureAllIssuesLogSheet_(ss)` `#L100` | spreadsheet | ensures `AllIssues_Log` exists | may create the tab | — | FN-174 | specific |
| FN-179 | `sendAllIssuesEmailsNow()` / `setupAllIssuesEmailTrigger()` `#L522/#L549` | — | manual run / installs the trigger | Gmail sends / creates a trigger | FN-174 / `ScriptApp` | Apps Script editor, manual | specific |

## Config constants — `CFG-XXX` sub-table

| ID | Constant | Value | Meaning | Changing it affects |
|---|---|---|---|---|
| CFG-025 | `ALL_ISSUES_RUN_HOUR_` | `17` | the send hour | the trigger schedule — **requires `setupAllIssuesEmailTrigger()` re-run to take effect** |
| CFG-026 | the 3-calendar-day window | 3 days, IST-midnight-anchored | which leads are in scope | `allIssuesWindowGs_` (FN-175) |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-055 | a send fails transiently | `withSendRetry_` (`GS-004`) retries with backoff; persistent failure → `notifyLeadSendFailuresGs_` ops alert | the run continues for other regions; ops gets an alert |
| EXC-056 | `RmHierarchy.private.gs` absent → all resolved emails `''` | routing degrades to `Region_Recipients` / `CH_LEVEL_EMAIL_` fallback | email still sends, to the fallback address (`GS-011`) |
| EXC-057 | trigger fires late without `.nearMinute(0)` | mitigated by `.nearMinute(0)` in the installer | (historical) a 54-minute-late fire |

## Data lineage

`leads` tab (`SHEET-001`, via `readLeadsTab_`, `GS-004`) + `Movement_Log`
maps (`SHEET-002`, via `buildMovementLogMapsGs_`, `GS-008`) →
`computeSlaFlags_` (`GS-012`) → per-region grouping via
`mainRegionForGs_` / `resolveRecipientEmailsForRegion_` (`GS-004`) →
`renderOvernightReportEmailHTML_` (`GS-004`) → Gmail (`EXT-002`);
`AllIssues_Log` (`SHEET-013`) records each send. Full flow: `DATA-002` +
`DATA-005`.

## Sheets touched

| `SHEET-XXX` | Read / Write | Which `FN-XXX` | Notes |
|---|---|---|---|
| `SHEET-001` `leads` | Read | FN-174 (via `readLeadsTab_`) | the source data |
| `SHEET-002` `Movement_Log` | Read | FN-174 (via `buildMovementLogMapsGs_`) | for `underCalledToday` baselines |
| `SHEET-012` `Region_Recipients` | Read | FN-174 (via `resolveRecipientEmailsForRegion_`) | recipient fallback |
| `SHEET-006` `RM_Hierarchy` / `SHEET-007` `Manager_Directory` | Read | FN-174 (via `GS-011`) | routing |
| `AllIssues_Log` | Write (append) | FN-176 / FN-178 | send bookkeeping — not yet a `SHEET-XXX` (count TBD, DOC-010/032) |

## Failure / error behaviour

Per-region isolation — one region's send failing does not abort the run.
Transient failures retry via `withSendRetry_`; persistent ones raise an
ops alert. A failure shows as **Failed** in Apps Script Executions only
if it escapes all retries.

## Cross-runtime duplication

Uses `computeSlaFlags_` (`GS-012`) — the `.gs` twin of `enrichLead`
(`JS-006`). Region grouping uses `mainRegionForGs_` (`GS-004`) — twin of
`mainRegionFor` (`JS-014`). **The Loan-region `effectiveRegion` override
is missing here** — `LOGIC_AUDIT.md` Part 4 §4.4 / Part 7 §18 HIGH (this
is one of the 3 scheduled-email call sites named in that finding).

## Not live until pasted

A `.gs` edit in this repo is **not running** until pasted into the
Sheet's bound Apps Script editor and saved. If the schedule changed,
also re-run `setupAllIssuesEmailTrigger()` once (`CLAUDE.md` top gotcha).

## UI relationships

N/A — backend-only, scheduled. (The Operations tab, `TAB-003`, is the
on-demand human counterpart.)

## Architecture relationship

The Apps Script backend half (peer of `DASH-001`, sharing only
`SHEET-*`). Layer 17 (backend automation) in `LOGIC_AUDIT.md` Part 1 §1.

## Related documentation

`HANDOVER.md` §2, §4.3, §8; `OPS_CHECKLIST.md` (email routing checks);
`LOGIC_AUDIT.md` Part 1 §4d, §5, Part 4 §4.4, Part 7 §18 HIGH;
`CLAUDE.md`.

## Relationships

- **Depends On:** `GS-002` (`Core.gs`), `GS-004` (`EmailInfra.gs`),
  `GS-005` (`FollowupEngine.gs`), `GS-008` (`MovementTracker.gs` maps),
  `GS-011` (`RmHierarchy.gs`), `GS-012` (`SlaEngine.gs`), `SHEET-001`,
  `SHEET-002`, `SHEET-006`, `SHEET-007`, `SHEET-012`, `SHEET-013`,
  `EXT-002`, `DATA-002`, `DATA-004`
- **Used By:** `SHEET-013`, `DATA-005`
- **Related:** `TAB-003` (the on-demand equivalent), `GS-010`
  (`OvernightEmailer.gs` — the other scheduled emailer), `JS-014` (the
  client report builder it parallels)

## Source of truth

`AllIssuesEmailer.gs` at `HEAD`.

## Validation

- **Method:** full read at `c82ec67`; function list verified by grep;
  trigger schedule cross-checked against `LOGIC_AUDIT.md` Part 1 §5.
  `Tests_AllIssuesEmailer.gs` runs in CI (`node test/run-gs-tests.js`)
  against in-memory `SpreadsheetApp` / `GmailApp` fakes — proves the
  logic, **not** that it is live on the Sheet.
- **Evidence:** `.github/workflows/test.yml` (`Tests_AllIssuesEmailer.gs`,
  last green run); `LOGIC_AUDIT.md` Part 1 §4d/§5.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-029.

## Revalidation trigger

Any commit touching `AllIssuesEmailer.gs` or `Tests_AllIssuesEmailer.gs`;
`ALL_ISSUES_RUN_HOUR_` or the trigger schedule changes (also needs the
setup re-run); the 3-calendar-day window logic changes; `computeSlaFlags_`
(`GS-012`) changes; the Loan-region HIGH finding is addressed here.

## Handover relationship

`HANDOVER.md` §2 names the file ("17:00 IST daily email covering all 5
Operations SLA checks"); §8 has the `.nearMinute(0)` incident. Current
as of 2026-09-09. A schedule or scope change must update `HANDOVER.md` §2
and run `OPS_CHECKLIST.md`'s email items.

## Lifecycle / retention

N/A — code. `AllIssues_Log` retention: `TBD` (DOC-036).

## Next action

The Loan-region HIGH finding (missing `effectiveRegion` override at this
call site) is a known unresolved gap — tracked via the revalidation
trigger, not this record's to fix.

## Closure evidence

Record committed for DOC-029; `docs/INDEX.md` `GS-001` → `Closed +
Monitored`, `Last Verified` 2026-09-10, links + trigger schedule
recorded. No `docs/changes/` record (DOC-029).
