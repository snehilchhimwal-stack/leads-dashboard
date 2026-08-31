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

    // ---- Daily Cohort History (Gs) — automatic recording, 2026-08-31 ----
    // "now" = a fixed point 7-9 days after the fixture leads below were
    // assigned, so Aug 24 is fully 48h-elapsed AND still within a 7-day
    // retention window, Aug 30 is still under 48h, and Aug 1 is a lead
    // that's STILL open (keeps showing up in every recent capture) but
    // whose OWN day is long outside retention — exactly the real scenario
    // that used to make Same-Day and 48h evidence silently collapse to
    // the same fallback snapshot for an old date.
    const dchNow = new Date('2026-08-31T12:00:00+05:30');
    const movementLogHeader = ['snapshot_at', 'snapshot_label'].concat(SNAPSHOT_COLUMNS_);
    function movementRow(atDate, overrides) {
      const defaults = {
        lead_id: 'L-X', client_id: 'C-X', region: 'Pune East', group_source: 'google',
        current_stage: 'Suspect', lead_assigned_at: dchNow, closing_reason: '',
      };
      const merged = Object.assign({}, defaults, overrides || {});
      return movementLogHeader.map(function (k) {
        if (k === 'snapshot_at') return atDate;
        if (k === 'snapshot_label') return 'test';
        return merged[k] !== undefined ? merged[k] : '';
      });
    }
    const laCreated = new Date('2026-08-24T10:00:00+05:30');
    const ldCreated = new Date('2026-08-24T15:00:00+05:30');
    const lbCreated = new Date('2026-08-30T10:00:00+05:30');
    const lcCreated = new Date('2026-08-01T09:00:00+05:30');
    const dchMovementRows = [
      // L-A: raw region "Pune East" -> main region "Pune". Same-day
      // evidence (Suspect, not opp) genuinely differs from 48h evidence
      // (Opportunity) — proves the two deadlines are NOT silently
      // collapsing onto the same fallback snapshot.
      movementRow(new Date('2026-08-24T12:00:00+05:30'), { lead_id: 'L-A', client_id: 'C-A', region: 'Pune East', lead_assigned_at: laCreated, current_stage: 'Suspect' }),
      movementRow(new Date('2026-08-24T20:00:00+05:30'), { lead_id: 'L-A', client_id: 'C-A', region: 'Pune East', lead_assigned_at: laCreated, current_stage: 'Suspect' }),
      movementRow(new Date('2026-08-26T09:00:00+05:30'), { lead_id: 'L-A', client_id: 'C-A', region: 'Pune East', lead_assigned_at: laCreated, current_stage: 'Opportunity' }),
      // L-D: raw region "Bangalore" but group_source=loan -> Loan bucket.
      // Closes (Won — an excluded/closed stage) without ever reaching
      // Opportunity+, exercising closed48h.
      movementRow(new Date('2026-08-24T16:00:00+05:30'), { lead_id: 'L-D', client_id: 'C-D', region: 'Bangalore', group_source: 'loan', lead_assigned_at: ldCreated, current_stage: 'Won' }),
      // L-B: created within the last 48h as of dchNow — Aug 30 must NOT
      // show up as eligible yet.
      movementRow(new Date('2026-08-30T11:00:00+05:30'), { lead_id: 'L-B', client_id: 'C-B', region: 'Thane', lead_assigned_at: lbCreated, current_stage: 'Suspect' }),
      // L-C: created a month ago, still open — its most recent retained
      // snapshot is from Aug 26, but its OWN day (Aug 1) is long outside
      // Movement_Log's currently retained span (earliest retained row
      // here is Aug 24), so Aug 1 must be excluded even though this lead
      // itself is still represented in retained data.
      movementRow(new Date('2026-08-26T08:00:00+05:30'), { lead_id: 'L-C', client_id: 'C-C', region: 'Central', lead_assigned_at: lcCreated, current_stage: 'Suspect' }),
    ];

    const dchHistoryRows = _readMovementLogHistoryRowsGs_(TestMockSpreadsheet_({
      'Movement_Log': TestMockSheet_('Movement_Log', [movementLogHeader].concat(dchMovementRows)),
    }));
    TestAssertEqual_(dchHistoryRows.length, dchMovementRows.length, '_readMovementLogHistoryRowsGs_: reads every retained Movement_Log row');

    const dchEligible = eligibleDailyCohortDatesGs_(dchHistoryRows, dchNow);
    TestAssertEqual_(dchEligible, ['2026-08-24'], 'eligibleDailyCohortDatesGs_: only the fully-elapsed, still-retained day is eligible — excludes a still-under-48h day (Aug 30) and a day aged out of retention (Aug 1)');

    const dchByRegion = computeDailyCohortByRegionGs_('2026-08-24', dchHistoryRows, {}, dchNow);
    TestAssert_(!!dchByRegion['Pune'], 'computeDailyCohortByRegionGs_: raw region "Pune East" correctly groups to main region "Pune"');
    TestAssertEqual_(dchByRegion['Pune'].created, 1, 'computeDailyCohortByRegionGs_: Pune created count');
    TestAssertEqual_(dchByRegion['Pune'].sameDayOpp, 0, 'computeDailyCohortByRegionGs_: L-A was still Suspect (not opp) by end of its own day');
    TestAssertEqual_(dchByRegion['Pune'].opp48h, 1, 'computeDailyCohortByRegionGs_: L-A HAD reached Opportunity by its 48h mark — genuinely different evidence from the same-day figure, not the same fallback snapshot reused for both');
    TestAssert_(!!dchByRegion['Loan'], 'computeDailyCohortByRegionGs_: group_source=loan overrides raw region "Bangalore" to the Loan bucket');
    TestAssertEqual_(dchByRegion['Loan'].closed48h, 1, 'computeDailyCohortByRegionGs_: L-D closed (Won) without ever reaching Opportunity+');
    TestAssert_(!dchByRegion['Thane'] && !dchByRegion['Central'], 'computeDailyCohortByRegionGs_: leads created on other days (L-B: Aug 30, L-C: Aug 1) are excluded from the Aug 24 cohort');

    const dchLiveByKey = {
      'C-E': { region: 'Hyderabad', groupSource: 'google', stage: 'Opportunity', closingReason: '', leadClosingReason: '', leadAssignedAt: new Date('2026-08-24T09:00:00+05:30') },
    };
    const dchByRegionWithLive = computeDailyCohortByRegionGs_('2026-08-24', dchHistoryRows, dchLiveByKey, dchNow);
    TestAssert_(!!dchByRegionWithLive['Hyderabad'], 'computeDailyCohortByRegionGs_: a lead Movement_Log never captured at all is still counted, via the live-lead fallback');
    TestAssertEqual_(dchByRegionWithLive['Hyderabad'].opp48h, 1, 'computeDailyCohortByRegionGs_: the live-only lead\'s CURRENT status is used as evidence, since Movement_Log has nothing at all for it');

    const dchArchiveSs = TestMockSpreadsheet_({});
    upsertDailyCohortHistoryRowsGs_(dchArchiveSs, [
      { date: '2026-08-24', region: 'Pune', stats: dchByRegion['Pune'] },
      { date: '2026-08-24', region: 'Loan', stats: dchByRegion['Loan'] },
    ], dchNow);
    const dchSheet = dchArchiveSs.getSheetByName('Daily_Cohort_History');
    TestAssert_(!!dchSheet, 'upsertDailyCohortHistoryRowsGs_: creates the Daily_Cohort_History sheet on first write');
    TestAssertEqual_(dchSheet.getRange(1, 1, 1, DAILY_COHORT_HISTORY_COLUMNS_.length).getValues()[0], DAILY_COHORT_HISTORY_COLUMNS_, 'upsertDailyCohortHistoryRowsGs_: header matches the browser writer\'s DAILY_COHORT_HISTORY_COLUMNS_ schema exactly');
    TestAssertEqual_(dchSheet.getLastRow(), 3, 'upsertDailyCohortHistoryRowsGs_: header + 2 data rows');
    const dchKeysAfterInsert = dchSheet.getRange(2, 1, 2, 1).getValues().map(function (r) { return r[0]; }).sort();
    TestAssertEqual_(dchKeysAfterInsert, ['2026-08-24|Loan', '2026-08-24|Pune'], 'upsertDailyCohortHistoryRowsGs_: date_region key format matches "date|region"');

    // Re-run with an UPDATED Pune stat — must update in place, not duplicate.
    upsertDailyCohortHistoryRowsGs_(dchArchiveSs, [
      { date: '2026-08-24', region: 'Pune', stats: Object.assign({}, dchByRegion['Pune'], { created: 9 }) },
    ], dchNow);
    TestAssertEqual_(dchSheet.getLastRow(), 3, 'upsertDailyCohortHistoryRowsGs_: re-running with an existing date+region key updates in place, never duplicates a row');
    const dchUpdatedRows = dchSheet.getRange(2, 1, 2, DAILY_COHORT_HISTORY_COLUMNS_.length).getValues();
    const dchPuneRow = dchUpdatedRows.filter(function (r) { return r[0] === '2026-08-24|Pune'; })[0];
    TestAssertEqual_(dchPuneRow[3], 9, 'upsertDailyCohortHistoryRowsGs_: the created-count column is actually overwritten on update');
    const dchLoanRow = dchUpdatedRows.filter(function (r) { return r[0] === '2026-08-24|Loan'; })[0];
    TestAssertEqual_(dchLoanRow[3], 1, 'upsertDailyCohortHistoryRowsGs_: updating one key leaves an unrelated existing row untouched');

    // ---- persistDailyCohortHistoryGs_: full orchestrator, end to end ----
    const dchOrchestratorSs = TestMockSpreadsheet_({
      'Movement_Log': TestMockSheet_('Movement_Log', [movementLogHeader].concat(dchMovementRows)),
    });
    persistDailyCohortHistoryGs_(dchOrchestratorSs, [], {}, dchNow);
    const dchArchiveSheet = dchOrchestratorSs.getSheetByName('Daily_Cohort_History');
    TestAssert_(!!dchArchiveSheet, 'persistDailyCohortHistoryGs_: creates and writes Daily_Cohort_History end to end from a Movement_Log-only spreadsheet');
    TestAssertEqual_(dchArchiveSheet.getLastRow(), 3, 'persistDailyCohortHistoryGs_: one header + Pune + Loan rows for the single eligible date');
    const dchArchiveKeys = dchArchiveSheet.getRange(2, 1, 2, 1).getValues().map(function (r) { return r[0]; }).sort();
    TestAssertEqual_(dchArchiveKeys, ['2026-08-24|Loan', '2026-08-24|Pune'], 'persistDailyCohortHistoryGs_: writes exactly the two eligible region rows');
    TestAssertEqual_(dchArchiveSheet.getRange(2, 12, 1, 1).getValue(), 'AppsScript', 'persistDailyCohortHistoryGs_: source column is always "AppsScript" for a row written from here (vs. "Dashboard"/"Backfill" from the browser)');

    // ---- Write-once: an already-archived day must NEVER be recomputed/overwritten ----
    // Capture Aug 24's updated_at from the first run above, then re-run
    // persistDailyCohortHistoryGs_ against the SAME Movement_Log data but a
    // LATER `now` (2026-09-03) — one that also makes Aug 30 (L-B) newly
    // eligible for the first time. If Aug 24 got silently recomputed here,
    // its updated_at would change even though nothing about its own
    // evidence should ever be touched again; Aug 30 SHOULD get written,
    // since that date has no archived row yet (genuine self-healing, not
    // re-touching an already-final one).
    const dchAug24UpdatedAtBefore = dchArchiveSheet.getRange(2, 11, 1, 1).getValue();
    const dchLaterNow = new Date('2026-09-03T12:00:00+05:30');
    persistDailyCohortHistoryGs_(dchOrchestratorSs, [], {}, dchLaterNow);
    TestAssertEqual_(dchArchiveSheet.getLastRow(), 4, 'persistDailyCohortHistoryGs_ (write-once): a later run only ADDS the newly-eligible Aug 30 row — Aug 24\'s existing rows are not duplicated or removed');
    const dchRowsAfterLaterRun = dchArchiveSheet.getRange(2, 1, 3, DAILY_COHORT_HISTORY_COLUMNS_.length).getValues();
    const dchAug24RowAfter = dchRowsAfterLaterRun.filter(function (r) { return r[0] === '2026-08-24|Pune'; })[0];
    TestAssertEqual_(dchAug24RowAfter[10], dchAug24UpdatedAtBefore, 'persistDailyCohortHistoryGs_ (write-once): Aug 24\'s updated_at is UNCHANGED after the later run — it was never recomputed, let alone overwritten');
    const dchAug30Row = dchRowsAfterLaterRun.filter(function (r) { return r[0] === '2026-08-30|Thane'; })[0];
    TestAssert_(!!dchAug30Row, 'persistDailyCohortHistoryGs_ (write-once): Aug 30 — a genuinely NEW eligible date — is still written the first time it becomes eligible (self-healing for gaps still works)');
    if (dchAug30Row) TestAssertEqual_(dchAug30Row[3], 1, 'persistDailyCohortHistoryGs_ (write-once): the new Aug 30 row carries correct, freshly-computed stats');

    // ---- Error containment: a Daily_Cohort_History failure must never block the core Movement_Log capture ----
    const containmentLeadsHeader = TestFixture_leadsHeader_();
    const containmentBannerRow = containmentLeadsHeader.map(function () { return ''; });
    function containmentLeadRow(overrides) {
      const defaults = {
        lead_id: 'L-CT', client_id: 'C-CT', RM: 'Test RM One', TL: 'Test A1 One', project: 'P', region: 'Test Region',
        client: 'Client', lead_assigned_at: dchNow, group_source: 'google', source_bucket: 'Non-UTM',
        current_stage: 'Suspect', rm_is_active: true, call_attempts: 1,
      };
      const merged = Object.assign({}, defaults, overrides || {});
      return containmentLeadsHeader.map(function (k) { return merged[k] !== undefined ? merged[k] : ''; });
    }
    const containmentMonthShort = Utilities.formatDate(dchNow, 'Asia/Kolkata', 'MMM');
    const containmentLeadsSheet = TestMockSheet_(containmentMonthShort, [containmentBannerRow, containmentLeadsHeader, containmentLeadRow({})]);
    const containmentSs = TestMockSpreadsheet_({});
    containmentSs._sheets[containmentMonthShort] = containmentLeadsSheet;

    const containmentRealSpreadsheetApp = SpreadsheetApp;
    SpreadsheetApp = { getActiveSpreadsheet: function () { return containmentSs; }, flush: function () {} };
    const realPersistDailyCohortHistoryGs_ = persistDailyCohortHistoryGs_;
    persistDailyCohortHistoryGs_ = function () { throw new Error('simulated Daily_Cohort_History failure'); };
    try {
      snapshotOpenLeads_('containment test');
      const containmentMovementLog = containmentSs.getSheetByName('Movement_Log');
      TestAssert_(!!containmentMovementLog && containmentMovementLog.getLastRow() === 2, 'snapshotOpenLeads_: a persistDailyCohortHistoryGs_ throw still lets Movement_Log capture complete (header + 1 data row)');
    } finally {
      persistDailyCohortHistoryGs_ = realPersistDailyCohortHistoryGs_;
      SpreadsheetApp = containmentRealSpreadsheetApp;
    }
  } finally {
    TestEnv_tearDown_();
  }
  return TestResults_;
}

function runMovementTrackerTestsNow() { runMovementTrackerTests_(); }
