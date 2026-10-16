/**
 * EmailSweep.gs - bounces and replies for the emails the ledger recorded (Email Operations System, parts EO-5 and EO-13).
 * Plan: docs/_planning/EMAIL_OPS_SYSTEM_AUDIT.md (gap G5; spec phase 16 "Reply, bounce, and engagement monitoring"; decision D9 for the bounce escalation).
 *
 * WHAT IT DOES. It looks at the bucket emails of the last 3 days that Gmail ACCEPTED and fills the three evidence columns the ledger keeps for this (bounce_status,
 * reply_status, swept_at):
 *   - BOUNCES: Gmail search for delivery-status messages from mailer-daemon / postmaster; a bounce is matched to an email only when it names one of
 *     that email's recipients (including an address a re-route redirected it to, EmailReroute.gs) AND (quotes its subject, or arrived within 15 minutes of the send).
 *   - REPLIES: the Gmail thread the email went into (its thread_id); any message after the send from someone other than the sending account.
 * WHEN. Four times a day (decision D9: "check after every email"): bounce-only runs 30 minutes after the 10:00, 13:00 and 17:00 emails (10:30, 13:30, 17:30) and the full
 * bounce + reply sweep at 15:30, before the 16:30 cycle report. A bounce-only run touches nothing but bounce_status.
 * A bounce is raised as an ops alert (it means a manager did NOT get the email) and handed to EmailReroute.gs, which sends the email - and everything after it - to the person
 * next in the hierarchy (decision D9).
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
  if (typeof showEmailReroutesNow === 'function') showEmailReroutesNow();
}

const EMAIL_SWEEP_JOB_ = 'sweepEmailBouncesAndReplies';
const EMAIL_SWEEP_HOUR_ = 15;   // IST - the full sweep, before the 16:30 cycle report (a nearMinute trigger fires up to 15 minutes either side of its minute)
const EMAIL_SWEEP_MINUTE_ = 30; // IST
// The bounce-only checks that follow each email job (decision D9). `fn` is the trigger handler, `job` the run-record / watchdog name, `after` the job it follows.
const EMAIL_SWEEP_SLOTS_ = [
  { fn: 'sweepBouncesAfterMorning', job: 'sweepBouncesAfterMorning', hour: 10, minute: 30, after: 'after the 10:00 emails' },
  { fn: 'sweepBouncesAfterFollowup', job: 'sweepBouncesAfterFollowup', hour: 13, minute: 30, after: 'after the 13:00 replies' },
  { fn: 'sweepBouncesAfterAllIssues', job: 'sweepBouncesAfterAllIssues', hour: 17, minute: 30, after: 'after the 17:00 emails' },
];
const EMAIL_SWEEP_LOOKBACK_DAYS_ = 3;
const EMAIL_SWEEP_MIN_AGE_MINUTES_ = 10; // a bounce arrives within minutes; a clean result is only ever "no bounce seen", and the next check looks again
const EMAIL_SWEEP_MAX_RUN_MS_ = 270000;  // stop after 4.5 minutes; what is left is swept next time
const EMAIL_SWEEP_BOUNCE_QUERY_ = 'from:(mailer-daemon OR postmaster) newer_than:3d';
const EMAIL_SWEEP_BOUNCE_MAX_THREADS_ = 100;
const EMAIL_SWEEP_QUICK_BOUNCE_MS_ = 15 * 60 * 1000; // a bounce this soon after a send is attributed to it even if it does not quote the subject
const EMAIL_SWEEP_OWN_NAME_ = 'homesfy lead ops'; // the display name every send uses (sendGuardedEmailGs_) - how our own messages are told apart

// ---- pure helpers ----

function emailSweepAddressesGs_(text) {
  return String(text || '').split(',').map(function (a) { return a.trim().toLowerCase(); }).filter(Boolean);
}

// Does `text` name `address` as a whole address? ER-3 (audit 2026-10-13): a plain indexOf found "raj@x.test" inside "suraj@x.test", so the wrong person got a 14-day
// re-route and a re-send. The match must not be preceded by an address character, nor followed by one (or by a dot that continues the domain). Case-insensitive. Pure.
function emailSweepTextNamesAddressGs_(text, address) {
  const a = String(address == null ? '' : address).trim().toLowerCase();
  if (!a) return false;
  const t = String(text == null ? '' : text).toLowerCase();
  for (let i = t.indexOf(a); i !== -1; i = t.indexOf(a, i + 1)) {
    const before = i > 0 ? t.charAt(i - 1) : '', after = t.charAt(i + a.length), next = t.charAt(i + a.length + 1);
    if (/[a-z0-9._%+\-]/.test(before)) continue;
    if (/[a-z0-9_%+\-]/.test(after) || (after === '.' && /[a-z0-9\-]/.test(next))) continue;
    return true;
  }
  return false;
}

// The addresses a delivery-failure message itself reports as failed - its "Final-Recipient: rfc822; addr" lines and Gmail's "wasn't delivered to addr" text - lower-cased,
// or [] when it states none that way. ER-1 (audit 2026-10-13): when it does, only those count as bounced, so an address that is merely quoted in the returned original (its
// To/Cc headers) is not taken for a dead one. A real Gmail bounce (checked 2026-10-10) states both. Pure.
const EMAIL_SWEEP_FAILED_ADDRESS_RES_ = [
  /final-recipient:\s*rfc822\s*;\s*<?([a-z0-9._%+\-]+@[a-z0-9\-]+(?:\.[a-z0-9\-]+)+)/g,
  /(?:wasn't|wasn’t|was not) delivered to\s+<?([a-z0-9._%+\-]+@[a-z0-9\-]+(?:\.[a-z0-9\-]+)+)/g,
];
function emailSweepBounceFailedAddressesGs_(text) {
  const t = String(text == null ? '' : text).toLowerCase();
  const out = [];
  EMAIL_SWEEP_FAILED_ADDRESS_RES_.forEach(function (pattern) {
    const re = new RegExp(pattern.source, 'g');
    let m;
    while ((m = re.exec(t)) !== null) { if (out.indexOf(m[1]) === -1) out.push(m[1]); }
  });
  return out;
}

// Does this bounce text name `address` as a bounced recipient? `failed` = emailSweepBounceFailedAddressesGs_(text): when the bounce states its failed addresses, only
// those count (ER-1); otherwise any whole-address mention does (ER-3). Shared with EmailReroute.gs. Pure.
function emailSweepBounceNamesGs_(text, failed, address) {
  const a = String(address == null ? '' : address).trim().toLowerCase();
  if (!a) return false;
  return failed && failed.length ? failed.indexOf(a) !== -1 : emailSweepTextNamesAddressGs_(text, a);
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
// bounce text AND (the email's subject quoted in it, or the bounce arriving within 15 minutes of the send). When several match, the EARLIEST
// (2026-10-16, O2: it used to be the first in Gmail's search order, so the recorded time could change from one sweep to the next).
function emailSweepMatchBounceGs_(row, bounces, extraRecipients) {
  const finished = row.finished_at instanceof Date ? row.finished_at.getTime() : NaN;
  if (isNaN(finished)) return null;
  // extraRecipients: the addresses the email REALLY went to when a re-route redirected it (EmailReroute.gs) - a bounce names those, not the planned ones.
  const recipients = emailSweepAddressesGs_(row.to).concat(emailSweepAddressesGs_(row.cc)).concat(extraRecipients || []);
  const subj = emailSweepRowSubjectGs_(row);
  let best = null;
  for (let i = 0; i < bounces.length; i++) {
    const b = bounces[i];
    const at = b.at instanceof Date ? b.at.getTime() : NaN;
    if (isNaN(at) || at < finished - 60000 || at > finished + 24 * 3600 * 1000) continue;
    const text = (String(b.subject || '') + '\n' + String(b.body || '')).toLowerCase().replace(/\s+/g, ' ');
    const failed = emailSweepBounceFailedAddressesGs_(text);
    if (!recipients.some(function (a) { return emailSweepBounceNamesGs_(text, failed, a); })) continue;
    if (((subj && emailSweepQuotesSubjectGs_(text, subj)) || at - finished <= EMAIL_SWEEP_QUICK_BOUNCE_MS_) && (!best || at < best.at.getTime())) best = b;
  }
  return best;
}

// The subject a bounce of this row's email quotes (lower case, whitespace collapsed, first 50 characters). The 13:00 row stores the 10:00
// subject it replies to (OvernightEmailer.gs), but the reply went out as "Re: <that subject>" - that is what its bounce quotes.
function emailSweepRowSubjectGs_(row) {
  let s = String(row.subject || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (s && row.job === EMAIL_LEDGER_JOB_FOLLOWUP_ && s.indexOf('re: ') !== 0) s = 're: ' + s;
  return s.slice(0, 50);
}

// Does the (normalised) bounce text quote `subj`? D3 guard (2026-10-16, once D4 gave the 10:00 rows a subject): an occurrence preceded by
// "re: " is the bounce of a REPLY in the same thread (the 13:00 follow-up), not of this email - unless this row's own subject is the "re: " one.
function emailSweepQuotesSubjectGs_(text, subj) {
  for (let k = text.indexOf(subj); k !== -1; k = text.indexOf(subj, k + 1)) {
    if (text.slice(Math.max(0, k - 4), k) !== 're: ') return true;
  }
  return false;
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
    // ES-4 (audit 2026-10-13): a full page means older bounce threads may be missing from this read - an earlier BOUNCED record must not be lost to that.
    if (threads.length >= EMAIL_SWEEP_BOUNCE_MAX_THREADS_) {
      state.bounceSearchCapped = true;
      Logger.log('Email sweep: the bounce search returned its cap of ' + EMAIL_SWEEP_BOUNCE_MAX_THREADS_ + ' threads - older bounces may not have been read; recorded bounces are kept.');
    }
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

// True when the first or last of `rows` (as read, each with its rowNo) no longer holds the same email_id - the rows moved since they were read (ES-2). A failed read
// counts as moved: writing blind is what this guards against.
function emailSweepBlockMovedGs_(sheet, rows) {
  try {
    return [rows[0], rows[rows.length - 1]].some(function (r) { return String(sheet.getRange(r.rowNo, 1, 1, 1).getValue()).trim() !== String(r.email_id).trim(); });
  } catch (e) {
    return true;
  }
}

// The sweep. opts.now / opts.maxRunMs (tests); opts.bouncesOnly (the checks after each email job): look for bounces only - the reply columns and swept_at are left as they were.
// Returns { checked, bounced, replied, newBounces: [row], unswept, errors, reroutes: { emailId: { action, text } } }.
function sweepEmailBouncesAndReplies_(opts) {
  const o = opts || {};
  const now = o.now || new Date();
  const started = Date.now();
  const budgetMs = o.maxRunMs === undefined ? EMAIL_SWEEP_MAX_RUN_MS_ : o.maxRunMs; // (tests shrink it)
  const bouncesOnly = !!o.bouncesOnly;
  const state = { errors: [], bounceSearchFailed: false, bounceSearchCapped: false };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(EMAIL_LEDGER_SHEET_);
  const summary = { checked: 0, bounced: 0, replied: 0, newBounces: [], unswept: 0, errors: state.errors, reroutes: {} };
  if (!sheet || sheet.getLastRow() < 2) { Logger.log('Email sweep: no Email_Ledger rows yet - nothing to do.'); return summary; }

  const rows = emailSweepReadRowsGs_(sheet, now);
  const due = rows.filter(function (r) { return emailSweepIsCandidateGs_(r, now); });
  if (!due.length) { Logger.log('Email sweep: no accepted email is old enough (or recent enough) to sweep.'); return summary; }

  const bounces = emailSweepFetchBouncesGs_(state);
  const own = bouncesOnly ? '' : emailSweepOwnAddressGs_();
  // The rows of EmailReroute.gs (all of them, expired too): which address an email REALLY went to when it was redirected. Fail-open: unreadable = no extra recipients.
  let rerouteEntries = [];
  if (typeof emailRerouteReadEntriesGs_ === 'function') {
    try { rerouteEntries = emailRerouteReadEntriesGs_(ss); } catch (re) { state.errors.push('re-routes: ' + String((re && re.message) || re)); }
  }
  const bouncedItems = []; // every ledger row matched to a bounce, new or old - EmailReroute.gs acts on each (idempotently)
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
    const bounce = emailSweepMatchBounceGs_(r, bounces, typeof emailRerouteEffectiveAddressesGs_ === 'function' ? emailRerouteEffectiveAddressesGs_(r, rerouteEntries) : []);
    let bounceStatus = bounce ? 'BOUNCED ' + emailSweepStampGs_(bounce.at) : (state.bounceSearchFailed ? 'UNKNOWN (the bounce search failed)' : 'NO_BOUNCE_SEEN');
    // O2 (2026-10-16): an already-recorded EARLIER bounce time is never replaced by a later one (e.g. the first notice has dropped out of the search).
    const recorded = /^BOUNCED (\d{4}-\d{2}-\d{2} \d{2}:\d{2})/.exec(String(r.bounce_status || ''));
    if (bounce && recorded && recorded[1] < bounceStatus.slice(8)) bounceStatus = String(r.bounce_status);
    // ES-1 / ES-4 (audit 2026-10-13): a failed or capped search is no evidence that a recorded bounce went away - overwriting it hid the bounce from the report,
    // checklist J and the tracker. It is kept (and still counted); its re-route is retried by the next check that reads the bounce message again.
    if (!bounce && /^BOUNCED/.test(String(r.bounce_status || '')) && (state.bounceSearchFailed || state.bounceSearchCapped)) {
      bounceStatus = String(r.bounce_status);
      summary.bounced++;
    }
    if (bounce) {
      summary.bounced++;
      bouncedItems.push({ row: r, bounce: bounce });
      if (!/^BOUNCED/.test(String(r.bounce_status || ''))) summary.newBounces.push(r);
    }
    if (bouncesOnly) { block[indexByRowNo[r.rowNo]] = [bounceStatus, r.reply_status, r.swept_at]; return; } // bounce-only: the reply columns and swept_at stay as they were
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

  // ES-2 (audit 2026-10-13): the sweep takes no job lock, and the 17:00 job's ledger prune deletes LEADING rows - between the read above and this write every value
  // would then land on the wrong row. The ids at both ends of the block are read again; if either moved, nothing is written (nor re-routed or alerted) this run - the
  // next check redoes it all from a fresh read.
  if (emailSweepBlockMovedGs_(sheet, rows)) {
    summary.writeSkipped = true;
    state.errors.push('the ledger rows moved while the sweep ran (a prune?) - nothing written; the next check redoes it');
    Logger.log('Email sweep: the ledger rows moved while the sweep ran - nothing written this run; the next check redoes it.');
    return summary;
  }
  writeUnlessTestModeGs_(function () {
    sheet.getRange(first, colBounce + 1, block.length, 3).setValues(block);
  }, 'write the bounce/reply sweep to Email_Ledger');

  // Decision D9 (EmailReroute.gs): the bounced address is replaced by the person next in the hierarchy (the ops address when nobody is above), and a bounced To email is re-sent to
  // them once. Runs AFTER the statuses are written, so a failure here never loses the bounce record; the next check retries whatever did not finish.
  const reroutable = typeof emailRerouteHandleBouncesGs_ === 'function';
  if (reroutable && bouncedItems.length) {
    try { summary.reroutes = emailRerouteHandleBouncesGs_(ss, bouncedItems, rows, now); } catch (hre) { state.errors.push('re-route: ' + String((hre && hre.message) || hre)); }
  }

  if (summary.newBounces.length) {
    notifyOpsAlertGs_('Email BOUNCED - ' + summary.newBounces.length + ' email(s) did not reach their recipient', [
      'The sweep found a delivery-failure message for ' + summary.newBounces.length + ' email(s) that Gmail had accepted. The recipient did NOT get them:',
      ''
    ].concat(summary.newBounces.map(function (r) {
      const out = summary.reroutes[r.email_id];
      return '- ' + (EMAIL_LEDGER_JOB_LABELS_[r.job] || r.job) + ' | ' + r.region + ' | ' + (r.bucket_label || '(no bucket)') + ' | to ' + r.to + (r.cc ? ' (cc ' + r.cc + ')' : '') + ' | sent ' + emailSweepStampGs_(r.finished_at) + ' | leads ' + r.leads_sent +
        (out ? '\n    => ' + out.text : '');
    })).concat(['', reroutable
      ? 'Fix the address in Manager_Directory (or RM_Hierarchy). Until then every later email to a bounced address goes to the person next in the hierarchy (the ops address when nobody is above) - see the Email_Reroutes tab; the address is tried again after ' + EMAIL_REROUTE_DAYS_ + ' days.'
      : 'Fix the address in RM_Hierarchy / Manager_Directory, then send the missing email by hand - nothing re-sends it automatically.']), { severity: 'HIGH' });
  }
  Logger.log('Email sweep: checked ' + summary.checked + ', bounced ' + summary.bounced + ' (' + summary.newBounces.length + ' new), replied ' + summary.replied + ', unswept ' + summary.unswept + (state.errors.length ? ', errors: ' + state.errors.join('; ') : ''));
  return summary;
}

// Trigger entry point: the run record (so the watchdog sees it) but deliberately NOT the script-wide job lock for the run - a nearMinute trigger can fire up to 15 minutes
// either side of its minute, and holding the lock near 17:00 could make the 17:00 job skip its own send. It DOES overlap the email jobs (ES-2/ES-3, audit 2026-10-13 -
// the old "nothing overlaps" note was wrong): the 17:00 job's prune deletes leading ledger rows, so the sweep re-checks its rows before writing them back
// (emailSweepBlockMovedGs_); and a bounce re-send appends to Email_Ledger like the jobs do, so EmailReroute.gs takes the script lock briefly (tryLock, a few seconds) around
// each re-send and leaves it to the next check when a job holds it. A crash alerts ops at once and re-throws.
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

// The bounce-only checks (decision D9): same sweep, bounce_status only, 30 minutes after each email job. Same run-record / no-lock rules as the full sweep.
function emailSweepBouncesOnlyRunGs_(slot) {
  runEmailJobTrackedGs_(slot.job, function () {
    try {
      sweepEmailBouncesAndReplies_({ bouncesOnly: true });
    } catch (e) {
      notifyOpsAlertGs_(slot.fn + ' crashed - bounces were NOT checked (' + slot.after + ')', ['Error: ' + (e && e.stack ? e.stack : e)], { immediate: true });
      throw e;
    }
  });
}
function sweepBouncesAfterMorning() { emailSweepBouncesOnlyRunGs_(EMAIL_SWEEP_SLOTS_[0]); }
function sweepBouncesAfterFollowup() { emailSweepBouncesOnlyRunGs_(EMAIL_SWEEP_SLOTS_[1]); }
function sweepBouncesAfterAllIssues() { emailSweepBouncesOnlyRunGs_(EMAIL_SWEEP_SLOTS_[2]); }

// One-time setup - FOUR daily triggers: the full sweep near 15:30 IST and the bounce-only checks near 10:30, 13:30 and 17:30. Safe to re-run: deletes its own earlier triggers first
// (the old 15:45 trigger included).
function setupEmailSweepTrigger() {
  const handlers = ['sweepEmailBouncesAndReplies'].concat(EMAIL_SWEEP_SLOTS_.map(function (s) { return s.fn; }));
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (handlers.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
  const make = function (fn, hour, minute) {
    ScriptApp.newTrigger(fn).timeBased().atHour(hour).nearMinute(minute).everyDays(1).inTimezone('Asia/Kolkata').create();
  };
  make('sweepEmailBouncesAndReplies', EMAIL_SWEEP_HOUR_, EMAIL_SWEEP_MINUTE_);
  EMAIL_SWEEP_SLOTS_.forEach(function (s) { make(s.fn, s.hour, s.minute); });
  Logger.log('Email bounce checks installed - the full sweep daily near ' + pad2Gs_(EMAIL_SWEEP_HOUR_) + ':' + pad2Gs_(EMAIL_SWEEP_MINUTE_) + ' IST, bounce-only checks near ' +
    EMAIL_SWEEP_SLOTS_.map(function (s) { return pad2Gs_(s.hour) + ':' + pad2Gs_(s.minute); }).join(', ') + ' IST.');
}
