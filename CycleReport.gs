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
 * It runs through the same job lock and run record as the email jobs, and the hourly watchdog alerts when it did not run (emailJobScheduleGs_).
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
const CYCLE_REPORT_JOB_ORDER_ = ['allIssues17', 'chLevel17', 'morning10', 'chLevel10', 'followup13'];
const CYCLE_REPORT_JOB_LABELS_ = {
  allIssues17: '17:00 All-Issues', chLevel17: 'CH-level (17:00)', morning10: '10:00 Overnight + Checkpoint 1',
  chLevel10: 'CH-level (10:00)', followup13: '13:00 follow-up',
};

// 16:30 of the previous IST day -> now. Before today's 16:30 the cycle that just ended is the one before, so the window reaches one day further back.
function cycleReportWindowGs_(now) {
  const dayMs = 24 * 3600 * 1000;
  const todayAt = new Date(istDayKeyGs_(now) + 'T' + pad2Gs_(CYCLE_REPORT_HOUR_) + ':' + pad2Gs_(CYCLE_REPORT_MINUTE_) + ':00+05:30');
  const lastBoundary = now.getTime() >= todayAt.getTime() ? todayAt : new Date(todayAt.getTime() - dayMs);
  return { start: new Date(lastBoundary.getTime() - dayMs), end: now };
}

// Rows of a tab whose day column (column B in all three evidence tabs) is on/after startDayKey, as objects keyed by header name.
function cycleReadRowsGs_(sheet, headers, startDayKey) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const last = sheet.getLastRow();
  const days = sheet.getRange(2, 2, last - 1, 1).getValues();
  let first = -1;
  for (let i = 0; i < days.length; i++) {
    if (emailLedgerDayKeyOfGs_(days[i][0]) >= startDayKey) { first = i; break; }
  }
  if (first === -1) return [];
  return sheet.getRange(first + 2, 1, last - first - 1, headers.length).getValues().map(function (r) {
    const o = {};
    headers.forEach(function (h, i) { o[h] = r[i]; });
    return o;
  });
}

function cycleReportInWindowGs_(value, win) {
  return value instanceof Date && value.getTime() >= win.start.getTime() && value.getTime() <= win.end.getTime();
}

// "6 of 7 (86%)" - the numerator and denominator are always shown.
function cycleRateGs_(n, d) { return d > 0 ? n + ' of ' + d + ' (' + Math.round(100 * n / d) + '%)' : 'n/a'; }

// Pure: the numbers and lists of the report. input = { ledgerRows, exclusionRows, incidentRows, window, configProblems }.
function cycleReportDataGs_(input) {
  const win = input.window;
  const ledger = (input.ledgerRows || []).filter(function (r) { return cycleReportInWindowGs_(r.planned_at, win); });
  const exclusions = (input.exclusionRows || []).filter(function (r) { return cycleReportInWindowGs_(r.recorded_at, win); });
  const incidents = (input.incidentRows || []).filter(function (r) { return cycleReportInWindowGs_(r.detected_at, win); });

  const newCounts = function () { return { planned: 0, accepted: 0, skipped: 0, failed: 0, unconfirmed: 0, blocked: 0, unfinished: 0, leadsSent: 0 }; };
  const byJob = {};
  const totals = newCounts();
  const attention = [];
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

  const attemptable = totals.planned - totals.skipped;
  const allClear = totals.planned > 0 && attention.length === 0 && serious.length === 0;
  return {
    cycle: win, totals: totals, byJob: byJob, attention: attention, exclusions: { leads: leadsLeftOut, regions: regionsSkipped, reasons: reasons },
    incidents: incidents, bySeverity: bySeverity, seriousIncidents: serious.length, heldNow: heldNow, configProblems: input.configProblems || [],
    attemptable: attemptable, allClear: allClear, empty: totals.planned === 0,
  };
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
      return [CYCLE_REPORT_JOB_LABELS_[j] || j, c.planned, c.accepted, c.skipped, c.failed, c.unconfirmed, c.blocked, c.unfinished, c.leadsSent];
    });
  if (jobRows.length) {
    jobRows.push(['All emails', t.planned, t.accepted, t.skipped, t.failed, t.unconfirmed, t.blocked, t.unfinished, t.leadsSent]);
    sections.push({
      heading: 'What went out', subheading: 'Accepted = Gmail took the message (delivery and opens cannot be seen from here). Skipped = nothing to send. Unfinished = the run ended without a result.',
      columns: ['Email', 'Planned', 'Accepted', 'Skipped', 'Failed', 'Unconfirmed', 'Blocked', 'Unfinished', 'Leads sent'], rows: jobRows,
    });
  }
  if (data.attention.length) {
    sections.push({
      heading: 'Needs attention (' + data.attention.length + ')', accent: { fg: '#dc2626', headerBg: '#fee2e2', bg: '#fef2f2' },
      columns: ['Email', 'Region', 'Bucket / recipient', 'Status', 'Why'],
      rows: data.attention.slice(0, CYCLE_REPORT_MAX_ROWS_).map(function (a) { return [CYCLE_REPORT_JOB_LABELS_[a.job] || a.job, a.region, a.bucket, a.status, a.reason]; }),
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
  sections.push({
    heading: 'Ready for 17:00?', columns: ['Check', 'Result'],
    rows: [
      ['Recipient addresses resolve', data.configProblems.length ? data.configProblems.length + ' problem(s): ' + data.configProblems.map(function (p) { return p.detail; }).join(' | ') : 'OK'],
      ['Alerts waiting to be sent', data.heldNow ? data.heldNow + ' held alert(s) - a job may have been killed; the watchdog releases them' : 'none'],
      ['Not tracked yet', 'bounces, replies, the age of the Leads tab (planned); delivery and opens cannot be seen from Apps Script'],
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

// Reads the three evidence tabs and builds the report for `now`. Pure apart from reading the spreadsheet.
function buildEmailCycleReportGs_(ss, now) {
  const win = cycleReportWindowGs_(now);
  const startKey = istDayKeyGs_(win.start);
  const data = cycleReportDataGs_({
    window: win,
    ledgerRows: cycleReadRowsGs_(ss.getSheetByName(EMAIL_LEDGER_SHEET_), EMAIL_LEDGER_HEADERS_, startKey),
    exclusionRows: cycleReadRowsGs_(ss.getSheetByName(EMAIL_LEDGER_EXCLUSIONS_SHEET_), EMAIL_LEDGER_EXCLUSION_HEADERS_, startKey),
    incidentRows: cycleReadRowsGs_(ss.getSheetByName(EMAIL_INCIDENT_LOG_SHEET_), EMAIL_INCIDENT_HEADERS_, startKey),
    configProblems: typeof emailConfigProblemsGs_ === 'function' ? emailConfigProblemsGs_() : [],
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
  Logger.log('Cycle report sent: ' + built.subject);
  return built;
}

// Trigger entry point: the job lock + run record (so the watchdog sees it), and a crash alerts ops before re-throwing - same shape as the email jobs.
function sendEmailCycleReport() {
  withEmailJobLockGs_(CYCLE_REPORT_JOB_, function () {
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
  withEmailJobLockGs_(CYCLE_REPORT_JOB_, function () { sendEmailCycleReport_({ force: true }); });
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
