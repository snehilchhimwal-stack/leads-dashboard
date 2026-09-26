# Two-Checkpoint Daily Email Lifecycle — Architecture

Design for extending the existing 10:00/13:00 Overnight cycle and 17:00
All-Issues report so the 17:00 population gets followed up **twice**
(10:00 Checkpoint 1, 13:00 Checkpoint 2) without disturbing the existing
Overnight logic at all. Full spec pasted by the user 2026-09-23; this
document is Step 1/11 of the tracked build (`t-tf-50352bf772b4`, goal
`g-tf-fc7cc3383b`). Grounded throughout in the real code
(`OvernightEmailer.gs`, `AllIssuesEmailer.gs`, `SlaEngine.gs`,
`EmailInfra.gs`, `RmHierarchy.gs`) — every function/column/constant named
below is real, not assumed. Tag: `email-lifecycle-redesign`.

**One fact that shapes every decision below, stated up front**: this
project already has a proven, working template for exactly this kind of
"log the send, re-check later, reply into the same thread" cycle —
`Overnight_Log` (`OvernightEmailer.gs:106`) does precisely that for the
existing 10:00→13:00 pair. Every new piece of state below is a
deliberate extension of that same pattern applied to the 17:00
population, not a new mechanism invented from scratch.

---

## Part 1 — Final Daily Timeline

```
Day 1, 17:00 IST ─── PRIMARY All-Issues report (AllIssuesEmailer.gs)
   │                 Scope: google + Non-UTM/Search, assigned in the
   │                 last 3 calendar days. Persists a snapshot per
   │                 manager bucket (AllIssues_Log, extended — Part 5).
   │
   │        ┌────────────────── CHAIN A: Overnight ──────────────────┐
   │        │  (10:00 → 13:00, same day, existing logic unchanged)   │
   │        └──────────────────────────────────────────────────────-─┘
   │
   │        ┌───────── CHAIN B: All-Issues follow-up ─────────┐
   │        │  (17:00 snapshot → next 10:00 → next 13:00)      │
   │        └──────────────────────────────────────────────────┘
   ▼
Day 2, 10:00 IST ─── COMBINED email, per manager bucket
   │   Section 1 = Overnight (Chain A, leg 1) — unchanged logic
   │   Section 2 = All-Issues Checkpoint 1 (Chain B, leg 2 — compares
   │               Day 1 17:00 snapshot to NOW)
   ▼
Day 2, 13:00 IST ─── COMBINED email, per manager bucket, SAME Gmail
   │                 thread as this bucket's own 10:00 email
   │   Section 1 = Overnight Follow-up (Chain A, leg 2) — unchanged logic
   │   Section 2 = All-Issues Checkpoint 2 (Chain B, leg 3 — compares
   │               Day 1 17:00 snapshot AND the 10:00 checkpoint to NOW,
   │               incremental)
   ▼
Day 2, 17:00 IST ─── NEW PRIMARY All-Issues report — cycle repeats
```

**The two chains are independent and must stay that way** (spec
Section 8, "do not merge the two tracking lifecycles"). Chain A already
exists and is untouched. Chain B is the new work. They only ever meet
at the *delivery* layer — the same physical email carries one leg of
each — never in the data that produces them.

---

## Part 2 — 10:00 Email Structure

```
Section 1 — OVERNIGHT
  (existing sendOneOvernightEmail_ content, byte-for-byte unchanged:
   same KPI cards, same Lead ID / Status / Suggested Follow-up columns,
   same "assigned 17:00→09:00, OR flagged, OR already Opportunity+" scope)

Section 2 — PREVIOUS DAY 17:00 ALL-ISSUES FOLLOW-UP — CHECKPOINT 1
  Purpose: close the first part of yesterday's 17:00 cycle by showing
  what happened to that snapshot's leads overnight.
  Per lead: Lead ID / Original Issue (17:00) / Current State (now) /
  Suggested Follow-up (only for leads still open+flagged).
  Grouped by RM, same shell as Section 1, clearly re-labeled.
```

A lead may legitimately appear in **both** sections (spec Part 3's own
example) — Section 1 lists it because it has overnight activity,
Section 2 because it was also in yesterday's 17:00 snapshot. These are
two different questions ("what's new since last night" vs "what
happened to yesterday's flagged population") and neither section
suppresses the other's row for the same lead.

**Empty-state rule** (needed because the spec requires Section 1 to
*always* be present, but today's Overnight bucket set and yesterday's
Checkpoint-1 bucket set are not guaranteed to be the same managers —
see Part 7): if a manager bucket has Checkpoint-1 content but zero
overnight leads today, Section 1 still renders, with a fixed placeholder
("No overnight leads for your team today") instead of being omitted.
Same rule in reverse for Section 2 when a bucket has overnight leads but
nothing in yesterday's snapshot.

---

## Part 3 — 13:00 Email Structure

```
Section 1 — OVERNIGHT FOLLOW-UP
  (existing sendOvernightFollowupEmails_ content, unchanged: re-checks
   each of today's 10:00 issue leads against the current sheet; still
   flagged for the SAME issue = unresolved, shown in red)

Section 2 — PREVIOUS DAY 17:00 ALL-ISSUES FOLLOW-UP — CHECKPOINT 2
  Purpose: second and final checkpoint on yesterday's 17:00 population.
  Per lead, only rows that CHANGED since Checkpoint 1 (or are newly
  resolved), not a re-print of every unchanged lead — see Part 6's
  "meaningful progression" rule.
```

Section 1 stays the "normal continuation" of the SAME day's 10:00
Overnight email — it is not touched by this redesign beyond sitting
alongside a new Section 2 in the same message.

---

> **Amended 2026-09-26 (user request: "no need to send email for resolved status,
> only if not resolved then send email").** Wherever this document says a
> checkpoint shows a lead as `resolved` / "newly resolved" (Parts 2, 3, 6), read
> it as superseded: a checkpoint email lists ONLY leads that are still
> unresolved (`still_open` / `category_changed` / `escalated` / `reopened`);
> `resolved` and `not_found` are never listed, and a bucket with nothing
> unresolved in either section gets no email at all. The states are still
> COMPUTED and `checkpoint1_json` still records every lead (resolved included) —
> only the email changed. `checkpoint2_json` holds just the still-unresolved
> leads that were emailed. The single rule is `allIssuesCheckpointIsActiveGs_`
> (`SlaEngine.gs`).

## Part 4 — 17:00 Email Structure

**Unchanged**: scope, the 5 SLA rules and their priority order, the
3-calendar-day window (`allIssuesWindowGs_`, `AllIssuesEmailer.gs:85`),
routing. This stays the authoritative daily SLA report exactly as it is
today — the spec is explicit ("do not remove or downgrade the 17:00
report") and there is no reason to touch working, already-correct logic
just to bolt on a follow-up mechanism.

**One addition**: at send time, `sendOneAllIssuesEmail_`
(`AllIssuesEmailer.gs:420`) persists a per-lead snapshot of exactly what
it reported for that bucket — not just the `lead_count` `AllIssues_Log`
already stores, but the actual `{lead_id, RM, TL, status, issueLabel,
followup}` array, the same shape `flaggedLeads` already carries in
memory at send time (see `byRegion` construction, `AllIssuesEmailer.gs:246`).
This is the one real architectural change (Part 5).

---

## Part 5 — State/Snapshot Design

**Extend `AllIssues_Log` in place** (`ensureAllIssuesLogSheet_`,
`AllIssuesEmailer.gs:100`) rather than building a new sheet — it already
has exactly the right grain (one row per manager bucket per 17:00 run)
and this project's own convention for a growing-but-stable log tab is to
append new columns, never touch existing ones
(`ensureAllIssuesLogSheet_`'s own `missing = headers.filter(...)` logic
already does this for header drift). Existing columns (A–I) — `date`,
`region`, `bucket_label`, `primary_role`, `to`, `cc`, `lead_count`,
`sent_at`, `thread_id` — are untouched.

**New columns, appended:**

| Col | Name | Written by | Shape |
|---|---|---|---|
| J | `issue_snapshot_json` | 17:00 job, at send time | `[{lead_id, RM, TL, status, issueLabel, followup}, ...]` — the exact population this bucket's email reported |
| K | `checkpoint1_json` | 10:00 job | `[{lead_id, state, currentIssueLabel, currentStatus}, ...]` — `state` ∈ `resolved` / `still_open` / `category_changed` / `escalated` / `not_found` |
| L | `checkpoint1_sent_at` | 10:00 job | timestamp — doubles as the idempotency guard for Part 10 |
| M | `checkpoint2_json` | 13:00 job | same shape as K, computed against the 13:00 state, aware of K |
| N | `checkpoint2_sent_at` | 13:00 job | timestamp — idempotency guard |

**Why one wide row instead of a separate checkpoints table**: every
comparison a checkpoint needs (`17:00 snapshot`, `what Checkpoint 1
already found`) lives in the SAME row, at the SAME bucket grain the
routing layer already resolved and logged `to`/`cc`/`thread_id` for —
no join, no second sheet to keep in sync, no risk of the two tables
drifting apart under a partial failure. This mirrors `Overnight_Log`'s
own `lead_ids_json` (an array of `{lead_id, issueKey, issueLabel}`,
`OvernightEmailer.gs:411`) exactly, just widened to two checkpoints
instead of one.

**Overnight's own state is untouched — by Chain B.** `Overnight_Log`
gets no CHECKPOINT columns — no `checkpoint*_json`, no Chain-B content
of any kind — per spec Section 8's explicit instruction to keep the two
lifecycles separate. **Refined 2026-09-23 (Step 8/11):** this does not
mean Chain A's own tracking is frozen forever. Chain A already gained
columns once before this redesign even started (`to`/`cc`/`subject`,
the recipient-storing fix `OvernightEmailer.gs` mentions throughout) for
a purely Chain-A-internal operational need, and Step 8 adds one more —
`followup_sent_at` (col I) — for the SAME reason: the 13:00 job's own
Section 1 (unresolved-lead follow-up) had no per-day-once guard at all,
so a trigger retry resent a duplicate reply into the same thread. This
column carries no Chain-B data, doesn't change what Chain A tracks about
a LEAD, and Section 1's own classification logic is completely unaware
of it — it only gates whether Pass 2 sends at all. "The two chains are
independent" is about not letting Chain B's CONTENT drive Chain A's
logic (or vice versa); it was never a promise that Chain A's own schema
would never evolve for Chain A's own needs, and reading it that way
would have left a real duplicate-email bug unfixable without inventing
an entirely separate state mechanism (PropertiesService, etc.) for one
boolean flag — considered and rejected as disproportionate given
Overnight_Log is already the established, self-healing, proven template
this exact idempotency pattern is built on (see this doc's own opening
paragraph).

---

## Part 6 — Deduplication and Transition Logic

**A lead in both sections is not a duplicate** (Part 2) — Section 1 and
Section 2 answer different questions and both may legitimately list the
same `lead_id`. Never suppress one because of the other.

**Disappearance ≠ resolution.** A lead missing from the current sheet
read, or no longer matching `passesGoogleNonUtmSearchGs_`, is
`not_found` — reported as such, not silently folded into `resolved`.
Only a lead that is genuinely closed, past Opportunity+, or no longer
flagged by `computeSlaFlags_`/`primaryIssueGs_` (the SAME functions
`SlaEngine.gs` already exposes — no new SLA logic) counts as `resolved`.

**Category transitions use the existing priority order** — never a new
one. `primaryIssueGs_` (`SlaEngine.gs:154`) already returns only the
single highest-priority issue for a lead
(`Inactive-RM Lead Added → Not Updated → Follow-up Overdue → Behind on
Today's Calls → Stuck 48h+`); a checkpoint's `currentIssueLabel` is just
this same function's output at comparison time. `category_changed` =
`currentIssueLabel !== issue_snapshot_json`'s original `issueLabel` for
that lead (or, at Checkpoint 2, `!== checkpoint1_json`'s `currentIssueLabel`),
still open. `escalated` is a `category_changed` case where the new
issue's priority index is higher-severity (lower index in
`ISSUE_PRIORITY_GS_`) than the original — a display distinction only, no
new rule.

**Checkpoint 2 is incremental, not a re-diff from 17:00.** It reads
BOTH `issue_snapshot_json` (col J) and `checkpoint1_json` (col K) and
reports:
- leads whose state changed between Checkpoint 1 and now (the
  meaningful case — e.g. `still_open` at 10:00, `resolved` at 13:00),
- leads that reached a `checkpoint1` state of `still_open` /
  `category_changed` / `escalated` and remain so, with the ORIGINAL
  17:00 issue kept in context (per spec Part 4's own example table),
- leads NOT already shown as `resolved`/`not_found` at Checkpoint 1 are
  re-checked; ones already `resolved` at 10:00 are **not** re-sent
  unless they reopened (a real `isOpenLead_` transition back to open —
  rare, but the "reopened" case spec Section 8/11 both name explicitly).

This is what keeps Checkpoint 2 from "recreating the 17:00 table"
(spec Part 4's explicit prohibition).

---

## Part 7 — Threading and Routing

**Routing is unchanged**: `resolveRecipientBucketsForRms_`
(`RmHierarchy.gs:1092`) resolves A1→TM→RH→CH exactly as it does today,
`Region_Recipients` stays the fallback for an unresolved chain, and the
CH safety valve (`notifyChLevelLeadsGs_`/`notifyChLevelIssuesGs_`) is
untouched — a chain that resolves all the way to a real CH with no
intermediate tier, or a CH personally holding a lead, still diverts to
`OPS_ALERT_EMAIL_` + `ashish.ivlekar@homesfy.in` with no CC, never the
normal bucket flow. Normal buckets still CC `ALWAYS_CC_EMAILS_` (Ashish
Kukreja + Saurabh Mishra).

**Known limitation, confirmed during Step 9/11's failure/edge-case
audit: CH-level-diverted leads get NO Checkpoint 1/2 follow-up.** A lead
whose chain resolves all the way to a CH (or a CH personally holding it)
never enters a normal bucket's `resolution.results` — it goes to
`notifyChLevelIssuesGs_` (17:00) instead, which sends its own one-off
report and never appends a row to `AllIssues_Log`. Since Checkpoint
1/2's whole mechanism (`loadYesterdaysAllIssuesBucketsGs_`/
`loadTodaysCheckpoint1PendingGs_`) only ever reads FROM `AllIssues_Log`,
a CH-escalated lead simply has no row to build a checkpoint from — it
gets the immediate 17:00 alert and nothing more, while every OTHER
flagged lead gets 2 additional touchpoints. This was deliberately NOT
fixed here: `notifyChLevelIssuesGs_` sends ONE email per CH covering
potentially several regions/RMs, always to the SAME fixed pair of
addresses (`OPS_ALERT_EMAIL_` + `CH_LEVEL_EMAIL_`) regardless of WHICH
CH — giving it real checkpoint eligibility would require a different
recipient-identity key than the "union by recipient email" pattern
Steps 6-8 are built around (every CH's report currently shares the same
`to`, so keying by email alone would silently merge different CHs'
leads into one combined checkpoint bucket), which is a genuine
structural redesign, not an edge-case fix. Flagged here as a known,
intentional scope boundary rather than a silent gap — worth a dedicated
follow-up if CH-level escalations turn out to need the same follow-up
rigor as everything else in practice.

**Checkpoint routing is frozen at 17:00, not re-resolved.** Checkpoint 1
and 2 go to the `to`/`cc` already stored in that bucket's `AllIssues_Log`
row (columns E/F) — the same person who received the original 17:00
report, not whoever the hierarchy resolves to *today*. This is the exact
mechanism `Overnight_Log` already uses to make the 13:00 follow-up land
with the right person (`sendOvernightFollowupEmails_`'s own comment,
`OvernightEmailer.gs:845`, explains why re-resolving would be wrong) —
reused here deliberately, and it is also the direct, correct answer to
spec Section 11's "manager changes between checkpoints" case: the
follow-up goes to whoever was actually told about the issue, not a
new manager who never saw the original report.

**One Gmail thread per bucket per day, not two.** The spec's own
"ALL-ISSUES FOLLOW-UP THREAD/LIFECYCLE" diagram (17:00→10:00→13:00) is a
**data** lifecycle (tracked via `AllIssues_Log`'s columns J/K/M above),
not a second Gmail thread — Section 2's content is delivered *inside*
the same combined email as Section 1, so there is exactly one thread per
manager bucket per day: the Overnight thread (10:00 original → 13:00
threaded reply, via `sendThreadedGmailReply_`, `OvernightEmailer.gs:801`,
same fallback-to-plain-message behavior if the Advanced Gmail Service
isn't enabled). This is stated explicitly here because the pasted spec
is genuinely ambiguous on this exact point (Section 7's diagram could be
misread as implying a reply into the ORIGINAL 17:00 thread); resolving
it this way is what makes "thread identity tracked per manager bucket"
(spec's own requirement) actually implementable with the existing
one-thread-per-bucket infrastructure, rather than inventing a second
threading mechanism.

**Bucket union, not bucket intersection.** Today's Overnight bucket set
(from `flaggedLeads`/`candidateLeads` assigned in the 17:00→09:00 window)
and yesterday's Checkpoint-1 bucket set (the rows in `AllIssues_Log`
dated yesterday) are resolved independently and are not guaranteed to
name the same managers. The combined send loop iterates the **union**,
keyed by `primaryEmail` (not `primaryName` — the true recipient
identity): a bucket present in only one side still sends, with the
other section rendering its empty-state placeholder (Part 2). This also
means `sendOneOvernightEmail_`'s current early return on `!leads.length`
(`OvernightEmailer.gs:300`) needs to become "return early only if BOTH
sections are empty" — see Part 8.

---

## Part 8 — Implementation Plan

Smallest practical set of changes, in dependency order (matches the
11-step task sequence already tracked under goal `g-tf-fc7cc3383b`):

1. **`AllIssues_Log` schema** — add columns J–N (Part 5). Purely
   additive; `ensureAllIssuesLogSheet_`'s existing missing-header
   backfill already handles this for sheets created before the change.
2. **17:00 job**: `sendOneAllIssuesEmail_` gains one more `appendRow`
   value — `issue_snapshot_json` — built from the `bucketLeads` array
   it already has in scope. No change to what gets sent or to whom.
3. **Checkpoint 1 logic**: new function, e.g.
   `computeAllIssuesCheckpointGs_(ss, snapshotLeads, now, baselineMap)`
   in a shared location (`SlaEngine.gs` or `EmailInfra.gs` — not a new
   file; this is comparison logic, not a new subsystem) that re-reads
   the leads tab for just the snapshot's `lead_id`s, re-runs
   `computeSlaFlags_`/`primaryIssueGs_`, and returns the `state`/
   `currentIssueLabel` array Part 5 describes. Reused verbatim for
   Checkpoint 2 (Part 6's incremental diff is a second pass over this
   same function's output plus the prior checkpoint).
4. **10:00 job**: `sendOvernightMorningEmails_` (`OvernightEmailer.gs:465`)
   — after computing today's Overnight buckets as it does now, also
   read yesterday's `AllIssues_Log` rows, run Checkpoint 1, union the
   bucket sets (Part 7), and call a new two-section send function
   (built by wrapping `renderOvernightReportEmailHTML_` twice with a
   section-divider shell, not by changing that function's signature —
   it has other shapes to preserve). Write `checkpoint1_json`/
   `checkpoint1_sent_at` back onto the matching `AllIssues_Log` row.
5. **13:00 job**: `sendOvernightFollowupEmails_` (`OvernightEmailer.gs:889`)
   — same union/combine approach, reading `checkpoint1_json` this time,
   replying into the SAME thread the 10:00 combined email created for
   that bucket (Part 7). Writes `checkpoint2_json`/`checkpoint2_sent_at`.
6. **Idempotency** (Part 10) and **failure/edge cases** (Part 11) —
   guard conditions on the new columns, following `AllIssues_Log`'s
   existing `alreadyLoggedRegionsToday` pattern.
7. **Tests + docs** — `Tests_AllIssuesEmailer.gs`/
   `Tests_OvernightEmailer.gs` additions, `HANDOVER.md` §2/§4.3,
   `docs/gs-modules/GS-001`/`GS-010`/`GS-012`, `OPS_CHECKLIST.md`.

**Explicitly not touched**: `SlaEngine.gs`'s 5 rules and their priority
order, the 17:00 job's scope/window, `RmHierarchy.gs`'s routing/CH
safety valve, `Overnight_Log`'s schema, and any dashboard-side (`js/`)
code — this is a backend-only, Apps-Script-only change.

---

## Part 9 — Final Architecture (contract)

```
10:00:
  Section 1 = Overnight                          (unchanged logic)
  Section 2 = Previous 17:00 Follow-up #1         (NEW: Checkpoint 1)

13:00:
  Section 1 = Overnight Follow-up                 (unchanged logic)
  Section 2 = Previous 17:00 Follow-up #2         (NEW: Checkpoint 2,
                                                    incremental vs #1)

17:00:
  Primary = New All-Issues report                 (unchanged logic,
                                                    + persists snapshot)

Repeats daily. Checkpoint routing is frozen at 17:00 (Part 7). One
Gmail thread per manager bucket per day (the Overnight thread) carries
both sections at 10:00 and 13:00. AllIssues_Log columns J–N carry all
of Chain B's persistent state — Overnight_Log gains no Chain-B content,
but does gain ONE Chain-A-internal idempotency column of its own,
`followup_sent_at` (col I, Step 8/11), for the 13:00 job's own resend
guard (Part 5's own note has the full reasoning).
```

This satisfies the spec's own stated contract exactly, and is the
architecture the remaining 10 tracked steps build against.

---

## Part 10 — Idempotency (Step 8/11)

Direct code audit (not assumed) of all three daily jobs against "a
trigger retry must reconcile the existing cycle, not create a duplicate
email, snapshot, or follow-up record":

- **17:00** (`AllIssuesEmailer.gs`): already correctly guarded — its own
  region-level `alreadyLoggedRegionsToday` (mirroring `Overnight_Log`'s
  established pattern) covers the email, `issue_snapshot_json`, and its
  CH-level diversion (`notifyChLevelIssuesGs_`, called from inside the
  same guarded branch).
- **10:00** (`sendOvernightMorningEmails_`): Section 1 already guarded
  the same way (region-level, deliberately not per-bucket — a partial
  failure needs a human decision to re-run, not a silent automatic
  retry, per that function's own existing comment). Section 2
  (Checkpoint 1) already guarded via `checkpoint1_sent_at`
  (`AllIssues_Log` col L).
- **13:00** (`sendOvernightFollowupEmails_`): Section 2 (Checkpoint 2)
  already guarded via `checkpoint2_sent_at` (col N). **Section 1 (the
  unresolved-lead follow-up) had NO guard at all** — the one real,
  confirmed gap. A trigger retry resent a duplicate threaded reply into
  the same Gmail thread for every still-unresolved lead, every time.
- **`Lead_Followups`** (`pushUnresolvedToLeadFollowups_`): idempotent by
  construction — an upsert by `lead_id` can never create a duplicate
  row.

**Fix**: `Overnight_Log` gained `followup_sent_at` (col I) — the
idempotency guard for the 13:00 job's own combined reply, written
success-only so a failed send stays retryable. This is a deliberate,
documented deviation from Part 5's original "`Overnight_Log` gets no
new columns" statement — refined to mean no Chain-B content, not a
schema freeze; see Part 5's own note for the full reasoning.

**On true concurrent double-fires** (two trigger executions running at
literally the same instant, both passing a check-then-act guard before
either writes): this project's own established convention, confirmed by
direct precedent search (`MovementTracker.gs`'s `writeSlaHistorySnapshot_`
explicitly declines to add one-sided defensive code for exactly this
risk, calling it "a rare trigger double-fire"), is check-then-act via
logged/dated state — never `LockService`, which is not used anywhere in
this codebase. The guards above (sequential-retry reconciliation) match
that existing risk tolerance exactly; a true simultaneous-execution race
remains a theoretical, accepted, already-documented platform risk, not
a gap this redesign introduces or needs to close beyond what the rest
of the project already accepts.

## Part 11 — Failure and Edge-Case Handling (Step 9/11)

Audited against the scenario list this step was scoped against — job
failures at any of the 3 times, Gmail API unavailable, hierarchy
unresolved, manager changes mid-cycle, a lead crossing 48h, CH-level
diversion interacting with 2-section emails, empty overnight/17:00
populations, duplicate scheduled execution:

- **Job failures / Gmail API unavailable**: all three trigger entry
  points already wrap their real run in try/catch + `notifyOpsAlertGs_`
  + re-throw (so Executions correctly shows Failed, never silently
  swallowed). Every real send already retries via `withSendRetry_` (safe
  failure classes only) and falls back to a plain message when the
  Advanced Gmail Service isn't enabled for a threaded reply — Section
  2's inclusion inside those same emails needed no separate handling.
- **Hierarchy unresolved**: pre-existing, unchanged by this redesign —
  the `CH_LEVEL_EMAIL_` backstop + `Region_Recipients` fallback +
  `notifyLeadSendFailuresGs_` consolidated report already cover it.
  Checkpoint routing (Part 7) never re-resolves hierarchy at all, so
  this scenario doesn't even apply to Section 2's own code path.
- **Manager changes mid-cycle**: by design (Part 7, "frozen at 17:00") —
  confirmed the code actually implements this (Section 2's `to`/`cc`
  always read from `AllIssues_Log`'s stored values, never re-resolved).
- **Lead crosses 48h**: already correct — every checkpoint recomputes
  SLA flags fresh against `now` at whichever time it actually runs, not
  against the original 17:00 flags.
- **CH-level diversion interacting with 2-section emails**: a REAL,
  confirmed limitation — CH-escalated leads get no Checkpoint 1/2
  follow-up at all. Documented above (Part 7) as an intentional scope
  boundary, not fixed — properly supporting it needs a different
  recipient-identity model than "union by email" (every CH currently
  shares the same fixed `to`), a genuine redesign, not an edge case.
- **Empty overnight/17:00 populations**: already handled cleanly at
  every level — `notifyLeadSendFailuresGs_`/`sendOvernightFollowupEmails_`
  both no-op on nothing to report, an empty union produces an empty
  `.forEach()`, and a missing sheet is created fresh with just a header.
- **Duplicate scheduled execution**: see Part 10 above.
- **A real, NEW gap this audit found**: the checkpoint/log write-backs
  added in Steps 6-8 (`Overnight_Log` append, `checkpoint1_json`,
  `checkpoint2_json`, `followup_sent_at`) were NOT wrapped in their own
  try/catch, unlike the established precedent
  (`sendOneAllIssuesEmail_`'s own `issue_snapshot_json` write already
  wraps its `appendRow` and explicitly reasons about the ~50,000-char
  Sheets cell limit in its own comment). An uncaught write failure on
  ANY one bucket — most plausibly an oversized JSON blob on a very large
  bucket, but any Sheets error qualifies — would have propagated out of
  `sendCombinedMorningEmail_`/`sendCombinedFollowupEmail_` and aborted
  the caller's per-bucket loop entirely, silently skipping every OTHER
  region/bucket still left to process that run, even though each of
  those already-sent emails had nothing wrong with them. Fixed by
  wrapping all 4 write sites in their own try/catch, matching the
  existing precedent exactly: log and continue, never let a
  logging/tracking failure take down sends that already succeeded.
