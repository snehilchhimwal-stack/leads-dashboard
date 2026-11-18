# Lead-check logic audit — line-by-line, both runtimes (2026-11-13)

**Scope.** The logic that decides whether a lead is "checked" as an issue: the five SLA rules, the
open/closed/Opportunity+ classification they sit on, the per-customer call pooling, the transferred-row
drop, the comment-timestamp extraction they read, and the priority picker — on BOTH runtimes
(`js/core-lead-model.js` `enrichLead` + helpers vs `SlaEngine.gs` `computeSlaFlags_` + `Core.gs` /
`EmailInfra.gs` / `FollowupEngine.gs` helpers), plus every place the dashboard re-states a rule for
display. Read at HEAD `3552b57`. **Status 2026-11-13:** F1 and F2 fixed in `49aaddc`; the sweep that followed found the same stale rule text in four Call SLA tooltips, the Operations section summary and the Behind-on-calls email intro, fixed in `684f225` (all browser + tooling; no `.gs` file touched, nothing to paste). F4 (2) fixed in `5acba65` (the dashboard's SLA_History snapshot now counts per lead copy; user decision). F3 and F5 fixed in `3456be8` on 2026-11-16 (F5 pasted live and verified, `780f81a`). F4 (3) fixed in `08c69a2` on 2026-11-18 (browser only). F7 checked live 2026-11-18: clear (`b33e7f1`). F8 decided 2026-11-18: option 2, built in `a2988a3` (stale block reaches days 4-7; NOT live until pasted). Open: the `.gs`-side stale comments in F6 (`SlaEngine.gs:35,114-116,281-285`) are left for the next deploy that touches that file.

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
   **Corrected 2026-11-18:** not only customer-level views. A group whose rows share ONE lead id (the same lead
   under two RMs) gets no per-copy split, so its merged record is itself the issue unit and this reached the
   Operations cards and `SLA_History` too. A second leak was found while fixing: `enrichLead` floored the
   pool total with the merged `call_attempts` (max over every copy), so a closed copy's counter cleared the
   customer even when the primary WAS pooled. Both fixed in `08c69a2` (`customerCallStampForGroup`).

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

### F7 — Substring stage matching is a latent trap on BOTH sides  (CHECKED 2026-11-18 against the live sheet: nothing misreads today)

`canonicalStage` / `canonicalStage_` match aliases with `indexOf`. 'visit' matches "Visit Not Done" /
"No Visit"; 'booked' matches "Not Booked"; 'eoi' matches any word containing it. Such a stage would read
Opportunity+ → `isOpenLead` false → **zero SLA flags on both runtimes** (consistent, and consistently
wrong). `docs/sheets/SHEET-001-leads.md` does not list the real `current_stage` vocabulary, so this
could not be checked from the repo. A one-off distinct-`current_stage` dump from the sheet settles it.

**Checked 2026-11-18 against the live `leads` tab (6,610 leads; read-only, only grouped values and counts left the page).**

| What the matcher reads | Live values | Result |
|---|---|---|
| `current_stage` | 5: Suspect 4206, Opportunity 991, Closed 990, Not Updated 418, Booked 5 | every value maps exactly (Booked -> booking via its own alias, Closed -> closed stem). No negating phrase, no unrecognised stage |
| `lead_closing_reason` (the sheet's disposition) | 34 dropdown values (Not Enquired, Low Budget, Already Bought, Not interested, ...) | none contains a stage word; none maps to a funnel stage |
| `closing_reason` (RM-entered) | 2,110 rows, each a log line "RM: reason - timestamp" whose reason part is the same dropdown | never used: every row that has one also has a disposition, which wins in `isOppOrAbove` / `isBookingLead`. Even if used, 0 of 2,110 would map |

So no open lead loses its SLA flags to this, and bookings come only from the 5 "Booked" stages. Side observation: the
CRM export carries only these 5 stages, so the dashboard funnel's Visit Booked / Visit / Pipeline / EOI / Soft Booking
tiers are structurally empty (they read 0 because nothing feeds them, not because no lead got there).

**The trap stays latent**: a new CRM stage such as "Visit Not Done" would still be read as a later funnel stage on both
runtimes. No code change now; instead a 30-day watch row in `docs/STALENESS_TRACKER.md` ("Live stage vocabulary vs
`STAGE_ALIASES`") re-runs this check with the snippet below.

```js
// F7 re-check: run with javascript_tool in a tab on the production Sheet (signed in). Read-only: one grouped
// read of columns S (current_stage) and O (lead_closing_reason) of `leads`; only distinct values + counts
// come back. Re-check the column letters first if the header (row 2) ever changes.
const KNOWN_STAGES = ['booked', 'closed', 'not updated', 'opportunity', 'suspect'];
const FUNNEL_ORDER = ['not updated','suspect','opportunity','visit booked','visit','pipeline','gross eoi application','soft booking','booking'];
const STAGE_ALIASES = { 'not updated': ['not updated'], 'suspect': ['suspect'], 'opportunity': ['opportunity'],
  'visit booked': ['visit booked', 'visit booking', 'visit scheduled'], 'visit': ['visit', 'revisit', 'hpop', 'video presentation', 'video call'],
  'pipeline': ['pipeline'], 'gross eoi application': ['gross eoi application', 'gross eoi', 'eoi application', 'eoi'],
  'soft booking': ['soft booking', 'soft book'], 'booking': ['booking', 'booked'] }; // copy of CONFIG (parity-checked)
const canon = v => { const s = String(v).trim().toLowerCase(); if (!s) return null;
  for (const c of FUNNEL_ORDER) if ((STAGE_ALIASES[c] || [c]).some(a => s === a || s.indexOf(a) !== -1)) return c; return null; };
const id = '1QmYB1VqLMisiQXoed6-vSQqgA9nroGIMHsBInZafKGU';
const csv = await (await fetch(`/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=leads&range=A3:AC&headers=0&tq=` +
  encodeURIComponent('select S, O'), { credentials: 'include' })).text();
const stages = {}, dispositions = {};
csv.split('\n').forEach(line => { const m = line.match(/^"((?:[^"]|"")*)","((?:[^"]|"")*)"/); if (!m) return;
  const st = m[1].trim(), dp = m[2].trim(); if (st) stages[st] = (stages[st] || 0) + 1; if (dp) dispositions[dp] = (dispositions[dp] || 0) + 1; });
({ newStages: Object.keys(stages).filter(s => !KNOWN_STAGES.includes(s.toLowerCase())).map(s => [s, stages[s], canon(s)]),
   dispositionsReadAsAStage: Object.keys(dispositions).filter(d => canon(d)).map(d => [d, dispositions[d], canon(d)]),
   stages, dispositionCount: Object.keys(dispositions).length })
// Clear when newStages and dispositionsReadAsAStage are both empty. Anything listed: read it as a person would, and
// if canonicalStage misreads it, fix STAGE_ALIASES / the matcher in BOTH runtimes (Core.gs + js/core-foundation.js).
```

### F8 — An open lead stops being emailed after its fourth day; the dashboard keeps it until the export drops it  (INVESTIGATED 2026-11-18: needs a product decision)

`AllIssuesEmailer.gs:73` `ALL_ISSUES_WINDOW_DAYS_BACK_ = 2` (today + 2 calendar days). A lead becomes
Stuck after 48 h, so it is emailable only on roughly its third calendar day, then leaves the window
while `stageStuck48h` stays true on the dashboard. `HANDOVER.md` §4.3.10 states the window; this is
just confirming the asymmetry is designed, not a drift.

**Investigated 2026-11-18.** Two corrections to the line above, then the facts.

- *"The dashboard forever" is wrong.* The live `leads` tab holds exactly 7 calendar days of assignments (read
  2026-11-18: rows assigned 12–18 Nov only, 6,610 leads). The dashboard and every email read only that tab, so a
  lead disappears from BOTH once it is 7 days old. This horizon is not documented anywhere in the repo
  (`docs/sheets/SHEET-001-leads.md`, `HANDOVER.md`); whether the export is always exactly 7 days was observed
  once, not confirmed with whoever owns the export.
- *It is not only Stuck.* The window drops an open lead whatever its issue.

**When an open, flagged lead is emailed** (code: `allIssuesWindowGs_`, `computeAllIssuesCheckpointGs_` called from
`OvernightEmailer.gs:801` and `:1837`, which re-check the previous 17:00 list with no age limit):

| Lead's calendar day (IST) | 17:00 email | 10:00 / 13:00 next-day re-check | Dashboard |
|---|---|---|---|
| 1–3 | yes, every day | yes, for whatever the previous 17:00 email listed | yes |
| 4 | no | yes: last email is the 13:00 re-check | yes |
| 5–7 | no | no | yes |
| 8+ | no | no | no (gone from the export) |

"Stuck 48h+" itself can be a lead's label in the 17:00 email on one day only, day 3, and only when it was
assigned before 17:00 on day 1 and nothing outranks it (stage not "Not Updated", and the customer's pooled calls
at 10 or more; otherwise it is listed as Behind on Today's Calls).

**Live picture, 2026-11-18** (email scope = Google Non-UTM/Search; open = stage Suspect or Not Updated with no
closing reason; read-only grouped counts):

| Assigned | Open leads | Last email |
|---|---|---|
| 16–18 Nov | 204 | still inside the 17:00 window |
| 15 Nov | 50 | today's 10:00 / 13:00 re-check, then none |
| 12–14 Nov | 118 | none; still flagged on the dashboard |

The 168 open leads assigned 12–15 Nov sit with 79 different RMs. All are Suspect (no "Not Updated").

**Why the window is 3 days.** It began as a rolling 48 h and was widened on 2026-08-28 (`ba2f8a9`) to "today plus
the 2 days before" after a reported undercount; the two-checkpoint redesign kept it unchanged. Nothing records a
decision about leads still open after the window. One recorded decision points the other way: Email Ops **D8**
(2026-10-10) defines a stale lead (no update for more than 24 h) "no matter when it was created or assigned", and
puts stale leads in a block at the bottom of every email, but `splitStaleSectionsGs_` only re-sorts leads already
inside the email's scope, so a quiet lead on day 4–7 is never in any email.

**Decision 2026-11-18: option 2** (user), built in `a2988a3` - `GS-001` RULE-093. One refinement over the option text: an older stale lead becomes an ordinary member of its 17:00 bucket, so it also gets the next day's 10:00 / 13:00 re-check (the snapshot carries it); leaving it out would have left an older-only bucket with an empty snapshot, which the 10:00 job skips and the follow-up tracker would then call OVERDUE.

**Options (as offered):**

1. **Keep as is and record it.** The emails are the 0–72 h tool; days 4–7 live on the dashboard (Operations,
   Morning Brief's 48h failure rate, Repeat Offenders). Cost: a sentence in `HANDOVER.md` §4.3.10.
2. **Extend only the stale block to days 4–7** (recommended). The 17:00 email's bottom block would also list open
   in-scope leads assigned 3–6 days ago that are stale (no update for more than 24 h), to the same recipients; the
   main tables keep the 3-day scope. This is what D8's wording describes, and it stops at the export's 7 days
   anyway. Upper bound today: 168 leads (how many of them are stale was not counted: that needs the Movement_Log
   comparison the emailer itself does). Cost: `AllIssuesEmailer.gs` + `StaleLeads.gs` change with tests, then a
   live paste.
3. **Widen the whole window to the export's 7 days.** Every older open lead returns to the main tables: about
   372 leads instead of 204 today, mostly Stuck / Behind rows the RM has already seen for 3 days.

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
   in a negating phrase. **Done 2026-11-18: clear** (5 stages, 34 dispositions, nothing misreads); re-checked every 30 days via the watch register.

Everything above that touches a `.gs` file is not live until pasted (deploy register in
`docs/STALENESS_TRACKER.md`); F1/F2/F6 are browser- and tooling-only.
