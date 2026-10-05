# Email pipeline audit — findings log

Goal on the To-Do board: "Email pipeline audit: no empty or unjustified sends"
(`g-tf-c6dda0f8f5`). Symptom under audit: **a lead is reported as having an
issue, but the email that goes out is empty.** This file grows one section per
task (A0 → A9, then B1 consolidates). Evidence only — no fixes live here.

## A0 — Symptom pinned to real sent mail (2026-10-05)

### Confirmed example: fully empty 1pm follow-up, 26 Sep 2026

Five 1pm follow-up replies went out between 13:04 and 13:06 IST on 26 Sep with
**zero leads in both sections** (~4.0 KB each vs ~7 KB for a normal one):

| Bucket / recipient | Evidence |
|---|---|
| Thane / Swapnil Gowalkar (RH) | thread `1a0dc00606271e1d`, reply `1a0dca48ac6fc29b` |
| Western / Minas Patel (TM) | reply `1a0dca4af844940e` |
| Navi Mumbai / Sampada Pawar (TM) | reply `1a0dca3791d6299a` |
| Harbour / Akash A Ugale (TM) | reply `1a0dca339067638c` |
| Bangalore / Mainuddin T | reply `1a0dca2ca388f42d` |

Body of the Thane one: Section 1 "Nothing still unresolved from this morning —
all clear." + Section 2 "Nothing changed since this morning's Checkpoint 1 — no
news to report." Plain-text part: "0 still unresolved; … 0 lead(s) with news".

How it arose: the same thread's 10:06 mail listed leads (Thane: overnight lead
2243943, checkpoint lead 2242023, the latter already "Resolved"); by 1 PM
nothing was left, but the 13:00 job still replied.

What the log claimed: `Overnight_Log.followup_sent_at` = `13:01:46` on 29 of 30
rows that day — no content or "empty" indicator at all.

Fix: commit `87114a3` (26 Sep 13:40 IST, ~35 min after those sends) — skip the
reply when nothing is unresolved in either section
(`sendCombinedFollowupEmail_`, `OvernightEmailer.gs` ~L1549). A Gmail search for
digest mail under 5 KB over the last 60 days finds **no empty digest after 26
Sep**. The live deploy minute of `87114a3` is not pinned; the deploy register
shows `OvernightEmailer.gs` confirmed live at `bed9dd2` (2026-10-03).

### Not empty, but easily read as empty

3 Oct 13:12 Thane (Swapnil): Section 1 empty, Section 2 one lead (2248179).
Sent legitimately — that lead had one 5-min call on 1 Oct 17:04 and
`call_attempts` is still 1 — see the 3 Oct check in the chat/To-Do history.

### Side findings (routed to later tasks, not fixed)

- **Plain-text part is a stub on every digest** ("…Open this email in Gmail for
  the full breakdown"), so a text-only client or preview shows no lead ids. → A3 / C3
- **`followup_sent_at` is stamped with the job's start `now`, not the real send
  time.** 3 Oct: stamped `13:01:49`, reply actually sent `13:12`. 26 Sep:
  stamped `13:01:46`, sent 13:04–13:06. → A6
- **Skipped and never-ran look identical in `Overnight_Log`** (blank
  `followup_sent_at` either way). 2 Oct has 32 rows with 0 stamps, no 1pm reply
  in Gmail and no crash alert; cannot tell "everything legitimately skipped"
  from "job did not run" without the Apps Script Executions list. → A6 / A7
- **Pre-fix crash 25 Sep 07:34Z:** `sendOvernightFollowupEmails` threw on the
  50,000-character cell limit and sent nothing that day (alert received;
  hardened in `b3a58f9`). → A7
- **`AllIssues_Log` (1122 rows since 27 Aug):** 0 rows with `lead_count` = 0 and
  0 rows with a blank `sent_at`, so no 17:00 empty send by the log's own claim.
  Count-vs-rendered-rows not yet compared. → A4

### Limits of this evidence

Size (<5 KB) only surfaces *small* empties; a normal-sized email with the wrong
content would not show up. Gmail and the Sheet were read, not the Apps Script
Executions list or Cloud logs.
