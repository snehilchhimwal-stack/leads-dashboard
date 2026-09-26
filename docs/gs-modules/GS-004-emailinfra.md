# GS-004 — EmailInfra.gs

| | |
|---|---|
| **Type** | `GS-` (see `../NAMING_CONVENTIONS.md`) |
| **Location** | `EmailInfra.gs` (680 lines) |
| **Owner** | Snehil |
| **Component Status** | Active |
| **Record Status** | Closed + Monitored |
| **Last Verified** | 2026-09-26 against commit `5aafbd4` — region P&L head Cc (`FN-298`, `CFG-070`; see `## Version / change reference`) |

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
| FN-196 | `withRetry_(fn, label)` / `withSendRetry_(fn, label)` `#L304/#L350` | a fn + a label | the fn's result, retried on transient failure with backoff | logs each retry; may raise after exhausting attempts | — | every scheduled read/send in `GS-001` / `GS-008` / `GS-010` / `GS-011` | reusable — the retry backbone |
| FN-197 | `readLeadsTab_(ss)` `#L556` | spreadsheet | the parsed `leads` rows + a column index | one Sheets read | `buildColIndex_` (`GS-002`), `HEADER_ALIASES_` | every scheduled emailer | reusable — the one backend leads read |
| FN-198 | `resolveRecipientEmailsForRegion_(ss, region, rmNames, legacyRecipients, opts)` `#L447` | region + RM names | the `{to, cc}` for that region's email | reads `Region_Recipients` + `RM_Hierarchy` / `Manager_Directory` | `loadRegionRecipients_` (FN-199), `resolveRecipientBucketsForRms_` (`GS-011`) | `GS-001`, `GS-010` | reusable — **the single recipient-resolution point for every scheduled email** |
| FN-199 | `loadRegionRecipients_(ss)` / `ensureRegionRecipientsSheet_(ss)` `#L532/#L384` | spreadsheet | the region→recipients map; ensures the tab | may create `Region_Recipients` | — | FN-198 | reusable |
| FN-200 | `mainRegionForGs_(rawRegion)` / `normRegionKeyGs_(s)` `#L260/#L255` | a raw region | the normalised main region | none | `REGION_GROUP_MAP_` | every scheduled emailer, `GS-008` | reusable — **twin of `mainRegionFor` / `normRegionKey` (`JS-014`)** |
| FN-201 | `passesGoogleNonUtmSearchGs_(groupSourceRaw, sourceBucketRaw)` `#L277` | source fields | bool | none | — | `GS-001`, `GS-010`, `GS-011` | reusable — the source filter for the scheduled digests |
| FN-202 | `renderOvernightReportEmailHTML_(opts)` `#L627` | report options | the HTML email body | none | `esc_` (`GS-002`) | `GS-001`, `GS-010` | reusable — the shared email template |
| FN-203 | `notifyOpsAlertGs_(subject, bodyLines)` / `notifyLeadSendFailuresGs_(entries)` `#L183/#L205` | alert content | sends an ops-alert email | Gmail send | `withSendRetry_` (FN-196) | error paths in every scheduled file | reusable |
| FN-204 | `groupChLevelRmsByCh_(chLevelRms)` / `splitSelfAndReportingRmNames_(chName, rmNames)` / `groupLeadsByRmAndFlatten_(rmNames, rmToLeads)` `#L581/#L595/#L606` | RM/CH names + leads | CH-level grouping for the "blank chain" rollup emails | none | — | `GS-001`, `GS-010` | reusable |
| FN-281 | `isFutworkRmNameGs_(name)` `#L70` | an RM name | bool — does the name contain "Futwork" (case-insensitive)? | none | — | FN-198 | reusable — the single definition of "is this a Futwork-named RM" (added 2026-09-25) |
| FN-283 | `writeUnlessTestModeGs_(fn, label)` `#L108` | a write closure + label | the closure's result, or `undefined` when skipped | runs `fn` through `withRetry_` and then `SpreadsheetApp.flush()` INSIDE the retry, so a deferred write error (e.g. an oversize cell) surfaces inside the caller's try/catch — except in TEST MODE, where it logs and skips (2026-09-25) | `withRetry_` (FN-196) | `GS-001`'s `AllIssues_Log` append; `GS-010`'s `Overnight_Log` append, checkpoint1/2 write-back, `followup_sent_at` | reusable — the single guard that keeps a TEST MODE run from writing production state |
| FN-284 | `chLevelReportToGs_()` `#L135` | none | the To string for a CH-level report | none | — | `GS-001` / `GS-010` CH-level report sends | reusable — `OPS_ALERT_EMAIL_,CH_LEVEL_EMAIL_`, or only the tester in TEST MODE (both sends used to ignore TEST MODE) |
| FN-290 | `regionKeyForRmGs_(rmName, region)` `#L140` | an RM name + its real region | the grouping key: `FUTWORK_REGION_KEY_` for a Futwork RM, else the region | none | `isFutworkRmNameGs_` (FN-281) | `GS-001`, `GS-010` lead grouping | reusable — puts every Futwork lead from every region under ONE key |
| FN-291 | `regionSummaryGs_(items)` `#L143` | items carrying `.region` | `{regions (sorted), counts, label}` e.g. `Pune (3) · Thane (1)` | none | — | FN-292 | reusable |
| FN-292 | `regionHeaderOptsGs_(regionKey, items)` `#L151` | a region key + items | `{region}` or, for the Futwork key, `{region: 'A, B', regionLabel: 'Regions: A (n) · B (m)'}` | none | FN-291 | `GS-001`/`GS-010` email builders | reusable — spells every real region out at the top of a Futwork email |
| FN-293 | `sectionsByRegionGs_(items, sectionsForRegion)` `#L160` | items + a per-region section builder | sections grouped region → RM, the first of each region carrying a `regionBand` | none | — | `GS-001`/`GS-010` email builders | reusable — keeps regions visibly separate inside one email |
| FN-294 | `dedupeByLeadIdGs_(entries)` `#L173` | lead entries | the same list, first occurrence of each `lead_id` only | none | — | `GS-010`'s Section-2 merges | reusable — a merged bucket must never repeat a lead |
| FN-295 | `jsonForCellGs_(entries, label)` `#L118` | a list + a label for the alert | the JSON text for ONE cell, at most `MAX_CELL_JSON_CHARS_` (45,000) characters | if the list is too big, drops trailing entries (10% at a time) and sends ONE ops alert | `notifyOpsAlertGs_` | `GS-001`'s `issue_snapshot_json`, `GS-010`'s `lead_ids_json` / `checkpoint1_json` / `checkpoint2_json` writes | reusable — a write can never exceed Sheets' 50,000-character cell limit |
| FN-298 | `withRegionPnlHeadCcGs_(pnlHeadEmail, to, cc)` `#L95` | a P&L head's address (or blank), the email's To, its Cc list (comma text) | the Cc list with that address added — comma text, or `undefined` when empty | none (pure) | — | `resolveRecipientEmailsForRegion_` (regular buckets and the legacy `Region_Recipients` fallback bucket; NOT the CH-level backstop or the Futwork bucket, which deliberately have no Cc) | specific — **added 2026-09-26** ("add pnl head of Hyderabad and Bangalore in cc"); never Cc's someone who is already the To or already in the Cc (compared case-insensitively) |
| FN-300 | `regionPnlHeadEmailGs_(ss, region, hierarchyData)` `#L80` | the spreadsheet, a region name, optionally the hierarchy data a caller already loaded | the region's P&L head's email address, or `''` | reads `RM_Hierarchy`/`Manager_Directory` via `loadRmHierarchyAndEmails_` (`GS-011`) only when the region has a P&L head configured and no `hierarchyData` was passed; logs (never throws) when the name has no address | `loadRmHierarchyAndEmails_` (`GS-011`) | `resolveRecipientEmailsForRegion_`, once per call | specific — **added 2026-09-26**; the region key and the name are matched case- and space-insensitively |

## Config constants — `CFG-XXX` sub-table

| ID | Constant | Value | Meaning | Changing it affects |
|---|---|---|---|---|
| CFG-037 | `HEADER_ALIASES_` | column → `[accepted header names]` | the backend's column vocabulary | `readLeadsTab_` / `buildColIndex_`; **twin `HEADER_ALIASES` (`JS-009` CFG-022)** — `LOGIC_AUDIT.md` Part 4 §4.8 (small diff; **`project_region` missing here** feeds the HIGH Loan finding) |
| CFG-038 | `REGION_GROUP_MAP_` | region-group map | region normalisation | `mainRegionForGs_`; **twin `REGION_GROUP_MAP` (`JS-014` RULE-017)** — audited consistent (`LOGIC_AUDIT.md` Part 4 §4.3) |
| CFG-039 | `TEST_MODE_OVERRIDE_EMAIL_` `#L43` | `''` (unset) | if set, redirects **every** scheduled-email recipient to one address, silently — and, since 2026-09-25, a TEST MODE run also writes NO production state (log rows, checkpoint columns, `followup_sent_at`), bypasses the region/follow-up idempotency guards, routes CH-level reports and Section-2-only buckets to the tester too, and tags the digest subject `[TEST MODE]` (`FN-283`/`FN-284`) | `resolveRecipientEmailsForRegion_` — the backend twin of the `reports-ui.js` footgun (`JS-016` CFG-024); `LOGIC_AUDIT.md` Part 1 §4d / Part 6 |
| CFG-040 | `ALWAYS_CC_EMAILS_` | a CC list | addresses CC'd on every scheduled email — **except** the CH-level backstop path (`bucketLabel: 'Unmatched RMs (backstop)'`, no `RM_Hierarchy` match and no `Region_Recipients` fallback either), fixed 2026-09-24 to deliberately exclude leadership, matching the sibling `notifyChLevelLeadsGs_`/`notifyChLevelIssuesGs_` backstop's own "not leadership" rule | recipient resolution |
| CFG-067 | `FUTWORK_ROUTE_EMAIL_` `#L69` | `snehil.chhimwal@homesfy.in` | the ONLY address any RM whose name contains "Futwork" (tele-calling vendor agents) is ever emailed — never their manager chain, `Region_Recipients`, the CH backstop, or `ALWAYS_CC_EMAILS_`; a `let`, overridden in `Tests_Mocks.gs` like `OPS_ALERT_EMAIL_` (added 2026-09-25) | recipient resolution (`resolveRecipientEmailsForRegion_`, so both `GS-001`'s 17:00 and `GS-010`'s 10:00 sends) |
| CFG-068 | `FUTWORK_REGION_KEY_` `#L139` | `'Futwork'` | the single pseudo-region every Futwork RM's leads are grouped under, so each job sends ONE Futwork email; each lead keeps its real `.region` for display (added 2026-09-25) | `GS-001`/`GS-010` lead grouping, the renderer's region bands, `loadYesterdaysAllIssuesBucketsGs_`'s legacy-row normalization |
| CFG-069 | `MAX_CELL_JSON_CHARS_` `#L117` | `45000` | the most characters `jsonForCellGs_` will put in one log cell (Sheets rejects >50,000; the headroom is deliberate) (added 2026-09-25) | every JSON log-cell write |
| CFG-070 | `REGION_PNL_HEAD_CC_` `#L76` | `{ Hyderabad: 'Mukesh Mishra', Bangalore: 'Mukesh Mishra' }` (names, not addresses - the repo is public; the address comes from Manager_Directory) | the P&L head Cc'd on every automatic email for that region — the 17:00 All-Issues email, the 10:00 combined email, the 13:00 threaded reply (the 10:00 Section-2-only and 13:00 sends use the Cc STORED at 17:00 / 10:00, so a new entry reaches them from the next 17:00 run) (added 2026-09-26; source: the HR export's P&L column — Mukesh Mishra for both teams) | `regionPnlHeadEmailGs_` (`FN-300`) / `withRegionPnlHeadCcGs_` (`FN-298`) — add a region here to Cc its P&L head; `let` so `Tests_Mocks.gs` can reassign it |

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
- **Used By:** `GS-001`, `GS-002`, `GS-003`, `GS-006`, `GS-008`,
  `GS-009`, `GS-010`, `GS-011`, `GS-013`, `SHEET-012`, `EXT-002`,
  `DATA-002` — every scheduled emailer / logger
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

**Revalidated 2026-09-24** `8fe9714`: real production bug fix,
reported directly by the user off a real email
("(Unmatched RMs (backstop)) Navi Mumbai Google Overnight Leads")
that landed with `cc: ashish.kukreja@homesfy.in, saurabh.mishra@homesfy.in`
(`ALWAYS_CC_EMAILS_`). `resolveRecipientEmailsForRegion_`'s CH-level
backstop branch (`bucketLabel: 'Unmatched RMs (backstop)'` — no
`RM_Hierarchy` match AND no `Region_Recipients` fallback either) was
Cc'ing leadership on a raw "couldn't route this at all" email,
inconsistent with the SAME company-wide backstop's other trigger
(`notifyChLevelLeadsGs_`/`notifyChLevelIssuesGs_`, `OvernightEmailer.gs`/
`AllIssuesEmailer.gs`), which already deliberately excludes leadership
from this class of email ("per explicit request, this goes only to
`OPS_ALERT_EMAIL_` + `CH_LEVEL_EMAIL_`, not leadership" — that
function's own comment). Fixed by removing the `ALWAYS_CC_EMAILS_` Cc
from this ONE branch only — the legacy `Region_Recipients` fallback
branch (`bucketLabel: 'Unmatched RMs'`, a DIFFERENT, less-severe case
where a human HAS configured a fallback address) still Cc's leadership,
unchanged, since the user's report and this fix are both scoped
specifically to the backstop path. `CFG-040`'s own row updated to note
the exception. File grew 552L → 559L (+7); every `#Lnn` citation in
this record re-grepped and corrected. `Tests_EmailInfra.gs` gained 1 new
assertion locking in `cc === undefined` for this exact branch. 899/899
local `.gs` tests pass (+1 new).

**2026-09-25** (`ff91419`): any RM whose name contains "Futwork" is now pulled OUT of `resolveRecipientBucketsForRms_` and emailed only at `FUTWORK_ROUTE_EMAIL_` (`CFG-067`, `FN-281`), as ONE dedicated bucket per region (`bucketLabel: 'Futwork'`, no Cc, no `Region_Recipients`/CH-backstop/`ALWAYS_CC_EMAILS_`). Motivation: Futwork agents (e.g. "Kajal Futwork", manager "Deepali Tharwani Futwork") aren't in `RM_Hierarchy`, so they were falling into the "Unmatched RMs (backstop)" email to `CH_LEVEL_EMAIL_`. Applied at the one choke point, so it covers the 17:00 and 10:00 sends; the 10:00 Checkpoint-1 Section 2 inherits it because it reuses the 17:00 stored recipient. Not re-resolved for already-logged rows (routing is frozen at 17:00). File grew 559L → 570L (+11); every `#Lnn` after line 65 re-mapped. `Tests_EmailInfra.gs` +13 assertions; `Tests_Mocks.gs` save/sets/restores `FUTWORK_ROUTE_EMAIL_`. **Deployed live 2026-09-25**: applied to the Sheet's Apps Script editor as the same three edits, then verified after a full page reload that the saved file's SHA-256 equals the committed file's (`6cf083fa…28d6`, 34,611 chars LF-normalized). No `setupXxx()` re-run needed (no trigger changed). `Tests_Mocks.gs`/`Tests_EmailInfra.gs` were NOT re-pasted into the live project (only matters if `runAllTests` is run there).

**2026-09-25** (`57e5545`): TEST MODE hardening after a real incident — a Step 10 live verification run (TEST MODE, 2026-09-24 10:16) wrote real-looking `AllIssues_Log` rows with the TESTER as recipient, so that day's real 17:00 run skipped every region (managers never got the report) and the next morning's Checkpoint 1 (which reuses the STORED 17:00 recipient) went to the tester instead of managers — 9 of 26 digests. Also found: the CH-level reports and a Section-2-only bucket ignored TEST MODE (real addresses). Added `FN-283`/`FN-284` (+10 lines, 570L → 580L; every `#Lnn` after line 71 re-mapped). Behaviour changes live in `GS-001`/`GS-010`; `Tests_AllIssuesEmailer.gs` +3 and `Tests_EmailLifecycleFullCycle.gs` +23 assertions (verified to fail against the pre-fix code).

**2026-09-25, later** (`684956b`): supersedes the per-region Futwork buckets described above — Futwork leads from EVERY region now share ONE pseudo-region (`CFG-068`), so each job sends ONE Futwork email. Regions stay separate inside it as bands (`sectionsByRegionGs_`), spelled out at the top (`regionHeaderOptsGs_`, the header line + the subject, e.g. "Futwork (Bangalore, Pune) google Leads With Issue"). `renderOvernightReportEmailHTML_` gained two optional inputs, `opts.regionLabel` (replaces the "Region:" line) and `section.regionBand` (a bar above a section). Rows logged before this change (one per real region, `bucket_label` 'Futwork') are re-keyed into the single group when the next 10:00/13:00 loads them, each entry stamped with its row's real region; and the two merges are now de-duplicated by `lead_id` (`FN-294`) — a plain concat repeated every lead once per row, which is what pushed the 2026-09-25 13:00 Checkpoint 2 write past Sheets' 50,000-character cell limit. +44 lines (580L → 624L; anchors re-mapped). New rows `FN-290`..`FN-294`, `CFG-068`; `Tests_EmailInfra.gs`, `Tests_AllIssuesEmailer.gs`, `Tests_EmailLifecycleFullCycle.gs` cover it (18 of them fail with the grouping disabled). **Deployed live 2026-09-25**: `EmailInfra.gs`, `AllIssuesEmailer.gs` and `OvernightEmailer.gs` were each edited in the Sheet's Apps Script editor from the committed diff and verified after a full reload by SHA-256 against the committed files (`9f08cfd5…1683`, `7ac150c3…d6cb`, `7a13ef06…4886`). No `setupXxx()` re-run needed (no trigger changed); first effect at tomorrow's 10:00 (Section 1/2 + legacy re-keying) and 17:00.

**2026-09-25, evening** (`b3a58f9`): 13:00 crash hardening. The 13:00 `sendOvernightFollowupEmails` aborted after 3 of ~26 buckets with "Your input contains more than the maximum of 50000 characters in a single cell" — Sheets reports a bad write on the NEXT sheet call, which sat outside every caller's try/catch. Three layers now: (1) `writeUnlessTestModeGs_` flushes inside the retry so the error surfaces inside the guarded write (`FN-283`); (2) every JSON log-cell write goes through `jsonForCellGs_` (`FN-295`, `CFG-069`), so an oversize list is truncated with one ops alert instead of attempted; (3) `GS-010`'s 10:00 and 13:00 loops catch a per-bucket throw, report it and carry on with the other buckets. The trigger for the incident (polluted test rows + the merge duplicating leads) is fixed separately (`FN-294`). +21 lines (624L → 645L; anchors re-mapped). `Tests_EmailInfra.gs` +13, `Tests_EmailLifecycleFullCycle.gs` +14 assertions; the isolation tests fail if the per-bucket handlers re-throw. **Deployed live 2026-09-25**: the three files were edited in the Sheet's Apps Script editor from the committed diff and verified after a full reload by SHA-256 (`daa128d3…6f38`, `f9622bff…6368`, `e0f30efe…2227`). No `setupXxx()` re-run needed; first effect at tomorrow's 10:00.

**2026-09-26** (`5aafbd4`): region P&L head Cc. `resolveRecipientEmailsForRegion_` looks up the region's P&L head address (`regionPnlHeadEmailGs_`, `FN-300` - by NAME from Manager_Directory, so no address is committed to the public repo) and runs each regular bucket's Cc (and the legacy fallback bucket's) through `withRegionPnlHeadCcGs_` (`FN-298`) using `REGION_PNL_HEAD_CC_` (`CFG-070`): Hyderabad and Bangalore emails Cc Mukesh Mishra (the export's P&L owner for both teams; he was already Cc'd on Bangalore as Cluster Head, Hyderabad had Zoya Fathima only). A name with no Manager_Directory address adds no Cc and logs a line. Not applied to the CH-level backstop or the Futwork bucket (no Cc by design), and TEST MODE still sends with no Cc (the P&L head shows only in the test email's own "would have gone to" line). +35 lines (645L → 680L). Tests: `Tests_EmailInfra.gs` (Cc added / not duplicated / not the To / legacy path / no Cc for backstop and Futwork / TEST MODE), `Tests_EmailLifecycleFullCycle.gs` (Cc'd at 17:00, stored, carried through 10:00 and 13:00), `Tests_Mocks.gs` (`REGION_PNL_HEAD_CC_` reset to `{}` during tests). Not live until pasted.

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
