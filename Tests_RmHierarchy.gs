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

    // Prathamesh A Pande left the company 2026-08-31 -- his own row is
    // gone, and his 4 former reports now fall through directly to their
    // own senior (TM Rahul Poudel), not left dangling on a departed A1.
    TestAssert_(!realResolved.some(function (p) { return p.name === 'Prathamesh A Pande'; }), 'resolveRmHierarchy_: real production data no longer has a "Prathamesh A Pande" row (departed 2026-08-31)');
    const akshayMore = realResolved.find(function (p) { return p.name === 'Akshay More'; });
    TestAssert_(!!akshayMore, 'resolveRmHierarchy_: Akshay More (a former Prathamesh A Pande report) still has a row');
    TestAssertEqual_(akshayMore && akshayMore.tl, '', 'resolveRmHierarchy_: Akshay More\'s tl no longer names the departed Prathamesh A Pande');
    TestAssertEqual_(akshayMore && akshayMore.tm, 'Rahul Poudel', 'resolveRmHierarchy_: Akshay More\'s primary correctly falls through to his own senior, TM Rahul Poudel');

    // "Kavya Gowda" -- confirmed by the user directly as the same person
    // as the existing "Kavya B R" row; must resolve to that EXACT chain.
    const kavyaBR = realResolved.find(function (p) { return p.name === 'Kavya B R'; });
    const kavyaGowda = realResolved.find(function (p) { return p.name === 'Kavya Gowda'; });
    TestAssert_(!!kavyaBR && !!kavyaGowda, 'resolveRmHierarchy_: both "Kavya B R" and its alias "Kavya Gowda" have rows');
    TestAssertEqual_(JSON.stringify({ tl: kavyaGowda.tl, tm: kavyaGowda.tm, rh: kavyaGowda.rh, ch: kavyaGowda.ch }), JSON.stringify({ tl: kavyaBR.tl, tm: kavyaBR.tm, rh: kavyaBR.rh, ch: kavyaBR.ch }), 'resolveRmHierarchy_: "Kavya Gowda" resolves to the exact same chain as "Kavya B R"');

    // "Shamakuri Goud" -- confirmed by the user directly as the same
    // person as the existing "Nikhil Goud" row; must resolve identically.
    const nikhilGoud = realResolved.find(function (p) { return p.name === 'Nikhil Goud'; });
    const shamakuriGoud = realResolved.find(function (p) { return p.name === 'Shamakuri Goud'; });
    TestAssert_(!!nikhilGoud && !!shamakuriGoud, 'resolveRmHierarchy_: both "Nikhil Goud" and its alias "Shamakuri Goud" have rows');
    TestAssertEqual_(JSON.stringify({ tl: shamakuriGoud.tl, tm: shamakuriGoud.tm, rh: shamakuriGoud.rh, ch: shamakuriGoud.ch }), JSON.stringify({ tl: nikhilGoud.tl, tm: nikhilGoud.tm, rh: nikhilGoud.rh, ch: nikhilGoud.ch }), 'resolveRmHierarchy_: "Shamakuri Goud" resolves to the exact same chain as "Nikhil Goud"');

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

    // ---- auditUnresolvedRms_: proactive coverage audit (2026-08-31) ----
    const auditNow = new Date();
    const auditLeadsHeader = TestFixture_leadsHeader_();
    const auditBannerRow = auditLeadsHeader.map(function () { return ''; });
    function auditLeadRow(overrides) {
      const defaults = {
        lead_id: 'L-X', client_id: 'C-X', RM: 'Test RM One', TL: '', project: 'P', region: 'Test Region',
        client: 'Client', lead_assigned_at: auditNow, group_source: 'google', source_bucket: 'Non-UTM',
        current_stage: 'Suspect', closing_reason: '', lead_closing_reason: '',
      };
      const merged = Object.assign({}, defaults, overrides || {});
      return auditLeadsHeader.map(function (k) { return merged[k] !== undefined ? merged[k] : ''; });
    }
    const auditMonthShort = Utilities.formatDate(auditNow, 'Asia/Kolkata', 'MMM');
    const auditRows = [
      auditBannerRow, auditLeadsHeader,
      // Resolves fine via a real A1 -- must NOT appear in the audit.
      auditLeadRow({ lead_id: 'L-OK', client_id: 'C-OK', RM: 'Test RM One' }),
      // Excluded -- resolves to a row, but routes nowhere just the same,
      // so it MUST still count as a gap for this audit's purposes (unlike
      // a plain "resolves fine" lookup).
      auditLeadRow({ lead_id: 'L-EXCL-1', client_id: 'C-EXCL-1', RM: 'Test RM Excl' }),
      auditLeadRow({ lead_id: 'L-EXCL-2', client_id: 'C-EXCL-2', RM: 'Test RM Excl' }),
      // No RM_Hierarchy row at all, and not recognized leadership -- a
      // genuine gap.
      auditLeadRow({ lead_id: 'L-GHOST', client_id: 'C-GHOST', RM: 'Ghost RM Nobody Knows' }),
      // Recognized senior leadership with no RM_Hierarchy row -- resolves
      // fine via the self-CH fallback (LEADERSHIP_NAME_TO_EMAIL_), must
      // NOT be reported as a gap.
      auditLeadRow({ lead_id: 'L-LEADERSHIP', client_id: 'C-LEADERSHIP', RM: 'Test Ceo Self' }),
      // Closed -- excluded entirely regardless of whether the RM would
      // resolve, same as every other issue-scanning script in this project.
      auditLeadRow({ lead_id: 'L-CLOSED', client_id: 'C-CLOSED', RM: 'Ghost RM Nobody Knows', current_stage: 'Won' }),
      // Blank RM -- skipped, not counted as a gap.
      auditLeadRow({ lead_id: 'L-BLANK', client_id: 'C-BLANK', RM: '' }),
      // Out of scope entirely (not google/Non-UTM/Search) -- would NEVER
      // actually need routing in production (both real email scripts
      // gate on this before ever resolving an RM), so an unresolvable RM
      // name here must NOT be reported as a gap. Real production case:
      // before this gate existed, several Magnet-team names (non-Google
      // leads) showed up with dozens of "unresolved" leads each, drowning
      // out the small number of genuine gaps in the same report.
      auditLeadRow({ lead_id: 'L-OUTOFSCOPE', client_id: 'C-OUTOFSCOPE', RM: 'Ghost RM Nobody Knows', group_source: 'Facebook' }),
    ];
    ss._sheets[auditMonthShort] = TestMockSheet_(auditMonthShort, auditRows);

    const auditResults = auditUnresolvedRms_(ss);
    const auditByName = {};
    auditResults.forEach(function (r) { auditByName[r.name] = r; });

    TestAssert_(!auditByName['Test RM One'], 'auditUnresolvedRms_: an RM that resolves fine is never reported');
    TestAssert_(!auditByName['Test Ceo Self'], 'auditUnresolvedRms_: recognized leadership (self-CH fallback) is never reported, even with no RM_Hierarchy row at all');
    TestAssert_(!!auditByName['Test RM Excl'], 'auditUnresolvedRms_: an Excluded RM IS reported (a found-but-excluded row routes nowhere, same practical effect as missing)');
    TestAssertEqual_(auditByName['Test RM Excl'].count, 2, 'auditUnresolvedRms_: counts every open lead for that RM, not just one');
    TestAssertEqual_(auditByName['Test RM Excl'].leadIds.sort(), ['L-EXCL-1', 'L-EXCL-2'], 'auditUnresolvedRms_: lists the actual affected lead_ids');
    TestAssert_(!!auditByName['Ghost RM Nobody Knows'], 'auditUnresolvedRms_: a name with no RM_Hierarchy row at all and no leadership match IS reported');
    TestAssertEqual_(auditByName['Ghost RM Nobody Knows'].count, 1, 'auditUnresolvedRms_: the closed lead AND the out-of-scope (non-google) lead for this same RM name are correctly excluded from the count (only L-GHOST, not L-CLOSED or L-OUTOFSCOPE)');
    TestAssertEqual_(typeof auditByName['Ghost RM Nobody Knows'].inCompanyRoster, 'boolean', 'auditUnresolvedRms_: inCompanyRoster is always a real boolean, never undefined');
    TestAssertEqual_(Object.keys(auditByName).length, 2, 'auditUnresolvedRms_: reports exactly the 2 genuine gaps, nothing more and nothing less');

    // Console wrapper — Logger-only output, no return value to assert on;
    // just confirm it runs against the same fixture without throwing.
    let auditNowThrew = null;
    try { auditUnresolvedRmsNow(); } catch (e) { auditNowThrew = e; }
    TestAssertEqual_(auditNowThrew, null, 'auditUnresolvedRmsNow: the console wrapper runs without throwing');
  } finally {
    TestEnv_tearDown_();
  }
  return TestResults_;
}

function runRmHierarchyTestsNow() { runRmHierarchyTests_(); }
