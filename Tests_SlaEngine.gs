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

    // 2026-09-03 fix: isNotUpdated must NOT stop firing once a lead crosses
    // 48h old, as long as its stage text is still literally "Not Updated" —
    // real data showed leads over 48h old whose stage never changed were
    // silently dropping out of this check and only surfacing as
    // stageStuck48h, losing the "still sitting untouched" signal entirely.
    // Both flags are expected true at once now; ISSUE_PRIORITY_GS_ (not
    // tested here) is what picks isNotUpdated as the reported issue.
    f = TestSla_buildRow_({ lead_assigned_at: TestFixture_hoursAgo_(now, 76), current_stage: 'Not Updated' });
    flags = computeSlaFlags_(f.row, f.colIndex, now, {});
    TestAssert_(flags.isNotUpdated === true, 'isNotUpdated: still fires for canonical "not updated" stage text on a lead well past 48h old (no longer gated on isUnder48h)');
    TestAssert_(flags.stageStuck48h === true, 'isNotUpdated fix sanity: the same past-48h "Not Updated"-stage lead is ALSO stageStuck48h (both true at once is the intended new behavior)');

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

    // ---- computeAllIssuesCheckpointGs_ (Step 4/11, two-checkpoint email
    // lifecycle redesign) — one leads-tab mock covering all 7 states.
    // Uses TestAIE_leadRow_/TestFixture_leadsHeader_ (Tests_AllIssuesEmailer.gs)
    // since this needs a shared-header sheet mock, not the per-call
    // colIndex TestSla_buildRow_ builds above — same global namespace,
    // reused rather than duplicated. ----
    const ckHeader = TestFixture_leadsHeader_();
    const ckBanner = ckHeader.map(function () { return ''; });
    const ckRows = [
      ckBanner, ckHeader,
      // resolved (closed) — the prior issue no longer matters once closed.
      TestAIE_leadRow_(ckHeader, { lead_id: 'L-CK-CLOSEDNOW', client_id: 'C-CK-CLOSEDNOW', current_stage: 'Won', lead_assigned_at: TestFixture_hoursAgo_(now, 60) }),
      // resolved (issue cleared, still open) — connected, recent comment, plenty of calls.
      TestAIE_leadRow_(ckHeader, {
        lead_id: 'L-CK-CLEARED', client_id: 'C-CK-CLEARED', lead_assigned_at: TestFixture_hoursAgo_(now, 10),
        last_connect: 'Connected', last_connect_time: TestFixture_hoursAgo_(now, 0.5),
        internal_status_comments: 'Test RM One: Ringing - ' + TestSla_isoMinusHours_(now, 0.5), call_attempts: 6,
      }),
      // still_open — same underCalledToday issue as the prior entry.
      // last_connect/last_connect_time set (same pattern
      // Tests_AllIssuesEmailer.gs's own L-UNDERCALLED fixture uses) so
      // isNotUpdated's never-connected-past-10-minutes rule can't ALSO
      // fire and outrank underCalledToday here.
      TestAIE_leadRow_(ckHeader, {
        lead_id: 'L-CK-STILLOPEN', client_id: 'C-CK-STILLOPEN', lead_assigned_at: TestFixture_hoursAgo_(now, 5),
        call_attempts: 2, last_connect: 'Connected', last_connect_time: TestFixture_hoursAgo_(now, 0.5),
      }),
      // category_changed (non-escalation) — was Follow-up Overdue (rank 2),
      // now past 48h so only stageStuck48h (rank 4) can fire; a fixture
      // baseline keeps underCalledToday from also firing and confounding
      // which single issue wins.
      TestAIE_leadRow_(ckHeader, { lead_id: 'L-CK-CATCHANGE', client_id: 'C-CK-CATCHANGE', lead_assigned_at: TestFixture_hoursAgo_(now, 50), call_attempts: 15 }),
      // escalated — currently flags isNotUpdated (rank 1); prior entry
      // (below) is a synthetic 'Stuck 48h+' (rank 4) to isolate the
      // ranking-comparison logic itself, same reasoning Tests_SlaEngine.gs
      // already uses above for primaryIssueGs_'s own forced-flag checks.
      TestAIE_leadRow_(ckHeader, { lead_id: 'L-CK-ESCALATE', client_id: 'C-CK-ESCALATE', lead_assigned_at: TestFixture_hoursAgo_(now, 1), current_stage: 'Suspect' }),
      // reopened — flagged again now; the PRIOR entry (below) is shaped
      // like a checkpoint RESULT with state:'resolved', proving this can
      // only be reached via a checkpoint's own prior output, not a raw
      // 17:00 snapshot entry.
      TestAIE_leadRow_(ckHeader, { lead_id: 'L-CK-REOPEN', client_id: 'C-CK-REOPEN', lead_assigned_at: TestFixture_hoursAgo_(now, 5), call_attempts: 2 }),
      // L-CK-GONE deliberately has NO row at all — not_found.
    ];
    const ckSs = TestMockSpreadsheet_({});
    ckSs._sheets['leads'] = TestMockSheet_('leads', ckRows);

    const ckPriorEntries = [
      { lead_id: 'L-CK-CLOSEDNOW', RM: 'Test RM One', TL: 'Test A1 One', status: 'Suspect', issueLabel: 'Stuck 48h+', followup: 'f' },
      { lead_id: 'L-CK-CLEARED', RM: 'Test RM One', TL: 'Test A1 One', status: 'Suspect', issueLabel: 'Follow-up Overdue', followup: 'f' },
      { lead_id: 'L-CK-STILLOPEN', RM: 'Test RM One', TL: 'Test A1 One', status: 'Suspect', issueLabel: "Behind on Today's Calls", followup: 'f' },
      { lead_id: 'L-CK-CATCHANGE', RM: 'Test RM One', TL: 'Test A1 One', status: 'Suspect', issueLabel: 'Follow-up Overdue', followup: 'f' },
      { lead_id: 'L-CK-ESCALATE', RM: 'Test RM One', TL: 'Test A1 One', status: 'Suspect', issueLabel: 'Stuck 48h+', followup: 'f' },
      { lead_id: 'L-CK-REOPEN', state: 'resolved', currentIssueLabel: null, currentStatus: 'Won' },
      { lead_id: 'L-CK-GONE', RM: 'Test RM One', TL: 'Test A1 One', status: 'Suspect', issueLabel: 'Not Updated', followup: 'f' },
    ];
    const ckBaselineMap = { 'C-CK-CATCHANGE': 10 }; // 15 - 10 = 5 today, clears MIN_CALLS_PER_DAY_ so underCalledToday can't also fire on L-CK-CATCHANGE
    const ckResults = computeAllIssuesCheckpointGs_(ckSs, ckPriorEntries, now, ckBaselineMap);
    const ckByLeadId = {};
    ckResults.forEach(function (r) { ckByLeadId[r.lead_id] = r; });

    TestAssertEqual_(ckResults.length, 7, 'computeAllIssuesCheckpointGs_: returns exactly one entry per prior entry, in any order');
    TestAssertEqual_(ckByLeadId['L-CK-CLOSEDNOW'].state, 'resolved', 'computeAllIssuesCheckpointGs_: a closed lead is resolved');
    TestAssertEqual_(ckByLeadId['L-CK-CLEARED'].state, 'resolved', 'computeAllIssuesCheckpointGs_: an open lead whose issue cleared is ALSO resolved, not still_open');
    TestAssertEqual_(ckByLeadId['L-CK-STILLOPEN'].state, 'still_open', 'computeAllIssuesCheckpointGs_: same issue label as the prior entry is still_open');
    TestAssertEqual_(ckByLeadId['L-CK-STILLOPEN'].currentIssueLabel, "Behind on Today's Calls", 'computeAllIssuesCheckpointGs_: still_open carries the current (unchanged) issue label');
    TestAssertEqual_(ckByLeadId['L-CK-CATCHANGE'].state, 'category_changed', 'computeAllIssuesCheckpointGs_: a DIFFERENT, lower-priority issue label is category_changed, not escalated');
    TestAssertEqual_(ckByLeadId['L-CK-CATCHANGE'].currentIssueLabel, 'Stuck 48h+', 'computeAllIssuesCheckpointGs_: category_changed carries the NEW issue label');
    TestAssertEqual_(ckByLeadId['L-CK-ESCALATE'].state, 'escalated', 'computeAllIssuesCheckpointGs_: a DIFFERENT, higher-priority issue label is escalated');
    TestAssertEqual_(ckByLeadId['L-CK-REOPEN'].state, 'reopened', 'computeAllIssuesCheckpointGs_: a lead whose PRIOR entry was already resolved, but is open+flagged again, is reopened (only reachable via a checkpoint-shaped prior entry)');
    TestAssertEqual_(ckByLeadId['L-CK-GONE'].state, 'not_found', 'computeAllIssuesCheckpointGs_: a lead_id no longer in the leads tab is not_found, never silently treated as resolved');
    TestAssertEqual_(ckByLeadId['L-CK-GONE'].currentIssueLabel, null, 'computeAllIssuesCheckpointGs_: not_found carries no current issue label');

    // Reused verbatim for a "second checkpoint" pass — feed one of THIS
    // call's own still_open results back in as the prior entry, proving
    // the function accepts its own output shape without special-casing.
    const ckSecondPass = computeAllIssuesCheckpointGs_(ckSs, [ckByLeadId['L-CK-STILLOPEN']], now, ckBaselineMap);
    TestAssertEqual_(ckSecondPass[0].state, 'still_open', 'computeAllIssuesCheckpointGs_: reused verbatim on its own prior output (a checkpoint-shaped entry, not a raw snapshot entry) — proves the "reused for both checkpoints" design intent');

    // ---- allIssuesCheckpointIsActiveGs_ (2026-09-26, "no email for
    // resolved status") — the one rule both checkpoint emails share. ----
    TestAssertEqual_(allIssuesCheckpointIsActiveGs_({ state: 'resolved' }), false, 'allIssuesCheckpointIsActiveGs_: resolved is not active');
    TestAssertEqual_(allIssuesCheckpointIsActiveGs_({ state: 'not_found' }), false, 'allIssuesCheckpointIsActiveGs_: not_found is not active (a lead no longer in the leads tab is closed out, never emailed)');
    ['still_open', 'category_changed', 'escalated', 'reopened'].forEach(function (s) {
      TestAssertEqual_(allIssuesCheckpointIsActiveGs_({ state: s }), true, 'allIssuesCheckpointIsActiveGs_: ' + s + ' is active');
    });
    TestAssertEqual_(allIssuesCheckpointIsActiveGs_(null), false, 'allIssuesCheckpointIsActiveGs_: a missing result is not active (never throws)');
    TestAssertEqual_(allIssuesCheckpointIsActiveGs_(undefined), false, 'allIssuesCheckpointIsActiveGs_: an undefined result is not active');

    // ---- filterAllIssuesCheckpoint2ForEmailGs_ — pure function, plain
    // fixtures, no mock spreadsheet needed. Since 2026-09-26 it keeps ONLY
    // still-unresolved leads (it used to keep a lead that had resolved
    // since Checkpoint 1, to announce the resolution). ----
    const ckC1 = [
      { lead_id: 'L-BOTH-RESOLVED', state: 'resolved', currentIssueLabel: null, currentStatus: 'Won' },
      { lead_id: 'L-RESOLVED-THEN-GONE', state: 'resolved', currentIssueLabel: null, currentStatus: 'Won' },
      { lead_id: 'L-STILL-ACTIVE-SAME', state: 'still_open', currentIssueLabel: 'Not Updated', currentStatus: 'Suspect' },
      { lead_id: 'L-NEWLY-RESOLVED', state: 'still_open', currentIssueLabel: 'Not Updated', currentStatus: 'Suspect' },
      { lead_id: 'L-REOPENED-SINCE-C1', state: 'resolved', currentIssueLabel: null, currentStatus: 'Won' },
      { lead_id: 'L-PROGRESSED', state: 'category_changed', currentIssueLabel: 'Follow-up Overdue', currentStatus: 'Suspect' },
    ];
    const ckC2 = [
      { lead_id: 'L-BOTH-RESOLVED', state: 'resolved', currentIssueLabel: null, currentStatus: 'Won' },
      { lead_id: 'L-RESOLVED-THEN-GONE', state: 'not_found', currentIssueLabel: null, currentStatus: null },
      { lead_id: 'L-STILL-ACTIVE-SAME', state: 'still_open', currentIssueLabel: 'Not Updated', currentStatus: 'Suspect' },
      { lead_id: 'L-NEWLY-RESOLVED', state: 'resolved', currentIssueLabel: null, currentStatus: 'Won' },
      { lead_id: 'L-REOPENED-SINCE-C1', state: 'reopened', currentIssueLabel: 'Stuck 48h+', currentStatus: 'Suspect' },
      { lead_id: 'L-PROGRESSED', state: 'escalated', currentIssueLabel: 'Inactive-RM Lead Added', currentStatus: 'Suspect' },
      { lead_id: 'L-UNKNOWN-TO-C1', state: 'still_open', currentIssueLabel: 'Not Updated', currentStatus: 'Suspect' }, // no matching ckC1 entry at all
    ];
    const ckFiltered = filterAllIssuesCheckpoint2ForEmailGs_(ckC1, ckC2);
    const ckFilteredIds = ckFiltered.map(function (r) { return r.lead_id; }).sort();

    TestAssert_(ckFilteredIds.indexOf('L-BOTH-RESOLVED') === -1, 'filterAllIssuesCheckpoint2ForEmailGs_: resolved at C1, still resolved at C2 -- suppressed (no news)');
    TestAssert_(ckFilteredIds.indexOf('L-RESOLVED-THEN-GONE') === -1, 'filterAllIssuesCheckpoint2ForEmailGs_: resolved at C1, not_found at C2 -- BOTH are closed-out states, still suppressed');
    TestAssert_(ckFilteredIds.indexOf('L-STILL-ACTIVE-SAME') !== -1, 'filterAllIssuesCheckpoint2ForEmailGs_: still_open at BOTH checkpoints is shown anyway -- an unresolved breach staying unresolved all day is itself the news');
    TestAssert_(ckFilteredIds.indexOf('L-NEWLY-RESOLVED') === -1, 'filterAllIssuesCheckpoint2ForEmailGs_: still_open at C1, resolved at C2 -- NOT shown (2026-09-26: a resolved lead is never emailed, even the moment it resolves)');
    TestAssert_(ckFilteredIds.indexOf('L-REOPENED-SINCE-C1') !== -1, 'filterAllIssuesCheckpoint2ForEmailGs_: resolved at C1, reopened at C2 -- shown (reopening is never suppressed)');
    TestAssert_(ckFilteredIds.indexOf('L-PROGRESSED') !== -1, 'filterAllIssuesCheckpoint2ForEmailGs_: category_changed at C1, escalated at C2 -- shown (neither endpoint is closed-out)');
    TestAssert_(ckFilteredIds.indexOf('L-UNKNOWN-TO-C1') !== -1, 'filterAllIssuesCheckpoint2ForEmailGs_: no matching prior entry at all -- fails open (shown), never silently dropped');
    TestAssertEqual_(ckFiltered.length, 4, 'filterAllIssuesCheckpoint2ForEmailGs_: the 3 resolved/not_found leads are dropped, the 4 still-unresolved ones pass through');
    TestAssertEqual_(filterAllIssuesCheckpoint2ForEmailGs_(ckC1, null).length, 0, 'filterAllIssuesCheckpoint2ForEmailGs_: a null result list yields an empty list, never throws');
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
