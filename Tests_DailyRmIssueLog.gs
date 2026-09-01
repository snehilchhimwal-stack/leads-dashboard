/**
 * Tests: DailyRmIssueLog.gs — the nightly 22:50 IST SLA-issue capture and
 * the repeat-offender aggregation built on top of it. Run
 * runDailyRmIssueLogTestsNow() from the function dropdown, or via
 * runAllTests() (Tests_RunAll.gs). See Tests_Mocks.gs for the harness.
 *
 * Like every other trigger entry point's own test file
 * (Tests_OvernightEmailer.gs, Tests_AllIssuesEmailer.gs), this uses a real
 * `new Date()` for `now` rather than a fixed date — captureDailyRmIssues_
 * itself always reads the real wall clock (it has no `now` parameter,
 * unlike computeSlaFlags_/etc.), so fixtures here are built relative to
 * this file's own real `now` instead. The few-seconds drift between this
 * `now` and the function's own internal `new Date()` moments later can't
 * affect any assertion below (every fixture sits well clear of an
 * hour/day boundary).
 */
function TestDRIL_row_(overrides) {
  const header = TestFixture_leadsHeader_();
  const defaults = {
    lead_id: 'L-TEST', client_id: 'C-TEST', RM: 'Test RM One', TL: 'Test A1 One',
    project: 'Test Project', region: 'Test Region', client: 'Test Client',
    lead_assigned_at: '', group_source: 'google', source_bucket: 'Non-UTM', current_stage: 'Suspect',
    last_connect: '', last_connect_time: '', last_comment: '',
    internal_status_comments: '', stage_comments: '', closing_reason: '',
    lead_closing_reason: '', rm_is_active: true, call_attempts: 0, call_count: 0, duration: 0,
  };
  const merged = Object.assign({}, defaults, overrides || {});
  return header.map(function (key) { return merged[key]; });
}

function runDailyRmIssueLogTests_() {
  const now = new Date();
  const header = TestFixture_leadsHeader_();
  const banner = header.map(function () { return ''; });

  // Two flagged leads under the SAME RM (both well past 48h — exactly
  // which of the 5 SLA rules ends up "the" primary issue is computed
  // below via the real SlaEngine functions, not hand-derived here; the
  // rules interact (see Tests_SlaEngine.gs), so re-deriving them by hand
  // would just duplicate that file's own job and risk getting it wrong).
  const flaggedRow = TestDRIL_row_({ lead_id: 'L-FLAGGED', client_id: 'C-FLAGGED', RM: 'Test RM One', region: 'Pune', project: 'Test Project', lead_assigned_at: TestFixture_hoursAgo_(now, 60) });
  const flaggedRow2 = TestDRIL_row_({ lead_id: 'L-FLAGGED-2', client_id: 'C-FLAGGED-2', RM: 'Test RM One', region: 'Pune', project: 'Test Project', lead_assigned_at: TestFixture_hoursAgo_(now, 60) });
  // Open, but freshly created and already connected — nothing should fire.
  const cleanRow = TestDRIL_row_({ lead_id: 'L-CLEAN', client_id: 'C-CLEAN', RM: 'Test RM Two', region: 'Pune', project: 'Test Project', lead_assigned_at: TestFixture_hoursAgo_(now, 1), last_connect: 'Connected', last_connect_time: TestFixture_hoursAgo_(now, 0.5) });
  // Closed — must never be logged regardless of how stale it looks.
  const closedRow = TestDRIL_row_({ lead_id: 'L-CLOSED', client_id: 'C-CLOSED', RM: 'Test RM One', region: 'Pune', project: 'Test Project', lead_assigned_at: TestFixture_hoursAgo_(now, 200), current_stage: 'Won' });
  // Blank lead_id — must be skipped, same as every other reader in this project.
  const blankIdRow = TestDRIL_row_({ lead_id: '', lead_assigned_at: TestFixture_hoursAgo_(now, 60) });

  const rows = [banner, header, flaggedRow, flaggedRow2, cleanRow, closedRow, blankIdRow];
  const ss = TestMockSpreadsheet_({});
  ss._sheets['leads'] = TestMockSheet_('leads', rows);

  TestEnv_setUp_('Tests_DailyRmIssueLog', ss);
  try {
    // Ground truth for the flagged fixture, via the real functions
    // captureDailyRmIssues_ itself calls — see this file's own header note.
    const colIndex = buildColIndex_(header);
    const expectedFlags = computeSlaFlags_(flaggedRow, colIndex, now, {});
    const expectedIssue = primaryIssueGs_(expectedFlags);
    TestAssert_(!!expectedIssue, 'sanity: the flagged fixture really is flagged for something, otherwise this whole test proves nothing');

    // ---- ensureDailyRmIssueLogSheet_ ----
    const logSheet = ensureDailyRmIssueLogSheet_(ss);
    TestAssertEqual_(logSheet.getLastRow(), 1, 'ensureDailyRmIssueLogSheet_: a fresh sheet has just the header row');
    TestAssertEqual_(logSheet.getRange(1, 1, 1, DAILY_RM_ISSUE_LOG_COLUMNS_.length).getValues()[0], DAILY_RM_ISSUE_LOG_COLUMNS_, 'ensureDailyRmIssueLogSheet_: header matches DAILY_RM_ISSUE_LOG_COLUMNS_ exactly');
    // Safe to call again on an already-existing sheet — must not throw or duplicate the header.
    ensureDailyRmIssueLogSheet_(ss);
    TestAssertEqual_(logSheet.getLastRow(), 1, 'ensureDailyRmIssueLogSheet_: re-running against an existing sheet does not touch it further');

    // ---- captureDailyRmIssuesNow(): first run tonight ----
    captureDailyRmIssuesNow();
    TestAssertEqual_(logSheet.getLastRow(), 3, 'captureDailyRmIssuesNow: exactly 2 data rows written (the 2 flagged leads; clean/closed/blank-id are all correctly excluded)');

    const loggedRows = logSheet.getRange(2, 1, 2, DAILY_RM_ISSUE_LOG_COLUMNS_.length).getValues();
    const byLeadId = {};
    loggedRows.forEach(function (r) { byLeadId[r[4]] = r; }); // column index 4 = lead_id
    TestAssert_(!!byLeadId['L-FLAGGED'] && !!byLeadId['L-FLAGGED-2'], 'captureDailyRmIssuesNow: both flagged leads under the same RM are logged as separate rows (not deduped by customer)');
    ['L-CLEAN', 'L-CLOSED', ''].forEach(function (id) {
      TestAssert_(!byLeadId[id], 'captureDailyRmIssuesNow: ' + (id || '(blank lead_id)') + ' is correctly NOT logged');
    });

    const row = byLeadId['L-FLAGGED'];
    TestAssertEqual_(row[0], istDayKeyGs_(now), 'captureDailyRmIssuesNow: date column is today\'s IST day key');
    TestAssertEqual_(row[1], 'Test RM One', 'captureDailyRmIssuesNow: RM column is correct');
    TestAssertEqual_(row[2], 'Pune', 'captureDailyRmIssuesNow: region column is correct');
    TestAssertEqual_(row[3], 'Test Project', 'captureDailyRmIssuesNow: project column is correct');
    TestAssertEqual_(row[5], 'C-FLAGGED', 'captureDailyRmIssuesNow: client_id column is correct');
    TestAssertEqual_(row[6], expectedIssue.key, 'captureDailyRmIssuesNow: issue_key matches what computeSlaFlags_/primaryIssueGs_ actually compute for this lead');
    TestAssertEqual_(row[7], expectedIssue.label, 'captureDailyRmIssuesNow: issue_label matches too');
    TestAssert_(!!String(row[8] || '').trim(), 'captureDailyRmIssuesNow: captured_at is populated');

    // ---- idempotency: a second run the SAME night logs nothing new ----
    captureDailyRmIssuesNow();
    TestAssertEqual_(logSheet.getLastRow(), 3, 'captureDailyRmIssuesNow: a second run the same night does not duplicate rows — idempotency guard working');

    // ---- a night with nothing flagged logs nothing, and does not throw ----
    const quietSs = TestMockSpreadsheet_({});
    quietSs._sheets['leads'] = TestMockSheet_('leads', [banner, header, cleanRow]);
    const realSs = SpreadsheetApp;
    SpreadsheetApp = { getActiveSpreadsheet: function () { return quietSs; }, flush: function () {} };
    try {
      captureDailyRmIssuesNow();
      const quietLogSheet = quietSs.getSheetByName(DAILY_RM_ISSUE_LOG_SHEET_);
      TestAssert_(!!quietLogSheet && quietLogSheet.getLastRow() === 1, 'captureDailyRmIssuesNow: a night with nothing flagged writes no rows (header only) and does not throw');
    } finally {
      SpreadsheetApp = realSs;
    }

    // ---- computeRepeatOffenderRmsGs_: pure aggregation over a hand-seeded log ----
    const repeatSs = TestMockSpreadsheet_({});
    const repeatLogSheet = ensureDailyRmIssueLogSheet_(repeatSs);
    const capturedAt = Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss');
    const dateToday = istDayKeyGs_(now);
    const date2DaysAgo = istDayKeyGs_(TestFixture_daysAgo_(now, 2));
    const date5DaysAgo = istDayKeyGs_(TestFixture_daysAgo_(now, 5));
    const date20DaysAgo = istDayKeyGs_(TestFixture_daysAgo_(now, 20));
    [
      [dateToday, 'Test RM One', 'Pune', 'P', 'L-1', 'C-1', 'stageStuck48h', 'Stuck 48h+', capturedAt],
      [date2DaysAgo, 'Test RM One', 'Pune', 'P', 'L-2', 'C-2', 'stageStuck48h', 'Stuck 48h+', capturedAt],
      [date5DaysAgo, 'Test RM One', 'Pune', 'P', 'L-3', 'C-3', 'followupOverdue', 'Follow-up Overdue', capturedAt],
      [dateToday, 'Test RM Two', 'Bangalore', 'P2', 'L-4', 'C-4', 'underCalledToday', "Behind on Today's Calls", capturedAt],
      // Outside the default 14-day window — must be excluded unless sinceDaysBack widens.
      [date20DaysAgo, 'Test RM Old', 'Pune', 'P', 'L-5', 'C-5', 'stageStuck48h', 'Stuck 48h+', capturedAt],
    ].forEach(function (r) { repeatLogSheet.appendRow(r); });

    let results = computeRepeatOffenderRmsGs_(repeatSs, {});
    TestAssertEqual_(results.length, 2, 'computeRepeatOffenderRmsGs_: default 14-day window excludes Test RM Old (flagged 20 days back)');
    TestAssertEqual_(results[0].RM, 'Test RM One', 'computeRepeatOffenderRmsGs_: the RM with more distinct days AND issue types sorts first');
    TestAssertEqual_(results[0].distinctDays, 3, 'computeRepeatOffenderRmsGs_: distinctDays counts 3 separate days for Test RM One');
    TestAssertEqual_(results[0].distinctIssueTypes, 2, 'computeRepeatOffenderRmsGs_: distinctIssueTypes counts stageStuck48h + followupOverdue');
    TestAssertEqual_(results[0].totalInstances, 3, 'computeRepeatOffenderRmsGs_: totalInstances counts every row, not just distinct days');
    TestAssertEqual_(results[0].byIssue.stageStuck48h, 2, 'computeRepeatOffenderRmsGs_: byIssue breaks down per-issue-key counts correctly');
    TestAssertEqual_(results[0].byIssue.followupOverdue, 1, 'computeRepeatOffenderRmsGs_: ...for every issue key present, not just the most common one');
    TestAssertEqual_(results[1].RM, 'Test RM Two', 'computeRepeatOffenderRmsGs_: a one-off single-day RM sorts after the persistent one');
    TestAssertEqual_(results[1].distinctDays, 1, 'computeRepeatOffenderRmsGs_: Test RM Two correctly shows just 1 distinct day');

    results = computeRepeatOffenderRmsGs_(repeatSs, { sinceDaysBack: 30 });
    TestAssertEqual_(results.length, 3, 'computeRepeatOffenderRmsGs_: a wider sinceDaysBack picks up Test RM Old too');
    TestAssert_(results.some(function (r) { return r.RM === 'Test RM Old'; }), 'computeRepeatOffenderRmsGs_: Test RM Old is present once the window covers 20 days back');

    TestAssertEqual_(computeRepeatOffenderRmsGs_(TestMockSpreadsheet_({}), {}).length, 0, 'computeRepeatOffenderRmsGs_: returns an empty array when Daily_RM_Issues does not exist yet');

    // ---- reportRepeatOffenderRmsNow(): console-callable wrapper, smoke test only ----
    const realSs2 = SpreadsheetApp;
    SpreadsheetApp = { getActiveSpreadsheet: function () { return TestMockSpreadsheet_({}); }, flush: function () {} };
    try {
      reportRepeatOffenderRmsNow(); // must not throw against a spreadsheet with no Daily_RM_Issues data at all yet
      TestAssert_(true, 'reportRepeatOffenderRmsNow: does not throw when there is no Daily_RM_Issues data yet');
    } finally {
      SpreadsheetApp = realSs2;
    }
    const realSs3 = SpreadsheetApp;
    SpreadsheetApp = { getActiveSpreadsheet: function () { return repeatSs; }, flush: function () {} };
    try {
      reportRepeatOffenderRmsNow(); // must not throw against real accumulated data either
      TestAssert_(true, 'reportRepeatOffenderRmsNow: does not throw against populated Daily_RM_Issues data');
    } finally {
      SpreadsheetApp = realSs3;
    }

    // ---- backfillDailyRmIssuesFromMovementLog_: reconstructs history from Movement_Log ----
    const bfSs = TestMockSpreadsheet_({});
    const movementSheet = ensureMovementLogSheet_(bfSs); // real header, so this can't drift from production
    const movementHeader = movementSheet.getRange(1, 1, 1, movementSheet.getLastColumn()).getValues()[0];
    const bfRow = function (overrides) {
      const defaults = {
        snapshot_at: null, snapshot_label: 'test', lead_id: 'L-X', client_id: 'C-X', RM: 'Test RM One', TL: 'Test A1 One',
        project: 'Test Project', region: 'Pune', client: 'Client',
        lead_assigned_at: '', group_source: 'google', source_bucket: 'Non-UTM', current_stage: 'Suspect',
        last_connect: '', last_connect_time: '', last_comment: '',
        internal_status_comments: '', closing_reason: '', call_attempts: 0, call_count: 0, duration: 0, stage_comments: '',
      };
      const merged = Object.assign({}, defaults, overrides || {});
      return movementHeader.map(function (k) { return merged[k]; });
    };

    // day1Early/day1Late must land on the exact SAME IST calendar day (two
    // runs, one day) — noon-anchored to whatever calendar day "3 days ago"
    // falls on, then offset a few hours either side, so this can never
    // accidentally spill into a different day depending on what real
    // hour `now` happens to be when the suite runs.
    const day1Anchor = TestFixture_daysAgo_(now, 3);
    const day1Noon = new Date(istDayKeyGs_(day1Anchor) + 'T12:00:00+05:30');
    const day1Early = TestFixture_hoursAgo_(day1Noon, 3); // 09:00 IST that day
    const day1Late = TestFixture_hoursAgo_(day1Noon, -3); // 15:00 IST that day — the day's LATEST run, this is the one that should win
    const day2At = TestFixture_daysAgo_(now, 2);
    const day3At = TestFixture_daysAgo_(now, 1); // this day is pre-seeded into Daily_RM_Issues below — must be skipped

    // Day 1: TWO runs. The early run's only lead (L-EARLYONLY) must NOT
    // survive into the backfill — only the later run's rows should.
    movementSheet.appendRow(bfRow({ snapshot_at: day1Early, lead_id: 'L-EARLYONLY', client_id: 'C-EARLYONLY', lead_assigned_at: TestFixture_hoursAgo_(day1Early, 1) }));
    movementSheet.appendRow(bfRow({ snapshot_at: day1Late, lead_id: 'L-DAY1-FLAGGED', client_id: 'C-DAY1-FLAGGED', lead_assigned_at: TestFixture_hoursAgo_(day1Late, 60) })); // well past 48h as of day1Late
    movementSheet.appendRow(bfRow({ snapshot_at: day1Late, lead_id: 'L-DAY1-CLOSED', client_id: 'C-DAY1-CLOSED', current_stage: 'Won', lead_assigned_at: TestFixture_hoursAgo_(day1Late, 60) }));

    // Day 2: one run, one flagged lead, plus a lead closed ONLY via
    // lead_closing_reason (not the RM-entered closing_reason, not stage)
    // — proves the 2026-09-01 fix (lead_closing_reason is now captured
    // into Movement_Log and read dynamically here) actually works, not
    // just that the old hardcoded-'' limitation was removed from a
    // comment.
    movementSheet.appendRow(bfRow({ snapshot_at: day2At, lead_id: 'L-DAY2-FLAGGED', client_id: 'C-DAY2-FLAGGED', lead_assigned_at: TestFixture_hoursAgo_(day2At, 60) }));
    movementSheet.appendRow(bfRow({ snapshot_at: day2At, lead_id: 'L-DAY2-CLOSED-VIA-LEADCLOSING', client_id: 'C-DAY2-CLOSED-VIA-LEADCLOSING', lead_closing_reason: 'Duplicate', lead_assigned_at: TestFixture_hoursAgo_(day2At, 60) }));

    // Day 3: has a Movement_Log snapshot too, but Daily_RM_Issues is
    // pre-seeded for this day below — must be skipped entirely.
    movementSheet.appendRow(bfRow({ snapshot_at: day3At, lead_id: 'L-DAY3-FLAGGED', client_id: 'C-DAY3-FLAGGED', lead_assigned_at: TestFixture_hoursAgo_(day3At, 60) }));

    const bfLogSheet = ensureDailyRmIssueLogSheet_(bfSs);
    bfLogSheet.appendRow([istDayKeyGs_(day3At), 'Test RM One', 'Pune', 'Test Project', 'L-ALREADY-CAPTURED', 'C-ALREADY-CAPTURED', 'stageStuck48h', 'Stuck 48h+', 'already captured']);

    const bfResult = backfillDailyRmIssuesFromMovementLog_(bfSs);

    TestAssertEqual_(bfResult.daysBackfilled.length, 2, 'backfillDailyRmIssuesFromMovementLog_: backfills exactly 2 days (day 1 and day 2 — day 3 is skipped, already captured)');
    TestAssertEqual_(bfResult.daysSkipped.length, 1, 'backfillDailyRmIssuesFromMovementLog_: reports exactly 1 skipped day');
    TestAssertContains_(bfResult.daysSkipped[0], istDayKeyGs_(day3At), 'backfillDailyRmIssuesFromMovementLog_: the skipped day is day 3, by name');

    const bfLoggedRows = bfLogSheet.getRange(2, 1, bfLogSheet.getLastRow() - 1, DAILY_RM_ISSUE_LOG_COLUMNS_.length).getValues();
    const bfByLeadId = {};
    bfLoggedRows.forEach(function (r) { bfByLeadId[r[4]] = r; });

    TestAssert_(!bfByLeadId['L-EARLYONLY'], 'backfillDailyRmIssuesFromMovementLog_: a lead only present in an EARLIER same-day run is correctly excluded — only the day\'s LATEST run counts');
    TestAssert_(!!bfByLeadId['L-DAY1-FLAGGED'], 'backfillDailyRmIssuesFromMovementLog_: a flagged open lead from the day\'s latest run is backfilled');
    TestAssert_(!bfByLeadId['L-DAY1-CLOSED'], 'backfillDailyRmIssuesFromMovementLog_: a closed lead is correctly excluded, even from the day\'s latest run');
    TestAssert_(!!bfByLeadId['L-DAY2-FLAGGED'], 'backfillDailyRmIssuesFromMovementLog_: day 2 (a single-run day) is backfilled too');
    TestAssert_(!bfByLeadId['L-DAY2-CLOSED-VIA-LEADCLOSING'], 'backfillDailyRmIssuesFromMovementLog_: a lead closed ONLY via lead_closing_reason is correctly excluded — proves lead_closing_reason is now really read from Movement_Log, not just documented as fixed');
    TestAssert_(!bfByLeadId['L-DAY3-FLAGGED'], 'backfillDailyRmIssuesFromMovementLog_: day 3\'s Movement_Log data is NOT backfilled — Daily_RM_Issues already had a row for that day');
    TestAssertEqual_(bfByLeadId['L-ALREADY-CAPTURED'][6], 'stageStuck48h', 'backfillDailyRmIssuesFromMovementLog_: the pre-seeded day-3 row itself is left untouched');

    TestAssertEqual_(bfByLeadId['L-DAY1-FLAGGED'][0], istDayKeyGs_(day1Late), 'backfillDailyRmIssuesFromMovementLog_: date column uses the snapshot\'s own IST day, not today');
    TestAssertEqual_(bfByLeadId['L-DAY1-FLAGGED'][1], 'Test RM One', 'backfillDailyRmIssuesFromMovementLog_: RM column correct');
    TestAssertEqual_(bfByLeadId['L-DAY1-FLAGGED'][5], 'C-DAY1-FLAGGED', 'backfillDailyRmIssuesFromMovementLog_: client_id column correct');
    TestAssert_(!!String(bfByLeadId['L-DAY1-FLAGGED'][8] || '').trim(), 'backfillDailyRmIssuesFromMovementLog_: captured_at is populated, using the snapshot\'s own time');

    // Re-running is safe (idempotent) — a second call must skip everything
    // it just wrote, adding nothing new.
    const bfRowCountAfterFirst = bfLogSheet.getLastRow();
    const bfResult2 = backfillDailyRmIssuesFromMovementLog_(bfSs);
    TestAssertEqual_(bfResult2.rowsWritten, 0, 'backfillDailyRmIssuesFromMovementLog_: re-running writes nothing new');
    TestAssertEqual_(bfLogSheet.getLastRow(), bfRowCountAfterFirst, 'backfillDailyRmIssuesFromMovementLog_: re-running does not change the sheet\'s row count at all');

    // Safe against a spreadsheet with no Movement_Log at all yet.
    const bfEmptySs = TestMockSpreadsheet_({});
    const bfEmptyResult = backfillDailyRmIssuesFromMovementLog_(bfEmptySs);
    TestAssertEqual_(bfEmptyResult.rowsWritten, 0, 'backfillDailyRmIssuesFromMovementLog_: does not throw and writes nothing when Movement_Log does not exist yet');

    // Console-callable wrapper, smoke test only.
    const realSs5 = SpreadsheetApp;
    SpreadsheetApp = { getActiveSpreadsheet: function () { return bfEmptySs; }, flush: function () {} };
    try {
      backfillDailyRmIssuesFromMovementLogNow();
      TestAssert_(true, 'backfillDailyRmIssuesFromMovementLogNow: does not throw');
    } finally {
      SpreadsheetApp = realSs5;
    }

    TestAssertOnlyTestEmails_();

    // ---- Top-level containment: a crash anywhere in captureDailyRmIssues_
    // must alert ops before it aborts, not fail silently — same
    // crash-alerts-ops-then-rethrows pattern as every other unattended
    // entry point in this project (sendAllIssuesEmails,
    // sendOvernightMorningEmails, sendOvernightFollowupEmails). A silent
    // failure here would mean a missing night's data with no signal to
    // anyone, and this log's whole value is an unbroken day-over-day series.
    // Deliberately a FRESH spreadsheet (no Daily_RM_Issues rows for today
    // yet) — reusing `ss` above would hit the idempotency guard (which
    // runs BEFORE readLeadsTab_ is ever called, unlike OvernightEmailer's
    // PER-REGION idempotency check, which runs after) and return early
    // without ever reaching the monkey-patched readLeadsTab_ below.
    const crashSs = TestMockSpreadsheet_({});
    crashSs._sheets['leads'] = TestMockSheet_('leads', [banner, header, flaggedRow]);
    const realSs4 = SpreadsheetApp;
    SpreadsheetApp = { getActiveSpreadsheet: function () { return crashSs; }, flush: function () {} };
    const realReadLeadsTab = readLeadsTab_;
    readLeadsTab_ = function () { throw new Error('simulated total failure — Sheets error withRetry_ could not recover from'); };
    try {
      TestAssertThrows_(function () { captureDailyRmIssues(); }, 'captureDailyRmIssues: a total crash still re-throws — the Apps Script Executions log correctly shows this run as Failed, never silently swallowed');
      TestAssert_(TestGmailLog_.sent.some(function (e) { return /captureDailyRmIssues crashed/.test(e.subject); }), 'captureDailyRmIssues: a total crash fires an ops alert BEFORE re-throwing, naming the crash explicitly');
    } finally {
      readLeadsTab_ = realReadLeadsTab;
      SpreadsheetApp = realSs4;
    }
  } finally {
    TestEnv_tearDown_();
  }
  return TestResults_;
}

function runDailyRmIssueLogTestsNow() { runDailyRmIssueLogTests_(); }
