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
    TestAssertEqual_(healedSheet.getLastColumn(), 10, 'ensureOvernightLogSheet_: heals an existing 8-column sheet up to 10 columns (followup_sent_at, then followup_result)');
    TestAssertContains_(healedSheet.getRange(1, 1, 1, 10).getValues()[0].join(','), 'followup_sent_at', 'ensureOvernightLogSheet_: the healed header includes followup_sent_at, appended at the end');
    TestAssertEqual_(healedSheet.getRange(1, 10, 1, 1).getValues()[0][0], 'followup_result', 'ensureOvernightLogSheet_: followup_result (email audit P9) is the LAST column — appended, never inserted, so existing rows stay aligned');
    // Idempotent: healing an already-healed sheet is a no-op, not a
    // second append that would duplicate the column.
    ensureOvernightLogSheet_(legacySs);
    TestAssertEqual_(legacySs.getSheetByName(OVERNIGHT_LOG_SHEET_).getLastColumn(), 10, 'ensureOvernightLogSheet_: healing an already-10-column sheet does not append a duplicate column');
    // The live sheet today has 9 columns (it predates followup_result): one column is appended, existing data stays put.
    const nineColSs = TestMockSpreadsheet_({});
    const nineColSheet = nineColSs.insertSheet(OVERNIGHT_LOG_SHEET_);
    nineColSheet.getRange(1, 1, 1, 9).setValues([['date', 'region', 'thread_id', 'lead_ids_json', 'sent_at', 'to', 'cc', 'subject', 'followup_sent_at']]);
    nineColSheet.appendRow(['2026-10-04', 'Pune', 'thr-old', '[]', '2026-10-04 10:05:00', TEST_EMAIL_PRIMARY_, '', 'old subject', '2026-10-04 13:05:00']);
    ensureOvernightLogSheet_(nineColSs);
    TestAssertEqual_(nineColSheet.getLastColumn(), 10, 'ensureOvernightLogSheet_: the live 9-column sheet gains exactly one column (followup_result)');
    TestAssertEqual_(nineColSheet.getRange(2, 9, 1, 1).getValues()[0][0], '2026-10-04 13:05:00', 'ensureOvernightLogSheet_: an existing row\'s followup_sent_at stays in column I after the heal');

    // ---- sendOvernightMorningEmails: end to end ----
    sendOvernightMorningEmails();

    TestAssertEqual_(TestGmailLog_.drafts.length, 2, 'sendOvernightMorningEmails: sends exactly 2 emails — 1 normal A1 bucket + 1 CH-level report');
    const normalDraft = TestGmailLog_.drafts.find(function (d) { return d.to === TEST_EMAIL_PRIMARY_; });
    const chDraft = TestGmailLog_.drafts.find(function (d) { return d.to.indexOf(TEST_EMAIL_CH_) !== -1; });
    TestAssert_(!!normalDraft, 'sendOvernightMorningEmails: the normal per-A1 bucket email went to the A1\'s own address');
    TestAssert_(!!chDraft, 'sendOvernightMorningEmails: the CH-level report went to ops+CH addresses');

    // Lead IDs are in the HTML body's per-lead table AND (since the 2026-10-05 email audit P2) in the plain-text part too — it
    // used to be a one-line count stub, so a text-only client or preview saw an email with no leads in it.
    TestAssertContains_(normalDraft.body, 'L-A', 'sendOvernightMorningEmails: the PLAIN-text part lists lead A too (not a count-only stub)');
    TestAssertContains_(normalDraft.body, 'L-B', 'sendOvernightMorningEmails: the PLAIN-text part lists lead B too');
    TestAssertContains_(normalDraft.body, 'L-DUP-2', 'sendOvernightMorningEmails: the PLAIN-text part lists the surviving duplicate copy too');
    TestAssert_(normalDraft.body.indexOf('L-DUP-1') === -1 && normalDraft.body.indexOf('L-CH') === -1, 'sendOvernightMorningEmails: the plain-text part, like the HTML, omits the discarded copy and the CH-held lead');
    TestAssertContains_(chDraft.body, 'L-CH', 'sendOvernightMorningEmails: the CH-level report\'s plain-text part lists the CH-held lead');
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
    // "no overnight leads" empty-state path instead).
    //
    // 2026-09-26 ("no need to send email for resolved status"): a resolved
    // lead is NEVER listed, and a bucket whose every checkpoint lead is
    // resolved gets no email at all. So Pune's snapshot carries TWO
    // leads — L-CKPT-PUNE (still open -> listed) and L-PUNE-RESOLVED
    // (closed -> must not appear) — and a THIRD row (a second Pune
    // recipient) carries only a closed lead, proving the no-email path
    // while its checkpoint state is still recorded. ----
    const allIssuesHeader = ['date', 'region', 'bucket_label', 'primary_role', 'to', 'cc', 'lead_count', 'sent_at', 'thread_id',
      'issue_snapshot_json', 'checkpoint1_json', 'checkpoint1_sent_at', 'checkpoint2_json', 'checkpoint2_sent_at'];
    const yesterday = TestFixture_daysAgo_(now, 1);
    const allIssuesRows = [allIssuesHeader,
      [yesterday, 'Pune', 'Test A1 One', 'A1', TEST_EMAIL_PRIMARY_, '', 2, yesterday, 'thread-pune',
        JSON.stringify([
          { lead_id: 'L-CKPT-PUNE', RM: 'Test RM One', TL: 'Test A1 One', status: 'Suspect', issueLabel: 'Not Updated', followup: 'x' },
          { lead_id: 'L-PUNE-RESOLVED', RM: 'Test RM One', TL: 'Test A1 One', status: 'Suspect', issueLabel: 'Follow-up Overdue', followup: 'x' },
        ]),
        '', '', '', ''],
      [yesterday, 'Harbour', 'Harbour Manager', 'A1', TEST_EMAIL_SECONDARY_, '', 1, yesterday, 'thread-harbour',
        JSON.stringify([{ lead_id: 'L-CKPT-HARBOUR', RM: 'Harbour RM', TL: 'Harbour Manager', status: 'Suspect', issueLabel: 'Not Updated', followup: 'x' }]),
        '', '', '', ''],
      [yesterday, 'Pune', 'Test CH Self', 'A1', TEST_EMAIL_CH_, '', 1, yesterday, 'thread-pune-alldone',
        JSON.stringify([{ lead_id: 'L-ALLDONE', RM: 'Test RM Two', TL: 'Test CH Self', status: 'Suspect', issueLabel: 'Follow-up Overdue', followup: 'x' }]),
        '', '', '', ''],
    ];
    ss._sheets['AllIssues_Log'] = TestMockSheet_('AllIssues_Log', allIssuesRows);

    // Checkpoint leads' CURRENT state, appended directly to the SAME
    // leads tab already in use — L-PUNE-RESOLVED and L-ALLDONE closed
    // (-> resolved), L-CKPT-PUNE / L-CKPT-HARBOUR still open with the
    // literal 'Not Updated' stage text (-> still_open; deliberately NOT
    // relying on the never-connected-past-10-minutes business-hours-gated
    // path, which Tests_SlaEngine.gs already covers with a fixed clock —
    // this file uses the real wall clock, so only a time-of-day-independent
    // trigger belongs in a fixture here).
    ss._sheets[monthShort].appendRow(TestOE_leadRow_(header, { lead_id: 'L-CKPT-PUNE', client_id: 'C-CKPT-PUNE', RM: 'Test RM One', current_stage: 'Not Updated', lead_assigned_at: TestFixture_hoursAgo_(now, 5) }));
    ss._sheets[monthShort].appendRow(TestOE_leadRow_(header, { lead_id: 'L-PUNE-RESOLVED', client_id: 'C-PUNE-RESOLVED', RM: 'Test RM One', current_stage: 'Won', lead_assigned_at: TestFixture_hoursAgo_(now, 60) }));
    ss._sheets[monthShort].appendRow(TestOE_leadRow_(header, { lead_id: 'L-ALLDONE', client_id: 'C-ALLDONE', RM: 'Test RM Two', current_stage: 'Won', lead_assigned_at: TestFixture_hoursAgo_(now, 60) }));
    ss._sheets[monthShort].appendRow(TestOE_leadRow_(header, { lead_id: 'L-CKPT-HARBOUR', client_id: 'C-CKPT-HARBOUR', RM: 'Harbour RM', current_stage: 'Not Updated', lead_assigned_at: TestFixture_hoursAgo_(now, 5) }));

    sendOvernightMorningEmails();
    TestAssertEqual_(TestGmailLog_.drafts.length, 4, 'sendOvernightMorningEmails: 2 new combined emails this run — Pune (Section 2 only) and Harbour (Section 2 only); the all-resolved third bucket sends NOTHING');
    TestAssert_(TestGmailLog_.drafts.slice(2).every(function (d) { return d.to === TEST_EMAIL_PRIMARY_ || d.to === TEST_EMAIL_SECONDARY_; }), 'sendOvernightMorningEmails: this run\'s new drafts went only to Pune\'s and Harbour\'s recipients — the bucket whose every Checkpoint 1 lead is resolved got no email (2026-09-26)');

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
    TestAssertContains_(puneCombined.htmlBody, 'L-CKPT-PUNE', 'sendCombinedMorningEmail_: Pune Section 2 lists the still-unresolved checkpoint lead');
    TestAssertContains_(puneCombined.htmlBody, 'Still open — Not Updated', 'sendCombinedMorningEmail_: L-CKPT-PUNE (still flagged, same issue) shows as still_open with its current issue label');
    TestAssert_(puneCombined.htmlBody.indexOf('L-PUNE-RESOLVED') === -1, 'sendCombinedMorningEmail_: L-PUNE-RESOLVED (now closed) is NEVER listed — a resolved lead is not emailed (2026-09-26)');
    TestAssertContains_(puneCombined.htmlBody, 'Lead Still Unresolved', 'sendCombinedMorningEmail_: Section 2 headline counts only the still-unresolved lead (1), not the resolved one');

    TestAssertContains_(harbourCombined.htmlBody, 'No overnight leads for your team today', 'sendCombinedMorningEmail_: Harbour Section 1 shows the plain "no leads" text, NOT the "already sent" text — it genuinely had none, was never sent separately');
    TestAssertContains_(harbourCombined.htmlBody, 'L-CKPT-HARBOUR', 'sendCombinedMorningEmail_: Harbour Section 2 lists its checkpoint lead');
    TestAssertContains_(harbourCombined.htmlBody, 'Still open — Not Updated', 'sendCombinedMorningEmail_: L-CKPT-HARBOUR (still flagged, same issue) shows as still_open with its current issue label');

    // ---- checkpoint1_json/checkpoint1_sent_at written back to the
    // EXACT AllIssues_Log rows the snapshots came from ----
    const allIssuesLogAfter = ss._sheets['AllIssues_Log'].getRange(2, 1, 3, 14).getValues();
    const puneRow = allIssuesLogAfter[0];
    const harbourRow = allIssuesLogAfter[1];
    const allDoneRow = allIssuesLogAfter[2];
    TestAssert_(!!puneRow[10], 'AllIssues_Log: Pune row gets a checkpoint1_json value written back (col K)');
    TestAssert_(!!puneRow[11], 'AllIssues_Log: Pune row gets a checkpoint1_sent_at timestamp written back (col L)');
    const puneCheckpoint1 = JSON.parse(puneRow[10]);
    const puneCheckpoint1ById = {};
    puneCheckpoint1.forEach(function (r) { puneCheckpoint1ById[r.lead_id] = r; });
    TestAssertEqual_(puneCheckpoint1ById['L-CKPT-PUNE'].state, 'still_open', 'AllIssues_Log: Pune row\'s persisted checkpoint1_json records the still-open lead');
    TestAssertEqual_(puneCheckpoint1ById['L-PUNE-RESOLVED'].state, 'resolved', 'AllIssues_Log: the persisted checkpoint1_json still RECORDS the resolved lead — it is only kept out of the email, not out of the state Checkpoint 2 reads');
    TestAssert_(!!harbourRow[10] && !!harbourRow[11], 'AllIssues_Log: Harbour row ALSO gets checkpoint1_json/checkpoint1_sent_at written back');
    TestAssert_(!!allDoneRow[10] && !!allDoneRow[11], 'AllIssues_Log: the all-resolved bucket\'s row STILL gets checkpoint1_json/checkpoint1_sent_at written even though no email was sent — otherwise it would be retried (and re-checked) on every later run');
    TestAssertEqual_(JSON.parse(allDoneRow[10])[0].state, 'resolved', 'AllIssues_Log: the all-resolved bucket\'s persisted checkpoint records the lead as resolved');

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
    TestAssertEqual_(overnightLogAfterCombined.filter(function (r) { return r[4] === TEST_EMAIL_CH_ || r[5] === TEST_EMAIL_CH_; }).length, 0, 'sendCombinedMorningEmail_: the all-resolved bucket (no email sent) writes NO Overnight_Log row — nothing was sent, so there is no thread for 13:00 to reply into');

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
    // its CURRENT leads-tab stage ('Not Updated', added below) keeps
    // Checkpoint 2 at 'still_open' — so it is listed, proving Checkpoint 2
    // is genuinely RE-computed here, not just echoing checkpoint1_json back.
    //
    // 2026-09-26 ("no need to send email for resolved status"): the
    // snapshot ALSO carries L-C2-CLOSED, whose current stage is 'Won'
    // (-> resolved) — it must NOT be listed, though Checkpoint 2 still
    // records it in checkpoint2_json.
    const allIssuesHeaderFollowup = ['date', 'region', 'bucket_label', 'primary_role', 'to', 'cc', 'lead_count', 'sent_at', 'thread_id',
      'issue_snapshot_json', 'checkpoint1_json', 'checkpoint1_sent_at', 'checkpoint2_json', 'checkpoint2_sent_at'];
    const todayTs = Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss');
    followupSs._sheets['AllIssues_Log'] = TestMockSheet_('AllIssues_Log', [allIssuesHeaderFollowup,
      [now, 'Pune', 'Test A1 One', 'A1', TEST_EMAIL_PRIMARY_, '', 2, now, 'thread_seed_1',
        JSON.stringify([
          { lead_id: 'L-CKPT2', RM: 'Test RM One', TL: 'Test A1 One', status: 'Suspect', issueLabel: 'Not Updated', followup: 'x' },
          { lead_id: 'L-C2-CLOSED', RM: 'Test RM One', TL: 'Test A1 One', status: 'Suspect', issueLabel: 'Not Updated', followup: 'x' },
        ]),
        JSON.stringify([
          { lead_id: 'L-CKPT2', state: 'still_open', currentIssueLabel: 'Not Updated', currentStatus: 'Suspect' },
          { lead_id: 'L-C2-CLOSED', state: 'still_open', currentIssueLabel: 'Not Updated', currentStatus: 'Suspect' },
        ]),
        todayTs, '', ''],
    ]);
    followupSs._sheets[monthShort].appendRow(TestOE_leadRow_(header, { lead_id: 'L-CKPT2', client_id: 'C-CKPT2', RM: 'Test RM One', current_stage: 'Not Updated', lead_assigned_at: TestFixture_hoursAgo_(now, 5) }));
    followupSs._sheets[monthShort].appendRow(TestOE_leadRow_(header, { lead_id: 'L-C2-CLOSED', client_id: 'C-C2-CLOSED', RM: 'Test RM One', current_stage: 'Won', lead_assigned_at: TestFixture_hoursAgo_(now, 40) }));

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
      TestAssertContains_(replyHtml, 'Still open — Not Updated', 'sendCombinedFollowupEmail_: L-CKPT2 (still flagged) shows as still_open — Checkpoint 2 genuinely re-computed, not just echoing checkpoint1_json');
      TestAssert_(replyHtml.indexOf('L-C2-CLOSED') === -1, 'sendCombinedFollowupEmail_: L-C2-CLOSED (now Won) is NEVER listed — a resolved lead is not emailed (2026-09-26)');

      const allIssuesAfterFollowup = followupSs._sheets['AllIssues_Log'].getRange(2, 1, 1, 14).getValues()[0];
      TestAssert_(!!allIssuesAfterFollowup[12], 'sendCombinedFollowupEmail_: checkpoint2_json written back to AllIssues_Log (col M)');
      TestAssert_(!!allIssuesAfterFollowup[13], 'sendCombinedFollowupEmail_: checkpoint2_sent_at written back to AllIssues_Log (col N)');
      const checkpoint2Written = JSON.parse(allIssuesAfterFollowup[12]);
      TestAssertEqual_(checkpoint2Written.length, 1, 'sendCombinedFollowupEmail_: persisted checkpoint2_json holds exactly what the email showed — only the still-unresolved lead');
      TestAssertEqual_(checkpoint2Written[0].lead_id, 'L-CKPT2', 'sendCombinedFollowupEmail_: persisted checkpoint2_json is the still-unresolved lead');
      TestAssertEqual_(checkpoint2Written[0].state, 'still_open', 'sendCombinedFollowupEmail_: persisted checkpoint2_json state matches what the email itself showed');

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

    // ---- 2026-09-26 ("no need to send email for resolved status"): a
    // Section-2-only bucket whose ONLY checkpoint lead has since closed
    // (current stage 'Won') has nothing left to say — NO reply at all.
    // Checkpoint 2 is still recorded (so the row is never re-processed),
    // but followup_sent_at stays blank: nothing was sent. Also covers the
    // moment-of-resolution case: the lead was still_open at Checkpoint 1
    // and resolved by 13:00 — that is exactly the "resolved" email the
    // user asked to stop sending. ----
    const allResolvedSs = TestMockSpreadsheet_({
      'RM_Hierarchy': TestMockSheet_('RM_Hierarchy', TestFixture_rmHierarchyRows_()),
      'Manager_Directory': TestMockSheet_('Manager_Directory', TestFixture_managerDirectoryRows_()),
    });
    allResolvedSs._sheets[monthShort] = TestMockSheet_(monthShort, [banner, header,
      TestOE_leadRow_(header, { lead_id: 'L-C2-ALLDONE', client_id: 'C-C2-ALLDONE', RM: 'Harbour RM', region: 'Harbour', current_stage: 'Won', lead_assigned_at: TestFixture_hoursAgo_(now, 30) }),
    ]);
    const allResolvedLogSheet = ensureOvernightLogSheet_(allResolvedSs);
    allResolvedLogSheet.appendRow([istDayKeyGs_(now), 'Harbour', 'thread_harbour_alldone', '[]',
      Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss'), TEST_EMAIL_SECONDARY_, '', 'Harbour Google Overnight + Follow-up Digest - test']);
    allResolvedSs._sheets['AllIssues_Log'] = TestMockSheet_('AllIssues_Log', [allIssuesHeaderFollowup,
      [now, 'Harbour', 'Harbour Manager', 'A1', TEST_EMAIL_SECONDARY_, '', 1, now, 'thread_harbour_alldone',
        JSON.stringify([{ lead_id: 'L-C2-ALLDONE', RM: 'Harbour RM', TL: 'Harbour Manager', status: 'Suspect', issueLabel: 'Not Updated', followup: 'x' }]),
        JSON.stringify([{ lead_id: 'L-C2-ALLDONE', state: 'still_open', currentIssueLabel: 'Not Updated', currentStatus: 'Suspect' }]),
        Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss'), '', ''],
    ]);

    const realSs1c = SpreadsheetApp;
    SpreadsheetApp = { getActiveSpreadsheet: function () { return allResolvedSs; }, flush: function () {} };
    try {
      const repliesBeforeAllResolved = TestGmailLog_.threadReplies.length;
      const draftsBeforeAllResolved = TestGmailLog_.drafts.length;
      sendOvernightFollowupEmails();
      TestAssertEqual_(TestGmailLog_.threadReplies.length, repliesBeforeAllResolved, 'sendOvernightFollowupEmails: a bucket with nothing still unresolved in EITHER section sends NO reply (2026-09-26)');
      TestAssertEqual_(TestGmailLog_.drafts.length, draftsBeforeAllResolved, 'sendOvernightFollowupEmails: ...and no plain-fallback message either');

      const allIssuesAfterAllResolved = allResolvedSs._sheets['AllIssues_Log'].getRange(2, 1, 1, 14).getValues()[0];
      TestAssert_(!!allIssuesAfterAllResolved[12] && !!allIssuesAfterAllResolved[13], 'sendCombinedFollowupEmail_: checkpoint2_json/checkpoint2_sent_at are STILL written when no reply was needed — otherwise the row would be re-checked on every later run');
      TestAssertEqual_(JSON.parse(allIssuesAfterAllResolved[12]).length, 0, 'sendCombinedFollowupEmail_: the persisted Checkpoint 2 is empty — the resolved lead is not carried as an email-worthy result');
      TestAssert_(!allResolvedLogSheet.getRange(2, 1, 1, 9).getValues()[0][8], 'sendCombinedFollowupEmail_: followup_sent_at stays BLANK when nothing was sent — it records a send, not a check');

      // Idempotent: a re-run finds Checkpoint 2 already recorded and does nothing.
      sendOvernightFollowupEmails();
      TestAssertEqual_(TestGmailLog_.threadReplies.length, repliesBeforeAllResolved, 'sendOvernightFollowupEmails: a re-run after an all-resolved skip still sends nothing');
    } finally {
      SpreadsheetApp = realSs1c;
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

    // ---- Step 9/11: a log/checkpoint WRITE failure (e.g. an oversized
    // JSON cell past Sheets' ~50,000-char limit, or any other Sheets
    // error) must degrade gracefully, not crash the whole send — the
    // email/reply has ALREADY gone out by the time these writes happen,
    // so losing the write-back is a tracking gap, never a lost send, and
    // must never propagate up to abort the caller's per-bucket loop for
    // every OTHER bucket still left that run. Direct calls to
    // sendCombinedMorningEmail_/sendCombinedFollowupEmail_ (not through
    // the full orchestrators) — isolates the write-failure behavior
    // without needing a second full multi-bucket scenario. ----
    {
      const writeFailSs = TestMockSpreadsheet_({});
      const writeFailOvernightLog = ensureOvernightLogSheet_(writeFailSs);
      writeFailOvernightLog.appendRow = function () { throw new Error('simulated: value exceeds the maximum number of characters allowed (50000)'); };
      const dummyAllIssuesLog = TestMockSheet_('AllIssues_Log', [['date', 'region', 'bucket_label', 'primary_role', 'to', 'cc', 'lead_count', 'sent_at', 'thread_id', 'issue_snapshot_json', 'checkpoint1_json', 'checkpoint1_sent_at', 'checkpoint2_json', 'checkpoint2_sent_at']]);
      const section1ForWriteFail = {
        rec: { to: TEST_EMAIL_PRIMARY_, cc: '', bucketLabel: 'Test A1 One', primaryRole: 'A1' },
        leads: [{ lead_id: 'L-WRITEFAIL', RM: 'Test RM One', TL: 'Test A1 One', status: 'Suspect', followup: 'call now', issue: null }],
      };
      const draftsBeforeWriteFail = TestGmailLog_.drafts.length;
      let threwOnWriteFail = false;
      try {
        sendCombinedMorningEmail_(writeFailSs, writeFailOvernightLog, dummyAllIssuesLog, 'Pune', section1ForWriteFail, null, 'test date', istDayKeyGs_(now), now, win, {}, null);
      } catch (e) {
        threwOnWriteFail = true;
      }
      TestAssert_(!threwOnWriteFail, 'sendCombinedMorningEmail_: a throwing Overnight_Log.appendRow does NOT propagate out — the caller\'s per-bucket loop must be able to continue to the next bucket');
      TestAssertEqual_(TestGmailLog_.drafts.length, draftsBeforeWriteFail + 1, 'sendCombinedMorningEmail_: the email itself still sent successfully despite the log write failing afterward');
      TestAssertEqual_(writeFailOvernightLog.getLastRow(), 1, 'sendCombinedMorningEmail_: Overnight_Log correctly has NO new row — the write genuinely failed, this is a real (logged) degradation, not silently faked success');
    }

    {
      const writeFail2Ss = TestMockSpreadsheet_({});
      const writeFail2OvernightLog = ensureOvernightLogSheet_(writeFail2Ss);
      writeFail2OvernightLog.appendRow([istDayKeyGs_(now), 'Pune', 'thread_writefail2', JSON.stringify([{ lead_id: 'L-WRITEFAIL2', issueKey: 'followupOverdue', issueLabel: 'Follow-up Overdue' }]),
        Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss'), TEST_EMAIL_PRIMARY_, '', 'Pune Google Overnight Leads - test writefail2']);
      // Break ONLY the followup_sent_at write (col I, row 2) by overriding
      // getRange for that exact call shape — leaves the rest of the sheet
      // (including the row this test seeded above) fully functional, so
      // the test isolates just this one write path.
      const realGetRange = writeFail2OvernightLog.getRange;
      writeFail2OvernightLog.getRange = function (row, col, numRows, numCols) {
        if (row === 2 && col === 9) { throw new Error('simulated: Sheets write error'); }
        return realGetRange.call(writeFail2OvernightLog, row, col, numRows, numCols);
      };
      const dummyAllIssuesLog2 = TestMockSheet_('AllIssues_Log', [['date', 'region', 'bucket_label', 'primary_role', 'to', 'cc', 'lead_count', 'sent_at', 'thread_id', 'issue_snapshot_json', 'checkpoint1_json', 'checkpoint1_sent_at', 'checkpoint2_json', 'checkpoint2_sent_at']]);
      const unresolvedForWriteFail2 = [{ lead_id: 'L-WRITEFAIL2', RM: 'Test RM One', detail: 'Still: Follow-up Overdue', suggestion: 'call now' }];
      const repliesBeforeWriteFail2 = TestGmailLog_.threadReplies.length;
      let threwOnWriteFail2 = false;
      try {
        sendCombinedFollowupEmail_(writeFail2Ss, writeFail2OvernightLog, 2, dummyAllIssuesLog2, 'Pune', 'thread_writefail2', TEST_EMAIL_PRIMARY_, '', 'Re: test writefail2', null, unresolvedForWriteFail2, null, now, {});
      } catch (e) {
        threwOnWriteFail2 = true;
      }
      TestAssert_(!threwOnWriteFail2, 'sendCombinedFollowupEmail_: a throwing followup_sent_at write does NOT propagate out — the caller\'s per-bucket loop must be able to continue');
      TestAssertEqual_(TestGmailLog_.threadReplies.length, repliesBeforeWriteFail2 + 1, 'sendCombinedFollowupEmail_: the reply itself still sent successfully despite the followup_sent_at write failing afterward');
    }

    TestAssertOnlyTestEmails_();

    // ======================================================================================================
    // 2026-10-05 email audit P1 (docs/_planning/EMAIL_AUDIT.md F3/F4/F14): the send-safety gate at every send site.
    // ======================================================================================================
    const P1_allIssuesHeader = ['date', 'region', 'bucket_label', 'primary_role', 'to', 'cc', 'lead_count', 'sent_at', 'thread_id',
      'issue_snapshot_json', 'checkpoint1_json', 'checkpoint1_sent_at', 'checkpoint2_json', 'checkpoint2_sent_at'];
    const P1_yesterday = TestFixture_daysAgo_(now, 1);
    const P1_stamp = Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss');
    // A connected, under-48h lead whose last comment is 10h old -> flagged "Follow-up Overdue" right now.
    const P1_flaggedLead = function (id, rm) {
      return TestOE_leadRow_(header, {
        lead_id: id, client_id: 'C-' + id, RM: rm || 'Test RM One', current_stage: 'Suspect', lead_assigned_at: TestFixture_hoursAgo_(now, 20),
        last_connect: 'Connected', last_connect_time: TestFixture_hoursAgo_(now, 10),
        internal_status_comments: (rm || 'Test RM One') + ': Ringing - ' + Utilities.formatDate(TestFixture_hoursAgo_(now, 10), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm'),
      });
    };
    const P1_snapshot = function (id) {
      return JSON.stringify([{ lead_id: id, RM: 'Test RM One', TL: 'Test A1 One', status: 'Suspect', issueLabel: 'Follow-up Overdue', followup: 'x' }]);
    };
    const P1_checkpoint1 = function (id) {
      return JSON.stringify([{ lead_id: id, state: 'still_open', currentIssueLabel: 'Follow-up Overdue', currentStatus: 'Suspect' }]);
    };
    const P1_newSs = function (leadRows) {
      const s = TestMockSpreadsheet_({
        'RM_Hierarchy': TestMockSheet_('RM_Hierarchy', TestFixture_rmHierarchyRows_()),
        'Manager_Directory': TestMockSheet_('Manager_Directory', TestFixture_managerDirectoryRows_()),
      });
      s._sheets[monthShort] = TestMockSheet_(monthShort, [banner, header].concat(leadRows));
      return s;
    };
    const P1_withSs = function (s, fn) {
      const real = SpreadsheetApp;
      SpreadsheetApp = { getActiveSpreadsheet: function () { return s; }, flush: function () {} };
      try { fn(); } finally { SpreadsheetApp = real; }
    };

    // ---- notifyChLevelLeadsGs_: no leads -> no email (it used to send an empty "0 Leads Assigned" report) ----
    {
      const chRms = [{ rmName: 'Test CH Self', chName: 'Test CH Self', chEmail: TEST_EMAIL_CH_, chRole: 'Leadership' }];
      const before = TestGmailLog_.drafts.length, sentBefore = TestGmailLog_.sent.length;
      notifyChLevelLeadsGs_('Pune', chRms, {}, 'test date');
      TestAssertEqual_(TestGmailLog_.drafts.length, before, 'notifyChLevelLeadsGs_: a CH-level entry with NO leads sends nothing — never an empty "0 Leads Assigned" report');
      TestAssertEqual_(TestGmailLog_.sent.length, sentBefore, 'notifyChLevelLeadsGs_: …and skips silently (the first-line empty check, not the safety gate\'s "blocked" alert)');
      // The 10:00 run earlier in this file already sent today's Pune / Test CH Self report (email audit P10 records that), so this
      // call needs a fresh record to be the "first report of the day".
      PropertiesService = TestMockPropertiesService_();
      notifyChLevelLeadsGs_('Pune', chRms, { 'Test CH Self': [{ lead_id: 'L-CHX', RM: 'Test CH Self', TL: '', status: 'Suspect', followup: 'call now' }] }, 'test date');
      TestAssertEqual_(TestGmailLog_.drafts.length, before + 1, 'notifyChLevelLeadsGs_: with a lead, it sends exactly one report');
      TestAssertContains_(TestGmailLog_.drafts[TestGmailLog_.drafts.length - 1].htmlBody, 'L-CHX', 'notifyChLevelLeadsGs_: the lead is in the HTML body');
    }

    // ---- sendCombinedMorningEmail_: an empty-but-present Section 1 with no Checkpoint 1 sends nothing ----
    // (The old rule tested `!section1`, so an empty Section 1 OBJECT counted as "has overnight content" and a header-only
    // email would have gone out.)
    {
      const ssM = P1_newSs([]);
      const ovLogM = ensureOvernightLogSheet_(ssM);
      const aiLogM = TestMockSheet_('AllIssues_Log', [P1_allIssuesHeader]);
      const emptySection1 = { rec: { to: TEST_EMAIL_PRIMARY_, cc: '', bucketLabel: 'Test A1 One', primaryRole: 'A1' }, leads: [] };
      const before = TestGmailLog_.drafts.length;
      const r = sendCombinedMorningEmail_(ssM, ovLogM, aiLogM, 'Pune', emptySection1, null, 'test date', istDayKeyGs_(now), now, win, {}, null);
      TestAssertEqual_(r, null, 'sendCombinedMorningEmail_: an empty Section 1 and no Checkpoint 1 returns null (not a failure)');
      TestAssertEqual_(TestGmailLog_.drafts.length, before, 'sendCombinedMorningEmail_: an EMPTY Section 1 object with no Checkpoint 1 sends NO email — no header-only digest');
      TestAssertEqual_(ovLogM.getLastRow(), 1, 'sendCombinedMorningEmail_: …and writes no Overnight_Log row');
    }

    // ---- sendCombinedMorningEmail_: bad recipients never reach the provider ----
    ['', 'not-an-email'].forEach(function (badTo) {
      const ssB = P1_newSs([]);
      const ovLogB = ensureOvernightLogSheet_(ssB);
      const aiLogB = TestMockSheet_('AllIssues_Log', [P1_allIssuesHeader]);
      const s1 = { rec: { to: badTo, cc: '', bucketLabel: 'Test A1 One', primaryRole: 'A1' }, leads: [{ lead_id: 'L-BADTO', RM: 'Test RM One', TL: 'Test A1 One', status: 'Suspect', followup: 'call', issue: null }] };
      const before = TestGmailLog_.drafts.length;
      const fail = sendCombinedMorningEmail_(ssB, ovLogB, aiLogB, 'Pune', s1, null, 'test date', istDayKeyGs_(now), now, win, {}, null);
      TestAssert_(!!fail && /BLOCKED by the send-safety gate/.test(fail.reason), 'sendCombinedMorningEmail_: recipient "' + badTo + '" is BLOCKED by the safety gate and reported as not sent');
      TestAssertEqual_(TestGmailLog_.drafts.length, before, 'sendCombinedMorningEmail_: recipient "' + badTo + '" — NOTHING reaches the provider (no draft)');
      TestAssertEqual_(ovLogB.getLastRow(), 1, 'sendCombinedMorningEmail_: recipient "' + badTo + '" — no Overnight_Log row for an email that was never sent');
    });

    // ---- standalone sendOneOvernightEmail_: a bad recipient is blocked and reported ----
    {
      const ssS = P1_newSs([]);
      const ovLogS = ensureOvernightLogSheet_(ssS);
      const before = TestGmailLog_.drafts.length;
      const resS = sendOneOvernightEmail_(ssS, ovLogS, 'Pune', { to: 'not-an-email', cc: '', bucketLabel: 'Test A1 One', primaryRole: 'A1' },
        [{ lead_id: 'L-STANDALONE', RM: 'Test RM One', TL: 'Test A1 One', status: 'Suspect', followup: 'call', issue: null }], 'test date', istDayKeyGs_(now), now, win);
      TestAssert_(!!resS && /BLOCKED by the send-safety gate/.test(resS.reason), 'sendOneOvernightEmail_: a bad recipient is blocked and returned as a failure');
      TestAssertEqual_(TestGmailLog_.drafts.length, before, 'sendOneOvernightEmail_: …with nothing reaching the provider');
      TestAssertEqual_(ovLogS.getLastRow(), 1, 'sendOneOvernightEmail_: …and no Overnight_Log row');
    }

    // ---- 13:00 follow-up: a bad stored recipient is BLOCKED on BOTH paths (nothing sent, nothing marked done) ----
    {
      const ssG = P1_newSs([P1_flaggedLead('L-BADREC')]);
      const ovLogG = ensureOvernightLogSheet_(ssG);
      ovLogG.appendRow([istDayKeyGs_(now), 'Pune', 'thr-badrec', '[]', P1_stamp, 'not-an-email', '', 'Pune Digest - test badrec']);
      const aiLogG = TestMockSheet_('AllIssues_Log', [P1_allIssuesHeader,
        [P1_yesterday, 'Pune', 'Test A1 One', 'A1', 'not-an-email', '', 1, P1_yesterday, 'thr-ai-badrec', P1_snapshot('L-BADREC'), P1_checkpoint1('L-BADREC'), now, '', '']]);
      ssG._sheets['AllIssues_Log'] = aiLogG;
      const repliesBefore = TestGmailLog_.threadReplies.length, draftsBefore = TestGmailLog_.drafts.length, alertsBefore = TestGmailLog_.sent.length;
      P1_withSs(ssG, function () { sendOvernightFollowupEmails(); });
      TestAssertEqual_(TestGmailLog_.threadReplies.length, repliesBefore, 'bad recipient at 13:00: no threaded reply is attempted');
      TestAssertEqual_(TestGmailLog_.drafts.length, draftsBefore, 'bad recipient at 13:00: no fallback message either — the gate blocks BOTH paths');
      TestAssert_(TestGmailLog_.sent.slice(alertsBefore).some(function (e) { return /BLOCKED by the send-safety gate/.test(e.subject); }), 'bad recipient at 13:00: ops is alerted that the reply was blocked');
      TestAssertEqual_(String(ovLogG.getRange(2, 9, 1, 1).getValues()[0][0]), '', 'bad recipient at 13:00: followup_sent_at stays blank');
      TestAssert_(!aiLogG.getRange(2, 14, 1, 1).getValues()[0][0], 'bad recipient at 13:00: checkpoint2_sent_at stays blank — nothing is marked done');
    }

    // ---- 13:00 follow-up: an email that COUNTS a lead its body does not contain is blocked ----
    // Checkpoint 2 finds L-MISMATCH still unresolved, but the stored snapshot (which the table is built from) does not hold it,
    // so the HTML would count 1 lead and list none — exactly the validated-count-vs-sent-body mismatch the gate exists for.
    {
      const ssX = P1_newSs([P1_flaggedLead('L-MISMATCH')]);
      const ovLogX = ensureOvernightLogSheet_(ssX);
      ovLogX.appendRow([istDayKeyGs_(now), 'Pune', 'thr-mismatch', '[]', P1_stamp, TEST_EMAIL_PRIMARY_, '', 'Pune Digest - test mismatch']);
      ssX._sheets['AllIssues_Log'] = TestMockSheet_('AllIssues_Log', [P1_allIssuesHeader,
        [P1_yesterday, 'Pune', 'Test A1 One', 'A1', TEST_EMAIL_PRIMARY_, '', 1, P1_yesterday, 'thr-ai-mismatch', P1_snapshot('L-OTHER'), P1_checkpoint1('L-MISMATCH'), now, '', '']]);
      const repliesBefore = TestGmailLog_.threadReplies.length, draftsBefore = TestGmailLog_.drafts.length, alertsBefore = TestGmailLog_.sent.length;
      P1_withSs(ssX, function () { sendOvernightFollowupEmails(); });
      TestAssertEqual_(TestGmailLog_.threadReplies.length, repliesBefore, 'count/body mismatch at 13:00: no reply is sent');
      TestAssertEqual_(TestGmailLog_.drafts.length, draftsBefore, 'count/body mismatch at 13:00: no fallback message either');
      TestAssert_(TestGmailLog_.sent.slice(alertsBefore).some(function (e) { return /BLOCKED by the send-safety gate/.test(e.subject) && /L-MISMATCH/.test(e.body); }), 'count/body mismatch at 13:00: ops is alerted and the missing lead is named');
    }

    // ---- the threaded sender never builds a raw message from a header-injection address ----
    {
      let injected = null;
      try { sendThreadedGmailReply_('thr-x', 'a@homesfy.in\r\nBcc: evil@x.com', '', 'S', 'plain', '<p>html</p>'); } catch (e) { injected = e; }
      TestAssert_(!!injected && injected.blockedByGuard === true, 'sendThreadedGmailReply_: an address carrying CR/LF is rejected before any raw MIME is built');
      const repliesBefore = TestGmailLog_.threadReplies.length;
      sendThreadedGmailReply_('thr-x', TEST_EMAIL_PRIMARY_, '', 'Subject\r\nBcc: evil@x.com', 'plain', '<p>html</p>');
      const sentRaw = TestOE_decodeRawMime_(TestGmailLog_.threadReplies[repliesBefore].raw);
      TestAssert_(sentRaw.indexOf('\r\nBcc: evil@x.com') === -1 && /Subject: Subject Bcc: evil@x\.com/.test(sentRaw), 'sendThreadedGmailReply_: a line break in the subject is collapsed — it can never become a second header');
    }

    // ---- email audit P5 (F6): a checkpoint is marked done only when its email was DELIVERED ----
    // 10:00. Before: checkpoint1_sent_at was written even when the send failed, so a same-day re-run skipped that Section 2.
    {
      const ssM = P1_newSs([P1_flaggedLead('L-P5-M')]);
      const aiLogM = TestMockSheet_('AllIssues_Log', [P1_allIssuesHeader,
        [P1_yesterday, 'Pune', 'Test A1 One', 'A1', TEST_EMAIL_PRIMARY_, '', 1, P1_yesterday, 'thr-p5m', P1_snapshot('L-P5-M'), '', '', '', '']]);
      const ovLogM = ensureOvernightLogSheet_(ssM);
      const section2 = { to: TEST_EMAIL_PRIMARY_, cc: '', bucketLabel: 'Test A1 One', primaryRole: 'A1', rowNumbers: [2], snapshotEntries: JSON.parse(P1_snapshot('L-P5-M')) };
      const run = function () { return sendCombinedMorningEmail_(ssM, ovLogM, aiLogM, 'Pune', null, section2, 'test date', istDayKeyGs_(now), now, win, {}, null); };

      const realGmailApp = GmailApp;
      GmailApp = TestMockGmailApp_({});
      GmailApp.createDraft = function () { return { send: function () { throw new Error('simulated total failure'); } }; };
      let failure;
      try { failure = run(); } finally { GmailApp = realGmailApp; }
      TestAssert_(!!failure && /simulated total failure/.test(failure.reason), '10:00 failed send: returned as a failure with its reason');
      const rowAfterFail = aiLogM.getRange(2, 1, 1, 14).getValues()[0];
      TestAssert_(!rowAfterFail[10] && !rowAfterFail[11], '10:00 failed send: checkpoint1_json/checkpoint1_sent_at stay BLANK — Checkpoint 1 is not recorded as done for an email nobody received');
      TestAssertEqual_(ovLogM.getLastRow(), 1, '10:00 failed send: no Overnight_Log row either');

      const before = TestGmailLog_.drafts.length;
      TestAssertEqual_(run(), null, '10:00 re-run: succeeds');
      TestAssertEqual_(TestGmailLog_.drafts.length, before + 1, '10:00 re-run: the same-day re-run delivers the Section 2 the failed run could not');
      TestAssertContains_(TestGmailLog_.drafts[TestGmailLog_.drafts.length - 1].htmlBody, 'L-P5-M', '10:00 re-run: the delivered email lists the Checkpoint 1 lead');
      const rowAfterRetry = aiLogM.getRange(2, 1, 1, 14).getValues()[0];
      TestAssert_(!!rowAfterRetry[10] && !!rowAfterRetry[11], '10:00 re-run: after a SUCCESSFUL send, checkpoint1_json/checkpoint1_sent_at are written');
      TestAssertEqual_(ovLogM.getLastRow(), 2, '10:00 re-run: …and the Overnight_Log row exists');
    }
    // 13:00. Before: checkpoint2_sent_at was written even after BOTH sends failed, so the re-run replied WITHOUT Section 2.
    {
      const ssF = P1_newSs([P1_flaggedLead('L-P5-F')]);
      const ovLogF = ensureOvernightLogSheet_(ssF);
      ovLogF.appendRow([istDayKeyGs_(now), 'Pune', 'thr-p5f', '[]', P1_stamp, TEST_EMAIL_PRIMARY_, '', 'Pune Digest - test p5f']);
      const aiLogF = TestMockSheet_('AllIssues_Log', [P1_allIssuesHeader,
        [P1_yesterday, 'Pune', 'Test A1 One', 'A1', TEST_EMAIL_PRIMARY_, '', 1, P1_yesterday, 'thr-ai-p5f', P1_snapshot('L-P5-F'), P1_checkpoint1('L-P5-F'), now, '', '']]);
      ssF._sheets['AllIssues_Log'] = aiLogF;
      const realGmail = Gmail, realGmailApp = GmailApp;
      Gmail = TestMockGmailAdvanced_({ shouldFail: true });
      GmailApp = TestMockGmailApp_({});
      GmailApp.createDraft = function () { return { send: function () { throw new Error('simulated total failure — neither path can send'); } }; };
      const alertsBefore = TestGmailLog_.sent.length;
      try {
        P1_withSs(ssF, function () { sendOvernightFollowupEmails(); });
      } finally { Gmail = realGmail; GmailApp = realGmailApp; }
      TestAssertEqual_(String(ovLogF.getRange(2, 9, 1, 1).getValues()[0][0]), '', '13:00 total failure: followup_sent_at stays blank');
      const cp2AfterFail = aiLogF.getRange(2, 13, 1, 2).getValues()[0];
      TestAssert_(!cp2AfterFail[0] && !cp2AfterFail[1], '13:00 total failure: checkpoint2_json/checkpoint2_sent_at stay BLANK — Section 2 is not recorded as done for a reply nobody received');
      const failAlert = TestGmailLog_.sent.slice(alertsBefore).filter(function (e) { return /1pm follow-up failed/.test(e.subject); })[0];
      TestAssert_(!!failAlert, '13:00 total failure: ops is alerted');
      TestAssert_(!!failAlert && /sendOvernightFollowupEmailsNow again TODAY/.test(failAlert.body) && !/retried on the next run/.test(failAlert.body), '13:00 total failure: the alert tells the truth — a same-day re-run retries it, the scheduled job does not');

      const repliesBefore = TestGmailLog_.threadReplies.length;
      P1_withSs(ssF, function () { sendOvernightFollowupEmails(); });
      TestAssertEqual_(TestGmailLog_.threadReplies.length, repliesBefore + 1, '13:00 same-day re-run: delivers the reply');
      const raw = TestOE_decodeRawMime_(TestGmailLog_.threadReplies[TestGmailLog_.threadReplies.length - 1].raw);
      TestAssert_(raw.indexOf('L-P5-F') !== -1, '13:00 same-day re-run: the reply STILL carries Section 2 (it used to be lost — the failed run had already marked Checkpoint 2 done)');
      TestAssert_(!!aiLogF.getRange(2, 14, 1, 1).getValues()[0][0], '13:00 same-day re-run: after the successful reply, checkpoint2_sent_at is written');
      TestAssert_(!!ovLogF.getRange(2, 9, 1, 1).getValues()[0][0], '13:00 same-day re-run: …and followup_sent_at');
      const repliesAfter = TestGmailLog_.threadReplies.length;
      P1_withSs(ssF, function () { sendOvernightFollowupEmails(); });
      TestAssertEqual_(TestGmailLog_.threadReplies.length, repliesAfter, '13:00 third run: nothing is resent once delivered');
    }

    // ---- email audit P6 (F7): an AMBIGUOUS threaded-send failure is never followed by a second (fallback) send ----
    {
      // One 13:00 bucket with a Checkpoint 2 lead; `threadedError` is what Gmail.Users.Messages.send throws, `fallbackError`
      // (optional) is what the plain GmailApp fallback throws. Returns what happened.
      const P6_run = function (leadId, threadedError, fallbackError) {
        const ss = P1_newSs([P1_flaggedLead(leadId)]);
        const ovLog = ensureOvernightLogSheet_(ss);
        ovLog.appendRow([istDayKeyGs_(now), 'Pune', 'thr-' + leadId, '[]', P1_stamp, TEST_EMAIL_PRIMARY_, '', 'Pune Digest - test ' + leadId]);
        const aiLog = TestMockSheet_('AllIssues_Log', [P1_allIssuesHeader,
          [P1_yesterday, 'Pune', 'Test A1 One', 'A1', TEST_EMAIL_PRIMARY_, '', 1, P1_yesterday, 'thr-ai-' + leadId, P1_snapshot(leadId), P1_checkpoint1(leadId), now, '', '']]);
        ss._sheets['AllIssues_Log'] = aiLog;
        const realGmail = Gmail, realGmailApp = GmailApp;
        Gmail = { Users: { Threads: realGmail.Users.Threads, Messages: { send: function () { throw new Error(threadedError); } } } };
        if (fallbackError) {
          GmailApp = TestMockGmailApp_({});
          GmailApp.createDraft = function () { return { send: function () { throw new Error(fallbackError); } }; };
        }
        const draftsBefore = TestGmailLog_.drafts.length, alertsBefore = TestGmailLog_.sent.length;
        try {
          P1_withSs(ss, function () { sendOvernightFollowupEmails(); });
        } finally { Gmail = realGmail; GmailApp = realGmailApp; }
        return {
          ss: ss, ovLog: ovLog, aiLog: aiLog,
          fallbackDrafts: TestGmailLog_.drafts.length - draftsBefore,
          alerts: TestGmailLog_.sent.slice(alertsBefore),
          stamp: String(ovLog.getRange(2, 9, 1, 1).getValues()[0][0]),
          cp2Sent: !!aiLog.getRange(2, 14, 1, 1).getValues()[0][0],
        };
      };

      // (a) threaded send times out -> the message may be delivered: NO fallback, marked "unconfirmed", ops alerted.
      const a = P6_run('L-P6-A', 'Exception: Service Gmail timed out');
      TestAssertEqual_(a.fallbackDrafts, 0, 'ambiguous threaded send (timeout): NO fallback message is sent — a second copy would be a duplicate if the first was delivered');
      TestAssertEqual_(a.stamp.indexOf('unconfirmed '), 0, 'ambiguous threaded send: followup_sent_at is "unconfirmed <time>" — not blank (no auto-resend) and not a plain "sent" stamp');
      TestAssert_(a.alerts.some(function (e) { return /1pm follow-up UNCONFIRMED/.test(e.subject); }), 'ambiguous threaded send: ops is alerted that the outcome is unconfirmed');
      TestAssert_(!a.alerts.some(function (e) { return /1pm follow-up failed/.test(e.subject); }), 'ambiguous threaded send: …and it is NOT reported as a definite failure');
      TestAssert_(a.cp2Sent, 'ambiguous threaded send: checkpoint2 state is recorded (the reply was attempted and may be delivered)');
      TestAssertEqual_(String(a.ovLog.getRange(2, 10, 1, 1).getValues()[0][0]).indexOf('unconfirmed: the threaded send ended ambiguously'), 0, 'ambiguous threaded send: followup_result says "unconfirmed" and why (email audit P9)');
      const unconfirmedAlert = a.alerts.filter(function (e) { return /UNCONFIRMED/.test(e.subject); })[0];
      TestAssert_(!!unconfirmedAlert && /thr-L-P6-A/.test(unconfirmedAlert.body) && /Gmail Sent/.test(unconfirmedAlert.body), 'ambiguous threaded send: the alert names the thread and tells a human where to check');
      const repliesBefore = TestGmailLog_.threadReplies.length, draftsBefore = TestGmailLog_.drafts.length;
      P1_withSs(a.ss, function () { sendOvernightFollowupEmails(); });
      TestAssertEqual_(TestGmailLog_.threadReplies.length, repliesBefore, 'ambiguous threaded send: a same-day re-run does not auto-resend an unconfirmed reply');
      TestAssertEqual_(TestGmailLog_.drafts.length, draftsBefore, 'ambiguous threaded send: …nor create a fallback message');

      // (b) threaded send is refused DEFINITELY (bad argument) -> nothing was sent -> the plain fallback is correct.
      const b = P6_run('L-P6-B', 'Invalid argument: raw');
      TestAssertEqual_(b.fallbackDrafts, 1, 'definite threaded failure: the plain fallback IS used (nothing was delivered, so it cannot duplicate)');
      TestAssert_(b.stamp !== '' && b.stamp.indexOf('unconfirmed') === -1, 'definite threaded failure: followup_sent_at is a normal sent stamp');
      TestAssert_(!b.alerts.some(function (e) { return /UNCONFIRMED/.test(e.subject); }), 'definite threaded failure: no "unconfirmed" alert');
      TestAssertEqual_(String(b.ovLog.getRange(2, 10, 1, 1).getValues()[0][0]).indexOf('sent (fallback: a new message, not threaded'), 0, 'definite threaded failure: followup_result says it went by the NON-threaded fallback (email audit P9)');

      // (c) threaded failed definitively, then the fallback itself times out -> unconfirmed, not "failed".
      const c = P6_run('L-P6-C', 'Invalid argument: raw', 'Exception: Service Gmail timed out');
      TestAssertEqual_(c.stamp.indexOf('unconfirmed '), 0, 'fallback times out: followup_sent_at is "unconfirmed <time>"');
      TestAssert_(c.alerts.some(function (e) { return /1pm follow-up UNCONFIRMED/.test(e.subject); }) && !c.alerts.some(function (e) { return /1pm follow-up failed/.test(e.subject); }), 'fallback times out: reported as unconfirmed, not as a definite failure');
      TestAssert_(c.cp2Sent, 'fallback times out: checkpoint2 state is recorded');
      TestAssertEqual_(String(c.ovLog.getRange(2, 10, 1, 1).getValues()[0][0]).indexOf('unconfirmed: the fallback send ended ambiguously'), 0, 'fallback times out: followup_result says "unconfirmed" (email audit P9)');

      // (d) both paths refuse DEFINITELY -> a true failure: retryable same day, alert says failed.
      const d = P6_run('L-P6-D', 'Invalid argument: raw', 'Gmail operation not allowed for this user');
      TestAssertEqual_(d.stamp, '', 'both paths refused: followup_sent_at stays blank (retryable)');
      TestAssert_(!d.cp2Sent, 'both paths refused: checkpoint2_sent_at stays blank');
      TestAssertEqual_(String(d.ovLog.getRange(2, 10, 1, 1).getValues()[0][0]).indexOf('failed: neither send worked'), 0, 'both paths refused: followup_result says "failed" — a blank followup_sent_at is no longer the only trace (email audit P9)');
      TestAssert_(d.alerts.some(function (e) { return /1pm follow-up failed/.test(e.subject); }) && !d.alerts.some(function (e) { return /UNCONFIRMED/.test(e.subject); }), 'both paths refused: reported as a definite failure');
    }

    // ---- email audit P4 (F5): the lock wraps the 10:00 and 13:00 jobs, and FAILS OPEN ----
    {
      const realLock = LockService;
      // While another email job holds the lock, neither job sends anything, and each tells ops.
      const denied = TestMockLockService_({ denyLock: true });
      LockService = denied;
      const draftsBefore = TestGmailLog_.drafts.length, alertsBefore = TestGmailLog_.sent.length;
      try {
        sendOvernightMorningEmails();
        sendOvernightFollowupEmails();
      } finally { LockService = realLock; }
      TestAssertEqual_(TestGmailLog_.drafts.length, draftsBefore, 'job lock: while another email job holds the lock, neither the 10:00 nor the 13:00 job sends anything');
      const skipAlerts = TestGmailLog_.sent.slice(alertsBefore).filter(function (e) { return /SKIPPED/.test(e.subject); });
      TestAssertEqual_(skipAlerts.length, 2, 'job lock: each skipped job alerts ops');
      TestAssert_(skipAlerts.some(function (e) { return /sendOvernightMorningEmails SKIPPED/.test(e.subject); }) && skipAlerts.some(function (e) { return /sendOvernightFollowupEmails SKIPPED/.test(e.subject); }), 'job lock: …each naming its own job');

      // A normal run takes the lock once and releases it once.
      const free = TestMockLockService_();
      LockService = free;
      try { sendOvernightFollowupEmails(); } finally { LockService = realLock; }
      TestAssertEqual_(free._state.tryLockCalls, 1, 'job lock: a normal 13:00 run takes the lock once');
      TestAssertEqual_(free._state.releases, 1, 'job lock: …and releases it once');
      const freeMorning = TestMockLockService_();
      LockService = freeMorning;
      try { sendOvernightMorningEmails(); } finally { LockService = realLock; }
      TestAssertEqual_(freeMorning._state.releases, freeMorning._state.tryLockCalls, 'job lock: a normal 10:00 run releases every lock it took');

      // FAIL OPEN: if the lock service itself errors, the jobs still run (and ops hear about it).
      const ssOpen = P1_newSs([TestOE_leadRow_(header, { lead_id: 'L-LOCKOPEN', client_id: 'C-LOCKOPEN', RM: 'Test RM One', lead_assigned_at: midWindow })]);
      LockService = TestMockLockService_({ throwOnGet: true });
      const draftsBeforeOpen = TestGmailLog_.drafts.length, alertsBeforeOpen = TestGmailLog_.sent.length;
      try {
        const real = SpreadsheetApp;
        SpreadsheetApp = { getActiveSpreadsheet: function () { return ssOpen; }, flush: function () {} };
        try { sendOvernightMorningEmails(); } finally { SpreadsheetApp = real; }
      } finally { LockService = realLock; }
      TestAssertEqual_(TestGmailLog_.drafts.length - draftsBeforeOpen, 1, 'job lock (fail open): a broken lock service does NOT stop the 10:00 job — its email still goes out');
      TestAssert_(TestGmailLog_.sent.slice(alertsBeforeOpen).some(function (e) { return /sendOvernightMorningEmails ran WITHOUT its overlap lock/.test(e.subject); }), 'job lock (fail open): ops is told the job ran without its lock');
    }

    // ---- email audit P3 (F1): a multi-region recipient's 13:00 replies each carry ONLY their own region's Checkpoint 2 ----
    // Production defect (1 Oct 2026): a recipient who covers Thane/SoBo/Central got three ~36 KB replies that each carried the
    // SAME merged Section 2 of all three regions (the Central thread's Checkpoint 1 listed 7 leads at 10:05, its 13:04 reply
    // listed 68), because Checkpoint 2 was keyed by recipient email alone.
    {
      const P3_mimeParts = function (raw) {
        const full = TestOE_decodeRawMime_(raw);
        const i = full.indexOf('Content-Type: text/html');
        return { plain: full.slice(0, i), html: full.slice(i) };
      };
      const ssX = P1_newSs([P1_flaggedLead('L-XR-PUNE'), P1_flaggedLead('L-XR-THANE', 'Test RM Two')]);
      const ovLogX = ensureOvernightLogSheet_(ssX);
      ['Pune', 'Thane', 'Central'].forEach(function (reg) {
        ovLogX.appendRow([istDayKeyGs_(now), reg, 'thr-xr-' + reg.toLowerCase(), '[]', P1_stamp, TEST_EMAIL_PRIMARY_, '', reg + ' Google Overnight + Follow-up Digest - test']);
      });
      // A duplicate Overnight_Log row for the SAME region + recipient (e.g. a double-fired morning job).
      ovLogX.appendRow([istDayKeyGs_(now), 'Pune', 'thr-xr-pune-dup', '[]', P1_stamp, TEST_EMAIL_PRIMARY_, '', 'Pune Google Overnight + Follow-up Digest - test (dup)']);
      // Same recipient, TWO regions with a Checkpoint 1 today — Central has none.
      ssX._sheets['AllIssues_Log'] = TestMockSheet_('AllIssues_Log', [P1_allIssuesHeader,
        [P1_yesterday, 'Pune', 'Test A1 One', 'A1', TEST_EMAIL_PRIMARY_, '', 1, P1_yesterday, 'thr-ai-pune', P1_snapshot('L-XR-PUNE'), P1_checkpoint1('L-XR-PUNE'), now, '', ''],
        [P1_yesterday, 'Thane', 'Test A1 One', 'A1', TEST_EMAIL_PRIMARY_, '', 1, P1_yesterday, 'thr-ai-thane', P1_snapshot('L-XR-THANE'), P1_checkpoint1('L-XR-THANE'), now, '', '']]);
      const repliesBefore = TestGmailLog_.threadReplies.length;
      P1_withSs(ssX, function () { sendOvernightFollowupEmails(); });
      const newReplies = TestGmailLog_.threadReplies.slice(repliesBefore);
      TestAssertEqual_(newReplies.length, 2, '13:00 multi-region recipient: exactly two replies (Pune + Thane) — Central has nothing of its own, and the duplicate Pune row gets no second copy of Section 2');
      const puneReply = newReplies.filter(function (r) { return r.threadId === 'thr-xr-pune'; })[0];
      const thaneReply = newReplies.filter(function (r) { return r.threadId === 'thr-xr-thane'; })[0];
      TestAssert_(!!puneReply && !!thaneReply, '13:00 multi-region recipient: each region replied in its OWN thread');
      TestAssert_(!newReplies.some(function (r) { return r.threadId === 'thr-xr-central' || r.threadId === 'thr-xr-pune-dup'; }), '13:00 multi-region recipient: no reply into the Central thread or the duplicate Pune thread');
      const puneParts = P3_mimeParts(puneReply.raw);
      const thaneParts = P3_mimeParts(thaneReply.raw);
      TestAssert_(puneParts.html.indexOf('L-XR-PUNE') !== -1 && puneParts.plain.indexOf('L-XR-PUNE') !== -1, '13:00 multi-region recipient: the Pune reply lists the Pune lead (HTML and plain)');
      TestAssert_(puneParts.html.indexOf('L-XR-THANE') === -1 && puneParts.plain.indexOf('L-XR-THANE') === -1, '13:00 multi-region recipient: the Pune reply does NOT carry Thane\'s lead (no cross-region leak)');
      TestAssert_(thaneParts.html.indexOf('L-XR-THANE') !== -1 && thaneParts.plain.indexOf('L-XR-THANE') !== -1, '13:00 multi-region recipient: the Thane reply lists the Thane lead');
      TestAssert_(thaneParts.html.indexOf('L-XR-PUNE') === -1 && thaneParts.plain.indexOf('L-XR-PUNE') === -1, '13:00 multi-region recipient: the Thane reply does NOT carry Pune\'s lead');
      TestAssertContains_(puneParts.html, '1</div>', '13:00 multi-region recipient: the Pune reply counts only its own 1 lead');
      // Each region's Checkpoint 2 state is written onto its OWN AllIssues_Log row only.
      const aiAfter = ssX._sheets['AllIssues_Log'].getRange(2, 1, 2, 14).getValues();
      TestAssert_(!!aiAfter[0][13] && !!aiAfter[1][13], '13:00 multi-region recipient: both regions\' own AllIssues_Log rows get checkpoint2_sent_at');
      TestAssertEqual_(JSON.parse(aiAfter[0][12]).map(function (e) { return e.lead_id; }).join(','), 'L-XR-PUNE', '13:00 multi-region recipient: the Pune row\'s checkpoint2_json holds only the Pune lead');
      TestAssertEqual_(JSON.parse(aiAfter[1][12]).map(function (e) { return e.lead_id; }).join(','), 'L-XR-THANE', '13:00 multi-region recipient: the Thane row\'s checkpoint2_json holds only the Thane lead');
    }

    // ---- email audit P2: the plain-text part of the 10:00 and 13:00 emails lists their leads ----
    {
      // 10:00 combined email: Section 1 empty-state + a Checkpoint 1 lead.
      const ssM = P1_newSs([P1_flaggedLead('L-P2-S2')]);
      const aiLogM = TestMockSheet_('AllIssues_Log', [P1_allIssuesHeader,
        [P1_yesterday, 'Pune', 'Test A1 One', 'A1', TEST_EMAIL_PRIMARY_, '', 1, P1_yesterday, 'thr-p2m', P1_snapshot('L-P2-S2'), '', '', '', '']]);
      const section2 = { to: TEST_EMAIL_PRIMARY_, cc: '', bucketLabel: 'Test A1 One', primaryRole: 'A1', rowNumbers: [2], snapshotEntries: JSON.parse(P1_snapshot('L-P2-S2')) };
      const before = TestGmailLog_.drafts.length;
      sendCombinedMorningEmail_(ssM, ensureOvernightLogSheet_(ssM), aiLogM, 'Pune', null, section2, 'test date', istDayKeyGs_(now), now, win, {}, null);
      TestAssertEqual_(TestGmailLog_.drafts.length, before + 1, '10:00 plain text: the Section-2-only email is sent');
      const d = TestGmailLog_.drafts[TestGmailLog_.drafts.length - 1];
      TestAssertContains_(d.body, 'L-P2-S2', '10:00 plain text: lists the Checkpoint 1 lead (not a count-only stub)');
      TestAssertContains_(d.body, 'Section 1 - Overnight Leads', '10:00 plain text: labels Section 1');
      TestAssertContains_(d.body, 'No overnight leads for your team today.', '10:00 plain text: shows Section 1\'s empty state');
      TestAssertContains_(d.body, 'Section 2 - Previous Day 17:00 All-Issues Follow-up', '10:00 plain text: labels Section 2');
      TestAssertContains_(d.body, 'Still open — Follow-up Overdue', '10:00 plain text: carries the lead\'s current state');
      TestAssertContains_(d.body, 'Combined morning digest for Pune', '10:00 plain text: still opens with the one-line summary');
      TestAssertEqual_(d.body.split('Regards,').length - 1, 1, '10:00 plain text: one signature');

      // 13:00 threaded reply.
      const ssF = P1_newSs([P1_flaggedLead('L-P2-S2B')]);
      const ovLogF = ensureOvernightLogSheet_(ssF);
      ovLogF.appendRow([istDayKeyGs_(now), 'Pune', 'thr-p2f', '[]', P1_stamp, TEST_EMAIL_PRIMARY_, '', 'Pune Digest - test p2f']);
      ssF._sheets['AllIssues_Log'] = TestMockSheet_('AllIssues_Log', [P1_allIssuesHeader,
        [P1_yesterday, 'Pune', 'Test A1 One', 'A1', TEST_EMAIL_PRIMARY_, '', 1, P1_yesterday, 'thr-ai-p2f', P1_snapshot('L-P2-S2B'), P1_checkpoint1('L-P2-S2B'), now, '', '']]);
      const repliesBefore = TestGmailLog_.threadReplies.length;
      P1_withSs(ssF, function () { sendOvernightFollowupEmails(); });
      TestAssertEqual_(TestGmailLog_.threadReplies.length, repliesBefore + 1, '13:00 plain text: the reply is sent');
      const raw = TestOE_decodeRawMime_(TestGmailLog_.threadReplies[repliesBefore].raw);
      const plainPart = raw.split('Content-Type: text/html')[0];
      TestAssertContains_(plainPart, 'L-P2-S2B', '13:00 plain text: the plain-text part lists the Checkpoint 2 lead');
      TestAssertContains_(plainPart, '1pm follow-up for Pune', '13:00 plain text: still opens with the one-line summary');
      TestAssertContains_(plainPart, 'Section 2 - Previous Day 17:00 All-Issues Follow-up', '13:00 plain text: labels Section 2');
      TestAssertContains_(plainPart, 'Nothing still unresolved from this morning', '13:00 plain text: shows Section 1\'s empty state');
    }

    // ---- email audit P7 (F10): a retried Overnight_Log append never lands twice ----
    // A duplicate Overnight_Log row means a duplicate 13:00 reply into the same thread. Sheets can write the row and THEN time
    // out; withRetry_ retries the append.
    {
      const writeThenTimeOut = function (sheet) {
        const realAppend = sheet.appendRow;
        const state = { calls: 0 };
        sheet.appendRow = function (values) { state.calls++; realAppend(values); if (state.calls === 1) throw new Error('Service Spreadsheets timed out while accessing document'); };
        return state;
      };
      const ssA = P1_newSs([]);
      const ovLogA = ensureOvernightLogSheet_(ssA);
      const aiLogA = TestMockSheet_('AllIssues_Log', [P1_allIssuesHeader]);
      const stateA = writeThenTimeOut(ovLogA);
      const leadsA = [{ lead_id: 'L-P7-A', RM: 'Test RM One', TL: 'Test A1 One', status: 'Suspect', followup: 'call', issue: null }];
      const resA = sendCombinedMorningEmail_(ssA, ovLogA, aiLogA, 'Pune', { rec: { to: TEST_EMAIL_PRIMARY_, cc: '', bucketLabel: 'Test A1 One', primaryRole: 'A1' }, leads: leadsA }, null, 'test date', istDayKeyGs_(now), now, win, {}, null);
      TestAssertEqual_(resA, null, 'sendCombinedMorningEmail_ (append lands then times out): the send still reports success');
      TestAssertEqual_(stateA.calls, 1, 'sendCombinedMorningEmail_ (append lands then times out): the retry does NOT append the Overnight_Log row a second time');
      TestAssertEqual_(ovLogA.getLastRow(), 2, 'sendCombinedMorningEmail_ (append lands then times out): exactly ONE Overnight_Log row — one thread, one 13:00 reply');

      const ssS = P1_newSs([]);
      const ovLogS = ensureOvernightLogSheet_(ssS);
      const stateS = writeThenTimeOut(ovLogS);
      const resS = sendOneOvernightEmail_(ssS, ovLogS, 'Pune', { to: TEST_EMAIL_PRIMARY_, cc: '', bucketLabel: 'Test A1 One', primaryRole: 'A1' }, leadsA, 'test date', istDayKeyGs_(now), now, win);
      TestAssertEqual_(resS, null, 'sendOneOvernightEmail_ (append lands then times out): the send still reports success');
      TestAssertEqual_(stateS.calls, 1, 'sendOneOvernightEmail_ (append lands then times out): the retry does NOT append a second row');
      TestAssertEqual_(ovLogS.getLastRow(), 2, 'sendOneOvernightEmail_ (append lands then times out): exactly ONE Overnight_Log row');
    }

    // ---- email audit P7 (F9): two buckets on the same address are ONE email, not an overwrite ----
    // Test RM One reports to the A1 (Test A1 One) and Test RM Three to the TM (Test TM One); both resolve to the SAME address.
    // The 10:00 job keyed Section 1 by address, so the second bucket REPLACED the first and one RM's leads were never emailed.
    {
      const ssM = P1_newSs([
        TestOE_leadRow_(header, { lead_id: 'L-P7-ONE', client_id: 'C-P7-ONE', RM: 'Test RM One', lead_assigned_at: midWindow }),
        TestOE_leadRow_(header, { lead_id: 'L-P7-THREE', client_id: 'C-P7-THREE', RM: 'Test RM Three', lead_assigned_at: midWindow }),
      ]);
      const before = TestGmailLog_.drafts.length;
      P1_withSs(ssM, function () { sendOvernightMorningEmails(); });
      const sent = TestGmailLog_.drafts.slice(before).filter(function (d) { return d.to === TEST_EMAIL_PRIMARY_; });
      TestAssertEqual_(sent.length, 1, '10:00 same-address buckets: exactly ONE email goes to the shared address');
      TestAssert_(sent.length === 1 && sent[0].htmlBody.indexOf('L-P7-ONE') !== -1 && sent[0].htmlBody.indexOf('L-P7-THREE') !== -1, '10:00 same-address buckets: that email lists BOTH RMs\' leads (neither bucket overwrote the other)');
      TestAssert_(sent.length === 1 && sent[0].body.indexOf('L-P7-ONE') !== -1 && sent[0].body.indexOf('L-P7-THREE') !== -1, '10:00 same-address buckets: …and so does its plain-text part');
      TestAssertEqual_(ensureOvernightLogSheet_(ssM).getLastRow(), 2, '10:00 same-address buckets: one Overnight_Log row for the one email');
      const loggedIds = JSON.parse(ensureOvernightLogSheet_(ssM).getRange(2, 4, 1, 1).getValues()[0][0]).map(function (e) { return e.lead_id; }).sort().join(',');
      TestAssertEqual_(loggedIds, 'L-P7-ONE,L-P7-THREE', '10:00 same-address buckets: the logged lead ids cover both RMs, so the 13:00 follow-up tracks both');
    }

    // ---- email audit P7 (F16): the "already sent" label only claims what is true for THAT recipient ----
    // The region ran earlier today (so Section 1 is not re-sent), but if no Overnight_Log row names this recipient, telling
    // them "Already sent separately earlier today" is false — their own send failed, or went to someone else.
    {
      const runWithLoggedRecipient = function (loggedTo, tag) {
        const ssL = P1_newSs([
          TestOE_leadRow_(header, { lead_id: 'L-' + tag + '-OVN', client_id: 'C-' + tag + '-OVN', RM: 'Test RM One', lead_assigned_at: midWindow }),
          P1_flaggedLead('L-' + tag + '-S2'),
        ]);
        ensureOvernightLogSheet_(ssL).appendRow([istDayKeyGs_(now), 'Pune', 'thr-' + tag + '-earlier', '[]', P1_stamp, loggedTo, '', 'Pune Digest - earlier today']);
        ssL._sheets['AllIssues_Log'] = TestMockSheet_('AllIssues_Log', [P1_allIssuesHeader,
          [P1_yesterday, 'Pune', 'Test A1 One', 'A1', TEST_EMAIL_PRIMARY_, '', 1, P1_yesterday, 'thr-ai-' + tag, P1_snapshot('L-' + tag + '-S2'), '', '', '', '']]);
        const before = TestGmailLog_.drafts.length;
        P1_withSs(ssL, function () { sendOvernightMorningEmails(); });
        return TestGmailLog_.drafts.slice(before).filter(function (d) { return d.to === TEST_EMAIL_PRIMARY_; });
      };
      // Control: the earlier Pune row WAS to this recipient -> the original label is true.
      const claimed = runWithLoggedRecipient(TEST_EMAIL_PRIMARY_, 'F16A');
      TestAssertEqual_(claimed.length, 1, '10:00 label: a Section-2 email is sent to the recipient who already had today\'s Overnight email');
      TestAssertContains_(claimed[0].htmlBody, 'Already sent separately earlier today', '10:00 label: …and says "Already sent separately" (a row names them)');
      // The case under test: the earlier Pune row went to SOMEONE ELSE.
      const unclaimed = runWithLoggedRecipient(TEST_EMAIL_SECONDARY_, 'F16B');
      TestAssertEqual_(unclaimed.length, 1, '10:00 label: the recipient with no Overnight row today still gets their Section 2');
      TestAssert_(unclaimed[0].htmlBody.indexOf('Already sent separately earlier today') === -1, '10:00 label: …and is NOT told "Already sent separately" (no Overnight email to them is on record)');
      TestAssertContains_(unclaimed[0].htmlBody, 'No Overnight email to you is recorded for today', '10:00 label: …it says what is actually known');
      TestAssertContains_(unclaimed[0].htmlBody, 'contact Lead Ops', '10:00 label: …and tells them what to do');
      TestAssert_(unclaimed[0].body.indexOf('No Overnight email to you is recorded for today') !== -1, '10:00 label: the plain-text part carries the same truthful wording');
    }

    // ---- email audit P7 (F17): the Lead_Followups push never appends a lead twice ----
    {
      const lfHeader = ['lead_id', 'region', 'RM', 'issue', 'collated_comments', 'suggested_followup', 'updated_at', 'own_comments'];
      const lfSheet = TestMockSheet_('Lead_Followups', [lfHeader,
        ['L-LF-EXIST', 'Pune', 'Old RM', 'Old issue', 'old comments', 'typed by a human', '2026-10-01 09:00:00', 'old comments']]);
      const ssLf = TestMockSpreadsheet_({ 'Lead_Followups': lfSheet });
      const started = pushUnresolvedToLeadFollowups_(ssLf, [
        { lead_id: 'L-LF-NEW', region: 'Pune', RM: 'RM A', issue: 'Not Updated', comments: 'first copy' },
        { lead_id: 'L-LF-EXIST', region: 'Pune', RM: 'RM B', issue: 'Follow-up Overdue', comments: 'fresh' },
        { lead_id: 'L-LF-NEW', region: 'Pune', RM: 'RM A', issue: 'Not Updated', comments: 'second copy (later entry wins)' },
        { lead_id: 'L-LF-EXIST', region: 'Pune', RM: 'RM B', issue: 'Follow-up Overdue', comments: 'fresher' },
      ]);
      TestAssertEqual_(started, true, 'pushUnresolvedToLeadFollowups_: reports it wrote');
      const lfRows = lfSheet.getRange(2, 1, lfSheet.getLastRow() - 1, 8).getValues();
      TestAssertEqual_(lfRows.length, 2, 'pushUnresolvedToLeadFollowups_: a lead listed twice is ONE row — the existing lead stays one row and the new lead is added once (it used to append a duplicate)');
      const newRow = lfRows.filter(function (r) { return r[0] === 'L-LF-NEW'; });
      TestAssertEqual_(newRow.length, 1, 'pushUnresolvedToLeadFollowups_: the new lead appears exactly once');
      TestAssertEqual_(newRow[0][4], 'second copy (later entry wins)', 'pushUnresolvedToLeadFollowups_: the later entry for the same lead wins');
      const existRow = lfRows.filter(function (r) { return r[0] === 'L-LF-EXIST'; })[0];
      TestAssertEqual_(existRow[4], 'fresher', 'pushUnresolvedToLeadFollowups_: the existing row takes the later entry too');
      TestAssertEqual_(existRow[5], 'typed by a human', 'pushUnresolvedToLeadFollowups_: column F (the human-typed suggestion) is still preserved');
    }

    // ---- email audit P8 (F8): ONE leads-tab read per 10:00 / 13:00 job, shared by every bucket ----
    // Each bucket's checkpoint used to re-read the whole tab (~30 reads; the 3 Oct 13:00 run took 663 s), so buckets — and
    // Section 1 vs Section 2 of one email — could be judged against different moments of a sheet re-imported underneath the run.
    {
      // A lead 50h old: not in the overnight window (so it is never a Section-1 lead), flagged "Stuck 48h+" -> an active
      // Checkpoint lead against a snapshot that says "Follow-up Overdue".
      const P8_lead = function (id) {
        return TestOE_leadRow_(header, { lead_id: id, client_id: 'C-' + id, RM: 'Test RM One', current_stage: 'Suspect', lead_assigned_at: TestFixture_hoursAgo_(now, 50), call_attempts: 15 });
      };
      // Spy on the whole-sheet read; `afterFirstRead` runs right after the job's FIRST read (a re-import landing mid-run).
      const spyOnLeadsReads = function (afterFirstRead) {
        const realRead = readLeadsTab_;
        const state = { reads: 0, restore: function () { readLeadsTab_ = realRead; } };
        readLeadsTab_ = function (s) {
          state.reads++;
          const data = realRead(s);
          if (state.reads === 1 && afterFirstRead) afterFirstRead();
          return data;
        };
        return state;
      };
      const closeLeadInSheet = function (s, leadId) {
        s._sheets[monthShort]._data.forEach(function (r) { if (r[header.indexOf('lead_id')] === leadId) r[header.indexOf('current_stage')] = 'Won'; });
      };

      // 10:00: three Checkpoint-1 buckets (Pune, Harbour, Thane) -> one read, not four.
      const ssR = P1_newSs([P8_lead('L-P8-A'), P8_lead('L-P8-B'), P8_lead('L-P8-T')]);
      ssR._sheets['AllIssues_Log'] = TestMockSheet_('AllIssues_Log', [P1_allIssuesHeader,
        [P1_yesterday, 'Pune', 'Test A1 One', 'A1', TEST_EMAIL_PRIMARY_, '', 1, P1_yesterday, 'thr-p8-ai-a', P1_snapshot('L-P8-A'), '', '', '', ''],
        [P1_yesterday, 'Harbour', 'Harbour Manager', 'A1', TEST_EMAIL_SECONDARY_, '', 1, P1_yesterday, 'thr-p8-ai-b', P1_snapshot('L-P8-B'), '', '', '', ''],
        [P1_yesterday, 'Thane', 'Test CH Self', 'A1', TEST_EMAIL_CH_, '', 1, P1_yesterday, 'thr-p8-ai-t', P1_snapshot('L-P8-T'), '', '', '', '']]);
      const draftsBeforeR = TestGmailLog_.drafts.length;
      // The mid-run re-import: right after the job's read, L-P8-A is closed in the LIVE sheet.
      const spyR = spyOnLeadsReads(function () { closeLeadInSheet(ssR, 'L-P8-A'); });
      try { P1_withSs(ssR, function () { sendOvernightMorningEmails(); }); } finally { spyR.restore(); }
      TestAssertEqual_(spyR.reads, 1, '10:00 snapshot: the leads tab is read exactly ONCE for the whole job (it was once per bucket)');
      const sentR = TestGmailLog_.drafts.slice(draftsBeforeR);
      TestAssertEqual_(sentR.filter(function (d) { return d.htmlBody.indexOf('L-P8-A') !== -1 || d.htmlBody.indexOf('L-P8-B') !== -1 || d.htmlBody.indexOf('L-P8-T') !== -1; }).length, 3, '10:00 snapshot: all three buckets still got their Checkpoint 1 email');
      TestAssert_(sentR.some(function (d) { return d.to === TEST_EMAIL_PRIMARY_ && d.htmlBody.indexOf('L-P8-A') !== -1; }),
        '10:00 snapshot: Pune\'s Checkpoint 1 is judged against the job\'s own snapshot — a lead closed in the sheet AFTER that read is still listed (a per-bucket re-read would have dropped it)');

      // 13:00: two Checkpoint-2 buckets (Pune, Thane) -> one read, not three.
      const ssQ = P1_newSs([P8_lead('L-P8-C'), P8_lead('L-P8-D')]);
      const ovLogQ = ensureOvernightLogSheet_(ssQ);
      ['Pune', 'Thane'].forEach(function (reg) {
        ovLogQ.appendRow([istDayKeyGs_(now), reg, 'thr-p8-' + reg.toLowerCase(), '[]', P1_stamp, TEST_EMAIL_PRIMARY_, '', reg + ' Google Overnight + Follow-up Digest - test']);
      });
      ssQ._sheets['AllIssues_Log'] = TestMockSheet_('AllIssues_Log', [P1_allIssuesHeader,
        [P1_yesterday, 'Pune', 'Test A1 One', 'A1', TEST_EMAIL_PRIMARY_, '', 1, P1_yesterday, 'thr-p8-ai-c', P1_snapshot('L-P8-C'), P1_checkpoint1('L-P8-C'), now, '', ''],
        [P1_yesterday, 'Thane', 'Test A1 One', 'A1', TEST_EMAIL_PRIMARY_, '', 1, P1_yesterday, 'thr-p8-ai-d', P1_snapshot('L-P8-D'), P1_checkpoint1('L-P8-D'), now, '', '']]);
      const repliesBeforeQ = TestGmailLog_.threadReplies.length;
      const spyQ = spyOnLeadsReads(function () { closeLeadInSheet(ssQ, 'L-P8-C'); });
      try { P1_withSs(ssQ, function () { sendOvernightFollowupEmails(); }); } finally { spyQ.restore(); }
      TestAssertEqual_(spyQ.reads, 1, '13:00 snapshot: the leads tab is read exactly ONCE for the whole job (it was once per bucket)');
      const repliesQ = TestGmailLog_.threadReplies.slice(repliesBeforeQ);
      TestAssertEqual_(repliesQ.length, 2, '13:00 snapshot: both buckets still got their Checkpoint 2 reply');
      const puneReplyQ = repliesQ.filter(function (r) { return r.threadId === 'thr-p8-pune'; })[0];
      TestAssert_(!!puneReplyQ && TestOE_decodeRawMime_(puneReplyQ.raw).indexOf('L-P8-C') !== -1,
        '13:00 snapshot: Pune\'s Checkpoint 2 is judged against the job\'s own snapshot — a lead closed in the sheet AFTER that read is still listed');
    }

    // ---- email audit P9 (F12): the log says what the 13:00 job did with each row, and stamps are taken at the write ----
    {
      const resultOf = function (sheet, row) { return String(sheet.getRange(row, 10, 1, 1).getValues()[0][0]); };
      const run13 = function (s) { P1_withSs(s, function () { sendOvernightFollowupEmails(); }); };
      const aiRow = function (leadId, thread, to) {
        return [P1_yesterday, 'Pune', 'Test A1 One', 'A1', to || TEST_EMAIL_PRIMARY_, '', 1, P1_yesterday, thread, P1_snapshot(leadId), P1_checkpoint1(leadId), now, '', ''];
      };

      // (1) a delivered threaded reply -> "sent (threaded reply)"
      const ssS = P1_newSs([P1_flaggedLead('L-P9-S')]);
      const ovS = ensureOvernightLogSheet_(ssS);
      ovS.appendRow([istDayKeyGs_(now), 'Pune', 'thr-p9-s', '[]', P1_stamp, TEST_EMAIL_PRIMARY_, '', 'Pune Digest - test p9s']);
      ssS._sheets['AllIssues_Log'] = TestMockSheet_('AllIssues_Log', [P1_allIssuesHeader, aiRow('L-P9-S', 'thr-ai-p9s')]);
      run13(ssS);
      TestAssertEqual_(resultOf(ovS, 2), 'sent (threaded reply)', '13:00 followup_result: a delivered threaded reply is recorded as "sent (threaded reply)"');
      TestAssert_(String(ovS.getRange(2, 9, 1, 1).getValues()[0][0]) !== '', '13:00 followup_result: …and followup_sent_at is stamped as before');

      // (2) nothing unresolved in either section -> "skipped: nothing unresolved", followup_sent_at STILL blank
      const ssK = P1_newSs([]);
      const ovK = ensureOvernightLogSheet_(ssK);
      ovK.appendRow([istDayKeyGs_(now), 'Pune', 'thr-p9-k', '[]', P1_stamp, TEST_EMAIL_PRIMARY_, '', 'Pune Digest - test p9k']);
      const repliesBeforeK = TestGmailLog_.threadReplies.length;
      run13(ssK);
      TestAssertEqual_(TestGmailLog_.threadReplies.length, repliesBeforeK, '13:00 followup_result: a bucket with nothing unresolved still sends no reply');
      TestAssertEqual_(resultOf(ovK, 2), 'skipped: nothing unresolved', '13:00 followup_result: a skipped bucket is recorded as "skipped: nothing unresolved" — not a blank');
      TestAssertEqual_(String(ovK.getRange(2, 9, 1, 1).getValues()[0][0]), '', '13:00 followup_result: …and followup_sent_at stays blank (nothing was sent)');

      // (3) Section 2 present but every Checkpoint-2 lead already resolved (the skip INSIDE sendCombinedFollowupEmail_)
      const ssR = P1_newSs([TestOE_leadRow_(header, { lead_id: 'L-P9-R', client_id: 'C-P9-R', RM: 'Test RM One', current_stage: 'Won', lead_assigned_at: TestFixture_hoursAgo_(now, 60) })]);
      const ovR = ensureOvernightLogSheet_(ssR);
      ovR.appendRow([istDayKeyGs_(now), 'Pune', 'thr-p9-r', '[]', P1_stamp, TEST_EMAIL_PRIMARY_, '', 'Pune Digest - test p9r']);
      ssR._sheets['AllIssues_Log'] = TestMockSheet_('AllIssues_Log', [P1_allIssuesHeader, aiRow('L-P9-R', 'thr-ai-p9r')]);
      run13(ssR);
      TestAssertEqual_(resultOf(ovR, 2), 'skipped: nothing unresolved', '13:00 followup_result: a bucket whose Checkpoint-2 leads all resolved is also "skipped: nothing unresolved"');

      // (4) the safety gate blocks it -> "blocked: ..."
      const ssB = P1_newSs([P1_flaggedLead('L-P9-B')]);
      const ovB = ensureOvernightLogSheet_(ssB);
      ovB.appendRow([istDayKeyGs_(now), 'Pune', 'thr-p9-b', '[]', P1_stamp, 'not-an-email', '', 'Pune Digest - test p9b']);
      ssB._sheets['AllIssues_Log'] = TestMockSheet_('AllIssues_Log', [P1_allIssuesHeader, aiRow('L-P9-B', 'thr-ai-p9b', 'not-an-email')]);
      run13(ssB);
      TestAssertEqual_(resultOf(ovB, 2).indexOf('blocked: '), 0, '13:00 followup_result: a reply the safety gate refused is recorded as "blocked: <why>"');
      TestAssertEqual_(String(ovB.getRange(2, 9, 1, 1).getValues()[0][0]), '', '13:00 followup_result: …and followup_sent_at stays blank');

      // (5) a row with no stored recipient -> "skipped: no stored recipient"
      const ssN = P1_newSs([P1_flaggedLead('L-P9-N')]);
      const ovN = ensureOvernightLogSheet_(ssN);
      ovN.appendRow([istDayKeyGs_(now), 'Pune', 'thr-p9-n', JSON.stringify([{ lead_id: 'L-P9-N', issueKey: 'followupOverdue', issueLabel: 'Follow-up Overdue' }]), P1_stamp, '', '', '']);
      run13(ssN);
      TestAssertEqual_(resultOf(ovN, 2).indexOf('skipped: no stored recipient'), 0, '13:00 followup_result: a row that predates the recipient fix is recorded as skipped, with the reason');

      // (6) a row the 13:00 job has not processed -> followup_result stays blank (so blank means "not processed")
      const ssU = P1_newSs([]);
      const ovU = ensureOvernightLogSheet_(ssU);
      ovU.appendRow([istDayKeyGs_(now), 'Pune', 'thr-p9-u', '[]', P1_stamp, TEST_EMAIL_PRIMARY_, '', 'Pune Digest - test p9u']);
      TestAssertEqual_(resultOf(ovU, 2), '', '13:00 followup_result: a row the job has not processed has a blank result');
    }

    // ---- email audit P9 (F12): log stamps are taken when the row is written, not at the start of the job ----
    // The 3 Oct reply went out at 13:12 but was stamped 13:01:49 (the job's start). The fix: every stamp comes from istStampGs_().
    // A sentinel proves each stamp site calls it (a stamp built from the job's `now` would not carry the sentinel).
    {
      const SENTINEL = '2099-01-01 00:00:00';
      const realStamp = istStampGs_;
      istStampGs_ = function () { return SENTINEL; };
      try {
        // 10:00 standalone: Overnight_Log.sent_at
        const ssO = P1_newSs([]);
        const ovO = ensureOvernightLogSheet_(ssO);
        sendOneOvernightEmail_(ssO, ovO, 'Pune', { to: TEST_EMAIL_PRIMARY_, cc: '', bucketLabel: 'Test A1 One', primaryRole: 'A1' },
          [{ lead_id: 'L-P9-ST1', RM: 'Test RM One', TL: 'Test A1 One', status: 'Suspect', followup: 'call', issue: null }], 'test date', istDayKeyGs_(now), now, win);
        TestAssertEqual_(String(ovO.getRange(2, 5, 1, 1).getValues()[0][0]), SENTINEL, 'stamp: the standalone 10:00 email sent_at is taken at the write (istStampGs_), not from the start of the job');

        // 10:00 combined: Overnight_Log.sent_at AND AllIssues_Log.checkpoint1_sent_at
        const ssC = P1_newSs([P1_flaggedLead('L-P9-ST2')]);
        const ovC = ensureOvernightLogSheet_(ssC);
        const aiC = TestMockSheet_('AllIssues_Log', [P1_allIssuesHeader,
          [P1_yesterday, 'Pune', 'Test A1 One', 'A1', TEST_EMAIL_PRIMARY_, '', 1, P1_yesterday, 'thr-ai-st2', P1_snapshot('L-P9-ST2'), '', '', '', '']]);
        const section2C = { to: TEST_EMAIL_PRIMARY_, cc: '', bucketLabel: 'Test A1 One', primaryRole: 'A1', rowNumbers: [2], snapshotEntries: JSON.parse(P1_snapshot('L-P9-ST2')) };
        const resC = sendCombinedMorningEmail_(ssC, ovC, aiC, 'Pune', null, section2C, 'test date', istDayKeyGs_(now), now, win, {}, null);
        TestAssertEqual_(resC, null, 'stamp: the combined 10:00 email sends');
        TestAssertEqual_(String(ovC.getRange(2, 5, 1, 1).getValues()[0][0]), SENTINEL, 'stamp: the combined 10:00 email sent_at is taken at the write');
        TestAssertEqual_(String(aiC.getRange(2, 12, 1, 1).getValues()[0][0]), SENTINEL, 'stamp: checkpoint1_sent_at is taken at the write');

        // 13:00: followup_sent_at AND checkpoint2_sent_at
        const ssF = P1_newSs([P1_flaggedLead('L-P9-ST3')]);
        const ovF = ensureOvernightLogSheet_(ssF);
        ovF.appendRow([istDayKeyGs_(now), 'Pune', 'thr-p9-st3', '[]', P1_stamp, TEST_EMAIL_PRIMARY_, '', 'Pune Digest - test st3']);
        const aiF = TestMockSheet_('AllIssues_Log', [P1_allIssuesHeader,
          [P1_yesterday, 'Pune', 'Test A1 One', 'A1', TEST_EMAIL_PRIMARY_, '', 1, P1_yesterday, 'thr-ai-st3', P1_snapshot('L-P9-ST3'), P1_checkpoint1('L-P9-ST3'), now, '', '']]);
        ssF._sheets['AllIssues_Log'] = aiF;
        P1_withSs(ssF, function () { sendOvernightFollowupEmails(); });
        TestAssertEqual_(String(ovF.getRange(2, 9, 1, 1).getValues()[0][0]), SENTINEL, 'stamp: followup_sent_at is taken when the reply was sent, not at the start of the job');
        TestAssertEqual_(String(aiF.getRange(2, 14, 1, 1).getValues()[0][0]), SENTINEL, 'stamp: checkpoint2_sent_at is taken at the write');
      } finally { istStampGs_ = realStamp; }
    }

    // ---- email audit P9 (F21/F20): every job leaves a run record; a crash is recorded; test mode alerts and records nothing ----
    {
      const jobName = 'sendOvernightMorningEmails';
      // A quiet day (nothing to send at all) is still a COMPLETED run — the watchdog must not read it as "never ran".
      PropertiesService = TestMockPropertiesService_();
      P1_withSs(P1_newSs([]), function () { sendOvernightMorningEmails(); });
      const quiet = readEmailJobRunGs_(jobName);
      TestAssert_(!!quiet && quiet.status === 'completed' && quiet.day === istDayKeyGs_(now), 'run record: a 10:00 run with nothing to send is recorded as completed for today');
      TestAssert_(!!quiet && !!quiet.startedAt && !!quiet.finishedAt, 'run record: …with its start and finish times');

      // A crash: the run is recorded as failed (with the error), the error still propagates, and ops still get the job's own alert.
      PropertiesService = TestMockPropertiesService_();
      const realReadLeads = readLeadsTab_;
      readLeadsTab_ = function () { throw new Error('simulated platform failure: a server error occurred'); };
      const alertsBeforeCrash = TestGmailLog_.sent.length;
      let crashThrew = false;
      try { P1_withSs(P1_newSs([]), function () { sendOvernightMorningEmails(); }); } catch (e) { crashThrew = /server error occurred/.test(e.message); } finally { readLeadsTab_ = realReadLeads; }
      TestAssert_(crashThrew, 'run record: a crashing job still throws (the Executions list must show Failed)');
      const crashed = readEmailJobRunGs_(jobName);
      TestAssert_(!!crashed && crashed.status === 'failed' && /server error occurred/.test(crashed.error || ''), 'run record: a crashing run is recorded as failed, with the error text');
      TestAssert_(TestGmailLog_.sent.slice(alertsBeforeCrash).some(function (e) { return /sendOvernightMorningEmails crashed/.test(e.subject); }), 'run record: …and the job\'s own crash alert is unchanged');

      // The 13:00 job records a run too (nothing logged today -> it returns early, and that is still a completed run).
      PropertiesService = TestMockPropertiesService_();
      P1_withSs(P1_newSs([]), function () { sendOvernightFollowupEmails(); });
      const fup = readEmailJobRunGs_('sendOvernightFollowupEmails');
      TestAssert_(!!fup && fup.status === 'completed', 'run record: the 13:00 job records a completed run even when there was nothing to follow up');

      // TEST MODE: ops are told, and NO run record is written (test runs must not write production state).
      PropertiesService = TestMockPropertiesService_();
      TEST_MODE_OVERRIDE_EMAIL_ = TEST_EMAIL_SECONDARY_;
      const alertsBeforeTm = TestGmailLog_.sent.length;
      try { P1_withSs(P1_newSs([]), function () { sendOvernightMorningEmails(); }); } finally { TEST_MODE_OVERRIDE_EMAIL_ = ''; }
      TestAssert_(TestGmailLog_.sent.slice(alertsBeforeTm).some(function (e) { return /sendOvernightMorningEmails ran in TEST MODE/.test(e.subject); }), 'test mode: a job that starts with test mode on alerts ops');
      TestAssertEqual_(readEmailJobRunGs_(jobName), null, 'test mode: …and writes no run record (the watchdog would otherwise think the real job ran)');
    }

    // ---- email audit P10 (F11): the CH-level overnight report goes once a day per region + CH ----
    // A region with ONLY CH-level leads never gets an Overnight_Log row, so the 10:00 region guard never protected it: every re-run
    // of the job re-sent the same report.
    {
      const chRms = function (chName) { return [{ rmName: chName, chName: chName, chEmail: TEST_EMAIL_CH_, chRole: 'Leadership' }]; };
      const chLeads = function (chName, id) { const m = {}; m[chName] = [{ lead_id: id, RM: chName, TL: '', status: 'Suspect', followup: 'call now' }]; return m; };
      const reports = function (since) { return TestGmailLog_.drafts.slice(since); };

      PropertiesService = TestMockPropertiesService_();
      const before = TestGmailLog_.drafts.length;
      notifyChLevelLeadsGs_('Pune', chRms('Test CH Self'), chLeads('Test CH Self', 'L-P10-A'), 'test date');
      TestAssertEqual_(reports(before).length, 1, 'CH report once a day: the first report goes out');
      notifyChLevelLeadsGs_('Pune', chRms('Test CH Self'), chLeads('Test CH Self', 'L-P10-A'), 'test date');
      TestAssertEqual_(reports(before).length, 1, 'CH report once a day: the same report for the same region + CH is NOT sent again the same day');
      notifyChLevelLeadsGs_('Thane', chRms('Test CH Self'), chLeads('Test CH Self', 'L-P10-B'), 'test date');
      TestAssertEqual_(reports(before).length, 2, 'CH report once a day: a different region still gets its report');
      notifyChLevelLeadsGs_('Pune', chRms('Other CH'), chLeads('Other CH', 'L-P10-C'), 'test date');
      TestAssertEqual_(reports(before).length, 3, 'CH report once a day: a different CH in the same region still gets its report');

      // A failed send is NOT recorded, so a retry the same day delivers it.
      PropertiesService = TestMockPropertiesService_();
      const realGmailApp = GmailApp;
      GmailApp = TestMockGmailApp_({});
      GmailApp.createDraft = function () { return { send: function () { throw new Error('Gmail operation not allowed for this user'); } }; };
      try { notifyChLevelLeadsGs_('Pune', chRms('Test CH Self'), chLeads('Test CH Self', 'L-P10-F'), 'test date'); } finally { GmailApp = realGmailApp; }
      TestAssertEqual_(wasChReportSentTodayGs_(CH_REPORT_KINDS_.overnight, 'Pune', 'Test CH Self'), false, 'CH report once a day: a send that FAILED is not recorded as sent');
      const beforeRetry = TestGmailLog_.drafts.length;
      notifyChLevelLeadsGs_('Pune', chRms('Test CH Self'), chLeads('Test CH Self', 'L-P10-F'), 'test date');
      TestAssertEqual_(reports(beforeRetry).length, 1, 'CH report once a day: …so the retry the same day delivers it');

      // Tomorrow is a new day.
      PropertiesService.getScriptProperties().setProperty('EMAIL_CH_REPORTS_overnight', JSON.stringify({ day: '2026-01-01', keys: ['pune|test ch self'] }));
      const beforeNextDay = TestGmailLog_.drafts.length;
      notifyChLevelLeadsGs_('Pune', chRms('Test CH Self'), chLeads('Test CH Self', 'L-P10-D'), 'test date');
      TestAssertEqual_(reports(beforeNextDay).length, 1, 'CH report once a day: a report recorded on an earlier day does not suppress today\'s');

      // TEST MODE ignores the record, like the region guards, and writes none.
      PropertiesService = TestMockPropertiesService_();
      notifyChLevelLeadsGs_('Pune', chRms('Test CH Self'), chLeads('Test CH Self', 'L-P10-E'), 'test date');
      TEST_MODE_OVERRIDE_EMAIL_ = TEST_EMAIL_SECONDARY_;
      const beforeTm = TestGmailLog_.drafts.length;
      try {
        notifyChLevelLeadsGs_('Pune', chRms('Test CH Self'), chLeads('Test CH Self', 'L-P10-E'), 'test date');
        TestAssertEqual_(reports(beforeTm).length, 1, 'CH report once a day (TEST MODE): a real report earlier today does not stop a test run sending');
      } finally { TEST_MODE_OVERRIDE_EMAIL_ = ''; }

      // End to end: a region whose ONLY lead is CH-held. Two runs of the 10:00 job -> ONE report (and no Overnight_Log row at all,
      // which is exactly why the region guard never protected it).
      PropertiesService = TestMockPropertiesService_();
      const ssCh = P1_newSs([TestOE_leadRow_(header, { lead_id: 'L-P10-CHONLY', client_id: 'C-P10-CHONLY', RM: 'Test CH Self', lead_assigned_at: midWindow })]);
      const beforeJob = TestGmailLog_.drafts.length;
      P1_withSs(ssCh, function () { sendOvernightMorningEmails(); });
      const firstRun = reports(beforeJob).filter(function (d) { return d.htmlBody.indexOf('L-P10-CHONLY') !== -1; });
      TestAssertEqual_(firstRun.length, 1, '10:00 CH-only region: the first run sends the CH-level report');
      TestAssertEqual_(ensureOvernightLogSheet_(ssCh).getLastRow(), 1, '10:00 CH-only region: …and writes no Overnight_Log row (so the region guard cannot see it)');
      P1_withSs(ssCh, function () { sendOvernightMorningEmails(); });
      TestAssertEqual_(reports(beforeJob).filter(function (d) { return d.htmlBody.indexOf('L-P10-CHONLY') !== -1; }).length, 1, '10:00 CH-only region: a same-day RE-RUN does not send the CH-level report a second time');
    }

    // ======================================================================================================
    // Email audit F18 (2026-10-07): the call baseline is per LEAD, not per customer - on BOTH the 10:00 and 13:00 paths.
    // Two leads of ONE customer (same client_id) with different call_attempts counters; the sibling's snapshot is the LATER
    // one, which is the one a client-keyed lookup returned. Own snapshots: L-SIB-B 4 -> now 9 (5 more attempts);
    // the sibling's 13 would have read "no new call attempts".
    // ======================================================================================================
    {
      const f18Header = ['snapshot_at', 'snapshot_label'].concat(SNAPSHOT_COLUMNS_);
      const f18Snap = function (at, leadId, attempts) {
        return f18Header.map(function (k) {
          if (k === 'snapshot_at') return at;
          if (k === 'snapshot_label') return 'f18';
          if (k === 'lead_id') return leadId;
          if (k === 'client_id') return 'C-SIB';
          if (k === 'call_attempts') return attempts;
          return '';
        });
      };
      const f18Log = function () {
        return TestMockSheet_('Movement_Log', [f18Header, f18Snap(TestFixture_hoursAgo_(now, 25), 'L-SIB-B', 4), f18Snap(TestFixture_hoursAgo_(now, 24), 'L-SIB-A', 13)]);
      };

      // ---- 10:00 morning email ----
      // 'Not Updated' (rank 0) vs 'Suspect' (rank 1): L-SIB-B is the copy that survives the per-customer collapse.
      PropertiesService = TestMockPropertiesService_();
      const ssF18m = P1_newSs([
        TestOE_leadRow_(header, { lead_id: 'L-SIB-A', client_id: 'C-SIB', RM: 'Test RM One', current_stage: 'Not Updated', lead_assigned_at: midWindow, call_attempts: 13 }),
        TestOE_leadRow_(header, { lead_id: 'L-SIB-B', client_id: 'C-SIB', RM: 'Test RM One', current_stage: 'Suspect', lead_assigned_at: midWindow, call_attempts: 9 }),
      ]);
      ssF18m._sheets['Movement_Log'] = f18Log();
      const f18mBefore = TestGmailLog_.drafts.length;
      P1_withSs(ssF18m, function () { sendOvernightMorningEmails(); });
      const f18mDrafts = TestGmailLog_.drafts.slice(f18mBefore).filter(function (d) { return d.htmlBody.indexOf('L-SIB-B') !== -1; });
      TestAssertEqual_(f18mDrafts.length, 1, 'F18 10:00 email: exactly one email carries the surviving sibling lead');
      const f18mHtml = f18mDrafts[0] ? f18mDrafts[0].htmlBody : '';
      TestAssert_(f18mHtml.indexOf('L-SIB-A') === -1, 'F18 10:00 email: the other sibling collapsed away (one row per customer)');
      const f18mRow = f18mHtml.slice(f18mHtml.indexOf('L-SIB-B'), f18mHtml.indexOf('</tr>', f18mHtml.indexOf('L-SIB-B')));
      TestAssertContains_(f18mRow, '5 more call attempts', 'F18 10:00 email: the follow-up compares with the lead\'s OWN last snapshot (4 -> 9 = 5 more attempts), not the sibling\'s (13)');

      // ---- 13:00 follow-up: an unresolved lead's follow-up text ----
      PropertiesService = TestMockPropertiesService_();
      const ssF18f = P1_newSs([
        TestOE_leadRow_(header, { lead_id: 'L-SIB-A', client_id: 'C-SIB', RM: 'Test RM One', current_stage: 'Suspect', lead_assigned_at: TestFixture_hoursAgo_(now, 70), call_attempts: 13 }),
        TestOE_leadRow_(header, { lead_id: 'L-SIB-B', client_id: 'C-SIB', RM: 'Test RM One', current_stage: 'Suspect', lead_assigned_at: TestFixture_hoursAgo_(now, 60), call_attempts: 9 }),
      ]);
      ssF18f._sheets['Movement_Log'] = f18Log();
      const f18fLog = ensureOvernightLogSheet_(ssF18f);
      f18fLog.appendRow([istDayKeyGs_(now), 'Pune', 'thr-f18', JSON.stringify([{ lead_id: 'L-SIB-B', issueKey: 'stageStuck48h', issueLabel: 'Stuck 48h+' }]),
        P1_stamp, TEST_EMAIL_PRIMARY_, '', 'Pune Digest - f18']);
      const f18fRepliesBefore = TestGmailLog_.threadReplies.length;
      P1_withSs(ssF18f, function () { sendOvernightFollowupEmails(); });
      TestAssertEqual_(TestGmailLog_.threadReplies.length, f18fRepliesBefore + 1, 'F18 13:00 reply: one threaded reply is sent for the still-unresolved lead');
      const f18fReply = TestGmailLog_.threadReplies[TestGmailLog_.threadReplies.length - 1];
      const f18fHtml = TestOE_decodeRawMime_(f18fReply && f18fReply.raw);
      TestAssertContains_(f18fHtml, 'L-SIB-B', 'F18 13:00 reply: the unresolved lead is listed');
      TestAssertContains_(f18fHtml, '5 more call attempts', 'F18 13:00 reply: its follow-up compares with the lead\'s OWN last snapshot (4 -> 9), not the sibling\'s (13)');
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
