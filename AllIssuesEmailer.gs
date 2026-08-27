/**
 * All-Issues Emailer — automatic email covering every one of the 5
 * Operations SLA checks (Inactive-RM Lead Added / Not Updated / Follow-up
 * Overdue / Behind on Today's Calls / Stuck 48h+), scoped to:
 *   - Source = google, Sub-source = Non-UTM or Search only (see
 *     passesGoogleNonUtmSearchGs_ below)
 *   - Leads ASSIGNED in the last 48 hours (a rolling window ending at
 *     whenever this runs — e.g. run on the 27th, covers leads assigned
 *     from the 25th through the 27th)
 *
 * Content mirrors the dashboard's own Operations tab: same 5 checks, same
 * priority order when a lead qualifies for more than one (primaryIssueGs_,
 * OvernightEmailer.gs — the SAME function Operations' own combined view
 * uses), same Suggested Follow-up text (overnightFollowupHintGs_). Routing
 * mirrors the overnight emailer exactly: resolveRecipientEmailsForRegion_
 * (RmHierarchy.gs) buckets each region's affected RMs by their own
 * A1/TM/RH manager chain — one email per resolved bucket, not one flat
 * email per region — with the same CH-level diversion
 * (notifyChLevelIssuesGs_ below) and the same "leads not sent" audit
 * (notifyLeadSendFailuresGs_, reused directly from OvernightEmailer.gs)
 * for anything that couldn't be routed or failed to send.
 *
 * Subject line: "<primaryRole>/<bucketLabel>/google/Leads With Issue/<date>"
 * — e.g. "A1/Omkar Ghate/google/Leads With Issue/27 Aug 2026", or
 * "TM/Ayaz Bagwan/google/Leads With Issue/27 Aug 2026" for a bucket whose
 * primary is standing in for RMs with no A1 of their own (same tier
 * variability sendOneOvernightEmail_ already documents — primaryRole is
 * never "CH" here; a CH-tier primary is always self-holding and goes
 * through notifyChLevelIssuesGs_ instead, same split as the overnight
 * script).
 *
 * ============================== SETUP (one-time) ==============================
 *   1. Same spreadsheet/project as MovementTracker.gs, OvernightEmailer.gs,
 *      RmHierarchy.gs and RmHierarchy.private.gs — paste this in as its own
 *      file (Apps Script editor → + → Script → name it AllIssuesEmailer).
 *   2. In the function dropdown, select setupAllIssuesEmailTrigger, click
 *      Run, approve permissions. Installs ONE daily trigger at
 *      ALL_ISSUES_RUN_HOUR_ (default 10am IST — after the overnight
 *      email's own ~9am run and Movement_Log's 4x/day snapshots, so it
 *      isn't competing with either for the same execution window; edit
 *      the constant and re-run this function to change it).
 *   3. To test without emailing real RMs: set TEST_MODE_OVERRIDE_EMAIL_ at
 *      the top of OvernightEmailer.gs (shared by both scripts) to your own
 *      address, then run sendAllIssuesEmailsNow from the function dropdown.
 *      Set it back to '' before relying on the real trigger.
 * ================================================================================
 */

const ALL_ISSUES_LOG_SHEET_ = 'AllIssues_Log';
const ALL_ISSUES_WINDOW_HOURS_ = 48;
const ALL_ISSUES_RUN_HOUR_ = 10; // IST — see setupAllIssuesEmailTrigger below

// Source = google, Sub-source = Non-UTM or Search — per explicit request,
// checked as the very FIRST gate on every row (same "checked before
// anything else runs on it" ordering sendOvernightMorningEmails already
// uses for its own group_source-only gate). Shared with
// sendOvernightMorningEmails's own gate (see the small patch in
// OvernightEmailer.gs) so both scripts agree on exactly what "Google
// Non-UTM/Search" means — one place to fix if the sheet ever adds a third
// spelling of either value.
function passesGoogleNonUtmSearchGs_(groupSourceRaw, sourceBucketRaw) {
  const groupSource = String(groupSourceRaw || '').trim().toLowerCase();
  if (groupSource !== 'google') return false;
  const sourceBucket = String(sourceBucketRaw || '').trim().toLowerCase();
  return sourceBucket === 'non-utm' || sourceBucket === 'search';
}

// Rolling 48h window ending at `asOf` — e.g. run on the 27th at 10am,
// covers leads assigned from the 25th 10am through the 27th 10am.
// Deliberately NOT the overnight emailer's fixed 5pm-to-9am window
// (overnightWindowGs_) — this is a genuinely different scope (48 rolling
// hours, every day, not "since the RM's desk closed yesterday").
function allIssuesWindowGs_(asOf) {
  return { from: new Date(asOf.getTime() - ALL_ISSUES_WINDOW_HOURS_ * 3600 * 1000), to: asOf };
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
  const { colIndex, dataRows } = readLeadsTab_(ss); // OvernightEmailer.gs
  const recipients = loadRegionRecipients_(ss); // OvernightEmailer.gs — legacy fallback, same as overnight
  const baselineMap = withRetry_(function () { return buildTodayCallBaselineGs_(ss, now); }, 'buildTodayCallBaselineGs_');

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

    candidateLeads.push({
      identityKey: clientId || ('l:' + leadId),
      stageRank: stageRank,
      region: main, lead_id: leadId, RM: RM, TL: TL,
      status: overnightStatusLabelGs_(stage),
      issueLabel: issue.label,
      followup: overnightFollowupHintGs_(row, colIndex, now, null),
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
    const resolution = resolveRecipientEmailsForRegion_(ss, region, rmNames, recipients, { fireAlerts: false, rmToLeads: rmToLeads, dateLabel: dateLabel });

    // CH-level self-holding/reports-all-the-way-up RMs — own diversion,
    // same split as the overnight script (resolveRecipientEmailsForRegion_
    // itself doesn't fire this alert when fireAlerts:false, so it's called
    // explicitly here instead).
    notifyChLevelIssuesGs_(region, resolveRecipientBucketsForRms_(ss, rmNames).chLevelRms, rmToLeads, dateLabel);

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

  // Reused directly from OvernightEmailer.gs — same shape entries
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
function notifyChLevelIssuesGs_(region, chLevelRms, rmToLeads, dateLabel) {
  if (!chLevelRms.length) return;
  const byCh = {};
  chLevelRms.forEach(function (r) {
    if (!byCh[r.chName]) byCh[r.chName] = { chEmail: r.chEmail, rmNames: [] };
    byCh[r.chName].rmNames.push(r.rmName);
  });
  const effectiveDateLabel = dateLabel || Utilities.formatDate(new Date(), 'Asia/Kolkata', 'd MMM yyyy');

  Object.keys(byCh).forEach(function (chName) {
    const entry = byCh[chName];
    const subject = 'CH/' + chName + '/google/Leads With Issue/' + effectiveDateLabel;

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
      footerNote: 'This report is normally addressed to the RM\'s own manager chain — sent here instead because ' + chName + ' has nobody below them to route it through automatically. Scope: Source=google, Sub-source=Non-UTM/Search, leads assigned in the last 48 hours.',
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

  const subject = rec.primaryRole + '/' + rec.bucketLabel + '/google/Leads With Issue/' + dateLabel;
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
    footerNote: 'Scope: Source=google, Sub-source=Non-UTM/Search, leads assigned in the last 48 hours (rolling). Status/flags reflect the CURRENT live sheet as of this run.',
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
    try {
      notifyOpsAlertGs_('All-issues email FAILED - ' + region + bucketNote, [
        'Failed to send after retries for ' + region + bucketNote + '.',
        'To: ' + rec.to + (rec.cc ? ' | Cc: ' + rec.cc : ''),
        'Error: ' + e,
        'Check Drafts in the sending Gmail account — createDraft succeeds independently of send, so a draft may exist even though the send itself failed.',
      ]);
    } catch (alertErr) {
      Logger.log('notifyOpsAlertGs_ itself failed: ' + alertErr);
    }
    return { reason: 'Send failed: ' + e };
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
