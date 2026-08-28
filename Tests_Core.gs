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
    const monthShort = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'MMM');
    const monthYear = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'MMM-yyyy');
    const ssShort = TestMockSpreadsheet_({});
    ssShort._sheets[monthShort] = TestMockSheet_(monthShort, []);
    TestAssertEqual_(resolveTabName_(ssShort), monthShort, 'resolveTabName_: finds the short month-name tab');

    const ssYear = TestMockSpreadsheet_({});
    ssYear._sheets[monthYear] = TestMockSheet_(monthYear, []);
    TestAssertEqual_(resolveTabName_(ssYear), monthYear, 'resolveTabName_: falls back to the month-year tab when short name is absent');

    const ssNone = TestMockSpreadsheet_({});
    TestAssertThrows_(function () { resolveTabName_(ssNone); }, 'resolveTabName_: throws when neither tab exists');

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

    // ---- istDayKeyGs_ / pad2Gs_ ----
    const knownDate = new Date('2026-08-15T10:30:00+05:30');
    TestAssertEqual_(istDayKeyGs_(knownDate), '2026-08-15', 'istDayKeyGs_: formats a known IST date correctly');
    TestAssertEqual_(pad2Gs_(3), '03', 'pad2Gs_: single digit gets zero-padded');
    TestAssertEqual_(pad2Gs_(13), '13', 'pad2Gs_: double digit passes through unpadded');

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
  } finally {
    TestEnv_tearDown_();
  }
  return TestResults_;
}

function runCoreTestsNow() { runCoreTests_(); }
