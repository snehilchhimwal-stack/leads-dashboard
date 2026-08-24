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
 * recipient list in a new "Region_Recipients" sheet tab instead (created
 * automatically, pre-filled with all 11 region names, To/Cc left blank for
 * you to fill in) — a genuinely separate list from the dashboard's, by
 * necessity, not an oversight.
 *
 * ============================== SETUP (one-time) ==============================
 *   1. Same Apps Script project as MovementTracker.gs (Extensions → Apps
 *      Script). Add a new file, paste this whole thing in.
 *   2. In the function dropdown, select setupOvernightEmailer, click Run.
 *      Approve the permissions prompt (it needs Gmail send + spreadsheet
 *      read/write). This creates Region_Recipients and Overnight_Log, and
 *      installs the 10am/1pm triggers.
 *   3. Open the Region_Recipients tab and fill in a To (and optional Cc)
 *      email address for every region you want an automated email for. A
 *      region left blank is silently skipped — not a fault, same convention
 *      the dashboard's own region-recipient panel uses.
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
    const rec = recipients[region];
    if (!rec) return; // no recipient configured for this region — silently skipped, not a fault
    const g = byRegion[region];
    if (!g.created.length) return; // nothing overnight for this region

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

/**
 * 1pm run: for every region logged earlier TODAY, re-checks each of that
 * morning's issue leads against the CURRENT sheet — still flagged for the
 * SAME issue it had at 10am counts as unresolved (shown in red); anything
 * else (issue cleared, lead closed, lead reached Opportunity+, or the lead
 * can no longer be found at all) counts as resolved. Replies on the exact
 * same Gmail thread the morning email created, so this reads as one
 * conversation, not a second email.
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
        unresolvedRows.push({ lead_id: entry.lead_id, RM: RM, stage: stage, detail: 'Still: ' + entry.issueLabel });
      } else {
        resolvedRows.push({ lead_id: entry.lead_id, RM: RM, stage: stage, detail: 'Resolved (' + entry.issueLabel + ')' });
      }
    });

    const bodyHtml =
      '<div style="font-family:Arial,sans-serif; font-size:13px; color:#374151;">' +
      '<p>1pm follow-up for <b>' + esc_(region) + '</b> on this morning\'s flagged leads:</p>' +
      emailTableHtml_('Still Unresolved', unresolvedRows, '#dc2626') +
      emailTableHtml_('Resolved Since the Morning Email', resolvedRows, '#059669') +
      '</div>';
    const plainBody = '1pm follow-up for ' + region + ': ' + unresolvedRows.length + ' still unresolved, ' +
      resolvedRows.length + ' resolved since the morning email. Open in Gmail for the full breakdown.';

    try {
      withRetry_(function () {
        GmailApp.getThreadById(threadId).reply(plainBody, { htmlBody: bodyHtml });
      }, 'send follow-up reply (' + region + ')');
    } catch (e) {
      Logger.log('Overnight follow-up reply failed for ' + region + ' (thread ' + threadId + '): ' + e);
    }
  });
}

// ---- One-time setup — run this once from the editor ----
function setupOvernightEmailer() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureRegionRecipientsSheet_(ss);
  ensureOvernightLogSheet_(ss);

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
    'Fill in Region_Recipients (To/Cc per region) before relying on the daily trigger — ' +
    'a region left blank there is silently skipped.'
  );
}

// Run manually (function dropdown) to test without waiting for the trigger.
function sendOvernightMorningEmailsNow() { sendOvernightMorningEmails(); }
function sendOvernightFollowupEmailsNow() { sendOvernightFollowupEmails(); }
