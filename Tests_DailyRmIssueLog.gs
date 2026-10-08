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

    // ---- captureDailyRmIssues_'s nightly write is chunked (2026-09 fix) ----
    // Real incident (2026-09-01): a single unchunked setValues() covering
    // the whole night's rows is an all-or-nothing write — this rebuilds
    // that exact shape (comfortably past 2 chunk boundaries) and confirms
    // every row lands correctly with none dropped/duplicated/misplaced at
    // a chunk edge, the risk this specific change could introduce.
    const bigRowCount = BACKFILL_CHUNK_SIZE_ * 2 + 37; // 2 full chunks + 1 partial
    const bigRows = [banner, header];
    for (let i = 0; i < bigRowCount; i++) {
      bigRows.push(TestDRIL_row_({
        lead_id: 'L-BIG-' + i, client_id: 'C-BIG-' + i, RM: 'Test RM One', region: 'Pune',
        project: 'Test Project', lead_assigned_at: TestFixture_hoursAgo_(now, 60),
      }));
    }
    const bigSs = TestMockSpreadsheet_({});
    bigSs._sheets['leads'] = TestMockSheet_('leads', bigRows);
    const realSsForBigTest = SpreadsheetApp;
    SpreadsheetApp = { getActiveSpreadsheet: function () { return bigSs; }, flush: function () {} };
    try {
      captureDailyRmIssuesNow();
      const bigLogSheet = bigSs.getSheetByName(DAILY_RM_ISSUE_LOG_SHEET_);
      TestAssertEqual_(bigLogSheet.getLastRow(), bigRowCount + 1, 'captureDailyRmIssuesNow (chunked write): every one of ' + bigRowCount + ' flagged leads is written — none lost across the ' + Math.ceil(bigRowCount / BACKFILL_CHUNK_SIZE_) + '-chunk boundary');
      const allBigRows = bigLogSheet.getRange(2, 1, bigRowCount, DAILY_RM_ISSUE_LOG_COLUMNS_.length).getValues();
      const bigIds = allBigRows.map(function (r) { return r[4]; });
      TestAssertEqual_(bigIds[0], 'L-BIG-0', 'captureDailyRmIssuesNow (chunked write): first row is the first lead, in original order');
      TestAssertEqual_(bigIds[BACKFILL_CHUNK_SIZE_ - 1], 'L-BIG-' + (BACKFILL_CHUNK_SIZE_ - 1), 'captureDailyRmIssuesNow (chunked write): last row of chunk 1 is exactly right — no off-by-one at the boundary');
      TestAssertEqual_(bigIds[BACKFILL_CHUNK_SIZE_], 'L-BIG-' + BACKFILL_CHUNK_SIZE_, 'captureDailyRmIssuesNow (chunked write): first row of chunk 2 picks up immediately after chunk 1, nothing skipped or repeated');
      TestAssertEqual_(bigIds[bigRowCount - 1], 'L-BIG-' + (bigRowCount - 1), 'captureDailyRmIssuesNow (chunked write): last row overall (the partial 3rd chunk) is correct');
      TestAssertEqual_(new Set(bigIds).size, bigRowCount, 'captureDailyRmIssuesNow (chunked write): all lead_ids are distinct — no row duplicated across a chunk boundary');
    } finally {
      SpreadsheetApp = realSsForBigTest;
    }

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

    // ---- pruneDailyRmIssueLog_: retention cutoff + row-headroom shrink
    // (2026-09-07 fix for the real production incident where
    // captureDailyRmIssues crashed on the workbook's 10,000,000-cell
    // ceiling — this table had no pruning at all before this) ----
    // Real wall clock, same reasoning as pruneMovementLog_'s own test
    // above: the cutoff is computed from Date.now(), not an injectable
    // `now`, so fixtures must be relative to a freshly-read real moment.
    const realNowForPrune = new Date();
    const prLogHeader = DAILY_RM_ISSUE_LOG_COLUMNS_;
    // The `date` column can read back as EITHER a real Date object or a
    // plain string, depending on whether Sheets auto-converted it on
    // write (see pruneDailyRmIssueLog_'s own comment) — covering both
    // shapes here, for both an old and a recent row, is the whole point
    // of this fixture set.
    const prOldDateCell = TestFixture_daysAgo_(realNowForPrune, 40); // outside 30-day retention
    const prOldStringCell = istDayKeyGs_(TestFixture_daysAgo_(realNowForPrune, 45)); // outside, string-shaped
    const prRecentDateCell = TestFixture_daysAgo_(realNowForPrune, 5); // inside retention
    const prRecentStringCell = istDayKeyGs_(TestFixture_daysAgo_(realNowForPrune, 3)); // inside, string-shaped
    function prRow_(dateCell, tag) {
      return prLogHeader.map(function (col) {
        if (col === 'date') return dateCell;
        if (col === 'RM') return tag;
        return '';
      });
    }
    const prSs = TestMockSpreadsheet_({});
    const prSheet = TestMockSheet_(DAILY_RM_ISSUE_LOG_SHEET_, [
      prLogHeader,
      prRow_(prOldDateCell, 'old-date'),
      prRow_(prOldStringCell, 'old-string'),
      prRow_(prRecentDateCell, 'recent-date'),
      prRow_(prRecentStringCell, 'recent-string'),
    ]);
    // Simulate a sheet that has grown a large row allocation over months
    // of unpruned use — real DAILY_RM_ISSUE_LOG_ROW_HEADROOM_ is 2000, so
    // only an allocation well beyond (kept rows + 2000) actually exercises
    // the shrink branch.
    prSheet._maxRows = 10000;
    prSs._sheets[DAILY_RM_ISSUE_LOG_SHEET_] = prSheet;
    // Shared across every pruneDailyRmIssueLog_ call in this whole test
    // group (below too) — restored once at the end, same "one swap covers
    // several sequential calls" shape as this file's other prune tests.
    const realDriveForDailyPrune = DriveApp;
    const mockDriveForDailyPrune = TestMockDriveApp_();
    DriveApp = mockDriveForDailyPrune;
    pruneDailyRmIssueLog_(prSs);
    const prKeptRows = prSheet.getRange(2, 1, prSheet.getLastRow() - 1, prLogHeader.length).getValues();
    const prKeptTags = prKeptRows.map(function (r) { return r[1]; });
    TestAssertEqual_(prKeptTags.indexOf('old-date'), -1, 'pruneDailyRmIssueLog_: a Date-typed row older than the retention window is dropped');
    TestAssertEqual_(prKeptTags.indexOf('old-string'), -1, 'pruneDailyRmIssueLog_: a string-typed row older than the retention window is dropped');
    TestAssert_(prKeptTags.indexOf('recent-date') >= 0, 'pruneDailyRmIssueLog_: a Date-typed row within the retention window is kept');
    TestAssert_(prKeptTags.indexOf('recent-string') >= 0, 'pruneDailyRmIssueLog_: a string-typed row within the retention window is kept');
    TestAssertEqual_(prKeptTags.length, 2, 'pruneDailyRmIssueLog_: exactly the 2 recent rows survive, nothing extra');
    TestAssert_(prSheet.getMaxRows() < 10000, 'pruneDailyRmIssueLog_: shrinks an over-allocated sheet\'s row count back down toward kept-rows + DAILY_RM_ISSUE_LOG_ROW_HEADROOM_');
    TestAssert_(prSheet.getMaxRows() >= 1 + 2 + DAILY_RM_ISSUE_LOG_ROW_HEADROOM_, 'pruneDailyRmIssueLog_: never shrinks below what the kept rows + headroom actually need');
    // 2026-09-21 addition: archiveRowsToDriveCsv_ (Core.gs) — the 2 dropped
    // rows ('old-date'/'old-string') must land in a Drive CSV first.
    const dailyArchiveRoot = mockDriveForDailyPrune._folders[ARCHIVE_ROOT_FOLDER_];
    TestAssert_(!!dailyArchiveRoot, 'pruneDailyRmIssueLog_: archives dropped rows under the shared ARCHIVE_ROOT_FOLDER_');
    const dailyArchiveFolder = dailyArchiveRoot && dailyArchiveRoot._folders['Daily_RM_Issues'];
    TestAssert_(!!dailyArchiveFolder, 'pruneDailyRmIssueLog_: archives dropped rows into a Daily_RM_Issues subfolder before removing them from the sheet');
    const dailyArchivedContent = dailyArchiveFolder._filesList[0]._content;
    TestAssert_(dailyArchivedContent.indexOf('old-date') >= 0 && dailyArchivedContent.indexOf('old-string') >= 0, 'pruneDailyRmIssueLog_: the archived CSV contains BOTH dropped rows');
    TestAssert_(dailyArchivedContent.indexOf('recent-date') === -1 && dailyArchivedContent.indexOf('recent-string') === -1, 'pruneDailyRmIssueLog_: the archived CSV does NOT contain either kept row');
    TestAssert_(/^Daily_RM_Issues_rows_.+_to_.+_archived_/.test(dailyArchiveFolder._filesList[0]._name), 'pruneDailyRmIssueLog_: the archive filename encodes the actual row-date range, not just the run timestamp');
    const dailyManifest = dailyArchiveRoot._files[ARCHIVE_MANIFEST_FILE_];
    TestAssert_(!!dailyManifest, 'pruneDailyRmIssueLog_: writes a manifest row into the shared archive_log.csv');

    // ---- pruneDailyRmIssueLog_(ss, incomingRowCount): 2026-09-19 fix for
    // the SECOND real "10,000,000 cells" incident — the sheet must be
    // sized for the caller's about-to-be-written rows too, not just
    // kept.length + the fixed headroom alone, or the write immediately
    // after this call is exactly what forces the grid to expand and blow
    // the workbook ceiling again. Re-uses the same 2-recent-row fixture
    // shape as the test above, freshly re-seeded since the previous call
    // already pruned prSheet in place. ----
    const prIncSheet = TestMockSheet_(DAILY_RM_ISSUE_LOG_SHEET_, [
      prLogHeader,
      prRow_(prOldDateCell, 'old-date'),
      prRow_(prRecentDateCell, 'recent-date'),
      prRow_(prRecentStringCell, 'recent-string'),
    ]);
    prIncSheet._maxRows = 10000;
    const prIncSs = TestMockSpreadsheet_({});
    prIncSs._sheets[DAILY_RM_ISSUE_LOG_SHEET_] = prIncSheet;
    const prIncomingRowCount = 26660; // real documented single-night volume, per this file's own header comment
    pruneDailyRmIssueLog_(prIncSs, prIncomingRowCount);
    TestAssert_(
      prIncSheet.getMaxRows() >= 1 + 2 + prIncomingRowCount + DAILY_RM_ISSUE_LOG_ROW_HEADROOM_,
      'pruneDailyRmIssueLog_: with incomingRowCount passed, sizes the sheet to fit kept rows PLUS the caller\'s pending write, not just kept + headroom alone'
    );
    // And the no-argument call path (pruneDailyRmIssueLogNow's own usage)
    // must keep behaving exactly as before — incomingRowCount defaults to
    // 0, so this is a pure regression guard on the original fix's shape.
    const prNoIncSheet = TestMockSheet_(DAILY_RM_ISSUE_LOG_SHEET_, [
      prLogHeader,
      prRow_(prOldDateCell, 'old-date'),
      prRow_(prRecentDateCell, 'recent-date'),
      prRow_(prRecentStringCell, 'recent-string'),
    ]);
    prNoIncSheet._maxRows = 10000;
    const prNoIncSs = TestMockSpreadsheet_({});
    prNoIncSs._sheets[DAILY_RM_ISSUE_LOG_SHEET_] = prNoIncSheet;
    pruneDailyRmIssueLog_(prNoIncSs);
    TestAssert_(
      prNoIncSheet.getMaxRows() < 1 + 2 + prIncomingRowCount + DAILY_RM_ISSUE_LOG_ROW_HEADROOM_,
      'pruneDailyRmIssueLog_: omitting incomingRowCount (the manual-recovery call shape) does not over-allocate as if a large write were pending'
    );
    DriveApp = realDriveForDailyPrune;

    // ---- pruneDailyRmIssueLogNow(): the one-off manual recovery entry
    // point resolves SpreadsheetApp.getActiveSpreadsheet() itself, same
    // pattern as pruneMovementLogNow ----
    const prNowSs = TestMockSpreadsheet_({});
    const prNowSheet = TestMockSheet_(DAILY_RM_ISSUE_LOG_SHEET_, [prLogHeader, prRow_(prOldDateCell, 'old-date')]);
    prNowSs._sheets[DAILY_RM_ISSUE_LOG_SHEET_] = prNowSheet;
    const realSsForPruneNow = SpreadsheetApp;
    const realDriveForPruneNow = DriveApp;
    const mockDriveForPruneNow = TestMockDriveApp_();
    SpreadsheetApp = { getActiveSpreadsheet: function () { return prNowSs; }, flush: function () {} };
    DriveApp = mockDriveForPruneNow;
    try {
      pruneDailyRmIssueLogNow();
      TestAssertEqual_(prNowSheet.getLastRow(), 1, 'pruneDailyRmIssueLogNow: manual recovery entry point prunes the ACTIVE spreadsheet\'s Daily_RM_Issues, dropping the old row down to header-only');
      const pruneNowRoot = mockDriveForPruneNow._folders[ARCHIVE_ROOT_FOLDER_];
      TestAssert_(!!pruneNowRoot && !!pruneNowRoot._folders['Daily_RM_Issues'], 'pruneDailyRmIssueLogNow: the manual recovery path archives the dropped row too, same as the nightly path');
    } finally {
      SpreadsheetApp = realSsForPruneNow;
      DriveApp = realDriveForPruneNow;
    }

    // ---- integration: captureDailyRmIssues_ prunes BEFORE writing, so a
    // sheet already over its row-allocation headroom still gets tonight's
    // capture written correctly in the SAME run — this is the exact
    // ordering fix for the real incident (a write-then-prune order can
    // never self-heal once a sheet is already over the cell ceiling,
    // since the write throws before pruning is ever reached) ----
    const intSs = TestMockSpreadsheet_({});
    intSs._sheets['leads'] = TestMockSheet_('leads', [banner, header, flaggedRow]);
    const intOldRows = [prLogHeader];
    for (let i = 0; i < 50; i++) { intOldRows.push(prRow_(TestFixture_daysAgo_(realNowForPrune, 40), 'stale-' + i)); }
    const intLogSheet = TestMockSheet_(DAILY_RM_ISSUE_LOG_SHEET_, intOldRows);
    intLogSheet._maxRows = 10000;
    intSs._sheets[DAILY_RM_ISSUE_LOG_SHEET_] = intLogSheet;
    const realSsForInt = SpreadsheetApp;
    const realDriveForInt = DriveApp;
    const mockDriveForInt = TestMockDriveApp_();
    SpreadsheetApp = { getActiveSpreadsheet: function () { return intSs; }, flush: function () {} };
    DriveApp = mockDriveForInt;
    try {
      captureDailyRmIssuesNow();
      const intRows = intLogSheet.getRange(2, 1, intLogSheet.getLastRow() - 1, prLogHeader.length).getValues();
      const intTags = intRows.map(function (r) { return r[1]; });
      TestAssertEqual_(intTags.filter(function (t) { return String(t).indexOf('stale-') === 0; }).length, 0, 'captureDailyRmIssuesNow: the 50 stale rows from before tonight are pruned as part of the same run');
      TestAssert_(intTags.indexOf('Test RM One') >= 0, 'captureDailyRmIssuesNow: tonight\'s real flagged row is still written correctly in the same run pruning happened');
      TestAssert_(intLogSheet.getMaxRows() < 10000, 'captureDailyRmIssuesNow: row allocation is shrunk as part of the same run, not left over-allocated');
      const intArchiveFolder = mockDriveForInt._folders[ARCHIVE_ROOT_FOLDER_] && mockDriveForInt._folders[ARCHIVE_ROOT_FOLDER_]._folders['Daily_RM_Issues'];
      TestAssert_(!!intArchiveFolder, 'captureDailyRmIssuesNow: the 50 pruned stale rows are archived to Drive as part of the same run');
      TestAssertEqual_(intArchiveFolder._filesList[0]._content.split('\n').length, 51, 'captureDailyRmIssuesNow: the archive contains all 50 stale rows plus a header line');
    } finally {
      SpreadsheetApp = realSsForInt;
      DriveApp = realDriveForInt;
    }

    // ---- 2026-09-25 (3rd 10M-cell incident): captureDailyRmIssues_ prunes
    // Movement_Log UP FRONT, before the company scan and any write ----
    const mlHeader = ['snapshot_at', 'snapshot_label', 'lead_id'];
    function mlRow_(dateCell, tag) { return [dateCell, tag, 'L-' + tag]; }
    const upFrontNow = new Date();
    const realSsUp = SpreadsheetApp;
    const realDriveUp = DriveApp;
    const realReadLeadsTabUp = readLeadsTab_;
    const realPruneMovementLogUp = pruneMovementLog_;
    try {
      // (a) Runs before the scan: the scan is made to throw, and the stale
      // Movement_Log row must be gone anyway.
      const upSs = TestMockSpreadsheet_({});
      upSs._sheets['leads'] = TestMockSheet_('leads', [banner, header, flaggedRow]);
      const upMl = TestMockSheet_('Movement_Log', [mlHeader, mlRow_(TestFixture_daysAgo_(upFrontNow, 10), 'ml-old'), mlRow_(TestFixture_daysAgo_(upFrontNow, 1), 'ml-recent')]);
      upMl._maxRows = 20000;
      upSs._sheets['Movement_Log'] = upMl;
      SpreadsheetApp = { getActiveSpreadsheet: function () { return upSs; }, flush: function () {} };
      DriveApp = TestMockDriveApp_();
      readLeadsTab_ = function () { throw new Error('simulated scan failure'); };
      TestAssertThrows_(function () { captureDailyRmIssues_(); }, 'captureDailyRmIssues_: the simulated scan failure still propagates (this fixture really does crash after the up-front prune)');
      const upTags = upMl.getRange(2, 1, upMl.getLastRow() - 1, mlHeader.length).getValues().map(function (r) { return r[1]; });
      TestAssertEqual_(upTags.indexOf('ml-old'), -1, 'captureDailyRmIssues_: Movement_Log\'s stale row is pruned BEFORE the company scan, so it is gone even though the scan then crashed');
      TestAssert_(upTags.indexOf('ml-recent') >= 0, 'captureDailyRmIssues_: the up-front Movement_Log prune keeps rows still inside the retention window');
      TestAssert_(upMl.getMaxRows() < 20000, 'captureDailyRmIssues_: the up-front prune also shrinks Movement_Log\'s row allocation, freeing workbook cells before the scan');
      readLeadsTab_ = realReadLeadsTabUp;

      // (b) A double-fire (Daily_RM_Issues already has today's rows) bails at
      // the idempotency guard BEFORE paying for the Movement_Log prune.
      const gdSs = TestMockSpreadsheet_({});
      gdSs._sheets['leads'] = TestMockSheet_('leads', [banner, header, flaggedRow]);
      gdSs._sheets[DAILY_RM_ISSUE_LOG_SHEET_] = TestMockSheet_(DAILY_RM_ISSUE_LOG_SHEET_, [prLogHeader, prRow_(istDayKeyGs_(upFrontNow), 'already-today')]);
      const gdMl = TestMockSheet_('Movement_Log', [mlHeader, mlRow_(TestFixture_daysAgo_(upFrontNow, 10), 'ml-old-guard')]);
      gdMl._maxRows = 20000;
      gdSs._sheets['Movement_Log'] = gdMl;
      SpreadsheetApp = { getActiveSpreadsheet: function () { return gdSs; }, flush: function () {} };
      captureDailyRmIssues_();
      TestAssertEqual_(gdMl.getLastRow(), 2, 'captureDailyRmIssues_: an idempotency-guard early return does NOT run the Movement_Log prune (a double-fire stays cheap)');
      TestAssertEqual_(gdMl.getMaxRows(), 20000, 'captureDailyRmIssues_: an idempotency-guard early return leaves Movement_Log\'s grid untouched');

      // (c) A failing up-front prune must not block tonight's capture.
      const pfSs = TestMockSpreadsheet_({});
      pfSs._sheets['leads'] = TestMockSheet_('leads', [banner, header, flaggedRow]);
      SpreadsheetApp = { getActiveSpreadsheet: function () { return pfSs; }, flush: function () {} };
      pruneMovementLog_ = function () { throw new Error('simulated Drive archive failure'); };
      captureDailyRmIssues_();
      const pfLog = pfSs.getSheetByName(DAILY_RM_ISSUE_LOG_SHEET_);
      const pfTags = pfLog.getRange(2, 1, pfLog.getLastRow() - 1, prLogHeader.length).getValues().map(function (r) { return r[1]; });
      TestAssert_(pfTags.indexOf('Test RM One') >= 0, 'captureDailyRmIssues_: a throwing up-front Movement_Log prune does not stop tonight\'s capture from being written');
    } finally {
      SpreadsheetApp = realSsUp;
      DriveApp = realDriveUp;
      readLeadsTab_ = realReadLeadsTabUp;
      pruneMovementLog_ = realPruneMovementLogUp;
    }

    // ---- Date integrity (email audit P18, 2026-10-08). From 2026-10-02 the nightly prune archived ~600 KB of rows whose date,
    // captured_at and lead_assigned_at cells read back blank, filed as "unknown-dates", because a blank date compared as "older than
    // the window". The fix: (1) the date columns are read back after every write and re-written if blank, (2) the prune never drops a
    // row for lack of a date - it gives the row one first, (3) what happened is recorded, not emailed. ----
    const diKey = dailyRmIssueDateKeyGs_;
    TestAssertEqual_(diKey(new Date('2026-10-04T18:30:00.000Z')), '2026-10-05', 'dailyRmIssueDateKeyGs_: a Date stored as midnight IST (18:30 UTC the day before) reads as its IST day');
    TestAssertEqual_(diKey('2026-10-04'), '2026-10-04', 'dailyRmIssueDateKeyGs_: a yyyy-MM-dd string reads as itself');
    TestAssertEqual_(diKey('2026-10-04 22:53:11'), '2026-10-04', 'dailyRmIssueDateKeyGs_: a captured_at string reads as its day');
    TestAssertEqual_(diKey(''), '', 'dailyRmIssueDateKeyGs_: blank reads as unreadable');
    TestAssertEqual_(diKey(null), '', 'dailyRmIssueDateKeyGs_: null reads as unreadable');
    TestAssertEqual_(diKey(new Date('nonsense')), '', 'dailyRmIssueDateKeyGs_: an invalid Date reads as unreadable');
    TestAssertEqual_(diKey('not a date'), '', 'dailyRmIssueDateKeyGs_: free text reads as unreadable');

    function diRow_(dateCell, tag, capCell) {
      return prLogHeader.map(function (col) {
        if (col === 'date') return dateCell;
        if (col === 'RM') return tag;
        if (col === 'lead_id') return 'L-' + tag;
        if (col === 'captured_at') return capCell === undefined ? '' : capCell;
        return '';
      });
    }
    const diValues = [
      diRow_('2026-10-03', 'a'),
      diRow_('', 'b'),
      diRow_('', 'c'),
      diRow_('2026-10-05', 'd'),
      diRow_('', 'e', '2026-10-04 22:53:11'),
      diRow_('2026-10-06', 'f'),
      diRow_('', 'g'),
    ];
    const diRepair = repairDailyRmIssueDatesGs_(diValues, '2026-10-08');
    TestAssertEqual_(diRepair.blank, 4, 'repairDailyRmIssueDatesGs_: counts the 4 undated rows');
    TestAssertEqual_(diRepair.fromCapturedAt, 1, 'repairDailyRmIssueDatesGs_: a row with a readable captured_at takes its date from there');
    TestAssertEqual_(diRepair.fromNeighbour, 3, 'repairDailyRmIssueDatesGs_: the other undated rows take a neighbour\'s date');
    TestAssertEqual_(diRepair.fromToday, 0, 'repairDailyRmIssueDatesGs_: nothing fell back to today when neighbours exist');
    TestAssertEqual_(diValues[4][0], '2026-10-04', 'repairDailyRmIssueDatesGs_: captured_at 22:53 on 4 Oct dates the row 2026-10-04');
    TestAssertEqual_(diValues[1][0] + ' ' + diValues[2][0], '2026-10-05 2026-10-05', 'repairDailyRmIssueDatesGs_: a block of undated rows takes the date of the row that FOLLOWS it (a later date only keeps a row longer)');
    TestAssertEqual_(diValues[6][0], '2026-10-06', 'repairDailyRmIssueDatesGs_: undated rows after the last dated row take the preceding row\'s date');
    TestAssertEqual_(diValues[0][0] + ' ' + diValues[3][0] + ' ' + diValues[5][0], '2026-10-03 2026-10-05 2026-10-06', 'repairDailyRmIssueDatesGs_: rows that already had a date are untouched');
    TestAssertEqual_(JSON.stringify(diRepair.blocks), JSON.stringify([{ row: 3, len: 2 }, { row: 6, len: 1 }, { row: 8, len: 1 }]), 'repairDailyRmIssueDatesGs_: reports where the undated runs were (sheet rows)');
    TestAssertEqual_(diRepair.sampleLeadIds.join(','), 'L-b,L-c,L-e', 'repairDailyRmIssueDatesGs_: reports up to 3 sample lead ids');
    const diAllBlank = [diRow_('', 'x'), diRow_('', 'y')];
    const diAllRepair = repairDailyRmIssueDatesGs_(diAllBlank, '2026-10-08');
    TestAssertEqual_(diAllRepair.fromToday + ':' + diAllBlank[0][0] + ':' + diAllBlank[1][0], '2:2026-10-08:2026-10-08', 'repairDailyRmIssueDatesGs_: with no date anywhere, rows are dated today (they age out in a week) instead of being dropped');
    const diNone = [diRow_('2026-10-05', 'p'), diRow_(new Date('2026-10-05T18:30:00.000Z'), 'q')];
    TestAssertEqual_(repairDailyRmIssueDatesGs_(diNone, '2026-10-08').blank, 0, 'repairDailyRmIssueDatesGs_: nothing to repair when every row has a readable date (string or Date)');

    // A sheet that blanks chosen columns when a range is written - the failure being guarded against. mode 'once': the first write of
    // those columns reads back blank, later writes stick; mode 'until-text': writes read back blank unless the range was first
    // formatted as plain text.
    function diBlankingSheet_(seedRows, blankCols, mode) {
      const s = TestMockSheet_(DAILY_RM_ISSUE_LOG_SHEET_, seedRows);
      const realGetRange = s.getRange;
      s._blankedWrites = 0;
      s.getRange = function (r, c, nr, nc) {
        const rng = realGetRange(r, c, nr, nc);
        const realSet = rng.setValues;
        const realFmt = rng.setNumberFormat;
        let textFormat = false;
        rng.setNumberFormat = function (f) { if (f === '@') textFormat = true; return realFmt.call(rng, f); };
        rng.setValues = function (vals) {
          let touched = false;
          const out = vals.map(function (row) {
            return row.map(function (v, j) {
              if (blankCols.indexOf(c - 1 + j) === -1) return v;
              if (mode === 'once' && s._blankedWrites >= 1) return v;
              if (mode === 'until-text' && textFormat) return v;
              touched = true;
              return '';
            });
          });
          if (touched) s._blankedWrites++;
          return realSet.call(rng, out);
        };
        return rng;
      };
      return s;
    }
    const diProps = function () { return JSON.parse(PropertiesService.getScriptProperties().getProperty(DAILY_RM_ISSUE_DIAG_PROPERTY_) || '[]'); };

    const realSsDi = SpreadsheetApp;
    const realDriveDi = DriveApp;
    try {
      // (a) prune: undated rows are repaired and KEPT - never archived as "unknown-dates"; an undated row whose captured_at is old is
      // dated by it and dropped like any other old row.
      const diDrive = TestMockDriveApp_();
      DriveApp = diDrive;
      const diOldStamp = Utilities.formatDate(TestFixture_daysAgo_(realNowForPrune, 40), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss');
      const diSs = TestMockSpreadsheet_({});
      const diSheet = TestMockSheet_(DAILY_RM_ISSUE_LOG_SHEET_, [
        prLogHeader,
        diRow_(istDayKeyGs_(TestFixture_daysAgo_(realNowForPrune, 40)), 'old-dated'),
        diRow_('', 'blank-old-captured-at', diOldStamp),
        diRow_('', 'blank-between'),
        diRow_(prRecentStringCell, 'recent-dated'),
        diRow_('', 'blank-trailing'),
      ]);
      diSs._sheets[DAILY_RM_ISSUE_LOG_SHEET_] = diSheet;
      pruneDailyRmIssueLog_(diSs);
      const diKept = diSheet.getRange(2, 1, diSheet.getLastRow() - 1, prLogHeader.length).getValues();
      TestAssertEqual_(diKept.map(function (r) { return r[1]; }).join(','), 'blank-between,recent-dated,blank-trailing', 'pruneDailyRmIssueLog_: undated rows are kept (not dropped as "old"), only the two genuinely old rows go');
      TestAssert_(diKept.every(function (r) { return !!diKey(r[0]); }), 'pruneDailyRmIssueLog_: every kept row has a readable date afterwards - the repair is written back to the sheet');
      const diFolder = diDrive._folders[ARCHIVE_ROOT_FOLDER_]._folders['Daily_RM_Issues'];
      TestAssertEqual_(diFolder._filesList.length, 1, 'pruneDailyRmIssueLog_: one archive file for the run');
      TestAssert_(diFolder._filesList[0]._name.indexOf('unknown-dates') === -1, 'pruneDailyRmIssueLog_: the archive is filed under a real date range, never "unknown-dates"');
      TestAssert_(diFolder._filesList[0]._content.indexOf('old-dated') >= 0 && diFolder._filesList[0]._content.indexOf('blank-old-captured-at') >= 0 && diFolder._filesList[0]._content.indexOf('blank-between') === -1, 'pruneDailyRmIssueLog_: the archive holds the two old rows and none of the kept undated ones');
      TestAssert_(diDrive._folders[ARCHIVE_ROOT_FOLDER_]._files[ARCHIVE_MANIFEST_FILE_]._content.indexOf(diFolder._filesList[0]._name) >= 0, 'pruneDailyRmIssueLog_: the archive_log.csv row is written once the rows are gone');
      const diRec = diProps().filter(function (r) { return r.phase === 'prune'; });
      TestAssert_(diRec.length === 1 && diRec[0].phase === 'prune' && diRec[0].blank === 3 && diRec[0].fromCapturedAt === 1, 'pruneDailyRmIssueLog_: what it found is recorded in DAILY_RM_ISSUE_DIAG (3 undated rows, 1 dated from captured_at)');
      TestAssertEqual_(TestGmailLog_.sent.length, 0, 'pruneDailyRmIssueLog_: nothing is emailed for undated rows - they are repaired');

      // (b) nothing old enough to drop, but an undated row: it is dated in the sheet and no archive is written.
      PropertiesService.getScriptProperties().deleteProperty(DAILY_RM_ISSUE_DIAG_PROPERTY_);
      const diDrive2 = TestMockDriveApp_();
      DriveApp = diDrive2;
      const diSheet2 = TestMockSheet_(DAILY_RM_ISSUE_LOG_SHEET_, [prLogHeader, diRow_(prRecentStringCell, 'r1'), diRow_('', 'blank-only'), diRow_(prRecentStringCell, 'r2')]);
      const diSs2 = TestMockSpreadsheet_({});
      diSs2._sheets[DAILY_RM_ISSUE_LOG_SHEET_] = diSheet2;
      pruneDailyRmIssueLog_(diSs2);
      TestAssertEqual_(diKey(diSheet2.getRange(3, 1, 1, 1).getValues()[0][0]), prRecentStringCell, 'pruneDailyRmIssueLog_: with nothing to drop, an undated row is still given a date in the sheet');
      TestAssert_(!diDrive2._folders[ARCHIVE_ROOT_FOLDER_], 'pruneDailyRmIssueLog_: no archive is written when nothing is dropped');

      // (c) prune rewrite: if the kept rows' date cells come back blank after the rewrite, they are re-written.
      const diDrive3 = TestMockDriveApp_();
      DriveApp = diDrive3;
      const diSheet3 = diBlankingSheet_([prLogHeader, diRow_(istDayKeyGs_(TestFixture_daysAgo_(realNowForPrune, 40)), 'gone'), diRow_(prRecentStringCell, 'k1'), diRow_(prRecentStringCell, 'k2')], [0], 'once');
      const diSs3 = TestMockSpreadsheet_({});
      diSs3._sheets[DAILY_RM_ISSUE_LOG_SHEET_] = diSheet3;
      pruneDailyRmIssueLog_(diSs3);
      TestAssertEqual_(diSheet3._blankedWrites, 1, 'fixture check: the rewrite of the kept rows did lose their dates once');
      TestAssert_(diSheet3.getRange(2, 1, 2, 1).getValues().every(function (r) { return diKey(r[0]) === prRecentStringCell; }), 'pruneDailyRmIssueLog_: dates that read back blank after the rewrite are written again');

      // (d) capture: dates blanked by the write are restored, and the repair is recorded.
      const diNowBefore = istDayKeyGs_(new Date());
      PropertiesService.getScriptProperties().deleteProperty(DAILY_RM_ISSUE_DIAG_PROPERTY_);
      const diCapSs = TestMockSpreadsheet_({});
      diCapSs._sheets['leads'] = TestMockSheet_('leads', [banner, header, flaggedRow]);
      const diCapSheet = diBlankingSheet_([prLogHeader], [0, 8], 'once');
      diCapSs._sheets[DAILY_RM_ISSUE_LOG_SHEET_] = diCapSheet;
      SpreadsheetApp = { getActiveSpreadsheet: function () { return diCapSs; }, flush: function () {} };
      DriveApp = TestMockDriveApp_();
      captureDailyRmIssues_();
      const diCapRows = diCapSheet.getRange(2, 1, diCapSheet.getLastRow() - 1, prLogHeader.length).getValues();
      TestAssert_(diCapRows.length >= 1, 'fixture check: the capture wrote the flagged lead');
      const diNowAfter = istDayKeyGs_(new Date());
      TestAssert_(diCapRows.every(function (r) { const k = diKey(r[0]); return k === diNowBefore || k === diNowAfter; }), 'captureDailyRmIssues_: the date column holds tonight\'s date even though the write blanked it');
      TestAssert_(diCapRows.every(function (r) { return !!diKey(r[8]); }), 'captureDailyRmIssues_: captured_at is restored too');
      const diCapRec = diProps();
      TestAssert_(diCapRec.length === 1 && diCapRec[0].phase === 'capture-write' && diCapRec[0].blankFound >= 2 && diCapRec[0].rewrittenCols.indexOf(0) >= 0, 'captureDailyRmIssues_: the blank write-back is recorded in DAILY_RM_ISSUE_DIAG');
      TestAssertEqual_(TestGmailLog_.sent.length, 0, 'captureDailyRmIssues_: nothing is emailed about it');

      // (e) capture: a column that stays blank after a plain re-write is stored as text instead.
      PropertiesService.getScriptProperties().deleteProperty(DAILY_RM_ISSUE_DIAG_PROPERTY_);
      const diTxtSs = TestMockSpreadsheet_({});
      diTxtSs._sheets['leads'] = TestMockSheet_('leads', [banner, header, flaggedRow]);
      const diTxtSheet = diBlankingSheet_([prLogHeader], [0], 'until-text');
      diTxtSs._sheets[DAILY_RM_ISSUE_LOG_SHEET_] = diTxtSheet;
      SpreadsheetApp = { getActiveSpreadsheet: function () { return diTxtSs; }, flush: function () {} };
      DriveApp = TestMockDriveApp_();
      captureDailyRmIssues_();
      const diTxtRows = diTxtSheet.getRange(2, 1, diTxtSheet.getLastRow() - 1, prLogHeader.length).getValues();
      TestAssert_(diTxtRows.length >= 1 && diTxtRows.every(function (r) { return !!diKey(r[0]); }), 'captureDailyRmIssues_: when a plain re-write still reads back blank, the date is stored as text and sticks');
      const diTxtRec = diProps();
      TestAssert_(diTxtRec.length === 1 && diTxtRec[0].escalatedCols.indexOf(0) >= 0, 'captureDailyRmIssues_: the text fallback is recorded');

      // (f) a clean write records nothing.
      PropertiesService.getScriptProperties().deleteProperty(DAILY_RM_ISSUE_DIAG_PROPERTY_);
      const diOkSs = TestMockSpreadsheet_({});
      diOkSs._sheets['leads'] = TestMockSheet_('leads', [banner, header, flaggedRow]);
      SpreadsheetApp = { getActiveSpreadsheet: function () { return diOkSs; }, flush: function () {} };
      DriveApp = TestMockDriveApp_();
      captureDailyRmIssues_();
      TestAssertEqual_(diProps().length, 0, 'captureDailyRmIssues_: a clean write leaves no date-integrity record');

      // (g) the sheet write fails after a good archive: the retry reuses the archive and the ledger lists it once
      const rtDrive = TestMockDriveApp_();
      DriveApp = rtDrive;
      const rtSheet = TestMockSheet_(DAILY_RM_ISSUE_LOG_SHEET_, [prLogHeader, diRow_(istDayKeyGs_(TestFixture_daysAgo_(realNowForPrune, 40)), 'old-one'), diRow_(prRecentStringCell, 'recent-one')]);
      const rtRealGetRange = rtSheet.getRange;
      let rtFailNext = true;
      rtSheet.getRange = function (r, c, nr, nc) {
        const rng = rtRealGetRange(r, c, nr, nc);
        const realSet = rng.setValues;
        rng.setValues = function (v) {
          if (rtFailNext) { rtFailNext = false; throw new Error('simulated sheet write failure'); }
          return realSet.call(rng, v);
        };
        return rng;
      };
      const rtSs = TestMockSpreadsheet_({});
      rtSs._sheets[DAILY_RM_ISSUE_LOG_SHEET_] = rtSheet;
      let rtThrew = '';
      try { pruneDailyRmIssueLog_(rtSs); } catch (e) { rtThrew = String(e && e.message || e); }
      TestAssertContains_(rtThrew, 'simulated sheet write failure', 'pruneDailyRmIssueLog_ (failed write): the prune fails');
      const rtFolder = rtDrive._folders[ARCHIVE_ROOT_FOLDER_]._folders['Daily_RM_Issues'];
      TestAssertEqual_(rtFolder._filesList.length, 1, 'pruneDailyRmIssueLog_ (failed write): the good archive is kept');
      TestAssert_(!rtDrive._folders[ARCHIVE_ROOT_FOLDER_]._files[ARCHIVE_MANIFEST_FILE_], 'pruneDailyRmIssueLog_ (failed write): no ledger row while the rows are still in the sheet');
      pruneDailyRmIssueLog_(rtSs);
      TestAssertEqual_(rtSheet.getLastRow(), 2, 'pruneDailyRmIssueLog_ (failed write): the retry prunes the sheet');
      TestAssertEqual_(rtFolder._filesList.length, 1, 'pruneDailyRmIssueLog_ (failed write): the retry REUSES the archive - one file in Drive, not a second copy');
      TestAssertEqual_(rtDrive._folders[ARCHIVE_ROOT_FOLDER_]._files[ARCHIVE_MANIFEST_FILE_]._content.split('\n').length, 2, 'pruneDailyRmIssueLog_ (failed write): archive_log.csv lists it once');

      // (h) an archive that cannot be proved stops the prune, nothing is deleted and the file is trashed
      const udRbDrive = TestMockDriveApp_();
      DriveApp = udRbDrive;
      const udRbRoot = udRbDrive.createFolder(ARCHIVE_ROOT_FOLDER_);
      const udRbFolder = udRbRoot.createFolder('Daily_RM_Issues');
      const udRbReal = udRbFolder.createFile;
      udRbFolder.createFile = function (n, content, mime) { return udRbReal.call(udRbFolder, n, content.split('\n').slice(0, -1).join('\n'), mime); };
      const udRbSheet = TestMockSheet_(DAILY_RM_ISSUE_LOG_SHEET_, [prLogHeader, diRow_(istDayKeyGs_(TestFixture_daysAgo_(realNowForPrune, 40)), 'old-one'), diRow_(prRecentStringCell, 'recent-one')]);
      const udRbSs = TestMockSpreadsheet_({});
      udRbSs._sheets[DAILY_RM_ISSUE_LOG_SHEET_] = udRbSheet;
      let udRbThrew = '';
      try { pruneDailyRmIssueLog_(udRbSs); } catch (e) { udRbThrew = String(e && e.message || e); }
      TestAssertContains_(udRbThrew, 'refusing to prune Daily_RM_Issues', 'pruneDailyRmIssueLog_ (unprovable archive): the prune refuses - it used to delete without proving anything');
      TestAssertEqual_(udRbSheet.getLastRow(), 3, 'pruneDailyRmIssueLog_ (unprovable archive): both rows are still in the sheet');
      TestAssert_(udRbFolder._filesList.length === 1 && udRbFolder._filesList[0].isTrashed(), 'pruneDailyRmIssueLog_ (unprovable archive): the unproven archive is trashed');

      // ---- lead_assigned_at refill (email audit P18, 2026-10-08) ----
      TestAssertEqual_(dailyRmIssueBlankCellGs_(''), true, 'dailyRmIssueBlankCellGs_: an empty string is blank');
      TestAssertEqual_(dailyRmIssueBlankCellGs_(new Date('nonsense')), true, 'dailyRmIssueBlankCellGs_: an invalid Date is blank');
      TestAssertEqual_(dailyRmIssueBlankCellGs_(new Date('2026-10-03T08:03:06Z')), false, 'dailyRmIssueBlankCellGs_: a real Date is not blank');
      const asIdx = DAILY_RM_ISSUE_ASSIGNED_COL_;
      TestAssertEqual_(DAILY_RM_ISSUE_LOG_COLUMNS_[asIdx], 'lead_assigned_at', 'DAILY_RM_ISSUE_ASSIGNED_COL_ points at the lead_assigned_at column');
      function raRow_(dateKey, leadId, assigned) {
        const r = prLogHeader.map(function () { return ''; });
        r[0] = dateKey;
        r[1] = 'RM-' + leadId;
        r[prLogHeader.indexOf('lead_id')] = leadId;
        r[asIdx] = assigned === undefined ? '' : assigned;
        return r;
      }
      // (R1) precedence and bookkeeping of the pure refill
      const raLookups = {
        movementByDay: { 'L1|2026-10-06': 'DAY-L1' },
        leads: { L1: 'LEADS-L1', L2: 'LEADS-L2' },
        movementLatest: { L1: 'LATEST-L1', L2: 'LATEST-L2', L3: 'LATEST-L3' },
      };
      const raValues = [
        raRow_('2026-10-06', 'L1'),             // that day's Movement_Log snapshot wins
        raRow_('2026-10-07', 'L1'),             // no snapshot for that day -> the Leads tab
        raRow_('2026-10-07', 'L3'),             // only a Movement_Log snapshot -> the latest one
        raRow_('2026-10-07', 'L4'),             // no source anywhere
        raRow_('2026-10-07', 'L2', 'ALREADY'),  // already has a value - never touched
        raRow_('2026-10-07', ''),               // no lead id - skipped, not counted
        ['2026-10-07', 'short'],                // too short to hold the column - skipped
      ];
      const raOut = refillDailyRmIssueAssignedAtGs_(raValues, raLookups);
      TestAssertEqual_(raValues[0][asIdx] + '|' + raValues[1][asIdx] + '|' + raValues[2][asIdx], 'DAY-L1|LEADS-L1|LATEST-L3', 'refillDailyRmIssueAssignedAtGs_: that day\'s snapshot, then the Leads tab, then the latest snapshot');
      TestAssertEqual_(raValues[3][asIdx], '', 'refillDailyRmIssueAssignedAtGs_: a lead with no source stays blank');
      TestAssertEqual_(raValues[4][asIdx], 'ALREADY', 'refillDailyRmIssueAssignedAtGs_: a cell that already has a value is never overwritten');
      TestAssertEqual_(raOut.blank + ':' + raOut.filled + ':' + raOut.fromMovementDay + ':' + raOut.fromLeads + ':' + raOut.fromMovementLatest + ':' + raOut.noSource, '4:3:1:1:1:1', 'refillDailyRmIssueAssignedAtGs_: counts blank / filled / per source / no source');
      TestAssertEqual_(raOut.indexes.join(','), '0,1,2', 'refillDailyRmIssueAssignedAtGs_: reports which rows it filled');
      TestAssertEqual_(dailyRmIssueNeedsAssignedAtGs_([raRow_('2026-10-07', 'L2', 'x'), raRow_('2026-10-07', '')]), false, 'dailyRmIssueNeedsAssignedAtGs_: false when every row with a lead id has a value');
      TestAssertEqual_(dailyRmIssueNeedsAssignedAtGs_([raRow_('2026-10-07', 'L2')]), true, 'dailyRmIssueNeedsAssignedAtGs_: true when one row with a lead id has none');

      // (R2) the sources: the Leads tab and Movement_Log
      const raDate1 = new Date('2026-10-03T08:03:06Z');
      const raDate2 = new Date('2026-10-04T09:00:00Z');
      const raDate3 = new Date('2026-10-05T10:00:00Z');
      const raSs = TestMockSpreadsheet_({});
      raSs._sheets['leads'] = TestMockSheet_('leads', [banner, header,
        TestDRIL_row_({ lead_id: 'L-A', lead_assigned_at: raDate3 }),
        TestDRIL_row_({ lead_id: 'L-B', lead_assigned_at: '' }),
      ]);
      const mlStamp = function (iso) { return new Date(iso); };
      raSs._sheets[MOVEMENT_LOG_SHEET] = TestMockSheet_(MOVEMENT_LOG_SHEET, [
        ['snapshot_at', 'snapshot_label', 'lead_id', 'lead_assigned_at'],
        [mlStamp('2026-10-06T07:00:00Z'), 'a', 'L-A', raDate1],  // 6 Oct 12:30 IST
        [mlStamp('2026-10-06T13:00:00Z'), 'b', 'L-A', raDate2],  // 6 Oct 18:30 IST - the LATER snapshot of that day
        [mlStamp('2026-10-07T07:00:00Z'), 'c', 'L-A', raDate3],  // 7 Oct
        [mlStamp('2026-10-06T07:00:00Z'), 'a', 'L-C', ''],       // blank - ignored
        [mlStamp('2026-10-06T07:00:00Z'), 'a', 'L-D', raDate1],
      ]);
      const raLk = buildAssignedAtLookupsGs_(raSs, null);
      TestAssertEqual_(String(raLk.leads['L-A'] && raLk.leads['L-A'].getTime()) + ':' + ('L-B' in raLk.leads), raDate3.getTime() + ':false', 'buildAssignedAtLookupsGs_: the Leads tab gives each lead its current value and skips a blank one');
      TestAssertEqual_(raLk.movementByDay['L-A|2026-10-06'].getTime(), raDate2.getTime(), 'buildAssignedAtLookupsGs_: for a day, the LATEST snapshot of that day wins');
      TestAssertEqual_(raLk.movementLatest['L-A'].getTime(), raDate3.getTime(), 'buildAssignedAtLookupsGs_: the latest snapshot overall');
      TestAssertEqual_(('L-C|2026-10-06' in raLk.movementByDay) + ':' + ('L-C' in raLk.movementLatest) + ':' + ('L-D' in raLk.movementLatest), 'false:false:true', 'buildAssignedAtLookupsGs_: a blank Movement_Log value is ignored');
      TestAssert_(raLk.leadsOk && raLk.movementOk, 'buildAssignedAtLookupsGs_: reports both sources readable');
      const raNoSs = TestMockSpreadsheet_({});
      const raNoLk = buildAssignedAtLookupsGs_(raNoSs, null);
      TestAssert_(!raNoLk.leadsOk && !raNoLk.movementOk && Object.keys(raNoLk.leads).length === 0, 'buildAssignedAtLookupsGs_: with neither tab it returns empty lookups instead of throwing');

      // (R3) after every prune: rows that remain are filled, in the sheet, using the capture's own Leads read (no second read)
      PropertiesService.getScriptProperties().deleteProperty(DAILY_RM_ISSUE_DIAG_PROPERTY_);
      const raDrive = TestMockDriveApp_();
      DriveApp = raDrive;
      const raOldKey = istDayKeyGs_(TestFixture_daysAgo_(realNowForPrune, 40));
      const raRecentKey = istDayKeyGs_(TestFixture_daysAgo_(realNowForPrune, 2));
      const raSheet = TestMockSheet_(DAILY_RM_ISSUE_LOG_SHEET_, [prLogHeader,
        raRow_(raOldKey, 'L-A'),
        raRow_(raRecentKey, 'L-A'),
        raRow_(raRecentKey, 'L-B'),
        raRow_(raRecentKey, 'L-A', 'KEEP-ME'),
      ]);
      const raPruneSs = TestMockSpreadsheet_({});
      raPruneSs._sheets[DAILY_RM_ISSUE_LOG_SHEET_] = raSheet;
      raPruneSs._sheets[MOVEMENT_LOG_SHEET] = TestMockSheet_(MOVEMENT_LOG_SHEET, [
        ['snapshot_at', 'snapshot_label', 'lead_id', 'lead_assigned_at'],
        [TestFixture_daysAgo_(realNowForPrune, 2), 'x', 'L-B', raDate2],
      ]);
      const raLeadsRead = { colIndex: buildColIndex_(header), dataRows: [TestDRIL_row_({ lead_id: 'L-A', lead_assigned_at: raDate3 })] };
      const realReadLeadsTabRa = readLeadsTab_;
      let raReadCalls = 0;
      readLeadsTab_ = function () { raReadCalls++; throw new Error('the prune must use the capture\'s own Leads read'); };
      try {
        pruneDailyRmIssueLog_(raPruneSs, 0, raLeadsRead);
      } finally {
        readLeadsTab_ = realReadLeadsTabRa;
      }
      TestAssertEqual_(raReadCalls, 0, 'pruneDailyRmIssueLog_: uses the Leads read the caller passes - the Leads tab is not read a second time');
      const raAfter = raSheet.getRange(2, 1, raSheet.getLastRow() - 1, prLogHeader.length).getValues();
      TestAssertEqual_(raAfter.length, 3, 'pruneDailyRmIssueLog_: the old row is dropped, the three recent ones stay');
      TestAssertEqual_(raAfter[0][asIdx].getTime(), raDate3.getTime(), 'pruneDailyRmIssueLog_: a remaining row with no lead_assigned_at is filled from the Leads tab');
      TestAssertEqual_(raAfter[1][asIdx].getTime(), raDate2.getTime(), 'pruneDailyRmIssueLog_: …a lead that is not in the Leads tab any more is filled from Movement_Log');
      TestAssertEqual_(raAfter[2][asIdx], 'KEEP-ME', 'pruneDailyRmIssueLog_: a value already there is left alone');
      const raDiag = diProps().filter(function (r) { return r.phase === 'prune-refill'; });
      TestAssert_(raDiag.length === 1 && raDiag[0].blank === 3 && raDiag[0].filled === 3 && raDiag[0].fromLeads === 2 && raDiag[0].fromMovementDay === 1, 'pruneDailyRmIssueLog_: the refill is recorded in DAILY_RM_ISSUE_DIAG (3 blank incl. the row about to be archived, 3 filled: 2 from the Leads tab, 1 from the same-day Movement_Log snapshot)');
      TestAssertEqual_(TestGmailLog_.sent.length, 0, 'pruneDailyRmIssueLog_: nothing is emailed about the refill');

      // (R4) nothing to drop: the refill is still written to the sheet
      DriveApp = TestMockDriveApp_();
      const raKeepSheet = TestMockSheet_(DAILY_RM_ISSUE_LOG_SHEET_, [prLogHeader, raRow_(raRecentKey, 'L-A'), raRow_(raRecentKey, 'L-A', 'KEEP-ME')]);
      const raKeepSs = TestMockSpreadsheet_({});
      raKeepSs._sheets[DAILY_RM_ISSUE_LOG_SHEET_] = raKeepSheet;
      pruneDailyRmIssueLog_(raKeepSs, 0, raLeadsRead);
      TestAssertEqual_(raKeepSheet.getRange(2, asIdx + 1, 1, 1).getValues()[0][0].getTime(), raDate3.getTime(), 'pruneDailyRmIssueLog_: with nothing to drop, a missing lead_assigned_at is still filled in the sheet');

      // (R5) a source that cannot be read never stops the prune
      DriveApp = TestMockDriveApp_();
      const raFailSheet = TestMockSheet_(DAILY_RM_ISSUE_LOG_SHEET_, [prLogHeader, raRow_(raOldKey, 'L-A'), raRow_(raRecentKey, 'L-A')]);
      const raFailSs = TestMockSpreadsheet_({});
      raFailSs._sheets[DAILY_RM_ISSUE_LOG_SHEET_] = raFailSheet;
      let raFailThrew = '';
      try { pruneDailyRmIssueLog_(raFailSs); } catch (e) { raFailThrew = String(e && e.message || e); }
      TestAssertEqual_(raFailThrew, '', 'pruneDailyRmIssueLog_: with neither the Leads tab nor Movement_Log readable the prune still completes');
      TestAssertEqual_(raFailSheet.getLastRow(), 2, 'pruneDailyRmIssueLog_: …and still drops the old row');

      // (R6) the filled cells are re-asserted: a rewrite that blanks the column once is repaired
      DriveApp = TestMockDriveApp_();
      const raBlankSheet = diBlankingSheet_([prLogHeader, raRow_(raOldKey, 'L-A'), raRow_(raRecentKey, 'L-A')], [asIdx], 'once');
      const raBlankSs = TestMockSpreadsheet_({});
      raBlankSs._sheets[DAILY_RM_ISSUE_LOG_SHEET_] = raBlankSheet;
      pruneDailyRmIssueLog_(raBlankSs, 0, raLeadsRead);
      TestAssertEqual_(raBlankSheet._blankedWrites, 1, 'fixture check: the rewrite did blank lead_assigned_at once');
      TestAssertEqual_(raBlankSheet.getRange(2, asIdx + 1, 1, 1).getValues()[0][0].getTime(), raDate3.getTime(), 'pruneDailyRmIssueLog_: a lead_assigned_at that reads back blank after the rewrite is written again');

      // (R7) the console function fills everything now, and a second run has nothing left to do
      const raNowSs = TestMockSpreadsheet_({});
      raNowSs._sheets['leads'] = TestMockSheet_('leads', [banner, header, TestDRIL_row_({ lead_id: 'L-A', lead_assigned_at: raDate3 })]);
      const raNowSheet = TestMockSheet_(DAILY_RM_ISSUE_LOG_SHEET_, [prLogHeader, raRow_(raRecentKey, 'L-A'), raRow_(raRecentKey, 'L-A'), raRow_(raRecentKey, 'L-NOSRC')]);
      raNowSs._sheets[DAILY_RM_ISSUE_LOG_SHEET_] = raNowSheet;
      SpreadsheetApp = { getActiveSpreadsheet: function () { return raNowSs; }, flush: function () {} };
      const raNowOut = refillDailyRmIssueAssignedAtNow();
      TestAssertEqual_(raNowOut.blank + ':' + raNowOut.filled + ':' + raNowOut.noSource, '3:2:1', 'refillDailyRmIssueAssignedAtNow: fills what has a source and reports what has none');
      TestAssertEqual_(raNowSheet.getRange(2, asIdx + 1, 2, 1).getValues().map(function (r) { return r[0].getTime(); }).join(','), raDate3.getTime() + ',' + raDate3.getTime(), 'refillDailyRmIssueAssignedAtNow: the cells are written to the sheet');
      TestAssertEqual_(raNowSheet.getRange(4, asIdx + 1, 1, 1).getValues()[0][0], '', 'refillDailyRmIssueAssignedAtNow: a lead with no source stays blank');

      // (R8) the nightly capture hands the prune its own Leads read: the Leads tab is read ONCE per night, and an older row is refilled from it
      const raCapSs = TestMockSpreadsheet_({});
      raCapSs._sheets['leads'] = TestMockSheet_('leads', [banner, header, flaggedRow]);
      const raCapSheet = TestMockSheet_(DAILY_RM_ISSUE_LOG_SHEET_, [prLogHeader, raRow_(istDayKeyGs_(TestFixture_daysAgo_(realNowForPrune, 1)), 'L-FLAGGED')]);
      raCapSs._sheets[DAILY_RM_ISSUE_LOG_SHEET_] = raCapSheet;
      SpreadsheetApp = { getActiveSpreadsheet: function () { return raCapSs; }, flush: function () {} };
      DriveApp = TestMockDriveApp_();
      const raRealReadLeads = readLeadsTab_;
      let raCapReads = 0;
      readLeadsTab_ = function (s2) { raCapReads++; return raRealReadLeads(s2); };
      try { captureDailyRmIssues_(); } finally { readLeadsTab_ = raRealReadLeads; }
      TestAssertEqual_(raCapReads, 1, 'captureDailyRmIssues_: the Leads tab is read once per night - the refill inside the prune reuses the capture read');
      TestAssert_(raCapSheet.getRange(2, asIdx + 1, 1, 1).getValues()[0][0] instanceof Date, 'captureDailyRmIssues_: an older row that had lost its lead_assigned_at is refilled in the same run');
    } finally {
      SpreadsheetApp = realSsDi;
      DriveApp = realDriveDi;
    }

    // ---- RM Performance (Phase 4): reconstructRmPerformanceObservationsGs_
    // / aggregateRmPerformanceGs_ / classifyRmPerformanceGs_ against a
    // hand-seeded Movement_Log ----
    //
    // Expected classifications below were NOT hand-derived from scratch --
    // they were cross-checked against the real, already-proven
    // js/core-rm-performance.js engine (aggregateRmPerformance/
    // classifyRmPerformance, which take the same {name, lead_id, dayKey,
    // rule, violated} observation shape and have zero DOM/browser
    // dependency) using the IDENTICAL observation sets these Movement_Log
    // fixtures are built to reconstruct, via a disposable browser harness
    // (deleted after use, same "disposable, not committed" pattern as
    // _verify-rm-performance.html). This is exactly the same lesson
    // HANDOVER.md's Phase 1 writeup already names: don't mix an
    // intentionally-extreme test RM into a peer pool too small to absorb
    // it, or the peer average gets pulled up by the very outlier it's
    // supposed to be a baseline for.
    // Each scenario gets its OWN mock spreadsheet/Movement_Log/peer pool --
    // NOT one shared sheet for all three. classifyRmPerformanceGs_ computes
    // the peer average across every group CURRENTLY passed to it, so
    // combining an intentionally-extreme test RM into the same call as
    // another scenario's RMs would let its own violations drag the peer
    // average up to meet it -- the exact pitfall named in this block's own
    // header comment above. Isolating scenarios is what keeps each one's
    // math identical to what was verified in the browser.
    function rmPerfMakeSheet_() {
      const ss = TestMockSpreadsheet_({});
      const sheet = ensureMovementLogSheet_(ss); // real header, so this can't drift from production
      return { ss: ss, sheet: sheet, header: sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] };
    }
    function rmPerfRowFor_(header, overrides) {
      const defaults = {
        snapshot_at: null, snapshot_label: 'test', lead_id: 'L-X', client_id: 'C-X', RM: 'Test RM', TL: 'Test A1',
        project: 'Test Project', region: 'Pune', client: 'Client',
        lead_assigned_at: null, // every caller sets this explicitly -- see rmPerfBadRow_/rmPerfCleanRow_
        group_source: 'google', source_bucket: 'Non-UTM', current_stage: 'Not Updated',
        last_connect: '', last_connect_time: '', last_comment: '',
        internal_status_comments: '', closing_reason: '', call_attempts: 0, call_count: 0, duration: 0, stage_comments: '',
      };
      const merged = Object.assign({}, defaults, overrides || {});
      return header.map(function (k) { return merged[k]; });
    }
    // 10 hours before the row's own snapshot -- past LEAD_GRACE_HOURS_ (3h,
    // needed for isNotUpdated/underCalledToday eligibility) but comfortably
    // under LEAD_LIFECYCLE_HOURS_ (48h). Relative to each row's OWN
    // snapshot_at, not one fixed date, specifically so stageStuck48h (whose
    // OUTCOME is purely past48h && pastGrace -- no stage/connection
    // condition at all, so nothing else can suppress it) never fires for
    // ANY row here, bad or clean alike. An earlier version of this fixture
    // used one fixed old lead_assigned_at for every row; that made
    // stageStuck48h fire unconditionally company-wide, contaminating the
    // composite the same way the (separately found and fixed, see
    // rmPerfCallLog_ below) underCalledToday contamination did -- caught
    // via a disposable browser harness cross-checking the real numbers
    // against js/core-rm-performance.js after a CI run failed on both.
    function rmPerfLeadAssignedAt_(dayNoon) { return new Date(dayNoon.getTime() - 10 * 3600000); }
    // A "bad" (isNotUpdated-eligible AND violated) row for (leadId, RM, day-noon).
    // call_attempts/call_count matched to rmPerfCleanRow_'s -- otherwise a
    // "bad" row (defaulting to call_attempts: 0) also genuinely violates
    // underCalledToday, muddying a fixture meant to isolate isNotUpdated
    // alone as the one differentiating rule (caught via
    // rmPerformanceDrivenByGs_ naming 2 driving rules instead of the
    // expected 1, not assumed correct going in).
    function rmPerfBadRow_(header, leadId, RM, dayNoon) {
      return rmPerfRowFor_(header, { snapshot_at: dayNoon, lead_id: leadId, client_id: 'C-' + leadId, RM: RM, current_stage: 'Not Updated', lead_assigned_at: rmPerfLeadAssignedAt_(dayNoon), call_attempts: 10, call_count: 10 });
    }
    // N dated action-log entries, all on dayNoon's own IST calendar day,
    // matching parseDatedCommentEntries_'s expected "... - yyyy-MM-dd
    // HH:mm" format (FollowupEngine.gs). Belt-and-braces for
    // underCalledToday alongside rmPerfLeadAssignedAt_ above: with
    // lead_assigned_at now only 10h before the snapshot, isCreatedThatDay
    // is true and attemptsToday reads call_attempts directly (this log is
    // never actually consulted on that path) -- kept anyway so the fixture
    // stays correct even if a future tweak moves lead_assigned_at back
    // outside "created today".
    function rmPerfCallLog_(dayNoon, n) {
      const dayKey = istDayKeyGs_(dayNoon);
      const parts = [];
      for (let i = 0; i < n; i++) parts.push('RM: call ' + (i + 1) + ' - ' + dayKey + ' ' + String(9 + i).padStart(2, '0') + ':00');
      return parts.join(' | ');
    }
    // A "clean" (eligible, NOT violated) row -- connected with a stage that
    // does not canonicalize to 'not updated' (isNotUpdated reads false via
    // both of its OR-branches), enough call_attempts to clear
    // underCalledToday directly (isCreatedThatDay=true via
    // rmPerfLeadAssignedAt_, see above), and the dated call-log belt-and-
    // braces too. Genuinely compliant on every rule it's eligible for, not
    // just the one a given scenario is built to isolate.
    function rmPerfCleanRow_(header, leadId, RM, dayNoon) {
      return rmPerfRowFor_(header, {
        snapshot_at: dayNoon, lead_id: leadId, client_id: 'C-' + leadId, RM: RM,
        current_stage: 'Connected', last_connect: 'Connected', last_connect_time: TestFixture_hoursAgo_(dayNoon, 1),
        lead_assigned_at: rmPerfLeadAssignedAt_(dayNoon), call_attempts: 10, call_count: 10,
        internal_status_comments: rmPerfCallLog_(dayNoon, 5),
      });
    }
    const rmPerfDay_ = function (iso) { return new Date(iso + 'T12:00:00+05:30'); }; // noon-anchored, same reasoning as the backfill test's day1Noon

    // -- Scenario A: 'Below Expectations' (broad) -- 6 leads under 'Bad
    // Broad' violated isNotUpdated on all of 4 consecutive days (chronic,
    // but EVERY eligible lead is violated -- breadth 100%, so NOT
    // "concentrated"); 6 leads under 'Good' compliant the same 4 days.
    const rmPerfA = rmPerfMakeSheet_();
    const days4 = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04'].map(rmPerfDay_);
    for (let i = 1; i <= 6; i++) { days4.forEach(function (d) { rmPerfA.sheet.appendRow(rmPerfBadRow_(rmPerfA.header, 'A-BAD-L' + i, 'Bad Broad', d)); }); }
    for (let i = 1; i <= 6; i++) { days4.forEach(function (d) { rmPerfA.sheet.appendRow(rmPerfCleanRow_(rmPerfA.header, 'A-GOOD-L' + i, 'Good', d)); }); }

    const rmPerfAObservations = reconstructRmPerformanceObservationsGs_(rmPerfA.ss);
    TestAssert_(rmPerfAObservations.length > 0, 'reconstructRmPerformanceObservationsGs_: produced observations from the seeded Movement_Log');
    const rmPerfAResults = computeRmPerformanceGs_(rmPerfA.ss);
    const rmPerfAByName = {}; rmPerfAResults.forEach(function (r) { rmPerfAByName[r.name] = r; });

    TestAssertEqual_(rmPerfAByName['Bad Broad'].classification, 'Below Expectations', 'classifyRmPerformanceGs_: 6/6 leads chronically violated (100% breadth) classifies as Below Expectations, not concentrated');
    TestAssertEqual_(rmPerfAByName['Bad Broad'].distinctLeads, 6, 'classifyRmPerformanceGs_: Bad Broad workload is exactly the 6 seeded leads');
    TestAssertEqual_(rmPerfAByName['Good'].classification, 'On Track', 'classifyRmPerformanceGs_: a fully-compliant group classifies On Track');
    TestAssert_(rmPerfAByName['Bad Broad'].composite > rmPerfAByName['Good'].composite, 'classifyRmPerformanceGs_: the violating group\'s composite score exceeds the compliant group\'s');
    TestAssertEqual_(rmPerformanceDrivenByGs_(rmPerfAByName['Good']).length, 0, 'rmPerformanceDrivenByGs_: an On Track group has nothing "driving" its score');
    const rmPerfASorted = sortRmPerformanceByPriorityGs_(rmPerfAResults);
    TestAssert_(rmPerfASorted.findIndex(function (r) { return r.name === 'Bad Broad'; }) < rmPerfASorted.findIndex(function (r) { return r.name === 'Good'; }), 'sortRmPerformanceByPriorityGs_: Below Expectations ranks ahead of On Track');

    // -- Scenario B: 'Watch — concentrated' -- 'Watch1' has ONE lead
    // violated 10 straight days (chronic) plus 7 other leads eligible just
    // 1 day each, all compliant (breadth 1/8 = 12.5%, well under the 25%
    // ceiling). Three SEPARATE 8-lead, fully-compliant peer RMs
    // (GoodA/GoodB/GoodC) keep the peer pool large enough that Watch1's own
    // violations don't drag the peer average up to meet it.
    const rmPerfB = rmPerfMakeSheet_();
    const days10 = ['2026-02-01', '2026-02-02', '2026-02-03', '2026-02-04', '2026-02-05', '2026-02-06', '2026-02-07', '2026-02-08', '2026-02-09', '2026-02-10'].map(rmPerfDay_);
    const feb1 = rmPerfDay_('2026-02-01');
    days10.forEach(function (d) { rmPerfB.sheet.appendRow(rmPerfBadRow_(rmPerfB.header, 'B-WATCH-BAD', 'Watch1', d)); });
    for (let i = 1; i <= 7; i++) { rmPerfB.sheet.appendRow(rmPerfCleanRow_(rmPerfB.header, 'B-WATCH-OK' + i, 'Watch1', feb1)); }
    ['GoodA', 'GoodB', 'GoodC'].forEach(function (rm) {
      for (let i = 1; i <= 8; i++) { rmPerfB.sheet.appendRow(rmPerfCleanRow_(rmPerfB.header, 'B-' + rm + '-L' + i, rm, feb1)); }
    });

    const rmPerfBResults = computeRmPerformanceGs_(rmPerfB.ss);
    const rmPerfBByName = {}; rmPerfBResults.forEach(function (r) { rmPerfBByName[r.name] = r; });

    TestAssertEqual_(rmPerfBByName['Watch1'].classification, 'Watch — concentrated', 'classifyRmPerformanceGs_: 1/8 leads chronically violated (12.5% breadth) classifies as Watch — concentrated, not Below Expectations');
    TestAssertEqual_(rmPerfBByName['Watch1'].distinctLeads, 8, 'classifyRmPerformanceGs_: Watch1 workload is the 1 chronic lead + 7 compliant leads');
    TestAssertEqual_(rmPerfBByName['Watch1'].rules.isNotUpdated.maxStreak, 10, 'classifyRmPerformanceGs_: the chronic lead\'s 10 CONSECUTIVE calendar days are correctly detected as one streak');
    TestAssertEqual_(rmPerfBByName['Watch1'].rules.isNotUpdated.chronicLeads, 1, 'classifyRmPerformanceGs_: exactly 1 lead crosses the chronic-streak threshold');
    TestAssertEqual_(rmPerfBByName['Watch1'].rules.isNotUpdated.concentrated, true, 'classifyRmPerformanceGs_: low breadth + a chronic lead correctly flags concentrated=true for this rule');
    ['GoodA', 'GoodB', 'GoodC'].forEach(function (rm) {
      TestAssertEqual_(rmPerfBByName[rm].classification, 'On Track', 'classifyRmPerformanceGs_: peer group ' + rm + ' (fully compliant) classifies On Track');
    });
    const watchDrivenBy = rmPerformanceDrivenByGs_(rmPerfBByName['Watch1']);
    TestAssertEqual_(watchDrivenBy.length, 1, 'rmPerformanceDrivenByGs_: exactly one rule (isNotUpdated) has a real violation for Watch1');
    TestAssertEqual_(watchDrivenBy[0].key, 'isNotUpdated', 'rmPerformanceDrivenByGs_: names the correct rule');
    const rmPerfBSorted = sortRmPerformanceByPriorityGs_(rmPerfBResults);
    TestAssert_(rmPerfBSorted.findIndex(function (r) { return r.name === 'Watch1'; }) < rmPerfBSorted.findIndex(function (r) { return r.name === 'GoodA'; }), 'sortRmPerformanceByPriorityGs_: Watch — concentrated ranks ahead of On Track');

    // -- Scenario C: 'Insufficient Data' -- only 2 distinct eligible leads
    // (below RM_PERF_MIN_VOLUME_LEADS_GS_ = 5), even though both are
    // violated every day shown -- volume gate wins regardless of rate.
    const rmPerfC = rmPerfMakeSheet_();
    const days3 = ['2026-03-01', '2026-03-02', '2026-03-03'].map(rmPerfDay_);
    days3.forEach(function (d) { rmPerfC.sheet.appendRow(rmPerfBadRow_(rmPerfC.header, 'C-SPARSE-L1', 'Sparse', d)); });
    days3.slice(0, 2).forEach(function (d) { rmPerfC.sheet.appendRow(rmPerfBadRow_(rmPerfC.header, 'C-SPARSE-L2', 'Sparse', d)); });

    const rmPerfCResults = computeRmPerformanceGs_(rmPerfC.ss);
    const rmPerfCByName = {}; rmPerfCResults.forEach(function (r) { rmPerfCByName[r.name] = r; });
    TestAssertEqual_(rmPerfCByName['Sparse'].classification, 'Insufficient Data', 'classifyRmPerformanceGs_: fewer than RM_PERF_MIN_VOLUME_LEADS_GS_ distinct eligible leads is always Insufficient Data, regardless of violation rate');
    TestAssertEqual_(rmPerfCByName['Sparse'].distinctLeads, 2, 'classifyRmPerformanceGs_: Sparse workload is exactly the 2 seeded leads');

    // -- empty-input handling --
    TestAssertEqual_(computeRmPerformanceGs_(TestMockSpreadsheet_({})).length, 0, 'computeRmPerformanceGs_: returns an empty array when Movement_Log does not exist yet');
    const rmPerfEmpty = rmPerfMakeSheet_();
    TestAssertEqual_(computeRmPerformanceGs_(rmPerfEmpty.ss).length, 0, 'computeRmPerformanceGs_: returns an empty array when Movement_Log exists but has no data rows');

    // -- Scenario D: leadership-exclusion mirror (t-rmperf-leadexcl01) --
    // RM_PERF_NON_RM_ROLES_GS_ / RM_PERF_LEADERSHIP_NAME_EXCLUSIONS_GS_. A
    // role-based leadership person ('A1' -- deliberately NOT cluster head/
    // city lead/commercial head, to prove the FULL non-RM-role set is
    // honored here, not just RmHierarchy.gs's narrower TOP_OF_ORG_ROLES_)
    // and a name-list-based leadership person (one of
    // RM_PERF_LEADERSHIP_NAME_EXCLUSIONS_GS_'s own entries, which has no
    // RM_Hierarchy row seeded at all) both get the EXACT SAME chronically-
    // violating fixture Scenario A's 'Bad Broad' classifies 'Below
    // Expectations' on -- neither may appear anywhere in
    // reconstructRmPerformanceObservationsGs_'s output or
    // computeRmPerformanceGs_'s results, while a genuine RM given the
    // identical fixture still classifies normally.
    const rmPerfD = rmPerfMakeSheet_();
    const rmHierarchySheetD = rmPerfD.ss.insertSheet('RM_Hierarchy');
    rmHierarchySheetD.getRange(1, 1, 3, 10).setValues([
      ['team', 'role', 'name', 'tl', 'tm', 'rh', 'ch', 'excluded', 'note', 'email'],
      ['Test Team', 'A1', 'Leader A1', '', '', '', '', false, '', ''],
      ['Test Team', 'S1', 'Real RM', '', '', '', '', false, '', ''],
    ]);
    ['Leader A1', 'Sourabh Sareen', 'Real RM'].forEach(function (rm) {
      for (let i = 1; i <= 6; i++) { days4.forEach(function (d) { rmPerfD.sheet.appendRow(rmPerfBadRow_(rmPerfD.header, 'D-' + rm.replace(/\s+/g, '') + '-L' + i, rm, d)); }); }
    });
    // A compliant peer group -- WITHOUT this, 'Real RM' would be the ONLY
    // participant left in the peer pool once Leader A1/Sourabh Sareen are
    // correctly excluded, making its own violations BE the peer average
    // (self-referential, so it could never classify as exceeding it) --
    // exactly the pitfall this file's own Scenario A/B header comment
    // above already names ("don't mix an intentionally-extreme test RM
    // into a peer pool too small to absorb it"). Caught by this test
    // itself failing against the real engine, not assumed correct going
    // in -- see this fix's own commit message.
    for (let i = 1; i <= 6; i++) { days4.forEach(function (d) { rmPerfD.sheet.appendRow(rmPerfCleanRow_(rmPerfD.header, 'D-GoodD-L' + i, 'Good D', d)); }); }

    const rmPerfDObservations = reconstructRmPerformanceObservationsGs_(rmPerfD.ss);
    TestAssertEqual_(rmPerfDObservations.filter(function (o) { return o.name === 'Leader A1'; }).length, 0, 'reconstructRmPerformanceObservationsGs_: a role-excluded leader (A1) produces zero observations');
    TestAssertEqual_(rmPerfDObservations.filter(function (o) { return o.name === 'Sourabh Sareen'; }).length, 0, 'reconstructRmPerformanceObservationsGs_: a name-list-excluded leader produces zero observations');
    TestAssert_(rmPerfDObservations.some(function (o) { return o.name === 'Real RM'; }), 'reconstructRmPerformanceObservationsGs_: a genuine RM given the identical fixture still produces observations');

    const rmPerfDResults = computeRmPerformanceGs_(rmPerfD.ss);
    const rmPerfDNames = rmPerfDResults.map(function (r) { return r.name; });
    TestAssert_(rmPerfDNames.indexOf('Leader A1') === -1, 'computeRmPerformanceGs_: a role-excluded leader (A1) never appears in the RM Performance report');
    TestAssert_(rmPerfDNames.indexOf('Sourabh Sareen') === -1, 'computeRmPerformanceGs_: a name-list-excluded leader never appears in the RM Performance report');
    const rmPerfDByName = {}; rmPerfDResults.forEach(function (r) { rmPerfDByName[r.name] = r; });
    TestAssertEqual_(rmPerfDByName['Real RM'].classification, 'Below Expectations', 'computeRmPerformanceGs_: a genuine RM given the identical fixture still classifies normally, proving the exclusion is scoped to leadership only');

    // -- rmPerfIsLeadershipExcludedGs_ / buildRmHierarchyRoleByNameLowerGs_: direct unit coverage --
    const rmPerfRoleMapD = buildRmHierarchyRoleByNameLowerGs_(rmPerfD.ss);
    TestAssertEqual_(rmPerfRoleMapD.get('leader a1'), 'A1', 'buildRmHierarchyRoleByNameLowerGs_: reads the role column keyed by lowercased name');
    TestAssert_(rmPerfIsLeadershipExcludedGs_('Leader A1', rmPerfRoleMapD), 'rmPerfIsLeadershipExcludedGs_: role-based exclusion (A1) fires against a real RM_Hierarchy row');
    TestAssert_(rmPerfIsLeadershipExcludedGs_('Sourabh Sareen', rmPerfRoleMapD), 'rmPerfIsLeadershipExcludedGs_: name-list exclusion fires even with no matching RM_Hierarchy row');
    TestAssert_(!rmPerfIsLeadershipExcludedGs_('Real RM', rmPerfRoleMapD), 'rmPerfIsLeadershipExcludedGs_: a genuine front-line role (S1) is not excluded');
    TestAssert_(!rmPerfIsLeadershipExcludedGs_('Someone Unlisted', null), 'rmPerfIsLeadershipExcludedGs_: degrades to false (not a throw) with no role map and a name not on the leadership list');
    TestAssertEqual_(buildRmHierarchyRoleByNameLowerGs_(TestMockSpreadsheet_({})), null, 'buildRmHierarchyRoleByNameLowerGs_: returns null (not an empty Map) when RM_Hierarchy does not exist');

    // -- vendor (Futwork) + admin (Snehil Chhimwal) exclusions, 2026-09-29 --
    // Explicit request: "remove agents that have 'futwork' in their name
    // from list, also remove Snehil Chhimwal from list". Excluded ENTIRELY
    // (same Stage-1 drop as leadership), mirrors the JS-side test block
    // byte-for-byte.
    TestAssert_(rmPerfIsLeadershipExcludedGs_('Futwork Agent 12', null), 'rmPerfIsLeadershipExcludedGs_: a Futwork vendor agent is excluded (name contains "Futwork")');
    TestAssert_(rmPerfIsLeadershipExcludedGs_('FUTWORK Agent Lower', null), 'rmPerfIsLeadershipExcludedGs_: Futwork match is case-insensitive');
    TestAssert_(rmPerfIsLeadershipExcludedGs_('Team Futwork Caller 3', null), 'rmPerfIsLeadershipExcludedGs_: "Futwork" mid-string still matches');
    TestAssert_(rmPerfIsLeadershipExcludedGs_('Snehil Chhimwal', null), 'rmPerfIsLeadershipExcludedGs_: the account holder/admin "Snehil Chhimwal" is excluded');
    TestAssert_(!rmPerfIsLeadershipExcludedGs_('Ramesh Kumar', null), 'rmPerfIsLeadershipExcludedGs_: a genuine front-line RM matching neither new pattern is NOT excluded');

    // -- Scenario E: posterior-confidence flagging, added 2026-09-30 --
    // HANDOVER.md §9.7.5 has the full derivation. Unlike the JS-side
    // browser test (tests/frontend-harness.html, tuned empirically
    // against the real multi-rule engine), these fixtures are built with
    // rmPerfBadRow_/rmPerfCleanRow_ specifically because THOSE isolate
    // isNotUpdated as the only rule that ever differs from its own peer
    // average (matched call_attempts/call_count/connect state means
    // followupOverdue/underCalledToday/stageStuck48h are either not
    // eligible at all, or eligible-and-never-violated, for EVERY group in
    // these fixtures — their peerAvg is exactly 0 and their shrunk rate is
    // exactly 0 for every group too, so they contribute EXACTLY 0 to both
    // composite and peerComposite here). That makes this a clean single-
    // rule Beta-Binomial problem, hand-verified by closed-form algebra
    // (not empirical browser tuning, unlike the JS-side multi-rule test —
    // both are legitimate given the underlying models differ).
    const rmPerfEDay = rmPerfDay_('2026-02-01');

    // E1. Large-n regression — old point-estimate rule and new confidence
    // rule must AGREE once n is large. Peer: 1000 leads, 200 violated
    // (20% raw). GsBigBelow: 100 leads, 10 violated (10%). GsBigAbove:
    // 100 leads, 50 violated (50%). Pooled peerAvg (self-inclusive) =
    // (200+10+50)/1200 = 0.216667 exactly. Hand-derived via the Beta
    // posterior formulas (alpha=K*peer+n*raw, beta=K*(1-peer)+n*(1-raw)):
    // GsBigBelow z ~= -5.44 (confidence ~0), GsBigAbove z ~= +4.35
    // (confidence ~0.999993) — both comfortably saturated, both agree
    // with what composite<=peerComposite*1.25 alone would already say.
    const rmPerfE = rmPerfMakeSheet_();
    for (let i = 1; i <= 200; i++) rmPerfE.sheet.appendRow(rmPerfBadRow_(rmPerfE.header, 'E-PEER-BAD-' + i, 'GsPeer', rmPerfEDay));
    for (let i = 1; i <= 800; i++) rmPerfE.sheet.appendRow(rmPerfCleanRow_(rmPerfE.header, 'E-PEER-CLEAN-' + i, 'GsPeer', rmPerfEDay));
    for (let i = 1; i <= 10; i++) rmPerfE.sheet.appendRow(rmPerfBadRow_(rmPerfE.header, 'E-BB-BAD-' + i, 'GsBigBelow', rmPerfEDay));
    for (let i = 1; i <= 90; i++) rmPerfE.sheet.appendRow(rmPerfCleanRow_(rmPerfE.header, 'E-BB-CLEAN-' + i, 'GsBigBelow', rmPerfEDay));
    for (let i = 1; i <= 50; i++) rmPerfE.sheet.appendRow(rmPerfBadRow_(rmPerfE.header, 'E-BA-BAD-' + i, 'GsBigAbove', rmPerfEDay));
    for (let i = 1; i <= 50; i++) rmPerfE.sheet.appendRow(rmPerfCleanRow_(rmPerfE.header, 'E-BA-CLEAN-' + i, 'GsBigAbove', rmPerfEDay));
    const rmPerfEResults = computeRmPerformanceGs_(rmPerfE.ss);
    const rmPerfEByName = {}; rmPerfEResults.forEach(function (r) { rmPerfEByName[r.name] = r; });
    TestAssert_(rmPerfEByName['GsBigBelow'].composite <= rmPerfEByName['GsBigBelow'].peerComposite * RM_PERF_FLAG_RATIO_GS_
      && rmPerfEByName['GsBigBelow'].confidence < 0.01 && rmPerfEByName['GsBigBelow'].classification === 'On Track',
      'classifyRmPerformanceGs_ large-n regression: GsBigBelow (10% raw, well under peer*1.25) -- old rule would not flag, new confidence near-zero, both agree On Track. Got: ' + JSON.stringify({ composite: rmPerfEByName['GsBigBelow'].composite, peerComposite: rmPerfEByName['GsBigBelow'].peerComposite, confidence: rmPerfEByName['GsBigBelow'].confidence }));
    TestAssert_(rmPerfEByName['GsBigAbove'].composite > rmPerfEByName['GsBigAbove'].peerComposite * RM_PERF_FLAG_RATIO_GS_
      && rmPerfEByName['GsBigAbove'].confidence > 0.90 && rmPerfEByName['GsBigAbove'].classification === 'Below Expectations',
      'classifyRmPerformanceGs_ large-n regression: GsBigAbove (50% raw, well over peer*1.25) -- old rule would flag, new confidence near-certain, both agree Below Expectations. Got: ' + JSON.stringify({ composite: rmPerfEByName['GsBigAbove'].composite, peerComposite: rmPerfEByName['GsBigAbove'].peerComposite, confidence: rmPerfEByName['GsBigAbove'].confidence }));

    // E2. THE key test -- small-n new capability. GsPeer2: 95 leads, 58
    // violated + 37 clean. GsSmallBad: 5 leads, all 5 violated. Pooled
    // peerAvg (self-inclusive) = (58+5)/(95+5) = 63/100 = 0.63 exactly.
    // Hand-derived: shrunk = (5/13)*1 + (8/13)*0.63 = 0.772308, ratio =
    // 1.2259 (OLD rule: composite <= peerComposite*1.25, NOT flagged --
    // margin 0.024). z = (0.772308 - 0.63*1.25)/sd = -0.1356, confidence
    // ~= 0.4461 (NEW rule: >= RM_PERF_CONFIDENCE_THRESHOLD_GS_ 0.40 --
    // margin 0.046, flagged Below Expectations). This is the literal .gs
    // mirror of the originally-reported bug (0 RMs "Below Expectations"
    // under a narrow filter).
    const rmPerfE2 = rmPerfMakeSheet_();
    for (let i = 1; i <= 58; i++) rmPerfE2.sheet.appendRow(rmPerfBadRow_(rmPerfE2.header, 'E2-PEER-BAD-' + i, 'GsPeer2', rmPerfEDay));
    for (let i = 1; i <= 37; i++) rmPerfE2.sheet.appendRow(rmPerfCleanRow_(rmPerfE2.header, 'E2-PEER-CLEAN-' + i, 'GsPeer2', rmPerfEDay));
    for (let i = 1; i <= 5; i++) rmPerfE2.sheet.appendRow(rmPerfBadRow_(rmPerfE2.header, 'E2-SB-' + i, 'GsSmallBad', rmPerfEDay));
    const rmPerfE2Results = computeRmPerformanceGs_(rmPerfE2.ss);
    const gsSmallBad = rmPerfE2Results.filter(function (r) { return r.name === 'GsSmallBad'; })[0];
    TestAssert_(!!gsSmallBad && gsSmallBad.composite <= gsSmallBad.peerComposite * RM_PERF_FLAG_RATIO_GS_,
      'classifyRmPerformanceGs_ small-n: OLD point-estimate rule would NOT flag GsSmallBad (5/5 violated, but shrinkage at n=5 keeps composite under peerComposite*1.25). Got: ' + JSON.stringify(gsSmallBad && { composite: gsSmallBad.composite, peerComposite: gsSmallBad.peerComposite }));
    TestAssert_(!!gsSmallBad && gsSmallBad.classification === 'Below Expectations' && gsSmallBad.confidence >= RM_PERF_CONFIDENCE_THRESHOLD_GS_,
      'classifyRmPerformanceGs_ small-n: NEW confidence rule DOES flag GsSmallBad as Below Expectations (~44.6% confidence clears the 0.40 threshold). Got: ' + JSON.stringify(gsSmallBad && { classification: gsSmallBad.classification, confidence: gsSmallBad.confidence }));

    // E3. rmPerfNormalCdfGs_ reference values -- byte-for-byte port of
    // js/core-rm-performance.js's rmPerfNormalCdf; tests/frontend-harness.html
    // carries the identical 4 values to catch a porting typo
    // check-runtime-parity.py structurally cannot (a function, not a
    // plain-data literal).
    TestAssert_(Math.abs(rmPerfNormalCdfGs_(0) - 0.5) < 1e-6, 'rmPerfNormalCdfGs_(0) is 0.5, got ' + rmPerfNormalCdfGs_(0));
    TestAssert_(Math.abs(rmPerfNormalCdfGs_(0.8416) - 0.80) < 1e-4, 'rmPerfNormalCdfGs_(0.8416) is ~0.80, got ' + rmPerfNormalCdfGs_(0.8416));
    TestAssert_(Math.abs(rmPerfNormalCdfGs_(1.2816) - 0.90) < 1e-4, 'rmPerfNormalCdfGs_(1.2816) is ~0.90, got ' + rmPerfNormalCdfGs_(1.2816));
    TestAssert_(Math.abs(rmPerfNormalCdfGs_(-1.2816) - 0.10) < 1e-4, 'rmPerfNormalCdfGs_(-1.2816) is ~0.10, got ' + rmPerfNormalCdfGs_(-1.2816));

    // ---- reportRmPerformanceNow(): console-callable wrapper, smoke test ----
    const realSs2 = SpreadsheetApp;
    SpreadsheetApp = { getActiveSpreadsheet: function () { return TestMockSpreadsheet_({}); }, flush: function () {} };
    try {
      reportRmPerformanceNow(); // must not throw against a spreadsheet with no Movement_Log data at all yet
      TestAssert_(true, 'reportRmPerformanceNow: does not throw when there is no Movement_Log data yet');
    } finally {
      SpreadsheetApp = realSs2;
    }
    const realSs3 = SpreadsheetApp;
    SpreadsheetApp = { getActiveSpreadsheet: function () { return rmPerfA.ss; }, flush: function () {} };
    try {
      reportRmPerformanceNow(); // must not throw against real accumulated data either
      TestAssert_(true, 'reportRmPerformanceNow: does not throw against populated Movement_Log data');
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
