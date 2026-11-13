# Lead-check logic audit — line-by-line, both runtimes (2026-11-13)

**Scope.** The logic that decides whether a lead is "checked" as an issue: the five SLA rules, the
open/closed/Opportunity+ classification they sit on, the per-customer call pooling, the transferred-row
drop, the comment-timestamp extraction they read, and the priority picker — on BOTH runtimes
(`js/core-lead-model.js` `enrichLead` + helpers vs `SlaEngine.gs` `computeSlaFlags_` + `Core.gs` /
`EmailInfra.gs` / `FollowupEngine.gs` helpers), plus every place the dashboard re-states a rule for
display. Read at HEAD `3552b57`. **Status 2026-11-13:** F1 and F2 fixed in `49aaddc`; the sweep that followed found the same stale rule text in four Call SLA tooltips, the Operations section summary and the Behind-on-calls email intro, fixed in `684f225` (all browser + tooling; no `.gs` file touched, nothing to paste). F3-F8 open; the `.gs`-side stale comments in F6 (`SlaEngine.gs:35,114-116,281-285`) are left for the next deploy that touches that file.

**Mechanical checks run first (all green):**

| Check | Result |
|---|---|
| `python3 test/check-runtime-parity.py` | 16 plain pairs, 1 regex pair, 1 prod-safety pair, 2 rule sets — only the known-intentional `HEADER_ALIASES` 2 browser-only keys |
| `python3 test/check-twin-behaviour.py` | 812 comments, both classifiers agree on every one |

---

## 1. Findings, most important first

### F1 — Operations cards print the OLD call requirement and the lead's own counter, while the flag uses the new per-customer rule  (CONFIRMED, dashboard-internal contradiction)

- `js/core-ui.js:114` — `renderAlertCard` prints `${l.call_attempts}/${requiredCalls} attempts`.
- Callers `js/overview-distribution-people-ops.js:1148` (approaching 48h), `:1180` (stuck), `:1222`
  (Not Updated) pass `CONFIG.MIN_CALLS_AFTER_48H` (10) or `CONFIG.MIN_CALLS_PER_DAY` (3), chosen by
  `past48h`.
- The rule itself (`js/core-lead-model.js:445-450`, twin `SlaEngine.gs:202-206`) flags on the
  **customer's pooled total** against **5 within 24 h of the customer's first assignment, 10 after**.

Concrete contradictions a user can see today:

| Lead | Flag says | Card chip says |
|---|---|---|
| 20 h old, own `call_attempts` 2, sibling lead has 4 → pooled 6 | not behind (6 ≥ 5) | `2/3 attempts` in amber |
| 30 h old, own 4, no sibling → pooled 4 | behind (4 < 10) | `4/3 attempts` (looks fine) |

The "Behind on Today's Calls" card itself was already corrected (`:1110` prints
`customerCallTotal/callTarget calls (all RMs)`); the other three cards were not. The comment at
`:1071` still says "under 3 calls (CONFIG.MIN_CALLS_PER_DAY)".

**Fix (small):** have `renderAlertCard` print `l.customerCallTotal/l.callTarget` (both are already on
the enriched lead) and drop the `requiredCalls` parameter; then `CONFIG.MIN_CALLS_AFTER_48H` and
`CONFIG.MIN_CALLS_PER_DAY` / `MIN_CALLS_PER_DAY_` have no readers left (see F6).

### F2 — The parity tool does not cover the SLA rule data at all  (CONFIRMED tooling gap; values match today)

`test/check-runtime-parity.py` `PLAIN_PAIRS` (lines 251-272) has **no entry** for any of:

| Browser (`js/core-foundation.js` `CONFIG.*` / top level) | Apps Script |
|---|---|
| `STAGE_ALIASES` | `STAGE_ALIASES_` (`Core.gs:79`) |
| `CLOSED_STAGE_EXACT`, `CLOSED_STAGE_STEMS` | `CLOSED_STAGE_EXACT_`, `CLOSED_STAGE_STEMS_` (`Core.gs:91-92`) |
| `OPPORTUNITY_STAGE` | `OPPORTUNITY_STAGE_` |
| `LEAD_GRACE_HOURS`, `LEAD_LIFECYCLE_HOURS`, `FOLLOWUP_REVIEW_HOURS` | `LEAD_GRACE_HOURS_`, `LEAD_LIFECYCLE_HOURS_`, `FOLLOWUP_REVIEW_HOURS_` (`SlaEngine.gs:33-88`) |
| `MIN_CALLS_24H`, `MIN_CALLS_48H` | `MIN_CALLS_24H_`, `MIN_CALLS_48H_` |
| `WORK_START_HOUR`, `WORK_END_HOUR` | `WORK_START_HOUR_`, `WORK_END_HOUR_` |
| `ISSUE_PRIORITY` (key order) | `ISSUE_PRIORITY_GS_` |

`HANDOVER.md` §6 row 2 ("Stage / SLA-flag config (thresholds, FUNNEL_ORDER)") reads as if the pair is
checked; only `FUNNEL_ORDER` is. I compared every one of the above by eye at HEAD: **all identical.**
The risk is the next edit — a threshold changed on one side (the 2026-10-19 5→3 and 2026-11-02 5/10
changes were exactly this shape) is invisible to the tool. The script's `extract_named_value` already
handles the `CONFIG.X:` property form (`prop_re`), so each row is one tuple in `PLAIN_PAIRS`.

### F3 — Two different labels for the same `stageStuck48h` issue  (CONFIRMED, no live break today)

`ISSUE_PRIORITY` (`js/core-foundation.js:125`) labels it "Leads Pending Beyond 48 Hours (Not Yet
Opportunity)". Every other label source — `ISSUE_PRIORITY_GS_` (`SlaEngine.gs:218`),
`RM_PERF_RULES` / `_GS_`, `js/tab-tracking.js:14`, `js/overview-distribution-people-ops.js:582` — says
"Stuck 48h+". Traced every sheet the browser writes a label to: `SLA_History` stores per-KEY counts
(no label), `Send_Log.issue_label` is browser write-only. Nothing on the `.gs` side compares a
browser-written label, so nothing breaks. But `LEGACY_ISSUE_LABELS_GS_` has no mapping for the long
form, so the day a browser label lands in a `.gs`-read column (a `Lead_Followups` issue column, a
merged log) it will fail the `canonicalIssueLabelGs_` compare silently. Advisory.

### F4 — Customer-level merged records run the SLA clock from the earliest copy, closed copies included; the dashboard's `SLA_History` rows count THAT population while Apps Script's count per row  (DESIGN, needs a yes/no)

`mergeRowsIntoOneLead` (`js/core-fetch-and-render.js:364-460`) sets the merged record's
`lead_assigned_at` to the **earliest over all copies** (closed and Opportunity+ included),
`call_attempts`/`callAttemptsByLeadId` over all copies, and copies the N-4 pool stamps only from the
`primary` row. Consequences:

1. **Issue surfaces are safe.** `issueLeads` is built from `copySplits` — one `mergeRowsIntoOneLead([row])`
   per distinct lead id (`:532`) — so the five flags on Operations / Tracking / Reports / emails are
   per row, same as `computeSlaFlags_`. Matches.
2. **`SLA_History` written by the dashboard is a different population from the one written by Apps
   Script.** `js/core-filters.js:170-184` enriches `allParsedLeads` (merged customers) and counts
   flags there; `MovementTracker.gs` `writeSlaHistorySnapshot_` counts per row. Both land in the same
   tab (`source` = 'Dashboard' / 'AppsScript'). The Tracking tab's trend therefore mixes
   per-customer and per-row counts, and the merged customer's flags use the earliest assignment across
   copies. Verify this is intended (the `source` column suggests it was known); if not, the dashboard
   writer should count `issueLeads`-style splits.
3. **N-4 fallback re-opens the "closed sibling lends its calls" case on merged records.** When the
   `primary` row was left out of the pool (an older enquiry while a newer open lead exists),
   `customerCallTotalAll` is undefined and `js/core-lead-model.js:445-448` falls back to summing
   `callAttemptsByLeadId` over **every** copy, closed ones included, with `customerAgeHours` falling
   to the merged (earliest) age. Row-level evaluation has no such path. Only customer-level views see it.

### F5 — The checkpoint's "a move INTO Behind is never escalated" exemption rests on a rule that no longer exists  (LOW, product decision)

`SlaEngine.gs:370-374` justifies the exemption with "counts calls since IST midnight against a
full-day minimum, so at 10:00/13:00 most leads read as behind". Since 2026-11-02 the rule is
cumulative from first assignment; a 10:00 "Behind" is a real deficit. The only move the exemption can
affect is Stuck 48h+ (rank 4) → Behind (rank 3), which with a monotonic counter can only happen when
pool membership changes (a sibling closes and its calls leave the pool). Harmless either way, but
`HANDOVER.md` §4.3.10 still states it as a live rule. Decide: keep and reword the comment, or remove.

### F6 — Stale comments and orphaned constants that will mislead the next edit  (doc-only)

| Where | Says | Reality |
|---|---|---|
| `SlaEngine.gs:114-116` (DR-10) | `DailyRmIssueLog.gs` "still reads lead_assigned_at as Date cells only; should use parseSlaDateGs_" | `rmPerfDateCellGs_` (`DailyRmIssueLog.gs:1379`) already delegates to `parseSlaDateGs_` — fixed, note stale |
| `SlaEngine.gs:281-285` | `baselineMap` "needed for underCalledToday's isCreatedToday === false branch" | `baselineMap` is no longer read (`:201`) |
| `js/core-lead-model.js:400-414` | describes the per-day delta/baseline as the rule | display-only since 2026-11-02 (`:442-444` says so, the block above still reads as the rule) |
| `js/overview-distribution-people-ops.js:1071` | "under 3 calls (CONFIG.MIN_CALLS_PER_DAY)" | rule is 5/10 pooled |
| `CONFIG.MIN_CALLS_AFTER_48H` (`js/core-foundation.js:37`) | — | read only by F1's three wrong call sites |
| `CONFIG.MIN_CALLS_PER_DAY`, `MIN_CALLS_PER_DAY_` | "only the dashboard twin still uses a per-day count" | after F1, no reader at all |

### F7 — Substring stage matching is a latent trap on BOTH sides  (OBSERVATION, could not verify against live vocabulary)

`canonicalStage` / `canonicalStage_` match aliases with `indexOf`. 'visit' matches "Visit Not Done" /
"No Visit"; 'booked' matches "Not Booked"; 'eoi' matches any word containing it. Such a stage would read
Opportunity+ → `isOpenLead` false → **zero SLA flags on both runtimes** (consistent, and consistently
wrong). `docs/sheets/SHEET-001-leads.md` does not list the real `current_stage` vocabulary, so this
could not be checked from the repo. A one-off distinct-`current_stage` dump from the sheet settles it.

### F8 — Stuck 48h+ reaches the email for about one day, the dashboard forever  (DESIGN, confirming)

`AllIssuesEmailer.gs:73` `ALL_ISSUES_WINDOW_DAYS_BACK_ = 2` (today + 2 calendar days). A lead becomes
Stuck after 48 h, so it is emailable only on roughly its third calendar day, then leaves the window
while `stageStuck48h` stays true on the dashboard. `HANDOVER.md` §4.3.10 states the window; this is
just confirming the asymmetry is designed, not a drift.

---

## 2. What was checked and found CONSISTENT (so nobody re-checks it)

| Area | Browser | Apps Script | Verdict |
|---|---|---|---|
| Open lead = not closed, not Opportunity+ | `isLeadClosed` + `isOppOrAbove` (`core-lead-model.js:104-175`) | `isOpenLead_` (`Core.gs:141`) | same, incl. closing-reason fallback |
| Closed-stage word split (apostrophe kept, multi-word phrase, stem prefix) | `isClosedStage` `:141-161` | `isClosedStage_` `:125-136` | same algorithm |
| Stage aliases, order, first-match substring | `canonicalStage` `:83-91` | `canonicalStage_` `:94-106` | same (data equal, see F2 for the tooling gap) |
| Date parsing (Date cell / `YYYY-MM-DD HH:MM[:SS]` as IST / bare date / explicit zone) | `parseDate` `:52-81` | `parseSlaDateGs_` (`SlaEngine.gs:96-107`) | same three branches |
| Grace, lifecycle, boundaries | `>= 3`, `<= 48`, `> 48` | same | same |
| Inactive-RM: today (IST) ∧ `rm_is_active` ∈ {false,no,inactive,0,n}, no grace, checkbox `false` preserved | `:534-536` | `:146-149` | same |
| Not Updated: open ∧ past grace ∧ canonical stage 'not updated', not 48h-gated | `:473` | `:181` | same |
| No follow-up 4 h: open ∧ ≤48h ∧ past grace ∧ connected ∧ stale > 4 h from LATEST of last comment / last connect, else from assignment | `:486-492` (min of hours-since) | `:189-194` (max of touch times) | equivalent |
| Comment timestamps: split on `\|`, regex requires `Name: text - YYYY-MM-DD HH:MM`, two columns only, IST | `parseActionLog` (`core-outcome-engine.js:81-101`) over `internal_status_comments` + `stage_comments` | `parseDatedCommentEntries_` (`FollowupEngine.gs:56-72`) | same regex, same columns |
| Behind on calls: open ∧ past grace ∧ max(pooled, own) < (customer age ≤ 24 h ? 5 : 10) | `:445-450` | `:202-206`, `customerCallProgressGs_` `:47-54` | same |
| Pooling: key `client_id` else `l:lead_id`; open rows only; 48 h cutoff from newest open assignment; undatable open row pooled; max per distinct lead id; earliest assignment; unpooled row falls back to own | `indexCustomerCallTotals` `:271-297` | `indexCustomerCallTotalsGs_` `:60-87` | same |
| Pipeline order: drop transferred rows → pool → evaluate; pooling over the WHOLE tab before any source/filter | `core-fetch-and-render.js:209-210` | `readLeadsTab_` (`EmailInfra.gs:1637-1638`) | same |
| Transferred-row drop: ≥2 RMs, all datable, single latest RM, latest holder active, drop only older copies whose RM is inactive | `dropTransferredLeadRows` `:246-262` | `dropTransferredLeadRowsGs_` (`EmailInfra.gs:1650-1675`) | same |
| Stuck 48h+: open ∧ > 48 h ∧ past grace | `:455` | `:152` | same |
| Priority order and the first-match picker | `ISSUE_PRIORITY`, `reportableIssueFor` (`reports-build.js:654-673`) | `ISSUE_PRIORITY_GS_`, `primaryIssueGs_` | same order; 4 of 5 labels equal (F3) |
| Legacy label "Follow-up Overdue" canonicalised at every `.gs` compare/show site | — | `canonicalIssueLabelGs_` used at `SlaEngine.gs:287,344`, `OvernightEmailer.gs:628,651,2170,2172` | complete |
| RM-performance eligibility gates (created that day / past grace / ≤48h ∧ connected) | `RM_PERF_RULES` (`core-rm-performance.js:188-199`) | `RM_PERF_RULES_GS_` (`DailyRmIssueLog.gs:1225-1231`), `computeRmPerfEligibilityGs_` | same, now sharing `parseSlaDateGs_` |
| `SLA_History` column order (A date … D-H the five keys in priority order … I snapshot_at, J source) | `upsertSlaHistoryRows` (`sheets-writeback.js:356-396`) | `SLA_HISTORY_COLUMNS_` (`MovementTracker.gs:418-422`) | same (population differs, F4) |
| IST day boundary | `istSameDay` / `istParts` | `istDayKeyGs_` | same |

---

## 3. Suggested order of work (not started)

1. **F1** — one-line change in `renderAlertCard` + three call sites; extend `tests/frontend-harness.html`
   with a card-text assertion. Removes the only live user-visible contradiction.
2. **F2** — add ~12 tuples to `PLAIN_PAIRS` (and `ISSUE_PRIORITY` as a ruleset pair on `key`); update
   `HANDOVER.md` §6 row 2 to say what is actually checked.
3. **F6** — comment/constant cleanup, same commit as F1.
4. **F4 (2)** — decide whether the dashboard's `SLA_History` writer should count per row; if yes, build
   its tally from the copy splits. **F4 (3)** — in the merged-record fallback, sum only copies that are
   open (same test the pool uses).
5. **F3 / F5** — product decisions; cheapest is to align the `ISSUE_PRIORITY` label to "Stuck 48h+"
   (it is only a display string; nothing persists it) and reword or remove the SE-1 exemption.
6. **F7** — pull distinct `current_stage` values once and confirm none contain "visit"/"booked"/"eoi"
   in a negating phrase.

Everything above that touches a `.gs` file is not live until pasted (deploy register in
`docs/STALENESS_TRACKER.md`); F1/F2/F6 are browser- and tooling-only.
