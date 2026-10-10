# SHEET-023 - Daily_Checklist

| | |
|---|---|
| **Type** | `SHEET-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | Google Sheet, tab `Daily_Checklist` |
| **Owner** | Snehil |
| **Component Status** | Active (created by the first 16:30 report after `GS-019` is pasted) |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-10-09 against commit `f475d10` - created (Email Ops EO-6) |

## Purpose / reason to exist

The daily checklist A to K (`GS-019`) as it stood when each day's 16:30 report was sent: eleven rows a day, one per stage, each with its flag (GREEN / AMBER / RED /
GREY) and the evidence behind it. The email shows the same table; this tab keeps it so a bad stage can be found afterwards without digging through inboxes.

## Data stored

Per row: `report_day` (text, `yyyy-MM-dd`), `stage` (`A`..`K`), `check` (the stage's name), `flag`, `evidence` (cut to 500 characters), `evaluated_at`.

## Source of the data

`GS-019` `dailyChecklistRecordGs_`, after the report email was sent. A forced re-send on the same day REPLACES that day's eleven rows (a partial block is replaced whole);
a new day appends its own. Fail-open: a failure to write never affects the email; TEST MODE writes nothing.

## Destination / consumers

People. Nothing reads it automatically yet.

## Columns / fields

See "Data stored"; exact list: `DailyChecklist.gs` `DAILY_CHECKLIST_HEADERS_`.

## Writers

| Writer | `FN-XXX` | Mode |
|---|---|---|
| `GS-019` | `dailyChecklistRecordGs_` (FN-417) | replace today's block, or append |

## Readers

None.

## Automation / triggers touching it

Written by the 16:30 `sendEmailCycleReport` trigger (`GS-016`) through `GS-019`.

## Apps Script functions touching it

`GS-019`: `dailyChecklistRecordGs_`.

## Data Lifecycle

- **Data Type:** historical (eleven rows a day).
- **Retention Period:** none - about 4,000 small rows a year.
- **Enforced By:** None.
- **Archive / Delete Behavior:** grows by eleven rows a day; nothing removes rows.
- **Sensitivity:** operational flags and short evidence text (counts, job and audit names), no personal data.

## Sensitivity & operational importance (DOC-038)

- **Operational importance:** **LOW** - history only; nothing depends on it.
- **Data sensitivity:** none.
- **Reason:** a tracking record of the daily result.

## Risks of changing this tab's structure

`GS-019` finds today's block by the first column and writes the six columns positionally: never reorder or rename a column by hand, and keep each day's rows together at the bottom.

## Relationships to other tabs

Summarises `SHEET-019`, `SHEET-020` and `SHEET-021` (through the report) and sits beside `SHEET-022` (the daily counts).

## Important logic / business rules

`RULE-062`, `RULE-063` in `GS-019`.

## Exceptions & error handling

A write failure is logged only (`GS-019` `EXC-135`).

## Related documentation

`docs/_planning/EMAIL_OPS_SYSTEM_AUDIT.md` (EO-6); `docs/EMAIL_OPS_OPERATING_MANUAL.md` section 5; `HANDOVER.md` section 4.3.5.

## Relationships

- **Depends On:** `GS-019`, `EXT-001`
- **Used By:** `GS-019`
- **Related:** `SHEET-019`, `SHEET-022`

## Source of truth

The live tab; header authored in `DailyChecklist.gs` (`DAILY_CHECKLIST_HEADERS_`).

## Validation

- **Method:** `Tests_DailyChecklist.gs` (create, same-day replace, new day, a partial block, long evidence, TEST MODE, a broken tab), mutation-proved.
- **Evidence:** `.github/workflows/test.yml`.
- **Status:** Validated 2026-10-09 (locally); live behaviour proven by the first 16:30 report.

## Version / change reference

**2026-10-09** (`f475d10`): tab created. **Not live until pasted.**

## Revalidation trigger

The header constant changes; the stage list changes.

## Handover relationship

`HANDOVER.md` section 4.3.5.

## Lifecycle / retention

None.

## Next action

After a few weeks, decide whether to chart the flags per stage.

## Closure evidence

Record created with the feature; `docs/INDEX.md` `SHEET-023`.
