/**
 * All-Issues Emailer — automatic email covering every one of the 5
 * Operations SLA checks (Inactive-RM Lead Added / Not Updated / Follow-up
 * Overdue / Behind on Today's Calls / Stuck 48h+), scoped to:
 *   - Source = google, Sub-source = Non-UTM or Search only (see
 *     passesGoogleNonUtmSearchGs_, EmailInfra.gs)
 *   - Leads ASSIGNED in the last 3 calendar days (IST) — TODAY plus the 2
 *     full days before it, e.g. run on the 28th, covers the 26th, 27th,
 *     and 28th in full. NOT a rolling 48-hours-back-from-now window (see
 *     allIssuesWindowGs_'s own comment for why that was a real bug: a
 *     rolling window silently drops whatever was assigned before its
 *     start CLOCK TIME on the earliest day, not the earliest CALENDAR
 *     DAY — e.g. running at 5pm meant everything assigned before 5pm on
 *     the earliest day was excluded, even though that day was supposed
 *     to be fully in scope)
 *
 * Content mirrors the dashboard's own Operations tab: same 5 checks, same
 * priority order when a lead qualifies for more than one (primaryIssueGs_,
 * SlaEngine.gs — the SAME function Operations' own combined view uses),
 * same Suggested Follow-up text (overnightFollowupHintGs_,
 * FollowupEngine.gs). Routing mirrors the overnight emailer exactly:
 * resolveRecipientEmailsForRegion_ (EmailInfra.gs) buckets each region's
 * affected RMs by their own A1/TM/RH manager chain, via
 * resolveRecipientBucketsForRms_ (RmHierarchy.gs) — one email per
 * resolved bucket, not one flat email per region — with the same
 * CH-level diversion (notifyChLevelIssuesGs_ below) and the same "leads
 * not sent" audit (notifyLeadSendFailuresGs_, reused directly from
 * EmailInfra.gs) for anything that couldn't be routed or failed to send.
 *
 * Subject line: "<bucketLabel> (<primaryRole>) google Leads With Issue
 * (<from> to <to>)" — e.g. "Omkar Ghate (A1) google Leads With Issue
 * (26-Aug-2026 to 28-Aug-2026)", or "Ayaz Bagwan (TM) google Leads With
 * Issue (26-Aug-2026 to 28-Aug-2026)" for a bucket whose primary is
 * standing in for RMs with no A1 of their own (same tier variability
 * sendOneOvernightEmail_, OvernightEmailer.gs, already documents —
 * primaryRole is never "CH" here; a CH-tier primary is always
 * self-holding and goes through notifyChLevelIssuesGs_ instead —
 * "<chName> (CH) google Leads With Issue (<from> to <to>)" — same split
 * as the overnight script). The date segment is always the actual
 * calendar-day window this run covers (allIssuesDateRangeLabelGs_), not
 * a single day.
 *
 * ============================== SETUP (one-time) ==============================
 *   1. Same Apps Script project as every other file this project needs —
 *      Core.gs, SlaEngine.gs, FollowupEngine.gs, EmailInfra.gs,
 *      MovementTracker.gs, OvernightEmailer.gs, RmHierarchy.gs, and
 *      RmHierarchy.private.gs (see Core.gs's own header for the full
 *      list) — paste this in as its own file (Apps Script editor → + →
 *      Script → name it AllIssuesEmailer).
 *   2. In the function dropdown, select setupAllIssuesEmailTrigger, click
 *      Run, approve permissions. Installs ONE daily trigger at
 *      ALL_ISSUES_RUN_HOUR_ (5pm IST — one run a day, per explicit
 *      request; edit the constant and re-run this function to change it).
 *   3. To test without emailing real RMs: set TEST_MODE_OVERRIDE_EMAIL_ at
 *      the top of EmailInfra.gs (shared by every script in this project)
 *      to your own address, then run sendAllIssuesEmailsNow from the
 *      function dropdown. Set it back to '' before relying on the real
 *      trigger.
 * ================================================================================
 */

const ALL_ISSUES_LOG_SHEET_ = 'AllIssues_Log';
// Calendar-day window (IST), not a rolling number of hours — how many
// FULL days before TODAY also get included (2 -> today + the 2 days
// before it = 3 calendar days total). Switched from a rolling
// hours-back-from-now window (2026-08-28) after a real reported
// undercount: that design always missed whatever was assigned before its
// own start CLOCK TIME on the earliest day it touched — e.g. a run at 5pm
// meant every lead assigned that morning on the earliest day (before
// 5pm) was silently excluded, not because it was actually meant to be
// out of scope, just because the window's start point happened to land
// partway through that calendar day rather than at its midnight.
const ALL_ISSUES_WINDOW_DAYS_BACK_ = 2;
const ALL_ISSUES_RUN_HOUR_ = 17; // IST (5pm) — one run a day, see setupAllIssuesEmailTrigger below

// TODAY (IST) plus the ALL_ISSUES_WINDOW_DAYS_BACK_ full calendar days
// before it — e.g. run on the 28th, covers the 26th, 27th, and 28th (up
// to whenever this actually runs) in full. Anchored to IST midnight on
// the earliest day, not a fixed number of hours back from `asOf` — see
// ALL_ISSUES_WINDOW_DAYS_BACK_'s own comment for exactly why that
// distinction matters. Deliberately NOT the overnight emailer's fixed
// 5pm-to-9am window (overnightWindowGs_) — this is a genuinely different
// scope (full calendar days, every day, not "since the RM's desk closed
// yesterday").
function allIssuesWindowGs_(asOf) {
  const todayKey = istDayKeyGs_(asOf);
  const todayMidnight = new Date(todayKey + 'T00:00:00+05:30');
  const from = new Date(todayMidnight.getTime() - ALL_ISSUES_WINDOW_DAYS_BACK_ * 24 * 3600 * 1000);
  return { from: from, to: asOf };
}

// Subject-line date segment — e.g. run on the 28th, "(26-Aug-2026 to
// 28-Aug-2026)". Shared by both subject-building sites below (normal
// bucket and CH-level) so the format only has to be right in one place.
function allIssuesDateRangeLabelGs_(win) {
  const fmt = function (d) { return Utilities.formatDate(d, 'Asia/Kolkata', 'dd-MMM-yyyy'); };
  return '(' + fmt(win.from) + ' to ' + fmt(win.to) + ')';
}

function ensureAllIssuesLogSheet_(ss) {
  let sheet = ss.getSheetByName(ALL_ISSUES_LOG_SHEET_);
  const headers = ['date', 'region', 'bucket_label', 'primary_role', 'to', 'cc', 'lead_count', 'sent_at', 'thread_id'];
  if (!sheet) {
    sheet = ss.insertSheet(ALL_ISSUES_LOG_SHEET_);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  const lastCol = sheet.getLastColumn();
  const existingHeaders = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  const existingSet = {};
  existingHeaders.forEach(function (h) { existingSet[String(h || '').trim()] = true; });
  const missing = headers.filter(function (h) { return !existingSet[h]; });
  if (missing.length) sheet.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
  return sheet;
}

/**
 * Main entry point — run manually (sendAllIssuesEmailsNow) or on the
 * trigger installed by setupAllIssuesEmailTrigger. Same overall shape as
 * sendOvernightMorningEmails (OvernightEmailer.gs): read the leads tab
 * once, scan every row through the scope gates, compute each lead's SLA
 * flags, dedupe by customer identity, bucket by region then by resolved
 * hierarchy recipient, send one email per bucket, and finish with one
 * consolidated "not sent" report for anything that couldn't be routed or
 * failed to send.
 */
function sendAllIssuesEmails() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const now = new Date();
  const win = allIssuesWindowGs_(now);
  const { colIndex, dataRows } = readLeadsTab_(ss); // EmailInfra.gs
  const recipients = loadRegionRecipients_(ss); // EmailInfra.gs — legacy fallback, same as overnight
  // Loaded ONCE and threaded through resolveRecipientEmailsForRegion_ below
  // (via opts.hierarchyData) instead of letting each region's own call
  // re-load RM_Hierarchy + Manager_Directory from scratch — see
  // resolveRecipientBucketsForRms_'s own comment (RmHierarchy.gs).
  const hierarchyData = withRetry_(function () { return loadRmHierarchyAndEmails_(ss); }, 'loadRmHierarchyAndEmails_');
  // Real per-lead baseline for the "no comment logged" Suggested Follow-up
  // tier (noCommentFollowUpGs_) — WITHOUT this, every no-comment lead gets
  // the same generic "connect and log the outcome" line regardless of
  // whether the RM has actually been dialing (this was missing from the
  // first version of this script — sendOvernightMorningEmails always
  // computes this and passes the real per-lead entry; this now does too).
  // buildMovementLogMapsGs_ (MovementTracker.gs), not the two separate
  // buildTodayCallBaselineGs_/lastSnapshotBeforeGs_ calls this used to
  // make — those each did their own full read of Movement_Log (the
  // largest sheet in this project), so calling both back to back paid
  // for that read TWICE; this reads it once and derives both maps from
  // the same in-memory rows.
  const movementMaps = withRetry_(function () { return buildMovementLogMapsGs_(ss, now); }, 'buildMovementLogMapsGs_');
  const baselineMap = movementMaps.baselineMap;
  const lastSnapshotMap = movementMaps.lastSnapshotMap;

  // Flat candidate list first, deduped by customer identity, THEN grouped
  // by region — same reasoning as sendOvernightMorningEmails: a customer
  // held by more than one RM at once must not be counted/emailed as two
  // unrelated leads.
  const candidateLeads = [];
  dataRows.forEach(function (row) {
    const leadId = String(getVal_(row, colIndex, 'lead_id') || '').trim();
    if (!leadId) return;

    if (!passesGoogleNonUtmSearchGs_(getVal_(row, colIndex, 'group_source'), getVal_(row, colIndex, 'source_bucket'))) return;

    const createdRaw = getVal_(row, colIndex, 'lead_assigned_at');
    const created = createdRaw instanceof Date ? createdRaw : null;
    if (!created || created < win.from || created > win.to) return; // not assigned in the last 48h

    const rawRegion = getVal_(row, colIndex, 'region');
    const main = mainRegionForGs_(rawRegion);
    if (!main) return; // not one of the 11 configured regions

    const stage = String(getVal_(row, colIndex, 'current_stage') || '').trim();
    const closingReason = getVal_(row, colIndex, 'closing_reason');
    const leadClosingReason = getVal_(row, colIndex, 'lead_closing_reason');
    if (!isOpenLead_(stage, closingReason, leadClosingReason)) return; // closed — no issue to report

    const flags = computeSlaFlags_(row, colIndex, now, baselineMap);
    const issue = primaryIssueGs_(flags); // same priority order Operations' own combined view uses
    if (!issue) return; // open, in scope, but flagged for nothing right now

    const RM = String(getVal_(row, colIndex, 'RM') || '').trim() || 'Unassigned';
    const TL = String(getVal_(row, colIndex, 'TL') || '').trim();
    const clientId = String(getVal_(row, colIndex, 'client_id') || '').trim();
    const stageRank = FUNNEL_ORDER_.indexOf(canonicalStage_(stage) || '');
    const baselineEntry = lastSnapshotMap[clientId || ('l:' + leadId)];

    candidateLeads.push({
      identityKey: clientId || ('l:' + leadId),
      stageRank: stageRank,
      region: main, lead_id: leadId, RM: RM, TL: TL,
      status: overnightStatusLabelGs_(stage),
      issueLabel: issue.label,
      followup: overnightFollowupHintGs_(row, colIndex, now, baselineEntry),
    });
  });

  const byIdentity = new Map();
  let dupedAwayCount = 0;
  candidateLeads.forEach(function (l) {
    const existing = byIdentity.get(l.identityKey);
    if (!existing) { byIdentity.set(l.identityKey, l); return; }
    dupedAwayCount++;
    if (l.stageRank > existing.stageRank) byIdentity.set(l.identityKey, l);
  });
  if (dupedAwayCount) {
    Logger.log(dupedAwayCount + ' duplicate customer row(s) collapsed to a single copy each for this run — kept whichever had progressed furthest.');
  }

  const byRegion = {}; // mainRegion -> flagged leads[]
  byIdentity.forEach(function (l) {
    if (!byRegion[l.region]) byRegion[l.region] = [];
    byRegion[l.region].push({
      lead_id: l.lead_id, RM: l.RM, TL: l.TL,
      status: l.status, issueLabel: l.issueLabel, followup: l.followup,
    });
  });

  const logSheet = ensureAllIssuesLogSheet_(ss);
  const dateLabel = Utilities.formatDate(now, 'Asia/Kolkata', 'd MMM yyyy');
  const todayKey = istDayKeyGs_(now);

  // Idempotency guard — same per-region-per-day pattern
  // sendOvernightMorningEmails uses against Overnight_Log, applied here
  // against AllIssues_Log instead.
  const alreadyLoggedRegionsToday = {};
  const priorLastRow = logSheet.getLastRow();
  if (priorLastRow >= 2) {
    withRetry_(function () { return logSheet.getRange(2, 1, priorLastRow - 1, 2).getValues(); }, 'read AllIssues_Log for idempotency check')
      .forEach(function (r) {
        const cell = r[0];
        const key = cell instanceof Date ? istDayKeyGs_(cell) : String(cell);
        if (key === todayKey) alreadyLoggedRegionsToday[String(r[1] || '').trim()] = true;
      });
  }

  const failedLeadEntries = [];

  Object.keys(byRegion).sort().forEach(function (region) {
    const flaggedLeads = byRegion[region];
    if (!flaggedLeads.length) return;
    if (alreadyLoggedRegionsToday[region]) {
      Logger.log('Skipping ' + region + ' — already has an AllIssues_Log row dated today (' + todayKey + '); not re-sending.');
      return;
    }

    const rmNames = Array.from(new Set(flaggedLeads.map(function (l) { return l.RM; })));
    const rmToLeads = {};
    flaggedLeads.forEach(function (l) {
      if (!rmToLeads[l.RM]) rmToLeads[l.RM] = [];
      rmToLeads[l.RM].push(l);
    });
    const resolution = resolveRecipientEmailsForRegion_(ss, region, rmNames, recipients, { fireAlerts: false, rmToLeads: rmToLeads, dateLabel: dateLabel, hierarchyData: hierarchyData });

    // CH-level self-holding/reports-all-the-way-up RMs — own diversion,
    // same split as the overnight script (resolveRecipientEmailsForRegion_
    // itself doesn't fire this alert when fireAlerts:false, so it's called
    // explicitly here instead). Reads resolution.chLevelRms (which the
    // call just above already computed) instead of calling
    // resolveRecipientBucketsForRms_ a second time with identical
    // arguments — that second call used to double this file's own share
    // of the per-region RM_Hierarchy/Manager_Directory reload cost.
    notifyChLevelIssuesGs_(region, resolution.chLevelRms, rmToLeads, win);

    resolution.trulyUnresolved.forEach(function (u) {
      (rmToLeads[u.rmName] || []).forEach(function (l) {
        failedLeadEntries.push({ lead_id: l.lead_id, RM: u.rmName, to: '', cc: '', reason: u.reason });
      });
    });

    resolution.results.forEach(function (rec) {
      const rmSet = new Set(rec.rmNames);
      const bucketLeads = flaggedLeads.filter(function (l) { return rmSet.has(l.RM); });
      const failure = sendOneAllIssuesEmail_(ss, logSheet, region, rec, bucketLeads, dateLabel, todayKey, now, win);
      if (failure) {
        bucketLeads.forEach(function (l) {
          failedLeadEntries.push({ lead_id: l.lead_id, RM: l.RM, to: rec.to, cc: rec.cc || '', reason: failure.reason });
        });
      }
    });
  });

  // Reused directly from EmailInfra.gs — same shape entries
  // ({lead_id, RM, to, cc, reason}), same consolidated report, sent to
  // the same OPS_ALERT_EMAIL_. No need for a separate copy of this
  // function just because the run that produced the entries is different.
  notifyLeadSendFailuresGs_(failedLeadEntries);
}

// CH-level report for this script's own scope — same visual shell and
// same self-held-vs-reports-up-to split as notifyChLevelLeadsGs_
// (OvernightEmailer.gs), but framed around SLA issues rather than "still
// open overnight", and sent unconditionally (this script always wants to
// know about a CH-tier person personally holding a flagged lead, not just
// when fireAlerts is on — resolveRecipientEmailsForRegion_ is called with
// fireAlerts:false above specifically so ITS OWN overnight-flavored
// CH alert doesn't ALSO fire; this is the one that actually sends for
// this script).
function notifyChLevelIssuesGs_(region, chLevelRms, rmToLeads, win) {
  if (!chLevelRms.length) return;
  const byCh = {};
  chLevelRms.forEach(function (r) {
    if (!byCh[r.chName]) byCh[r.chName] = { chEmail: r.chEmail, chRole: r.chRole, rmNames: [] };
    byCh[r.chName].rmNames.push(r.rmName);
  });
  const dateRangeLabel = allIssuesDateRangeLabelGs_(win);

  Object.keys(byCh).forEach(function (chName) {
    const entry = byCh[chName];
    // Real recorded role (resolveRecipientBucketsForRms_ — "Cluster Head",
    // "City Lead", "Commercial Head", or "Leadership" for someone with no
    // RM_Hierarchy row at all), not a generic "CH" label — matches the
    // same "Name (real role)" shape the normal-bucket subject uses.
    const subject = chName + ' (' + (entry.chRole || 'CH') + ') google Leads With Issue ' + dateRangeLabel;

    const selfRmNames = entry.rmNames.filter(function (n) { return n.toLowerCase() === chName.toLowerCase(); });
    const reportingRmNames = entry.rmNames.filter(function (n) { return n.toLowerCase() !== chName.toLowerCase(); });
    const noteParts = [];
    if (selfRmNames.length) {
      noteParts.push(chName + ' is personally holding ' + (selfRmNames.length === 1 ? 'this lead' : 'these leads') + ' — there\'s nobody below to route it through automatically.');
    }
    if (reportingRmNames.length) {
      noteParts.push('No A1, TM, or RH configured above ' + reportingRmNames.join(', ') + ' — chain resolves all the way up to ' + chName + '.');
    }
    const noteBanner = {
      html: '<div style="background:#fef3c7; border:2px solid #f59e0b; border-radius:8px; padding:12px 16px; margin-bottom:14px; font-family:Arial,Helvetica,sans-serif;">' +
        '<div style="font-weight:700; color:#92400e; font-size:13px;">Sent to Ops — not to ' + esc_(chName) + '</div>' +
        '<div style="color:#78350f; font-size:12.5px; margin-top:4px;">' + esc_(noteParts.join(' ')) + '</div></div>',
      plain: 'NOTE: sent to Ops, not to ' + chName + ' — ' + noteParts.join(' ') + '\n\n',
    };

    const byRM = {};
    entry.rmNames.forEach(function (rmName) {
      const leads = (rmToLeads && rmToLeads[rmName]) || [];
      if (leads.length) byRM[rmName] = leads;
    });
    const rmKeys = Object.keys(byRM).sort();
    const allLeads = [];
    rmKeys.forEach(function (rm) { allLeads.push.apply(allLeads, byRM[rm]); });
    const issueTypeCount = Array.from(new Set(allLeads.map(function (l) { return l.issueLabel; }))).length;

    const html = noteBanner.html + renderOvernightReportEmailHTML_({
      title: 'Leads With Issue',
      region: region,
      subtitle: 'CH-level — ' + chName + ' · Google, Non-UTM/Search · last 48h',
      kpis: [
        { value: allLeads.length, label: allLeads.length === 1 ? 'Lead Flagged' : 'Leads Flagged', bg: '#dbeafe', fg: '#2563eb' },
        { value: rmKeys.length, label: rmKeys.length === 1 ? 'RM Affected' : 'RMs Affected', bg: '#e0e7ff', fg: '#4338ca' },
        { value: issueTypeCount, label: issueTypeCount === 1 ? 'Issue Type' : 'Issue Types', bg: '#fef3c7', fg: '#b45309' },
      ],
      action: 'Review and clear these flags — each is one of the 5 Operations SLA checks (Inactive-RM Lead Added, Not Updated, Follow-up Overdue, Behind on Today\'s Calls, Stuck 48h+).',
      sections: rmKeys.map(function (rm) {
        return {
          heading: rm,
          subheading: rm.toLowerCase() === chName.toLowerCase() ? 'Held directly by ' + chName : 'Reports up to ' + chName,
          columns: ['Lead ID', 'Issue', 'Status', 'Suggested Follow-up'],
          rows: byRM[rm].map(function (l) { return [l.lead_id, l.issueLabel, l.status, l.followup]; }),
        };
      }),
      footerNote: 'This report is normally addressed to the RM\'s own manager chain — sent here instead because ' + chName + ' has nobody below them to route it through automatically. Scope: Source=google, Sub-source=Non-UTM/Search, leads assigned in the last 3 calendar days (today plus the 2 days before it, IST).',
    });
    const plainBody = noteBanner.plain +
      'Region: ' + region + '\n' + 'RM(s): ' + entry.rmNames.join(', ') + '\n' +
      allLeads.length + ' flagged lead(s) across ' + rmKeys.length + ' RM(s). Open this email in Gmail for the full breakdown.';

    try {
      withSendRetry_(function () {
        return GmailApp.createDraft(OPS_ALERT_EMAIL_ + ',' + CH_LEVEL_EMAIL_, subject, plainBody, {
          htmlBody: html, name: 'Homesfy Lead Ops',
        }).send();
      }, 'send CH-level issues report (' + chName + ', ' + region + ')');
    } catch (e) {
      Logger.log('notifyChLevelIssuesGs_ failed to send its report for ' + chName + ' (' + region + '): ' + e);
    }
  });
}

// Builds and sends ONE all-issues email for a single resolved bucket
// (one A1/TM/RH, or the legacy Region_Recipients catch-all). Subject
// format per explicit request: "<primaryRole>/<bucketLabel>/google/Leads
// With Issue/<date>" — e.g. "A1/Omkar Ghate/google/Leads With Issue/27
// Aug 2026". Returns null on success, or {reason} on failure — same
// contract as sendOneOvernightEmail_, so the caller can fold a failure
// into the shared notifyLeadSendFailuresGs_ report.
function sendOneAllIssuesEmail_(ss, logSheet, region, rec, leads, dateLabel, todayKey, now, win) {
  if (!leads.length) return null;

  const byRM = {};
  leads.forEach(function (l) {
    if (!byRM[l.RM]) byRM[l.RM] = { TL: l.TL, leads: [] };
    byRM[l.RM].leads.push(l);
  });
  const rmKeys = Object.keys(byRM).sort();
  const issueTypeCount = Array.from(new Set(leads.map(function (l) { return l.issueLabel; }))).length;

  const subject = rec.bucketLabel + ' (' + rec.primaryRole + ') google Leads With Issue ' + allIssuesDateRangeLabelGs_(win);
  const bucketNote = ' (' + rec.primaryRole + '/' + rec.bucketLabel + ')';

  const testModeBanner = rec.originalTo ? {
    html: '<div style="background:#fef3c7; border:2px solid #f59e0b; border-radius:8px; padding:12px 16px; margin-bottom:14px; font-family:Arial,Helvetica,sans-serif;">' +
      '<div style="font-weight:700; color:#92400e; font-size:13px;">TEST MODE — real send suppressed</div>' +
      '<div style="color:#78350f; font-size:12.5px; margin-top:4px;">This would really have gone to: <b>' + esc_(rec.originalTo) + '</b>' + (rec.originalCc ? ' (cc: ' + esc_(rec.originalCc) + ')' : ' (no cc)') + '</div></div>',
    plain: 'TEST MODE — real send suppressed. This would really have gone to: ' + rec.originalTo + (rec.originalCc ? ' (cc: ' + rec.originalCc + ')' : ' (no cc)') + '\n\n',
  } : null;

  const html = (testModeBanner ? testModeBanner.html : '') + renderOvernightReportEmailHTML_({
    title: 'Leads With Issue',
    region: region,
    subtitle: Utilities.formatDate(win.from, 'Asia/Kolkata', 'd MMM, h:mm a') + ' – ' + Utilities.formatDate(win.to, 'Asia/Kolkata', 'd MMM, h:mm a') + ' IST · Google, Non-UTM/Search',
    kpis: [
      { value: leads.length, label: leads.length === 1 ? 'Lead Flagged' : 'Leads Flagged', bg: '#dbeafe', fg: '#2563eb' },
      { value: rmKeys.length, label: rmKeys.length === 1 ? 'RM Affected' : 'RMs Affected', bg: '#e0e7ff', fg: '#4338ca' },
      { value: issueTypeCount, label: issueTypeCount === 1 ? 'Issue Type' : 'Issue Types', bg: '#fef3c7', fg: '#b45309' },
    ],
    action: 'Review and clear these flags — each is one of the 5 Operations SLA checks (Inactive-RM Lead Added, Not Updated, Follow-up Overdue, Behind on Today\'s Calls, Stuck 48h+).',
    sections: rmKeys.map(function (rm) {
      return {
        heading: rm, subheading: 'Manager: ' + (byRM[rm].TL || '—'),
        columns: ['Lead ID', 'Issue', 'Status', 'Suggested Follow-up'],
        rows: byRM[rm].leads.map(function (l) { return [l.lead_id, l.issueLabel, l.status, l.followup]; }),
      };
    }),
    footerNote: 'Scope: Source=google, Sub-source=Non-UTM/Search, leads assigned in the last 3 calendar days (today plus the 2 days before it, IST). Status/flags reflect the CURRENT live sheet as of this run.',
  });
  const plainBody = (testModeBanner ? testModeBanner.plain : '') + 'Leads with issue for ' + region + bucketNote + ' (' + dateLabel + '): ' + leads.length +
    ' across ' + rmKeys.length + ' RM(s). Open this email in Gmail for the full breakdown.';

  Logger.log('All-issues email recipients for ' + region + bucketNote + ': ' + rec.source);
  let sentMessage;
  try {
    sentMessage = withSendRetry_(function () {
      return GmailApp.createDraft(rec.to, subject, plainBody, {
        cc: rec.cc || undefined, htmlBody: html, name: 'Homesfy Lead Ops',
      }).send();
    }, 'send all-issues email (' + region + bucketNote + ')');
  } catch (e) {
    Logger.log('All-issues email failed for ' + region + bucketNote + ': ' + e);
    // Same "operation not allowed" detection sendOneOvernightEmail_ uses —
    // createDraft(...).send() is two steps chained together, and a real
    // production case showed the DRAFT succeeds while the immediately-
    // following .send() throws this specific error (a Workspace-level send
    // restriction, unrelated to either script's own logic). When that
    // happens the draft is left sitting in Drafts, unsent, and a manual
    // Send from the Gmail UI works fine since the block is on script-driven
    // sends specifically — called out explicitly so the alert is
    // immediately actionable instead of just reporting failure.
    const isSendBlocked = /operation not allowed/i.test(String((e && e.message) || e));
    const failureReason = isSendBlocked
      ? 'Gmail send blocked ("operation not allowed") — check Gmail Drafts for a message to ' + rec.to + ' with subject "' + subject + '", it was very likely created successfully and just needs a manual Send'
      : 'Send error: ' + e;
    try {
      notifyOpsAlertGs_('All-issues email FAILED - ' + region + bucketNote, [
        'Region: ' + region + bucketNote,
        'Intended recipient: ' + rec.to + (rec.cc ? (' (cc: ' + rec.cc + ')') : ''),
        'Leads affected (' + leads.length + '): ' + leads.map(function (l) { return l.lead_id; }).join(', '),
        '',
        'These leads got no automated email this run — this script only covers the trailing 48h window, so tomorrow\'s run will re-check them only if they\'re still inside that window then.',
        isSendBlocked
          ? 'This looks like a Gmail SEND restriction, not a code error — check Gmail Drafts for a message to ' + rec.to + ' with subject "' + subject + '"; it was very likely created successfully and just needs a manual Send, which works fine since the block is on script-driven sends specifically. If this keeps happening, check Google Workspace Admin Console -> Security -> API Controls -> App Access Control for this Apps Script project.'
          : 'Error: ' + e,
      ]);
    } catch (alertErr) {
      Logger.log('notifyOpsAlertGs_ itself failed: ' + alertErr);
    }
    return { reason: failureReason };
  }

  try {
    const threadId = sentMessage ? sentMessage.getThread().getId() : '';
    withRetry_(function () {
      logSheet.appendRow([now, region, rec.bucketLabel, rec.primaryRole, rec.to, rec.cc || '', leads.length, new Date(), threadId]);
    }, 'append AllIssues_Log row (' + region + bucketNote + ')');
  } catch (e) {
    Logger.log('AllIssues_Log write failed for ' + region + bucketNote + ' (email itself sent fine): ' + e);
  }

  return null;
}

function sendAllIssuesEmailsNow() { sendAllIssuesEmails(); }

// One-time setup — installs a single daily trigger at ALL_ISSUES_RUN_HOUR_
// IST. Safe to re-run: clears any trigger this function previously
// installed for sendAllIssuesEmails before adding the new one, so
// changing ALL_ISSUES_RUN_HOUR_ and re-running never leaves a duplicate.
function setupAllIssuesEmailTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendAllIssuesEmails') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendAllIssuesEmails')
    .timeBased()
    .atHour(ALL_ISSUES_RUN_HOUR_)
    .everyDays(1)
    .inTimezone('Asia/Kolkata')
    .create();
  Logger.log('All-Issues Emailer trigger installed — runs daily at ' + ALL_ISSUES_RUN_HOUR_ + ':00 IST.');
}
