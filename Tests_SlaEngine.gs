/**
 * Tests: SlaEngine.gs — the 5 SLA compliance rules + issue priority.
 * Run runSlaEngineTestsNow() from the function dropdown, or via
 * runAllTests() (Tests_RunAll.gs). See Tests_Mocks.gs for the harness.
 */

// Builds one full leads-tab row (matching TestFixture_leadsHeader_'s
// column order) from a sparse {key: value} object — every column not
// specified defaults to blank/false, so each test only has to state what
// actually matters to the rule it's checking.
function TestSla_buildRow_(overrides) {
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
  const row = header.map(function (key) { return merged[key]; });
  return { row: row, colIndex: buildColIndex_(header) };
}

function runSlaEngineTests_() {
  TestEnv_setUp_('Tests_SlaEngine', null);
  try {
    // Fixed, not `new Date()` — deliberately: isNotUpdated's
    // neverConnectedPastWindow check runs businessMinutesBetweenGs_
    // (9am-7pm IST only), so a real "now" would make that one assertion
    // flaky depending on what hour this suite happens to run at. Fixed
    // to a safely-mid-workday Monday afternoon so every assertion below
    // is 100% deterministic regardless of when the suite actually runs.
    const now = new Date('2026-08-17T14:00:00+05:30');

    // ---- inactiveRmNewLead ----
    let f = TestSla_buildRow_({ lead_assigned_at: now, rm_is_active: false });
    let flags = computeSlaFlags_(f.row, f.colIndex, now, {});
    TestAssert_(flags.inactiveRmNewLead === true, 'inactiveRmNewLead: fires for a lead created today under an inactive RM');

    f = TestSla_buildRow_({ lead_assigned_at: now, rm_is_active: true });
    flags = computeSlaFlags_(f.row, f.colIndex, now, {});
    TestAssert_(flags.inactiveRmNewLead === false, 'inactiveRmNewLead: does not fire when RM is active');

    f = TestSla_buildRow_({ lead_assigned_at: TestFixture_daysAgo_(now, 3), rm_is_active: false });
    flags = computeSlaFlags_(f.row, f.colIndex, now, {});
    TestAssert_(flags.inactiveRmNewLead === false, 'inactiveRmNewLead: does not fire for a lead NOT created today, even if RM is inactive');

    // rm_is_active as a real checkbox `false` (not the string 'false')
    // must still register as inactive — the real production bug this
    // guards against (getVal_'s `false` coerced through `|| ''` used to
    // read as "unknown" instead of "inactive").
    f = TestSla_buildRow_({ lead_assigned_at: now, rm_is_active: false });
    TestAssert_(typeof f.row[f.colIndex.rm_is_active] === 'boolean', 'sanity: rm_is_active fixture really is a boolean, not a string');
    flags = computeSlaFlags_(f.row, f.colIndex, now, {});
    TestAssert_(flags.inactiveRmNewLead === true, 'inactiveRmNewLead: a real boolean false checkbox value is correctly read as inactive');

    // ---- isNotUpdated ----
    f = TestSla_buildRow_({ lead_assigned_at: TestFixture_hoursAgo_(now, 5), current_stage: 'Not Updated', last_connect_time: TestFixture_hoursAgo_(now, 1), last_connect: 'Connected' });
    flags = computeSlaFlags_(f.row, f.colIndex, now, {});
    TestAssert_(flags.isNotUpdated === true, 'isNotUpdated: fires for canonical "not updated" stage once past the 3h grace period');

    // Connected (so the separate grace-EXEMPT never-connected branch below
    // can't also fire and confound this assertion) but still inside grace —
    // isolates that the "not updated" STAGE-TEXT branch specifically
    // requires pastGrace.
    f = TestSla_buildRow_({ lead_assigned_at: TestFixture_hoursAgo_(now, 1), current_stage: 'Not Updated', last_connect_time: TestFixture_hoursAgo_(now, 0.5), last_connect: 'Connected' });
    flags = computeSlaFlags_(f.row, f.colIndex, now, {});
    TestAssert_(flags.isNotUpdated === false, 'isNotUpdated: the not-updated-stage-text branch does not fire while still inside the 3h grace period');

    f = TestSla_buildRow_({ lead_assigned_at: TestFixture_hoursAgo_(now, 1), current_stage: 'Suspect' });
    flags = computeSlaFlags_(f.row, f.colIndex, now, {});
    TestAssert_(flags.isNotUpdated === true, 'isNotUpdated: never-connected-past-10-minutes fires even though "Suspect" is NOT the not-updated stage text (grace-exempt)');

    f = TestSla_buildRow_({ lead_assigned_at: TestFixture_hoursAgo_(now, 1), current_stage: 'Suspect', last_connect_time: TestFixture_hoursAgo_(now, 0.5), last_connect: 'Connected' });
    flags = computeSlaFlags_(f.row, f.colIndex, now, {});
    TestAssert_(flags.isNotUpdated === false, 'isNotUpdated: does not fire once the lead has actually connected');

    // ---- followupOverdue ----
    f = TestSla_buildRow_({
      lead_assigned_at: TestFixture_hoursAgo_(now, 10), current_stage: 'Suspect',
      last_connect_time: TestFixture_hoursAgo_(now, 6), last_connect: 'Connected',
      internal_status_comments: 'Test RM One: Ringing - ' + TestSla_isoMinusHours_(now, 6),
    });
    flags = computeSlaFlags_(f.row, f.colIndex, now, {});
    TestAssert_(flags.followupOverdue === true, 'followupOverdue: fires when the last comment is stale beyond the 4h review window post-connect');

    f = TestSla_buildRow_({
      lead_assigned_at: TestFixture_hoursAgo_(now, 10), current_stage: 'Suspect',
      last_connect_time: TestFixture_hoursAgo_(now, 6), last_connect: 'Connected',
      internal_status_comments: 'Test RM One: Ringing - ' + TestSla_isoMinusHours_(now, 1),
    });
    flags = computeSlaFlags_(f.row, f.colIndex, now, {});
    TestAssert_(flags.followupOverdue === false, 'followupOverdue: does not fire when the most recent comment is recent');

    f = TestSla_buildRow_({ lead_assigned_at: TestFixture_hoursAgo_(now, 10), current_stage: 'Suspect' });
    flags = computeSlaFlags_(f.row, f.colIndex, now, {});
    TestAssert_(flags.followupOverdue === false, 'followupOverdue: does not fire for a lead that has never connected at all');

    // ---- underCalledToday ----
    f = TestSla_buildRow_({ lead_assigned_at: TestFixture_hoursAgo_(now, 5), call_attempts: 2 });
    flags = computeSlaFlags_(f.row, f.colIndex, now, {});
    TestAssert_(flags.underCalledToday === true, 'underCalledToday: fires when a lead created TODAY has fewer than 5 attempts logged');

    f = TestSla_buildRow_({ lead_assigned_at: TestFixture_hoursAgo_(now, 5), call_attempts: 6 });
    flags = computeSlaFlags_(f.row, f.colIndex, now, {});
    TestAssert_(flags.underCalledToday === false, 'underCalledToday: does not fire once 5+ attempts are logged today');

    // Lead NOT created today: attemptsToday is computed against a
    // baseline (yesterday's known call_attempts), not the raw total.
    f = TestSla_buildRow_({ lead_assigned_at: TestFixture_daysAgo_(now, 2), call_attempts: 12 });
    flags = computeSlaFlags_(f.row, f.colIndex, now, { 'C-TEST': 10 }); // 12 - 10 = 2 today, under 5
    TestAssert_(flags.underCalledToday === true, 'underCalledToday: for an older lead, uses (current - baseline) attempts, not the raw lifetime total');

    flags = computeSlaFlags_(f.row, f.colIndex, now, { 'C-TEST': 5 }); // 12 - 5 = 7 today, not under 5
    TestAssert_(flags.underCalledToday === false, 'underCalledToday: correctly NOT flagged once (current - baseline) clears the daily minimum');

    // ---- stageStuck48h ----
    f = TestSla_buildRow_({ lead_assigned_at: TestFixture_hoursAgo_(now, 50) });
    flags = computeSlaFlags_(f.row, f.colIndex, now, {});
    TestAssert_(flags.stageStuck48h === true, 'stageStuck48h: fires once a lead has been open past 48 real hours');

    f = TestSla_buildRow_({ lead_assigned_at: TestFixture_hoursAgo_(now, 40) });
    flags = computeSlaFlags_(f.row, f.colIndex, now, {});
    TestAssert_(flags.stageStuck48h === false, 'stageStuck48h: does not fire before 48 hours');

    // ---- closed / Opp+ leads never flag anything ----
    f = TestSla_buildRow_({ lead_assigned_at: TestFixture_hoursAgo_(now, 60), rm_is_active: false, current_stage: 'Won' });
    flags = computeSlaFlags_(f.row, f.colIndex, now, {});
    TestAssert_(flags.isOpenLead === false, 'computeSlaFlags_: a closed-stage lead reports isOpenLead=false');
    TestAssertEqual_(primaryIssueGs_(flags), null, 'computeSlaFlags_: a closed lead has no SLA flags set at all, regardless of how stale it looks');

    f = TestSla_buildRow_({ lead_assigned_at: TestFixture_hoursAgo_(now, 60), current_stage: 'Opportunity' });
    flags = computeSlaFlags_(f.row, f.colIndex, now, {});
    TestAssert_(flags.isOpenLead === false, 'computeSlaFlags_: an Opportunity+ lead reports isOpenLead=false too');

    // Undatable lead (no lead_assigned_at) — no rule can fire.
    f = TestSla_buildRow_({ lead_assigned_at: '', rm_is_active: false });
    flags = computeSlaFlags_(f.row, f.colIndex, now, {});
    TestAssert_(flags.isOpenLead === true, 'computeSlaFlags_: an undatable open lead is still reported open...');
    TestAssertEqual_(primaryIssueGs_(flags), null, '...but with no rule able to fire since there is no created date to measure age from');

    // ---- primaryIssueGs_ priority order ----
    // A lead that qualifies for both inactiveRmNewLead (highest priority)
    // and stageStuck48h (lowest priority) must report the higher one.
    f = TestSla_buildRow_({ lead_assigned_at: now, rm_is_active: false });
    flags = computeSlaFlags_(f.row, f.colIndex, now, {});
    // Force a second flag on too, to prove ordering rather than "only one is set":
    flags.stageStuck48h = true;
    TestAssertEqual_(primaryIssueGs_(flags).key, 'inactiveRmNewLead', 'primaryIssueGs_: inactiveRmNewLead outranks stageStuck48h when both are set');

    flags = { isOpenLead: true, inactiveRmNewLead: false, isNotUpdated: false, followupOverdue: true, underCalledToday: true, stageStuck48h: true };
    TestAssertEqual_(primaryIssueGs_(flags).key, 'followupOverdue', 'primaryIssueGs_: followupOverdue outranks underCalledToday/stageStuck48h');

    flags = { isOpenLead: true, inactiveRmNewLead: false, isNotUpdated: false, followupOverdue: false, underCalledToday: false, stageStuck48h: false };
    TestAssertEqual_(primaryIssueGs_(flags), null, 'primaryIssueGs_: returns null when nothing is flagged');
  } finally {
    TestEnv_tearDown_();
  }
  return TestResults_;
}

// "YYYY-MM-DD HH:MM" IST string N hours before `now` — matches the
// "Name: Comment - YYYY-MM-DD HH:MM" comment-log format FollowupEngine.gs
// parses, needed to build followupOverdue fixtures with a real staleness
// gap.
function TestSla_isoMinusHours_(now, h) {
  return Utilities.formatDate(TestFixture_hoursAgo_(now, h), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm');
}

function runSlaEngineTestsNow() { runSlaEngineTests_(); }
