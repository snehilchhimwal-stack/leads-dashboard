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

  const monthShort = 'leads'; // fixed tab name (no longer month-based) — see Core.gs's resolveTabName_
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

    // ---- _leadContentHashGs_ / Utilities.computeDigest: correctness
    // against real, external NIST SHA-256 test vectors, not just "the
    // mock doesn't crash" — a subtly-wrong hash implementation would
    // still pass every OTHER dedup test below (both writers would agree
    // with themselves consistently) while being silently wrong. ----
    const sha256Empty = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, '');
    const sha256EmptyHex = sha256Empty.map(function (b) { return (b < 0 ? b + 256 : b).toString(16).padStart(2, '0'); }).join('');
    TestAssertEqual_(sha256EmptyHex, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Utilities.computeDigest (test shim): SHA-256 of the empty string matches the standard NIST test vector');
    const sha256Abc = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'abc');
    const sha256AbcHex = sha256Abc.map(function (b) { return (b < 0 ? b + 256 : b).toString(16).padStart(2, '0'); }).join('');
    TestAssertEqual_(sha256AbcHex, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'Utilities.computeDigest (test shim): SHA-256 of "abc" matches the standard NIST test vector');

    // ---- snapshotOpenLeads_: writes rows, skips blank lead_id, triggers SLA_History ----
    snapshotOpenLeads_('test snapshot label');
    const afterSnap = ss.getSheetByName('Movement_Log');
    TestAssertEqual_(afterSnap.getLastRow(), 3, 'snapshotOpenLeads_: writes exactly 2 data rows (3 total incl. header) — the blank-lead_id row is correctly skipped, and the FIRST capture of a lead always writes (no prior hash to compare against)');
    const slaHistory = ss.getSheetByName('SLA_History');
    TestAssert_(!!slaHistory && slaHistory.getLastRow() === 2, 'snapshotOpenLeads_: also writes exactly one SLA_History row (header + 1) via writeSlaHistorySnapshot_');
    const afterFirstHeader = afterSnap.getRange(1, 1, 1, afterSnap.getLastColumn()).getValues()[0];
    TestAssertContains_(afterFirstHeader.join(','), 'content_hash', 'snapshotOpenLeads_: Movement_Log\'s header now includes the trailing content_hash column');
    const afterFirstRows = afterSnap.getRange(2, 1, 2, afterSnap.getLastColumn()).getValues();
    TestAssert_(afterFirstRows.every(function (r) { return typeof r[r.length - 1] === 'string' && r[r.length - 1].length === 64; }), 'snapshotOpenLeads_: every written row carries a real 64-char SHA-256 hex content_hash, not blank');

    // ---- Content-hash dedup (Lead History & Versioning Review, Phase 6)
    // — the exact gap Phase 1 of that review found: NO existing test
    // covered "capture the same lead twice with no changes". ----
    snapshotOpenLeads_('test snapshot label — repeat, unchanged');
    TestAssertEqual_(afterSnap.getLastRow(), 3, 'snapshotOpenLeads_ (dedup): an immediate repeat capture with NO field changes writes ZERO new Movement_Log rows — still header + 2, not header + 4');
    const runsAfterUnchanged = ss.getSheetByName('Movement_Log_Runs');
    TestAssert_(!!runsAfterUnchanged, 'snapshotOpenLeads_ (dedup): Movement_Log_Runs is created automatically on first use');
    TestAssertEqual_(runsAfterUnchanged.getLastRow(), 3, 'snapshotOpenLeads_ (dedup): Movement_Log_Runs still gets a new row for the unchanged run (header + 2 runs so far) — "a capture happened" stays recorded independently of whether any lead\'s content changed, the exact separation Phase 2 of the review found missing');
    const unchangedRunRow = runsAfterUnchanged.getRange(3, 1, 1, MOVEMENT_LOG_RUNS_COLUMNS_.length).getValues()[0];
    TestAssertEqual_(unchangedRunRow[2], 2, 'snapshotOpenLeads_ (dedup): Movement_Log_Runs.lead_count_seen counts both real leads (blank lead_id already excluded)');
    TestAssertEqual_(unchangedRunRow[3], 0, 'snapshotOpenLeads_ (dedup): Movement_Log_Runs.leads_changed is 0 for a genuinely unchanged run');

    // Now change ONE field on L-1 (current_stage) and capture again —
    // exactly one new Movement_Log row for L-1, L-2 still not duplicated.
    leadsSheet.getRange(3, 1, 1, leadsHeader.length).setValues([leadRow({ current_stage: 'Prospect' })]);
    snapshotOpenLeads_('test snapshot label — one field changed');
    TestAssertEqual_(afterSnap.getLastRow(), 4, 'snapshotOpenLeads_ (dedup): a real field change on one lead (L-1: Suspect -> Prospect) writes exactly ONE new row — L-2 (unchanged) still does not get a duplicate');
    const newestRow = afterSnap.getRange(4, 1, 1, afterSnap.getLastColumn()).getValues()[0];
    const stageColIdx = 2 + SNAPSHOT_COLUMNS_.indexOf('current_stage'); // +2 for snapshot_at/snapshot_label, 1-indexed
    TestAssertEqual_(newestRow[stageColIdx], 'Prospect', 'snapshotOpenLeads_ (dedup): the new row carries the CHANGED value, not the old one');
    const firstRowHash = afterFirstRows[0][afterFirstRows[0].length - 1];
    TestAssert_(newestRow[newestRow.length - 1] !== firstRowHash, 'snapshotOpenLeads_ (dedup): the changed row\'s content_hash differs from the lead\'s original hash');
    const runsAfterChanged = runsAfterUnchanged.getRange(4, 1, 1, MOVEMENT_LOG_RUNS_COLUMNS_.length).getValues()[0];
    TestAssertEqual_(runsAfterChanged[3], 1, 'snapshotOpenLeads_ (dedup): Movement_Log_Runs.leads_changed correctly reports 1 for this run');

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
    const containmentMonthShort = 'leads'; // fixed tab name (no longer month-based) — see Core.gs's resolveTabName_
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

    // ---- checkMovementLogFreshness_: capture-freshness check (CHECKLIST-005,
    // 2026-09-09; updated Phase 6 of the Lead History & Versioning Review
    // to read Movement_Log_Runs instead of Movement_Log itself — see that
    // function's own header comment for why the switch was necessary) ----
    const freshnessNow = new Date('2026-09-09T12:00:00+05:30');
    function freshnessRunRow(runAt) {
      return [runAt, 'freshness test', 5, 0];
    }

    const missingLogSs = TestMockSpreadsheet_({});
    TestAssertEqual_(checkMovementLogFreshness_(missingLogSs, freshnessNow).status, 'missing', 'checkMovementLogFreshness_: reports "missing" when Movement_Log_Runs does not exist yet');

    const emptyLogSs = TestMockSpreadsheet_({ 'Movement_Log_Runs': TestMockSheet_('Movement_Log_Runs', [MOVEMENT_LOG_RUNS_COLUMNS_]) });
    TestAssertEqual_(checkMovementLogFreshness_(emptyLogSs, freshnessNow).status, 'empty', 'checkMovementLogFreshness_: reports "empty" for a Movement_Log_Runs with only a header row');

    // 2h ago — well inside the 8h grace window.
    const freshTs = new Date(freshnessNow.getTime() - 2 * 3600000);
    const freshLogSs = TestMockSpreadsheet_({ 'Movement_Log_Runs': TestMockSheet_('Movement_Log_Runs', [MOVEMENT_LOG_RUNS_COLUMNS_, freshnessRunRow(freshTs)]) });
    const freshResult = checkMovementLogFreshness_(freshLogSs, freshnessNow);
    TestAssertEqual_(freshResult.status, 'fresh', 'checkMovementLogFreshness_: a 2h-old last run is reported fresh (within the 8h grace window)');
    TestAssert_(Math.abs(freshResult.ageHours - 2) < 0.01, 'checkMovementLogFreshness_: ageHours is correctly computed for the fresh case');

    // 10h ago — past the 8h grace window, one missed [0,6,12,18] cycle.
    const staleTs = new Date(freshnessNow.getTime() - 10 * 3600000);
    const staleLogSs = TestMockSpreadsheet_({ 'Movement_Log_Runs': TestMockSheet_('Movement_Log_Runs', [MOVEMENT_LOG_RUNS_COLUMNS_, freshnessRunRow(staleTs)]) });
    TestAssertEqual_(checkMovementLogFreshness_(staleLogSs, freshnessNow).status, 'stale', 'checkMovementLogFreshness_: a 10h-old last run is reported stale (past the 8h grace window) — critically, this must fire even when every lead in that run was unchanged (leads_changed=0), which is exactly the case the review\'s Phase 2 found the OLD Movement_Log-based check would have silently misreported as stale-looking-fine or vice versa');

    // A non-Date value in the run_at cell — corrupted/hand-edited row.
    const unreadableLogSs = TestMockSpreadsheet_({ 'Movement_Log_Runs': TestMockSheet_('Movement_Log_Runs', [MOVEMENT_LOG_RUNS_COLUMNS_, freshnessRunRow('not a date')]) });
    TestAssertEqual_(checkMovementLogFreshness_(unreadableLogSs, freshnessNow).status, 'unreadable', 'checkMovementLogFreshness_: reports "unreadable" for a non-Date run_at cell instead of throwing');

    // Console wrapper — Logger-only output, no return value to assert on;
    // just confirm it runs against a real mocked SpreadsheetApp without throwing.
    const freshnessRealSpreadsheetApp = SpreadsheetApp;
    SpreadsheetApp = { getActiveSpreadsheet: function () { return freshLogSs; }, flush: function () {} };
    let freshnessNowThrew = null;
    try { checkMovementLogFreshnessNow(); } catch (e) { freshnessNowThrew = e; }
    SpreadsheetApp = freshnessRealSpreadsheetApp;
    TestAssertEqual_(freshnessNowThrew, null, 'checkMovementLogFreshnessNow: the console wrapper runs without throwing');

    // =====================================================================
    // Phase 7 of the Lead History & Versioning Review
    // (docs/_planning/DB_ARCHITECTURE_REVIEW.md) — real E2E validation of
    // Phase 6's content-hash dedup, run against a fresh, self-contained
    // spreadsheet across 4 sequential real captures. Covers every scenario
    // named in that phase's own checklist: new lead creation (L-NEW),
    // repeated no-change capture (L-STABLE), a single field change
    // (L-ONECHANGE), multiple fields changing together in ONE capture
    // (L-MULTICHANGE), changes spread across SEVERAL captures in
    // DIFFERENT fields (L-REPEATCHANGE), a lead disappearing from the live
    // tab (L-VANISH), and an exact-retry capture (idempotency). Real,
    // hand-verified row counts are asserted below, not assumed.
    //
    // snapshotOpenLeads_ stamps every row with the REAL wall clock
    // (`new Date()`, not injectable — see this file's own pruneMovementLog_
    // test comment on why), and Utilities.sleep is a no-op in this test
    // harness (Tests_Mocks.gs), so back-to-back calls here could otherwise
    // tie on the same millisecond and make the "latest by key" comparisons
    // this whole dedup mechanism depends on (`_latestContentHashByKeyGs_`,
    // `_collapseLatestByKeyGs_`, both strict > / >= on a Date's getTime())
    // non-deterministic. p7Tick_ below busy-waits on the REAL clock (not
    // Utilities.sleep) to force each checkpoint onto its own millisecond —
    // a real production run never needs this (captures are minutes/hours
    // apart, scheduled 4x/day — see SNAPSHOT_HOURS_), so this is a
    // test-harness-only concern, not a production gap.
    // =====================================================================
    function p7Tick_() {
      const t0 = Date.now();
      while (Date.now() === t0) { /* busy-wait for the real clock to advance by >=1ms */ }
    }

    const p7Now = new Date();
    const p7Header = TestFixture_leadsHeader_();
    const p7Banner = p7Header.map(function () { return ''; });
    function p7LeadRow(overrides) {
      const defaults = {
        lead_id: 'L-X', client_id: 'C-X', RM: 'Test RM One', TL: 'Test A1 One', project: 'P', region: 'Test Region',
        client: 'Client', lead_assigned_at: p7Now, group_source: 'google', source_bucket: 'Non-UTM',
        current_stage: 'Suspect', rm_is_active: true, call_attempts: 1,
      };
      const merged = Object.assign({}, defaults, overrides || {});
      return p7Header.map(function (k) { return merged[k] !== undefined ? merged[k] : ''; });
    }
    // Direct raw-row reconstruction, mirroring _latestContentHashByKeyGs_'s
    // own key logic (client_id, falling back to 'l:'+lead_id) — deliberately
    // NOT going through lastSnapshotBeforeGs_/buildMovementLogMapsGs_, since
    // those production helpers only ever collapse to {atMs, call_attempts}
    // (see _readMovementLogRowsGs_'s own column selection) — no existing
    // helper reconstructs an arbitrary field like current_stage as of a
    // past point in time. That's a real, honest gap to note in Phase 7's
    // findings, not something to paper over here: the raw data needed for
    // full-field reconstruction is genuinely present in Movement_Log (this
    // helper proves it), but nothing in production code wraps it yet.
    function p7StageAsOfGs_(ss, key, beforeMs) {
      const sheet = ss.getSheetByName('Movement_Log');
      if (!sheet || sheet.getLastRow() < 2) return null;
      const lastCol = sheet.getLastColumn();
      const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
      const snapAtCol = headers.indexOf('snapshot_at');
      const leadIdCol = headers.indexOf('lead_id');
      const clientIdCol = headers.indexOf('client_id');
      const stageCol = headers.indexOf('current_stage');
      const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
      let best = null;
      rows.forEach(function (row) {
        const ts = row[snapAtCol];
        if (!(ts instanceof Date) || ts.getTime() >= beforeMs) return;
        const rowKey = String(row[clientIdCol] || '').trim() || ('l:' + String(row[leadIdCol] || '').trim());
        if (rowKey !== key) return;
        if (!best || ts.getTime() > best.atMs) best = { atMs: ts.getTime(), stage: row[stageCol] };
      });
      return best ? best.stage : null;
    }

    const phase7Ss = TestMockSpreadsheet_({});
    const p7RealSpreadsheetApp = SpreadsheetApp;
    SpreadsheetApp = { getActiveSpreadsheet: function () { return phase7Ss; }, flush: function () {} };
    try {
      // ---- Capture 1: L-STABLE, L-ONECHANGE, L-MULTICHANGE,
      // L-REPEATCHANGE, L-VANISH all present for the first time — every
      // one of them must write (no prior hash exists yet). L-NEW is
      // deliberately absent (the "new lead created mid-sequence" case). ----
      const p7Capture1Rows = [p7Banner, p7Header,
        p7LeadRow({ lead_id: 'L-STABLE', client_id: 'C-STABLE', call_attempts: 2 }),
        p7LeadRow({ lead_id: 'L-ONECHANGE', client_id: 'C-ONECHANGE', lead_assigned_at: TestFixture_hoursAgo_(p7Now, 60), current_stage: 'Suspect' }),
        p7LeadRow({ lead_id: 'L-MULTICHANGE', client_id: 'C-MULTICHANGE', current_stage: 'Suspect', RM: 'Test RM One' }),
        p7LeadRow({ lead_id: 'L-REPEATCHANGE', client_id: 'C-REPEATCHANGE', call_attempts: 1, current_stage: 'Suspect' }),
        p7LeadRow({ lead_id: 'L-VANISH', client_id: 'C-VANISH', current_stage: 'Suspect' }),
      ];
      phase7Ss._sheets['leads'] = TestMockSheet_('leads', p7Capture1Rows);
      p7Tick_();
      snapshotOpenLeads_('phase7 capture 1 of 4 — initial');
      const p7Log = phase7Ss.getSheetByName('Movement_Log');
      const p7Runs = phase7Ss.getSheetByName('Movement_Log_Runs');
      TestAssertEqual_(p7Log.getLastRow(), 1 + 5, 'Phase 7 capture 1: 5 leads, all first-seen -> 5 new Movement_Log rows (header + 5)');
      TestAssertEqual_(p7Runs.getLastRow(), 1 + 1, 'Phase 7 capture 1: Movement_Log_Runs gets its first row (header + 1)');
      let p7RunRow = p7Runs.getRange(2, 1, 1, MOVEMENT_LOG_RUNS_COLUMNS_.length).getValues()[0];
      TestAssertEqual_(p7RunRow[2], 5, 'Phase 7 capture 1: lead_count_seen = 5');
      TestAssertEqual_(p7RunRow[3], 5, 'Phase 7 capture 1: leads_changed = 5 (every lead is new)');

      // ---- Capture 2: L-NEW appears for the first time; L-REPEATCHANGE's
      // call_attempts changes (1 -> 3); L-VANISH is still present and
      // unchanged; every other lead is unchanged. ----
      p7Tick_();
      const p7Capture2Rows = [p7Banner, p7Header,
        p7LeadRow({ lead_id: 'L-STABLE', client_id: 'C-STABLE', call_attempts: 2 }),
        p7LeadRow({ lead_id: 'L-ONECHANGE', client_id: 'C-ONECHANGE', lead_assigned_at: TestFixture_hoursAgo_(p7Now, 60), current_stage: 'Suspect' }),
        p7LeadRow({ lead_id: 'L-MULTICHANGE', client_id: 'C-MULTICHANGE', current_stage: 'Suspect', RM: 'Test RM One' }),
        p7LeadRow({ lead_id: 'L-REPEATCHANGE', client_id: 'C-REPEATCHANGE', call_attempts: 3, current_stage: 'Suspect' }),
        p7LeadRow({ lead_id: 'L-VANISH', client_id: 'C-VANISH', current_stage: 'Suspect' }),
        p7LeadRow({ lead_id: 'L-NEW', client_id: 'C-NEW', call_attempts: 5, current_stage: 'Suspect' }),
      ];
      phase7Ss._sheets['leads'] = TestMockSheet_('leads', p7Capture2Rows);
      snapshotOpenLeads_('phase7 capture 2 of 4 — L-NEW appears, L-REPEATCHANGE.call_attempts changes');
      TestAssertEqual_(p7Log.getLastRow(), 1 + 7, 'Phase 7 capture 2: only L-NEW (new) and L-REPEATCHANGE (real change) write -> 2 new rows (header + 7 total)');
      TestAssertEqual_(p7Runs.getLastRow(), 1 + 2, 'Phase 7 capture 2: Movement_Log_Runs gets a 2nd row');
      p7RunRow = p7Runs.getRange(3, 1, 1, MOVEMENT_LOG_RUNS_COLUMNS_.length).getValues()[0];
      TestAssertEqual_(p7RunRow[2], 6, 'Phase 7 capture 2: lead_count_seen = 6 (L-NEW added)');
      TestAssertEqual_(p7RunRow[3], 2, 'Phase 7 capture 2: leads_changed = 2 (L-NEW + L-REPEATCHANGE) — L-STABLE/L-ONECHANGE/L-MULTICHANGE/L-VANISH correctly produced ZERO new rows');

      // ---- Point-in-time reconstruction, strictly BETWEEN captures 2 and
      // 3 — proves the dedup-aware "latest before T" walk finds the real
      // latest applicable row even though most leads only have ONE row in
      // Movement_Log at this point (their capture-1 row, never rewritten
      // since nothing changed), while L-REPEATCHANGE and L-NEW correctly
      // resolve to their capture-2 rows. ----
      p7Tick_();
      const p7TBefore3 = new Date();
      p7Tick_();

      const p7Recon = lastSnapshotBeforeGs_(phase7Ss, p7TBefore3);
      TestAssertEqual_(p7Recon['C-REPEATCHANGE'].call_attempts, 3, 'Phase 7 reconstruction (before capture 3): L-REPEATCHANGE.call_attempts correctly resolves to its capture-2 value (3), not the stale capture-1 value (1) — proves lastSnapshotBeforeGs_ walks past the dedup gaps correctly');
      TestAssertEqual_(p7Recon['C-STABLE'].call_attempts, 2, 'Phase 7 reconstruction (before capture 3): L-STABLE resolves to its ONLY row (capture 1) even though 2 captures have happened since — dedup did not lose or corrupt it');
      TestAssertEqual_(p7Recon['C-NEW'].call_attempts, 5, 'Phase 7 reconstruction (before capture 3): L-NEW (created at capture 2) is already reconstructable, one capture after it first appeared');
      TestAssertEqual_(p7Recon['C-VANISH'].call_attempts, 1, 'Phase 7 reconstruction (before capture 3): L-VANISH resolves to its capture-1 row (its only row so far, still 2 captures before it disappears)');

      const p7StageBefore3Repeat = p7StageAsOfGs_(phase7Ss, 'C-REPEATCHANGE', p7TBefore3.getTime());
      TestAssertEqual_(p7StageBefore3Repeat, 'Suspect', 'Phase 7 reconstruction (before capture 3, raw current_stage): L-REPEATCHANGE was still "Suspect" at this point — its call_attempts had changed (capture 2) but current_stage had not yet (that happens at capture 3)');
      const p7StageBefore3OneChange = p7StageAsOfGs_(phase7Ss, 'C-ONECHANGE', p7TBefore3.getTime());
      TestAssertEqual_(p7StageBefore3OneChange, 'Suspect', 'Phase 7 reconstruction (before capture 3, raw current_stage): L-ONECHANGE has not changed yet');

      // ---- Capture 3: L-ONECHANGE's current_stage changes (Suspect ->
      // Prospect); L-MULTICHANGE's current_stage AND RM change TOGETHER in
      // this one capture (Suspect/Test RM One -> Opportunity/Test RM Two);
      // L-REPEATCHANGE's current_stage ALSO changes now (Suspect ->
      // Prospect, its SECOND real change, in a DIFFERENT field from
      // capture 2's), carrying its already-changed call_attempts=3 forward
      // in the same row (a written row is always the lead's FULL current
      // state, not a delta); L-VANISH is entirely removed from the live
      // tab (the "lead disappeared" case — no explicit deletion concept
      // exists in this system, a lead simply stops appearing). ----
      const p7Capture3Rows = [p7Banner, p7Header,
        p7LeadRow({ lead_id: 'L-NEW', client_id: 'C-NEW', call_attempts: 5, current_stage: 'Suspect' }),
        p7LeadRow({ lead_id: 'L-STABLE', client_id: 'C-STABLE', call_attempts: 2 }),
        p7LeadRow({ lead_id: 'L-ONECHANGE', client_id: 'C-ONECHANGE', lead_assigned_at: TestFixture_hoursAgo_(p7Now, 60), current_stage: 'Prospect' }),
        p7LeadRow({ lead_id: 'L-MULTICHANGE', client_id: 'C-MULTICHANGE', current_stage: 'Opportunity', RM: 'Test RM Two' }),
        p7LeadRow({ lead_id: 'L-REPEATCHANGE', client_id: 'C-REPEATCHANGE', call_attempts: 3, current_stage: 'Prospect' }),
      ];
      phase7Ss._sheets['leads'] = TestMockSheet_('leads', p7Capture3Rows);
      snapshotOpenLeads_('phase7 capture 3 of 4 — L-ONECHANGE/L-MULTICHANGE/L-REPEATCHANGE change, L-VANISH disappears');
      TestAssertEqual_(p7Log.getLastRow(), 1 + 10, 'Phase 7 capture 3: L-ONECHANGE, L-MULTICHANGE, L-REPEATCHANGE each write exactly ONE new row -> 3 new rows (header + 10 total); L-VANISH\'s absence writes nothing (it simply is not in dataRows)');
      TestAssertEqual_(p7Runs.getLastRow(), 1 + 3, 'Phase 7 capture 3: Movement_Log_Runs gets a 3rd row');
      p7RunRow = p7Runs.getRange(4, 1, 1, MOVEMENT_LOG_RUNS_COLUMNS_.length).getValues()[0];
      TestAssertEqual_(p7RunRow[2], 5, 'Phase 7 capture 3: lead_count_seen = 5 (L-VANISH no longer counted at all, not even as "seen but unchanged")');
      TestAssertEqual_(p7RunRow[3], 3, 'Phase 7 capture 3: leads_changed = 3');

      const p7MultiRow = p7Log.getRange(1 + 10, 1, 1, p7Log.getLastColumn()).getValues()[0];
      const p7StageColIdx = 2 + SNAPSHOT_COLUMNS_.indexOf('current_stage');
      const p7RmColIdx = 2 + SNAPSHOT_COLUMNS_.indexOf('RM');
      TestAssertEqual_(p7MultiRow[p7StageColIdx], 'Prospect', 'Phase 7 capture 3: newest row is L-REPEATCHANGE, carrying its current_stage change');
      const p7MultiChangeRowValues = p7Log.getRange(1 + 9, 1, 1, p7Log.getLastColumn()).getValues()[0];
      TestAssertEqual_(p7MultiChangeRowValues[p7StageColIdx], 'Opportunity', 'Phase 7 capture 3 (multi-field): L-MULTICHANGE\'s single new row carries the NEW current_stage');
      TestAssertEqual_(p7MultiChangeRowValues[p7RmColIdx], 'Test RM Two', 'Phase 7 capture 3 (multi-field): the SAME row also carries the NEW RM — both fields changed together landed in exactly one row, not two separate partial-update rows');

      // ---- Capture 4: an EXACT retry of capture 3's live-tab state (the
      // duplicate-ingestion / idempotency case — the closest proxy this
      // synchronous, single-threaded headless harness can offer for "the
      // scheduled trigger and the browser button firing back-to-back";
      // TRUE concurrent execution cannot be exercised here at all, since
      // neither Apps Script's real execution model nor this test harness
      // supports genuine parallelism — noted honestly rather than claimed). ----
      p7Tick_();
      const p7Capture4Rows = [p7Banner, p7Header,
        p7LeadRow({ lead_id: 'L-NEW', client_id: 'C-NEW', call_attempts: 5, current_stage: 'Suspect' }),
        p7LeadRow({ lead_id: 'L-STABLE', client_id: 'C-STABLE', call_attempts: 2 }),
        p7LeadRow({ lead_id: 'L-ONECHANGE', client_id: 'C-ONECHANGE', lead_assigned_at: TestFixture_hoursAgo_(p7Now, 60), current_stage: 'Prospect' }),
        p7LeadRow({ lead_id: 'L-MULTICHANGE', client_id: 'C-MULTICHANGE', current_stage: 'Opportunity', RM: 'Test RM Two' }),
        p7LeadRow({ lead_id: 'L-REPEATCHANGE', client_id: 'C-REPEATCHANGE', call_attempts: 3, current_stage: 'Prospect' }),
      ];
      phase7Ss._sheets['leads'] = TestMockSheet_('leads', p7Capture4Rows);
      snapshotOpenLeads_('phase7 capture 4 of 4 — exact retry / idempotency');
      TestAssertEqual_(p7Log.getLastRow(), 1 + 10, 'Phase 7 capture 4 (retry): Movement_Log is UNCHANGED — still header + 10, zero duplicate rows from the identical retry');
      TestAssertEqual_(p7Runs.getLastRow(), 1 + 4, 'Phase 7 capture 4 (retry): Movement_Log_Runs still gets a 4th row — "a run happened" is recorded even though it was a no-op retry. NOTE (real, acknowledged gap vs. the Phase 3 target schema): this Sheets implementation does NOT deduplicate the run record itself via an idempotency_key the way lead_ingestion_runs.idempotency_key would — a genuinely duplicate trigger fire records 2 run rows here, not 1. Left as-is for this pass; not a regression from Phase 6, just an honest limit of what Sheets/Apps Script can enforce without a real unique constraint.');
      p7RunRow = p7Runs.getRange(5, 1, 1, MOVEMENT_LOG_RUNS_COLUMNS_.length).getValues()[0];
      TestAssertEqual_(p7RunRow[2], 5, 'Phase 7 capture 4 (retry): lead_count_seen = 5, same as capture 3');
      TestAssertEqual_(p7RunRow[3], 0, 'Phase 7 capture 4 (retry): leads_changed = 0 — every lead in this run is bit-for-bit identical to its own latest known state, confirming the retry/idempotency case genuinely writes nothing new');

      // ---- Real row-count comparison (Phase 7's own measured numbers,
      // not the earlier illustrative examples from Phases 2/4): this exact
      // 4-capture, 6-lead scenario wrote 10 real Movement_Log data rows.
      // The OLD (pre-Phase-6) one-row-per-lead-per-capture behavior —
      // still exactly what Tests_MovementTracker.gs's own capture-1-style
      // assertions checked before Phase 6 — would have written
      // 5 + 6 + 5 + 5 = 21 rows for the same 4 captures (hand-computed
      // from this test's own known per-capture lead counts, not measured
      // against a second code path, since the old behavior no longer
      // exists to run side by side). A ~52% reduction for THIS specific
      // synthetic scenario — explicitly not a universal claim; the real
      // reduction on production data depends entirely on how often leads
      // actually change between captures. ----
      TestAssertEqual_(p7Log.getLastRow() - 1, 10, 'Phase 7: final measured Movement_Log row count for this scenario is 10 (vs. 21 under the pre-Phase-6 undeduped behavior, hand-computed from the same 5+6+5+5 per-capture lead counts asserted above)');

      // ---- L-VANISH: its last known state must remain reconstructable
      // after it disappears — a "vanished"/inactive lead's Movement_Log
      // history is never deleted, only no longer added to. ----
      const p7FarFuture = new Date(p7Now.getTime() + 365 * 86400000);
      const p7VanishFinal = lastSnapshotBeforeGs_(phase7Ss, p7FarFuture);
      TestAssert_(!!p7VanishFinal['C-VANISH'], 'Phase 7 (vanished lead): L-VANISH is STILL reconstructable after captures 3 and 4, even though it no longer appears in the live leads tab at all');
      TestAssertEqual_(p7VanishFinal['C-VANISH'].call_attempts, 1, 'Phase 7 (vanished lead): its last known call_attempts (from capture 1/2, its only real data) is preserved correctly, unchanged by later captures it was never part of');
      const p7VanishStage = p7StageAsOfGs_(phase7Ss, 'C-VANISH', p7FarFuture.getTime());
      TestAssertEqual_(p7VanishStage, 'Suspect', 'Phase 7 (vanished lead): its last known current_stage is also still correctly reconstructable from the raw Movement_Log rows');

      // ---- Nightly distillation (captureDailyRmIssues_, DailyRmIssueLog.gs)
      // against this SAME post-dedup spreadsheet — confirms it is genuinely
      // unaffected: it reads the LIVE leads tab directly (not Movement_Log)
      // for lead data, and only touches Movement_Log via
      // buildMovementLogMapsGs_ (already independently verified above, and
      // cross-checked earlier in this file to match
      // buildTodayCallBaselineGs_/lastSnapshotBeforeGs_'s own separate
      // results exactly). L-ONECHANGE was deliberately built with the same
      // "60 hours since assignment, never connected" recipe this project's
      // own Tests_DailyRmIssueLog.gs uses for its ground-truth flagged
      // fixture, so this is a real assertion, not just "did not throw". ----
      const p7ColIndex = buildColIndex_(p7Header);
      const p7OneChangeRow = p7Capture4Rows[p7Capture4Rows.length - 3]; // L-ONECHANGE's row in capture 4's fixture
      const p7ExpectedFlags = computeSlaFlags_(p7OneChangeRow, p7ColIndex, new Date(), {});
      const p7ExpectedIssue = primaryIssueGs_(p7ExpectedFlags);
      TestAssert_(!!p7ExpectedIssue, 'Phase 7 sanity: L-ONECHANGE\'s final state really is flagged for something, otherwise the distillation check below proves nothing');

      let p7DistillationThrew = null;
      try {
        captureDailyRmIssuesNow();
      } catch (e) {
        p7DistillationThrew = e;
      }
      TestAssertEqual_(p7DistillationThrew, null, 'Phase 7 (nightly distillation): captureDailyRmIssues_ runs to completion against a dedup-affected Movement_Log without throwing');
      const p7DrilSheet = phase7Ss.getSheetByName(DAILY_RM_ISSUE_LOG_SHEET_);
      TestAssert_(!!p7DrilSheet && p7DrilSheet.getLastRow() >= 2, 'Phase 7 (nightly distillation): Daily_RM_Issues gets at least one real row — L-ONECHANGE\'s flagged state was correctly captured from the LIVE leads tab');
      const p7DrilRows = p7DrilSheet.getRange(2, 1, p7DrilSheet.getLastRow() - 1, DAILY_RM_ISSUE_LOG_COLUMNS_.length).getValues();
      TestAssert_(p7DrilRows.some(function (r) { return r[4] === 'L-ONECHANGE'; }), 'Phase 7 (nightly distillation): L-ONECHANGE specifically appears in tonight\'s Daily_RM_Issues capture');
    } finally {
      SpreadsheetApp = p7RealSpreadsheetApp;
    }
  } finally {
    TestEnv_tearDown_();
  }
  return TestResults_;
}

function runMovementTrackerTestsNow() { runMovementTrackerTests_(); }
