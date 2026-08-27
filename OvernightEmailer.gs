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
 * chain (A1/TM/RH/CH, from RmHierarchy.gs's RM_Hierarchy + Manager_Directory
 * sheets) resolved into one bucket per distinct primary — a manager with no
 * flagged RM under them that day gets nothing. If an RM's own chain
 * resolves ALL THE WAY to a real CH (Cluster/Commercial Head/City Lead —
 * meaning they genuinely have no A1, TM, or RH configured above them), OR
 * the RM themselves already IS one (personally holding a lead), that RM's
 * leads are NOT bucketed into a normal email addressed to the CH — instead
 * OPS_ALERT_EMAIL_ + CH_LEVEL_EMAIL_ get the SAME full report every normal
 * recipient gets, naming who actually holds each lead, so a human decides
 * how to route them rather than the
 * CH silently receiving the raw report (see notifyChLevelLeadsGs_). The
 * old flat "Region_Recipients" sheet tab (created automatically, pre-filled
 * with all 11 region names, To/Cc left blank) still exists as a FALLBACK: a
 * region only uses it for whichever RMs had no resolvable chain at all
 * (not in RM_Hierarchy, Excluded, or no email in Manager_Directory) — see
 * resolveRecipientEmailsForRegion_ below.
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
 *   4. For the 1pm follow-up to land in the SAME Gmail thread as the 10am
 *      email (rather than as a separate "Re: ..." conversation), enable the
 *      Advanced Gmail Service ONCE: in the Apps Script editor, click
 *      Services (the + next to "Services" in the left sidebar), find
 *      "Gmail API" in the list, click Add. No code change needed — this
 *      just turns on the `Gmail.*` calls sendThreadedGmailReply_ already
 *      makes. Skipping this step is NOT fatal: sendOvernightFollowupEmails
 *      falls back automatically to a plain new message to the same
 *      recipients (correct people, just not guaranteed to thread) and logs
 *      why — see sendThreadedGmailReply_'s own comment.
 *   5. Test BEFORE trusting the daily trigger: run sendOvernightMorningEmailsNow
 *      from the function dropdown, confirm the email arrives correctly, then
 *      run sendOvernightFollowupEmailsNow and confirm the reply lands in the
 *      SAME thread. I cannot execute Apps Script myself to verify this code
 *      the way the dashboard's own JS was tested this session — please run
 *      this manual check yourselves before relying on the automatic 10am/1pm
 *      firing.
 *   6. Known limitation, same as MovementTracker.gs's own trigger: Apps
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

// Where to alert when this script could NOT get an automated email out at
// all for some region/RM — no resolvable recipient, the send itself
// failed after retries, or a chain resolved all the way to a CH (see
// notifyChLevelLeadsGs_ below). These failures are otherwise invisible
// outside the Apps Script Executions log, which nobody watches
// proactively; see notifyOpsAlertGs_'s own comment for exactly which
// cases trigger this.
const OPS_ALERT_EMAIL_ = 'snehil.chhimwal@homesfy.in';

// Second recipient specifically for CH-level overnight reports (see
// notifyChLevelLeadsGs_) — leads held directly by the CEO or a Cluster
// Head/City Lead, with nobody below them to route through automatically,
// go to OPS_ALERT_EMAIL_ AND this address. Deliberately separate from
// ALWAYS_CC_EMAILS_ (RmHierarchy.gs) — that Cc applies to every normal
// per-RM email; this is scoped to CH-level reports only.
const CH_LEVEL_EMAIL_ = 'ashish.ivlekar@homesfy.in';

// Best-effort alert for a send that could not happen at all this run —
// wrapped in its own try/catch so a failure to send the ALERT itself can
// never take down the real morning/follow-up run it's reporting on. Kept
// deliberately plain-text/no-frills — this is an ops ping, not a report.
// Always to OPS_ALERT_EMAIL_ only, no Cc — notifyChLevelLeadsGs_ used to
// route its own alert through this with a Cc, but sends directly via
// GmailApp.sendEmail now (its own styled HTML + subject format), so
// every remaining caller here is Cc-less already.
function notifyOpsAlertGs_(subject, bodyLines) {
  try {
    GmailApp.sendEmail(OPS_ALERT_EMAIL_, '[Overnight Emailer] ' + subject, bodyLines.join('\n'));
  } catch (e) {
    Logger.log('notifyOpsAlertGs_ failed to send its own alert ("' + subject + '"): ' + e);
  }
}

// Fires whenever resolveRecipientBucketsForRms_ finds an RM whose chain
// resolves all the way up to a real CH (Cluster/Commercial Head/City
// Lead), OR the RM themselves already IS one (personally holding a lead
// with nobody below them, or recognized senior leadership like the CEO
// with no RM_Hierarchy row at all) — see that function's own docblock
// for the real production bug this replaces (a CH silently receiving
// the raw overnight-leads report addressed directly to them). Instead:
// sends the SAME full per-RM report every normal recipient gets
// (renderOvernightReportEmailHTML_ — same KPI cards, same Lead ID /
// Status / Suggested Follow-up columns, grouped by whoever ACTUALLY
// holds each lead) to OPS_ALERT_EMAIL_ + CH_LEVEL_EMAIL_ instead of the
// CH directly — a human decision (add a TL/TM/RH in RM_Hierarchy, or
// handle these personally), not something this script should silently
// paper over by emailing the CH directly. Grouped by CH so one region
// with several such gaps sends one email per CH, not one per RM.
// Deliberately no Cc at all — per explicit request, this goes only to
// OPS_ALERT_EMAIL_ + CH_LEVEL_EMAIL_, not leadership (every other alert
// this file sends still Cc's ALWAYS_CC_EMAILS_).
// Sent via GmailApp.createDraft(...).send() wrapped in withSendRetry_ —
// same reliability treatment as every other real per-RM send, since
// this is now a substantive report, not a bare ops ping.
// rmToLeads (RM name -> array of full lead objects, same shape
// sendOneOvernightEmail_ takes) and dateLabel (the "d MMM yyyy" string
// shared with the real per-RM emails this run) — see
// resolveRecipientEmailsForRegion_'s own comment on both; either can be
// omitted (empty leads, or a freshly-computed dateLabel).
function notifyChLevelLeadsGs_(region, chLevelRms, rmToLeads, dateLabel) {
  if (!chLevelRms.length) return;
  const byCh = {}; // chName -> { chEmail, rmNames: [] }
  chLevelRms.forEach(function (r) {
    if (!byCh[r.chName]) byCh[r.chName] = { chEmail: r.chEmail, rmNames: [] };
    byCh[r.chName].rmNames.push(r.rmName);
  });
  const effectiveDateLabel = dateLabel || Utilities.formatDate(new Date(), 'Asia/Kolkata', 'd MMM yyyy');
  Object.keys(byCh).forEach(function (chName) {
    const entry = byCh[chName];
    const subject = '(' + chName + ') ' + region + ' Google Overnight Leads - ' + effectiveDateLabel;

    // Two genuinely different situations can both land a name in
    // chLevelRms (see resolveRecipientBucketsForRms_): an ordinary RM
    // whose chain resolves UP to this CH (reportingRmNames), or the CH
    // THEMSELVES personally holding a lead with nobody below them
    // (selfRmNames — rmName === chName). Using the same "no A1/TM/RH
    // configured above X — chain resolves up to X" wording for the self
    // case reads circularly ("...above Vidya Jadhav... up to Vidya
    // Jadhav"), so each gets its own explanation; a region can have
    // both in the same run, so both parts can appear together.
    const selfRmNames = entry.rmNames.filter(function (n) { return n.toLowerCase() === chName.toLowerCase(); });
    const reportingRmNames = entry.rmNames.filter(function (n) { return n.toLowerCase() !== chName.toLowerCase(); });
    const noteParts = [];
    if (selfRmNames.length) {
      noteParts.push(chName + ' is personally holding ' + (selfRmNames.length === 1 ? 'this lead' : 'these leads') + ' — there\'s nobody below to route it through automatically.');
    }
    if (reportingRmNames.length) {
      noteParts.push('No A1, TM, or RH configured above ' + reportingRmNames.join(', ') + ' — chain resolves all the way up to ' + chName + '.');
    }
    const actionParts = [];
    if (selfRmNames.length) {
      actionParts.push('Decide whether ' + chName + ' will handle ' + (selfRmNames.length === 1 ? 'this' : 'these') + ' personally, or reassign to an RM under them.');
    }
    if (reportingRmNames.length) {
      actionParts.push('Add a TL/TM/RH for ' + reportingRmNames.join(', ') + ' in RM_Hierarchy, or handle manually.');
    }

    // Same visual mechanism as sendOneOvernightEmail_'s TEST MODE
    // banner — this one explains why the recipient isn't chName despite
    // the subject naming them, since the report body below is otherwise
    // identical to a real per-RM overnight email.
    const noteBanner = {
      html: '<div style="background:#fef3c7; border:2px solid #f59e0b; border-radius:8px; padding:12px 16px; margin-bottom:14px; font-family:Arial,Helvetica,sans-serif;">' +
        '<div style="font-weight:700; color:#92400e; font-size:13px;">Sent to Ops — not to ' + esc_(chName) + '</div>' +
        '<div style="color:#78350f; font-size:12.5px; margin-top:4px;">' + esc_(noteParts.join(' ')) + ' ' + esc_(actionParts.join(' ')) + '</div>' +
        '</div>',
      plain: 'NOTE: sent to Ops, not to ' + chName + ' — ' + noteParts.join(' ') + ' ' + actionParts.join(' ') + '\n\n',
    };

    // Group by whoever ACTUALLY holds each lead (the real RM — Sanket
    // Yadav, say, not Bipin More, for a reporting-up case; the CH's own
    // name for a self-held case) — same grouping sendOneOvernightEmail_
    // uses, so who currently holds each lead is exactly as visible here
    // as in every normal per-RM email.
    const byRM = {};
    entry.rmNames.forEach(function (rmName) {
      const leads = (rmToLeads && rmToLeads[rmName]) || [];
      if (leads.length) byRM[rmName] = leads;
    });
    const rmKeys = Object.keys(byRM).sort();
    const allLeads = [];
    rmKeys.forEach(function (rm) { allLeads.push.apply(allLeads, byRM[rm]); });
    const statusTypeCount = Array.from(new Set(allLeads.map(function (l) { return l.status; }))).length;

    const html = noteBanner.html + renderOvernightReportEmailHTML_({
      title: 'Overnight Leads',
      region: region,
      subtitle: 'CH-level — ' + chName,
      kpis: [
        { value: allLeads.length, label: allLeads.length === 1 ? 'Lead Assigned' : 'Leads Assigned', bg: '#dbeafe', fg: '#2563eb' },
        { value: rmKeys.length, label: rmKeys.length === 1 ? 'RM Affected' : 'RMs Affected', bg: '#e0e7ff', fg: '#4338ca' },
        { value: statusTypeCount, label: statusTypeCount === 1 ? 'Status Type' : 'Status Types', bg: '#fef3c7', fg: '#b45309' },
      ],
      action: "Review and prioritize follow-up on these leads before the rest of today's queue — they came in after hours and may still be waiting on first contact.",
      sections: rmKeys.map(function (rm) {
        return {
          heading: rm,
          subheading: rm.toLowerCase() === chName.toLowerCase() ? 'Held directly by ' + chName : 'Reports up to ' + chName,
          columns: ['Lead ID', 'Status', 'Suggested Follow-up'],
          rows: byRM[rm].map(function (l) { return [l.lead_id, l.status, l.followup]; }),
        };
      }),
      footerNote: 'This report is normally addressed to the RM\'s own manager chain — sent here instead because ' + chName + ' has nobody below them to route it through automatically.',
    });
    const plainBody = noteBanner.plain +
      'Region: ' + region + '\n' +
      'RM(s): ' + entry.rmNames.join(', ') + '\n' +
      allLeads.length + ' lead(s) across ' + rmKeys.length + ' RM(s). Open this email in Gmail for the full breakdown.';

    // Wrapped in its own try/catch, same reasoning as notifyOpsAlertGs_ —
    // a failure to send THIS report must never take down the real
    // morning-send loop it's reporting alongside.
    try {
      withSendRetry_(function () {
        return GmailApp.createDraft(OPS_ALERT_EMAIL_ + ',' + CH_LEVEL_EMAIL_, subject, plainBody, {
          htmlBody: html,
          name: 'Homesfy Lead Ops',
        }).send();
      }, 'send CH-level report (' + chName + ', ' + region + ')');
    } catch (e) {
      Logger.log('notifyChLevelLeadsGs_ failed to send its report for ' + chName + ' (' + region + '): ' + e);
    }
  });
}

// ONE consolidated report, across every region in this run, naming every
// LEAD (not just region/RM) that got no automated overnight email at
// all — either its RM had no resolvable recipient anywhere (not in
// RM_Hierarchy, excluded, no manager email — and no Region_Recipients
// fallback either) or its bucket's real send failed after retries (see
// sendOneOvernightEmail_'s return value). Per explicit request: one row
// per lead with the RM, the computed To/Cc chain (blank when there
// genuinely was none to compute), and the specific reason. Sent to
// OPS_ALERT_EMAIL_ only — this is a diagnostic audit trail for you, not
// a report anyone else needs to see. Entries is
// [{lead_id, RM, to, cc, reason}]. Called once, at the end of
// sendOvernightMorningEmails, rather than per-region — one complete
// picture of everything that didn't go out this run, instead of several
// small alerts scattered across the run.
function notifyLeadSendFailuresGs_(entries) {
  if (!entries.length) return;
  const dateLabel = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'd MMM yyyy');
  const subject = 'Leads NOT sent (' + entries.length + ') - ' + dateLabel;
  const html = renderOvernightReportEmailHTML_({
    title: 'Leads Not Sent',
    region: 'All regions',
    subtitle: entries.length + ' lead(s) got no automated overnight email this run',
    kpis: [
      { value: entries.length, label: entries.length === 1 ? 'Lead Not Sent' : 'Leads Not Sent', bg: '#fee2e2', fg: '#dc2626' },
    ],
    action: 'Review each row below and either fix the underlying RM_Hierarchy/Manager_Directory gap, or follow up on these leads manually — the window is fixed to this morning\'s run, so tomorrow\'s run will NOT retry them.',
    sections: [{
      heading: 'Not Sent', accent: { fg: '#dc2626', headerBg: '#fee2e2', bg: '#fef2f2' },
      columns: ['Lead ID', 'RM', 'To', 'Cc', 'Reason'],
      rows: entries.map(function (e) { return [e.lead_id, e.RM, e.to || '(none)', e.cc || '(none)', e.reason]; }),
    }],
    footerNote: 'This is an internal ops report — not sent to any RM or manager.',
  });
  const plainBody = entries.map(function (e) {
    return 'Lead ' + e.lead_id + ' (RM: ' + e.RM + ') — To: ' + (e.to || '(none)') + ', Cc: ' + (e.cc || '(none)') + ' — ' + e.reason;
  }).join('\n');
  try {
    GmailApp.sendEmail(OPS_ALERT_EMAIL_, subject, plainBody, { htmlBody: html });
  } catch (e) {
    Logger.log('notifyLeadSendFailuresGs_ failed to send its own report: ' + e);
  }
}

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

// Narrower cousin of withRetry_, used ONLY for the actual Gmail send
// calls (sendOneOvernightEmail_, sendThreadedGmailReply_'s caller, and
// the follow-up's plain fallback). withRetry_ itself is deliberately NOT
// used there — a Sheets read/write is safe to blindly retry, but
// retrying a SEND risks creating a genuine duplicate email if the
// original attempt actually succeeded and only the confirmation was
// lost (a "timed out"-class error is exactly this kind of ambiguous —
// see sendOneOvernightEmail_'s own comment on why that stays a single
// attempt). "Gmail operation not allowed" is different: it's Google
// explicitly REFUSING the send, a definitive rejection with no
// ambiguity about whether it went through — it didn't — so retrying
// THIS specific error can't produce a duplicate. Real production case
// this addresses: one run sent 15 emails in ~30 seconds and exactly 2
// failed with this error, each one surrounded by successful sends
// immediately before and after — a persistent policy block would have
// failed every send, not 2 scattered ones, so this reads as a brief,
// intermittent Gmail-side hiccup (plausibly a soft rate-limit reaction
// to sending that many emails in quick succession) that a short retry
// would very likely clear.
function withSendRetry_(fn, label) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return fn();
    } catch (e) {
      const msg = String((e && e.message) || e);
      const isSafeToRetry = /operation not allowed/i.test(msg);
      if (!isSafeToRetry || attempt === maxAttempts) throw e;
      Logger.log((label || 'Gmail send') + ' failed with a definitive rejection, safe to retry (attempt ' + attempt + '/' + maxAttempts + '): ' + msg + ' — retrying in ' + attempt * 2 + 's');
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
// (one email per distinct A1, never several combined into one To) and
// for chLevelRms (RMs whose chain resolves all the way to a real CH —
// diverted to notifyChLevelLeadsGs_ below rather than an email addressed
// to the CH). Whichever RMs couldn't be resolved via RM_Hierarchy at all
// (no chain, excluded, or no email on record) fall back to ONE combined
// email via the legacy Region_Recipients entry — keeps the automation
// sending during the gradual rollout instead of going silent the moment
// RM_Hierarchy exists but some emails aren't filled in yet. Returns an
// array of { to, cc, rmNames, source, bucketLabel, primaryRole } — one
// entry per email that should actually be sent for this region (zero,
// one, or many).
//
// opts.fireAlerts (default false) gates the two REAL side-effect emails
// this function can send (the CH-level alert and the "no recipient"
// alert) — only sendOvernightMorningEmails, the actual unattended send
// path, passes true. Diagnostic/maintenance callers that just need to
// know what a recipient WOULD be (backfillTodaysOvernightLogRecipientsNow)
// leave it false, so re-running them repeatedly while debugging can't
// fire the same real alert (for the CH case) over and
// over as an unintended side effect.
// opts.rmToLeads (optional, RM name -> array of full lead objects, same
// shape sendOneOvernightEmail_ takes) and opts.dateLabel (optional,
// same "d MMM yyyy" string the real per-RM emails use in their subject)
// — only used to pass through to notifyChLevelLeadsGs_ so it can send a
// full per-lead report for CH-held leads, not just a bare lead-ID list.
// Fine to omit both — notifyChLevelLeadsGs_ treats a missing rmToLeads
// entry as no leads to list, and computes its own dateLabel if none is
// passed.
// Returns { results: [...] (same shape as before this comment existed —
// callers that only ever read the array can just take .results),
// trulyUnresolved: [{rmName, reason}] — RMs with NO resolvable recipient
// AND no Region_Recipients fallback either, so their leads got no
// automated email at all this run. Callers with fireAlerts on should
// fold these into the per-lead "not sent" report (see
// sendOvernightMorningEmails) instead of alerting here directly — this
// function no longer sends its own "no recipient" ops alert, since that
// was a region-level summary with no lead-level detail; the caller has
// the actual leads to attribute each unresolved RM's reason to.
function resolveRecipientEmailsForRegion_(ss, region, rmNames, legacyRecipients, opts) {
  const fireAlerts = !!(opts && opts.fireAlerts);
  const rmToLeads = (opts && opts.rmToLeads) || {};
  const dateLabel = (opts && opts.dateLabel) || Utilities.formatDate(new Date(), 'Asia/Kolkata', 'd MMM yyyy');
  const resolved = withRetry_(function () { return resolveRecipientBucketsForRms_(ss, rmNames); }, 'resolveRecipientBucketsForRms_ (' + region + ')');
  const results = resolved.buckets.map(function (b) {
    return { to: b.primaryEmail, cc: b.cc.join(',') || undefined, rmNames: b.rmNames, source: 'RM_Hierarchy (' + b.primaryRole + ': ' + b.primaryName + ')', bucketLabel: b.primaryName, primaryRole: b.primaryRole };
  });

  if (fireAlerts) notifyChLevelLeadsGs_(region, resolved.chLevelRms, rmToLeads, dateLabel);

  let trulyUnresolved = [];
  if (resolved.unresolved.length) {
    const legacy = legacyRecipients[region];
    if (legacy) {
      // ALWAYS_CC_EMAILS_ (RmHierarchy.gs) applies even on the legacy
      // fallback path — it's an unconditional business requirement on every
      // overnight email, not something specific to RM_Hierarchy resolution.
      const ccSet = new Set((legacy.cc || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean));
      ALWAYS_CC_EMAILS_.forEach(function (e) { ccSet.add(e); });
      const unresolvedNames = resolved.unresolved.map(function (u) { return u.rmName; });
      results.push({ to: legacy.to, cc: Array.from(ccSet).join(',') || undefined, rmNames: unresolvedNames, source: 'Region_Recipients (fallback — RM_Hierarchy could not resolve: ' + unresolvedNames.join(', ') + ')', bucketLabel: 'Unmatched RMs', primaryRole: '' });
    } else {
      // No recipient configured anywhere for these RMs — their overnight
      // leads get no automated email at all this run. The caller folds
      // this into the per-lead "not sent" report.
      trulyUnresolved = resolved.unresolved;
    }
  }

  // Single choke point every path above funnels through — see
  // TEST_MODE_OVERRIDE_EMAIL_'s own comment. Bucketing is preserved even in
  // test mode (each bucket still becomes its own email, just redirected)
  // so a test run can actually verify "does each A1 get their own email"
  // instead of collapsing the very thing being tested into one message.
  // originalTo/originalCc carry the REAL resolved recipients through
  // (rather than discarding them) so sendOneOvernightEmail_ can print
  // them visibly inside the test email itself — otherwise the only way
  // to see what a real send would have targeted is digging through the
  // Executions log rather than just reading the email you got.
  if (TEST_MODE_OVERRIDE_EMAIL_) {
    const testResults = results.map(function (r) {
      return { to: TEST_MODE_OVERRIDE_EMAIL_, cc: undefined, rmNames: r.rmNames, source: r.source + ' [TEST MODE — real recipients suppressed, sent to ' + TEST_MODE_OVERRIDE_EMAIL_ + ' only]', bucketLabel: r.bucketLabel, primaryRole: r.primaryRole, originalTo: r.to, originalCc: r.cc };
    });
    return { results: testResults, trulyUnresolved: trulyUnresolved };
  }

  return { results: results, trulyUnresolved: trulyUnresolved };
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

// Port of the dashboard's own suggestedFollowUp (js/core.js) — see
// inferOutcomeGs_/OUTCOME_RULES_GS_/FOLLOWUP_SUGGESTIONS_GS_
// (MovementTracker.gs) for the keyword engine this reads
// combinedCommentsTextGs_ through. Scoped to THIS row's own comments
// only — see latestOutcomeGs_'s own comment for why sibling RM copies of
// the same customer are deliberately NOT pooled in. Real production
// finding: last_connect (a status-text field — "Not Reachable"/
// "Ringing"/"Call Connected"/"Call Declined") and last_connect_time both
// get set on every logged ATTEMPT, not specifically a successful
// connection — so neither field alone can tell a real connection from a
// failed one, and the old hasConnected-only fallback below silently
// treated "Ringing"/"Not Reachable"/"Call Declined" leads as no
// different from "Keep working, no issue" once ANY attempt was logged.
// The keyword engine reads what the comment actually SAYS instead, so
// each of those gets its own specific, actionable suggestion (retry
// timing, alternate channel, etc.) rather than a generic line.
// Priority, same tiers as suggestedFollowUp:
//   1. The latest logged comment on this row's own copy, from this
//      row's own assigned RM (structured action-log entry, or
//      last_comment if no structured entry exists) — its inferred
//      outcome mapped through FOLLOWUP_SUGGESTIONS_GS_, or a quoted "no
//      keyword match" note when the comment has real content but
//      nothing recognizable.
//   2. Once there's truly no owner-logged comment text at all (no entry,
//      or the owner's only logged entry was a blank check-in with no
//      text) — see noCommentFollowUpGs_ below, which reads call_attempts
//      against the last known snapshot instead of guessing from
//      hasConnected/SLA flags.
// now/baselineEntry feed tier 2 only — see noCommentFollowUpGs_.
function overnightFollowupHintGs_(row, colIndex, now, baselineEntry) {
  const latest = latestOutcomeGs_(row, colIndex);
  if (latest && latest.comment) {
    return FOLLOWUP_SUGGESTIONS_GS_[latest.outcome] || unmatchedFollowUpGs_(latest.comment, latest.loggedBy);
  }
  return noCommentFollowUpGs_(row, colIndex, now, baselineEntry);
}

// Fallback for when the lead's own assigned RM hasn't logged any usable
// comment at all — real production case: a lead's only owner-logged
// entry was a blank timestamp check-in ("RM: - 2026-08-25 19:08"), and
// the old wording ("no keyword match found") read as if a real comment
// just didn't match a keyword, when really nothing was said. Says so
// plainly instead, then reads call_attempts against the last known
// Movement_Log snapshot (lastSnapshotBeforeGs_,
// MovementTracker.gs) to tell "genuinely stalled, nobody's dialing" from
// "actively being worked, just not narrated yet" — the two need
// different advice. Only draws that comparison once the baseline
// snapshot is itself at least 4 hours old; a snapshot from 20 minutes
// ago reading "unchanged" doesn't mean much on its own, the RM may
// simply not have re-attempted that recently yet.
function noCommentFollowUpGs_(row, colIndex, now, baselineEntry) {
  if (!baselineEntry || (now.getTime() - baselineEntry.atMs) < 4 * 3600000) {
    return 'No comment added — connect and log the outcome.';
  }
  const currentAttempts = Number(getVal_(row, colIndex, 'call_attempts')) || 0;
  if (currentAttempts <= baselineEntry.call_attempts) {
    return 'No comment added — no new call attempts in over 4 hours. Connect ASAP.';
  }
  const newAttempts = currentAttempts - baselineEntry.call_attempts;
  return 'No comment added — ' + newAttempts + ' more call attempt' + (newAttempts === 1 ? '' : 's') +
    ' made since the last check. Keep trying to connect, and also send a WhatsApp message.';
}

// Single-copy, owner-filtered port of js/core.js's latestFamilyOutcome —
// see that function's own comment for the real production case this
// filtering fixes. Sibling RM copies of the same customer are NOT pooled
// in, and neither is any comment entry logged by someone other than
// THIS row's own assigned RM ("the lead owner") — a note left by a
// different person who'd also touched this row's comment history isn't
// the current owner's own read on the customer, so it shouldn't drive
// what the owner is told to do next.
// Splits combinedCommentsTextGs_'s "Name: Comment - timestamp | ..."
// blob into entries, keeps only the ones logged by this row's own RM
// (all of them, if RM is blank — no owner to filter by), and returns
// whichever remaining entry has the most recent real timestamp AND
// actual text (falling back to considering blank owner-logged entries
// only once NOT ONE has any text; falling back to the last entry parsed
// if none carry a timestamp) as {outcome, comment, loggedBy, ts}. Falls
// back to this row's own last_comment field only once there's not a
// single owner-attributed structured entry. Returns null when this row
// has neither — the caller's cue to fall back to the flags-based hint.
function latestOutcomeGs_(row, colIndex) {
  const ownerName = String(getVal_(row, colIndex, 'RM') || '').trim().toLowerCase();
  const combined = combinedCommentsTextGs_(row, colIndex);
  const text = combined === '(no comments logged)' ? '' : combined;
  const allEntries = [];
  if (text) {
    text.split('|').map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (entry) {
      const m = entry.match(/^(.*?):\s*(.*?)\s*-\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s*$/);
      let loggedBy = '', comment = entry, ts = null;
      if (m) { loggedBy = m[1].trim(); comment = m[2].trim(); ts = m[3].trim(); }
      allEntries.push({ loggedBy: loggedBy, comment: comment, ts: ts, outcome: inferOutcomeGs_(comment) });
    });
  }
  const entries = ownerName ? allEntries.filter(function (e) { return String(e.loggedBy || '').trim().toLowerCase() === ownerName; }) : allEntries;
  if (entries.length) {
    // Prefer the most recent entry that actually SAYS something — a
    // blank entry (a timestamp logged with no comment) is skipped when
    // picking "most recent". Real production case: "Mamtaben Sosa: Not
    // enquired - 2026-08-25 16:44" (a clean, classifiable signal) was
    // getting silently shadowed by a later blank "Mamtaben Sosa: -
    // 2026-08-26 09:03" check-in, purely because it had a newer
    // timestamp — nothing ever looked at whether the entry said
    // anything. Only once NOT ONE owner-logged entry has any text does
    // this fall back to considering blank entries too — "no keyword
    // match, here's the (blank) latest note" is still more honest than
    // silently reverting to an earlier fallback tier (e.g. "no contact
    // made yet") once the owner really did log multiple attempts, just
    // without notes. Mirrors js/core.js's latestFamilyOutcome — keep in
    // sync.
    const withText = entries.filter(function (e) { return e.comment; });
    const candidates = withText.length ? withText : entries;
    let latest = candidates[candidates.length - 1];
    let newestMs = -Infinity;
    candidates.forEach(function (e) {
      if (!e.ts) return;
      const d = new Date(e.ts.replace(' ', 'T') + ':00+05:30');
      if (!isNaN(d.getTime()) && d.getTime() > newestMs) { newestMs = d.getTime(); latest = e; }
    });
    return latest;
  }
  const lastComment = String(getVal_(row, colIndex, 'last_comment') || '').trim();
  if (lastComment) return { outcome: inferOutcomeGs_(lastComment), comment: lastComment, loggedBy: '', ts: null };
  return null;
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
// (subject gets that recipient's name prefixed, since a region can now
// produce several of these and identical subjects would be confusing in
// a shared inbox) or the legacy-fallback catch-all for RMs RM_Hierarchy
// couldn't resolve (prefix is "(Unmatched RMs)" instead). Factored out
// of sendOvernightMorningEmails so that function's per-region loop can
// call this once per bucket instead of once per region.
//
// Subject prefix names the recipient PLAIN when they're a genuine A1
// (the expected/default case — "(Omkar Ghate)"), but adds an explicit
// tier qualifier whenever the bucket's primary is something other than
// an A1 — "(Ayaz Bagwan - TM)", "(Rajkumar Ombase - RH)" — so it's
// immediately obvious from the subject line alone that this recipient is
// standing in because the RM(s) below them have no A1 (or no A1/TM) of
// their own, rather than looking like an ordinary A1's own bucket. A
// bucket's primary is never a CH (see resolveRecipientBucketsForRms_'s
// chLevelRms — those are diverted to notifyChLevelLeadsGs_ instead), so
// no qualifier for that tier is needed here.
// Returns null on success, or { reason } on failure — the caller
// (sendOvernightMorningEmails) uses that to attribute every lead in
// this bucket to the consolidated per-lead "not sent" report (see
// notifyLeadSendFailuresGs_) in addition to the immediate ops alert
// this function still sends below on failure.
function sendOneOvernightEmail_(ss, logSheet, region, rec, leads, dateLabel, todayKey, now, win) {
  if (!leads.length) return null;

  const byRM = {}; // RM -> { TL, leads: [] }
  leads.forEach(function (l) {
    if (!byRM[l.RM]) byRM[l.RM] = { TL: l.TL, leads: [] };
    byRM[l.RM].leads.push(l);
  });
  const rmKeys = Object.keys(byRM).sort();
  const statusTypeCount = Array.from(new Set(leads.map(function (l) { return l.status; }))).length;

  const tierQualifier = (rec.primaryRole && rec.primaryRole !== 'A1') ? ' - ' + rec.primaryRole : '';
  const subjectPrefix = rec.bucketLabel ? '(' + rec.bucketLabel + tierQualifier + ') ' : '';
  // "Google" names the scope explicitly (every lead in this email passed
  // the group_source==="google" gate in sendOvernightMorningEmails, per
  // explicit request) — kept alongside the region rather than replacing
  // it, so the subject still identifies which region at a glance.
  const subject = subjectPrefix + region + ' Google Overnight Leads - ' + dateLabel;
  // Same bucket label + tier qualifier, just suffix-style for the plain
  // body/log line below rather than the subject's new prefix ordering.
  const bucketNote = rec.bucketLabel ? ' (' + rec.bucketLabel + tierQualifier + ')' : '';
  // Present only when TEST_MODE_OVERRIDE_EMAIL_ is active — the REAL
  // resolved recipient the send is currently suppressing, printed
  // directly in the email itself so a tester can see it without digging
  // through the Executions log (see resolveRecipientEmailsForRegion_'s
  // own comment on originalTo/originalCc).
  const testModeBanner = rec.originalTo ? {
    html: '<div style="background:#fef3c7; border:2px solid #f59e0b; border-radius:8px; padding:12px 16px; margin-bottom:14px; font-family:Arial,Helvetica,sans-serif;">' +
      '<div style="font-weight:700; color:#92400e; font-size:13px;">TEST MODE — real send suppressed</div>' +
      '<div style="color:#78350f; font-size:12.5px; margin-top:4px;">This would really have gone to: <b>' + esc_(rec.originalTo) + '</b>' + (rec.originalCc ? ' (cc: ' + esc_(rec.originalCc) + ')' : ' (no cc)') + '</div>' +
      '</div>',
    plain: 'TEST MODE — real send suppressed. This would really have gone to: ' + rec.originalTo + (rec.originalCc ? ' (cc: ' + rec.originalCc + ')' : ' (no cc)') + '\n\n',
  } : null;

  const html = (testModeBanner ? testModeBanner.html : '') + renderOvernightReportEmailHTML_({
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
  const plainBody = (testModeBanner ? testModeBanner.plain : '') + 'Overnight leads for ' + region + bucketNote + ' (' + dateLabel + '): ' + leads.length +
    ' still open across ' + rmKeys.length + ' RM(s). Open this email in Gmail for the full breakdown.';

  Logger.log('Morning email recipients for ' + region + bucketNote + ': ' + rec.source);
  let sentMessage;
  try {
    // withSendRetry_, not withRetry_ — see its own comment. Only retries
    // a definitive "operation not allowed" rejection (safe: Google
    // explicitly refused it, no ambiguity about whether it went out);
    // any other error (e.g. a genuine timeout, where the send might have
    // actually succeeded and only the confirmation was lost) is a single
    // attempt, surfacing as the "failed" alert below rather than risking
    // a silent duplicate to a real recipient.
    sentMessage = withSendRetry_(function () {
      return GmailApp.createDraft(rec.to, subject, plainBody, {
        cc: rec.cc || undefined,
        htmlBody: html,
        name: 'Homesfy Lead Ops',
      }).send();
    }, 'send morning email (' + region + bucketNote + ')');
  } catch (e) {
    Logger.log('Overnight morning email failed for ' + region + bucketNote + ': ' + e);
    // createDraft(...).send() is two steps chained together — a real
    // production case showed the DRAFT succeeds (Google allows composing)
    // while the immediately-following .send() throws "Gmail operation not
    // allowed" (a Workspace-level send restriction, unrelated to this
    // script's own logic — see this exact case's own postmortem). When
    // that happens, the draft is left sitting in Drafts, unsent, and a
    // manual Send from the Gmail UI works fine since the block is on
    // script-driven sends specifically. Called out explicitly here so the
    // alert is immediately actionable instead of just reporting failure.
    const isSendBlocked = /operation not allowed/i.test(String((e && e.message) || e));
    const failureReason = isSendBlocked
      ? 'Gmail send blocked ("operation not allowed") — check Gmail Drafts for a message to ' + rec.to + ' with subject "' + subject + '", it was very likely created successfully and just needs a manual Send'
      : 'Send error: ' + e;
    notifyOpsAlertGs_('Morning email failed for ' + region + bucketNote, [
      'Region: ' + region + bucketNote,
      'Intended recipient: ' + rec.to + (rec.cc ? (' (cc: ' + rec.cc + ')') : ''),
      'Leads affected (' + leads.length + '): ' + leads.map(function (l) { return l.lead_id; }).join(', '),
      '',
      'These leads got no automated email this run — the window is fixed to this morning\'s run only, so tomorrow\'s run will NOT retry them.',
      isSendBlocked
        ? 'This looks like a Gmail SEND restriction, not a code error — check Gmail Drafts for a message to ' + rec.to + ' with subject "' + subject + '"; it was very likely created successfully and just needs a manual Send, which works fine since the block is on script-driven sends specifically. If this keeps happening, check Google Workspace Admin Console -> Security -> API Controls -> App Access Control for this Apps Script project.'
        : 'Error: ' + e,
    ]);
    return { reason: failureReason };
  }

  const threadId = sentMessage.getThread().getId();
  const issueLog = [];
  leads.forEach(function (l) { if (l.issue) issueLog.push({ lead_id: l.lead_id, issueKey: l.issue.key, issueLabel: l.issue.label }); });
  withRetry_(function () {
    logSheet.appendRow([
      todayKey, region, threadId, JSON.stringify(issueLog), Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss'),
      rec.to, rec.cc || '', subject,
    ]);
  }, 'log Overnight_Log row (' + region + bucketNote + ')');
  return null;
}

/**
 * 10am run: builds and sends overnight emails, one PER A1 (Team Lead) —
 * never multiple A1s combined into one "To". Scoped to group_source ===
 * "google" ONLY (checked first, before any other filter — see the gate
 * right at the top of the loop below) — this email is explicitly a
 * Google-leads report, per request, and says so in its own subject line
 * ("... Google Overnight Leads ..."). A region with several Team Leads
 * produces several separate emails, each scoped to just that one A1's
 * own RMs' (Google-source) leads; see resolveRecipientBucketsForRms_ for
 * the exact bucketing rule. Only leads that have NOT reached
 * Opportunity+ and are NOT closed are shown — a lead that already
 * converted or closed overnight needs no follow-up action (same scope as
 * the dashboard's own Overnight Leads email, js/tab-movement.js's
 * overnightEmailableLeads, MINUS that one's lack of a source filter).
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
  // buildTodayCallBaselineGs_/lastSnapshotBeforeGs_ (from
  // MovementTracker.gs) each read the whole Movement_Log tab — wrapped at
  // the call site rather than editing that shared file, same retry
  // reasoning as readLeadsTab_ above. Detailed (keeps each entry's
  // snapshot timestamp) feeds noCommentFollowUpGs_ below.
  const baselineMap = withRetry_(function () { return buildTodayCallBaselineGs_(ss, now); }, 'buildTodayCallBaselineGs_');
  const lastSnapshotMap = withRetry_(function () { return lastSnapshotBeforeGs_(ss, now); }, 'lastSnapshotBeforeGs_');

  // Flat candidate list first, deduped by customer identity below, THEN
  // grouped by region — a customer held by more than one RM at once
  // (sibling copies, including across DIFFERENT regions) would otherwise
  // be counted and emailed as if they were unrelated separate leads, with
  // no indication to either recipient that the other copy exists.
  const candidateLeads = [];
  dataRows.forEach(function (row) {
    const leadId = String(getVal_(row, colIndex, 'lead_id') || '').trim();
    if (!leadId) return;
    // Google-only gate, checked FIRST — before the window/region/stage
    // checks below — per explicit request: this email is scoped to
    // group_source="Google" leads only (see the subject line, which now
    // says "Google Overnight Leads"), so a non-Google lead is excluded
    // before anything else runs on it, not filtered out later alongside
    // the other criteria.
    const groupSource = String(getVal_(row, colIndex, 'group_source') || '').trim().toLowerCase();
    if (groupSource !== 'google') return;
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

    const RM = String(getVal_(row, colIndex, 'RM') || '').trim() || 'Unassigned';
    const TL = String(getVal_(row, colIndex, 'TL') || '').trim();
    const clientId = String(getVal_(row, colIndex, 'client_id') || '').trim();

    const flags = computeSlaFlags_(row, colIndex, now, baselineMap);
    const issue = primaryIssueGs_(flags); // kept on the lead for Overnight_Log — not shown in the email itself
    const baselineEntry = lastSnapshotMap[clientId || ('l:' + leadId)];

    candidateLeads.push({
      identityKey: clientId || ('l:' + leadId), // same customer-identity rule buildMovementHistories (dashboard) and RmHierarchy.gs's CC lookups already use
      stageRank: FUNNEL_ORDER_.indexOf(canonicalStage_(stage) || ''),
      region: main, lead_id: leadId, RM: RM, TL: TL,
      status: overnightStatusLabelGs_(stage),
      followup: overnightFollowupHintGs_(row, colIndex, now, baselineEntry),
      issue: issue,
    });
  });

  // Dedup by customer identity — keep whichever copy has progressed
  // FURTHEST in the funnel, same "stage taken from whichever copy went
  // furthest" preference the dashboard's own sibling collation uses.
  // Deliberately narrower than that full collation (no comment/call
  // merging across copies) — this only fixes double-counting/double-
  // emailing, not full parity with the dashboard's richer merge.
  const byIdentity = new Map();
  let dupedAwayCount = 0;
  candidateLeads.forEach(function (l) {
    const existing = byIdentity.get(l.identityKey);
    if (!existing) { byIdentity.set(l.identityKey, l); return; }
    dupedAwayCount++;
    if (l.stageRank > existing.stageRank) byIdentity.set(l.identityKey, l);
  });
  if (dupedAwayCount) {
    Logger.log(dupedAwayCount + ' duplicate customer row(s) (same client_id held by more than one RM, possibly across different regions) collapsed to a single copy each for this run — kept whichever had progressed furthest.');
  }

  const byRegion = {}; // mainRegion -> openLeads[] (each carries its own .issue)
  byIdentity.forEach(function (l) {
    if (!byRegion[l.region]) byRegion[l.region] = [];
    byRegion[l.region].push({
      lead_id: l.lead_id, RM: l.RM, TL: l.TL,
      status: l.status, followup: l.followup, issue: l.issue,
    });
  });

  const logSheet = ensureOvernightLogSheet_(ss);
  const dateLabel = Utilities.formatDate(now, 'Asia/Kolkata', 'd MMM yyyy');
  const todayKey = istDayKeyGs_(now);

  // Idempotency guard: a region that already has AT LEAST ONE Overnight_Log
  // row dated today is skipped entirely — no re-resolving, no re-sending,
  // no re-alerting. Protects against a rare Apps Script trigger double-fire
  // (a documented platform risk — see MovementTracker.gs/RmHierarchy.gs's
  // own comments on it) or a human manually re-running this alongside the
  // real trigger. Without this, real recipients get duplicate emails,
  // Overnight_Log gets duplicate rows for the same region/day, and the 1pm
  // follow-up then replies into BOTH threads, doubling everything
  // downstream too. Region-level, not per-bucket: a region that only
  // PARTIALLY sent (e.g. one A1's send failed after retries, which already
  // triggers its own "Morning email failed" alert) needs a deliberate
  // manual decision to re-run, not an automatic silent retry of the whole
  // region.
  const alreadyLoggedRegionsToday = {};
  const priorLastRow = logSheet.getLastRow();
  if (priorLastRow >= 2) {
    withRetry_(function () { return logSheet.getRange(2, 1, priorLastRow - 1, 2).getValues(); }, 'read Overnight_Log for idempotency check')
      .forEach(function (r) {
        const cell = r[0];
        const key = cell instanceof Date ? istDayKeyGs_(cell) : String(cell);
        if (key === todayKey) alreadyLoggedRegionsToday[String(r[1] || '').trim()] = true;
      });
  }

  // Collected across every region this run, then reported ONCE at the
  // end — see notifyLeadSendFailuresGs_'s own comment for why this is a
  // single consolidated report rather than several small alerts.
  const failedLeadEntries = [];

  Object.keys(byRegion).sort().forEach(function (region) {
    const openLeads = byRegion[region];
    if (!openLeads.length) return; // nothing still-open overnight for this region
    if (alreadyLoggedRegionsToday[region]) {
      Logger.log('Skipping ' + region + ' — already has an Overnight_Log row dated today (' + todayKey + '); not re-sending. If this region genuinely needs a fresh send today, that has to be a deliberate manual decision, not an automatic one.');
      return;
    }

    const rmNames = Array.from(new Set(openLeads.map(function (l) { return l.RM; })));
    // RM -> its own full lead objects this region/run (same shape
    // sendOneOvernightEmail_ gets) — notifyChLevelLeadsGs_ needs the
    // real lead_id/status/followup, not just IDs, to send a full
    // per-lead report for CH-held leads; see
    // resolveRecipientEmailsForRegion_'s own comment on opts.rmToLeads.
    const rmToLeads = {};
    openLeads.forEach(function (l) {
      if (!rmToLeads[l.RM]) rmToLeads[l.RM] = [];
      rmToLeads[l.RM].push(l);
    });
    const resolution = resolveRecipientEmailsForRegion_(ss, region, rmNames, recipients, { fireAlerts: true, rmToLeads: rmToLeads, dateLabel: dateLabel });

    // RMs with no resolvable recipient anywhere AND no Region_Recipients
    // fallback either — their leads got no automated email at all this
    // run. To/Cc are genuinely blank here (there was none to compute).
    resolution.trulyUnresolved.forEach(function (u) {
      (rmToLeads[u.rmName] || []).forEach(function (l) {
        failedLeadEntries.push({ lead_id: l.lead_id, RM: u.rmName, to: '', cc: '', reason: u.reason });
      });
    });

    resolution.results.forEach(function (rec) {
      const rmSet = new Set(rec.rmNames);
      const bucketLeads = openLeads.filter(function (l) { return rmSet.has(l.RM); });
      const failure = sendOneOvernightEmail_(ss, logSheet, region, rec, bucketLeads, dateLabel, todayKey, now, win);
      if (failure) {
        bucketLeads.forEach(function (l) {
          failedLeadEntries.push({ lead_id: l.lead_id, RM: l.RM, to: rec.to, cc: rec.cc || '', reason: failure.reason });
        });
      }
    });
  });

  notifyLeadSendFailuresGs_(failedLeadEntries);
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
 * Sends a message that lands inside an EXISTING Gmail thread while still
 * controlling exactly who it goes to — something neither of Apps Script's
 * two built-in options can do at once. GmailThread.reply()/replyAll()
 * thread correctly but hard-code the recipient to "the sender of the last
 * message on this thread" (the real wrong-recipient bug described in
 * sendOvernightFollowupEmails' own comment below). A plain
 * GmailApp.createDraft(to, subject, body).send() controls the recipient
 * but sets no RFC822 threading headers, so Gmail only threads it by a
 * subject-text heuristic that does not reliably fire for messages sent
 * this way — confirmed live: a "Re: ..." follow-up landed as its own
 * separate conversation instead of inside the 10am thread.
 *
 * This uses the Advanced Gmail Service (Apps Script editor -> Services
 * (+) -> "Gmail API" — MUST be enabled once for this project, or every
 * call here throws "Gmail is not defined") to send a raw MIME message
 * carrying In-Reply-To/References headers copied from the thread's own
 * last message, PLUS an explicit threadId — the combination Gmail
 * documents as the reliable way to land an arbitrary-recipient message
 * inside a specific existing thread. Throws on any failure (Advanced
 * Service not enabled, thread lookup failure, send failure); the caller
 * decides whether to fall back.
 *
 * The Threads.get read is retried with withRetry_ (a safe, idempotent
 * lookup); the final Messages.send uses the narrower withSendRetry_ —
 * only retries a definitive "operation not allowed" rejection, never an
 * ambiguous timeout that might mean the send already went through. See
 * withSendRetry_'s own comment for the real production case this covers.
 */
function sendThreadedGmailReply_(threadId, to, cc, subject, plainBody, htmlBody) {
  const thread = withRetry_(function () {
    return Gmail.Users.Threads.get('me', threadId, { format: 'metadata', metadataHeaders: ['Message-ID'] });
  }, 'read thread for threaded reply (' + threadId + ')');
  const messages = (thread && thread.messages) || [];
  if (!messages.length) throw new Error('Thread ' + threadId + ' has no messages to reply into.');
  const lastMessage = messages[messages.length - 1];
  const headers = (lastMessage.payload && lastMessage.payload.headers) || [];
  const messageIdHeader = headers.filter(function (h) { return String(h.name || '').toLowerCase() === 'message-id'; })[0];
  const originalMessageId = messageIdHeader ? messageIdHeader.value : null;

  const boundary = 'homesfy_' + Utilities.getUuid().replace(/-/g, '');
  const headerLines = [
    'To: ' + to,
    cc ? 'Cc: ' + cc : null,
    'Subject: ' + subject,
    'MIME-Version: 1.0',
    originalMessageId ? 'In-Reply-To: ' + originalMessageId : null,
    originalMessageId ? 'References: ' + originalMessageId : null,
    'Content-Type: multipart/alternative; boundary="' + boundary + '"',
  ].filter(function (l) { return l !== null; });

  const mime = headerLines.join('\r\n') + '\r\n\r\n' +
    '--' + boundary + '\r\n' +
    'Content-Type: text/plain; charset="UTF-8"\r\n\r\n' +
    plainBody + '\r\n\r\n' +
    '--' + boundary + '\r\n' +
    'Content-Type: text/html; charset="UTF-8"\r\n\r\n' +
    htmlBody + '\r\n\r\n' +
    '--' + boundary + '--';

  const raw = Utilities.base64EncodeWebSafe(Utilities.newBlob(mime).getBytes());
  return withSendRetry_(function () {
    return Gmail.Users.Messages.send({ raw: raw, threadId: threadId }, 'me');
  }, 'send threaded follow-up reply (' + threadId + ')');
}

/**
 * 1pm run: for every region logged earlier TODAY, re-checks each of that
 * morning's issue leads against the CURRENT sheet — still flagged for the
 * SAME issue it had at 10am counts as unresolved (shown in red); anything
 * else (issue cleared, lead closed, lead reached Opportunity+, or the lead
 * can no longer be found at all) is dropped from this follow-up entirely.
 *
 * Sends to the SAME to/cc the 10am email resolved (stored in Overnight_Log
 * at send time), threaded into that SAME thread_id via
 * sendThreadedGmailReply_ (see its own comment above) rather than
 * GmailThread.reply()/replyAll() — real production bug: reply()/replyAll()
 * target "the sender of the last message on this thread," and since every
 * message in this thread was sent BY the script's own account (nobody has
 * replied inbound yet), that "sender" is the SCRIPT ACCOUNT ITSELF, not
 * the real A1 — every follow-up was silently landing back in the script
 * owner's own inbox instead of the real hierarchy. Neither reply() nor
 * replyAll()'s options support overriding "to" (confirmed against
 * Google's own Apps Script reference), so there's no way to fix this by
 * tweaking the reply call. If the Advanced Gmail Service isn't enabled
 * (Services (+) -> "Gmail API" in the Apps Script editor), the threaded
 * send throws and this falls back to a plain new "Re: " message to the
 * stored recipients — correct recipients, just not guaranteed to thread.
 * A row logged before the recipient-storing fix (no stored to/cc/subject)
 * is skipped rather than silently reproducing the old wrong-recipient bug
 * — see the skip check below.
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
  // buildTodayCallBaselineGs_/lastSnapshotBeforeGs_ (from
  // MovementTracker.gs) each read the whole Movement_Log tab — wrapped at
  // the call site rather than editing that shared file, same retry
  // reasoning as readLeadsTab_ above. Detailed feeds noCommentFollowUpGs_.
  const baselineMap = withRetry_(function () { return buildTodayCallBaselineGs_(ss, now); }, 'buildTodayCallBaselineGs_');
  const lastSnapshotMap = withRetry_(function () { return lastSnapshotBeforeGs_(ss, now); }, 'lastSnapshotBeforeGs_');
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
        const clientId = String(getVal_(row, colIndex, 'client_id') || '').trim();
        const baselineEntry = lastSnapshotMap[clientId || ('l:' + entry.lead_id)];
        unresolvedRows.push({ lead_id: entry.lead_id, RM: RM, stage: stage, detail: 'Still: ' + entry.issueLabel, region: region, issue: entry.issueLabel, sourceRow: row, baselineEntry: baselineEntry });
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
    // Prefer the dashboard's own richer, sibling-pooled suggestion
    // (waitForFollowupSuggestions_ above, up to ~2 minutes) when it came
    // back in time; otherwise fall back to the SAME keyword engine the
    // 10am email uses (overnightFollowupHintGs_) instead of leaving this
    // blank — previously a slow/absent dashboard response meant this
    // column just showed "—" with nothing actionable in it.
    r.unresolvedRows.forEach(function (row) {
      row.suggestion = suggestionByLeadId[row.lead_id] || overnightFollowupHintGs_(row.sourceRow, colIndex, now, row.baselineEntry);
    });

    const sections = [{
      heading: 'Still Unresolved', accent: { fg: '#dc2626', headerBg: '#fee2e2', bg: '#fef2f2' },
      columns: ['Lead ID', 'RM', 'Issue', 'Suggested Follow-up'],
      rows: r.unresolvedRows.map(function (row) { return [row.lead_id, row.RM || 'Unassigned', row.detail, row.suggestion || '—']; }),
    }];

    // TEST_MODE_OVERRIDE_EMAIL_ redirects the morning send, but r.to/r.cc
    // here come straight from whatever was ALREADY STORED in
    // Overnight_Log — if that row was logged by a REAL (non-test) morning
    // run, sending this follow-up under test mode would otherwise reach
    // the real people, defeating the whole point of the override. Same
    // "never reach a real recipient during a test run" guarantee as the
    // morning path, applied here explicitly since this function reads
    // stored recipients rather than re-resolving them.
    const sendTo = TEST_MODE_OVERRIDE_EMAIL_ || r.to;
    const sendCc = TEST_MODE_OVERRIDE_EMAIL_ ? undefined : (r.cc || undefined);
    const testModeBanner = TEST_MODE_OVERRIDE_EMAIL_ ? {
      html: '<div style="background:#fef3c7; border:2px solid #f59e0b; border-radius:8px; padding:12px 16px; margin-bottom:14px; font-family:Arial,Helvetica,sans-serif;">' +
        '<div style="font-weight:700; color:#92400e; font-size:13px;">TEST MODE — real send suppressed</div>' +
        '<div style="color:#78350f; font-size:12.5px; margin-top:4px;">This would really have gone to: <b>' + esc_(r.to) + '</b>' + (r.cc ? ' (cc: ' + esc_(r.cc) + ')' : ' (no cc)') + '</div>' +
        '</div>',
      plain: 'TEST MODE — real send suppressed. This would really have gone to: ' + r.to + (r.cc ? ' (cc: ' + r.cc + ')' : ' (no cc)') + '\n\n',
    } : null;

    const bodyHtml = (testModeBanner ? testModeBanner.html : '') + renderOvernightReportEmailHTML_({
      title: '1pm Follow-up',
      region: r.region,
      subtitle: "Re-checking this morning's flagged leads",
      kpis: [
        { value: r.unresolvedRows.length, label: 'Still Unresolved', bg: '#fee2e2', fg: '#dc2626' },
      ],
      sections: sections,
      footerNote: 'A lead counts as still unresolved only if it’s flagged for the SAME issue it had at 10am — anything else (issue cleared, lead closed, lead reached Opportunity+, or no longer found) is dropped from this follow-up rather than shown here.',
    });
    const plainBody = (testModeBanner ? testModeBanner.plain : '') + '1pm follow-up for ' + r.region + ': ' + r.unresolvedRows.length + ' still unresolved. Open in Gmail for the full breakdown.';
    const subject = 'Re: ' + (r.subject || (r.region + ' Google Overnight Leads'));

    // sendThreadedGmailReply_ retries its own send step internally
    // (withSendRetry_ — only a definitive rejection, never an ambiguous
    // timeout). The plain fallback below gets the same treatment
    // explicitly, for the same reason.
    try {
      sendThreadedGmailReply_(r.threadId, sendTo, sendCc || '', subject, plainBody, bodyHtml);
    } catch (threadErr) {
      Logger.log('Threaded send failed for ' + r.region + ' (thread ' + r.threadId + ') — falling back to a new message that will NOT auto-thread into the 10am email. Likely cause: the "Gmail API" Advanced Service isn\'t enabled yet (Apps Script editor -> Services (+)). Error: ' + threadErr);
      try {
        withSendRetry_(function () {
          return GmailApp.createDraft(sendTo, subject, plainBody, {
            cc: sendCc,
            htmlBody: bodyHtml,
            name: 'Homesfy Lead Ops',
          }).send();
        }, 'send fallback follow-up (' + r.region + ')');
      } catch (fallbackErr) {
        Logger.log('Overnight follow-up reply failed entirely for ' + r.region + ' (thread ' + r.threadId + ', to ' + r.to + '): ' + fallbackErr);
        notifyOpsAlertGs_('1pm follow-up failed for ' + r.region, [
          'Region: ' + r.region,
          'Thread: ' + r.threadId,
          'Intended recipient: ' + r.to + (r.cc ? (' (cc: ' + r.cc + ')') : ''),
          'Still-unresolved leads affected (' + r.unresolvedRows.length + '): ' + r.unresolvedRows.map(function (row) { return row.lead_id; }).join(', '),
          '',
          'No follow-up email went out for this region this run — neither the threaded send nor the plain fallback succeeded.',
          'Error: ' + fallbackErr,
        ]);
      }
    }
  });
}

// ONE-OFF: backfills to/cc/subject into TODAY's Overnight_Log rows that
// predate the recipient-storing fix (see sendOvernightFollowupEmails'
// own comment) — run this right after pasting an updated file, to make
// today's already-sent morning emails' rows followupable without
// re-sending a duplicate morning email. Reconstructs each row's RM list
// from lead_ids_json (looking each lead_id's RM up in the current leads
// tab) and re-resolves recipients through the SAME
// resolveRecipientEmailsForRegion_ every real send goes through, so the
// backfilled to/cc matches exactly what the original 10am send would
// have produced (assuming RM_Hierarchy/Manager_Directory haven't changed
// since). NOTE: lead_ids_json only ever holds leads flagged for an SLA
// issue that morning, not every overnight lead — a region whose flagged
// lead's own RM isn't resolvable via RM_Hierarchy (and has no
// Region_Recipients fallback) still won't get a backfilled recipient
// here, even if the original send resolved fine from a broader RM set.
// Safe to run more than once — a row that already has a stored `to` is
// left untouched. NAMED WITHOUT A TRAILING UNDERSCORE, unlike its
// original name — see debugFollowupStatusNow's own comment for why.
function backfillTodaysOvernightLogRecipientsNow() {
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
    if (!rmNames.length) {
      skippedNoRms++;
      // Named explicitly rather than just counted — this means every
      // lead_id in this row's issueLog came back "not found" in the
      // current leads tab (rmByLeadId has no entry for it), most likely
      // because the lead was deleted, merged, or its id changed since
      // this morning. Since the same lookup happens in
      // sendOvernightFollowupEmails/debugFollowupStatusNow, those leads
      // would show as "resolved (no longer in sheet)" there too — this
      // row very likely has nothing left to actually follow up on anyway.
      Logger.log('Backfill for ' + region + ' row ' + (i + 2) + ' (thread ' + r[2] + '): no resolvable RM — every lead_id in this row\'s issueLog (' +
        issueLog.map(function (e) { return e.lead_id; }).join(', ') + ') is no longer found in the current leads tab.');
      return;
    }

    // No opts passed — fireAlerts stays false, so re-running this backfill
    // (safe/idempotent by design) can't also re-fire a real CH-level or
    // "no recipient" alert every time.
    const recEmails = resolveRecipientEmailsForRegion_(ss, region, rmNames, legacyRecipients).results;
    if (!recEmails.length) { skippedUnresolved++; return; }
    if (recEmails.length > 1) {
      Logger.log('Backfill for ' + region + ' row ' + (i + 2) + ' resolved to ' + recEmails.length + ' buckets instead of 1 — using the first; the RM list reconstructed from lead_ids_json may not exactly match the original bucket.');
    }
    const rec = recEmails[0];
    // Mirrors sendOneOvernightEmail_'s own subject construction exactly —
    // a backfilled row's subject must match what the real send would
    // have produced.
    const tierQualifier = (rec.primaryRole && rec.primaryRole !== 'A1') ? ' - ' + rec.primaryRole : '';
    const subjectPrefix = rec.bucketLabel ? '(' + rec.bucketLabel + tierQualifier + ') ' : '';
    const subject = subjectPrefix + region + ' Google Overnight Leads - ' + dateLabel;

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

// ONE-OFF DIAGNOSTIC — writes one row per TODAY's overnight-eligible lead
// whose Suggested Follow-up would be noCommentFollowUpGs_'s "no comment
// added" branch (owner-filtered — see latestOutcomeGs_'s own comment) —
// i.e. no usable comment text, only whatever call_attempts/baseline
// comparison text applies — into a fresh "Debug_NoIssueLeads" sheet tab —
// the actual comment history behind each one, so it can be reviewed (or
// File -> Download -> CSV'd) rather than guessed at. This does NOT mean
// something's wrong; the morning email lists every still-open overnight
// lead regardless of flag status (see sendOvernightMorningEmails' own
// comment), so a lead whose owner simply hasn't logged anything yet
// legitimately lands here. This tool exists so that can be CONFIRMED
// against the real comment text for each one, rather than taken on
// faith. Read-only against the leads tab; only touches its own new
// debug sheet tab, safe to re-run any time (always replaces it fresh).
function downloadNoIssueLeadsNow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const now = new Date();
  const win = overnightWindowGs_(now);
  const { colIndex, dataRows } = readLeadsTab_(ss);
  const lastSnapshotMap = withRetry_(function () { return lastSnapshotBeforeGs_(ss, now); }, 'lastSnapshotBeforeGs_');

  const headers = [
    'lead_id', 'RM', 'TL', 'region', 'group_source', 'current_stage', 'lead_assigned_at',
    'last_connect', 'last_connect_time', 'internal_status_comments', 'stage_comments',
  ];
  const rows = [];
  dataRows.forEach(function (row) {
    const leadId = String(getVal_(row, colIndex, 'lead_id') || '').trim();
    if (!leadId) return;
    const groupSource = String(getVal_(row, colIndex, 'group_source') || '').trim().toLowerCase();
    if (groupSource !== 'google') return; // same Google-only scope as the real morning email
    const createdRaw = getVal_(row, colIndex, 'lead_assigned_at');
    const created = createdRaw instanceof Date ? createdRaw : null;
    if (!created || created < win.from || created > win.to) return;
    const rawRegion = getVal_(row, colIndex, 'region');
    const main = mainRegionForGs_(rawRegion);
    if (!main) return;
    const stage = String(getVal_(row, colIndex, 'current_stage') || '').trim();
    if (isOppOrAbove_(stage)) return;
    const closingReason = getVal_(row, colIndex, 'closing_reason');
    const leadClosingReason = getVal_(row, colIndex, 'lead_closing_reason');
    if (!isOpenLead_(stage, closingReason, leadClosingReason)) return;

    const clientId = String(getVal_(row, colIndex, 'client_id') || '').trim();
    const baselineEntry = lastSnapshotMap[clientId || ('l:' + leadId)];
    const hint = overnightFollowupHintGs_(row, colIndex, now, baselineEntry);
    if (hint.indexOf('No comment added') !== 0) return; // only the leads landing on the no-usable-comment branch

    rows.push([
      leadId,
      String(getVal_(row, colIndex, 'RM') || '').trim() || 'Unassigned',
      String(getVal_(row, colIndex, 'TL') || '').trim(),
      main,
      String(getVal_(row, colIndex, 'group_source') || '').trim(),
      stage,
      created,
      String(getVal_(row, colIndex, 'last_connect') || '').trim(),
      getVal_(row, colIndex, 'last_connect_time'),
      String(getVal_(row, colIndex, 'internal_status_comments') || '').trim(),
      String(getVal_(row, colIndex, 'stage_comments') || '').trim(),
    ]);
  });

  const sheetName = 'Debug_NoIssueLeads';
  let sheet = ss.getSheetByName(sheetName);
  if (sheet) { withRetry_(function () { ss.deleteSheet(sheet); }, 'delete old Debug_NoIssueLeads'); SpreadsheetApp.flush(); }
  sheet = withRetry_(function () { return ss.insertSheet(sheetName); }, 'insert Debug_NoIssueLeads');
  SpreadsheetApp.flush();
  withRetry_(function () {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }, 'write Debug_NoIssueLeads header');
  if (rows.length) withRetry_(function () { sheet.getRange(2, 1, rows.length, headers.length).setValues(rows); }, 'write Debug_NoIssueLeads rows');

  Logger.log('Wrote ' + rows.length + ' lead(s) with no owner-logged comment (today\'s overnight window) to the "' + sheetName + '" sheet tab — open it, review the last two columns\' real comment text, then File -> Download -> CSV if you want to export it.');
}

// ONE-OFF DIAGNOSTIC — run this from the function dropdown, then View →
// Logs (or Executions → click the run → View log) to see exactly why no
// 1pm follow-up went out today. Read-only: sends nothing, writes nothing.
// Walks the EXACT same logic sendOvernightFollowupEmails does, but logs
// every decision point instead of silently skipping, so it's possible to
// see which specific branch is producing "nothing to send" — no rows
// logged for today at all, a row with no stored recipient, or a region
// where every one of this morning's flagged leads has genuinely already
// resolved.
// NAMED WITHOUT A TRAILING UNDERSCORE ON PURPOSE, unlike every other
// helper in this file — Apps Script's editor treats a trailing underscore
// as "private" and silently omits it from the Run/Debug function dropdown
// (confirmed: none of this file's real _-suffixed helpers show up there
// either). Every other function meant to be run manually from the editor
// (setupOvernightEmailer, sendOvernightMorningEmailsNow, etc.) already
// follows this same no-underscore convention for exactly this reason.
function debugFollowupStatusNow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const now = new Date();
  const todayKey = istDayKeyGs_(now);
  Logger.log('=== debugFollowupStatusNow — today (IST) = ' + todayKey + ', run at ' + Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss') + ' ===');

  const logSheet = ensureOvernightLogSheet_(ss);
  const lastRow = logSheet.getLastRow();
  if (lastRow < 2) { Logger.log('Overnight_Log has NO rows at all (lastRow=' + lastRow + '). The 10am morning email has never logged anything in this sheet — check whether sendOvernightMorningEmails has ever run (Executions log).'); return; }

  const logRows = withRetry_(function () { return logSheet.getRange(2, 1, lastRow - 1, 8).getValues(); }, 'debug: read Overnight_Log');
  Logger.log('Overnight_Log has ' + logRows.length + ' total row(s). Last 3 rows\' date cells: ' +
    logRows.slice(-3).map(function (r) { const c = r[0]; return c instanceof Date ? istDayKeyGs_(c) + ' (Date)' : JSON.stringify(c) + ' (' + typeof c + ')'; }).join(', '));

  const todaysRuns = logRows.filter(function (r) {
    const cell = r[0];
    const key = cell instanceof Date ? istDayKeyGs_(cell) : String(cell);
    return key === todayKey;
  });
  Logger.log('Rows matching TODAY (' + todayKey + '): ' + todaysRuns.length);
  if (!todaysRuns.length) {
    Logger.log('No row in Overnight_Log is dated today. Either sendOvernightMorningEmails has not run yet today, or it ran but every region had zero overnight leads (nothing to log). Check Executions for sendOvernightMorningEmails\' most recent run.');
    return;
  }

  const { colIndex, dataRows } = readLeadsTab_(ss);
  const baselineMap = withRetry_(function () { return buildTodayCallBaselineGs_(ss, now); }, 'debug: buildTodayCallBaselineGs_');
  const byLeadId = {};
  dataRows.forEach(function (row) {
    const leadId = String(getVal_(row, colIndex, 'lead_id') || '').trim();
    if (leadId) byLeadId[leadId] = row;
  });

  todaysRuns.forEach(function (run, idx) {
    const region = run[1];
    const threadId = run[2];
    const to = String(run[5] || '').trim();
    const cc = String(run[6] || '').trim();
    const subject = String(run[7] || '').trim();
    Logger.log('--- Row ' + (idx + 1) + '/' + todaysRuns.length + ': region=' + region + ', thread=' + threadId + ' ---');
    Logger.log('  stored to="' + to + '"  cc="' + cc + '"  subject="' + subject + '"' + (to ? '' : '  <<< EMPTY — this row predates the recipient-storing fix, or resolveRecipientEmailsForRegion_ returned nothing for it. sendOvernightFollowupEmails SKIPS this row entirely (see its own comment). Run backfillTodaysOvernightLogRecipientsNow to fix today\'s rows, or wait for tomorrow\'s fresh 10am run.'));

    let issueLog;
    try { issueLog = JSON.parse(run[3] || '[]'); } catch (e) { issueLog = []; }
    Logger.log('  issueLog: ' + issueLog.length + ' lead(s) flagged this morning: ' + issueLog.map(function (e) { return e.lead_id + '(' + e.issueLabel + ')'; }).join(', '));
    if (!issueLog.length) { Logger.log('  Nothing flagged this morning for this region — correctly nothing to follow up on.'); return; }

    let resolvedCount = 0, unresolvedCount = 0;
    const detail = [];
    const rmNamesInLog = [];
    issueLog.forEach(function (entry) {
      const row = byLeadId[entry.lead_id];
      if (!row) { resolvedCount++; detail.push(entry.lead_id + ': resolved (no longer in sheet)'); return; }
      const rm = String(getVal_(row, colIndex, 'RM') || '').trim() || 'Unassigned';
      rmNamesInLog.push(rm);
      const stage = String(getVal_(row, colIndex, 'current_stage') || '').trim();
      const closingReason = getVal_(row, colIndex, 'closing_reason');
      const leadClosingReason = getVal_(row, colIndex, 'lead_closing_reason');
      if (isOppOrAbove_(stage)) { resolvedCount++; detail.push(entry.lead_id + ' (RM: ' + rm + '): resolved (reached Opportunity+, stage="' + stage + '")'); return; }
      if (!isOpenLead_(stage, closingReason, leadClosingReason)) { resolvedCount++; detail.push(entry.lead_id + ' (RM: ' + rm + '): resolved (closed, stage="' + stage + '")'); return; }
      const flags = computeSlaFlags_(row, colIndex, now, baselineMap);
      if (flags[entry.issueKey]) {
        unresolvedCount++;
        detail.push(entry.lead_id + ' (RM: ' + rm + '): STILL UNRESOLVED (' + entry.issueLabel + ', stage="' + stage + '")');
      } else {
        resolvedCount++;
        detail.push(entry.lead_id + ' (RM: ' + rm + '): resolved (issue "' + entry.issueLabel + '" no longer flagged, stage="' + stage + '")');
      }
    });
    detail.forEach(function (d) { Logger.log('    ' + d); });
    Logger.log('  => resolved=' + resolvedCount + ', unresolved=' + unresolvedCount +
      (unresolvedCount > 0 && to ? '  -> a follow-up SHOULD send for this region' :
        unresolvedCount > 0 && !to ? '  -> would send, but SKIPPED because stored `to` is empty (see above)' :
        '  -> correctly nothing to send (everything already resolved)'));

    // When `to` is empty, show EXACTLY why recipient resolution comes up
    // short for this bucket's RM(s) — same call resolveRecipientEmailsForRegion_
    // (and backfillTodaysOvernightLogRecipientsNow) makes, but logging the
    // per-RM chain/email lookup instead of just a pass/fail count, so it's
    // obvious which specific manager needs an email filled into
    // Manager_Directory (or which region needs a Region_Recipients
    // fallback) rather than just knowing "something's missing."
    if (!to && rmNamesInLog.length) {
      const uniqueRms = Array.from(new Set(rmNamesInLog));
      const hierarchyData = withRetry_(function () { return loadRmHierarchyAndEmails_(ss); }, 'debug: loadRmHierarchyAndEmails_');
      Logger.log('  Recipient resolution trace for ' + region + ' (RMs from this row\'s issueLog: ' + uniqueRms.join(', ') + '):');
      uniqueRms.forEach(function (rmName) {
        // lookupRmChain_ (RmHierarchy.gs) — same exact-then-role-suffix-
        // stripped fallback the real resolution uses, so this trace can
        // never disagree with what a real send would actually do.
        const chain = lookupRmChain_(hierarchyData.byRmNameLower, rmName);
        if (!chain) { Logger.log('    ' + rmName + ': NOT FOUND in RM_Hierarchy at all (even after trying with a trailing role/position suffix stripped) — this RM\'s row is missing there entirely.'); return; }
        if (chain.excluded) { Logger.log('    ' + rmName + ': found in RM_Hierarchy but marked Excluded.'); return; }
        // Mirrors resolveRecipientBucketsForRms_ (RmHierarchy.gs) exactly.
        const primaryName = chain.tl || chain.tm || chain.rh || chain.ch || '';
        if (!primaryName) { Logger.log('    ' + rmName + ': found in RM_Hierarchy, but has no TL/TM/RH/CH on record at all.'); return; }
        const primaryEmail = hierarchyData.emailByManagerNameLower[primaryName.toLowerCase()];
        if (!primaryEmail) { Logger.log('    ' + rmName + ': reports to "' + primaryName + '", but that manager has NO EMAIL in Manager_Directory yet — fill it in there to fix this.'); return; }
        // A CH-tier primary is a NORMAL bucket recipient now (per
        // explicit correction) — chLevelRms is reserved for someone AT
        // leadership/CH level THEMSELVES personally holding the lead,
        // not an ordinary RM whose chain merely resolves up to one. So
        // this always resolves fine and should NOT be the reason this
        // row is unresolved.
        Logger.log('    ' + rmName + ': resolves fine (-> ' + primaryName + ' <' + primaryEmail + '>) — should NOT be the reason this row is unresolved; re-check backfillTodaysOvernightLogRecipientsNow\'s output for this region.');
      });
      const legacy = loadRegionRecipients_(ss)[region];
      Logger.log('  Region_Recipients fallback for ' + region + ': ' + (legacy ? ('to="' + legacy.to + '" cc="' + legacy.cc + '"') : 'not configured (blank)'));
    }
  });
  Logger.log('=== end debugFollowupStatusNow ===');
}
