/**
 * FollowupTracker.gs - the follow-up tracker (Email Operations System, part EO-7).
 * Plan: docs/_planning/EMAIL_OPS_SYSTEM_AUDIT.md (EO-7: every follow-up due, overdue, completed, blocked or still in the future, with its evidence).
 *
 * WHAT IT IS. Every 17:00 bucket email starts two follow-ups the next day: Checkpoint 1 (the 10:00 email that re-checks yesterday's flagged leads) and Checkpoint 2 (the
 * 13:00 reply in that thread). This tracker lists, for each 17:00 bucket of the cycle, where each checkpoint stands - COMPLETED, NOT_NEEDED (nothing was left to follow up),
 * BLOCKED (a failure, a gate refusal, an unconfirmed send or a run that died is on record), OVERDUE (past its due time plus a grace period and nothing is recorded),
 * DUE (its time has come) or FUTURE - and whether the 17:00 email itself bounced or got a reply. The 16:30 report (CycleReport.gs) shows the counts and the items that need
 * a look, and the rows are stored in the Followup_Tracker tab, one block per report day.
 *
 * BOUNCED = REROUTED, NOT STOPPED. Decision D9 (EmailReroute.gs): a bounced 17:00 email is re-sent to the person next in the hierarchy (the ops address when nobody is above) and
 * that bucket's later follow-ups go to them too - so a bounce no longer stops anything, and the row reads REROUTED. Only a bounce that could NOT be re-routed (the re-send failed,
 * or it was found too late) still marks the row STOP: a status for a human to act on. This file never changes what the 10:00 / 13:00 jobs send.
 *
 * It only READS evidence (the ledger rows the report already has, plus AllIssues_Log) and writes its own tab. It never blocks, re-sends or alerts; a failure to read the log or
 * store the rows leaves the report as it was.
 */

// Read-only helper FIRST in the file (the editor's Run button has run the previously selected function before - see HANDOVER).
// Logs the tracker as it would be built right now. Sends nothing, writes nothing.
function showFollowupTrackerNow() {
  const built = buildEmailCycleReportGs_(SpreadsheetApp.getActiveSpreadsheet(), new Date());
  const t = built.data.followups;
  if (!t) { Logger.log('No follow-up tracker could be built.'); return; }
  Logger.log('17:00 buckets of ' + t.cycleDay + ': ' + t.rows.length);
  t.rows.forEach(function (r) { Logger.log(r.region + ' / ' + (r.bucket || r.to) + ' | CP1 ' + r.cp1.status + ' | CP2 ' + r.cp2.status + (r.email ? ' | 17:00 email ' + r.email : '') + (r.stop ? ' | STOP' : '')); });
}

const FOLLOWUP_TRACKER_SHEET_ = 'Followup_Tracker';
const FOLLOWUP_TRACKER_HEADERS_ = ['report_day', 'cycle_day', 'region', 'bucket', 'role', 'recipient', 'leads', 'checkpoint1', 'checkpoint1_note', 'checkpoint2', 'checkpoint2_note', 'email_status', 'stop', 'evaluated_at'];
const FOLLOWUP_TRACKER_TEXT_COLUMNS_ = [1]; // report_day kept as plain text
const FOLLOWUP_TRACKER_CP1_HOUR_ = 10; // IST - the 10:00 email (Checkpoint 1)
const FOLLOWUP_TRACKER_CP2_HOUR_ = 13; // IST - the 13:00 reply (Checkpoint 2)
const FOLLOWUP_TRACKER_GRACE_MINUTES_ = 30; // a checkpoint is DUE for this long after its hour, then OVERDUE (the watchdog gives a job the same 30 minutes)
const FOLLOWUP_TRACKER_STATUSES_ = ['COMPLETED', 'NOT_NEEDED', 'BLOCKED', 'OVERDUE', 'DUE', 'FUTURE'];
const FOLLOWUP_TRACKER_MAX_ROWS_ = 30; // items listed in the report's attention table

// "region|recipient", lower-cased: how a log row and a ledger row of the same bucket are matched.
function followupKeyGs_(region, to) {
  return String(region == null ? '' : region).trim().toLowerCase() + '|' + String(to == null ? '' : to).trim().toLowerCase();
}

// The IST day after a day key (yyyy-MM-dd).
function followupNextDayGs_(dayKey) {
  return istDayKeyGs_(new Date(new Date(dayKey + 'T12:00:00+05:30').getTime() + 24 * 3600 * 1000));
}

// Where one checkpoint stands: { status, note }. s = { stamp (the log's sent-at cell), ledgerStatus, ledgerReason, dueAt (Date), now, blockedBy (text or '') }.
// The ledger outranks the log stamp: a result recorded by the sender is better evidence than a note written afterwards. Pure.
function followupCheckpointStatusGs_(s) {
  const ls = String(s.ledgerStatus || '');
  const reason = s.ledgerReason ? ': ' + s.ledgerReason : '';
  if (ls === 'SKIPPED') return { status: 'NOT_NEEDED', note: 'nothing was left to follow up' + reason };
  if (ls === 'ACCEPTED') return { status: 'COMPLETED', note: 'accepted by Gmail' + (s.stamp ? '' : ' (the log stamp is missing)') };
  if (ls === 'FAILED' || ls === 'BLOCKED') return { status: 'BLOCKED', note: 'the email ' + (ls === 'FAILED' ? 'failed' : 'was blocked by the send-safety gate') + reason };
  if (ls === 'UNCONFIRMED') return { status: 'BLOCKED', note: 'the send ended without a confirmation - it may have been delivered; check Gmail Sent (it is not re-sent automatically)' };
  if (ls === 'PLANNED' || ls === 'ATTEMPTING') return { status: 'BLOCKED', note: 'planned but never finished (the run ended without a result)' };
  if (s.stamp) return { status: 'COMPLETED', note: 'recorded in the log' };
  if (s.blockedBy) return { status: 'BLOCKED', note: s.blockedBy };
  const t = s.now.getTime(), due = s.dueAt.getTime();
  if (t < due) return { status: 'FUTURE', note: 'due ' + Utilities.formatDate(s.dueAt, 'Asia/Kolkata', 'd MMM HH:mm') + ' IST' };
  if (t < due + FOLLOWUP_TRACKER_GRACE_MINUTES_ * 60000) return { status: 'DUE', note: 'its time has come (' + Utilities.formatDate(s.dueAt, 'Asia/Kolkata', 'HH:mm') + ' IST)' };
  return { status: 'OVERDUE', note: 'nothing is recorded ' + Math.round((t - due) / 60000) + ' minutes after it was due at ' + Utilities.formatDate(s.dueAt, 'Asia/Kolkata', 'HH:mm') + ' IST' };
}

// Pure: the tracker for the 17:00 buckets of input.cycleDay. input = { cycleDay, logRows [{region, label, role, to, leadCount, cp1At, cp2At}], ledgerRows, now }.
// Returns { cycleDay, rows, counts: { cp1: {status: n}, cp2: {status: n} }, attention: [{region, bucket, to, checkpoint, status, note}] }.
function followupTrackerGs_(input) {
  const day = input.cycleDay, next = followupNextDayGs_(day), now = input.now;
  const ledgerBy = { allIssues17: {}, morning10: {}, followup13: {} };
  const rerouteBy = {}; // 'RR|<email id>' -> the ledger row of the copy re-sent after a bounce (EmailReroute.gs)
  (input.ledgerRows || []).forEach(function (r) {
    if (r.job === 'reroute') rerouteBy[r.email_id] = r;
    const m = ledgerBy[r.job];
    // the 17:00 rows are the cycle day's; the 10:00 / 13:00 rows are the next day's (a recovery re-uses the same id, so there is one row per bucket)
    if (m && emailLedgerDayKeyOfGs_(r.cycle_day) === (r.job === 'allIssues17' ? day : next)) m[followupKeyGs_(r.region, r.to)] = r;
  });
  const dueAt = function (hour) { return new Date(next + 'T' + pad2Gs_(hour) + ':00:00+05:30'); };
  const newCounts = function () { const c = {}; FOLLOWUP_TRACKER_STATUSES_.forEach(function (k) { c[k] = 0; }); return c; };
  const counts = { cp1: newCounts(), cp2: newCounts() };
  const attention = [];
  const rows = (input.logRows || []).map(function (l) {
    const key = followupKeyGs_(l.region, l.to);
    const m1 = ledgerBy.morning10[key], m2 = ledgerBy.followup13[key], m0 = ledgerBy.allIssues17[key];
    const cp1 = followupCheckpointStatusGs_({ stamp: l.cp1At, ledgerStatus: m1 && m1.status, ledgerReason: m1 && m1.status_reason, dueAt: dueAt(FOLLOWUP_TRACKER_CP1_HOUR_), now: now });
    const cp2 = followupCheckpointStatusGs_({
      stamp: l.cp2At, ledgerStatus: m2 && m2.status, ledgerReason: m2 && m2.status_reason, dueAt: dueAt(FOLLOWUP_TRACKER_CP2_HOUR_), now: now,
      blockedBy: (cp1.status === 'BLOCKED' || cp1.status === 'OVERDUE') ? 'Checkpoint 1 did not happen, so there is no 10:00 thread to reply in' : '',
    });
    let email = '';
    if (m0 && /^BOUNCED/.test(String(m0.bounce_status || ''))) { // the sweep only looks at emails Gmail accepted or may have accepted
      const rr = rerouteBy['RR|' + m0.email_id];
      email = rr && String(rr.status) === 'ACCEPTED' ? 'REROUTED' : 'BOUNCED';
    }
    else if (m0 && /^REPLIED/.test(String(m0.reply_status || ''))) email = 'REPLIED';
    const stop = email === 'BOUNCED';
    counts.cp1[cp1.status]++; counts.cp2[cp2.status]++;
    const base = { region: l.region, bucket: l.label, to: l.to };
    if (cp1.status === 'BLOCKED' || cp1.status === 'OVERDUE') attention.push(Object.assign({ checkpoint: '1 (10:00)', status: cp1.status, note: cp1.note }, base));
    if (cp2.status === 'BLOCKED' || cp2.status === 'OVERDUE') attention.push(Object.assign({ checkpoint: '2 (13:00)', status: cp2.status, note: cp2.note }, base));
    if (stop) attention.push(Object.assign({ checkpoint: '-', status: 'STOP', note: 'the 17:00 email bounced and could not be re-routed - this recipient never received it, so their follow-ups are pointless until the address is fixed' }, base));
    return { region: l.region, bucket: l.label, role: l.role, to: l.to, leads: l.leadCount, cp1: cp1, cp2: cp2, email: email, stop: stop };
  });
  return { cycleDay: day, rows: rows, counts: counts, attention: attention };
}

// The report sections for the tracker (pure): the counts table, and the items needing a look.
function followupTrackerSectionsGs_(t) {
  if (t.unreadable) {
    return [{ heading: 'Follow-ups from the 17:00 emails of ' + t.cycleDay, subheading: 'AllIssues_Log could not be read, so the follow-ups are NOT tracked in this report (missing evidence, not a failure).', columns: ['Checkpoint'], rows: [] }];
  }
  if (!t.rows.length) {
    return [{ heading: 'Follow-ups from the 17:00 emails of ' + t.cycleDay, subheading: 'No 17:00 bucket was logged for that day, so there is nothing to follow up.', columns: ['Checkpoint'], rows: [] }];
  }
  const line = function (name, c) { return [name, c.COMPLETED, c.NOT_NEEDED, c.BLOCKED, c.OVERDUE, c.DUE, c.FUTURE]; };
  const sections = [{
    heading: 'Follow-ups from the 17:00 emails of ' + t.cycleDay + ' (' + t.rows.length + ' bucket(s))',
    subheading: 'Completed = done. Not needed = nothing was left to follow up. Blocked = a failure or an unfinished run is on record. Overdue = past its time and nothing recorded. A bounced 17:00 email is re-sent to the next person in the hierarchy and its follow-ups go to them (REROUTED); only one that could not be re-routed is marked STOP.',
    columns: ['Checkpoint', 'Completed', 'Not needed', 'Blocked', 'Overdue', 'Due', 'Future'],
    rows: [line('1 - the 10:00 email', t.counts.cp1), line('2 - the 13:00 reply', t.counts.cp2)],
  }];
  if (t.attention.length) {
    sections.push({
      heading: 'Follow-ups needing attention (' + t.attention.length + ')', accent: { fg: '#dc2626', headerBg: '#fee2e2', bg: '#fef2f2' },
      subheading: t.attention.length > FOLLOWUP_TRACKER_MAX_ROWS_ ? 'First ' + FOLLOWUP_TRACKER_MAX_ROWS_ + ' of ' + t.attention.length + ' - see Followup_Tracker for the rest.' : '',
      columns: ['Region', 'Bucket / recipient', 'Checkpoint', 'Status', 'Why'],
      rows: t.attention.slice(0, FOLLOWUP_TRACKER_MAX_ROWS_).map(function (a) { return [a.region, a.bucket || a.to, a.checkpoint, a.status, a.note]; }),
    });
  }
  return sections;
}

// The 17:00 buckets of one day from AllIssues_Log, read narrowly (the large JSON columns are not touched). Fail-soft: null when the tab cannot be read.
// Same grouping the checkpoints use: the one Futwork bucket is keyed by the Futwork pseudo-region.
function followupTrackerReadLogGs_(ss, dayKey) {
  try {
    const sheet = ss.getSheetByName(ALL_ISSUES_LOG_SHEET_);
    if (!sheet || sheet.getLastRow() < 2) return [];
    const last = sheet.getLastRow();
    const days = sheet.getRange(2, 1, last - 1, 1).getValues();
    let first = -1, count = 0;
    for (let i = 0; i < days.length; i++) {
      const d = emailLedgerDayKeyOfGs_(days[i][0]);
      if (d === dayKey) { if (first === -1) first = i; count++; } else if (first !== -1 && d > dayKey) break;
    }
    if (first === -1) return [];
    const main = sheet.getRange(first + 2, 1, count, 9).getValues();   // date .. thread_id
    const cps = sheet.getRange(first + 2, 12, count, 3).getValues();   // checkpoint1_sent_at, checkpoint2_json, checkpoint2_sent_at
    return main.map(function (r, i) {
      const label = String(r[2] || '');
      return {
        region: label === FUTWORK_REGION_KEY_ ? FUTWORK_REGION_KEY_ : String(r[1] || '').trim(), label: label, role: String(r[3] || ''),
        to: String(r[4] || '').trim(), leadCount: r[6], cp1At: cps[i][0], cp2At: cps[i][2],
      };
    }).filter(function (l) { return l.to; });
  } catch (e) {
    Logger.log('Follow-up tracker: AllIssues_Log could not be read - ' + e);
    return null;
  }
}

// Stores the tracker rows in Followup_Tracker: one block per report day, replaced (not duplicated) when the report is sent again the same day. Fail-open; TEST MODE writes nothing.
function followupTrackerRecordGs_(ss, t, now) {
  if (TEST_MODE_OVERRIDE_EMAIL_ || !t || !t.rows.length) return;
  try {
    const sheet = emailLedgerEnsureSheetGs_(ss, FOLLOWUP_TRACKER_SHEET_, FOLLOWUP_TRACKER_HEADERS_, FOLLOWUP_TRACKER_TEXT_COLUMNS_);
    const day = istDayKeyGs_(now);
    const out = t.rows.map(function (r) {
      return [day, t.cycleDay, r.region, r.bucket, r.role, r.to, r.leads, r.cp1.status, String(r.cp1.note).slice(0, 300), r.cp2.status, String(r.cp2.note).slice(0, 300), r.email, r.stop ? 'yes' : '', now];
    });
    emailLedgerReplaceDayBlockGs_(sheet, out, day, 'Followup_Tracker');
  } catch (e) {
    Logger.log('Followup_Tracker rows not written - the report email is NOT affected: ' + e);
  }
}
