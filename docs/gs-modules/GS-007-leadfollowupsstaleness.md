# GS-007 — LeadFollowupsStaleness.gs

| | |
|---|---|
| **Type** | `GS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `LeadFollowupsStaleness.gs` (99 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

A **one-time conditional-formatting installer** for the `Lead_Followups`
tab: it paints any row amber once its `updated_at` (column G) is more
than `LEAD_FOLLOWUPS_AMBER_HOURS_` old, and red past
`LEAD_FOLLOWUPS_RED_HOURS_`. Added 2026-09-09. It exists because the
actual surface of the lead 2229674 incident was a person opening the
sheet directly and not noticing a stale follow-up row — dashboard-side
staleness checks don't help someone in the raw sheet. This makes a stale
row impossible to miss there. No trigger — the formatting rules, once
set, are evaluated live by Sheets on every recalculation.

## Responsibilities

- `buildLeadFollowupsStalenessRuleSpecs_` — produce the amber/red
  conditional-format rule specs (formula, background, font colour).
- `setupLeadFollowupsStalenessFormatting` — apply those rules to
  `Lead_Followups!A2:H` (rows 2..`LEAD_FOLLOWUPS_STALE_ROWS_`).

## Trigger schedule

**None.** There is no time-based trigger. `setupLeadFollowupsStalenessFormatting()`
is run **once, by hand**, from the Apps Script editor; the conditional-
format rules it writes are then evaluated by Google Sheets itself,
continuously, with no script involvement.

## Requires `setupXxx()` re-run when

Re-run `setupLeadFollowupsStalenessFormatting()` when: the amber/red hour
thresholds change; the `Lead_Followups` column layout changes (the rules
are anchored to column G and a fixed row range); the row-count ceiling
(`LEAD_FOLLOWUPS_STALE_ROWS_`) needs raising; or the `Lead_Followups` tab
was deleted and recreated (a Generate cycle recreates the tab but not
the formatting).

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-216 | `buildLeadFollowupsStalenessRuleSpecs_()` `#L58` | — | an array of `{formula, background, fontColor}` specs — amber past `LEAD_FOLLOWUPS_AMBER_HOURS_`, red past `LEAD_FOLLOWUPS_RED_HOURS_`, both measured from column G | none (pure) | — | FN-217 | specific |
| FN-217 | `setupLeadFollowupsStalenessFormatting()` `#L80` | — | applies the conditional-format rules to `Lead_Followups!A2:H` | **replaces** the tab's conditional-format rules via `sheet.setConditionalFormatRules(...)`; logs | FN-216, `SpreadsheetApp` | Apps Script editor (manual, one-time) | specific |

## Config constants — `CFG-XXX` sub-table

| ID | Constant | Value | Meaning | Changing it affects |
|---|---|---|---|---|
| CFG-044 | `LEAD_FOLLOWUPS_AMBER_HOURS_` | 12 (hours) | how old column G must be before a row goes amber | the amber rule — **requires `setupLeadFollowupsStalenessFormatting()` re-run** |
| CFG-045 | `LEAD_FOLLOWUPS_RED_HOURS_` | 24 (hours) | how old before a row goes red | the red rule — requires the re-run |
| CFG-046 | `LEAD_FOLLOWUPS_STALE_ROWS_` | a fixed row-count ceiling | how many rows the rules cover | rows beyond it get no highlight — raise + re-run if `Lead_Followups` grows past it |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-070 | `Lead_Followups` tab does not exist yet | `setupLeadFollowupsStalenessFormatting` logs "run a Generate cycle first (it creates the tab), then re-run this" and returns | no formatting applied; a clear next-step message |
| EXC-071 | `setConditionalFormatRules` **replaces** all existing rules on the tab | any other manual conditional formatting on `Lead_Followups` is wiped by a run | only these staleness rules remain — expected, since this tab is script-managed |

## Data lineage

No data flows through this file. It writes *formatting metadata* to the
`Lead_Followups` tab (`SHEET-004`); Sheets then evaluates the formulas
against column G (`updated_at`, written by `pushLeadsToFollowups`,
`JS-018` / `pushUnresolvedToLeadFollowups_`, `GS-010`) at render time.

## Sheets touched

| `SHEET-XXX` | Read / Write | Which `FN-XXX` | Notes |
|---|---|---|---|
| `SHEET-004` `Lead_Followups` | Write (conditional-format rules only — **no data cells**) | FN-217 | anchored to column G / rows 2..`LEAD_FOLLOWUPS_STALE_ROWS_` |

## Failure / error behaviour

If the tab is missing it exits cleanly with a guidance log (EXC-070). It
writes only formatting, never data — it cannot corrupt a follow-up row.
A run shows as succeeded/failed in Executions like any manual function.

## Cross-runtime duplication

None. The dashboard has its own `Lead_Followups` staleness awareness
(`LEAD_FOLLOWUPS_STALENESS.md`'s consumer map, enforced in `JS-018` /
`JS-016`); this file is the **sheet-native** complement for someone
reading the raw tab — a different surface, not duplicated code.

## Not live until pasted

The file must be pasted into the Sheet's Apps Script editor, and then
`setupLeadFollowupsStalenessFormatting()` **must be run once** for the
formatting to exist. Unlike a logic-only `.gs` edit, this one does
nothing until its setup function is executed (`CLAUDE.md` — this is a
setup-required file).

## UI relationships

N/A in the dashboard. Its effect is visible only in the Google Sheet's
`Lead_Followups` tab.

## Architecture relationship

Apps Script backend. A one-time setup utility (not a scheduled
automation). `LOGIC_AUDIT.md` did not cover it (added 2026-09-09, after
the 2026-09-07 audit).

## Related documentation

`HANDOVER.md` §2; **`LEAD_FOLLOWUPS_STALENESS.md`** (the scoped
staleness reasoning this file operationalises for the sheet surface);
`CLAUDE.md` (the `Lead_Followups` change discipline).

## Relationships

- **Depends On:** `SpreadsheetApp` (Apps Script), `SHEET-004`
  (`Lead_Followups`) — no other `.gs` file
- **Used By:** `none` — a manual setup utility
- **Related:** `JS-018` / `GS-010` (write column G, which the rules
  read), `SHEET-004`

## Source of truth

`LeadFollowupsStaleness.gs` at `HEAD` (read in full).

## Validation

- **Method:** full read of the 99-line file at `c82ec67` — both
  functions, the constants, the `A2:H` / column-G anchoring, and the
  "tab missing → guidance log" path confirmed directly.
  `Tests_LeadFollowupsStaleness.gs` runs in CI (asserts the rule specs).
- **Evidence:** `LeadFollowupsStaleness.gs` source;
  `.github/workflows/test.yml` (`Tests_LeadFollowupsStaleness.gs`, last
  green run); `LEAD_FOLLOWUPS_STALENESS.md`.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-029. Added 2026-09-09
(same day as `OpsChecklistRunner.gs`); not present at the 2026-09-07
`LOGIC_AUDIT.md` audit.

## Revalidation trigger

Any commit touching `LeadFollowupsStaleness.gs` or its `Tests_` file;
`LEAD_FOLLOWUPS_AMBER_HOURS_` / `_RED_HOURS_` / `_STALE_ROWS_` change (a
value change alone does nothing until `setupLeadFollowupsStalenessFormatting()`
is re-run **and** pasted); `Lead_Followups` (`SHEET-004`) column layout
changes; `LEAD_FOLLOWUPS_STALENESS.md`'s hour thresholds change.

## Handover relationship

`HANDOVER.md` §2 names the file ("One-time conditional-formatting setup …
No trigger — applies immediately when run. See
`LEAD_FOLLOWUPS_STALENESS.md`"). Current as of 2026-09-09. A threshold
change must update `HANDOVER.md` §2 and `LEAD_FOLLOWUPS_STALENESS.md`,
and note that the setup function needs re-running.

## Lifecycle / retention

N/A — code. The formatting rules persist on the tab until a run replaces
them or the tab is deleted.

## Next action

none — Closed + Monitored.

## Closure evidence

Record committed for DOC-029; `docs/INDEX.md` `GS-007` → `Closed +
Monitored`, `Last Verified` 2026-09-10, links recorded; `CFG-044`..`046`,
`EXC-070`/`071`, and the explicit "setup-required, re-run when thresholds
change" note. No `docs/changes/` record (DOC-029).
