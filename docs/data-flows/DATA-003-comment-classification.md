# DATA-003 — The comment-classification pipeline

| | |
|---|---|
| **Type** | `DATA-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | traced path — not a file |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

How an RM's free-text comment becomes a classified outcome and a
suggested follow-up — computed on both runtimes — and how that
suggestion reaches `Lead_Followups` column F as the *algorithmic
fallback* a human overwrites. Also the loop that surfaces the
classifier's blind spots.

## Origin

The comment fields of a `leads` row (`SHEET-001`): `last_comment`,
`internal_status_comments`, `stage_comments`, and the dated action-log
lines within them.

## Transformation

1. `parseActionLog` (`JS-007` FN-044) / `parseDatedCommentEntries_`
   (`GS-005` FN-210) → dated `{at, by, comment}` entries.
2. `inferOutcome` (`JS-007` FN-042, walks `OUTCOME_RULES` ~110 signals,
   `RULE-009`) / `inferOutcomeGs_` (`GS-005` FN-205, `OUTCOME_RULES_GS_`
   ~30 rules, `CFG-041`) — via the typo-tolerant matcher
   (`RULE-010` / `GS-005` FN-206–207).
3. `suggestedFollowUp` / `noCommentFollowUp` / `unmatchedFollowUp`
   (`JS-007` FN-048/049, `FOLLOWUP_SUGGESTIONS` `RULE-012`) /
   `overnightFollowupHintGs_` / `noCommentFollowUpGs_` (`GS-005` FN-208,
   `FOLLOWUP_SUGGESTIONS_GS_` `CFG-042`).
4. **No match** → `unmatchedFollowUp*` returns a manual-review string,
   and `scanUnmatchedCommentsGs_` (`GS-013` FN-250) logs the comment for
   review.

## Stored As

- The outcome label is transient (recomputed).
- The **suggested follow-up** is written to `Lead_Followups`
  (`SHEET-004`) **column E/H by script, column F left blank** for a human
  — the algorithmic text only reaches F as the "UNREVIEWED" fallback if
  no human writes it in time (`JS-016` EXC-029 / `GS-010` EXC-081).
- Unmatched comments → `Unmatched_Comments_Log` (`SHEET-010`).

## Display

`TAB-003` Operations cards + region-report previews; `TAB-006` Audit
event lists; `TAB-005` RM Timeline day timeline; `TAB-007` Overnight
cohort. The unmatched log is reviewed directly in the Sheet.

## Ultimate consumer(s)

A human reviewing a follow-up suggestion before a region email sends;
the email recipient (who sees the reviewed-or-labelled follow-up); a
human curating `Unmatched_Comments_Log` to improve the keyword tables.

## Retention

Follow-up text: `SHEET-004` (`TBD`, effectively per Generate cycle,
`DOC-036`). Unmatched log: `SHEET-010` (**manually curated** — rows
persist until marked `reviewed`).

## What happens on update

A new comment on a lead reclassifies on the **next** `inferOutcome` pass
(browser: next render; backend: next trigger). `Comment_History`
(`SHEET-009`) also captures the genuinely-new comment (append-only,
`GS-006`).

## What happens on delete

A removed comment simply isn't classified next pass. Existing
`Lead_Followups` / `Unmatched_Comments_Log` / `Comment_History` rows are
point-in-time and remain.

## Known gaps

- **`OUTCOME_RULES` (~110) vs `OUTCOME_RULES_GS_` (~30)** — the count gap
  is flagged unverified-explained; a maintainer must determine whether
  the backend implements genuinely fewer outcomes or the counts aren't
  comparable (`LOGIC_AUDIT.md` Part 4 §4.1).
- The typo matcher has a documented false-positive class
  ("busy"/"buy"/"bus").
- Column F is a hard "no script writes it" contract (`SHEET-004`) —
  easy to violate.

## Exceptions & error handling

An unmatched comment routes to the manual-review string, never an error
(`JS-007` EXC-012 / `GS-005` EXC-066). The backend scan is
try/catch-isolated inside `snapshotOpenLeads_` (`GS-013` EXC-090).

## Architecture relationship

`DASH-001` + the Apps Script backend. `LOGIC_AUDIT.md` Part 1 §1 layers
6, 7, 17.

## Related documentation

`HANDOVER.md` §2, §6; `LEAD_FOLLOWUPS_STALENESS.md`; `OPS_CHECKLIST.md`
(unmatched-comment review); `LOGIC_AUDIT.md` Part 3 §3.2/§3.4, Part 4
§4.1.

## Relationships

- **Depends On:** `JS-006`, `JS-007`, `JS-016`, `JS-018`, `GS-002`,
  `GS-005`, `GS-006`, `GS-010`, `GS-013`, `SHEET-001`, `SHEET-004`,
  `DATA-001`
- **Used By:** `TAB-003`, `SHEET-009`, `SHEET-010`, `DATA-005` (the
  region email carries the follow-up text)
- **Related:** `DATA-005` (consumes the `Lead_Followups` output of this
  flow)

## Source of truth

`js/core-outcome-engine.js` `OUTCOME_RULES` `#L230` / `inferOutcome`
`#L569`; `FollowupEngine.gs` `OUTCOME_RULES_GS_` `#L147` / `inferOutcomeGs_`
`#L403`; `js/sheets-writeback.js` `pushLeadsToFollowups` `#L187`.

## Validation

- **Method:** traced against `LOGIC_AUDIT.md` Part 3 §3.2/§3.4 + Part 4
  §4.1 (the full rule diff) at `c82ec67`. `tests/frontend-harness.html`
  runs comments with known outcomes; `Tests_FollowupEngine.gs` /
  `Tests_UnmatchedCommentLogger.gs` cover the backend.
- **Evidence:** `LOGIC_AUDIT.md` Part 4 §4.1; `.github/workflows/test.yml`;
  `tests/frontend-harness.html`.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by `DOC-034`.

## Revalidation trigger

`OUTCOME_RULES` / `OUTCOME_RULES_GS_` or `FOLLOWUP_SUGGESTIONS` /
`_GS_` changes on either runtime; the typo-budget thresholds change; the
`Lead_Followups` column-F contract or the 3-phase review cycle changes;
`SHEET-004` / `SHEET-010` columns change.

## Handover relationship

`HANDOVER.md` §6 lists the classifier duplication; §2 covers the loggers.
Current as of 2026-09-09. A rule change must update `HANDOVER.md` §6 and
both runtimes in the same commit.

## Lifecycle / retention

Outcome transient. Follow-up text: `SHEET-004` (`TBD`, `DOC-036`).
Unmatched log: `SHEET-010` (manually curated).

## Next action

Resolve the ~30-vs-~110 rule-count gap (`LOGIC_AUDIT.md` Part 4 §4.1) —
tracked on `GS-005`.

## Closure evidence

Record committed for `DOC-034`; `docs/INDEX.md` `DATA-003` row →
`Closed + Monitored`; `Depends On` resolves entirely to existing IDs. No
`docs/changes/` record (`DOC-034`).
