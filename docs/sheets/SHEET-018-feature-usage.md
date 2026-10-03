# SHEET-018 — Feature_Usage

| | |
|---|---|
| **Type** | `SHEET-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | Google Sheet, tab `Feature_Usage` |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Validated |
| **Last Verified** | 2026-10-03 against commit `aa6f71b` |

## Purpose / reason to exist

The runtime-usage-tracking half of the 2026-10-03 dead-code-audit
follow-up (`docs/_planning/DEAD_CODE_AUDIT_2026-10-03.md`): a durable,
per-component "when was this last actually used" record the user asked
for, scoped to the client dashboard JS specifically (the user's own
2026-10-03 scope decision — the `.gs` backend is a separate question,
not covered by this tab). Exists so `OpsChecklistRunner.gs`'s future
30-day stale-component checker (Part 4, not yet built as of this record)
has a real, durable data source to read instead of inferring usage from
anything in-browser or ephemeral.

## Data stored

One row per TRACKED component (today: the 9 real dashboard tabs — see
`TRACKED_COMPONENT_IDS`, `js/sheets-writeback.js`), upserted — never an
append-only log. `component_id`, `last_used_at` (IST datetime string,
same format every other write-back in this file uses), `use_count` (a
simple running total, no per-user/per-session detail), `first_seen_at`
(IST datetime, set once, preserved on every later update). Deliberately
does NOT record who used something or any per-visit detail — see
`js/sheets-writeback.js`'s own header comment on this tab's block for
the full "avoid unnecessary user data" reasoning. Because every write is
a single-row upsert keyed by `component_id`, this tab can never grow
past one row per tracked component regardless of traffic — unlike
`Movement_Log`/`Send_Log`, it needs no retention/pruning job.

## Source of the data

Written by exactly one source: the browser dashboard
(`js/sheets-writeback.js`'s `recordComponentUsage`/
`computeFeatureUsageUpsert_`/`ensureFeatureUsageSheet_`), fired from two
call sites — the tab-switch click handler
(`js/overview-distribution-people-ops.js`) and once per successful
`fetchAndRender()` (`js/core-fetch-and-render.js`, so the tab a user is
already viewing when they hit Refresh counts too, not just an explicit
switch). An in-session `Set` (`_componentUsageRecordedThisSession`)
throttles this to at most one write per component per page load — a
30-day freshness signal has no use for minute-level resolution, and this
keeps repeated tab-flipping within one visit from spamming the Sheets
API. Best-effort by design: every failure is caught and logged to
`console.warn`, never surfaced to the user or allowed to block the real
UI action that triggered it.

## Destination / consumers

None yet — Part 4 of the 2026-10-03 follow-up (the 30-day stale-component
checker, to be added to `OpsChecklistRunner.gs`) is this tab's intended
reader and has not been built as of this record. Until then this tab is
write-only, same transitional state `SHEET-015` was in before its own
freshness-check reader existed.

## Columns / fields

| Column | Type | Meaning | Notes |
|---|---|---|---|
| `component_id` | text | the tracked component's stable id (e.g. `tab-overview`) | the upsert key — matches `TRACKED_COMPONENT_IDS` and the real `data-tab`/panel `id` values in `dashboard.html` |
| `last_used_at` | datetime (IST string) | most recent time this component was viewed | updated on every recorded use |
| `use_count` | number | running total of recorded uses | NOT a unique-visitor count — one throttled write per session, so this is "sessions that viewed it," not "page loads" |
| `first_seen_at` | datetime (IST string) | first time this component was ever recorded | set once, preserved on every later upsert |

Exact list: `js/sheets-writeback.js` `FEATURE_USAGE_COLUMNS` `#L941`.

## Writers

| Writer | Which `FN-XXX` | Mode |
|---|---|---|
| `JS-018` | `recordComponentUsage` / `computeFeatureUsageUpsert_` (pure) / `ensureFeatureUsageSheet_` | upsert by `component_id` (tab-switch click + once per successful `fetchAndRender()`) |

## Readers

None yet — see Destination / consumers above.

## Automation / triggers touching it

None — purely user-interaction-triggered from the browser (a tab click,
or a page load/refresh landing on/already showing a tracked tab). No
Apps Script trigger writes or reads this tab as of this record.

## Data Lifecycle

- **Data Type:** operational/diagnostic
- **Retention Period:** none needed — bounded by construction (one row
  per entry in the fixed `TRACKED_COMPONENT_IDS` list, currently 9; an
  upsert, never an append), unlike every other tab in this file.
- **Enforced By:** n/a (structurally bounded, not policy-enforced)
- **Sensitivity:** operational — no PII, no per-user/per-session data,
  just aggregate component-level counts and timestamps, by deliberate
  design (see Purpose above).

## Sensitivity & operational importance (DOC-038)

- **Operational importance:** LOW today (nothing reads it yet) — will
  become MEDIUM once Part 4's stale-component checker depends on it for
  a real weekly report.
- **Data sensitivity:** operational — no names, no lead identifiers, no
  per-visitor detail.

## Risks of changing this tab's structure

`TRACKED_COMPONENT_IDS` is duplicated across runtimes on purpose (see
that constant's own comment in `js/sheets-writeback.js`) — if Part 4
ever adds a matching `TRACKED_COMPONENT_IDS_GS_` in
`OpsChecklistRunner.gs`, the two lists must be changed together, same
discipline `CLAUDE.md` already documents for every other duplicated-pair
in this project. `FEATURE_USAGE_COLUMNS` order must stay in sync with
`computeFeatureUsageUpsert_`'s own `rowValues` array shape.

## Relationships to other tabs

None yet — standalone. Not a sibling of `Movement_Log`/`Movement_Log_Runs`
despite the superficial "usage tracking" similarity; this tab tracks
CLIENT-side dashboard engagement, not lead data capture.

## Important logic / business rules

The "upsert by component_id, never append" design is what keeps this tab
bounded with no retention job needed — see Data Lifecycle above. The
in-session throttle (`_componentUsageRecordedThisSession`) is a
client-side-only optimization, not a durability guarantee — it resets on
every hard page reload, by design (the next load just re-records once
more, which is fine for a 30-day-resolution signal).

## Exceptions & error handling

Every failure (network, auth, malformed response) is caught inside
`recordComponentUsage` and logged via `console.warn`, never re-thrown —
a tracking write must never be visible to the user or block the tab
switch / render pass that triggered it. An unrecognized `componentId` is
rejected before even touching the in-session throttle Set.

## Related documentation

`docs/_planning/DEAD_CODE_AUDIT_2026-10-03.md` (the audit this follow-up
work closes two findings from); `js/sheets-writeback.js` `#L911`–`#L1028`
(the whole feature-usage-tracking block); `tests/frontend-harness.html`
section 2j (`computeFeatureUsageUpsert_`'s pure-logic test coverage).

## Relationships

- **Depends On:** `JS-018`
- **Used By:** `JS-018` (write-only so far — no reader component yet)
- **Related:** none yet — see Relationships to other tabs above

## Source of truth

The live `Feature_Usage` tab; schema defined by `FEATURE_USAGE_COLUMNS`
(`js/sheets-writeback.js`).

## Validation

- **Method:** column list, writer, and the upsert decision logic all
  read directly from `js/sheets-writeback.js` source
  (`FEATURE_USAGE_TAB_NAME`, `FEATURE_USAGE_COLUMNS`,
  `TRACKED_COMPONENT_IDS`, `ensureFeatureUsageSheet_`,
  `computeFeatureUsageUpsert_`, `recordComponentUsage`); the two call
  sites confirmed directly in `js/overview-distribution-people-ops.js`
  and `js/core-fetch-and-render.js`. `computeFeatureUsageUpsert_`'s pure
  decision logic (new-component append, existing-component update with
  count incremented and `first_seen_at` preserved, blank-`first_seen_at`
  fallback) and `recordComponentUsage`'s input-validation/throttle/
  no-sheet-no-op guards are covered by real assertions in
  `tests/frontend-harness.html` (section 2j, 12 assertions, full suite
  168/168) — confirmed to make zero real network calls in that harness
  (verified directly: `read_network_requests` showed no `googleapis.com`
  entries on a fresh page load exercising both call sites).
- **Evidence:** source line citations above; `tests/frontend-harness.html`
  section 2j; `docs/_planning/DEAD_CODE_AUDIT_2026-10-03.md`.
- **Status:** Validated 2026-10-03, not yet Closed + Monitored — Part 4
  (the reader) doesn't exist yet, so this tab's full lifecycle isn't
  provable end-to-end until that lands.

## Version / change reference

Record created 2026-10-03, tab + writer introduced same day as Part 3 of
the dead-code-audit follow-up (`docs/_planning/DEAD_CODE_AUDIT_2026-10-03.md`).

## Revalidation trigger

`FEATURE_USAGE_COLUMNS` changes; `TRACKED_COMPONENT_IDS` changes (a
component added/removed); Part 4 adds a reader (this record's
Destination/consumers and Readers sections both need updating then).

## Handover relationship

Not yet added to `HANDOVER.md` — will be, in the same commit as Part 4
(the `.gs`-side reader), per this project's "a real architectural change
updates `HANDOVER.md` in the same commit" discipline (`CLAUDE.md`). Part
3 alone (write-only, nothing reads it yet) is judged not to cross that
bar on its own.

## Lifecycle / retention

None needed — see Data Lifecycle above.

## Next action

Add the Part 4 reader (`OpsChecklistRunner.gs`'s 30-day stale-component
checker) and update this record's Destination/consumers, Readers, and
Handover relationship sections once it exists.

## Closure evidence

N/A — Record Status is `Validated`, not `Closed + Monitored`, pending
Part 4.
