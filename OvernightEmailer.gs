/**
 * Overnight Emailer — sends a genuinely UNATTENDED daily email per region at
 * 10am IST (overnight leads: created, flagged issue, or already reached
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
// on attempt 2 and 3, so retrying it three times would only delay
// surfacing the actual problem by ~7 seconds — not swallow it.
function withRetry_(fn, label) {
  const maxAttempts = 3;
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

function ensureRegionRecipientsSheet_(ss) {
  return withRetry_(function () {
    let sheet = ss.getSheetByName(REGION_RECIPIENTS_SHEET_);
    if (sheet) return sheet;
    sheet = ss.insertSheet(REGION_RECIPIENTS_SHEET_);
    sheet.getRange(1, 1, 1, 3).setValues([['region', 'to', 'cc']]);
    sheet.setFrozenRows(1);
    const regions = Array.from(new Set(Object.keys(REGION_GROUP_MAP_).map(function (k) { return REGION_GROUP_MAP_[k]; }))).sort();
    sheet.getRange(2, 1, regions.length, 1).setValues(regions.map(function (r) { return [r]; }));
    return sheet;
  }, 'ensureRegionRecipientsSheet_');
}

// Per-RM-derived recipients for one region's morning email, falling back to
// the legacy flat Region_Recipients entry when nothing could be resolved
// (i.e. Manager_Directory has no email yet for any manager of that day's
// RMs) — keeps the automation sending during the gradual rollout instead of
// going silent the moment RM_Hierarchy exists but emails aren't filled in.
function resolveRecipientsForRegion_(ss, region, rmNames, legacyRecipients) {
  let result;
  const resolved = withRetry_(function () { return resolveRecipientsForRms_(ss, rmNames); }, 'resolveRecipientsForRms_ (' + region + ')');
  if (resolved.to.length) {
    result = { to: resolved.to.join(','), cc: resolved.cc.join(',') || undefined, source: 'RM_Hierarchy (' + resolved.resolvedCount + '/' + resolved.totalCount + ' RMs resolved)' };
  } else {
    const legacy = legacyRecipients[region];
    if (legacy) {
      // ALWAYS_CC_EMAILS_ (RmHierarchy.gs) applies even on the legacy
      // fallback path — it's an unconditional business requirement on every
      // overnight email, not something specific to RM_Hierarchy resolution.
      const ccSet = new Set((legacy.cc || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean));
      ALWAYS_CC_EMAILS_.forEach(function (e) { ccSet.add(e); });
      result = { to: legacy.to, cc: Array.from(ccSet).join(',') || undefined, source: 'Region_Recipients (fallback — no Manager_Directory email resolved for any of this region’s RMs yet)' };
    } else {
      result = null;
    }
  }
  // Single choke point every path above funnels through — see
  // TEST_MODE_OVERRIDE_EMAIL_'s own comment.
  if (result && TEST_MODE_OVERRIDE_EMAIL_) {
    result = { to: TEST_MODE_OVERRIDE_EMAIL_, cc: undefined, source: result.source + ' [TEST MODE — real recipients suppressed, sent to ' + TEST_MODE_OVERRIDE_EMAIL_ + ' only]' };
  }
  return result;
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

function ensureOvernightLogSheet_(ss) {
  return withRetry_(function () {
    let sheet = ss.getSheetByName(OVERNIGHT_LOG_SHEET_);
    const headers = ['date', 'region', 'thread_id', 'lead_ids_json', 'sent_at'];
    if (!sheet) {
      sheet = ss.insertSheet(OVERNIGHT_LOG_SHEET_);
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
    }
    return sheet;
  }, 'ensureOvernightLogSheet_');
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

function emailTableHtml_(title, rows, color) {
  if (!rows.length) return '<p style="font-family:Arial,sans-serif; font-size:13px; color:#6b7280;">' + esc_(title) + ': none.</p>';
  const headerCells = ['Lead ID', 'RM', 'Stage', 'Detail'].map(function (h) {
    return '<td style="padding:6px 10px; font-size:10px; text-transform:uppercase; letter-spacing:.04em; color:#4338ca; background:#eef2ff; font-family:Arial,sans-serif;">' + esc_(h) + '</td>';
  }).join('');
  const bodyRows = rows.map(function (r) {
    return '<tr style="border-top:1px solid #f0f0f0;">' +
      '<td style="padding:6px 10px; font-family:Arial,sans-serif; font-size:12.5px; color:#374151;">' + esc_(r.lead_id) + '</td>' +
      '<td style="padding:6px 10px; font-family:Arial,sans-serif; font-size:12.5px; color:#374151;">' + esc_(r.RM || 'Unassigned') + '</td>' +
      '<td style="padding:6px 10px; font-family:Arial,sans-serif; font-size:12.5px; color:#374151;">' + esc_(r.stage) + '</td>' +
      '<td style="padding:6px 10px; font-family:Arial,sans-serif; font-size:12.5px; font-weight:700; color:' + (color || '#374151') + ';">' + esc_(r.detail) + '</td>' +
      '</tr>';
  }).join('');
  return '<div style="margin-top:14px;">' +
    '<div style="font-family:Arial,sans-serif; font-weight:700; font-size:14px; color:#1f2937; margin-bottom:6px;">' + esc_(title) + ' (' + rows.length + ')</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb; border-radius:6px; border-collapse:collapse;">' +
    '<tr>' + headerCells + '</tr>' + bodyRows + '</table></div>';
}

/**
 * 10am run: builds and sends one email per region with a configured
 * recipient and at least one overnight lead, covering every overnight lead
 * broken into three groups — created (the full list), flagged with an
 * issue, and already reached Opportunity+ — same "whole funnel, not just
 * still-open" scope as the dashboard's own Overnight Leads section. Logs
 * each region's Gmail thread ID and its issue-leads (lead_id + which issue)
 * to Overnight_Log for the 1pm follow-up to read back.
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

  const byRegion = {}; // mainRegion -> { created: [], issues: [], opps: [] }
  dataRows.forEach(function (row) {
    const leadId = String(getVal_(row, colIndex, 'lead_id') || '').trim();
    if (!leadId) return;
    const createdRaw = getVal_(row, colIndex, 'lead_created_at');
    const created = createdRaw instanceof Date ? createdRaw : null;
    if (!created || created < win.from || created > win.to) return; // not an overnight lead

    const rawRegion = getVal_(row, colIndex, 'region');
    const main = mainRegionForGs_(rawRegion);
    if (!main) return; // not one of the 11 configured regions

    if (!byRegion[main]) byRegion[main] = { created: [], issues: [], opps: [] };
    const stage = String(getVal_(row, colIndex, 'current_stage') || '').trim();
    const RM = String(getVal_(row, colIndex, 'RM') || '').trim();
    const entry = { lead_id: leadId, RM: RM, stage: stage };

    byRegion[main].created.push(Object.assign({}, entry, { detail: 'Created' }));

    if (isOppOrAbove_(stage)) {
      byRegion[main].opps.push(Object.assign({}, entry, { detail: 'Opportunity+' }));
      return;
    }
    const closingReason = getVal_(row, colIndex, 'closing_reason');
    const leadClosingReason = getVal_(row, colIndex, 'lead_closing_reason');
    if (!isOpenLead_(stage, closingReason, leadClosingReason)) return; // closed overnight — neither an issue nor an opp

    const flags = computeSlaFlags_(row, colIndex, now, baselineMap);
    const issue = primaryIssueGs_(flags);
    if (issue) {
      byRegion[main].issues.push(Object.assign({}, entry, { detail: issue.label, issueKey: issue.key }));
    }
  });

  const logSheet = ensureOvernightLogSheet_(ss);
  const dateLabel = Utilities.formatDate(now, 'Asia/Kolkata', 'd MMM yyyy');
  const todayKey = istDayKeyGs_(now);

  Object.keys(byRegion).sort().forEach(function (region) {
    const g = byRegion[region];
    if (!g.created.length) return; // nothing overnight for this region

    const rmNames = Array.from(new Set(g.created.map(function (r) { return r.RM; }).filter(Boolean)));
    const rec = resolveRecipientsForRegion_(ss, region, rmNames, recipients);
    if (!rec) return; // no manager email resolved AND no legacy Region_Recipients entry — silently skipped, not a fault

    const subject = region + ' Overnight Leads - ' + dateLabel;
    const bodyHtml =
      '<div style="font-family:Arial,sans-serif; font-size:13px; color:#374151;">' +
      '<p>Overnight leads for <b>' + esc_(region) + '</b> (' + Utilities.formatDate(win.from, 'Asia/Kolkata', 'd MMM, h:mm a') +
      ' – ' + Utilities.formatDate(win.to, 'Asia/Kolkata', 'd MMM, h:mm a') + ' IST):</p>' +
      emailTableHtml_('Leads Created', g.created, '#374151') +
      emailTableHtml_('Flagged With an Issue', g.issues, '#b45309') +
      emailTableHtml_('Already Reached Opportunity+', g.opps, '#059669') +
      '<p style="margin-top:14px; font-size:11px; color:#9ca3af;">A follow-up on this same thread will land around 1pm showing which of the issue leads above are still unresolved.</p>' +
      '</div>';
    const plainBody = 'Overnight leads for ' + region + ' (' + dateLabel + '). Created: ' + g.created.length +
      ', flagged with an issue: ' + g.issues.length + ', already Opportunity+: ' + g.opps.length +
      '. Open this email in Gmail for the full HTML breakdown.';

    Logger.log('Morning email recipients for ' + region + ': ' + rec.source);
    let sentMessage;
    try {
      // Retried: sending the actual email is the one thing here worth
      // fighting for before giving up on a region — a transient Gmail
      // hiccup shouldn't silently skip a whole region's morning email.
      sentMessage = withRetry_(function () {
        return GmailApp.createDraft(rec.to, subject, plainBody, {
          cc: rec.cc || undefined,
          htmlBody: bodyHtml,
          name: 'Homesfy Lead Ops',
        }).send();
      }, 'send morning email (' + region + ')');
    } catch (e) {
      Logger.log('Overnight morning email failed for ' + region + ': ' + e);
      return;
    }

    const threadId = sentMessage.getThread().getId();
    const issueLog = g.issues.map(function (r) { return { lead_id: r.lead_id, issueKey: r.issueKey, issueLabel: r.detail }; });
    withRetry_(function () {
      logSheet.appendRow([todayKey, region, threadId, JSON.stringify(issueLog), Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss')]);
    }, 'log Overnight_Log row (' + region + ')');
  });
}

// Same visual shell as emailTableHtml_, plus a "Suggested Follow-up"
// column when Lead_Followups actually contributed at least one — omitted
// entirely when it didn't, so a run where nobody filled anything in looks
// exactly like the follow-up email always has.
function unresolvedTableHtml_(rows) {
  const anySuggestion = rows.some(function (r) { return r.suggestion; });
  if (!anySuggestion) return emailTableHtml_('Still Unresolved', rows, '#dc2626');
  if (!rows.length) return '<p style="font-family:Arial,sans-serif; font-size:13px; color:#6b7280;">Still Unresolved: none.</p>';
  const headerCells = ['Lead ID', 'RM', 'Stage', 'Detail', 'Suggested Follow-up'].map(function (h) {
    return '<td style="padding:6px 10px; font-size:10px; text-transform:uppercase; letter-spacing:.04em; color:#4338ca; background:#eef2ff; font-family:Arial,sans-serif;">' + esc_(h) + '</td>';
  }).join('');
  const bodyRows = rows.map(function (r) {
    return '<tr style="border-top:1px solid #f0f0f0;">' +
      '<td style="padding:6px 10px; font-family:Arial,sans-serif; font-size:12.5px; color:#374151;">' + esc_(r.lead_id) + '</td>' +
      '<td style="padding:6px 10px; font-family:Arial,sans-serif; font-size:12.5px; color:#374151;">' + esc_(r.RM || 'Unassigned') + '</td>' +
      '<td style="padding:6px 10px; font-family:Arial,sans-serif; font-size:12.5px; color:#374151;">' + esc_(r.stage) + '</td>' +
      '<td style="padding:6px 10px; font-family:Arial,sans-serif; font-size:12.5px; font-weight:700; color:#dc2626;">' + esc_(r.detail) + '</td>' +
      '<td style="padding:6px 10px; font-family:Arial,sans-serif; font-size:12.5px; color:#374151;">' + esc_(r.suggestion || '—') + '</td>' +
      '</tr>';
  }).join('');
  return '<div style="margin-top:14px;">' +
    '<div style="font-family:Arial,sans-serif; font-weight:700; font-size:14px; color:#1f2937; margin-bottom:6px;">Still Unresolved (' + rows.length + ')</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb; border-radius:6px; border-collapse:collapse;">' +
    '<tr>' + headerCells + '</tr>' + bodyRows + '</table></div>';
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
 * can no longer be found at all) counts as resolved. Replies on the exact
 * same Gmail thread the morning email created, so this reads as one
 * conversation, not a second email.
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

  const logRows = withRetry_(function () { return logSheet.getRange(2, 1, lastRow - 1, 5).getValues(); }, 'read Overnight_Log');
  const todaysRuns = logRows.filter(function (r) { return String(r[0]) === todayKey; });
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
  const perRegion = []; // { region, threadId, resolvedRows, unresolvedRows }
  todaysRuns.forEach(function (run) {
    const region = run[1];
    const threadId = run[2];
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
    perRegion.push({ region: region, threadId: threadId, resolvedRows: resolvedRows, unresolvedRows: unresolvedRows });
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
  perRegion.forEach(function (r) {
    r.unresolvedRows.forEach(function (row) { row.suggestion = suggestionByLeadId[row.lead_id] || ''; });

    const bodyHtml =
      '<div style="font-family:Arial,sans-serif; font-size:13px; color:#374151;">' +
      '<p>1pm follow-up for <b>' + esc_(r.region) + '</b> on this morning\'s flagged leads:</p>' +
      unresolvedTableHtml_(r.unresolvedRows) +
      emailTableHtml_('Resolved Since the Morning Email', r.resolvedRows, '#059669') +
      '</div>';
    const plainBody = '1pm follow-up for ' + r.region + ': ' + r.unresolvedRows.length + ' still unresolved, ' +
      r.resolvedRows.length + ' resolved since the morning email. Open in Gmail for the full breakdown.';

    try {
      withRetry_(function () {
        GmailApp.getThreadById(r.threadId).reply(plainBody, { htmlBody: bodyHtml });
      }, 'send follow-up reply (' + r.region + ')');
    } catch (e) {
      Logger.log('Overnight follow-up reply failed for ' + r.region + ' (thread ' + r.threadId + '): ' + e);
    }
  });
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
