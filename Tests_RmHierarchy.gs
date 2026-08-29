/**
 * Tests: RmHierarchy.gs — manager-chain resolution and bucketing. Run
 * runRmHierarchyTestsNow() from the function dropdown, or via
 * runAllTests() (Tests_RunAll.gs).
 */
function runRmHierarchyTests_() {
  const ss = TestMockSpreadsheet_({
    'RM_Hierarchy': TestMockSheet_('RM_Hierarchy', TestFixture_rmHierarchyRows_()),
    'Manager_Directory': TestMockSheet_('Manager_Directory', TestFixture_managerDirectoryRows_()),
  });
  TestEnv_setUp_('Tests_RmHierarchy', ss);
  try {
    // ---- stripRoleSuffix_ / normPersonName_ ----
    TestAssertEqual_(stripRoleSuffix_('Rahan Khan S 1'), 'Rahan Khan', 'stripRoleSuffix_: strips a trailing "S <digit>" position suffix');
    TestAssertEqual_(stripRoleSuffix_('Prajwal Shetty S 1 Account'), 'Prajwal Shetty', 'stripRoleSuffix_: strips the suffix even with extra trailing text');
    TestAssertEqual_(stripRoleSuffix_('Test RM One'), 'Test RM One', 'stripRoleSuffix_: a plain name with no suffix passes through unchanged');
    TestAssertEqual_(normPersonName_('  Test   RM  One.  '), 'test rm one', 'normPersonName_: trims, lowercases, collapses whitespace, drops a trailing period');

    // ---- isTopOfOrgRole_ ----
    TestAssert_(isTopOfOrgRole_('Cluster Head') === true, 'isTopOfOrgRole_: recognizes Cluster Head');
    TestAssert_(isTopOfOrgRole_('City Lead') === true, 'isTopOfOrgRole_: recognizes City Lead');
    TestAssert_(isTopOfOrgRole_('Commercial Head') === true, 'isTopOfOrgRole_: recognizes Commercial Head');
    TestAssert_(isTopOfOrgRole_('TM') === false, 'isTopOfOrgRole_: TM is not top-of-org');
    TestAssert_(isTopOfOrgRole_('') === false, 'isTopOfOrgRole_: blank role is not top-of-org');

    // ---- lookupRmChain_: exact + role-suffix-stripped fallback ----
    const hierarchyData = loadRmHierarchyAndEmails_(ss);
    let chain = lookupRmChain_(hierarchyData.byRmNameLower, 'Test RM One');
    TestAssert_(!!chain && chain.tl === 'Test A1 One', 'lookupRmChain_: exact name match resolves the right row');
    chain = lookupRmChain_(hierarchyData.byRmNameLower, 'Test RM One S 1 Account');
    TestAssert_(!!chain && chain.tl === 'Test A1 One', 'lookupRmChain_: falls back to a role-suffix-stripped match when the exact name fails');
    chain = lookupRmChain_(hierarchyData.byRmNameLower, 'Nobody At All');
    TestAssertEqual_(chain, undefined, 'lookupRmChain_: returns undefined for a name with no match at all, even after stripping');

    // ---- resolveRecipientBucketsForRms_: every branch ----
    let resolved = resolveRecipientBucketsForRms_(ss, ['Test RM One', 'Test RM Two']);
    TestAssertEqual_(resolved.buckets.length, 1, 'resolveRecipientBucketsForRms_: two RMs under the same A1 collapse into one bucket');
    TestAssertEqual_(resolved.buckets[0].rmNames.length, 2, 'resolveRecipientBucketsForRms_: that one bucket lists both RM names');
    TestAssertEqual_(resolved.buckets[0].primaryEmail, TEST_EMAIL_PRIMARY_, 'resolveRecipientBucketsForRms_: bucket primary email is the A1\'s email');

    resolved = resolveRecipientBucketsForRms_(ss, ['Test RM Three']);
    TestAssertEqual_(resolved.buckets.length, 1, 'resolveRecipientBucketsForRms_: an RM with no A1 (only a TM) still resolves to one bucket');
    TestAssertEqual_(resolved.buckets[0].primaryName, 'Test TM One', 'resolveRecipientBucketsForRms_: TM becomes primary when there is no A1 above this RM');
    TestAssertEqual_(resolved.buckets[0].primaryRole, 'TM', 'resolveRecipientBucketsForRms_: primaryRole correctly reports TM, not A1');

    resolved = resolveRecipientBucketsForRms_(ss, ['Test RM Excl']);
    TestAssertEqual_(resolved.buckets.length, 0, 'resolveRecipientBucketsForRms_: an Excluded RM produces no bucket');
    TestAssertEqual_(resolved.unresolved.length, 1, 'resolveRecipientBucketsForRms_: an Excluded RM is reported unresolved');
    TestAssertContains_(resolved.unresolved[0].reason, 'Excluded', 'resolveRecipientBucketsForRms_: unresolved reason names the exclusion');

    resolved = resolveRecipientBucketsForRms_(ss, ['Test RM Orphan']);
    TestAssertEqual_(resolved.buckets.length, 0, 'resolveRecipientBucketsForRms_: an RM with no TL/TM/RH/CH at all produces no bucket');
    TestAssertContains_(resolved.unresolved[0].reason, 'no TL/TM/RH/CH', 'resolveRecipientBucketsForRms_: unresolved reason correctly names the gap');

    resolved = resolveRecipientBucketsForRms_(ss, ['Test RM NoMail']);
    TestAssertEqual_(resolved.buckets.length, 0, 'resolveRecipientBucketsForRms_: a resolvable chain whose manager has no email produces no bucket');
    TestAssertContains_(resolved.unresolved[0].reason, 'no email', 'resolveRecipientBucketsForRms_: unresolved reason correctly names the missing email');

    resolved = resolveRecipientBucketsForRms_(ss, ['Unknown Name Entirely']);
    TestAssertContains_(resolved.unresolved[0].reason, 'Not found', 'resolveRecipientBucketsForRms_: a name with no RM_Hierarchy row at all is reported not-found');

    // CH personally holding a lead (their own chain is fully blank, and
    // their own role IS a top-of-org label) -> chLevelRms, never a normal bucket.
    resolved = resolveRecipientBucketsForRms_(ss, ['Test CH Self']);
    TestAssertEqual_(resolved.buckets.length, 0, 'resolveRecipientBucketsForRms_: a self-holding CH produces no normal bucket');
    TestAssertEqual_(resolved.chLevelRms.length, 1, 'resolveRecipientBucketsForRms_: a self-holding CH is reported via chLevelRms instead');
    TestAssertEqual_(resolved.chLevelRms[0].chEmail, TEST_EMAIL_CH_, 'resolveRecipientBucketsForRms_: self-holding CH resolves to their own email');
    TestAssertEqual_(resolved.chLevelRms[0].chRole, 'Cluster Head', 'resolveRecipientBucketsForRms_: chRole reports the REAL recorded role, not a generic label');

    // Recognized senior leadership with NO RM_Hierarchy row at all,
    // personally holding a lead -> chLevelRms via LEADERSHIP_NAME_TO_EMAIL_
    // (overridden to a synthetic "Test Ceo Self" entry for this test —
    // see TestEnv_setUp_'s own comment).
    resolved = resolveRecipientBucketsForRms_(ss, ['Test Ceo Self']);
    TestAssertEqual_(resolved.chLevelRms.length, 1, 'resolveRecipientBucketsForRms_: recognized leadership with no hierarchy row at all is still reported via chLevelRms');
    TestAssertEqual_(resolved.chLevelRms[0].chEmail, TEST_EMAIL_CH_, 'resolveRecipientBucketsForRms_: leadership self-holding resolves via LEADERSHIP_NAME_TO_EMAIL_');
    TestAssertEqual_(resolved.chLevelRms[0].chRole, 'Leadership', 'resolveRecipientBucketsForRms_: leadership self-holding gets the "Leadership" fallback label (no real role on file)');

    // A region with a genuine mix of every case at once — proves they
    // don't interfere with each other in one call.
    resolved = resolveRecipientBucketsForRms_(ss, ['Test RM One', 'Test RM Three', 'Test RM Orphan', 'Test CH Self']);
    TestAssertEqual_(resolved.buckets.length, 2, 'resolveRecipientBucketsForRms_: a mixed RM list produces the right number of normal buckets (A1 + TM)');
    TestAssertEqual_(resolved.unresolved.length, 1, 'resolveRecipientBucketsForRms_: ...plus the right number of unresolved entries');
    TestAssertEqual_(resolved.chLevelRms.length, 1, 'resolveRecipientBucketsForRms_: ...plus the right number of chLevelRms entries, all in one pass');

    // ---- resolveRecipientBucketsForRms_(ss, rmNames, hierarchyData) —
    // perf pass (2026-08-28): passing an already-loaded hierarchyData
    // must produce output IDENTICAL to the normal path (which loads it
    // internally via loadRmHierarchyAndEmails_), for every branch at
    // once — this is the real equivalence the "load once per run,
    // thread it through" optimization depends on. ----
    const mixedRmNames = ['Test RM One', 'Test RM Three', 'Test RM Orphan', 'Test CH Self', 'Test Ceo Self'];
    const withoutPreload = resolveRecipientBucketsForRms_(ss, mixedRmNames);
    const withPreload = resolveRecipientBucketsForRms_(ss, mixedRmNames, hierarchyData);
    TestAssertEqual_(JSON.stringify(withPreload), JSON.stringify(withoutPreload), 'resolveRecipientBucketsForRms_: passing a pre-loaded hierarchyData produces output byte-identical to the normal (internally-loading) path, across every branch (normal buckets, unresolved, chLevelRms self-holding, and leadership self-holding) at once');

    // ---- ensureRmHierarchySheet_ / ensureManagerDirectorySheet_: fresh creation ----
    const freshSs = TestMockSpreadsheet_({});
    const freshSheet = ensureRmHierarchySheet_(freshSs);
    TestAssert_(freshSheet.getLastRow() > 1, 'ensureRmHierarchySheet_: a fresh spreadsheet gets RM_Hierarchy populated from the real RM_HIERARCHY_RAW_ table');
    const freshDir = ensureManagerDirectorySheet_(freshSs);
    TestAssert_(freshDir.getLastRow() > 1, 'ensureManagerDirectorySheet_: a fresh spreadsheet gets Manager_Directory populated too');

    // Spot-check the REAL production RM_HIERARCHY_RAW_ table (not the
    // synthetic fixture) for one well-known, stable entry — catches a
    // genuine accidental edit to real hierarchy data, not just logic bugs.
    const realResolved = resolveRmHierarchy_();
    const sourabh = realResolved.find(function (p) { return p.name === 'Sourabh Sareen'; });
    TestAssert_(!!sourabh, 'resolveRmHierarchy_: real production data still has a "Sourabh Sareen" row');
    TestAssertEqual_(sourabh && sourabh.role, 'City Lead', 'resolveRmHierarchy_: Sourabh Sareen\'s real recorded role is still "City Lead"');

    // ---- rebuildRmHierarchy: preserves manual edits across a rebuild ----
    // rebuildRmHierarchy() (unlike everything above) takes no `ss`
    // parameter — it always operates on SpreadsheetApp.getActiveSpreadsheet()
    // directly, and it always rebuilds from the REAL resolveRmHierarchy_()
    // table (not whatever fixture rows a sheet currently holds), so this
    // one sub-test needs its own temporary active-spreadsheet swap and a
    // REAL person's name (synthetic "Test RM One" style names don't exist
    // in the real table, so a preservation-by-name-match test needs one
    // that does).
    const rebuildSs = TestMockSpreadsheet_({});
    const realSpreadsheetApp = SpreadsheetApp;
    SpreadsheetApp = { getActiveSpreadsheet: function () { return rebuildSs; }, flush: function () {} };
    try {
      const originalSheet = ensureRmHierarchySheet_(rebuildSs);
      const originalRowCount = originalSheet.getLastRow();
      const nameCol = originalSheet.getRange(2, 3, originalRowCount - 1, 1).getValues();
      const targetRowIdx = nameCol.findIndex(function (r) { return r[0] === 'Sourabh Sareen'; });
      TestAssert_(targetRowIdx !== -1, 'sanity: Sourabh Sareen exists in the freshly-created real sheet, ready to hand-edit');
      const targetRowNum = 2 + targetRowIdx;
      originalSheet.getRange(targetRowNum, 8, 1, 3).setValues([[true, 'Manually excluded for testing', TEST_EMAIL_PRIMARY_]]);
      ensureManagerDirectorySheet_(rebuildSs); // must exist before rebuildRmHierarchy runs, same as real setup order

      rebuildRmHierarchy();

      const rebuiltSheet = rebuildSs.getSheetByName('RM_Hierarchy');
      const rebuiltRowCount = rebuiltSheet.getLastRow();
      TestAssertEqual_(rebuiltRowCount, originalRowCount, 'rebuildRmHierarchy: row count is unchanged when the source table itself hasn\'t changed');
      const rebuiltRows = rebuiltSheet.getRange(2, 1, rebuiltRowCount - 1, 10).getValues();
      const rebuiltTarget = rebuiltRows.find(function (r) { return r[2] === 'Sourabh Sareen'; });
      TestAssert_(!!rebuiltTarget, 'rebuildRmHierarchy: Sourabh Sareen still present after a rebuild');
      TestAssertEqual_(rebuiltTarget[7], true, 'rebuildRmHierarchy: the manually-set Excluded checkbox survives the rebuild');
      TestAssertEqual_(rebuiltTarget[8], 'Manually excluded for testing', 'rebuildRmHierarchy: the manually-set Note text survives the rebuild');
      TestAssertEqual_(rebuiltTarget[9], TEST_EMAIL_PRIMARY_, 'rebuildRmHierarchy: the manually-set email survives the rebuild (not overwritten by the Book7 auto-lookup)');
    } finally {
      SpreadsheetApp = realSpreadsheetApp;
    }
  } finally {
    TestEnv_tearDown_();
  }
  return TestResults_;
}

function runRmHierarchyTestsNow() { runRmHierarchyTests_(); }
