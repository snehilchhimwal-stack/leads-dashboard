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

*(Part 1 complete.)*

---

## Part 2 — Data Relationships + Merge/Split Decisions

### Entity-type classification

Using the brief's own vocabulary (entity / transaction-event / lookup-
reference / configuration / log / queue / snapshot / report):

| Tab | Type | Why |
|---|---|---|
| `Movement_Log` | **Snapshot** | Point-in-time state capture of open leads, 4×/day — not a discrete business event, a repeated freeze-frame |
| `Daily_RM_Issues` | **Snapshot (distilled) / log** | A nightly, filtered re-capture of the same underlying open-lead state, one row per lead×issue |
| `Lead_Followups` | **Queue** | A working set, cleared and repopulated every cycle — never a permanent record |
| `SLA_History` | **Report (aggregate)** | Pre-computed totals per snapshot run, built specifically for a chart |
| `Daily_Cohort_History` | **Report (aggregate, archival)** | Pre-computed per-day-per-region outcomes, immutable once complete |
| `RM_Hierarchy` | **Entity + configuration** | One row per real person (the RM/employee entity) with structural attributes — configuration only in the sense that it's rebuilt from code today, not in what it represents |
| `Manager_Directory` | **Lookup-reference** | A derived address lookup keyed off the same people `RM_Hierarchy` already models |
| `Comment_History` | **Log** | Append-only event log, one row per genuinely-new comment |
| `Unmatched_Comments_Log` | **Log + queue (hybrid)** | An event log that also functions as an active human review queue until cleared |
| `Send_Log` | **Transaction-event / log** | One row per discrete "an email was sent" event |
| `Region_Recipients` | **Lookup-reference / configuration** | A hand-maintained region → address mapping |
| `AllIssues_Log` | **Transaction-event / log** | Same shape as `Send_Log`, different send channel |
| `Overnight_Log` | **Transaction-event / log + functional state** | Structurally a send log, but also the only one of the three with a genuine same-day functional read |

**`leads` itself** (out of scope, noted only for context) is the root
**entity** table — the "lead" business object every other tab in this
review either snapshots, derives from, or references.

### Primary-key candidates and foreign-key relationships

None of these 13 tabs currently use a surrogate primary key — every one
relies on a natural or composite key (a name, a date, a timestamp). That
is a real, structural finding in its own right (carried into the target
schema in Part 3), not just a list of what the keys happen to be today.

| Tab | Current de-facto key | Real FK relationships today (unenforced) |
|---|---|---|
| `Movement_Log` | composite (`lead_id`, `snapshot_at`) | `lead_id`/`client_id` → `leads`; `RM` → `RM_Hierarchy.name` (free text, no constraint) |
| `Daily_RM_Issues` | composite (`lead_id`, `issue_key`, `date`) | same as above |
| `Lead_Followups` | `lead_id` (true upsert key, but only unique *within* a cycle) | `RM` → `RM_Hierarchy.name`; `region` → (no canonical regions table exists — see below) |
| `SLA_History` | `snapshot_at` (real upsert key) | none — a pure aggregate fact table, no entity reference at all |
| `Daily_Cohort_History` | `date_region` (composite, real upsert key) | `region` → (no canonical regions table) |
| `RM_Hierarchy` | `name` (implied — **a real risk**, see below) | `tl`/`tm`/`rh`/`ch` are self-referencing (name → name) |
| `Manager_Directory` | `manager_name` (implied) | `manager_name` → `RM_Hierarchy.name` (the manager-tier rows) |
| `Comment_History` | composite (`lead_id`, `comment`) per its own dedup key | `lead_id` → `leads`; `RM` → `RM_Hierarchy.name` |
| `Unmatched_Comments_Log` | composite (`lead_id`, `comment_at`-or-`comment`) | same shape |
| `Send_Log` | none — `sent_at` alone isn't guaranteed unique | `region` → (no regions table); `sent_by` → `RM_Hierarchy.name`/email (loosely) |
| `Region_Recipients` | `region` (natural key) | none upstream |
| `AllIssues_Log` | composite (`date`, `region`), plus `thread_id` as an external key | `region` → (no regions table) |
| `Overnight_Log` | composite (`date`, `region`) — how the 13:00 run actually looks a row up | `region` → (no regions table); `thread_id` is a real external (Gmail) key |

**Two structural gaps this surfaces, both real and both worth carrying
into Part 3's schema design:**

1. **`RM_Hierarchy.name` is the closest thing to a "person" primary key
   in the whole system, and it is a bare name string.** Six other tabs
   (`Movement_Log`, `Daily_RM_Issues`, `Lead_Followups`,
   `Comment_History`, `Unmatched_Comments_Log`, `Send_Log.sent_by`) all
   reference "the RM" by free-text name with **zero referential
   integrity** — nothing prevents a typo, a since-renamed RM, or two
   different real people who happen to share a name from silently
   producing wrong or orphaned joins. A real surrogate `rm_id` is a
   strong candidate for the target schema.
2. **There is no `regions` reference table anywhere in the current
   system, in the Sheet or in code** — region names are normalized by a
   *function* (`mainRegionForGs_`), not validated against a *stored*
   list. Eight of the 13 tabs carry a free-text `region` column with no
   canonical source to check it against.

### Duplicate / repeated columns across tabs

| Column concept | Appears in (count) | Assessment |
|---|---|---|
| `lead_id` | `Movement_Log`, `Daily_RM_Issues`, `Lead_Followups`, `Comment_History`, `Unmatched_Comments_Log` (5) | Legitimate FK repetition — expected in any relational model too; needs a real constraint, not a merge |
| `RM` (free text) | `Movement_Log`, `Daily_RM_Issues`, `Lead_Followups`, `Comment_History`, `Unmatched_Comments_Log`, `RM_Hierarchy.name`, `Send_Log.sent_by` (7) | The referential-integrity gap above |
| `region` (free text) | `Movement_Log`, `Daily_RM_Issues`, `Lead_Followups`, `Daily_Cohort_History`, `Region_Recipients`, `AllIssues_Log`, `Overnight_Log`, `Manager_Directory.regions` (8) | The missing-reference-table gap above |
| `project` (free text) | `Movement_Log`, `Daily_RM_Issues`, `Comment_History`, `Unmatched_Comments_Log` (4) | Same shape as `region`, lower priority (not flagged as a routing dependency anywhere in Part 1) |
| `to`/`cc` (address lists) | `Send_Log`, `Region_Recipients`, `AllIssues_Log`, `Overnight_Log` (4) | See the split/retain discussion below — different verdict for the audit logs vs. the configuration table |
| an event timestamp, differently named (`snapshot_at`/`captured_at`/`logged_at`/`sent_at`) | nearly every tab | A naming-consistency question (Part 4), not a structural one — several tables (`Comment_History`) genuinely need **two** distinct timestamps and must keep them separate |
| `source` (which writer produced this row) | `SLA_History`, `Daily_Cohort_History` | A legitimate, small, shared provenance concept — a good enum candidate (below) |
| `thread_id` | `AllIssues_Log`, `Overnight_Log` | A legitimate shared concept (a Gmail thread reference) |

### Normalize vs. intentionally denormalize

**Keep denormalized, on purpose:** the free-text `RM`/`region`/`project`
copies inside `Movement_Log`, `Daily_RM_Issues`, `Comment_History`, and
`Unmatched_Comments_Log` are **snapshot/event rows** — they must freeze
what was true *at capture time*, even if the real RM's team, region, or
active status changes later. Replacing these with a live FK to a
current-state `people` table would silently rewrite history every time
someone's assignment changes. This is the standard "snapshot/history
table denormalizes on purpose" pattern, and the brief's own instruction
not to normalize for theory's sake applies directly here — **no change
recommended** to these columns' denormalized nature.

**Keep denormalized (aggregate), on purpose:** `SLA_History` and
`Daily_Cohort_History` are pre-computed rollups built specifically so a
chart can read a small number of rows across a long time span instead of
re-scanning raw snapshot data on every page load. Collapsing them back
into "just query the raw table" would trade a cheap read for an
expensive one, for no correctness benefit — **no change recommended**.

**Should normalize:** the *current-state* tables — a target `people`
table (replacing `RM_Hierarchy`'s role, and merging in
`Manager_Directory`'s email) and a new `regions` table — should be real,
constrained reference data that the *live* config tables (`Region_Recipients`,
and any future recipient/routing config) foreign-key into. The
snapshot/log tables above keep their own frozen copy regardless; the
normalization gap is specifically in the *configuration* layer, which
today has no real reference tables to normalize against at all.

### Columns mixing multiple concepts (split candidates)

| Column | Tab | What's mixed | Split recommendation |
|---|---|---|---|
| `lead_ids_json` | `Overnight_Log` | A list of lead FKs crammed into one JSON-text cell | Split into a child table (`overnight_log_leads`: one row per send × lead) — the 13:00 run already needs to iterate individual lead ids from it, which a real child table serves natively |
| `people_reporting_up_to_them` | `Manager_Directory` | A flattened, likely comma-separated list of names — data that `RM_Hierarchy`'s own `tl`/`tm`/`rh`/`ch` chain already encodes relationally | Likely **remove** as a stored column and compute it from the chain on read instead — **pending confirmation** this column has no independent hand-edited source (flagged, not certain) |
| `to` / `cc` on the 3 audit logs | `Send_Log`, `AllIssues_Log`, `Overnight_Log` | A list of addresses in one text field | **Retain as-is** — nothing queries or joins on an individual address inside these; they exist purely for audit display. Splitting adds schema complexity with no query benefit — explicitly *not* recommended, per the brief's own "don't normalize for theory" instruction |
| `to` / `cc` on `Region_Recipients` | `Region_Recipients` | Same shape, but this table drives live routing *logic*, not just audit display | **Judgment call, not a firm recommendation** — worth a real child table only if per-address enable/disable or a recipient-management UI is ever wanted. Deferred to Part 3, and flagged as a question for the business (Part 11), not something inferable from the data alone |

### Columns representing the same concept, different names (merge candidates)

Genuine renames-not-merges: the various `*_at` timestamp columns
(`snapshot_at`, `captured_at`, `logged_at`, `sent_at`) all mean "when did
this row's event happen," just named per the table's own vocabulary — a
**naming-consistency** recommendation belongs in Part 4's column
consolidation pass, not a structural merge here (several tables, like
`Comment_History`'s `comment_at` **and** `logged_at`, genuinely need two
separate timestamps and must not be collapsed into one).

One real false-friend worth flagging explicitly: `RM_Hierarchy.note`
and `Unmatched_Comments_Log.note` share a column *name* but represent
**different concepts** (a hierarchy annotation vs. a reviewer's note) —
called out here specifically as a reminder that identical names don't
always mean mergeable columns.

### Tabs that can safely be merged, and why

- **`Daily_RM_Issues` into a derived/materialized query over
  `Movement_Log`** — it is explicitly backfillable *from*
  `Movement_Log` today, meaning it is already understood as a derived
  dataset, not an independently-sourced one. The two schemas have to be
  hand-kept-in-sync as columns get added (both separately gained `TL`/
  `group_source`/`source_bucket`/`lead_assigned_at` after the fact) —
  a real sign of drift risk between "one concept, two physical tables."
- **`RM_Hierarchy` + `Manager_Directory` into one `people` entity** —
  `Manager_Directory` is explicitly derived from the same
  `RM_HIERARCHY_RAW_` source per Part 1, and exists only to hold an
  `email` attribute for a subset of the people `RM_Hierarchy` already
  rows. This is one entity (a person) with attributes split across two
  sheets joined by name.
- **`Send_Log` + `AllIssues_Log` + `Overnight_Log`, for audit purposes
  only** — three physical tables recording the same underlying fact
  ("an email was sent") for three different send channels, with
  overlapping columns and three separately-managed (or entirely
  unmanaged) retention policies.

### Tabs that should remain separate, and why

- **`SLA_History` and `Daily_Cohort_History`** — despite both being
  long-lived aggregates outliving `Movement_Log`, they differ in grain
  (per-snapshot-run vs. per-date-region) and, more importantly, in
  mutability contract: `Daily_Cohort_History` is immutable once a day's
  window completes, `SLA_History` is freely upsertable. Merging would
  destroy that immutability guarantee for one of the two.
- **`Comment_History` and `Unmatched_Comments_Log`** — same piggyback
  capture mechanism, but genuinely different purpose and audience:
  one is a forward-looking analysis capture nothing reads yet, the
  other is an active, human-worked classifier-improvement queue.
- **`Lead_Followups`** — the only human-in-the-loop review surface in
  the system; no other tab shares its "one hard-contract, human-only
  column" shape or its per-cycle-reset lifecycle.
- **`Overnight_Log`'s functional role**, even after an audit-log
  merge with `Send_Log`/`AllIssues_Log` — its same-day read by the
  13:00 follow-up is a *functional* dependency, not an audit one, and
  must be preserved as a fast, reliably-indexed lookup regardless of how
  the audit-trail data itself is modeled.

### Merge / Split / Rename / Remove decision table

| Current Structure | Recommendation | Target Structure | Reason | Risk |
|---|---|---|---|---|
| `Daily_RM_Issues` (whole tab) | Merge into a derived/materialized nightly query over `Movement_Log` | A materialized nightly job output (not a live view — preserves current read performance) filtered to SLA-flagged open leads | Explicitly backfillable from `Movement_Log`; the two schemas already drift and require hand-sync on every new column | **Medium** — the Repeat Offenders leaderboard's current read pattern must stay just as fast; recommend a nightly ETL materialization, not a live join, to preserve behavior |
| `RM_Hierarchy` + `Manager_Directory` | Merge | One `people` table: role/team/hierarchy chain/`excluded` flag + `email` | Same underlying entity (a person), `Manager_Directory` is explicitly derived from `RM_HIERARCHY_RAW_` already | **High** — whether a rebuild today preserves hand-filled emails is **unconfirmed**; this must be verified before migration, not assumed |
| `Region_Recipients` (backend) + dashboard's `localStorage` recipient store | Unify | One `region_recipients` table, read by both runtimes | Two independent, unsynced sources of truth for the same routing concept today | **High** — a real behavior/UX change for the dashboard, not just a data migration; may remove a per-browser customization users currently rely on — needs a business confirmation, not just a technical migration |
| `Send_Log` + `AllIssues_Log` + `Overnight_Log` | Partial merge (audit layer only) | One `email_sends` table with a `channel` enum; `Overnight_Log`'s functional same-day lookup preserved as an indexed query, not a separate physical table | Three overlapping audit logs for one underlying concept, three separately-managed retention gaps | **Medium** — `Overnight_Log`'s 13:00 functional read must stay fast; requires an index on (channel, date, region) in the merged table |
| `RM_Hierarchy`'s `tl`/`tm`/`rh`/`ch` columns | Retain as-is — do **not** normalize into a flexible parent-pointer tree | Unchanged, 4 named columns on the target `people` table | The business hierarchy is a fixed, known depth; a flexible tree adds real query complexity (recursive lookups) for no business benefit here | **Low** — explicit "don't change" call |
| `Overnight_Log.lead_ids_json` | Split | Child table `overnight_log_leads (send_id FK, lead_id)` | The 13:00 run already needs to iterate individual lead ids; a JSON blob defeats indexing | **Low–Medium** — small table, the real work is a code-path change in the 13:00 reader, not data risk |
| `to`/`cc` on the 3 audit logs | Retain as-is (denormalized text) | Unchanged in the merged `email_sends` table | Pure audit/display fields, nothing queries into individual addresses | **Low** — explicit "don't over-normalize" call |
| `to`/`cc` on `Region_Recipients` | Judgment call — no firm recommendation | Either retained as text or split into a real recipients table | Drives live routing logic, not just display — the only one of the four `to`/`cc` columns where normalizing might pay off | **Low**, but the decision itself needs a business answer (is a recipient-management UI ever planned?) — see Part 11 |
| Free-text `RM` name on **live/config** tables | Normalize | Real FK to the new `people.rm_id` | Zero referential integrity today; a typo silently orphans a row | **Medium** — requires write-time validation, a real code change (Part 7), not just schema |
| Free-text `RM` name on **snapshot/log** tables | Retain as denormalized text | Unchanged — frozen point-in-time copy | Snapshot history must not silently rewrite when a live record changes | **Low** — explicit "don't change" call |
| `region` free text (8 tables), no reference table exists | Create new `regions` table | New reference table backing what `mainRegionForGs_` computes in code today | No stored, canonical list of valid regions exists anywhere in the current system | **Medium** — genuinely new infrastructure; needs the real, current region list confirmed by the business, not inferred |
| `Movement_Log.snapshot_label`, `SLA_History.source`, `Daily_Cohort_History.source`, `Manager_Directory.email_source` | Convert to enum/constrained type | Database CHECK constraint / enum per column | Each already has a small, known, cited value set; an enum catches a bad value at write time | **Low** — safe tightening; verify against live data first for any uncited 4th value |
| `Manager_Directory.people_reporting_up_to_them` | Likely remove | Computed on read from the target `people` table's chain columns instead of stored | Appears fully derivable from `RM_Hierarchy`'s own chain columns | **Medium** — needs confirmation this column is never independently hand-edited before removing it |

*(Part 2 complete.)*

---

## Part 3 — Target Database Schema

**Notation.** Types are given engine-agnostic (`TEXT`, `INTEGER`,
`BOOLEAN`, `DATE`, `TIMESTAMP`, `ENUM(...)`, `JSON`) — the actual engine
choice is a Part 6 (Target Architecture) decision, not assumed here.
Every table gets a real surrogate primary key even where the current
Sheet relies on a natural/composite key, per Part 2's finding that none
of the 13 tabs has one today — surrogate keys are cheap, avoid the
name-collision risk flagged on `people`, and don't preclude also placing
a `UNIQUE` constraint on the natural key where one genuinely exists.
`leads` stays **out of scope** — every reference to it below is a
*logical* pointer (`lead_id TEXT`, no enforced FK, since this review
does not touch that table's own schema), not a designed relationship.

### 1. `people` — entity, reference/configuration

**Purpose.** The org chart as real relational data — merges `RM_Hierarchy`
and `Manager_Directory` per Part 2's decision, since both describe the
same underlying person.

| Column | Type | Null? | Notes |
|---|---|---|---|
| `person_id` | INTEGER | NOT NULL | **PK**, surrogate |
| `name` | TEXT | NOT NULL | Display name — **not** unique-constrained (a real name collision is a known, documented risk; see Part 11's question about whether a real employee-ID system exists) |
| `team` | TEXT | NOT NULL | |
| `role` | ENUM(`S1`,`A1`,`TM`,`RH`,`Cluster Head`,`City Lead`,`Commercial Head`,`Executive`,`BDM`,`S3`,`Manager`) | NOT NULL | Closed set, cited from the real current distribution |
| `tl_id` | INTEGER | NULL | **FK → `people.person_id`** (self-referencing) |
| `tm_id` | INTEGER | NULL | **FK → `people.person_id`** |
| `rh_id` | INTEGER | NULL | **FK → `people.person_id`** |
| `ch_id` | INTEGER | NULL | **FK → `people.person_id`** |
| `excluded` | BOOLEAN | NOT NULL, default `false` | Routing/ranking exclusion flag — the one field meant to be human-editable directly |
| `note` | TEXT | NULL | Free text |
| `email` | TEXT | NULL | Blank = a real routing gap (matches current behavior) |
| `email_source` | ENUM(`private_file`,`manual`) | NULL | |
| `active` | BOOLEAN | NOT NULL, default `true` | New — replaces "delete the row" for someone who leaves, preserving history for anything that already referenced them |

**Indexes:** `(name)`, `(role)`, `(tl_id)`/`(tm_id)`/`(rh_id)`/`(ch_id)`
(hierarchy traversal).
**Unique constraints:** none beyond the PK — see the name-collision note.
**Retention:** permanent, current-state entity — no time-based policy
applies (matches `RM_Hierarchy`/`Manager_Directory`'s existing "N/A,
configuration" classification).
**Relationships:** self-referencing hierarchy; referenced (logically,
not by hard FK — see below) from every operational/log table that
carries an `RM` name today; multi-region coverage lives in
`person_regions` (table 13, added in Part 4), not on this table
directly.
**Design note — kept the fixed 4-column chain (`tl_id`/`tm_id`/`rh_id`/
`ch_id`), not a generic parent-pointer tree,** per Part 2's explicit
"don't normalize for theory" call — the business hierarchy is a fixed,
known depth.

### 2. `regions` — reference

**Purpose.** New table — **no equivalent exists today**, in the Sheet or
in code. Region normalization currently happens inside a code function
(`mainRegionForGs_`) with nothing to validate against. Flagged in Part 2
as needing the business's real, current region list to populate — the
columns below are the minimum shape needed; the actual rows are **not
invented here**.

| Column | Type | Null? | Notes |
|---|---|---|---|
| `region_id` | INTEGER | NOT NULL | **PK**, surrogate |
| `region_name` | TEXT | NOT NULL | **UNIQUE** |
| `active` | BOOLEAN | NOT NULL, default `true` | |

**Indexes:** `(region_name)`.
**Retention:** permanent, reference data.
**Relationships:** referenced by `region_recipients` and by
`person_regions` (table 13, added in Part 4); every snapshot/log table
below keeps its own frozen `region_name` text copy (see the
denormalization note under `movement_snapshots`) rather than a hard FK,
for the same historical-accuracy reason `people` isn't hard-FK'd from
those tables either.

### 3. `region_recipients` — configuration

**Purpose.** Replaces `Region_Recipients`, and — pending the business
confirmation flagged in Part 6/11 — becomes the **single** source both
the backend jobs and the dashboard read, closing the split-source-of-
truth gap Part 2 flagged as the strongest single finding in this review.

| Column | Type | Null? | Notes |
|---|---|---|---|
| `region_id` | INTEGER | NOT NULL | **PK, FK → `regions.region_id`** |
| `to_addresses` | TEXT | NULL | Kept as a denormalized delimited list — see Part 2's judgment-call note; splitting into a per-address child table is optional, not recommended by default |
| `cc_addresses` | TEXT | NULL | Same |
| `updated_at` | TIMESTAMP | NOT NULL | New — the current tab has no way to tell when an address was last changed |

**Retention:** permanent, configuration.
**Relationships:** `region_id` → `regions`.

### 4. `movement_snapshots` — operational snapshot

**Purpose.** Replaces `Movement_Log` — the 4×/day frozen state capture.

| Column | Type | Null? | Notes |
|---|---|---|---|
| `snapshot_id` | INTEGER | NOT NULL | **PK**, surrogate (a composite `lead_id`+`snapshot_at` key was considered but a surrogate is safer against any future double-write edge case) |
| `snapshot_at` | TIMESTAMP | NOT NULL | |
| `snapshot_label` | ENUM(`periodic`,`manual`) | NOT NULL | Converted from free text per Part 2 |
| `lead_id` | TEXT | NOT NULL | Logical reference to `leads` (out of scope) |
| `client_id` | TEXT | NOT NULL | |
| `client_name` | TEXT | NOT NULL | **Added in Part 4** — missed in the first schema pass; `Movement_Log`'s real column list has both `client_id` and a separate `client` (name) column, confirmed against `SNAPSHOT_COLUMNS_` |
| `rm_name` | TEXT | NOT NULL | **Deliberately denormalized** — a frozen point-in-time copy, not a FK to `people`. Normalizing this would silently rewrite history when an RM's record changes later (Part 2's explicit finding) |
| `tl_name` | TEXT | NULL | Same denormalization reasoning |
| `project` | TEXT | NOT NULL | |
| `region_name` | TEXT | NOT NULL | Same denormalization reasoning as `rm_name` |
| `lead_assigned_at` | TIMESTAMP | NULL | |
| `group_source` | TEXT | NULL | |
| `source_bucket` | TEXT | NULL | |
| `current_stage` | TEXT | NULL | |
| `last_connect` | TIMESTAMP | NULL | |
| `last_connect_time` | TIMESTAMP | NULL | |
| `last_comment` | TEXT | NULL | |
| `internal_status_comments` | TEXT | NULL | |
| `closing_reason` | TEXT | NULL | |
| `call_attempts` | INTEGER | NULL | |
| `call_count` | INTEGER | NULL | |
| `duration` | INTEGER | NULL | |
| `stage_comments` | TEXT | NULL | |
| `rm_is_active` | BOOLEAN | NULL | Nullable **on purpose** — rows from before 2026-09-01 genuinely have no value here; not an error state |
| `lead_closing_reason` | TEXT | NULL | Same schema-evolution reasoning |

**Indexes:** `(lead_id, snapshot_at)`, `(snapshot_at)` (for the retention
prune), `(rm_name, snapshot_at)` (RM-performance queries), `(region_name,
snapshot_at)`.
**Retention:** **7 days**, carried forward unchanged from
`MOVEMENT_LOG_RETENTION_DAYS` — a confirmed, already-correct policy, not
revisited here.
**Relationships:** feeds `sla_history`, `daily_cohort_history`;
`daily_rm_issues` (below) is now *derived from* this table rather than
independently written.
**Classification:** operational snapshot history.

### 5. `daily_rm_issues` — operational snapshot (materialized)

**Purpose.** Replaces `Daily_RM_Issues`. Per Part 2's merge decision,
this is now the **output of a nightly materialization job** reading
`movement_snapshots`, not an independently dual-written table — closing
the schema-drift risk flagged in Part 1/2 (both tables independently
gained the same 4 columns after the fact). The physical table itself
still exists (a materialized result has to land somewhere, and the
Repeat Offenders leaderboard's current read performance must be
preserved) — what changes is *how it's populated*, not its shape.

| Column | Type | Null? | Notes |
|---|---|---|---|
| `issue_id` | INTEGER | NOT NULL | **PK**, surrogate |
| `capture_date` | DATE | NOT NULL | The capture date (unchanged semantics — not the assignment date) |
| `lead_id` | TEXT | NOT NULL | |
| `client_id` | TEXT | NOT NULL | |
| `rm_name` | TEXT | NOT NULL | Denormalized, same reasoning as `movement_snapshots` |
| `tl_name` | TEXT | NULL | |
| `region_name` | TEXT | NOT NULL | Denormalized |
| `project` | TEXT | NOT NULL | |
| `group_source` | TEXT | NULL | |
| `source_bucket` | TEXT | NULL | |
| `issue_key` | TEXT | NOT NULL | |
| `issue_label` | TEXT | NOT NULL | |
| `captured_at` | TIMESTAMP | NOT NULL | |
| `lead_assigned_at` | TIMESTAMP | NULL | |

**Indexes:** `(capture_date, rm_name)`, `(capture_date, region_name)` —
matches the leaderboard's real query shapes (RM / Region / A1-TM / RH
rollups).
**Retention:** **7 days**, unchanged.
**Relationships:** derived from `movement_snapshots`.
**Classification:** operational snapshot (materialized/derived).

### 6. `lead_followups` — temporary operational queue

**Purpose.** Replaces `Lead_Followups` — the human-review bridge.

| Column | Type | Null? | Notes |
|---|---|---|---|
| `lead_id` | TEXT | NOT NULL | **PK** — matches the real current upsert key |
| `region_name` | TEXT | NOT NULL | |
| `rm_name` | TEXT | NOT NULL | |
| `issue` | TEXT | NOT NULL | |
| `collated_comments` | TEXT | NULL | Script-written |
| `suggested_followup` | TEXT | NULL | **Hard contract, unchanged: no code may ever write this column** — human-only |
| `own_comment` | TEXT | NULL | Renamed from the current bare `own` for clarity (Part 4 owns naming, applied here for readability) |
| `updated_at` | TIMESTAMP | NOT NULL | Drives the existing amber/red staleness formatting |
| `cycle_started_at` | TIMESTAMP | NULL | **New** — when the current Generate cycle began; gives the existing "resolved-between-cycles" bug (a real, documented incident) something to actually check against, without changing the clear-and-repopulate behavior itself |

**Retention:** cleared and repopulated every Generate cycle — matches
current behavior. Whether a between-cycle-resolved row should be
proactively cleared remains an open **correctness** question (Part 2's
own note), not resolved by this schema — `cycle_started_at` is added
specifically so that question becomes answerable in code, not solved
here.
**Classification:** temporary/operational queue.

### 7. `sla_history` — historical aggregate / report

**Purpose.** Replaces `SLA_History` — the long-lived SLA trend.

| Column | Type | Null? | Notes |
|---|---|---|---|
| `snapshot_at` | TIMESTAMP | NOT NULL | **PK** — matches the real current upsert key exactly |
| `open_total` | INTEGER | NOT NULL | |
| `breached_total` | INTEGER | NOT NULL | |
| `inactive_rm_new_lead` | INTEGER | NOT NULL | |
| `is_not_updated` | INTEGER | NOT NULL | |
| `followup_overdue` | INTEGER | NOT NULL | |
| `under_called_today` | INTEGER | NOT NULL | |
| `stage_stuck_48h` | INTEGER | NOT NULL | |
| `source` | ENUM(`movement`,`browser`,`backfill`) | NOT NULL | Converted from free text per Part 2 |

**Retention:** **`TBD`, unresolved here on purpose** — carried forward
to Part 5, which owns the actual retention-policy recommendation.
**Classification:** historical aggregate/report.

### 8. `daily_cohort_history` — historical archive (immutable)

**Purpose.** Replaces `Daily_Cohort_History`.

| Column | Type | Null? | Notes |
|---|---|---|---|
| `cohort_date` | DATE | NOT NULL | **PK (composite, with `region_id`)** — the current `date_region` concatenated string is split into two real columns |
| `region_id` | INTEGER | NOT NULL | **PK (composite) / FK → `regions.region_id`** |
| `created` | INTEGER | NOT NULL | |
| `same_day_resolved` | INTEGER | NOT NULL | |
| `same_day_opp` | INTEGER | NOT NULL | |
| `window_complete` | BOOLEAN | NOT NULL | Once `true`, the row is application-level immutable — **this rule is a write-path guarantee the target app must keep enforcing; the schema alone can't express it**, flagged for Part 7 |
| `resolved_48h` | INTEGER | NULL | Null until the 48h window closes |
| `opp_48h` | INTEGER | NULL | |
| `closed_48h` | INTEGER | NULL | |
| `updated_at` | TIMESTAMP | NOT NULL | |
| `source` | ENUM(`movement`,`browser`,`backfill`) | NOT NULL | |

**Retention:** **`TBD`, unresolved here on purpose** — carried to Part 5;
Part 1/2 both note this is arguably the most legitimate "keep forever"
candidate of all 13 original tabs.
**Classification:** historical archive.

### 9. `comment_history` — historical log (append-only)

**Purpose.** Replaces `Comment_History`.

| Column | Type | Null? | Notes |
|---|---|---|---|
| `comment_id` | INTEGER | NOT NULL | **PK**, surrogate |
| `lead_id` | TEXT | NOT NULL | |
| `client_id` | TEXT | NOT NULL | |
| `rm_name` | TEXT | NOT NULL | Denormalized |
| `region_name` | TEXT | NOT NULL | Denormalized |
| `project` | TEXT | NOT NULL | |
| `comment` | TEXT | NOT NULL | |
| `comment_at` | TIMESTAMP | NOT NULL | When the RM logged it — kept **separate** from `logged_at` (two genuinely different concepts, per Part 2) |
| `logged_at` | TIMESTAMP | NOT NULL | When this row was captured |

**Unique constraint:** `(lead_id, comment)` — matches the real current
dedup key exactly.
**Retention:** **unbounded, by explicit design** — this policy is
already confirmed (not `TBD`) in the existing documentation and is
carried forward unchanged.
**Classification:** historical log.

### 10. `unmatched_comments_log` — operational review queue

**Purpose.** Replaces `Unmatched_Comments_Log`.

| Column | Type | Null? | Notes |
|---|---|---|---|
| `log_id` | INTEGER | NOT NULL | **PK**, surrogate |
| `lead_id` | TEXT | NOT NULL | |
| `rm_name` | TEXT | NOT NULL | |
| `region_name` | TEXT | NOT NULL | |
| `project` | TEXT | NOT NULL | |
| `comment` | TEXT | NOT NULL | |
| `comment_at` | TIMESTAMP | NOT NULL | |
| `logged_at` | TIMESTAMP | NOT NULL | |
| `reviewed` | BOOLEAN | NOT NULL, default `false` | |
| `note` | TEXT | NULL | Reviewer's note — **not** the same concept as `people.note` (Part 2's false-friend flag) |

**Unique constraint:** `(lead_id, comment_at)` — matches the real
current dedup key.
**Retention:** manually curated — rows persist until reviewed, matching
current confirmed behavior.
**Classification:** operational review queue.

### 11. `email_sends` — historical audit log

**Purpose.** Replaces `Send_Log` + `AllIssues_Log` + `Overnight_Log` for
**audit** purposes, per Part 2's merge decision. One row per
region-email sent, across all three send channels.

| Column | Type | Null? | Notes |
|---|---|---|---|
| `send_id` | INTEGER | NOT NULL | **PK**, surrogate |
| `channel` | ENUM(`dashboard`,`all_issues_17h`,`overnight_10h`) | NOT NULL | New — the discriminator that replaces "which of the 3 tabs is this row in" |
| `sent_at` | TIMESTAMP | NOT NULL | |
| `region_name` | TEXT | NOT NULL | |
| `issue_key` | TEXT | NULL | `dashboard` channel only |
| `issue_label` | TEXT | NULL | `dashboard` channel only |
| `bucket_label` | TEXT | NULL | `all_issues_17h` channel only |
| `primary_role` | TEXT | NULL | `all_issues_17h` channel only |
| `subject` | TEXT | NOT NULL | |
| `to_addresses` | TEXT | NULL | Kept denormalized — pure audit field, per Part 2 |
| `cc_addresses` | TEXT | NULL | |
| `lead_count` | INTEGER | NULL | |
| `thread_id` | TEXT | NULL | `all_issues_17h` and `overnight_10h` channels |
| `sent_by` | TEXT | NULL | `dashboard` channel only (the signed-in user) |

**Indexes:** `(channel, sent_at)`, **`(channel, region_name, sent_at)`
— this specific index is what keeps the `overnight_10h` channel's
same-day functional lookup (the 13:00 follow-up finding its own 10:00
row) just as fast as the current dedicated tab**, per Part 2's explicit
requirement that the functional read not regress.
**Nullable-by-channel design note:** several columns are meaningful for
only one or two channels (flagged above); this is a deliberate,
documented trade-off — a fully normalized "one table per channel plus a
shared base table" alternative was considered and rejected as more
complex than the small amount of genuine cross-channel reporting value
justifies, consistent with the brief's own instruction not to add
structure for theory's sake.
**Retention:** **`TBD` per channel, unresolved here on purpose** —
carried to Part 5. Flagged in Part 1: the `dashboard` channel
(`Send_Log`) currently has **no removal path of any kind**, the only one
of the three with that gap.
**Classification:** historical audit log.

### 12. `overnight_log_leads` — operational (functional child table)

**Purpose.** New table — splits `Overnight_Log.lead_ids_json` per Part
2's decision, since the 13:00 follow-up already needs to iterate
individual lead ids from it.

| Column | Type | Null? | Notes |
|---|---|---|---|
| `send_id` | INTEGER | NOT NULL | **PK (composite) / FK → `email_sends.send_id`** — only populated for `channel = 'overnight_10h'` rows |
| `lead_id` | TEXT | NOT NULL | **PK (composite)** |

**Retention:** matches its parent `email_sends` row.
**Classification:** operational (functional, not audit — this is what
the 13:00 run's per-lead resolution re-check actually queries).

### 13. `person_regions` — reference (junction table)

**Purpose.** New table, **added in Part 4** — surfaced by the exhaustive
column-by-column mapping pass below. `Manager_Directory.regions` ("region(s)
they cover") is a genuinely multi-valued fact about a person that the
Part 3 `people` table had no place for; a junction table is the correct
relational shape for a many-to-many person↔region coverage fact,
consistent with the brief's own instruction to model the real
relationship rather than force it into a single column.

| Column | Type | Null? | Notes |
|---|---|---|---|
| `person_id` | INTEGER | NOT NULL | **PK (composite) / FK → `people.person_id`** |
| `region_id` | INTEGER | NOT NULL | **PK (composite) / FK → `regions.region_id`** |

**Retention:** permanent, reference data (matches `people`).
**Classification:** reference.

---

### Schema-wide notes

- **Nothing above invents a `people_reporting_up_to_them`-style derived
  column** — per Part 2, that data is computable from `people`'s own
  chain columns on read; it is deliberately **not** a stored column in
  this schema, pending the confirmation flagged in Part 2 that it isn't
  independently hand-edited anywhere today.
- **No table hard-FKs into `people` or `regions` from a snapshot/log
  table.** Every `rm_name`/`region_name` on `movement_snapshots`,
  `daily_rm_issues`, `comment_history`, `unmatched_comments_log`, and
  `email_sends` stays a denormalized text copy, by the same
  historical-accuracy reasoning established in Part 2. Only the
  *current-state* tables (`people`'s own self-references,
  `region_recipients` → `regions`) carry real FK constraints.
- **Three retention periods are deliberately left `TBD`** in this
  schema (`sla_history`, `daily_cohort_history`, `email_sends`) — Part 3
  designs the shape; Part 5 owns the actual policy decision. Writing a
  number here without that dedicated analysis would be exactly the kind
  of unconfirmed assumption the brief asks not to present as fact.

*(Part 3 complete.)*

---

## Part 4 — Current-to-Target Column Mapping + Column Consolidation

**Method.** Every column from every one of the 13 reviewed tabs is
accounted for below — none silently dropped. Doing this exhaustively
surfaced 2 real gaps in Part 3's first schema pass (`Movement_Log`'s
separate `client` name column, and `Manager_Directory`'s multi-valued
`regions` field) — both are now fixed directly in Part 3 above
(`movement_snapshots.client_name`, the new `person_regions` table),
not just noted here. It also surfaced one clean, repeated pattern: **5 of
the 13 tabs carry a `date` column that duplicates information already in
a full timestamp column on the same row** — all 5 get the same
"remove, compute on read" treatment, explained once below rather than
five times.

### Current tab/column → target table/column

#### `Movement_Log` → `movement_snapshots`

| Current column | Target | Treatment |
|---|---|---|
| `snapshot_at` | `movement_snapshots.snapshot_at` | Retain as-is |
| `snapshot_label` | `movement_snapshots.snapshot_label` | Convert to enum |
| `lead_id` | `movement_snapshots.lead_id` | Retain as-is |
| `client_id` | `movement_snapshots.client_id` | Retain as-is |
| `client` (name) | `movement_snapshots.client_name` | Rename for clarity (`client` → `client_name`, disambiguates from `client_id`) |
| `RM` | `movement_snapshots.rm_name` | Rename; retained denormalized (not a FK) |
| `TL` | `movement_snapshots.tl_name` | Rename; denormalized |
| `project` | `movement_snapshots.project` | Retain as-is |
| `region` | `movement_snapshots.region_name` | Rename; denormalized |
| `lead_assigned_at`, `group_source`, `source_bucket`, `current_stage` | same names on `movement_snapshots` | Retain as-is |
| `last_connect`, `last_connect_time`, `last_comment`, `internal_status_comments`, `closing_reason` | same names on `movement_snapshots` | Retain as-is |
| `call_attempts`, `call_count`, `duration` | same names on `movement_snapshots` | Retain as-is |
| `stage_comments` | `movement_snapshots.stage_comments` | Retain as-is |
| `rm_is_active`, `lead_closing_reason` | same names on `movement_snapshots` | Retain as-is (nullable, schema-evolution history preserved) |

#### `Daily_RM_Issues` → `daily_rm_issues`

| Current column | Target | Treatment |
|---|---|---|
| `date` | `daily_rm_issues.capture_date` | Rename (`date`→`capture_date`, disambiguates from `lead_assigned_at`) |
| `RM`, `region`, `project` | `rm_name`, `region_name`, `project` | Rename `RM`/`region`; `project` as-is; all stay denormalized |
| `lead_id`, `client_id` | same names | Retain as-is |
| `issue_key`, `issue_label` | same names | Retain as-is |
| `captured_at` | same name | Retain as-is |
| `TL`, `group_source`, `source_bucket` | `tl_name`, `group_source`, `source_bucket` | Rename `TL`; others as-is |
| `lead_assigned_at` | same name | Retain as-is |
| *(whole tab)* | *(materialized from `movement_snapshots`)* | **Structural merge** — see Part 2's decision; this tab's rows are now a nightly ETL output, not independently written |

#### `Lead_Followups` → `lead_followups`

| Current column | Target | Treatment |
|---|---|---|
| `lead_id` (A) | `lead_followups.lead_id` | Retain as-is (PK) |
| `region` (B) | `region_name` | Rename |
| `RM` (C) | `rm_name` | Rename |
| `issue` (D) | `issue` | Retain as-is |
| `collated_comments` (E) | `collated_comments` | Retain as-is |
| `suggested_followup` (F) | `suggested_followup` | Retain as-is — hard human-only contract unchanged |
| `updated_at` (G) | `updated_at` | Retain as-is |
| `own` (H) | `own_comment` | Rename — bare `own` is unclear out of context |
| *(none — new)* | `cycle_started_at` | **Added** — new column, not a mapping; gives the documented "resolved-between-cycles" bug something to check against |

#### `SLA_History` → `sla_history`

| Current column | Target | Treatment |
|---|---|---|
| `date` | *(none — removed)* | **Remove** — see the shared "redundant date column" pattern below |
| `openTotal`, `breachedTotal` | `open_total`, `breached_total` | Rename (camelCase → snake_case, matching the target schema's naming convention throughout) |
| `inactiveRmNewLead`, `isNotUpdated`, `followupOverdue`, `underCalledToday`, `stageStuck48h` | `inactive_rm_new_lead`, `is_not_updated`, `followup_overdue`, `under_called_today`, `stage_stuck_48h` | Rename (same convention) |
| `snapshot_at` | `snapshot_at` | Retain as-is (PK, the real upsert key) |
| `source` | `source` | Convert to enum |

#### `Daily_Cohort_History` → `daily_cohort_history`

| Current column | Target | Treatment |
|---|---|---|
| `date_region` | `cohort_date` + `region_id` | **Split** — a concatenated composite key becomes two real columns (one FK) |
| `date` | `cohort_date` | Rename (part of the split above) |
| `region` | `region_id` | **Convert to lookup** — FK to the new `regions` table instead of free text (this table is a rollup, not a frozen historical snapshot, so it can safely reference the live `regions` table) |
| `created`, `same_day_resolved`, `same_day_opp` | same names | Retain as-is |
| `window_complete` | same name | Retain as-is (immutability trigger — enforced at the application layer, flagged for Part 7) |
| `resolved_48h`, `opp_48h`, `closed_48h` | same names | Retain as-is |
| `updated_at` | same name | Retain as-is |
| `source` | same name | Convert to enum |

#### `RM_Hierarchy` → `people`

| Current column | Target | Treatment |
|---|---|---|
| `team` | `people.team` | Retain as-is |
| `role` | `people.role` | Convert to enum |
| `name` | `people.name` | Retain as-is (not unique-constrained — see Part 3's name-collision note) |
| `tl`, `tm`, `rh`, `ch` | `tl_id`, `tm_id`, `rh_id`, `ch_id` | **Convert to lookup** — free-text manager names become real self-referencing FKs |
| `excluded` | `people.excluded` | Retain as-is |
| `note` | `people.note` | Retain as-is |
| `email` | `people.email` | **Merge target** — also receives `Manager_Directory.email` |

#### `Manager_Directory` → `people` / `person_regions`

| Current column | Target | Treatment |
|---|---|---|
| `manager_name` | matched to `people.name` (join key during migration only, not a stored column) | **Merge** — this row's data folds into the existing `RM_Hierarchy`-derived person, per Part 2's decision |
| `roles` | *(none — removed)* | **Remove** — redundant with `people.role`, since `Manager_Directory` is itself derived from the same `RM_HIERARCHY_RAW_` source per row |
| `regions` | `person_regions` (new junction table) | **Split** — a multi-valued "regions covered" fact, not a single-value column; see Part 3's new table 13 |
| `email` | `people.email` | **Merge target** — the primary reason this tab exists; **the migration must confirm which value wins if `RM_Hierarchy`'s own `email` and this one ever disagree** — flagged for Part 8 |
| `people_reporting_up_to_them` | *(none — removed)* | **Remove** — per Part 2's decision, computed from `people`'s own chain columns on read instead of stored twice |
| `email_source` | `people.email_source` | Retain as-is |

#### `Comment_History` → `comment_history`

| Current column | Target | Treatment |
|---|---|---|
| `date` | *(none — removed)* | **Remove** — redundant date-column pattern, below |
| `lead_id`, `client_id` | same names | Retain as-is |
| `RM`, `region`, `project` | `rm_name`, `region_name`, `project` | Rename `RM`/`region`; denormalized |
| `comment` | same name | Retain as-is |
| `comment_at` | same name | Retain as-is — genuinely distinct from `logged_at`, not merged |
| `logged_at` | same name | Retain as-is |

#### `Unmatched_Comments_Log` → `unmatched_comments_log`

| Current column | Target | Treatment |
|---|---|---|
| `date` | *(none — removed)* | **Remove** — redundant date-column pattern, below |
| `lead_id`, `RM`, `region`, `project` | `lead_id`, `rm_name`, `region_name`, `project` | Rename `RM`/`region` |
| `comment`, `comment_at`, `logged_at` | same names | Retain as-is |
| `reviewed` | same name | Retain as-is |
| `note` | same name | Retain as-is — **not** the same concept as `people.note` (Part 2's false-friend flag; both keep the same generic name here since they're genuinely unrelated columns on unrelated tables, so no actual naming collision exists in the target schema) |

#### `Send_Log` → `email_sends`

| Current column | Target | Treatment |
|---|---|---|
| `sent_at` | `email_sends.sent_at` | Retain as-is |
| `issue_key`, `issue_label` | same names | Retain as-is (nullable — `dashboard` channel only) |
| `region` | `region_name` | Rename |
| `subject` | same name | Retain as-is |
| `to`, `cc` | `to_addresses`, `cc_addresses` | Rename for clarity; retained denormalized (pure audit field) |
| `lead_count` | same name | Retain as-is |
| `sent_by` | same name | Retain as-is (nullable — `dashboard` channel only) |
| *(none — new)* | `channel = 'dashboard'` | **Added** — the discriminator that replaces "which of the 3 physical tabs is this row in" |

#### `AllIssues_Log` → `email_sends`

| Current column | Target | Treatment |
|---|---|---|
| `date` | *(none — removed)* | **Remove** — redundant date-column pattern, below |
| `region` | `region_name` | Rename |
| `bucket_label`, `primary_role` | same names | Retain as-is (nullable — `all_issues_17h` channel only) |
| `to`, `cc` | `to_addresses`, `cc_addresses` | Rename |
| `lead_count`, `sent_at`, `thread_id` | same names | Retain as-is |
| *(none — new)* | `channel = 'all_issues_17h'` | **Added** |

#### `Overnight_Log` → `email_sends` / `overnight_log_leads`

| Current column | Target | Treatment |
|---|---|---|
| `date` | *(none — removed)* | **Remove** — redundant date-column pattern, below |
| `region` | `region_name` | Rename |
| `thread_id` | `email_sends.thread_id` | Retain as-is — **functionally critical**, unchanged |
| `lead_ids_json` | `overnight_log_leads` (new child table) | **Split** — see Part 2/3's decision; the 13:00 run already iterates individual ids from this field |
| `sent_at` | `email_sends.sent_at` | Retain as-is |
| `to`, `cc` | `to_addresses`, `cc_addresses` | Rename — **functionally critical** (the 13:00 reply's actual recipients), unchanged in substance |
| `subject` | same name | Retain as-is |
| *(none — new)* | `channel = 'overnight_10h'` | **Added** |

#### `Region_Recipients` → `region_recipients`

| Current column | Target | Treatment |
|---|---|---|
| `region` | `region_recipients.region_id` | **Convert to lookup** — FK to the new `regions` table |
| `to`, `cc` | `to_addresses`, `cc_addresses` | Rename; retained denormalized per Part 2's judgment call |
| *(none — new)* | `updated_at` | **Added** — the current tab has no way to tell when an address last changed |

### The shared "redundant `date` column" pattern

`SLA_History`, `Comment_History`, `Unmatched_Comments_Log`,
`AllIssues_Log`, and `Overnight_Log` **each** carry a `date` column
whose value is entirely derivable from another timestamp column already
on the same row (`snapshot_at`, `logged_at`, or `sent_at`, respectively).
None of these five tables' `date` field is ever the *only* place a date
lives — it's a convenience duplicate. **Recommendation: remove the
stored column in all five cases, and compute it on read** (`DATE(sent_at)`
or equivalent) via a query or a database view/generated column if a
consuming report specifically wants a bare date. This is a genuine,
low-risk simplification, not five separate decisions — grouped here
because repeating the same reasoning five times would obscure that it
*is* one pattern, not five coincidentally similar ones.

### Column consolidation — grouped by treatment type

**Merge:**
- `Manager_Directory` (whole tab, matched by `manager_name`) →
  `people`, keyed on the existing `RM_Hierarchy`-derived row for that
  same person. *Reason:* one real-world entity (a person), currently
  split across two sheets joined only by name-matching with no FK.

**Rename:**
- `RM` → `rm_name`, `region` → `region_name`, `TL` → `tl_name` across
  every snapshot/log table that has them. *Reason:* the bare names
  (`RM`, `region`) read fine inside a spreadsheet tab named for its
  content, but are ambiguous as bare column names in a shared relational
  schema with a dozen tables — the `_name` suffix also makes the
  "this is denormalized text, not a live reference" intent explicit at
  the schema level, not just in a comment.
- `openTotal`/`breachedTotal`/etc. (camelCase) → `open_total`/
  `breached_total`/etc. (snake_case). *Reason:* pure naming-convention
  consistency with every other target table; no behavior change.
- `own` → `own_comment` (`Lead_Followups`). *Reason:* a bare `own` reads
  as an adjective with no noun in a schema context; ambiguous outside
  the sheet's own column-header convention.
- `to`/`cc` → `to_addresses`/`cc_addresses` everywhere they appear.
  *Reason:* `to`/`cc` are reserved-adjacent words in several SQL
  dialects and mail-library APIs; spelling them out avoids a real,
  avoidable footgun.

**Split:**
- `Daily_Cohort_History.date_region` → `cohort_date` + `region_id`.
  *Reason:* a concatenated composite key should be two real, independently
  queryable/indexable columns.
- `Manager_Directory.regions` → the new `person_regions` junction table.
  *Reason:* a genuinely multi-valued fact (one manager can cover several
  regions) doesn't belong in a single delimited-text column.
- `Overnight_Log.lead_ids_json` → the new `overnight_log_leads` child
  table. *Reason:* the 13:00 run already needs to query individual lead
  ids out of this field; a real child table serves that natively instead
  of requiring JSON parsing on every read.

**Convert to lookup/reference table:**
- `RM_Hierarchy.tl`/`tm`/`rh`/`ch` (free-text names) → self-referencing
  FKs into `people`. *Reason:* closes the referential-integrity gap
  Part 2 identified — today a typo'd manager name is silently accepted.
- `Daily_Cohort_History.region` and `Region_Recipients.region` (free
  text) → FK into the new `regions` table. *Reason:* these are
  current-state/rollup tables, not frozen historical snapshots, so they
  can safely reference live reference data rather than needing their own
  frozen copy (unlike `movement_snapshots`/`daily_rm_issues`/
  `comment_history`/etc., which deliberately keep denormalized text —
  see Part 2's normalize-vs-denormalize reasoning).

**Convert to enum/status field:**
- `Movement_Log.snapshot_label` (`periodic`/`manual`).
- `SLA_History.source` / `Daily_Cohort_History.source`
  (`movement`/`browser`/`backfill`).
- `Manager_Directory.email_source` (`private_file`/`manual`).
- `RM_Hierarchy.role` (the 11 cited role values).
- *(new)* `email_sends.channel` (`dashboard`/`all_issues_17h`/
  `overnight_10h`) — not a conversion of an existing column, but
  introduced specifically as an enum from the start.
- *Reason, all five:* each already has a small, known, cited set of
  real values today; a constrained type catches a bad/unexpected value
  at write time instead of silently admitting it as free text.

**Remove:**
- The five redundant `date` columns (above).
- `Manager_Directory.roles` — redundant with `people.role` post-merge.
- `Manager_Directory.people_reporting_up_to_them` — computed from
  `people`'s own chain columns on read; **flagged pending confirmation**
  (Part 2) that it isn't independently hand-edited anywhere today, so
  treat this one removal as provisional until that's checked in Part 8.

**Retain as-is:**
- Every identity/content column not called out above — `lead_id`,
  `client_id`, `comment`, `issue_key`, `issue_label`, `subject`,
  `lead_count`, `excluded`, `note`, all the call-count and cohort-outcome
  numeric columns, and both of `Comment_History`'s two genuinely distinct
  timestamps (`comment_at` and `logged_at`). *Reason, uniformly:* no
  ambiguity, no redundancy, no integrity gap — changing these would be
  structural change for its own sake, which the brief explicitly asks
  this review not to do.

*(Part 4 complete. Continues in Part 5 — the data retention and
lifecycle policy, resolving the `TBD` retention periods this schema
deliberately left open.)*
