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
// Writes one day's block of rows at the bottom of a tab (the first column is the day key): replaces the day's existing block - in place when the size is the same, else it is
// cleared and the new block appended - or appends a new block. For the tabs that keep one block of rows per report day (Daily_Checklist, Followup_Tracker). Throws on a write
// failure; the callers swallow it (the report email never depends on these tabs). An empty `rows` only clears the day's block (FT-3, audit 2026-10-13).
function emailLedgerReplaceDayBlockGs_(sheet, rows, day, label) {
  const isDay = function (v) { return emailLedgerDayKeyOfGs_(v) === day; };
  const last = sheet.getLastRow();
  // EL-9 (audit 2026-10-13): the block is scanned from the bottom in growing chunks until a row of another day (or the header) - a fixed span could stop inside a long
  // block and leave its top rows behind as stale duplicates.
  let count = 0, top = last, chunk = Math.max(120, rows.length * 3);
  while (top >= 2) {
    const span = Math.min(chunk, top - 1);
    const vals = sheet.getRange(top - span + 1, 1, span, 1).getValues();
    let i = vals.length - 1;
    while (i >= 0 && isDay(vals[i][0])) i--;
    count += vals.length - 1 - i;
    if (i >= 0) break;
    top -= span;
    chunk *= 2;
  }
  const first = last - count + 1;
  if (count > 0) {
    if (rows.length && count === rows.length) {
      writeUnlessTestModeGs_(function () { sheet.getRange(first, 1, rows.length, rows[0].length).setValues(rows); }, 'update the ' + label + ' rows');
      return;
    }
    // EL-4 (audit 2026-10-13): a retry after a deleteRows that DID land would delete the rows above it (the previous day's). Inside the write the block is checked
    // to be still there and still the day's; otherwise nothing is deleted.
    writeUnlessTestModeGs_(function () {
      if (sheet.getLastRow() !== last) return false;
      if (!sheet.getRange(first, 1, count, 1).getValues().every(function (r) { return isDay(r[0]); })) return false;
      sheet.deleteRows(first, count);
      return true;
    }, 'clear a partial ' + label + ' block');
  }
  if (!rows.length) return;
  emailLedgerAppendBlockGs_(sheet, rows, function (probe) { return emailLedgerDayKeyOfGs_(probe) === day; }, 'append the ' + label + ' rows');
}

// ---- Recovery of failed emails (Email Ops EO-9 / EO-9b; plan decisions D3 and D5; spec rules 4 and 6) ----
// Today's recoverable emails of ONE job, read from the ledger: [{ emailId, region, bucket, status }]. FAILED and BLOCKED (the send was refused) and PLANNED (the run
// died before it reached the bucket: nothing was attempted, so nothing can be duplicated - the recovery runs under the job lock, so a live job's own PLANNED rows are
// never mistaken for abandoned ones). Never UNCONFIRMED or ATTEMPTING (the send may have gone out; a second copy is a duplicate) and never an ACCEPTED one.
// Shared by the 17:00, 10:00 and 13:00 recoveries.
// D2 (2026-10-16): decided per email_id, not per row - when ANY row of an id is ACCEPTED, UNCONFIRMED or ATTEMPTING (e.g. a stale FAILED copy restored from a
// backup or left by a hand edit next to the real row), the email may already have gone and the id is not a target. One target per id.
function emailLedgerRecoveryTargetsGs_(ss, now, job) {
  const day = istDayKeyGs_(now);
  const rows = emailLedgerReadRowsGs_(ss.getSheetByName(EMAIL_LEDGER_SHEET_), EMAIL_LEDGER_HEADERS_, day)
    .filter(function (r) { return r.job === job && emailLedgerDayKeyOfGs_(r.cycle_day) === day; });
  const mayHaveGone = {}, seen = {};
  rows.forEach(function (r) {
    if (r.status === 'ACCEPTED' || r.status === 'UNCONFIRMED' || r.status === 'ATTEMPTING') mayHaveGone[String(r.email_id).trim()] = true;
  });
  return rows
    .filter(function (r) {
      const id = String(r.email_id).trim();
      if (mayHaveGone[id] || seen[id] || !(r.status === 'FAILED' || r.status === 'BLOCKED' || r.status === 'PLANNED')) return false;
      seen[id] = true;
      return true;
    })
    .map(function (r) { return { emailId: r.email_id, region: r.region, bucket: r.bucket_label, status: r.status }; });
}

// True once now is past hour:minute IST on its own IST day - the latest a failed email is still re-sent (decision D5).
function emailLateCutoffPassedGs_(now, hour, minute) {
  const cutoff = new Date(istDayKeyGs_(now) + 'T' + pad2Gs_(hour) + ':' + pad2Gs_(minute) + ':00+05:30');
  return now.getTime() > cutoff.getTime();
}

// The one recovery driver. spec: { job, label ('17:00'), cutoffHour, cutoffMinute, forceName, run: function (ids, regions) } - run re-sends exactly the targeted
// emails (ids: { emailId: true }, regions: { region: true }). opts: { now, force }. Returns { targets, cutoff, ran }.
function emailRecoverBucketsGs_(spec, opts) {
  const o = opts || {};
  const now = o.now || new Date();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const targets = emailLedgerRecoveryTargetsGs_(ss, now, spec.job);
  if (!targets.length) { Logger.log('Recovery: no FAILED, BLOCKED or never-attempted (PLANNED) ' + spec.label + ' bucket in today\'s ledger - nothing to re-send.'); return { targets: [], cutoff: false, ran: false }; }
  if (!o.force && emailLateCutoffPassedGs_(now, spec.cutoffHour, spec.cutoffMinute)) {
    Logger.log('Recovery: ' + targets.length + ' failed bucket(s) but it is past the late-send cutoff (' + spec.cutoffHour + ':' + pad2Gs_(spec.cutoffMinute) + ' IST) - NOT sent late (decision D5). Use ' + spec.forceName + ' to send them on purpose.');
    return { targets: targets, cutoff: true, ran: false };
  }
  const ids = {}, regions = {};
  targets.forEach(function (t) { ids[t.emailId] = true; regions[t.region] = true; });
  Logger.log('Recovery: re-sending ' + targets.length + ' failed bucket(s): ' + targets.map(function (t) { return t.region + (t.bucket ? ' / ' + t.bucket : '') + ' (' + t.status + ')'; }).join('; '));
  spec.run(ids, regions);
  return { targets: targets, cutoff: false, ran: true };
}

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
// The columns kept as plain text (1-based), so Sheets never turns a day key or an id into a Date/number - one source for the writer AND for precreateEmailOpsTabsNow.
const EMAIL_LEDGER_TEXT_COLUMNS_ = [1, 2];
const EMAIL_LEDGER_EXCLUSION_TEXT_COLUMNS_ = [2, 6];
const EMAIL_INCIDENT_TEXT_COLUMNS_ = [1, 2];
const EMAIL_LEDGER_STATUS_ = {
  PLANNED: 'PLANNED', ATTEMPTING: 'ATTEMPTING', ACCEPTED: 'ACCEPTED', FAILED: 'FAILED', UNCONFIRMED: 'UNCONFIRMED', BLOCKED: 'BLOCKED',
  SKIPPED: 'SKIPPED', // planned, then deliberately not sent: there was nothing to say (a genuine final outcome, not a failure)
};

// Human names of the jobs, for every report that lists them (the 16:30 cycle report, the bounce alert).
const EMAIL_LEDGER_JOB_LABELS_ = {
  allIssues17: '17:00 All-Issues', chLevel17: 'CH-level (17:00)', morning10: '10:00 Overnight + Checkpoint 1',
  chLevel10: 'CH-level (10:00)', followup13: '13:00 follow-up', reroute: 'Re-sent after a bounce',
};

// Rows of an evidence tab whose day column (column B in all three tabs) is on/after startDayKey, as objects keyed by header name, each with its
// sheet row number as `rowNo`. Rows are appended in time order, so these are the tail of the sheet (contiguous).
function emailLedgerReadRowsGs_(sheet, headers, startDayKey) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const last = sheet.getLastRow();
  const days = sheet.getRange(2, 2, last - 1, 1).getValues();
  let first = -1;
  for (let i = 0; i < days.length; i++) {
    if (emailLedgerDayKeyOfGs_(days[i][0]) >= startDayKey) { first = i; break; }
  }
  if (first === -1) return [];
  return sheet.getRange(first + 2, 1, last - first - 1, headers.length).getValues().map(function (r, i) {
    const o = { rowNo: first + 2 + i };
    headers.forEach(function (h, j) { o[h] = r[j]; });
    return o;
  });
}

// D5/D6 (2026-10-16): today's ids of `job` that the ledger shows as ACCEPTED (sent) or ATTEMPTING / UNCONFIRMED (may have been
// sent), as { emailId: { status, leadIds } } - the 17:00 job's "already sent today" rule (AI-3), per email id, for the 10:00 and 13:00 re-run
// guards. A FAILED / PLANNED / SKIPPED / BLOCKED id is not in it, so a re-run still sends it. Empty in TEST MODE and when the
// ledger cannot be read (logged): the guard never blocks a run on its own failure. A recovery run never asks (recovering an
// ATTEMPTING / UNCONFIRMED email is never automatic - a human checks it).
function emailLedgerSentOrMaybeSentTodayGs_(ss, job, dayKey) {
  const out = {};
  if (TEST_MODE_OVERRIDE_EMAIL_) return out;
  try {
    emailLedgerReadRowsGs_(ss.getSheetByName(EMAIL_LEDGER_SHEET_), EMAIL_LEDGER_HEADERS_, dayKey).forEach(function (r) {
      const status = String(r.status || '');
      const id = String(r.email_id == null ? '' : r.email_id).trim();
      if (id && r.job === job && emailLedgerDayKeyOfGs_(r.cycle_day) === dayKey &&
        (status === EMAIL_LEDGER_STATUS_.ACCEPTED || status === EMAIL_LEDGER_STATUS_.ATTEMPTING || status === EMAIL_LEDGER_STATUS_.UNCONFIRMED)) {
        let leadIds = [];
        try { leadIds = JSON.parse(String(r.lead_ids_json || '[]')).map(String); } catch (e) { leadIds = []; }
        out[id] = { status: status, leadIds: leadIds };
      }
    });
  } catch (e) {
    Logger.log('Email_Ledger could not be read for the ' + job + ' "already sent today" guard - not skipping anything on its account: ' + e);
  }
  return out;
}

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

// A tab's last row, retried on a transient Sheets error ("Service Spreadsheets timed out ..."). The email jobs' FIRST read of their log tabs used to be unprotected, so a
// single timeout ended the whole job (the 2026-10-09/10 first 17:00 run on this code, HANDOVER section 8).
function lastRowRetryGs_(sheet) {
  let name = 'a tab';
  try { name = sheet.getName(); } catch (e) { name = 'a tab'; }
  return withRetry_(function () { return sheet.getLastRow(); }, 'read the size of ' + name);
}

// One-off, run by hand at a QUIET moment: creates every tab of the Email Operations System that would otherwise be created for the first time INSIDE a running job
// (Email_Ledger, Email_Ledger_Exclusions, Incident_Log, Email_Reroutes, Daily_Report, Daily_Checklist, Followup_Tracker). Why: in this very large workbook (thousands of leads,
// a live MySQL import, dozens of tabs) adding a tab makes the spreadsheet service time out for a while, and the first 17:00 run on this code created three tabs mid-job and crashed
// (HANDOVER section 8). Safe to run any number of times: a tab that already has the right header is left exactly as it is; one with a different header is reported and NOT touched.
// Returns { created: [name], existed: [name], failed: [text] } and logs the same. (Not read-only: it adds empty tabs with their header row.)
function precreateEmailOpsTabsNow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const specs = [
    [EMAIL_LEDGER_SHEET_, EMAIL_LEDGER_HEADERS_, EMAIL_LEDGER_TEXT_COLUMNS_],
    [EMAIL_LEDGER_EXCLUSIONS_SHEET_, EMAIL_LEDGER_EXCLUSION_HEADERS_, EMAIL_LEDGER_EXCLUSION_TEXT_COLUMNS_],
    [EMAIL_INCIDENT_LOG_SHEET_, EMAIL_INCIDENT_HEADERS_, EMAIL_INCIDENT_TEXT_COLUMNS_],
  ];
  if (typeof EMAIL_REROUTE_SHEET_ !== 'undefined') specs.push([EMAIL_REROUTE_SHEET_, EMAIL_REROUTE_HEADERS_, EMAIL_REROUTE_TEXT_COLUMNS_]);
  if (typeof CYCLE_REPORT_DAILY_SHEET_ !== 'undefined') specs.push([CYCLE_REPORT_DAILY_SHEET_, CYCLE_REPORT_DAILY_HEADERS_, CYCLE_REPORT_DAILY_TEXT_COLUMNS_]);
  if (typeof DAILY_CHECKLIST_SHEET_ !== 'undefined') specs.push([DAILY_CHECKLIST_SHEET_, DAILY_CHECKLIST_HEADERS_, DAILY_CHECKLIST_TEXT_COLUMNS_]);
  if (typeof FOLLOWUP_TRACKER_SHEET_ !== 'undefined') specs.push([FOLLOWUP_TRACKER_SHEET_, FOLLOWUP_TRACKER_HEADERS_, FOLLOWUP_TRACKER_TEXT_COLUMNS_]);
  const out = { created: [], existed: [], failed: [] };
  specs.forEach(function (s) {
    const name = s[0];
    try {
      const had = !!withRetry_(function () { return ss.getSheetByName(name); }, 'look for ' + name);
      withRetry_(function () { return emailLedgerEnsureSheetGs_(ss, name, s[1], s[2]); }, 'create ' + name);
      (had ? out.existed : out.created).push(name);
      if (!had) { SpreadsheetApp.flush(); Utilities.sleep(3000); } // let the spreadsheet settle before the next structural change
    } catch (e) {
      out.failed.push(name + ': ' + String((e && e.message) || e));
    }
  });
  Logger.log('precreateEmailOpsTabsNow: created ' + (out.created.join(', ') || '(none)') + '; already there ' + (out.existed.join(', ') || '(none)') + (out.failed.length ? '; FAILED ' + out.failed.join(' | ') : '') + '.');
  return out;
}

// Opens (creating on first use) both sheets and indexes the existing email ids. Returns a handle, or null in TEST MODE; when the
// sheets cannot be opened the handle is returned DISABLED (every later call is a no-op and the failure is reported at the end).
function emailLedgerOpenGs_(ss) {
  if (TEST_MODE_OVERRIDE_EMAIL_) return null;
  // touched (EL-7): the rows THIS run planned or wrote a result into - a re-run also loads earlier runs' rows, which the confirmation line must not count as its own.
  const h = { ledger: null, exclusions: null, rowById: {}, rows: {}, touched: {}, failures: 0, lastError: '', disabled: false };
  emailLedgerSetActiveGs_(h); // a held alert (EO-2) states how many of THIS run's emails went out
  try {
    h.ledger = emailLedgerEnsureSheetGs_(ss, EMAIL_LEDGER_SHEET_, EMAIL_LEDGER_HEADERS_, EMAIL_LEDGER_TEXT_COLUMNS_);
    h.exclusions = emailLedgerEnsureSheetGs_(ss, EMAIL_LEDGER_EXCLUSIONS_SHEET_, EMAIL_LEDGER_EXCLUSION_HEADERS_, EMAIL_LEDGER_EXCLUSION_TEXT_COLUMNS_);
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
    const fresh = [], seen = {}, settle = [];
    plans.forEach(function (p) {
      // EL-1 (audit 2026-10-13): the same id twice in one batch appended two rows; the index kept the second, so the first stayed PLANNED for ever (an "unfinished"
      // email that recovery kept targeting). The first plan of an id wins.
      if (seen[p.emailId]) return;
      seen[p.emailId] = true;
      if (h.rowById[p.emailId]) {
        emailLedgerLoadRowGs_(h, p.emailId);
        // EL-2 (audit 2026-10-13): a re-run that already knows the final state (initialStatus) settles a row a crashed run left PLANNED; any other row keeps its result.
        if (p.initialStatus && String(h.rows[h.rowById[p.emailId]][emailLedgerCol_('status') - 1]) === EMAIL_LEDGER_STATUS_.PLANNED) settle.push(p);
        return;
      }
      fresh.push(p);
    });
    settle.forEach(function (p) {
      emailLedgerPatchGs_(h, p.emailId, 'plan', function (row) {
        row[emailLedgerCol_('finished_at') - 1] = new Date();
        row[emailLedgerCol_('status') - 1] = p.initialStatus;
        row[emailLedgerCol_('status_reason') - 1] = String(p.initialReason || '').slice(0, 500);
        row[emailLedgerCol_('leads_sent') - 1] = 0;
      });
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
    let startRow;
    try {
      startRow = emailLedgerAppendBlockGs_(h.ledger, rows, function (probe) { return String(probe).trim() === rows[0][0]; }, 'append Email_Ledger rows');
    } catch (e) {
      // D1 (2026-10-16): a write can LAND and still report an error. Unindexed, its rows stayed PLANNED (attempt/result writes were no-ops) and the recovery
      // re-sent the delivered email as "never attempted". Index whatever of this block is on the sheet, then report the failure as before.
      emailLedgerRelocateGs_(h, rows);
      throw e;
    }
    rows.forEach(function (r, i) { h.rowById[r[0]] = startRow + i; h.rows[startRow + i] = r; if (h.touched) h.touched[startRow + i] = true; });
  });
}

// D1: finds the rows of a just-attempted plan block by email_id in the last rows of the ledger and indexes the ones that are there. Never throws.
function emailLedgerRelocateGs_(h, rows) {
  try {
    const last = h.ledger.getLastRow();
    const span = Math.min(last - 1, rows.length + 50);
    if (span < 1) return;
    const first = last - span + 1;
    const want = {};
    rows.forEach(function (r, i) { want[r[0]] = i; });
    h.ledger.getRange(first, 1, span, 1).getValues().forEach(function (v, i) {
      const id = String(v[0] == null ? '' : v[0]).trim();
      if (want[id] === undefined || h.rowById[id]) return;
      h.rowById[id] = first + i;
      h.rows[first + i] = rows[want[id]];
      if (h.touched) h.touched[first + i] = true;
    });
  } catch (e) {
    Logger.log('Email ledger: could not re-read the plan block after a failed write: ' + e);
  }
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
    if (h.touched) h.touched[rowNo] = true; // EL-7: this run wrote a result into it
    const first = emailLedgerCol_('attempted_at'), last = emailLedgerCol_('lead_ids_json');
    writeUnlessTestModeGs_(function () { h.ledger.getRange(rowNo, first, 1, last - first + 1).setValues([row.slice(first - 1, last)]); }, 'update Email_Ledger row (' + label + ')');
  });
}

// The send is about to start. A row left in ATTEMPTING afterwards is the evidence that the run died mid-send.
function emailLedgerAttemptGs_(h, emailId) {
  if (typeof emailRerouteClearNoteGs_ === 'function') emailRerouteClearNoteGs_(); // EmailReroute.gs: a redirect note belongs to the send that is about to start
  emailLedgerPatchGs_(h, emailId, 'attempt', function (row) {
    row[emailLedgerCol_('attempted_at') - 1] = new Date();
    row[emailLedgerCol_('finished_at') - 1] = '';
    row[emailLedgerCol_('status') - 1] = EMAIL_LEDGER_STATUS_.ATTEMPTING;
    row[emailLedgerCol_('status_reason') - 1] = '';
    row[emailLedgerCol_('attempts') - 1] = Number(row[emailLedgerCol_('attempts') - 1] || 0) + 1;
  });
}

// The send ended. result = { status, reason, messageId, threadId, leadIds } (leadIds = the leads the email really carried - or, for an UNCONFIRMED send,
// may have carried; [] for FAILED/BLOCKED/SKIPPED). leads_sent counts only an ACCEPTED email's leads.
function emailLedgerResultGs_(h, emailId, result) {
  // A send that was redirected to another address (EmailReroute.gs) says so in its row; the note is always consumed so it can never leak into the next row.
  const rerouteNote = typeof emailRerouteTakeNoteGs_ === 'function' ? emailRerouteTakeNoteGs_() : '';
  const reason = (result.status === EMAIL_LEDGER_STATUS_.ACCEPTED || result.status === EMAIL_LEDGER_STATUS_.UNCONFIRMED) && rerouteNote
    ? (result.reason ? result.reason + '; ' : '') + rerouteNote : result.reason;
  emailLedgerPatchGs_(h, emailId, 'result', function (row) {
    const ids = result.leadIds || [];
    row[emailLedgerCol_('finished_at') - 1] = new Date();
    row[emailLedgerCol_('status') - 1] = result.status;
    row[emailLedgerCol_('status_reason') - 1] = String(reason || '').slice(0, 500);
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
    const errStatus = emailLedgerStatusForErrorGs_(e);
    // O3 (2026-10-16): an UNCONFIRMED email may have been delivered - its row keeps its leads (FAILED/BLOCKED rows still record none).
    emailLedgerResultGs_(h, meta.emailId, { status: errStatus, reason: String((e && e.message) || e), leadIds: errStatus === EMAIL_LEDGER_STATUS_.UNCONFIRMED ? (meta.leadIds || []) : [] });
    throw e;
  }
  const ids = emailLedgerSentIdsGs_(sent);
  emailLedgerResultGs_(h, meta.emailId, { status: EMAIL_LEDGER_STATUS_.ACCEPTED, messageId: ids.messageId, threadId: ids.threadId, leadIds: meta.leadIds || [] });
  return sent;
}

// Archives (to Drive) and then removes the LEADING rows of a tab whose day (column dayCol) is before cutoffKey; returns how many. Rows are appended in time order, so a
// sheet that is somehow out of order is only ever trimmed from the top. EL-8 (audit 2026-10-13): a blank day cell used to stop the scan for good (nothing was ever pruned
// again); a blank row among the old leading rows now goes with them - but never as the last row removed. Throws when the archive fails (then nothing is deleted).
function emailLedgerPruneLeadingGs_(sheet, name, headers, dayCol, cutoffKey) {
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const days = sheet.getRange(2, dayCol, last - 1, 1).getValues();
  let old = 0, firstKey = '';
  for (let i = 0; i < days.length; i++) {
    const key = emailLedgerDayKeyOfGs_(days[i][0]);
    if (!key) continue;
    if (key >= cutoffKey) break;
    old = i + 1;
    if (!firstKey) firstKey = key;
  }
  if (!old) return 0;
  const rows = sheet.getRange(2, 1, old, headers.length).getValues();
  archiveRowsToDriveCsv_(name, headers, rows, firstKey + '_to_' + emailLedgerDayKeyOfGs_(days[old - 1][0])); // throws on failure -> nothing is deleted
  sheet.deleteRows(2, old);
  Logger.log('Pruned ' + old + ' ' + name + ' row(s) older than ' + cutoffKey + ' (archived to Drive first).');
  return old;
}

// Archives (to Drive, same as the other pruned logs) and then removes rows older than the retention window (emailLedgerPruneLeadingGs_).
function pruneEmailLedgerGs_(h, now) {
  if (!emailLedgerLiveGs_(h)) return;
  emailLedgerGuardGs_(h, 'prune', function () {
    const cutoffKey = istDayKeyGs_(new Date(now.getTime() - EMAIL_LEDGER_RETENTION_DAYS_ * 24 * 3600 * 1000));
    const removed = emailLedgerPruneLeadingGs_(h.ledger, EMAIL_LEDGER_SHEET_, EMAIL_LEDGER_HEADERS_, 2, cutoffKey);
    if (removed) emailLedgerShiftHandleGs_(h, removed);
    emailLedgerPruneLeadingGs_(h.exclusions, EMAIL_LEDGER_EXCLUSIONS_SHEET_, EMAIL_LEDGER_EXCLUSION_HEADERS_, 2, cutoffKey);
  });
}

// EL-5 (audit 2026-10-13): after `removed` leading ledger rows were deleted, the handle's row numbers point `removed` rows too low - a later patch through it would
// write into another email's row. They are moved up with the sheet; the rows that were removed are forgotten.
function emailLedgerShiftHandleGs_(h, removed) {
  const shift = function (map, isIndex) {
    const out = {};
    Object.keys(map).forEach(function (k) {
      const rowNo = isIndex ? map[k] : Number(k);
      if (rowNo - removed < 2) return;
      if (isIndex) out[k] = rowNo - removed; else out[rowNo - removed] = map[k];
    });
    return out;
  };
  h.rowById = shift(h.rowById, true);
  h.rows = shift(h.rows, false);
  if (h.touched) h.touched = shift(h.touched, false);
}

// EL-6 (audit 2026-10-13): the other Email Ops tabs had no retention - Incident_Log above all, read in full by the hourly watchdog. The same rule as the ledger: rows
// older than EMAIL_LEDGER_RETENTION_DAYS_ are archived to Drive and removed. Driven by the 16:30 cycle report (CycleReport.gs), which owns three of these tabs. Fail-open
// per tab (a tab that is missing, has another header or cannot be archived is left alone and logged); TEST MODE prunes nothing. Returns { tabName: rowsRemoved }.
function pruneEmailOpsTabsGs_(ss, now) {
  const out = {};
  if (TEST_MODE_OVERRIDE_EMAIL_) return out;
  const cutoffKey = istDayKeyGs_(new Date(now.getTime() - EMAIL_LEDGER_RETENTION_DAYS_ * 24 * 3600 * 1000));
  const specs = [[EMAIL_INCIDENT_LOG_SHEET_, EMAIL_INCIDENT_HEADERS_, 2]]; // [tab, headers, day column]
  if (typeof EMAIL_REROUTE_SHEET_ !== 'undefined') specs.push([EMAIL_REROUTE_SHEET_, EMAIL_REROUTE_HEADERS_, 1]); // created_at (a row is in force 14 days at most)
  if (typeof CYCLE_REPORT_DAILY_SHEET_ !== 'undefined') specs.push([CYCLE_REPORT_DAILY_SHEET_, CYCLE_REPORT_DAILY_HEADERS_, 1]);
  if (typeof DAILY_CHECKLIST_SHEET_ !== 'undefined') specs.push([DAILY_CHECKLIST_SHEET_, DAILY_CHECKLIST_HEADERS_, 1]);
  if (typeof FOLLOWUP_TRACKER_SHEET_ !== 'undefined') specs.push([FOLLOWUP_TRACKER_SHEET_, FOLLOWUP_TRACKER_HEADERS_, 1]);
  specs.forEach(function (t) {
    try {
      const sheet = ss.getSheetByName(t[0]);
      if (!sheet || sheet.getLastRow() < 2) return;
      const have = sheet.getRange(1, 1, 1, t[1].length).getValues()[0];
      if (t[1].some(function (h, i) { return String(have[i] == null ? '' : have[i]).trim() !== h; })) { Logger.log('Retention: ' + t[0] + ' has a header it does not recognise - not pruned.'); return; }
      out[t[0]] = emailLedgerPruneLeadingGs_(sheet, t[0], t[1], t[2], cutoffKey);
    } catch (e) {
      Logger.log('Retention: ' + t[0] + ' was not pruned (nothing removed) - ' + e);
    }
  });
  return out;
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
let EMAIL_INCIDENT_RUN_TOKEN_ = ''; // EL-10: four random digits per execution, so two runs in the same second never mint the same id
const EMAIL_INCIDENT_RETRY_MAX_ = 2; // EL-3: a SEND-FAILED alert is sent again by the watchdog at most this many times
const EMAIL_INCIDENT_RETRY_WINDOW_HOURS_ = 24; // ...and only while it is this recent

function emailLedgerSetActiveGs_(h) { EMAIL_LEDGER_ACTIVE_ = h || null; }
function emailLedgerResetActiveGs_() { EMAIL_LEDGER_ACTIVE_ = null; }

// How many of this run's bucket emails went out - the line a held alert starts with. Counts the rows this run planned or loaded.
function emailLedgerConfirmationLineGs_() {
  const h = EMAIL_LEDGER_ACTIVE_;
  if (!emailLedgerLiveGs_(h)) return 'CONFIRMATION UNAVAILABLE: the email ledger was not active in this run, so the number of emails that went out cannot be stated.';
  const counts = {};
  let total = 0, earlier = 0;
  Object.keys(h.rows).forEach(function (rowNo) {
    if (h.touched && !h.touched[rowNo]) { earlier++; return; } // EL-7: loaded from an earlier run, not handled by this one
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
  if (earlier) parts.push('(' + earlier + ' earlier result(s) from a previous run not counted)');
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
  return emailLedgerEnsureSheetGs_(ss, EMAIL_INCIDENT_LOG_SHEET_, EMAIL_INCIDENT_HEADERS_, EMAIL_INCIDENT_TEXT_COLUMNS_);
}

// Records an alert as an incident and returns its id ('' when it could not be recorded - never throws).
// info = { subject, bodyLines, job, held, severity, scope }. A held incident is HELD until the job's flush sends it.
function incidentRecordGs_(info) {
  if (TEST_MODE_OVERRIDE_EMAIL_) return '';
  try {
    const sheet = emailIncidentSheetGs_(true);
    const now = new Date();
    const severity = info.severity || incidentSeverityGs_(info.subject);
    // EL-10 (audit 2026-10-13): the sequence restarts in every execution, so two runs alerting in the same second made the same id (and one notification update marked
    // both). A per-execution random token goes in front of the sequence; the id keeps its INC-yyyymmdd-hhmmss-<digits> shape.
    if (!EMAIL_INCIDENT_RUN_TOKEN_) EMAIL_INCIDENT_RUN_TOKEN_ = String(1000 + Math.floor(Math.random() * 9000));
    const id = 'INC-' + Utilities.formatDate(now, 'Asia/Kolkata', 'yyyyMMdd-HHmmss') + '-' + EMAIL_INCIDENT_RUN_TOKEN_ + (++EMAIL_INCIDENT_SEQ_);
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

// Marks incidents as notified (status 'SENT', 'SEND-FAILED' or 'RELEASED') with the time and a continuity note. Never throws. Returns how many rows were updated.
function incidentNotifiedGs_(ids, status, continuity) {
  const wanted = {};
  (ids || []).filter(Boolean).forEach(function (id) { wanted[id] = true; });
  if (!Object.keys(wanted).length || TEST_MODE_OVERRIDE_EMAIL_) return 0;
  let updated = 0;
  try {
    const sheet = emailIncidentSheetGs_(false);
    if (!sheet || sheet.getLastRow() < 2) return 0;
    const last = sheet.getLastRow();
    const ids2 = sheet.getRange(2, 1, last - 1, 1).getValues();
    const first = EMAIL_INCIDENT_HEADERS_.indexOf('notification') + 1, count = 3; // notification, notified_at, continuity
    ids2.forEach(function (r, i) {
      const id = String(r[0]).trim();
      if (!wanted[id]) return;
      const cur = sheet.getRange(i + 2, first, 1, count).getValues()[0];
      writeUnlessTestModeGs_(function () { sheet.getRange(i + 2, first, 1, count).setValues([[status, new Date(), continuity || cur[2]]]); }, 'update Incident_Log ' + id);
      updated++;
    });
  } catch (e) {
    Logger.log('Incident_Log update failed - the alert itself is NOT affected: ' + e);
  }
  return updated;
}

// How many times the watchdog already re-sent a SEND-FAILED incident ('SEND-FAILED' = 0, 'SEND-FAILED (retry 2)' = 2), or -1 when it is not SEND-FAILED. Pure.
function incidentSendRetriesGs_(notification) {
  const m = /^SEND-FAILED(?: \(retry (\d+)\))?$/.exec(String(notification || '').trim());
  return m ? Number(m[1] || 0) : -1;
}

// The watchdog's safety net: HELD incidents older than the release window belong to a job that was killed before it could send them.
// Sends ONE message listing them and marks them RELEASED. Never throws.
// EL-3 (audit 2026-10-13): an alert whose own send failed (SEND-FAILED) used to be lost; it is now sent again with the next release, at most EMAIL_INCIDENT_RETRY_MAX_
// times and only within EMAIL_INCIDENT_RETRY_WINDOW_HOURS_. The rows are claimed (RELEASING) BEFORE the send: if that write fails nothing is sent this hour, and a status
// write that fails after a good send leaves RELEASING, which is never sent again - before, a failed status write re-sent the same alerts every hour.
function releaseHeldIncidentsGs_(now) {
  try {
    if (TEST_MODE_OVERRIDE_EMAIL_) return 0;
    const sheet = emailIncidentSheetGs_(false);
    if (!sheet || sheet.getLastRow() < 2) return 0;
    const col = function (n) { return EMAIL_INCIDENT_HEADERS_.indexOf(n); };
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, EMAIL_INCIDENT_HEADERS_.length).getValues();
    const ageMinutes = function (r) { const at = r[col('detected_at')]; return at instanceof Date ? (now.getTime() - at.getTime()) / 60000 : -1; };
    const held = rows.filter(function (r) { return r[col('notification')] === 'HELD' && ageMinutes(r) > EMAIL_INCIDENT_RELEASE_AFTER_MINUTES_; });
    const retry = rows.filter(function (r) {
      const n = incidentSendRetriesGs_(r[col('notification')]);
      return n >= 0 && n < EMAIL_INCIDENT_RETRY_MAX_ && ageMinutes(r) >= 0 && ageMinutes(r) <= EMAIL_INCIDENT_RETRY_WINDOW_HOURS_ * 60;
    });
    const stale = held.concat(retry);
    if (!stale.length) return 0;
    const idOf = function (r) { return r[col('incident_id')]; };
    if (incidentNotifiedGs_(stale.map(idOf), 'RELEASING', 'Being sent by the watchdog.') < stale.length) { Logger.log('releaseHeldIncidentsGs_: the incidents could not be claimed - nothing sent; the next watchdog run retries.'); return 0; }
    const lines = [];
    if (held.length) lines.push('The run that raised ' + (held.length === 1 ? 'this alert' : 'these ' + held.length + ' alerts') + ' never finished (it was probably killed by the platform), so the alert' + (held.length === 1 ? ' was' : 's were') + ' never sent. Released now by the watchdog.', '');
    if (retry.length) lines.push(retry.length + ' alert(s) below could not be sent when they were raised; the watchdog is sending them again.', '');
    stale.forEach(function (r) {
      lines.push('[' + r[col('severity')] + '] ' + r[col('subject')] + '  (' + r[col('incident_id')] + ', job ' + (r[col('job')] || '?') + ', ' + Utilities.formatDate(r[col('detected_at')], 'Asia/Kolkata', 'd MMM HH:mm') + ' IST)');
      lines.push(String(r[col('detail')] || ''));
      lines.push('');
    });
    const subject = held.length && !retry.length ? 'Held alert(s) released: their job never finished (' + stale.length + ')'
      : !held.length ? 'Alert(s) sent again: their first send failed (' + stale.length + ')' : 'Held alert(s) released and failed alert(s) sent again (' + stale.length + ')';
    const sent = sendOpsAlertNowGs_(subject, lines);
    if (sent) {
      incidentNotifiedGs_(held.map(idOf), 'RELEASED', 'Released by the watchdog: the job that held it never finished.');
      incidentNotifiedGs_(retry.map(idOf), 'RELEASED', 'Sent again by the watchdog after its first send failed.');
    } else {
      incidentNotifiedGs_(held.map(idOf), 'SEND-FAILED', 'The watchdog could not send it either; it tries again.');
      const byStatus = {};
      retry.forEach(function (r) { const k = 'SEND-FAILED (retry ' + (incidentSendRetriesGs_(r[col('notification')]) + 1) + ')'; (byStatus[k] = byStatus[k] || []).push(idOf(r)); });
      Object.keys(byStatus).forEach(function (k) { incidentNotifiedGs_(byStatus[k], k, 'The watchdog could not send it again.'); });
    }
    return stale.length;
  } catch (e) {
    Logger.log('releaseHeldIncidentsGs_ failed: ' + e);
    return 0;
  }
}
