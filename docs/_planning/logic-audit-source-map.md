# `LOGIC_AUDIT.md` source map (`DOC-003`)

**Produced:** 2026-09-10, against `LOGIC_AUDIT.md` at commit `e281f9b`
(the audit itself is frozen — Part 1 committed 2026-09-05, Parts 2–7
2026-09-07, final assembly `0d69729`; "not maintained forward").
**Purpose:** turn the audit's 7 parts into a lookup so any Documentation
Project task can cite it directly instead of re-deriving verified facts.
(`DOCUMENTATION_PROJECT_PLAN.md` Phase 1, `DOC-003`.)

> **Ordering note.** Phase 3 (`DOC-025`–`DOC-034`) already used the audit
> this way — every Phase 3 record's `## Validation` / `## Related
> documentation` cites the specific Part/section it drew from. This map
> is the consolidated index those citations already imply.

---

## The audit's structure (as it exists in the file)

| Part | Title | Sections |
|---|---|---|
| **Part 1** | Architecture + File/Component Map | §0 why the generic template doesn't apply · §1 the 19 layers · §2 central files / sources of truth · §3 overall architecture diagram (Mermaid) · **§4 File / Component Map** — §4a HTML shell, §4b JS core/foundation layer, §4c JS tab/feature layer, §4d Apps Script backend · **§5 consolidated trigger table** · §6 open items carried forward |
| **Part 2** | Data Flow + User Flow Tracing | §0 template fields that don't exist here · **§1 field-by-field trace** · §2 Mermaid — initial dashboard load · §3 Mermaid — filter apply / reset · §4 Mermaid — write-back / mutation (manual snapshot) · **§5 major user flows, end to end** · §6 open items |
| **Part 3** | Business Logic Audit | §3.1 the 6 SLA/Operations issue flags · §3.2 comment classification (`OUTCOME_RULES`) · §3.3 Do-Not-Disturb handling · §3.4 follow-up suggestion generation · §3.5 region normalization · §3.6 repeat-offender / RM Performance scoring · §3.7 RM hierarchy / email routing fallback · §3.8 follow-up wait/cancel + Generate-cycle mutex · §3.9 region-email generation rules · §3.10 open items |
| **Part 4** | Cross-Runtime Consistency + API/DB Checks | §4.1 `OUTCOME_RULES` vs `OUTCOME_RULES_GS_` — full diff · §4.2 `enrichLead()` vs `computeSlaFlags_()` — full diff · §4.3 `REGION_GROUP_MAP` vs `REGION_GROUP_MAP_` — full diff · **§4.4 🔴 Loan-region override silently missing from both scheduled emails** · §4.5 the Movement_Log-only reduced Loan override — confirmed consistent · §4.6 IST timezone — different mechanisms, verified equivalent · §4.7 Movement_Log write schema — the two writers agree exactly · §4.8 `HEADER_ALIASES` vs `HEADER_ALIASES_` — the rest of the diff · §4.9 🟡 `MIN_CALLS_AFTER_48H` — display-only, never used in flag logic · §4.10 summary table · §4.11 open items |
| **Part 5** | Metrics, Filters, State + Edge Cases | §5.1 KPI audit — the Overview KPI strip · §5.2 filters/search/sort/pagination — 3 of the 4 don't exist as the generic template assumes · §5.3 state-management inventory · §5.4 edge cases — walked against real code · §5.5 open items |
| **Part 6** | Duplicate/Dead Logic + Hidden Dependencies + Source-of-Truth Matrix | §6.1 the pending UI-redesign plan's known-bug list — re-verified (**all 7 do not reproduce**) · §6.2 duplicate/dead/conflicting logic — new findings · **§6.3 hidden dependencies — "if I change this, what could break?"** · §6.4 source-of-truth matrix · §6.5 system-wide logic matrix · §6.6 findings carried forward for Part 7's ranking |
| **Part 7** | Findings, Plain-English Walkthrough + Final Assembled Report | plain-English walkthrough (§8–§13) · §14 diagram G (Movement snapshot pipeline) · other diagrams · **§18 the findings list — 1 HIGH, 3 MEDIUM, 4 LOW + 1 process note** · §19 what to do next, in order |

---

## Component category → primary `LOGIC_AUDIT.md` source

| Phase 3 category | Primary source(s) | Also useful | Notes |
|---|---|---|---|
| **`DASH-` dashboards** (`DOC-025`) | Part 1 §0 (why one dashboard, not per-tab), §1 (the 19 layers), §3 (architecture diagram) | Part 7 §18 (known limitations to cite), Part 5 §5.1 (the KPI-strip customer-vs-issue mix, a LOW finding) | Granularity decision (`DOC-004`) is *implied* by §4a's "one `dashboard.html`" — confirmed there. |
| **`TAB-` tabs** (`DOC-026`) | Part 1 §4c (the JS tab/feature layer table — one row per tab-owning file), Part 2 §1 (which state array each reads) | Part 2 §5 (major user flows, per tab), Part 3 §3.6/§3.9 (Repeat Offenders / Operations tab logic) | The tab↔`JS-` mapping is `dashboard.html`'s own markup, cross-checked against §4c's file responsibilities. |
| **`JS-` client modules** (`DOC-027`, `DOC-028`) | **Part 1 §4b** (core/foundation layer table) + **§4c** (tab/feature layer table) — "substantially a structured transcription" per the plan | Part 3 (per-rule logic for `JS-006`/`JS-007`/`JS-008`/`JS-014`), Part 5 §5.3 (state inventory for `JS-009`), Part 6 §6.1 (the re-verified bug list for `JS-010`/`JS-012`/`JS-015`/`JS-018`) | §4b/§4c line numbers cite the 2026-09-05 file version; check `DOC-001`'s drift notes (files grew). |
| **`GS-` backend modules** (`DOC-029`) | **Part 1 §4d** (the Apps Script backend table) + **§5** (the consolidated trigger table — exact `atHour()`/`.inTimezone()` values) | Part 3 §3.7 (`GS-011` routing), §3.8 (`GS-010` follow-up bridge), §3.9 (`GS-001`/`GS-010` email rules), Part 4 (every cross-runtime pair) | §4d lists **11** production `.gs`; `OpsChecklistRunner.gs` + `LeadFollowupsStaleness.gs` post-date the audit (see `DOC-001` drift) — **HANDOVER.md §2/§4.3 is the source for those two**. |
| **Functions** (`DOC-008`, `DOC-030`) | **Part 1 §4b/§4c/§4d "Important Logic" columns** + **§5 trigger table** (for `setupXxx()` installers) | Part 3 (the rule-dense functions), Part 6 §6.5 (the system-wide logic matrix) | The significance bar (`DOC-008`) is stated in `function-inventory.md`; `LOGIC_AUDIT.md` seeds it, a cross-file `grep` finishes it. |
| **Buttons** (`DOC-009`, `DOC-031`) | Part 1 §4c (mentions `#snapshotNowBtn`, `#generateBtn`, the Tracking admin buttons in the file table) + **Part 2 §4** (the write-back Mermaid — traces `#snapshotNowBtn` → `browserSnapshotOpenLeads`) | Part 2 §5 (user flows name the Generate / Gmail buttons) | The audit names *most* buttons but not all — `dashboard.html`'s own `<button id>` scan is the authority (`button-inventory.md`). |
| **`SHEET-` Sheet tabs** (`DOC-032`) | Part 1 §1 (the 14-tab datastore list), **§4c/§4d** (writer/reader per tab), Part 4 §4.7 (Movement_Log two-writer schema parity) | Part 3 §3.5 (region tabs), Part 2 §4 (write-back flow) | The audit's §1 list has all 14 names; the **column lists** are NOT in the audit — they come from the source constants (`SNAPSHOT_COLUMNS_` etc.), read directly in `DOC-032`. |
| **`EXT-` integrations** (`DOC-011`, `DOC-033`) | Part 1 §1 layers 2/3/4/12/16/18 (auth, fetch, Gmail send, export, backend infra) | Part 5 §5.4 (the Sheets-API edge cases — 403/404, token expiry), Part 3 §3.7 (routing / `withRetry_`) | 4 integrations; the audit covers behaviour, `dashboard.html`'s `<head>` scan confirms the set (jsPDF/jspdf-autotable CDN + GIS). |
| **`DATA-` data flows** (`DOC-034`) | **Part 2 §1** (field-by-field trace) + **§2/§3/§4** (the three Mermaid flow diagrams) + **§5** (major user flows) | Part 7 §14 (diagram G — the Movement snapshot pipeline), Part 4 §4.4 (the HIGH Loan-region finding that `DATA-005` carries) | `DATA-001`..`005` are a restructuring of Part 2 as flows rather than a flat trace. |
| **Relationships** (`DOC-035`, the `Depends On`/`Used By` graph) | **Part 6 §6.3** ("if I change this, what could break") + **§6.4 source-of-truth matrix** + **§6.5 system-wide logic matrix** | Part 1 §2 (central files / sources of truth), Part 7 §14 + diagram G (the 4 hubs: `allParsedLeads`, `movementSnapshots`, `filterState`, `_currentSheetId`) | `DOC-035` builds `docs/RELATIONSHIP_MAP.md` from §6.3/§6.5 + diagram G "reusing that diagram directly rather than redrawing it." |

---

## Categories NOT covered by the audit — original research needed

| Category | Why the audit doesn't cover it | Where the Phase 3 fact came from instead |
|---|---|---|
| `OpsChecklistRunner.gs` (`GS-009`), `LeadFollowupsStaleness.gs` (`GS-007`) | added 2026-09-09, two days after the audit closed | `HANDOVER.md` §2/§4.3 + a direct read of the files |
| `js/rm-performance-worker.js` (`JS-017`) | the audit's §4c dashboard-file table doesn't list it (it's a Web Worker, not a `<script src>`) — Part 1 §1 layer 6 mentions RM-performance compute but not the worker split by name | direct read of the file (the `importScripts` list + `onmessage` message contract) |
| **Sheet tab column lists** (every `SHEET-XXX` `## Columns / fields`) | the audit records tab *purposes* and writer/reader, not the actual header arrays | the source constants: `SNAPSHOT_COLUMNS_`, `SLA_HISTORY_COLUMNS_`, `DAILY_COHORT_HISTORY_COLUMNS_`, `DAILY_RM_ISSUE_LOG_COLUMNS_`, `COMMENT_HISTORY_COLUMNS_`, `UNMATCHED_COMMENTS_LOG_COLUMNS_`, `SEND_LOG_COLUMNS`, + the header literals in `EmailInfra.gs` / `AllIssuesEmailer.gs` / `OvernightEmailer.gs` / `RmHierarchy.gs` — read directly in `DOC-032` |
| **The `RM_PERF_*` / `computeRmPerformanceByRegion` / alias / leadership-exclusion detail** on `JS-008` / `TAB-004` | the audit's §3.6 covers RM-performance scoring at the *design* level; the alias handling (`rmPerfCanonicalRmName`), broadened `RM_PERF_NON_RM_ROLES`, and per-region worst-5 were all added **2026-09-10 (this session)**, after the audit | this session's own fix commits (`fef04b0`, `7ef26db`, `812a3cb`, `8d9acbc`, `ddc0097`) + direct reads |
| **Post-audit line counts** | every `§4b`/`§4c`/`§4d` line-number citation is against the 2026-09-05 file version; several files grew materially (`core-rm-performance.js` 485→869, `tab-repeat-offenders.js` 383→717, `DailyRmIssueLog.gs` 980→1127, `OvernightEmailer.gs` 1374→1409, `RmHierarchy.gs` 1054→1122, `MovementTracker.gs` 945→1000) | current `wc -l` + `grep -n` at `e281f9b`; the audit is still the authority for *what the file does*, just not for *where in the file* |
| **`docs/` itself** | didn't exist at audit time | this project |

---

## Definition of Done check

- **Every Phase 3 category (dashboards, tabs, JS, GS, functions, buttons,
  Sheets, integrations, data flows, relationships) has at least one
  `LOGIC_AUDIT.md` pointer, or is explicitly marked "not covered — original
  research needed"** — ✅ (the category table + the not-covered table
  together cover all 10 categories; every one has either a Part/section
  pointer or an explicit "not covered, source was X" row).
