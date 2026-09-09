/**
 * Tests: OpsChecklistRunner.gs — the weekly automated summary that wires
 * OPS_CHECKLIST.md's periodic-operational tier into an unattended signal.
 * Run runOpsChecklistRunnerTestsNow() from the function dropdown, or via
 * runAllTests() (Tests_RunAll.gs).
 */
function runOpsChecklistRunnerTests_() {
  const now = new Date('2026-09-09T09:00:00+05:30');

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
    'Movement_Log': TestMockSheet_('Movement_Log', [
      ['snapshot_at', 'snapshot_label'].concat(SNAPSHOT_COLUMNS_),
      [new Date(now.getTime() - 2 * 3600000), 'clean test'].concat(SNAPSHOT_COLUMNS_.map(function () { return ''; })),
    ]),
  });
  TestEnv_setUp_('Tests_OpsChecklistRunner', cleanSs);
  try {
    const cleanSummary = buildWeeklyOpsChecklistSummary_(cleanSs, now);
    TestAssertEqual_(cleanSummary.issueCount, 0, 'buildWeeklyOpsChecklistSummary_: issueCount is 0 when RM hierarchy, Manager_Directory, and Movement_Log are all clean');
    TestAssertContains_(cleanSummary.lines.join('\n'), 'No gaps', 'buildWeeklyOpsChecklistSummary_: the clean case reads as "No gaps", not silently blank');
    TestAssertContains_(cleanSummary.lines.join('\n'), 'fresh', 'buildWeeklyOpsChecklistSummary_: a fresh Movement_Log is reported as fresh');
    TestAssertContains_(cleanSummary.lines.join('\n'), 'reportRmPerformanceNow', 'buildWeeklyOpsChecklistSummary_: always ends with the manual-checks reminder, even on a clean run');

    // ---- runWeeklyOpsChecklistNow: clean case sends exactly one "all clear" email ----
    const realSpreadsheetAppClean = SpreadsheetApp;
    SpreadsheetApp = { getActiveSpreadsheet: function () { return cleanSs; }, flush: function () {} };
    try {
      runWeeklyOpsChecklistNow();
    } finally {
      SpreadsheetApp = realSpreadsheetAppClean;
    }
    TestAssertEqual_(TestGmailLog_.sent.length, 1, 'runWeeklyOpsChecklistNow: sends exactly one email');
    TestAssertEqual_(TestGmailLog_.sent[0].to, TEST_EMAIL_PRIMARY_, 'runWeeklyOpsChecklistNow: sends to OPS_ALERT_EMAIL_ (reassigned to the test address)');
    TestAssertContains_(TestGmailLog_.sent[0].subject, 'all clear', 'runWeeklyOpsChecklistNow: subject reads "all clear" when issueCount is 0');

    // ---- buildWeeklyOpsChecklistSummary_: every kind of gap flagged at once ----
    TestGmailLog_reset_();
    const dirtySs = TestMockSpreadsheet_({
      'RM_Hierarchy': TestMockSheet_('RM_Hierarchy', TestFixture_rmHierarchyRows_()),
      'Manager_Directory': TestMockSheet_('Manager_Directory', TestFixture_managerDirectoryRows_()), // has one real gap: 'Test A1 NoMail'
      'Movement_Log': TestMockSheet_('Movement_Log', [
        ['snapshot_at', 'snapshot_label'].concat(SNAPSHOT_COLUMNS_),
        [new Date(now.getTime() - 10 * 3600000), 'stale test'].concat(SNAPSHOT_COLUMNS_.map(function () { return ''; })), // 10h ago -> stale
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

    const realSpreadsheetAppDirty = SpreadsheetApp;
    SpreadsheetApp = { getActiveSpreadsheet: function () { return dirtySs; }, flush: function () {} };
    try {
      runWeeklyOpsChecklistNow();
    } finally {
      SpreadsheetApp = realSpreadsheetAppDirty;
    }
    TestAssertEqual_(TestGmailLog_.sent.length, 1, 'runWeeklyOpsChecklistNow: still sends exactly one email on the dirty run');
    TestAssertContains_(TestGmailLog_.sent[0].subject, 'item(s) to review', 'runWeeklyOpsChecklistNow: subject names a nonzero item count when issues exist, not "all clear"');

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
