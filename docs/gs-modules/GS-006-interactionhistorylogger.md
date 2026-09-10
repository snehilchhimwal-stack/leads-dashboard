# GS-006 — InteractionHistoryLogger.gs

| | |
|---|---|
| **Type** | `GS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `InteractionHistoryLogger.gs` (177 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

A forward-looking capture: every time an open lead gets a **genuinely
new** comment (any outcome, not just SLA-relevant ones), one row is
appended to `Comment_History`. Added 2026-09-05. It exists so the
project builds an interaction record it did not previously keep — useful
for later analysis of how RMs actually work a lead. It deliberately has
**no pruning** (unlike `Movement_Log`): writes only happen on a real new
comment, an order of magnitude rarer than `Movement_Log`'s unconditional
4×/day snapshot.

## Responsibilities

- `logInteractionHistoryGs_` — detect genuinely-new comments on open
  leads and append them.
- `commentHistoryDedupKeyGs_` — the `(lead_id, comment)` dedup key.
- `ensureCommentHistorySheet_` — create/repair the `Comment_History`
  tab.
- `logInteractionHistoryNow` — a manual trigger for the same.

## Trigger schedule

**None of its own.** It piggybacks on `MovementTracker.gs`'s trigger —
`logInteractionHistoryGs_` is invoked from inside `snapshotOpenLeads_`
(`GS-008`), which runs 4×/day (`00:00/06:00/12:00/18:00 IST`, via
`setupMovementTracking()`). So it effectively runs 4×/day, same schedule
as the Movement hub (`LOGIC_AUDIT.md` Part 1 §5).

## Requires `setupXxx()` re-run when

Never — it has no `setupXxx()`. It becomes live purely by being pasted
into the Apps Script editor (so `snapshotOpenLeads_` can call it) — see
"Not live until pasted." A logic change takes effect on the next
Movement hub fire.

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-212 | `logInteractionHistoryGs_(ss, dataRows, colIndex, now)` `#L109` | the open-lead rows + column index + now | appends one `Comment_History` row per genuinely-new comment | Sheets append; dedup against existing rows | `latestOutcomeGs_` (`GS-005`), `commentHistoryDedupKeyGs_` (FN-213) | `snapshotOpenLeads_` (`GS-008`), `logInteractionHistoryNow` (FN-215) | specific |
| FN-213 | `commentHistoryDedupKeyGs_(leadId, outcomeEntry)` `#L98` | lead id + a comment entry | a dedup key | none | — | FN-212 | specific |
| FN-214 | `ensureCommentHistorySheet_(ss)` `#L80` | spreadsheet | ensures `Comment_History` exists with the right header | may create/repair the tab | — | FN-212 | specific |
| FN-215 | `logInteractionHistoryNow()` `#L172` | — | runs FN-212 once by hand | Sheets append | FN-212 | Apps Script editor (manual) | specific |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-068 | a comment's `comment_at` is Sheets-coerced from string to Date (defeating string-equality dedup) | the dedup key is comment-text-based, not purely timestamp-based | reduced exposure to the coercion class that bit `UnmatchedCommentLogger.gs` (`GS-013`) |
| EXC-069 | `Comment_History` grows large | **no pruning by design** — writes are comment-triggered, far rarer than `Movement_Log`'s | the tab grows slowly; monitored, not auto-trimmed |

## Data lineage

Open-lead rows (from `leads`, `SHEET-001`, passed in by
`snapshotOpenLeads_`) → `latestOutcomeGs_` (`GS-005`) classifies the
latest comment → if genuinely new (dedup miss) → one row appended to
`Comment_History` (`SHEET-009`). Never re-derived or pruned. Full flow:
`DATA-003` (a downstream sink).

## Sheets touched

| `SHEET-XXX` | Read / Write | Which `FN-XXX` | Notes |
|---|---|---|---|
| `SHEET-001` `leads` | Read (indirect — rows passed in) | FN-212 | via `snapshotOpenLeads_` |
| `SHEET-009` `Comment_History` | Write (append) + ensure | FN-212 / FN-214 | append-only, no pruning |

## Failure / error behaviour

`snapshotOpenLeads_` wraps each piggyback logger in its own try/catch, so
a failure here **never blocks the core `Movement_Log` capture** (`GS-008`).
A failure shows in Executions attributed to the Movement trigger run.

## Cross-runtime duplication

None — there is no client counterpart to this logger. It reuses
`latestOutcomeGs_` (`GS-005`), which carries the comment-classification
duplication transitively, but this file adds no new duplicated logic.

## Not live until pasted

Not running until pasted into the Sheet's Apps Script editor **and**
`snapshotOpenLeads_` (`GS-008`) actually calls it. Per `CLAUDE.md`:
adding a new `.gs` file needs THREE registrations — `Tests_RunAll.gs`'s
`suites` array, `test/run-gs-tests.js`'s file lists, and the live editor
paste. No `setupXxx()` re-run (it has none).

## UI relationships

N/A — backend. `Comment_History` is not yet surfaced in the dashboard.

## Architecture relationship

Apps Script backend. Layer 17 (backend automation — a piggyback on the
Movement hub) in `LOGIC_AUDIT.md` Part 1 §1.

## Related documentation

`HANDOVER.md` §2, §9; `LOGIC_AUDIT.md` Part 1 §4d (measured rates:
~33,229 `Movement_Log` rows/day vs this file's comment-triggered rate);
`CLAUDE.md` (the three-registration rule).

## Relationships

- **Depends On:** `GS-002` (`Core.gs`), `GS-005` (`FollowupEngine.gs` —
  `latestOutcomeGs_`), `GS-004` (`EmailInfra.gs`), `SHEET-001`,
  `SHEET-009`
- **Used By:** `GS-008` (`MovementTracker.gs` — `snapshotOpenLeads_`
  invokes it, same pattern as `GS-013`)
- **Related:** `GS-013` (`UnmatchedCommentLogger.gs` — the other
  piggyback logger), `SHEET-009` (`Comment_History` — its output)

## Source of truth

`InteractionHistoryLogger.gs` at `HEAD`.

## Validation

- **Method:** full read at `c82ec67`; function list verified by grep;
  the "no own trigger, piggybacks on `snapshotOpenLeads_`" claim
  cross-checked against `LOGIC_AUDIT.md` Part 1 §4d/§5.
  `Tests_InteractionHistoryLogger.gs` runs in CI.
- **Evidence:** `.github/workflows/test.yml`
  (`Tests_InteractionHistoryLogger.gs`, last green run); `LOGIC_AUDIT.md`
  Part 1 §4d.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-029. Added 2026-09-05 — the
newest scheduled subsystem at the time of the 2026-09-07 audit.

## Revalidation trigger

Any commit touching `InteractionHistoryLogger.gs` or its `Tests_` file;
the dedup-key logic changes; a pruning policy is added; `latestOutcomeGs_`
(`GS-005`) changes; `Comment_History` (`SHEET-009`) columns change;
`snapshotOpenLeads_` (`GS-008`) stops calling it.

## Handover relationship

`HANDOVER.md` §2 names the file. Current as of 2026-09-09. A change to
the capture condition or the (currently absent) pruning policy should
update `HANDOVER.md` §2 and §9.

## Lifecycle / retention

`Comment_History` (`SHEET-009`): **no retention limit — append-only by
design** (writes are comment-triggered, far rarer than `Movement_Log`).
Confirmed, not `TBD`. Monitored for size, not auto-pruned.

## Next action

none — Closed + Monitored.

## Closure evidence

Record committed for DOC-029; `docs/INDEX.md` `GS-006` → `Closed +
Monitored`, `Last Verified` 2026-09-10, links + "piggyback trigger"
recorded; `EXC-068`/`069`. No `docs/changes/` record (DOC-029).
