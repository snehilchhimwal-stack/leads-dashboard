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
- Nothing has been written to either tab on 2026-10-12.

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
