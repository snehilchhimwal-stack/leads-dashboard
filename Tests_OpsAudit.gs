/**
 * Tests: OpsAudit.gs - the silent audit passes (Email Ops EO-3 / EO-4). Run runOpsAuditTestsNow() from the function dropdown, or via runAllTests()
 * (Tests_RunAll.gs). Everything is in-memory (sheets, Gmail, Properties are fakes - see Tests_Mocks.gs); nothing is sent for real.
 *
 * Two layers: the pure rules against hand-built rows (every rule, every edge), then real jobs run against a fake workbook and audited - clean first, then
 * with exactly one piece of evidence damaged at a time, so each finding is proved to come from the damage and from nothing else.
 */

// ---- helpers (the cycle world is the same one Tests_EmailLedger.gs uses: one lead, 17:00 -> 10:00 -> 13:00) ----

function TestOA_cycleWorld_() {
  const header = TestFixture_leadsHeader_();
  const banner = header.map(function () { return ''; });
  const now = new Date();
  const ss = TestMockSpreadsheet_({
    'RM_Hierarchy': TestMockSheet_('RM_Hierarchy', TestFixture_rmHierarchyRows_()),
    'Manager_Directory': TestMockSheet_('Manager_Directory', TestFixture_managerDirectoryRows_()),
  });
  ss._sheets['leads'] = TestMockSheet_('leads', [banner, header, TestEL_leadRow_(header, {
    lead_id: 'L-CYCLE', client_id: 'C-CYCLE', RM: 'Test RM One', current_stage: 'Suspect',
    lead_assigned_at: TestFixture_hoursAgo_(now, 40), last_connect: 'Connected', last_connect_time: TestFixture_hoursAgo_(now, 10),
    internal_status_comments: 'Test RM One: Ringing - ' + Utilities.formatDate(TestFixture_hoursAgo_(now, 10), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm'),
  })]);
  return { ss: ss, header: header, now: now };
}

function TestOA_ageAllIssues_(w) { w.ss.getSheetByName('AllIssues_Log').getRange(2, 1, 1, 1).setValues([[TestFixture_daysAgo_(w.now, 1)]]); }

function TestOA_alerts_() { return TestGmailLog_.sent.filter(function (e) { return /^\[Overnight Emailer\] Email audit/.test(e.subject); }); }

// The ledger row for a job on a sheet, with its sheet row number.
function TestOA_ledgerRow_(ss, job) {
  return emailLedgerReadRowsGs_(ss.getSheetByName(EMAIL_LEDGER_SHEET_), EMAIL_LEDGER_HEADERS_, istDayKeyGs_(new Date())).filter(function (r) { return r.job === job; })[0];
}

function runOpsAuditTests_() {
  TestEnv_setUp_('Tests_OpsAudit', TestMockSpreadsheet_({}));
  try {
    const dayToday = istDayKeyGs_(new Date());
    const led = function (o) { return Object.assign({ job: 'allIssues17', region: 'Pune', bucket_label: 'Test A1 One', to: 'a@x.test', status: 'ACCEPTED' }, o || {}); };
    const alog = function (o) { return Object.assign({ day: dayToday, region: 'Pune', to: 'a@x.test', label: 'Test A1 One', leadCount: 2, cp1At: '' }, o || {}); };
    const olog = function (o) { return Object.assign({ day: dayToday, region: 'Pune', to: 'a@x.test', followupAt: '' }, o || {}); };

    // ================= pure helpers =================
    TestAssertEqual_(opsAuditKeyGs_(' Pune ', 'A@X.test ') + ',' + opsAuditKeyGs_(null, undefined), 'pune|a@x.test,|', 'key: region and recipient are trimmed and lower-cased, blanks are safe');
    TestAssertEqual_(opsAuditLabelGs_({ region: 'Pune', bucket_label: 'Test A1 One', to: 'a@x.test' }) + ' / ' + opsAuditLabelGs_({ region: 'Pune', bucket_label: '', to: 'a@x.test' }) + ' / ' + opsAuditLabelGs_({}),
      'Pune / Test A1 One / Pune / a@x.test / ? / ?', 'label: the bucket name, else the recipient, else a question mark');
    {
      const f = opsAuditFindingGs_('X', 'HIGH', 's', ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'], 'w', 'a');
      TestAssertEqual_(f.count + ',' + f.items.length + ',' + f.more, '10,8,2', 'finding: at most 8 items are named, the rest are counted');
      TestAssertContains_(opsAuditFindingLinesGs_(f).join('\n'), '(+2 more)', 'finding lines: the overflow is stated');
      TestAssertContains_(opsAuditFindingLinesGs_(f)[0], '[HIGH] X - s', 'finding lines: severity, code and summary lead');
    }
    TestAssertEqual_(opsAuditTopSeverityGs_([{ severity: 'MEDIUM' }, { severity: 'HIGH' }, { severity: 'LOW' }]) + ',' + opsAuditTopSeverityGs_([]), 'HIGH,LOW', 'top severity: the worst finding decides');

    // ---- job state ----
    {
      const now = new Date('2026-10-09T18:00:00+05:30');
      const rec = function (o) { return Object.assign({ day: '2026-10-09', startedAt: new Date(now.getTime() - 10 * 60000).toISOString(), status: 'completed' }, o || {}); };
      const st = function (r) { return opsAuditJobStateGs_(r, '2026-10-09', now); };
      TestAssertEqual_([st(null), st({ unreadable: 'x' }), st(rec({ day: '2026-10-08' })), st(rec()), st(rec({ status: 'failed' }))].join(','), 'no_run,no_run,no_run,ok,ok', 'job state: no record, an unreadable one or yesterday\'s is "no run today"; a finished or failed run is audited');
      TestAssertEqual_(st(rec({ status: 'running' })), 'deferred', 'job state: a run that is still going (10 minutes in) is DEFERRED, not audited');
      TestAssertEqual_(st(rec({ status: 'running', startedAt: new Date(now.getTime() - 60 * 60000).toISOString() })), 'ok', 'job state: a run "running" for an hour has died - it is audited (UNFINISHED rows are exactly what it leaves)');
    }

    // ================= the rules =================
    // ---- UNFINISHED ----
    {
      const f = opsAuditUnfinishedGs_([led({ status: 'PLANNED' }), led({ status: 'ATTEMPTING', region: 'Thane' }), led({ status: 'ACCEPTED' }), led({ status: 'FAILED' })], 'recoverFailedAllIssuesBucketsNow()');
      TestAssertEqual_(f.code + ',' + f.severity + ',' + f.count, 'UNFINISHED,HIGH,2', 'unfinished: PLANNED and ATTEMPTING count (a FAILED one is a known, already-alerted outcome)');
      TestAssertContains_(f.items.join(';'), 'Pune / Test A1 One (PLANNED)', 'unfinished: the bucket and its status are named');
      TestAssertContains_(f.action, 'recoverFailedAllIssuesBucketsNow()', 'unfinished: the matching recovery is named');
      TestAssertContains_(f.action, 'ATTEMPTING one is NOT re-sent', 'unfinished: the ambiguous case is not offered for re-sending');
      TestAssertEqual_(String(opsAuditUnfinishedGs_([led(), led({ status: 'SKIPPED' })], 'x')), 'null', 'unfinished: nothing open -> no finding');
    }
    // ---- ACCEPTED_WITHOUT_LOG ----
    {
      const f = opsAuditAcceptedWithoutLogGs_([led(), led({ region: 'Thane', to: 'b@x.test' })], [alog()], 'AllIssues_Log', 'because');
      TestAssertEqual_(f.code + ',' + f.severity + ',' + f.count + ',' + f.why, 'ACCEPTED_WITHOUT_LOG,HIGH,1,because', 'accepted without log: the Thane bucket has no log row');
      TestAssertContains_(f.items[0], 'Thane / Test A1 One -> b@x.test', 'accepted without log: the bucket and recipient are named');
      TestAssertEqual_(String(opsAuditAcceptedWithoutLogGs_([led({ to: 'A@X.TEST ' })], [alog()], 'L', 'c')), 'null', 'accepted without log: the match ignores case and spaces');
      TestAssertEqual_(String(opsAuditAcceptedWithoutLogGs_([led({ region: 'Thane' })], [alog()], 'L', 'c')) === 'null', false, 'accepted without log: the SAME recipient in ANOTHER region is not a match');
      TestAssertEqual_(String(opsAuditAcceptedWithoutLogGs_([led({ status: 'FAILED' }), led({ status: 'SKIPPED' }), led({ status: 'UNCONFIRMED' })], [], 'L', 'c')), 'null', 'accepted without log: only ACCEPTED emails are expected in the log');
    }
    // ---- LOG_WITHOUT_LEDGER ----
    {
      const f = opsAuditLogWithoutLedgerGs_([led()], [alog(), alog({ region: 'Thane', to: 'b@x.test' })], 'AllIssues_Log', '17:00 job');
      TestAssertEqual_(f.code + ',' + f.severity + ',' + f.count, 'LOG_WITHOUT_LEDGER,MEDIUM,1', 'log without ledger: one log row has no ledger row');
      TestAssertEqual_(String(opsAuditLogWithoutLedgerGs_([led({ status: 'FAILED' })], [alog()], 'L', 'j')), 'null', 'log without ledger: ANY ledger status counts as evidence (a FAILED row is still a record)');
      const none = opsAuditLogWithoutLedgerGs_([], [alog(), alog({ region: 'Thane' })], 'AllIssues_Log', '17:00 job');
      TestAssertEqual_(none.count + ',' + none.items.length, '0,0', 'log without ledger: no ledger rows at all -> ONE finding, not one per row');
      TestAssertContains_(none.summary, 'AllIssues_Log has 2 row(s) for today but Email_Ledger has none for the 17:00 job', 'log without ledger: …and says so');
      TestAssertEqual_(String(opsAuditLogWithoutLedgerGs_([], [], 'L', 'j')), 'null', 'log without ledger: no log rows -> nothing to say');
    }
    // ---- DUPLICATE_LOG ----
    {
      const f = opsAuditDuplicateLogGs_([alog(), alog({ to: 'A@x.test' }), alog({ region: 'Thane' })], 'AllIssues_Log');
      TestAssertEqual_(f.code + ',' + f.count + ',' + f.items[0], 'DUPLICATE_LOG,1,pune -> a@x.test', 'duplicate: the same recipient twice in one region is flagged once (case-insensitive)');
      TestAssertEqual_(String(opsAuditDuplicateLogGs_([alog(), alog({ region: 'Thane' }), alog({ to: 'b@x.test' })], 'L')), 'null', 'duplicate: the same recipient in two regions, or two recipients in one, is normal');
    }
    // ---- CHECKPOINT1_GAP ----
    {
      const prev = [alog({ day: 'Y' }), alog({ day: 'Y', region: 'Thane', to: 'b@x.test' }), alog({ day: 'Y', region: 'Mumbai', to: 'c@x.test', cp1At: '2026-10-09 10:01:00' }),
        alog({ day: 'Y', region: 'Nashik', to: 'd@x.test', leadCount: 0 }), alog({ day: 'Y', region: 'Delhi', to: '' })];
      const f = opsAuditCheckpoint1GapsGs_(prev, [led({ job: 'morning10', status: 'ACCEPTED' })]);
      TestAssertEqual_(f.code + ',' + f.severity + ',' + f.count, 'CHECKPOINT1_GAP,HIGH,2', 'checkpoint 1: the Pune and Thane buckets have no stamp; Mumbai is stamped, Nashik had no leads, Delhi has no recipient');
      TestAssertEqual_(String(opsAuditCheckpoint1GapsGs_(prev.slice(0, 1), [led({ job: 'morning10', status: 'FAILED' })])), 'null', 'checkpoint 1: a bucket whose 10:00 email FAILED is a known, already-alerted problem');
      TestAssertEqual_(String(opsAuditCheckpoint1GapsGs_(prev.slice(0, 1), [led({ job: 'morning10', status: 'BLOCKED' })])) + ',' + String(opsAuditCheckpoint1GapsGs_(prev.slice(0, 1), [led({ job: 'morning10', status: 'UNCONFIRMED' })])), 'null,null', 'checkpoint 1: BLOCKED and UNCONFIRMED are known too');
      TestAssertEqual_(opsAuditCheckpoint1GapsGs_(prev.slice(0, 1), [led({ job: 'morning10', status: 'SKIPPED' })]).count, 1, 'checkpoint 1: a SKIPPED ledger row with no stamp is NOT excused (the stamp should have been written)');
      TestAssertEqual_(String(opsAuditCheckpoint1GapsGs_([], [led({ job: 'morning10' })])), 'null', 'checkpoint 1: no yesterday rows -> nothing to check');
    }
    // ---- FOLLOWUP_GAP ----
    {
      const o = [olog(), olog({ region: 'Thane', to: 'b@x.test' }), olog({ region: 'Mumbai', to: 'c@x.test', followupAt: '2026-10-09 13:02:00' }), olog({ region: 'Delhi', to: '' })];
      const f = opsAuditFollowupGapsGs_(o, [led({ job: 'followup13', status: 'SKIPPED', region: 'Pune' })]);
      TestAssertEqual_(f.code + ',' + f.count + ',' + f.items[0], 'FOLLOWUP_GAP,1,Thane -> b@x.test', 'follow-up gap: Thane has no reply and no ledger row; Pune has a (SKIPPED) ledger row, Mumbai was replied to, Delhi has no recipient');
      TestAssertEqual_(String(opsAuditFollowupGapsGs_(o.slice(0, 1), [led({ job: 'followup13', status: 'FAILED' })])), 'null', 'follow-up gap: any ledger row for the bucket (here FAILED) accounts for it');
    }

    // ================= rule sets =================
    {
      const input = { ledger: [led(), led({ job: 'chLevel17', region: 'Pune', status: 'ACCEPTED' })], allIssuesLog: [alog()], prevAllIssuesLog: [], overnightLog: [] };
      TestAssertEqual_(opsAuditAllIssuesRulesGs_(input).length, 0, 'rule set 17:00: a consistent day has no findings (the CH-level report has no working-log row and needs none)');
      const broken = opsAuditAllIssuesRulesGs_({ ledger: [led({ status: 'PLANNED' }), led({ region: 'Thane', to: 'b@x.test' })], allIssuesLog: [alog(), alog()], prevAllIssuesLog: [], overnightLog: [] });
      TestAssertEqual_(broken.map(function (f) { return f.code; }).sort().join(','), 'ACCEPTED_WITHOUT_LOG,DUPLICATE_LOG,UNFINISHED', 'rule set 17:00: unfinished, a bucket without its log row and a duplicate log row are all found together');
    }
    {
      const m = function (o) { return Object.assign({ ledger: [], allIssuesLog: [], prevAllIssuesLog: [], overnightLog: [] }, o); };
      TestAssertEqual_(opsAuditMorningRulesGs_(m({ ledger: [led({ job: 'morning10' })], overnightLog: [olog()], prevAllIssuesLog: [alog({ day: 'Y', cp1At: 'x' })] })).length, 0, 'rule set 10:00: a consistent morning has no findings');
      TestAssertEqual_(opsAuditMorningRulesGs_(m({ ledger: [], overnightLog: [], prevAllIssuesLog: [alog({ day: 'Y' })] })).length, 0, 'rule set 10:00: with NO ledger rows the checkpoint rule stays quiet (the ledger was not running, which another rule reports) - no false flood');
      const f = opsAuditMorningRulesGs_(m({ ledger: [led({ job: 'morning10' })], overnightLog: [], prevAllIssuesLog: [alog({ day: 'Y' })] }));
      TestAssertEqual_(f.map(function (x) { return x.code; }).sort().join(','), 'ACCEPTED_WITHOUT_LOG,CHECKPOINT1_GAP', 'rule set 10:00: a bucket accepted but not logged, and yesterday\'s bucket without its stamp');
      TestAssertContains_(f.filter(function (x) { return x.code === 'ACCEPTED_WITHOUT_LOG'; })[0].why, 'Overnight_Log', 'rule set 10:00: the consequence names the 13:00 job\'s source');
    }
    {
      const m = function (o) { return Object.assign({ ledger: [], allIssuesLog: [], prevAllIssuesLog: [], overnightLog: [] }, o); };
      TestAssertEqual_(opsAuditFollowupRulesGs_(m({ ledger: [led({ job: 'followup13' })], overnightLog: [olog()] })).length, 0, 'rule set 13:00: a consistent afternoon has no findings');
      const none = opsAuditFollowupRulesGs_(m({ ledger: [], overnightLog: [olog(), olog({ region: 'Thane', to: 'b@x.test' })] }));
      TestAssertEqual_(none.length + ',' + none[0].code, '1,LOG_WITHOUT_LEDGER', 'rule set 13:00: no 13:00 ledger rows at all while 10:00 buckets are logged -> ONE finding (the ledger was not running)');
      TestAssertEqual_(opsAuditFollowupRulesGs_(m({ ledger: [], overnightLog: [olog({ to: '' })] })).length, 0, 'rule set 13:00: a log row without a recipient predates the recipient fix and is ignored');
    }

    // ================= end to end: real jobs, audited =================
    const day = function () { return istDayKeyGs_(new Date()); };
    const audit = function (key, opts) { return opsAuditRun_(OPS_AUDIT_SPECS_[key], Object.assign({ now: new Date() }, opts || {})); };

    // ---- 17:00: clean, then damaged one piece at a time ----
    {
      const w = TestOA_cycleWorld_();
      TestEL_bind_(w.ss);
      sendAllIssuesEmails();
      TestGmailLog_.sent.length = 0;
      const res = audit('allIssues');
      TestAssertEqual_(res.status + ',' + res.findings.length + ',' + TestOA_alerts_().length, 'clean,0,0', '17:00 audit, clean day: silent - no finding, no alert');
      const rec = opsAuditReadRecordGs_(OPS_AUDIT_SPECS_.allIssues);
      TestAssertEqual_(rec ? rec.day + ',' + rec.status + ',' + rec.count : 'no record', day() + ',clean,0', '17:00 audit, clean day: the "last audit" record says clean');

      // the log row is lost: tomorrow's Checkpoint 1 would skip this bucket
      const sheet = w.ss.getSheetByName('AllIssues_Log');
      sheet.getRange(2, 1, 1, 14).setValues([['', '', '', '', '', '', '', '', '', '', '', '', '', '']]);
      const res2 = audit('allIssues');
      TestAssertEqual_(res2.status + ',' + res2.findings.map(function (f) { return f.code; }).join('+'), 'exceptions,ACCEPTED_WITHOUT_LOG', '17:00 audit, log row lost: exactly the missing-log finding');
      const alerts = TestOA_alerts_();
      TestAssertEqual_(alerts.length, 1, '17:00 audit, log row lost: ONE alert is sent');
      TestAssertEqual_(alerts[0].subject, '[Overnight Emailer] Email audit (17:00 emails): 1 exception(s)', '17:00 audit, log row lost: the subject names the audit and the count');
      TestAssertContains_(alerts[0].body, '[HIGH] ACCEPTED_WITHOUT_LOG', '17:00 audit, log row lost: the body names the finding');
      TestAssertContains_(alerts[0].body, 'Why it matters:', '17:00 audit, log row lost: …why it matters');
      TestAssertContains_(alerts[0].body, 'What to do:', '17:00 audit, log row lost: …and what to do');
      TestAssertContains_(alerts[0].body, 'Test A1 One', '17:00 audit, log row lost: …and which bucket');
      const inc = TestEL_objects_(w.ss.getSheetByName(EMAIL_INCIDENT_LOG_SHEET_), EMAIL_INCIDENT_HEADERS_);
      TestAssertEqual_(inc.length + ',' + inc[0].severity + ',' + inc[0].notification, '1,HIGH,SENT', '17:00 audit, log row lost: recorded as a HIGH incident, SENT');
      const rec2 = opsAuditReadRecordGs_(OPS_AUDIT_SPECS_.allIssues);
      TestAssertEqual_(rec2.status + ',' + rec2.count + ',' + rec2.codes.join('+'), 'exceptions,1,ACCEPTED_WITHOUT_LOG', '17:00 audit, log row lost: the "last audit" record carries the codes');
    }
    {
      // a duplicate log row (a possible double send)
      const w = TestOA_cycleWorld_();
      TestEL_bind_(w.ss);
      sendAllIssuesEmails();
      TestGmailLog_.sent.length = 0;
      const sheet = w.ss.getSheetByName('AllIssues_Log');
      sheet.appendRow(sheet.getRange(2, 1, 1, 14).getValues()[0]);
      const res = audit('allIssues');
      TestAssertEqual_(res.findings.map(function (f) { return f.code; }).join('+'), 'DUPLICATE_LOG', '17:00 audit, duplicate log row: exactly that finding');
      TestAssertEqual_(TestOA_alerts_().length, 1, '17:00 audit, duplicate log row: one alert');
    }
    {
      // the ledger row is lost: the email went out with no evidence
      const w = TestOA_cycleWorld_();
      TestEL_bind_(w.ss);
      sendAllIssuesEmails();
      TestGmailLog_.sent.length = 0;
      const row = TestOA_ledgerRow_(w.ss, 'allIssues17');
      w.ss.getSheetByName(EMAIL_LEDGER_SHEET_).deleteRows(row.rowNo, 1);
      const res = audit('allIssues');
      TestAssertEqual_(res.findings.map(function (f) { return f.code; }).join('+'), 'LOG_WITHOUT_LEDGER', '17:00 audit, ledger row lost: exactly that finding');
      TestAssertContains_(res.findings[0].summary, 'Email_Ledger has none for the 17:00 job', '17:00 audit, ledger row lost: it says the ledger has nothing for the job');
    }
    {
      // the run died: a bucket left PLANNED
      const w = TestOA_cycleWorld_();
      TestEL_bind_(w.ss);
      sendAllIssuesEmails();
      TestGmailLog_.sent.length = 0;
      const row = TestOA_ledgerRow_(w.ss, 'allIssues17');
      w.ss.getSheetByName(EMAIL_LEDGER_SHEET_).getRange(row.rowNo, emailLedgerCol_('status'), 1, 1).setValues([['PLANNED']]);
      const res = audit('allIssues');
      TestAssertEqual_(res.findings.map(function (f) { return f.code; }).join('+'), 'UNFINISHED', '17:00 audit, run died: the unfinished bucket is found');
      TestAssertContains_(TestOA_alerts_()[0].body, 'recoverFailedAllIssuesBucketsNow()', '17:00 audit, run died: the alert names the recovery to run');
    }
    {
      // still running -> deferred (silent); never started -> skipped (the watchdog's job)
      const w = TestOA_cycleWorld_();
      TestEL_bind_(w.ss);
      sendAllIssuesEmails();
      TestGmailLog_.sent.length = 0;
      PropertiesService.getScriptProperties().setProperty('EMAIL_JOB_RUN_sendAllIssuesEmails', JSON.stringify({ day: day(), startedAt: new Date(Date.now() - 5 * 60000).toISOString(), status: 'running' }));
      const res = audit('allIssues');
      TestAssertEqual_(res.status + ',' + res.findings.length + ',' + TestOA_alerts_().length, 'deferred,0,0', 'deferred: a job that is still running is not audited and nothing is raised');
      TestAssertContains_(res.reason, 'still running', 'deferred: …with the reason');
      TestAssertEqual_(opsAuditReadRecordGs_(OPS_AUDIT_SPECS_.allIssues).status, 'deferred', 'deferred: the "last audit" record says so (the daily report can show it)');
      PropertiesService = TestMockPropertiesService_();
      const res2 = audit('allIssues');
      TestAssertEqual_(res2.status + ',' + TestOA_alerts_().length, 'skipped,0', 'skipped: a job with no run record today is not the audit\'s business - no alert');
    }
    {
      // dry run and test mode: nothing sent, nothing recorded
      const w = TestOA_cycleWorld_();
      TestEL_bind_(w.ss);
      sendAllIssuesEmails();
      TestGmailLog_.sent.length = 0;
      w.ss.getSheetByName('AllIssues_Log').getRange(2, 1, 1, 14).setValues([['', '', '', '', '', '', '', '', '', '', '', '', '', '']]);
      const dry = audit('allIssues', { dryRun: true });
      TestAssertEqual_(dry.findings.length + ',' + TestOA_alerts_().length + ',' + String(opsAuditReadRecordGs_(OPS_AUDIT_SPECS_.allIssues)), '1,0,null', 'dry run: the finding is returned but nothing is sent or recorded');
      showEmailAuditNow();
      TestAssertEqual_(TestOA_alerts_().length + ',' + String(opsAuditReadRecordGs_(OPS_AUDIT_SPECS_.allIssues)), '0,null', 'showEmailAuditNow: read-only - no alert, no record');
      TEST_MODE_OVERRIDE_EMAIL_ = TEST_EMAIL_PRIMARY_;
      try {
        const t = audit('allIssues');
        TestAssertEqual_(t.findings.length + ',' + TestOA_alerts_().length + ',' + String(opsAuditReadRecordGs_(OPS_AUDIT_SPECS_.allIssues)), '1,0,null', 'test mode: the audit sends no alert and records nothing');
      } finally { TEST_MODE_OVERRIDE_EMAIL_ = ''; }
    }

    // ---- 10:00 and 13:00: a full cycle, then damaged ----
    {
      const w = TestOA_cycleWorld_();
      TestEL_bind_(w.ss);
      sendAllIssuesEmails();
      TestOA_ageAllIssues_(w);
      sendOvernightMorningEmails();
      TestGmailLog_.sent.length = 0;
      const clean = audit('morning');
      TestAssertEqual_(clean.status + ',' + clean.findings.length + ',' + TestOA_alerts_().length, 'clean,0,0', '10:00 audit, clean morning: silent');

      // Checkpoint 1 was never stamped for yesterday's bucket although the 10:00 email went out
      w.ss.getSheetByName('AllIssues_Log').getRange(2, 12, 1, 1).setValues([['']]);
      const res = audit('morning');
      TestAssertEqual_(res.findings.map(function (f) { return f.code; }).join('+'), 'CHECKPOINT1_GAP', '10:00 audit, stamp lost: exactly the checkpoint gap');
      TestAssertContains_(TestOA_alerts_()[0].subject, 'Email audit (10:00 emails): 1 exception(s)', '10:00 audit, stamp lost: the subject names the 10:00 emails');

      // ...but a FAILED 10:00 email for that bucket is a known problem, not a new exception
      TestGmailLog_.sent.length = 0;
      const r10 = TestOA_ledgerRow_(w.ss, 'morning10');
      w.ss.getSheetByName(EMAIL_LEDGER_SHEET_).getRange(r10.rowNo, emailLedgerCol_('status'), 1, 1).setValues([['FAILED']]);
      TestAssertEqual_(audit('morning').findings.length + ',' + TestOA_alerts_().length, '0,0', '10:00 audit: a bucket whose 10:00 email FAILED is already known - not raised again');

      // the Overnight_Log row is lost: the 13:00 reply could not thread
      w.ss.getSheetByName(EMAIL_LEDGER_SHEET_).getRange(r10.rowNo, emailLedgerCol_('status'), 1, 1).setValues([['ACCEPTED']]);
      w.ss.getSheetByName('AllIssues_Log').getRange(2, 12, 1, 1).setValues([['2026-10-09 10:01:00']]);
      w.ss.getSheetByName('Overnight_Log').getRange(2, 1, 1, 9).setValues([['', '', '', '', '', '', '', '', '']]);
      TestGmailLog_.sent.length = 0;
      const res3 = audit('morning');
      TestAssertEqual_(res3.findings.map(function (f) { return f.code; }).join('+'), 'ACCEPTED_WITHOUT_LOG', '10:00 audit, Overnight_Log row lost: exactly the missing-log finding');
      TestAssertContains_(res3.findings[0].why, 'Overnight_Log', '10:00 audit, Overnight_Log row lost: the consequence is named');
    }
    {
      const w = TestOA_cycleWorld_();
      TestEL_bind_(w.ss);
      sendAllIssuesEmails();
      TestOA_ageAllIssues_(w);
      sendOvernightMorningEmails();
      sendOvernightFollowupEmails();
      TestGmailLog_.sent.length = 0;
      const clean = audit('followup');
      TestAssertEqual_(clean.status + ',' + clean.findings.length + ',' + TestOA_alerts_().length, 'clean,0,0', '13:00 audit, clean afternoon: silent');

      // the 13:00 job never reached the bucket: no reply, no stamp, no ledger row for the reply
      const r13 = TestOA_ledgerRow_(w.ss, 'followup13');
      w.ss.getSheetByName(EMAIL_LEDGER_SHEET_).deleteRows(r13.rowNo, 1);
      w.ss.getSheetByName(EMAIL_LEDGER_SHEET_).appendRow(['dummy-row-so-the-ledger-is-not-empty']);
      w.ss.getSheetByName('Overnight_Log').getRange(2, 9, 1, 1).setValues([['']]);
      const res = audit('followup');
      TestAssertEqual_(res.findings.map(function (f) { return f.code; }).join('+'), 'LOG_WITHOUT_LEDGER', '13:00 audit, ledger has no 13:00 rows at all: ONE finding (the ledger was not running)');
    }
    {
      // 13:00 gap with the ledger running: a second bucket was logged at 10:00 but the 13:00 job never planned it
      const w = TestOA_cycleWorld_();
      TestEL_bind_(w.ss);
      sendAllIssuesEmails();
      TestOA_ageAllIssues_(w);
      sendOvernightMorningEmails();
      sendOvernightFollowupEmails();
      TestGmailLog_.sent.length = 0;
      w.ss.getSheetByName('Overnight_Log').appendRow([dayToday, 'Thane', 'thread-x', '[]', new Date(), 'other@example.test', '', 'Subject', '', '']);
      const res = audit('followup');
      TestAssertEqual_(res.findings.map(function (f) { return f.code; }).join('+'), 'FOLLOWUP_GAP', '13:00 audit, an unreplied bucket the 13:00 job never planned: exactly the follow-up gap');
      TestAssertContains_(res.findings[0].items.join(';'), 'Thane -> other@example.test', '13:00 audit: …naming the bucket');
    }

    // ---- failure modes of the audit itself ----
    {
      const w = TestOA_cycleWorld_();
      TestEL_bind_(w.ss);
      sendAllIssuesEmails();
      TestGmailLog_.sent.length = 0;
      const realRead = emailLedgerReadRowsGs_;
      emailLedgerReadRowsGs_ = function () { throw new Error('simulated: the ledger tab cannot be read'); };
      let res;
      try { res = audit('allIssues'); } finally { emailLedgerReadRowsGs_ = realRead; }
      TestAssertEqual_(res.status + ',' + res.findings.length, 'failed,0', 'unreadable inputs: the audit reports "failed", never an exception or a false clean');
      const alerts = TestGmailLog_.sent.filter(function (e) { return /Email audit \(17:00 emails\) could not run/.test(e.subject); });
      TestAssertEqual_(alerts.length, 1, 'unreadable inputs: ops are told once that the audit could not run');
      TestAssertEqual_(opsAuditReadRecordGs_(OPS_AUDIT_SPECS_.allIssues).status, 'failed', 'unreadable inputs: the "last audit" record says failed');
    }
    {
      // the trigger entry: a crash is alerted at once, re-thrown, and the run record says failed
      const w = TestOA_cycleWorld_();
      TestEL_bind_(w.ss);
      const realRun = opsAuditRun_;
      opsAuditRun_ = function () { throw new Error('simulated audit crash'); };
      try { TestAssertThrows_(function () { auditAllIssuesEmails(); }, 'crash: the error is re-thrown (Executions shows Failed)'); } finally { opsAuditRun_ = realRun; }
      const crash = TestGmailLog_.sent.filter(function (e) { return /auditAllIssuesEmails crashed/.test(e.subject); });
      TestAssertEqual_(crash.length, 1, 'crash: one alert');
      TestAssertEqual_(readEmailJobRunGs_('auditAllIssuesEmails').status, 'failed', 'crash: the run record says failed (so the watchdog sees it)');
      TestAssertEqual_(EMAIL_ALERT_HOLD_ === null, true, 'crash: nothing is left held (an audit never holds its alerts)');
    }
    {
      // the entry points run through the run record with no job lock
      const w = TestOA_cycleWorld_();
      TestEL_bind_(w.ss);
      sendAllIssuesEmails();
      LockService = TestMockLockService_({ denyLock: true }); // another job holds the lock
      auditAllIssuesEmails();
      TestAssertEqual_(readEmailJobRunGs_('auditAllIssuesEmails').status, 'completed', 'no lock: an audit runs even while another job holds the script lock - it can never make an email job skip');
      LockService = TestMockLockService_();
    }

    // ---- triggers and the watchdog ----
    {
      ScriptApp = TestMockScriptApp_(['auditMorningEmails', 'sendAllIssuesEmails', 'other']);
      setupOpsAuditTriggers();
      const created = ScriptApp._state.created.map(function (c) { return c.fnName + '@' + c.hour + ':' + c.minute; }).sort().join(',');
      TestAssertEqual_(created, 'auditAllIssuesEmails@18:0,auditFollowupEmails@14:0,auditMorningEmails@11:15', 'setup: three daily triggers - 11:15, 14:00 and 18:00 IST');
      TestAssertEqual_(ScriptApp._state.created.every(function (c) { return c.tz === 'Asia/Kolkata' && c.days === 1; }), true, 'setup: daily, in IST');
      TestAssertEqual_(ScriptApp._state.deleted.join(','), 'auditMorningEmails', 'setup: only its own earlier trigger is deleted');
      const sched = emailJobScheduleGs_();
      TestAssertEqual_(['auditMorningEmails', 'auditFollowupEmails', 'auditAllIssuesEmails'].map(function (j) { return sched[j] ? sched[j].hour + ':' + (sched[j].minute || 0) : 'missing'; }).join(','), '11:15,14:0,18:0', 'watchdog: the three audits are on the schedule');
      PropertiesService = TestMockPropertiesService_();
      const late = emailJobProblemsGs_(new Date(dayToday + 'T11:50:00+05:30')).filter(function (p) { return p.job === 'auditMorningEmails'; });
      TestAssertEqual_(late.length + ',' + (late[0] ? late[0].kind : ''), '1,never_started', 'watchdog: at 11:50 a 10:00-email audit that did not run is flagged (deadline 11:45)');
    }

    TestAssertOnlyTestEmails_();
  } finally {
    LockService = TestMockLockService_();
    TEST_MODE_OVERRIDE_EMAIL_ = '';
    TestEnv_tearDown_();
  }
  return TestResults_;
}

function runOpsAuditTestsNow() { runOpsAuditTests_(); }
