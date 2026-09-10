# Dashboard inventory (`DOC-004`)

**Produced:** 2026-09-10, against `dashboard.html` at commit `e281f9b`.
**Purpose:** fix, before any `DASH-XXX` record is written, what counts
as "a dashboard" in this project's catalog.
(`DOCUMENTATION_PROJECT_PLAN.md` Phase 1, `DOC-004`.)

---

## The granularity decision

**This project has exactly one dashboard: `DASH-001` — the Leads
Dashboard (`dashboard.html` + `js/*.js`).** Its 8 UI tabs are
`TAB-001`..`TAB-008` **under** it, not dashboards in their own right.

### Reasoning (confirmed from code, not assumed)

1. **One HTML page, one entry point.** `dashboard.html` is the only
   page a user loads. There is no `overview.html`, `reports.html`, etc.
   — every tab is a `<div class="tab-panel" id="tab-*">` inside the same
   document (`LOGIC_AUDIT.md` Part 1 §4a; confirmed by
   `grep -c '<div class="tab-panel"' dashboard.html` → 8, all in one
   file).
2. **One sign-in gate.** `#authGate` (`js/core-auth.js` `initAuthGate`)
   blocks the whole page; there is no per-tab access control.
3. **One render pass.** `renderAll()` (`js/overview-distribution-people-ops.js`)
   renders **every** tab's content in a single pass on data load; tab
   switching afterward is a pure `display` toggle on pre-rendered DOM
   (`LOGIC_AUDIT.md` Part 1 §1 layer 10, Part 2 §5). The tabs are not
   independently loadable "apps."
4. **One shared global scope.** All 24 `js/*.js` files share one script
   scope; a tab file calls another tab file's function as a bare global.
   The tabs are organizational, not architectural, boundaries — the same
   as the `.gs` file split (`HANDOVER.md` §2).
5. **The plan's own steer.** `DOC-004`'s objective text and `DOC-025`
   assume `DASH-001` = "the Leads Dashboard" with `TAB-001`..`TAB-008`
   beneath it. This inventory confirms that is the right call, it does
   not re-open it.

### What this means for later tasks

- `DASH-001` gets **one** record (`docs/dashboards/DASH-001-leads-dashboard.md`,
  written by `DOC-025`).
- Tab-wide vs tab-scoped actions split cleanly: dashboard-wide controls
  (sign in, refresh, change source, clear filters, download filtered
  lead-ids, the tab switcher) live on `DASH-001`'s `## Top-level buttons
  / actions`; every other button is a `BTN-XXX` on its owning `TAB-XXX`
  (`DOC-026` / `DOC-031`, `button-inventory.md`).
- Each `JS-XXX` / `GS-XXX` record's `## Architecture relationship`
  points at `DASH-001` (client modules) or names the Apps Script backend
  as `DASH-001`'s peer half (backend modules).

---

## The confirmed dashboard list

| ID | Name | Location | Entry point | Tabs |
|---|---|---|---|---|
| `DASH-001` | Leads Dashboard | `dashboard.html` + `js/*.js` (24 modules), deployed on GitHub Pages | one URL, gated by `#authGate` (Google sign-in, Sheets scope) | `TAB-001` Morning Brief · `TAB-002` Overview · `TAB-003` Operations · `TAB-004` Repeat Offenders · `TAB-005` People (contains RM Timeline) · `TAB-006` Audit · `TAB-007` Movement · `TAB-008` Tracking |

**No second dashboard.** `design/live-ops-redesign.html` is a standalone
visual mockup — not wired to real data, not part of the live app
(`HANDOVER.md` §2) — and is **not** a dashboard for catalog purposes.

**The Apps Script backend is not a dashboard** — it has no UI. It is
`DASH-001`'s peer half, sharing only the Google Sheet (`SHEET-*`), never
called by the dashboard and never calling it (`HANDOVER.md` §1).

---

## Definition of Done check

- **Exactly one clear statement of what "a dashboard" means in this
  project's catalog, used consistently by every later task** — ✅ (the
  granularity decision above: one dashboard `DASH-001`, tabs are
  `TAB-XXX` beneath it; already applied by `DOC-025` / `DOC-026` /
  `DOC-031` and every `JS-`/`GS-` record's `## Architecture
  relationship`).
