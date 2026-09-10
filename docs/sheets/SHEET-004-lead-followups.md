# SHEET-004 — Lead_Followups

| | |
|---|---|
| **Type** | `SHEET-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | Google Sheet, tab `Lead_Followups` |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

The **human-review bridge** for region-email follow-up suggestions. Both
the dashboard's Generate cycle (`JS-016`) and `OvernightEmailer.gs`
(`GS-010`) push the qualifying flagged leads here, then wait for a
person to write a real next-action into **column F** before the email
goes out; if nobody reviews in time, the algorithmic suggestion is used
with an "UNREVIEWED" label. It exists so the automated emails carry
human-checked follow-ups where possible, and so the review happens in
one shared place both runtimes see.

## Reason to exist

A scheduled email can't ask a person "is this the right next step?" in
line — this tab is the asynchronous inbox where that review happens, and
the `updated_at` column (G) is what `LeadFollowupsStaleness.gs` and the
dashboard use to flag a row that's been sitting unreviewed too long.

## Data stored

One row per flagged lead in the current cycle. **Cleared at the start of
every Generate cycle** and re-populated.

## Source of the data

Cols A–E, G, H written by `JS-018` `pushLeadsToFollowups` (dashboard
cycle) and `GS-010` `pushUnresolvedToLeadFollowups_` (overnight cycle).
**Column F is written only by a human** editing the sheet.

## Destination / consumers

`JS-016` / `JS-018` `waitForAllFollowups` (poll col F) → the dashboard
Generate cycle. `GS-010` `waitForFollowupSuggestions_` (poll col F) →
the overnight cycle. `GS-007` `LeadFollowupsStaleness.gs` reads col G for
its amber/red conditional formatting.

## Columns / fields

| Col | Name | Type | Meaning | Notes |
|---|---|---|---|---|
| A | `lead_id` | text | the lead | upsert key |
| B | `region` | text | `mainRegion` \| `region` | |
| C | `RM` | text | assigned RM | |
| D | `issue` | text | the SLA issue key | |
| E | `collated_comments` | text | merged family comment history | script-written |
| F | `suggested_followup` | text | **the human's next-action** | **never written by any script** — left blank on push |
| G | `updated_at` | datetime | last script write to this row | drives staleness (amber 12h / red 24h — `GS-007`) |
| H | `own` (own-comments) | text | the RM's own comment text | script-written |

Ranges: `js/sheets-writeback.js` writes `A:E`, `G:G`, `H:H` and reads
`A2:G` (`#L226`–`#L230`, `#L773`).

## Writers

| Writer | Which `FN-XXX` | Mode |
|---|---|---|
| `JS-018` | `pushLeadsToFollowups` (FN-124) | upsert cols A–E, G, H |
| `JS-018` | `clearLeadFollowupsTab` (FN-125) | clear data rows (start of each cycle) |
| `GS-010` | `pushUnresolvedToLeadFollowups_` (FN-235) | upsert (overnight cycle) |
| *(a human)* | — | column F only |

## Readers

| Reader | Which `FN-XXX` | For |
|---|---|---|
| `JS-018` | `waitForAllFollowups` (FN-127) | poll col F during the dashboard cycle |
| `GS-010` | `waitForFollowupSuggestions_` (FN-235) | poll col F during the overnight cycle |
| `GS-007` | conditional-format rules (FN-216/217) | flag stale rows by col G |

## Automation / triggers touching it

Written by the on-demand Generate button (`BTN-002`/`BTN-003`,
`BTN-016`) and the `OvernightEmailer.gs` 10:00 trigger. No trigger of
its own.

## Apps Script functions touching it

`pushUnresolvedToLeadFollowups_`, `waitForFollowupSuggestions_`,
`formatFollowupAgeGs_` (`GS-010`); `buildLeadFollowupsStalenessRuleSpecs_`,
`setupLeadFollowupsStalenessFormatting` (`GS-007`).

## Data Lifecycle (DOC-019 — completed by `DOC-036`, 2026-09-10)

- **Data Type:** temporary (cleared and re-populated each Generate
  cycle).
- **Retention Period:** **no time-based retention — `TBD` whether stale
  rows persist between cycles.** No `prune*_` function touches this tab
  (grep at `9cafa68`). `clearLeadFollowupsTab` wipes all data rows at
  the **start** of every Generate cycle — that is a per-cycle reset, not
  a retention policy. Whether a row for a lead that resolves *between*
  cycles is ever cleared before the next Generate is unconfirmed. Feeds
  `DOC-037`.
- **Enforced By:** `clearLeadFollowupsTab` (`JS-018` FN-125) — cycle
  reset, not a prune. No time-based enforcer.
- **Archive / Delete Behavior:** rows overwritten / cleared at the next
  cycle start, never archived.
- **Sensitivity:** operational (RM comment context) — `DOC-038` for the
  operational-importance classification (an automated flow depends on
  it — the `GS-010` overnight cycle + `GS-007` formatting).

## Risks of changing this tab's structure

**Column F is a hard contract** — no script may write it; a change that
does silently overwrites human review. The `updated_at` column position
(G) is anchored by `GS-007`'s conditional-format rules — moving it
requires re-running `setupLeadFollowupsStalenessFormatting()`. Every
consumer's staleness tolerance is mapped in
`LEAD_FOLLOWUPS_STALENESS.md` — a new reader/writer must be added there
in the same change (`CLAUDE.md`'s explicit rule).

## Relationships to other tabs

Populated from `SHEET-001` (`leads`, via the enriched issue set). Not
fed by any other tab. Feeds the region emails (not a tab).

## Important logic / business rules

The 3-phase Generate cycle (`JS-016` FN-111), the `_generateCycleOwner`
mutex (`JS-018` FN-126) preventing the two runtimes clobbering it, the
never-write-F rule, and the unguarded cross-runtime overlap window
(`LOGIC_AUDIT.md` Part 7 §18 MEDIUM #3).

## Exceptions & error handling

A partial write is re-runnable (upsert by `lead_id`). Concurrent Generate
cycles are mutex-blocked intra-runtime; cross-runtime overlap is
unguarded (MEDIUM #3). The Date-vs-string coercion class (real historical
bug) is why writes use `RAW`.

## Related documentation

`HANDOVER.md` §3 step 5; **`LEAD_FOLLOWUPS_STALENESS.md`** (every
consumer + its tolerance); `LOGIC_AUDIT.md` Part 3 §3.8, Part 7 §18
MEDIUM #3; `CLAUDE.md`.

## Relationships

- **Depends On:** `SHEET-001` (`leads`), `JS-018`, `GS-010` (the
  writers), `EXT-001`
- **Used By:** `JS-016`, `JS-018`, `JS-021`, `GS-010`, `GS-007`,
  `TAB-003`, `TAB-007`
- **Related:** `SHEET-011` (`Send_Log` — records the email that this
  bridge fed)

## Source of truth

The live `Lead_Followups` tab; the A–H column layout is defined
implicitly by `js/sheets-writeback.js`'s write ranges and
`OvernightEmailer.gs`'s `#L171` comment (`C RM, D issue, E
collated_comments, F suggested_followup, G updated_at`).

## Validation

- **Method:** column layout read from the write ranges in
  `js/sheets-writeback.js` (`#L226`–`#L230`) + the `OvernightEmailer.gs`
  `#L171` comment at `c82ec67`; cross-check `LOGIC_AUDIT.md` Part 3 §3.8
  + `LEAD_FOLLOWUPS_STALENESS.md`. Exercised by `tests/frontend-harness.html`
  (mocked `Lead_Followups` I/O) and `Tests_OvernightEmailer.gs`.
- **Evidence:** `LEAD_FOLLOWUPS_STALENESS.md`; `LOGIC_AUDIT.md` Part 3
  §3.8; `tests/frontend-harness.html`.
- **Status:** Validated 2026-09-10 (non-lifecycle); lifecycle `TBD`
  (`DOC-036`).

## Version / change reference

Verified at `c82ec67`; record created by `DOC-032`.

## Revalidation trigger

The A–H column layout changes; anything writes column F; the `updated_at`
column moves (needs `GS-007` setup re-run); a new consumer is added
(update `LEAD_FOLLOWUPS_STALENESS.md`); the clear-then-repopulate cycle
model changes.

## Handover relationship

`HANDOVER.md` §3 step 5 covers the write-back path;
`LEAD_FOLLOWUPS_STALENESS.md` is the dedicated map. Current as of
2026-09-09. A structural or consumer change must update both in the same
commit.

## Lifecycle / retention

`TBD` — deferred to `DOC-036`. Effectively per-cycle (cleared each
Generate run); confirm the between-cycle persistence behaviour.

## Next action

`DOC-036` — confirm retention/archival semantics and sensitivity.

## Closure evidence

Record committed for `DOC-032`; `docs/INDEX.md` `SHEET-004` → `Closed +
Monitored` (non-lifecycle scope), `Last Verified` 2026-09-10; column
layout sourced from the write ranges, not approximated; Data Lifecycle
`TBD` per `DOC-032` boundary.
