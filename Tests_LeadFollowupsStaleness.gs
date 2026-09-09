/**
 * Tests: LeadFollowupsStaleness.gs — the conditional-formatting setup
 * that makes Lead_Followups' own updated_at column (G) impossible to
 * miss when a row has gone stale. Run runLeadFollowupsStalenessTestsNow()
 * from the function dropdown, or via runAllTests() (Tests_RunAll.gs).
 */
function runLeadFollowupsStalenessTests_() {
  TestEnv_setUp_('Tests_LeadFollowupsStaleness', null);
  try {
    // ---- buildLeadFollowupsStalenessRuleSpecs_: pure, no SpreadsheetApp needed ----
    const specs = buildLeadFollowupsStalenessRuleSpecs_();
    TestAssertEqual_(specs.length, 2, 'buildLeadFollowupsStalenessRuleSpecs_: exactly 2 tiers (amber, red)');

    const red = specs.find(function (s) { return s.tier === 'red'; });
    const amber = specs.find(function (s) { return s.tier === 'amber'; });
    TestAssert_(!!red && !!amber, 'buildLeadFollowupsStalenessRuleSpecs_: both a red and an amber tier are present');

    TestAssertEqual_(red.formula, '=AND($G2<>"",(NOW()-$G2)*24>24)', 'buildLeadFollowupsStalenessRuleSpecs_: red formula uses the 24h threshold, absolute $G, relative row 2');
    TestAssertEqual_(amber.formula, '=AND($G2<>"",(NOW()-$G2)*24>12)', 'buildLeadFollowupsStalenessRuleSpecs_: amber formula uses the 12h threshold');
    TestAssert_(red.background !== amber.background, 'buildLeadFollowupsStalenessRuleSpecs_: red and amber use visually distinct background colors');
    TestAssert_(!!red.background && !!red.fontColor && !!amber.background && !!amber.fontColor, 'buildLeadFollowupsStalenessRuleSpecs_: every tier has both a background and a font color set');

    // A blank G2 must never satisfy either formula (a lead not yet pushed
    // at all is not "stale", it's just absent) -- the $G2<>"" guard is
    // the reason, verified structurally here since the mock never
    // evaluates the formula string against real data.
    TestAssertContains_(red.formula, '$G2<>""', 'buildLeadFollowupsStalenessRuleSpecs_: red formula guards against a blank updated_at cell');
    TestAssertContains_(amber.formula, '$G2<>""', 'buildLeadFollowupsStalenessRuleSpecs_: amber formula guards against a blank updated_at cell');

    // ---- setupLeadFollowupsStalenessFormatting: sheet not found ----
    const noTabSs = TestMockSpreadsheet_({});
    const realSpreadsheetAppMissing = SpreadsheetApp;
    SpreadsheetApp = Object.assign({}, realSpreadsheetAppMissing, { getActiveSpreadsheet: function () { return noTabSs; } });
    let missingThrew = null;
    try { setupLeadFollowupsStalenessFormatting(); } catch (e) { missingThrew = e; }
    SpreadsheetApp = realSpreadsheetAppMissing;
    TestAssertEqual_(missingThrew, null, 'setupLeadFollowupsStalenessFormatting: does not throw when Lead_Followups does not exist yet, just logs and returns');

    // ---- setupLeadFollowupsStalenessFormatting: real application ----
    const lfSheet = TestMockSheet_('Lead_Followups', [
      ['lead_id', 'region', 'RM', 'issue', 'collated_comments', 'suggested_followup', 'updated_at', 'own_comments'],
    ]);
    // Pre-seed one unrelated rule, to prove setup REPLACES the whole set
    // rather than appending to it (see the function's own header comment
    // on why a wholesale replace is the deliberate choice here).
    lfSheet.setConditionalFormatRules(['some pre-existing rule the mock never produced itself']);
    const setupSs = TestMockSpreadsheet_({ 'Lead_Followups': lfSheet });
    const realSpreadsheetApp = SpreadsheetApp;
    SpreadsheetApp = Object.assign({}, realSpreadsheetApp, { getActiveSpreadsheet: function () { return setupSs; } });
    let setupThrew = null;
    try {
      setupLeadFollowupsStalenessFormatting();
    } catch (e) { setupThrew = e; }
    SpreadsheetApp = realSpreadsheetApp;
    TestAssertEqual_(setupThrew, null, 'setupLeadFollowupsStalenessFormatting: runs without throwing against a real Lead_Followups sheet');

    const installed = lfSheet.getConditionalFormatRules();
    TestAssertEqual_(installed.length, 2, 'setupLeadFollowupsStalenessFormatting: installs exactly 2 rules, replacing the pre-seeded one entirely');
    const installedFormulas = installed.map(function (r) { return r.formula; }).sort();
    const expectedFormulas = specs.map(function (s) { return s.formula; }).sort();
    TestAssertEqual_(installedFormulas, expectedFormulas, 'setupLeadFollowupsStalenessFormatting: the installed rules\' formulas exactly match buildLeadFollowupsStalenessRuleSpecs_\' output');
    installed.forEach(function (r) {
      TestAssertEqual_(r.ranges.length, 1, 'setupLeadFollowupsStalenessFormatting: each rule applies to exactly one range');
    });

    // Re-running must stay idempotent -- same 2 rules, not 4.
    SpreadsheetApp = Object.assign({}, realSpreadsheetApp, { getActiveSpreadsheet: function () { return setupSs; } });
    setupLeadFollowupsStalenessFormatting();
    SpreadsheetApp = realSpreadsheetApp;
    TestAssertEqual_(lfSheet.getConditionalFormatRules().length, 2, 'setupLeadFollowupsStalenessFormatting: re-running stays idempotent, still exactly 2 rules');
  } finally {
    TestEnv_tearDown_();
  }
  return TestResults_;
}

function runLeadFollowupsStalenessTestsNow() { runLeadFollowupsStalenessTests_(); }
