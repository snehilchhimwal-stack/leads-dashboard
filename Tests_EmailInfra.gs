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

    // ---- 2026-10-07 email audit P12 (F22): the platform's own "server error occurred" wording is transient too ----
    // The 2 Oct 13:00 run ended Failed with exactly this message; it matched none of the old patterns, so the first such error
    // from a Sheets call aborted the whole job.
    const platformMsg = "We're sorry, a server error occurred. Please wait a bit and try again.";
    calls = 0;
    const platformOk = withRetry_(function () {
      calls++;
      if (calls < 3) throw new Error(platformMsg);
      return 'ok';
    }, 'test platform server error');
    TestAssertEqual_(platformOk, 'ok', 'withRetry_: the platform\'s "server error occurred" error is retried and the call eventually succeeds');
    TestAssertEqual_(calls, 3, 'withRetry_: …after exactly two retries');
    calls = 0;
    const platformSleeps = [];
    const realSleepP12 = Utilities.sleep;
    Utilities.sleep = function (ms) { platformSleeps.push(ms); };
    try {
      TestAssertThrows_(function () { withRetry_(function () { calls++; throw new Error(platformMsg); }, 'test persistent platform error'); }, 'withRetry_: a platform error that never clears is finally re-thrown (not swallowed)');
    } finally { Utilities.sleep = realSleepP12; }
    TestAssertEqual_(calls, 4, 'withRetry_: a persistent platform error is attempted 4 times in total, like every other transient error');
    TestAssertEqual_(platformSleeps.join(','), '2000,4000,6000', 'withRetry_: …with the usual 2s/4s/6s backoff');
    calls = 0;
    const thrownString = withRetry_(function () { calls++; if (calls < 2) throw platformMsg; return 'ok'; }, 'test platform error thrown as a bare string');
    TestAssert_(thrownString === 'ok' && calls === 2, 'withRetry_: the wording is recognised even when thrown as a bare string rather than an Error');
    [
      'Service Spreadsheets timed out while accessing document with id abc',
      'Exception: Service error: Spreadsheets',
      'Exception: Service Gmail failed while accessing document',
      'Internal error encountered.',
    ].forEach(function (m) {
      calls = 0;
      withRetry_(function () { calls++; if (calls < 2) throw new Error(m); return 'ok'; }, 'test existing transient');
      TestAssertEqual_(calls, 2, 'withRetry_: the pre-existing transient wording is still retried: ' + m.slice(0, 40));
    });
    [
      'Exception: Service invoked too many times for one day: gmail.',
      'You do not have permission to call SpreadsheetApp.openById',
      'Exception: The number of rows in the range must be at least 1.',
      'Please wait a bit and try again later.',
    ].forEach(function (m) {
      calls = 0;
      try { withRetry_(function () { calls++; throw new Error(m); }, 'test permanent'); } catch (e) { /* expected */ }
      TestAssertEqual_(calls, 1, 'withRetry_: a permanent refusal is NOT retried: ' + m.slice(0, 40));
    });
    // A once-only log append whose write landed before the platform error is retried WITHOUT adding a second row (P7 + P12 together).
    const p12Log = TestMockSheet_('Overnight_Log', [['date', 'region', 'thread_id']]);
    const realP12Append = p12Log.appendRow;
    let p12AppendCalls = 0;
    p12Log.appendRow = function (values) { p12AppendCalls++; realP12Append(values); if (p12AppendCalls === 1) throw new Error(platformMsg); };
    withRetry_(appendRowOnceGs_(p12Log, ['2026-10-07', 'Pune', 'thr-p12'], 2), 'log row (platform error after the write)');
    TestAssertEqual_(p12Log.getLastRow(), 2, 'withRetry_ + appendRowOnceGs_: an append that landed before a platform "server error occurred" is retried without a duplicate row');

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

    // ---- Real production REGION_PNL_HEAD_CC_ config sanity (2026-09-30) — TestEnv_realGlobals_ captured the actual
    // production map before TestEnv_setUp_ reset it to {} above; this catches a region silently dropped from it. ----
    const realPnlMap = {};
    Object.keys(TestEnv_realGlobals_.REGION_PNL_HEAD_CC_ || {}).forEach(function (r) { realPnlMap[r.trim().toLowerCase()] = TestEnv_realGlobals_.REGION_PNL_HEAD_CC_[r]; });
    ['Hyderabad', 'Bangalore', 'Thane', 'Navi Mumbai'].forEach(function (region) {
      TestAssert_(!!realPnlMap[region.toLowerCase()], 'REGION_PNL_HEAD_CC_ (production): ' + region + ' has a configured P&L head');
    });

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

    // ============ 2026-10-05 email audit P1: the outgoing-email safety gate ============
    // ---- emailAddressListProblemsGs_ ----
    TestAssertEqual_(emailAddressListProblemsGs_('a@homesfy.in', 'To', true).length, 0, 'emailAddressListProblemsGs_: a plain address is fine');
    TestAssertEqual_(emailAddressListProblemsGs_('a@homesfy.in, b.c+d@x.co.in', 'To', true).length, 0, 'emailAddressListProblemsGs_: a comma list of valid addresses is fine');
    TestAssertEqual_(emailAddressListProblemsGs_('', 'To', true).length, 1, 'emailAddressListProblemsGs_: an empty required list is a problem');
    TestAssertEqual_(emailAddressListProblemsGs_('', 'Cc', false).length, 0, 'emailAddressListProblemsGs_: an empty OPTIONAL list is fine');
    TestAssertEqual_(emailAddressListProblemsGs_(undefined, 'Cc', false).length, 0, 'emailAddressListProblemsGs_: undefined Cc is fine');
    TestAssertEqual_(emailAddressListProblemsGs_('not-an-email', 'To', true).length, 1, 'emailAddressListProblemsGs_: an address with no @ is rejected');
    TestAssertEqual_(emailAddressListProblemsGs_('a@b', 'To', true).length, 1, 'emailAddressListProblemsGs_: an address with no dot after the @ is rejected');
    TestAssertEqual_(emailAddressListProblemsGs_('a@homesfy.in,bad', 'To', true).length, 1, 'emailAddressListProblemsGs_: one bad address in a list is reported (and only that one)');
    TestAssertEqual_(emailAddressListProblemsGs_('a@homesfy.in\r\nBcc: evil@x.com', 'To', true).length > 0, true, 'emailAddressListProblemsGs_: an address carrying a CR/LF header-injection payload is rejected');
    TestAssertEqual_(emailAddressListProblemsGs_(['a@homesfy.in', 'b@homesfy.in'], 'To', true).length, 0, 'emailAddressListProblemsGs_: accepts an array too');

    // ---- visibleTextOfHtmlGs_ ----
    TestAssertEqual_(visibleTextOfHtmlGs_('<div><table><tr><td> </td></tr></table></div>'), '', 'visibleTextOfHtmlGs_: markup with no text has no visible text');
    TestAssertEqual_(visibleTextOfHtmlGs_('<style>.a{color:red}</style><p>Hello&nbsp;<b>world</b> &amp; co</p>'), 'Hello world & co', 'visibleTextOfHtmlGs_: strips style blocks and tags, decodes entities, collapses whitespace');
    TestAssertEqual_(visibleTextOfHtmlGs_(null), '', 'visibleTextOfHtmlGs_: null is empty text');

    // ---- prepareOutgoingEmailGs_ ----
    const goodMsg = { to: TEST_EMAIL_PRIMARY_, cc: TEST_EMAIL_CH_, subject: 'S', plainBody: 'plain L-1', htmlBody: '<p>html L-1</p>', leadIds: ['L-1'] };
    TestAssertEqual_(prepareOutgoingEmailGs_(goodMsg).problems.length, 0, 'prepareOutgoingEmailGs_: a complete, consistent report email passes');
    TestAssert_(prepareOutgoingEmailGs_(Object.assign({}, goodMsg, { to: '' })).problems.length > 0, 'prepareOutgoingEmailGs_: a missing recipient is a problem');
    TestAssert_(prepareOutgoingEmailGs_(Object.assign({}, goodMsg, { to: 'nope' })).problems.length > 0, 'prepareOutgoingEmailGs_: an invalid recipient is a problem');
    TestAssert_(prepareOutgoingEmailGs_(Object.assign({}, goodMsg, { cc: 'bad cc' })).problems.length > 0, 'prepareOutgoingEmailGs_: an invalid Cc is a problem');
    TestAssert_(prepareOutgoingEmailGs_(Object.assign({}, goodMsg, { subject: '   ' })).problems.length > 0, 'prepareOutgoingEmailGs_: a whitespace-only subject is a problem');
    TestAssert_(prepareOutgoingEmailGs_(Object.assign({}, goodMsg, { subject: undefined })).problems.length > 0, 'prepareOutgoingEmailGs_: an undefined subject is a problem');
    TestAssert_(prepareOutgoingEmailGs_(Object.assign({}, goodMsg, { plainBody: '' })).problems.length > 0, 'prepareOutgoingEmailGs_: an empty plain-text body is a problem');
    TestAssert_(prepareOutgoingEmailGs_(Object.assign({}, goodMsg, { plainBody: ' \n\t ' })).problems.length > 0, 'prepareOutgoingEmailGs_: a whitespace-only plain-text body is a problem');
    TestAssert_(prepareOutgoingEmailGs_(Object.assign({}, goodMsg, { plainBody: null })).problems.length > 0, 'prepareOutgoingEmailGs_: a null plain-text body is a problem');
    TestAssert_(prepareOutgoingEmailGs_(Object.assign({}, goodMsg, { htmlBody: '<div><table><tr><td></td></tr></table></div>' })).problems.length > 0, 'prepareOutgoingEmailGs_: an HTML body with no visible text is a problem');
    TestAssert_(prepareOutgoingEmailGs_(Object.assign({}, goodMsg, { leadIds: [] })).problems.length > 0, 'prepareOutgoingEmailGs_: a report that names no leads is a problem — nothing to send');
    TestAssert_(prepareOutgoingEmailGs_(Object.assign({}, goodMsg, { leadIds: ['L-1', 'L-MISSING'] })).problems.some(function (p) { return /L-MISSING/.test(p); }), 'prepareOutgoingEmailGs_: a lead the email counts but whose id is NOT in the HTML body is a problem (and is named)');
    TestAssert_(prepareOutgoingEmailGs_(Object.assign({}, goodMsg, { plainBody: 'plain, no ids' })).problems.some(function (p) { return /plain-text body/.test(p); }), 'prepareOutgoingEmailGs_ (P2): a counted lead missing from the PLAIN part alone is caught');
    TestAssert_(prepareOutgoingEmailGs_(Object.assign({}, goodMsg, { htmlBody: '<p>html, no ids</p>' })).problems.some(function (p) { return /HTML body/.test(p); }), 'prepareOutgoingEmailGs_ (P2): …and one missing from the HTML part alone is caught');
    TestAssertEqual_(prepareOutgoingEmailGs_({ to: TEST_EMAIL_PRIMARY_, subject: 'S', plainBody: 'p' }).problems.length, 0, 'prepareOutgoingEmailGs_: leadIds omitted = not a report email, no lead check (an ops note can still pass)');
    TestAssertEqual_(prepareOutgoingEmailGs_(Object.assign({}, goodMsg, { subject: 'Line1\r\nBcc: evil@x.com' })).msg.subject, 'Line1 Bcc: evil@x.com', 'prepareOutgoingEmailGs_: CR/LF in the subject is collapsed so a header can never carry a line break');

    // ---- sendGuardedEmailGs_ ----
    let draftsBefore = TestGmailLog_.drafts.length;
    sendGuardedEmailGs_(goodMsg, 'test guarded send');
    TestAssertEqual_(TestGmailLog_.drafts.length, draftsBefore + 1, 'sendGuardedEmailGs_: a valid email is drafted and sent');
    const guardedDraft = TestGmailLog_.drafts[TestGmailLog_.drafts.length - 1];
    TestAssertEqual_(guardedDraft.to, TEST_EMAIL_PRIMARY_, 'sendGuardedEmailGs_: the exact validated recipient reaches the provider');
    TestAssertEqual_(guardedDraft.cc, TEST_EMAIL_CH_, 'sendGuardedEmailGs_: the exact validated Cc reaches the provider');
    TestAssertEqual_(guardedDraft.subject, 'S', 'sendGuardedEmailGs_: the exact validated subject reaches the provider');
    TestAssertEqual_(guardedDraft.body, 'plain L-1', 'sendGuardedEmailGs_: the exact validated plain body reaches the provider');
    TestAssertEqual_(guardedDraft.htmlBody, '<p>html L-1</p>', 'sendGuardedEmailGs_: the exact validated HTML body reaches the provider');

    draftsBefore = TestGmailLog_.drafts.length;
    let blockedErr = null;
    try { sendGuardedEmailGs_(Object.assign({}, goodMsg, { plainBody: '  ' }), 'test blocked send'); } catch (e) { blockedErr = e; }
    TestAssert_(!!blockedErr && blockedErr.blockedByGuard === true, 'sendGuardedEmailGs_: an empty-body email throws a blockedByGuard error');
    TestAssert_(!!blockedErr && blockedErr.guardProblems.length > 0, 'sendGuardedEmailGs_: the blocked error carries the problem list');
    TestAssertEqual_(TestGmailLog_.drafts.length, draftsBefore, 'sendGuardedEmailGs_: a blocked email creates NO draft at all — nothing reaches the provider');
    blockedErr = null;
    try { sendGuardedEmailGs_({ to: TEST_EMAIL_PRIMARY_, subject: 'S', plainBody: 'p', htmlBody: '<p></p>', leadIds: ['L-1'] }, 'test blocked 2'); } catch (e) { blockedErr = e; }
    TestAssert_(!!blockedErr && blockedErr.blockedByGuard === true, 'sendGuardedEmailGs_: an HTML body with no visible text is blocked even when the plain body is fine');
    TestAssertEqual_(TestGmailLog_.drafts.length, draftsBefore, 'sendGuardedEmailGs_: …and again creates no draft');

    // The retry rule is unchanged underneath the gate: a definitive "operation not allowed" is retried, then delivered once.
    GmailApp = TestMockGmailApp_({ failSendCountFor: (function () { const o = {}; o[TEST_EMAIL_PRIMARY_] = 1; return o; })() });
    draftsBefore = TestGmailLog_.drafts.length;
    const retried = sendGuardedEmailGs_({ to: TEST_EMAIL_PRIMARY_, subject: 'R', plainBody: 'p L-9', htmlBody: '<p>L-9</p>', leadIds: ['L-9'] }, 'test retry through gate');
    TestAssert_(!!retried && typeof retried.getThread === 'function', 'sendGuardedEmailGs_: still returns the sent message (so callers can read its thread)');
    TestAssertEqual_(TestGmailLog_.drafts.length - draftsBefore, 2, 'sendGuardedEmailGs_: one definitive refusal is retried (2 drafts: the refused one + the delivered one) — unchanged withSendRetry_ behavior');
    GmailApp = TestMockGmailApp_();

    // ============ 2026-10-05 email audit P2: a real plain-text part, and no "undefined" cells ============
    // A missing cell used to render as the literal word "undefined" (String(undefined) before esc_).
    const htmlNullCell = renderOvernightReportEmailHTML_({
      title: 'T', region: 'R', subtitle: 'S', kpis: [],
      sections: [{ heading: 'H', columns: ['A', 'B', 'C'], rows: [['x', undefined, null], [0, 'z', '']] }],
    });
    TestAssert_(htmlNullCell.indexOf('undefined') === -1 && htmlNullCell.indexOf('null') === -1, 'renderOvernightReportEmailHTML_: a null/undefined cell renders blank, never the text "undefined"/"null"');
    TestAssertContains_(htmlNullCell, '>0<', 'renderOvernightReportEmailHTML_: a numeric 0 cell still renders as "0"');

    const plainOpts = {
      title: 'Overnight Leads', region: 'Pune', subtitle: '1 Oct 5pm - 2 Oct 9am',
      kpis: [{ value: 2, label: 'Leads Assigned', bg: '#fff', fg: '#000' }],
      action: 'Call them.',
      sections: [{ heading: 'Test RM One', subheading: 'Manager: Test A1 One', columns: ['Lead ID', 'Status'], rows: [['L-100', 'Suspect'], ['L-101', undefined]] }],
      footerNote: 'Status is live.',
    };
    const plainText = plainTextFromReportOptsGs_(plainOpts);
    ['Overnight Leads', 'Region: Pune', '1 Oct 5pm - 2 Oct 9am', '2 Leads Assigned', 'Call them.', 'Test RM One - Manager: Test A1 One', 'Lead ID | Status', 'L-100 | Suspect', 'L-101 |', 'Status is live.'].forEach(function (needle) {
      TestAssertContains_(plainText, needle, 'plainTextFromReportOptsGs_: includes "' + needle + '"');
    });
    TestAssert_(plainText.indexOf('undefined') === -1, 'plainTextFromReportOptsGs_: a missing cell is blank, never "undefined"');
    TestAssertContains_(plainTextFromReportOptsGs_({ title: 'F', regionLabel: 'Regions: Pune (1) · Thane (1)', sections: [{ regionBand: 'Pune — 1 lead', heading: 'H', columns: ['A'], rows: [['x']] }] }), 'Regions: Pune (1) · Thane (1)', 'plainTextFromReportOptsGs_: a region label replaces the "Region:" line (the Futwork email)');
    TestAssertContains_(plainTextFromReportOptsGs_({ title: 'F', sections: [{ regionBand: 'Pune — 1 lead', heading: 'H', columns: ['A'], rows: [['x']] }] }), '== Pune — 1 lead ==', 'plainTextFromReportOptsGs_: a region band is kept');
    TestAssertEqual_(plainTextFromReportOptsGs_({ title: 'Empty', region: 'Pune', subtitle: 'Nothing today', kpis: [], sections: [] }).indexOf('Lead ID'), -1, 'plainTextFromReportOptsGs_: an empty-state section prints no table header');
    TestAssertContains_(plainTextReportGs_(plainOpts), 'Regards,\nHomesfy Lead Ops', 'plainTextReportGs_: carries the same signature the HTML does');
    const twoPlain = plainTextTwoSectionGs_(plainOpts, { title: 'Checkpoint 1', region: 'Pune', subtitle: 'None', kpis: [], sections: [] });
    TestAssertContains_(twoPlain, 'Section 1 - Overnight Leads', 'plainTextTwoSectionGs_: labels Section 1');
    TestAssertContains_(twoPlain, 'Section 2 - Checkpoint 1', 'plainTextTwoSectionGs_: labels Section 2');
    TestAssertContains_(twoPlain, 'L-100 | Suspect', 'plainTextTwoSectionGs_: lists Section 1\'s leads');
    TestAssertEqual_(twoPlain.split('Regards,').length - 1, 1, 'plainTextTwoSectionGs_: ONE signature for the whole email, not one per section');
    // The HTML and the plain text are rendered from the same opts, so every lead id in the HTML is in the plain text.
    const htmlOfPlainOpts = renderOvernightReportEmailHTML_(plainOpts);
    ['L-100', 'L-101'].forEach(function (id) {
      TestAssert_(htmlOfPlainOpts.indexOf(id) !== -1 && plainText.indexOf(id) !== -1, 'HTML and plain text are built from the same opts: ' + id + ' is in both');
    });

    // ============ 2026-10-05 email audit P6: ambiguous vs definite send errors ============
    TestAssert_(isAmbiguousSendErrorGs_(new Error('Exception: Service Gmail timed out')), 'isAmbiguousSendErrorGs_: a timeout is ambiguous (the message may have been delivered)');
    TestAssert_(isAmbiguousSendErrorGs_(new Error('Request timeout while sending')), 'isAmbiguousSendErrorGs_: "timeout" is ambiguous');
    TestAssert_(isAmbiguousSendErrorGs_(new Error('Internal error encountered')), 'isAmbiguousSendErrorGs_: an internal error is ambiguous');
    TestAssert_(isAmbiguousSendErrorGs_(new Error("We're sorry, a server error occurred. Please wait a bit and try again.")), 'isAmbiguousSendErrorGs_: the platform\'s own "server error occurred" wording is ambiguous');
    TestAssert_(isAmbiguousSendErrorGs_(new Error('Backend Error')), 'isAmbiguousSendErrorGs_: a backend error is ambiguous');
    TestAssert_(isAmbiguousSendErrorGs_(new Error('HTTP 503 Service Unavailable')), 'isAmbiguousSendErrorGs_: a 503 is ambiguous');
    TestAssert_(isAmbiguousSendErrorGs_('Exception: Service Gmail failed while accessing document'), 'isAmbiguousSendErrorGs_: also reads a bare string error');
    TestAssert_(!isAmbiguousSendErrorGs_(new Error('Gmail operation not allowed')), 'isAmbiguousSendErrorGs_: a definitive refusal is NOT ambiguous');
    TestAssert_(!isAmbiguousSendErrorGs_(new Error('Invalid argument: raw')), 'isAmbiguousSendErrorGs_: a bad-argument error is NOT ambiguous');
    TestAssert_(!isAmbiguousSendErrorGs_(new Error('Exception: Service invoked too many times for one day: gmail.')), 'isAmbiguousSendErrorGs_: a quota refusal is NOT ambiguous (nothing was sent)');
    TestAssert_(!isAmbiguousSendErrorGs_(new Error('Exception: Not found')), 'isAmbiguousSendErrorGs_: "Not found" is NOT ambiguous (a lookup miss, nothing was sent)');
    TestAssert_(!isAmbiguousSendErrorGs_(null) && !isAmbiguousSendErrorGs_(undefined), 'isAmbiguousSendErrorGs_: no error is not ambiguous');

    // ============ 2026-10-05 email audit P4: the overlapping-run lock ============
    const lockFree = TestMockLockService_();
    LockService = lockFree;
    let jobRuns = 0;
    TestAssertEqual_(withEmailJobLockGs_('testJob', function () { jobRuns++; }), true, 'withEmailJobLockGs_: returns true when the job ran');
    TestAssertEqual_(jobRuns, 1, 'withEmailJobLockGs_: runs the job exactly once when the lock is free');
    TestAssertEqual_(lockFree._state.tryLockCalls, 1, 'withEmailJobLockGs_: tries the script lock once');
    TestAssertEqual_(lockFree._state.releases, 1, 'withEmailJobLockGs_: releases the lock after a normal run');
    TestAssertEqual_(lockFree._state.held, false, 'withEmailJobLockGs_: the lock is not held afterwards');

    let jobThrew = false;
    try { withEmailJobLockGs_('testJob', function () { throw new Error('job blew up'); }); } catch (e) { jobThrew = /job blew up/.test(e.message); }
    TestAssert_(jobThrew, 'withEmailJobLockGs_: a job error is re-thrown (the Executions list must still show Failed)');
    TestAssertEqual_(lockFree._state.held, false, 'withEmailJobLockGs_: the lock is released even when the job throws');

    // Contention: another job holds the lock -> SKIP + alert, never run.
    const lockDenied = TestMockLockService_({ denyLock: true });
    LockService = lockDenied;
    let ranWhileDenied = false;
    const alertsBeforeDeny = TestGmailLog_.sent.length;
    TestAssertEqual_(withEmailJobLockGs_('overlapJob', function () { ranWhileDenied = true; }), false, 'withEmailJobLockGs_: returns false when another job holds the lock');
    TestAssertEqual_(ranWhileDenied, false, 'withEmailJobLockGs_: does NOT run the job when the lock cannot be acquired — no overlapping sends');
    TestAssertEqual_(lockDenied._state.releases, 0, 'withEmailJobLockGs_: a lock it never acquired is never released');
    TestAssert_(TestGmailLog_.sent.length === alertsBeforeDeny + 1 && /overlapJob SKIPPED/.test(TestGmailLog_.sent[TestGmailLog_.sent.length - 1].subject), 'withEmailJobLockGs_: a skipped job alerts ops, naming the job');

    // FAIL OPEN: the lock SERVICE erroring must never stop the job.
    [{ throwOnGet: true }, { throwOnTryLock: true }].forEach(function (failure) {
      const label = failure.throwOnGet ? 'getScriptLock throws' : 'tryLock throws';
      const lockBroken = TestMockLockService_(failure);
      LockService = lockBroken;
      let ranDespiteError = 0;
      const alertsBeforeBroken = TestGmailLog_.sent.length;
      TestAssertEqual_(withEmailJobLockGs_('brokenLockJob', function () { ranDespiteError++; }), true, 'withEmailJobLockGs_ (' + label + '): the job still runs — a broken lock must never stop the daily emails');
      TestAssertEqual_(ranDespiteError, 1, 'withEmailJobLockGs_ (' + label + '): …exactly once');
      TestAssert_(TestGmailLog_.sent.slice(alertsBeforeBroken).some(function (e) { return /brokenLockJob ran WITHOUT its overlap lock/.test(e.subject); }), 'withEmailJobLockGs_ (' + label + '): ops is alerted that the job ran without its lock');
      TestAssertEqual_(lockBroken._state.releases, 0, 'withEmailJobLockGs_ (' + label + '): nothing was acquired, so nothing is released');
      let brokenJobThrew = false;
      try { withEmailJobLockGs_('brokenLockJob', function () { throw new Error('job blew up too'); }); } catch (e) { brokenJobThrew = /job blew up too/.test(e.message); }
      TestAssert_(brokenJobThrew, 'withEmailJobLockGs_ (' + label + '): a job error is still re-thrown');
    });

    // No LockService at all (an older paste / another runtime): runs the job.
    LockService = undefined;
    jobRuns = 0;
    TestAssertEqual_(withEmailJobLockGs_('noLockSvc', function () { jobRuns++; }), true, 'withEmailJobLockGs_: with no LockService available it still runs the job');
    TestAssertEqual_(jobRuns, 1, 'withEmailJobLockGs_: …exactly once');
    LockService = TestMockLockService_();

    // ============ 2026-10-05 email audit P7 (F10): a retried log append never lands twice ============
    {
      const logRow = function (thread) { return ['2026-10-05', 'Pune', thread, '[]', '10:00', TEST_EMAIL_PRIMARY_, '', 'subject']; };
      const newLog = function () { return TestMockSheet_('Overnight_Log', [['date', 'region', 'thread_id', 'lead_ids_json', 'sent_at', 'to', 'cc', 'subject']]); };
      // Simulates "Sheets wrote the row, THEN the call timed out": the first appendRow call writes and throws a transient error.
      const writeThenTimeOut = function (sheet) {
        const realAppend = sheet.appendRow;
        const state = { calls: 0 };
        sheet.appendRow = function (values) { state.calls++; realAppend(values); if (state.calls === 1) throw new Error('Service Spreadsheets timed out while accessing document'); };
        return state;
      };

      // Normal path: one append, no extra read.
      const plainLog = newLog();
      const realGetRange = plainLog.getRange;
      let reads = 0;
      plainLog.getRange = function () { reads++; return realGetRange.apply(plainLog, arguments); };
      TestAssertEqual_(appendRowOnceGs_(plainLog, logRow('thr-ok'), 2)(), true, 'appendRowOnceGs_: the first attempt appends and reports true');
      TestAssertEqual_(plainLog.getLastRow(), 2, 'appendRowOnceGs_: exactly one row appended');
      TestAssertEqual_(reads, 0, 'appendRowOnceGs_: the normal first-attempt path reads nothing extra from the sheet');

      // The hazard: the append landed, the call still timed out, withRetry_ retries.
      const dupLog = newLog();
      const dupState = writeThenTimeOut(dupLog);
      withRetry_(appendRowOnceGs_(dupLog, logRow('thr-dup'), 2), 'test once-only append');
      TestAssertEqual_(dupState.calls, 1, 'appendRowOnceGs_: after a write that landed before the timeout, the retry does NOT append again');
      TestAssertEqual_(dupLog.getLastRow(), 2, 'appendRowOnceGs_: …so the log holds ONE row, not a duplicate');
      TestAssertEqual_(dupLog.getRange(2, 3, 1, 1).getValues()[0][0], 'thr-dup', 'appendRowOnceGs_: …and it is the right row');

      // The opposite case: the first attempt failed BEFORE writing anything — the retry must still append.
      const lostLog = newLog();
      const realLostAppend = lostLog.appendRow;
      let lostCalls = 0;
      lostLog.appendRow = function (values) { lostCalls++; if (lostCalls === 1) throw new Error('Service Spreadsheets timed out while accessing document'); realLostAppend(values); };
      withRetry_(appendRowOnceGs_(lostLog, logRow('thr-lost'), 2), 'test once-only append (nothing written)');
      TestAssertEqual_(lostCalls, 2, 'appendRowOnceGs_: when the first attempt wrote nothing, the retry appends');
      TestAssertEqual_(lostLog.getLastRow(), 2, 'appendRowOnceGs_: …exactly one row');

      // Other rows on the sheet are not mistaken for this one: with someone else's row already there, the retry still
      // recognises ITS OWN landed row (and only that).
      const mixedLog = newLog();
      mixedLog.appendRow(logRow('thr-someone-else'));
      const mixedState = writeThenTimeOut(mixedLog);
      withRetry_(appendRowOnceGs_(mixedLog, logRow('thr-mine'), 2), 'test once-only append (other rows present)');
      TestAssertEqual_(mixedState.calls, 1, 'appendRowOnceGs_: with another row on the sheet, the retry still finds its own landed row and does not append again');
      TestAssertEqual_(mixedLog.getLastRow(), 3, 'appendRowOnceGs_: …leaving the other row and this one, nothing more');
      // …and a row whose id is NOT yet on the sheet is appended by the retry even though other rows are present.
      const otherLog = newLog();
      otherLog.appendRow(logRow('thr-someone-else'));
      const realOtherAppend = otherLog.appendRow;
      let otherCalls = 0;
      otherLog.appendRow = function (values) { otherCalls++; if (otherCalls === 1) throw new Error('Service Spreadsheets timed out while accessing document'); realOtherAppend(values); };
      withRetry_(appendRowOnceGs_(otherLog, logRow('thr-mine'), 2), 'test once-only append (other rows, nothing written)');
      TestAssertEqual_(otherLog.getLastRow(), 3, 'appendRowOnceGs_: another row\'s thread id never stops THIS row being appended by the retry');

      // The row is also written exactly once when the failure is the flush that follows it (writeUnlessTestModeGs_).
      const flushLog = newLog();
      const realFlush = SpreadsheetApp.flush;
      let flushCalls = 0;
      SpreadsheetApp.flush = function () { flushCalls++; if (flushCalls === 1) throw new Error('Service Spreadsheets timed out while accessing document'); };
      try {
        writeUnlessTestModeGs_(appendRowOnceGs_(flushLog, logRow('thr-flush'), 2), 'test once-only append (flush fails)');
      } finally { SpreadsheetApp.flush = realFlush; }
      TestAssertEqual_(flushLog.getLastRow(), 2, 'appendRowOnceGs_ via writeUnlessTestModeGs_: a flush that fails after the append lands does not duplicate the row');
      TestAssertEqual_(flushCalls, 2, 'appendRowOnceGs_ via writeUnlessTestModeGs_: the wrapper did retry (so the guard was really exercised)');

      // A blank key cannot be matched, so it still appends (no crash, no silent drop).
      const blankLog = newLog();
      appendRowOnceGs_(blankLog, logRow(''), 2)();
      TestAssertEqual_(blankLog.getLastRow(), 2, 'appendRowOnceGs_: a row with a blank key still appends');

      // A first attempt never searches at all: even the same id far up the sheet does not block it (only a RETRY looks, and
      // only in the recent tail).
      const bigLog = newLog();
      bigLog.appendRow(logRow('thr-ancient'));
      for (let i = 0; i < APPEND_ONCE_TAIL_ROWS_ + 5; i++) bigLog.appendRow(logRow('thr-filler-' + i));
      appendRowOnceGs_(bigLog, logRow('thr-ancient'), 2)();
      TestAssertEqual_(bigLog.getLastRow(), APPEND_ONCE_TAIL_ROWS_ + 5 + 2 + 1, 'appendRowOnceGs_: a first attempt appends without searching the sheet');
    }

    // ============ 2026-10-05 email audit P7 (F9): buckets sharing an address become one ============
    {
      const A = { to: 'a@x.com', cc: 'b@x.com,Boss@x.com', rmNames: ['RM 1'], source: 'S-A', bucketLabel: 'Label A', primaryRole: 'A1' };
      const B = { to: 'A@X.com ', cc: 'boss@x.com, c@x.com,a@x.com', rmNames: ['RM 2', 'RM 1'], source: 'S-B', bucketLabel: 'Unmatched RMs', primaryRole: '' };
      const C = { to: 'other@x.com', cc: undefined, rmNames: ['RM 3'], source: 'S-C', bucketLabel: 'Label C', primaryRole: 'TM' };
      const merged = mergeBucketsByAddressGs_([A, C, B]);
      TestAssertEqual_(merged.length, 2, 'mergeBucketsByAddressGs_: two buckets on the same address (case/space-insensitive) become one; a different address stays separate');
      TestAssertEqual_(merged[0].bucketLabel, 'Label A', 'mergeBucketsByAddressGs_: the first bucket keeps its label');
      TestAssertEqual_(merged[0].primaryRole, 'A1', 'mergeBucketsByAddressGs_: …and its role');
      TestAssertEqual_(merged[0].rmNames.join(','), 'RM 1,RM 2', 'mergeBucketsByAddressGs_: RM names are the union, with no repeat');
      TestAssertEqual_(merged[0].cc, 'b@x.com,Boss@x.com,c@x.com', 'mergeBucketsByAddressGs_: Cc is the union, never repeats an address, never includes the To address');
      TestAssertEqual_(merged[0].source, 'S-A + S-B', 'mergeBucketsByAddressGs_: source shows both origins');
      TestAssertEqual_(merged[1].to, 'other@x.com', 'mergeBucketsByAddressGs_: order preserved — the separate bucket follows');
      TestAssertEqual_(A.rmNames.join(','), 'RM 1', 'mergeBucketsByAddressGs_: the input buckets are not modified');
      TestAssertEqual_(mergeBucketsByAddressGs_([{ to: 'a@x.com', cc: undefined, rmNames: ['R1'], source: 's1' }, { to: 'a@x.com', cc: '', rmNames: ['R2'], source: 's2' }])[0].cc, undefined, 'mergeBucketsByAddressGs_: no Cc anywhere stays undefined');
      TestAssertEqual_(mergeBucketsByAddressGs_([{ to: '', rmNames: ['R1'], source: 'a' }, { to: '  ', rmNames: ['R2'], source: 'b' }]).length, 2, 'mergeBucketsByAddressGs_: buckets with NO address are never merged together (the send gate reports them)');

      // Through the real resolver: Test RM One (A1 -> TEST_EMAIL_PRIMARY_) + Test RM Three (TM -> the SAME address).
      const sameAddr = resolveRecipientEmailsForRegion_(ss, 'Test Region', ['Test RM One', 'Test RM Three'], {}, { fireAlerts: false });
      TestAssertEqual_(sameAddr.results.length, 1, 'resolveRecipientEmailsForRegion_: an A1 bucket and a TM bucket on the same address come back as ONE bucket');
      TestAssertEqual_(sameAddr.results[0].rmNames.slice().sort().join(','), 'Test RM One,Test RM Three', 'resolveRecipientEmailsForRegion_: the merged bucket carries BOTH RMs (the second used to overwrite the first)');
      // A Region_Recipients fallback equal to an A1's address (the audit's own example), in a different case.
      const withFallback = resolveRecipientEmailsForRegion_(ss, 'Pune', ['Test RM One', 'Some Totally Unknown RM'], { Pune: { to: TEST_EMAIL_PRIMARY_.toUpperCase(), cc: '' } }, { fireAlerts: false });
      TestAssertEqual_(withFallback.results.length, 1, 'resolveRecipientEmailsForRegion_: a Region_Recipients fallback on an A1\'s own address merges into that A1\'s bucket');
      TestAssertEqual_(withFallback.results[0].rmNames.slice().sort().join(','), 'Some Totally Unknown RM,Test RM One', 'resolveRecipientEmailsForRegion_: …carrying the unmatched RM too');
      // Control: a different fallback address keeps two buckets.
      const separate = resolveRecipientEmailsForRegion_(ss, 'Pune', ['Test RM One', 'Some Totally Unknown RM'], { Pune: { to: TEST_EMAIL_SECONDARY_, cc: '' } }, { fireAlerts: false });
      TestAssertEqual_(separate.results.length, 2, 'resolveRecipientEmailsForRegion_: buckets on DIFFERENT addresses are still separate');
    }

    // ============ 2026-10-05 email audit P9 (F21): the ops alert retries, then falls back to a second send path ============
    {
      const realGmailApp = GmailApp, realGmail = Gmail;
      const sleeps = [];
      const realSleep = Utilities.sleep;
      Utilities.sleep = function (ms) { sleeps.push(ms); };
      const decodeRaw = function (raw) { return TestOE_decodeRawMime_(raw); };
      try {
        // Normal: one GmailApp send, nothing else.
        const sentBefore = TestGmailLog_.sent.length, repliesBefore = TestGmailLog_.threadReplies.length;
        TestAssertEqual_(notifyOpsAlertGs_('plain subject', ['line one', 'line two']), true, 'notifyOpsAlertGs_: reports true when GmailApp sent it');
        TestAssertEqual_(TestGmailLog_.sent.length, sentBefore + 1, 'notifyOpsAlertGs_: exactly one alert on the normal path');
        TestAssertEqual_(TestGmailLog_.sent[TestGmailLog_.sent.length - 1].subject, '[Overnight Emailer] plain subject', 'notifyOpsAlertGs_: subject keeps its prefix');
        TestAssertEqual_(TestGmailLog_.sent[TestGmailLog_.sent.length - 1].body, 'line one\nline two', 'notifyOpsAlertGs_: body is the joined lines');
        TestAssertEqual_(TestGmailLog_.threadReplies.length, repliesBefore, 'notifyOpsAlertGs_: the second path is not touched when the first works');

        // One transient failure: the retry delivers it (after a pause), once.
        let sendCalls = 0;
        GmailApp = { sendEmail: function (to, subject, body) { sendCalls++; if (sendCalls === 1) throw new Error('Service error: Gmail'); TestGmailLog_.sent.push({ to: to, subject: subject, body: body, cc: '' }); } };
        sleeps.length = 0;
        const sentBeforeRetry = TestGmailLog_.sent.length;
        TestAssertEqual_(notifyOpsAlertGs_('retry me', ['x']), true, 'notifyOpsAlertGs_: a single transient failure is retried and succeeds');
        TestAssertEqual_(sendCalls, 2, 'notifyOpsAlertGs_: GmailApp was tried exactly twice');
        TestAssertEqual_(TestGmailLog_.sent.length, sentBeforeRetry + 1, 'notifyOpsAlertGs_: the alert went out once');
        TestAssertEqual_(sleeps[0], 3000, 'notifyOpsAlertGs_: it paused 3 seconds between attempts');

        // GmailApp keeps failing: the Advanced Gmail Service carries the alert. The em dash is sent as an encoded word.
        GmailApp = { sendEmail: function () { throw new Error('Service error: Gmail'); } };
        const repliesBeforeFallback = TestGmailLog_.threadReplies.length;
        TestAssertEqual_(notifyOpsAlertGs_('sendOvernightFollowupEmails crashed — NO 1pm follow-up emails were sent this run', ['the body']), true, 'notifyOpsAlertGs_: falls back to the Advanced Gmail Service when GmailApp keeps failing');
        TestAssertEqual_(TestGmailLog_.threadReplies.length, repliesBeforeFallback + 1, 'notifyOpsAlertGs_: exactly one message went by the second path');
        const fallbackMime = decodeRaw(TestGmailLog_.threadReplies[TestGmailLog_.threadReplies.length - 1].raw);
        TestAssertContains_(fallbackMime, 'To: ' + OPS_ALERT_EMAIL_, 'notifyOpsAlertGs_ (second path): addressed to the ops address');
        TestAssertContains_(fallbackMime, 'Subject: =?UTF-8?B?', 'notifyOpsAlertGs_ (second path): a non-ASCII subject (the em dash) is sent as an RFC 2047 encoded word');
        TestAssertContains_(fallbackMime, 'the body', 'notifyOpsAlertGs_ (second path): carries the body');
        TestAssert_(!/\r\n\r\n.*\r\nSubject:/.test(fallbackMime), 'notifyOpsAlertGs_ (second path): no header ends up in the body');

        // A plain-ASCII subject stays readable (no encoding).
        notifyOpsAlertGs_('ascii only', ['b']);
        TestAssertContains_(decodeRaw(TestGmailLog_.threadReplies[TestGmailLog_.threadReplies.length - 1].raw), 'Subject: [Overnight Emailer] ascii only', 'notifyOpsAlertGs_ (second path): an ASCII subject is sent as-is');

        // A line break smuggled into a subject cannot start a new header.
        notifyOpsAlertGs_('bad\r\nBcc: attacker@example.com', ['b']);
        const injectedMime = decodeRaw(TestGmailLog_.threadReplies[TestGmailLog_.threadReplies.length - 1].raw);
        TestAssert_(!/\r\nBcc:/.test(injectedMime), 'notifyOpsAlertGs_ (second path): a line break in the subject never becomes a header');
        TestAssertContains_(injectedMime, 'Subject: [Overnight Emailer] bad Bcc: attacker@example.com\r\n', 'notifyOpsAlertGs_ (second path): …the line break is collapsed to a space, so the subject stays ONE plain line (not merely hidden inside an encoded word)');

        // Everything fails: no throw (an alert must never take down the job it reports on), and the caller is told.
        Gmail = { Users: { Messages: { send: function () { throw new Error('Gmail API down'); } } } };
        let alertThrew = false, bothFailed = null;
        try { bothFailed = notifyOpsAlertGs_('nothing works', ['b']); } catch (e) { alertThrew = true; }
        TestAssert_(!alertThrew, 'notifyOpsAlertGs_: when every path fails it still does not throw');
        TestAssertEqual_(bothFailed, false, 'notifyOpsAlertGs_: …and returns false');

        // No Advanced Service at all.
        Gmail = undefined;
        let noGmailThrew = false;
        try { TestAssertEqual_(notifyOpsAlertGs_('no advanced service', ['b']), false, 'notifyOpsAlertGs_: with GmailApp failing and no Advanced Service it returns false'); } catch (e) { noGmailThrew = true; }
        TestAssert_(!noGmailThrew, 'notifyOpsAlertGs_: …without throwing');
      } finally { GmailApp = realGmailApp; Gmail = realGmail; Utilities.sleep = realSleep; }

      // istStampGs_: the log-stamp format, in IST.
      TestAssertEqual_(istStampGs_(new Date('2026-10-05T07:30:00Z')), '2026-10-05 13:00:00', 'istStampGs_: formats a given moment in IST');
      TestAssert_(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(istStampGs_()), 'istStampGs_: with no argument it stamps the current moment in the same format');
    }

    // ============ 2026-10-05 email audit P9 (F21/F20): job run records, the completion watchdog, test-mode alert ============
    {
      const realProps = PropertiesService;
      const realLock = LockService;
      const todayDay = '2026-10-05';
      const at = function (hhmm) { return new Date('2026-10-05T' + hhmm + ':00+05:30'); };
      const iso = function (hhmm) { return at(hhmm).toISOString(); };
      const rec = function (job, r) { writeEmailJobRunGs_(job, Object.assign({ day: todayDay }, r)); };
      const M = 'sendOvernightMorningEmails', F = 'sendOvernightFollowupEmails', A = 'sendAllIssuesEmails';
      const kinds = function (ps) { return ps.map(function (p) { return p.job + ':' + p.kind; }).sort().join(','); };
      try {
        // ---- the run record itself (through withEmailJobLockGs_) ----
        PropertiesService = TestMockPropertiesService_();
        LockService = TestMockLockService_();
        let sawRunning = null;
        withEmailJobLockGs_(M, function () { sawRunning = readEmailJobRunGs_(M); });
        TestAssertEqual_(sawRunning && sawRunning.status, 'running', 'run record: while the job body runs, its record says running');
        const done = readEmailJobRunGs_(M);
        TestAssert_(done.status === 'completed' && done.day === istDayKeyGs_(new Date()) && !!done.finishedAt, 'run record: after the body returns, the record says completed, with the IST day and a finish time');
        TestAssertEqual_(readEmailJobRunGs_(F), null, 'run record: a job that has not run has no record (null)');

        let failedThrew = false;
        try { withEmailJobLockGs_(F, function () { throw new Error('body blew up'); }); } catch (e) { failedThrew = /body blew up/.test(e.message); }
        TestAssert_(failedThrew, 'run record: a failing body is re-thrown unchanged');
        const failedRec = readEmailJobRunGs_(F);
        TestAssert_(failedRec.status === 'failed' && /body blew up/.test(failedRec.error), 'run record: …and recorded as failed with its error');

        // Skipped because another job holds the lock: no record is written (the job did not run).
        PropertiesService = TestMockPropertiesService_();
        LockService = TestMockLockService_({ denyLock: true });
        withEmailJobLockGs_(A, function () { throw new Error('must not run'); });
        TestAssertEqual_(readEmailJobRunGs_(A), null, 'run record: a job skipped for the lock writes no record');

        // Fail-open paths still record.
        [{ throwOnGet: true }, { throwOnTryLock: true }].forEach(function (failure) {
          PropertiesService = TestMockPropertiesService_();
          LockService = TestMockLockService_(failure);
          withEmailJobLockGs_(M, function () {});
          TestAssertEqual_(readEmailJobRunGs_(M).status, 'completed', 'run record: a job that runs because the lock service is broken is still recorded');
        });
        PropertiesService = TestMockPropertiesService_();
        LockService = undefined;
        withEmailJobLockGs_(M, function () {});
        TestAssertEqual_(readEmailJobRunGs_(M).status, 'completed', 'run record: with no LockService the job is still recorded');
        LockService = realLock;

        // A broken Properties service never stops a job.
        [{ failWrites: true }, { failReads: true }].forEach(function (opts) {
          PropertiesService = TestMockPropertiesService_(opts);
          let ran = 0;
          let threw = false;
          try { withEmailJobLockGs_(M, function () { ran++; }); } catch (e) { threw = true; }
          TestAssert_(ran === 1 && !threw, 'run record: a broken Properties service (' + Object.keys(opts)[0] + ') neither stops nor changes the job');
        });
        PropertiesService = undefined;
        let ranNoProps = 0;
        withEmailJobLockGs_(M, function () { ranNoProps++; });
        TestAssertEqual_(ranNoProps, 1, 'run record: with no PropertiesService at all the job still runs');

        // ---- emailJobProblemsGs_: what is wrong at a given moment ----
        PropertiesService = TestMockPropertiesService_();
        TestAssertEqual_(kinds(emailJobProblemsGs_(at('09:00'))), '', 'watchdog: before any job is due, nothing is wrong (even with no records at all)');
        TestAssertEqual_(kinds(emailJobProblemsGs_(at('10:29'))), '', 'watchdog: one minute before the 10:00 job\'s 10:30 deadline, nothing is wrong');
        TestAssertEqual_(kinds(emailJobProblemsGs_(at('10:30'))), M + ':never_started', 'watchdog: at the deadline, a job with no record for today never started');
        TestAssertEqual_(kinds(emailJobProblemsGs_(at('13:29'))), M + ':never_started', 'watchdog: the 13:00 job is not due until 13:30');
        // The 16:30 cycle report (CycleReport.gs) is a fourth scheduled job once that file is part of the project; its own deadline (17:00) is tested in Tests_CycleReport.gs.
        TestAssertEqual_(kinds(emailJobProblemsGs_(at('18:00'))), A + ':never_started,sendEmailCycleReport:never_started,' + F + ':never_started,' + M + ':never_started', 'watchdog: after 17:30 all three missing email jobs and the 16:30 cycle report are reported');
        const nev = emailJobProblemsGs_(at('10:31'))[0];
        TestAssert_(/10:30 IST/.test(nev.detail) && /10:00 Overnight/.test(nev.detail), 'watchdog: the message names the job and its deadline');

        rec(M, { startedAt: iso('10:03'), finishedAt: iso('10:07'), status: 'completed' });
        TestAssertEqual_(kinds(emailJobProblemsGs_(at('10:31'))), '', 'watchdog: a completed run is fine — even when it had nothing to send');
        writeEmailJobRunGs_(M, { day: '2026-10-04', startedAt: '2026-10-04T04:33:00.000Z', finishedAt: '2026-10-04T04:37:00.000Z', status: 'completed' });
        TestAssertEqual_(kinds(emailJobProblemsGs_(at('10:31'))), M + ':never_started', 'watchdog: yesterday\'s completed run does not count for today');

        rec(M, { startedAt: iso('10:03'), status: 'running' });
        TestAssertEqual_(kinds(emailJobProblemsGs_(at('10:31'))), '', 'watchdog: a run that started 28 minutes ago is still running, not stuck');
        TestAssertEqual_(kinds(emailJobProblemsGs_(at('10:38'))), '', 'watchdog: …still fine at 35 minutes');
        TestAssertEqual_(kinds(emailJobProblemsGs_(at('10:39'))), M + ':stuck', 'watchdog: a run still "running" past the 30-minute execution cap died (timeout / platform error)');
        TestAssert_(/10:03:00 IST/.test(emailJobProblemsGs_(at('10:50'))[0].detail), 'watchdog: the stuck message says when the run started');

        rec(F, { startedAt: iso('13:01'), finishedAt: iso('13:03'), status: 'failed', error: 'We\'re sorry, a server error occurred.' });
        const fl = emailJobProblemsGs_(at('13:31')).filter(function (p) { return p.job === F; })[0];
        TestAssert_(!!fl && fl.kind === 'failed' && /server error occurred/.test(fl.detail), 'watchdog: a run that ended in an error is reported with its error text');

        // An unreadable record is its own problem — not "never ran".
        PropertiesService = TestMockPropertiesService_({ failReads: true });
        TestAssertEqual_(kinds(emailJobProblemsGs_(at('10:31'))), M + ':unreadable', 'watchdog: a failing Properties service reports "unreadable", not "never started"');
        PropertiesService = undefined;
        TestAssertEqual_(kinds(emailJobProblemsGs_(at('10:31'))), M + ':unreadable', 'watchdog: no PropertiesService at all is "unreadable" too');

        // ---- checkEmailJobsCompletedGs_: alerts once per job/day/kind ----
        PropertiesService = TestMockPropertiesService_();
        const alertsOf = function (fn) { const before = TestGmailLog_.sent.length; const r = fn(); return { result: r, alerts: TestGmailLog_.sent.slice(before) }; };
        const first = alertsOf(function () { return checkEmailJobsCompletedGs_(at('10:35')); });
        TestAssertEqual_(first.alerts.length, 1, 'watchdog: a job that never started produces exactly one alert');
        TestAssertContains_(first.alerts[0].subject, 'WATCHDOG: sendOvernightMorningEmails did not run', 'watchdog: the alert subject names the job and the problem');
        TestAssertContains_(first.alerts[0].body, 'sendOvernightMorningEmailsNow', 'watchdog: the alert says what to run by hand');
        TestAssertEqual_(first.result.length, 1, 'watchdog: it returns the problems it found');
        const second = alertsOf(function () { return checkEmailJobsCompletedGs_(at('11:35')); });
        TestAssertEqual_(second.alerts.length, 0, 'watchdog: an hourly re-check does NOT repeat the same alert the same day');
        TestAssertEqual_(second.result.length, 1, 'watchdog: …though it still reports the problem');
        // The kind changes (the job started but never finished) -> a new alert.
        rec(M, { startedAt: iso('11:00'), status: 'running' });
        const third = alertsOf(function () { return checkEmailJobsCompletedGs_(at('11:50')); });
        TestAssertEqual_(third.alerts.length, 1, 'watchdog: a DIFFERENT problem for the same job (now stuck) alerts again');
        TestAssertContains_(third.alerts[0].subject, 'did not finish', 'watchdog: …naming it as a job that did not finish');
        // A manual re-run fixes it -> silence.
        rec(M, { startedAt: iso('12:00'), finishedAt: iso('12:04'), status: 'completed' });
        TestAssertEqual_(alertsOf(function () { return checkEmailJobsCompletedGs_(at('12:35')); }).alerts.length, 0, 'watchdog: once the job has been re-run and completed, the watchdog is silent');
        // A new day re-arms the alert.
        PropertiesService = TestMockPropertiesService_();
        checkEmailJobsCompletedGs_(at('10:35'));
        const nextDay = alertsOf(function () { return checkEmailJobsCompletedGs_(new Date('2026-10-06T10:35:00+05:30')); });
        TestAssertEqual_(nextDay.alerts.length, 1, 'watchdog: the next day\'s missing run alerts again (the dedupe is per day)');
        // A failed run is reported once even though the job sent its own alert (that alert may not have arrived).
        PropertiesService = TestMockPropertiesService_();
        rec(F, { startedAt: iso('13:01'), finishedAt: iso('13:03'), status: 'failed', error: 'boom' });
        rec(M, { startedAt: iso('10:03'), finishedAt: iso('10:07'), status: 'completed' });
        const failAlerts = alertsOf(function () { return checkEmailJobsCompletedGs_(at('13:40')); });
        TestAssertEqual_(failAlerts.alerts.length, 1, 'watchdog: a failed run is alerted once');
        TestAssertContains_(failAlerts.alerts[0].subject, 'sendOvernightFollowupEmails failed', 'watchdog: …as a failure');
        // Unreadable alerts every time (the dedupe record cannot be trusted).
        PropertiesService = TestMockPropertiesService_({ failReads: true });
        const u1 = alertsOf(function () { return checkEmailJobsCompletedGs_(at('10:35')); });
        const u2 = alertsOf(function () { return checkEmailJobsCompletedGs_(at('10:36')); });
        TestAssert_(u1.alerts.length === 1 && u2.alerts.length === 1, 'watchdog: an unreadable record alerts on every check');
        TestAssertContains_(u1.alerts[0].subject, 'cannot be checked', 'watchdog: …saying it cannot be checked');

        // ---- the Movement_Log snapshot job shares the watchdog (email audit F23) ----
        // snapshotPeriodic runs 4x a day, its snapshots are the "calls so far today" baseline behind every email, and it hit the
        // 30-minute wall three times in five days with nothing noticing. snapshotRunProblemsGs_ (MovementTracker.gs) reads its run
        // record; checkEmailJobsCompletedGs_ alerts once per RUN (not once per day).
        const S = 'snapshotPeriodic';
        PropertiesService = TestMockPropertiesService_();
        TestAssertEqual_(kinds(snapshotRunProblemsGs_(at('12:00'))), '', 'snapshot watchdog: no run record at all (not deployed yet) is not a problem');
        rec(S, { startedAt: iso('06:08'), status: 'running' });
        TestAssertEqual_(kinds(snapshotRunProblemsGs_(at('06:40'))), '', 'snapshot watchdog: a run 32 minutes in is still running');
        TestAssertEqual_(kinds(snapshotRunProblemsGs_(at('06:43'))), '', 'snapshot watchdog: …and at 35 minutes');
        TestAssertEqual_(kinds(snapshotRunProblemsGs_(at('06:44'))), S + ':stuck', 'snapshot watchdog: still "running" past 35 minutes means the platform killed it (the 30-minute wall)');
        TestAssert_(/06:08 IST/.test(snapshotRunProblemsGs_(at('06:50'))[0].detail), 'snapshot watchdog: the stuck message says when that run started');
        rec(S, { startedAt: iso('06:08'), finishedAt: iso('06:09'), status: 'failed', error: 'Exception: boom' });
        const sFailed = snapshotRunProblemsGs_(at('06:30'))[0];
        TestAssert_(sFailed.kind === 'failed' && /Exception: boom/.test(sFailed.detail), 'snapshot watchdog: a failed run is reported with its error text');
        rec(S, { startedAt: iso('06:08'), finishedAt: iso('06:20'), status: 'completed', totalSeconds: 700, skipped: [] });
        TestAssertEqual_(kinds(snapshotRunProblemsGs_(at('07:00'))), '', 'snapshot watchdog: a clean completed run is fine');
        TestAssertEqual_(kinds(snapshotRunProblemsGs_(at('14:08'))), '', 'snapshot watchdog: …and 8 hours later, still inside the 8-hour grace window');
        TestAssertEqual_(kinds(snapshotRunProblemsGs_(at('14:09'))), S + ':overdue', 'snapshot watchdog: no new run for more than 8 hours means a scheduled run did not happen');
        rec(S, { startedAt: iso('06:08'), finishedAt: iso('06:22'), status: 'completed', totalSeconds: 850, skipped: ['Movement_Log prune', 'Daily_Cohort_History persist'] });
        const sSkipped = snapshotRunProblemsGs_(at('07:00'));
        TestAssertEqual_(kinds(sSkipped), S + ':degraded', 'snapshot watchdog: a run that skipped phases to stay inside its time budget is reported');
        TestAssert_(/Movement_Log prune, Daily_Cohort_History persist/.test(sSkipped[0].detail) && /850s/.test(sSkipped[0].detail), 'snapshot watchdog: …naming the skipped phases and the run time');
        rec(S, { startedAt: iso('06:08'), status: 'running' });
        TestAssertEqual_(snapshotRunProblemsGs_(at('16:00')).length, 1, 'snapshot watchdog: a record that is BOTH stuck and overdue is one problem, not two (two would re-alert each other every hour)');
        TestAssertEqual_(snapshotRunProblemsGs_(at('16:00'))[0].kind, 'stuck', 'snapshot watchdog: …and stuck is the one reported');
        PropertiesService = TestMockPropertiesService_({ failReads: true });
        TestAssertEqual_(snapshotRunProblemsGs_(at('12:00')).length, 0, 'snapshot watchdog: an unreadable Properties service is left to the email-job check (no duplicate alert)');

        PropertiesService = TestMockPropertiesService_();
        rec(S, { startedAt: iso('00:18'), status: 'running' });
        const snap1 = alertsOf(function () { return checkEmailJobsCompletedGs_(at('01:00')); });
        TestAssertEqual_(snap1.alerts.length, 1, 'snapshot watchdog: a stuck snapshot produces exactly one alert');
        TestAssertContains_(snap1.alerts[0].subject, 'WATCHDOG: snapshotPeriodic did not finish', 'snapshot watchdog: the alert subject names the job and the problem');
        TestAssertContains_(snap1.alerts[0].body, 'snapshotNow', 'snapshot watchdog: the alert says how to capture right now (its own hint, not the email jobs\' "run <job>Now")');
        TestAssertEqual_(alertsOf(function () { return checkEmailJobsCompletedGs_(at('02:00')); }).alerts.length, 0, 'snapshot watchdog: the hourly re-check does not repeat the alert for the SAME run');
        rec(S, { startedAt: iso('06:08'), status: 'running' });
        TestAssertEqual_(alertsOf(function () { return checkEmailJobsCompletedGs_(at('06:50')); }).alerts.length, 1, 'snapshot watchdog: the NEXT run getting stuck alerts again the same day (marker is per run, not per day)');

        // ---- the trigger entry point never throws ----
        PropertiesService = TestMockPropertiesService_();
        const realProblems = emailJobProblemsGs_;
        emailJobProblemsGs_ = function () { throw new Error('watchdog bug'); };
        const wdBefore = TestGmailLog_.sent.length;
        let wdThrew = false;
        try { emailJobWatchdog(); } catch (e) { wdThrew = true; } finally { emailJobProblemsGs_ = realProblems; }
        TestAssert_(!wdThrew, 'emailJobWatchdog: never throws into the platform');
        TestAssert_(TestGmailLog_.sent.slice(wdBefore).some(function (e) { return /WATCHDOG itself failed/.test(e.subject); }), 'emailJobWatchdog: if the check itself breaks, ops are told');
        emailJobWatchdogNow();
        showEmailJobRunsNow();
        TestAssert_(true, 'emailJobWatchdogNow / showEmailJobRunsNow run without error');
      } finally {
        PropertiesService = realProps;
        LockService = TestMockLockService_();
        PropertiesService = TestMockPropertiesService_();
      }

      // ---- setupEmailJobWatchdogTrigger: ONE hourly trigger; re-running replaces only its own ----
      const realScriptApp = ScriptApp;
      ScriptApp = TestMockScriptApp_(['emailJobWatchdog', 'sendAllIssuesEmails']);
      try {
        setupEmailJobWatchdogTrigger();
        const st = ScriptApp._state;
        TestAssertEqual_(st.created.length, 1, 'setupEmailJobWatchdogTrigger: installs exactly ONE trigger');
        TestAssertEqual_(st.created[0].fnName, 'emailJobWatchdog', 'setupEmailJobWatchdogTrigger: for emailJobWatchdog');
        TestAssertEqual_(st.created[0].type, 'timeBased', 'setupEmailJobWatchdogTrigger: a time-based trigger');
        TestAssertEqual_(st.created[0].everyHours, 1, 'setupEmailJobWatchdogTrigger: every hour');
        TestAssertEqual_(st.deleted.join(','), 'emailJobWatchdog', 'setupEmailJobWatchdogTrigger: deletes its OWN earlier trigger (so a re-run never leaves two) and nothing else');
      } finally { ScriptApp = realScriptApp; }

      // ---- the job schedule the watchdog checks ----
      const sch = emailJobScheduleGs_();
      TestAssertEqual_(sch.sendOvernightMorningEmails.hour + ',' + sch.sendOvernightFollowupEmails.hour + ',' + sch.sendAllIssuesEmails.hour, '10,13,17', 'emailJobScheduleGs_: the three jobs are watched at 10, 13 and 17 (the 17:00 hour follows ALL_ISSUES_RUN_HOUR_)');
    }

    // ============ 2026-10-05 email audit P10 (F11): a CH-level report is sent once per day per region + CH ============
    {
      const realProps = PropertiesService;
      try {
        PropertiesService = TestMockPropertiesService_();
        const O = CH_REPORT_KINDS_.overnight, A = CH_REPORT_KINDS_.allIssues;
        const storedKeys = function (kind) { const raw = PropertiesService.getScriptProperties().getProperty('EMAIL_CH_REPORTS_' + kind); return raw ? JSON.parse(raw) : null; };
        TestAssertEqual_(wasChReportSentTodayGs_(O, 'Pune', 'Test CH Self'), false, 'CH report record: nothing has been sent yet today');
        TestAssertEqual_(markChReportSentGs_(O, 'Pune', 'Test CH Self'), true, 'CH report record: marking a sent report reports success');
        TestAssertEqual_(wasChReportSentTodayGs_(O, 'Pune', 'Test CH Self'), true, 'CH report record: …and it is then remembered');
        TestAssertEqual_(wasChReportSentTodayGs_(O, '  pune ', 'TEST CH SELF'), true, 'CH report record: matching ignores case and surrounding spaces');
        TestAssertEqual_(wasChReportSentTodayGs_(O, 'Thane', 'Test CH Self'), false, 'CH report record: a different region is not covered');
        TestAssertEqual_(wasChReportSentTodayGs_(O, 'Pune', 'Another CH'), false, 'CH report record: a different CH is not covered');
        TestAssertEqual_(wasChReportSentTodayGs_(A, 'Pune', 'Test CH Self'), false, 'CH report record: the 17:00 issues report is tracked separately from the 10:00 overnight one');
        markChReportSentGs_(O, 'Pune', 'Test CH Self');
        TestAssertEqual_(storedKeys(O).keys.length, 1, 'CH report record: marking the same report twice stores one key, not two');
        TestAssertEqual_(storedKeys(O).day, istDayKeyGs_(new Date()), 'CH report record: the record carries today\'s IST day');
        markChReportSentGs_(O, 'Thane', 'Test CH Self');
        TestAssertEqual_(storedKeys(O).keys.length, 2, 'CH report record: a second region adds a second key');

        // A new day starts clean, and the old day's keys are dropped (the record never grows).
        PropertiesService.getScriptProperties().setProperty('EMAIL_CH_REPORTS_' + O, JSON.stringify({ day: '2026-01-01', keys: ['pune|test ch self', 'thane|test ch self'] }));
        TestAssertEqual_(wasChReportSentTodayGs_(O, 'Pune', 'Test CH Self'), false, 'CH report record: yesterday\'s report does not suppress today\'s');
        markChReportSentGs_(O, 'Pune', 'Test CH Self');
        const rolled = storedKeys(O);
        TestAssert_(rolled.day === istDayKeyGs_(new Date()) && rolled.keys.length === 1, 'CH report record: the first mark of a new day REPLACES the old day\'s keys');

        // Fails OPEN: a damaged or unavailable record never withholds a report.
        PropertiesService.getScriptProperties().setProperty('EMAIL_CH_REPORTS_' + O, '{not json');
        let threwOnJunk = false, junkSeen = null;
        try { junkSeen = wasChReportSentTodayGs_(O, 'Pune', 'Test CH Self'); } catch (e) { threwOnJunk = true; }
        TestAssert_(!threwOnJunk && junkSeen === false, 'CH report record: an unreadable record reads as "not sent yet" (the report goes out) and never throws');
        TestAssertEqual_(markChReportSentGs_(O, 'Pune', 'Test CH Self'), true, 'CH report record: …and the next mark repairs it');
        TestAssertEqual_(wasChReportSentTodayGs_(O, 'Pune', 'Test CH Self'), true, 'CH report record: …so it is remembered again');
        PropertiesService = TestMockPropertiesService_({ failWrites: true });
        let threwOnWrite = false, wrote = null;
        try { wrote = markChReportSentGs_(O, 'Pune', 'Test CH Self'); } catch (e) { threwOnWrite = true; }
        TestAssert_(!threwOnWrite && wrote === false, 'CH report record: a failing Properties write returns false and never throws');
        TestAssertEqual_(wasChReportSentTodayGs_(O, 'Pune', 'Test CH Self'), false, 'CH report record: …and the report is simply not remembered');
        PropertiesService = TestMockPropertiesService_({ failReads: true });
        TestAssertEqual_(wasChReportSentTodayGs_(O, 'Pune', 'Test CH Self'), false, 'CH report record: a failing Properties read means "not sent yet"');
        PropertiesService = undefined;
        TestAssert_(wasChReportSentTodayGs_(O, 'Pune', 'Test CH Self') === false && markChReportSentGs_(O, 'Pune', 'Test CH Self') === false, 'CH report record: with no PropertiesService at all it is inert (never throws)');

        // TEST MODE neither reads nor writes the record.
        PropertiesService = TestMockPropertiesService_();
        markChReportSentGs_(O, 'Pune', 'Test CH Self');
        TEST_MODE_OVERRIDE_EMAIL_ = TEST_EMAIL_SECONDARY_;
        try {
          TestAssertEqual_(wasChReportSentTodayGs_(O, 'Pune', 'Test CH Self'), false, 'CH report record (TEST MODE): a production record never suppresses a test send');
          TestAssertEqual_(markChReportSentGs_(O, 'Thane', 'Test CH Self'), false, 'CH report record (TEST MODE): a test send is never recorded');
        } finally { TEST_MODE_OVERRIDE_EMAIL_ = ''; }
        TestAssertEqual_(wasChReportSentTodayGs_(O, 'Thane', 'Test CH Self'), false, 'CH report record (TEST MODE): …so nothing from the test run is in the record afterwards');
      } finally { PropertiesService = realProps; PropertiesService = TestMockPropertiesService_(); }
    }

    // ============ 2026-10-07 email audit P13 (F24): corporate addresses come from the PRIVATE employee table, not this public repo ============
    {
      // The committed defaults are blank/null — TestEnv_setUp_ saved the REAL values before overriding them, so this asserts the
      // source itself no longer carries an address.
      const real = TestEnv_realGlobals_;
      TestAssertEqual_(real.OPS_ALERT_EMAIL_, '', 'public repo: the committed OPS_ALERT_EMAIL_ is blank (looked up by name at run time)');
      TestAssertEqual_(real.CH_LEVEL_EMAIL_, '', 'public repo: the committed CH_LEVEL_EMAIL_ is blank');
      TestAssertEqual_(real.FUTWORK_ROUTE_EMAIL_, '', 'public repo: the committed FUTWORK_ROUTE_EMAIL_ is blank');
      TestAssertEqual_(real.ALWAYS_CC_EMAILS_, null, 'public repo: the committed ALWAYS_CC_EMAILS_ is null (names only, resolved at run time)');
      TestAssertEqual_(real.LEADERSHIP_NAME_TO_EMAIL_, null, 'public repo: the committed LEADERSHIP_NAME_TO_EMAIL_ is null');

      const saved = {
        ops: OPS_ALERT_EMAIL_, ch: CH_LEVEL_EMAIL_, fw: FUTWORK_ROUTE_EMAIL_, cc: ALWAYS_CC_EMAILS_, lead: LEADERSHIP_NAME_TO_EMAIL_,
        lookup: lookupEmployeeEmail_, ss: SpreadsheetApp,
      };
      // A stand-in for the private employee table: name -> address (the real lookup normalises names the same way, case-insensitively).
      let table = {};
      const setTable = function (t) { table = {}; Object.keys(t).forEach(function (k) { table[k.toLowerCase()] = t[k]; }); };
      const blankOverrides = function () { OPS_ALERT_EMAIL_ = ''; CH_LEVEL_EMAIL_ = ''; FUTWORK_ROUTE_EMAIL_ = ''; ALWAYS_CC_EMAILS_ = null; LEADERSHIP_NAME_TO_EMAIL_ = null; };
      const resetWarned = function () { Object.keys(_emailConfigWarned_).forEach(function (k) { delete _emailConfigWarned_[k]; }); };
      const fullTable = function () {
        const t = {};
        t[OPS_ALERT_NAME_] = TEST_EMAIL_PRIMARY_;
        t[CH_LEVEL_NAME_] = TEST_EMAIL_CH_.toUpperCase();   // mixed case on purpose: resolved addresses are lower-cased
        t[FUTWORK_ROUTE_NAME_] = TEST_EMAIL_PRIMARY_;
        t[LEADERSHIP_NAMES_[0]] = TEST_EMAIL_SECONDARY_;
        t[LEADERSHIP_NAMES_[1]] = TEST_EMAIL_CH_;
        return t;
      };
      lookupEmployeeEmail_ = function (name) { return table[String(name || '').trim().toLowerCase()] || ''; };
      try {
        blankOverrides();
        resetWarned();
        setTable(fullTable());

        // ---- resolution from the private table ----
        TestAssertEqual_(opsAlertEmailGs_(), TEST_EMAIL_PRIMARY_, 'opsAlertEmailGs_: resolved from the private table by name');
        TestAssertEqual_(chLevelEmailGs_(), TEST_EMAIL_CH_, 'chLevelEmailGs_: resolved by name and LOWER-CASED (the table may hold mixed case)');
        TestAssertEqual_(futworkRouteEmailGs_(), TEST_EMAIL_PRIMARY_, 'futworkRouteEmailGs_: resolved by name');
        TestAssertEqual_(alwaysCcEmailsGs_().join(','), TEST_EMAIL_SECONDARY_ + ',' + TEST_EMAIL_CH_, 'alwaysCcEmailsGs_: the two leadership names resolved, in order');
        TestAssertEqual_(leadershipEmailByNameGs_('ashish kukreja'), TEST_EMAIL_SECONDARY_, 'leadershipEmailByNameGs_: a lowercase name resolves');
        TestAssertEqual_(leadershipEmailByNameGs_('Saurabh Mishra'), TEST_EMAIL_CH_, 'leadershipEmailByNameGs_: a display-case name resolves too');
        TestAssertEqual_(leadershipEmailByNameGs_('Someone Else'), '', 'leadershipEmailByNameGs_: a name that is not leadership gets nothing');
        TestAssertEqual_(chLevelReportToGs_(), TEST_EMAIL_PRIMARY_ + ',' + TEST_EMAIL_CH_, 'chLevelReportToGs_: ops + CH, both resolved');
        TestAssertEqual_(emailConfigProblemsGs_().length, 0, 'emailConfigProblemsGs_: nothing to report when every name resolves');

        // The private lookup being absent or failing never throws.
        lookupEmployeeEmail_ = undefined;
        TestAssertEqual_(resolvedEmailForNameGs_('Anyone'), '', 'resolvedEmailForNameGs_: no lookup function at all (the private file/RmHierarchy.gs is absent) -> blank, no throw');
        lookupEmployeeEmail_ = function () { throw new Error('boom'); };
        TestAssertEqual_(resolvedEmailForNameGs_('Anyone'), '', 'resolvedEmailForNameGs_: a failing lookup -> blank, no throw');
        lookupEmployeeEmail_ = function (name) { return table[String(name || '').trim().toLowerCase()] || ''; };

        // ---- an override always wins (this is how tests, and TEST MODE-style runs, stay off the real addresses) ----
        OPS_ALERT_EMAIL_ = TEST_EMAIL_SECONDARY_; CH_LEVEL_EMAIL_ = TEST_EMAIL_SECONDARY_; FUTWORK_ROUTE_EMAIL_ = TEST_EMAIL_SECONDARY_; ALWAYS_CC_EMAILS_ = []; LEADERSHIP_NAME_TO_EMAIL_ = { 'x y': TEST_EMAIL_CH_ };
        TestAssert_(opsAlertEmailGs_() === TEST_EMAIL_SECONDARY_ && chLevelEmailGs_() === TEST_EMAIL_SECONDARY_ && futworkRouteEmailGs_() === TEST_EMAIL_SECONDARY_, 'overrides: a non-blank override beats the private table for ops, CH and Futwork');
        TestAssertEqual_(alwaysCcEmailsGs_().length, 0, 'overrides: an ALWAYS_CC_EMAILS_ array (even empty) is used as is');
        TestAssertEqual_(leadershipEmailByNameGs_('x y') + '|' + leadershipEmailByNameGs_('ashish kukreja'), TEST_EMAIL_CH_ + '|', 'overrides: a LEADERSHIP_NAME_TO_EMAIL_ object is used as is (and the table is NOT consulted)');
        TestAssertEqual_(emailConfigProblemsGs_().length, 0, 'overrides: count as resolved, so a test run raises no config problem');
        // A PARTIAL override: only ops is overridden — Futwork and CH still come from the table (they do not borrow the override).
        blankOverrides();
        OPS_ALERT_EMAIL_ = TEST_EMAIL_SECONDARY_;
        TestAssertEqual_(opsAlertEmailGs_() + '|' + futworkRouteEmailGs_() + '|' + chLevelEmailGs_(), TEST_EMAIL_SECONDARY_ + '|' + TEST_EMAIL_PRIMARY_ + '|' + TEST_EMAIL_CH_, 'overrides: overriding ONE role leaves the others resolved from the private table');
        blankOverrides();

        // ---- missing people: safe, loud fallbacks ----
        resetWarned();
        setTable({});
        SpreadsheetApp = { getActiveSpreadsheet: function () { return { getOwner: function () { return { getEmail: function () { return TEST_EMAIL_SECONDARY_.toUpperCase(); } }; } }; }, flush: function () {} };
        TestAssertEqual_(opsAlertEmailGs_(), TEST_EMAIL_SECONDARY_, 'ops fallback: with no row for the ops person, alerts go to the workbook owner (lower-cased)');
        TestAssertEqual_(chLevelEmailGs_(), TEST_EMAIL_SECONDARY_, 'CH fallback: with no row for the CH person, CH-level mail goes to the ops address');
        TestAssertEqual_(futworkRouteEmailGs_(), TEST_EMAIL_SECONDARY_, 'Futwork fallback: with no row, the Futwork email goes to the ops address');
        TestAssertEqual_(chLevelReportToGs_(), TEST_EMAIL_SECONDARY_, 'chLevelReportToGs_: when CH falls back to ops the report goes to ONE address, never "a,a"');
        TestAssertEqual_(alwaysCcEmailsGs_().length, 0, 'leadership fallback: names with no row are skipped (no Cc), never a blank address');
        TestAssertEqual_(emailConfigProblemsGs_().map(function (p) { return p.key; }).join(','), 'ops,ch,futwork,leadership:ashish kukreja,leadership:saurabh mishra', 'emailConfigProblemsGs_: every unresolved name is reported by key');
        SpreadsheetApp = { getActiveSpreadsheet: function () { return {}; }, flush: function () {} };
        TestAssertEqual_(opsAlertEmailGs_(), '', 'ops fallback: no row AND no workbook owner -> blank (the alert cannot be delivered; logged, not thrown)');
        SpreadsheetApp = saved.ss;

        // ---- the sends use the resolved addresses ----
        resetWarned();
        setTable(fullTable());
        const sentBefore = TestGmailLog_.sent.length;
        notifyOpsAlertGs_('p13 subject', ['body']);
        TestAssertEqual_(TestGmailLog_.sent[TestGmailLog_.sent.length - 1].to + '|' + (TestGmailLog_.sent.length - sentBefore), TEST_EMAIL_PRIMARY_ + '|1', 'notifyOpsAlertGs_: sends to the address resolved from the private table');
        // The weekly Ops Checklist email (OpsChecklistRunner.gs) goes to the same resolved ops address.
        const realChecklist = buildWeeklyOpsChecklistSummary_;
        buildWeeklyOpsChecklistSummary_ = function () { return { issueCount: 0, lines: ['all clear'] }; };
        const weeklyBefore = TestGmailLog_.sent.length;
        try { runWeeklyOpsChecklist_({}, new Date()); } finally { buildWeeklyOpsChecklistSummary_ = realChecklist; }
        TestAssertEqual_(TestGmailLog_.sent.length - weeklyBefore === 1 && TestGmailLog_.sent[TestGmailLog_.sent.length - 1].to === TEST_EMAIL_PRIMARY_, true, 'weekly Ops Checklist email: addressed to the ops address resolved from the private table');
        const backstop = resolveRecipientEmailsForRegion_(ss, 'Test Region', ['Some Totally Unknown RM'], {}, { fireAlerts: false });
        TestAssertEqual_(backstop.results[0].to, TEST_EMAIL_CH_, 'CH backstop bucket: addressed to the CH person resolved from the private table');
        const fwRes = resolveRecipientEmailsForRegion_(ss, 'Test Region', ['Kajal Futwork'], {}, { fireAlerts: false });
        TestAssertEqual_(fwRes.results[0].to, TEST_EMAIL_PRIMARY_, 'Futwork bucket: addressed to the Futwork person resolved from the private table');
        const legacyRes = resolveRecipientEmailsForRegion_(ss, 'Pune', ['Some Totally Unknown RM'], { Pune: { to: TEST_EMAIL_SECONDARY_, cc: '' } }, { fireAlerts: false });
        const legacyCc = (legacyRes.results[0].cc || '').split(',');
        TestAssert_(legacyCc.indexOf(TEST_EMAIL_SECONDARY_) !== -1 && legacyCc.indexOf(TEST_EMAIL_CH_) !== -1, 'legacy Region_Recipients fallback: the leadership Cc (resolved by name from the private table) is on the email');

        // A leadership person personally holding a lead is recognised by NAME and routed to their resolved address.
        const leaderRes = resolveRecipientBucketsForRms_(ss, ['Ashish Kukreja'], undefined);
        TestAssertEqual_(leaderRes.chLevelRms.length === 1 && leaderRes.chLevelRms[0].chEmail === TEST_EMAIL_SECONDARY_ && leaderRes.chLevelRms[0].chRole === 'Leadership', true, 'leadership self-holding: recognised by name, chEmail resolved from the private table');
        setTable({});
        const leaderGone = resolveRecipientBucketsForRms_(ss, ['Ashish Kukreja'], undefined);
        TestAssertEqual_(leaderGone.chLevelRms.length === 0 && leaderGone.unresolved.length === 1, true, 'leadership self-holding: with no row in the private table the name is simply unresolved (the normal fallback), not an error');
        setTable(fullTable());

        // ---- the hourly watchdog reports a missing address once a day, for as long as the same set persists ----
        const realProps = PropertiesService;
        PropertiesService = TestMockPropertiesService_();
        try {
          const at = function (iso) { return new Date(iso); };
          const alertsAfter = function (fn) { const b = TestGmailLog_.sent.length; fn(); return TestGmailLog_.sent.slice(b).filter(function (e) { return /an email address cannot be resolved/.test(e.subject); }); };
          const early = '2026-10-07T09:00:00+05:30'; // before any job deadline: only the config check can speak
          TestAssertEqual_(alertsAfter(function () { checkEmailJobsCompletedGs_(at(early)); }).length, 0, 'watchdog config check: silent while every address resolves');
          setTable(Object.assign(fullTable(), (function () { const m = {}; m[CH_LEVEL_NAME_] = ''; return m; })()));
          const first = alertsAfter(function () { checkEmailJobsCompletedGs_(at(early)); });
          TestAssertEqual_(first.length, 1, 'watchdog config check: an unresolvable address produces ONE alert');
          TestAssert_(/Ashish Ivlekar/.test(first[0].body) && /RmHierarchy\.private\.gs/.test(first[0].body) && /showEmailConfigNow/.test(first[0].body), 'watchdog config check: …naming the person, the private file and how to check it');
          TestAssertEqual_(alertsAfter(function () { checkEmailJobsCompletedGs_(at('2026-10-07T10:00:00+05:30')); }).length, 0, 'watchdog config check: the next hourly run the same day does NOT repeat it');
          setTable(Object.assign(fullTable(), (function () { const m = {}; m[CH_LEVEL_NAME_] = ''; m[LEADERSHIP_NAMES_[1]] = ''; return m; })()));
          TestAssertEqual_(alertsAfter(function () { checkEmailJobsCompletedGs_(at('2026-10-07T11:00:00+05:30')); }).length, 1, 'watchdog config check: a DIFFERENT set of problems alerts again');
          TestAssertEqual_(alertsAfter(function () { checkEmailJobsCompletedGs_(at('2026-10-08T09:00:00+05:30')); }).length, 1, 'watchdog config check: the next day alerts again while the problem persists');
          setTable(fullTable());
          TestAssertEqual_(alertsAfter(function () { checkEmailJobsCompletedGs_(at('2026-10-09T09:00:00+05:30')); }).length, 0, 'watchdog config check: silent again once it is fixed');
        } finally { PropertiesService = realProps; PropertiesService = TestMockPropertiesService_(); }

        // The human-readable check runs (it only logs).
        blankOverrides();
        setTable(fullTable());
        showEmailConfigNow();
        TestAssert_(true, 'showEmailConfigNow runs without error');
      } finally {
        OPS_ALERT_EMAIL_ = saved.ops; CH_LEVEL_EMAIL_ = saved.ch; FUTWORK_ROUTE_EMAIL_ = saved.fw; ALWAYS_CC_EMAILS_ = saved.cc; LEADERSHIP_NAME_TO_EMAIL_ = saved.lead;
        lookupEmployeeEmail_ = saved.lookup; SpreadsheetApp = saved.ss;
      }
    }

    TestAssertOnlyTestEmails_();
  } finally {
    TestEnv_tearDown_();
  }
  return TestResults_;
}

function runEmailInfraTestsNow() { runEmailInfraTests_(); }
