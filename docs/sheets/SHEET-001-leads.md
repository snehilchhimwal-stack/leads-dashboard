# SHEET-001 — leads

| | |
|---|---|
| **Type** | `SHEET-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | Google Sheet, tab `leads` (fixed name — `TAB_NAME_OVERRIDE` / `#tabNameInput`) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

The single source datastore for the whole system — an **external CRM
export** of every first-sale real-estate lead, refreshed into this tab.
Both halves of the system read it: the dashboard parses it through
`HEADER_ALIASES` into `allParsedLeads`, and every scheduled `.gs`
emailer reads it through `readLeadsTab_`. Nothing in this project
*writes* it — it is upstream of everything.

## Reason to exist

`leads` exists because the CRM has no operational layer of its own; this
tab is the agreed hand-off point where the raw export lands and the
dashboard + backend take over. Every derived concept (SLA flags, funnel
position, collation, RM performance) is computed *from* this tab, never
stored back into it.

## Data stored

One row per lead copy (a customer held by 2 RMs = 2 rows). Identity
(`lead_id`, `client_id`), assignment (`RM`, `TL`, `rm_is_active`),
routing (`project`, `region`, `project_region`, `group_source`,
`source_bucket`), lifecycle (`current_stage`, `lead_assigned_at`,
`last_connect`, `last_connect_time`, closing-reason fields), activity
(`call_attempts`, `call_count`, `duration`), and free-text comment
fields (`last_comment`, `internal_status_comments`, `stage_comments`).

## Source of the data

An **external CRM export** — manual/scheduled outside this project. No
`JS-XXX` / `GS-XXX` writes this tab.

## Destination / consumers

- `JS-009` `sheetsApiValuesGet` → `JS-003` `fetchAndRender` →
  `allParsedLeads` → every tab.
- `GS-004` `readLeadsTab_` → every scheduled emailer (`GS-001`,
  `GS-008`, `GS-010`) + `GS-003`.

## Columns / fields

Column names are matched **tolerantly** via `HEADER_ALIASES` (`JS-009`
CFG-022) / `HEADER_ALIASES_` (`GS-004` CFG-037) — the tab's real header
text may vary; the canonical keys are:

| Canonical key | Meaning | Notes |
|---|---|---|
| `lead_id` | the lead-copy id | primary identity; collation groups on this OR `client_id` |
| `client_id` | the customer id | shared across an RM's copies of one customer |
| `RM` / `TL` | assigned rep / team lead | routing + accountability |
| `rm_is_active` | is the RM active | `inactiveRmNewLead` rule |
| `project` / `region` / `project_region` | project + geographic region | `region` normalised via `REGION_GROUP_MAP`; `project_region` used for the Loan override (`JS-014` `effectiveRegion`) — **absent from `Movement_Log`** |
| `group_source` / `source_bucket` | lead source / sub-source | filters + the Google-Non-UTM/Search scheduled-email scope |
| `current_stage` | funnel stage (raw text) | `canonicalStage` → `FUNNEL_ORDER` |
| `lead_assigned_at` | assignment timestamp | SLA clocks start here |
| `last_connect` / `last_connect_time` | last successful contact + its time | first-contact + not-connected rules |
| `last_comment` / `internal_status_comments` / `stage_comments` | RM free-text | `parseActionLog` + `inferOutcome` |
| `closing_reason` / `lead_closing_reason` / `lead_closing_comment` | close metadata | `isLeadClosed` / `isOpenLead_` |
| `call_attempts` / `call_count` / `duration` | cumulative call figures | **MAX not SUM on merge** (`JS-003` RULE-002) |

Exact header aliases: `js/core-sheets-fetch.js` `HEADER_ALIASES` `#L17`.

## Writers

| `JS-XXX` / `GS-XXX` | Which `FN-XXX` | Append / upsert / overwrite / clear |
|---|---|---|
| *(none in this project)* | — | written only by the external CRM export |

## Readers

| Consumer | Which `FN-XXX` | What for |
|---|---|---|
| `JS-009` | `sheetsApiValuesGet` (FN-065) | the one browser leads read |
| `JS-003` | `fetchAndRender` (FN-015) | parse → collate → `allParsedLeads` |
| `GS-004` | `readLeadsTab_` (FN-197) | the one backend leads read |
| `GS-008` | `snapshotOpenLeads_` (FN-218) | 4×/day snapshot into `Movement_Log` |
| `GS-010` / `GS-001` / `GS-003` | via `readLeadsTab_` | scheduled emails + nightly census |

## Automation / triggers touching it

Read-only for automation: `MovementTracker.gs`'s 4×/day trigger,
`OvernightEmailer.gs` (10:00/13:00), `AllIssuesEmailer.gs` (17:00),
`DailyRmIssueLog.gs` (22:50) all *read* it. See each `GS-XXX` record's
Trigger Schedule.

## Apps Script functions touching it

`readLeadsTab_` (`GS-004`), `buildColIndex_` / `getVal_` (`GS-002`) —
read only.

## Data Lifecycle (DOC-019 — `TBD`, filled by `DOC-036`)

- **Data Type:** operational (the live source of truth) — **`TBD`
  confirm** (`DOC-036`)
- **Retention Period:** `TBD` — governed by the external CRM export, not
  by this project (`DOC-036` to confirm whether the export overwrites or
  appends)
- **Enforced By:** `None` in this project — the CRM export owns it
- **Archive / Delete Behavior:** `TBD` (`DOC-036`)
- **Sensitivity:** contains customer contact context and RM comments —
  `TBD` classify (`DOC-036`)

## Risks of changing this tab's structure

A renamed column is usually absorbed by `HEADER_ALIASES` /
`HEADER_ALIASES_` — **but the two alias tables must be kept in sync**
(`LOGIC_AUDIT.md` Part 4 §4.8). A column the CRM stops exporting silently
becomes blank → the dependent SLA flag is skipped, not errored. Adding a
column is safe (ignored unless aliased on both runtimes). The
**`project_region` gap** — present here, absent from `HEADER_ALIASES_` /
`Movement_Log` — is the root of the HIGH Loan-region finding
(`LOGIC_AUDIT.md` Part 4 §4.4).

## Relationships to other tabs

Feeds `SHEET-002` (`Movement_Log`, snapshot of open rows). Nothing feeds
`leads`. `SHEET-005` / `SHEET-008` are derived history *about* the leads
seen here.

## Important logic / business rules

All derived — see `JS-006` (`enrichLead`), `JS-003` (collation),
`GS-012` (`computeSlaFlags_`). None stored here.

## Exceptions & error handling

A 403 on read → `ACCESS_DENIED`; a 404 → `NOT_FOUND` (`JS-003`
EXC-004/005). A malformed row is parsed best-effort and kept.

## Related documentation

`HANDOVER.md` §1, §3 step 2, §4.1 (Sheet access); `LOGIC_AUDIT.md` Part 1
§1 (datastore), §2, Part 4 §4.8.

## Relationships

- **Depends On:** `EXT-001` (Sheets API) for access; the external CRM
  export for content
- **Used By:** `SHEET-002`, `JS-003`, `JS-009`, `GS-004`, `GS-008`,
  `GS-010`, `GS-001`, `GS-003`, and transitively every `TAB-XXX`
- **Related:** every `SHEET-XXX` — they are all derived from or about
  this tab

## Source of truth

The live `leads` tab in the production Google Sheet
(`1QmYB1VqLMisiQXoed6-vSQqgA9nroGIMHsBInZafKGU`); its column vocabulary
is defined by `HEADER_ALIASES` (`js/core-sheets-fetch.js`) /
`HEADER_ALIASES_` (`EmailInfra.gs`).

## Validation

- **Method:** column list cross-read from `HEADER_ALIASES` (`JS-009`) at
  `c82ec67` + `LOGIC_AUDIT.md` Part 1 §1 / Part 2 §1 (field trace).
  Exercised by `tests/frontend-harness.html` (synthetic `leads` rows
  through the real parse) and every `Tests_*.gs` that mocks a leads tab.
- **Evidence:** `LOGIC_AUDIT.md` Part 2 §1; `tests/frontend-harness.html`.
- **Status:** Validated 2026-09-10 (non-lifecycle fields); lifecycle
  `TBD` per `DOC-036`.

## Version / change reference

Verified at `c82ec67`; record created by `DOC-032`.

## Revalidation trigger

A column is added/removed/renamed in the CRM export; `HEADER_ALIASES` or
`HEADER_ALIASES_` changes; the tab name changes; a new consumer starts
reading `leads`.

## Handover relationship

`HANDOVER.md` §1/§3/§4.1 cover the source tab. Current as of 2026-09-09.
A structural change must update `HANDOVER.md` §3 and both alias tables in
the same commit.

## Lifecycle / retention

`TBD` — deferred to `DOC-036` (governed by the external CRM export, not
this project).

## Next action

`DOC-036` — confirm the CRM export's retention/overwrite behaviour and
the sensitivity classification.

## Closure evidence

Record committed for `DOC-032`; `docs/INDEX.md` `SHEET-001` row →
`Closed + Monitored` (non-lifecycle scope), `Last Verified` 2026-09-10;
column list sourced from `HEADER_ALIASES`, not approximated. Lifecycle
section left `TBD` by design (`DOC-032` scoping boundary).
