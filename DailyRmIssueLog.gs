/**
 * Daily RM Issue Log — a nightly (22:50 IST) snapshot of every OPEN lead
 * currently flagged for one of this dashboard's own 5 Operations SLA
 * checks (computeSlaFlags_/primaryIssueGs_, SlaEngine.gs — the SAME
 * checks Operations' own combined view and AllIssuesEmailer.gs use),
 * written one row per flagged lead: which RM, which issue, which lead.
 * Built specifically to answer "which RMs are REPEAT offenders" — not
 * from any single day's or single check's numbers (which can't tell a
 * persistent pattern from a one-off), but from accumulated day-over-day
 * history across all 5 checks at once.
 *
 * SCOPE, DELIBERATELY: only issues this dashboard already tracks (the 5
 * Operations SLA checks) — per explicit instruction, NOT contact-failure
 * rate, mixed-outcome client pairs, or cluster-head pool performance
 * (those are a separate research thread in a different project).
 *
 * DELIBERATELY NOT DEDUPED BY CUSTOMER: AllIssuesEmailer.gs/
 * OvernightEmailer.gs collapse a customer held by 2 RMs into one copy
 * before emailing (so nobody gets double-notified) — this log's whole
 * point is a lead-wise audit trail, so it keeps every copy exactly as it
 * appears in the source tab. A customer split across 2 RMs shows up as 2
 * rows here, correctly attributing the flagged state to EACH RM's own
 * copy.
 *
 * ============================== SETUP ==============================
 * Paste this in as its own file, alongside every other file in this
 * project (Core.gs, SlaEngine.gs, FollowupEngine.gs, EmailInfra.gs,
 * MovementTracker.gs, OvernightEmailer.gs, AllIssuesEmailer.gs,
 * RmHierarchy.gs, RmHierarchy.private.gs, UnmatchedCommentLogger.gs).
 * Run setupDailyRmIssueLog() once from the function dropdown — installs
 * the 22:50 IST daily trigger and creates the "Daily_RM_Issues" sheet
 * tab. Safe to re-run any time (clears any trigger it previously
 * installed before adding the new one, same pattern as every other
 * setupXxx in this project).
 * ================================================================================
 */

const DAILY_RM_ISSUE_LOG_SHEET_ = 'Daily_RM_Issues';
const DAILY_RM_ISSUE_LOG_COLUMNS_ = [
  'date', 'RM', 'region', 'project', 'lead_id', 'client_id', 'issue_key', 'issue_label', 'captured_at',
  // Added 2026-09-01 for the dashboard's Repeat Offenders section — the
  // browser-side leaderboard needs to honor the SAME top-bar Project/
  // Region/TL/Source/Bucket filters everything else does, and this log
  // never carried TL/source/bucket before now. Appended at the end, not
  // inserted — see ensureDailyRmIssueLogSheet_'s self-healing header
  // below on why order matters (same reasoning as
  // MovementTracker.gs's SNAPSHOT_COLUMNS_).
  'TL', 'group_source', 'source_bucket',
  // Added 2026-09-01: date above is the CAPTURE date, not this — needed
  // to tell "flagged tonight" apart from "assigned today" (a much older
  // lead can still be flagged tonight).
  'lead_assigned_at',
];

function ensureDailyRmIssueLogSheet_(ss) {
  let sheet = ss.getSheetByName(DAILY_RM_ISSUE_LOG_SHEET_);
  if (!sheet) {
    sheet = ss.insertSheet(DAILY_RM_ISSUE_LOG_SHEET_);
    sheet.getRange(1, 1, 1, DAILY_RM_ISSUE_LOG_COLUMNS_.length).setValues([DAILY_RM_ISSUE_LOG_COLUMNS_]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  // Self-heal, same pattern as ensureMovementLogSheet_/ensureSlaHistorySheet_
  // — append whatever header columns are missing rather than requiring an
  // exact pre-built match, so a sheet created before TL/group_source/
  // source_bucket existed still ends up with every column this script
  // (and the dashboard's own fetch) expects.
  const lastCol = sheet.getLastColumn();
  const existingHeaders = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  const existingSet = {};
  existingHeaders.forEach(function (h) { existingSet[String(h || '').trim()] = true; });
  const missing = DAILY_RM_ISSUE_LOG_COLUMNS_.filter(function (h) { return !existingSet[h]; });
  if (missing.length) {
    sheet.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
  }
  return sheet;
}

/**
 * Trigger entry point (installed by setupDailyRmIssueLog — same function
 * name the trigger targets, so renaming the real body below needs no
 * trigger re-registration). Same crash-alerts-ops-then-rethrows wrapper
 * as every other unattended entry point in this project
 * (sendAllIssuesEmails, sendOvernightMorningEmails,
 * sendOvernightFollowupEmails) — a silent total failure here would mean
 * a missing night's data with no signal to anyone, and this log's whole
 * value is an unbroken day-over-day series.
 */
function captureDailyRmIssues() {
  try {
    captureDailyRmIssues_();
  } catch (e) {
    notifyOpsAlertGs_('captureDailyRmIssues crashed — tonight\'s RM issue log was NOT captured', [
      'captureDailyRmIssues threw before completing, so no rows were written for tonight.',
      'Error: ' + (e && e.stack ? e.stack : e),
    ]);
    throw e;
  }
}

function captureDailyRmIssues_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const now = new Date();
  const todayKey = istDayKeyGs_(now);

  const logSheet = ensureDailyRmIssueLogSheet_(ss);

  // Idempotency guard — same per-day pattern Overnight_Log/AllIssues_Log
  // already use: a double-fire (or a manual re-run the same night) must
  // not duplicate the night's rows.
  const priorLastRow = logSheet.getLastRow();
  if (priorLastRow >= 2) {
    const existingDates = withRetry_(function () { return logSheet.getRange(2, 1, priorLastRow - 1, 1).getValues(); }, 'read Daily_RM_Issues for idempotency check');
    const alreadyCaptured = existingDates.some(function (r) {
      const cell = r[0];
      const key = cell instanceof Date ? istDayKeyGs_(cell) : String(cell);
      return key === todayKey;
    });
    if (alreadyCaptured) {
      Logger.log('Skipping capture — Daily_RM_Issues already has rows dated today (' + todayKey + ').');
      return;
    }
  }

  const { colIndex, dataRows } = readLeadsTab_(ss);
  const movementMaps = withRetry_(function () { return buildMovementLogMapsGs_(ss, now); }, 'buildMovementLogMapsGs_');
  const baselineMap = movementMaps.baselineMap;

  const captureAtValue = Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss');
  const rows = [];
  dataRows.forEach(function (row) {
    const leadId = String(getVal_(row, colIndex, 'lead_id') || '').trim();
    if (!leadId) return;
    const stage = String(getVal_(row, colIndex, 'current_stage') || '').trim();
    const closingReason = getVal_(row, colIndex, 'closing_reason');
    const leadClosingReason = getVal_(row, colIndex, 'lead_closing_reason');
    if (!isOpenLead_(stage, closingReason, leadClosingReason)) return; // closed — no issue to log

    const flags = computeSlaFlags_(row, colIndex, now, baselineMap);
    const issue = primaryIssueGs_(flags); // same priority order Operations' own combined view uses
    if (!issue) return; // open, in scope, but flagged for nothing right now

    const RM = String(getVal_(row, colIndex, 'RM') || '').trim() || 'Unassigned';
    rows.push([
      todayKey, RM, getVal_(row, colIndex, 'region'), getVal_(row, colIndex, 'project'),
      leadId, getVal_(row, colIndex, 'client_id'), issue.key, issue.label, captureAtValue,
      getVal_(row, colIndex, 'TL'), getVal_(row, colIndex, 'group_source'), getVal_(row, colIndex, 'source_bucket'),
      getVal_(row, colIndex, 'lead_assigned_at'),
    ]);
  });

  if (!rows.length) { Logger.log('No open leads currently flagged for any SLA issue — nothing to log tonight.'); return; }

  const startRow = logSheet.getLastRow() + 1;
  withRetry_(function () { logSheet.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows); }, 'write Daily_RM_Issues rows');
  const rmCount = new Set(rows.map(function (r) { return r[1]; })).size;
  Logger.log('Captured ' + rows.length + ' flagged lead(s) across ' + rmCount + ' RM(s) for ' + todayKey + '.');
}

function captureDailyRmIssuesNow() { captureDailyRmIssues_(); }

/**
 * One-time (or occasional) backfill: reconstructs Daily_RM_Issues for
 * every day Movement_Log still retains a snapshot for, using each day's
 * own LATEST snapshot run as the "as of" state — the closest available
 * stand-in for what the real 22:50 IST capture would have recorded,
 * since Movement_Log's 4x-daily captures (00:00/06:00/12:00/18:00 IST —
 * SNAPSHOT_HOURS_ below) never include a literal 22:50 snapshot; 18:00
 * is the closest one before it lands. Skips any day Daily_RM_Issues
 * ALREADY has rows for (the SAME per-day idempotency guard
 * captureDailyRmIssues_ itself uses), so this is always safe to re-run
 * and can never duplicate or overwrite a night the real trigger already
 * captured for real.
 *
 * KNOWN LIMITATION, narrower since 2026-09-01 — rm_is_active and
 * lead_closing_reason were added to SNAPSHOT_COLUMNS_ (MovementTracker.gs)
 * on that date, so any Movement_Log row captured FROM THEN ON carries
 * real values for both, and this function reads them dynamically (via
 * colIndex, same as every other field here) — no special-casing needed.
 * A row captured BEFORE that change has neither column at all, so for
 * any day whose latest snapshot predates it:
 *   - inactiveRmNewLead can never fire (rm_is_active reads as blank,
 *     which computeSlaFlags_ treats as "not inactive").
 *   - a lead closed ONLY via the sheet's own lead_closing_reason column
 *     (not the RM-entered closing_reason) is still counted open here,
 *     and may show up flagged for something else instead of being
 *     correctly excluded as closed.
 * Every night captureDailyRmIssues_ itself runs live (once
 * setupDailyRmIssueLog() is installed) reads the real leads tab and has
 * neither gap, regardless of date — this only ever affects days
 * reconstructed from Movement_Log history predating the column addition.
 *
 * Pure read of Movement_Log + one append to Daily_RM_Issues; never
 * touches the real leads tab. Returns
 * {daysBackfilled: [string], daysSkipped: [string], rowsWritten: number}.
 */
function backfillDailyRmIssuesFromMovementLog_(ss) {
  const logSheet = ensureDailyRmIssueLogSheet_(ss);
  const movementSheet = ss.getSheetByName(MOVEMENT_LOG_SHEET);
  if (!movementSheet) { Logger.log('Movement_Log does not exist yet — nothing to backfill.'); return { daysBackfilled: [], daysSkipped: [], rowsWritten: 0 }; }
  const lastRow = movementSheet.getLastRow();
  if (lastRow < 2) { Logger.log('Movement_Log is empty — nothing to backfill.'); return { daysBackfilled: [], daysSkipped: [], rowsWritten: 0 }; }

  const lastCol = movementSheet.getLastColumn();
  const header = movementSheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const snapAtIdx = header.indexOf('snapshot_at'); // not in HEADER_ALIASES_ — read positionally, same as _readMovementLogRowsGs_
  if (snapAtIdx === -1) { Logger.log('Movement_Log has no snapshot_at column — cannot backfill.'); return { daysBackfilled: [], daysSkipped: [], rowsWritten: 0 }; }
  const colIndex = buildColIndex_(header);

  const allRows = withRetry_(function () { return movementSheet.getRange(2, 1, lastRow - 1, lastCol).getValues(); }, 'read Movement_Log for backfill');

  // Group by IST day, keeping only each day's LATEST snapshot_at — every
  // lead captured together in one snapshotOpenLeads_ run shares that
  // exact same timestamp, so grouping on it correctly picks up the whole
  // run, not just one row.
  const latestByDay = {}; // dayKey -> { tsMs, ts, rows: [] }
  allRows.forEach(function (row) {
    const ts = row[snapAtIdx];
    if (!(ts instanceof Date)) return;
    const dayKey = istDayKeyGs_(ts);
    const tsMs = ts.getTime();
    if (!latestByDay[dayKey] || tsMs > latestByDay[dayKey].tsMs) {
      latestByDay[dayKey] = { tsMs: tsMs, ts: ts, rows: [] };
    }
  });
  allRows.forEach(function (row) {
    const ts = row[snapAtIdx];
    if (!(ts instanceof Date)) return;
    const dayKey = istDayKeyGs_(ts);
    const entry = latestByDay[dayKey];
    if (entry && ts.getTime() === entry.tsMs) entry.rows.push(row);
  });

  const alreadyCaptured = {};
  const priorLastRow = logSheet.getLastRow();
  if (priorLastRow >= 2) {
    withRetry_(function () { return logSheet.getRange(2, 1, priorLastRow - 1, 1).getValues(); }, 'read Daily_RM_Issues for backfill idempotency check')
      .forEach(function (r) {
        const cell = r[0];
        const key = cell instanceof Date ? istDayKeyGs_(cell) : String(cell);
        if (key) alreadyCaptured[key] = true;
      });
  }

  const daysBackfilled = [];
  const daysSkipped = [];
  const allNewRows = [];

  Object.keys(latestByDay).sort().forEach(function (dayKey) {
    if (alreadyCaptured[dayKey]) { daysSkipped.push(dayKey); return; }
    const entry = latestByDay[dayKey];
    const asOf = entry.ts;
    const baselineMap = withRetry_(function () { return buildMovementLogMapsGs_(ss, asOf); }, 'buildMovementLogMapsGs_ (backfill ' + dayKey + ')').baselineMap;
    const capturedAtValue = Utilities.formatDate(asOf, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss');

    let dayRowCount = 0;
    entry.rows.forEach(function (row) {
      const leadId = String(getVal_(row, colIndex, 'lead_id') || '').trim();
      if (!leadId) return;
      const stage = String(getVal_(row, colIndex, 'current_stage') || '').trim();
      const closingReason = getVal_(row, colIndex, 'closing_reason');
      // Read dynamically via colIndex, same as every other field — for a
      // row captured before 2026-09-01 (predating lead_closing_reason
      // being added to SNAPSHOT_COLUMNS_), colIndex simply won't map it
      // and this reads as '', same as explicitly passing '' used to.
      // See this function's own header note on why that's a known,
      // narrow limitation for OLDER history rather than a bug.
      const leadClosingReason = getVal_(row, colIndex, 'lead_closing_reason');
      if (!isOpenLead_(stage, closingReason, leadClosingReason)) return;

      const flags = computeSlaFlags_(row, colIndex, asOf, baselineMap);
      const issue = primaryIssueGs_(flags);
      if (!issue) return;

      const RM = String(getVal_(row, colIndex, 'RM') || '').trim() || 'Unassigned';
      allNewRows.push([
        dayKey, RM, getVal_(row, colIndex, 'region'), getVal_(row, colIndex, 'project'),
        leadId, getVal_(row, colIndex, 'client_id'), issue.key, issue.label, capturedAtValue,
        // TL/group_source/source_bucket were part of SNAPSHOT_COLUMNS_
        // from the very start (unlike rm_is_active/lead_closing_reason —
        // see this function's own header note), so every Movement_Log
        // row, old or new, already carries real values for these three.
        getVal_(row, colIndex, 'TL'), getVal_(row, colIndex, 'group_source'), getVal_(row, colIndex, 'source_bucket'),
      getVal_(row, colIndex, 'lead_assigned_at'),
      ]);
      dayRowCount++;
    });
    daysBackfilled.push(dayKey + ' (' + dayRowCount + ' flagged lead(s), as of ' + capturedAtValue + ')');
  });

  if (allNewRows.length) {
    const startRow = logSheet.getLastRow() + 1;
    withRetry_(function () { logSheet.getRange(startRow, 1, allNewRows.length, allNewRows[0].length).setValues(allNewRows); }, 'write Daily_RM_Issues backfill rows');
  }

  Logger.log('Backfilled ' + daysBackfilled.length + ' day(s) (' + allNewRows.length + ' total flagged-lead row(s)): ' + (daysBackfilled.join('; ') || '(none)'));
  if (daysSkipped.length) Logger.log('Skipped ' + daysSkipped.length + ' day(s) Daily_RM_Issues already has rows for: ' + daysSkipped.join(', '));

  return { daysBackfilled: daysBackfilled, daysSkipped: daysSkipped, rowsWritten: allNewRows.length };
}

// Console-callable (function dropdown -> Run).
function backfillDailyRmIssuesFromMovementLogNow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  backfillDailyRmIssuesFromMovementLog_(ss);
}

// How many rows go in a single Daily_RM_Issues setValues() call within
// backfillOneDayFromMovementLog_ below. captureDailyRmIssues_ itself (the
// real nightly trigger) writes its whole night in ONE call, and a real
// 2026-09-01 run took ~475s and produced zero rows for that day — a
// single oversized write is the most likely place that failed. This
// function writes the SAME kind of data but in bounded chunks instead:
// if one chunk fails, everything before it is already durably saved
// rather than losing the whole day to one call.
const BACKFILL_CHUNK_SIZE_ = 5000;

/**
 * Backfills Daily_RM_Issues for exactly ONE missed day (real 2026-09-01
 * incident: the 22:50 IST trigger ran for ~475s but wrote zero rows for
 * that night), from Movement_Log's LATEST retained snapshot that falls on
 * that IST calendar day — same "closest available stand-in for the real
 * 22:50 capture" reasoning as backfillDailyRmIssuesFromMovementLog_
 * above, and the same per-day idempotency guard (skips and returns
 * {skipped:true} if Daily_RM_Issues already has rows for dayKey).
 *
 * Deliberately narrower than backfillDailyRmIssuesFromMovementLog_,
 * rather than just calling it: that function sweeps and writes EVERY
 * day Movement_Log still retains in one combined pass — fine for a
 * one-time historical rebuild, but overkill (and higher blast radius)
 * for "last night's trigger looks like it missed, catch up just that
 * one night." This only ever reads and writes the ONE day asked for.
 *
 * TIME-SENSITIVE, same as the multi-day version: Movement_Log only
 * retains 7 days, so dayKey needs to still be within that window.
 *
 * Returns {rowsWritten: number, skipped: boolean}.
 */
function backfillOneDayFromMovementLog_(ss, dayKey) {
  const logSheet = ensureDailyRmIssueLogSheet_(ss);

  const priorLastRow = logSheet.getLastRow();
  if (priorLastRow >= 2) {
    const alreadyCaptured = withRetry_(function () { return logSheet.getRange(2, 1, priorLastRow - 1, 1).getValues(); }, 'read Daily_RM_Issues for single-day backfill idempotency check')
      .some(function (r) {
        const cell = r[0];
        const key = cell instanceof Date ? istDayKeyGs_(cell) : String(cell);
        return key === dayKey;
      });
    if (alreadyCaptured) {
      Logger.log('Skipping ' + dayKey + ' — Daily_RM_Issues already has rows for that day.');
      return { rowsWritten: 0, skipped: true };
    }
  }

  const movementSheet = ss.getSheetByName(MOVEMENT_LOG_SHEET);
  if (!movementSheet) { Logger.log('Movement_Log does not exist — cannot backfill ' + dayKey + '.'); return { rowsWritten: 0, skipped: false }; }
  const mLastRow = movementSheet.getLastRow();
  if (mLastRow < 2) { Logger.log('Movement_Log is empty — cannot backfill ' + dayKey + '.'); return { rowsWritten: 0, skipped: false }; }
  const mLastCol = movementSheet.getLastColumn();
  const mHeader = withRetry_(function () { return movementSheet.getRange(1, 1, 1, mLastCol).getValues()[0]; }, 'read Movement_Log header for single-day backfill');
  const snapAtIdx = mHeader.indexOf('snapshot_at'); // not in HEADER_ALIASES_ — read positionally, same as every other Movement_Log reader
  if (snapAtIdx === -1) { Logger.log('Movement_Log has no snapshot_at column — cannot backfill.'); return { rowsWritten: 0, skipped: false }; }
  const colIndex = buildColIndex_(mHeader);
  const allRows = withRetry_(function () { return movementSheet.getRange(2, 1, mLastRow - 1, mLastCol).getValues(); }, 'read Movement_Log for single-day backfill');

  // This day's LATEST snapshot_at only — same "one snapshotOpenLeads_ run
  // shares one exact timestamp" grouping backfillDailyRmIssuesFromMovementLog_
  // uses, just scoped to one day instead of every day at once.
  let latestTs = null;
  allRows.forEach(function (row) {
    const ts = row[snapAtIdx];
    if (!(ts instanceof Date) || istDayKeyGs_(ts) !== dayKey) return;
    if (!latestTs || ts.getTime() > latestTs.getTime()) latestTs = ts;
  });
  if (!latestTs) {
    Logger.log('No Movement_Log snapshot found for ' + dayKey + ' — it may already have aged out of the 7-day retention window.');
    return { rowsWritten: 0, skipped: false };
  }
  const latestRows = allRows.filter(function (row) { const ts = row[snapAtIdx]; return ts instanceof Date && ts.getTime() === latestTs.getTime(); });

  const baselineMap = withRetry_(function () { return buildMovementLogMapsGs_(ss, latestTs); }, 'buildMovementLogMapsGs_ (single-day backfill ' + dayKey + ')').baselineMap;
  const capturedAtValue = Utilities.formatDate(latestTs, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss');

  const newRows = [];
  latestRows.forEach(function (row) {
    const leadId = String(getVal_(row, colIndex, 'lead_id') || '').trim();
    if (!leadId) return;
    const stage = String(getVal_(row, colIndex, 'current_stage') || '').trim();
    const closingReason = getVal_(row, colIndex, 'closing_reason');
    const leadClosingReason = getVal_(row, colIndex, 'lead_closing_reason');
    if (!isOpenLead_(stage, closingReason, leadClosingReason)) return;

    const flags = computeSlaFlags_(row, colIndex, latestTs, baselineMap);
    const issue = primaryIssueGs_(flags);
    if (!issue) return;

    const RM = String(getVal_(row, colIndex, 'RM') || '').trim() || 'Unassigned';
    newRows.push([
      dayKey, RM, getVal_(row, colIndex, 'region'), getVal_(row, colIndex, 'project'),
      leadId, getVal_(row, colIndex, 'client_id'), issue.key, issue.label, capturedAtValue,
      getVal_(row, colIndex, 'TL'), getVal_(row, colIndex, 'group_source'), getVal_(row, colIndex, 'source_bucket'),
      getVal_(row, colIndex, 'lead_assigned_at'),
    ]);
  });

  if (!newRows.length) {
    Logger.log('No open leads were flagged as of ' + dayKey + '\'s latest Movement_Log snapshot (' + capturedAtValue + ') — nothing to backfill.');
    return { rowsWritten: 0, skipped: false };
  }

  // Chunked writes — see BACKFILL_CHUNK_SIZE_'s own comment above.
  let startRow = logSheet.getLastRow() + 1;
  for (let i = 0; i < newRows.length; i += BACKFILL_CHUNK_SIZE_) {
    const chunk = newRows.slice(i, i + BACKFILL_CHUNK_SIZE_);
    withRetry_(function () { logSheet.getRange(startRow, 1, chunk.length, chunk[0].length).setValues(chunk); }, 'write single-day backfill chunk (' + dayKey + ', rows ' + i + '-' + (i + chunk.length) + ')');
    startRow += chunk.length;
  }

  Logger.log('Backfilled ' + dayKey + ': ' + newRows.length + ' flagged lead row(s), as of Movement_Log snapshot ' + capturedAtValue + '.');
  return { rowsWritten: newRows.length, skipped: false };
}

// Console-callable (function dropdown -> Run). Backfills exactly ONE day
// — defaults to YESTERDAY (IST) when called with no argument, the common
// case: "last night's 22:50 trigger looks like it missed, catch up just
// that one night." Pass an explicit "YYYY-MM-DD" (IST) to target any
// other single day Movement_Log still retains (up to 7 days back) — e.g.
// backfillOneDayFromMovementLogNow('2026-08-30'). Safe to re-run: skips
// (per-day idempotency guard) if that day already has rows.
function backfillOneDayFromMovementLogNow(dayKey) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const targetDayKey = dayKey || istDayKeyGs_(new Date(Date.now() - 24 * 3600 * 1000));
  return backfillOneDayFromMovementLog_(ss, targetDayKey);
}

/**
 * ONE-OFF REPAIR (real 2026-09-01 incident): fills in TL/group_source/
 * source_bucket for Daily_RM_Issues rows that were captured or
 * backfilled BEFORE those 3 columns were added to
 * DAILY_RM_ISSUE_LOG_COLUMNS_ — confirmed via a real screenshot of the
 * live sheet showing those 3 columns genuinely blank for the earliest
 * backfilled days, which is exactly why the dashboard's Repeat Offenders
 * section's Source/Sub-source/TL filters were zeroing everything out
 * even with real data present. Re-running
 * backfillDailyRmIssuesFromMovementLogNow() does NOT fix this on its
 * own — its per-day idempotency guard skips any day Daily_RM_Issues
 * already has rows for, which is every day currently affected.
 *
 * This is a targeted UPDATE, not a recompute: for each row with all 3
 * of TL/group_source/source_bucket blank, looks up that SAME lead_id in
 * Movement_Log and copies across just those 3 fields from whichever of
 * that lead's retained snapshots lands closest to the row's own
 * captured_at — date/RM/region/project/lead_id/client_id/issue_key/
 * issue_label/captured_at are never touched. A row with at least one of
 * the 3 already non-blank is left completely alone (treated as already
 * repaired/complete), so this is safe to re-run.
 *
 * TIME-SENSITIVE: Movement_Log only retains 7 days — a row whose lead
 * has no surviving Movement_Log entry at all (already aged out) simply
 * can't be repaired and is left blank, logged separately as
 * unresolvable rather than silently skipped. Run this as soon as
 * possible after noticing incomplete rows, before more history prunes.
 *
 * Batched as 3 whole-column writes (not one write per row), so this
 * stays fast even across tens of thousands of rows. Console-callable
 * (function dropdown -> Run).
 */
function repairDailyRmIssuesMissingFieldsNow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSheet = ss.getSheetByName(DAILY_RM_ISSUE_LOG_SHEET_);
  if (!logSheet) { Logger.log('Daily_RM_Issues does not exist yet — nothing to repair.'); return; }
  const lastRow = logSheet.getLastRow();
  if (lastRow < 2) { Logger.log('Daily_RM_Issues is empty — nothing to repair.'); return; }
  const lastCol = logSheet.getLastColumn();
  const header = withRetry_(function () { return logSheet.getRange(1, 1, 1, lastCol).getValues()[0]; }, 'read Daily_RM_Issues header for repair');
  const colIdx = {};
  DAILY_RM_ISSUE_LOG_COLUMNS_.forEach(function (h) { colIdx[h] = header.indexOf(h); });
  if (colIdx.TL === -1 || colIdx.group_source === -1 || colIdx.source_bucket === -1) {
    Logger.log('Daily_RM_Issues header is missing TL/group_source/source_bucket entirely — run captureDailyRmIssuesNow() or backfillDailyRmIssuesFromMovementLogNow() once first (either self-heals the header via ensureDailyRmIssueLogSheet_), then re-run this.');
    return;
  }
  // lead_assigned_at was added after TL/group_source/source_bucket — an
  // older sheet that hasn't self-healed yet just skips repairing this
  // one field, same as it always could for the other 3.
  const hasLeadAssignedCol = colIdx.lead_assigned_at !== -1;

  const movementSheet = ss.getSheetByName(MOVEMENT_LOG_SHEET);
  if (!movementSheet) { Logger.log('Movement_Log does not exist — cannot look up TL/group_source/source_bucket for repair.'); return; }
  const mLastRow = movementSheet.getLastRow();
  if (mLastRow < 2) { Logger.log('Movement_Log is empty — cannot repair.'); return; }
  const mLastCol = movementSheet.getLastColumn();
  const mHeader = withRetry_(function () { return movementSheet.getRange(1, 1, 1, mLastCol).getValues()[0]; }, 'read Movement_Log header for repair');
  const mColIndex = buildColIndex_(mHeader);
  const mSnapAtIdx = mHeader.indexOf('snapshot_at');
  const mRows = withRetry_(function () { return movementSheet.getRange(2, 1, mLastRow - 1, mLastCol).getValues(); }, 'read Movement_Log for repair');

  // lead_id -> every retained snapshot's {atMs, TL, group_source, source_bucket}.
  const byLeadId = {};
  mRows.forEach(function (row) {
    const leadId = String(getVal_(row, mColIndex, 'lead_id') || '').trim();
    if (!leadId) return;
    const ts = row[mSnapAtIdx];
    if (!(ts instanceof Date)) return;
    if (!byLeadId[leadId]) byLeadId[leadId] = [];
    byLeadId[leadId].push({
      atMs: ts.getTime(),
      TL: getVal_(row, mColIndex, 'TL'),
      group_source: getVal_(row, mColIndex, 'group_source'),
      source_bucket: getVal_(row, mColIndex, 'source_bucket'),
      lead_assigned_at: getVal_(row, mColIndex, 'lead_assigned_at'),
    });
  });

  const values = withRetry_(function () { return logSheet.getRange(2, 1, lastRow - 1, lastCol).getValues(); }, 'read Daily_RM_Issues for repair');
  const tlCol = [], gsCol = [], sbCol = [], laCol = [];
  let repaired = 0, unresolvable = 0, alreadyComplete = 0;

  values.forEach(function (row) {
    const tl = row[colIdx.TL], gs = row[colIdx.group_source], sb = row[colIdx.source_bucket];
    const la = hasLeadAssignedCol ? row[colIdx.lead_assigned_at] : null;
    // Checked independently — a row can have TL/group_source/source_bucket
    // already filled in (an earlier repair run) while STILL missing
    // lead_assigned_at (added later), or vice versa.
    const needsTlGsSb = !(String(tl || '').trim() || String(gs || '').trim() || String(sb || '').trim());
    const needsLa = hasLeadAssignedCol && !(la instanceof Date) && !String(la || '').trim();

    if (!needsTlGsSb && !needsLa) {
      alreadyComplete++;
      tlCol.push([tl]); gsCol.push([gs]); sbCol.push([sb]);
      if (hasLeadAssignedCol) laCol.push([la]);
      return;
    }
    const leadId = String(row[colIdx.lead_id] || '').trim();
    const candidates = byLeadId[leadId];
    if (!candidates || !candidates.length) {
      unresolvable++;
      tlCol.push([tl]); gsCol.push([gs]); sbCol.push([sb]); // leave blank — nothing to repair from
      if (hasLeadAssignedCol) laCol.push([la]);
      return;
    }
    const capturedAtRaw = row[colIdx.captured_at];
    let targetMs = null;
    if (capturedAtRaw instanceof Date) {
      targetMs = capturedAtRaw.getTime();
    } else {
      const parsed = new Date(String(capturedAtRaw || '').trim().replace(' ', 'T') + '+05:30');
      if (!isNaN(parsed.getTime())) targetMs = parsed.getTime();
    }
    let best = candidates[0];
    if (targetMs !== null) {
      let bestDiff = Math.abs(candidates[0].atMs - targetMs);
      candidates.forEach(function (c) {
        const diff = Math.abs(c.atMs - targetMs);
        if (diff < bestDiff) { bestDiff = diff; best = c; }
      });
    }
    tlCol.push([needsTlGsSb ? best.TL : tl]);
    gsCol.push([needsTlGsSb ? best.group_source : gs]);
    sbCol.push([needsTlGsSb ? best.source_bucket : sb]);
    if (hasLeadAssignedCol) laCol.push([needsLa ? best.lead_assigned_at : la]);
    repaired++;
  });

  withRetry_(function () { logSheet.getRange(2, colIdx.TL + 1, tlCol.length, 1).setValues(tlCol); }, 'write repaired TL column');
  withRetry_(function () { logSheet.getRange(2, colIdx.group_source + 1, gsCol.length, 1).setValues(gsCol); }, 'write repaired group_source column');
  withRetry_(function () { logSheet.getRange(2, colIdx.source_bucket + 1, sbCol.length, 1).setValues(sbCol); }, 'write repaired source_bucket column');
  if (hasLeadAssignedCol) {
    withRetry_(function () { logSheet.getRange(2, colIdx.lead_assigned_at + 1, laCol.length, 1).setValues(laCol); }, 'write repaired lead_assigned_at column');
  }

  Logger.log(
    'Repair done: ' + repaired + ' row(s) filled in from Movement_Log, ' + alreadyComplete +
    ' already had every field (left untouched), ' + unresolvable +
    ' could not be matched to any Movement_Log lead_id (likely already aged out of the 7-day retention window — permanently unrepairable for those specific rows).' +
    (hasLeadAssignedCol ? '' : ' (lead_assigned_at column not found — header needs to self-heal first, via captureDailyRmIssuesNow() or backfillDailyRmIssuesFromMovementLogNow().)')
  );
}

// ---- One-time setup — run this once from the editor ----
function setupDailyRmIssueLog() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'captureDailyRmIssues') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('captureDailyRmIssues')
    .timeBased()
    .atHour(22)
    .nearMinute(50)
    .everyDays(1)
    .inTimezone('Asia/Kolkata')
    .create();
  ensureDailyRmIssueLogSheet_(SpreadsheetApp.getActiveSpreadsheet());
  Logger.log('Daily RM Issue Log trigger installed — captures every open, SLA-flagged lead nightly at 22:50 IST into "' + DAILY_RM_ISSUE_LOG_SHEET_ + '".');
}

/**
 * Aggregates the accumulated Daily_RM_Issues log per RM over the last
 * `sinceDaysBack` days (default 14): distinct days flagged, distinct
 * issue types flagged, total flagged-lead-instances, and a breakdown by
 * issue. "Repeat offender" here means showing up repeatedly ACROSS this
 * dashboard's own 5 issue checks over MULTIPLE DAYS — not a one-off
 * single-day, single-check blip. Sorted by distinctDays, then
 * distinctIssueTypes, then totalInstances, so the most persistent AND
 * broadest pattern rises to the top — high distinctDays alone just means
 * "keeps coming back for the same thing"; high distinctIssueTypes too
 * means "broad dysfunction, not one specific check."
 *
 * The log only has data from whenever setupDailyRmIssueLog() was first
 * run, so `sinceDaysBack` naturally shrinks to whatever's actually
 * accumulated — this needs at least a few nights of captures before the
 * distinction between "repeat" and "one-off" means anything at all.
 *
 * Pure read, no writes. Returns [{RM, distinctDays, distinctIssueTypes,
 * totalInstances, byIssue}], most persistent/broadest first.
 */
function computeRepeatOffenderRmsGs_(ss, opts) {
  const sheet = ss.getSheetByName(DAILY_RM_ISSUE_LOG_SHEET_);
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const sinceDaysBack = (opts && opts.sinceDaysBack) || 14;
  const cutoffMs = Date.now() - sinceDaysBack * 24 * 3600 * 1000;

  const values = sheet.getRange(2, 1, lastRow - 1, DAILY_RM_ISSUE_LOG_COLUMNS_.length).getValues();
  const byRM = {};
  values.forEach(function (row) {
    const dateCell = row[0];
    const dateKey = dateCell instanceof Date ? istDayKeyGs_(dateCell) : String(dateCell || '').trim();
    if (!dateKey) return;
    const dateMs = new Date(dateKey + 'T00:00:00+05:30').getTime();
    if (isNaN(dateMs) || dateMs < cutoffMs) return;

    const rm = String(row[1] || '').trim() || 'Unassigned';
    const issueKey = String(row[6] || '').trim();
    if (!byRM[rm]) byRM[rm] = { RM: rm, days: {}, issueTypes: {}, byIssue: {}, totalInstances: 0 };
    const b = byRM[rm];
    b.days[dateKey] = true;
    b.issueTypes[issueKey] = true;
    b.byIssue[issueKey] = (b.byIssue[issueKey] || 0) + 1;
    b.totalInstances++;
  });

  return Object.keys(byRM).map(function (rm) {
    const b = byRM[rm];
    return {
      RM: rm,
      distinctDays: Object.keys(b.days).length,
      distinctIssueTypes: Object.keys(b.issueTypes).length,
      totalInstances: b.totalInstances,
      byIssue: b.byIssue,
    };
  }).sort(function (a, b) {
    if (b.distinctDays !== a.distinctDays) return b.distinctDays - a.distinctDays;
    if (b.distinctIssueTypes !== a.distinctIssueTypes) return b.distinctIssueTypes - a.distinctIssueTypes;
    return b.totalInstances - a.totalInstances;
  });
}

// Console-callable (function dropdown -> Run) — logs
// computeRepeatOffenderRmsGs_'s result in a readable form. Needs at
// least a few nights of Daily_RM_Issues data to show a meaningful
// pattern — a single night's capture alone can't distinguish a repeat
// offender from a one-off.
function reportRepeatOffenderRmsNow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const results = computeRepeatOffenderRmsGs_(ss, {});
  if (!results.length) {
    Logger.log('No Daily_RM_Issues data yet — run captureDailyRmIssuesNow() at least once (or wait for tonight\'s 22:50 IST trigger), then check back after a few nights.');
    return;
  }

  Logger.log(results.length + ' RM(s) with at least one flagged lead in the last 14 days, most persistent/broadest first:');
  results.slice(0, 30).forEach(function (r) {
    const issueBreakdown = Object.keys(r.byIssue).sort(function (a, b) { return r.byIssue[b] - r.byIssue[a]; })
      .map(function (k) { return k + ': ' + r.byIssue[k]; }).join(', ');
    Logger.log('  ' + r.RM + ' — ' + r.distinctDays + ' day(s), ' + r.distinctIssueTypes + ' issue type(s), ' + r.totalInstances + ' total flagged instance(s) — [' + issueBreakdown + ']');
  });
  Logger.log('Read this as: high distinctDays = persistent (keeps coming back), high distinctIssueTypes = broad (not just one specific check) — both together is the strongest signal of a genuine, consistent pattern rather than a one-off.');
}
