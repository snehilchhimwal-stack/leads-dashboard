/**
 * Tests: DailyChecklist.gs - the daily checklist A-K (Email Ops EO-6). Run runDailyChecklistTestsNow() from the function dropdown, or via runAllTests()
 * (Tests_RunAll.gs). Everything is in-memory (sheets, Gmail, Properties are fakes - see Tests_Mocks.gs); nothing is sent for real.
 *
 * Two layers: the pure stage rules against hand-built cycle data (every flag of every stage), then the real report built from real job runs - all GREEN first, then
 * with one piece of evidence damaged at a time - and the Daily_Checklist tab (one set of rows per day, replaced not duplicated, fail-open).
 */

// ---- helpers ----

function TestDC_counts_(planned, accepted, extra) {
  return Object.assign({ planned: planned, accepted: accepted, skipped: 0, failed: 0, unconfirmed: 0, blocked: 0, unfinished: 0, leadsSent: accepted }, extra || {});
}

// A cycle in which everything is fine, with the pieces a test wants to change passed in.
function TestDC_data_(o) {
  const now = new Date();
  const base = {
    cycle: { start: new Date(now.getTime() - 24 * 3600 * 1000), end: new Date(now.getTime() + 60000) }, // a minute of room: an audit record made a moment later is still inside the cycle
    byJob: { allIssues17: TestDC_counts_(4, 4), chLevel17: TestDC_counts_(1, 1), morning10: TestDC_counts_(3, 3), followup13: TestDC_counts_(3, 3) },
    totals: TestDC_counts_(11, 11),
    sweep: { bounced: 0, replied: 1, noBounce: 10, notSwept: 0, lastSweep: now, replies: [] },
    freshness: { level: 'GREEN', ageHours: 1, newest: now, text: 'GREEN: the newest lead was assigned 1 h ago' },
    exclusions: { leads: 0, regions: 0, reasons: [] }, seriousIncidents: 0, heldNow: 0, empty: false,
  };
  return Object.assign(base, o || {});
}

function TestDC_audit_(status, extra) {
  return Object.assign({ day: istDayKeyGs_(new Date()), ranAt: new Date().toISOString(), status: status, count: status === 'exceptions' ? 1 : 0, codes: status === 'exceptions' ? ['ACCEPTED_WITHOUT_LOG'] : [], reason: '' }, extra || {});
}

function TestDC_input_(o) {
  return Object.assign({ data: TestDC_data_(), jobProblems: [], audits: { morning: TestDC_audit_('clean'), followup: TestDC_audit_('clean'), allIssues: TestDC_audit_('clean') } }, o || {});
}

function TestDC_flags_(rows) { return rows.map(function (r) { return r.flag; }).join(','); }
function TestDC_row_(rows, stage) { return rows.filter(function (r) { return r.stage === stage; })[0]; }

function runDailyChecklistTests_() {
  TestEnv_setUp_('Tests_DailyChecklist', TestMockSpreadsheet_({}));
  try {
    // ================= helpers =================
    TestAssertEqual_([dailyChecklistWorstGs_(['GREEN', 'RED', 'AMBER']), dailyChecklistWorstGs_(['GREEN', 'AMBER']), dailyChecklistWorstGs_(['GREY', 'GREEN']), dailyChecklistWorstGs_(['GREY']), dailyChecklistWorstGs_([])].join(','),
      'RED,AMBER,GREEN,GREY,GREY', 'worst flag: RED > AMBER > GREEN > GREY, and GREY only when there is nothing else');
    {
      const by = { a: TestDC_counts_(2, 1, { failed: 1 }), b: TestDC_counts_(3, 3) };
      const sum = dailyChecklistCountsGs_(by, ['a', 'b', 'missing']);
      TestAssertEqual_([sum.planned, sum.accepted, sum.failed].join(','), '5,4,1', 'counts: the jobs are added together, an absent job adds nothing');
      TestAssertEqual_(String(dailyChecklistCountsGs_(by, ['missing'])) + ',' + String(dailyChecklistCountsGs_(null, ['a'])), 'null,null', 'counts: no row for any of the jobs -> null (missing evidence, not zero)');
      TestAssertEqual_([TestDC_counts_(2, 2), TestDC_counts_(2, 1, { unconfirmed: 1 }), TestDC_counts_(2, 1, { failed: 1 }), TestDC_counts_(2, 1, { blocked: 1 }), TestDC_counts_(2, 1, { unfinished: 1 }), TestDC_counts_(0, 0)]
        .map(function (c) { return String(dailyChecklistSendFlagGs_(c)); }).join(','), 'GREEN,AMBER,RED,RED,RED,null', 'send flag: failed / blocked / unfinished are RED, unconfirmed AMBER, otherwise GREEN, nothing planned -> null');
      TestAssertEqual_(dailyChecklistSendTextGs_(TestDC_counts_(5, 3, { skipped: 1, failed: 1 })), '3 of 4 accepted by Gmail, 1 had nothing to send, 1 failed', 'send text: accepted of (planned minus skipped), then what else happened');
    }
    {
      const win = { start: new Date('2026-10-09T10:00:00Z'), end: new Date('2026-10-10T10:00:00Z') };
      const at = function (iso, o) { return Object.assign({ ranAt: iso, status: 'clean', count: 0, codes: [], reason: '' }, o || {}); };
      TestAssertEqual_(dailyChecklistAuditGs_(at('2026-10-10T08:00:00Z'), win, '13:00').flag, 'GREEN', 'audit: a clean result inside the cycle is GREEN');
      const ex = dailyChecklistAuditGs_(at('2026-10-10T08:00:00Z', { status: 'exceptions', count: 2, codes: ['UNFINISHED', 'DUPLICATE_LOG'] }), win, '13:00');
      TestAssertEqual_(ex.flag + ',' + (ex.text.indexOf('2 exception(s): UNFINISHED, DUPLICATE_LOG') !== -1), 'RED,true', 'audit: exceptions are RED, with the count and codes');
      TestAssertEqual_(['deferred', 'skipped', 'failed'].map(function (s) { return dailyChecklistAuditGs_(at('2026-10-10T08:00:00Z', { status: s, reason: 'why' }), win, 'x').flag; }).join(','), 'AMBER,AMBER,AMBER', 'audit: deferred, skipped and failed are AMBER (not a confirmed failure)');
      TestAssertEqual_(dailyChecklistAuditGs_(at('2026-10-08T08:00:00Z'), win, 'x').flag + ',' + dailyChecklistAuditGs_(null, win, 'x').flag + ',' + dailyChecklistAuditGs_({ status: 'clean' }, win, 'x').flag, 'AMBER,AMBER,AMBER', 'audit: a result from before the cycle, none at all, or one without a time is missing evidence -> AMBER');
    }

    // ================= the stages =================
    {
      const rows = dailyChecklistGs_(TestDC_input_());
      TestAssertEqual_(rows.map(function (r) { return r.stage; }).join(''), 'ABCDEFGHIJK', 'stages: eleven rows, A to K, in order');
      TestAssertEqual_(TestDC_flags_(rows), 'GREEN,GREEN,GREEN,GREEN,GREEN,GREEN,GREEN,GREEN,GREEN,GREEN,GREEN', 'baseline: a clean cycle is GREEN at every stage, including the reconciliation');
      TestAssert_(rows.every(function (r) { return r.name && r.evidence; }), 'baseline: every row names its check and carries evidence');
    }
    // A
    {
      const a = function (p) { return TestDC_row_(dailyChecklistGs_(TestDC_input_({ jobProblems: p })), 'A'); };
      TestAssertEqual_(a(null).flag, 'AMBER', 'A: run records that cannot be read -> AMBER (missing evidence)');
      TestAssertEqual_(a([{ job: 'sendAllIssuesEmails', kind: 'never_started' }]).flag, 'RED', 'A: a job that never started -> RED');
      TestAssertEqual_(a([{ job: 'x', kind: 'unreadable' }]).flag, 'AMBER', 'A: an unreadable record alone is AMBER, not a confirmed failure');
      TestAssertEqual_(a([{ job: 'x', kind: 'unreadable' }, { job: 'y', kind: 'failed' }]).flag, 'RED', 'A: …but with a real failure alongside it is RED');
      TestAssertContains_(a([{ job: 'sendOvernightFollowupEmails', kind: 'failed' }, { job: 'b', kind: 'stuck' }]).evidence, 'sendOvernightFollowupEmails failed, b stuck', 'A: the evidence names the jobs and the problem');
    }
    // B
    {
      const b = function (fr) { return TestDC_row_(dailyChecklistGs_(TestDC_input_({ data: TestDC_data_({ freshness: fr }) })), 'B'); };
      TestAssertEqual_([b({ level: 'GREEN', text: 't' }).flag, b({ level: 'AMBER', text: 't' }).flag, b({ level: 'RED', text: 't' }).flag, b({ level: 'UNKNOWN', text: 't' }).flag, b(null).flag].join(','), 'GREEN,AMBER,RED,AMBER,AMBER',
        'B: the Leads tab freshness maps straight across; UNKNOWN or not checked is AMBER (missing evidence)');
      TestAssertEqual_(b({ level: 'RED', text: 'RED: the newest lead is old' }).evidence, 'RED: the newest lead is old', 'B: the evidence is the freshness text');
    }
    // C and D
    {
      const cd = function (o) { const r = dailyChecklistGs_(TestDC_input_({ data: TestDC_data_(o) })); return TestDC_row_(r, 'C').flag + '/' + TestDC_row_(r, 'D').flag; };
      TestAssertEqual_(cd({}), 'GREEN/GREEN', 'C/D: nothing left out -> GREEN');
      TestAssertEqual_(cd({ exclusions: { leads: 2, regions: 0, reasons: [{ reason: 'the send-safety gate objected', leads: 2, regions: 0 }] } }), 'AMBER/GREEN', 'C/D: leads left out for another reason -> C AMBER, D still GREEN');
      TestAssertEqual_(cd({ exclusions: { leads: 1, regions: 0, reasons: [{ reason: 'defective lead: no reason for contact', leads: 1, regions: 0 }] } }), 'AMBER/AMBER', 'C/D: a lead dropped for lacking a reason for contact -> D AMBER too');
      TestAssertEqual_(cd({ exclusions: { leads: 0, regions: 1, reasons: [{ reason: 'Section 1 already sent', leads: 0, regions: 1 }] } }), 'AMBER/GREEN', 'C/D: a region run skipped -> C AMBER');
      TestAssertEqual_(cd({ empty: true, byJob: {}, totals: TestDC_counts_(0, 0) }), 'AMBER/AMBER', 'C/D: no email recorded at all -> missing evidence, AMBER');
    }
    // E, F, H, I
    {
      const stage = function (byJob, s, extra) { return TestDC_row_(dailyChecklistGs_(TestDC_input_(Object.assign({ data: TestDC_data_({ byJob: byJob, totals: TestDC_counts_(1, 1) }) }, extra || {}))), s); };
      const ok = { allIssues17: TestDC_counts_(2, 2), morning10: TestDC_counts_(2, 2), followup13: TestDC_counts_(2, 2) };
      TestAssertEqual_(['E', 'F', 'H', 'I'].map(function (s) { return stage(ok, s).flag; }).join(','), 'GREEN,GREEN,GREEN,GREEN', 'E/F/H/I: all accepted -> GREEN');
      TestAssertEqual_(stage(Object.assign({}, ok, { morning10: TestDC_counts_(2, 1, { failed: 1 }) }), 'E').flag, 'RED', 'E: a failed 10:00 email -> RED');
      TestAssertEqual_(stage(Object.assign({}, ok, { morning10: TestDC_counts_(2, 1, { unconfirmed: 1 }) }), 'E').flag, 'AMBER', 'E: an unconfirmed 10:00 email -> AMBER');
      TestAssertEqual_(stage(Object.assign({}, ok, { chLevel10: TestDC_counts_(1, 0, { blocked: 1 }) }), 'E').flag, 'RED', 'E: the CH-level overnight report counts with the 10:00 emails (blocked -> RED)');
      TestAssertEqual_(stage({ allIssues17: ok.allIssues17, followup13: ok.followup13 }, 'E').flag, 'AMBER', 'E: no 10:00 row at all -> AMBER (missing evidence)');
      TestAssertEqual_(stage(Object.assign({}, ok, { followup13: TestDC_counts_(2, 1, { unfinished: 1 }) }), 'F').flag, 'RED', 'F: a 13:00 reply left unfinished -> RED');
      TestAssertEqual_(stage({ allIssues17: ok.allIssues17, morning10: ok.morning10 }, 'F').flag, 'AMBER', 'F: 10:00 emails went out but no 13:00 reply is recorded -> AMBER');
      TestAssertEqual_(stage({ allIssues17: ok.allIssues17 }, 'F').flag, 'GREY', 'F: no 10:00 email, so nothing to reply to -> GREY (not applicable)');
      TestAssertEqual_(stage({ allIssues17: ok.allIssues17, morning10: TestDC_counts_(2, 0, { skipped: 2 }), followup13: TestDC_counts_(2, 0, { skipped: 2 }) }, 'F').flag, 'GREEN', 'F: every 13:00 reply skipped because nothing was unresolved is still GREEN (a result, not a gap)');
      TestAssertEqual_(stage(Object.assign({}, ok, { allIssues17: TestDC_counts_(2, 1, { unfinished: 1 }) }), 'H').flag, 'RED', 'H: a 17:00 bucket left unfinished -> RED');
      TestAssertEqual_(stage({ morning10: ok.morning10 }, 'H').flag + ',' + stage({ morning10: ok.morning10 }, 'I').flag, 'AMBER,AMBER', 'H/I: no 17:00 row -> AMBER');
      TestAssertEqual_(stage(Object.assign({}, ok, { allIssues17: TestDC_counts_(2, 1, { failed: 1 }) }), 'I').flag, 'RED', 'I: a failed 17:00 bucket -> RED');
      TestAssertEqual_(stage(Object.assign({}, ok, { chLevel17: TestDC_counts_(1, 0, { unconfirmed: 1 }) }), 'I').flag, 'AMBER', 'I: an unconfirmed CH-level 17:00 report -> AMBER');
      TestAssertContains_(stage(ok, 'I').evidence, 'the 17:00 audit was clean', 'I: the evidence includes the 17:00 audit');
      TestAssertEqual_(stage(ok, 'I', { audits: { allIssues: TestDC_audit_('exceptions') } }).flag, 'RED', 'I: an audit exception makes the 17:00 stage RED even when every email was accepted');
      TestAssertEqual_(stage(ok, 'I', { audits: {} }).flag, 'AMBER', 'I: no audit result in the cycle -> AMBER');
    }
    // G
    {
      const g = function (audits) { return TestDC_row_(dailyChecklistGs_(TestDC_input_({ audits: audits })), 'G'); };
      TestAssertEqual_(g({ morning: TestDC_audit_('clean'), followup: TestDC_audit_('clean') }).flag, 'GREEN', 'G: both audits clean -> GREEN');
      TestAssertEqual_(g({ morning: TestDC_audit_('clean'), followup: TestDC_audit_('exceptions') }).flag, 'RED', 'G: one audit with exceptions -> RED');
      TestAssertEqual_(g({ morning: TestDC_audit_('deferred'), followup: TestDC_audit_('clean') }).flag, 'AMBER', 'G: one audit deferred -> AMBER');
      TestAssertEqual_(g({}).flag, 'AMBER', 'G: no audit result at all -> AMBER, never RED (missing evidence)');
      TestAssertContains_(g({ morning: TestDC_audit_('exceptions'), followup: TestDC_audit_('clean') }).evidence, 'the 10:00 audit found 1 exception(s): ACCEPTED_WITHOUT_LOG; the 13:00 audit was clean', 'G: the evidence covers both audits');
    }
    // J
    {
      const j = function (o) { return TestDC_row_(dailyChecklistGs_(TestDC_input_({ data: TestDC_data_(o) })), 'J'); };
      const now = new Date();
      TestAssertEqual_(j({}).flag, 'GREEN', 'J: swept, no bounce -> GREEN');
      TestAssertEqual_(j({ sweep: { bounced: 2, replied: 0, noBounce: 5, notSwept: 0, lastSweep: now, replies: [] } }).flag, 'RED', 'J: a bounce -> RED');
      TestAssertEqual_(j({ sweep: { bounced: 0, replied: 0, noBounce: 0, notSwept: 4, lastSweep: null, replies: [] } }).flag, 'AMBER', 'J: the sweep has not run -> AMBER');
      TestAssertEqual_(j({ sweep: { bounced: 0, replied: 0, noBounce: 3, notSwept: 1, lastSweep: now, replies: [] } }).flag, 'AMBER', 'J: some accepted emails not checked yet -> AMBER');
      TestAssertEqual_(j({ totals: TestDC_counts_(2, 0, { skipped: 2 }) }).flag, 'GREY', 'J: nothing was accepted, so nothing to monitor -> GREY');
      TestAssertContains_(j({}).evidence, 'not proof of delivery', 'J: the evidence never claims delivery');
    }
    // K
    {
      const k = function (input) { return TestDC_row_(dailyChecklistGs_(input), 'K'); };
      TestAssertEqual_(k(TestDC_input_()).flag, 'GREEN', 'K: every stage fine and nothing open -> GREEN');
      TestAssertEqual_(k(TestDC_input_({ jobProblems: [{ job: 'x', kind: 'failed' }] })).flag, 'RED', 'K: any RED stage makes the day RED');
      TestAssertEqual_(k(TestDC_input_({ audits: {} })).flag, 'AMBER', 'K: an AMBER stage makes the day AMBER');
      TestAssertEqual_(k(TestDC_input_({ data: TestDC_data_({ seriousIncidents: 1 }) })).flag, 'AMBER', 'K: a serious incident keeps the day from GREEN even when every stage is');
      TestAssertEqual_(k(TestDC_input_({ data: TestDC_data_({ heldNow: 2 }) })).flag, 'AMBER', 'K: alerts still held keep the day from GREEN');
      TestAssertContains_(k(TestDC_input_({ data: TestDC_data_({ heldNow: 2, seriousIncidents: 3 }) })).evidence, '3 serious incident(s), 2 alert(s) still held', 'K: the evidence counts the open incidents');
    }

    // ================= the report section =================
    {
      const rows = dailyChecklistGs_(TestDC_input_());
      const sec = dailyChecklistSectionGs_(rows);
      TestAssertEqual_(sec.heading + '|' + sec.columns.join(',') + '|' + sec.rows.length + '|' + String(sec.accent), 'Daily checklist (A-K)|Stage,Check,Flag,Evidence|11|undefined', 'section: eleven rows, four columns, default accent when nothing is RED');
      const red = dailyChecklistSectionGs_(dailyChecklistGs_(TestDC_input_({ jobProblems: [{ job: 'x', kind: 'failed' }] })));
      TestAssertEqual_(red.accent && red.accent.fg, '#dc2626', 'section: red accent when any stage is RED');
      TestAssertContains_(sec.subheading, 'never reported as a failure', 'section: it explains that missing evidence is AMBER, not a failure');
    }

    // ================= the Daily_Checklist tab =================
    {
      const ss = TestMockSpreadsheet_({});
      const day = istDayKeyGs_(new Date());
      const rowsA = dailyChecklistGs_(TestDC_input_());
      const read = function () { return TestEL_objects_(ss.getSheetByName(DAILY_CHECKLIST_SHEET_), DAILY_CHECKLIST_HEADERS_); };
      dailyChecklistRecordGs_(ss, rowsA, new Date());
      TestAssertEqual_(read().length + ',' + read()[0].report_day + ',' + read()[0].stage + ',' + read()[10].stage, '11,' + day + ',A,K', 'tab: eleven rows for the day, A first and K last');
      TestAssertEqual_(ss.getSheetByName(DAILY_CHECKLIST_SHEET_).getRange(1, 1, 1, 6).getValues()[0].join(','), DAILY_CHECKLIST_HEADERS_.join(','), 'tab: created with its header row');
      const rowsB = dailyChecklistGs_(TestDC_input_({ jobProblems: [{ job: 'x', kind: 'failed' }] }));
      dailyChecklistRecordGs_(ss, rowsB, new Date());
      TestAssertEqual_(read().length + ',' + read()[0].flag, '11,RED', 'tab: sending the report again the same day REPLACES the rows (no duplicates) and shows the newer flags');
      // a new day appends a second set
      dailyChecklistRecordGs_(ss, rowsA, new Date(Date.now() + 24 * 3600 * 1000));
      TestAssertEqual_(read().length + ',' + read()[11].report_day + ',' + read()[0].report_day, '22,' + istDayKeyGs_(new Date(Date.now() + 24 * 3600 * 1000)) + ',' + day, 'tab: the next day adds its own eleven rows and leaves the earlier day alone');
      // a damaged block (a row lost by hand) is replaced whole, not left partial
      ss.getSheetByName(DAILY_CHECKLIST_SHEET_).deleteRows(15, 1);
      dailyChecklistRecordGs_(ss, rowsB, new Date(Date.now() + 24 * 3600 * 1000));
      TestAssertEqual_(read().length + ',' + read().filter(function (r) { return r.report_day === istDayKeyGs_(new Date(Date.now() + 24 * 3600 * 1000)); }).length, '22,11', 'tab: a partial block for the day is replaced by a full one');
      // long evidence is cut, TEST MODE writes nothing, a broken tab never throws
      const long = [{ stage: 'A', name: 'n', flag: 'GREEN', evidence: new Array(700).join('x') }];
      const ss2 = TestMockSpreadsheet_({});
      dailyChecklistRecordGs_(ss2, long, new Date());
      TestAssertEqual_(TestEL_objects_(ss2.getSheetByName(DAILY_CHECKLIST_SHEET_), DAILY_CHECKLIST_HEADERS_)[0].evidence.length, 500, 'tab: evidence is cut to 500 characters');
      const ss3 = TestMockSpreadsheet_({});
      TEST_MODE_OVERRIDE_EMAIL_ = TEST_EMAIL_PRIMARY_;
      try { dailyChecklistRecordGs_(ss3, rowsA, new Date()); } finally { TEST_MODE_OVERRIDE_EMAIL_ = ''; }
      TestAssert_(!ss3.getSheetByName(DAILY_CHECKLIST_SHEET_), 'tab: TEST MODE creates and writes nothing');
      const realEnsure = emailLedgerEnsureSheetGs_;
      emailLedgerEnsureSheetGs_ = function () { throw new Error('simulated: the tab cannot be opened'); };
      let threw = false;
      try { dailyChecklistRecordGs_(TestMockSpreadsheet_({}), rowsA, new Date()); } catch (e) { threw = true; } finally { emailLedgerEnsureSheetGs_ = realEnsure; }
      TestAssertEqual_(threw, false, 'tab: a failure to store the rows is swallowed - the report is never affected');
    }

    // ================= the real report =================
    {
      // a cycle built by the real jobs: 17:00 -> 10:00 -> 13:00, a fresh closed lead so the Leads tab is GREEN
      const header = TestFixture_leadsHeader_();
      const banner = header.map(function () { return ''; });
      const now0 = new Date();
      const ss = TestMockSpreadsheet_({
        'RM_Hierarchy': TestMockSheet_('RM_Hierarchy', TestFixture_rmHierarchyRows_()),
        'Manager_Directory': TestMockSheet_('Manager_Directory', TestFixture_managerDirectoryRows_()),
      });
      ss._sheets['leads'] = TestMockSheet_('leads', [banner, header,
        TestEL_leadRow_(header, {
          lead_id: 'L-CYCLE', client_id: 'C-CYCLE', RM: 'Test RM One', current_stage: 'Suspect', lead_assigned_at: TestFixture_hoursAgo_(now0, 40),
          last_connect: 'Connected', last_connect_time: TestFixture_hoursAgo_(now0, 10),
          internal_status_comments: 'Test RM One: Ringing - ' + Utilities.formatDate(TestFixture_hoursAgo_(now0, 10), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm'),
        }),
        TestEL_leadRow_(header, { lead_id: 'L-NEW', client_id: 'C-NEW', current_stage: 'Won', lead_assigned_at: now0 }),
      ]);
      TestEL_bind_(ss);
      // each silent audit runs when its job is over, exactly as in production (the 17:00 audit before the log row is dated yesterday)
      sendAllIssuesEmails();
      opsAuditRun_(OPS_AUDIT_SPECS_.allIssues, { now: new Date() });
      ss.getSheetByName('AllIssues_Log').getRange(2, 1, 1, 1).setValues([[TestFixture_daysAgo_(now0, 1)]]);
      sendOvernightMorningEmails();
      opsAuditRun_(OPS_AUDIT_SPECS_.morning, { now: new Date() });
      sendOvernightFollowupEmails();
      opsAuditRun_(OPS_AUDIT_SPECS_.followup, { now: new Date() });
      const reportNow = new Date(Date.now() + 60000);
      // the evidence the other jobs would have left: a run record for every scheduled job, the sweep columns, and the three audits
      Object.keys(emailJobScheduleGs_()).forEach(function (j) {
        writeEmailJobRunGs_(j, { day: istDayKeyGs_(reportNow), startedAt: new Date(reportNow.getTime() - 3600000).toISOString(), finishedAt: new Date(reportNow.getTime() - 3500000).toISOString(), status: 'completed' });
      });
      const ledgerSheet = ss.getSheetByName(EMAIL_LEDGER_SHEET_);
      emailLedgerReadRowsGs_(ledgerSheet, EMAIL_LEDGER_HEADERS_, istDayKeyGs_(now0)).forEach(function (r) {
        if (r.status === 'ACCEPTED') ledgerSheet.getRange(r.rowNo, emailLedgerCol_('bounce_status'), 1, 3).setValues([['NO_BOUNCE_SEEN', 'NO_REPLY_SEEN', new Date(reportNow.getTime() - 60000)]]);
      });

      const built = buildEmailCycleReportGs_(ss, reportNow);
      const cl = built.data.checklist;
      TestAssertEqual_(cl ? cl.map(function (r) { return r.stage + ':' + r.flag; }).join(' ') : 'none', 'A:GREEN B:GREEN C:GREEN D:GREEN E:GREEN F:GREEN G:GREEN H:GREEN I:GREEN J:GREEN K:GREEN',
        'real cycle: every stage GREEN when every job ran, every email was accepted, the tab is fresh, the sweep ran and the audits were clean');
      TestAssertContains_(built.plainBody, 'Daily checklist (A-K)', 'real cycle: the report carries the checklist section');
      TestAssertContains_(built.html, 'Daily checklist (A-K)', 'real cycle: …in the HTML too');

      // the report is sent: the rows are stored once for the day, and again the same day they are replaced
      TestGmailLog_.sent.length = 0;
      sendEmailCycleReport_({ now: reportNow });
      sendEmailCycleReport_({ now: reportNow, force: true });
      const stored = TestEL_objects_(ss.getSheetByName(DAILY_CHECKLIST_SHEET_), DAILY_CHECKLIST_HEADERS_);
      TestAssertEqual_(stored.length + ',' + stored[0].report_day + ',' + stored[10].stage, '11,' + istDayKeyGs_(reportNow) + ',K', 'real cycle: sending the report stores eleven rows, and a second send replaces them');

      // one piece of evidence damaged at a time
      const damaged = function (damage) {
        const b = buildEmailCycleReportGs_(ss, reportNow);
        return b.data.checklist.map(function (r) { return r.stage + ':' + r.flag; }).join(' ');
      };
      const r17 = emailLedgerReadRowsGs_(ledgerSheet, EMAIL_LEDGER_HEADERS_, istDayKeyGs_(now0)).filter(function (r) { return r.job === 'allIssues17'; })[0];
      ledgerSheet.getRange(r17.rowNo, emailLedgerCol_('status'), 1, 1).setValues([['FAILED']]);
      TestAssertContains_(damaged(), 'H:GREEN I:RED', 'real cycle, a 17:00 bucket FAILED: only the send stage turns RED (it was prepared)');
      ledgerSheet.getRange(r17.rowNo, emailLedgerCol_('status'), 1, 1).setValues([['PLANNED']]);
      TestAssertContains_(damaged(), 'H:RED I:RED', 'real cycle, a 17:00 bucket left PLANNED: preparation and send are both RED (never marked complete because it was planned)');
      ledgerSheet.getRange(r17.rowNo, emailLedgerCol_('status'), 1, 1).setValues([['ACCEPTED']]);
      PropertiesService.getScriptProperties().setProperty('EMAIL_AUDIT_LAST_auditAllIssuesEmails', JSON.stringify({ day: istDayKeyGs_(reportNow), ranAt: new Date().toISOString(), status: 'exceptions', count: 1, codes: ['UNFINISHED'], reason: '' }));
      TestAssertContains_(damaged(), 'G:GREEN H:GREEN I:RED', 'real cycle, the 17:00 audit found an exception: the 17:00 stage is RED');
      const realProblems = emailJobProblemsGs_;
      emailJobProblemsGs_ = function () { return [{ job: 'sendOvernightFollowupEmails', kind: 'failed', detail: 'boom' }]; }; // what the watchdog reports for a failed run (its own clock rules are tested in Tests_EmailInfra.gs)
      try { TestAssertContains_(damaged(), 'A:RED', 'real cycle, the watchdog reports a failed job: the start-of-day stage is RED'); } finally { emailJobProblemsGs_ = realProblems; }
    }

    // ================= the report keeps working without it =================
    {
      const data = cycleReportDataGs_({ window: { start: new Date(Date.now() - 86400000), end: new Date() }, ledgerRows: [], exclusionRows: [], incidentRows: [], configProblems: [] });
      TestAssertEqual_(Array.isArray(data.checklist) && data.checklist.length === 11, true, 'report data: the checklist is built even from an empty cycle (every stage says what is missing)');
      TestAssertEqual_(TestDC_row_(data.checklist, 'E').flag + ',' + TestDC_row_(data.checklist, 'K').flag, 'AMBER,AMBER', 'report data: an empty cycle is AMBER (missing evidence), never GREEN and never a confirmed failure');
      const realFn = dailyChecklistGs_;
      dailyChecklistGs_ = function () { throw new Error('simulated checklist failure'); };
      let data2;
      try { data2 = cycleReportDataGs_({ window: { start: new Date(Date.now() - 86400000), end: new Date() }, ledgerRows: [], exclusionRows: [], incidentRows: [], configProblems: [] }); } finally { dailyChecklistGs_ = realFn; }
      TestAssertEqual_(data2.checklist === null && data2.empty === true, true, 'report data: a failure inside the checklist leaves the report data intact (no checklist section)');
      const rendered = cycleReportRenderGs_(data2, new Date());
      TestAssert_(rendered.plainBody.indexOf('Daily checklist') === -1 && rendered.subject.length > 0, 'report render: without a checklist the report is exactly as before');
    }

    TestAssertOnlyTestEmails_();
  } finally {
    TEST_MODE_OVERRIDE_EMAIL_ = '';
    TestEnv_tearDown_();
  }
  return TestResults_;
}

function runDailyChecklistTestsNow() { runDailyChecklistTests_(); }
