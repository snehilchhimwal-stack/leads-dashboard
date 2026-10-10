/**
 * CycleReport.gs - the daily 16:30 report (Email Operations System, part EO-8).
 * Plan and decisions: docs/_planning/EMAIL_OPS_SYSTEM_AUDIT.md (section 0: D1 - one report to Snehil at 16:30 covering the whole
 * cycle that started at the previous day's 17:00, sent when everything is fine AND when it is not).
 *
 * WHAT IT SAYS. Built only from the evidence the system keeps (EmailLedger.gs): every bucket email of the cycle by job with its final
 * status, what was left out and why, the incidents raised, what needs attention, and whether the 17:00 send is ready. Nothing is guessed:
 * "accepted" means Gmail took the message; delivery and opens cannot be seen from Apps Script, and bounces/replies/the age of the Leads tab are
 * not tracked yet (the report says so instead of implying all-clear on things it cannot see).
 *
 * THE CYCLE. 16:30 of the previous IST day up to the moment of the report - so a 16:30 run covers yesterday's 17:00 send, today's 10:00 and
 * 13:00 emails and the CH-level reports. A manual run at another time shows the last full cycle plus what has happened since.
 *
 * It keeps a run record like the email jobs (the hourly watchdog alerts when it did not run, emailJobScheduleGs_) but does NOT take the script-wide job lock, so it can never make the 17:00 job skip.
 * It sends ONE email to the ops address only (opsAlertEmailGs_), once per day (a re-fire the same day is skipped; sendEmailCycleReportNow()
 * sends again on purpose).
 */

// Read-only helper FIRST in the file (the editor's Run button has run the previously selected function before - see HANDOVER).
// Logs the report as it would be sent right now. Sends nothing, writes nothing.
function showEmailCycleReportNow() {
  const built = buildEmailCycleReportGs_(SpreadsheetApp.getActiveSpreadsheet(), new Date());
  Logger.log(built.subject);
  Logger.log(built.plainBody);
}

const CYCLE_REPORT_JOB_ = 'sendEmailCycleReport';
const CYCLE_REPORT_HOUR_ = 16;   // IST
const CYCLE_REPORT_MINUTE_ = 30; // IST
const CYCLE_REPORT_SENT_PROPERTY_ = 'EMAIL_CYCLE_REPORT_SENT_DAY';
const CYCLE_REPORT_MAX_ROWS_ = 30; // per table, so a bad day cannot make the report unreadable
// One row per IST day, upserted by the report: the day's numbers (numerators; the report email carries the rates) for tracking over time.
const CYCLE_REPORT_DAILY_SHEET_ = 'Daily_Report';
const CYCLE_REPORT_DAILY_HEADERS_ = ['report_day', 'sent_at', 'window_start', 'window_end', 'planned', 'accepted', 'skipped', 'failed', 'unconfirmed', 'blocked',
  'unfinished', 'leads_sent', 'bounced', 'replied', 'leads_left_out', 'regions_skipped', 'incidents', 'serious_incidents', 'all_clear', 'leads_freshness', 'leads_age_hours'];
const CYCLE_REPORT_DAILY_TEXT_COLUMNS_ = [1]; // report_day kept as plain text
const CYCLE_REPORT_JOB_ORDER_ = ['allIssues17', 'chLevel17', 'morning10', 'chLevel10', 'followup13'];

// 16:30 of the previous IST day -> now. Before today's 16:30 the cycle that just ended is the one before, so the window reaches one day further back.
function cycleReportWindowGs_(now) {
  const dayMs = 24 * 3600 * 1000;
  const todayAt = new Date(istDayKeyGs_(now) + 'T' + pad2Gs_(CYCLE_REPORT_HOUR_) + ':' + pad2Gs_(CYCLE_REPORT_MINUTE_) + ':00+05:30');
  const lastBoundary = now.getTime() >= todayAt.getTime() ? todayAt : new Date(todayAt.getTime() - dayMs);
  return { start: new Date(lastBoundary.getTime() - dayMs), end: now };
}

function cycleReportInWindowGs_(value, win) {
  return value instanceof Date && value.getTime() >= win.start.getTime() && value.getTime() <= win.end.getTime();
}

// "6 of 7 (86%)" - the numerator and denominator are always shown.
function cycleRateGs_(n, d) { return d > 0 ? n + ' of ' + d + ' (' + Math.round(100 * n / d) + '%)' : 'n/a'; }

// Pure: the numbers and lists of the report. input = { ledgerRows, exclusionRows, incidentRows, window, configProblems, freshness, jobProblems, audits }
// (jobProblems / audits feed the daily checklist, DailyChecklist.gs - optional; followupLog, the cycle day's AllIssues_Log buckets or null when unreadable, feeds the
// follow-up tracker, FollowupTracker.gs - optional; reroutes, the Email_Reroutes rows, tells which bounces were handled - EmailReroute.gs, optional).
// A bounce is HANDLED when its email was re-sent to the person next in the hierarchy (an ACCEPTED 'RR|<email id>' ledger row) or only a Cc address bounced.
function cycleReportDataGs_(input) {
  const win = input.window;
  const ledger = (input.ledgerRows || []).filter(function (r) { return cycleReportInWindowGs_(r.planned_at, win); });
  const exclusions = (input.exclusionRows || []).filter(function (r) { return cycleReportInWindowGs_(r.recorded_at, win); });
  const incidents = (input.incidentRows || []).filter(function (r) { return cycleReportInWindowGs_(r.detected_at, win); });

  const newCounts = function () { return { planned: 0, accepted: 0, skipped: 0, failed: 0, unconfirmed: 0, blocked: 0, unfinished: 0, leadsSent: 0 }; };
  const byJob = {};
  const totals = newCounts();
  const attention = [];
  // Bounce/reply evidence from the daily sweep (EmailSweep.gs): only for emails Gmail accepted (or may have accepted).
  const sweep = { bounced: 0, rerouted: 0, replied: 0, noBounce: 0, notSwept: 0, lastSweep: null, replies: [] };
  const rerouteRows = input.reroutes || [];
  const rrById = {}, ccOnlyById = {};
  ledger.forEach(function (r) { if (r.job === 'reroute') rrById[r.email_id] = r; });
  rerouteRows.forEach(function (e) { if (String(e.note || '') === 'cc only' && e.source_email_id) ccOnlyById[e.source_email_id] = e; });
  ledger.forEach(function (r) {
    const job = String(r.job || '');
    const c = byJob[job] = byJob[job] || newCounts();
    const status = String(r.status || '');
    [c, totals].forEach(function (t) {
      t.planned++;
      if (status === 'ACCEPTED') { t.accepted++; t.leadsSent += Number(r.leads_sent) || 0; }
      else if (status === 'SKIPPED') t.skipped++;
      else if (status === 'FAILED') t.failed++;
      else if (status === 'UNCONFIRMED') t.unconfirmed++;
      else if (status === 'BLOCKED') t.blocked++;
      else t.unfinished++; // PLANNED / ATTEMPTING / anything unexpected: the run ended without a final status
    });
    if (status === 'ACCEPTED' || status === 'UNCONFIRMED') {
      const bs = String(r.bounce_status || ''), rs = String(r.reply_status || '');
      if (/^BOUNCED/.test(bs)) {
        sweep.bounced++;
        const rr = rrById['RR|' + r.email_id];
        const resent = !!(rr && String(rr.status) === 'ACCEPTED');
        if (resent || ccOnlyById[r.email_id]) {
          sweep.rerouted++;
          attention.push({ job: job, region: r.region, bucket: r.bucket_label || r.to, status: 'BOUNCED - RE-ROUTED', reason: (resent
            ? 'a delivery-failure message came back (' + bs + '); the email was re-sent to ' + rr.to
            : 'only a Cc address bounced (' + bs + '); the To recipient received it') + ' - fix the address in Manager_Directory' });
        } else {
          attention.push({ job: job, region: r.region, bucket: r.bucket_label || r.to, status: 'BOUNCED', reason: 'Gmail accepted it but a delivery-failure message came back (' + bs + ') - the recipient did not get it' });
        }
      } else if (bs === 'NO_BOUNCE_SEEN') sweep.noBounce++;
      else sweep.notSwept++;
      if (/^REPLIED/.test(rs)) { sweep.replied++; sweep.replies.push({ job: job, region: r.region, bucket: r.bucket_label || r.to, status: rs }); }
      if (r.swept_at instanceof Date && (!sweep.lastSweep || r.swept_at.getTime() > sweep.lastSweep.getTime())) sweep.lastSweep = r.swept_at;
    }
    if (status !== 'ACCEPTED' && status !== 'SKIPPED') {
      attention.push({ job: job, region: r.region, bucket: r.bucket_label || r.to, status: status || '(blank)', reason: String(r.status_reason || (status === 'PLANNED' || status === 'ATTEMPTING' ? 'the run ended without a final result - the outcome is unknown' : '')) });
    }
  });

  const reasonCounts = {};
  let leadsLeftOut = 0, regionsSkipped = 0;
  exclusions.forEach(function (r) {
    if (r.kind === 'region') regionsSkipped++; else leadsLeftOut++;
    const key = String(r.reason || '(no reason)').replace(/\d+/g, '#').slice(0, 90);
    const e = reasonCounts[key] = reasonCounts[key] || { reason: key, leads: 0, regions: 0 };
    if (r.kind === 'region') e.regions++; else e.leads++;
  });
  const reasons = Object.keys(reasonCounts).map(function (k) { return reasonCounts[k]; }).sort(function (a, b) { return (b.leads + b.regions) - (a.leads + a.regions); });

  const bySeverity = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  incidents.forEach(function (r) { if (bySeverity[r.severity] !== undefined) bySeverity[r.severity]++; });
  const serious = incidents.filter(function (r) { return r.severity !== 'LOW'; });
  const heldNow = (input.incidentRows || []).filter(function (r) { return r.notification === 'HELD'; }).length;

  const fr = input.freshness || null;
  if (fr && (fr.level === 'AMBER' || fr.level === 'RED')) {
    attention.push({ job: '-', region: '-', bucket: 'Leads tab', status: 'LEADS ' + fr.level, reason: fr.text });
  }
  const attemptable = totals.planned - totals.skipped;
  const allClear = totals.planned > 0 && attention.length === 0 && serious.length === 0;
  const data = {
    cycle: win, totals: totals, byJob: byJob, attention: attention, exclusions: { leads: leadsLeftOut, regions: regionsSkipped, reasons: reasons },
    incidents: incidents, bySeverity: bySeverity, seriousIncidents: serious.length, heldNow: heldNow, configProblems: input.configProblems || [],
    attemptable: attemptable, allClear: allClear, empty: totals.planned === 0, sweep: sweep, freshness: fr, checklist: null, followups: null,
    reroutes: rerouteRows.filter(function (e) { return typeof emailRerouteIsActiveGs_ === 'function' && emailRerouteIsActiveGs_(e, win.end.getTime()); }),
  };
  // The follow-up tracker (EO-7) - fail-open like the checklist. Only when the caller supplied the log (undefined = not asked; null = could not be read).
  if (typeof followupTrackerGs_ === 'function' && input.followupLog !== undefined) {
    const cycleDay = istDayKeyGs_(win.start);
    try {
      data.followups = input.followupLog === null ? { cycleDay: cycleDay, rows: [], counts: null, attention: [], unreadable: true }
        : followupTrackerGs_({ cycleDay: cycleDay, logRows: input.followupLog, ledgerRows: ledger, now: win.end });
    } catch (e) { Logger.log('Follow-up tracker not built - the report is NOT affected: ' + e); }
  }
  // The daily checklist A-K (EO-6) - fail-open: a problem in it only means the report has no checklist section.
  if (typeof dailyChecklistGs_ === 'function') {
    try { data.checklist = dailyChecklistGs_({ data: data, jobProblems: input.jobProblems === undefined ? null : input.jobProblems, audits: input.audits || {} }); } catch (e) { Logger.log('Daily checklist not built - the report is NOT affected: ' + e); }
  }
  return data;
}

// Pure: { subject, html, plainBody } from the data.
function cycleReportRenderGs_(data, now) {
  const t = data.totals;
  const fmt = function (d) { return Utilities.formatDate(d, 'Asia/Kolkata', 'd MMM HH:mm'); };
  const needs = data.attention.length + data.seriousIncidents;
  const dateLabel = Utilities.formatDate(now, 'Asia/Kolkata', 'd MMM yyyy');
  const subject = 'Email Ops cycle report ' + dateLabel + ': ' + (data.empty ? 'no emails recorded in this cycle'
    : data.allClear ? 'all clear (' + t.accepted + ' of ' + t.planned + ' emails accepted by Gmail' + (t.skipped ? ', ' + t.skipped + ' had nothing to send' : '') + ')'
    : needs + ' need attention (' + t.accepted + ' of ' + t.planned + ' emails accepted by Gmail)');

  const sections = [];
  const jobRows = CYCLE_REPORT_JOB_ORDER_.concat(Object.keys(data.byJob).filter(function (j) { return CYCLE_REPORT_JOB_ORDER_.indexOf(j) === -1; }))
    .filter(function (j) { return data.byJob[j]; })
    .map(function (j) {
      const c = data.byJob[j];
      return [EMAIL_LEDGER_JOB_LABELS_[j] || j, c.planned, c.accepted, c.skipped, c.failed, c.unconfirmed, c.blocked, c.unfinished, c.leadsSent];
    });
  if (jobRows.length) {
    jobRows.push(['All emails', t.planned, t.accepted, t.skipped, t.failed, t.unconfirmed, t.blocked, t.unfinished, t.leadsSent]);
    sections.push({
      heading: 'What went out', subheading: 'Accepted = Gmail took the message (delivery and opens cannot be seen from here). Skipped = nothing to send. Unfinished = the run ended without a result.',
      columns: ['Email', 'Planned', 'Accepted', 'Skipped', 'Failed', 'Unconfirmed', 'Blocked', 'Unfinished', 'Leads sent'], rows: jobRows,
    });
  }
  if (jobRows.length) {
    const sw = data.sweep;
    sections.push({
      heading: 'Bounces and replies', subheading: sw.lastSweep ? 'Checked by the sweep at ' + fmt(sw.lastSweep) + ' IST. "No bounce found" is NOT proof of delivery.' : 'The bounce/reply sweep has not run for these emails yet.',
      columns: ['What', 'Emails'],
      rows: [['Bounced (accepted by Gmail, then a delivery-failure message came back)', sw.bounced], ['...of which re-routed to the next person in the hierarchy', sw.rerouted], ['Replies received', sw.replied], ['No bounce found', sw.noBounce], ['Not checked yet', sw.notSwept]],
    });
    if (data.reroutes.length) {
      sections.push({
        heading: 'Re-routed addresses in force (' + data.reroutes.length + ')', accent: { fg: '#b45309', headerBg: '#fef3c7', bg: '#fffbeb' },
        subheading: 'Every email to the address on the left goes to the person on the right until the date shown (then the address is tried again). Fix the address in Manager_Directory to end it sooner.',
        columns: ['Bounced address', 'Now goes to', 'Since (IST)', 'Until', 'Why'],
        rows: data.reroutes.slice(0, CYCLE_REPORT_MAX_ROWS_).map(function (e) {
          return [(e.dead_name ? e.dead_name + ' ' : '') + e.dead_email, (e.new_name ? e.new_name + ' ' : '') + e.new_email + (e.via === 'ops fallback' ? ' (nobody above on record)' : ''), fmt(e.created_at), Utilities.formatDate(e.expires_at, 'Asia/Kolkata', 'd MMM'), e.note || e.source_job || ''];
        }),
      });
    }
    if (sw.replies.length) {
      sections.push({
        heading: 'Replies received (' + sw.replied + ')', columns: ['Email', 'Region', 'Bucket / recipient', 'Replies'],
        rows: sw.replies.slice(0, CYCLE_REPORT_MAX_ROWS_).map(function (x) { return [EMAIL_LEDGER_JOB_LABELS_[x.job] || x.job, x.region, x.bucket, x.status]; }),
      });
    }
  }
  if (data.attention.length) {
    sections.push({
      heading: 'Needs attention (' + data.attention.length + ')', accent: { fg: '#dc2626', headerBg: '#fee2e2', bg: '#fef2f2' },
      columns: ['Email', 'Region', 'Bucket / recipient', 'Status', 'Why'],
      rows: data.attention.slice(0, CYCLE_REPORT_MAX_ROWS_).map(function (a) { return [EMAIL_LEDGER_JOB_LABELS_[a.job] || a.job, a.region, a.bucket, a.status, a.reason]; }),
      subheading: data.attention.length > CYCLE_REPORT_MAX_ROWS_ ? 'First ' + CYCLE_REPORT_MAX_ROWS_ + ' of ' + data.attention.length + ' - see Email_Ledger for the rest.' : '',
    });
  }
  if (data.exclusions.reasons.length) {
    sections.push({
      heading: 'Left out of emails', subheading: data.exclusions.leads + ' lead(s) and ' + data.exclusions.regions + ' region run(s) were left out on purpose, each with a reason (Email_Ledger_Exclusions).',
      columns: ['Reason', 'Leads', 'Regions'], rows: data.exclusions.reasons.slice(0, CYCLE_REPORT_MAX_ROWS_).map(function (e) { return [e.reason, e.leads, e.regions]; }),
    });
  }
  if (data.incidents.length) {
    sections.push({
      heading: 'Incidents in this cycle (' + data.incidents.length + ')', subheading: 'CRITICAL ' + data.bySeverity.CRITICAL + ' | HIGH ' + data.bySeverity.HIGH + ' | MEDIUM ' + data.bySeverity.MEDIUM + ' | LOW ' + data.bySeverity.LOW + ' (Incident_Log)',
      columns: ['Time (IST)', 'Severity', 'Job', 'What', 'You were told'],
      rows: data.incidents.slice(0, CYCLE_REPORT_MAX_ROWS_).map(function (i) { return [fmt(i.detected_at), i.severity, i.job || '-', i.subject, i.notification + (i.notified_at instanceof Date ? ' ' + fmt(i.notified_at) : '')]; }),
    });
  }
  if (data.followups && typeof followupTrackerSectionsGs_ === 'function') followupTrackerSectionsGs_(data.followups).forEach(function (sec) { sections.push(sec); });
  if (data.checklist && typeof dailyChecklistSectionGs_ === 'function') sections.push(dailyChecklistSectionGs_(data.checklist));
  sections.push({
    heading: 'Ready for 17:00?', columns: ['Check', 'Result'],
    rows: [
      ['Recipient addresses resolve', data.configProblems.length ? data.configProblems.length + ' problem(s): ' + data.configProblems.map(function (p) { return p.detail; }).join(' | ') : 'OK'],
      ['Alerts waiting to be sent', data.heldNow ? data.heldNow + ' held alert(s) - a job may have been killed; the watchdog releases them' : 'none'],
      ['Leads tab freshness', data.freshness ? data.freshness.text : 'not checked'],
      ['Not tracked yet', (data.sweep.lastSweep ? '' : 'bounces and replies (the 15:30 sweep has not run yet); ') + 'delivery and opens cannot be seen from Apps Script'],
    ],
  });

  const opts = {
    title: 'Email Operations - Daily Cycle Report', regionLabel: 'Whole cycle: ' + fmt(data.cycle.start) + ' to ' + fmt(data.cycle.end) + ' IST',
    subtitle: data.empty ? 'No emails were recorded in this cycle.' : 'Email execution: ' + cycleRateGs_(t.accepted, data.attemptable) + ' accepted by Gmail (accepted / planned minus skipped).',
    kpis: [
      { value: t.planned, label: 'Emails planned', bg: '#dbeafe', fg: '#2563eb' },
      { value: t.accepted, label: 'Accepted by Gmail', bg: '#d1fae5', fg: '#059669' },
      { value: data.attention.length, label: 'Need attention', bg: data.attention.length ? '#fee2e2' : '#f3f4f6', fg: data.attention.length ? '#dc2626' : '#6b7280' },
      { value: data.incidents.length, label: 'Incidents', bg: data.seriousIncidents ? '#fef3c7' : '#f3f4f6', fg: data.seriousIncidents ? '#b45309' : '#6b7280' },
    ],
    action: data.empty ? 'No ledger rows fall in this cycle. If emails were expected, check that the ledger tabs exist and that the jobs ran (showEmailJobRunsNow).'
      : data.allClear ? 'Nothing to do - every planned email reached a final result and no incident needed you.'
      : 'Look at the "Needs attention" and "Incidents" tables below; errors are emailed separately as they happen, after the rest of the run is confirmed sent.',
    sections: sections,
    footerNote: 'Numbers come from Email_Ledger, Email_Ledger_Exclusions and Incident_Log. This report is sent to you only.',
  };
  return { subject: subject, html: renderOvernightReportEmailHTML_(opts), plainBody: plainTextReportGs_(opts) };
}

// GREEN / AMBER / RED from the age (hours) of the newest lead assignment (decision D4); the rules live in EmailInfra.gs so every emailer shares them.
function cycleFreshnessLevelGs_(ageHours) { return leadsFreshnessLevelGs_(ageHours); }

// How fresh the Leads tab looks now: { level: GREEN|AMBER|RED|UNKNOWN, ageHours, newest, text }. UNKNOWN (never a guess) when the tab cannot be read.
function cycleLeadsFreshnessGs_(ss, now) {
  try {
    const leads = readLeadsTab_(ss);
    return leadsFreshnessFromRowsGs_(leads.colIndex, leads.dataRows, now);
  } catch (e) {
    return { level: 'UNKNOWN', ageHours: null, newest: null, text: 'UNKNOWN: the Leads tab could not be read (' + String((e && e.message) || e) + ')' };
  }
}

// Upserts the day's row in Daily_Report (fail-open: the report email never depends on it). TEST MODE writes nothing.
function cycleReportRecordDailyGs_(ss, data, now) {
  if (TEST_MODE_OVERRIDE_EMAIL_) return;
  try {
    const sheet = emailLedgerEnsureSheetGs_(ss, CYCLE_REPORT_DAILY_SHEET_, CYCLE_REPORT_DAILY_HEADERS_, CYCLE_REPORT_DAILY_TEXT_COLUMNS_);
    const t = data.totals, fr = data.freshness;
    const day = istDayKeyGs_(now);
    const row = [day, now, data.cycle.start, data.cycle.end, t.planned, t.accepted, t.skipped, t.failed, t.unconfirmed, t.blocked, t.unfinished, t.leadsSent,
      data.sweep.bounced, data.sweep.replied, data.exclusions.leads, data.exclusions.regions, data.incidents.length, data.seriousIncidents, data.allClear ? 'yes' : 'no',
      fr ? fr.level : 'not checked', fr && fr.ageHours !== null ? Math.round(fr.ageHours * 10) / 10 : ''];
    const last = sheet.getLastRow();
    if (last >= 2 && emailLedgerDayKeyOfGs_(sheet.getRange(last, 1, 1, 1).getValue()) === day) {
      writeUnlessTestModeGs_(function () { sheet.getRange(last, 1, 1, row.length).setValues([row]); }, 'update the Daily_Report row');
    } else {
      emailLedgerAppendBlockGs_(sheet, [row], function (probe) { return emailLedgerDayKeyOfGs_(probe) === day; }, 'append the Daily_Report row');
    }
  } catch (e) {
    Logger.log('Daily_Report row not written - the report email is NOT affected: ' + e);
  }
}

// The Email_Reroutes rows (EmailReroute.gs), [] when that file is not installed or the tab cannot be read - the report then simply lists no re-routes.
function cycleReportRerouteRowsGs_(ss) {
  try { return typeof emailRerouteReadEntriesGs_ === 'function' ? emailRerouteReadEntriesGs_(ss) : []; } catch (e) { return []; }
}

// The watchdog's view of today's runs (emailJobProblemsGs_), or null when it cannot be read - the checklist then says so instead of guessing.
function cycleReportJobProblemsGs_(now) {
  try { return emailJobProblemsGs_(now); } catch (e) { return null; }
}

// The last result of each silent audit (OpsAudit.gs), for the checklist: { morning, followup, allIssues } - each a record or null.
function cycleReportAuditsGs_() {
  const out = {};
  if (typeof OPS_AUDIT_SPECS_ === 'undefined' || typeof opsAuditReadRecordGs_ !== 'function') return out;
  Object.keys(OPS_AUDIT_SPECS_).forEach(function (k) { out[k] = opsAuditReadRecordGs_(OPS_AUDIT_SPECS_[k]); });
  return out;
}

// Reads the three evidence tabs and builds the report for `now`. Pure apart from reading the spreadsheet.
function buildEmailCycleReportGs_(ss, now) {
  const win = cycleReportWindowGs_(now);
  const startKey = istDayKeyGs_(win.start);
  const data = cycleReportDataGs_({
    window: win,
    ledgerRows: emailLedgerReadRowsGs_(ss.getSheetByName(EMAIL_LEDGER_SHEET_), EMAIL_LEDGER_HEADERS_, startKey),
    exclusionRows: emailLedgerReadRowsGs_(ss.getSheetByName(EMAIL_LEDGER_EXCLUSIONS_SHEET_), EMAIL_LEDGER_EXCLUSION_HEADERS_, startKey),
    incidentRows: emailLedgerReadRowsGs_(ss.getSheetByName(EMAIL_INCIDENT_LOG_SHEET_), EMAIL_INCIDENT_HEADERS_, startKey),
    configProblems: typeof emailConfigProblemsGs_ === 'function' ? emailConfigProblemsGs_() : [],
    freshness: cycleLeadsFreshnessGs_(ss, now),
    jobProblems: cycleReportJobProblemsGs_(now),
    audits: cycleReportAuditsGs_(),
    followupLog: typeof followupTrackerReadLogGs_ === 'function' ? followupTrackerReadLogGs_(ss, startKey) : undefined,
    reroutes: cycleReportRerouteRowsGs_(ss),
  });
  const rendered = cycleReportRenderGs_(data, now);
  rendered.data = data;
  return rendered;
}

// The real run. opts.now (tests), opts.force (skip the once-a-day guard).
function sendEmailCycleReport_(opts) {
  const o = opts || {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const now = o.now || new Date();
  const day = istDayKeyGs_(now);
  if (!o.force && !TEST_MODE_OVERRIDE_EMAIL_) {
    let sentDay = '';
    try { sentDay = PropertiesService.getScriptProperties().getProperty(CYCLE_REPORT_SENT_PROPERTY_) || ''; } catch (e) { sentDay = ''; }
    if (sentDay === day) { Logger.log('Cycle report for ' + day + ' was already sent today - not sending again (use sendEmailCycleReportNow to send it on purpose).'); return null; }
  }
  const built = buildEmailCycleReportGs_(ss, now);
  const to = TEST_MODE_OVERRIDE_EMAIL_ || opsAlertEmailGs_();
  sendGuardedEmailGs_({ to: to, subject: (TEST_MODE_OVERRIDE_EMAIL_ ? '[TEST MODE] ' : '') + built.subject, plainBody: built.plainBody, htmlBody: built.html }, 'send the 16:30 cycle report');
  if (!TEST_MODE_OVERRIDE_EMAIL_) {
    try { PropertiesService.getScriptProperties().setProperty(CYCLE_REPORT_SENT_PROPERTY_, day); } catch (e2) { Logger.log('Could not record the cycle report as sent (it may be sent twice today): ' + e2); }
  }
  cycleReportRecordDailyGs_(ss, built.data, now);
  if (typeof dailyChecklistRecordGs_ === 'function') dailyChecklistRecordGs_(ss, built.data.checklist, now);
  if (typeof followupTrackerRecordGs_ === 'function') followupTrackerRecordGs_(ss, built.data.followups, now);
  Logger.log('Cycle report sent: ' + built.subject);
  return built;
}

// Trigger entry point: the run record (so the watchdog sees it) but deliberately NOT the script-wide job lock - a nearMinute(30) trigger can fire from 16:15 to 16:45,
// and holding the lock while the 17:00 job (which can fire from 16:45) starts would make the primary send skip. The report only reads, plus its own Daily_Report row.
// A crash alerts ops before re-throwing - same shape as the email jobs.
function sendEmailCycleReport() {
  runEmailJobTrackedGs_(CYCLE_REPORT_JOB_, function () {
    try {
      sendEmailCycleReport_();
    } catch (e) {
      notifyOpsAlertGs_('sendEmailCycleReport crashed - the 16:30 cycle report was NOT sent', ['Error: ' + (e && e.stack ? e.stack : e)], { immediate: true });
      throw e;
    }
  });
}

// Sends the report again on purpose (ignores the once-a-day guard).
function sendEmailCycleReportNow() {
  runEmailJobTrackedGs_(CYCLE_REPORT_JOB_, function () { sendEmailCycleReport_({ force: true }); });
}

// One-time setup - ONE daily trigger near 16:30 IST. Safe to re-run: deletes its own earlier trigger first.
function setupEmailCycleReportTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendEmailCycleReport') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendEmailCycleReport')
    .timeBased()
    .atHour(CYCLE_REPORT_HOUR_)
    .nearMinute(CYCLE_REPORT_MINUTE_)
    .everyDays(1)
    .inTimezone('Asia/Kolkata')
    .create();
  Logger.log('Email cycle report trigger installed - runs daily near ' + CYCLE_REPORT_HOUR_ + ':' + pad2Gs_(CYCLE_REPORT_MINUTE_) + ' IST.');
}
