# Opp Monitor: data gap, method reconstruction, and decisions — 2026-10-12

Status: **official Opp Monitor numbers PAUSED** (Snehil's decision, 2026-10-12)
until the analytics data gap below is fixed. The dashboard tab's own live
figures (computed from the Sheet's complete `leads` tab) are unaffected and
are being fixed separately (audit findings H-2, G-5).

## 1. The data gap (for whoever runs the Homesfy analytics pipeline)

**`homesfy_analytics.dim_leads` has no row for a large and growing share of
leads that otherwise exist in the same database** — they have rows in
`fact_stage_history` and `fact_calls`, but none in `dim_leads`, so their
creation time, source and project are unknown to any analytics query.

Leads that have at least one stage change, grouped by lead-id range (first
stage change date shown), and how many of them have no `dim_leads` row:

| lead_id range | first seen | leads with history | missing from `dim_leads` | % missing |
|---|---|---|---|---|
| 2,150,000+ | 2026-05-30 | 9,996 | 1,736 | 17.4% |
| 2,160,000+ | 2026-06-11 | 10,000 | 2,128 | 21.3% |
| 2,170,000+ | 2026-06-23 | 9,998 | 2,001 | 20.0% |
| 2,180,000+ | 2026-07-08 | 9,969 | 1,353 | 13.6% |
| 2,190,000+ | 2026-07-22 | 10,000 | 1,940 | 19.4% |
| 2,200,000+ | 2026-08-02 | 10,000 | 2,786 | 27.9% |
| 2,210,000+ | 2026-08-13 | 10,000 | 2,877 | 28.8% |
| 2,220,000+ | 2026-08-26 | 9,998 | 3,052 | 30.5% |
| 2,230,000+ | 2026-09-08 | 10,000 | 3,495 | 34.9% |
| 2,240,000+ | 2026-09-20 | 10,000 | 3,371 | 33.7% |
| 2,250,000+ | 2026-10-05 | 4,627 | 1,932 | 41.8% |

- `dim_leads` IS being refreshed (last `updated_version` 2026-10-12 09:30,
  3,697 rows loaded in the previous 24 h), so this is not a stalled load —
  rows for specific leads are simply never written.
- `fact_stage_history.rm_role` is blank for these leads, so the gap can't be
  attributed to a team/role from the analytics side.
- Cross-check against the production Sheet's `leads` tab (complete, but a
  rolling ~7-day window): of a sample of 30 Google Non-UTM/Search lead ids
  present in the Sheet (created 2026-09-15 → 10-04), **21 had no `dim_leads`
  row**; all 21 do have stage history and calls. Example ids: 2235305,
  2242375, 2248143, 2248955, 2249045, 2249048, 2249095, 2249124, 2249172,
  2249217.
- Query used (read-only, `analytics_query_analytics_tool`):

```sql
WITH F AS (SELECT lead_id, min(changed_at) AS first_event
           FROM homesfy_analytics.fact_stage_history GROUP BY lead_id)
SELECT intDiv(F.lead_id, 10000) * 10000 AS id_bucket, min(F.first_event) AS first_seen,
       count() AS leads_with_history, countIf(D.lead_id IS NULL) AS missing_from_dim_leads
FROM F LEFT JOIN (SELECT DISTINCT lead_id FROM homesfy_analytics.dim_leads) D ON D.lead_id = F.lead_id
WHERE F.lead_id >= 2150000 GROUP BY id_bucket ORDER BY id_bucket
SETTINGS join_use_nulls = 1
```

**Ask:** find why these leads never get a `dim_leads` row and backfill them.
Until then, any metric that takes its lead list / denominator from
`dim_leads` (as the Opp Monitor did) silently leaves out 15–40% of leads.

## 2. How the July/August official rows were actually computed (reconstructed)

The original session's queries weren't saved anywhere (the analytics
`mcp_query_logs` table is empty). Reconstructed 2026-10-12 and **proven**:
the method below reproduces the recorded same-day and 48 h counts for all six
July/August periods exactly (443/513, 415/480, 517/606, 477/584, 537/630,
513/581 — totals and average hours drift slightly since, as data arrived).

- **Scope:** every `dim_leads` lead whose `dim_sources.group_source = 'google'`
  — **not** limited to Non-UTM/Search. `source_bucket` (Non-UTM / Search /
  Discovery) exists only in the Sheet's `leads` tab, never in the analytics DB.
- **Period window and "same day":** computed on `created_at + 5h30`.
- **First Opportunity:** `min(changed_at)` where `to_stage_name = 'Opportunity'`.
- **Within 48 h:** first Opportunity ≤ 48 h after `created_at`.
- **Average hours to Opp:** over every lead that has ever reached Opportunity.

**The +5h30 is a timezone mistake.** The analytics DB already stores IST
(stage changes jump from ~1,250 at 09:00 to ~9,400 at 10:00 and stay high
until ~20:00 — an Indian office day). Adding another 5h30 made "same day" run
from **18:30 one day to 18:30 the next**. With a correct midnight-to-midnight
IST day, July/August same-day Opp% is **1–5 points lower** than recorded
(48 h figures are unaffected — a duration doesn't depend on the timezone):

| Period | Same-day recorded | Same-day, correct day | 48 h |
|---|---|---|---|
| 2026-07 P1 | 37.7% | 33.1% | 43.7% |
| 2026-07 P2 | 30.3% | 26.1% | 35.0% |
| 2026-07 P3 | 32.8% | 30.0% | 38.5% |
| 2026-08 P1 | 30.0% | 28.8% | 36.8% |
| 2026-08 P2 | 39.4% | 35.7% | 46.2% |
| 2026-08 P3 | 40.2% | 36.0% | 45.6% |

(These corrected figures still use `dim_leads`, so §1 applies to them too.)

## 3. State of the official series

- `Opp_Monitor_Period` holds only the six July/August rows;
  `Opp_Monitor_Month` only July/August. **September (all 3 periods +
  month) and October P1 were never recorded** — the recurring To-Do tasks
  for them are overdue.
- **Update (later 2026-10-12, Snehil's decision):** Sep P1–P3, Oct P1 and
  the September month row are now written, all with `source = backfill_mcp`.
  They are computed from analytics only:
  - **Scope:** all Google, `dim_leads` only.
  - **Same-day:** a midnight-to-midnight IST day.

  Analytics alone cannot isolate Non-UTM/Search. Google channels are only
  `website`/`IVR`/`Web-Whatsapp`/`chat`, and Discovery arrives via `website`
  alongside Search and Non-UTM. So these rows include Discovery. They are
  also inflated by the §6 finding.

  The interim `archive_rebuild` Sep P2/P3 rows (Non-UTM/Search, all leads)
  were replaced. They are kept for comparison in
  `opp_monitor_archive_rebuild_2026-10-12.csv` next to this file.

  The new `period_label` cells are self-contained formulas
  (`="1st"&UNICHAR(8211)&"10th"`), because the browser couldn't type an
  en-dash. They reference no other cell.

  Written values:

  | Period | Leads | Same-day | 48h | Avg hrs |
  |---|---|---|---|---|
  | Sep 1–10 | 1,010 | 36.8% | 45.2% | 23.5 |
  | Sep 11–20 | 1,086 | 34.5% | 44.8% | 24.79 |
  | Sep 21–30 | 992 | 39.9% | 51.3% | 16.84 |
  | Oct 1–10 | 812 | 39.2% | 50.7% | 15.35 |
  | Sep month | 3,088 | 37.0% | 47.1% | 21.64 |

  Oct P1 was computed on 2026-10-12. Its last day's leads had not quite
  completed their 48h window.
- **Jul/Aug rewritten (2026-10-12, per §4.1).** All six period rows and both
  month rows were recomputed with the same method:
  - analytics only, all Google, `dim_leads` only
  - same-day on a midnight-to-midnight IST day

  Lead counts moved slightly too (e.g. Aug P2 1,363 → 1,400), because
  `dim_leads` has picked up late-arriving leads since 2026-09-18. The
  previous values are kept in `opp_monitor_jul_aug_original_rows_2026-10-12.csv`.
  Every Opp Monitor row now uses one method, so the Jul → Oct trend is
  like-for-like.
- **No new capture job is needed for Non-UTM/Search.**
  `snapshotPeriodic` (MovementTracker.gs, 00/06/12/18 IST) already records
  every lead with `source_bucket` and `opp_at` into the `Movement_Log` tab.
  `pruneMovementLog_` copies rows older than 7 days to Drive
  ("Leads Dashboard Archive/Movement_Log") before deleting them, and keeps
  them indefinitely. That is why the Drive CSVs end about 7 days before
  today.

  Since Phase 6, a row is written only when a lead's content changes. It is
  still enough to scope Non-UTM/Search: every lead appears at least once,
  and reaching Opportunity is itself a change.

  To produce Non-UTM/Search periods:
  1. Take lead ids from the Drive archive plus the live tab.
  2. Take creation and first-Opportunity times from analytics
     (`dim_leads.created_at`, else the first `fact_stage_history.changed_at`).
  3. Use all leads as the denominator (§6).

## 4. Decisions taken (Snehil, 2026-10-12) — apply when resuming

1. **Same-day definition: fix everywhere.** Use a midnight-to-midnight IST
   day for new periods AND rewrite the six July/August rows with corrected
   same-day figures.
2. **Scope: Google Non-UTM/Search only, going forward.** Not derivable from
   the analytics DB (§2); needs `source_bucket` from the Sheet, whose `leads`
   tab only keeps ~7 days — so it has to be captured before leads age out.
3. **No catch-up emails** for the missed periods; resume emailing from the
   first period computed on reliable data.
4. **Pause** official numbers until §1 is fixed (or a complete source exists).

## 5. Options to resume

- **(a)** Pipeline owner fixes `dim_leads` (§1) → recompute everything with
  the corrected method; scope to Non-UTM/Search still needs (b).
- **(b)** Record each day's Google Non-UTM/Search leads (id, created,
  source_bucket, first-Opp time) from the Sheet before they leave the
  7-day window (an Apps Script job, like the existing nightly captures) —
  a complete, correctly-scoped source from the day it starts. September
  can't be recovered this way.

## 6. September rebuilt from the Movement_Log archive (later 2026-10-12)

**Source.** The Drive folder `Movement_Log` (id
`1GaK9-tvS4ffsI3Drl1CwJYwRp_mSfSI8`) holds 70 CSVs of 6-hourly `leads`
snapshots, covering Sep 10 to Oct 5 morning. There are no files for
Sep 18, 19, 20 or 24. Only files from about Sep 21 onward have an `opp_at`
column. The archive gave **scope**: 4,059 Google lead ids, of which 3,248
are Non-UTM/Search.

**Method.**
- **Creation time:** `dim_leads.created_at`. Where that is missing, the
  lead's first `fact_stage_history.changed_at`. On leads that have both, the
  first stage change comes a median of 64s after creation and falls on the
  same IST day 95% of the time.
- **First Opportunity:** the first transition to `'Opportunity'`.
- **Same day:** a midnight-to-midnight IST day.
- **48h:** at most 48 hours after creation.
- **Average hours:** taken over converted leads.
- **Denominator: all leads.** Every Non-UTM/Search lead in the archive,
  whether or not `dim_leads` has it. This matches the dashboard's live
  computation.

| Period | Leads | Same-day | 48h | Avg hrs | Written? |
|---|---|---|---|---|---|
| Sep 11–20 | 1,147 | 320 (27.9%) | 409 (35.7%) | 22.74 | Yes |
| Sep 21–30 | 1,062 | 336 (31.6%) | 429 (40.4%) | 15.49 | Yes |
| Sep 1–10 | 561 (partial, archive starts ~Sep 4) | 158 | 194 | 26.57 | No |
| Oct 1–5 morning | 427 (partial, archive ends) | 144 | 180 | 14.87 | No |

The September month and Oct P1 rows were not written either. They would
be partial, and the Sheet has no column to mark a row as partial.

**Coverage check.** Each day, the archive holds 80–90% of the Google leads
in `dim_leads`. That held on the four days with no archive file too, since
later snapshots still captured those leads. The ~15% the archive lacks
almost never convert: 1.4% same-day, against 44.5% for those it holds.
They are most likely leads that were never assigned.

**Key finding: what the `dim_leads` gap actually is.** Of the 1,072
Non-UTM/Search leads missing from `dim_leads`, the Sheet's own snapshots
show 1,003 as still Suspect and 68 as Not Updated. Only **1** ever reached
Opportunity. The analytics stage history agrees independently: zero
Opportunity transitions for them. So `dim_leads` appears to hold only
leads that have moved past Suspect.

The consequence is that any Opp% with `dim_leads` as its denominator
leaves out never-qualified leads and is **inflated**. On Sep 11–30, the
`dim_leads`-only same-day figure is 42–46%, against 28–32% over all leads.

**Not yet checked: July/August.** The July/August official rows (`backfill_mcp`)
may be inflated the same way, if the gap existed then. Check this before
rewriting them per §4.1, or comparing them with September.

## 7. Standing procedure: the all-leads method (decided 2026-10-13)

Every official Opp Monitor row from **11 Sep 2026** on is produced this way.
Rows before that keep their older analytics-only method; they are not
rebuilt and no change badge is drawn across the two (`JS-025` EXC-144).

**Who runs it:** a Claude session, by hand, once each period has fully
closed. That means the period's last day plus 48 hours, so every lead has
had its full 48h window. There is no Apps Script job for this; that was
decided against on 2026-10-13.

**1. Lead list and labels: the Sheet, not analytics.**
- Take every lead with `group_source` = Google from `Movement_Log`. Use the
  live tab for the last ~7 days, and the Drive archive
  ("Leads Dashboard Archive/Movement_Log") for older rows.
- Label each lead from `source_bucket`: Search, Non-UTM or Discovery.
- Rows are written only when a lead changes, so every lead appears at least
  once.
- Read the live tab well before its rows age out (7 days). The archive keeps
  them after that.

**2. Times: analytics (MCP).**
- **Creation:** `dim_leads.created_at`. Where the lead is missing from
  `dim_leads` (leads that never got past Suspect), use its first
  `fact_stage_history.changed_at` instead. On leads with both, that falls a
  median of 64s after creation, and on the same IST day 95% of the time.
- **First Opportunity:** the first `fact_stage_history` transition to
  `'Opportunity'`.

**3. Metrics, per period and per type.** Assign each lead to a period by its
creation date in IST.
- **Same-day:** the first Opportunity is on the same IST calendar day as
  creation (midnight to midnight).
- **48h:** the first Opportunity is at most 48 hours after creation.
- **Denominator:** **all** leads, including those that never progressed.
- **Average hours:** taken over leads that converted.

**4. Coverage check before writing.** For each creation day, compare the
labelled leads with `dim_leads` Google leads for that day. Days below about
85% mean an archive file is missing: find it before writing. Otherwise
record the gap in `source` or the docs.

**5. Write the row.**
- **Headline** (`total_leads`, `same_day_count`, `h48_count`, `same_day_pct`,
  `h48_pct`, `avg_*`): Search + Non-UTM.
- **Breakdown:** `search_*`, `nonutm_*` and `discovery_*`, each with leads,
  same-day and 48h counts.
- **`source`:** `all_leads`.
- **Steps:** steps 1–2 Done; step 3 (leadership email) as the workflow
  dictates.
- **Months:** the same rule, summed over the month's periods. A month whose
  periods are not all all-leads keeps its older row.

**Why:** the analytics `dim_leads` table omits leads that never got past
Suspect. That is about a third of Non-UTM/Search leads and over half of
Discovery leads, and almost none of them reach Opportunity. So any
`dim_leads`-only figure reads 7–25 points high. The Sheet's `source_bucket`
is also the only place Search, Non-UTM and Discovery are told apart: in
analytics, Search and Discovery both arrive through the `website` channel.

**First run (2026-10-13).** Sep P2, Sep P3 and Oct P1 were written with
`source = all_leads`, with the breakdown in V:AD of `Opp_Monitor_Period`.
Headline same-day / 48h: 27.9% / 35.7%, 31.6% / 40.4% and 30.1% / 38.6%.

`Opp_Monitor_Month` still has only 18 columns (A–R). Its nine breakdown
columns must be added before the first all-leads month row (October 2026)
is written.

**Coverage exception on 5 Oct 2026:**
- 63 Google leads were created between 13:20 and 14:24 IST, mostly
  `website`, and assigned to six RMs.
- They were later closed: mostly Not Enquired, Ringing or Not Contactable,
  spread over Oct 5–12.
- 61 of them never appeared in `Movement_Log`, so they are outside the
  all-leads population. Most likely a bulk import or re-push; this was not
  confirmed with the import owner.
- That day shows 42% coverage. Every other day of Oct 1–10 is 76–100%.
