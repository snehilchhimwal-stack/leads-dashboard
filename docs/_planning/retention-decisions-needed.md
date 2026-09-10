# Retention decisions needed (`DOC-037`)

**Produced:** 2026-09-10, from `DOC-036`'s findings
(`docs/sheets/SHEET-*.md` `## Data Lifecycle`).
**Purpose:** turn `DOC-036`'s 7 `TBD` retention values into an explicit,
actionable list so the project owner can make a real decision **without
re-researching any tab**. (`DOCUMENTATION_PROJECT_PLAN.md` Phase 4,
`DOC-037`.)

> **This documentation project's job is to surface the gap, not to
> decide a business retention policy on its own authority.** The
> "Options to consider" below are *options*, not recommendations. This
> task ends at "the open questions are written down clearly."

---

## The shared constraint (why any of this matters)

Google Sheets enforces a **10,000,000-cell ceiling on the whole
workbook's declared grid size** — summed across every tab, and **not
reduced by `clearContent()`**, only by `deleteRows()`
(`MovementTracker.gs` `#L470`).

**~8M of the 10M is already spent** by the two tabs that *do* have
retention (`DailyRmIssueLog.gs` `#L69`–`#L72`):

| Tab | Rows | Cols | ≈ Cells at 7-day retention |
|---|---|---|---|
| `Movement_Log` | ~232,607 | 24 | **~5.6M** |
| `Daily_RM_Issues` | ~26,660/night × 7 | 13 | **~2.4M** |
| **Subtotal** | | | **~8M** |

That leaves **~2M cells of headroom** for the 7 `TBD` tabs *plus* the
3 configuration tabs *plus* the `leads` tab itself. None of the 7
individually grows fast (see rates below), but "unbounded" against an
80%-consumed workbook-wide ceiling is the real decision driver.

**The concrete cautionary example — a real incident, not hypothetical:**
`Daily_RM_Issues` shipped 2026-09-01 with **no retention at all**. On
2026-09-06 it hit the ceiling and `captureDailyRmIssues` **crashed**
(`Exception: This action would increase the number of cells in the
workbook above the limit of 10000000 cells`), losing that night's
capture. Fix: `pruneDailyRmIssueLog_()` at 7 days, added 2026-09-07.
`HANDOVER.md` §9.2, `SHEET-003`. **This is the class of failure a "keep
unbounded" decision on any of the 7 accepts the (small, slow) risk of.**

---

## The 7 tabs needing a decision

### 1. `leads` — `SHEET-001`

| | |
|---|---|
| **Data type** | operational (the live source of truth) |
| **Current state** | **no pruning function in this project.** Populated by an **external CRM export** — whether it overwrites or appends, and its own retention, is not visible in this codebase. |
| **Growth rate** | unknown from here — depends on the CRM export's behaviour |
| **Why a decision matters** | it is the single largest *potential* contributor and the one this project doesn't control. If the export appends rather than overwrites, this tab grows without bound and no code here would catch it. |
| **Options to consider** | (a) confirm with whoever owns the CRM export whether it overwrites-in-place (bounded) or appends (unbounded); (b) if it appends, decide whether the export process should prune, or this project should add a `pruneLeads_`; (c) if it overwrites, record "bounded by the export — no action" and close this item. |
| **Decision owner** | the CRM-export owner + Snehil. **Not a code change this project can make alone.** |

### 2. `Lead_Followups` — `SHEET-004`

| | |
|---|---|
| **Data type** | temporary (a per-cycle work queue) |
| **Current state** | **no time-based retention.** `clearLeadFollowupsTab` wipes **all** data rows at the **start** of every Generate cycle, then it is re-populated. So it is effectively bounded to one cycle's flagged leads (~tens–low hundreds of rows). |
| **Growth rate** | resets to ~0 every Generate cycle; does **not** accumulate across cycles |
| **Why a decision matters** | low technical risk (self-bounding). The open question is a *correctness* one, not a size one: if a lead resolves *between* cycles, its row sits stale until the next full Generate (real incident — lead 2229674, `HANDOVER.md` §8, `LEAD_FOLLOWUPS_STALENESS.md`). |
| **Options to consider** | (a) record "self-bounded by the cycle clear — no retention policy needed" and close; (b) if the stale-between-cycles behaviour is unwanted, that is a `LEAD_FOLLOWUPS_STALENESS.md` / logic question, **out of scope for retention** — note and route there. |
| **Decision owner** | Snehil. Likely a one-line "no action, self-bounded". |

### 3. `SLA_History` — `SHEET-005`

| | |
|---|---|
| **Data type** | historical (aggregate) |
| **Current state** | **no pruning function.** Exists *because* `Movement_Log` is only 7-day — it keeps the SLA trend after the raw snapshots are gone. `clearSlaHistory` (`BTN-020`) is a manual all-or-nothing wipe, not a policy. |
| **Growth rate** | **~4 rows/day** (one per snapshot) × ~10 cols ≈ 40 cells/day → **~15K cells/year**. Negligible against the 2M headroom. |
| **Why a decision matters** | not a size risk on any realistic horizon. The decision is one of *intent*: is "keep forever" the goal (a permanent SLA trend), and if so, should that be **stated in code** so it reads as deliberate rather than accidental (the exact ambiguity `DOC-036` flagged)? |
| **Options to consider** | (a) declare "keep indefinitely — permanent trend series" and add a one-line comment in `js/sheets-writeback.js` + the `SHEET-005` record so it's deliberate; (b) cap at e.g. 1–2 years with a `pruneSlaHistory_` if the trend beyond that is never used; (c) leave as-is (the honest `TBD`). |
| **Decision owner** | Snehil. Low urgency. |

### 4. `Daily_Cohort_History` — `SHEET-008`

| | |
|---|---|
| **Data type** | historical (permanent archive; rows immutable once `window_complete`) |
| **Current state** | **no pruning function.** Exists to *outlive* `Movement_Log`; rows are never re-derived once archived (`RULE-029`). `clearDailyCohortHistory` (`BTN-022`) is a manual wipe. |
| **Growth rate** | **~11 rows/day** (one per region) × 12 cols ≈ 132 cells/day → **~48K cells/year**. Negligible. |
| **Why a decision matters** | same as `SLA_History` — not a size risk, but "keep forever" is implied, not stated. This tab is arguably the *most* legitimate "keep indefinitely" candidate (its whole reason to exist is being the long-term cohort record `Movement_Log` can't be). |
| **Options to consider** | (a) declare "keep indefinitely — this IS the long-term cohort archive" and state it in code + the record; (b) cap at N years with a prune if older cohort data is never queried; (c) leave as-is. |
| **Decision owner** | Snehil. Low urgency. |

### 5. `Send_Log` — `SHEET-011`

| | |
|---|---|
| **Data type** | historical (send-audit log) |
| **Current state** | **no pruning function AND no `clear*` function of any kind.** The only SHEET tab with *no* removal path at all. Records every dashboard-initiated region-email send (subject, resolved recipients, sender). |
| **Growth rate** | a few rows per Generate/send — realistically ~10–50 rows/day × 9 cols → **low tens of thousands of cells/year**. Low, but strictly unbounded. |
| **Why a decision matters** | (a) it holds **recipient + sender email addresses** — a retention decision here has a **data-minimisation / compliance angle**, not just a technical one; (b) it has no clear function, so if a decision *is* "prune", one has to be written from scratch. |
| **Options to consider** | (a) add a `pruneSendLog_` at N days/months (mirror `pruneMovementLog_`) — pick N from an audit-retention requirement, not a guess; (b) keep indefinitely if the send history is a deliberate audit trail — then state it and accept the (slow) growth; (c) periodically export + clear (the audit trail lives outside the workbook). |
| **Decision owner** | Snehil, **with an audit/compliance lens** given the email addresses. |

### 6. `AllIssues_Log` — `SHEET-013`

| | |
|---|---|
| **Data type** | historical (send-audit log for the 17:00 `AllIssuesEmailer.gs` run) |
| **Current state** | **no pruning function, no clear function.** `ensureAllIssuesLogSheet_` self-heals the header only. Records each 17:00 region-digest send (bucket label, primary role, resolved `to`/`cc`, `thread_id`). |
| **Growth rate** | **~1 row per region per day** — ~11 rows/day × 9 cols → **~36K cells/year**. Negligible. |
| **Why a decision matters** | same shape as `Send_Log` — bounded-slow but strictly unbounded, and holds recipient addresses (data-minimisation angle). Read only by `GS-001` itself for within-run dedupe, so pruning old rows is functionally safe. |
| **Options to consider** | (a) add a `pruneAllIssuesLog_` at N days (safe — only today's rows are read); (b) keep indefinitely as a send audit trail; (c) export + clear periodically. |
| **Decision owner** | Snehil, same audit lens as `Send_Log`. |

### 7. `Overnight_Log` — `SHEET-014`

| | |
|---|---|
| **Data type** | operational (a **same-day state handoff** — the 13:00 run reads *today's* rows to send the threaded follow-up; older rows are dead weight) |
| **Current state** | **no pruning function, no clear function.** `backfillTodaysOvernightLogRecipientsNow` is a repair function, not a prune. Records each 10:00 send's `thread_id` + resolved `to`/`cc` + `lead_ids_json`. |
| **Growth rate** | **~11 rows/day** × 8 cols → **~32K cells/year**. Negligible in size — but **~100% of accumulated rows past today are pure waste** (nothing ever reads a row older than the same day's 13:00 run). |
| **Why a decision matters** | this is the **clearest-cut of the 7**: only ~2 days of rows are ever functionally needed (today + a small margin for a delayed/repaired run), the tab holds recipient addresses, and a short prune is trivially safe. It is the one tab where `DOC-036` explicitly noted "a short prune (~2 days) is likely safe" — offered here as an option for the owner to confirm, not a decision made. |
| **Options to consider** | (a) add a `pruneOvernightLog_` keeping ~2–7 days (safest, removes dead data + minimises retained addresses); (b) keep indefinitely as a send audit trail (accepts slow growth of data nothing reads); (c) fold its audit value into `Send_Log`/`AllIssues_Log` and prune this one aggressively. |
| **Decision owner** | Snehil. **The lowest-risk change of the 7 if a prune is wanted.** |

---

## Summary table (for the owner)

| # | Tab | Data type | Growth | Size risk | Decision character |
|---|---|---|---|---|---|
| 1 | `leads` | operational | unknown (external CRM) | **potentially high, uncontrolled** | needs the CRM-export owner; confirm overwrite-vs-append |
| 2 | `Lead_Followups` | temporary | self-resets each cycle | none | likely "no action, self-bounded" |
| 3 | `SLA_History` | historical aggregate | ~15K cells/yr | none (realistic horizon) | "keep forever" — ratify + state in code, or cap |
| 4 | `Daily_Cohort_History` | historical archive | ~48K cells/yr | none | "keep forever" — ratify + state in code, or cap |
| 5 | `Send_Log` | audit log | low tens-K cells/yr | low, strictly unbounded | audit/compliance call (holds emails); no clear fn exists |
| 6 | `AllIssues_Log` | audit log | ~36K cells/yr | low, strictly unbounded | audit/compliance call (holds emails); prune is safe |
| 7 | `Overnight_Log` | same-day handoff | ~32K cells/yr | low; ~all past-today rows are waste | **clearest prune candidate**; ~2-day retention likely safe |

---

## Decisions already made — listed for the owner to ratify or override

Not `TBD` per `DOC-036`, but included so the full retention picture is in
one place:

| Tab | Recorded policy | Source |
|---|---|---|
| `Movement_Log` | **7 days**, `pruneMovementLog_` | `MOVEMENT_LOG_RETENTION_DAYS`, `MovementTracker.gs` |
| `Daily_RM_Issues` | **7 days**, `pruneDailyRmIssueLog_` (prune-before-write) | `DAILY_RM_ISSUE_LOG_RETENTION_DAYS_`, `DailyRmIssueLog.gs` (2026-09-07 incident fix) |
| `Comment_History` | **unbounded — by explicit design** (comment-triggered writes, ~order of magnitude slower than `Movement_Log`) | `InteractionHistoryLogger.gs` header, `LOGIC_AUDIT.md` Part 1 §4d — **owner may want to sanity-check this against the shared 2M-cell headroom** |
| `Unmatched_Comments_Log` | **manually curated** — rows removed by `clearReviewedUnmatchedCommentsNow` after a human marks them `reviewed`; no time-based prune | `GS-013`, `SHEET-010` |
| `RM_Hierarchy` / `Manager_Directory` / `Region_Recipients` | **N/A — configuration**, rebuilt on demand, no history | `SHEET-006` / `007` / `012` (`RM_Hierarchy` + `Manager_Directory` also FLAGGED for employee-data sensitivity → `DOC-038`) |

---

## How resolved decisions get recorded

Per `DOC-037`'s own follow-up note: **each resolved decision is folded
back into the matching `SHEET-XXX` record's `## Data Lifecycle` →
`Retention Period` field as a small follow-up edit, not a new numbered
task** — tracked informally as decisions land. If a decision adds a
`pruneXxx_` function, that is a real `.gs` change (with a `Tests_` +
`HANDOVER.md` §2 update, per `CLAUDE.md`) and gets its own task then.

---

## Appendix — implementation reference IF "add a prune" is chosen (`t-tf-5ad22d8e4c2e` P3)

**Still not a recommendation.** This appendix exists only so that, once
the owner decides "prune tab X at N days", the code is a copy-paste
rather than a design task. Every one of the 4 candidates below (`Send_Log`,
`AllIssues_Log`, `Overnight_Log`, and optionally `SLA_History` /
`Daily_Cohort_History` if capped) would use the **same shape** as the two
prunes that already exist:

```js
// in the owning .gs file, mirroring pruneMovementLog_ (MovementTracker.gs)
const <TAB>_RETENTION_DAYS_ = <N>;               // the owner's number
function prune<Tab>_() {
  const sh = SpreadsheetApp.getActive().getSheetByName('<Tab_Name>');
  if (!sh) return;
  const last = sh.getLastRow();
  if (last < 2) return;
  const cutoff = new Date(Date.now() - <TAB>_RETENTION_DAYS_ * 864e5);
  const dates = sh.getRange(2, <date_col>, last - 1, 1).getValues();
  let firstKeep = dates.findIndex(r => r[0] instanceof Date && r[0] >= cutoff);
  if (firstKeep <= 0) return;                     // nothing to drop / all recent
  sh.deleteRows(2, firstKeep);                    // deleteRows, NOT clearContent — see the cell-ceiling note above
}
```

Then: call `prune<Tab>_()` **before** that tab's own write in its
scheduled function (the `pruneDailyRmIssueLog_` prune-before-write
lesson — an after-write prune can't self-heal a tab already over the
ceiling); add a one-off `prune<Tab>Now()` wrapper for manual recovery;
add a `Tests_<File>.gs` assertion (a > N-day row is dropped, an
N-day-old row is kept); paste into the live Apps Script editor; **no
`setupXxx()` re-run needed** (internal-behaviour change, not a schedule
change). Fold the chosen `N` into the `SHEET-XXX` record's
`## Data Lifecycle → Retention Period` and open a `.gs`-change task for
the code itself.

`leads` (#1) and `Lead_Followups` (#2) are **not** in this list — #1 is
external-CRM-owned, #2 is self-bounded by the per-cycle clear.

---

## Definition of Done check

- **Every `TBD` from `DOC-036` appears here with enough context for a
  real decision to be made without re-researching the tab** — ✅ (all 7
  `TBD` tabs have a dedicated block: data type, current state, growth
  rate with a real cells/year figure, why a decision matters, concrete
  options, and a decision owner; plus the shared cell-ceiling
  constraint and the `Daily_RM_Issues` incident as the cautionary
  example, up front).
- **The list is flagged for the project owner's actual decision** — ✅
  (this file states up front that the task ends at surfacing; every
  block names a decision owner; no recommendation is made). The P3
  appendix adds copy-paste prune code for the "if prune" branch —
  still not choosing the branch.
