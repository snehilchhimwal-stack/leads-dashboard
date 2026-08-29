/**
 * Tests: MovementTracker.gs — snapshot capture, pruning, and the
 * automatic SLA_History write. Run runMovementTrackerTestsNow() from the
 * function dropdown, or via runAllTests() (Tests_RunAll.gs).
 */
function runMovementTrackerTests_() {
  const now = new Date('2026-08-17T14:00:00+05:30');

  const leadsHeader = TestFixture_leadsHeader_();
  const bannerRow = leadsHeader.map(function () { return ''; }); // row 1 = banner, matches real sheets
  function leadRow(overrides) {
    const defaults = {
      lead_id: 'L-1', client_id: 'C-1', RM: 'Test RM One', TL: 'Test A1 One', project: 'P', region: 'Test Region',
      client: 'Client', lead_assigned_at: now, group_source: 'google', source_bucket: 'Non-UTM',
      current_stage: 'Suspect', rm_is_active: true, call_attempts: 1,
    };
    const merged = Object.assign({}, defaults, overrides || {});
    return leadsHeader.map(function (k) { return merged[k] !== undefined ? merged[k] : ''; });
  }

  const monthShort = Utilities.formatDate(now, 'Asia/Kolkata', 'MMM');
  const leadsSheet = TestMockSheet_(monthShort, [bannerRow, leadsHeader, leadRow({}), leadRow({ lead_id: '' /* blank lead_id: must be skipped */ }), leadRow({ lead_id: 'L-2', client_id: 'C-2', RM: 'Test RM Two' })]);
  const ss = TestMockSpreadsheet_({});
  ss._sheets[monthShort] = leadsSheet;

  TestEnv_setUp_('Tests_MovementTracker', ss);
  try {
    // ---- ensureMovementLogSheet_: fresh creation + header self-heal ----
    const logSheet = ensureMovementLogSheet_(ss);
    TestAssertEqual_(logSheet.getLastRow(), 1, 'ensureMovementLogSheet_: a fresh sheet has just the header row');
    const headerRow = logSheet.getRange(1, 1, 1, logSheet.getLastColumn()).getValues()[0];
    TestAssertContains_(headerRow.join(','), 'stage_comments', 'ensureMovementLogSheet_: header includes every SNAPSHOT_COLUMNS_ field');

    // Simulate an old sheet missing a trailing column, confirm self-heal appends it.
    const oldHeaders = ['snapshot_at', 'snapshot_label'].concat(SNAPSHOT_COLUMNS_.slice(0, -1)); // drop the last column
    const staleSs = TestMockSpreadsheet_({ 'Movement_Log': TestMockSheet_('Movement_Log', [oldHeaders]) });
    const healedSheet = ensureMovementLogSheet_(staleSs);
    const healedHeader = healedSheet.getRange(1, 1, 1, healedSheet.getLastColumn()).getValues()[0];
    TestAssertContains_(healedHeader.join(','), SNAPSHOT_COLUMNS_[SNAPSHOT_COLUMNS_.length - 1], 'ensureMovementLogSheet_: self-heals a missing trailing header column on an existing sheet');

    // ---- snapshotOpenLeads_: writes rows, skips blank lead_id, triggers SLA_History ----
    snapshotOpenLeads_('test snapshot label');
    const afterSnap = ss.getSheetByName('Movement_Log');
    TestAssertEqual_(afterSnap.getLastRow(), 3, 'snapshotOpenLeads_: writes exactly 2 data rows (3 total incl. header) — the blank-lead_id row is correctly skipped');
    const slaHistory = ss.getSheetByName('SLA_History');
    TestAssert_(!!slaHistory && slaHistory.getLastRow() === 2, 'snapshotOpenLeads_: also writes exactly one SLA_History row (header + 1) via writeSlaHistorySnapshot_');

    // ---- buildTodayCallBaselineGs_ / lastSnapshotBeforeGs_ ----
    // Seed Movement_Log with a snapshot from clearly BEFORE today, to test the baseline reads.
    const priorSs = TestMockSpreadsheet_({
      'Movement_Log': TestMockSheet_('Movement_Log', [
        ['snapshot_at', 'snapshot_label'].concat(SNAPSHOT_COLUMNS_),
        [TestFixture_daysAgo_(now, 1), 'yesterday'].concat(SNAPSHOT_COLUMNS_.map(function (c) {
          if (c === 'lead_id') return 'L-3';
          if (c === 'client_id') return 'C-3';
          if (c === 'call_attempts') return 4;
          return '';
        })),
      ]),
    });
    const baseline = buildTodayCallBaselineGs_(priorSs, now);
    TestAssertEqual_(baseline['C-3'], 4, 'buildTodayCallBaselineGs_: reads back yesterday\'s call_attempts as today\'s baseline');
    const lastSnap = lastSnapshotBeforeGs_(priorSs, now);
    TestAssert_(!!lastSnap['C-3'] && lastSnap['C-3'].call_attempts === 4, 'lastSnapshotBeforeGs_: returns the full {atMs, call_attempts} entry, not just the count');

    // ---- buildMovementLogMapsGs_ (perf pass, 2026-08-28) — reads
    // Movement_Log ONCE and must produce results IDENTICAL to calling
    // buildTodayCallBaselineGs_ and lastSnapshotBeforeGs_ separately. ----
    const combined = buildMovementLogMapsGs_(priorSs, now);
    TestAssertEqual_(combined.baselineMap['C-3'], baseline['C-3'], 'buildMovementLogMapsGs_: baselineMap matches buildTodayCallBaselineGs_\'s own separate result exactly');
    TestAssertEqual_(combined.lastSnapshotMap['C-3'].call_attempts, lastSnap['C-3'].call_attempts, 'buildMovementLogMapsGs_: lastSnapshotMap matches lastSnapshotBeforeGs_\'s own separate result exactly');
    TestAssertEqual_(combined.lastSnapshotMap['C-3'].atMs, lastSnap['C-3'].atMs, 'buildMovementLogMapsGs_: lastSnapshotMap\'s atMs matches too, not just call_attempts');

    // ---- pruneMovementLog_: retention cutoff + row-headroom shrink ----
    // pruneMovementLog_ computes its cutoff from the REAL wall clock
    // (Date.now()), not an injectable `now` — so these two rows must be
    // relative to the REAL current moment, not this file's fixed
    // synthetic `now` used everywhere else, or "recent" could actually be
    // older than the real 7-day cutoff depending on how far the fixed
    // date drifts from whenever this suite is actually run.
    const realNowForPrune = new Date();
    const pruneSs = TestMockSpreadsheet_({});
    const pruneHeader = ['snapshot_at', 'snapshot_label'].concat(SNAPSHOT_COLUMNS_);
    const oldRow = [TestFixture_daysAgo_(realNowForPrune, 10), 'old'].concat(SNAPSHOT_COLUMNS_.map(function (c) { return c === 'lead_id' ? 'L-OLD' : ''; }));
    const recentRow = [TestFixture_daysAgo_(realNowForPrune, 1), 'recent'].concat(SNAPSHOT_COLUMNS_.map(function (c) { return c === 'lead_id' ? 'L-RECENT' : ''; }));
    const pruneSheet = TestMockSheet_('Movement_Log', [pruneHeader, oldRow, recentRow]);
    // Simulate a sheet that has grown a large row allocation over months
    // of unpruned use — real MOVEMENT_LOG_ROW_HEADROOM_ is 5000, so only
    // an allocation well beyond (kept rows + 5000) actually exercises the
    // shrink branch; a tiny fixture-scale allocation never would.
    pruneSheet._maxRows = 20000;
    pruneSs._sheets['Movement_Log'] = pruneSheet;
    // pruneMovementLog_ uses Date.now() internally (real wall-clock) for
    // its cutoff, not the injected `now` — a 10-day-old fixture row will
    // always be outside MOVEMENT_LOG_RETENTION_DAYS (7) regardless of
    // when this suite actually runs, so this stays deterministic.
    pruneMovementLog_(pruneSs);
    const keptRows = pruneSheet.getRange(2, 1, pruneSheet.getLastRow() - 1, pruneHeader.length).getValues();
    TestAssertEqual_(keptRows.filter(function (r) { return r[1] === 'old'; }).length, 0, 'pruneMovementLog_: a row older than the retention window is dropped');
    TestAssertEqual_(keptRows.filter(function (r) { return r[1] === 'recent'; }).length, 1, 'pruneMovementLog_: a row within the retention window is kept');
    TestAssert_(pruneSheet.getMaxRows() < 20000, 'pruneMovementLog_: shrinks an over-allocated sheet\'s row count back down toward kept-rows + MOVEMENT_LOG_ROW_HEADROOM_');
    TestAssert_(pruneSheet.getMaxRows() >= 1 + 1 + MOVEMENT_LOG_ROW_HEADROOM_, 'pruneMovementLog_: never shrinks below what the kept rows + headroom actually need');

    // ---- setupMovementTracking: installs exactly SNAPSHOT_HOURS_.length triggers, cleans up old ones first ----
    const setupSs = TestMockSpreadsheet_({});
    const priorTriggers = ['snapshotPeriodic', 'snapshotEvening', 'someUnrelatedTrigger'];
    // Re-enter TestEnv with a preset trigger list for JUST this check —
    // simplest way to test setupMovementTracking's own cleanup-then-
    // install behavior without disturbing the rest of this file's setup.
    const priorScriptApp = ScriptApp;
    ScriptApp = TestMockScriptApp_(priorTriggers);
    const realSpreadsheetApp2 = SpreadsheetApp;
    SpreadsheetApp = { getActiveSpreadsheet: function () { return setupSs; }, flush: function () {} };
    try {
      setupMovementTracking();
      TestAssertEqual_(ScriptApp._state.created.length, SNAPSHOT_HOURS_.length, 'setupMovementTracking: installs exactly one trigger per SNAPSHOT_HOURS_ entry');
      TestAssert_(ScriptApp._state.deleted.indexOf('snapshotPeriodic') !== -1, 'setupMovementTracking: deletes any pre-existing snapshotPeriodic trigger before reinstalling');
      TestAssert_(ScriptApp._state.deleted.indexOf('snapshotEvening') !== -1, 'setupMovementTracking: also cleans up the legacy snapshotEvening trigger name');
      TestAssert_(ScriptApp._state.deleted.indexOf('someUnrelatedTrigger') === -1, 'setupMovementTracking: does NOT touch a trigger belonging to a different function');
    } finally {
      ScriptApp = priorScriptApp;
      SpreadsheetApp = realSpreadsheetApp2;
    }
  } finally {
    TestEnv_tearDown_();
  }
  return TestResults_;
}

function runMovementTrackerTestsNow() { runMovementTrackerTests_(); }
