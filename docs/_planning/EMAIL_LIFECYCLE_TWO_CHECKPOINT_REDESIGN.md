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

**Overnight's own state is untouched.** `Overnight_Log` gets no new
columns — Chain A's tracking stays exactly as it is today, per spec
Section 8's explicit instruction to keep the two lifecycles separate.

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
both sections at 10:00 and 13:00. AllIssues_Log columns J–N are the
only new persistent state; Overnight_Log is untouched.
```

This satisfies the spec's own stated contract exactly, and is the
architecture the remaining 10 tracked steps build against.
