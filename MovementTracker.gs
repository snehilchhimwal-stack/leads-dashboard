/**
 * Movement Tracker — snapshots every lead in the current month tab (every
 * source, open or closed — the only requirement is a non-blank lead_id)
 * every 6 hours into a "Movement_Log" tab in this same spreadsheet, pruned
 * to the last 7 days. Runs on Google's servers on a schedule, so it keeps
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
 * snapshot (open leads, breached leads, per-rule counts) computed with a
 * ported copy of dashboard.html's 5 SLA rules (see writeSlaHistorySnapshot_
 * below). The dashboard writes its own rows there too on every refresh
 * (source='Dashboard' vs this script's 'AppsScript'); this one just means
 * that tracking never has a gap on a day nobody opens the dashboard.
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
  lead_assigned_at: ['lead_assigned_at', 'lead assigned at', 'assigned_at', 'assigned at', 'lead assigned', 'date assigned'],
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
  // closing_reason above — see isOpenLead_/computeSlaFlags_. Not written to
  // Movement_Log (not in SNAPSHOT_COLUMNS_ below): read here purely to
  // decide open/closed status for the SLA_History computation, which always
  // runs against this freshly-read source-tab row, never against a stored
  // Movement_Log row.
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
// change here too. (Previously removed in commit c97fcfc when Movement_Log
// stopped filtering by open/closed status — restored here because
// writeSlaHistorySnapshot_ below needs it again, for a different purpose:
// deciding what's OPEN for SLA compliance counting, not what to snapshot.) ----
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

// closingReason is the RM-entered field; leadClosingReason is the sheet's
// own closing disposition — a lead closed via EITHER one is closed. Kept
// mirrored with dashboard.html's isLeadClosed — see the note there.
function isOpenLead_(stage, closingReason, leadClosingReason) {
  const hasClosingReason = !!String(closingReason || '').trim() || !!String(leadClosingReason || '').trim();
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
// Computes the same 5 SLA compliance rules dashboard.html's enrichLead does
// and writes one row per run to SLA_History — so compliance tracking never
// has a gap on a day nobody opens the dashboard. See writeSlaHistorySnapshot_,
// called from snapshotOpenLeads_ below, right alongside the Movement_Log
// write it already does every 6h.
//
// Mirrors dashboard.html's CONFIG values these rules depend on — keep in
// sync if either changes.
const LEAD_GRACE_HOURS_ = 3;
const LEAD_LIFECYCLE_HOURS_ = 48;
const MIN_CALLS_PER_DAY_ = 5;
const FOLLOWUP_REVIEW_HOURS_ = 4;
const FIRST_CONTACT_SLA_MINUTES_ = 10;
const WORK_START_HOUR_ = 9;
const WORK_END_HOUR_ = 19;

const SLA_HISTORY_SHEET_ = 'SLA_History';
// Order matches dashboard.html's own upsertSlaHistoryRows — snapshot_at/
// source appended at the end so either writer's rows land in the same
// columns regardless of which one created the tab first.
const SLA_HISTORY_COLUMNS_ = [
  'date', 'openTotal', 'breachedTotal',
  'inactiveRmNewLead', 'isNotUpdated', 'followupOverdue', 'underCalledToday', 'stageStuck48h',
  'snapshot_at', 'source',
];

function istDayKeyGs_(date) {
  return Utilities.formatDate(date, 'Asia/Kolkata', 'yyyy-MM-dd');
}

function pad2Gs_(n) { return (n < 10 ? '0' : '') + n; }

// Same day-by-day working-hours walk as dashboard.html's
// businessMinutesBetween — day boundaries come from Apps Script's own
// timezone-aware formatting instead of hand-rolled IST math, which makes
// this simpler than the browser version, not harder.
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

// Extracts every dated entry's timestamp from the same
// "Name: Comment - YYYY-MM-DD HH:MM" pipe-separated log format
// dashboard.html's parseActionLog/combinedCommentsText parse. Only the
// timestamps are needed here (for followupOverdue's staleness check and
// underCalledToday's logged-today fallback below) — not the outcome-keyword
// vocabulary those two exist for on the dashboard side, which nothing here
// needs.
function parseDatedCommentEntries_(internalComments, stageComments) {
  const combined = [internalComments, stageComments]
    .filter(function (t) { return String(t || '').trim(); })
    .join(' | ');
  if (!combined) return [];
  const dates = [];
  combined.split('|').forEach(function (entry) {
    const m = entry.trim().match(/-\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s*$/);
    if (!m) return;
    const d = new Date(m[1].replace(' ', 'T') + ':00+05:30');
    if (!isNaN(d.getTime())) dates.push(d);
  });
  return dates;
}

function latestCommentTimestamp_(internalComments, stageComments) {
  const dates = parseDatedCommentEntries_(internalComments, stageComments);
  if (!dates.length) return null;
  return dates.reduce(function (a, b) { return b > a ? b : a; });
}

function countTodayCommentEntries_(internalComments, stageComments, now) {
  const todayKey = istDayKeyGs_(now);
  return parseDatedCommentEntries_(internalComments, stageComments)
    .filter(function (d) { return istDayKeyGs_(d) === todayKey; }).length;
}

// Reads Movement_Log's EXISTING rows (this run hasn't appended its own yet)
// to find each lead's call_attempts as of the latest snapshot strictly
// before `beforeDate`'s IST calendar day — direct port of dashboard.html's
// buildTodayCallBaseline.
function buildTodayCallBaselineGs_(ss, beforeDate) {
  const map = {};
  const sheet = ss.getSheetByName(MOVEMENT_LOG_SHEET);
  if (!sheet) return map;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return map;

  const todayStart = new Date(istDayKeyGs_(beforeDate) + 'T00:00:00+05:30').getTime();
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const snapAtCol = headers.indexOf('snapshot_at');
  const leadIdCol = headers.indexOf('lead_id');
  const clientIdCol = headers.indexOf('client_id');
  const callAttemptsCol = headers.indexOf('call_attempts');
  if (snapAtCol === -1 || callAttemptsCol === -1) return map;

  const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const latest = {}; // key -> {atMs, call_attempts}
  values.forEach(function (row) {
    const ts = row[snapAtCol];
    if (!(ts instanceof Date)) return;
    const atMs = ts.getTime();
    if (atMs >= todayStart) return; // only snapshots strictly before today count as a baseline
    const clientId = String(row[clientIdCol] || '').trim();
    const leadId = String(row[leadIdCol] || '').trim();
    const key = clientId || ('l:' + leadId);
    const cur = latest[key];
    if (!cur || atMs > cur.atMs) latest[key] = { atMs: atMs, call_attempts: Number(row[callAttemptsCol]) || 0 };
  });
  Object.keys(latest).forEach(function (key) { map[key] = latest[key].call_attempts; });
  return map;
}

// Faithful port of the 5 SLA rules dashboard.html's enrichLead computes —
// see that function for the canonical definitions this must stay
// traceable back to. Only computes what SLA_History needs (isOpenLead +
// the 5 rules), not the many other fields enrichLead also derives purely
// for the dashboard's own UI (sibling pooling, multi-agent detection, etc.)
function computeSlaFlags_(row, colIndex, now, baselineMap) {
  const stage = getVal_(row, colIndex, 'current_stage');
  const closingReason = getVal_(row, colIndex, 'closing_reason');
  const leadClosingReason = getVal_(row, colIndex, 'lead_closing_reason');
  const isOpenLead = isOpenLead_(stage, closingReason, leadClosingReason);

  const flags = {
    isOpenLead: isOpenLead,
    inactiveRmNewLead: false, isNotUpdated: false, followupOverdue: false,
    underCalledToday: false, stageStuck48h: false,
  };
  if (!isOpenLead) return flags;

  const createdRaw = getVal_(row, colIndex, 'lead_assigned_at');
  const created = createdRaw instanceof Date ? createdRaw : null;
  if (!created) return flags; // undatable — no rule can fire, same as enrichLead's ageHours=null path

  const ageHours = (now.getTime() - created.getTime()) / 36e5;
  const pastGrace = ageHours >= LEAD_GRACE_HOURS_;
  const isUnder48h = ageHours <= LEAD_LIFECYCLE_HOURS_;
  const past48h = ageHours > LEAD_LIFECYCLE_HOURS_;
  const isCreatedToday = istDayKeyGs_(created) === istDayKeyGs_(now);

  // Inactive-RM Lead Added — deliberately no grace period (the problem is
  // the assignment, not RM speed). getVal_ already returns real `false`
  // for a checkbox-typed cell (only '' on a truly null/undefined value —
  // see its own comment), so `|| ''` here would silently swallow that
  // `false` into an empty string that reads as "unknown" below instead
  // of "inactive" — same fix as dashboard.html's enrichLead().
  const rmActiveRawVal = getVal_(row, colIndex, 'rm_is_active');
  const rmActiveRaw = String(rmActiveRawVal != null ? rmActiveRawVal : '').trim().toLowerCase();
  const rmIsInactive = ['false', 'no', 'inactive', '0', 'n'].indexOf(rmActiveRaw) !== -1;
  flags.inactiveRmNewLead = isCreatedToday && rmIsInactive;

  // Leads Pending Beyond 48 Hours.
  flags.stageStuck48h = past48h && pastGrace;

  const connectTimeRaw = getVal_(row, colIndex, 'last_connect_time');
  const connectDate = connectTimeRaw instanceof Date ? connectTimeRaw : null;
  const hasConnected = !!connectDate || !!String(getVal_(row, colIndex, 'last_connect') || '').trim();

  // Deliberately grace-exempt, same as dashboard.html — see its own
  // comment on neverConnectedPastWindow: a silent lead shouldn't sit
  // unflagged in the 10-min-to-3h gap this exists to catch.
  const neverConnectedPastWindow = isUnder48h && !connectDate &&
    businessMinutesBetweenGs_(created, now) > FIRST_CONTACT_SLA_MINUTES_;

  // Not Updated — canonical stage text (once past grace), OR never
  // connected past the 10-minute window regardless of stage text.
  flags.isNotUpdated = isUnder48h &&
    ((pastGrace && canonicalStage_(stage) === 'not updated') || neverConnectedPastWindow);

  // Follow-up Overdue (4h Post-Connect).
  const internalComments = getVal_(row, colIndex, 'internal_status_comments');
  const stageComments = getVal_(row, colIndex, 'stage_comments');
  const lastCommentAt = latestCommentTimestamp_(internalComments, stageComments);
  const hoursSinceConnect = connectDate ? (now.getTime() - connectDate.getTime()) / 36e5 : null;
  const hoursSinceLastComment = lastCommentAt ? (now.getTime() - lastCommentAt.getTime()) / 36e5 : null;
  const followupStaleHours = hoursSinceLastComment !== null ? hoursSinceLastComment
    : (hoursSinceConnect !== null ? hoursSinceConnect : ageHours);
  flags.followupOverdue = isUnder48h && pastGrace && hasConnected && followupStaleHours > FOLLOWUP_REVIEW_HOURS_;

  // Behind on Today's Calls.
  const callAttempts = Number(getVal_(row, colIndex, 'call_attempts')) || 0;
  let attemptsToday;
  if (isCreatedToday) {
    attemptsToday = callAttempts;
  } else {
    const clientId = String(getVal_(row, colIndex, 'client_id') || '').trim();
    const leadId = String(getVal_(row, colIndex, 'lead_id') || '').trim();
    const baselineKey = clientId || ('l:' + leadId);
    const baseline = baselineMap[baselineKey];
    attemptsToday = baseline !== undefined
      ? Math.max(0, callAttempts - baseline)
      : countTodayCommentEntries_(internalComments, stageComments, now); // no pre-today baseline yet — same fallback as enrichLead's loggedToday
  }
  flags.underCalledToday = pastGrace && attemptsToday < MIN_CALLS_PER_DAY_;

  return flags;
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
