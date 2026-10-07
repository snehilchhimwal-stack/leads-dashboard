/**
 * Core — row-parsing and stage-classification utilities shared by every
 * other .gs file in this project (MovementTracker.gs, SlaEngine.gs,
 * FollowupEngine.gs, EmailInfra.gs, OvernightEmailer.gs,
 * AllIssuesEmailer.gs, RmHierarchy.gs, UnmatchedCommentLogger.gs,
 * DailyRmIssueLog.gs, OpsChecklistRunner.gs, LeadFollowupsStaleness.gs).
 * Nothing here is specific to any one script's own job — it's the "how
 * do we read a lead row and decide what stage it's in" layer every one
 * of them builds on.
 *
 * Split out of MovementTracker.gs (2026-08-28) as part of a full
 * compartmentalization pass — these functions were never movement-
 * tracking-specific, they just happened to be defined in the first script
 * that needed them. Moving code between .gs files in the SAME Apps
 * Script project has no functional effect (every file shares one global
 * namespace, same as multiple <script> tags on one page) — this is a
 * pure organization change, not a behavior change.
 *
 * ============================== SETUP ==============================
 * Paste this in as its own file, alongside every other file in this
 * project (Core.gs, SlaEngine.gs, FollowupEngine.gs, EmailInfra.gs,
 * MovementTracker.gs, OvernightEmailer.gs, AllIssuesEmailer.gs,
 * RmHierarchy.gs, RmHierarchy.private.gs, UnmatchedCommentLogger.gs,
 * DailyRmIssueLog.gs, OpsChecklistRunner.gs, LeadFollowupsStaleness.gs,
 * plus the Tests_*.gs files if you want the test suite too). File name
 * doesn't
 * matter to Apps Script — only the CONTENT and the project it's in — but
 * naming it to match keeps the Apps Script editor's file list
 * self-explanatory.
 * ================================================================================
 */

const TAB_NAME_OVERRIDE = 'leads'; // The leads tab has one fixed name — it no longer rotates every month. Change this if it's ever renamed again.

// Mirrors HEADER_ALIASES in dashboard.html. Keep these two in sync if a
// column header in your export ever changes.
const HEADER_ALIASES_ = {
  lead_id: ['lead_id', 'leadid', 'lead id'],
  RM: ['rm'],
  TL: ['tl'],
  project: ['project'],
  region: ['region'],
  client: ['client'],
  lead_assigned_at: ['lead_assigned_at', 'lead assigned at', 'assigned_at', 'assigned at', 'lead assigned', 'date assigned'],
  // Added 2026-09-21 — twin of the same key in js/core-sheets-fetch.js's
  // HEADER_ALIASES. Blank for a lead that never reached Opportunity.
  opp_at: ['opp_at', 'opp at'],
  group_source: ['group_source', 'group source', 'source'],
  source_bucket: ['source_bucket', 'source bucket', 'sub_source', 'sub source'],
  current_stage: ['current_stage', 'current stage', 'stage'],
  client_id: ['client_id', 'client id'],
  last_connect: ['last_connect', 'last connect'],
  last_connect_time: ['last_connect_time', 'last connect time'],
  last_comment: ['last_comment', 'last comment'],
  internal_status_comments: ['internal_status_comments', 'internal status comments'],
  stage_comments: ['stage_comments', 'stage comments'],
  closing_reason: ['closing_reason', 'closing reason'],
  // The sheet's own closing disposition, distinct from the RM-entered
  // closing_reason above — see isOpenLead_/computeSlaFlags_ (SlaEngine.gs).
  // Not written to Movement_Log (not in MovementTracker.gs's
  // SNAPSHOT_COLUMNS_): read here purely to decide open/closed status for
  // the SLA_History computation, which always runs against this
  // freshly-read source-tab row, never against a stored Movement_Log row.
  lead_closing_reason: ['lead_closing_reason', 'lead closing reason'],
  // Needed for the Inactive-RM Lead Added rule (computeSlaFlags_) — also
  // never written to Movement_Log, same reasoning as lead_closing_reason.
  rm_is_active: ['rm_is_active', 'rm is active'],
  call_attempts: ['call_attempts', 'call attempts', 'attempts'],
  call_count: ['call_count', 'call count'],
  duration: ['duration'],
};

// ---- Funnel / closed-stage classification, ported verbatim from
// dashboard.html's CONFIG so "open" means exactly the same thing here as
// it does on the dashboard. If you ever edit STAGE_ALIASES, FUNNEL_ORDER,
// CLOSED_STAGE_EXACT or CLOSED_STAGE_STEMS in dashboard.html, mirror the
// change here too. ----
const FUNNEL_ORDER_ = ['not updated', 'suspect', 'opportunity', 'visit booked', 'visit', 'pipeline', 'gross eoi application', 'soft booking', 'booking'];
const STAGE_ALIASES_ = {
  'not updated': ['not updated'],
  'suspect': ['suspect'],
  'opportunity': ['opportunity'],
  'visit booked': ['visit booked', 'visit booking', 'visit scheduled'],
  'visit': ['visit', 'revisit', 'hpop', 'video presentation', 'video call'],
  'pipeline': ['pipeline'],
  'gross eoi application': ['gross eoi application', 'gross eoi', 'eoi application', 'eoi'],
  'soft booking': ['soft booking', 'soft book'],
  'booking': ['booking', 'booked'],
};
const OPPORTUNITY_STAGE_ = 'opportunity';
const CLOSED_STAGE_EXACT_ = ['won', 'lost', 'junk', 'dead', 'not interested'];
const CLOSED_STAGE_STEMS_ = ['cancel', 'close', 'reject'];

function canonicalStage_(stage) {
  const s = String(stage || '').trim().toLowerCase();
  if (!s) return null;
  for (let i = 0; i < FUNNEL_ORDER_.length; i++) {
    const canon = FUNNEL_ORDER_[i];
    const aliases = STAGE_ALIASES_[canon] || [canon];
    for (let j = 0; j < aliases.length; j++) {
      const a = aliases[j];
      if (s === a || s.indexOf(a) !== -1) return canon;
    }
  }
  return null;
}

// closingReason/leadClosingReason are optional — every existing call site
// that only ever passed `stage` keeps behaving exactly as before. Mirrors
// js/core-lead-model.js's identical 2026-09-09 fix — see that file's own
// comment on isOppOrAbove for the full reasoning (a CRM stage text this
// app doesn't recognize previously read as NOT Opportunity+ even when the
// lead had clearly already progressed there or further, per its own
// closing/resolution reason).
function isOppOrAbove_(stage, closingReason, leadClosingReason) {
  let canon = canonicalStage_(stage);
  if (!canon) {
    const reason = String(leadClosingReason || closingReason || '').trim().toLowerCase();
    canon = reason ? canonicalStage_(reason) : null;
    if (!canon) return false;
  }
  return FUNNEL_ORDER_.indexOf(canon) >= FUNNEL_ORDER_.indexOf(OPPORTUNITY_STAGE_);
}

function isClosedStage_(stage) {
  const s = String(stage || '').trim().toLowerCase();
  if (!s) return false;
  const words = s.split(/[^a-z']+/).filter(function (w) { return !!w; });
  const exactHit = CLOSED_STAGE_EXACT_.some(function (kw) {
    return kw.indexOf(' ') !== -1 ? s.indexOf(kw) !== -1 : words.indexOf(kw) !== -1;
  });
  if (exactHit) return true;
  return CLOSED_STAGE_STEMS_.some(function (stem) {
    return words.some(function (w) { return w.indexOf(stem) === 0; });
  });
}

// closingReason is the RM-entered field; leadClosingReason is the sheet's
// own closing disposition — a lead closed via EITHER one is closed. Kept
// mirrored with dashboard.html's isLeadClosed — see the note there.
function isOpenLead_(stage, closingReason, leadClosingReason) {
  const hasClosingReason = !!String(closingReason || '').trim() || !!String(leadClosingReason || '').trim();
  const excluded = isClosedStage_(stage) || hasClosingReason;
  return !excluded && !isOppOrAbove_(stage, closingReason, leadClosingReason);
}

// ---- Tab resolution: the leads tab has one fixed name — see
// TAB_NAME_OVERRIDE above. (Earlier versions of this project auto-detected
// a rotating "Aug"/"Aug-2026"-style monthly tab; the sheet no longer
// rotates, so that logic was removed 2026-09-01. If it's ever renamed
// again, just update TAB_NAME_OVERRIDE — every caller here goes through
// this one function.) ----
function resolveTabName_(ss) {
  return TAB_NAME_OVERRIDE;
}

// ---- Column mapping. Row 1 = banner/import-bar row, row 2 = real
// headers — same convention dashboard.html reads (range=A2:Z&headers=1). ----
function buildColIndex_(headerRow) {
  const colIndex = {};
  Object.keys(HEADER_ALIASES_).forEach(function (key) {
    const aliases = HEADER_ALIASES_[key];
    let idx = -1;
    headerRow.forEach(function (label, i) {
      if (idx !== -1) return;
      const norm = String(label || '').trim().toLowerCase();
      if (aliases.indexOf(norm) !== -1) idx = i;
    });
    colIndex[key] = idx;
  });
  if (colIndex.lead_id === -1) colIndex.lead_id = 0; // same fallback as the dashboard
  return colIndex;
}

function getVal_(row, colIndex, key) {
  const idx = colIndex[key];
  if (idx === -1 || idx == null) return '';
  const v = row[idx];
  return v == null ? '' : v;
}

function istDayKeyGs_(date) {
  return Utilities.formatDate(date, 'Asia/Kolkata', 'yyyy-MM-dd');
}

function pad2Gs_(n) { return (n < 10 ? '0' : '') + n; }

// Parses a cell written by istDayKeyGs_ (a plain 'YYYY-MM-DD' string) back
// into a comparable Date, handling BOTH shapes the cell can actually come
// back as: a real JS Date (Sheets silently type-converts a date-shaped
// string on write — the exact same gotcha InteractionHistoryLogger.gs and
// UnmatchedCommentLogger.gs already document for their own comment_at
// columns), or the original string if it somehow stayed one. Returns null
// for anything that parses to neither, so a caller's cutoff comparison
// treats an unparseable cell as "keep, don't guess" rather than pruning
// it by accident. Added 2026-09-29 for pruneCommentHistory_
// (InteractionHistoryLogger.gs) / pruneUnmatchedCommentsLog_
// (UnmatchedCommentLogger.gs), whose own `date` column is written with
// istDayKeyGs_ — a day-level column, so the returned Date is always at
// local midnight; that is precisely enough resolution for a 30-day
// retention cutoff.
function parseIstDayKeyOrDateGs_(cell) {
  if (cell instanceof Date) return cell;
  const s = String(cell || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

// Same day-by-day working-hours walk as dashboard.html's
// businessMinutesBetween — day boundaries come from Apps Script's own
// timezone-aware formatting instead of hand-rolled IST math, which makes
// this simpler than the browser version, not harder. WORK_START_HOUR_/
// WORK_END_HOUR_ live in SlaEngine.gs (they're SLA-rule config, read here
// only because this function needs them).
function businessMinutesBetweenGs_(start, end) {
  if (!start || !end || end <= start) return 0;
  let totalMs = 0;
  let cursor = new Date(start.getTime());

  while (cursor < end) {
    const dayKey = istDayKeyGs_(cursor);
    const dayOpen = new Date(dayKey + 'T' + pad2Gs_(WORK_START_HOUR_) + ':00:00+05:30');
    const dayClose = new Date(dayKey + 'T' + pad2Gs_(WORK_END_HOUR_) + ':00:00+05:30');
    const midnight = new Date(dayKey + 'T00:00:00+05:30');

    const segStart = cursor > dayOpen ? cursor : dayOpen;
    const segEnd = end < dayClose ? end : dayClose;
    if (segEnd > segStart) totalMs += (segEnd.getTime() - segStart.getTime());

    cursor = new Date(midnight.getTime() + 24 * 60 * 60 * 1000); // next IST day's midnight — IST has no DST, so a fixed 24h jump is always correct
  }
  return totalMs / 60000;
}

function esc_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Single shared parent every archived table's own subfolder lives under —
// one place in Drive, not tables scattered as separate top-level folders.
// Lives in whichever Google account owns the nightly trigger (whoever last
// ran setupMovementTracking()/setupDailyRmIssueLog()), since DriveApp calls
// from a time-driven trigger execute as that trigger's owner.
const ARCHIVE_ROOT_FOLDER_ = 'Leads Dashboard Archive';
// One manifest file in ARCHIVE_ROOT_FOLDER_ itself (not per-subfolder) — a
// single append-only ledger of every archive event across every table, so
// "what got archived, when, covering which row-dates" is answerable
// without opening individual CSVs or browsing subfolders.
const ARCHIVE_MANIFEST_FILE_ = 'archive_log.csv';

// Shared by pruneMovementLog_ (MovementTracker.gs) and pruneDailyRmIssueLog_
// (DailyRmIssueLog.gs) — archives rows about to be dropped from a sheet to
// a dated CSV in Drive, BEFORE they're gone for good. Same pattern
// removeEarlyCorruptedMovementLogDataNow's one-off cleanup already used (a
// Drive file, not a second in-workbook sheet/backup), generalized here so
// it runs automatically on every routine prune instead of only a manual
// one-off — this is what actually turns "7 days retained in the sheet"
// into "kept forever, just not in the workbook," at zero cost against the
// workbook's 10,000,000-cell ceiling (a Drive file's size has nothing to
// do with that cap).
//
// tableName: doubles as both the Drive subfolder name (under
// ARCHIVE_ROOT_FOLDER_) and the file prefix — every call site already uses
// the same value for both ('Movement_Log' / 'Daily_RM_Issues'), so one
// parameter instead of two.
// header/rows: plain arrays, exactly as read via getRange(...).getValues().
// rowDateRangeLabel: the caller's own precomputed "earliest_to_latest" date
// span the DATA in `rows` actually covers (not when this archive run
// happens) — e.g. "2026-09-01_to_2026-09-07". Baked into the filename so
// what's inside is readable without opening the file, and also written
// into the manifest row. Callers derive this from their own date column
// since its type/format differs per table (Movement_Log's snapshot_at is
// always a real Date; Daily_RM_Issues' date can be a Date OR a
// 'yyyy-MM-dd' string — see pruneDailyRmIssueLog_'s own comment).
//
// No-ops (returns null, writes nothing, no manifest row) when rows is
// empty, so a prune run that drops nothing never leaves a pointless empty
// file behind. Returns the created File otherwise.
function archiveRowsToDriveCsv_(tableName, header, rows, rowDateRangeLabel) {
  if (!rows || !rows.length) return null;
  const rootFolders = DriveApp.getFoldersByName(ARCHIVE_ROOT_FOLDER_);
  const root = rootFolders.hasNext() ? rootFolders.next() : DriveApp.createFolder(ARCHIVE_ROOT_FOLDER_);
  const subFolders = root.getFoldersByName(tableName);
  const folder = subFolders.hasNext() ? subFolders.next() : root.createFolder(tableName);

  const csvEscape = function (cell) {
    if (cell instanceof Date) return cell.toISOString();
    const s = String(cell == null ? '' : cell);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv = [header].concat(rows).map(function (row) {
    return row.map(csvEscape).join(',');
  }).join('\n');
  const label = rowDateRangeLabel || 'unknown-dates';
  const archivedAtStamp = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd_HHmmss');
  const fileName = tableName + '_rows_' + label + '_archived_' + archivedAtStamp + '.csv';
  const file = folder.createFile(fileName, csv, MimeType.CSV);

  archiveAppendManifestRow_(root, [
    Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss'),
    tableName, fileName, label, String(rows.length),
  ]);

  Logger.log('Archived ' + rows.length + ' ' + tableName + ' row(s) (dates ' + label + ') to Drive: ' + file.getUrl());
  return file;
}

// Number of CSV RECORDS in `text` as archiveRowsToDriveCsv_ writes it: records are joined with a line feed (no trailing one), and a
// cell that holds a line break is quoted, so a line feed INSIDE quotes belongs to the same record. The prunes use this to prove an
// archive holds every row they are about to delete. They used to count `text.split('\n').length`, which counts PHYSICAL lines:
// every multi-line comment added a phantom row, the count never matched, and the Comment_History / Unmatched_Comments_Log prunes
// refused to run for days without anyone being told (2026-10-07: 6,369 expired rows, 102 multi-line -> "holds 6518 ... but 6369
// were expected"). An escaped quote ("") toggles the quote state twice, so it never ends a quoted cell early.
function countCsvRecordsGs_(text) {
  const s = String(text === null || text === undefined ? '' : text);
  if (!s) return 0;
  let records = 1;
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i);
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === '\n' && !inQuotes) records++;
  }
  return records;
}

// Appends one line to ARCHIVE_MANIFEST_FILE_ in rootFolder, creating it
// (with a header row) on first use. Drive has no native "append to file"
// call — this reads the whole current content back, adds one line, and
// rewrites via setContent(), which is fine at this file's realistic size
// (one line per prune run, not per row).
function archiveAppendManifestRow_(rootFolder, rowValues) {
  const csvEscape = function (v) {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const line = rowValues.map(csvEscape).join(',');
  const existing = rootFolder.getFilesByName(ARCHIVE_MANIFEST_FILE_);
  if (existing.hasNext()) {
    const file = existing.next();
    file.setContent(file.getBlob().getDataAsString() + '\n' + line);
  } else {
    const header = 'archived_at,table,filename,row_date_range,row_count';
    rootFolder.createFile(ARCHIVE_MANIFEST_FILE_, header + '\n' + line, MimeType.CSV);
  }
}

// ==================== Workbook cell-budget diagnostic ====================
// Google Sheets caps a workbook at 10,000,000 cells TOTAL, summed across
// every tab's DECLARED grid size (getMaxRows() * getMaxColumns()) — not on
// cells holding real content; clearContent() alone never shrinks it, only
// deleteRows()/deleteColumns() do. See pruneMovementLog_'s own comment
// (MovementTracker.gs) for the full mechanism, and HANDOVER.md section 9.2/
// 9.3 for the three real incidents this ceiling has caused (2026-09-06,
// -19, -24). The two heaviest tabs (Movement_Log, Daily_RM_Issues) already
// prune on a schedule; this is the missing piece HANDOVER.md's 09-24
// writeup named as still open — visibility into the whole workbook's
// budget BEFORE it's gone, not just after each tab prunes itself.
//
// Shared by reportWorkbookCellUsageNow() (console, full per-tab breakdown)
// and OpsChecklistRunner.gs's weekly alert, so the two can never compute
// this differently.
const WORKBOOK_CELL_CEILING_ = 10000000;
const WORKBOOK_CELL_ALERT_WARN_PCT_ = 0.70;
const WORKBOOK_CELL_ALERT_CRITICAL_PCT_ = 0.85;

function computeWorkbookCellUsageGs_(ss) {
  const sheets = ss.getSheets().map(function (sheet) {
    const rows = sheet.getMaxRows(), cols = sheet.getMaxColumns();
    return { name: sheet.getName(), rows: rows, cols: cols, cells: rows * cols };
  }).sort(function (a, b) { return b.cells - a.cells; });
  const totalCells = sheets.reduce(function (sum, s) { return sum + s.cells; }, 0);
  return { sheets: sheets, totalCells: totalCells, ceiling: WORKBOOK_CELL_CEILING_, pctUsed: totalCells / WORKBOOK_CELL_CEILING_ };
}

// '1234567' -> '1,234,567' — Utilities.formatString has no thousands-group
// verb, and toLocaleString() depends on the runtime's default locale
// (untested, and not worth pinning just for a log line); rolled by hand so
// the digit grouping is identical however this runs.
function fmtCellsGs_(n) {
  const s = String(Math.round(n));
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Console-callable — full per-tab breakdown, largest first, so whoever
// reads it knows exactly which tab to prune, not just that something's big.
function reportWorkbookCellUsageNow() {
  const usage = computeWorkbookCellUsageGs_(SpreadsheetApp.getActiveSpreadsheet());
  Logger.log('Workbook cell usage: ' + fmtCellsGs_(usage.totalCells) + ' / ' + fmtCellsGs_(usage.ceiling) +
    ' (' + (usage.pctUsed * 100).toFixed(1) + '%)');
  usage.sheets.forEach(function (s) {
    Logger.log('  ' + s.name + ': ' + fmtCellsGs_(s.cells) + ' cells (' + s.rows + ' rows x ' + s.cols + ' cols)');
  });
}

// ========================= One-off dead-tab removal =========================
// removeOppConversionTrackingTabNow — Opp_Conversion_Tracking surfaced by
// the cell-budget diagnostic above (2026-09-28 sweep) as an unrecognized
// tab. Confirmed via a full repo + live-Apps-Script-project search: ZERO
// code references anywhere, and the tab itself is empty (no data rows) —
// a leftover scratch tab, not a real backup like
// Movement_Log_backup_2026-09-17_1115 was. Snehil authorized deletion
// 2026-09-29.
//
// Unlike removeStaleMovementLogBackupTabNow_ (MovementTracker.gs), this
// does NOT archive-then-delete: an empty tab has nothing to archive. The
// guard instead refuses outright the moment it finds any real data row —
// "someone started using this tab for something real since it was last
// checked" is a fact worth a human's attention, not something to silently
// archive-and-remove out from under them.
function removeOppConversionTrackingTabNow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = 'Opp_Conversion_Tracking';
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) { Logger.log(sheetName + ' not found - nothing to remove (already done?).'); return; }

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow > 1) {
    throw new Error(sheetName + ' has ' + (lastRow - 1) + ' data row(s) below its header - refusing to delete a ' +
      'tab that was confirmed empty and unreferenced on 2026-09-28/29. Investigate before deleting.');
  }

  if (lastRow === 1 && lastCol > 0) {
    const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    Logger.log(sheetName + ' has only a header row ' + JSON.stringify(header) + ' and no data rows - safe to delete.');
  } else {
    Logger.log(sheetName + ' is completely empty - safe to delete.');
  }

  ss.deleteSheet(sheet);
  Logger.log('Removed the dead ' + sheetName + ' tab. Confirmed zero code references anywhere in the repo or the ' +
    'live Apps Script project (2026-09-28), authorized for deletion by Snehil (2026-09-29).');
}
