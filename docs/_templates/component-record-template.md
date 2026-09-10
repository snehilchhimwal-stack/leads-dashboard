<!--
GENERIC COMPONENT RECORD TEMPLATE (DOC-016, extended per the Governance Model).
Copy this file to docs/<folder>/<ID>-<slug>.md and fill it in.
The per-type templates in this folder = this skeleton + a few type-specific
sections; where a per-type template says "as generic", use the block below.
Every field is mandatory unless marked (optional). "none" / "N/A" is an
allowed answer; a BLANK field means "not checked yet" and blocks
Record Status: Closed + Monitored.
-->

# <ID> — <Name>

| | |
|---|---|
| **Type** | `<PREFIX>` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `<real path>` (+ `#Lnn` / anchor if a sub-unit) |
| **Owner** | Snehil (default — see NAMING_CONVENTIONS) |
| **Component Status** | Active / Deprecated / Planned / Retired |
| **Record Status** | Not Started / Drafted / Validated / Closed + Monitored / Stale / Reopened / Retired |
| **Last Verified** | `<date>` against commit `<hash>` |

## Purpose / reason to exist
<One paragraph. MANDATORY. Why does this thing exist, what problem does it
solve. A record that only describes implementation without stating purpose
is not valid — it will not pass the Definition of Done.>

## Responsibilities
<What it is on the hook for.>

## Inputs
<What it consumes, and — for each — where it originates (an ID, or an
external source).>

## Outputs
<What it produces, and — for each — where it goes (an ID, or "user / screen").>

## Data lineage
<Origin → Transformation → Stored As (state var or SHEET-XXX) → Consumed By.
Only where the component touches data. See DOC-018.>

## Important logic / business rules
<The non-obvious behaviour worth recording. Link `RULE-XXX` sub-tables;
do NOT restate the code — link to it.>

## Exceptions & error handling
<Per known failure: condition → how it's handled → what the user/system
sees on failure. Link `EXC-XXX` where one is named.>

## UI relationships
<Which `BTN-XXX` / `UI-XXX` / `TAB-XXX` invokes or displays this. "N/A" for
backend-only.>

## Architecture relationship
<Which `DASH-XXX` / `FLOW-XXX` this belongs to.>

## Related documentation
<`HANDOVER.md` §N, `LOGIC_AUDIT.md` Part N, `OPS_CHECKLIST.md`,
`LEAD_FOLLOWUPS_STALENESS.md`, `CLAUDE.md` — whichever actually govern or
explain this. "none" if genuinely none.>

## Relationships
- **Depends On:** `<IDs>` — what this needs to function
- **Used By:** `<IDs>` — what depends on this (reciprocal — see NAMING_CONVENTIONS; `none` is valid, blank is not)
- **Related:** `<IDs>` — relevant but not a hard dependency

## Source of truth
<The actual file/line this record describes — a link. Never a copy of the code.>

## Validation
- **Method:** <the `Tests_*.gs` file / `tests/frontend-harness.html` / a CI run / a manual check>
- **Evidence:** <link to the test file, the CI run, or `../validation/<ID>.md>`
- **Status:** Not validated / Validated <date> / Stale

## Version / change reference
<The commit + task that last required this record to change.>

## Revalidation trigger
<The SPECIFIC condition that makes this record stale — not "when things
change." e.g. "any commit touching `js/core-rm-performance.js`", or
"`RM_PERF_MIN_VOLUME_LEADS` changes value", or "`HANDOVER.md` §9.7 changes".
See the Governance Model's Definition of Stale.>

## Handover relationship
<Does `HANDOVER.md` cover this? Which section? Is that section current as
of Last Verified? If a code change to this component would need a
HANDOVER.md edit, say so here.>

## Lifecycle / retention
<For `SHEET-XXX` / `DATA-XXX`: real value or literal `TBD` + a linked
follow-up task. For everything else: usually "N/A — code, lives and dies
with the repo".>

## Next action
<What's actually left, if anything. "none — Closed + Monitored".>

## Closure evidence
<What proves this record is legitimately Closed + Monitored: the commit,
the validation evidence link, the INDEX.md row update.>
