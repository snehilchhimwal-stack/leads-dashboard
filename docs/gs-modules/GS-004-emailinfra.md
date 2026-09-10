# GS-004 — EmailInfra.gs

| | |
|---|---|
| **Type** | `GS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `EmailInfra.gs` (552 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-10 against commit `c82ec67` |

## Purpose / reason to exist

Shared cross-script email plumbing: the retry wrappers every scheduled
send goes through (`withRetry_`, `withSendRetry_`), the one leads-tab
reader the backend uses (`readLeadsTab_`), region-name mapping
(`mainRegionForGs_`), the **one** place recipient resolution happens for
every scheduled email (`resolveRecipientEmailsForRegion_`), ops alerting,
and the shared HTML email template. It exists so `OvernightEmailer.gs`,
`AllIssuesEmailer.gs`, `DailyRmIssueLog.gs` and `MovementTracker.gs`
don't each re-implement retries, reading the leads tab, or figuring out
who an email goes to.

## Responsibilities

- `withRetry_` / `withSendRetry_` — retry/backoff wrappers.
- `readLeadsTab_` — the backend leads-tab reader (holds `HEADER_ALIASES_`).
- `resolveRecipientEmailsForRegion_` + `loadRegionRecipients_` +
  `ensureRegionRecipientsSheet_` — recipient resolution.
- `mainRegionForGs_` / `normRegionKeyGs_` — region normalisation.
- `passesGoogleNonUtmSearchGs_` — the source filter for the scheduled
  emails.
- `renderOvernightReportEmailHTML_` — the shared email template.
- `notifyOpsAlertGs_` / `notifyLeadSendFailuresGs_` — ops alerting.
- CH-level grouping helpers (`groupChLevelRmsByCh_`,
  `splitSelfAndReportingRmNames_`, `groupLeadsByRmAndFlatten_`).

## Trigger schedule

None — `EmailInfra.gs` installs no trigger; it is called only from other
`.gs` files.

## Requires `setupXxx()` re-run when

Never — no `setupXxx()`, no schedule.

## Significant functions — `FN-XXX` sub-table

| ID | Function | Inputs | Outputs | Side effects | Calls | Called by | Reusable or feature-specific |
|---|---|---|---|---|---|---|---|
| FN-196 | `withRetry_(fn, label)` / `withSendRetry_(fn, label)` `#L193/#L239` | a fn + a label | the fn's result, retried on transient failure with backoff | logs each retry; may raise after exhausting attempts | — | every scheduled read/send in `GS-001` / `GS-008` / `GS-010` / `GS-011` | reusable — the retry backbone |
| FN-197 | `readLeadsTab_(ss)` `#L431` | spreadsheet | the parsed `leads` rows + a column index | one Sheets read | `buildColIndex_` (`GS-002`), `HEADER_ALIASES_` | every scheduled emailer | reusable — the one backend leads read |
| FN-198 | `resolveRecipientEmailsForRegion_(ss, region, rmNames, legacyRecipients, opts)` `#L336` | region + RM names | the `{to, cc}` for that region's email | reads `Region_Recipients` + `RM_Hierarchy` / `Manager_Directory` | `loadRegionRecipients_` (FN-199), `resolveRecipientBucketsForRms_` (`GS-011`) | `GS-001`, `GS-010` | reusable — **the single recipient-resolution point for every scheduled email** |
| FN-199 | `loadRegionRecipients_(ss)` / `ensureRegionRecipientsSheet_(ss)` `#L407/#L273` | spreadsheet | the region→recipients map; ensures the tab | may create `Region_Recipients` | — | FN-198 | reusable |
| FN-200 | `mainRegionForGs_(rawRegion)` / `normRegionKeyGs_(s)` `#L149/#L144` | a raw region | the normalised main region | none | `REGION_GROUP_MAP_` | every scheduled emailer, `GS-008` | reusable — **twin of `mainRegionFor` / `normRegionKey` (`JS-014`)** |
| FN-201 | `passesGoogleNonUtmSearchGs_(groupSourceRaw, sourceBucketRaw)` `#L166` | source fields | bool | none | — | `GS-001`, `GS-010`, `GS-011` | reusable — the source filter for the scheduled digests |
| FN-202 | `renderOvernightReportEmailHTML_(opts)` `#L502` | report options | the HTML email body | none | `esc_` (`GS-002`) | `GS-001`, `GS-010` | reusable — the shared email template |
| FN-203 | `notifyOpsAlertGs_(subject, bodyLines)` / `notifyLeadSendFailuresGs_(entries)` `#L72/#L94` | alert content | sends an ops-alert email | Gmail send | `withSendRetry_` (FN-196) | error paths in every scheduled file | reusable |
| FN-204 | `groupChLevelRmsByCh_(chLevelRms)` / `splitSelfAndReportingRmNames_(chName, rmNames)` / `groupLeadsByRmAndFlatten_(rmNames, rmToLeads)` `#L456/#L470/#L481` | RM/CH names + leads | CH-level grouping for the "blank chain" rollup emails | none | — | `GS-001`, `GS-010` | reusable |

## Config constants — `CFG-XXX` sub-table

| ID | Constant | Value | Meaning | Changing it affects |
|---|---|---|---|---|
| CFG-037 | `HEADER_ALIASES_` | column → `[accepted header names]` | the backend's column vocabulary | `readLeadsTab_` / `buildColIndex_`; **twin `HEADER_ALIASES` (`JS-009` CFG-022)** — `LOGIC_AUDIT.md` Part 4 §4.8 (small diff; **`project_region` missing here** feeds the HIGH Loan finding) |
| CFG-038 | `REGION_GROUP_MAP_` | region-group map | region normalisation | `mainRegionForGs_`; **twin `REGION_GROUP_MAP` (`JS-014` RULE-017)** — audited consistent (`LOGIC_AUDIT.md` Part 4 §4.3) |
| CFG-039 | `TEST_MODE_OVERRIDE_EMAIL_` `#L43` | `''` (unset) | if set, redirects **every** scheduled-email recipient to one address, silently | `resolveRecipientEmailsForRegion_` — the backend twin of the `reports-ui.js` footgun (`JS-016` CFG-024); `LOGIC_AUDIT.md` Part 1 §4d / Part 6 |
| CFG-040 | `ALWAYS_CC_EMAILS_` | a CC list | addresses CC'd on every scheduled email | recipient resolution |

## Exceptions — `EXC-XXX` sub-table

| ID | Condition | Handling | User-visible result |
|---|---|---|---|
| EXC-063 | a transient Sheets read / Gmail send failure | `withRetry_` / `withSendRetry_` retry with backoff | the operation usually succeeds on a later attempt; a persistent failure raises |
| EXC-064 | `RmHierarchy.private.gs` absent → resolved emails `''` | `resolveRecipientEmailsForRegion_` falls back to `Region_Recipients` then `CH_LEVEL_EMAIL_` | email still sends, to a generic fallback (`GS-011`) |
| EXC-065 | `TEST_MODE_OVERRIDE_EMAIL_` left set after testing | **no guard** — silently redirects every recipient | every scheduled email goes to one address, no indicator (`LOGIC_AUDIT.md` Part 6/7) |

## Data lineage

`leads` tab (`SHEET-001`) → `readLeadsTab_` (FN-197) → parsed rows +
column index, consumed by every scheduled emailer. Recipient resolution:
region + RM names → `resolveRecipientEmailsForRegion_` (FN-198) reading
`Region_Recipients` (`SHEET-012`) + `RM_Hierarchy` (`SHEET-006`) +
`Manager_Directory` (`SHEET-007`) → `{to, cc}`. Full flow: `DATA-005`.

## Sheets touched

| `SHEET-XXX` | Read / Write | Which `FN-XXX` | Notes |
|---|---|---|---|
| `SHEET-001` `leads` | Read | FN-197 | the one backend leads read |
| `SHEET-012` `Region_Recipients` | Read + ensure | FN-199 | recipient fallback; created if missing |
| `SHEET-006` `RM_Hierarchy` | Read | FN-198 (via `GS-011`) | routing |
| `SHEET-007` `Manager_Directory` | Read | FN-198 (via `GS-011`) | employee emails |

## Failure / error behaviour

Retries absorb transient failures; a persistent one raises (shows as
Failed in Executions) and typically triggers an ops alert
(`notifyOpsAlertGs_`). The `TEST_MODE_OVERRIDE_EMAIL_` footgun is
unguarded.

## Cross-runtime duplication

`HEADER_ALIASES_` ↔ `HEADER_ALIASES` (`JS-009`) — `LOGIC_AUDIT.md` Part 4
§4.8. `REGION_GROUP_MAP_` ↔ `REGION_GROUP_MAP` (`JS-014`) — Part 4 §4.3
(consistent). `mainRegionForGs_` ↔ `mainRegionFor` (`JS-014`).
`TEST_MODE_OVERRIDE_EMAIL_` ↔ `TEST_MODE_OVERRIDE_EMAIL` (`JS-016`) —
same footgun shape on both runtimes, both unset (`LOGIC_AUDIT.md` Part 6
findings).

## Not live until pasted

Not running until pasted into the Sheet's Apps Script editor. No
`setupXxx()` re-run needed (no trigger).

## UI relationships

N/A — backend infra.

## Architecture relationship

Apps Script backend. Layer 18 (backend infra / routing) in
`LOGIC_AUDIT.md` Part 1 §1. Depended on by every scheduled emailer.

## Related documentation

`HANDOVER.md` §2, §4.3; `OPS_CHECKLIST.md` (Manager_Directory email
gaps); `LOGIC_AUDIT.md` Part 1 §4d, Part 3 §3.7, Part 4 §4.3/§4.8, Part
6 findings; `CLAUDE.md`.

## Relationships

- **Depends On:** `GS-002` (`Core.gs`), `GS-011` (`RmHierarchy.gs` —
  `resolveRecipientBucketsForRms_`, `ALWAYS_CC_EMAILS_`; a file-level
  circular reference, harmless in Apps Script's single namespace),
  `SHEET-001`, `SHEET-006`, `SHEET-007`, `SHEET-012`, `EXT-002`
- **Used By:** `GS-001`, `GS-008`, `GS-010`, `GS-011`, `GS-003` — every
  scheduled emailer / logger
- **Related:** `JS-009` (`HEADER_ALIASES` twin), `JS-014`
  (`REGION_GROUP_MAP` twin), `JS-016` (`TEST_MODE_OVERRIDE_EMAIL` twin)

## Source of truth

`EmailInfra.gs` at `HEAD`.

## Validation

- **Method:** full read at `c82ec67`; function list verified by grep;
  `TEST_MODE_OVERRIDE_EMAIL_` confirmed at `#L43` (value `''`);
  cross-check `LOGIC_AUDIT.md` Part 3 §3.7 + Part 4 §4.3/§4.8.
  `Tests_EmailInfra.gs` runs in CI.
- **Evidence:** `.github/workflows/test.yml` (`Tests_EmailInfra.gs`, last
  green run); `LOGIC_AUDIT.md` Part 4 §4.3/§4.8.
- **Status:** Validated 2026-09-10.

## Version / change reference

Verified at `c82ec67`; record created by DOC-029.

## Revalidation trigger

Any commit touching `EmailInfra.gs` or `Tests_EmailInfra.gs`;
`HEADER_ALIASES_` or `REGION_GROUP_MAP_` changes (check the `js/` twins —
`LOGIC_AUDIT.md` Part 4 §4.3/§4.8); `resolveRecipientEmailsForRegion_`'s
fallback order changes; `TEST_MODE_OVERRIDE_EMAIL_` is used differently;
`Region_Recipients` (`SHEET-012`) schema changes.

## Handover relationship

`HANDOVER.md` §2 names the file ("Shared email plumbing: retry wrappers,
the leads-tab reader, region-name mapping, ops alerting, the HTML email
template"). Current as of 2026-09-09. A `HEADER_ALIASES_` or
`REGION_GROUP_MAP_` change must update `HANDOVER.md` §6 and the `js/`
twin in the same commit.

## Lifecycle / retention

N/A — code. `Region_Recipients` is configuration, not time-series data.

## Next action

none — Closed + Monitored. (The `project_region` gap in `HEADER_ALIASES_`
and the `TEST_MODE_OVERRIDE_EMAIL_` footgun are known `LOGIC_AUDIT.md`
findings — tracked via the revalidation trigger.)

## Closure evidence

Record committed for DOC-029; `docs/INDEX.md` `GS-004` → `Closed +
Monitored`, `Last Verified` 2026-09-10, links recorded; `CFG-037`..`040`
(the backend half of the cross-runtime pairs), `EXC-063`..`065` recorded.
No `docs/changes/` record (DOC-029).
