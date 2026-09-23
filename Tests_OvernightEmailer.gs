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

// sendThreadedGmailReply_ hands Gmail.Users.Messages.send a single
// web-safe-base64 `raw` MIME blob (no Content-Transfer-Encoding header on
// either part, so the html/plain bodies are embedded as literal text, not
// themselves base64) — TestMockGmailAdvanced_ only ever stores that raw
// string (Tests_Mocks.gs), not a separate htmlBody field the way
// TestGmailLog_.drafts/sent do. Decode it back to plain text here so
// Step 7's threaded-reply tests can assert on its content the same way
// the draft-based tests already assert on draft.htmlBody.
function TestOE_decodeRawMime_(raw) {
  const b64 = String(raw || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '==='.slice((b64.length + 3) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

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
  const monthShort = 'leads'; // fixed tab name (no longer month-based) — see Core.gs's resolveTabName_
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
    TestAssertContains_(logSheet.getRange(1, 1, 1, 9).getValues()[0].join(','), 'thread_id', 'ensureOvernightLogSheet_: header includes thread_id');
    TestAssertContains_(logSheet.getRange(1, 1, 1, 9).getValues()[0].join(','), 'followup_sent_at', 'ensureOvernightLogSheet_: header includes followup_sent_at (Step 8/11)');

    // Self-healing: an EXISTING sheet that predates followup_sent_at (the
    // live sheet's own real state until this change is pasted in) gets the
    // missing column appended, not silently ignored — same pattern
    // ensureAllIssuesLogSheet_ already uses.
    const legacySs = TestMockSpreadsheet_({});
    const legacySheet = legacySs.insertSheet(OVERNIGHT_LOG_SHEET_);
    legacySheet.getRange(1, 1, 1, 8).setValues([['date', 'region', 'thread_id', 'lead_ids_json', 'sent_at', 'to', 'cc', 'subject']]);
    const healedSheet = ensureOvernightLogSheet_(legacySs);
    TestAssertEqual_(healedSheet.getLastColumn(), 9, 'ensureOvernightLogSheet_: heals an existing 8-column sheet up to 9 columns');
    TestAssertContains_(healedSheet.getRange(1, 1, 1, 9).getValues()[0].join(','), 'followup_sent_at', 'ensureOvernightLogSheet_: the healed header includes followup_sent_at, appended at the end');
    // Idempotent: healing an already-healed sheet is a no-op, not a
    // second append that would duplicate the column.
    ensureOvernightLogSheet_(legacySs);
    TestAssertEqual_(legacySs.getSheetByName(OVERNIGHT_LOG_SHEET_).getLastColumn(), 9, 'ensureOvernightLogSheet_: healing an already-9-column sheet does not append a duplicate column');

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

    // ---- Two-checkpoint email lifecycle redesign (Step 6/11) — Section 2
    // (Checkpoint 1) wired into the SAME combined 10am send. Seeds
    // AllIssues_Log with two pending rows: one for 'Pune' (same region/
    // recipient the test above already sent Section 1 for today — this
    // exercises the "Section 1 already sent, Section 2 proceeds
    // separately" empty-state path), one for a brand-new 'Harbour'
    // region with NO overnight leads at all today (exercises the plain
    // "no overnight leads" empty-state path instead). ----
    const allIssuesHeader = ['date', 'region', 'bucket_label', 'primary_role', 'to', 'cc', 'lead_count', 'sent_at', 'thread_id',
      'issue_snapshot_json', 'checkpoint1_json', 'checkpoint1_sent_at', 'checkpoint2_json', 'checkpoint2_sent_at'];
    const yesterday = TestFixture_daysAgo_(now, 1);
    const allIssuesRows = [allIssuesHeader,
      [yesterday, 'Pune', 'Test A1 One', 'A1', TEST_EMAIL_PRIMARY_, '', 1, yesterday, 'thread-pune',
        JSON.stringify([{ lead_id: 'L-CKPT-PUNE', RM: 'Test RM One', TL: 'Test A1 One', status: 'Suspect', issueLabel: 'Follow-up Overdue', followup: 'x' }]),
        '', '', '', ''],
      [yesterday, 'Harbour', 'Harbour Manager', 'A1', TEST_EMAIL_SECONDARY_, '', 1, yesterday, 'thread-harbour',
        JSON.stringify([{ lead_id: 'L-CKPT-HARBOUR', RM: 'Harbour RM', TL: 'Harbour Manager', status: 'Suspect', issueLabel: 'Not Updated', followup: 'x' }]),
        '', '', '', ''],
    ];
    ss._sheets['AllIssues_Log'] = TestMockSheet_('AllIssues_Log', allIssuesRows);

    // Checkpoint leads' CURRENT state, appended directly to the SAME
    // leads tab already in use — L-CKPT-PUNE closed (-> resolved),
    // L-CKPT-HARBOUR still open with the literal 'Not Updated' stage
    // text (-> still_open; deliberately NOT relying on the
    // never-connected-past-10-minutes business-hours-gated path, which
    // Tests_SlaEngine.gs already covers with a fixed clock — this file
    // uses the real wall clock, so only a time-of-day-independent
    // trigger belongs in a fixture here).
    ss._sheets[monthShort].appendRow(TestOE_leadRow_(header, { lead_id: 'L-CKPT-PUNE', client_id: 'C-CKPT-PUNE', RM: 'Test RM One', current_stage: 'Won', lead_assigned_at: TestFixture_hoursAgo_(now, 60) }));
    ss._sheets[monthShort].appendRow(TestOE_leadRow_(header, { lead_id: 'L-CKPT-HARBOUR', client_id: 'C-CKPT-HARBOUR', RM: 'Harbour RM', current_stage: 'Not Updated', lead_assigned_at: TestFixture_hoursAgo_(now, 5) }));

    sendOvernightMorningEmails();
    TestAssertEqual_(TestGmailLog_.drafts.length, 4, 'sendOvernightMorningEmails: 2 new combined emails this run — Pune (Section 2 only) and Harbour (Section 2 only)');

    // .filter(...).pop() -- NOT .find(), which would return run 1's
    // ORIGINAL Pune draft (same recipient, and its subject ALSO matches
    // "Follow-up Digest" since every combined send uses that format
    // regardless of whether Section 2 has content) instead of run 3's
    // new one. Sends happen in order, so the LAST matching draft for a
    // given recipient is always the most recent.
    const puneCombined = TestGmailLog_.drafts.filter(function (d) { return d.to === TEST_EMAIL_PRIMARY_; }).pop();
    const harbourCombined = TestGmailLog_.drafts.filter(function (d) { return d.to === TEST_EMAIL_SECONDARY_; }).pop();
    TestAssert_(!!puneCombined, 'sendOvernightMorningEmails: Pune combined email sent to the SAME frozen recipient AllIssues_Log stored yesterday');
    TestAssert_(!!harbourCombined, 'sendOvernightMorningEmails: Harbour combined email sent even though it has zero overnight leads today — Section 2 alone is enough to trigger a send');

    TestAssertContains_(puneCombined.htmlBody, 'Section 1', 'sendCombinedMorningEmail_: Pune email is explicitly labeled Section 1');
    TestAssertContains_(puneCombined.htmlBody, 'Already sent separately earlier today', 'sendCombinedMorningEmail_: Pune Section 1 correctly explains overnight leads existed and already went out — not a generic "none" message');
    TestAssertContains_(puneCombined.htmlBody, 'Section 2', 'sendCombinedMorningEmail_: Pune email is explicitly labeled Section 2');
    TestAssertContains_(puneCombined.htmlBody, 'L-CKPT-PUNE', 'sendCombinedMorningEmail_: Pune Section 2 lists the checkpoint lead');
    TestAssertContains_(puneCombined.htmlBody, 'Resolved', 'sendCombinedMorningEmail_: L-CKPT-PUNE (now closed) shows as Resolved in Section 2');

    TestAssertContains_(harbourCombined.htmlBody, 'No overnight leads for your team today', 'sendCombinedMorningEmail_: Harbour Section 1 shows the plain "no leads" text, NOT the "already sent" text — it genuinely had none, was never sent separately');
    TestAssertContains_(harbourCombined.htmlBody, 'L-CKPT-HARBOUR', 'sendCombinedMorningEmail_: Harbour Section 2 lists its checkpoint lead');
    TestAssertContains_(harbourCombined.htmlBody, 'Still open — Not Updated', 'sendCombinedMorningEmail_: L-CKPT-HARBOUR (still flagged, same issue) shows as still_open with its current issue label');

    // ---- checkpoint1_json/checkpoint1_sent_at written back to the
    // EXACT AllIssues_Log rows the snapshots came from ----
    const allIssuesLogAfter = ss._sheets['AllIssues_Log'].getRange(2, 1, 2, 14).getValues();
    const puneRow = allIssuesLogAfter[0];
    const harbourRow = allIssuesLogAfter[1];
    TestAssert_(!!puneRow[10], 'AllIssues_Log: Pune row gets a checkpoint1_json value written back (col K)');
    TestAssert_(!!puneRow[11], 'AllIssues_Log: Pune row gets a checkpoint1_sent_at timestamp written back (col L)');
    const puneCheckpoint1 = JSON.parse(puneRow[10]);
    TestAssertEqual_(puneCheckpoint1[0].state, 'resolved', 'AllIssues_Log: Pune row\'s persisted checkpoint1_json matches what the email itself showed');
    TestAssert_(!!harbourRow[10] && !!harbourRow[11], 'AllIssues_Log: Harbour row ALSO gets checkpoint1_json/checkpoint1_sent_at written back');

    // ---- Overnight_Log gets a row for Harbour too, even though it had
    // NO overnight leads today (Section 2-only) -- this is the fix for a
    // real gap found while planning Step 7: without a thread reference
    // for a Section-2-only bucket, the 13:00 job would have no thread to
    // reply Checkpoint 2 into for it, breaking "one Gmail thread per
    // bucket per day" (design doc Part 7). An empty issueLog is
    // correct/expected here -- Section 1 genuinely had nothing. ----
    const overnightLogAfterCombined = logSheet.getRange(2, 1, logSheet.getLastRow() - 1, 8).getValues();
    const harbourOvernightLogRow = overnightLogAfterCombined.filter(function (r) { return r[1] === 'Harbour'; })[0];
    TestAssert_(!!harbourOvernightLogRow, 'sendCombinedMorningEmail_: Harbour (Section 2-only, zero overnight leads) STILL gets an Overnight_Log row -- the thread reference Checkpoint 2 will need at 13:00');
    TestAssertEqual_(harbourOvernightLogRow[3], '[]', 'sendCombinedMorningEmail_: Harbour\'s Overnight_Log row correctly logs an EMPTY issueLog -- Section 1 had nothing, that fact is preserved, not faked');

    // ---- idempotency: the NEXT run does not reprocess either checkpoint
    // (checkpoint1_sent_at now set on both rows) ----
    sendOvernightMorningEmails();
    TestAssertEqual_(TestGmailLog_.drafts.length, 4, 'sendOvernightMorningEmails: the next run sends nothing new — both Section 1 (Overnight_Log) and Section 2 (checkpoint1_sent_at) are now fully logged for every region touched so far');

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

    // ---- sendOneOvernightEmail_: a DIFFERENT send error (not "operation
    // not allowed") must ALSO point at Gmail Drafts, not just the one
    // specific phrase — real production case: "Exception: Not found" from
    // this exact createDraft().send() chain, which used to get only a bare
    // "Error: ..." with no Drafts guidance at all. ----
    GmailApp = TestMockGmailApp_({ failSendCountFor: {} });
    GmailApp.createDraft = function () {
      return { send: function () { throw new Error('Exception: Not found'); } };
    };
    try {
      const failRec2 = { to: TEST_EMAIL_PRIMARY_, cc: '', bucketLabel: 'Test A1 One', primaryRole: 'A1', source: 'test' };
      const failLeads2 = [{ lead_id: 'L-FAIL2', RM: 'Test RM One', TL: 'Test A1 One', status: 'Suspect', followup: 'test', issue: null }];
      const result2 = sendOneOvernightEmail_(ss, logSheet, 'Pune', failRec2, failLeads2, '17 Aug 2026', istDayKeyGs_(now), now, win);
      TestAssertContains_(result2.reason, 'Not found', 'sendOneOvernightEmail_: a non-"operation not allowed" error is still reported with its own real text');
      TestAssertContains_(result2.reason, 'Gmail Drafts', 'sendOneOvernightEmail_: a non-"operation not allowed" error STILL points at Gmail Drafts — createDraft() may have already succeeded even though this specific error text isn\'t the known send-block phrase');
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

    // ---- Two-checkpoint email lifecycle redesign (Step 7/11) — Section 2
    // (Checkpoint 2) riding the SAME reply as Section 1, into the SAME
    // thread_id Overnight_Log already stored — proves the two sections
    // compose into ONE email for a bucket that has content in BOTH, not
    // two separate replies. L-CKPT2's checkpoint1_json says 'still_open';
    // its CURRENT leads-tab stage ('Won', added below) makes Checkpoint 2
    // compute 'resolved' — a real transition, so filterAllIssuesCheckpoint2ForEmailGs_
    // keeps it (not one of the closed-out-at-both-checkpoints leads it
    // suppresses), proving Checkpoint 2 is genuinely RE-computed here, not
    // just echoing checkpoint1_json back.
    const allIssuesHeaderFollowup = ['date', 'region', 'bucket_label', 'primary_role', 'to', 'cc', 'lead_count', 'sent_at', 'thread_id',
      'issue_snapshot_json', 'checkpoint1_json', 'checkpoint1_sent_at', 'checkpoint2_json', 'checkpoint2_sent_at'];
    const todayTs = Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss');
    followupSs._sheets['AllIssues_Log'] = TestMockSheet_('AllIssues_Log', [allIssuesHeaderFollowup,
      [now, 'Pune', 'Test A1 One', 'A1', TEST_EMAIL_PRIMARY_, '', 1, now, 'thread_seed_1',
        JSON.stringify([{ lead_id: 'L-CKPT2', RM: 'Test RM One', TL: 'Test A1 One', status: 'Suspect', issueLabel: 'Follow-up Overdue', followup: 'x' }]),
        JSON.stringify([{ lead_id: 'L-CKPT2', state: 'still_open', currentIssueLabel: 'Follow-up Overdue', currentStatus: 'Suspect' }]),
        todayTs, '', ''],
    ]);
    followupSs._sheets[monthShort].appendRow(TestOE_leadRow_(header, { lead_id: 'L-CKPT2', client_id: 'C-CKPT2', RM: 'Test RM One', current_stage: 'Won', lead_assigned_at: TestFixture_hoursAgo_(now, 40) }));

    const realSs1 = SpreadsheetApp;
    SpreadsheetApp = { getActiveSpreadsheet: function () { return followupSs; }, flush: function () {} };
    try {
      sendOvernightFollowupEmails();
      TestAssertEqual_(TestGmailLog_.threadReplies.length, 1, 'sendOvernightFollowupEmails: sends exactly one threaded reply (Advanced Gmail Service succeeds) — Section 1 + Section 2 combine into the SAME reply, not two');
      // Guarded access — an empty threadReplies array here means the
      // assertion above already failed and reported why; indexing [0] on
      // it directly would throw and abort every later assertion in this
      // file instead of just this one.
      const reply = TestGmailLog_.threadReplies[0];
      TestAssertEqual_(reply && reply.threadId, 'thread_seed_1', 'sendOvernightFollowupEmails: threads into the SAME thread_id stored from the morning send');
      TestAssert_(!!(reply && reply.raw), 'sendOvernightFollowupEmails: the threaded reply carries a real base64 MIME payload');

      const replyHtml = TestOE_decodeRawMime_(reply && reply.raw);
      TestAssertContains_(replyHtml, 'Section 1', 'sendOvernightFollowupEmails: reply is explicitly labeled Section 1 (Overnight Follow-up)');
      TestAssertContains_(replyHtml, 'Section 2', 'sendOvernightFollowupEmails: reply is explicitly labeled Section 2 (Checkpoint 2)');
      TestAssertContains_(replyHtml, 'L-CKPT2', 'sendOvernightFollowupEmails: Section 2 lists the Checkpoint 2 lead');
      TestAssertContains_(replyHtml, 'Resolved', 'sendCombinedFollowupEmail_: L-CKPT2 (now Won) shows as Resolved — Checkpoint 2 genuinely re-computed, not just echoing checkpoint1_json');

      const allIssuesAfterFollowup = followupSs._sheets['AllIssues_Log'].getRange(2, 1, 1, 14).getValues()[0];
      TestAssert_(!!allIssuesAfterFollowup[12], 'sendCombinedFollowupEmail_: checkpoint2_json written back to AllIssues_Log (col M)');
      TestAssert_(!!allIssuesAfterFollowup[13], 'sendCombinedFollowupEmail_: checkpoint2_sent_at written back to AllIssues_Log (col N)');
      const checkpoint2Written = JSON.parse(allIssuesAfterFollowup[12]);
      TestAssertEqual_(checkpoint2Written[0].state, 'resolved', 'sendCombinedFollowupEmail_: persisted checkpoint2_json matches what the email itself showed');

      const overnightLogAfterFollowup = followupLogSheet.getRange(2, 1, 1, 9).getValues()[0];
      TestAssert_(!!overnightLogAfterFollowup[8], 'sendCombinedFollowupEmail_: followup_sent_at (col I) written back to Overnight_Log on a successful send');

      // ---- Two-checkpoint email lifecycle redesign (Step 8/11) —
      // idempotency: a second run the SAME day sends NOTHING new for this
      // bucket. Before Step 8, this was a real, confirmed gap — Section 1's
      // own unresolved-lead classification had NO per-day-once guard (a
      // re-run always resent whatever was CURRENTLY still unresolved, and
      // L-UNRESOLVED's fixture never changes state, so a bare re-run of
      // sendOvernightFollowupEmails() used to send ANOTHER reply for this
      // exact bucket). followup_sent_at (written just above) now makes
      // Pass 1 skip this row entirely on a re-run — reconciling with the
      // existing cycle instead of resending. ----
      const repliesBeforeRerun = TestGmailLog_.threadReplies.length;
      sendOvernightFollowupEmails();
      TestAssertEqual_(TestGmailLog_.threadReplies.length, repliesBeforeRerun, 'sendOvernightFollowupEmails: a second run the same day sends nothing new for this bucket — followup_sent_at guard (Step 8/11) skips it entirely, even though L-UNRESOLVED is still genuinely unresolved');
    } finally {
      SpreadsheetApp = realSs1;
    }

    // ---- Two-checkpoint email lifecycle redesign (Step 7/11) — a
    // Section-2-ONLY bucket: an Overnight_Log row with an EMPTY issueLog
    // (exactly the shape sendCombinedMorningEmail_'s own Step 6 fix
    // produces for a bucket with zero overnight leads but real Checkpoint
    // 1 content — see that function's own comment, and the Harbour
    // scenario in the sendOvernightMorningEmails test above), paired with
    // an AllIssues_Log row still awaiting Checkpoint 2. Regression
    // coverage for a real gap this same session found and fixed: Pass 1's
    // ORIGINAL `if (!issueLog.length) return;` skipped pushing this row to
    // `perRegion` entirely, so Pass 2 could never find this bucket's own
    // thread to reply Checkpoint 2 into — silently dropping Checkpoint 2
    // for every Section-2-only bucket. Without that fix this test sends 0
    // threaded replies instead of 1. ----
    const checkpoint2OnlySs = TestMockSpreadsheet_({
      'RM_Hierarchy': TestMockSheet_('RM_Hierarchy', TestFixture_rmHierarchyRows_()),
      'Manager_Directory': TestMockSheet_('Manager_Directory', TestFixture_managerDirectoryRows_()),
    });
    checkpoint2OnlySs._sheets[monthShort] = TestMockSheet_(monthShort, [banner, header,
      TestOE_leadRow_(header, { lead_id: 'L-CKPT3', client_id: 'C-CKPT3', RM: 'Harbour RM', region: 'Harbour', current_stage: 'Not Updated', lead_assigned_at: TestFixture_hoursAgo_(now, 6) }),
    ]);
    const checkpoint2OnlyLogSheet = ensureOvernightLogSheet_(checkpoint2OnlySs);
    checkpoint2OnlyLogSheet.appendRow([istDayKeyGs_(now), 'Harbour', 'thread_harbour_2', '[]',
      Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss'), TEST_EMAIL_SECONDARY_, '', 'Harbour Google Overnight + Follow-up Digest - test']);
    checkpoint2OnlySs._sheets['AllIssues_Log'] = TestMockSheet_('AllIssues_Log', [allIssuesHeaderFollowup,
      [now, 'Harbour', 'Harbour Manager', 'A1', TEST_EMAIL_SECONDARY_, '', 1, now, 'thread_harbour_2',
        JSON.stringify([{ lead_id: 'L-CKPT3', RM: 'Harbour RM', TL: 'Harbour Manager', status: 'Suspect', issueLabel: 'Not Updated', followup: 'x' }]),
        JSON.stringify([{ lead_id: 'L-CKPT3', state: 'still_open', currentIssueLabel: 'Not Updated', currentStatus: 'Suspect' }]),
        Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss'), '', ''],
    ]);

    const realSs1b = SpreadsheetApp;
    SpreadsheetApp = { getActiveSpreadsheet: function () { return checkpoint2OnlySs; }, flush: function () {} };
    try {
      // TestGmailLog_.threadReplies is a GLOBAL log, not reset between
      // scenarios in this file (the followupSs block above already added
      // its own entry) — so this asserts a DELTA of exactly one NEW reply,
      // and finds the actual new one by threadId rather than assuming
      // index 0 or an absolute length.
      const repliesBefore = TestGmailLog_.threadReplies.length;
      sendOvernightFollowupEmails();
      TestAssertEqual_(TestGmailLog_.threadReplies.length, repliesBefore + 1, 'sendOvernightFollowupEmails: a Section-2-only bucket (empty issueLog) still gets its Checkpoint 2 reply sent — was silently dropped before the Pass 1 perRegion fix');
      const reply2 = TestGmailLog_.threadReplies.filter(function (r) { return r.threadId === 'thread_harbour_2'; }).pop();
      TestAssert_(!!reply2, 'sendOvernightFollowupEmails: Section-2-only bucket replies into the SAME thread Overnight_Log stored this morning');
      const reply2Html = TestOE_decodeRawMime_(reply2 && reply2.raw);
      TestAssertContains_(reply2Html, 'Nothing still unresolved from this morning', 'sendCombinedFollowupEmail_: Section 1 shows its own empty-state text — genuinely had nothing, not a fake resolved list');
      TestAssertContains_(reply2Html, 'L-CKPT3', 'sendCombinedFollowupEmail_: Section 2 lists the pending Checkpoint 2 lead');
      TestAssertContains_(reply2Html, 'Still open — Not Updated', 'sendCombinedFollowupEmail_: L-CKPT3 (still flagged, same issue) shows as still_open with its current issue label');

      const allIssuesAfterCkpt2Only = checkpoint2OnlySs._sheets['AllIssues_Log'].getRange(2, 1, 1, 14).getValues()[0];
      TestAssert_(!!allIssuesAfterCkpt2Only[12] && !!allIssuesAfterCkpt2Only[13], 'sendCombinedFollowupEmail_: Section-2-only bucket also gets checkpoint2_json/checkpoint2_sent_at written back');

      const overnightLogAfterCkpt2Only = checkpoint2OnlyLogSheet.getRange(2, 1, 1, 9).getValues()[0];
      TestAssert_(!!overnightLogAfterCkpt2Only[8], 'sendCombinedFollowupEmail_: followup_sent_at (col I) also written back for the Section-2-only bucket');

      // ---- Step 8/11 idempotency: a second run sends nothing new — now
      // driven by followup_sent_at (Overnight_Log), the SAME guard as the
      // other scenario above; checkpoint2_sent_at (AllIssues_Log) is
      // still independently true too, but followup_sent_at alone is
      // enough to skip this row at Pass 1 before Section 2 is even looked
      // up. ----
      const repliesBeforeRerun2 = TestGmailLog_.threadReplies.length;
      sendOvernightFollowupEmails();
      TestAssertEqual_(TestGmailLog_.threadReplies.length, repliesBeforeRerun2, 'sendOvernightFollowupEmails: a second run sends nothing new for the Section-2-only bucket either');
    } finally {
      SpreadsheetApp = realSs1b;
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
      const overnightLogAfterFallback = staleLogSheet.getRange(2, 1, 1, 9).getValues()[0];
      TestAssert_(!!overnightLogAfterFallback[8], 'sendCombinedFollowupEmail_: followup_sent_at IS written when the plain fallback succeeds, even though the threaded reply itself failed — the reply still reached the recipient');
    } finally {
      Gmail = realGmail;
      SpreadsheetApp = realSs2;
    }

    // ---- Step 8/11: a TOTAL failure (both the threaded reply AND the
    // plain fallback fail) must leave followup_sent_at blank, so the next
    // run retries rather than silently giving up forever. ----
    const totalFailSs = TestMockSpreadsheet_({
      'RM_Hierarchy': TestMockSheet_('RM_Hierarchy', TestFixture_rmHierarchyRows_()),
      'Manager_Directory': TestMockSheet_('Manager_Directory', TestFixture_managerDirectoryRows_()),
    });
    totalFailSs._sheets[monthShort] = TestMockSheet_(monthShort, rows.concat([
      TestOE_leadRow_(header, {
        lead_id: 'L-UNRESOLVED3', client_id: 'C-UNRESOLVED3', RM: 'Test RM One', current_stage: 'Suspect', lead_assigned_at: TestFixture_hoursAgo_(now, 20),
        last_connect: 'Connected', last_connect_time: TestFixture_hoursAgo_(now, 10),
        internal_status_comments: 'Test RM One: Ringing - ' + Utilities.formatDate(TestFixture_hoursAgo_(now, 10), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm'),
      }),
    ]));
    const totalFailLogSheet = ensureOvernightLogSheet_(totalFailSs);
    totalFailLogSheet.appendRow([istDayKeyGs_(now), 'Pune', 'thread_seed_totalfail', JSON.stringify([{ lead_id: 'L-UNRESOLVED3', issueKey: 'followupOverdue', issueLabel: 'Follow-up Overdue' }]),
      Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss'), TEST_EMAIL_PRIMARY_, '', 'Pune Google Overnight Leads - test totalfail']);

    const realGmail2 = Gmail;
    const realGmailApp2 = GmailApp;
    Gmail = TestMockGmailAdvanced_({ shouldFail: true });
    GmailApp = TestMockGmailApp_({ failSendCountFor: {} });
    GmailApp.createDraft = function () {
      return { send: function () { throw new Error('simulated total failure — neither threaded nor fallback can send'); } };
    };
    const realSs2b = SpreadsheetApp;
    SpreadsheetApp = { getActiveSpreadsheet: function () { return totalFailSs; }, flush: function () {} };
    try {
      sendOvernightFollowupEmails();
      const overnightLogAfterTotalFail = totalFailLogSheet.getRange(2, 1, 1, 9).getValues()[0];
      TestAssertEqual_(overnightLogAfterTotalFail[8], '', 'sendCombinedFollowupEmail_: followup_sent_at stays BLANK after a total send failure — this bucket must be retried, not permanently marked done');
      TestAssert_(TestGmailLog_.sent.some(function (e) { return /1pm follow-up failed/.test(e.subject); }), 'sendCombinedFollowupEmail_: a total failure fires its own ops alert');
    } finally {
      Gmail = realGmail2;
      GmailApp = realGmailApp2;
    }

    // ---- ...and the NEXT run (Gmail working again) actually retries it,
    // proving the blank followup_sent_at genuinely re-enables a resend
    // rather than just being cosmetically blank. ----
    SpreadsheetApp = { getActiveSpreadsheet: function () { return totalFailSs; }, flush: function () {} };
    try {
      const repliesBeforeRetry = TestGmailLog_.threadReplies.length;
      sendOvernightFollowupEmails();
      TestAssertEqual_(TestGmailLog_.threadReplies.length, repliesBeforeRetry + 1, 'sendOvernightFollowupEmails: the bucket that totally failed IS retried and sends successfully once Gmail is working again');
      const overnightLogAfterRetry = totalFailLogSheet.getRange(2, 1, 1, 9).getValues()[0];
      TestAssert_(!!overnightLogAfterRetry[8], 'sendCombinedFollowupEmail_: followup_sent_at is now written after the successful retry');
    } finally {
      SpreadsheetApp = realSs2b;
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

    // LEADFOLLOWUPS-003 (2026-09-09): waitForFollowupSuggestions_ now
    // returns { suggestion, updatedAt }, not a bare string — see its own
    // header comment for why (a human suggestion can be arbitrarily old,
    // since pushUnresolvedToLeadFollowups_ never clears the tab).
    const suggestions = waitForFollowupSuggestions_(lfSs, ['L-NEW']);
    TestAssertEqual_(suggestions['L-NEW'].suggestion, 'Human-written suggestion', 'waitForFollowupSuggestions_: reads back a suggestion that is already present, on the first poll');
    // The mock's Utilities.formatDate returns a plain string (unlike a
    // real sheet, which auto-parses a date-shaped string into a real
    // Date cell on write — see LeadFollowupsStaleness.gs's own header for
    // that confirmed behavior) — pushUnresolvedToLeadFollowups_'s own
    // upsert above wrote G through the mock the same way, so it reads
    // back here as a plain string too. Confirms the degrade path is
    // graceful (null, not a crash) when a cell isn't a real Date, exactly
    // like the mock's own honest gap, not a bug in this function.
    TestAssertEqual_(suggestions['L-NEW'].updatedAt, null, 'waitForFollowupSuggestions_: updatedAt is null (not a crash) when the mock has not simulated Sheets\' own string-to-Date auto-conversion for that cell');

    // Now with a REAL Date in column G (simulating what a genuine sheet
    // would already have auto-converted the write-side string into).
    lfSheet.getRange(2, 7, 1, 1).setValues([[new Date('2026-09-08T18:34:00+05:30')]]);
    const withRealDate = waitForFollowupSuggestions_(lfSs, ['L-NEW']);
    TestAssert_(withRealDate['L-NEW'].updatedAt instanceof Date, 'waitForFollowupSuggestions_: updatedAt comes back as a real Date when the cell actually is one');
    TestAssertEqual_(withRealDate['L-NEW'].updatedAt.getTime(), new Date('2026-09-08T18:34:00+05:30').getTime(), 'waitForFollowupSuggestions_: updatedAt carries the exact timestamp through, not a re-derived one');

    // lfSs's Lead_Followups still has L-NEW's own real suggestion from
    // the earlier upsert test — waitForFollowupSuggestions_ legitimately
    // returns the WHOLE sheet's current lookup, not filtered down to just
    // the requested leadIds, so the right check is that the REQUESTED
    // (never-answered) id specifically never gets an entry — not that the
    // returned object is empty overall.
    const neverAnswered = waitForFollowupSuggestions_(lfSs, ['L-NOT-THERE-AT-ALL']);
    TestAssertEqual_(neverAnswered['L-NOT-THERE-AT-ALL'], undefined, 'waitForFollowupSuggestions_: gives up after FOLLOWUP_WAIT_MAX_ATTEMPTS_ polls rather than hanging when a lead never gets a suggestion filled in (sleep is mocked to a no-op, so this completes instantly)');

    // ---- formatFollowupAgeGs_: pure (LEADFOLLOWUPS-003, 2026-09-09) ----
    const ageNow = new Date('2026-09-09T09:00:00+05:30');
    TestAssertEqual_(formatFollowupAgeGs_(new Date('2026-09-09T08:45:00+05:30'), ageNow), ' (typed <1h ago)', 'formatFollowupAgeGs_: under 1h reads as "<1h ago", not "0h ago"');
    TestAssertEqual_(formatFollowupAgeGs_(new Date('2026-09-09T06:00:00+05:30'), ageNow), ' (typed 3h ago)', 'formatFollowupAgeGs_: a same-day age rounds to whole hours');
    TestAssertEqual_(formatFollowupAgeGs_(new Date('2026-09-08T14:34:00+05:30'), ageNow), ' (typed 18h ago)', 'formatFollowupAgeGs_: an under-48h age still reads in hours, not days (the real incident\'s own ~19h case)');
    TestAssertEqual_(formatFollowupAgeGs_(new Date('2026-09-06T09:00:00+05:30'), ageNow), ' (typed 3d ago)', 'formatFollowupAgeGs_: 48h or more switches to whole days');
    TestAssertEqual_(formatFollowupAgeGs_(new Date('2026-09-09T09:05:00+05:30'), ageNow), '', 'formatFollowupAgeGs_: a future timestamp (clock skew/bad data) renders no caption rather than a negative age');
    TestAssertEqual_(formatFollowupAgeGs_(null, ageNow), '', 'formatFollowupAgeGs_: no Date at all renders no caption');
    TestAssertEqual_(formatFollowupAgeGs_('2026-09-08 18:34:00', ageNow), '', 'formatFollowupAgeGs_: an unconverted string (not a real Date) renders no caption rather than throwing');

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
