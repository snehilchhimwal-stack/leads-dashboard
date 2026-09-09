# LEAD_FOLLOWUPS_STALENESS.md — every real consumer of `Lead_Followups`, mapped

**Why this exists:** lead 2229674 (reported 2026-09-09, "in Follow-up
despite being an Opportunity") was confirmed via live inspection to be
caused by a stale `Lead_Followups` row — written the evening before by a
Generate cycle that ran before the lead progressed to Opportunity, then
never refreshed. `LEADFOLLOWUPS-001` (To-Do Dashboard) is the task this
file resolves: before designing a fix, know precisely what depends on
`Lead_Followups` and how badly staleness actually hurts each one.
Companion effort: [OPS_CHECKLIST.md](OPS_CHECKLIST.md) covers automatic
email / RM hierarchy / worst-performing-RM — tracked separately since
this is a narrower, single-sheet concern. Cross-linked (`LEADFOLLOWUPS-005`)
from `CLAUDE.md`'s Testing section and `HANDOVER.md` §8, which also
carries the lead 2229674 incident itself in its own maintained format.

---

## The core mechanism — why staleness happens at all

`Lead_Followups` is never live-synced. A row's `region`/`issue`/
`collated_comments` reflect exactly what was true the moment that row was
last **written**, not what's true now. Two independent code paths write
to it, with genuinely different clearing behavior:

1. **The dashboard's own Generate cycles** (Operations' Summary email,
   Movement's Overnight Region Emails) — each one **wipes the whole tab**
   at the start of its own run, then writes only its own leads.
2. **`OvernightEmailer.gs`'s daily automated follow-up send**
   (`sendOvernightFollowupEmails`, 13:00 IST) — **upserts, and
   deliberately never clears** (see consumer 4 below for why).

The confirmed real incident's mechanism, precisely: a row got written
(either path) with `issue = Follow-up Overdue` on 2026-09-08 ~18:34 IST.
The lead progressed to Opportunity sometime after that. Nothing re-ran a
full Generate, and the daily automated push only *refreshes* a row for a
lead that's **still unresolved** — once a lead resolves, its row is never
touched again by that path either. The row simply sat there, unchanged,
until a person read it and reasonably assumed it reflected the present.

---

## Every real consumer, mapped

### 1. A person directly opening the `Lead_Followups` tab in Google Sheets
**Not code** — but the actual surface the confirmed incident happened on,
and almost certainly the single most exposed consumer of this sheet.
**Staleness tolerance: none currently enforced.** Nothing in the row
visually distinguishes "written 2 minutes ago" from "written 3 days ago"
— column G (`updated_at`) exists (see the correction below) but nothing
calls attention to it or makes "how old is this, really" obvious at a
glance. This is the consumer `LEADFOLLOWUPS-002`/`003` exist to protect.

### 2. Operations tab's "Generate" (Summary/All Issues email)
`js/sheets-writeback.js` + `js/reports-ui.js`. Flow: `clearLeadFollowupsTab()`
→ `pushLeadsToFollowups()` → `waitForAllFollowups()` (**unbounded**, live
poll every 20s, a human clicks Cancel to give up) → `buildRegionWiseReports(
..., followupLookup)`, which uses the already-fetched `followupLookup`
object purely in-memory — no second read.
**Staleness tolerance: effectively zero during its own cycle** — always
reads back exactly what it just wrote, live. The rows it leaves behind
afterward are what consumers 1 and 4 can later read stale.

### 3. Movement tab's "Generate Region Emails" (Overnight Leads)
`js/tab-movement.js`. Identical pattern to #2, an independently-triggered
second Generate cycle — `tryClaimGenerateCycle`/`releaseGenerateCycle`
give the two an in-memory exclusivity lock so one can't clear the tab out
from under the other mid-cycle.
**Staleness tolerance: same as #2 — zero during its own cycle.**

### 4. `sendOvernightFollowupEmails` (13:00 IST daily automated trigger)
`OvernightEmailer.gs`. Flow: `pushUnresolvedToLeadFollowups_()` (**upsert
by `lead_id`, deliberately never clears** — Apps Script runs as a
separate process with no way to see the dashboard's in-memory
`_generateCycleOwner` lock, so clearing here could wipe rows a human is
actively reviewing at that exact moment) → `waitForFollowupSuggestions_()`
(**bounded**, ~2 minutes total: 6 attempts × 20s, then sends with
whatever's there — no human to click Cancel on an unattended trigger).
**Staleness tolerance: this is the real, precise mechanism behind the
incident.** A row this function writes gets its `region`/`issue`/
`comments`/`updated_at` **refreshed every day the same lead is still
unresolved** — so a genuinely ongoing issue stays reasonably fresh. But a
lead that **resolves between two daily runs** has its row simply
abandoned: nothing marks it resolved or removes it. It sits exactly as
last written until either that same lead somehow becomes unresolved again
(re-triggering a refresh) or a person runs a full dashboard Generate
(which wipes the whole tab). That is the literal window lead 2229674 fell
into.

---

## A correction this mapping surfaced

`LEADFOLLOWUPS-002`'s current task description (To-Do Dashboard) says
*"`clearLeadFollowupsTab` and `pushLeadsToFollowups` currently rewrite the
tab's rows with no record of when that write happened."* **That premise
is incorrect** — column G, `updated_at`, already exists and is written by
**both** real writers (`pushLeadsToFollowups`, `js/sheets-writeback.js:227`;
`pushUnresolvedToLeadFollowups_`, `OvernightEmailer.gs`, via its own
`updatedAt` local). A per-row timestamp is not the missing piece — making
it **visible and meaningful to consumer 1** (a person just looking at the
sheet) is. Flagging this now, before `LEADFOLLOWUPS-002` starts, rather
than letting it build on a wrong premise — same discipline
`CHECKLIST-001`'s finding applied to `CHECKLIST-002`/`003` earlier
(2026-09-09).

---

## What this means for `LEADFOLLOWUPS-002..005`

- **002** — **done.** `LeadFollowupsStaleness.gs`'s
  `setupLeadFollowupsStalenessFormatting()` makes column G's own age
  visible via conditional formatting (amber past 12h, red past 24h) —
  targets consumer 1, the actual incident surface.
- **003** — **done, and it turned out to be a genuinely separate gap
  from 002, not just an overlap.** Consumer 1 (the raw sheet) is fully
  covered by 002's formatting — but consumer 4
  (`sendOvernightFollowupEmails`) reads a possibly-days-old human
  suggestion out of column F and quotes it straight into an outbound
  email, where NOTHING from the sheet's own formatting is visible at all
  (an email is not the sheet). Fixed in `OvernightEmailer.gs`:
  `waitForFollowupSuggestions_` now returns `{suggestion, updatedAt}`
  instead of a bare string, and `sendOvernightFollowupEmails_` appends a
  `formatFollowupAgeGs_()` caption — `" (typed Xh ago)"` /
  `" (typed Xd ago)"` — to any human-typed suggestion it quotes. The
  algorithmic fallback (`overnightFollowupHintGs_`) is always computed
  fresh in the same run, so it never needs one. The two dashboard Generate
  flows (consumers 2/3) were confirmed to need nothing here — both start
  from a freshly *cleared* tab every cycle, so any suggestion they read
  back was necessarily typed within that same live cycle, never old.
- **004** — **decided: no new code.** 002+003 together, verified below,
  already close both real paths a person could be misled — see
  "LEADFOLLOWUPS-004 decision" below for the full reasoning against
  actively pruning rows.
- **005** — wire into `CHECKLIST-006`'s durable practice; this file is
  already cross-referenced from `OPS_CHECKLIST.md`.

---

## `LEADFOLLOWUPS-004` decision — a real freshness control, not just a label

The task named 3 options to weigh and asked for the decision recorded
either way. All 3, weighed against how consumer 4 (`sendOvernightFollowupEmails`,
13:00 IST daily) actually behaves:

**Option 1 — auto-run Generate before any send if the marker is stale.**
Rejected. "Auto-run Generate" means a full `clearLeadFollowupsTab()` +
push + wait cycle — exactly what `pushUnresolvedToLeadFollowups_`'s own
upsert-only design was built to avoid in the first place (Apps Script
can't see the dashboard's in-memory `_generateCycleOwner` lock, so a
clear here could wipe rows a human is actively reviewing at that exact
moment — see that function's own header comment). Solving 004 by
reintroducing the exact risk 001 already identified and avoided would be
a regression, not a fix.

**Option 2 — warn or block the send past a threshold.** Rejected as not
applicable to this consumer: `sendOvernightFollowupEmails` is unattended
(13:00 IST, nobody present to answer a confirmation prompt), and its own
design already deliberately tolerates missing/incomplete data rather than
blocking (`waitForFollowupSuggestions_`'s own comment: "possibly partial,
possibly empty — same 'send without it' outcome either way"). Blocking
the send entirely over a stale *unrelated* row would trade a real,
working follow-up email for no email at all, over a problem those 2
fixes already made visible rather than hidden.

**Option 3 — accept the label as sufficient (chosen, strengthened).**
Traced what actually happens to a resolved lead's abandoned row:
1. It never appears in a **future email** again — `sendOvernightFollowupEmails_`
   classifies a lead as `resolvedRows` the moment it stops matching its
   original flagged issue, and only `unresolvedRows`' lead_ids are ever
   passed to `waitForFollowupSuggestions_` — a resolved lead's stale row
   sits in the sheet but is never read into an outbound email again.
2. It **does** stay visible on the raw sheet — but 002's conditional
   formatting turns it amber, then red, exactly because nothing is
   refreshing it anymore. This is not a gap the fix missed; it's the fix
   *working as intended* on a row nothing else is touching.

So the two real exposure paths LEADFOLLOWUPS-001 mapped — a person
reading the raw sheet, a person reading the 1pm email — are both already
closed by 002 and 003 together, verified above, not just asserted.
Actively deleting or rewriting a resolved lead's row from the backend
would add the same class of cross-process collision risk `pushUnresolvedToLeadFollowups_`
was built to avoid, for a benefit that's already covered: tidiness, not
correctness. **Decision: no additional code for 004** — 002+003 are the
real freshness control this task asked for, not merely the "prerequisite
visibility" for a still-missing third piece.
