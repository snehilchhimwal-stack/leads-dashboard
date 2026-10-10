/**
 * EmailReroute.gs - bounce escalation (Email Operations System, part EO-13; decision D9, 2026-10-10).
 * Plan: docs/_planning/EMAIL_OPS_SYSTEM_AUDIT.md (section 0, "D9 design").
 *
 * THE RULE (decision D9). When an email bounces, it goes to the person next in the hierarchy - and if nobody is above, to Snehil. That covers the bounced email
 * itself AND that bucket's later follow-ups (the 10:00 Checkpoint 1, the 13:00 reply, the next day's 17:00 email).
 *
 * HOW. One redirect at the one choke point: the bounce sweep (EmailSweep.gs) records the dead address in the Email_Reroutes tab together with its replacement, and
 * sendGuardedEmailGs_ / sendThreadedGmailReply_ (EmailInfra.gs / OvernightEmailer.gs) - the only two functions that put a report email on the wire - swap a dead address
 * for its replacement just before the safety gate (emailRerouteApplyGs_). Nothing upstream changes: AllIssues_Log, Overnight_Log and the ledger keep the ORIGINAL address,
 * so the audits, the follow-up tracker and every "already sent today" guard see exactly what they saw before. The replacement's copy opens with a banner saying whom the
 * email was meant for and why it came to them. The bounced email itself is re-sent from its own Gmail message (emailRerouteResendGs_), once, inside the original job's
 * late-send window (decision D5), and recorded as its own ledger row (job 'reroute', id 'RR|<original email id>').
 *
 * WHO IS NEXT (emailRerouteNextGs_). From the dead person's own RM_Hierarchy row: TL, TM, RH, CH - the first one that has an email in Manager_Directory. Nobody above
 * (or no email) means the ops address (Snehil) for a To address; a dead Cc address is simply dropped (the person above is normally in Cc already, and Snehil is not added to
 * other people's mail). A replacement that bounces too gets its own row, so the chain climbs one level per bounce and ends at Snehil; a loop cannot form (every step goes up)
 * and the walk is capped anyway.
 *
 * HOW LONG. A row lasts 14 days (EMAIL_REROUTE_DAYS_): a transient bounce (a full mailbox) heals by itself, and a dead address is retried then - one more bounce, one more row.
 * A row also stops mattering the moment Manager_Directory holds a different address for that person. endAllEmailReroutesNow() ends every row by hand.
 *
 * FAIL-OPEN, like the rest of the evidence trail: any problem here leaves the email going to its ORIGINAL address, exactly as before this file existed. TEST MODE never
 * redirects, records or re-sends. Nothing here claims delivery - a re-sent copy is "accepted by Gmail" and is itself checked for a bounce by the next sweep.
 */

// Read-only helper FIRST in the file (the editor's Run button has run the previously selected function before - see HANDOVER).
// Logs the re-routes that apply right now. Writes nothing, sends nothing.
function showEmailReroutesNow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const now = new Date();
  const entries = emailRerouteReadEntriesGs_(ss);
  const active = entries.filter(function (e) { return emailRerouteIsActiveGs_(e, now.getTime()); });
  Logger.log('Email_Reroutes: ' + entries.length + ' row(s), ' + active.length + ' in force now.');
  active.forEach(function (e) {
    Logger.log(e.dead_email + (e.dead_name ? ' (' + e.dead_name + ')' : '') + ' -> ' + e.new_email + ' (' + e.new_name + (e.new_role ? ', ' + e.new_role : '') + ', ' + e.via + ') since ' +
      Utilities.formatDate(e.created_at, 'Asia/Kolkata', 'd MMM HH:mm') + ' IST, until ' + Utilities.formatDate(e.expires_at, 'Asia/Kolkata', 'd MMM') + (e.note ? ' [' + e.note + ']' : ''));
  });
}

const EMAIL_REROUTE_SHEET_ = 'Email_Reroutes';
const EMAIL_REROUTE_HEADERS_ = ['created_at', 'expires_at', 'dead_email', 'dead_name', 'new_email', 'new_name', 'new_role', 'via', 'source_email_id', 'source_job', 'status', 'note'];
const EMAIL_REROUTE_DAYS_ = 14;               // how long a dead address stays redirected before it is tried again
const EMAIL_REROUTE_MAX_HOPS_ = 6;            // a chain of replacements is followed at most this far (a loop falls back to the original address)
const EMAIL_REROUTE_CACHE_MS_ = 120000;       // the table is read once per two minutes of a run, not once per email
const EMAIL_REROUTE_RESEND_MAX_HOURS_ = 3;    // a re-sent copy that bounces again has no late-send cutoff of its own: it is re-sent only within this long of its own send
const EMAIL_REROUTE_JOB_ = 'reroute';         // the ledger job of a re-sent copy
const EMAIL_REROUTE_VIA_HIERARCHY_ = 'hierarchy';
const EMAIL_REROUTE_VIA_OPS_ = 'ops fallback';

let EMAIL_REROUTE_CACHE_ = null; // { key, at, entries } - the table as read, per run
let EMAIL_REROUTE_NOTE_ = '';    // what the last send was redirected from/to; the ledger writes it into the row's status_reason (emailRerouteTakeNoteGs_)

// ---- pure helpers ----

function emailRerouteLowerGs_(s) { return String(s == null ? '' : s).trim().toLowerCase(); }

// "a@x, b@y" or ['a@x', 'b@y'] -> ['a@x', 'b@y'] (trimmed, blanks dropped, original case kept).
function emailRerouteSplitGs_(list) {
  const raw = Array.isArray(list) ? list.join(',') : String(list == null ? '' : list);
  return raw.split(/[,;]/).map(function (a) { return a.trim(); }).filter(Boolean);
}

function emailRerouteTitleGs_(lowerName) {
  return String(lowerName || '').replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); });
}

function emailRerouteDateGs_(v) {
  if (v instanceof Date) return v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

// Is this table row in force at atMs? ACTIVE, already created, not yet expired.
function emailRerouteIsActiveGs_(e, atMs) {
  if (!e || String(e.status || '').trim() !== 'ACTIVE') return false;
  const created = emailRerouteDateGs_(e.created_at), expires = emailRerouteDateGs_(e.expires_at);
  if (!created || !expires) return false;
  return created.getTime() <= atMs && expires.getTime() > atMs;
}

// { deadAddressLowerCase: row } for the rows in force at atMs (the newest wins when two rows name the same address).
function emailRerouteMapGs_(entries, atMs) {
  const map = {};
  (entries || []).forEach(function (e) {
    if (!emailRerouteIsActiveGs_(e, atMs)) return;
    const k = emailRerouteLowerGs_(e.dead_email);
    if (k && emailRerouteLowerGs_(e.new_email)) map[k] = e;
  });
  return map;
}

// Follows the replacement chain from one address. Returns { address, changed, entry (the last hop's row), viaOps (the chain ends at the ops fallback) }. A loop or an over-long
// chain returns the ORIGINAL address unchanged (fail-safe).
function emailRerouteResolveGs_(map, address) {
  const original = String(address == null ? '' : address).trim();
  let cur = emailRerouteLowerGs_(original);
  let last = null, hops = 0, display = original;
  const seen = {};
  while (map[cur]) {
    if (seen[cur] || hops >= EMAIL_REROUTE_MAX_HOPS_) return { address: original, changed: false, entry: null, viaOps: false };
    seen[cur] = true;
    last = map[cur];
    display = String(last.new_email).trim();
    cur = emailRerouteLowerGs_(display);
    hops++;
  }
  return { address: last ? display : original, changed: !!last && cur !== emailRerouteLowerGs_(original), entry: last, viaOps: !!last && String(last.via) === EMAIL_REROUTE_VIA_OPS_ };
}

// The recipients after the table is applied. Returns { to: [], cc: [], changes: [{ dead, final, part: 'to'|'cc', entry }] }. A Cc whose chain ends at the ops fallback is dropped
// (final ''); an address already in To is not repeated in Cc.
function emailRerouteTranslateAddressesGs_(to, cc, map) {
  const outTo = [], outCc = [], changes = [];
  const seenTo = {}, seenCc = {};
  emailRerouteSplitGs_(to).forEach(function (a) {
    const r = emailRerouteResolveGs_(map, a);
    const final = r.changed ? r.address : a;
    if (r.changed) changes.push({ dead: a, final: final, part: 'to', entry: r.entry });
    const k = emailRerouteLowerGs_(final);
    if (!seenTo[k]) { seenTo[k] = true; outTo.push(final); }
  });
  emailRerouteSplitGs_(cc).forEach(function (a) {
    const r = emailRerouteResolveGs_(map, a);
    if (r.changed && r.viaOps) { changes.push({ dead: a, final: '', part: 'cc', entry: r.entry }); return; }
    const final = r.changed ? r.address : a;
    if (r.changed) changes.push({ dead: a, final: final, part: 'cc', entry: r.entry });
    const k = emailRerouteLowerGs_(final);
    if (seenTo[k] || seenCc[k]) return;
    seenCc[k] = true;
    outCc.push(final);
  });
  return { to: outTo, cc: outCc, changes: changes };
}

// "Name <address>" or just the address.
function emailRerouteLabelGs_(name, address) {
  return name ? name + ' <' + address + '>' : String(address);
}

// The banner that opens a re-routed copy: { html, plain }. toChanges = the changes with part 'to'.
function emailRerouteBannerGs_(toChanges) {
  const parts = toChanges.map(function (c) {
    const e = c.entry || {};
    const why = String(e.via) === EMAIL_REROUTE_VIA_OPS_
      ? 'nobody above that person is on record, so it came to the ops address'
      : 'it reached you as the next person in the hierarchy' + (e.new_role ? ' (' + e.new_role + ')' : '');
    return 'This email was addressed to ' + emailRerouteLabelGs_(e.dead_name, c.dead) + ', but a delivery-failure message came back for that address - ' + why + '. Please make sure the leads below are actioned.';
  });
  const text = parts.join(' ') + ' (Ops: fix the address in Manager_Directory; until then everything for it comes to you.)';
  return {
    html: '<div style="background:#fef3c7; border:2px solid #f59e0b; border-radius:8px; padding:12px 16px; margin-bottom:14px; font-family:Arial,Helvetica,sans-serif;">' +
      '<div style="font-weight:700; color:#92400e; font-size:13px;">Re-routed to you</div>' +
      '<div style="color:#78350f; font-size:12.5px; margin-top:4px;">' + esc_(text) + '</div></div>',
    plain: 'RE-ROUTED TO YOU: ' + text + '\n\n',
  };
}

// One line for the ledger row: what this send was redirected from and to.
function emailRerouteNoteTextGs_(changes) {
  return changes.map(function (c) {
    return c.part === 'to' ? 're-routed to ' + c.final + ' (the bounced ' + c.dead + ')' : (c.final ? 'Cc ' + c.dead + ' replaced by ' + c.final : 'Cc ' + c.dead + ' dropped (bounced)');
  }).join('; ');
}

// The person to send to instead of a dead address, from the dead person's own hierarchy row. data = { byRmNameLower, emailByManagerNameLower } (loadRmHierarchyAndEmails_).
// Returns { email, name, role, via, deadName } or null when the dead address IS the ops address (nothing above it). Pure.
function emailRerouteNextGs_(data, deadEmail, nameHint, opsEmail) {
  const dead = emailRerouteLowerGs_(deadEmail), ops = emailRerouteLowerGs_(opsEmail);
  if (!dead || dead === ops) return null;
  const dir = (data && data.emailByManagerNameLower) || {}, rows = (data && data.byRmNameLower) || {};
  const hint = emailRerouteLowerGs_(nameHint);
  let names = Object.keys(dir).filter(function (k) { return emailRerouteLowerGs_(dir[k]) === dead; });
  if (hint && names.indexOf(hint) !== -1) names = [hint].concat(names.filter(function (n) { return n !== hint; }));
  const deadName = nameHint ? String(nameHint).trim() : (names[0] ? emailRerouteTitleGs_(names[0]) : '');
  for (let i = 0; i < names.length; i++) {
    const chain = rows[names[i]];
    if (!chain) continue;
    const above = [chain.tl, chain.tm, chain.rh, chain.ch];
    for (let j = 0; j < above.length; j++) {
      const m = String(above[j] || '').trim();
      if (!m) continue;
      const email = dir[m.toLowerCase()];
      if (!email || emailRerouteLowerGs_(email) === dead) continue;
      return { email: String(email).trim(), name: m, role: (rows[m.toLowerCase()] && rows[m.toLowerCase()].role) || '', via: EMAIL_REROUTE_VIA_HIERARCHY_, deadName: deadName };
    }
  }
  const opsName = Object.keys(dir).filter(function (k) { return emailRerouteLowerGs_(dir[k]) === ops; })[0];
  return { email: String(opsEmail).trim(), name: opsName ? emailRerouteTitleGs_(opsName) : 'Ops', role: 'ops', via: EMAIL_REROUTE_VIA_OPS_, deadName: deadName };
}

// Is a bounced email still inside the window in which it may be re-sent (decision D5's late-send cutoffs, on the email's OWN IST day)? A re-sent copy that bounces again
// has no cutoff of its own, so it gets EMAIL_REROUTE_RESEND_MAX_HOURS_ from its own send. Pure.
function emailRerouteWindowOpenGs_(row, now) {
  const finished = emailRerouteDateGs_(row.finished_at);
  if (!finished) return false;
  let cutoff = null;
  if (row.job === EMAIL_LEDGER_JOB_ALL_ISSUES_) cutoff = [ALL_ISSUES_LATE_CUTOFF_HOUR_, ALL_ISSUES_LATE_CUTOFF_MINUTE_];
  else if (row.job === EMAIL_LEDGER_JOB_MORNING_) cutoff = [MORNING_LATE_CUTOFF_HOUR_, MORNING_LATE_CUTOFF_MINUTE_];
  else if (row.job === EMAIL_LEDGER_JOB_FOLLOWUP_) cutoff = [FOLLOWUP_LATE_CUTOFF_HOUR_, FOLLOWUP_LATE_CUTOFF_MINUTE_];
  if (cutoff) return now.getTime() <= new Date(istDayKeyGs_(finished) + 'T' + pad2Gs_(cutoff[0]) + ':' + pad2Gs_(cutoff[1]) + ':00+05:30').getTime();
  return now.getTime() - finished.getTime() <= EMAIL_REROUTE_RESEND_MAX_HOURS_ * 3600000;
}

// The addresses an email REALLY went to (its To/Cc with the rows that were in force at its send applied) - the bounce matcher needs them, because a bounce names the address
// that received the mail, not the one the ledger planned. Returns lower-cased addresses; [] when nothing was redirected.
function emailRerouteEffectiveAddressesGs_(row, entries) {
  const at = emailRerouteDateGs_(row.finished_at);
  if (!at) return [];
  const map = emailRerouteMapGs_(entries, at.getTime());
  if (!Object.keys(map).length) return [];
  const tr = emailRerouteTranslateAddressesGs_(row.to, row.cc, map);
  if (!tr.changes.length) return [];
  return tr.to.concat(tr.cc).map(emailRerouteLowerGs_);
}

// ---- the table (Email_Reroutes) ----

function emailRerouteReadEntriesGs_(ss) {
  const sheet = ss.getSheetByName(EMAIL_REROUTE_SHEET_);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const last = sheet.getLastRow();
  return sheet.getRange(2, 1, last - 1, EMAIL_REROUTE_HEADERS_.length).getValues().map(function (r, i) {
    const o = { rowNo: i + 2 };
    EMAIL_REROUTE_HEADERS_.forEach(function (h, j) { o[h] = r[j]; });
    return o;
  });
}

function emailRerouteSsKeyGs_(ss) {
  try { return typeof ss.getId === 'function' ? String(ss.getId()) : ss; } catch (e) { return ss; }
}

function emailRerouteResetCacheGs_() { EMAIL_REROUTE_CACHE_ = null; }

// The table as of this run (read at most once per EMAIL_REROUTE_CACHE_MS_). Never throws: an unreadable table reads as empty (the emails then go to their original addresses).
function emailRerouteEntriesCachedGs_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const key = emailRerouteSsKeyGs_(ss), nowMs = new Date().getTime();
  if (EMAIL_REROUTE_CACHE_ && EMAIL_REROUTE_CACHE_.key === key && nowMs - EMAIL_REROUTE_CACHE_.at < EMAIL_REROUTE_CACHE_MS_) return EMAIL_REROUTE_CACHE_.entries;
  let entries = [];
  try { entries = emailRerouteReadEntriesGs_(ss); } catch (e) { Logger.log('Email_Reroutes could not be read - emails go to their original addresses: ' + e); }
  EMAIL_REROUTE_CACHE_ = { key: key, at: nowMs, entries: entries };
  return entries;
}

// Adds a row unless the dead address already has one in force. spec = { deadEmail, deadName, newEmail, newName, newRole, via, sourceId, sourceJob, note }.
// Returns { created: boolean, row: the row now in force }. TEST MODE writes nothing (writeUnlessTestModeGs_).
function emailRerouteRecordGs_(ss, spec, now) {
  const nowMs = now.getTime();
  const existing = emailRerouteReadEntriesGs_(ss).filter(function (e) {
    return emailRerouteIsActiveGs_(e, nowMs) && emailRerouteLowerGs_(e.dead_email) === emailRerouteLowerGs_(spec.deadEmail);
  })[0];
  if (existing) return { created: false, row: existing };
  const sheet = emailLedgerEnsureSheetGs_(ss, EMAIL_REROUTE_SHEET_, EMAIL_REROUTE_HEADERS_, [3, 5, 9]);
  const created = new Date(nowMs), expires = new Date(nowMs + EMAIL_REROUTE_DAYS_ * 24 * 3600 * 1000);
  const values = [created, expires, spec.deadEmail, spec.deadName || '', spec.newEmail, spec.newName || '', spec.newRole || '', spec.via, spec.sourceId || '', spec.sourceJob || '', 'ACTIVE', String(spec.note || '').slice(0, 300)];
  emailLedgerAppendBlockGs_(sheet, [values], function (probe) { return probe instanceof Date && probe.getTime() === created.getTime(); }, 'append Email_Reroutes row');
  emailRerouteResetCacheGs_();
  const row = {};
  EMAIL_REROUTE_HEADERS_.forEach(function (h, i) { row[h] = values[i]; });
  return { created: true, row: row };
}

// Manual: ends every row in force (the replaced addresses are used again from the next email). For when the directory was fixed in place with the SAME address, or a bounce was
// transient. Logs what it ended.
function endAllEmailReroutesNow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(EMAIL_REROUTE_SHEET_);
  if (!sheet || sheet.getLastRow() < 2) { Logger.log('Email_Reroutes: nothing to end.'); return 0; }
  const nowMs = new Date().getTime();
  let ended = 0;
  emailRerouteReadEntriesGs_(ss).forEach(function (e) {
    if (!emailRerouteIsActiveGs_(e, nowMs)) return;
    sheet.getRange(e.rowNo, EMAIL_REROUTE_HEADERS_.indexOf('status') + 1, 1, 1).setValue('ENDED');
    ended++;
  });
  emailRerouteResetCacheGs_();
  Logger.log('Email_Reroutes: ended ' + ended + ' row(s). The addresses they replaced are used again from the next email.');
  return ended;
}

// ---- the redirect (called by the two senders) ----

// msg = { to, cc, subject, plainBody, htmlBody, leadIds }. Returns the message to send: a dead address swapped for its replacement (a Cc dropped or replaced), and - when a To was
// swapped - a banner in front of the body. Returns `msg` itself, untouched, when nothing applies, in TEST MODE, or on any error (fail-open: the email goes to its original address).
function emailRerouteApplyGs_(msg) {
  try {
    if (TEST_MODE_OVERRIDE_EMAIL_ || !msg) return msg;
    const map = emailRerouteMapGs_(emailRerouteEntriesCachedGs_(), new Date().getTime());
    if (!Object.keys(map).length) return msg;
    const tr = emailRerouteTranslateAddressesGs_(msg.to, msg.cc, map);
    if (!tr.changes.length || !tr.to.length) return msg;
    const out = Object.assign({}, msg, { to: tr.to.join(','), cc: tr.cc.join(',') });
    const toChanges = tr.changes.filter(function (c) { return c.part === 'to'; });
    if (toChanges.length) {
      const banner = emailRerouteBannerGs_(toChanges);
      out.plainBody = banner.plain + String(msg.plainBody == null ? '' : msg.plainBody);
      if (msg.htmlBody !== undefined && msg.htmlBody !== null) out.htmlBody = banner.html + String(msg.htmlBody);
    }
    EMAIL_REROUTE_NOTE_ = emailRerouteNoteTextGs_(tr.changes);
    return out;
  } catch (e) {
    Logger.log('Email re-route could not be applied - this email goes to its original address: ' + e);
    return msg;
  }
}

// The ledger asks for the note when a send ends (and clears it when the next one starts), so a row records that its email was redirected.
function emailRerouteTakeNoteGs_() {
  const note = EMAIL_REROUTE_NOTE_;
  EMAIL_REROUTE_NOTE_ = '';
  return note;
}
function emailRerouteClearNoteGs_() { EMAIL_REROUTE_NOTE_ = ''; }

// ---- after a bounce (called by the sweep) ----

function emailRerouteHierarchyGs_(ss) { return loadRmHierarchyAndEmails_(ss); }

// Re-sends a bounced email from its own Gmail message to the replacement, once. The redirect itself is done by sendGuardedEmailGs_ (the row for the dead address must already be
// in force). Returns { ok, text }.
function emailRerouteResendGs_(ss, row, now) {
  const emailId = 'RR|' + row.email_id;
  let original;
  try {
    original = GmailApp.getMessageById(row.message_id);
    if (!original) throw new Error('no such message');
  } catch (e) {
    return { ok: false, text: 'NOT re-sent: the original Gmail message (' + row.message_id + ') could not be read - ' + String((e && e.message) || e) };
  }
  let html, plain;
  try { html = original.getBody(); plain = original.getPlainBody(); } catch (e2) { return { ok: false, text: 'NOT re-sent: the original message could not be read - ' + String((e2 && e2.message) || e2) }; }
  if (!String(plain || '').trim() && !String(html || '').trim()) return { ok: false, text: 'NOT re-sent: the original message has no body' };

  const map = emailRerouteMapGs_(emailRerouteReadEntriesGs_(ss), now.getTime());
  const tr = emailRerouteTranslateAddressesGs_(row.to, row.cc, map);
  if (!tr.changes.some(function (c) { return c.part === 'to'; })) return { ok: false, text: 'NOT re-sent: no re-route is in force for ' + row.to };
  let leadIds = [];
  try { leadIds = JSON.parse(row.lead_ids_json || '[]'); } catch (e3) { leadIds = []; }
  leadIds = (Array.isArray(leadIds) ? leadIds : []).map(String).filter(Boolean);
  const subject = String(row.subject || (original.getSubject && original.getSubject()) || '');

  const h = emailLedgerOpenGs_(ss);
  const meta = {
    emailId: emailId, job: EMAIL_REROUTE_JOB_, dayKey: istDayKeyGs_(now), region: row.region, bucketLabel: row.bucket_label, primaryRole: row.primary_role,
    to: tr.to.join(','), cc: tr.cc.join(','), subject: subject, leadIds: leadIds,
  };
  try {
    emailLedgerTrackSendGs_(h, meta, function () {
      return sendGuardedEmailGs_({ to: row.to, cc: row.cc, subject: subject, plainBody: plain, htmlBody: html, leadIds: leadIds.length ? leadIds : undefined }, 'send re-routed copy (' + row.region + ' / ' + (row.bucket_label || row.to) + ')');
    });
  } catch (e4) {
    return { ok: false, text: 're-send to ' + tr.to.join(',') + ' FAILED - ' + String((e4 && e4.message) || e4) };
  } finally {
    emailLedgerFinishGs_(h, 'the bounce re-route');
  }
  return { ok: true, text: 're-sent to ' + tr.to.join(',') + ' at ' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'HH:mm') + ' IST' };
}

// items = [{ row (a ledger row object), bounce ({ at, subject, body }) }] - every ledger row the sweep matched to a bounce, new or old. ledgerRows = the rows the sweep read (they
// include earlier re-sent copies). Records a row for each bounced address (once), and re-sends each bounced To email once while its window is open. Idempotent: the sweep calls
// it on every run, so a step that failed (the hierarchy could not be read, a send failed) is retried until the window closes. Returns { emailId: { action, text } }.
function emailRerouteHandleBouncesGs_(ss, items, ledgerRows, now) {
  const outcomes = {};
  if (!items || !items.length) return outcomes;
  const set = function (row, action, text) { outcomes[row.email_id] = { action: action, text: text }; };
  if (TEST_MODE_OVERRIDE_EMAIL_) { items.forEach(function (it) { set(it.row, 'TEST_MODE', 'TEST MODE: nothing is re-routed'); }); return outcomes; }

  const opsEmail = opsAlertEmailGs_();
  let entries = emailRerouteReadEntriesGs_(ss);
  const rrById = {};
  (ledgerRows || []).forEach(function (r) { if (r.job === EMAIL_REROUTE_JOB_) rrById[r.email_id] = r; });
  let hier = null, hierError = '';
  const loadHier = function () {
    if (hier || hierError) return hier;
    try { hier = emailRerouteHierarchyGs_(ss); } catch (e) { hierError = String((e && e.message) || e); }
    return hier;
  };

  items.forEach(function (it) {
    const row = it.row, bounce = it.bounce;
    try {
      if (row.job === EMAIL_LEDGER_JOB_CH_OVERNIGHT_ || row.job === EMAIL_LEDGER_JOB_CH_ISSUES_) { set(row, 'OPS_REPORT', 'a CH-level report (it goes to the ops address) - nothing to re-route'); return; }
      const finished = emailRerouteDateGs_(row.finished_at);
      if (!finished) { set(row, 'NONE', 'no send time recorded - nothing re-routed'); return; }
      // who the email really went to, and which of them the bounce names
      const sent = emailRerouteTranslateAddressesGs_(row.to, row.cc, emailRerouteMapGs_(entries, finished.getTime()));
      const text = (String(bounce.subject || '') + '\n' + String(bounce.body || '')).toLowerCase().replace(/\s+/g, ' ');
      const named = {};
      sent.to.forEach(function (a) { if (text.indexOf(a.toLowerCase()) !== -1) named[a.toLowerCase()] = 'to'; });
      sent.cc.forEach(function (a) { if (text.indexOf(a.toLowerCase()) !== -1 && !named[a.toLowerCase()]) named[a.toLowerCase()] = 'cc'; });
      const bounced = Object.keys(named).filter(function (a) { return a !== emailRerouteLowerGs_(opsEmail); });
      if (!bounced.length) { set(row, 'NONE', 'the bounce names only the ops address - nothing to re-route'); return; }

      // a row for every bounced address that has none in force
      let hierFailed = false;
      bounced.forEach(function (a) {
        if (emailRerouteMapGs_(entries, now.getTime())[a]) return;
        const h = loadHier();
        if (!h) { hierFailed = true; return; }
        const hint = row.job === EMAIL_LEDGER_JOB_ALL_ISSUES_ && emailRerouteLowerGs_(row.to) === a ? row.bucket_label : '';
        const next = emailRerouteNextGs_(h, a, hint, opsEmail);
        if (!next) return;
        emailRerouteRecordGs_(ss, { deadEmail: a, deadName: next.deadName, newEmail: next.email, newName: next.name, newRole: next.role, via: next.via, sourceId: row.email_id, sourceJob: row.job, note: named[a] === 'cc' ? 'cc only' : '' }, now);
        entries = emailRerouteReadEntriesGs_(ss);
      });
      if (hierFailed) { set(row, 'ERROR', 'no re-route made yet: the hierarchy could not be read (' + hierError + ') - the next check retries'); return; }

      const toBounced = bounced.filter(function (a) { return named[a] === 'to'; });
      if (!toBounced.length) { set(row, 'CC_ONLY', 'only a Cc address bounced (' + bounced.join(', ') + ') - the To recipient did receive it; that Cc is replaced from now on'); return; }

      const mapNow = emailRerouteMapGs_(entries, now.getTime());
      const target = emailRerouteResolveGs_(mapNow, toBounced[0]);
      if (!target.changed) { set(row, 'ERROR', 'no re-route is in force for ' + toBounced[0] + ' - nothing re-sent'); return; }
      const rr = rrById['RR|' + row.email_id];
      if (rr && /^(ACCEPTED|UNCONFIRMED|ATTEMPTING)$/.test(String(rr.status))) { set(row, 'ALREADY', 're-sent already to ' + rr.to + ' (' + rr.status + ')'); return; }
      if (!emailRerouteWindowOpenGs_(row, now)) { set(row, 'TOO_OLD', 'NOT re-sent: too long after the send (past the late-send cutoff); every later email to ' + toBounced[0] + ' goes to ' + target.address); return; }
      if (!row.message_id) { set(row, 'NO_ID', 'NOT re-sent: the Gmail message id was not recorded, so the original cannot be copied; every later email to ' + toBounced[0] + ' goes to ' + target.address); return; }
      const res = emailRerouteResendGs_(ss, row, now);
      set(row, res.ok ? 'RESENT' : 'RESEND_FAILED', res.text);
    } catch (e) {
      set(row, 'ERROR', 're-route failed - ' + String((e && e.message) || e));
    }
  });
  return outcomes;
}
