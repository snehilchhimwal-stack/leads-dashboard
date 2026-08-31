/**
 * Movement Tracker — snapshots every lead in the current month tab (every
 * source, open or closed — the only requirement is a non-blank lead_id)
 * four times a day (00:00, 06:00, 12:00, 18:00 IST — see SNAPSHOT_HOURS_
 * below) into a "Movement_Log" tab in this same spreadsheet, pruned to the
 * last 7 days. Runs on Google's servers on a schedule, so it keeps
 * capturing even when the dashboard AND this Sheet are both fully closed —
 * that's the whole point of it.
 *
 * The dashboard's Movement tab reads Movement_Log and does the actual
 * "did this lead change" comparison client-side, replaying the same
 * enrichLead() logic dashboard.html already uses against each snapshot's
 * own timestamp. This script's only job is capturing raw data reliably —
 * it does not filter by source or open/closed status; that's left entirely
 * to the dashboard's own filters at render time.
 *
 * Same trigger also writes one row per run to "SLA_History" — a compliance
 * snapshot (open leads, breached leads, per-rule counts) computed with
 * computeSlaFlags_ (SlaEngine.gs), a ported copy of dashboard.html's 5
 * SLA rules. The dashboard writes its own rows there too on every refresh
 * (source='Dashboard' vs this script's 'AppsScript'); this one just means
 * that tracking never has a gap on a day nobody opens the dashboard.
 *
 * Same trigger ALSO scans for open leads whose latest owner comment
 * matches no known outcome keyword and logs those to
 * "Unmatched_Comments_Log" for periodic human review — see
 * UnmatchedCommentLogger.gs's own header for why it piggybacks here.
 *
 * REQUIRES Core.gs, SlaEngine.gs, FollowupEngine.gs, EmailInfra.gs, and
 * UnmatchedCommentLogger.gs in the SAME Apps Script project — this file
 * reuses resolveTabName_/buildColIndex_/getVal_ (Core.gs),
 * computeSlaFlags_ (SlaEngine.gs), withRetry_/readLeadsTab_ (EmailInfra.gs,
 * used indirectly via scanUnmatchedCommentsGs_), and
 * scanUnmatchedCommentsGs_ itself (UnmatchedCommentLogger.gs) directly
 * rather than duplicating them. See Core.gs's own header for the full
 * file list this project needs.
 *
 * ============================== SETUP (one-time) ==============================
 *   1. Open your Google Sheet → Extensions → Apps Script.
 *   2. Delete any placeholder code in Code.gs. Add every file this project
 *      needs as its own file (Core.gs, SlaEngine.gs, FollowupEngine.gs,
 *      EmailInfra.gs, MovementTracker.gs, OvernightEmailer.gs,
 *      AllIssuesEmailer.gs, RmHierarchy.gs, RmHierarchy.private.gs,
 *      UnmatchedCommentLogger.gs — see Core.gs's own header), pasting each
 *      file's contents in. File names don't matter to Apps Script, only
 *      that every file is present in one project — naming them to match
 *      just keeps the editor's file list self-explanatory.
 *   3. Project Settings (gear icon, left sidebar) → General settings →
 *      set "Time zone" to Asia/Kolkata. Triggers fire against THIS
 *      timezone setting, not the spreadsheet's.
 *   4. Also confirm the SPREADSHEET's own timezone is Asia/Kolkata — in
 *      the Sheet itself: File → Settings → Locale/timezone. The dashboard
 *      treats every timestamp in this sheet as IST wall-clock, and that
 *      only holds if the sheet is actually set to IST.
 *   5. In the function dropdown at the top of the editor, select
 *      setupMovementTracking, click Run. Approve the permissions prompt
 *      (it needs to read/write this spreadsheet and manage its own
 *      triggers). This creates the Movement_Log tab and installs the
 *      four triggers (one per hour in SNAPSHOT_HOURS_).
 *   6. Done. Check Triggers (clock icon, left sidebar) to confirm all
 *      four snapshotPeriodic entries show up. From here it runs unattended.
 *
 * If your month tab isn't named like "Aug" or "Aug-2026", set
 * TAB_NAME_OVERRIDE (Core.gs) to the exact tab name.
 *
 * Cadence: four separate .atHour() triggers (SNAPSHOT_HOURS_), not one
 * .everyHours(6) trigger — deliberately, after everyHours() was observed
 * running unreliably (drifting or skipping a cycle entirely under load,
 * not just landing a few minutes late). atHour() triggers still land
 * within roughly 15 minutes of their target hour, not the exact minute —
 * so don't expect a snapshot at the literal top of the hour, just close to
 * it, every time. And a snapshot taken right at a month boundary reads
 * whichever tab resolveTabName_ finds for TODAY's date, so the very first
 * snapshot of a new month won't retroactively relabel the last one from
 * the old month — expected, not a bug.
 * ================================================================================
 */

const MOVEMENT_LOG_SHEET = 'Movement_Log';
const MOVEMENT_LOG_RETENTION_DAYS = 7;
// Extra rows left allocated beyond what pruneMovementLog_ actually needs,
// so a normal run doesn't shrink the sheet down to the bone and then
// immediately have to re-expand it for the very next snapshot's rows —
// see pruneMovementLog_'s own comment for why the sheet gets shrunk at all.
const MOVEMENT_LOG_ROW_HEADROOM_ = 5000;
// Four separate fixed-hour daily triggers (IST), not one
// .timeBased().everyHours(6) trigger — see setupMovementTracking's own
// comment for why: everyHours() only loosely targets its interval and can
// silently skip or drift by hours under load, whereas atHour() triggers
// are Google's tightest-guaranteed clock trigger type. Evenly spaced
// across the day; edit this array (not SNAPSHOT_INTERVAL_HOURS, which no
// longer exists) to change the cadence, then re-run setupMovementTracking.
const SNAPSHOT_HOURS_ = [0, 6, 12, 18];

// Column order written to Movement_Log — matches what dashboard.html's
// enrichLead() needs to fully replay a historical flag check. New fields
// MUST be appended at the END, not inserted in the middle: this array's
// order is exactly the order snapshotOpenLeads_ pushes values into each
// row, positionally, against whatever columns an ALREADY-CREATED
// Movement_Log sheet already has — inserting mid-array would shift every
// later column's data under the wrong (unshifted) existing header until
// that header row was also rebuilt. Appending at the end plus
// ensureMovementLogSheet_'s self-healing header check below keeps a
// sheet set up before this field existed correctly aligned.
const SNAPSHOT_COLUMNS_ = [
  'lead_id', 'client_id', 'RM', 'TL', 'project', 'region', 'client',
  'lead_assigned_at', 'group_source', 'source_bucket', 'current_stage',
  'last_connect', 'last_connect_time', 'last_comment',
  'internal_status_comments', 'closing_reason',
  'call_attempts', 'call_count', 'duration',
  'stage_comments',
];

function ensureMovementLogSheet_(ss) {
  let sheet = ss.getSheetByName(MOVEMENT_LOG_SHEET);
  const fullHeaders = ['snapshot_at', 'snapshot_label'].concat(SNAPSHOT_COLUMNS_);
  if (!sheet) {
    sheet = ss.insertSheet(MOVEMENT_LOG_SHEET);
    sheet.getRange(1, 1, 1, fullHeaders.length).setValues([fullHeaders]);
    sheet.setFrozenRows(1);
  } else {
    // Self-heal: a sheet set up before a column was added to
    // SNAPSHOT_COLUMNS_ (e.g. stage_comments) is missing that header
    // label entirely, even though snapshotOpenLeads_ below is about to
    // start writing values into that trailing column position — without
    // this, the dashboard's header-label lookup (and this script's own
    // buildColIndex_) would never find the label and read every value in
    // that column as blank. Appends whatever's missing at the end, which
    // stays correctly aligned as long as new fields are always appended
    // to SNAPSHOT_COLUMNS_ rather than inserted mid-array (see its
    // comment). Re-checked on every call — cheap, idempotent.
    const lastCol = sheet.getLastColumn();
    const existingHeaders = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
    const existingSet = {};
    existingHeaders.forEach(function (h) { existingSet[String(h || '').trim()] = true; });
    const missing = fullHeaders.filter(function (h) { return !existingSet[h]; });
    if (missing.length) {
      sheet.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
    }
  }

  // Force a full date+TIME display format on every date-ish column,
  // re-applied on every call (cheap, idempotent — also self-heals an
  // already-created sheet, not just a brand-new one). Without this,
  // Sheets can auto-format a freshly-written Date column as "Date" only
  // (no time) instead of "Date time" — the underlying value still HAS
  // the correct time, but a date-only-typed column reports through gviz
  // as just Date(y,m,d) with no hour/minute component at all. The
  // dashboard's reader fills a missing time with zeros, so that shows up
  // as every snapshot reading 12:00 AM regardless of when it actually ran.
  const DATETIME_FORMAT = 'yyyy-mm-dd hh:mm:ss';
  const formatRows = Math.max(sheet.getMaxRows() - 1, 1);
  sheet.getRange(2, 1, formatRows, 1).setNumberFormat(DATETIME_FORMAT); // snapshot_at
  const leadAssignedCol = 3 + SNAPSHOT_COLUMNS_.indexOf('lead_assigned_at');
  const lastConnectTimeCol = 3 + SNAPSHOT_COLUMNS_.indexOf('last_connect_time');
  sheet.getRange(2, leadAssignedCol, formatRows, 1).setNumberFormat(DATETIME_FORMAT);
  sheet.getRange(2, lastConnectTimeCol, formatRows, 1).setNumberFormat(DATETIME_FORMAT);

  return sheet;
}

// ==================== SLA_History (automatic, no dashboard needed) ====================
// Writes one row per run to SLA_History using computeSlaFlags_
// (SlaEngine.gs) — so compliance tracking never has a gap on a day
// nobody opens the dashboard. See writeSlaHistorySnapshot_ below, called
// from snapshotOpenLeads_ right alongside the Movement_Log write it
// already does every 6h.
const SLA_HISTORY_SHEET_ = 'SLA_History';
// Order matches dashboard.html's own upsertSlaHistoryRows — snapshot_at/
// source appended at the end so either writer's rows land in the same
// columns regardless of which one created the tab first.
const SLA_HISTORY_COLUMNS_ = [
  'date', 'openTotal', 'breachedTotal',
  'inactiveRmNewLead', 'isNotUpdated', 'followupOverdue', 'underCalledToday', 'stageStuck48h',
  'snapshot_at', 'source',
];

// Raw parsed Movement_Log rows — {key, atMs, call_attempts} per row, NOT
// yet collapsed to "latest per key". Split out from the old
// _lastMovementLogSnapshotByKeyGs_ (2026-08-28, perf pass) so the actual
// Sheets read happens in exactly ONE place: every caller that needs the
// "latest snapshot before some cutoff" answer for MORE than one cutoff
// (every email-send path does — see buildMovementLogMapsGs_ below) can
// now read Movement_Log — the largest sheet in this project — ONCE and
// derive every cutoff's answer from the same in-memory array, instead of
// each cutoff triggering its own full getRange().getValues() round-trip.
function _readMovementLogRowsGs_(ss) {
  const out = [];
  const sheet = ss.getSheetByName(MOVEMENT_LOG_SHEET);
  if (!sheet) return out;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return out;

  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const snapAtCol = headers.indexOf('snapshot_at');
  const leadIdCol = headers.indexOf('lead_id');
  const clientIdCol = headers.indexOf('client_id');
  const callAttemptsCol = headers.indexOf('call_attempts');
  if (snapAtCol === -1 || callAttemptsCol === -1) return out;

  const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  values.forEach(function (row) {
    const ts = row[snapAtCol];
    if (!(ts instanceof Date)) return;
    const clientId = String(row[clientIdCol] || '').trim();
    const leadId = String(row[leadIdCol] || '').trim();
    out.push({ key: clientId || ('l:' + leadId), atMs: ts.getTime(), call_attempts: Number(row[callAttemptsCol]) || 0 });
  });
  return out;
}

// For every identity key, keeps the LATEST row strictly before `cutoffMs`
// as {atMs, call_attempts}. Pure in-memory pass over rows already read by
// _readMovementLogRowsGs_ — no Sheets calls here, so a caller applying
// more than one cutoff (see buildMovementLogMapsGs_) can call this
// cheaply as many times as needed against the SAME read.
function _collapseLatestByKeyGs_(rows, cutoffMs) {
  const map = {};
  rows.forEach(function (r) {
    if (r.atMs >= cutoffMs) return;
    const cur = map[r.key];
    if (!cur || r.atMs > cur.atMs) map[r.key] = { atMs: r.atMs, call_attempts: r.call_attempts };
  });
  return map;
}

// Single-cutoff convenience wrapper — same signature/behavior as before
// this was split into _readMovementLogRowsGs_ + _collapseLatestByKeyGs_.
// Kept for the one caller that only ever needs ONE cutoff
// (buildTodayCallBaselineGs_'s own use inside writeSlaHistorySnapshot_/
// snapshotOpenLeads_, which never also needs lastSnapshotBeforeGs_ in the
// same run) — a caller needing BOTH should use buildMovementLogMapsGs_
// below instead, to avoid two separate reads.
function _lastMovementLogSnapshotByKeyGs_(ss, cutoffMs) {
  return _collapseLatestByKeyGs_(_readMovementLogRowsGs_(ss), cutoffMs);
}

// Each lead's call_attempts as of the latest snapshot strictly before
// `beforeDate`'s IST calendar day (i.e. yesterday-or-earlier only) —
// direct port of dashboard.html's buildTodayCallBaseline. Exists to
// compute "calls made so far TODAY" (callAttempts - this baseline, see
// computeSlaFlags_'s underCalledToday, SlaEngine.gs) against a fixed
// start-of-day reference point — deliberately NOT "the most recent
// snapshot, whenever that was", which lastSnapshotBeforeGs_ below is for.
function buildTodayCallBaselineGs_(ss, beforeDate) {
  const todayStart = new Date(istDayKeyGs_(beforeDate) + 'T00:00:00+05:30').getTime();
  const detailed = _lastMovementLogSnapshotByKeyGs_(ss, todayStart);
  const map = {};
  Object.keys(detailed).forEach(function (key) { map[key] = detailed[key].call_attempts; });
  return map;
}

// Each lead's LATEST snapshot strictly before `beforeDate`, whatever
// calendar day it falls on — as {atMs, call_attempts}. Used by
// noCommentFollowUpGs_ (FollowupEngine.gs) to compare against the most
// recent actually-known call_attempts count and tell "genuinely stalled"
// from "actively being worked". Deliberately NOT
// buildTodayCallBaselineGs_'s "yesterday or earlier only" scope: an
// overnight lead's most recent prior snapshot is typically from EARLIER
// TODAY (snapshots run 4x/day, see SNAPSHOT_HOURS_), and that today's
// snapshot is exactly the "N hours ago" reference point this needs —
// buildTodayCallBaselineGs_'s day-boundary gate would incorrectly
// exclude it.
function lastSnapshotBeforeGs_(ss, beforeDate) {
  return _lastMovementLogSnapshotByKeyGs_(ss, beforeDate.getTime());
}

// Both maps at once, from a SINGLE Movement_Log read — every email-send
// path (OvernightEmailer.gs's morning + follow-up runs,
// AllIssuesEmailer.gs's run) needs both buildTodayCallBaselineGs_'s and
// lastSnapshotBeforeGs_'s answers together, and previously called each
// separately, paying for Movement_Log's full read TWICE per run. The two
// cutoffs are genuinely different (start-of-today vs strictly-before-now)
// so neither map can be derived from the other — but both can be derived
// from the SAME raw rows, which is the actual expensive part (the Sheets
// round-trip), not the in-memory collapse.
function buildMovementLogMapsGs_(ss, now) {
  const rows = _readMovementLogRowsGs_(ss);
  const todayStart = new Date(istDayKeyGs_(now) + 'T00:00:00+05:30').getTime();
  const detailedBaseline = _collapseLatestByKeyGs_(rows, todayStart);
  const baselineMap = {};
  Object.keys(detailedBaseline).forEach(function (key) { baselineMap[key] = detailedBaseline[key].call_attempts; });
  return { baselineMap: baselineMap, lastSnapshotMap: _collapseLatestByKeyGs_(rows, now.getTime()) };
}

function ensureSlaHistorySheet_(ss) {
  let sheet = ss.getSheetByName(SLA_HISTORY_SHEET_);
  if (!sheet) {
    sheet = ss.insertSheet(SLA_HISTORY_SHEET_);
    sheet.getRange(1, 1, 1, SLA_HISTORY_COLUMNS_.length).setValues([SLA_HISTORY_COLUMNS_]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  // Self-heal, same pattern as ensureMovementLogSheet_ — append whatever
  // header columns are missing rather than requiring an exact pre-built
  // match, so a tab created by hand (see the dashboard walkthrough) still
  // ends up with every column this script expects.
  const lastCol = sheet.getLastColumn();
  const existingHeaders = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  const existingSet = {};
  existingHeaders.forEach(function (h) { existingSet[String(h || '').trim()] = true; });
  const missing = SLA_HISTORY_COLUMNS_.filter(function (h) { return !existingSet[h]; });
  if (missing.length) {
    sheet.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
  }
  return sheet;
}

// Computes SLA compliance for every lead in `dataRows` (the SAME rows
// snapshotOpenLeads_ just read from the source tab — no separate read) and
// appends one row to SLA_History, source='AppsScript'. Plain append, no
// upsert-by-key check — snapshotOpenLeads_ itself doesn't guard against a
// rare trigger double-fire either (see pruneMovementLog_), so this stays
// consistent with that precedent rather than adding one-sided defensive
// code for this write path only.
function writeSlaHistorySnapshot_(ss, dataRows, colIndex, now) {
  const baselineMap = buildTodayCallBaselineGs_(ss, now);
  const checkKeys = ['inactiveRmNewLead', 'isNotUpdated', 'followupOverdue', 'underCalledToday', 'stageStuck48h'];
  const byCheck = {};
  checkKeys.forEach(function (k) { byCheck[k] = 0; });

  let openTotal = 0, breachedTotal = 0;
  dataRows.forEach(function (row) {
    const leadId = String(getVal_(row, colIndex, 'lead_id') || '').trim();
    if (!leadId) return;
    const flags = computeSlaFlags_(row, colIndex, now, baselineMap);
    if (!flags.isOpenLead) return;
    openTotal++;
    let isBreached = false;
    checkKeys.forEach(function (k) { if (flags[k]) { byCheck[k]++; isBreached = true; } });
    if (isBreached) breachedTotal++;
  });

  const sheet = ensureSlaHistorySheet_(ss);
  const snapshotAtValue = Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss');
  const record = [istDayKeyGs_(now), openTotal, breachedTotal];
  checkKeys.forEach(function (k) { record.push(byCheck[k]); });
  record.push(snapshotAtValue, 'AppsScript');

  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, 1, record.length).setValues([record]);
}

/**
 * Core snapshot routine — reads the current month tab and appends one row
 * per lead to Movement_Log, for every lead in the tab (any source, open or
 * closed — the only requirement is a non-blank lead_id). `label` is a
 * human-readable tag for the run ("2026-08-13 14:07 IST"), shown as-is in
 * the log for anyone reading the raw tab directly.
 */
function snapshotOpenLeads_(label) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tabName = resolveTabName_(ss);
  const src = ss.getSheetByName(tabName);
  if (!src) throw new Error('Movement Tracker: tab "' + tabName + '" not found.');

  const lastRow = src.getLastRow();
  const lastCol = src.getLastColumn();
  if (lastRow < 3) return; // nothing but a banner/header row — nothing to snapshot

  const headerRow = src.getRange(2, 1, 1, lastCol).getValues()[0];
  const colIndex = buildColIndex_(headerRow);
  const dataRows = src.getRange(3, 1, lastRow - 2, lastCol).getValues();

  const now = new Date();
  const snapshotLabel = label || Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm') + ' IST';

  // Computed from the SAME dataRows/colIndex just read above, before
  // Movement_Log gets this run's own row appended below (so the today's-
  // calls baseline lookup only ever sees snapshots strictly before now).
  // Wrapped so a problem in the SLA computation can never block the core
  // Movement_Log capture this trigger exists for.
  try {
    writeSlaHistorySnapshot_(ss, dataRows, colIndex, now);
  } catch (e) {
    Logger.log('SLA_History write failed (Movement_Log capture continues): ' + e);
  }

  // Same dataRows/colIndex, same wrapped-so-it-can-never-block-the-real-
  // capture treatment as the SLA_History write just above — see
  // UnmatchedCommentLogger.gs's own header for why this lives here
  // rather than on its own trigger.
  try {
    scanUnmatchedCommentsGs_(ss, dataRows, colIndex, now);
  } catch (e) {
    Logger.log('Unmatched_Comments_Log scan failed (Movement_Log capture continues): ' + e);
  }

  const out = [];
  dataRows.forEach(function (row) {
    const leadId = String(getVal_(row, colIndex, 'lead_id') || '').trim();
    if (!leadId) return;

    const record = [now, snapshotLabel];
    SNAPSHOT_COLUMNS_.forEach(function (key) {
      record.push(getVal_(row, colIndex, key));
    });
    out.push(record);
  });

  if (!out.length) return;

  const logSheet = ensureMovementLogSheet_(ss);
  const startRow = logSheet.getLastRow() + 1;
  logSheet.getRange(startRow, 1, out.length, out[0].length).setValues(out);

  pruneMovementLog_(ss);

  // Runs LAST, after Movement_Log's own prune, so it reads Movement_Log's
  // true current (post-prune) retained range rather than a stale
  // about-to-be-trimmed one. Same "can never block the core Movement_Log
  // capture" wrapping as the SLA_History/Unmatched_Comments_Log writes
  // above — see persistDailyCohortHistoryGs_'s own header comment for why
  // this needs to run unattended at all.
  try {
    persistDailyCohortHistoryGs_(ss, dataRows, colIndex, now);
  } catch (e) {
    Logger.log('Daily_Cohort_History persist failed (Movement_Log capture continues): ' + e);
  }
}

// Rewrites the whole data range with only rows newer than the retention
// window — simpler and safer than deleting individual rows out from under
// a range that keeps shifting. Also shrinks the sheet's actual row
// allocation to match, via deleteRows — see the comment further down for
// why that step is not optional.
function pruneMovementLog_(ss) {
  const logSheet = ss.getSheetByName(MOVEMENT_LOG_SHEET);
  if (!logSheet) return;
  const lastRow = logSheet.getLastRow();
  if (lastRow < 2) return;
  const lastCol = logSheet.getLastColumn();
  const values = logSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const cutoff = new Date(Date.now() - MOVEMENT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const kept = values.filter(function (row) {
    const ts = row[0];
    return ts instanceof Date && ts >= cutoff;
  });
  logSheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
  if (kept.length) {
    logSheet.getRange(2, 1, kept.length, lastCol).setValues(kept);
  }

  // clearContent above only empties cell VALUES — it does not shrink the
  // sheet's actual row allocation (getMaxRows()), and Google Sheets'
  // 10,000,000-cell cap is on the WORKBOOK's total declared grid size
  // (rows x columns, summed across every tab), not on cells that hold
  // real content. Without this step the sheet's row count only ever
  // grows — every setValues() call in snapshotOpenLeads_ that needs more
  // rows than currently allocated auto-expands the grid, and nothing
  // before this ever shrank it back down — which ratchets the whole
  // workbook toward that ceiling forever even though the actual DATA here
  // stays bounded to MOVEMENT_LOG_RETENTION_DAYS. Real production
  // failure this fixes: snapshotOpenLeads_'s own setValues() call
  // throwing "This action would increase the number of cells in the
  // workbook above the limit of 10000000 cells" — and because that throw
  // happens BEFORE this function is even reached (see
  // snapshotOpenLeads_), pruning could never run again to self-heal once
  // the sheet was already over the edge; see pruneMovementLogNow for the
  // one-time manual recovery that's needed once that's already happened.
  const neededRows = 1 + kept.length + MOVEMENT_LOG_ROW_HEADROOM_;
  const maxRows = logSheet.getMaxRows();
  if (maxRows > neededRows) {
    logSheet.deleteRows(neededRows + 1, maxRows - neededRows);
  }
}

// ONE-OFF RECOVERY — run this manually (function dropdown -> Run) if
// snapshotOpenLeads_/snapshotPeriodic has started failing with "This
// action would increase the number of cells in the workbook above the
// limit of 10000000 cells." That error fires from snapshotOpenLeads_'s
// own append, BEFORE it ever reaches pruneMovementLog_ — so once the
// sheet is already over the edge, the normal periodic trigger can't
// self-heal; this runs the (now row-shrinking) prune directly, without
// needing a successful snapshot append first. Safe to re-run any time.
function pruneMovementLogNow() {
  pruneMovementLog_(SpreadsheetApp.getActiveSpreadsheet());
}

/**
 * Daily Cohort History — automatic, unattended persistence of the
 * dashboard's own "Daily Cohort by Region" table (js/tab-tracking.js:
 * computeDailyCohortByRegion) into a Daily_Cohort_History sheet tab, on
 * the SAME 6-hourly trigger snapshotOpenLeads_ already runs on. Direct
 * port of computeDailyCohortByRegion / eligibleDailyCohortDates /
 * persistDailyCohortHistory (js/tab-tracking.js) and
 * upsertDailyCohortHistoryRows (js/sheets-writeback.js) — same schema,
 * same eligibility rule, same evidence-at-deadline fallback order, so a
 * row written from here is indistinguishable in shape from one the
 * browser wrote (only the `source` column differs — 'AppsScript' here
 * vs 'Dashboard'/'Backfill' from the browser).
 *
 * WHY THIS EXISTS: the browser-side persistDailyCohortHistory only runs
 * when someone actually has the dashboard open at a moment Movement_Log
 * still covers the day in question — miss that window (nobody opens the
 * dashboard for a stretch) and that day's true same-day/48h evidence is
 * gone forever once Movement_Log prunes past MOVEMENT_LOG_RETENTION_DAYS,
 * silently replaced by degraded fallback evidence (both "same-day" and
 * "48h" deadlines start resolving to the same nearest-surviving snapshot,
 * which is what made those two columns read identical for an old date).
 * Running this from the SAME unattended trigger that already captures
 * Movement_Log itself closes that gap: every day gets a real chance to be
 * recorded within 6 hours of becoming eligible, regardless of browser
 * activity.
 *
 * SELF-HEALING, GAPS ONLY, NEVER OVERWRITES AN ALREADY-ARCHIVED DAY:
 * eligibleDailyCohortDatesGs_ below always recomputes the FULL
 * currently-eligible window (every day still inside Movement_Log's
 * retention whose 48h window has elapsed), not just "today" — but
 * persistDailyCohortHistoryGs_ only ever computes and writes a date that
 * has NO row in Daily_Cohort_History yet (see _readArchivedDailyCohortDatesGs_).
 * A day missed on one run (a trigger failure, a temporary error) is
 * simply re-attempted and correctly filled in on the next run, as long as
 * it's still within Movement_Log's retention window when that next run
 * happens. A day that ages out of retention before ANY run ever covers it
 * is a genuine, permanent gap — no amount of retrying recovers data that
 * has already been pruned from Movement_Log.
 *
 * WHY NEVER RE-TOUCH AN ALREADY-ARCHIVED DAY (this is not optional):
 * evidenceAtDeadline's fallback order (nearest at-or-before the deadline,
 * else nearest after it) is only ACCURATE while genuine near-deadline
 * evidence is still retained. If a day were blindly recomputed on every
 * eligible run forever, then once its true near-48h-mark snapshot
 * eventually ages out of the 7-day window, a later re-run would fall back
 * to whatever snapshot happens to survive next — which could be a lead's
 * status from DAYS after its real 48h deadline, silently crediting a late
 * conversion that should never count, and overwriting an already-correct,
 * already-final archived row with a wrong one. Write-once avoids this
 * entirely: a day's numbers are locked in using the freshest possible
 * evidence, the very first time it becomes eligible, and never touched
 * again.
 */

const DAILY_COHORT_HISTORY_SHEET_ = 'Daily_Cohort_History';
// Must exactly match DAILY_COHORT_HISTORY_COLUMNS in js/sheets-writeback.js
// — both sides write into the same tab and must agree on column order.
const DAILY_COHORT_HISTORY_COLUMNS_ = [
  'date_region', 'date', 'region', 'created', 'same_day_resolved', 'same_day_opp',
  'window_complete', 'resolved_48h', 'opp_48h', 'closed_48h', 'updated_at', 'source',
];

function ensureDailyCohortHistorySheetGs_(ss) {
  let sheet = ss.getSheetByName(DAILY_COHORT_HISTORY_SHEET_);
  if (!sheet) {
    sheet = ss.insertSheet(DAILY_COHORT_HISTORY_SHEET_);
    sheet.getRange(1, 1, 1, DAILY_COHORT_HISTORY_COLUMNS_.length).setValues([DAILY_COHORT_HISTORY_COLUMNS_]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// Full-row Movement_Log reader (region/stage/closing_reason/lead_assigned_at
// included) — deliberately separate from _readMovementLogRowsGs_ above,
// which only reads the {key, atMs, call_attempts} shape the SLA baseline
// maps need. Returns every retained row, unfiltered by date — callers
// slice by lead (key) and deadline themselves.
function _readMovementLogHistoryRowsGs_(ss) {
  const out = [];
  const sheet = ss.getSheetByName(MOVEMENT_LOG_SHEET);
  if (!sheet) return out;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return out;
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const idx = {};
  ['snapshot_at', 'lead_id', 'client_id', 'region', 'group_source', 'current_stage', 'closing_reason', 'lead_assigned_at'].forEach(function (h) {
    idx[h] = headers.indexOf(h);
  });
  if (idx.snapshot_at === -1) return out;

  const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  values.forEach(function (row) {
    const ts = row[idx.snapshot_at];
    if (!(ts instanceof Date)) return;
    const leadId = String(row[idx.lead_id] || '').trim();
    if (!leadId) return;
    const clientId = String(row[idx.client_id] || '').trim();
    out.push({
      key: clientId || ('l:' + leadId),
      atMs: ts.getTime(),
      region: idx.region === -1 ? '' : row[idx.region],
      groupSource: idx.group_source === -1 ? '' : row[idx.group_source],
      stage: idx.current_stage === -1 ? '' : row[idx.current_stage],
      closingReason: idx.closing_reason === -1 ? '' : row[idx.closing_reason],
      leadAssignedAt: idx.lead_assigned_at === -1 ? '' : row[idx.lead_assigned_at],
    });
  });
  return out;
}

// Port of dashboard.html/reports.js's effectiveRegion, GROUP_SOURCE-only:
// Movement_Log never captures a project_region column (not in
// SNAPSHOT_COLUMNS_ above), so the browser's project_region-based Loan
// override can never fire off a stored snapshot row either — this mirrors
// exactly what's actually reachable from Movement_Log data, not a
// hypothetical fuller port.
function _effectiveRegionGs_(groupSource, region) {
  if (normRegionKeyGs_(String(groupSource || '')) === 'loan') return 'Loan';
  return String(region || '').trim();
}

// Port of evidenceAtDeadline (js/tab-tracking.js): prefers the latest
// history record at-or-before the deadline, falls back to the first one
// after it, and finally to precomputed live-sheet evidence when history
// has nothing on either side. `liveEvidence` is {oppOrAbove, isOpenLead}
// or null — precomputed once per lead by the caller, not per deadline.
function _evidenceAtDeadlineGs_(historyForKey, deadlineMs, liveEvidence) {
  let atOrBefore = null, firstAfter = null;
  historyForKey.forEach(function (rec) {
    if (rec.atMs <= deadlineMs) { if (!atOrBefore || rec.atMs > atOrBefore.atMs) atOrBefore = rec; }
    else if (!firstAfter || rec.atMs < firstAfter.atMs) firstAfter = rec;
  });
  const evidence = atOrBefore || firstAfter;
  if (evidence) {
    return { oppOrAbove: isOppOrAbove_(evidence.stage), isOpenLead: isOpenLead_(evidence.stage, evidence.closingReason, '') };
  }
  return liveEvidence || null;
}

// Port of eligibleDailyCohortDates (js/tab-tracking.js): every calendar
// day whose dayEnd falls within Movement_Log's actual retained coverage
// (real point-in-time evidence nearby) AND whose entire 48h window has
// already elapsed (every stored number final, never partial).
function eligibleDailyCohortDatesGs_(historyRows, now) {
  if (!historyRows.length) return [];
  let earliestMs = null;
  historyRows.forEach(function (r) { if (earliestMs === null || r.atMs < earliestMs) earliestMs = r.atMs; });

  const earliestByKey = {};
  historyRows.forEach(function (r) {
    if (!earliestByKey[r.key] || r.atMs < earliestByKey[r.key].atMs) earliestByKey[r.key] = r;
  });
  const dayKeys = {};
  Object.keys(earliestByKey).forEach(function (key) {
    const created = earliestByKey[key].leadAssignedAt;
    if (!(created instanceof Date)) return;
    dayKeys[istDayKeyGs_(created)] = true;
  });

  const nowMs = now.getTime();
  return Object.keys(dayKeys).filter(function (dateKey) {
    const dayEndMs = new Date(dateKey + 'T23:59:59+05:30').getTime();
    return dayEndMs >= earliestMs && (dayEndMs + LEAD_LIFECYCLE_HOURS_ * 3600 * 1000) <= nowMs;
  }).sort();
}

// Builds a live-lead lookup from the current month tab's just-read rows
// (the SAME dataRows/colIndex snapshotOpenLeads_ already has this run) —
// covers the rare case where Movement_Log never captured a single
// snapshot of a lead at all (added and resolved between two 6-hourly
// captures, or a genuine capture gap), same reasoning as
// computeDailyCohortByRegion's own liveByKey merge. First copy of a
// customer split across 2 RM rows wins — only region/stage/created are
// read from this, and both copies carry the same lead_assigned_at.
function _buildLiveLeadIndexGs_(dataRows, colIndex) {
  const out = {};
  dataRows.forEach(function (row) {
    const leadId = String(getVal_(row, colIndex, 'lead_id') || '').trim();
    if (!leadId) return;
    const clientId = String(getVal_(row, colIndex, 'client_id') || '').trim();
    const key = clientId || ('l:' + leadId);
    if (out[key]) return;
    out[key] = {
      region: getVal_(row, colIndex, 'region'),
      groupSource: getVal_(row, colIndex, 'group_source'),
      stage: getVal_(row, colIndex, 'current_stage'),
      closingReason: getVal_(row, colIndex, 'closing_reason'),
      leadClosingReason: getVal_(row, colIndex, 'lead_closing_reason'),
      leadAssignedAt: getVal_(row, colIndex, 'lead_assigned_at'),
    };
  });
  return out;
}

// Port of computeDailyCohortByRegion (js/tab-tracking.js) for one
// calendar day — returns {region -> stats}. Always the TRUE unfiltered
// picture (no Project/Region/TL/Source filtering — those are a dashboard
// browser-UI concept only), matching persistDailyCohortHistory's own
// ignoreFilters:true call, since a persisted archive row must reflect
// reality regardless of who has the dashboard open with which filters.
function computeDailyCohortByRegionGs_(dateKey, historyRows, liveByKey, now) {
  const dayStart = new Date(dateKey + 'T00:00:00+05:30');
  const dayEnd = new Date(dateKey + 'T23:59:59+05:30');
  const nowMs = now.getTime();
  const sameDayDeadlineMs = Math.min(dayEnd.getTime(), nowMs);

  const byKey = {};
  historyRows.forEach(function (r) {
    if (!byKey[r.key]) byKey[r.key] = [];
    byKey[r.key].push(r);
  });

  // Every lead with Movement_Log history, PLUS any live-only lead
  // Movement_Log never captured at all — same union computeDailyCohortByRegion
  // builds in the browser.
  const allKeys = {};
  Object.keys(byKey).forEach(function (k) { allKeys[k] = true; });
  Object.keys(liveByKey).forEach(function (k) { allKeys[k] = true; });

  const byRegion = {};
  function statsFor(region) {
    if (!byRegion[region]) byRegion[region] = {
      region: region, created: 0, sameDayResolved: 0, sameDayOpp: 0,
      windowComplete: 0, resolved48h: 0, opp48h: 0, closed48h: 0,
    };
    return byRegion[region];
  }

  Object.keys(allKeys).forEach(function (key) {
    const history = byKey[key] || [];
    const live = liveByKey[key];

    let first = null;
    history.forEach(function (r) { if (!first || r.atMs < first.atMs) first = r; });
    const source = first || live;
    if (!source) return;
    const created = first ? first.leadAssignedAt : live.leadAssignedAt;
    if (!(created instanceof Date)) return;
    if (created < dayStart || created > dayEnd) return;

    const region = mainRegionForGs_(_effectiveRegionGs_(source.groupSource, source.region)) || 'Unmapped';
    const stats = statsFor(region);
    stats.created++;

    const liveEvidence = live
      ? { oppOrAbove: isOppOrAbove_(live.stage), isOpenLead: isOpenLead_(live.stage, live.closingReason, live.leadClosingReason) }
      : null;

    const sameDay = _evidenceAtDeadlineGs_(history, sameDayDeadlineMs, liveEvidence);
    if (sameDay) {
      stats.sameDayResolved++;
      if (sameDay.oppOrAbove) stats.sameDayOpp++;
    }

    const deadline48hMs = created.getTime() + LEAD_LIFECYCLE_HOURS_ * 3600 * 1000;
    if (nowMs < deadline48hMs) return; // this lead's own 48h window hasn't elapsed yet
    stats.windowComplete++;
    const at48h = _evidenceAtDeadlineGs_(history, deadline48hMs, liveEvidence);
    if (!at48h) return;
    stats.resolved48h++;
    if (at48h.oppOrAbove) stats.opp48h++;
    else if (!at48h.isOpenLead) stats.closed48h++;
  });

  return byRegion;
}

// Port of upsertDailyCohortHistoryRows (js/sheets-writeback.js): upserts
// one row per {date, region, stats} entry, keyed by "date|region" (column
// A), same schema/column order as the browser's writer. source is always
// 'AppsScript' here so a reader can tell which side wrote a given row.
// Re-sorts by date then region after any append, same as the browser's
// own sortDailyCohortHistorySheet_ — keeps the tab readable regardless of
// which side wrote most recently.
function upsertDailyCohortHistoryRowsGs_(ss, entries, now) {
  if (!entries.length) return;
  const sheet = ensureDailyCohortHistorySheetGs_(ss);
  const lastRow = sheet.getLastRow();
  const rowNumberByKey = {};
  if (lastRow >= 2) {
    const existingKeys = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    existingKeys.forEach(function (r, i) {
      const k = String(r[0] || '').trim();
      if (k) rowNumberByKey[k] = i + 2; // +2: row 1 is the header
    });
  }

  const updatedAt = Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss');
  const toAppend = [];
  entries.forEach(function (e) {
    const key = e.date + '|' + e.region;
    const s = e.stats;
    const rowValues = [
      key, e.date, e.region, s.created, s.sameDayResolved, s.sameDayOpp,
      s.windowComplete, s.resolved48h, s.opp48h, s.closed48h, updatedAt, 'AppsScript',
    ];
    const rowNum = rowNumberByKey[key];
    if (rowNum) {
      sheet.getRange(rowNum, 1, 1, rowValues.length).setValues([rowValues]);
    } else {
      toAppend.push(rowValues);
    }
  });

  if (toAppend.length) {
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, toAppend.length, toAppend[0].length).setValues(toAppend);
    const dataRowCount = sheet.getLastRow() - 1;
    if (dataRowCount > 1) {
      sheet.getRange(2, 1, dataRowCount, DAILY_COHORT_HISTORY_COLUMNS_.length)
        .sort([{ column: 2, ascending: true }, { column: 3, ascending: true }]); // date, then region
    }
  }
}

// Orchestrator — called from snapshotOpenLeads_ on every 6-hourly run.
// `dataRows`/`colIndex` are the SAME current-month-tab rows that run
// already read, reused here for the live-lead fallback rather than a
// second read of the source tab.
// Reads just column B (date) of every existing Daily_Cohort_History row,
// as a {dateKey: true} set — cheap single-column read used to decide
// which eligible dates are genuinely new vs. already final. Returns {} if
// the tab doesn't exist yet (nothing archived at all).
function _readArchivedDailyCohortDatesGs_(ss) {
  const out = {};
  const sheet = ss.getSheetByName(DAILY_COHORT_HISTORY_SHEET_);
  if (!sheet) return out;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return out;
  const values = sheet.getRange(2, 2, lastRow - 1, 1).getValues(); // column B = date
  values.forEach(function (r) {
    const d = String(r[0] || '').trim();
    if (d) out[d] = true;
  });
  return out;
}

function persistDailyCohortHistoryGs_(ss, dataRows, colIndex, now) {
  const historyRows = _readMovementLogHistoryRowsGs_(ss);
  if (!historyRows.length) return;

  const eligibleDates = eligibleDailyCohortDatesGs_(historyRows, now);
  if (!eligibleDates.length) return;

  // Only ever compute/write a date that has NO row in Daily_Cohort_History
  // yet — see this section's own header comment for why re-touching an
  // already-archived day is actively dangerous, not just wasted work.
  const archivedDates = _readArchivedDailyCohortDatesGs_(ss);
  const newDates = eligibleDates.filter(function (d) { return !archivedDates[d]; });
  if (!newDates.length) return;

  const liveByKey = _buildLiveLeadIndexGs_(dataRows, colIndex);

  const entries = [];
  newDates.forEach(function (dateKey) {
    const byRegion = computeDailyCohortByRegionGs_(dateKey, historyRows, liveByKey, now);
    Object.keys(byRegion).forEach(function (region) {
      const stats = byRegion[region];
      if (!stats.created) return;
      entries.push({ date: dateKey, region: region, stats: stats });
    });
  });
  if (!entries.length) return;

  upsertDailyCohortHistoryRowsGs_(ss, entries, now);
}

// Manual run (function dropdown -> Run) — recomputes and upserts
// Daily_Cohort_History for every currently-eligible date without waiting
// for the next scheduled snapshotPeriodic trigger. Useful right after
// deploying this, or to force an immediate catch-up. Reads the current
// month tab itself rather than requiring snapshotOpenLeads_ to have just
// run.
function persistDailyCohortHistoryNow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tabName = resolveTabName_(ss);
  const src = ss.getSheetByName(tabName);
  if (!src) throw new Error('Daily Cohort History: tab "' + tabName + '" not found.');
  const lastRow = src.getLastRow();
  const lastCol = src.getLastColumn();
  if (lastRow < 3) { Logger.log('Nothing to read from ' + tabName + '.'); return; }
  const headerRow = src.getRange(2, 1, 1, lastCol).getValues()[0];
  const colIndex = buildColIndex_(headerRow);
  const dataRows = src.getRange(3, 1, lastRow - 2, lastCol).getValues();
  persistDailyCohortHistoryGs_(ss, dataRows, colIndex, new Date());
  Logger.log('Daily_Cohort_History persist run complete.');
}

// ---- Trigger entry point ----
// Label is generated from the actual moment the trigger fires rather than
// a fixed target time, since an every-N-hours trigger's real firing times
// aren't pinned to specific clock hours (see the "known limitation" note
// above) — the label should say what actually happened, not what was asked for.
function snapshotPeriodic() {
  snapshotOpenLeads_(Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm') + ' IST');
}

// ---- One-time setup — run this once from the editor ----
function setupMovementTracking() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureMovementLogSheet_(ss);

  // Idempotent: safe to re-run any time you need to reinstall or reschedule
  // the triggers — it won't create duplicates. Deletes EVERY existing
  // snapshotPeriodic trigger first (there may be several — one per hour in
  // SNAPSHOT_HOURS_ — or a single leftover .everyHours() trigger from
  // before this switch) before installing a fresh set, so re-running this
  // after editing SNAPSHOT_HOURS_ never leaves stale triggers at the old
  // hours running alongside the new ones. Also cleans up the old
  // twice-a-day trigger names (snapshotEvening/snapshotMorning) from an
  // earlier version of this script.
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const fn = t.getHandlerFunction();
    if (fn === 'snapshotPeriodic' || fn === 'snapshotEvening' || fn === 'snapshotMorning') {
      ScriptApp.deleteTrigger(t);
    }
  });

  // One atHour() trigger per entry in SNAPSHOT_HOURS_, all firing the same
  // handler — deliberately NOT .timeBased().everyHours(6): Apps Script
  // does not guarantee even spacing for everyHours() and, under load, can
  // skip a firing outright rather than just running it a few minutes late
  // (see the file header's "Known limitation" note). atHour() is Google's
  // tightest clock-trigger guarantee — each one independently targets its
  // own hour, so a bad cycle for one doesn't cascade into the others.
  SNAPSHOT_HOURS_.forEach(function (hour) {
    ScriptApp.newTrigger('snapshotPeriodic').timeBased().atHour(hour).everyDays(1).inTimezone('Asia/Kolkata').create();
  });

  Logger.log(
    'Movement tracking installed: snapshots daily at ' + SNAPSHOT_HOURS_.join(':00, ') + ':00 IST, ' +
    'Movement_Log tab ready, retaining ' + MOVEMENT_LOG_RETENTION_DAYS + ' days.'
  );
}

// Run manually any time (function dropdown → snapshotNow → Run) to capture
// an extra snapshot right now — handy for testing the setup without
// waiting for the next scheduled trigger.
function snapshotNow() {
  snapshotOpenLeads_();
}
