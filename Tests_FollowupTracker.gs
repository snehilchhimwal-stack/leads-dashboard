/**
 * Tests: FollowupTracker.gs - the follow-up tracker (Email Ops EO-7), and the shared one-block-per-day writer it uses (emailLedgerReplaceDayBlockGs_, EmailLedger.gs).
 * Run runFollowupTrackerTestsNow() from the function dropdown, or via runAllTests() (Tests_RunAll.gs). Everything is in-memory (sheets, Gmail, Properties are fakes -
 * see Tests_Mocks.gs); nothing is sent for real.
 *
 * Layers: the checkpoint status rules on their own (every status, the time boundaries), the tracker over hand-built log and ledger rows, the report sections, the reader
 * against a real AllIssues_Log, the Followup_Tracker tab, and a real 17:00 -> 10:00 -> 13:00 cycle reported on - complete first, then damaged one piece at a time.
 */

const TESTFT_DAY_ = '2026-10-09';   // the cycle day: the day of the 17:00 emails
const TESTFT_NEXT_ = '2026-10-10';  // the day of their two checkpoints

function TestFT_log_(o) { return Object.assign({ region: 'Pune', label: 'Test A1 One', role: 'A1', to: 'a@x.test', leadCount: 3, cp1At: '', cp2At: '' }, o || {}); }

function TestFT_led_(job, status, o) {
  const day = job === 'allIssues17' ? TESTFT_DAY_ : TESTFT_NEXT_;
  return Object.assign({ job: job, cycle_day: day, region: 'Pune', bucket_label: '', to: 'a@x.test', status: status, status_reason: '', bounce_status: '', reply_status: '' }, o || {});
}

function TestFT_at_(hhmm, day) { return new Date((day || TESTFT_NEXT_) + 'T' + hhmm + ':00+05:30'); }

function runFollowupTrackerTests_() {
  TestEnv_setUp_('Tests_FollowupTracker', TestMockSpreadsheet_({}));
  try {
    // ================= helpers =================
    TestAssertEqual_(followupKeyGs_(' Pune ', 'A@X.test ') + ',' + followupKeyGs_(null, undefined), 'pune|a@x.test,|', 'key: region and recipient are trimmed and lower-cased, blanks are safe');
    TestAssertEqual_(followupNextDayGs_('2026-10-09') + ',' + followupNextDayGs_('2026-10-31') + ',' + followupNextDayGs_('2026-12-31'), '2026-10-10,2026-11-01,2027-01-01', 'next day: month and year rollovers');

    // ================= one checkpoint =================
    {
      const due = TestFT_at_('10:00');
      const st = function (o, nowHhmm) { return followupCheckpointStatusGs_(Object.assign({ stamp: '', ledgerStatus: '', ledgerReason: '', dueAt: due, now: TestFT_at_(nowHhmm || '10:05'), blockedBy: '' }, o)); };
      TestAssertEqual_(st({ ledgerStatus: 'SKIPPED' }).status + ',' + st({ ledgerStatus: 'SKIPPED', stamp: 'x' }).status, 'NOT_NEEDED,NOT_NEEDED', 'status: a SKIPPED email (nothing left to follow up) is NOT_NEEDED, stamp or not');
      TestAssertContains_(st({ ledgerStatus: 'SKIPPED', ledgerReason: 'nothing unresolved' }).note, 'nothing unresolved', 'status: …with the ledger\'s reason');
      TestAssertEqual_(st({ ledgerStatus: 'ACCEPTED', stamp: 'x' }).status + ',' + st({ ledgerStatus: 'ACCEPTED' }).status, 'COMPLETED,COMPLETED', 'status: an ACCEPTED email is COMPLETED');
      TestAssertContains_(st({ ledgerStatus: 'ACCEPTED' }).note, 'the log stamp is missing', 'status: …and says so when its log stamp is missing');
      TestAssertEqual_(['FAILED', 'BLOCKED', 'UNCONFIRMED', 'PLANNED', 'ATTEMPTING'].map(function (s) { return st({ ledgerStatus: s }).status; }).join(','), 'BLOCKED,BLOCKED,BLOCKED,BLOCKED,BLOCKED', 'status: failed, blocked, unconfirmed and unfinished emails are BLOCKED');
      TestAssertEqual_(st({ ledgerStatus: 'FAILED', stamp: 'x' }).status, 'BLOCKED', 'status: the ledger outranks a log stamp (a FAILED email with a stamp is still BLOCKED)');
      TestAssertContains_(st({ ledgerStatus: 'UNCONFIRMED' }).note, 'check Gmail Sent', 'status: an unconfirmed send tells you to check Gmail Sent');
      TestAssertContains_(st({ ledgerStatus: 'FAILED', ledgerReason: 'Gmail said no' }).note, 'Gmail said no', 'status: a failure carries its reason');
      TestAssertEqual_(st({ stamp: '2026-10-10 10:01:00' }).status, 'COMPLETED', 'status: a log stamp alone (no ledger row) is COMPLETED');
      TestAssertEqual_(st({ blockedBy: 'waits for X' }).status + ',' + st({ blockedBy: 'waits for X' }).note, 'BLOCKED,waits for X', 'status: a known blocker makes it BLOCKED, with its reason');
      TestAssertEqual_(st({ blockedBy: 'waits for X', ledgerStatus: 'ACCEPTED' }).status + ',' + st({ blockedBy: 'waits for X', stamp: 'x' }).status, 'COMPLETED,COMPLETED', 'status: a blocker is ignored once the email is done');
      TestAssertEqual_([st({}, '09:59').status, st({}, '10:00').status, st({}, '10:29').status, st({}, '10:30').status, st({}, '14:00').status].join(','), 'FUTURE,DUE,DUE,OVERDUE,OVERDUE', 'status: before the hour FUTURE, from the hour DUE, 30 minutes after it OVERDUE');
      TestAssertContains_(st({}, '11:00').note, '60 minutes after it was due at 10:00 IST', 'status: OVERDUE says how late it is');
      TestAssertContains_(st({}, '09:00').note, 'due 10 Oct 10:00 IST', 'status: FUTURE says when it is due');
    }

    // ================= the tracker =================
    const track = function (logRows, ledgerRows, nowHhmm, nowDay) { return followupTrackerGs_({ cycleDay: TESTFT_DAY_, logRows: logRows, ledgerRows: ledgerRows, now: TestFT_at_(nowHhmm || '16:30', nowDay) }); };
    {
      const t = track([TestFT_log_()], [TestFT_led_('allIssues17', 'ACCEPTED'), TestFT_led_('morning10', 'ACCEPTED'), TestFT_led_('followup13', 'ACCEPTED')]);
      TestAssertEqual_(t.rows.length + ',' + t.rows[0].cp1.status + ',' + t.rows[0].cp2.status + ',' + t.attention.length, '1,COMPLETED,COMPLETED,0', 'tracker: a bucket whose two checkpoints were accepted is COMPLETED / COMPLETED, nothing needs attention');
      TestAssertEqual_(t.counts.cp1.COMPLETED + ',' + t.counts.cp2.COMPLETED + ',' + t.counts.cp1.BLOCKED, '1,1,0', 'tracker: the counts follow the rows');
      TestAssertEqual_(t.rows[0].region + '|' + t.rows[0].bucket + '|' + t.rows[0].role + '|' + t.rows[0].to + '|' + t.rows[0].leads, 'Pune|Test A1 One|A1|a@x.test|3', 'tracker: the row carries the bucket');
    }
    {
      // Checkpoint 1 failed: Checkpoint 2 has no 10:00 thread to reply in
      const t = track([TestFT_log_()], [TestFT_led_('allIssues17', 'ACCEPTED'), TestFT_led_('morning10', 'FAILED', { status_reason: 'Gmail said no' })]);
      TestAssertEqual_(t.rows[0].cp1.status + ',' + t.rows[0].cp2.status, 'BLOCKED,BLOCKED', 'tracker: a failed Checkpoint 1 also blocks Checkpoint 2');
      TestAssertContains_(t.rows[0].cp2.note, 'no 10:00 thread to reply in', 'tracker: …and says why');
      TestAssertEqual_(t.attention.map(function (a) { return a.checkpoint + ':' + a.status; }).join(','), '1 (10:00):BLOCKED,2 (13:00):BLOCKED', 'tracker: both checkpoints are listed for attention');
    }
    {
      // Checkpoint 1 never recorded anything, long after its time: OVERDUE, and Checkpoint 2 is blocked by it
      const t = track([TestFT_log_()], [TestFT_led_('allIssues17', 'ACCEPTED')], '16:30');
      TestAssertEqual_(t.rows[0].cp1.status + ',' + t.rows[0].cp2.status, 'OVERDUE,BLOCKED', 'tracker: nothing recorded for Checkpoint 1 at 16:30 -> OVERDUE, and Checkpoint 2 is blocked by it');
    }
    {
      // the tracker's own due times: Checkpoint 1 at 10:00, Checkpoint 2 at 13:00, each DUE for 30 minutes and then OVERDUE
      const at = function (hhmm) { return track([TestFT_log_()], [], hhmm); };
      TestAssertEqual_([at('09:59'), at('10:15'), at('10:45')].map(function (t) { return t.rows[0].cp1.status; }).join(','), 'FUTURE,DUE,OVERDUE', 'tracker: Checkpoint 1 is FUTURE before 10:00, DUE at 10:15 and OVERDUE at 10:45');
      TestAssertEqual_(track([TestFT_log_({ cp1At: 'x' })], [], '12:59').rows[0].cp2.status + ',' + track([TestFT_log_({ cp1At: 'x' })], [], '13:15').rows[0].cp2.status + ',' + track([TestFT_log_({ cp1At: 'x' })], [], '13:45').rows[0].cp2.status, 'FUTURE,DUE,OVERDUE', 'tracker: Checkpoint 2 is FUTURE before 13:00, DUE at 13:15 and OVERDUE at 13:45');
    }
    {
      // the day of the 17:00 email, evening: both checkpoints are still in the future
      const t = track([TestFT_log_()], [TestFT_led_('allIssues17', 'ACCEPTED')], '18:00', TESTFT_DAY_);
      TestAssertEqual_(t.rows[0].cp1.status + ',' + t.rows[0].cp2.status + ',' + t.attention.length, 'FUTURE,FUTURE,0', 'tracker: on the evening of the 17:00 email both checkpoints are FUTURE and nothing needs attention');
      const mid = track([TestFT_log_({ cp1At: '2026-10-10 10:01:00' })], [], '13:10');
      TestAssertEqual_(mid.rows[0].cp1.status + ',' + mid.rows[0].cp2.status, 'COMPLETED,DUE', 'tracker: at 13:10 a stamped Checkpoint 1 is COMPLETED and Checkpoint 2 is DUE');
    }
    {
      const t = track([TestFT_log_({ cp1At: 'x', cp2At: 'y' })], [TestFT_led_('allIssues17', 'ACCEPTED', { bounce_status: 'BOUNCED (550 no such user)' })]);
      TestAssertEqual_(t.rows[0].email + ',' + t.rows[0].stop + ',' + t.attention.map(function (a) { return a.status; }).join(','), 'BOUNCED,true,STOP', 'tracker: a bounced 17:00 email marks the row STOP and lists it');
      TestAssertContains_(t.attention[0].note, 'never received it', 'tracker: …saying the recipient never received it');
      TestAssertEqual_(t.rows[0].cp1.status, 'COMPLETED', 'tracker: STOP is a status only - the checkpoints are still judged on their own evidence');
      const r = track([TestFT_log_({ cp1At: 'x', cp2At: 'y' })], [TestFT_led_('allIssues17', 'ACCEPTED', { reply_status: 'REPLIED (2)' })]);
      TestAssertEqual_(r.rows[0].email + ',' + r.rows[0].stop + ',' + r.attention.length, 'REPLIED,false,0', 'tracker: a reply is shown but does not stop or flag anything');
      const unc = track([TestFT_log_({ cp1At: 'x', cp2At: 'y' })], [TestFT_led_('allIssues17', 'UNCONFIRMED', { bounce_status: 'BOUNCED (550)' })]);
      TestAssertEqual_(unc.rows[0].email + ',' + unc.rows[0].stop, 'BOUNCED,true', 'tracker: an UNCONFIRMED 17:00 email that bounced is STOP too (a bounce is proof it did not arrive)');
      const nb = track([TestFT_log_({ cp1At: 'x', cp2At: 'y' })], [TestFT_led_('allIssues17', 'ACCEPTED', { bounce_status: 'NO_BOUNCE_SEEN' })]);
      TestAssertEqual_(nb.rows[0].email + ',' + nb.rows[0].stop, ',false', 'tracker: "no bounce seen" is not a status');
    }
    {
      // matching: by region AND recipient; rows of other days are ignored
      const log = [TestFT_log_(), TestFT_log_({ region: 'Thane', to: 'b@x.test' })];
      const t = track(log, [TestFT_led_('morning10', 'ACCEPTED', { region: 'Thane', to: 'b@x.test' }), TestFT_led_('morning10', 'ACCEPTED', { cycle_day: '2026-10-08' }), TestFT_led_('morning10', 'ACCEPTED', { region: 'Mumbai' })]);
      TestAssertEqual_(t.rows[0].cp1.status + ',' + t.rows[1].cp1.status, 'OVERDUE,COMPLETED', 'tracker: Pune has no matching 10:00 row (another day\'s and another region\'s do not count); Thane does');
      const t2 = track([TestFT_log_({ region: 'Futwork', label: 'Futwork', to: 'f@x.test' })], [TestFT_led_('morning10', 'ACCEPTED', { region: 'Futwork', to: 'F@x.test ' })]);
      TestAssertEqual_(t2.rows[0].cp1.status, 'COMPLETED', 'tracker: the match ignores case and spaces in the recipient (and works for the Futwork pseudo-region)');
      const t3 = track([TestFT_log_()], [TestFT_led_('allIssues17', 'ACCEPTED', { cycle_day: '2026-10-10', bounce_status: 'BOUNCED x' })]);
      TestAssertEqual_(t3.rows[0].email, '', 'tracker: a 17:00 ledger row of another day is not this cycle\'s email');
      TestAssertEqual_(track([], []).rows.length + ',' + track([], []).counts.cp1.COMPLETED, '0,0', 'tracker: no 17:00 bucket logged -> no rows');
    }
    {
      // counts across several buckets
      const log = [TestFT_log_({ to: 'a@x.test' }), TestFT_log_({ to: 'b@x.test' }), TestFT_log_({ to: 'c@x.test' }), TestFT_log_({ to: 'd@x.test' })];
      const led = [
        TestFT_led_('morning10', 'ACCEPTED', { to: 'a@x.test' }), TestFT_led_('followup13', 'ACCEPTED', { to: 'a@x.test' }),
        TestFT_led_('morning10', 'SKIPPED', { to: 'b@x.test' }), TestFT_led_('followup13', 'SKIPPED', { to: 'b@x.test' }),
        TestFT_led_('morning10', 'FAILED', { to: 'c@x.test' }),
      ];
      const t = track(log, led);
      TestAssertEqual_(JSON.stringify(t.counts.cp1), JSON.stringify({ COMPLETED: 1, NOT_NEEDED: 1, BLOCKED: 1, OVERDUE: 1, DUE: 0, FUTURE: 0 }), 'counts: Checkpoint 1 over four buckets');
      TestAssertEqual_(JSON.stringify(t.counts.cp2), JSON.stringify({ COMPLETED: 1, NOT_NEEDED: 1, BLOCKED: 2, OVERDUE: 0, DUE: 0, FUTURE: 0 }), 'counts: Checkpoint 2 over the same four (the failed and the overdue Checkpoint 1 block it)');
    }

    // ================= the report sections =================
    {
      const t = track([TestFT_log_()], [TestFT_led_('morning10', 'ACCEPTED'), TestFT_led_('followup13', 'ACCEPTED')]);
      const secs = followupTrackerSectionsGs_(t);
      TestAssertEqual_(secs.length + ',' + secs[0].columns.join('|') + ',' + secs[0].rows.length, '1,Checkpoint|Completed|Not needed|Blocked|Overdue|Due|Future,2', 'sections: one counts table with the two checkpoints when nothing needs attention');
      TestAssertContains_(secs[0].heading, '2026-10-09 (1 bucket(s))', 'sections: the heading names the cycle day and the bucket count');
      TestAssertEqual_(secs[0].rows[0].join(','), '1 - the 10:00 email,1,0,0,0,0,0', 'sections: the Checkpoint 1 line');
      const bad = followupTrackerSectionsGs_(track([TestFT_log_()], [TestFT_led_('morning10', 'FAILED')]));
      TestAssertEqual_(bad.length + ',' + bad[1].heading + ',' + (bad[1].accent && bad[1].accent.fg), '2,Follow-ups needing attention (2),#dc2626', 'sections: items needing attention get their own red table');
      TestAssertEqual_(bad[1].rows[0].join('|'), 'Pune|Test A1 One|1 (10:00)|BLOCKED|the email failed', 'sections: region, bucket (or the recipient when it has no name), checkpoint, status, why');
      const many = [];
      for (let i = 0; i < 40; i++) many.push(TestFT_log_({ to: 'u' + i + '@x.test' }));
      const big = followupTrackerSectionsGs_(track(many, []));
      TestAssertEqual_(big[1].rows.length + ',' + (big[1].subheading.indexOf('First 30 of 80') === 0), '30,true', 'sections: a long list is cut at 30 rows and says how many there are');
      const none = followupTrackerSectionsGs_(track([], []));
      TestAssertEqual_(none.length + ',' + none[0].rows.length, '1,0', 'sections: with no 17:00 bucket logged a single note says so');
      TestAssertContains_(none[0].subheading, 'No 17:00 bucket was logged', 'sections: …in words');
      const unread = followupTrackerSectionsGs_({ cycleDay: TESTFT_DAY_, rows: [], counts: null, attention: [], unreadable: true });
      TestAssertContains_(unread[0].subheading, 'could not be read', 'sections: an unreadable log is said to be missing evidence');
    }

    // ================= the shared day-block writer =================
    {
      const headers = ['day', 'v'];
      const mk = function () { return emailLedgerEnsureSheetGs_(TestMockSpreadsheet_({}), 'T', headers, [1]); };
      const vals = function (sh) { return sh.getLastRow() < 2 ? [] : sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().map(function (r) { return r.join(':'); }); };
      const sh = mk();
      emailLedgerReplaceDayBlockGs_(sh, [['d1', 'a'], ['d1', 'b']], 'd1', 'T');
      TestAssertEqual_(vals(sh).join(','), 'd1:a,d1:b', 'block: the first block of the first day is appended');
      emailLedgerReplaceDayBlockGs_(sh, [['d1', 'c'], ['d1', 'd']], 'd1', 'T');
      TestAssertEqual_(vals(sh).join(','), 'd1:c,d1:d', 'block: the same day with the same size is replaced in place');
      emailLedgerReplaceDayBlockGs_(sh, [['d1', 'e'], ['d1', 'f'], ['d1', 'g']], 'd1', 'T');
      TestAssertEqual_(vals(sh).join(','), 'd1:e,d1:f,d1:g', 'block: the same day with MORE rows replaces the block whole');
      emailLedgerReplaceDayBlockGs_(sh, [['d1', 'h']], 'd1', 'T');
      TestAssertEqual_(vals(sh).join(','), 'd1:h', 'block: the same day with FEWER rows replaces the block whole');
      emailLedgerReplaceDayBlockGs_(sh, [['d2', 'x'], ['d2', 'y']], 'd2', 'T');
      TestAssertEqual_(vals(sh).join(','), 'd1:h,d2:x,d2:y', 'block: a new day appends its own block and leaves the earlier day alone');
      emailLedgerReplaceDayBlockGs_(sh, [['d2', 'z']], 'd2', 'T');
      TestAssertEqual_(vals(sh).join(','), 'd1:h,d2:z', 'block: only the last day\'s block is replaced');
      const empty = mk();
      emailLedgerReplaceDayBlockGs_(empty, [['d1', 'a']], 'd1', 'T');
      TestAssertEqual_(vals(empty).join(','), 'd1:a', 'block: an empty tab (header only) works');
      const keepHeader = mk();
      emailLedgerReplaceDayBlockGs_(keepHeader, [['d1', 'a'], ['d1', 'b']], 'd1', 'T');
      emailLedgerReplaceDayBlockGs_(keepHeader, [['d1', 'c']], 'd1', 'T');
      TestAssertEqual_(keepHeader.getRange(1, 1, 1, 2).getValues()[0].join(','), 'day,v', 'block: the header row is never touched');
      // a long tab: the day's block is found quickly and exactly
      const long = mk();
      const old = [];
      for (let i = 0; i < 300; i++) old.push(['old', String(i)]);
      long.getRange(2, 1, 300, 2).setValues(old);
      emailLedgerReplaceDayBlockGs_(long, [['d9', 'a'], ['d9', 'b']], 'd9', 'T');
      emailLedgerReplaceDayBlockGs_(long, [['d9', 'c'], ['d9', 'd'], ['d9', 'e']], 'd9', 'T');
      TestAssertEqual_(long.getLastRow() + ',' + vals(long).slice(-3).join(','), '304,d9:c,d9:d,d9:e', 'block: with 300 old rows above, only the day\'s block changes');
    }

    // ================= the reader =================
    {
      const header = TestFixture_leadsHeader_();
      const banner = header.map(function () { return ''; });
      const ss = TestMockSpreadsheet_({
        'RM_Hierarchy': TestMockSheet_('RM_Hierarchy', TestFixture_rmHierarchyRows_()),
        'Manager_Directory': TestMockSheet_('Manager_Directory', TestFixture_managerDirectoryRows_()),
      });
      ss._sheets['leads'] = TestMockSheet_('leads', [banner, header, TestEL_leadRow_(header, { lead_id: 'L-A', client_id: 'C-A', RM: 'Test RM One', lead_assigned_at: new Date(), rm_is_active: false })]);
      TestAssertEqual_(followupTrackerReadLogGs_(ss, TESTFT_DAY_).length, 0, 'reader: no AllIssues_Log tab -> no rows (not an error)');
      TestEL_bind_(ss);
      sendAllIssuesEmails();
      const today = istDayKeyGs_(new Date());
      const rows = followupTrackerReadLogGs_(ss, today);
      TestAssertEqual_(rows.length + ',' + rows[0].region + ',' + rows[0].label + ',' + rows[0].role + ',' + rows[0].leadCount + ',' + (rows[0].to === TEST_EMAIL_PRIMARY_) + ',' + rows[0].cp1At + ',' + rows[0].cp2At, '1,Pune,Test A1 One,A1,1,true,,', 'reader: the 17:00 bucket of the day with its recipient and (blank) checkpoint stamps');
      TestAssertEqual_(followupTrackerReadLogGs_(ss, '2020-01-01').length, 0, 'reader: another day\'s rows are not returned');
      ss.getSheetByName('AllIssues_Log').getRange(2, 12, 1, 1).setValues([['2026-10-10 10:01:00']]);
      ss.getSheetByName('AllIssues_Log').getRange(2, 14, 1, 1).setValues([['2026-10-10 13:01:00']]);
      const stamped = followupTrackerReadLogGs_(ss, today)[0];
      TestAssertEqual_(stamped.cp1At + '|' + stamped.cp2At, '2026-10-10 10:01:00|2026-10-10 13:01:00', 'reader: the Checkpoint 1 and Checkpoint 2 stamps');
      const realSheet = ss.getSheetByName;
      ss.getSheetByName = function () { throw new Error('simulated: the tab cannot be read'); };
      TestAssertEqual_(String(followupTrackerReadLogGs_(ss, today)), 'null', 'reader: a tab that cannot be read gives null (missing evidence), never an exception');
      ss.getSheetByName = realSheet;
      // the Futwork grouping, and rows without a recipient
      const log = ss.getSheetByName('AllIssues_Log');
      log.appendRow([today, 'Thane', 'Futwork', 'A1', 'f@x.test', '', 2, new Date(), 'th', '[]', '', '', '', '']);
      log.appendRow([today, 'Thane', 'No Recipient', 'A1', '', '', 2, new Date(), 'th', '[]', '', '', '', '']);
      const all = followupTrackerReadLogGs_(ss, today);
      TestAssertEqual_(all.map(function (r) { return r.region + ':' + r.to; }).join(','), 'Pune:' + TEST_EMAIL_PRIMARY_ + ',Futwork:f@x.test', 'reader: the Futwork bucket is keyed by the Futwork pseudo-region; a row without a recipient is dropped');
    }

    // ================= the Followup_Tracker tab =================
    {
      const ss = TestMockSpreadsheet_({});
      const read = function () { return TestEL_objects_(ss.getSheetByName(FOLLOWUP_TRACKER_SHEET_), FOLLOWUP_TRACKER_HEADERS_); };
      const t = track([TestFT_log_(), TestFT_log_({ to: 'b@x.test' })], [TestFT_led_('allIssues17', 'ACCEPTED', { bounce_status: 'BOUNCED x' }), TestFT_led_('morning10', 'FAILED')]);
      const now = new Date();
      followupTrackerRecordGs_(ss, t, now);
      TestAssertEqual_(read().length + ',' + read()[0].report_day + ',' + read()[0].cycle_day + ',' + read()[0].checkpoint1 + ',' + read()[0].checkpoint2 + ',' + read()[0].email_status + ',' + read()[0].stop, '2,' + istDayKeyGs_(now) + ',' + TESTFT_DAY_ + ',BLOCKED,BLOCKED,BOUNCED,yes', 'tab: one row per bucket with both checkpoints, the email status and STOP');
      TestAssertEqual_(read()[1].stop + '|' + read()[1].email_status, '|', 'tab: a bucket without a stop leaves the column blank');
      TestAssertEqual_(ss.getSheetByName(FOLLOWUP_TRACKER_SHEET_).getRange(1, 1, 1, 14).getValues()[0].join(','), FOLLOWUP_TRACKER_HEADERS_.join(','), 'tab: created with its header row');
      const t2 = track([TestFT_log_()], []);
      followupTrackerRecordGs_(ss, t2, now);
      TestAssertEqual_(read().length, 1, 'tab: sending the report again the same day REPLACES the block (fewer buckets -> fewer rows), no duplicates');
      followupTrackerRecordGs_(ss, t, new Date(now.getTime() + 24 * 3600 * 1000));
      TestAssertEqual_(read().length + ',' + read()[0].report_day, '3,' + istDayKeyGs_(now), 'tab: the next day appends its own block and leaves the earlier day alone');
      const longNote = followupTrackerGs_({ cycleDay: TESTFT_DAY_, logRows: [TestFT_log_()], ledgerRows: [TestFT_led_('morning10', 'FAILED', { status_reason: new Array(500).join('x') })], now: TestFT_at_('16:30') });
      const ss2 = TestMockSpreadsheet_({});
      followupTrackerRecordGs_(ss2, longNote, now);
      TestAssertEqual_(TestEL_objects_(ss2.getSheetByName(FOLLOWUP_TRACKER_SHEET_), FOLLOWUP_TRACKER_HEADERS_)[0].checkpoint1_note.length, 300, 'tab: a long note is cut to 300 characters');
      const ss3 = TestMockSpreadsheet_({});
      TEST_MODE_OVERRIDE_EMAIL_ = TEST_EMAIL_PRIMARY_;
      try { followupTrackerRecordGs_(ss3, t, now); } finally { TEST_MODE_OVERRIDE_EMAIL_ = ''; }
      TestAssert_(!ss3.getSheetByName(FOLLOWUP_TRACKER_SHEET_), 'tab: TEST MODE creates and writes nothing');
      const ss4 = TestMockSpreadsheet_({});
      followupTrackerRecordGs_(ss4, track([], []), now);
      TestAssert_(!ss4.getSheetByName(FOLLOWUP_TRACKER_SHEET_), 'tab: with no bucket there is nothing to store and no tab is created');
      const realEnsure = emailLedgerEnsureSheetGs_;
      emailLedgerEnsureSheetGs_ = function () { throw new Error('simulated: the tab cannot be opened'); };
      let threw = false;
      try { followupTrackerRecordGs_(TestMockSpreadsheet_({}), t, now); } catch (e) { threw = true; } finally { emailLedgerEnsureSheetGs_ = realEnsure; }
      TestAssertEqual_(threw, false, 'tab: a failure to store the rows is swallowed - the report is never affected');
    }

    // ================= the real report =================
    {
      const header = TestFixture_leadsHeader_();
      const banner = header.map(function () { return ''; });
      const now0 = new Date();
      const ss = TestMockSpreadsheet_({
        'RM_Hierarchy': TestMockSheet_('RM_Hierarchy', TestFixture_rmHierarchyRows_()),
        'Manager_Directory': TestMockSheet_('Manager_Directory', TestFixture_managerDirectoryRows_()),
      });
      ss._sheets['leads'] = TestMockSheet_('leads', [banner, header, TestEL_leadRow_(header, {
        lead_id: 'L-CYCLE', client_id: 'C-CYCLE', RM: 'Test RM One', current_stage: 'Suspect', lead_assigned_at: TestFixture_hoursAgo_(now0, 40),
        last_connect: 'Connected', last_connect_time: TestFixture_hoursAgo_(now0, 10),
        internal_status_comments: 'Test RM One: Ringing - ' + Utilities.formatDate(TestFixture_hoursAgo_(now0, 10), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm'),
      })]);
      TestEL_bind_(ss);
      sendAllIssuesEmails();
      ss.getSheetByName('AllIssues_Log').getRange(2, 1, 1, 1).setValues([[TestFixture_daysAgo_(now0, 1)]]);
      sendOvernightMorningEmails();
      sendOvernightFollowupEmails();
      // Put the cycle on the report's own calendar: whichever clock the suite runs at, the report's cycle day is the day of the window's start, so the 17:00 rows are dated that
      // day and the 10:00 / 13:00 rows the day after.
      const reportNow = new Date(Date.now() + 60000);
      const cycleDay = istDayKeyGs_(cycleReportWindowGs_(reportNow).start), nextDay = followupNextDayGs_(cycleDay);
      ss.getSheetByName('AllIssues_Log').getRange(2, 1, 1, 1).setValues([[cycleDay]]);
      const ledgerSheet = ss.getSheetByName(EMAIL_LEDGER_SHEET_);
      const ledgerRows = function () { return emailLedgerReadRowsGs_(ledgerSheet, EMAIL_LEDGER_HEADERS_, '2000-01-01'); };
      ledgerRows().forEach(function (r) {
        ledgerSheet.getRange(r.rowNo, emailLedgerCol_('cycle_day'), 1, 1).setValues([[r.job === 'allIssues17' ? cycleDay : nextDay]]);
      });
      const jobRow = function (job) { return ledgerRows().filter(function (r) { return r.job === job; })[0]; };
      const setLedger = function (job, col, value) { ledgerSheet.getRange(jobRow(job).rowNo, emailLedgerCol_(col), 1, 1).setValues([[value]]); };

      const built = buildEmailCycleReportGs_(ss, reportNow);
      const f = built.data.followups;
      TestAssertEqual_(f ? f.cycleDay + ',' + f.rows.length + ',' + f.rows[0].cp1.status + ',' + f.rows[0].cp2.status + ',' + f.attention.length : 'none', cycleDay + ',1,COMPLETED,COMPLETED,0', 'real cycle: the bucket\'s two checkpoints are COMPLETED and nothing needs attention');
      TestAssertContains_(built.plainBody, 'Follow-ups from the 17:00 emails of ' + cycleDay, 'real cycle: the report carries the tracker section');
      TestAssertContains_(built.html, 'Follow-ups from the 17:00 emails of ' + cycleDay, 'real cycle: …in the HTML too');
      TestGmailLog_.sent.length = 0;
      sendEmailCycleReport_({ now: reportNow });
      sendEmailCycleReport_({ now: reportNow, force: true });
      const stored = TestEL_objects_(ss.getSheetByName(FOLLOWUP_TRACKER_SHEET_), FOLLOWUP_TRACKER_HEADERS_);
      TestAssertEqual_(stored.length + ',' + stored[0].cycle_day + ',' + stored[0].checkpoint1, '1,' + cycleDay + ',COMPLETED', 'real cycle: sending the report stores the row once, and a second send replaces it');

      // one piece of evidence damaged at a time
      const flags = function () { const t = buildEmailCycleReportGs_(ss, reportNow).data.followups; return t.rows[0].cp1.status + '/' + t.rows[0].cp2.status + '/' + t.rows[0].email + '/' + t.attention.length; };
      setLedger('morning10', 'status', 'FAILED');
      TestAssertEqual_(flags(), 'BLOCKED/COMPLETED//1', 'real cycle, the 10:00 email FAILED: Checkpoint 1 is BLOCKED (Checkpoint 2 has its own accepted reply, so it stays COMPLETED)');
      setLedger('morning10', 'status', 'ACCEPTED');
      setLedger('followup13', 'status', 'UNCONFIRMED');
      TestAssertEqual_(flags(), 'COMPLETED/BLOCKED//1', 'real cycle, the 13:00 reply is UNCONFIRMED: Checkpoint 2 is BLOCKED and says to check Gmail Sent');
      setLedger('followup13', 'status', 'ACCEPTED');
      setLedger('allIssues17', 'bounce_status', 'BOUNCED (550 5.1.1 no such user)');
      TestAssertEqual_(flags(), 'COMPLETED/COMPLETED/BOUNCED/1', 'real cycle, the 17:00 email bounced: the row is STOP and listed');
      setLedger('allIssues17', 'bounce_status', 'NO_BOUNCE_SEEN');
      setLedger('allIssues17', 'reply_status', 'REPLIED (1)');
      TestAssertEqual_(flags(), 'COMPLETED/COMPLETED/REPLIED/0', 'real cycle, a reply to the 17:00 email: shown, nothing flagged');
      setLedger('allIssues17', 'reply_status', '');
      // the AllIssues_Log cannot be read: the report says so instead of guessing
      const realSheetFn = ss.getSheetByName;
      ss.getSheetByName = function (n) { if (n === 'AllIssues_Log') throw new Error('simulated'); return realSheetFn.call(ss, n); };
      let unreadable;
      try { unreadable = buildEmailCycleReportGs_(ss, reportNow); } finally { ss.getSheetByName = realSheetFn; }
      TestAssertEqual_(unreadable.data.followups && unreadable.data.followups.unreadable === true, true, 'real cycle, AllIssues_Log unreadable: the tracker says "unreadable" (missing evidence)');
      TestAssertContains_(unreadable.plainBody, 'could not be read', 'real cycle, AllIssues_Log unreadable: the report says so');
    }

    // ================= the report keeps working without it =================
    {
      const win = { start: new Date(Date.now() - 86400000), end: new Date() };
      const base = { window: win, ledgerRows: [], exclusionRows: [], incidentRows: [], configProblems: [] };
      TestAssertEqual_(cycleReportDataGs_(base).followups, null, 'report data: the tracker is not built unless the caller supplies the log');
      const d = cycleReportDataGs_(Object.assign({ followupLog: [] }, base));
      TestAssertEqual_(d.followups && d.followups.rows.length === 0, true, 'report data: an empty log gives an empty tracker');
      const realFn = followupTrackerGs_;
      followupTrackerGs_ = function () { throw new Error('simulated tracker failure'); };
      let d2;
      try { d2 = cycleReportDataGs_(Object.assign({ followupLog: [TestFT_log_()] }, base)); } finally { followupTrackerGs_ = realFn; }
      TestAssertEqual_(d2.followups === null && d2.empty === true, true, 'report data: a failure inside the tracker leaves the report data intact (no tracker section)');
      TestAssert_(cycleReportRenderGs_(d2, new Date()).plainBody.indexOf('Follow-ups from') === -1, 'report render: without a tracker the report is exactly as before');
    }

    TestAssertOnlyTestEmails_();
  } finally {
    TEST_MODE_OVERRIDE_EMAIL_ = '';
    TestEnv_tearDown_();
  }
  return TestResults_;
}

function runFollowupTrackerTestsNow() { runFollowupTrackerTests_(); }
