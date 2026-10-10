/**
 * Tests: CycleReport.gs - the daily 16:30 cycle report (Email Ops EO-8). Run runCycleReportTestsNow() from the function dropdown, or via
 * runAllTests() (Tests_RunAll.gs). Everything is in-memory (sheets, Gmail, Properties, triggers are fakes - see Tests_Mocks.gs).
 */

function TestCR_leadRow_(header, overrides) {
  const defaults = {
    lead_id: 'L-X', client_id: 'C-X', RM: 'Test RM One', TL: 'Test A1 One', project: 'P', region: 'Pune',
    client: 'Client', lead_assigned_at: new Date(), group_source: 'google', source_bucket: 'Non-UTM',
    current_stage: 'Suspect', rm_is_active: true, call_attempts: 1,
  };
  const merged = Object.assign({}, defaults, overrides || {});
  return header.map(function (k) { return merged[k] !== undefined ? merged[k] : ''; });
}

function TestCR_world_(leadRowsFn) {
  const header = TestFixture_leadsHeader_();
  const banner = header.map(function () { return ''; });
  const now = new Date();
  const win = allIssuesWindowGs_(now);
  const midWindow = new Date((win.from.getTime() + win.to.getTime()) / 2);
  const ss = TestMockSpreadsheet_({
    'RM_Hierarchy': TestMockSheet_('RM_Hierarchy', TestFixture_rmHierarchyRows_()),
    'Manager_Directory': TestMockSheet_('Manager_Directory', TestFixture_managerDirectoryRows_()),
  });
  ss._sheets['leads'] = TestMockSheet_('leads', [banner, header].concat(leadRowsFn ? leadRowsFn(header, now, midWindow) : []));
  return ss;
}

function TestCR_standardLeads_(header, now, midWindow) {
  return [
    TestCR_leadRow_(header, { lead_id: 'L-INACTIVE', client_id: 'C-INACTIVE', RM: 'Test RM One', lead_assigned_at: now, rm_is_active: false }),
    TestCR_leadRow_(header, { lead_id: 'L-NOTUPDATED', client_id: 'C-NOTUPDATED', RM: 'Test RM Two', lead_assigned_at: midWindow, current_stage: 'Suspect' }),
  ];
}

function TestCR_bind_(ss) {
  SpreadsheetApp.getActiveSpreadsheet = function () { return ss; };
  TestGmailLog_reset_();
  GmailApp = TestMockGmailApp_({});
  Gmail = TestMockGmailAdvanced_({});
  PropertiesService = TestMockPropertiesService_();
}

function runCycleReportTests_() {
  TestEnv_setUp_('Tests_CycleReport', TestMockSpreadsheet_({}));
  try {
    // ================= the cycle window =================
    const afterReport = cycleReportWindowGs_(new Date('2026-10-09T16:35:00+05:30'));
    TestAssertEqual_(afterReport.start.toISOString(), '2026-10-08T11:00:00.000Z', 'window: a run after 16:30 starts at 16:30 IST the previous day');
    TestAssertEqual_(afterReport.end.toISOString(), '2026-10-09T11:05:00.000Z', 'window: …and ends at the moment of the report');
    const morning = cycleReportWindowGs_(new Date('2026-10-09T10:00:00+05:30'));
    TestAssertEqual_(morning.start.toISOString(), '2026-10-07T11:00:00.000Z', 'window: a manual run before 16:30 reaches one cycle further back (the cycle that just ended plus today so far)');
    const atBoundary = cycleReportWindowGs_(new Date('2026-10-09T16:30:00+05:30'));
    TestAssertEqual_(atBoundary.start.toISOString(), '2026-10-08T11:00:00.000Z', 'window: exactly 16:30 counts as the new boundary');
    TestAssertEqual_(cycleRateGs_(6, 7) + ',' + cycleRateGs_(0, 0) + ',' + cycleRateGs_(3, 3), '6 of 7 (86%),n/a,3 of 3 (100%)', 'rate: numerator and denominator are always shown; no denominator reads n/a');

    // ================= the numbers (pure) =================
    const win = { start: new Date('2026-10-08T11:00:00.000Z'), end: new Date('2026-10-09T11:05:00.000Z') };
    const inWin = function (h) { return new Date(win.start.getTime() + h * 3600000); };
    const L = function (job, status, extra) { return Object.assign({ job: job, status: status, region: 'Pune', bucket_label: 'B', to: 'a@b.co', status_reason: '', leads_sent: 0, planned_at: inWin(1) }, extra || {}); };
    const ledgerRows = [
      L('allIssues17', 'ACCEPTED', { leads_sent: 5 }), L('allIssues17', 'ACCEPTED', { leads_sent: 3 }), L('allIssues17', 'FAILED', { status_reason: 'Gmail send blocked' }),
      L('morning10', 'SKIPPED'), L('morning10', 'ACCEPTED', { leads_sent: 2 }), L('morning10', 'PLANNED'),
      L('followup13', 'UNCONFIRMED', { status_reason: 'timeout' }), L('followup13', 'BLOCKED', { status_reason: 'gate' }),
      L('allIssues17', 'FAILED', { planned_at: new Date(win.start.getTime() - 3600000) }), // before the window: ignored
    ];
    const X = function (kind, reason) { return { kind: kind, reason: reason, recorded_at: inWin(2) }; };
    const exclusionRows = [X('lead', 'no recipient could be resolved: x'), X('lead', 'no recipient could be resolved: x'), X('lead', 'duplicate lead id - the first copy was sent'),
      X('region', 'already sent today - the re-run guard skipped 12 lead(s)'), X('region', 'already sent today - the re-run guard skipped 7 lead(s)')];
    const I = function (sev, notification, extra) { return Object.assign({ severity: sev, notification: notification, detected_at: inWin(3), subject: 'S ' + sev, job: 'sendAllIssuesEmails' }, extra || {}); };
    const incidentRows = [I('MEDIUM', 'SENT'), I('LOW', 'SENT'), I('CRITICAL', 'HELD'), I('HIGH', 'SENT', { detected_at: new Date(win.start.getTime() - 86400000) })];
    const data = cycleReportDataGs_({ window: win, ledgerRows: ledgerRows, exclusionRows: exclusionRows, incidentRows: incidentRows, configProblems: [{ key: 'ops', detail: 'ops address missing' }] });
    TestAssertEqual_(JSON.stringify(data.totals), JSON.stringify({ planned: 8, accepted: 3, skipped: 1, failed: 1, unconfirmed: 1, blocked: 1, unfinished: 1, leadsSent: 10 }), 'data: totals count each status once; the row outside the window is ignored; an open PLANNED row is "unfinished"');
    TestAssertEqual_(data.attemptable, 7, 'data: attemptable = planned minus skipped');
    TestAssertEqual_(JSON.stringify(data.byJob.allIssues17), JSON.stringify({ planned: 3, accepted: 2, skipped: 0, failed: 1, unconfirmed: 0, blocked: 0, unfinished: 0, leadsSent: 8 }), 'data: counts per job');
    TestAssertEqual_(data.attention.map(function (a) { return a.status; }).sort().join(','), 'BLOCKED,FAILED,PLANNED,UNCONFIRMED', 'data: every email that did not end ACCEPTED/SKIPPED needs attention');
    TestAssertContains_(data.attention.filter(function (a) { return a.status === 'PLANNED'; })[0].reason, 'outcome is unknown', 'data: an unfinished email says its outcome is unknown instead of a blank reason');
    TestAssertEqual_(data.exclusions.leads + ',' + data.exclusions.regions, '3,2', 'data: lead and region exclusions are counted separately');
    TestAssert_(data.exclusions.reasons.some(function (r) { return r.reason === 'already sent today - the re-run guard skipped # lead(s)' && r.regions === 2; }), 'data: reasons that differ only by a number are grouped');
    TestAssertEqual_(JSON.stringify(data.bySeverity), JSON.stringify({ CRITICAL: 1, HIGH: 0, MEDIUM: 1, LOW: 1 }), 'data: incidents outside the window are not counted');
    TestAssertEqual_(data.seriousIncidents + ',' + data.heldNow, '2,1', 'data: serious = not LOW; held-now counts HELD incidents');
    TestAssertEqual_(data.allClear + ',' + data.empty, 'false,false', 'data: failures and a serious incident mean "not all clear"');

    const clean = cycleReportDataGs_({ window: win, ledgerRows: [L('allIssues17', 'ACCEPTED', { leads_sent: 4 }), L('morning10', 'SKIPPED')], exclusionRows: [], incidentRows: [I('LOW', 'SENT')], configProblems: [] });
    TestAssertEqual_(clean.allClear, true, 'data: accepted + skipped emails and only a LOW incident is all clear');
    TestAssertEqual_(cycleReportDataGs_({ window: win, ledgerRows: [L('allIssues17', 'ACCEPTED')], incidentRows: [I('MEDIUM', 'SENT')] }).allClear, false, 'data: a MEDIUM incident in the cycle is not all clear, even if every email went out');
    const empty = cycleReportDataGs_({ window: win, ledgerRows: [], exclusionRows: [], incidentRows: [] });
    TestAssertEqual_(empty.empty + ',' + empty.allClear, 'true,false', 'data: nothing recorded is "empty", never "all clear"');

    // ================= the rendering (pure) =================
    const now = new Date('2026-10-09T16:35:00+05:30');
    const bad = cycleReportRenderGs_(data, now);
    TestAssertEqual_(bad.subject, 'Email Ops cycle report 9 Oct 2026: 6 need attention (3 of 8 emails accepted by Gmail)', 'render: the subject counts the attention items plus serious incidents and states accepted of planned');
    TestAssertContains_(bad.plainBody, 'Needs attention (4)', 'render: the attention table is present');
    TestAssertContains_(bad.plainBody, 'Incidents in this cycle (3)', 'render: the incident table is present');
    TestAssertContains_(bad.plainBody, 'Left out of emails', 'render: the exclusions table is present');
    TestAssertContains_(bad.plainBody, 'ops address missing', 'render: a recipient-address problem is shown under "Ready for 17:00?"');
    TestAssertContains_(bad.plainBody, '1 held alert(s)', 'render: held alerts are shown');
    TestAssertContains_(bad.plainBody, 'bounces and replies (the 15:30 sweep has not run yet); delivery and opens cannot be seen from Apps Script', 'render: what is NOT tracked yet is stated, not hidden');
    TestAssertEqual_(data.sweep.notSwept + ',' + data.sweep.bounced + ',' + data.sweep.replied, '4,0,0', 'data: with no sweep evidence the four accepted/unconfirmed emails are "not checked yet"');
    TestAssertContains_(bad.plainBody, 'The bounce/reply sweep has not run for these emails yet.', 'render: the bounces section says the sweep has not run');

    // ---- bounce / reply evidence from the daily sweep ----
    {
      const swept = new Date(win.start.getTime() + 20 * 3600000);
      const S = function (extra) { return L('allIssues17', 'ACCEPTED', Object.assign({ leads_sent: 2, swept_at: swept, bounce_status: 'NO_BOUNCE_SEEN', reply_status: 'NO_REPLY_SEEN' }, extra || {})); };
      const sd = cycleReportDataGs_({ window: win, ledgerRows: [
        S(), S({ bounce_status: 'BOUNCED 2026-10-08 17:03', bucket_label: 'Bouncy' }), S({ reply_status: 'REPLIED 2 (latest 2026-10-08 18:30)', bucket_label: 'Chatty' }),
        L('allIssues17', 'FAILED', { bounce_status: 'BOUNCED x' }), // a failed email's bounce text is not counted: it never went out
      ], exclusionRows: [], incidentRows: [], configProblems: [] });
      TestAssertEqual_(sd.sweep.bounced + ',' + sd.sweep.replied + ',' + sd.sweep.noBounce + ',' + sd.sweep.notSwept, '1,1,2,0', 'sweep data: bounced / replied / no-bounce-found / not-checked counts (a FAILED email is not counted)');
      TestAssertEqual_(sd.sweep.lastSweep.getTime(), swept.getTime(), 'sweep data: the time of the latest sweep is kept');
      TestAssertEqual_(sd.attention.filter(function (a) { return a.status === 'BOUNCED'; }).length, 1, 'sweep data: a bounced email needs attention even though Gmail accepted it');
      TestAssertEqual_(sd.allClear, false, 'sweep data: a bounce means not all clear');
      TestAssertEqual_(sd.totals.accepted, 3, 'sweep data: the bounced email still counts as accepted by Gmail (it was) - the bounce is reported separately');
      const sr = cycleReportRenderGs_(sd, now);
      TestAssertContains_(sr.plainBody, 'Bounces and replies', 'sweep render: the section is present');
      TestAssertContains_(sr.plainBody, 'Checked by the sweep at', 'sweep render: it states when the sweep ran');
      TestAssertContains_(sr.plainBody, '"No bounce found" is NOT proof of delivery.', 'sweep render: it never implies delivery');
      TestAssertContains_(sr.plainBody, 'Replies received (1)', 'sweep render: replies are listed');
      TestAssertContains_(sr.plainBody, 'Chatty', 'sweep render: …by bucket');
      TestAssertContains_(sr.plainBody, 'BOUNCED', 'sweep render: the bounce is in the attention table');
      TestAssert_(sr.plainBody.indexOf('the 15:30 sweep has not run yet') === -1, 'sweep render: once swept, the "not run yet" note is gone');
      TestAssertContains_(sr.plainBody, 'delivery and opens cannot be seen from Apps Script', 'sweep render: …but what Apps Script can never see is still stated');
      TestAssertContains_(sr.plainBody, 'Leads tab freshness | not checked', 'sweep render: with no freshness check supplied the row says not checked');
    }
    TestAssertContains_(bad.plainBody, '3 of 7 (43%) accepted by Gmail', 'render: the execution rate shows numerator and denominator');
    TestAssertContains_(bad.html, 'Daily Cycle Report', 'render: the HTML carries the title');
    const good = cycleReportRenderGs_(clean, now);
    TestAssertEqual_(good.subject, 'Email Ops cycle report 9 Oct 2026: all clear (1 of 2 emails accepted by Gmail, 1 had nothing to send)', 'render: an all-clear subject says so and notes skipped emails');
    TestAssert_(good.plainBody.indexOf('Needs attention') === -1, 'render: no attention table when there is nothing to attend to');
    const none = cycleReportRenderGs_(empty, now);
    TestAssertEqual_(none.subject, 'Email Ops cycle report 9 Oct 2026: no emails recorded in this cycle', 'render: an empty cycle is never called all clear');
    const many = [];
    for (let i = 0; i < 40; i++) many.push(L('allIssues17', 'FAILED', { bucket_label: 'Bucket ' + i }));
    const big = cycleReportRenderGs_(cycleReportDataGs_({ window: win, ledgerRows: many, exclusionRows: [], incidentRows: [] }), now);
    TestAssertContains_(big.plainBody, 'First 30 of 40', 'render: a long attention list is cut at 30 rows and says so');
    TestAssert_(big.plainBody.indexOf('Bucket 29') !== -1 && big.plainBody.indexOf('Bucket 30') === -1, 'render: …and rows 31 onwards really are left out');

    // ================= end to end: a real cycle, then the report =================
    const reportNow = function () { return new Date(Date.now() + 60000); };
    {
      const ss = TestCR_world_(TestCR_standardLeads_);
      TestCR_bind_(ss);
      sendAllIssuesEmails();
      TestGmailLog_.sent.length = 0;
      const draftsAfter17 = TestGmailLog_.drafts.length;
      const built = sendEmailCycleReport_({ now: reportNow() });
      TestAssertEqual_(TestGmailLog_.drafts.length, draftsAfter17 + 1, 'report: exactly one email is sent besides the 17:00 email');
      const mail = TestGmailLog_.drafts[TestGmailLog_.drafts.length - 1];
      TestAssertEqual_(mail.to, TEST_EMAIL_PRIMARY_, 'report: it goes to the ops address only');
      TestAssertEqual_(mail.cc, '', 'report: …with no Cc');
      TestAssertContains_(mail.subject, 'all clear (1 of 1 emails accepted by Gmail)', 'report: a clean cycle is all clear');
      TestAssertContains_(mail.body, '17:00 All-Issues', 'report: the plain part names the 17:00 job');
      TestAssertContains_(mail.htmlBody, '17:00 All-Issues', 'report: the HTML names the 17:00 job');
      TestAssert_(built && built.data.allClear, 'report: the returned data says all clear');
      // once a day
      const draftsBefore = TestGmailLog_.drafts.length;
      TestAssertEqual_(sendEmailCycleReport_({ now: reportNow() }), null, 'report: a second run the same day sends nothing');
      TestAssertEqual_(TestGmailLog_.drafts.length, draftsBefore, 'report: …no second email');
      sendEmailCycleReport_({ now: reportNow(), force: true });
      TestAssertEqual_(TestGmailLog_.drafts.length, draftsBefore + 1, 'report: force sends it again on purpose');
    }
    {
      // an error cycle: one bucket's send is refused
      const ss = TestCR_world_(TestCR_standardLeads_);
      TestCR_bind_(ss);
      GmailApp.createDraft = function () { return { send: function () { throw new Error('Gmail operation not allowed for this user'); } }; };
      sendAllIssuesEmails();
      GmailApp = TestMockGmailApp_({});
      TestGmailLog_.sent.length = 0;
      sendEmailCycleReport_({ now: reportNow() });
      const mail = TestGmailLog_.drafts[TestGmailLog_.drafts.length - 1];
      TestAssertContains_(mail.subject, 'need attention (0 of 1 emails accepted by Gmail)', 'report (error cycle): the subject counts what needs attention');
      TestAssertContains_(mail.body, 'Needs attention (1)', 'report (error cycle): the failed email is listed');
      TestAssertContains_(mail.body, 'FAILED', 'report (error cycle): …with its status');
      TestAssertContains_(mail.body, 'Incidents in this cycle', 'report (error cycle): the incident the failure raised is listed');
      TestAssertContains_(mail.body, 'SENT', 'report (error cycle): …with the fact that you were told');
    }
    {
      // nothing recorded at all
      TestCR_bind_(TestCR_world_(null));
      sendEmailCycleReport_({ now: reportNow() });
      TestAssertContains_(TestGmailLog_.drafts[0].subject, 'no emails recorded in this cycle', 'report (no data): an empty cycle says so');
    }
    {
      // test mode
      const ss = TestCR_world_(TestCR_standardLeads_);
      TestCR_bind_(ss);
      TEST_MODE_OVERRIDE_EMAIL_ = TEST_EMAIL_PRIMARY_;
      try {
        sendEmailCycleReport_({ now: reportNow() });
        sendEmailCycleReport_({ now: reportNow() });
      } finally { TEST_MODE_OVERRIDE_EMAIL_ = ''; }
      TestAssertEqual_(TestGmailLog_.drafts.length, 2, 'report (test mode): the once-a-day guard is not consumed or honoured');
      TestAssertContains_(TestGmailLog_.drafts[0].subject, '[TEST MODE]', 'report (test mode): the subject says so');
      TestAssertEqual_(PropertiesService.getScriptProperties().getProperty(CYCLE_REPORT_SENT_PROPERTY_), null, 'report (test mode): nothing is recorded as sent');
    }

    // ================= Leads-tab freshness (decision D4) =================
    TestAssertEqual_([0, 3, 3.01, 5, 5.01, 30].map(cycleFreshnessLevelGs_).join(','), 'GREEN,GREEN,AMBER,AMBER,RED,RED', 'freshness level: up to 3 h is GREEN, over 3 h AMBER, over 5 h RED');
    {
      const fresh = function (level, text) { return { level: level, ageHours: level === 'UNKNOWN' ? null : 4, newest: null, text: text || level + ': text' }; };
      const mk = function (fr) { return cycleReportDataGs_({ window: win, ledgerRows: [L('allIssues17', 'ACCEPTED', { leads_sent: 2 })], exclusionRows: [], incidentRows: [], configProblems: [], freshness: fr }); };
      TestAssertEqual_(mk(fresh('GREEN')).allClear, true, 'freshness data: GREEN does not change anything');
      const amber = mk(fresh('AMBER', 'AMBER: the newest lead was assigned 4 h ago'));
      TestAssertEqual_(amber.allClear + ',' + amber.attention.length + ',' + amber.attention[0].status, 'false,1,LEADS AMBER', 'freshness data: AMBER is an attention item and means not all clear');
      TestAssertEqual_(mk(fresh('RED')).attention[0].status, 'LEADS RED', 'freshness data: RED too');
      TestAssertEqual_(mk(fresh('UNKNOWN')).allClear, true, 'freshness data: UNKNOWN (cannot be judged) is shown but never raised as a problem it cannot prove');
      TestAssertContains_(cycleReportRenderGs_(amber, now).plainBody, 'Leads tab freshness | AMBER: the newest lead was assigned 4 h ago', 'freshness render: the readiness table shows the text');
      TestAssertContains_(cycleReportRenderGs_(amber, now).plainBody, 'LEADS AMBER', 'freshness render: and the attention table lists it');
    }
    {
      const freshOf = function (rowsFn) { return cycleLeadsFreshnessGs_(TestCR_world_(rowsFn), new Date()); };
      const hoursAgo = function (h) { return new Date(Date.now() - h * 3600000); };
      const withLead = function (when) { return function (header) { return [TestCR_leadRow_(header, { lead_id: 'L-F', client_id: 'C-F', lead_assigned_at: when })]; }; };
      const g = freshOf(withLead(hoursAgo(1)));
      TestAssertEqual_(g.level + ',' + Math.round(g.ageHours), 'GREEN,1', 'freshness: a lead assigned an hour ago is GREEN');
      TestAssertEqual_(freshOf(withLead(hoursAgo(4))).level, 'AMBER', 'freshness: 4 hours is AMBER');
      TestAssertEqual_(freshOf(withLead(hoursAgo(6))).level, 'RED', 'freshness: 6 hours is RED');
      TestAssertContains_(freshOf(withLead(hoursAgo(6))).text, 'would describe stale data', 'freshness: RED says why it matters');
      const mixed = freshOf(function (header) {
        return [TestCR_leadRow_(header, { lead_id: 'L-1', client_id: 'C-1', lead_assigned_at: hoursAgo(6) }), TestCR_leadRow_(header, { lead_id: 'L-2', client_id: 'C-2', lead_assigned_at: new Date(Date.now() + 5 * 3600000) })];
      });
      TestAssertEqual_(mixed.level, 'RED', 'freshness: an assignment time in the future is ignored (bad data cannot make a stale tab look fresh)');
      const two = freshOf(function (header) { return [TestCR_leadRow_(header, { lead_id: 'L-1', client_id: 'C-1', lead_assigned_at: hoursAgo(30) }), TestCR_leadRow_(header, { lead_id: 'L-2', client_id: 'C-2', lead_assigned_at: hoursAgo(2) })]; });
      TestAssertEqual_(two.level, 'GREEN', 'freshness: the NEWEST lead decides, not the oldest');
      TestAssertContains_(freshOf(withLead(hoursAgo(6))).text, 'older than 5 h', 'freshness: RED names the 5 h line');
      TestAssertContains_(freshOf(withLead(hoursAgo(4))).text, 'older than 3 h', 'freshness: AMBER names the 3 h line');
      TestAssertEqual_(freshOf(null).level, 'UNKNOWN', 'freshness: a Leads tab with no leads is UNKNOWN');
      TestAssertEqual_(cycleLeadsFreshnessGs_(TestMockSpreadsheet_({}), new Date()).level, 'UNKNOWN', 'freshness: an unreadable Leads tab is UNKNOWN, not a crash');
      // end to end: a stale tab shows in the report that goes to Snehil
      const ssS = TestCR_world_(function (header) { return [TestCR_leadRow_(header, { lead_id: 'L-STALE', client_id: 'C-STALE', lead_assigned_at: hoursAgo(6) })]; });
      TestCR_bind_(ssS);
      sendAllIssuesEmails();
      const built = sendEmailCycleReport_({ now: new Date(Date.now() + 60000) });
      TestAssert_(built.data.freshness.level === 'RED' && built.data.allClear === false, 'freshness report: a RED Leads tab means the report is not all clear');
      TestAssertContains_(built.plainBody, 'LEADS RED', 'freshness report: and says so');
    }

    // ================= the Daily_Report row =================
    {
      const ssD = TestCR_world_(TestCR_standardLeads_);
      TestCR_bind_(ssD);
      sendAllIssuesEmails();
      const dailyNow = new Date(Date.now() + 60000); // the report time; its IST day is the row's day (a run just before midnight crosses into the next day)
      const day = istDayKeyGs_(dailyNow);
      sendEmailCycleReport_({ now: dailyNow });
      const daily = function () { return TestEL_objects_(ssD.getSheetByName(CYCLE_REPORT_DAILY_SHEET_), CYCLE_REPORT_DAILY_HEADERS_); };
      TestAssertEqual_(daily().length, 1, 'daily row: one row is written');
      const d = daily()[0];
      TestAssertEqual_([d.report_day, d.planned, d.accepted, d.failed, d.leads_sent, d.all_clear, d.leads_freshness].join(','), day + ',1,1,0,2,yes,GREEN', 'daily row: the day, the counts, all-clear and the freshness level');
      TestAssert_(d.sent_at instanceof Date && d.window_start instanceof Date && d.window_end instanceof Date, 'daily row: the send time and the cycle window are stored');
      sendEmailCycleReport_({ now: dailyNow, force: true });
      TestAssertEqual_(daily().length, 1, 'daily row: a forced re-send the same day UPDATES the row instead of adding a second');
      const other = cycleReportDataGs_({ window: win, ledgerRows: [], exclusionRows: [], incidentRows: [] });
      cycleReportRecordDailyGs_(ssD, other, new Date(Date.now() + 30 * 3600000));
      TestAssertEqual_(daily().length + ',' + daily()[1].planned, '2,0', 'daily row: a different day gets its own row');
      const failing = cycleReportDataGs_({ window: win, ledgerRows: [L('allIssues17', 'FAILED')], exclusionRows: [], incidentRows: [] });
      cycleReportRecordDailyGs_(ssD, failing, new Date(Date.now() + 54 * 3600000));
      TestAssertEqual_(daily().length + ',' + daily()[2].failed + ',' + daily()[2].all_clear, '3,1,no', 'daily row: a day with a failed email is recorded as NOT all clear');
      // a broken Daily_Report sheet never stops the report
      const ssB = TestCR_world_(TestCR_standardLeads_);
      ssB._sheets['Daily_Report'] = TestMockSheet_('Daily_Report', [['wrong', 'header']]);
      TestCR_bind_(ssB);
      sendAllIssuesEmails();
      const draftsBefore = TestGmailLog_.drafts.length;
      sendEmailCycleReport_({ now: new Date(Date.now() + 60000) });
      TestAssertEqual_(TestGmailLog_.drafts.length, draftsBefore + 1, 'daily row: a broken Daily_Report sheet does not stop the report email');
      TestAssertEqual_(ssB.getSheetByName('Daily_Report').getLastRow(), 1, 'daily row: and nothing is written into the unrecognised sheet');
      // test mode
      const ssT = TestCR_world_(TestCR_standardLeads_);
      TestCR_bind_(ssT);
      TEST_MODE_OVERRIDE_EMAIL_ = TEST_EMAIL_PRIMARY_;
      try { sendEmailCycleReport_({ now: new Date(Date.now() + 60000) }); } finally { TEST_MODE_OVERRIDE_EMAIL_ = ''; }
      TestAssert_(!ssT.getSheetByName(CYCLE_REPORT_DAILY_SHEET_), 'daily row: test mode writes nothing');
    }

    // ================= the trigger entry points =================
    {
      const ss = TestCR_world_(TestCR_standardLeads_);
      TestCR_bind_(ss);
      sendEmailCycleReport();
      TestAssertEqual_(readEmailJobRunGs_(CYCLE_REPORT_JOB_).status, 'completed', 'trigger: the run is recorded (so the watchdog can see it)');
      TestAssertEqual_(TestGmailLog_.drafts.length, 1, 'trigger: one report is sent');
      // a crash alerts at once and is re-thrown
      TestCR_bind_(ss);
      const realBuild = buildEmailCycleReportGs_;
      buildEmailCycleReportGs_ = function () { throw new Error('simulated report failure'); };
      try { TestAssertThrows_(function () { sendEmailCycleReport(); }, 'trigger: a crash is re-thrown (Executions shows Failed)'); } finally { buildEmailCycleReportGs_ = realBuild; }
      const crash = TestGmailLog_.sent.filter(function (e) { return /sendEmailCycleReport crashed/.test(e.subject); });
      TestAssertEqual_(crash.length, 1, 'trigger: a crash raises one alert');
      TestAssertEqual_(readEmailJobRunGs_(CYCLE_REPORT_JOB_).status, 'failed', 'trigger: …and the run record says failed');
      // the forced re-send
      TestCR_bind_(ss);
      sendEmailCycleReport();
      sendEmailCycleReportNow();
      TestAssertEqual_(TestGmailLog_.drafts.length, 2, 'trigger: sendEmailCycleReportNow sends again even though today\'s report went out');
    }
    {
      // The report must never take the script-wide job lock: a nearMinute(30) trigger can still be running when the 17:00 job fires (from 16:45), and a lock held
      // then would make the PRIMARY send skip. It also must not be skipped itself because an email job holds the lock.
      const ss = TestCR_world_(TestCR_standardLeads_);
      TestCR_bind_(ss);
      LockService = TestMockLockService_({ denyLock: true }); // pretend another job holds the lock
      sendEmailCycleReport();
      TestAssertEqual_(TestGmailLog_.drafts.length, 1, 'no lock: the report is sent even while another job holds the script lock');
      TestAssertEqual_(LockService._state.tryLockCalls + ',' + LockService._state.getCalls, '0,0', 'no lock: it never even asks for the script lock, so it can never make the 17:00 job skip');
      TestAssert_(!TestGmailLog_.sent.some(function (e) { return /SKIPPED/.test(e.subject); }), 'no lock: nothing is raised as skipped');
      TestAssertEqual_(readEmailJobRunGs_(CYCLE_REPORT_JOB_).status, 'completed', 'no lock: the run is still recorded for the watchdog');
      sendEmailCycleReportNow();
      TestAssertEqual_(TestGmailLog_.drafts.length + ',' + LockService._state.tryLockCalls, '2,0', 'no lock: the deliberate re-send does not take the script lock either');
      LockService = TestMockLockService_();
    }
    {
      // setup installs ONE trigger near 16:30 IST and replaces its own earlier one
      ScriptApp = TestMockScriptApp_(['sendEmailCycleReport', 'someOtherJob']);
      setupEmailCycleReportTrigger();
      TestAssertEqual_(ScriptApp._state.created.length, 1, 'setup: exactly one trigger is created');
      const spec = ScriptApp._state.created[0];
      TestAssertEqual_(spec.fnName + ',' + spec.hour + ',' + spec.minute + ',' + spec.days + ',' + spec.tz, 'sendEmailCycleReport,16,30,1,Asia/Kolkata', 'setup: daily, near 16:30, in IST');
      TestAssertEqual_(ScriptApp._state.deleted.join(','), 'sendEmailCycleReport', 'setup: only its own earlier trigger is deleted');
    }

    // ================= the watchdog knows the 16:30 job =================
    {
      TestCR_bind_(TestMockSpreadsheet_({}));
      const sched = emailJobScheduleGs_().sendEmailCycleReport;
      TestAssertEqual_(sched ? sched.hour + ':' + sched.minute + ' ' + sched.label : 'missing', '16:30 16:30 cycle report', 'watchdog: the schedule lists the 16:30 report with its minute');
      const at = function (iso) { return emailJobProblemsGs_(new Date(iso)).filter(function (p) { return p.job === 'sendEmailCycleReport'; }); };
      TestAssertEqual_(at('2026-10-09T16:59:00+05:30').length, 0, 'watchdog: before 17:00 (16:30 + the 30-minute grace) a missing report is not yet a problem');
      const late = at('2026-10-09T17:05:00+05:30');
      TestAssertEqual_(late.length + ',' + (late[0] ? late[0].kind : ''), '1,never_started', 'watchdog: at 17:05 a report that did not run is flagged');
      TestAssertContains_(late[0] ? late[0].detail : '', 'should have started by 17:00 IST', 'watchdog: …with the real deadline, 17:00');
      // the other jobs' wording is unchanged
      const o = emailJobProblemsGs_(new Date('2026-10-09T17:35:00+05:30')).filter(function (p) { return p.job === 'sendAllIssuesEmails'; });
      TestAssertContains_(o[0] ? o[0].detail : '', 'should have started by 17:30 IST', 'watchdog: the 17:00 job still has its 17:30 deadline text');
    }

    TestAssertOnlyTestEmails_();
  } finally {
    TEST_MODE_OVERRIDE_EMAIL_ = '';
    TestEnv_tearDown_();
  }
  return TestResults_;
}

function runCycleReportTestsNow() { runCycleReportTests_(); }
