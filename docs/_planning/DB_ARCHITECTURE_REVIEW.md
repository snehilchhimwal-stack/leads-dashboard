# Database Architecture Review — Working Document

**Scope:** every Google Sheet tab EXCEPT `leads` (out of scope per the
brief — `leads` stays untouched, noted only where a dependency on it must
be documented). 12 sequential parts (To-Do Dashboard tag
`db-architecture-review`), each building on the last. This file is the
durable working record, filled in part by part; the final 15-section
report (matching the brief's exact output format) is assembled in Part 12.

**Method note on sources.** This project already has a real, code-verified
documentation layer (`docs/sheets/SHEET-XXX-*.md`, built by an earlier
"Documentation Project" phase) — every column list, writer, reader,
trigger, and retention figure in those records is sourced from a specific
line in the real `.gs`/`.js` files or a real production incident, not
guessed. `docs/_planning/retention-decisions-needed.md` additionally
carries real, cited volume/growth figures (including a real cell-ceiling
crash incident with exact numbers). Part 1 below is built from that
existing, grounded material plus direct code cross-checks — **not** from
live Google Sheets API access. Signing into the user's Google account to
browse the live Sheet was not attempted (out of scope for what an agent
should do unattended); wherever a fact genuinely isn't available from docs
+ code, it's flagged explicitly below as **UNCONFIRMED**, not guessed.
Confirmed via `docs/INDEX.md`: exactly 14 `SHEET-XXX` records exist
(`SHEET-001` = `leads`, excluded; `SHEET-002`–`SHEET-014` = the 13 tabs
below) — this is the complete tab inventory, not a partial one.

---

## Part 1 — Current-State Inventory

### Summary table

| # | Tab | Purpose (one line) | Classification | Entry method | Change frequency | Volume / growth | Depends on |
|---|---|---|---|---|---|---|---|
| 1 | `Movement_Log` | 4×/day frozen snapshot of every open lead — the past the live tab can't show | Operational snapshot (short-lived history) | Code (2 writers) | 4×/day + on-demand | **~232,607 rows** @ 7d retention, 24 cols, **~5.6M cells** (cited, real) | `leads` |
| 2 | `Daily_RM_Issues` | Nightly SLA-flagged-only census — the Repeat Offenders audit trail | Historical (7d) | Code (1 writer + backfill) | Nightly (22:50 IST) | **~26,660 rows/night** @ 7d, 13 cols, **~2.4M cells** (cited, real — a real crash incident) | `leads`, `Movement_Log` (backfill) |
| 3 | `Lead_Followups` | Human-review bridge for region-email follow-up suggestions | Temporary work queue | Mixed (code + 1 human-only column) | Cleared + repopulated every Generate cycle | Tens–low hundreds of rows, resets each cycle (cited) | `leads` |
| 4 | `SLA_History` | Long-lived aggregate SLA trend, outliving `Movement_Log`'s 7-day window | Historical aggregate | Code (2 writers, upsert) | 4×/day | ~4 rows/day, **~15K cells/yr** (cited, negligible) | `Movement_Log` |
| 5 | `Daily_Cohort_History` | Permanent, immutable-once-complete cohort-outcome archive | Historical archive (permanent) | Code (2 writers, upsert, never re-archives) | 4×/day (guarded) | ~11 rows/day, **~48K cells/yr** (cited, negligible) | `Movement_Log` |
| 6 | `RM_Hierarchy` | The org chart materialized as a sheet — routing + leaderboard tiers | **Configuration** (rebuilt from code, not authored in-sheet) | Code rebuild + 1 human-toggle field | On demand (no time trigger) | **~270 rows** (cited breakdown by role) | none (source is a code constant) |
| 7 | `Manager_Directory` | Hand-fillable address book substituting for the (always-absent) private email file | **Configuration** | Code header/rows + human-filled `email` | On demand | **UNCONFIRMED** row count (≈ manager-tier headcount in `RM_Hierarchy`, not directly cited) | `RM_Hierarchy` |
| 8 | `Comment_History` | Forward-looking append-only capture of every genuinely-new lead comment | Historical, append-only by design | Code (piggyback, de-duped) | 4×/day trigger, writes only on new comments | **UNCONFIRMED** rows/day (qualitatively "an order of magnitude rarer" than `Movement_Log`'s ~33,229/day) | `leads` |
| 9 | `Unmatched_Comments_Log` | Classifier-gap review queue — comments no keyword rule matched | Operational review queue, manually curated | Code (piggyback, de-duped) + human review marks | 4×/day trigger, writes only on unclassifiable comments | **UNCONFIRMED** rows/day | `leads` |
| 10 | `Send_Log` | Audit trail of every **dashboard-initiated** (human, on-demand) region email | Historical audit log | Code (fire-and-forget), browser-only | On each dashboard send | ~10–50 rows/day, **low tens-K cells/yr** (cited, unbounded — zero removal path, unique among the 13) | `leads` (indirectly, via the issues it emails) |
| 11 | `Region_Recipients` | Backend per-region recipient **fallback** address list | **Configuration** | Code header + human-filled `to`/`cc` | On demand | **UNCONFIRMED** row count (≈ region count) | none |
| 12 | `AllIssues_Log` | Send-audit log for the 17:00 scheduled digest only | Historical audit log | Code, self-healing header | Once/day (17:00) | ~11 rows/day, **~36K cells/yr** (cited, negligible, safe-to-prune) | `leads` (indirectly) |
| 13 | `Overnight_Log` | **Functional** same-day state bridge between the 10:00 send and 13:00 threaded follow-up | Operational state handoff | Code | Written 10:00, read 13:00 | ~11 rows/day, **~32K cells/yr** (cited) — only ~today's rows are ever needed | `leads` (indirectly) |

**Reading the classification column against the brief's categories**
(historical / operational / temporary / reference / configuration /
reporting): `RM_Hierarchy`, `Manager_Directory`, `Region_Recipients` are
**configuration**. `Lead_Followups` and `Overnight_Log` are the two
genuinely **operational/temporary** tabs (a live queue and a same-day
handoff, respectively — neither is a permanent record). `Movement_Log`
and `Daily_RM_Issues` are **operational history** (short, bounded
windows feeding live features). `SLA_History`, `Daily_Cohort_History`,
`Comment_History` are **long-term historical/reporting** archives.
`Send_Log`, `AllIssues_Log`, `Unmatched_Comments_Log` are **audit/log**
data. Nothing reviewed here is pure **reporting** in the sense of being
*generated from* the other 13 — the one reporting-shaped surface
(region email digests) is not itself a stored tab.

---

## Part 1 — Tab-by-Tab Detailed Analysis

### 1. `Movement_Log`

- **Business purpose.** The `leads` tab only shows the present state. This
  is the periodic frozen history (4×/day) that lets the system answer
  "this lead stopped moving 3 days ago," reconstruct a 0–48h cohort
  outcome, an RM's issue history, and the RM-performance leaderboard —
  none of which a live-only tab can answer. Confirmed the **largest**
  tab in the project.
- **Columns** (24 total): `snapshot_at` (datetime, capture instant,
  written `RAW` to avoid Sheets' date-serial coercion), `snapshot_label`
  (text, which run produced it), `lead_id`/`client_id`/`RM`/`TL`/
  `project`/`region`/`client` (text identity+routing copy —
  **`project_region` is deliberately NOT captured**, the documented root
  cause of a reduced-scope Loan-region override), `lead_assigned_at`/
  `group_source`/`source_bucket`/`current_stage` (mixed, lifecycle+source
  copy), `last_connect`/`last_connect_time`/`last_comment`/
  `internal_status_comments`/`closing_reason` (mixed, contact+comment
  copy), `call_attempts`/`call_count`/`duration` (number, cumulative
  call figures **at capture time**), `stage_comments` (text),
  `rm_is_active`/`lead_closing_reason` (text, **appended 2026-09-01** —
  rows captured before that date have neither column at all, a real,
  documented schema-evolution gap).
- **Entry method.** Code-generated, by **two independent writers with an
  identical schema**: a 4×/day scheduled trigger and an on-demand
  "Snapshot now" dashboard button. A third function prunes.
- **Consumers.** The Movement/RM-performance/cohort/RM-Timeline/PDF tabs
  on the dashboard, plus three backend scheduled emailers (for
  call-count baselines and past-day recovery).
- **Change frequency.** 4×/day scheduled, plus whenever a human clicks
  the on-demand snapshot button.
- **Classification.** Operational snapshot history — explicitly
  short-lived by design (7-day retention), not a permanent archive.
- **Volume/growth.** **~232,607 rows** at the current 7-day retention,
  24 columns, **~5.6M cells** — a real, cited figure from
  `retention-decisions-needed.md`'s cell-ceiling analysis, not an
  estimate.
- **Dependencies.** Snapshots `leads` (out of scope, noted only as the
  source). Feeds `SLA_History` and `Daily_Cohort_History` (written in
  the same capture pass). `Daily_RM_Issues` can be backfilled from it.
- **Redundancy signal.** None on its own — this is the canonical raw
  snapshot every derived tab depends on. (See `Daily_RM_Issues` below
  for a real overlap worth flagging.)

### 2. `Daily_RM_Issues`

- **Business purpose.** A once-nightly (22:50 IST), SLA-flagged-only
  distillation of `Movement_Log` — the audit trail behind the dashboard's
  Repeat Offenders leaderboard. Exists because `Movement_Log` is a raw
  4×/day snapshot of *everything*, and the leaderboard needs a stable,
  filter-ready, SLA-issue-only history to aggregate over.
- **Columns** (13 total): `date` (the **capture** date, not the
  assignment date — a documented, deliberate distinction), `RM`/
  `region`/`project` (routing), `lead_id`/`client_id` (identity),
  `issue_key`/`issue_label` (one row per SLA issue type), `captured_at`
  (datetime), `TL`/`group_source`/`source_bucket` (text, **appended
  2026-09-01** for filter parity with the dashboard's top bar —
  older rows lack these), `lead_assigned_at` (datetime, appended the
  same date, to distinguish "flagged tonight" from "assigned today").
- **Entry method.** Code-generated, chunked writes (5,000-row batches,
  a deliberate mitigation for a real prior silent-failure incident) from
  the nightly trigger; a backfill function can rebuild any day from
  `Movement_Log`; a prune removes rows past 7 days; a manual repair
  function exists for the 2026-09-01 schema-evolution gap.
- **Consumers.** Only the dashboard's Repeat Offenders tab.
- **Change frequency.** Once/night.
- **Classification.** Historical — 7-day retention, **confirmed** (not
  `TBD`), added 2026-09-07.
- **Volume/growth.** **~26,660 rows/night**, ~186,620 at steady 7-day
  retention, 13 columns, **~2.4M cells** — a real, cited figure. The
  retention itself exists **because of a real production crash**: this
  tab shipped 2026-09-01 with no retention at all, hit the workbook's
  10-million-cell ceiling on 2026-09-06, and the nightly capture
  **crashed and lost that night's data** — the prune was added the next
  day. This is the single clearest cautionary data point in the whole
  review for why "unbounded" is a real risk here, not a theoretical one.
- **Dependencies.** Distilled from `leads` nightly; backfillable from
  `Movement_Log`. Not fed by any other tab.
- **Redundancy signal — real, worth carrying into Part 2/3.**
  `Daily_RM_Issues` is structurally a **filtered, re-shaped copy** of
  data `Movement_Log` already has (both are captures of open,
  SLA-relevant lead state; `Daily_RM_Issues` is explicitly backfillable
  *from* `Movement_Log`). In a relational target, this strongly suggests
  `Daily_RM_Issues` could become a **derived view/query** over a
  `movement_log`-equivalent table (filtered to SLA-flagged leads, one
  row per open-lead-and-issue, computed at 22:50 or on read) rather than
  a second independently-written, independently-pruned physical table
  with its own schema-evolution history. The two currently have to be
  kept in sync by hand (both add `TL`/`group_source`/`source_bucket`/
  `lead_assigned_at` as separate, later additions) — a real sign of two
  tables that started as one concept and drifted. **Flag for Part 2/3
  decision, not resolved here.**

### 3. `Lead_Followups`

- **Business purpose.** The human-review bridge for region-email
  follow-up suggestions. Both the dashboard's on-demand Generate cycle
  and the backend's overnight cycle push qualifying flagged leads here,
  then **wait for a person** to write a real next-action into one
  specific column before the email goes out; if nobody reviews in time,
  an algorithmic suggestion is used with an "UNREVIEWED" label. Exists
  so both runtimes see the same shared review surface.
- **Columns** (8, lettered A–H): `lead_id` (A, upsert key), `region` (B),
  `RM` (C), `issue` (D, the SLA issue key), `collated_comments` (E,
  script-merged family comment history), `suggested_followup` (F — **a
  hard contract: no script may ever write this column**, left blank on
  push, filled only by a human), `updated_at` (G, datetime, last script
  write — drives amber/red staleness formatting), `own` (H, the RM's own
  comment text, script-written).
- **Entry method.** Mixed — columns A–E, G, H are code-upserted by
  either runtime's push function; column F is human-only.
- **Consumers.** Both runtimes poll column F during their respective
  cycles; a conditional-formatting rule reads column G for staleness.
- **Change frequency.** **Cleared and fully repopulated at the start of
  every Generate cycle** — effectively a per-cycle reset, multiple
  times/day (on-demand) plus once/day (the overnight cycle).
- **Classification.** Temporary work queue, not time-retained — bounded
  by the cycle-clear behavior, not a prune.
- **Volume/growth.** Tens to low hundreds of rows, resets to near-zero
  every cycle — a real, cited, self-bounding figure, not an estimate.
- **Dependencies.** Populated from `leads`' enriched issue set. Related
  to `Send_Log` (which records the email this bridge ultimately feeds).
- **Open, documented gap (not resolved here):** whether a row for a lead
  that resolves **between** cycles is ever cleared before the next
  Generate is unconfirmed in the existing docs — a real incident (a
  specific lead ID) is cited as evidence this can go stale. This is a
  correctness question for the retention/lifecycle part of this review
  (Part 5), not a size one.
- **Redundancy signal.** None — the only human-in-the-loop review
  surface in the system; not structurally similar to any other tab.

### 4. `SLA_History`

- **Business purpose.** A long-lived **aggregate** time series (one row
  per snapshot run, not per lead) of how many leads were open and
  breaching each of 5 SLA checks. Exists specifically because
  `Movement_Log` is only kept 7 days — this is what lets the Tracking
  tab's issue-count-over-time chart go back further than a week.
- **Columns**: `date`, `openTotal`/`breachedTotal` (number), 5 per-check
  breached counts, `snapshot_at` (datetime, **the upsert key** —
  idempotency depends on this), `source` (text: which writer produced
  the row).
- **Entry method.** Code-generated by two writers sharing one schema,
  upserted by `snapshot_at` (never duplicates a run). A manual
  all-or-nothing clear button exists (irreversible).
- **Consumers.** Only the dashboard's Tracking tab chart.
- **Change frequency.** 4×/day, in the same capture pass as
  `Movement_Log`.
- **Classification.** Historical aggregate. Retention is genuinely
  `TBD` in the existing docs — **no prune function exists at all**, and
  it grows unbounded in practice. This is deliberate in the sense that
  the tab's whole purpose is to outlive `Movement_Log`, but "keep
  forever" has never been explicitly stated as policy anywhere in code.
- **Volume/growth.** ~4 rows/day × ~10 columns ≈ **~15K cells/year** — a
  real, cited figure; negligible against the shared 10-million-cell
  workbook ceiling.
- **Dependencies.** Derived from `Movement_Log` at capture time. Read
  alongside `Daily_Cohort_History` by the same Tracking tab.
- **Redundancy signal.** None structurally — a legitimate rollup/trend
  table, the standard pattern for keeping an aggregate after raw data
  expires. Sibling to `Daily_Cohort_History` (same role, different
  metric and grain — see below).

### 5. `Daily_Cohort_History`

- **Business purpose.** The **permanent** archive of each day's cohort
  outcome per region — how many leads entered, and how many resolved /
  became opportunities same-day and within 48h. Exists for the same
  reason as `SLA_History` (outliving `Movement_Log`'s 7-day window), but
  at a different grain (per date+region, not per snapshot run) and with
  a stronger guarantee: once a day's 48h window is complete, the row is
  treated as **immutable** and never re-written.
- **Columns**: `date_region` (the upsert key = `date`+`region`), `date`/
  `region`, `created` (leads entering that day), `same_day_resolved`/
  `same_day_opp`, `window_complete` (bool-ish — flips the row to
  immutable), `resolved_48h`/`opp_48h`/`closed_48h`, `updated_at`,
  `source`.
- **Entry method.** Code-generated by two writers sharing an **identical,
  code-comment-mandated** schema, upserted by `date_region`, with a hard
  rule (enforced in tests) never to re-write an already-archived date. A
  manual all-or-nothing clear button exists (irreversible).
- **Consumers.** Only the Tracking tab (Daily Cohort by Region +
  Week-over-Week views).
- **Change frequency.** 4×/day, guarded (only writes when a day's window
  actually completes).
- **Classification.** Historical, permanent archive. Retention is
  `TBD` in the docs — no prune exists; unbounded in practice, and this
  one is arguably the **most legitimate** "keep forever" candidate of
  all 13, since its entire reason to exist is being the long-term record
  `Movement_Log` structurally cannot be.
- **Volume/growth.** ~11 rows/day (one per region) × ~12 columns ≈
  **~48K cells/year** — real, cited, negligible.
- **Dependencies.** Derived from `Movement_Log` while the raw days still
  exist. Read alongside `SLA_History`.
- **Redundancy signal.** None — legitimately separate from
  `SLA_History` despite being a "sibling": different grain
  (date+region vs per-snapshot), and a fundamentally different
  mutability contract (freely-upsertable trend vs. immutable-once-
  complete archive). Merging these would lose the immutability guarantee
  that makes this tab trustworthy for historical reporting.

### 6. `RM_Hierarchy`

- **Business purpose.** The org chart, materialized as a sheet: for each
  RM, their team, role, and manager chain (TL → TM → RH → CH), plus an
  `excluded` routing flag and a free-text note. Exists so the scheduled
  issue emails can route to the specific responsible managers, and so
  the dashboard can label each RM's tier on the Repeat Offenders tab.
  **This is configuration data, not a log** — it is rebuilt in full from
  an in-code constant, not hand-authored in the sheet.
- **Columns**: `team`, `role` (S1 / A1 / TM / RH / Cluster Head / City
  Lead / Commercial Head / Executive / BDM / S3 / Manager), `name`,
  `tl`/`tm`/`rh`/`ch` (the manager chain, blank where a tier doesn't
  apply), `excluded` (bool-ish, **the one human-toggleable field in this
  tab**), `note` (free text), `email` (populated only if a separate,
  never-committed private file is present — otherwise always blank).
- **Entry method.** Full code rebuild from the `RM_HIERARCHY_RAW_`
  constant; the `excluded` flag alone is meant to be toggled directly in
  the sheet.
- **Consumers.** Backend recipient-bucket routing for every scheduled
  emailer; the dashboard's Repeat Offenders leaderboard rollup and
  leadership exclusion; a weekly automated audit for hierarchy gaps.
- **Change frequency.** Rebuilt on demand only (no time trigger) —
  effectively static between headcount changes.
- **Classification.** **Configuration** — a current-state table, not a
  time series. No retention concept applies; correctly has no prune
  function.
- **Volume.** **~270 rows**, with a real, cited role breakdown (S1 163,
  A1 23, Executive 8, BDM 8, Cluster Head 6, TM 6, S3 5, RH 4, City Lead
  3, Manager 1, Commercial Head 1). Grows only with real headcount
  changes.
- **Dependencies.** None upstream — its true source is the code
  constant, not another tab. Feeds `Manager_Directory` and, together
  with `Region_Recipients`, the full recipient-routing fallback chain.
- **Sensitivity — real, flagged in the existing docs.** Contains **real
  employee names**, and real employee emails when the (always-absent
  from this repo) private file is present. A backend job depends on it
  directly for routing.
- **Redundancy / architecture signal — real, worth carrying forward.**
  This tab's actual source of truth is a **code constant**
  (`RM_HIERARCHY_RAW_`), and the Sheet is a **rebuilt projection** of
  that constant for human visibility/editing. That is backwards for a
  proper data architecture: configuration data should live in the
  database as the source of truth, with code reading it — not the other
  way around. **Flag strongly for Part 3/6**: the target design should
  very likely make this a real configuration table in the database, with
  the "rebuild from code" step retired entirely once that table is
  editable directly (preserving the one legitimate need, the `excluded`
  human toggle).

### 7. `Manager_Directory`

- **Business purpose.** The hand-fillable address book for the manager
  buckets `RM_Hierarchy` produces. `RM_Hierarchy` derives **who** a
  flagged RM's manager is; this tab is where that manager's **email**
  lives, filled in by a human, since the private-email file that would
  otherwise supply it is never present in this deployment. Exists so
  routing can still reach a real inbox without that file.
- **Columns**: `manager_name`, `roles`, `regions` (covered), `email`
  (**hand-filled**; blank = a real routing gap), `people_reporting_up_to_them`,
  `email_source` (`private_file` / `manual` / blank).
- **Entry method.** Header and derived rows are code-generated on
  rebuild (from `RM_HIERARCHY_RAW_`); the `email` column is filled by a
  human.
- **Consumers.** Backend recipient-address resolution for scheduled
  emails; merged into the routing chain; a weekly automated audit flags
  any blank email as a gap.
- **Change frequency.** Rebuilt on demand (no time trigger); email
  edited by hand as needed.
- **Classification.** **Configuration** — a current-state address book,
  no history, correctly no retention concept.
- **Volume.** **UNCONFIRMED** — not directly stated in the existing
  docs. Inferable as roughly the count of manager-tier roles in
  `RM_Hierarchy` (TM + RH + Cluster Head + City Lead + Commercial Head +
  Executive ≈ 20–30 people going by that tab's cited role counts), but
  this is an inference, not a citation — **flag for live-Sheet
  confirmation** (Part 1's own open item, not resolved here).
- **Dependencies.** Depends on `RM_Hierarchy` (the chain it addresses).
  `Region_Recipients` is the next fallback layer after this one.
- **Sensitivity — real, flagged.** Contains real manager email
  addresses. A backend job depends on it directly.
- **Known open risk — real, unresolved in the existing docs.** It is
  **unconfirmed whether a rebuild preserves hand-filled `email` values
  or silently wipes them.** If a rebuild does wipe them, that is a real,
  currently-undetected data-loss path for manually-maintained routing
  config. This must be confirmed (by reading the rebuild function's
  actual merge logic, or testing it) before this review can recommend
  anything about consolidating or restructuring this tab.
- **Redundancy signal — real.** Conceptually overlaps with
  `RM_Hierarchy` (both are "who's who" configuration, joined by
  matching on name/role) but serves a genuinely distinct concern
  (routing structure vs. contact address). In a relational target, these
  two are strong candidates to become **one** `people`/`managers` table
  with an `email` column, rather than two sheets requiring a
  name-matching join — **flag for Part 2/3**, pending the rebuild-merge
  question above.

### 8. `Comment_History`

- **Business purpose.** A forward-looking, **append-only** record of
  every genuinely-new comment on an open lead, added 2026-09-05. Exists
  so the project starts accumulating an interaction history it never
  previously kept — explicitly framed as a dataset for **future**
  analysis of how RMs work leads over time. **Not consumed by the
  dashboard or any email today.**
- **Columns**: `date` (capture day), `lead_id`/`client_id`, `RM`/
  `region`/`project`, `comment` (the new comment text), `comment_at`
  (when the RM logged it), `logged_at` (when this row was written).
- **Entry method.** Code-generated, piggybacked on the 4×/day
  `Movement_Log` capture trigger, but **only writes when a comment is
  actually new** (de-duplicated by lead+comment, a deliberate hedge
  against a real Sheets date-coercion bug class documented elsewhere in
  this project).
- **Consumers.** **None in code** — reviewed and analyzed directly in
  the sheet.
- **Change frequency.** Piggybacks the 4×/day trigger, but the real
  write rate is comment-driven and much lower.
- **Classification.** Historical, append-only **by explicit design** —
  this is one of only two tabs (with `Unmatched_Comments_Log`) whose
  retention answer is already **confirmed**, not `TBD`: unbounded
  growth is accepted because the write rate is "an order of magnitude"
  below `Movement_Log`'s.
- **Volume/growth.** **UNCONFIRMED precise rate** — the existing docs
  state the comparison qualitatively (an order of magnitude below
  `Movement_Log`'s cited ~33,229 rows/day) but do not give a cited
  rows/day figure for this tab specifically. Flag for live-Sheet
  confirmation if the retention decision (Part 5) needs a harder number.
- **Dependencies.** Derived from `leads` via the piggyback scan;
  independent of every other tab.
- **Sensitivity.** Accumulates full free-text RM comment content plus
  customer context, indefinitely, with **zero code consumer** — flagged
  in the existing docs as the highest data-minimization concern among
  the low-operational-importance tabs, precisely because nothing reads
  it to justify the accumulation.
- **Redundancy signal.** Sibling to `Unmatched_Comments_Log` (same
  piggyback-logger mechanism) but captures fundamentally different data
  (every new comment vs. only unclassifiable ones) for a different
  purpose (future analysis vs. an active classifier-improvement
  feedback loop). Not redundant with each other.

### 9. `Unmatched_Comments_Log`

- **Business purpose.** Every open lead whose latest comment matches
  **no** comment-classification keyword rule is logged here for
  periodic human review — the feedback loop that makes the classifier's
  blind spots visible and fixable, rather than letting an unmatched
  comment silently read as "needs manual review" forever.
- **Columns**: `date`, `lead_id`/`RM`/`region`/`project`, `comment` (the
  unclassifiable text), `comment_at`, `logged_at`, `reviewed`
  (bool-ish, human-set once handled), `note` (reviewer's free text).
- **Entry method.** Code-generated, piggybacked on the same 4×/day
  trigger, de-duplicated; a human marks `reviewed` and periodically runs
  a manual function to clear reviewed rows.
- **Consumers.** A human reviewer only — improves the classifier keyword
  tables directly (there are two parallel keyword tables, one per
  runtime, both requiring a manual edit).
- **Change frequency.** Piggybacks the 4×/day trigger; writes only on an
  unclassifiable comment.
- **Classification.** Operational review queue — retention is
  **manually curated**, not time-limited: rows persist until a human
  reviews and clears them. This answer is confirmed, not `TBD`.
- **Volume/growth.** **UNCONFIRMED** — no cited rows/day figure exists
  in the current docs. A real, documented incident (2026-09-03) produced
  duplicate rows from a date-coercion bug, since fixed with a dedup
  function, but that incident doesn't establish a steady-state volume.
  Flag for live-Sheet confirmation.
- **Dependencies.** Derived from `leads` via the piggyback scan. Its
  purpose is to drive edits to classifier **code**, not to feed another
  tab.
- **Redundancy signal.** None with any tab other than its sibling
  `Comment_History` (see above) — and that sibling relationship is
  legitimate, not redundant.

### 10. `Send_Log`

- **Business purpose.** An append-only record of every region email the
  **dashboard** sends (via Gmail or a plain `mailto:` link) — subject,
  resolved recipients, region, lead count, and who sent it. Exists so
  there's a durable "we sent X to Y at Z" trail for the human-driven,
  on-demand send path, independent of anyone's personal Gmail Sent
  folder. The write is deliberately **fire-and-forget** — a logging
  failure never blocks the actual send.
- **Columns**: `sent_at`, `issue_key`/`issue_label` (which SLA digest),
  `region`, `subject`, `to`/`cc` (resolved recipients), `lead_count`,
  `sent_by` (the signed-in user's own email).
- **Entry method.** Code-generated, written **only from the browser**
  (no Apps Script writer at all), fire-and-forget.
- **Consumers.** **None in code** — a manual audit surface only.
- **Change frequency.** On each dashboard-initiated send (human-
  triggered, on-demand).
- **Classification.** Historical audit log. Retention is `TBD` — **no
  prune function AND no manual clear function of any kind exist for
  this tab**, the only one of the 13 with zero removal path at all.
- **Volume/growth.** Realistically ~10–50 rows/day × 9 columns → low
  tens of thousands of cells/year — real, cited, low but **strictly
  unbounded**.
- **Dependencies.** Records sends of digests ultimately built from
  `leads`-derived issues. Sibling to `AllIssues_Log` and `Overnight_Log`
  (see the consolidated note under #13 below).
- **Sensitivity.** Contains resolved recipient email addresses **and**
  the signed-in sender's own email — a real data-minimization
  consideration flagged in the existing docs.
- **Known risk — real, flagged, unresolved.** This tab has **no
  self-healing header check**, unlike every one of its sibling log
  tabs. Because the write is fire-and-forget, a header/column-order
  mismatch would corrupt rows **silently**, with no error surfaced
  anywhere. This is a real, documented gap, not a hypothetical.
- **Redundancy signal — real, the strongest in this inventory.** See the
  combined note under `Overnight_Log` (#13) below: `Send_Log`,
  `AllIssues_Log`, and `Overnight_Log` are three independently-written,
  overlapping-schema "we sent an email" audit logs for three different
  send paths.

### 11. `Region_Recipients`

- **Business purpose.** The **backend's** per-region recipient fallback
  list — a simple `region → to / cc` table the scheduled emails fall
  back to whenever `RM_Hierarchy` can't resolve a specific manager
  bucket, which is the **normal case** in this deployment (the private
  email file is always absent). Guarantees a scheduled digest always has
  somewhere real to go.
- **Columns**: `region` (normalized name), `to` (address list), `cc`
  (address list).
- **Entry method.** Header code-generated on first use; the address
  values are **hand-filled** by a human.
- **Consumers.** The scheduled emailers' recipient-fallback resolution;
  also consulted as a last-resort primary bucket by the hierarchy
  resolver.
- **Change frequency.** Created lazily on first use; edited by hand as
  regions/addresses change.
- **Classification.** **Configuration** — a hand-maintained fallback
  address table, no history, correctly no retention concept.
- **Volume.** **UNCONFIRMED** exact row count — not directly cited.
  Reasonably inferable as roughly the operational region count (likely
  single digits to around a dozen, going by the project's region-based
  filtering elsewhere in the dashboard), but this is inference, not a
  citation. Flag for live-Sheet confirmation.
- **Dependencies.** Independent of `leads`. Sits below `RM_Hierarchy` +
  `Manager_Directory` as the final fallback layer in the routing chain.
- **Sensitivity.** Contains real recipient email addresses. A backend
  job depends on it directly.
- **Redundancy / architecture signal — real, important.** The
  dashboard's **own** per-region recipient editor is a **completely
  separate, browser-`localStorage`-backed store** that does **not** read
  or write this tab at all. This means there are currently **two
  independent, unsynchronized sources of truth** for "who gets region
  X's email" — one the scheduled (backend) jobs use, one the
  human-driven dashboard flow uses — with no mechanism keeping them
  consistent. This is a genuine, real architectural gap worth carrying
  forward strongly into Part 2/3/6: a single shared `region_recipients`
  reference table, read by both runtimes, would remove a real
  inconsistency risk (a region correctly configured on one side could be
  silently wrong or missing on the other).

### 12. `AllIssues_Log`

- **Business purpose.** The send-audit log specifically for the 17:00
  IST `AllIssuesEmailer` scheduled run — one row per region digest sent,
  recording the resolved recipients, lead count, send time, and the
  Gmail thread id. Exists so that unattended 17:00 run has its own
  durable "what did I send" trail, kept separate from the dashboard's
  `Send_Log` and from `Overnight_Log`.
- **Columns**: `date`, `region`, `bucket_label` (the recipient bucket),
  `primary_role` (TL/TM/RH/CH), `to`/`cc`, `lead_count`, `sent_at`,
  `thread_id`.
- **Entry method.** Code-generated, **only** by the 17:00 job, with a
  self-healing header (missing columns are appended automatically on
  next run).
- **Consumers.** The 17:00 job itself only, for within-run dedupe/debug
  — **no dashboard reader at all**.
- **Change frequency.** Once/day, one row per region.
- **Classification.** Historical send-audit log. Retention `TBD` — no
  prune, no clear function exists.
- **Volume/growth.** ~11 rows/day (one per region) × 9 columns ≈
  **~36K cells/year** — real, cited, negligible. Because it's read only
  by its own writer for within-run purposes, pruning old rows is
  explicitly noted as **functionally safe** in the existing analysis —
  no downstream consumer would be affected.
- **Dependencies.** Records sends of digests built from `leads`-derived
  issues. Sibling to `Send_Log` and `Overnight_Log`.
- **Sensitivity.** Recipient email addresses.
- **Redundancy signal.** Same pattern as `Send_Log` — see the combined
  note under `Overnight_Log` immediately below. Of the three send-audit
  logs, this one has the **lowest** functional coupling (nothing reads
  it except its own writer, for its own run), making it the safest of
  the three to prune or consolidate.

### 13. `Overnight_Log`

- **Business purpose.** The **functional** state bridge between the
  `OvernightEmailer` script's two daily runs. The 10:00 IST send records,
  per region, the Gmail thread id, the exact resolved `to`/`cc`, the
  subject, and which leads it covered. The 13:00 IST follow-up **reads
  this back** to reply on that **same thread**, to those **same real
  people** — something Gmail's own reply-all cannot do correctly (it
  hard-codes the recipient to whoever sent the last message on the
  thread). Without this tab, the 13:00 follow-up would have no way to
  find its own thread or its own audience.
- **Columns**: `date`, `region`, `thread_id` (**the 13:00 run replies
  here**), `lead_ids_json` (the leads the 10:00 email flagged, as a JSON
  array), `sent_at`, `to`/`cc` (the **actual resolved** recipients, kept
  explicitly so the 13:00 reply reaches the same people), `subject`.
- **Entry method.** Code-generated — written by the 10:00 run, read by
  the 13:00 run, both in the same script. A manual repair function
  exists for rows written before the resolved-recipient capture was
  added.
- **Consumers.** The 13:00 run of the **same** script — a genuine
  **functional** read (not just an audit trail): a missing or corrupt
  today-row breaks that region's 1pm follow-up outright.
- **Change frequency.** Written once/day at 10:00, read once/day at
  13:00.
- **Classification.** Operational **same-day state handoff** — not a
  permanent record. Retention `TBD` — no prune exists, but the existing
  docs are explicit that **only ~today's rows are ever functionally
  needed**; everything older is pure dead weight that nothing ever
  reads again. This is flagged as the **single clearest prune candidate**
  of all 13 tabs.
- **Volume/growth.** ~11 rows/day × 8 columns ≈ **~32K cells/year** —
  real, cited, small in absolute size, but with the unusual property
  that essentially 100% of rows past "today" serve zero purpose.
- **Dependencies.** Records sends of digests built from `leads`-derived
  issues. Related to `Lead_Followups` as the other piece of
  overnight-cycle state.
- **Sensitivity.** Recipient addresses plus `lead_ids_json`.
- **Known risk — real, flagged.** This is the **one** trigger pair in
  the entire project that lacks an explicit timezone pin on its
  schedule — a documented outlier worth carrying into the risk section
  (Part 11), independent of the retention question.
- **Redundancy signal — the strongest pattern in this whole inventory,
  combined with #10 and #12 above.** `Send_Log`, `AllIssues_Log`, and
  `Overnight_Log` are **three separately-written, independently-pruned
  (or unpruned) audit logs with substantially overlapping columns**
  (region, resolved `to`/`cc`, a lead count or lead-id list, a send
  timestamp, and — for two of the three — a Gmail `thread_id`), one per
  distinct send *mechanism* (human dashboard send / 17:00 scheduled
  digest / 10:00+13:00 scheduled digest pair). This is a real, structural
  duplication worth a serious look in Part 2/3: a single `email_sends`
  table with a `channel` discriminator column (`dashboard` /
  `all_issues_17h` / `overnight_10h`) could plausibly replace all
  three **for audit purposes** — **except** `Overnight_Log` carries a
  genuine functional dependency (the 13:00 read) that the other two
  don't have, and that read needs to stay fast and same-day-scoped
  regardless of how the audit trail itself is modeled. Any consolidation
  proposal in Part 3 must preserve that specific functional read path
  distinctly from the general audit-log concern.

---

*(Part 1 complete. Continues in Part 2 — data relationships + merge/split
decisions — building directly on the redundancy signals flagged above:
the `Daily_RM_Issues` vs. `Movement_Log` derivation question, the
`RM_Hierarchy`/`Manager_Directory` people-table question, the
`Region_Recipients` vs. dashboard-`localStorage` split-source-of-truth
problem, and the three-way `Send_Log`/`AllIssues_Log`/`Overnight_Log`
audit-log overlap.)*
