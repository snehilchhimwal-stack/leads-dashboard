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
      // ==== 17:00: real sendAllIssuesEmails() ====
      sendAllIssuesEmails();
      TestAssertEqual_(TestGmailLog_.drafts.length, 1, 'Full cycle 17:00: sendAllIssuesEmails sends exactly one bucket email for L-CYCLE\'s RM');
      const seventeenDraft = TestGmailLog_.drafts[0];
      TestAssertContains_(seventeenDraft.htmlBody, 'L-CYCLE', 'Full cycle 17:00: the all-issues email lists L-CYCLE');

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

      // Simulate the lead getting resolved between 10am and 1pm — the
      // ONLY leads-tab edit this test makes, directly mutating the same
      // mock row sendAllIssuesEmails/sendOvernightMorningEmails already
      // read, the same way a real RM updating the sheet between runs
      // would change what the 13:00 job sees.
      ss._sheets[monthShort].getRange(3, header.indexOf('current_stage') + 1, 1, 1).setValues([['Opportunity']]);

      // ==== 13:00: real sendOvernightFollowupEmails() ====
      sendOvernightFollowupEmails();
      TestAssertEqual_(TestGmailLog_.threadReplies.length, 1, 'Full cycle 13:00: sendOvernightFollowupEmails sends exactly one threaded reply for this bucket');
      const thirteenReply = TestGmailLog_.threadReplies[0];
      TestAssertEqual_(thirteenReply.threadId, tenAmDraft._threadId, 'Full cycle 13:00: the reply threads into the SAME Gmail thread the real 10:00 send created — the actual thread_id, not a hand-seeded one');
      const thirteenHtml = TestOE_decodeRawMime_(thirteenReply.raw);
      TestAssertContains_(thirteenHtml, 'Nothing still unresolved from this morning', 'Full cycle 13:00: Section 1 still correctly shows its own empty state');
      TestAssertContains_(thirteenHtml, 'L-CYCLE', 'Full cycle 13:00: Section 2 (Checkpoint 2) lists L-CYCLE');
      TestAssertContains_(thirteenHtml, 'Resolved', 'Full cycle 13:00: L-CYCLE (now Opportunity) shows as Resolved — a real transition the real code recomputed, not an echo of checkpoint1_json');

      const rowAfter13 = allIssuesLog.getRange(2, 1, 1, 14).getValues()[0];
      TestAssert_(!!rowAfter13[12], 'Full cycle 13:00: checkpoint2_json (col M) now written by the REAL sendCombinedFollowupEmail_');
      TestAssert_(!!rowAfter13[13], 'Full cycle 13:00: checkpoint2_sent_at (col N) now written');
      const checkpoint2Written = JSON.parse(rowAfter13[12]);
      TestAssertEqual_(checkpoint2Written[0].state, 'resolved', 'Full cycle 13:00: the real checkpoint2_json records resolved');

      const overnightRowAfter13 = overnightLog.getRange(2, 1, 1, 9).getValues()[0];
      TestAssert_(!!overnightRowAfter13[8], 'Full cycle 13:00: followup_sent_at now written — Step 8\'s own idempotency guard, exercised end to end');

      // ==== Idempotency, end to end: a full second pass of all 3 real
      // entry points the same day sends NOTHING new for this bucket —
      // every guard (alreadyLoggedRegionsToday ×2, checkpoint1/2_sent_at,
      // followup_sent_at) proven together, not just individually. ====
      const draftsBeforeRerun = TestGmailLog_.drafts.length;
      const repliesBeforeRerun = TestGmailLog_.threadReplies.length;
      sendAllIssuesEmails();
      sendOvernightMorningEmails();
      sendOvernightFollowupEmails();
      TestAssertEqual_(TestGmailLog_.drafts.length, draftsBeforeRerun, 'Full cycle: a full second pass of all 3 real jobs the same day sends no new drafts');
      TestAssertEqual_(TestGmailLog_.threadReplies.length, repliesBeforeRerun, 'Full cycle: a full second pass of all 3 real jobs the same day sends no new threaded replies');
    }

    TestAssertOnlyTestEmails_();
  } finally {
    TestEnv_tearDown_();
  }
  return TestResults_;
}

function runEmailLifecycleFullCycleTestsNow() { runEmailLifecycleFullCycleTests_(); }
