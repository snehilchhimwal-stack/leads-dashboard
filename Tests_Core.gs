/**
 * Tests: Core.gs — row-parsing and stage-classification utilities.
 * Run runCoreTestsNow() from the function dropdown, or via runAllTests()
 * (Tests_RunAll.gs). See Tests_Mocks.gs for the shared harness.
 */
function runCoreTests_() {
  TestEnv_setUp_('Tests_Core', null);
  try {
    // ---- canonicalStage_ ----
    TestAssertEqual_(canonicalStage_('Opportunity'), 'opportunity', 'canonicalStage_: exact match, case-insensitive');
    TestAssertEqual_(canonicalStage_('Visit Booking'), 'visit booked', 'canonicalStage_: alias match');
    TestAssertEqual_(canonicalStage_('Gross EOI'), 'gross eoi application', 'canonicalStage_: alias substring match');
    TestAssertEqual_(canonicalStage_('Some Random Stage'), null, 'canonicalStage_: unrecognized stage returns null');
    TestAssertEqual_(canonicalStage_(''), null, 'canonicalStage_: blank returns null');
    TestAssertEqual_(canonicalStage_(null), null, 'canonicalStage_: null input returns null');

    // ---- isOppOrAbove_ ----
    TestAssert_(isOppOrAbove_('Opportunity') === true, 'isOppOrAbove_: Opportunity itself is Opp+');
    TestAssert_(isOppOrAbove_('Booking') === true, 'isOppOrAbove_: Booking (top of funnel) is Opp+');
    TestAssert_(isOppOrAbove_('Suspect') === false, 'isOppOrAbove_: Suspect (below Opportunity) is not Opp+');
    TestAssert_(isOppOrAbove_('Not Updated') === false, 'isOppOrAbove_: Not Updated is not Opp+');
    TestAssert_(isOppOrAbove_('Unrecognized') === false, 'isOppOrAbove_: unrecognized stage is not Opp+');

    // ---- isOppOrAbove_: closing_reason/lead_closing_reason fallback (2026-09-09) ----
    // A CRM stage text this app doesn't recognize must not silently read as
    // pre-Opportunity when the lead's own closing/resolution reason says
    // otherwise -- same class of gap isBookingLead/isSoftBookingLead (the
    // client-side siblings) were already fixed for.
    TestAssert_(isOppOrAbove_('Unrecognized', 'Booking') === true, 'isOppOrAbove_: unmapped stage falls back to closingReason when it names a real funnel stage at/above Opportunity');
    TestAssert_(isOppOrAbove_('Unrecognized', '', 'Opportunity') === true, 'isOppOrAbove_: leadClosingReason takes precedence and is checked even when closingReason is blank');
    TestAssert_(isOppOrAbove_('Unrecognized', 'Not Interested') === false, 'isOppOrAbove_: a closing reason that is not itself a funnel stage does not falsely trigger the fallback');
    TestAssert_(isOppOrAbove_('Unrecognized', '', '') === false, 'isOppOrAbove_: no closing reason at all still returns false for an unmapped stage');
    TestAssert_(isOppOrAbove_('Opportunity', 'Not Interested') === true, 'isOppOrAbove_: a correctly-mapped stage is never overridden by an unrelated closing reason');

    // ---- isOpenLead_ threads the same fallback through (2026-09-09) ----
    TestAssert_(isOpenLead_('Unrecognized', '', 'Booking') === false, 'isOpenLead_: an unmapped stage with a Booking closing reason is correctly excluded as Opp+, not left open');

    // ---- isClosedStage_ ----
    TestAssert_(isClosedStage_('Won') === true, 'isClosedStage_: exact "Won"');
    TestAssert_(isClosedStage_('Lost') === true, 'isClosedStage_: exact "Lost"');
    TestAssert_(isClosedStage_('Cancelled by client') === true, 'isClosedStage_: "cancel" stem match');
    TestAssert_(isClosedStage_('Closed - duplicate') === true, 'isClosedStage_: "close" stem match');
    TestAssert_(isClosedStage_('Rejected by RM') === true, 'isClosedStage_: "reject" stem match');
    TestAssert_(isClosedStage_('Opportunity') === false, 'isClosedStage_: open stage is not closed');
    TestAssert_(isClosedStage_('Disclosed') === false, 'isClosedStage_: "disclosed" contains "close" but not as a WORD stem — not closed');

    // ---- isOpenLead_ ----
    TestAssert_(isOpenLead_('Suspect', '', '') === true, 'isOpenLead_: open stage, no closing reason -> open');
    TestAssert_(isOpenLead_('Suspect', 'Not interested', '') === false, 'isOpenLead_: closingReason set -> closed');
    TestAssert_(isOpenLead_('Suspect', '', 'Duplicate') === false, 'isOpenLead_: leadClosingReason set -> closed');
    TestAssert_(isOpenLead_('Opportunity', '', '') === false, 'isOpenLead_: Opp+ stage -> not open (excluded as converted)');
    TestAssert_(isOpenLead_('Won', '', '') === false, 'isOpenLead_: closed-stage text -> not open');

    // ---- resolveTabName_ ----
    // The leads tab has one fixed name (TAB_NAME_OVERRIDE, Core.gs) — no
    // month-based auto-detect since 2026-09-01.
    TestAssertEqual_(resolveTabName_(TestMockSpreadsheet_({})), 'leads', 'resolveTabName_: always returns the fixed "leads" tab name');

    // ---- buildColIndex_ / getVal_ ----
    const header = ['Lead ID', 'RM', 'Region', 'Current Stage'];
    const colIndex = buildColIndex_(header);
    TestAssertEqual_(colIndex.lead_id, 0, 'buildColIndex_: matches "Lead ID" header via alias, case-insensitive');
    TestAssertEqual_(colIndex.RM, 1, 'buildColIndex_: matches "RM"');
    TestAssertEqual_(colIndex.region, 2, 'buildColIndex_: matches "Region"');
    TestAssertEqual_(colIndex.current_stage, 3, 'buildColIndex_: matches "Current Stage"');
    TestAssertEqual_(colIndex.client_id, -1, 'buildColIndex_: missing header column resolves to -1');
    const row = ['L-1', 'Test RM One', 'Test Region', 'Suspect'];
    TestAssertEqual_(getVal_(row, colIndex, 'RM'), 'Test RM One', 'getVal_: reads the right column by key');
    TestAssertEqual_(getVal_(row, colIndex, 'client_id'), '', 'getVal_: missing column returns blank, not undefined/throw');
    TestAssertEqual_(getVal_(row, colIndex, 'RM'), row[colIndex.RM], 'getVal_: sanity — matches direct index access');

    // A header with no lead_id column at all falls back to column 0 (same
    // convention the dashboard's own reader uses).
    const colIndexNoLeadId = buildColIndex_(['Something Else', 'RM']);
    TestAssertEqual_(colIndexNoLeadId.lead_id, 0, 'buildColIndex_: falls back to column 0 for lead_id when no header matches');

    // ---- opp_at (added 2026-09-21) ----
    const headerWithOppAt = ['Lead ID', 'RM', 'Region', 'Current Stage', 'opp_at'];
    const colIndexWithOppAt = buildColIndex_(headerWithOppAt);
    TestAssertEqual_(colIndexWithOppAt.opp_at, 4, 'buildColIndex_: matches "opp_at" header');
    const rowWithOppAt = ['L-1', 'Test RM One', 'Test Region', 'Opportunity', '2026-09-21 10:00:00'];
    TestAssertEqual_(getVal_(rowWithOppAt, colIndexWithOppAt, 'opp_at'), '2026-09-21 10:00:00', 'getVal_: reads opp_at by its HEADER_ALIASES_ key');
    TestAssertEqual_(colIndex.opp_at, -1, 'buildColIndex_: a leads-tab header predating opp_at resolves it to -1, not a throw');

    // ---- istDayKeyGs_ / pad2Gs_ ----
    const knownDate = new Date('2026-08-15T10:30:00+05:30');
    TestAssertEqual_(istDayKeyGs_(knownDate), '2026-08-15', 'istDayKeyGs_: formats a known IST date correctly');
    TestAssertEqual_(pad2Gs_(3), '03', 'pad2Gs_: single digit gets zero-padded');
    TestAssertEqual_(pad2Gs_(13), '13', 'pad2Gs_: double digit passes through unpadded');

    // ---- parseIstDayKeyOrDateGs_ (added 2026-09-29) ----
    const realDateCell = new Date('2026-08-15T00:00:00');
    TestAssertEqual_(parseIstDayKeyOrDateGs_(realDateCell), realDateCell, 'parseIstDayKeyOrDateGs_: a real Date cell passes through unchanged');
    const parsedFromString = parseIstDayKeyOrDateGs_('2026-08-15');
    TestAssert_(parsedFromString instanceof Date && parsedFromString.getFullYear() === 2026 && parsedFromString.getMonth() === 7 && parsedFromString.getDate() === 15,
      'parseIstDayKeyOrDateGs_: parses an istDayKeyGs_-shaped "YYYY-MM-DD" string into the matching Date');
    TestAssertEqual_(parseIstDayKeyOrDateGs_('not a date at all'), null, 'parseIstDayKeyOrDateGs_: an unparseable string returns null (caller keeps the row, never guesses)');
    TestAssertEqual_(parseIstDayKeyOrDateGs_(''), null, 'parseIstDayKeyOrDateGs_: blank returns null');
    TestAssertEqual_(parseIstDayKeyOrDateGs_(null), null, 'parseIstDayKeyOrDateGs_: null input returns null, not a throw');

    // ---- businessMinutesBetweenGs_ ----
    // Entirely within one working day (9am-7pm IST, WORK_START_HOUR_/
    // WORK_END_HOUR_ from SlaEngine.gs): 10am -> 11am = 60 real minutes,
    // all inside the window.
    const workDayStart = new Date('2026-08-17T10:00:00+05:30'); // a Monday
    const workDayPlus1h = new Date('2026-08-17T11:00:00+05:30');
    TestAssertEqual_(businessMinutesBetweenGs_(workDayStart, workDayPlus1h), 60, 'businessMinutesBetweenGs_: 1 real hour fully inside working hours = 60 business minutes');

    // Overnight span: 6pm to 10am next day should only count the portion
    // inside 9am-7pm each day (1 hour on day 1, 1 hour on day 2 = 120),
    // not the ~16 real hours in between.
    const evening = new Date('2026-08-17T18:00:00+05:30');
    const nextMorning = new Date('2026-08-18T10:00:00+05:30');
    TestAssertEqual_(businessMinutesBetweenGs_(evening, nextMorning), 120, 'businessMinutesBetweenGs_: overnight span only counts in-window minutes on each side');

    TestAssertEqual_(businessMinutesBetweenGs_(workDayPlus1h, workDayStart), 0, 'businessMinutesBetweenGs_: end before start returns 0, not negative');
    TestAssertEqual_(businessMinutesBetweenGs_(null, workDayPlus1h), 0, 'businessMinutesBetweenGs_: null start returns 0 instead of throwing');

    // ---- esc_ ----
    TestAssertEqual_(esc_('<b>Tom & "Jerry"</b>'), '&lt;b&gt;Tom &amp; &quot;Jerry&quot;&lt;/b&gt;', 'esc_: escapes <, >, &, " for safe HTML embedding');
    TestAssertEqual_(esc_(null), '', 'esc_: null becomes empty string, not the literal text "null"');
    TestAssertEqual_(esc_(42), '42', 'esc_: non-string input is coerced to string first');

    // ---- fmtCellsGs_ ----
    TestAssertEqual_(fmtCellsGs_(0), '0', 'fmtCellsGs_: zero has no separators');
    TestAssertEqual_(fmtCellsGs_(999), '999', 'fmtCellsGs_: under 1000 has no separators');
    TestAssertEqual_(fmtCellsGs_(1000), '1,000', 'fmtCellsGs_: exactly 1000 gets one separator');
    TestAssertEqual_(fmtCellsGs_(1234567), '1,234,567', 'fmtCellsGs_: 7 digits get two separators, grouped from the right');
    TestAssertEqual_(fmtCellsGs_(10000000), '10,000,000', 'fmtCellsGs_: the real 10M ceiling formats correctly (4-digit leading group)');

    // ---- computeWorkbookCellUsageGs_ ----
    // Real Sheets semantics: getMaxRows()*getMaxColumns() is the DECLARED
    // grid, independent of how much of it actually holds data — a sheet
    // with a 5000-row headroom (MOVEMENT_LOG_ROW_HEADROOM_ etc.) counts
    // all 5000 rows here even if only 3 have real values. The mock's
    // _maxRows/_maxCols model exactly this split from _data's own length.
    const cellUsageSs = TestMockSpreadsheet_({
      'Small': TestMockSheet_('Small', [['a', 'b']]),
      'Big': TestMockSheet_('Big', [['a', 'b', 'c']]),
    });
    cellUsageSs._sheets['Small']._maxRows = 1000;
    cellUsageSs._sheets['Small']._maxCols = 10;
    cellUsageSs._sheets['Big']._maxRows = 50000;
    cellUsageSs._sheets['Big']._maxCols = 26;
    const usage = computeWorkbookCellUsageGs_(cellUsageSs);
    TestAssertEqual_(usage.totalCells, 1000 * 10 + 50000 * 26, 'computeWorkbookCellUsageGs_: totalCells sums getMaxRows()*getMaxColumns() across every real tab, not just data-bearing cells');
    TestAssertEqual_(usage.sheets[0].name, 'Big', 'computeWorkbookCellUsageGs_: sheets is sorted largest-cells-first');
    TestAssertEqual_(usage.sheets[0].cells, 50000 * 26, 'computeWorkbookCellUsageGs_: per-sheet cells is rows*cols for that one tab');
    TestAssertEqual_(usage.ceiling, 10000000, 'computeWorkbookCellUsageGs_: ceiling is the real Sheets constant, not a guess');
    TestAssert_(Math.abs(usage.pctUsed - usage.totalCells / 10000000) < 1e-9, 'computeWorkbookCellUsageGs_: pctUsed is totalCells/ceiling');

    // ---- removeOppConversionTrackingTabNow ----
    // This function reaches SpreadsheetApp.getActiveSpreadsheet() directly
    // (same shape as reportWorkbookCellUsageNow above and
    // removeStaleMovementLogBackupTabNow_ in MovementTracker.gs), so each
    // case below swaps the global SpreadsheetApp itself rather than
    // passing a mock in as a parameter, then restores it — mirroring
    // Tests_MovementTracker.gs's own pattern for the same reason.
    const realSpreadsheetAppForOppConv_ = SpreadsheetApp;
    try {
      // (a) tab not found -> no-op, does not throw.
      SpreadsheetApp = { getActiveSpreadsheet: function () { return TestMockSpreadsheet_({}); } };
      removeOppConversionTrackingTabNow();
      TestAssert_(true, 'removeOppConversionTrackingTabNow: missing tab is a silent no-op, not a throw');

      // (b) tab exists with only a header row (no data) -> deleted.
      const headerOnlySs = TestMockSpreadsheet_({
        'Opp_Conversion_Tracking': TestMockSheet_('Opp_Conversion_Tracking', [['a', 'b', 'c']]),
      });
      SpreadsheetApp = { getActiveSpreadsheet: function () { return headerOnlySs; } };
      removeOppConversionTrackingTabNow();
      TestAssertEqual_(headerOnlySs.getSheetByName('Opp_Conversion_Tracking'), null, 'removeOppConversionTrackingTabNow: header-only tab (no data rows) is deleted');

      // (c) tab exists completely empty (not even a header) -> deleted.
      const fullyEmptySs = TestMockSpreadsheet_({
        'Opp_Conversion_Tracking': TestMockSheet_('Opp_Conversion_Tracking', []),
      });
      SpreadsheetApp = { getActiveSpreadsheet: function () { return fullyEmptySs; } };
      removeOppConversionTrackingTabNow();
      TestAssertEqual_(fullyEmptySs.getSheetByName('Opp_Conversion_Tracking'), null, 'removeOppConversionTrackingTabNow: completely empty tab is deleted');

      // (d) tab exists WITH real data rows -> refuses, tab untouched.
      // Proves the guard actually has teeth, not just a happy path.
      const hasDataSs = TestMockSpreadsheet_({
        'Opp_Conversion_Tracking': TestMockSheet_('Opp_Conversion_Tracking', [
          ['lead_id', 'stage'],
          ['L1', 'Opportunity'],
        ]),
      });
      SpreadsheetApp = { getActiveSpreadsheet: function () { return hasDataSs; } };
      let threwForRealData = false;
      try { removeOppConversionTrackingTabNow(); } catch (e) { threwForRealData = /1 data row/.test(e.message); }
      TestAssert_(threwForRealData, 'removeOppConversionTrackingTabNow: refuses (throws) when the tab has real data rows instead of silently deleting them');
      TestAssert_(hasDataSs.getSheetByName('Opp_Conversion_Tracking') !== null, 'removeOppConversionTrackingTabNow: tab with real data survives the refused call untouched');

      // (e) re-run safety: deleting twice in a row is a clean no-op the
      // second time — re-target the SAME spreadsheet object that just had
      // a real deletion happen in it (fullyEmptySs from (c)), not a fresh
      // mock, and not hasDataSs from (d) (whose delete was refused, so it
      // still has the tab and would throw again here).
      SpreadsheetApp = { getActiveSpreadsheet: function () { return fullyEmptySs; } };
      removeOppConversionTrackingTabNow();
      TestAssert_(true, 'removeOppConversionTrackingTabNow: running again immediately after a successful delete is a clean no-op');
    } finally {
      SpreadsheetApp = realSpreadsheetAppForOppConv_;
    }

    // ---- countCsvRecordsGs_ (2026-10-07): counts CSV RECORDS, not physical lines ----
    // Real incident: the comment prunes counted split('\n') lines of their own archive CSV, so every multi-line comment added a
    // phantom row and the prunes refused to run for days ("holds 6518 ... but 6369 were expected").
    TestAssertEqual_(countCsvRecordsGs_(''), 0, 'countCsvRecordsGs_: empty text has no records');
    TestAssertEqual_(countCsvRecordsGs_('a,b,c'), 1, 'countCsvRecordsGs_: a header alone is one record');
    TestAssertEqual_(countCsvRecordsGs_('h1,h2\nr1a,r1b\nr2a,r2b'), 3, 'countCsvRecordsGs_: plain lines are one record each (the same answer split(newline) gave)');
    TestAssertEqual_(countCsvRecordsGs_('h\n"line one\nline two"\nplain'), 3, 'countCsvRecordsGs_: a line break INSIDE quotes belongs to the same record (the production failure)');
    TestAssertEqual_(countCsvRecordsGs_('h\n"a\nb\nc\nd"\n"e\nf"'), 3, 'countCsvRecordsGs_: several multi-line records');
    TestAssertEqual_(countCsvRecordsGs_('h\n"he said ""call\nme"" later",x\nnext'), 3, 'countCsvRecordsGs_: an escaped quote ("") does not end the quoted cell early');
    TestAssertEqual_(countCsvRecordsGs_('h\n"comma, inside",x\nnext'), 3, 'countCsvRecordsGs_: commas inside quotes are irrelevant');
    TestAssertEqual_(countCsvRecordsGs_('h\r\n"a\r\nb"\r\nz'), 3, 'countCsvRecordsGs_: CRLF line ends count the same');
    TestAssertEqual_(countCsvRecordsGs_(null), 0, 'countCsvRecordsGs_: null is empty');
    // Round trip with the real writer: whatever archiveRowsToDriveCsv_ writes, the counter reads back as header + rows.
    const csvRealDrive = DriveApp;
    DriveApp = TestMockDriveApp_();
    try {
      const csvRows = [['2026-08-01', 'x', 'multi\nline\ncomment, with "quotes"'], ['2026-08-02', 'y', 'single'], ['2026-08-03', 'z', '\nleading and trailing\n']];
      const csvFile = archiveRowsToDriveCsv_('Round_Trip', ['date', 'id', 'comment'], csvRows, 'test');
      TestAssertEqual_(countCsvRecordsGs_(csvFile.getBlob().getDataAsString()), 1 + csvRows.length, 'countCsvRecordsGs_: reads back exactly header + N records from what archiveRowsToDriveCsv_ really writes');
    } finally {
      DriveApp = csvRealDrive;
    }
    // ---- archive idempotence, proof and rollback (email audit P18, 2026-10-08) ----
    // Real incident: a prune that archived and then failed before removing its rows wrote ANOTHER identical file on every retry (4 a
    // day) - 32 copies of the same few archives sat in Drive from 2026-10-03.
    const idRealDrive = DriveApp;
    try {
      const idHeader = ['date', 'id'];
      const idRows = [['2026-08-01', 'a'], ['2026-08-02', 'b']];
      const idLabel = '2026-08-01_to_2026-08-02';
      const idDrive = TestMockDriveApp_();
      DriveApp = idDrive;
      const idInfo1 = {};
      const idInfo2 = {};
      const idFile1 = archiveRowsToDriveCsv_('Id_Table', idHeader, idRows, idLabel, { info: idInfo1 });
      const idFile2 = archiveRowsToDriveCsv_('Id_Table', idHeader, idRows, idLabel, { info: idInfo2 });
      const idFolder = idDrive._folders[ARCHIVE_ROOT_FOLDER_]._folders['Id_Table'];
      TestAssertEqual_(idFolder._filesList.length, 1, 'archiveRowsToDriveCsv_: archiving the same rows under the same label twice leaves ONE file in Drive');
      TestAssert_(idFile1 === idFile2 && idInfo1.reused === false && idInfo2.reused === true, 'archiveRowsToDriveCsv_: the second call returns the first file and says it was reused');
      TestAssertEqual_(idDrive._folders[ARCHIVE_ROOT_FOLDER_]._files[ARCHIVE_MANIFEST_FILE_]._content.split('\n').length, 2, 'archiveRowsToDriveCsv_: a reused archive adds no second archive_log.csv row (header + 1)');
      archiveRowsToDriveCsv_('Id_Table', idHeader, [['2026-08-01', 'a'], ['2026-08-02', 'DIFFERENT']], idLabel);
      TestAssertEqual_(idFolder._filesList.length, 2, 'archiveRowsToDriveCsv_: same label but different content is a new file (nothing is ever overwritten or merged)');
      archiveRowsToDriveCsv_('Id_Table', idHeader, idRows, '2026-08-01_to_2026-08-03');
      TestAssertEqual_(idFolder._filesList.length, 3, 'archiveRowsToDriveCsv_: same content under a different label is a new file');
      idFile1.setTrashed(true);
      const idFile3 = archiveRowsToDriveCsv_('Id_Table', idHeader, idRows, idLabel);
      TestAssert_(idFile3 !== idFile1 && idFolder._filesList.length === 4, 'archiveRowsToDriveCsv_: a trashed copy is not reused - a fresh file is written');

      // archiveChunksVerifiedGs_: chunking, part labels, the ledger written only on commit (and only once)
      const skDrive = TestMockDriveApp_();
      DriveApp = skDrive;
      const skEntries = archiveChunksVerifiedGs_('Sk_Table', ['d', 'v'], [['x', '1'], ['y', '2'], ['z', '3']], 'lbl', 2, true);
      TestAssertEqual_(skEntries.map(function (e) { return e.label + ':' + e.rowCount; }).join(','), 'lbl_part1:2,lbl_part2:1', 'archiveChunksVerifiedGs_: 3 rows in chunks of 2 are archived as part1 (2 rows) and part2 (1 row)');
      TestAssert_(skEntries.every(function (e) { return !e.reused && !e.file.isTrashed(); }), 'archiveChunksVerifiedGs_: a proved archive keeps all its files');
      TestAssert_(!skDrive._folders[ARCHIVE_ROOT_FOLDER_]._files[ARCHIVE_MANIFEST_FILE_], 'archiveChunksVerifiedGs_: nothing is written to archive_log.csv until the caller commits');
      commitArchiveManifestGs_('Sk_Table', skEntries);
      TestAssertEqual_(skDrive._folders[ARCHIVE_ROOT_FOLDER_]._files[ARCHIVE_MANIFEST_FILE_]._content.split('\n').length, 3, 'commitArchiveManifestGs_: one ledger row per archive file (header + 2)');
      commitArchiveManifestGs_('Sk_Table', skEntries);
      TestAssertEqual_(skDrive._folders[ARCHIVE_ROOT_FOLDER_]._files[ARCHIVE_MANIFEST_FILE_]._content.split('\n').length, 3, 'commitArchiveManifestGs_: committing again adds nothing - a file already listed is skipped');

      // a proof that fails: thrown, this call's files trashed, no ledger row
      const rbDrive = TestMockDriveApp_();
      DriveApp = rbDrive;
      const rbRoot = rbDrive.createFolder(ARCHIVE_ROOT_FOLDER_);
      const rbFolder = rbRoot.createFolder('Rb_Table');
      const rbRealCreate = rbFolder.createFile;
      rbFolder.createFile = function (n, content, mime) { return rbRealCreate.call(rbFolder, n, content.split('\n').slice(0, -1).join('\n'), mime); }; // loses the last record
      let rbThrew = '';
      try { archiveChunksVerifiedGs_('Rb_Table', ['d', 'v'], [['x', '1'], ['y', '2'], ['z', '3']], 'lbl', 2, true); } catch (e) { rbThrew = String(e && e.message || e); }
      TestAssertContains_(rbThrew, 'were expected - refusing to prune Rb_Table', 'archiveChunksVerifiedGs_: an archive that does not hold every row throws');
      TestAssert_(rbFolder._filesList.length === 2 && rbFolder._filesList.every(function (f) { return f.isTrashed(); }), 'archiveChunksVerifiedGs_: …and the files it had just created are moved to the trash, not left to be copied again by the next run');
      TestAssert_(!rbRoot._files[ARCHIVE_MANIFEST_FILE_], 'archiveChunksVerifiedGs_: …and no ledger row was written');

      // a reused file is never trashed, even when a later chunk fails (it may be the only copy of rows an earlier attempt removed)
      const ruDrive = TestMockDriveApp_();
      DriveApp = ruDrive;
      const ruFirst = archiveChunksVerifiedGs_('Ru_Table', ['d', 'v'], [['x', '1'], ['y', '2']], 'L', 2, true);
      const ruFolder = ruDrive._folders[ARCHIVE_ROOT_FOLDER_]._folders['Ru_Table'];
      ruFolder.createFile = function () { throw new Error('simulated Drive failure'); };
      let ruThrew = '';
      try { archiveChunksVerifiedGs_('Ru_Table', ['d', 'v'], [['x', '1'], ['y', '2'], ['z', '3']], 'L', 2, true); } catch (e) { ruThrew = String(e && e.message || e); }
      TestAssertContains_(ruThrew, 'simulated Drive failure', 'archiveChunksVerifiedGs_: a chunk that cannot be created throws');
      TestAssertEqual_(ruFirst[0].file.isTrashed(), false, 'archiveChunksVerifiedGs_: an archive reused from an earlier attempt is NOT trashed by the rollback');
    } finally {
      DriveApp = idRealDrive;
    }
  } finally {
    TestEnv_tearDown_();
  }
  return TestResults_;
}

function runCoreTestsNow() { runCoreTests_(); }
