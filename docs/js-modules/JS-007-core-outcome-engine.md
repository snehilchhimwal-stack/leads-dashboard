# JS-007 — core-outcome-engine.js

| | |
|---|---|
| **Type** | `JS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `js/core-outcome-engine.js` (934 lines — the largest core file) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

RMs log free-text comments ("cust busy", "site visit done", "not
picking"). This module turns that text into a classified **outcome** and
a **suggested follow-up**. `OUTCOME_RULES` is an ordered ~110-signal
table; `inferOutcome` walks it with a typo-tolerant matcher and returns
the first hit. It exists so the dashboard, the Operations cards, the
Audit tab and the region emails all read the same interpretation of a
comment instead of each guessing — and so an RM's typo ("bsy", "picjed")
still classifies.

## Responsibilities

- Comment-existence checks (`combinedCommentsText`, `hasAnyCommentField`,
  `hasAnyNarrativeComment`).
- Action-log parsing (`parseActionLog`, cached).
- The typo-tolerant matcher (`_editDistance`, `_typoBudget`,
  `_wordsMatch`, `_signalMatches`).
- `OUTCOME_RULES` + `inferOutcome` (cached) — the classifier.
- `FOLLOWUP_SUGGESTIONS` + `suggestedFollowUp` / `noCommentFollowUp` /
  `unmatchedFollowUp` — follow-up text generation.
- Family-level comment collation (`latestFamilyOutcome`,
  `collateFamilyComments`, `commentsForCopy`, `sortCommentEntries`).
- IST timestamp formatters (`istStamp`, `isoStampIST`).

## Load order / position

Sixth in the real order (`… core-collation → **core-outcome-engine** →
core-fetch-and-render → …`).

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-042 | `inferOutcome(comment)` `#L569` | a comment string | an outcome label (cached in `_inferOutcomeCache`) | populates the cache | `_inferOutcomeUncached` (FN-043) | `enrichLead` (`JS-006`), Audit, reports, RM Timeline | reusable — the classifier entry point |
| FN-043 | `_inferOutcomeUncached(comment)` `#L576` | a comment | outcome label | none | `_signalMatches` (FN-046), walks `OUTCOME_RULES` | FN-042 | specific |
| FN-044 | `parseActionLog(text)` `#L72` | raw action-log text | `[{at, by, comment}]` entries (cached in `_actionLogCache`) | populates the cache | `parseDate` (`JS-006`) | `enrichLead` (`JS-006`), Audit (`JS-019`), RM Timeline (`JS-023`) | reusable |
| FN-045 | `_editDistance(a, b)` / `_typoBudget(targetLen)` `#L110/#L156` | two strings / a length | edit distance / allowed budget (0 for ≤4, 1 for ≤8, 2 above) | none | — | `_wordsMatch` (FN-046) | reusable |
| FN-046 | `_wordsMatch` / `_signalMatches(commentWords, signal)` `#L161/#L190` | tokenised comment + a signal | bool (typo-tolerant) | none | FN-045, `_signalWordsOf` (cached) | FN-043 | specific — documented false-positive case ("busy"/"buy"/"bus") |
| FN-047 | `combinedCommentsText(l)` / `hasAnyCommentField(l)` / `hasAnyNarrativeComment(l)` `#L21/#L36/#L52` | a lead | joined text / bools | none | — | `enrichLead` (`JS-006`), card renderers | reusable |
| FN-048 | `suggestedFollowUp(l)` `#L818` | a lead | a follow-up text string | none | `latestFamilyOutcome` (FN-050), `FOLLOWUP_SUGGESTIONS` | Operations cards, reports | reusable |
| FN-049 | `noCommentFollowUp(l)` / `unmatchedFollowUp(comment, loggedBy, ts)` `#L853/#L650` | a lead / a comment | fallback follow-up text | none | baseline `Map` | `suggestedFollowUp` (FN-048), unmatched-comment path | reusable |
| FN-050 | `latestFamilyOutcome(l)` / `collateFamilyComments(row)` / `commentsForCopy(copy, fallbackRM)` / `sortCommentEntries(entries)` `#L703/#L784/#L748/#L769` | a lead / row | latest outcome / merged & sorted comment history | none | `parseActionLog` (FN-044), `inferOutcome` (FN-042) | card renderers, Audit, RM Timeline | reusable |
| FN-051 | `istStamp` / `isoStampIST` | a Date | IST-formatted timestamp string | none | `istParts` (`JS-005`) | timestamps in cards, writeback | reusable |

## Business rules implemented — `RULE-XXX` sub-table

| ID | Rule | Where | Duplicated in (`GS-XXX`)? | Notes |
|---|---|---|---|---|
| RULE-009 | `OUTCOME_RULES` — ordered ~110-signal table; first match wins | `OUTCOME_RULES` `#L230`–`#L556` + FN-043 | **Yes — `FollowupEngine.gs` `OUTCOME_RULES_GS_` (~30 rules)** (`GS-005`). Full diff + the count-gap explanation: `LOGIC_AUDIT.md` Part 4 §4.1 | the single largest duplicated-logic surface in the app |
| RULE-010 | Length-scaled typo tolerance: 0 typos for signals ≤4 chars, 1 for ≤8, 2 above | FN-045 | Yes — `FollowupEngine.gs` mirrors the matcher | documented false-positive: "busy"/"buy"/"bus" |
| RULE-011 | A blank / punctuation-only comment classifies as `No Real Update` | FN-043 `#L586` | Yes | — |
| RULE-012 | `FOLLOWUP_SUGGESTIONS[outcome]` is pure advisory text; a human overwrites `Lead_Followups` col F if they review in time | `FOLLOWUP_SUGGESTIONS` `#L607` + FN-048 | Yes — `FOLLOWUP_SUGGESTIONS_GS_` (`FollowupEngine.gs`) | `LOGIC_AUDIT.md` Part 3 §3.4 |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-012 | comment matches no `OUTCOME_RULES` signal | falls through to `unmatchedFollowUp` ("Manual review required…") and is logged for review | card shows a "read the comments and log a specific next action" prompt; backend logs it to `Unmatched_Comments_Log` (`GS-013`) |
| EXC-013 | typo matcher false positive | accepted risk — documented, not guarded | rare mis-classification (e.g. "buy" → "busy") |

## Data lineage

Comment text (from a `leads` row / action log, `SHEET-001`) →
`parseActionLog` (FN-044) → `inferOutcome` (FN-042) via the typo matcher
→ outcome label → `suggestedFollowUp` (FN-048) → follow-up text →
displayed on cards / written to `Lead_Followups` col F by `JS-018`
(algorithmic fallback only). Full flow: `DATA-003` (comment-classification
pipeline).

## Data sources accessed

In-memory lead / comment text only. No `SHEET-XXX` read directly.

## Data written / modified

None directly. Its `suggestedFollowUp` output is what `JS-018` /
`reports` write into `Lead_Followups` col F as the *algorithmic
fallback* (a human overwrites it on review).

## Failure / error behaviour

No throw paths. An unmatched comment routes to the manual-review string;
the caches (`_inferOutcomeCache`, `_actionLogCache`, `_signalWordsCache`)
are cleared by `fetchAndRender` (`JS-003`).

## Cross-runtime duplication

`OUTCOME_RULES` ↔ `OUTCOME_RULES_GS_` (`GS-005`) — the single largest
duplicated surface; the ~110-vs-~30 count gap is flagged
unverified-explained in `LOGIC_AUDIT.md` Part 4 §4.1. `FOLLOWUP_SUGGESTIONS`
↔ `FOLLOWUP_SUGGESTIONS_GS_`. The typo matcher is re-implemented on the
backend. All must be kept in sync (`HANDOVER.md` §6).

## UI relationships

No buttons. Outcome labels + follow-up text appear on `TAB-003`
Operations cards, `TAB-006` Audit, `TAB-005` RM Timeline, and both
region-report surfaces.

## Architecture relationship

`DASH-001`. Layer 6 (Business logic — client) in `LOGIC_AUDIT.md` Part 1
§1.

## Related documentation

`HANDOVER.md` §2, §6; `LOGIC_AUDIT.md` Part 1 §4b, Part 3 §3.2/§3.4,
Part 4 §4.1; `CLAUDE.md` (duplication gotcha); `GS-013`
(`UnmatchedCommentLogger.gs` — the feedback loop for gaps).

## Relationships

- **Depends On:** `JS-005` (`istParts`), `JS-006` (`parseDate`)
- **Used By:** `TAB-006`, `JS-003` (cache clear), `JS-006`
  (`enrichLead`), `JS-010` (`renderAlertCard`), `JS-012`, `JS-014`,
  `JS-017`, `JS-019`, `JS-021`, `JS-023`, `JS-024`, `DATA-003` — nearly
  every tab/report file
- **Related:** `GS-005` (`FollowupEngine.gs`), `GS-013`
  (`UnmatchedCommentLogger.gs`)

## Source of truth

`js/core-outcome-engine.js` at `HEAD`.

## Validation

- **Method:** full read at `c82ec67`; function + `OUTCOME_RULES` /
  `FOLLOWUP_SUGGESTIONS` locations verified by grep; cross-check
  `LOGIC_AUDIT.md` Part 3 §3.2 + Part 4 §4.1 (the full rule diff).
  `tests/frontend-harness.html` runs comments with known outcomes
  through `inferOutcome`; `Tests_FollowupEngine.gs` covers the backend
  twin in CI.
- **Evidence:** `LOGIC_AUDIT.md` Part 4 §4.1; `tests/frontend-harness.html`;
  `.github/workflows/test.yml` (`Tests_FollowupEngine.gs`, last green).
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-027.

## Revalidation trigger

Any commit touching `js/core-outcome-engine.js`; **`OUTCOME_RULES` gains
or changes a signal** (requires the `OUTCOME_RULES_GS_` twin to change —
`HANDOVER.md` §6); the typo-budget thresholds change;
`FOLLOWUP_SUGGESTIONS` text changes; `parseActionLog`'s entry shape
changes.

## Handover relationship

`HANDOVER.md` §2 names the file; §6 lists it as the anchor of the
comment-classification duplication pair. Current as of 2026-09-09. A
rule change must update `HANDOVER.md` §6 and `FollowupEngine.gs` in the
**same commit**, and run `OPS_CHECKLIST.md`'s pre/post items.

## Lifecycle / retention

N/A — code.

## Next action

none — Closed + Monitored.

## Closure evidence

Record committed for DOC-027; `docs/INDEX.md` `JS-007` → `Closed +
Monitored`, `Last Verified` 2026-09-10, links filled; `RULE-009`..`012`,
`EXC-012`/`013` recorded. No `docs/changes/` record (DOC-027).
