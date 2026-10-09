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
  Gmail = TestMockGmailAdvanced_({}); // a scenario may have swapped in a failing Advanced Gmail Service
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

    // ================= EO-1b helpers =================
    {
      TestAssertEqual_(emailLedgerIdGs_('followup13', '2026-10-09', 'Pune', '', '', 'Boss@Example.TEST'), '20261009|followup13|Pune|||boss@example.test', 'email id: a recipient is appended in lower case for the jobs keyed by recipient');
      TestAssertEqual_(emailLedgerIdGs_('allIssues17', '2026-10-09', 'Pune', 'A1', 'B'), '20261009|allIssues17|Pune|A1|B', 'email id: without a recipient the 17:00 id is unchanged');

      const ssU = TestMockSpreadsheet_({});
      const hu = emailLedgerOpenGs_(ssU);
      const planU = function (id, extra) { return Object.assign({ emailId: id, job: 'followup13', dayKey: dayKey, region: 'Pune', bucketLabel: '', primaryRole: '', to: TEST_EMAIL_PRIMARY_, cc: '', leadIds: ['1'] }, extra || {}); };
      emailLedgerPlanGs_(hu, [planU('U1'), planU('U2', { initialStatus: 'SKIPPED', initialReason: 'nothing unresolved in either section' })]);
      let urows = TestEL_objects_(ssU.getSheetByName(EMAIL_LEDGER_SHEET_), L);
      TestAssertEqual_(urows[0].status + ',' + urows[0].finished_at, 'PLANNED,', 'plan: a normal plan starts PLANNED with no finish time');
      TestAssertEqual_(urows[1].status + ',' + urows[1].status_reason + ',' + urows[1].attempts, 'SKIPPED,nothing unresolved in either section,0', 'plan: a bucket known to need no email is planned directly as SKIPPED, with its reason, in the same write');
      TestAssert_(urows[1].finished_at instanceof Date, 'plan: …and stamped as finished');

      emailLedgerSkipGs_(hu, planU('U3'), 'no stored recipient');
      urows = TestEL_objects_(ssU.getSheetByName(EMAIL_LEDGER_SHEET_), L);
      TestAssertEqual_(urows[2].status + ',' + urows[2].status_reason, 'SKIPPED,no stored recipient', 'skip: an email that was never planned is planned and marked SKIPPED');

      TestAssertEqual_(emailLedgerStatusOfGs_(hu, 'U1'), 'PLANNED', 'status of: read from the cached row');
      emailLedgerFailIfOpenGs_(hu, 'U1', 'unexpected error: boom');
      TestAssertEqual_(TestEL_objects_(ssU.getSheetByName(EMAIL_LEDGER_SHEET_), L)[0].status, 'FAILED', 'fail-if-open: a still-open email is marked FAILED');
      emailLedgerAttemptGs_(hu, 'U1');
      emailLedgerResultGs_(hu, 'U1', { status: 'ACCEPTED', messageId: 'm', threadId: 't', leadIds: ['1'] });
      emailLedgerFailIfOpenGs_(hu, 'U1', 'a later exception');
      TestAssertEqual_(TestEL_objects_(ssU.getSheetByName(EMAIL_LEDGER_SHEET_), L)[0].status, 'ACCEPTED', 'fail-if-open: an email that already ended ACCEPTED is NEVER overwritten by a later exception');
      emailLedgerFailIfOpenGs_(hu, 'U2', 'x');
      TestAssertEqual_(TestEL_objects_(ssU.getSheetByName(EMAIL_LEDGER_SHEET_), L)[1].status, 'SKIPPED', 'fail-if-open: a SKIPPED email is left alone');

      // tracked send: plan + attempt + outcome, the error re-thrown unchanged
      const sentMsg = emailLedgerTrackSendGs_(hu, planU('U4'), function () { return { getId: function () { return 'mid'; }, getThread: function () { return { getId: function () { return 'tid'; } }; } }; });
      TestAssertEqual_(typeof sentMsg.getId, 'function', 'tracked send: the send result is returned to the caller');
      let u4 = TestEL_objects_(ssU.getSheetByName(EMAIL_LEDGER_SHEET_), L)[3];
      TestAssertEqual_([u4.status, u4.message_id, u4.thread_id, u4.leads_sent, u4.attempts].join(','), 'ACCEPTED,mid,tid,1,1', 'tracked send: ACCEPTED with the Gmail ids and one attempt');
      let thrown = null;
      try { emailLedgerTrackSendGs_(hu, planU('U5'), function () { throw new Error('Service timed out'); }); } catch (e) { thrown = e; }
      TestAssert_(thrown && /timed out/.test(thrown.message), 'tracked send: the original error is re-thrown unchanged');
      TestAssertEqual_(TestEL_objects_(ssU.getSheetByName(EMAIL_LEDGER_SHEET_), L)[4].status, 'UNCONFIRMED', 'tracked send: …and the ledger says UNCONFIRMED');
      TestAssertEqual_(emailLedgerTrackSendGs_(null, planU('U6'), function () { return 'sent'; }), 'sent', 'tracked send: with no ledger the send still runs and its result is returned');
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


    // ================= end to end: the 10:00 and 13:00 jobs (EO-1b) =================
    const cycleWorld = function (overrides) {
      const header = TestFixture_leadsHeader_();
      const banner = header.map(function () { return ''; });
      const now = new Date();
      const ss = TestMockSpreadsheet_({
        'RM_Hierarchy': TestMockSheet_('RM_Hierarchy', TestFixture_rmHierarchyRows_()),
        'Manager_Directory': TestMockSheet_('Manager_Directory', TestFixture_managerDirectoryRows_()),
      });
      ss._sheets['leads'] = TestMockSheet_('leads', [banner, header, TestEL_leadRow_(header, Object.assign({
        lead_id: 'L-CYCLE', client_id: 'C-CYCLE', RM: 'Test RM One', current_stage: 'Suspect',
        lead_assigned_at: TestFixture_hoursAgo_(now, 40), last_connect: 'Connected', last_connect_time: TestFixture_hoursAgo_(now, 10),
        internal_status_comments: 'Test RM One: Ringing - ' + Utilities.formatDate(TestFixture_hoursAgo_(now, 10), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm'),
      }, overrides || {}))]);
      return { ss: ss, header: header, now: now };
    };
    const ageAllIssues = function (w) { w.ss.getSheetByName('AllIssues_Log').getRange(2, 1, 1, 1).setValues([[TestFixture_daysAgo_(w.now, 1)]]); };
    const closeLead = function (w) { w.ss._sheets['leads'].getRange(3, w.header.indexOf('current_stage') + 1, 1, 1).setValues([['Won']]); };
    const ledgerRows = function (w, job) { return TestEL_objects_(w.ss.getSheetByName(EMAIL_LEDGER_SHEET_), L).filter(function (r) { return !job || r.job === job; }); };

    // ---- (12) a whole cycle: 17:00 -> 10:00 -> 13:00, every email in the ledger with its Gmail ids ----
    {
      const w = cycleWorld();
      TestEL_bind_(w.ss);
      sendAllIssuesEmails();
      ageAllIssues(w);
      sendOvernightMorningEmails();
      const tenThread = TestGmailLog_.drafts[1]._threadId;
      sendOvernightFollowupEmails();
      TestAssertEqual_(ledgerRows(w).length, 3, 'full cycle: three emails, three ledger rows (17:00, 10:00, 13:00)');
      const r17 = ledgerRows(w, 'allIssues17')[0], r10 = ledgerRows(w, 'morning10')[0], r13 = ledgerRows(w, 'followup13')[0];
      TestAssertEqual_([r17.status, r17.leads_sent].join(','), 'ACCEPTED,1', 'full cycle 17:00: ACCEPTED, 1 lead');
      TestAssertEqual_([r10.status, r10.leads_planned, r10.leads_sent, r10.attempts, r10.region, r10.primary_role, r10.bucket_label].join(','), 'ACCEPTED,1,1,1,Pune,A1,Test A1 One', 'full cycle 10:00: ACCEPTED, the checkpoint-1 lead carried, keyed to the same bucket as 17:00');
      TestAssertEqual_(r10.thread_id + ',' + r10.message_id, tenThread + ',msg_' + tenThread, 'full cycle 10:00: the ledger holds the real Gmail thread and message ids of the 10:00 email');
      TestAssertEqual_([r13.status, r13.leads_sent, r13.attempts].join(','), 'ACCEPTED,1,1', 'full cycle 13:00: ACCEPTED, 1 lead');
      TestAssertEqual_(r13.thread_id, tenThread, 'full cycle 13:00: the threaded reply is recorded against the 10:00 thread');
      TestAssert_(/^msg_/.test(r13.message_id), 'full cycle 13:00: the Gmail API message id of the reply is recorded');
      TestAssertEqual_(r13.to, TEST_EMAIL_PRIMARY_, 'full cycle 13:00: the reply\'s recipient is the one stored at 10:00');
      TestAssertEqual_(new Set([r17.email_id, r10.email_id, r13.email_id]).size, 3, 'full cycle: the three email ids are distinct');

      // a second pass of both jobs the same day adds nothing
      const before = ledgerRows(w).length;
      sendOvernightMorningEmails();
      sendOvernightFollowupEmails();
      TestAssertEqual_(ledgerRows(w).length, before, 'full cycle re-run: no new ledger rows and no new emails');
      TestAssertEqual_(TestEL_objects_(w.ss.getSheetByName(EMAIL_LEDGER_SHEET_), L).filter(function (r) { return r.status === 'ATTEMPTING' || r.status === 'PLANNED'; }).length, 0, 'full cycle: no email is left PLANNED or ATTEMPTING - every one has a final status');
    }

    // ---- (13) the lead is resolved before 10:00: no email is needed, and the ledger says SKIPPED (not "nothing") ----
    {
      const w = cycleWorld();
      TestEL_bind_(w.ss);
      sendAllIssuesEmails();
      ageAllIssues(w);
      closeLead(w);
      sendOvernightMorningEmails();
      TestAssertEqual_(TestGmailLog_.drafts.length, 1, 'resolved before 10:00: no 10:00 email is sent');
      const r10 = ledgerRows(w, 'morning10')[0];
      TestAssertEqual_(r10 ? r10.status + ',' + r10.leads_sent + ',' + r10.attempts : 'no row', 'SKIPPED,0,0', 'resolved before 10:00: the planned 10:00 email ends SKIPPED, with no attempt');
      TestAssertContains_(r10 ? r10.status_reason : '', 'no Checkpoint 1 lead is still unresolved', 'resolved before 10:00: …with the reason');
    }

    // ---- (14) resolved between 10:00 and 13:00: the reply is SKIPPED by the send function itself ----
    {
      const w = cycleWorld();
      TestEL_bind_(w.ss);
      sendAllIssuesEmails();
      ageAllIssues(w);
      sendOvernightMorningEmails();
      closeLead(w);
      sendOvernightFollowupEmails();
      TestAssertEqual_(TestGmailLog_.threadReplies.length, 0, 'resolved before 13:00: no reply is sent');
      const r13 = ledgerRows(w, 'followup13')[0];
      TestAssertEqual_(r13 ? r13.status + ',' + r13.attempts : 'no row', 'SKIPPED,0', 'resolved before 13:00: the 13:00 reply ends SKIPPED, with no attempt');
      TestAssertContains_(r13 ? r13.status_reason : '', 'nothing is still unresolved', 'resolved before 13:00: …with the reason');
    }

    // ---- (15) nothing for 13:00 to send at all: planned directly as SKIPPED in the same write ----
    {
      const w = cycleWorld();
      TestEL_bind_(w.ss);
      sendAllIssuesEmails();
      ageAllIssues(w);
      sendOvernightMorningEmails();
      w.ss.getSheetByName('AllIssues_Log').getRange(2, 14, 1, 1).setValues([['2026-01-01 00:00:00']]); // checkpoint2 already recorded -> nothing pending
      sendOvernightFollowupEmails();
      const r13 = ledgerRows(w, 'followup13')[0];
      TestAssertEqual_(r13 ? r13.status + ',' + r13.status_reason : 'no row', 'SKIPPED,nothing unresolved in either section', 'nothing for 13:00: the bucket is recorded SKIPPED up front');
    }

    // ---- (16) the threaded reply fails definitely and the plain fallback goes out: ACCEPTED, with the fallback's own ids ----
    {
      const w = cycleWorld();
      TestEL_bind_(w.ss);
      sendAllIssuesEmails();
      ageAllIssues(w);
      sendOvernightMorningEmails();
      const tenThread = TestGmailLog_.drafts[1]._threadId;
      Gmail = TestMockGmailAdvanced_({ shouldFail: true });
      sendOvernightFollowupEmails();
      const r13 = ledgerRows(w, 'followup13')[0];
      const fallbackDraft = TestGmailLog_.drafts[TestGmailLog_.drafts.length - 1];
      TestAssertEqual_(r13.status, 'ACCEPTED', 'fallback reply: ACCEPTED');
      TestAssertEqual_(r13.thread_id + ',' + r13.message_id, fallbackDraft._threadId + ',msg_' + fallbackDraft._threadId, 'fallback reply: the ids are the fallback message\'s own, not the 10:00 thread');
      TestAssert_(r13.thread_id !== tenThread, 'fallback reply: it is recorded as a new thread (it did not thread into the 10:00 email)');
    }

    // ---- (17) a threaded reply that ends ambiguously: UNCONFIRMED, and no second copy is sent ----
    {
      const w = cycleWorld();
      TestEL_bind_(w.ss);
      sendAllIssuesEmails();
      ageAllIssues(w);
      sendOvernightMorningEmails();
      const draftsBefore = TestGmailLog_.drafts.length;
      Gmail = TestMockGmailAdvanced_({});
      Gmail.Users.Messages.send = function () { throw new Error('Service timed out: Gmail'); };
      sendOvernightFollowupEmails();
      const r13 = ledgerRows(w, 'followup13')[0];
      TestAssertEqual_(r13.status + ',' + r13.leads_sent, 'UNCONFIRMED,0', 'ambiguous reply: UNCONFIRMED - it may have been delivered');
      TestAssertEqual_(TestGmailLog_.drafts.length, draftsBefore, 'ambiguous reply: no fallback copy was sent');
    }

    // ---- (18) the CH-level report (a CH personally holding a flagged lead) is in the ledger too ----
    {
      const w = cycleWorld({ lead_id: 'L-CH', client_id: 'C-CH', RM: 'Test CH Self', lead_assigned_at: new Date(), rm_is_active: false, last_connect: '', last_connect_time: '', internal_status_comments: '' });
      TestEL_bind_(w.ss);
      sendAllIssuesEmails();
      const ch = ledgerRows(w, 'chLevel17');
      TestAssertEqual_(ch.length, 1, 'CH-level report: one ledger row');
      TestAssertEqual_([ch[0].status, ch[0].bucket_label, ch[0].leads_sent, ch[0].region].join(','), 'ACCEPTED,Test CH Self,1,Pune', 'CH-level report: ACCEPTED, named for the CH, carrying the lead');
      TestAssert_(/^msg_/.test(ch[0].message_id), 'CH-level report: the Gmail message id is recorded');
      TestAssertEqual_(ledgerRows(w, 'allIssues17').length, 0, 'CH-level report: it is not mistaken for an ordinary 17:00 bucket');
    }

    // ---- (19) the 10:00 job with a real overnight lead AND a CH-held one: both are in the ledger, each as its own email ----
    {
      const header = TestFixture_leadsHeader_();
      const banner = header.map(function () { return ''; });
      const nowO = new Date();
      const owin = overnightWindowGs_(nowO);
      const omid = new Date(Math.min((owin.from.getTime() + owin.to.getTime()) / 2, nowO.getTime() - 3.5 * 3600 * 1000));
      const ssO = TestMockSpreadsheet_({
        'RM_Hierarchy': TestMockSheet_('RM_Hierarchy', TestFixture_rmHierarchyRows_()),
        'Manager_Directory': TestMockSheet_('Manager_Directory', TestFixture_managerDirectoryRows_()),
      });
      ssO._sheets['leads'] = TestMockSheet_('leads', [banner, header,
        TestEL_leadRow_(header, { lead_id: 'L-A', client_id: 'C-A', RM: 'Test RM One', lead_assigned_at: omid }),
        TestEL_leadRow_(header, { lead_id: 'L-CH', client_id: 'C-CH', RM: 'Test CH Self', lead_assigned_at: omid }),
      ]);
      TestEL_bind_(ssO);
      sendOvernightMorningEmails();
      const wO = { ss: ssO };
      const m10 = ledgerRows(wO, 'morning10'), c10 = ledgerRows(wO, 'chLevel10');
      TestAssertEqual_(m10.length + ',' + (m10[0] ? [m10[0].status, m10[0].leads_sent, m10[0].bucket_label].join('/') : ''), '1,ACCEPTED/1/Test A1 One', '10:00 overnight: the ordinary bucket is ACCEPTED with its one lead');
      TestAssertEqual_(JSON.parse(m10[0].lead_ids_json).join(','), 'L-A', '10:00 overnight: the ledger lists the lead the email carried');
      TestAssertEqual_(c10.length + ',' + (c10[0] ? [c10[0].status, c10[0].leads_sent, c10[0].bucket_label].join('/') : ''), '1,ACCEPTED/1/Test CH Self', '10:00 overnight: the CH-level report is its own ledger row');
      TestAssert_(c10[0] && /^msg_/.test(c10[0].message_id), '10:00 overnight: the CH-level report records its Gmail message id');
      sendOvernightMorningEmails();
      TestAssertEqual_(ledgerRows(wO).length, 2, '10:00 overnight re-run: no new ledger rows');
      const exO = TestEL_objects_(ssO.getSheetByName(EMAIL_LEDGER_EXCLUSIONS_SHEET_), X);
      TestAssertEqual_(exO.length + ',' + (exO[0] ? exO[0].kind : ''), '1,region', '10:00 overnight re-run: the skipped Section 1 is recorded as a region exclusion');
    }

    // ---- (20) a 10:00 bucket that throws unexpectedly: its row is closed as FAILED, never left PLANNED/ATTEMPTING ----
    {
      const w = cycleWorld();
      TestEL_bind_(w.ss);
      sendAllIssuesEmails();
      ageAllIssues(w);
      const realCombined = sendCombinedMorningEmail_;
      sendCombinedMorningEmail_ = function () { throw new Error('simulated bucket crash'); };
      try { sendOvernightMorningEmails(); } finally { sendCombinedMorningEmail_ = realCombined; }
      const r10 = ledgerRows(w, 'morning10')[0];
      TestAssertEqual_(r10 ? r10.status : 'no row', 'FAILED', 'bucket crash at 10:00: the ledger row is closed as FAILED');
      TestAssertContains_(r10 ? r10.status_reason : '', 'simulated bucket crash', 'bucket crash at 10:00: …with the error');
    }

    // ---- (21) a broken ledger at 10:00 and at 13:00: the emails still go and ONE ops note names the job ----
    {
      const w = cycleWorld();
      TestEL_bind_(w.ss);
      sendAllIssuesEmails();
      ageAllIssues(w);
      w.ss.getSheetByName(EMAIL_LEDGER_SHEET_).getRange(1, 1, 1, 1).setValues([['broken']]);
      const draftsBefore = TestGmailLog_.drafts.length;
      sendOvernightMorningEmails();
      TestAssertEqual_(TestGmailLog_.drafts.length, draftsBefore + 1, 'broken ledger at 10:00: the 10:00 email is still sent');
      const note10 = TestGmailLog_.sent.filter(function (e) { return /Email ledger:.*the 10:00 morning run/.test(e.subject); });
      TestAssertEqual_(note10.length, 1, 'broken ledger at 10:00: exactly one ops note, naming the 10:00 run');
      sendOvernightFollowupEmails();
      TestAssertEqual_(TestGmailLog_.threadReplies.length, 1, 'broken ledger at 13:00: the 13:00 reply is still sent');
      const note13 = TestGmailLog_.sent.filter(function (e) { return /Email ledger:.*the 13:00 follow-up run/.test(e.subject); });
      TestAssertEqual_(note13.length, 1, 'broken ledger at 13:00: exactly one ops note, naming the 13:00 run');
    }

    // ================= EO-2: the incident log and held alerts =================
    const I = EMAIL_INCIDENT_HEADERS_;
    const incidentRows = function (ss) { const sh = ss.getSheetByName(EMAIL_INCIDENT_LOG_SHEET_); return sh ? TestEL_objects_(sh, I) : []; };
    const failingGmailFor = function (leadId) {
      const realCD = GmailApp.createDraft;
      GmailApp.createDraft = function (to, subject, body, options) {
        if (!leadId || String((options && options.htmlBody) || '').indexOf(leadId) !== -1) return { send: function () { throw new Error('Gmail operation not allowed for this user'); } };
        return realCD.apply(GmailApp, arguments);
      };
    };
    const twoRegionWorld = function () {
      return TestEL_world_(function (header, now) {
        return [
          TestEL_leadRow_(header, { lead_id: 'L-PUNE', client_id: 'C-PUNE', RM: 'Test RM One', region: 'Pune', lead_assigned_at: now, rm_is_active: false }),
          TestEL_leadRow_(header, { lead_id: 'L-THANE', client_id: 'C-THANE', RM: 'Test RM One', region: 'Thane', lead_assigned_at: now, rm_is_active: false }),
        ];
      });
    };

    // ---- severity guesses (spec section 3) ----
    TestAssertEqual_(['sendAllIssuesEmails crashed \u2014 NO All-Issues emails were sent this run', 'sendOvernightFollowupEmails SKIPPED \u2014 another email job was still running', 'WATCHDOG: sendAllIssuesEmails did not run'].map(incidentSeverityGs_).join(','), 'CRITICAL,CRITICAL,CRITICAL', 'severity: a whole job crashing, being skipped or not running is CRITICAL');
    TestAssertEqual_(['sendAllIssuesEmails ran in TEST MODE \u2014 real recipients suppressed', 'x ran WITHOUT its overlap lock'].map(incidentSeverityGs_).join(','), 'HIGH,HIGH', 'severity: a suppressed-recipients test run and a missing lock are HIGH');
    TestAssertEqual_(['All-issues email FAILED - Pune', 'Morning email failed for Pune'].map(incidentSeverityGs_).join(','), 'MEDIUM,MEDIUM', 'severity: one bucket failing is MEDIUM (an isolated item)');
    TestAssertEqual_(incidentSeverityGs_('Email ledger: 2 write(s) failed during the 17:00 run - the emails were NOT affected'), 'LOW', 'severity: bookkeeping notes are LOW');

    // ---- (22) an alert raised OUTSIDE an email job is sent at once and recorded ----
    {
      const ssI = TestMockSpreadsheet_({});
      TestEL_bind_(ssI);
      const ok = notifyOpsAlertGs_('Something FAILED', ['line one', 'line two']);
      TestAssertEqual_(ok, true, 'alert outside a job: reported as sent');
      TestAssertEqual_(TestGmailLog_.sent.length + ',' + TestGmailLog_.sent[0].subject, '1,[Overnight Emailer] Something FAILED', 'alert outside a job: sent at once with its original subject');
      const inc = incidentRows(ssI);
      TestAssertEqual_(inc.length + ',' + inc[0].severity + ',' + inc[0].scope + ',' + inc[0].notification + ',' + inc[0].attention_required + ',' + inc[0].owner, '1,MEDIUM,item,SENT,yes,Snehil', 'alert outside a job: one incident row, SENT, attention required, owned by Snehil');
      TestAssert_(/^INC-\d{8}-\d{6}-\d+$/.test(inc[0].incident_id), 'alert outside a job: the incident id is INC-yyyymmdd-hhmmss-n');
      TestAssertEqual_(inc[0].detail, 'line one\nline two', 'alert outside a job: the incident keeps the alert text');
      TestAssert_(inc[0].notified_at instanceof Date && inc[0].detected_at instanceof Date, 'alert outside a job: detection and notification times are stamped');
      TestAssertContains_(inc[0].continuity, 'Sent immediately', 'alert outside a job: the continuity note says it was sent immediately');
    }

    // ---- (23) one bucket fails, the other is fine: ONE alert, sent AFTER the job, saying 1 of 2 went out ----
    {
      const w23 = { ss: twoRegionWorld() };
      TestEL_bind_(w23.ss);
      failingGmailFor('L-PUNE');
      sendAllIssuesEmails();
      const alerts = TestGmailLog_.sent.filter(function (e) { return /All-issues email FAILED/.test(e.subject); });
      TestAssertEqual_(alerts.length, 1, 'held alert: exactly one failure alert is sent');
      TestAssertEqual_(alerts[0].subject, '[Overnight Emailer] All-issues email FAILED - Pune (A1/Test A1 One)', 'held alert: a single alert keeps its own subject');
      const firstLine = alerts[0].body.split('\n')[0];
      TestAssertContains_(firstLine, 'CONFIRMATION: 2 bucket email(s) were handled in this run', 'held alert: it opens with the count of emails handled');
      TestAssertContains_(firstLine, '1 accepted by Gmail', 'held alert: …saying one was accepted by Gmail (the Thane email)');
      TestAssertContains_(firstLine, '1 failed', 'held alert: …and one failed');
      TestAssertContains_(alerts[0].body, 'Intended recipient:', 'held alert: the original alert text follows the confirmation');
      const led = TestEL_objects_(w23.ss.getSheetByName(EMAIL_LEDGER_SHEET_), L);
      TestAssertEqual_(led.map(function (r) { return r.region + ':' + r.status; }).sort().join(','), 'Pune:FAILED,Thane:ACCEPTED', 'held alert: the other region\'s email went out normally');
      const inc = incidentRows(w23.ss);
      TestAssertEqual_(inc.length + ',' + inc[0].notification + ',' + inc[0].severity + ',' + inc[0].job, '1,SENT,MEDIUM,sendAllIssuesEmails', 'held alert: one incident, SENT after the job, tied to the job');
      TestAssertContains_(inc[0].continuity, '1 accepted by Gmail', 'held alert: the incident\'s continuity note records the confirmation');
      TestAssert_(EMAIL_ALERT_HOLD_ === null, 'held alert: nothing is held after the job ended');
    }

    // ---- (24) several alerts in one run: ONE message ----
    {
      const w24 = { ss: twoRegionWorld() };
      TestEL_bind_(w24.ss);
      failingGmailFor(null);
      sendAllIssuesEmails();
      const combined = TestGmailLog_.sent.filter(function (e) { return /alerts from this run/.test(e.subject); });
      TestAssertEqual_(combined.length, 1, 'several alerts: one consolidated message');
      TestAssertContains_(combined[0].subject, '17:00 All-Issues emails: 2 alerts from this run', 'several alerts: the subject names the job and the count');
      TestAssertContains_(combined[0].body, '--- Alert 1 of 2:', 'several alerts: each alert is a section of the message');
      TestAssertContains_(combined[0].body, '--- Alert 2 of 2:', 'several alerts: …both of them');
      TestAssertEqual_(TestGmailLog_.sent.filter(function (e) { return /All-issues email FAILED/.test(e.subject); }).length, 0, 'several alerts: no separate message per alert');
      TestAssertEqual_(incidentRows(w24.ss).map(function (r) { return r.notification; }).join(','), 'SENT,SENT', 'several alerts: both incidents are SENT');
      TestAssertContains_(combined[0].body.split('\n')[0], '2 failed', 'several alerts: the confirmation says nothing went out');
    }

    // ---- (25) a whole-job crash is sent AT ONCE (nothing left to confirm), and recorded CRITICAL ----
    {
      const w25 = { ss: TestEL_world_(TestEL_standardLeads_) };
      TestEL_bind_(w25.ss);
      const realRead = readLeadsTab_;
      readLeadsTab_ = function () { throw new Error('simulated total failure'); };
      try { TestAssertThrows_(function () { sendAllIssuesEmails(); }, 'crash: the error is still re-thrown (Executions shows Failed)'); } finally { readLeadsTab_ = realRead; }
      const crash = TestGmailLog_.sent.filter(function (e) { return /sendAllIssuesEmails crashed/.test(e.subject); });
      TestAssertEqual_(crash.length, 1, 'crash: one alert');
      TestAssert_(crash[0].body.indexOf('CONFIRMATION') === -1, 'crash: it is sent immediately, with no held-alert confirmation');
      const inc = incidentRows(w25.ss);
      TestAssertEqual_(inc.length + ',' + inc[0].severity + ',' + inc[0].scope + ',' + inc[0].notification, '1,CRITICAL,system,SENT', 'crash: recorded as a CRITICAL, system-wide incident, SENT');
      TestAssertContains_(inc[0].continuity, 'Sent immediately', 'crash: …"sent immediately"');
      TestAssert_(EMAIL_ALERT_HOLD_ === null, 'crash: the hold is cleared even though the job threw');
      TestAssertEqual_(readEmailJobRunGs_('sendAllIssuesEmails').status, 'failed', 'crash: the run record still says failed');
    }

    // ---- (26) a job killed before it could send its held alerts: the watchdog releases them ----
    {
      const ssK = TestMockSpreadsheet_({});
      TestEL_bind_(ssK);
      emailAlertHoldStartGs_('sendAllIssuesEmails');
      notifyOpsAlertGs_('All-issues email FAILED - Pune (A1/Bucket)', ['the failure text']);
      TestAssertEqual_(TestGmailLog_.sent.length, 0, 'killed job: the alert is held, not sent');
      EMAIL_ALERT_HOLD_ = null; // the platform killed the run here: no flush ever happens
      TestAssertEqual_(incidentRows(ssK)[0].notification, 'HELD', 'killed job: the incident is on record as HELD');
      TestAssertEqual_(releaseHeldIncidentsGs_(new Date()), 0, 'killed job: a fresh HELD incident is NOT released (its job may still be running)');
      TestAssertEqual_(TestGmailLog_.sent.length, 0, 'killed job: nothing sent yet');
      ssK.getSheetByName(EMAIL_INCIDENT_LOG_SHEET_).getRange(2, I.indexOf('detected_at') + 1, 1, 1).setValues([[new Date(Date.now() - 60 * 60000)]]);
      checkEmailJobsCompletedGs_(new Date()); // the hourly watchdog
      const released = TestGmailLog_.sent.filter(function (e) { return /Held alert\(s\) released/.test(e.subject); });
      TestAssertEqual_(released.length, 1, 'killed job: an hour later the watchdog sends ONE release message');
      TestAssertContains_(released[0].body, 'All-issues email FAILED - Pune (A1/Bucket)', 'killed job: …listing the alert that was held');
      TestAssertContains_(released[0].body, 'the failure text', 'killed job: …with its text');
      TestAssertEqual_(incidentRows(ssK)[0].notification, 'RELEASED', 'killed job: the incident is marked RELEASED');
      const before = TestGmailLog_.sent.length;
      checkEmailJobsCompletedGs_(new Date());
      TestAssertEqual_(TestGmailLog_.sent.filter(function (e) { return /Held alert\(s\) released/.test(e.subject); }).length, 1, 'killed job: the next watchdog run does not release it a second time');
    }

    // ---- (27) test mode: alerts go at once, nothing is recorded ----
    {
      const ssT = TestMockSpreadsheet_({});
      TestEL_bind_(ssT);
      TEST_MODE_OVERRIDE_EMAIL_ = TEST_EMAIL_PRIMARY_;
      try { notifyOpsAlertGs_('Test mode alert', ['x']); } finally { TEST_MODE_OVERRIDE_EMAIL_ = ''; }
      TestAssertEqual_(TestGmailLog_.sent.length, 1, 'test mode: the alert is sent');
      TestAssert_(!ssT.getSheetByName(EMAIL_INCIDENT_LOG_SHEET_), 'test mode: no Incident_Log is created or written');
    }

    // ---- (28) a broken Incident_Log never stops an alert ----
    {
      const ssB = TestMockSpreadsheet_({ 'Incident_Log': TestMockSheet_('Incident_Log', [['not', 'the', 'header']]) });
      TestEL_bind_(ssB);
      const ok = notifyOpsAlertGs_('Another FAILED', ['x']);
      TestAssertEqual_(ok + ',' + TestGmailLog_.sent.length, 'true,1', 'broken incident sheet: the alert is still sent');
      TestAssertEqual_(ssB.getSheetByName('Incident_Log').getLastRow(), 1, 'broken incident sheet: nothing is written into the unrecognised sheet');
    }

    // ---- (29) no ledger in the run: the held alert says so instead of inventing a count ----
    {
      const ssN = TestEL_world_(TestEL_standardLeads_);
      ssN._sheets['Email_Ledger'] = TestMockSheet_('Email_Ledger', [['wrong', 'header']]);
      TestEL_bind_(ssN);
      sendAllIssuesEmails();
      const note = TestGmailLog_.sent.filter(function (e) { return /Email ledger:/.test(e.subject); });
      TestAssertEqual_(note.length, 1, 'no ledger: the ledger note is still sent once');
      TestAssertContains_(note[0].body.split('\n')[0], 'CONFIRMATION UNAVAILABLE', 'no ledger: the confirmation line says the count cannot be stated');
      TestAssertEqual_(incidentRows(ssN).map(function (r) { return r.severity; }).join(','), 'LOW', 'no ledger: recorded as a LOW incident');
    }

    // ---- (30) a job that never opened a ledger must not borrow the PREVIOUS run's counts ----
    {
      const w30 = { ss: TestEL_world_(TestEL_standardLeads_) };
      TestEL_bind_(w30.ss);
      sendAllIssuesEmails(); // leaves a live ledger handle with real counts behind
      TestGmailLog_.sent.length = 0;
      withEmailJobLockGs_('sendOvernightFollowupEmails', function () { notifyOpsAlertGs_('Something FAILED early', ['it stopped before opening the ledger']); });
      const early = TestGmailLog_.sent.filter(function (e) { return /Something FAILED early/.test(e.subject); });
      TestAssertEqual_(early.length, 1, 'stale counts: the early alert is sent after the job');
      TestAssertContains_(early[0].body.split('\n')[0], 'CONFIRMATION UNAVAILABLE', 'stale counts: it does NOT state the previous run counts as its own');
    }

    // ---- (31) the 10:00 and 13:00 whole-job crashes are sent AT ONCE too ----
    {
      const w31 = cycleWorld();
      TestEL_bind_(w31.ss);
      sendAllIssuesEmails();
      ageAllIssues(w31);
      const realRead = readLeadsTab_;
      readLeadsTab_ = function () { throw new Error('simulated total failure'); };
      try {
        TestAssertThrows_(function () { sendOvernightMorningEmails(); }, '10:00 crash: re-thrown');
        const crash10 = TestGmailLog_.sent.filter(function (e) { return /sendOvernightMorningEmails crashed/.test(e.subject); });
        TestAssertEqual_(crash10.length, 1, '10:00 crash: one alert');
        TestAssert_(crash10[0].body.indexOf('CONFIRMATION') === -1, '10:00 crash: sent immediately, no held-alert confirmation');
      } finally { readLeadsTab_ = realRead; }
      sendOvernightMorningEmails();
      readLeadsTab_ = function () { throw new Error('simulated total failure'); };
      try {
        TestAssertThrows_(function () { sendOvernightFollowupEmails(); }, '13:00 crash: re-thrown');
        const crash13 = TestGmailLog_.sent.filter(function (e) { return /sendOvernightFollowupEmails crashed/.test(e.subject); });
        TestAssertEqual_(crash13.length, 1, '13:00 crash: one alert');
        TestAssert_(crash13[0].body.indexOf('CONFIRMATION') === -1, '13:00 crash: sent immediately, no held-alert confirmation');
      } finally { readLeadsTab_ = realRead; }
      TestAssert_(EMAIL_ALERT_HOLD_ === null, '10:00/13:00 crash: nothing is left held');
    }

    // ================= EO-9: recovering failed 17:00 buckets =================
    {
      const noonToday = new Date(istDayKeyGs_(new Date()) + 'T12:00:00+05:30');
      const late = new Date(istDayKeyGs_(new Date()) + 'T18:31:00+05:30');
      const ledgerOf = function (ssX) { return TestEL_objects_(ssX.getSheetByName(EMAIL_LEDGER_SHEET_), L); };
      const byRegion = function (ssX, region) { return ledgerOf(ssX).filter(function (r) { return r.region === region; })[0]; };
      const mkFailedPune = function () {
        const w = twoRegionWorld();
        TestEL_bind_(w);
        failingGmailFor('L-PUNE');
        sendAllIssuesEmails();
        GmailApp = TestMockGmailApp_({}); // Gmail works again
        TestGmailLog_.sent.length = 0;
        return w;
      };

      // ---- (32) one bucket failed, its sibling went out: only the failed one is re-sent ----
      {
        const w = mkFailedPune();
        const draftsBefore = TestGmailLog_.drafts.length;
        const exBefore = TestEL_objects_(w.getSheetByName(EMAIL_LEDGER_EXCLUSIONS_SHEET_), X).length;
        const res = recoverFailedAllIssuesBuckets_({ now: noonToday });
        TestAssertEqual_(res.ran + ',' + res.targets.length + ',' + res.targets[0].region + ',' + res.targets[0].status, 'true,1,Pune,FAILED', 'recovery: one FAILED bucket found and re-run');
        TestAssertEqual_(TestGmailLog_.drafts.length, draftsBefore + 1, 'recovery: exactly one email is sent - the failed bucket');
        TestAssertContains_(TestGmailLog_.drafts[TestGmailLog_.drafts.length - 1].htmlBody, 'L-PUNE', 'recovery: …and it is the Pune bucket');
        const pune = byRegion(w, 'Pune'), thane = byRegion(w, 'Thane');
        TestAssertEqual_([pune.status, pune.attempts, pune.leads_sent].join(','), 'ACCEPTED,2,1', 'recovery: the Pune row is now ACCEPTED after a second attempt');
        TestAssertEqual_([thane.status, thane.attempts].join(','), 'ACCEPTED,1', 'recovery: the Thane row is untouched (not sent a second time)');
        TestAssertEqual_(ledgerOf(w).length, 2, 'recovery: no extra ledger rows');
        TestAssertEqual_(TestEL_objects_(w.getSheetByName(EMAIL_LEDGER_EXCLUSIONS_SHEET_), X).length, exBefore, 'recovery: the original run\'s exclusion rows are not repeated');
        TestAssertEqual_(w.getSheetByName('AllIssues_Log').getLastRow(), 3, 'recovery: AllIssues_Log now holds both regions\' rows (header + 2)');
        TestAssert_(!TestGmailLog_.sent.some(function (e) { return /FAILED|BLOCKED/.test(e.subject); }), 'recovery: no failure alert when the re-send worked');
        // and it is not recoverable twice
        const again = recoverFailedAllIssuesBuckets_({ now: noonToday });
        TestAssertEqual_(again.ran + ',' + again.targets.length, 'false,0', 'recovery: once recovered there is nothing left to recover');
        TestAssertEqual_(TestGmailLog_.drafts.length, draftsBefore + 1, 'recovery: …and a second call sends nothing');
      }

      // ---- (32b) the region already has a logged sibling bucket: the "already sent today" guard must not stop the recovery ----
      {
        const w = mkFailedPune();
        ensureAllIssuesLogSheet_(w).appendRow([new Date(), 'Pune', 'Sibling Bucket', 'A1', 'sibling@example.test', '', 1, new Date(), 'thread-sibling', '[]']);
        const draftsBefore = TestGmailLog_.drafts.length;
        recoverFailedAllIssuesBuckets_({ now: noonToday });
        TestAssertEqual_(TestGmailLog_.drafts.length + ',' + byRegion(w, 'Pune').status, (draftsBefore + 1) + ',ACCEPTED', 'region guard: a sibling already logged for the region does not stop the failed bucket being re-sent');
      }

      // ---- (32c) an exclusion recorded by the original run is not recorded a second time by the recovery ----
      {
        const w = TestEL_world_(function (header, now) {
          const row = function (id, client) { return TestEL_leadRow_(header, { lead_id: id, client_id: client, RM: 'Test RM One', region: 'Pune', lead_assigned_at: now, rm_is_active: false }); };
          return [row('L-PUNE', 'C-1'), row('L-PUNE', 'C-2')]; // a duplicate lead id: the second copy is left out
        });
        TestEL_bind_(w);
        failingGmailFor('L-PUNE');
        sendAllIssuesEmails();
        GmailApp = TestMockGmailApp_({});
        const exBefore = TestEL_objects_(w.getSheetByName(EMAIL_LEDGER_EXCLUSIONS_SHEET_), X).length;
        TestAssertEqual_(exBefore, 1, 'exclusions: set up - the original run recorded the duplicate once');
        recoverFailedAllIssuesBuckets_({ now: noonToday });
        TestAssertEqual_(TestEL_objects_(w.getSheetByName(EMAIL_LEDGER_EXCLUSIONS_SHEET_), X).length, exBefore, 'exclusions: the recovery does not record the same duplicate again');
        TestAssertEqual_(byRegion(w, 'Pune').status, 'ACCEPTED', 'exclusions: …and the bucket was recovered');
      }

      // ---- (32d) the CH-level report of the original run is not repeated by the recovery (even if its once-a-day record were lost) ----
      {
        const w = TestEL_world_(function (header, now) {
          return [
            TestEL_leadRow_(header, { lead_id: 'L-PUNE', client_id: 'C-PUNE', RM: 'Test RM One', region: 'Pune', lead_assigned_at: now, rm_is_active: false }),
            TestEL_leadRow_(header, { lead_id: 'L-CHX', client_id: 'C-CHX', RM: 'Test CH Self', region: 'Pune', lead_assigned_at: now, rm_is_active: false }),
          ];
        });
        TestEL_bind_(w);
        failingGmailFor('L-PUNE');
        sendAllIssuesEmails();
        GmailApp = TestMockGmailApp_({});
        TestAssertEqual_(ledgerOf(w).filter(function (r) { return r.job === 'chLevel17'; }).length, 1, 'CH-level: set up - the original run sent the CH-level report');
        PropertiesService = TestMockPropertiesService_(); // the once-a-day record of that report is gone
        const draftsBefore = TestGmailLog_.drafts.length;
        recoverFailedAllIssuesBuckets_({ now: noonToday });
        TestAssertEqual_(TestGmailLog_.drafts.length, draftsBefore + 1, 'CH-level: the recovery sends only the failed bucket - not the CH-level report again');
        TestAssertEqual_(ledgerOf(w).filter(function (r) { return r.job === 'chLevel17'; }).length, 1, 'CH-level: …and the ledger still has one CH-level row');
      }

      // ---- (33) nothing failed at all ----
      {
        const w = TestEL_world_(TestEL_standardLeads_);
        TestEL_bind_(w);
        sendAllIssuesEmails();
        const draftsBefore = TestGmailLog_.drafts.length;
        const res = recoverFailedAllIssuesBuckets_({ now: noonToday });
        TestAssertEqual_(res.ran + ',' + res.targets.length + ',' + TestGmailLog_.drafts.length, 'false,0,' + draftsBefore, 'recovery: with nothing failed nothing is sent');
        recoverFailedAllIssuesBucketsNow(); // the entry point (through the job lock) is also a quiet no-op
        TestAssertEqual_(TestGmailLog_.drafts.length, draftsBefore, 'recovery: the entry point sends nothing either');
      }

      // ---- (33b) only 17:00 bucket rows are targets: a failed CH-level or 10:00 row is not ----
      {
        const ssC = TestMockSpreadsheet_({});
        TestEL_bind_(ssC);
        const hC = emailLedgerOpenGs_(ssC);
        const dayC = istDayKeyGs_(new Date());
        ['chLevel17', 'morning10', 'followup13'].forEach(function (job) {
          const idC = emailLedgerIdGs_(job, dayC, 'Pune', 'A1', 'B ' + job);
          emailLedgerPlanGs_(hC, [{ emailId: idC, job: job, dayKey: dayC, region: 'Pune', bucketLabel: 'B ' + job, primaryRole: 'A1', to: TEST_EMAIL_PRIMARY_, leadIds: ['1'] }]);
          emailLedgerAttemptGs_(hC, idC);
          emailLedgerResultGs_(hC, idC, { status: 'FAILED', reason: 'x', leadIds: [] });
        });
        TestAssertEqual_(allIssuesRecoveryTargetsGs_(ssC, new Date()).length, 0, 'targets: failed CH-level / 10:00 / 13:00 rows are not 17:00 recovery targets');
      }

      // ---- (34) past the 18:30 cutoff: not sent late, unless forced ----
      {
        const w = mkFailedPune();
        const draftsBefore = TestGmailLog_.drafts.length;
        const res = recoverFailedAllIssuesBuckets_({ now: late });
        TestAssertEqual_(res.ran + ',' + res.cutoff + ',' + res.targets.length, 'false,true,1', 'cutoff: after 18:30 the failed bucket is found but not sent');
        TestAssertEqual_(TestGmailLog_.drafts.length + ',' + byRegion(w, 'Pune').status, draftsBefore + ',FAILED', 'cutoff: no email, and the ledger still says FAILED');
        TestAssertEqual_(allIssuesLateCutoffPassedGs_(new Date(istDayKeyGs_(new Date()) + 'T18:30:00+05:30')) + ',' + allIssuesLateCutoffPassedGs_(late), 'false,true', 'cutoff: 18:30 itself is still allowed, 18:31 is not');
        const forced = recoverFailedAllIssuesBuckets_({ now: late, force: true });
        TestAssertEqual_(forced.ran + ',' + TestGmailLog_.drafts.length + ',' + byRegion(w, 'Pune').status, 'true,' + (draftsBefore + 1) + ',ACCEPTED', 'cutoff: force sends it on purpose');
      }

      // ---- (35) the lead was resolved meanwhile: re-checked from current data, nothing is sent, the row says why ----
      {
        const w = mkFailedPune();
        const draftsBefore = TestGmailLog_.drafts.length;
        const header = TestFixture_leadsHeader_();
        w._sheets['leads'].getRange(3, header.indexOf('current_stage') + 1, 1, 1).setValues([['Won']]); // L-PUNE is the first lead row
        recoverFailedAllIssuesBuckets_({ now: noonToday });
        TestAssertEqual_(TestGmailLog_.drafts.length, draftsBefore, 'revalidation: a resolved lead is not emailed');
        const pune = byRegion(w, 'Pune');
        TestAssertEqual_(pune.status, 'SKIPPED', 'revalidation: the row is closed as SKIPPED, not left FAILED without a reason');
        TestAssertContains_(pune.status_reason, 'recovery:', 'revalidation: …with the reason');
      }

      // ---- (36) Gmail still refuses: it stays FAILED after a second attempt, and ops are told ----
      {
        const w = mkFailedPune();
        failingGmailFor('L-PUNE');
        recoverFailedAllIssuesBuckets_({ now: noonToday });
        const pune = byRegion(w, 'Pune');
        TestAssertEqual_(pune.status + ',' + pune.attempts, 'FAILED,2', 'still failing: FAILED after a second attempt');
        TestAssert_(TestGmailLog_.sent.some(function (e) { return /All-issues email FAILED/.test(e.subject); }), 'still failing: the failure alert fires again');
        const failAlert = TestGmailLog_.sent.filter(function (e) { return /All-issues email FAILED/.test(e.subject); })[0];
        TestAssertContains_(failAlert.body, 'recoverFailedAllIssuesBucketsNow() before 18:30 IST', 'still failing: the alert tells you how to re-send just this bucket, and until when');
      }

      // ---- (36b) through the entry point: the recovery job holds its alerts and states what went out ----
      {
        const w = mkFailedPune();
        failingGmailFor('L-PUNE');
        recoverFailedAllIssuesBucketsForceNow();
        const alerts = TestGmailLog_.sent.filter(function (e) { return /All-issues email FAILED/.test(e.subject); });
        TestAssertEqual_(alerts.length, 1, 'entry point: one failure alert after the recovery run');
        TestAssertContains_(alerts[0].body.split('\n')[0], 'CONFIRMATION: 1 bucket email(s) were handled in this run', 'entry point: the alert was held until the end and opens with the count');
        TestAssertContains_(alerts[0].body.split('\n')[0], '1 failed', 'entry point: …saying the re-send failed');
        TestAssertEqual_(readEmailJobRunGs_(EMAIL_RECOVERY_JOB_).status, 'completed', 'entry point: the run is recorded');
      }

      // ---- (37) UNCONFIRMED is never re-sent automatically (it may have been delivered) ----
      {
        const w = twoRegionWorld();
        TestEL_bind_(w);
        const realCD = GmailApp.createDraft;
        GmailApp.createDraft = function (to, subject, body, options) {
          if (String((options && options.htmlBody) || '').indexOf('L-PUNE') !== -1) return { send: function () { throw new Error('Service timed out: Gmail'); } };
          return realCD.apply(GmailApp, arguments);
        };
        sendAllIssuesEmails();
        GmailApp = TestMockGmailApp_({});
        TestAssertEqual_(byRegion(w, 'Pune').status, 'UNCONFIRMED', 'unconfirmed: set up - the Pune email ended UNCONFIRMED');
        const draftsBefore = TestGmailLog_.drafts.length;
        const res = recoverFailedAllIssuesBuckets_({ now: noonToday });
        TestAssertEqual_(res.targets.length + ',' + TestGmailLog_.drafts.length, '0,' + draftsBefore, 'unconfirmed: it is not a recovery target and nothing is re-sent (a second copy would be a duplicate)');
      }

      // ---- (38) a BLOCKED bucket is recovered once the cause is fixed ----
      {
        const w = twoRegionWorld();
        TestEL_bind_(w);
        renderOvernightReportEmailHTML_ = function (opts) { return realRender(opts).split('L-PUNE').join('L-REDACTED'); }; // the gate cannot find the lead in the html
        try { sendAllIssuesEmails(); } finally { renderOvernightReportEmailHTML_ = realRender; }
        TestAssertEqual_(byRegion(w, 'Pune').status, 'BLOCKED', 'blocked: set up - the Pune email was BLOCKED by the gate');
        TestGmailLog_.sent.length = 0;
        const res = recoverFailedAllIssuesBuckets_({ now: noonToday });
        TestAssertEqual_(res.targets[0].status + ',' + byRegion(w, 'Pune').status + ',' + byRegion(w, 'Pune').attempts, 'BLOCKED,ACCEPTED,2', 'blocked: re-sent and ACCEPTED once the cause is gone');
      }
    }

    // ================= EO-11: the spec's acceptance scenarios that are not covered above =================
    // ---- (40) a sending-platform outage: every send fails, ONE consolidated alert, nothing is lost, and the whole day is recovered once the platform is back ----
    {
      const noon = new Date(istDayKeyGs_(new Date()) + 'T12:00:00+05:30');
      const w = twoRegionWorld();
      TestEL_bind_(w);
      failingGmailFor(null); // every send is refused
      sendAllIssuesEmails();
      const led = TestEL_objects_(w.getSheetByName(EMAIL_LEDGER_SHEET_), L);
      TestAssertEqual_(led.map(function (r) { return r.status; }).sort().join(','), 'FAILED,FAILED', 'outage: both buckets are on record as FAILED (nothing is lost, nothing claimed sent)');
      TestAssertEqual_(w.getSheetByName('AllIssues_Log').getLastRow(), 1, 'outage: nothing is logged as sent');
      const consolidated = TestGmailLog_.sent.filter(function (e) { return /alerts from this run/.test(e.subject); });
      TestAssertEqual_(consolidated.length, 1, 'outage: the failures reach Snehil as ONE message, not one per bucket');
      TestAssertContains_(consolidated[0].body.split('\n')[0], '2 failed', 'outage: …whose confirmation says nothing went out');
      // the platform is back
      GmailApp = TestMockGmailApp_({});
      TestGmailLog_.sent.length = 0;
      const draftsBefore = TestGmailLog_.drafts.length;
      const res = recoverFailedAllIssuesBuckets_({ now: noon });
      TestAssertEqual_(res.ran + ',' + res.targets.length, 'true,2', 'outage recovery: both failed buckets are targeted');
      TestAssertEqual_(TestGmailLog_.drafts.length, draftsBefore + 2, 'outage recovery: both emails go out');
      TestAssertEqual_(TestEL_objects_(w.getSheetByName(EMAIL_LEDGER_SHEET_), L).map(function (r) { return r.status + ':' + r.attempts; }).sort().join(','), 'ACCEPTED:2,ACCEPTED:2', 'outage recovery: both ACCEPTED on their second attempt, no duplicates');
      TestAssertEqual_(w.getSheetByName('AllIssues_Log').getLastRow(), 3, 'outage recovery: AllIssues_Log now records both');
      TestAssertEqual_(TestGmailLog_.sent.filter(function (e) { return /FAILED|BLOCKED/.test(e.subject); }).length, 0, 'outage recovery: no further alert');
    }

    // ---- (41) an excluded RM (the closest thing to a suppression list here): the lead is never emailed to that RM's chain ----
    {
      const w = TestEL_world_(function (header, now) {
        return [
          TestEL_leadRow_(header, { lead_id: 'L-EXCL', client_id: 'C-EXCL', RM: 'Test RM Excl', lead_assigned_at: now, rm_is_active: false }),
          TestEL_leadRow_(header, { lead_id: 'L-OK', client_id: 'C-OK', RM: 'Test RM One', lead_assigned_at: now, rm_is_active: false }),
        ];
      });
      TestEL_bind_(w);
      sendAllIssuesEmails();
      const toChain = TestGmailLog_.drafts.filter(function (d) { return d.to === TEST_EMAIL_PRIMARY_ && d.htmlBody.indexOf('L-EXCL') !== -1; });
      TestAssertEqual_(toChain.length, 0, 'excluded RM: their lead is NOT in any email to the manager chain');
      const okMail = TestGmailLog_.drafts.filter(function (d) { return d.htmlBody.indexOf('L-OK') !== -1; });
      TestAssertEqual_(okMail.length, 1, 'excluded RM: the other RM\'s lead is emailed normally (one bad recipient does not stop the rest)');
      const exclMail = TestGmailLog_.drafts.filter(function (d) { return d.htmlBody.indexOf('L-EXCL') !== -1; });
      TestAssertEqual_(exclMail.length + ',' + (exclMail[0] ? exclMail[0].to.indexOf(TEST_EMAIL_CH_) !== -1 : ''), '1,true', 'excluded RM: the lead goes only to the CH-level backstop address, in its own email');
      TestAssert_(exclMail[0] && exclMail[0].htmlBody.indexOf('L-OK') === -1, 'excluded RM: …which does not carry the other RM\'s lead');
      const led = TestEL_objects_(w.getSheetByName(EMAIL_LEDGER_SHEET_), L);
      const all17 = led.filter(function (r) { return r.job === 'allIssues17'; });
      const chainRow = all17.filter(function (r) { return JSON.parse(r.lead_ids_json).indexOf('L-OK') !== -1; })[0];
      const backstopRow = all17.filter(function (r) { return JSON.parse(r.lead_ids_json).indexOf('L-EXCL') !== -1; })[0];
      TestAssertEqual_(all17.length + ',' + (chainRow ? chainRow.status : '') + ',' + (backstopRow ? backstopRow.status : ''), '2,ACCEPTED,ACCEPTED', 'excluded RM: the ledger has two emails - the chain\'s and the backstop\'s - each ACCEPTED');
      TestAssert_(chainRow && JSON.parse(chainRow.lead_ids_json).indexOf('L-EXCL') === -1, 'excluded RM: the chain\'s email does not carry the excluded RM\'s lead');
    }

    // ================= EO-9b: recovering failed 10:00 and 13:00 emails =================
    {
      const dayToday = istDayKeyGs_(new Date());
      const noonToday = new Date(dayToday + 'T12:00:00+05:30');
      const ledgerOf = function (ssX, job) { return TestEL_objects_(ssX.getSheetByName(EMAIL_LEDGER_SHEET_), L).filter(function (r) { return !job || r.job === job; }); };
      const byRegion = function (ssX, job, region) { return ledgerOf(ssX, job).filter(function (r) { return r.region === region; })[0]; };
      const overnightRows = function (ssX) { return ssX.getSheetByName('Overnight_Log').getLastRow() - 1; };

      // A Pune lead and a Thane lead assigned yesterday evening (inside the overnight window), flagged by a rule that does not depend on the clock.
      const morningWorld = function (extra) {
        const header = TestFixture_leadsHeader_();
        const banner = header.map(function () { return ''; });
        const eve = new Date(istDayKeyGs_(new Date(Date.now() - 24 * 3600 * 1000)) + 'T18:00:00+05:30');
        const ss = TestMockSpreadsheet_({
          'RM_Hierarchy': TestMockSheet_('RM_Hierarchy', TestFixture_rmHierarchyRows_()),
          'Manager_Directory': TestMockSheet_('Manager_Directory', TestFixture_managerDirectoryRows_()),
        });
        const row = function (o) { return TestEL_leadRow_(header, Object.assign({ RM: 'Test RM One', current_stage: 'Not Updated', lead_assigned_at: eve }, o)); };
        ss._sheets['leads'] = TestMockSheet_('leads', [banner, header, row({ lead_id: 'L-PUNE', client_id: 'C-PUNE', region: 'Pune' }), row({ lead_id: 'L-THANE', client_id: 'C-THANE', region: 'Thane' })]
          .concat((extra || []).map(row)));
        return ss;
      };
      const failedPuneMorning = function (extra) {
        const ss = morningWorld(extra);
        TestEL_bind_(ss);
        failingGmailFor('L-PUNE');
        sendOvernightMorningEmails();
        GmailApp = TestMockGmailApp_({}); // Gmail works again
        TestGmailLog_.sent.length = 0;
        return ss;
      };

      // ---- the shared helpers ----
      {
        const ssC = TestMockSpreadsheet_({});
        TestEL_bind_(ssC);
        const hC = emailLedgerOpenGs_(ssC);
        const mk = function (job, label, status) {
          const idC = emailLedgerIdGs_(job, dayToday, 'Pune', 'A1', label);
          emailLedgerPlanGs_(hC, [{ emailId: idC, job: job, dayKey: dayToday, region: 'Pune', bucketLabel: label, primaryRole: 'A1', to: TEST_EMAIL_PRIMARY_, leadIds: ['1'] }]);
          emailLedgerAttemptGs_(hC, idC);
          emailLedgerResultGs_(hC, idC, { status: status, reason: 'x', leadIds: status === 'ACCEPTED' ? ['1'] : [] });
        };
        mk('morning10', 'M failed', 'FAILED'); mk('morning10', 'M blocked', 'BLOCKED'); mk('morning10', 'M unconfirmed', 'UNCONFIRMED'); mk('morning10', 'M accepted', 'ACCEPTED');
        mk('followup13', 'F failed', 'FAILED'); mk('allIssues17', 'A failed', 'FAILED'); mk('chLevel10', 'C failed', 'FAILED');
        const names = function (job) { return emailLedgerRecoveryTargetsGs_(ssC, new Date(), job).map(function (t) { return t.bucket; }).sort().join('|'); };
        TestAssertEqual_(names('morning10'), 'M blocked|M failed', 'recovery targets: only the 10:00 emails that are FAILED or BLOCKED - not UNCONFIRMED (may have been delivered), not ACCEPTED, not another job\'s');
        TestAssertEqual_(names('followup13') + ',' + names('allIssues17') + ',' + names('chLevel10'), 'F failed,A failed,C failed', 'recovery targets: each job sees only its own failed emails');
        const cut = function (h, m, fh, fm) { return emailLateCutoffPassedGs_(new Date(dayToday + 'T' + pad2Gs_(h) + ':' + pad2Gs_(m) + ':00+05:30'), fh, fm); };
        TestAssertEqual_([cut(12, 45, 12, 45), cut(12, 46, 12, 45), cut(16, 0, 16, 0), cut(16, 1, 16, 0)].join(','), 'false,true,false,true', 'cutoff helper: the cutoff minute itself is still allowed, the next minute is not');
        TestAssertEqual_(MORNING_LATE_CUTOFF_HOUR_ + ':' + MORNING_LATE_CUTOFF_MINUTE_ + ',' + FOLLOWUP_LATE_CUTOFF_HOUR_ + ':' + FOLLOWUP_LATE_CUTOFF_MINUTE_, '12:45,16:0', 'cutoffs: 10:00 emails until 12:45 (so the 13:00 reply can thread), 13:00 replies until 16:00');
      }

      // ---- 10:00: one bucket failed, its sibling went out: only the failed one is re-sent ----
      {
        const ss = failedPuneMorning();
        TestAssertEqual_(byRegion(ss, 'morning10', 'Pune').status + ',' + byRegion(ss, 'morning10', 'Thane').status, 'FAILED,ACCEPTED', '10:00 recovery: set up - Pune failed, Thane went out');
        const draftsBefore = TestGmailLog_.drafts.length, exBefore = TestEL_objects_(ss.getSheetByName(EMAIL_LEDGER_EXCLUSIONS_SHEET_), X).length, logBefore = overnightRows(ss);
        const res = recoverFailedMorningBuckets_({ now: noonToday });
        TestAssertEqual_(res.ran + ',' + res.targets.length + ',' + res.targets[0].region + ',' + res.targets[0].status, 'true,1,Pune,FAILED', '10:00 recovery: one FAILED bucket found and re-run');
        TestAssertEqual_(TestGmailLog_.drafts.length, draftsBefore + 1, '10:00 recovery: exactly one email is sent - the failed bucket');
        TestAssertContains_(TestGmailLog_.drafts[TestGmailLog_.drafts.length - 1].htmlBody, 'L-PUNE', '10:00 recovery: …and it is the Pune bucket');
        const pune = byRegion(ss, 'morning10', 'Pune'), thane = byRegion(ss, 'morning10', 'Thane');
        TestAssertEqual_([pune.status, pune.attempts, pune.leads_sent].join(','), 'ACCEPTED,2,1', '10:00 recovery: the Pune row is now ACCEPTED after a second attempt');
        TestAssertEqual_([thane.status, thane.attempts].join(','), 'ACCEPTED,1', '10:00 recovery: the Thane row is untouched (not sent a second time)');
        TestAssertEqual_(ledgerOf(ss, 'morning10').length, 2, '10:00 recovery: no extra ledger rows');
        TestAssertEqual_(overnightRows(ss), logBefore + 1, '10:00 recovery: the recovered email is logged in Overnight_Log, so the 13:00 reply can thread into it');
        TestAssertEqual_(TestEL_objects_(ss.getSheetByName(EMAIL_LEDGER_EXCLUSIONS_SHEET_), X).length, exBefore, '10:00 recovery: the original run\'s exclusion rows are not repeated');
        TestAssert_(!TestGmailLog_.sent.some(function (e) { return /FAILED|BLOCKED|failed/.test(e.subject); }), '10:00 recovery: no failure alert when the re-send worked');
        const again = recoverFailedMorningBuckets_({ now: noonToday });
        TestAssertEqual_(again.ran + ',' + again.targets.length + ',' + TestGmailLog_.drafts.length, 'false,0,' + (draftsBefore + 1), '10:00 recovery: once recovered there is nothing left to recover, and a second call sends nothing');
        recoverFailedMorningBucketsNow(); // the entry point (through the job lock) is also a quiet no-op
        TestAssertEqual_(TestGmailLog_.drafts.length, draftsBefore + 1, '10:00 recovery: the entry point sends nothing either');
      }

      // ---- 10:00: the region already has a logged sibling email - the "already sent today" guard must not stop the recovery ----
      {
        const ss = failedPuneMorning();
        ensureOvernightLogSheet_(ss).appendRow([dayToday, 'Pune', 'thread-sibling', '[]', new Date(), 'sibling@example.test', '', 'Sibling', '']);
        const draftsBefore = TestGmailLog_.drafts.length, exBefore = TestEL_objects_(ss.getSheetByName(EMAIL_LEDGER_EXCLUSIONS_SHEET_), X).length;
        recoverFailedMorningBuckets_({ now: noonToday });
        TestAssertEqual_(TestGmailLog_.drafts.length + ',' + byRegion(ss, 'morning10', 'Pune').status, (draftsBefore + 1) + ',ACCEPTED', '10:00 region guard: a sibling already logged for the region does not stop the failed bucket being re-sent');
        TestAssertEqual_(TestEL_objects_(ss.getSheetByName(EMAIL_LEDGER_EXCLUSIONS_SHEET_), X).length, exBefore, '10:00 region guard: …and the guard skip is not recorded as an exclusion');
      }

      // ---- 10:00: a CH-level report of the original run is not repeated by the recovery ----
      {
        const ss = failedPuneMorning([{ lead_id: 'L-CHX', client_id: 'C-CHX', RM: 'Test CH Self', region: 'Pune' }]);
        TestAssertEqual_(ledgerOf(ss, 'chLevel10').length, 1, '10:00 CH-level: set up - the original run sent the CH-level report');
        const draftsBefore = TestGmailLog_.drafts.length;
        recoverFailedMorningBuckets_({ now: noonToday });
        TestAssertEqual_(TestGmailLog_.drafts.length, draftsBefore + 1, '10:00 CH-level: the recovery sends only the failed bucket - not the CH-level report again');
        TestAssertEqual_(ledgerOf(ss, 'chLevel10').length, 1, '10:00 CH-level: …and the ledger still has one CH-level row');
      }

      // ---- 10:00: an RM the original run could not route is not recorded or reported a second time by the recovery ----
      {
        const ss = morningWorld([{ lead_id: 'L-TWO', client_id: 'C-TWO', RM: 'Test RM Three', region: 'Pune' }]);
        TestEL_bind_(ss);
        const realResolve = resolveRecipientEmailsForRegion_;
        resolveRecipientEmailsForRegion_ = function (ssArg, region, rmNames, recipients, opts) {
          const res = realResolve(ssArg, region, rmNames, recipients, opts);
          res.results = res.results.map(function (rec) { return Object.assign({}, rec, { rmNames: rec.rmNames.filter(function (n) { return n !== 'Test RM Three'; }) }); }).filter(function (rec) { return rec.rmNames.length; });
          res.trulyUnresolved = rmNames.indexOf('Test RM Three') !== -1 ? [{ rmName: 'Test RM Three', reason: 'simulated: no manager email on file' }] : []; // pretend this RM could not be routed anywhere
          return res;
        };
        try {
          failingGmailFor('L-PUNE');
          sendOvernightMorningEmails();
          GmailApp = TestMockGmailApp_({});
          TestGmailLog_.sent.length = 0;
          const exBefore = TestEL_objects_(ss.getSheetByName(EMAIL_LEDGER_EXCLUSIONS_SHEET_), X).filter(function (e) { return e.lead_id === 'L-TWO'; }).length;
          TestAssertEqual_(exBefore, 1, '10:00 unroutable RM: set up - the original run recorded the lead once');
          recoverFailedMorningBuckets_({ now: noonToday });
          TestAssertEqual_(TestEL_objects_(ss.getSheetByName(EMAIL_LEDGER_EXCLUSIONS_SHEET_), X).filter(function (e) { return e.lead_id === 'L-TWO'; }).length, 1, '10:00 unroutable RM: the recovery does not record the same lead again');
          TestAssertEqual_(TestGmailLog_.sent.filter(function (e) { return /Leads NOT sent/.test(e.subject); }).length, 0, '10:00 unroutable RM: …and does not send the "Leads NOT sent" report again');
          TestAssertEqual_(byRegion(ss, 'morning10', 'Pune').status, 'ACCEPTED', '10:00 unroutable RM: …while the failed bucket itself was recovered');
        } finally { resolveRecipientEmailsForRegion_ = realResolve; }
      }

      // ---- 10:00: past the cutoff nothing is sent late, unless forced ----
      {
        const ss = failedPuneMorning();
        const draftsBefore = TestGmailLog_.drafts.length;
        const late = new Date(dayToday + 'T12:46:00+05:30');
        const res = recoverFailedMorningBuckets_({ now: late });
        TestAssertEqual_(res.ran + ',' + res.cutoff + ',' + res.targets.length + ',' + TestGmailLog_.drafts.length + ',' + byRegion(ss, 'morning10', 'Pune').status, 'false,true,1,' + draftsBefore + ',FAILED', '10:00 cutoff: after 12:45 the failed bucket is found but not sent, and the ledger still says FAILED');
        const forced = recoverFailedMorningBuckets_({ now: late, force: true });
        TestAssertEqual_(forced.ran + ',' + TestGmailLog_.drafts.length + ',' + byRegion(ss, 'morning10', 'Pune').status, 'true,' + (draftsBefore + 1) + ',ACCEPTED', '10:00 cutoff: force sends it on purpose');
      }

      // ---- 10:00: the leads were resolved meanwhile - re-checked from current data, nothing is sent, the row says why ----
      {
        const ss = failedPuneMorning();
        const draftsBefore = TestGmailLog_.drafts.length;
        ss._sheets['leads'].getRange(3, TestFixture_leadsHeader_().indexOf('current_stage') + 1, 1, 1).setValues([['Won']]); // L-PUNE is the first lead row
        recoverFailedMorningBuckets_({ now: noonToday });
        TestAssertEqual_(TestGmailLog_.drafts.length, draftsBefore, '10:00 revalidation: a resolved lead is not emailed');
        const pune = byRegion(ss, 'morning10', 'Pune');
        TestAssertEqual_(pune.status, 'SKIPPED', '10:00 revalidation: the row is closed as SKIPPED, not left FAILED without a reason');
        TestAssertContains_(pune.status_reason, 'recovery', '10:00 revalidation: …with the recovery reason');
      }

      // ---- 10:00: the recovery run's own failure is reported (and the ledger says FAILED again, with two attempts) ----
      {
        const ss = failedPuneMorning();
        failingGmailFor('L-PUNE'); // Gmail still refuses this bucket
        recoverFailedMorningBuckets_({ now: noonToday });
        const pune = byRegion(ss, 'morning10', 'Pune');
        TestAssertEqual_(pune.status + ',' + pune.attempts, 'FAILED,2', '10:00 recovery that fails again: FAILED, two attempts - the evidence stays truthful');
        TestAssertEqual_(TestGmailLog_.sent.filter(function (e) { return /Morning email failed|Leads Not Sent|leads not sent/i.test(e.subject); }).length >= 1, true, '10:00 recovery that fails again: ops are told');
      }

      // ---- 13:00: the reply failed entirely - the recovery re-sends just that reply, threaded ----
      const failedFollowup = function () {
        const w = cycleWorld();
        TestEL_bind_(w.ss);
        sendAllIssuesEmails();
        ageAllIssues(w);
        sendOvernightMorningEmails();
        w.tenThread = TestGmailLog_.drafts[1]._threadId;
        Gmail = TestMockGmailAdvanced_({ shouldFail: true }); // the threaded send is refused...
        failingGmailFor(null); // ...and so is the plain fallback
        sendOvernightFollowupEmails();
        GmailApp = TestMockGmailApp_({});
        Gmail = TestMockGmailAdvanced_({}); // Gmail works again
        TestGmailLog_.sent.length = 0;
        return w;
      };
      {
        const w = failedFollowup();
        const r13 = function () { return ledgerRows(w, 'followup13')[0]; };
        TestAssertEqual_(r13().status + ',' + w.ss.getSheetByName('Overnight_Log').getRange(2, 9, 1, 1).getValue(), 'FAILED,', '13:00 recovery: set up - the reply failed and followup_sent_at is still blank');
        const draftsBefore = TestGmailLog_.drafts.length;
        const res = recoverFailedFollowupBuckets_({ now: noonToday });
        TestAssertEqual_(res.ran + ',' + res.targets.length + ',' + res.targets[0].status, 'true,1,FAILED', '13:00 recovery: one FAILED reply found and re-run');
        TestAssertEqual_(TestGmailLog_.threadReplies.length, 1, '13:00 recovery: exactly one reply is sent, threaded');
        TestAssertEqual_(TestGmailLog_.drafts.length, draftsBefore, '13:00 recovery: no plain copy');
        TestAssertEqual_([r13().status, r13().attempts, r13().thread_id].join(','), 'ACCEPTED,2,' + w.tenThread, '13:00 recovery: the row is ACCEPTED after a second attempt, in the 10:00 thread');
        TestAssert_(!!w.ss.getSheetByName('Overnight_Log').getRange(2, 9, 1, 1).getValue(), '13:00 recovery: followup_sent_at is now stamped');
        const again = recoverFailedFollowupBuckets_({ now: noonToday });
        TestAssertEqual_(again.ran + ',' + again.targets.length + ',' + TestGmailLog_.threadReplies.length, 'false,0,1', '13:00 recovery: once recovered there is nothing left to recover');
        recoverFailedFollowupBucketsNow();
        TestAssertEqual_(TestGmailLog_.threadReplies.length, 1, '13:00 recovery: the entry point sends nothing more either');
      }

      // ---- 13:00: past the cutoff, and force ----
      {
        const w = failedFollowup();
        const late = new Date(dayToday + 'T16:01:00+05:30');
        const res = recoverFailedFollowupBuckets_({ now: late });
        TestAssertEqual_(res.ran + ',' + res.cutoff + ',' + TestGmailLog_.threadReplies.length + ',' + ledgerRows(w, 'followup13')[0].status, 'false,true,0,FAILED', '13:00 cutoff: after 16:00 the failed reply is found but not sent');
        const forced = recoverFailedFollowupBuckets_({ now: late, force: true });
        TestAssertEqual_(forced.ran + ',' + TestGmailLog_.threadReplies.length + ',' + ledgerRows(w, 'followup13')[0].status, 'true,1,ACCEPTED', '13:00 cutoff: force sends it on purpose');
      }

      // ---- 13:00: an UNCONFIRMED reply is never re-sent ----
      {
        const w = cycleWorld();
        TestEL_bind_(w.ss);
        sendAllIssuesEmails();
        ageAllIssues(w);
        sendOvernightMorningEmails();
        Gmail = TestMockGmailAdvanced_({});
        Gmail.Users.Messages.send = function () { throw new Error('Service timed out: Gmail'); };
        sendOvernightFollowupEmails();
        Gmail = TestMockGmailAdvanced_({});
        const draftsBefore = TestGmailLog_.drafts.length;
        const res = recoverFailedFollowupBuckets_({ now: noonToday });
        TestAssertEqual_(ledgerRows(w, 'followup13')[0].status + ',' + res.targets.length + ',' + TestGmailLog_.threadReplies.length + ',' + TestGmailLog_.drafts.length, 'UNCONFIRMED,0,0,' + draftsBefore, '13:00 recovery: an UNCONFIRMED reply (it may have been delivered) is not a target and nothing is re-sent');
      }

      // ---- 13:00: everything was resolved meanwhile - nothing is sent, the row says why ----
      {
        const w = failedFollowup();
        closeLead(w);
        recoverFailedFollowupBuckets_({ now: noonToday });
        const r13 = ledgerRows(w, 'followup13')[0];
        TestAssertEqual_(TestGmailLog_.threadReplies.length + ',' + r13.status, '0,SKIPPED', '13:00 revalidation: a resolved lead is not emailed and the row is closed as SKIPPED');
        TestAssertContains_(r13.status_reason, 'nothing is still unresolved', '13:00 revalidation: …with the reason');
      }

      // ---- 13:00: two replies, only the failed one is re-sent ----
      {
        const ss = morningWorld();
        TestEL_bind_(ss);
        sendOvernightMorningEmails(); // both regions' 10:00 emails go out
        // The Pune reply is refused (the threaded send AND the plain fallback); the Thane reply is fine.
        const logVals = ss.getSheetByName('Overnight_Log').getRange(2, 1, 2, 3).getValues();
        const puneThread = String(logVals.filter(function (r) { return r[1] === 'Pune'; })[0][2]);
        const realSend = Gmail.Users.Messages.send;
        Gmail.Users.Messages.send = function (payload) { if (payload.threadId === puneThread) throw new Error('Gmail operation not allowed for this user'); return realSend.apply(this, arguments); };
        failingGmailFor('L-PUNE');
        sendOvernightFollowupEmails();
        Gmail.Users.Messages.send = realSend;
        GmailApp = TestMockGmailApp_({});
        const rows13 = ledgerOf(ss, 'followup13');
        TestAssertEqual_(rows13.map(function (r) { return r.status; }).sort().join(','), 'ACCEPTED,FAILED', '13:00 two replies: set up - one went out, one failed');
        const repliesBefore = TestGmailLog_.threadReplies.length, draftsBefore = TestGmailLog_.drafts.length;
        const res = recoverFailedFollowupBuckets_({ now: noonToday });
        TestAssertEqual_(res.targets.length + ',' + res.ran, '1,true', '13:00 two replies: only the failed one is a recovery target');
        TestAssertEqual_((TestGmailLog_.threadReplies.length - repliesBefore) + ',' + (TestGmailLog_.drafts.length - draftsBefore), '1,0', '13:00 two replies: exactly one more reply is sent - the sibling is not sent a second time');
        TestAssertEqual_(ledgerOf(ss, 'followup13').map(function (r) { return r.status; }).join(','), 'ACCEPTED,ACCEPTED', '13:00 two replies: both are ACCEPTED now');
      }
    }

    // ================= EO-10b: a RED Leads tab puts a separate notice at the bottom of every email - and never holds one =================
    {
      const STALE_HEAD = 'Data freshness notice';
      const hrsAgo = function (h) { return TestFixture_hoursAgo_(new Date(), h); };
      // Runs fn with the two email renderers wrapped so every report's options (and so its section list) can be inspected.
      const capture = function (fn) {
        const out = { single: [], two: [] };
        const realTwo = renderTwoSectionEmailHTML_;
        renderOvernightReportEmailHTML_ = function (opts) { out.single.push(opts); return realRender(opts); };
        renderTwoSectionEmailHTML_ = function (s1, s2) { out.two.push([s1, s2]); return realTwo(s1, s2); };
        try { fn(); } finally { renderOvernightReportEmailHTML_ = realRender; renderTwoSectionEmailHTML_ = realTwo; }
        out.standalone = out.single.filter(function (o) { return !out.two.some(function (p) { return p[0] === o || p[1] === o; }); });
        return out;
      };
      const headings = function (opts) { return opts.sections.map(function (x) { return x.heading; }); };
      const noticeCount = function (opts) { return headings(opts).filter(function (h) { return h === STALE_HEAD; }).length; };
      const isLastNotice = function (opts) { const h = headings(opts); return h.length >= 1 && h[h.length - 1] === STALE_HEAD && noticeCount(opts) === 1; };

      // ---- the pure helpers ----
      const freshOf = function (rowsFn) { const rd = readLeadsTab_(TestEL_world_(rowsFn)); return leadsFreshnessFromRowsGs_(rd.colIndex, rd.dataRows, new Date()); };
      const oneLead = function (h) { return function (header) { return [TestEL_leadRow_(header, { lead_id: 'L-F', client_id: 'C-F', lead_assigned_at: hrsAgo(h) })]; }; };
      TestAssertEqual_([0, 3, 3.01, 5, 5.01, 30].map(leadsFreshnessLevelGs_).join(','), 'GREEN,GREEN,AMBER,AMBER,RED,RED', 'freshness level: up to 3 h GREEN, over 3 h AMBER, over 5 h RED');
      TestAssertEqual_([1, 4, 6].map(function (h) { return freshOf(oneLead(h)).level; }).join(','), 'GREEN,AMBER,RED', 'freshness from rows: an hour old is GREEN, 4 h AMBER, 6 h RED');
      TestAssertEqual_(freshOf(function (header) { return [TestEL_leadRow_(header, { lead_id: 'L-1', client_id: 'C-1', lead_assigned_at: hrsAgo(30) }), TestEL_leadRow_(header, { lead_id: 'L-2', client_id: 'C-2', lead_assigned_at: hrsAgo(2) })]; }).level, 'GREEN', 'freshness from rows: the NEWEST lead decides, not the oldest');
      TestAssertEqual_(freshOf(function (header) { return [TestEL_leadRow_(header, { lead_id: 'L-1', client_id: 'C-1', lead_assigned_at: hrsAgo(6) }), TestEL_leadRow_(header, { lead_id: 'L-2', client_id: 'C-2', lead_assigned_at: hrsAgo(-5) })]; }).level, 'RED', 'freshness from rows: a time in the future is ignored - bad data cannot make a stale tab look fresh');
      TestAssertEqual_(freshOf(function () { return []; }).level, 'UNKNOWN', 'freshness from rows: no leads is UNKNOWN, never a guess');
      TestAssertContains_(freshOf(oneLead(6)).text, 'older than 5 h', 'freshness from rows: RED names the 5 h line');
      TestAssertContains_(freshOf(oneLead(4)).text, 'older than 3 h', 'freshness from rows: AMBER names the 3 h line');

      const redSec = staleLeadsNoticeSectionGs_(freshOf(oneLead(6)));
      TestAssertEqual_(redSec.heading + '|' + redSec.columns.join(',') + '|' + redSec.rows.length, STALE_HEAD + '|Notice|3', 'notice section: a heading, one column, three plain sentences');
      TestAssertContains_(redSec.rows[0][0], '6 h ago', 'notice section: it says how old the newest lead is');
      TestAssertContains_(redSec.rows[0][0], 'IST', 'notice section: …and when it was assigned, in IST');
      TestAssertContains_(redSec.rows[2][0], 'CRM', 'notice section: …and what to do about it');
      TestAssertEqual_([oneLead(1), oneLead(4), function () { return []; }].map(function (f) { return String(staleLeadsNoticeSectionGs_(freshOf(f))); }).join(','), 'null,null,null', 'notice section: GREEN, AMBER and UNKNOWN produce no notice - only RED does');
      TestAssertEqual_(String(staleLeadsNoticeSectionGs_(null)) + ',' + String(staleLeadsNoticeSectionGs_({ level: 'RED', newest: null })), 'null,null', 'notice section: a missing or incomplete reading produces no notice');
      TestAssertEqual_(String(staleLeadsNoticeFromRowsGs_({}, 'not rows', new Date())), 'null', 'notice from rows: bad input is "no notice", never an exception (the warning is fail-open)');

      // ---- 17:00 ----
      // Flagged leads that are flagged at ANY clock time (a stage of "Not Updated" past the grace period - an inactive RM or a never-connected lead only count
      // for a lead created today / inside business hours), plus one closed lead whose assignment time sets how fresh the Leads tab looks.
      const flaggedLead = function (header, o) { return TestEL_leadRow_(header, Object.assign({ RM: 'Test RM One', current_stage: 'Not Updated', lead_assigned_at: hrsAgo(30) }, o)); };
      const markerLead = function (header, newestHours) { return TestEL_leadRow_(header, { lead_id: 'L-MARKER', client_id: 'C-MARKER', current_stage: 'Won', lead_assigned_at: hrsAgo(newestHours) }); };
      const staleWorld = function (newestHours, extraRows) {
        return TestEL_world_(function (header) {
          return [flaggedLead(header, { lead_id: 'L-STALE', client_id: 'C-STALE' })].concat((extraRows || []).map(function (o) { return flaggedLead(header, o); })).concat([markerLead(header, newestHours)]);
        });
      };
      {
        const ss = staleWorld(6);
        TestEL_bind_(ss);
        const got = capture(function () { sendAllIssuesEmails(); });
        TestAssertEqual_(TestGmailLog_.drafts.length, 1, '17:00 RED: the email is still sent - a stale tab never holds it');
        TestAssertEqual_(got.single.length, 1, '17:00 RED: one report was built');
        TestAssert_(isLastNotice(got.single[0]), '17:00 RED: the notice is the LAST section, and appears once');
        TestAssert_(headings(got.single[0]).length >= 2, '17:00 RED: it sits after the lead table(s), as a separate section');
        const d = TestGmailLog_.drafts[0];
        TestAssert_(d.htmlBody.indexOf('L-STALE') !== -1 && d.htmlBody.indexOf('L-STALE') < d.htmlBody.indexOf(STALE_HEAD), '17:00 RED: the lead table is complete and comes before the notice');
        TestAssertContains_(d.body, STALE_HEAD, '17:00 RED: the plain-text twin carries the notice too');
        TestAssert_(d.body.indexOf('L-STALE') < d.body.indexOf(STALE_HEAD), '17:00 RED: …after the leads there as well');
        TestAssertEqual_(JSON.stringify(got.single[0].sections[got.single[0].sections.length - 1]).indexOf('L-STALE'), -1, '17:00 RED: the notice section holds no lead (it is a warning, not data)');
        const led = TestEL_objects_(ss.getSheetByName(EMAIL_LEDGER_SHEET_), L);
        TestAssertEqual_(led.length + ',' + led[0].status + ',' + led[0].leads_sent, '1,ACCEPTED,1', '17:00 RED: the ledger shows the email ACCEPTED with its lead');
        TestAssertEqual_(TestGmailLog_.sent.filter(function (e) { return /fresh|stale/i.test(e.subject); }).length, 0, '17:00 RED: no separate alert email is raised for it');
      }
      [1, 4].forEach(function (h) {
        const ss = staleWorld(h);
        TestEL_bind_(ss);
        const got = capture(function () { sendAllIssuesEmails(); });
        TestAssertEqual_(TestGmailLog_.drafts.length + ',' + got.single.length + ',' + noticeCount(got.single[0]), '1,1,0', '17:00 at ' + h + ' h: sent, and no notice (only RED, over 5 h, gets one)');
      });
      {
        // an ordinary bucket AND a CH-level report in one run: both carry the notice, last
        const ss = staleWorld(6, [{ lead_id: 'L-CH', client_id: 'C-CH', RM: 'Test CH Self' }]);
        TestEL_bind_(ss);
        const got = capture(function () { sendAllIssuesEmails(); });
        TestAssertEqual_(TestGmailLog_.drafts.length + ',' + got.single.length, '2,2', '17:00 RED with a CH-held lead: the bucket email and the CH-level report both go out');
        TestAssert_(got.single.every(isLastNotice), '17:00 RED: the CH-level report carries the notice last, same as the bucket email');
        const led = TestEL_objects_(ss.getSheetByName(EMAIL_LEDGER_SHEET_), L);
        TestAssertEqual_(led.map(function (r) { return r.job + ':' + r.status; }).sort().join(','), 'allIssues17:ACCEPTED,chLevel17:ACCEPTED', '17:00 RED: both are ACCEPTED in the ledger');
      }
      {
        // the gate drops one lead and the bucket is re-built: the second build keeps the notice
        const ss = staleWorld(6, [{ lead_id: 'L-MULTI', client_id: 'C-MULTI', lead_assigned_at: hrsAgo(7) }]);
        TestEL_bind_(ss);
        const got = capture(function () {
          const wrapped = renderOvernightReportEmailHTML_;
          renderOvernightReportEmailHTML_ = function (opts) { return wrapped(opts).split('L-MULTI').join('L-REDACTED'); };
          sendAllIssuesEmails();
        });
        TestAssertEqual_(TestGmailLog_.drafts.length, 1, '17:00 RED, one lead dropped: one email goes out');
        const buckets = got.single.filter(function (o) { return o.title !== 'Leads Not Sent'; }); // the dropped lead is also reported to ops, in a separate "Leads Not Sent" report
        TestAssertEqual_(buckets.length + ',' + buckets.every(isLastNotice) + ',' + (got.single.length - buckets.length), '2,true,1', '17:00 RED, one lead dropped: both builds of the bucket (first and resend) end with the notice; the ops "Leads Not Sent" report is separate');
        TestAssertEqual_(got.single.filter(function (o) { return o.title === 'Leads Not Sent'; }).every(function (o) { return noticeCount(o) === 0; }), true, '17:00 RED, one lead dropped: the ops-only "Leads Not Sent" report carries no notice (it is not a lead email)');
        TestAssertContains_(TestGmailLog_.drafts[0].htmlBody, STALE_HEAD, '17:00 RED, one lead dropped: the email that went out carries it');
        TestAssertEqual_(TestGmailLog_.drafts[0].htmlBody.split(STALE_HEAD).length - 1, 1, '17:00 RED, one lead dropped: …once');
      }
      {
        // the warning is fail-open: if reading the age blows up, the email goes out without it
        const realFresh = leadsFreshnessFromRowsGs_;
        leadsFreshnessFromRowsGs_ = function () { throw new Error('simulated freshness failure'); };
        let got;
        try { TestEL_bind_(staleWorld(6)); got = capture(function () { sendAllIssuesEmails(); }); } finally { leadsFreshnessFromRowsGs_ = realFresh; }
        TestAssertEqual_(TestGmailLog_.drafts.length + ',' + noticeCount(got.single[0]), '1,0', 'fail-open: an error in the freshness check never stops the email - it just has no notice');
      }
      {
        // a recovery re-send judges the tab at the time of THAT send
        const mk = function () {
          const ss = TestEL_world_(function (header) {
            return [flaggedLead(header, { lead_id: 'L-PUNE', client_id: 'C-PUNE', region: 'Pune' }), flaggedLead(header, { lead_id: 'L-THANE', client_id: 'C-THANE', region: 'Thane' }), markerLead(header, 6)];
          });
          TestEL_bind_(ss);
          failingGmailFor('L-PUNE');
          sendAllIssuesEmails();
          GmailApp = TestMockGmailApp_({});
          return ss;
        };
        const ssR = mk();
        const gotR = capture(function () { recoverFailedAllIssuesBuckets_({ now: new Date(), force: true }); });
        TestAssertEqual_(gotR.single.length + ',' + isLastNotice(gotR.single[0]), '1,true', 'recovery while the tab is still stale: the re-sent bucket carries the notice');
        const ssR2 = mk();
        ssR2._sheets['leads'].appendRow(markerLead(TestFixture_leadsHeader_(), 0)); // a fresh closed lead: the tab has been refreshed
        const gotR2 = capture(function () { recoverFailedAllIssuesBuckets_({ now: new Date(), force: true }); });
        TestAssertEqual_(gotR2.single.length + ',' + noticeCount(gotR2.single[0]), '1,0', 'recovery after the tab refreshed: the notice is gone - it reflects the tab as of that send');
      }

      // ---- 10:00 and 13:00 (the cycle world's lead is 40 h old, so its tab is RED) ----
      const freshCycle = function () {
        const w = cycleWorld();
        w.ss._sheets['leads'].appendRow(TestEL_leadRow_(w.header, { lead_id: 'L-NEW', client_id: 'C-NEW', current_stage: 'Won', lead_assigned_at: w.now }));
        return w;
      };
      {
        const w = cycleWorld();
        TestEL_bind_(w.ss);
        sendAllIssuesEmails();
        ageAllIssues(w);
        const got10 = capture(function () { sendOvernightMorningEmails(); });
        TestAssertEqual_(got10.two.length, 1, '10:00 RED: one combined email was built');
        TestAssert_(isLastNotice(got10.two[0][1]) && noticeCount(got10.two[0][0]) === 0, '10:00 RED: the notice ends the email (last section of Section 2) and Section 1 is untouched');
        TestAssertEqual_(TestGmailLog_.drafts[1].htmlBody.split(STALE_HEAD).length - 1, 1, '10:00 RED: it appears once in the sent email');
        TestAssertContains_(TestGmailLog_.drafts[1].body, STALE_HEAD, '10:00 RED: and in its plain-text twin');
        TestAssertEqual_(ledgerRows(w, 'morning10')[0].status, 'ACCEPTED', '10:00 RED: the email is ACCEPTED - a stale tab never holds it');
        const got13 = capture(function () { sendOvernightFollowupEmails(); });
        TestAssertEqual_(got13.two.length, 1, '13:00 RED: one reply was built');
        TestAssert_(isLastNotice(got13.two[0][1]) && noticeCount(got13.two[0][0]) === 0, '13:00 RED: the notice ends the reply (last section of Section 2)');
        TestAssertEqual_(TestGmailLog_.threadReplies.length + ',' + ledgerRows(w, 'followup13')[0].status, '1,ACCEPTED', '13:00 RED: the reply is sent and ACCEPTED');
      }
      {
        const w = freshCycle();
        TestEL_bind_(w.ss);
        sendAllIssuesEmails();
        ageAllIssues(w);
        const got10 = capture(function () { sendOvernightMorningEmails(); });
        const got13 = capture(function () { sendOvernightFollowupEmails(); });
        TestAssertEqual_(got10.two.length + ',' + noticeCount(got10.two[0][1]) + ',' + got13.two.length + ',' + noticeCount(got13.two[0][1]), '1,0,1,0', 'GREEN tab: neither the 10:00 email nor the 13:00 reply carries a notice');
        TestAssertEqual_(ledgerRows(w, 'morning10')[0].status + ',' + ledgerRows(w, 'followup13')[0].status, 'ACCEPTED,ACCEPTED', 'GREEN tab: both are ACCEPTED as before');
      }
      {
        // the 10:00 CH-level overnight report: leads assigned the evening before are well over 5 h old
        const header = TestFixture_leadsHeader_();
        const banner = header.map(function () { return ''; });
        const nowO = new Date();
        const eveningBefore = new Date(istDayKeyGs_(new Date(nowO.getTime() - 24 * 3600 * 1000)) + 'T17:30:00+05:30');
        const ssO = TestMockSpreadsheet_({
          'RM_Hierarchy': TestMockSheet_('RM_Hierarchy', TestFixture_rmHierarchyRows_()),
          'Manager_Directory': TestMockSheet_('Manager_Directory', TestFixture_managerDirectoryRows_()),
        });
        ssO._sheets['leads'] = TestMockSheet_('leads', [banner, header,
          TestEL_leadRow_(header, { lead_id: 'L-A', client_id: 'C-A', RM: 'Test RM One', lead_assigned_at: eveningBefore }),
          TestEL_leadRow_(header, { lead_id: 'L-CH', client_id: 'C-CH', RM: 'Test CH Self', lead_assigned_at: eveningBefore }),
        ]);
        TestEL_bind_(ssO);
        const got = capture(function () { sendOvernightMorningEmails(); });
        TestAssertEqual_(got.two.length + ',' + got.standalone.length, '1,1', '10:00 RED: the combined email and the CH-level overnight report were both built');
        TestAssert_(isLastNotice(got.two[0][1]), '10:00 RED: the combined email ends with the notice');
        TestAssert_(isLastNotice(got.standalone[0]), '10:00 RED: the CH-level overnight report ends with it too');
        TestAssertEqual_(ledgerRows({ ss: ssO }).map(function (r) { return r.job + ':' + r.status; }).sort().join(','), 'chLevel10:ACCEPTED,morning10:ACCEPTED', '10:00 RED: both are ACCEPTED');
      }
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
