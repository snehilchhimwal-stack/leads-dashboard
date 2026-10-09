/**
 * EmailLedger.gs - the per-email evidence trail (Email Operations System, part EO-1a).
 * Plan and decisions: docs/_planning/EMAIL_OPS_SYSTEM_AUDIT.md (section 0 = decisions D1-D5).
 *
 * WHY THIS EXISTS. Every other log in this project (AllIssues_Log, Overnight_Log) is written only AFTER a send succeeded, so the
 * system knows what went out and can never know what SHOULD have gone out and did not, what was blocked, or why. The ledger
 * records each bucket email from the moment it is planned to its final status, with the Gmail message and thread ids as
 * evidence, and records every lead or bucket that was left out together with the reason. Everything later in the plan (the
 * 13:00 audit, the 17:00 reconciliation, bounce/reply sweeps, the 16:30 cycle report) reads these two sheets.
 *
 * TWO SHEETS.
 *   Email_Ledger             one row per bucket email: planned -> attempting -> accepted | failed | unconfirmed | blocked.
 *   Email_Ledger_Exclusions  one row per lead (or whole region) that did NOT go out, with the reason. Small: only exceptions.
 *
 * STATUS MEANINGS (they never imply one another):
 *   PLANNED      the bucket was resolved and will be sent; no attempt yet (a row stuck here = the run died before the attempt).
 *   ATTEMPTING   the send was started; a row stuck here = the outcome is UNKNOWN (the run died mid-send).
 *   ACCEPTED     GmailApp send() returned a message. This is NOT "delivered" and NOT "opened"; Apps Script cannot see either.
 *   FAILED       the send raised a definite error; nothing was delivered.
 *   UNCONFIRMED  the send raised an error after which the message MAY still have gone out (timeouts etc.) - needs a look.
 *   BLOCKED      the send-safety gate refused the payload; nothing was drafted or sent.
 *   SKIPPED      planned, then deliberately not sent because there was nothing to say (e.g. every follow-up lead is already resolved).
 *   EXCLUDED     (exclusions sheet only) a lead or region left out on purpose, with the reason.
 *
 * THE LEDGER IS EVIDENCE, NOT A GATE. Every function here is fail-open: a ledger error is caught, counted, logged and reported
 * once at the end of the job, and the email proceeds regardless. A null handle (test mode, or the ledger could not be opened)
 * makes every function a no-op. TEST MODE never writes ledger rows (same rule as every other production log).
 */

// Read-only helper FIRST in the file (the editor's Run button has run the previously selected function before - see HANDOVER).
// Logs how many bucket emails today's ledger holds per status. Writes nothing.
function showEmailLedgerTodayNow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(EMAIL_LEDGER_SHEET_);
  if (!sheet || sheet.getLastRow() < 2) { Logger.log('Email_Ledger: no rows yet.'); return; }
  const today = istDayKeyGs_(new Date());
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, EMAIL_LEDGER_HEADERS_.length).getValues();
  const dayCol = EMAIL_LEDGER_HEADERS_.indexOf('cycle_day'), statusCol = EMAIL_LEDGER_HEADERS_.indexOf('status');
  const counts = {};
  let total = 0;
  rows.forEach(function (r) {
    if (emailLedgerDayKeyOfGs_(r[dayCol]) !== today) return;
    total++;
    counts[r[statusCol]] = (counts[r[statusCol]] || 0) + 1;
  });
  Logger.log('Email_Ledger for ' + today + ': ' + total + ' bucket email(s) - ' + Object.keys(counts).sort().map(function (k) { return k + ' ' + counts[k]; }).join(', '));
  const ex = ss.getSheetByName(EMAIL_LEDGER_EXCLUSIONS_SHEET_);
  if (ex && ex.getLastRow() >= 2) {
    const exRows = ex.getRange(2, 1, ex.getLastRow() - 1, EMAIL_LEDGER_EXCLUSION_HEADERS_.length).getValues();
    const todays = exRows.filter(function (r) { return emailLedgerDayKeyOfGs_(r[1]) === today; });
    Logger.log('Email_Ledger_Exclusions for ' + today + ': ' + todays.length + ' lead/region exclusion(s).');
  }
}

const EMAIL_LEDGER_SHEET_ = 'Email_Ledger';
const EMAIL_LEDGER_EXCLUSIONS_SHEET_ = 'Email_Ledger_Exclusions';
const EMAIL_LEDGER_RETENTION_DAYS_ = 90; // older rows are archived to Drive (archiveRowsToDriveCsv_) and then removed
const EMAIL_LEDGER_JOB_ALL_ISSUES_ = 'allIssues17';
const EMAIL_LEDGER_JOB_MORNING_ = 'morning10'; // the combined 10:00 email (overnight + checkpoint 1)
const EMAIL_LEDGER_JOB_FOLLOWUP_ = 'followup13'; // the combined 13:00 threaded reply (overnight follow-up + checkpoint 2)
const EMAIL_LEDGER_JOB_CH_OVERNIGHT_ = 'chLevel10'; // the CH-level overnight report (sent to ops, not to the CH)
const EMAIL_LEDGER_JOB_CH_ISSUES_ = 'chLevel17'; // the CH-level all-issues report

// Column order matters: the outcome columns (attempted_at .. lead_ids_json) must stay contiguous - one setValues rewrites them.
const EMAIL_LEDGER_HEADERS_ = ['email_id', 'cycle_day', 'job', 'region', 'bucket_label', 'primary_role', 'to', 'cc', 'subject',
  'leads_planned', 'planned_at', 'attempted_at', 'finished_at', 'status', 'status_reason', 'attempts', 'message_id', 'thread_id',
  'leads_sent', 'lead_ids_json', 'bounce_status', 'reply_status', 'swept_at']; // the last three are filled by the bounce/reply sweep (EO-5)
const EMAIL_LEDGER_EXCLUSION_HEADERS_ = ['recorded_at', 'cycle_day', 'job', 'region', 'kind', 'lead_id', 'rm', 'email_id', 'reason'];
const EMAIL_LEDGER_STATUS_ = {
  PLANNED: 'PLANNED', ATTEMPTING: 'ATTEMPTING', ACCEPTED: 'ACCEPTED', FAILED: 'FAILED', UNCONFIRMED: 'UNCONFIRMED', BLOCKED: 'BLOCKED',
  SKIPPED: 'SKIPPED', // planned, then deliberately not sent: there was nothing to say (a genuine final outcome, not a failure)
};

function emailLedgerCol_(name) { return EMAIL_LEDGER_HEADERS_.indexOf(name) + 1; } // 1-based sheet column

// The day a ledger/exclusion cell belongs to: a real Date (Sheets turned the text into one) or the 'yyyy-MM-dd' text we wrote.
function emailLedgerDayKeyOfGs_(cell) {
  if (cell instanceof Date) return istDayKeyGs_(cell);
  return String(cell == null ? '' : cell).trim().slice(0, 10);
}

// Deterministic id for one bucket email: the same bucket on the same day and job always gets the same id, so a re-run finds
// its own row instead of adding a second one. `to` (optional) is added for the jobs whose bucket is identified by its recipient
// (the 10:00 and 13:00 emails are keyed by recipient address, not by bucket label).
function emailLedgerIdGs_(job, dayKey, region, primaryRole, bucketLabel, to) {
  const parts = [String(dayKey || '').replace(/-/g, ''), job, region, primaryRole, bucketLabel];
  if (to) parts.push(String(to).toLowerCase());
  return parts.map(function (part) {
    return String(part == null ? '' : part).replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
  }).join('|');
}

// Plan decision D3 (per-lead isolation): a lead that cannot be shown reliably in an email is left out and recorded, and the rest
// of its bucket still goes. Deliberately conservative - only defects that are certain; anything subtler is caught by the send gate
// and handled by the quarantine-and-resend in sendOneAllIssuesEmail_. Returns '' for a usable lead, or the reason it is not.
function emailLedgerLeadDefectGs_(lead) {
  const id = lead ? lead.lead_id : undefined;
  if (id === undefined || id === null || String(id).trim() === '') return 'the lead has no id';
  const text = String(id);
  if (/[\u0000-\u001f\u007f]/.test(text) || text.length > 100) return 'the lead id "' + text.replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, 40) + '" has control characters or is too long to show reliably';
  if (!String(lead.issueLabel == null ? '' : lead.issueLabel).trim()) return 'no reason for contact (the issue label is blank)';
  return '';
}

// Splits a list of flagged leads into { valid: [lead], defective: [{ lead, reason, covered }] }; a second lead with an id already seen is
// defective because it would be counted and listed twice in one email - but `covered` is true for it: the lead's first copy IS in the
// email, so it must not be reported as unsent.
const DUPLICATE_LEAD_REASON_ = 'duplicate lead id - the first copy was sent';
function emailLedgerSplitLeadsGs_(leads) {
  const valid = [], defective = [], seen = {};
  (leads || []).forEach(function (lead) {
    let reason = emailLedgerLeadDefectGs_(lead);
    if (!reason) {
      const key = String(lead.lead_id).trim();
      if (seen[key]) reason = DUPLICATE_LEAD_REASON_; else seen[key] = true;
    }
    if (reason) defective.push({ lead: lead, reason: reason, covered: reason === DUPLICATE_LEAD_REASON_ }); else valid.push(lead);
  });
  return { valid: valid, defective: defective };
}

// Message and thread ids of a sent message, '' for anything the platform did not give us (never throws).
function emailLedgerSentIdsGs_(sentMessage) {
  let messageId = '', threadId = '';
  try { if (sentMessage && typeof sentMessage.getId === 'function') messageId = String(sentMessage.getId() || ''); } catch (e) { messageId = ''; }
  try { if (sentMessage && typeof sentMessage.getThread === 'function') threadId = String(sentMessage.getThread().getId() || ''); } catch (e2) { threadId = ''; }
  return { messageId: messageId, threadId: threadId };
}

// The ledger status a failed send gets: the gate's refusal, a possibly-delivered error, or a definite failure.
function emailLedgerStatusForErrorGs_(err) {
  if (err && err.blockedByGuard) return EMAIL_LEDGER_STATUS_.BLOCKED;
  return isAmbiguousSendErrorGs_(err) ? EMAIL_LEDGER_STATUS_.UNCONFIRMED : EMAIL_LEDGER_STATUS_.FAILED;
}

function emailLedgerLiveGs_(h) { return !!(h && !h.disabled); }

// Runs fn; any error is counted on the handle and logged - the caller (a send path) never sees it.
function emailLedgerGuardGs_(h, label, fn) {
  try {
    return fn();
  } catch (e) {
    h.failures = (h.failures || 0) + 1;
    h.lastError = label + ': ' + String((e && e.message) || e);
    Logger.log('Email ledger write failed (' + label + ') - the email itself is NOT affected: ' + e);
    return undefined;
  }
}

function emailLedgerEnsureSheetGs_(ss, name, headers, textColumns) {
  let sheet = ss.getSheetByName(name);
  const writeHeader = function () {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    // Text format, so Sheets never turns a day key or an id into a Date/number (the Date-vs-string dedup bug in HANDOVER section 8).
    textColumns.forEach(function (c) { sheet.getRange(2, c, Math.max(1, sheet.getMaxRows() - 1), 1).setNumberFormat('@'); });
  };
  if (!sheet) { sheet = ss.insertSheet(name); writeHeader(); return sheet; }
  if (sheet.getLastRow() === 0) { writeHeader(); return sheet; }
  const have = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  headers.forEach(function (h, i) {
    if (String(have[i] == null ? '' : have[i]).trim() !== h) {
      throw new Error(name + ' column ' + (i + 1) + ' should be "' + h + '" but is "' + have[i] + '" - the ledger will not write into a sheet whose columns it does not recognise');
    }
  });
  return sheet;
}

// Opens (creating on first use) both sheets and indexes the existing email ids. Returns a handle, or null in TEST MODE; when the
// sheets cannot be opened the handle is returned DISABLED (every later call is a no-op and the failure is reported at the end).
function emailLedgerOpenGs_(ss) {
  if (TEST_MODE_OVERRIDE_EMAIL_) return null;
  const h = { ledger: null, exclusions: null, rowById: {}, rows: {}, failures: 0, lastError: '', disabled: false };
  emailLedgerSetActiveGs_(h); // a held alert (EO-2) states how many of THIS run's emails went out
  try {
    h.ledger = emailLedgerEnsureSheetGs_(ss, EMAIL_LEDGER_SHEET_, EMAIL_LEDGER_HEADERS_, [1, 2]);
    h.exclusions = emailLedgerEnsureSheetGs_(ss, EMAIL_LEDGER_EXCLUSIONS_SHEET_, EMAIL_LEDGER_EXCLUSION_HEADERS_, [2, 6]);
    const last = h.ledger.getLastRow();
    if (last >= 2) {
      h.ledger.getRange(2, 1, last - 1, 1).getValues().forEach(function (r, i) {
        const id = String(r[0] == null ? '' : r[0]).trim();
        if (id) h.rowById[id] = i + 2;
      });
    }
  } catch (e) {
    h.disabled = true;
    h.failures = 1;
    h.lastError = 'open: ' + String((e && e.message) || e);
    Logger.log('Email ledger could not be opened - the emails are NOT affected: ' + e);
  }
  return h;
}

// Writes `rows` below the last row of `sheet` in one call. A retry after a timeout that landed re-checks the first cell, so one
// batch is never written twice (same lesson as appendRowOnceGs_). `sameFirst(probeValue)` says whether that cell is our batch.
function emailLedgerAppendBlockGs_(sheet, rows, sameFirst, label) {
  const startRow = sheet.getLastRow() + 1;
  const needed = startRow + rows.length - 1;
  if (needed > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), needed - sheet.getMaxRows() + 100); // setValues cannot write past the grid
  let attempted = false;
  writeUnlessTestModeGs_(function () {
    if (attempted && sameFirst(sheet.getRange(startRow, 1, 1, 1).getValue())) return false; // an earlier attempt already landed
    attempted = true; // set BEFORE the write: an attempt that throws may still have written
    sheet.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows);
    return true;
  }, label);
  return startRow;
}

function emailLedgerLoadRowGs_(h, emailId) {
  const rowNo = h.rowById[emailId];
  h.rows[rowNo] = h.ledger.getRange(rowNo, 1, 1, EMAIL_LEDGER_HEADERS_.length).getValues()[0];
}

// Records the buckets a region is about to send, in ONE write: plans = [{ emailId, job, dayKey, region, bucketLabel, primaryRole,
// to, cc, subject, leadIds, initialStatus?, initialReason? }]. A bucket whose id already has a row (a re-run) keeps that row and its attempt count.
function emailLedgerPlanGs_(h, plans) {
  if (!emailLedgerLiveGs_(h) || !plans || !plans.length) return;
  emailLedgerGuardGs_(h, 'plan', function () {
    const fresh = [];
    plans.forEach(function (p) {
      if (h.rowById[p.emailId]) { emailLedgerLoadRowGs_(h, p.emailId); return; }
      fresh.push(p);
    });
    if (!fresh.length) return;
    const plannedAt = new Date();
    const rows = fresh.map(function (p) {
      // initialStatus/initialReason: an email already known not to be sent (nothing to say, no recipient) is planned directly
      // in its final state - one write instead of two.
      const done = p.initialStatus ? plannedAt : '';
      return [p.emailId, p.dayKey, p.job, p.region, p.bucketLabel, p.primaryRole, p.to, p.cc || '', p.subject || '',
        p.leadIds.length, plannedAt, '', done, p.initialStatus || EMAIL_LEDGER_STATUS_.PLANNED, String(p.initialReason || '').slice(0, 500), 0, '', '', 0,
        jsonForCellGs_(p.leadIds, 'Email_Ledger lead_ids_json (' + p.emailId + ')'), '', '', ''];
    });
    const startRow = emailLedgerAppendBlockGs_(h.ledger, rows, function (probe) { return String(probe).trim() === rows[0][0]; }, 'append Email_Ledger rows');
    rows.forEach(function (r, i) { h.rowById[r[0]] = startRow + i; h.rows[startRow + i] = r; });
  });
}

// Applies `mutate(row)` to one cached ledger row and rewrites its outcome columns.
function emailLedgerPatchGs_(h, emailId, label, mutate) {
  if (!emailLedgerLiveGs_(h) || !emailId) return;
  emailLedgerGuardGs_(h, label, function () {
    const rowNo = h.rowById[emailId];
    if (!rowNo) return; // never planned (the plan write failed) - nothing to update
    if (!h.rows[rowNo]) emailLedgerLoadRowGs_(h, emailId);
    const row = h.rows[rowNo];
    mutate(row);
    const first = emailLedgerCol_('attempted_at'), last = emailLedgerCol_('lead_ids_json');
    writeUnlessTestModeGs_(function () { h.ledger.getRange(rowNo, first, 1, last - first + 1).setValues([row.slice(first - 1, last)]); }, 'update Email_Ledger row (' + label + ')');
  });
}

// The send is about to start. A row left in ATTEMPTING afterwards is the evidence that the run died mid-send.
function emailLedgerAttemptGs_(h, emailId) {
  emailLedgerPatchGs_(h, emailId, 'attempt', function (row) {
    row[emailLedgerCol_('attempted_at') - 1] = new Date();
    row[emailLedgerCol_('finished_at') - 1] = '';
    row[emailLedgerCol_('status') - 1] = EMAIL_LEDGER_STATUS_.ATTEMPTING;
    row[emailLedgerCol_('status_reason') - 1] = '';
    row[emailLedgerCol_('attempts') - 1] = Number(row[emailLedgerCol_('attempts') - 1] || 0) + 1;
  });
}

// The send ended. result = { status, reason, messageId, threadId, leadIds } (leadIds = the leads the email really carried).
function emailLedgerResultGs_(h, emailId, result) {
  emailLedgerPatchGs_(h, emailId, 'result', function (row) {
    const ids = result.leadIds || [];
    row[emailLedgerCol_('finished_at') - 1] = new Date();
    row[emailLedgerCol_('status') - 1] = result.status;
    row[emailLedgerCol_('status_reason') - 1] = String(result.reason || '').slice(0, 500);
    row[emailLedgerCol_('message_id') - 1] = result.messageId || '';
    row[emailLedgerCol_('thread_id') - 1] = result.threadId || '';
    row[emailLedgerCol_('leads_sent') - 1] = result.status === EMAIL_LEDGER_STATUS_.ACCEPTED ? ids.length : 0;
    row[emailLedgerCol_('lead_ids_json') - 1] = jsonForCellGs_(ids, 'Email_Ledger lead_ids_json (' + emailId + ')');
  });
}

// Records leads/regions that did NOT go out, in one write: items = [{ job, dayKey, region, kind: 'lead'|'region', leadId, rm, emailId, reason }].
function emailLedgerExcludeGs_(h, items) {
  if (!emailLedgerLiveGs_(h) || !items || !items.length) return;
  emailLedgerGuardGs_(h, 'exclusions', function () {
    const at = new Date();
    const rows = items.map(function (it) {
      return [at, it.dayKey, it.job, it.region, it.kind, it.leadId === undefined || it.leadId === null ? '' : String(it.leadId), it.rm || '', it.emailId || '', String(it.reason || '').slice(0, 500)];
    });
    emailLedgerAppendBlockGs_(h.exclusions, rows, function (probe) { return probe instanceof Date && probe.getTime() === at.getTime(); }, 'append Email_Ledger_Exclusions rows');
  });
}

// The current ledger status of a planned email as held in memory ('' when unknown).
function emailLedgerStatusOfGs_(h, emailId) {
  if (!emailLedgerLiveGs_(h) || !emailId) return '';
  const rowNo = h.rowById[emailId];
  const row = rowNo ? h.rows[rowNo] : null;
  return row ? String(row[emailLedgerCol_('status') - 1] || '') : '';
}

// Marks an email FAILED only when it is still open (PLANNED/ATTEMPTING): a bucket that already ended ACCEPTED must never be
// overwritten by a later, unrelated exception in the same bucket's bookkeeping.
function emailLedgerFailIfOpenGs_(h, emailId, reason) {
  const status = emailLedgerStatusOfGs_(h, emailId);
  if (status === EMAIL_LEDGER_STATUS_.PLANNED || status === EMAIL_LEDGER_STATUS_.ATTEMPTING) {
    emailLedgerResultGs_(h, emailId, { status: EMAIL_LEDGER_STATUS_.FAILED, reason: reason, leadIds: [] });
  }
}

// A planned email that was deliberately not sent (nothing to say). Plans it first if the caller had not.
function emailLedgerSkipGs_(h, meta, reason) {
  if (!emailLedgerLiveGs_(h)) return;
  if (!h.rowById[meta.emailId]) emailLedgerPlanGs_(h, [meta]);
  emailLedgerResultGs_(h, meta.emailId, { status: EMAIL_LEDGER_STATUS_.SKIPPED, reason: reason, leadIds: [] });
}

// Runs `sendFn` (which sends ONE email and returns what the send returned) through the ledger: plan (if not yet planned), attempt,
// then the outcome. The error, if any, is re-thrown unchanged so the caller's own handling is untouched. meta = { emailId, job,
// dayKey, region, bucketLabel, primaryRole, to, cc, subject, leadIds }. Used by the CH-level reports.
function emailLedgerTrackSendGs_(h, meta, sendFn) {
  if (!emailLedgerLiveGs_(h)) return sendFn();
  if (!h.rowById[meta.emailId]) emailLedgerPlanGs_(h, [meta]);
  emailLedgerAttemptGs_(h, meta.emailId);
  let sent;
  try {
    sent = sendFn();
  } catch (e) {
    emailLedgerResultGs_(h, meta.emailId, { status: emailLedgerStatusForErrorGs_(e), reason: String((e && e.message) || e), leadIds: [] });
    throw e;
  }
  const ids = emailLedgerSentIdsGs_(sent);
  emailLedgerResultGs_(h, meta.emailId, { status: EMAIL_LEDGER_STATUS_.ACCEPTED, messageId: ids.messageId, threadId: ids.threadId, leadIds: meta.leadIds || [] });
  return sent;
}

// Archives (to Drive, same as the other pruned logs) and then removes rows older than the retention window. Rows are appended in
// time order, so only the LEADING old rows are removed; a sheet that is somehow out of order is only ever trimmed from the top.
function pruneEmailLedgerGs_(h, now) {
  if (!emailLedgerLiveGs_(h)) return;
  emailLedgerGuardGs_(h, 'prune', function () {
    const cutoffKey = istDayKeyGs_(new Date(now.getTime() - EMAIL_LEDGER_RETENTION_DAYS_ * 24 * 3600 * 1000));
    [[h.ledger, EMAIL_LEDGER_SHEET_, EMAIL_LEDGER_HEADERS_], [h.exclusions, EMAIL_LEDGER_EXCLUSIONS_SHEET_, EMAIL_LEDGER_EXCLUSION_HEADERS_]].forEach(function (t) {
      const sheet = t[0], last = sheet.getLastRow();
      if (last < 2) return;
      const days = sheet.getRange(2, 2, last - 1, 1).getValues();
      let old = 0;
      while (old < days.length) {
        const key = emailLedgerDayKeyOfGs_(days[old][0]);
        if (!key || key >= cutoffKey) break;
        old++;
      }
      if (!old) return;
      const rows = sheet.getRange(2, 1, old, t[2].length).getValues();
      const first = emailLedgerDayKeyOfGs_(days[0][0]), lastOld = emailLedgerDayKeyOfGs_(days[old - 1][0]);
      archiveRowsToDriveCsv_(t[1], t[2], rows, first + '_to_' + lastOld); // throws on failure -> nothing is deleted
      sheet.deleteRows(2, old);
      Logger.log('Pruned ' + old + ' ' + t[1] + ' row(s) older than ' + cutoffKey + ' (archived to Drive first).');
    });
  });
}

// End of the job: one ops note if any ledger write failed (the emails themselves were not affected).
function emailLedgerFinishGs_(h, jobLabel) {
  if (!h || !h.failures) return;
  notifyOpsAlertGs_('Email ledger: ' + h.failures + ' write(s) failed during ' + jobLabel + ' - the emails were NOT affected', [
    'The evidence trail (Email_Ledger / Email_Ledger_Exclusions) missed ' + h.failures + ' write(s) during ' + jobLabel + '. Every email still went out exactly as before; only the record of it is incomplete.',
    'Last error: ' + (h.lastError || '(none recorded)'),
    'Check that both sheets exist with their original header row, then run showEmailLedgerTodayNow() to see what was recorded.',
  ]);
}

// ==================== Incident log + held alerts (Email Ops EO-2) ====================
// Plan decision D2 (docs/_planning/EMAIL_OPS_SYSTEM_AUDIT.md section 0): an error is emailed only AFTER the rest of the job's emails are
// confirmed sent, so it never delays or interrupts the safe work. While one of the three email jobs runs, notifyOpsAlertGs_
// (EmailInfra.gs) records each alert as an incident here at once - status HELD - and sends it once, after the job, as ONE message that
// starts with a count of how many emails Gmail accepted. A whole-job failure (nothing left to confirm) is sent immediately. If a job
// is killed before it can send its held alerts, the hourly watchdog releases them (releaseHeldIncidentsGs_). Like the ledger, every
// function here is fail-open: it can never stop an alert or an email.

const EMAIL_INCIDENT_LOG_SHEET_ = 'Incident_Log';
const EMAIL_INCIDENT_HEADERS_ = ['incident_id', 'day', 'detected_at', 'job', 'severity', 'scope', 'subject', 'detail', 'attention_required',
  'owner', 'notification', 'notified_at', 'continuity', 'resolved_at', 'resolution'];
const EMAIL_INCIDENT_RELEASE_AFTER_MINUTES_ = 45; // a HELD incident older than this belongs to a job that never finished
let EMAIL_LEDGER_ACTIVE_ = null; // the ledger handle of the job running now (so a held alert can state how many emails went out)
let EMAIL_INCIDENT_SEQ_ = 0;

function emailLedgerSetActiveGs_(h) { EMAIL_LEDGER_ACTIVE_ = h || null; }
function emailLedgerResetActiveGs_() { EMAIL_LEDGER_ACTIVE_ = null; }

// How many of this run's bucket emails went out - the line a held alert starts with. Counts the rows this run planned or loaded.
function emailLedgerConfirmationLineGs_() {
  const h = EMAIL_LEDGER_ACTIVE_;
  if (!emailLedgerLiveGs_(h)) return 'CONFIRMATION UNAVAILABLE: the email ledger was not active in this run, so the number of emails that went out cannot be stated.';
  const counts = {};
  let total = 0;
  Object.keys(h.rows).forEach(function (rowNo) {
    const status = String(h.rows[rowNo][emailLedgerCol_('status') - 1] || '');
    counts[status] = (counts[status] || 0) + 1;
    total++;
  });
  const open = (counts.PLANNED || 0) + (counts.ATTEMPTING || 0);
  const parts = [(counts.ACCEPTED || 0) + ' accepted by Gmail'];
  if (counts.SKIPPED) parts.push(counts.SKIPPED + ' skipped (nothing to send)');
  if (counts.FAILED) parts.push(counts.FAILED + ' failed');
  if (counts.UNCONFIRMED) parts.push(counts.UNCONFIRMED + ' unconfirmed (may have been delivered)');
  if (counts.BLOCKED) parts.push(counts.BLOCKED + ' blocked by the send-safety gate');
  if (open) parts.push(open + ' left unfinished');
  return 'CONFIRMATION: ' + total + ' bucket email(s) were handled in this run - ' + parts.join(', ') + '. ("Accepted" means Gmail took the message; delivery and opens cannot be seen from here.) The alert(s) below were held until the rest of the run finished.';
}

// Severity (spec section 3) from the alert's subject: CRITICAL = a whole job did not run/finish, LOW = bookkeeping notes, else MEDIUM.
function incidentSeverityGs_(subject) {
  const s = String(subject || '');
  if (/crashed|did not run|did not finish|is overdue|SKIPPED\s*[-—–]\s*another/i.test(s)) return 'CRITICAL';
  if (/TEST MODE|WITHOUT its overlap lock|cannot be checked|cannot be resolved/i.test(s)) return 'HIGH';
  if (/Email ledger:|truncated|log cell/i.test(s)) return 'LOW';
  return 'MEDIUM';
}

function emailIncidentSheetGs_(create) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!create && !ss.getSheetByName(EMAIL_INCIDENT_LOG_SHEET_)) return null;
  return emailLedgerEnsureSheetGs_(ss, EMAIL_INCIDENT_LOG_SHEET_, EMAIL_INCIDENT_HEADERS_, [1, 2]);
}

// Records an alert as an incident and returns its id ('' when it could not be recorded - never throws).
// info = { subject, bodyLines, job, held, severity, scope }. A held incident is HELD until the job's flush sends it.
function incidentRecordGs_(info) {
  if (TEST_MODE_OVERRIDE_EMAIL_) return '';
  try {
    const sheet = emailIncidentSheetGs_(true);
    const now = new Date();
    const severity = info.severity || incidentSeverityGs_(info.subject);
    const id = 'INC-' + Utilities.formatDate(now, 'Asia/Kolkata', 'yyyyMMdd-HHmmss') + '-' + (++EMAIL_INCIDENT_SEQ_);
    const row = [id, istDayKeyGs_(now), now, info.job || '', severity, info.scope || (severity === 'CRITICAL' ? 'system' : 'item'),
      String(info.subject || '').slice(0, 300), (info.bodyLines || []).join('\n').slice(0, 1500), severity === 'LOW' ? 'no' : 'yes', 'Snehil',
      info.held ? 'HELD' : 'PENDING', '', info.held ? 'Held until the rest of the run is confirmed sent (decision D2).' : 'Sent immediately: nothing else to confirm.', '', ''];
    emailLedgerAppendBlockGs_(sheet, [row], function (probe) { return String(probe).trim() === id; }, 'append Incident_Log row');
    return id;
  } catch (e) {
    Logger.log('Incident_Log write failed - the alert itself is NOT affected: ' + e);
    return '';
  }
}

// Marks incidents as notified (status 'SENT', 'SEND-FAILED' or 'RELEASED') with the time and a continuity note. Never throws.
function incidentNotifiedGs_(ids, status, continuity) {
  const wanted = {};
  (ids || []).filter(Boolean).forEach(function (id) { wanted[id] = true; });
  if (!Object.keys(wanted).length || TEST_MODE_OVERRIDE_EMAIL_) return;
  try {
    const sheet = emailIncidentSheetGs_(false);
    if (!sheet || sheet.getLastRow() < 2) return;
    const last = sheet.getLastRow();
    const ids2 = sheet.getRange(2, 1, last - 1, 1).getValues();
    const first = EMAIL_INCIDENT_HEADERS_.indexOf('notification') + 1, count = 3; // notification, notified_at, continuity
    ids2.forEach(function (r, i) {
      const id = String(r[0]).trim();
      if (!wanted[id]) return;
      const cur = sheet.getRange(i + 2, first, 1, count).getValues()[0];
      writeUnlessTestModeGs_(function () { sheet.getRange(i + 2, first, 1, count).setValues([[status, new Date(), continuity || cur[2]]]); }, 'update Incident_Log ' + id);
    });
  } catch (e) {
    Logger.log('Incident_Log update failed - the alert itself is NOT affected: ' + e);
  }
}

// The watchdog's safety net: HELD incidents older than the release window belong to a job that was killed before it could send them.
// Sends ONE message listing them and marks them RELEASED. Never throws.
function releaseHeldIncidentsGs_(now) {
  try {
    if (TEST_MODE_OVERRIDE_EMAIL_) return 0;
    const sheet = emailIncidentSheetGs_(false);
    if (!sheet || sheet.getLastRow() < 2) return 0;
    const col = function (n) { return EMAIL_INCIDENT_HEADERS_.indexOf(n); };
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, EMAIL_INCIDENT_HEADERS_.length).getValues();
    const stale = rows.filter(function (r) {
      const at = r[col('detected_at')];
      return r[col('notification')] === 'HELD' && at instanceof Date && (now.getTime() - at.getTime()) / 60000 > EMAIL_INCIDENT_RELEASE_AFTER_MINUTES_;
    });
    if (!stale.length) return 0;
    const lines = ['The run that raised ' + (stale.length === 1 ? 'this alert' : 'these ' + stale.length + ' alerts') + ' never finished (it was probably killed by the platform), so the alert' + (stale.length === 1 ? ' was' : 's were') + ' never sent. Released now by the watchdog.', ''];
    stale.forEach(function (r) {
      lines.push('[' + r[col('severity')] + '] ' + r[col('subject')] + '  (' + r[col('incident_id')] + ', job ' + (r[col('job')] || '?') + ', ' + Utilities.formatDate(r[col('detected_at')], 'Asia/Kolkata', 'd MMM HH:mm') + ' IST)');
      lines.push(String(r[col('detail')] || ''));
      lines.push('');
    });
    const sent = sendOpsAlertNowGs_('Held alert(s) released: their job never finished (' + stale.length + ')', lines);
    incidentNotifiedGs_(stale.map(function (r) { return r[col('incident_id')]; }), sent ? 'RELEASED' : 'SEND-FAILED', 'Released by the watchdog: the job that held it never finished.');
    return stale.length;
  } catch (e) {
    Logger.log('releaseHeldIncidentsGs_ failed: ' + e);
    return 0;
  }
}
