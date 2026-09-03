/**
 * Tests: UnmatchedCommentLogger.gs — the unmatched-comment review log and
 * its de-dup. Run runUnmatchedCommentLoggerTestsNow() from the function
 * dropdown, or via runAllTests() (Tests_RunAll.gs).
 */
function TestUCL_row_(header, overrides) {
  const defaults = {
    lead_id: 'L-X', client_id: 'C-X', RM: 'Test RM One', TL: 'Test A1 One', project: 'P', region: 'Pune',
    client: 'Client', lead_assigned_at: new Date(), group_source: 'google', source_bucket: 'Non-UTM',
    current_stage: 'Suspect', rm_is_active: true, call_attempts: 1,
  };
  const merged = Object.assign({}, defaults, overrides || {});
  return header.map(function (k) { return merged[k] !== undefined ? merged[k] : ''; });
}

function runUnmatchedCommentLoggerTests_() {
  const now = new Date('2026-08-17T14:00:00+05:30');
  const header = TestFixture_leadsHeader_();
  const banner = header.map(function () { return ''; });

  const rows = [
    banner, header,
    // Genuinely unmatched: real text, matches no OUTCOME_RULES_GS_ signal.
    TestUCL_row_(header, { lead_id: 'L-UNMATCHED', internal_status_comments: 'Test RM One: Client seemed happy with the pricing overall - 2026-08-15 10:00' }),
    // Matched: classifies as a real outcome, should never be logged.
    TestUCL_row_(header, { lead_id: 'L-MATCHED', internal_status_comments: 'Test RM One: Not interested anymore - 2026-08-15 10:00' }),
    // Closed lead with an unmatched comment — must be excluded regardless.
    TestUCL_row_(header, { lead_id: 'L-CLOSED', current_stage: 'Won', internal_status_comments: 'Test RM One: Client seemed happy overall - 2026-08-15 10:00' }),
    // No comment at all — nothing to classify.
    TestUCL_row_(header, { lead_id: 'L-NOCOMMENT' }),
    // Punctuation-only comment classifies as "No Real Update", NOT the
    // generic "Update" outcome — must not be logged either.
    TestUCL_row_(header, { lead_id: 'L-BLANKONLY', internal_status_comments: 'Test RM One: --- - 2026-08-15 10:00' }),
    // No-timestamp fallback path (last_comment field only) — also unmatched.
    TestUCL_row_(header, { lead_id: 'L-NOTIME', internal_status_comments: '', stage_comments: '', last_comment: 'Client mentioned something about a birthday party' }),
  ];

  const ss = TestMockSpreadsheet_({});
  const monthShort = 'leads'; // fixed tab name (no longer month-based) — see Core.gs's resolveTabName_
  ss._sheets[monthShort] = TestMockSheet_(monthShort, rows);

  TestEnv_setUp_('Tests_UnmatchedCommentLogger', ss);
  try {
    // ---- ensureUnmatchedCommentsLogSheet_ ----
    const logSheet = ensureUnmatchedCommentsLogSheet_(ss);
    TestAssertEqual_(logSheet.getLastRow(), 1, 'ensureUnmatchedCommentsLogSheet_: a fresh sheet has just the header row');
    TestAssertContains_(logSheet.getRange(1, 1, 1, 10).getValues()[0].join(','), 'reviewed', 'ensureUnmatchedCommentsLogSheet_: header includes the reviewed column');

    // ---- scanUnmatchedCommentsGs_: first run ----
    const { colIndex, dataRows } = readLeadsTab_(ss);
    const firstCount = scanUnmatchedCommentsGs_(ss, dataRows, colIndex, now);
    TestAssertEqual_(firstCount, 2, 'scanUnmatchedCommentsGs_: logs exactly the 2 genuinely-unmatched, open leads (L-UNMATCHED, L-NOTIME)');
    TestAssertEqual_(logSheet.getLastRow(), 3, 'scanUnmatchedCommentsGs_: 2 new rows appended (3 total incl. header)');

    const loggedRows = logSheet.getRange(2, 1, 2, 10).getValues();
    const loggedIds = loggedRows.map(function (r) { return r[1]; });
    TestAssert_(loggedIds.indexOf('L-UNMATCHED') !== -1, 'scanUnmatchedCommentsGs_: L-UNMATCHED (real text, no keyword match) is logged');
    TestAssert_(loggedIds.indexOf('L-NOTIME') !== -1, 'scanUnmatchedCommentsGs_: L-NOTIME (no-timestamp fallback path) is logged too');
    ['L-MATCHED', 'L-CLOSED', 'L-NOCOMMENT', 'L-BLANKONLY'].forEach(function (id) {
      TestAssert_(loggedIds.indexOf(id) === -1, 'scanUnmatchedCommentsGs_: ' + id + ' is correctly NOT logged');
    });

    const unmatchedRow = loggedRows[loggedIds.indexOf('L-UNMATCHED')];
    TestAssertEqual_(unmatchedRow[5], 'Client seemed happy with the pricing overall', 'scanUnmatchedCommentsGs_: logs the real comment text verbatim');
    TestAssertEqual_(unmatchedRow[6], '2026-08-15 10:00', 'scanUnmatchedCommentsGs_: logs the comment\'s own timestamp when one exists');
    TestAssertEqual_(unmatchedRow[8], false, 'scanUnmatchedCommentsGs_: a freshly-logged row starts with reviewed=false');

    const notimeRow = loggedRows[loggedIds.indexOf('L-NOTIME')];
    TestAssertEqual_(notimeRow[6], '', 'scanUnmatchedCommentsGs_: comment_at is blank for the no-timestamp fallback case (nothing to report)');

    // ---- de-dup: a second run with UNCHANGED data logs nothing new ----
    const secondCount = scanUnmatchedCommentsGs_(ss, dataRows, colIndex, now);
    TestAssertEqual_(secondCount, 0, 'scanUnmatchedCommentsGs_: a second run against unchanged data logs 0 new rows — de-dup working');
    TestAssertEqual_(logSheet.getLastRow(), 3, 'scanUnmatchedCommentsGs_: sheet row count is unchanged after the no-op second run');

    // ---- de-dup: a genuinely NEW comment on the SAME lead DOES get logged ----
    const leadsSheet = ss.getSheetByName(monthShort);
    const rmColIdx = colIndex.RM + 1; // 1-indexed for getRange
    const commentColIdx = colIndex.internal_status_comments + 1;
    // Find L-UNMATCHED's row number and overwrite its comment with a
    // NEW unmatched comment (different timestamp).
    const allLeadRows = leadsSheet.getRange(3, 1, leadsSheet.getLastRow() - 2, leadsSheet.getLastColumn()).getValues();
    const unmatchedRowIdx = allLeadRows.findIndex(function (r) { return r[colIndex.lead_id] === 'L-UNMATCHED'; });
    leadsSheet.getRange(3 + unmatchedRowIdx, commentColIdx, 1, 1).setValues([['Test RM One: Something entirely different this time - 2026-08-16 11:00']]);
    const { colIndex: colIndex2, dataRows: dataRows2 } = readLeadsTab_(ss);
    const thirdCount = scanUnmatchedCommentsGs_(ss, dataRows2, colIndex2, now);
    TestAssertEqual_(thirdCount, 1, 'scanUnmatchedCommentsGs_: a genuinely NEW unmatched comment on an already-logged lead produces exactly 1 new row');
    TestAssertEqual_(logSheet.getLastRow(), 4, 'scanUnmatchedCommentsGs_: sheet now has 3 data rows total — the old L-UNMATCHED entry is NOT overwritten, the new one is appended alongside it');

    // ---- de-dup survives comment_at coming back as a real Date object ----
    // Regression test for the 2026-09-03 production incident: Sheets
    // silently converts a "yyyy-MM-dd HH:mm"-shaped STRING write into a
    // date-typed cell, so a REAL sheet's getValues() returns a JS Date
    // for comment_at, not the original string — TestMockSheet_ never did
    // this (which is exactly why the bug shipped with a fully green test
    // suite), so this test builds that Date object by hand to actually
    // exercise the fix. Without the fix, this comment would be re-logged
    // as a duplicate on every run forever.
    const dateSs = TestMockSpreadsheet_({});
    dateSs._sheets[monthShort] = TestMockSheet_(monthShort, [banner, header,
      TestUCL_row_(header, { lead_id: 'L-DATECELL', internal_status_comments: 'Test RM One: Already logged before this run - 2026-08-20 09:15' }),
    ]);
    const dateLogSheet = ensureUnmatchedCommentsLogSheet_(dateSs);
    // Same shape scanUnmatchedCommentsGs_ itself writes, EXCEPT comment_at
    // is a real Date (as a real sheet would hand back), not the string
    // "2026-08-20 09:15" the write path actually sends.
    dateLogSheet.appendRow([
      '2026-08-20', 'L-DATECELL', 'Test RM One', 'Pune', 'P', 'Already logged before this run',
      new Date('2026-08-20T09:15:00+05:30'), '2026-08-20 09:20:00', false, '',
    ]);
    const { colIndex: dateColIndex, dataRows: dateDataRows } = readLeadsTab_(dateSs);
    const dateRunCount = scanUnmatchedCommentsGs_(dateSs, dateDataRows, dateColIndex, now);
    TestAssertEqual_(dateRunCount, 0, 'scanUnmatchedCommentsGs_: correctly recognizes an already-logged comment as a duplicate even when comment_at reads back as a Date object, not a string (2026-09-03 fix)');
    TestAssertEqual_(dateLogSheet.getLastRow(), 2, 'scanUnmatchedCommentsGs_: no duplicate row was appended for the Date-typed comment_at case');

    // ---- dedupeUnmatchedCommentsNow: collapses the backlog the bug produced ----
    const dedupeSs = TestMockSpreadsheet_({});
    const dedupeLogSheet = ensureUnmatchedCommentsLogSheet_(dedupeSs);
    // Three duplicate rows for the SAME (lead_id, comment_at) — one with a
    // string comment_at, one with a Date object (the shape the bug
    // actually produced against a real sheet), one marked reviewed=true
    // (review work that must survive the cleanup).
    dedupeLogSheet.appendRow(['2026-08-20', 'L-DUP', 'Test RM One', 'Pune', 'P', 'Repeated comment', '2026-08-20 09:15', '2026-08-20 09:20:00', false, '']);
    dedupeLogSheet.appendRow(['2026-08-20', 'L-DUP', 'Test RM One', 'Pune', 'P', 'Repeated comment', new Date('2026-08-20T09:15:00+05:30'), '2026-08-20 15:20:00', false, '']);
    dedupeLogSheet.appendRow(['2026-08-21', 'L-DUP', 'Test RM One', 'Pune', 'P', 'Repeated comment', '2026-08-20 09:15', '2026-08-21 09:20:00', true, 'looked at this one']);
    // A genuinely different comment on a different lead — must survive untouched.
    dedupeLogSheet.appendRow(['2026-08-20', 'L-UNIQUE', 'Test RM Two', 'Pune', 'P', 'A completely different comment', '2026-08-20 10:00', '2026-08-20 10:05:00', false, '']);
    const realSsDedupe = SpreadsheetApp;
    SpreadsheetApp = { getActiveSpreadsheet: function () { return dedupeSs; }, flush: function () {} };
    try {
      dedupeUnmatchedCommentsNow();
      const dedupedRows = dedupeLogSheet.getRange(2, 1, dedupeLogSheet.getLastRow() - 1, 10).getValues();
      TestAssertEqual_(dedupedRows.length, 2, 'dedupeUnmatchedCommentsNow: collapses the 3 L-DUP duplicates down to 1, keeps L-UNIQUE untouched (2 rows total)');
      const dupRow = dedupedRows.find(function (r) { return r[1] === 'L-DUP'; });
      TestAssertEqual_(dupRow[8], true, 'dedupeUnmatchedCommentsNow: keeps the REVIEWED duplicate over unreviewed ones, never silently discarding review work');
      TestAssertEqual_(dupRow[9], 'looked at this one', 'dedupeUnmatchedCommentsNow: keeps the reviewed row\'s note intact');
      TestAssert_(!!dedupedRows.find(function (r) { return r[1] === 'L-UNIQUE'; }), 'dedupeUnmatchedCommentsNow: a genuinely unique row is never touched');
    } finally {
      SpreadsheetApp = realSsDedupe;
    }

    // Safe to run against an empty/missing sheet.
    const emptyDedupeSs = TestMockSpreadsheet_({});
    const realSsDedupeEmpty = SpreadsheetApp;
    SpreadsheetApp = { getActiveSpreadsheet: function () { return emptyDedupeSs; }, flush: function () {} };
    try {
      dedupeUnmatchedCommentsNow(); // must not throw when the sheet doesn't exist at all
      TestAssert_(true, 'dedupeUnmatchedCommentsNow: does not throw when Unmatched_Comments_Log does not exist yet');
    } finally {
      SpreadsheetApp = realSsDedupeEmpty;
    }

    // ---- scanUnmatchedCommentsNow (reads the leads tab itself) ----
    const freshSs = TestMockSpreadsheet_({});
    freshSs._sheets[monthShort] = TestMockSheet_(monthShort, [banner, header,
      TestUCL_row_(header, { lead_id: 'L-STANDALONE', internal_status_comments: 'Test RM One: Something nobody recognizes at all - 2026-08-15 09:00' }),
    ]);
    const realSs = SpreadsheetApp;
    SpreadsheetApp = { getActiveSpreadsheet: function () { return freshSs; }, flush: function () {} };
    try {
      scanUnmatchedCommentsNow();
      const freshLogSheet = freshSs.getSheetByName(UNMATCHED_COMMENTS_LOG_SHEET_);
      TestAssert_(!!freshLogSheet && freshLogSheet.getLastRow() === 2, 'scanUnmatchedCommentsNow: end-to-end run (reads the leads tab itself) logs the one unmatched lead');
    } finally {
      SpreadsheetApp = realSs;
    }

    // ---- clearReviewedUnmatchedCommentsNow ----
    const clearSs = TestMockSpreadsheet_({});
    const clearLogSheet = ensureUnmatchedCommentsLogSheet_(clearSs);
    clearLogSheet.appendRow(['2026-08-15', 'L-KEEP', 'Test RM One', 'Pune', 'P', 'not reviewed yet', '2026-08-15 10:00', '2026-08-15 10:05:00', false, '']);
    clearLogSheet.appendRow(['2026-08-15', 'L-CLEAR', 'Test RM One', 'Pune', 'P', 'already handled', '2026-08-15 11:00', '2026-08-15 11:05:00', true, 'added a new keyword rule for this']);
    const realSs2 = SpreadsheetApp;
    SpreadsheetApp = { getActiveSpreadsheet: function () { return clearSs; }, flush: function () {} };
    try {
      clearReviewedUnmatchedCommentsNow();
      const remaining = clearLogSheet.getRange(2, 1, clearLogSheet.getLastRow() - 1, 10).getValues();
      TestAssertEqual_(remaining.length, 1, 'clearReviewedUnmatchedCommentsNow: removes exactly the reviewed=true row');
      TestAssertEqual_(remaining[0][1], 'L-KEEP', 'clearReviewedUnmatchedCommentsNow: keeps the not-yet-reviewed row untouched');
    } finally {
      SpreadsheetApp = realSs2;
    }

    // Safe to run against an empty/missing sheet.
    const emptySs = TestMockSpreadsheet_({});
    const realSs3 = SpreadsheetApp;
    SpreadsheetApp = { getActiveSpreadsheet: function () { return emptySs; }, flush: function () {} };
    try {
      clearReviewedUnmatchedCommentsNow(); // must not throw when the sheet doesn't exist at all
      TestAssert_(true, 'clearReviewedUnmatchedCommentsNow: does not throw when Unmatched_Comments_Log does not exist yet');
    } finally {
      SpreadsheetApp = realSs3;
    }
  } finally {
    TestEnv_tearDown_();
  }
  return TestResults_;
}

function runUnmatchedCommentLoggerTestsNow() { runUnmatchedCommentLoggerTests_(); }
