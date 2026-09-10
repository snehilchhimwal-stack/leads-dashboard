# GS-005 — FollowupEngine.gs

| | |
|---|---|
| **Type** | `GS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `FollowupEngine.gs` (739 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

The backend's comment-classification keyword engine and Suggested-Follow-up
generator — ported from the client's outcome engine
(`js/core-outcome-engine.js`, `JS-007`) so the scheduled emails and
loggers interpret an RM's free-text comment the same way the dashboard
does. `OUTCOME_RULES_GS_` is the `.gs` mirror of `OUTCOME_RULES`. It
exists because Apps Script cannot `import` the browser file, and a
scheduled email that classified "cust busy" differently from the
dashboard would confuse everyone reading both.

## Responsibilities

- `inferOutcomeGs_` + `OUTCOME_RULES_GS_` — the classifier (~30 rules).
- The typo-tolerant matcher (`_editDistanceGs_`, `_typoBudgetGs_`,
  `_wordsMatchGs_`, `_signalMatchesGs_`) — mirrors the client matcher.
- `overnightFollowupHintGs_` / `noCommentFollowUpGs_` /
  `unmatchedFollowUpGs_` — follow-up text generation +
  `FOLLOWUP_SUGGESTIONS_GS_`.
- `latestOutcomeGs_` / `detectFollowupModifiersGs_` — latest-outcome +
  modifier detection.
- Comment-timestamp parsing helpers (`parseDatedCommentEntries_`,
  `latestCommentTimestamp_`, `countTodayCommentEntries_`).

## Trigger schedule

None — called only from other `.gs` files.

## Requires `setupXxx()` re-run when

Never — no `setupXxx()`, no schedule. A rule change takes effect on the
next trigger fire of whatever calls it (`GS-010` / `GS-001` / `GS-013` /
`GS-006`).

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-205 | `inferOutcomeGs_(comment)` `#L403` | a comment string | an outcome label | none | `_signalMatchesGs_` (FN-207), walks `OUTCOME_RULES_GS_` | `latestOutcomeGs_` (FN-209), `GS-013`, `GS-006`, `GS-010`, `GS-001` | reusable — **twin of `inferOutcome` (`JS-007`)** |
| FN-206 | `_editDistanceGs_(a,b)` / `_typoBudgetGs_(targetLen)` / `_wordsMatchGs_(word, target)` `#L77/#L100/#L105` | strings / a length | edit distance / budget (0 for ≤4, 1 for ≤8, 2 above) / a match bool | none | — | FN-207 | reusable — mirrors the client typo matcher |
| FN-207 | `_signalMatchesGs_(commentWords, signal)` / `_anySignalGs_(commentWords, signals)` / `_signalWordsOfGs_(signal)` / `_wordsOfGs_(text)` `#L120/#L132/#L115/#L111` | tokenised comment + signal(s) | bool | none | FN-206 | FN-205 | reusable |
| FN-208 | `overnightFollowupHintGs_(row, colIndex, now, baselineEntry)` / `noCommentFollowUpGs_(row, colIndex, now, baselineEntry)` / `unmatchedFollowUpGs_(comment, loggedBy)` `#L635/#L658/#L454` | a lead row / a comment | follow-up text (from `FOLLOWUP_SUGGESTIONS_GS_` or a fallback) | none | `latestOutcomeGs_` (FN-209) | `GS-010`, `GS-001` | reusable — **twins of `suggestedFollowUp` / `noCommentFollowUp` / `unmatchedFollowUp` (`JS-007`)** |
| FN-209 | `latestOutcomeGs_(row, colIndex)` / `detectFollowupModifiersGs_(comment, primaryOutcome)` `#L693/#L557` | a lead row / a comment | latest outcome / detected modifiers | none | FN-205, `combinedCommentsTextGs_` (FN-211) | `GS-013`, `GS-006`, `GS-010` | reusable |
| FN-210 | `parseDatedCommentEntries_(internalComments, stageComments)` / `latestCommentTimestamp_(...)` / `countTodayCommentEntries_(..., now)` `#L47/#L62/#L68` | comment fields | dated entries / latest timestamp / today's count | none | — | `computeSlaFlags_` (`GS-012`), FN-209 | reusable — shared with `SlaEngine.gs` |
| FN-211 | `combinedCommentsTextGs_(row, colIndex)` / `overnightStatusLabelGs_(stage)` `#L580/#L590` | a row / a stage | joined comment text / a status label | none | — | FN-205, FN-209, `GS-010` | reusable |

## Config constants — `CFG-XXX` sub-table

| ID | Constant | Value | Meaning | Changing it affects |
|---|---|---|---|---|
| CFG-041 | `OUTCOME_RULES_GS_` `#L147`–`#L401` | ~30 ordered rules | the comment classifier | **twin `OUTCOME_RULES` (`JS-007` RULE-009, ~110 signals)**. The count gap is flagged unverified-explained in `LOGIC_AUDIT.md` Part 4 §4.1 |
| CFG-042 | `FOLLOWUP_SUGGESTIONS_GS_` | outcome → advisory text | the algorithmic follow-up fallback | **twin `FOLLOWUP_SUGGESTIONS` (`JS-007` RULE-012)** |
| CFG-043 | typo budget thresholds | 0 / 1 / 2 by length | typo tolerance | matcher behaviour; mirrors `JS-007` RULE-010 |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-066 | a comment matches no rule | `unmatchedFollowUpGs_` returns a manual-review string; `GS-013` logs it to `Unmatched_Comments_Log` | the email shows a "read the comments, log a next action" prompt; the classifier gap is surfaced for review |
| EXC-067 | typo false positive | accepted risk (mirrors the client) | rare mis-classification |

## Data lineage

Comment text (from a `leads` row, `SHEET-001`) → `inferOutcomeGs_`
(FN-205) via the typo matcher → outcome label → `overnightFollowupHintGs_`
/ `noCommentFollowUpGs_` (FN-208) → follow-up text used by the scheduled
emails and written to `Lead_Followups` col F as the algorithmic fallback
(by `GS-010`). Full flow: `DATA-003`.

## Sheets touched

| `SHEET-XXX` | Read / Write | Which `FN-XXX` | Notes |
|---|---|---|---|
| — | — | — | `FollowupEngine.gs` reads comment *strings* passed in by callers; it touches no sheet directly |

## Failure / error behaviour

Pure classification — an unmatched comment routes to the manual-review
string, never an error. No throw paths of its own.

## Cross-runtime duplication

**The single largest duplicated-logic surface with the client.**
`OUTCOME_RULES_GS_` ↔ `OUTCOME_RULES` (`JS-007`); `FOLLOWUP_SUGGESTIONS_GS_`
↔ `FOLLOWUP_SUGGESTIONS` (`JS-007`); the typo matcher is re-implemented.
The ~30-vs-~110 rule-count gap needs a maintainer determination (does the
backend implement genuinely fewer outcomes, or are the counts not
measuring the same thing) — `LOGIC_AUDIT.md` Part 4 §4.1. Every rule
change must be made on both sides (`HANDOVER.md` §6).

## Not live until pasted

Not running until pasted into the Sheet's Apps Script editor. No
`setupXxx()` re-run needed (no trigger).

## UI relationships

N/A — backend.

## Architecture relationship

Apps Script backend. Layer 7 (backend business logic — duplicated by
necessity) in `LOGIC_AUDIT.md` Part 1 §1.

## Related documentation

`HANDOVER.md` §2, §6; `LOGIC_AUDIT.md` Part 1 §4d, Part 3 §3.2/§3.4,
Part 4 §4.1; `CLAUDE.md` (duplication gotcha); `GS-013`
(`UnmatchedCommentLogger.gs` — the classifier-gap feedback loop).

## Relationships

- **Depends On:** `GS-002` (`Core.gs`) — the only dependency
- **Used By:** `GS-001` (`AllIssuesEmailer.gs`), `GS-006`
  (`InteractionHistoryLogger.gs`), `GS-010` (`OvernightEmailer.gs`),
  `GS-012` (`SlaEngine.gs` — `latestCommentTimestamp_`,
  `countTodayCommentEntries_`), `GS-013` (`UnmatchedCommentLogger.gs`),
  `SHEET-010`, `DATA-003`
- **Related:** `JS-007` (`core-outcome-engine.js` — the client twin)

## Source of truth

`FollowupEngine.gs` at `HEAD`.

## Validation

- **Method:** full read at `c82ec67`; function + `OUTCOME_RULES_GS_`
  location verified by grep; cross-check `LOGIC_AUDIT.md` Part 3 §3.2 +
  Part 4 §4.1 (the full rule diff). `Tests_FollowupEngine.gs` runs in
  CI.
- **Evidence:** `.github/workflows/test.yml` (`Tests_FollowupEngine.gs`,
  last green run); `LOGIC_AUDIT.md` Part 4 §4.1.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-029.

## Revalidation trigger

Any commit touching `FollowupEngine.gs` or `Tests_FollowupEngine.gs`;
**`OUTCOME_RULES_GS_` gains or changes a rule** (requires the
`OUTCOME_RULES` twin in `JS-007` to change — `HANDOVER.md` §6);
`FOLLOWUP_SUGGESTIONS_GS_` text changes; the typo-budget thresholds
change.

## Handover relationship

`HANDOVER.md` §2 names the file ("Comment classification + Suggested
Follow-up text, ported from `js/core.js`'s `OUTCOME_RULES`/`inferOutcome`");
§6 lists it as the anchor of the comment-classification duplication pair.
Current as of 2026-09-09. A rule change must update `HANDOVER.md` §6 and
`js/core-outcome-engine.js` in the **same commit**, and run
`OPS_CHECKLIST.md`'s pre/post items.

## Lifecycle / retention

N/A — code.

## Next action

Resolve the ~30-vs-~110 rule-count gap (`LOGIC_AUDIT.md` Part 4 §4.1) —
a maintainer determination, tracked via the revalidation trigger, not
this record's to make.

## Closure evidence

Record committed for DOC-029; `docs/INDEX.md` `GS-005` → `Closed +
Monitored`, `Last Verified` 2026-09-10, links recorded; `CFG-041`..`043`
(the backend half of the comment-classification pairs), `EXC-066`/`067`
recorded. No `docs/changes/` record (DOC-029).
