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
