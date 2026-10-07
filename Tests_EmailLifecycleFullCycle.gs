/**
 * Tests: the two-checkpoint email lifecycle, END TO END — chains REAL
 * calls to sendAllIssuesEmails() (AllIssuesEmailer.gs, 17:00),
 * sendOvernightMorningEmails() (OvernightEmailer.gs, 10:00), and
 * sendOvernightFollowupEmails() (OvernightEmailer.gs, 13:00) against ONE
 * shared mock spreadsheet, letting each job's own real code produce the
 * state the next job reads — never hand-constructing an AllIssues_Log/
 * Overnight_Log fixture row to simulate what an earlier job "would have"
 * written, the way every other test file's own Step 6/7/8 scenarios do
 * (by necessity, since those files test ONE job at a time). This is Step
 * 10/11's own coverage gap: proving the real 17:00 writer and the real
 * 10:00/13:00 readers actually agree on AllIssues_Log's column shape,
 * not just that each side's OWN fixture-fed test passes independently.
 *
 * Run runEmailLifecycleFullCycleTestsNow() from the function dropdown,
 * or via runAllTests() (Tests_RunAll.gs).
 *
 * REGISTRATION NOTE: `python3 test/check-gs-registration.py` reports one
 * expected false positive for this file — it assumes every `Tests_X.gs`
 * has a matching production `X.gs` (true for every OTHER test file in
 * this project), but this file deliberately has none: it tests the
 * INTEGRATION of two EXISTING production files
 * (`AllIssuesEmailer.gs` + `OvernightEmailer.gs`) chained together, not
 * a new module of its own. The two registrations that actually matter —
 * `Tests_RunAll.gs`'s `suites` array and `test/run-gs-tests.js`'s
 * `TEST_FILES` list — are both done; this note exists so a future
 * session doesn't waste time chasing a "missing" `EmailLifecycleFullCycle.gs`
 * that was never supposed to exist.
 *
 * NOTE ON TIME: same constraint every other Tests_OvernightEmailer.gs /
 * Tests_AllIssuesEmailer.gs scenario already works within — `now` is the
 * real wall clock, not injectable, so this test cannot literally wait for
 * a real day to pass between the 17:00 and "next day" 10:00 calls. It
 * uses the SAME technique those files already established: after the
 * real sendAllIssuesEmails() call writes its row (dated `now`, today),
 * this test directly edits that row's OWN date cell back to "yesterday"
 * before calling sendOvernightMorningEmails() — simulating the passage
 * of a day on exactly the one cell whose value that comparison depends
 * on, while every other cell (and every function's own internal `now`)
 * stays real. `lead_assigned_at` is fixed at 40 hours before `now` —
 * comfortably inside `allIssuesWindowGs_`'s minimum ~48h span (so the
 * 17:00 job always flags it) and comfortably outside
 * `overnightWindowGs_`'s fixed 16h span regardless of what time the
 * suite actually runs (so this lead never ALSO shows up as an overnight
 * lead — Section 1 stays empty throughout, isolating Section 2/
 * Checkpoint's own correctness from the (separately, extensively
 * tested) Overnight logic).
 */
function TestEFC_leadRow_(header, overrides) {
  const defaults = {
    lead_id: 'L-X', client_id: 'C-X', RM: 'Test RM One', TL: 'Test A1 One', project: 'P', region: 'Pune',
    client: 'Client', lead_assigned_at: new Date(), group_source: 'google', source_bucket: 'Non-UTM',
    current_stage: 'Suspect', rm_is_active: true, call_attempts: 1,
  };
  const merged = Object.assign({}, defaults, overrides || {});
  return header.map(function (k) { return merged[k] !== undefined ? merged[k] : ''; });
}

function runEmailLifecycleFullCycleTests_() {
  const now = new Date();
  const monthShort = 'leads';
  const header = TestFixture_leadsHeader_();
  const banner = header.map(function () { return ''; });

  // L-CYCLE: flagged for Follow-up Overdue at 17:00 (stale comment, past
  // FOLLOWUP_REVIEW_HOURS_ since last connect) — the exact fixture shape
  // Tests_AllIssuesEmailer.gs/Tests_OvernightEmailer.gs already prove
  // reliably triggers followupOverdue and nothing else.
  const rows = [banner, header,
    TestEFC_leadRow_(header, {
      lead_id: 'L-CYCLE', client_id: 'C-CYCLE', RM: 'Test RM One', current_stage: 'Suspect',
      lead_assigned_at: TestFixture_hoursAgo_(now, 40),
      last_connect: 'Connected', last_connect_time: TestFixture_hoursAgo_(now, 10),
      internal_status_comments: 'Test RM One: Ringing - ' + Utilities.formatDate(TestFixture_hoursAgo_(now, 10), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm'),
    }),
  ];

  const ss = TestMockSpreadsheet_({
    'RM_Hierarchy': TestMockSheet_('RM_Hierarchy', TestFixture_rmHierarchyRows_()),
    'Manager_Directory': TestMockSheet_('Manager_Directory', TestFixture_managerDirectoryRows_()),
  });
  ss._sheets[monthShort] = TestMockSheet_(monthShort, rows);

  // TestEnv_setUp_ already wires SpreadsheetApp.getActiveSpreadsheet() to
  // return THIS `ss` for the whole test run — no manual swap needed here
  // (unlike Tests_OvernightEmailer.gs's own multi-scenario tests, which
  // swap it per-scenario because they isolate SEVERAL separate mock
  // spreadsheets within one file; this test uses exactly one throughout).
  TestEnv_setUp_('Tests_EmailLifecycleFullCycle', ss);
  try {
    {
      // Region P&L head (2026-09-26): configured for THIS bucket's region so the whole chain proves it is Cc'd at 17:00,
      // stored, and carried through the 10:00 and 13:00 emails. Reset at the end of this block.
      // The config holds a NAME; its address comes from Manager_Directory, so a directory row is added for it.
      ss.getSheetByName('Manager_Directory').appendRow(['Test PnL Head', 'Head', 'Pune', TEST_EMAIL_SECONDARY_, 0, 'manual']);
      REGION_PNL_HEAD_CC_ = { 'Pune': 'Test PnL Head' };

      // ==== 17:00: real sendAllIssuesEmails() ====
      sendAllIssuesEmails();
      TestAssertEqual_(TestGmailLog_.drafts.length, 1, 'Full cycle 17:00: sendAllIssuesEmails sends exactly one bucket email for L-CYCLE\'s RM');
      const seventeenDraft = TestGmailLog_.drafts[0];
      TestAssertContains_(seventeenDraft.htmlBody, 'L-CYCLE', 'Full cycle 17:00: the all-issues email lists L-CYCLE');
      TestAssertContains_(seventeenDraft.cc, TEST_EMAIL_SECONDARY_, 'Full cycle 17:00: the region P&L head is Cc\'d');

      const allIssuesLog = ss.getSheetByName('AllIssues_Log');
      TestAssert_(!!allIssuesLog, 'Full cycle 17:00: AllIssues_Log exists after a real send');
      TestAssertEqual_(allIssuesLog.getLastRow(), 2, 'Full cycle 17:00: AllIssues_Log has exactly 1 data row');
      const rowAfter17 = allIssuesLog.getRange(2, 1, 1, 14).getValues()[0];
      TestAssert_(!!rowAfter17[9], 'Full cycle 17:00: issue_snapshot_json (col J) was written by the REAL sendOneAllIssuesEmail_, not hand-seeded');
      const snapshotWritten = JSON.parse(rowAfter17[9]);
      TestAssertEqual_(snapshotWritten.length, 1, 'Full cycle 17:00: the real snapshot has exactly 1 lead');
      TestAssertEqual_(snapshotWritten[0].lead_id, 'L-CYCLE', 'Full cycle 17:00: the real snapshot names L-CYCLE');
      TestAssertEqual_(snapshotWritten[0].issueLabel, 'Follow-up Overdue', 'Full cycle 17:00: the real snapshot records the correct issue label');
      TestAssert_(!rowAfter17[10] && !rowAfter17[11], 'Full cycle 17:00: checkpoint1_json/checkpoint1_sent_at are still blank — not written until the 10:00 job runs');
      TestAssertContains_(rowAfter17[5], TEST_EMAIL_SECONDARY_, 'Full cycle 17:00: the stored Cc (col F) includes the P&L head, so the next-day checkpoints carry it too');

      // Simulate a day passing: this row's OWN date cell (col A) is the
      // ONLY thing this test edits — every other cell, and every
      // function's own real internal `now`, stays real. Same technique
      // Tests_OvernightEmailer.gs's own Step 6 scenario already
      // established for exactly this reason.
      const yesterday = TestFixture_daysAgo_(now, 1);
      allIssuesLog.getRange(2, 1, 1, 1).setValues([[yesterday]]);

      // ==== 10:00: real sendOvernightMorningEmails() ====
      sendOvernightMorningEmails();
      // 2 total drafts now: the 17:00 one above, plus this run's combined
      // 10:00 send (Section 2 only — L-CYCLE deliberately never qualifies
      // as an overnight lead, see this file's own header comment).
      TestAssertEqual_(TestGmailLog_.drafts.length, 2, 'Full cycle 10:00: sendOvernightMorningEmails sends exactly one new combined email (Section 2 only) for the same bucket');
      const tenAmDraft = TestGmailLog_.drafts[1];
      TestAssertContains_(tenAmDraft.htmlBody, 'No overnight leads for your team today', 'Full cycle 10:00: Section 1 correctly shows the empty state — L-CYCLE was never an overnight lead');
      TestAssertContains_(tenAmDraft.htmlBody, 'L-CYCLE', 'Full cycle 10:00: Section 2 (Checkpoint 1) lists L-CYCLE');
      TestAssertContains_(tenAmDraft.htmlBody, 'Still open', 'Full cycle 10:00: L-CYCLE (unchanged since 17:00) shows as still_open');
      TestAssertContains_(tenAmDraft.cc, TEST_EMAIL_SECONDARY_, 'Full cycle 10:00: the Section-2-only email uses the STORED 17:00 Cc, so the P&L head is Cc\'d');

      const rowAfter10 = allIssuesLog.getRange(2, 1, 1, 14).getValues()[0];
      TestAssert_(!!rowAfter10[10], 'Full cycle 10:00: checkpoint1_json (col K) now written by the REAL sendCombinedMorningEmail_');
      TestAssert_(!!rowAfter10[11], 'Full cycle 10:00: checkpoint1_sent_at (col L) now written');
      const checkpoint1Written = JSON.parse(rowAfter10[10]);
      TestAssertEqual_(checkpoint1Written[0].state, 'still_open', 'Full cycle 10:00: the real checkpoint1_json records still_open');
      TestAssert_(!rowAfter10[12] && !rowAfter10[13], 'Full cycle 10:00: checkpoint2_json/checkpoint2_sent_at are still blank — not written until the 13:00 job runs');

      const overnightLog = ss.getSheetByName('Overnight_Log');
      TestAssert_(!!overnightLog, 'Full cycle 10:00: Overnight_Log exists after a real combined send');
      TestAssertEqual_(overnightLog.getLastRow(), 2, 'Full cycle 10:00: Overnight_Log gets exactly 1 row (Section-2-only, per the Step 6 fix — an empty Section 1 still logs a thread reference)');
      const overnightRowAfter10 = overnightLog.getRange(2, 1, 1, 9).getValues()[0];
      TestAssertEqual_(overnightRowAfter10[3], '[]', 'Full cycle 10:00: Overnight_Log correctly logs an EMPTY issueLog — Section 1 genuinely had nothing');
      TestAssert_(!overnightRowAfter10[8], 'Full cycle 10:00: followup_sent_at is still blank — the 13:00 job has not run yet');

      // The lead is deliberately left UNRESOLVED through 13:00 here (block
      // "resolved before the reply" below covers the resolving case): since
      // 2026-09-26 a resolved lead is never emailed, so this is the path
      // that still produces a Checkpoint 2 reply.

      // ==== 13:00: real sendOvernightFollowupEmails() ====
      sendOvernightFollowupEmails();
      TestAssertEqual_(TestGmailLog_.threadReplies.length, 1, 'Full cycle 13:00: sendOvernightFollowupEmails sends exactly one threaded reply for this bucket');
      const thirteenReply = TestGmailLog_.threadReplies[0];
      TestAssertEqual_(thirteenReply.threadId, tenAmDraft._threadId, 'Full cycle 13:00: the reply threads into the SAME Gmail thread the real 10:00 send created — the actual thread_id, not a hand-seeded one');
      const thirteenHtml = TestOE_decodeRawMime_(thirteenReply.raw);
      TestAssertContains_(thirteenHtml, 'Nothing still unresolved from this morning', 'Full cycle 13:00: Section 1 still correctly shows its own empty state');
      const thirteenCcLine = thirteenHtml.split('\n').filter(function (l) { return l.indexOf('Cc:') === 0; })[0] || '';
      TestAssertContains_(thirteenCcLine, TEST_EMAIL_SECONDARY_, 'Full cycle 13:00: the threaded reply Cc\'s the P&L head');
      TestAssertContains_(thirteenHtml, 'L-CYCLE', 'Full cycle 13:00: Section 2 (Checkpoint 2) lists L-CYCLE');
      TestAssertContains_(thirteenHtml, 'Still open', 'Full cycle 13:00: L-CYCLE (still unresolved) shows as still open — a real state the real code recomputed, not an echo of checkpoint1_json');

      const rowAfter13 = allIssuesLog.getRange(2, 1, 1, 14).getValues()[0];
      TestAssert_(!!rowAfter13[12], 'Full cycle 13:00: checkpoint2_json (col M) now written by the REAL sendCombinedFollowupEmail_');
      TestAssert_(!!rowAfter13[13], 'Full cycle 13:00: checkpoint2_sent_at (col N) now written');
      const checkpoint2Written = JSON.parse(rowAfter13[12]);
      TestAssertEqual_(checkpoint2Written[0].state, 'still_open', 'Full cycle 13:00: the real checkpoint2_json records still_open');

      const overnightRowAfter13 = overnightLog.getRange(2, 1, 1, 9).getValues()[0];
      TestAssert_(!!overnightRowAfter13[8], 'Full cycle 13:00: followup_sent_at now written — Step 8\'s own idempotency guard, exercised end to end');

      // ==== Idempotency, end to end: a second pass of the real 10:00 and
      // 13:00 entry points the same day sends NOTHING new for this bucket —
      // every guard (alreadyLoggedRegionsToday, checkpoint1/2_sent_at,
      // followup_sent_at) proven together, not just individually. ====
      const draftsBeforeRerun = TestGmailLog_.drafts.length;
      const repliesBeforeRerun = TestGmailLog_.threadReplies.length;
      sendOvernightMorningEmails();
      sendOvernightFollowupEmails();
      TestAssertEqual_(TestGmailLog_.drafts.length, draftsBeforeRerun, 'Full cycle: a second pass of the 10:00 and 13:00 jobs the same day sends no new drafts');
      TestAssertEqual_(TestGmailLog_.threadReplies.length, repliesBeforeRerun, 'Full cycle: a second pass of the 10:00 and 13:00 jobs the same day sends no new threaded replies');
      REGION_PNL_HEAD_CC_ = {};
      // The 17:00 job is deliberately NOT re-run here: the lead is still unresolved (it must be, for 13:00 to reply), and
      // this test aged the 17:00 row to "yesterday" to simulate the next morning, so the 17:00 same-day guard rightly finds
      // no row for today. That guard is covered by Tests_AllIssuesEmailer.gs.
    }

    // ==== 2026-09-26 ("no need to send email for resolved status"): the SAME real 17:00 -> 10:00 -> 13:00 chain, but the
    // lead is closed at a different point. Two runs, each on a fresh sheet; counts are RELATIVE to the shared Gmail log. ====
    ['before10', 'between10and13'].forEach(function (resolveWhen) {
      const ssR = TestMockSpreadsheet_({
        'RM_Hierarchy': TestMockSheet_('RM_Hierarchy', TestFixture_rmHierarchyRows_()),
        'Manager_Directory': TestMockSheet_('Manager_Directory', TestFixture_managerDirectoryRows_()),
      });
      ssR._sheets[monthShort] = TestMockSheet_(monthShort, [banner, header,
        TestEFC_leadRow_(header, {
          lead_id: 'L-CYCLE-R', client_id: 'C-CYCLE-R', RM: 'Test RM One', current_stage: 'Suspect',
          lead_assigned_at: TestFixture_hoursAgo_(now, 40),
          last_connect: 'Connected', last_connect_time: TestFixture_hoursAgo_(now, 10),
          internal_status_comments: 'Test RM One: Ringing - ' + Utilities.formatDate(TestFixture_hoursAgo_(now, 10), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm'),
        }),
      ]);
      const realSsR = SpreadsheetApp;
      SpreadsheetApp = { getActiveSpreadsheet: function () { return ssR; }, flush: function () {} };
      try {
        const tag = 'Full cycle, lead resolved ' + resolveWhen + ': ';
        const stageCol = header.indexOf('current_stage') + 1;
        const d0 = TestGmailLog_.drafts.length;
        const r0 = TestGmailLog_.threadReplies.length;
        sendAllIssuesEmails();
        TestAssertEqual_(TestGmailLog_.drafts.length, d0 + 1, tag + '17:00 still emails the lead — it was unresolved then');
        const logR = ssR.getSheetByName('AllIssues_Log');
        logR.getRange(2, 1, 1, 1).setValues([[TestFixture_daysAgo_(now, 1)]]);

        if (resolveWhen === 'before10') ssR._sheets[monthShort].getRange(3, stageCol, 1, 1).setValues([['Opportunity']]);
        sendOvernightMorningEmails();
        const rowAfter10R = logR.getRange(2, 1, 1, 14).getValues()[0];
        const overnightLogR = ssR.getSheetByName('Overnight_Log');

        if (resolveWhen === 'before10') {
          TestAssertEqual_(TestGmailLog_.drafts.length, d0 + 1, tag + '10:00 sends NOTHING — the only Checkpoint 1 lead is already resolved');
          TestAssert_(!!rowAfter10R[10] && !!rowAfter10R[11], tag + 'checkpoint1_json/checkpoint1_sent_at are still recorded, so the row is not re-checked');
          TestAssertEqual_(JSON.parse(rowAfter10R[10])[0].state, 'resolved', tag + 'checkpoint1_json records resolved');
          TestAssert_(!overnightLogR || overnightLogR.getLastRow() < 2, tag + 'no Overnight_Log row — nothing was sent, so there is no thread');
          sendOvernightFollowupEmails();
          TestAssertEqual_(TestGmailLog_.threadReplies.length, r0, tag + '13:00 sends nothing either');
        } else {
          TestAssertEqual_(TestGmailLog_.drafts.length, d0 + 2, tag + '10:00 emails the lead — it was still unresolved then');
          ssR._sheets[monthShort].getRange(3, stageCol, 1, 1).setValues([['Opportunity']]);
          sendOvernightFollowupEmails();
          TestAssertEqual_(TestGmailLog_.threadReplies.length, r0, tag + '13:00 sends NO reply — the lead resolved in between, and a resolved lead is never emailed');
          const rowAfter13R = logR.getRange(2, 1, 1, 14).getValues()[0];
          TestAssert_(!!rowAfter13R[12] && !!rowAfter13R[13], tag + 'checkpoint2_json/checkpoint2_sent_at are still recorded');
          TestAssertEqual_(JSON.parse(rowAfter13R[12]).length, 0, tag + 'checkpoint2_json holds no unresolved lead');
          TestAssert_(!overnightLogR.getRange(2, 1, 1, 9).getValues()[0][8], tag + 'followup_sent_at stays blank — nothing was sent');
          const draftsBeforeRerunR = TestGmailLog_.drafts.length;
          sendOvernightFollowupEmails();
          TestAssertEqual_(TestGmailLog_.threadReplies.length, r0, tag + 'a re-run of the 13:00 job still sends nothing');
          TestAssertEqual_(TestGmailLog_.drafts.length, draftsBeforeRerunR, tag + 'a re-run of the 13:00 job creates no fallback message either');
        }
      } finally {
        SpreadsheetApp = realSsR;
      }
    });

    {
      // ==== TEST MODE must never poison production state (2026-09-25 incident): a TEST MODE run of each
      // job first, THEN the real job — the real one must still behave exactly as if no test had run. ====
      const ss2 = TestMockSpreadsheet_({
        'RM_Hierarchy': TestMockSheet_('RM_Hierarchy', TestFixture_rmHierarchyRows_()),
        'Manager_Directory': TestMockSheet_('Manager_Directory', TestFixture_managerDirectoryRows_()),
      });
      ss2._sheets[monthShort] = TestMockSheet_(monthShort, [banner, header,
        TestEFC_leadRow_(header, {
          lead_id: 'L-CYCLE', client_id: 'C-CYCLE', RM: 'Test RM One', current_stage: 'Suspect',
          lead_assigned_at: TestFixture_hoursAgo_(now, 40),
          last_connect: 'Connected', last_connect_time: TestFixture_hoursAgo_(now, 10),
          internal_status_comments: 'Test RM One: Ringing - ' + Utilities.formatDate(TestFixture_hoursAgo_(now, 10), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm'),
        }),
      ]);
      SpreadsheetApp = { getActiveSpreadsheet: function () { return ss2; }, flush: function () {} };
      const setTestMode_ = function (on) { TEST_MODE_OVERRIDE_EMAIL_ = on ? TEST_EMAIL_PRIMARY_ : ''; };
      const dataRows_ = function (name) { const s = ss2.getSheetByName(name); return s ? Math.max(0, s.getLastRow() - 1) : 0; };

      // -- 17:00: a TEST MODE run first, then the real one --
      let d0 = TestGmailLog_.drafts.length;
      setTestMode_(true);
      sendAllIssuesEmails();
      setTestMode_(false);
      TestAssertEqual_(TestGmailLog_.drafts.length, d0 + 1, 'TEST MODE 17:00: sends its one bucket email');
      TestAssertEqual_(TestGmailLog_.drafts[d0].to, TEST_EMAIL_PRIMARY_, 'TEST MODE 17:00: goes to the tester');
      TestAssertEqual_(dataRows_('AllIssues_Log'), 0, 'TEST MODE 17:00: writes NO AllIssues_Log row');
      d0 = TestGmailLog_.drafts.length;
      sendAllIssuesEmails();
      TestAssertEqual_(TestGmailLog_.drafts.length, d0 + 1, 'Real 17:00 AFTER a TEST MODE run still sends — the test run did not consume the region idempotency guard (the real 2026-09-24 incident)');
      TestAssertEqual_(dataRows_('AllIssues_Log'), 1, 'Real 17:00 AFTER a TEST MODE run writes its row normally');

      // Stand in for "yesterday's real 17:00 went to a real manager": a stored recipient that is NOT the tester.
      const log2 = ss2.getSheetByName('AllIssues_Log');
      log2.getRange(2, 1, 1, 1).setValues([[TestFixture_daysAgo_(now, 1)]]);
      log2.getRange(2, 5, 1, 1).setValues([[TEST_EMAIL_CH_]]);

      // -- 10:00 Checkpoint 1: TEST MODE run first, then the real one --
      d0 = TestGmailLog_.drafts.length;
      setTestMode_(true);
      sendOvernightMorningEmails();
      setTestMode_(false);
      TestAssertEqual_(TestGmailLog_.drafts.length, d0 + 1, 'TEST MODE 10:00: sends its one combined email');
      TestAssertEqual_(TestGmailLog_.drafts[d0].to, TEST_EMAIL_PRIMARY_, 'TEST MODE 10:00: a Section-2-only bucket goes to the TESTER, never to the stored real recipient');
      TestAssertEqual_(TestGmailLog_.drafts[d0].cc, '', 'TEST MODE 10:00: no Cc');
      TestAssertContains_(TestGmailLog_.drafts[d0].subject, '[TEST MODE]', 'TEST MODE 10:00: the subject is visibly tagged so it cannot be mistaken for a real send');
      const afterTest10 = log2.getRange(2, 1, 1, 14).getValues()[0];
      TestAssert_(!afterTest10[10] && !afterTest10[11], 'TEST MODE 10:00: does NOT consume Checkpoint 1 (checkpoint1_json/sent_at stay blank)');
      TestAssertEqual_(dataRows_('Overnight_Log'), 0, 'TEST MODE 10:00: writes NO Overnight_Log row');
      d0 = TestGmailLog_.drafts.length;
      sendOvernightMorningEmails();
      TestAssertEqual_(TestGmailLog_.drafts.length, d0 + 1, 'Real 10:00 AFTER a TEST MODE run still sends its Checkpoint 1');
      TestAssertEqual_(TestGmailLog_.drafts[d0].to, TEST_EMAIL_CH_, 'Real 10:00 goes to the STORED 17:00 recipient (not the tester)');
      const afterReal10 = log2.getRange(2, 1, 1, 14).getValues()[0];
      TestAssert_(!!afterReal10[10] && !!afterReal10[11], 'Real 10:00 writes Checkpoint 1 normally');
      TestAssertEqual_(dataRows_('Overnight_Log'), 1, 'Real 10:00 logs its Overnight_Log row normally');

      // -- 13:00 Checkpoint 2: TEST MODE run first, then the real one --
      const overnightLog2 = ss2.getSheetByName('Overnight_Log');
      const r0 = TestGmailLog_.threadReplies.length;
      setTestMode_(true);
      sendOvernightFollowupEmails();
      setTestMode_(false);
      TestAssertEqual_(TestGmailLog_.threadReplies.length, r0 + 1, 'TEST MODE 13:00: still sends its reply (the followup_sent_at guard is bypassed)');
      const afterTest13 = log2.getRange(2, 1, 1, 14).getValues()[0];
      TestAssert_(!afterTest13[12] && !afterTest13[13], 'TEST MODE 13:00: does NOT consume Checkpoint 2');
      TestAssert_(!overnightLog2.getRange(2, 9, 1, 1).getValues()[0][0], 'TEST MODE 13:00: does NOT write followup_sent_at');
      sendOvernightFollowupEmails();
      TestAssertEqual_(TestGmailLog_.threadReplies.length, r0 + 2, 'Real 13:00 AFTER a TEST MODE run still sends its reply');
      const afterReal13 = log2.getRange(2, 1, 1, 14).getValues()[0];
      TestAssert_(!!afterReal13[12] && !!afterReal13[13], 'Real 13:00 writes Checkpoint 2 normally');
    }

    {
      // ==== Futwork: ONE email per job across every region (2026-09-25) ====
      const flaggedFw_ = function (id, rm, region) {
        return TestEFC_leadRow_(header, {
          lead_id: id, client_id: 'C-' + id, RM: rm, TL: 'Deepali Tharwani Futwork', region: region, current_stage: 'Suspect',
          lead_assigned_at: TestFixture_hoursAgo_(now, 40),
          last_connect: 'Connected', last_connect_time: TestFixture_hoursAgo_(now, 10),
          internal_status_comments: rm + ': Ringing - ' + Utilities.formatDate(TestFixture_hoursAgo_(now, 10), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm'),
        });
      };
      const newFwSs_ = function (leadRows) {
        const s = TestMockSpreadsheet_({
          'RM_Hierarchy': TestMockSheet_('RM_Hierarchy', TestFixture_rmHierarchyRows_()),
          'Manager_Directory': TestMockSheet_('Manager_Directory', TestFixture_managerDirectoryRows_()),
        });
        s._sheets[monthShort] = TestMockSheet_(monthShort, [banner, header].concat(leadRows));
        return s;
      };
      const countOf_ = function (html, needle) { return (html.match(new RegExp(needle, 'g')) || []).length; };
      const yesterdayFw = TestFixture_daysAgo_(now, 1);

      // -- A: the whole cycle with new-format rows: 17:00 -> 10:00 -> 13:00 --
      const ssA = newFwSs_([flaggedFw_('L-FW-A', 'Kajal Futwork', 'Pune'), flaggedFw_('L-FW-B', 'Meera Futwork', 'Bangalore')]);
      SpreadsheetApp = { getActiveSpreadsheet: function () { return ssA; }, flush: function () {} };
      let dA = TestGmailLog_.drafts.length;
      sendAllIssuesEmails();
      TestAssertEqual_(TestGmailLog_.drafts.length, dA + 1, 'Futwork cycle 17:00: two regions, ONE email');
      const logA = ssA.getSheetByName('AllIssues_Log');
      TestAssertEqual_(logA.getLastRow(), 2, 'Futwork cycle 17:00: ONE AllIssues_Log row');
      logA.getRange(2, 1, 1, 1).setValues([[yesterdayFw]]);
      dA = TestGmailLog_.drafts.length;
      sendOvernightMorningEmails();
      TestAssertEqual_(TestGmailLog_.drafts.length, dA + 1, 'Futwork cycle 10:00: ONE combined email for both regions');
      const morningA = TestGmailLog_.drafts[dA];
      TestAssertContains_(morningA.subject, 'Bangalore, Pune Google Overnight + Follow-up Digest', 'Futwork cycle 10:00: the subject spells out every region');
      TestAssertContains_(morningA.htmlBody, 'Regions: Bangalore (1) · Pune (1)', 'Futwork cycle 10:00: Checkpoint 1 header names every region');
      TestAssert_(morningA.htmlBody.indexOf('Bangalore — 1 lead') !== -1 && morningA.htmlBody.indexOf('Pune — 1 lead') !== -1, 'Futwork cycle 10:00: Checkpoint 1 keeps the regions as separate bands');
      TestAssertContains_(morningA.htmlBody, 'L-FW-A', 'Futwork cycle 10:00: lists the Pune lead');
      TestAssertContains_(morningA.htmlBody, 'L-FW-B', 'Futwork cycle 10:00: lists the Bangalore lead');
      TestAssertEqual_(ssA.getSheetByName('Overnight_Log').getLastRow(), 2, 'Futwork cycle 10:00: ONE Overnight_Log row for the single email');
      const rA = TestGmailLog_.threadReplies.length;
      sendOvernightFollowupEmails();
      TestAssertEqual_(TestGmailLog_.threadReplies.length, rA + 1, 'Futwork cycle 13:00: ONE threaded reply for both regions');
      const replyA = TestOE_decodeRawMime_(TestGmailLog_.threadReplies[rA].raw);
      TestAssert_(replyA.indexOf('L-FW-A') !== -1 && replyA.indexOf('L-FW-B') !== -1, 'Futwork cycle 13:00: the reply lists both leads');
      TestAssertContains_(replyA, 'Bangalore — 1 lead', 'Futwork cycle 13:00: the reply keeps the regions as separate bands');

      // -- B: rows logged BEFORE the consolidation (one per real region, bucket_label Futwork): the next 10:00 / 13:00
      // must merge them into ONE email and must not repeat any lead --
      const ssB = newFwSs_([flaggedFw_('L-LEG-A', 'Kajal Futwork', 'Pune'), flaggedFw_('L-LEG-B', 'Meera Futwork', 'Bangalore')]);
      SpreadsheetApp = { getActiveSpreadsheet: function () { return ssB; }, flush: function () {} };
      const logB = ensureAllIssuesLogSheet_(ssB);
      const legacySnap_ = function (id, rm) { return JSON.stringify([{ lead_id: id, RM: rm, TL: 'Deepali Tharwani Futwork', status: 'Suspect', issueLabel: 'Follow-up Overdue', followup: 't' }]); };
      logB.appendRow([yesterdayFw, 'Pune', 'Futwork', '', FUTWORK_ROUTE_EMAIL_, '', 1, yesterdayFw, 'thr-legacy-1', legacySnap_('L-LEG-A', 'Kajal Futwork')]);
      logB.appendRow([yesterdayFw, 'Bangalore', 'Futwork', '', FUTWORK_ROUTE_EMAIL_, '', 1, yesterdayFw, 'thr-legacy-2', legacySnap_('L-LEG-B', 'Meera Futwork')]);
      let dB = TestGmailLog_.drafts.length;
      sendOvernightMorningEmails();
      TestAssertEqual_(TestGmailLog_.drafts.length, dB + 1, 'Futwork legacy rows 10:00: two old per-region rows become ONE email');
      const morningB = TestGmailLog_.drafts[dB];
      TestAssert_(morningB.htmlBody.indexOf('Bangalore — 1 lead') !== -1 && morningB.htmlBody.indexOf('Pune — 1 lead') !== -1, 'Futwork legacy rows 10:00: each old row\'s entry is placed under its REAL region (stamped from the row)');
      TestAssertEqual_(countOf_(morningB.htmlBody, 'L-LEG-A'), 1, 'Futwork legacy rows 10:00: each lead appears exactly once');
      const afterB = logB.getRange(2, 1, 2, 14).getValues();
      TestAssert_(!!afterB[0][10] && !!afterB[1][10], 'Futwork legacy rows 10:00: Checkpoint 1 is written back onto BOTH old rows');
      const rB = TestGmailLog_.threadReplies.length;
      sendOvernightFollowupEmails();
      TestAssertEqual_(TestGmailLog_.threadReplies.length, rB + 1, 'Futwork legacy rows 13:00: ONE reply');
      const replyB = TestOE_decodeRawMime_(TestGmailLog_.threadReplies[rB].raw);
      // The reply is multipart/alternative: a plain-text part (which since the 2026-10-05 email audit P2 lists the leads too) and an
      // HTML part. Count per part — each lead must appear exactly once in EACH, never once per old row.
      const replyBHtmlPart = replyB.split('Content-Type: text/html')[1] || '';
      const replyBPlainPart = replyB.split('Content-Type: text/html')[0] || '';
      TestAssertEqual_(countOf_(replyBHtmlPart, 'L-LEG-A'), 1, 'Futwork legacy rows 13:00: a lead is NOT repeated once per row (the merged lists are de-duplicated)');
      TestAssertEqual_(countOf_(replyBHtmlPart, 'L-LEG-B'), 1, 'Futwork legacy rows 13:00: the other lead appears exactly once too');
      TestAssertEqual_(countOf_(replyBPlainPart, 'L-LEG-A'), 1, 'Futwork legacy rows 13:00: the plain-text part lists a lead exactly once too');
      const afterB13 = logB.getRange(2, 1, 2, 14).getValues();
      TestAssert_(afterB13[0][12].length < 2000 && afterB13[1][12].length < 2000, 'Futwork legacy rows 13:00: the Checkpoint 2 cell stays small (no multiplied copies)');
    }

    {
      // ==== One bucket throwing must NOT stop the others (2026-09-25: an oversize checkpoint cell aborted the whole
      // 13:00 run after only 3 buckets). L-BOOM's bucket throws inside the checkpoint compute; L-OK's must still go. ====
      const realFutworkRoute = FUTWORK_ROUTE_EMAIL_;
      const realCompute = computeAllIssuesCheckpointGs_;
      const boom = { armed: false };
      const flaggedIso_ = function (id, rm) {
        return TestEFC_leadRow_(header, {
          lead_id: id, client_id: 'C-' + id, RM: rm, region: 'Pune', current_stage: 'Suspect',
          lead_assigned_at: TestFixture_hoursAgo_(now, 40),
          last_connect: 'Connected', last_connect_time: TestFixture_hoursAgo_(now, 10),
          internal_status_comments: rm + ': Ringing - ' + Utilities.formatDate(TestFixture_hoursAgo_(now, 10), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm'),
        });
      };
      const newIsoSs_ = function () {
        const s = TestMockSpreadsheet_({
          'RM_Hierarchy': TestMockSheet_('RM_Hierarchy', TestFixture_rmHierarchyRows_()),
          'Manager_Directory': TestMockSheet_('Manager_Directory', TestFixture_managerDirectoryRows_()),
        });
        s._sheets[monthShort] = TestMockSheet_(monthShort, [banner, header, flaggedIso_('L-OK', 'Test RM One'), flaggedIso_('L-BOOM', 'Kajal Futwork')]);
        return s;
      };
      const yesterdayIso = TestFixture_daysAgo_(now, 1);
      const bucketRow_ = function (sheet, label) {
        return sheet.getRange(2, 1, sheet.getLastRow() - 1, 14).getValues().filter(function (r) { return r[2] === label; })[0];
      };
      FUTWORK_ROUTE_EMAIL_ = TEST_EMAIL_CH_; // a different recipient from the ordinary bucket, so they are two separate buckets
      computeAllIssuesCheckpointGs_ = function (s, entries, n, b) {
        if (boom.armed && entries.some(function (e) { return e.lead_id === 'L-BOOM'; })) {
          throw new Error('simulated: Your input contains more than the maximum of 50000 characters in a single cell.');
        }
        return realCompute(s, entries, n, b);
      };
      try {
        // -- 10:00: the Futwork bucket throws, the ordinary bucket must still send --
        const ssC = newIsoSs_();
        SpreadsheetApp = { getActiveSpreadsheet: function () { return ssC; }, flush: function () {} };
        sendAllIssuesEmails();
        const logC = ssC.getSheetByName('AllIssues_Log');
        TestAssertEqual_(logC.getLastRow(), 3, 'Isolation setup: two buckets logged at 17:00');
        logC.getRange(2, 1, 2, 1).setValues([[yesterdayIso], [yesterdayIso]]);
        boom.armed = true;
        const dC = TestGmailLog_.drafts.length;
        let threwC = false;
        try { sendOvernightMorningEmails(); } catch (e) { threwC = true; }
        boom.armed = false;
        TestAssert_(!threwC, 'Isolation 10:00: one bucket throwing does NOT abort the run');
        TestAssertEqual_(TestGmailLog_.drafts.length, dC + 1, 'Isolation 10:00: the OTHER bucket\'s email still went out');
        TestAssertEqual_(TestGmailLog_.drafts[dC].to, TEST_EMAIL_PRIMARY_, 'Isolation 10:00: it is the ordinary bucket that sent');
        TestAssert_(TestGmailLog_.sent.some(function (e) { return /Leads NOT sent/.test(e.subject) && /Unexpected error/.test(e.htmlBody || ''); }), 'Isolation 10:00: the failed bucket\'s leads are reported in the "Leads NOT sent" alert');
        TestAssert_(!!bucketRow_(logC, 'Test A1 One')[10], 'Isolation 10:00: the ordinary bucket\'s Checkpoint 1 was written');
        TestAssert_(!bucketRow_(logC, 'Futwork')[10], 'Isolation 10:00: the failed bucket\'s Checkpoint 1 stays unwritten (nothing half-recorded)');

        // -- 13:00: same, at the follow-up --
        const ssD = newIsoSs_();
        SpreadsheetApp = { getActiveSpreadsheet: function () { return ssD; }, flush: function () {} };
        sendAllIssuesEmails();
        const logD = ssD.getSheetByName('AllIssues_Log');
        logD.getRange(2, 1, 2, 1).setValues([[yesterdayIso], [yesterdayIso]]);
        const d10 = TestGmailLog_.drafts.length;
        sendOvernightMorningEmails();
        TestAssertEqual_(TestGmailLog_.drafts.length, d10 + 2, 'Isolation 13:00 setup: both buckets got their 10:00 email');
        boom.armed = true;
        const rD = TestGmailLog_.threadReplies.length;
        const alertsD = TestGmailLog_.sent.length;
        let threwD = false;
        try { sendOvernightFollowupEmails(); } catch (e) { threwD = true; }
        boom.armed = false;
        TestAssert_(!threwD, 'Isolation 13:00: one bucket throwing does NOT abort the run');
        TestAssertEqual_(TestGmailLog_.threadReplies.length, rD + 1, 'Isolation 13:00: the OTHER bucket\'s follow-up still went out');
        TestAssert_(TestGmailLog_.sent.slice(alertsD).some(function (e) { return /1pm follow-up: 1 bucket\(s\) failed/.test(e.subject); }), 'Isolation 13:00: ops is told which bucket failed');
        TestAssert_(!!bucketRow_(logD, 'Test A1 One')[12], 'Isolation 13:00: the ordinary bucket\'s Checkpoint 2 was written');
        TestAssert_(!bucketRow_(logD, 'Futwork')[12], 'Isolation 13:00: the failed bucket\'s Checkpoint 2 stays unwritten');
      } finally {
        FUTWORK_ROUTE_EMAIL_ = realFutworkRoute;
        computeAllIssuesCheckpointGs_ = realCompute;
      }
    }

    // ==== 2026-10-07 email audit F18 + F23: the real snapshot -> baseline -> email -> watchdog chain (see TestEFC_runSnapshotChain_) ====
    TestEFC_runSnapshotChain_(now, header, banner, monthShort);

    TestAssertOnlyTestEmails_();
  } finally {
    TEST_MODE_OVERRIDE_EMAIL_ = '';
    TestEnv_tearDown_();
  }
  return TestResults_;
}

// ======================================================================================================================
// 2026-10-07 email audit F18 + F23 - the SNAPSHOT -> BASELINE -> EMAIL chain, end to end.
//
// The unit tests prove each piece with hand-built inputs; this proves the pieces agree with EACH OTHER: the REAL
// snapshotPeriodic() writes Movement_Log / Movement_Log_Runs / SLA_History and its run record; the REAL 17:00 and 10:00 jobs
// then read the Movement_Log it produced; the REAL watchdog reads the run record. Nothing here hand-builds a Movement_Log row
// that the real writer would have produced (the one thing done by hand is moving a captured row's snapshot_at back by a day -
// the same single-cell technique this file's other scenarios use, because the clock is the real one and cannot be advanced).
//
// Written to be safe at ANY hour of the day (the project's earlier e2e/time failures: a fixture that was only "clean" outside
// the first hours after IST midnight): every offset is >= 24 h, so a "yesterday" snapshot is always before today's IST start;
// the leads are > 48 h old at any time of day (created one millisecond after the 17:00 window opens); no assertion reads the
// current IST hour; watchdog assertions look ONLY at snapshotPeriodic alerts (the email-job checks depend on the hour).
// Every scenario builds its own spreadsheet + Script Properties, restores every global it swaps in a finally, and counts
// against the shared Gmail log RELATIVELY. No real Drive / Gmail / Sheet / property is touched (all mocks).
//
// The same lead ids and the same expected flags are asserted in the browser by tests/frontend-harness.html section 7
// ("snapshot -> baseline -> render"), so the two runtimes are checked against ONE table:
//   E101  customer C-E1, counter 13, no calls today        -> behind
//   E102  customer C-E1 (sibling), counter 4 -> 9          -> NOT behind (own baseline 4: 5 calls)  <- the F18 trap
//   E201  own customer, counter 2 -> 2                     -> behind
//   E301  own customer, counter 1 -> 7                     -> NOT behind (6 calls)
// ======================================================================================================================
function TestEFC_e2eRows_(header, banner, created, now, state) {
  const base = function (id, client, stage, attempts) {
    return TestEFC_leadRow_(header, {
      lead_id: id, client_id: client, RM: 'Test RM One', region: 'Pune', current_stage: stage, lead_assigned_at: created,
      call_attempts: attempts, last_connect: 'Connected', last_connect_time: TestFixture_hoursAgo_(now, 0.5),
    });
  };
  return [banner, header,
    base('E101', 'C-E1', 'Not Updated', state.A),
    base('E102', 'C-E1', 'Suspect', state.B),
    base('E201', 'C-E2', 'Suspect', state.SOLO),
    base('E301', 'C-E3', 'Suspect', state.BUSY),
  ];
}

function TestEFC_e2eSpreadsheet_(rows, monthShort) {
  const s = TestMockSpreadsheet_({
    'RM_Hierarchy': TestMockSheet_('RM_Hierarchy', TestFixture_rmHierarchyRows_()),
    'Manager_Directory': TestMockSheet_('Manager_Directory', TestFixture_managerDirectoryRows_()),
  });
  s._sheets[monthShort] = TestMockSheet_(monthShort, rows);
  return s;
}

// Moves the snapshot_at of every Movement_Log row captured so far back to `atByLead[lead_id]` (a Date) - "a day passed".
function TestEFC_ageMovementLog_(ss, atByLead) {
  const sheet = ss.getSheetByName('Movement_Log');
  const leadCol = 1 + 2 + SNAPSHOT_COLUMNS_.indexOf('lead_id'); // 1-based: snapshot_at, snapshot_label, then the fields
  const n = sheet.getLastRow() - 1;
  const ids = sheet.getRange(2, leadCol, n, 1).getValues();
  for (let i = 0; i < n; i++) {
    const at = atByLead[String(ids[i][0])];
    if (at) sheet.getRange(2 + i, 1, 1, 1).setValues([[at]]);
  }
}

function TestEFC_movementRows_(ss) {
  const sheet = ss.getSheetByName('Movement_Log');
  const w = sheet.getLastColumn();
  const header = sheet.getRange(1, 1, 1, w).getValues()[0];
  const data = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, w).getValues() : [];
  return data.map(function (r) {
    const o = {};
    header.forEach(function (h, i) { o[h] = r[i]; });
    return o;
  });
}

function TestEFC_runSnapshotChain_(now, header, banner, monthShort) {
  const win = allIssuesWindowGs_(now);
  const created = new Date(win.from.getTime() + 1);                  // inside the window, > 48 h old at any time of day
  const dayAgo = TestFixture_hoursAgo_(now, 24);
  const dayAndHourAgo = TestFixture_hoursAgo_(now, 25);
  const realSpreadsheetApp = SpreadsheetApp;
  const realProps = PropertiesService;
  const realDrive = DriveApp;
  const realSnapshotOpenLeads = snapshotOpenLeads_;
  const useSs = function (s) { SpreadsheetApp = { getActiveSpreadsheet: function () { return s; }, flush: function () {} }; };
  const snapAlerts = function (fromIndex) {
    return TestGmailLog_.sent.slice(fromIndex).filter(function (e) { return /snapshotPeriodic/.test(e.subject); });
  };
  const D1 = { A: 13, B: 4, SOLO: 2, BUSY: 1 };   // yesterday's counters
  const D2 = { A: 13, B: 9, SOLO: 2, BUSY: 7 };   // today's: B +5 calls, BUSY +6, A and SOLO none
  try {
    // ===== SCENARIO 1: yesterday's capture -> today's 17:00 all-issues email =====
    PropertiesService = TestMockPropertiesService_();
    const ss1 = TestEFC_e2eSpreadsheet_(TestEFC_e2eRows_(header, banner, created, now, D1), monthShort);
    useSs(ss1);

    snapshotPeriodic();                                                  // REAL capture #1 ("yesterday")
    let mlRows = TestEFC_movementRows_(ss1);
    TestAssertEqual_(mlRows.map(function (r) { return r.lead_id; }).sort().join(','), 'E101,E102,E201,E301', 'E2E capture #1: Movement_Log holds exactly the four leads, written by the real snapshot');
    TestAssertEqual_(mlRows.filter(function (r) { return r.lead_id === 'E102'; })[0].call_attempts, 4, 'E2E capture #1: E102\'s counter (4) is what was captured');
    TestAssert_(mlRows.every(function (r) { return /^[0-9a-f]{64}$/.test(String(r.content_hash)); }), 'E2E capture #1: every row carries a real 64-char content hash');
    const runs1 = ss1.getSheetByName('Movement_Log_Runs');
    const runRow1 = runs1.getRange(2, 1, 1, MOVEMENT_LOG_RUNS_COLUMNS_.length).getValues()[0];
    TestAssert_(runRow1[2] === 4 && runRow1[3] === 4 && typeof runRow1[4] === 'number' && runRow1[5] === '', 'E2E capture #1: Movement_Log_Runs says 4 seen / 4 changed, a numeric total_s, nothing skipped');
    const record1 = readEmailJobRunGs_('snapshotPeriodic');
    TestAssert_(record1 && record1.status === 'completed' && typeof record1.totalSeconds === 'number' && record1.skipped.length === 0, 'E2E capture #1: the run record says completed, with a run time and no skipped phases');
    TestAssertEqual_(snapshotRunProblemsGs_(new Date()).length, 0, 'E2E capture #1: the watchdog sees nothing wrong with a clean run');
    const sla1 = ss1.getSheetByName('SLA_History').getRange(2, 1, 1, SLA_HISTORY_COLUMNS_.length).getValues()[0];
    TestAssertEqual_(sla1[SLA_HISTORY_COLUMNS_.indexOf('underCalledToday')], 4, 'E2E capture #1: with no earlier snapshot there is no baseline, so all four read as under-called (comment-count fallback)');

    // A day passes: yesterday's capture. The sibling's snapshot is the LATER one on purpose (the F18 trap).
    TestEFC_ageMovementLog_(ss1, { E102: dayAndHourAgo, E101: dayAgo, E201: dayAgo, E301: dayAgo });
    runs1.getRange(2, 1, 1, 1).setValues([[dayAgo]]);

    // TODAY: the leads tab changes (E102 +5 calls, E301 +6), then the REAL 17:00 job reads the Movement_Log the snapshot wrote.
    ss1._sheets[monthShort] = TestMockSheet_(monthShort, TestEFC_e2eRows_(header, banner, created, now, D2));
    const drafts1 = TestGmailLog_.drafts.length;
    sendAllIssuesEmails();
    const sent1 = TestGmailLog_.drafts.slice(drafts1);
    TestAssertEqual_(sent1.length, 1, 'E2E 17:00: one bucket email goes out');
    const html1 = sent1[0].htmlBody;
    const rowOf = function (html, id) { const at = html.indexOf(id); return at === -1 ? '' : html.slice(at, html.indexOf('</tr>', at)); };
    TestAssertEqual_(html1.indexOf('E101'), -1, 'E2E 17:00: the sibling that lost the per-customer collapse (E101) is not listed');
    const rowB = rowOf(html1, 'E102');
    TestAssertContains_(rowB, 'Stuck 48h+', 'E2E 17:00: E102 is measured against ITS OWN baseline from the real Movement_Log (9 - 4 = 5 calls): Stuck 48h+, not behind');
    TestAssertEqual_(rowB.indexOf("Behind on Today's Calls"), -1, 'E2E 17:00: …so the sibling\'s later 13 does not make it look behind');
    TestAssertContains_(rowB, '5 more call attempts', 'E2E 17:00: E102\'s follow-up compares with its own last snapshot (4 -> 9)');
    const rowSolo = rowOf(html1, 'E201');
    TestAssertContains_(rowSolo, "Behind on Today's Calls", 'E2E 17:00: control - a lead with no calls today (2 -> 2) is still flagged behind');
    TestAssertContains_(rowSolo, 'no new call attempts', 'E2E 17:00: control - …with the "no new call attempts" follow-up');
    const rowBusy = rowOf(html1, 'E301');
    TestAssertContains_(rowBusy, 'Stuck 48h+', 'E2E 17:00: control - a lead with 6 calls today (1 -> 7) is not behind');
    TestAssertContains_(rowBusy, '6 more call attempts', 'E2E 17:00: control - …and its follow-up says 6 more attempts');
    const snapshotJson = JSON.parse(ss1.getSheetByName('AllIssues_Log').getRange(2, 10, 1, 1).getValues()[0][0]);
    TestAssertEqual_(snapshotJson.map(function (l) { return l.lead_id + ':' + l.issueLabel; }).sort().join('|'),
      "E102:Stuck 48h+|E201:Behind on Today's Calls|E301:Stuck 48h+", 'E2E 17:00: the logged issue snapshot names exactly the same issue per lead as the email');

    // TODAY'S capture (#2), real, after the email. Only the two leads that changed get a new row.
    snapshotPeriodic();
    mlRows = TestEFC_movementRows_(ss1);
    TestAssertEqual_(mlRows.length, 6, 'E2E capture #2: Movement_Log gained exactly two rows (E102 and E301 changed; E101 and E201 were deduplicated)');
    const runRow2 = runs1.getRange(3, 1, 1, MOVEMENT_LOG_RUNS_COLUMNS_.length).getValues()[0];
    TestAssert_(runRow2[2] === 4 && runRow2[3] === 2, 'E2E capture #2: Movement_Log_Runs says 4 seen / 2 changed');
    // 5 ms past "now": the capture stamped its rows with its own `new Date()` a moment ago, and the mock runs fast enough for the two
    // to land in the same millisecond - the maps take snapshots STRICTLY BEFORE their cutoff, so an equal stamp would be left out.
    const mapsNow = new Date(Date.now() + 5);
    const maps = buildMovementLogMapsGs_(ss1, mapsNow);
    TestAssert_(maps.baselineMap.E102 === 4 && maps.baselineMap.E101 === 13 && maps.baselineMap.E201 === 2 && maps.baselineMap.E301 === 1,
      'E2E capture #2: the baselines are still yesterday\'s per-lead counters - today\'s own capture rows are never a baseline');
    TestAssert_(maps.lastSnapshotMap.E102.call_attempts === 9 && maps.lastSnapshotMap.E301.call_attempts === 7, 'E2E capture #2: …while the latest-snapshot map now holds today\'s capture');
    TestAssertEqual_(Object.keys(maps.baselineMap).sort().join(','), 'E101,E102,E201,E301', 'E2E capture #2: the maps are keyed by lead id only (no client-id or l: keys)');
    const todayRows = ss1._sheets[monthShort].getRange(3, 1, 4, header.length).getValues();
    const colIndexE2e = buildColIndex_(header);
    const behind = {};
    todayRows.forEach(function (r) { behind[String(getVal_(r, colIndexE2e, 'lead_id'))] = computeSlaFlags_(r, colIndexE2e, mapsNow, maps.baselineMap).underCalledToday; });
    TestAssertEqual_(JSON.stringify(behind), JSON.stringify({ E101: true, E102: false, E201: true, E301: false }), 'E2E shared table: per-lead "behind on today\'s calls" from the real Movement_Log (the browser test asserts the same table)');
    const sla2 = ss1.getSheetByName('SLA_History').getRange(3, 1, 1, SLA_HISTORY_COLUMNS_.length).getValues()[0];
    TestAssertEqual_(sla2[SLA_HISTORY_COLUMNS_.indexOf('underCalledToday')], 2, 'E2E capture #2: SLA_History (written AFTER the capture now) counts 2 under-called - it did not read the run\'s own fresh rows as a baseline (that would give 3)');
    TestAssertEqual_(sla2[SLA_HISTORY_COLUMNS_.indexOf('openTotal')], 4, 'E2E capture #2: …over the 4 open leads');

    // ===== SCENARIO 2: the 10:00 overnight email reads the same real Movement_Log =====
    PropertiesService = TestMockPropertiesService_();
    const overnightWin = overnightWindowGs_(now);
    // Never younger than 3.5 h (see Tests_OvernightEmailer.gs's midWindow): the window's end can be in the future between midnight and ~04:30 IST.
    const midWindow = new Date(Math.min((overnightWin.from.getTime() + overnightWin.to.getTime()) / 2, now.getTime() - 3.5 * 3600 * 1000));
    const ss2 = TestEFC_e2eSpreadsheet_(TestEFC_e2eRows_(header, banner, midWindow, now, D1), monthShort);
    useSs(ss2);
    snapshotPeriodic();                                                  // real capture of yesterday's counters
    TestEFC_ageMovementLog_(ss2, { E102: dayAndHourAgo, E101: dayAgo, E201: dayAgo, E301: dayAgo });
    ss2._sheets[monthShort] = TestMockSheet_(monthShort, TestEFC_e2eRows_(header, banner, midWindow, now, D2));
    const drafts2 = TestGmailLog_.drafts.length;
    sendOvernightMorningEmails();
    const sent2 = TestGmailLog_.drafts.slice(drafts2).filter(function (d) { return d.htmlBody.indexOf('E102') !== -1; });
    TestAssertEqual_(sent2.length, 1, 'E2E 10:00: the overnight email carrying the surviving sibling goes out once');
    const html2 = sent2[0] ? sent2[0].htmlBody : '';
    TestAssertEqual_(html2.indexOf('E101'), -1, 'E2E 10:00: the collapsed sibling is not listed');
    TestAssertContains_(rowOf(html2, 'E102'), '5 more call attempts', 'E2E 10:00: E102\'s follow-up uses its OWN snapshot from the real Movement_Log (4 -> 9)');
    TestAssertContains_(rowOf(html2, 'E301'), '6 more call attempts', 'E2E 10:00: control - E301 (1 -> 7)');
    TestAssertContains_(rowOf(html2, 'E201'), 'no new call attempts', 'E2E 10:00: control - E201 (2 -> 2)');

    // ===== SCENARIO 3: the prune (F23) against rows the real snapshot wrote =====
    PropertiesService = TestMockPropertiesService_();
    const driveMock = TestMockDriveApp_();
    DriveApp = driveMock;
    const old = TestFixture_daysAgo_(now, 10);
    const ss3 = TestEFC_e2eSpreadsheet_(TestEFC_e2eRows_(header, banner, created, now, D1), monthShort);
    useSs(ss3);
    snapshotPeriodic();
    TestEFC_ageMovementLog_(ss3, { E101: old, E102: old, E201: old, E301: old });  // the whole first capture is 10 days old
    ss3.getSheetByName('Movement_Log_Runs').getRange(2, 1, 1, 1).setValues([[old]]);
    const mlSheet3 = ss3.getSheetByName('Movement_Log');
    mlSheet3._maxRows = 20000;
    const deletes3 = [];
    const origDelete3 = mlSheet3.deleteRows;
    mlSheet3.deleteRows = function (a, b) { deletes3.push([a, b]); return origDelete3.apply(mlSheet3, arguments); };
    ss3._sheets[monthShort] = TestMockSheet_(monthShort, TestEFC_e2eRows_(header, banner, created, now, D2));
    snapshotPeriodic();                                                  // today: B and BUSY changed; the prune removes the 10-day-old prefix
    mlRows = TestEFC_movementRows_(ss3);
    TestAssertEqual_(mlRows.map(function (r) { return r.lead_id; }).sort().join(','), 'E102,E301', 'E2E prune: after today\'s capture only the two changed leads have a row - the 10-day-old prefix is gone');
    TestAssert_(mlRows.every(function (r) { return r.snapshot_at instanceof Date && r.snapshot_at.getTime() > now.getTime() - 3600000; }), 'E2E prune: every surviving row is today\'s capture');
    TestAssertEqual_(deletes3[0].join(','), '2,4', 'E2E prune: the 4 expired rows (sheet rows 2-5) were removed by ONE deleteRows call, not a rewrite');
    const archiveFolder3 = driveMock._folders[ARCHIVE_ROOT_FOLDER_] && driveMock._folders[ARCHIVE_ROOT_FOLDER_]._folders['Movement_Log'];
    TestAssert_(!!archiveFolder3 && ['E101', 'E102', 'E201', 'E301'].every(function (id) { return archiveFolder3._filesList[0]._content.indexOf(id) !== -1; }), 'E2E prune: the removed rows were archived to Drive first - all four leads');
    TestAssertEqual_(ss3.getSheetByName('Movement_Log').getRange(1, 1, 1, 2).getValues()[0].join(','), 'snapshot_at,snapshot_label', 'E2E prune: the header row is intact');
    const runRow3 = ss3.getSheetByName('Movement_Log_Runs').getRange(3, 1, 1, MOVEMENT_LOG_RUNS_COLUMNS_.length).getValues()[0];
    TestAssert_(runRow3[2] === 4 && runRow3[3] === 2 && typeof runRow3[4] === 'number' && runRow3[5] === '', 'E2E prune: the run record is complete (4 seen, 2 changed, total_s, nothing skipped)');
    snapshotPeriodic();                                                  // the unchanged leads lost their only row to the prune; the next capture restores them
    TestAssertEqual_(TestEFC_movementRows_(ss3).map(function (r) { return r.lead_id; }).sort().join(','), 'E101,E102,E201,E301', 'E2E prune: the next capture writes the two leads whose only row was pruned (existing behaviour: a lead unchanged for 7+ days is re-captured one run later)');
    DriveApp = realDrive;

    // ===== SCENARIO 4: the watchdog reads the run record (F23) =====
    PropertiesService = TestMockPropertiesService_();
    const ss4 = TestEFC_e2eSpreadsheet_(TestEFC_e2eRows_(header, banner, created, now, D2), monthShort);
    useSs(ss4);
    // 4a. a clean scheduled run is silent
    let alertsAt = TestGmailLog_.sent.length;
    snapshotPeriodic();
    checkEmailJobsCompletedGs_(new Date());
    TestAssertEqual_(snapAlerts(alertsAt).length, 0, 'E2E watchdog: a clean run produces no snapshotPeriodic alert');
    // 4b. a run the platform killed leaves its record "running"; it is alerted ONCE, then a good run clears it
    PropertiesService.getScriptProperties().setProperty('EMAIL_JOB_RUN_snapshotPeriodic', JSON.stringify({ day: istDayKeyGs_(now), startedAt: new Date(now.getTime() - 40 * 60000).toISOString(), status: 'running' }));
    alertsAt = TestGmailLog_.sent.length;
    checkEmailJobsCompletedGs_(new Date());
    let a4b = snapAlerts(alertsAt);
    TestAssertEqual_(a4b.length, 1, 'E2E watchdog: a snapshot still "running" after 40 minutes (killed at the limit) is alerted');
    TestAssertContains_(a4b[0].subject, 'WATCHDOG: snapshotPeriodic did not finish', 'E2E watchdog: …naming the job and the problem');
    TestAssertContains_(a4b[0].body, 'snapshotNow', 'E2E watchdog: …and how to capture right now');
    checkEmailJobsCompletedGs_(new Date());
    TestAssertEqual_(snapAlerts(alertsAt).length, 1, 'E2E watchdog: an hourly re-check does not repeat the alert for the same run');
    snapshotPeriodic();
    alertsAt = TestGmailLog_.sent.length;
    checkEmailJobsCompletedGs_(new Date());
    TestAssertEqual_(snapAlerts(alertsAt).length, 0, 'E2E watchdog: the next good run clears the problem - silent again');
    // 4c. a run too slow for its budget: the core capture is kept, the optional phases are skipped, ops are told once
    // a REAL change first (E101's counter moves), so the kept core capture is observable as exactly one new row
    ss4._sheets[monthShort] = TestMockSheet_(monthShort, TestEFC_e2eRows_(header, banner, created, now, { A: 14, B: 9, SOLO: 2, BUSY: 7 }));
    snapshotOpenLeads_ = function (label) { return realSnapshotOpenLeads(label, { deadlineSeconds: -1 }); };
    const mlBefore4 = TestEFC_movementRows_(ss4).length;
    const slaBefore4 = ss4.getSheetByName('SLA_History').getLastRow();
    try { snapshotPeriodic(); } finally { snapshotOpenLeads_ = realSnapshotOpenLeads; }
    const record4c = readEmailJobRunGs_('snapshotPeriodic');
    TestAssert_(record4c.status === 'completed' && record4c.skipped.length === 7, 'E2E watchdog: a budget-starved run still completes and records the 7 skipped phases');
    TestAssertEqual_(ss4.getSheetByName('SLA_History').getLastRow(), slaBefore4, 'E2E watchdog: …the optional SLA_History write was the first thing skipped');
    TestAssertEqual_(TestEFC_movementRows_(ss4).length, mlBefore4 + 1, 'E2E watchdog: …but the core Movement_Log capture was kept (the one changed lead got its row)');
    const runsLast4 = ss4.getSheetByName('Movement_Log_Runs');
    const runRow4c = runsLast4.getRange(runsLast4.getLastRow(), 1, 1, MOVEMENT_LOG_RUNS_COLUMNS_.length).getValues()[0];
    TestAssert_(typeof runRow4c[4] === 'number' && /Movement_Log prune/.test(String(runRow4c[5])), 'E2E watchdog: …and Movement_Log_Runs records the skipped phases');
    alertsAt = TestGmailLog_.sent.length;
    checkEmailJobsCompletedGs_(new Date());
    checkEmailJobsCompletedGs_(new Date());
    const a4c = snapAlerts(alertsAt);
    TestAssertEqual_(a4c.length, 1, 'E2E watchdog: skipped phases are alerted exactly once for that run');
    TestAssertContains_(a4c[0].subject, 'skipped work', 'E2E watchdog: …as "skipped work to stay inside its time limit"');
    // 4d. a failing run: recorded as failed, re-thrown, alerted once
    snapshotOpenLeads_ = function () { throw new Error('simulated: the leads tab could not be read'); };
    let threw4d = false;
    try { snapshotPeriodic(); } catch (e) { threw4d = /could not be read/.test(e.message); } finally { snapshotOpenLeads_ = realSnapshotOpenLeads; }
    TestAssert_(threw4d, 'E2E watchdog: a failing snapshot still fails the execution (re-thrown)');
    alertsAt = TestGmailLog_.sent.length;
    checkEmailJobsCompletedGs_(new Date());
    const a4d = snapAlerts(alertsAt);
    TestAssertEqual_(a4d.length, 1, 'E2E watchdog: the failed run is alerted once');
    TestAssertContains_(a4d[0].subject, 'WATCHDOG: snapshotPeriodic failed', 'E2E watchdog: …as a failure');
    TestAssertContains_(a4d[0].body, 'could not be read', 'E2E watchdog: …with the error text');
    // ===== SCENARIO 5: the comment prunes (the real production failure) and the failure email =====
    // Comment_History / Unmatched_Comments_Log hold multi-line comments. They failed for days in production ("Drive archive holds
    // 6518 row(s) ... refusing to prune") and nobody was emailed. Here the REAL snapshotPeriodic prunes them, then a failing prune
    // is emailed once and shown in Movement_Log_Runs.
    PropertiesService = TestMockPropertiesService_();
    const drive5 = TestMockDriveApp_();
    DriveApp = drive5;
    const ss5 = TestEFC_e2eSpreadsheet_(TestEFC_e2eRows_(header, banner, created, now, D2), monthShort);
    const old5 = Utilities.formatDate(TestFixture_daysAgo_(now, 45), 'Asia/Kolkata', 'yyyy-MM-dd');
    const new5 = Utilities.formatDate(TestFixture_daysAgo_(now, 2), 'Asia/Kolkata', 'yyyy-MM-dd');
    const chRow5 = function (d, id, comment) { return [d, id, 'C-' + id, 'Test RM One', 'Pune', 'P', comment, '', '2026-01-01 00:00:00']; };
    ss5._sheets[COMMENT_HISTORY_SHEET_] = TestMockSheet_(COMMENT_HISTORY_SHEET_, [COMMENT_HISTORY_COLUMNS_,
      chRow5(old5, 'E-OLD1', 'line one\nline two'), chRow5(old5, 'E-OLD2', 'single line'), chRow5(new5, 'E-NEW1', 'recent\nmulti-line')]);
    ss5._sheets[UNMATCHED_COMMENTS_LOG_SHEET_] = TestMockSheet_(UNMATCHED_COMMENTS_LOG_SHEET_, [UNMATCHED_COMMENTS_LOG_COLUMNS_,
      [old5, 'E-OLD3', 'Test RM One', 'Pune', 'P', 'x\ny', '', '2026-01-01 00:00:00', false, ''],
      [new5, 'E-NEW2', 'Test RM One', 'Pune', 'P', 'recent', '', '2026-01-01 00:00:00', false, '']]);
    useSs(ss5);
    let alerts5 = TestGmailLog_.sent.length;
    snapshotPeriodic();
    TestAssertEqual_(ss5.getSheetByName(COMMENT_HISTORY_SHEET_).getLastRow(), 2, 'E2E comment prunes: the expired Comment_History rows (one multi-line) are removed - header + the recent row remain');
    TestAssertEqual_(ss5.getSheetByName(COMMENT_HISTORY_SHEET_).getRange(2, 2, 1, 1).getValues()[0][0], 'E-NEW1', 'E2E comment prunes: …the survivor is the recent multi-line row, intact');
    TestAssertEqual_(ss5.getSheetByName(UNMATCHED_COMMENTS_LOG_SHEET_).getLastRow(), 2, 'E2E comment prunes: the expired Unmatched_Comments_Log row (multi-line) is removed too');
    const archived5 = JSON.stringify(Object.keys(drive5._folders[ARCHIVE_ROOT_FOLDER_]._folders));
    TestAssert_(archived5.indexOf(COMMENT_HISTORY_SHEET_) !== -1 && archived5.indexOf(UNMATCHED_COMMENTS_LOG_SHEET_) !== -1, 'E2E comment prunes: both were archived to Drive first');
    const runs5 = ss5.getSheetByName('Movement_Log_Runs');
    const runRow5 = runs5.getRange(runs5.getLastRow(), 1, 1, MOVEMENT_LOG_RUNS_COLUMNS_.length).getValues()[0];
    TestAssertEqual_(runRow5[MOVEMENT_LOG_RUNS_COLUMNS_.indexOf('failed_phases')], '', 'E2E comment prunes: nothing failed in this run (failed_phases is blank)');
    TestAssertEqual_(TestGmailLog_.sent.slice(alerts5).filter(function (e) { return /Movement snapshot: .*FAILED/.test(e.subject); }).length, 0, 'E2E comment prunes: …so no failure email');
    // Now the failure path, end to end: the real run, a prune that throws.
    ss5._sheets[COMMENT_HISTORY_SHEET_].appendRow(chRow5(old5, 'E-OLD4', 'expired again'));
    const realPruneCh5 = pruneCommentHistory_;
    pruneCommentHistory_ = function () { throw new Error('Drive archive holds 9 row(s) across 1 file(s) but 4 were expected - refusing to prune Comment_History.'); };
    alerts5 = TestGmailLog_.sent.length;
    try { snapshotPeriodic(); } finally { pruneCommentHistory_ = realPruneCh5; }
    const fail5 = TestGmailLog_.sent.slice(alerts5).filter(function (e) { return /Movement snapshot: .*FAILED/.test(e.subject); });
    TestAssertEqual_(fail5.length, 1, 'E2E comment prunes: a failing prune emails ops exactly once');
    TestAssertContains_(fail5[0].body, 'refusing to prune Comment_History', 'E2E comment prunes: …with the real error text');
    const runRow5b = runs5.getRange(runs5.getLastRow(), 1, 1, MOVEMENT_LOG_RUNS_COLUMNS_.length).getValues()[0];
    TestAssertEqual_(runRow5b[MOVEMENT_LOG_RUNS_COLUMNS_.indexOf('failed_phases')], 'Comment_History prune', 'E2E comment prunes: …and Movement_Log_Runs.failed_phases says which step');
    TestAssertEqual_(readEmailJobRunGs_('snapshotPeriodic').status, 'completed', 'E2E comment prunes: …while the run itself still completes (the capture is unaffected)');
    TestAssertEqual_(readEmailJobRunGs_('snapshotPeriodic').failed.join(','), 'Comment_History prune', 'E2E comment prunes: …and the run record carries the failed step');
    snapshotPeriodic();
    TestAssertEqual_(TestGmailLog_.sent.slice(alerts5).filter(function (e) { return /Movement snapshot: .*FAILED/.test(e.subject); }).length, 1, 'E2E comment prunes: once fixed, the next run prunes the row and sends nothing more');
    TestAssertEqual_(ss5.getSheetByName(COMMENT_HISTORY_SHEET_).getLastRow(), 2, 'E2E comment prunes: …the row that failed to prune is now gone');
    DriveApp = realDrive;
  } finally {
    SpreadsheetApp = realSpreadsheetApp;
    PropertiesService = realProps;
    DriveApp = realDrive;
    snapshotOpenLeads_ = realSnapshotOpenLeads;
  }
}

function runEmailLifecycleFullCycleTestsNow() { runEmailLifecycleFullCycleTests_(); }
