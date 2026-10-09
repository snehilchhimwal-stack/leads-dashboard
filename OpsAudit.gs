/**
 * OpsAudit.gs - the silent audit passes (Email Operations System, parts EO-3 and EO-4).
 * Plan: docs/_planning/EMAIL_OPS_SYSTEM_AUDIT.md (spec rules: "CONTINUE THE SAFE WORK. ALERT ME. RECOVER THE BLOCKED ITEMS. RECONCILE EVERYTHING.").
 *
 * WHAT IT IS. A short, independent check run a little after each email job - the 10:00 emails (about 11:15), the 13:00 replies (about 14:00) and the
 * 17:00 emails (about 18:00) - that compares the two sets of records the jobs leave behind: the evidence ledger (Email_Ledger, EmailLedger.gs) and the
 * older working logs (Overnight_Log, AllIssues_Log) that the NEXT job reads. It is SILENT when they agree and sends ONE alert, to the ops address, when
 * they do not. It never sends to anyone else, never blocks or re-sends anything, and writes nothing except a small run record and a "last audit"
 * property the daily report can read.
 *
 * WHY IT EXISTS. The ledger says what each job planned and what Gmail accepted; the working logs are what the NEXT job relies on (Checkpoint 1 at 10:00 is
 * built from yesterday's AllIssues_Log rows, the 13:00 reply threads into the 10:00 email recorded in Overnight_Log). If an email went out but its log row
 * was lost, nothing fails today - the next job just silently skips that bucket. That is the class of gap this finds, while there is still time to recover
 * (the audits run before the recovery cutoffs: 12:45, 16:00, 18:30).
 *
 * WHAT IT CHECKS (each rule is a pure function of plain rows - see the Tests_OpsAudit.gs scenarios):
 *   - UNFINISHED: a bucket left PLANNED or ATTEMPTING after its job ended (the run died or was killed).
 *   - ACCEPTED_WITHOUT_LOG: Gmail accepted a bucket email but its working-log row is missing (the next job would skip it).
 *   - LOG_WITHOUT_LEDGER: a working-log row with no ledger row (an email with no evidence), or NO ledger rows at all for a job that did send.
 *   - DUPLICATE_LOG: the same recipient logged twice for the same region and day (a possible double send).
 *   - CHECKPOINT1_GAP (10:00 audit): yesterday's 17:00 bucket still has no Checkpoint 1 recorded and the ledger has no failure on record for it.
 *   - FOLLOWUP_GAP (13:00 audit): a 10:00 bucket has no 13:00 reply and no ledger row for it at all.
 * A job that is still running when its audit fires is DEFERRED (reported in the daily record, never alerted: the hourly watchdog owns "stuck").
 *
 * Like CycleReport.gs and EmailSweep.gs it keeps a run record (the watchdog alerts if an audit never ran) but takes NO script-wide job lock, so an audit can
 * never make an email job skip.
 */

// Read-only helper FIRST in the file (the editor's Run button has run the previously selected function before - see HANDOVER).
// Logs what each audit would find right now. Sends nothing, records nothing.
function showEmailAuditNow() {
  const now = new Date();
  Object.keys(OPS_AUDIT_SPECS_).forEach(function (key) {
    const res = opsAuditRun_(OPS_AUDIT_SPECS_[key], { now: now, dryRun: true });
    Logger.log(OPS_AUDIT_SPECS_[key].label + ' audit: ' + res.status + (res.reason ? ' (' + res.reason + ')' : '') + ' - ' + res.findings.length + ' exception(s)');
    res.findings.forEach(function (f) { Logger.log(opsAuditFindingLinesGs_(f).join('\n')); });
  });
}

const OPS_AUDIT_MAX_LIST_ = 8; // items named per finding, so a bad day cannot make the alert unreadable
const OPS_AUDIT_RECORD_PREFIX_ = 'EMAIL_AUDIT_LAST_';
const OPS_AUDIT_SPECS_ = {
  morning: { key: 'morning', job: 'auditMorningEmails', watchJob: 'sendOvernightMorningEmails', hour: 11, minute: 15, label: '10:00 emails', rules: opsAuditMorningRulesGs_ },
  followup: { key: 'followup', job: 'auditFollowupEmails', watchJob: 'sendOvernightFollowupEmails', hour: 14, minute: 0, label: '13:00 replies', rules: opsAuditFollowupRulesGs_ },
  allIssues: { key: 'allIssues', job: 'auditAllIssuesEmails', watchJob: 'sendAllIssuesEmails', hour: 18, minute: 0, label: '17:00 emails', rules: opsAuditAllIssuesRulesGs_ },
};

// ---- small pure helpers ----

// "region|recipient", lower-cased: how a ledger row and a working-log row of the same bucket are matched.
function opsAuditKeyGs_(region, to) {
  return String(region == null ? '' : region).trim().toLowerCase() + '|' + String(to == null ? '' : to).trim().toLowerCase();
}

function opsAuditLabelGs_(r) {
  return String(r.region || '?') + ' / ' + (String(r.bucket_label || '').trim() || String(r.to || '?'));
}

// { code, severity, summary, count, items (at most OPS_AUDIT_MAX_LIST_), more, why, action }
function opsAuditFindingGs_(code, severity, summary, items, why, action) {
  const shown = items.slice(0, OPS_AUDIT_MAX_LIST_);
  return { code: code, severity: severity, summary: summary, count: items.length, items: shown, more: Math.max(0, items.length - shown.length), why: why, action: action };
}

function opsAuditFindingLinesGs_(f) {
  const lines = ['[' + f.severity + '] ' + f.code + ' - ' + f.summary];
  if (f.items.length) lines.push('  Which: ' + f.items.join('; ') + (f.more ? ' (+' + f.more + ' more)' : ''));
  if (f.why) lines.push('  Why it matters: ' + f.why);
  if (f.action) lines.push('  What to do: ' + f.action);
  return lines;
}

const OPS_AUDIT_SEVERITY_RANK_ = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
function opsAuditTopSeverityGs_(findings) {
  let top = 'LOW';
  findings.forEach(function (f) { if ((OPS_AUDIT_SEVERITY_RANK_[f.severity] || 0) > (OPS_AUDIT_SEVERITY_RANK_[top] || 0)) top = f.severity; });
  return top;
}

// ---- the rules (pure) ----

// A bucket left PLANNED (never attempted) or ATTEMPTING (the send was in progress when the run died) after its job ended.
function opsAuditUnfinishedGs_(ledgerRows, recoveryName) {
  const open = ledgerRows.filter(function (r) { return r.status === 'PLANNED' || r.status === 'ATTEMPTING'; });
  if (!open.length) return null;
  return opsAuditFindingGs_('UNFINISHED', 'HIGH', open.length + ' email(s) were planned but never finished',
    open.map(function (r) { return opsAuditLabelGs_(r) + ' (' + r.status + ')'; }),
    'The run died or was stopped after planning them. PLANNED means no send was attempted; ATTEMPTING means the send was in progress and may have gone out.',
    'Run ' + recoveryName + ' to re-send the PLANNED ones (the cutoff applies). An ATTEMPTING one is NOT re-sent automatically: check Gmail Sent first.');
}

// Gmail accepted a bucket email but the working log the next job reads has no row for it.
function opsAuditAcceptedWithoutLogGs_(ledgerRows, logRows, logName, consequence) {
  const logged = {};
  logRows.forEach(function (l) { logged[opsAuditKeyGs_(l.region, l.to)] = true; });
  const missing = ledgerRows.filter(function (r) { return r.status === 'ACCEPTED' && !logged[opsAuditKeyGs_(r.region, r.to)]; });
  if (!missing.length) return null;
  return opsAuditFindingGs_('ACCEPTED_WITHOUT_LOG', 'HIGH', missing.length + ' email(s) were accepted by Gmail but have no ' + logName + ' row',
    missing.map(function (r) { return opsAuditLabelGs_(r) + ' -> ' + r.to; }),
    consequence,
    'Add the missing ' + logName + ' row by hand (copy a sibling row and set the region, recipient and thread), or note that this bucket will be skipped by the next job.');
}

// A working-log row with no ledger row (an email with no evidence). When the job has no ledger rows at all, ONE finding says so instead of one per row.
function opsAuditLogWithoutLedgerGs_(ledgerRows, logRows, logName, jobLabel) {
  if (!logRows.length) return null;
  if (!ledgerRows.length) {
    return opsAuditFindingGs_('LOG_WITHOUT_LEDGER', 'MEDIUM', logName + ' has ' + logRows.length + ' row(s) for today but Email_Ledger has none for the ' + jobLabel,
      [], 'The ledger was not running when the job ran (expected on the day it was first pasted into the project) or its writes failed - either way these emails have no delivery evidence.',
      'If this is not the first day of the ledger, look for an "Email ledger:" alert and check that the Email_Ledger tab has its header row.');
  }
  const ledgered = {};
  ledgerRows.forEach(function (r) { ledgered[opsAuditKeyGs_(r.region, r.to)] = true; });
  const orphans = logRows.filter(function (l) { return !ledgered[opsAuditKeyGs_(l.region, l.to)]; });
  if (!orphans.length) return null;
  return opsAuditFindingGs_('LOG_WITHOUT_LEDGER', 'MEDIUM', orphans.length + ' ' + logName + ' row(s) have no Email_Ledger row',
    orphans.map(function (l) { return String(l.region || '?') + ' -> ' + l.to; }),
    'These emails were logged as sent but the evidence ledger never recorded them, so the daily report cannot count them.',
    'Check for an "Email ledger:" alert; the emails themselves are not affected.');
}

// The same recipient logged twice for the same region and day: a possible double send.
function opsAuditDuplicateLogGs_(logRows, logName) {
  const seen = {}, dupes = [];
  logRows.forEach(function (l) {
    const k = opsAuditKeyGs_(l.region, l.to);
    if (seen[k]) { if (dupes.indexOf(k) === -1) dupes.push(k); } else seen[k] = true;
  });
  if (!dupes.length) return null;
  return opsAuditFindingGs_('DUPLICATE_LOG', 'MEDIUM', dupes.length + ' recipient(s) are logged more than once in ' + logName + ' for the same region today',
    dupes.map(function (k) { return k.replace('|', ' -> '); }),
    'A bucket logged twice usually means it was sent twice (a double-fired trigger or a manual re-run).',
    'Check the recipient\'s inbox or Gmail Sent. Nothing is changed by this audit.');
}

// Yesterday's 17:00 buckets that still have no Checkpoint 1 recorded when the 10:00 job is over, and with no failure on record for them in the ledger.
// A bucket whose 10:00 email FAILED / was BLOCKED / is UNCONFIRMED is a known problem that was already alerted - it is not repeated here.
function opsAuditCheckpoint1GapsGs_(prevAllIssuesRows, morningLedgerRows) {
  const known = {};
  morningLedgerRows.forEach(function (r) { if (r.status === 'FAILED' || r.status === 'BLOCKED' || r.status === 'UNCONFIRMED') known[opsAuditKeyGs_(r.region, r.to)] = true; });
  const gaps = prevAllIssuesRows.filter(function (a) {
    return !a.cp1At && String(a.to || '').trim() && Number(a.leadCount) > 0 && !known[opsAuditKeyGs_(a.region, a.to)];
  });
  if (!gaps.length) return null;
  return opsAuditFindingGs_('CHECKPOINT1_GAP', 'HIGH', gaps.length + ' of yesterday\'s 17:00 bucket(s) have no Checkpoint 1 recorded and no failure on record',
    gaps.map(function (a) { return String(a.region || '?') + ' / ' + (a.label || a.to) + ' -> ' + a.to; }),
    'The 10:00 job should have either sent each bucket\'s Checkpoint 1 or recorded that nothing was left to say. Without it the 13:00 Checkpoint 2 for that bucket will not be built either.',
    'Check the 10:00 job\'s Executions log; if the bucket was missed, run sendOvernightMorningEmailsNow is NOT safe (region guard) - tell the ops owner so the bucket can be handled by hand.');
}

// A 10:00 bucket (an Overnight_Log row today) with no 13:00 reply sent and no ledger row for the 13:00 reply at all: the 13:00 job never reached it.
// A reply that was SKIPPED (nothing unresolved), FAILED, BLOCKED or UNCONFIRMED has a ledger row and is accounted for elsewhere.
function opsAuditFollowupGapsGs_(overnightRows, followupLedgerRows) {
  const ledgered = {};
  followupLedgerRows.forEach(function (r) { ledgered[opsAuditKeyGs_(r.region, r.to)] = true; });
  const gaps = overnightRows.filter(function (o) { return String(o.to || '').trim() && !o.followupAt && !ledgered[opsAuditKeyGs_(o.region, o.to)]; });
  if (!gaps.length) return null;
  return opsAuditFindingGs_('FOLLOWUP_GAP', 'HIGH', gaps.length + ' of this morning\'s 10:00 bucket(s) have no 13:00 reply and no ledger row for one',
    gaps.map(function (o) { return String(o.region || '?') + ' -> ' + o.to; }),
    'The 13:00 job should have either replied in the 10:00 thread or recorded why not. A bucket it never reached gets no follow-up today.',
    'Check the 13:00 job\'s Executions log; sendOvernightFollowupEmailsNow retries a bucket whose followup_sent_at is still blank.');
}

function opsAuditMorningRulesGs_(input) {
  const ledger = input.ledger.filter(function (r) { return r.job === 'morning10' || r.job === 'chLevel10'; });
  const bucketRows = ledger.filter(function (r) { return r.job === 'morning10'; });
  const out = [];
  const add = function (f) { if (f) out.push(f); };
  add(opsAuditUnfinishedGs_(ledger, 'recoverFailedMorningBucketsNow()'));
  add(opsAuditAcceptedWithoutLogGs_(bucketRows, input.overnightLog, 'Overnight_Log', 'The 13:00 job builds its reply from Overnight_Log, so it will not reply to this bucket.'));
  add(opsAuditLogWithoutLedgerGs_(bucketRows, input.overnightLog, 'Overnight_Log', '10:00 job'));
  add(opsAuditDuplicateLogGs_(input.overnightLog, 'Overnight_Log'));
  if (bucketRows.length) add(opsAuditCheckpoint1GapsGs_(input.prevAllIssuesLog, bucketRows)); // only meaningful when the ledger was running for this job
  return out;
}

function opsAuditFollowupRulesGs_(input) {
  const ledger = input.ledger.filter(function (r) { return r.job === 'followup13'; });
  const out = [];
  const add = function (f) { if (f) out.push(f); };
  add(opsAuditUnfinishedGs_(ledger, 'recoverFailedFollowupBucketsNow()'));
  // With the ledger running for this job, a 10:00 bucket it never reached is a gap; with NO 13:00 ledger rows at all the ledger was not running, which is one finding, not one per bucket.
  if (ledger.length) add(opsAuditFollowupGapsGs_(input.overnightLog, ledger));
  else add(opsAuditLogWithoutLedgerGs_([], input.overnightLog.filter(function (o) { return String(o.to || '').trim(); }), 'Overnight_Log', '13:00 job'));
  return out;
}

function opsAuditAllIssuesRulesGs_(input) {
  const ledger = input.ledger.filter(function (r) { return r.job === 'allIssues17' || r.job === 'chLevel17'; });
  const bucketRows = ledger.filter(function (r) { return r.job === 'allIssues17'; });
  const out = [];
  const add = function (f) { if (f) out.push(f); };
  add(opsAuditUnfinishedGs_(ledger, 'recoverFailedAllIssuesBucketsNow()'));
  add(opsAuditAcceptedWithoutLogGs_(bucketRows, input.allIssuesLog, 'AllIssues_Log', 'Tomorrow\'s 10:00 Checkpoint 1 is built from AllIssues_Log, so it will skip this bucket.'));
  add(opsAuditLogWithoutLedgerGs_(bucketRows, input.allIssuesLog, 'AllIssues_Log', '17:00 job'));
  add(opsAuditDuplicateLogGs_(input.allIssuesLog, 'AllIssues_Log'));
  return out;
}

// ---- reading (all fail-soft: an unreadable tab is a finding-free skip with a reason, never an exception) ----

// Rows of a working log from startDay on, as plain objects. Columns are read narrowly (the JSON snapshot columns are large).
// Only the date column is read for the whole sheet; the wanted columns only for the rows from startDay on.
function opsAuditReadAllIssuesLogGs_(ss, startDay) {
  const sheet = ss.getSheetByName(ALL_ISSUES_LOG_SHEET_);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const last = sheet.getLastRow();
  const days = sheet.getRange(2, 1, last - 1, 1).getValues();
  let first = -1;
  for (let i = 0; i < days.length; i++) { if (emailLedgerDayKeyOfGs_(days[i][0]) >= startDay) { first = i; break; } }
  if (first === -1) return [];
  const n = last - first - 1;
  const main = sheet.getRange(first + 2, 1, n, 9).getValues();     // date .. thread_id
  const cp1 = sheet.getRange(first + 2, 12, n, 1).getValues();     // checkpoint1_sent_at
  return main.map(function (r, i) {
    const label = String(r[2] || '');
    return {
      rowNo: first + 2 + i, day: emailLedgerDayKeyOfGs_(r[0]),
      region: label === FUTWORK_REGION_KEY_ ? FUTWORK_REGION_KEY_ : String(r[1] || '').trim(), // the same grouping Checkpoint 1 / 2 use for the one Futwork bucket
      label: label, to: String(r[4] || '').trim(), leadCount: r[6], cp1At: cp1[i][0],
    };
  });
}

function opsAuditReadOvernightLogGs_(ss, startDay) {
  const sheet = ss.getSheetByName(OVERNIGHT_LOG_SHEET_);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const last = sheet.getLastRow();
  const days = sheet.getRange(2, 1, last - 1, 1).getValues();
  let first = -1;
  for (let i = 0; i < days.length; i++) { if (emailLedgerDayKeyOfGs_(days[i][0]) >= startDay) { first = i; break; } }
  if (first === -1) return [];
  const rows = sheet.getRange(first + 2, 1, last - first - 1, 9).getValues(); // date .. followup_sent_at
  return rows.map(function (r, i) {
    return { rowNo: first + 2 + i, day: emailLedgerDayKeyOfGs_(r[0]), region: String(r[1] || '').trim(), to: String(r[5] || '').trim(), followupAt: r[8] };
  });
}

// The state of the job this audit watches: 'deferred' (still running, not yet stuck), 'no_run' (no run record today - the watchdog owns that), else 'ok'.
function opsAuditJobStateGs_(record, day, now) {
  if (!record || record.unreadable || record.day !== day) return 'no_run';
  if (record.status === 'running') {
    const ageMin = (now.getTime() - new Date(record.startedAt).getTime()) / 60000;
    if (ageMin <= EMAIL_JOB_MAX_RUN_MINUTES_) return 'deferred';
  }
  return 'ok';
}

// Runs one audit. opts: { now, dryRun }. Returns { job, day, status: clean|exceptions|deferred|skipped|failed, reason, findings }.
// An alert is sent (and the "last audit" property written) only when it is not a dry run.
function opsAuditRun_(spec, opts) {
  const o = opts || {};
  const now = o.now || new Date();
  const day = istDayKeyGs_(now);
  const result = { job: spec.job, day: day, status: 'clean', reason: '', findings: [] };
  const state = opsAuditJobStateGs_(readEmailJobRunGs_(spec.watchJob), day, now);
  if (state !== 'ok') {
    result.status = state === 'deferred' ? 'deferred' : 'skipped';
    result.reason = state === 'deferred' ? 'the ' + spec.label + ' job was still running' : 'the ' + spec.label + ' job has no run record for today (the hourly watchdog reports that)';
  } else {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const prevDay = istDayKeyGs_(new Date(now.getTime() - 24 * 3600 * 1000));
    const input = { day: day, prevDay: prevDay, ledger: [], allIssuesLog: [], prevAllIssuesLog: [], overnightLog: [] };
    try {
      input.ledger = emailLedgerReadRowsGs_(ss.getSheetByName(EMAIL_LEDGER_SHEET_), EMAIL_LEDGER_HEADERS_, day)
        .filter(function (r) { return emailLedgerDayKeyOfGs_(r.cycle_day) === day; });
      if (spec.key === 'allIssues') input.allIssuesLog = opsAuditReadAllIssuesLogGs_(ss, day).filter(function (l) { return l.day === day; });
      if (spec.key === 'morning') input.prevAllIssuesLog = opsAuditReadAllIssuesLogGs_(ss, prevDay).filter(function (l) { return l.day === prevDay; });
      if (spec.key === 'morning' || spec.key === 'followup') input.overnightLog = opsAuditReadOvernightLogGs_(ss, day).filter(function (l) { return l.day === day; });
      result.findings = spec.rules(input);
      result.status = result.findings.length ? 'exceptions' : 'clean';
    } catch (e) {
      result.status = 'failed';
      result.reason = 'the audit could not read its inputs: ' + String((e && e.message) || e);
    }
  }
  if (o.dryRun || TEST_MODE_OVERRIDE_EMAIL_) return result;
  if (result.findings.length) {
    const lines = ['The silent audit of the ' + spec.label + ' found ' + result.findings.length + ' exception(s). Nothing was blocked or re-sent: this is a check of the evidence trail.', ''];
    result.findings.forEach(function (f) { Array.prototype.push.apply(lines, opsAuditFindingLinesGs_(f)); lines.push(''); });
    lines.push('Evidence: Email_Ledger and the working logs (Overnight_Log, AllIssues_Log). Preview any time with showEmailAuditNow().');
    notifyOpsAlertGs_('Email audit (' + spec.label + '): ' + result.findings.length + ' exception(s)', lines, { severity: opsAuditTopSeverityGs_(result.findings), scope: 'item' });
  } else if (result.status === 'failed') {
    notifyOpsAlertGs_('Email audit (' + spec.label + ') could not run', [result.reason, 'The emails themselves are not affected; the audit is a check, not a gate.'], { severity: 'MEDIUM' });
  }
  opsAuditRecordGs_(spec, result);
  return result;
}

// The last audit's outcome, for the daily report: { day, ranAt, status, count, codes }. Fail-soft.
function opsAuditRecordGs_(spec, result) {
  try {
    PropertiesService.getScriptProperties().setProperty(OPS_AUDIT_RECORD_PREFIX_ + spec.job, JSON.stringify({
      day: result.day, ranAt: new Date().toISOString(), status: result.status, count: result.findings.length,
      codes: result.findings.map(function (f) { return f.code; }), reason: result.reason,
    }));
  } catch (e) { Logger.log(spec.job + ': could not record the last audit (' + e + ') - the audit itself is not affected.'); }
}

function opsAuditReadRecordGs_(spec) {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(OPS_AUDIT_RECORD_PREFIX_ + spec.job);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

// ---- entry points (triggers) ----

function opsAuditEntryGs_(spec) {
  runEmailJobTrackedGs_(spec.job, function () {
    try {
      opsAuditRun_(spec, {});
    } catch (e) {
      notifyOpsAlertGs_(spec.job + ' crashed - the ' + spec.label + ' were NOT audited', ['Error: ' + (e && e.stack ? e.stack : e)], { immediate: true });
      throw e;
    }
  });
}

function auditMorningEmails() { opsAuditEntryGs_(OPS_AUDIT_SPECS_.morning); }
function auditFollowupEmails() { opsAuditEntryGs_(OPS_AUDIT_SPECS_.followup); }
function auditAllIssuesEmails() { opsAuditEntryGs_(OPS_AUDIT_SPECS_.allIssues); }
function auditMorningEmailsNow() { auditMorningEmails(); }
function auditFollowupEmailsNow() { auditFollowupEmails(); }
function auditAllIssuesEmailsNow() { auditAllIssuesEmails(); }

// One-time setup - three daily triggers (about 11:15, 14:00 and 18:00 IST). Safe to re-run: deletes its own earlier triggers first.
function setupOpsAuditTriggers() {
  const handlers = Object.keys(OPS_AUDIT_SPECS_).map(function (k) { return OPS_AUDIT_SPECS_[k].job; });
  ScriptApp.getProjectTriggers().forEach(function (t) { if (handlers.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t); });
  Object.keys(OPS_AUDIT_SPECS_).forEach(function (k) {
    const spec = OPS_AUDIT_SPECS_[k];
    ScriptApp.newTrigger(spec.job).timeBased().atHour(spec.hour).nearMinute(spec.minute).everyDays(1).inTimezone('Asia/Kolkata').create();
    Logger.log('Audit trigger installed: ' + spec.job + ' runs daily near ' + spec.hour + ':' + pad2Gs_(spec.minute) + ' IST (audits the ' + spec.label + ').');
  });
}
