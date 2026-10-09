/**
 * EmailSweep.gs - bounces and replies for the emails the ledger recorded (Email Operations System, part EO-5).
 * Plan: docs/_planning/EMAIL_OPS_SYSTEM_AUDIT.md (gap G5; spec phase 16 "Reply, bounce, and engagement monitoring").
 *
 * WHAT IT DOES. Once a day (before the 16:30 cycle report) it looks at the bucket emails of the last 3 days that Gmail ACCEPTED and fills the
 * three evidence columns the ledger keeps for this (bounce_status, reply_status, swept_at):
 *   - BOUNCES: Gmail search for delivery-status messages from mailer-daemon / postmaster; a bounce is matched to an email only when it names one of
 *     that email's recipients AND (quotes its subject, or arrived within 15 minutes of the send).
 *   - REPLIES: the Gmail thread the email went into (its thread_id); any message after the send from someone other than the sending account.
 * A bounce is also raised as an ops alert (it means a manager did NOT get the email).
 *
 * WHAT IT CANNOT KNOW. Delivered and opened are invisible to Apps Script. NO_BOUNCE_SEEN means "no bounce message was found" - it is NOT
 * "delivered" and the report never says so. A bounce that Gmail does not file as a mailer-daemon message would be missed.
 *
 * Fail-open like the rest of the evidence trail: a Gmail error on one thread is recorded against that email and the sweep goes on; the sweep stops
 * by itself after a time budget and the unswept rows are picked up next time.
 */

// Read-only helper FIRST in the file (the editor's Run button has run the previously selected function before - see HANDOVER).
// Logs how many emails the next sweep would look at. Writes nothing, reads no mail.
function showEmailSweepPlanNow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(EMAIL_LEDGER_SHEET_);
  if (!sheet || sheet.getLastRow() < 2) { Logger.log('Email_Ledger: no rows yet - nothing to sweep.'); return; }
  const rows = emailSweepReadRowsGs_(sheet, new Date());
  const due = rows.filter(function (r) { return emailSweepIsCandidateGs_(r, new Date()); });
  Logger.log('The next sweep would look at ' + due.length + ' accepted email(s) from the last ' + EMAIL_SWEEP_LOOKBACK_DAYS_ + ' days (of ' + rows.length + ' ledger rows read).');
}

const EMAIL_SWEEP_JOB_ = 'sweepEmailBouncesAndReplies';
const EMAIL_SWEEP_HOUR_ = 15;   // IST - well before the 16:30 cycle report (a nearMinute trigger fires up to 15 minutes either side of its minute)
const EMAIL_SWEEP_MINUTE_ = 45; // IST
const EMAIL_SWEEP_LOOKBACK_DAYS_ = 3;
const EMAIL_SWEEP_MIN_AGE_MINUTES_ = 30; // a bounce arrives within minutes; before this a clean result would prove nothing
const EMAIL_SWEEP_MAX_RUN_MS_ = 270000;  // stop after 4.5 minutes; what is left is swept next time
const EMAIL_SWEEP_BOUNCE_QUERY_ = 'from:(mailer-daemon OR postmaster) newer_than:3d';
const EMAIL_SWEEP_BOUNCE_MAX_THREADS_ = 100;
const EMAIL_SWEEP_QUICK_BOUNCE_MS_ = 15 * 60 * 1000; // a bounce this soon after a send is attributed to it even if it does not quote the subject
const EMAIL_SWEEP_OWN_NAME_ = 'homesfy lead ops'; // the display name every send uses (sendGuardedEmailGs_) - how our own messages are told apart

// ---- pure helpers ----

function emailSweepAddressesGs_(text) {
  return String(text || '').split(',').map(function (a) { return a.trim().toLowerCase(); }).filter(Boolean);
}

// Is this ledger row (an object keyed by header) one the sweep should look at at `now`?
function emailSweepIsCandidateGs_(row, now) {
  if (row.status !== 'ACCEPTED' && row.status !== 'UNCONFIRMED') return false;
  const at = row.finished_at;
  if (!(at instanceof Date)) return false;
  const ageMs = now.getTime() - at.getTime();
  return ageMs >= EMAIL_SWEEP_MIN_AGE_MINUTES_ * 60000 && ageMs <= EMAIL_SWEEP_LOOKBACK_DAYS_ * 24 * 3600 * 1000;
}

// The bounce (from `bounces` = [{ at: Date, subject, body }]) that belongs to this ledger row, or null. Needs a recipient of the email in the
// bounce text AND (the email's subject quoted in it, or the bounce arriving within 15 minutes of the send).
function emailSweepMatchBounceGs_(row, bounces) {
  const finished = row.finished_at instanceof Date ? row.finished_at.getTime() : NaN;
  if (isNaN(finished)) return null;
  const recipients = emailSweepAddressesGs_(row.to).concat(emailSweepAddressesGs_(row.cc));
  const subj = String(row.subject || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 50);
  for (let i = 0; i < bounces.length; i++) {
    const b = bounces[i];
    const at = b.at instanceof Date ? b.at.getTime() : NaN;
    if (isNaN(at) || at < finished - 60000 || at > finished + 24 * 3600 * 1000) continue;
    const text = (String(b.subject || '') + '\n' + String(b.body || '')).toLowerCase().replace(/\s+/g, ' ');
    if (!recipients.some(function (a) { return text.indexOf(a) !== -1; })) continue;
    if ((subj && text.indexOf(subj) !== -1) || at - finished <= EMAIL_SWEEP_QUICK_BOUNCE_MS_) return b;
  }
  return null;
}

function emailSweepIsOwnGs_(from, ownAddress) {
  const f = String(from || '').toLowerCase();
  return f.indexOf(EMAIL_SWEEP_OWN_NAME_) !== -1 || (!!ownAddress && f.indexOf(String(ownAddress).toLowerCase()) !== -1);
}

function emailSweepIsBounceSenderGs_(from) { return /mailer-daemon|postmaster/i.test(String(from || '')); }

// Replies to a ledger row inside its thread: messages after the send from someone who is neither us nor a bounce notice.
// messages = [{ from, date }]. Returns { count, latest } (latest = the newest reply's Date or null).
function emailSweepRepliesGs_(row, messages, ownAddress) {
  const finished = row.finished_at instanceof Date ? row.finished_at.getTime() : NaN;
  let count = 0, latest = null;
  (messages || []).forEach(function (m) {
    const at = m.date instanceof Date ? m.date.getTime() : NaN;
    if (isNaN(finished) || isNaN(at) || at <= finished) return;
    if (emailSweepIsOwnGs_(m.from, ownAddress) || emailSweepIsBounceSenderGs_(m.from)) return;
    count++;
    if (!latest || at > latest.getTime()) latest = m.date;
  });
  return { count: count, latest: latest };
}

function emailSweepStampGs_(date) { return Utilities.formatDate(date, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm'); }

// ---- ledger access ----

// Ledger rows from the first row of (now - lookback days - 1) onwards (objects keyed by header name, each with its `rowNo`).
function emailSweepReadRowsGs_(sheet, now) {
  const startKey = istDayKeyGs_(new Date(now.getTime() - (EMAIL_SWEEP_LOOKBACK_DAYS_ + 1) * 24 * 3600 * 1000));
  return emailLedgerReadRowsGs_(sheet, EMAIL_LEDGER_HEADERS_, startKey);
}

// ---- Gmail access (isolated so the tests can replace it) ----

function emailSweepOwnAddressGs_() {
  try { return typeof Session !== 'undefined' && Session.getEffectiveUser ? Session.getEffectiveUser().getEmail() : ''; } catch (e) { return ''; }
}

// Delivery-status messages of the last days: [{ at, subject, body }]. A search failure returns what was read so far and records the error.
function emailSweepFetchBouncesGs_(state) {
  const out = [];
  try {
    const threads = GmailApp.search(EMAIL_SWEEP_BOUNCE_QUERY_, 0, EMAIL_SWEEP_BOUNCE_MAX_THREADS_);
    threads.forEach(function (t) {
      t.getMessages().forEach(function (m) {
        if (!emailSweepIsBounceSenderGs_(m.getFrom())) return;
        out.push({ at: m.getDate(), subject: m.getSubject(), body: m.getPlainBody() });
      });
    });
  } catch (e) {
    state.errors.push('bounce search: ' + String((e && e.message) || e));
    state.bounceSearchFailed = true; // a failed search must never read as "no bounce seen"
  }
  return out;
}

// The messages of one thread as [{ from, date }], or null when it cannot be read.
function emailSweepFetchThreadGs_(threadId) {
  try {
    return GmailApp.getThreadById(threadId).getMessages().map(function (m) { return { from: m.getFrom(), date: m.getDate() }; });
  } catch (e) {
    return null;
  }
}

// ---- the run ----

// The sweep. opts.now / opts.maxRunMs (tests). Returns { checked, bounced, replied, newBounces: [row], unswept, errors }.
function sweepEmailBouncesAndReplies_(opts) {
  const o = opts || {};
  const now = o.now || new Date();
  const started = Date.now();
  const budgetMs = o.maxRunMs === undefined ? EMAIL_SWEEP_MAX_RUN_MS_ : o.maxRunMs; // (tests shrink it)
  const state = { errors: [], bounceSearchFailed: false };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(EMAIL_LEDGER_SHEET_);
  const summary = { checked: 0, bounced: 0, replied: 0, newBounces: [], unswept: 0, errors: state.errors };
  if (!sheet || sheet.getLastRow() < 2) { Logger.log('Email sweep: no Email_Ledger rows yet - nothing to do.'); return summary; }

  const rows = emailSweepReadRowsGs_(sheet, now);
  const due = rows.filter(function (r) { return emailSweepIsCandidateGs_(r, now); });
  if (!due.length) { Logger.log('Email sweep: no accepted email is old enough (or recent enough) to sweep.'); return summary; }

  const bounces = emailSweepFetchBouncesGs_(state);
  const own = emailSweepOwnAddressGs_();
  const threadCache = {};
  const stamp = new Date();
  const colBounce = EMAIL_LEDGER_HEADERS_.indexOf('bounce_status'), colReply = EMAIL_LEDGER_HEADERS_.indexOf('reply_status'), colSwept = EMAIL_LEDGER_HEADERS_.indexOf('swept_at');
  const first = rows[0].rowNo;
  const block = rows.map(function (r) { return [r.bounce_status, r.reply_status, r.swept_at]; }); // unchanged rows keep what they had
  const indexByRowNo = {};
  rows.forEach(function (r, i) { indexByRowNo[r.rowNo] = i; });

  due.forEach(function (r) {
    if (Date.now() - started > budgetMs) { summary.unswept++; return; }
    summary.checked++;
    const bounce = emailSweepMatchBounceGs_(r, bounces);
    const bounceStatus = bounce ? 'BOUNCED ' + emailSweepStampGs_(bounce.at) : (state.bounceSearchFailed ? 'UNKNOWN (the bounce search failed)' : 'NO_BOUNCE_SEEN');
    if (bounce) {
      summary.bounced++;
      if (!/^BOUNCED/.test(String(r.bounce_status || ''))) summary.newBounces.push(r);
    }
    let replyStatus = 'NO_REPLY_SEEN';
    if (r.thread_id) {
      if (!(r.thread_id in threadCache)) threadCache[r.thread_id] = emailSweepFetchThreadGs_(r.thread_id);
      const messages = threadCache[r.thread_id];
      if (messages === null) replyStatus = 'UNKNOWN (the thread could not be read)';
      else {
        const rep = emailSweepRepliesGs_(r, messages, own);
        if (rep.count) { replyStatus = 'REPLIED ' + rep.count + ' (latest ' + emailSweepStampGs_(rep.latest) + ')'; summary.replied++; }
      }
    } else {
      replyStatus = 'UNKNOWN (no thread id recorded)';
    }
    block[indexByRowNo[r.rowNo]] = [bounceStatus, replyStatus, stamp];
  });

  writeUnlessTestModeGs_(function () {
    sheet.getRange(first, colBounce + 1, block.length, 3).setValues(block);
  }, 'write the bounce/reply sweep to Email_Ledger');

  if (summary.newBounces.length) {
    notifyOpsAlertGs_('Email BOUNCED - ' + summary.newBounces.length + ' email(s) did not reach their recipient', [
      'The sweep found a delivery-failure message for ' + summary.newBounces.length + ' email(s) that Gmail had accepted. The recipient did NOT get them:',
      ''
    ].concat(summary.newBounces.map(function (r) {
      return '- ' + (EMAIL_LEDGER_JOB_LABELS_[r.job] || r.job) + ' | ' + r.region + ' | ' + (r.bucket_label || '(no bucket)') + ' | to ' + r.to + (r.cc ? ' (cc ' + r.cc + ')' : '') + ' | sent ' + emailSweepStampGs_(r.finished_at) + ' | leads ' + r.leads_sent;
    })).concat(['', 'Fix the address in RM_Hierarchy / Manager_Directory, then send the missing email by hand - nothing re-sends it automatically.']), { severity: 'HIGH' });
  }
  Logger.log('Email sweep: checked ' + summary.checked + ', bounced ' + summary.bounced + ' (' + summary.newBounces.length + ' new), replied ' + summary.replied + ', unswept ' + summary.unswept + (state.errors.length ? ', errors: ' + state.errors.join('; ') : ''));
  return summary;
}

// Trigger entry point: the run record (so the watchdog sees it) but deliberately NOT the script-wide job lock - a nearMinute trigger can fire up to 15 minutes either
// side of its minute, and holding the lock near 17:00 could make the 17:00 job skip its own send. The sweep only reads Gmail and writes the ledger's three sweep
// columns, which no send ever touches. A crash alerts ops at once and re-throws.
function sweepEmailBouncesAndReplies() {
  runEmailJobTrackedGs_(EMAIL_SWEEP_JOB_, function () {
    try {
      sweepEmailBouncesAndReplies_();
    } catch (e) {
      notifyOpsAlertGs_('sweepEmailBouncesAndReplies crashed - bounces and replies were NOT checked', ['Error: ' + (e && e.stack ? e.stack : e)], { immediate: true });
      throw e;
    }
  });
}

function sweepEmailBouncesAndRepliesNow() { sweepEmailBouncesAndReplies(); }

// One-time setup - ONE daily trigger near 15:45 IST. Safe to re-run: deletes its own earlier trigger first.
function setupEmailSweepTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sweepEmailBouncesAndReplies') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sweepEmailBouncesAndReplies')
    .timeBased()
    .atHour(EMAIL_SWEEP_HOUR_)
    .nearMinute(EMAIL_SWEEP_MINUTE_)
    .everyDays(1)
    .inTimezone('Asia/Kolkata')
    .create();
  Logger.log('Email bounce/reply sweep trigger installed - runs daily near ' + EMAIL_SWEEP_HOUR_ + ':' + pad2Gs_(EMAIL_SWEEP_MINUTE_) + ' IST.');
}
