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
 *      four triggers (one per hour in SNAPSHOT_HOURS_).
 *   6. Done. Check Triggers (clock icon, left sidebar) to confirm all
 *      four snapshotPeriodic entries show up. From here it runs unattended.
 *
 * If your month tab isn't named like "Aug" or "Aug-2026", set
 * TAB_NAME_OVERRIDE below to the exact tab name.
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

const TAB_NAME_OVERRIDE = ''; // e.g. 'Aug' — leave blank to auto-detect
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

// ---------------------------------------------------------------------
// Keyword-based outcome inference — a port of dashboard.html's own
// inferOutcome/OUTCOME_RULES/FOLLOWUP_SUGGESTIONS (js/core.js). Real RM
// comments are short telecalling shorthand ("Ringing", "Switch off. Wp
// msg sent.") at least as often as full sentences, and just as often
// misspelled — every signal below is checked with typo tolerance (a
// comment word within a small edit distance of a signal word counts as
// that signal) so a spelling mistake attributes to its nearest real
// keyword automatically. Kept traceable to js/core.js: OUTCOME_RULES_GS_
// and FOLLOWUP_SUGGESTIONS_GS_ below must stay in sync with that file's
// OUTCOME_RULES/FOLLOWUP_SUGGESTIONS — mirror any change there here too.
// See js/core.js for the full rationale behind each rule's ordering,
// signal choice, and typo-budget sizing.
// ---------------------------------------------------------------------
function _editDistanceGs_(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let twoBack = null;
  let oneBack = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) oneBack[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    const ai = a[i - 1];
    for (let j = 1; j <= n; j++) {
      const cost = ai === b[j - 1] ? 0 : 1;
      let best = Math.min(oneBack[j] + 1, cur[j - 1] + 1, oneBack[j - 1] + cost);
      if (i > 1 && j > 1 && twoBack && ai === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, twoBack[j - 2] + 1);
      }
      cur[j] = best;
    }
    const tmp = twoBack; twoBack = oneBack; oneBack = cur; cur = (tmp || new Array(n + 1));
  }
  return oneBack[n];
}
function _typoBudgetGs_(targetLen) {
  if (targetLen <= 4) return 0;
  if (targetLen <= 8) return 1;
  return 2;
}
function _wordsMatchGs_(word, target) {
  if (word === target) return true;
  const budget = _typoBudgetGs_(target.length);
  if (!budget || Math.abs(word.length - target.length) > budget) return false;
  return _editDistanceGs_(word, target) <= budget;
}
function _wordsOfGs_(text) {
  return String(text).toLowerCase().replace(/'/g, '').match(/[a-z0-9]+/g) || [];
}
const _signalWordsCacheGs_ = {};
function _signalWordsOfGs_(signal) {
  let w = _signalWordsCacheGs_[signal];
  if (!w) { w = signal.split(' '); _signalWordsCacheGs_[signal] = w; }
  return w;
}
function _signalMatchesGs_(commentWords, signal) {
  const target = _signalWordsOfGs_(signal);
  if (target.length === 1) return commentWords.some(function (w) { return _wordsMatchGs_(w, target[0]); });
  for (let i = 0; i + target.length <= commentWords.length; i++) {
    let ok = true;
    for (let j = 0; j < target.length; j++) {
      if (!_wordsMatchGs_(commentWords[i + j], target[j])) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}
function _anySignalGs_(commentWords, signals) {
  return signals.some(function (s) { return _signalMatchesGs_(commentWords, s); });
}

const OUTCOME_RULES_GS_ = [
  { outcome: 'Do Not Disturb', signals: ['do not call', 'dont call', 'not to call', 'stop calling', 'dnd'] },
  { outcome: 'Switched Off', signals: [
      'switch off', 'switched off', 'sw off', 'swoff', 'not reachable', 'unreachable', 'not contactable',
      'out of coverage', 'out of service', 'out of network', 'call forwarded', 'call forwarding',
      'voice mail', 'voice message', 'voicemail',
    ], test: function (c, w) {
      return (_anySignalGs_(w, ['incoming']) && _anySignalGs_(w, ['barred', 'not available']))
        || w.indexOf('unavailable') !== -1 || w.indexOf('ivr') !== -1;
    } },
  { outcome: 'Wrong Number', signals: ['wrong number', 'invalid number', 'invalid no', 'wn'] },
  { outcome: 'Call Declined', signals: [
      'hung up', 'hangup', 'disconnecting', 'disconnect the call', 'disconnect call', 'declined', 'declining', 'decline',
      'cut the call', 'call cut',
    ], test: function (c) { return /^disconnect\s*-?\s*$/.test(c); } },
  { outcome: 'Busy', signals: ['busy', 'buzy'] },
  { outcome: 'Booked Elsewhere', signals: [
      'booked elsewhere', 'booked with another', 'purchased elsewhere', 'purchased another',
      'bought elsewhere', 'bought another', 'already bought', 'already purchased',
      'finalized another', 'finalised another', 'gone with another',
    ] },
  { outcome: 'Resale / Rental (Out of Scope)', signals: ['resale', 'resell', 'second hand', 'to let'],
    test: function (c, w) {
      if (!_anySignalGs_(w, ['rent', 'rental', 'renting'])) return false;
      if (_anySignalGs_(w, ['current', 'currently'])) return false;
      return _anySignalGs_(w, ['want', 'wants', 'need', 'needs', 'looking', 'require', 'requires', 'searching', 'search']);
    } },
  { outcome: 'RNR', signals: [
      'rnr', 'cnr', 'nc', 'nr', 'not responding', 'no answer', 'no response', 'not answering', 'not answered',
      'didnt answer', 'not picking', 'did not pick', 'didnt pick', 'pickup the call', 'pick up the call',
      'do not pickup', 'do not pick up', 'call not answered', 'call not received', 'call not receive',
      'not received call', 'not received', 'call not respond', 'call not pick', 'call not picked', 'not receiving',
    ] },
  { outcome: 'Ringing / RNR', signals: ['ringing'], test: function (c) { return /^ring\s*-?\s*$/.test(c); } },
  { outcome: 'Disconnected', signals: [
      'disconnected', 'call disc', 'disc', 'network issue', 'network problem', 'poor network',
      'call not connecting', 'call not connected', 'call not connect', 'not getting connected',
      'not connecting', 'not connected', 'call drop', 'blank call',
    ] },
  { outcome: 'Out of Station', signals: ['out of station', 'out station', 'out of town', 'not in town', 'travelling'] },
  { outcome: 'WhatsApp Unavailable', test: function (c, w) { return _anySignalGs_(w, ['whatsapp', 'wp', 'wa']) && _anySignalGs_(w, ['not on', 'not available']); } },
  { outcome: 'WhatsApp Sent', signals: ['dwm', 'textedon'],
    test: function (c, w) {
      return _anySignalGs_(w, ['whatsapp', 'whats app', 'whats up', 'wp', 'wa', 'msg', 'mesg', 'message', 'text']) &&
        _anySignalGs_(w, ['drop', 'dropped', 'shared', 'share', 'sent', 'pinged', 'texted']);
    } },
  { outcome: 'Details Shared', test: function (c, w) { return _anySignalGs_(w, ['shared', 'share', 'sent']) && _anySignalGs_(w, ['detail', 'brochure', 'project', 'info']); } },
  { outcome: 'Visit Completed', signals: [
      'visit done', 'visited site', 'site visited', 'visit completed', 'came for visit', 'visited the project',
    ] },
  { outcome: 'Visit Arranged', signals: [
      'site visit', 'visit scheduled', 'visit arranged', 'visit booked', 'visit fixed', 'visit confirmed',
      'will visit', 'coming for visit', 'visit planned',
    ] },
  { outcome: 'Loan In Process', signals: ['document submitted', 'bank process'],
    test: function (c, w) { return _anySignalGs_(w, ['loan']) && _anySignalGs_(w, ['process', 'sanction', 'approval']); } },
  { outcome: 'Not Interested', signals: [
      'not interested', 'no interest', 'no longer interested', 'not looking',
      'no requirement', 'not requirement', 'not enquired', 'dropped the plan', 'dropped the idea', 'ni',
    ] },
  { outcome: 'Considering', signals: ['consider', 'think about', 'will think', 'will get back', 'need some time', 'need time', 'will discuss'] },
  { outcome: 'Budget Concern', signals: ['budget', 'expensive', 'too high', 'high price', 'costly', 'cant afford', 'cannot afford', 'out of budget'] },
  { outcome: 'Interested', signals: ['interested'] },
  { outcome: 'DNP', signals: [
      'call again', 'dnp', 'call back', 'callback', 'call later', 'call after', 'call tomorrow',
      'requested callback', 'asked to call', 'cb',
    ] },
  { outcome: 'Follow-up Missed', signals: ['followup missed', 'follow up missed'] },
];

function inferOutcomeGs_(comment) {
  const c = String(comment).toLowerCase();
  if (/^[\s\-_./]+$/.test(c)) return 'No Real Update';
  const words = _wordsOfGs_(c);
  for (let i = 0; i < OUTCOME_RULES_GS_.length; i++) {
    const rule = OUTCOME_RULES_GS_[i];
    if ((rule.signals && _anySignalGs_(words, rule.signals)) || (rule.test && rule.test(c, words))) return rule.outcome;
  }
  return 'Update';
}

const FOLLOWUP_SUGGESTIONS_GS_ = {
  'Do Not Disturb': "Client asked not to be called — stop calling immediately, log as DND, and only re-engage via an approved channel (SMS/email) if policy allows.",
  'Switched Off': 'Phone was switched off, out of service/network, or otherwise unreachable — retry later today; try an alternate number if one is on file.',
  'Wrong Number': 'Number appears incorrect — verify the contact number with the source/RM before calling again.',
  'Call Declined': "Customer saw or heard the call and actively ended/declined it — they're avoiding contact right now, so calling straight back is more likely to annoy than connect. Try a different time of day, or switch to WhatsApp/SMS first.",
  'Busy': 'Line was busy — retry within a few hours.',
  'Booked Elsewhere': "Client says they've booked/purchased elsewhere — confirm this is genuinely final before closing; don't assume dead until it's verified.",
  'Resale / Rental (Out of Scope)': "Client is looking for resale or rental, not a new first-sale (developer/builder) property — we don't work that segment. Close with this as the reason rather than treating it as lost interest.",
  'RNR': 'No response — retry at a different time of day; consider a WhatsApp follow-up.',
  'Ringing / RNR': 'Rang but no pickup — retry at a different time of day.',
  'Disconnected': "Call dropped, didn't connect, or connected with no response — retry; flag the number if this keeps happening.",
  'Out of Station': "Client is travelling — schedule the follow-up for when they're back rather than repeat-calling now.",
  'WhatsApp Unavailable': "This contact isn't reachable on WhatsApp (or doesn't have it) — stick to voice calls or SMS instead of defaulting back to a WhatsApp text.",
  'WhatsApp Sent': 'A WhatsApp/text message was sent or dropped but not yet followed by a call — a text may go unseen, call to confirm.',
  'Details Shared': 'Project details were shared — follow up to gauge interest and answer any questions before it goes cold.',
  'Visit Completed': "Site visit already happened — call within 24 hours for feedback while it's fresh, and push toward the next concrete step.",
  'Visit Arranged': 'A site visit is arranged — confirm attendance close to the date, and follow up right after for feedback.',
  'Loan In Process': "Loan/paperwork is in process on their end — check status periodically and keep them warm, don't let this go cold.",
  'Not Interested': 'Client indicated no interest (or no current requirement) — confirm this is final, then close with a clear reason if so.',
  'Considering': 'Client is still deciding — schedule a follow-up in a few days rather than calling again immediately.',
  'Budget Concern': 'Budget was raised as a concern — check for a better-fit option or payment plan before the next call.',
  'Interested': 'Client showed interest — move quickly to the next step (site visit, documents, or pricing).',
  'DNP': 'Client asked to be called back later — schedule the follow-up call.',
  'Follow-up Missed': 'A scheduled follow-up was missed — reach out right away to catch up before it goes any staler.',
  'No Real Update': "RM logged a placeholder with no real content — there's nothing here to act on from the comment alone. Call and get an actual status update, then log what was actually said.",
};

// Fallback for when inferOutcomeGs_ finds no keyword match at all — a
// comment that's real information but doesn't contain any known outcome
// keyword. Quoting the real latest note beats a canned "read the
// comments" line, since the overnight email doesn't otherwise show
// comment text anywhere near the Suggested Follow-up column.
function unmatchedFollowUpGs_(comment, loggedBy) {
  const text = String(comment || '').trim();
  if (!text) return 'Manual review required — no keyword match found. Read the comments and log a specific next call/action.';
  const who = String(loggedBy || '').trim();
  return 'No keyword match — latest note' + (who ? ' (' + who + ')' : '') + ': "' + text + '". Read this and log a specific next call/action.';
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
