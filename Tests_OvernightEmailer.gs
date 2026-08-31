/**
 * Tests: OvernightEmailer.gs — the 10am morning send, 1pm follow-up,
 * CH-level diversion, and their supporting helpers. Run
 * runOvernightEmailerTestsNow() from the function dropdown, or via
 * runAllTests() (Tests_RunAll.gs).
 *
 * NOTE ON TIME: sendOvernightMorningEmails/sendOvernightFollowupEmails
 * read the real wall clock internally (`new Date()`, not injectable), so
 * every fixture lead's lead_assigned_at is placed using the REAL current
 * overnightWindowGs_(new Date()) window rather than a fixed date — this
 * keeps the suite correct no matter what real time it's actually run at,
 * rather than being flaky around the 5pm/9am window edges.
 */

function TestOE_leadRow_(header, overrides) {
  const defaults = {
    lead_id: 'L-X', client_id: 'C-X', RM: 'Test RM One', TL: 'Test A1 One', project: 'P', region: 'Pune',
    client: 'Client', lead_assigned_at: new Date(), group_source: 'google', source_bucket: 'Non-UTM',
    current_stage: 'Suspect', rm_is_active: true, call_attempts: 1,
  };
  const merged = Object.assign({}, defaults, overrides || {});
  return header.map(function (k) { return merged[k] !== undefined ? merged[k] : ''; });
}

function runOvernightEmailerTests_() {
  const now = new Date();
  const win = overnightWindowGs_(now);
  const midWindow = new Date((win.from.getTime() + win.to.getTime()) / 2);
  const outsideWindow = TestFixture_daysAgo_(now, 4);
  const monthShort = Utilities.formatDate(now, 'Asia/Kolkata', 'MMM');
  const header = TestFixture_leadsHeader_();
  const banner = header.map(function () { return ''; });

  const rows = [
    banner, header,
    TestOE_leadRow_(header, { lead_id: 'L-A', client_id: 'C-A', RM: 'Test RM One', lead_assigned_at: midWindow }),
    TestOE_leadRow_(header, { lead_id: 'L-B', client_id: 'C-B', RM: 'Test RM Two', lead_assigned_at: midWindow }),
    // Duplicate customer held by the same RM under two copies — the
    // FURTHER-progressed copy (Visit Booked) must be the one that survives.
    // 'Not Updated' (FUNNEL_ORDER_ rank 0) vs 'Suspect' (rank 1) —
    // deliberately the two LOWEST funnel stages: anything at "Visit
    // Booked" or above is >= 'opportunity' in FUNNEL_ORDER_ and would be
    // excluded entirely as Opp+ (isOppOrAbove_), not merely dedup-losing —
    // 'not updated'/'suspect' are the only two stages genuinely open here.
    TestOE_leadRow_(header, { lead_id: 'L-DUP-1', client_id: 'C-DUP', RM: 'Test RM One', current_stage: 'Not Updated', lead_assigned_at: midWindow }),
    TestOE_leadRow_(header, { lead_id: 'L-DUP-2', client_id: 'C-DUP', RM: 'Test RM One', current_stage: 'Suspect', lead_assigned_at: midWindow }),
    // CH personally holding a lead -> must divert to notifyChLevelLeadsGs_.
    TestOE_leadRow_(header, { lead_id: 'L-CH', client_id: 'C-CH', RM: 'Test CH Self', lead_assigned_at: midWindow }),
    // Excluded: already closed.
    TestOE_leadRow_(header, { lead_id: 'L-CLOSED', client_id: 'C-CLOSED', RM: 'Test RM One', current_stage: 'Won', lead_assigned_at: midWindow }),
    // Excluded: already Opportunity+.
    TestOE_leadRow_(header, { lead_id: 'L-OPP', client_id: 'C-OPP', RM: 'Test RM One', current_stage: 'Opportunity', lead_assigned_at: midWindow }),
    // Excluded: wrong source (not google).
    TestOE_leadRow_(header, { lead_id: 'L-WRONGSRC', client_id: 'C-WRONGSRC', RM: 'Test RM One', group_source: 'Facebook', lead_assigned_at: midWindow }),
    // Excluded: outside the overnight window entirely.
    TestOE_leadRow_(header, { lead_id: 'L-OLD', client_id: 'C-OLD', RM: 'Test RM One', lead_assigned_at: outsideWindow }),
  ];

  const ss = TestMockSpreadsheet_({
    'RM_Hierarchy': TestMockSheet_('RM_Hierarchy', TestFixture_rmHierarchyRows_()),
    'Manager_Directory': TestMockSheet_('Manager_Directory', TestFixture_managerDirectoryRows_()),
  });
  ss._sheets[monthShort] = TestMockSheet_(monthShort, rows);

  TestEnv_setUp_('Tests_OvernightEmailer', ss);
  try {
    // ---- overnightWindowGs_ ----
    TestAssertEqual_(win.to.getTime() - win.from.getTime(), 16 * 3600 * 1000, 'overnightWindowGs_: the window spans exactly 16 hours (5pm to 9am)');

    // ---- ensureOvernightLogSheet_ ----
    const logSheet = ensureOvernightLogSheet_(ss);
    TestAssertEqual_(logSheet.getLastRow(), 1, 'ensureOvernightLogSheet_: a fresh sheet has just the header row');
    TestAssertContains_(logSheet.getRange(1, 1, 1, 8).getValues()[0].join(','), 'thread_id', 'ensureOvernightLogSheet_: header includes thread_id');

    // ---- sendOvernightMorningEmails: end to end ----
    sendOvernightMorningEmails();

    TestAssertEqual_(TestGmailLog_.drafts.length, 2, 'sendOvernightMorningEmails: sends exactly 2 emails — 1 normal A1 bucket + 1 CH-level report');
    const normalDraft = TestGmailLog_.drafts.find(function (d) { return d.to === TEST_EMAIL_PRIMARY_; });
    const chDraft = TestGmailLog_.drafts.find(function (d) { return d.to.indexOf(TEST_EMAIL_CH_) !== -1; });
    TestAssert_(!!normalDraft, 'sendOvernightMorningEmails: the normal per-A1 bucket email went to the A1\'s own address');
    TestAssert_(!!chDraft, 'sendOvernightMorningEmails: the CH-level report went to ops+CH addresses');

    // Lead IDs only appear in the HTML body's per-lead table — the plain
    // body is deliberately just a one-line count summary (by design, see
    // sendOneOvernightEmail_'s own plainBody construction), never a
    // per-lead listing.
    TestAssertContains_(normalDraft.htmlBody, 'L-A', 'sendOvernightMorningEmails: bucket email lists lead A');
    TestAssertContains_(normalDraft.htmlBody, 'L-B', 'sendOvernightMorningEmails: bucket email lists lead B (same A1, different RM)');
    TestAssertContains_(normalDraft.htmlBody, 'L-DUP-2', 'sendOvernightMorningEmails: dedup keeps the FURTHER-progressed duplicate copy (Suspect over Not Updated)');
    // L-DUP-1 (the earlier-stage, discarded copy) must NEVER appear —
    // only the survivor's own lead_id (L-DUP-2) does.
    ['L-CLOSED', 'L-OPP', 'L-WRONGSRC', 'L-OLD', 'L-CH', 'L-DUP-1'].forEach(function (id) {
      TestAssert_(normalDraft.htmlBody.indexOf(id) === -1, 'sendOvernightMorningEmails: excluded/diverted/discarded lead ' + id + ' never appears in the normal bucket email');
    });
    TestAssertContains_(chDraft.htmlBody, 'L-CH', 'sendOvernightMorningEmails: the CH-level report lists the CH-held lead');
    TestAssertContains_(chDraft.subject, 'Test CH Self', 'sendOvernightMorningEmails: CH-level report subject names the CH');

    TestAssertEqual_(logSheet.getLastRow(), 2, 'sendOvernightMorningEmails: Overnight_Log gets exactly 1 new row (the CH-level report does not log — only normal sends do)');

    // ---- idempotency guard: a second run the same day sends nothing new ----
    sendOvernightMorningEmails();
    TestAssertEqual_(TestGmailLog_.drafts.length, 2, 'sendOvernightMorningEmails: a second run the same day is a no-op — region already logged today');

    TestAssertOnlyTestEmails_();

    // ---- sendOneOvernightEmail_: Gmail-blocked failure path (direct call) ----
    const realGmailApp = GmailApp;
    GmailApp = TestMockGmailApp_({ failSendCountFor: {} });
    // Override createDraft().send() to always throw the specific "operation
    // not allowed" rejection sendOneOvernightEmail_ has dedicated handling for.
    GmailApp.createDraft = function () {
      return { send: function () { throw new Error('Gmail operation not allowed for this user'); } };
    };
    try {
      const failRec = { to: TEST_EMAIL_PRIMARY_, cc: '', bucketLabel: 'Test A1 One', primaryRole: 'A1', source: 'test' };
      const failLeads = [{ lead_id: 'L-FAIL', RM: 'Test RM One', TL: 'Test A1 One', status: 'Suspect', followup: 'test', issue: null }];
      const result = sendOneOvernightEmail_(ss, logSheet, 'Pune', failRec, failLeads, '17 Aug 2026', istDayKeyGs_(now), now, win);
      TestAssert_(!!result && !!result.reason, 'sendOneOvernightEmail_: returns a {reason} object instead of throwing when Gmail blocks the send');
      TestAssertContains_(result.reason, 'operation not allowed', 'sendOneOvernightEmail_: the reason correctly identifies the Gmail send-block');
      TestAssert_(TestGmailLog_.sent.some(function (e) { return /Morning email failed/.test(e.subject); }), 'sendOneOvernightEmail_: fires an ops alert on send failure');
    } finally {
      GmailApp = realGmailApp;
    }

    // ---- sendOvernightFollowupEmails: resolved vs still-unresolved, threaded reply ----
    // A completely FRESH, isolated spreadsheet — NOT the `ss` the earlier
    // sendOvernightMorningEmails end-to-end test already ran against.
    // sendOvernightFollowupEmails() reads via
    // SpreadsheetApp.getActiveSpreadsheet() with no ss parameter, and
    // reusing `ss` here would mean it ALSO finds that earlier test's own
    // real Overnight_Log row (dated today, for the same 'Pune' region)
    // and processes both — cross-contaminating which thread_id actually
    // gets replied to.
    const followupSs = TestMockSpreadsheet_({
      'RM_Hierarchy': TestMockSheet_('RM_Hierarchy', TestFixture_rmHierarchyRows_()),
      'Manager_Directory': TestMockSheet_('Manager_Directory', TestFixture_managerDirectoryRows_()),
    });
    // 2 flagged leads: one that will now read as RESOLVED (reached
    // Opportunity+), one still genuinely unresolved.
    followupSs._sheets[monthShort] = TestMockSheet_(monthShort, [banner, header,
      TestOE_leadRow_(header, { lead_id: 'L-RESOLVED', client_id: 'C-RESOLVED', RM: 'Test RM One', current_stage: 'Opportunity', lead_assigned_at: midWindow }),
      TestOE_leadRow_(header, {
        lead_id: 'L-UNRESOLVED', client_id: 'C-UNRESOLVED', RM: 'Test RM One', current_stage: 'Suspect', lead_assigned_at: TestFixture_hoursAgo_(now, 20),
        last_connect: 'Connected', last_connect_time: TestFixture_hoursAgo_(now, 10),
        internal_status_comments: 'Test RM One: Ringing - ' + Utilities.formatDate(TestFixture_hoursAgo_(now, 10), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm'),
      }),
    ]);
    const followupLogSheet = ensureOvernightLogSheet_(followupSs);
    const issueLog = JSON.stringify([
      { lead_id: 'L-RESOLVED', issueKey: 'followupOverdue', issueLabel: 'Follow-up Overdue' },
      { lead_id: 'L-UNRESOLVED', issueKey: 'followupOverdue', issueLabel: 'Follow-up Overdue' },
    ]);
    followupLogSheet.appendRow([istDayKeyGs_(now), 'Pune', 'thread_seed_1', issueLog, Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss'), TEST_EMAIL_PRIMARY_, '', 'Pune Google Overnight Leads - test']);

    const realSs1 = SpreadsheetApp;
    SpreadsheetApp = { getActiveSpreadsheet: function () { return followupSs; }, flush: function () {} };
    try {
      sendOvernightFollowupEmails();
      TestAssertEqual_(TestGmailLog_.threadReplies.length, 1, 'sendOvernightFollowupEmails: sends exactly one threaded reply (Advanced Gmail Service succeeds)');
      // Guarded access — an empty threadReplies array here means the
      // assertion above already failed and reported why; indexing [0] on
      // it directly would throw and abort every later assertion in this
      // file instead of just this one.
      const reply = TestGmailLog_.threadReplies[0];
      TestAssertEqual_(reply && reply.threadId, 'thread_seed_1', 'sendOvernightFollowupEmails: threads into the SAME thread_id stored from the morning send');
      TestAssert_(!!(reply && reply.raw), 'sendOvernightFollowupEmails: the threaded reply carries a real base64 MIME payload');
    } finally {
      SpreadsheetApp = realSs1;
    }

    // ---- threaded reply failure -> falls back to a plain new message ----
    const staleSs = TestMockSpreadsheet_({
      'RM_Hierarchy': TestMockSheet_('RM_Hierarchy', TestFixture_rmHierarchyRows_()),
      'Manager_Directory': TestMockSheet_('Manager_Directory', TestFixture_managerDirectoryRows_()),
    });
    staleSs._sheets[monthShort] = TestMockSheet_(monthShort, rows.concat([
      TestOE_leadRow_(header, {
        lead_id: 'L-UNRESOLVED2', client_id: 'C-UNRESOLVED2', RM: 'Test RM One', current_stage: 'Suspect', lead_assigned_at: TestFixture_hoursAgo_(now, 20),
        last_connect: 'Connected', last_connect_time: TestFixture_hoursAgo_(now, 10),
        internal_status_comments: 'Test RM One: Ringing - ' + Utilities.formatDate(TestFixture_hoursAgo_(now, 10), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm'),
      }),
    ]));
    const staleLogSheet = ensureOvernightLogSheet_(staleSs);
    staleLogSheet.appendRow([istDayKeyGs_(now), 'Pune', 'thread_seed_2', JSON.stringify([{ lead_id: 'L-UNRESOLVED2', issueKey: 'followupOverdue', issueLabel: 'Follow-up Overdue' }]),
      Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss'), TEST_EMAIL_PRIMARY_, '', 'Pune Google Overnight Leads - test 2']);

    const realGmail = Gmail;
    Gmail = TestMockGmailAdvanced_({ shouldFail: true });
    const realSs2 = SpreadsheetApp;
    SpreadsheetApp = { getActiveSpreadsheet: function () { return staleSs; }, flush: function () {} };
    try {
      const draftsBefore = TestGmailLog_.drafts.length;
      sendOvernightFollowupEmails();
      TestAssert_(TestGmailLog_.drafts.length > draftsBefore, 'sendOvernightFollowupEmails: when the Advanced Gmail Service fails, falls back to a plain new message');
      const fallbackDraft = TestGmailLog_.drafts[TestGmailLog_.drafts.length - 1];
      TestAssertContains_(fallbackDraft.subject, 'Re:', 'sendOvernightFollowupEmails: the plain fallback subject is still a "Re: ..." reply');
    } finally {
      Gmail = realGmail;
      SpreadsheetApp = realSs2;
    }

    // ---- row with no stored recipient is skipped, not sent blind ----
    const skipSs = TestMockSpreadsheet_({});
    // A dedicated lead that is genuinely STILL flagged right now (past
    // grace, connected, stale comment) — reusing L-A here would resolve
    // as "already fine" (no connect/comment data at all), which would
    // make the "nothing sent" assertion below pass for the wrong reason.
    const skipRows = rows.concat([TestOE_leadRow_(header, {
      lead_id: 'L-SKIP', client_id: 'C-SKIP', RM: 'Test RM One', current_stage: 'Suspect', lead_assigned_at: TestFixture_hoursAgo_(now, 20),
      last_connect: 'Connected', last_connect_time: TestFixture_hoursAgo_(now, 10),
      internal_status_comments: 'Test RM One: Ringing - ' + Utilities.formatDate(TestFixture_hoursAgo_(now, 10), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm'),
    })]);
    skipSs._sheets[monthShort] = TestMockSheet_(monthShort, skipRows);
    const skipLogSheet = ensureOvernightLogSheet_(skipSs);
    skipLogSheet.appendRow([istDayKeyGs_(now), 'Pune', 'thread_seed_3', JSON.stringify([{ lead_id: 'L-SKIP', issueKey: 'followupOverdue', issueLabel: 'Follow-up Overdue' }]),
      Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss'), '', '', '']); // no stored to/cc/subject — predates the recipient-storing fix
    const realSs3 = SpreadsheetApp;
    SpreadsheetApp = { getActiveSpreadsheet: function () { return skipSs; }, flush: function () {} };
    try {
      const threadRepliesBefore = TestGmailLog_.threadReplies.length;
      const draftsBefore2 = TestGmailLog_.drafts.length;
      sendOvernightFollowupEmails();
      TestAssertEqual_(TestGmailLog_.threadReplies.length, threadRepliesBefore, 'sendOvernightFollowupEmails: a row with no stored recipient sends no threaded reply');
      TestAssertEqual_(TestGmailLog_.drafts.length, draftsBefore2, 'sendOvernightFollowupEmails: ...and no fallback plain send either — it is skipped entirely');
    } finally {
      SpreadsheetApp = realSs3;
    }

    // ---- pushUnresolvedToLeadFollowups_ / waitForFollowupSuggestions_ ----
    const noTabSs = TestMockSpreadsheet_({});
    TestAssertEqual_(pushUnresolvedToLeadFollowups_(noTabSs, [{ lead_id: 'L-1', region: 'Pune', RM: 'Test RM One', issue: 'x', comments: 'y' }]), false, 'pushUnresolvedToLeadFollowups_: returns false (and creates nothing) when Lead_Followups does not exist');
    TestAssertEqual_(Object.keys(noTabSs._sheets).length, 0, 'pushUnresolvedToLeadFollowups_: does not create the tab itself — that is the dashboard\'s job');

    const lfHeader = ['lead_id', 'region', 'RM', 'issue', 'collated_comments', 'suggested_followup', 'updated_at', 'own_comments'];
    const lfSs = TestMockSpreadsheet_({ 'Lead_Followups': TestMockSheet_('Lead_Followups', [lfHeader]) });
    TestAssertEqual_(pushUnresolvedToLeadFollowups_(lfSs, []), false, 'pushUnresolvedToLeadFollowups_: returns false for an empty entries list even when the tab exists');

    pushUnresolvedToLeadFollowups_(lfSs, [{ lead_id: 'L-NEW', region: 'Pune', RM: 'Test RM One', issue: 'Follow-up Overdue', comments: 'first pass' }]);
    let lfSheet = lfSs.getSheetByName('Lead_Followups');
    TestAssertEqual_(lfSheet.getLastRow(), 2, 'pushUnresolvedToLeadFollowups_: appends a brand-new row for an unseen lead_id');

    // Pre-fill column F (suggested_followup) as if a human/dashboard already answered it.
    lfSheet.getRange(2, 6, 1, 1).setValues([['Human-written suggestion']]);
    pushUnresolvedToLeadFollowups_(lfSs, [{ lead_id: 'L-NEW', region: 'Pune', RM: 'Test RM One', issue: 'Follow-up Overdue', comments: 'second pass' }]);
    TestAssertEqual_(lfSheet.getLastRow(), 2, 'pushUnresolvedToLeadFollowups_: an existing lead_id is upserted in place, not duplicated');
    const upsertedRow = lfSheet.getRange(2, 1, 1, 8).getValues()[0];
    TestAssertEqual_(upsertedRow[4], 'second pass', 'pushUnresolvedToLeadFollowups_: E (collated_comments) is updated on upsert');
    TestAssertEqual_(upsertedRow[5], 'Human-written suggestion', 'pushUnresolvedToLeadFollowups_: F (suggested_followup) is left untouched — that column belongs to the dashboard/human, not this writer');

    const suggestions = waitForFollowupSuggestions_(lfSs, ['L-NEW']);
    TestAssertEqual_(suggestions['L-NEW'], 'Human-written suggestion', 'waitForFollowupSuggestions_: reads back a suggestion that is already present, on the first poll');

    // lfSs's Lead_Followups still has L-NEW's own real suggestion from
    // the earlier upsert test — waitForFollowupSuggestions_ legitimately
    // returns the WHOLE sheet's current lookup, not filtered down to just
    // the requested leadIds, so the right check is that the REQUESTED
    // (never-answered) id specifically never gets an entry — not that the
    // returned object is empty overall.
    const neverAnswered = waitForFollowupSuggestions_(lfSs, ['L-NOT-THERE-AT-ALL']);
    TestAssertEqual_(neverAnswered['L-NOT-THERE-AT-ALL'], undefined, 'waitForFollowupSuggestions_: gives up after FOLLOWUP_WAIT_MAX_ATTEMPTS_ polls rather than hanging when a lead never gets a suggestion filled in (sleep is mocked to a no-op, so this completes instantly)');

    // ---- backfillTodaysOvernightLogRecipientsNow ----
    const backfillSs = TestMockSpreadsheet_({
      'RM_Hierarchy': TestMockSheet_('RM_Hierarchy', TestFixture_rmHierarchyRows_()),
      'Manager_Directory': TestMockSheet_('Manager_Directory', TestFixture_managerDirectoryRows_()),
    });
    backfillSs._sheets[monthShort] = TestMockSheet_(monthShort, rows);
    const backfillLogSheet = ensureOvernightLogSheet_(backfillSs);
    backfillLogSheet.appendRow([istDayKeyGs_(now), 'Pune', 'thread_backfill', JSON.stringify([{ lead_id: 'L-A', issueKey: 'followupOverdue', issueLabel: 'Follow-up Overdue' }]),
      Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss'), '', '', '']); // no stored recipient yet
    const realSs4 = SpreadsheetApp;
    SpreadsheetApp = { getActiveSpreadsheet: function () { return backfillSs; }, flush: function () {} };
    try {
      backfillTodaysOvernightLogRecipientsNow();
      const backfilledRow = backfillLogSheet.getRange(2, 6, 1, 3).getValues()[0];
      TestAssertEqual_(backfilledRow[0], TEST_EMAIL_PRIMARY_, 'backfillTodaysOvernightLogRecipientsNow: fills in the real resolved To for a row that predates the recipient-storing fix');
    } finally {
      SpreadsheetApp = realSs4;
    }

    TestAssertOnlyTestEmails_();

    // ---- Top-level containment (2026-08-31): a crash ANYWHERE in either
    // real run must alert ops before it aborts, not fail silently — same
    // reasoning/pattern as sendAllIssuesEmails' own wrapper
    // (AllIssuesEmailer.gs), applied here to both this file's trigger
    // entry points.
    const realReadLeadsTab = readLeadsTab_;
    readLeadsTab_ = function () { throw new Error('simulated total failure — Sheets error withRetry_ could not recover from'); };
    try {
      TestAssertThrows_(function () { sendOvernightMorningEmails(); }, 'sendOvernightMorningEmails: a total crash still re-throws — the Apps Script Executions log correctly shows this run as Failed, never silently swallowed');
      TestAssert_(TestGmailLog_.sent.some(function (e) { return /sendOvernightMorningEmails crashed/.test(e.subject); }), 'sendOvernightMorningEmails: a total crash fires an ops alert BEFORE re-throwing, naming the crash explicitly');
    } finally {
      readLeadsTab_ = realReadLeadsTab;
    }

    const realEnsureOvernightLogSheet = ensureOvernightLogSheet_;
    ensureOvernightLogSheet_ = function () { throw new Error('simulated total failure — Sheets error withRetry_ could not recover from'); };
    try {
      TestAssertThrows_(function () { sendOvernightFollowupEmails(); }, 'sendOvernightFollowupEmails: a total crash still re-throws — the Apps Script Executions log correctly shows this run as Failed, never silently swallowed');
      TestAssert_(TestGmailLog_.sent.some(function (e) { return /sendOvernightFollowupEmails crashed/.test(e.subject); }), 'sendOvernightFollowupEmails: a total crash fires an ops alert BEFORE re-throwing, naming the crash explicitly');
    } finally {
      ensureOvernightLogSheet_ = realEnsureOvernightLogSheet;
    }

    TestAssertOnlyTestEmails_();
  } finally {
    TestEnv_tearDown_();
  }
  return TestResults_;
}

function runOvernightEmailerTestsNow() { runOvernightEmailerTests_(); }
