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
this is a narrower, single-sheet concern.

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

- **002** should re-scope around the correction above: the fix isn't
  adding a new per-row timestamp (it exists), it's making the existing
  `updated_at` column impossible to miss/misread — conditional formatting
  for an old value, a frozen/highlighted column, or a sheet-level banner
  cell, not a code change to the write path at all.
- **003** — "surface it wherever a person could plausibly be looking" —
  given consumer 1 (the raw sheet) is the actual incident surface, this
  and 002 substantially overlap; the sheet itself is the primary surface
  to fix, not a dashboard UI element.
- **004** (freshness policy) — consumer 4's upsert-only design is
  deliberate and correct (it can't safely clear without the dashboard's
  lock) — a real fix should target the **row level**, not a sheet-wide
  marker: something that marks or removes a row once its lead is
  confirmed resolved, not just a static "generated at" stamp that stays
  accurate for ongoing issues but silently stops being true the moment a
  lead resolves.
- **005** — wire into `CHECKLIST-006`'s durable practice; this file is
  already cross-referenced from `OPS_CHECKLIST.md`.
