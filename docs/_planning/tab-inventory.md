# Tab inventory (`DOC-005`)

**Produced:** 2026-09-10, against `dashboard.html` + `js/*.js` at commit
`e281f9b`. Render call sites confirmed by reading `renderAll()`'s body
(`js/overview-distribution-people-ops.js`), not inferred from tab names.
(`DOCUMENTATION_PROJECT_PLAN.md` Phase 1, `DOC-005`.)

---

## The 8 tabs

`dashboard.html` has exactly **8** `<div class="tab-panel" id="tab-*">`
containers and **8** `<button class="tab-btn" data-tab="tab-*">` in
`#tabBar` (id-less; the tab switcher is one delegated `click` handler on
`#tabBar` at `js/overview-distribution-people-ops.js:364` that toggles
the `.active` class on `.tab-btn` / `.tab-panel` — no per-tab render on
switch).

| Catalog ID | Tab name (button label) | DOM id | `#tabBar` order | Owning module(s) | Primary render function — **confirmed call site** |
|---|---|---|---|---|---|
| `TAB-001` | Morning Brief | `#tab-morning` | 1 | `JS-020` `tab-morning.js` | `renderMorningBrief()` — called from `renderAll()` **only when `_refreshMorningBriefOnNextRender` is set** (`overview-distribution-people-ops.js`, top of `renderAll()`); also re-called at Generate checkpoints by `JS-016` / `JS-021` |
| `TAB-002` | Overview | `#tab-overview` | 2 (`class="tab-panel active"` — the default) | `JS-012` `overview-distribution-people-ops.js` | no single fn — `renderAll()` calls `renderStageBreakdown()`, `renderFunnel()`, `renderRegionTable()`, `renderTLTable()`, `renderProjectTable()`, `renderDailyTrend()`, `renderRMTable()` (all `JS-012`) into this panel |
| `TAB-003` | Operations | `#tab-operations` | 3 | `JS-012` (issue lists) + `JS-014`/`JS-015`/`JS-016` (region-email panel) + `JS-018` (writes) | `renderAll()` calls the 9 issue-list fns: `renderStalledFlaggedLeadsOps()` (**`JS-021`**), `renderInactiveRmList()`, `renderNotUpdatedList()`, `renderNotConnectedList()`, `renderFollowupList()`, `renderDueTodayList()`, `renderApproachingDeadlineList()`, `renderStuckList()`, `renderRecordingList()`, `renderClosedNoCommentList()` (the last 8 in `JS-012`). The Generate panel renders via `renderReports()` (`JS-016`) on the `#generateBtn` click, **not** from `renderAll()` |
| `TAB-004` | Repeat Offenders | `#tab-repeatoffenders` | 4 | `JS-022` `tab-repeat-offenders.js` (+ `JS-017` worker, `JS-008` engine, `JS-013` PDF) | `renderRepeatOffenders()` — called from `renderAll()` (`overview-distribution-people-ops.js`); it dispatches to the `JS-017` Worker (or the sync fallback) |
| `TAB-005` | People | `#tab-people` | 5 | `JS-012` (score tables/allocation) + `JS-023` `tab-rmtimeline.js` (the RM Timeline sub-view) | `renderAll()` calls `renderRMScoreTable()`, `renderFanout()`, `renderAllocationMatrix()`, `renderSourceMix()` (`JS-012`) **and `renderRMTimelineTab()` (`JS-023`)** into this panel |
| `TAB-006` | Audit | `#tab-audit` | 6 | `JS-019` `tab-audit.js` | `renderAudit()` **and** `renderActivityByHour()` — both called from `renderAll()` |
| `TAB-007` | Movement | `#tab-movement` | 7 | `JS-021` `tab-movement.js` (+ `JS-018` for its Overnight write cycle) | `renderMovementTab()` — called from `renderAll()` |
| `TAB-008` | Tracking | `#tab-tracking` | 8 | `JS-024` `tab-tracking.js` (+ `JS-018` writes, `JS-004` `clearSlaHistory`) | `renderTrackingTab()` — called from `renderAll()` |

---

## Sub-views that behave like their own view

| Sub-view | Lives inside | Owning module | Why it's not its own `TAB-` | Notes |
|---|---|---|---|---|
| **RM Timeline** (per-RM 7-day calendar + day timeline + open-issue list + issue-history trend chart) | `TAB-005` People (`#tab-people`) | `JS-023` `tab-rmtimeline.js` | No `#tab-rmtimeline` container and no `#tabBar` button — it renders into the People panel. It has its own bootstrap (`initRMTimelineUI()`, one of `main.js`'s 4 calls) and its own RM-selector UI. | Documented as `UI-007`/`UI-008` on `TAB-005`, and `JS-023` is a full `JS-XXX` record. It reuses `updateEventsFor` (`JS-019`) and `buildTrackingChartSvg` (`JS-024`). |
| **Overview vs Distribution vs People "sections"** | `TAB-002` / (Distribution content) / `TAB-005` | `JS-012` (one module) | `renderAll()` renders them together; the plan's `DOC-004` decision keeps them as `TAB-002`/`TAB-005` (Distribution folds into Overview — there is no `#tab-distribution` in `dashboard.html`). | The module name `overview-distribution-people-ops.js` predates the tab consolidation. |
| **The Operations region-email panel** | `TAB-003` Operations | `JS-014`/`JS-015`/`JS-016` | It's a panel within Operations, driven by `#generateBtn`, not a separate view. | `BTN-002`..`BTN-009` on `TAB-003`. |

---

## Notes / drift

- **`renderAll()` renders every tab in one pass** (`LOGIC_AUDIT.md` Part
  1 §1 layer 10) — confirmed: its body invokes a render fn for all 8
  tabs. The two exceptions are (a) Morning Brief, gated by
  `_refreshMorningBriefOnNextRender`, and (b) the Operations Generate
  panel + the region-report tabs, which refresh only at explicit
  Generate checkpoints, not on every filter tweak.
- **`renderStalledFlaggedLeadsOps()`** — an Operations-tab render fn that
  lives in `js/tab-movement.js` (`JS-021`), not `JS-012`, because it
  needs `movementSnapshots`. A cross-file case worth noting for
  `DOC-026`.
- No `onclick=` attributes anywhere in `dashboard.html` — every tab and
  button is wired in JS (`LOGIC_AUDIT.md` Part 1 §4a).

---

## Definition of Done check

- **Every `#tab-*` id in `dashboard.html` has a row** — ✅ (8 rows;
  `#tab-morning`, `#tab-overview`, `#tab-operations`,
  `#tab-repeatoffenders`, `#tab-people`, `#tab-audit`, `#tab-movement`,
  `#tab-tracking`).
- **Every row's render function is confirmed by reading the actual call
  site** — ✅ (from `renderAll()`'s body at
  `js/overview-distribution-people-ops.js`, quoted above — not inferred
  from the tab name; the cross-file `renderStalledFlaggedLeadsOps` case
  is called out).
