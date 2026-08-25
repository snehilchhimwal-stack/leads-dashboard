/**
 * Overnight Emailer — sends a genuinely UNATTENDED daily email per region at
 * 10am IST (overnight leads: assigned, flagged issue, or already reached
 * Opportunity+), then a 1pm IST follow-up on the SAME Gmail thread showing
 * which of the morning's issue leads got resolved (still flagged = shown in
 * red).
 *
 * WHY THIS IS A SEPARATE SCRIPT FROM THE DASHBOARD: every send button in
 * dashboard.html requires a signed-in browser tab open and a human clicking
 * — there is no way for a static, manually-refreshed page to fire anything
 * at a fixed clock time with nobody there. Genuinely unattended sending only
 * works from Google's own servers, which is exactly what Apps Script time
 * triggers are for — same reason MovementTracker.gs's 6-hourly snapshot
 * exists as a separate script rather than something the dashboard does.
 *
 * REQUIRES MovementTracker.gs in the SAME Apps Script project — this file
 * reuses its resolveTabName_/buildColIndex_/getVal_/HEADER_ALIASES_/
 * canonicalStage_/isOppOrAbove_/isOpenLead_/computeSlaFlags_/istDayKeyGs_
 * directly rather than duplicating them, so the two scripts can never
 * silently disagree about what counts as "open" or "flagged." Install both
 * files before running setupOvernightEmailer.
 *
 * RECIPIENTS: Apps Script has no access to the dashboard's own "Edit region
 * recipients" panel — that list lives only in your browser's localStorage,
 * which a server-side script can never read. This script keeps its OWN
 * recipient list, and — as of RmHierarchy.gs — resolves it PER RM rather
 * than a single fixed address per region: for each region's morning email,
 * every RM who actually had overnight activity gets their real manager
 * chain (TL/RH/CH, from RmHierarchy.gs's RM_Hierarchy + Manager_Directory
 * sheets) resolved and deduped into that email's To/Cc — a manager with no
 * flagged RM under them that day gets nothing. The old flat
 * "Region_Recipients" sheet tab (created automatically, pre-filled with all
 * 11 region names, To/Cc left blank) still exists as a FALLBACK: a region
 * only uses it when zero of that day's RMs could be resolved to a manager
 * email (i.e. Manager_Directory isn't filled in yet for anyone involved) —
 * see resolveRecipientsForRegion_ below.
 *
 * ============================== SETUP (one-time) ==============================
 *   1. Same Apps Script project as MovementTracker.gs, RmHierarchy.gs, AND
 *      RmHierarchy.private.gs (Extensions → Apps Script — all four files
 *      must be in one project). Add each as a new file, paste the contents
 *      in. RmHierarchy.private.gs lives only on your machine (see its own
 *      header) — it's what makes Manager_Directory come pre-filled with
 *      real emails instead of every cell starting blank; the rest of this
 *      still works without it, just with more manual fill-in.
 *   2. In the function dropdown, select setupOvernightEmailer, click Run.
 *      Approve the permissions prompt (it needs Gmail send + spreadsheet
 *      read/write). This creates Region_Recipients, Overnight_Log,
 *      RM_Hierarchy and Manager_Directory, and installs the 10am/1pm
 *      triggers.
 *   3. Open Manager_Directory — most rows already have an email auto-filled
 *      from a separate HR roster export (see email_source: "Book7
 *      auto-match" vs "manual") IF RmHierarchy.private.gs was added per
 *      step 1; check the ones still blank and fill those in by hand, one
 *      row per person, already deduped across every RM who reports up to
 *      them. Region_Recipients still exists too, as a fallback: fill in a
 *      To (and optional Cc) for any region where you'd rather keep one
 *      fixed address than resolve per-RM for now, or leave it blank once
 *      Manager_Directory covers that region — see RmHierarchy.gs's own
 *      header for the full picture, including the handful of people whose
 *      manager chain couldn't be fully resolved
 *      from the source export (flagged in RM_Hierarchy's Note column).
 *   4. Test BEFORE trusting the daily trigger: run sendOvernightMorningEmailsNow
 *      from the function dropdown, confirm the email arrives correctly, then
 *      run sendOvernightFollowupEmailsNow and confirm the reply lands in the
 *      SAME thread. I cannot execute Apps Script myself to verify this code
 *      the way the dashboard's own JS was tested this session — please run
 *      this manual check yourselves before relying on the automatic 10am/1pm
 *      firing.
 *   5. Known limitation, same as MovementTracker.gs's own trigger: Apps
 *      Script time-of-day triggers fire within a window near the requested
 *      hour (commonly within ~15 minutes), not the exact clock minute.
 * ================================================================================
 */

const OVERNIGHT_START_HOUR_ = 17; // 5 PM the day before
const OVERNIGHT_END_HOUR_ = 9;    // 9 AM on the day of

// TEMPORARY TEST OVERRIDE — leave '' for real sends. Set to a single email
// address (e.g. 'snehil.chhimwal@homesfy.in') to redirect EVERY resolved
// To/Cc on EVERY overnight email — real recipients, RM_Hierarchy or
// Region_Recipients fallback alike, and even the 2 always-cc leadership
// addresses — to just that one address, so a manual test run
// (sendOvernightMorningEmailsNow / sendOvernightFollowupEmailsNow) can
// never reach a real TL/RH/CH by accident. Applied in
// resolveRecipientsForRegion_, the single choke point every send path
// already goes through. Blank this out again before trusting the daily
// trigger — while it's set, the real automation is effectively disabled.
const TEST_MODE_OVERRIDE_EMAIL_ = '';

const REGION_RECIPIENTS_SHEET_ = 'Region_Recipients';
const OVERNIGHT_LOG_SHEET_ = 'Overnight_Log';

// Mirrors REGION_GROUP_MAP in reports.js — keep the two in sync if either
// changes. Only these 11 main regions get an automated email; a raw region
// value not listed here (or a numbered/directional sub-region not covered by
// the trailing-suffix fallback below) is skipped, same as the dashboard's
// own reportScopeNotice() behavior.
const REGION_GROUP_MAP_ = {
  'Bangalore': 'Bangalore',
  'Bangalore 1': 'Bangalore', 'Bangalore 2': 'Bangalore', 'Bangalore 3': 'Bangalore',
  'Central': 'Central', 'Central Mumbai': 'Central',
  'Commercial': 'Commercial',
  'Harbour': 'Harbour',
  'Hyderabad': 'Hyderabad',
  'Loan': 'Loan',
  'Navi Mumbai': 'Navi Mumbai', 'Navi Mumbai 2': 'Navi Mumbai',
  'Pune': 'Pune',
  'Pune East': 'Pune', 'Pune North': 'Pune', 'Pune South': 'Pune', 'Pune West': 'Pune',
  'SoBo': 'SoBo', 'HNI - SoBo': 'SoBo', 'HNI': 'SoBo',
  'Thane': 'Thane',
  'Western': 'Western', 'Western Mumbai': 'Western',
  'Western 1': 'Western', 'Western 2': 'Western', 'Western 3': 'Western', 'Western 4': 'Western',
};
function normRegionKeyGs_(s) {
  return String(s || '').trim().toLowerCase().replace(/[\s\-_]+/g, ' ');
}
const _REGION_LOOKUP_ = {};
Object.keys(REGION_GROUP_MAP_).forEach(function (k) { _REGION_LOOKUP_[normRegionKeyGs_(k)] = REGION_GROUP_MAP_[k]; });
function mainRegionForGs_(rawRegion) {
  const key = normRegionKeyGs_(rawRegion);
  if (_REGION_LOOKUP_[key]) return _REGION_LOOKUP_[key];
  const base = key.replace(/\s+\d+$/, '');
  if (base !== key && _REGION_LOOKUP_[base]) return _REGION_LOOKUP_[base];
  return null;
}

// Which of the 5 SLA checks to report as "the" issue when more than one
// fires — same priority order ISSUE_PRIORITY uses on the dashboard.
const ISSUE_PRIORITY_GS_ = [
  { key: 'inactiveRmNewLead', label: 'Inactive-RM Lead Added' },
  { key: 'isNotUpdated', label: 'Not Updated' },
  { key: 'followupOverdue', label: 'Follow-up Overdue' },
  { key: 'underCalledToday', label: "Behind on Today's Calls" },
  { key: 'stageStuck48h', label: 'Stuck 48h+' },
];
function primaryIssueGs_(flags) {
  for (let i = 0; i < ISSUE_PRIORITY_GS_.length; i++) {
    if (flags[ISSUE_PRIORITY_GS_[i].key]) return ISSUE_PRIORITY_GS_[i];
  }
  return null;
}

// "Service Spreadsheets timed out..." (and its siblings — "Service error",
// "Internal error") are Google's own transient infrastructure hiccups, not
// a bug in this script — they happen more often against a large sheet
// (thousands of leads) under load, and they're exactly the kind of thing
// genuinely UNATTENDED automation has to shrug off on its own, since
// there's no human at the trigger to just click retry. Every Spreadsheet-
// service call in this file that reads/writes a real range goes through
// this wrapper. Deliberately narrow on WHICH errors it retries: a real bug
// (bad range, permission denied, a formula error) fails the exact same way
// on every attempt, so retrying it only delays surfacing the actual
// problem by the backoff budget below — not swallow it.
//
// 4 attempts / up to ~12s of total backoff (2s + 4s + 6s), not the
// original 3 attempts / ~6s — real production hit this exact transient
// class three separate times against the same spreadsheet, including on
// a single-row, 6-cell header write, which points at that specific
// spreadsheet needing more headroom to ride out a slow patch than a
// generic "large sheet" assumption accounted for. Still comfortably
// inside Apps Script's own execution-time ceiling even if several
// withRetry_ calls in one run each hit the full budget.
function withRetry_(fn, label) {
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return fn();
    } catch (e) {
      const msg = String((e && e.message) || e);
      const isTransient = /timed out|service (spreadsheets|gmail|error)|internal error/i.test(msg);
      if (!isTransient || attempt === maxAttempts) throw e;
      Logger.log((label || 'Sheets operation') + ' failed transiently (attempt ' + attempt + '/' + maxAttempts + '): ' + msg + ' — retrying in ' + attempt * 2 + 's');
      Utilities.sleep(attempt * 2000);
    }
  }
}

// Split into small independently-retried steps, with a flush() right
// after insertSheet — same reasoning as RmHierarchy.gs's identical
// functions (see ensureRmHierarchySheet_'s comment): one big withRetry_
// around insert+write makes every retry redo the whole thing, and a
// freshly inserted sheet isn't always immediately ready for a write.
function ensureRegionRecipientsSheet_(ss) {
  const existing = withRetry_(function () { return ss.getSheetByName(REGION_RECIPIENTS_SHEET_); }, 'check for existing Region_Recipients');
  if (existing) return existing;

  const sheet = withRetry_(function () { return ss.insertSheet(REGION_RECIPIENTS_SHEET_); }, 'insert Region_Recipients');
  SpreadsheetApp.flush();
  withRetry_(function () {
    sheet.getRange(1, 1, 1, 3).setValues([['region', 'to', 'cc']]);
    sheet.setFrozenRows(1);
  }, 'write Region_Recipients header');
  const regions = Array.from(new Set(Object.keys(REGION_GROUP_MAP_).map(function (k) { return REGION_GROUP_MAP_[k]; }))).sort();
  withRetry_(function () {
    sheet.getRange(2, 1, regions.length, 1).setValues(regions.map(function (r) { return [r]; }));
  }, 'write Region_Recipients region list');
  return sheet;
}

// Per-A1-bucketed recipients for one region's morning email — see
// resolveRecipientBucketsForRms_'s own comment for the bucketing rule
// (one email per distinct A1, never several combined into one To).
// Whichever RMs couldn't be resolved via RM_Hierarchy at all fall back to
// ONE combined email via the legacy Region_Recipients entry — keeps the
// automation sending during the gradual rollout instead of going silent
// the moment RM_Hierarchy exists but some emails aren't filled in yet.
// Returns an array of { to, cc, rmNames, source } — one entry per email
// that should actually be sent for this region (zero, one, or many).
function resolveRecipientEmailsForRegion_(ss, region, rmNames, legacyRecipients) {
  const resolved = withRetry_(function () { return resolveRecipientBucketsForRms_(ss, rmNames); }, 'resolveRecipientBucketsForRms_ (' + region + ')');
  const results = resolved.buckets.map(function (b) {
    return { to: b.primaryEmail, cc: b.cc.join(',') || undefined, rmNames: b.rmNames, source: 'RM_Hierarchy (A1: ' + b.primaryName + ')', bucketLabel: b.primaryName };
  });

  if (resolved.unresolved.length) {
    const legacy = legacyRecipients[region];
    if (legacy) {
      // ALWAYS_CC_EMAILS_ (RmHierarchy.gs) applies even on the legacy
      // fallback path — it's an unconditional business requirement on every
      // overnight email, not something specific to RM_Hierarchy resolution.
      const ccSet = new Set((legacy.cc || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean));
      ALWAYS_CC_EMAILS_.forEach(function (e) { ccSet.add(e); });
      results.push({ to: legacy.to, cc: Array.from(ccSet).join(',') || undefined, rmNames: resolved.unresolved, source: 'Region_Recipients (fallback — RM_Hierarchy could not resolve: ' + resolved.unresolved.join(', ') + ')', bucketLabel: 'Unmatched RMs' });
    }
    // else: silently skipped for these RMs — no recipient configured, not a fault
  }

  // Single choke point every path above funnels through — see
  // TEST_MODE_OVERRIDE_EMAIL_'s own comment. Bucketing is preserved even in
  // test mode (each bucket still becomes its own email, just redirected)
  // so a test run can actually verify "does each A1 get their own email"
  // instead of collapsing the very thing being tested into one message.
  if (TEST_MODE_OVERRIDE_EMAIL_) {
    return results.map(function (r) {
      return { to: TEST_MODE_OVERRIDE_EMAIL_, cc: undefined, rmNames: r.rmNames, source: r.source + ' [TEST MODE — real recipients suppressed, sent to ' + TEST_MODE_OVERRIDE_EMAIL_ + ' only]', bucketLabel: r.bucketLabel };
    });
  }

  return results;
}

function loadRegionRecipients_(ss) {
  const sheet = ensureRegionRecipientsSheet_(ss);
  return withRetry_(function () {
    const lastRow = sheet.getLastRow();
    const map = {};
    if (lastRow < 2) return map;
    sheet.getRange(2, 1, lastRow - 1, 3).getValues().forEach(function (row) {
      const region = String(row[0] || '').trim();
      const to = String(row[1] || '').trim();
      const cc = String(row[2] || '').trim();
      if (region && to) map[region] = { to: to, cc: cc };
    });
    return map;
  }, 'loadRegionRecipients_');
}

// Split into small independently-retried steps, with a flush() right
// after insertSheet — see ensureRegionRecipientsSheet_'s identical
// comment. This is the exact function that produced the original
// "Service Spreadsheets timed out" error in production.
function ensureOvernightLogSheet_(ss) {
  const existing = withRetry_(function () { return ss.getSheetByName(OVERNIGHT_LOG_SHEET_); }, 'check for existing Overnight_Log');
  if (existing) return existing;

  // to/cc/subject: the ACTUAL resolved recipients + subject line from the
  // 10am send, needed so the 1pm follow-up can send to the same real
  // people explicitly — see sendOvernightFollowupEmails' own comment for
  // why it can no longer just GmailThread.reply() on thread_id.
  const headers = ['date', 'region', 'thread_id', 'lead_ids_json', 'sent_at', 'to', 'cc', 'subject'];
  const sheet = withRetry_(function () { return ss.insertSheet(OVERNIGHT_LOG_SHEET_); }, 'insert Overnight_Log');
  SpreadsheetApp.flush();
  withRetry_(function () {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }, 'write Overnight_Log header');
  return sheet;
}

// Yesterday 5 PM IST through today 9 AM IST, as real Date objects — matches
// the dashboard's own "Overnight Leads" window (dashboard.html's
// computeOvernightCohort). `asOf` is the moment this is computed from
// (normally "now"), so the morning run and any manual test run both derive
// the same window from whatever day they're actually run on.
function overnightWindowGs_(asOf) {
  const todayKey = istDayKeyGs_(asOf);
  const todayNineAm = new Date(todayKey + 'T' + pad2Gs_(OVERNIGHT_END_HOUR_) + ':00:00+05:30');
  const yesterday = new Date(asOf.getTime() - 24 * 3600 * 1000);
  const yesterdayKey = istDayKeyGs_(yesterday);
  const yesterdayFivePm = new Date(yesterdayKey + 'T' + pad2Gs_(OVERNIGHT_START_HOUR_) + ':00:00+05:30');
  return { from: yesterdayFivePm, to: todayNineAm };
}

// Reads the current month tab and returns {colIndex, dataRows} — same shape
// snapshotOpenLeads_ in MovementTracker.gs reads, factored out here so both
// the morning and follow-up runs share one read path. This is the single
// biggest read in either script (thousands of leads, every column) — by
// far the most likely place a transient Spreadsheets timeout actually
// shows up, hence its own retry wrapper around the real reads.
function readLeadsTab_(ss) {
  const tabName = resolveTabName_(ss);
  const src = ss.getSheetByName(tabName);
  if (!src) throw new Error('Overnight Emailer: tab "' + tabName + '" not found.');
  return withRetry_(function () {
    const lastRow = src.getLastRow();
    const lastCol = src.getLastColumn();
    if (lastRow < 3) return { colIndex: {}, dataRows: [] };
    const headerRow = src.getRange(2, 1, 1, lastCol).getValues()[0];
    const colIndex = buildColIndex_(headerRow);
    const dataRows = src.getRange(3, 1, lastRow - 2, lastCol).getValues();
    return { colIndex: colIndex, dataRows: dataRows };
  }, 'readLeadsTab_');
}

function esc_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Own-comment text only (internal_status_comments + stage_comments,
// pipe-joined) — NOT the dashboard's own richer collateFamilyComments
// (js/core.js), which also folds in every sibling copy of the SAME
// customer across other regions/sources. That sibling collation depends on
// the dashboard's own in-browser identity-clustering over the WHOLE
// fetched dataset — state that only exists in a signed-in browser tab, not
// in an unattended server-side trigger. A human filling in Lead_Followups'
// suggested_followup column still sees this row's real comment history;
// they just don't get other copies' comments folded in automatically the
// way the dashboard's own Generate flow provides.
function combinedCommentsTextGs_(row, colIndex) {
  const internal = String(getVal_(row, colIndex, 'internal_status_comments') || '').trim();
  const stage = String(getVal_(row, colIndex, 'stage_comments') || '').trim();
  return [internal, stage].filter(function (s) { return s; }).join(' | ') || '(no comments logged)';
}

// Mirrors the dashboard's own overnightStatusLabel (js/tab-movement.js) —
// canonical funnel stage, Title Cased, or the raw stage text verbatim when
// it doesn't match a known funnel band, so nothing silently disappears.
// Never called for a closed lead — those are excluded before this runs.
function overnightStatusLabelGs_(stage) {
  const canon = canonicalStage_(stage);
  if (canon) return canon.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  return String(stage || '').trim() || 'Unrecognized Stage';
}

// A deliberately coarser "what to do next" than the dashboard's own
// suggestedFollowUp, which parses actual logged comment text for outcome
// keywords across every sibling copy of a customer — that depends on the
// dashboard's own in-browser identity-clustering over the whole fetched
// dataset, which this unattended server-side trigger has no access to
// (same reasoning as combinedCommentsTextGs_ above). Falls back to the
// one signal readily available here: has this lead been connected at all,
// and which SLA check (if any) is currently flagging it.
function overnightFollowupHintGs_(row, colIndex, flags) {
  const connectTimeRaw = getVal_(row, colIndex, 'last_connect_time');
  const hasConnected = (connectTimeRaw instanceof Date) || !!String(getVal_(row, colIndex, 'last_connect') || '').trim();
  if (!hasConnected) return 'Connect ASAP — no contact made yet.';
  if (flags.followupOverdue) return 'Follow up now — over 4h since last contact with no update logged.';
  if (flags.isNotUpdated) return "Log a status update — this lead hasn't been updated.";
  return 'Keep working this lead — no SLA issue flagged yet.';
}

// Apps Script port of the dashboard's renderReportEmailHTML
// (js/reports.js) — same eyebrow/KPI-card/section visual shell, hand-built
// here since Apps Script is a separate runtime with no access to that
// browser-side function. Shared by BOTH the 10am morning email and the
// 1pm follow-up reply (opts.title distinguishes them) — before this, only
// the morning email used this shell and the follow-up reply still used
// the old plain-table layout, so every thread looked inconsistent
// (fancy first message, plain reply). Narrower than the original: no
// `highlights` param (neither email here uses one) and the eyebrow/
// signature are fixed rather than parameterized, since both callers want
// the same ones.
function renderOvernightReportEmailHTML_(opts) {
  const FONT = 'font-family:Arial,Helvetica,sans-serif;';
  const kpiCells = opts.kpis.map(function (k) {
    return '<td style="padding:4px;"><div style="background:' + k.bg + '; border-radius:8px; padding:14px 10px; text-align:center;">' +
      '<div style="' + FONT + ' font-size:24px; font-weight:700; color:' + k.fg + '; line-height:1;">' + esc_(String(k.value)) + '</div>' +
      '<div style="' + FONT + ' font-size:10.5px; color:#6b7280; margin-top:5px;">' + esc_(k.label) + '</div>' +
      '</div></td>';
  }).join('');

  const actionBox = opts.action
    ? '<div style="margin-top:12px; border-left:4px solid #10b981; background:#ecfdf5; border-radius:0 8px 8px 0; padding:10px 14px;">' +
      '<div style="' + FONT + ' font-size:10px; text-transform:uppercase; letter-spacing:.04em; font-weight:700; color:#059669;">Recommended Action</div>' +
      '<div style="' + FONT + ' font-size:12.5px; color:#065f46; margin-top:3px;">' + esc_(opts.action) + '</div></div>'
    : '';

  // sec.accent lets a section stand out from the default indigo (e.g. red
  // for "still unresolved", green for "resolved") — same mechanism as the
  // dashboard's own renderReportEmailHTML (js/reports.js) uses for its
  // Stalled Leads section.
  const sectionsHtml = opts.sections.map(function (sec) {
    const accentFg = (sec.accent && sec.accent.fg) || '#4338ca';
    const accentHeaderBg = (sec.accent && sec.accent.headerBg) || '#eef2ff';
    const accentBg = (sec.accent && sec.accent.bg) || '#f5f5ff';
    const headerRow = '<tr style="background:' + accentHeaderBg + ';">' + sec.columns.map(function (c) {
      return '<td style="padding:7px 10px; color:' + accentFg + '; font-size:10px; text-transform:uppercase; letter-spacing:.04em; font-weight:700; ' + FONT + '">' + esc_(c) + '</td>';
    }).join('') + '</tr>';
    const bodyRows = sec.rows.map(function (row, i) {
      return '<tr style="' + (i > 0 ? 'border-top:1px solid #f0f0f0;' : '') + '">' +
        row.map(function (cell) { return '<td style="padding:6px 10px; color:#374151; ' + FONT + '">' + esc_(String(cell)) + '</td>'; }).join('') +
        '</tr>';
    }).join('');
    return '<div style="margin-top:16px; border-left:4px solid ' + accentFg + '; background:' + accentBg + '; border-radius:0 8px 8px 0; padding:12px 16px;">' +
      '<div style="' + FONT + ' font-weight:700; font-size:14px; color:#1f2937;">' + esc_(sec.heading) + '</div>' +
      (sec.subheading ? '<div style="' + FONT + ' font-size:11.5px; color:#6b7280; margin-bottom:8px;">' + esc_(sec.subheading) + '</div>' : '') +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff; border-radius:6px; border:1px solid #e5e7eb; font-size:12px; border-collapse:collapse; margin-top:6px;">' +
      headerRow + bodyRows + '</table></div>';
  }).join('');

  return '<div style="' + FONT + ' max-width:640px; margin:0 auto; background:#ffffff; color:#1f2937;">' +
    '<div style="background:#4338ca; padding:22px 26px;">' +
    '<div style="color:#c7d2fe; font-size:11px; letter-spacing:1.4px; text-transform:uppercase; font-weight:700; margin-bottom:6px; ' + FONT + '">Lead Funnel · SLA Monitor</div>' +
    '<div style="color:#ffffff; font-size:21px; font-weight:700; margin-bottom:4px; ' + FONT + '">' + esc_(opts.title) + '</div>' +
    '<div style="color:#ffffff; font-size:13px; font-weight:600; margin-bottom:2px; ' + FONT + '">Region: ' + esc_(opts.region) + '</div>' +
    '<div style="color:#e0e7ff; font-size:12.5px; ' + FONT + '">' + esc_(opts.subtitle) + '</div>' +
    '</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;"><tr>' + kpiCells + '</tr></table>' +
    actionBox + sectionsHtml +
    (opts.footerNote ? '<div style="margin-top:18px; font-size:11px; color:#9ca3af; ' + FONT + '">' + esc_(opts.footerNote) + '</div>' : '') +
    '<div style="margin-top:16px; font-size:13px; color:#374151; white-space:pre-line; ' + FONT + '">Regards,\nHomesfy Lead Ops</div>' +
    '</div>';
}

/**
 * 10am run: builds and sends one email per region with a configured
 * recipient and at least one still-open overnight lead. ONLY leads that
 * have NOT reached Opportunity+ and are NOT closed are shown — a lead that
 * already converted or closed overnight needs no follow-up action, so it's
 * dropped rather than cluttering the list (same scope as the dashboard's
 * own Overnight Leads email, js/tab-movement.js's overnightEmailableLeads).
 * Grouped by RM (with their manager named), each lead shown as just
 * Lead ID / current Status / a suggested next action — nothing else.
 * Still separately computes and logs which of these leads are flagged for
 * an SLA issue (Overnight_Log) — that's what the 1pm follow-up re-checks;
 * it isn't part of what this email displays, since "status" here is the
 * lead's funnel stage, not which SLA check fired.
 */
// Builds and sends ONE overnight email — either a real per-A1 bucket
// (subject gets that A1's name appended, since a region can now produce
// several of these and identical subjects would be confusing in a shared
// inbox) or the legacy-fallback catch-all for RMs RM_Hierarchy couldn't
// resolve (subject gets "(Unmatched RMs)" instead). Factored out of
// sendOvernightMorningEmails so that function's per-region loop can call
// this once per bucket instead of once per region.
function sendOneOvernightEmail_(ss, logSheet, region, rec, leads, dateLabel, todayKey, now, win) {
  if (!leads.length) return;

  const byRM = {}; // RM -> { TL, leads: [] }
  leads.forEach(function (l) {
    if (!byRM[l.RM]) byRM[l.RM] = { TL: l.TL, leads: [] };
    byRM[l.RM].leads.push(l);
  });
  const rmKeys = Object.keys(byRM).sort();
  const statusTypeCount = Array.from(new Set(leads.map(function (l) { return l.status; }))).length;

  const subjectSuffix = rec.bucketLabel ? ' (' + rec.bucketLabel + ')' : '';
  const subject = region + ' Overnight Leads - ' + dateLabel + subjectSuffix;
  const html = renderOvernightReportEmailHTML_({
    title: 'Overnight Leads',
    region: region,
    subtitle: Utilities.formatDate(win.from, 'Asia/Kolkata', 'd MMM, h:mm a') + ' – ' + Utilities.formatDate(win.to, 'Asia/Kolkata', 'd MMM, h:mm a') + ' IST',
    kpis: [
      { value: leads.length, label: leads.length === 1 ? 'Lead Assigned' : 'Leads Assigned', bg: '#dbeafe', fg: '#2563eb' },
      { value: rmKeys.length, label: rmKeys.length === 1 ? 'RM Affected' : 'RMs Affected', bg: '#e0e7ff', fg: '#4338ca' },
      { value: statusTypeCount, label: statusTypeCount === 1 ? 'Status Type' : 'Status Types', bg: '#fef3c7', fg: '#b45309' },
    ],
    action: "Review and prioritize follow-up on these leads before the rest of today's queue — they came in after hours and may still be waiting on first contact.",
    sections: rmKeys.map(function (rm) {
      return {
        heading: rm, subheading: 'Manager: ' + (byRM[rm].TL || '—'),
        columns: ['Lead ID', 'Status', 'Suggested Follow-up'],
        rows: byRM[rm].leads.map(function (l) { return [l.lead_id, l.status, l.followup]; }),
      };
    }),
    footerNote: 'Status reflects the CURRENT live sheet as of this run, not frozen at the window end time. Leads already at Opportunity+ or closed are excluded — a follow-up on this same thread will land around 1pm showing which of any flagged leads above are still unresolved.',
  });
  const plainBody = 'Overnight leads for ' + region + subjectSuffix + ' (' + dateLabel + '): ' + leads.length +
    ' still open across ' + rmKeys.length + ' RM(s). Open this email in Gmail for the full breakdown.';

  Logger.log('Morning email recipients for ' + region + subjectSuffix + ': ' + rec.source);
  let sentMessage;
  try {
    // Retried: sending the actual email is the one thing here worth
    // fighting for before giving up on a bucket — a transient Gmail
    // hiccup shouldn't silently skip a whole A1's morning email.
    sentMessage = withRetry_(function () {
      return GmailApp.createDraft(rec.to, subject, plainBody, {
        cc: rec.cc || undefined,
        htmlBody: html,
        name: 'Homesfy Lead Ops',
      }).send();
    }, 'send morning email (' + region + subjectSuffix + ')');
  } catch (e) {
    Logger.log('Overnight morning email failed for ' + region + subjectSuffix + ': ' + e);
    return;
  }

  const threadId = sentMessage.getThread().getId();
  const issueLog = [];
  leads.forEach(function (l) { if (l.issue) issueLog.push({ lead_id: l.lead_id, issueKey: l.issue.key, issueLabel: l.issue.label }); });
  withRetry_(function () {
    logSheet.appendRow([
      todayKey, region, threadId, JSON.stringify(issueLog), Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss'),
      rec.to, rec.cc || '', subject,
    ]);
  }, 'log Overnight_Log row (' + region + subjectSuffix + ')');
}

/**
 * 10am run: builds and sends overnight emails, one PER A1 (Team Lead) —
 * never multiple A1s combined into one "To". A region with several Team
 * Leads produces several separate emails, each scoped to just that one
 * A1's own RMs' leads; see resolveRecipientBucketsForRms_ for the exact
 * bucketing rule. Only leads that have NOT reached Opportunity+ and are
 * NOT closed are shown — a lead that already converted or closed
 * overnight needs no follow-up action (same scope as the dashboard's own
 * Overnight Leads email, js/tab-movement.js's overnightEmailableLeads).
 * Each lead shown as just Lead ID / current Status / a suggested next
 * action — nothing else. Still separately computes and logs which of
 * these leads are flagged for an SLA issue (Overnight_Log) — that's what
 * the 1pm follow-up re-checks; it isn't part of what this email displays,
 * since "status" here is the lead's funnel stage, not which SLA check
 * fired.
 */
function sendOvernightMorningEmails() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const now = new Date();
  const win = overnightWindowGs_(now);
  const { colIndex, dataRows } = readLeadsTab_(ss);
  const recipients = loadRegionRecipients_(ss);
  // buildTodayCallBaselineGs_ (from MovementTracker.gs) reads the whole
  // Movement_Log tab — wrapped at the call site rather than editing that
  // shared file, same retry reasoning as readLeadsTab_ above.
  const baselineMap = withRetry_(function () { return buildTodayCallBaselineGs_(ss, now); }, 'buildTodayCallBaselineGs_');

  const byRegion = {}; // mainRegion -> openLeads[] (each carries its own .issue)
  dataRows.forEach(function (row) {
    const leadId = String(getVal_(row, colIndex, 'lead_id') || '').trim();
    if (!leadId) return;
    const createdRaw = getVal_(row, colIndex, 'lead_assigned_at');
    const created = createdRaw instanceof Date ? createdRaw : null;
    if (!created || created < win.from || created > win.to) return; // not an overnight lead

    const rawRegion = getVal_(row, colIndex, 'region');
    const main = mainRegionForGs_(rawRegion);
    if (!main) return; // not one of the 11 configured regions

    const stage = String(getVal_(row, colIndex, 'current_stage') || '').trim();
    if (isOppOrAbove_(stage)) return; // already converted overnight — excluded, needs no follow-up
    const closingReason = getVal_(row, colIndex, 'closing_reason');
    const leadClosingReason = getVal_(row, colIndex, 'lead_closing_reason');
    if (!isOpenLead_(stage, closingReason, leadClosingReason)) return; // closed overnight — excluded

    if (!byRegion[main]) byRegion[main] = [];
    const RM = String(getVal_(row, colIndex, 'RM') || '').trim() || 'Unassigned';
    const TL = String(getVal_(row, colIndex, 'TL') || '').trim();

    const flags = computeSlaFlags_(row, colIndex, now, baselineMap);
    const issue = primaryIssueGs_(flags); // kept on the lead for Overnight_Log — not shown in the email itself

    byRegion[main].push({
      lead_id: leadId, RM: RM, TL: TL,
      status: overnightStatusLabelGs_(stage),
      followup: overnightFollowupHintGs_(row, colIndex, flags),
      issue: issue,
    });
  });

  const logSheet = ensureOvernightLogSheet_(ss);
  const dateLabel = Utilities.formatDate(now, 'Asia/Kolkata', 'd MMM yyyy');
  const todayKey = istDayKeyGs_(now);

  Object.keys(byRegion).sort().forEach(function (region) {
    const openLeads = byRegion[region];
    if (!openLeads.length) return; // nothing still-open overnight for this region

    const rmNames = Array.from(new Set(openLeads.map(function (l) { return l.RM; })));
    const recEmails = resolveRecipientEmailsForRegion_(ss, region, rmNames, recipients);

    recEmails.forEach(function (rec) {
      const rmSet = new Set(rec.rmNames);
      const bucketLeads = openLeads.filter(function (l) { return rmSet.has(l.RM); });
      sendOneOvernightEmail_(ss, logSheet, region, rec, bucketLeads, dateLabel, todayKey, now, win);
    });
  });
}

const LEAD_FOLLOWUPS_SHEET_ = 'Lead_Followups';
const FOLLOWUP_WAIT_POLL_MS_ = 20000;
const FOLLOWUP_WAIT_MAX_ATTEMPTS_ = 6; // ~2 minutes total, see waitForFollowupSuggestions_

// Upserts by lead_id into the SAME tab/columns the dashboard's own Generate
// flow uses (js/sheets-writeback.js's pushLeadsToFollowups): A lead_id, B
// region, C RM, D issue, E collated_comments, G updated_at, H own_comments
// — E and H are identical here since there's no sibling-family expansion
// server-side (see combinedCommentsTextGs_). Deliberately does NOT create
// the tab if it's missing (the dashboard owns creating it — its absence
// means this feature just hasn't been set up yet, not an error) and does
// NOT clear existing rows first: clearing is safe for the dashboard's own
// Generate cycle because it holds an in-memory exclusivity lock
// (_generateCycleOwner) for the whole clear-through-send window, but Apps
// Script runs as a completely separate process with no way to see or
// respect that lock — clearing here could wipe out rows a human is
// actively reviewing on the dashboard at the same moment. An upsert-only
// write can never destroy anything that was already there. Returns false
// (nothing written) when the tab doesn't exist — the caller treats that
// exactly like "waited and nothing came back": send without it.
function pushUnresolvedToLeadFollowups_(ss, entries) {
  if (!entries.length) return false;
  const sheet = ss.getSheetByName(LEAD_FOLLOWUPS_SHEET_);
  if (!sheet) return false;

  return withRetry_(function () {
    const lastRow = sheet.getLastRow();
    const rowNumberByLeadId = {};
    if (lastRow >= 2) {
      sheet.getRange(2, 1, lastRow - 1, 1).getValues().forEach(function (r, i) {
        const id = String((r && r[0]) || '').trim();
        if (id) rowNumberByLeadId[id] = i + 2;
      });
    }
    const updatedAt = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss');
    entries.forEach(function (e) {
      const rowNum = rowNumberByLeadId[e.lead_id];
      if (rowNum) {
        sheet.getRange(rowNum, 1, 1, 5).setValues([[e.lead_id, e.region, e.RM, e.issue, e.comments]]);
        sheet.getRange(rowNum, 7, 1, 1).setValues([[updatedAt]]);
        sheet.getRange(rowNum, 8, 1, 1).setValues([[e.comments]]);
      } else {
        sheet.appendRow([e.lead_id, e.region, e.RM, e.issue, e.comments, '', updatedAt, e.comments]);
      }
    });
    return true;
  }, 'pushUnresolvedToLeadFollowups_');
}

// Bounded version of the dashboard's own waitForAllFollowups
// (js/sheets-writeback.js) — that one polls with NO timeout because a
// human is sitting there and clicks Cancel when they give up. This runs
// from an unattended trigger with nobody to click anything, and Apps
// Script itself has a hard execution-time ceiling, so it polls a FEW times
// (~2 minutes total) and then proceeds with whatever's there, possibly
// partial, possibly empty — same "send without it" outcome either way.
function waitForFollowupSuggestions_(ss, leadIds) {
  const sheet = ss.getSheetByName(LEAD_FOLLOWUPS_SHEET_);
  if (!sheet) return {};
  let lookup = {};
  for (let attempt = 1; attempt <= FOLLOWUP_WAIT_MAX_ATTEMPTS_; attempt++) {
    lookup = withRetry_(function () {
      const lastRow = sheet.getLastRow();
      const out = {};
      if (lastRow < 2) return out;
      sheet.getRange(2, 1, lastRow - 1, 6).getValues().forEach(function (r) {
        const id = String((r && r[0]) || '').trim();
        const suggestion = String((r && r[5]) || '').trim();
        if (id && suggestion) out[id] = suggestion;
      });
      return out;
    }, 'read Lead_Followups suggestions (attempt ' + attempt + ')');
    const missing = leadIds.filter(function (id) { return !lookup[id]; });
    if (!missing.length) return lookup;
    if (attempt < FOLLOWUP_WAIT_MAX_ATTEMPTS_) Utilities.sleep(FOLLOWUP_WAIT_POLL_MS_);
  }
  return lookup; // time's up — whatever's filled in, possibly partial, possibly empty
}

/**
 * 1pm run: for every region logged earlier TODAY, re-checks each of that
 * morning's issue leads against the CURRENT sheet — still flagged for the
 * SAME issue it had at 10am counts as unresolved (shown in red); anything
 * else (issue cleared, lead closed, lead reached Opportunity+, or the lead
 * can no longer be found at all) is dropped from this follow-up entirely.
 *
 * Sends to the SAME to/cc the 10am email resolved (stored in Overnight_Log
 * at send time), NOT via GmailThread.reply()/replyAll() on thread_id —
 * real production bug: reply()/replyAll() target "the sender of the last
 * message on this thread," and since every message in this thread was
 * sent BY the script's own account (nobody has replied inbound yet), that
 * "sender" is the SCRIPT ACCOUNT ITSELF, not the real A1 — every follow-up
 * was silently landing back in the script owner's own inbox instead of
 * the real hierarchy. Neither method's options support overriding "to"
 * (confirmed against Google's own Apps Script reference), so there's no
 * way to fix this by tweaking the reply call — sending a fresh message to
 * the stored recipients, subject prefixed "Re: ", is the only reliable
 * option. thread_id is still logged for manual reference, just no longer
 * used to send. A row logged before this fix (no stored to/cc/subject)
 * is skipped rather than silently reproducing the same wrong-recipient
 * bug — see the skip check below.
 *
 * Before sending, every still-unresolved lead (across every region) is
 * pushed to Lead_Followups and given a short, bounded wait for a human-
 * typed suggested follow-up in column F — see pushUnresolvedToLeadFollowups_
 * and waitForFollowupSuggestions_ above. Two regions are never worth
 * blocking each other over, so this happens ONCE for every region's
 * unresolved leads together, not once per region.
 */
function sendOvernightFollowupEmails() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const now = new Date();
  const todayKey = istDayKeyGs_(now);
  const logSheet = ensureOvernightLogSheet_(ss);
  const lastRow = logSheet.getLastRow();
  if (lastRow < 2) return;

  const logRows = withRetry_(function () { return logSheet.getRange(2, 1, lastRow - 1, 8).getValues(); }, 'read Overnight_Log');
  // Column A was written as a plain "yyyy-MM-dd" string (todayKey), but
  // Sheets auto-detects strings that look like dates and silently stores
  // the cell as a real Date instead — read back, that comes through here
  // as a JS Date object, not the original string. A bare String(r[0]) on
  // that Date never equals todayKey (real production symptom: this always
  // returned zero rows, so the whole function silently no-op'd on every
  // run). Normalize through istDayKeyGs_ for a Date cell, same as every
  // other date-key comparison in this codebase (e.g. MovementTracker.gs).
  const todaysRuns = logRows.filter(function (r) {
    const cell = r[0];
    const key = cell instanceof Date ? istDayKeyGs_(cell) : String(cell);
    return key === todayKey;
  });
  if (!todaysRuns.length) return;

  const { colIndex, dataRows } = readLeadsTab_(ss);
  // buildTodayCallBaselineGs_ (from MovementTracker.gs) reads the whole
  // Movement_Log tab — wrapped at the call site rather than editing that
  // shared file, same retry reasoning as readLeadsTab_ above.
  const baselineMap = withRetry_(function () { return buildTodayCallBaselineGs_(ss, now); }, 'buildTodayCallBaselineGs_');
  const byLeadId = {};
  dataRows.forEach(function (row) {
    const leadId = String(getVal_(row, colIndex, 'lead_id') || '').trim();
    if (leadId) byLeadId[leadId] = row;
  });

  // Pass 1: classify every region's issue leads into resolved/unresolved
  // WITHOUT sending anything yet — every region's still-unresolved leads
  // get pushed to Lead_Followups and waited on together, once, below.
  const perRegion = []; // { region, threadId, to, cc, subject, resolvedRows, unresolvedRows }
  todaysRuns.forEach(function (run) {
    const region = run[1];
    const threadId = run[2];
    const to = String(run[5] || '').trim();
    const cc = String(run[6] || '').trim();
    const subject = String(run[7] || '').trim();
    let issueLog;
    try { issueLog = JSON.parse(run[3] || '[]'); } catch (e) { issueLog = []; }
    if (!issueLog.length) return; // nothing to follow up on for this region

    const resolvedRows = [];
    const unresolvedRows = [];
    issueLog.forEach(function (entry) {
      const row = byLeadId[entry.lead_id];
      if (!row) { resolvedRows.push({ lead_id: entry.lead_id, RM: '', stage: '(not found)', detail: 'No longer in sheet' }); return; }
      const stage = String(getVal_(row, colIndex, 'current_stage') || '').trim();
      const RM = String(getVal_(row, colIndex, 'RM') || '').trim();
      const closingReason = getVal_(row, colIndex, 'closing_reason');
      const leadClosingReason = getVal_(row, colIndex, 'lead_closing_reason');
      if (isOppOrAbove_(stage)) { resolvedRows.push({ lead_id: entry.lead_id, RM: RM, stage: stage, detail: 'Reached Opportunity+' }); return; }
      if (!isOpenLead_(stage, closingReason, leadClosingReason)) { resolvedRows.push({ lead_id: entry.lead_id, RM: RM, stage: stage, detail: 'Closed' }); return; }
      const flags = computeSlaFlags_(row, colIndex, now, baselineMap);
      if (flags[entry.issueKey]) {
        unresolvedRows.push({ lead_id: entry.lead_id, RM: RM, stage: stage, detail: 'Still: ' + entry.issueLabel, region: region, issue: entry.issueLabel, sourceRow: row });
      } else {
        resolvedRows.push({ lead_id: entry.lead_id, RM: RM, stage: stage, detail: 'Resolved (' + entry.issueLabel + ')' });
      }
    });
    perRegion.push({ region: region, threadId: threadId, to: to, cc: cc, subject: subject, resolvedRows: resolvedRows, unresolvedRows: unresolvedRows });
  });

  const allUnresolved = [];
  perRegion.forEach(function (r) { allUnresolved.push.apply(allUnresolved, r.unresolvedRows); });
  let suggestionByLeadId = {};
  if (allUnresolved.length) {
    const pushEntries = allUnresolved.map(function (r) {
      return { lead_id: r.lead_id, region: r.region, RM: r.RM, issue: r.issue, comments: combinedCommentsTextGs_(r.sourceRow, colIndex) };
    });
    const started = pushUnresolvedToLeadFollowups_(ss, pushEntries);
    if (started) {
      suggestionByLeadId = waitForFollowupSuggestions_(ss, allUnresolved.map(function (r) { return r.lead_id; }));
    }
  }

  // Pass 2: send, now that suggestions (if any came back in time) are known.
  // Same renderOvernightReportEmailHTML_ shell the 10am email uses (see its
  // own comment). Red "Still Unresolved" only — same scoping as the
  // dashboard's own Stalled Leads section, which shows only what's
  // currently outstanding, not a resolved/unresolved comparison. A region
  // with nothing still unresolved gets no follow-up reply at all, same
  // reasoning as the morning email dropping Opportunity+/closed leads
  // entirely rather than showing them as a separate "already handled" list.
  perRegion.forEach(function (r) {
    if (!r.unresolvedRows.length) return; // everything from this morning's flags is resolved — nothing to send
    if (!r.to) {
      // This row predates the recipient-storing fix (Overnight_Log only
      // had 5 columns, no to/cc/subject) — GmailThread.reply() on
      // threadId alone would just reproduce the wrong-recipient bug this
      // whole rewrite exists to fix, so skip rather than silently repeat
      // it. Resolves itself the next time sendOvernightMorningEmails runs
      // and logs a row with the new columns filled in.
      Logger.log('Skipping follow-up for ' + r.region + ' (thread ' + r.threadId + '): no stored recipient — this row predates the recipient-storing fix.');
      return;
    }
    r.unresolvedRows.forEach(function (row) { row.suggestion = suggestionByLeadId[row.lead_id] || ''; });

    const sections = [{
      heading: 'Still Unresolved', accent: { fg: '#dc2626', headerBg: '#fee2e2', bg: '#fef2f2' },
      columns: ['Lead ID', 'RM', 'Issue', 'Suggested Follow-up'],
      rows: r.unresolvedRows.map(function (row) { return [row.lead_id, row.RM || 'Unassigned', row.detail, row.suggestion || '—']; }),
    }];

    const bodyHtml = renderOvernightReportEmailHTML_({
      title: '1pm Follow-up',
      region: r.region,
      subtitle: "Re-checking this morning's flagged leads",
      kpis: [
        { value: r.unresolvedRows.length, label: 'Still Unresolved', bg: '#fee2e2', fg: '#dc2626' },
      ],
      sections: sections,
      footerNote: 'A lead counts as still unresolved only if it’s flagged for the SAME issue it had at 10am — anything else (issue cleared, lead closed, lead reached Opportunity+, or no longer found) is dropped from this follow-up rather than shown here.',
    });
    const plainBody = '1pm follow-up for ' + r.region + ': ' + r.unresolvedRows.length + ' still unresolved. Open in Gmail for the full breakdown.';
    const subject = 'Re: ' + (r.subject || (r.region + ' Overnight Leads'));

    try {
      withRetry_(function () {
        return GmailApp.createDraft(r.to, subject, plainBody, {
          cc: r.cc || undefined,
          htmlBody: bodyHtml,
          name: 'Homesfy Lead Ops',
        }).send();
      }, 'send follow-up reply (' + r.region + ')');
    } catch (e) {
      Logger.log('Overnight follow-up reply failed for ' + r.region + ' (thread ' + r.threadId + ', to ' + r.to + '): ' + e);
    }
  });
}

// ONE-OFF: backfills to/cc/subject into TODAY's Overnight_Log rows that
// predate the recipient-storing fix (see sendOvernightFollowupEmails'
// own comment) — run this ONCE, right after pasting the updated file, to
// make today's already-sent morning emails' rows followupable without
// re-sending a duplicate morning email. Reconstructs each row's RM list
// from lead_ids_json (looking each lead_id's RM up in the current leads
// tab) and re-resolves recipients through the SAME
// resolveRecipientEmailsForRegion_ every real send goes through, so the
// backfilled to/cc matches exactly what the original 10am send would
// have produced (assuming RM_Hierarchy/Manager_Directory haven't changed
// since). Safe to run more than once — a row that already has a stored
// `to` is left untouched.
function backfillTodaysOvernightLogRecipients_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const now = new Date();
  const todayKey = istDayKeyGs_(now);
  const dateLabel = Utilities.formatDate(now, 'Asia/Kolkata', 'd MMM yyyy');
  const logSheet = ensureOvernightLogSheet_(ss);
  const lastRow = logSheet.getLastRow();
  if (lastRow < 2) { Logger.log('Overnight_Log is empty — nothing to backfill.'); return; }

  const logRows = withRetry_(function () { return logSheet.getRange(2, 1, lastRow - 1, 8).getValues(); }, 'read Overnight_Log for backfill');
  const { colIndex, dataRows } = readLeadsTab_(ss);
  const rmByLeadId = {};
  dataRows.forEach(function (row) {
    const leadId = String(getVal_(row, colIndex, 'lead_id') || '').trim();
    if (leadId) rmByLeadId[leadId] = String(getVal_(row, colIndex, 'RM') || '').trim() || 'Unassigned';
  });
  const legacyRecipients = loadRegionRecipients_(ss);

  let filled = 0, skippedAlready = 0, skippedNoRms = 0, skippedUnresolved = 0;
  logRows.forEach(function (r, i) {
    const cell = r[0];
    const key = cell instanceof Date ? istDayKeyGs_(cell) : String(cell);
    if (key !== todayKey) return;
    if (String(r[5] || '').trim()) { skippedAlready++; return; } // already has a stored `to`

    const region = r[1];
    let issueLog;
    try { issueLog = JSON.parse(r[3] || '[]'); } catch (e) { issueLog = []; }
    const rmNames = Array.from(new Set(issueLog.map(function (entry) { return rmByLeadId[entry.lead_id]; }).filter(Boolean)));
    if (!rmNames.length) { skippedNoRms++; return; }

    const recEmails = resolveRecipientEmailsForRegion_(ss, region, rmNames, legacyRecipients);
    if (!recEmails.length) { skippedUnresolved++; return; }
    if (recEmails.length > 1) {
      Logger.log('Backfill for ' + region + ' row ' + (i + 2) + ' resolved to ' + recEmails.length + ' buckets instead of 1 — using the first; the RM list reconstructed from lead_ids_json may not exactly match the original bucket.');
    }
    const rec = recEmails[0];
    const subjectSuffix = rec.bucketLabel ? ' (' + rec.bucketLabel + ')' : '';
    const subject = region + ' Overnight Leads - ' + dateLabel + subjectSuffix;

    const rowNum = i + 2;
    withRetry_(function () {
      logSheet.getRange(rowNum, 6, 1, 3).setValues([[rec.to, rec.cc || '', subject]]);
    }, 'backfill Overnight_Log row ' + rowNum);
    filled++;
  });

  Logger.log('Backfill done: ' + filled + ' row(s) filled, ' + skippedAlready + ' already had a recipient, ' +
    skippedNoRms + ' had no resolvable RM, ' + skippedUnresolved + ' had no resolvable recipient at all.');
}

// ---- One-time setup — run this once from the editor ----
function setupOvernightEmailer() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureRegionRecipientsSheet_(ss);
  ensureOvernightLogSheet_(ss);
  setupRmHierarchy(); // RmHierarchy.gs — creates RM_Hierarchy + Manager_Directory

  ScriptApp.getProjectTriggers().forEach(function (t) {
    const fn = t.getHandlerFunction();
    if (fn === 'sendOvernightMorningEmails' || fn === 'sendOvernightFollowupEmails') {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('sendOvernightMorningEmails').timeBased().atHour(10).nearMinute(0).everyDays(1).create();
  ScriptApp.newTrigger('sendOvernightFollowupEmails').timeBased().atHour(13).nearMinute(0).everyDays(1).create();

  Logger.log(
    'Overnight Emailer installed: morning email ~10am IST, follow-up reply ~1pm IST. ' +
    'Recipients are resolved per-RM from RM_Hierarchy + Manager_Directory (fill in emails there) ' +
    'with Region_Recipients as a fallback while that fills in — a region with neither is silently skipped.'
  );
}

// Run manually (function dropdown) to test without waiting for the trigger.
function sendOvernightMorningEmailsNow() { sendOvernightMorningEmails(); }
function sendOvernightFollowupEmailsNow() { sendOvernightFollowupEmails(); }
