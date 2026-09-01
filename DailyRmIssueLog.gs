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
const DAILY_RM_ISSUE_LOG_COLUMNS_ = ['date', 'RM', 'region', 'project', 'lead_id', 'client_id', 'issue_key', 'issue_label', 'captured_at'];

function ensureDailyRmIssueLogSheet_(ss) {
  let sheet = ss.getSheetByName(DAILY_RM_ISSUE_LOG_SHEET_);
  if (!sheet) {
    sheet = ss.insertSheet(DAILY_RM_ISSUE_LOG_SHEET_);
    sheet.getRange(1, 1, 1, DAILY_RM_ISSUE_LOG_COLUMNS_.length).setValues([DAILY_RM_ISSUE_LOG_COLUMNS_]);
    sheet.setFrozenRows(1);
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
 * KNOWN LIMITATION, by construction — Movement_Log's own captured
 * columns (SNAPSHOT_COLUMNS_, MovementTracker.gs) don't include
 * rm_is_active or lead_closing_reason; only the live leads tab has
 * those. Concretely, for every backfilled day:
 *   - inactiveRmNewLead can never fire (rm_is_active reads as blank,
 *     which computeSlaFlags_ treats as "not inactive").
 *   - a lead closed ONLY via the sheet's own lead_closing_reason column
 *     (not the RM-entered closing_reason) is still counted open here,
 *     and may show up flagged for something else instead of being
 *     correctly excluded as closed.
 * Every night captureDailyRmIssues_ itself runs live (once
 * setupDailyRmIssueLog() is installed) reads the real leads tab and has
 * neither gap — this only ever affects days reconstructed from history.
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
      // lead_closing_reason isn't one of Movement_Log's own captured
      // columns — see this function's own header note on why that's a
      // known, narrow limitation of backfilling from history rather than
      // a bug.
      if (!isOpenLead_(stage, closingReason, '')) return;

      const flags = computeSlaFlags_(row, colIndex, asOf, baselineMap);
      const issue = primaryIssueGs_(flags);
      if (!issue) return;

      const RM = String(getVal_(row, colIndex, 'RM') || '').trim() || 'Unassigned';
      allNewRows.push([
        dayKey, RM, getVal_(row, colIndex, 'region'), getVal_(row, colIndex, 'project'),
        leadId, getVal_(row, colIndex, 'client_id'), issue.key, issue.label, capturedAtValue,
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
