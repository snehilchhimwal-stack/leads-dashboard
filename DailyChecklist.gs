/**
 * DailyChecklist.gs - the daily checklist A-K, evaluated from evidence (Email Operations System, part EO-6).
 * Plan: docs/_planning/EMAIL_OPS_SYSTEM_AUDIT.md (spec section 5: the daily checklist with GREEN / AMBER / RED / GREY flags and the evidence behind each).
 *
 * WHAT IT IS. Eleven rows, one per stage of the day (A start of day ... K end-of-day reconciliation), each with a FLAG and the EVIDENCE for it, computed by the
 * 16:30 report (CycleReport.gs) from the records the system already keeps: the ledger counts, the exclusions, the Leads-tab freshness, the job run records
 * (the watchdog's view), the sweep columns and the last result of each silent audit (OpsAudit.gs). The rows are shown in the report ("Daily checklist") and stored
 * in the Daily_Checklist tab, one set of eleven rows per IST day, so a bad stage can be found afterwards.
 *
 * THE FLAGS.   GREEN = done and the evidence supports it.   AMBER = look at it, OR the evidence is missing (missing evidence is NEVER reported as a confirmed
 * failure).   RED = a failure or something incorrect is on record.   GREY = not applicable today (nothing to judge). Nothing here is ever marked complete because
 * it was planned or attempted: a bucket left PLANNED / ATTEMPTING is unfinished, so its stage is RED.
 *
 * It only READS evidence and writes its own tab. It never blocks, re-sends or alerts; a failure to store the rows is logged and the report is unaffected.
 */

// Read-only helper FIRST in the file (the editor's Run button has run the previously selected function before - see HANDOVER).
// Logs the checklist as it would be built right now. Sends nothing, writes nothing.
function showDailyChecklistNow() {
  const built = buildEmailCycleReportGs_(SpreadsheetApp.getActiveSpreadsheet(), new Date());
  (built.data.checklist || []).forEach(function (r) { Logger.log(r.stage + ' ' + r.name + ' | ' + r.flag + ' | ' + r.evidence); });
}

const DAILY_CHECKLIST_SHEET_ = 'Daily_Checklist';
const DAILY_CHECKLIST_HEADERS_ = ['report_day', 'stage', 'check', 'flag', 'evidence', 'evaluated_at'];
const DAILY_CHECKLIST_TEXT_COLUMNS_ = [1]; // report_day kept as plain text
const DAILY_CHECKLIST_STAGES_ = 11; // A..K
const DAILY_CHECKLIST_FLAG_RANK_ = { RED: 3, AMBER: 2, GREEN: 1, GREY: 0 };

// The worst of some flags (RED > AMBER > GREEN); GREY only when nothing else is there. Pure.
function dailyChecklistWorstGs_(flags) {
  let worst = 'GREY';
  flags.forEach(function (f) { if ((DAILY_CHECKLIST_FLAG_RANK_[f] || 0) > (DAILY_CHECKLIST_FLAG_RANK_[worst] || 0)) worst = f; });
  return worst;
}

// The counts of the given jobs added together, or null when the cycle holds no row for any of them. Pure.
function dailyChecklistCountsGs_(byJob, jobs) {
  let found = false;
  const sum = { planned: 0, accepted: 0, skipped: 0, failed: 0, unconfirmed: 0, blocked: 0, unfinished: 0, leadsSent: 0 };
  jobs.forEach(function (j) {
    const c = byJob && byJob[j];
    if (!c) return;
    found = true;
    Object.keys(sum).forEach(function (k) { sum[k] += c[k] || 0; });
  });
  return found ? sum : null;
}

// How a group of emails reads: RED when any failed / was blocked / was left unfinished, AMBER when any is unconfirmed, else GREEN; null when there are none.
function dailyChecklistSendFlagGs_(c) {
  if (!c || !c.planned) return null;
  if (c.failed || c.blocked || c.unfinished) return 'RED';
  if (c.unconfirmed) return 'AMBER';
  return 'GREEN';
}

function dailyChecklistSendTextGs_(c) {
  const parts = [c.accepted + ' of ' + (c.planned - c.skipped) + ' accepted by Gmail'];
  if (c.skipped) parts.push(c.skipped + ' had nothing to send');
  if (c.failed) parts.push(c.failed + ' failed');
  if (c.blocked) parts.push(c.blocked + ' blocked');
  if (c.unfinished) parts.push(c.unfinished + ' left unfinished');
  if (c.unconfirmed) parts.push(c.unconfirmed + ' unconfirmed (may have been delivered)');
  return parts.join(', ');
}

// One silent audit's last result, judged for this cycle: { flag, text }. A result recorded before the cycle began is no evidence for it.
function dailyChecklistAuditGs_(rec, win, label) {
  const ranAt = rec && rec.ranAt ? new Date(rec.ranAt) : null;
  if (!rec || !ranAt || isNaN(ranAt.getTime()) || ranAt.getTime() < win.start.getTime() || ranAt.getTime() > win.end.getTime()) {
    return { flag: 'AMBER', text: 'the ' + label + ' audit has no result in this cycle' };
  }
  if (rec.status === 'clean') return { flag: 'GREEN', text: 'the ' + label + ' audit was clean' };
  if (rec.status === 'exceptions') return { flag: 'RED', text: 'the ' + label + ' audit found ' + rec.count + ' exception(s): ' + (rec.codes || []).join(', ') };
  return { flag: 'AMBER', text: 'the ' + label + ' audit was ' + rec.status + (rec.reason ? ' (' + rec.reason + ')' : '') };
}

// Pure: the eleven rows [{ stage, name, flag, evidence }]. input = { data (cycleReportDataGs_), jobProblems (emailJobProblemsGs_ or null when unreadable), audits: { morning, followup, allIssues } }.
function dailyChecklistGs_(input) {
  const d = input.data;
  const win = d.cycle;
  const audits = input.audits || {};
  const rows = [];
  const add = function (stage, name, flag, evidence) { rows.push({ stage: stage, name: name, flag: flag, evidence: evidence }); };
  const noRows = function (what) { return 'no ' + what + ' recorded in this cycle'; };

  // A. start of day: every job that should have run by now has a run record without a problem
  if (!input.jobProblems) add('A', 'Start of day: the jobs are on schedule', 'AMBER', 'the job run records could not be read');
  else if (!input.jobProblems.length) add('A', 'Start of day: the jobs are on schedule', 'GREEN', 'every scheduled job has a clean run record for today');
  else {
    const hard = input.jobProblems.filter(function (p) { return p.kind !== 'unreadable'; });
    add('A', 'Start of day: the jobs are on schedule', hard.length ? 'RED' : 'AMBER',
      input.jobProblems.length + ' job problem(s): ' + input.jobProblems.slice(0, 4).map(function (p) { return p.job + ' ' + p.kind; }).join(', '));
  }

  // B. lead sourcing: the Leads tab is fresh (a stale lead is at least 24 h old)
  const fr = d.freshness;
  if (!fr || fr.level === 'UNKNOWN') add('B', 'Lead sourcing: the Leads tab is fresh', 'AMBER', fr ? fr.text : 'the Leads tab freshness was not checked');
  else add('B', 'Lead sourcing: the Leads tab is fresh', fr.level, fr.text);

  // C. data quality: leads dropped individually, with a reason each
  if (d.empty) add('C', 'CRM and data quality: leads dropped with a reason', 'AMBER', noRows('email'));
  else if (!d.exclusions.leads && !d.exclusions.regions) add('C', 'CRM and data quality: leads dropped with a reason', 'GREEN', 'no lead or region was left out');
  else add('C', 'CRM and data quality: leads dropped with a reason', 'AMBER',
    d.exclusions.leads + ' lead(s) and ' + d.exclusions.regions + ' region run(s) left out, each with a reason (' + (d.exclusions.reasons[0] ? d.exclusions.reasons[0].reason : '') + ')');

  // D. reason for contact: no lead was dropped for lacking one
  const noReason = d.exclusions.reasons.filter(function (r) { return /no reason for contact/i.test(r.reason); }).reduce(function (n, r) { return n + r.leads; }, 0);
  if (d.empty) add('D', 'Reason for contact: every lead line carries one', 'AMBER', noRows('email'));
  else if (noReason) add('D', 'Reason for contact: every lead line carries one', 'AMBER', noReason + ' lead(s) were dropped because they had no reason for contact');
  else add('D', 'Reason for contact: every lead line carries one', 'GREEN', 'no lead was dropped for lacking a reason');

  // E. the 10:00 emails (and the CH-level overnight report)
  const morning = dailyChecklistCountsGs_(d.byJob, ['morning10', 'chLevel10']);
  const eFlag = dailyChecklistSendFlagGs_(morning);
  if (!morning) add('E', 'The 10:00 emails: prepared and sent', 'AMBER', noRows('10:00 email'));
  else if (!eFlag) add('E', 'The 10:00 emails: prepared and sent', 'GREY', 'nothing was planned');
  else add('E', 'The 10:00 emails: prepared and sent', eFlag, dailyChecklistSendTextGs_(morning));

  // F. the 13:00 checkpoint
  const followup = dailyChecklistCountsGs_(d.byJob, ['followup13']);
  const fFlag = dailyChecklistSendFlagGs_(followup);
  if (!followup) {
    if (morning && morning.accepted) add('F', 'The 13:00 checkpoint: replies in the 10:00 threads', 'AMBER', noRows('13:00 reply') + ' although 10:00 emails went out');
    else add('F', 'The 13:00 checkpoint: replies in the 10:00 threads', 'GREY', 'no 10:00 email to reply to');
  } else add('F', 'The 13:00 checkpoint: replies in the 10:00 threads', fFlag || 'GREY', dailyChecklistSendTextGs_(followup));

  // G. the silent audits of the 10:00 emails and the 13:00 replies
  const gM = dailyChecklistAuditGs_(audits.morning, win, '10:00'), gF = dailyChecklistAuditGs_(audits.followup, win, '13:00');
  add('G', 'After 13:00: the silent audits agree', dailyChecklistWorstGs_([gM.flag, gF.flag]), gM.text + '; ' + gF.text);

  // H. 17:00 preparation: every planned bucket reached a result
  const evening = dailyChecklistCountsGs_(d.byJob, ['allIssues17', 'chLevel17']);
  if (!evening) add('H', '17:00 preparation: buckets planned', 'AMBER', noRows('17:00 email'));
  else add('H', '17:00 preparation: buckets planned', evening.unfinished ? 'RED' : evening.planned ? 'GREEN' : 'GREY',
    evening.planned + ' bucket email(s) planned' + (evening.unfinished ? ', ' + evening.unfinished + ' left unfinished' : ', none left unfinished'));

  // I. 17:00 send and verification, including the silent 17:00 audit
  const iAudit = dailyChecklistAuditGs_(audits.allIssues, win, '17:00');
  if (!evening) add('I', '17:00 send and verification', 'AMBER', noRows('17:00 email'));
  else add('I', '17:00 send and verification', dailyChecklistWorstGs_([dailyChecklistSendFlagGs_(evening) || 'GREY', iAudit.flag]), dailyChecklistSendTextGs_(evening) + '; ' + iAudit.text);

  // J. follow-up monitoring: the bounce / reply sweep
  const sw = d.sweep;
  const accepted = d.totals.accepted;
  if (!accepted) add('J', 'Follow-up monitoring: bounces and replies', 'GREY', 'no accepted email to monitor');
  else if (sw.bounced > (sw.rerouted || 0)) add('J', 'Follow-up monitoring: bounces and replies', 'RED', (sw.bounced - (sw.rerouted || 0)) + ' of ' + sw.bounced + ' bounced email(s) were NOT re-routed (accepted by Gmail, then a delivery-failure message came back)');
  else if (sw.bounced) add('J', 'Follow-up monitoring: bounces and replies', 'AMBER', sw.bounced + ' email(s) bounced and were all re-routed to the next person in the hierarchy - the address still needs fixing in Manager_Directory');
  else if (!sw.lastSweep || sw.notSwept) add('J', 'Follow-up monitoring: bounces and replies', 'AMBER', sw.lastSweep ? sw.notSwept + ' accepted email(s) not checked yet' : 'the bounce / reply sweep has not run for these emails');
  else add('J', 'Follow-up monitoring: bounces and replies', 'GREEN', 'no bounce found for ' + sw.noBounce + ' email(s) (not proof of delivery); ' + sw.replied + ' with a reply');

  // K. end of day: the whole cycle reconciles - the worst of the stages above, with the open incidents
  const worst = dailyChecklistWorstGs_(rows.map(function (r) { return r.flag; }));
  const open = d.seriousIncidents + (d.heldNow ? 1 : 0);
  const kFlag = worst === 'RED' ? 'RED' : (worst === 'AMBER' || open) ? 'AMBER' : worst === 'GREEN' ? 'GREEN' : 'GREY';
  add('K', 'End of day: the cycle reconciles', kFlag,
    rows.filter(function (r) { return r.flag === 'RED'; }).length + ' RED and ' + rows.filter(function (r) { return r.flag === 'AMBER'; }).length + ' AMBER stage(s); ' +
    d.seriousIncidents + ' serious incident(s)' + (d.heldNow ? ', ' + d.heldNow + ' alert(s) still held' : ''));
  return rows;
}

// The report section for the checklist (pure).
function dailyChecklistSectionGs_(rows) {
  const anyRed = rows.some(function (r) { return r.flag === 'RED'; });
  return {
    heading: 'Daily checklist (A-K)',
    subheading: 'GREEN = done, evidence supports it. AMBER = look, or the evidence is missing (never reported as a failure). RED = a failure is on record. GREY = not applicable.',
    accent: anyRed ? { fg: '#dc2626', headerBg: '#fee2e2', bg: '#fef2f2' } : undefined,
    columns: ['Stage', 'Check', 'Flag', 'Evidence'],
    rows: rows.map(function (r) { return [r.stage, r.name, r.flag, r.evidence]; }),
  };
}

// Stores the rows in Daily_Checklist: one set of eleven rows per IST day, replaced (not duplicated) when the report is sent again the same day.
// Fail-open: the report email never depends on it. TEST MODE writes nothing.
function dailyChecklistRecordGs_(ss, rows, now) {
  if (TEST_MODE_OVERRIDE_EMAIL_ || !rows || !rows.length) return;
  try {
    const sheet = emailLedgerEnsureSheetGs_(ss, DAILY_CHECKLIST_SHEET_, DAILY_CHECKLIST_HEADERS_, DAILY_CHECKLIST_TEXT_COLUMNS_);
    const day = istDayKeyGs_(now);
    const out = rows.map(function (r) { return [day, r.stage, r.name, r.flag, String(r.evidence).slice(0, 500), now]; });
    emailLedgerReplaceDayBlockGs_(sheet, out, day, 'Daily_Checklist'); // today's rows are the contiguous block at the bottom of the tab
  } catch (e) {
    Logger.log('Daily_Checklist rows not written - the report email is NOT affected: ' + e);
  }
}
