/**
 * Tests: OpsChecklistRunner.gs — the weekly automated summary that wires
 * OPS_CHECKLIST.md's periodic-operational tier into an unattended signal.
 * Run runOpsChecklistRunnerTestsNow() from the function dropdown, or via
 * runAllTests() (Tests_RunAll.gs).
 */
function runOpsChecklistRunnerTests_() {
  const now = new Date('2026-09-09T09:00:00+05:30');
  // Header row only, for Feature_Usage test fixtures below — the
  // production reader (checkStaleComponents_) reads this tab positionally
  // (component_id, last_used_at, use_count, first_seen_at), same as every
  // other Movement_Log-style reader in this project, so the header's exact
  // text is never actually checked; it only needs to occupy row 1 so
  // getLastRow()/the data-row slice below line up the same way a real
  // Feature_Usage sheet (header + data) would.
  const FEATURE_USAGE_HEADER_TEST_ = ['component_id', 'last_used_at', 'use_count', 'first_seen_at'];
  // Formats a Date into the SAME local-timezone 'YYYY-MM-DD HH:mm:ss' shape
  // parseFeatureUsageTimestampGs_ parses, using the runtime's own local-time
  // field getters both ways -- so a boundary built as e.g. "usageNow minus
  // exactly 30 days" round-trips to the exact same getTime() regardless of
  // what timezone this test runtime actually runs in (Node vm vs headless
  // Chrome vs CI). A hardcoded IST-looking string literal would NOT have
  // this property -- it would silently assume the runtime's local zone IS
  // IST, which is exactly the class of bug this project's own "pin to IST
  // explicitly" CLAUDE.md gotcha warns about, and would make a tight
  // (1-minute-margin) boundary test flaky or simply wrong depending on
  // where it runs. Coarser (multi-day-margin) fixtures elsewhere in this
  // file don't need this -- only the exact-30-day boundary test below does.
  function opsTestLocalDateString_(d) {
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' +
      p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
  }

  // ---- buildWeeklyOpsChecklistSummary_: clean case, nothing flagged ----
  const cleanLeadsHeader = TestFixture_leadsHeader_();
  const cleanBannerRow = cleanLeadsHeader.map(function () { return ''; });
  const cleanSs = TestMockSpreadsheet_({
    // auditUnresolvedRms_ throws if the leads tab is missing entirely
    // (see its own header comment) — an empty-but-present tab (banner +
    // header, no data rows) is the correctly-clean case, not "absent".
    'leads': TestMockSheet_('leads', [cleanBannerRow, cleanLeadsHeader]),
    'RM_Hierarchy': TestMockSheet_('RM_Hierarchy', TestFixture_rmHierarchyRows_()),
    // Every manager here has a real email (TestFixture_managerDirectoryRows_
    // has one deliberate gap — 'Test A1 NoMail' — so this sub-test uses its
    // own gap-free fixture instead, to isolate the "everything clean" case).
    'Manager_Directory': TestMockSheet_('Manager_Directory', [
      ['manager_name', 'roles', 'regions', 'email', 'people_reporting_up_to_them', 'email_source'],
      ['Test A1 One', 'TL', 'Test Region', TEST_EMAIL_PRIMARY_, 2, 'manual'],
    ]),
    // checkMovementLogFreshness_ reads Movement_Log_Runs, not
    // Movement_Log itself, since Phase 6 of the Lead History &
    // Versioning Review (docs/_planning/DB_ARCHITECTURE_REVIEW.md) —
    // Movement_Log's own last row stopped being a reliable "did a
    // capture happen" signal once content-hash dedup means an unchanged
    // lead no longer gets a new row every run.
    'Movement_Log_Runs': TestMockSheet_('Movement_Log_Runs', [
      MOVEMENT_LOG_RUNS_COLUMNS_,
      [new Date(now.getTime() - 2 * 3600000), 'clean test', 1, 0],
    ]),
  });
  TestEnv_setUp_('Tests_OpsChecklistRunner', cleanSs);
  try {
    const cleanSummary = buildWeeklyOpsChecklistSummary_(cleanSs, now);
    TestAssertEqual_(cleanSummary.issueCount, 0, 'buildWeeklyOpsChecklistSummary_: issueCount is 0 when RM hierarchy, Manager_Directory, and Movement_Log are all clean');
    TestAssertContains_(cleanSummary.lines.join('\n'), 'No gaps', 'buildWeeklyOpsChecklistSummary_: the clean case reads as "No gaps", not silently blank');
    TestAssertContains_(cleanSummary.lines.join('\n'), 'fresh', 'buildWeeklyOpsChecklistSummary_: a fresh Movement_Log is reported as fresh');
    TestAssertContains_(cleanSummary.lines.join('\n'), 'reportRmPerformanceNow', 'buildWeeklyOpsChecklistSummary_: always ends with the manual-checks reminder, even on a clean run');

    // ---- runWeeklyOpsChecklist_: clean case sends exactly one "all clear"
    // email. Calls the (ss, now)-parameterized core directly, with the
    // SAME fixed `now` the Movement_Log fixture above was seeded relative
    // to — NOT runWeeklyOpsChecklistNow() (which always uses the real
    // wall clock and would make this assertion a time bomb; see
    // runWeeklyOpsChecklist_'s own header comment, OpsChecklistRunner.gs,
    // 2026-09-09).
    runWeeklyOpsChecklist_(cleanSs, now);
    TestAssertEqual_(TestGmailLog_.sent.length, 1, 'runWeeklyOpsChecklist_: sends exactly one email');
    TestAssertEqual_(TestGmailLog_.sent[0].to, TEST_EMAIL_PRIMARY_, 'runWeeklyOpsChecklist_: sends to OPS_ALERT_EMAIL_ (reassigned to the test address)');
    TestAssertContains_(TestGmailLog_.sent[0].subject, 'all clear', 'runWeeklyOpsChecklist_: subject reads "all clear" when issueCount is 0');

    // ---- buildWeeklyOpsChecklistSummary_: every kind of gap flagged at once ----
    TestGmailLog_reset_();
    const dirtySs = TestMockSpreadsheet_({
      'RM_Hierarchy': TestMockSheet_('RM_Hierarchy', TestFixture_rmHierarchyRows_()),
      'Manager_Directory': TestMockSheet_('Manager_Directory', TestFixture_managerDirectoryRows_()), // has one real gap: 'Test A1 NoMail'
      // See the clean-case fixture above for why this reads
      // Movement_Log_Runs, not Movement_Log.
      'Movement_Log_Runs': TestMockSheet_('Movement_Log_Runs', [
        MOVEMENT_LOG_RUNS_COLUMNS_,
        [new Date(now.getTime() - 10 * 3600000), 'stale test', 1, 0], // 10h ago -> stale
      ]),
    });
    const monthShort = 'leads';
    const dirtyLeadsHeader = TestFixture_leadsHeader_();
    const dirtyBannerRow = dirtyLeadsHeader.map(function () { return ''; });
    function dirtyLeadRow(overrides) {
      const defaults = {
        lead_id: 'L-DIRTY', client_id: 'C-DIRTY', RM: 'Ghost RM Nobody Knows', TL: '', project: 'P', region: 'Test Region',
        client: 'Client', lead_assigned_at: now, group_source: 'google', source_bucket: 'Non-UTM',
        current_stage: 'Suspect', closing_reason: '', lead_closing_reason: '',
      };
      const merged = Object.assign({}, defaults, overrides || {});
      return dirtyLeadsHeader.map(function (k) { return merged[k] !== undefined ? merged[k] : ''; });
    }
    dirtySs._sheets[monthShort] = TestMockSheet_(monthShort, [dirtyBannerRow, dirtyLeadsHeader, dirtyLeadRow({})]);

    const dirtySummary = buildWeeklyOpsChecklistSummary_(dirtySs, now);
    TestAssert_(dirtySummary.issueCount > 0, 'buildWeeklyOpsChecklistSummary_: issueCount is nonzero when real gaps exist in every category');
    TestAssertContains_(dirtySummary.lines.join('\n'), 'Ghost RM Nobody Knows', 'buildWeeklyOpsChecklistSummary_: names the unresolved RM');
    TestAssertContains_(dirtySummary.lines.join('\n'), 'Test A1 NoMail', 'buildWeeklyOpsChecklistSummary_: names the manager with no email');
    TestAssertContains_(dirtySummary.lines.join('\n'), 'STALE', 'buildWeeklyOpsChecklistSummary_: flags the stale Movement_Log capture');

    runWeeklyOpsChecklist_(dirtySs, now);
    TestAssertEqual_(TestGmailLog_.sent.length, 1, 'runWeeklyOpsChecklist_: still sends exactly one email on the dirty run');
    TestAssertContains_(TestGmailLog_.sent[0].subject, 'item(s) to review', 'runWeeklyOpsChecklist_: subject names a nonzero item count when issues exist, not "all clear"');

    // ---- Cell-budget check (Core.gs computeWorkbookCellUsageGs_), added
    // 2026-09-28 — healthy / WARN / CRITICAL, each verified against the
    // real percentage thresholds rather than a made-up row count, plus
    // that issueCount only moves for WARN/CRITICAL, never for healthy. ----
    const budgetLeadsHeader = TestFixture_leadsHeader_();
    const budgetBannerRow = budgetLeadsHeader.map(function () { return ''; });
    const budgetSs = TestMockSpreadsheet_({
      'leads': TestMockSheet_('leads', [budgetBannerRow, budgetLeadsHeader]),
      'RM_Hierarchy': TestMockSheet_('RM_Hierarchy', TestFixture_rmHierarchyRows_()),
      'Manager_Directory': TestMockSheet_('Manager_Directory', [
        ['manager_name', 'roles', 'regions', 'email', 'people_reporting_up_to_them', 'email_source'],
        ['Test A1 One', 'TL', 'Test Region', TEST_EMAIL_PRIMARY_, 2, 'manual'],
      ]),
      'Movement_Log_Runs': TestMockSheet_('Movement_Log_Runs', [
        MOVEMENT_LOG_RUNS_COLUMNS_,
        [new Date(now.getTime() - 2 * 3600000), 'clean test', 1, 0],
      ]),
      // The one huge tab — everything else above stays tiny (fixture-sized)
      // so it alone drives total usage, same as Movement_Log dominating a
      // real workbook.
      'Movement_Log': TestMockSheet_('Movement_Log', [['snapshot_at']]),
    });
    budgetSs._sheets['Movement_Log']._maxRows = 100;
    budgetSs._sheets['Movement_Log']._maxCols = 1; // 100 cells: healthy, well under 70% of 10,000,000
    const healthySummary = buildWeeklyOpsChecklistSummary_(budgetSs, now);
    TestAssertContains_(healthySummary.lines.join('\n'), 'Cell budget: healthy', 'buildWeeklyOpsChecklistSummary_: near-empty workbook reads as healthy cell budget');
    TestAssertEqual_(healthySummary.issueCount, 0, 'buildWeeklyOpsChecklistSummary_: a healthy cell budget contributes 0 to issueCount');

    budgetSs._sheets['Movement_Log']._maxRows = 7500000;
    budgetSs._sheets['Movement_Log']._maxCols = 1; // 7,500,000 / 10,000,000 = 75% -> WARN (>= 70%, < 85%)
    const warnSummary = buildWeeklyOpsChecklistSummary_(budgetSs, now);
    TestAssertContains_(warnSummary.lines.join('\n'), 'Cell budget WARNING', 'buildWeeklyOpsChecklistSummary_: 75% usage reads as WARNING, not healthy or CRITICAL');
    TestAssertContains_(warnSummary.lines.join('\n'), 'Movement_Log (7,500,000)', 'buildWeeklyOpsChecklistSummary_: names the largest tab and its exact, comma-formatted cell count');
    TestAssertEqual_(warnSummary.issueCount, 1, 'buildWeeklyOpsChecklistSummary_: a WARNING cell budget contributes exactly 1 to issueCount');

    budgetSs._sheets['Movement_Log']._maxRows = 9000000;
    budgetSs._sheets['Movement_Log']._maxCols = 1; // 90% -> CRITICAL (>= 85%)
    const criticalSummary = buildWeeklyOpsChecklistSummary_(budgetSs, now);
    TestAssertContains_(criticalSummary.lines.join('\n'), 'CELL BUDGET CRITICAL', 'buildWeeklyOpsChecklistSummary_: 90% usage reads as CRITICAL');
    TestAssertContains_(criticalSummary.lines.join('\n'), 'pruneMovementLogNow', 'buildWeeklyOpsChecklistSummary_: CRITICAL names the actual recovery function to run, not just "do something"');
    TestAssertEqual_(criticalSummary.issueCount, 1, 'buildWeeklyOpsChecklistSummary_: a CRITICAL cell budget contributes exactly 1 to issueCount (not double-counted with WARNING)');

    // ---- checkStaleComponents_ / Part 4 (2026-10-03): Feature_Usage
    // missing entirely, but `now` is still within STALE_COMPONENT_DAYS_GS_
    // of FEATURE_USAGE_TRACKING_STARTED_GS_ (2026-10-03) -- this mirrors
    // the EXISTING cleanSs/dirtySs fixtures above, neither of which seeds
    // a Feature_Usage sheet at all, with the suite's own `now` of
    // 2026-09-09 (BEFORE tracking even started) -- confirms the rollout
    // grace period reads as "too early to tell", not as 9 flagged issues,
    // so neither the clean nor dirty case's issueCount assertions above
    // were silently relying on checkStaleComponents_ being unreachable. ----
    const earlyUsage = checkStaleComponents_(cleanSs, now);
    TestAssertEqual_(earlyUsage.status, 'missing', 'checkStaleComponents_: reports "missing" when Feature_Usage does not exist yet');
    TestAssertEqual_(earlyUsage.stale.length, 0, 'checkStaleComponents_: a missing sheet within the rollout grace period flags nothing as stale');
    TestAssertEqual_(earlyUsage.neverObserved.length, TRACKED_COMPONENT_IDS_GS_.length, 'checkStaleComponents_: every tracked component reads as neverObserved (not stale) during the rollout grace period');

    // ---- checkStaleComponents_: Feature_Usage exists with a real mix --
    // one genuinely stale (45 days), one freshly used, and (since `now`
    // here is deliberately set well past FEATURE_USAGE_TRACKING_STARTED_GS_
    // + 30 days) every OTHER tracked component with no row at all is
    // promoted from neverObserved into stale — the "had a full 30-day
    // window and still never showed up" case. ----
    const usageNow = new Date('2026-11-15T09:00:00+05:30'); // well past 2026-10-03 + 30d
    const usageSs = TestMockSpreadsheet_({
      'Feature_Usage': TestMockSheet_('Feature_Usage', [
        FEATURE_USAGE_HEADER_TEST_,
        ['tab-overview', '2026-11-14 10:00:00', 5, '2026-09-20 08:00:00'], // ~1 day ago -> recent
        ['tab-morning', '2026-09-25 08:00:00', 3, '2026-09-20 08:00:00'], // ~51 days ago -> stale
      ]),
    });
    const mixedUsage = checkStaleComponents_(usageSs, usageNow);
    TestAssertEqual_(mixedUsage.status, 'ok', 'checkStaleComponents_: reports "ok" once Feature_Usage has real rows');
    TestAssert_(mixedUsage.recent.some(function (c) { return c.id === 'tab-overview'; }), 'checkStaleComponents_: a recently-used component lands in recent, not stale');
    const staleMorning = mixedUsage.stale.find(function (c) { return c.id === 'tab-morning'; });
    TestAssert_(!!staleMorning && !staleMorning.neverUsed, 'checkStaleComponents_: tab-morning (45+ days since last use) is flagged stale with a real ageDays, not neverUsed');
    TestAssert_(staleMorning.ageDays > 30, 'checkStaleComponents_: tab-morning\'s computed ageDays genuinely exceeds the 30-day threshold');
    const neverUsedPromoted = mixedUsage.stale.filter(function (c) { return c.neverUsed; });
    TestAssertEqual_(neverUsedPromoted.length, TRACKED_COMPONENT_IDS_GS_.length - 2, 'checkStaleComponents_: every other tracked component (no row at all) is promoted into stale once the rollout grace period has passed, not left in neverObserved');
    TestAssertEqual_(mixedUsage.neverObserved.length, 0, 'checkStaleComponents_: neverObserved is empty once the rollout grace period has passed — those components are all in stale instead');

    // ---- checkStaleComponents_: every tracked component used recently --
    // confirms "all clear" reads cleanly with zero stale/neverObserved. ----
    const allRecentRows = [FEATURE_USAGE_HEADER_TEST_].concat(TRACKED_COMPONENT_IDS_GS_.map(function (id) {
      return [id, '2026-11-14 10:00:00', 1, '2026-09-20 08:00:00'];
    }));
    const allRecentSs = TestMockSpreadsheet_({ 'Feature_Usage': TestMockSheet_('Feature_Usage', allRecentRows) });
    const allRecentUsage = checkStaleComponents_(allRecentSs, usageNow);
    TestAssertEqual_(allRecentUsage.stale.length, 0, 'checkStaleComponents_: zero stale when every tracked component was used within 30 days');
    TestAssertEqual_(allRecentUsage.neverObserved.length, 0, 'checkStaleComponents_: zero neverObserved when every tracked component has a row');
    TestAssertEqual_(allRecentUsage.recent.length, TRACKED_COMPONENT_IDS_GS_.length, 'checkStaleComponents_: every tracked component lands in recent');

    // ---- checkStaleComponents_ / Part 6 (2026-10-03) boundary coverage:
    // exactly-30-days is NOT stale (the rule is strictly "> 30", matching
    // STALE_COMPONENT_DAYS_GS_'s own comment); 30 days + 1 minute IS. Built
    // via opsTestLocalDateString_ (see its own header) so this holds
    // regardless of the test runtime's local timezone. ----
    const exactly30 = new Date(usageNow.getTime() - 30 * 86400000);
    const just30Plus1Min = new Date(usageNow.getTime() - (30 * 86400000 + 60000));
    const boundarySs = TestMockSpreadsheet_({
      'Feature_Usage': TestMockSheet_('Feature_Usage', [
        FEATURE_USAGE_HEADER_TEST_,
        ['tab-overview', opsTestLocalDateString_(exactly30), 9, '2026-09-01 00:00:00'],
        ['tab-morning', opsTestLocalDateString_(just30Plus1Min), 9, '2026-09-01 00:00:00'],
      ]),
    });
    const boundaryUsage = checkStaleComponents_(boundarySs, usageNow);
    TestAssert_(boundaryUsage.recent.some(function (c) { return c.id === 'tab-overview'; }),
      'checkStaleComponents_: a component last used EXACTLY 30 days ago is NOT stale (strictly-greater-than rule)');
    TestAssert_(!boundaryUsage.stale.some(function (c) { return c.id === 'tab-overview'; }),
      'checkStaleComponents_: the exactly-30-day component does not also appear in stale');
    TestAssert_(boundaryUsage.stale.some(function (c) { return c.id === 'tab-morning' && !c.neverUsed; }),
      'checkStaleComponents_: a component last used 30 days + 1 minute ago IS stale (just past the boundary)');

    // ---- checkStaleComponents_: "missing tracking data" -- a row EXISTS
    // for a component but last_used_at is blank/malformed (a hand-edited
    // cell, a partial write, or data predating this column). Must be
    // treated exactly like "no row at all" (neverObserved, or promoted to
    // stale past the rollout grace period) -- never throw, never silently
    // misparse into a bogus ageDays. ----
    const malformedSs = TestMockSpreadsheet_({
      'Feature_Usage': TestMockSheet_('Feature_Usage', [
        FEATURE_USAGE_HEADER_TEST_,
        ['tab-overview', '', 0, ''], // blank last_used_at
        ['tab-morning', 'not-a-real-date', 2, '2026-09-01 00:00:00'], // malformed
      ]),
    });
    let malformedThrew = null;
    let malformedUsage = null;
    try { malformedUsage = checkStaleComponents_(malformedSs, usageNow); } catch (e) { malformedThrew = e; }
    TestAssertEqual_(malformedThrew, null, 'checkStaleComponents_: a blank/malformed last_used_at never throws');
    const malformedOverview = malformedUsage.stale.find(function (c) { return c.id === 'tab-overview'; });
    const malformedMorning = malformedUsage.stale.find(function (c) { return c.id === 'tab-morning'; });
    TestAssert_(!!malformedOverview && malformedOverview.neverUsed, 'checkStaleComponents_: a blank last_used_at is treated as never-used (promoted to stale past the grace period), not a parse crash');
    TestAssert_(!!malformedMorning && malformedMorning.neverUsed, 'checkStaleComponents_: a malformed (non-date) last_used_at is also treated as never-used, not misparsed into a fake ageDays');

    // ---- checkStaleComponents_: "repeated alerts" / "restarts" -- this
    // function is a pure read with no module-level mutable state (unlike
    // the browser's _componentUsageRecordedThisSession throttle), so two
    // independent calls against the SAME persistently-stale data -- the
    // real shape of "the same tab is still stale next Monday" or "the
    // script cold-starts between runs" -- must return IDENTICAL results
    // both times, never suppress a repeat, never need any hidden warm-up. ----
    const repeatUsage1 = checkStaleComponents_(usageSs, usageNow);
    const repeatUsage2 = checkStaleComponents_(usageSs, usageNow);
    TestAssertEqual_(JSON.stringify(repeatUsage1), JSON.stringify(repeatUsage2),
      'checkStaleComponents_: two independent calls (simulating a repeat weekly run / a script restart) against the same data return identical results -- no silent dedup or hidden state');

    // ---- buildWeeklyOpsChecklistSummary_ wiring: the stale-component
    // lines actually reach the email summary, and issueCount reflects
    // them (reusing the budgetSs fixture above, which has no leads/
    // RM_Hierarchy/Manager_Directory gaps of its own, so any issueCount
    // here is attributable to the stale-component check alone). ----
    budgetSs._sheets['Movement_Log']._maxRows = 100;
    budgetSs._sheets['Movement_Log']._maxCols = 1;
    // Re-anchored to usageNow (not the suite's shared `now`), since this
    // sub-test calls buildWeeklyOpsChecklistSummary_ with usageNow —
    // otherwise Movement_Log_Runs' existing row (seeded 2h before `now`,
    // 2026-09-09) would also read as stale 2+ months later and the
    // issueCount>0 assertion below would stop proving what it claims to.
    budgetSs._sheets['Movement_Log_Runs'] = TestMockSheet_('Movement_Log_Runs', [
      MOVEMENT_LOG_RUNS_COLUMNS_,
      [new Date(usageNow.getTime() - 2 * 3600000), 'clean test', 1, 0],
    ]);
    budgetSs._sheets['Feature_Usage'] = TestMockSheet_('Feature_Usage', [
      FEATURE_USAGE_HEADER_TEST_,
      ['tab-morning', '2026-09-25 08:00:00', 3, '2026-09-20 08:00:00'],
    ]);
    const staleComponentSummary = buildWeeklyOpsChecklistSummary_(budgetSs, usageNow);
    TestAssertContains_(staleComponentSummary.lines.join('\n'), 'tab-morning', 'buildWeeklyOpsChecklistSummary_: names the stale component by id');
    TestAssertContains_(staleComponentSummary.lines.join('\n'), 'not used in 30+ days', 'buildWeeklyOpsChecklistSummary_: the stale-component section reads clearly');
    TestAssert_(staleComponentSummary.issueCount > 0, 'buildWeeklyOpsChecklistSummary_: stale/never-used components contribute to issueCount');

    // ---- runWeeklyOpsChecklistNow: trigger-target wrapper, smoke test
    // only (real new Date() inside — same reason checkMovementLogFreshnessNow's
    // own test, Tests_MovementTracker.gs, only checks "does not throw"
    // rather than asserting on time-derived content). ----
    TestGmailLog_reset_();
    const realSpreadsheetAppWrapper = SpreadsheetApp;
    SpreadsheetApp = { getActiveSpreadsheet: function () { return dirtySs; }, flush: function () {} };
    let wrapperThrew = null;
    try {
      runWeeklyOpsChecklistNow();
    } catch (e) {
      wrapperThrew = e;
    } finally {
      SpreadsheetApp = realSpreadsheetAppWrapper;
    }
    TestAssertEqual_(wrapperThrew, null, 'runWeeklyOpsChecklistNow: the trigger-target wrapper runs without throwing');
    TestAssertEqual_(TestGmailLog_.sent.length, 1, 'runWeeklyOpsChecklistNow: the wrapper still sends exactly one email');

    // ---- setupWeeklyOpsChecklistTrigger: installs one weekly, nearMinute-pinned trigger; re-run is idempotent ----
    const triggerSs = TestMockSpreadsheet_({});
    const realSpreadsheetAppTrigger = SpreadsheetApp;
    const realScriptApp = ScriptApp;
    SpreadsheetApp = { getActiveSpreadsheet: function () { return triggerSs; }, flush: function () {} };
    ScriptApp = TestMockScriptApp_([]);
    try {
      setupWeeklyOpsChecklistTrigger();
      TestAssertEqual_(ScriptApp._state.created.length, 1, 'setupWeeklyOpsChecklistTrigger: installs exactly one trigger');
      const spec = ScriptApp._state.created[0];
      TestAssertEqual_(spec.fnName, 'runWeeklyOpsChecklistNow', 'setupWeeklyOpsChecklistTrigger: targets the right handler function');
      TestAssertEqual_(spec.weekDay, 'MONDAY', 'setupWeeklyOpsChecklistTrigger: fires on Monday');
      TestAssertEqual_(spec.hour, 9, 'setupWeeklyOpsChecklistTrigger: fires near 9am');
      TestAssertEqual_(spec.minute, 0, 'setupWeeklyOpsChecklistTrigger: pins nearMinute(0) from the start (see AllIssuesEmailer.gs\'s own history on why an unpinned atHour() trigger is worth avoiding)');
      TestAssertEqual_(spec.tz, 'Asia/Kolkata', 'setupWeeklyOpsChecklistTrigger: pinned to IST');

      // Re-running with an existing trigger already installed must delete
      // the old one first, never leave two — same idempotency guarantee
      // every other setupXxx() in this project makes.
      ScriptApp = TestMockScriptApp_(['runWeeklyOpsChecklistNow']);
      setupWeeklyOpsChecklistTrigger();
      TestAssertEqual_(ScriptApp._state.deleted, ['runWeeklyOpsChecklistNow'], 'setupWeeklyOpsChecklistTrigger: deletes its own prior trigger before creating the new one, so a re-run never leaves a duplicate');
    } finally {
      SpreadsheetApp = realSpreadsheetAppTrigger;
      ScriptApp = realScriptApp;
    }

    TestAssertOnlyTestEmails_();
  } finally {
    TestEnv_tearDown_();
  }
  return TestResults_;
}

function runOpsChecklistRunnerTestsNow() { runOpsChecklistRunnerTests_(); }
