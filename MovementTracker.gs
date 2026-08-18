/**
 * Movement Tracker — snapshots every currently OPEN Google-source lead
 * every 6 hours into a "Movement_Log" tab in this same spreadsheet,
 * pruned to the last 7 days. Runs on Google's servers on a schedule, so
 * it keeps capturing even when the dashboard AND this Sheet are both
 * fully closed — that's the whole point of it.
 *
 * The dashboard's Movement tab reads Movement_Log and does the actual
 * "did this lead change" comparison client-side, replaying the same
 * enrichLead() logic dashboard.html already uses against each snapshot's
 * own timestamp. This script's only job is capturing raw data reliably —
 * it does NOT duplicate the SLA/breach rules, only the lightweight
 * open/closed stage check needed to decide what's worth snapshotting at
 * all (a closed or Opportunity+ lead can never be "flagged", so there's
 * no reason to store it here).
 *
 * ============================== SETUP (one-time) ==============================
 *   1. Open your Google Sheet → Extensions → Apps Script.
 *   2. Delete any placeholder code in Code.gs, paste this whole file in.
 *      (Rename the file to MovementTracker if you like — doesn't matter.)
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
 *      trigger.
 *   6. Done. Check Triggers (clock icon, left sidebar) to confirm it
 *      shows up, firing every 6 hours. From here it runs unattended.
 *
 * If your month tab isn't named like "Aug" or "Aug-2026", set
 * TAB_NAME_OVERRIDE below to the exact tab name.
 *
 * Known limitation: Apps Script time triggers fire within a window near
 * the requested cadence (commonly a few minutes, occasionally more under
 * load), and Google — not this script — picks the actual anchor times for
 * an every-N-hours trigger, so don't expect it to land on exact clock
 * hours like 00:00/06:00/12:00/18:00. And a snapshot taken right at a
 * month boundary reads whichever tab resolveTabName_ finds for TODAY's
 * date, so the very first snapshot of a new month won't retroactively
 * relabel the last one from the old month — expected, not a bug.
 * ================================================================================
 */

const TAB_NAME_OVERRIDE = ''; // e.g. 'Aug' — leave blank to auto-detect
const MOVEMENT_LOG_SHEET = 'Movement_Log';
const MOVEMENT_LOG_RETENTION_DAYS = 7;
const SNAPSHOT_INTERVAL_HOURS = 6; // must be 1, 2, 4, 6, 8, or 12 — a divisor of 24

// Mirrors HEADER_ALIASES in dashboard.html. Keep these two in sync if a
// column header in your export ever changes.
const HEADER_ALIASES_ = {
  lead_id: ['lead_id', 'leadid', 'lead id'],
  RM: ['rm'],
  TL: ['tl'],
  project: ['project'],
  region: ['region'],
  client: ['client'],
  lead_created_at: ['lead_created_at', 'lead created at', 'created_at', 'created at', 'lead created', 'date created'],
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
  call_attempts: ['call_attempts', 'call attempts', 'attempts'],
  call_count: ['call_count', 'call count'],
  duration: ['duration'],
};

// ---- Funnel / closed-stage classification, ported verbatim from
// dashboard.html's CONFIG so "open" means exactly the same thing here as
// it does on the dashboard. If you ever edit STAGE_ALIASES, FUNNEL_ORDER,
// CLOSED_STAGE_EXACT or CLOSED_STAGE_STEMS in dashboard.html, mirror the
// change here too. ----
const FUNNEL_ORDER_ = ['not updated', 'suspect', 'opportunity', 'visit booked', 'visit', 'pipeline', 'soft booking', 'booking'];
const STAGE_ALIASES_ = {
  'not updated': ['not updated'],
  'suspect': ['suspect'],
  'opportunity': ['opportunity'],
  'visit booked': ['visit booked', 'visit booking', 'visit scheduled'],
  'visit': ['visit', 'revisit', 'hpop', 'video presentation', 'video call'],
  'pipeline': ['pipeline'],
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

function isOppOrAbove_(stage) {
  const canon = canonicalStage_(stage);
  if (!canon) return false;
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

function isOpenLead_(stage, closingReason) {
  const hasClosingReason = !!String(closingReason || '').trim();
  const excluded = isClosedStage_(stage) || hasClosingReason;
  return !excluded && !isOppOrAbove_(stage);
}

// ---- Tab resolution: same auto-detect the dashboard's setup guide describes. ----
function resolveTabName_(ss) {
  if (TAB_NAME_OVERRIDE) return TAB_NAME_OVERRIDE;
  const monthShort = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'MMM'); // "Aug"
  if (ss.getSheetByName(monthShort)) return monthShort;
  const monthYear = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'MMM-yyyy'); // "Aug-2026"
  if (ss.getSheetByName(monthYear)) return monthYear;
  throw new Error('Movement Tracker: no tab named "' + monthShort + '" or "' + monthYear + '" found. Set TAB_NAME_OVERRIDE at the top of MovementTracker.gs to your exact tab name.');
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
  'lead_created_at', 'group_source', 'source_bucket', 'current_stage',
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
  const leadCreatedCol = 3 + SNAPSHOT_COLUMNS_.indexOf('lead_created_at');
  const lastConnectTimeCol = 3 + SNAPSHOT_COLUMNS_.indexOf('last_connect_time');
  sheet.getRange(2, leadCreatedCol, formatRows, 1).setNumberFormat(DATETIME_FORMAT);
  sheet.getRange(2, lastConnectTimeCol, formatRows, 1).setNumberFormat(DATETIME_FORMAT);

  return sheet;
}

/**
 * Core snapshot routine — reads the current month tab, keeps only OPEN
 * Google-source leads, and appends one row per lead to Movement_Log.
 * `label` is a human-readable tag for the run ("2026-08-13 14:07 IST"),
 * shown as-is in the log for anyone reading the raw tab directly.
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

  const out = [];
  dataRows.forEach(function (row) {
    const leadId = String(getVal_(row, colIndex, 'lead_id') || '').trim();
    if (!leadId) return;
    const groupSource = String(getVal_(row, colIndex, 'group_source') || '').trim().toLowerCase();
    if (groupSource !== 'google') return;

    const stage = getVal_(row, colIndex, 'current_stage');
    const closingReason = getVal_(row, colIndex, 'closing_reason');
    if (!isOpenLead_(stage, closingReason)) return; // closed / Opportunity+ leads can never be "flagged"

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
}

// Rewrites the whole data range with only rows newer than the retention
// window — simpler and safer than deleting individual rows out from under
// a range that keeps shifting.
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
  // the trigger — it won't create duplicates. Also cleans up the old
  // twice-a-day trigger names (snapshotEvening/snapshotMorning) from an
  // earlier version of this script, so switching cadence doesn't leave a
  // stale trigger pointing at a function that no longer exists.
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const fn = t.getHandlerFunction();
    if (fn === 'snapshotPeriodic' || fn === 'snapshotEvening' || fn === 'snapshotMorning') {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('snapshotPeriodic').timeBased().everyHours(SNAPSHOT_INTERVAL_HOURS).create();

  Logger.log(
    'Movement tracking installed: snapshots every ' + SNAPSHOT_INTERVAL_HOURS + ' hours, ' +
    'Movement_Log tab ready, retaining ' + MOVEMENT_LOG_RETENTION_DAYS + ' days.'
  );
}

// Run manually any time (function dropdown → snapshotNow → Run) to capture
// an extra snapshot right now — handy for testing the setup without
// waiting for the next scheduled trigger.
function snapshotNow() {
  snapshotOpenLeads_();
}
