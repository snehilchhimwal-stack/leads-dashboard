/**
 * Core — row-parsing and stage-classification utilities shared by every
 * other .gs file in this project (MovementTracker.gs, SlaEngine.gs,
 * FollowupEngine.gs, EmailInfra.gs, OvernightEmailer.gs,
 * AllIssuesEmailer.gs, RmHierarchy.gs, UnmatchedCommentLogger.gs).
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
 * RmHierarchy.gs, RmHierarchy.private.gs, UnmatchedCommentLogger.gs, plus
 * the Tests_*.gs files if you want the test suite too). File name doesn't
 * matter to Apps Script — only the CONTENT and the project it's in — but
 * naming it to match keeps the Apps Script editor's file list
 * self-explanatory.
 * ================================================================================
 */

const TAB_NAME_OVERRIDE = ''; // e.g. 'Aug' — leave blank to auto-detect

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
  throw new Error('No tab named "' + monthShort + '" or "' + monthYear + '" found. Set TAB_NAME_OVERRIDE at the top of Core.gs to your exact tab name.');
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
