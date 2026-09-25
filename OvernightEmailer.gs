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
 *      MovementTracker.gs, AllIssuesEmailer.gs, RmHierarchy.gs,
 *      RmHierarchy.private.gs, AND DailyRmIssueLog.gs (Extensions → Apps
 *      Script — every file must be in one project). Add each as a new
 *      file, paste the contents in. RmHierarchy.private.gs lives only on
 *      your machine (see its own header) — it's what makes
 *      Manager_Directory come pre-filled with real emails instead of
 *      every cell starting blank; the rest of this still works without
 *      it, just with more manual fill-in.
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
  const byCh = groupChLevelRmsByCh_(chLevelRms); // chName -> { chEmail, chRole, rmNames: [] }
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
    const split = splitSelfAndReportingRmNames_(chName, entry.rmNames);
    const selfRmNames = split.selfRmNames;
    const reportingRmNames = split.reportingRmNames;
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
    const grouped = groupLeadsByRmAndFlatten_(entry.rmNames, rmToLeads);
    const byRM = grouped.byRM;
    const rmKeys = grouped.rmKeys;
    const allLeads = grouped.allLeads;
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
        return GmailApp.createDraft(chLevelReportToGs_(), subject, plainBody, {
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
// to/cc/subject: the ACTUAL resolved recipients + subject line from the
// 10am send, needed so the 1pm follow-up can send to the same real
// people explicitly — see sendOvernightFollowupEmails' own comment for
// why it can no longer just GmailThread.reply() on thread_id.
// followup_sent_at: added 2026-09-23 (two-checkpoint email lifecycle
// redesign, Step 8/11) — idempotency guard for the 13:00 job's own
// combined reply (Section 1 + Section 2 together, see
// sendCombinedFollowupEmail_'s own comment). A real gap this closes:
// unlike Section 2 (guarded by AllIssues_Log's own checkpoint2_sent_at),
// Section 1's unresolved-lead follow-up had NO per-day-once guard at
// all — a trigger retry (or a manual re-run) the same day resent a
// duplicate threaded reply into the SAME Gmail thread for every
// still-unresolved lead. Design doc Part 9's own contract text said
// "Overnight_Log is untouched" — true only through Step 7; this is the
// one column Step 8 needs to add to actually deliver "a trigger retry
// must reconcile the existing cycle, not create a duplicate email."
const OVERNIGHT_LOG_HEADERS_ = ['date', 'region', 'thread_id', 'lead_ids_json', 'sent_at', 'to', 'cc', 'subject', 'followup_sent_at'];

// Self-healing header, same pattern as ensureAllIssuesLogSheet_
// (AllIssuesEmailer.gs) — appends any column missing from an EXISTING
// sheet (the live one predates followup_sent_at) rather than requiring a
// manual migration. Append-only: a genuinely new column must be added to
// the END of OVERNIGHT_LOG_HEADERS_, never inserted/reordered, or this
// heal silently misaligns every already-written row's columns.
function ensureOvernightLogSheet_(ss) {
  let sheet = withRetry_(function () { return ss.getSheetByName(OVERNIGHT_LOG_SHEET_); }, 'check for existing Overnight_Log');
  if (!sheet) {
    sheet = withRetry_(function () { return ss.insertSheet(OVERNIGHT_LOG_SHEET_); }, 'insert Overnight_Log');
    SpreadsheetApp.flush();
    withRetry_(function () {
      sheet.getRange(1, 1, 1, OVERNIGHT_LOG_HEADERS_.length).setValues([OVERNIGHT_LOG_HEADERS_]);
      sheet.setFrozenRows(1);
    }, 'write Overnight_Log header');
    return sheet;
  }
  const lastCol = withRetry_(function () { return sheet.getLastColumn(); }, 'read Overnight_Log header width');
  const existingHeaders = lastCol > 0 ? withRetry_(function () { return sheet.getRange(1, 1, 1, lastCol).getValues()[0]; }, 'read Overnight_Log header') : [];
  const existingSet = {};
  existingHeaders.forEach(function (h) { existingSet[String(h || '').trim()] = true; });
  const missing = OVERNIGHT_LOG_HEADERS_.filter(function (h) { return !existingSet[h]; });
  if (missing.length) {
    withRetry_(function () { sheet.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]); }, 'heal Overnight_Log header');
  }
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
// Builds Section 1's ("Overnight") full renderOvernightReportEmailHTML_
// opts (title/region/subtitle/kpis/action/sections/footerNote) from a
// bucket's own leads. Extracted from sendOneOvernightEmail_'s own inline
// object (2026-09-23, two-checkpoint email lifecycle redesign) so BOTH a
// standalone overnight email (sendOneOvernightEmail_, unchanged output)
// and Section 1 of the new combined 10am email
// (sendCombinedMorningEmail_) share the SAME opts-building logic — one
// source of truth for what "Section 1 — Overnight" actually shows, never
// duplicated. Pure function, no behavior change from the extraction
// itself.
function buildOvernightSectionOptsGs_(region, leads, dateLabel, win) {
  const byRM = {}; // RM -> { TL, leads: [] }
  leads.forEach(function (l) {
    if (!byRM[l.RM]) byRM[l.RM] = { TL: l.TL, leads: [] };
    byRM[l.RM].leads.push(l);
  });
  const rmKeys = Object.keys(byRM).sort();
  const statusTypeCount = Array.from(new Set(leads.map(function (l) { return l.status; }))).length;

  return {
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
  };
}

function sendOneOvernightEmail_(ss, logSheet, region, rec, leads, dateLabel, todayKey, now, win) {
  if (!leads.length) return null;

  const byRM = {}; // RM -> { TL, leads: [] } — still needed below for rmKeys.length in the plain-text body
  leads.forEach(function (l) {
    if (!byRM[l.RM]) byRM[l.RM] = { TL: l.TL, leads: [] };
    byRM[l.RM].leads.push(l);
  });
  const rmKeys = Object.keys(byRM).sort();

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

  const html = (testModeBanner ? testModeBanner.html : '') + renderOvernightReportEmailHTML_(buildOvernightSectionOptsGs_(region, leads, dateLabel, win));
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
      : 'Send error: ' + e + ' — check Gmail Drafts too (createDraft() runs before send(), so the draft may already exist)';
    notifyOpsAlertGs_('Morning email failed for ' + region + bucketNote, [
      'Region: ' + region + bucketNote,
      'Intended recipient: ' + rec.to + (rec.cc ? (' (cc: ' + rec.cc + ')') : ''),
      'Leads affected (' + leads.length + '): ' + leads.map(function (l) { return l.lead_id; }).join(', '),
      '',
      'These leads got no automated email this run — the window is fixed to this morning\'s run only, so tomorrow\'s run will NOT retry them.',
      isSendBlocked
        ? 'This looks like a Gmail SEND restriction, not a code error — check Gmail Drafts for a message to ' + rec.to + ' with subject "' + subject + '"; it was very likely created successfully and just needs a manual Send, which works fine since the block is on script-driven sends specifically. If this keeps happening, check Google Workspace Admin Console -> Security -> API Controls -> App Access Control for this Apps Script project.'
        // Any OTHER error here (not the specific "operation not allowed"
        // phrase) still carries the same underlying risk: createDraft()
        // and send() are two steps chained together, so this could be a
        // genuine failure before any draft was ever created, OR the draft
        // could have been created successfully with only send() failing
        // (same situation as the branch above, just a different error
        // text — real production case: "Exception: Not found" from this
        // exact chain, with no draft-restriction keyword to key off of).
        // Check Gmail Drafts to tell which one actually happened.
        : 'Error: ' + e + '. Check Gmail Drafts for a message to ' + rec.to + ' with subject "' + subject + '" before assuming nothing was created — createDraft() succeeding while the chained send() fails looks exactly like this from here.',
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

// ============================================================
// Two-checkpoint email lifecycle redesign (Step 6/11) -- see
// docs/_planning/EMAIL_LIFECYCLE_TWO_CHECKPOINT_REDESIGN.md for the
// full design. Everything below builds the 10am COMBINED email:
// Section 1 = Overnight (buildOvernightSectionOptsGs_ above, unchanged
// logic), Section 2 = Checkpoint 1 (yesterday's 17:00 AllIssues_Log
// snapshot compared to right now, via computeAllIssuesCheckpointGs_ /
// SlaEngine.gs). sendOneOvernightEmail_ itself is untouched and still
// works standalone -- these are ADDITIVE, composing around it, not a
// replacement.
// ============================================================

// Section 1 placeholder for a union bucket that has Checkpoint 1
// content but no overnight leads today (or Section 1 already went out
// in an earlier, separate run this same day -- see
// alreadyLoggedRegionsToday's own comment below). Same opts shape
// renderOvernightReportEmailHTML_ always expects; empty kpis/sections
// render as nothing, not an error.
function buildOvernightSectionEmptyStateOptsGs_(region, reasonText) {
  return { title: 'Overnight Leads', region: region, subtitle: reasonText, kpis: [], action: '', sections: [], footerNote: '' };
}

// Section 2 placeholder for a union bucket that has overnight leads
// today but nothing pending from yesterday's 17:00 report (the common
// case -- most days, most buckets).
function buildAllIssuesCheckpointEmptyStateOptsGs_(region, checkpointLabel, reasonText) {
  return { title: checkpointLabel, region: region, subtitle: reasonText, kpis: [], action: '', sections: [], footerNote: '' };
}

// Per-lead display text for Checkpoint 1/2's "Current State" column --
// see docs/_planning/EMAIL_LIFECYCLE_TWO_CHECKPOINT_REDESIGN.md Part 6
// for what each SlaEngine.gs `state` value means. Deliberately does NOT
// attempt to re-derive a fresh Suggested Follow-up hint the way Section
// 1 does (overnightFollowupHintGs_ needs a Movement_Log baseline entry
// computeAllIssuesCheckpointGs_'s own signature doesn't carry) -- the
// state label itself is the actionable signal here; Section 1's own
// Suggested Follow-up column already covers any lead that's ALSO part
// of tonight's overnight population.
function allIssuesCheckpointStateLabelGs_(entry) {
  switch (entry.state) {
    case 'resolved': return 'Resolved';
    case 'not_found': return 'No longer found on the leads sheet';
    case 'still_open': return 'Still open — ' + entry.currentIssueLabel;
    case 'category_changed': return 'Now: ' + entry.currentIssueLabel;
    case 'escalated': return 'ESCALATED — now: ' + entry.currentIssueLabel;
    case 'reopened': return 'REOPENED — now: ' + entry.currentIssueLabel;
    default: return entry.state;
  }
}

// Builds Section 2's full renderOvernightReportEmailHTML_ opts, grouped
// by RM the same visual way Section 1 is (buildOvernightSectionOptsGs_)
// for consistency, but with its own distinct purple accent (vs Section
// 1's default indigo) so the two are never confused for one continuous
// table even mid-scroll. `snapshotEntries` is the ORIGINAL 17:00
// population for this bucket (has RM/TL/issueLabel per lead);
// `checkpointResults` is computeAllIssuesCheckpointGs_'s output for the
// SAME lead_ids -- joined here by lead_id since the two carry
// complementary fields (design doc Part 7: the comparison engine itself
// doesn't need to know about RM/TL, only the email-rendering layer does).
function buildAllIssuesCheckpointSectionOptsGs_(region, checkpointLabel, originalDateLabel, snapshotEntries, checkpointResults) {
  const resultByLeadId = {};
  checkpointResults.forEach(function (r) { resultByLeadId[r.lead_id] = r; });

  const byRM = {}; // RM -> { TL, rows: [] }
  snapshotEntries.forEach(function (entry) {
    const result = resultByLeadId[entry.lead_id];
    if (!result) return; // computeAllIssuesCheckpointGs_ always returns one entry per input -- defensive only
    const rmKey = entry.RM || 'Unassigned';
    if (!byRM[rmKey]) byRM[rmKey] = { TL: entry.TL, rows: [] };
    byRM[rmKey].rows.push([entry.lead_id, entry.issueLabel, allIssuesCheckpointStateLabelGs_(result)]);
  });
  const rmKeys = Object.keys(byRM).sort();

  const closedOutStates = { resolved: true, not_found: true };
  const resolvedCount = checkpointResults.filter(function (r) { return closedOutStates[r.state]; }).length;
  const stillActiveCount = checkpointResults.length - resolvedCount;

  return {
    title: checkpointLabel,
    region: region,
    subtitle: "Following up on the " + originalDateLabel + ' 17:00 All-Issues report',
    kpis: [
      { value: checkpointResults.length, label: checkpointResults.length === 1 ? 'Lead In This Follow-up' : 'Leads In This Follow-up', bg: '#ede9fe', fg: '#6d28d9' },
      { value: stillActiveCount, label: 'Still Active', bg: '#fee2e2', fg: '#b91c1c' },
      { value: resolvedCount, label: 'Resolved', bg: '#d1fae5', fg: '#047857' },
    ],
    action: stillActiveCount ? "The leads below are still active from yesterday's 17:00 report — prioritize the ones still open or newly escalated." : '',
    sections: rmKeys.map(function (rm) {
      return {
        heading: rm, subheading: 'Manager: ' + (byRM[rm].TL || '—'),
        columns: ['Lead ID', 'Original Issue (17:00)', 'Current State'],
        rows: byRM[rm].rows,
        accent: { fg: '#6d28d9', headerBg: '#f5f3ff', bg: '#faf9ff' },
      };
    }),
    footerNote: "Comparing yesterday's 17:00 All-Issues report against the CURRENT live sheet. A lead shown as \"Resolved\" or no longer found is dropped from this afternoon's follow-up; anything still active will be checked again then.",
  };
}

// Composes Section 1 + Section 2 into ONE email body -- two full,
// independent renderOvernightReportEmailHTML_ calls (each keeps its own
// banner/KPIs/action/footer/signature) concatenated with a clear
// divider, rather than changing that shared function's signature (it
// also backs AllIssuesEmailer.gs's own single-section emails, so its
// shape stays exactly as every other caller already expects — design
// doc Part 8's own "wrap, don't modify" plan). Each half is explicitly
// labeled "Section N — <title>" so the two-section contract is visually
// unambiguous even to someone skimming, not just implied by position.
function renderTwoSectionEmailHTML_(section1Opts, section2Opts) {
  const FONT = 'font-family:Arial,Helvetica,sans-serif;';
  const sectionLabel = function (n, title) {
    return '<div style="' + FONT + ' font-size:11px; letter-spacing:1.2px; text-transform:uppercase; font-weight:700; color:#9ca3af; margin:' +
      (n === 1 ? '0 0 6px 0' : '30px 0 6px 0') + ';">Section ' + n + ' — ' + esc_(title) + '</div>';
  };
  const divider = '<div style="margin:22px 0; border-top:2px solid #e5e7eb;"></div>';
  return sectionLabel(1, section1Opts.title) + renderOvernightReportEmailHTML_(section1Opts) +
    divider +
    sectionLabel(2, section2Opts.title) + renderOvernightReportEmailHTML_(section2Opts);
}

// Reads AllIssues_Log for yesterday's (IST) rows that haven't had a
// Checkpoint 1 computed yet (checkpoint1_sent_at blank -- the
// idempotency guard for THIS function; a fuller retry story is Step
// 8/11's job, this is the basic "don't recompute/resend what's already
// done" check). Returns { region -> [{rowNumber, to, cc, bucketLabel,
// primaryRole, snapshotEntries}] } -- rowNumber is the real 1-indexed
// sheet row, needed to write checkpoint1_json/checkpoint1_sent_at back
// onto the EXACT row the snapshot came from (design doc Part 5: one
// wide row per original 17:00 send, not a second table).
function loadYesterdaysAllIssuesBucketsGs_(ss, now) {
  const yesterdayKey = istDayKeyGs_(new Date(now.getTime() - 24 * 3600 * 1000));
  const logSheet = ensureAllIssuesLogSheet_(ss); // AllIssuesEmailer.gs -- already a required file for this project (see this file's own header)
  const lastRow = logSheet.getLastRow();
  const byRegion = {};
  if (lastRow < 2) return byRegion;

  const rows = withRetry_(function () { return logSheet.getRange(2, 1, lastRow - 1, 14).getValues(); }, 'read AllIssues_Log for Checkpoint 1');
  rows.forEach(function (r, i) {
    const dateCell = r[0];
    const dateKey = dateCell instanceof Date ? istDayKeyGs_(dateCell) : String(dateCell || '');
    if (dateKey !== yesterdayKey) return;
    if (r[11]) return; // checkpoint1_sent_at (col L, 0-indexed 11) already set -- skip, already checkpointed
    const snapshotRaw = r[9]; // issue_snapshot_json, col J, 0-indexed 9
    if (!snapshotRaw) return; // a pre-Step-3 row (or a bucket that somehow logged with no leads) -- nothing to compare
    let snapshotEntries;
    try {
      snapshotEntries = JSON.parse(snapshotRaw);
    } catch (e) {
      Logger.log('loadYesterdaysAllIssuesBucketsGs_: could not parse issue_snapshot_json on AllIssues_Log row ' + (i + 2) + ' -- skipping this row: ' + e);
      return;
    }
    if (!snapshotEntries || !snapshotEntries.length) return;
    const region = String(r[1] || '').trim();
    if (!region) return;
    if (!byRegion[region]) byRegion[region] = [];
    byRegion[region].push({
      rowNumber: i + 2, bucketLabel: String(r[2] || ''), primaryRole: String(r[3] || ''),
      to: String(r[4] || ''), cc: String(r[5] || ''), snapshotEntries: snapshotEntries,
    });
  });
  return byRegion;
}

// Sends ONE combined email for a union bucket (by recipient email — see
// design doc Part 7) and writes back both halves' own state.
// `section1` is either { rec, leads } (a real today's-overnight bucket,
// same shape sendOneOvernightEmail_ already takes) or null (no overnight
// leads today for this recipient, OR Section 1 already went out
// separately earlier today — see the caller's own
// alreadyLoggedRegionsToday handling). `section2` is either
// { to, cc, bucketLabel, primaryRole, rowNumbers: [...],
// snapshotEntries: [...] } (merged across every yesterday's AllIssues_Log
// row for this SAME recipient — normally exactly one) or null (nothing
// pending from yesterday's 17:00 report).
// Returns null on success, or { reason, section1Leads, section2 } on
// send failure — same shape sendOneOvernightEmail_ returns, so the
// caller's existing failedLeadEntries aggregation needs no changes.
function sendCombinedMorningEmail_(ss, overnightLogSheet, allIssuesLogSheet, region, section1, section2, dateLabel, todayKey, now, win, baselineMap, section1SkippedReason) {
  // TEST MODE: a Section-2-only bucket's `to` is the STORED 17:00 recipient (a real manager) — never route it there.
  const to = TEST_MODE_OVERRIDE_EMAIL_ || (section1 && section1.rec.to) || (section2 && section2.to);
  const cc = TEST_MODE_OVERRIDE_EMAIL_ ? '' : ((section1 && section1.rec.cc) || (section2 && section2.cc) || '');
  const bucketLabel = (section1 && section1.rec.bucketLabel) || (section2 && section2.bucketLabel) || '';
  const primaryRole = (section1 && section1.rec.primaryRole) || (section2 && section2.primaryRole) || '';

  const section1Leads = section1 ? section1.leads : [];
  // `section1SkippedReason` distinguishes two genuinely different facts
  // (design doc Part 2's empty-state rule) — 'already_sent' means real
  // overnight leads existed and already went out in an earlier, separate
  // run today (this bucket is here only because Section 2 has content);
  // anything else means there simply were none.
  const section1EmptyText = section1SkippedReason === 'already_sent'
    ? "Already sent separately earlier today — see this morning's earlier Overnight email for this team."
    : 'No overnight leads for your team today.';
  const section1Opts = section1
    ? buildOvernightSectionOptsGs_(region, section1Leads, dateLabel, win)
    : buildOvernightSectionEmptyStateOptsGs_(region, section1EmptyText);

  const checkpointTitle = 'Previous Day 17:00 All-Issues Follow-up — Checkpoint 1';
  let checkpoint1Results = null;
  let section2Opts;
  if (section2) {
    checkpoint1Results = computeAllIssuesCheckpointGs_(ss, section2.snapshotEntries, now, baselineMap);
    const originalDateLabel = Utilities.formatDate(new Date(now.getTime() - 24 * 3600 * 1000), 'Asia/Kolkata', 'd MMM yyyy');
    section2Opts = buildAllIssuesCheckpointSectionOptsGs_(region, checkpointTitle, originalDateLabel, section2.snapshotEntries, checkpoint1Results);
  } else {
    section2Opts = buildAllIssuesCheckpointEmptyStateOptsGs_(region, checkpointTitle, "Nothing pending from yesterday's 17:00 report.");
  }

  const tierQualifier = (primaryRole && primaryRole !== 'A1') ? ' - ' + primaryRole : '';
  const subjectPrefix = bucketLabel ? '(' + bucketLabel + tierQualifier + ') ' : '';
  const subject = (TEST_MODE_OVERRIDE_EMAIL_ ? '[TEST MODE] ' : '') + subjectPrefix + region + ' Google Overnight + Follow-up Digest - ' + dateLabel;
  const bucketNote = bucketLabel ? ' (' + bucketLabel + tierQualifier + ')' : '';

  const html = renderTwoSectionEmailHTML_(section1Opts, section2Opts);
  const plainBody = 'Combined morning digest for ' + region + bucketNote + ' (' + dateLabel + '): Section 1 (Overnight) ' +
    section1Leads.length + ' lead(s); Section 2 (Checkpoint 1) ' + (checkpoint1Results ? checkpoint1Results.length : 0) +
    ' lead(s). Open this email in Gmail for the full breakdown.';

  let sentMessage = null;
  let sendFailureReason = null;
  try {
    sentMessage = withSendRetry_(function () {
      return GmailApp.createDraft(to, subject, plainBody, { cc: cc || undefined, htmlBody: html, name: 'Homesfy Lead Ops' }).send();
    }, 'send combined morning email (' + region + bucketNote + ')');
  } catch (e) {
    Logger.log('Combined morning email failed for ' + region + bucketNote + ': ' + e);
    const isSendBlocked = /operation not allowed/i.test(String((e && e.message) || e));
    sendFailureReason = isSendBlocked
      ? 'Gmail send blocked ("operation not allowed") — check Gmail Drafts for a message to ' + to + ' with subject "' + subject + '"'
      : 'Send error: ' + e + ' — check Gmail Drafts too (createDraft() runs before send(), so the draft may already exist)';
    notifyOpsAlertGs_('Combined morning email FAILED - ' + region + bucketNote, [
      'Region: ' + region + bucketNote,
      'Intended recipient: ' + to + (cc ? (' (cc: ' + cc + ')') : ''),
      'Section 1 (Overnight) leads (' + section1Leads.length + '): ' + section1Leads.map(function (l) { return l.lead_id; }).join(', '),
      'Section 2 (Checkpoint 1) leads (' + (section2 ? section2.snapshotEntries.length : 0) + '): ' + (section2 ? section2.snapshotEntries.map(function (l) { return l.lead_id; }).join(', ') : '(none)'),
      '',
      sendFailureReason,
    ]);
  }

  // Overnight_Log row -- SAME columns sendOneOvernightEmail_ always
  // writes, so the EXISTING, unchanged 13:00 Overnight-thread lookup
  // (sendOvernightFollowupEmails_) keeps working regardless of whether
  // this run also carried a Section 2. Written on ANY successful
  // combined send, not just when Section 1 had real content --
  // correction from this function's first version, which only logged
  // when section1 was truthy: that left a Section-2-only bucket (no
  // overnight leads today, but real Checkpoint 1 content) with NO
  // thread reference at all, breaking the design's own "one Gmail
  // thread per bucket per day carries both sections" principle
  // (design doc Part 7) for Checkpoint 2's reply at 13:00. An empty
  // issueLog (Section 1 had nothing) is harmless here --
  // sendOvernightFollowupEmails_'s own Pass 1 already treats a row
  // with `if (!issueLog.length) return;` as "nothing to follow up on
  // for Section 1 specifically", which is exactly correct; Section 2's
  // own follow-up for that same bucket is a separate, independent
  // lookup against AllIssues_Log, not this row's issueLog. A failed
  // send must still NOT be logged (same "no log row = safe to retry"
  // philosophy sendOneOvernightEmail_'s own failure path already
  // relies on).
  if (!sendFailureReason) {
    const issueLog = [];
    section1Leads.forEach(function (l) { if (l.issue) issueLog.push({ lead_id: l.lead_id, issueKey: l.issue.key, issueLabel: l.issue.label }); });
    const threadId = sentMessage.getThread().getId();
    // Step 9/11: wrapped in its own try/catch, matching
    // sendOneAllIssuesEmail_'s own established precedent for this exact
    // shape of write (AllIssuesEmailer.gs) — this JSON blob is
    // unbounded in size (this bucket's whole overnight population), and
    // an uncaught write failure here (e.g. exceeding Sheets' ~50,000-char
    // cell limit on a very large bucket) would otherwise propagate out of
    // this function and abort sendOvernightMorningEmails_'s per-bucket
    // loop entirely — silently skipping every OTHER region/bucket still
    // left to process that run, even though the email above already sent
    // successfully. Logging is best-effort on top of a real send, not the
    // other way around.
    try {
      writeUnlessTestModeGs_(function () {
        overnightLogSheet.appendRow([
          todayKey, region, threadId, JSON.stringify(issueLog), Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss'),
          to, cc || '', subject,
        ]);
      }, 'log Overnight_Log row (' + region + bucketNote + ')');
    } catch (logErr) {
      Logger.log('Overnight_Log write failed for ' + region + bucketNote + ' (email itself sent fine): ' + logErr);
    }
  }

  // Section 2's checkpoint1_json/checkpoint1_sent_at -- written back
  // onto EVERY AllIssues_Log row this bucket's snapshot came from
  // (design doc Part 5: the row IS the state; spans more than one row
  // only in the rare case AllIssuesEmailer.gs logged twice for the same
  // recipient in one run). Deliberately written even when the SEND
  // failed, unlike Section 1's own choice above -- the content was
  // still correctly computed (only delivery failed, and the ops alert
  // above already surfaced that), and unlike Section 1's region-level
  // guard, an un-checkpointed row falls out of "yesterday" scope
  // entirely once a full day passes (loadYesterdaysAllIssuesBucketsGs_
  // only ever looks at ONE day back) -- leaving it un-checkpointed on a
  // transient failure would silently lose that checkpoint forever, not
  // just delay it. A more complete retry-until-success story is Step
  // 8/11's job; this is the safer default until then.
  if (section2) {
    // Step 9/11: own try/catch, same reasoning as the Overnight_Log write
    // above — a write failure here (e.g. an oversized checkpoint1Results
    // blob) must not abort the caller's per-bucket loop for every OTHER
    // region/bucket still left to process. The send already happened.
    try {
      writeUnlessTestModeGs_(function () {
        section2.rowNumbers.forEach(function (rowNumber) {
          allIssuesLogSheet.getRange(rowNumber, 11, 1, 2).setValues([[JSON.stringify(checkpoint1Results), Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss')]]);
        });
      }, 'write checkpoint1_json back to AllIssues_Log (' + region + bucketNote + ')');
    } catch (logErr) {
      Logger.log('checkpoint1_json write failed for ' + region + bucketNote + ' (email itself sent fine): ' + logErr);
    }
  }

  if (sendFailureReason) {
    return { reason: sendFailureReason, section1Leads: section1Leads, section2: section2 };
  }
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
/**
 * Trigger entry point (installed by setupOvernightEmailer — same function
 * name the trigger targets, so renaming the real body below needs no
 * trigger re-registration). Wraps the whole real run in a try/catch: same
 * "a crash before ANY per-region work even starts must alert ops, not
 * fail silently" reasoning as sendAllIssuesEmails' own wrapper
 * (AllIssuesEmailer.gs) — added 2026-08-31 after a real production case
 * of an all-issues run failing with zero visible signal to anyone.
 * Re-thrown after alerting so the Executions log still correctly shows
 * this run as Failed, never silently swallowed.
 */
function sendOvernightMorningEmails() {
  try {
    sendOvernightMorningEmails_();
  } catch (e) {
    notifyOpsAlertGs_('sendOvernightMorningEmails crashed — NO overnight morning emails were sent this run', [
      'sendOvernightMorningEmails threw before completing, so nothing was sent for ANY region this run.',
      'Error: ' + (e && e.stack ? e.stack : e),
    ]);
    throw e;
  }
}

function sendOvernightMorningEmails_() {
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
    const closingReason = getVal_(row, colIndex, 'closing_reason');
    const leadClosingReason = getVal_(row, colIndex, 'lead_closing_reason');
    if (isOppOrAbove_(stage, closingReason, leadClosingReason)) return; // already converted overnight — excluded, needs no follow-up
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

  // Two-checkpoint email lifecycle redesign (Step 6/11) — yesterday's
  // 17:00 AllIssues_Log rows still awaiting Checkpoint 1, grouped by
  // region. Loaded ONCE here, same "don't reload per-region" discipline
  // the hierarchy/movement loads above already follow.
  const allIssuesLogSheet = ensureAllIssuesLogSheet_(ss);
  const yesterdaysAllIssuesByRegion = loadYesterdaysAllIssuesBucketsGs_(ss, now);

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

  // Region union (design doc Part 7): today's Overnight regions and
  // yesterday's still-pending AllIssues_Log regions are two
  // independently-derived sets, not guaranteed to match — a region can
  // have Checkpoint 1 content pending with zero overnight leads today,
  // or vice versa. Both need to reach the loop below.
  const allRegionsForThisRun = Object.keys(byRegion).concat(Object.keys(yesterdaysAllIssuesByRegion))
    .filter(function (v, i, a) { return a.indexOf(v) === i; }).sort();

  allRegionsForThisRun.forEach(function (region) {
    const openLeads = byRegion[region] || [];
    const checkpointRows = yesterdaysAllIssuesByRegion[region] || [];
    if (!openLeads.length && !checkpointRows.length) return; // shouldn't happen given how the union above was built, but defensive

    // ---- Section 1 buckets: EXACTLY the existing resolution logic,
    // only skipped when there are no overnight leads at all, or when
    // this region already has a today-dated Overnight_Log row (the
    // EXISTING region-level idempotency guard, unchanged) — in that
    // second case Section 1 already went out in an earlier, separate
    // run today; Section 2 (if any) still proceeds on its own below,
    // via sendCombinedMorningEmail_'s own empty-state handling. ----
    const section1ByEmail = {}; // lowercased 'to' -> { rec, leads }
    // Distinguishes WHY a union bucket ends up with no Section 1 content
    // — "genuinely no overnight leads" vs "leads existed but already
    // went out in an earlier, separate run today" are different facts a
    // reader shouldn't have to guess between (sendCombinedMorningEmail_'s
    // own empty-state text uses this).
    let section1SkippedReason = null;
    if (openLeads.length) {
      if (alreadyLoggedRegionsToday[region] && !TEST_MODE_OVERRIDE_EMAIL_) {
        section1SkippedReason = 'already_sent';
        Logger.log('Section 1 (Overnight) skipped for ' + region + ' — already has an Overnight_Log row dated today (' + todayKey + '). Section 2 (Checkpoint 1), if any, still proceeds separately below.');
      } else {
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

        // RMs with no resolvable recipient anywhere AND no
        // Region_Recipients fallback either — their leads got no
        // automated email at all this run. To/Cc are genuinely blank
        // here (there was none to compute).
        resolution.trulyUnresolved.forEach(function (u) {
          (rmToLeads[u.rmName] || []).forEach(function (l) {
            failedLeadEntries.push({ lead_id: l.lead_id, RM: u.rmName, to: '', cc: '', reason: u.reason });
          });
        });

        resolution.results.forEach(function (rec) {
          const rmSet = new Set(rec.rmNames);
          const bucketLeads = openLeads.filter(function (l) { return rmSet.has(l.RM); });
          // originalTo (set only in TEST MODE) keeps the REAL recipient identity as the key, so buckets stay
          // separate and still union with Section 2's stored (real) recipient — same structure as production.
          section1ByEmail[String(rec.originalTo || rec.to || '').trim().toLowerCase()] = { rec: rec, leads: bucketLeads };
        });
      }
    }

    // ---- Section 2 buckets: yesterday's AllIssues_Log rows for this
    // region, keyed by their OWN STORED recipient — routing frozen at
    // 17:00, never re-resolved (design doc Part 7's answer to "manager
    // changes between checkpoints"). Merges more than one row for the
    // same recipient (rare — AllIssuesEmailer.gs logs one row per bucket
    // per run, so this only matters if that ever logs twice in one day
    // for the same person). ----
    const section2ByEmail = {}; // lowercased 'to' -> { to, cc, bucketLabel, primaryRole, rowNumbers, snapshotEntries }
    checkpointRows.forEach(function (row) {
      const key = String(row.to || '').trim().toLowerCase();
      if (!key) return; // no recipient to send to — shouldn't happen given AllIssuesEmailer.gs's own logging, defensive only
      if (!section2ByEmail[key]) {
        section2ByEmail[key] = { to: row.to, cc: row.cc, bucketLabel: row.bucketLabel, primaryRole: row.primaryRole, rowNumbers: [], snapshotEntries: [] };
      }
      section2ByEmail[key].rowNumbers.push(row.rowNumber);
      section2ByEmail[key].snapshotEntries = section2ByEmail[key].snapshotEntries.concat(row.snapshotEntries);
    });

    // ---- Union by recipient email (not bucket label/primary name —
    // the true recipient identity, design doc Part 7) — one combined
    // send per bucket. ----
    const unionEmails = Object.keys(section1ByEmail).concat(Object.keys(section2ByEmail))
      .filter(function (v, i, a) { return a.indexOf(v) === i; });

    unionEmails.forEach(function (emailKey) {
      const s1 = section1ByEmail[emailKey] || null;
      const s2 = section2ByEmail[emailKey] || null;
      const failure = sendCombinedMorningEmail_(ss, logSheet, allIssuesLogSheet, region, s1, s2, dateLabel, todayKey, now, win, baselineMap, section1SkippedReason);
      if (!failure) return;
      const failedTo = (s1 && s1.rec.to) || (s2 && s2.to) || '';
      const failedCc = (s1 && s1.rec.cc) || (s2 && s2.cc) || '';
      failure.section1Leads.forEach(function (l) {
        failedLeadEntries.push({ lead_id: l.lead_id, RM: l.RM, to: failedTo, cc: failedCc, reason: failure.reason });
      });
      if (failure.section2) {
        failure.section2.snapshotEntries.forEach(function (l) {
          failedLeadEntries.push({ lead_id: l.lead_id, RM: l.RM, to: failedTo, cc: failedCc, reason: failure.reason + ' (Checkpoint 1 follow-up)' });
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
//
// Returns { lead_id: { suggestion, updatedAt } }, not a bare suggestion
// string — LEADFOLLOWUPS-003 (2026-09-09): a suggestion this reads back
// can be a human-typed value pushUnresolvedToLeadFollowups_ never clears
// (unlike the dashboard's own clear-then-push cycle — see that
// function's own header), so it can be arbitrarily old and get quoted
// into today's 1pm email with zero freshness signal. updatedAt (column
// G) lets the caller show its actual age. See buildFollowupSuggestionLineGs_
// below for where that gets turned into the visible "(typed Xh ago)" text.
function waitForFollowupSuggestions_(ss, leadIds) {
  const sheet = ss.getSheetByName(LEAD_FOLLOWUPS_SHEET_);
  if (!sheet) return {};
  let lookup = {};
  for (let attempt = 1; attempt <= FOLLOWUP_WAIT_MAX_ATTEMPTS_; attempt++) {
    lookup = withRetry_(function () {
      const lastRow = sheet.getLastRow();
      const out = {};
      if (lastRow < 2) return out;
      sheet.getRange(2, 1, lastRow - 1, 7).getValues().forEach(function (r) {
        const id = String((r && r[0]) || '').trim();
        const suggestion = String((r && r[5]) || '').trim();
        if (id && suggestion) out[id] = { suggestion: suggestion, updatedAt: (r && r[6] instanceof Date) ? r[6] : null };
      });
      return out;
    }, 'read Lead_Followups suggestions (attempt ' + attempt + ')');
    const missing = leadIds.filter(function (id) { return !lookup[id]; });
    if (!missing.length) return lookup;
    if (attempt < FOLLOWUP_WAIT_MAX_ATTEMPTS_) Utilities.sleep(FOLLOWUP_WAIT_POLL_MS_);
  }
  return lookup; // time's up — whatever's filled in, possibly partial, possibly empty
}

// Pure — LEADFOLLOWUPS-003 (2026-09-09). Turns a Lead_Followups
// updated_at Date into the short " (typed Xh ago)" suffix the 1pm email
// appends to a human-typed suggestion (see sendOvernightFollowupEmails_'s
// own use of this, below). Blank string for anything not worth trusting
// as a real age — no Date at all (the row's own G cell couldn't be read,
// see waitForFollowupSuggestions_), or a negative gap (clock skew/bad
// data) — so a broken input never renders a nonsensical caption; it just
// renders no caption, same as the algorithmic-fallback suggestion path
// already does today.
function formatFollowupAgeGs_(updatedAt, now) {
  if (!(updatedAt instanceof Date)) return '';
  const ageHours = (now.getTime() - updatedAt.getTime()) / 36e5;
  if (ageHours < 0) return '';
  if (ageHours < 1) return ' (typed <1h ago)';
  if (ageHours < 48) return ' (typed ' + Math.round(ageHours) + 'h ago)';
  return ' (typed ' + Math.round(ageHours / 24) + 'd ago)';
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
/**
 * Trigger entry point (installed by setupOvernightEmailer). Same
 * crash-alerts-ops-then-rethrows wrapper as sendOvernightMorningEmails
 * above and sendAllIssuesEmails (AllIssuesEmailer.gs) — see that one's
 * own comment for why this matters.
 */
// ============================================================
// Two-checkpoint email lifecycle redesign (Step 7/11) -- see
// docs/_planning/EMAIL_LIFECYCLE_TWO_CHECKPOINT_REDESIGN.md for the
// full design. Everything below builds the 13:00 COMBINED email:
// Section 1 = Overnight Follow-up (sendOvernightFollowupEmails_'s own
// existing Pass 1/Pass 2 classification, unchanged logic), Section 2 =
// Checkpoint 2 (this morning's Checkpoint 1 AllIssues_Log rows compared
// to right now, via computeAllIssuesCheckpointGs_ /
// filterAllIssuesCheckpoint2ForEmailGs_ -- SlaEngine.gs). Unlike Step 6,
// Section 2's bucket set here is ALWAYS a SUBSET of Section 1's own
// `perRegion` set: whenever sendCombinedMorningEmail_ (Step 6) sets
// checkpoint1_json/checkpoint1_sent_at on an AllIssues_Log row, it ALSO
// writes an Overnight_Log row for that SAME recipient in that SAME call
// (see that function's own comment on why its write condition changed to
// `if (!sendFailureReason)`) -- so no separate "union of two
// independently-derived bucket sets" is needed the way Step 6 needed one;
// this just augments the EXISTING perRegion iteration with a lookup.
// ============================================================

// Section 1 opts extraction -- same pattern as buildOvernightSectionOptsGs_
// (Step 6), pulled out of sendOvernightFollowupEmails_'s own inline object
// so it can be reused unchanged whether or not Section 2 rides alongside it.
function buildOvernightFollowupSectionOptsGs_(region, unresolvedRows) {
  return {
    title: '1pm Follow-up',
    region: region,
    subtitle: "Re-checking this morning's flagged leads",
    kpis: [
      { value: unresolvedRows.length, label: 'Still Unresolved', bg: '#fee2e2', fg: '#dc2626' },
    ],
    sections: [{
      heading: 'Still Unresolved', accent: { fg: '#dc2626', headerBg: '#fee2e2', bg: '#fef2f2' },
      columns: ['Lead ID', 'RM', 'Issue', 'Suggested Follow-up'],
      rows: unresolvedRows.map(function (row) { return [row.lead_id, row.RM || 'Unassigned', row.detail, row.suggestion || '—']; }),
    }],
    footerNote: 'A lead counts as still unresolved only if it’s flagged for the SAME issue it had at 10am — anything else (issue cleared, lead closed, lead reached Opportunity+, or no longer found) is dropped from this follow-up rather than shown here.',
  };
}

// Section 1 placeholder for a bucket that has Checkpoint 2 content but
// nothing still unresolved from this morning's flags -- same shape
// renderOvernightReportEmailHTML_ always expects.
function buildOvernightFollowupSectionEmptyStateOptsGs_(region, reasonText) {
  return { title: '1pm Follow-up', region: region, subtitle: reasonText, kpis: [], action: '', sections: [], footerNote: '' };
}

// Reads AllIssues_Log for TODAY's (IST) rows that already have a
// Checkpoint 1 (checkpoint1_sent_at dated today -- i.e. this morning's
// 10am run) but no Checkpoint 2 yet (checkpoint2_sent_at blank -- the
// idempotency guard for THIS function, same role checkpoint1_sent_at
// plays for loadYesterdaysAllIssuesBucketsGs_). Keyed directly by
// recipient email (not by region first) since the caller looks these up
// per-bucket against `perRegion`'s own `to`, already known to be the SAME
// address (see this block's own header comment). Returns
// { lowercasedEmail -> {rowNumbers, to, cc, bucketLabel, primaryRole,
// snapshotEntries (original 17:00), checkpoint1Entries (this morning's
// Checkpoint 1 result -- the PRIOR checkpoint computeAllIssuesCheckpointGs_
// needs as its own input, design doc Part 4: the function accepts its own
// output shape)} }.
function loadTodaysCheckpoint1PendingGs_(ss, now) {
  const todayKey = istDayKeyGs_(now);
  const logSheet = ensureAllIssuesLogSheet_(ss);
  const lastRow = logSheet.getLastRow();
  const byEmail = {};
  if (lastRow < 2) return byEmail;

  const rows = withRetry_(function () { return logSheet.getRange(2, 1, lastRow - 1, 14).getValues(); }, 'read AllIssues_Log for Checkpoint 2');
  rows.forEach(function (r, i) {
    const checkpoint1SentAtCell = r[11]; // checkpoint1_sent_at, col L, 0-indexed 11
    if (!checkpoint1SentAtCell) return; // Checkpoint 1 not done yet -- nothing for Checkpoint 2 to build on
    const checkpoint1Key = checkpoint1SentAtCell instanceof Date ? istDayKeyGs_(checkpoint1SentAtCell) : String(checkpoint1SentAtCell || '').slice(0, 10);
    if (checkpoint1Key !== todayKey) return; // Checkpoint 1 happened on a different day -- not this morning's run
    if (r[13]) return; // checkpoint2_sent_at, col N, 0-indexed 13 -- already set, skip
    const snapshotRaw = r[9]; // issue_snapshot_json, col J
    const checkpoint1Raw = r[10]; // checkpoint1_json, col K
    if (!snapshotRaw || !checkpoint1Raw) return;
    let snapshotEntries, checkpoint1Entries;
    try {
      snapshotEntries = JSON.parse(snapshotRaw);
      checkpoint1Entries = JSON.parse(checkpoint1Raw);
    } catch (e) {
      Logger.log('loadTodaysCheckpoint1PendingGs_: could not parse JSON on AllIssues_Log row ' + (i + 2) + ' -- skipping this row: ' + e);
      return;
    }
    if (!checkpoint1Entries || !checkpoint1Entries.length) return;
    const to = String(r[4] || '').trim();
    if (!to) return;
    const key = to.toLowerCase();
    if (!byEmail[key]) {
      byEmail[key] = { to: to, cc: String(r[5] || ''), bucketLabel: String(r[2] || ''), primaryRole: String(r[3] || ''), rowNumbers: [], snapshotEntries: [], checkpoint1Entries: [] };
    }
    byEmail[key].rowNumbers.push(i + 2);
    byEmail[key].snapshotEntries = byEmail[key].snapshotEntries.concat(snapshotEntries);
    byEmail[key].checkpoint1Entries = byEmail[key].checkpoint1Entries.concat(checkpoint1Entries);
  });
  return byEmail;
}

// Sends ONE combined 13:00 email for a bucket (by recipient email -- same
// principle as sendCombinedMorningEmail_) and writes back Checkpoint 2's
// own state. `section1UnresolvedRows` is Pass 1's own classification
// output for this region (already computed above, suggestions already
// filled in by the caller). `section2Input` is either
// { to, cc, bucketLabel, primaryRole, rowNumbers, snapshotEntries,
// checkpoint1Entries } (from loadTodaysCheckpoint1PendingGs_) or null
// (nothing pending from this morning's Checkpoint 1 for this recipient).
// Threads into `threadId` via the EXISTING sendThreadedGmailReply_ (with
// its existing plain-fallback) -- unlike Step 6, there is no separate
// "resolve recipient" step here, since BOTH sections' recipients are
// already frozen (Section 1 from Overnight_Log, Section 2 from
// AllIssues_Log) -- routing was decided once, either this morning or
// yesterday at 17:00, never re-derived here.
function sendCombinedFollowupEmail_(ss, overnightLogSheet, overnightLogRowNumber, allIssuesLogSheet, region, threadId, sendTo, sendCc, subject, testModeBanner, section1UnresolvedRows, section2Input, now, baselineMap) {
  const section1Opts = section1UnresolvedRows.length
    ? buildOvernightFollowupSectionOptsGs_(region, section1UnresolvedRows)
    : buildOvernightFollowupSectionEmptyStateOptsGs_(region, 'Nothing still unresolved from this morning — all clear.');

  const checkpointTitle = 'Previous Day 17:00 All-Issues Follow-up — Checkpoint 2';
  let checkpoint2Results = null;
  let section2Opts;
  if (section2Input) {
    const rawCheckpoint2 = computeAllIssuesCheckpointGs_(ss, section2Input.checkpoint1Entries, now, baselineMap);
    checkpoint2Results = filterAllIssuesCheckpoint2ForEmailGs_(section2Input.checkpoint1Entries, rawCheckpoint2);
    const originalDateLabel = Utilities.formatDate(new Date(now.getTime() - 24 * 3600 * 1000), 'Asia/Kolkata', 'd MMM yyyy');
    section2Opts = checkpoint2Results.length
      ? buildAllIssuesCheckpointSectionOptsGs_(region, checkpointTitle, originalDateLabel, section2Input.snapshotEntries, checkpoint2Results)
      : buildAllIssuesCheckpointEmptyStateOptsGs_(region, checkpointTitle, "Nothing changed since this morning's Checkpoint 1 — no news to report.");
  } else {
    section2Opts = buildAllIssuesCheckpointEmptyStateOptsGs_(region, checkpointTitle, "Nothing pending from this morning's Checkpoint 1.");
  }

  const html = (testModeBanner ? testModeBanner.html : '') + renderTwoSectionEmailHTML_(section1Opts, section2Opts);
  const plainBody = (testModeBanner ? testModeBanner.plain : '') + '1pm follow-up for ' + region + ': Section 1 (Overnight Follow-up) ' +
    section1UnresolvedRows.length + ' still unresolved; Section 2 (Checkpoint 2) ' + (checkpoint2Results ? checkpoint2Results.length : 0) +
    ' lead(s) with news. Open this email in Gmail for the full breakdown.';

  // sendThreadedGmailReply_ retries its own send step internally
  // (withSendRetry_ — only a definitive rejection, never an ambiguous
  // timeout). The plain fallback below gets the same treatment
  // explicitly, for the same reason. Same try/catch shape as this
  // function's pre-Step-7 inline predecessor. `sendSucceeded` tracks
  // whether EITHER leg got the reply out — it gates the Step 8/11
  // followup_sent_at write below, so a total failure stays retryable on
  // the next run instead of being permanently marked done.
  let sendSucceeded = false;
  try {
    sendThreadedGmailReply_(threadId, sendTo, sendCc || '', subject, plainBody, html);
    sendSucceeded = true;
  } catch (threadErr) {
    Logger.log('Threaded send failed for ' + region + ' (thread ' + threadId + ') — falling back to a new message that will NOT auto-thread into the 10am email. Likely cause: the "Gmail API" Advanced Service isn\'t enabled yet (Apps Script editor -> Services (+)). Error: ' + threadErr);
    try {
      withSendRetry_(function () {
        return GmailApp.createDraft(sendTo, subject, plainBody, { cc: sendCc, htmlBody: html, name: 'Homesfy Lead Ops' }).send();
      }, 'send fallback follow-up (' + region + ')');
      sendSucceeded = true;
    } catch (fallbackErr) {
      Logger.log('Overnight follow-up reply failed entirely for ' + region + ' (thread ' + threadId + ', to ' + sendTo + '): ' + fallbackErr);
      notifyOpsAlertGs_('1pm follow-up failed for ' + region, [
        'Region: ' + region,
        'Thread: ' + threadId,
        'Intended recipient: ' + sendTo + (sendCc ? (' (cc: ' + sendCc + ')') : ''),
        'Section 1 still-unresolved leads (' + section1UnresolvedRows.length + '): ' + section1UnresolvedRows.map(function (row) { return row.lead_id; }).join(', '),
        'Section 2 Checkpoint 2 leads (' + (section2Input ? section2Input.checkpoint1Entries.length : 0) + '): ' + (section2Input ? section2Input.checkpoint1Entries.map(function (e) { return e.lead_id; }).join(', ') : '(none)'),
        '',
        'No follow-up email went out for this bucket this run — neither the threaded send nor the plain fallback succeeded. This bucket will be retried on the next run (followup_sent_at is only written on success).',
        'Error: ' + fallbackErr,
      ]);
    }
  }

  // checkpoint2_json/checkpoint2_sent_at -- written back even on a total
  // send failure, same reasoning as Checkpoint 1's own write in
  // sendCombinedMorningEmail_ (an un-checkpointed row silently falls out
  // of loadTodaysCheckpoint1PendingGs_'s own "today" scope once the
  // calendar day rolls over, since it only ever looks at TODAY's
  // checkpoint1_sent_at -- leaving it unwritten on failure wouldn't
  // create a retry opportunity tomorrow, it would just lose the row
  // forever with no record it was ever attempted). The ops alert above
  // already surfaces the failure for manual follow-up.
  if (section2Input) {
    // Step 9/11: own try/catch — same reasoning as sendCombinedMorningEmail_'s
    // checkpoint1_json write above. A failure here must not abort the
    // caller's per-bucket loop for every OTHER bucket still left this run.
    try {
      writeUnlessTestModeGs_(function () {
        section2Input.rowNumbers.forEach(function (rowNumber) {
          allIssuesLogSheet.getRange(rowNumber, 13, 1, 2).setValues([[JSON.stringify(checkpoint2Results), Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss')]]);
        });
      }, 'write checkpoint2_json back to AllIssues_Log (' + region + ')');
    } catch (logErr) {
      Logger.log('checkpoint2_json write failed for ' + region + ' (reply itself sent fine): ' + logErr);
    }
  }

  // followup_sent_at (Overnight_Log col I) -- Step 8/11's idempotency
  // guard for the WHOLE combined reply (Section 1 + Section 2 together,
  // since Step 7 made them ride in one email). Deliberately WRITTEN ONLY
  // ON SUCCESS, unlike checkpoint2_json above -- a send failure here
  // must stay retryable (the next run's Pass 1 skips a row only when
  // this column is truthy), whereas Section 2's own checkpoint write is
  // "write regardless" for a different reason (see that block's own
  // comment: no future run ever re-looks at an un-checkpointed row once
  // the day rolls over, so leaving it blank on failure would lose it
  // forever rather than enabling a retry).
  if (sendSucceeded) {
    // Step 9/11: own try/catch, consistent with every other write in this
    // function — even though this value is a small fixed-width timestamp
    // (never at real risk of the oversized-cell class of failure the
    // JSON writes above guard against), a failure here for any OTHER
    // reason must not abort the caller's per-bucket loop for every other
    // bucket still left this run either. The reply already sent
    // successfully; a lost followup_sent_at write only means this bucket
    // is (harmlessly) resent on the next run, not that anything breaks.
    try {
      writeUnlessTestModeGs_(function () {
        overnightLogSheet.getRange(overnightLogRowNumber, 9, 1, 1).setValues([[Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss')]]);
      }, 'write followup_sent_at back to Overnight_Log (' + region + ')');
    } catch (logErr) {
      Logger.log('followup_sent_at write failed for ' + region + ' (reply itself sent fine — this bucket will be re-sent, harmlessly, on the next run): ' + logErr);
    }
  }
}

function sendOvernightFollowupEmails() {
  try {
    sendOvernightFollowupEmails_();
  } catch (e) {
    notifyOpsAlertGs_('sendOvernightFollowupEmails crashed — NO 1pm follow-up emails were sent this run', [
      'sendOvernightFollowupEmails threw before completing, so no follow-up thread was updated for ANY region this run.',
      'Error: ' + (e && e.stack ? e.stack : e),
    ]);
    throw e;
  }
}

function sendOvernightFollowupEmails_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const now = new Date();
  const todayKey = istDayKeyGs_(now);
  const logSheet = ensureOvernightLogSheet_(ss);
  const lastRow = logSheet.getLastRow();
  if (lastRow < 2) return;

  // 9 columns, not 8 — col I (index 8) is followup_sent_at (Step 8/11's
  // idempotency guard, see ensureOvernightLogSheet_'s own comment).
  const logRows = withRetry_(function () { return logSheet.getRange(2, 1, lastRow - 1, 9).getValues(); }, 'read Overnight_Log');
  // Column A was written as a plain "yyyy-MM-dd" string (todayKey), but
  // Sheets auto-detects strings that look like dates and silently stores
  // the cell as a real Date instead — read back, that comes through here
  // as a JS Date object, not the original string. A bare String(r[0]) on
  // that Date never equals todayKey (real production symptom: this always
  // returned zero rows, so the whole function silently no-op'd on every
  // run). Normalize through istDayKeyGs_ for a Date cell, same as every
  // other date-key comparison in this codebase (e.g. MovementTracker.gs).
  // rowNumber captured alongside each row (index + 2, header is row 1) —
  // needed to write followup_sent_at back onto the EXACT row a combined
  // reply came from, same pattern AllIssues_Log's own checkpoint columns
  // already use.
  const todaysRuns = logRows
    .map(function (r, i) { return { r: r, rowNumber: i + 2 }; })
    .filter(function (entry) {
      const cell = entry.r[0];
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
  const perRegion = []; // { region, threadId, to, cc, subject, rowNumber, resolvedRows, unresolvedRows }
  todaysRuns.forEach(function (entry) {
    const run = entry.r;
    const rowNumber = entry.rowNumber;
    // Step 8/11 idempotency guard: followup_sent_at (col I) already set
    // means the combined 13:00 reply for this bucket already went out
    // today — skip the row entirely (classification, Lead_Followups
    // push, AND send), so a trigger retry or manual re-run reconciles
    // with the existing cycle instead of resending a duplicate reply
    // into the same thread. Only ever set on a CONFIRMED successful send
    // (see sendCombinedFollowupEmail_'s own comment) — a row whose send
    // failed stays blank here and IS retried on the next run, unlike
    // AllIssues_Log's checkpoint columns which are written even on
    // failure for a different reason (see that function's own comment).
    if (run[8] && !TEST_MODE_OVERRIDE_EMAIL_) return;
    const region = run[1];
    const threadId = run[2];
    const to = String(run[5] || '').trim();
    const cc = String(run[6] || '').trim();
    const subject = String(run[7] || '').trim();
    let issueLog;
    try { issueLog = JSON.parse(run[3] || '[]'); } catch (e) { issueLog = []; }
    // Deliberately NOT an early-return on an empty issueLog (unlike this
    // block's pre-Step-7 version) — this row still needs to reach
    // `perRegion` so Pass 2 can look it up by `to` and find its threadId,
    // even with zero Section 1 content: a bucket that got a Section-2-only
    // combined 10am email (sendCombinedMorningEmail_, Step 6's own fix)
    // logs an Overnight_Log row with an empty issueLog on purpose, and
    // that row's thread is exactly where a real, pending Checkpoint 2
    // needs to reply. issueLog.forEach below is a no-op on an empty array,
    // so resolvedRows/unresolvedRows simply stay empty — no behavior
    // change for the ordinary case where issueLog really is empty AND
    // nothing is pending from Checkpoint 1 (Pass 2's own union-aware
    // guard still skips sending anything for that bucket).
    const resolvedRows = [];
    const unresolvedRows = [];
    issueLog.forEach(function (entry) {
      const row = byLeadId[entry.lead_id];
      if (!row) { resolvedRows.push({ lead_id: entry.lead_id, RM: '', stage: '(not found)', detail: 'No longer in sheet' }); return; }
      const stage = String(getVal_(row, colIndex, 'current_stage') || '').trim();
      const RM = String(getVal_(row, colIndex, 'RM') || '').trim();
      const closingReason = getVal_(row, colIndex, 'closing_reason');
      const leadClosingReason = getVal_(row, colIndex, 'lead_closing_reason');
      if (isOppOrAbove_(stage, closingReason, leadClosingReason)) { resolvedRows.push({ lead_id: entry.lead_id, RM: RM, stage: stage, detail: 'Reached Opportunity+' }); return; }
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
    perRegion.push({ region: region, threadId: threadId, to: to, cc: cc, subject: subject, rowNumber: rowNumber, resolvedRows: resolvedRows, unresolvedRows: unresolvedRows });
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

  // ---- Section 2: this morning's Checkpoint 1 rows still awaiting
  // Checkpoint 2, keyed by recipient email — see this block's own header
  // comment above buildOvernightFollowupSectionOptsGs_ for why this is
  // always a SUBSET of perRegion's own buckets, not an independent union
  // the way Step 6 needed. ----
  const allIssuesLogSheet = ensureAllIssuesLogSheet_(ss);
  const checkpoint1PendingByEmail = loadTodaysCheckpoint1PendingGs_(ss, now);

  // Pass 2: send, now that suggestions (if any came back in time) are known.
  // Same renderOvernightReportEmailHTML_ shell the 10am email uses (see its
  // own comment). Red "Still Unresolved" only — same scoping as the
  // dashboard's own Stalled Leads section, which shows only what's
  // currently outstanding, not a resolved/unresolved comparison. A bucket
  // with nothing still unresolved AND nothing pending from Checkpoint 1
  // gets no follow-up reply at all, same reasoning as the morning email
  // dropping Opportunity+/closed leads entirely rather than showing them
  // as a separate "already handled" list.
  perRegion.forEach(function (r) {
    const section2Input = r.to ? (checkpoint1PendingByEmail[r.to.trim().toLowerCase()] || null) : null;
    if (!r.unresolvedRows.length && !section2Input) return; // nothing in EITHER section — nothing to send
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
    // column just showed "—" with nothing actionable in it. A human
    // suggestion gets its own age appended (LEADFOLLOWUPS-003,
    // 2026-09-09, formatFollowupAgeGs_ above) — pushUnresolvedToLeadFollowups_
    // never clears Lead_Followups, so this text can be arbitrarily old;
    // the algorithmic fallback is always computed fresh right here, so it
    // never needs (or gets) an age caption of its own.
    r.unresolvedRows.forEach(function (row) {
      const human = suggestionByLeadId[row.lead_id];
      row.suggestion = human
        ? human.suggestion + formatFollowupAgeGs_(human.updatedAt, now)
        : overnightFollowupHintGs_(row.sourceRow, colIndex, now, row.baselineEntry);
    });

    // TEST_MODE_OVERRIDE_EMAIL_ redirects the morning send, but r.to/r.cc
    // here come straight from whatever was ALREADY STORED in
    // Overnight_Log — if that row was logged by a REAL (non-test) morning
    // run, sending this follow-up under test mode would otherwise reach
    // the real people, defeating the whole point of the override. Same
    // "never reach a real recipient during a test run" guarantee as the
    // morning path, applied here explicitly since this function reads
    // stored recipients rather than re-resolving them. section2Input's own
    // `to` is always the SAME address (see the header comment above
    // buildOvernightFollowupSectionOptsGs_), so this single override
    // covers both sections.
    const sendTo = TEST_MODE_OVERRIDE_EMAIL_ || r.to;
    const sendCc = TEST_MODE_OVERRIDE_EMAIL_ ? undefined : (r.cc || undefined);
    const testModeBanner = TEST_MODE_OVERRIDE_EMAIL_ ? {
      html: '<div style="background:#fef3c7; border:2px solid #f59e0b; border-radius:8px; padding:12px 16px; margin-bottom:14px; font-family:Arial,Helvetica,sans-serif;">' +
        '<div style="font-weight:700; color:#92400e; font-size:13px;">TEST MODE — real send suppressed</div>' +
        '<div style="color:#78350f; font-size:12.5px; margin-top:4px;">This would really have gone to: <b>' + esc_(r.to) + '</b>' + (r.cc ? ' (cc: ' + esc_(r.cc) + ')' : ' (no cc)') + '</div>' +
        '</div>',
      plain: 'TEST MODE — real send suppressed. This would really have gone to: ' + r.to + (r.cc ? ' (cc: ' + r.cc + ')' : ' (no cc)') + '\n\n',
    } : null;

    const subject = 'Re: ' + (r.subject || (r.region + ' Google Overnight Leads'));
    sendCombinedFollowupEmail_(ss, logSheet, r.rowNumber, allIssuesLogSheet, r.region, r.threadId, sendTo, sendCc, subject, testModeBanner, r.unresolvedRows, section2Input, now, baselineMap);
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
    const closingReason = getVal_(row, colIndex, 'closing_reason');
    const leadClosingReason = getVal_(row, colIndex, 'lead_closing_reason');
    if (isOppOrAbove_(stage, closingReason, leadClosingReason)) return;
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

  const logRows = withRetry_(function () { return logSheet.getRange(2, 1, lastRow - 1, 9).getValues(); }, 'debug: read Overnight_Log');
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
    const followupSentAt = run[8];
    Logger.log('--- Row ' + (idx + 1) + '/' + todaysRuns.length + ': region=' + region + ', thread=' + threadId + ' ---');
    Logger.log('  stored to="' + to + '"  cc="' + cc + '"  subject="' + subject + '"' + (to ? '' : '  <<< EMPTY — this row predates the recipient-storing fix, or resolveRecipientEmailsForRegion_ returned nothing for it. sendOvernightFollowupEmails SKIPS this row entirely (see its own comment). Run backfillTodaysOvernightLogRecipientsNow to fix today\'s rows, or wait for tomorrow\'s fresh 10am run.'));
    Logger.log('  followup_sent_at=' + (followupSentAt ? JSON.stringify(followupSentAt) + '  <<< already sent today — sendOvernightFollowupEmails SKIPS this row entirely (Step 8/11 idempotency guard)' : '(blank — not yet sent, or a prior attempt failed and will be retried)'));

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
      if (isOppOrAbove_(stage, closingReason, leadClosingReason)) { resolvedCount++; detail.push(entry.lead_id + ' (RM: ' + rm + '): resolved (reached Opportunity+, stage="' + stage + '")'); return; }
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
