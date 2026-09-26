/**
 * Tests: EmailInfra.gs — retry wrappers, region mapping, the shared
 * per-region recipient resolver, and ops alerting. Run
 * runEmailInfraTestsNow() from the function dropdown, or via
 * runAllTests() (Tests_RunAll.gs).
 */
function runEmailInfraTests_() {
  const ss = TestMockSpreadsheet_({
    'RM_Hierarchy': TestMockSheet_('RM_Hierarchy', TestFixture_rmHierarchyRows_()),
    'Manager_Directory': TestMockSheet_('Manager_Directory', TestFixture_managerDirectoryRows_()),
  });
  TestEnv_setUp_('Tests_EmailInfra', ss);
  try {
    // ---- withRetry_ ----
    let calls = 0;
    const okResult = withRetry_(function () {
      calls++;
      if (calls < 3) throw new Error('Service Spreadsheets timed out while accessing document');
      return 'ok';
    }, 'test transient');
    TestAssertEqual_(okResult, 'ok', 'withRetry_: eventually returns the real result once a transient error stops recurring');
    TestAssertEqual_(calls, 3, 'withRetry_: retried exactly twice before the 3rd (successful) attempt');

    calls = 0;
    TestAssertThrows_(function () {
      withRetry_(function () { calls++; throw new Error('Range not found'); }, 'test non-transient');
    }, 'withRetry_: a non-transient error propagates');
    TestAssertEqual_(calls, 1, 'withRetry_: a non-transient error is NOT retried — only 1 attempt made');

    // ---- withSendRetry_ ----
    calls = 0;
    const sendResult = withSendRetry_(function () {
      calls++;
      if (calls < 2) throw new Error('Gmail operation not allowed for this user');
      return 'sent';
    }, 'test send retry');
    TestAssertEqual_(sendResult, 'sent', 'withSendRetry_: retries a definitive "operation not allowed" rejection and eventually succeeds');
    TestAssertEqual_(calls, 2, 'withSendRetry_: retried exactly once before succeeding');

    // "...Not found" (added 2026-08-31, real production case: createDraft()
    // succeeds — confirmed by finding and manually sending the leftover
    // draft — but the immediately-chained send() fails to look it up yet).
    calls = 0;
    const sendResult2 = withSendRetry_(function () {
      calls++;
      if (calls < 2) throw new Error('Exception: Not found');
      return 'sent';
    }, 'test send retry (not found)');
    TestAssertEqual_(sendResult2, 'sent', 'withSendRetry_: retries a "...Not found" createDraft()/send() lookup race and eventually succeeds');
    TestAssertEqual_(calls, 2, 'withSendRetry_: retried exactly once before succeeding');

    calls = 0;
    TestAssertThrows_(function () {
      withSendRetry_(function () { calls++; throw new Error('Some other ambiguous failure'); }, 'test send non-retry');
    }, 'withSendRetry_: a non-"operation not allowed" error propagates');
    TestAssertEqual_(calls, 1, 'withSendRetry_: an ambiguous (non-definitive) failure is NOT retried, to avoid a possible duplicate send');

    // withSendRetry_'s two safe-to-retry errors wait different amounts
    // (added 2026-09-02) — "Not found" is a millisecond-scale timing race,
    // not a load condition, so it retries after a flat 400ms; "operation
    // not allowed" is a soft rate-limit reaction that keeps the longer
    // attempt*2000ms backoff. Utilities.sleep is a no-op in this suite
    // (Tests_Mocks.gs), so without spying on the actual ms argument, a
    // regression that silently swapped or merged these two waits would
    // pass every other test here (they only check retry count/outcome,
    // never the wait itself) and slip through unnoticed.
    const realSleep = Utilities.sleep;
    const sleepCalls = [];
    Utilities.sleep = function (ms) { sleepCalls.push(ms); };
    try {
      calls = 0;
      withSendRetry_(function () {
        calls++;
        if (calls < 2) throw new Error('Exception: Not found');
        return 'sent';
      }, 'test send retry timing (not found)');
      TestAssertEqual_(sleepCalls[0], 400, 'withSendRetry_: "Not found" retries after a flat 400ms, not the rate-limit backoff');

      sleepCalls.length = 0;
      calls = 0;
      withSendRetry_(function () {
        calls++;
        if (calls < 2) throw new Error('Gmail operation not allowed for this user');
        return 'sent';
      }, 'test send retry timing (operation not allowed)');
      TestAssertEqual_(sleepCalls[0], 2000, 'withSendRetry_: "operation not allowed" keeps the original attempt*2000ms backoff');
    } finally {
      Utilities.sleep = realSleep;
    }

    // ---- passesGoogleNonUtmSearchGs_ ----
    TestAssert_(passesGoogleNonUtmSearchGs_('Google', 'Non-UTM') === true, 'passesGoogleNonUtmSearchGs_: google + Non-UTM passes');
    TestAssert_(passesGoogleNonUtmSearchGs_('google', 'Search') === true, 'passesGoogleNonUtmSearchGs_: google + Search passes (case-insensitive)');
    TestAssert_(passesGoogleNonUtmSearchGs_('Google', 'Display') === false, 'passesGoogleNonUtmSearchGs_: google + an unlisted sub-source fails');
    TestAssert_(passesGoogleNonUtmSearchGs_('Facebook', 'Non-UTM') === false, 'passesGoogleNonUtmSearchGs_: non-google source fails regardless of sub-source');
    TestAssert_(passesGoogleNonUtmSearchGs_('', '') === false, 'passesGoogleNonUtmSearchGs_: blank source fails');

    // ---- mainRegionForGs_ ----
    TestAssertEqual_(mainRegionForGs_('Pune'), 'Pune', 'mainRegionForGs_: exact region name maps to itself');
    TestAssertEqual_(mainRegionForGs_('Pune East'), 'Pune', 'mainRegionForGs_: a sub-region maps to its main region');
    TestAssertEqual_(mainRegionForGs_('Bangalore 2'), 'Bangalore', 'mainRegionForGs_: numbered-suffix fallback strips a trailing number not itself listed');
    TestAssertEqual_(mainRegionForGs_('HNI'), 'SoBo', 'mainRegionForGs_: HNI rolls up into SoBo');
    TestAssertEqual_(mainRegionForGs_('Some Unconfigured Region'), null, 'mainRegionForGs_: an unrecognized region returns null (out of scope)');

    // ---- groupChLevelRmsByCh_ / splitSelfAndReportingRmNames_ / groupLeadsByRmAndFlatten_ ----
    // (extracted 2026-09 out of OvernightEmailer.gs/AllIssuesEmailer.gs's
    // duplicated CH-level notifiers — see EmailInfra.gs's own comment)
    const chLevelRmsFixture = [
      { chName: 'Vidya Jadhav', chEmail: 'vidya@example.com', chRole: 'Cluster Head', rmName: 'Vidya Jadhav' }, // self-held
      { chName: 'Vidya Jadhav', chEmail: 'vidya@example.com', chRole: 'Cluster Head', rmName: 'Sanket Yadav' },  // reports up
      { chName: 'Omkar Ghate', chEmail: 'omkar@example.com', chRole: 'City Lead', rmName: 'Priya Sharma' },
    ];
    const byChResult = groupChLevelRmsByCh_(chLevelRmsFixture);
    TestAssertEqual_(Object.keys(byChResult).length, 2, 'groupChLevelRmsByCh_: 3 entries across 2 distinct CHs group into 2 buckets');
    TestAssertEqual_(byChResult['Vidya Jadhav'].rmNames.length, 2, 'groupChLevelRmsByCh_: both of Vidya\'s entries land under her bucket');
    TestAssertEqual_(byChResult['Vidya Jadhav'].chEmail, 'vidya@example.com', 'groupChLevelRmsByCh_: preserves chEmail on the bucket');
    TestAssertEqual_(byChResult['Omkar Ghate'].rmNames[0], 'Priya Sharma', 'groupChLevelRmsByCh_: a CH with one reporting RM gets a one-entry rmNames list');

    const splitResult = splitSelfAndReportingRmNames_('Vidya Jadhav', byChResult['Vidya Jadhav'].rmNames);
    TestAssertEqual_(splitResult.selfRmNames.length, 1, 'splitSelfAndReportingRmNames_: exactly one self-held name (Vidya herself)');
    TestAssertEqual_(splitResult.selfRmNames[0], 'Vidya Jadhav', 'splitSelfAndReportingRmNames_: the self-held name is Vidya\'s own');
    TestAssertEqual_(splitResult.reportingRmNames.length, 1, 'splitSelfAndReportingRmNames_: exactly one reporting-up name (Sanket)');
    TestAssertEqual_(splitResult.reportingRmNames[0], 'Sanket Yadav', 'splitSelfAndReportingRmNames_: the reporting-up name is Sanket\'s');
    const splitCaseInsensitive = splitSelfAndReportingRmNames_('vidya jadhav', ['VIDYA JADHAV', 'Sanket Yadav']);
    TestAssertEqual_(splitCaseInsensitive.selfRmNames.length, 1, 'splitSelfAndReportingRmNames_: self-match is case-insensitive');

    const rmToLeadsFixture = {
      'Vidya Jadhav': [{ lead_id: 'L1', status: 'Not Updated' }],
      'Sanket Yadav': [{ lead_id: 'L2', status: 'Suspect' }, { lead_id: 'L3', status: 'Suspect' }],
      'Unrelated RM': [{ lead_id: 'L99', status: 'Booking' }], // not in rmNames — must be excluded
    };
    const groupedResult = groupLeadsByRmAndFlatten_(['Vidya Jadhav', 'Sanket Yadav'], rmToLeadsFixture);
    TestAssertEqual_(groupedResult.rmKeys.length, 2, 'groupLeadsByRmAndFlatten_: 2 RMs with leads produce 2 keys');
    TestAssertEqual_(groupedResult.rmKeys[0], 'Sanket Yadav', 'groupLeadsByRmAndFlatten_: rmKeys sorted alphabetically (Sanket before Vidya)');
    TestAssertEqual_(groupedResult.allLeads.length, 3, 'groupLeadsByRmAndFlatten_: flattens to 3 total leads across both RMs');
    TestAssertEqual_(groupedResult.allLeads[0].lead_id, 'L2', 'groupLeadsByRmAndFlatten_: flattened order follows the sorted rmKeys order, not insertion order');
    const groupedWithZero = groupLeadsByRmAndFlatten_(['Vidya Jadhav', 'Someone With No Leads'], rmToLeadsFixture);
    TestAssertEqual_(groupedWithZero.rmKeys.length, 1, 'groupLeadsByRmAndFlatten_: an RM with zero leads is dropped from rmKeys entirely');

    // ---- ensureRegionRecipientsSheet_ / loadRegionRecipients_ ----
    const recSheet = ensureRegionRecipientsSheet_(ss);
    TestAssert_(recSheet.getLastRow() > 1, 'ensureRegionRecipientsSheet_: creates a header row plus one row per configured region');
    const regionRecipients = loadRegionRecipients_(ss);
    TestAssertEqual_(Object.keys(regionRecipients).length, 0, 'loadRegionRecipients_: a freshly-created sheet with blank To cells yields an empty map (nothing configured yet)');
    // Fill in ONE region by hand, same as a human would in the sheet, and confirm it reads back.
    const allRows = recSheet.getRange(2, 1, recSheet.getLastRow() - 1, 3).getValues();
    const puneRowIdx = allRows.findIndex(function (r) { return r[0] === 'Pune'; });
    recSheet.getRange(2 + puneRowIdx, 2, 1, 2).setValues([[TEST_EMAIL_PRIMARY_, '']]);
    TestAssertEqual_(loadRegionRecipients_(ss).Pune.to, TEST_EMAIL_PRIMARY_, 'loadRegionRecipients_: reads back a manually-filled-in region row correctly');

    // ---- resolveRecipientEmailsForRegion_: normal per-A1 bucket ----
    let resolution = resolveRecipientEmailsForRegion_(ss, 'Test Region', ['Test RM One', 'Test RM Two'], {}, { fireAlerts: false });
    TestAssertEqual_(resolution.results.length, 1, 'resolveRecipientEmailsForRegion_: two RMs sharing the same A1 resolve into ONE bucket, not two');
    TestAssertEqual_(resolution.results[0].to, TEST_EMAIL_PRIMARY_, 'resolveRecipientEmailsForRegion_: the resolved bucket\'s To is the A1\'s own email');
    TestAssertEqual_(resolution.results[0].primaryRole, 'A1', 'resolveRecipientEmailsForRegion_: primaryRole reports the primary\'s own real tier (A1)');

    // ---- legacy Region_Recipients fallback for an unresolvable RM ----
    resolution = resolveRecipientEmailsForRegion_(ss, 'Pune', ['Some Totally Unknown RM'], loadRegionRecipients_(ss), { fireAlerts: false });
    TestAssertEqual_(resolution.results.length, 1, 'resolveRecipientEmailsForRegion_: an RM RM_Hierarchy can\'t resolve falls back to the legacy Region_Recipients entry');
    TestAssertEqual_(resolution.results[0].to, TEST_EMAIL_PRIMARY_, 'resolveRecipientEmailsForRegion_: legacy fallback uses the manually-configured Region_Recipients To');
    TestAssertEqual_(resolution.trulyUnresolved.length, 0, 'resolveRecipientEmailsForRegion_: not truly unresolved once the legacy fallback covers it');

    // ---- CH-level backstop: no RM_Hierarchy chain AND no legacy fallback
    // either (2026-09-01 — real production case: a departed RM whose own
    // row was removed from RM_Hierarchy entirely, with one straggler lead
    // still naming them in a region with no Region_Recipients row filled
    // in). Used to be dropped entirely ("truly unresolved"); now routes to
    // the same CH_LEVEL_EMAIL_ backstop a self-holding top-of-org RM uses. ----
    resolution = resolveRecipientEmailsForRegion_(ss, 'Test Region', ['Some Totally Unknown RM'], {}, { fireAlerts: false });
    TestAssertEqual_(resolution.results.length, 1, 'resolveRecipientEmailsForRegion_: routes to the CH-level backstop when nothing resolves and there is no legacy fallback either');
    TestAssertEqual_(resolution.results[0].to, TEST_EMAIL_CH_, 'resolveRecipientEmailsForRegion_: CH-level backstop goes to CH_LEVEL_EMAIL_');
    TestAssertContains_(resolution.results[0].source, 'backstop', 'resolveRecipientEmailsForRegion_: backstop entry\'s source names it as a backstop, not a normal RM_Hierarchy/legacy match');
    TestAssertEqual_(resolution.trulyUnresolved.length, 0, 'resolveRecipientEmailsForRegion_: no longer truly unresolved — the CH-level backstop always covers this case now');
    // Fixed 2026-09-24 (real production case): this branch used to also Cc
    // ALWAYS_CC_EMAILS_ (leadership), inconsistent with the sibling
    // CH-level backstop (notifyChLevelLeadsGs_/notifyChLevelIssuesGs_)
    // which deliberately excludes leadership from this class of email.
    TestAssertEqual_(resolution.results[0].cc, undefined, 'resolveRecipientEmailsForRegion_: CH-level backstop no longer Cc\'s ALWAYS_CC_EMAILS_ (leadership) — matches the sibling backstop\'s own "not leadership" rule');

    // ---- Futwork override (2026-09-25): any RM whose name contains
    // "Futwork" is emailed ONLY at FUTWORK_ROUTE_EMAIL_ — never a manager
    // chain, the legacy Region_Recipients fallback, the CH backstop, or a Cc ----
    TestAssert_(isFutworkRmNameGs_('Kajal Futwork') && isFutworkRmNameGs_('Deepali Tharwani Futwork') && isFutworkRmNameGs_('foram FUTWORK') && isFutworkRmNameGs_('Futwork Agent 1'), 'isFutworkRmNameGs_: matches "Futwork" anywhere in the name, case-insensitively');
    TestAssert_(!isFutworkRmNameGs_('Test RM One') && !isFutworkRmNameGs_('') && !isFutworkRmNameGs_(null) && !isFutworkRmNameGs_(undefined), 'isFutworkRmNameGs_: does not match ordinary, blank, or missing names');
    resolution = resolveRecipientEmailsForRegion_(ss, 'Pune', ['Test RM One', 'Kajal Futwork', 'foram FUTWORK'], loadRegionRecipients_(ss), { fireAlerts: false });
    const fwBuckets = resolution.results.filter(function (r) { return r.bucketLabel === 'Futwork'; });
    TestAssertEqual_(fwBuckets.length, 1, 'resolveRecipientEmailsForRegion_: every Futwork-named RM in a region lands in ONE dedicated Futwork bucket');
    TestAssertEqual_(fwBuckets[0].to, FUTWORK_ROUTE_EMAIL_, 'resolveRecipientEmailsForRegion_: the Futwork bucket goes to FUTWORK_ROUTE_EMAIL_');
    TestAssertEqual_(fwBuckets[0].cc, undefined, 'resolveRecipientEmailsForRegion_: the Futwork bucket has NO Cc (not even ALWAYS_CC_EMAILS_)');
    TestAssertEqual_(JSON.stringify(fwBuckets[0].rmNames.slice().sort()), JSON.stringify(['Kajal Futwork', 'foram FUTWORK']), 'resolveRecipientEmailsForRegion_: the Futwork bucket carries exactly the Futwork RM names');
    const fwOthers = resolution.results.filter(function (r) { return r.bucketLabel !== 'Futwork'; });
    TestAssertEqual_(fwOthers.length, 1, 'resolveRecipientEmailsForRegion_: a non-Futwork RM in the same call still resolves normally alongside the Futwork bucket');
    TestAssert_(fwOthers.every(function (r) { return r.rmNames.every(function (n) { return !isFutworkRmNameGs_(n); }); }), 'resolveRecipientEmailsForRegion_: no Futwork RM leaks into any regular bucket');
    resolution = resolveRecipientEmailsForRegion_(ss, 'Test Region', ['Kajal Futwork'], {}, { fireAlerts: false });
    TestAssertEqual_(resolution.results.length, 1, 'resolveRecipientEmailsForRegion_: a Futwork RM alone yields exactly one result');
    TestAssertEqual_(resolution.results[0].bucketLabel, 'Futwork', 'resolveRecipientEmailsForRegion_: with no fallback configured, a Futwork RM still goes to the Futwork bucket — NOT the CH-level backstop');
    TestAssertEqual_(resolution.trulyUnresolved.length, 0, 'resolveRecipientEmailsForRegion_: a Futwork RM is never reported as truly unresolved');
    resolution = resolveRecipientEmailsForRegion_(ss, 'Pune', ['Kajal Futwork'], loadRegionRecipients_(ss), { fireAlerts: false });
    TestAssertEqual_(resolution.results.length, 1, 'resolveRecipientEmailsForRegion_: a configured Region_Recipients fallback does not add a second bucket for a Futwork RM');
    TestAssertEqual_(resolution.results[0].cc, undefined, 'resolveRecipientEmailsForRegion_: a configured Region_Recipients fallback never adds a Cc to a Futwork RM');

    // ---- Region P&L head Cc (2026-09-26, "add pnl head of Hyderabad and Bangalore in cc for emails"). The config holds a
    // NAME (this repo is public); the address is looked up in Manager_Directory. Synthetic names/addresses only here. ----
    const pnlHead = TEST_EMAIL_SECONDARY_;
    const ssPnl = TestMockSpreadsheet_({
      'RM_Hierarchy': TestMockSheet_('RM_Hierarchy', TestFixture_rmHierarchyRows_()),
      'Manager_Directory': TestMockSheet_('Manager_Directory', TestFixture_managerDirectoryRows_().concat([
        ['Test PnL Head', 'Head', 'Test Region', pnlHead, 0, 'manual'],
      ])),
    });
    REGION_PNL_HEAD_CC_ = { 'Hyderabad': 'Test PnL Head', ' bangalore ': 'test pnl head' };
    try {
      const ccList = function (r) { return String((r && r.cc) || '').split(',').filter(Boolean); };
      const resolveIn = function (region, rms, legacy) { return resolveRecipientEmailsForRegion_(ssPnl, region, rms, legacy || {}, { fireAlerts: false }).results[0]; };
      const pnlPune = resolveIn('Pune', ['Test RM One']);
      const pnlHyd = resolveIn('Hyderabad', ['Test RM One']);
      const pnlBlr = resolveIn('Bangalore', ['Test RM One']);
      TestAssert_(ccList(pnlPune).indexOf(pnlHead) === -1, 'resolveRecipientEmailsForRegion_: a region with no P&L head configured (Pune) gets no extra Cc');
      TestAssert_(ccList(pnlHyd).indexOf(pnlHead) !== -1, 'resolveRecipientEmailsForRegion_: Hyderabad emails Cc the P&L head, address looked up by name in Manager_Directory');
      TestAssert_(ccList(pnlBlr).indexOf(pnlHead) !== -1, 'resolveRecipientEmailsForRegion_: Bangalore emails Cc the P&L head (region key and name matched case- and space-insensitively)');
      TestAssertEqual_(JSON.stringify(ccList(pnlHyd).filter(function (e) { return e !== pnlHead; })), JSON.stringify(ccList(pnlPune)), 'resolveRecipientEmailsForRegion_: the P&L head is ADDED to the existing Cc chain — nothing already Cc\'d is dropped or reordered');
      TestAssertEqual_(pnlHyd.to, pnlPune.to, 'resolveRecipientEmailsForRegion_: adding the P&L head never changes the To');

      // The P&L head is already the To of the email (their own bucket) -> not also Cc'd.
      REGION_PNL_HEAD_CC_ = { 'Hyderabad': 'Test A1 One' }; // resolves to TEST_EMAIL_PRIMARY_, which is Test RM One's To
      TestAssert_(ccList(resolveIn('Hyderabad', ['Test RM One'])).indexOf(pnlHyd.to) === -1, 'resolveRecipientEmailsForRegion_: a P&L head who is already the To of the email is not also Cc\'d');
      // Already present in the Cc chain (the CH) -> not duplicated.
      REGION_PNL_HEAD_CC_ = { 'Hyderabad': 'Test CH Self' }; // resolves to TEST_EMAIL_CH_, already in the Cc chain
      const dupeCc = ccList(resolveIn('Hyderabad', ['Test RM One']));
      TestAssertEqual_(dupeCc.filter(function (e) { return e === TEST_EMAIL_CH_; }).length, 1, 'resolveRecipientEmailsForRegion_: a P&L head already in the Cc chain is not duplicated');
      // No address on record for the configured name -> no Cc added, no throw.
      REGION_PNL_HEAD_CC_ = { 'Hyderabad': 'Test A1 NoMail' };
      TestAssertEqual_(JSON.stringify(ccList(resolveIn('Hyderabad', ['Test RM One']))), JSON.stringify(ccList(pnlPune)), 'resolveRecipientEmailsForRegion_: a P&L head with no address in Manager_Directory adds nothing and does not throw');
      REGION_PNL_HEAD_CC_ = { 'Hyderabad': 'Someone Not In The Directory' };
      TestAssertEqual_(JSON.stringify(ccList(resolveIn('Hyderabad', ['Test RM One']))), JSON.stringify(ccList(pnlPune)), 'resolveRecipientEmailsForRegion_: a P&L head name Manager_Directory does not know adds nothing and does not throw');

      REGION_PNL_HEAD_CC_ = { 'Hyderabad': 'Test PnL Head' };
      const legacyPnl = resolveIn('Hyderabad', ['Some Totally Unknown RM'], { 'Hyderabad': { to: TEST_EMAIL_PRIMARY_, cc: '' } });
      TestAssert_(ccList(legacyPnl).indexOf(pnlHead) !== -1, 'resolveRecipientEmailsForRegion_: the legacy Region_Recipients fallback bucket also Cc\'s the P&L head');
      const backstopPnl = resolveIn('Hyderabad', ['Some Totally Unknown RM']);
      TestAssertEqual_(backstopPnl.cc, undefined, 'resolveRecipientEmailsForRegion_: the CH-level backstop still has NO Cc, P&L head included');
      const futworkPnl = resolveIn('Hyderabad', ['Kajal Futwork']);
      TestAssertEqual_(futworkPnl.cc, undefined, 'resolveRecipientEmailsForRegion_: the Futwork bucket still has NO Cc, P&L head included (it goes to FUTWORK_ROUTE_EMAIL_ only)');

      TestAssertEqual_(regionPnlHeadEmailGs_(ssPnl, 'Pune', undefined), '', 'regionPnlHeadEmailGs_: an unconfigured region has no P&L head');
      TestAssertEqual_(regionPnlHeadEmailGs_(ssPnl, undefined, undefined), '', 'regionPnlHeadEmailGs_: a missing region never throws');
      TestAssertEqual_(regionPnlHeadEmailGs_(ssPnl, 'Hyderabad', { emailByManagerNameLower: { 'test pnl head': 'given@x.com' } }), 'given@x.com', 'regionPnlHeadEmailGs_: uses hierarchy data the caller already loaded instead of reading the sheets again');
      TestAssertEqual_(withRegionPnlHeadCcGs_('', 'a@x.com', 'b@x.com'), 'b@x.com', 'withRegionPnlHeadCcGs_: no P&L head passes the Cc through unchanged');
      TestAssertEqual_(withRegionPnlHeadCcGs_('', 'a@x.com', ''), undefined, 'withRegionPnlHeadCcGs_: no P&L head and no Cc stays undefined');
      TestAssertEqual_(withRegionPnlHeadCcGs_('p@x.com', 'a@x.com', ''), 'p@x.com', 'withRegionPnlHeadCcGs_: with no other Cc the result is just the P&L head');
      TestAssertEqual_(withRegionPnlHeadCcGs_('p@x.com', 'a@x.com', 'b@x.com, c@x.com'), 'b@x.com,c@x.com,p@x.com', 'withRegionPnlHeadCcGs_: appended after the existing Cc, whitespace tidied');
      TestAssertEqual_(withRegionPnlHeadCcGs_('P@X.com', 'a@x.com', 'p@x.com'), 'p@x.com', 'withRegionPnlHeadCcGs_: an address already present in a different case is not duplicated');

      REGION_PNL_HEAD_CC_ = { 'Hyderabad': 'Test PnL Head' };
      TEST_MODE_OVERRIDE_EMAIL_ = TEST_EMAIL_CH_;
      const testModePnl = resolveIn('Hyderabad', ['Test RM One']);
      TEST_MODE_OVERRIDE_EMAIL_ = '';
      TestAssertEqual_(testModePnl.cc, undefined, 'resolveRecipientEmailsForRegion_: in TEST MODE the P&L head is NOT Cc\'d — real recipients are suppressed, shown only as originalCc');
      TestAssert_(ccList({ cc: testModePnl.originalCc }).indexOf(pnlHead) !== -1, 'resolveRecipientEmailsForRegion_: TEST MODE\'s originalCc still shows the P&L head, so a tester sees what a real send would do');
    } finally {
      TEST_MODE_OVERRIDE_EMAIL_ = '';
      REGION_PNL_HEAD_CC_ = {};
    }

    // ---- Futwork single-email helpers (2026-09-25): one pseudo-region across every real region ----
    TestAssertEqual_(regionKeyForRmGs_('Kajal Futwork', 'Pune'), FUTWORK_REGION_KEY_, 'regionKeyForRmGs_: a Futwork RM groups under the single Futwork key whatever its real region');
    TestAssertEqual_(regionKeyForRmGs_('Test RM One', 'Pune'), 'Pune', 'regionKeyForRmGs_: any other RM keeps its own region');
    const fwItems = [{ region: 'Pune' }, { region: 'Bangalore' }, { region: 'Pune' }, {}];
    const fwSummary = regionSummaryGs_(fwItems);
    TestAssertEqual_(JSON.stringify(fwSummary.regions), JSON.stringify(['Bangalore', 'Pune']), 'regionSummaryGs_: real regions, sorted, items without a region ignored');
    TestAssertEqual_(fwSummary.label, 'Bangalore (1) · Pune (2)', 'regionSummaryGs_: label spells out each region with its lead count');
    TestAssertEqual_(JSON.stringify(regionHeaderOptsGs_('Pune', fwItems)), JSON.stringify({ region: 'Pune' }), 'regionHeaderOptsGs_: an ordinary region is unchanged');
    const fwHeader = regionHeaderOptsGs_(FUTWORK_REGION_KEY_, fwItems);
    TestAssertEqual_(fwHeader.region, 'Bangalore, Pune', 'regionHeaderOptsGs_: the Futwork key expands to every real region, spelled out');
    TestAssertEqual_(fwHeader.regionLabel, 'Regions: Bangalore (1) · Pune (2)', 'regionHeaderOptsGs_: the header line names every region with its count');
    TestAssertEqual_(regionHeaderOptsGs_(FUTWORK_REGION_KEY_, [{ region: 'Pune' }]).regionLabel, 'Region: Pune (1)', 'regionHeaderOptsGs_: a single Futwork region reads "Region:", not "Regions:"');
    TestAssertEqual_(regionHeaderOptsGs_(FUTWORK_REGION_KEY_, []).region, FUTWORK_REGION_KEY_, 'regionHeaderOptsGs_: with no items the header falls back to the Futwork key');
    const banded = sectionsByRegionGs_([{ region: 'Pune', RM: 'a' }, { region: 'Bangalore', RM: 'b' }, { region: 'Pune', RM: 'c' }], function (r, regionItems) {
      return regionItems.map(function (i) { return { heading: i.RM, columns: [], rows: [] }; });
    });
    TestAssertEqual_(banded.map(function (s) { return s.heading; }).join(','), 'b,a,c', 'sectionsByRegionGs_: regions sorted, each region\'s sections kept together');
    TestAssertEqual_(banded[0].regionBand, 'Bangalore — 1 lead', 'sectionsByRegionGs_: the first section of a region carries its band (singular lead)');
    TestAssertEqual_(banded[1].regionBand, 'Pune — 2 leads', 'sectionsByRegionGs_: band counts the region\'s items (plural leads)');
    TestAssert_(banded[2].regionBand === undefined, 'sectionsByRegionGs_: only the FIRST section of a region carries the band');
    TestAssertEqual_(dedupeByLeadIdGs_([{ lead_id: 'A', v: 1 }, { lead_id: 'B' }, { lead_id: 'A', v: 2 }]).map(function (e) { return e.lead_id + (e.v || ''); }).join(','), 'A1,B', 'dedupeByLeadIdGs_: the first occurrence of each lead wins');
    const bandHtml = renderOvernightReportEmailHTML_({ title: 'T', region: 'Bangalore, Pune', regionLabel: 'Regions: Bangalore (1) · Pune (2)', subtitle: 's', kpis: [], action: '', footerNote: '', sections: [{ heading: 'RM X', columns: ['c'], rows: [['r']], regionBand: 'Bangalore — 1 lead' }] });
    TestAssertContains_(bandHtml, 'Regions: Bangalore (1) · Pune (2)', 'renderOvernightReportEmailHTML_: a custom regionLabel replaces the "Region:" line');
    TestAssertContains_(bandHtml, 'Bangalore — 1 lead', 'renderOvernightReportEmailHTML_: a section regionBand is drawn above the section');
    TestAssert_(bandHtml.indexOf('Region: Bangalore, Pune') === -1, 'renderOvernightReportEmailHTML_: the default "Region:" line is not also printed when a regionLabel is given');

    // ---- Cell-size safety (2026-09-25 13:00 crash: a 81,000-character checkpoint cell, reported one sheet call late) ----
    TestAssertEqual_(jsonForCellGs_([{ lead_id: 'A' }], 'x'), '[{"lead_id":"A"}]', 'jsonForCellGs_: a small list is serialized unchanged');
    TestAssertEqual_(jsonForCellGs_(null, 'x'), '[]', 'jsonForCellGs_: a missing list becomes an empty JSON array');
    const cellAlertsBefore = TestGmailLog_.sent.length;
    const bigCellList = [];
    for (let i = 0; i < 2000; i++) bigCellList.push({ lead_id: 'L-' + i, state: 'still_open', currentIssueLabel: 'Follow-up Overdue', currentStatus: 'Suspect' });
    const bigCellJson = jsonForCellGs_(bigCellList, 'checkpoint2_json (Test)');
    TestAssert_(bigCellJson.length > 0 && bigCellJson.length <= MAX_CELL_JSON_CHARS_, 'jsonForCellGs_: an oversize list is cut down to fit under the cell limit');
    TestAssert_(JSON.parse(bigCellJson).length < 2000 && JSON.parse(bigCellJson)[0].lead_id === 'L-0', 'jsonForCellGs_: it keeps the LEADING entries and drops the tail');
    TestAssertEqual_(TestGmailLog_.sent.length, cellAlertsBefore + 1, 'jsonForCellGs_: truncating alerts ops once');
    TestAssertContains_(TestGmailLog_.sent[cellAlertsBefore].subject, 'A log cell was too large', 'jsonForCellGs_: the alert names the problem');
    let flushCalls = 0;
    const realFlushFn = SpreadsheetApp.flush;
    SpreadsheetApp.flush = function () { flushCalls++; };
    writeUnlessTestModeGs_(function () {}, 'ok write');
    TestAssertEqual_(flushCalls, 1, 'writeUnlessTestModeGs_: flushes after the write so a bad cell errors HERE, inside the caller\'s try/catch');
    SpreadsheetApp.flush = function () { throw new Error('Your input contains more than the maximum of 50000 characters in a single cell.'); };
    TestAssertThrows_(function () { writeUnlessTestModeGs_(function () {}, 'oversize write'); }, 'writeUnlessTestModeGs_: a deferred oversize-cell error surfaces inside the write instead of on the next unrelated sheet call');
    SpreadsheetApp.flush = realFlushFn;
    let ranInTestMode = false;
    TEST_MODE_OVERRIDE_EMAIL_ = TEST_EMAIL_PRIMARY_;
    writeUnlessTestModeGs_(function () { ranInTestMode = true; }, 'test-mode write');
    TEST_MODE_OVERRIDE_EMAIL_ = '';
    TestAssert_(!ranInTestMode, 'writeUnlessTestModeGs_: TEST MODE still skips the write entirely');
    TestGmailLog_reset_(); // this block's own truncation alert must not shift the exact send counts asserted further down

    // ---- resolveRecipientEmailsForRegion_: opts.hierarchyData + the new
    // chLevelRms field on its own result (perf pass, 2026-08-28) — a
    // caller that loads RM_Hierarchy/Manager_Directory once per run and
    // threads it through must get output byte-identical to the normal
    // (internally-loading) path, and must be able to read chLevelRms
    // straight off the result without a second
    // resolveRecipientBucketsForRms_ call (see AllIssuesEmailer.gs's own
    // fix for the real double-call this closes). ----
    const preloadedHierarchy = loadRmHierarchyAndEmails_(ss);
    const noPreload = resolveRecipientEmailsForRegion_(ss, 'Test Region', ['Test CH Self'], {}, { fireAlerts: false });
    const withHierarchyPreload = resolveRecipientEmailsForRegion_(ss, 'Test Region', ['Test CH Self'], {}, { fireAlerts: false, hierarchyData: preloadedHierarchy });
    TestAssertEqual_(JSON.stringify(withHierarchyPreload), JSON.stringify(noPreload), 'resolveRecipientEmailsForRegion_: opts.hierarchyData produces output byte-identical to omitting it');
    TestAssertEqual_(noPreload.chLevelRms.length, 1, 'resolveRecipientEmailsForRegion_: now returns chLevelRms directly in its result, so a caller (AllIssuesEmailer.gs) never has to call resolveRecipientBucketsForRms_ a second time just to get it');
    TestAssertEqual_(noPreload.chLevelRms[0].chEmail, TEST_EMAIL_CH_, 'resolveRecipientEmailsForRegion_: the returned chLevelRms entry is the real self-holding CH data, not a stub');

    // ---- TEST_MODE_OVERRIDE_EMAIL_ redirection ----
    TEST_MODE_OVERRIDE_EMAIL_ = TEST_EMAIL_PRIMARY_;
    resolution = resolveRecipientEmailsForRegion_(ss, 'Test Region', ['Test RM One'], {}, { fireAlerts: false });
    TestAssertEqual_(resolution.results[0].to, TEST_EMAIL_PRIMARY_, 'resolveRecipientEmailsForRegion_: TEST_MODE_OVERRIDE_EMAIL_ redirects the resolved To');
    TestAssert_(!!resolution.results[0].originalTo, 'resolveRecipientEmailsForRegion_: the REAL resolved recipient is preserved as originalTo for visibility');
    TEST_MODE_OVERRIDE_EMAIL_ = '';

    // ---- notifyOpsAlertGs_ / notifyLeadSendFailuresGs_ ----
    notifyOpsAlertGs_('Test alert', ['line one', 'line two']);
    TestAssertEqual_(TestGmailLog_.sent.length, 1, 'notifyOpsAlertGs_: sends exactly one plain email');
    TestAssertEqual_(TestGmailLog_.sent[0].to, TEST_EMAIL_PRIMARY_, 'notifyOpsAlertGs_: goes to OPS_ALERT_EMAIL_ (overridden to the test address)');
    TestAssertContains_(TestGmailLog_.sent[0].subject, 'Test alert', 'notifyOpsAlertGs_: subject carries the given text');

    notifyLeadSendFailuresGs_([{ lead_id: 'L-1', RM: 'Test RM One', to: '', cc: '', reason: 'test reason' }]);
    TestAssertEqual_(TestGmailLog_.sent.length, 2, 'notifyLeadSendFailuresGs_: sends its own single consolidated report');
    TestAssertEqual_(TestGmailLog_.sent[1].to, TEST_EMAIL_PRIMARY_, 'notifyLeadSendFailuresGs_: also goes to OPS_ALERT_EMAIL_ only');
    notifyLeadSendFailuresGs_([]);
    TestAssertEqual_(TestGmailLog_.sent.length, 2, 'notifyLeadSendFailuresGs_: sends nothing at all when given an empty entries list');

    // ---- renderOvernightReportEmailHTML_ smoke test ----
    const html = renderOvernightReportEmailHTML_({
      title: 'Test Report', region: 'Test Region', subtitle: 'Test Subtitle',
      kpis: [{ value: 5, label: 'Test KPI', bg: '#fff', fg: '#000' }],
      sections: [{ heading: 'Test Section', columns: ['A', 'B'], rows: [['x', 'y']] }],
    });
    TestAssertContains_(html, 'Test Report', 'renderOvernightReportEmailHTML_: includes the given title');
    TestAssertContains_(html, 'Test Region', 'renderOvernightReportEmailHTML_: includes the given region');
    TestAssertContains_(html, '>5<', 'renderOvernightReportEmailHTML_: includes the KPI value');
    TestAssertContains_(html, 'Test Section', 'renderOvernightReportEmailHTML_: includes the section heading');
    const htmlEscaped = renderOvernightReportEmailHTML_({
      title: '<script>evil</script>', region: 'R', subtitle: 'S', kpis: [], sections: [],
    });
    TestAssertContains_(htmlEscaped, '&lt;script&gt;evil&lt;/script&gt;', 'renderOvernightReportEmailHTML_: title content is escaped, not injected raw');

    TestAssertOnlyTestEmails_();
  } finally {
    TestEnv_tearDown_();
  }
  return TestResults_;
}

function runEmailInfraTestsNow() { runEmailInfraTests_(); }
