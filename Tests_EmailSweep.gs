/**
 * Tests: EmailSweep.gs - the daily bounce / reply sweep (Email Ops EO-5). Run runEmailSweepTestsNow() from the function dropdown, or via
 * runAllTests() (Tests_RunAll.gs). Everything is in-memory: the ledger sheet, Gmail search/threads, Properties and triggers are fakes.
 */

// ---- fixtures ----

function TestSW_bind_(ss) {
  SpreadsheetApp.getActiveSpreadsheet = function () { return ss; };
  TestGmailLog_reset_();
  GmailApp = TestMockGmailApp_({});
  Gmail = TestMockGmailAdvanced_({});
  PropertiesService = TestMockPropertiesService_();
}

// A fake Gmail message: { from, date, subject, body }.
function TestSW_msg_(from, date, subject, body) {
  return {
    getFrom: function () { return from; }, getDate: function () { return date; },
    getSubject: function () { return subject || ''; }, getPlainBody: function () { return body || ''; },
  };
}

// Installs fake Gmail search / thread lookup on the (fresh) GmailApp mock. bounces: [message]; threads: { threadId: [message] | 'throw' }.
function TestSW_gmail_(bounces, threads, opts) {
  GmailApp.search = function () {
    if (opts && opts.searchThrows) throw new Error('simulated: Gmail search is down');
    return bounces.map(function (m) { return { getMessages: function () { return [m]; } }; });
  };
  GmailApp.getThreadById = function (id) {
    const t = threads[id];
    if (t === 'throw' || t === undefined) throw new Error('simulated: no such thread');
    return { getMessages: function () { return t; } };
  };
}

// Records one ACCEPTED ledger row through the real ledger API and ages its finish time. Returns its email id.
function TestSW_ledgerRow_(ss, h, spec) {
  const id = emailLedgerIdGs_('allIssues17', istDayKeyGs_(new Date()), spec.region || 'Pune', 'A1', spec.bucket);
  emailLedgerPlanGs_(h, [{ emailId: id, job: 'allIssues17', dayKey: istDayKeyGs_(new Date()), region: spec.region || 'Pune', bucketLabel: spec.bucket, primaryRole: 'A1', to: spec.to, cc: spec.cc || '', subject: spec.subject, leadIds: ['L-' + spec.bucket] }]);
  emailLedgerAttemptGs_(h, id);
  emailLedgerResultGs_(h, id, { status: spec.status || 'ACCEPTED', messageId: 'm-' + spec.bucket, threadId: spec.threadId, leadIds: ['L-' + spec.bucket], reason: spec.status === 'FAILED' ? 'refused' : '' });
  const rowNo = h.rowById[id];
  const finished = new Date(Date.now() - (spec.minutesAgo === undefined ? 120 : spec.minutesAgo) * 60000);
  ss.getSheetByName(EMAIL_LEDGER_SHEET_).getRange(rowNo, emailLedgerCol_('finished_at'), 1, 1).setValues([[finished]]);
  return { id: id, finished: finished, rowNo: rowNo };
}

function TestSW_row_(ss, rowNo) {
  const sh = ss.getSheetByName(EMAIL_LEDGER_SHEET_);
  const o = {};
  sh.getRange(rowNo, 1, 1, EMAIL_LEDGER_HEADERS_.length).getValues()[0].forEach(function (v, i) { o[EMAIL_LEDGER_HEADERS_[i]] = v; });
  return o;
}

function runEmailSweepTests_() {
  TestEnv_setUp_('Tests_EmailSweep', TestMockSpreadsheet_({}));
  // The bounce escalation (EmailReroute.gs) has its own suite (Tests_EmailReroute.gs); here the sweep is judged on its own.
  const realRerouteHandler = emailRerouteHandleBouncesGs_;
  emailRerouteHandleBouncesGs_ = function () { return {}; };
  try {
    const t0 = new Date('2026-10-08T17:05:00+05:30');
    const row = function (extra) { return Object.assign({ status: 'ACCEPTED', finished_at: t0, to: 'boss@x.test', cc: 'lead@x.test, other@x.test', subject: 'Test A1 One (A1) google Leads With Issue (06-Oct-2026 to 08-Oct-2026)' }, extra || {}); };
    const minutesAfter = function (m) { return new Date(t0.getTime() + m * 60000); };

    // ================= pure helpers =================
    TestAssertEqual_(emailSweepAddressesGs_(' A@X.test, b@y.test ,, ').join('|'), 'a@x.test|b@y.test', 'addresses: split, trimmed, lower-cased, blanks dropped');

    const now = new Date(t0.getTime() + 2 * 3600000);
    TestAssertEqual_(emailSweepIsCandidateGs_(row(), now), true, 'candidate: an accepted email two hours old');
    TestAssertEqual_(emailSweepIsCandidateGs_(row({ status: 'UNCONFIRMED' }), now), true, 'candidate: an UNCONFIRMED email may have been delivered, so it is checked too');
    TestAssertEqual_(emailSweepIsCandidateGs_(row({ status: 'FAILED' }), now), false, 'candidate: a failed email never went out');
    TestAssertEqual_(emailSweepIsCandidateGs_(row({ status: 'SKIPPED' }), now), false, 'candidate: a skipped email was never sent');
    TestAssertEqual_(emailSweepIsCandidateGs_(row(), minutesAfter(5)), false, 'candidate: 5 minutes old is too soon (a bounce has not had time to arrive)');
    TestAssertEqual_(emailSweepIsCandidateGs_(row(), minutesAfter(11)), true, 'candidate: 11 minutes old is enough (the next check looks again anyway)');
    TestAssertEqual_(emailSweepIsCandidateGs_(row(), new Date(t0.getTime() + 4 * 24 * 3600000)), false, 'candidate: older than 3 days is no longer swept');
    TestAssertEqual_(emailSweepIsCandidateGs_(row({ finished_at: '' }), now), false, 'candidate: no finish time, no sweep');

    const bounce = function (at, body, subject) { return { at: at, subject: subject || 'Delivery Status Notification (Failure)', body: body }; };
    const quoted = bounce(minutesAfter(40), 'Address not found: BOSS@x.test ... Subject: Test A1 One (A1) google Leads With Issue (06-Oct-2026');
    TestAssert_(emailSweepMatchBounceGs_(row(), [quoted]) === quoted, 'bounce match: the recipient is named and the subject is quoted');
    const quick = bounce(minutesAfter(5), 'The address boss@x.test could not be reached');
    TestAssert_(emailSweepMatchBounceGs_(row(), [quick]) === quick, 'bounce match: a bounce within 15 minutes of the send is attributed to it even without the subject');
    TestAssert_(emailSweepMatchBounceGs_(row(), [bounce(minutesAfter(120), 'boss@x.test could not be reached')]) === null, 'bounce match: a later bounce that does not quote the subject is NOT attributed (it could belong to another email)');
    TestAssert_(emailSweepMatchBounceGs_(row(), [bounce(minutesAfter(5), 'stranger@x.test could not be reached')]) === null, 'bounce match: a bounce naming nobody on this email is ignored');
    TestAssert_(emailSweepMatchBounceGs_(row(), [bounce(minutesAfter(-30), 'boss@x.test could not be reached')]) === null, 'bounce match: a bounce from before the send is ignored');
    TestAssert_(emailSweepMatchBounceGs_(row(), [bounce(new Date(t0.getTime() + 30 * 3600000), 'boss@x.test Subject: Test A1 One (A1) google Leads With Issue')]) === null, 'bounce match: more than 24 hours later is ignored');
    const ccBounce = bounce(minutesAfter(3), 'Other@X.test is full');
    TestAssert_(emailSweepMatchBounceGs_(row(), [ccBounce]) === ccBounce, 'bounce match: a Cc recipient counts too, case-insensitively');
    TestAssert_(emailSweepMatchBounceGs_(row({ finished_at: '' }), [quick]) === null, 'bounce match: no finish time, no match');
    TestAssert_(emailSweepMatchBounceGs_(row(), []) === null, 'bounce match: nothing to match against');

    TestAssertEqual_(emailSweepIsOwnGs_('"Homesfy Lead Ops" <ops@x.test>', '') + ',' + emailSweepIsOwnGs_('Boss <boss@x.test>', 'ops@x.test') + ',' + emailSweepIsOwnGs_('OPS@x.test', 'ops@x.test'), 'true,false,true', 'own message: by the sender display name or the account address');
    TestAssertEqual_(emailSweepIsBounceSenderGs_('Mail Delivery Subsystem <mailer-daemon@googlemail.com>') + ',' + emailSweepIsBounceSenderGs_('postmaster@x.test') + ',' + emailSweepIsBounceSenderGs_('Boss <boss@x.test>'), 'true,true,false', 'bounce sender: mailer-daemon and postmaster only');
    const msgs = [
      { from: '"Homesfy Lead Ops" <ops@x.test>', date: minutesAfter(0) },        // our own send
      { from: 'Boss <boss@x.test>', date: minutesAfter(-10) },                   // before the send
      { from: 'Boss <boss@x.test>', date: minutesAfter(30) },                    // a reply
      { from: 'Lead <lead@x.test>', date: minutesAfter(90) },                    // a second reply (the latest)
      { from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>', date: minutesAfter(60) }, // not a reply
      { from: '"Homesfy Lead Ops" <ops@x.test>', date: minutesAfter(120) },      // our next email in the thread
    ];
    const reps = emailSweepRepliesGs_(row(), msgs, '');
    TestAssertEqual_(reps.count + ',' + reps.latest.getTime(), '2,' + minutesAfter(90).getTime(), 'replies: only others\' messages after the send count, newest reported; our own and bounce notices do not');
    TestAssertEqual_(emailSweepRepliesGs_(row(), [], '').count + ',' + emailSweepRepliesGs_(row(), [], '').latest, '0,null', 'replies: none');

    // ================= the sweep against a ledger =================
    const nowSweep = new Date();
    {
      const ss = TestMockSpreadsheet_({});
      TestSW_bind_(ss);
      const h = emailLedgerOpenGs_(ss);
      const e1 = TestSW_ledgerRow_(ss, h, { bucket: 'Bounced One', to: 'a@x.test', cc: 'ccA@x.test', subject: 'Subject A', threadId: 'T1' });
      const e2 = TestSW_ledgerRow_(ss, h, { bucket: 'Replied Two', to: 'b@x.test', subject: 'Subject B', threadId: 'T2' });
      const e3 = TestSW_ledgerRow_(ss, h, { bucket: 'Clean Three', to: 'c@x.test', subject: 'Subject C', threadId: 'T3' });
      const e4 = TestSW_ledgerRow_(ss, h, { bucket: 'Too Recent', to: 'd@x.test', subject: 'Subject D', threadId: 'T4', minutesAgo: 5 });
      const e5 = TestSW_ledgerRow_(ss, h, { bucket: 'Failed Five', to: 'e@x.test', subject: 'Subject E', threadId: '', status: 'FAILED' });
      const own = '"Homesfy Lead Ops" <ops@x.test>';
      TestSW_gmail_(
        [TestSW_msg_('Mail Delivery Subsystem <mailer-daemon@googlemail.com>', new Date(e1.finished.getTime() + 3 * 60000), 'Delivery Status Notification (Failure)', 'Message to a@x.test could not be delivered. Subject: Subject A')],
        {
          T1: [TestSW_msg_(own, e1.finished)],
          T2: [TestSW_msg_(own, e2.finished), TestSW_msg_('Boss B <b@x.test>', new Date(e2.finished.getTime() + 20 * 60000))],
          T3: [TestSW_msg_(own, e3.finished)],
        });
      const summary = sweepEmailBouncesAndReplies_({ now: nowSweep });
      TestAssertEqual_([summary.checked, summary.bounced, summary.replied, summary.newBounces.length, summary.unswept].join(','), '3,1,1,1,0', 'sweep: three emails checked, one bounced, one replied, one NEW bounce; the too-recent and the failed email are not swept');
      const r1 = TestSW_row_(ss, e1.rowNo), r2 = TestSW_row_(ss, e2.rowNo), r3 = TestSW_row_(ss, e3.rowNo), r4 = TestSW_row_(ss, e4.rowNo), r5 = TestSW_row_(ss, e5.rowNo);
      TestAssert_(/^BOUNCED \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(r1.bounce_status), 'sweep: the bounced email says BOUNCED with the bounce time');
      TestAssertEqual_(r1.reply_status, 'NO_REPLY_SEEN', 'sweep: …and has no reply');
      TestAssertEqual_(r2.bounce_status + ',' + /^REPLIED 1 \(latest \d{4}-\d{2}-\d{2} \d{2}:\d{2}\)$/.test(r2.reply_status), 'NO_BOUNCE_SEEN,true', 'sweep: the replied email says REPLIED 1 with the time, and no bounce was found');
      TestAssertEqual_(r3.bounce_status + ',' + r3.reply_status, 'NO_BOUNCE_SEEN,NO_REPLY_SEEN', 'sweep: a clean email says NO_BOUNCE_SEEN / NO_REPLY_SEEN - never "delivered"');
      TestAssertEqual_(r4.bounce_status + ',' + r4.reply_status + ',' + r4.swept_at, ',,', 'sweep: an email that is too recent is left untouched');
      TestAssertEqual_(r5.bounce_status + ',' + r5.swept_at, ',', 'sweep: a failed email is left untouched');
      TestAssert_(r1.swept_at instanceof Date && r2.swept_at instanceof Date && r3.swept_at instanceof Date, 'sweep: swept_at is stamped on every checked email');
      TestAssertEqual_(r1.status + ',' + r1.finished_at.getTime(), 'ACCEPTED,' + e1.finished.getTime(), 'sweep: the outcome columns of the ledger row are untouched');

      const alerts = TestGmailLog_.sent.filter(function (e) { return /Email BOUNCED/.test(e.subject); });
      TestAssertEqual_(alerts.length, 1, 'sweep: exactly one bounce alert');
      TestAssertContains_(alerts[0].subject, '1 email(s) did not reach their recipient', 'sweep: …saying what happened');
      TestAssertContains_(alerts[0].body, 'Bounced One', 'sweep: …naming the bucket');
      TestAssertContains_(alerts[0].body, 'a@x.test', 'sweep: …and the recipient');
      TestAssert_(alerts[0].body.indexOf('CONFIRMATION') === -1, 'sweep: the alert is sent at once (the sweep is not an email job that holds alerts)');

      // a second sweep: the bounce is already recorded, so no second alert; the reply count carries on
      const before = TestGmailLog_.sent.length;
      const again = sweepEmailBouncesAndReplies_({ now: new Date(nowSweep.getTime() + 60000) });
      TestAssertEqual_(again.newBounces.length + ',' + again.bounced + ',' + (TestGmailLog_.sent.length - before), '0,1,0', 'second sweep: the known bounce is still counted but raises no second alert');

      // the 16:30 report picks the evidence up
      const rep = buildEmailCycleReportGs_(ss, new Date(nowSweep.getTime() + 120000));
      TestAssertContains_(rep.plainBody, 'Bounces and replies', 'cycle report: the bounces section is there');
      TestAssertContains_(rep.plainBody, 'Bounced One', 'cycle report: the bounced email is in the attention table');
      TestAssertContains_(rep.plainBody, 'Replies received (1)', 'cycle report: the reply is listed');
      TestAssertContains_(rep.subject, 'need attention', 'cycle report: a bounce means the subject is not "all clear"');
      const inc = TestEL_objects_(ss.getSheetByName(EMAIL_INCIDENT_LOG_SHEET_), EMAIL_INCIDENT_HEADERS_);
      TestAssertEqual_(inc.length + ',' + inc[0].severity, '1,HIGH', 'the bounce alert is an incident, rated HIGH');
    }

    // ---- a thread that cannot be read, and a search that fails ----
    {
      const ss = TestMockSpreadsheet_({});
      TestSW_bind_(ss);
      const h = emailLedgerOpenGs_(ss);
      const e1 = TestSW_ledgerRow_(ss, h, { bucket: 'Lost Thread', to: 'a@x.test', subject: 'S', threadId: 'GONE' });
      const e2 = TestSW_ledgerRow_(ss, h, { bucket: 'No Thread Id', to: 'b@x.test', subject: 'S2', threadId: '' });
      TestSW_gmail_([], {}, {});
      sweepEmailBouncesAndReplies_({ now: nowSweep });
      TestAssertEqual_(TestSW_row_(ss, e1.rowNo).reply_status, 'UNKNOWN (the thread could not be read)', 'unreadable thread: recorded as UNKNOWN, not as "no reply"');
      TestAssertEqual_(TestSW_row_(ss, e2.rowNo).reply_status, 'UNKNOWN (no thread id recorded)', 'no thread id: recorded as UNKNOWN');
      TestAssertEqual_(TestSW_row_(ss, e1.rowNo).bounce_status, 'NO_BOUNCE_SEEN', 'unreadable thread: the bounce check still ran');

      TestSW_gmail_([], { T: [] }, { searchThrows: true });
      const failed = sweepEmailBouncesAndReplies_({ now: new Date(nowSweep.getTime() + 1000) });
      TestAssert_(failed.errors.length === 1 && /bounce search/.test(failed.errors[0]), 'failed search: the error is reported in the summary');
      TestAssertEqual_(TestSW_row_(ss, e1.rowNo).bounce_status, 'UNKNOWN (the bounce search failed)', 'failed search: the bounce status is UNKNOWN - never "no bounce seen"');
    }

    // ---- the time budget ----
    {
      const ss = TestMockSpreadsheet_({});
      TestSW_bind_(ss);
      const h = emailLedgerOpenGs_(ss);
      const e1 = TestSW_ledgerRow_(ss, h, { bucket: 'A', to: 'a@x.test', subject: 'S', threadId: 'T1' });
      const e2 = TestSW_ledgerRow_(ss, h, { bucket: 'B', to: 'b@x.test', subject: 'S', threadId: 'T2' });
      TestSW_gmail_([], { T1: [], T2: [] });
      const s = sweepEmailBouncesAndReplies_({ now: nowSweep, maxRunMs: -1 });
      TestAssertEqual_(s.checked + ',' + s.unswept, '0,2', 'time budget: when the budget is spent the rest is left unswept and counted');
      TestAssertEqual_(TestSW_row_(ss, e1.rowNo).swept_at + ',' + TestSW_row_(ss, e2.rowNo).bounce_status, ',', 'time budget: unswept rows stay blank so the next sweep picks them up');
    }

    // ---- nothing to do ----
    {
      TestSW_bind_(TestMockSpreadsheet_({}));
      const s = sweepEmailBouncesAndReplies_({ now: nowSweep });
      TestAssertEqual_(s.checked + ',' + s.bounced + ',' + s.unswept, '0,0,0', 'no ledger: the sweep does nothing and does not throw');
      const ss = TestMockSpreadsheet_({});
      TestSW_bind_(ss);
      const h = emailLedgerOpenGs_(ss);
      TestSW_ledgerRow_(ss, h, { bucket: 'Fresh', to: 'a@x.test', subject: 'S', threadId: 'T1', minutesAgo: 5 });
      TestSW_gmail_([], {});
      TestAssertEqual_(sweepEmailBouncesAndReplies_({ now: nowSweep }).checked, 0, 'only too-recent emails: nothing is swept');
    }

    // ================= trigger entry points and the watchdog =================
    {
      const ss = TestMockSpreadsheet_({});
      TestSW_bind_(ss);
      TestSW_gmail_([], {});
      sweepEmailBouncesAndReplies();
      TestAssertEqual_(readEmailJobRunGs_(EMAIL_SWEEP_JOB_).status, 'completed', 'trigger: the run is recorded');
      const realSweep = sweepEmailBouncesAndReplies_;
      sweepEmailBouncesAndReplies_ = function () { throw new Error('simulated sweep failure'); };
      try { TestAssertThrows_(function () { sweepEmailBouncesAndReplies(); }, 'trigger: a crash is re-thrown'); } finally { sweepEmailBouncesAndReplies_ = realSweep; }
      TestAssertEqual_(TestGmailLog_.sent.filter(function (e) { return /sweepEmailBouncesAndReplies crashed/.test(e.subject); }).length, 1, 'trigger: a crash raises one alert');
      TestAssertEqual_(readEmailJobRunGs_(EMAIL_SWEEP_JOB_).status, 'failed', 'trigger: …and the run record says failed');

      // the sweep never takes the script-wide job lock either
      TestSW_bind_(TestMockSpreadsheet_({}));
      TestSW_gmail_([], {});
      LockService = TestMockLockService_({ denyLock: true });
      sweepEmailBouncesAndReplies();
      TestAssertEqual_(LockService._state.tryLockCalls + ',' + LockService._state.getCalls + ',' + readEmailJobRunGs_(EMAIL_SWEEP_JOB_).status, '0,0,completed', 'no lock: the sweep runs and is recorded without ever asking for the script lock');
      LockService = TestMockLockService_();

      ScriptApp = TestMockScriptApp_(['sweepEmailBouncesAndReplies', 'other']);
      setupEmailSweepTrigger();
      const spec = ScriptApp._state.created[0];
      TestAssertEqual_(ScriptApp._state.created.length + ',' + spec.fnName + ',' + spec.hour + ',' + spec.minute + ',' + spec.tz, '4,sweepEmailBouncesAndReplies,15,30,Asia/Kolkata', 'setup: the full sweep daily near 15:30 IST (plus the three bounce-only checks - see Tests_EmailReroute.gs)');
      TestAssertEqual_(ScriptApp._state.deleted.join(','), 'sweepEmailBouncesAndReplies', 'setup: only its own earlier trigger is deleted');

      PropertiesService = TestMockPropertiesService_(); // no run records: the watchdog sees a sweep that never started
      const sched = emailJobScheduleGs_().sweepEmailBouncesAndReplies;
      TestAssertEqual_(sched ? sched.hour + ':' + sched.minute + ' ' + sched.label : 'missing', '15:30 15:30 bounce/reply sweep', 'watchdog: the sweep is on the schedule');
      const late = emailJobProblemsGs_(new Date('2026-10-09T16:20:00+05:30')).filter(function (p) { return p.job === 'sweepEmailBouncesAndReplies'; });
      TestAssertEqual_(late.length + ',' + (late[0] ? late[0].kind : ''), '1,never_started', 'watchdog: at 16:20 a sweep that did not run is flagged');
      TestAssertContains_(late[0] ? late[0].detail : '', 'should have started by 16:00 IST', 'watchdog: …with its 16:00 deadline');
    }

    TestAssertOnlyTestEmails_();
  } finally {
    emailRerouteHandleBouncesGs_ = realRerouteHandler;
    TEST_MODE_OVERRIDE_EMAIL_ = '';
    TestEnv_tearDown_();
  }
  return TestResults_;
}

function runEmailSweepTestsNow() { runEmailSweepTests_(); }
