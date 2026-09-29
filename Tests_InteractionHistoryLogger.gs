/**
 * Tests: InteractionHistoryLogger.gs — the interaction-history capture log
 * and its de-dup. Run runInteractionHistoryLoggerTestsNow() from the
 * function dropdown, or via runAllTests() (Tests_RunAll.gs).
 */
function TestIHL_row_(header, overrides) {
  const defaults = {
    lead_id: 'L-X', client_id: 'C-X', RM: 'Test RM One', TL: 'Test A1 One', project: 'P', region: 'Pune',
    client: 'Client', lead_assigned_at: new Date(), group_source: 'google', source_bucket: 'Non-UTM',
    current_stage: 'Suspect', rm_is_active: true, call_attempts: 1,
  };
  const merged = Object.assign({}, defaults, overrides || {});
  return header.map(function (k) { return merged[k] !== undefined ? merged[k] : ''; });
}

function runInteractionHistoryLoggerTests_() {
  const now = new Date('2026-08-17T14:00:00+05:30');
  const header = TestFixture_leadsHeader_();
  const banner = header.map(function () { return ''; });

  const rows = [
    banner, header,
    // Real comment, classifies as a known outcome — MUST still be logged
    // here (unlike UnmatchedCommentLogger.gs, this is not outcome-filtered).
    TestIHL_row_(header, { lead_id: 'L-MATCHED', client_id: 'C-MATCHED', internal_status_comments: 'Test RM One: Not interested anymore - 2026-08-15 10:00' }),
    // Real comment, matches no keyword — must ALSO be logged here.
    TestIHL_row_(header, { lead_id: 'L-UNMATCHED', client_id: 'C-UNMATCHED', internal_status_comments: 'Test RM One: Client seemed happy with the pricing overall - 2026-08-15 10:00' }),
    // Closed lead — must be excluded regardless of comment content.
    TestIHL_row_(header, { lead_id: 'L-CLOSED', current_stage: 'Won', internal_status_comments: 'Test RM One: Client seemed happy overall - 2026-08-15 10:00' }),
    // No comment at all — nothing to record.
    TestIHL_row_(header, { lead_id: 'L-NOCOMMENT' }),
    // No-timestamp fallback path (last_comment field only) — still logged.
    TestIHL_row_(header, { lead_id: 'L-NOTIME', internal_status_comments: '', stage_comments: '', last_comment: 'Client mentioned something about a birthday party' }),
  ];

  const ss = TestMockSpreadsheet_({});
  const monthShort = 'leads'; // fixed tab name (no longer month-based) — see Core.gs's resolveTabName_
  ss._sheets[monthShort] = TestMockSheet_(monthShort, rows);

  TestEnv_setUp_('Tests_InteractionHistoryLogger', ss);
  try {
    // ---- ensureCommentHistorySheet_ ----
    const logSheet = ensureCommentHistorySheet_(ss);
    TestAssertEqual_(logSheet.getLastRow(), 1, 'ensureCommentHistorySheet_: a fresh sheet has just the header row');
    TestAssertContains_(logSheet.getRange(1, 1, 1, 9).getValues()[0].join(','), 'client_id', 'ensureCommentHistorySheet_: header includes client_id');

    // ---- logInteractionHistoryGs_: first run ----
    const { colIndex, dataRows } = readLeadsTab_(ss);
    const firstCount = logInteractionHistoryGs_(ss, dataRows, colIndex, now);
    TestAssertEqual_(firstCount, 3, 'logInteractionHistoryGs_: logs all 3 open leads with a real comment, regardless of outcome (L-MATCHED, L-UNMATCHED, L-NOTIME)');
    TestAssertEqual_(logSheet.getLastRow(), 4, 'logInteractionHistoryGs_: 3 new rows appended (4 total incl. header)');

    const loggedRows = logSheet.getRange(2, 1, 3, 9).getValues();
    const loggedIds = loggedRows.map(function (r) { return r[1]; });
    TestAssert_(loggedIds.indexOf('L-MATCHED') !== -1, 'logInteractionHistoryGs_: L-MATCHED (classifies as a real outcome) IS logged — not outcome-filtered like UnmatchedCommentLogger');
    TestAssert_(loggedIds.indexOf('L-UNMATCHED') !== -1, 'logInteractionHistoryGs_: L-UNMATCHED (real text, no keyword match) is logged');
    TestAssert_(loggedIds.indexOf('L-NOTIME') !== -1, 'logInteractionHistoryGs_: L-NOTIME (no-timestamp fallback path) is logged too');
    ['L-CLOSED', 'L-NOCOMMENT'].forEach(function (id) {
      TestAssert_(loggedIds.indexOf(id) === -1, 'logInteractionHistoryGs_: ' + id + ' is correctly NOT logged');
    });

    const matchedRow = loggedRows[loggedIds.indexOf('L-MATCHED')];
    TestAssertEqual_(matchedRow[2], 'C-MATCHED', 'logInteractionHistoryGs_: client_id is carried through');
    TestAssertEqual_(matchedRow[6], 'Not interested anymore', 'logInteractionHistoryGs_: logs the real comment text verbatim');
    TestAssertEqual_(matchedRow[7], '2026-08-15 10:00', 'logInteractionHistoryGs_: logs the comment\'s own timestamp when one exists');

    const notimeRow = loggedRows[loggedIds.indexOf('L-NOTIME')];
    TestAssertEqual_(notimeRow[7], '', 'logInteractionHistoryGs_: comment_at is blank for the no-timestamp fallback case (nothing to report)');

    // ---- de-dup: a second run with UNCHANGED data logs nothing new ----
    const secondCount = logInteractionHistoryGs_(ss, dataRows, colIndex, now);
    TestAssertEqual_(secondCount, 0, 'logInteractionHistoryGs_: a second run against unchanged data logs 0 new rows — de-dup working');
    TestAssertEqual_(logSheet.getLastRow(), 4, 'logInteractionHistoryGs_: sheet row count is unchanged after the no-op second run');

    // ---- de-dup: a genuinely NEW comment on the SAME lead DOES get logged ----
    const leadsSheet = ss.getSheetByName(monthShort);
    const commentColIdx = colIndex.internal_status_comments + 1;
    const allLeadRows = leadsSheet.getRange(3, 1, leadsSheet.getLastRow() - 2, leadsSheet.getLastColumn()).getValues();
    const matchedRowIdx = allLeadRows.findIndex(function (r) { return r[colIndex.lead_id] === 'L-MATCHED'; });
    leadsSheet.getRange(3 + matchedRowIdx, commentColIdx, 1, 1).setValues([['Test RM One: Actually reconsidering - 2026-08-16 11:00']]);
    const { colIndex: colIndex2, dataRows: dataRows2 } = readLeadsTab_(ss);
    const thirdCount = logInteractionHistoryGs_(ss, dataRows2, colIndex2, now);
    TestAssertEqual_(thirdCount, 1, 'logInteractionHistoryGs_: a genuinely NEW comment on an already-logged lead produces exactly 1 new row');
    TestAssertEqual_(logSheet.getLastRow(), 5, 'logInteractionHistoryGs_: sheet now has 4 data rows total — the old L-MATCHED entry is NOT overwritten, the new one is appended alongside it');

    // ---- de-dup survives comment_at coming back as a real Date object ----
    // Same regression coverage as UnmatchedCommentLogger.gs's own test for
    // its 2026-09-03 production incident — this file copied that exact
    // de-dup mechanism from day one, so this proves the copy is correct,
    // not just that it looks similar.
    const dateSs = TestMockSpreadsheet_({});
    dateSs._sheets[monthShort] = TestMockSheet_(monthShort, [banner, header,
      TestIHL_row_(header, { lead_id: 'L-DATECELL', internal_status_comments: 'Test RM One: Already logged before this run - 2026-08-20 09:15' }),
    ]);
    const dateLogSheet = ensureCommentHistorySheet_(dateSs);
    // Same shape logInteractionHistoryGs_ itself writes, EXCEPT comment_at
    // is a real Date (as a real sheet would hand back), not the string
    // "2026-08-20 09:15" the write path actually sends.
    dateLogSheet.appendRow([
      '2026-08-20', 'L-DATECELL', 'C-DATECELL', 'Test RM One', 'Pune', 'P', 'Already logged before this run',
      new Date('2026-08-20T09:15:00+05:30'), '2026-08-20 09:20:00',
    ]);
    const { colIndex: dateColIndex, dataRows: dateDataRows } = readLeadsTab_(dateSs);
    const dateRunCount = logInteractionHistoryGs_(dateSs, dateDataRows, dateColIndex, now);
    TestAssertEqual_(dateRunCount, 0, 'logInteractionHistoryGs_: correctly recognizes an already-logged comment as a duplicate even when comment_at reads back as a Date object, not a string');
    TestAssertEqual_(dateLogSheet.getLastRow(), 2, 'logInteractionHistoryGs_: no duplicate row was appended for the Date-typed comment_at case');

    // ---- logInteractionHistoryNow (reads the leads tab itself) ----
    const freshSs = TestMockSpreadsheet_({});
    freshSs._sheets[monthShort] = TestMockSheet_(monthShort, [banner, header,
      TestIHL_row_(header, { lead_id: 'L-STANDALONE', internal_status_comments: 'Test RM One: Something entirely standalone - 2026-08-15 09:00' }),
    ]);
    const realSs = SpreadsheetApp;
    SpreadsheetApp = { getActiveSpreadsheet: function () { return freshSs; }, flush: function () {} };
    try {
      logInteractionHistoryNow();
      const freshLogSheet = freshSs.getSheetByName(COMMENT_HISTORY_SHEET_);
      TestAssert_(!!freshLogSheet && freshLogSheet.getLastRow() === 2, 'logInteractionHistoryNow: end-to-end run (reads the leads tab itself) logs the one lead\'s comment');
    } finally {
      SpreadsheetApp = realSs;
    }
    // ---- pruneCommentHistory_ (added 2026-09-29) ----
    // Own isolated DriveApp mock — TestEnv_setUp_ does not swap DriveApp
    // (only Tests_MovementTracker.gs-style tests that actually archive do
    // this themselves), so each sub-block below swaps/restores it.
    const realDriveForPrune_ = DriveApp;
    const commentHistoryRow_ = function (dateStr, leadId) {
      return [dateStr, leadId, 'C-' + leadId, 'Test RM One', 'Pune', 'P', 'some real comment text', '', '2026-01-01 00:00:00'];
    };

    DriveApp = TestMockDriveApp_();
    try {
      // (a) mixed ages: 30-day cutoff from a fixed "now", old rows archived
      // + removed, recent rows kept untouched.
      const pruneNow = new Date('2026-09-29T12:00:00+05:30');
      const pruneSs = TestMockSpreadsheet_({});
      const pruneSheet = TestMockSheet_(COMMENT_HISTORY_SHEET_, [COMMENT_HISTORY_COLUMNS_,
        commentHistoryRow_('2026-08-01', 'L-OLD1'),  // ~59 days old -> dropped
        commentHistoryRow_('2026-08-20', 'L-OLD2'),  // ~40 days old -> dropped
        commentHistoryRow_('2026-09-10', 'L-RECENT1'), // ~19 days old -> kept
        commentHistoryRow_('2026-09-25', 'L-RECENT2'), // ~4 days old -> kept
      ]);
      pruneSs._sheets[COMMENT_HISTORY_SHEET_] = pruneSheet;
      const realNowFn = Date.now;
      Date.now = function () { return pruneNow.getTime(); };
      try {
        pruneCommentHistory_(pruneSs);
      } finally {
        Date.now = realNowFn;
      }
      TestAssertEqual_(pruneSheet.getLastRow(), 3, 'pruneCommentHistory_: 2 old rows dropped, header + 2 kept rows remain');
      const survivingIds = pruneSheet.getRange(2, 1, 2, 9).getValues().map(function (r) { return r[1]; });
      TestAssert_(survivingIds.indexOf('L-RECENT1') !== -1 && survivingIds.indexOf('L-RECENT2') !== -1, 'pruneCommentHistory_: both recent rows survive, in order');
      TestAssert_(survivingIds.indexOf('L-OLD1') === -1 && survivingIds.indexOf('L-OLD2') === -1, 'pruneCommentHistory_: both old rows are gone from the live sheet');
      const rootFolder = DriveApp._folders[ARCHIVE_ROOT_FOLDER_];
      const chSubfolder = rootFolder && rootFolder._folders[COMMENT_HISTORY_SHEET_];
      TestAssert_(!!chSubfolder && chSubfolder._filesList.length === 1, 'pruneCommentHistory_: exactly 1 archive CSV created for the 2 dropped rows');
      const archivedCsv = chSubfolder._filesList[0].getBlob().getDataAsString();
      TestAssertEqual_(archivedCsv.split('\n').length, 3, 'pruneCommentHistory_: archive CSV has 1 header + 2 data lines');
      TestAssertContains_(archivedCsv, 'L-OLD1', 'pruneCommentHistory_: archived CSV actually contains the dropped row data, not just a count');

      // (b) re-run safety: nothing left to prune is a clean no-op.
      const beforeLastRow = pruneSheet.getLastRow();
      Date.now = function () { return pruneNow.getTime(); };
      try { pruneCommentHistory_(pruneSs); } finally { Date.now = realNowFn; }
      TestAssertEqual_(pruneSheet.getLastRow(), beforeLastRow, 'pruneCommentHistory_: running again with nothing old enough to prune is a no-op');
      TestAssertEqual_(chSubfolder._filesList.length, 1, 'pruneCommentHistory_: the no-op re-run creates no additional archive file');
    } finally {
      DriveApp = realDriveForPrune_;
    }

    DriveApp = TestMockDriveApp_();
    try {
      // (c) an unparseable date cell is KEPT, never guessed into pruning —
      // proves parseIstDayKeyOrDateGs_'s null case actually protects data,
      // not just that it returns null in isolation.
      const badDateSs = TestMockSpreadsheet_({});
      const badDateSheet = TestMockSheet_(COMMENT_HISTORY_SHEET_, [COMMENT_HISTORY_COLUMNS_,
        ['not a real date', 'L-BADDATE', 'C-BADDATE', 'Test RM One', 'Pune', 'P', 'comment', '', '2026-01-01 00:00:00'],
        commentHistoryRow_('2026-08-01', 'L-OLD3'), // genuinely old -> still dropped
      ]);
      badDateSs._sheets[COMMENT_HISTORY_SHEET_] = badDateSheet;
      const realNowFn2 = Date.now;
      Date.now = function () { return new Date('2026-09-29T12:00:00+05:30').getTime(); };
      try { pruneCommentHistory_(badDateSs); } finally { Date.now = realNowFn2; }
      TestAssertEqual_(badDateSheet.getLastRow(), 2, 'pruneCommentHistory_: unparseable-date row survives, genuinely-old row is dropped (1 header + 1 kept row)');
      TestAssertEqual_(badDateSheet.getRange(2, 2, 1, 1).getValues()[0][0], 'L-BADDATE', 'pruneCommentHistory_: the surviving row is specifically the unparseable-date one');
    } finally {
      DriveApp = realDriveForPrune_;
    }

    DriveApp = TestMockDriveApp_();
    try {
      // (d) chunking regression — same real-incident coverage as
      // removeStaleMovementLogBackupTabNow_'s own test (MovementTracker.gs,
      // 2026-09-28): 12,000 rows to drop must split into 3 archive files
      // (5000 + 5000 + 2000) via COMMENT_HISTORY_ARCHIVE_CHUNK_, not one.
      const chunkRows = [COMMENT_HISTORY_COLUMNS_];
      for (let i = 0; i < 12000; i++) chunkRows.push(commentHistoryRow_('2026-01-01', 'L-CHUNK' + i));
      const chunkSs = TestMockSpreadsheet_({});
      const chunkSheet = TestMockSheet_(COMMENT_HISTORY_SHEET_, chunkRows);
      chunkSs._sheets[COMMENT_HISTORY_SHEET_] = chunkSheet;
      const realNowFn3 = Date.now;
      Date.now = function () { return new Date('2026-09-29T12:00:00+05:30').getTime(); };
      try { pruneCommentHistory_(chunkSs); } finally { Date.now = realNowFn3; }
      const chunkRoot = DriveApp._folders[ARCHIVE_ROOT_FOLDER_];
      const chunkSubfolder = chunkRoot && chunkRoot._folders[COMMENT_HISTORY_SHEET_];
      TestAssertEqual_(chunkSubfolder._filesList.length, 3, 'pruneCommentHistory_: 12,000 dropped rows archive as exactly 3 chunk files (5000+5000+2000)');
      let totalArchivedLines = 0;
      chunkSubfolder._filesList.forEach(function (f) { totalArchivedLines += f.getBlob().getDataAsString().split('\n').length; });
      TestAssertEqual_(totalArchivedLines - 3, 12000, 'pruneCommentHistory_: total archived data rows across all chunks (minus 1 header line each) equals every dropped row');
      TestAssertEqual_(chunkSheet.getLastRow(), 1, 'pruneCommentHistory_: all 12,000 rows were old enough to drop — only the header remains');
    } finally {
      DriveApp = realDriveForPrune_;
    }
  } finally {
    TestEnv_tearDown_();
  }
  return TestResults_;
}

function runInteractionHistoryLoggerTestsNow() { runInteractionHistoryLoggerTests_(); }
