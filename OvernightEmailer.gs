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
 * REQUIRES every other file in this project (see Core.gs's own header for
 * the full list) — this file reuses resolveTabName_/buildColIndex_/getVal_/
 * canonicalStage_/isOppOrAbove_/isOpenLead_/istDayKeyGs_ (Core.gs),
 * computeSlaFlags_/primaryIssueGs_ (SlaEngine.gs),
 * overnightFollowupHintGs_/combinedCommentsTextGs_/overnightStatusLabelGs_
 * (FollowupEngine.gs), and withRetry_/withSendRetry_/readLeadsTab_/
 * resolveRecipientEmailsForRegion_/notifyOpsAlertGs_/
 * notifyLeadSendFailuresGs_/mainRegionForGs_/renderOvernightReportEmailHTML_/
 * passesGoogleNonUtmSearchGs_ (EmailInfra.gs) directly rather than
 * duplicating them, so every script in this project can never silently
 * disagree about what counts as "open," "flagged," or in scope. Install
 * every file before running setupOvernightEmailer.
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
 * resolveRecipientEmailsForRegion_ (EmailInfra.gs).
 *
 * ============================== SETUP (one-time) ==============================
 *   1. Same Apps Script project as every other file this project needs —
 *      Core.gs, SlaEngine.gs, FollowupEngine.gs, EmailInfra.gs,
 *      MovementTracker.gs, AllIssuesEmailer.gs, RmHierarchy.gs, AND
 *      RmHierarchy.private.gs (Extensions → Apps Script — every file must
 *      be in one project). Add each as a new file, paste the contents
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

const OVERNIGHT_LOG_SHEET_ = 'Overnight_Log';

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
  const byCh = {}; // chName -> { chEmail, chRole, rmNames: [] }
  chLevelRms.forEach(function (r) {
    if (!byCh[r.chName]) byCh[r.chName] = { chEmail: r.chEmail, chRole: r.chRole, rmNames: [] };
    byCh[r.chName].rmNames.push(r.rmName);
  });
  const effectiveDateLabel = dateLabel || Utilities.formatDate(new Date(), 'Asia/Kolkata', 'd MMM yyyy');
  Object.keys(byCh).forEach(function (chName) {
    const entry = byCh[chName];
    // Real recorded role in parens (resolveRecipientBucketsForRms_ —
    // "Cluster Head", "City Lead", "Commercial Head", or "Leadership" for
    // someone with no RM_Hierarchy row at all) — same tierQualifier
    // convention sendOneOvernightEmail_'s own normal-bucket subject
    // already uses for a non-A1 primary, just applied here too; this
    // subject previously showed no role indicator at all.
    const roleQualifier = entry.chRole ? ' - ' + entry.chRole : '';
    const subject = '(' + chName + roleQualifier + ') ' + region + ' Google Overnight Leads - ' + effectiveDateLabel;

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

// Split into small independently-retried steps, with a flush() right
// after insertSheet — see ensureRegionRecipientsSheet_'s identical
// comment (EmailInfra.gs). This is the exact function that produced the
// original "Service Spreadsheets timed out" error in production.
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
  // Loaded ONCE here and threaded through resolveRecipientEmailsForRegion_
  // below (via opts.hierarchyData) instead of letting each region's own
  // call re-load RM_Hierarchy + Manager_Directory from scratch — those are
  // static for the whole run, so re-loading per region (11 regions x 2
  // sheets) was 22 avoidable Sheets calls. See
  // resolveRecipientBucketsForRms_'s own comment (RmHierarchy.gs).
  const hierarchyData = withRetry_(function () { return loadRmHierarchyAndEmails_(ss); }, 'loadRmHierarchyAndEmails_');
  // buildMovementLogMapsGs_ (MovementTracker.gs) reads Movement_Log — the
  // largest sheet in this project — ONCE and derives both maps from that
  // one read, instead of the two separate buildTodayCallBaselineGs_/
  // lastSnapshotBeforeGs_ calls this used to make (each of which did its
  // own full read). Detailed (keeps each entry's snapshot timestamp)
  // feeds noCommentFollowUpGs_ (FollowupEngine.gs) below.
  const movementMaps = withRetry_(function () { return buildMovementLogMapsGs_(ss, now); }, 'buildMovementLogMapsGs_');
  const baselineMap = movementMaps.baselineMap;
  const lastSnapshotMap = movementMaps.lastSnapshotMap;

  // Flat candidate list first, deduped by customer identity below, THEN
  // grouped by region — a customer held by more than one RM at once
  // (sibling copies, including across DIFFERENT regions) would otherwise
  // be counted and emailed as if they were unrelated separate leads, with
  // no indication to either recipient that the other copy exists.
  const candidateLeads = [];
  dataRows.forEach(function (row) {
    const leadId = String(getVal_(row, colIndex, 'lead_id') || '').trim();
    if (!leadId) return;
    // Google + Sub-source gate, checked FIRST — before the window/region/
    // stage checks below — per explicit request: this email is scoped to
    // group_source="Google" AND source_bucket in {Non-UTM, Search} only
    // (see the subject line, which says "Google Overnight Leads"), so a
    // lead outside that scope is excluded before anything else runs on
    // it, not filtered out later alongside the other criteria.
    // Sub-source was NOT actually being checked here before — only
    // group_source was — despite the dashboard's own generated-report
    // subjects once claiming (falsely, until fixed — see reports.js's
    // subjectScopeSuffix comment) a "Google Search & Non-UTM only" scope.
    // This closes that real gap: passesGoogleNonUtmSearchGs_
    // (EmailInfra.gs) is the single shared definition of the scope now,
    // so this and the all-issues script can't drift apart on what
    // "Google Non-UTM/Search" means.
    if (!passesGoogleNonUtmSearchGs_(getVal_(row, colIndex, 'group_source'), getVal_(row, colIndex, 'source_bucket'))) return;
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
    const resolution = resolveRecipientEmailsForRegion_(ss, region, rmNames, recipients, { fireAlerts: true, rmToLeads: rmToLeads, dateLabel: dateLabel, hierarchyData: hierarchyData });

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
// server-side (see combinedCommentsTextGs_, FollowupEngine.gs).
// Deliberately does NOT create the tab if it's missing (the dashboard owns
// creating it — its absence means this feature just hasn't been set up
// yet, not an error) and does NOT clear existing rows first: clearing is
// safe for the dashboard's own Generate cycle because it holds an
// in-memory exclusivity lock (_generateCycleOwner) for the whole
// clear-through-send window, but Apps Script runs as a completely
// separate process with no way to see or respect that lock — clearing
// here could wipe out rows a human is actively reviewing on the
// dashboard at the same moment. An upsert-only write can never destroy
// anything that was already there. Returns false (nothing written) when
// the tab doesn't exist — the caller treats that exactly like "waited
// and nothing came back": send without it.
function pushUnresolvedToLeadFollowups_(ss, entries) {
  if (!entries.length) return false;
  const sheet = ss.getSheetByName(LEAD_FOLLOWUPS_SHEET_);
  if (!sheet) return false;

  return withRetry_(function () {
    const lastRow = sheet.getLastRow();
    const rowIndexByLeadId = {}; // lead_id -> 0-based offset into existingValues
    const dataRowCount = lastRow >= 2 ? lastRow - 1 : 0;
    // Read the whole existing range ONCE (columns A-H) — perf pass
    // (2026-08-28): the old version wrote each entry with up to 3
    // separate setValues() calls (or one appendRow()), so a run with N
    // unresolved leads cost up to ~3N Sheets round-trips. Reading once,
    // patching the matched rows in memory, and writing back in at most 2
    // batched calls (existing-row updates + new-row appends) does the
    // same upsert in O(1) Sheets calls instead of O(N).
    const existingValues = dataRowCount > 0 ? sheet.getRange(2, 1, dataRowCount, 8).getValues() : [];
    existingValues.forEach(function (r, i) {
      const id = String((r && r[0]) || '').trim();
      if (id) rowIndexByLeadId[id] = i;
    });

    const updatedAt = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss');
    const newRows = [];
    let existingChanged = false;
    entries.forEach(function (e) {
      const idx = rowIndexByLeadId[e.lead_id];
      if (idx !== undefined) {
        // Column F (index 5, "suggested_followup") is deliberately
        // preserved untouched — same as the original's column-skipping
        // writes — that column is filled by a human or the dashboard's
        // own Generate flow, never by this automated push.
        existingValues[idx] = [e.lead_id, e.region, e.RM, e.issue, e.comments, existingValues[idx][5], updatedAt, e.comments];
        existingChanged = true;
      } else {
        newRows.push([e.lead_id, e.region, e.RM, e.issue, e.comments, '', updatedAt, e.comments]);
      }
    });

    if (existingChanged) sheet.getRange(2, 1, existingValues.length, 8).setValues(existingValues);
    if (newRows.length) sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, 8).setValues(newRows);
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
  // buildMovementLogMapsGs_ (MovementTracker.gs) reads Movement_Log ONCE
  // and derives both maps from that one read — see
  // sendOvernightMorningEmails' identical comment above. Detailed feeds
  // noCommentFollowUpGs_.
  const movementMaps = withRetry_(function () { return buildMovementLogMapsGs_(ss, now); }, 'buildMovementLogMapsGs_');
  const baselineMap = movementMaps.baselineMap;
  const lastSnapshotMap = movementMaps.lastSnapshotMap;
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
  // Loaded ONCE, same reasoning as the real send paths (see
  // resolveRecipientBucketsForRms_'s own comment) — this loop can touch
  // several rows/regions, each of which used to independently reload
  // RM_Hierarchy + Manager_Directory from scratch.
  const hierarchyData = withRetry_(function () { return loadRmHierarchyAndEmails_(ss); }, 'loadRmHierarchyAndEmails_');

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
    const recEmails = resolveRecipientEmailsForRegion_(ss, region, rmNames, legacyRecipients, { hierarchyData: hierarchyData }).results;
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
        Logger.log('    ' + rmName + ': resolves fine (-> ' + primaryName + ' <' + primaryEmail + '>) - should NOT be the reason this row is unresolved; re-check the output of backfillTodaysOvernightLogRecipientsNow for this region.');
      });
      const legacy = loadRegionRecipients_(ss)[region];
      Logger.log('  Region_Recipients fallback for ' + region + ': ' + (legacy ? ('to="' + legacy.to + '" cc="' + legacy.cc + '"') : 'not configured (blank)'));
    }
  });
  Logger.log('=== end debugFollowupStatusNow ===');
}
