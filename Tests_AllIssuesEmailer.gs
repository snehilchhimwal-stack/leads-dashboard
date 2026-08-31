/**
 * Tests: AllIssuesEmailer.gs — the 5pm all-issues send, scoped to the
 * last 3 calendar days (IST). Run runAllIssuesEmailerTestsNow() from the
 * function dropdown, or via runAllTests() (Tests_RunAll.gs).
 *
 * NOTE ON TIME: same as Tests_OvernightEmailer.gs — sendAllIssuesEmails
 * reads the real wall clock internally, so fixtures are placed using the
 * REAL current allIssuesWindowGs_(new Date()) window.
 */
function TestAIE_leadRow_(header, overrides) {
  const defaults = {
    lead_id: 'L-X', client_id: 'C-X', RM: 'Test RM One', TL: 'Test A1 One', project: 'P', region: 'Pune',
    client: 'Client', lead_assigned_at: new Date(), group_source: 'google', source_bucket: 'Non-UTM',
    current_stage: 'Suspect', rm_is_active: true, call_attempts: 1,
  };
  const merged = Object.assign({}, defaults, overrides || {});
  return header.map(function (k) { return merged[k] !== undefined ? merged[k] : ''; });
}

function runAllIssuesEmailerTests_() {
  const now = new Date();
  const win = allIssuesWindowGs_(now);
  const midWindow = new Date((win.from.getTime() + win.to.getTime()) / 2);
  const monthShort = Utilities.formatDate(now, 'Asia/Kolkata', 'MMM');
  const header = TestFixture_leadsHeader_();
  const banner = header.map(function () { return ''; });

  // Distinct, unambiguous timestamps for each SLA rule this file needs
  // to trigger — chosen so exactly ONE rule fires per fixture lead (see
  // Tests_SlaEngine.gs for the full per-rule truth table already proven
  // there; this just needs one representative each).
  const rows = [
    banner, header,
    // Inactive-RM Lead Added: created within window, RM inactive.
    // lead_assigned_at is exactly `now` (not "N hours ago") deliberately —
    // inactiveRmNewLead requires isCreatedToday, and "N hours ago" is not
    // reliably the same IST calendar day as `now` if this suite happens
    // to run within the first N hours after midnight IST.
    TestAIE_leadRow_(header, { lead_id: 'L-INACTIVE', client_id: 'C-INACTIVE', RM: 'Test RM One', lead_assigned_at: now, rm_is_active: false }),
    // Not Updated: never connected past the 10-min window.
    TestAIE_leadRow_(header, { lead_id: 'L-NOTUPDATED', client_id: 'C-NOTUPDATED', RM: 'Test RM Two', lead_assigned_at: midWindow, current_stage: 'Suspect' }),
    // Behind on Today's Calls: created within window, few attempts, but
    // ALREADY connected (so it doesn't also trip Not Updated) and no
    // stale comment (so it doesn't also trip Follow-up Overdue) —
    // isolates underCalledToday as the ONLY thing flagged.
    TestAIE_leadRow_(header, {
      lead_id: 'L-UNDERCALLED', client_id: 'C-UNDERCALLED', RM: 'Test RM One', lead_assigned_at: TestFixture_hoursAgo_(now, 5),
      call_attempts: 1, last_connect: 'Connected', last_connect_time: TestFixture_hoursAgo_(now, 0.5),
    }),
    // Multiple issues at once, to prove priority order picks Inactive-RM
    // over everything else (created today + inactive RM + also stuck,
    // by being technically past 48h... skip that combo, keep it simple:
    // Inactive-RM + implicitly under-called since 0 attempts).
    TestAIE_leadRow_(header, { lead_id: 'L-MULTI', client_id: 'C-MULTI', RM: 'Test RM One', lead_assigned_at: now, rm_is_active: false, call_attempts: 0 }),
    // Closed — excluded entirely, no issue check at all.
    TestAIE_leadRow_(header, { lead_id: 'L-CLOSED', client_id: 'C-CLOSED', RM: 'Test RM One', current_stage: 'Won', lead_assigned_at: midWindow }),
    // Wrong source — excluded via passesGoogleNonUtmSearchGs_.
    TestAIE_leadRow_(header, { lead_id: 'L-WRONGSRC', client_id: 'C-WRONGSRC', RM: 'Test RM One', group_source: 'Facebook', lead_assigned_at: midWindow, rm_is_active: false }),
    // In scope and open, but genuinely clean — no issue fires.
    TestAIE_leadRow_(header, {
      lead_id: 'L-CLEAN', client_id: 'C-CLEAN', RM: 'Test RM One', lead_assigned_at: TestFixture_hoursAgo_(now, 5),
      call_attempts: 6, last_connect: 'Connected', last_connect_time: TestFixture_hoursAgo_(now, 0.5),
    }),
    // CH personally holding a flagged lead -> must divert to notifyChLevelIssuesGs_.
    // lead_assigned_at is `now` for the same midnight-boundary reason as
    // L-INACTIVE above.
    TestAIE_leadRow_(header, { lead_id: 'L-CH-ISSUE', client_id: 'C-CH-ISSUE', RM: 'Test CH Self', lead_assigned_at: now, rm_is_active: false }),
  ];

  const ss = TestMockSpreadsheet_({
    'RM_Hierarchy': TestMockSheet_('RM_Hierarchy', TestFixture_rmHierarchyRows_()),
    'Manager_Directory': TestMockSheet_('Manager_Directory', TestFixture_managerDirectoryRows_()),
  });
  ss._sheets[monthShort] = TestMockSheet_(monthShort, rows);

  TestEnv_setUp_('Tests_AllIssuesEmailer', ss);
  try {
    // ---- allIssuesWindowGs_ / allIssuesDateRangeLabelGs_ ----
    // Calendar-day anchored, not a fixed hours-back offset — asserted
    // directly against the formula rather than a fixed span, since the
    // actual span varies with time of day (spans MORE than 48h whenever
    // `now` is later than midnight, by design — see
    // ALL_ISSUES_WINDOW_DAYS_BACK_'s own comment for the real undercount
    // bug this fixed).
    const todayMidnightForTest = new Date(istDayKeyGs_(now) + 'T00:00:00+05:30');
    const expectedFrom = new Date(todayMidnightForTest.getTime() - ALL_ISSUES_WINDOW_DAYS_BACK_ * 24 * 3600 * 1000);
    TestAssertEqual_(win.from.getTime(), expectedFrom.getTime(), 'allIssuesWindowGs_: from is exactly ' + ALL_ISSUES_WINDOW_DAYS_BACK_ + ' full calendar days before today\'s IST midnight, not a fixed hours-back offset');
    TestAssertEqual_(win.to.getTime(), now.getTime(), 'allIssuesWindowGs_: to is exactly `now`');
    const label = allIssuesDateRangeLabelGs_(win);
    TestAssert_(/^\(\d{2}-[A-Za-z]{3}-\d{4} to \d{2}-[A-Za-z]{3}-\d{4}\)$/.test(label), 'allIssuesDateRangeLabelGs_: matches the "(dd-MMM-yyyy to dd-MMM-yyyy)" format');

    // ---- sendAllIssuesEmails: end to end ----
    sendAllIssuesEmails();

    TestAssertEqual_(TestGmailLog_.drafts.length, 2, 'sendAllIssuesEmails: sends exactly 2 emails — 1 normal A1 bucket + 1 CH-level report');
    const normalDraft = TestGmailLog_.drafts.find(function (d) { return d.to === TEST_EMAIL_PRIMARY_; });
    const chDraft = TestGmailLog_.drafts.find(function (d) { return d.to.indexOf(TEST_EMAIL_CH_) !== -1; });
    TestAssert_(!!normalDraft, 'sendAllIssuesEmails: normal bucket email sent to the A1');
    TestAssert_(!!chDraft, 'sendAllIssuesEmails: CH-level report sent to ops+CH');

    ['L-INACTIVE', 'L-NOTUPDATED', 'L-UNDERCALLED', 'L-MULTI'].forEach(function (id) {
      TestAssertContains_(normalDraft.htmlBody, id, 'sendAllIssuesEmails: flagged lead ' + id + ' appears in the bucket email');
    });
    ['L-CLOSED', 'L-WRONGSRC', 'L-CLEAN', 'L-CH-ISSUE'].forEach(function (id) {
      TestAssert_(normalDraft.htmlBody.indexOf(id) === -1, 'sendAllIssuesEmails: excluded/clean/diverted lead ' + id + ' never appears in the bucket email');
    });
    TestAssertContains_(normalDraft.htmlBody, 'Inactive-RM Lead Added', 'sendAllIssuesEmails: L-INACTIVE is correctly labeled Inactive-RM Lead Added');
    TestAssertContains_(normalDraft.htmlBody, 'Not Updated', 'sendAllIssuesEmails: L-NOTUPDATED is correctly labeled Not Updated');
    TestAssertContains_(normalDraft.htmlBody, "Behind on Today's Calls", 'sendAllIssuesEmails: L-UNDERCALLED is correctly labeled Behind on Today\'s Calls');

    // L-MULTI qualifies for both Inactive-RM AND underCalledToday — must
    // show the higher-priority one only. Isolate its own <tr>...</tr> row
    // (Lead ID/Issue/Status/Suggested Follow-up columns) rather than a
    // whole-body substring search, since "Inactive-RM Lead Added" also
    // legitimately appears elsewhere in the email (L-INACTIVE's own row).
    const multiIdx = normalDraft.htmlBody.indexOf('L-MULTI');
    TestAssert_(multiIdx !== -1, 'sanity: L-MULTI is present in the HTML body');
    const multiRowEnd = normalDraft.htmlBody.indexOf('</tr>', multiIdx);
    const multiRowHtml = normalDraft.htmlBody.slice(multiIdx, multiRowEnd);
    TestAssertContains_(multiRowHtml, 'Inactive-RM Lead Added', 'sendAllIssuesEmails: L-MULTI\'s own row shows the higher-priority Inactive-RM Lead Added issue');
    TestAssert_(multiRowHtml.indexOf("Behind on Today's Calls") === -1, 'sendAllIssuesEmails: L-MULTI\'s own row does NOT also show the lower-priority Behind on Today\'s Calls issue');

    TestAssertContains_(chDraft.htmlBody, 'L-CH-ISSUE', 'sendAllIssuesEmails: CH-level report lists the CH-held flagged lead');
    TestAssertContains_(chDraft.subject, 'Test CH Self', 'sendAllIssuesEmails: CH-level subject names the CH');
    TestAssertContains_(chDraft.subject, 'google Leads With Issue', 'sendAllIssuesEmails: CH-level subject uses the documented format');

    // ---- normal bucket subject format: "<bucketLabel> (<primaryRole>) google Leads With Issue (<range>)" ----
    TestAssertContains_(normalDraft.subject, 'Test A1 One (A1) google Leads With Issue', 'sendAllIssuesEmails: normal bucket subject matches the documented format exactly');

    // ---- idempotency guard ----
    sendAllIssuesEmails();
    TestAssertEqual_(TestGmailLog_.drafts.length, 2, 'sendAllIssuesEmails: a second run the same day sends nothing new (region already logged today)');

    TestAssertOnlyTestEmails_();

    // ---- sendOneAllIssuesEmail_: Gmail-blocked failure path (direct call) ----
    const realGmailApp = GmailApp;
    GmailApp = TestMockGmailApp_({});
    GmailApp.createDraft = function () { return { send: function () { throw new Error('Gmail operation not allowed for this user'); } }; };
    try {
      const logSheet = ensureAllIssuesLogSheet_(ss);
      const failRec = { to: TEST_EMAIL_PRIMARY_, cc: '', bucketLabel: 'Test A1 One', primaryRole: 'A1' };
      const failLeads = [{ lead_id: 'L-FAIL', RM: 'Test RM One', TL: 'Test A1 One', status: 'Suspect', issueLabel: 'Not Updated', followup: 'test' }];
      const result = sendOneAllIssuesEmail_(ss, logSheet, 'Pune', failRec, failLeads, '17 Aug 2026', istDayKeyGs_(now), now, win);
      TestAssert_(!!result && !!result.reason, 'sendOneAllIssuesEmail_: returns a {reason} object instead of throwing when Gmail blocks the send');
      TestAssert_(TestGmailLog_.sent.some(function (e) { return /All-issues email FAILED/.test(e.subject); }), 'sendOneAllIssuesEmail_: fires an ops alert on send failure');
    } finally {
      GmailApp = realGmailApp;
    }

    // ---- sendOneAllIssuesEmail_: a DIFFERENT send error (not "operation
    // not allowed") must ALSO point at Gmail Drafts — real production
    // case: "Exception: Not found" from this exact createDraft().send()
    // chain, which used to get only a bare "Error: ..." with no Drafts
    // guidance at all. ----
    GmailApp = TestMockGmailApp_({});
    GmailApp.createDraft = function () { return { send: function () { throw new Error('Exception: Not found'); } }; };
    try {
      const logSheet2 = ensureAllIssuesLogSheet_(ss);
      const failRec2 = { to: TEST_EMAIL_PRIMARY_, cc: '', bucketLabel: 'Test A1 One', primaryRole: 'A1' };
      const failLeads2 = [{ lead_id: 'L-FAIL2', RM: 'Test RM One', TL: 'Test A1 One', status: 'Suspect', issueLabel: 'Not Updated', followup: 'test' }];
      const result2 = sendOneAllIssuesEmail_(ss, logSheet2, 'Pune', failRec2, failLeads2, '17 Aug 2026', istDayKeyGs_(now), now, win);
      TestAssertContains_(result2.reason, 'Not found', 'sendOneAllIssuesEmail_: a non-"operation not allowed" error is still reported with its own real text');
      TestAssertContains_(result2.reason, 'Gmail Drafts', 'sendOneAllIssuesEmail_: a non-"operation not allowed" error STILL points at Gmail Drafts — createDraft() may have already succeeded even though this specific error text isn\'t the known send-block phrase');
    } finally {
      GmailApp = realGmailApp;
    }

    TestAssertOnlyTestEmails_();

    // ---- Top-level containment (2026-08-31): a crash ANYWHERE in the
    // real run must alert ops before it aborts, not fail silently ----
    // readLeadsTab_ is called near the very top of sendAllIssuesEmails_,
    // before any per-region work — simulates the exact "something threw
    // before the send loop even started" scenario that used to mean
    // nothing sent, nothing logged anywhere a human would see.
    const realReadLeadsTab = readLeadsTab_;
    readLeadsTab_ = function () { throw new Error('simulated total failure — Sheets error withRetry_ could not recover from'); };
    try {
      TestAssertThrows_(function () { sendAllIssuesEmails(); }, 'sendAllIssuesEmails: a total crash still re-throws — the Apps Script Executions log correctly shows this run as Failed, never silently swallowed');
      TestAssert_(TestGmailLog_.sent.some(function (e) { return /sendAllIssuesEmails crashed/.test(e.subject); }), 'sendAllIssuesEmails: a total crash fires an ops alert BEFORE re-throwing, naming the crash explicitly — previously nothing was sent and nothing was logged anywhere visible');
    } finally {
      readLeadsTab_ = realReadLeadsTab;
    }
    TestAssertOnlyTestEmails_();
  } finally {
    TestEnv_tearDown_();
  }
  return TestResults_;
}

function runAllIssuesEmailerTestsNow() { runAllIssuesEmailerTests_(); }
