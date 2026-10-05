# Email pipeline audit — findings, plan, re-audit

To-Do board goal: "Email pipeline audit: no empty or unjustified sends" (`g-tf-c6dda0f8f5`).
Trigger: the symptom *"a lead is reported as having an issue, but the email that goes out is
empty"*, then a request for a from-scratch audit of everything automated-email.

**Process note.** This audit was first done interleaved with drafting fixes. The fixes exist only as
an **uncommitted, undeployed draft** in the working tree (saved as a patch too); nothing is pushed
or live. This document is the written audit + plan that should be reviewed *before* any of it is
committed. Everything below was derived from the current code and from live evidence (Gmail Sent,
the production Sheet's log tabs) — not from earlier conclusions.

---

## 1. System map (what actually exists)

All automated email is **internal operations email to employees** (RMs, team leads, managers, ops,
leadership) about SLA breaches on Google leads. There are **no emails to leads/clients**, no
campaigns or sequences, no AI/LLM generation in the send path, no unsubscribe/suppression/bounce
handling, no webhooks, no queue. The "Suggested Follow-up" text comes from a keyword engine
(`FollowupEngine.gs`) or a human-typed `Lead_Followups` column. Phases of the audit brief that assume
those things are *not applicable* and are not invented here.

| Layer | Component | Role |
|---|---|---|
| Triggers (Apps Script, time-based) | `sendOvernightMorningEmails` ~10:00 · `sendOvernightFollowupEmails` ~13:00 · `sendAllIssuesEmails` ~17:00 | the three automated jobs; each is a trigger entry point wrapping `_` worker + a crash→ops-alert→rethrow |
| Eligibility | `computeSlaFlags_`, `primaryIssueGs_` (`SlaEngine.gs`); `passesGoogleNonUtmSearchGs_`, `mainRegionForGs_`; `isOpenLead_`/`isOppOrAbove_` (`Core.gs`) | which leads count as flagged; mirrors `js/core-lead-model.js` |
| Inputs | `readLeadsTab_` (whole leads tab), `buildMovementLogMapsGs_` (call baselines), `loadRmHierarchyAndEmails_`, `loadRegionRecipients_` | all read from the one production Sheet |
| Recipient resolution | `resolveRecipientEmailsForRegion_` → `resolveRecipientBucketsForRms_` (`RmHierarchy.gs`) | tl>tm>rh>ch chain → one bucket per primary; CH-level / Futwork / Loan / restricted-cc overrides |
| Content | `buildOvernightSectionOptsGs_`, `buildAllIssuesCheckpointSectionOptsGs_`, `buildOvernightFollowupSectionOptsGs_`, empty-state builders, `renderOvernightReportEmailHTML_`, `renderTwoSectionEmailHTML_` | pure builders; the HTML and a one-line plain stub |
| Checkpoint engine | `computeAllIssuesCheckpointGs_`, `filterAllIssuesCheckpoint2ForEmailGs_` | compares the 17:00 snapshot with the live sheet (Checkpoint 1 at 10:00, 2 at 13:00) |
| Send | `GmailApp.createDraft(...).send()` ×7 sites inside `withSendRetry_`; `Gmail.Users.Messages.send` (threaded 13:00 reply, raw MIME built by hand); `GmailApp.sendEmail` for ops alerts ×3 | **no validation of any kind before the provider call** |
| State | `Overnight_Log` (10:00 sends; `followup_sent_at`), `AllIssues_Log` (17:00 sends + `checkpoint1/2_json`/`_sent_at`), `Lead_Followups`, `Movement_Log` | the Sheet *is* the database; no locks, no transactions |
| Browser | `js/reports-gmail.js` (Gmail API send), `js/reports-ui.js`, `js/reports-build.js` | manual, human-clicked, confirm dialog; separate runtime |
| Stale copies | untracked folder `working files on 28th for automatic email/` (old `.gs` copies) | not code under audit; a wrong-version-paste hazard |

## 2. Actual workflow (as implemented)

1. **17:00** `sendAllIssuesEmails_`: scope = google + Non-UTM/Search, assigned in last 3 IST days,
   open, flagged → dedupe by customer → bucket by region then by resolved manager → **one email per
   bucket** → *after* each send, append one `AllIssues_Log` row incl. `issue_snapshot_json`.
   Idempotency = "region already has a row dated today" (read once at start).
2. **10:00** `sendOvernightMorningEmails_`: Section 1 = leads assigned 17:00→09:00; Section 2 =
   Checkpoint 1 of yesterday's 17:00 snapshot. Union by region then recipient → one combined email
   per bucket → *after* send, append `Overnight_Log` row (thread id) and stamp `checkpoint1_*` on
   the AllIssues rows. Idempotency = region has an `Overnight_Log` row today.
3. **13:00** `sendOvernightFollowupEmails_`: reads today's `Overnight_Log` rows (one per bucket
   thread); Section 1 = which morning-flagged leads are still flagged; Section 2 = Checkpoint 2
   from this morning's Checkpoint 1; replies **into the 10:00 thread** (raw MIME via the Gmail
   advanced service), plain-send fallback on any failure; stamps `followup_sent_at`/`checkpoint2_*`.
   Skip rule since 26 Sep: no reply when nothing is unresolved in either section.

Every state transition is a Sheet write *after* the external side effect, so the system relies on
"nothing runs twice and nothing fails halfway".

## 3. Findings

Severity = impact × likelihood. **Prod** = reproduced in real sent mail / real log data; **Code** =
proven by reading the code; **Data** = measured on the production Sheet.

| # | Finding | Sev | Evidence |
|---|---|---|---|
| F1 | **Cross-region leak in the 13:00 reply.** Checkpoint 2 is keyed by recipient email only, so a recipient who covers several regions gets *every* region's Checkpoint 2 in *each* region's reply. | **High** | **Prod.** 1 Oct, `ashish.ivlekar@`: Central thread Checkpoint 1 at 10:05 = **7** leads (one RM, Jagruti Borude); the 13:04 reply in the same thread = **68** leads across 5 RMs. Checkpoint 2 can only contain leads that were in *that thread's* 17:00 snapshot (7), so the other 61 came from the recipient's other region rows. Thane/SoBo/Central replies were 36,125 / 36,121 / 36,133 bytes — identical bodies, though their 10:00 mails were 31.8 / 8.1 / 9.3 KB. Exposure: 22 multi-region recipient-days in `AllIssues_Log`, 11 in `Overnight_Log`. Code: `loadTodaysCheckpoint1PendingGs_` + `sendOvernightFollowupEmails_` Pass 2. |
| F2 | **Fully empty 13:00 replies (both sections empty)** — the reported symptom. | High (already fixed live) | **Prod.** 26 Sep 13:04–13:06 IST, 5 buckets, ~4 KB. Fixed by `87114a3` (skip when nothing unresolved). No digest under 5 KB has gone out since. Appendix A. |
| F3 | **No last-line send gate.** 7 `createDraft().send()` sites, the raw-MIME builder and the threaded sender never check the recipient, subject, body, or that the leads an email *counts* are in the body it *sends*. The skip rules are the only protection, and they are per-call-site. | High | **Code.** `EmailInfra.gs` `withSendRetry_` takes an opaque closure; call sites in `OvernightEmailer.gs` / `AllIssuesEmailer.gs`. Why F2 was possible at all. |
| F4 | **Skip rules test object presence, not content.** `sendCombinedMorningEmail_` skips on `!section1`; a Section 1 *object with zero leads* + no active Checkpoint 1 would send a header-only digest. `notifyChLevel*` send a "0 Leads" report if `rmToLeads` lacks the CH-level RM's leads. | Med-High | **Code.** Unreachable through today's callers (buckets are non-empty by construction) but unenforced. |
| F5 | **No overlap protection.** "Already sent today" guards read log rows written *after* the send; no `LockService` anywhere in the project (grep). Two overlapping runs (manual + trigger, double-fire, a slow run) both pass the guard and send to everyone. | Med | **Code.** Observed frequency is low: 1 duplicate `Overnight_Log` pair in 787 rows (25 Aug). |
| F6 | **Premature "done" state on failure.** `checkpoint1_sent_at` / `checkpoint2_sent_at` are written *even when the send failed*; the loaders skip any row whose stamp is set, so the same-day re-run the failure alert asks for can never deliver that Section 2 (the 13:00 re-run sends a reply *without* Section 2). The 13:00 alert also says the bucket "will be retried on the next run" — the scheduled job only reads *today's* rows, so it is not. | Med | **Code.** `sendCombinedMorningEmail_` tail; `sendCombinedFollowupEmail_` `writeCheckpoint2State_`. |
| F7 | **Possible duplicate on ambiguous threaded send.** Any error from the threaded send — including a timeout where the message may already be delivered — falls through to a second, plain send. | Med | **Code.** `sendCombinedFollowupEmail_` catch. |
| F8 | **Whole-sheet re-read per bucket.** `computeAllIssuesCheckpointGs_` calls `readLeadsTab_` itself: ~30 full reads per job. Costs minutes (the 3 Oct 13:00 run took 663 s), adds timeout risk, and lets buckets — and Section 1 vs Section 2 of one email — be judged against different moments of a sheet that is re-imported underneath the run. | Med | **Code + Prod** (663 s run, 3 Oct). |
| F9 | **Two buckets on one address overwrite each other.** `section1ByEmail[key] = {…}` replaces the first bucket's leads: never emailed, never reported as "not sent". | Med | **Code.** Needs two resolved buckets with the same address (e.g. a `Region_Recipients` fallback equal to an A1's address). |
| F10 | **Log appends can duplicate.** Appends run inside `withRetry_`; a timeout that arrives *after* Sheets wrote the row triggers a retry that appends a second identical row (a duplicate `Overnight_Log` row = a duplicate 13:00 reply). | Med | **Code**, hazard reproduced in a control test. |
| F11 | **CH-level reports are unlogged** → resent on every re-run for a region that has *only* CH-level leads (the region guard needs a log row, which such a region never gets). | Med | **Code.** Not addressed by the draft. |
| F12 | **Logs don't show what happened.** `followup_sent_at`/`sent_at` are stamped with the job's start time, not the send time (3 Oct: stamped 13:01:49, reply sent 13:12; 26 Sep: 13:01:46 vs 13:04–13:06). A *skipped* bucket and a *never-ran* job both leave the cell blank: 2 Oct has 32 `Overnight_Log` rows, 0 stamps, no 1pm reply and no crash alert — cannot tell which. | Med | **Prod/Data.** Needs the Apps Script Executions list to resolve 2 Oct (not readable from here). |
| F13 | **Plain-text part is a one-line stub** on every digest ("…Open this email in Gmail for the full breakdown") — a text-only client or preview shows no leads. | Low-Med | **Prod** (message bodies read via Gmail). |
| F14 | **No address validation; raw MIME headers from unsanitised cells.** `Manager_Directory`/`Region_Recipients` values are only trimmed; the threaded sender interpolates `to`/`cc`/`subject` straight into header lines (a line break in a cell = header injection / corrupt mail). | Low-Med | **Code.** All 7,854 real recipient/cc addresses in the production logs and directories pass a strict validator — a gate would have blocked none of them (Data). |
| F15 | **"Missing" cells render as the word `undefined`** (`esc_(String(cell))`). | Low | **Code.** |
| F16 | **A re-run after a partial failure tells the failed recipient "Already sent separately earlier today".** The region-level guard marks the whole region as sent. | Low | **Code.** |
| F17 | **`pushUnresolvedToLeadFollowups_`** appends a duplicate row per repeated lead and rewrites the whole range from a stale read (can overwrite a concurrent human edit in column F). | Low | **Code.** Duplicate part is simple; stale-write part is a millisecond window. |
| F18 | **Call baseline keyed by `client_id`.** 305 of 601 in-scope clients have more than one lead, so the "calls today" delta can compare a lead to a *sibling's* snapshot. Impact is small: only 27 of those 305 differ in `call_attempts` (8 by ≥5). Same key in the dashboard JS. | Low | **Code + Data.** Paired JS/GS decision; out of scope here. |
| F19 | **Browser Gmail send has no body gate** (`performGmailSend`). Manual + confirm, separate runtime. | Low | **Code.** |
| F20 | **Business-rule ambiguities, not defects:** Follow-up Overdue counts raw clock hours (so every connected lead untouched since last evening is "overdue" at 10:00); Section 1 (1pm) drops a lead whose issue *category* changed while Section 2 lists it; "He said he will call back" is read as "client asked to be called back". | — | Needs an owner decision; nothing changed. |

### Why "issue reported, email empty" happened (root-cause chain)

State: a lead flagged at 17:00 is resolved by 13:00 → 13:00 job builds Section 1 empty-state + Section 2
empty-state → **no skip rule existed** (it was added 35 minutes after those sends) and **no gate
checks content**, so a header-only digest is sent; the log only records "sent at 13:01:46" with no
content indicator. Competing explanations rejected: empty body from a builder bug (all builders
return non-empty HTML; the 4 KB size is exactly two empty-state shells), provider truncation (sizes
identical across 5 buckets), stale state (the leads really were resolved).

## 4. Plan

Status column: **D** = already drafted in the working tree (uncommitted; headless `.gs` suite
1,423/1,423 passing, up from 1,254; 13 deliberate regressions each caught by a named test); **N** = not drafted.

| Step | Change | Fixes | Files | Test | Status |
|---|---|---|---|---|---|
| P1 | One **send-safety gate** (`prepareOutgoingEmailGs_` / `sendGuardedEmailGs_`): valid To/Cc, non-blank subject, non-whitespace plain body, HTML with visible text, and — for report emails — a non-empty list of claimed lead ids that **all appear in both** the plain and HTML bodies. A failure throws *before* any draft exists; callers already turn a throw into an ops alert + "not sent" entry. Route all 7 report sends + the threaded sender through it. | F3 F4 F14 | `EmailInfra.gs` + 3 emailers | unit + per-call-site + mutation | D |
| P2 | Real **plain-text body** rendered from the same opts as the HTML; blank cell renders blank. | F13 F15 | `EmailInfra.gs`, emailers | unit | D |
| P3 | **Key Checkpoint 2 by region + recipient**; one-use per key per run. | F1 | `OvernightEmailer.gs` | multi-region test incl. duplicate row | D |
| P4 | **One job lock** around the three trigger entry points; a skipped job alerts ops. | F5 | `EmailInfra.gs`, 3 entry points | lock tests | D (**needs Amendment A1**) |
| P5 | Stamp `checkpoint*_sent_at` **only on delivery** (or a deliberate "nothing to send"); definite failure stays retryable same-day; correct the alert wording. | F6 | `OvernightEmailer.gs` | fail → rerun delivers Section 2 | D |
| P6 | **No fallback after an ambiguous send**: record `unconfirmed <time>`, alert, don't resend. | F7 | `EmailInfra.gs`, `OvernightEmailer.gs` | timeout test | D |
| P7 | **Append log rows once** per thread id; **merge** buckets sharing an address; truthful "not re-sent" label; dedupe `Lead_Followups` pushes; skip a CH-level report with zero leads. | F9 F10 F16 F17(dup) F4 | emailers | per-defect tests | D |
| P8 | **One leads-tab snapshot per job**, passed to every checkpoint. | F8 | `SlaEngine.gs`, emailers | read-count test | D |
| P9 | **Log what happened**: stamp actual send time, and write an explicit `skipped: nothing unresolved` marker so skipped ≠ never-ran. | F12 | emailers | log assertions | N — needs a column/format decision |
| P10 | **CH-level report idempotency** (record once per day/region/CH). | F11 | emailers | rerun test | N — adds persistent state (ScriptProperties) |
| P11 | Browser `performGmailSend` body/recipient gate. | F19 | `js/reports-gmail.js` + harness | harness | N |
| P12 | Docs, catalog, deploy register; **paste 9 changed `.gs` files** (4 production, 5 test) via the hash-verified procedure. No trigger re-setup needed (no trigger changed). | — | docs, tracker | check-catalog / check-staleness | N |

Out of scope / owner decisions: F18, F20, the stale untracked folder, resolving 2 Oct via the Executions
list.

Post-deploy verification (next 3 scheduled runs): (1) no 13:00 reply in a multi-region recipient's
threads carries another region's leads and sizes differ by region; (2) no `[Overnight Emailer] … BLOCKED`
or `SKIPPED` alert unless something is genuinely wrong; (3) no digest under 5 KB; (4) 13:00 run time falls
well below 663 s.

## 5. Re-audit (of the plan and the draft)

Checks run against the draft, and what they found:

1. **Would the gate block legitimate mail?** Validated every real recipient/cc ever sent (Overnight_Log,
   AllIssues_Log), `Manager_Directory`, `Region_Recipients`: **7,854 addresses, 0 invalid.** A
   semicolon-separated list *would* be blocked (Gmail's `createDraft` wants commas) — none exist today.
2. **Could the lead-id check false-block?** Ids are digits; HTML entities are decoded before matching;
   plain and HTML both come from the same opts. A *real* block means the email counted a lead its body
   doesn't contain — exactly the bug class — and alerts ops.
3. **Region+recipient key vs. how rows are written.** Both rows carry the region key from the same
   canonical names (`mainRegionForGs_`) or the `Futwork` pseudo-region; the legacy per-region Futwork
   rows map to `Futwork` in both loaders. The full-cycle Futwork test passes.
4. **Does P5 create an infinite/auto retry?** No: nothing retries automatically; an unstamped row only
   matters to a *manual* same-day re-run. A morning failure leaves no `checkpoint1_sent_at`, so 13:00 does
   not pick that row up.
5. **P6 trade-off.** A timeout-class error now means "unconfirmed, alert a human" rather than "send again".
   A genuinely undelivered reply costs a manual re-run; the old behaviour risked a duplicate.
6. **⚠ Defect found in my own draft — Amendment A1:** `withEmailJobLockGs_` currently treats a *thrown*
   lock error as "lock not acquired" and **skips the job**. If `LockService` ever throws (e.g. an
   authorization problem after a new scope is needed), all three jobs would silently stop. Google's
   reference lists `tryLock` as returning a boolean and shows no extra scope, but I could not verify
   that live. **Required change before this is committed:** contention (`false`) → skip + alert; an
   *exception* → alert once and **run without the lock** (fail open).
7. **Cost of P1/P7.** One extra Sheets read per send (the once-only append) — ~30 small reads per job,
   against the ~30 *whole-sheet* reads P8 removes.
8. **Tests are real:** each fix was mutation-checked (revert the fix → a named test fails); the one
   mutation that survived (CH-level empty-guard) survived only because the gate backstops it, so the test
   now also asserts the first-line check stays silent.
9. **Untested:** the live paste, real `LockService`/Gmail behaviour, and the real 11-minute run profile
   — covered only by the post-deploy checks above.

## 6. Decisions needed from you

1. Approve P1–P8 (drafted) with Amendment A1, as one commit, then deploy to the live Apps Script project.
2. P9 (log send time + explicit "skipped" marker): OK to add a column to `Overnight_Log`?
3. P10 (CH-level idempotency) and P11 (browser gate): include now or later?
4. The three business rules in F20 — leave as is, or decide each?

---

## Appendix A — A0: the reported symptom in real sent mail (2026-10-05)

Five 1pm follow-up replies went out 13:04–13:06 IST on 26 Sep with **zero leads in both sections**
(~4.0 KB vs ~7 KB): Thane/Swapnil Gowalkar (thread `1a0dc00606271e1d`, reply `1a0dca48ac6fc29b`),
Western/Minas Patel (`1a0dca4af844940e`), Navi Mumbai/Sampada Pawar (`1a0dca3791d6299a`),
Harbour/Akash A Ugale (`1a0dca339067638c`), Bangalore/Mainuddin T (`1a0dca2ca388f42d`). Section 1
"Nothing still unresolved from this morning — all clear."; Section 2 "Nothing changed since this
morning's Checkpoint 1". The 10:06 mail for the same thread had listed leads (Thane: 2243943, 2242023);
both were resolved by 1 PM. `Overnight_Log.followup_sent_at` = 13:01:46 on 29 of 30 rows that day, with
no content indicator. Commit `87114a3` (26 Sep 13:40 IST) added the skip; a Gmail search for digests
under 5 KB over 60 days finds none after 26 Sep.

3 Oct 13:12 Thane (Swapnil): Section 1 empty, Section 2 one lead (2248179) — sent legitimately: that
lead had one 5-minute call on 1 Oct 17:04 and `call_attempts` is still 1 (comments undated, so the
4-hour rule fell back to time-since-connect; it left the "under 48 h" window at 17:02 on 3 Oct, which is
why the 17:04 report relabelled it "Behind on Today's Calls").

Other measurements: `AllIssues_Log` 1,122 rows, 0 with `lead_count` = 0, 0 with blank `sent_at`; 25 Sep
07:34Z the 13:00 job crashed on the 50,000-character cell limit (hardened in `b3a58f9`).
Limits: size (<5 KB) only surfaces *small* empties; the Apps Script Executions list and Cloud logs were
not readable from here.
