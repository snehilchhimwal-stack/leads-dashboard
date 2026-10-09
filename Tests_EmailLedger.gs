/**
 * Tests: EmailLedger.gs - the per-email evidence trail (Email Ops EO-1a) and its wiring into the 17:00 job. Run
 * runEmailLedgerTestsNow() from the function dropdown, or via runAllTests() (Tests_RunAll.gs). Everything is in-memory (sheets,
 * Gmail, Drive, Properties are fakes - see Tests_Mocks.gs); nothing is sent for real.
 *
 * NOTE ON TIME: sendAllIssuesEmails reads the real wall clock, so the end-to-end fixtures use the REAL allIssuesWindowGs_(now) window
 * and leads whose rules do not depend on the time of day (the same fixtures Tests_AllIssuesEmailer.gs relies on).
 */

// ---- helpers ----

function TestEL_leadRow_(header, overrides) {
  const defaults = {
    lead_id: 'L-X', client_id: 'C-X', RM: 'Test RM One', TL: 'Test A1 One', project: 'P', region: 'Pune',
    client: 'Client', lead_assigned_at: new Date(), group_source: 'google', source_bucket: 'Non-UTM',
    current_stage: 'Suspect', rm_is_active: true, call_attempts: 1,
  };
  const merged = Object.assign({}, defaults, overrides || {});
  return header.map(function (k) { return merged[k] !== undefined ? merged[k] : ''; });
}

// A sheet's rows as objects keyed by the header names.
function TestEL_objects_(sheet, headers) {
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, headers.length).getValues().map(function (r) {
    const o = {};
    headers.forEach(function (h, i) { o[h] = r[i]; });
    return o;
  });
}

// A fresh workbook with the routing tabs and the given lead rows (a leads tab = banner row + header + data).
function TestEL_world_(leadRowsFn) {
  const header = TestFixture_leadsHeader_();
  const banner = header.map(function () { return ''; });
  const now = new Date();
  const win = allIssuesWindowGs_(now);
  const midWindow = new Date((win.from.getTime() + win.to.getTime()) / 2);
  const ss = TestMockSpreadsheet_({
    'RM_Hierarchy': TestMockSheet_('RM_Hierarchy', TestFixture_rmHierarchyRows_()),
    'Manager_Directory': TestMockSheet_('Manager_Directory', TestFixture_managerDirectoryRows_()),
  });
  ss._sheets['leads'] = TestMockSheet_('leads', [banner, header].concat(leadRowsFn(header, now, midWindow)));
  return ss;
}

// The three leads every end-to-end scenario starts from: all in ONE bucket (Test A1 One), each flagged by a time-independent rule.
function TestEL_standardLeads_(header, now, midWindow) {
  return [
    TestEL_leadRow_(header, { lead_id: 'L-INACTIVE', client_id: 'C-INACTIVE', RM: 'Test RM One', lead_assigned_at: now, rm_is_active: false }),
    TestEL_leadRow_(header, { lead_id: 'L-NOTUPDATED', client_id: 'C-NOTUPDATED', RM: 'Test RM Two', lead_assigned_at: midWindow, current_stage: 'Suspect' }),
    TestEL_leadRow_(header, { lead_id: 'L-MULTI', client_id: 'C-MULTI', RM: 'Test RM One', lead_assigned_at: now, rm_is_active: false, call_attempts: 0 }),
  ];
}

// Points the fakes at a fresh workbook and clears the Gmail log, properties and Gmail fake. (Not TestEnv_setUp_ again: that would
// reset the tally and save the already-mocked globals as the "real" ones.)
function TestEL_bind_(ss) {
  SpreadsheetApp.getActiveSpreadsheet = function () { return ss; };
  TestGmailLog_reset_();
  GmailApp = TestMockGmailApp_({});
  PropertiesService = TestMockPropertiesService_();
}

function runEmailLedgerTests_() {
  TestEnv_setUp_('Tests_EmailLedger', TestMockSpreadsheet_({}));
  const realDrive = DriveApp;
  const realRender = renderOvernightReportEmailHTML_;
  const L = EMAIL_LEDGER_HEADERS_, X = EMAIL_LEDGER_EXCLUSION_HEADERS_;
  try {
    const dayKey = istDayKeyGs_(new Date());

    // ================= pure helpers =================
    TestAssertEqual_(emailLedgerCol_('attempted_at') + ',' + emailLedgerCol_('lead_ids_json'), '12,20', 'columns: the outcome block (attempted_at..lead_ids_json) is columns 12-20, contiguous, because one setValues rewrites it');
    TestAssertEqual_(EMAIL_LEDGER_HEADERS_.slice(emailLedgerCol_('attempted_at') - 1, emailLedgerCol_('lead_ids_json')).join(','),
      'attempted_at,finished_at,status,status_reason,attempts,message_id,thread_id,leads_sent,lead_ids_json', 'columns: the outcome block holds exactly the nine outcome fields, in order');
    TestAssertEqual_(emailLedgerIdGs_('allIssues17', '2026-10-09', 'Pune', 'A1', 'Test A1 One'), '20261009|allIssues17|Pune|A1|Test A1 One', 'email id: day, job, region, role and bucket - deterministic');
    TestAssertEqual_(emailLedgerIdGs_('j', '2026-10-09', 'Pu|ne', 'A1', '  Two   Words '), '20261009|j|Pu/ne|A1|Two Words', 'email id: a pipe in a name cannot break the format, runs of spaces collapse');
    TestAssertEqual_(emailLedgerDayKeyOfGs_(new Date('2026-10-09T10:00:00+05:30')) + ',' + emailLedgerDayKeyOfGs_('2026-10-09') + ',' + emailLedgerDayKeyOfGs_(''), '2026-10-09,2026-10-09,', 'day key: a Date, a text day and a blank cell are all read');

    TestAssertEqual_(emailLedgerLeadDefectGs_({ lead_id: '12345', issueLabel: 'Not Updated' }), '', 'lead check: an ordinary numeric id is fine');
    TestAssertEqual_(emailLedgerLeadDefectGs_({ lead_id: 'L-A 1/2&3', issueLabel: 'Not Updated' }), '', 'lead check: spaces, slashes and ampersands are fine (the gate decodes them) - nothing is dropped on a guess');
    TestAssertContains_(emailLedgerLeadDefectGs_({ lead_id: '', issueLabel: 'x' }), 'no id', 'lead check: a blank id is defective');
    TestAssertContains_(emailLedgerLeadDefectGs_({ lead_id: 'A\nB', issueLabel: 'x' }), 'control characters', 'lead check: a line break in an id is defective');
    TestAssertContains_(emailLedgerLeadDefectGs_({ lead_id: new Array(102).join('x'), issueLabel: 'x' }), 'too long', 'lead check: an id over 100 characters is defective');
    TestAssertContains_(emailLedgerLeadDefectGs_({ lead_id: '1', issueLabel: '  ' }), 'no reason for contact', 'lead check: a blank issue label (no reason for contact) is defective');
    TestAssertContains_(emailLedgerLeadDefectGs_(null), 'no id', 'lead check: a missing lead object is defective, not a crash');
    const split = emailLedgerSplitLeadsGs_([{ lead_id: '1', issueLabel: 'a' }, { lead_id: '2', issueLabel: '' }, { lead_id: ' 1 ', issueLabel: 'a' }, { lead_id: '3', issueLabel: 'a' }]);
    TestAssertEqual_(split.valid.map(function (l) { return l.lead_id; }).join(','), '1,3', 'split: the valid leads keep their order');
    TestAssertEqual_(split.defective.map(function (d) { return d.lead.lead_id.trim() + ':' + (d.covered ? 'covered' : 'dropped'); }).join(','), '2:dropped,1:covered', 'split: a blank-label lead is dropped; a second copy of an id is "covered" (the first copy was sent)');

    TestAssertEqual_(emailLedgerStatusForErrorGs_(sendBlockedErrorGs_('x', ['p'])), 'BLOCKED', 'status: a gate refusal is BLOCKED');
    TestAssertEqual_(emailLedgerStatusForErrorGs_(new Error('Service timed out: Gmail')), 'UNCONFIRMED', 'status: a timeout (the message may have gone) is UNCONFIRMED, never FAILED');
    TestAssertEqual_(emailLedgerStatusForErrorGs_(new Error('Gmail operation not allowed')), 'FAILED', 'status: a definite refusal is FAILED');
    const ids = emailLedgerSentIdsGs_({ getId: function () { return 'm1'; }, getThread: function () { return { getId: function () { return 't1'; } }; } });
    TestAssertEqual_(ids.messageId + ',' + ids.threadId, 'm1,t1', 'sent ids: message and thread id are read from the sent message');
    const noIds = emailLedgerSentIdsGs_({ getId: function () { throw new Error('boom'); }, getThread: function () { throw new Error('boom'); } });
    TestAssertEqual_(noIds.messageId + ',' + noIds.threadId, ',', 'sent ids: a message that throws gives blanks, never an exception');
    TestAssertEqual_(emailLedgerSentIdsGs_(undefined).messageId, '', 'sent ids: no message gives blanks');

    // ---- the send gate now says WHICH leads it objected to ----
    const prep = prepareOutgoingEmailGs_({ to: TEST_EMAIL_PRIMARY_, subject: 's', plainBody: 'has A and B', htmlBody: '<p>has A only</p>', leadIds: ['A', 'B', 'C'] });
    TestAssertEqual_(prep.missingLeadIds.join(','), 'B,C', 'gate: missingLeadIds lists every counted lead absent from a body (B missing from the html, C from both)');
    TestAssertEqual_(prepareOutgoingEmailGs_({ to: TEST_EMAIL_PRIMARY_, subject: 's', plainBody: 'A', htmlBody: '<p>A</p>', leadIds: ['A'] }).missingLeadIds.length, 0, 'gate: nothing missing -> an empty list');
    let gateErr = null;
    try { sendGuardedEmailGs_({ to: TEST_EMAIL_PRIMARY_, subject: 's', plainBody: 'A', htmlBody: '<p>A</p>', leadIds: ['A', 'Z'] }, 'gate test'); } catch (e) { gateErr = e; }
    TestAssert_(gateErr && gateErr.blockedByGuard && gateErr.missingLeadIds.join(',') === 'Z', 'gate: the thrown refusal carries missingLeadIds');
    TestAssertEqual_(TestGmailLog_.drafts.length, 0, 'gate: a refused payload never reaches the provider');

    // ================= ledger API against in-memory sheets =================
    {
      const ssA = TestMockSpreadsheet_({});
      const h = emailLedgerOpenGs_(ssA);
      TestAssert_(emailLedgerLiveGs_(h), 'open: a handle is returned');
      TestAssertEqual_(ssA.getSheetByName(EMAIL_LEDGER_SHEET_).getRange(1, 1, 1, L.length).getValues()[0].join(','), L.join(','), 'open: Email_Ledger is created with its header row');
      TestAssertEqual_(ssA.getSheetByName(EMAIL_LEDGER_EXCLUSIONS_SHEET_).getRange(1, 1, 1, X.length).getValues()[0].join(','), X.join(','), 'open: Email_Ledger_Exclusions is created with its header row');

      const plan = function (id, bucket, leadIds) { return { emailId: id, job: 'allIssues17', dayKey: dayKey, region: 'Pune', bucketLabel: bucket, primaryRole: 'A1', to: TEST_EMAIL_PRIMARY_, cc: '', leadIds: leadIds }; };
      emailLedgerPlanGs_(h, [plan('E1', 'B1', ['1', '2']), plan('E2', 'B2', ['3'])]);
      let rows = TestEL_objects_(ssA.getSheetByName(EMAIL_LEDGER_SHEET_), L);
      TestAssertEqual_(rows.length, 2, 'plan: one row per bucket email, written together');
      TestAssertEqual_(rows[0].status + ',' + rows[0].leads_planned + ',' + rows[0].attempts + ',' + rows[1].leads_planned, 'PLANNED,2,0,1', 'plan: rows start PLANNED with the planned lead count and no attempts');
      TestAssertEqual_(rows[0].lead_ids_json, '["1","2"]', 'plan: the planned lead ids are kept');

      emailLedgerAttemptGs_(h, 'E1');
      rows = TestEL_objects_(ssA.getSheetByName(EMAIL_LEDGER_SHEET_), L);
      TestAssertEqual_(rows[0].status + ',' + rows[0].attempts, 'ATTEMPTING,1', 'attempt: the row says ATTEMPTING before the send (a row stuck here means the run died mid-send)');
      TestAssert_(rows[0].attempted_at instanceof Date && rows[0].finished_at === '', 'attempt: attempted_at is stamped, finished_at is empty until the outcome');

      emailLedgerResultGs_(h, 'E1', { status: 'ACCEPTED', messageId: 'm-1', threadId: 't-1', leadIds: ['1', '2'] });
      rows = TestEL_objects_(ssA.getSheetByName(EMAIL_LEDGER_SHEET_), L);
      TestAssertEqual_([rows[0].status, rows[0].message_id, rows[0].thread_id, rows[0].leads_sent].join(','), 'ACCEPTED,m-1,t-1,2', 'result: ACCEPTED carries the Gmail message and thread id and the number of leads sent');
      TestAssert_(rows[0].finished_at instanceof Date, 'result: finished_at is stamped');
      TestAssertEqual_(rows[1].status, 'PLANNED', 'result: the other bucket is untouched');

      emailLedgerAttemptGs_(h, 'E2');
      emailLedgerResultGs_(h, 'E2', { status: 'FAILED', reason: 'x'.repeat(600), leadIds: [] });
      rows = TestEL_objects_(ssA.getSheetByName(EMAIL_LEDGER_SHEET_), L);
      TestAssertEqual_(rows[1].status + ',' + rows[1].leads_sent + ',' + rows[1].message_id, 'FAILED,0,', 'result: FAILED sends zero leads and has no message id');
      TestAssertEqual_(rows[1].status_reason.length, 500, 'result: a very long reason is cut to 500 characters');

      // A re-run plans the same ids: no second row, the attempt count carries on.
      const h2 = emailLedgerOpenGs_(ssA);
      emailLedgerPlanGs_(h2, [plan('E2', 'B2', ['3']), plan('E3', 'B3', ['4'])]);
      emailLedgerAttemptGs_(h2, 'E2');
      rows = TestEL_objects_(ssA.getSheetByName(EMAIL_LEDGER_SHEET_), L);
      TestAssertEqual_(rows.length, 3, 're-run: an id that already has a row gets no second row; the new bucket is appended');
      TestAssertEqual_(rows[1].attempts, 2, 're-run: the attempt count continues from the earlier row (1 -> 2)');

      emailLedgerExcludeGs_(h, [
        { job: 'allIssues17', dayKey: dayKey, region: 'Pune', kind: 'lead', leadId: 'L9', rm: 'RM X', reason: 'no recipient' },
        { job: 'allIssues17', dayKey: dayKey, region: 'Pune', kind: 'region', reason: 'already sent' },
      ]);
      const ex = TestEL_objects_(ssA.getSheetByName(EMAIL_LEDGER_EXCLUSIONS_SHEET_), X);
      TestAssertEqual_(ex.length + ',' + ex[0].kind + ',' + ex[0].lead_id + ',' + ex[1].kind + ',' + ex[1].lead_id, '2,lead,L9,region,', 'exclude: lead and region exclusions are both recorded, in one write');
      emailLedgerExcludeGs_(h, []);
      TestAssertEqual_(TestEL_objects_(ssA.getSheetByName(EMAIL_LEDGER_EXCLUSIONS_SHEET_), X).length, 2, 'exclude: an empty list writes nothing');

      TestAssertEqual_(h.failures, 0, 'a clean run counts no ledger failures');
      emailLedgerFinishGs_(h, 'test');
      TestAssertEqual_(TestGmailLog_.sent.length, 0, 'finish: no ops note when nothing failed');

      // Retention: only LEADING rows older than the window go, and only after they are archived.
      DriveApp = TestMockDriveApp_();
      const oldDay = istDayKeyGs_(new Date(Date.now() - (EMAIL_LEDGER_RETENTION_DAYS_ + 5) * 86400000));
      const ssP = TestMockSpreadsheet_({});
      const hp = emailLedgerOpenGs_(ssP);
      emailLedgerPlanGs_(hp, [
        { emailId: 'OLD1', job: 'j', dayKey: oldDay, region: 'Pune', bucketLabel: 'B', primaryRole: 'A1', to: TEST_EMAIL_PRIMARY_, leadIds: ['1'] },
        { emailId: 'NEW1', job: 'j', dayKey: dayKey, region: 'Pune', bucketLabel: 'B', primaryRole: 'A1', to: TEST_EMAIL_PRIMARY_, leadIds: ['2'] },
      ]);
      emailLedgerExcludeGs_(hp, [{ job: 'j', dayKey: oldDay, region: 'Pune', kind: 'lead', leadId: '9', reason: 'old' }, { job: 'j', dayKey: dayKey, region: 'Pune', kind: 'lead', leadId: '8', reason: 'new' }]);
      pruneEmailLedgerGs_(hp, new Date());
      TestAssertEqual_(TestEL_objects_(ssP.getSheetByName(EMAIL_LEDGER_SHEET_), L).map(function (r) { return r.email_id; }).join(','), 'NEW1', 'prune: the old ledger row is removed, today\'s stays');
      TestAssertEqual_(TestEL_objects_(ssP.getSheetByName(EMAIL_LEDGER_EXCLUSIONS_SHEET_), X).map(function (r) { return r.lead_id; }).join(','), '8', 'prune: the old exclusion row is removed too');
      const archiveFolder = DriveApp.getFoldersByName(ARCHIVE_ROOT_FOLDER_).next().getFoldersByName(EMAIL_LEDGER_SHEET_).next();
      TestAssertEqual_(archiveFolder._filesList.length, 1, 'prune: the removed ledger row was archived to Drive first');
      TestAssertContains_(archiveFolder._filesList[0]._content, 'OLD1', 'prune: the archive holds the removed row');
      pruneEmailLedgerGs_(hp, new Date());
      TestAssertEqual_(TestEL_objects_(ssP.getSheetByName(EMAIL_LEDGER_SHEET_), L).length, 1, 'prune: nothing more to remove the second time');
      DriveApp = realDrive;
    }

    // ================= fail-open: a broken ledger never stops anything =================
    {
      const ssBad = TestMockSpreadsheet_({ 'Email_Ledger': TestMockSheet_('Email_Ledger', [['not', 'the', 'ledger', 'header']]) });
      const hb = emailLedgerOpenGs_(ssBad);
      TestAssert_(hb && hb.disabled && hb.failures === 1, 'fail-open: a sheet whose header is not recognised gives a DISABLED handle, not an exception');
      TestAssertContains_(hb.lastError, 'will not write into a sheet whose columns it does not recognise', 'fail-open: the reason is kept');
      emailLedgerPlanGs_(hb, [{ emailId: 'E', job: 'j', dayKey: dayKey, region: 'R', bucketLabel: 'B', primaryRole: 'A1', to: 'a@b.co', leadIds: ['1'] }]);
      emailLedgerAttemptGs_(hb, 'E');
      emailLedgerResultGs_(hb, 'E', { status: 'ACCEPTED', leadIds: ['1'] });
      emailLedgerExcludeGs_(hb, [{ job: 'j', dayKey: dayKey, region: 'R', kind: 'lead', leadId: '1', reason: 'x' }]);
      pruneEmailLedgerGs_(hb, new Date());
      TestAssertEqual_(ssBad.getSheetByName('Email_Ledger').getLastRow(), 1, 'fail-open: a disabled ledger writes nothing anywhere');
      emailLedgerFinishGs_(hb, 'the test job');
      TestAssertEqual_(TestGmailLog_.sent.length, 1, 'fail-open: ONE ops note is sent at the end');
      TestAssertContains_(TestGmailLog_.sent[0].subject, 'the emails were NOT affected', 'fail-open: the note says the emails were not affected');
      TestGmailLog_.sent.length = 0;

      // A write that throws midway is counted, not propagated.
      const ssT = TestMockSpreadsheet_({});
      const ht = emailLedgerOpenGs_(ssT);
      const realGetRange = ht.ledger.getRange;
      ht.ledger.getRange = function () { throw new Error('simulated: Sheets is down'); };
      emailLedgerPlanGs_(ht, [{ emailId: 'E', job: 'j', dayKey: dayKey, region: 'R', bucketLabel: 'B', primaryRole: 'A1', to: 'a@b.co', leadIds: ['1'] }]);
      ht.ledger.getRange = realGetRange;
      TestAssertEqual_(ht.failures, 1, 'fail-open: a Sheets error during a write is counted');
      TestAssertContains_(ht.lastError, 'simulated: Sheets is down', 'fail-open: …with its error text');
      emailLedgerAttemptGs_(ht, 'E');
      TestAssertEqual_(ssT.getSheetByName('Email_Ledger').getLastRow(), 1, 'fail-open: an update for a row that was never planned is a quiet no-op');

      TEST_MODE_OVERRIDE_EMAIL_ = TEST_EMAIL_PRIMARY_;
      try { TestAssertEqual_(emailLedgerOpenGs_(TestMockSpreadsheet_({})), null, 'test mode: no handle - the ledger never writes during a test-mode run'); } finally { TEST_MODE_OVERRIDE_EMAIL_ = ''; }
      emailLedgerPlanGs_(null, [{ emailId: 'E' }]); emailLedgerAttemptGs_(null, 'E'); emailLedgerResultGs_(null, 'E', {}); emailLedgerExcludeGs_(null, [{}]); pruneEmailLedgerGs_(null, new Date()); emailLedgerFinishGs_(null, 'x');
      TestAssert_(true, 'a null handle makes every ledger call a no-op');
    }

    // ================= end to end: the real 17:00 job =================
    const a1Id = emailLedgerIdGs_(EMAIL_LEDGER_JOB_ALL_ISSUES_, dayKey, 'Pune', 'A1', 'Test A1 One');

    // ---- (1) a normal run: one bucket, ACCEPTED, with message + thread id ----
    {
      const ss1 = TestEL_world_(TestEL_standardLeads_);
      TestEL_bind_(ss1);
      sendAllIssuesEmails();
      const led = TestEL_objects_(ss1.getSheetByName(EMAIL_LEDGER_SHEET_), L);
      TestAssertEqual_(led.length, 1, '17:00 normal run: exactly one bucket email is in the ledger');
      TestAssertEqual_(led[0].email_id, a1Id, '17:00 normal run: the email id is the deterministic day|job|region|role|bucket');
      TestAssertEqual_(led[0].status + ',' + led[0].leads_planned + ',' + led[0].leads_sent + ',' + led[0].attempts, 'ACCEPTED,3,3,1', '17:00 normal run: ACCEPTED, 3 planned, 3 sent, 1 attempt');
      TestAssertEqual_(led[0].to + ',' + led[0].primary_role + ',' + led[0].bucket_label + ',' + led[0].job, TEST_EMAIL_PRIMARY_ + ',A1,Test A1 One,allIssues17', '17:00 normal run: recipient, role, bucket and job are recorded');
      TestAssertEqual_(JSON.parse(led[0].lead_ids_json).sort().join(','), 'L-INACTIVE,L-MULTI,L-NOTUPDATED', '17:00 normal run: the ledger lists exactly the leads the email carried');
      const logRow = ss1.getSheetByName('AllIssues_Log').getRange(2, 1, 1, 9).getValues()[0];
      TestAssertEqual_(led[0].thread_id, logRow[8], '17:00 normal run: the ledger thread id is the one AllIssues_Log kept');
      TestAssertEqual_(led[0].message_id, 'msg_' + led[0].thread_id, '17:00 normal run: the Gmail message id is recorded as the evidence of acceptance');
      TestAssertEqual_(TestEL_objects_(ss1.getSheetByName(EMAIL_LEDGER_EXCLUSIONS_SHEET_), X).length, 0, '17:00 normal run: nothing was left out, so no exclusion rows');
      TestAssertEqual_(TestGmailLog_.drafts.length, 1, '17:00 normal run: one email sent (the ledger changed nothing about sending)');
      TestAssertEqual_(TestGmailLog_.sent.length, 0, '17:00 normal run: no ops alert');

      // ---- (2) a same-day re-run: no second email, no second ledger row, the skip is recorded ----
      sendAllIssuesEmails();
      TestAssertEqual_(TestGmailLog_.drafts.length, 1, 're-run: nothing new is sent');
      TestAssertEqual_(TestEL_objects_(ss1.getSheetByName(EMAIL_LEDGER_SHEET_), L).length, 1, 're-run: no second ledger row');
      const ex = TestEL_objects_(ss1.getSheetByName(EMAIL_LEDGER_EXCLUSIONS_SHEET_), X);
      TestAssertEqual_(ex.length + ',' + ex[0].kind, '1,region', 're-run: the skipped region is recorded as a region exclusion');
      TestAssertContains_(ex[0].reason, 'already sent today', 're-run: …with the reason');
      TestAssertEqual_(ex[0].cycle_day, dayKey, 're-run: …on today\'s cycle day');

      // ---- (3) test mode never touches the ledger ----
      const rowsBefore = ss1.getSheetByName(EMAIL_LEDGER_SHEET_).getLastRow();
      TEST_MODE_OVERRIDE_EMAIL_ = TEST_EMAIL_PRIMARY_;
      try { sendAllIssuesEmails(); } finally { TEST_MODE_OVERRIDE_EMAIL_ = ''; }
      TestAssertEqual_(ss1.getSheetByName(EMAIL_LEDGER_SHEET_).getLastRow(), rowsBefore, 'test mode: no ledger row is written');
      TestAssertEqual_(ss1.getSheetByName(EMAIL_LEDGER_EXCLUSIONS_SHEET_).getLastRow(), 2, 'test mode: no exclusion row is written');
    }

    // ---- (4) Gmail refuses the send: FAILED, nothing delivered, recorded with the reason ----
    {
      const ss4 = TestEL_world_(TestEL_standardLeads_);
      TestEL_bind_(ss4);
      GmailApp.createDraft = function () { return { send: function () { throw new Error('Gmail operation not allowed for this user'); } }; };
      sendAllIssuesEmails();
      const led = TestEL_objects_(ss4.getSheetByName(EMAIL_LEDGER_SHEET_), L);
      TestAssertEqual_(led.length + ',' + led[0].status + ',' + led[0].leads_sent + ',' + led[0].message_id, '1,FAILED,0,', 'refused send: FAILED, zero leads sent, no message id');
      TestAssertContains_(led[0].status_reason, 'operation not allowed', 'refused send: the reason is recorded');
      TestAssert_(led[0].finished_at instanceof Date && led[0].attempted_at instanceof Date, 'refused send: both timestamps are stamped');
      TestAssertEqual_(ss4.getSheetByName('AllIssues_Log').getLastRow(), 1, 'refused send: nothing is logged as sent in AllIssues_Log');
      TestAssert_(TestGmailLog_.sent.some(function (e) { return /All-issues email FAILED/.test(e.subject); }), 'refused send: the existing ops alert still fires');
    }

    // ---- (5) a timeout: UNCONFIRMED (it may have been delivered), never FAILED ----
    {
      const ss5 = TestEL_world_(TestEL_standardLeads_);
      TestEL_bind_(ss5);
      GmailApp.createDraft = function () { return { send: function () { throw new Error('Service timed out: Gmail'); } }; };
      sendAllIssuesEmails();
      const led = TestEL_objects_(ss5.getSheetByName(EMAIL_LEDGER_SHEET_), L);
      TestAssertEqual_(led[0].status + ',' + led[0].leads_sent, 'UNCONFIRMED,0', 'timeout: UNCONFIRMED - the evidence says "may have been sent", not "failed"');
    }

    // ---- (6) the gate objects to ONE lead: only that lead is dropped, the rest of the bucket goes (decision D3) ----
    {
      const ss6 = TestEL_world_(TestEL_standardLeads_);
      TestEL_bind_(ss6);
      renderOvernightReportEmailHTML_ = function (opts) { return realRender(opts).split('L-NOTUPDATED').join('L-REDACTED'); }; // the html loses one lead id
      try { sendAllIssuesEmails(); } finally { renderOvernightReportEmailHTML_ = realRender; }
      TestAssertEqual_(TestGmailLog_.drafts.length, 1, 'one bad lead: the bucket email still goes out - once');
      const draft = TestGmailLog_.drafts[0];
      TestAssert_(draft.htmlBody.indexOf('L-INACTIVE') !== -1 && draft.htmlBody.indexOf('L-MULTI') !== -1, 'one bad lead: the other leads are in the email');
      TestAssert_(draft.body.indexOf('L-NOTUPDATED') === -1, 'one bad lead: the dropped lead is not in the resent email');
      const led = TestEL_objects_(ss6.getSheetByName(EMAIL_LEDGER_SHEET_), L);
      TestAssertEqual_([led[0].status, led[0].leads_planned, led[0].leads_sent, led[0].attempts].join(','), 'ACCEPTED,3,2,2', 'one bad lead: ACCEPTED, 3 planned, 2 sent, 2 attempts - the difference is visible');
      TestAssertEqual_(JSON.parse(led[0].lead_ids_json).sort().join(','), 'L-INACTIVE,L-MULTI', 'one bad lead: the ledger lists only the leads actually sent');
      const ex = TestEL_objects_(ss6.getSheetByName(EMAIL_LEDGER_EXCLUSIONS_SHEET_), X);
      TestAssertEqual_(ex.length + ',' + ex[0].kind + ',' + ex[0].lead_id + ',' + ex[0].email_id, '1,lead,L-NOTUPDATED,' + a1Id, 'one bad lead: the dropped lead is recorded against its email');
      TestAssertContains_(ex[0].reason, 'send-safety gate', 'one bad lead: …with the gate as the reason');
      TestAssertEqual_(ss6.getSheetByName('AllIssues_Log').getRange(2, 7, 1, 1).getValue(), 2, 'one bad lead: AllIssues_Log counts the 2 leads that really went');
      const notSent = TestGmailLog_.sent.filter(function (e) { return /Leads NOT sent/.test(e.subject); });
      TestAssert_(notSent.length === 1 && notSent[0].body.indexOf('L-NOTUPDATED') !== -1, 'one bad lead: the dropped lead is listed in the "Leads NOT sent" report');
      TestAssert_(!TestGmailLog_.sent.some(function (e) { return /All-issues email FAILED/.test(e.subject); }), 'one bad lead: no "email FAILED" alert - the bucket was sent');
    }

    // ---- (6b) one lead dropped by the gate AND Gmail then refuses the resend: the dropped lead is listed once, not twice ----
    {
      const ss6b = TestEL_world_(TestEL_standardLeads_);
      TestEL_bind_(ss6b);
      GmailApp.createDraft = function () { return { send: function () { throw new Error('Gmail operation not allowed for this user'); } }; };
      renderOvernightReportEmailHTML_ = function (opts) { return realRender(opts).split('L-NOTUPDATED').join('L-REDACTED'); };
      try { sendAllIssuesEmails(); } finally { renderOvernightReportEmailHTML_ = realRender; }
      const led = TestEL_objects_(ss6b.getSheetByName(EMAIL_LEDGER_SHEET_), L);
      TestAssertEqual_(led[0].status + ',' + led[0].attempts + ',' + led[0].leads_sent, 'FAILED,2,0', 'dropped then refused: FAILED after two attempts, nothing sent');
      const notSent = TestGmailLog_.sent.filter(function (e) { return /Leads NOT sent/.test(e.subject); });
      TestAssertEqual_(notSent.length, 1, 'dropped then refused: one "Leads NOT sent" report');
      TestAssertEqual_(notSent[0].body.split('L-NOTUPDATED').length - 1, 1, 'dropped then refused: the dropped lead is listed exactly once');
      TestAssertEqual_(notSent[0].body.split('L-INACTIVE').length - 1, 1, 'dropped then refused: the other leads are listed once, with the send failure');
    }

    // ---- (7) the gate objects to EVERY lead: a bucket-level BLOCKED, nothing sent ----
    {
      const ss7 = TestEL_world_(TestEL_standardLeads_);
      TestEL_bind_(ss7);
      renderOvernightReportEmailHTML_ = function (opts) { return realRender(opts).split('L-').join('X-'); };
      try { sendAllIssuesEmails(); } finally { renderOvernightReportEmailHTML_ = realRender; }
      TestAssertEqual_(TestGmailLog_.drafts.length, 0, 'every lead refused: nothing is sent');
      const led = TestEL_objects_(ss7.getSheetByName(EMAIL_LEDGER_SHEET_), L);
      TestAssertEqual_(led[0].status + ',' + led[0].leads_sent + ',' + led[0].attempts, 'BLOCKED,0,1', 'every lead refused: BLOCKED after one attempt (no pointless retry)');
      TestAssertContains_(led[0].status_reason, 'BLOCKED by the send-safety gate', 'every lead refused: the reason is recorded');
      TestAssertEqual_(TestEL_objects_(ss7.getSheetByName(EMAIL_LEDGER_EXCLUSIONS_SHEET_), X).length, 0, 'every lead refused: no per-lead exclusions (the whole bucket is the unit)');
    }

    // ---- (8) a duplicate lead id: the second copy is left out, but the lead WAS sent, so it is not reported as unsent ----
    {
      const ss8 = TestEL_world_(function (header, now, midWindow) {
        return TestEL_standardLeads_(header, now, midWindow).concat([
          TestEL_leadRow_(header, { lead_id: 'L-INACTIVE', client_id: 'C-INACTIVE-COPY', RM: 'Test RM One', lead_assigned_at: now, rm_is_active: false }),
        ]);
      });
      TestEL_bind_(ss8);
      sendAllIssuesEmails();
      const led = TestEL_objects_(ss8.getSheetByName(EMAIL_LEDGER_SHEET_), L);
      TestAssertEqual_(led[0].status + ',' + led[0].leads_planned + ',' + led[0].leads_sent, 'ACCEPTED,3,3', 'duplicate id: the email carries the lead once');
      const ex = TestEL_objects_(ss8.getSheetByName(EMAIL_LEDGER_EXCLUSIONS_SHEET_), X);
      TestAssertEqual_(ex.length + ',' + ex[0].lead_id, '1,L-INACTIVE', 'duplicate id: the second copy is recorded as an exclusion');
      TestAssertContains_(ex[0].reason, 'first copy was sent', 'duplicate id: …saying the first copy was sent');
      TestAssert_(!TestGmailLog_.sent.some(function (e) { return /Leads NOT sent/.test(e.subject); }), 'duplicate id: the lead is NOT reported as "not sent" - it was');
    }

    // ---- (9) RMs the router cannot resolve (simulated - the CH-level backstop makes this rare in production): each of their
    // leads is recorded as an exclusion with the routing reason, no email is planned for them, and the other leads are unaffected ----
    {
      const ss9 = TestEL_world_(function (header, now, midWindow) {
        return TestEL_standardLeads_(header, now, midWindow).concat([
          TestEL_leadRow_(header, { lead_id: 'L-TWO', client_id: 'C-TWO', RM: 'Test RM Three', lead_assigned_at: now, rm_is_active: false }),
        ]);
      });
      TestEL_bind_(ss9);
      const realResolve = resolveRecipientEmailsForRegion_;
      resolveRecipientEmailsForRegion_ = function (ssArg, region, rmNames, recipients, opts) {
        const res = realResolve(ssArg, region, rmNames, recipients, opts);
        // Pretend 'Test RM Three' could not be routed anywhere: take their bucket out of the results and report them unresolved.
        res.results = res.results.map(function (rec) { return Object.assign({}, rec, { rmNames: rec.rmNames.filter(function (n) { return n !== 'Test RM Three'; }) }); }).filter(function (rec) { return rec.rmNames.length; });
        res.trulyUnresolved = [{ rmName: 'Test RM Three', reason: 'simulated: no manager email on file' }];
        return res;
      };
      try { sendAllIssuesEmails(); } finally { resolveRecipientEmailsForRegion_ = realResolve; }
      const ex = TestEL_objects_(ss9.getSheetByName(EMAIL_LEDGER_EXCLUSIONS_SHEET_), X);
      TestAssertEqual_(ex.length + ',' + ex[0].lead_id + ',' + ex[0].rm + ',' + ex[0].kind, '1,L-TWO,Test RM Three,lead', 'unroutable RM: their lead is recorded as an exclusion against the RM');
      TestAssertContains_(ex[0].reason, 'no recipient could be resolved: simulated: no manager email on file', 'unroutable RM: …with the routing reason');
      const led = TestEL_objects_(ss9.getSheetByName(EMAIL_LEDGER_SHEET_), L);
      TestAssertEqual_(led.length + ',' + led[0].status + ',' + led[0].leads_sent, '1,ACCEPTED,3', 'unroutable RM: the routable bucket is unaffected');
      const notSent = TestGmailLog_.sent.filter(function (e) { return /Leads NOT sent/.test(e.subject); });
      TestAssert_(notSent.length === 1 && notSent[0].body.indexOf('L-TWO') !== -1, 'unroutable RM: the lead is also listed in the existing "Leads NOT sent" report');
    }

    // ---- (10) a broken ledger sheet never stops the email, and ops hear about it once ----
    {
      const ss10 = TestEL_world_(TestEL_standardLeads_);
      ss10._sheets['Email_Ledger'] = TestMockSheet_('Email_Ledger', [['wrong', 'header']]);
      TestEL_bind_(ss10);
      sendAllIssuesEmails();
      TestAssertEqual_(TestGmailLog_.drafts.length, 1, 'broken ledger: the email is still sent');
      TestAssertEqual_(ss10.getSheetByName('AllIssues_Log').getLastRow(), 2, 'broken ledger: AllIssues_Log is still written');
      TestAssertEqual_(TestGmailLog_.sent.filter(function (e) { return /^\[Overnight Emailer\] Email ledger:/.test(e.subject); }).length, 1, 'broken ledger: exactly one ops note');
      TestAssertEqual_(ss10.getSheetByName('Email_Ledger').getLastRow(), 1, 'broken ledger: nothing was written into the unrecognised sheet');
    }

    // ---- (11) the 10:00 / 13:00 jobs are untouched by the gate change (they ignore missingLeadIds) ----
    TestAssertOnlyTestEmails_();
  } finally {
    DriveApp = realDrive;
    renderOvernightReportEmailHTML_ = realRender;
    TEST_MODE_OVERRIDE_EMAIL_ = '';
    TestEnv_tearDown_();
  }
  return TestResults_;
}

function runEmailLedgerTestsNow() { runEmailLedgerTests_(); }
