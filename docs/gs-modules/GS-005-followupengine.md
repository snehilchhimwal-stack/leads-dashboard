# GS-005 — FollowupEngine.gs

| | |
|---|---|
| **Type** | `GS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `FollowupEngine.gs` (772 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-10-19 against commit `94a90c4` - re-read against 4b83dae (SLA rule changes: Not Updated stage-only, "No follow up in last 4 hours", 3 calls a day); 2026-10-19 change note matches the code (comment text only) |

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

- `inferOutcomeGs_` + `OUTCOME_RULES_GS_` — the classifier (31 rules,
  exact match with the client — see CFG-041).
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
| FN-205 | `inferOutcomeGs_(comment)` `#L434` | a comment string | an outcome label | none | `_signalMatchesGs_` (FN-207), walks `OUTCOME_RULES_GS_` | `latestOutcomeGs_` (FN-209), `GS-013`, `GS-006`, `GS-010`, `GS-001` | reusable — **twin of `inferOutcome` (`JS-007`)** |
| FN-206 | `_editDistanceGs_(a,b)` / `_typoBudgetGs_(targetLen)` / `_wordsMatchGs_(word, target)` `#L89/#L112/#L123` | strings / a length | edit distance / budget (0 for ≤4, 1 for ≤8, 2 above) / a match bool - since 2026-10-15 a target in `_EXACT_ONLY_SIGNAL_WORDS_GS_` (CFG-142: 'declining', 'broker', 'ringing') matches only exactly | none | — | FN-207 | reusable — mirrors the client typo matcher |
| FN-207 | `_signalMatchesGs_(commentWords, signal)` / `_anySignalGs_(commentWords, signals)` / `_signalWordsOfGs_(signal)` / `_wordsOfGs_(text)` `#L139/#L151/#L134/#L130` | tokenised comment + signal(s) | bool | none | FN-206 | FN-205 | reusable |
| FN-208 | `overnightFollowupHintGs_(row, colIndex, now, baselineEntry)` / `noCommentFollowUpGs_(row, colIndex, now, baselineEntry)` / `unmatchedFollowUpGs_(comment, loggedBy)` `#L668/#L691/#L485` | a lead row / a comment | follow-up text (from `FOLLOWUP_SUGGESTIONS_GS_` or a fallback) | none | `latestOutcomeGs_` (FN-209) | `GS-010`, `GS-001` | reusable — **twins of `suggestedFollowUp` / `noCommentFollowUp` / `unmatchedFollowUp` (`JS-007`)** |
| FN-209 | `latestOutcomeGs_(row, colIndex)` / `detectFollowupModifiersGs_(comment, primaryOutcome)` `#L726/#L590` | a lead row / a comment | latest outcome / detected modifiers | none | FN-205, `combinedCommentsTextGs_` (FN-211) | `GS-013`, `GS-006`, `GS-010` | reusable - since 2026-10-15 (FE-4) the "specific time" modifier needs am/pm or minutes on the hour ("after 6pm", "around 5:30"); a bare number ("after 2 days") or minutes followed by a money unit ("around 1.25 cr") is not a time |
| FN-210 | `parseDatedCommentEntries_(internalComments, stageComments)` / `latestCommentTimestamp_(...)` / `countTodayCommentEntries_(..., now)` `#L56/#L74/#L80` | comment fields | dated entries / latest timestamp / today's count | none | — | `computeSlaFlags_` (`GS-012`), FN-209 | reusable — shared with `SlaEngine.gs`; since 2026-10-15 (SE-3) an entry counts only in the `Name: text - YYYY-MM-DD HH:MM` shape (same regex as the JS `parseActionLog` and `latestOutcomeGs_`), so an unattributed dated line no longer counts here while the dashboard ignores it |
| FN-211 | `combinedCommentsTextGs_(row, colIndex)` / `overnightStatusLabelGs_(stage)` `#L613/#L623` | a row / a stage | joined comment text / a status label | none | — | FN-205, FN-209, `GS-010` | reusable |
| FN-521 | `_hasToLetPropertyGs_(commentWords)` `#L157` (added 2026-10-15) | a tokenised comment | `true` when the words `to let` appear and the next word is not one of `_TO_LET_NOT_PROPERTY_NEXT_GS_` (him/her/me/us/them/you/know) | none (pure) | - | the `Resale / Rental (Out of Scope)` rule's `test()` in `OUTCOME_RULES_GS_` | specific - **audit 2026-10-13 FE-3**: 'to let' was a plain signal and matched "asked to let him know"; twin of `_hasToLetProperty` (`JS-007` FN-522) |

## Config constants — `CFG-XXX` sub-table

| ID | Constant | Value | Meaning | Changing it affects |
|---|---|---|---|---|
| CFG-041 | `OUTCOME_RULES_GS_` `#L176`–`#L432` | 31 ordered rules | the comment classifier | **twin `OUTCOME_RULES` (`JS-007` RULE-009)** — full pairwise diff (`LOGIC_AUDIT.md` Part 4 §4.1, 2026-09-07): all 31 rules match exactly, same order, byte-identical `test()` bodies — zero drift, confirmed |
| CFG-042 | `FOLLOWUP_SUGGESTIONS_GS_` | outcome → advisory text | the algorithmic follow-up fallback | **twin `FOLLOWUP_SUGGESTIONS` (`JS-007` RULE-012)** |
| CFG-043 | typo budget thresholds | 0 / 1 / 2 by length | typo tolerance | matcher behaviour; mirrors `JS-007` RULE-010 |
| CFG-142 | `_EXACT_ONLY_SIGNAL_WORDS_GS_` `#L122` / `_TO_LET_NOT_PROPERTY_NEXT_GS_` `#L156` (added 2026-10-15) | `{declining, broker, ringing}` / `{him, her, me, us, them, you, know}` | signal words that get NO typo budget (each is within budget of a common unrelated word: deciding, broken, bringing) / the next words that make "to let" a verb phrase, not a property type | `_wordsMatchGs_` (FN-206) and `_hasToLetPropertyGs_` (FN-521); **twins `_EXACT_ONLY_SIGNAL_WORDS` / `_TO_LET_NOT_PROPERTY_NEXT` (`JS-007` RULE-085/RULE-086) - KEEP IN SYNC**. Real typos are added as literal signals instead ('brokers', 'rining') |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-066 | a comment matches no rule | `unmatchedFollowUpGs_` returns a manual-review string; `GS-013` logs it to `Unmatched_Comments_Log` | the email shows a "read the comments, log a next action" prompt; the classifier gap is surfaced for review |
| EXC-067 | typo false positive | accepted risk (mirrors the client); since 2026-10-15 (FE-1..3) the three known collisions are closed by exact-only matching (CFG-142) | rare mis-classification |

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
Resolved (`LOGIC_AUDIT.md` Part 4 §4.1, 2026-09-07): both sides define
the same 31 outcome categories in the identical priority order — the
"~110 signals" figure some earlier tally used was counting individual
keyword strings across all 31 rules, not a different category count;
"~30" simply undercounted by one on the other side. A direct pairwise
diff (every outcome name, signal list, and `test()` body) confirmed zero
drift. The FE-1..3 changes (2026-10-15) were made on both sides in the same commit. FE-5 (2026-10-13) documents the INTENDED differences in the follow-up text, in both files' header comments: the email appends `FOLLOWUP_MODIFIERS_GS_` clauses, `unmatchedFollowUpGs_` omits the timestamp, there is no closing_reason tier (emailed leads are open), the last_comment fallback leaves loggedBy blank, and timestamps are read only in the fixed IST form. Every rule change must still be made on both sides (`HANDOVER.md`
§6) — this resolution says the two sides currently agree, not that they
can drift apart safely.

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

**2026-10-15** (`8ef279d`, audit 2026-10-13 FE-1..5, SE-3, X-1): 'declining', 'broker' and 'ringing' now match only exactly (`_EXACT_ONLY_SIGNAL_WORDS_GS_`, CFG-142), so "still deciding", "voice broken" and "bringing wife" no longer read as Call Declined / CP-Broker / Ringing; 'brokers' and 'rining' were added as literal signals (FE-1, FE-2). 'to let' left the Resale / Rental signals and is matched by `_hasToLetPropertyGs_` (FN-521) only as a property type, not in "to let him know" (FE-3). The "specific time" follow-up modifier needs am/pm or minutes, so "after 2 days" is no longer quoted as a clock time (FE-4). `parseDatedCommentEntries_` (FN-210) requires the `Name:` prefix like the dashboard, so the email and dashboard agree on Follow-up Overdue / Behind on Today's Calls (SE-3). Header comments now list the intended email-vs-dashboard differences (FE-5) and point at `js/core-outcome-engine.js` instead of the old `js/core.js` (X-1). The JS twin changed in the same commit (`JS-007`). Tests in `Tests_FollowupEngine.gs` and `tests/frontend-harness.html`. **Not live until pasted.**

**2026-10-19** (user request, SLA rule changes - see `GS-012` 2026-10-19): `FollowupEngine.gs`: comment only (the renamed "No follow up in last 4 hours" check). No behaviour change.

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

none — the rule-count gap this action used to point at was already
resolved in `LOGIC_AUDIT.md` Part 4 §4.1 (2026-09-07, before this record
existed); this record just hadn't been corrected to say so until the
2026-09-30 revalidation sweep found the mismatch.

## Closure evidence

Record committed for DOC-029; `docs/INDEX.md` `GS-005` → `Closed +
Monitored`, `Last Verified` 2026-09-10, links recorded; `CFG-041`..`043`
(the backend half of the comment-classification pairs), `EXC-066`/`067`
recorded. No `docs/changes/` record (DOC-029).
