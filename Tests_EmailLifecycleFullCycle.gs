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
      TestAssertEqual_(countOf_(replyB, 'L-LEG-A'), 1, 'Futwork legacy rows 13:00: a lead is NOT repeated once per row (the merged lists are de-duplicated)');
      TestAssertEqual_(countOf_(replyB, 'L-LEG-B'), 1, 'Futwork legacy rows 13:00: the other lead appears exactly once too');
      const afterB13 = logB.getRange(2, 1, 2, 14).getValues();
      TestAssert_(afterB13[0][12].length < 2000 && afterB13[1][12].length < 2000, 'Futwork legacy rows 13:00: the Checkpoint 2 cell stays small (no multiplied copies)');
    }

    TestAssertOnlyTestEmails_();
  } finally {
    TEST_MODE_OVERRIDE_EMAIL_ = '';
    TestEnv_tearDown_();
  }
  return TestResults_;
}

function runEmailLifecycleFullCycleTestsNow() { runEmailLifecycleFullCycleTests_(); }
