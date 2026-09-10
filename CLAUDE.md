# CLAUDE.md — Leads Dashboard

Quick orientation and the gotchas that actually bite. For depth on any of
this, see `HANDOVER.md` — this file deliberately doesn't duplicate it.

## What this is

Two independent halves sharing one Google Sheet, never talking to each
other directly:

1. **`dashboard.html` + `js/*.js`** — static, client-only, no build step, on
   GitHub Pages. A signed-in browser reads the Sheet via the Sheets API,
   renders every tab, writes back (snapshots, follow-ups, SLA history), and
   sends region-summary emails via a *separate* Gmail OAuth grant.
2. **The Apps Script backend** (`Core.gs`, `SlaEngine.gs`,
   `FollowupEngine.gs`, `EmailInfra.gs`, `MovementTracker.gs`,
   `OvernightEmailer.gs`, `AllIssuesEmailer.gs`, `RmHierarchy.gs`,
   `RmHierarchy.private.gs`, `UnmatchedCommentLogger.gs`,
   `DailyRmIssueLog.gs`, `OpsChecklistRunner.gs`,
   `LeadFollowupsStaleness.gs`) — bound to the same Sheet, running
   unattended on a fixed clock schedule for the things a static page
   can't do alone.

9 of the 10 `js/core-*.js` files load first (`HANDOVER.md` §2 for the exact
order), then the tab files, then `main.js` last. The exception is
`core-rm-performance.js`, which loads later — interleaved among the tab files
(position 15 of 23) — and that's harmless because nothing at parse time calls
into it. Every `.gs` file shares ONE global namespace regardless of filename
— the split is purely organizational.

## The gotchas that actually cost time here

- **Apps Script does not auto-deploy from git.** The authoritative running
  copy is inside the Sheet's own Extensions → Apps Script editor. A `.gs`
  edit in this repo is not live until you manually paste its full contents
  over the matching file there and save — this has caused more than one
  real "the fix is committed but the bug is still happening live" incident.
  If you touched anything with a time trigger, re-run that file's
  `setupXxx()` once too (`HANDOVER.md` §4.3 for the full list).
- **Logic is duplicated across the two runtimes on purpose** (browser can't
  `import` Apps Script and vice versa) — `HANDOVER.md` §6 has the exact
  pairs (SLA rules, comment-classification keywords, row parsing). Editing
  one side only means the dashboard and the automatic emails will silently
  disagree about the same lead.
- **Everything date/time-sensitive is pinned to IST explicitly, never to
  whatever timezone the browser or the machine running a script happens to
  be in.** The dashboard uses `istDateKey`/`IST_TZ`-style helpers
  (`js/core-foundation.js`); Apps Script uses `istDayKeyGs_`
  (`Core.gs`) plus literal `+05:30` offsets when formatting a timestamp for
  a sheet cell. A "midnight" or "today" computed from local machine/browser
  time instead of one of these helpers will be wrong for anyone not
  physically in IST, and wrong for any script run in a UTC CI environment.
- **PowerShell auto-unwraps a single-element array return to a bare
  scalar.** Any local verification/ops script for this repo that does
  `$r = SomeFunction ...` and later reads `$r.Count` or `$r[0]` will
  silently misbehave the one time the result happens to have exactly one
  item (`.Count` reads as `$null`, not `1`) — confirmed for real writing
  `tests/test-server-merge.ps1`'s own assertions (2026-09-04, To-Do
  Dashboard project, same underlying PowerShell behavior). Wrap the call
  site in `@(...)` — `$r = @(SomeFunction ...)` — whenever the result must
  stay a real array regardless of how many items come back.
- **No CI/`clasp`/automated deploy for `.gs` files at all** — see the point
  above. There *is* CI for the test suite itself (`.github/workflows/test.yml`,
  runs `node test/run-gs-tests.js` on every push) — that only proves the
  logic is correct, not that it's live on the Sheet.
- **Adding a new `.gs` production or `Tests_*.gs` file needs THREE
  registrations, not one.** `Tests_RunAll.gs`'s `suites` array alone isn't
  enough — `test/run-gs-tests.js` (the Node/CI harness) hardcodes its own
  separate `PRODUCTION_FILES`/`TEST_FILES` lists, since Node has no way to
  discover "every file pasted into this Apps Script project" the way the
  real Apps Script editor does. Miss that list and CI throws a
  `ReferenceError` on the new suite function — it was never loaded into
  the sandbox, so `runAllTests()` can't resolve the name (real incident,
  CHECKLIST-006, 2026-09-09). Add it to: `Tests_RunAll.gs`'s `suites`
  array, `test/run-gs-tests.js`'s file lists, AND paste it into the live
  Apps Script editor per the point above.
- **`RmHierarchy.private.gs` is never in git** (`.gitignore`) — real
  employee emails. Get it directly from whoever last had it, out of band.
  Its absence doesn't crash anything; routing just silently degrades to a
  generic fallback address.
- **This machine has no local Node.js** as of 2026-09-04 (`node`/`gh` both
  unresolved in both Bash and PowerShell) — `npm test` can't run locally
  here. Push and let GitHub Actions run the suite instead; check the run's
  status via the GitHub web UI (Browser pane) rather than `gh`. A working
  `python3`/`python` (Windows Store launcher) *is* available, confirmed
  2026-09-09 — useful for local dry-runs/validation Node would otherwise
  cover, and for building `.docx`/`.pptx` output, but it doesn't change
  the point above: any `.gs` test-suite verification still has to happen
  via a real CI push, not locally.
- **A real architectural change updates `HANDOVER.md`'s relevant section
  (§1–§3 especially) in the SAME commit** — not a separate follow-up, not
  "later." `HANDOVER.md` already says this about itself; stating it
  wasn't enough on its own — confirmed for real 2026-09-09, when it sat
  untouched for a full week (2026-09-02 → 09-09) through several real
  redesigns (RM Performance, the region-wise worst-5 breakdown, two new
  `.gs` subsystems) despite that exact sentence already being there. `docs/`
  (`DOCUMENTATION_PROJECT_PLAN.md`) will eventually take over this job for
  real (`docs/RELATIONSHIP_MAP.md` + component records, Phase 2/3, not
  built yet) — until then `HANDOVER.md` is it, and
  `test/check-docs-coverage.js` (below) now WARNS in CI when it's gone
  stale too long, since a written rule with nothing checking it drifts
  regardless of how clearly it's stated.

## Testing

- **`.gs` changes**: `Tests_Mocks.gs` + one `Tests_<File>.gs` per production
  file + `Tests_RunAll.gs` — real assertions against in-memory fakes of
  `SpreadsheetApp`/`GmailApp`/`Utilities`/`ScriptApp`, never your real
  spreadsheet or a real send. Run locally with `node test/run-gs-tests.js`
  (needs Node — see above) or via CI on push. When you add/change a `.gs`
  function, add the matching assertion in the same commit.
- **`js/*.js` changes**: the persisted suite is
  `tests/frontend-harness.html` — it grafts the real `dashboard.html` +
  `js/*.js`, mocks only the network boundary (Sheets read + OAuth token
  pair), and runs synthetic leads through the real `fetchAndRender()`
  pipeline. **In CI headless (Playwright, blocking)** since
  2026-09-10 — `test/run-frontend-harness.mjs`; also run it locally
  (serve the repo, open the page). Re-run + extend it after any
  dashboard-side change rather than hand-verifying in the console.
- **Changing, adding, or removing any `js/*.js` / `.gs` file — or editing
  a `docs/` record or `docs/INDEX.md`**: two CI steps run after the `.gs`
  suite.
  - `test/check-docs-coverage.js` (`CI-001`–`CI-005`) — file↔record
    existence for `js/*.js` + `.gs`, plus a `HANDOVER.md` "updated" date
    age warning. WARN-ONLY (always exits 0).
  - `test/check-catalog.py` (`t-tf-5ad22d8e4c2e`, 2026-09-10) — the
    catalog change-control tripwires. **BLOCKING** on: (A) `docs/INDEX.md`
    internal `Depends On` / `Used By` reciprocity, (B) `INDEX.md` ↔
    record-file coverage both ways across all 7 own-file types, (C) an
    `INDEX.md` `Location` naming a `js/`/`.gs` file that no longer exists.
    **Advisory** (prints, doesn't fail): (D) a record whose `Last
    Verified` commit is behind `HEAD` on its `## Location` path, (E) for
    the push's commit range, the affected component IDs + 1-hop impact +
    a ready-to-run `update-tasks.ps1` ops JSON to open the revalidation
    task (CI can't reach `tasks.json`). Set `CATALOG_STRICT=1` to make
    D/E blocking too. Needs `fetch-depth: 0` on `actions/checkout`
    (already set). Runnable locally: `python3 test/check-catalog.py
    [<before-sha> <after-sha>]`.
  - **When a real code change lands**, check E's output in the CI log,
    run the ops JSON it prints to open the revalidation task, then work
    it per `docs/HOW_TO_UPDATE_A_COMPONENT.md` (the human half of the
    loop — `DOCUMENTATION_PROJECT_PLAN.md` Change-Control Mechanism steps
    7–10). `test/check-docs-coverage.js`'s WARN-ONLY graduation is now
    moot — `check-catalog.py` B is the blocking coverage check.
- **Changing automatic email, RM hierarchy routing, or worst-performing-RM
  logic specifically** (`OvernightEmailer.gs`/`AllIssuesEmailer.gs`,
  `RmHierarchy.gs`, RM Performance/`DailyRmIssueLog.gs`): run
  `OPS_CHECKLIST.md`'s pre-change and post-deploy items *before and after*
  the `Tests_*.gs` run above, not instead of it — a green test suite proves
  the logic is correct, the checklist catches the class of gap that's
  correct-but-silently-incomplete (an unthreaded new argument, a
  rolling-vs-calendar-day window, a drifted constant between the two
  runtimes).
- **Changing anything that reads or writes `Lead_Followups`**
  (`js/sheets-writeback.js`, `js/reports-ui.js`, `js/tab-movement.js`,
  `OvernightEmailer.gs`'s `pushUnresolvedToLeadFollowups_`/
  `waitForFollowupSuggestions_`, or `LeadFollowupsStaleness.gs`): read
  `LEAD_FOLLOWUPS_STALENESS.md` first — it maps every real consumer and
  each one's actual staleness tolerance, so a new write path or read site
  gets checked against the same reasoning rather than re-derived from
  scratch. If you add a new consumer, add it to that map in the same
  change, the same discipline this file's own Testing section already
  asks for `.gs` assertions.

## Where to look when something breaks

`HANDOVER.md` §8 is a maintained list of real past incidents and their
symptoms (missing nightly capture, slow email sends, mis-routed recipients,
a real dedup bug from a Sheets Date-vs-string mismatch) — check there before
assuming something is a new bug. `OPS_CHECKLIST.md` is the companion,
proactive counterpart — periodic checks (RM-hierarchy gaps, Manager_Directory
email gaps, Movement_Log capture freshness, worst-performer methodology
drift) meant to catch this project's slow-drifting failure class *before*
it produces one of §8's incidents, not after. `LEAD_FOLLOWUPS_STALENESS.md`
is the same idea, scoped to one sheet — a lead reads as stuck on an issue
it's already past ("in Follow-up" despite being an Opportunity, etc.),
check there before assuming the classification logic itself is wrong.
