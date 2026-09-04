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

  // Chunked writes — same BACKFILL_CHUNK_SIZE_ pattern
  // backfillOneDayFromMovementLog_ already uses, applied here to the main
  // nightly capture itself. This function scans the whole company every
  // night by design (see this file's own header), so its write is
  // comparably large every single night — a real production incident
  // (2026-09-01: a 475s run wrote zero rows, most likely a single
  // oversized setValues() call failing non-transiently) showed that a
  // one-shot write for the whole night's rows makes an all-or-nothing
  // failure the norm, not an edge case. Chunking means a failure partway
  // through loses only the rows after the failed chunk, not the entire
  // night's capture — and each chunk still gets withRetry_'s own
  // transient-error retry on top.
  let startRow = logSheet.getLastRow() + 1;
  for (let i = 0; i < rows.length; i += BACKFILL_CHUNK_SIZE_) {
    const chunk = rows.slice(i, i + BACKFILL_CHUNK_SIZE_);
    withRetry_(function () { logSheet.getRange(startRow, 1, chunk.length, chunk[0].length).setValues(chunk); }, 'write Daily_RM_Issues chunk (rows ' + i + '-' + (i + chunk.length) + ')');
    startRow += chunk.length;
  }
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
 * RM Performance — Phase 4 of the redesign (2026-09-04): a .gs mirror of
 * js/core-rm-performance.js's workload-normalized methodology, for a
 * console sanity-check leaderboard. REPLACES computeRepeatOffenderRmsGs_/
 * reportRepeatOffenderRmsNow outright (same "replace, don't keep the old
 * metric alongside" decision as Phases 2-3 on the live tab/PDF) — the old
 * "distinctDays/distinctIssueTypes/totalInstances" ranking had the exact
 * same no-real-denominator problem the whole redesign exists to fix (see
 * HANDOVER.md §9.7's "Why" section), just one level further removed: it
 * read Daily_RM_Issues, which only ever logs a VIOLATION and never a lead
 * that was eligible and passed, so it inherited the missing-denominator
 * problem structurally, the same way the old dashboard tables did.
 *
 * REUSES computeSlaFlags_ (SlaEngine.gs) for every rule's actual pass/fail
 * outcome — no rule logic is reimplemented a third time. The one thing
 * duplicated here is a ~15-line ELIGIBILITY-WINDOW derivation
 * (computeRmPerfEligibilityGs_ below) — pastGrace/isUnder48h/
 * isCreatedThatDay/hasConnected/neverConnectedPastWindow — because
 * computeSlaFlags_ computes these internally but only returns the final
 * violation booleans, not the intermediate eligibility context this
 * engine also needs. This mirrors js/core-rm-performance.js's own design
 * exactly: its RM_PERF_RULES eligibility gates are a thin layer on top of
 * enrichLead's outputs, not a re-derivation of the rules themselves — see
 * that file's own header comment for the same reasoning.
 *
 * SCOPE, DELIBERATELY NARROWER than the live tab: RM-level only, no
 * Region/A1-TM/RH rollups (those already exist, fully verified, on the
 * live dashboard — this console function's whole job is a quick sanity
 * check, not a duplicate delivery surface). Reads Movement_Log directly
 * (same 7-day retention as the browser engine, same reason: it needs the
 * PASS/FAIL denominator, not just Daily_RM_Issues' violations-only log).
 *
 * The constants immediately below MUST stay numerically identical to
 * js/core-rm-performance.js's RM_PERF_* constants — same "keep in sync"
 * discipline already established for SlaEngine.gs vs dashboard.html's
 * enrichLead (see this file's own header comment on that).
 */
const RM_PERF_RULE_WEIGHTS_GS_ = {
  isNotUpdated: 1.5, followupOverdue: 1.2, underCalledToday: 1.0, stageStuck48h: 0.8,
};
const RM_PERF_SCORED_RULE_KEYS_GS_ = Object.keys(RM_PERF_RULE_WEIGHTS_GS_);
const RM_PERF_SHRINKAGE_K_GS_ = 8;
const RM_PERF_MIN_VOLUME_LEADS_GS_ = 5;
const RM_PERF_CHRONIC_STREAK_DAYS_GS_ = 3;
const RM_PERF_FLAG_RATIO_GS_ = 1.25;
const RM_PERF_CONCENTRATION_BREADTH_CEILING_GS_ = 0.25;

// Eligibility gate + display label per rule — ported from
// js/core-rm-performance.js's RM_PERF_RULES (same keys, same conditions,
// see that file for the full per-rule rationale). inactiveRmNewLade is
// included here (for eligibility bookkeeping/routingIssueDays) but stays
// excluded from RM_PERF_SCORED_RULE_KEYS_GS_ above, so it never enters the
// composite score — a routing/assignment failure, not an RM execution one.
const RM_PERF_RULES_GS_ = [
  { key: 'inactiveRmNewLead', label: 'Inactive-RM Lead Added', eligible: function (ctx) { return ctx.isCreatedThatDay; } },
  { key: 'isNotUpdated', label: 'Not Updated', eligible: function (ctx) { return ctx.pastGrace || ctx.neverConnectedPastWindow; } },
  { key: 'followupOverdue', label: 'Follow-up Overdue', eligible: function (ctx) { return ctx.isUnder48h && ctx.pastGrace && ctx.hasConnected; } },
  { key: 'underCalledToday', label: "Behind on Today's Calls", eligible: function (ctx) { return ctx.pastGrace; } },
  { key: 'stageStuck48h', label: 'Stuck 48h+', eligible: function (ctx) { return ctx.pastGrace; } },
];

// Calendar-day difference between two "YYYY-MM-DD" istDayKeyGs_ strings —
// direct port of js/core-rm-performance.js's _rmPerfDaysBetweenKeys (pure
// Date.UTC arithmetic, noon-anchored to sidestep any DST edge case; no
// browser dependency, so this ports byte-for-byte).
function _rmPerfDaysBetweenKeysGs_(a, b) {
  const pa = a.split('-').map(Number), pb = b.split('-').map(Number);
  const da = Date.UTC(pa[0], pa[1] - 1, pa[2], 12);
  const db = Date.UTC(pb[0], pb[1] - 1, pb[2], 12);
  return Math.round((db - da) / 86400000);
}

// The eligibility-window context computeSlaFlags_ derives internally but
// doesn't expose — see this section's own header comment for why this is
// a deliberate, minimal duplication of DERIVATION (not of rule logic).
// Returns null for an undatable lead (no lead_assigned_at), same early-out
// computeSlaFlags_ itself uses.
function computeRmPerfEligibilityGs_(row, colIndex, now) {
  const createdRaw = getVal_(row, colIndex, 'lead_assigned_at');
  const created = createdRaw instanceof Date ? createdRaw : null;
  if (!created) return null;
  const ageHours = (now.getTime() - created.getTime()) / 36e5;
  const pastGrace = ageHours >= LEAD_GRACE_HOURS_;
  const isUnder48h = ageHours <= LEAD_LIFECYCLE_HOURS_;
  const isCreatedThatDay = istDayKeyGs_(created) === istDayKeyGs_(now);
  const connectTimeRaw = getVal_(row, colIndex, 'last_connect_time');
  const connectDate = connectTimeRaw instanceof Date ? connectTimeRaw : null;
  const hasConnected = !!connectDate || !!String(getVal_(row, colIndex, 'last_connect') || '').trim();
  const neverConnectedPastWindow = isUnder48h && !connectDate &&
    businessMinutesBetweenGs_(created, now) > FIRST_CONTACT_SLA_MINUTES_;
  return {
    pastGrace: pastGrace, isUnder48h: isUnder48h, isCreatedThatDay: isCreatedThatDay,
    hasConnected: hasConnected, neverConnectedPastWindow: neverConnectedPastWindow,
  };
}

/**
 * Stage 1 — walks every retained Movement_Log row, keeps the LATEST
 * snapshot per (lead_id, calendar day) [equivalent to the browser engine's
 * buildMovementHistories()+splitHistoryByCopy()+"latest that day" combined
 * — grouping by client_id first is a no-op for this purpose, since
 * splitHistoryByCopy immediately re-splits back to lead_id anyway], and
 * emits one {name, leadId, dayKey, rule, violated} record per (lead, day,
 * rule) the lead was actually ELIGIBLE for. Processed day-by-day (not
 * lead-by-lead) so buildMovementLogMapsGs_ — a full Movement_Log rescan —
 * runs once per distinct day, not once per lead, same granularity
 * backfillDailyRmIssuesFromMovementLog_ already uses for the same reason.
 * Unfiltered — no dashboard top-bar filter concept applies to a console
 * function, same as computeRepeatOffenderRmsGs_ before it.
 */
function reconstructRmPerformanceObservationsGs_(ss) {
  const observations = [];
  const movementSheet = ss.getSheetByName(MOVEMENT_LOG_SHEET);
  if (!movementSheet) return observations;
  const lastRow = movementSheet.getLastRow();
  if (lastRow < 2) return observations;
  const lastCol = movementSheet.getLastColumn();
  const header = withRetry_(function () { return movementSheet.getRange(1, 1, 1, lastCol).getValues()[0]; }, 'read Movement_Log header for RM performance reconstruction');
  const snapAtIdx = header.indexOf('snapshot_at');
  if (snapAtIdx === -1) return observations;
  const colIndex = buildColIndex_(header);
  const allRows = withRetry_(function () { return movementSheet.getRange(2, 1, lastRow - 1, lastCol).getValues(); }, 'read Movement_Log for RM performance reconstruction');

  const latestByLeadDay = {}; // "leadId|dayKey" -> {row, ts, dayKey, leadId}
  allRows.forEach(function (row) {
    const ts = row[snapAtIdx];
    if (!(ts instanceof Date)) return;
    const leadId = String(getVal_(row, colIndex, 'lead_id') || '').trim();
    if (!leadId) return;
    const dayKey = istDayKeyGs_(ts);
    const mapKey = leadId + '|' + dayKey;
    if (!latestByLeadDay[mapKey] || ts.getTime() > latestByLeadDay[mapKey].ts.getTime()) {
      latestByLeadDay[mapKey] = { row: row, ts: ts, dayKey: dayKey, leadId: leadId };
    }
  });

  const rowsByDay = {};
  Object.keys(latestByLeadDay).forEach(function (mapKey) {
    const entry = latestByLeadDay[mapKey];
    if (!rowsByDay[entry.dayKey]) rowsByDay[entry.dayKey] = [];
    rowsByDay[entry.dayKey].push(entry);
  });

  Object.keys(rowsByDay).sort().forEach(function (dayKey) {
    const entries = rowsByDay[dayKey];
    // buildMovementLogMapsGs_'s baselineMap only depends on istDayKeyGs_(now)
    // (it truncates to that day's start internally) -- any entry's own
    // timestamp is an equally valid anchor for the whole day's baseline.
    const baselineMap = withRetry_(function () { return buildMovementLogMapsGs_(ss, entries[0].ts); }, 'buildMovementLogMapsGs_ (RM performance, ' + dayKey + ')').baselineMap;

    entries.forEach(function (entry) {
      const row = entry.row;
      const stage = getVal_(row, colIndex, 'current_stage');
      const closingReason = getVal_(row, colIndex, 'closing_reason');
      const leadClosingReason = getVal_(row, colIndex, 'lead_closing_reason');
      if (!isOpenLead_(stage, closingReason, leadClosingReason)) return; // closed -- eligible for nothing

      const ctx = computeRmPerfEligibilityGs_(row, colIndex, entry.ts);
      if (!ctx) return; // undatable

      const flags = computeSlaFlags_(row, colIndex, entry.ts, baselineMap);
      const RM = String(getVal_(row, colIndex, 'RM') || '').trim() || 'Unassigned';

      RM_PERF_RULES_GS_.forEach(function (rule) {
        if (!rule.eligible(ctx)) return;
        observations.push({ name: RM, leadId: entry.leadId, dayKey: dayKey, rule: rule.key, violated: !!flags[rule.key] });
      });
    });
  });

  return observations;
}

// Stage 2 — rolls Stage 1's observations up to RM x rule: eligible/
// violation lead-day counts, distinct eligible/violated lead counts, and
// the chronic-streak signal (longest run of CONSECUTIVE-CALENDAR-DAY
// violations on any one lead). Direct port of
// js/core-rm-performance.js's aggregateRmPerformance -- same reasoning on
// why confidence for shrinkage (Stage 3) is based on DISTINCT LEADS, not
// lead-days (a lead flagged 5 nights running is 5 correlated
// observations of one problem, not 5 independent trials).
function aggregateRmPerformanceGs_(observations) {
  const byGroup = {};
  observations.forEach(function (o) {
    if (!byGroup[o.name]) byGroup[o.name] = { name: o.name, rules: {} };
    const groupEntry = byGroup[o.name];
    if (!groupEntry.rules[o.rule]) {
      groupEntry.rules[o.rule] = { eligibleDays: 0, violationDays: 0, eligibleLeads: {}, violatedLeads: {}, perLead: {} };
    }
    const r = groupEntry.rules[o.rule];
    r.eligibleDays++;
    r.eligibleLeads[o.leadId] = true;
    if (o.violated) { r.violationDays++; r.violatedLeads[o.leadId] = true; }
    if (!r.perLead[o.leadId]) r.perLead[o.leadId] = [];
    r.perLead[o.leadId].push({ dayKey: o.dayKey, violated: o.violated });
  });

  Object.keys(byGroup).forEach(function (name) {
    const groupEntry = byGroup[name];
    Object.keys(groupEntry.rules).forEach(function (ruleKey) {
      const r = groupEntry.rules[ruleKey];
      r.rate = r.eligibleDays ? r.violationDays / r.eligibleDays : 0;
      r.distinctEligibleLeads = Object.keys(r.eligibleLeads).length;
      r.distinctViolatedLeads = Object.keys(r.violatedLeads).length;

      let maxStreak = 0, chronicLeads = 0;
      Object.keys(r.perLead).forEach(function (leadId) {
        const days = r.perLead[leadId].slice().sort(function (a, b) { return a.dayKey < b.dayKey ? -1 : (a.dayKey > b.dayKey ? 1 : 0); });
        let streak = 0, best = 0, prevDayKey = null;
        days.forEach(function (d) {
          const adjacent = prevDayKey !== null && _rmPerfDaysBetweenKeysGs_(prevDayKey, d.dayKey) === 1;
          streak = d.violated ? (adjacent ? streak + 1 : 1) : 0;
          if (streak > best) best = streak;
          prevDayKey = d.dayKey;
        });
        if (best > maxStreak) maxStreak = best;
        if (best >= RM_PERF_CHRONIC_STREAK_DAYS_GS_) chronicLeads++;
      });
      r.maxStreak = maxStreak;
      r.chronicLeads = chronicLeads;
    });
  });

  return byGroup;
}

// Company-wide (every group currently in byGroup) violation rate per rule,
// weighted by lead-days. Direct port of computeRmPerfPeerAverages.
function computeRmPerfPeerAveragesGs_(byGroup) {
  const totals = {};
  Object.keys(byGroup).forEach(function (name) {
    const groupEntry = byGroup[name];
    Object.keys(groupEntry.rules).forEach(function (ruleKey) {
      const r = groupEntry.rules[ruleKey];
      if (!totals[ruleKey]) totals[ruleKey] = { violationDays: 0, eligibleDays: 0 };
      totals[ruleKey].violationDays += r.violationDays;
      totals[ruleKey].eligibleDays += r.eligibleDays;
    });
  });
  const peerAvg = {};
  Object.keys(totals).forEach(function (ruleKey) {
    peerAvg[ruleKey] = totals[ruleKey].eligibleDays ? totals[ruleKey].violationDays / totals[ruleKey].eligibleDays : 0;
  });
  return peerAvg;
}

// Stage 3+4 — shrinks each RM's per-rule rate toward the peer average
// (weighted by distinct-lead confidence), combines into one
// severity-weighted composite, and classifies. Direct port of
// classifyRmPerformance — same 4 classification branches (Insufficient
// Data / On Track / Watch — concentrated / Below Expectations), same
// thresholds (RM_PERF_*_GS_ above). Returns an array sorted by raw
// composite, most-concerning first — same as the browser engine, callers
// wanting classification-tier-first ordering should sort further (see
// sortRmPerformanceByPriorityGs_ below).
function classifyRmPerformanceGs_(byGroup) {
  const peerAvg = computeRmPerfPeerAveragesGs_(byGroup);
  let peerComposite = 0;
  RM_PERF_SCORED_RULE_KEYS_GS_.forEach(function (k) { peerComposite += RM_PERF_RULE_WEIGHTS_GS_[k] * (peerAvg[k] || 0); });

  const results = [];
  Object.keys(byGroup).forEach(function (name) {
    const groupEntry = byGroup[name];
    let composite = 0;
    const allEligibleLeads = {};
    let anyConcentrated = false;
    const perRuleOut = {};

    RM_PERF_SCORED_RULE_KEYS_GS_.forEach(function (ruleKey) {
      const r = groupEntry.rules[ruleKey];
      const eligibleDays = r ? r.eligibleDays : 0;
      const violationDays = r ? r.violationDays : 0;
      const distinctEligibleLeads = r ? r.distinctEligibleLeads : 0;
      const distinctViolatedLeads = r ? r.distinctViolatedLeads : 0;
      const rawRate = eligibleDays ? violationDays / eligibleDays : 0;
      const shrunkRate = (distinctEligibleLeads / (distinctEligibleLeads + RM_PERF_SHRINKAGE_K_GS_)) * rawRate
        + (RM_PERF_SHRINKAGE_K_GS_ / (distinctEligibleLeads + RM_PERF_SHRINKAGE_K_GS_)) * (peerAvg[ruleKey] || 0);
      const chronicLeads = r ? r.chronicLeads : 0;
      const concentrated = chronicLeads > 0 && distinctEligibleLeads > 0
        && (distinctViolatedLeads / distinctEligibleLeads) <= RM_PERF_CONCENTRATION_BREADTH_CEILING_GS_;

      composite += RM_PERF_RULE_WEIGHTS_GS_[ruleKey] * shrunkRate;
      if (r) Object.keys(r.eligibleLeads).forEach(function (id) { allEligibleLeads[id] = true; });
      if (concentrated) anyConcentrated = true;

      perRuleOut[ruleKey] = {
        eligibleDays: eligibleDays, violationDays: violationDays, distinctEligibleLeads: distinctEligibleLeads,
        distinctViolatedLeads: distinctViolatedLeads, rawRate: rawRate, shrunkRate: shrunkRate,
        maxStreak: r ? r.maxStreak : 0, chronicLeads: chronicLeads, concentrated: concentrated,
      };
    });

    const inactiveRmRule = groupEntry.rules.inactiveRmNewLead;
    const nLeads = Object.keys(allEligibleLeads).length;

    let classification;
    if (nLeads < RM_PERF_MIN_VOLUME_LEADS_GS_) classification = 'Insufficient Data';
    else if (composite <= peerComposite * RM_PERF_FLAG_RATIO_GS_) classification = 'On Track';
    else if (anyConcentrated) classification = 'Watch — concentrated';
    else classification = 'Below Expectations';

    results.push({
      name: name, distinctLeads: nLeads, composite: composite, peerComposite: peerComposite,
      rules: perRuleOut, routingIssueDays: inactiveRmRule ? inactiveRmRule.violationDays : 0,
      classification: classification,
    });
  });

  return results.sort(function (a, b) { return b.composite - a.composite; });
}

// Top-level orchestration.
function computeRmPerformanceGs_(ss) {
  const observations = reconstructRmPerformanceObservationsGs_(ss);
  const byGroup = aggregateRmPerformanceGs_(observations);
  return classifyRmPerformanceGs_(byGroup);
}

// The 1-2 scored rules actually pushing a classified result's score up,
// worst first, filtered to rules with a REAL violation (not merely a
// nonzero shrunkRate, which shrinkage gives every rule even at zero real
// violations). Direct port of rmPerformanceDrivenBy.
function rmPerformanceDrivenByGs_(r) {
  if (r.classification !== 'Below Expectations' && r.classification !== 'Watch — concentrated') return [];
  return RM_PERF_SCORED_RULE_KEYS_GS_
    .map(function (k) {
      const rule = RM_PERF_RULES_GS_.filter(function (rr) { return rr.key === k; })[0];
      return Object.assign({ key: k, weight: RM_PERF_RULE_WEIGHTS_GS_[k], label: rule ? rule.label : k }, r.rules[k]);
    })
    .filter(function (x) { return x.violationDays > 0; })
    .sort(function (a, b) { return (b.weight * b.shrunkRate) - (a.weight * a.shrunkRate); })
    .slice(0, 2);
}

// Classification tier first, composite within each tier -- direct port of
// sortRmPerformanceByPriority (classifyRmPerformanceGs_'s own return is
// only sorted by raw composite, which a shrinkage-inflated Insufficient
// Data row could otherwise outrank a real finding under).
function sortRmPerformanceByPriorityGs_(list) {
  function rank(c) { return c === 'Below Expectations' ? 0 : c === 'Watch — concentrated' ? 1 : c === 'On Track' ? 2 : 3; }
  return list.slice().sort(function (a, b) { return (rank(a.classification) - rank(b.classification)) || (b.composite - a.composite); });
}

// Console-callable (function dropdown -> Run) — the RM Performance
// leaderboard, same workload-normalized methodology as the dashboard's
// Repeat Offenders section (HANDOVER.md §9.7). Needs at least one retained
// Movement_Log snapshot day; Movement_Log's 7-day retention caps how far
// back this can ever see, same limitation totalLeadsByKey/the browser
// engine already have.
function reportRmPerformanceNow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const results = computeRmPerformanceGs_(ss);
  if (!results.length) {
    Logger.log('No Movement_Log data to compute from — needs at least one retained snapshot (Movement_Log keeps at most 7 days). Nothing to report yet.');
    return;
  }

  const sorted = sortRmPerformanceByPriorityGs_(results);
  Logger.log(sorted.length + ' RM(s) with at least one eligible lead-day in the retained Movement_Log history (up to 7 days), worst first:');
  sorted.slice(0, 40).forEach(function (r) {
    const drivenBy = rmPerformanceDrivenByGs_(r).map(function (d) {
      return d.label + ' (rate ' + Math.round(d.rawRate * 100) + '%, ' + d.distinctViolatedLeads + '/' + d.distinctEligibleLeads + ' lead(s)' + (d.concentrated ? ', concentrated' : '') + ')';
    }).join('; ');
    Logger.log('  ' + r.name + ' — ' + r.classification + ' — workload ' + r.distinctLeads + ' lead(s), score ' + r.composite.toFixed(2) + ' vs peer ' + r.peerComposite.toFixed(2) +
      (r.routingIssueDays ? ', ' + r.routingIssueDays + ' inactive-RM routing day(s) (not scored)' : '') +
      (drivenBy ? ' — driven by: ' + drivenBy : ''));
  });
  Logger.log('Same workload-normalized methodology as the dashboard\'s Repeat Offenders section (see HANDOVER.md §9.7) — Score is a severity-weighted, small-sample-adjusted composite vs. the peer average, not a raw violation count. "Insufficient Data" means fewer than ' + RM_PERF_MIN_VOLUME_LEADS_GS_ + ' distinct eligible leads — not enough evidence either way. RM-level only (no Region/A1-TM/RH rollups here — see those on the live dashboard).');
}
