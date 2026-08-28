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

    calls = 0;
    TestAssertThrows_(function () {
      withSendRetry_(function () { calls++; throw new Error('Some other ambiguous failure'); }, 'test send non-retry');
    }, 'withSendRetry_: a non-"operation not allowed" error propagates');
    TestAssertEqual_(calls, 1, 'withSendRetry_: an ambiguous (non-definitive) failure is NOT retried, to avoid a possible duplicate send');

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

    // ---- truly unresolved: no RM_Hierarchy chain AND no legacy fallback either ----
    resolution = resolveRecipientEmailsForRegion_(ss, 'Test Region', ['Some Totally Unknown RM'], {}, { fireAlerts: false });
    TestAssertEqual_(resolution.results.length, 0, 'resolveRecipientEmailsForRegion_: no buckets when nothing resolves and there is no legacy fallback');
    TestAssertEqual_(resolution.trulyUnresolved.length, 1, 'resolveRecipientEmailsForRegion_: correctly reports the RM as truly unresolved');

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
