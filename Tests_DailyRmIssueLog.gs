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

    // ---- self-healing header: a sheet from before TL/group_source/source_bucket existed ----
    const oldColumns = DAILY_RM_ISSUE_LOG_COLUMNS_.slice(0, 9); // the original 9, pre-2026-09-01
    const healSs = TestMockSpreadsheet_({});
    const healSheet = TestMockSheet_(DAILY_RM_ISSUE_LOG_SHEET_, [oldColumns, ['2026-08-20', 'Test RM One', 'Pune', 'P', 'L-OLD', 'C-OLD', 'stageStuck48h', 'Stuck 48h+', 'old capture']]);
    healSs._sheets[DAILY_RM_ISSUE_LOG_SHEET_] = healSheet;
    ensureDailyRmIssueLogSheet_(healSs);
    const healedHeader = healSheet.getRange(1, 1, 1, DAILY_RM_ISSUE_LOG_COLUMNS_.length).getValues()[0];
    TestAssertEqual_(healedHeader, DAILY_RM_ISSUE_LOG_COLUMNS_, 'ensureDailyRmIssueLogSheet_: self-heals an older 9-column sheet by appending the 3 missing headers, same pattern as ensureMovementLogSheet_');
    TestAssertEqual_(healSheet.getRange(2, 2, 1, 1).getValues()[0][0], 'Test RM One', 'ensureDailyRmIssueLogSheet_: self-healing the header never touches existing data rows');

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
    TestAssertEqual_(row[9], 'Test A1 One', 'captureDailyRmIssuesNow: TL column is captured (2026-09-01 addition, for the dashboard\'s filter support)');
    TestAssertEqual_(row[10], 'google', 'captureDailyRmIssuesNow: group_source column is captured');
    TestAssertEqual_(row[11], 'Non-UTM', 'captureDailyRmIssuesNow: source_bucket column is captured');

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
    TestAssertEqual_(bfByLeadId['L-DAY1-FLAGGED'][9], 'Test A1 One', 'backfillDailyRmIssuesFromMovementLog_: TL column is captured from Movement_Log too (it was in SNAPSHOT_COLUMNS_ from the start, unlike rm_is_active/lead_closing_reason)');
    TestAssertEqual_(bfByLeadId['L-DAY1-FLAGGED'][10], 'google', 'backfillDailyRmIssuesFromMovementLog_: group_source column is captured from Movement_Log');
    TestAssertEqual_(bfByLeadId['L-DAY1-FLAGGED'][11], 'Non-UTM', 'backfillDailyRmIssuesFromMovementLog_: source_bucket column is captured from Movement_Log');

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

    // ---- backfillOneDayFromMovementLog_: single-day recovery (real 2026-09-01 incident) ----
    const odSs = TestMockSpreadsheet_({});
    const odMovementSheet = ensureMovementLogSheet_(odSs);
    const odMovementHeader = odMovementSheet.getRange(1, 1, 1, odMovementSheet.getLastColumn()).getValues()[0];
    const odRow = function (overrides) {
      const defaults = {
        snapshot_at: null, snapshot_label: 'test', lead_id: 'L-X', client_id: 'C-X', RM: 'Test RM One', TL: 'Test A1 One',
        project: 'Test Project', region: 'Pune', client: 'Client',
        lead_assigned_at: '', group_source: 'google', source_bucket: 'Non-UTM', current_stage: 'Suspect',
        last_connect: '', last_connect_time: '', last_comment: '',
        internal_status_comments: '', closing_reason: '', call_attempts: 0, call_count: 0, duration: 0, stage_comments: '',
      };
      const merged = Object.assign({}, defaults, overrides || {});
      return odMovementHeader.map(function (k) { return merged[k]; });
    };

    const odTargetDay = TestFixture_daysAgo_(now, 1); // "yesterday" — the common real-world case
    const odTargetDayKey = istDayKeyGs_(odTargetDay);
    const odEarly = TestFixture_hoursAgo_(new Date(istDayKeyGs_(odTargetDay) + 'T12:00:00+05:30'), 3); // 09:00 IST that day
    const odLate = TestFixture_hoursAgo_(new Date(istDayKeyGs_(odTargetDay) + 'T12:00:00+05:30'), -3); // 15:00 IST — the day's latest run, should win
    const odOtherDay = TestFixture_daysAgo_(now, 2); // a DIFFERENT day, present in Movement_Log — must be left alone

    odMovementSheet.appendRow(odRow({ snapshot_at: odEarly, lead_id: 'L-OD-EARLYONLY', client_id: 'C-OD-EARLYONLY', lead_assigned_at: TestFixture_hoursAgo_(odEarly, 1) }));
    odMovementSheet.appendRow(odRow({ snapshot_at: odLate, lead_id: 'L-OD-FLAGGED', client_id: 'C-OD-FLAGGED', lead_assigned_at: TestFixture_hoursAgo_(odLate, 60) }));
    odMovementSheet.appendRow(odRow({ snapshot_at: odLate, lead_id: 'L-OD-CLOSED', client_id: 'C-OD-CLOSED', current_stage: 'Won', lead_assigned_at: TestFixture_hoursAgo_(odLate, 60) }));
    odMovementSheet.appendRow(odRow({ snapshot_at: odOtherDay, lead_id: 'L-OD-OTHERDAY', client_id: 'C-OD-OTHERDAY', lead_assigned_at: TestFixture_hoursAgo_(odOtherDay, 60) }));

    const odLogSheet = ensureDailyRmIssueLogSheet_(odSs);
    const odResult = backfillOneDayFromMovementLog_(odSs, odTargetDayKey);

    TestAssertEqual_(odResult.skipped, false, 'backfillOneDayFromMovementLog_: a genuinely missing day is not reported as skipped');
    TestAssertEqual_(odResult.rowsWritten, 1, 'backfillOneDayFromMovementLog_: writes exactly 1 row (the one flagged, open lead from the target day\'s LATEST run)');

    const odLoggedRows = odLogSheet.getRange(2, 1, odLogSheet.getLastRow() - 1, DAILY_RM_ISSUE_LOG_COLUMNS_.length).getValues();
    const odById = {};
    odLoggedRows.forEach(function (r) { odById[r[4]] = r; });

    TestAssert_(!odById['L-OD-EARLYONLY'], 'backfillOneDayFromMovementLog_: a lead only present in an EARLIER same-day run is excluded — only the day\'s latest run counts');
    TestAssert_(!!odById['L-OD-FLAGGED'], 'backfillOneDayFromMovementLog_: the flagged open lead from the target day\'s latest run is backfilled');
    TestAssert_(!odById['L-OD-CLOSED'], 'backfillOneDayFromMovementLog_: a closed lead is excluded even from the latest run');
    TestAssert_(!odById['L-OD-OTHERDAY'], 'backfillOneDayFromMovementLog_: a DIFFERENT day\'s Movement_Log data is left alone — only the requested dayKey is touched');
    TestAssertEqual_(odById['L-OD-FLAGGED'][0], odTargetDayKey, 'backfillOneDayFromMovementLog_: date column is the requested dayKey, not today');
    TestAssertEqual_(odById['L-OD-FLAGGED'][9], 'Test A1 One', 'backfillOneDayFromMovementLog_: TL column captured from Movement_Log');
    TestAssertEqual_(odById['L-OD-FLAGGED'][10], 'google', 'backfillOneDayFromMovementLog_: group_source column captured');

    // Re-running the SAME day is safe — idempotency guard skips it.
    const odResult2 = backfillOneDayFromMovementLog_(odSs, odTargetDayKey);
    TestAssertEqual_(odResult2.skipped, true, 'backfillOneDayFromMovementLog_: re-running the same day reports skipped');
    TestAssertEqual_(odResult2.rowsWritten, 0, 'backfillOneDayFromMovementLog_: re-running the same day writes nothing new');

    // A day with no Movement_Log snapshot at all (aged out / never existed).
    const odMissingResult = backfillOneDayFromMovementLog_(odSs, '2020-01-01');
    TestAssertEqual_(odMissingResult.rowsWritten, 0, 'backfillOneDayFromMovementLog_: a day with no Movement_Log snapshot writes nothing and does not throw');
    TestAssertEqual_(odMissingResult.skipped, false, 'backfillOneDayFromMovementLog_: a day with no snapshot is reported as not-skipped (genuinely nothing to find, not "already done")');

    // Safe against a spreadsheet with no Movement_Log at all yet.
    const odEmptySs = TestMockSpreadsheet_({});
    const odEmptyResult = backfillOneDayFromMovementLog_(odEmptySs, odTargetDayKey);
    TestAssertEqual_(odEmptyResult.rowsWritten, 0, 'backfillOneDayFromMovementLog_: does not throw and writes nothing when Movement_Log does not exist yet');

    // Console-callable wrapper: no dayKey given -> defaults to yesterday (IST).
    const realSs7 = SpreadsheetApp;
    const wrapperSs = TestMockSpreadsheet_({});
    SpreadsheetApp = { getActiveSpreadsheet: function () { return wrapperSs; }, flush: function () {} };
    try {
      const wrapperResult = backfillOneDayFromMovementLogNow();
      TestAssertEqual_(wrapperResult.rowsWritten, 0, 'backfillOneDayFromMovementLogNow: does not throw with no argument (defaults to yesterday) against an empty spreadsheet');
    } finally {
      SpreadsheetApp = realSs7;
    }
    // And an explicit dayKey argument is honored, not overridden by the
    // yesterday default — target odSs's already-captured day, which
    // should come back skipped rather than silently re-defaulting.
    SpreadsheetApp = { getActiveSpreadsheet: function () { return odSs; }, flush: function () {} };
    try {
      const explicitResult = backfillOneDayFromMovementLogNow(odTargetDayKey);
      TestAssertEqual_(explicitResult.skipped, true, 'backfillOneDayFromMovementLogNow: an explicit dayKey argument is honored (targets the already-captured day, correctly skipped) rather than silently defaulting to yesterday');
    } finally {
      SpreadsheetApp = realSs7;
    }

    // ---- repairDailyRmIssuesMissingFieldsNow(): real 2026-09-01 incident ----
    const repairSs = TestMockSpreadsheet_({});
    const repairMovementSheet = ensureMovementLogSheet_(repairSs);
    const repairMovementHeader = repairMovementSheet.getRange(1, 1, 1, repairMovementSheet.getLastColumn()).getValues()[0];
    const repairMovementRow = function (overrides) {
      const defaults = {
        snapshot_at: null, snapshot_label: 'test', lead_id: 'L-X', client_id: 'C-X', RM: 'Test RM One', TL: 'Real A1',
        project: 'Test Project', region: 'Pune', client: 'Client',
        lead_assigned_at: '', group_source: 'facebook', source_bucket: 'UTM', current_stage: 'Suspect',
        last_connect: '', last_connect_time: '', last_comment: '',
        internal_status_comments: '', closing_reason: '', call_attempts: 0, call_count: 0, duration: 0, stage_comments: '',
      };
      const merged = Object.assign({}, defaults, overrides || {});
      return repairMovementHeader.map(function (k) { return merged[k]; });
    };
    const repairSnapAt = TestFixture_hoursAgo_(now, 6);
    repairMovementSheet.appendRow(repairMovementRow({ snapshot_at: repairSnapAt, lead_id: 'L-INCOMPLETE', client_id: 'C-INCOMPLETE', TL: 'Real A1', group_source: 'facebook', source_bucket: 'UTM' }));

    const repairLogSheet = ensureDailyRmIssueLogSheet_(repairSs);
    const repairCapturedAt = Utilities.formatDate(repairSnapAt, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss');
    // Row A: already complete (has real values) — must be left untouched.
    repairLogSheet.appendRow([istDayKeyGs_(now), 'Test RM One', 'Pune', 'Test Project', 'L-COMPLETE', 'C-COMPLETE', 'stageStuck48h', 'Stuck 48h+', repairCapturedAt, 'Already A1', 'google', 'Non-UTM']);
    // Row B: incomplete (blank TL/group_source/source_bucket), lead IS in Movement_Log — should get repaired.
    repairLogSheet.appendRow([istDayKeyGs_(now), 'Test RM One', 'Pune', 'Test Project', 'L-INCOMPLETE', 'C-INCOMPLETE', 'stageStuck48h', 'Stuck 48h+', repairCapturedAt, '', '', '']);
    // Row C: incomplete, lead NOT in Movement_Log at all — stays unresolvable.
    repairLogSheet.appendRow([istDayKeyGs_(now), 'Test RM Two', 'Bangalore', 'Test Project', 'L-UNRESOLVABLE', 'C-UNRESOLVABLE', 'followupOverdue', 'Follow-up Overdue', repairCapturedAt, '', '', '']);

    const realSs6 = SpreadsheetApp;
    SpreadsheetApp = { getActiveSpreadsheet: function () { return repairSs; }, flush: function () {} };
    try {
      repairDailyRmIssuesMissingFieldsNow();
    } finally {
      SpreadsheetApp = realSs6;
    }

    const repairedRows = repairLogSheet.getRange(2, 1, 3, DAILY_RM_ISSUE_LOG_COLUMNS_.length).getValues();
    const repairById = {};
    repairedRows.forEach(function (r) { repairById[r[4]] = r; });

    TestAssertEqual_(repairById['L-COMPLETE'][9], 'Already A1', 'repairDailyRmIssuesMissingFieldsNow: an already-complete row\'s TL is left untouched');
    TestAssertEqual_(repairById['L-COMPLETE'][10], 'google', 'repairDailyRmIssuesMissingFieldsNow: an already-complete row\'s group_source is left untouched');
    TestAssertEqual_(repairById['L-COMPLETE'][11], 'Non-UTM', 'repairDailyRmIssuesMissingFieldsNow: an already-complete row\'s source_bucket is left untouched');

    TestAssertEqual_(repairById['L-INCOMPLETE'][9], 'Real A1', 'repairDailyRmIssuesMissingFieldsNow: an incomplete row\'s TL is filled in from Movement_Log');
    TestAssertEqual_(repairById['L-INCOMPLETE'][10], 'facebook', 'repairDailyRmIssuesMissingFieldsNow: an incomplete row\'s group_source is filled in from Movement_Log');
    TestAssertEqual_(repairById['L-INCOMPLETE'][11], 'UTM', 'repairDailyRmIssuesMissingFieldsNow: an incomplete row\'s source_bucket is filled in from Movement_Log');
    // Everything else on the repaired row must be untouched.
    TestAssertEqual_(repairById['L-INCOMPLETE'][6], 'stageStuck48h', 'repairDailyRmIssuesMissingFieldsNow: repairing a row never touches its issue_key');
    TestAssertEqual_(repairById['L-INCOMPLETE'][5], 'C-INCOMPLETE', 'repairDailyRmIssuesMissingFieldsNow: repairing a row never touches its client_id');

    TestAssertEqual_(repairById['L-UNRESOLVABLE'][9], '', 'repairDailyRmIssuesMissingFieldsNow: a lead not found in Movement_Log at all stays blank (not fabricated)');

    // Re-running is safe — the newly-repaired row is now "already complete" and left alone a second time.
    SpreadsheetApp = { getActiveSpreadsheet: function () { return repairSs; }, flush: function () {} };
    try {
      repairDailyRmIssuesMissingFieldsNow();
    } finally {
      SpreadsheetApp = realSs6;
    }
    const repairedRowsAgain = repairLogSheet.getRange(2, 1, 3, DAILY_RM_ISSUE_LOG_COLUMNS_.length).getValues();
    const repairByIdAgain = {};
    repairedRowsAgain.forEach(function (r) { repairByIdAgain[r[4]] = r; });
    TestAssertEqual_(repairByIdAgain['L-INCOMPLETE'][9], 'Real A1', 'repairDailyRmIssuesMissingFieldsNow: re-running is idempotent — the already-repaired row is unchanged');

    // Safe against a sheet whose header still predates the 3 new columns.
    const oldHeaderSs = TestMockSpreadsheet_({});
    const oldHeaderSheet = TestMockSheet_(DAILY_RM_ISSUE_LOG_SHEET_, [DAILY_RM_ISSUE_LOG_COLUMNS_.slice(0, 9), ['2026-08-20', 'Test RM One', 'Pune', 'P', 'L-OLD', 'C-OLD', 'stageStuck48h', 'Stuck 48h+', 'old']]);
    oldHeaderSs._sheets[DAILY_RM_ISSUE_LOG_SHEET_] = oldHeaderSheet;
    SpreadsheetApp = { getActiveSpreadsheet: function () { return oldHeaderSs; }, flush: function () {} };
    try {
      repairDailyRmIssuesMissingFieldsNow();
      TestAssert_(true, 'repairDailyRmIssuesMissingFieldsNow: does not throw against a sheet whose header still predates the 3 new columns');
    } finally {
      SpreadsheetApp = realSs6;
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
