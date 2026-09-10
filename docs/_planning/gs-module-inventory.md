# Apps Script (`.gs`) module inventory (`DOC-007`)

**Produced:** 2026-09-10, against the repo root at commit `e281f9b`.
**Purpose:** the confirmed production `.gs` file list + each file's
one-line responsibility, and the explicit scope decisions for the
`Tests_*.gs` and the private file — the base for `DOC-029` (the `GS-XXX`
records).
(`DOCUMENTATION_PROJECT_PLAN.md` Phase 1, `DOC-007`.)

> **Count drift.** The plan text lists **11** production `.gs` files.
> Current count is **13** — `OpsChecklistRunner.gs` and
> `LeadFollowupsStaleness.gs` were added 2026-09-09, after
> `LOGIC_AUDIT.md` closed (see `file-inventory.md`, `DOC-001`).
> `LOGIC_AUDIT.md` Part 1 §4d is the source for the other 11; `HANDOVER.md`
> §2/§4.3 is the source for the two additions.

Kept as its own ID family (`GS-`) rather than folded into `JS-` because
it is a genuinely different runtime with different deployment rules —
**no CI, no `clasp`, no auto-deploy; a `.gs` edit is not live until
pasted into the Sheet's Apps Script editor** (`CLAUDE.md` top gotcha).

---

## Production `.gs` files — 13 → `DOC-029` scope

| ID | File | One-line responsibility | Own time trigger? |
|---|---|---|---|
| GS-001 | `AllIssuesEmailer.gs` | Unattended daily (17:00 IST) per-region email covering all 5 Operations SLA checks for Google Non-UTM/Search leads assigned in the last 3 calendar days. | Yes — `setupAllIssuesEmailTrigger()` |
| GS-002 | `Core.gs` | Apps Script foundation — shared row-parsing / stage-classification primitives + the one canonical IST-day helper (`istDayKeyGs_`). Config ported verbatim from the client's `CONFIG`. | No |
| GS-003 | `DailyRmIssueLog.gs` | (a) nightly (22:50 IST) snapshot of every open SLA-flagged lead into `Daily_RM_Issues` — the Repeat Offenders audit trail; (b) a console-only RM Performance leaderboard, the `.gs` mirror of `core-rm-performance.js`. | Yes (capture) — `setupDailyRmIssueLog()`; leaderboard is manual |
| GS-004 | `EmailInfra.gs` | Shared cross-script email plumbing: retry wrappers (`withRetry_`/`withSendRetry_`), the one backend leads reader (`readLeadsTab_`), region mapping (`REGION_GROUP_MAP_`, `mainRegionForGs_`), the single recipient-resolution point, ops alerting, the shared HTML email template. Holds `HEADER_ALIASES_` + `TEST_MODE_OVERRIDE_EMAIL_`. | No |
| GS-005 | `FollowupEngine.gs` | Comment-classification keyword engine + Suggested-Follow-up generator (`OUTCOME_RULES_GS_` ~30 rules, `inferOutcomeGs_`), ported from the client's outcome engine. | No |
| GS-006 | `InteractionHistoryLogger.gs` | Forward-looking capture of every open lead's genuinely-new comment into `Comment_History` (any outcome). Added 2026-09-05. **No own trigger — piggybacks on `snapshotOpenLeads_`.** | No (piggyback) |
| GS-007 | `LeadFollowupsStaleness.gs` | One-time conditional-formatting installer — paints `Lead_Followups` rows amber past 12h / red past 24h since `updated_at` (col G), so someone reading the raw sheet can't miss a stale row. Added 2026-09-09. **No trigger — the rules, once set, are evaluated live by Sheets.** | No (setup utility) |
| GS-008 | `MovementTracker.gs` | The 4×/day (`[0,6,12,18]` IST) snapshot of every open lead into `Movement_Log` — the backend history backbone; also writes the per-snapshot `SLA_History` row and (guarded) `Daily_Cohort_History`; the trigger `GS-006`/`GS-013` piggyback on. `pruneMovementLog_` at 7-day retention. | Yes — `setupMovementTracking()` (4 `atHour()` triggers) |
| GS-009 | `OpsChecklistRunner.gs` | Weekly (Monday ~09:00 IST) automated email running 3 of `OPS_CHECKLIST.md`'s automatable checks (RM-hierarchy gaps, `Manager_Directory` email gaps, `Movement_Log` freshness) as pass/fail — sends every week regardless. Added 2026-09-09. | Yes — `setupWeeklyOpsChecklistTrigger()` |
| GS-010 | `OvernightEmailer.gs` | Unattended daily overnight-lead email per region (10:00 IST) + a 13:00 IST same-thread follow-up on unresolved flagged leads; the backend side of the `Lead_Followups` review bridge; a raw Advanced-Gmail-Service reply (works around `GmailThread.reply()` misrouting). | Yes — `setupOvernightEmailer()` (10:00 + 13:00; **the sole trigger installer without an explicit `.inTimezone()`**; also calls `setupRmHierarchy()`) |
| GS-011 | `RmHierarchy.gs` | Static org-chart data (~270 rows) + the recipient-bucketing algorithm turning flagged RM names into one email bucket per manager (nearest tier `tl→tm→rh→ch`, CH-level backstop for a blank chain). Also the audits `GS-009` reuses. | No (`setupRmHierarchy()` creates sheets only) |
| GS-012 | `SlaEngine.gs` | The 5 Operations SLA rules on the backend — `computeSlaFlags_`, the `.gs` port of `enrichLead`; `primaryIssueGs_`; the shared threshold constants. | No |
| GS-013 | `UnmatchedCommentLogger.gs` | Logs every open lead whose latest comment matches no `OUTCOME_RULES_GS_` keyword into `Unmatched_Comments_Log`, for human review — the feedback loop that surfaces classifier gaps. **No own trigger — piggybacks on `snapshotOpenLeads_`.** | No (piggyback) |

---

## Scope decisions (stated explicitly so they aren't silently applied later)

### `RmHierarchy.private.gs` — **not cataloged**

Gitignored, never in this repo. It supplies `EMPLOYEE_EMAIL_BY_NAME_RAW_`
(real employee emails from an HR export). It is referenced by
`RmHierarchy.gs` via a `typeof` guard but is **never read from this
repo's copy** because it isn't here. Its absence degrades every resolved
email to `''` and routing falls back to `Region_Recipients` /
`CH_LEVEL_EMAIL_` — a confirmed soft-degrade, not a crash. **This is a
standing fact recorded on `GS-011` (EXC-084) and in `file-inventory.md`;
it gets no `GS-XXX` ID of its own.**

### `Tests_*.gs` — **not cataloged; one combined note per `GS-XXX`**

**15 files:** one `Tests_<File>.gs` per production `.gs` (13) plus
`Tests_Mocks.gs` and `Tests_RunAll.gs`. They are excluded from the
primary catalog — each `GS-XXX` record's `## Validation` section names
its `Tests_` file, the assertion style (real assertions against
in-memory `SpreadsheetApp`/`GmailApp`/`Utilities`/`ScriptApp` fakes), and
the last green CI run. They get **no `TEST-` IDs**. (The plan text says
"12 `Tests_*.gs`"; there are now 13 `Tests_<File>.gs` + Mocks + RunAll =
15, tracking the two 2026-09-09 production additions.)

### `appsscript.json` — **not in the repo**

No manifest is checked in; the authoritative one (timezone, Advanced
Gmail Service enablement) lives inside the bound Apps Script project
(`HANDOVER.md` §2, §4.3). Not a gap.

---

## Definition of Done check

- **Every production `.gs` file has a row** — ✅ (13 rows; the two
  post-audit additions flagged, with `HANDOVER.md` §2/§4.3 as their
  source).
- **The test-file and private-file scope decisions are stated
  explicitly** — ✅ (`RmHierarchy.private.gs` not cataloged, standing
  fact; `Tests_*.gs` not cataloged, one combined note per `GS-XXX`; no
  `appsscript.json`).
