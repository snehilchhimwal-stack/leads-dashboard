# SHEET-022 - Daily_Report

| | |
|---|---|
| **Type** | `SHEET-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | Google Sheet, tab `Daily_Report` |
| **Owner** | Snehil |
| **Component Status** | Active (created by the first 16:30 report after `GS-016` is pasted) |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-10-09 against commit `bc39815` - created (Email Ops EO-10 / EO-8b) |

## Purpose / reason to exist

One row per IST day holding the numbers behind the 16:30 cycle report (`GS-016`), so the daily result can be tracked over time without opening each
email: how many emails were planned and accepted, how many failed / were unconfirmed / blocked / left unfinished, the leads sent and left out, bounces and
replies, incidents, whether the day was all clear, and how fresh the Leads tab looked. It stores counts (numerators); the rates with their denominators are in
the email.

## Data stored

One row per report day: `report_day`, `sent_at`, `window_start`, `window_end`, `planned`, `accepted`, `skipped`, `failed`, `unconfirmed`, `blocked`,
`unfinished`, `leads_sent`, `bounced`, `replied`, `leads_left_out`, `regions_skipped`, `incidents`, `serious_incidents`, `all_clear` (`yes`/`no`),
`leads_freshness` (`GREEN`/`AMBER`/`RED`/`UNKNOWN`/`not checked`), `leads_age_hours`.

## Source of the data

`GS-016` `cycleReportRecordDailyGs_`, after the report email was sent. A forced re-send on the same day UPDATES that day's row. Fail-open: a failure to write the row
never affects the email; a sheet with unrecognised columns is not written into; TEST MODE writes nothing.

## Destination / consumers

People. Nothing reads it automatically yet.

## Columns / fields

See "Data stored"; exact list: `CycleReport.gs` `CYCLE_REPORT_DAILY_HEADERS_`. `report_day` is text (`yyyy-MM-dd`).

## Writers

| Writer | `FN-XXX` | Mode |
|---|---|---|
| `GS-016` | `cycleReportRecordDailyGs_` (FN-405) | append, or update today's row |

## Readers

None.

## Automation / triggers touching it

Written by the 16:30 `sendEmailCycleReport` trigger (`GS-016`).

## Apps Script functions touching it

`GS-016`: `cycleReportRecordDailyGs_`.

## Data Lifecycle

- **Data Type:** historical (one row a day).
- **Retention Period:** none - about 365 small rows a year.
- **Enforced By:** None.
- **Archive / Delete Behavior:** grows by one row a day; nothing removes rows.
- **Sensitivity:** operational counts only.

## Sensitivity & operational importance (DOC-038)

- **Operational importance:** **LOW** - history only; nothing depends on it.
- **Data sensitivity:** none (counts).
- **Reason:** a tracking record of the daily result.

## Risks of changing this tab's structure

`GS-016` checks the header positionally: never reorder or rename a column by hand.

## Relationships to other tabs

Summarises `SHEET-019`, `SHEET-020` and `SHEET-021` for one day.

## Important logic / business rules

`RULE-054`, `RULE-055` in `GS-016`.

## Exceptions & error handling

A write failure is logged only (`GS-016` `EXC-129`).

## Related documentation

`docs/_planning/EMAIL_OPS_SYSTEM_AUDIT.md` (table F, "Daily performance report"); `HANDOVER.md` section 4.3.5.

## Relationships

- **Depends On:** `GS-016`, `EXT-001`
- **Used By:** `GS-016`
- **Related:** `SHEET-019`, `SHEET-020`, `SHEET-021`

## Source of truth

The live tab; header authored in `CycleReport.gs` (`CYCLE_REPORT_DAILY_HEADERS_`).

## Validation

- **Method:** `Tests_CycleReport.gs` (the row, the same-day update, a different day, a broken sheet, test mode), mutation-proved.
- **Evidence:** `.github/workflows/test.yml`.
- **Status:** Validated 2026-10-09 (locally); live behaviour proven by the first 16:30 report.

## Version / change reference

**2026-10-09** (`bc39815`): tab created. **Not live until pasted.**

## Revalidation trigger

The header constant changes; the report's numbers change.

## Handover relationship

`HANDOVER.md` section 4.3.5.

## Lifecycle / retention

None.

## Next action

After a few days of reports, decide whether to chart it.

## Closure evidence

Record created with the feature; `docs/INDEX.md` `SHEET-022`.
