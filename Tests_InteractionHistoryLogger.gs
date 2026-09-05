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
  } finally {
    TestEnv_tearDown_();
  }
  return TestResults_;
}

function runInteractionHistoryLoggerTestsNow() { runInteractionHistoryLoggerTests_(); }
